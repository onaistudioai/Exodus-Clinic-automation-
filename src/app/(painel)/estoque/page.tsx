import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { permissoes } from "@/lib/rbac";
import { withTenantReadOnly } from "@/lib/tenant";
import * as estoque from "@/server/estoque.repo";
import type { AlertaEstoque, NivelProduto, Produto } from "@/types/domain";
import GerenciarEstoque from "./GerenciarEstoque";

const ALERTA_LABEL: Record<AlertaEstoque["tipo"], { txt: string; cls: string }> = {
  ruptura: { txt: "Estoque baixo", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  saldo_negativo: { txt: "Saldo negativo", cls: "bg-red-50 text-red-800 ring-red-200" },
  vencido: { txt: "Vencido", cls: "bg-red-50 text-red-800 ring-red-200" },
  validade_proxima: { txt: "Vence em breve", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
};

export default async function EstoquePage() {
  await requireAcao("ver_estoque");
  const session = await verifySession();
  const { pode } = await permissoes();
  const podeGerir = pode("gerir_estoque");
  const podeBom = pode("configurar_bom");

  let alertas: AlertaEstoque[] = [];
  let niveis: NivelProduto[] = [];
  let produtos: Produto[] = [];
  try {
    [alertas, niveis, produtos] = await withTenantReadOnly(session.clinica_id, async (tx) => [
      await estoque.listarAlertas(tx),
      await estoque.nivelPorProduto(tx),
      await estoque.listarProdutos(tx),
    ]);
  } catch {
    // tabelas ainda não migradas: mostra estado vazio em vez de quebrar a página.
  }

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">Estoque</h1>
          <p className="text-sm text-neutral-500">
            Materiais, lotes e validade. Baixa automática a cada atendimento.
          </p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href="/estoque/relatorio" className="text-neutral-600 hover:text-neutral-900">
            Custo por procedimento
          </Link>
          {podeBom && (
            <Link href="/estoque/bom" className="text-neutral-600 hover:text-neutral-900">
              Kits (BOM)
            </Link>
          )}
        </nav>
      </div>

      {/* Painel de alertas */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-700">
          Alertas {alertas.length > 0 && <span className="text-neutral-400">({alertas.length})</span>}
        </h2>
        {alertas.length === 0 ? (
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
            ✓ Nenhum alerta. Estoque dentro do mínimo e sem validade crítica.
          </p>
        ) : (
          <ul className="space-y-2">
            {alertas.map((a, i) => {
              const m = ALERTA_LABEL[a.tipo];
              return (
                <li
                  key={`${a.tipo}-${a.produto_id}-${a.lote_id ?? "x"}-${i}`}
                  className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm ring-1 ${m.cls}`}
                >
                  <span>
                    <b>{a.produto_nome}</b>{" "}
                    {a.tipo === "ruptura" && (
                      <>— {a.quantidade_total} {a.unidade} (mín. {a.estoque_minimo})</>
                    )}
                    {a.tipo === "saldo_negativo" && (
                      <>— saldo {a.quantidade_total} {a.unidade}</>
                    )}
                    {(a.tipo === "vencido" || a.tipo === "validade_proxima") && (
                      <>
                        — lote {a.codigo_lote ?? "s/ código"} ({a.quantidade_total} {a.unidade}),
                        {a.dias_para_vencer !== null && a.dias_para_vencer < 0
                          ? ` vencido há ${Math.abs(a.dias_para_vencer)}d`
                          : ` vence em ${a.dias_para_vencer}d`}{" "}
                        — {a.validade}
                      </>
                    )}
                  </span>
                  <span className="ml-3 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inherit">
                    {m.txt}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Níveis atuais */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Produtos</h2>
        {niveis.length === 0 ? (
          <p className="text-sm text-neutral-400">Nenhum produto cadastrado ainda.</p>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Produto</th>
                  <th className="px-4 py-2 font-medium">Categoria</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2 text-right font-medium">Mínimo</th>
                  <th className="px-4 py-2 font-medium">Próx. validade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {niveis.map((n) => (
                  <tr key={n.produto_id} className={n.abaixo_minimo ? "bg-amber-50/40" : ""}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/estoque/${n.produto_id}`}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {n.nome}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-neutral-500">{n.categoria ?? "—"}</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        n.quantidade_total < 0
                          ? "font-semibold text-red-600"
                          : n.abaixo_minimo
                            ? "font-semibold text-amber-700"
                            : ""
                      }`}
                    >
                      {n.quantidade_total} {n.unidade}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                      {n.estoque_minimo}
                    </td>
                    <td className="px-4 py-2 text-neutral-500">{n.proxima_validade ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Gestão (recepção/admin) */}
      {podeGerir && <GerenciarEstoque produtos={produtos} />}
    </div>
  );
}
