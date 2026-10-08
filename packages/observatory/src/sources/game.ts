// Game mode: a live simulated world (packages/sim) with engine-v1, made steppable and playable.
// The player can play the Network (propose intros), play a member (take over a persona), play the
// reviewer (approve or reject what the Network composed, PRD 32.8) or play god (scenario actions).
// Everything flows through the same Network pipeline and is scored against the oracle's hidden
// ground truth; the judge scorer checks the run records for invariants, leaks and minor contacts.
import { DAY, HOUR, MIN_MEMBER_AGE, MINUTE, type City, type MemberId, type Proposal, type ScoreComponents } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/core";
import { computeMetrics } from "@thenetwork/sim";
import {
  DEFAULT_START, generatePersonas, PolicyPersonaAgent, StubNetwork, World, type Persona,
} from "@thenetwork/sim";
import { loadPersonas } from "../../../../scripts/synthetic/load.ts";
import { DATA_DIR, readJsonl, type EdgeRecord, type HiddenTruthRecord, type MemberRecord } from "../../../../scripts/synthetic/common.ts";
import { CapturingEngine, summarizeRun } from "../engineCapture.ts";
import { ConsentNetwork, OUTREACH, SIM_AUTO_REVIEWER, type ReviewOptions } from "@thenetwork/network";
import { appBanner, APPS, DEFAULT_APP, MATCHING_OFF_TEXT, matchingAllowed, slaHours, type AppId } from "../apps.ts";
import { friendFactory, SCENARIOS, ScriptedJoinAgent } from "@thenetwork/network/harness";
import { describe, eventOf, onTimeline, requestLabel, toMs, type EventRow } from "../events.ts";
import { memberFacets } from "../appProfile.ts";
import { ALERT_WINDOW, growthStats, healthAlerts, hours, reportsFromCases, safetyInfo, scorecard } from "../health.ts";
import { Projector } from "../projector.ts";
import { evaluateMissions, POINTS, scoreboard } from "../scoring.ts";
import { emptyCounters, Store } from "../store.ts";
import { TakeoverAgent } from "../takeover.ts";
import type {
  ClockInfo, ConfigChange, ConfigInfo, ControlCommand, ControlResult, GameState, MemberDetail, MemberTimeline, MemberTruth, Mission, NetworkInfo,
  ObsDelta, ObsMember, ObsMessage, ObsOpportunity, ObsRequest, ObsState, OpportunityDetail, SafetyAction, SafetyInfo, SearchHit, SystemEvent, TimelineEntry,
} from "../types.ts";
import { REVIEW_REASONS } from "../types.ts";
import { Listeners, REVIEW_BLOCK_ERRORS, SAFETY_ERRORS, searchPattern, snippet, type DataSource, type ViewOptions } from "./source.ts";

export interface GameOptions {
  /**
   * The app this world plays (default ntwrk). Each app runs the network pack on the NYC world with the
   * app's join age (APPS[app].minJoinAge): personas under it never join, as the platform refuses them
   * at join. slop and peon run with matching off until their packs ship ("matching off until pack"):
   * joins, onboarding and safety still run.
   */
  app?: AppId;
  seed?: number;
  /** Simulated days available (default 60). */
  days?: number;
  engine?: GameState["engine"];
  /** The Network under test: "consent" (packages/network, default) or the old "stub". */
  network?: "consent" | "stub";
  /** "nyc" (default; the launch city) or "all" (SF + NYC). */
  city?: "nyc" | "all";
  /** NYC scenario id (@thenetwork/network/harness SCENARIOS) to play as a level. */
  scenario?: string | null;
  /** 0 (default) = the 500-member synthetic dataset v1; N > 0 = a generated world of N personas. */
  personas?: number;
  dataDir?: string;
  sparksPerDay?: number;
  /**
   * Review gate of the consent Network (PRD 32.8). "auto" (default): a simulated reviewer approves
   * everything that passed the gates. "human": the player is the reviewer; nothing is sent until
   * they approve it, and an item past its SLA expires unsent.
   */
  review?: "human" | "auto";
  /**
   * Personas answer offered times and booked plans from a hidden week, and attendance depends on the
   * meeting time (sim PolicyOptions.timeAware and WorldOptions.timeAware; runbook-simulation 6.1.2).
   * Default false.
   */
  timeAware?: boolean;
  /** Delta push interval in wall ms (default 250). */
  pushMs?: number;
  /** Play-loop tick in wall ms (default 100). */
  tickMs?: number;
}

const ZERO: ScoreComponents = {
  fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
  interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
};
export const SPEEDS = { hour: HOUR, sixHours: 6 * HOUR, day: DAY, twoDays: 2 * DAY } as const;
const MAX_STRIKES = 3;
const NEWCOMER_DAYS = 30;

interface Profile { bio?: string; occupation?: string; neighborhood?: string; pronouns?: string; availability?: string; datasetJoinedAt?: number }

export class GameSource implements DataSource {
  readonly mode = "game" as const;
  store!: Store;
  world!: World;
  private projector!: Projector;
  private takeover!: TakeoverAgent;
  private engine?: CapturingEngine;
  private personas = new Map<MemberId, Persona>();
  private profiles = new Map<MemberId, Profile>();
  private communities = new Map<MemberId, string>();
  private listeners = new Listeners<ObsDelta>();
  private advancing: Promise<void> | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private start = DEFAULT_START;
  private sparksUsed = new Map<number, number>();
  private lensUsed = false;
  private peeks = 0;
  private extraPoints: Record<string, number> = {};
  private missions: Mission[] = [];
  private strikeIds = new Set<string>();
  private proposalSeq = 0;
  private pendingReset = false;
  private opts: Required<Omit<GameOptions, "dataDir" | "scenario">> & { dataDir: string; scenario: string | null };
  readonly app: AppId;
  /** Sim hour of the last judge run (the scorer runs at most once per sim hour). */
  private judgeHour = -1;
  /** Wall time of the last judge run from the push loop (live deltas refresh it at most every 2 s). */
  private judgeWall = 0;
  consent?: ConsentNetwork;
  private records: RunRecord[] = [];
  /** The loaded level's cast (role -> member id). */
  scenarioIds: Record<string, MemberId> = {};
  /** Recent refusals, guard blocks and review expiries (health alerts look at the last 24 h). */
  private recent: { t: number; key: string }[] = [];
  /** When each member texted STOP; who invited someone (scorecard, growth). */
  private optOutAt = new Map<MemberId, number>();
  private inviters = new Set<MemberId>();
  /** Leak-guard fallbacks per member and time (the timeline marks those messages). */
  private guardFallback = new Set<string>();
  /** Matching switch and review mode changes (admin-console 3.11). */
  private configHistory: ConfigChange[] = [];
  /** Wall time of the last health computation. */
  private healthWall = 0;
  private healthHour = -1;
  /** The Network panel as last pushed. */
  private lastNetwork = "";

