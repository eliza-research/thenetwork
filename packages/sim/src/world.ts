// The Network World Simulator runner (PRD 34.3). A discrete-event loop over a SimClock that
// drives a NetworkUnderTest through the simulated channel, lets persona agents live by
// their routines and reply latencies, decides meeting outcomes from hidden truth, and writes
// a replayable JSONL run log to runs/<runId>/.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DAY, HOUR, MINUTE, SimClock, type AppId, type MemberId, type Proposal } from "@thenetwork/core";
import type { OracleSummary, RunRecord, RunRecordInput } from "@thenetwork/core";
import { computeMetrics, type Metrics } from "./judge/metrics.ts";
import { PolicyPersonaAgent, templateText, timeConflict, type PolicyOptions } from "./agent/policy.ts";
import { newMemory, type PersonaAgent, type PersonaContext, type PersonaMemory } from "./agent/types.ts";
import { SimChannel, type Reaction, type SimMessage } from "./channel.ts";
import type { Engine, InboundMessage, MeetingReport, NetworkContext, NetworkUnderTest } from "./network.ts";
import { Oracle, type OracleOptions, type OracleVerdict } from "./oracle.ts";
import type { Persona } from "./persona.ts";
import { Rng, hash32 } from "@thenetwork/core";
import { Scheduler, type RunMode } from "./scheduler.ts";
import { buildSnapshot, quietHoursOf } from "./snapshot.ts";
import { nextLocalHour } from "./time.ts";
import { planEnjoyment, type PlanAgentOptions } from "./plans.ts";

/** A scripted world action (compiled from a scenario file). */
export type WorldAction =
  | { do: "join"; persona: MemberId }
  | { do: "go_silent"; persona: MemberId }
  | { do: "force_flake"; persona: MemberId; how: "notice" | "no_show" }
  | { do: "say"; persona: MemberId; text: string }
  /** source "player": a human playing the Network in the observatory (counted like Network output). */
  | { do: "propose"; proposal: Proposal; source?: "scenario" | "player" }
  | { do: "opt_out"; persona: MemberId };

export interface WorldOptions {
  seed: number | string;
  personas: Persona[];
  days: number;
  network: NetworkUnderTest;
  /** Optional matching engine; called nightly per city, proposals handed to network.submitProposal. */
  engine?: Engine;
  agent?: PersonaAgent;
  /** Options for the default PolicyPersonaAgent (ignored when `agent` is given). Default: none. */
  policy?: PolicyOptions;
  /**
   * Time-dependent attendance (default false). A participant booked at a time that clashes with its
   * hidden week (agent/availability.ts timeConflict: not free, p = 0.7 it does not rearrange) does not
   * come, and gives notice on the meeting morning with p = 0.8 (other flakers: 0.45). A meeting at a
   * time that fits is decided as before. Also turns on PolicyOptions.timeAware for the default persona
   * agent (unless `policy.timeAware` says otherwise). Off by default so baselines do not move.
   */
  timeAware?: boolean;
  /**
   * Plans v1.1 (default off). Turns on PolicyOptions.plans for the default persona agent (unless
   * `policy.plans` says otherwise); scores plan meetings with the plan oracle (plans.ts planEnjoyment:
   * activity fit x group chemistry x logistics) instead of the pair model; and puts members' answers to
   * "Would you do this again?" into the snapshot as would_interact_again edges. A plan meeting is one
   * whose proposal has generator "plan", whose MeetingReport.kind is "plan", or that a participant was
   * probed for (SimMeta.plan). Time-dependent attendance (timeAware) applies to plan meetings as to any.
   * Off by default so baselines do not move.
   */
  plans?: boolean | PlanAgentOptions;
  /** Simulation start (UTC ms). Default: Mon 2026-10-05 00:00 PDT. */
  start?: number;
  mode?: RunMode;
  /** Sim-seconds per wall-second for accelerated mode. */
  speed?: number;
  /** Network tick interval in sim minutes (default 60). */
  tickMinutes?: number;
  runId?: string;
  /** Directory for run folders (default <repo>/runs). */
  runsDir?: string;
  /** Write the run folder (default true). */
  writeLog?: boolean;
  /** Scripted actions at absolute sim times. Personas with a scripted "join" don't auto-join. */
  actions?: { at: number; action: WorldAction }[];
  /** Channel delivery failure rate (default 0). */
  failureRate?: number;
  /** Opt-in oracle refinements (stable decisions, logistics); default off. */
  oracle?: OracleOptions;
  /** Compute latent opportunities for recall (O(n^2)); skipped above this many members (default 1500). */
  maxLatentMembers?: number;
  /** Progress callback (sim day finished). */
  onDay?: (day: number) => void;
  /** Live listener for every run record as it is logged (observatory, streaming UIs). */
  onRecord?: (r: RunRecord) => void;
  /**
   * Multi-app worlds: the app a member's inbound text (and join) belongs to, so every record names its
   * app (the judge's cross_app_leak). Outbound texts carry the app the network stamped (SimMeta.app).
   * Absent: single-app ntwrk records, as before.
   */
  appOf?: (memberId: MemberId) => AppId | undefined;
  /**
   * Growth: build the persona for a friend a member invites (ctx.invite). Return undefined to
   * decline (e.g. an invite cap). The new persona joins `joinDelayMs` later.
   */
  spawnFriend?: (inviter: Persona, friendName: string, seq: number) => { persona: Persona; joinDelayMs: number } | undefined;
}

