import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAcao, permissoes } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as crm from "@/server/crm.repo";
import * as prontuario from "@/server/prontuario.repo";
import { ESTAGIOS_CRM, type EntradaEtiqueta, type Ficha360 } from "@/types/domain";
import TarefasPaciente from "../TarefasPaciente";
import TitularLgpd from "./TitularLgpd";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_REATIVACAO: Record<string, string> = {
  ativo: "em sequência",
  reativado: "reativado",
  optout: "opt-out",
  concluido: "concluído",
};

export default async function FichaCrmPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAcao("ver_crm");
  const session = await verifySession();
  const { pode } = await permissoes();
  const pacienteId = Number((await params).id);
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) notFound();

  let ficha: Ficha360 | null = null;
  let etiquetas: EntradaEtiqueta[] = [];
  try {
    [ficha, etiquetas] = await withTenantReadOnly(session.clinica_id, async (tx) => {
      const f = await crm.ficha360Base(tx, pacienteId);
      const et = f ? await prontuario.listarEtiquetas(tx, pacienteId) : [];
      return [f, et] as const;
    });
  } catch {
    // sem migração/dados: cai no notFound abaixo.
  }
  if (!ficha) notFound();

  const p = ficha.paciente;
  const meta = ESTAGIOS_CRM.find((x) => x.v === ficha.estagio)!;
  const emAberto = ficha.cobrancas.filter((c) => c.status === "aberta");
  const totalAberto = emAberto.reduce((s, c) => s + c.valor, 0);

  return (
    <div className="space-y-6">
      <Link href="/crm" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← voltar ao pipeline
      </Link>

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{p.nome_completo}</h1>
        <span className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${meta.cls}`}>{meta.label}</span>
        {p.e_menor && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">⚠ menor</span>
        )}
      </div>
      <p className="text-sm text-neutral-500">
        {p.idade} anos · {p.cpf_last4 ? `CPF …-${p.cpf_last4}` : "sem CPF"} · paciente desde {p.criado_em}
        {ficha.reativacao_status && (
          <> · reativação: {STATUS_REATIVACAO[ficha.reativacao_status] ?? ficha.reativacao_status}</>
        )}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Agendamentos */}
        <section className="rounded-xl bg-white p-4 ring-1 ring-black/5">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Agendamentos</h2>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400">Próximos</div>
              {ficha.proximos.length === 0 ? (
                <p className="text-neutral-400">nenhum</p>
              ) : (
                ficha.proximos.map((a) => (
                  <div key={a.id} className="flex justify-between">
                    <span>{a.data_agendamento}{a.hora_agendamento ? ` ${a.hora_agendamento}` : ""}</span>
                    <span className="text-neutral-500">{a.status}</span>
                  </div>
                ))
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400">Últimos realizados</div>
              {ficha.ultimos.length === 0 ? (
                <p className="text-neutral-400">nenhum</p>
              ) : (
                ficha.ultimos.map((a) => (
                  <div key={a.id} className="flex justify-between">
                    <span>{a.data_agendamento}{a.hora_agendamento ? ` ${a.hora_agendamento}` : ""}</span>
                    <span className="text-neutral-500">{a.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Financeiro */}
        <section className="rounded-xl bg-white p-4 ring-1 ring-black/5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-700">Cobranças</h2>
            {totalAberto > 0 && (
              <span className="text-sm font-semibold text-rose-700">
                {BRL.format(totalAberto)} em aberto
              </span>
            )}
          </div>
          {ficha.cobrancas.length === 0 ? (
            <p className="text-sm text-neutral-400">nenhuma cobrança</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {ficha.cobrancas.slice(0, 8).map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span className="text-neutral-600">
                    {c.vencimento} · {c.tipo_atendimento ?? "avulsa"}
                  </span>
                  <span
                    className={
                      c.status === "aberta" && c.dias_atraso > 0
                        ? "font-medium text-rose-700"
                        : c.status === "paga"
                          ? "text-emerald-700"
                          : "text-neutral-500"
                    }
                  >
                    {BRL.format(c.valor)} · {c.status}
                    {c.status === "aberta" && c.dias_atraso > 0 ? ` (${c.dias_atraso}d)` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Prontuário (só etiquetas — texto clínico fica no módulo Prontuário, que audita) */}
        <section className="rounded-xl bg-white p-4 ring-1 ring-black/5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-700">Histórico clínico</h2>
            <Link href="/prontuario" className="text-xs text-neutral-500 hover:text-neutral-900">
              abrir prontuário →
            </Link>
          </div>
          {etiquetas.length === 0 ? (
            <p className="text-sm text-neutral-400">sem registros</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {etiquetas.slice(0, 8).map((e) => (
                <li key={e.id} className="flex justify-between text-neutral-600">
                  <span>{e.tipo_atendimento ?? "—"}{e.precisa_retorno ? " · retorno" : ""}</span>
                  <span className="text-neutral-400">{e.criado_em.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Tarefas de follow-up */}
        <TarefasPaciente
          pacienteId={p.id}
          tarefas={ficha.tarefas}
          podeGerir={pode("gerir_crm")}
        />

        {/* Direitos do titular (LGPD art. 18) — dossiê e pedido de eliminação */}
        <TitularLgpd
          pacienteId={p.id}
          podeEliminar={pode("expurgo_logico")}
          podeVerDossie={pode("ler_texto_clinico")}
          pedidoEm={p.eliminacao_pedida_em}
          anonimizadoEm={p.anonimizado_em}
        />
      </div>
    </div>
  );
}
