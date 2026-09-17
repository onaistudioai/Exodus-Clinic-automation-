import "server-only";
import type { Tx } from "@/lib/db";
import { withTenant } from "@/lib/tenant";

/**
 * Fila de aprovação para pedidos do WhatsApp que excedem o vínculo (W2g,
 * .planning/identidade/sql/007-solicitacao-paciente.sql). Responsabilidade
 * única: abrir e ler pedidos. Decidir/executar mora em
 * src/lib/aprovacao-paciente.ts, mesmo split de aprovacao.repo.ts/rbac-aprovacao.ts.
 */

export type MotivoSolicitacao =
  | "menor_sem_autoatendimento"
  | "nivel_insuficiente"
  | "responsavel_sem_vinculo";

export interface SolicitacaoPaciente {
  id: number;
  chatId: string;
  pacienteId: number | null;
  pacienteNome: string | null;
  motivo: MotivoSolicitacao;
  acaoPretendida: string;
  argumentos: Record<string, unknown>;
  estado: string;
  estadoRotulo: string;
  criadoEm: Date;
  expiraEm: Date;
}

const SELECT_BASE = `
  SELECT s.id, s.chat_id, s.paciente_id, p.nome_completo AS paciente_nome,
         s.motivo, s.acao_pretendida, s.argumentos,
         s.estado, e.rotulo AS estado_rotulo,
         s.criado_em, s.expira_em
    FROM solicitacao_paciente s
    JOIN estado_solicitacao e ON e.chave = s.estado
    LEFT JOIN pacientes p ON p.id = s.paciente_id
`;

interface Row {
  id: number;
  chat_id: string;
  paciente_id: number | null;
  paciente_nome: string | null;
  motivo: MotivoSolicitacao;
  acao_pretendida: string;
  argumentos: Record<string, unknown>;
  estado: string;
  estado_rotulo: string;
  criado_em: Date;
  expira_em: Date;
}

function mapear(r: Row): SolicitacaoPaciente {
  return {
    id: r.id,
    chatId: r.chat_id,
    pacienteId: r.paciente_id,
    pacienteNome: r.paciente_nome,
    motivo: r.motivo,
    acaoPretendida: r.acao_pretendida,
    argumentos: r.argumentos,
    estado: r.estado,
    estadoRotulo: r.estado_rotulo,
    criadoEm: r.criado_em,
    expiraEm: r.expira_em,
  };
}

/** A fila do aprovador — mesma exclusão de vencidas de aprovacao.repo.ts::listarPendentes. */
export async function listarPendentes(tx: Tx): Promise<SolicitacaoPaciente[]> {
  const { rows } = await tx.query<Row>(
    `${SELECT_BASE}
      WHERE s.estado = 'pendente' AND s.expira_em > NOW()
      ORDER BY s.criado_em`
  );
  return rows.map(mapear);
}

/** Trava o pedido para decisão. Mesmo padrão de aprovacao.repo.ts::travarParaDecisao. */
export async function travarParaDecisao(
  tx: Tx,
  id: number
): Promise<{ pacienteId: number | null; motivo: MotivoSolicitacao; argumentos: Record<string, unknown> } | null> {
  const { rows } = await tx.query<{
    paciente_id: number | null;
    motivo: MotivoSolicitacao;
    argumentos: Record<string, unknown>;
  }>(
    `SELECT paciente_id, motivo, argumentos
       FROM solicitacao_paciente
      WHERE id = $1 AND estado = 'pendente' AND expira_em > NOW()
        FOR UPDATE`,
    [id]
  );
  if (rows.length === 0) return null;
  return { pacienteId: rows[0].paciente_id, motivo: rows[0].motivo, argumentos: rows[0].argumentos };
}

/** Fecha o pedido — o trigger e o CHECK de coerência garantem o resto. */
export async function decidir(
  tx: Tx,
  id: number,
  estado: "aprovada" | "negada",
  decidorId: number
): Promise<void> {
  await tx.query(
    `UPDATE solicitacao_paciente
        SET estado = $2, decidido_por = $3, decidido_em = NOW()
      WHERE id = $1 AND estado = 'pendente'`,
    [id, estado, decidorId]
  );
}

/**
 * Porta estreita para abrir um pedido a partir do gate de identidade
 * (sofia-paciente.ts / identidade.repo.ts) — mesmo padrão de FreioIdentidade
 * (Fase 1) e EscalonarReconfirmacao (Fase 2): a implementação real roda em
 * withTenant PRÓPRIO, porque /api/sofia/paciente usa withTenantReadOnly e
 * abrir pedido é ESCRITA.
 */
export interface SolicitarAprovacaoPaciente {
  abrir(
    clinicaId: number,
    params: {
      chatId: string;
      pacienteId: number | null;
      motivo: MotivoSolicitacao;
      acaoPretendida: string;
      argumentos?: Record<string, unknown>;
    }
  ): Promise<void>;
}

/** Falha ABERTA com log: se o pedido não abrir, o gate ainda barra a ação — só se perde o aviso. */
export const solicitarAprovacaoPacientePg: SolicitarAprovacaoPaciente = {
  async abrir(clinicaId, params) {
    try {
      await withTenant(clinicaId, (tx) =>
        tx.query(
          "SELECT abrir_solicitacao_paciente($1, $2, $3, $4, $5)",
          [
            params.chatId,
            params.pacienteId,
            params.motivo,
            params.acaoPretendida,
            JSON.stringify(params.argumentos ?? {}),
          ]
        )
      );
    } catch (err) {
      console.error("[solicitacao-paciente] falha ao abrir pedido, seguindo sem avisar o balcão:", err);
    }
  },
};
