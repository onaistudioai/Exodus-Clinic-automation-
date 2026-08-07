"use client";

import { Color, Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

/**
 * Aurora (React Bits) — fundo WebGL animado. Adaptado para EXODUS:
 * paleta verde por padrão e REATIVO AO MOUSE (a cortina de aurora desloca
 * e ganha amplitude conforme o cursor). Pausa sob prefers-reduced-motion.
 */

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;
uniform vec2 uMouse;

out vec4 fragColor;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop { vec3 color; float position; };

#define COLOR_RAMP(colors, factor, finalColor) {              \
  int index = 0;                                              \
  for (int i = 0; i < 2; i++) {                               \
     ColorStop currentColor = colors[i];                      \
     bool isInBetween = currentColor.position <= factor;      \
     index = int(mix(float(index), float(i), float(isInBetween))); \
  }                                                           \
  ColorStop currentColor = colors[index];                    \
  ColorStop nextColor = colors[index + 1];                    \
  float range = nextColor.position - currentColor.position;   \
  float lerpFactor = (factor - currentColor.position) / range;\
  finalColor = mix(currentColor.color, nextColor.color, clamp(lerpFactor, 0.0, 1.0)); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  // mouse desloca a fase do ruído (x) e modula a amplitude (y)
  float mAmp = uAmplitude * (0.7 + uMouse.y * 0.8);
  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1 + (uMouse.x - 0.5) * 1.2, uTime * 0.25)) * 0.5 * mAmp;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;
  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}`;

interface AuroraProps {
  colorStops?: [string, string, string];
  amplitude?: number;
  blend?: number;
  speed?: number;
  className?: string;
}

export default function Aurora({
  colorStops = ["#27ff57", "#1a2b17", "#287005"],
  amplitude = 0.6,
  blend = 0.65,
  speed = 1,
  className = "",
}: AuroraProps) {
  const ref = useRef<HTMLDivElement>(null);
  // alvo (vindo do mouse) + valor suavizado, em refs p/ não recriar o RAF
  const mouseTarget = useRef<[number, number]>([0.5, 0.5]);
  const mouseSmooth = useRef<[number, number]>([0.5, 0.5]);
  const propsRef = useRef({ colorStops, amplitude, blend, speed });
  propsRef.current = { colorStops, amplitude, blend, speed };

  useEffect(() => {
    const ctn = ref.current;
    if (!ctn) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.backgroundColor = "transparent";

    let program: Program;

    function resize() {
      if (!ctn) return;
      const w = ctn.offsetWidth || window.innerWidth;
      const h = ctn.offsetHeight || window.innerHeight;
      renderer.setSize(w, h);
      if (program) program.uniforms.uResolution.value = [w, h];
    }
    window.addEventListener("resize", resize);

    const geometry = new Triangle(gl);
    if ((geometry.attributes as { uv?: unknown }).uv) {
      delete (geometry.attributes as { uv?: unknown }).uv;
    }

    const stops = propsRef.current.colorStops.map((c) => {
      const col = new Color(c);
      return [col.r, col.g, col.b];
    });

    program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: stops },
        uResolution: { value: [ctn.offsetWidth, ctn.offsetHeight] },
        uBlend: { value: blend },
        uMouse: { value: [0.5, 0.5] },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    ctn.appendChild(gl.canvas);
    resize();

    let raf = 0;
    const update = (t: number) => {
      raf = requestAnimationFrame(update);
      const p = propsRef.current;
      // suaviza o mouse (movimento artístico, sem "travar")
      mouseSmooth.current[0] += (mouseTarget.current[0] - mouseSmooth.current[0]) * 0.06;
      mouseSmooth.current[1] += (mouseTarget.current[1] - mouseSmooth.current[1]) * 0.06;

      program.uniforms.uTime.value = (t * 0.001 * p.speed * 0.4) % 1000;
      program.uniforms.uAmplitude.value = p.amplitude;
      program.uniforms.uBlend.value = p.blend;
      program.uniforms.uMouse.value = mouseSmooth.current;
      program.uniforms.uColorStops.value = p.colorStops.map((c) => {
        const col = new Color(c);
        return [col.r, col.g, col.b];
      });
      renderer.render({ scene: mesh });
    };

    if (reduce) {
      // um frame estático, sem animação
      program.uniforms.uTime.value = 0;
      renderer.render({ scene: mesh });
    } else {
      raf = requestAnimationFrame(update);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      if (gl.canvas.parentNode === ctn) ctn.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // mouse global → coordenadas normalizadas [0..1]
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mouseTarget.current = [e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight];
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return <div ref={ref} className={`h-full w-full ${className}`} />;
}