  constructor(opts: GameOptions = {}) {
    this.app = opts.app ?? DEFAULT_APP;
    this.opts = {
      app: this.app,
      seed: opts.seed ?? 1, days: opts.days ?? 60, engine: opts.engine ?? "engine-v1", personas: opts.personas ?? 0,
      dataDir: opts.dataDir ?? DATA_DIR, sparksPerDay: opts.sparksPerDay ?? 6, pushMs: opts.pushMs ?? 250, tickMs: opts.tickMs ?? 100,
      network: opts.network ?? "consent", city: opts.city ?? "nyc", scenario: opts.scenario ?? null, review: opts.review ?? "auto",
      timeAware: opts.timeAware ?? false,
    };
  }

  // ------------------------------------------------------------------ lifecycle
  async init() {
    const o = this.opts;
    const synthetic = o.personas <= 0;
    let personas: Persona[];
    let edges: EdgeRecord[] = [];
    this.personas.clear(); this.profiles.clear(); this.communities.clear();
    if (synthetic) {
      personas = (await loadPersonas(o.dataDir)).filter(p => o.city === "all" || p.homeCity === "nyc");
      const manifest = await Bun.file(`${o.dataDir}/manifest.json`).json();
      this.start = manifest.snapshotNow;
      for (const m of await readJsonl<MemberRecord>(`${o.dataDir}/members.jsonl`)) {
        const p = m.profile as Record<string, any>;
        this.profiles.set(m.id, { bio: p?.bio, occupation: p?.occupation, neighborhood: p?.neighborhood, pronouns: p?.pronouns, availability: p?.availability, datasetJoinedAt: m.joinedAt });
      }
      for (const h of await readJsonl<HiddenTruthRecord>(`${o.dataDir}/hidden_truth.jsonl`)) this.communities.set(h.memberId, h.community);
      edges = await readJsonl<EdgeRecord>(`${o.dataDir}/edges.jsonl`);
    } else {
      personas = generatePersonas({ n: o.personas, seed: o.seed, joinSpreadDays: 7, ...(o.city === "nyc" ? { cityWeights: { nyc: 1, sf: 0 } } : {}) });
      this.start = DEFAULT_START;
    }
    // The level's setup may override persona fields (ages, join days), so it runs before the view is built.
    const scenario = o.scenario ? SCENARIOS.find(x => x.id === o.scenario) : undefined;
    const cast = scenario?.setup(personas, this.start);
    // The platform's join gate for an app with a join age above the Network's own (13): a person under
    // it is refused before the Network sees them. ntwrk keeps its under-13 personas (the Network declines them).
    const minAge = APPS[this.app].minJoinAge;
    if (minAge > MIN_MEMBER_AGE) personas = personas.filter(p => p.public.claimedAge >= minAge);
    for (const p of personas) this.personas.set(p.id, p);
    this.scenarioIds = cast?.ids ?? {};

    const clock: ClockInfo = { now: this.start, start: this.start, end: this.start + o.days * DAY, day: 1, playing: false, speed: SPEEDS.sixHours, waitingForPlayer: false };
    this.store = new Store({
      mode: "game", app: this.app, ...(matchingAllowed(this.app) ? {} : { matchingLocked: true }),
      label: `SIMULATION · ${appBanner(this.app)} · seed ${o.seed}${o.timeAware ? " · time-aware" : ""} · ${synthetic ? `synthetic v1 (${personas.length} ${o.city === "nyc" ? "NYC" : "SF/NYC"})` : `${o.personas} generated personas`} · ${o.network === "consent" ? "consent-first Network" : "stub Network"}${o.scenario ? ` · level: ${o.scenario}` : ""}${minAge > MIN_MEMBER_AGE ? ` · join ${minAge}+` : ""}${matchingAllowed(this.app) ? "" : ` · ${MATCHING_OFF_TEXT}`}`,
      dataset: synthetic ? "synthetic-v1" : `generated-${o.personas}`,
      capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false },
    }, clock);
    for (const p of personas) {
      const prof = this.profiles.get(p.id);
      const m: ObsMember = {
        id: p.id, name: p.name, city: p.homeCity, area: prof?.neighborhood ?? p.routine.homeArea, state: "not_joined", joined: false,
        minor: p.public.claimedAge < 18, age: p.public.claimedAge, invitedBy: p.invitedBy,
        community: this.communities.get(p.id) ?? `${p.homeCity}:${p.routine.homeArea}`, occupation: prof?.occupation, counters: emptyCounters(),
      };
      this.store.upsertMember(m);
    }
    // The graph as the Network knows it at the start (vouches, invites, friendships, blocks).
    if (synthetic) {
      for (const e of edges) if (this.personas.has(e.from) && this.personas.has(e.to))
        this.store.addEdge({ from: e.from, to: e.to, type: e.type, strength: e.strength, createdAt: e.createdAt, origin: "graph" });
    } else {
      for (const p of personas) {
        if (p.invitedBy) this.store.addEdge({ from: p.invitedBy, to: p.id, type: "invited_by", strength: 0.7, createdAt: this.start, origin: "graph" });
        for (const r of p.relationships) if (r.type !== "ex" && this.personas.has(r.to))
          this.store.addEdge({ from: p.id, to: r.to, type: "knows", strength: r.closeness, createdAt: this.start, origin: "graph" });
      }
    }

