"use client";

import MenuLateral, { type ItemDeMenu } from "@/components/MenuLateral";
import ThemeToggle from "./ThemeToggle";

/**
 * O menu da demo. Toda a mecânica (parede/flutuante, lado, persistência) mora
 * em `MenuLateral`, compartilhado com o painel real — aqui só ficam a lista de
 * telas fictícias e o rodapé próprio da demo.
 */
export const NAV_ITENS: ItemDeMenu[] = [
  { href: "/demo", label: "Início", icon: "Pulse" },
  { href: "/demo/crm", label: "CRM", icon: "Crm" },
  { href: "/demo/agenda", label: "Agenda", icon: "Agenda" },
  { href: "/demo/prontuario", label: "Prontuário", icon: "Prontuario" },
  { href: "/demo/financeiro", label: "Financeiro", icon: "Financeiro" },
  { href: "/demo/reativacao", label: "Reativação", icon: "Reativacao" },
  { href: "/demo/estoque", label: "Estoque", icon: "Estoque" },
];

export default function FloatingMenu() {
  return (
    <MenuLateral
      itens={NAV_ITENS}
      raizAtiva="/demo"
      rodape={
        <>
          <ThemeToggle />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-medium text-brand-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            demo
          </span>
        </>
      }
    />
  );
}
