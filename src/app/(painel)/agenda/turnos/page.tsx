import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as agenda from "@/server/agenda.repo";
import type { Profissional, Turno, Bloqueio } from "@/types/domain";
import TurnosClient from "./TurnosClient";

export default async function TurnosPage() {
  await requireAcao("gerir_escala");
  const session = await verifySession();
  let profissionais: Profissional[] = [];
  let turnos: Turno[] = [];
  let bloqueios: Bloqueio[] = [];
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    [profissionais, turnos, bloqueios] = await withTenantReadOnly(
      session.clinica_id,
      async (tx) =>
        [
          await agenda.listarProfissionais(tx),
          await agenda.listarTurnos(tx),
          await agenda.listarBloqueios(tx, hoje),
        ] as const
    );
  } catch {
    /* sem tabelas ainda */
  }
  return (
    <div className="space-y-6">
      <div>
        <Link href="/agenda" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Agenda
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Turnos &amp; bloqueios</h1>
        <p className="text-sm text-neutral-500">
          A escala recorrente define quando cada profissional aparece disponível. Bloqueios são
          exceções (férias, folga, feriado). Não é controle de ponto.
        </p>
      </div>
      <TurnosClient profissionais={profissionais} turnos={turnos} bloqueios={bloqueios} />
    </div>
  );
}
