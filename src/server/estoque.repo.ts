import "server-only";
import type { Tx } from "@/lib/db";
import type {
  Produto,
  Lote,
  MovimentacaoEstoque,
  BomItem,
  NivelProduto,
  AlertaEstoque,
  ResultadoBaixa,
  CustoProcedimento,
  TipoAtendimento,
} from "@/types/domain";

/**
 * DAL — Estoque (Módulo Estoque, OPUS). Todas as tabelas têm RLS FORCE por clinica_id;
 * o GUC `app.clinica_id` é setado por withTenant() — aqui só se usa o current_setting.
 * Livro-razão `movimentacoes_estoque` é append-only (trigger): correção = estorno/ajuste.
 * Numéricos são lidos como float8 (pg devolve NUMERIC como string por padrão).
 * A camada de Action aplica o RBAC (requireAcao) antes de chamar isto.
 */

// ===========================================================================
// NÚCLEO — produtos, lotes, níveis, alertas, histórico, ajuste
// ===========================================================================

export async function listarProdutos(
  tx: Tx,
  incluirInativos = false
): Promise<Produto[]> {
  const { rows } = await tx.query<Produto>(
    `SELECT id, clinica_id, nome, categoria, unidade,
            estoque_minimo::float8 AS estoque_minimo, controlado, ativo,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM produtos
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND ($1 OR ativo = true)
      ORDER BY ativo DESC, nome`,
    [incluirInativos]
  );
  return rows;
}

export interface NovoProduto {
  nome: string;
  categoria: string | null;
  unidade: string;
  estoqueMinimo: number;
  controlado: boolean;
}

export async function criarProduto(tx: Tx, p: NovoProduto): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO produtos
       (clinica_id, nome, categoria, unidade, estoque_minimo, controlado)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, $4, $5)
     RETURNING id`,
    [p.nome, p.categoria, p.unidade, p.estoqueMinimo, p.controlado]
  );
  return rows[0].id;
}

export async function atualizarProduto(
  tx: Tx,
  id: number,
  p: NovoProduto & { ativo: boolean }
): Promise<void> {
  await tx.query(
    `UPDATE produtos
        SET nome = $2, categoria = $3, unidade = $4,
            estoque_minimo = $5, controlado = $6, ativo = $7
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [id, p.nome, p.categoria, p.unidade, p.estoqueMinimo, p.controlado, p.ativo]
  );
}

/** Um produto pelo id (dentro da clínica). */
export async function obterProduto(tx: Tx, id: number): Promise<Produto | null> {
  const { rows } = await tx.query<Produto>(
    `SELECT id, clinica_id, nome, categoria, unidade,
            estoque_minimo::float8 AS estoque_minimo, controlado, ativo,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM produtos
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [id]
  );
  return rows[0] ?? null;
}

/** Lotes de um produto (inclui zerados/negativos p/ ajuste e rastreio). */
export async function listarLotes(tx: Tx, produtoId: number): Promise<Lote[]> {
  const { rows } = await tx.query<Lote>(
    `SELECT id, clinica_id, produto_id, codigo_lote,
            to_char(validade,'YYYY-MM-DD') AS validade,
            quantidade::float8 AS quantidade, custo_unitario::float8 AS custo_unitario,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM lotes
      WHERE produto_id = $1 AND clinica_id = current_setting('app.clinica_id')::int
      ORDER BY validade ASC NULLS LAST, id ASC`,
    [produtoId]
  );
  return rows;
}

export interface EntradaLote {
  produtoId: number;
  codigoLote: string | null;
  validade: string | null; // ISO date | null
  quantidade: number; // > 0
  custoUnitario: number;
  usuarioId: number;
}

/** Entrada de compra: cria o lote e registra a movimentação (+). Retorna loteId. */
export async function darEntrada(tx: Tx, e: EntradaLote): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO lotes
       (clinica_id, produto_id, codigo_lote, validade, quantidade, custo_unitario)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, $4, $5)
     RETURNING id`,
    [e.produtoId, e.codigoLote, e.validade, e.quantidade, e.custoUnitario]
  );
  const loteId = rows[0].id;
  await tx.query(
    `INSERT INTO movimentacoes_estoque
       (clinica_id, produto_id, lote_id, tipo, motivo, quantidade, custo_unitario, usuario_id)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, 'entrada', 'compra', $3, $4, $5)`,
    [e.produtoId, loteId, e.quantidade, e.custoUnitario, e.usuarioId]
  );
  return loteId;
}

