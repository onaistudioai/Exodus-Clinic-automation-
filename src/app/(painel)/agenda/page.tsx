import Link from "next/link";
import { requireAcao, permissoes } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as agenda from "@/server/agenda.repo";
import type {
  AgendamentoDia,
  Profissional,
  Servico,
  IndicadoresAgenda,
} from "@/types/domain";
import GerenciarAgenda from "./GerenciarAgenda";

const VAZIO: IndicadoresAgenda = {
  agendados: 0,
  realizados: 0,
  no_show: 0,
  taxa_no_show: 0,
  ocupacao_pct: 0,
};

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  await requireAcao("ver_agenda");
  const session = await verifySession();
  const { pode } = await permissoes();
  const podeGerir = pode("gerir_agenda");
  const { data: dataParam } = await searchParams;
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(dataParam ?? "") ? dataParam! : hojeISO();

  let lista: AgendamentoDia[] = [];
  let profissionais: Profissional[] = [];
  let servicos: Servico[] = [];
  let ind = VAZIO;
  try {
    [lista, profissionais, servicos, ind] = await withTenantReadOnly(
      session.clinica_id,
      async (tx) =>
        [
          await agenda.agendaDoDia(tx, dia),
          await agenda.listarProfissionais(tx),
          await agenda.listarServicos(tx),
          await agenda.indicadores(tx, dia, dia),
        ] as const
    );
  } catch {
    // tabelas ainda não migradas: estado vazio.
  }

  const cards = [
    { label: "Agendados (dia)", valor: ind.agendados },
    { label: "Realizados", valor: ind.realizados, cls: "text-emerald-700" },
    { label: "No-show", valor: `${Math.round(ind.taxa_no_show * 100)}%`, cls: "text-amber-700" },
    { label: "Ocupação", valor: `${Math.round(ind.ocupacao_pct * 100)}%` },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">Agenda</h1>
          <p className="text-sm text-neutral-500">
            Horários do dia por profissional. Disponibilidade vem dos turnos.
          </p>
        </div>
        <nav className="flex gap-3 text-sm">
          {pode("gerir_escala") && (
            <>
              <Link href="/agenda/turnos" className="text-neutral-600 hover:text-neutral-900">
                Turnos
              </Link>
              <Link href="/agenda/profissionais" className="text-neutral-600 hover:text-neutral-900">
                Profissionais
              </Link>
              <Link href="/agenda/servicos" className="text-neutral-600 hover:text-neutral-900">
                Serviços
              </Link>
            </>
          )}
        </nav>
      </div>

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

      <GerenciarAgenda
        dia={dia}
        lista={lista}
        profissionais={profissionais}
        servicos={servicos}
        podeGerir={podeGerir}
      />
    </div>
  );
}
