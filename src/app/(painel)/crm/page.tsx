import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as crm from "@/server/crm.repo";
import type { ContagemEstagio, LinhaPipeline } from "@/types/domain";
import PipelinePacientes from "./PipelinePacientes";

export default async function CrmPage() {
  await requireAcao("ver_crm");
  const session = await verifySession();

  let contagem: ContagemEstagio[] = [];
  let linhas: LinhaPipeline[] = [];
  try {
    [contagem, linhas] = await withTenantReadOnly(session.clinica_id, async (tx) => {
      return [await crm.contarPorEstagio(tx), await crm.listarPipeline(tx, { limite: 300 })] as const;
    });
  } catch {
    // tabelas ainda não migradas / sem dados: estado vazio em vez de quebrar.
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">CRM</h1>
        <p className="text-sm text-neutral-500">
          Seus pacientes por estágio de relacionamento. Clique para abrir a ficha 360.
        </p>
      </div>
      <PipelinePacientes contagem={contagem} linhas={linhas} />
    </div>
  );
}
