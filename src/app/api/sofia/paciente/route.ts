import { NextResponse } from "next/server";
import { requireSofia } from "@/lib/api-guard";
import { withTenantReadOnly } from "@/lib/tenant";
import { identificarPaciente } from "@/lib/sofia-paciente";
import { proximosAgendamentosDoPaciente } from "@/server/identidade.repo";

/**
 * POST /api/sofia/paciente — consulta do paciente pelo canal WhatsApp.
 *
 * Substitui o nó Postgres direto do n8n (S2). Três escopos são DERIVADOS, nunca
 * aceitos do corpo da requisição:
 *
 *   clinica_id  <- qual segredo HMAC assinou (api-guard)
 *   paciente    <- telefone da conversa (sofia-paciente)
 *   dados       <- só agendamento futuro, nunca conteúdo clínico
 *
 * Não existe parâmetro capaz de pedir "os dados do paciente X". Por construção,
 * o único paciente alcançável é o dono do número que está conversando.
 */
export async function POST(req: Request) {
  const ctx = await requireSofia(req);
  if (ctx instanceof NextResponse) return ctx;

  return withTenantReadOnly(ctx.clinicaId, async (tx) => {
    const ident = await identificarPaciente(tx, ctx.corpo as Record<string, unknown>);
    if (!ident.ok) return ident.resposta;

    const agendamentos = await proximosAgendamentosDoPaciente(tx, ident.paciente.pacienteId);

    return NextResponse.json({
      identificado: true,
      confirmado: true,
      primeiro_nome: ident.paciente.nome.split(" ")[0],
      agendamentos,
    });
  });
}
