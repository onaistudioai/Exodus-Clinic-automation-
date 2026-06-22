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
export type StatusAgendamento =
  | "pendente"
  | "confirmada"
  | "cancelada"
  | "remarcacao_pendente"
  | "realizada"
  | "no_show";

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
}

/** Resultado de uma materialização de público (entrar pacientes na sequência). */
export interface ResultadoMaterializacao {
  inseridos: number;
  ignorados: number; // já estavam em sequência/opt-out
}
