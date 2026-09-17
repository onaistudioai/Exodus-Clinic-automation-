import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as agenda from "@/server/agenda.repo";
import type { Servico } from "@/types/domain";
import ServicosClient from "./ServicosClient";

export default async function ServicosPage() {
  await requireAcao("gerir_escala");
  const session = await verifySession();
  let servicos: Servico[] = [];
  try {
    servicos = await withTenantReadOnly(session.clinica_id, (tx) =>
      agenda.listarServicos(tx, true)
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
        <h1 className="mt-1 text-2xl font-semibold">Serviços</h1>
        <p className="text-sm text-neutral-500">
          Catálogo de serviços com a duração padrão — define o tamanho do horário na agenda.
        </p>
      </div>
      <ServicosClient servicos={servicos} />
    </div>
  );
}
