import { verifySession } from "@/lib/dal";
import { permissoes } from "@/lib/rbac";
import { Wordmark } from "@/components/ui";
import { Icon } from "@/components/icons";
import { MODULOS } from "./modulos";
import { logoutAction } from "./actions";
import GooeyNav, { type GooeyNavItem } from "@/components/GooeyNav";

/**
 * Layout protegido do painel. Roda verifySession() UMA vez para todo o grupo
 * (proxy já fez o check otimista; aqui é a verificação real perto do dado).
 * Desenha a navegação conforme o papel. Cada página ainda aplica seu requireAcao.
 */
export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();
  const { pode } = await permissoes();

  // A nav DERIVA do catálogo MODULOS (fonte única). Módulo novo = uma linha em
  // modulos.ts; este arquivo não muda. Antes eram 9 `if` à mão aqui, e o catálogo
  // já tinha divergido (Conformidade existia e não aparecia no menu).
  const links: GooeyNavItem[] = [
    { href: "/", label: "Início" },
    ...MODULOS.filter((m) => pode(m.acao)).map((m) => ({
      href: m.href,
      label: m.navLabel ?? m.titulo,
    })),
  ];

  return (
    <div className="min-h-screen">
      <header className="hero-dark sticky top-0 z-30 border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-2.5">
          <div className="flex items-center gap-6">
            <Wordmark tone="onBrand" />
            <div className="hidden md:block">
              <GooeyNav items={links} />
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/85 ring-1 ring-white/15 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              clínica #{session.clinica_id} · {session.papel}
            </span>
            <form action={logoutAction}>
              <button className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-white/70 transition hover:bg-white/10 hover:text-white">
                <Icon.Logout className="h-4 w-4" />
                <span className="hidden sm:inline">sair</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
