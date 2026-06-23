import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as financeiro from "@/server/financeiro.repo";
import type { Tx } from "@/lib/db";

/**
 * Recibo simples (HTML imprimível → PDF via "imprimir") de uma cobrança paga.
 * LGPD (D8): conteúdo mínimo legal — clínica, paciente (titular), data, descrição
 * GENÉRICA do serviço, valor, forma de pagamento. NUNCA diagnóstico/detalhe clínico.
 * RBAC: ver_financeiro (recepção/médico/admin).
 */
export const dynamic = "force-dynamic";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const FORMA_LABEL: Record<string, string> = {
  pix: "Pix",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
  outro: "Outro",
};
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface ClinicaRecibo {
  nome: string;
  cnpj: string | null;
  endereco: string | null;
  telefone: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cobrancaId: string }> }
) {
  await requireAcao("ver_financeiro");
  const session = await verifySession();
  const { cobrancaId } = await params;
  const id = Number(cobrancaId);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("Cobrança inválida.", { status: 400 });
  }

  const dados = await withTenantReadOnly(session.clinica_id, async (tx: Tx) => {
    const cobranca = await financeiro.obterCobranca(tx, id);
    const { rows } = await tx.query<ClinicaRecibo>(
      `SELECT nome, cnpj, endereco, telefone FROM clinicas
        WHERE id = current_setting('app.clinica_id')::int`
    );
    return { cobranca, clinica: rows[0] ?? null };
  });

  const { cobranca, clinica } = dados;
  if (!cobranca) return new Response("Cobrança não encontrada.", { status: 404 });
  if (cobranca.status !== "paga") {
    return new Response("Recibo disponível apenas para cobrança paga.", { status: 409 });
  }

  const dataPag = cobranca.pago_em ? cobranca.pago_em.slice(0, 10) : cobranca.vencimento;
  const servico = cobranca.tipo_atendimento
    ? `Atendimento — ${cobranca.tipo_atendimento}`
    : "Atendimento clínico";

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Recibo #${cobranca.id}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *{box-sizing:border-box} body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    color:#171717;max-width:680px;margin:40px auto;padding:0 24px;line-height:1.5}
  h1{font-size:20px;margin:0 0 4px} .muted{color:#737373;font-size:13px}
  .box{border:1px solid #e5e5e5;border-radius:12px;padding:24px;margin-top:24px}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
  td{padding:8px 0;border-bottom:1px solid #f0f0f0} td:last-child{text-align:right}
  .total{font-size:22px;font-weight:600;margin-top:16px}
  .actions{margin-top:24px} button{font:inherit;padding:8px 16px;border:1px solid #171717;
    background:#171717;color:#fff;border-radius:8px;cursor:pointer}
  @media print{.actions{display:none} body{margin:0}}
</style></head>
<body>
  <h1>${esc(clinica?.nome ?? "Clínica")}</h1>
  <div class="muted">
    ${clinica?.cnpj ? "CNPJ: " + esc(clinica.cnpj) + " · " : ""}
    ${clinica?.endereco ? esc(clinica.endereco) + " · " : ""}
    ${clinica?.telefone ? esc(clinica.telefone) : ""}
  </div>

  <div class="box">
    <h2 style="margin:0 0 8px;font-size:16px">Recibo de pagamento nº ${cobranca.id}</h2>
    <table>
      <tr><td>Paciente</td><td>${esc(cobranca.paciente_nome ?? "—")}</td></tr>
      <tr><td>Serviço</td><td>${esc(servico)}</td></tr>
      <tr><td>Data do pagamento</td><td>${dataPag}</td></tr>
      <tr><td>Forma de pagamento</td><td>${FORMA_LABEL[cobranca.forma_pagamento ?? ""] ?? "—"}</td></tr>
    </table>
    <div class="total">Valor pago: ${brl(cobranca.valor)}</div>
    <p class="muted" style="margin-top:16px">
      Recebemos a importância acima referente ao serviço descrito. Documento emitido
      eletronicamente em ${new Date().toISOString().slice(0, 10)}.
    </p>
  </div>

  <div class="actions"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
</body></html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
