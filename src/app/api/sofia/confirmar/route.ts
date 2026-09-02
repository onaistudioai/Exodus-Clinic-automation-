import { NextResponse } from "next/server";
import { requireSofia } from "@/lib/api-guard";
import { withTenant, setPacienteId } from "@/lib/tenant";
import { identificarPaciente } from "@/lib/sofia-paciente";
import { mudarStatusDoPaciente } from "@/server/identidade.repo";

/**
 * POST /api/sofia/confirmar — paciente confirma ou cancela a própria consulta.
 *
 * Body: { telefone, data_nascimento, agendamento_id, acao: "confirmar"|"cancelar" }
 *
 * O `agendamento_id` vem do paciente e é sequencial, portanto adivinhável. A
 * defesa não é validar antes: o `paciente_id` entra no WHERE do UPDATE
 * (mudarStatusDoPaciente), então id alheio simplesmente não casa. Sem janela
 * entre checar e agir.
 */
export async function POST(req: Request) {
  const ctx = await requireSofia(req);
  if (ctx instanceof NextResponse) return ctx;

  const corpo = ctx.corpo as { agendamento_id?: unknown; acao?: unknown };

  if (typeof corpo.agendamento_id !== "number") {
    return NextResponse.json({ erro: "agendamento_id_obrigatorio" }, { status: 400 });
  }
  if (corpo.acao !== "confirmar" && corpo.acao !== "cancelar") {
    return NextResponse.json({ erro: "acao_invalida" }, { status: 400 });
  }

  return withTenant(ctx.clinicaId, async (tx) => {
    const ident = await identificarPaciente(tx, ctx.corpo as Record<string, unknown>);
    if (!ident.ok) return ident.resposta;
    await setPacienteId(tx, ident.paciente.pacienteId);

    const alterou = await mudarStatusDoPaciente(
      tx,
      ident.paciente.pacienteId,
      corpo.agendamento_id as number,
      corpo.acao === "confirmar" ? "confirmada" : "cancelada"
    );

    if (!alterou) {
      // Resposta única para "não é seu", "não existe", "já passou" e "já
      // cancelado": distinguir viraria oráculo de agendamentos alheios.
      return NextResponse.json(
        { ok: false, erro: "agendamento_indisponivel" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, status: corpo.acao === "confirmar" ? "confirmada" : "cancelada" });
  });
}