export interface WorldResult {
  runId: string; dir?: string; records: RunRecord[]; metrics: Metrics; personas: Persona[];
  wallMs: number; events: number; memories: Map<MemberId, PersonaMemory>; channel: SimChannel;
}

export const DEFAULT_START = Date.UTC(2026, 9, 5, 7); // Mon Oct 5 2026, 00:00 in SF
const REPO_ROOT = resolve(import.meta.dir, "../../..");

export class World {
  readonly clock: SimClock;
  readonly channel: SimChannel;
  readonly oracle: Oracle;
  readonly scheduler: Scheduler;
  readonly records: RunRecord[] = [];
  readonly memories = new Map<MemberId, PersonaMemory>();
  private personas: Map<MemberId, Persona>;
  private agent: PersonaAgent;
  private rng: Rng;
  private start: number;
  private joined = new Map<MemberId, number>();
  private optedOut = new Set<MemberId>();
  private blocks: { from: MemberId; to: MemberId; at: number }[] = [];
  private unanswered = new Map<MemberId, number>();
  private proposals = new Map<string, Proposal>();
  private meetings = new Map<string, MeetingReport & { id: string }>();
  private notices = new Set<string>(); // `${proposalId}|${memberId}` flake notices given
  private nameIndex: { re: RegExp; id: MemberId }[] = [];
  private meetingSeq = 0;
  private spawnSeq = 0;
  private ctx?: NetworkContext;
  private wall0 = 0;
  readonly runId: string;
  /** Simulation end (start + days). */
  readonly end: number;

