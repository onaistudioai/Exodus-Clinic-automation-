"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as crm from "@/server/crm.repo";

export interface TarefaState {
  ok: boolean;
  erro?: string;
}

const OK: TarefaState = { ok: true };

function pacienteIdDe(formData: FormData): number {
  const id = Number(formData.get("paciente_id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Paciente inválido.");
  return id;
}

/** Cria uma tarefa de follow-up para o paciente. */
export async function criarTarefaAction(
  _prev: TarefaState,
  formData: FormData
): Promise<TarefaState> {
  try {
    await requireAcao("gerir_crm");
    const session = await verifySession();
    const pacienteId = pacienteIdDe(formData);
    const titulo = String(formData.get("titulo") ?? "").trim();
    const descricao = String(formData.get("descricao") ?? "").trim() || null;
    const vencimento = String(formData.get("vencimento") ?? "").trim() || null;
    if (titulo.length < 2) return { ok: false, erro: "Descreva a tarefa (mín. 2 caracteres)." };

    await withTenant(session.clinica_id, (tx) =>
      crm.criarTarefa(tx, {
        pacienteId,
        titulo,
        descricao,
        vencimento,
        criadoPor: session.usuario_id,
      })
    );
    revalidatePath(`/crm/${pacienteId}`);
    return OK;
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao criar tarefa." };
  }
}

/** Registra um contato feito (tarefa nascida concluída) — atalho de relacionamento. */
export async function marcarContatoAction(
  _prev: TarefaState,
  formData: FormData
): Promise<TarefaState> {
  try {
    await requireAcao("gerir_crm");
    const session = await verifySession();
    const pacienteId = pacienteIdDe(formData);
    const nota = String(formData.get("nota") ?? "").trim() || null;

    await withTenant(session.clinica_id, (tx) =>
      crm.criarTarefa(tx, {
        pacienteId,
        titulo: "Contato registrado",
        descricao: nota,
        vencimento: null,
        criadoPor: session.usuario_id,
        concluida: true,
      })
    );
    revalidatePath(`/crm/${pacienteId}`);
    return OK;
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao registrar contato." };
  }
}

/** Conclui uma tarefa aberta. */
export async function concluirTarefaAction(
  _prev: TarefaState,
  formData: FormData
): Promise<TarefaState> {
  try {
    await requireAcao("gerir_crm");
    const session = await verifySession();
    const pacienteId = pacienteIdDe(formData);
    const tarefaId = Number(formData.get("tarefa_id"));
    if (!Number.isInteger(tarefaId) || tarefaId <= 0) return { ok: false, erro: "Tarefa inválida." };

    await withTenant(session.clinica_id, (tx) => crm.concluirTarefa(tx, tarefaId));
    revalidatePath(`/crm/${pacienteId}`);
    return OK;
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao concluir tarefa." };
  }
}
