"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ESTAGIOS_CRM,
  type ContagemEstagio,
  type EstagioCrm,
  type LinhaPipeline,
} from "@/types/domain";

export default function PipelinePacientes({
  contagem,
  linhas,
}: {
  contagem: ContagemEstagio[];
  linhas: LinhaPipeline[];
}) {
  const [estagio, setEstagio] = useState<EstagioCrm | null>(null);
  const [termo, setTermo] = useState("");

  const totalPorEstagio = useMemo(() => {
    const m = new Map<EstagioCrm, number>();
    for (const c of contagem) m.set(c.estagio, c.total);
    return m;
  }, [contagem]);
  const total = linhas.length;

  const filtradas = useMemo(() => {
    const t = termo.trim().toLowerCase();
    return linhas.filter(
      (l) =>
        (estagio === null || l.estagio === estagio) &&
        (t === "" || l.nome_completo.toLowerCase().includes(t))
    );
  }, [linhas, estagio, termo]);

  const meta = (e: EstagioCrm) => ESTAGIOS_CRM.find((x) => x.v === e)!;

  return (
    <div className="space-y-5">
      {/* Chips de estágio (contadores clicáveis = filtro) */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEstagio(null)}
          className={`rounded-full px-3 py-1 text-sm ring-1 ${
            estagio === null ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-600 ring-black/10"
          }`}
        >
          Todos <span className="tabular-nums opacity-70">({total})</span>
        </button>
        {ESTAGIOS_CRM.map((e) => (
          <button
            key={e.v}
            onClick={() => setEstagio(estagio === e.v ? null : e.v)}
            className={`rounded-full px-3 py-1 text-sm ring-1 ${
              estagio === e.v ? "bg-neutral-900 text-white ring-neutral-900" : `${e.cls}`
            }`}
          >
            {e.label} <span className="tabular-nums opacity-70">({totalPorEstagio.get(e.v) ?? 0})</span>
          </button>
        ))}
      </div>

      <input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="buscar paciente pelo nome…"
        className="w-full max-w-sm rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />

      {filtradas.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhum paciente neste filtro.</p>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Paciente</th>
                <th className="px-4 py-2 font-medium">Estágio</th>
                <th className="px-4 py-2 font-medium">Último atend.</th>
                <th className="px-4 py-2 text-right font-medium">Tarefas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtradas.map((l) => {
                const m = meta(l.estagio);
                return (
                  <tr key={l.paciente_id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2">
                      <Link href={`/crm/${l.paciente_id}`} className="font-medium text-neutral-900 hover:underline">
                        {l.nome_completo}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${m.cls}`}>{m.label}</span>
                    </td>
                    <td className="px-4 py-2 text-neutral-500">
                      {l.ultimo_atendimento ?? "nunca"}
                      {l.dias_inativo != null && l.dias_inativo > 0 && (
                        <span className="text-neutral-400"> · {l.dias_inativo}d</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700">
                      {l.tarefas_abertas > 0 ? l.tarefas_abertas : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
