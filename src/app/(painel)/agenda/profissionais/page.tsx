import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as agenda from "@/server/agenda.repo";
import type { Profissional } from "@/types/domain";
import ProfissionaisClient from "./ProfissionaisClient";

export default async function ProfissionaisPage() {
  await requireAcao("gerir_escala");
  const session = await verifySession();
  let profissionais: Profissional[] = [];
  try {
    profissionais = await withTenantReadOnly(session.clinica_id, (tx) =>
      agenda.listarProfissionais(tx, true)
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
        <h1 className="mt-1 text-2xl font-semibold">Profissionais</h1>
        <p className="text-sm text-neutral-500">
          Quem atende. Nem todo profissional precisa ter login no painel.
        </p>
      </div>
      <ProfissionaisClient profissionais={profissionais} />
    </div>
  );
}
