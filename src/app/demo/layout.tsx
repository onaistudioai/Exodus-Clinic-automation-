import Prism from "@/components/Prism";
import FloatingMenu from "./FloatingMenu";

/** Shell PÚBLICO da demo — sem auth, sem banco. Só apresentação (mock).
 *  Prism de fundo no site inteiro (véu com blur) + menu flutuante em vidro. */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="demo-shell relative">
      {/* Aplica o tema salvo antes da pintura (evita flash) */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{var d=document.documentElement,t=localStorage.getItem('demo-theme');if(t)d.dataset.theme=t;d.dataset.menu=localStorage.getItem('demo-menu-mode')||'flutuante';d.dataset.menuside=localStorage.getItem('demo-menu-side')||'left';}catch(e){}`,
        }}
      />
      {/* Fundo animado (Prism) fixo atrás de tudo + véu com blur */}
      <div aria-hidden className="demo-bg">
        <Prism
          height={4}
          baseWidth={4.5}
          animationType="3drotate"
          glow={0.6}
          noise={0}
          transparent
          scale={4.2}
          hueShift={55}
          colorFrequency={3.3}
          hoverStrength={0}
          inertia={0.1}
          bloom={0.4}
          timeScale={0.24}
        />
        <div className="demo-veil" />
      </div>

      <FloatingMenu />

      <div className="demo-content relative z-10 mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8 lg:px-20">
        <main>{children}</main>
        <footer className="pb-6 pt-10 text-center text-xs text-ink-400">
          EXODUS · AIOS.clinic — ambiente de demonstração com dados fictícios.
        </footer>
      </div>
    </div>
  );
}
