/**
 * Taxonomia de intenção (§8 da Camada A). Fonte única no TypeScript, espelhando
 * o enum `intencao_msg` do banco (.planning/camada-a/sql/004-telemetria.sql).
 *
 * Mesma razão de existir de `status-agendamento.ts`: lista escrita duas vezes é
 * lista que diverge. tests/integration/schema-contract compara com o enum real.
 */
export const INTENCOES = [
  "confirmacao_positiva",
  "confirmacao_negativa",
  "pedido_remarcacao",
  "duvida_preco",
  "duvida_procedimento",
  "duvida_horario",
  "duvida_localizacao",
  "duvida_convenio",
  "reclamacao",
  "fora_de_escopo",
  "spam",
  "ambigua",
] as const;

export type Intencao = (typeof INTENCOES)[number];
