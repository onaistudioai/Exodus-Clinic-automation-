"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as escalonamentos from "@/server/escalonamentos.repo";

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
