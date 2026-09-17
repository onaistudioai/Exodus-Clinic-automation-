"use client";

import { useActionState } from "react";
import {
  definirBomAction,
  removerBomAction,
  type EstoqueState,
} from "../actions";
import type { BomItem, Produto, TipoAtendimento } from "@/types/domain";

const TIPOS: { v: TipoAtendimento; label: string }[] = [
  { v: "consulta", label: "Consulta" },
  { v: "retorno", label: "Retorno" },
  { v: "procedimento", label: "Procedimento" },
  { v: "avaliacao", label: "Avaliação" },
  { v: "limpeza", label: "Limpeza" },
];

export default function ConfigBom({
  bomInicial,
  produtos,
}: {
  bomInicial: BomItem[];
  produtos: Produto[];
}) {
  const [addState, addAction, addPending] = useActionState<EstoqueState, FormData>(
    definirBomAction,
    {}
  );

  // agrupa por tipo
  const porTipo = new Map<TipoAtendimento, BomItem[]>();
  for (const t of TIPOS) porTipo.set(t.v, []);
  for (const item of bomInicial) porTipo.get(item.tipo_atendimento)?.push(item);

  const erro = (c: string) => (addState.campo === c ? "border-red-500" : "border-neutral-300");

  return (
    <div className="space-y-6">
      {/* Form de adicionar item */}
      <form action={addAction} className="space-y-4 rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h3 className="font-medium">Adicionar material a um kit</h3>
        {produtos.length === 0 ? (
          <p className="text-sm text-neutral-500">Cadastre produtos no estoque primeiro.</p>
        ) : (
          <>
            <div className="flex gap-3">
              <label className="block flex-1 text-sm">
                <span className="text-neutral-700">Tipo de atendimento</span>
                <select
                  name="tipo_atendimento"
                  defaultValue=""
                  required
                  className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erro("tipo_atendimento")}`}
                >
                  <option value="" disabled>
                    selecione…
                  </option>
                  {TIPOS.map((t) => (
                    <option key={t.v} value={t.v}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block flex-1 text-sm">
                <span className="text-neutral-700">Produto</span>
                <select
                  name="produto_id"
                  defaultValue=""
                  required
                  className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erro("produto_id")}`}
                >
                  <option value="" disabled>
                    selecione…
                  </option>
                  {produtos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome} ({p.unidade})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block w-28 text-sm">
                <span className="text-neutral-700">Qtd</span>
                <input
                  name="quantidade"
                  inputMode="decimal"
                  required
                  className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erro("quantidade")}`}
                />
              </label>
            </div>
            {addState.erro && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{addState.erro}</p>
            )}
            {addState.ok && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                ✓ Kit atualizado.
              </p>
            )}
            <button
              type="submit"
              disabled={addPending}
              className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              {addPending ? "Salvando…" : "Adicionar / atualizar"}
            </button>
          </>
        )}
      </form>

      {/* Kits por tipo */}
      <div className="space-y-4">
        {TIPOS.map((t) => {
          const itens = porTipo.get(t.v) ?? [];
          return (
            <div key={t.v} className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
              <h4 className="mb-2 font-medium">{t.label}</h4>
              {itens.length === 0 ? (
                <p className="text-sm text-neutral-400">Nenhum material configurado.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {itens.map((item) => (
                    <BomLinha key={item.id} item={item} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BomLinha({ item }: { item: BomItem }) {
  const [state, action, pending] = useActionState<EstoqueState, FormData>(removerBomAction, {});
  if (state.ok) return null;
  return (
    <li className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
      <span>
        {item.produto_nome} —{" "}
        <b>
          {item.quantidade} {item.unidade}
        </b>
      </span>
      <form action={action}>
        <input type="hidden" name="id" value={item.id} />
        <button
          type="submit"
          disabled={pending}
          className="text-xs text-red-600 underline hover:text-red-800 disabled:opacity-50"
        >
          {pending ? "…" : "remover"}
        </button>
      </form>
    </li>
  );
}
