// Client-side observatory state: full state from /api/state, then WebSocket deltas. The graph
// renderer reads the maps directly (no React); React components subscribe via useStore().
import { useSyncExternalStore } from "react";
import type {
  ClockInfo, ControlCommand, ControlResult, EngineRunSummary, EnvInfo, GameState, MemberDetail, MemberTruth, Mode, NetworkInfo, ObsDelta, ObsEdge,
  ObsFeedItem, ObsMember, ObsOpportunity, ObsState, ObsStats, OpportunityDetail,
} from "../src/types.ts";

export type Selection = { kind: "member"; id: string } | { kind: "opportunity"; id: string } | null;
export type ColorLens = "community" | "state" | "city" | "activity" | "truth";

export interface UIState {
  selection: Selection;
  picks: string[];
  city: "all" | "sf" | "nyc";
  colorBy: ColorLens;
  edgeTypes: Record<string, boolean>;
  showOpps: boolean;
  drawer: "feed" | "pipeline" | "engine" | "network" | "metrics" | "game";
  drawerOpen: boolean;
  /** Real NYC map (default) or the force-directed social graph. */
  view: "map" | "graph";
  toast?: { text: string; tone: "info" | "good" | "bad"; at: number };
}

export const EDGE_TYPES = ["knows", "invited_by", "vouched_for", "introduced", "met", "enjoyed", "would_interact_again", "avoid", "blocked"] as const;

