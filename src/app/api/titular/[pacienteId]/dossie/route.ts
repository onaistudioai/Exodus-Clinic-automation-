import { NextResponse } from "next/server";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant, withTenantReadOnly } from "@/lib/tenant";
import { dossie } from "@/server/titular.repo";
import { registrarAcesso } from "@/server/prontuario.repo";

/**
 * GET /api/titular/[pacienteId]/dossie — resposta a pedido de acesso do titular
 * (LGPD art. 18, II e V). Devolve JSON como anexo para a clínica repassar.
 *
 * Rota autenticada por SESSÃO, não por HMAC: o pedido do titular é atendido pela
 * clínica, não pela SOFIA. Se um dia a SOFIA precisar entregar isso no WhatsApp,
 * é outra rota com step-up de identidade — o dossiê inclui texto clínico e
 * mandar isso pelo canal contraria o ROPA §2 ("não trafega por WhatsApp").
 *
 * RBAC `ler_texto_clinico` (médico/admin) porque o dossiê contém prontuário —
 * atender titular não pode virar caminho lateral para a recepção ler o que o
 * rbac.ts nega. A geração fica registrada em prontuario_acessos.
 *
 * JSON e não CSV/PDF: portabilidade pede "formato de uso comum e interoperável"
 * (art. 18 V), e o dossiê é aninhado — achatar em planilha perderia estrutura.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pacienteId: string }> }
) {
  await requireAcao("ler_texto_clinico");
  const session = await verifySession();

  const pacienteId = Number((await params).pacienteId);
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return NextResponse.json({ erro: "paciente_invalido" }, { status: 400 });
  }

  const d = await withTenantReadOnly(session.clinica_id, (tx) =>
    dossie(tx, pacienteId)
  );

  if (!d.identificacao) {
    return NextResponse.json({ erro: "paciente_nao_encontrado" }, { status: 404 });
  }

  // Auditoria em transação própria: a leitura acima é READ ONLY e não grava.
  await withTenant(session.clinica_id, (tx) =>
    registrarAcesso(
      tx,
      "leu",
      session.usuario_id,
      pacienteId,
      null,
      "dossiê do titular gerado (art. 18 II/V)"
    )
  );

  return new NextResponse(JSON.stringify(d, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="dossie-titular-${pacienteId}.json"`,
      // Dado de saúde não entra em cache de CDN nem de navegador.
      "cache-control": "no-store, private",
    },
  });
}
