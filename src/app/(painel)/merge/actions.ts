"use server";

import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant, withTenantReadOnly } from "@/lib/tenant";
import * as pacientes from "@/server/pacientes.repo";
import type { ResultadoBusca, ResumoMerge } from "@/types/domain";

/**
 * Merge de pacientes (DRAFT-checkin-ux.md §"Trava contra fadiga de alerta no MERGE").
 * Ação destrutiva e quase irreversível → FORA do balcão (página própria), com dupla
 * confirmação digitando o NOME do destino. RBAC: checkin (recepcao/admin).
 * Estas actions são chamadas direto dos handlers do client (RPC) — retornam valores.
 */

export async function buscarParaMerge(termo: string): Promise<ResultadoBusca[]> {
  await requireAcao("checkin");
  const session = await verifySession();
  const t = termo.trim();
  if (t.length < 3) return [];
  return withTenantReadOnly(session.clinica_id, (tx) => pacientes.buscarPorNome(tx, t));
}

export async function carregarResumo(id: number): Promise<ResumoMerge | null> {
  await requireAcao("checkin");
  const session = await verifySession();
  if (!Number.isInteger(id) || id <= 0) return null;
  return withTenantReadOnly(session.clinica_id, (tx) => pacientes.resumoParaMerge(tx, id));
}

export interface MergeResultado {
  ok: boolean;
  erro?: string;
  nome?: string;
  agendamentos?: number;
  prontuario?: number;
}

export async function mesclarPacientes(
  destinoId: number,
  origemId: number,
  confirmacaoNome: string
): Promise<MergeResultado> {
  await requireAcao("checkin");
  const session = await verifySession();

  if (
    !Number.isInteger(destinoId) ||
    !Number.isInteger(origemId) ||
    destinoId <= 0 ||
    origemId <= 0
  ) {
    return { ok: false, erro: "Seleção inválida." };
  }
  if (destinoId === origemId) {
    return { ok: false, erro: "Selecione dois pacientes diferentes." };
  }

  // Tudo em UMA transação: revalida o estado atual e aplica o merge atômico.
  return withTenant(session.clinica_id, async (tx) => {
    const destino = await pacientes.resumoParaMerge(tx, destinoId);
    const origem = await pacientes.resumoParaMerge(tx, origemId);
    if (!destino || !origem) {
      return { ok: false, erro: "Paciente não encontrado nesta clínica." };
    }
    if (destino.status !== "ativo") {
      return { ok: false, erro: "O paciente destino precisa estar ativo." };
    }
    if (origem.status !== "ativo") {
      return { ok: false, erro: "O paciente a absorver já foi arquivado ou mesclado." };
    }
    // dupla confirmação: nome digitado tem que bater com o destino (server-side)
    if (confirmacaoNome.trim().toLowerCase() !== destino.nome_completo.trim().toLowerCase()) {
      return { ok: false, erro: "O nome digitado não confere com o paciente destino." };
    }

    const counts = await pacientes.mesclar(tx, destinoId, origemId);
    return {
      ok: true,
      nome: destino.nome_completo,
      agendamentos: counts.agendamentos,
      prontuario: counts.prontuario,
    };
  });
}
