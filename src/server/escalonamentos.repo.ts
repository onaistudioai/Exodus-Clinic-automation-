import "server-only";
import type { Tx } from "@/lib/db";

/**
 * DAL — fila de escalonamento (Camada A v2, §5.4).
 *
 * "Estado não é destino": ESCALADO_HUMANO só vira atendimento se alguém vê a
 * fila. Esta é a tela que fecha o Anexo I §5 do contrato — as 7 situações em que
 * a automação para e aciona a equipe.
 *
 * A ordenação vem da view `v_fila_escalonamento` (por prazo, não por chegada):
 * item com SLA curto não pode sumir atrás de um antigo e folgado.
 */

export interface ItemFila {
  id: number;
  chat_id: string;
  gatilho: string;
  trecho: string | null;
  status: string;
  atendido_por: number | null;
  criado_em: string;
  esperando_min: number;
  atrasado: boolean;
}

export async function listarFila(tx: Tx, limite = 100): Promise<ItemFila[]> {
  const { rows } = await tx.query<ItemFila>(
    `SELECT id, chat_id, gatilho, trecho, status, atendido_por,
            criado_em, esperando_min, atrasado
       FROM v_fila_escalonamento
      LIMIT $1`,
    [limite]
  );
  return rows;
}

/** Assume o atendimento. Só sai de 'aberto' — não rouba item de outra pessoa. */
export async function assumir(tx: Tx, id: number, usuarioId: number): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE escalonamentos
        SET status = 'em_atendimento', atendido_por = $2, atendido_em = NOW()
      WHERE id = $1 AND status = 'aberto'`,
    [id, usuarioId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Fecha o item — e é isto que destrava o bot para aquele chat
 * (`fn_chat_bloqueado` volta a false). Resolver não é só arrumar a tela.
 */
export async function resolver(tx: Tx, id: number): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE escalonamentos
        SET status = 'resolvido', resolvido_em = NOW()
      WHERE id = $1 AND status <> 'resolvido'`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}
