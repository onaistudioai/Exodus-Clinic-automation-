"use client";

import { useActionState } from "react";
import { definirPrecoAction, type FinanceiroState } from "../actions";
import type { PrecoProcedimento, TipoAtendimento } from "@/types/domain";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Uma linha-formulário da tabela de preços (um tipo de atendimento). */
export default function PrecosForm({
  tipo,
  atual,
}: {
  tipo: TipoAtendimento;
  atual: PrecoProcedimento | null;
}) {
  const [state, action, pending] = useActionState<FinanceiroState, FormData>(
    definirPrecoAction,
    {}
  );

  return (
    <tr>
      <td className="px-4 py-2 font-medium capitalize text-neutral-900">{tipo}</td>
      <td className="px-4 py-2 text-neutral-500">
        {atual ? brl(atual.valor) : <span className="text-neutral-400">não definido</span>}
      </td>
      <td className="px-4 py-2">
        {atual ? (
          atual.ativo ? (
            <span className="text-emerald-700">ativo</span>
          ) : (
            <span className="text-neutral-400">inativo</span>
          )
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-2">
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="tipo_atendimento" value={tipo} />
          <input
            name="valor"
            inputMode="decimal"
            defaultValue={atual ? String(atual.valor) : ""}
            placeholder="0,00"
            className={`w-28 rounded-lg border px-2.5 py-1 text-sm outline-none focus:border-neutral-900 ${
              state.campo === "valor" ? "border-red-500" : "border-neutral-300"
            }`}
          />
          <label className="flex items-center gap-1 text-xs text-neutral-500">
            <input
              type="checkbox"
              name="ativo"
              value="sim"
              defaultChecked={atual?.ativo ?? true}
            />
            ativo
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "…" : "Salvar"}
          </button>
          {state.erro && <span className="text-xs text-red-600">{state.erro}</span>}
          {state.ok && !state.erro && <span className="text-xs text-emerald-700">✓</span>}
        </form>
      </td>
    </tr>
  );
}
