"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import { definirNivel, NIVEIS_AUTORIZACAO, type NivelAutorizacao } from "@/server/identidade.repo";

function ehNivelValido(v: unknown): v is NivelAutorizacao {
  return typeof v === "string" && (NIVEIS_AUTORIZACAO as readonly string[]).includes(v);
}

/**
 * Único caminho pelo qual um vínculo (titular ou não) tem o nível alterado
 * pelo balcão (W2f). Nível nunca sobe por autoatendimento no WhatsApp — só
 * esta ação, atrás de requireAcao("checkin"), escreve em paciente_contato.nivel.
 */
export async function definirNivelAction(formData: FormData): Promise<void> {
  await requireAcao("checkin");
  const session = await verifySession();

  const contatoId = Number(formData.get("contatoId"));
  const pacienteId = Number(formData.get("pacienteId"));
  const nivel = formData.get("nivel");

  if (!Number.isInteger(contatoId) || contatoId <= 0) throw new Error("Contato inválido.");
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) throw new Error("Paciente inválido.");
  if (!ehNivelValido(nivel)) throw new Error("Nível inválido.");

  await withTenant(session.clinica_id, (tx) => definirNivel(tx, contatoId, pacienteId, nivel));
  revalidatePath(`/pacientes/${pacienteId}`);
}
