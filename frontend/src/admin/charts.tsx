import { useId, useState } from 'react';
import { fmtNum } from './ui';

interface Point {
  day: string;
  value: number;
}

const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "+12%" / "−4%" against the previous period; "new" when there was nothing before. */
export function Delta({ now, previous, inverse }: { now: number; previous: number; inverse?: boolean }) {
  if (now === 0 && previous === 0) return <span className="text-white/30 text-xs">no change</span>;
  if (previous === 0) return <span className="text-emerald-400 text-xs font-semibold">new</span>;
  const pct = Math.round(((now - previous) / previous) * 100);
  if (pct === 0) return <span className="text-white/40 text-xs">0%</span>;
  const good = inverse ? pct < 0 : pct > 0;
  return <span className={`text-xs font-semibold tabular-nums ${good ? 'text-emerald-400' : 'text-red-400'}`}>{pct > 0 ? '+' : '−'}{Math.abs(pct)}%</span>;
}

/** A tiny trend line for KPI cards. */
export function Sparkline({ data, className = 'text-brand-amber' }: { data: Point[]; className?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${28 - (d.value / max) * 26}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`w-full h-8 ${className}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Area/line chart with a hover/touch read-out. Pure SVG — no chart library. */
export function LineChart({ data, label }: { data: Point[]; label: string }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <p className="text-white/40 text-sm">Not enough data yet.</p>;
  const W = 600;
  const H = 180;
  const padL = 34;
  const padB = 20;
  const max = Math.max(1, ...data.map((d) => d.value));
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const x = (i: number) => padL + (i / (data.length - 1)) * (W - padL - 4);
  const y = (v: number) => 8 + (1 - v / niceMax) * (H - padB - 8);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${H - padB} L${x(0)},${H - padB} Z`;
  const ticks = [0, 0.5, 1].map((f) => Math.round(niceMax * f));
  const h = hover !== null ? data[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(((px - padL) / (W - padL - 4)) * (data.length - 1)))));
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none select-none"
        role="img"
        aria-label={`${label}, daily, ${data[0].day} to ${data[data.length - 1].day}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="text-brand-amber">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.08)" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)">{fmtNum(t)}</text>
            </g>
          ))}
          <path d={area} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {h && (
            <g>
              <line x1={x(hover!)} x2={x(hover!)} y1={8} y2={H - padB} stroke="rgba(255,255,255,0.25)" />
              <circle cx={x(hover!)} cy={y(h.value)} r="4" fill="currentColor" />
            </g>
          )}
        </g>
        <text x={padL} y={H - 4} fontSize="10" fill="rgba(255,255,255,0.4)">{shortDay(data[0].day)}</text>
        <text x={W - 4} y={H - 4} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)">{shortDay(data[data.length - 1].day)}</text>
      </svg>
      <div className="mt-1 h-5 text-xs text-white/70 tabular-nums">{h ? <><b className="text-white">{fmtNum(h.value)}</b> · {shortDay(h.day)}</> : <span className="text-white/30">Hover or touch the chart for daily values</span>}</div>
    </div>
  );
}

/** Horizontal bars for ranked lists ("top shops"). */
export function BarList({ rows, empty }: { rows: Array<{ key: string; label: string; value: number; sub?: string }>; empty: string }) {
  if (!rows.length) return <p className="text-white/40 text-sm">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-white truncate">{r.label}</span>
            <span className="text-white/60 tabular-nums shrink-0">{fmtNum(r.value)}{r.sub ? <span className="text-white/30"> · {r.sub}</span> : null}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-brand-orange" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Tags shown → saved → clicked → sold, each step with its conversion from the one before. */
export function Funnel({ steps }: { steps: Array<{ label: string; value: number }> }) {
  const top = Math.max(1, steps[0]?.value ?? 1, ...steps.map((s) => s.value));
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].value : 0;
        return (
          <li key={s.label}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-white">{s.label}</span>
              <span className="text-white/60 tabular-nums">
                {fmtNum(s.value)}
                {i > 0 && prev > 0 && <span className="text-white/30"> · {((s.value / prev) * 100).toFixed(s.value / prev < 0.1 ? 1 : 0)}%</span>}
              </span>
            </div>
            <div className="mt-1 h-2 rounded bg-white/10 overflow-hidden">
              <div className="h-full rounded bg-gradient-to-r from-brand-orange to-brand-amber" style={{ width: `${Math.max(s.value ? 2 : 0, (s.value / top) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