/** Nível atual de todos os produtos ativos (SUM dos lotes) + flags de alerta. */
export async function nivelPorProduto(tx: Tx): Promise<NivelProduto[]> {
  const { rows } = await tx.query<NivelProduto>(
    `SELECT p.id AS produto_id, p.nome, p.categoria, p.unidade,
            p.estoque_minimo::float8 AS estoque_minimo,
            COALESCE(SUM(l.quantidade),0)::float8 AS quantidade_total,
            (COALESCE(SUM(l.quantidade),0) <= p.estoque_minimo) AS abaixo_minimo,
            to_char(MIN(l.validade) FILTER (WHERE l.quantidade > 0),'YYYY-MM-DD')
              AS proxima_validade
       FROM produtos p
       LEFT JOIN lotes l
         ON l.produto_id = p.id
        AND l.clinica_id = current_setting('app.clinica_id')::int
      WHERE p.clinica_id = current_setting('app.clinica_id')::int
        AND p.ativo = true
      GROUP BY p.id, p.nome, p.categoria, p.unidade, p.estoque_minimo
      ORDER BY abaixo_minimo DESC, p.nome`,
    []
  );
  return rows;
}

/**
 * Alertas: ruptura (≤ mínimo), saldo negativo, validade próxima/vencida.
 * `diasValidade` = janela de antecipação (default 30). Monta em JS a partir de
 * duas leituras (níveis + lotes vencendo) p/ manter o SQL legível.
 */
export async function listarAlertas(
  tx: Tx,
  diasValidade = 30
): Promise<AlertaEstoque[]> {
  const niveis = await nivelPorProduto(tx);
  const alertas: AlertaEstoque[] = [];

  for (const n of niveis) {
    if (n.quantidade_total < 0) {
      alertas.push({
        tipo: "saldo_negativo",
        produto_id: n.produto_id,
        produto_nome: n.nome,
        unidade: n.unidade,
        quantidade_total: n.quantidade_total,
        estoque_minimo: n.estoque_minimo,
        lote_id: null,
        codigo_lote: null,
        validade: null,
        dias_para_vencer: null,
      });
    } else if (n.abaixo_minimo) {
      alertas.push({
        tipo: "ruptura",
        produto_id: n.produto_id,
        produto_nome: n.nome,
        unidade: n.unidade,
        quantidade_total: n.quantidade_total,
        estoque_minimo: n.estoque_minimo,
        lote_id: null,
        codigo_lote: null,
        validade: null,
        dias_para_vencer: null,
      });
    }
  }

  const { rows: lotes } = await tx.query<{
    lote_id: number;
    produto_id: number;
    produto_nome: string;
    unidade: string;
    codigo_lote: string | null;
    validade: string;
    quantidade: number;
    dias_para_vencer: number;
  }>(
    `SELECT l.id AS lote_id, l.produto_id, p.nome AS produto_nome, p.unidade,
            l.codigo_lote, to_char(l.validade,'YYYY-MM-DD') AS validade,
            l.quantidade::float8 AS quantidade,
            (l.validade - CURRENT_DATE) AS dias_para_vencer
       FROM lotes l
       JOIN produtos p ON p.id = l.produto_id
        AND p.clinica_id = current_setting('app.clinica_id')::int
      WHERE l.clinica_id = current_setting('app.clinica_id')::int
        AND l.quantidade > 0
        AND l.validade IS NOT NULL
        AND l.validade <= CURRENT_DATE + ($1 || ' days')::interval
      ORDER BY l.validade ASC`,
    [String(diasValidade)]
  );

  for (const l of lotes) {
    alertas.push({
      tipo: l.dias_para_vencer < 0 ? "vencido" : "validade_proxima",
      produto_id: l.produto_id,
      produto_nome: l.produto_nome,
      unidade: l.unidade,
      quantidade_total: l.quantidade,
      estoque_minimo: 0,
      lote_id: l.lote_id,
      codigo_lote: l.codigo_lote,
      validade: l.validade,
      dias_para_vencer: l.dias_para_vencer,
    });
  }

  return alertas;
}