    const persona = cast?.joinText ? new ScriptedJoinAgent(this.start, cast.joinText) : new PolicyPersonaAgent(this.start, o.timeAware ? { timeAware: true } : undefined);
    this.takeover = new TakeoverAgent(persona, this.start, () => { this.store.clock.waitingForPlayer = true; this.push(); });
    this.records = [];
    this.judgeHour = -1; this.healthHour = -1;
    this.recent = []; this.optOutAt.clear(); this.inviters.clear(); this.guardFallback.clear(); this.configHistory = [];
    this.consent = o.network === "consent" ? new ConsentNetwork({
      seed: o.seed, review: o.review, ...(o.engine === "off" ? { maxNewPerDay: 0 } : {}), ...(matchingAllowed(this.app) ? {} : { matchingEnabled: false }),
      onEngineRun: (log, proposals, at) => {
        const sum = summarizeRun(log, proposals, { at, city: "nyc", wallMs: Math.round(log.timingsMs.total ?? 0) });
        this.store.addRun(sum);
        this.store.pushFeed({ t: at, kind: "engine", text: `engine-v1 · NYC: ${proposals.length} candidates proposed from ${sum.funnel.generated}; the Network gates them (skeptical) and checks availability first` });
      },
    }) : undefined;
    this.engine = o.engine === "engine-v1" && !this.consent
      ? new CapturingEngine(s => {
        this.store.addRun(s);
        this.store.clock.busy = undefined;
        const names = Object.entries(s.proposalsByGenerator).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g, n]) => `${g.replace(/_/g, " ")} ${n}`).join(", ");
        this.store.pushFeed({ t: s.at, kind: "engine", text: `engine-v1 · ${s.city?.toUpperCase()}: ${s.proposals} proposals from ${s.funnel.generated} candidates (${names || "none"})` });
      }, city => { this.store.clock.busy = `engine-v1 · ${city?.toUpperCase() ?? "all"}`; })
      : undefined;
    this.projector = new Projector(this.store, {
      joinState: id => (this.personas.get(id)?.archetype === "busy_parent" ? "quiet" : "normal"),
      runOf: pid => this.engine?.runOf.get(pid),
      quietReview: () => this.consent?.reviewMode() !== "human",
      onOpp: (opp, rec) => {
        if (rec.type === "proposal" && opp.source === "player" && opp.oracle?.unsafe && !this.strikeIds.has(opp.id)) {
          this.strikeIds.add(opp.id);
          this.store.pushFeed({ t: rec.t, kind: "game", text: `Safety strike ${this.strikeIds.size}/${MAX_STRIKES}: ${opp.oracle.flags.join(", ") || "unsafe"} (${POINTS.unsafe} pts)`, members: opp.participants, opportunityId: opp.id, severity: "bad" });
          if (this.strikeIds.size >= MAX_STRIKES) { this.store.clock.playing = false; this.store.pushFeed({ t: rec.t, kind: "game", text: "Game over: three safety strikes. Reset to play again.", severity: "bad" }); }
        }
      },
    });
    this.world = new World({
      seed: o.seed, personas, days: o.days, start: this.start, writeLog: false, ...(o.timeAware ? { timeAware: true } : {}),
      network: this.consent ?? new StubNetwork({ seed: o.seed, randomIntros: o.engine === "random" }),
      engine: this.engine, agent: this.takeover,
      spawnFriend: joinGate(friendFactory({ seed: o.seed, ...(cast?.badInvitees ? { joinRate: 1, badActorRate: 1 } : {}) }), minAge),
      actions: cast?.actions,
      onRecord: r => this.onRecord(r),
    });
    this.store.truth = Object.fromEntries(personas.map(p => [p.id, truthOf(p)]));
    await this.world.begin();
    this.store.pushFeed({ t: this.start, kind: "game", text: `World ready: ${personas.length} members, ${this.store.edges.size} known connections. Press play.` });
    this.refreshGame();
    this.timers.push(setInterval(() => this.loop(), this.opts.tickMs));
    this.timers.push(setInterval(() => this.push(), this.opts.pushMs));
  }

  async dispose() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.store.clock.playing = false;
    await this.takeover?.releaseAll();
  }

  private onRecord(r: RunRecord) {
    this.records.push(r);
    if (r.type === "opt_out") this.optOutAt.set(r.memberId, r.t);
    else if (r.type === "network_log") {
      const d = r.detail as Record<string, any>;
      if (r.kind === "send_refused") this.recent.push({ t: r.t, key: `send_refused:${d.reason}` });
      else if (r.kind === "guard_blocked") { this.recent.push({ t: r.t, key: "guard_blocked" }); if (d.fallback) this.guardFallback.add(`${d.memberId}@${r.t}`); }
      else if (r.kind === "review_expired") this.recent.push({ t: r.t, key: "review_expired" });
      else if (r.kind === "invite" && d.from) this.inviters.add(d.from);
    }
    if (r.type === "persona" && !this.store.member(r.persona.id)) this.addSpawned(r.persona.id);
    this.projector.apply(r);
  }

  /** A member who joined mid-run (an invited friend): add them to the view and the graph. */
  private addSpawned(id: MemberId) {
    const p = this.world.personaList().find(x => x.id === id);
    if (!p) return;
    this.personas.set(p.id, p);
    this.store.upsertMember({
      id: p.id, name: p.name, city: p.homeCity, area: p.routine.homeArea, state: "not_joined", joined: false, minor: p.public.claimedAge < 18,
      age: p.public.claimedAge, invitedBy: p.invitedBy, community: p.invitedBy ? this.store.member(p.invitedBy)?.community : `${p.homeCity}:${p.routine.homeArea}`,
      counters: emptyCounters(),
    });
    if (p.invitedBy) this.store.addEdge({ from: p.invitedBy, to: p.id, type: "invited_by", strength: 0.7, createdAt: this.world.clock.now(), origin: "learned" });
    if (this.store.truth) this.store.truth[p.id] = truthOf(p);
  }

  /** Consent-network internals for the UI (the ladder, requests, trust, growth). */
  networkInfo(): NetworkInfo | undefined {
    const n = this.consent;
    if (!n) return undefined;
    const reqs = n.requests;
    const trusts = [...n.trust.all().values()];
    const sc = this.opts.scenario ? SCENARIOS.find(x => x.id === this.opts.scenario) : undefined;
    return {
      kind: "consent", counters: { ...n.counters }, gateReasons: { ...n.gateReasons },
      review: { mode: n.reviewMode(), queued: n.reviewQueue().length, approved: n.counters.reviewApproved, rejected: n.counters.reviewRejected, expired: n.counters.reviewExpired },
      requests: {
        total: reqs.filter(r => r.kind === "people").length, fulfilled: reqs.filter(r => r.outcome === "fulfilled").length,
        probing: reqs.filter(r => r.outcome === "probing").length, waiting: reqs.filter(r => r.kind === "people" && r.outcome === "none").length,
        plans: reqs.filter(r => r.kind === "plans").length,
      },
      trust: { watch: trusts.filter(t => t.level === "watch").length, hold: trusts.filter(t => t.level === "hold").length },
      scenario: sc ? { id: sc.id, title: sc.title, description: sc.description } : undefined,
      matchingEnabled: n.matchingEnabled(),
    };
  }

  /** Member requests, newest first: what was asked for, never the member's words. */
  requestList(): ObsRequest[] {
    const n = this.consent;
    if (!n) return [];
    const now = this.world.clock.now();
    return n.requests.map((r): ObsRequest => ({
      id: r.id, memberId: r.memberId, kind: r.kind, category: r.category, label: requestLabel(r), outcome: r.outcome ?? "open", tries: r.tries ?? 0,
      openedAt: r.at, ageHours: hours(now - r.at),
      ...(r.fulfilledAt !== undefined ? { fulfilledAt: r.fulfilledAt, hoursToFulfil: hours(r.fulfilledAt - r.at) } : {}),
      ...(r.oppId ? { opportunityId: r.oppId } : {}),
    })).reverse();
  }

  /**
   * Health alerts, the scorecard and growth, at most once per sim hour and every 2 s of wall time
   * while playing (the scorecard is a pass over every message).
   */
  private updateHealth(live = false) {
    if (!this.world) return;
    const now = this.world.clock.now();
    const hour = Math.floor(now / HOUR);
    if (hour === this.healthHour) return;
    if (live && performance.now() - this.healthWall < 2000) return;
    this.healthHour = hour; this.healthWall = performance.now();
    this.recent = this.recent.filter(x => now - x.t <= ALERT_WINDOW);
    const n = this.consent;
    const requests = this.requestList();
    this.store.setRequests(requests);
    const opps = [...this.store.opps.values()];
    const refusals: Record<string, number> = {};
    for (const x of this.recent) if (x.key.startsWith("send_refused:")) { const k = x.key.slice(13); refusals[k] = (refusals[k] ?? 0) + 1; }
    const judge = this.store.judge;
    const last = this.store.runs.filter(r => !r.shadow).at(-1);
    const alerts = healthAlerts({
      now, start: this.start, reviewOpen: n?.reviewQueue() ?? [], sla: { app: this.app, hours: slaHours()[this.app] }, matchingLocked: !matchingAllowed(this.app), reviewExpired: this.recent.filter(x => x.key === "review_expired").length,
      deferred: n ? n.exportState().deferred.length : null, refusals, guardBlocked: this.recent.filter(x => x.key === "guard_blocked").length,
      lastEngineRun: last?.at, expectEngine: !!n || this.opts.engine === "engine-v1", matchingEnabled: n?.matchingEnabled() ?? true,
      invariants: judge?.invariants ?? null, canaryLeaks: judge?.canaryLeaks ?? null, minorContacts: judge?.minorContacts ?? null,
    });
    const members = [...this.store.members.values()];
    const c = this.store.counts;
    const card = scorecard({
      now, start: this.start, members, opps, requests, optOutAt: this.optOutAt, invites: c.invites, accepts: c.accepts,
      messages: this.world.channel.all().filter(m => !m.system).map(m => ({ memberId: m.memberId, ts: m.ts, direction: m.direction, proactive: !!m.meta?.proactive, status: m.status })),
      reviewSeconds: opps.reduce((a, o) => a + (o.review?.secondsSpent ?? 0), 0),
      sentProposals: opps.filter(o => o.review?.decision === "approve" && !o.review.invalidated && o.review.reviewer !== SIM_AUTO_REVIEWER).length,
      inviters: this.inviters.size, minorContacts: judge?.minorContacts ?? null, leaks: judge?.canaryLeaks ?? null,
    });
    const growth = growthStats({
      members, opps, requests, invitees: n?.invitedIds ?? new Set(), invitesSent: n?.counters.invitesSent ?? 0, growthAsks: n?.counters.growthAsks ?? 0, inviters: this.inviters.size,
    });
    this.store.setHealth({ alerts, scorecard: card, growth });
  }

  // ------------------------------------------------------------------ time
  private loop() {
    const c = this.store.clock;
    if (!c.playing || this.advancing || this.over()) return;
    if (c.end && c.now >= c.end) { c.playing = false; this.store.pushFeed({ t: c.now, kind: "game", text: "End of the simulated period." }); return; }
    this.advance(c.now + c.speed * (this.opts.tickMs / 1000));
  }

  private advance(target: number): Promise<void> {
    const run = (async () => {
      await this.world.advanceTo(target);
      this.syncClock();
    })();
    this.advancing = run.finally(() => { this.advancing = null; });
    return this.advancing;
  }

  private syncClock() {
    const c = this.store.clock;
    c.now = this.world.clock.now();
    c.day = Math.floor((c.now - this.start) / DAY) + 1;
    c.waitingForPlayer = this.takeover.waiting;
  }

  private over() { return this.strikeIds.size >= MAX_STRIKES; }

  /**
   * The judge scorer over every record so far (invariants, canary leaks, minor contacts), at most
   * once per sim hour: it is a full pass over the run log.
   */
  private updateJudge(live = false) {
    if (!this.world) return;
    const now = this.world.clock.now();
    const hour = Math.floor(now / HOUR);
    if (hour === this.judgeHour) return;
    // About 120 ms per 30 sim days of records: while playing, deltas refresh it every 2 s at most.
    if (live && performance.now() - this.judgeWall < 2000) return;
    this.judgeHour = hour;
    this.judgeWall = performance.now();
    const m = computeMetrics(this.records, this.consent ? { requireReview: true } : {});
    this.store.judge = { invariants: m.invariants.total, canaryLeaks: m.privacy.canaryLeaks, minorContacts: m.safety.minorContacts, byRule: m.invariants.byRule, at: now };
  }

  /**
   * Wait until no advance (a step or the play loop) is running. A staff action that arrives during a
   * step runs after it, on the state the step produced, never in the middle of a Network tick (the tick
   * awaits the engine run, and a decision there landed at a sim time nobody saw). The reply then
   * matches what the next delta shows.
   */
  private async idle() {
    // Not while the world waits for the player's reply as a member they control (it would never end).
    while (this.advancing && !this.takeover.waiting) await Promise.race([this.advancing, Bun.sleep(50)]);
  }

  /** Process events due now (e.g. a player action) without moving time, if the world is idle. */
  private async settle() {
    if (this.advancing) return;
    await this.advance(this.world.clock.now());
  }

  // ------------------------------------------------------------------ state
  state(opts: ViewOptions = {}): ObsState {
    this.syncClock();
    this.updateJudge();
    this.updateHealth();
    const s = this.store.snapshot(this.refreshGame());
    s.network = this.networkInfo();
    if (!opts.truth) delete s.truth;
    return s;
  }

  subscribe(fn: (d: ObsDelta) => void) { return this.listeners.add(fn); }

  private push() {
    if (!this.store) return;
    this.syncClock();
    this.updateJudge(true);
    this.updateHealth(true);
    const game = this.refreshGame();
    const d = this.store.takeDelta(game);
    // The Network panel only when it changed (a delta without changes is a clock tick).
    const net = this.networkInfo(), json = JSON.stringify(net ?? null);
    if (json !== this.lastNetwork || this.pendingReset) { d.network = net; this.lastNetwork = json; }
    if (this.pendingReset) { d.reset = true; this.pendingReset = false; }
    this.listeners.emit(d);
  }

  private dayIndex() { return Math.floor((this.world.clock.now() - this.start) / DAY); }

  private refreshGame(): GameState {
    const scores = scoreboard(this.store.opps.values(), this.extraPoints);
    const now = this.world?.clock.now() ?? this.start;
    this.missions = evaluateMissions(this.store.opps.values(), {
      now, start: this.start, scores,
      community: id => this.store.member(id)?.community,
      newcomer: id => { const j = this.profiles.get(id)?.datasetJoinedAt; return j !== undefined ? this.start - j <= NEWCOMER_DAYS * DAY : (this.personas.get(id)?.joinDay ?? 0) > 0; },
    }, this.missions);
    return {
      sparksLeft: Math.max(0, this.opts.sparksPerDay - (this.sparksUsed.get(this.dayIndex()) ?? 0)), sparksPerDay: this.opts.sparksPerDay,
      strikes: this.strikeIds.size, maxStrikes: MAX_STRIKES, over: this.over(), lensUsed: this.lensUsed, peeks: this.peeks,
      engine: this.opts.engine, scores, missions: this.missions, prompts: this.takeover?.prompts() ?? [],
      controlled: [...(this.takeover?.controlled ?? [])],
    };
  }

  // ------------------------------------------------------------------ detail views
  async member(id: string, opts: ViewOptions = {}): Promise<MemberDetail | undefined> {
    const lens = !!opts.truth;
    const m = this.store.member(id);
    const p = this.personas.get(id);
    if (!m || !p) return undefined;
    const snap = this.world.snapshot();
    const prof = this.profiles.get(id);
    const detail: MemberDetail = {
      member: m,
      profile: { bio: prof?.bio ?? p.public.bio, occupation: prof?.occupation, neighborhood: prof?.neighborhood ?? p.routine.homeArea, pronouns: prof?.pronouns, availability: prof?.availability },
      // Agent-private facets (private disclosures and their canaries) only under the truth lens.
      facets: memberFacets(this.app, snap.facets.filter(f => f.memberId === id), lens || !!opts.reveal).map(f => (lens || f.scope !== "agent_private" ? f : { ...f, value: "[private]", tags: [] })),
      intents: snap.intents.filter(i => i.memberId === id),
      presence: snap.presence.filter(x => x.memberId === id),
      edges: [...this.store.edges.values()].filter(e => e.from === id || e.to === id),
      opportunities: [...this.store.opps.values()].filter(o => o.participants.includes(id)).sort((a, b) => b.createdAt - a.createdAt),
      messages: this.world.channel.messagesFor(id).map(x => this.obsMessage(x)),
    };
    if (lens) {
      detail.truth = this.store.truth?.[id];
      const mem = this.world.memories.get(id);
      if (mem) detail.memory = Object.fromEntries(Object.entries(mem.proposals).map(([k, v]) => [k, { decision: v.decision, plannedShow: v.plannedShow, enjoyment: v.enjoyment }]));
    }
    return detail;
  }

  async opportunity(id: string, opts: ViewOptions = {}): Promise<OpportunityDetail | undefined> {
    const o = this.store.opps.get(id);
    if (!o) return undefined;
    const messages: OpportunityDetail["messages"] = [];
    for (const mid of o.participants) {
      const all = this.world.channel.messagesFor(mid);
      const related = all.filter(x => x.meta?.proposalId === id || x.meta?.probe?.key === id);
      const times = related.map(x => x.ts);
      for (const x of all) {
        const near = x.direction === "inbound" && times.some(t => x.ts >= t && x.ts - t <= 2 * DAY);
        if (x.meta?.proposalId === id || x.meta?.probe?.key === id || near) messages.push({ ...this.obsMessage(x), memberId: mid });
      }
    }
    messages.sort((a, b) => a.ts - b.ts);
    const opp = !opts.truth && !["COMPLETED", "FEEDBACK_COLLECTED", "ABANDONED"].includes(o.state) && !o.oracle?.unsafe ? { ...o, oracle: undefined } : o;
    const events: SystemEvent[] = [];
    for (const r of this.records) {
      const row = eventOf(r);
      if (row && (row.object_type === "opportunity" ? row.object_id === id : row.payload?.oppId === id)) events.push(describe(row, this.nameOf));
    }
    return {
      opportunity: opp, members: o.participants.map(x => this.store.member(x)!).filter(Boolean), messages,
      run: o.runId ? this.store.runs.find(r => r.id === o.runId) : undefined, events,
    };
  }

  private nameOf = (id: string) => this.store.member(id)?.name ?? id;

  /** A channel message for the console, with the leak check result for the consent Network's outbound texts. */
  private obsMessage(m: Parameters<typeof toObsMessage>[0] & { memberId: MemberId }): ObsMessage {
    const o = toObsMessage(m);
    if (this.consent && m.direction === "outbound" && !m.system) o.guard = this.guardFallback.has(`${m.memberId}@${m.ts}`) ? "fallback" : "passed";
    return o;
  }

  async timeline(id: string, _opts: ViewOptions = {}): Promise<MemberTimeline | undefined> {
    if (!this.store.member(id) || !this.personas.has(id)) return undefined;
    const theirs = new Set([...this.store.opps.values()].filter(o => o.participants.includes(id)).map(o => o.id));
    const current = new Map(this.world.channel.messagesFor(id).map(m => [m.id, m]));
    const entries: TimelineEntry[] = [];
    for (const r of this.records) {
      if (r.type === "message") {
        const m = r.msg.memberId === id ? current.get(r.msg.id) : undefined;
        if (m) { entries.push({ t: m.ts, kind: "message", message: this.obsMessage(m) }); current.delete(m.id); }
        continue;
      }
      const row = eventOf(r);
      if (row && onTimeline(row, id, theirs)) entries.push({ t: toMs(row.at), kind: "event", event: describe(row, this.nameOf) });
    }
    // Messages without a record (none expected) still show, in time order.
    for (const m of current.values()) entries.push({ t: m.ts, kind: "message", message: this.obsMessage(m) });
    entries.sort((a, b) => a.t - b.t);
    const pending = (this.consent?.exportState().deferred ?? []).filter(d => d.memberId === id)
      .map(d => ({ kind: d.kind, ...(d.meta.type ? { type: d.meta.type } : {}), ...(d.meta.proposalId ? { opportunityId: d.meta.proposalId } : {}) }));
    return { memberId: id, entries, pending };
  }

  inOpenReview(memberId: string): boolean {
    for (const o of this.store.opps.values()) if (o.state === "IN_REVIEW" && o.participants.includes(memberId)) return true;
    return false;
  }

  async safety(): Promise<SafetyInfo> {
    const n = this.consent;
    const trust = n ? [...n.trust.all()] : [];
    const cases = n?.safetyCases() ?? [], opps = [...this.store.opps.values()];
    return safetyInfo({
      now: this.world.clock.now(), cases, members: [...this.store.members.values()], opps,
      watch: trust.filter(([, t]) => t.level === "watch").map(([id]) => id), hold: trust.filter(([, t]) => t.level === "hold").map(([id]) => id), canAct: !!n,
      // Hold and ban by phone or person act on the platform's people: the simulated world has none.
      reports: reportsFromCases(cases, opps), canBan: false,
    });
  }

  async safetyAction(a: SafetyAction, actor: string): Promise<ControlResult> {
    await this.idle();
    const n = this.consent;
    if (!n) return { ok: false, error: "safety actions need the consent Network", code: "no_consent_network" };
    const note = a.note?.trim() || undefined;
    if (a.action !== "lift" && a.action !== "close") return { ok: false, error: SAFETY_ERRORS.service_only, code: "service_only" };
    const r = a.action === "lift" ? n.liftHold(String(a.memberId ?? ""), actor, note) : n.closeCase(String(a.caseId ?? ""), actor, note);
    if (!r.ok) return { ok: false, error: SAFETY_ERRORS[r.reason] ?? r.reason, code: r.reason };
    await this.settle();
    this.push();
    return { ok: true };
  }

  async config(): Promise<ConfigInfo> {
    const n = this.consent;
    // The Network's options are private; shown read-only (scalars only).
    const opts = n ? (n as unknown as { opts: Record<string, unknown> }).opts : {};
    const network = Object.fromEntries(Object.entries(opts).filter(([, v]) => v === null || ["number", "boolean", "string"].includes(typeof v))) as ConfigInfo["network"];
    return {
      matchingEnabled: n?.matchingEnabled() ?? true, reviewMode: n?.reviewMode() ?? null, network,
      outreach: JSON.parse(JSON.stringify(OUTREACH)), history: [...this.configHistory], canChange: !!n,
    };
  }

  private recordConfig(actor: string, key: ConfigChange["key"], from: ConfigChange["from"], to: ConfigChange["to"]) {
    this.configHistory.push({ version: this.configHistory.length + 1, at: this.world.clock.now(), actor, key, from, to });
  }

  async search(q: string, limit = 100): Promise<SearchHit[]> {
    const re = searchPattern(q);
    const hits: SearchHit[] = [];
    const name = (id: string) => this.store.member(id)?.name ?? id;
    for (const m of this.world.channel.all()) {
      if (hits.length >= limit) break;
      // Only what the agent sent; never what a member wrote.
      if (m.direction !== "outbound" || m.system || !re.test(m.body)) continue;
      hits.push({ memberId: m.memberId, memberName: name(m.memberId), t: m.ts, kind: "message", snippet: snippet(m.body, re), type: m.meta?.type, ...(m.meta?.proposalId ? { opportunityId: m.meta.proposalId } : {}) });
    }
    for (const r of this.records) {
      if (hits.length >= limit) break;
      const row = eventOf(r);
      if (!row) continue;
      const e = describe(row, name);
      if (!e.memberId || !(re.test(e.text) || re.test(e.type))) continue;
      hits.push({ memberId: e.memberId, memberName: name(e.memberId), t: e.t, kind: "event", snippet: e.text, type: e.type, ...(e.opportunityId ? { opportunityId: e.opportunityId } : {}) });
    }
    return hits.sort((a, b) => b.t - a.t);
  }

  // ------------------------------------------------------------------ controls
  async control(cmd: ControlCommand, actor?: string): Promise<ControlResult> {
    const c = this.store.clock;
    try {
      if (WAITS_FOR_WORLD.has(cmd.type)) await this.idle();
      switch (cmd.type) {
        case "play": if (this.over()) return { ok: false, error: "game over: reset to play again" }; c.playing = true; break;
        case "pause": c.playing = false; break;
        case "speed": c.speed = Math.max(MINUTE, Math.min(7 * DAY, cmd.speed)); break;
        case "step": {
          if (this.advancing) return { ok: false, error: this.takeover.waiting ? "waiting for your reply" : "the world is busy" };
          if (this.over()) return { ok: false, error: "game over: reset to play again" };
          c.playing = false;
          await this.advance(this.world.clock.now() + Math.max(MINUTE, cmd.ms));
          break;
        }
        case "propose": return this.propose(cmd);
        case "peek": return this.peek(cmd.participants);
        case "lens": {
          // The lens is per staff member (the server keeps who has it on and passes `truth` per request).
          // Here it only marks the player's score as assisted, and makes clients reload their state.
          if (cmd.on && !this.lensUsed) { this.lensUsed = true; this.store.pushFeed({ t: c.now, kind: "game", text: "Truth lens on: your score is now marked as assisted." }); }
          this.pendingReset = true;
          break;
        }
        case "takeover": {
          const m = this.store.member(cmd.memberId);
          if (!m) return { ok: false, error: "unknown member" };
          if (cmd.on) this.takeover.controlled.add(m.id);
          else {
            this.takeover.controlled.delete(m.id);
            for (const p of this.takeover.prompts().filter(x => x.memberId === m.id)) await this.takeover.answer(p.id, { auto: true });
          }
          m.controlled = cmd.on;
          this.store.upsertMember(m);
          this.store.pushFeed({ t: c.now, kind: "game", text: cmd.on ? `You are now playing ${m.name}. The world waits for you whenever the Network texts them.` : `You let go of ${m.name}.`, members: [m.id] });
          break;
        }
        case "reply": {
          const prompt = this.takeover.prompts().find(p => p.id === cmd.promptId);
          if (!prompt) return { ok: false, error: "that message was already answered" };
          const reply = await this.takeover.answer(cmd.promptId, { text: cmd.text, auto: cmd.auto });
          c.waitingForPlayer = this.takeover.waiting;
          return { ok: true, data: { intent: reply.intent, decision: reply.decision, text: reply.text } };
        }
        case "say": {
          if (!this.personas.has(cmd.memberId) || !cmd.text.trim()) return { ok: false, error: "need a member and some text" };
          this.world.act({ do: "say", persona: cmd.memberId, text: cmd.text.trim() });
          await this.settle();
          break;
        }
        case "god": {
          if (!this.personas.has(cmd.memberId)) return { ok: false, error: "unknown member" };
          if (cmd.action === "force_flake") this.world.act({ do: "force_flake", persona: cmd.memberId, how: "no_show" });
          else this.world.act({ do: cmd.action, persona: cmd.memberId });
          await this.settle();
          break;
        }
        case "reset": {
          await this.dispose();
          Object.assign(this.opts, {
            seed: cmd.seed ?? this.opts.seed, engine: cmd.engine ?? this.opts.engine,
            personas: cmd.personas ?? this.opts.personas, days: cmd.days ?? this.opts.days,
            network: cmd.network ?? this.opts.network, scenario: cmd.scenario === undefined ? this.opts.scenario : cmd.scenario,
          });
          this.sparksUsed.clear(); this.lensUsed = false; this.peeks = 0; this.extraPoints = {};
          this.missions = []; this.strikeIds.clear(); this.proposalSeq = 0;
          await this.init();
          this.pendingReset = true;
          break;
        }
        case "review": {
          if (!this.consent) return { ok: false, error: "review needs the consent Network", code: "no_consent_network" };
          if (!["approve", "reject", "edit", "reroll"].includes(cmd.decision)) return { ok: false, error: "decision must be approve, reject, edit or reroll", code: "unknown_decision" };
          if (cmd.reason && !REVIEW_REASONS.includes(cmd.reason)) return { ok: false, error: `unknown reason ${cmd.reason}`, code: "unknown_reason" };
          const note = cmd.note?.trim() || undefined;
          // The same rules as ConsentNetwork.decide() (which enforces them for every caller), checked
          // here first so the reviewer sees why. The view's own age flags are checked too.
          const opp = this.store.opps.get(cmd.oppId);
          const approving = cmd.decision === "approve" || cmd.decision === "edit";
          const young = approving ? opp?.participants.map(id => this.store.member(id)).find(m => m && (m.minor || m.declined)) : undefined;
          const why = young ? (young.declined ? "participant_declined" : "participant_minor") : this.consent.reviewBlock(cmd.oppId, cmd.decision, { reason: cmd.reason, note });
          if (why === "not_in_review") { this.push(); return { ok: false, error: notInReview(opp), code: why }; }
          if (why) return { ok: false, error: REVIEW_BLOCK_ERRORS[why] ?? why, code: why };
          const opts: ReviewOptions = { reason: cmd.reason, note, reviewer: actor ?? "player" };
          if (typeof cmd.secondsSpent === "number") opts.secondsSpent = cmd.secondsSpent;
          if (cmd.decision === "edit") { opts.explanations = cmd.explanations; opts.objective = cmd.objective; }
          if (cmd.decision === "reroll" && cmd.swapOut) opts.swapOut = cmd.swapOut;
          const r = this.consent.decide(cmd.oppId, cmd.decision, opts);
          await this.settle();
          this.push();
          // An approve that failed the re-check closed the item unsent: say why.
          if (!r.ok) return { ok: false, error: REVIEW_BLOCK_ERRORS[r.reason] ?? `not sent: ${r.reason.replace(/_/g, " ")}`, code: r.reason };
          return { ok: true, data: { decision: cmd.decision } };
        }
        case "review_mode": {
          if (!this.consent) return { ok: false, error: "review needs the consent Network" };
          if (cmd.mode !== "human" && cmd.mode !== "auto") return { ok: false, error: "review mode must be human or auto" };
          const from = this.consent.reviewMode();
          this.opts.review = cmd.mode;
          this.consent.setReviewMode(cmd.mode, actor ?? "player");
          if (from !== cmd.mode) this.recordConfig(actor ?? "player", "review_mode", from, cmd.mode);
          await this.settle();
          break;
        }
        case "matching": {
          if (!this.consent) return { ok: false, error: "the matching switch needs the consent Network", code: "no_consent_network" };
          if (typeof cmd.on !== "boolean") return { ok: false, error: "on must be true or false" };
          if (cmd.on && !matchingAllowed(this.app)) return { ok: false, error: `${this.app}: ${MATCHING_OFF_TEXT}`, code: "matching_locked" };
          const from = this.consent.matchingEnabled();
          this.consent.setMatchingEnabled(cmd.on, actor ?? "player");
          if (from !== cmd.on) this.recordConfig(actor ?? "player", "matching", from, cmd.on);
          await this.settle();
          break;
        }
        case "check_scenario": {
          const sc = this.opts.scenario ? SCENARIOS.find(x => x.id === this.opts.scenario) : undefined;
          if (!sc || !this.consent) return { ok: false, error: "no level is loaded (reset with a scenario)" };
          const checks = sc.check({ world: this.world, net: this.consent, records: this.records, start: this.start, ids: this.scenarioIds });
          return { ok: true, data: { scenario: sc.id, pass: checks.every(c => c.pass), checks } };
        }
        case "refresh": break;
        default: return { ok: false, error: `${cmd.type} is not available in game mode` };
      }
      this.push();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  }

  private async propose(cmd: Extract<ControlCommand, { type: "propose" }>): Promise<ControlResult> {
    const now = this.world.clock.now();
    if (this.over()) return { ok: false, error: "game over: reset to play again" };
    const ids = [...new Set(cmd.participants)];
    if (ids.length < 2 || ids.length > 6) return { ok: false, error: "pick 2 people for an intro, or 3-6 for a group" };
    const ms = ids.map(id => this.store.member(id));
    if (ms.some(m => !m)) return { ok: false, error: "unknown member" };
    if (ms.some(m => !m!.joined)) return { ok: false, error: "everyone needs to have joined the Network first" };
    // Members under 18 (and anyone declined at join) are never introduced: refuse before anything is sent.
    const young = ms.find(m => m!.minor || m!.declined || this.consent?.isDeclined(m!.id));
    if (young) return { ok: false, error: `${young.name} ${young.declined || this.consent?.isDeclined(young.id) ? "was declined at join (under 13)" : "is under 18"}: members under 18 are never introduced to anyone` };
    const day = this.dayIndex();
    const used = this.sparksUsed.get(day) ?? 0;
    if (used >= this.opts.sparksPerDay) return { ok: false, error: `no sparks left today (${this.opts.sparksPerDay} per sim day)` };
    this.sparksUsed.set(day, used + 1);
    const group = ids.length > 2;
    const why = cmd.why?.trim() || (group ? "it felt like the right mix of people" : "I have a feeling you two would get along");
    const p: Proposal = {
      id: `player-${this.opts.seed}-${++this.proposalSeq}`, kind: group ? "group" : "intro", participants: ids, alternates: [],
      objective: cmd.objective?.trim() || (group ? "small group meetup" : "one-to-one intro"), category: cmd.category ?? "social",
      city: ms[0]!.city, window: { start: now + DAY, end: now + 5 * DAY }, score: 0, components: ZERO, exploration: false,
      explanations: Object.fromEntries(ids.map(id => [id, why])), generator: "player", createdAt: now,
    };
    this.world.act({ do: "propose", proposal: p, source: "player" });
    await this.settle();
    this.push();
    // A composed intro waits for review like every other opportunity (PRD 32.8).
    const dispatch = this.consent?.reviewMode() === "human" ? "joins the review queue with the next morning batch (approve it in the Review tab)" : "goes out with the next morning batch (10am local)";
    return { ok: true, data: { id: p.id, dispatch } };
  }

  private peek(participants: MemberId[]): ControlResult {
    const ids = [...new Set(participants)];
    if (ids.length < 2) return { ok: false, error: "pick at least two people" };
    const first = this.personas.get(ids[0]!);
    if (!first) return { ok: false, error: "unknown member" };
    const now = this.world.clock.now();
    const v = this.world.oracle.evaluate({ id: `peek-${++this.peeks}`, kind: ids.length > 2 ? "group" : "intro", participants: ids, city: first.homeCity, window: { start: now + DAY, end: now + 5 * DAY } });
    this.extraPoints.player = (this.extraPoints.player ?? 0) + POINTS.peek;
    this.store.pushFeed({ t: now, kind: "game", text: `Oracle peek (${POINTS.peek} pts): ${ids.map(id => this.store.member(id)?.name.split(" ")[0]).join(" & ")} → ${v.compatible ? "compatible" : "not a fit"}, quality ${(v.quality * 100).toFixed(0)}%`, members: ids });
    this.push();
    return { ok: true, data: { compatible: v.compatible, unsafe: v.unsafe, quality: v.quality, flags: v.flags, participants: v.participants } };
  }

  /** Cities present (for the UI). */
  cities(): City[] { return [...new Set([...this.personas.values()].map(p => p.homeCity))]; }
}

