import "server-only";
import type { Tx } from "@/lib/db";
import type {
  EntradaProntuario,
  EntradaEtiqueta,
  TipoAtendimento,
  AcaoAuditoria,
  AcessoLog,
} from "@/types/domain";

/**
 * DAL — Prontuário. Append-only (regras no banco via trigger). clinica_id vem do GUC.
 * Recepção só pode chamar `listarEtiquetas` (sem texto clínico); médico/admin o resto.
 * A camada de Action é quem aplica o RBAC (requireAcao) antes de chamar isto.
 */

/** Visão da RECEPÇÃO: etiquetas estruturadas, SEM texto clínico (decisão §0.4). */
export async function listarEtiquetas(
  tx: Tx,
  pacienteId: number
): Promise<EntradaEtiqueta[]> {
  const { rows } = await tx.query<EntradaEtiqueta>(
    `SELECT id, estado, tipo_atendimento, precisa_retorno,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM v_prontuario_visivel
      WHERE paciente_id = $1
      ORDER BY criado_em DESC`,
    [pacienteId]
  );
  return rows;
}

/** Visão do MÉDICO: entrada completa com texto clínico. */
export async function listarPorPaciente(
  tx: Tx,
  pacienteId: number
): Promise<EntradaProntuario[]> {
  const { rows } = await tx.query<EntradaProntuario>(
    `SELECT id, paciente_id, agendamento_id, profissional_id, estado,
            texto_clinico, tipo_atendimento, precisa_retorno, retorno_em_dias,
            orientacoes_paciente, expurgado,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em,
            to_char(finalizado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS finalizado_em
       FROM prontuario_entradas
      WHERE paciente_id = $1
      ORDER BY criado_em DESC`,
    [pacienteId]
  );
  return rows;
}

export interface NovaEntrada {
  pacienteId: number;
  agendamentoId: number | null;
  profissionalId: number;
}

/** Cria rascunho (texto entra depois; finalizar exige etiquetas — constraint do banco). */
export async function criarRascunho(tx: Tx, e: NovaEntrada): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO prontuario_entradas
       (clinica_id, paciente_id, agendamento_id, profissional_id, estado)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, 'rascunho')
     RETURNING id`,
    [e.pacienteId, e.agendamentoId, e.profissionalId]
  );
  return rows[0].id;
}

export interface FinalizarEntrada {
  id: number;
  textoClinico: string;
  tipoAtendimento: TipoAtendimento;
  precisaRetorno: boolean;
  retornoEmDias: number | null;
  orientacoesPaciente: string | null;
}

/** Finaliza: vira imutável; trigger marca o agendamento como 'realizada'. */
export async function finalizar(tx: Tx, e: FinalizarEntrada): Promise<void> {
  await tx.query(
    `UPDATE prontuario_entradas
        SET texto_clinico = $2, tipo_atendimento = $3, precisa_retorno = $4,
            retorno_em_dias = $5, orientacoes_paciente = $6,
            estado = 'finalizado', finalizado_por = profissional_id
      WHERE id = $1 AND estado = 'rascunho'`,
    [
      e.id,
      e.textoClinico,
      e.tipoAtendimento,
      e.precisaRetorno,
      e.retornoEmDias,
      e.orientacoesPaciente,
    ]
  );
}

/** Correção de entrada finalizada = NOVA entrada apontando para a original. */
export async function corrigir(
  tx: Tx,
  e: NovaEntrada & { corrigeEntradaId: number }
): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO prontuario_entradas
       (clinica_id, paciente_id, agendamento_id, profissional_id, estado, corrige_entrada_id)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, 'rascunho', $4)
     RETURNING id`,
    [e.pacienteId, e.agendamentoId, e.profissionalId, e.corrigeEntradaId]
  );
  return rows[0].id;
}

/**
 * Merge de pacientes: reatribui o histórico clínico da `origem` p/ o `destino`.
 * Chamado de dentro da transação do merge (`pacientes.repo.mesclar`). O trigger
 * append-only não bloqueia troca de `paciente_id` — só guarda campos de conteúdo.
 * Sem filtro de clinica_id: a RLS FORCE da tabela já restringe ao GUC.
 */
export async function reatribuirPaciente(
  tx: Tx,
  destinoId: number,
  origemId: number
): Promise<number> {
  const r = await tx.query(
    `UPDATE prontuario_entradas SET paciente_id = $1 WHERE paciente_id = $2`,
    [destinoId, origemId]
  );
  return r.rowCount ?? 0;
}

/** Expurgo lógico (LGPD, admin): anula conteúdo, preserva a linha. */
export async function expurgar(
  tx: Tx,
  id: number,
  motivo: string,
  usuarioId: number
): Promise<void> {
  await tx.query(
    `UPDATE prontuario_entradas
        SET expurgado = true, expurgado_em = NOW(), expurgado_por = $3,
            expurgo_motivo = $2, texto_clinico = NULL, orientacoes_paciente = NULL
      WHERE id = $1`,
    [id, motivo, usuarioId]
  );
}

/** Leitura da trilha de auditoria (admin) — últimos N acessos da clínica. */
export async function listarAcessos(tx: Tx, limite = 100): Promise<AcessoLog[]> {
  const { rows } = await tx.query<AcessoLog>(
    `SELECT a.id, a.acao, a.detalhe,
            to_char(a.criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em,
            u.nome  AS usuario_nome,
            u.papel AS usuario_papel,
            p.nome_completo AS paciente_nome,
            a.paciente_id, a.entrada_id
       FROM prontuario_acessos a
       LEFT JOIN usuarios  u ON u.id = a.usuario_id
       LEFT JOIN pacientes p ON p.id = a.paciente_id
      ORDER BY a.criado_em DESC
      LIMIT $1`,
    [limite]
  );
  return rows;
}

/** Trilha de auditoria (TRAVA 3): toda leitura/escrita clínica registra. */
export async function registrarAcesso(
  tx: Tx,
  acao: AcaoAuditoria,
  usuarioId: number,
  pacienteId: number,
  entradaId: number | null,
  detalhe?: string
): Promise<void> {
  await tx.query(
    `INSERT INTO prontuario_acessos
       (clinica_id, usuario_id, paciente_id, entrada_id, acao, detalhe)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, $4, $5)`,
    [usuarioId, pacienteId, entradaId, acao, detalhe ?? null]
  );
}
