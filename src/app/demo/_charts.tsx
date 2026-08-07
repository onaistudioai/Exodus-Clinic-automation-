/** Mini-gráficos da demo — SVG/CSS puro, sem libs, seguros em Server Components. */

/** Donut de porcentagem (0..1). */
export function Donut({
  value,
  label,
  color = "#15a33a",
  size = 128,
}: {
  value: number;
  label?: string;
  color?: string;
  size?: number;
}) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, value)));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#e3e8e5" strokeWidth="12" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-semibold tabular-nums text-ink-900">{Math.round(value * 100)}%</div>
        {label && <div className="text-[11px] text-ink-400">{label}</div>}
      </div>
    </div>
  );
}

/** Barras verticais (0..1) com rótulo. */
export function BarMini({ data }: { data: { dia: string; v: number }[] }) {
  return (
    <div className="flex items-stretch gap-3" style={{ height: 120 }}>
      {data.map((d) => (
        <div key={d.dia} className="flex flex-1 flex-col items-center gap-2">
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-brand-600 to-brand-400 transition-all"
              style={{ height: `${Math.round(d.v * 100)}%` }}
              title={`${d.dia}: ${Math.round(d.v * 100)}%`}
            />
          </div>
          <span className="text-[11px] text-ink-400">{d.dia}</span>
        </div>
      ))}
    </div>
  );
}

/** Barra empilhada horizontal (faixas com valor). */
export function StackBar({ data }: { data: { faixa: string; valor: number; cls: string }[] }) {
  const total = data.reduce((s, d) => s + d.valor, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {data.map((d) => (
          <div key={d.faixa} className={d.cls} style={{ width: `${(d.valor / total) * 100}%` }} title={d.faixa} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        {data.map((d) => (
          <div key={d.faixa} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${d.cls}`} />
            <span className="text-ink-500">{d.faixa}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
