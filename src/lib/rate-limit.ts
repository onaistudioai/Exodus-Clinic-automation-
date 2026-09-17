import "server-only";
import { headers } from "next/headers";
import { pool } from "@/lib/db";

/**
 * S5 — Freio de força bruta no login (003-rate-limit.sql).
 *
 * Roda FORA do withTenant: no login ainda não há tenant — é o login que o
 * descobre. Usa fn_login_freio (SECURITY DEFINER), mesmo padrão do
 * fn_login_lookup em src/lib/auth.ts.
 */

/**
 * IP do cliente. Atrás da Vercel/proxy, o socket é do proxy — o real vem no
 * x-forwarded-for. Pegamos o PRIMEIRO da lista (o cliente); os seguintes são
 * a cadeia de proxies e podem ser forjados pelo cliente.
 *
 * ponytail: confia no header porque em produção só a Vercel fala com o app.
 * Se um dia houver acesso direto à origem, isso precisa de allowlist de proxy.
 */
async function ipDoCliente(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip") ?? "desconhecido";
}

export interface Freio {
  bloqueado: boolean;
  segundos: number;
}

/**
 * Registra a tentativa e diz se está bloqueado.
 *
 * Falha ABERTA de propósito: se o banco estiver fora, o rate limit não pode ser
 * o motivo de ninguém conseguir entrar na clínica. O login em si continua
 * fail-closed (sem banco, autenticar() não valida ninguém).
 */
export async function registrarTentativaLogin(
  email: string,
  sucesso: boolean
): Promise<Freio> {
  try {
    const ip = await ipDoCliente();
    const { rows } = await pool.query<{ espera: number }>(
      "SELECT fn_login_freio($1, $2, $3) AS espera",
      [email.toLowerCase(), ip, sucesso]
    );
    const segundos = rows[0]?.espera ?? 0;
    return { bloqueado: segundos > 0, segundos };
  } catch (err) {
    console.error("[rate-limit] indisponível, seguindo sem freio:", err);
    return { bloqueado: false, segundos: 0 };
  }
}
