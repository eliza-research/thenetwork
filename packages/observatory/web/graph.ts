// Social graph renderer: d3-force layout (clustered by city, then community) drawn on a Canvas2D.
// Members are nodes; known and learned edges are lines; open opportunities are animated arcs;
// feed events pulse on the members involved. Pan (drag), zoom (wheel), click to select, shift-click
// to pick people for an intro.
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import type { ObsMember, ObsOpportunity } from "../src/types.ts";
import { OPEN, store, type ColorLens } from "./store.ts";

interface Node extends SimulationNodeDatum { id: string; city: string; community: string; ax: number; ay: number; r: number }
interface Link extends SimulationLinkDatum<Node> { type: string }

export const EDGE_STYLE: Record<string, { color: string; alpha: number; width: number; dash?: number[] }> = {
  knows: { color: "#8ea6d6", alpha: 0.09, width: 0.6 },
  invited_by: { color: "#b39ddb", alpha: 0.14, width: 0.6 },
  vouched_for: { color: "#d59be8", alpha: 0.14, width: 0.6 },
  introduced: { color: "#5fb4ff", alpha: 0.55, width: 1 },
  met: { color: "#3fd6e6", alpha: 0.7, width: 1.2 },
  enjoyed: { color: "#5cf0a4", alpha: 0.8, width: 1.6 },
  would_interact_again: { color: "#ffd45c", alpha: 0.95, width: 2 },
  avoid: { color: "#ff8f66", alpha: 0.7, width: 1.2, dash: [3, 3] },
  blocked: { color: "#ff5468", alpha: 0.65, width: 1, dash: [2, 2] },
};
export const OPP_COLOR: Record<string, string> = {
  PROPOSED: "#a3a9e6", INVITING: "#ffb85c", PARTIALLY_ACCEPTED: "#58c4ff", MUTUALLY_ACCEPTED: "#2fd9e8", QUORUM_MET: "#2fd9e8", SCHEDULED: "#3dff9a",
};
export const STATE_COLOR: Record<string, string> = {
  open: "#4fd1c5", normal: "#7aa2ff", quiet: "#a08cff", receiving: "#f6ad55", paused: "#7c8799", opted_out: "#ff5468", not_joined: "#3a4356",
};
const CITY_COLOR: Record<string, string> = { sf: "#ff9a6b", nyc: "#6bb8ff" };
const PULSE_COLOR = { good: "#5cf0a4", bad: "#ff5468", warn: "#ffb85c", info: "#9cc8ff" } as const;
const ARCHETYPE_COLOR: Record<string, string> = {
  regular: "#7aa2ff", busy_parent: "#a08cff", newcomer: "#4fd1c5", connector: "#ffd45c", introvert: "#8e9bb5",
  very_active: "#ff9a6b", never_replies: "#4a5468", traveler: "#d59be8",
};
const CITY_X: Record<string, number> = { sf: -560, nyc: 560 };
const CITY_NAME: Record<string, string> = { sf: "San Francisco", nyc: "New York" };

export function hashHue(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 360); }
export function communityColor(c: string) { return `hsl(${hashHue(c)}, 62%, 66%)`; }

export function memberColor(m: ObsMember, lens: ColorLens): string {
  if (!m.joined && lens === "state") return STATE_COLOR.not_joined!;
  switch (lens) {
    case "state": return STATE_COLOR[m.state] ?? "#7aa2ff";
    case "city": return CITY_COLOR[m.city] ?? "#ccc";
    case "activity": {
      const a = Math.min(1, (m.counters.meetings * 2 + m.counters.accepted + m.counters.proposals * 0.15) / 8);
      return `hsl(${220 - a * 175}, ${55 + a * 40}%, ${42 + a * 26}%)`;
    }
    case "truth": {
      const t = store.truth?.[m.id];
      if (!t) return "#556";
      if (t.adversarial) return "#ff3b4e";
      if (t.trueAge < 18) return "#ff5cf0";
      return ARCHETYPE_COLOR[t.archetype] ?? "#7aa2ff";
    }
    default: return communityColor(m.community ?? m.city);
  }
}

