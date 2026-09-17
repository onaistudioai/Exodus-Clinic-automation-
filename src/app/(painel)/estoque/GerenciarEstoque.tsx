"use client";

import { useActionState, useState } from "react";
import {
  criarProdutoAction,
  darEntradaAction,
  type EstoqueState,
} from "./actions";
import type { Produto } from "@/types/domain";

const HOJE_ISO = new Date().toISOString().slice(0, 10);

export default function GerenciarEstoque({ produtos }: { produtos: Produto[] }) {
  const [aba, setAba] = useState<"entrada" | "produto">("entrada");

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setAba("entrada")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            aba === "entrada" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          Dar entrada
        </button>
        <button
          type="button"
          onClick={() => setAba("produto")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            aba === "produto" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          Novo produto
        </button>
      </div>

      {aba === "entrada" ? (
        <EntradaForm produtos={produtos} />
      ) : (
        <ProdutoForm />
      )}
    </section>
  );
}

function EntradaForm({ produtos }: { produtos: Produto[] }) {
  const [state, action, pending] = useActionState<EstoqueState, FormData>(darEntradaAction, {});
  const erro = (c: string) => (state.campo === c ? "border-red-500" : "border-neutral-300");

  if (produtos.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Cadastre um produto antes de dar entrada (aba <b>Novo produto</b>).
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <h3 className="font-medium">Entrada de compra (lote)</h3>
      <label className="block text-sm">
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

      <div className="flex gap-3">
        <label className="block flex-1 text-sm">
          <span className="text-neutral-700">Código do lote (opcional)</span>
          <input
            name="codigo_lote"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>
        <label className="block flex-1 text-sm">
          <span className="text-neutral-700">Validade (opcional)</span>
          <input
            name="validade"
            type="date"
            min={HOJE_ISO}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>
      </div>

      <div className="flex gap-3">
        <label className="block flex-1 text-sm">
          <span className="text-neutral-700">Quantidade</span>
          <input
            name="quantidade"
            inputMode="decimal"
            required
            className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erro("quantidade")}`}
          />
        </label>
        <label className="block flex-1 text-sm">
          <span className="text-neutral-700">Custo unitário (R$)</span>
          <input
            name="custo_unitario"
            inputMode="decimal"
            defaultValue="0"
            className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erro("custo_unitario")}`}
          />
        </label>
      </div>

      {state.erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.erro}</p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          ✓ Entrada registrada.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Registrar entrada"}
      </button>
    </form>
  );
}

function ProdutoForm() {
  const [state, action, pending] = useActionState<EstoqueState, FormData>(criarProdutoAction, {});
  const erro = (c: string) => (state.campo === c ? "border-red-500" : "border-neutral-300");

  return (
    <form action={action} className="space-y-4">
      <h3 className="font-medium">Novo produto</h3>
      <label className="block text-sm">
        <span className="text-neutral-700">Nome</span>
        <input
          name="nome"
          required
          className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erro("nome")}`}
        />
      </label>
      <div className="flex gap-3">
        <label className="block flex-1 text-sm">
          <span className="text-neutral-700">Categoria (opcional)</span>
          <input
            name="categoria"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>
        <label className="block w-28 text-sm">
          <span className="text-neutral-700">Unidade</span>
          <input
            name="unidade"
            defaultValue="un"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>
        <label className="block w-32 text-sm">
          <span className="text-neutral-700">Estoque mínimo</span>
          <input
            name="estoque_minimo"
            inputMode="decimal"
            defaultValue="0"
            className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erro("estoque_minimo")}`}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="controlado" />
        <span className="text-neutral-700">Medicamento controlado (ANVISA)</span>
      </label>

      {state.erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.erro}</p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          ✓ Produto criado.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Criar produto"}
      </button>
    </form>
  );
}
