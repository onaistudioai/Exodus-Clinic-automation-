"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  marcarAgendamentoAction,
  mudarStatusAction,
  remarcarAction,
  buscarSlotsAction,
  buscarPacientesAction,
  type AgendaState,
} from "./actions";
import type {
  AgendamentoDia,
  Profissional,
  Servico,
  SlotLivre,
} from "@/types/domain";
import { STATUS_ROTULO, STATUS_DESCONHECIDO } from "@/lib/status-agendamento";


export default function GerenciarAgenda({
  dia,
  lista,
  profissionais,
  servicos,
  podeGerir,
}: {
  dia: string;
  lista: AgendamentoDia[];
  profissionais: Profissional[];
  servicos: Servico[];
  podeGerir: boolean;
}) {
  const router = useRouter();
  // agrupa por profissional p/ a visão "coluna por profissional"
  const porProf = profissionais.map((p) => ({
    prof: p,
    itens: lista.filter((a) => a.profissional_id === p.id),
  }));
  const semProf = lista.filter((a) => !a.profissional_id);

  return (
    <div className="space-y-8">
      {/* Navegação de dia */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push(`/agenda?data=${shift(dia, -1)}`)}
          className="rounded-lg border border-neutral-300 px-2.5 py-1 text-sm hover:border-neutral-900"
        >
          ←
        </button>
        <input
          type="date"
          value={dia}
          onChange={(e) => router.push(`/agenda?data=${e.target.value}`)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
        />
        <button
          onClick={() => router.push(`/agenda?data=${shift(dia, 1)}`)}
          className="rounded-lg border border-neutral-300 px-2.5 py-1 text-sm hover:border-neutral-900"
        >
          →
        </button>
        <button
          onClick={() => router.push(`/agenda`)}
          className="rounded-lg px-2.5 py-1 text-sm text-neutral-500 hover:text-neutral-900"
        >
          hoje
        </button>
      </div>

      {/* Novo agendamento */}
      {podeGerir && profissionais.length > 0 && servicos.length > 0 && (
        <NovoAgendamento dia={dia} profissionais={profissionais} servicos={servicos} />
      )}

      {/* Visão do dia por profissional */}
      {profissionais.length === 0 ? (
        <p className="text-sm text-neutral-400">
          Cadastre profissionais e turnos para usar a agenda.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {porProf.map(({ prof, itens }) => (
            <div key={prof.id} className="rounded-xl ring-1 ring-black/5">
              <div className="border-b border-neutral-100 px-4 py-2 text-sm font-medium">
                {prof.nome}
                {prof.especialidade && (
                  <span className="ml-1 text-xs text-neutral-400">{prof.especialidade}</span>
                )}
              </div>
              <div className="divide-y divide-neutral-100">
                {itens.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-neutral-400">Sem agendamentos.</p>
                ) : (
                  itens.map((a) => (
                    <LinhaAgendamento key={a.id} a={a} podeGerir={podeGerir} />
                  ))
                )}
              </div>
            </div>
          ))}
          {semProf.length > 0 && (
            <div className="rounded-xl ring-1 ring-amber-200">
              <div className="border-b border-amber-100 px-4 py-2 text-sm font-medium text-amber-700">
                Sem profissional
              </div>
              <div className="divide-y divide-neutral-100">
                {semProf.map((a) => (
                  <LinhaAgendamento key={a.id} a={a} podeGerir={podeGerir} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LinhaAgendamento({ a, podeGerir }: { a: AgendamentoDia; podeGerir: boolean }) {
  const [aberto, setAberto] = useState(false);
  const s = STATUS_ROTULO[a.status] ?? STATUS_DESCONHECIDO;
  return (
    <div className="px-4 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-medium tabular-nums">{a.hora_inicio_label ?? "—"}</span>{" "}
          <span className="text-neutral-700">{a.paciente_nome ?? "—"}</span>
          {a.servico_nome && (
            <span className="ml-1 text-xs text-neutral-400">{a.servico_nome}</span>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
          {s.txt}
        </span>
      </div>
      {podeGerir && a.status !== "cancelada" && (
        <div className="mt-1.5">
          <button
            onClick={() => setAberto(!aberto)}
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            {aberto ? "fechar" : "ações"}
          </button>
          {aberto && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusBtn id={a.id} status="confirmada" label="Confirmar" cls="bg-sky-600" />
              <StatusBtn id={a.id} status="realizada" label="Compareceu" cls="bg-emerald-600" />
              <StatusBtn id={a.id} status="no_show" label="Faltou" cls="bg-amber-600" />
              <StatusBtn id={a.id} status="cancelada" label="Cancelar" cls="bg-neutral-500" />
              <Remarcar id={a.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBtn({
  id,
  status,
  label,
  cls,
}: {
  id: number;
  status: string;
  label: string;
  cls: string;
}) {
  const [, action, pending] = useActionState<AgendaState, FormData>(mudarStatusAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button
        disabled={pending}
        className={`rounded px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50 ${cls}`}
      >
        {label}
      </button>
    </form>
  );
}

function Remarcar({ id }: { id: number }) {
  const [state, action, pending] = useActionState<AgendaState, FormData>(remarcarAction, {});
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:border-neutral-900"
      >
        Remarcar
      </button>
    );
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input
        type="datetime-local"
        name="inicio"
        required
        className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs outline-none focus:border-neutral-900"
      />
      <button
        disabled={pending}
        className="rounded bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
      >
        ok
      </button>
      {state.erro && <span className="text-xs text-red-600">{state.erro}</span>}
    </form>
  );
}

function NovoAgendamento({
  dia,
  profissionais,
  servicos,
}: {
  dia: string;
  profissionais: Profissional[];
  servicos: Servico[];
}) {
  const [profId, setProfId] = useState(0);
  const [servId, setServId] = useState(0);
  const [slots, setSlots] = useState<SlotLivre[]>([]);
  const [slot, setSlot] = useState<SlotLivre | null>(null);
  const [buscando, startBusca] = useTransition();
  const [buscaP, setBuscaP] = useState("");
  const [pacientes, setPacientes] = useState<{ id: number; nome: string }[]>([]);
  const [pac, setPac] = useState<{ id: number; nome: string } | null>(null);
  const [over, setOver] = useState(false);
  const [state, action, pending] = useActionState<AgendaState, FormData>(
    marcarAgendamentoAction,
    {}
  );

  function verHorarios() {
    if (!profId || !servId) return;
    setSlot(null);
    startBusca(async () => setSlots(await buscarSlotsAction(profId, servId, dia)));
  }
  function buscarPac(t: string) {
    setBuscaP(t);
    if (t.trim().length < 2) return setPacientes([]);
    startBusca(async () => setPacientes(await buscarPacientesAction(t)));
  }

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
      <h3 className="mb-4 font-medium">Novo agendamento — {dia}</h3>
      <div className="flex flex-wrap gap-3">
        <select
          value={profId}
          onChange={(e) => setProfId(Number(e.target.value))}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        >
          <option value={0}>profissional…</option>
          {profissionais.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
        <select
          value={servId}
          onChange={(e) => setServId(Number(e.target.value))}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        >
          <option value={0}>serviço…</option>
          {servicos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome} ({s.duracao_min}min)
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={verHorarios}
          disabled={!profId || !servId || buscando}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {buscando ? "…" : "Ver horários"}
        </button>
      </div>

      {slots.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs text-neutral-500">Horários livres:</div>
          <div className="flex flex-wrap gap-1.5">
            {slots.map((s) => (
              <button
                key={s.inicio}
                type="button"
                onClick={() => setSlot(s)}
                className={`rounded-lg px-2.5 py-1 text-sm ${
                  slot?.inicio === s.inicio
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                {s.hora_label}
              </button>
            ))}
          </div>
        </div>
      )}
      {slots.length === 0 && profId > 0 && servId > 0 && !buscando && (
        <p className="mt-3 text-sm text-neutral-400">
          Nenhum horário livre nesse dia (verifique os turnos do profissional).
        </p>
      )}

      {slot && (
        <form action={action} className="mt-4 space-y-3 border-t border-neutral-100 pt-4">
          <input type="hidden" name="profissional_id" value={profId} />
          <input type="hidden" name="servico_id" value={servId} />
          <input type="hidden" name="inicio" value={slot.inicio} />
          <input type="hidden" name="paciente_id" value={pac?.id ?? ""} />
          <input type="hidden" name="overbooking" value={over ? "sim" : "nao"} />

          <div>
            <label className="text-sm text-neutral-700">
              Paciente para <b>{slot.hora_label}</b>
            </label>
            <input
              value={pac ? pac.nome : buscaP}
              onChange={(e) => {
                setPac(null);
                buscarPac(e.target.value);
              }}
              placeholder="buscar por nome…"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
            {!pac && pacientes.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-lg ring-1 ring-black/5">
                {pacientes.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPac(p);
                      setPacientes([]);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
                  >
                    {p.nome}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-500">
            <input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} />
            Encaixe (ignora a trava de horário ocupado)
          </label>

          {state.erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.erro}</p>
          )}
          {state.ok && !state.erro && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              ✓ Agendamento criado.
            </p>
          )}
          <button
            type="submit"
            disabled={pending || !pac}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Marcando…" : "Marcar agendamento"}
          </button>
        </form>
      )}
    </section>
  );
}

function shift(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
