import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as financeiro from "@/server/financeiro.repo";
import type { PrecoProcedimento, TipoAtendimento } from "@/types/domain";
import PrecosForm from "./PrecosForm";

const TIPOS: TipoAtendimento[] = [
  "consulta",
  "retorno",
  "procedimento",
  "avaliacao",
  "limpeza",
];

export default async function PrecosPage() {
  await requireAcao("gerir_financeiro");
  const session = await verifySession();

  let precos: PrecoProcedimento[] = [];
  try {
    precos = await withTenantReadOnly(session.clinica_id, (tx) => financeiro.listarPrecos(tx));
  } catch {
    // tabelas ainda não migradas.
  }
  const porTipo = new Map(precos.map((p) => [p.tipo_atendimento, p]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/financeiro" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Financeiro
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Tabela de preços</h1>
        <p className="text-sm text-neutral-500">
          Valor cobrado automaticamente ao finalizar cada tipo de atendimento. Pode ser ajustado
          por cobrança.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">Tipo de atendimento</th>
              <th className="px-4 py-2 font-medium">Preço</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Editar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {TIPOS.map((t) => (
              <PrecosForm key={t} tipo={t} atual={porTipo.get(t) ?? null} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
