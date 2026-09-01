/**
 * Tipos de domínio compartilhados (contrato = DRAFT-prontuario-modelo.sql).
 * UI, actions e repositórios falam estes tipos. Datas como ISO string (YYYY-MM-DD)
 * ou ISO datetime; a borda do pg converte.
 */

export type StatusPaciente = "ativo" | "arquivado" | "mesclado";

/** Linha de resultado de busca de check-in — só o necessário p/ desambiguar sem abrir. */
export interface ResultadoBusca {
  id: number;
  nome_completo: string;
  data_nascimento: string; // ISO date
  idade: number;
  e_menor: boolean;
  cpf_last4: string | null;
  ultimo_atendimento: string | null; // ISO date | null
}

export interface Paciente {
  id: number;
  clinica_id: number;
  nome_completo: string;
  data_nascimento: string;
  cpf_last4: string | null;
  status: StatusPaciente;
  criado_em: string;
}

/** Resumo p/ a tela de merge — mostra os dois registros lado a lado + o que será movido. */
export interface ResumoMerge {
  id: number;
  nome_completo: string;
  data_nascimento: string;
  idade: number;
  cpf_last4: string | null;
  status: StatusPaciente;
  n_agendamentos: number;
  n_prontuario: number;
}

export type RelacaoResponsavel = "mae" | "pai" | "tutor" | "outro";

/** Dados para criar um paciente novo (input já validado). */
export interface NovoPaciente {
  nome: string;
  dataNascimento: string;
  cpfHash: string | null;
  cpfLast4: string | null;
  criadoPor: number;
}

export interface NovoResponsavel {
  nome: string;
  dataNascimento: string;
  relacao: RelacaoResponsavel;
  consentimentoPor: number;
}

// ---- Agendamentos ----
// A união mora em lib/status-agendamento.ts (fonte única, comparada com o CHECK
// do banco por tests/integration/schema-contract.test.ts). Aqui só reexporta,
// para não voltar a existir duas listas que divergem em silêncio.
import type { StatusAgendamento } from "@/lib/status-agendamento";
export type { StatusAgendamento };

export interface AgendamentoResumo {
  id: number;
  data_agendamento: string;
  hora_agendamento: string;
  status: string;
  paciente_id: number | null;
  identidade_confirmada_em: string | null;
}

// ---- Prontuário ----
export type EstadoEntrada = "rascunho" | "finalizado";
export type TipoAtendimento =
  | "consulta"
  | "retorno"
  | "procedimento"
  | "avaliacao"
  | "limpeza";
export const RETORNO_DIAS = [7, 15, 30, 60, 90, 180] as const;

export interface EntradaProntuario {
  id: number;
  paciente_id: number;
  agendamento_id: number | null;
  profissional_id: number;
  estado: EstadoEntrada;
  texto_clinico: string | null;
  tipo_atendimento: TipoAtendimento | null;
  precisa_retorno: boolean | null;
  retorno_em_dias: number | null;
  orientacoes_paciente: string | null;
  expurgado: boolean;
  criado_em: string;
  finalizado_em: string | null;
}

/** Etiquetas estruturadas que a RECEPÇÃO pode ver (sem texto clínico). */
export interface EntradaEtiqueta {
  id: number;
  estado: EstadoEntrada;
  tipo_atendimento: TipoAtendimento | null;
  precisa_retorno: boolean | null;
  criado_em: string;
}

// ---- Estoque ----
export type TipoMovimentacao = "entrada" | "saida" | "ajuste" | "estorno";
export type MotivoMovimentacao =
  | "compra"
  | "consumo"
  | "perda"
  | "vencimento"
  | "ajuste_inventario"
  | "estorno"
  | "divergencia";

export interface Produto {
  id: number;
  clinica_id: number;
  nome: string;
  categoria: string | null;
  unidade: string;
  estoque_minimo: number;
  controlado: boolean;
  ativo: boolean;
  criado_em: string;
}

export interface Lote {
  id: number;
  clinica_id: number;
  produto_id: number;
  codigo_lote: string | null;
  validade: string | null; // ISO date | null (não perecível)
  quantidade: number; // saldo corrente do lote (pode ser negativo — política C3)
  custo_unitario: number;
  criado_em: string;
}

export interface MovimentacaoEstoque {
  id: number;
  clinica_id: number;
  produto_id: number;
  lote_id: number | null;
  tipo: TipoMovimentacao;
  motivo: MotivoMovimentacao;
  quantidade: number; // SINALIZADA: entrada/estorno +, saida/perda -
  custo_unitario: number | null;
  agendamento_id: number | null;
  entrada_prontuario_id: number | null;
  usuario_id: number | null;
  observacao: string | null;
  criado_em: string;
}

