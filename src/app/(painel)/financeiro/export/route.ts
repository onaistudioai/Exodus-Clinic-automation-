import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as financeiro from "@/server/financeiro.repo";

/**
 * Export CSV do caixa (lançamentos) de um período — para o contador (G3 da pesquisa).
 * Default: mês corrente. Query params ?desde=YYYY-MM-DD&ate=YYYY-MM-DD opcionais.
 * RBAC: ver_financeiro. Separador ';' e BOM (Excel pt-BR abre direto).
 */
export const dynamic = "force-dynamic";

const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  await requireAcao("ver_financeiro");
  const session = await verifySession();

  const url = new URL(req.url);
  const hoje = new Date();
  const desde =
    url.searchParams.get("desde") ??
    new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
  const ate = url.searchParams.get("ate") ?? hoje.toISOString().slice(0, 10);

  const lancamentos = await withTenantReadOnly(session.clinica_id, (tx) =>
    financeiro.lancamentosPeriodo(tx, desde, ate, 10000)
  );

  const header = ["data", "tipo", "categoria", "descricao", "forma_pagamento", "valor"];
  const linhas = lancamentos.map((l) =>
    [
      l.criado_em.slice(0, 10),
      l.tipo,
      l.categoria,
      l.descricao,
      l.forma_pagamento,
      l.valor.toFixed(2).replace(".", ","),
    ]
      .map(csvCell)
      .join(";")
  );
  const csv = "﻿" + [header.join(";"), ...linhas].join("\r\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="caixa-${desde}_${ate}.csv"`,
    },
  });
}
