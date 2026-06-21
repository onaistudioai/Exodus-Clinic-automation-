import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { readSessionCookie, type SessionPayload } from "@/lib/session";

/**
 * Data Access Layer (Next 16 padrão recomendado). verifySession() é a checagem de
 * autorização o mais perto possível dos dados — o proxy só faz check otimista.
 * `cache()` memoiza dentro de um render pass (não chama jwtVerify N vezes).
 */
export const verifySession = cache(async (): Promise<SessionPayload> => {
  const session = await readSessionCookie();
  if (!session) redirect("/login");
  return session;
});

/** Variante que NÃO redireciona — para proxy/optimistic e telas públicas. */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  return readSessionCookie();
});
