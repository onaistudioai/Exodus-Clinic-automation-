import type { SVGProps } from "react";

/**
 * Ícones SVG (estilo Lucide: 24×24, stroke 2, currentColor, cantos arredondados).
 * Sem dependência externa — emoji NUNCA como ícone estrutural.
 * Uso: <Icon.Agenda className="h-5 w-5" />
 */

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  /** Marca — pulso/atividade clínica */
  Pulse: (p: IconProps) => (
    <Base {...p}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </Base>
  ),
  /** Check-in — identidade/usuário confirmado */
  Checkin: (p: IconProps) => (
    <Base {...p}>
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M5 17c0-1.7 1.8-3 4-3s4 1.3 4 3" />
      <path d="M15 9h4M15 13h2" />
    </Base>
  ),
  /** Prontuário — prancheta com linhas */
  Prontuario: (p: IconProps) => (
    <Base {...p}>
      <rect width="8" height="4" x="8" y="2" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M8 11h8M8 15h6" />
    </Base>
  ),
  /** Agenda — calendário */
  Agenda: (p: IconProps) => (
    <Base {...p}>
      <path d="M8 2v4M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </Base>
  ),
  /** Estoque — caixa/pacote */
  Estoque: (p: IconProps) => (
    <Base {...p}>
      <path d="M11 21.7 3.5 17.5a1 1 0 0 1-.5-.9V7.4a1 1 0 0 1 .5-.9L11 2.3a2 2 0 0 1 2 0l7.5 4.2a1 1 0 0 1 .5.9v9.2a1 1 0 0 1-.5.9L13 21.7a2 2 0 0 1-2 0Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </Base>
  ),
  /** Financeiro — cartão */
  Financeiro: (p: IconProps) => (
    <Base {...p}>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </Base>
  ),
  /** Reativação — ciclo/retorno */
  Reativacao: (p: IconProps) => (
    <Base {...p}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </Base>
  ),
  /** Mesclar — junção */
  Merge: (p: IconProps) => (
    <Base {...p}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M6 9v6" />
      <path d="M18 12a9 9 0 0 0-9-9" />
      <path d="M9 21a9 9 0 0 0 9-9" />
      <circle cx="18" cy="12" r="3" />
    </Base>
  ),
  /** Auditoria — escudo verificado */
  Auditoria: (p: IconProps) => (
    <Base {...p}>
      <path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z" />
      <path d="m9 12 2 2 4-4" />
    </Base>
  ),
  /** CRM — relacionamento/pessoas */
  Crm: (p: IconProps) => (
    <Base {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </Base>
  ),
  /** Sair */
  Logout: (p: IconProps) => (
    <Base {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </Base>
  ),
  /** Seta — links de ação */
  ArrowRight: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </Base>
  ),
  /** Menu — hambúrguer */
  Menu: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Base>
  ),
  /** Trocar lado — setas opostas */
  SwapSides: (p: IconProps) => (
    <Base {...p}>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </Base>
  ),
  /** Chevron ▾ */
  ChevronDown: (p: IconProps) => (
    <Base {...p}>
      <path d="m6 9 6 6 6-6" />
    </Base>
  ),
  /** Chevron ‹ */
  ChevronLeft: (p: IconProps) => (
    <Base {...p}>
      <path d="m15 18-6-6 6-6" />
    </Base>
  ),
  /** Chevron › */
  ChevronRight: (p: IconProps) => (
    <Base {...p}>
      <path d="m9 18 6-6-6-6" />
    </Base>
  ),
  /** Filtro — funil */
  Filtro: (p: IconProps) => (
    <Base {...p}>
      <path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3Z" />
    </Base>
  ),
  /** WhatsApp — balão de conversa */
  Whatsapp: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.2-5.5A8.4 8.4 0 1 1 21 11.5Z" />
    </Base>
  ),
  /** Alerta — triângulo */
  Alerta: (p: IconProps) => (
    <Base {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </Base>
  ),
  /** Relatório — documento com gráfico */
  Relatorio: (p: IconProps) => (
    <Base {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 17v-3M12 17v-6M16 17v-2" />
    </Base>
  ),
  /** Editar — lápis */
  Editar: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Base>
  ),
  /** Check — concluído */
  Check: (p: IconProps) => (
    <Base {...p}>
      <path d="M20 6 9 17l-5-5" />
    </Base>
  ),
  /** Modo parede — painel encostado na lateral */
  Dock: (p: IconProps) => (
    <Base {...p}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </Base>
  ),
  /** Modo flutuante — painel solto */
  Float: (p: IconProps) => (
    <Base {...p}>
      <rect width="12" height="14" x="7" y="5" rx="2" />
      <path d="M4 8v8M2 12h2" />
    </Base>
  ),
};

export type IconName = keyof typeof Icon;
