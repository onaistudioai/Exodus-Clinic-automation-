import { NextResponse } from "next/server";
import { requireSofia } from "@/lib/api-guard";
import { withTenant, setPacienteId } from "@/lib/tenant";
import { identificarPaciente } from "@/lib/sofia-paciente";
import { criarAgendamento, listarServicos } from "@/server/agenda.repo";

/**
 * POST /api/sofia/agendar — marca consulta para o paciente da conversa.
 *
 * Body: { telefone, data_nascimento, servico_id, profissional_id, inicio }
 *
 * `paciente_id` NÃO é aceito: vem sempre da identificação pelo telefone. Sem
 * isso, quem tivesse o segredo HMAC poderia agendar em nome de qualquer pessoa
 * da clínica — e o segredo vive num container n8n, superfície bem maior que o
 * painel.
 *
 * `overbooking: false` fixo — furar a grade é decisão de balcão, com humano
 * olhando. Automação não recebe esse poder.
 */
export async function POST(req: Request) {
  const ctx = await requireSofia(req);
  if (ctx instanceof NextResponse) return ctx;

  const corpo = ctx.corpo as {
    servico_id?: unknown;
    profissional_id?: unknown;
    inicio?: unknown;
  };

  if (
    typeof corpo.servico_id !== "number" ||
    typeof corpo.profissional_id !== "number" ||
    typeof corpo.inicio !== "string"
  ) {
    return NextResponse.json({ erro: "campos_obrigatorios" }, { status: 400 });
  }

  // Recusa data no passado antes de tocar o banco.
  const inicio = new Date(corpo.inicio);
  if (Number.isNaN(inicio.getTime()) || inicio.getTime() < Date.now()) {
    return NextResponse.json({ erro: "inicio_invalido" }, { status: 400 });
  }

  return withTenant(ctx.clinicaId, async (tx) => {
    const ident = await identificarPaciente(tx, ctx.corpo as Record<string, unknown>);
    if (!ident.ok) return ident.resposta;
    await setPacienteId(tx, ident.paciente.pacienteId);

    // Serviço tem que existir NESTA clínica (a RLS já garante) e estar ativo.
    const servicos = await listarServicos(tx);
    if (!servicos.some((s) => s.id === corpo.servico_id)) {
      return NextResponse.json({ erro: "servico_nao_encontrado" }, { status: 404 });
    }

    try {
      const id = await criarAgendamento(tx, {
        pacienteId: ident.paciente.pacienteId,
        profissionalId: corpo.profissional_id as number,
        servicoId: corpo.servico_id as number,
        inicio: corpo.inicio as string,
        overbooking: false,
      });
      return NextResponse.json({ ok: true, agendamento_id: id });
    } catch (err) {
      // Conflito de horário é resposta esperada (a SOFIA reoferece), não erro 500.
      const msg = err instanceof Error ? err.message : "";
      console.warn("[sofia/agendar] recusado:", msg);
      return NextResponse.json({ ok: false, erro: "horario_indisponivel" }, { status: 409 });
    }
  });
}
