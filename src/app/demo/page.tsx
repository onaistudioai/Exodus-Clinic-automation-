import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { Stat } from "@/components/ui";
import { KPIS, BRL, pct } from "./_mock";

const MODULOS: { href: string; icon: IconName; titulo: string; desc: string }[] = [
  { href: "/demo/crm", icon: "Crm", titulo: "CRM", desc: "Pacientes por estágio, ficha 360 e tarefas de follow-up." },
  { href: "/demo/agenda", icon: "Agenda", titulo: "Agenda", desc: "Confirmação, lembrete anti no-show e ocupação." },
  { href: "/demo/prontuario", icon: "Prontuario", titulo: "Prontuário", desc: "Evoluções, retornos e histórico clínico." },
  { href: "/demo/financeiro", icon: "Financeiro", titulo: "Financeiro", desc: "Caixa, recebíveis e recuperação de inadimplência." },
  { href: "/demo/reativacao", icon: "Reativacao", titulo: "Reativação", desc: "Sequências automáticas p/ pacientes inativos." },
  { href: "/demo/estoque", icon: "Estoque", titulo: "Estoque", desc: "Saldos, alertas de ruptura e validade." },
];

export default function DemoHome() {
  return (
    <div className="space-y-10">
      {/* Cabeçalho compacto (sem hero) */}
      <section className="reveal-up pt-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-medium text-brand-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
          Sistema operacional da clínica · IA no WhatsApp
        </span>
        <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">
          Toda a operação da sua clínica <span className="text-aurora">num só lugar</span>.
        </h1>
        <p className="mt-2 max-w-xl text-sm text-ink-500">
          A Sofia atende, agenda e confirma no WhatsApp. O painel cuida de pacientes,
          prontuário, finanças e reativação — sem planilha, sem esforço.
        </p>
      </section>

      {/* KPIs */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-500">Visão geral do mês</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Faturamento" value={BRL.format(KPIS.faturamento_mes)} tone="positive" />
          <Stat label="Ocupação" value={pct(KPIS.ocupacao_pct)} />
          <Stat label="No-show" value={pct(KPIS.no_show_pct)} tone="positive" sub="↓" />
          <Stat label="Reativados" value={KPIS.reativados} tone="positive" />
          <Stat label="A receber" value={BRL.format(KPIS.a_receber)} tone="warning" />
          <Stat label="Pacientes ativos" value={KPIS.pacientes_ativos} />
        </div>
      </section>

      {/* Módulos */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-500">Módulos</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULOS.map((m) => {
            const IconCmp = Icon[m.icon];
            return (
              <Link
                key={m.href}
                href={m.href}
                className="group relative overflow-hidden rounded-card bg-surface p-5 shadow-card ring-1 ring-line transition duration-200 hover:-translate-y-0.5 hover:shadow-pop hover:ring-brand-300"
              >
                <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white">
                  <IconCmp className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-2 font-semibold text-ink-900">
                  {m.titulo}
                  <Icon.ArrowRight className="h-4 w-4 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
                </div>
                <p className="mt-1 text-sm text-ink-500">{m.desc}</p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
