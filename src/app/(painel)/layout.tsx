import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { permissoes } from "@/lib/rbac";
import { Icon } from "@/components/icons";
import { MODULOS } from "./modulos";
import { logoutAction } from "./actions";
import MenuLateral, { type ItemDeMenu } from "@/components/MenuLateral";

/**
 * Layout protegido do painel. Roda verifySession() UMA vez para todo o grupo
 * (proxy já fez o check otimista; aqui é a verificação real perto do dado).
 * Desenha a navegação conforme o papel. Cada página ainda aplica seu requireAcao.
 *
 * A NAVEGAÇÃO É A MESMA DA /demo
 * Era uma barra horizontal (GooeyNav) no topo. Com 14 itens `white-space:
 * nowrap` ela pedia ~1380px e tinha ~640 — o que não cabia era cortado sem
 * aviso; e abaixo de 768px (zoom 125% numa janela normal) o `hidden md:block`
 * apagava o menu inteiro. Na prática o Assistente existia e era inalcançável:
 * só dava para chegar nele colando a URL na barra do navegador.
 *
 * `MenuLateral` é vertical, então não tem esse teto, e é literalmente o mesmo
 * componente da demo — não existem mais duas navegações para divergirem.
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
  const itens: ItemDeMenu[] = [
    { href: "/", label: "Início", icon: "Pulse" },
    ...MODULOS.filter((m) => pode(m.acao)).map((m) => ({
      href: m.href,
      label: m.navLabel ?? m.titulo,
      icon: m.icon,
    })),
  ];

  return (
    <div className="painel-shell">
      {/* Lê modo/lado antes da pintura: sem isso o modo parede pisca como
          flutuante a cada navegação. Mesmo script da /demo. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{var d=document.documentElement;d.dataset.menu=localStorage.getItem('menu-mode')||'flutuante';d.dataset.menuside=localStorage.getItem('menu-side')||'left';}catch(e){}`,
        }}
      />

      <MenuLateral
        itens={itens}
        raizAtiva="/"
        tom="escuro"
        rodape={
          <>
            {/* O crachá é o caminho para a própria conta. Não entra em MODULOS:
                trocar a própria senha não tem `acao` (todo mundo com login pode,
                inclusive quem não tem permissão para mais nada), e MODULOS
                filtra por ação. */}
            <Link
              href="/conta/senha"
              title={`Clínica #${session.clinica_id} — trocar minha senha`}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/85 ring-1 ring-white/15 transition hover:bg-white/20 hover:text-white"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              {session.papel}
            </Link>
            <form action={logoutAction}>
              <button
                title="Sair"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <Icon.Logout className="h-4 w-4" />
                sair
              </button>
            </form>
          </>
        }
      />

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
