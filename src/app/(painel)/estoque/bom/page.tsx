import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as estoque from "@/server/estoque.repo";
import type { BomItem, Produto } from "@/types/domain";
import ConfigBom from "./ConfigBom";

export default async function BomPage() {
  await requireAcao("configurar_bom");
  const session = await verifySession();

  let bom: BomItem[] = [];
  let produtos: Produto[] = [];
  try {
    [bom, produtos] = await withTenantReadOnly(session.clinica_id, async (tx) => [
      await estoque.listarBomCompleto(tx),
      await estoque.listarProdutos(tx),
    ]);
  } catch {
    // tabelas não migradas
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/estoque" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Estoque
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Kits por procedimento (BOM)</h1>
        <p className="text-sm text-neutral-500">
          Materiais consumidos automaticamente a cada atendimento finalizado, por tipo.
        </p>
      </div>
      <ConfigBom bomInicial={bom} produtos={produtos} />
    </div>
  );
}
