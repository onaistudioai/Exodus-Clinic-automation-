import "server-only";
import { pool } from "@/lib/db";

/**
 * Freio de força bruta na confirmação de identidade por WhatsApp
 * (.planning/identidade/sql/001-freio-identidade.sql).
 *
 * Responsabilidade única: contar tentativa e dizer quanto falta de bloqueio.
 * Não resolve identidade (identidade.repo.ts) nem orquestra o gate
 * (sofia-paciente.ts) — motivo de mudança diferente, arquivo diferente.
 *
 * Porta estreita: identificarPaciente() depende deste tipo, não do pg. A
 * implementação real fica injetada por default (abaixo) e é substituível por
 * um fake no teste sem que o gate perceba a troca (LSP).
 */
export interface FreioIdentidade {
  /** Só lê o estado atual — não conta como tentativa. */
  consultar(telefone: string): Promise<number>;
  /** Registra uma tentativa de fato ocorrida e devolve segundos de bloqueio (0 = liberado). */
  registrar(telefone: string, sucesso: boolean): Promise<number>;
}

/**
 * Implementação pg. Roda em `pool.query` direto, FORA de qualquer tx aberta
 * pelo caller — mesmo padrão de src/lib/rate-limit.ts (fn_login_freio).
 *
 * Isto não é só convenção: /api/sofia/paciente abre a tx com
 * withTenantReadOnly (`SET TRANSACTION READ ONLY`), e o freio ESCREVE. Uma
 * função SECURITY DEFINER não escapa de READ ONLY na MESMA transação — só uma
 * conexão own do pool consegue.
 *
 * Falha ABERTA de propósito: se o banco do freio estiver indisponível, isso
 * não pode ser o motivo de um paciente legítimo não conseguir confirmar
 * identidade. A confirmação em si (confirmarIdentidade, no banco principal)
 * continua sendo o gate de verdade.
 */
export const freioIdentidadePg: FreioIdentidade = {
  async consultar(telefone) {
    try {
      const { rows } = await pool.query<{ espera: number }>(
        "SELECT fn_identidade_freio_consultar($1) AS espera",
        [telefone]
      );
      return rows[0]?.espera ?? 0;
    } catch (err) {
      console.error("[freio-identidade] consulta indisponível, seguindo sem freio:", err);
      return 0;
    }
  },

  async registrar(telefone, sucesso) {
    try {
      const { rows } = await pool.query<{ espera: number }>(
        "SELECT fn_identidade_freio($1, $2) AS espera",
        [telefone, sucesso]
      );
      return rows[0]?.espera ?? 0;
    } catch (err) {
      console.error("[freio-identidade] registro indisponível, seguindo sem freio:", err);
      return 0;
    }
  },
};
