import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import type { LegendTone } from "@thenetwork/ui";
import type { ObsMember, ObsOpportunity } from "../src/types.ts";
import { type EDGE_TYPES, OPEN, store, type ColorLens } from "./store.ts";
import { pickMember } from "./ui.tsx";

interface Node extends SimulationNodeDatum { id: string; community: string; ax: number; ay: number; r: number }
interface Link extends SimulationLinkDatum<Node> { type: string }

export type Ink =
  | LegendTone
  | "foreground"
  | "background"
  | "border"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "chart-6";

const INK_VAR: Record<Ink, string> = {
  primary: "--primary",
  ok: "--ok",
  warn: "--warn",
  destructive: "--destructive",
  muted: "--muted-foreground",
  accent: "--accent-foreground",
  foreground: "--foreground",
  background: "--background",
  border: "--border",
  "chart-1": "--chart-1",
  "chart-2": "--chart-2",
  "chart-3": "--chart-3",
  "chart-4": "--chart-4",
  "chart-5": "--chart-5",
  "chart-6": "--chart-6",
};
/** The resolved color of each ink, read from the document root at draw time. */
export type Palette = Record<Ink, string>;
/** One ink and the opacity to draw it at. Series that share an ink differ by opacity, line width, dash or shape. */
export interface Paint { ink: Ink; alpha: number }

/** Reads the brand colors from the design-system CSS variables, so the drawing follows the brand and the light or dark theme. */
export function readPalette(root: Element = document.documentElement): Palette {
  const style = getComputedStyle(root);
  return Object.fromEntries(Object.entries(INK_VAR).map(([ink, name]) => [ink, style.getPropertyValue(name).trim()])) as Palette;
}

/** How each relationship type is drawn. The ink is also the legend tone of the type. */
export const EDGE_STYLE: Record<(typeof EDGE_TYPES)[number], { ink: LegendTone; alpha: number; width: number; dash?: number[] }> = {
  knows: { ink: "muted", alpha: 0.09, width: 0.6 },
  invited_by: { ink: "accent", alpha: 0.14, width: 0.6, dash: [1, 2] },
  vouched_for: { ink: "accent", alpha: 0.2, width: 0.6, dash: [4, 2] },
  introduced: { ink: "primary", alpha: 0.55, width: 1 },
  met: { ink: "ok", alpha: 0.5, width: 1.2 },
  enjoyed: { ink: "ok", alpha: 0.75, width: 1.6 },
  would_interact_again: { ink: "ok", alpha: 0.95, width: 2.2 },
  avoid: { ink: "warn", alpha: 0.7, width: 1.2, dash: [3, 3] },
  blocked: { ink: "destructive", alpha: 0.65, width: 1, dash: [2, 2] },
};
export const OPP_INK: Record<string, Ink> = {
  PROPOSED: "muted", IN_REVIEW: "chart-2", INVITING: "warn", PARTIALLY_ACCEPTED: "primary", MUTUALLY_ACCEPTED: "ok", QUORUM_MET: "ok", SCHEDULED: "ok",
};
export const oppInk = (o: ObsOpportunity): Ink => (o.source === "shadow" ? "foreground" : OPP_INK[o.state] ?? "muted");
const STATE_PAINT: Record<string, Paint> = {
  open: { ink: "ok", alpha: 1 }, normal: { ink: "primary", alpha: 1 }, quiet: { ink: "muted", alpha: 1 }, receiving: { ink: "warn", alpha: 1 },
  paused: { ink: "muted", alpha: 0.5 }, opted_out: { ink: "destructive", alpha: 1 }, not_joined: { ink: "border", alpha: 1 },
};
export const PULSE_INK = { good: "ok", bad: "destructive", warn: "warn", info: "primary" } as const satisfies Record<string, Ink>;
const ARCHETYPE_PAINT: Record<string, Paint> = {
  regular: { ink: "chart-1", alpha: 1 }, busy_parent: { ink: "chart-2", alpha: 1 }, newcomer: { ink: "chart-3", alpha: 1 }, connector: { ink: "chart-4", alpha: 1 },
  introvert: { ink: "chart-5", alpha: 1 }, very_active: { ink: "chart-6", alpha: 1 }, never_replies: { ink: "muted", alpha: 1 }, traveler: { ink: "primary", alpha: 0.7 },
};
const COMMUNITY_PAINTS: Paint[] = (["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6"] as const).flatMap(ink => [{ ink, alpha: 1 }, { ink, alpha: 0.65 }]);

