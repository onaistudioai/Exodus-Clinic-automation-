"use client";

import { Fragment, useMemo, useState } from "react";
import { PageHeader, Stat, TableShell, Th, Td, Badge, Card } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Tabs, ChipGroup } from "../_tabs";
import {
  AGENDA_MES, AGENDA_REF, FALTAS, FUTURAS, HISTORICO_PACIENTE,
  GRAVIDADES, TIPOS_TRATAMENTO, KPIS, pct, type Gravidade,
} from "../_mock";

const STATUS_TONE: Record<string, "positive" | "brand" | "warning" | "negative"> = {
  realizada: "positive", confirmada: "brand", pendente: "warning", falta: "negative",
};

function GravChip({ g }: { g: Gravidade }) {
  const info = GRAVIDADES[g];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-600">
      <span className={`h-2 w-2 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  );
}

/* ---------- Aba: Lista (filtros + histórico inline) ---------- */
function AgendaLista() {
  const [dia, setDia] = useState(AGENDA_REF.hoje);
  const [gravs, setGravs] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [soPrazo, setSoPrazo] = useState(false);
  const [soPrio, setSoPrio] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const eventos = useMemo(
    () =>
      AGENDA_MES.filter((e) => e.dia === dia)
        .filter((e) => (gravs.length ? gravs.includes(e.gravidade) : true))
        .filter((e) => (tipos.length ? tipos.includes(e.tipo) : true))
        .filter((e) => (soPrazo ? e.noPrazo : true))
        .filter((e) => (soPrio ? e.prioridade : true))
        .sort((a, b) => a.hora.localeCompare(b.hora)),
    [dia, gravs, tipos, soPrazo, soPrio]
  );

  const diasComEvento = [...new Set(AGENDA_MES.map((e) => e.dia))].sort((a, b) => a - b);

  return (
    <div className="space-y-5">
      {/* seletor de dia */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-ink-500">Dia:</span>
        {diasComEvento.map((d) => (
          <button
            key={d}
            onClick={() => setDia(d)}
            className={
              d === dia
                ? "rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white"
                : "rounded-lg bg-surface px-3 py-1 text-xs font-medium text-ink-600 shadow-card hover:text-brand-700"
            }
          >
            {String(d).padStart(2, "0")}/07
          </button>
        ))}
      </div>

      {/* filtros */}
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-ink-500">
          <Icon.Filtro className="h-4 w-4" /> Filtros
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Gravidade</div>
            <ChipGroup
              value={gravs}
              onChange={setGravs}
              options={Object.entries(GRAVIDADES).map(([v, i]) => ({ v, label: i.label }))}
            />
          </div>
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Tipo</div>
            <ChipGroup value={tipos} onChange={setTipos} options={TIPOS_TRATAMENTO.map((t) => ({ v: t, label: t }))} />
          </div>
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Marcadores</div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setSoPrazo((v) => !v)}
                className={soPrazo ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-600 shadow-card"}
              >
                No prazo
              </button>
              <button
                onClick={() => setSoPrio((v) => !v)}
                className={soPrio ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-600 shadow-card"}
              >
                Prioridade
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* lista */}
      <TableShell>
        <thead>
          <tr>
            <Th>Hora</Th><Th>Paciente</Th><Th>Tipo</Th><Th>Gravidade</Th><Th>Prof.</Th><Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {eventos.map((e) => (
            <Fragment key={`${e.hora}-${e.paciente}`}>
              <tr
                className="cursor-pointer"
                onClick={() => setAberto(aberto === e.paciente ? null : e.paciente)}
              >
                <Td className="font-medium tabular-nums text-ink-900">{e.hora}</Td>
                <Td className="font-medium text-ink-900">
                  <span className="inline-flex items-center gap-1.5">
                    {e.prioridade && <span title="prioridade" className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
                    {e.paciente}
                  </span>
                </Td>
                <Td className="text-ink-500">{e.tipo}</Td>
                <Td><GravChip g={e.gravidade} /></Td>
                <Td className="text-ink-500">{e.prof}</Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
                    {!e.noPrazo && <span className="text-[11px] text-amber-600">fora do prazo</span>}
                  </span>
                </Td>
              </tr>
              {aberto === e.paciente && (
                <tr>
                  <td colSpan={6} className="bg-brand-50/40 px-4 py-3">
                    <div className="text-xs font-medium text-ink-500">Histórico de {e.paciente}</div>
                    <ul className="mt-2 space-y-1">
                      {(HISTORICO_PACIENTE[e.paciente] ?? [{ data: "—", tipo: "Sem histórico anterior", prof: "", obs: "" }]).map((h, i) => (
                        <li key={i} className="flex flex-wrap gap-x-3 text-sm">
                          <span className="tabular-nums text-ink-500">{h.data}</span>
                          <span className="font-medium text-ink-800">{h.tipo}</span>
                          {h.prof && <span className="text-ink-400">· {h.prof}</span>}
                          {h.obs && <span className="text-ink-500">— {h.obs}</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {eventos.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-ink-400">Nenhum atendimento com esses filtros.</td></tr>
          )}
        </tbody>
      </TableShell>
    </div>
  );
}

/* ---------- Aba: Calendário do mês ---------- */
function Calendario() {
  const [sel, setSel] = useState<number | null>(AGENDA_REF.hoje);
  const primeiroDiaSemana = new Date(AGENDA_REF.ano, AGENDA_REF.mes, 1).getDay();
  const diasNoMes = new Date(AGENDA_REF.ano, AGENDA_REF.mes + 1, 0).getDate();

  const porDia = useMemo(() => {
    const m: Record<number, typeof AGENDA_MES> = {};
    for (const e of AGENDA_MES) (m[e.dia] ??= []).push(e);
    return m;
  }, []);

  const celulas: (number | null)[] = [
    ...Array(primeiroDiaSemana).fill(null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ];
  const selEventos = sel ? (porDia[sel] ?? []) : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold text-ink-900">Julho 2026</span>
          <div className="flex gap-1 text-ink-400">
            <Icon.ChevronLeft className="h-5 w-5" /><Icon.ChevronRight className="h-5 w-5" />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-400">
          {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <div key={i} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {celulas.map((d, i) => {
            if (d === null) return <div key={i} />;
            const evs = porDia[d] ?? [];
            const temPrio = evs.some((e) => e.prioridade);
            const hoje = d === AGENDA_REF.hoje;
            return (
              <button
                key={i}
                onClick={() => setSel(d)}
                className={`relative aspect-square rounded-lg p-1 text-sm transition ${
                  d === sel ? "bg-brand-600 text-white" : hoje ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-brand-600/10"
                }`}
              >
                <span className="tabular-nums">{d}</span>
                {evs.length > 0 && (
                  <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${temPrio ? "bg-rose-400" : d === sel ? "bg-white" : "bg-brand-500"}`} />
                    {evs.length > 2 && <span className={`h-1.5 w-1.5 rounded-full ${d === sel ? "bg-white/70" : "bg-brand-300"}`} />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      <div>
        <h3 className="mb-3 text-sm font-medium text-ink-500">
          {sel ? `Dia ${String(sel).padStart(2, "0")}/07 · ${selEventos.length} atendimento(s)` : "Selecione um dia"}
        </h3>
        <div className="space-y-2">
          {selEventos.map((e, i) => (
            <div key={i} className="rounded-card bg-surface p-3 shadow-card">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink-900">{e.hora} · {e.paciente}</span>
                <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-ink-500">
                <span>{e.tipo}</span><GravChip g={e.gravidade} /><span>{e.prof}</span>
              </div>
            </div>
          ))}
          {selEventos.length === 0 && <p className="rounded-card px-4 py-6 text-center text-sm text-ink-400">Sem atendimentos nesse dia.</p>}
        </div>
      </div>
    </div>
  );
}

