import "server-only";
import type { Papel } from "@/lib/session";
import { verifySession } from "@/lib/dal";

/**
 * B4 — RBAC mínimo (DRAFT-fase0.md §0.4). Gate por `papel`.
 *
 * | Ação                          | recepcao | medico | admin |
 * | Check-in (criar/confirmar/merge) |   ✅   |   —    |  ✅   |
 * | Ler texto clínico do prontuário  |   —    |   ✅   |  ✅   |
 * | Criar/finalizar entrada          |   —    |   ✅   |  —    |
 * | Expurgo lógico (LGPD)            |   —    |   —    |  ✅   |
 * | Ver auditoria                    |   —    |   —    |  ✅   |
 * | Ver estoque (níveis/alertas)     |   ✅   |   ✅   |  ✅   |
 * | Gerir estoque (produto/lote/ajuste) | ✅ |   —    |  ✅   |
 * | Configurar BOM (kit/procedimento)|   —    |   —    |  ✅   |
 * | Ver reativação (público/métricas)|   ✅   |   ✅   |  ✅   |
 * | Gerir reativação (campanha/disparo)| ✅  |   —    |  ✅   |
 * | Ver financeiro (caixa/recebíveis)|   ✅   |   ✅   |  ✅   |
 * | Gerir financeiro (preço/pagar/lançar)| ✅ |   —    |  ✅   |
 * | Ver agenda (calendário/disponibilidade)| ✅ |  ✅   |  ✅   |
 * | Gerir agenda (marcar/remarcar/confirmar)| ✅ |  —    |  ✅   |
 * | Gerir escala (profissionais/serviços/turnos)| — | —  |  ✅   |
 *
 * Decisão travada: recepção NÃO lê texto clínico (só etiquetas estruturadas).
 */
export type Acao =
  | "checkin"
  | "ler_texto_clinico"
  | "criar_entrada_prontuario"
  | "expurgo_logico"
  | "ver_auditoria"
  | "ver_estoque"
  | "gerir_estoque"
  | "configurar_bom"
  | "ver_reativacao"
  | "gerir_reativacao"
  | "ver_financeiro"
  | "gerir_financeiro"
  | "ver_agenda"
  | "gerir_agenda"
  | "gerir_escala"
  | "ver_crm"
  | "gerir_crm";

const MATRIZ: Record<Acao, Papel[]> = {
  checkin: ["recepcao", "admin"],
  ler_texto_clinico: ["medico", "admin"],
  criar_entrada_prontuario: ["medico"],
  expurgo_logico: ["admin"],
  ver_auditoria: ["admin"],
  ver_estoque: ["recepcao", "medico", "admin"],
  gerir_estoque: ["recepcao", "admin"],
  configurar_bom: ["admin"],
  ver_reativacao: ["recepcao", "medico", "admin"],
  gerir_reativacao: ["recepcao", "admin"],
  ver_financeiro: ["recepcao", "medico", "admin"],
  gerir_financeiro: ["recepcao", "admin"],
  ver_agenda: ["recepcao", "medico", "admin"],
  gerir_agenda: ["recepcao", "admin"],
  gerir_escala: ["admin"],
  ver_crm: ["recepcao", "medico", "admin"],
  gerir_crm: ["recepcao", "admin"],
};

export function podeFazer(papel: Papel, acao: Acao): boolean {
  return MATRIZ[acao].includes(papel);
}

/** Gate de servidor: lança se a sessão não tem o papel para a ação. */
export async function requireAcao(acao: Acao): Promise<void> {
  const session = await verifySession();
  if (!podeFazer(session.papel, acao)) {
    throw new Error(`Acesso negado: papel '${session.papel}' não pode '${acao}'.`);
  }
}
