import "server-only";
import { cache } from "react";
import { pool } from "@/lib/db";
import { verifySession } from "@/lib/dal";
import type { Acao, Papel } from "@/lib/rbac-matriz";

/**
 * B4 — RBAC. O GATE de servidor. A POLÍTICA mora no banco (`papel_acao`).
 *
 * POR QUE O PREDICADO CONTINUA SÍNCRONO
 * A leitura da política é I/O, mas 14 call sites usam a checagem dentro de JSX
 * (`{pode("gerir_escala") && <Botao/>}`), onde não existe `await`. Tornar a
 * checagem assíncrona quebraria todas elas. Então o I/O acontece UMA vez por
 * request — `permissoes()` carrega o conjunto do papel — e a checagem em si
 * continua sendo uma consulta a um Set em memória.
 *
 * `cache()` é o mesmo mecanismo que `verifySession()` já usa em dal.ts: memoiza
 * dentro de um render pass. Uma query de política por request, não uma por
 * botão renderizado.
 *
 * FAIL-CLOSED: se o banco não responder, `permissoes()` lança e `requireAcao()`
 * propaga — ninguém passa. Indisponibilidade nega, nunca libera.
 */

export type { Acao, Papel } from "@/lib/rbac-matriz";

export interface Permissoes {
  papel: Papel;
  /** Checagem síncrona contra o conjunto já carregado. */
  pode: (acao: Acao) => boolean;
}

/**
 * Conjunto de ações de um papel, direto da fonte única.
 * Memoizado por papel — em um request só existe um papel, mas a chave explícita
 * evita que uma futura troca de contexto (job, impersonação) leia cache errado.
 */
const acoesDoPapel = cache(async (papel: Papel): Promise<ReadonlySet<string>> => {
  const { rows } = await pool.query<{ acao_chave: string }>(
    "SELECT acao_chave FROM papel_acao WHERE papel_chave = $1",
    [papel]
  );
  return new Set(rows.map((r) => r.acao_chave));
});

/** Permissões da sessão atual. Chame uma vez por página e reuse o `pode`. */
export const permissoes = cache(async (): Promise<Permissoes> => {
  const session = await verifySession();
  const acoes = await acoesDoPapel(session.papel);
  return {
    papel: session.papel,
    pode: (acao: Acao) => acoes.has(acao),
  };
});

/** Gate de servidor: lança se a sessão não tem o papel para a ação. */
export async function requireAcao(acao: Acao): Promise<void> {
  const { papel, pode } = await permissoes();
  if (!pode(acao)) {
    throw new Error(`Acesso negado: papel '${papel}' não pode '${acao}'.`);
  }
}

/**
 * Metadados da ação, lidos da mesma fonte. `sensivel` é o que decide se uma
 * negação vira pedido de aprovação em vez de erro seco (ver Etapa 3), e
 * `descricao`/`escrita` alimentam o catálogo de ferramentas do chat — que passa
 * a ser DERIVADO da tabela em vez de mantido em paralelo.
 */
export interface AcaoMeta {
  chave: Acao;
  modulo: string;
  escrita: boolean;
  sensivel: boolean;
  descricao: string;
}

/** Todas as ações que o papel da sessão pode executar, com seus metadados. */
export const acoesPermitidas = cache(async (): Promise<AcaoMeta[]> => {
  const session = await verifySession();
  const { rows } = await pool.query<AcaoMeta>(
    `SELECT a.chave, a.modulo, a.escrita, a.sensivel, a.descricao
       FROM acao a
       JOIN papel_acao pa ON pa.acao_chave = a.chave
      WHERE pa.papel_chave = $1
      ORDER BY a.modulo, a.chave`,
    [session.papel]
  );
  return rows;
});

/** Uma ação pelo nome, permitida ou não — o chat precisa saber se é sensível. */
export async function metaDaAcao(acao: Acao): Promise<AcaoMeta | null> {
  const { rows } = await pool.query<AcaoMeta>(
    "SELECT chave, modulo, escrita, sensivel, descricao FROM acao WHERE chave = $1",
    [acao]
  );
  return rows[0] ?? null;
}
