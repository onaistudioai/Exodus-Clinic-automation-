"use client";

import { useActionState } from "react";
import { salvarServicoAction, type AgendaState } from "../actions";
import type { Servico } from "@/types/domain";

export default function ServicosClient({ servicos }: { servicos: Servico[] }) {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Serviço</th>
              <th className="px-4 py-2 font-medium">Duração</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {servicos.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-3 text-neutral-400">
                  Nenhum serviço cadastrado.
                </td>
              </tr>
            ) : (
              servicos.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-medium capitalize text-neutral-900">{s.nome}</td>
                  <td className="px-4 py-2 tabular-nums text-neutral-600">{s.duracao_min} min</td>
                  <td className="px-4 py-2">
                    {s.ativo ? (
                      <span className="text-emerald-700">ativo</span>
                    ) : (
                      <span className="text-neutral-400">inativo</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h3 className="mb-4 font-medium">Novo serviço</h3>
        <Form />
      </section>
    </div>
  );
}

function Form() {
  const [state, action, pending] = useActionState<AgendaState, FormData>(salvarServicoAction, {});
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
        <span className="text-neutral-700">Duração (min)</span>
        <input
          name="duracao_min"
          inputMode="numeric"
          defaultValue="30"
          className={`mt-1 block w-28 rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${
            state.campo === "duracao_min" ? "border-red-500" : "border-neutral-300"
          }`}
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