/** Commands that change the world or the Network: they wait for a running step (idle()). Clock controls and reads do not. */
const WAITS_FOR_WORLD = new Set<ControlCommand["type"]>(["review", "review_mode", "matching", "propose", "say", "god", "check_scenario"]);

/** Why an item is no longer waiting for review, from what the console shows now. */
function notInReview(o: ObsOpportunity | undefined): string {
  if (!o) return REVIEW_BLOCK_ERRORS.not_in_review!;
  const rv = o.review;
  if (rv?.decision === "expired") return "that opportunity expired in review (SLA missed) and was never sent";
  if (rv?.decision) return `that opportunity was already ${rv.decision === "approve" ? "approved" : "rejected"}${rv.reviewer ? ` by ${rv.reviewer}` : ""}`;
  return `that opportunity is no longer waiting for review (${o.state.toLowerCase().replace(/_/g, " ")}${o.reason ? `: ${o.reason}` : ""})`;
}

function toObsMessage(m: { id: string; ts: number; direction: "inbound" | "outbound"; body: string; status: string; system?: boolean; meta?: Record<string, unknown> }): ObsMessage {
  const times = m.meta?.timeOptions as { key: string; label: string; start: number }[] | undefined;
  const booked = m.meta?.booked as { at: number; optOutHours: number } | undefined;
  return {
    id: m.id, ts: m.ts, direction: m.direction, body: m.body, status: m.status, system: m.system,
    type: m.meta?.type as string | undefined, proposalId: (m.meta?.proposalId ?? (m.meta?.probe as { key?: string } | undefined)?.key) as string | undefined, proactive: m.meta?.proactive as boolean | undefined,
    ...(times?.length ? { timeOptions: times.map(x => ({ key: x.key, label: x.label, start: x.start })) } : {}),
    ...(booked ? { booked: { at: booked.at, optOutHours: booked.optOutHours } } : {}),
  };
}

export function truthOf(p: Persona): MemberTruth {
  const h = p.hidden;
  return {
    archetype: p.archetype, adversarial: h.adversarial, trueAge: h.trueAge, socialEnergy: h.socialEnergy, flakiness: h.flakiness,
    capacity: h.capacity, honesty: h.honesty, openness: h.openness, romanceOptIn: h.romance.optIn,
    desires: h.desires.map(d => ({ text: d.text, category: d.category, strength: d.strength })),
    interests: h.interests, skills: h.skills, boundaries: h.boundaries, privateFact: h.privateDisclosure?.fact, trips: h.trips,
  };
}

/** A friend spawner that refuses anyone under the app's join age (the platform's join gate). */
function joinGate<F extends (...a: any[]) => { persona: Persona } | undefined>(f: F, minAge: number): F {
  return ((...a: Parameters<F>) => { const r = f(...a); return r && r.persona.public.claimedAge >= minAge ? r : undefined; }) as F;
}
