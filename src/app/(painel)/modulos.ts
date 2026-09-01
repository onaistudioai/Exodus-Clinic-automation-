import type { Acao } from "@/lib/rbac";
import type { IconName } from "@/components/icons";

/**
 * Catálogo de módulos do painel como DADOS PUROS (sem JSX) — assim o Server
 * Component filtra por RBAC e passa a lista (serializável) para o showcase
 * client. O ícone vai como nome (string) e é resolvido no cliente.
 */
export type ModuloMeta = {
  href: string;
  titulo: string;
  descricao: string;
  acao: Acao;
  icon: IconName;
  /** rótulo curto do menu; cai no `titulo` quando ausente */
  navLabel?: string;
  /** par de cores (verde) para a arte de fundo do botão/vitrine */
  art: [string, string];
};

export const MODULOS: ModuloMeta[] = [
  { href: "/crm", titulo: "CRM", descricao: "Pacientes por estágio, ficha 360 e tarefas de follow-up.", acao: "ver_crm", icon: "Crm", art: ["#2ee06a", "#0c3b20"] },
  { href: "/checkin", titulo: "Check-in", descricao: "Buscar paciente, criar ficha e confirmar identidade no balcão.", acao: "checkin", icon: "Checkin", art: ["#27ff57", "#0c3b20"] },
  { href: "/prontuario", titulo: "Prontuário", descricao: "Histórico clínico, evoluções e registros de atendimento.", acao: "ler_texto_clinico", icon: "Prontuario", art: ["#34e0a1", "#0d2116"] },
  { href: "/agenda", titulo: "Agenda", descricao: "Agendamentos, profissionais, serviços e turnos.", acao: "ver_agenda", icon: "Agenda", art: ["#57f57e", "#14331f"] },
  { href: "/estoque", titulo: "Estoque", descricao: "Saldos, lotes, baixa por procedimento e alertas.", acao: "ver_estoque", icon: "Estoque", art: ["#4ef07a", "#0c3b20"] },
  { href: "/financeiro", titulo: "Financeiro", descricao: "Caixa, recebíveis, inadimplência e cobrança automática.", acao: "ver_financeiro", icon: "Financeiro", art: ["#18c93f", "#0d2116"] },
  { href: "/reativacao", titulo: "Reativação", descricao: "Pacientes inativos e campanhas de retorno via WhatsApp.", acao: "ver_reativacao", icon: "Reativacao", art: ["#34e0a1", "#14331f"] },
  { href: "/escalonamentos", titulo: "Escalonamentos", descricao: "Conversas em que o bot parou e chamou a equipe. Prazo e responsável.", acao: "ver_escalonamento", icon: "Alerta", art: ["#4ef07a", "#14331f"] },
  { href: "/merge", titulo: "Mesclar pacientes", navLabel: "Mesclar", descricao: "Unificar fichas duplicadas com segurança.", acao: "checkin", icon: "Merge", art: ["#27ff57", "#0d2116"] },
  { href: "/admin/auditoria", titulo: "Auditoria", descricao: "Quem acessou o quê — trilha de acesso a dados sensíveis.", acao: "ver_auditoria", icon: "Auditoria", art: ["#57f57e", "#0c3b20"] },
  { href: "/conformidade", titulo: "Conformidade", descricao: "Consentimento, livros imutáveis e prova para auditoria/LGPD.", acao: "ver_auditoria", icon: "Auditoria", art: ["#2ee06a", "#0d2116"] },
];

/** Versão sem `acao` para passar ao client (já filtrada). */
export type ModuloPublico = Omit<ModuloMeta, "acao">;
