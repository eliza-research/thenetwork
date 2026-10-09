// Client-side observatory state: full state from /api/state, then WebSocket deltas. The map and
// graph renderers read the maps directly (no React); React components subscribe via useStore().
// One focus model (member, opportunity or neighborhood; mirrored to location.hash) and one set of
// global filters (range, borough, members, origin, state group). Every panel filters through the
// predicates on ObsStore, never its own copy.
import { useSyncExternalStore } from "react";
import { NEIGHBORHOOD, type Borough } from "@thenetwork/network/geo"; // geo only: the package root pulls server code into the browser bundle
import type { ConsoleApp } from "../src/apps.ts";
import type {
  AppHealth, AppProfile360, AuditEntry, BiasReportView, ClockInfo, ConfigInfo, ControlCommand, ControlResult, EngineRunSummary, EnvInfo, GameState, LabRequest, LabRun, MemberDetail, MemberTimeline,
  MemberTruth, Mode, NetworkInfo, ObsDelta, ObsEdge, ObsFeedItem, ObsMember, ObsOpportunity, ObsRequest, ObsState, ObsStats, OpportunityDetail,
  MemberPhoto, PersonAppPanel, PersonSummary, RevealGrant, ReviewDecision, ReviewReason, RunDiff, SafetyAction, SafetyInfo, SearchHit, StaffRole, StaffUser,
} from "../src/types.ts";

/** The app ids, in switcher order (the server's list in /api/me replaces it). Kept here so the browser bundle does not pull server code. */
export const APP_ORDER = ["ntwrk", "slop", "peon", "friends"];
/** What the switcher shows: one app, "all" (health of every app) or the cross-app person view. */
export type Page = { kind: "app" } | { kind: "all" } | { kind: "person"; id: string };
export type Me = StaffUser & { realOnly?: boolean; apps?: string[]; crossApp?: boolean; appInfo?: ConsoleApp[] };

// ---------------------------------------------------------------- types
export type Focus = { kind: "member" | "opportunity" | "neighborhood"; id: string } | null;
export type ColorLens = "community" | "state" | "activity" | "truth";
export type RangeKey = "today" | "7d" | "30d" | "all";
export type MemberFilter = "all" | "active" | "watch" | "hold" | "minor" | "not_joined";
export type StateGroup = "review" | "open" | "met" | "closed";
export type DrawerTab = "review" | "feed" | "pipeline" | "requests" | "engine" | "safety" | "metrics" | "lab" | "config" | "game";
export const DRAWER_TABS: DrawerTab[] = ["review", "feed", "pipeline", "requests", "engine", "safety", "metrics", "lab", "config", "game"];
export interface Filters { range: RangeKey; borough: "all" | Borough; members: MemberFilter; origin: string; stateGroup: "all" | StateGroup }
export type FilterKey = keyof Filters;

/**
 * Fields the server sends that src/types.ts does not declare yet (that file belongs to the server
 * work). `wants` is the intent text each side of a queued proposal is based on; `judge` holds the
 * judge-derived safety counts. Both are optional: the UI works without them.
 */
export type Opp = ObsOpportunity & { wants?: Record<string, string> };
export interface JudgeCounts { invariants: number; canaryLeaks: number; minorContacts: number; byRule?: Record<string, number> }

export interface UIState {
  focus: Focus;
  picks: string[];
  filters: Filters;
  colorBy: ColorLens;
  edgeTypes: Record<string, boolean>;
  showOpps: boolean;
  legendOpen: boolean;
  drawer: DrawerTab;
  drawerOpen: boolean;
  /** Real NYC map (default) or the force-directed social graph. */
  view: "map" | "graph";
  /** Search box text (in the store so Esc can clear it). */
  query: string;
  /** The one open popover or menu ("help", "god"), closed first by Esc. */
  popover: string | null;
  reviewView: "pending" | "decided";
  toast?: { text: string; tone: "info" | "good" | "bad"; at: number };
}

