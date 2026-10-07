// Game mode: a live simulated world (packages/sim) with engine-v1, made steppable and playable.
// The player can play the Network (propose intros), play a member (take over a persona) or play
// god (scenario actions). Everything flows through the same StubNetwork pipeline and is scored
// against the oracle's hidden ground truth.
import { DAY, HOUR, MINUTE, type City, type MemberId, type Proposal, type ScoreComponents } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import {
  DEFAULT_START, generatePersonas, PolicyPersonaAgent, StubNetwork, World, type Persona,
} from "@thenetwork/sim";
import { loadPersonas } from "../../../../scripts/synthetic/load.ts";
import { DATA_DIR, readJsonl, type EdgeRecord, type HiddenTruthRecord, type MemberRecord } from "../../../../scripts/synthetic/common.ts";
import { CapturingEngine, summarizeRun } from "../engineCapture.ts";
import { ConsentNetwork, friendFactory } from "@thenetwork/network";
import { SCENARIOS } from "../../../network/src/scenarios.ts";
import { Projector } from "../projector.ts";
import { evaluateMissions, POINTS, scoreboard } from "../scoring.ts";
import { emptyCounters, Store } from "../store.ts";
import { TakeoverAgent } from "../takeover.ts";
import type {
  ClockInfo, ControlCommand, ControlResult, GameState, MemberDetail, MemberTruth, Mission, NetworkInfo, ObsDelta, ObsMember,
  ObsMessage, ObsState, OpportunityDetail,
} from "../types.ts";
import { Listeners, type DataSource } from "./source.ts";

export interface GameOptions {
  seed?: number;
  /** Simulated days available (default 60). */
  days?: number;
  engine?: GameState["engine"];
  /** The Network under test: "consent" (packages/network, default) or the old "stub". */
  network?: "consent" | "stub";
  /** "nyc" (default; the launch city) or "all" (SF + NYC). */
  city?: "nyc" | "all";
  /** NYC scenario id (packages/network/src/scenarios.ts) to play as a level. */
  scenario?: string | null;
  /** 0 (default) = the 500-member synthetic dataset v1; N > 0 = a generated world of N personas. */
  personas?: number;
  dataDir?: string;
  sparksPerDay?: number;
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
  private lens = false;
  private lensUsed = false;
  private peeks = 0;
  private extraPoints: Record<string, number> = {};
  private missions: Mission[] = [];
  private strikeIds = new Set<string>();
  private proposalSeq = 0;
  private pendingReset = false;
  private opts: Required<Omit<GameOptions, "dataDir" | "scenario">> & { dataDir: string; scenario: string | null };
  consent?: ConsentNetwork;
  private records: RunRecord[] = [];
  private scenarioIds: Record<string, MemberId> = {};

