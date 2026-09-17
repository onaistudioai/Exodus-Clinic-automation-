/**
 * Dados FICTÍCIOS da demo pública (/demo). Nada de banco/auth — puro frontend
 * para gravar vídeo de apresentação do Exodus enquanto o backend não está pronto.
 * Nomes/valores são inventados. Não usar em produção.
 */

export const CLINICA = { nome: "Clínica Aurora Odonto & Estética", cidade: "Florianópolis · SC" };

export type Estagio = "inadimplente" | "inativo" | "em_tratamento" | "novo" | "ativo";

export const ESTAGIOS: { v: Estagio; label: string; dot: string; chip: string }[] = [
  { v: "em_tratamento", label: "Em tratamento", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  { v: "novo", label: "Novos", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
  { v: "ativo", label: "Ativos", dot: "bg-neutral-400", chip: "bg-neutral-50 text-neutral-600 ring-neutral-200" },
  { v: "inativo", label: "Inativos", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  { v: "inadimplente", label: "Inadimplentes", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
];

export const KPIS = {
  faturamento_mes: 48720,
  no_show_pct: 0.09,
  reativados: 23,
  ocupacao_pct: 0.82,
  a_receber: 12940,
  pacientes_ativos: 312,
};

export type PacientePipeline = {
  id: number;
  nome: string;
  estagio: Estagio;
  ultimo: string; // dd/mm
  dias: number | null;
  tarefas: number;
};

export const PIPELINE: PacientePipeline[] = [
  { id: 1, nome: "Marina Alves", estagio: "em_tratamento", ultimo: "12/07", dias: 8, tarefas: 1 },
  { id: 2, nome: "Rafael Souza", estagio: "inadimplente", ultimo: "02/06", dias: 48, tarefas: 2 },
  { id: 3, nome: "Camila Nunes", estagio: "novo", ultimo: "—", dias: null, tarefas: 1 },
  { id: 4, nome: "João Pedro Lima", estagio: "inativo", ultimo: "14/03", dias: 128, tarefas: 0 },
  { id: 5, nome: "Beatriz Rocha", estagio: "em_tratamento", ultimo: "18/07", dias: 2, tarefas: 0 },
  { id: 6, nome: "Lucas Martins", estagio: "ativo", ultimo: "30/06", dias: 20, tarefas: 0 },
  { id: 7, nome: "Ana Clara Dias", estagio: "inativo", ultimo: "22/02", dias: 148, tarefas: 1 },
  { id: 8, nome: "Felipe Carvalho", estagio: "novo", ultimo: "—", dias: null, tarefas: 0 },
  { id: 9, nome: "Juliana Prado", estagio: "em_tratamento", ultimo: "15/07", dias: 5, tarefas: 2 },
  { id: 10, nome: "Gustavo Reis", estagio: "inadimplente", ultimo: "10/05", dias: 71, tarefas: 1 },
  { id: 11, nome: "Patrícia Gomes", estagio: "ativo", ultimo: "28/06", dias: 22, tarefas: 0 },
  { id: 12, nome: "Rodrigo Teixeira", estagio: "ativo", ultimo: "01/07", dias: 19, tarefas: 0 },
];

export function contarEstagios(): Record<Estagio, number> {
  return PIPELINE.reduce(
    (acc, p) => ({ ...acc, [p.estagio]: (acc[p.estagio] ?? 0) + 1 }),
    {} as Record<Estagio, number>
  );
}

/** Ficha 360 destaque (Marina Alves). */
export const FICHA = {
  id: 1,
  nome: "Marina Alves",
  idade: 34,
  desde: "mar/2024",
  estagio: "em_tratamento" as Estagio,
  reativacao: null as string | null,
  proximos: [
    { data: "24/07", hora: "14:30", tipo: "Retorno", prof: "Dra. Helena" },
  ],
  ultimos: [
    { data: "12/07", hora: "15:00", tipo: "Procedimento", prof: "Dra. Helena" },
    { data: "28/06", hora: "09:30", tipo: "Avaliação", prof: "Dra. Helena" },
  ],
  cobrancas: [
    { data: "12/07", tipo: "Procedimento", valor: 680, status: "paga" as const, atraso: 0 },
    { data: "24/07", tipo: "Retorno", valor: 180, status: "aberta" as const, atraso: 0 },
  ],
  historico: [
    { tipo: "Procedimento", data: "12/07", retorno: true },
    { tipo: "Avaliação", data: "28/06", retorno: false },
    { tipo: "Limpeza", data: "10/05", retorno: false },
  ],
  tarefas: [
    { id: 1, titulo: "Confirmar retorno de 24/07", venc: "23/07", feita: false },
    { id: 2, titulo: "Enviar orientações pós-procedimento", venc: null, feita: true },
  ],
};

/** Agenda do dia. */
export const AGENDA_HOJE = [
  { hora: "08:00", paciente: "Beatriz Rocha", prof: "Dra. Helena", servico: "Limpeza", status: "realizada" as const },
  { hora: "09:00", paciente: "Lucas Martins", prof: "Dr. André", servico: "Avaliação", status: "realizada" as const },
  { hora: "10:30", paciente: "Marina Alves", prof: "Dra. Helena", servico: "Retorno", status: "confirmada" as const },
  { hora: "11:30", paciente: "Patrícia Gomes", prof: "Dr. André", servico: "Procedimento", status: "confirmada" as const },
  { hora: "14:00", paciente: "Camila Nunes", prof: "Dra. Helena", servico: "Avaliação", status: "pendente" as const },
  { hora: "15:30", paciente: "Rodrigo Teixeira", prof: "Dr. André", servico: "Limpeza", status: "pendente" as const },
];

/** Ocupação por dia (seg→sáb), 0..1. */
export const OCUPACAO_SEMANA = [
  { dia: "Seg", v: 0.78 },
  { dia: "Ter", v: 0.9 },
  { dia: "Qua", v: 0.72 },
  { dia: "Qui", v: 0.85 },
  { dia: "Sex", v: 0.94 },
  { dia: "Sáb", v: 0.6 },
];

/** Prontuário — últimas evoluções (etiquetas, sem texto clínico na demo). */
export const PRONTUARIO = [
  { paciente: "Marina Alves", tipo: "Procedimento", data: "12/07", prof: "Dra. Helena", retorno: true, estado: "finalizado" as const },
  { paciente: "Beatriz Rocha", tipo: "Limpeza", data: "20/07", prof: "Dra. Helena", retorno: false, estado: "finalizado" as const },
  { paciente: "Lucas Martins", tipo: "Avaliação", data: "20/07", prof: "Dr. André", retorno: true, estado: "finalizado" as const },
  { paciente: "Juliana Prado", tipo: "Procedimento", data: "15/07", prof: "Dra. Helena", retorno: true, estado: "rascunho" as const },
];

/** Financeiro. */
export const FINANCEIRO = {
  caixa_mes: 41280,
  a_receber: 12940,
  inadimplencia: 3610,
  ticket_medio: 312,
  aging: [
    { faixa: "A vencer", valor: 9330, cls: "bg-emerald-500" },
    { faixa: "0–30 dias", valor: 1820, cls: "bg-amber-400" },
    { faixa: "31–60 dias", valor: 1090, cls: "bg-orange-500" },
    { faixa: "60+ dias", valor: 700, cls: "bg-rose-500" },
  ],
  cobrancas: [
    { paciente: "Rafael Souza", tipo: "Procedimento", valor: 1200, venc: "02/06", status: "aberta" as const, atraso: 48 },
    { paciente: "Gustavo Reis", tipo: "Avaliação", valor: 260, venc: "10/05", status: "aberta" as const, atraso: 71 },
    { paciente: "Marina Alves", tipo: "Procedimento", valor: 680, venc: "12/07", status: "paga" as const, atraso: 0 },
    { paciente: "Beatriz Rocha", tipo: "Limpeza", valor: 180, venc: "20/07", status: "paga" as const, atraso: 0 },
  ],
};

/** Reativação. */
export const REATIVACAO = {
  elegiveis: 41,
  em_sequencia: 18,
  reativados: 23,
  taxa: 0.36,
  passos: [
    { offset: "D+0", template: "Oi {nome}! Sentimos sua falta na {clinica}. Que tal agendar um retorno?" },
    { offset: "D+7", template: "{nome}, seu sorriso merece cuidado 😄 Temos horários essa semana." },
    { offset: "D+21", template: "Última lembrança, {nome}: condição especial de retorno válida até sexta." },
  ],
  inativos: [
    { nome: "João Pedro Lima", ultimo: "14/03", dias: 128 },
    { nome: "Ana Clara Dias", ultimo: "22/02", dias: 148 },
    { nome: "Carlos Menezes", ultimo: "05/03", dias: 137 },
    { nome: "Sofia Ribeiro", ultimo: "19/04", dias: 92 },
  ],
};

/** Estoque. */
export const ESTOQUE = {
  itens: [
    { nome: "Anestésico (tubete)", categoria: "Insumo", saldo: 42, minimo: 30, validade: "11/2026" },
    { nome: "Luvas nitrílicas (cx)", categoria: "EPI", saldo: 6, minimo: 10, validade: "03/2027" },
    { nome: "Resina composta A2", categoria: "Restaurador", saldo: 3, minimo: 5, validade: "08/2025" },
    { nome: "Gaze estéril (pct)", categoria: "Insumo", saldo: 58, minimo: 20, validade: "05/2028" },
    { nome: "Broca diamantada", categoria: "Instrumental", saldo: 14, minimo: 8, validade: "—" },
  ],
  alertas: [
    { tipo: "Ruptura", item: "Luvas nitrílicas", detalhe: "6 abaixo do mínimo (10)", cls: "text-rose-700 bg-rose-50 ring-rose-200" },
    { tipo: "Validade", item: "Resina composta A2", detalhe: "vence 08/2025 · saldo baixo (3)", cls: "text-amber-700 bg-amber-50 ring-amber-200" },
  ],
};

/* ════════════════════════════════════════════════════════════════
 * DADOS RICOS (v2) — módulos interativos da demo.
 * ════════════════════════════════════════════════════════════════ */

/* ---------- Escalas compartilhadas ---------- */

export type Gravidade = "estavel" | "atencao" | "grave" | "critico";

export const GRAVIDADES: Record<Gravidade, { label: string; dot: string; chip: string }> = {
  estavel: { label: "Estável", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  atencao: { label: "Atenção", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  grave: { label: "Grave", dot: "bg-orange-500", chip: "bg-orange-50 text-orange-700 ring-orange-200" },
  critico: { label: "Crítico", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
};
export const GRAVIDADE_ORDEM: Gravidade[] = ["estavel", "atencao", "grave", "critico"];

export const TIPOS_TRATAMENTO = [
  "Limpeza",
  "Avaliação",
  "Procedimento",
  "Retorno",
  "Ortodontia",
  "Estética",
] as const;
export type TipoTratamento = (typeof TIPOS_TRATAMENTO)[number];

/* ---------- AGENDA (mês, filtros, faltas, futuras, histórico) ---------- */

export const AGENDA_REF = { ano: 2026, mes: 6 /* julho (0-based) */, hoje: 21 };

export type Evento = {
  dia: number;
  hora: string;
  paciente: string;
  prof: string;
  tipo: TipoTratamento;
  gravidade: Gravidade;
  status: "realizada" | "confirmada" | "pendente" | "falta";
  noPrazo: boolean; // dentro da janela de atendimento
  prioridade: boolean;
};

export const AGENDA_MES: Evento[] = [
  { dia: 21, hora: "08:00", paciente: "Beatriz Rocha", prof: "Dra. Helena", tipo: "Limpeza", gravidade: "estavel", status: "realizada", noPrazo: true, prioridade: false },
  { dia: 21, hora: "09:00", paciente: "Lucas Martins", prof: "Dr. André", tipo: "Avaliação", gravidade: "atencao", status: "realizada", noPrazo: true, prioridade: false },
  { dia: 21, hora: "10:30", paciente: "Marina Alves", prof: "Dra. Helena", tipo: "Retorno", gravidade: "grave", status: "confirmada", noPrazo: true, prioridade: true },
  { dia: 21, hora: "11:30", paciente: "Patrícia Gomes", prof: "Dr. André", tipo: "Procedimento", gravidade: "atencao", status: "confirmada", noPrazo: false, prioridade: false },
  { dia: 21, hora: "14:00", paciente: "Camila Nunes", prof: "Dra. Helena", tipo: "Avaliação", gravidade: "estavel", status: "pendente", noPrazo: true, prioridade: false },
  { dia: 21, hora: "15:30", paciente: "Rodrigo Teixeira", prof: "Dr. André", tipo: "Limpeza", gravidade: "estavel", status: "pendente", noPrazo: true, prioridade: false },
  { dia: 22, hora: "09:00", paciente: "Rafael Souza", prof: "Dra. Helena", tipo: "Procedimento", gravidade: "critico", status: "confirmada", noPrazo: false, prioridade: true },
  { dia: 22, hora: "10:00", paciente: "Juliana Prado", prof: "Dr. André", tipo: "Ortodontia", gravidade: "atencao", status: "confirmada", noPrazo: true, prioridade: false },
  { dia: 23, hora: "14:30", paciente: "Marina Alves", prof: "Dra. Helena", tipo: "Retorno", gravidade: "grave", status: "pendente", noPrazo: true, prioridade: true },
  { dia: 24, hora: "08:30", paciente: "Gustavo Reis", prof: "Dr. André", tipo: "Estética", gravidade: "estavel", status: "pendente", noPrazo: true, prioridade: false },
  { dia: 24, hora: "11:00", paciente: "Ana Clara Dias", prof: "Dra. Helena", tipo: "Avaliação", gravidade: "grave", status: "pendente", noPrazo: false, prioridade: true },
  { dia: 28, hora: "09:30", paciente: "Felipe Carvalho", prof: "Dr. André", tipo: "Limpeza", gravidade: "estavel", status: "pendente", noPrazo: true, prioridade: false },
  { dia: 29, hora: "15:00", paciente: "Sofia Ribeiro", prof: "Dra. Helena", tipo: "Procedimento", gravidade: "atencao", status: "pendente", noPrazo: true, prioridade: false },
  { dia: 15, hora: "10:00", paciente: "Juliana Prado", prof: "Dra. Helena", tipo: "Procedimento", gravidade: "atencao", status: "realizada", noPrazo: true, prioridade: false },
  { dia: 12, hora: "15:00", paciente: "Marina Alves", prof: "Dra. Helena", tipo: "Procedimento", gravidade: "grave", status: "realizada", noPrazo: true, prioridade: true },
  { dia: 18, hora: "16:00", paciente: "João Pedro Lima", prof: "Dr. André", tipo: "Retorno", gravidade: "atencao", status: "falta", noPrazo: false, prioridade: false },
  { dia: 10, hora: "09:00", paciente: "Carlos Menezes", prof: "Dra. Helena", tipo: "Avaliação", gravidade: "estavel", status: "falta", noPrazo: true, prioridade: false },
];

export type Falta = { paciente: string; data: string; servico: string; prof: string; tentativas: number; recontato: boolean };
export const FALTAS: Falta[] = [
  { paciente: "João Pedro Lima", data: "18/07", servico: "Retorno", prof: "Dr. André", tentativas: 2, recontato: true },
  { paciente: "Carlos Menezes", data: "10/07", servico: "Avaliação", prof: "Dra. Helena", tentativas: 1, recontato: false },
  { paciente: "Ana Clara Dias", data: "03/07", servico: "Limpeza", prof: "Dra. Helena", tentativas: 3, recontato: true },
  { paciente: "Rafael Souza", data: "27/06", servico: "Procedimento", prof: "Dr. André", tentativas: 0, recontato: false },
];

export type FuturaConsulta = { paciente: string; data: string; hora: string; tipo: TipoTratamento; prof: string; gravidade: Gravidade };
export const FUTURAS: FuturaConsulta[] = [
  { paciente: "Marina Alves", data: "23/07", hora: "14:30", tipo: "Retorno", prof: "Dra. Helena", gravidade: "grave" },
  { paciente: "Gustavo Reis", data: "24/07", hora: "08:30", tipo: "Estética", prof: "Dr. André", gravidade: "estavel" },
  { paciente: "Ana Clara Dias", data: "24/07", hora: "11:00", tipo: "Avaliação", prof: "Dra. Helena", gravidade: "grave" },
  { paciente: "Felipe Carvalho", data: "28/07", hora: "09:30", tipo: "Limpeza", prof: "Dr. André", gravidade: "estavel" },
  { paciente: "Sofia Ribeiro", data: "29/07", hora: "15:00", tipo: "Procedimento", prof: "Dra. Helena", gravidade: "atencao" },
];

/** Histórico de atendimentos por paciente (para abrir inline na agenda). */
export const HISTORICO_PACIENTE: Record<string, { data: string; tipo: string; prof: string; obs: string }[]> = {
  "Marina Alves": [
    { data: "12/07", tipo: "Procedimento", prof: "Dra. Helena", obs: "Restauração 26 — sem intercorrências" },
    { data: "28/06", tipo: "Avaliação", prof: "Dra. Helena", obs: "Plano de tratamento aprovado" },
    { data: "10/05", tipo: "Limpeza", prof: "Dra. Helena", obs: "Profilaxia + orientação" },
  ],
  "Rafael Souza": [
    { data: "02/06", tipo: "Procedimento", prof: "Dra. Helena", obs: "Iniciado tratamento de canal" },
    { data: "20/05", tipo: "Avaliação", prof: "Dr. André", obs: "Dor aguda — encaminhado endodontia" },
  ],
  "Lucas Martins": [
    { data: "30/06", tipo: "Avaliação", prof: "Dr. André", obs: "Check-up semestral ok" },
  ],
};

/* ---------- PRONTUÁRIO (gravidade por estado, queixas, resumo) ---------- */

export type PacienteProntuario = {
  id: number;
  nome: string;
  gravidade: Gravidade;
  ultima: string;
  prof: string;
  resumo: string;
};

export const PRONTUARIO_PACIENTES: PacienteProntuario[] = [
  { id: 1, nome: "Marina Alves", gravidade: "grave", ultima: "12/07", prof: "Dra. Helena", resumo: "Em tratamento restaurador; retorno agendado 23/07. Boa adesão. Sem alergias relatadas." },
  { id: 2, nome: "Rafael Souza", gravidade: "critico", ultima: "02/06", prof: "Dra. Helena", resumo: "Canal em andamento; abandonou 2ª sessão. Dor recorrente. Prioridade de recontato." },
  { id: 3, nome: "Beatriz Rocha", gravidade: "estavel", ultima: "20/07", prof: "Dra. Helena", resumo: "Manutenção preventiva. Próxima limpeza em 6 meses." },
  { id: 4, nome: "Juliana Prado", gravidade: "atencao", ultima: "15/07", prof: "Dra. Helena", resumo: "Ortodontia — ajuste mensal. Leve inflamação gengival monitorada." },
  { id: 5, nome: "Lucas Martins", gravidade: "estavel", ultima: "30/06", prof: "Dr. André", resumo: "Check-up ok. Sem pendências clínicas." },
];

export type Queixa = { paciente: string; origem: "whatsapp" | "consulta"; texto: string; data: string; resolvida: boolean };
export const QUEIXAS: Queixa[] = [
  { paciente: "Marina Alves", origem: "whatsapp", texto: "Senti sensibilidade ao gelado depois da restauração.", data: "14/07", resolvida: false },
  { paciente: "Rafael Souza", origem: "whatsapp", texto: "A dor voltou à noite, latejando.", data: "13/07", resolvida: false },
  { paciente: "Juliana Prado", origem: "consulta", texto: "Aparelho está machucando a bochecha.", data: "15/07", resolvida: true },
  { paciente: "Beatriz Rocha", origem: "whatsapp", texto: "Posso remarcar? Consigo só de tarde.", data: "19/07", resolvida: true },
];

/* ---------- FINANCEIRO (pagamento, parcelas, faturamento, gastos) ---------- */

export const FORMAS_PAGAMENTO = ["Pix", "Cartão", "Boleto", "Dinheiro"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export type Cobranca2 = {
  paciente: string;
  tipo: string;
  valor: number;
  venc: string;
  forma: FormaPagamento;
  parcela: { n: number; de: number };
  status: "paga" | "aberta";
  atraso: number;
  contato: "sem_contato" | "notificado" | "negociando" | "quitado";
};

export const COBRANCAS2: Cobranca2[] = [
  { paciente: "Rafael Souza", tipo: "Procedimento", valor: 1200, venc: "02/06", forma: "Boleto", parcela: { n: 2, de: 4 }, status: "aberta", atraso: 48, contato: "negociando" },
  { paciente: "Gustavo Reis", tipo: "Avaliação", valor: 260, venc: "10/05", forma: "Pix", parcela: { n: 1, de: 1 }, status: "aberta", atraso: 71, contato: "notificado" },
  { paciente: "Ana Clara Dias", tipo: "Estética", valor: 890, venc: "05/07", forma: "Cartão", parcela: { n: 3, de: 6 }, status: "aberta", atraso: 16, contato: "sem_contato" },
  { paciente: "Marina Alves", tipo: "Procedimento", valor: 680, venc: "12/07", forma: "Pix", parcela: { n: 1, de: 1 }, status: "paga", atraso: 0, contato: "quitado" },
  { paciente: "Beatriz Rocha", tipo: "Limpeza", valor: 180, venc: "20/07", forma: "Dinheiro", parcela: { n: 1, de: 1 }, status: "paga", atraso: 0, contato: "quitado" },
];

export const CONTATO_DIVIDA: Record<Cobranca2["contato"], { label: string; tone: "neutral" | "warning" | "brand" | "positive" }> = {
  sem_contato: { label: "sem contato", tone: "neutral" },
  notificado: { label: "notificado", tone: "warning" },
  negociando: { label: "negociando", tone: "brand" },
  quitado: { label: "quitado", tone: "positive" },
};

export const FATURAMENTO_DIA = [
  { dia: "Seg", v: 0.62 }, { dia: "Ter", v: 0.8 }, { dia: "Qua", v: 0.55 },
  { dia: "Qui", v: 0.74 }, { dia: "Sex", v: 0.95 }, { dia: "Sáb", v: 0.4 },
];

export const RESUMO_PERIODO = {
  dia: { faturamento: 3120, gastos: 1180, lucro: 1940, leads: 4 },
  semana: { faturamento: 14380, gastos: 5260, lucro: 9120, leads: 21 },
  mes: { faturamento: 48720, gastos: 19040, lucro: 29680, leads: 83 },
};

export const GASTOS_MATERIAIS = [
  { item: "Resina composta (kit)", qtd: 3, valor: 1290, data: "05/07" },
  { item: "Anestésico (caixa)", qtd: 2, valor: 640, data: "08/07" },
  { item: "Luvas nitrílicas (10 cx)", qtd: 10, valor: 480, data: "11/07" },
  { item: "Brocas diamantadas (jogo)", qtd: 1, valor: 720, data: "16/07" },
];

export const FINANCEIRO2 = {
  custo_por_lead: 42,
  perdas_capital: 3610, // inadimplência não recuperada
  faturamento_mes: 48720,
  gastos_mes: 19040,
  margem: 0.61,
};

/* ---------- REATIVAÇÃO (mensagens, promoções, estado) ---------- */

export type MsgReativacao = { paciente: string; passo: string; enviadaEm: string; status: "entregue" | "lida" | "respondeu" | "agendou" };
export const MENSAGENS_REATIVACAO: MsgReativacao[] = [
  { paciente: "João Pedro Lima", passo: "D+0", enviadaEm: "15/07", status: "lida" },
  { paciente: "Ana Clara Dias", passo: "D+7", enviadaEm: "16/07", status: "respondeu" },
  { paciente: "Carlos Menezes", passo: "D+0", enviadaEm: "18/07", status: "entregue" },
  { paciente: "Sofia Ribeiro", passo: "D+21", enviadaEm: "12/07", status: "agendou" },
  { paciente: "Rafael Souza", passo: "D+7", enviadaEm: "19/07", status: "lida" },
];

export const PROMOCOES = [
  { titulo: "Retorno com 20% off", desconto: "20%", validade: "31/07", enviados: 41, conversao: 0.29 },
  { titulo: "Clareamento — leve 2 pague 1", desconto: "50%", validade: "15/08", enviados: 23, conversao: 0.17 },
  { titulo: "Avaliação ortodôntica grátis", desconto: "grátis", validade: "10/08", enviados: 68, conversao: 0.34 },
];

/* ---------- ESTOQUE (completo) ---------- */

export type ItemEstoque = {
  nome: string;
  categoria: string;
  lote: string;
  quantidade: number;
  minimo: number;
  validade: string;
  estado: "ok" | "baixo" | "vencendo" | "vencido";
  usoMes: number;
  usoSemana: number;
  usoDia: number;
  pacientes: number; // pacientes que usaram no mês
  estimativaProx: number;
};

export const ESTOQUE_ITENS: ItemEstoque[] = [
  { nome: "Anestésico (tubete)", categoria: "Insumo", lote: "AN-2411", quantidade: 42, minimo: 30, validade: "11/2026", estado: "ok", usoMes: 58, usoSemana: 14, usoDia: 3, pacientes: 41, estimativaProx: 62 },
  { nome: "Luvas nitrílicas (cx)", categoria: "EPI", lote: "LV-0327", quantidade: 6, minimo: 10, validade: "03/2027", estado: "baixo", usoMes: 22, usoSemana: 6, usoDia: 1, pacientes: 83, estimativaProx: 24 },
  { nome: "Resina composta A2", categoria: "Restaurador", lote: "RS-0825", quantidade: 3, minimo: 5, validade: "08/2025", estado: "vencendo", usoMes: 9, usoSemana: 2, usoDia: 0, pacientes: 9, estimativaProx: 11 },
  { nome: "Gaze estéril (pct)", categoria: "Insumo", lote: "GZ-0528", quantidade: 58, minimo: 20, validade: "05/2028", estado: "ok", usoMes: 40, usoSemana: 9, usoDia: 2, pacientes: 60, estimativaProx: 44 },
  { nome: "Broca diamantada", categoria: "Instrumental", lote: "BR-1130", quantidade: 14, minimo: 8, validade: "—", estado: "ok", usoMes: 6, usoSemana: 1, usoDia: 0, pacientes: 18, estimativaProx: 7 },
  { nome: "Fio ortodôntico", categoria: "Ortodontia", lote: "FO-0624", quantidade: 2, minimo: 6, validade: "06/2024", estado: "vencido", usoMes: 12, usoSemana: 3, usoDia: 1, pacientes: 15, estimativaProx: 14 },
];

export const ESTADO_ITEM: Record<ItemEstoque["estado"], { label: string; tone: "positive" | "warning" | "negative" | "neutral" }> = {
  ok: { label: "ok", tone: "positive" },
  baixo: { label: "baixo", tone: "warning" },
  vencendo: { label: "vencendo", tone: "warning" },
  vencido: { label: "vencido", tone: "negative" },
};

export const ESTOQUE_ANALISE_MES_PASSADO = [
  { item: "Anestésico (tubete)", usado: 52, comprado: 60, sobra: 8, custo: 780 },
  { item: "Luvas nitrílicas (cx)", usado: 20, comprado: 15, sobra: -5, custo: 480 },
  { item: "Resina composta A2", usado: 8, comprado: 6, sobra: -2, custo: 1290 },
  { item: "Gaze estéril (pct)", usado: 38, comprado: 50, sobra: 12, custo: 210 },
];

export const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const BRL2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const pct = (n: number) => `${Math.round(n * 100)}%`;
