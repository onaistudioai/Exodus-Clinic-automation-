import { Wordmark } from "@/components/ui";
import { Icon } from "@/components/icons";
import GooeyNav from "@/components/GooeyNav";
import { MODULOS } from "../(painel)/modulos";
import DashboardShowcase from "../(painel)/DashboardShowcase";

/**
 * PREVIEW do redesign (verde/aurora) — renderiza shell + dashboard com dados
 * fake, SEM banco/auth. Acesse: /preview
 */
const NAV = [
  { href: "/preview", label: "Início" },
  { href: "/preview", label: "Check-in" },
  { href: "/preview", label: "Prontuário" },
  { href: "/preview", label: "Agenda" },
  { href: "/preview", label: "Financeiro" },
];

export default function PreviewPage() {
  const modulos = MODULOS.map(({ acao: _a, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars

  return (
    <div className="min-h-screen">
      <header className="hero-dark sticky top-0 z-30 border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-2.5">
          <div className="flex items-center gap-6">
            <Wordmark tone="onBrand" />
            <div className="hidden md:block">
              <GooeyNav items={NAV} />
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/85 ring-1 ring-white/15 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              clínica #2 · recepcao
            </span>
            <button className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-white/70 transition hover:bg-white/10 hover:text-white">
              <Icon.Logout className="h-4 w-4" />
              <span className="hidden sm:inline">sair</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <DashboardShowcase modulos={modulos} papel="recepcao" clinicaId={2} />
      </main>
    </div>
  );
}
