"use client";

import { useActionState } from "react";
import type { Campanha } from "@/types/domain";
import {
  criarCampanhaAction,
  alternarCampanhaAction,
  materializarAction,
  rodarAtribuicaoAction,
  type ReativacaoState,
} from "./actions";

const VAZIO: ReativacaoState = {};

function Feedback({ state }: { state: ReativacaoState }) {
  if (state.erro) return <span className="text-sm text-red-600">{state.erro}</span>;
  if (state.msg) return <span className="text-sm text-emerald-700">{state.msg}</span>;
  return null;
}

export default function GerenciarReativacao({
  campanha,
  elegiveis,
}: {
  campanha: Campanha | null;
  elegiveis: number;
}) {
  const [criarState, criar, criando] = useActionState(criarCampanhaAction, VAZIO);
  const [toggleState, toggle, alternando] = useActionState(alternarCampanhaAction, VAZIO);
  const [matState, materializar, materializando] = useActionState(materializarAction, VAZIO);
  const [atribState, atribuir, atribuindo] = useActionState(rodarAtribuicaoAction, VAZIO);

  if (!campanha) {
    return (
      <section className="rounded-xl bg-white p-5 ring-1 ring-black/5">
        <h2 className="text-sm font-medium text-neutral-700">Campanha</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Nenhuma campanha configurada. Crie a cadência padrão (30 dias · 3 toques: D+0, D+7, D+21).
        </p>
        <form action={criar} className="mt-3 flex items-center gap-3">
          <input
            name="nome"
            placeholder="Reativação de inativos"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <button
            disabled={criando}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {criando ? "Criando…" : "Criar campanha"}
          </button>
          <Feedback state={criarState} />
        </form>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-white p-5 ring-1 ring-black/5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-neutral-700">{campanha.nome}</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Janela {campanha.janela_dias} dias · {campanha.passos.length} toques (
            {campanha.passos.map((p) => `D+${p.offset_dias}`).join(", ")})
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
            campanha.ativa
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-neutral-100 text-neutral-500 ring-neutral-200"
          }`}
        >
          {campanha.ativa ? "ativa" : "inativa"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <form action={toggle}>
          <input type="hidden" name="campanha_id" value={campanha.id} />
          <input type="hidden" name="ativa" value={campanha.ativa ? "false" : "true"} />
          <button
            disabled={alternando}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900 disabled:opacity-50"
          >
            {campanha.ativa ? "Desativar" : "Ativar"}
          </button>
        </form>

        <form action={materializar}>
          <button
            disabled={materializando || !campanha.ativa}
            title={!campanha.ativa ? "Ative a campanha primeiro" : undefined}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900 disabled:opacity-50"
          >
            {materializando ? "Incluindo…" : `Incluir ${elegiveis} inativos na sequência`}
          </button>
        </form>

        <form action={atribuir}>
          <button
            disabled={atribuindo}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900 disabled:opacity-50"
          >
            {atribuindo ? "Verificando…" : "Rodar atribuição de retorno"}
          </button>
        </form>
      </div>

      <div className="mt-2 space-y-1">
        <Feedback state={toggleState} />
        <Feedback state={matState} />
        <Feedback state={atribState} />
      </div>

      <p className="mt-3 text-xs text-neutral-400">
        Os envios são feitos pelo worker (cron diário) em <b>modo simulação</b> por padrão —
        nenhuma mensagem real é enviada até habilitar o modo live.
      </p>
    </section>
  );
}
