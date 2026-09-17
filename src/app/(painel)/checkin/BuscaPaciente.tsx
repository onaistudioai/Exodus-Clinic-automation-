"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { buscarPacientes, type BuscaState } from "./actions";
import CriarPaciente from "./CriarPaciente";
import FecharCheckin from "./FecharCheckin";

const INICIAL: BuscaState = { resultados: [], buscou: false, termo: "" };

export default function BuscaPaciente() {
  const [state, formAction, pending] = useActionState(buscarPacientes, INICIAL);
  const [criando, setCriando] = useState(false);
  // paciente selecionado p/ fechar o check-in (carimbo de identidade)
  const [selecionado, setSelecionado] = useState<{ id: number; nome: string } | null>(null);

  // O termo buscado vira pré-preenchimento: se for só dígitos, é CPF; senão, nome.
  const termoSoDigitos = state.termo.replace(/\D/g, "");
  const ehCpf = /^\d{11}$/.test(termoSoDigitos);

  if (selecionado) {
    return (
      <FecharCheckin
        pacienteId={selecionado.id}
        pacienteNome={selecionado.nome}
        onVoltar={() => setSelecionado(null)}
      />
    );
  }

  if (criando) {
    return (
      <CriarPaciente
        nomeInicial={ehCpf ? "" : state.termo}
        cpfInicial={ehCpf ? termoSoDigitos : ""}
        onCancelar={() => setCriando(false)}
        onCheckin={(id, nome) => {
          setCriando(false);
          setSelecionado({ id, nome });
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-2">
        <label className="block text-sm font-medium text-neutral-700">
          Buscar paciente
        </label>
        <div className="flex gap-2">
          <input
            name="termo"
            defaultValue={state.termo}
            placeholder="nome ou CPF"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {pending ? "Buscando…" : "🔍 Buscar"}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          digite ao menos 3 letras OU um CPF p/ buscar
        </p>
      </form>

      {state.erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.erro}
        </p>
      )}

      {state.buscou && (
        <section className="space-y-3">
          {state.resultados.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Nenhum paciente encontrado para “{state.termo}”.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
              {state.resultados.map((r) => (
                <li key={r.id} className="flex items-center justify-between p-4">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      {r.nome_completo}
                      {/* idade calculada — bate na hora com a pessoa (falha #3) */}
                      <span className="text-sm font-normal text-neutral-500">
                        {r.idade} anos
                      </span>
                      {r.e_menor && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                          ⚠ menor
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-neutral-500">
                      {r.cpf_last4 ? `CPF …-${r.cpf_last4}` : "(sem CPF)"} ·{" "}
                      último atend.: {r.ultimo_atendimento ?? "nunca"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/pacientes/${r.id}`}
                      className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 hover:border-neutral-900 hover:text-neutral-900"
                    >
                      ficha
                    </Link>
                    <button
                      type="button"
                      onClick={() => setSelecionado({ id: r.id, nome: r.nome_completo })}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900"
                    >
                      Selecionar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Trava anti-duplicata: "Criar novo" só DEPOIS de buscar, e abaixo dos resultados */}
          <div className="pt-2">
            <p className="mb-2 text-sm text-neutral-500">Nenhum destes?</p>
            <button
              onClick={() => setCriando(true)}
              disabled={!state.buscou}
              className="rounded-lg border border-dashed border-neutral-400 px-4 py-2 text-sm font-medium hover:border-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Criar novo paciente
            </button>
          </div>
        </section>
      )}

      {!state.buscou && (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-6 text-center">
          <button
            disabled
            className="cursor-not-allowed rounded-lg border border-dashed border-neutral-400 px-4 py-2 text-sm font-medium opacity-40"
            title="Faça uma busca antes de criar (anti-duplicata)"
          >
            + Criar novo paciente
          </button>
          <p className="mt-2 text-xs text-neutral-400">
            desabilitado até você buscar — evita ficha duplicada
          </p>
        </div>
      )}
    </div>
  );
}