/** Item do kit (BOM) de um procedimento. */
export interface BomItem {
  id: number;
  tipo_atendimento: TipoAtendimento;
  produto_id: number;
  produto_nome: string;
  unidade: string;
  quantidade: number;
}

/** Nível atual de um produto (derivado: SUM dos lotes) + flags de alerta. */
export interface NivelProduto {
  produto_id: number;
  nome: string;
  categoria: string | null;
  unidade: string;
  estoque_minimo: number;
  quantidade_total: number; // SUM(lotes.quantidade)
  abaixo_minimo: boolean;
  proxima_validade: string | null; // lote que vence antes (com saldo > 0)
}

export type TipoAlerta = "ruptura" | "validade_proxima" | "vencido" | "saldo_negativo";

/** Linha do painel de alertas (ruptura / validade / saldo negativo). */
export interface AlertaEstoque {
  tipo: TipoAlerta;
  produto_id: number;
  produto_nome: string;
  unidade: string;
  quantidade_total: number;
  estoque_minimo: number;
  lote_id: number | null;
  codigo_lote: string | null;
  validade: string | null;
  dias_para_vencer: number | null;
}

/** Resultado da baixa automática por atendimento (política C3). */
export interface ResultadoBaixa {
  itens_baixados: number;
  itens_com_divergencia: number; // baixou parcial / saldo negativo
  custo_total: number;
  ja_baixado?: boolean; // M2: kit já consumido por este agendamento — baixa pulada
}

/** Custo de material agregado por procedimento (relatório). */
export interface CustoProcedimento {
  tipo_atendimento: TipoAtendimento;
  n_atendimentos: number;
  custo_total: number;
  custo_medio: number;
}

export type AcaoAuditoria = "leu" | "criou" | "finalizou" | "corrigiu" | "expurgou";

/** Linha da trilha de auditoria (admin) — quem acessou o quê e quando. */
export interface AcessoLog {
  id: number;
  acao: AcaoAuditoria;
  detalhe: string | null;
  criado_em: string;
  usuario_nome: string | null;
  usuario_papel: string | null;
  paciente_nome: string | null;
  paciente_id: number | null;
  entrada_id: number | null;
}

// ---- Reativação ----
export type EstadoAlvo = "ativo" | "reativado" | "optout" | "concluido";
export type ModoEnvio = "dry" | "live";

/** Um passo da cadência: quando (offset em dias) e o template da mensagem. */
export interface PassoCampanha {
  offset_dias: number;
  template: string; // suporta {nome} e {clinica}
}

/** Campanha de reativação (cadência) por clínica. Máx. 1 ativa por clínica. */
export interface Campanha {
  id: number;
  clinica_id: number;
  nome: string;
  janela_dias: number; // inativo = sem retorno há >= janela_dias
  passos: PassoCampanha[];
  ativa: boolean;
  criado_em: string;
  atualizado_em: string;
}

/** Paciente elegível (view v_reativacao_inativos) — sem o filtro de janela. */
export interface InativoElegivel {
  paciente_id: number;
  nome_completo: string;
  ultimo_atendimento: string; // ISO date
  dias_inativo: number;
  contato_id: number;
  chat_id: string;
  telefone: string;
}

/** Paciente dentro de uma sequência ativa. */
export interface AlvoReativacao {
  id: number;
  clinica_id: number;
  campanha_id: number;
  paciente_id: number;
  contato_id: number | null;
  passo_atual: number; // índice 0-based do PRÓXIMO passo a enviar
  proximo_envio: string; // ISO datetime
  status: EstadoAlvo;
  entrou_em: string;
  reativado_em: string | null;
  atualizado_em: string;
}

/** Linha do livro-razão append-only de envios. */
export interface EnvioReativacao {
  id: number;
  clinica_id: number;
  alvo_id: number;
  passo: number;
  modo: ModoEnvio;
  wa_status: string | null; // 'simulado' | 'ok' | 'erro'
  wa_erro: string | null;
  enviado_em: string;
}

/** Métricas agregadas da campanha (painel). */
export interface MetricasReativacao {
  elegiveis: number; // inativos que passam na janela e ainda não estão em sequência
  em_sequencia: number; // alvos status='ativo'
  enviados: number; // envios distintos (alvo,passo) modo live
  reativados: number; // alvos status='reativado'
  optout: number;
  taxa_reativacao: number; // reativados / (reativados + em_sequencia + concluido), 0..1
  /** Soma das cobranças não-canceladas geradas por pacientes reativados, na janela. */
  receita_recuperada: number;
  /** Quantos pacientes reativados de fato geraram cobrança (<= reativados). */
  pacientes_faturados: number;
}

/** Resultado de uma materialização de público (entrar pacientes na sequência). */
export interface ResultadoMaterializacao {
  inseridos: number;
  ignorados: number; // já estavam em sequência/opt-out
}

