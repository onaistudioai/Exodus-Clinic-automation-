import type { ReactNode } from "react";

/**
 * Banner "hero" escuro e imersivo do EXODUS (parte do tema híbrido:
 * shell claro + hero escuro aurora). Fundo deep-navy com blobs de aurora
 * que respiram, malha técnica sutil e uma linha de pulso/ECG ao fundo.
 *
 * 100% CSS/SVG → sem JS de animação, seguro em Server Components,
 * e some por completo sob `prefers-reduced-motion`.
 */
export default function AuroraHero({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`hero-dark rounded-card shadow-glow ${className}`}
    >
      {/* malha técnica clínica */}
      <div aria-hidden className="tech-grid pointer-events-none absolute inset-0 z-0" />
      {/* linha de pulso/ECG decorativa */}
      <PulseLine className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-24 w-full text-brand-400/40" />
      <div className="relative z-10">{children}</div>
    </section>
  );
}

/** Traçado de ECG/pulso que se "desenha" em loop. Puro SVG/CSS. */
export function PulseLine({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 340 60"
      fill="none"
      preserveAspectRatio="none"
      className={className}
    >
      <path
        className="ecg-path"
        d="M0 38 H70 l8 -22 l10 38 l9 -44 l11 50 l8 -22 H160 l8 -16 l10 30 l9 -36 l11 42 l8 -20 H340"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
