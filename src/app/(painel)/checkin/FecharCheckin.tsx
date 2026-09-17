"use client";

import { useActionState, useEffect, useRef } from "react";
import { gerenciarCheckin, type CheckinState } from "./fechar-actions";

function fmtData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

/**
 * Fechamento do check-in: lista os agendamentos abertos do paciente selecionado e
 * deixa a recepção carimbar a identidade (liga paciente↔agendamento da Sofia).
 * Auto-carrega ao montar; cada agendamento aberto vira um botão de confirmação.
 */
export default function FecharCheckin({
  pacienteId,
  pacienteNome,
  onVoltar,
}: {
  pacienteId: number;
  pacienteNome: string;
  onVoltar?: () => void;
}) {
  const inicial: CheckinState = {
    pacienteId,
    pacienteNome,
    agendamentos: [],
    carregou: false,
  };
  const [state, formAction, pending] = useActionState(gerenciarCheckin, inicial);
  const loadRef = useRef<HTMLFormElement>(null);

  // carrega os agendamentos abertos assim que a tela abre (intent=carregar)
  useEffect(() => {
    loadRef.current?.requestSubmit();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">
          Check-in de <b>{pacienteNome}</b>
        </h3>
        {onVoltar && (
          <button
            onClick={onVoltar}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900"
          >
            ← voltar à busca
          </button>
        )}
      </div>

      {/* form oculto de carga inicial */}
      <form ref={loadRef} action={formAction} className="hidden">
        <input type="hidden" name="intent" value="carregar" />
        <input type="hidden" name="pacienteId" value={pacienteId} />
        <input type="hidden" name="pacienteNome" value={pacienteNome} />
      </form>

      {state.msg && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          ✓ {state.msg}
        </p>
      )}
      {state.erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.erro}</p>
      )}

      {!state.carregou && pending && (
        <p className="text-sm text-neutral-500">Carregando agendamentos…</p>
      )}

      {state.carregou && state.agendamentos.length === 0 && (
        <p className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          Nenhum agendamento aberto pra hoje/amanhã neste paciente.
          <br />
          (Encaixe sem agendamento ainda não é suportado nesta etapa.)
        </p>
      )}

      {state.agendamentos.length > 0 && (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
          {state.agendamentos.map((a) => {
            const confirmado = !!a.identidade_confirmada_em;
            const doOutro = a.paciente_id != null && a.paciente_id !== pacienteId;
            return (
              <li key={a.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium">
                    {fmtData(a.data_agendamento)} · {String(a.hora_agendamento).slice(0, 5)}
                  </div>
                  <div className="text-sm text-neutral-500">status: {a.status}</div>
                </div>

                {confirmado ? (
                  <span className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
                    ✓ identidade confirmada
                  </span>
                ) : doOutro ? (
                  <span
                    className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-800"
                    title="Este agendamento já está vinculado a outro paciente — resolver fora do balcão (merge)."
                  >
                    ⚠ vinculado a outro paciente
                  </span>
                ) : (
                  <form action={formAction}>
                    <input type="hidden" name="intent" value="confirmar" />
                    <input type="hidden" name="agendamentoId" value={a.id} />
                    <input type="hidden" name="pacienteId" value={pacienteId} />
                    <input type="hidden" name="pacienteNome" value={pacienteNome} />
                    <button
                      type="submit"
                      disabled={pending}
                      className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {pending ? "Confirmando…" : "Confirmar identidade"}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
