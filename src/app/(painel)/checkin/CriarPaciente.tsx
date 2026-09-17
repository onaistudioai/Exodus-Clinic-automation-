"use client";

import { useActionState, useState } from "react";
import { criarPaciente, type CriarState } from "./criar-actions";
import { calcularIdade, validarNascimento } from "@/lib/idade";

const HOJE_ISO = new Date().toISOString().slice(0, 10);

export default function CriarPaciente({
  nomeInicial = "",
  cpfInicial = "",
  onCancelar,
  onCheckin,
}: {
  nomeInicial?: string;
  cpfInicial?: string;
  onCancelar?: () => void;
  onCheckin?: (pacienteId: number, nome: string) => void;
}) {
  const [state, formAction, pending] = useActionState<CriarState, FormData>(
    criarPaciente,
    {}
  );
  const [nasc, setNasc] = useState("");

  // idade calculada ao vivo p/ conferência imediata (falha #3)
  const validacao = nasc ? validarNascimento(nasc) : null;
  const idade = nasc && validacao?.ok ? calcularIdade(nasc) : null;
  const menor = idade !== null && idade < 18;

  const erroCampo = (campo: string) =>
    state.campo === campo ? "border-red-500" : "border-neutral-300";

  if (state.ok) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-6 ring-1 ring-emerald-200">
        <p className="font-medium text-emerald-800">
          ✓ Paciente <b>{state.nome}</b> criado (#{state.pacienteId}).
        </p>
        <p className="mt-1 text-sm text-emerald-700">
          Já aparece na busca da clínica. Próximo: fechar o check-in (carimbar identidade).
        </p>
        <div className="mt-3 flex gap-2">
          {onCheckin && state.pacienteId && (
            <button
              type="button"
              onClick={() => onCheckin(state.pacienteId!, state.nome ?? "")}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Iniciar check-in →
            </button>
          )}
          {onCancelar && (
            <button
              type="button"
              onClick={onCancelar}
              className="rounded-lg border border-emerald-300 px-3 py-1.5 text-sm hover:border-emerald-700"
            >
              ← voltar à busca
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-2xl bg-white p-6 ring-1 ring-black/5">
      <h3 className="font-medium">Novo paciente</h3>

      <label className="block text-sm">
        <span className="text-neutral-700">Nome completo</span>
        <input
          name="nome"
          defaultValue={nomeInicial}
          required
          className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erroCampo("nome")}`}
        />
      </label>

      <label className="block text-sm">
        <span className="text-neutral-700">Data de nascimento</span>
        <div className="mt-1 flex items-center gap-3">
          <input
            name="data_nascimento"
            type="date"
            required
            max={HOJE_ISO}
            value={nasc}
            onChange={(e) => setNasc(e.target.value)}
            className={`rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erroCampo("data_nascimento")}`}
          />
          {idade !== null && (
            <span className="text-sm text-neutral-600">
              ({idade} anos){menor && <span className="ml-1 text-amber-700">⚠ menor</span>}
            </span>
          )}
          {nasc && validacao && !validacao.ok && (
            <span className="text-sm text-red-600">{validacao.erro}</span>
          )}
        </div>
      </label>

      <label className="block text-sm">
        <span className="text-neutral-700">CPF (opcional)</span>
        <input
          name="cpf"
          defaultValue={cpfInicial}
          inputMode="numeric"
          placeholder="só números"
          className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erroCampo("cpf")}`}
        />
        <span className="mt-1 block text-xs text-neutral-400">
          guardado só como hash + 2 últimos dígitos; desambigua, não autentica.
        </span>
      </label>

      {/* Bloco do responsável — só quando menor (falha #6) */}
      {menor && (
        <fieldset className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <legend className="px-1 text-sm font-medium text-amber-800">
            Paciente menor — responsável obrigatório
          </legend>

          <label className="block text-sm">
            <span className="text-neutral-700">Nome do responsável</span>
            <input
              name="resp_nome"
              className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erroCampo("resp_nome")}`}
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1 text-sm">
              <span className="text-neutral-700">Nascimento do responsável</span>
              <input
                name="resp_data_nascimento"
                type="date"
                max={HOJE_ISO}
                className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erroCampo("resp_data_nascimento")}`}
              />
            </label>
            <label className="block flex-1 text-sm">
              <span className="text-neutral-700">Relação</span>
              <select
                name="resp_relacao"
                defaultValue=""
                className={`mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:border-neutral-900 ${erroCampo("resp_relacao")}`}
              >
                <option value="" disabled>
                  selecione…
                </option>
                <option value="mae">Mãe</option>
                <option value="pai">Pai</option>
                <option value="tutor">Tutor(a)</option>
                <option value="outro">Outro</option>
              </select>
            </label>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="consentimento" className="mt-1" />
            <span className="text-neutral-700">
              O responsável autorizou o cadastro e o tratamento dos dados do menor
              (consentimento LGPD). Registrado com quem confirmou e quando.
            </span>
          </label>
        </fieldset>
      )}

      {state.erro && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.erro}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "Salvando…" : "Criar paciente"}
        </button>
        {onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:border-neutral-900"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