  constructor(private opts: WorldOptions) {
    this.start = opts.start ?? DEFAULT_START;
    this.clock = new SimClock(this.start);
    this.channel = new SimChannel(this.clock, { seed: opts.seed, failureRate: opts.failureRate });
    this.personas = new Map(opts.personas.map(p => [p.id, p]));
    this.oracle = new Oracle(opts.personas, opts.seed, this.start, opts.oracle);
    this.scheduler = new Scheduler(this.clock, { mode: opts.mode ?? "discrete", speed: opts.speed });
    this.agent = opts.agent ?? new PolicyPersonaAgent(this.start, opts.timeAware || opts.plans
      ? { ...(opts.timeAware ? { timeAware: true } : {}), ...(opts.plans ? { plans: opts.plans } : {}), ...opts.policy }
      : opts.policy);
    this.rng = new Rng(hash32("world", opts.seed));
    this.runId = opts.runId ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}-s${opts.seed}-${opts.network.name}`;
    this.end = this.start + opts.days * DAY;
    for (const p of opts.personas) this.memories.set(p.id, newMemory());
    this.buildNameIndex();
  }

  // ------------------------------------------------------------------ logging
  private rec(r: RunRecordInput) {
    const full = { t: this.clock.now(), ...r } as RunRecord;
    this.records.push(full);
    this.opts.onRecord?.(full);
  }
  private logMessage(m: SimMessage) {
    const app = (m.meta?.app as AppId | undefined) ?? (m.direction === "inbound" ? this.opts.appOf?.(m.memberId) : undefined);
    this.rec({ type: "message", msg: { id: m.id, ts: m.ts, direction: m.direction, memberId: m.memberId, body: m.body, status: m.status, keyword: m.keyword, system: m.system, meta: m.meta as any, ...(app ? { app } : {}) } });
  }

  private buildNameIndex() {
    this.nameIndex = [];
    const firstCount = new Map<string, number>();
    for (const p of this.personas.values()) { const f = p.name.split(" ")[0]!; firstCount.set(f, (firstCount.get(f) ?? 0) + 1); }
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const p of this.personas.values()) {
      const [first, last] = p.name.split(" ");
      const pats = [esc(p.name)];
      if (last) pats.push(`${esc(first!)} ${esc(last[0]!)}\\.`);
      if (firstCount.get(first!) === 1) pats.push(esc(first!));
      this.nameIndex.push({ re: new RegExp(`\\b(${pats.join("|")})\\b`), id: p.id });
    }
  }

  // ------------------------------------------------------------------ network context
  private networkContext(): NetworkContext {
    return {
      clock: this.clock,
      send: (memberId, body, o = {}) => {
        const m = this.channel.send(memberId, body, o);
        // A duplicate is not delivered again, but the attempt is logged so judges and audits see it (judge-evals-M4).
        if (m.status !== "duplicate") this.logMessage(m);
        else this.rec({ type: "network_log", kind: "duplicate_send", detail: { memberId, messageId: m.id, idempotencyKey: o.idempotencyKey, body } });
        if (o.meta?.proactive && m.status === "delivered") this.unanswered.set(memberId, (this.unanswered.get(memberId) ?? 0) + 1);
        return m;
      },
      snapshot: () => buildSnapshot([...this.personas.values()], {
        now: this.clock.now(), worldStart: this.start, joined: this.joined, optedOut: this.optedOut,
        blocks: this.blocks, unanswered: this.unanswered, recentProposals: [...this.proposals.values()],
        // The Network's own history (interactions, feedback, open opportunities, unsent proposals).
        records: this.records,
        ...(this.opts.plans ? { features: { planAgainEdges: true } } : {}),
      }),
      recordProposal: (p, source = "network") => {
        this.proposals.set(p.id, p);
        const v = this.oracle.evaluate({ id: p.id, kind: p.kind, participants: p.participants, city: p.city, window: p.window, category: p.category, objective: p.objective });
        this.rec({ type: "proposal", source, proposal: p, oracle: summarize(v) });
      },
      recordMeeting: m => this.scheduleMeeting(m),
      invite: (inviterId, friendName) => {
        const inviter = this.personas.get(inviterId);
        const made = inviter && this.opts.spawnFriend?.(inviter, friendName, ++this.spawnSeq);
        if (!made) return undefined;
        this.spawn(made.persona, this.clock.now() + made.joinDelayMs);
        return made.persona.id;
      },
      recordBlock: (from, to) => {
        this.blocks.push({ from, to, at: this.clock.now() });
        this.rec({ type: "block", from, to });
      },
      log: (kind, detail) => {
        if (kind === "feedback") this.rec({ type: "feedback", memberId: detail.memberId as string, proposalId: detail.proposalId as string, text: String(detail.text ?? "") });
        else this.rec({ type: "network_log", kind, detail });
      },
    };
  }

  private scheduleMeeting(m: MeetingReport): string {
    // Re-reporting a proposal's meeting (e.g. a late joiner) updates it in place.
    const existing = [...this.meetings.values()].find(x => x.proposalId === m.proposalId && x.at === m.at);
    if (existing) {
      const added = m.participants.filter(p => !existing.participants.includes(p));
      existing.participants = [...existing.participants, ...added];
      this.rec({ type: "meeting_scheduled", meetingId: existing.id, proposalId: m.proposalId, participants: existing.participants, at: m.at, city: m.city });
      const morning = nextLocalHour(m.at - 14 * HOUR, m.city, 8) + this.rng.int(0, 60) * MINUTE;
      for (const pid of added) this.scheduler.at(Math.min(morning, m.at - 30 * MINUTE), "flake_check", { meetingId: existing.id, personaId: pid });
      return existing.id;
    }
    const id = `mt${++this.meetingSeq}`;
    this.meetings.set(id, { ...m, id });
    this.rec({ type: "meeting_scheduled", meetingId: id, proposalId: m.proposalId, participants: m.participants, at: m.at, city: m.city });
    // Morning-of flake check (8-9am local on the meeting day, or now if that has passed).
    const morning = nextLocalHour(m.at - 14 * HOUR, m.city, 8) + this.rng.int(0, 60) * MINUTE;
    for (const pid of m.participants) this.scheduler.at(Math.min(morning, m.at - 30 * MINUTE), "flake_check", { meetingId: id, personaId: pid });
    this.scheduler.at(m.at, "meeting", { meetingId: id });
    return id;
  }

  // ------------------------------------------------------------------ persona context
  private personaCtx(p: Persona, salt: string | number): PersonaContext {
    return {
      persona: p, memory: this.memories.get(p.id)!, now: this.clock.now(), seed: this.opts.seed,
      rng: this.rng.fork("persona", p.id, salt), oracle: this.oracle,
      history: this.channel.messagesFor(p.id),
      lookupProposal: id => this.proposals.get(id),
      personaById: id => this.personas.get(id),
      personasMentioned: text => this.nameIndex.filter(n => n.re.test(text)).map(n => this.personas.get(n.id)!),
    };
  }

  /** Persona sends a message to the Network (via the channel, so keywords apply). */
  private personaSend(p: Persona, text: string, reaction?: Reaction): SimMessage | undefined {
    const mem = this.memories.get(p.id)!;
    if (mem.optedOut && text.trim().toUpperCase() !== "START") return undefined;
    // A tapback is an inbound message too: it answers the Network (resets `unanswered` below).
    const m = this.channel.receive(p.id, text, reaction ? { reaction } : {});
    this.logMessage(m);
    this.unanswered.set(p.id, 0);
    if (m.keyword === "STOP") { mem.optedOut = true; this.optedOut.add(p.id); this.rec({ type: "opt_out", memberId: p.id }); }
    if (m.keyword === "START") { mem.optedOut = false; this.optedOut.delete(p.id); }
    return m;
  }

  // ------------------------------------------------------------------ run
  /** Run the whole world: begin(), advanceTo(end), complete(). */
  async run(): Promise<WorldResult> {
    await this.begin();
    await this.advanceTo(this.end);
    return this.complete();
  }

  /** Public snapshot of joined members, exactly what the Network and engines see. */
  snapshot() { return (this.ctx ?? this.networkContext()).snapshot(); }
  /** Personas in this world (harness view, includes hidden truth). */
  personaList(): Persona[] { return [...this.personas.values()]; }
  proposal(id: string): Proposal | undefined { return this.proposals.get(id); }
  /** Add a persona mid-run (growth); they join at `joinAt` (sim ms). */
  spawn(p: Persona, joinAt: number) {
    if (this.personas.has(p.id)) return;
    this.personas.set(p.id, p);
    this.memories.set(p.id, newMemory());
    this.oracle.addPersona(p);
    // Rebuild: the newcomer gets the unique-first-name pattern too, and a first name they now
    // share stops resolving to the older persona alone (sim-worlds-21).
    this.buildNameIndex();
    this.rec({ type: "persona", persona: {
      id: p.id, name: p.name, archetype: p.archetype, adversarial: p.hidden.adversarial, homeCity: p.homeCity,
      joinDay: Math.floor((joinAt - this.start) / DAY), trueAge: p.hidden.trueAge, claimedAge: p.public.claimedAge, quietHours: quietHoursOf(p),
      canary: p.hidden.privateDisclosure?.canary, privateFact: p.hidden.privateDisclosure?.fact, romanceOptIn: p.hidden.romance.optIn,
      ...(p.apps ? { apps: [...p.apps] } : {}),
    } });
    this.scheduler.at(joinAt, "join", { personaId: p.id });
  }

  /** Schedule a world action to run at the current sim time (on the next advance). */
  act(action: WorldAction) { this.scheduler.at(this.clock.now(), "action", { action }); }
  /** Advance the simulation to sim time t (capped at the end), processing every due event. */
  async advanceTo(t: number) { await this.scheduler.runUntil(Math.min(t, this.end)); }

  /** Register handlers and seed the event queue. Call once before advanceTo(). */
  async begin(): Promise<void> {
    this.wall0 = performance.now();
    const { network, days } = this.opts;
    const end = this.end;
    const s = this.scheduler;
    const ctx = this.ctx = this.networkContext();
    await network.init(ctx);

    this.channel.onDeliverToMember(m => {
      if (m.system) { this.logMessage(m); return; }
      s.at(this.clock.now(), "deliver", { msg: m });
    });
    this.channel.onInboundToNetwork(m => s.at(this.clock.now(), "network_inbound", { msg: m }));

    s.on<{ personaId: MemberId }>("join", ev => this.onJoin(ev.data.personaId));
    s.on<{ msg: SimMessage }>("deliver", ev => this.onDeliver(ev.data.msg));
    s.on<{ personaId: MemberId; text: string; reaction?: Reaction }>("persona_send", ev => { this.personaSend(this.personas.get(ev.data.personaId)!, ev.data.text, ev.data.reaction); });
    s.on<{ msg: SimMessage }>("network_inbound", async ev => {
      const m = ev.data.msg;
      const inbound: InboundMessage = { id: m.id, memberId: m.memberId, body: m.body, ts: m.ts, channel: m.channel, keyword: m.keyword };
      if (m.meta?.reaction) inbound.reaction = m.meta.reaction;
      try { await network.onInbound(inbound); } catch (e) { this.rec({ type: "network_error", error: String((e as Error)?.stack ?? e) }); }
    });
    const tickMs = (this.opts.tickMinutes ?? 60) * MINUTE;
    s.on("tick", async () => {
      try { await network.tick(this.clock.now()); } catch (e) { this.rec({ type: "network_error", error: String((e as Error)?.stack ?? e) }); }
      if (this.clock.now() + tickMs <= end) s.after(tickMs, "tick", {});
    });
    s.on("engine_run", async () => {
      await this.runEngine();
      if (this.clock.now() + DAY <= end) s.after(DAY, "engine_run", {});
    });
    s.on<{ personaId: MemberId }>("initiative", ev => this.onInitiative(ev.data.personaId, end));
    s.on<{ meetingId: string; personaId: MemberId }>("flake_check", ev => this.onFlakeCheck(ev.data.meetingId, ev.data.personaId));
    s.on<{ meetingId: string }>("meeting", ev => this.onMeeting(ev.data.meetingId));
    s.on<{ action: WorldAction }>("action", ev => this.onAction(ev.data.action, ctx));
    s.on<{ day: number }>("day", ev => { this.opts.onDay?.(ev.data.day); });

    this.rec({ type: "run_start", runId: this.runId, seed: this.opts.seed, start: this.start, config: {
      days, personas: this.opts.personas.length, network: network.name, engine: this.opts.engine?.name ?? null,
      agent: this.agent.mode, mode: this.opts.mode ?? "discrete", tickMinutes: this.opts.tickMinutes ?? 60,
    } });
    for (const p of this.opts.personas) {
      this.rec({ type: "persona", persona: {
        id: p.id, name: p.name, archetype: p.archetype, adversarial: p.hidden.adversarial, homeCity: p.homeCity,
        joinDay: p.joinDay, trueAge: p.hidden.trueAge, claimedAge: p.public.claimedAge, quietHours: quietHoursOf(p),
        canary: p.hidden.privateDisclosure?.canary, privateFact: p.hidden.privateDisclosure?.fact, romanceOptIn: p.hidden.romance.optIn,
      } });
    }

    const scripted = new Set((this.opts.actions ?? []).filter(a => a.action.do === "join").map(a => (a.action as { persona: string }).persona));
    for (const p of this.opts.personas) {
      if (scripted.has(p.id) || p.joinDay >= days) continue;
      const r = this.rng.fork("join", p.id);
      const at = nextLocalHour(this.start + p.joinDay * DAY, p.homeCity, r.int(9, 20)) + r.int(0, 59) * MINUTE;
      s.at(at, "join", { personaId: p.id });
    }
    for (const a of this.opts.actions ?? []) s.at(a.at, "action", { action: a.action });
    s.at(this.start + 5 * MINUTE, "tick", {});
    if (this.opts.engine) s.at(this.start + 2 * HOUR, "engine_run", {});
    for (let d = 1; d <= days; d++) s.at(this.start + d * DAY - 1, "day", { day: d });
  }

  /** Close the run at the current sim time: latent opportunities, run_end, metrics, log folder. */
  async complete(): Promise<WorldResult> {
    const s = this.scheduler;
    const end = Math.max(this.clock.now(), this.start);
    this.finish(end);
    const wallMs = Math.round(performance.now() - this.wall0);
    this.rec({ type: "run_end", simEnd: end, wallMs, stats: {
      events: s.processed, messages: this.channel.all().length, proposals: this.proposals.size, meetings: this.meetings.size,
      joined: this.joined.size, optedOut: this.optedOut.size,
    } });
    const metrics = computeMetrics(this.records);
    let dir: string | undefined;
    if (this.opts.writeLog !== false) dir = await this.write(metrics);
    return { runId: this.runId, dir, records: this.records, metrics, personas: this.opts.personas, wallMs, events: s.processed, memories: this.memories, channel: this.channel };
  }

  private finish(end: number) {
    const members = [...this.joined.keys()];
    if (members.length <= (this.opts.maxLatentMembers ?? 1500)) {
      this.rec({ type: "latent_opportunities", members, pairs: this.oracle.latentPairs(members, end) });
    }
  }

  private async write(metrics: Metrics): Promise<string> {
    const dir = join(this.opts.runsDir ?? join(REPO_ROOT, "runs"), this.runId);
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "events.jsonl"), this.records.map(r => JSON.stringify(r)).join("\n") + "\n");
    await Bun.write(join(dir, "personas.json"), JSON.stringify(this.opts.personas, null, 1));
    await Bun.write(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2));
    return dir;
  }

  // ------------------------------------------------------------------ handlers
  private async onJoin(id: MemberId) {
    const p = this.personas.get(id);
    const mem = this.memories.get(id);
    if (!p || !mem || mem.joined) return;
    mem.joined = true; mem.joinedAt = this.clock.now();
    this.joined.set(id, this.clock.now());
    this.channel.register(id, this.rng.fork("chan", id).bool(0.75) ? "imessage" : "sms");
    const app = this.opts.appOf?.(id);
    this.rec({ type: "join", memberId: id, ...(app ? { app } : {}) });
    const text = await this.agent.joinMessage(this.personaCtx(p, "join"));
    this.personaSend(p, text);
    const r = this.rng.fork("ini0", id);
    this.scheduler.at(nextLocalHour(this.clock.now() + r.int(1, 3) * DAY, p.homeCity, r.int(10, 20)), "initiative", { personaId: id });
  }

  private async onDeliver(msg: SimMessage) {
    const p = this.personas.get(msg.memberId);
    const mem = this.memories.get(msg.memberId);
    if (!p || !mem || mem.optedOut) return;
    const pctx = this.personaCtx(p, msg.id);
    const reply = await this.agent.respond(pctx, msg);
    this.rec({ type: "decision", memberId: p.id, messageId: msg.id, messageType: reply.messageType, intent: reply.intent, decision: reply.decision, proposalId: reply.proposalId, delayMs: reply.delayMs });
    if (reply.worthwhile !== undefined) this.rec({ type: "judgment", memberId: p.id, messageId: msg.id, worthwhile: reply.worthwhile, source: this.agent.mode });
    // A flake notice, or "can't make it" to a booked or scheduled time (timeAware), cancels with notice.
    if ((reply.intent === "flake_notice" || reply.intent === "booked_cancel") && reply.proposalId) this.notices.add(`${reply.proposalId}|${p.id}`);
    // Messages the persona sends on its own after this one (plans: "WEEKLY" to the check-in offer).
    for (const f of reply.followUps ?? []) this.scheduler.after(f.delayMs, "persona_send", { personaId: p.id, text: f.text });
    if (reply.action === "reply" && reply.text) {
      this.scheduler.after(reply.delayMs, "persona_send", { personaId: p.id, text: reply.text, ...(reply.reaction ? { reaction: reply.reaction } : {}) });
      if (reply.block?.length) {
        for (const b of reply.block) {
          const other = this.personas.get(b);
          if (other && !mem.blocked.includes(b)) {
            mem.blocked.push(b);
            this.scheduler.after(reply.delayMs + 2 * MINUTE, "persona_send", { personaId: p.id, text: `block ${other.name}` });
          }
        }
      }
    }
  }

  private async onInitiative(id: MemberId, end: number) {
    const p = this.personas.get(id)!;
    const mem = this.memories.get(id)!;
    const r = this.rng.fork("ini", id, this.clock.now());
    if (mem.joined && !mem.optedOut) {
      const ini = await this.agent.initiative(this.personaCtx(p, `ini${this.clock.now()}`));
      if (ini) {
        if (ini.block) for (const b of ini.block) if (!mem.blocked.includes(b)) mem.blocked.push(b);
        const m = this.personaSend(p, ini.text);
        if (m && ini.adversarial) this.rec({ type: "adversarial_attempt", memberId: id, kind: ini.adversarial, messageId: m.id });
      }
    }
    // Next initiative: adversaries every 1-2 days; others ~ every 3-12 days by social energy.
    const gapDays = p.hidden.adversarial ? r.range(1, 2) : r.logNormal(6 / (0.5 + p.hidden.socialEnergy), 0.4);
    const next = nextLocalHour(this.clock.now() + gapDays * DAY, p.homeCity, r.int(Math.max(p.routine.wake, 8), 21));
    if (next < end && !mem.optedOut) this.scheduler.at(next, "initiative", { personaId: id });
  }

  private onFlakeCheck(meetingId: string, personaId: MemberId) {
    const m = this.meetings.get(meetingId);
    const p = this.personas.get(personaId);
    const mem = this.memories.get(personaId);
    if (!m || !p || !mem || mem.optedOut) return;
    const pr = mem.proposals[m.proposalId];
    const key = `${m.proposalId}|${personaId}`;
    // Time-aware: a participant booked at a time that clashes with its week drops out (and says so more often).
    const clash = this.clashes(m, p);
    if (this.notices.has(key) || (!clash && (!pr || pr.plannedShow))) return;
    const r = this.rng.fork("flake", meetingId, personaId);
    if (mem.forceFlake === "notice" || (!mem.forceFlake && r.bool(clash ? 0.8 : 0.45))) {
      this.notices.add(key);
      const text = templateText(this.personaCtx(p, `flake${meetingId}`), { intent: "flake_notice", messageType: "reminder", decision: "none", delayMs: 0 });
      this.personaSend(p, text);
    }
    if (mem.forceFlake) mem.forceFlake = undefined; // one-shot
  }

  /** WorldOptions.timeAware: the meeting's time clashes with the participant's hidden week. */
  private clashes(m: MeetingReport, p: Persona): boolean {
    return !!this.opts.timeAware && timeConflict(p, m.proposalId, m.at, m.city, this.opts.seed, this.oracle);
  }

  private onMeeting(meetingId: string) {
    const m = this.meetings.get(meetingId)!;
    const prop = this.proposals.get(m.proposalId);
    const attendance: Record<MemberId, { showed: boolean; cancelledWithNotice: boolean; enjoyment: number }> = {};
    const showed: MemberId[] = [];
    for (const id of m.participants) {
      const mem = this.memories.get(id)!;
      const pr = mem.proposals[m.proposalId];
      const notice = this.notices.has(`${m.proposalId}|${id}`);
      const s = !!pr && pr.decision !== "decline" && pr.plannedShow && !notice && !mem.optedOut && !this.clashes(m, this.personas.get(id)!);
      attendance[id] = { showed: s, cancelledWithNotice: notice, enjoyment: 0 };
      if (s) showed.push(id);
    }
    const plan = this.opts.plans ? this.planOf(m, prop) : undefined;
    if (plan && showed.length >= 2) {
      // The plan oracle: activity fit x group chemistry x logistics (plans.ts).
      const e = planEnjoyment(this.oracle, this.opts.seed, { id: m.proposalId, ...plan }, showed);
      for (const id of showed) attendance[id]!.enjoyment = e[id] ?? 0;
    } else if (showed.length >= 2) {
      const v = this.oracle.evaluate({ id: `${m.proposalId}:actual`, kind: prop?.kind ?? "intro", participants: showed, city: m.city, window: { start: m.at, end: m.at }, category: prop?.category, objective: prop?.objective });
      for (const id of showed) attendance[id]!.enjoyment = v.participants[id]?.enjoyment ?? 0;
    }
    for (const id of m.participants) {
      const mem = this.memories.get(id)!;
      mem.meetings[m.proposalId] = {
        at: m.at, showed: attendance[id]!.showed, enjoyment: attendance[id]!.enjoyment,
        others: m.participants.filter(x => x !== id), cancelledWithNotice: attendance[id]!.cancelledWithNotice,
        othersShowed: showed.filter(x => x !== id),
      };
    }
    this.rec({ type: "outcome", meetingId, proposalId: m.proposalId, at: m.at, attendance });
  }

  /**
   * WorldOptions.plans: is this meeting a plan, and its activity and area? From the proposal (generator
   * "plan", anchor or "plan: <label>" objective), the report's kind, or a participant's probe (SimMeta.plan).
   */
  private planOf(m: MeetingReport, prop: Proposal | undefined): { activity?: string; area?: string } | undefined {
    const probed = m.participants.map(id => this.memories.get(id)?.plans?.[m.proposalId]).find(x => !!x);
    if (!probed && prop?.generator !== "plan" && m.kind !== "plan") return undefined;
    const anchor = (prop as { anchor?: { type: string; id: string } } | undefined)?.anchor;
    const activity = probed?.activity ?? (anchor?.type === "interest" ? anchor.id : prop?.objective?.replace(/^plan:\s*/i, ""));
    return { ...(activity ? { activity } : {}), ...(probed?.area ? { area: probed.area } : {}) };
  }

  private async onAction(a: WorldAction, ctx: NetworkContext) {
    this.rec({ type: "scenario", action: a.do, detail: a as unknown as Record<string, unknown> });
    const mem = "persona" in a ? this.memories.get(a.persona) : undefined;
    switch (a.do) {
      case "join": await this.onJoin(a.persona); break;
      case "go_silent": if (mem) mem.silentFrom = this.clock.now(); break;
      case "force_flake": if (mem) mem.forceFlake = a.how; break;
      case "say": this.personaSend(this.personas.get(a.persona)!, a.text); break;
      case "opt_out": this.personaSend(this.personas.get(a.persona)!, "STOP"); break;
      case "propose": {
        const p = { ...a.proposal, createdAt: this.clock.now() };
        ctx.recordProposal(p, a.source ?? "scenario");
        await this.opts.network.submitProposal?.(p);
        break;
      }
    }
  }

  private async runEngine() {
    const engine = this.opts.engine;
    if (!engine) return;
    const ctx = this.networkContext();
    for (const city of ["sf", "nyc"] as const) {
      try {
        const snap = ctx.snapshot();
        const props = await engine.propose(snap, { city, seed: hash32(this.opts.seed, city, this.clock.now()) });
        for (const p of props) {
          ctx.recordProposal(p, "engine");
          await this.opts.network.submitProposal?.(p);
        }
      } catch (e) { this.rec({ type: "network_error", error: `engine: ${String((e as Error)?.stack ?? e)}` }); }
    }
  }
}

export function summarize(v: OracleVerdict): OracleSummary {
  return { compatible: v.compatible, unsafe: v.unsafe, quality: v.quality, minEnjoyment: v.minEnjoyment, flags: v.flags, participants: v.participants };
}

/** Convenience: build and run a world. */
export async function runWorld(opts: WorldOptions): Promise<WorldResult> {
  return new World(opts).run();
}
