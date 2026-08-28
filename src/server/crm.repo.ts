import "server-only";
import type { Tx } from "@/lib/db";
import * as pacientes from "@/server/pacientes.repo";
import type {
  LinhaPipeline,
  ContagemEstagio,
  TarefaCrm,
  AgendamentoPaciente,
  CobrancaResumo,
  Ficha360,
  EstagioCrm,
  EstadoAlvo,
} from "@/types/domain";

/**
 * DAL — CRM da clínica. Camada de RELACIONAMENTO sobre os dados já existentes.
 * O estágio de vida é DERIVADO em runtime (sem tabela): prioridade
 * inadimplente > inativo > em_tratamento > novo > ativo.
 *
 * clinica_id vem do GUC app.clinica_id (setado por withTenant). `pacientes`,
 * `v_prontuario_visivel` (fronteira do Prontuário — ver .planning/prontuario/sql)
 * e `financeiro_*` têm RLS FORCE — o filtro por tenant é automático. `agendamentos_sofia_demo` NÃO tem RLS -> filtro explícito por
 * current_setting (mesma regra dos outros repos). RBAC é aplicado na Action.
 *
 * ponytail: janela de inatividade fixa (default 30d). Se cada clínica precisar de
 * janela própria, ler de reativacao_campanhas.janela_dias como o módulo Reativação.
 */

const JANELA_INATIVO_DEFAULT = 30;

/** CTE base: 1 linha por paciente ativo com os sinais e o estágio já derivado. */
function baseCte(janelaDias: number): string {
  const j = Number.isInteger(janelaDias) && janelaDias > 0 ? janelaDias : JANELA_INATIVO_DEFAULT;
  return `
  WITH base AS (
    SELECT
      p.id                                   AS paciente_id,
      p.nome_completo,
      ult.ultimo,
      (ult.ultimo IS NULL)                   AS sem_atendimento,
      CASE WHEN ult.ultimo IS NULL THEN NULL
           ELSE (CURRENT_DATE - ult.ultimo) END AS dias_inativo,
      EXISTS (SELECT 1 FROM financeiro_cobrancas fc
               WHERE fc.paciente_id = p.id AND fc.status = 'aberta'
                 AND fc.vencimento < CURRENT_DATE)          AS inadimplente,
      EXISTS (SELECT 1 FROM agendamentos_sofia_demo a
               WHERE a.paciente_id = p.id
                 AND a.clinica_id = current_setting('app.clinica_id')::int
                 AND a.status IN ('pendente','confirmada')
                 AND a.data_agendamento >= CURRENT_DATE)    AS tem_futuro,
      EXISTS (SELECT 1 FROM v_prontuario_visivel pe
               WHERE pe.paciente_id = p.id
                 AND pe.precisa_retorno = true)             AS retorno_pendente
      FROM pacientes p
      LEFT JOIN LATERAL (
        SELECT max(a.data_agendamento) AS ultimo
          FROM agendamentos_sofia_demo a
         WHERE a.paciente_id = p.id
           AND a.clinica_id = current_setting('app.clinica_id')::int
           AND a.status = 'realizada'
      ) ult ON true
     WHERE p.status = 'ativo'
  ),
  staged AS (
    SELECT b.*,
      CASE
        WHEN b.inadimplente                                   THEN 'inadimplente'
        WHEN b.dias_inativo IS NOT NULL AND b.dias_inativo >= ${j} THEN 'inativo'
        WHEN b.tem_futuro OR b.retorno_pendente               THEN 'em_tratamento'
        WHEN b.sem_atendimento                                THEN 'novo'
        ELSE 'ativo'
      END AS estagio
    FROM base b
  )`;
}

// prioridade p/ ordenação (mesma da regra de estágio).
const ORDEM_ESTAGIO = `
  CASE estagio
    WHEN 'inadimplente' THEN 0 WHEN 'inativo' THEN 1
    WHEN 'em_tratamento' THEN 2 WHEN 'novo' THEN 3 ELSE 4 END`;

export interface FiltroPipeline {
  estagio?: EstagioCrm;
  termo?: string;
  limite?: number;
}

