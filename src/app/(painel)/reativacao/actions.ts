"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as reativacao from "@/server/reativacao.repo";
import type { PassoCampanha } from "@/types/domain";

// Cadência default (decisão D1): janela 30 dias, 3 toques D+0 / D+7 / D+21.
const JANELA_DEFAULT = 30;
const PASSOS_DEFAULT: PassoCampanha[] = [
  { offset_dias: 0, template: "Oi {nome}! Sentimos sua falta na {clinica}. Quer agendar um retorno?" },
  { offset_dias: 7, template: "{nome}, ainda dá tempo de cuidar da sua saúde — responda aqui que a gente agenda pra você." },
  { offset_dias: 21, template: "{nome}, última lembrança 💙 Estamos com horários abertos essa semana. Posso reservar um pra você?" },
];

export interface ReativacaoState {
  ok?: boolean;
  erro?: string;
  msg?: string;
}

/** Cria a campanha default (gerir_reativacao). Inativa até o gestor ligar. */
export async function criarCampanhaAction(
  _prev: ReativacaoState,
  fd: FormData
): Promise<ReativacaoState> {
  await requireAcao("gerir_reativacao");
  const session = await verifySession();
  const nome = String(fd.get("nome") ?? "").trim() || "Reativação de inativos";
  try {
    await withTenant(session.clinica_id, (tx) =>
      reativacao.criarCampanha(tx, { nome, janelaDias: JANELA_DEFAULT, passos: PASSOS_DEFAULT })
    );
    revalidatePath("/reativacao");
    return { ok: true, msg: "Campanha criada (inativa)." };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao criar campanha." };
  }
}

/** Liga/desliga uma campanha (gerir_reativacao). */
export async function alternarCampanhaAction(
  _prev: ReativacaoState,
  fd: FormData
): Promise<ReativacaoState> {
  await requireAcao("gerir_reativacao");
  const session = await verifySession();
  const campanhaId = Number(fd.get("campanha_id"));
  const ativa = fd.get("ativa") === "true";
  if (!Number.isInteger(campanhaId) || campanhaId <= 0)
    return { erro: "Campanha inválida." };
  try {
    await withTenant(session.clinica_id, (tx) =>
      reativacao.definirCampanhaAtiva(tx, campanhaId, ativa)
    );
    revalidatePath("/reativacao");
    return { ok: true, msg: ativa ? "Campanha ativada." : "Campanha desativada." };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao alterar campanha." };
  }
}

/**
 * Inclui os inativos elegíveis na sequência da campanha ativa (gerir_reativacao).
 * O envio em si é do worker n8n (dry-run por default).
 */
export async function materializarAction(
  _prev: ReativacaoState,
  _fd: FormData
): Promise<ReativacaoState> {
  await requireAcao("gerir_reativacao");
  const session = await verifySession();
  try {
    const r = await withTenant(session.clinica_id, async (tx) => {
      const camp = await reativacao.getCampanhaAtiva(tx);
      if (!camp) throw new Error("Nenhuma campanha ativa. Ative uma campanha primeiro.");
      const primeiroOffset = camp.passos[0]?.offset_dias ?? 0;
      return reativacao.materializarAlvos(tx, camp.id, camp.janela_dias, primeiroOffset);
    });
    revalidatePath("/reativacao");
    return {
      ok: true,
      msg: `${r.inseridos} paciente(s) entraram na sequência` +
        (r.ignorados > 0 ? ` (${r.ignorados} já estavam/opt-out).` : "."),
    };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao incluir inativos." };
  }
}

/** Roda a atribuição de retorno: marca reativados quem voltou a agendar (gerir_reativacao). */
export async function rodarAtribuicaoAction(
  _prev: ReativacaoState,
  _fd: FormData
): Promise<ReativacaoState> {
  await requireAcao("gerir_reativacao");
  const session = await verifySession();
  try {
    const n = await withTenant(session.clinica_id, (tx) => reativacao.rodarAtribuicao(tx));
    revalidatePath("/reativacao");
    return { ok: true, msg: `${n} paciente(s) marcados como reativados.` };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha na atribuição." };
  }
}