export default function DemoAgenda() {
  const hoje = AGENDA_MES.filter((e) => e.dia === AGENDA_REF.hoje);
  return (
    <div className="space-y-8">
      <PageHeader title="Agenda" subtitle="Confirmação D-1, lembrete D-0 anti no-show, calendário do mês e filtros por gravidade/tipo/prazo." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Agendados hoje" value={hoje.length} />
        <Stat label="Realizados" value={hoje.filter((a) => a.status === "realizada").length} tone="positive" />
        <Stat label="No-show" value={pct(KPIS.no_show_pct)} tone="positive" sub="↓" />
        <Stat label="Ocupação" value={pct(KPIS.ocupacao_pct)} />
      </div>

      <Tabs
        tabs={[
          { id: "lista", label: "Lista", content: <AgendaLista /> },
          { id: "cal", label: "Calendário", content: <Calendario /> },
          {
            id: "faltas",
            label: `Faltas (${FALTAS.length})`,
            content: (
              <TableShell>
                <thead><tr><Th>Paciente</Th><Th>Data</Th><Th>Serviço</Th><Th>Prof.</Th><Th>Tentativas de contato</Th><Th>Recontato</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {FALTAS.map((f, i) => (
                    <tr key={i}>
                      <Td className="font-medium text-ink-900">{f.paciente}</Td>
                      <Td className="tabular-nums text-ink-500">{f.data}</Td>
                      <Td className="text-ink-500">{f.servico}</Td>
                      <Td className="text-ink-500">{f.prof}</Td>
                      <Td className="tabular-nums">{f.tentativas}</Td>
                      <Td>{f.recontato ? <Badge tone="positive">feito</Badge> : <Badge tone="warning">pendente</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            ),
          },
          {
            id: "futuras",
            label: "Futuras",
            content: (
              <TableShell>
                <thead><tr><Th>Paciente</Th><Th>Data</Th><Th>Hora</Th><Th>Tipo</Th><Th>Prof.</Th><Th>Gravidade</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {FUTURAS.map((f, i) => (
                    <tr key={i}>
                      <Td className="font-medium text-ink-900">{f.paciente}</Td>
                      <Td className="tabular-nums text-ink-500">{f.data}</Td>
                      <Td className="tabular-nums text-ink-500">{f.hora}</Td>
                      <Td className="text-ink-500">{f.tipo}</Td>
                      <Td className="text-ink-500">{f.prof}</Td>
                      <Td><GravChip g={f.gravidade} /></Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            ),
          },
        ]}
      />
    </div>
  );
}
