import "server-only";
import type { Tx } from "@/lib/db";
import type { Acao } from "@/lib/rbac-matriz";

/**
 * DAL — fila de pedidos de aprovação (.planning/acesso/sql/004-aprovacao.sql).
 *
 * clinica_id vem do GUC app.clinica_id (setado por withTenant); a tabela tem
 * clinica_id e é varrida pelo 001-lockdown.sql, então o filtro por tenant é
 * automático. RBAC é aplicado na Action, como nos outros repos.
 *
 * A validação de transição de estado NÃO está aqui: mora no trigger
 * t_estado_solicitacao, que lê transicao_solicitacao. Repetir a regra em TS
 * seria a segunda cópia — e a cópia que não é aplicada quando o n8n escreve.
 */

export interface Solicitacao {
  id: number;
  acao_chave: Acao;
  acao_descricao: string;
  solicitante_id: number;
  solicitante_nome: string;
  argumentos: Record<string, unknown>;
  justificativa: string | null;
  estado: string;
  estado_rotulo: string;
  criado_em: Date;
  expira_em: Date;
}

const SELECT_BASE = `
  SELECT s.id, s.acao_chave, a.descricao AS acao_descricao,
         s.solicitante_id, u.nome AS solicitante_nome,
         s.argumentos, s.justificativa,
         s.estado, e.rotulo AS estado_rotulo,
         s.criado_em, s.expira_em
    FROM solicitacao_aprovacao s
    JOIN acao               a ON a.chave = s.acao_chave
    JOIN estado_solicitacao e ON e.chave = s.estado
    JOIN usuarios           u ON u.id    = s.solicitante_id
`;

/** Abre um pedido. Retorna o id para o chat poder dizer "pedido #N criado". */
export async function abrir(
  tx: Tx,
  clinicaId: number,
  params: {
    acao: Acao;
    solicitanteId: number;
    argumentos: Record<string, unknown>;
    justificativa?: string;
  }
): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO solicitacao_aprovacao
       (clinica_id, acao_chave, solicitante_id, argumentos, justificativa)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      clinicaId,
      params.acao,
      params.solicitanteId,
      JSON.stringify(params.argumentos),
      params.justificativa ?? null,
    ]
  );
  return rows[0].id;
}

/**
 * A fila do aprovador. Exclui as vencidas: uma solicitação de ontem que já
 * passou de `expira_em` não deve ser aprovada por engano hoje — o mundo mudou.
 * Elas continuam existindo para auditoria, só saem da fila de decisão.
 */
export async function listarPendentes(tx: Tx): Promise<Solicitacao[]> {
  const { rows } = await tx.query<Solicitacao>(
    `${SELECT_BASE}
      WHERE s.estado = 'pendente' AND s.expira_em > NOW()
      ORDER BY s.criado_em`
  );
  return rows;
}

/** O que o solicitante vê: os próprios pedidos, em qualquer estado. */
export async function listarMinhas(tx: Tx, usuarioId: number): Promise<Solicitacao[]> {
  const { rows } = await tx.query<Solicitacao>(
    `${SELECT_BASE}
      WHERE s.solicitante_id = $1
      ORDER BY s.criado_em DESC
      LIMIT 50`,
    [usuarioId]
  );
  return rows;
}

/**
 * Trava o pedido para decisão e devolve o conteúdo.
 *
 * FOR UPDATE porque dois donos aprovando o mesmo pedido ao mesmo tempo
 * executariam a baixa duas vezes. O lock_timeout de 5s do pool faz o segundo
 * desistir rápido em vez de enfileirar.
 *
 * Devolve null se o pedido não existe, já foi decidido, ou venceu — os três
 * casos em que NÃO se deve executar o efeito.
 */
export async function travarParaDecisao(
  tx: Tx,
  id: number
): Promise<{ acao: Acao; argumentos: Record<string, unknown>; solicitanteId: number } | null> {
  const { rows } = await tx.query<{
    acao_chave: Acao;
    argumentos: Record<string, unknown>;
    solicitante_id: number;
  }>(
    `SELECT acao_chave, argumentos, solicitante_id
       FROM solicitacao_aprovacao
      WHERE id = $1 AND estado = 'pendente' AND expira_em > NOW()
        FOR UPDATE`,
    [id]
  );
  if (rows.length === 0) return null;
  return {
    acao: rows[0].acao_chave,
    argumentos: rows[0].argumentos,
    solicitanteId: rows[0].solicitante_id,
  };
}

/**
 * Fecha o pedido. O trigger recusa qualquer destino que não esteja em
 * transicao_solicitacao, e o CHECK chk_nao_autoaprova recusa o decisor que é o
 * próprio solicitante — as duas garantias ficam no banco, não aqui.
 */
export async function decidir(
  tx: Tx,
  id: number,
  estado: "aprovada" | "negada",
  decidorId: number
): Promise<void> {
  await tx.query(
    `UPDATE solicitacao_aprovacao
        SET estado = $2, decidido_por = $3, decidido_em = NOW()
      WHERE id = $1 AND estado = 'pendente'`,
    [id, estado, decidorId]
  );
}

/**
 * Varre vencidos. Chamado pela leitura da fila, não por cron: a fila é lida
 * muitas vezes por dia, e um pedido só precisa constar como expirado quando
 * alguém olha. Um job dedicado seria mais uma peça para manter viva.
 *
 * ponytail: se a fila crescer a ponto deste UPDATE pesar na leitura, mover para
 * o worker n8n que já roda de hora em hora.
 */
export async function expirarVencidas(tx: Tx): Promise<number> {
  const { rowCount } = await tx.query(
    `UPDATE solicitacao_aprovacao
        SET estado = 'expirada'
      WHERE estado = 'pendente' AND expira_em <= NOW()`
  );
  return rowCount ?? 0;
}
