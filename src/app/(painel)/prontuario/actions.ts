"use server";

import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as pacientes from "@/server/pacientes.repo";
import type { ResultadoBusca } from "@/types/domain";

/** Busca de paciente p/ abrir o prontuário (médico/admin leem o clínico). */
export async function buscarPacienteProntuario(termo: string): Promise<ResultadoBusca[]> {
  await requireAcao("ler_texto_clinico");
  const session = await verifySession();
  const t = termo.trim();
  if (t.length < 3) return [];
  return withTenantReadOnly(session.clinica_id, (tx) => pacientes.buscarPorNome(tx, t));
}
