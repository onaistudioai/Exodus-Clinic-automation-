"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Aurora from "@/components/Aurora";
import CircularGallery from "@/components/CircularGallery";
import type { ModuloPublico } from "./modulos";

/** Gera uma arte de fundo (gradiente verde + blobs + grade + ECG) como data-URL. */
function gerarArte(c0: string, c1: string): string {
  const w = 800;
  const h = 600;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, c1);
  g.addColorStop(1, "#06120c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const rg = ctx.createRadialGradient(w * 0.7, h * 0.28, 30, w * 0.7, h * 0.28, 440);
  rg.addColorStop(0, c0);
  rg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = c0;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.beginPath();
  const mid = h * 0.74;
  ctx.moveTo(0, mid);
  ctx.lineTo(w * 0.3, mid);
  ctx.lineTo(w * 0.36, mid - 70);
  ctx.lineTo(w * 0.42, mid + 50);
  ctx.lineTo(w * 0.48, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();
  ctx.globalAlpha = 1;

  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function DashboardShowcase({
  modulos,
  papel,
  clinicaId,
}: {
  modulos: ModuloPublico[];
  papel: string;
  clinicaId: number;
}) {
  const router = useRouter();
  const [arte, setArte] = useState<{ image: string; text: string }[]>([]);

  useEffect(() => {
    setArte(modulos.map((m) => ({ image: gerarArte(m.art[0], m.art[1]), text: m.titulo })));
  }, [modulos]);

  const saudacao = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return "Bom dia";
    if (hr < 18) return "Boa tarde";
    return "Boa noite";
  }, []);

  return (
    // full-bleed: ocupa 100% da largura da viewport, ignorando o container central
    <div className="hero-dark relative left-1/2 -mt-8 -mb-8 min-h-[calc(100vh-3.25rem)] w-screen -translate-x-1/2 overflow-hidden">
      {/* Fundo Aurora reativo ao mouse */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <Aurora colorStops={["#27ff57", "#1a2b17", "#287005"]} amplitude={0.6} blend={0.65} />
      </div>
      <div aria-hidden className="tech-grid pointer-events-none absolute inset-0 z-0" />

      <div className="relative z-10 flex min-h-[calc(100vh-3.25rem)] flex-col px-6 pt-8 sm:px-10">
        {/* Saudação */}
        <div className="mx-auto w-full max-w-5xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/15">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
            Sistema operante · clínica #{clinicaId}
          </span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {saudacao}, <span className="text-aurora">{papel}</span>.
          </h1>
          <p className="mt-1 text-sm text-white/70">
            Arraste a vitrine e clique no módulo central para abrir.
          </p>
        </div>

        {/* Vitrine circular — ocupa o restante da tela */}
        <div className="relative mt-4 min-h-0 flex-1">
          {arte.length > 0 && (
            <CircularGallery
              items={arte}
              bend={2.5}
              textColor="#eafff0"
              borderRadius={0.06}
              // 0.025 (era 0.05): o `ease` é o fator de interpolação por quadro
              // — metade dele dobra o tempo até a vitrine assentar no destino.
              // É o "0.5x" da animação de deslize.
              scrollEase={0.025}
              // Fonte acompanha o card maior; 30px ficava desproporcional.
              font="bold 38px sans-serif"
              // `scrollSpeed` NÃO é velocidade de animação, é quanto cada giro
              // da roda avança. Mantido em 2: reduzir aqui deixaria a vitrine
              // menos responsiva ao gesto, não mais lenta.
              scrollSpeed={2}
              onItemClick={(i) => router.push(modulos[i].href)}
            />
          )}
        </div>

        <p className="mx-auto mb-6 mt-2 text-center text-xs text-white/40">
          ← arraste · role · clique para abrir →
        </p>
      </div>
    </div>
  );
}
