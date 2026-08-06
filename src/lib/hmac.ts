// Sem `server-only` de propósito: este módulo é cripto pura e precisa ser
// testável fora do runtime do Next. O guard fica no api-guard.ts, que é o único
// ponto de entrada real — e o segredo não é NEXT_PUBLIC_, então nunca vai ao bundle.
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * S1/S2 — Autenticação das chamadas da SOFIA (n8n) para o painel.
 *
 * Substitui o acesso direto do n8n ao Postgres. Toda escrita passa a entrar pelo
 * mesmo funil do painel (withTenant + RLS + auditoria), autenticada por HMAC.
 *
 * Contrato da assinatura:
 *   base   = `${timestamp}.${corpoBrutoDaRequisicao}`
 *   header X-AIOS-Timestamp = timestamp unix em SEGUNDOS
 *   header X-AIOS-Signature = hex(HMAC-SHA256(base, segredoDaClinica))
 *
 * Decisões:
 * - O timestamp entra DENTRO da base assinada. Fora dela, um atacante trocaria o
 *   header e reusaria a assinatura para sempre.
 * - O `clinica_id` NÃO vem do corpo: é derivado de qual segredo validou a
 *   assinatura. Mesma regra inquebrável do withTenant() (src/lib/tenant.ts).
 * - Assinamos o corpo BRUTO, não o JSON reserializado — reserializar muda bytes
 *   (ordem de chave, unicode) e quebraria a verificação de forma intermitente.
 */

/** Janela de aceite. Cobre relógio fora de sincronia sem dar folga a replay. */
export const JANELA_SEGUNDOS = 300;

export const HEADER_ASSINATURA = "x-aios-signature";
export const HEADER_TIMESTAMP = "x-aios-timestamp";

export type ResultadoHmac =
  | { ok: true; clinicaId: number }
  | { ok: false; motivo: string };

/**
 * Segredos por clínica, do ambiente: SOFIA_HMAC_SECRETS="1:abc...,2:def..."
 * (clinica_id:segredo). Um segredo por clínica para que o vazamento de um não
 * exponha as outras — e para que o próprio segredo identifique o tenant.
 */
function carregarSegredos(): Map<number, string> {
  const bruto = process.env.SOFIA_HMAC_SECRETS;
  if (!bruto) throw new Error("SOFIA_HMAC_SECRETS ausente no ambiente.");

  const mapa = new Map<number, string>();
  for (const par of bruto.split(",")) {
    const limpo = par.trim();
    if (!limpo) continue;
    const sep = limpo.indexOf(":");
    if (sep === -1) throw new Error("SOFIA_HMAC_SECRETS malformado: use 'clinicaId:segredo'.");

    const clinicaId = Number(limpo.slice(0, sep));
    const segredo = limpo.slice(sep + 1);
    if (!Number.isInteger(clinicaId) || clinicaId <= 0) {
      throw new Error(`SOFIA_HMAC_SECRETS: clinica_id inválido '${limpo.slice(0, sep)}'.`);
    }
    // Segredo curto derrota o propósito: exigimos 32+ chars (openssl rand -hex 32).
    if (segredo.length < 32) {
      throw new Error(`SOFIA_HMAC_SECRETS: segredo da clínica ${clinicaId} é curto demais (min 32).`);
    }
    mapa.set(clinicaId, segredo);
  }
  if (mapa.size === 0) throw new Error("SOFIA_HMAC_SECRETS vazio.");
  return mapa;
}

let _segredos: Map<number, string> | undefined;
function segredos(): Map<number, string> {
  if (!_segredos) _segredos = carregarSegredos();
  return _segredos;
}

function assinar(segredo: string, base: string): string {
  return createHmac("sha256", segredo).update(base, "utf8").digest("hex");
}

/** Comparação em tempo constante. Tamanhos diferentes => false sem vazar timing. */
function iguaisConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verifica a assinatura e devolve o tenant. `agora` é injetável para teste.
 * Não recebe clinica_id: ele é DESCOBERTO, testando a assinatura contra cada
 * segredo conhecido. É por isso que o corpo não consegue forjar tenant.
 */
export function verificarAssinatura(
  corpoBruto: string,
  assinatura: string | null,
  timestamp: string | null,
  agora: number = Math.floor(Date.now() / 1000)
): ResultadoHmac {
  if (!assinatura) return { ok: false, motivo: "assinatura ausente" };
  if (!timestamp) return { ok: false, motivo: "timestamp ausente" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, motivo: "timestamp inválido" };

  // Math.abs cobre os dois lados: requisição velha (replay) e timestamp no futuro.
  if (Math.abs(agora - ts) > JANELA_SEGUNDOS) {
    return { ok: false, motivo: "timestamp fora da janela" };
  }

  const base = `${ts}.${corpoBruto}`;
  for (const [clinicaId, segredo] of segredos()) {
    if (iguaisConstante(assinatura, assinar(segredo, base))) {
      return { ok: true, clinicaId };
    }
  }
  return { ok: false, motivo: "assinatura inválida" };
}

/** Usado pelo n8n e pelos testes para produzir uma chamada válida. */
export function gerarAssinatura(segredo: string, corpoBruto: string, timestamp: number): string {
  return assinar(segredo, `${timestamp}.${corpoBruto}`);
}
