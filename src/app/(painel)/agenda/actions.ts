"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as agenda from "@/server/agenda.repo";
import * as pacientes from "@/server/pacientes.repo";
import { withTenantReadOnly } from "@/lib/tenant";
import type { DiaSemana, SlotLivre } from "@/types/domain";

/**
 * Actions do módulo Agenda + Turnos.
 * - Config (profissionais/serviços/turnos/bloqueios): RBAC `gerir_escala` (admin).
 * - Agendamento (marcar/remarcar/status): RBAC `gerir_agenda` (recepção+admin).
 * Integração n8n: nenhum webhook ativo — `criarAgendamento` popula data/hora legados e os
 * crons de lembrete D-1/D0 (app_n8n, BYPASSRLS) varrem a mesma tabela (D4, reuso implícito).
 */

export interface AgendaState {
  ok?: boolean;
  erro?: string;
  campo?: string;
}

function num(fd: FormData, k: string): number {
  return Number(String(fd.get(k) ?? "").replace(",", ".").trim());
}

// ---- Profissionais (gerir_escala) ----------------------------------------
export async function salvarProfissionalAction(
  _prev: AgendaState,
  fd: FormData
): Promise<AgendaState> {
  await requireAcao("gerir_escala");
  const session = await verifySession();

  const id = Number(fd.get("id") ?? 0);
  const nome = String(fd.get("nome") ?? "").trim();
  const especialidade = String(fd.get("especialidade") ?? "").trim() || null;
  const usuarioRaw = String(fd.get("usuario_id") ?? "").trim();
  const usuarioId = usuarioRaw ? Number(usuarioRaw) : null;
  const ativo = fd.get("ativo") !== "nao";

  if (nome.length < 2) return { erro: "Informe o nome do profissional.", campo: "nome" };

  try {
    await withTenant(session.clinica_id, async (tx) => {
      if (id > 0)
        await agenda.atualizarProfissional(tx, id, { nome, especialidade, usuarioId, ativo });
      else await agenda.criarProfissional(tx, { nome, especialidade, usuarioId });
    });
    revalidatePath("/agenda/profissionais");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao salvar profissional." };
  }
}

// ---- Serviços (gerir_escala) ---------------------------------------------
export async function salvarServicoAction(
  _prev: AgendaState,
  fd: FormData
): Promise<AgendaState> {
  await requireAcao("gerir_escala");
  const session = await verifySession();

  const id = Number(fd.get("id") ?? 0);
  const nome = String(fd.get("nome") ?? "").trim();
  const duracaoMin = num(fd, "duracao_min");
  const ativo = fd.get("ativo") !== "nao";

  if (nome.length < 2) return { erro: "Informe o nome do serviço.", campo: "nome" };
  if (!Number.isFinite(duracaoMin) || duracaoMin <= 0)
    return { erro: "Duração inválida (minutos).", campo: "duracao_min" };

  try {
    await withTenant(session.clinica_id, async (tx) => {
      if (id > 0) await agenda.atualizarServico(tx, id, { nome, duracaoMin, ativo });
      else await agenda.criarServico(tx, { nome, duracaoMin });
    });
    revalidatePath("/agenda/servicos");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao salvar serviço." };
  }
}

// ---- Turnos (gerir_escala) -----------------------------------------------
export async function criarTurnoAction(
  _prev: AgendaState,
  fd: FormData
): Promise<AgendaState> {
  await requireAcao("gerir_escala");
  const session = await verifySession();

  const profissionalId = Number(fd.get("profissional_id"));
  const diaSemana = Number(fd.get("dia_semana")) as DiaSemana;
  const horaInicio = String(fd.get("hora_inicio") ?? "").trim();
  const horaFim = String(fd.get("hora_fim") ?? "").trim();
  const vigenciaInicio =
    String(fd.get("vigencia_inicio") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const vigenciaFim = String(fd.get("vigencia_fim") ?? "").trim() || null;

  if (!Number.isInteger(profissionalId) || profissionalId <= 0)
    return { erro: "Selecione o profissional.", campo: "profissional_id" };
  if (![0, 1, 2, 3, 4, 5, 6].includes(diaSemana))
    return { erro: "Selecione o dia.", campo: "dia_semana" };
  if (!/^\d{2}:\d{2}/.test(horaInicio) || !/^\d{2}:\d{2}/.test(horaFim))
    return { erro: "Horário inválido.", campo: "hora_inicio" };
  if (horaFim <= horaInicio)
    return { erro: "Fim deve ser depois do início.", campo: "hora_fim" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      agenda.criarTurno(tx, {
        profissionalId,
        diaSemana,
        horaInicio,
        horaFim,
        vigenciaInicio,
        vigenciaFim,
      })
    );
    revalidatePath("/agenda/turnos");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao criar turno." };
  }
}

export async function removerTurnoAction(
  _prev: AgendaState,
  fd: FormData
): Promise<AgendaState> {
  await requireAcao("gerir_escala");
  const session = await verifySession();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { erro: "Turno inválido." };
  try {
    await withTenant(session.clinica_id, (tx) => agenda.removerTurno(tx, id));
    revalidatePath("/agenda/turnos");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao remover turno." };
  }
}

