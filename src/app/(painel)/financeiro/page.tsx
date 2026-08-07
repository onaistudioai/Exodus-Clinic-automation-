import Link from "next/link";
import { requireAcao, podeFazer } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as financeiro from "@/server/financeiro.repo";
import type { Cobranca, Lancamento, IndicadoresFinanceiro } from "@/types/domain";
import { PageHeader, Stat, TableShell, Th, Td, Badge, EmptyState } from "@/components/ui";
import { AnimatedMoney } from "@/components/AnimatedNumber";
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

  const cards: { label: string; n: number; sub?: string; tone?: "positive" | "negative" | "warning" }[] = [
    { label: "Caixa hoje", n: ind.caixa_dia, tone: ind.caixa_dia < 0 ? "negative" : undefined },
    { label: "Caixa do mês", n: ind.caixa_mes, tone: ind.caixa_mes < 0 ? "negative" : undefined },
    { label: "A receber", n: ind.a_receber },
    {
      label: "Inadimplência",
      n: ind.inadimplencia_valor,
      sub: `${Math.round(ind.inadimplencia_pct * 100)}%`,
      tone: ind.inadimplencia_valor > 0 ? "warning" : undefined,
    },
    { label: "Faturamento do mês", n: ind.faturamento_mes, tone: "positive" },
    { label: "Ticket médio", n: ind.ticket_medio },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Financeiro"
        subtitle="Caixa, recebíveis e inadimplência. Cobrança automática a cada atendimento."
      >
        <Link href="/financeiro/relatorio" className="text-sm text-ink-500 transition hover:text-brand-700">
          Margem por procedimento
        </Link>
        {podeGerir && (
          <Link href="/financeiro/precos" className="text-sm text-ink-500 transition hover:text-brand-700">
            Tabela de preços
          </Link>
        )}
      </PageHeader>

      {/* Indicadores */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Stat
            key={c.label}
            label={c.label}
            value={<AnimatedMoney value={c.n} />}
            sub={c.sub ? `(${c.sub})` : undefined}
            tone={c.tone}
          />
        ))}
      </section>

      {/* Inadimplentes (destaque) */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-700">
          Inadimplentes{" "}
          {inadimplentes.length > 0 && (
            <span className="text-ink-400">({inadimplentes.length})</span>
          )}
        </h2>
        {inadimplentes.length === 0 ? (
          <p className="rounded-card bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
            ✓ Nenhuma cobrança vencida em aberto.
          </p>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Paciente</Th>
                <Th>Vencimento</Th>
                <Th className="text-right">Atraso</Th>
                <Th className="text-right">Valor</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {inadimplentes.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium text-ink-900">{c.paciente_nome}</Td>
                  <Td className="text-ink-500">{c.vencimento}</Td>
                  <Td className="text-right tabular-nums text-amber-700">{c.dias_atraso}d</Td>
                  <Td className="text-right tabular-nums">{brl(c.valor)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
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
        <h2 className="mb-3 text-sm font-medium text-ink-700">Últimos lançamentos (mês)</h2>
        {lancamentos.length === 0 ? (
          <EmptyState>Nenhum lançamento neste mês.</EmptyState>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Tipo</Th>
                <Th>Categoria</Th>
                <Th>Descrição</Th>
                <Th className="text-right">Valor</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lancamentos.map((l) => (
                <tr key={l.id}>
                  <Td className="text-ink-500">{l.criado_em.slice(0, 10)}</Td>
                  <Td>
                    <Badge tone={l.tipo === "receita" ? "positive" : "negative"}>{l.tipo}</Badge>
                  </Td>
                  <Td className="text-ink-500">{l.categoria ?? "—"}</Td>
                  <Td className="text-ink-500">{l.descricao ?? "—"}</Td>
                  <Td
                    className={`text-right tabular-nums ${
                      l.tipo === "receita" ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {l.tipo === "despesa" ? "−" : "+"}
                    {brl(l.valor)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <div className="mt-3">
          <a
            href="/financeiro/export"
            className="text-sm text-brand-700 underline-offset-2 hover:underline"
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
      <h2 className="mb-3 text-sm font-medium text-ink-700">
        Contas a receber <span className="text-ink-400">({abertas.length})</span>
      </h2>
      <TableShell>
        <thead>
          <tr>
            <Th>Paciente</Th>
            <Th>Tipo</Th>
            <Th>Vencimento</Th>
            <Th className="text-right">Valor</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {abertas.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium text-ink-900">{c.paciente_nome}</Td>
              <Td className="text-ink-500">{c.tipo_atendimento ?? "—"}</Td>
              <Td className="text-ink-500">{c.vencimento}</Td>
              <Td className="text-right tabular-nums">{brl(c.valor)}</Td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </section>
  );
}