/** Histórico de movimentações de um produto (mais recentes primeiro). */
export async function historicoProduto(
  tx: Tx,
  produtoId: number,
  limite = 100
): Promise<MovimentacaoEstoque[]> {
  const { rows } = await tx.query<MovimentacaoEstoque>(
    `SELECT id, clinica_id, produto_id, lote_id, tipo, motivo,
            quantidade::float8 AS quantidade, custo_unitario::float8 AS custo_unitario,
            agendamento_id, entrada_prontuario_id, usuario_id, observacao,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM movimentacoes_estoque
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND produto_id = $1
      ORDER BY criado_em DESC, id DESC
      LIMIT $2`,
    [produtoId, limite]
  );
  return rows;
}

/**
 * Ajuste de inventário: recontagem manual de um lote. Gera movimentação 'ajuste'
 * com o delta (contado - atual) e atualiza o saldo do lote. delta pode ser +/-.
 */
export async function ajustarInventario(
  tx: Tx,
  args: { loteId: number; quantidadeContada: number; usuarioId: number; observacao?: string }
): Promise<void> {
  const { rows } = await tx.query<{ produto_id: number; quantidade: number }>(
    `SELECT produto_id, quantidade::float8 AS quantidade
       FROM lotes
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int
      FOR UPDATE`,
    [args.loteId]
  );
  if (rows.length === 0) throw new Error("Lote não encontrado.");
  const { produto_id, quantidade } = rows[0];
  const delta = args.quantidadeContada - quantidade;
  if (Math.abs(delta) < 0.0000001) return; // L1: epsilon, não comparação exata de float

  await tx.query(
    `UPDATE lotes SET quantidade = $2
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [args.loteId, args.quantidadeContada]
  );
  await tx.query(
    `INSERT INTO movimentacoes_estoque
       (clinica_id, produto_id, lote_id, tipo, motivo, quantidade, usuario_id, observacao)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, 'ajuste', 'ajuste_inventario', $3, $4, $5)`,
    [produto_id, args.loteId, delta, args.usuarioId, args.observacao ?? null]
  );
}

// ===========================================================================
// BOM (kit por procedimento) + BAIXA AUTOMÁTICA + custo
// ===========================================================================

/** BOM de um tipo de atendimento (com nome/unidade do produto p/ exibição). */
export async function lerBom(
  tx: Tx,
  tipoAtendimento: TipoAtendimento
): Promise<BomItem[]> {
  const { rows } = await tx.query<BomItem>(
    `SELECT pm.id, pm.tipo_atendimento, pm.produto_id,
            p.nome AS produto_nome, p.unidade,
            pm.quantidade::float8 AS quantidade
       FROM procedimento_materiais pm
       JOIN produtos p ON p.id = pm.produto_id
        AND p.clinica_id = current_setting('app.clinica_id')::int
      WHERE pm.clinica_id = current_setting('app.clinica_id')::int
        AND pm.tipo_atendimento = $1
      ORDER BY p.nome`,
    [tipoAtendimento]
  );
  return rows;
}

/** Todos os BOMs da clínica (p/ tela de configuração). */
export async function listarBomCompleto(tx: Tx): Promise<BomItem[]> {
  const { rows } = await tx.query<BomItem>(
    `SELECT pm.id, pm.tipo_atendimento, pm.produto_id,
            p.nome AS produto_nome, p.unidade,
            pm.quantidade::float8 AS quantidade
       FROM procedimento_materiais pm
       JOIN produtos p ON p.id = pm.produto_id
        AND p.clinica_id = current_setting('app.clinica_id')::int
      WHERE pm.clinica_id = current_setting('app.clinica_id')::int
      ORDER BY pm.tipo_atendimento, p.nome`,
    []
  );
  return rows;
}

/** Define (upsert) um item do kit. quantidade > 0. */
export async function definirBomItem(
  tx: Tx,
  args: { tipoAtendimento: TipoAtendimento; produtoId: number; quantidade: number }
): Promise<void> {
  await tx.query(
    `INSERT INTO procedimento_materiais (clinica_id, tipo_atendimento, produto_id, quantidade)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3)
     ON CONFLICT (clinica_id, tipo_atendimento, produto_id)
     DO UPDATE SET quantidade = EXCLUDED.quantidade`,
    [args.tipoAtendimento, args.produtoId, args.quantidade]
  );
}

export async function removerBomItem(tx: Tx, id: number): Promise<void> {
  await tx.query(
    `DELETE FROM procedimento_materiais
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [id]
  );
}

