"use client";

import { useActionState, useState } from "react";
import { ajustarInventarioAction, type EstoqueState } from "../actions";

/** Ajuste de inventário de um lote (recontagem). Inline, expande ao clicar. */
export default function AjusteLote({ loteId, atual }: { loteId: number; atual: number }) {
  const [aberto, setAberto] = useState(false);
  const [state, action, pending] = useActionState<EstoqueState, FormData>(
    ajustarInventarioAction,
    {}
  );

  if (state.ok) return <span className="text-xs text-emerald-700">✓ ajustado</span>;

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-xs text-neutral-500 underline hover:text-neutral-900"
      >
        recontar
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="lote_id" value={loteId} />
      <input
        name="quantidade_contada"
        inputMode="decimal"
        defaultValue={String(atual)}
        className="w-20 rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-neutral-900"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50"
      >
        {pending ? "…" : "ok"}
      </button>
      {state.erro && <span className="text-xs text-red-600">{state.erro}</span>}
    </form>
  );
}