// ---- Bloqueios (gerir_escala) --------------------------------------------
export async function criarBloqueioAction(
  _prev: AgendaState,
  fd: FormData
): Promise<AgendaState> {
  await requireAcao("gerir_escala");
  const session = await verifySession();

  const profRaw = String(fd.get("profissional_id") ?? "").trim();
  const profissionalId = profRaw ? Number(profRaw) : null;
  const inicio = String(fd.get("inicio") ?? "").trim();
  const fim = String(fd.get("fim") ?? "").trim();
  const motivo = String(fd.get("motivo") ?? "").trim() || null;

  if (!inicio || !fim) return { erro: "Informe início e fim.", campo: "inicio" };
  if (fim <= inicio) return { erro: "Fim deve ser depois do início.", campo: "fim" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      agenda.criarBloqueio(tx, { profissionalId, inicio, fim, motivo })
    );
    revalidatePath("/agenda/turnos");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao criar bloqueio." };
  }
}

export async function removerBloqueioAction(
  _prev: AgendaState,
  fd: FormData
): Promise<AgendaState> {
  await requireAcao("gerir_escala");
  const session = await verifySession();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { erro: "Bloqueio inválido." };
  try {
    await withTenant(session.clinica_id, (tx) => agenda.removerBloqueio(tx, id));
    revalidatePath("/agenda/turnos");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao remover bloqueio." };
  }
}

// ---- Dados p/ a UI de marcação (retornam dados, não AgendaState) ---------
/** Slots livres de um profissional num dia, com a duração do serviço escolhido. */
export async function buscarSlotsAction(
  profissionalId: number,
  servicoId: number,
  data: string
): Promise<SlotLivre[]> {
  await requireAcao("gerir_agenda");
  const session = await verifySession();
  if (!profissionalId || !servicoId || !data) return [];
  return withTenantReadOnly(session.clinica_id, async (tx) => {
    const servs = await agenda.listarServicos(tx, true);
    const dur = servs.find((s) => s.id === servicoId)?.duracao_min ?? 30;
    return agenda.slotsLivres(tx, profissionalId, data, dur);
  });
}

/** Busca paciente por nome (p/ o seletor da marcação). */
export async function buscarPacientesAction(
  termo: string
): Promise<{ id: number; nome: string }[]> {
  await requireAcao("gerir_agenda");
  const session = await verifySession();
  if (termo.trim().length < 2) return [];
  return withTenantReadOnly(session.clinica_id, async (tx) => {
    const rows = await pacientes.buscarPorNome(tx, termo.trim());
    return rows.map((r) => ({ id: r.id, nome: r.nome_completo }));
  });
}

// ---- Agendamento (gerir_agenda) ------------------------------------------
export async function marcarAgendamentoAction(
  _prev: AgendaState,
  fd: FormData
): Promise<AgendaState> {
  await requireAcao("gerir_agenda");
  const session = await verifySession();

  const pacienteId = Number(fd.get("paciente_id"));
  const profissionalId = Number(fd.get("profissional_id"));
  const servicoId = Number(fd.get("servico_id"));
  const inicio = String(fd.get("inicio") ?? "").trim(); // ISO datetime (slot escolhido)
  const overbooking = fd.get("overbooking") === "sim";

  if (!Number.isInteger(pacienteId) || pacienteId <= 0)
    return { erro: "Selecione o paciente.", campo: "paciente_id" };
  if (!Number.isInteger(profissionalId) || profissionalId <= 0)
    return { erro: "Selecione o profissional.", campo: "profissional_id" };
  if (!Number.isInteger(servicoId) || servicoId <= 0)
    return { erro: "Selecione o serviço.", campo: "servico_id" };
  if (!inicio) return { erro: "Selecione o horário.", campo: "inicio" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      agenda.criarAgendamento(tx, { pacienteId, profissionalId, servicoId, inicio, overbooking })
    );
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao marcar agendamento." };
  }
}

export async function remarcarAction(_prev: AgendaState, fd: FormData): Promise<AgendaState> {
  await requireAcao("gerir_agenda");
  const session = await verifySession();
  const id = Number(fd.get("id"));
  const novoInicio = String(fd.get("inicio") ?? "").trim();
  if (!Number.isInteger(id) || id <= 0) return { erro: "Agendamento inválido." };
  if (!novoInicio) return { erro: "Informe o novo horário.", campo: "inicio" };
  try {
    await withTenant(session.clinica_id, (tx) => agenda.remarcarAgendamento(tx, id, novoInicio));
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao remarcar." };
  }
}

export async function mudarStatusAction(
  _prev: AgendaState,
  fd: FormData
): Promise<AgendaState> {
  await requireAcao("gerir_agenda");
  const session = await verifySession();
  const id = Number(fd.get("id"));
  const status = String(fd.get("status") ?? "") as
    | "confirmada"
    | "realizada"
    | "no_show"
    | "cancelada";
  if (!Number.isInteger(id) || id <= 0) return { erro: "Agendamento inválido." };
  if (!["confirmada", "realizada", "no_show", "cancelada"].includes(status))
    return { erro: "Status inválido." };
  try {
    await withTenant(session.clinica_id, (tx) => agenda.mudarStatus(tx, id, status));
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao mudar status." };
  }
}
