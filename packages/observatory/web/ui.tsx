// Small shared UI pieces and formatters.
import type { ReactNode } from "react";
import type { ScoreComponents } from "@thenetwork/core";

const tf = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  if (!tf.has(key)) tf.set(key, new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }));
  return tf.get(key)!;
}
export const TZ = { sf: "America/Los_Angeles", nyc: "America/New_York" } as const;
export const localTime = (t: number, city: "sf" | "nyc") => fmt(TZ[city], { hour: "numeric", minute: "2-digit" }).format(t);
export const localDate = (t: number, city: "sf" | "nyc" = "sf") => fmt(TZ[city], { weekday: "short", month: "short", day: "numeric" }).format(t);
export const stamp = (t: number, city: "sf" | "nyc" = "sf") => fmt(TZ[city], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(t);
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const num = (x: number) => x.toLocaleString("en-US");
export const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase();

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: string; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ""}`}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub !== undefined && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/** Horizontal bars for a small categorical breakdown. */
export function Bars({ data, color = "var(--accent)", max, format = num, limit = 12, onClick }: {
  data: Record<string, number> | [string, number][]; color?: string | ((k: string) => string); max?: number; format?: (x: number) => string; limit?: number; onClick?: (k: string) => void;
}) {
  const rows = (Array.isArray(data) ? data : Object.entries(data)).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const m = max ?? Math.max(1, ...rows.map(r => r[1]));
  if (!rows.length) return <div className="muted small">nothing yet</div>;
  return (
    <div className="bars">
      {rows.map(([k, v]) => (
        <div className={`bar-row ${onClick ? "clickable" : ""}`} key={k} onClick={onClick ? () => onClick(k) : undefined}>
          <div className="bar-label" title={k}>{humanize(k)}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(v / m) * 100}%`, background: typeof color === "function" ? color(k) : color }} /></div>
          <div className="bar-value">{format(v)}</div>
        </div>
      ))}
    </div>
  );
}

export const COMPONENT_SIGN: Record<keyof ScoreComponents, 1 | -1> = {
  fit: 1, mutualBenefit: 1, warmPath: 1, novelty: 1, timingFit: 1, confidence: 1,
  activationCost: -1, interruptionCost: -1, load: -1, repetition: -1, socialRisk: -1,
};
export function Components({ c }: { c?: ScoreComponents }) {
  if (!c) return null;
  return (
    <div className="components">
      {(Object.keys(COMPONENT_SIGN) as (keyof ScoreComponents)[]).map(k => (
        <div className="comp" key={k} title={`${k}: ${c[k]}`}>
          <span className="comp-label">{humanize(k.replace(/([A-Z])/g, "_$1"))}</span>
          <span className="comp-track"><span className={`comp-fill ${COMPONENT_SIGN[k] < 0 ? "neg" : "pos"}`} style={{ width: `${Math.min(1, Math.abs(c[k])) * 100}%` }} /></span>
          <span className="comp-val">{c[k].toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

/** Lorenz curve of proposal exposure (cumulative share held by the bottom 10%, 20%...). */
export function Lorenz({ points }: { points: number[] }) {
  const pts = [0, ...points];
  const n = pts.length - 1;
  const path = pts.map((v, i) => `${(i / n) * 100},${100 - v * 100}`).join(" ");
  return (
    <svg className="lorenz" viewBox="-4 -4 108 108" role="img" aria-label="Lorenz curve of proposal exposure">
      <rect x="0" y="0" width="100" height="100" className="lorenz-frame" />
      <line x1="0" y1="100" x2="100" y2="0" className="lorenz-equal" />
      <polyline points={path} className="lorenz-line" />
    </svg>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><h3>{title}</h3>{right}</div>
      {children}
    </section>
  );
}