/** Lista o pipeline (paciente + estágio + sinais + nº de tarefas abertas). */
export async function listarPipeline(
  tx: Tx,
  filtro: FiltroPipeline = {},
  janelaDias = JANELA_INATIVO_DEFAULT
): Promise<LinhaPipeline[]> {
  const { rows } = await tx.query<LinhaPipeline>(
    `${baseCte(janelaDias)}
     SELECT s.paciente_id, s.nome_completo, s.estagio,
            to_char(s.ultimo,'YYYY-MM-DD')     AS ultimo_atendimento,
            s.dias_inativo,
            s.tem_futuro                        AS tem_agendamento_futuro,
            s.inadimplente,
            COALESCE(t.n,0)                     AS tarefas_abertas
       FROM staged s
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n FROM crm_tarefas ct
          WHERE ct.paciente_id = s.paciente_id AND ct.status = 'aberta'
       ) t ON true
      WHERE ($1::text IS NULL OR s.estagio = $1)
        AND ($2::text IS NULL OR lower(s.nome_completo) LIKE '%' || lower($2) || '%')
      ORDER BY ${ORDEM_ESTAGIO}, s.nome_completo
      LIMIT $3`,
    [filtro.estagio ?? null, filtro.termo ?? null, filtro.limite ?? 300]
  );
  return rows;
}

/** Contagem de pacientes por estágio (cabeçalho do pipeline). */
export async function contarPorEstagio(
  tx: Tx,
  janelaDias = JANELA_INATIVO_DEFAULT
): Promise<ContagemEstagio[]> {
  const { rows } = await tx.query<ContagemEstagio>(
    `${baseCte(janelaDias)}
     SELECT estagio, count(*)::int AS total FROM staged GROUP BY estagio`
  );
  return rows;
}

/** Estágio de UM paciente (usado na ficha). */
async function estagioDe(
  tx: Tx,
  pacienteId: number,
  janelaDias = JANELA_INATIVO_DEFAULT
): Promise<EstagioCrm> {
  const { rows } = await tx.query<{ estagio: EstagioCrm }>(
    `${baseCte(janelaDias)}
     SELECT estagio FROM staged WHERE paciente_id = $1`,
    [pacienteId]
  );
  return rows[0]?.estagio ?? "ativo";
}

async function agendamentosDoPaciente(
  tx: Tx,
  pacienteId: number,
  modo: "proximos" | "ultimos"
): Promise<AgendamentoPaciente[]> {
  const cond =
    modo === "proximos"
      ? `a.status IN ('pendente','confirmada') AND a.data_agendamento >= CURRENT_DATE
         ORDER BY a.data_agendamento ASC, a.hora_agendamento ASC`
      : `a.status = 'realizada'
         ORDER BY a.data_agendamento DESC, a.hora_agendamento DESC`;
  const { rows } = await tx.query<AgendamentoPaciente>(
    `SELECT a.id,
            to_char(a.data_agendamento,'YYYY-MM-DD') AS data_agendamento,
            a.hora_agendamento::text                 AS hora_agendamento,
            a.status
       FROM agendamentos_sofia_demo a
      WHERE a.paciente_id = $1
        AND a.clinica_id = current_setting('app.clinica_id')::int
        AND ${cond}
      LIMIT 5`,
    [pacienteId]
  );
  return rows;
}

async function cobrancasDoPaciente(tx: Tx, pacienteId: number): Promise<CobrancaResumo[]> {
  const { rows } = await tx.query<CobrancaResumo>(
    `SELECT id, valor::float8 AS valor,
            to_char(vencimento,'YYYY-MM-DD') AS vencimento,
            status, tipo_atendimento,
            GREATEST(0, CURRENT_DATE - vencimento) AS dias_atraso
       FROM financeiro_cobrancas
      WHERE paciente_id = $1
      ORDER BY vencimento DESC
      LIMIT 20`,
    [pacienteId]
  );
  return rows;
}

async function reativacaoStatus(tx: Tx, pacienteId: number): Promise<EstadoAlvo | null> {
  const { rows } = await tx.query<{ status: EstadoAlvo }>(
    `SELECT status FROM reativacao_alvos
      WHERE paciente_id = $1
        AND clinica_id = current_setting('app.clinica_id')::int
      ORDER BY atualizado_em DESC
      LIMIT 1`,
    [pacienteId]
  );
  return rows[0]?.status ?? null;
}

