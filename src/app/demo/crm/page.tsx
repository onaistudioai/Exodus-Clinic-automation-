import { Icon } from "@/components/icons";
import { PageHeader, Badge } from "@/components/ui";
import { ESTAGIOS, PIPELINE, FICHA, contarEstagios, BRL2 } from "../_mock";

export default function DemoCrm() {
  const contagem = contarEstagios();

  return (
    <div className="space-y-8">
      <PageHeader
        title="CRM"
        subtitle="Seus pacientes por estágio de relacionamento. Clique num paciente para abrir a ficha 360."
      />

      {/* Kanban por estágio */}
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {ESTAGIOS.map((e) => {
          const cards = PIPELINE.filter((p) => p.estagio === e.v);
          return (
            <div key={e.v} className="w-64 flex-shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${e.dot}`} />
                  <span className="text-sm font-medium text-ink-700">{e.label}</span>
                </div>
                <span className="rounded-full bg-ink-900/5 px-2 py-0.5 text-xs font-medium tabular-nums text-ink-500">
                  {contagem[e.v] ?? 0}
                </span>
              </div>
              <div className="space-y-2">
                {cards.map((p) => (
                  <div
                    key={p.id}
                    className="cursor-pointer rounded-xl bg-surface p-3 shadow-card ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-pop hover:ring-brand-300"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink-900">{p.nome}</span>
                      {p.tarefas > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-brand-700">
                          <Icon.Checkin className="h-3.5 w-3.5" />
                          {p.tarefas}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-ink-400">
                      último atend.: {p.ultimo}
                      {p.dias != null && ` · ${p.dias}d`}
                    </div>
                  </div>
                ))}
                {cards.length === 0 && (
                  <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-ink-400">
                    vazio
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ficha 360 (destaque) */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-500">Ficha 360 · exemplo</h2>
        <div className="overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line">
          {/* Cabeçalho da ficha */}
          <div className="hero-dark relative flex flex-wrap items-center gap-3 px-6 py-5">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-lg font-semibold text-white">
              {FICHA.nome.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-semibold text-white">{FICHA.nome}</h3>
                <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-300/30">
                  Em tratamento
                </span>
              </div>
              <p className="text-sm text-white/70">
                {FICHA.idade} anos · paciente desde {FICHA.desde}
              </p>
            </div>
          </div>

          {/* Corpo */}
          <div className="grid gap-6 p-6 md:grid-cols-2">
            {/* Agendamentos */}
            <div>
              <h4 className="mb-2 text-sm font-medium text-ink-700">Agendamentos</h4>
              <div className="text-[11px] uppercase tracking-wide text-ink-400">Próximo</div>
              {FICHA.proximos.map((a, i) => (
                <div key={i} className="flex justify-between py-1 text-sm">
                  <span className="text-ink-800">{a.data} {a.hora} · {a.tipo}</span>
                  <span className="text-ink-400">{a.prof}</span>
                </div>
              ))}
              <div className="mt-2 text-[11px] uppercase tracking-wide text-ink-400">Últimos</div>
              {FICHA.ultimos.map((a, i) => (
                <div key={i} className="flex justify-between py-1 text-sm">
                  <span className="text-ink-600">{a.data} · {a.tipo}</span>
                  <span className="text-ink-400">{a.prof}</span>
                </div>
              ))}
            </div>

            {/* Cobranças */}
            <div>
              <h4 className="mb-2 text-sm font-medium text-ink-700">Cobranças</h4>
              <ul className="space-y-1 text-sm">
                {FICHA.cobrancas.map((c, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-ink-600">{c.data} · {c.tipo}</span>
                    <span className={c.status === "paga" ? "text-emerald-700" : "text-ink-800"}>
                      {BRL2.format(c.valor)} · {c.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Histórico clínico (etiquetas) */}
            <div>
              <h4 className="mb-2 text-sm font-medium text-ink-700">Histórico clínico</h4>
              <ul className="space-y-1 text-sm">
                {FICHA.historico.map((h, i) => (
                  <li key={i} className="flex justify-between text-ink-600">
                    <span>
                      {h.tipo}
                      {h.retorno && <Badge tone="brand" className="ml-2">retorno</Badge>}
                    </span>
                    <span className="text-ink-400">{h.data}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Tarefas */}
            <div>
              <h4 className="mb-2 text-sm font-medium text-ink-700">Tarefas de follow-up</h4>
              <ul className="space-y-1.5 text-sm">
                {FICHA.tarefas.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className={t.feita ? "text-ink-400 line-through" : "text-ink-800"}>
                      {t.titulo}
                      {t.venc && !t.feita && <span className="ml-2 text-xs text-ink-400">venc. {t.venc}</span>}
                    </span>
                    {!t.feita && (
                      <span className="rounded border border-line px-2 py-0.5 text-xs text-ink-500">concluir</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <input
                  disabled
                  placeholder="nova tarefa…"
                  className="flex-1 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-400"
                />
                <button className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">Adicionar</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