/** A stable FNV-1a hash of a string. */
export function hashOf(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** The paint of a community: the same community always gets the same paint. */
export function communityPaint(c: string): Paint { return COMMUNITY_PAINTS[hashOf(c) % COMMUNITY_PAINTS.length]!; }

/** The paint of a member under a color lens. */
export function memberPaint(m: ObsMember, lens: ColorLens): Paint {
  if (!m.joined && lens === "state") return STATE_PAINT.not_joined!;
  switch (lens) {
    case "state": return STATE_PAINT[m.state] ?? { ink: "primary", alpha: 1 };
    case "activity": {
      const a = Math.min(1, (m.counters.meetings * 2 + m.counters.accepted + m.counters.proposals * 0.15) / 8);
      return { ink: "primary", alpha: 0.25 + a * 0.75 };
    }
    case "truth": {
      const t = store.truth?.[m.id];
      if (!t) return { ink: "border", alpha: 1 };
      if (t.adversarial) return { ink: "destructive", alpha: 1 };
      if (t.trueAge < 18) return { ink: "warn", alpha: 1 };
      return ARCHETYPE_PAINT[t.archetype] ?? { ink: "primary", alpha: 1 };
    }
    default: return communityPaint(m.community ?? m.city);
  }
}

interface Pulse { x: number; y: number; t0: number; ink: Ink; big: boolean }

/**
 * The social graph: a d3-force layout, clustered by community, drawn on a Canvas2D. Members are nodes, known and learned
 * relationships are lines, open opportunities are animated arcs, and feed events pulse on the members involved. Drag pans,
 * the wheel zooms, a click focuses and a shift-click picks people for an intro. Filters and focus come from the store.
 * Colors come from the design-system CSS variables at each frame.
 */
export class GraphView {
  private ctx: CanvasRenderingContext2D;
  private sim: Simulation<Node, Link>;
  private nodes = new Map<string, Node>();
  private links: Link[] = [];
  private graphTick = -1;
  private view = { x: 0, y: 0, k: 0.55 };
  private w = 0; private h = 0; private dpr = 1;
  private hover: string | null = null;
  private drag: { pointerId: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null = null;
  private pulses: Pulse[] = [];
  private raf = 0;
  private lastBorough = "all";
  private lastCity = store.selectedCity;
  private lastFocus = "";
  private ro: ResizeObserver;
  onHover?: (id: string | null, x: number, y: number) => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.sim = forceSimulation<Node, Link>([])
      .force("charge", forceManyBody<Node>().strength(-16).distanceMax(150))
      .force("collide", forceCollide<Node>(n => n.r + 1.6).iterations(1))
      .force("x", forceX<Node>(n => n.ax).strength(0.07))
      .force("y", forceY<Node>(n => n.ay).strength(0.07))
      .force("link", forceLink<Node, Link>([]).id(n => n.id).strength(l => (l.type === "knows" ? 0.025 : l.type === "met" || l.type === "enjoyed" || l.type === "would_interact_again" ? 0.12 : 0.04)).distance(26))
      .alphaDecay(0.03).stop();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.bind();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.sim.stop(); }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (this.w && this.h) {
      const dx = (r.width - this.w) / 2, dy = (r.height - this.h) / 2;
      this.view.x += dx; this.view.y += dy;
      if (this.drag) { this.drag.vx += dx; this.drag.vy += dy; }
    }
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  /** Rebuild nodes and links from the store (keeps existing positions). */
  private syncGraph() {
    if (this.graphTick === store.graphTick) return;
    this.graphTick = store.graphTick;
    const comms = [...new Set([...store.members.values()].map(m => m.community ?? m.city))].sort();
    const anchor = new Map<string, [number, number]>();
    comms.forEach((c, i) => {
      const a = (i / comms.length) * Math.PI * 2 - Math.PI / 2, rad = comms.length > 1 ? 250 : 0;
      anchor.set(c, [Math.cos(a) * rad, Math.sin(a) * rad]);
    });
    const next = new Map<string, Node>();
    for (const m of store.members.values()) {
      const community = m.community ?? m.city;
      const [ax, ay] = anchor.get(community) ?? [0, 0];
      const prev = this.nodes.get(m.id);
      const r = nodeRadius(m);
      next.set(m.id, prev ? Object.assign(prev, { ax, ay, r, community }) : { id: m.id, community, ax, ay, r, x: ax + (Math.random() - 0.5) * 80, y: ay + (Math.random() - 0.5) * 80 });
    }
    const fresh = this.nodes.size === 0;
    this.nodes = next;
    this.links = [];
    for (const e of store.edges.values()) {
      if (e.type === "blocked" || e.type === "avoid") continue;
      if (next.has(e.from) && next.has(e.to)) this.links.push({ source: e.from, target: e.to, type: e.type });
    }
    this.sim.nodes([...next.values()]);
    (this.sim.force("link") as ReturnType<typeof forceLink<Node, Link>>).links(this.links);
    if (fresh) { this.sim.alpha(1); for (let i = 0; i < 220; i++) this.sim.tick(); this.fit(); }
    else this.sim.alpha(Math.max(this.sim.alpha(), 0.12));
  }

  /** Fit the view to the given members (default: every member the filters show). */
  fit(ids?: Iterable<string>) {
    const want = ids ? new Set(ids) : null;
    const ns = [...this.nodes.values()].filter(n => (want ? want.has(n.id) : this.visible(n.id)));
    if (!ns.length || !this.w) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x!); y0 = Math.min(y0, n.y!); x1 = Math.max(x1, n.x!); y1 = Math.max(y1, n.y!); }
    const k = Math.min(this.w / (x1 - x0 + 120), this.h / (y1 - y0 + 120), want ? 2 : 2.5);
    this.view = { k, x: this.w / 2 - ((x0 + x1) / 2) * k, y: this.h / 2 - ((y0 + y1) / 2) * k };
  }

  focus(id: string) {
    const n = this.nodes.get(id);
    if (!n) return;
    const k = Math.max(this.view.k, 1.4);
    this.view = { k, x: this.w / 2 - n.x! * k, y: this.h / 2 - n.y! * k };
  }

  /** Shown under the borough and domain filters (the focus and the picks always are). */
  private visible(id: string) { const m = store.members.get(id); return !!m && this.nodes.has(id) && ((store.inBorough(m) && store.matchMemberDomain(m)) || !!this.fs?.has(id)); }
  /** The store's focus set, read once per frame. */
  private fs: Set<string> | null = null;

  private toWorld(px: number, py: number) { return { x: (px - this.view.x) / this.view.k, y: (py - this.view.y) / this.view.k }; }

  private pick(px: number, py: number): string | null {
    const p = this.toWorld(px, py);
    const tol = 9 / this.view.k;
    let best: string | null = null, bd = Infinity;
    for (const n of this.nodes.values()) {
      if (!this.visible(n.id)) continue;
      const d = Math.hypot(n.x! - p.x, n.y! - p.y);
      if (d <= Math.max(tol, n.r + 2) && d < bd) { best = n.id; bd = d; }
    }
    return best;
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", e => {
      if (this.drag) return;
      c.setPointerCapture(e.pointerId);
      this.drag = { pointerId: e.pointerId, sx: e.offsetX, sy: e.offsetY, vx: this.view.x, vy: this.view.y, moved: false };
    });
    c.addEventListener("pointermove", e => {
      if (this.drag) {
        if (e.pointerId !== this.drag.pointerId) return;
        const dx = e.offsetX - this.drag.sx, dy = e.offsetY - this.drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
        if (this.drag.moved) { this.view.x = this.drag.vx + dx; this.view.y = this.drag.vy + dy; }
        return;
      }
      const id = this.pick(e.offsetX, e.offsetY);
      if (id !== this.hover) { this.hover = id; c.style.cursor = id ? "pointer" : "grab"; }
      this.onHover?.(id, e.offsetX, e.offsetY);
    });
    c.addEventListener("pointerup", e => {
      const d = this.drag;
      if (!d || d.pointerId !== e.pointerId) return;
      this.drag = null;
      if (d.moved) return;
      const id = this.pick(e.offsetX, e.offsetY);
      if (!id) return;
      if (e.shiftKey || e.metaKey) pickMember(id);
      else store.focus({ kind: "member", id });
    });
    const stopDrag = (e: PointerEvent) => {
      if (this.drag?.pointerId === e.pointerId) this.drag = null;
    };
    c.addEventListener("pointercancel", stopDrag);
    c.addEventListener("lostpointercapture", stopDrag);
    c.addEventListener("pointerleave", () => { this.hover = null; this.onHover?.(null, 0, 0); });
    c.addEventListener("wheel", e => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      const k = Math.min(8, Math.max(0.15, this.view.k * f));
      const p = this.toWorld(e.offsetX, e.offsetY);
      this.view = { k, x: e.offsetX - p.x * k, y: e.offsetY - p.y * k };
    }, { passive: false });
    c.addEventListener("dblclick", () => this.fit());
  }

  private takePulses(now: number) {
    for (const f of store.pulses.splice(0)) {
      const ink = PULSE_INK[f.severity ?? "info"];
      const big = f.kind === "outcome" || f.kind === "meeting" || f.kind === "game" || f.kind === "block";
      for (const id of (f.members ?? []).slice(0, 6)) {
        const n = this.nodes.get(id);
        if (n && (f.kind !== "join" || this.pulses.length < 120)) this.pulses.push({ x: n.x!, y: n.y!, t0: now, ink, big });
      }
    }
    if (this.pulses.length > 400) this.pulses = this.pulses.slice(-400);
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    this.syncGraph();
    this.fs = store.focusSet();
    const cityChanged = store.selectedCity !== this.lastCity;
    const zoneChanged = store.ui.filters.borough !== this.lastBorough;
    this.lastCity = store.selectedCity;
    this.lastBorough = store.ui.filters.borough;
    if (cityChanged ? !store.ui.focus : zoneChanged) this.fit();
    const fk = store.ui.focus ? `${store.ui.focus.kind}:${store.ui.focus.id}` : "";
    if (fk !== this.lastFocus) {
      this.lastFocus = fk;
      const f = store.ui.focus;
      if (f?.kind === "member") this.focus(f.id);
      else if (f) { const set = store.focusSet(); if (set?.size) this.fit(set); }
    }
    if (this.sim.alpha() > 0.02) this.sim.tick();
    this.takePulses(now);
    this.draw(now);
  };

  private draw(now: number) {
    const ctx = this.ctx, { k, x, y } = this.view, ui = store.ui;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * x, this.dpr * y);
    const visible = (id: string) => this.visible(id);
    const f = ui.focus;
    const sel = f?.kind === "member" ? f.id : null;
    const selOpp = f?.kind === "opportunity" ? store.opps.get(f.id) : undefined;
    const area = f?.kind === "neighborhood" ? f.id : null;
    const focusSet = this.fs ?? new Set<string>();
    const dimmed = focusSet.size > 0;
    const bright = (m: ObsMember) => (!dimmed || focusSet.has(m.id)) && store.matchMemberFilter(m) && store.matchMemberDomain(m);
    const ink = readPalette();
    for (const [type, st] of Object.entries(EDGE_STYLE)) {
      if (!ui.edgeTypes[type]) continue;
      ctx.beginPath();
      let any = false;
      for (const e of store.edges.values()) {
        if (e.type !== type || !visible(e.from) || !visible(e.to)) continue;
        if (sel && e.from !== sel && e.to !== sel) continue;
        if (area && (store.members.get(e.from)?.area !== area || store.members.get(e.to)?.area !== area)) continue;
        if (dimmed && !sel && !area && !(focusSet.has(e.from) && focusSet.has(e.to))) continue;
        const a = this.nodes.get(e.from)!, b = this.nodes.get(e.to)!;
        ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!); any = true;
      }
      if (!any) continue;
      ctx.strokeStyle = ink[st.ink];
      ctx.globalAlpha = dimmed ? Math.min(1, st.alpha * 4) : st.alpha;
      ctx.lineWidth = st.width / Math.sqrt(k);
      ctx.setLineDash(st.dash ? st.dash.map(d => d / k) : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (ui.showOpps) {
      const t = now / 1000;
      for (const o of store.opps.values()) {
        const shadow = o.source === "shadow";
        if (!shadow && !OPEN.has(o.state)) continue;
        if (!o.participants.every(visible) || !store.matchOpp(o)) continue;
        if (dimmed && !o.participants.some(id => focusSet.has(id)) && selOpp?.id !== o.id) continue;
        this.drawOpp(ctx, o, t, k, selOpp?.id === o.id, ink[oppInk(o)]);
      }
    }

    const busy = store.busy();
    const controlled = new Set(store.game?.controlled ?? []);
    for (const m of store.members.values()) {
      const n = this.nodes.get(m.id);
      if (!n || !this.visible(m.id)) continue;
      const faded = !bright(m);
      const paint = memberPaint(m, ui.colorBy);
      ctx.globalAlpha = (faded ? 0.15 : m.joined ? 1 : 0.35) * paint.alpha;
      const r = n.r;
      ctx.fillStyle = ink[paint.ink];
      ctx.beginPath();
      if (m.minor) { ctx.moveTo(n.x!, n.y! - r - 1); ctx.lineTo(n.x! + r + 1, n.y!); ctx.lineTo(n.x!, n.y! + r + 1); ctx.lineTo(n.x! - r - 1, n.y!); ctx.closePath(); }
      else ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
      if (m.state === "opted_out") { ctx.strokeStyle = ink.destructive; ctx.lineWidth = 1.2 / Math.sqrt(k); ctx.stroke(); }
      else ctx.fill();
      ctx.globalAlpha = faded ? 0.15 : 1;
      if (busy.has(m.id) && !faded) {
        ctx.globalAlpha = 0.55; ctx.strokeStyle = ink.foreground; ctx.lineWidth = 0.8 / Math.sqrt(k);
        ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 2.2, 0, Math.PI * 2); ctx.stroke();
      }
      if (controlled.has(m.id)) {
        ctx.globalAlpha = 1; ctx.strokeStyle = ink.warn; ctx.lineWidth = 2 / Math.sqrt(k);
        ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const keep: Pulse[] = [];
    for (const p of this.pulses) {
      const age = (now - p.t0) / (p.big ? 1400 : 900);
      if (age >= 1) continue;
      keep.push(p);
      ctx.strokeStyle = ink[p.ink]; ctx.globalAlpha = (1 - age) * 0.9; ctx.lineWidth = (p.big ? 2.2 : 1.2) / Math.sqrt(k);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 + age * (p.big ? 26 : 12), 0, Math.PI * 2); ctx.stroke();
    }
    this.pulses = keep;
    ctx.globalAlpha = 1;

    const label = (id: string, ring: Ink, alpha: number, width: number) => {
      const n = this.nodes.get(id), m = store.members.get(id);
      if (!n || !m || !visible(id)) return;
      ctx.globalAlpha = alpha; ctx.strokeStyle = ink[ring]; ctx.lineWidth = 2 / k;
      ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r + width / k, 0, Math.PI * 2); ctx.stroke();
      ctx.font = `600 ${12 / k}px ui-sans-serif, system-ui`;
      ctx.textAlign = "center";
      const text = m.name;
      const tw = ctx.measureText(text).width;
      ctx.globalAlpha = 0.85; ctx.fillStyle = ink.background;
      ctx.fillRect(n.x! - tw / 2 - 4 / k, n.y! - n.r - 22 / k, tw + 8 / k, 16 / k);
      ctx.globalAlpha = 1; ctx.fillStyle = ink.foreground;
      ctx.fillText(text, n.x!, n.y! - n.r - 10 / k);
    };
    ui.picks.forEach(id => label(id, "warn", 1, 5));
    if (sel) label(sel, "foreground", 1, 6);
    if (this.hover && this.hover !== sel) label(this.hover, "foreground", 0.6, 4);
    ctx.globalAlpha = 1;
  }

  private drawOpp(ctx: CanvasRenderingContext2D, o: ObsOpportunity, t: number, k: number, selected: boolean, color: string) {
    const ps = o.participants.map(id => this.nodes.get(id)!).filter(Boolean);
    if (ps.length < 2) return;
    const shadow = o.source === "shadow";
    ctx.strokeStyle = color;
    ctx.globalAlpha = selected ? 1 : shadow ? 0.5 : o.source === "player" ? 0.95 : 0.65;
    ctx.lineWidth = (selected ? 2.6 : o.source === "player" ? 1.8 : 1.1) / Math.sqrt(k);
    ctx.setLineDash(shadow ? [1.5 / k, 3 / k] : o.state === "IN_REVIEW" ? [1 / k, 4 / k] : [5 / k, 4 / k]);
    ctx.lineDashOffset = -t * 18 / k;
    ctx.beginPath();
    if (ps.length === 2) {
      const [a, b] = ps as [Node, Node];
      const mx = (a.x! + b.x!) / 2, my = (a.y! + b.y!) / 2, dx = b.x! - a.x!, dy = b.y! - a.y!;
      ctx.moveTo(a.x!, a.y!);
      ctx.quadraticCurveTo(mx - dy * 0.22, my + dx * 0.22, b.x!, b.y!);
    } else {
      const cx = ps.reduce((s, n) => s + n.x!, 0) / ps.length, cy = ps.reduce((s, n) => s + n.y!, 0) / ps.length;
      for (const n of ps) { ctx.moveTo(cx, cy); ctx.lineTo(n.x!, n.y!); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, 2.4 / Math.sqrt(k), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

function nodeRadius(m: ObsMember) {
  const a = m.counters.meetings * 2 + m.counters.accepted + m.counters.proposals * 0.2;
  return 2.6 + Math.min(5, Math.sqrt(a) * 0.9);
}
