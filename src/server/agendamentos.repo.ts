import "server-only";
import type { Tx } from "@/lib/db";
import type { AgendamentoResumo } from "@/types/domain";

/**
 * DAL — Agendamentos (tabela `agendamentos_sofia_demo`, fora da RLS, mas filtrada por
 * clinica_id explicitamente). É o elo SOFIA→balcão: o check-in carimba identidade aqui.
 */

/**
 * Agendamentos recentes em aberto da clínica — candidatos a vincular no check-in.
 * Não filtra por paciente de propósito: os agendamentos vindos da SOFIA ainda não
 * têm `paciente_id` (é o check-in que faz esse vínculo), então a lista é clínica-wide.
 */
export async function listarAbertosPorPaciente(tx: Tx): Promise<AgendamentoResumo[]> {
  const { rows } = await tx.query<AgendamentoResumo>(
    `SELECT id,
            to_char(data_agendamento,'YYYY-MM-DD') AS data_agendamento,
            hora_agendamento, status, paciente_id,
            to_char(identidade_confirmada_em,'YYYY-MM-DD"T"HH24:MI:SS') AS identidade_confirmada_em
       FROM agendamentos_sofia_demo
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND status IN ('pendente','confirmada')
        AND data_agendamento >= CURRENT_DATE - INTERVAL '1 day'
      ORDER BY data_agendamento, hora_agendamento
      LIMIT 20`,
    []
  );
  return rows;
}

/**
 * WAVE 2 — agendamentos JÁ vinculados a este paciente e ainda sem desfecho
 * (pendente/confirmada), p/ o médico anexar o atendimento e o finalizar marcar
 * 'realizada' (trigger). Filtra por paciente_id + clinica (tabela fora da RLS).
 */
export async function listarVinculaveis(
  tx: Tx,
  pacienteId: number
): Promise<AgendamentoResumo[]> {
  const { rows } = await tx.query<AgendamentoResumo>(
    `SELECT id,
            to_char(data_agendamento,'YYYY-MM-DD') AS data_agendamento,
            hora_agendamento, status, paciente_id,
            to_char(identidade_confirmada_em,'YYYY-MM-DD"T"HH24:MI:SS') AS identidade_confirmada_em
       FROM agendamentos_sofia_demo
      WHERE paciente_id = $1
        AND clinica_id = current_setting('app.clinica_id')::int
        AND status IN ('pendente','confirmada')
      ORDER BY data_agendamento DESC, hora_agendamento DESC
      LIMIT 20`,
    [pacienteId]
  );
  return rows;
}

/**
 * WAVE 1 — carimba identidade no agendamento: liga o paciente e registra quem/quando
 * confirmou. Idempotente-ish: só atualiza se ainda não confirmado.
 */
export async function confirmarIdentidade(
  tx: Tx,
  agendamentoId: number,
  pacienteId: number,
  usuarioId: number
): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE agendamentos_sofia_demo
        SET paciente_id = $2,
            identidade_confirmada_em = NOW(),
            identidade_confirmada_por = $3
      WHERE id = $1
        AND clinica_id = current_setting('app.clinica_id')::int
        AND identidade_confirmada_em IS NULL`,
    [agendamentoId, pacienteId, usuarioId]
  );
  return (rowCount ?? 0) > 0;
}

/** TRAVA 2 (visibilidade): consultas passadas sem desfecho registrado. */
export async function consultasSemDesfecho(tx: Tx) {
  const { rows } = await tx.query(
    `SELECT agendamento_id, paciente_id,
            to_char(data_agendamento,'YYYY-MM-DD') AS data_agendamento,
            hora_agendamento, status
       FROM vw_consultas_sem_desfecho
      WHERE clinica_id = current_setting('app.clinica_id')::int
      ORDER BY data_agendamento DESC LIMIT 50`,
    []
  );
  return rows;
}
