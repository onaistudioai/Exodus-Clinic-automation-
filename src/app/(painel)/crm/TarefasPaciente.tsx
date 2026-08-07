"use client";

import { useActionState } from "react";
import {
  criarTarefaAction,
  concluirTarefaAction,
  marcarContatoAction,
  type TarefaState,
} from "./actions";
import type { TarefaCrm } from "@/types/domain";

const INICIAL: TarefaState = { ok: true };

export default function TarefasPaciente({
  pacienteId,
  tarefas,
  podeGerir,
}: {
  pacienteId: number;
  tarefas: TarefaCrm[];
  podeGerir: boolean;
}) {
  const [criarState, criar, criarPending] = useActionState(criarTarefaAction, INICIAL);
  const [, concluir] = useActionState(concluirTarefaAction, INICIAL);
  const [contatoState, contato, contatoPending] = useActionState(marcarContatoAction, INICIAL);

  const abertas = tarefas.filter((t) => t.status === "aberta");
  const feitas = tarefas.filter((t) => t.status === "concluida");

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-700">Tarefas de follow-up</h2>
        {podeGerir && (
          <form action={contato} className="flex items-center gap-1">
            <input type="hidden" name="paciente_id" value={pacienteId} />
            <input
              name="nota"
              placeholder="registrar contato…"
              className="w-32 rounded border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-neutral-900"
            />
            <button
              disabled={contatoPending}
              className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200 disabled:opacity-50"
            >
              ✓ contato
            </button>
          </form>
        )}
      </div>

      {/* Abertas */}
      {abertas.length === 0 ? (
        <p className="text-sm text-neutral-400">nenhuma tarefa aberta</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {abertas.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2">
              <div>
                <span className="text-neutral-800">{t.titulo}</span>
                {t.vencimento && <span className="ml-2 text-xs text-neutral-400">venc. {t.vencimento}</span>}
                {t.descricao && <div className="text-xs text-neutral-500">{t.descricao}</div>}
              </div>
              {podeGerir && (
                <form action={concluir}>
                  <input type="hidden" name="paciente_id" value={pacienteId} />
                  <input type="hidden" name="tarefa_id" value={t.id} />
                  <button className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-emerald-600 hover:text-emerald-700">
                    concluir
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Nova tarefa */}
      {podeGerir && (
        <form action={criar} className="mt-4 space-y-2 border-t border-neutral-100 pt-3">
          <input type="hidden" name="paciente_id" value={pacienteId} />
          <div className="flex gap-2">
            <input
              name="titulo"
              placeholder="nova tarefa (ex: ligar sobre retorno)"
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
            />
            <input
              type="date"
              name="vencimento"
              className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-600 outline-none focus:border-neutral-900"
            />
            <button
              disabled={criarPending}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {criarPending ? "…" : "Adicionar"}
            </button>
          </div>
          {(criarState.erro || contatoState.erro) && (
            <p className="text-xs text-rose-700">{criarState.erro ?? contatoState.erro}</p>
          )}
        </form>
      )}

      {/* Concluídas (histórico curto) */}
      {feitas.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-neutral-400">
            {feitas.length} concluída(s)
          </summary>
          <ul className="mt-1 space-y-1 text-xs text-neutral-500">
            {feitas.slice(0, 10).map((t) => (
              <li key={t.id} className="flex justify-between">
                <span className="line-through">{t.titulo}</span>
                <span>{t.concluida_em?.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
