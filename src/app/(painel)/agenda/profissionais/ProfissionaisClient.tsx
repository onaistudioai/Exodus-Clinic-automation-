"use client";

import { useActionState } from "react";
import { salvarProfissionalAction, type AgendaState } from "../actions";
import type { Profissional } from "@/types/domain";

export default function ProfissionaisClient({
  profissionais,
}: {
  profissionais: Profissional[];
}) {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Especialidade</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {profissionais.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-neutral-400">
                  Nenhum profissional cadastrado.
                </td>
              </tr>
            ) : (
              profissionais.map((p) => <Linha key={p.id} p={p} />)
            )}
          </tbody>
        </table>
      </div>
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h3 className="mb-4 font-medium">Novo profissional</h3>
        <Form />
      </section>
    </div>
  );
}

function Linha({ p }: { p: Profissional }) {
  const [state, action, pending] = useActionState<AgendaState, FormData>(
    salvarProfissionalAction,
    {}
  );
  return (
    <tr>
      <td className="px-4 py-2 font-medium text-neutral-900">{p.nome}</td>
      <td className="px-4 py-2 text-neutral-500">{p.especialidade ?? "—"}</td>
      <td className="px-4 py-2">
        {p.ativo ? (
          <span className="text-emerald-700">ativo</span>
        ) : (
          <span className="text-neutral-400">inativo</span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <form action={action} className="inline-flex items-center gap-1">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="nome" value={p.nome} />
          <input type="hidden" name="especialidade" value={p.especialidade ?? ""} />
          <input type="hidden" name="ativo" value={p.ativo ? "nao" : "sim"} />
          <button
            disabled={pending}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:border-neutral-900 disabled:opacity-50"
          >
            {p.ativo ? "desativar" : "ativar"}
          </button>
          {state.erro && <span className="text-xs text-red-600">!</span>}
        </form>
      </td>
    </tr>
  );
}

function Form() {
  const [state, action, pending] = useActionState<AgendaState, FormData>(
    salvarProfissionalAction,
    {}
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="text-neutral-700">Nome</span>
        <input
          name="nome"
          required
          className={`mt-1 block w-56 rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${
            state.campo === "nome" ? "border-red-500" : "border-neutral-300"
          }`}
        />
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Especialidade</span>
        <input
          name="especialidade"
          className="mt-1 block w-48 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Usuário (id, opcional)</span>
        <input
          name="usuario_id"
          inputMode="numeric"
          className="mt-1 block w-28 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
      </label>
      <button
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "…" : "Adicionar"}
      </button>
      {state.erro && <span className="text-sm text-red-600">{state.erro}</span>}
      {state.ok && !state.erro && <span className="text-sm text-emerald-700">✓</span>}
    </form>
  );
}
