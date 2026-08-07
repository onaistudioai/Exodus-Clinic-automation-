import { requireAcao, podeFazer } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as reativacao from "@/server/reativacao.repo";
import type { Campanha, InativoElegivel, MetricasReativacao } from "@/types/domain";
import GerenciarReativacao from "./GerenciarReativacao";

const JANELA_FALLBACK = 30;

export default async function ReativacaoPage() {
  await requireAcao("ver_reativacao");
  const session = await verifySession();
  const podeGerir = podeFazer(session.papel, "gerir_reativacao");

  let campanha: Campanha | null = null;
  let metricas: MetricasReativacao | null = null;
  let inativos: InativoElegivel[] = [];
  try {
    [campanha, metricas, inativos] = await withTenantReadOnly(session.clinica_id, async (tx) => {
      const camp = await reativacao.getCampanhaAtiva(tx);
      const janela = camp?.janela_dias ?? JANELA_FALLBACK;
      return [
        camp,
        await reativacao.metricas(tx, janela),
        await reativacao.listarInativos(tx, janela, 50),
      ] as const;
    });
  } catch {
    // tabelas ainda não migradas: estado vazio em vez de quebrar a página.
  }

  const cards: { label: string; valor: string | number; cls?: string }[] = [
    { label: "Elegíveis", valor: metricas?.elegiveis ?? 0 },
    { label: "Em sequência", valor: metricas?.em_sequencia ?? 0 },
    { label: "Reativados", valor: metricas?.reativados ?? 0, cls: "text-emerald-700" },
    {
      label: "Taxa de reativação",
      valor: `${Math.round((metricas?.taxa_reativacao ?? 0) * 100)}%`,
      cls: "text-emerald-700",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">Reativação</h1>
          <p className="text-sm text-neutral-500">
            Recupera pacientes inativos com uma sequência automática no WhatsApp.
          </p>
        </div>
        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200">
          modo simulação (dry-run)
        </span>
      </div>

      {/* Receita recuperada — a única métrica que o dono da clínica realmente lê.
          Só aparece quando há valor: card zerado vira ruído e desgasta a métrica. */}
      {(metricas?.receita_recuperada ?? 0) > 0 && (
        <section className="rounded-xl bg-emerald-50 p-5 ring-1 ring-emerald-200">
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Receita recuperada pela campanha
          </div>
          <div className="mt-1 text-4xl font-semibold tabular-nums text-emerald-800">
            {(metricas?.receita_recuperada ?? 0).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
          </div>
          <p className="mt-1 text-xs text-emerald-700">
            {metricas?.pacientes_faturados ?? 0} paciente
            {(metricas?.pacientes_faturados ?? 0) === 1 ? "" : "s"} que voltaram e geraram
            atendimento, nos 30 dias após a reativação.
          </p>
        </section>
      )}

      {/* Métricas */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-white p-4 ring-1 ring-black/5">
            <div className="text-xs text-neutral-500">{c.label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${c.cls ?? ""}`}>
              {c.valor}
            </div>
          </div>
        ))}
      </section>

      {/* Campanha + gestão */}
      {podeGerir && <GerenciarReativacao campanha={campanha} elegiveis={metricas?.elegiveis ?? 0} />}

      {/* Público inativo (preview) */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-700">
          Pacientes inativos elegíveis{" "}
          {inativos.length > 0 && <span className="text-neutral-400">({inativos.length})</span>}
        </h2>
        {inativos.length === 0 ? (
          <p className="text-sm text-neutral-400">
            Nenhum paciente inativo elegível no momento.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Paciente</th>
                  <th className="px-4 py-2 font-medium">Último atendimento</th>
                  <th className="px-4 py-2 text-right font-medium">Dias inativo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {inativos.map((p) => (
                  <tr key={p.paciente_id}>
                    <td className="px-4 py-2 font-medium text-neutral-900">{p.nome_completo}</td>
                    <td className="px-4 py-2 text-neutral-500">{p.ultimo_atendimento}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-700">
                      {p.dias_inativo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
