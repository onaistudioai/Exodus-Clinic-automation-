/**
 * A POLÍTICA de autorização, separada do GATE que a aplica.
 *
 * Por que dois arquivos: `rbac.ts` importa `server-only` e `next/headers`, o que
 * o torna impossível de carregar fora do bundler do Next — inclusive num teste.
 * A matriz é dado puro e é justamente a parte que precisa de teste, então ela
 * mora aqui, sem dependência de runtime. `rbac.ts` continua sendo a porta única
 * que o app usa.
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
 * | Ver/atender fila de escalonamento |   ✅   |   ✅   |  ✅   |
 *
 * Decisão travada: recepção NÃO lê texto clínico (só etiquetas estruturadas).
 */
export type Papel = "recepcao" | "medico" | "admin";

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
  | "gerir_crm"
  | "ver_escalonamento"
  | "gerir_escalonamento";

export const MATRIZ: Record<Acao, Papel[]> = {
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
  // Escalonamento é fila de atendimento humano: o médico VÊ (o gatilho é clínico)
  // e a recepção RESOLVE. Ninguém apaga — o histórico prova o Anexo I §5.
  ver_escalonamento: ["recepcao", "medico", "admin"],
  gerir_escalonamento: ["recepcao", "medico", "admin"],
};

export function podeFazer(papel: Papel, acao: Acao): boolean {
  return MATRIZ[acao].includes(papel);
}
