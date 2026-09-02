import "server-only";
import { withTenant } from "@/lib/tenant";

/**
 * Abre escalonamento (fila do balcão) para contato em `a_reconfirmar`
 * (.planning/identidade/sql/003-reconfirmacao.sql). Responsabilidade única:
 * avisar o balcão. Não decide confiança (identidade.repo.ts) nem orquestra o
 * gate (sofia-paciente.ts).
 *
 * Reusa `abrir_escalonamento`, já idempotente por (clinica_id, chat_id,
 * status='aberto') — um contato que manda 40 mensagens não abre 40 itens.
 *
 * Porta estreita, mesmo motivo de FreioIdentidade na Fase 1: identificarPaciente
 * depende deste tipo, não do pg direto.
 */
export interface EscalonarReconfirmacao {
  abrir(clinicaId: number, chatId: string): Promise<void>;
}

/**
 * Implementação pg. Roda em withTenant PRÓPRIO (tx nova, fora da tx do
 * caller) pelo mesmo motivo do freio na Fase 1: /api/sofia/paciente abre com
 * withTenantReadOnly, e abrir escalonamento é ESCRITA.
 *
 * Falha ABERTA com log: se o escalonamento não abrir, o paciente ainda
 * precisa receber a resposta neutra (o gate em si não depende disto). O que
 * se perde é só o aviso ao balcão, não a trava de identidade.
 */
export const escalonarReconfirmacaoPg: EscalonarReconfirmacao = {
  async abrir(clinicaId, chatId) {
    try {
      await withTenant(clinicaId, (tx) =>
        tx.query("SELECT abrir_escalonamento($1, 'reconfirmar_identidade', NULL)", [chatId])
      );
    } catch (err) {
      console.error("[escalonar-reconfirmacao] falha ao abrir escalonamento, seguindo sem avisar o balcão:", err);
    }
  },
};
