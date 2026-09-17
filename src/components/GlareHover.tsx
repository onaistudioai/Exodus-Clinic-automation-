"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";

/**
 * GlareHover (React Bits) — passa um "vidro" de brilho em diagonal sobre o
 * conteúdo ao hover. Puro CSS/JS (sem WebGL). Usado nos botões de módulo.
 */
interface GlareHoverProps {
  width?: string;
  height?: string;
  background?: string;
  borderRadius?: string;
  borderColor?: string;
  children?: ReactNode;
  glareColor?: string;
  glareOpacity?: number;
  glareAngle?: number;
  glareSize?: number;
  transitionDuration?: number;
  playOnce?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function GlareHover({
  width = "100%",
  height = "100%",
  background = "transparent",
  borderRadius = "16px",
  borderColor = "transparent",
  children,
  glareColor = "#365523",
  glareOpacity = 0.35,
  glareAngle = -30,
  glareSize = 300,
  transitionDuration = 800,
  playOnce = false,
  className = "",
  style = {},
}: GlareHoverProps) {
  // hex -> rgba (suporta #rgb e #rrggbb)
  let hex = glareColor.replace("#", "");
  if (/^[0-9A-Fa-f]{3}$/.test(hex)) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  const rgba =
    /^[0-9A-Fa-f]{6}$/.test(hex)
      ? `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, ${glareOpacity})`
      : glareColor;

  const overlayRef = useRef<HTMLDivElement>(null);

  const overlayStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: `linear-gradient(${glareAngle}deg, hsla(0,0%,0%,0) 60%, ${rgba} 70%, hsla(0,0%,0%,0) 100%)`,
    backgroundSize: `${glareSize}% ${glareSize}%, 100% 100%`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "-100% -100%, 0 0",
    pointerEvents: "none",
  };

  const animateIn = () => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.backgroundPosition = "-100% -100%, 0 0";
    void el.offsetHeight; // reflow
    el.style.transition = `${transitionDuration}ms ease`;
    el.style.backgroundPosition = "100% 100%, 0 0";
  };

  const animateOut = () => {
    const el = overlayRef.current;
    if (!el) return;
    if (playOnce) {
      el.style.transition = "none";
      el.style.backgroundPosition = "-100% -100%, 0 0";
    } else {
      el.style.transition = `${transitionDuration}ms ease`;
      el.style.backgroundPosition = "-100% -100%, 0 0";
    }
  };

  return (
    <div
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{
        width,
        height,
        background,
        borderRadius,
        border: `1px solid ${borderColor}`,
        ...style,
      }}
      onMouseEnter={animateIn}
      onMouseLeave={animateOut}
    >
      <div ref={overlayRef} style={overlayStyle} />
      {children}
    </div>
  );
}