export interface BaixaArgs {
  tipoAtendimento: TipoAtendimento;
  agendamentoId: number | null;
  entradaId: number;
  usuarioId: number;
}

/**
 * Baixa automática do kit de um atendimento, por FEFO (lotes que vencem antes 1º).
 *
 * POLÍTICA C3 (travada): NUNCA aborta o atendimento. Se faltar material, baixa o
 * que houver e empurra o restante como saldo NEGATIVO no lote mais recente,
 * registrando a movimentação com motivo='divergencia'. Se o produto não tem lote
 * nenhum, cria um lote sentinela negativo. O chamador (hook do prontuário) ainda
 * envolve isto em try/catch para garantir que nada reverta o atendimento.
 *
 * Invariante mantida: SUM(mov.quantidade) por produto == SUM(lotes.quantidade).
 */
export async function baixarPorAtendimento(
  tx: Tx,
  args: BaixaArgs
): Promise<ResultadoBaixa> {
  // M2 — trava de reconsumo: se este agendamento já recebeu baixa ('saida') por uma
  // entrada ANTERIOR, não consome o kit de novo (uma 2ª entrada NOVA para o mesmo
  // agendamento_id duplicaria o consumo). Só se aplica quando há agendamento vinculado.
  if (args.agendamentoId !== null) {
    const { rows } = await tx.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM movimentacoes_estoque
          WHERE clinica_id = current_setting('app.clinica_id')::int
            AND agendamento_id = $1
            AND tipo = 'saida'
            AND entrada_prontuario_id IS DISTINCT FROM $2
       ) AS existe`,
      [args.agendamentoId, args.entradaId]
    );
    if (rows[0].existe) {
      return { itens_baixados: 0, itens_com_divergencia: 0, custo_total: 0, ja_baixado: true };
    }
  }

  const bom = await lerBom(tx, args.tipoAtendimento);
  let comDivergencia = 0;

  for (const item of bom) {
    let restante = item.quantidade;

    // Lotes com saldo, FEFO (vencem antes primeiro; não-perecível por último).
    const { rows: lotes } = await tx.query<{ id: number; quantidade: number; custo: number }>(
      `SELECT id, quantidade::float8 AS quantidade, custo_unitario::float8 AS custo
         FROM lotes
        WHERE clinica_id = current_setting('app.clinica_id')::int
          AND produto_id = $1
          AND quantidade > 0
        ORDER BY validade ASC NULLS LAST, id ASC
        FOR UPDATE`,
      [item.produto_id]
    );

    let ultimoLoteId: number | null = null;
    let ultimoCusto = 0;

    for (const lote of lotes) {
      if (restante <= 0) break;
      const consumir = Math.min(restante, lote.quantidade);
      await tx.query(
        `UPDATE lotes SET quantidade = quantidade - $2 WHERE id = $1`,
        [lote.id, consumir]
      );
      await tx.query(
        `INSERT INTO movimentacoes_estoque
           (clinica_id, produto_id, lote_id, tipo, motivo, quantidade, custo_unitario,
            agendamento_id, entrada_prontuario_id, usuario_id)
         VALUES (current_setting('app.clinica_id')::int, $1, $2, 'saida', 'consumo', $3, $4, $5, $6, $7)`,
        [item.produto_id, lote.id, -consumir, lote.custo, args.agendamentoId, args.entradaId, args.usuarioId]
      );
      restante -= consumir;
      ultimoLoteId = lote.id;
      ultimoCusto = lote.custo;
    }

    // C3: faltou material -> divergência (saldo negativo sinalizado), não aborta.
    if (restante > 0.0000001) {
      comDivergencia++;
      let alvoLoteId = ultimoLoteId;
      if (alvoLoteId === null) {
        // produto sem nenhum lote: cria lote sentinela p/ manter a invariante.
        const { rows } = await tx.query<{ id: number }>(
          `INSERT INTO lotes
             (clinica_id, produto_id, codigo_lote, validade, quantidade, custo_unitario)
           VALUES (current_setting('app.clinica_id')::int, $1, 'DIVERGENCIA', NULL, 0, 0)
           RETURNING id`,
          [item.produto_id]
        );
        alvoLoteId = rows[0].id;
      }
      await tx.query(
        `UPDATE lotes SET quantidade = quantidade - $2 WHERE id = $1`,
        [alvoLoteId, restante]
      );
      await tx.query(
        `INSERT INTO movimentacoes_estoque
           (clinica_id, produto_id, lote_id, tipo, motivo, quantidade, custo_unitario,
            agendamento_id, entrada_prontuario_id, usuario_id, observacao)
         VALUES (current_setting('app.clinica_id')::int, $1, $2, 'saida', 'divergencia', $3, $4, $5, $6, $7,
                 'baixa parcial: estoque insuficiente (C3)')`,
        [item.produto_id, alvoLoteId, -restante, ultimoCusto, args.agendamentoId, args.entradaId, args.usuarioId]
      );
    }
  }

  // M1 — custo total somado em SQL (NUMERIC), não em float JS: lê de volta o livro-razão
  // desta entrada. quantidade é negativa em 'saida', por isso -quantidade. Evita drift de
  // centavos do acúmulo `consumir * custo` em float8.
  const { rows: tot } = await tx.query<{ custo_total: number }>(
    `SELECT COALESCE(SUM(-quantidade * COALESCE(custo_unitario, 0)), 0)::float8 AS custo_total
       FROM movimentacoes_estoque
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND entrada_prontuario_id = $1
        AND tipo = 'saida'`,
    [args.entradaId]
  );

  return {
    itens_baixados: bom.length,
    itens_com_divergencia: comDivergencia,
    custo_total: tot[0].custo_total,
  };
}

/** Custo de material por tipo de atendimento num período (consumo + divergência). */
export async function custoPorProcedimento(
  tx: Tx,
  desde: string,
  ate: string
): Promise<CustoProcedimento[]> {
  const { rows } = await tx.query<CustoProcedimento>(
    `SELECT pe.tipo_atendimento,
            COUNT(DISTINCT pe.id)::int AS n_atendimentos,
            COALESCE(SUM(-m.quantidade * COALESCE(m.custo_unitario,0)),0)::float8 AS custo_total,
            (COALESCE(SUM(-m.quantidade * COALESCE(m.custo_unitario,0)),0)
              / NULLIF(COUNT(DISTINCT pe.id),0))::float8 AS custo_medio
       FROM prontuario_entradas pe
       JOIN movimentacoes_estoque m
         ON m.entrada_prontuario_id = pe.id
        AND m.clinica_id = current_setting('app.clinica_id')::int
        AND m.tipo = 'saida'
      WHERE pe.clinica_id = current_setting('app.clinica_id')::int
        AND pe.tipo_atendimento IS NOT NULL
        AND pe.criado_em::date BETWEEN $1::date AND $2::date
      GROUP BY pe.tipo_atendimento
      ORDER BY custo_total DESC`,
    [desde, ate]
  );
  return rows;
}
