"use client";

import { useActionState, useState } from "react";
import { registrarAtendimento, type AtendimentoState } from "./actions";
import { RETORNO_DIAS, type EntradaProntuario, type AgendamentoResumo } from "@/types/domain";

interface PacienteFicha {
  id: number;
  nome_completo: string;
  data_nascimento: string;
  idade: number;
  e_menor: boolean;
  cpf_last4: string | null;
  status: string;
}

const TIPOS = ["consulta", "retorno", "procedimento", "avaliacao", "limpeza"] as const;

function fmtDataHora(iso: string | null): string {
  if (!iso) return "—";
  const [data, hora] = iso.split("T");
  const [a, m, d] = data.split("-");
  return `${d}/${m}/${a}${hora ? ` ${hora.slice(0, 5)}` : ""}`;
}

export default function ProntuarioPaciente({
  paciente,
  entradas,
  agendamentos,
  podeEscrever,
}: {
  paciente: PacienteFicha;
  entradas: EntradaProntuario[];
  agendamentos: AgendamentoResumo[];
  podeEscrever: boolean;
}) {
  const [state, formAction, pending] = useActionState<AtendimentoState, FormData>(
    registrarAtendimento,
    {}
  );
  const [escrevendo, setEscrevendo] = useState(false);
  const [corrigindo, setCorrigindo] = useState<number | null>(null);
  const [precisaRetorno, setPrecisaRetorno] = useState(false);

  // fecha o form a cada sucesso (entradaId muda) — a lista é revalidada no servidor.
  // Padrão React de "ajustar estado quando um valor muda entre renders": guarda o
  // valor anterior em state e corrige durante o render (setState no render é
  // suportado), em vez de setState dentro de useEffect (cascading render).
  const [ultimaEntradaId, setUltimaEntradaId] = useState(state.entradaId);
  if (state.ok && state.entradaId !== ultimaEntradaId) {
    setUltimaEntradaId(state.entradaId);
    setEscrevendo(false);
  }

  const aberto = escrevendo;

  const erroCampo = (campo: string) =>
    state.campo === campo ? "border-red-500" : "border-neutral-300";

  function abrirNovo(corrige: number | null) {
    setCorrigindo(corrige);
    setPrecisaRetorno(false);
    setEscrevendo(true);
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho do paciente */}
      <div className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
        <div className="flex items-center gap-2 text-xl font-semibold">
          {paciente.nome_completo}
          <span className="text-sm font-normal text-neutral-500">{paciente.idade} anos</span>
          {paciente.e_menor && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              ⚠ menor
            </span>
          )}
          {paciente.status !== "ativo" && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
              {paciente.status}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-neutral-500">
          nasc. {fmtDataHora(paciente.data_nascimento)} ·{" "}
          {paciente.cpf_last4 ? `CPF …-${paciente.cpf_last4}` : "(sem CPF)"}
        </div>
      </div>

      {/* Ação: novo atendimento */}
      {podeEscrever && !aberto && (
        <button
          type="button"
          onClick={() => abrirNovo(null)}
          className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white"
        >
          + Registrar atendimento
        </button>
      )}
      {!podeEscrever && (
        <p className="text-sm text-neutral-500">
          Seu papel pode <b>ler</b> o prontuário, mas não registrar atendimentos.
        </p>
      )}

      {state.ok && !aberto && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          ✓ Atendimento registrado (entrada #{state.entradaId}). A entrada é imutável; para
          corrigir, crie uma nova.
        </p>
      )}

      {/* Formulário */}
      {aberto && (
        <form
          action={formAction}
          className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-black/5"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-medium">
              {corrigindo ? `Corrigir atendimento (nova entrada → corrige #${corrigindo})` : "Novo atendimento"}
            </h3>
            <button
              type="button"
              onClick={() => setEscrevendo(false)}
              className="text-sm text-neutral-500 hover:text-neutral-900"
            >
              cancelar
            </button>
          </div>

          <input type="hidden" name="pacienteId" value={paciente.id} />
          {corrigindo && <input type="hidden" name="corrigeEntradaId" value={corrigindo} />}

          {agendamentos.length > 0 && (
            <label className="block text-sm">
              <span className="text-neutral-700">Vincular ao agendamento (marca “realizada”)</span>
              <select
                name="agendamentoId"
                defaultValue=""
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
              >
                <option value="">— sem vínculo —</option>
                {agendamentos.map((a) => (
                  <option key={a.id} value={a.id}>
                    {fmtDataHora(a.data_agendamento)} · {String(a.hora_agendamento).slice(0, 5)} ·{" "}
                    {a.status}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-sm">
            <span className="text-neutral-700">Texto clínico</span>
            <textarea
              name="texto_clinico"
              rows={4}
              required
              className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erroCampo("texto_clinico")}`}
            />
            <span className="mt-1 block text-xs text-neutral-400">
              Conteúdo clínico — nunca enviado a IA; visível só a médico/admin.
            </span>
          </label>

          <div className="flex flex-wrap gap-3">
            <label className="block text-sm">
              <span className="text-neutral-700">Tipo</span>
              <select
                name="tipo_atendimento"
                defaultValue=""
                className={`mt-1 rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erroCampo("tipo_atendimento")}`}
              >
                <option value="" disabled>
                  selecione…
                </option>
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-neutral-700">Precisa retorno?</span>
              <select
                name="precisa_retorno"
                value={precisaRetorno ? "sim" : "nao"}
                onChange={(e) => setPrecisaRetorno(e.target.value === "sim")}
                className="mt-1 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
              >
                <option value="nao">Não</option>
                <option value="sim">Sim</option>
              </select>
            </label>

            {precisaRetorno && (
              <label className="block text-sm">
                <span className="text-neutral-700">Em quantos dias</span>
                <select
                  name="retorno_em_dias"
                  defaultValue=""
                  className={`mt-1 rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erroCampo("retorno_em_dias")}`}
                >
                  <option value="" disabled>
                    selecione…
                  </option>
                  {RETORNO_DIAS.map((d) => (
                    <option key={d} value={d}>
                      {d} dias
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="block text-sm">
            <span className="text-neutral-700">Orientações ao paciente (opcional)</span>
            <textarea
              name="orientacoes_paciente"
              rows={2}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
            />
          </label>

          {state.erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.erro}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {pending ? "Salvando…" : "Finalizar atendimento"}
          </button>
        </form>
      )}

      {/* Histórico */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">
          Histórico clínico ({entradas.length})
        </h2>
        {entradas.length === 0 && (
          <p className="text-sm text-neutral-500">Nenhuma entrada ainda.</p>
        )}
        <ul className="space-y-3">
          {entradas.map((e) => (
            <li key={e.id} className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">#{e.id}</span>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                    {e.estado}
                  </span>
                  {e.tipo_atendimento && (
                    <span className="text-neutral-500">{e.tipo_atendimento}</span>
                  )}
                  {e.expurgado && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                      expurgado (LGPD)
                    </span>
                  )}
                </div>
                <span className="text-xs text-neutral-400">
                  {fmtDataHora(e.finalizado_em ?? e.criado_em)}
                </span>
              </div>

              {e.expurgado ? (
                <p className="mt-2 text-sm italic text-neutral-400">
                  Conteúdo clínico expurgado (LGPD) — linha preservada para auditoria.
                </p>
              ) : (
                <>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">
                    {e.texto_clinico}
                  </p>
                  {e.orientacoes_paciente && (
                    <p className="mt-2 text-sm text-neutral-600">
                      <b>Orientações:</b> {e.orientacoes_paciente}
                    </p>
                  )}
                  <div className="mt-2 text-xs text-neutral-500">
                    {e.precisa_retorno
                      ? `retorno em ${e.retorno_em_dias} dias`
                      : "sem retorno"}
                  </div>
                </>
              )}

              {podeEscrever && e.estado === "finalizado" && !e.expurgado && (
                <button
                  type="button"
                  onClick={() => abrirNovo(e.id)}
                  className="mt-3 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:border-neutral-900"
                >
                  Corrigir (nova entrada)
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
