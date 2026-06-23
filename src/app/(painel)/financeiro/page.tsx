import Link from "next/link";
import { requireAcao, podeFazer } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as financeiro from "@/server/financeiro.repo";
import type { Cobranca, Lancamento, IndicadoresFinanceiro } from "@/types/domain";
import GerenciarFinanceiro from "./GerenciarFinanceiro";

export const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const VAZIO: IndicadoresFinanceiro = {
  caixa_dia: 0,
  caixa_mes: 0,
  a_receber: 0,
  inadimplencia_valor: 0,
  inadimplencia_pct: 0,
  faturamento_mes: 0,
  ticket_medio: 0,
};

export default async function FinanceiroPage() {
  await requireAcao("ver_financeiro");
  const session = await verifySession();
  const podeGerir = podeFazer(session.papel, "gerir_financeiro");

  let ind = VAZIO;
  let abertas: Cobranca[] = [];
  let inadimplentes: Cobranca[] = [];
  let lancamentos: Lancamento[] = [];
  try {
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const fimMes = hoje.toISOString().slice(0, 10);
    [ind, abertas, inadimplentes, lancamentos] = await withTenantReadOnly(
      session.clinica_id,
      async (tx) =>
        [
          await financeiro.indicadores(tx),
          await financeiro.listarCobrancas(tx, { status: "aberta", limite: 100 }),
          await financeiro.listarInadimplentes(tx),
          await financeiro.lancamentosPeriodo(tx, inicioMes, fimMes, 30),
        ] as const
    );
  } catch {
    // tabelas ainda não migradas: estado vazio em vez de quebrar a página.
  }

  const cards = [
    { label: "Caixa hoje", valor: brl(ind.caixa_dia), cls: ind.caixa_dia < 0 ? "text-red-600" : "" },
    { label: "Caixa do mês", valor: brl(ind.caixa_mes), cls: ind.caixa_mes < 0 ? "text-red-600" : "" },
    { label: "A receber", valor: brl(ind.a_receber) },
    {
      label: "Inadimplência",
      valor: brl(ind.inadimplencia_valor),
      sub: `${Math.round(ind.inadimplencia_pct * 100)}%`,
      cls: ind.inadimplencia_valor > 0 ? "text-amber-700" : "",
    },
    { label: "Faturamento do mês", valor: brl(ind.faturamento_mes), cls: "text-emerald-700" },
    { label: "Ticket médio", valor: brl(ind.ticket_medio) },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">Financeiro</h1>
          <p className="text-sm text-neutral-500">
            Caixa, recebíveis e inadimplência. Cobrança automática a cada atendimento.
          </p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href="/financeiro/relatorio" className="text-neutral-600 hover:text-neutral-900">
            Margem por procedimento
          </Link>
          {podeGerir && (
            <Link href="/financeiro/precos" className="text-neutral-600 hover:text-neutral-900">
              Tabela de preços
            </Link>
          )}
        </nav>
      </div>

      {/* Indicadores */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-white p-4 ring-1 ring-black/5">
            <div className="text-xs text-neutral-500">{c.label}</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${c.cls ?? ""}`}>
              {c.valor}
              {"sub" in c && c.sub && (
                <span className="ml-1 text-xs font-normal text-neutral-400">({c.sub})</span>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* Inadimplentes (destaque) */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-700">
          Inadimplentes{" "}
          {inadimplentes.length > 0 && (
            <span className="text-neutral-400">({inadimplentes.length})</span>
          )}
        </h2>
        {inadimplentes.length === 0 ? (
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
            ✓ Nenhuma cobrança vencida em aberto.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Paciente</th>
                  <th className="px-4 py-2 font-medium">Vencimento</th>
                  <th className="px-4 py-2 text-right font-medium">Atraso</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {inadimplentes.map((c) => (
                  <tr key={c.id} className="bg-amber-50/40">
                    <td className="px-4 py-2 font-medium text-neutral-900">{c.paciente_nome}</td>
                    <td className="px-4 py-2 text-neutral-500">{c.vencimento}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-700">
                      {c.dias_atraso}d
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{brl(c.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recebíveis em aberto + gestão (pagar/cancelar/lançar) */}
      {podeGerir ? (
        <GerenciarFinanceiro abertas={abertas} />
      ) : (
        <ReceberReadOnly abertas={abertas} />
      )}

      {/* Últimos lançamentos do caixa */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-700">Últimos lançamentos (mês)</h2>
        {lancamentos.length === 0 ? (
          <p className="text-sm text-neutral-400">Nenhum lançamento neste mês.</p>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Tipo</th>
                  <th className="px-4 py-2 font-medium">Categoria</th>
                  <th className="px-4 py-2 font-medium">Descrição</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {lancamentos.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 text-neutral-500">{l.criado_em.slice(0, 10)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          l.tipo === "receita"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {l.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-neutral-500">{l.categoria ?? "—"}</td>
                    <td className="px-4 py-2 text-neutral-500">{l.descricao ?? "—"}</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        l.tipo === "receita" ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {l.tipo === "despesa" ? "−" : "+"}
                      {brl(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3">
          <a
            href="/financeiro/export"
            className="text-sm text-neutral-600 underline hover:text-neutral-900"
          >
            Exportar caixa do mês (CSV)
          </a>
        </div>
      </section>
    </div>
  );
}

/** Recebíveis em aberto sem ações (papel só-leitura: médico). */
function ReceberReadOnly({ abertas }: { abertas: Cobranca[] }) {
  if (abertas.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-neutral-700">
        Contas a receber <span className="text-neutral-400">({abertas.length})</span>
      </h2>
      <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Paciente</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Vencimento</th>
              <th className="px-4 py-2 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {abertas.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2 font-medium text-neutral-900">{c.paciente_nome}</td>
                <td className="px-4 py-2 text-neutral-500">{c.tipo_atendimento ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-500">{c.vencimento}</td>
                <td className="px-4 py-2 text-right tabular-nums">{brl(c.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
