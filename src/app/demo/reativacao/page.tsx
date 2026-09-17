"use client";

import { PageHeader, Card, Stat, TableShell, Th, Td, Badge } from "@/components/ui";
import { Tabs } from "../_tabs";
import { REATIVACAO, MENSAGENS_REATIVACAO, PROMOCOES, pct } from "../_mock";

const MSG_TONE: Record<string, "neutral" | "brand" | "warning" | "positive"> = {
  entregue: "neutral", lida: "brand", respondeu: "warning", agendou: "positive",
};

export default function DemoReativacao() {
  return (
    <div className="space-y-8">
      <PageHeader title="Reativação" subtitle="Recupera pacientes inativos com sequência automática no WhatsApp, promoções e acompanhamento por paciente." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Elegíveis" value={REATIVACAO.elegiveis} />
        <Stat label="Em sequência" value={REATIVACAO.em_sequencia} tone="warning" />
        <Stat label="Reativados" value={REATIVACAO.reativados} tone="positive" />
        <Stat label="Taxa de reativação" value={pct(REATIVACAO.taxa)} tone="positive" />
      </div>

      <Tabs
        tabs={[
          {
            id: "campanha",
            label: "Campanha",
            content: (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <h3 className="mb-4 text-sm font-medium text-ink-500">Cadência da campanha</h3>
                  <ol className="space-y-3">
                    {REATIVACAO.passos.map((p, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="grid h-8 w-12 flex-shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-semibold text-brand-700">{p.offset}</span>
                        <p className="rounded-lg bg-surface px-3 py-2 text-sm text-ink-700 shadow-card">“{p.template}”</p>
                      </li>
                    ))}
                  </ol>
                </Card>
                <div>
                  <h3 className="mb-3 text-sm font-medium text-ink-500">Pacientes inativos elegíveis</h3>
                  <TableShell>
                    <thead><tr><Th>Paciente</Th><Th>Último atend.</Th><Th className="text-right">Dias inativo</Th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {REATIVACAO.inativos.map((p, i) => (
                        <tr key={i}>
                          <Td className="font-medium text-ink-900">{p.nome}</Td>
                          <Td className="tabular-nums text-ink-500">{p.ultimo}</Td>
                          <Td className="text-right tabular-nums text-ink-700">{p.dias}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </div>
              </div>
            ),
          },
          {
            id: "mensagens",
            label: "Mensagens",
            content: (
              <TableShell>
                <thead><tr><Th>Paciente</Th><Th>Passo</Th><Th>Enviada em</Th><Th>Estado</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {MENSAGENS_REATIVACAO.map((m, i) => (
                    <tr key={i}>
                      <Td className="font-medium text-ink-900">{m.paciente}</Td>
                      <Td className="text-ink-600">{m.passo}</Td>
                      <Td className="tabular-nums text-ink-500">{m.enviadaEm}</Td>
                      <Td><Badge tone={MSG_TONE[m.status]}>{m.status}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            ),
          },
          {
            id: "promocoes",
            label: "Promoções",
            content: (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {PROMOCOES.map((p, i) => (
                  <Card key={i}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink-900">{p.titulo}</span>
                      <Badge tone="brand">{p.desconto}</Badge>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-ink-500">
                      <div className="flex justify-between"><span>Válida até</span><span className="tabular-nums text-ink-700">{p.validade}</span></div>
                      <div className="flex justify-between"><span>Enviados</span><span className="tabular-nums text-ink-700">{p.enviados}</span></div>
                      <div className="flex justify-between"><span>Conversão</span><span className="tabular-nums font-medium text-emerald-700">{pct(p.conversao)}</span></div>
                    </div>
                  </Card>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
