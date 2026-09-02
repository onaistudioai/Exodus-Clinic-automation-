import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAcao, permissoes } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as estoque from "@/server/estoque.repo";
import type { Lote, MovimentacaoEstoque, Produto } from "@/types/domain";
import AjusteLote from "./AjusteLote";

const MOTIVO_LABEL: Record<string, string> = {
  compra: "Compra",
  consumo: "Consumo",
  perda: "Perda",
  vencimento: "Vencimento",
  ajuste_inventario: "Ajuste",
  estorno: "Estorno",
  divergencia: "Divergência",
};

export default async function ProdutoEstoquePage({
  params,
}: {
  params: Promise<{ produtoId: string }>;
}) {
  await requireAcao("ver_estoque");
  const session = await verifySession();
  const { pode } = await permissoes();
  const podeGerir = pode("gerir_estoque");
  const produtoId = Number((await params).produtoId);
  if (!Number.isInteger(produtoId) || produtoId <= 0) notFound();

  let produto: Produto | null = null;
  let lotes: Lote[] = [];
  let historico: MovimentacaoEstoque[] = [];
  try {
    [produto, lotes, historico] = await withTenantReadOnly(session.clinica_id, async (tx) => [
      await estoque.obterProduto(tx, produtoId),
      await estoque.listarLotes(tx, produtoId),
      await estoque.historicoProduto(tx, produtoId),
    ]);
  } catch {
    // tabelas não migradas
  }
  if (!produto) notFound();

  const saldo = lotes.reduce((s, l) => s + l.quantidade, 0);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/estoque" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Estoque
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{produto.nome}</h1>
        <p className="text-sm text-neutral-500">
          {produto.categoria ?? "sem categoria"} · saldo{" "}
          <b className={saldo < 0 ? "text-red-600" : ""}>
            {saldo} {produto.unidade}
          </b>{" "}
          · mínimo {produto.estoque_minimo}
          {produto.controlado && " · controlado"}
        </p>
      </div>

      {/* Lotes */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Lotes</h2>
        {lotes.length === 0 ? (
          <p className="text-sm text-neutral-400">Sem lotes.</p>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Lote</th>
                  <th className="px-4 py-2 font-medium">Validade</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2 text-right font-medium">Custo un.</th>
                  {podeGerir && <th className="px-4 py-2 font-medium">Ajustar</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {lotes.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2">{l.codigo_lote ?? "—"}</td>
                    <td className="px-4 py-2 text-neutral-500">{l.validade ?? "—"}</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${l.quantidade < 0 ? "font-semibold text-red-600" : ""}`}
                    >
                      {l.quantidade} {produto.unidade}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                      R$ {l.custo_unitario.toFixed(2)}
                    </td>
                    {podeGerir && (
                      <td className="px-4 py-2">
                        <AjusteLote loteId={l.id} atual={l.quantidade} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Histórico */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Movimentações</h2>
        {historico.length === 0 ? (
          <p className="text-sm text-neutral-400">Sem movimentações.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {historico.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-lg bg-white px-4 py-2 ring-1 ring-black/5"
              >
                <span>
                  <span className="text-neutral-400">{m.criado_em.replace("T", " ")}</span>{" "}
                  · {MOTIVO_LABEL[m.motivo] ?? m.motivo}
                  {m.entrada_prontuario_id && (
                    <span className="ml-1 text-neutral-400">(atend. #{m.entrada_prontuario_id})</span>
                  )}
                </span>
                <span
                  className={`tabular-nums font-medium ${m.quantidade < 0 ? "text-red-600" : "text-emerald-700"}`}
                >
                  {m.quantidade > 0 ? "+" : ""}
                  {m.quantidade} {produto.unidade}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
