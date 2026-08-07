import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./icons";

/**
 * Componentes de UI compartilhados do painel EXODUS.
 * Presentacionais (sem estado) → seguros em Server Components.
 * Todos aceitam `className` para ajustes pontuais sem quebrar o padrão.
 */

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Cabeçalho de página ---------- */

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode; // ações à direita (links/botões)
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </div>
  );
}

/* ---------- Card / superfície ---------- */

export function Card({
  className,
  children,
  ...rest
}: ComponentProps<"div">) {
  return (
    <div
      className={cx(
        "rounded-card bg-surface p-5 shadow-card ring-1 ring-line",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Card que é um link (hover de marca). */
export function CardLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "group block cursor-pointer rounded-card bg-surface p-5 shadow-card ring-1 ring-line transition duration-200",
        "hover:-translate-y-0.5 hover:shadow-pop hover:ring-brand-300",
        className
      )}
    >
      {children}
    </Link>
  );
}

/* ---------- Indicador / stat ---------- */

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const toneCls =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
        ? "text-red-600"
        : tone === "warning"
          ? "text-amber-700"
          : "text-ink-900";
  return (
    <div className="rounded-card bg-surface p-4 shadow-card ring-1 ring-line">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className={cx("mt-1 text-xl font-semibold tabular-nums", toneCls)}>
        {value}
        {sub && <span className="ml-1 text-xs font-normal text-ink-400">{sub}</span>}
      </div>
    </div>
  );
}

/* ---------- Badge ---------- */

const BADGE_TONES = {
  neutral: "bg-ink-900/5 text-ink-700",
  brand: "bg-brand-50 text-brand-700",
  positive: "bg-emerald-50 text-emerald-700",
  negative: "bg-red-50 text-red-700",
  warning: "bg-amber-50 text-amber-700",
} as const;

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Botão (estilos como helpers de className) ---------- */

const BTN_BASE =
  "btn-shine inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition duration-200 will-change-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none";

export const btn = {
  primary: cx(
    BTN_BASE,
    "bg-brand-600 text-white shadow-card hover:bg-brand-700 hover:shadow-glow active:bg-brand-800"
  ),
  /** CTA de destaque — gradiente aurora com brilho (login, ações-chave). */
  cta: cx(
    BTN_BASE,
    "bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 text-white shadow-glow-violet hover:brightness-110"
  ),
  secondary: cx(
    BTN_BASE,
    "bg-surface text-ink-700 ring-1 ring-line hover:ring-brand-300 hover:text-brand-700"
  ),
  /** Para usar sobre o hero escuro (glass claro). */
  onDark: cx(
    BTN_BASE,
    "glass-dark text-white ring-1 ring-white/15 hover:ring-brand-400/60 hover:text-white"
  ),
  ghost: cx(BTN_BASE, "text-ink-500 hover:bg-ink-900/5 hover:text-ink-900"),
  danger: cx(BTN_BASE, "bg-red-600 text-white hover:bg-red-700"),
} as const;

/** <button> de marca pronto. Para <Link> use `className={btn.primary}`. */
export function Button({
  variant = "primary",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: keyof typeof btn }) {
  return <button className={cx(btn[variant], className)} {...rest} />;
}

/* ---------- Input com label ---------- */

export function Field({
  label,
  hint,
  className,
  ...rest
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-ink-700">{label}</span>
      <input
        className={cx(
          "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink-900 outline-none transition",
          "placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20",
          className
        )}
        {...rest}
      />
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

/* ---------- Tabela ---------- */

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line">
      <table className="w-full text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-brand-50/50">
        {children}
      </table>
    </div>
  );
}

export function Td({ className, children, ...rest }: ComponentProps<"td">) {
  return (
    <td className={cx("px-4 py-2.5", className)} {...rest}>
      {children}
    </td>
  );
}

export function Th({ className, children, ...rest }: ComponentProps<"th">) {
  return (
    <th
      className={cx("bg-ink-900/[0.02] px-4 py-2.5 text-left font-medium text-ink-500", className)}
      {...rest}
    >
      {children}
    </th>
  );
}

/* ---------- Estado vazio ---------- */

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-ink-400">
      {children}
    </p>
  );
}

/* ---------- Marca ---------- */

export function Wordmark({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "onBrand";
}) {
  const onBrand = tone === "onBrand";
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span
        aria-hidden
        className={cx(
          "grid h-7 w-7 place-items-center rounded-lg",
          onBrand ? "bg-white/20 text-white" : "bg-brand-600 text-white"
        )}
      >
        <Icon.Pulse className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <span className={onBrand ? "text-white" : "text-ink-900"}>
        EXODUS<span className={onBrand ? "text-white/70" : "text-brand-600"}>.</span>
      </span>
    </span>
  );
}