export const EDGE_TYPES = ["knows", "invited_by", "vouched_for", "introduced", "met", "enjoyed", "would_interact_again", "avoid", "blocked"] as const;
export const BOROUGHS: Borough[] = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];
export const RANGES: [RangeKey, string][] = [["today", "Today"], ["7d", "7d"], ["30d", "30d"], ["all", "All"]];
export const MEMBER_FILTERS: [MemberFilter, string][] = [["all", "All"], ["active", "Active"], ["watch", "Watch"], ["hold", "Hold"], ["minor", "Under 18"], ["not_joined", "Not joined"]];
/** Origin labels. Mirrors ORIGIN_LABEL in src/projector.ts until src/types.ts exports one shared map. */
export const ORIGIN_LABEL: Record<string, string> = {
  engine: "Engine", request: "Request", plans: "Plans buddy", second_encounter: "Second encounter", newcomer_welcome: "Newcomer welcome",
  player: "Player", shadow: "Shadow", network: "Network", scenario: "Scenario",
};
export const originLabel = (k: string) => ORIGIN_LABEL[k] ?? k.replace(/_/g, " ");
/** PRD 32.8 review reason codes, in PRD order (keys 1-8 in the review queue). */
export const REVIEW_REASONS: [ReviewReason, string][] = [
  ["weak_reason", "Weak reason"], ["privacy_risk", "Privacy risk"], ["capacity_concern", "Capacity concern"], ["wrong_timing", "Wrong timing"],
  ["safety", "Safety"], ["tone", "Tone"], ["duplicate", "Duplicate"], ["other", "Other"],
];
/** Pipeline columns; the state filter groups are built from them. */
export const COLUMNS: { id: string; title: string; states: string[] }[] = [
  { id: "review", title: "Review", states: ["DRAFT", "PROPOSED", "IN_REVIEW", "APPROVED"] },
  { id: "checking", title: "Checking", states: ["INVITING", "PARTIALLY_ACCEPTED", "NEEDS_REPLACEMENT"] },
  { id: "accepted", title: "Accepted", states: ["MUTUALLY_ACCEPTED", "QUORUM_MET", "SCHEDULING"] },
  { id: "scheduled", title: "Scheduled", states: ["SCHEDULED", "RESCHEDULE_REQUESTED", "IN_PROGRESS"] },
  { id: "met", title: "Met", states: ["COMPLETED", "FEEDBACK_COLLECTED"] },
  { id: "closed", title: "Closed", states: ["REJECTED_IN_REVIEW", "DECLINED", "EXPIRED", "CANCELLED", "SKIPPED", "ABANDONED", "QUORUM_FAILED", "SAFETY_HOLD", "DISPUTED"] },
];
export const STATE_GROUPS: [StateGroup, string, string[]][] = [
  ["review", "In review", COLUMNS[0]!.states],
  ["open", "Open", [...COLUMNS[1]!.states, ...COLUMNS[2]!.states, ...COLUMNS[3]!.states]],
  ["met", "Met", COLUMNS[4]!.states],
  ["closed", "Closed", COLUMNS[5]!.states],
];
const GROUP_OF = new Map<string, StateGroup>(STATE_GROUPS.flatMap(([g, , sts]) => sts.map(s => [s, g] as [string, StateGroup])));
export const stateGroupOf = (state: string): StateGroup => GROUP_OF.get(state) ?? "open";
/** Open (not yet resolved) states. A member in one is busy: the Network does not double-book them. */
export const OPEN = new Set(["PROPOSED", "IN_REVIEW", "INVITING", "PARTIALLY_ACCEPTED", "MUTUALLY_ACCEPTED", "QUORUM_MET", "SCHEDULED"]);
import { DAY, HOUR } from "../../core/src/clock.ts";
export { DAY, HOUR };
export const DEFAULT_FILTERS: Filters = { range: "7d", borough: "all", members: "all", origin: "all", stateGroup: "all" };

// ---------------------------------------------------------------- small helpers
const NYC_TZ = "America/New_York";
const hms = new Intl.DateTimeFormat("en-US", { timeZone: NYC_TZ, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
/** Start of the NYC calendar day that contains t. */
export function nycDayStart(t: number): number {
  const p = Object.fromEntries(hms.formatToParts(t).map(x => [x.type, x.value]));
  return t - ((Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 - (t % 1000);
}
export const sameFocus = (a: Focus, b: Focus) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
export const focusKey = (f: Focus) => (f ? `${f.kind}:${f.id}` : "");
export const isMemberActive = (m: ObsMember) => m.joined && m.state !== "opted_out" && m.state !== "paused" && m.state !== "not_joined";
/** Where an opportunity came from: shadow and player first, then the consent network's origin, then the source. */
export const originOf = (o: ObsOpportunity) => (o.source === "shadow" || o.source === "player" ? o.source : o.origin ?? o.source);

function readJSON<T>(key: string): Partial<T> | undefined {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as Partial<T> : undefined; } catch { return undefined; }
}
function writeJSON(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: keep defaults */ } }
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? v as T : d);

function loadFilters(mode: Mode): Filters {
  const f = readJSON<Filters>(`obs.filters.v1.${mode}`) ?? {};
  return {
    range: pick(f.range, RANGES.map(r => r[0]), DEFAULT_FILTERS.range),
    borough: pick(f.borough, ["all", ...BOROUGHS] as const, "all"),
    members: pick(f.members, MEMBER_FILTERS.map(r => r[0]), "all"),
    origin: typeof f.origin === "string" ? f.origin : "all",
    stateGroup: pick(f.stateGroup, ["all", "review", "open", "met", "closed"] as const, "all"),
  };
}
const UI_KEYS = ["view", "drawer", "drawerOpen", "colorBy", "edgeTypes", "showOpps", "legendOpen"] as const;
function loadUIPrefs(): Partial<UIState> {
  const u = readJSON<UIState>("obs.ui.v1") ?? {};
  const out: Partial<UIState> = {};
  if (u.view === "map" || u.view === "graph") out.view = u.view;
  if (typeof u.drawer === "string" && DRAWER_TABS.includes(u.drawer)) out.drawer = u.drawer;
  if (typeof u.drawerOpen === "boolean") out.drawerOpen = u.drawerOpen;
  if (u.colorBy && ["community", "state", "activity"].includes(u.colorBy)) out.colorBy = u.colorBy;
  if (u.edgeTypes && typeof u.edgeTypes === "object") out.edgeTypes = u.edgeTypes as Record<string, boolean>;
  if (typeof u.showOpps === "boolean") out.showOpps = u.showOpps;
  if (typeof u.legendOpen === "boolean") out.legendOpen = u.legendOpen;
  return out;
}

/** The URL hash: "#a=slop&m=<member>" (app, then the focus), "#a=all", or "#p=<person>" (cross-app view). */
function hashParams() { try { return new URLSearchParams(location.hash.slice(1)); } catch { return new URLSearchParams(); } }
function parseHash(): Focus {
  const h = hashParams();
  const m = h.get("m"), o = h.get("o"), n = h.get("n");
  return m ? { kind: "member", id: m } : o ? { kind: "opportunity", id: o } : n ? { kind: "neighborhood", id: n } : null;
}
function parseApp(): string {
  const a = hashParams().get("a");
  return a && APP_ORDER.includes(a) ? a : "ntwrk";
}
function parsePage(): Page {
  const h = hashParams(), p = h.get("p");
  return p ? { kind: "person", id: p } : h.get("a") === "all" ? { kind: "all" } : { kind: "app" };
}
/** The hash for an app and a focus (ntwrk with no focus is the empty hash). */
function hashOf(f: Focus, app: string): string {
  const parts = app !== "ntwrk" ? [`a=${encodeURIComponent(app)}`] : [];
  if (f) parts.push(`${f.kind === "member" ? "m" : f.kind === "opportunity" ? "o" : "n"}=${encodeURIComponent(f.id)}`);
  return parts.length ? `#${parts.join("&")}` : "";
}

// ---------------------------------------------------------------- auth
const TOKEN_KEY = "obs.token";
class AuthError extends Error {}
/** A detail fetch: the data, or the HTTP status and error (403 = this role cannot open it). */
export type Fetched<T> = { data: T; status: 200; error?: undefined } | { data?: undefined; status: number; error: string };
/** Review edits and re-rolls (PRD 32.8). */
export interface DecideOpts { reason?: ReviewReason; note?: string; explanations?: Record<string, string>; objective?: string; swapOut?: string }
/** Time on one review item counts at most this long (a card left open is not review work). */
const REVIEW_SECONDS_CAP = 30 * 60;
/** Review codes for an action that was refused before anything was recorded (the item still waits). */
const REFUSED = new Set(["in_flight", "not_in_review", "note_required", "participant_minor", "participant_declined", "matching_paused", "nothing_to_edit", "not_a_participant", "edit_leak", "cannot_swap", "unknown_decision", "unknown_reason", "forbidden", ""]);
/**
 * Reads #token= once (the server prints the page URL with the token in the fragment, which the browser
 * never sends to a server or in a Referer), then removes it from the address bar and the history entry;
 * else the token kept for this tab. A ?token= in an old link is removed the same way.
 */
function initialToken(): string {
  let t: string | null = null;
  try {
    const u = new URL(location.href);
    const h = new URLSearchParams(u.hash.slice(1));
    t = h.get("token") ?? u.searchParams.get("token");
    if (t) {
      try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* keep it in memory only */ }
      u.searchParams.delete("token"); h.delete("token");
      const rest = h.toString();
      history.replaceState(history.state, "", u.pathname + u.search + (rest ? `#${rest}` : ""));
    }
  } catch { /* no URL access */ }
  if (!t) { try { t = sessionStorage.getItem(TOKEN_KEY); } catch { t = null; } }
  return t ?? "";
}

