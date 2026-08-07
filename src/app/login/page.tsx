"use client";

import { useActionState, use } from "react";
import { loginAction, type LoginState } from "./actions";
import { Wordmark, Field, btn } from "@/components/ui";
import { PulseLine } from "@/components/AuroraHero";
import { Icon } from "@/components/icons";

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas p-4 sm:p-6">
      {/* brilho aurora ao fundo da página clara */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-brand-300/30 blur-3xl"
      />

      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-card shadow-pop ring-1 ring-line md:grid-cols-2">
        {/* ── Painel acolhedor (hero escuro aurora) ── */}
        <aside className="hero-dark relative hidden flex-col justify-between p-10 md:flex">
          <div aria-hidden className="tech-grid pointer-events-none absolute inset-0" />
          <div className="relative z-10">
            <Wordmark tone="onBrand" className="text-lg" />
          </div>

          <div className="relative z-10 space-y-4">
            <div className="float-soft inline-grid h-14 w-14 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
              <Icon.Pulse className="h-7 w-7 text-brand-300" strokeWidth={2.5} />
            </div>
            <h2 className="text-2xl font-semibold leading-tight text-white">
              A recepção da sua
              <br />
              clínica, <span className="text-aurora">inteligente</span>.
            </h2>
            <p className="max-w-xs text-sm text-white/70">
              Check-in, prontuário, agenda e financeiro num só lugar — com o
              cuidado que cada paciente merece.
            </p>
          </div>

          <PulseLine className="relative z-0 mt-8 h-16 w-full text-brand-400/50" />
        </aside>

        {/* ── Formulário (glass claro) ── */}
        <form
          action={formAction}
          className="space-y-6 bg-surface p-8 sm:p-10"
        >
          <div className="space-y-1">
            {/* marca visível também no mobile (sem o painel lateral) */}
            <div className="md:hidden">
              <Wordmark className="text-lg" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">
              Bem-vindo de volta
            </h1>
            <p className="text-sm text-ink-500">
              Entre para acessar o balcão da clínica.
            </p>
          </div>

          <input type="hidden" name="next" value={next ?? "/"} />

          <Field
            label="E-mail"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="voce@clinica.com.br"
            required
          />

          <Field
            label="Senha"
            name="senha"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />

          {state.erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
              {state.erro}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className={`${btn.cta} w-full py-2.5`}
          >
            {pending ? (
              "Entrando…"
            ) : (
              <>
                Entrar <Icon.ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <p className="text-center text-xs text-ink-400">
            EXODUS · AIOS.clinic — acesso seguro e auditado
          </p>
        </form>
      </div>
    </main>
  );
}
