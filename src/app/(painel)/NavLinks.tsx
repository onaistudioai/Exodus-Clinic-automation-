"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

/**
 * Navegação do painel com destaque do item ativo (combina por prefixo,
 * exceto a raiz "/", que exige match exato).
 */
export default function NavLinks({
  items,
  onBrand = false,
}: {
  items: NavItem[];
  onBrand?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {items.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        const cls = onBrand
          ? active
            ? "rounded-lg bg-white/20 px-3 py-1.5 font-medium text-white"
            : "rounded-lg px-3 py-1.5 text-white/75 transition hover:bg-white/10 hover:text-white"
          : active
            ? "rounded-lg bg-brand-50 px-3 py-1.5 font-medium text-brand-700"
            : "rounded-lg px-3 py-1.5 text-ink-500 transition hover:bg-ink-900/5 hover:text-ink-900";
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cls}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
