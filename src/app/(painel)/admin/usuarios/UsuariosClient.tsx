"use client";

import { useActionState } from "react";
import {
  criarUsuarioAction,
  definirAtivoAction,
  type EquipeState,
} from "./actions";
import type { UsuarioDaEquipe, PapelDisponivel } from "@/server/usuarios.repo";

export default function UsuariosClient({
  equipe,
  papeis,
  eu,
}: {
  equipe: UsuarioDaEquipe[];
  papeis: PapelDisponivel[];
  eu: number;
}) {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">E-mail</th>
              <th className="px-4 py-2 font-medium">Papel</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {equipe.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-neutral-400">
                  Ninguém cadastrado ainda.
                </td>
              </tr>
            ) : (
              equipe.map((u) => (
                <Linha key={u.id} u={u} papeis={papeis} souEu={u.id === eu} />
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h3 className="mb-1 font-medium">Adicionar alguém</h3>
        <p className="mb-4 text-sm text-neutral-500">
          Você define a senha inicial e passa por um canal privado. Peça para a pessoa
          trocá-la em <span className="font-medium">Minha conta</span> no primeiro acesso —
          até lá, você conhece a senha dela.
        </p>
        <Form papeis={papeis} />
      </section>
    </div>
  );
}

function Linha({
  u,
  papeis,
  souEu,
}: {
  u: UsuarioDaEquipe;
  papeis: PapelDisponivel[];
  souEu: boolean;
}) {
  const [state, action, pending] = useActionState<EquipeState, FormData>(
    definirAtivoAction,
    {}
  );
  const rotulo = papeis.find((p) => p.chave === u.papel)?.rotulo ?? u.papel;

  return (
    <tr>
      <td className="px-4 py-2 font-medium text-neutral-900">
        {u.nome}
        {souEu && <span className="ml-1 text-xs text-neutral-400">(você)</span>}
      </td>
      <td className="px-4 py-2 text-neutral-500">{u.email ?? "—"}</td>
      <td className="px-4 py-2 text-neutral-700">{rotulo}</td>
      <td className="px-4 py-2">
        {u.ativo ? (
          <span className="text-emerald-700">ativo</span>
        ) : (
          <span className="text-neutral-400">inativo</span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        {/* A própria conta não tem botão: desativar a si mesmo tranca a pessoa
            para fora, e se for o único admin tranca todo mundo. */}
        {souEu ? (
          <span className="text-xs text-neutral-300">—</span>
        ) : (
          <form action={action} className="inline-flex items-center gap-2">
            <input type="hidden" name="id" value={u.id} />
            <input type="hidden" name="ativo" value={u.ativo ? "nao" : "sim"} />
            <button
              disabled={pending}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:border-neutral-900 disabled:opacity-50"
            >
              {u.ativo ? "desativar" : "reativar"}
            </button>
            {state.erro && (
              <span className="text-xs text-red-600" title={state.erro}>
                !
              </span>
            )}
          </form>
        )}
      </td>
    </tr>
  );
}

function Form({ papeis }: { papeis: PapelDisponivel[] }) {
  const [state, action, pending] = useActionState<EquipeState, FormData>(
    criarUsuarioAction,
    {}
  );
  const borda = (campo: string) =>
    state.campo === campo ? "border-red-500" : "border-neutral-300";

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="text-neutral-700">Nome</span>
        <input
          name="nome"
          required
          autoComplete="off"
          className={`mt-1 block w-56 rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${borda("nome")}`}
        />
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">E-mail</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="off"
          className={`mt-1 block w-64 rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${borda("email")}`}
        />
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Papel</span>
        <select
          name="papel"
          required
          defaultValue=""
          className={`mt-1 block w-40 rounded-lg border bg-white px-3 py-2 outline-none focus:border-neutral-900 ${borda("papel")}`}
        >
          <option value="" disabled>
            escolha…
          </option>
          {papeis.map((p) => (
            <option key={p.chave} value={p.chave}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Senha inicial</span>
        <input
          name="senha"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={`mt-1 block w-44 rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${borda("senha")}`}
        />
      </label>
      <label className="text-sm">
        <span className="text-neutral-700">Repita a senha</span>
        <input
          name="senha2"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={`mt-1 block w-44 rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${borda("senha2")}`}
        />
      </label>
      <button
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "…" : "Adicionar"}
      </button>
      {state.erro && <span className="text-sm text-red-600">{state.erro}</span>}
      {state.ok && !state.erro && <span className="text-sm text-emerald-700">✓ criado</span>}
    </form>
  );
}