interface Pulse { x: number; y: number; t0: number; color: string; big: boolean }

export class GraphView {
  private ctx: CanvasRenderingContext2D;
  private sim: Simulation<Node, Link>;
  private nodes = new Map<string, Node>();
  private links: Link[] = [];
  private graphTick = -1;
  private view = { x: 0, y: 0, k: 0.55 };
  private w = 0; private h = 0; private dpr = 1;
  private hover: string | null = null;
  private drag: { sx: number; sy: number; vx: number; vy: number; moved: boolean } | null = null;
  private pulses: Pulse[] = [];
  private raf = 0;
  private lastCity = "all";
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
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  /** Rebuild nodes and links from the store (keeps existing positions). */
  private syncGraph() {
    if (this.graphTick === store.graphTick) return;
    this.graphTick = store.graphTick;
    const byCity = new Map<string, string[]>();
    for (const m of store.members.values()) {
      const c = m.community ?? m.city;
      if (!byCity.has(m.city)) byCity.set(m.city, []);
      const list = byCity.get(m.city)!;
      if (!list.includes(c)) list.push(c);
    }
    const anchor = new Map<string, [number, number]>();
    for (const [city, comms] of byCity) {
      comms.sort();
      comms.forEach((c, i) => {
        const a = (i / comms.length) * Math.PI * 2 - Math.PI / 2, rad = comms.length > 1 ? 250 : 0;
        anchor.set(`${city}|${c}`, [(CITY_X[city] ?? 0) + Math.cos(a) * rad, Math.sin(a) * rad]);
      });
    }
    const next = new Map<string, Node>();
    for (const m of store.members.values()) {
      const [ax, ay] = anchor.get(`${m.city}|${m.community ?? m.city}`) ?? [CITY_X[m.city] ?? 0, 0];
      const prev = this.nodes.get(m.id);
      const r = nodeRadius(m);
      next.set(m.id, prev ? Object.assign(prev, { ax, ay, r, community: m.community ?? m.city }) : { id: m.id, city: m.city, community: m.community ?? m.city, ax, ay, r, x: ax + (Math.random() - 0.5) * 80, y: ay + (Math.random() - 0.5) * 80 });
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

  fit() {
    const city = store.ui.city;
    const ns = [...this.nodes.values()].filter(n => city === "all" || n.city === city);
    if (!ns.length || !this.w) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x!); y0 = Math.min(y0, n.y!); x1 = Math.max(x1, n.x!); y1 = Math.max(y1, n.y!); }
    const k = Math.min(this.w / (x1 - x0 + 120), this.h / (y1 - y0 + 120), 2.5);
    this.view = { k, x: this.w / 2 - ((x0 + x1) / 2) * k, y: this.h / 2 - ((y0 + y1) / 2) * k };
  }

  focus(id: string) {
    const n = this.nodes.get(id);
    if (!n) return;
    const k = Math.max(this.view.k, 1.4);
    this.view = { k, x: this.w / 2 - n.x! * k, y: this.h / 2 - n.y! * k };
  }

  private toWorld(px: number, py: number) { return { x: (px - this.view.x) / this.view.k, y: (py - this.view.y) / this.view.k }; }