// ---- Financeiro ----
export type StatusCobranca = "aberta" | "paga" | "cancelada";
export type TipoLancamento = "receita" | "despesa";
export type FormaPagamento = "pix" | "cartao" | "dinheiro" | "outro";

/** Categorias de despesa sugeridas (F3 da pesquisa). Campo é texto livre; isto é só o catálogo da UI. */
export const CATEGORIAS_DESPESA = [
  "aluguel",
  "salarios",
  "material",
  "impostos",
  "marketing",
  "equipamentos",
  "terceiros",
  "outros",
] as const;
export type CategoriaDespesa = (typeof CATEGORIAS_DESPESA)[number];

/** Preço por tipo de atendimento (tabela editável; override por cobrança). */
export interface PrecoProcedimento {
  id: number;
  clinica_id: number;
  tipo_atendimento: TipoAtendimento;
  valor: number; // NUMERIC(12,2) lido como float8
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

/** Recebível do paciente por um atendimento (mutável: status muda). */
export interface Cobranca {
  id: number;
  clinica_id: number;
  paciente_id: number;
  paciente_nome?: string | null; // join p/ exibição
  entrada_prontuario_id: number | null;
  agendamento_id: number | null;
  tipo_atendimento: TipoAtendimento | null;
  valor: number;
  vencimento: string; // ISO date
  status: StatusCobranca;
  forma_pagamento: FormaPagamento | null;
  pago_em: string | null;
  motivo_cancelamento: string | null;
  dias_atraso?: number; // derivado: vencimento < hoje && aberta
  criado_em: string;
  atualizado_em: string;
}

/** Linha do livro-razão append-only do caixa. valor sempre > 0; direção vem do tipo. */
export interface Lancamento {
  id: number;
  clinica_id: number;
  tipo: TipoLancamento;
  categoria: string | null;
  valor: number;
  descricao: string | null;
  cobranca_id: number | null;
  forma_pagamento: FormaPagamento | null;
  usuario_id: number | null;
  criado_em: string;
}

/** Resumo de caixa de um período (derivado SÓ do livro-razão). */
export interface ResumoCaixa {
  receitas: number;
  despesas: number;
  saldo: number; // receitas − despesas
}

/** Uma faixa do aging de contas a receber (inadimplência por idade da dívida). */
export interface LinhaAging {
  faixa: "a_vencer" | "0_30" | "31_60" | "61_90" | "90_mais";
  quantidade: number;
  valor_total: number;
}

/** Margem por procedimento = receita das cobranças − custo de material (Estoque). */
export interface MargemProcedimento {
  tipo_atendimento: TipoAtendimento;
  n_cobrancas: number;
  receita_total: number;
  custo_material: number;
  margem: number; // receita − custo
}

/** Indicadores do topo do painel /financeiro (D7 da pesquisa). */
export interface IndicadoresFinanceiro {
  caixa_dia: number;
  caixa_mes: number;
  a_receber: number; // soma das cobranças abertas
  inadimplencia_valor: number; // abertas e vencidas
  inadimplencia_pct: number; // inadimplência / a_receber, 0..1
  faturamento_mes: number; // receitas do mês
  ticket_medio: number; // faturamento_mes / nº cobranças pagas no mês
}

// ---- Agenda + Turnos ----
/** Dia da semana no padrão extract(dow): 0=domingo .. 6=sábado. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const DIAS_SEMANA: { v: DiaSemana; label: string }[] = [
  { v: 1, label: "Seg" },
  { v: 2, label: "Ter" },
  { v: 3, label: "Qua" },
  { v: 4, label: "Qui" },
  { v: 5, label: "Sex" },
  { v: 6, label: "Sáb" },
  { v: 0, label: "Dom" },
];

/** Profissional (entidade real, separada do login). */
export interface Profissional {
  id: number;
  clinica_id: number;
  nome: string;
  especialidade: string | null;
  usuario_id: number | null; // nullable: profissional sem login no painel
  ativo: boolean;
  criado_em: string;
}

/** Serviço do catálogo (nome → duração padrão). */
export interface Servico {
  id: number;
  clinica_id: number;
  nome: string;
  duracao_min: number;
  ativo: boolean;
  criado_em: string;
}

/** Turno recorrente semanal — janela de trabalho = fonte de disponibilidade. */
export interface Turno {
  id: number;
  clinica_id: number;
  profissional_id: number;
  profissional_nome?: string | null; // join p/ exibição
  dia_semana: DiaSemana;
  hora_inicio: string; // "HH:MM"
  hora_fim: string; // "HH:MM"
  vigencia_inicio: string; // ISO date
  vigencia_fim: string | null;
  ativo: boolean;
  criado_em: string;
}

/** Bloqueio pontual (exceção que fura o turno). profissional_id null = clínica toda. */
export interface Bloqueio {
  id: number;
  clinica_id: number;
  profissional_id: number | null;
  profissional_nome?: string | null;
  inicio: string; // ISO datetime
  fim: string; // ISO datetime
  motivo: string | null;
  criado_em: string;
}

/** Um horário livre calculado p/ um profissional num dia (disponibilidade). */
export interface SlotLivre {
  profissional_id: number;
  inicio: string; // ISO datetime com offset (p/ submissão)
  fim: string;
  hora_label: string; // "HH:MM" em hora local da clínica (p/ exibição)
}

/** Linha da agenda do dia (agendamento + nomes resolvidos). */
export interface AgendamentoDia {
  id: number;
  clinica_id: number;
  paciente_id: number | null;
  paciente_nome: string | null;
  profissional_id: number | null;
  profissional_nome: string | null;
  servico_id: number | null;
  servico_nome: string | null;
  inicio: string | null; // ISO datetime com offset (p/ remarcar)
  fim: string | null;
  hora_inicio_label: string | null; // "HH:MM" local da clínica
  hora_fim_label: string | null;
  status: StatusAgendamento;
  overbooking_intencional: boolean;
  identidade_confirmada_em: string | null;
}

/** Indicadores do painel de agenda (D5): ocupação + no-show. */
export interface IndicadoresAgenda {
  agendados: number; // no período
  realizados: number;
  no_show: number;
  taxa_no_show: number; // no_show / (realizados + no_show), 0..1
  ocupacao_pct: number; // horas agendadas / horas disponíveis (turnos), 0..1
}

// ---- CRM (relacionamento com o paciente) ----
/**
 * Estágio de vida do paciente — DERIVADO em runtime (sem tabela). Prioridade do
 * estágio primário: inadimplente > inativo > em_tratamento > novo > ativo.
 */
export type EstagioCrm =
  | "inadimplente"
  | "inativo"
  | "em_tratamento"
  | "novo"
  | "ativo";

export const ESTAGIOS_CRM: { v: EstagioCrm; label: string; cls: string }[] = [
  { v: "inadimplente", label: "Inadimplente", cls: "text-rose-700 bg-rose-50 ring-rose-200" },
  { v: "inativo", label: "Inativo", cls: "text-amber-700 bg-amber-50 ring-amber-200" },
  { v: "em_tratamento", label: "Em tratamento", cls: "text-emerald-700 bg-emerald-50 ring-emerald-200" },
  { v: "novo", label: "Novo", cls: "text-sky-700 bg-sky-50 ring-sky-200" },
  { v: "ativo", label: "Ativo", cls: "text-neutral-700 bg-neutral-50 ring-neutral-200" },
];

/** Uma linha do pipeline (paciente + estágio derivado + sinais). */
export interface LinhaPipeline {
  paciente_id: number;
  nome_completo: string;
  estagio: EstagioCrm;
  ultimo_atendimento: string | null; // ISO date | null
  dias_inativo: number | null;
  tem_agendamento_futuro: boolean;
  inadimplente: boolean;
  tarefas_abertas: number;
}

/** Contagem de pacientes por estágio (cabeçalho do pipeline). */
export interface ContagemEstagio {
  estagio: EstagioCrm;
  total: number;
}

/** Tarefa de follow-up do CRM (tabela crm_tarefas). */
export interface TarefaCrm {
  id: number;
  paciente_id: number;
  titulo: string;
  descricao: string | null;
  vencimento: string | null; // ISO date | null
  status: "aberta" | "concluida";
  criado_por: number | null;
  criado_em: string;
  concluida_em: string | null;
}

/** Linha enxuta de agendamento para a ficha 360 (agendamentos_sofia_demo). */
export interface AgendamentoPaciente {
  id: number;
  data_agendamento: string; // ISO date
  hora_agendamento: string | null;
  status: string;
}

/** Cobrança enxuta p/ a ficha 360 (evita puxar a linha inteira do financeiro). */
export interface CobrancaResumo {
  id: number;
  valor: number;
  vencimento: string; // ISO date
  status: StatusCobranca;
  tipo_atendimento: TipoAtendimento | null;
  dias_atraso: number;
}

/** Bloco não-clínico da ficha 360 (agrega o que não exige RBAC clínico). */
export interface Ficha360 {
  paciente: {
    id: number;
    nome_completo: string;
    data_nascimento: string;
    idade: number;
    e_menor: boolean;
    cpf_last4: string | null;
    status: string;
    criado_em: string;
    /** Migração 005 (direitos do titular). NULL = nenhum pedido registrado. */
    eliminacao_pedida_em: string | null;
    anonimizado_em: string | null;
  };
  estagio: EstagioCrm;
  proximos: AgendamentoPaciente[];
  ultimos: AgendamentoPaciente[];
  cobrancas: CobrancaResumo[];
  reativacao_status: EstadoAlvo | null;
  tarefas: TarefaCrm[];
}
