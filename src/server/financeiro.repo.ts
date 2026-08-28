import "server-only";
import type { Tx } from "@/lib/db";
import type {
  PrecoProcedimento,
  Cobranca,
  Lancamento,
  ResumoCaixa,
  LinhaAging,
  MargemProcedimento,
  IndicadoresFinanceiro,
  TipoAtendimento,
  FormaPagamento,
  TipoLancamento,
} from "@/types/domain";

/**
 * DAL — Financeiro (Módulo Financeiro, OPUS). Todas as tabelas têm RLS FORCE por
 * clinica_id; o GUC `app.clinica_id` é setado por withTenant() — aqui só se usa o
 * current_setting. `financeiro_lancamentos` é append-only (trigger + grant): caixa =
 * SUM do livro-razão. A camada de Action aplica o RBAC (requireAcao) antes de chamar isto.
 *
 * Dinheiro: NUMERIC(12,2) no banco, lido como ::float8 (pg devolve NUMERIC como string).
 * Idempotência: cobrança 1×/entrada (uq_cobranca_por_entrada); pagamento 1×/cobrança
 * (uq_lancamento_por_cobranca). Decisões D1–D8 do PROJECT_SPEC.
 */

// ===========================================================================
// PREÇOS — tabela por tipo_atendimento (override por cobrança é feito na cobrança)
// ===========================================================================

export async function listarPrecos(tx: Tx): Promise<PrecoProcedimento[]> {
  const { rows } = await tx.query<PrecoProcedimento>(
    `SELECT id, clinica_id, tipo_atendimento, valor::float8 AS valor, ativo,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em,
            to_char(atualizado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS atualizado_em
       FROM financeiro_precos
      WHERE clinica_id = current_setting('app.clinica_id')::int
      ORDER BY tipo_atendimento`,
    []
  );
  return rows;
}

/** Upsert do preço de um tipo (UNIQUE clinica_id+tipo). */
export async function definirPreco(
  tx: Tx,
  args: { tipoAtendimento: TipoAtendimento; valor: number; ativo?: boolean }
): Promise<void> {
  await tx.query(
    `INSERT INTO financeiro_precos (clinica_id, tipo_atendimento, valor, ativo)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3)
     ON CONFLICT (clinica_id, tipo_atendimento)
     DO UPDATE SET valor = EXCLUDED.valor, ativo = EXCLUDED.ativo, atualizado_em = NOW()`,
    [args.tipoAtendimento, args.valor, args.ativo ?? true]
  );
}

/** Preço vigente (ativo) de um tipo, ou null se não cadastrado/inativo. */
export async function precoVigente(
  tx: Tx,
  tipoAtendimento: TipoAtendimento
): Promise<number | null> {
  const { rows } = await tx.query<{ valor: number }>(
    `SELECT valor::float8 AS valor FROM financeiro_precos
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND tipo_atendimento = $1 AND ativo = true`,
    [tipoAtendimento]
  );
  return rows[0]?.valor ?? null;
}

// ===========================================================================
// COBRANÇAS — recebíveis (mutável: status muda)
// ===========================================================================

const SELECT_COBRANCA = `
  c.id, c.clinica_id, c.paciente_id, p.nome_completo AS paciente_nome,
  c.entrada_prontuario_id, c.agendamento_id, c.tipo_atendimento,
  c.valor::float8 AS valor, to_char(c.vencimento,'YYYY-MM-DD') AS vencimento,
  c.status, c.forma_pagamento,
  to_char(c.pago_em,'YYYY-MM-DD"T"HH24:MI:SS') AS pago_em,
  c.motivo_cancelamento,
  GREATEST(0, CURRENT_DATE - c.vencimento) AS dias_atraso,
  to_char(c.criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em,
  to_char(c.atualizado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS atualizado_em
`;

