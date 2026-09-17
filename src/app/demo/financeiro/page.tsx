"use client";

import { useState } from "react";
import { PageHeader, Card, Stat, TableShell, Th, Td, Badge } from "@/components/ui";
import { BarMini, StackBar } from "../_charts";
import { Tabs } from "../_tabs";
import {
  FINANCEIRO, FINANCEIRO2, COBRANCAS2, CONTATO_DIVIDA, FATURAMENTO_DIA,
  RESUMO_PERIODO, GASTOS_MATERIAIS, BRL, BRL2, pct,
} from "../_mock";

function Faturamento() {
  const [per, setPer] = useState<"dia" | "semana" | "mes">("mes");
  const r = RESUMO_PERIODO[per];
  return (
    <div className="space-y-5">
      <div className="inline-flex gap-1 rounded-lg bg-surface p-1 shadow-card">
        {(["dia", "semana", "mes"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPer(p)}
            className={per === p ? "rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-md px-3 py-1 text-xs font-medium text-ink-500"}
          >
            {p === "dia" ? "Dia" : p === "semana" ? "Semana" : "Mês"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Faturamento" value={BRL.format(r.faturamento)} tone="positive" />
        <Stat label="Gastos" value={BRL.format(r.gastos)} tone="warning" />
        <Stat label="Lucro" value={BRL.format(r.lucro)} tone="positive" />
        <Stat label="Leads" value={r.leads} />
      </div>
      <Card>
        <h3 className="mb-4 text-sm font-medium text-ink-500">Faturamento por dia da semana</h3>
        <BarMini data={FATURAMENTO_DIA} />
      </Card>
    </div>
  );
}

export default function DemoFinanceiro() {
  return (
    <div className="space-y-8">
      <PageHeader title="Financeiro" subtitle="Faturamento, cobranças com parcelas, gastos, custo por lead e análise de perdas." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Caixa do mês" value={BRL.format(FINANCEIRO.caixa_mes)} tone="positive" />
        <Stat label="A receber" value={BRL.format(FINANCEIRO.a_receber)} tone="warning" />
        <Stat label="Custo por lead" value={BRL.format(FINANCEIRO2.custo_por_lead)} />
        <Stat label="Margem" value={pct(FINANCEIRO2.margem)} tone="positive" />
      </div>

      <Tabs
        tabs={[
          { id: "fat", label: "Faturamento", content: <Faturamento /> },
          {
            id: "cob",
            label: "Cobranças",
            content: (
              <TableShell>
                <thead><tr><Th>Paciente</Th><Th>Tipo</Th><Th>Forma</Th><Th>Parcela</Th><Th>Venc.</Th><Th className="text-right">Valor</Th><Th>Contato</Th><Th>Status</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {COBRANCAS2.map((c, i) => (
                    <tr key={i}>
                      <Td className="font-medium text-ink-900">{c.paciente}</Td>
                      <Td className="text-ink-500">{c.tipo}</Td>
                      <Td className="text-ink-600">{c.forma}</Td>
                      <Td className="tabular-nums text-ink-500">{c.parcela.de > 1 ? `${c.parcela.n}/${c.parcela.de}` : "à vista"}</Td>
                      <Td className="tabular-nums text-ink-500">
                        {c.venc}{c.status === "aberta" && c.atraso > 0 && <span className="ml-1 text-rose-600">({c.atraso}d)</span>}
                      </Td>
                      <Td className="text-right font-medium tabular-nums">{BRL2.format(c.valor)}</Td>
                      <Td><Badge tone={CONTATO_DIVIDA[c.contato].tone}>{CONTATO_DIVIDA[c.contato].label}</Badge></Td>
                      <Td>{c.status === "paga" ? <Badge tone="positive">paga</Badge> : c.atraso > 0 ? <Badge tone="negative">vencida</Badge> : <Badge tone="warning">aberta</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            ),
          },
          {
            id: "gastos",
            label: "Gastos",
            content: (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <Stat label="Gastos do mês" value={BRL.format(FINANCEIRO2.gastos_mes)} tone="warning" />
                  <Stat label="Custo por lead" value={BRL.format(FINANCEIRO2.custo_por_lead)} />
                  <Stat label="Perda de capital" value={BRL.format(FINANCEIRO2.perdas_capital)} tone="negative" sub="inadimplência" />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-medium text-ink-500">Materiais comprados</h3>
                  <TableShell>
                    <thead><tr><Th>Item</Th><Th className="text-right">Qtd.</Th><Th>Data</Th><Th className="text-right">Valor</Th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {GASTOS_MATERIAIS.map((g, i) => (
                        <tr key={i}>
                          <Td className="font-medium text-ink-900">{g.item}</Td>
                          <Td className="text-right tabular-nums text-ink-600">{g.qtd}</Td>
                          <Td className="tabular-nums text-ink-500">{g.data}</Td>
                          <Td className="text-right font-medium tabular-nums">{BRL2.format(g.valor)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </div>
              </div>
            ),
          },
          {
            id: "analise",
            label: "Análise",
            content: (
              <Card>
                <h3 className="mb-4 text-sm font-medium text-ink-500">Contas a receber por idade da dívida (aging)</h3>
                <StackBar data={FINANCEIRO.aging} />
                <p className="mt-4 text-xs text-ink-400">
                  Perda de capital projetada em <strong className="text-rose-600">{BRL.format(FINANCEIRO2.perdas_capital)}</strong> se
                  a faixa 60+ dias não for recuperada. Priorize os contatos “sem contato”.
                </p>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
