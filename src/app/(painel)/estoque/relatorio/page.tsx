import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as estoque from "@/server/estoque.repo";
import type { CustoProcedimento } from "@/types/domain";

const TIPO_LABEL: Record<string, string> = {
  consulta: "Consulta",
  retorno: "Retorno",
  procedimento: "Procedimento",
  avaliacao: "Avaliação",
  limpeza: "Limpeza",
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function RelatorioPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; ate?: string }>;
}) {
  await requireAcao("ver_estoque");
  const session = await verifySession();
  const sp = await searchParams;
  const desde = sp.desde || isoDaysAgo(30);
  const ate = sp.ate || isoDaysAgo(0);

  let dados: CustoProcedimento[] = [];
  try {
    dados = await withTenantReadOnly(session.clinica_id, (tx) =>
      estoque.custoPorProcedimento(tx, desde, ate)
    );
  } catch {
    // tabelas não migradas
  }

  const total = dados.reduce((s, d) => s + d.custo_total, 0);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/estoque" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Estoque
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Custo de material por procedimento</h1>
        <p className="text-sm text-neutral-500">Soma do material consumido por tipo de atendimento.</p>
      </div>

      <form method="get" className="flex items-end gap-3">
        <label className="block text-sm">
          <span className="text-neutral-700">De</span>
          <input
            name="desde"
            type="date"
            defaultValue={desde}
            className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-700">Até</span>
          <input
            name="ate"
            type="date"
            defaultValue={ate}
            className="mt-1 block rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Filtrar
        </button>
      </form>

      {dados.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhum consumo no período.</p>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 text-right font-medium">Atendimentos</th>
                <th className="px-4 py-2 text-right font-medium">Custo total</th>
                <th className="px-4 py-2 text-right font-medium">Custo médio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {dados.map((d) => (
                <tr key={d.tipo_atendimento}>
                  <td className="px-4 py-2">{TIPO_LABEL[d.tipo_atendimento] ?? d.tipo_atendimento}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.n_atendimentos}</td>
                  <td className="px-4 py-2 text-right tabular-nums">R$ {d.custo_total.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-500">
                    R$ {d.custo_medio.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-neutral-50 font-medium">
              <tr>
                <td className="px-4 py-2">Total</td>
                <td />
                <td className="px-4 py-2 text-right tabular-nums">R$ {total.toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
