"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Wordmark } from "@/components/ui";
import ThemeToggle from "./ThemeToggle";

export const NAV_ITENS: { href: string; label: string; icon: IconName }[] = [
  { href: "/demo", label: "Início", icon: "Pulse" },
  { href: "/demo/crm", label: "CRM", icon: "Crm" },
  { href: "/demo/agenda", label: "Agenda", icon: "Agenda" },
  { href: "/demo/prontuario", label: "Prontuário", icon: "Prontuario" },
  { href: "/demo/financeiro", label: "Financeiro", icon: "Financeiro" },
  { href: "/demo/reativacao", label: "Reativação", icon: "Reativacao" },
  { href: "/demo/estoque", label: "Estoque", icon: "Estoque" },
];

type Side = "left" | "right";
type Modo = "parede" | "flutuante";

/** Menu em vidro com dois modos:
 *  - parede: encostado na lateral, sempre visível.
 *  - flutuante: recolhe pra um botão quando o mouse sai.
 *  Botões pra trocar o lado (esq/dir) e o modo. Tudo persistido. */
export default function FloatingMenu() {
  const path = usePathname();
  const [side, setSide] = useState<Side>("left");
  const [modo, setModo] = useState<Modo>("flutuante");
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem("demo-menu-side");
      if (s === "left" || s === "right") setSide(s);
      const m = localStorage.getItem("demo-menu-mode");
      if (m === "parede" || m === "flutuante") setModo(m);
    } catch {}
  }, []);

  // Reflete modo/lado no <html> pra o shell reservar espaço em modo parede.
  useEffect(() => {
    const d = document.documentElement;
    d.dataset.menu = modo;
    d.dataset.menuside = side;
  }, [modo, side]);

  function flipSide() {
    const next: Side = side === "left" ? "right" : "left";
    setSide(next);
    try { localStorage.setItem("demo-menu-side", next); } catch {}
  }
  function flipModo() {
    const next: Modo = modo === "parede" ? "flutuante" : "parede";
    setModo(next);
    try { localStorage.setItem("demo-menu-mode", next); } catch {}
  }

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }
  function scheduleClose() {
    if (modo === "parede") return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  }

  const isActive = (href: string) =>
    href === "/demo" ? path === "/demo" : path.startsWith(href);
  const parede = modo === "parede";
  const painelAberto = parede || open;

  const Painel = (
    <nav
      data-open={painelAberto}
      data-side={side}
      aria-hidden={!painelAberto}
      className={
        parede
          ? "demo-glass flex h-full w-60 flex-col p-4"
          : `demo-menu-panel demo-glass absolute top-1/2 w-60 -translate-y-1/2 rounded-2xl p-4 ${side === "left" ? "left-0" : "right-0"}`
      }
    >
      <div className="mb-4 flex items-center justify-between gap-2 px-1">
        <Wordmark />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={parede ? "Modo flutuante" : "Modo parede"}
            title={parede ? "Mudar para flutuante" : "Mudar para parede"}
            onClick={flipModo}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-brand-600/10 hover:text-brand-700"
          >
            {parede ? <Icon.Float className="h-4 w-4" /> : <Icon.Dock className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label="Trocar o lado do menu"
            title="Trocar o lado"
            onClick={flipSide}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-brand-600/10 hover:text-brand-700"
          >
            <Icon.SwapSides className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1">
        {NAV_ITENS.map((it) => {
          const IconCmp = Icon[it.icon];
          const active = isActive(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              onClick={() => !parede && setOpen(false)}
              className={`demo-navitem${active ? " demo-navitem--active" : ""}`}
            >
              <IconCmp className="demo-navicon h-[18px] w-[18px]" />
              {it.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between px-1">
        <ThemeToggle />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-medium text-brand-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
          demo
        </span>
      </div>
    </nav>
  );

  // Modo parede — encostado na lateral, altura cheia, sempre visível.
  if (parede) {
    return (
      <div className={`fixed inset-y-0 z-40 ${side === "left" ? "left-0" : "right-0"}`}>
        {Painel}
      </div>
    );
  }

  // Modo flutuante — botão que expande no hover.
  return (
    <div
      className={`fixed top-1/2 z-40 flex -translate-y-1/2 flex-col ${side === "left" ? "left-3 items-start" : "right-3 items-end"}`}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-label="Abrir menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        data-hidden={open}
        className="demo-menu-btn demo-glass grid h-12 w-12 place-items-center rounded-2xl text-ink-900"
      >
        <Icon.Menu className="h-5 w-5" />
      </button>
      {Painel}
    </div>
  );
}