/** Bloco NÃO-clínico da ficha 360. O texto/etiqueta de prontuário é carregado na
 *  página respeitando o RBAC (recepção só etiqueta; médico texto). */
export async function ficha360Base(
  tx: Tx,
  pacienteId: number,
  janelaDias = JANELA_INATIVO_DEFAULT
): Promise<Ficha360 | null> {
  const p = await pacientes.obterPorId(tx, pacienteId);
  if (!p) return null; // RLS: só vem se for da clínica da sessão
  const [estagio, proximos, ultimos, cobrancas, reativacao_status, tarefas] = await Promise.all([
    estagioDe(tx, pacienteId, janelaDias),
    agendamentosDoPaciente(tx, pacienteId, "proximos"),
    agendamentosDoPaciente(tx, pacienteId, "ultimos"),
    cobrancasDoPaciente(tx, pacienteId),
    reativacaoStatus(tx, pacienteId),
    listarTarefas(tx, pacienteId),
  ]);
  return {
    paciente: {
      id: p.id,
      nome_completo: p.nome_completo,
      data_nascimento: p.data_nascimento,
      idade: p.idade,
      e_menor: p.e_menor,
      cpf_last4: p.cpf_last4,
      status: p.status,
      criado_em: p.criado_em,
      eliminacao_pedida_em: p.eliminacao_pedida_em ?? null,
      anonimizado_em: p.anonimizado_em ?? null,
    },
    estagio,
    proximos,
    ultimos,
    cobrancas,
    reativacao_status,
    tarefas,
  };
}

// ===========================================================================
// TAREFAS (crm_tarefas) — follow-up de relacionamento
// ===========================================================================

const SELECT_TAREFA = `
  id, paciente_id, titulo, descricao,
  to_char(vencimento,'YYYY-MM-DD') AS vencimento, status, criado_por,
  to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS')    AS criado_em,
  to_char(concluida_em,'YYYY-MM-DD"T"HH24:MI:SS') AS concluida_em
`;

export async function listarTarefas(tx: Tx, pacienteId: number): Promise<TarefaCrm[]> {
  const { rows } = await tx.query<TarefaCrm>(
    `SELECT ${SELECT_TAREFA} FROM crm_tarefas
      WHERE paciente_id = $1
      ORDER BY (status = 'aberta') DESC,
               COALESCE(vencimento, '9999-12-31') ASC,
               criado_em DESC`,
    [pacienteId]
  );
  return rows;
}

export interface NovaTarefa {
  pacienteId: number;
  titulo: string;
  descricao: string | null;
  vencimento: string | null; // ISO date
  criadoPor: number;
  concluida?: boolean; // "marcar contato" nasce concluída
}

/**
 * Cria a tarefa. clinica_id vem do GUC. INSERT...SELECT valida que o paciente ∈
 * clínica corrente (a FK ignora RLS; 0 linhas = paciente alheio -> não grava).
 */
export async function criarTarefa(tx: Tx, t: NovaTarefa): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO crm_tarefas
       (clinica_id, paciente_id, titulo, descricao, vencimento, status, criado_por, concluida_em)
     SELECT current_setting('app.clinica_id')::int, p.id, $2, $3, $4,
            $5, $6, CASE WHEN $5 = 'concluida' THEN NOW() ELSE NULL END
       FROM pacientes p
      WHERE p.id = $1 AND p.clinica_id = current_setting('app.clinica_id')::int
     RETURNING id`,
    [
      t.pacienteId,
      t.titulo,
      t.descricao,
      t.vencimento,
      t.concluida ? "concluida" : "aberta",
      t.criadoPor,
    ]
  );
  if (rows.length === 0) throw new Error("Paciente não encontrado nesta clínica.");
  return rows[0].id;
}

/** Conclui uma tarefa aberta (idempotente: se já concluída, no-op). */
export async function concluirTarefa(tx: Tx, id: number): Promise<void> {
  await tx.query(
    `UPDATE crm_tarefas
        SET status = 'concluida', concluida_em = NOW()
      WHERE id = $1
        AND clinica_id = current_setting('app.clinica_id')::int
        AND status = 'aberta'`,
    [id]
  );
}
