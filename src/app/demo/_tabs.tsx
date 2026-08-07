"use client";

import { useState, type ReactNode } from "react";

/** Abas controladas com destaque fluido. Cada painel é renderizado sob demanda. */
export function Tabs({
  tabs,
  className,
}: {
  tabs: { id: string; label: string; content: ReactNode }[];
  className?: string;
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <div className={className}>
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl bg-surface p-1 shadow-card">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              aria-selected={on}
              className={
                on
                  ? "rounded-lg bg-gradient-to-r from-brand-600 to-brand-400 px-4 py-1.5 text-sm font-medium text-white transition"
                  : "rounded-lg px-4 py-1.5 text-sm font-medium text-ink-500 transition hover:text-brand-700"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div>{tabs.find((t) => t.id === active)?.content}</div>
    </div>
  );
}

/** Grupo de chips de filtro (single ou multi). */
export function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: { v: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.v);
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => toggle(o.v)}
            className={
              on
                ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white transition"
                : "rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-600 shadow-card transition hover:text-brand-700"
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
