import { NextResponse } from "next/server";
import { requireSofia } from "@/lib/api-guard";
import { withTenant } from "@/lib/tenant";
import { normalizarTelefone } from "@/lib/telefone";
import { resolverPacientePorTelefone } from "@/server/identidade.repo";
import { registrarConsentimento } from "@/server/reativacao.repo";

/**
 * POST /api/sofia/optout — paciente pede para parar de receber mensagens.
 *
 * Body: { telefone, evidencia? }
 *
 * DE PROPÓSITO sem step-up de identidade, ao contrário das outras rotas.
 * Revogar consentimento tem que ser tão fácil quanto dá-lo (art. 8º §5 da LGPD);
 * exigir data de nascimento para parar de receber mensagem é obstáculo indevido.
 * O risco inverso — alguém descadastrar outra pessoa — é baixo e reversível pela
 * recepção, enquanto continuar mandando mensagem a quem pediu para parar é
 * infração.
 *
 * Também não exige que o número tenha paciente vinculado: quem recebeu mensagem
 * indevida (número reciclado, por exemplo) precisa conseguir sair.
 */
export async function POST(req: Request) {
  const ctx = await requireSofia(req);
  if (ctx instanceof NextResponse) return ctx;

  const corpo = ctx.corpo as { telefone?: unknown; chat_id?: unknown; evidencia?: unknown };

  const telefone =
    typeof corpo.telefone === "string" ? normalizarTelefone(corpo.telefone) : null;

  if (!telefone && typeof corpo.chat_id !== "string") {
    return NextResponse.json({ erro: "telefone_ou_chat_id" }, { status: 400 });
  }

  return withTenant(ctx.clinicaId, async (tx) => {
    let chatId = typeof corpo.chat_id === "string" ? corpo.chat_id : null;

    if (!chatId && telefone) {
      const paciente = await resolverPacientePorTelefone(tx, telefone);
      chatId = paciente?.chatId ?? null;
    }

    if (!chatId) {
      // Nada a revogar, mas responde ok: do ponto de vista do titular o efeito
      // pretendido ("não me mande mais") está garantido.
      return NextResponse.json({ ok: true, ja_estava_fora: true });
    }

    const mudou = await registrarConsentimento(
      tx,
      chatId,
      "optout",
      "sofia",
      typeof corpo.evidencia === "string" ? corpo.evidencia : undefined
    );

    // Oráculo conhecido e aceito (achado da sessão par, 2026-09-01): `mudou`
    // distingue "havia consentimento ativo" de "não havia nada" para um número
    // reciclado. É bem mais barato que o nome que o gate fecha para
    // a_reconfirmar, e `mudou` é o que o n8n usa para decidir a resposta —
    // por isso mantido, não colapsado num `{ok:true}` genérico.
    return NextResponse.json({ ok: true, mudou });
  });
}
