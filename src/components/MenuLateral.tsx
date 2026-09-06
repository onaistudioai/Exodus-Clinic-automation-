"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Wordmark } from "@/components/ui";

export type ItemDeMenu = { href: string; label: string; icon: IconName };

type Side = "left" | "right";
type Modo = "parede" | "flutuante";

/**
 * Menu em vidro com dois modos:
 *  - parede: encostado na lateral, sempre visível.
 *  - flutuante: recolhe pra um botão quando o mouse sai.
 * Botões pra trocar o lado (esq/dir) e o modo. Tudo persistido.
 *
 * POR QUE ELE É COMPARTILHADO
 * Nasceu dentro de `app/demo/` e o painel real tinha outra navegação — uma
 * barra horizontal. Deu no que tinha de dar: duas navegações no mesmo produto,
 * com um módulo (o Assistente) visível numa e inalcançável na outra. Agora é
 * UM componente; `/demo` e o painel passam listas diferentes e nada mais.
 *
 * A barra horizontal também não cabia: 14 itens `nowrap` pedem ~1380px e o
 * header tinha ~640. Vertical não tem esse teto.
 */
export default function MenuLateral({
  itens,
  raizAtiva,
  rodape,
  tom = "claro",
}: {
  itens: ItemDeMenu[];
  /** href que só fica ativo em match exato (a "home" da área). */
  raizAtiva: string;
  rodape?: React.ReactNode;
  /** `escuro` clareia o texto dos itens — o painel roda sobre canvas escuro. */
  tom?: "claro" | "escuro";
}) {
  const path = usePathname();
  const [side, setSide] = useState<Side>("left");
  const [modo, setModo] = useState<Modo>("flutuante");
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem("menu-side");
      if (s === "left" || s === "right") setSide(s);
      const m = localStorage.getItem("menu-mode");
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
    try { localStorage.setItem("menu-side", next); } catch {}
  }
  function flipModo() {
    const next: Modo = modo === "parede" ? "flutuante" : "parede";
    setModo(next);
    try { localStorage.setItem("menu-mode", next); } catch {}
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
    href === raizAtiva ? path === raizAtiva : path.startsWith(href);
  const parede = modo === "parede";
  const painelAberto = parede || open;

  const Painel = (
    <nav
      data-open={painelAberto}
      data-side={side}
      data-tom={tom}
      aria-hidden={!painelAberto}
      className={
        parede
          ? "menu-vidro flex h-full w-60 flex-col p-4"
          : `menu-painel menu-vidro absolute top-1/2 w-60 -translate-y-1/2 rounded-2xl p-4 ${side === "left" ? "left-0" : "right-0"}`
      }
    >
      <div className="mb-4 flex items-center justify-between gap-2 px-1">
        <Wordmark tone={tom === "escuro" ? "onBrand" : undefined} />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={parede ? "Modo flutuante" : "Modo parede"}
            title={parede ? "Mudar para flutuante" : "Mudar para parede"}
            onClick={flipModo}
            className="menu-botaozinho grid h-8 w-8 place-items-center rounded-lg"
          >
            {parede ? <Icon.Float className="h-4 w-4" /> : <Icon.Dock className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label="Trocar o lado do menu"
            title="Trocar o lado"
            onClick={flipSide}
            className="menu-botaozinho grid h-8 w-8 place-items-center rounded-lg"
          >
            <Icon.SwapSides className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* `overflow-y-auto`: o painel real tem 14 itens e telas baixas (ou zoom
          125%) não cabem todos. Vertical rola sem cortar nada. */}
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {itens.map((it) => {
          const IconCmp = Icon[it.icon];
          const active = isActive(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              onClick={() => !parede && setOpen(false)}
              className={`menu-item${active ? " menu-item--ativo" : ""}`}
            >
              <IconCmp className="menu-icone h-[18px] w-[18px]" />
              {it.label}
            </Link>
          );
        })}
      </div>

      {rodape && <div className="mt-4 flex items-center justify-between gap-2 px-1">{rodape}</div>}
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
        data-tom={tom}
        className="menu-btn menu-vidro grid h-12 w-12 place-items-center rounded-2xl"
      >
        <Icon.Menu className="h-5 w-5" />
      </button>
      {Painel}
    </div>
  );
}
