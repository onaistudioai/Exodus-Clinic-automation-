"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as escalonamentos from "@/server/escalonamentos.repo";
import { reconfirmarContato } from "@/server/identidade.repo";

/**
 * Ações da fila. Retornam void de propósito: a página é server-rendered e o
 * resultado já aparece no estado da linha depois do revalidate — quem assumiu
 * primeiro fica visível em `atendido_por`. Corrida perdida não é erro, é a lista
 * contando o que aconteceu.
 */

function idDe(formData: FormData): number {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Escalonamento inválido.");
  return id;
}

export async function assumirAction(formData: FormData): Promise<void> {
  await requireAcao("gerir_escalonamento");
  const session = await verifySession();
  const id = idDe(formData);
  await withTenant(session.clinica_id, (tx) =>
    escalonamentos.assumir(tx, id, session.usuario_id)
  );
  revalidatePath("/escalonamentos");
}

export async function resolverAction(formData: FormData): Promise<void> {
  await requireAcao("gerir_escalonamento");
  const session = await verifySession();
  const id = idDe(formData);
  await withTenant(session.clinica_id, (tx) => escalonamentos.resolver(tx, id));
  revalidatePath("/escalonamentos");
}

/**
 * Único caminho de volta para um contato em `a_reconfirmar` (W2e). Ação
 * separada de `resolverAction`, e RBAC separado (`checkin`, não
 * `gerir_escalonamento`): "vi o aviso" não é a mesma autorização de "conferi a
 * pessoa presencialmente" — mesmo vocabulário de checkin/fechar-actions.ts
 * (identidade_confirmada_em/por).
 *
 * Carimba o contato E fecha o escalonamento na mesma tx: item resolvido sem o
 * carimbo deixaria o contato preso (some da fila, mas continua bloqueado).
 */
export async function reconfirmarContatoAction(formData: FormData): Promise<void> {
  await requireAcao("checkin");
  const session = await verifySession();
  const id = idDe(formData);
  const chatId = String(formData.get("chatId") ?? "");
  if (!chatId) throw new Error("Contato inválido.");

  await withTenant(session.clinica_id, async (tx) => {
    await reconfirmarContato(tx, chatId);
    await escalonamentos.resolver(tx, id);
  });
  revalidatePath("/escalonamentos");
}
