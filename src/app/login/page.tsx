"use client";

import { useActionState } from "react";
import { use } from "react";
import { loginAction, type LoginState } from "./actions";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = use(searchParams);
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {}
  );

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5"
      >
        <h1 className="text-xl font-semibold">AIOS Painel</h1>
        <p className="text-sm text-neutral-500">Entre para acessar o balcão.</p>

        <input type="hidden" name="next" value={next ?? "/"} />

        <label className="block text-sm">
          <span className="text-neutral-700">E-mail</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>

        <label className="block text-sm">
          <span className="text-neutral-700">Senha</span>
          <input
            name="senha"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>

        {state.erro && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.erro}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
