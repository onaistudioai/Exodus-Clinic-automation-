"use client";

import { useState, useTransition } from "react";
import {
  buscarParaMerge,
  carregarResumo,
  mesclarPacientes,
  type MergeResultado,
} from "./actions";
import type { ResultadoBusca, ResumoMerge } from "@/types/domain";

function fmtData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

/** Busca + seleção de um paciente para um dos lados do merge. */
function BuscaSlot({
  rotulo,
  cor,
  selecionado,
  onSelecionar,
  onTrocar,
}: {
  rotulo: string;
  cor: "emerald" | "amber";
  selecionado: ResumoMerge | null;
  onSelecionar: (id: number) => void;
  onTrocar: () => void;
}) {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [buscou, setBuscou] = useState(false);
  const [pending, start] = useTransition();

  const ring = cor === "emerald" ? "ring-emerald-200" : "ring-amber-200";
  const bg = cor === "emerald" ? "bg-emerald-50" : "bg-amber-50";

  function buscar() {
    if (termo.trim().length < 3) return;
    start(async () => {
      setResultados(await buscarParaMerge(termo));
      setBuscou(true);
    });
  }

  if (selecionado) {
    return (
      <div className={`rounded-2xl ${bg} p-4 ring-1 ${ring}`}>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
          {rotulo}
        </div>
        <div className="font-medium">
          {selecionado.nome_completo}{" "}
          <span className="text-sm font-normal text-neutral-500">
            {selecionado.idade} anos
          </span>
        </div>
        <div className="text-sm text-neutral-600">
          nasc. {fmtData(selecionado.data_nascimento)} ·{" "}
          {selecionado.cpf_last4 ? `CPF …-${selecionado.cpf_last4}` : "(sem CPF)"}
        </div>
        <div className="mt-1 text-sm text-neutral-600">
          {selecionado.n_agendamentos} agendamento(s) · {selecionado.n_prontuario} entrada(s)
          de prontuário
          {selecionado.status !== "ativo" && (
            <span className="ml-1 text-red-600">· {selecionado.status}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onTrocar}
          className="mt-2 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-900"
        >
          trocar
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {rotulo}
      </div>
      <div className="flex gap-2">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              buscar();
            }
          }}
          placeholder="buscar por nome"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <button
          type="button"
          onClick={buscar}
          disabled={pending || termo.trim().length < 3}
          className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "…" : "🔍"}
        </button>
      </div>

      {buscou && resultados.length === 0 && (
        <p className="mt-2 text-sm text-neutral-500">Nenhum paciente encontrado.</p>
      )}
      {resultados.length > 0 && (
        <ul className="mt-2 divide-y divide-neutral-100 rounded-lg ring-1 ring-black/5">
          {resultados.map((r) => (
            <li key={r.id} className="flex items-center justify-between p-2.5">
              <div className="text-sm">
                <span className="font-medium">{r.nome_completo}</span>{" "}
                <span className="text-neutral-500">{r.idade} anos</span>
                <span className="text-neutral-400">
                  {" "}
                  · {r.cpf_last4 ? `…-${r.cpf_last4}` : "sem CPF"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onSelecionar(r.id)}
                className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-900"
              >
                escolher
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MergePacientes() {
  const [destino, setDestino] = useState<ResumoMerge | null>(null);
  const [origem, setOrigem] = useState<ResumoMerge | null>(null);
  const [confirma, setConfirma] = useState("");
  const [resultado, setResultado] = useState<MergeResultado | null>(null);
  const [pending, start] = useTransition();

  async function escolher(slot: "destino" | "origem", id: number) {
    const r = await carregarResumo(id);
    if (slot === "destino") setDestino(r);
    else setOrigem(r);
    setResultado(null);
  }

  function mesclar() {
    if (!destino || !origem) return;
    start(async () => {
      const r = await mesclarPacientes(destino.id, origem.id, confirma);
      setResultado(r);
      if (r.ok) {
        setOrigem(null);
        setConfirma("");
      }
    });
  }

  if (resultado?.ok) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-6 ring-1 ring-emerald-200">
        <p className="font-medium text-emerald-800">✓ Pacientes mesclados.</p>
        <p className="mt-1 text-sm text-emerald-700">
          {resultado.agendamentos} agendamento(s) e {resultado.prontuario} entrada(s) de
          prontuário movidos para <b>{resultado.nome}</b>. O registro absorvido virou
          <b> mesclado</b> (não foi apagado — auditável).
        </p>
        <button
          type="button"
          onClick={() => {
            setResultado(null);
            setDestino(null);
            setOrigem(null);
          }}
          className="mt-3 rounded-lg border border-emerald-300 px-3 py-1.5 text-sm hover:border-emerald-700"
        >
          nova mesclagem
        </button>
      </div>
    );
  }

  const mesmoPaciente = !!destino && !!origem && destino.id === origem.id;
  const nomeConfere =
    !!destino && confirma.trim().toLowerCase() === destino.nome_completo.trim().toLowerCase();
  const podeConfirmar = !!destino && !!origem && !mesmoPaciente && nomeConfere;

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
        ⚠ <b>Ação irreversível.</b> Mesclar move todo o histórico do paciente absorvido para
        o destino e marca o absorvido como <b>mesclado</b>. Faça fora da pressão do balcão e
        confira os dois registros lado a lado antes de confirmar.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <BuscaSlot
          rotulo="Manter (destino)"
          cor="emerald"
          selecionado={destino}
          onSelecionar={(id) => escolher("destino", id)}
          onTrocar={() => setDestino(null)}
        />
        <BuscaSlot
          rotulo="Absorver (será mesclado)"
          cor="amber"
          selecionado={origem}
          onSelecionar={(id) => escolher("origem", id)}
          onTrocar={() => setOrigem(null)}
        />
      </div>

      {mesmoPaciente && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Os dois lados são o mesmo paciente. Escolha registros diferentes.
        </p>
      )}

      {destino && origem && !mesmoPaciente && (
        <div className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-black/5">
          <p className="text-sm text-neutral-700">
            <b>{origem.n_agendamentos}</b> agendamento(s) e <b>{origem.n_prontuario}</b>{" "}
            entrada(s) de prontuário de <b>{origem.nome_completo}</b> irão para{" "}
            <b>{destino.nome_completo}</b>.
          </p>
          <label className="block text-sm">
            <span className="text-neutral-700">
              Digite o NOME do paciente destino para confirmar:
            </span>
            <input
              value={confirma}
              onChange={(e) => setConfirma(e.target.value)}
              placeholder={destino.nome_completo}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
            />
          </label>
          {resultado?.erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {resultado.erro}
            </p>
          )}
          <button
            type="button"
            onClick={mesclar}
            disabled={!podeConfirmar || pending}
            className="rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Mesclando…" : "Mesclar pacientes"}
          </button>
        </div>
      )}

      {resultado?.erro && !(destino && origem && !mesmoPaciente) && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{resultado.erro}</p>
      )}
    </div>
  );
}
