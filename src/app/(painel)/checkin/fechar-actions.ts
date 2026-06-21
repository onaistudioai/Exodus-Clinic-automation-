"use server";

import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant, withTenantReadOnly } from "@/lib/tenant";
import * as agendamentosRepo from "@/server/agendamentos.repo";
import type { AgendamentoResumo } from "@/types/domain";

/**
 * WAVE 1 — Fechamento do check-in (DRAFT-checkin-ux.md §"Fechamento").
 *
 * Liga TRAVA 2 do banco: confirmar identidade carimba `paciente_id` +
 * `identidade_confirmada_em/por` no agendamento da Sofia. Sem esse carimbo o
 * atendimento não "começa" — fecha o buraco entre quem agendou (Sofia, por
 * chat_id/telefone) e quem sentou na cadeira (verificado pelo humano no balcão).
 *
 * Uma única action com `intent` (carregar|confirmar) → um só useActionState na UI.
 * `clinica_id` SEMPRE da sessão; agendamentos_sofia_demo está fora da RLS, então
 * o filtro por current_setting('app.clinica_id') (dentro de withTenant) é a trava.
 */
export interface CheckinState {
  pacienteId: number;
  pacienteNome: string;
  agendamentos: AgendamentoResumo[];
  carregou: boolean;
  msg?: string; // sucesso
  erro?: string;
}

export async function gerenciarCheckin(
  _prev: CheckinState,
  formData: FormData
): Promise<CheckinState> {
  await requireAcao("checkin");
  const session = await verifySession();

  const pacienteId = Number(formData.get("pacienteId"));
  const pacienteNome = String(formData.get("pacienteNome") ?? "");
  const intent = String(formData.get("intent") ?? "carregar");

  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return { pacienteId: 0, pacienteNome, agendamentos: [], carregou: false, erro: "Paciente inválido." };
  }

  let msg: string | undefined;
  let erro: string | undefined;

  if (intent === "confirmar") {
    const agendamentoId = Number(formData.get("agendamentoId"));
    if (!Number.isInteger(agendamentoId) || agendamentoId <= 0) {
      erro = "Agendamento inválido.";
    } else {
      const ok = await withTenant(session.clinica_id, (tx) =>
        agendamentosRepo.confirmarIdentidade(tx, agendamentoId, pacienteId, session.usuario_id)
      );
      if (ok) msg = `Identidade confirmada — atendimento iniciado (agendamento #${agendamentoId}).`;
      else erro = "Esse agendamento já estava confirmado ou não foi encontrado.";
    }
  }

  // sempre relista (reflete o carimbo recém-feito)
  const agendamentos = await withTenantReadOnly(session.clinica_id, (tx) =>
    agendamentosRepo.listarAbertosPorPaciente(tx, pacienteId)
  );

  return { pacienteId, pacienteNome, agendamentos, carregou: true, msg, erro };
}
