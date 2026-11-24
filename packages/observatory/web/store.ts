import { useSyncExternalStore } from "react";
import { acceptsFeedItem, deltaAction, initial as initialSync, ownsLoad, step as stepSync } from "../../core/src/generated/observatorySync.ts";
import {
  canClearFocus, canClosePerson, canDropMissingSubjects, canFlyToVenue, canFocusOn, canGoBack, canOpenAllApps, canOpenPerson, canPickHit, canReceiveModeChange, canReceiveQueues,
  canReplaceFocus, canSelectApp, canShowStage, canSwitchMode, canTogglePick, clearFocus as clearNavFocus, closePerson, type ConsoleMode, type ConsoleNav, type ConsolePage,
  type DrawerTab as NavTab, dropMissingSubjects, flyToVenue, focusOn, goBack, initial as initialNav, maxFocusHistory, maxPicks, openAllApps, openPerson as openNavPerson,
  pageForViewer, pickHit, pressEscape, queryClass, receiveModeChange, receiveQueues, replaceFocus, selectApp, showStage,
  type Subject, switchMode, toggleHelp, togglePick as toggleNavPick,
} from "../../core/src/generated/consoleNavigation.ts";
import { allowedByRole, scopedGrants } from "../../core/src/generated/staffPermissions.ts";
import { APP_IDS } from "../../core/src/types.ts";
import { NEIGHBORHOOD, type Borough } from "@thenetwork/network/geo";
import type { ConsoleApp } from "../src/apps.ts";
import type {
  AppHealth, AppProfile360, AuditEntry, BiasReportView, HeldQueue, HeldText, ClockInfo, ConfigInfo, ControlCommand, ControlResult, EngineRunSummary, EnvInfo, GameState, LabRequest, LabRun, MemberDetail, MemberTimeline,
  JudgeStats, MemberTruth, Mode, NetworkInfo, ObsDelta, ObsEdge, ObsFeedItem, ObsMember, ObsOpportunity, ObsRequest, ObsState, ObsStats, OpportunityDetail,
  MemberPhoto, PersonAppPanel, PersonSummary, RevealGrant, ReviewDecision, ReviewReason, RunDiff, SafetyAction, SafetyInfo, SearchHit, StaffPlanPreview, StaffRole, StaffUser,
} from "../src/types.ts";

/** Default switcher order; the server's list in /api/me replaces it. Core's type module is browser-safe. */
export const APP_ORDER: readonly string[] = APP_IDS;
/** What the switcher shows: one app, "all" (health of every app) or the cross-app person view. */
export type Page = { kind: "app" } | { kind: "all" } | { kind: "person"; id: string };
export type Me = StaffUser & { realOnly?: boolean; apps?: string[]; crossApp?: boolean; appInfo?: ConsoleApp[] };

export type Focus = { kind: "member" | "opportunity" | "neighborhood"; id: string } | null;
export type ColorLens = "community" | "state" | "activity" | "truth";
export type RangeKey = "today" | "7d" | "30d" | "all";
export type MemberFilter = "all" | "active" | "watch" | "hold" | "minor" | "not_joined";
export type StateGroup = "review" | "open" | "met" | "closed";
export type DrawerTab = "review" | "feed" | "pipeline" | "requests" | "engine" | "safety" | "metrics" | "lab" | "config" | "game";
export const DRAWER_TABS: DrawerTab[] = ["review", "feed", "pipeline", "requests", "engine", "safety", "metrics", "lab", "config", "game"];
export interface Filters { range: RangeKey; borough: "all" | Borough; members: MemberFilter; origin: string; stateGroup: "all" | StateGroup }
export type FilterKey = keyof Filters;

export type Opp = ObsOpportunity;

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