// ---------------------------------------------------------------- store
class ObsStore {
  mode: Mode = "game";
  /** The app every panel shows (the switcher; ?app= on every request). */
  app: string = parseApp();
  /** One app, every app's health, or the cross-app person view. */
  page: Page = parsePage();
  env?: EnvInfo;
  clock?: ClockInfo;
  members = new Map<string, ObsMember>();
  edges = new Map<string, ObsEdge>();
  opps = new Map<string, Opp>();
  feed: ObsFeedItem[] = [];
  stats?: ObsStats;
  runs: EngineRunSummary[] = [];
  game?: GameState;
  truth?: Record<string, MemberTruth>;
  network?: NetworkInfo;
  requests: ObsRequest[] = [];
  /** The signed-in staff member (GET /api/me). Undefined until it answers. */
  me?: Me;
  /** This viewer's active PII reveals (wall-clock expiry). */
  reveals: RevealGrant[] = [];
  /** When each review card was opened (wall clock): the decision sends the seconds since. */
  private reviewOpened = new Map<string, number>();
  version = 0;
  connected = false;
  loading = true;
  /** The API answered 401: the UI shows the token prompt. */
  authNeeded = false;
  private token = initialToken();
  private filtersMode: Mode | null = null;
  /**
   * Deltas that arrive while a full state is loading. A delta generated after the state was read must
   * not be lost under it (an item would stay "in review" here after the server moved it on); those at
   * or after the state's version are applied once it lands.
   */
  private loadingState = false;
  private buffered: ObsDelta[] = [];
  /** Review decisions sent and not answered yet, by opportunity (a second press is not sent). */
  private deciding = new Set<string>();
  focusHistory: Focus[] = [];
  ui: UIState = {
    focus: parseHash(), picks: [], filters: { ...DEFAULT_FILTERS }, colorBy: "community",
    edgeTypes: Object.fromEntries(EDGE_TYPES.map(t => [t, t !== "invited_by" && t !== "vouched_for"])), showOpps: true, legendOpen: false,
    drawer: "feed", drawerOpen: true, view: "map", query: "", popover: null, reviewView: "pending",
    ...loadUIPrefs(),
  };
  /** Bumped on every change; React re-renders off it. */
  tick = 0;
  /** Bumped when the graph's nodes or edges changed (layout must update). */
  graphTick = 0;
  /** Recent feed items for graph pulses (consumed by the renderer). */
  pulses: ObsFeedItem[] = [];
  private listeners = new Set<() => void>();
  private ws?: WebSocket;
  private wsGen = 0;
  private notifyQueued = false;

  constructor() {
    if (typeof window !== "undefined") window.addEventListener("popstate", () => this.onPopState());
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getTick = () => this.tick;
  notify() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    // A short timer, not requestAnimationFrame: rAF pauses in hidden or throttled tabs, which would
    // freeze the UI's state (clicks included) until the tab is painted again.
    setTimeout(() => { this.notifyQueued = false; this.tick++; for (const l of this.listeners) l(); }, 30);
  }

  setUI(patch: Partial<UIState>) {
    this.ui = { ...this.ui, ...patch };
    if (UI_KEYS.some(k => k in patch)) writeJSON("obs.ui.v1", Object.fromEntries(UI_KEYS.map(k => [k, this.ui[k]])));
    this.notify();
  }
  setFilters(patch: Partial<Filters>) {
    this.setUI({ filters: { ...this.ui.filters, ...patch } });
    writeJSON(`obs.filters.v1.${this.mode}`, this.ui.filters);
  }
  resetFilters() { this.setFilters({ ...DEFAULT_FILTERS }); }
  filtersChanged() { const f = this.ui.filters; return (Object.keys(DEFAULT_FILTERS) as FilterKey[]).some(k => f[k] !== DEFAULT_FILTERS[k]); }
  toast(text: string, tone: "info" | "good" | "bad" = "info") { this.setUI({ toast: { text, tone, at: Date.now() } }); }

