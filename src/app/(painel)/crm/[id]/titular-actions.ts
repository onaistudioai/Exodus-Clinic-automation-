"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import { eliminar, type ReciboEliminacao } from "@/server/titular.repo";

export interface EliminacaoState {
  recibo?: ReciboEliminacao;
  erro?: string;
}

/**
 * Registra pedido de eliminação do titular (LGPD art. 18, VI).
 *
 * RBAC `expurgo_logico` — a ação já existia no rbac.ts (admin-only) e nunca havia
 * sido usada; é exatamente esta. Nenhuma ação nova foi criada.
 *
 * Exige motivo por escrito: o pedido do titular é o fato que autoriza a operação,
 * e sem registro do fato o expurgo posterior fica sem base. É prova, não burocracia.
 */
export async function registrarEliminacao(
  _prev: EliminacaoState,
  formData: FormData
): Promise<EliminacaoState> {
  await requireAcao("expurgo_logico");
  const session = await verifySession();

  const pacienteId = Number(formData.get("pacienteId"));
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return { erro: "Paciente inválido." };
  }
  if (motivo.length < 10) {
    return { erro: "Descreva o pedido do titular (mínimo 10 caracteres) — é a prova da base legal." };
  }

  try {
    const recibo = await withTenant(session.clinica_id, (tx) =>
      eliminar(tx, pacienteId, motivo, session.usuario_id)
    );
    revalidatePath(`/crm/${pacienteId}`);
    return { recibo };
  } catch (err) {
    console.error("[titular] eliminação falhou:", err);
    return { erro: "Não foi possível registrar o pedido. Verifique se a migração 005 foi aplicada." };
  }
}
