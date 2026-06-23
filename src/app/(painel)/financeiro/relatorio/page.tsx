import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as financeiro from "@/server/financeiro.repo";
import type { MargemProcedimento } from "@/types/domain";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function RelatorioMargemPage() {
  await requireAcao("ver_financeiro");
  const session = await verifySession();

  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
  const fimMes = hoje.toISOString().slice(0, 10);

  let margens: MargemProcedimento[] = [];
  try {
    margens = await withTenantReadOnly(session.clinica_id, (tx) =>
      financeiro.margemPorProcedimento(tx, inicioMes, fimMes)
    );
  } catch {
    // tabelas ainda não migradas.
  }

  const tot = margens.reduce(
    (a, m) => ({
      receita: a.receita + m.receita_total,
      custo: a.custo + m.custo_material,
      margem: a.margem + m.margem,
    }),
    { receita: 0, custo: 0, margem: 0 }
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/financeiro" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Financeiro
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Margem por procedimento</h1>
        <p className="text-sm text-neutral-500">
          Receita das cobranças − custo de material (do Estoque), no mês corrente.
        </p>
      </div>

      {margens.length === 0 ? (
        <p className="text-sm text-neutral-400">
          Sem cobranças no período. Cadastre preços e finalize atendimentos para ver a margem.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Procedimento</th>
                <th className="px-4 py-2 text-right font-medium">Cobranças</th>
                <th className="px-4 py-2 text-right font-medium">Receita</th>
                <th className="px-4 py-2 text-right font-medium">Custo material</th>
                <th className="px-4 py-2 text-right font-medium">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {margens.map((m) => (
                <tr key={m.tipo_atendimento}>
                  <td className="px-4 py-2 font-medium capitalize text-neutral-900">
                    {m.tipo_atendimento}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                    {m.n_cobrancas}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{brl(m.receita_total)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                    {brl(m.custo_material)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-semibold tabular-nums ${
                      m.margem < 0 ? "text-red-600" : "text-emerald-700"
                    }`}
                  >
                    {brl(m.margem)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-neutral-200 bg-neutral-50">
              <tr>
                <td className="px-4 py-2 font-medium">Total</td>
                <td />
                <td className="px-4 py-2 text-right tabular-nums">{brl(tot.receita)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                  {brl(tot.custo)}
                </td>
                <td
                  className={`px-4 py-2 text-right font-semibold tabular-nums ${
                    tot.margem < 0 ? "text-red-600" : "text-emerald-700"
                  }`}
                >
                  {brl(tot.margem)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