const NYC_TZ = "America/New_York";
const hms = new Intl.DateTimeFormat("en-US", { timeZone: NYC_TZ, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
/** Start of the NYC calendar day that contains t. */
export function nycDayStart(t: number): number {
  const p = Object.fromEntries(hms.formatToParts(t).map(x => [x.type, x.value]));
  return t - ((Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 - (t % 1000);
}
const NAV_TAB: Record<DrawerTab, NavTab> = {
  review: "ReviewTab", feed: "FeedTab", pipeline: "PipelineTab", requests: "RequestsTab", engine: "EngineTab",
  safety: "SafetyTab", metrics: "MetricsTab", lab: "LabTab", config: "ConfigTab", game: "GameTab",
};
/** The store name of each generated drawer tab. */
export const STORE_TAB = Object.fromEntries(Object.entries(NAV_TAB).map(([k, v]) => [v, k])) as Record<NavTab, DrawerTab>;
/** The generated drawer tab of a store tab. */
export const navTab = (t: DrawerTab): NavTab => NAV_TAB[t];
const SUBJECT: Record<NonNullable<Focus>["kind"], Subject> = { member: "MemberSubject", opportunity: "OpportunitySubject", neighborhood: "NeighborhoodSubject" };
/** The generated subject of a store focus. */
export const subjectOf = (f: Focus): Subject => (f ? SUBJECT[f.kind] : "Overview");
const navMode = (mode: Mode): ConsoleMode => (mode === "real" ? "RealMode" : "SimulatedMode");

export const sameFocus = (a: Focus, b: Focus) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
export const focusKey = (f: Focus) => (f ? `${f.kind}:${f.id}` : "");
export const isMemberActive = (m: ObsMember) => m.joined && m.state !== "opted_out" && m.state !== "paused" && m.state !== "not_joined";
/** Where an opportunity came from: shadow and player first, then the consent network's origin, then the source. */
export const originOf = (o: ObsOpportunity) => (o.source === "shadow" || o.source === "player" ? o.source : o.origin ?? o.source);

function readJSON<T>(key: string): Partial<T> | undefined {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as Partial<T> : undefined; } catch { return undefined; }
}
function writeJSON(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { return; } }
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

const TOKEN_KEY = "obs.token";
class AuthError extends Error {}
/** A detail fetch: the data, or the HTTP status and error (403 = this role cannot open it). */
export type Fetched<T> = { data: T; status: 200; error?: undefined } | { data?: undefined; status: number; error: string };
/** Review edits and re-rolls (PRD 32.8). */
export interface DecideOpts { reason?: ReviewReason; note?: string; explanations?: Record<string, string>; objective?: string; swapOut?: string }
/** Time on one review item counts at most this long (a card left open is not review work). */
const REVIEW_SECONDS_CAP = 30 * 60;
/** Review codes for an action that was refused before anything was recorded (the item still waits). */
const REFUSED = new Set(["in_flight", "not_in_review", "note_required", "participant_minor", "participant_declined", "matching_paused", "nothing_to_edit", "not_a_participant", "edit_leak", "cannot_swap", "review_stale", "unknown_decision", "unknown_reason", "forbidden", ""]);
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
      try { sessionStorage.setItem(TOKEN_KEY, t); } catch {}
      u.searchParams.delete("token"); h.delete("token");
      const rest = h.toString();
      history.replaceState(history.state, "", u.pathname + u.search + (rest ? `#${rest}` : ""));
    }
  } catch {}
  if (!t) { try { t = sessionStorage.getItem(TOKEN_KEY); } catch { t = null; } }
  return t ?? "";
}

/**
 * The client state of the console: the full state from /api/state, then WebSocket deltas. The map and graph renderers read
 * the maps directly; React components subscribe with `useStore()`. One focus model (member, opportunity or neighborhood,
 * mirrored to location.hash) and one set of global filters (range, borough, members, origin, state group). Every panel
 * filters through the predicates of this store, never through its own copy.
 */
class ObsStore {
  private sync = stepSync(initialSync, { type: "changeView", appName: parseApp(), viewMode: "game" });
  get mode(): Mode { return this.sync.viewMode === "real" ? "real" : "game"; }
  set mode(mode: Mode) { this.changeView(this.app, mode); }
  /** The app every panel shows (the switcher; ?app= on every request). */
  get app(): string { return this.sync.appName; }
  set app(app: string) { this.changeView(app, this.mode); }
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
  get version(): number { return this.sync.version; }
  connected = false;
  loading = true;
  /** The API answered 401: the UI shows the token prompt. */
  authNeeded = false;
  /** Nonsecret invalidation for private previews across actual credential/session changes. */
  authEpoch = 0;
  private token = initialToken();
  private filtersMode: Mode | null = null;
  /**
   * Deltas that arrive while a full state is loading. A delta generated after the state was read must
   * not be lost under it (an item would stay "in review" here after the server moved it on); those at
   * or after the state's version are applied once it lands.
   */
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
  /** Tells the subscribers after a short timer. The timer is not requestAnimationFrame, because that pauses in hidden or throttled tabs and would freeze the state of the UI, clicks included. */
  notify() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
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