  private pick(px: number, py: number): string | null {
    const p = this.toWorld(px, py);
    const city = store.ui.city;
    const tol = 9 / this.view.k;
    let best: string | null = null, bd = Infinity;
    for (const n of this.nodes.values()) {
      if (city !== "all" && n.city !== city) continue;
      const d = Math.hypot(n.x! - p.x, n.y! - p.y);
      if (d <= Math.max(tol, n.r + 2) && d < bd) { best = n.id; bd = d; }
    }
    return best;
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", e => {
      c.setPointerCapture(e.pointerId);
      this.drag = { sx: e.offsetX, sy: e.offsetY, vx: this.view.x, vy: this.view.y, moved: false };
    });
    c.addEventListener("pointermove", e => {
      if (this.drag) {
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
      const d = this.drag; this.drag = null;
      if (d?.moved) return;
      const id = this.pick(e.offsetX, e.offsetY);
      if (!id) { if (!e.shiftKey) store.select(null); return; }
      if (e.shiftKey || e.metaKey) store.togglePick(id);
      else store.select({ kind: "member", id });
    });
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
      const color = PULSE_COLOR[f.severity ?? "info"];
      const big = f.kind === "outcome" || f.kind === "meeting" || f.kind === "game" || f.kind === "block";
      for (const id of (f.members ?? []).slice(0, 6)) {
        const n = this.nodes.get(id);
        if (n && (f.kind !== "join" || this.pulses.length < 120)) this.pulses.push({ x: n.x!, y: n.y!, t0: now, color, big });
      }
    }
    if (this.pulses.length > 400) this.pulses = this.pulses.slice(-400);
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    this.syncGraph();
    if (store.ui.city !== this.lastCity) { this.lastCity = store.ui.city; this.fit(); }
    if (this.sim.alpha() > 0.02) this.sim.tick();
    this.takePulses(now);
    this.draw(now);
  };

  private draw(now: number) {
    const ctx = this.ctx, { k, x, y } = this.view, ui = store.ui;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * x, this.dpr * y);
    const city = ui.city;
    const visible = (id: string) => { const n = this.nodes.get(id); return !!n && (city === "all" || n.city === city); };
    const sel = ui.selection?.kind === "member" ? ui.selection.id : null;
    const selOpp = ui.selection?.kind === "opportunity" ? store.opps.get(ui.selection.id) : undefined;
    const focusSet = new Set<string>();
    if (sel) { focusSet.add(sel); for (const e of store.edges.values()) { if (e.from === sel) focusSet.add(e.to); if (e.to === sel) focusSet.add(e.from); } }
    if (selOpp) for (const id of selOpp.participants) focusSet.add(id);
    for (const id of ui.picks) focusSet.add(id);
    const dimmed = focusSet.size > 0;

    // City labels.
    ctx.textAlign = "center";
    ctx.font = `600 ${Math.max(14, 26 / Math.sqrt(k))}px ui-sans-serif, system-ui`;
    ctx.fillStyle = "rgba(170,190,230,0.10)";
    for (const [c, cx] of Object.entries(CITY_X)) if (city === "all" || city === c) ctx.fillText(CITY_NAME[c]!.toUpperCase(), cx, -330);

    // Edges, batched per type.
    for (const [type, st] of Object.entries(EDGE_STYLE)) {
      if (!ui.edgeTypes[type]) continue;
      ctx.beginPath();
      let any = false;
      for (const e of store.edges.values()) {
        if (e.type !== type || !visible(e.from) || !visible(e.to)) continue;
        if (dimmed && !(focusSet.has(e.from) && focusSet.has(e.to)) && !(sel && (e.from === sel || e.to === sel))) continue;
        const a = this.nodes.get(e.from)!, b = this.nodes.get(e.to)!;
        ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!); any = true;
      }
      if (!any) continue;
      ctx.strokeStyle = st.color;
      ctx.globalAlpha = dimmed ? Math.min(1, st.alpha * 4) : st.alpha;
      ctx.lineWidth = st.width / Math.sqrt(k);
      ctx.setLineDash(st.dash ? st.dash.map(d => d / k) : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Open opportunities as flowing arcs.
    if (ui.showOpps) {
      const t = now / 1000;
      for (const o of store.opps.values()) {
        const shadow = o.source === "shadow";
        if (!shadow && !OPEN.has(o.state)) continue;
        if (!o.participants.every(visible)) continue;
        if (dimmed && !o.participants.some(id => focusSet.has(id)) && selOpp?.id !== o.id) continue;
        this.drawOpp(ctx, o, t, k, selOpp?.id === o.id);
      }
    }

    // Nodes.
    const busy = store.busy();
    const controlled = new Set(store.game?.controlled ?? []);
    for (const m of store.members.values()) {
      const n = this.nodes.get(m.id);
      if (!n || (city !== "all" && n.city !== city)) continue;
      const faded = dimmed && !focusSet.has(m.id);
      ctx.globalAlpha = faded ? 0.18 : m.joined ? 1 : 0.35;
      const r = n.r;
      ctx.fillStyle = memberColor(m, ui.colorBy);
      ctx.beginPath();
      if (m.minor) { ctx.moveTo(n.x!, n.y! - r - 1); ctx.lineTo(n.x! + r + 1, n.y!); ctx.lineTo(n.x!, n.y! + r + 1); ctx.lineTo(n.x! - r - 1, n.y!); ctx.closePath(); }
      else ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
      if (m.state === "opted_out") { ctx.strokeStyle = STATE_COLOR.opted_out!; ctx.lineWidth = 1.2 / Math.sqrt(k); ctx.stroke(); }
      else ctx.fill();
      if (busy.has(m.id) && !faded) {
        ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 0.8 / Math.sqrt(k);
        ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 2.2, 0, Math.PI * 2); ctx.stroke();
      }
      if (controlled.has(m.id)) {
        ctx.strokeStyle = "#ffd45c"; ctx.lineWidth = 2 / Math.sqrt(k);
        ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Pulses.
    const keep: Pulse[] = [];
    for (const p of this.pulses) {
      const age = (now - p.t0) / (p.big ? 1400 : 900);
      if (age >= 1) continue;
      keep.push(p);
      ctx.strokeStyle = p.color; ctx.globalAlpha = (1 - age) * 0.9; ctx.lineWidth = (p.big ? 2.2 : 1.2) / Math.sqrt(k);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 + age * (p.big ? 26 : 12), 0, Math.PI * 2); ctx.stroke();
    }
    this.pulses = keep;
    ctx.globalAlpha = 1;

    // Selection, picks and hover labels.
    const label = (id: string, color: string, ring: number) => {
      const n = this.nodes.get(id), m = store.members.get(id);
      if (!n || !m || !visible(id)) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2 / k;
      ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r + ring / k, 0, Math.PI * 2); ctx.stroke();
      ctx.font = `600 ${12 / k}px ui-sans-serif, system-ui`;
      ctx.textAlign = "center";
      const text = m.name;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(8,11,20,0.85)";
      ctx.fillRect(n.x! - tw / 2 - 4 / k, n.y! - n.r - 22 / k, tw + 8 / k, 16 / k);
      ctx.fillStyle = "#e9eefc";
      ctx.fillText(text, n.x!, n.y! - n.r - 10 / k);
    };
    ui.picks.forEach(id => label(id, "#ffd45c", 5));
    if (sel) label(sel, "#ffffff", 6);
    if (this.hover && this.hover !== sel) label(this.hover, "rgba(255,255,255,0.6)", 4);
  }

  private drawOpp(ctx: CanvasRenderingContext2D, o: ObsOpportunity, t: number, k: number, selected: boolean) {
    const ps = o.participants.map(id => this.nodes.get(id)!).filter(Boolean);
    if (ps.length < 2) return;
    const shadow = o.source === "shadow";
    const color = shadow ? "#ffffff" : OPP_COLOR[o.state] ?? "#aaa";
    ctx.strokeStyle = color;
    ctx.globalAlpha = selected ? 1 : shadow ? 0.5 : o.source === "player" ? 0.95 : 0.65;
    ctx.lineWidth = (selected ? 2.6 : o.source === "player" ? 1.8 : 1.1) / Math.sqrt(k);
    ctx.setLineDash(shadow ? [1.5 / k, 3 / k] : [5 / k, 4 / k]);
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
