import "server-only";
import type { Tx } from "@/lib/db";

/**
 * DAL — trilha de toda chamada de ferramenta do chat (Parte F, sofia-acesso).
 * Não é telemetria.repo.ts (aquela é sobre o bot do WhatsApp — intenção x
 * template, funil — escopo diferente). Append-only (trg_chat_chamadas_
 * append_only). Identificadores, nunca conteúdo: sem argumentos, sem
 * resultado — só o nome da ferramenta/ação e o desfecho.
 */
export async function registrarChamada(
  tx: Tx,
  ferramenta: string,
  acao: string,
  resultado: "sucesso" | "negado" | "erro",
  usuarioId: number | null
): Promise<void> {
  await tx.query(
    `INSERT INTO chat_chamadas (clinica_id, usuario_id, ferramenta, acao, resultado)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, $4)`,
    [usuarioId, ferramenta, acao, resultado]
  );
}
