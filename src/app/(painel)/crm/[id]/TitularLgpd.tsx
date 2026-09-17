"use client";

import { useActionState } from "react";
import { registrarEliminacao, type EliminacaoState } from "./titular-actions";

const INICIAL: EliminacaoState = {};

/**
 * Bloco de direitos do titular na ficha do paciente (LGPD art. 18).
 *
 * O download do dossiê é um link comum, não fetch: é um GET autenticado por
 * cookie que devolve anexo — o navegador já faz isso melhor que qualquer JS.
 *
 * A eliminação NÃO é apresentada como "apagar paciente". O texto diz o que a
 * operação faz de fato, porque prometer ao titular algo que a lei impede (apagar
 * prontuário antes de 20 anos) é o erro mais caro possível aqui.
 */
export default function TitularLgpd({
  pacienteId,
  podeEliminar,
  podeVerDossie,
  pedidoEm,
  anonimizadoEm,
}: {
  pacienteId: number;
  podeEliminar: boolean;
  podeVerDossie: boolean;
  pedidoEm: string | null;
  anonimizadoEm: string | null;
}) {
  const [state, agir, pendente] = useActionState(registrarEliminacao, INICIAL);
  const recibo = state.recibo;
  const jaPedido = pedidoEm ?? recibo?.pedido_em ?? null;

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <h2 className="mb-1 text-sm font-medium text-neutral-700">
        Direitos do titular (LGPD art. 18)
      </h2>
      <p className="mb-3 text-xs text-neutral-500">
        Use ao receber pedido do próprio paciente ou de seu responsável legal.
      </p>

      {podeVerDossie ? (
        <a
          href={`/api/titular/${pacienteId}/dossie`}
          className="inline-block rounded bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700"
        >
          Baixar dossiê de dados (acesso e portabilidade)
        </a>
      ) : (
        <p className="text-xs text-neutral-400">
          Dossiê disponível para médico ou administrador — contém texto clínico.
        </p>
      )}

      <div className="mt-4 border-t border-neutral-100 pt-3">
        {anonimizadoEm ? (
          <p className="text-xs text-neutral-500">
            Titular eliminado e desidentificado em {anonimizadoEm.slice(0, 10)}.
          </p>
        ) : jaPedido ? (
          <div className="space-y-1 text-xs">
            <p className="font-medium text-amber-800">
              Pedido de eliminação registrado em {jaPedido.slice(0, 10)}.
            </p>
            <p className="text-neutral-500">
              Canal e comunicação ativa já foram encerrados. O que a lei obriga a guardar
              (prontuário, art. 16 I da LGPD) é expurgado automaticamente ao vencer o prazo.
            </p>
          </div>
        ) : podeEliminar ? (
          <form action={agir} className="space-y-2">
            <input type="hidden" name="pacienteId" value={pacienteId} />
            <label className="block text-xs text-neutral-600">
              Pedido de eliminação — descreva como o titular solicitou
              <input
                name="motivo"
                required
                minLength={10}
                placeholder="ex.: pedido por escrito no balcão em 06/08, assinado"
                className="mt-1 w-full rounded border border-neutral-200 px-2 py-1 text-xs outline-none focus:border-neutral-900"
              />
            </label>
            <button
              type="submit"
              disabled={pendente}
              className="rounded bg-rose-700 px-3 py-1.5 text-xs text-white hover:bg-rose-800 disabled:opacity-50"
            >
              {pendente ? "registrando…" : "Registrar pedido de eliminação"}
            </button>
            <p className="text-xs text-neutral-400">
              Encerra WhatsApp e campanhas na hora. Prontuário e cobranças ficam retidos pelo
              prazo legal e são expurgados no vencimento.
            </p>
          </form>
        ) : (
          <p className="text-xs text-neutral-400">
            Registro de eliminação restrito ao administrador.
          </p>
        )}

        {state.erro && <p className="mt-2 text-xs text-rose-700">{state.erro}</p>}

        {recibo && (
          <dl className="mt-3 space-y-0.5 rounded bg-neutral-50 p-2 text-xs text-neutral-600">
            <div>Vínculos de WhatsApp revogados: {recibo.vinculos_revogados}</div>
            <div>Opt-outs registrados: {recibo.optouts_registrados}</div>
            <div>Registros clínicos retidos: {recibo.prontuarios_retidos}</div>
            <div>
              Retenção legal até {recibo.retencao_legal_ate?.slice(0, 10) ?? "—"} ·{" "}
              {recibo.base_da_retencao}
            </div>
          </dl>
        )}
      </div>
    </section>
  );
}