class ObsStore {
  mode: Mode = "game";
  env?: EnvInfo;
  clock?: ClockInfo;
  members = new Map<string, ObsMember>();
  edges = new Map<string, ObsEdge>();
  opps = new Map<string, ObsOpportunity>();
  feed: ObsFeedItem[] = [];
  stats?: ObsStats;
  runs: EngineRunSummary[] = [];
  game?: GameState;
  truth?: Record<string, MemberTruth>;
  network?: NetworkInfo;
  version = 0;
  connected = false;
  loading = true;
  ui: UIState = {
    selection: null, picks: [], city: "all", colorBy: "community",
    edgeTypes: Object.fromEntries(EDGE_TYPES.map(t => [t, t !== "invited_by" && t !== "vouched_for"])), showOpps: true,
    drawer: "feed", drawerOpen: true, view: "map",
  };
  /** Bumped on every change; React re-renders off it. */
  tick = 0;
  /** Bumped when the graph's nodes or edges changed (layout must update). */
  graphTick = 0;
  /** Recent feed items for graph pulses (consumed by the renderer). */
  pulses: ObsFeedItem[] = [];
  private listeners = new Set<() => void>();
  private ws?: WebSocket;
  private notifyQueued = false;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getTick = () => this.tick;
  notify() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    // A short timer, not requestAnimationFrame: rAF pauses in hidden or throttled tabs, which would
    // freeze the UI's state (clicks included) until the tab is painted again.
    setTimeout(() => { this.notifyQueued = false; this.tick++; for (const l of this.listeners) l(); }, 30);
  }

  setUI(patch: Partial<UIState>) { this.ui = { ...this.ui, ...patch }; this.notify(); }
  toast(text: string, tone: "info" | "good" | "bad" = "info") { this.setUI({ toast: { text, tone, at: Date.now() } }); }

  async load() {
    this.loading = true; this.notify();
    const [mode, state] = await Promise.all([fetch("/api/mode").then(r => r.json()), fetch("/api/state").then(r => r.json() as Promise<ObsState>)]);
    this.mode = mode.mode;
    this.applyFull(state);
    this.loading = false;
    this.notify();
  }

  private applyFull(s: ObsState) {
    this.env = s.env; this.clock = s.clock; this.stats = s.stats; this.runs = s.engineRuns; this.game = s.game; this.truth = s.truth; this.network = s.network;
    this.members = new Map(s.members.map(m => [m.id, m]));
    this.edges = new Map(s.edges.map(e => [e.id, e]));
    this.opps = new Map(s.opportunities.map(o => [o.id, o]));
    this.feed = s.feed; this.version = s.version; this.pulses = [];
    const sel = this.ui.selection;
    if (sel && ((sel.kind === "member" && !this.members.has(sel.id)) || (sel.kind === "opportunity" && !this.opps.has(sel.id)))) this.ui = { ...this.ui, selection: null };
    this.ui = { ...this.ui, picks: this.ui.picks.filter(id => this.members.has(id)) };
    this.graphTick++;
  }

  private applyDelta(d: ObsDelta) {
    if (d.reset) { this.load(); return; }
    this.clock = d.clock;
    if (d.env) this.env = d.env;
    if (d.game) this.game = d.game;
    if (d.network) this.network = d.network;
    if (d.stats) this.stats = d.stats;
    if (d.engineRuns) this.runs = d.engineRuns;
    let graph = false;
    for (const m of d.members ?? []) { const prev = this.members.get(m.id); this.members.set(m.id, m); if (!prev || prev.joined !== m.joined || prev.state !== m.state) graph = true; }
    for (const e of d.edges ?? []) { if (!this.edges.has(e.id)) graph = true; this.edges.set(e.id, e); }
    for (const o of d.opportunities ?? []) this.opps.set(o.id, o);
    for (const id of d.removedOpportunities ?? []) this.opps.delete(id);
    if (d.feed?.length) {
      this.feed = [...this.feed, ...d.feed].slice(-400);
      this.pulses.push(...d.feed);
      if (this.pulses.length > 200) this.pulses = this.pulses.slice(-200);
    }
    if (graph) this.graphTick++;
    this.version = d.version;
    this.notify();
  }

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this.notify(); };
    ws.onclose = () => { this.connected = false; this.notify(); setTimeout(() => { this.connect(); this.load(); }, 1500); };
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "delta" && msg.mode === this.mode) this.applyDelta(msg.delta);
      else if (msg.type === "clock") { this.clock = msg.clock; this.notify(); }
      else if (msg.type === "mode") { if (msg.mode !== this.mode) { this.mode = msg.mode; this.ui = { ...this.ui, selection: null, picks: [] }; this.load(); } }
    };
  }

  async control(cmd: ControlCommand): Promise<ControlResult> {
    const r = await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cmd) }).then(r => r.json() as Promise<ControlResult>);
    if (!r.ok && r.error) this.toast(r.error, "bad");
    return r;
  }

  async setMode(mode: Mode) {
    const r = await fetch("/api/mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }).then(r => r.json());
    if (!r.ok) { this.toast(r.error ?? "could not switch mode", "bad"); return; }
    this.mode = mode;
    this.ui = { ...this.ui, selection: null, picks: [], drawer: mode === "real" && this.ui.drawer === "game" ? "feed" : this.ui.drawer };
    await this.load();
  }

  member(id: string) { return fetch(`/api/member/${encodeURIComponent(id)}`).then(r => (r.ok ? r.json() as Promise<MemberDetail> : undefined)); }
  opportunity(id: string) { return fetch(`/api/opportunity/${encodeURIComponent(id)}`).then(r => (r.ok ? r.json() as Promise<OpportunityDetail> : undefined)); }

  select(sel: Selection) { this.setUI({ selection: sel }); }
  togglePick(id: string) {
    const picks = this.ui.picks.includes(id) ? this.ui.picks.filter(x => x !== id) : [...this.ui.picks, id].slice(-6);
    this.setUI({ picks });
  }

  /** Members in an open (not yet resolved) opportunity: the Network won't double-book them. */
  busy(): Set<string> {
    const s = new Set<string>();
    for (const o of this.opps.values()) if (OPEN.has(o.state) && o.source !== "shadow") for (const id of o.participants) s.add(id);
    return s;
  }
}

export const OPEN = new Set(["PROPOSED", "INVITING", "PARTIALLY_ACCEPTED", "MUTUALLY_ACCEPTED", "QUORUM_MET", "SCHEDULED"]);
export const store = new ObsStore();

export function useStore(): ObsStore {
  useSyncExternalStore(store.subscribe, store.getTick);
  return store;
}
