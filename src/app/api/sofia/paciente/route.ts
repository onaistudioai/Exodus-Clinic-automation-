import { NextResponse } from "next/server";
import { requireSofia, normalizarTelefone } from "@/lib/api-guard";
import { withTenantReadOnly } from "@/lib/tenant";
import {
  resolverPacientePorTelefone,
  confirmarIdentidade,
  proximosAgendamentosDoPaciente,
} from "@/server/identidade.repo";

/**
 * POST /api/sofia/paciente — consulta do paciente pelo canal WhatsApp.
 *
 * Substitui o nó Postgres direto do n8n (S2). Três escopos são DERIVADOS, nunca
 * aceitos do corpo da requisição:
 *
 *   clinica_id  <- qual segredo HMAC assinou (api-guard)
 *   paciente    <- telefone da conversa
 *   dados       <- só agendamento futuro, nunca conteúdo clínico
 *
 * Não existe parâmetro capaz de pedir "os dados do paciente X". Por construção,
 * o único paciente alcançável é o dono do número que está conversando.
 */
export async function POST(req: Request) {
  const ctx = await requireSofia(req);
  if (ctx instanceof NextResponse) return ctx;

  const corpo = ctx.corpo as { telefone?: unknown; data_nascimento?: unknown };

  if (typeof corpo.telefone !== "string") {
    return NextResponse.json({ erro: "telefone_obrigatorio" }, { status: 400 });
  }
  const telefone = normalizarTelefone(corpo.telefone);
  if (!telefone) {
    return NextResponse.json({ erro: "telefone_invalido" }, { status: 400 });
  }

  return withTenantReadOnly(ctx.clinicaId, async (tx) => {
    const paciente = await resolverPacientePorTelefone(tx, telefone);

    // Resposta idêntica para "não cadastrado" e "ambíguo": não confirmamos a
    // existência de cadastro para quem não provou identidade.
    if (!paciente) {
      return NextResponse.json({ identificado: false });
    }

    // Step-up: sem data de nascimento, devolvemos apenas que há cadastro e o
    // primeiro nome — o bastante para a SOFIA cumprimentar e pedir a prova.
    if (typeof corpo.data_nascimento !== "string") {
      return NextResponse.json({
        identificado: true,
        confirmado: false,
        primeiro_nome: paciente.nome.split(" ")[0],
      });
    }

    const ok = await confirmarIdentidade(tx, paciente.pacienteId, corpo.data_nascimento);
    if (!ok) {
      return NextResponse.json({ identificado: true, confirmado: false });
    }

    const agendamentos = await proximosAgendamentosDoPaciente(tx, paciente.pacienteId);
    return NextResponse.json({
      identificado: true,
      confirmado: true,
      primeiro_nome: paciente.nome.split(" ")[0],
      agendamentos,
    });
  });
}
