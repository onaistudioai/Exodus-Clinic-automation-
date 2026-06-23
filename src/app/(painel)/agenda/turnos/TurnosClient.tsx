"use client";

import { useActionState } from "react";
import {
  criarTurnoAction,
  removerTurnoAction,
  criarBloqueioAction,
  removerBloqueioAction,
  type AgendaState,
} from "../actions";
import { DIAS_SEMANA, type Profissional, type Turno, type Bloqueio } from "@/types/domain";

export default function TurnosClient({
  profissionais,
  turnos,
  bloqueios,
}: {
  profissionais: Profissional[];
  turnos: Turno[];
  bloqueios: Bloqueio[];
}) {
  if (profissionais.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        Cadastre profissionais antes de montar a escala.
      </p>
    );
  }
  return (
    <div className="space-y-8">
      {/* Grade semanal profissional × dia */}
      <div className="overflow-x-auto rounded-xl ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Profissional</th>
              {DIAS_SEMANA.map((d) => (
                <th key={d.v} className="px-3 py-2 text-center font-medium">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {profissionais.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-medium text-neutral-900">{p.nome}</td>
                {DIAS_SEMANA.map((d) => {
                  const ts = turnos.filter(
                    (t) => t.profissional_id === p.id && t.dia_semana === d.v
                  );
                  return (
                    <td key={d.v} className="px-3 py-2 text-center align-top">
                      {ts.length === 0 ? (
                        <span className="text-neutral-300">—</span>
                      ) : (
                        ts.map((t) => <TurnoChip key={t.id} t={t} />)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Novo turno */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h3 className="mb-4 font-medium">Novo turno</h3>
        <NovoTurno profissionais={profissionais} />
      </section>

      {/* Bloqueios */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h3 className="mb-4 font-medium">Bloqueios (exceções)</h3>
        {bloqueios.length > 0 && (
          <ul className="mb-4 space-y-1.5 text-sm">
            {bloqueios.map((b) => (
              <BloqueioLinha key={b.id} b={b} />
            ))}
          </ul>
        )}
        <NovoBloqueio profissionais={profissionais} />
      </section>
    </div>
  );
}

function TurnoChip({ t }: { t: Turno }) {
  const [, action, pending] = useActionState<AgendaState, FormData>(removerTurnoAction, {});
  return (
    <form action={action} className="mb-1 inline-block">
      <input type="hidden" name="id" value={t.id} />
      <button
        disabled={pending}
        title="remover turno"
        className="rounded bg-sky-50 px-2 py-0.5 text-xs tabular-nums text-sky-700 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        {t.hora_inicio}–{t.hora_fim} ✕
      </button>
    </form>
  );
}

function NovoTurno({ profissionais }: { profissionais: Profissional[] }) {
  const [state, action, pending] = useActionState<AgendaState, FormData>(criarTurnoAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="text-neutral-700">Profissional</span>
        <select
          name="profissional_id"
          defaultValue=""
          required
          className="mt-1 block w-44 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        >
          <option value="" disabled>
            selecione…
          </option>
          {profissionais.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Dia</span>
        <select
          name="dia_semana"
          defaultValue="1"
          className="mt-1 block w-24 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        >
          {DIAS_SEMANA.map((d) => (
            <option key={d.v} value={d.v}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Início</span>
        <input
          name="hora_inicio"
          type="time"
          defaultValue="08:00"
          required
          className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Fim</span>
        <input
          name="hora_fim"
          type="time"
          defaultValue="12:00"
          required
          className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
      </label>
      <button
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "…" : "Adicionar turno"}
      </button>
      {state.erro && <span className="text-sm text-red-600">{state.erro}</span>}
      {state.ok && !state.erro && <span className="text-sm text-emerald-700">✓</span>}
    </form>
  );
}

function BloqueioLinha({ b }: { b: Bloqueio }) {
  const [, action, pending] = useActionState<AgendaState, FormData>(removerBloqueioAction, {});
  return (
    <li className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-1.5">
      <span>
        <b>{b.profissional_nome ?? "Clínica toda"}</b> — {b.inicio.replace("T", " ").slice(0, 16)} →{" "}
        {b.fim.replace("T", " ").slice(0, 16)}
        {b.motivo && <span className="ml-1 text-neutral-400">({b.motivo})</span>}
      </span>
      <form action={action}>
        <input type="hidden" name="id" value={b.id} />
        <button
          disabled={pending}
          className="text-xs text-neutral-400 hover:text-red-600 disabled:opacity-50"
        >
          remover
        </button>
      </form>
    </li>
  );
}

function NovoBloqueio({ profissionais }: { profissionais: Profissional[] }) {
  const [state, action, pending] = useActionState<AgendaState, FormData>(criarBloqueioAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="text-neutral-700">Profissional</span>
        <select
          name="profissional_id"
          defaultValue=""
          className="mt-1 block w-44 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        >
          <option value="">Clínica toda</option>
          {profissionais.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Início</span>
        <input
          name="inicio"
          type="datetime-local"
          required
          className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Fim</span>
        <input
          name="fim"
          type="datetime-local"
          required
          className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Motivo</span>
        <input
          name="motivo"
          className="mt-1 block w-40 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
      </label>
      <button
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "…" : "Bloquear"}
      </button>
      {state.erro && <span className="text-sm text-red-600">{state.erro}</span>}
      {state.ok && !state.erro && <span className="text-sm text-emerald-700">✓</span>}
    </form>
  );
}
