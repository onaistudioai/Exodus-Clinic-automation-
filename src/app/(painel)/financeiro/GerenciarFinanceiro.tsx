"use client";

import { useActionState, useState } from "react";
import {
  registrarPagamentoAction,
  cancelarCobrancaAction,
  lancamentoManualAction,
  type FinanceiroState,
} from "./actions";
import { CATEGORIAS_DESPESA, type Cobranca } from "@/types/domain";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function GerenciarFinanceiro({ abertas }: { abertas: Cobranca[] }) {
  return (
    <div className="space-y-8">
      {/* Contas a receber com ações */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-700">
          Contas a receber{" "}
          {abertas.length > 0 && <span className="text-neutral-400">({abertas.length})</span>}
        </h2>
        {abertas.length === 0 ? (
          <p className="text-sm text-neutral-400">Nenhuma cobrança em aberto.</p>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Paciente</th>
                  <th className="px-4 py-2 font-medium">Tipo</th>
                  <th className="px-4 py-2 font-medium">Vencimento</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                  <th className="px-4 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {abertas.map((c) => (
                  <LinhaCobranca key={c.id} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Lançamento manual de caixa */}
      <LancamentoForm />
    </div>
  );
}

function LinhaCobranca({ c }: { c: Cobranca }) {
  const [aberta, setAberta] = useState<null | "pagar" | "cancelar">(null);
  return (
    <>
      <tr>
        <td className="px-4 py-2 font-medium text-neutral-900">{c.paciente_nome}</td>
        <td className="px-4 py-2 text-neutral-500">{c.tipo_atendimento ?? "—"}</td>
        <td className="px-4 py-2 text-neutral-500">{c.vencimento}</td>
        <td className="px-4 py-2 text-right tabular-nums">{brl(c.valor)}</td>
        <td className="px-4 py-2 text-right">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAberta(aberta === "pagar" ? null : "pagar")}
              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Pagar
            </button>
            <button
              type="button"
              onClick={() => setAberta(aberta === "cancelar" ? null : "cancelar")}
              className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:border-neutral-900"
            >
              Cancelar
            </button>
          </div>
        </td>
      </tr>
      {aberta === "pagar" && (
        <tr>
          <td colSpan={5} className="bg-neutral-50 px-4 py-3">
            <PagarForm cobrancaId={c.id} valor={c.valor} />
          </td>
        </tr>
      )}
      {aberta === "cancelar" && (
        <tr>
          <td colSpan={5} className="bg-neutral-50 px-4 py-3">
            <CancelarForm cobrancaId={c.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function PagarForm({ cobrancaId, valor }: { cobrancaId: number; valor: number }) {
  const [state, action, pending] = useActionState<FinanceiroState, FormData>(
    registrarPagamentoAction,
    {}
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="cobranca_id" value={cobrancaId} />
      <span className="text-sm text-neutral-600">
        Receber <b>{brl(valor)}</b> via
      </span>
      <select
        name="forma_pagamento"
        defaultValue="pix"
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
      >
        <option value="pix">Pix</option>
        <option value="cartao">Cartão</option>
        <option value="dinheiro">Dinheiro</option>
        <option value="outro">Outro</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Registrando…" : "Confirmar pagamento"}
      </button>
      {state.erro && <span className="text-sm text-amber-700">{state.erro}</span>}
      {state.ok && !state.erro && <span className="text-sm text-emerald-700">✓ Pago.</span>}
    </form>
  );
}

function CancelarForm({ cobrancaId }: { cobrancaId: number }) {
  const [state, action, pending] = useActionState<FinanceiroState, FormData>(
    cancelarCobrancaAction,
    {}
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="cobranca_id" value={cobrancaId} />
      <label className="flex-1 text-sm">
        <span className="text-neutral-600">Motivo do cancelamento</span>
        <input
          name="motivo"
          required
          className={`mt-1 w-full rounded-lg border px-3 py-1.5 outline-none focus:border-neutral-900 ${
            state.campo === "motivo" ? "border-red-500" : "border-neutral-300"
          }`}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:border-red-500 hover:text-red-600 disabled:opacity-50"
      >
        {pending ? "Cancelando…" : "Cancelar cobrança"}
      </button>
      {state.erro && <span className="text-sm text-red-600">{state.erro}</span>}
    </form>
  );
}

function LancamentoForm() {
  const [state, action, pending] = useActionState<FinanceiroState, FormData>(
    lancamentoManualAction,
    {}
  );
  const [tipo, setTipo] = useState<"receita" | "despesa">("despesa");
  const erro = (c: string) => (state.campo === c ? "border-red-500" : "border-neutral-300");

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
      <h3 className="mb-4 font-medium">Lançamento manual de caixa</h3>
      <form action={action} className="space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTipo("despesa")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tipo === "despesa" ? "bg-red-600 text-white" : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            Despesa
          </button>
          <button
            type="button"
            onClick={() => setTipo("receita")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tipo === "receita"
                ? "bg-emerald-600 text-white"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            Receita
          </button>
        </div>
        <input type="hidden" name="tipo" value={tipo} />

        <div className="flex gap-3">
          <label className="block w-40 text-sm">
            <span className="text-neutral-700">Valor (R$)</span>
            <input
              name="valor"
              inputMode="decimal"
              required
              className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erro("valor")}`}
            />
          </label>
          <label className="block flex-1 text-sm">
            <span className="text-neutral-700">Categoria</span>
            {tipo === "despesa" ? (
              <select
                name="categoria"
                defaultValue=""
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
              >
                <option value="">—</option>
                {CATEGORIAS_DESPESA.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name="categoria"
                placeholder="ex.: avulso, produto"
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
              />
            )}
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-neutral-700">Descrição (opcional)</span>
          <input
            name="descricao"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>

        {state.erro && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.erro}</p>
        )}
        {state.ok && !state.erro && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            ✓ Lançamento registrado.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "Salvando…" : "Lançar"}
        </button>
      </form>
    </section>
  );
}
