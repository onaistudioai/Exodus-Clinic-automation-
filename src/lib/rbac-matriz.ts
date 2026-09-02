/**
 * O VOCABULÁRIO da autorização. Não a política.
 *
 * A distinção importa e é a razão deste arquivo ter encolhido:
 *
 *   - VOCABULÁRIO (aqui): quais papéis e quais ações EXISTEM. É tipo, vive em
 *     tempo de compilação, e serve para o TypeScript recusar `requireAcao("ver_agena")`.
 *   - POLÍTICA (banco, tabela `papel_acao`): QUEM PODE O QUÊ. É dado, muda sem
 *     deploy, e é auditável por quem não lê TypeScript.
 *
 * Antes, os dois moravam aqui — a política era o literal `MATRIZ`, e cada novo
 * consumidor (o chat, por exemplo) seria mais um lugar a reescrever a lista.
 * Ver .planning/acesso/sql/001-acesso.sql e o 002-verify.sql, que prova que a
 * tabela nasceu idêntica ao literal que estava aqui.
 *
 * Este arquivo continua sem `server-only` de propósito: é dado puro, carregável
 * fora do bundler do Next. O GATE fica em `rbac.ts`.
 */
/**
 * Arrays em vez de uniões escritas à mão: a união some em tempo de execução, e
 * uma união não pode ser comparada com o banco. Como array, o vocabulário fica
 * verificável — tests/integration/rbac.test.ts prova que estas listas e as
 * tabelas `papel`/`acao` não divergiram, o mesmo tipo de fronteira que a união
 * de status de agendamento deixou passar por duas migrações.
 */
export const PAPEIS = ["recepcao", "medico", "admin"] as const;

export const ACOES = [
  "checkin",
  "ler_texto_clinico",
  "criar_entrada_prontuario",
  "expurgo_logico",
  "ver_auditoria",
  "ver_estoque",
  "gerir_estoque",
  "configurar_bom",
  "ver_reativacao",
  "gerir_reativacao",
  "ver_financeiro",
  "gerir_financeiro",
  "ver_agenda",
  "gerir_agenda",
  "gerir_escala",
  "ver_crm",
  "gerir_crm",
  "ver_escalonamento",
  "gerir_escalonamento",
  "ver_solicitacoes",
  "aprovar_solicitacao",
  "usar_chat",
] as const;

export type Papel = (typeof PAPEIS)[number];
export type Acao = (typeof ACOES)[number];
