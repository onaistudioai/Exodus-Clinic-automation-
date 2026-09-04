"use client";

import { useActionState } from "react";
import { trocarSenhaAction, type SenhaState } from "./actions";

export default function SenhaClient() {
  const [state, action, pending] = useActionState<SenhaState, FormData>(
    trocarSenhaAction,
    {}
  );
  const borda = (campo: string) =>
    state.campo === campo ? "border-red-500" : "border-neutral-300";

  return (
    <form action={action} className="max-w-sm space-y-4">
      <label className="block text-sm">
        <span className="text-neutral-700">Senha atual</span>
        <input
          name="atual"
          type="password"
          required
          autoComplete="current-password"
          className={`mt-1 block w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${borda("atual")}`}
        />
      </label>
      <label className="block text-sm">
        <span className="text-neutral-700">Nova senha</span>
        <input
          name="nova"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={`mt-1 block w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${borda("nova")}`}
        />
        <span className="mt-1 block text-xs text-neutral-400">Ao menos 10 caracteres.</span>
      </label>
      <label className="block text-sm">
        <span className="text-neutral-700">Repita a nova senha</span>
        <input
          name="nova2"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={`mt-1 block w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${borda("nova2")}`}
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "…" : "Trocar senha"}
        </button>
        {state.erro && <span className="text-sm text-red-600">{state.erro}</span>}
        {state.ok && !state.erro && (
          <span className="text-sm text-emerald-700">✓ senha trocada</span>
        )}
      </div>
    </form>
  );
}