  /** Every request names the app (the server checks the role for it). */
  private withApp(path: string) { return /[?&]app=/.test(path) ? path : `${path}${path.includes("?") ? "&" : "?"}app=${encodeURIComponent(this.app)}`; }
  /** Sends a request with the token and the mode that this page shows; the server refuses a change meant for the other mode (409 mode_changed). */
  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    headers.set("x-observatory-mode", this.mode);
    const r = await fetch(this.withApp(path), { ...init, headers });
    if (r.status === 401) {
      if (!this.authNeeded) { this.authEpoch++; this.authNeeded = true; this.notify(); }
      throw new AuthError("token required");
    }
    return r;
  }
  async getJSON<T>(path: string): Promise<T> {
    const r = await this.api(path);
    if (r.ok) return r.json() as Promise<T>;
    const j = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(j.error ?? `HTTP ${r.status}`);
  }
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
    if(t.trim()!==this.token)this.authEpoch++;
    this.token = t.trim();
    try { sessionStorage.setItem(TOKEN_KEY, this.token); } catch {}
    this.authNeeded = false;
    this.notify();
    this.connect();
    this.load();
  }

  private beginLoad() {
    this.sync = stepSync(this.sync, { type: "startLoad" });
    this.buffered = [];
    return this.sync.generation;
  }

  async load() {
    let generation = this.beginLoad();
    this.loading = true; this.notify();
    try {
      const [mode, me] = await Promise.all([this.getJSON<{ mode: Mode }>("/api/mode"), this.fetch<Me>("/api/me")]);
      if (!ownsLoad(this.sync, generation)) return;
      if (!me.data && me.status !== 404) throw me.status === 401 ? new AuthError(me.error) : new Error(me.error);
      const viewer: Me = me.data ?? { id: "token", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" };
      if (JSON.stringify([this.me?.id, this.me?.grants, this.me?.roles]) !== JSON.stringify([viewer.id, viewer.grants, viewer.roles])) this.authEpoch++;
      this.me = viewer;
      const apps = this.me.apps ?? APP_ORDER;
      const selectedApp = this.app;
      const app = apps.includes(selectedApp) ? selectedApp : apps[0];
      if (this.changeView(app ?? selectedApp, mode.mode)) generation = this.beginLoad();
      if (!app) {
        this.sync = stepSync(this.sync, { type: "failLoad", generation });
        return;
      }
      if (app !== selectedApp) { this.replaceHash(); this.connect(); }
      const state = await this.getJSON<ObsState>("/api/state");
      if (!ownsLoad(this.sync, generation)) return;
      if (!Number.isSafeInteger(state.version) || !state.env) throw new Error("Invalid snapshot response");
      const next = stepSync(this.sync, {
        type: "publishSnapshot", generation, appName: state.env.app ?? app, viewMode: state.env.mode, version: state.version,
      });
      if (next === this.sync) throw new Error("Invalid state for the selected view");
      this.loadReveals();
      if (this.filtersMode !== this.mode) { this.filtersMode = this.mode; this.ui = { ...this.ui, filters: loadFilters(this.mode) }; }
      this.applyFull(state);
      this.sync = next;
      const later = this.buffered;
      this.buffered = [];
      for (const d of later) {
        if (generation !== this.sync.generation) break;
        this.applyDelta(d);
      }
    } catch (e) {
      if (!ownsLoad(this.sync, generation)) return;
      this.sync = stepSync(this.sync, { type: "failLoad", generation });
      if (!(e instanceof AuthError)) this.toast(`Could not load: ${(e as Error).message}`, "bad");
    } finally {
      if (this.sync.generation === generation) {
        this.buffered = [];
        this.loading = false;
        this.notify();
      }
    }
  }

  private applyFull(s: ObsState) {
    const members = new Map(s.members.map(m => [m.id, m]));
    const edges = new Map(s.edges.map(e => [e.id, e]));
    const opps = new Map(s.opportunities.map(o => [o.id, o]));
    const feed = s.feed.filter(it => Number.isSafeInteger(it.seq));
    this.env = s.env; this.clock = s.clock; this.stats = s.stats; this.runs = s.engineRuns; this.game = s.game; this.truth = s.truth; this.network = s.network;
    this.requests = s.requests ?? [];
    this.members = members; this.edges = edges; this.opps = opps;
    this.feed = feed; this.pulses = [];
    this.dropMissingFocus();
    this.ui = { ...this.ui, picks: this.ui.picks.filter(id => this.members.has(id)) };
    this.graphTick++;
  }

  private changeView(appName: string, viewMode: Mode): boolean {
    const next = stepSync(this.sync, { type: "changeView", appName, viewMode });
    if (next === this.sync) return false;
    this.sync = next;
    this.buffered = [];
    this.members = new Map(); this.edges = new Map(); this.opps = new Map(); this.feed = []; this.pulses = [];
    this.env = undefined; this.clock = undefined; this.stats = undefined; this.runs = []; this.game = undefined;
    this.truth = undefined; this.network = undefined; this.requests = []; this.reveals = [];
    this.graphTick++;
    return true;
  }

  /**
   * After new data: the generated `dropMissingSubjects` drops the history entries whose subject is gone, and returns to the overview
   * when the focused subject is gone. A history that the generated guard refuses is filtered the same way.
   */
  private dropMissingFocus() {
    const nav = this.nav();
    const kept = this.focusHistory.filter(f => this.focusExists(f));
    const exists = this.focusExists(this.ui.focus);
    const dropped = this.focusHistory.length - kept.length;
    if (!canDropMissingSubjects(nav, dropped)) {
      if (!exists) { this.ui = { ...this.ui, focus: null }; this.focusHistory = []; } else this.focusHistory = kept;
      return;
    }
    const next = dropMissingSubjects(nav, exists, dropped);
    if (next.subject === "Overview" && this.ui.focus) this.ui = { ...this.ui, focus: null };
    this.focusHistory = next.depth > 0 ? kept.slice(-next.depth) : [];
  }

  private focusExists(f: Focus) {
    if (!f) return true;
    if (f.kind === "member") return this.members.has(f.id);
    if (f.kind === "opportunity") return this.opps.has(f.id);
    return NEIGHBORHOOD.has(f.id) || [...this.members.values()].some(m => m.area === f.id);
  }

  private applyDelta(d: ObsDelta) {
    if (!d.reset && !Number.isSafeInteger(d.version)) return;
    const action = deltaAction(this.sync, d.version, !!d.reset);
    if (action === "BufferDelta") { this.buffered.push(d); return; }
    if (action === "ReloadSnapshot") { this.load(); return; }
    if (action === "DropDelta") return;
    this.clock = d.clock;
    if (d.game) this.game = d.game;
    if (d.network) this.network = d.network;
    if (action === "ApplyData") {
      this.applyData(d);
      this.sync = stepSync(this.sync, { type: "acceptDelta", version: d.version });
    }
    this.notify();
  }

  private applyData(d: ObsDelta) {
    if (d.env) this.env = d.env;
    if (d.stats) this.stats = d.stats;
    if (d.engineRuns) this.runs = d.engineRuns;
    if (d.requests) this.requests = d.requests;
    let graph = false;
    for (const m of d.members ?? []) { const prev = this.members.get(m.id); this.members.set(m.id, m); if (!prev || prev.joined !== m.joined || prev.state !== m.state) graph = true; }
    for (const e of d.edges ?? []) { if (!this.edges.has(e.id)) graph = true; this.edges.set(e.id, e); }
    for (const o of d.opportunities ?? []) this.opps.set(o.id, o);
    for (const id of d.removedOpportunities ?? []) this.opps.delete(id);
    if (d.feed?.length) {
      const added: ObsFeedItem[] = [];
      let tail = this.feed.at(-1);
      for (const it of d.feed) {
        if (!Number.isSafeInteger(it.seq) || !acceptsFeedItem(tail !== undefined, tail?.seq ?? 0, it.seq)) continue;
        added.push(it);
        tail = it;
      }
      if (added.length) {
        this.feed = [...this.feed, ...added].slice(-400);
        this.pulses = [...this.pulses, ...added].slice(-200);
      }
    }
    if (graph) this.graphTick++;
  }

  /**
   * Open the live socket. A browser WebSocket cannot send the token header, so the page first asks for
   * a one-use ticket (POST /api/ws-ticket, 30 s) and opens /ws?ticket=. The token never goes in a URL.
   */
  async connect() {
    const gen = ++this.wsGen;
    this.ws?.close();
    if (this.connected) { this.connected = false; this.notify(); }
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
      if (ev.code === 4401 || ev.code === 4403) { this.toast(ev.code === 4401 ? "Signed out: sign in again" : `No role for ${this.app} any more`, "bad"); this.load(); return; }
      setTimeout(() => { if (gen === this.wsGen && !this.authNeeded) { this.connect(); this.load(); } }, 1500);
    };
    ws.onmessage = ev => {
      if (gen !== this.wsGen) return;
      const msg = JSON.parse(ev.data);
      if (msg.app !== undefined && msg.app !== this.app) return;
      if (msg.type === "delta" && msg.mode === this.mode) this.applyDelta(msg.delta);
      else if (msg.type === "clock" && this.sync.phase === "Live") { this.clock = msg.clock; this.notify(); }
      else if (msg.type === "mode") { if (msg.mode !== this.mode) { this.applyModeChange(msg.mode, true); this.load(); } }
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

  // spec/consoleNavigation.md, "A mode change clears the subject and the picks"
  /** Switches the data mode on the server, then applies the generated `switchMode`. */
  async setMode(mode: Mode) {
    if (!canSwitchMode(this.nav(), navMode(mode))) return;
    let r: { ok: boolean; error?: string };
    try {
      r = await this.api("/api/mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }).then(x => x.json());
    } catch (e) { r = { ok: false, error: (e as Error).message }; }
    if (!r.ok) { this.toast(r.error ?? "could not switch mode", "bad"); return; }
    this.applyModeChange(mode, false);
    await this.load();
  }

  /** Moves the store to a data mode with the generated `switchMode` (this viewer's switch) or `receiveModeChange` (the server's announcement). */
  private applyModeChange(mode: Mode, received: boolean) {
    const nav = this.nav(), target = navMode(mode), had = !!this.ui.focus;
    const allowed = received ? canReceiveModeChange(nav, target) : canSwitchMode(nav, target);
    if (!allowed) return;
    const next = received ? receiveModeChange(nav, target) : switchMode(nav, target);
    this.mode = mode;
    this.commitNav(next);
    if (had) this.pushHash(null);
  }

  member(id: string) { return this.fetch<MemberDetail>(`/api/member/${encodeURIComponent(id)}`); }
  timeline(id: string) { return this.fetch<MemberTimeline>(`/api/member/${encodeURIComponent(id)}/timeline`); }
  /** The app's own Member 360 panel (slop dating preferences behind a reveal; peon roles and applications). */
  memberApp(id: string) { return this.fetch<AppProfile360>(`/api/member/${encodeURIComponent(id)}/app`); }
  /** slop photos: admin or safety, a typed reason, verified adults only. */
  photos(id: string, reason: string) { return this.fetch<{ ok: boolean; photos?: MemberPhoto[]; error?: string }>(`/api/member/${encodeURIComponent(id)}/photos`, { reason }); }
  opportunity(id: string) { return this.fetch<OpportunityDetail>(`/api/opportunity/${encodeURIComponent(id)}`); }
  reviewPlanPreview(id: string, revision: number) { return this.fetch<{ ok: true; preview: StaffPlanPreview }>(`/api/review/${encodeURIComponent(id)}/plan?revision=${revision}`); }
  safety() { return this.fetch<SafetyInfo>("/api/safety"); }
  safetyAction(a: SafetyAction) { return this.fetch<ControlResult>("/api/safety", a); }
  held(queue: HeldQueue) { return this.fetch<{ ok: boolean; items?: HeldText[]; code?: string; error?: string }>(`/api/held?queue=${queue}`); }
  async heldPhoto(id:string,reason:string):Promise<{blob?:Blob;error?:string}>{
    try{
      const r=await this.api(`/api/held/${encodeURIComponent(id)}/photo`,{headers:{"x-network-reason":reason}});
      if(!r.ok)return {error:"The selected photo could not load. Try again or reject it."};
      const blob=await r.blob();
      return ["image/jpeg","image/png","image/webp"].includes(blob.type)&&blob.size>0?{blob}:{error:"The selected photo could not be verified. You can still reject it."};
    }catch{return {error:"The selected photo could not load. Try again or reject it."};}
  }
  heldDecision(queue: HeldQueue, id: string, decision: "release" | "reject", reason: string, photoReviewed?:boolean) { return this.fetch<ControlResult>("/api/held", { queue, id, decision, reason, ...(photoReviewed?{photoReviewed}:{}) }); }
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
  // spec/consoleNavigation.md, "The app switcher opens one app or the all-apps page"
  setApp(app: string) {
    const nav = this.nav();
    if (app === "all") {
      if (!canOpenAllApps(nav)) return;
      this.commitNav(openAllApps(nav));
      this.replaceHash();
      return;
    }
    if (!canSelectApp(nav)) return;
    const changed = this.changeView(app, this.mode);
    this.commitNav(selectApp(nav, !changed));
    if (changed) { this.connect(); this.load(); }
    this.replaceHash();
  }
  // spec/consoleNavigation.md, "Only a cross-app viewer in real mode opens one person across apps"
  /** The cross-app person view (cross_app_safety or admin; the server checks). */
  openPerson(id: string) {
    const nav = this.nav();
    if (!canOpenPerson(nav)) return;
    this.commitNav(openNavPerson(nav), { person: id });
    this.replaceHash();
  }
  /** Leaves the person view for the all-apps page: the generated `closePerson`. */
  closePage() {
    const nav = this.nav();
    if (!canClosePerson(nav)) return;
    this.commitNav(closePerson(nav));
    this.replaceHash();
  }
  private replaceHash() {
    const h = this.page.kind === "person" ? `#p=${encodeURIComponent(this.page.id)}` : this.page.kind === "all" ? "#a=all" : hashOf(this.ui.focus, this.app);
    try { history.replaceState(history.state, "", location.pathname + location.search + h); } catch { return; }
  }
  labRun(req: LabRequest) { return this.fetch<{ ok: boolean; run: LabRun }>("/api/lab/run", req); }

  /** The caller holds one of these roles; admin passes every check (server rule). False until /api/me answers. */
  can(...roles: StaffRole[]): boolean {
    if (!this.me) return false;
    const { grants, roles: held } = this.me;
    return allowedByRole(grants ? scopedGrants(grants, this.app, this.mode === "real").map(g => g.role) : held, roles);
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
    const { generation } = this.sync;
    const r = await this.fetch<RevealGrant[]>("/api/reveal");
    if (generation !== this.sync.generation) return;
    this.reveals = r.data ?? [];
    this.notify();
  }
  revealFor(memberId: string): RevealGrant | undefined { return this.reveals.find(g => g.memberId === memberId && g.until > Date.now()); }
  /** End a reveal before its time (audited). */
  async unreveal(memberId: string): Promise<void> {
    try { await this.api(`/api/reveal?memberId=${encodeURIComponent(memberId)}`, { method: "DELETE" }); } catch {}
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

  /** The console navigation state of the store, for the generated consoleNavigation guards and transitions. */
  nav(): ConsoleNav {
    const me = this.me;
    const appsHeld = me ? (me.apps ?? APP_ORDER).length : 0;
    const crossApp = !!me?.crossApp;
    const mode = navMode(this.mode);
    const page: ConsolePage = this.page.kind === "all" ? "AllAppsPage" : this.page.kind === "person" ? "PersonPage" : "AppPage";
    const subject = subjectOf(this.ui.focus);
    let reviewItems = false;
    for (const o of this.opps.values()) if (o.state === "IN_REVIEW") { reviewItems = true; break; }
    const base: ConsoleNav = {
      page: me ? pageForViewer(page, appsHeld, crossApp, mode) : page,
      stage: this.ui.view === "graph" ? "GraphStage" : "MapStage",
      subject,
      depth: subject === "Overview" ? 0 : Math.min(maxFocusHistory, this.focusHistory.length),
      wantedTab: NAV_TAB[this.ui.drawer],
      drawerOpen: this.ui.drawerOpen,
      popoverOpen: !!this.ui.popover,
      queryChars: queryClass(this.ui.query.trim().length),
      picks: Math.min(maxPicks, this.ui.picks.length),
      viewer: {
        known: !!me, mode, appsHeld, crossApp, admin: !!me && this.isAdmin(), analyst: this.can("analyst"), simRole: this.canSim(), safety: this.can("safety"), realOnly: this.realOnly(),
      },
      queues: initialNav.queues,
    };
    return canReceiveQueues(base) ? receiveQueues(base, reviewItems, this.requests.length > 0 || this.network?.kind === "consent") : base;
  }

  /**
   * Writes a generated navigation state back to the store: the page, the stage, the drawer, the popover, the search text, the picks, and the focus with its history.
   * `focus` is the subject that the new state names, and `history` is the list that its depth counts from the end.
   */
  private commitNav(next: ConsoleNav, opts: { focus?: Focus; history?: Focus[]; person?: string } = {}) {
    const before = this.nav();
    const patch: Partial<UIState> = {};
    const view = next.stage === "GraphStage" ? "graph" : "map";
    if (view !== this.ui.view) patch.view = view;
    if (STORE_TAB[next.wantedTab] !== this.ui.drawer) patch.drawer = STORE_TAB[next.wantedTab];
    if (next.drawerOpen !== this.ui.drawerOpen) patch.drawerOpen = next.drawerOpen;
    if (!next.popoverOpen && this.ui.popover) patch.popover = null;
    if (next.queryChars === 0 && this.ui.query) patch.query = "";
    if (next.picks === 0 && this.ui.picks.length) patch.picks = [];
    const focus = next.subject === "Overview" ? null : opts.focus ?? this.ui.focus;
    if (!sameFocus(focus, this.ui.focus)) patch.focus = focus;
    this.focusHistory = next.depth > 0 ? (opts.history ?? this.focusHistory).slice(-next.depth) : [];
    if (next.page !== before.page || opts.person !== undefined) {
      if (next.page === "AllAppsPage") this.page = { kind: "all" };
      else if (next.page === "AppPage") this.page = { kind: "app" };
      else if (next.page === "PersonPage") this.page = { kind: "person", id: opts.person ?? (this.page.kind === "person" ? this.page.id : "") };
    }
    this.setUI(patch);
  }

  // spec/consoleNavigation.md, "Focus on a new subject keeps the last one in a short history"
  /** Enter a focus: the generated `focusOn` (or `replaceFocus` with `replace`). The previous one goes on the history (max 20); the URL hash follows. */
  focus(f: Focus, opts: { replace?: boolean } = {}) {
    if (!f) { this.clearFocus(); return; }
    const cur = this.ui.focus;
    if (sameFocus(cur, f)) return;
    const nav = this.nav(), target = subjectOf(f);
    if (opts.replace) {
      if (!canReplaceFocus(nav, target)) return;
      this.commitNav(replaceFocus(nav, target), { focus: f });
      try { history.replaceState(history.state, "", location.pathname + location.search + hashOf(f, this.app)); } catch { return; }
      return;
    }
    if (!canFocusOn(nav, target, false)) return;
    this.commitNav(focusOn(nav, target, false), { focus: f, history: cur ? [...this.focusHistory, cur] : this.focusHistory });
    this.pushHash(f);
  }
  // spec/consoleNavigation.md, "Search offers names and places from two characters and ids from three"
  /** Open a search hit: the generated `pickHit` focuses the subject, keeps the last one on the history and clears the search. */
  pickHit(f: NonNullable<Focus>) {
    const cur = this.ui.focus;
    const nav = this.nav(), target = subjectOf(f), same = sameFocus(cur, f);
    if (!canPickHit(nav, target, same)) return;
    this.commitNav(pickHit(nav, target, same), { focus: f, history: cur && !same ? [...this.focusHistory, cur] : this.focusHistory });
    if (!same) this.pushHash(f);
  }
  // spec/consoleNavigation.md, "Back returns to the last subject and clear returns to the overview"
  /** Return to the previous focus: the generated `goBack`. Uses the browser history when this page pushed the entry. */
  back() {
    const prev = this.focusHistory.at(-1) ?? null;
    const nav = this.nav();
    if (!prev || !canGoBack(nav, subjectOf(prev))) return;
    if (((history.state as { obsDepth?: number } | null)?.obsDepth ?? 0) > 0) { history.back(); return; }
    this.commitNav(goBack(nav, subjectOf(prev)), { focus: prev, history: this.focusHistory.slice(0, -1) });
    try { history.replaceState({ obsDepth: 0 }, "", location.pathname + location.search + hashOf(prev, this.app)); } catch { return; }
  }
  /** Back to the overview: the generated `clearFocus`. */
  clearFocus() {
    const nav = this.nav();
    if (!canClearFocus(nav)) { this.focusHistory = []; return; }
    this.commitNav(clearNavFocus(nav));
    this.pushHash(null);
  }
  private pushHash(f: Focus) {
    try {
      const depth = ((history.state as { obsDepth?: number } | null)?.obsDepth ?? 0) + 1;
      history.pushState({ obsDepth: depth }, "", location.pathname + location.search + hashOf(f, this.app));
    } catch { return; }
  }
  private onPopState() {
    const page = parsePage(), app = parseApp();
    if (page.kind === "all") { if (this.page.kind !== "all") this.setApp("all"); return; }
    if (page.kind === "person") { if (this.page.kind !== "person" || this.page.id !== page.id) this.openPerson(page.id); return; }
    if (this.page.kind !== "app" || app !== this.app) {
      const switching = app !== this.app;
      this.setApp(app);
      if (switching) return;
    }
    const f = parseHash();
    if (sameFocus(f, this.ui.focus)) return;
    const nav = this.nav();
    if (!f || !this.focusExists(f)) { if (canClearFocus(nav)) this.commitNav(clearNavFocus(nav)); return; }
    const top = this.focusHistory.at(-1) ?? null;
    if (top && sameFocus(top, f) && canGoBack(nav, subjectOf(f))) { this.commitNav(goBack(nav, subjectOf(f)), { focus: f, history: this.focusHistory.slice(0, -1) }); return; }
    const cur = this.ui.focus;
    if (canFocusOn(nav, subjectOf(f), false)) this.commitNav(focusOn(nav, subjectOf(f), false), { focus: f, history: cur ? [...this.focusHistory, cur] : this.focusHistory });
  }
  // spec/consoleNavigation.md, "Escape closes one thing at a time"
  /** Esc does the one step that the generated `pressEscape` takes: close the popover, clear the search, clear the picks or clear the focus. */
  escape() {
    const had = !!this.ui.focus;
    this.commitNav(pressEscape(this.nav()));
    if (had && !this.ui.focus) this.pushHash(null);
  }
  /** Opens or closes the popover: the generated `toggleHelp`. It opens the help. */
  toggleHelp() {
    const next = toggleHelp(this.nav());
    if (next.popoverOpen) this.setUI({ popover: "help" });
    else this.commitNav(next);
  }

  // spec/consoleNavigation.md, "The stage shows the map or the graph"
  /** Shows the map or the graph: the generated `showStage`. */
  showStage(view: UIState["view"]) {
    const nav = this.nav(), target = view === "graph" ? "GraphStage" : "MapStage";
    if (canShowStage(nav, target)) this.commitNav(showStage(nav, target));
  }
  /** The live map or graph (set by the stage while mounted). */
  stage: { focus(id: string): void; flyTo?(lat: number, lng: number): void } | null = null;
  /** A map fly-to waiting for the map to mount (venue links clicked in graph view). */
  pendingFly: { lat: number; lng: number } | null = null;
  /** Shows a venue on the map: the generated `flyToVenue`, which opens the map stage. */
  flyTo(lat: number, lng: number) {
    const nav = this.nav();
    if (!canFlyToVenue(nav)) return;
    if (nav.stage === "MapStage" && this.stage?.flyTo) { this.stage.flyTo(lat, lng); return; }
    this.pendingFly = { lat, lng };
    this.commitNav(flyToVenue(nav));
  }

  // spec/consoleNavigation.md, "Picks exist only for a viewer who plays the simulated world"
  /** Picks or unpicks a member: the generated `togglePick`, for a simulated-world player and never for a minor. */
  togglePick(id: string) {
    const nav = this.nav(), already = this.ui.picks.includes(id), minor = !!this.members.get(id)?.minor;
    if (!canTogglePick(nav, already, minor)) return;
    const next = toggleNavPick(nav, already, minor);
    const picks = [...this.ui.picks.filter(x => x !== id), ...(already ? [] : [id])];
    this.setUI({ picks: next.picks > 0 ? picks.slice(-next.picks) : [] });
  }

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

  name(id: string) { return this.members.get(id)?.name ?? id; }
  firstName(id: string) { return this.members.get(id)?.name.split(" ")[0] ?? id; }
  /** "Maya + Jon" for a pair, "Maya, Jon +2" for a group. */
  oppTitle(o: ObsOpportunity) {
    const n = o.participants.map(id => this.firstName(id));
    return n.length <= 2 ? n.join(" + ") : `${n.slice(0, 2).join(", ")} +${n.length - 2}`;
  }

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
  canWrite() { return !!this.env && !this.env.capabilities.readOnly; }
  /** Review, safety and matching actions work here: game mode, or real mode through the Network service. */
  canAct() { return !!this.env && (this.env.capabilities.staffActions ?? !this.env.capabilities.readOnly); }
  /** This viewer may decide review items here (actions possible and the reviewer role). */
  canReview() { return this.canAct() && this.can("reviewer"); }
  judge(): JudgeStats | undefined { return this.stats?.judge; }
  /** A review card was opened: the time to the decision is sent with it (a training label). */
  reviewOpen(id: string) { if (!this.reviewOpened.has(id)) this.reviewOpened.set(id, Date.now()); }
  /**
   * Approve, reject, edit or re-roll. A toast confirms; errors come back with their code (and a toast
   * unless `quiet`). Seconds since the card was opened go with the decision. Only one decision per item is in flight, so a
   * double press does not come back "not_in_review". A refused action keeps the timer; any other result stops it.
   */
  async decide(o: ObsOpportunity, decision: ReviewDecision, opts: DecideOpts = {}, quiet = false): Promise<ControlResult> {
    if (this.deciding.has(o.id)) return { ok: false, code: "in_flight", error: "a decision on this item is on its way" };
    const opened = this.reviewOpened.get(o.id);
    const secondsSpent = opened === undefined ? undefined : Math.min(REVIEW_SECONDS_CAP, Math.round((Date.now() - opened) / 1000));
    const note = opts.note?.trim() || undefined;
    this.deciding.add(o.id);
    let r: ControlResult;
    // The revision this card shows (spec/reviewDeadline.md): a re-roll since then makes the service refuse it as stale.
    try { r = await this.control({ type: "review", oppId: o.id, decision, ...opts, note, revision: o.review?.rerolls ?? 0, ...(secondsSpent !== undefined ? { secondsSpent } : {}) }, { quiet }); } finally { this.deciding.delete(o.id); }
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
