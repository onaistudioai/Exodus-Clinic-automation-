import "server-only";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import type { Papel, SessionPayload } from "@/lib/session";

/**
 * B3 — Credenciais via `fn_login_lookup` (DRAFT-fase0.md §0.3 + SYNC-A-to-B.md §3).
 *
 * FIX AUTH-RLS: o login roda FORA do withTenant (ainda não há tenant; é o login que
 * o descobre). Um `SELECT ... FROM usuarios` direto voltaria 0 linhas — RLS FORCE +
 * NOBYPASSRLS sem GUC = fail-closed. O Processo A criou `fn_login_lookup(email)`
 * SECURITY DEFINER (escapa a RLS só pro lookup de auth; EXECUTE só p/ app_painel).
 *
 * Email é único POR CLÍNICA (não global) → a fn pode retornar 1+ linhas. Comparamos
 * o bcrypt contra cada uma; a que casar define clinica_id/papel/id da sessão.
 */
export async function autenticar(
  email: string,
  senha: string
): Promise<SessionPayload | null> {
  const { rows } = await pool.query<{
    id: number;
    clinica_id: number;
    papel: Papel;
    senha_hash: string | null;
    nome: string;
  }>(
    `SELECT id, clinica_id, papel, senha_hash, nome FROM fn_login_lookup($1)`,
    [email]
  );

  for (const u of rows) {
    if (!u.senha_hash) continue;
    if (await bcrypt.compare(senha, u.senha_hash)) {
      return { usuario_id: u.id, clinica_id: u.clinica_id, papel: u.papel };
    }
  }
  return null; // nenhuma linha casou (ou email inexistente) — mensagem genérica no caller
}

export async function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, 12);
}
