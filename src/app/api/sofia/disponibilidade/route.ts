import { NextResponse } from "next/server";
import { requireSofia } from "@/lib/api-guard";
import { withTenantReadOnly } from "@/lib/tenant";
import { slotsLivres, listarServicos, listarProfissionais } from "@/server/agenda.repo";

/**
 * POST /api/sofia/disponibilidade — horários livres para a SOFIA oferecer.
 *
 * Única rota /api/sofia/* que NÃO exige identidade do paciente: disponibilidade
 * de agenda não é dado pessoal de ninguém. Quem já passou pelo HMAC é a clínica.
 *
 * Body: { data: "2026-08-10", servico_id?: number, profissional_id?: number }
 */
export async function POST(req: Request) {
  const ctx = await requireSofia(req);
  if (ctx instanceof NextResponse) return ctx;

  const corpo = ctx.corpo as {
    data?: unknown;
    servico_id?: unknown;
    profissional_id?: unknown;
  };

  if (typeof corpo.data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(corpo.data)) {
    return NextResponse.json({ erro: "data_invalida" }, { status: 400 });
  }
  const servicoId = typeof corpo.servico_id === "number" ? corpo.servico_id : null;
  const profissionalId =
    typeof corpo.profissional_id === "number" ? corpo.profissional_id : null;

  return withTenantReadOnly(ctx.clinicaId, async (tx) => {
    // A duração sai do serviço cadastrado, não do corpo da requisição: senão a
    // SOFIA (ou quem tiver o segredo) escolheria durações arbitrárias e furaria
    // a grade de horários da clínica.
    const servicos = await listarServicos(tx);
    const servico = servicoId
      ? servicos.find((s) => s.id === servicoId)
      : servicos[0];

    if (!servico) {
      return NextResponse.json({ erro: "servico_nao_encontrado" }, { status: 404 });
    }

    const profissionais = await listarProfissionais(tx);
    const alvos = profissionalId
      ? profissionais.filter((p) => p.id === profissionalId)
      : profissionais;

    if (alvos.length === 0) {
      return NextResponse.json({ erro: "profissional_nao_encontrado" }, { status: 404 });
    }

    const agenda = [];
    for (const p of alvos) {
      const slots = await slotsLivres(tx, p.id, corpo.data as string, servico.duracao_min);
      if (slots.length > 0) {
        agenda.push({ profissional_id: p.id, profissional: p.nome, slots });
      }
    }

    return NextResponse.json({
      data: corpo.data,
      servico: { id: servico.id, nome: servico.nome, duracao_min: servico.duracao_min },
      agenda,
    });
  });
}
