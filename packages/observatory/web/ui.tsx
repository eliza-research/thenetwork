// Small shared UI pieces and formatters. Times are New York time: NYC is the only launch city.
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { ScoreComponents } from "@thenetwork/core";
import type { ObsOpportunity } from "../src/types.ts";
import { OPP_COLOR } from "./graph.ts";
import { store } from "./store.ts";

const tf = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(opts);
  if (!tf.has(key)) tf.set(key, new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...opts }));
  return tf.get(key)!;
}
export const localTime = (t: number) => fmt({ hour: "numeric", minute: "2-digit" }).format(t);
export const localDate = (t: number) => fmt({ weekday: "short", month: "short", day: "numeric" }).format(t).replace(",", "");
export const shortDate = (t: number) => fmt({ month: "short", day: "numeric" }).format(t);
export const stamp = (t: number) => fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(t);
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const num = (x: number) => x.toLocaleString("en-US");
export const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase();
export const sentence = (s: string) => { const h = humanize(s); return h.charAt(0).toUpperCase() + h.slice(1); };
/** "3h ago", "2d ago" against the store clock (sim time in game, wall time in real). */
export function ago(t: number, now = store.now()) { return `${dur(Math.max(0, now - t))} ago`; }
/** Compact duration: "45m", "4h 12m", "2d 3h". */
export function dur(ms: number) {
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 1 ? `${d}d${h % 24 ? ` ${h % 24}h` : ""}` : h >= 1 ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
}

/** Close the open popover (store.ui.popover) on a click outside `ref`. */
export function useOutsideClose(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) store.setUI({ popover: null }); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: string; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

/** A value and a label. The definition goes in `title`; a click applies the matching filter. */
export function Kpi({ label, value, tone, title, onClick }: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn"; title?: string; onClick?: () => void }) {
  const cls = `kpi ${tone ? `kpi-${tone}` : ""} ${onClick ? "clickable" : ""}`;
  const body = <><div className="kpi-value">{value}</div><div className="kpi-label">{label}</div></>;
  return onClick
    ? <button type="button" className={cls} title={title} onClick={onClick}>{body}</button>
    : <div className={cls} title={title}>{body}</div>;
}

/** A member name that sets the member focus. */
export function MemberLink({ id, first, children }: { id: string; first?: boolean; children?: ReactNode }) {
  const m = store.members.get(id);
  const n = m ? (first ? m.name.split(" ")[0] : m.name) : id;
  return <button type="button" className="mlink" onClick={e => { e.stopPropagation(); store.focus({ kind: "member", id }); }}>{children ?? n}</button>;
}
/** An opportunity reference ("Maya + Jon") that sets the opportunity focus. */
export function OppLink({ o, children }: { o: ObsOpportunity; children?: ReactNode }) {
  return <button type="button" className="mlink" onClick={e => { e.stopPropagation(); store.focus({ kind: "opportunity", id: o.id }); }}>{children ?? store.oppTitle(o)}</button>;
}
/** A neighborhood name that sets the neighborhood focus. */
export function AreaLink({ area }: { area?: string }) {
  if (!area) return null;
  return <button type="button" className="mlink" onClick={e => { e.stopPropagation(); store.focus({ kind: "neighborhood", id: area }); }}>{area}</button>;
}
export const oppDot = (state: string) => <span className="dot" style={{ background: OPP_COLOR[state] ?? "#7c8799" }} />;

/** Time left to a review deadline, ticking with the store clock. Amber under 1 h, red under 10 min. */
export function Countdown({ deadline, prefix = "", what = "Review deadline" }: { deadline: number; prefix?: string; what?: string }) {
  const left = deadline - store.now();
  const tone = left < 10 * 60_000 ? "bad" : left < 3_600_000 ? "warn" : "";
  return <span className={`countdown ${tone}`} title={`${what} ${stamp(deadline)}`}>{left <= 0 ? "Due now" : `${prefix}${dur(left)}`}</span>;
}

/** Wall-clock time left ("12m left"), ticking every 15 s. For PII reveals, which expire in real time, not sim time. */
export function WallLeft({ until }: { until: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick(x => x + 1), 15_000); return () => clearInterval(h); }, []);
  const left = until - Date.now();
  return <>{left <= 0 ? "expired" : `${Math.max(1, Math.ceil(left / 60_000))}m left`}</>;
}

/** A <details> block whose open state persists per viewer (localStorage obs.disclosure.<name>). */
export function Disclosure({ name, summary, children, defaultOpen = false }: { name: string; summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const key = `obs.disclosure.${name}`;
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === "1"; } catch { return defaultOpen; }
  });
  return (
    <details className="disclosure" open={open} onToggle={e => {
      const o = (e.currentTarget as HTMLDetailsElement).open;
      if (o === open) return;
      setOpen(o);
      try { localStorage.setItem(key, o ? "1" : "0"); } catch { /* storage blocked */ }
    }}>
      <summary>{summary}</summary>
      <div className="disclosure-body">{open ? children : null}</div>
    </details>
  );
}

/** One muted line of facts separated by " · ". Empty parts are dropped. */
export function StatusLine({ parts, className = "" }: { parts: ReactNode[]; className?: string }) {
  const xs = parts.filter(p => p !== null && p !== undefined && p !== false && p !== "");
  if (!xs.length) return null;
  return <div className={`status-line ${className}`}>{xs.map((p, i) => <span key={i}>{i > 0 && <span className="sep"> · </span>}{p}</span>)}</div>;
}

/** Horizontal bars for a small categorical breakdown. */
export function Bars({ data, color = "var(--accent)", max, format = num, limit = 12, onClick, label = humanize }: {
  data: Record<string, number> | [string, number][]; color?: string | ((k: string) => string); max?: number; format?: (x: number) => string; limit?: number; onClick?: (k: string) => void; label?: (k: string) => string;
}) {
  const rows = (Array.isArray(data) ? data : Object.entries(data)).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const m = max ?? Math.max(1, ...rows.map(r => r[1]));
  if (!rows.length) return <div className="muted small">{store.nothing()}</div>;
  return (
    <div className="bars">
      {rows.map(([k, v]) => (
        <div className={`bar-row ${onClick ? "clickable" : ""}`} key={k} onClick={onClick ? () => onClick(k) : undefined}>
          <div className="bar-label" title={k}>{label(k)}</div>
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

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><h3>{title}</h3>{right}</div>
      {children}
    </section>
  );
}
