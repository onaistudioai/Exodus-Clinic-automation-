import "server-only";
import { verifySession } from "@/lib/dal";
import { podeFazer, type Acao } from "@/lib/rbac-matriz";

/**
 * B4 — RBAC mínimo (DRAFT-fase0.md §0.4). Gate por `papel`.
 *
 * A MATRIZ (a política) mora em `rbac-matriz.ts`, sem `server-only`, para poder
 * ser testada fora do bundler. Este arquivo é só o GATE de servidor.
 */
export type { Acao, Papel } from "@/lib/rbac-matriz";
export { podeFazer, MATRIZ } from "@/lib/rbac-matriz";

/** Gate de servidor: lança se a sessão não tem o papel para a ação. */
export async function requireAcao(acao: Acao): Promise<void> {
  const session = await verifySession();
  if (!podeFazer(session.papel, acao)) {
    throw new Error(`Acesso negado: papel '${session.papel}' não pode '${acao}'.`);
  }
}
