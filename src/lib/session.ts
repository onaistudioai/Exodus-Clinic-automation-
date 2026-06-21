import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * B3 — Sessão JWT (DRAFT-fase0.md §0.3)
 *
 * Claims que a sessão carrega: usuario_id, clinica_id, papel. O `clinica_id` daqui
 * é o ÚNICO input legítimo do withTenant() — fecha o loop com a RLS. Nunca derivar
 * tenant de input do cliente.
 *
 * NOTA DE DECISÃO: o plano travou "Auth.js v5 (NextAuth)". Como (a) o schema ainda
 * não está vivo (sync point A) e (b) Next 16 renomeou middleware->proxy (o wrapper
 * `auth` do next-auth assume middleware.ts), implementamos a sessão sobre `jose`
 * — a MESMA lib que o next-auth usa por baixo — seguindo o padrão DAL dos docs do
 * Next 16. Os claims são idênticos ao contrato, então trocar por next-auth depois
 * é local (este arquivo + auth.ts). Ver NOTES.md.
 */
export type Papel = "recepcao" | "medico" | "admin";

export interface SessionPayload {
  usuario_id: number;
  clinica_id: number;
  papel: Papel;
  [key: string]: unknown;
}

const COOKIE = "aios_painel_session";
const MAX_AGE_S = 60 * 60 * 8; // 8h — jornada de balcão

function key(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET ausente no ambiente.");
  return new TextEncoder().encode(secret);
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key());
}

export async function decryptSession(token?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload as SessionPayload;
  } catch {
    return null; // expirado/adulterado -> sem sessão (fail-closed)
  }
}

export async function createSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await encryptSession(payload);
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_S,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function readSessionCookie(): Promise<SessionPayload | null> {
  const store = await cookies();
  return decryptSession(store.get(COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE;
