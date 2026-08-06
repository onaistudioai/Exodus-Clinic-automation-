import "server-only";
import { NextResponse } from "next/server";
import {
  verificarAssinatura,
  HEADER_ASSINATURA,
  HEADER_TIMESTAMP,
} from "@/lib/hmac";

/**
 * Guarda das rotas /api/sofia/*. Espelha o papel do requireAcao() (src/lib/rbac.ts),
 * mas para o ator não-humano: a SOFIA.
 *
 * Dois escopos são DERIVADOS, nunca aceitos do cliente:
 *   - clinica_id  <- qual segredo HMAC validou a assinatura
 *   - paciente    <- telefone da conversa (resolvido pela rota, ver escopoPaciente)
 *
 * É a mesma regra do withTenant(): identidade não entra por payload.
 */

export interface ContextoSofia {
  clinicaId: number;
  /** Corpo já verificado. Use ESTE objeto — reler o request drena o stream. */
  corpo: unknown;
}

/** Resposta de erro sem vazar detalhe de autenticação para fora. */
function negado(): NextResponse {
  return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
}

/**
 * Verifica a assinatura e devolve o contexto. Retorna NextResponse em caso de
 * falha — a rota faz `if (r instanceof NextResponse) return r;`.
 *
 * Lê o corpo BRUTO (req.text()) porque a assinatura cobre bytes, não o objeto
 * reserializado. O JSON.parse acontece depois, sobre o mesmo texto verificado.
 */
export async function requireSofia(
  req: Request
): Promise<ContextoSofia | NextResponse> {
  const corpoBruto = await req.text();

  const resultado = verificarAssinatura(
    corpoBruto,
    req.headers.get(HEADER_ASSINATURA),
    req.headers.get(HEADER_TIMESTAMP)
  );

  if (!resultado.ok) {
    // Motivo só no log do servidor; o cliente recebe 401 genérico.
    console.warn(`[api-guard] chamada SOFIA rejeitada: ${resultado.motivo}`);
    return negado();
  }

  let corpo: unknown = {};
  if (corpoBruto.length > 0) {
    try {
      corpo = JSON.parse(corpoBruto);
    } catch {
      return NextResponse.json({ erro: "json_invalido" }, { status: 400 });
    }
  }

  return { clinicaId: resultado.clinicaId, corpo };
}

export { normalizarTelefone } from "@/lib/telefone";
