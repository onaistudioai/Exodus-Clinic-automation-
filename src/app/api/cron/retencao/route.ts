import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { expurgoRetencao } from "@/server/titular.repo";

/**
 * GET /api/cron/retencao — cumpre os prazos de retenção declarados no ROPA.
 *
 * Diário (ver `crons` em vercel.json). Idempotente: só apaga o que já venceu,
 * então rodar duas vezes no mesmo dia não faz diferença — e deixar de rodar por
 * uma semana também não perde dado, só atrasa o expurgo.
 *
 * Autenticação por CRON_SECRET, não por sessão nem HMAC: não há usuário nem
 * clínica neste caminho (prazo legal não é multi-tenant). Sem o segredo
 * configurado a rota se recusa a rodar — é a única postura segura para um
 * endpoint que apaga dado.
 */
export const dynamic = "force-dynamic";

function autorizado(req: Request): boolean {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return false;

  const recebido = req.headers.get("authorization") ?? "";
  const a = Buffer.from(recebido);
  const b = Buffer.from(`Bearer ${esperado}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  try {
    const resultado = await expurgoRetencao();
    // Fica no log da plataforma: o ROPA promete o prazo, o log prova o cumprimento.
    console.info("[cron/retencao]", JSON.stringify(resultado));
    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    console.error("[cron/retencao] falhou:", err);
    return NextResponse.json({ ok: false, erro: "expurgo_falhou" }, { status: 500 });
  }
}
