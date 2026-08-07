"use client";

import { PageHeader, Card, Stat, TableShell, Th, Td, Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Tabs } from "../_tabs";
import { ESTOQUE_ITENS, ESTADO_ITEM, ESTOQUE_ANALISE_MES_PASSADO, BRL } from "../_mock";

export default function DemoEstoque() {
  const criticos = ESTOQUE_ITENS.filter((i) => i.estado === "vencido" || i.quantidade < i.minimo);
  const usoMes = ESTOQUE_ITENS.reduce((s, i) => s + i.usoMes, 0);

  return (
    <div className="space-y-8">
      <PageHeader title="Estoque" subtitle="Lotes, validade, consumo por período, pacientes atendidos e projeção do próximo mês." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Itens cadastrados" value={ESTOQUE_ITENS.length} />
        <Stat label="Em alerta" value={criticos.length} tone={criticos.length ? "negative" : "positive"} />
        <Stat label="Consumo no mês" value={usoMes} />
        <Stat label="Categorias" value={new Set(ESTOQUE_ITENS.map((i) => i.categoria)).size} />
      </div>

      {/* Alertas */}
      {criticos.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {criticos.map((i, k) => (
            <div key={k} className="flex items-center gap-3 rounded-card bg-surface px-4 py-3 text-sm shadow-card">
              <Icon.Alerta className={`h-5 w-5 ${i.estado === "vencido" ? "text-rose-600" : "text-amber-600"}`} />
              <span>
                <strong className="text-ink-900">{i.nome}</strong>{" "}
                <span className="text-ink-500">
                  {i.estado === "vencido" ? `lote ${i.lote} vencido (${i.validade})` : `${i.quantidade} abaixo do mínimo (${i.minimo})`}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <Tabs
        tabs={[
          {
            id: "itens",
            label: "Itens",
            content: (
              <TableShell>
                <thead>
                  <tr>
                    <Th>Produto</Th><Th>Lote</Th><Th>Validade</Th><Th className="text-right">Qtd/mín</Th>
                    <Th>Estado</Th><Th className="text-right">Uso mês/sem/dia</Th><Th className="text-right">Pacientes</Th><Th className="text-right">Prev. próx.</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ESTOQUE_ITENS.map((it, i) => {
                    const baixo = it.quantidade < it.minimo;
                    return (
                      <tr key={i}>
                        <Td className="font-medium text-ink-900">{it.nome}<span className="block text-xs text-ink-400">{it.categoria}</span></Td>
                        <Td className="tabular-nums text-ink-500">{it.lote}</Td>
                        <Td className="tabular-nums text-ink-500">{it.validade}</Td>
                        <Td className="text-right tabular-nums">
                          <span className={baixo ? "font-semibold text-rose-600" : "text-ink-800"}>{it.quantidade}</span>
                          <span className="text-ink-400"> / {it.minimo}</span>
                        </Td>
                        <Td><Badge tone={ESTADO_ITEM[it.estado].tone}>{ESTADO_ITEM[it.estado].label}</Badge></Td>
                        <Td className="text-right tabular-nums text-ink-600">{it.usoMes} / {it.usoSemana} / {it.usoDia}</Td>
                        <Td className="text-right tabular-nums text-ink-600">{it.pacientes}</Td>
                        <Td className="text-right font-medium tabular-nums" style={{ color: "var(--hi)" }}>{it.estimativaProx}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableShell>
            ),
          },
          {
            id: "analise",
            label: "Análise do mês passado",
            content: (
              <div className="space-y-4">
                <TableShell>
                  <thead><tr><Th>Item</Th><Th className="text-right">Usado</Th><Th className="text-right">Comprado</Th><Th className="text-right">Sobra</Th><Th className="text-right">Custo</Th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {ESTOQUE_ANALISE_MES_PASSADO.map((a, i) => (
                      <tr key={i}>
                        <Td className="font-medium text-ink-900">{a.item}</Td>
                        <Td className="text-right tabular-nums text-ink-600">{a.usado}</Td>
                        <Td className="text-right tabular-nums text-ink-600">{a.comprado}</Td>
                        <Td className="text-right tabular-nums">
                          <span className={a.sobra < 0 ? "font-semibold text-rose-600" : "text-emerald-700"}>{a.sobra > 0 ? `+${a.sobra}` : a.sobra}</span>
                        </Td>
                        <Td className="text-right tabular-nums text-ink-700">{BRL.format(a.custo)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
                <p className="text-xs text-ink-400">
                  Sobra negativa = consumo maior que a compra (risco de ruptura). Ajuste a próxima ordem de compra pela coluna “previsão do próximo mês” na aba Itens.
                </p>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
