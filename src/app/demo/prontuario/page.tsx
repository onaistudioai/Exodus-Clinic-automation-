"use client";

import { useState } from "react";
import { PageHeader, Card, Badge, TableShell, Th, Td, btn } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Tabs } from "../_tabs";
import {
  PRONTUARIO_PACIENTES, QUEIXAS, PRONTUARIO,
  GRAVIDADES, GRAVIDADE_ORDEM, type Gravidade,
} from "../_mock";

/* Aba: pacientes com gravidade que o médico alterna clicando */
function Pacientes() {
  const [estados, setEstados] = useState<Record<number, Gravidade>>(
    Object.fromEntries(PRONTUARIO_PACIENTES.map((p) => [p.id, p.gravidade]))
  );
  const [aberto, setAberto] = useState<number | null>(PRONTUARIO_PACIENTES[0]?.id ?? null);

  function ciclar(id: number) {
    setEstados((prev) => {
      const atual = prev[id];
      const prox = GRAVIDADE_ORDEM[(GRAVIDADE_ORDEM.indexOf(atual) + 1) % GRAVIDADE_ORDEM.length];
      return { ...prev, [id]: prox };
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-400">
        Clique na etiqueta de gravidade para o médico alterar o estado do paciente.
      </p>
      {PRONTUARIO_PACIENTES.map((p) => {
        const g = estados[p.id];
        const info = GRAVIDADES[g];
        const open = aberto === p.id;
        return (
          <Card key={p.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button className="flex items-center gap-3 text-left" onClick={() => setAberto(open ? null : p.id)}>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 font-semibold text-brand-700">
                  {p.nome.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </span>
                <span>
                  <span className="block font-semibold text-ink-900">{p.nome}</span>
                  <span className="block text-xs text-ink-400">última evolução {p.ultima} · {p.prof}</span>
                </span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => ciclar(p.id)}
                  title="Alterar gravidade"
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${info.chip}`}
                >
                  <span className={`h-2 w-2 rounded-full ${info.dot}`} />
                  {info.label}
                </button>
              </div>
            </div>

            {open && (
              <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Resumo clínico</div>
                  <p className="text-sm text-ink-700">{p.resumo}</p>
                  {/* Marcações de gravidade (o médico escolhe o estado) */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {GRAVIDADE_ORDEM.map((gr) => (
                      <button
                        key={gr}
                        onClick={() => setEstados((prev) => ({ ...prev, [p.id]: gr }))}
                        className={
                          g === gr
                            ? `rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ${GRAVIDADES[gr].chip}`
                            : "rounded-lg bg-surface px-2.5 py-1 text-xs font-medium text-ink-500 shadow-card hover:text-ink-800"
                        }
                      >
                        {GRAVIDADES[gr].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-row gap-2 sm:flex-col">
                  <button className={btn.secondary}><Icon.Relatorio className="h-4 w-4" /> Relatório</button>
                  <button className={btn.secondary}><Icon.Editar className="h-4 w-4" /> Alterar</button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default function DemoProntuario() {
  return (
    <div className="space-y-8">
      <PageHeader title="Prontuário" subtitle="Estados de gravidade, evoluções, queixas do WhatsApp e trilha de auditoria de acesso." />

      <Card className="flex items-start gap-3 border-l-4 border-l-brand-500 bg-brand-50/40">
        <Icon.Auditoria className="mt-0.5 h-5 w-5 text-brand-700" />
        <p className="text-sm text-ink-700">
          O texto clínico é protegido por papel: a recepção vê só <strong>etiquetas</strong>; o
          profissional altera o <strong>estado de gravidade</strong> e o registro completo. Todo acesso fica registrado.
        </p>
      </Card>

      <Tabs
        tabs={[
          { id: "pacientes", label: "Pacientes", content: <Pacientes /> },
          {
            id: "evolucoes",
            label: "Evoluções",
            content: (
              <TableShell>
                <thead><tr><Th>Paciente</Th><Th>Tipo</Th><Th>Prof.</Th><Th>Data</Th><Th>Retorno</Th><Th>Estado</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {PRONTUARIO.map((p, i) => (
                    <tr key={i}>
                      <Td className="font-medium text-ink-900">{p.paciente}</Td>
                      <Td>{p.tipo}</Td>
                      <Td className="text-ink-500">{p.prof}</Td>
                      <Td className="tabular-nums text-ink-500">{p.data}</Td>
                      <Td>{p.retorno ? <Badge tone="brand">sim</Badge> : <span className="text-ink-400">—</span>}</Td>
                      <Td>{p.estado === "finalizado" ? <Badge tone="positive">finalizado</Badge> : <Badge tone="warning">rascunho</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            ),
          },
          {
            id: "queixas",
            label: `Queixas (${QUEIXAS.filter((q) => !q.resolvida).length})`,
            content: (
              <div className="space-y-2">
                {QUEIXAS.map((q, i) => (
                  <Card key={i} className="flex items-start gap-3">
                    <span className={`mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg ${q.origem === "whatsapp" ? "bg-emerald-50 text-emerald-600" : "bg-brand-50 text-brand-700"}`}>
                      {q.origem === "whatsapp" ? <Icon.Whatsapp className="h-4 w-4" /> : <Icon.Prontuario className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink-900">{q.paciente}</span>
                        <span className="text-xs text-ink-400">via {q.origem === "whatsapp" ? "WhatsApp" : "consulta"} · {q.data}</span>
                        {q.resolvida ? <Badge tone="positive">resolvida</Badge> : <Badge tone="warning">aberta</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-ink-700">“{q.texto}”</p>
                    </div>
                  </Card>
                ))}
              </div>
            ),
          },
          {
            id: "resumo",
            label: "Resumo",
            content: (
              <div className="grid gap-4 sm:grid-cols-2">
                {PRONTUARIO_PACIENTES.map((p) => (
                  <Card key={p.id}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink-900">{p.nome}</span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${GRAVIDADES[p.gravidade].chip}`}>
                        <span className={`h-2 w-2 rounded-full ${GRAVIDADES[p.gravidade].dot}`} />
                        {GRAVIDADES[p.gravidade].label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-ink-600">{p.resumo}</p>
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