/**
 * Cobrança automática na finalização do atendimento. Usa o preço vigente do tipo.
 * Anti-duplicata: ON CONFLICT (uq_cobranca_por_entrada) DO NOTHING. Se não houver
 * preço cadastrado, NÃO cria (retorna sem_preco) — o hook loga e segue (não-bloqueante).
 * vencimento = hoje + offsetDias (D0 default).
 */
export async function criarCobrancaAutomatica(
  tx: Tx,
  args: {
    pacienteId: number;
    entradaId: number;
    agendamentoId: number | null;
    tipoAtendimento: TipoAtendimento;
    vencimentoOffsetDias?: number;
  }
): Promise<{ criada: boolean; cobrancaId?: number; motivo?: "sem_preco" | "duplicada" }> {
  const valor = await precoVigente(tx, args.tipoAtendimento);
  if (valor === null) return { criada: false, motivo: "sem_preco" };

  // INSERT...SELECT valida que o paciente ∈ clínica corrente (lição M2 do Estoque):
  // a FK ignora RLS, então só grava se o paciente for do tenant. 0 linhas = alheio.
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO financeiro_cobrancas
       (clinica_id, paciente_id, entrada_prontuario_id, agendamento_id,
        tipo_atendimento, valor, vencimento, status)
     SELECT current_setting('app.clinica_id')::int, p.id, $2, $3, $4, $5,
            CURRENT_DATE + ($6 || ' days')::interval, 'aberta'
       FROM pacientes p
      WHERE p.id = $1 AND p.clinica_id = current_setting('app.clinica_id')::int
     ON CONFLICT (clinica_id, entrada_prontuario_id)
       WHERE entrada_prontuario_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [
      args.pacienteId,
      args.entradaId,
      args.agendamentoId,
      args.tipoAtendimento,
      valor,
      String(args.vencimentoOffsetDias ?? 0),
    ]
  );
  if (rows.length === 0) return { criada: false, motivo: "duplicada" };
  return { criada: true, cobrancaId: rows[0].id };
}

export async function listarCobrancas(
  tx: Tx,
  filtro?: { status?: Cobranca["status"]; desde?: string; ate?: string; limite?: number }
): Promise<Cobranca[]> {
  const { rows } = await tx.query<Cobranca>(
    `SELECT ${SELECT_COBRANCA}
       FROM financeiro_cobrancas c
       JOIN pacientes p ON p.id = c.paciente_id
        AND p.clinica_id = current_setting('app.clinica_id')::int
      WHERE c.clinica_id = current_setting('app.clinica_id')::int
        AND ($1::text IS NULL OR c.status = $1)
        AND ($2::date IS NULL OR c.criado_em::date >= $2::date)
        AND ($3::date IS NULL OR c.criado_em::date <= $3::date)
      ORDER BY c.vencimento ASC, c.id DESC
      LIMIT $4`,
    [filtro?.status ?? null, filtro?.desde ?? null, filtro?.ate ?? null, filtro?.limite ?? 500]
  );
  return rows;
}

/** Inadimplentes: cobranças abertas com vencimento < hoje (mais atrasadas primeiro). */
export async function listarInadimplentes(tx: Tx): Promise<Cobranca[]> {
  const { rows } = await tx.query<Cobranca>(
    `SELECT ${SELECT_COBRANCA}
       FROM financeiro_cobrancas c
       JOIN pacientes p ON p.id = c.paciente_id
        AND p.clinica_id = current_setting('app.clinica_id')::int
      WHERE c.clinica_id = current_setting('app.clinica_id')::int
        AND c.status = 'aberta' AND c.vencimento < CURRENT_DATE
      ORDER BY c.vencimento ASC`,
    []
  );
  return rows;
}