  constructor(opts: GameOptions = {}) {
    this.opts = {
      seed: opts.seed ?? 1, days: opts.days ?? 60, engine: opts.engine ?? "engine-v1", personas: opts.personas ?? 0,
      dataDir: opts.dataDir ?? DATA_DIR, sparksPerDay: opts.sparksPerDay ?? 6, pushMs: opts.pushMs ?? 250, tickMs: opts.tickMs ?? 100,
      network: opts.network ?? "consent", city: opts.city ?? "nyc", scenario: opts.scenario ?? null,
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
    for (const p of personas) this.personas.set(p.id, p);

    const clock: ClockInfo = { now: this.start, start: this.start, end: this.start + o.days * DAY, day: 1, playing: false, speed: SPEEDS.sixHours, waitingForPlayer: false };
    this.store = new Store({
      mode: "game", label: `SIMULATION · seed ${o.seed} · ${synthetic ? `synthetic v1 (${personas.length} ${o.city === "nyc" ? "NYC" : "SF/NYC"})` : `${o.personas} generated personas`} · ${o.network === "consent" ? "consent-first Network" : "stub Network"}${o.scenario ? ` · level: ${o.scenario}` : ""}`,
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

    this.takeover = new TakeoverAgent(new PolicyPersonaAgent(this.start), this.start, () => { this.store.clock.waitingForPlayer = true; this.push(); });
    const scenario = o.scenario ? SCENARIOS.find(x => x.id === o.scenario) : undefined;
    const cast = scenario?.setup(personas, this.start);
    this.scenarioIds = cast?.ids ?? {};
    this.records = [];
    this.consent = o.network === "consent" ? new ConsentNetwork({
      seed: o.seed, ...(o.engine === "off" ? { maxNewPerDay: 0 } : {}),
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
      onOpp: (opp, rec) => {
        if (rec.type === "proposal" && opp.source === "player" && opp.oracle?.unsafe && !this.strikeIds.has(opp.id)) {
          this.strikeIds.add(opp.id);
          this.store.pushFeed({ t: rec.t, kind: "game", text: `Safety strike ${this.strikeIds.size}/${MAX_STRIKES}: ${opp.oracle.flags.join(", ") || "unsafe"} (${POINTS.unsafe} pts)`, members: opp.participants, opportunityId: opp.id, severity: "bad" });
          if (this.strikeIds.size >= MAX_STRIKES) { this.store.clock.playing = false; this.store.pushFeed({ t: rec.t, kind: "game", text: "Game over: three safety strikes. Reset to play again.", severity: "bad" }); }
        }
      },
    });
    this.world = new World({
      seed: o.seed, personas, days: o.days, start: this.start, writeLog: false,
      network: this.consent ?? new StubNetwork({ seed: o.seed, randomIntros: o.engine === "random" }),
      engine: this.engine, agent: this.takeover,
      spawnFriend: friendFactory({ seed: o.seed, ...(cast?.badInvitees ? { joinRate: 1, badActorRate: 1 } : {}) }),
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
      requests: {
        total: reqs.filter(r => r.kind === "people").length, fulfilled: reqs.filter(r => r.outcome === "fulfilled").length,
        probing: reqs.filter(r => r.outcome === "probing").length, waiting: reqs.filter(r => r.kind === "people" && r.outcome === "none").length,
        plans: reqs.filter(r => r.kind === "plans").length,
      },
      trust: { watch: trusts.filter(t => t.level === "watch").length, hold: trusts.filter(t => t.level === "hold").length },
      scenario: sc ? { id: sc.id, title: sc.title, description: sc.description } : undefined,
    };
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

  /** Process events due now (e.g. a player action) without moving time, if the world is idle. */
  private async settle() {
    if (this.advancing) return;
    await this.advance(this.world.clock.now());
  }

  // ------------------------------------------------------------------ state
  state(): ObsState {
    this.syncClock();
    const s = this.store.snapshot(this.refreshGame());
    s.network = this.networkInfo();
    if (!this.lens) delete s.truth;
    return s;
  }

  subscribe(fn: (d: ObsDelta) => void) { return this.listeners.add(fn); }

  private push() {
    if (!this.store) return;
    this.syncClock();
    const game = this.refreshGame();
    const d = this.store.takeDelta(game);
    d.network = this.networkInfo();
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
  async member(id: string): Promise<MemberDetail | undefined> {
    const m = this.store.member(id);
    const p = this.personas.get(id);
    if (!m || !p) return undefined;
    const snap = this.world.snapshot();
    const prof = this.profiles.get(id);
    const detail: MemberDetail = {
      member: m,
      profile: { bio: prof?.bio ?? p.public.bio, occupation: prof?.occupation, neighborhood: prof?.neighborhood ?? p.routine.homeArea, pronouns: prof?.pronouns, availability: prof?.availability },
      facets: snap.facets.filter(f => f.memberId === id),
      intents: snap.intents.filter(i => i.memberId === id),
      presence: snap.presence.filter(x => x.memberId === id),
      edges: [...this.store.edges.values()].filter(e => e.from === id || e.to === id),
      opportunities: [...this.store.opps.values()].filter(o => o.participants.includes(id)).sort((a, b) => b.createdAt - a.createdAt),
      messages: this.world.channel.messagesFor(id).map(toObsMessage),
    };
    if (this.lens) {
      detail.truth = this.store.truth?.[id];
      const mem = this.world.memories.get(id);
      if (mem) detail.memory = Object.fromEntries(Object.entries(mem.proposals).map(([k, v]) => [k, { decision: v.decision, plannedShow: v.plannedShow, enjoyment: v.enjoyment }]));
    }
    return detail;
  }

  async opportunity(id: string): Promise<OpportunityDetail | undefined> {
    const o = this.store.opps.get(id);
    if (!o) return undefined;
    const messages: OpportunityDetail["messages"] = [];
    for (const mid of o.participants) {
      const all = this.world.channel.messagesFor(mid);
      const related = all.filter(x => x.meta?.proposalId === id);
      const times = related.map(x => x.ts);
      for (const x of all) {
        const near = x.direction === "inbound" && times.some(t => x.ts >= t && x.ts - t <= 2 * DAY);
        if (x.meta?.proposalId === id || near) messages.push({ ...toObsMessage(x), memberId: mid });
      }
    }
    messages.sort((a, b) => a.ts - b.ts);
    const opp = !this.lens && !["COMPLETED", "FEEDBACK_COLLECTED", "ABANDONED"].includes(o.state) && !o.oracle?.unsafe ? { ...o, oracle: undefined } : o;
    return {
      opportunity: opp, members: o.participants.map(x => this.store.member(x)!).filter(Boolean), messages,
      run: o.runId ? this.store.runs.find(r => r.id === o.runId) : undefined,
    };
  }

  // ------------------------------------------------------------------ controls
  async control(cmd: ControlCommand): Promise<ControlResult> {
    const c = this.store.clock;
    try {
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
          this.lens = cmd.on;
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
          this.sparksUsed.clear(); this.lens = false; this.lensUsed = false; this.peeks = 0; this.extraPoints = {};
          this.missions = []; this.strikeIds.clear(); this.proposalSeq = 0;
          await this.init();
          this.pendingReset = true;
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
    return { ok: true, data: { id: p.id, dispatch: "goes out with the next morning batch (10am local)" } };
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

function toObsMessage(m: { id: string; ts: number; direction: "inbound" | "outbound"; body: string; status: string; system?: boolean; meta?: Record<string, unknown> }): ObsMessage {
  return {
    id: m.id, ts: m.ts, direction: m.direction, body: m.body, status: m.status, system: m.system,
    type: m.meta?.type as string | undefined, proposalId: m.meta?.proposalId as string | undefined, proactive: m.meta?.proactive as boolean | undefined,
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