  // -------------------------------------------------------------- transport
  /** Every request names the app (the server checks the role for it). */
  private withApp(path: string) { return /[?&]app=/.test(path) ? path : `${path}${path.includes("?") ? "&" : "?"}app=${encodeURIComponent(this.app)}`; }
  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    // The mode this page shows: the server refuses a change meant for the other mode (409 mode_changed).
    headers.set("x-observatory-mode", this.mode);
    const r = await fetch(this.withApp(path), { ...init, headers });
    if (r.status === 401) {
      if (!this.authNeeded) { this.authNeeded = true; this.notify(); }
      throw new AuthError("token required");
    }
    return r;
  }
  getJSON<T>(path: string): Promise<T> { return this.api(path).then(r => r.json() as Promise<T>); }
  /** GET or POST that keeps the status: a 403 is shown as "your role cannot…", not as a crash. */
  async fetch<T>(path: string, body?: unknown): Promise<Fetched<T>> {
    try {
      const r = await this.api(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({})) as T & { error?: string };
      if (r.ok) return { data: j, status: 200 };
      return { status: r.status, error: j.error ?? `HTTP ${r.status}` };
    } catch (e) {
      return { status: e instanceof AuthError ? 401 : 0, error: (e as Error).message };
    }
  }

  setToken(t: string) {
    this.token = t.trim();
    try { sessionStorage.setItem(TOKEN_KEY, this.token); } catch { /* memory only */ }
    this.authNeeded = false;
    this.notify();
    this.connect();
    this.load();
  }

  async load() {
    this.loading = true; this.notify();
    this.loadingState = true; this.buffered = [];
    try {
      const [mode, me] = await Promise.all([this.getJSON<{ mode: Mode }>("/api/mode"), this.fetch<Me>("/api/me")]);
      // An older server has no /api/me: it has one admin token.
      this.me = me.data ?? { id: "token", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" };
      this.mode = mode.mode;
      // No role for this app: the first app this person holds one for. None (cross_app_safety only): the person view.
      const apps = this.me.apps ?? APP_ORDER;
      if (!apps.includes(this.app)) {
        if (apps[0]) { this.app = apps[0]; this.replaceHash(); this.connect(); }
        else { this.loading = false; this.notify(); return; }
      }
      const state = await this.getJSON<ObsState>("/api/state");
      this.loadReveals();
      if (this.filtersMode !== this.mode) { this.filtersMode = this.mode; this.ui = { ...this.ui, filters: loadFilters(this.mode) }; }
      this.applyFull(state);
      const later = this.buffered.filter(d => d.version >= state.version);
      this.loadingState = false;
      for (const d of later) this.applyDelta(d);
    } catch (e) {
      if (!(e instanceof AuthError)) this.toast(`Could not load: ${(e as Error).message}`, "bad");
    }
    this.loadingState = false; this.buffered = [];
    this.loading = false;
    this.notify();
  }

  private applyFull(s: ObsState) {
    this.env = s.env; this.clock = s.clock; this.stats = s.stats; this.runs = s.engineRuns; this.game = s.game; this.truth = s.truth; this.network = s.network;
    this.requests = s.requests ?? [];
    this.members = new Map(s.members.map(m => [m.id, m]));
    this.edges = new Map(s.edges.map(e => [e.id, e]));
    this.opps = new Map(s.opportunities.map(o => [o.id, o]));
    this.feed = s.feed; this.version = s.version; this.pulses = [];
    if (!this.focusExists(this.ui.focus)) { this.ui = { ...this.ui, focus: null }; this.focusHistory = []; }
    this.focusHistory = this.focusHistory.filter(f => this.focusExists(f));
    this.ui = { ...this.ui, picks: this.ui.picks.filter(id => this.members.has(id)) };
    this.graphTick++;
  }

  private focusExists(f: Focus) {
    if (!f) return true;
    if (f.kind === "member") return this.members.has(f.id);
    if (f.kind === "opportunity") return this.opps.has(f.id);
    return NEIGHBORHOOD.has(f.id) || [...this.members.values()].some(m => m.area === f.id);
  }

  private applyDelta(d: ObsDelta) {
    if (this.loadingState && !d.reset) { this.buffered.push(d); return; }
    if (d.reset) { this.load(); return; }
    // A version was skipped (a delta was dropped or arrived under a full load): read the full state again.
    if (d.version > this.version + 1) { this.load(); return; }
    this.clock = d.clock;
    if (d.env) this.env = d.env;
    if (d.game) this.game = d.game;
    if (d.network) this.network = d.network;
    if (d.stats) this.stats = d.stats;
    if (d.engineRuns) this.runs = d.engineRuns;
    if (d.requests) this.requests = d.requests;
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

  /**
   * Open the live socket. A browser WebSocket cannot send the token header, so the page first asks for
   * a one-use ticket (POST /api/ws-ticket, 30 s) and opens /ws?ticket=. The token never goes in a URL.
   */
  async connect() {
    const gen = ++this.wsGen;
    this.ws?.close();
    const t = await this.fetch<{ ticket: string }>("/api/ws-ticket", {});
    if (gen !== this.wsGen) return;
    if (!t.data) {
      if (t.status !== 401 && t.status !== 403) setTimeout(() => { if (gen === this.wsGen && !this.authNeeded) this.connect(); }, 3000);
      return;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?app=${encodeURIComponent(this.app)}&ticket=${encodeURIComponent(t.data.ticket)}`);
    this.ws = ws;
    ws.onopen = () => { if (gen === this.wsGen) { this.connected = true; this.notify(); } };
    ws.onclose = ev => {
      if (gen !== this.wsGen) return;
      this.connected = false; this.notify();
      // 4401: the sign-in ended; 4403: no role for this app any more. Load again (it shows why) instead of reconnecting in a loop.
      if (ev.code === 4401 || ev.code === 4403) { this.toast(ev.code === 4401 ? "Signed out: sign in again" : `No role for ${this.app} any more`, "bad"); this.load(); return; }
      setTimeout(() => { if (gen === this.wsGen && !this.authNeeded) { this.connect(); this.load(); } }, 1500);
    };
    ws.onmessage = ev => {
      if (gen !== this.wsGen) return;
      const msg = JSON.parse(ev.data);
      if (msg.app !== undefined && msg.app !== this.app) return;
      if (msg.type === "delta" && msg.mode === this.mode) this.applyDelta(msg.delta);
      else if (msg.type === "clock") { this.clock = msg.clock; this.notify(); }
      else if (msg.type === "mode") { if (msg.mode !== this.mode) { this.mode = msg.mode; this.ui = { ...this.ui, picks: [] }; this.clearFocus(); this.load(); } }
    };
  }

  async control(cmd: ControlCommand, opts: { quiet?: boolean } = {}): Promise<ControlResult> {
    let r: ControlResult;
    try {
      r = await this.api("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cmd) }).then(x => x.json() as Promise<ControlResult>);
    } catch (e) {
      r = { ok: false, error: e instanceof AuthError ? "Token required" : (e as Error).message };
    }
    if (!r.ok && r.error && !opts.quiet) this.toast(r.error, "bad");
    return r;
  }

  async setMode(mode: Mode) {
    let r: { ok: boolean; error?: string };
    try {
      r = await this.api("/api/mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }).then(x => x.json());
    } catch (e) { r = { ok: false, error: (e as Error).message }; }
    if (!r.ok) { this.toast(r.error ?? "could not switch mode", "bad"); return; }
    this.mode = mode;
    this.ui = { ...this.ui, picks: [], drawer: mode === "real" && this.ui.drawer === "game" ? "feed" : this.ui.drawer };
    this.clearFocus();
    await this.load();
  }

  member(id: string) { return this.fetch<MemberDetail>(`/api/member/${encodeURIComponent(id)}`); }
  timeline(id: string) { return this.fetch<MemberTimeline>(`/api/member/${encodeURIComponent(id)}/timeline`); }
  /** The app's own Member 360 panel (slop dating preferences behind a reveal; peon roles and applications). */
  memberApp(id: string) { return this.fetch<AppProfile360>(`/api/member/${encodeURIComponent(id)}/app`); }
  /** slop photos: admin or safety, a typed reason, verified adults only. */
  photos(id: string, reason: string) { return this.fetch<{ ok: boolean; photos?: MemberPhoto[]; error?: string }>(`/api/member/${encodeURIComponent(id)}/photos`, { reason }); }
  opportunity(id: string) { return this.fetch<OpportunityDetail>(`/api/opportunity/${encodeURIComponent(id)}`); }
  safety() { return this.fetch<SafetyInfo>("/api/safety"); }
  safetyAction(a: SafetyAction) { return this.fetch<ControlResult>("/api/safety", a); }
  config() { return this.fetch<ConfigInfo>("/api/config"); }
  /** The cost panel (real mode; analyst or admin): src/ops.ts. */
  cost() { return this.fetch<import("../src/ops.ts").CostSummary & { ok: boolean }>("/api/ops/cost"); }
  /** The weekly bias monitor reports (real mode; admin or analyst). */
  bias() { return this.fetch<{ ok: boolean; reports?: BiasReportView[]; error?: string }>("/api/bias"); }
  audit(q: { limit?: number; actor?: string; targetId?: string } = {}) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return this.fetch<{ sink: string; entries: AuditEntry[] }>(`/api/audit?${p}`);
  }
  search(q: string) { return this.fetch<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`); }
  runDiff(a: string, b: string) { return this.fetch<RunDiff>(`/api/runs/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`); }
  lab() { return this.fetch<{ enabled: boolean; running: number; runs: LabRun[] }>("/api/lab"); }
  appsHealth() { return this.fetch<{ mode: Mode; apps: AppHealth[] }>("/api/apps/health"); }
  findPerson(memberId: string, app = this.app) { return this.fetch<{ personId: string }>(`/api/person/lookup?app=${encodeURIComponent(app)}&member=${encodeURIComponent(memberId)}`); }
  person(id: string) { return this.fetch<PersonSummary>(`/api/person/${encodeURIComponent(id)}`); }
  openPersonApp(id: string, app: string, reason: string) { return this.fetch<PersonAppPanel>(`/api/person/${encodeURIComponent(id)}/open`, { app, reason }); }

  // -------------------------------------------------------------- apps
  /** Apps this person may open, in switcher order, with their names. */
  apps(): ConsoleApp[] {
    const info = this.me?.appInfo ?? [];
    const mine = this.me?.apps ?? APP_ORDER;
    return info.filter(a => mine.includes(a.id));
  }
  appInfo(app = this.app): ConsoleApp | undefined { return this.me?.appInfo?.find(a => a.id === app); }
  /** Review reason codes for the current app (keys 1-8), from the server's list. */
  reasons(): [string, string][] {
    const r = this.appInfo()?.reasons;
    return r?.length ? r.map(x => [x.code, x.label]) : REVIEW_REASONS;
  }
  /** Switch the app: every panel reloads for it. "all": the health of every app. */
  setApp(app: string) {
    if (app === "all") { this.page = { kind: "all" }; this.replaceHash(); this.notify(); return; }
    const changed = app !== this.app;
    this.page = { kind: "app" };
    this.app = app;
    if (changed) {
      this.ui = { ...this.ui, picks: [], focus: null };
      this.focusHistory = [];
      this.opps = new Map(); this.members = new Map(); this.edges = new Map(); this.feed = []; this.version = 0;
      this.connect();
      this.load();
    }
    this.replaceHash();
    this.notify();
  }
  /** The cross-app person view (cross_app_safety or admin; the server checks). */
  openPerson(id: string) { this.page = { kind: "person", id }; this.replaceHash(); this.notify(); }
  closePage() { this.page = { kind: "app" }; this.replaceHash(); this.notify(); }
  private replaceHash() {
    const h = this.page.kind === "person" ? `#p=${encodeURIComponent(this.page.id)}` : this.page.kind === "all" ? "#a=all" : hashOf(this.ui.focus, this.app);
    try { history.replaceState(history.state, "", location.pathname + location.search + h); } catch { /* ignore */ }
  }
  labRun(req: LabRequest) { return this.fetch<{ ok: boolean; run: LabRun }>("/api/lab/run", req); }

  // -------------------------------------------------------------- roles and PII reveal
  /** The caller holds one of these roles; admin passes every check (server rule). False until /api/me answers. */
  can(...roles: StaffRole[]): boolean {
    const g = this.me?.grants?.filter(x => (x.app === "*" || x.app === this.app) && x.role !== "cross_app_safety" && !(x.role === "engineer" && this.mode === "real")).map(x => x.role) ?? this.me?.roles;
    return !!g && (g.includes("admin") || roles.some(x => g.includes(x)));
  }
  /** The roles held for the current app (the top bar). */
  rolesHere(): string[] {
    return [...new Set(this.me?.grants?.filter(x => x.app === "*" || x.app === this.app).map(x => x.role) ?? this.me?.roles ?? [])];
  }
  isAdmin() { return this.can(); }
  /** Game controls (play, step, propose, take over, god): the simulation lab is for reviewers and safety staff. */
  canSim() { return this.can("reviewer", "safety", "engineer"); }
  realOnly() { return !!(this.me?.realOnly || this.env?.realOnly); }
  async loadReveals() {
    const r = await this.fetch<RevealGrant[]>("/api/reveal");
    this.reveals = r.data ?? [];
    this.notify();
  }
  revealFor(memberId: string): RevealGrant | undefined { return this.reveals.find(g => g.memberId === memberId && g.until > Date.now()); }
  /** End a reveal before its time (audited). */
  async unreveal(memberId: string): Promise<void> {
    try { await this.api(`/api/reveal?memberId=${encodeURIComponent(memberId)}`, { method: "DELETE" }); } catch { /* the 401 prompt shows */ }
    this.reveals = this.reveals.filter(g => g.memberId !== memberId);
    this.notify();
  }
  async reveal(memberId: string, reason: string, minutes: number): Promise<boolean> {
    const r = await this.fetch<RevealGrant & { ok: boolean }>("/api/reveal", { memberId, reason, minutes });
    if (!r.data) { this.toast(r.error, "bad"); return false; }
    this.reveals = [...this.reveals.filter(g => g.memberId !== memberId), r.data];
    this.toast(`Revealed for ${minutes} min · logged`, "info");
    return true;
  }

  // -------------------------------------------------------------- focus
  /** Enter a focus. The previous one goes on the history (max 20); the URL hash follows. */
  focus(f: Focus, opts: { replace?: boolean } = {}) {
    if (!f) { this.clearFocus(); return; }
    const cur = this.ui.focus;
    if (sameFocus(cur, f)) return;
    if (opts.replace) {
      // Stepping through a list (review j/k): move the focus without growing the history.
      this.setUI({ focus: f });
      try { history.replaceState(history.state, "", location.pathname + location.search + hashOf(f, this.app)); } catch { /* ignore */ }
      return;
    }
    if (cur) this.focusHistory = [...this.focusHistory, cur].slice(-20);
    this.setUI({ focus: f });
    this.pushHash(f);
  }
  /** Return to the previous focus. Uses the browser history when this page pushed the entry. */
  back() {
    if (!this.focusHistory.length) return;
    if (((history.state as { obsDepth?: number } | null)?.obsDepth ?? 0) > 0) { history.back(); return; }
    const prev = this.focusHistory[this.focusHistory.length - 1]!;
    this.focusHistory = this.focusHistory.slice(0, -1);
    this.setUI({ focus: prev });
    try { history.replaceState({ obsDepth: 0 }, "", location.pathname + location.search + hashOf(prev, this.app)); } catch { /* ignore */ }
  }
  clearFocus() {
    const had = !!this.ui.focus;
    this.focusHistory = [];
    this.setUI({ focus: null });
    if (had) this.pushHash(null);
  }
  private pushHash(f: Focus) {
    try {
      const depth = ((history.state as { obsDepth?: number } | null)?.obsDepth ?? 0) + 1;
      history.pushState({ obsDepth: depth }, "", location.pathname + location.search + hashOf(f, this.app));
    } catch { /* ignore */ }
  }
  private onPopState() {
    const page = parsePage(), app = parseApp();
    if (page.kind !== this.page.kind || (page.kind === "person" && this.page.kind === "person" && page.id !== this.page.id)) { this.page = page; this.notify(); }
    if (page.kind === "app" && app !== this.app) { this.setApp(app); return; }
    const f = parseHash();
    if (sameFocus(f, this.ui.focus)) return;
    const top = this.focusHistory[this.focusHistory.length - 1];
    if (top !== undefined && sameFocus(top, f)) this.focusHistory = this.focusHistory.slice(0, -1);
    else if (this.ui.focus && f) this.focusHistory = [...this.focusHistory, this.ui.focus].slice(-20);
    if (!f) this.focusHistory = [];
    this.setUI({ focus: this.focusExists(f) ? f : null });
  }

  /** The live map or graph (set by the stage while mounted). */
  stage: { focus(id: string): void; flyTo?(lat: number, lng: number): void } | null = null;
  /** A map fly-to waiting for the map to mount (venue links clicked in graph view). */
  pendingFly: { lat: number; lng: number } | null = null;
  flyTo(lat: number, lng: number) {
    if (this.ui.view === "map" && this.stage?.flyTo) { this.stage.flyTo(lat, lng); return; }
    this.pendingFly = { lat, lng };
    this.setUI({ view: "map" });
  }

  togglePick(id: string) {
    const picks = this.ui.picks.includes(id) ? this.ui.picks.filter(x => x !== id) : [...this.ui.picks, id].slice(-6);
    this.setUI({ picks });
  }

  // -------------------------------------------------------------- derived sets (cached per tick)
  private cache = new Map<string, unknown>();
  private cached<T>(name: string, key: string, f: () => T): T {
    const k = `${name}|${this.tick}|${this.version}|${key}`;
    const hit = this.cache.get(name) as { k: string; v: T } | undefined;
    if (hit && hit.k === k) return hit.v;
    const v = f();
    this.cache.set(name, { k, v });
    return v;
  }

  /** Members in an open (not yet resolved) opportunity: the Network won't double-book them. */
  busy(): Set<string> {
    return this.cached("busy", "", () => {
      const s = new Set<string>();
      for (const o of this.opps.values()) if (OPEN.has(o.state) && o.source !== "shadow") for (const id of o.participants) s.add(id);
      return s;
    });
  }

  /** Member ids to keep at full opacity on the map and graph; null when nothing is focused or picked. */
  focusSet(): Set<string> | null {
    const f = this.ui.focus, picks = this.ui.picks;
    return this.cached("focusSet", `${focusKey(f)}|${picks.join(",")}|${this.graphTick}`, () => {
      if (!f && !picks.length) return null;
      const s = new Set<string>(picks);
      if (f?.kind === "member") {
        s.add(f.id);
        for (const e of this.edges.values()) { if (e.from === f.id) s.add(e.to); else if (e.to === f.id) s.add(e.from); }
        for (const o of this.opps.values()) if (OPEN.has(o.state) && o.participants.includes(f.id)) for (const id of o.participants) s.add(id);
      } else if (f?.kind === "opportunity") {
        const o = this.opps.get(f.id);
        for (const id of [...(o?.participants ?? []), ...(o?.alternates ?? [])]) s.add(id);
      } else if (f?.kind === "neighborhood") {
        for (const m of this.members.values()) if (m.area === f.id) s.add(m.id);
      }
      return s;
    });
  }

  // -------------------------------------------------------------- filter predicates
  now() { return this.clock?.now ?? 0; }
  borough(area?: string): Borough | undefined { return area ? NEIGHBORHOOD.get(area)?.borough : undefined; }
  rangeStart(): number {
    const now = this.now(), r = this.ui.filters.range;
    return r === "today" ? nycDayStart(now) : r === "7d" ? now - 7 * DAY : r === "30d" ? now - 30 * DAY : -Infinity;
  }
  inRange(t: number) { return t >= this.rangeStart(); }
  rangeLabel() { return RANGES.find(r => r[0] === this.ui.filters.range)?.[1] ?? ""; }
  inBorough(m: ObsMember) { const b = this.ui.filters.borough; return b === "all" || this.borough(m.area) === b; }
  matchMemberFilter(m: ObsMember) {
    switch (this.ui.filters.members) {
      case "active": return isMemberActive(m);
      case "watch": return m.trust === "watch";
      case "hold": return m.trust === "hold";
      case "minor": return m.minor;
      case "not_joined": return !m.joined;
      default: return true;
    }
  }
  matchMember(m: ObsMember) { return this.inBorough(m) && this.matchMemberFilter(m); }
  /** Global filters on an opportunity. `skip` turns off the filters that do not apply to a panel. */
  matchOpp(o: ObsOpportunity, skip: Partial<Record<FilterKey, boolean>> = {}) {
    const f = this.ui.filters;
    if (!skip.range && f.range !== "all" && !OPEN.has(o.state) && !this.inRange(o.updatedAt)) return false;
    if (!skip.origin && f.origin !== "all" && originOf(o) !== f.origin) return false;
    if (!skip.stateGroup && f.stateGroup !== "all" && stateGroupOf(o.state) !== f.stateGroup) return false;
    if ((!skip.borough && f.borough !== "all") || (!skip.members && f.members !== "all")) {
      const ms = o.participants.map(id => this.members.get(id)).filter((m): m is ObsMember => !!m);
      if (!skip.borough && f.borough !== "all" && !ms.some(m => this.inBorough(m))) return false;
      if (!skip.members && f.members !== "all" && !ms.some(m => this.matchMemberFilter(m))) return false;
    }
    return true;
  }
  matchFeed(x: ObsFeedItem) {
    const f = this.ui.filters;
    if (!this.inRange(x.t)) return false;
    if (f.borough !== "all" || f.members !== "all") {
      const ms = (x.members ?? []).map(id => this.members.get(id)).filter((m): m is ObsMember => !!m);
      if (f.borough !== "all" && !ms.some(m => this.inBorough(m))) return false;
      if (f.members !== "all" && !ms.some(m => this.matchMemberFilter(m))) return false;
    }
    if (f.origin !== "all") {
      const o = x.opportunityId ? this.opps.get(x.opportunityId) : undefined;
      if (!o || originOf(o) !== f.origin) return false;
    }
    return true;
  }

  // -------------------------------------------------------------- focus predicates
  focusOpp(o: ObsOpportunity) {
    const f = this.ui.focus;
    if (!f) return true;
    if (f.kind === "member") return o.participants.includes(f.id);
    if (f.kind === "opportunity") return o.id === f.id;
    return o.participants.some(id => this.members.get(id)?.area === f.id);
  }
  focusFeed(x: ObsFeedItem) {
    const f = this.ui.focus;
    if (!f) return true;
    if (f.kind === "member") return !!x.members?.includes(f.id);
    if (f.kind === "opportunity") return x.opportunityId === f.id;
    return !!x.members?.some(id => this.members.get(id)?.area === f.id);
  }
  focusRun(r: EngineRunSummary) {
    const f = this.ui.focus;
    if (!f || f.kind === "neighborhood") return true;
    if (f.kind === "opportunity") return this.opps.get(f.id)?.runId === r.id;
    return r.proposalIds.some(id => this.opps.get(id)?.participants.includes(f.id)) || r.top.some(t => t.participants.includes(f.id));
  }
  /** A short name for the current focus ("Maya", "Maya + Jon", "Astoria") for empty states. */
  focusName(): string {
    const f = this.ui.focus;
    if (!f) return "";
    if (f.kind === "member") return this.firstName(f.id);
    if (f.kind === "opportunity") { const o = this.opps.get(f.id); return o ? this.oppTitle(o) : f.id; }
    return f.id;
  }
  /** Empty-state line: "Nothing for Maya in 7d". */
  nothing(): string {
    const who = this.focusName(), r = this.ui.filters.range;
    return `Nothing${who ? ` for ${who}` : ""}${r === "all" ? "" : r === "today" ? " today" : ` in ${r}`}`;
  }

  // -------------------------------------------------------------- names
  name(id: string) { return this.members.get(id)?.name ?? id; }
  firstName(id: string) { return this.members.get(id)?.name.split(" ")[0] ?? id; }
  /** "Maya + Jon" for a pair, "Maya, Jon +2" for a group. */
  oppTitle(o: ObsOpportunity) {
    const n = o.participants.map(id => this.firstName(id));
    return n.length <= 2 ? n.join(" + ") : `${n.slice(0, 2).join(", ")} +${n.length - 2}`;
  }

  // -------------------------------------------------------------- review gate
  reviewMode(): "human" | "auto" | undefined { return this.network?.review?.mode; }
  /**
   * Opportunities waiting for review, soonest deadline first (filters: borough, members, origin).
   * An opportunity focus selects its card but does not narrow the list, so j/k can step through it.
   */
  reviewPending(): Opp[] {
    const oppFocus = this.ui.focus?.kind === "opportunity";
    return [...this.opps.values()]
      .filter(o => o.state === "IN_REVIEW" && this.matchOpp(o, { range: true, stateGroup: true }) && (oppFocus || this.focusOpp(o)))
      .sort((a, b) => (a.review?.deadline ?? Infinity) - (b.review?.deadline ?? Infinity));
  }
  /** Review decisions (approve, reject, expired) in the range, newest first. */
  reviewDecided(): Opp[] {
    return [...this.opps.values()]
      .filter(o => o.review?.decision && this.inRange(o.review.decidedAt ?? o.updatedAt) && this.matchOpp(o, { range: true, stateGroup: true }) && this.focusOpp(o))
      .sort((a, b) => (b.review?.decidedAt ?? b.updatedAt) - (a.review?.decidedAt ?? a.updatedAt));
  }
  /** Game: the tab shows when a person reviews. Real: when items exist. */
  showReviewTab(): boolean {
    if (this.env?.capabilities.canIntervene) return this.reviewMode() === "human";
    for (const o of this.opps.values()) if (o.state === "IN_REVIEW") return true;
    return false;
  }
  canWrite() { return !!this.env && !this.env.capabilities.readOnly; }
  /** Review, safety and matching actions work here: game mode, or real mode through the Network service. */
  canAct() { return !!this.env && (this.env.capabilities.staffActions ?? !this.env.capabilities.readOnly); }
  /** This viewer may decide review items here (actions possible and the reviewer role). */
  canReview() { return this.canAct() && this.can("reviewer"); }
  judge(): JudgeCounts | undefined { return (this.stats as (ObsStats & { judge?: JudgeCounts }) | undefined)?.judge; }
  /** A review card was opened: the time to the decision is sent with it (a training label). */
  reviewOpen(id: string) { if (!this.reviewOpened.has(id)) this.reviewOpened.set(id, Date.now()); }
  /**
   * Approve, reject, edit or re-roll. A toast confirms; errors come back with their code (and a toast
   * unless `quiet`). Seconds since the card was opened go with the decision.
   */
  async decide(o: ObsOpportunity, decision: ReviewDecision, opts: DecideOpts = {}, quiet = false): Promise<ControlResult> {
    // One decision per item at a time: a double press (or "a" held down) would come back "not_in_review".
    if (this.deciding.has(o.id)) return { ok: false, code: "in_flight", error: "a decision on this item is on its way" };
    const opened = this.reviewOpened.get(o.id);
    const secondsSpent = opened === undefined ? undefined : Math.min(REVIEW_SECONDS_CAP, Math.round((Date.now() - opened) / 1000));
    const note = opts.note?.trim() || undefined;
    this.deciding.add(o.id);
    let r: ControlResult;
    try { r = await this.control({ type: "review", oppId: o.id, decision, ...opts, note, ...(secondsSpent !== undefined ? { secondsSpent } : {}) }, { quiet }); } finally { this.deciding.delete(o.id); }
    // A refused action changed nothing (no seconds were recorded): keep timing. Otherwise the item moved on.
    if (r.ok || !REFUSED.has(r.code ?? "")) this.reviewOpened.delete(o.id);
    if (decision === "reroll" && r.ok) this.reviewOpened.set(o.id, Date.now());
    if (r.ok) {
      const what = decision === "approve" ? "Approved" : decision === "edit" ? "Edited and approved" : decision === "reroll" ? "Re-rolled" : "Rejected";
      this.toast(`${what} · ${this.oppTitle(o)}`, decision === "reject" ? "info" : "good");
    }
    return r;
  }
}

export const store = new ObsStore();

export function useStore(): ObsStore {
  useSyncExternalStore(store.subscribe, store.getTick);
  return store;
}