/** Uma cobrança pelo id (com nome do paciente) — usado no recibo. */
export async function obterCobranca(tx: Tx, id: number): Promise<Cobranca | null> {
  const { rows } = await tx.query<Cobranca>(
    `SELECT ${SELECT_COBRANCA}
       FROM financeiro_cobrancas c
       JOIN pacientes p ON p.id = c.paciente_id
        AND p.clinica_id = current_setting('app.clinica_id')::int
      WHERE c.id = $1 AND c.clinica_id = current_setting('app.clinica_id')::int`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Cancela uma cobrança aberta (com motivo). Não apaga (caixa é append-only); só muda
 * status. Não mexe em lançamento — cancelar é só para cobrança NÃO paga.
 */
export async function cancelarCobranca(
  tx: Tx,
  id: number,
  motivo: string
): Promise<void> {
  const res = await tx.query(
    `UPDATE financeiro_cobrancas
        SET status = 'cancelada', motivo_cancelamento = $2, atualizado_em = NOW()
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int
        AND status = 'aberta'`,
    [id, motivo]
  );
  if (res.rowCount === 0)
    throw new Error("Cobrança não encontrada ou não está aberta (só cancela aberta).");
}

// ===========================================================================
// LANÇAMENTOS — livro-razão append-only do caixa
// ===========================================================================

const SELECT_LANCAMENTO = `
  id, clinica_id, tipo, categoria, valor::float8 AS valor, descricao,
  cobranca_id, forma_pagamento, usuario_id,
  to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
`;

/**
 * Registra o pagamento de uma cobrança: marca a cobrança 'paga' E insere um lançamento
 * 'receita'. IDEMPOTENTE: o índice parcial uq_lancamento_por_cobranca garante 1 receita
 * por cobrança; o INSERT ON CONFLICT DO NOTHING faz a 2ª chamada virar no-op (não paga 2×).
 */
export async function registrarPagamento(
  tx: Tx,
  args: { cobrancaId: number; formaPagamento: FormaPagamento; usuarioId: number }
): Promise<{ pago: boolean; ja_pago?: boolean }> {
  // trava a cobrança (evita corrida) e valida tenant + valor.
  const { rows: cob } = await tx.query<{ valor: number; status: string }>(
    `SELECT valor::float8 AS valor, status FROM financeiro_cobrancas
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int
      FOR UPDATE`,
    [args.cobrancaId]
  );
  if (cob.length === 0) throw new Error("Cobrança não encontrada nesta clínica.");
  if (cob[0].status === "cancelada") throw new Error("Cobrança cancelada não pode ser paga.");
  if (cob[0].status === "paga") return { pago: false, ja_pago: true };

  // INSERT do lançamento PRIMEIRO: se já existe (uq_lancamento_por_cobranca), DO NOTHING
  // devolve 0 linhas => alguém já pagou (idempotência forte mesmo sob corrida).
  const ins = await tx.query(
    `INSERT INTO financeiro_lancamentos
       (clinica_id, tipo, categoria, valor, descricao, cobranca_id, forma_pagamento, usuario_id)
     VALUES (current_setting('app.clinica_id')::int, 'receita', 'atendimento', $1,
             'Pagamento da cobrança #' || $2::text, $2, $3, $4)
     ON CONFLICT (clinica_id, cobranca_id) WHERE cobranca_id IS NOT NULL
     DO NOTHING`,
    [cob[0].valor, args.cobrancaId, args.formaPagamento, args.usuarioId]
  );
  if (ins.rowCount === 0) return { pago: false, ja_pago: true };

  await tx.query(
    `UPDATE financeiro_cobrancas
        SET status = 'paga', forma_pagamento = $2, pago_em = NOW(), atualizado_em = NOW()
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [args.cobrancaId, args.formaPagamento]
  );
  return { pago: true };
}

/** Lançamento manual avulso (receita ou despesa). Não vinculado a cobrança. */
export async function lancamentoManual(
  tx: Tx,
  args: {
    tipo: TipoLancamento;
    valor: number;
    categoria: string | null;
    descricao: string | null;
    formaPagamento: FormaPagamento | null;
    usuarioId: number;
  }
): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO financeiro_lancamentos
       (clinica_id, tipo, categoria, valor, descricao, forma_pagamento, usuario_id)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [args.tipo, args.categoria, args.valor, args.descricao, args.formaPagamento, args.usuarioId]
  );
  return rows[0].id;
}

/** Lançamentos de um período (mais recentes primeiro) — usado na lista e no CSV. */
export async function lancamentosPeriodo(
  tx: Tx,
  desde: string,
  ate: string,
  limite = 1000
): Promise<Lancamento[]> {
  const { rows } = await tx.query<Lancamento>(
    `SELECT ${SELECT_LANCAMENTO}
       FROM financeiro_lancamentos
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND criado_em::date BETWEEN $1::date AND $2::date
      ORDER BY criado_em DESC, id DESC
      LIMIT $3`,
    [desde, ate, limite]
  );
  return rows;
}

// ===========================================================================
// RELATÓRIOS / INDICADORES (painel)
// ===========================================================================

/** Caixa de um período: SUM(receitas) − SUM(despesas) do livro-razão. */
export async function resumoCaixa(tx: Tx, desde: string, ate: string): Promise<ResumoCaixa> {
  const { rows } = await tx.query<{ receitas: number; despesas: number }>(
    `SELECT COALESCE(SUM(valor) FILTER (WHERE tipo='receita'),0)::float8 AS receitas,
            COALESCE(SUM(valor) FILTER (WHERE tipo='despesa'),0)::float8 AS despesas
       FROM financeiro_lancamentos
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND criado_em::date BETWEEN $1::date AND $2::date`,
    [desde, ate]
  );
  const r = rows[0];
  return { receitas: r.receitas, despesas: r.despesas, saldo: r.receitas - r.despesas };
}

/** Aging de contas a receber (cobranças abertas por idade da dívida). */
export async function aging(tx: Tx): Promise<LinhaAging[]> {
  const { rows } = await tx.query<LinhaAging>(
    `SELECT faixa,
            COUNT(*)::int AS quantidade,
            COALESCE(SUM(valor),0)::float8 AS valor_total
       FROM (
         SELECT valor::float8 AS valor,
                CASE
                  WHEN vencimento >= CURRENT_DATE THEN 'a_vencer'
                  WHEN CURRENT_DATE - vencimento BETWEEN 1 AND 30 THEN '0_30'
                  WHEN CURRENT_DATE - vencimento BETWEEN 31 AND 60 THEN '31_60'
                  WHEN CURRENT_DATE - vencimento BETWEEN 61 AND 90 THEN '61_90'
                  ELSE '90_mais'
                END AS faixa
           FROM financeiro_cobrancas
          WHERE clinica_id = current_setting('app.clinica_id')::int
            AND status = 'aberta'
       ) s
      GROUP BY faixa`,
    []
  );
  return rows;
}

/**
 * Margem por procedimento = receita das cobranças (não-canceladas) − custo de material
 * (livro-razão do Estoque), agregado por tipo_atendimento num período. Junta as cobranças
 * com o custo já computado em movimentacoes_estoque (mesma entrada_prontuario_id).
 */
export async function margemPorProcedimento(
  tx: Tx,
  desde: string,
  ate: string
): Promise<MargemProcedimento[]> {
  const { rows } = await tx.query<MargemProcedimento>(
    `WITH receita AS (
       SELECT tipo_atendimento,
              COUNT(*)::int AS n_cobrancas,
              COALESCE(SUM(valor),0)::float8 AS receita_total
         FROM financeiro_cobrancas
        WHERE clinica_id = current_setting('app.clinica_id')::int
          AND status <> 'cancelada'
          AND tipo_atendimento IS NOT NULL
          AND criado_em::date BETWEEN $1::date AND $2::date
        GROUP BY tipo_atendimento
     ),
     custo AS (
       SELECT pe.tipo_atendimento,
              COALESCE(SUM(-m.quantidade * COALESCE(m.custo_unitario,0)),0)::float8 AS custo_material
         FROM v_prontuario_indicador pe
         JOIN movimentacoes_estoque m
           ON m.entrada_prontuario_id = pe.id
          AND m.clinica_id = current_setting('app.clinica_id')::int
          AND m.tipo = 'saida'
        WHERE pe.clinica_id = current_setting('app.clinica_id')::int
          AND pe.tipo_atendimento IS NOT NULL
          AND pe.criado_em::date BETWEEN $1::date AND $2::date
        GROUP BY pe.tipo_atendimento
     )
     SELECT COALESCE(r.tipo_atendimento, c.tipo_atendimento) AS tipo_atendimento,
            COALESCE(r.n_cobrancas,0)    AS n_cobrancas,
            COALESCE(r.receita_total,0)  AS receita_total,
            COALESCE(c.custo_material,0) AS custo_material,
            (COALESCE(r.receita_total,0) - COALESCE(c.custo_material,0)) AS margem
       FROM receita r
       FULL OUTER JOIN custo c ON c.tipo_atendimento = r.tipo_atendimento
      ORDER BY margem DESC`,
    [desde, ate]
  );
  return rows;
}

/** Indicadores do topo do painel (D7): caixa, a-receber, inadimplência, faturamento, ticket. */
export async function indicadores(tx: Tx): Promise<IndicadoresFinanceiro> {
  const { rows } = await tx.query<{
    caixa_dia: number;
    caixa_mes: number;
    faturamento_mes: number;
    pagas_mes: number;
    a_receber: number;
    inadimplencia_valor: number;
  }>(
    `SELECT
        (SELECT COALESCE(SUM(valor) FILTER (WHERE tipo='receita'),0)
              - COALESCE(SUM(valor) FILTER (WHERE tipo='despesa'),0)
           FROM financeiro_lancamentos
          WHERE clinica_id = current_setting('app.clinica_id')::int
            AND criado_em::date = CURRENT_DATE)::float8 AS caixa_dia,
        (SELECT COALESCE(SUM(valor) FILTER (WHERE tipo='receita'),0)
              - COALESCE(SUM(valor) FILTER (WHERE tipo='despesa'),0)
           FROM financeiro_lancamentos
          WHERE clinica_id = current_setting('app.clinica_id')::int
            AND date_trunc('month',criado_em) = date_trunc('month',CURRENT_DATE))::float8 AS caixa_mes,
        (SELECT COALESCE(SUM(valor),0)
           FROM financeiro_lancamentos
          WHERE clinica_id = current_setting('app.clinica_id')::int AND tipo='receita'
            AND date_trunc('month',criado_em) = date_trunc('month',CURRENT_DATE))::float8 AS faturamento_mes,
        (SELECT COUNT(*)
           FROM financeiro_cobrancas
          WHERE clinica_id = current_setting('app.clinica_id')::int AND status='paga'
            AND date_trunc('month',pago_em) = date_trunc('month',CURRENT_DATE))::float8 AS pagas_mes,
        (SELECT COALESCE(SUM(valor),0)
           FROM financeiro_cobrancas
          WHERE clinica_id = current_setting('app.clinica_id')::int AND status='aberta')::float8 AS a_receber,
        (SELECT COALESCE(SUM(valor),0)
           FROM financeiro_cobrancas
          WHERE clinica_id = current_setting('app.clinica_id')::int AND status='aberta'
            AND vencimento < CURRENT_DATE)::float8 AS inadimplencia_valor`,
    []
  );
  const r = rows[0];
  return {
    caixa_dia: r.caixa_dia,
    caixa_mes: r.caixa_mes,
    a_receber: r.a_receber,
    inadimplencia_valor: r.inadimplencia_valor,
    inadimplencia_pct: r.a_receber > 0 ? r.inadimplencia_valor / r.a_receber : 0,
    faturamento_mes: r.faturamento_mes,
    ticket_medio: r.pagas_mes > 0 ? r.faturamento_mes / r.pagas_mes : 0,
  };
}
