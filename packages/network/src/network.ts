// ConsentNetwork: a production-shaped Network for New York (docs/network.md). It replaces the
// StubNetwork in the simulator and is written to run unchanged behind the real channel later.
//
// What it does differently from the stub:
//  - Consent first. Every opportunity starts with an anonymous probe ("up for X this week near Y?");
//    only when every participant says yes does the Network reveal who and propose a time and place.
//    Members who asked for something themselves are not probed: they already said yes.
//  - Selective. Engine output is gated on trust, knowledge, evidence and capacity; one open
//    opportunity per member, with alternates when someone is unavailable (no wasted proposals).
//  - Requests are fulfilled: asks for a person or a plan are classified, searched, probed and answered.
//  - Safety. Spam, sales, scams, contact extraction, prompt injection, harassment, block abuse and
//    minor signals are handled before anything else (classify.ts, trust.ts).
//  - Learns. Interview answers become facets, feedback becomes edges and reliability, and all of it
//    is fed back into the engine's input (safetyHolds, feedback, interactions, reliability).
//  - Grows. Invite asks after good experiences and for unmet requests; invitees join and are welcomed.
//  - Real places. Meetings are at public NYC venues that keep everyone's trip short (geo.ts).
import {
  canBeMatched, DAY, HOUR, MINUTE, type Category, type Facet, type Intent, type MemberId, type Proposal, type ScoreComponents, type WorldSnapshot,
} from "@thenetwork/core";
import { runEngine, type EngineConfigInput, type EngineInput, type EngineProposal, type FeedbackRecord, type InteractionRecord, type MatchingRunLog } from "@thenetwork/engine";
import { desireById, INTERESTS, parseYesNo, SKILLS, type InboundMessage, type NetworkContext, type NetworkUnderTest, type SimMeta } from "@thenetwork/sim";
import { classify, extractProfile, feedbackOf, type Classified } from "./classify.ts";
import { copy, whenPhrase } from "./copy.ts";
import { meetingSpot, nearbyVenues, NEIGHBORHOODS, neighborhood, travelMinutes } from "./geo.ts";
import { Trust, type TrustLevel } from "./trust.ts";

export type Origin = "engine" | "request" | "plans" | "second_encounter" | "newcomer_welcome" | "player";

export interface NetworkOptions {
  seed?: number;
  /** Consent-first probes (default true). false = reveal straight away (the push baseline). */
  probes?: boolean;
  /** Gate engine output on trust/knowledge/evidence (default true). */
  selective?: boolean;
  /** Most new engine opportunities started per day (default 20). */
  maxNewPerDay?: number;
  /** Minimum engine score for a proposal to be considered (default 0; the engine's own thresholds apply). */
  minScore?: number;
  /** Minimum known interest/skill facets (or one active intent) per participant (default 2). */
  minKnowledge?: number;
  /** Minimum known-want fit (knownWantMet) for every participant (default 0.8). */
  minWantMet?: number;
  /** Minimum share of our asks a member answers to be put into an opportunity (default 0.6). */
  minResponsiveness?: number;
  /** Local hour of the nightly engine run (default 9). */
  runHour?: number;
  /** Engine config overrides. */
  engine?: EngineConfigInput;
  /** Growth asks after good experiences (default true). */
  growth?: boolean;
  /** Invites per member per 30 days (default 3). */
  invitesPerMonth?: number;
  /** Growth asks per day across the network (default 8). */
  maxGrowthAsksPerDay?: number;
  /** Open a quiet standing request for a specific want named during onboarding (default false). */
  onboardingRequests?: boolean;
  /** Called with every engine run (observatory capture). */
  onEngineRun?: (log: MatchingRunLog, proposals: EngineProposal[], at: number) => void;
}

interface MemberState {
  id: MemberId; first: string; display: string; area: string; quietHours: [number, number];
  state: string; minor: boolean; minorSignal: boolean; stage: "new" | "q1" | "q2" | "q3" | "active";
  optedOut: boolean; unanswered: number; proactive: number[]; lastInbound: number; joinedAt: number;
  awaiting?: { kind: "probe" | "reveal" | "feedback" | "growth" | "interview"; oppId?: string; at: number };
  invitedBy?: MemberId; invites: number[]; invitesBlockedUntil: number; lastGrowthAsk: number; lastInterview: number;
  learned: { interests: Set<string>; skills: Set<string>; desires: Set<string>; area?: string; eveningsOpen?: boolean; groups?: boolean };
  noShows: number; completedSinceNoShow: number; msgsIn: number;
  /** Probes/questions/invitations we sent that wanted an answer, and how many got one. */
  asked: number; answered: number;
}

type PStatus = "probing" | "available" | "unavailable" | "invited" | "yes" | "no" | "dropped";
interface Opp {
  id: string; origin: Origin; kind: Proposal["kind"]; category: Category; objective: string; detail: string;
  participants: MemberId[]; alternates: MemberId[]; primed: Set<MemberId>; requester?: MemberId;
  status: Map<MemberId, PStatus>; explanations: Record<MemberId, string>;
  stage: "probing" | "inviting" | "scheduled" | "done" | "closed"; deadline: number; createdAt: number;
  score: number; components: ScoreComponents; generator: string; exploration: boolean;
  venue?: string; venueArea?: string; meetingAt?: number; reminded?: boolean; feedbackSent?: boolean; recorded?: boolean; nudged?: boolean;
  tags: string[]; replacements: number; runId?: string;
}
interface Request { id: string; memberId: MemberId; at: number; kind: "people" | "plans"; category: Category; desireId?: string; tags: string[]; text: string; oppId?: string; outcome?: "probing" | "fulfilled" | "none" | "answered"; fulfilledAt?: number; tries?: number; toldNone?: boolean; lastTry?: number }

const ZERO: ScoreComponents = { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 };
const ALLOWED: [number, number] = [9, 20];
const PROBE_TTL = 26 * HOUR, REVEAL_TTL = 30 * HOUR;
const BUDGET: Record<string, { n: number; days: number }> = { open: { n: 4, days: 7 }, normal: { n: 2, days: 7 }, quiet: { n: 1, days: 30 }, receiving: { n: 0, days: 7 }, paused: { n: 0, days: 7 } };
const OPEN_STAGES = new Set(["probing", "inviting", "scheduled"]);
const NY = "America/New_York";
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function nyParts(t: number) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(t).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 + Number(p.minute) / 60, weekday: p.weekday as string };
}
/** Next time (>= t) at local NY hour h on a day accepted by `dayOk`. */
function nextAt(t: number, h: number, dayOk: (wd: string) => boolean = () => true): number {
  let x = t - (t % (15 * MINUTE)) + 15 * MINUTE;
  for (let i = 0; i < 24 * 4 * 9; i++, x += 15 * MINUTE) {
    const p = nyParts(x);
    if (Math.abs(p.hour - h) < 0.01 && dayOk(p.weekday)) return x;
  }
  return t + DAY;
}

export class ConsentNetwork implements NetworkUnderTest {
  readonly name = "consent";
  readonly trust = new Trust();
  private ctx!: NetworkContext;
  private members = new Map<MemberId, MemberState>();
  readonly opps = new Map<string, Opp>();
  readonly requests: Request[] = [];
  private queued: Proposal[] = [];
  private deferred: { memberId: MemberId; body: string; meta: SimMeta }[] = [];
  private blocks = new Set<string>();
  private avoid = new Set<string>();
  private declined = new Map<string, number>();
  private again = new Map<string, Set<MemberId>>();
  private feedback: FeedbackRecord[] = [];
  private interactions: InteractionRecord[] = [];
  private lastRunDay = "";
  /** Engine run that is currently being turned into opportunities (for run linkage). */
  private currentRunId?: string;
  /** Skills confirmed by a good experience (a requester enjoyed meeting the provider). */
  private vouchedSkills = new Map<MemberId, Set<string>>();
  /** Members who joined through an invite made in this run (growth accounting). */
  readonly invitedIds = new Set<MemberId>();
  private seq = 0;
  private oppSeq = 0;
  readonly counters = {
    probesSent: 0, probeYes: 0, probeNo: 0, probeExpired: 0, reveals: 0, revealYes: 0, revealNo: 0, revealExpired: 0,
    oppsStarted: 0, oppsRevealed: 0, oppsAllYes: 0, oppsNotAvailable: 0, replacements: 0, scheduled: 0,
    requests: 0, requestsFulfilled: 0, requestsNone: 0, requestRetries: 0, plansAnswered: 0, abuse: 0, holds: 0, watches: 0,
    invitesSent: 0, inviteesJoined: 0, growthAsks: 0, interviews: 0, engineRuns: 0, engineProposals: 0, gatedOut: 0,
  };
  readonly gateReasons: Record<string, number> = {};
  private opts: Required<Omit<NetworkOptions, "engine" | "onEngineRun">> & Pick<NetworkOptions, "engine" | "onEngineRun">;

  constructor(opts: NetworkOptions = {}) {
    this.opts = {
      seed: opts.seed ?? 1, probes: opts.probes ?? true, selective: opts.selective ?? true, maxNewPerDay: opts.maxNewPerDay ?? 20,
      minScore: opts.minScore ?? 0, minKnowledge: opts.minKnowledge ?? 2, minWantMet: opts.minWantMet ?? 0.8, minResponsiveness: opts.minResponsiveness ?? 0.6, runHour: opts.runHour ?? 9, growth: opts.growth ?? true,
      invitesPerMonth: opts.invitesPerMonth ?? 3, maxGrowthAsksPerDay: opts.maxGrowthAsksPerDay ?? 8, onboardingRequests: opts.onboardingRequests ?? false, engine: opts.engine, onEngineRun: opts.onEngineRun,
    };
    this.trust.onChange = (id, from, to, why) => this.onTrustChange(id, from, to, why);
  }

  init(ctx: NetworkContext) { this.ctx = ctx; }
  private now() { return this.ctx.clock.now(); }

  // ================================================================== inbound
  async onInbound(msg: InboundMessage) {
    const now = this.now();
    const m = this.member(msg.memberId);
    m.lastInbound = now; m.unanswered = 0; m.msgsIn++;
    if (msg.keyword === "STOP") { m.optedOut = true; this.dropMember(m.id, "opted out"); return; }
    if (msg.keyword === "START") { m.optedOut = false; this.send(m, copy.stopWelcomeBack, { type: "info" }); return; }
    if (msg.keyword === "HELP") return;
    const body = msg.body.trim();
    if (m.stage === "new") return this.welcome(m);

    const c = classify(body);
    if (this.trust.level(m.id) === "hold") { if (c.abuse.length) this.trust.add(m.id, now, c.abuse[0]!, 0); return; }
    if (c.abuse.length) return this.handleAbuse(m, c, body);
    if (c.minorSignal && !m.minor) {
      m.minor = true; m.minorSignal = true;
      this.dropMember(m.id, "minors policy");
      this.ctx.log("minor_signal", { memberId: m.id });
      this.send(m, copy.minorNotice, { type: "info" });
      return;
    }
    if (c.kind === "block" || c.kind === "report") return this.handleBlock(m, c.kind, c.target ?? "");

    // Answers to what we asked.
    const aw = m.awaiting;
    if (aw && (aw.kind === "probe" || aw.kind === "reveal")) {
      const yn = parseYesNo(body);
      if (yn !== "unclear") { m.awaiting = undefined; return aw.kind === "probe" ? this.onProbeAnswer(m, aw.oppId!, yn !== "no") : this.onRevealAnswer(m, aw.oppId!, yn !== "no"); }
    }
    if (c.kind === "cancel") {
      const o = [...this.opps.values()].find(o => o.stage === "scheduled" && o.status.get(m.id) === "yes");
      if (o) return this.handleDrop(m, o);
    }
    if (aw?.kind === "feedback" || (c.kind === "feedback_like" && aw?.kind !== "interview")) {
      m.awaiting = undefined;
      return this.onFeedback(m, aw?.oppId, body);
    }
    if (c.friendName && (c.kind === "invite_friend" || aw?.kind === "growth")) { m.awaiting = undefined; return this.invite(m, c.friendName); }
    if (aw?.kind === "growth") m.awaiting = undefined; // they moved on; don't swallow what they said
    // Onboarding answers teach us about them; a want they name there becomes a quiet standing request.
    // A clear request after onboarding stalled is handled as a request (an unanswered interview doesn't trap them).
    const isRequest = c.kind === "people_request" || c.kind === "plans_request";
    if (aw?.kind === "interview" && m.stage !== "active" && c.kind !== "plans_request") {
      this.onInterviewAnswer(m, body);
      // Only specific wants (a band, a climbing partner, a mentor): "new friends" is what everyone says.
      if (this.opts.onboardingRequests && c.kind === "people_request" && c.desireId && c.category !== "social" && !m.minor) this.openRequest(m, c, body, { quiet: true });
      return;
    }
    if (!isRequest && m.stage !== "active" && aw?.kind === "interview") return this.onInterviewAnswer(m, body);
    if (!isRequest && m.stage !== "active") m.stage = "active"; // onboarding stalled; carry on
    if (isRequest && m.stage !== "active") { m.stage = "active"; m.awaiting = undefined; }
    if (c.kind === "people_request" && !m.minor) return this.onRequest(m, c, body);
    if (c.kind === "plans_request" || (c.kind === "people_request" && m.minor)) return this.onPlans(m, c);
    if (m.minor && c.kind === "other" && body.length > 12) return this.concierge(m, body);
  }

  private welcome(m: MemberState) {
    this.dirty = true;
    const snapMember = this.snapshotCached().members.find(x => x.id === m.id);
    if (m.minor) { m.stage = "active"; this.send(m, copy.welcomeMinor(m.first), { type: "onboarding", proactive: false, firstContact: true }); return; }
    m.stage = "q1";
    m.awaiting = { kind: "interview", at: this.now() };
    const inviter = snapMember?.invitedBy ? this.members.get(snapMember.invitedBy)?.first : undefined;
    this.send(m, copy.welcome(m.first, inviter), { type: "onboarding", proactive: false, firstContact: true });
    if (m.invitedBy && this.invitedIds.has(m.id)) {
      const inv = this.members.get(m.invitedBy);
      if (inv && !inv.optedOut) { this.counters.inviteesJoined++; this.send(inv, copy.inviteeJoined(m.first), { type: "info" }); }
    }
  }

  private onInterviewAnswer(m: MemberState, body: string) {
    const x = extractProfile(body);
    x.interests.forEach(t => m.learned.interests.add(t));
    x.skills.forEach(t => m.learned.skills.add(t));
    x.desireIds.forEach(t => m.learned.desires.add(t));
    if (x.area && neighborhood(x.area).name === x.area) { m.learned.area = x.area; m.area = x.area; }
    if (x.eveningsOpen !== undefined) m.learned.eveningsOpen = x.eveningsOpen;
    if (x.groups !== undefined) m.learned.groups = x.groups;
    this.dirty = true;
    this.ctx.log("learned", { memberId: m.id, interests: x.interests, skills: x.skills, desires: x.desireIds, area: x.area });
    m.awaiting = undefined;
    if (m.stage === "q1") { m.stage = "q2"; m.awaiting = { kind: "interview", at: this.now() }; this.send(m, copy.interview.availability, { type: "question", proactive: false }); return; }
    if (m.stage === "q2") { m.stage = "q3"; m.awaiting = { kind: "interview", at: this.now() }; this.send(m, copy.interview.format, { type: "question", proactive: false }); return; }
    if (m.stage === "q3") m.stage = "active";
    this.send(m, copy.ackLearned, { type: "info" });
  }

  // ================================================================== safety
  private handleAbuse(m: MemberState, c: Classified, body: string) {
    const now = this.now();
    this.counters.abuse++;
    this.ctx.log("abuse", { memberId: m.id, kinds: c.abuse, risk: c.risk, text: body.slice(0, 160) });
    this.trust.add(m.id, now, c.abuse[0]!, c.risk);
    if (this.trust.level(m.id) === "hold") return; // onTrustChange already told them
    const reply = c.abuse.includes("scam_money") ? copy.noMoney
      : c.abuse.includes("prompt_injection") ? copy.noInjection
      : c.abuse.includes("contact_extraction") ? copy.noContactDetails
      : c.abuse.includes("harassment") ? copy.giveSpace
      : copy.noPromotion;
    this.send(m, reply, { type: "info" });
  }

  private onTrustChange(id: MemberId, from: TrustLevel, to: TrustLevel, why: string) {
    const m = this.members.get(id);
    this.ctx.log("trust", { memberId: id, from, to, why, score: this.trust.get(id).score });
    if (to === "watch") this.counters.watches++;
    if (to !== "ok") this.dropMember(id, `trust ${to}`);
    if (to === "hold") {
      this.counters.holds++;
      if (m) this.send(m, copy.hold, { type: "info" });
      // Inviter accountability: no invites for 30 days, and a risk point.
      const inviter = m?.invitedBy ? this.members.get(m.invitedBy) : undefined;
      if (inviter) {
        inviter.invitesBlockedUntil = this.now() + 30 * DAY;
        this.trust.add(inviter.id, this.now(), "invitee_held", 1);
      }
    }
  }

  /** Remove any member's full name (and "Name:" prefixes) from free text. */
  stripNames(text: string): string {
    let t = text;
    for (const [, name] of this.fullNames) if (t.includes(name)) t = t.split(name).join("they");
    return t.replace(/\bthey: /g, "they ").replace(/\s+/g, " ").trim();
  }

  /** Resolve a name a member typed: full name, then "First L.", then a unique first name (whole words only). */
  findByName(name: string, exclude: MemberId): MemberState | undefined {
    const t = name.toLowerCase().replace(/\s+/g, " ").trim();
    const all = [...this.members.values()].filter(x => x.id !== exclude);
    const full = (x: MemberState) => this.fullNames.get(x.id)?.toLowerCase() ?? "";
    // Unicode-aware whole-word match (names like "José" or "Zoë").
    const word = (w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}])`, "u");
    return all.find(x => full(x) && word(full(x)).test(t))
      ?? all.find(x => word(x.display.toLowerCase()).test(t))
      ?? (() => { const f = all.filter(x => word(x.first.toLowerCase()).test(t)); return f.length === 1 ? f[0] : undefined; })();
  }
  private fullNames = new Map<MemberId, string>();

  private handleBlock(m: MemberState, verb: "block" | "report", name: string) {
    const target = this.findByName(name, m.id);
    if (!target) { this.send(m, "I couldn't find who you mean. Can you give me their full name?", { type: "question", proactive: false }); return; }
    const now = this.now();
    this.blocks.add(pairKey(m.id, target.id));
    this.ctx.recordBlock(m.id, target.id);
    this.trust.block(m.id, now);
    if (verb === "report") this.trust.report(target.id, m.id, now);
    for (const o of this.opps.values()) if (OPEN_STAGES.has(o.stage) && o.participants.includes(m.id) && o.participants.includes(target.id)) this.close(o, "blocked");
    this.send(m, verb === "block" ? copy.blocked : copy.reported, { type: "info" });
  }

  // ================================================================== requests
  private onRequest(m: MemberState, c: Classified, text: string) { this.openRequest(m, c, text, {}); }

  private openRequest(m: MemberState, c: Classified, text: string, o: { quiet?: boolean }) {
    const now = this.now();
    // Repeat asks ("still hoping to...") are the same request: don't open another one while one is
    // in progress, and don't re-search the same want more than once every 3 days.
    const prior = [...this.requests].reverse().find(r => r.memberId === m.id && r.kind === "people" && (r.desireId ?? r.category) === (c.desireId ?? c.category));
    if (prior && (prior.outcome === "probing" || now - prior.at < 3 * DAY)) {
      if (o.quiet) return;
      if (prior.outcome === "probing") { this.send(m, "Still on it; I'll get back to you soon.", { type: "info" }); return; }
      if (prior.outcome === "none" && this.trust.ok(m.id) && !this.busy(m.id) && (!prior.lastTry || now - prior.lastTry > HOUR) && this.tryRequest(m, prior)) { this.send(m, copy.requestAck, { type: "info" }); return; }
      this.tellNoneYet(m, prior);
      return;
    }
    this.counters.requests++;
    const req: Request = { id: `rq${this.requests.length + 1}`, memberId: m.id, at: now, kind: "people", category: c.category ?? "social", desireId: c.desireId, tags: c.tags, text };
    this.requests.push(req);
    if (c.desireId) m.learned.desires.add(c.desireId);
    c.tags.forEach(t => m.learned.interests.add(t));
    this.dirty = true;
    this.ctx.log("request", { requestId: req.id, memberId: m.id, kind: "people", category: req.category, desireId: req.desireId, text: text.slice(0, 160) });
    if (!this.trust.ok(m.id) || this.busy(m.id)) {
      req.outcome = "none";
      if (this.busy(m.id) && !o.quiet) this.send(m, "You've got something in the works already; let's see how that goes first, then I'll look again.", { type: "info" });
      return;
    }
    if (!this.tryRequest(m, req)) {
      this.ctx.log("request_result", { requestId: req.id, memberId: m.id, outcome: "waiting", reason: "density_gap" });
      if (o.quiet) req.outcome = "none"; else this.tellNoneYet(m, req);
      return;
    }
    if (!o.quiet) this.send(m, copy.requestAck, { type: "info" });
  }

  /** A standing request: tell them once, offer a public alternative and an invite, keep looking for a week. */
  private tellNoneYet(m: MemberState, req: Request) {
    req.outcome = "none";
    if (req.toldNone) return;
    req.toldNone = true;
    const def = req.desireId ? desireById.get(req.desireId) : undefined;
    const what = def ? def.text.replace(/^(find|meet|get|be part of|try|learn to|start) /, "") : "that";
    const v = nearbyVenues(m.area, def ? def.needsInterests : req.tags, 1)[0];
    this.send(m, `${copy.requestNoneYet(what)}${v ? ` Meanwhile, ${v.name} is a good public spot for it.` : ""}`, { type: "info" });
    if (this.canInvite(m)) m.awaiting = { kind: "growth", at: this.now() };
  }

  /** Search and, if anyone fits, start the consent flow. Returns false when no one fits yet. */
  private tryRequest(m: MemberState, req: Request): boolean {
    req.tries = (req.tries ?? 0) + 1; req.lastTry = this.now();
    const cands = this.searchFor(m, req);
    if (!cands.length) return false;
    const def = req.desireId ? desireById.get(req.desireId) : undefined;
    const detail = def ? def.text.replace(/^find (a |an )?/, "a ").replace(/^get /, "") : "meeting up";
    const o = this.newOpp({
      origin: "request", kind: "intro", category: req.category, objective: def?.text ?? req.text.slice(0, 80), detail,
      // A strong fit (their stated want answered by a stated skill or the same want) is what they
      // asked for, so no need to re-ask. A partial fit is confirmed with them first.
      participants: [m.id, cands[0]!.id], alternates: cands.slice(1, 4).map(x => x.id), primed: cands[0]!.fit >= 0.8 || !this.opts.selective ? [m.id] : [], requester: m.id,
      explanations: { [m.id]: cands[0]!.why, [cands[0]!.id]: `they asked for ${detail}, and ${cands[0]!.whyBack}` },
      score: cands[0]!.score, generator: "request", tags: req.tags,
    });
    req.oppId = o.id; req.outcome = "probing";
    this.ctx.log("request_result", { requestId: req.id, memberId: m.id, outcome: "probing", oppId: o.id, candidates: cands.length });
    this.startProbes(o);
    return true;
  }

  /** Daily: retry open requests (up to a week old) as people free up or join. */
  private retryRequests(now: number) {
    for (const r of this.requests) {
      if (r.kind !== "people" || r.outcome !== "none" || now - r.at > 7 * DAY || (r.lastTry && now - r.lastTry < 20 * HOUR)) continue;
      const m = this.member(r.memberId);
      if (!this.eligible(m.id) || this.busy(m.id)) continue;
      if (this.tryRequest(m, r)) { this.counters.requestRetries++; this.send(m, "Good news: I may have found someone for what you asked about. Checking with them now.", { type: "info" }); }
    }
  }

  /** Who could answer this ask? Skeptical: only candidates whose KNOWN profile fits, nearby, available, safe. */
  searchFor(m: MemberState, req: { category: Category; desireId?: string; tags: string[] }): { id: MemberId; score: number; fit: number; why: string; whyBack: string }[] {
    const def = req.desireId ? desireById.get(req.desireId) : undefined;
    const home = neighborhood(m.area);
    const known = this.knownProfiles();
    const out: { id: MemberId; score: number; fit: number; why: string; whyBack: string }[] = [];
    for (const x of this.members.values()) {
      if (x.id === m.id || !this.eligible(x.id) || this.blocked(m.id, x.id) || this.avoid.has(pairKey(m.id, x.id))) continue;
      if ((this.declined.get(pairKey(m.id, x.id)) ?? 0) > this.now() - 30 * DAY) continue;
      const k = known.get(x.id);
      if (!k || (this.opts.selective && this.responsiveness(x.id) < this.opts.minResponsiveness)) continue;
      let s = 0, why = "", whyBack = "";
      if (def) {
        const strong = def.needsSkills.find(sk => k.strongSkills.has(sk));
        const skill = def.needsSkills.find(sk => k.skills.has(sk));
        const pool = def.pool && [...k.desires].some(d => desireById.get(d)?.pool === def.pool);
        const interest = def.needsInterests.filter(t => k.interests.has(t));
        if (strong) { s = 1; why = `they ${skillLabel(strong)}`; }
        else if (pool) { s = 0.85; why = `they want to ${def.text} too`; }
        else if (skill) { s = 0.6; why = `they say they ${skillLabel(skill).replace(/^(plays|has|teaches|gives|does|cooks|throws|shoots|sings|edits|works|loves) /, (_, v) => v.replace(/s$/, "") + " ")}`; }
        else if (interest.length) { s = 0.4 + 0.1 * interest.length; why = `they're into ${interestLabel(interest[0]!)}`; }
      } else {
        const shared = req.tags.filter(t => k.interests.has(t));
        if (shared.length) { s = 0.35 + 0.15 * shared.length; why = `they're into ${interestLabel(shared[0]!)}`; }
      }
      if (def?.category === "romance") s = 0; // romance only via the engine's opt-in checks
      if (s < 0.45) continue;
      const fit = s;
      const mins = travelMinutes(home, neighborhood(x.area));
      if (mins > 45) continue;
      s += 0.2 * (1 - mins / 45);
      const mine = known.get(m.id);
      const sharedBack = mine ? [...mine.interests].find(t => k.interests.has(t)) : undefined;
      whyBack = sharedBack ? `you're both into ${interestLabel(sharedBack)}` : "it seemed like a good fit";
      out.push({ id: x.id, score: s, fit, why, whyBack });
    }
    return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, 4);
  }

  private onPlans(m: MemberState, c: Classified) {
    const now = this.now();
    this.counters.plansAnswered++;
    const req: Request = { id: `rq${this.requests.length + 1}`, memberId: m.id, at: now, kind: "plans", category: "events", tags: c.tags, text: "plans", outcome: "answered" };
    this.requests.push(req);
    this.ctx.log("request", { requestId: req.id, memberId: m.id, kind: "plans", category: "events" });
    const known = this.knownProfiles().get(m.id);
    const tags = [...c.tags, ...(known ? [...known.interests] : [])].slice(0, 4);
    const named = NEIGHBORHOODS.find(n => c.text?.includes(n.name))?.name;
    const venues = nearbyVenues(named ?? m.area, tags, 3);
    this.send(m, copy.plans(venues.map(v => v.name)), { type: "concierge", proactive: false });
    if (m.minor || !this.eligible(m.id, { asked: true })) return;
    // Plans buddy: someone else who asked for plans in the last 3 days, nearby.
    const other = this.requests.find(r => r.kind === "plans" && r.memberId !== m.id && now - r.at < 3 * DAY && !r.oppId
      && this.eligible(r.memberId, { asked: true }) && !this.blocked(m.id, r.memberId) && travelMinutes(neighborhood(m.area), neighborhood(this.member(r.memberId).area)) <= 35);
    if (other) {
      const o = this.newOpp({
        origin: "plans", kind: "event_coattend", category: "events", objective: `go to ${venues[0]!.name} together`, detail: `going to ${venues[0]!.name} with someone`,
        participants: [m.id, other.memberId], alternates: [], primed: [m.id, other.memberId], explanations: { [m.id]: "you were both looking for plans nearby", [other.memberId]: "you were both looking for plans nearby" },
        score: 0.5, generator: "plans_buddy", tags,
      });
      req.oppId = o.id; other.oppId = o.id;
      this.startProbes(o);
    }
  }

  private concierge(m: MemberState, body: string) {
    const known = this.knownProfiles().get(m.id);
    const topic = known ? [...known.interests][0] : undefined;
    const v = nearbyVenues(m.area, topic ? [topic] : [], 2);
    this.send(m, copy.minorConcierge(topic ? interestLabel(topic) : "something new", `try ${v.map(x => x.name).join(" or ")}; they're public and run free things often`), { type: "concierge", proactive: false });
    void body;
  }

  // ================================================================== opportunities
  private newOpp(x: { id?: string; recorded?: boolean; origin: Origin; kind: Proposal["kind"]; category: Category; objective: string; detail: string; participants: MemberId[]; alternates: MemberId[]; primed: MemberId[]; requester?: MemberId; explanations: Record<MemberId, string>; score: number; generator: string; tags: string[]; components?: ScoreComponents; exploration?: boolean }): Opp {
    const now = this.now();
    const o: Opp = {
      recorded: x.recorded,
      id: x.id ?? `nw-${this.opts.seed}-${++this.oppSeq}`, origin: x.origin, kind: x.kind, category: x.category, objective: x.objective, detail: x.detail,
      // Minors policy: an alternate (a possible backfill) is never a minor or someone of unknown age,
      // whoever proposed it (search, engine, player or scenario).
      participants: [...x.participants], alternates: x.alternates.filter(a => !x.participants.includes(a) && this.matchable(a)), primed: new Set(x.primed), requester: x.requester,
      status: new Map(x.participants.map(id => [id, "probing" as PStatus])), explanations: { ...x.explanations },
      stage: "probing", deadline: now + PROBE_TTL, createdAt: now, score: x.score, components: x.components ?? ZERO, generator: x.generator,
      exploration: !!x.exploration, tags: x.tags, replacements: 0,
    };
    this.opps.set(o.id, o);
    this.counters.oppsStarted++;
    this.ctx.log("probe_started", { proposal: this.toProposal(o), origin: o.origin, primed: [...o.primed], runId: this.currentRunId });
    return o;
  }

  private toProposal(o: Opp): Proposal {
    const now = this.now();
    return {
      id: o.id, kind: o.kind, participants: [...o.participants], alternates: [...o.alternates], objective: o.objective, category: o.category,
      city: "nyc", window: { start: o.meetingAt ?? now + DAY, end: (o.meetingAt ?? now + DAY) + 4 * DAY }, score: o.score, components: o.components,
      exploration: o.exploration, explanations: { ...o.explanations }, generator: o.generator, createdAt: o.createdAt,
    };
  }

  private startProbes(o: Opp) {
    const now = this.now();
    if (!this.opts.probes) { for (const id of o.participants) o.status.set(id, "available"); return this.reveal(o); }
    for (const id of o.participants) {
      if (o.primed.has(id)) { o.status.set(id, "available"); continue; }
      this.probe(o, id, now);
    }
    this.maybeReveal(o);
  }

  private probe(o: Opp, id: MemberId, now: number) {
    const m = this.member(id);
    o.status.set(id, "probing");
    const area = o.venueArea ?? m.area;
    const when = o.category === "hobby" || o.category === "events" ? "this weekend" : "this week";
    const body = o.requester === id
      ? copy.requestConfirm(o.explanations[id] ?? "someone nearby", when)
      : o.requester
      ? copy.probeForRequest(o.detail, when, this.member(o.requester).area)
      : copy.probe(o.category, o.detail, when, area, this.probeReason(id, o));
    m.awaiting = { kind: "probe", oppId: o.id, at: now };
    m.asked++;
    this.counters.probesSent++;
    this.ctx.log("probe_sent", { oppId: o.id, memberId: id, category: o.category });
    this.send(m, body, { type: "probe", proactive: true, probe: { key: o.id, category: o.category, participants: [...o.participants], kind: o.kind, window: { start: now + DAY, end: now + 5 * DAY } } });
  }

  private onProbeAnswer(m: MemberState, oppId: string, yes: boolean) {
    const o = this.opps.get(oppId);
    if (!o || o.stage !== "probing" || o.status.get(m.id) !== "probing") return;
    m.answered++;
    this.ctx.log("probe_answer", { oppId, memberId: m.id, yes });
    if (yes) { this.counters.probeYes++; o.status.set(m.id, "available"); o.primed.add(m.id); this.send(m, "Great, I'll come back with details shortly.", { type: "info" }); }
    else { this.counters.probeNo++; o.status.set(m.id, "unavailable"); this.send(m, "No problem at all.", { type: "info" }); this.replaceOrClose(o, m.id); }
    this.maybeReveal(o);
  }

  /** Swap an unavailable participant for an alternate (never the requester), or close quietly. */
  private replaceOrClose(o: Opp, out: MemberId) {
    if (o.requester === out) return this.close(o, "requester unavailable");
    const group = o.participants.length > 2;
    let alt: MemberId | undefined;
    while (!alt && o.alternates.length && o.replacements < 3) {
      const a = o.alternates.shift()!;
      if (this.eligible(a) && !o.participants.some(p => p !== out && this.blocked(p, a))) alt = a;
    }
    if (alt) {
      o.replacements++; this.counters.replacements++;
      o.participants = o.participants.map(p => (p === out ? alt! : p));
      o.status.delete(out);
      o.explanations[alt] = o.explanations[out] ?? o.explanations[o.participants[0]!] ?? "it seemed like a good fit";
      delete o.explanations[out];
      o.deadline = this.now() + PROBE_TTL;
      this.ctx.log("probe_replaced", { oppId: o.id, out, in: alt, proposal: this.toProposal(o) });
      this.probe(o, alt, this.now());
      return;
    }
    if (group && o.participants.filter(p => o.status.get(p) !== "unavailable").length >= 3) {
      o.participants = o.participants.filter(p => p !== out); o.status.delete(out);
      return;
    }
    this.close(o, "no one available");
  }

  private maybeReveal(o: Opp) {
    if (o.stage !== "probing") return;
    if (o.participants.every(p => o.status.get(p) === "available")) this.reveal(o);
  }

  private reveal(o: Opp) {
    const now = this.now();
    o.stage = "inviting"; o.deadline = now + REVEAL_TTL;
    const areas = o.participants.map(p => this.member(p).area);
    const spot = meetingSpot(areas, o.category, o.tags);
    o.venue = spot.venue.name; o.venueArea = spot.venue.neighborhood;
    o.meetingAt = this.slot(o, now);
    this.ctx.log("venue", { oppId: o.id, venueId: spot.venue.id, venue: spot.venue.name, lat: spot.venue.lat, lng: spot.venue.lng, meetingAt: o.meetingAt, worstMinutes: spot.worst });
    this.counters.oppsRevealed++;
    if (!o.recorded) { o.recorded = true; this.ctx.recordProposal(this.toProposal(o), o.origin === "engine" ? "engine" : o.origin === "player" ? "player" : "network"); }
    for (const id of o.participants) {
      const m = this.member(id);
      const others = o.participants.filter(x => x !== id).map(x => this.member(x).display);
      const why = capitalize(o.explanations[id] ?? "it seemed like a good fit");
      o.status.set(id, "invited");
      m.awaiting = { kind: "reveal", oppId: o.id, at: now };
      m.asked++;
      this.counters.reveals++;
      // Not proactive: they said yes (or asked for it) moments ago. Without probes it is a cold invite.
      this.send(m, copy.reveal(m.first, others, why, `${o.venue} (${o.venueArea})`, whenPhrase(o.meetingAt)),
        { type: "proposal", proposalId: o.id, participants: o.participants, proactive: !this.opts.probes && !o.primed.has(id) });
    }
  }

  private onRevealAnswer(m: MemberState, oppId: string, yes: boolean) {
    const o = this.opps.get(oppId);
    if (!o || o.stage !== "inviting" || o.status.get(m.id) !== "invited") return;
    m.answered++;
    o.status.set(m.id, yes ? "yes" : "no");
    if (yes) this.counters.revealYes++; else this.counters.revealNo++;
    const group = o.participants.length > 2;
    if (!yes) {
      for (const p of o.participants) if (p !== m.id) this.declined.set(pairKey(m.id, p), this.now());
      this.send(m, "No problem, thanks for letting me know.", { type: "info" });
      if (!group) return this.close(o, "declined");
    }
    const pending = o.participants.filter(p => o.status.get(p) === "invited");
    const yesIds = o.participants.filter(p => o.status.get(p) === "yes");
    if (pending.length) { if (yes) this.send(m, "Great, I'll confirm once everyone's in.", { type: "info" }); return; }
    if (group ? yesIds.length >= 3 : yesIds.length === 2) this.schedule(o, yesIds);
    else this.close(o, "declined");
  }

  private schedule(o: Opp, going: MemberId[]) {
    o.stage = "scheduled";
    if (going.length === o.participants.length) this.counters.oppsAllYes++;
    this.counters.scheduled++;
    for (const p of o.participants) if (!going.includes(p)) o.status.set(p, "dropped");
    if (o.requester) {
      const r = this.requests.find(x => x.oppId === o.id && x.memberId === o.requester);
      if (r) { r.outcome = "fulfilled"; r.fulfilledAt = this.now(); this.counters.requestsFulfilled++; this.ctx.log("request_result", { requestId: r.id, memberId: r.memberId, outcome: "fulfilled", hours: Math.round((this.now() - r.at) / HOUR) }); }
    }
    this.ctx.recordMeeting({ proposalId: o.id, participants: going, at: o.meetingAt!, city: "nyc", kind: o.kind });
    for (const id of going) {
      const others = going.filter(x => x !== id).map(x => this.member(x).first).join(", ");
      this.send(this.member(id), copy.confirmed(others, whenPhrase(o.meetingAt!), `${o.venue} (${o.venueArea})`), { type: "scheduling", proposalId: o.id, meetingAt: o.meetingAt, proactive: false });
    }
  }

  /** A slot at least ~20 hours out: Saturday late morning for activities, otherwise a weeknight at 7pm. */
  private slot(o: Opp, now: number): number {
    const outdoorsy = o.category === "hobby" || o.category === "events" || o.tags.some(t => ["running", "hiking", "cycling", "tennis", "climbing", "photography"].includes(t));
    const from = now + 20 * HOUR;
    return outdoorsy ? nextAt(from, 11, wd => wd === "Sat" || wd === "Sun") : nextAt(from, 19, wd => !["Fri", "Sat", "Sun"].includes(wd));
  }

  private handleDrop(m: MemberState, o: Opp) {
    o.status.set(m.id, "dropped");
    this.send(m, "No worries, thanks for the heads up.", { type: "info" });
    const still = o.participants.filter(p => o.status.get(p) === "yes");
    const keep = o.participants.length > 2 && still.length >= 2;
    for (const id of still) this.send(this.member(id), copy.dropNotice(m.first, keep), { type: "cancellation", proposalId: o.id });
    if (!keep) { o.stage = "closed"; this.ctx.log("opportunity_closed", { proposalId: o.id, reason: "participant dropped" }); }
  }

  private close(o: Opp, reason: string) {
    if (o.stage === "closed" || o.stage === "done") return;
    const wasProbing = o.stage === "probing";
    o.stage = "closed";
    if (wasProbing) this.counters.oppsNotAvailable++;
    for (const id of o.participants) {
      const m = this.member(id);
      if (m.awaiting?.oppId === o.id) m.awaiting = undefined;
      // Tell people who said yes, without saying who declined (F11, F29).
      if (!wasProbing && o.status.get(id) === "yes" && reason !== "blocked") this.send(m, copy.declinedQuiet, { type: "info", proposalId: o.id });
    }
    if (o.requester) {
      const r = this.requests.find(x => x.oppId === o.id && x.memberId === o.requester);
      if (r && r.outcome === "probing") {
        r.oppId = undefined;
        this.ctx.log("request_result", { requestId: r.id, memberId: r.memberId, outcome: "waiting", reason });
        const req = this.member(r.memberId);
        if (!req.optedOut && this.trust.ok(req.id) && reason !== "requester unavailable") this.tellNoneYet(req, r);
        else r.outcome = "none";
      }
    }
    this.interactions.push({ id: o.id, kind: o.kind, category: o.category, participants: [...o.participants], at: this.now(), outcome: reason === "declined" ? "declined" : wasProbing ? "expired" : "cancelled", declinedBy: o.participants.filter(p => o.status.get(p) === "no") });
    this.ctx.log(wasProbing ? "probe_closed" : "opportunity_closed", { proposalId: o.id, reason: wasProbing ? `not sent: ${reason}` : reason });
  }

  /** Remove a member from everything open (opt-out, hold, minor signal), alternate lists included. */
  private dropMember(id: MemberId, reason: string) {
    for (const o of this.opps.values()) {
      if (OPEN_STAGES.has(o.stage) && o.alternates.includes(id)) o.alternates = o.alternates.filter(a => a !== id);
      if (!OPEN_STAGES.has(o.stage) || !o.participants.includes(id)) continue;
      if (o.stage === "probing") { o.status.set(id, "unavailable"); this.replaceOrClose(o, id); }
      else if (o.stage === "inviting") this.close(o, reason);
      else if (o.stage === "scheduled") this.handleDrop(this.member(id), o);
    }
  }

  // ================================================================== feedback & growth
  private onFeedback(m: MemberState, oppId: string | undefined, body: string) {
    const f = feedbackOf(body);
    const o = oppId ? this.opps.get(oppId) : [...this.opps.values()].reverse().find(x => x.stage === "done" && x.participants.includes(m.id));
    this.ctx.log("feedback", { memberId: m.id, proposalId: o?.id, text: body });
    this.send(m, copy.feedbackThanks, { type: "info" });
    if (!o) return;
    const others = o.participants.filter(p => p !== m.id && o.status.get(p) === "yes");
    if (f.selfNoShow) { m.noShows++; m.completedSinceNoShow = 0; }
    else m.completedSinceNoShow++;
    for (const other of others) {
      if (f.otherNoShow) { const x = this.member(other); x.noShows++; x.completedSinceNoShow = 0; }
      this.feedback.push({ id: `fb${this.feedback.length + 1}`, from: m.id, about: other, opportunityId: o.id, at: this.now(), sentiment: f.sentiment, wouldMeetAgain: f.again });
      const k = pairKey(m.id, other);
      if (f.sentiment === "negative" && !f.otherNoShow) this.avoid.add(k);
      if (f.sentiment === "positive" && o.requester === m.id && o.origin === "request") {
        const r = this.requests.find(x => x.oppId === o.id);
        const def = r?.desireId ? desireById.get(r.desireId) : undefined;
        for (const sk of def?.needsSkills ?? []) if (this.knownProfiles().get(other)?.skills.has(sk)) {
          if (!this.vouchedSkills.has(other)) this.vouchedSkills.set(other, new Set());
          this.vouchedSkills.get(other)!.add(sk); this.dirty = true;
        }
      }
      if (f.again) {
        const s = this.again.get(k) ?? new Set<MemberId>();
        s.add(m.id); this.again.set(k, s);
      }
    }
    this.interactions.push({ id: `${o.id}:fb:${m.id}`, kind: o.kind, category: o.category, participants: [...o.participants], at: this.now(), outcome: f.selfNoShow ? "no_show" : "completed", contributors: [] });
    // Growth: a good experience is the best moment to ask (at most monthly, while invites last).
    if (this.opts.growth && f.sentiment === "positive" && this.canInvite(m) && this.now() - m.lastGrowthAsk > 30 * DAY) {
      m.lastGrowthAsk = this.now();
      this.counters.growthAsks++;
      this.queueProactive(m, copy.growthAsk, { type: "growth_ask", proactive: true }, "growth");
    }
  }

  private canInvite(m: MemberState) {
    return !m.minor && this.trust.ok(m.id) && this.now() >= m.invitesBlockedUntil && m.invites.filter(t => this.now() - t < 30 * DAY).length < this.opts.invitesPerMonth;
  }

  private invite(m: MemberState, friendName: string) {
    if (!this.canInvite(m)) { this.send(m, "Thanks! You're out of invites for now; I'll let you know when you have more.", { type: "info" }); return; }
    m.invites.push(this.now());
    this.counters.invitesSent++;
    const id = this.ctx.invite?.(m.id, friendName);
    if (id) this.invitedIds.add(id);
    this.ctx.log("invite", { from: m.id, friendName, newMemberId: id ?? null });
    this.send(m, copy.inviteSent(friendName), { type: "info" });
  }

  // ================================================================== tick
  async tick(now: number) {
    const waiting = this.deferred; this.deferred = [];
    for (const d of waiting) {
      const m = this.member(d.memberId);
      if (m.optedOut || (d.meta.probe && this.opps.get(d.meta.probe.key)?.stage !== "probing")) continue;
      this.send(m, d.body, d.meta);
    }
    for (const o of [...this.opps.values()]) this.advance(o, now);
    for (const m of this.members.values()) if (m.awaiting && now - m.awaiting.at > 3 * DAY && m.awaiting.kind !== "probe" && m.awaiting.kind !== "reveal") m.awaiting = undefined;
    const p = nyParts(now);
    if (p.hour >= this.opts.runHour && p.hour < ALLOWED[1] && this.lastRunDay !== p.day) {
      this.lastRunDay = p.day;
      this.trust.decay(now);
      this.retryRequests(now);
      await this.dailyRun(now);
      this.localEncounters(now);
    }
  }

  submitProposal(p: Proposal) { this.queued.push(p); }

  private advance(o: Opp, now: number) {
    if (o.stage === "probing" && now >= o.deadline) {
      for (const p of [...o.participants]) if (o.status.get(p) === "probing") {
        this.counters.probeExpired++;
        this.ctx.log("probe_answer", { oppId: o.id, memberId: p, yes: false, expired: true });
        const m = this.member(p); m.unanswered++;
        if (m.awaiting?.oppId === o.id) m.awaiting = undefined;
        o.status.set(p, "unavailable");
        if (o.stage === "probing") this.replaceOrClose(o, p);
      }
    }
    if (o.stage === "inviting" && !o.nudged && now >= o.deadline - 12 * HOUR && now < o.deadline) {
      o.nudged = true;
      for (const p of o.participants) if (o.status.get(p) === "invited") {
        const m = this.member(p);
        m.awaiting = { kind: "reveal", oppId: o.id, at: now };
        this.send(m, copy.nudge, { type: "proposal", proposalId: o.id, participants: o.participants, proactive: false });
      }
    }
    if (o.stage === "inviting" && now >= o.deadline) {
      for (const p of o.participants) if (o.status.get(p) === "invited") { this.counters.revealExpired++; o.status.set(p, "no"); const m = this.member(p); if (m.awaiting?.oppId === o.id) m.awaiting = undefined; }
      const yesIds = o.participants.filter(p => o.status.get(p) === "yes");
      if (o.participants.length > 2 && yesIds.length >= 3) this.schedule(o, yesIds); else this.close(o, "expired");
    }
    if (o.stage === "scheduled" && o.meetingAt) {
      if (!o.reminded && now >= o.meetingAt - 4 * HOUR && now < o.meetingAt) {
        o.reminded = true;
        for (const id of o.participants) if (o.status.get(id) === "yes") this.send(this.member(id), copy.reminder(whenPhrase(o.meetingAt), `${o.venue}`), { type: "reminder", proposalId: o.id });
      }
      const h = nyParts(now).hour;
      if (!o.feedbackSent && now >= o.meetingAt + 3 * HOUR && h >= ALLOWED[0] && h < 21) {
        o.feedbackSent = true; o.stage = "done";
        for (const id of o.participants) if (o.status.get(id) === "yes") {
          const m = this.member(id);
          const others = o.participants.filter(x => x !== id && o.status.get(x) === "yes").map(x => this.member(x).first).join(" and ") || "the group";
          m.awaiting = { kind: "feedback", oppId: o.id, at: now };
          this.send(m, copy.feedbackAsk(others), { type: "feedback_request", proposalId: o.id });
        }
      }
    }
  }

  // ================================================================== engine
  private async dailyRun(now: number) {
    // Player (or scenario) proposals first: they go through the same consent flow.
    const queued = this.queued; this.queued = [];
    for (const p of queued) this.fromProposal(p, "player", now);
    const input = this.engineInput(now);
    const { proposals, runLog } = await runEngine(input, { seed: this.opts.seed, ...this.opts.engine, cities: ["nyc"] });
    this.counters.engineRuns++; this.counters.engineProposals += proposals.length;
    this.currentRunId = `${runLog.runId}-nyc`;
    this.opts.onEngineRun?.(runLog, proposals, now);
    let started = 0;
    const ranked = [...proposals].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    for (const p of ranked) {
      if (started >= this.opts.maxNewPerDay) { this.gate("daily_cap"); continue; }
      const why = this.gateReason(p);
      if (why) { this.gate(why); continue; }
      if (this.fromProposal(p, "engine", now)) started++;
    }
    this.currentRunId = undefined;
  }

  private gate(reason: string) { this.counters.gatedOut++; this.gateReasons[reason] = (this.gateReasons[reason] ?? 0) + 1; }

  /**
   * How well do the others meet what THIS member told us they want, in this category, judged only
   * from what we know (stated or confirmed)? 1 = a stated want answered by a stated skill; 0.85 =
   * the same stated want on both sides; social: 0.3 per shared known interest (max 0.8).
   */
  knownWantMet(id: MemberId, others: MemberId[], category: Category): number {
    const known = this.knownProfiles();
    const me = known.get(id);
    if (!me) return 0;
    let best = 0;
    for (const d of me.desires) {
      const def = desireById.get(d);
      if (!def || def.category !== category) continue;
      for (const o of others) {
        const k = known.get(o);
        if (!k) continue;
        if (def.category === "romance") continue; // the engine owns romance opt-in checks
        if (def.needsSkills.some(sk => k.strongSkills.has(sk))) best = Math.max(best, 1);
        else if (def.pool && [...k.desires].some(x => desireById.get(x)?.pool === def.pool)) best = Math.max(best, 0.85);
        else if (def.needsSkills.some(sk => k.skills.has(sk))) best = Math.max(best, 0.6);
        else if (def.needsInterests.some(t => k.interests.has(t))) best = Math.max(best, 0.45);
      }
    }
    if (category === "social" || category === "events") {
      for (const o of others) {
        const k = known.get(o);
        if (!k) continue;
        const shared = [...me.interests].filter(t => k.interests.has(t)).length;
        best = Math.max(best, Math.min(0.8, shared * 0.3));
      }
    }
    return best;
  }

  /** Every participant must have a want we can name that the others meet (the 90% rule). */
  private wantsMet(participants: MemberId[], category: Category, primedOk: Set<MemberId> = new Set()): boolean {
    if (!this.opts.selective) return true;
    return participants.every(id => primedOk.has(id) || this.knownWantMet(id, participants.filter(x => x !== id), category) >= this.opts.minWantMet);
  }

  /**
   * The reason a probe gives, built only from what we know about the OTHER people and never from
   * engine text (which can name people): "someone who wants to start a rock band too".
   */
  probeReason(id: MemberId, o: Opp): string | undefined {
    const known = this.knownProfiles();
    const me = known.get(id);
    const others = o.participants.filter(x => x !== id).map(x => known.get(x)).filter((k): k is KnownProfile => !!k);
    if (!me || !others.length) return undefined;
    const who = others.length > 1 ? "people" : "someone";
    for (const d of me.desires) {
      const def = desireById.get(d);
      if (!def || def.category !== o.category || def.category === "romance") continue;
      if (others.some(k => def.needsSkills.some(sk => k.strongSkills.has(sk)))) return `${who} who can help you ${def.text}`;
      if (def.pool && others.some(k => [...k.desires].some(x => desireById.get(x)?.pool === def.pool))) return `${who} who also wants to ${def.text}`;
    }
    const shared = [...me.interests].find(t => others.some(k => k.interests.has(t)));
    return shared ? `${who} who's into ${interestLabel(shared)} too` : undefined;
  }

  /** Skeptical gate on engine output. Returns why a proposal is NOT started, or undefined. */
  private gateReason(p: EngineProposal): string | undefined {
    if (p.participants.some(id => !this.eligible(id))) return "participant_unavailable";
    if (!this.opts.selective) return undefined;
    if (p.score < this.opts.minScore) return "score";
    const known = this.knownProfiles();
    for (const id of p.participants) {
      const k = known.get(id);
      const facts = k ? k.interests.size + k.skills.size + (k.intents > 0 ? 2 : 0) : 0;
      if (facts < this.opts.minKnowledge) return "thin_profile";
    }
    if (p.components.confidence < 0.35) return "low_confidence";
    if (!this.wantsMet(p.participants, p.category ?? "social")) return "want_not_named";
    if (p.participants.some(id => this.responsiveness(id) < this.opts.minResponsiveness)) return "unresponsive";
    if (!p.anchor || !["intent", "event"].includes(p.anchor.type)) {
      // Speculative (no one asked): only for well-known, warm or clearly overlapping people.
      if (p.components.warmPath < 0.3 && p.components.fit < 0.45) return "speculative";
    }
    for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) {
      const k = pairKey(p.participants[i]!, p.participants[j]!);
      if (this.avoid.has(k) || this.blocked(p.participants[i]!, p.participants[j]!) || (this.declined.get(k) ?? 0) > this.now() - 60 * DAY) return "pair_history";
    }
    return undefined;
  }

  private fromProposal(p: Proposal, origin: Origin, now: number): Opp | undefined {
    if (p.participants.some(id => !this.eligible(id))) { if (origin === "player") this.ctx.log("proposal_skipped", { proposalId: p.id, reason: "participant unavailable" }); return undefined; }
    const tags = [...new Set(p.participants.flatMap(id => [...(this.knownProfiles().get(id)?.interests ?? [])]))].slice(0, 6);
    // Engine explanations may name the other person ("Sam K.: lives near..."); members only ever see
    // names at the reveal, and only of the people in it, so strip every member name first.
    const explanations: Record<MemberId, string> = {};
    for (const [id, text] of Object.entries(p.explanations ?? {})) explanations[id] = this.stripNames(text);
    const o = this.newOpp({
      // A player's (or scenario's) proposal keeps its id: the world already recorded it.
      ...(origin === "player" ? { id: p.id, recorded: true } : {}),
      origin, kind: p.kind, category: p.category ?? "social", objective: p.objective, detail: detailOf(p),
      participants: p.participants, alternates: p.alternates ?? [], primed: [], explanations,
      score: p.score, generator: origin === "player" ? "player" : p.generator, tags, components: p.components, exploration: p.exploration,
    });
    void now;
    this.startProbes(o);
    return o;
  }

  /** The engine's input: the public snapshot plus everything the Network has learned and observed. */
  engineInput(now: number): EngineInput {
    const snap = this.ctx.snapshot();
    const nyc = new Set(snap.members.filter(m => m.homeCity === "nyc").map(m => m.id));
    const facets: Facet[] = snap.facets.filter(f => nyc.has(f.memberId));
    const intents: Intent[] = snap.intents.filter(i => nyc.has(i.memberId));
    for (const m of this.members.values()) {
      if (!nyc.has(m.id)) continue;
      const have = new Set(facets.filter(f => f.memberId === m.id).flatMap(f => f.tags));
      const add = (kind: Facet["kind"], tag: string, value: string) => {
        if (have.has(tag)) return;
        facets.push({ id: `${m.id}:l:${tag}`, memberId: m.id, kind, value, tags: [tag], scope: "matchable", provenance: "said", confidence: 0.85, validFrom: now, source: "chat", observedAt: now, inferred: false, confirmedByMember: true });
      };
      m.learned.interests.forEach(t => add("interest", t, interestLabel(t)));
      m.learned.skills.forEach(t => add("skill", t, skillLabel(t)));
      for (const d of m.learned.desires) {
        if (intents.some(i => i.memberId === m.id && i.objective === desireById.get(d)?.text)) continue;
        const def = desireById.get(d);
        if (def) intents.push({ id: `${m.id}:li:${d}`, memberId: m.id, objective: def.text, category: def.category, details: `format: ${def.format}; tags: ${[...def.needsInterests, ...def.needsSkills, def.pool ?? ""].filter(Boolean).join(",")}`, horizonDays: 60, status: "active", createdAt: now });
      }
    }
    const holds = [...this.members.values()].filter(m => !this.trust.ok(m.id) || m.minorSignal).map(m => ({ memberId: m.id, from: now - HOUR }));
    const reliability = Object.fromEntries([...this.members.values()].filter(m => m.noShows > 0).map(m => [m.id, { noShows: m.noShows, completedSinceLastNoShow: m.completedSinceNoShow }]));
    const recent = [...this.opps.values()].filter(o => now - o.createdAt < 30 * DAY).map(o => this.toProposal(o));
    const engineInput: EngineInput = {
      now, members: snap.members.filter(m => nyc.has(m.id)), facets, intents, presence: snap.presence.filter(p => nyc.has(p.memberId)),
      edges: [
        ...snap.edges.filter(e => nyc.has(e.from) && nyc.has(e.to)),
        ...[...this.again.entries()].filter(([, s]) => s.size >= 2).map(([k]) => { const [a, b] = k.split("|") as [string, string]; return { from: a, to: b, type: "would_interact_again" as const, strength: 0.8, explicit: false, createdAt: now }; }),
        ...[...this.avoid].map(k => { const [a, b] = k.split("|") as [string, string]; return { from: a, to: b, type: "avoid" as const, strength: 1, explicit: false, createdAt: now }; }),
      ],
      recentProposals: recent, safetyHolds: holds, feedback: this.feedback, interactions: this.interactions, reliability,
    };
    return engineInput;
  }

  /**
   * Growth tasks, plain and simple (at most `maxGrowthAsksPerDay` a day, one per member per 21 days):
   *  - gap asks: where requests went unmet this week, ask nearby members who share that interest;
   *  - plain asks: engaged members who've been here 10+ days and were never asked.
   */
  private growthTasks(now: number) {
    if (!this.opts.growth) return;
    let budget = this.opts.maxGrowthAsksPerDay;
    const known = this.knownProfiles();
    const unmet = this.requests.filter(r => r.kind === "people" && r.outcome === "none" && now - r.at < 7 * DAY);
    const ask = (m: MemberState, body: string, kind: string) => {
      m.lastGrowthAsk = now; budget--; this.counters.growthAsks++;
      this.ctx.log("growth_ask", { memberId: m.id, kind });
      this.queueProactive(m, body, { type: "growth_ask", proactive: true }, "growth");
    };
    const ready = (m: MemberState) => this.canInvite(m) && now - m.lastGrowthAsk > 21 * DAY && m.stage === "active" && !m.optedOut && !m.awaiting
      && m.proactive.filter(t => now - t < 7 * DAY).length < (BUDGET[m.state] ?? BUDGET.normal!).n;
    for (const r of unmet) {
      if (budget <= 0) return;
      const def = r.desireId ? desireById.get(r.desireId) : undefined;
      const tags = def ? def.needsInterests : r.tags;
      const area = this.member(r.memberId).area;
      const helper = [...this.members.values()].find(x => x.id !== r.memberId && ready(x) && travelMinutes(neighborhood(area), neighborhood(x.area)) <= 30
        && (tags.some(t => known.get(x.id)?.interests.has(t)) || (def?.pool && [...(known.get(x.id)?.desires ?? [])].some(d => desireById.get(d)?.pool === def.pool))));
      if (helper) ask(helper, copy.growthGap(area, def ? def.text.replace(/^(find|meet|get|be part of|try|learn to|start) /, "") : "people to hang out with"), "gap");
    }
    for (const m of this.members.values()) {
      if (budget <= 0) return;
      if (m.lastGrowthAsk === 0 && now - m.joinedAt > 10 * DAY && m.msgsIn >= 4 && ready(m)) ask(m, copy.growthPlain, "plain");
    }
  }

  /** Encounters the Network composes itself: second encounters and newcomer welcomes. */
  private localEncounters(now: number) {
    this.growthTasks(now);
    for (const [k, s] of this.again) {
      if (s.size < 2) continue;
      const [a, b] = k.split("|") as [MemberId, MemberId];
      this.again.delete(k);
      if (!this.eligible(a) || !this.eligible(b)) continue;
      const o = this.newOpp({ origin: "second_encounter", kind: "second_encounter", category: "social", objective: "meet again", detail: "meeting up again with someone you clicked with", participants: [a, b], alternates: [], primed: [], explanations: { [a]: "you both said you'd meet again", [b]: "you both said you'd meet again" }, score: 0.8, generator: "second_encounter", tags: [] });
      this.startProbes(o);
    }
    // Newcomer welcome: members who joined in the last week and finished onboarding, paired with a
    // reliable member nearby who shares an interest.
    const known = this.knownProfiles();
    for (const m of this.members.values()) {
      if (m.stage !== "active" || now - m.joinedAt > 7 * DAY || now - m.joinedAt < DAY || !this.eligible(m.id) || !m.invitedBy) continue;
      if ([...this.opps.values()].some(o => o.participants.includes(m.id))) continue;
      const mine = known.get(m.id);
      if (!mine) continue;
      const host = [...this.members.values()].filter(x => x.id !== m.id && x.id !== m.invitedBy && this.eligible(x.id) && x.noShows === 0 && now - x.joinedAt > 7 * DAY
        && travelMinutes(neighborhood(m.area), neighborhood(x.area)) <= 30 && [...(known.get(x.id)?.interests ?? [])].some(t => mine.interests.has(t)))
        .sort((a, b) => travelMinutes(neighborhood(m.area), neighborhood(a.area)) - travelMinutes(neighborhood(m.area), neighborhood(b.area)))[0];
      if (!host) continue;
      const shared = [...mine.interests].find(t => known.get(host.id)!.interests.has(t))!;
      const o = this.newOpp({ origin: "newcomer_welcome", kind: "newcomer_welcome", category: "social", objective: "welcome coffee", detail: "a welcome coffee with a newer member", participants: [m.id, host.id], alternates: [], primed: [], explanations: { [m.id]: `they're into ${interestLabel(shared)} too and live nearby`, [host.id]: `they just joined and are into ${interestLabel(shared)}` }, score: 0.6, generator: "newcomer_welcome", tags: [shared] });
      this.startProbes(o);
    }
  }

  // ================================================================== helpers
  /** Known profile per member: snapshot facets (what onboarding/sources captured) + learned. */
  private knownCache?: { at: number; map: Map<MemberId, KnownProfile> };
  private knownProfiles() {
    const snap = this.snapshotCached();
    if (this.knownCache) return this.knownCache.map;
    const now = this.now();
    const map = new Map<MemberId, KnownProfile>();
    const get = (id: MemberId) => { let x = map.get(id); if (!x) { x = { interests: new Set(), skills: new Set(), strongSkills: new Set(), desires: new Set(), intents: 0 }; map.set(id, x); } return x; };
    const skillSources = new Map<string, Set<string>>();
    const interestTags = new Set(INTERESTS.map(i => i.tag)), skillTags = new Set(SKILLS.map(s => s.tag));
    for (const f of snap.facets) {
      if (f.scope === "agent_private") continue;
      // Skeptical: an unconfirmed inference (e.g. a skill guessed from a LinkedIn title) is not
      // evidence of what someone wants or can do until the member confirms it.
      if (f.inferred && !f.confirmedByMember) continue;
      const x = get(f.memberId);
      for (const t of f.tags) {
        if (interestTags.has(t)) x.interests.add(t);
        if (skillTags.has(t) && f.kind === "skill") {
          x.skills.add(t);
          const k = `${f.memberId}|${t}`;
          if (!skillSources.has(k)) skillSources.set(k, new Set());
          skillSources.get(k)!.add(f.source ?? f.provenance);
        }
      }
    }
    // A skill is strong evidence only when corroborated: two independent sources (said in chat
    // AND seen on a connected profile), or confirmed by a good experience with it. People overclaim.
    for (const [k, srcs] of skillSources) {
      const [id, t] = k.split("|") as [MemberId, string];
      if (srcs.size >= 2 || this.vouchedSkills.get(id)?.has(t)) get(id).strongSkills.add(t);
    }
    for (const i of snap.intents) {
      if (i.status !== "active") continue;
      const x = get(i.memberId); x.intents++;
      const def = [...desireById.values()].find(d => d.text === i.objective);
      if (def) x.desires.add(def.id);
    }
    for (const m of this.members.values()) {
      const x = get(m.id);
      m.learned.interests.forEach(t => x.interests.add(t)); m.learned.skills.forEach(t => x.skills.add(t));
      this.vouchedSkills.get(m.id)?.forEach(t => x.strongSkills.add(t));
      m.learned.desires.forEach(t => { x.desires.add(t); x.intents++; });
    }
    this.knownCache = { at: now, map };
    return map;
  }

  /** Is the member in New York for all of [from, to]? Announced trips elsewhere say no. */
  inNyc(id: MemberId, from: number, to: number): boolean {
    const snap = this.snapshotCached();
    return !snap.presence.some(p => p.memberId === id && p.type === "temporary" && p.city !== "nyc" && (p.from ?? 0) < to && (p.to ?? Infinity) > from);
  }
  private snapCache?: { at: number; snap: WorldSnapshot };
  /** The public snapshot, rebuilt at most every 20 sim minutes or when something we learned changed. */
  private snapshotCached(): WorldSnapshot {
    const now = this.now();
    if (!this.snapCache || this.dirty || now - this.snapCache.at > 20 * MINUTE || now < this.snapCache.at) {
      this.snapCache = { at: now, snap: this.ctx.snapshot() }; this.knownCache = undefined; this.dirty = false;
    }
    return this.snapCache.snap;
  }
  /** Set when members join or we learn something (invalidates the caches). */
  private dirty = true;

  /** Share of our asks this member answers (Laplace prior: 2 of 2), the best predictor of a silent reveal. */
  responsiveness(id: MemberId): number { const m = this.members.get(id); return m ? (m.answered + 2) / (m.asked + 2) : 1; }

  /** Known member, an adult by every age signal the Network has (minors and unknown ages fail closed). */
  private matchable(id: MemberId): boolean {
    const m = this.members.get(id);
    return !!m && !m.minor && !m.minorSignal;
  }

  /** Can this member be put into a new opportunity right now (and be here for it this week)? */
  eligible(id: MemberId, o: { asked?: boolean } = {}): boolean {
    const m = this.members.get(id);
    if (!m || m.minor || m.optedOut || m.stage === "new" || !this.trust.ok(id) || m.unanswered >= 2) return false;
    if (!this.inNyc(id, this.now(), this.now() + 6 * DAY)) return false;
    if (this.busy(id)) return false;
    if (o.asked) return true; // they asked for this: replies aren't proactive
    const b = BUDGET[m.state] ?? BUDGET.normal!;
    return m.proactive.filter(t => this.now() - t < b.days * DAY).length < b.n;
  }
  busy(id: MemberId) {
    for (const o of this.openOpps()) if (o.participants.includes(id) && !["unavailable", "no", "dropped"].includes(o.status.get(id) ?? "")) return true;
    return false;
  }
  private openOpps(): Opp[] { return [...this.opps.values()].filter(o => OPEN_STAGES.has(o.stage)); }
  private blocked(a: MemberId, b: MemberId) { return this.blocks.has(pairKey(a, b)); }

  private allowedNow(m: MemberState) {
    const h = nyParts(this.now()).hour;
    if (h < ALLOWED[0] || h >= ALLOWED[1]) return false;
    const [qs, qe] = m.quietHours;
    return !(qs <= qe ? h >= qs && h < qe : h >= qs || h < qe);
  }

  private queueProactive(m: MemberState, body: string, meta: SimMeta, awaiting?: "growth") {
    if (awaiting) m.awaiting = { kind: awaiting, at: this.now() };
    this.send(m, body, meta);
  }

  private send(m: MemberState, body: string, meta: SimMeta) {
    if (m.optedOut) return;
    if (meta.proactive && !this.allowedNow(m)) { this.deferred.push({ memberId: m.id, body, meta }); return; }
    if (meta.proactive) m.proactive.push(this.now());
    this.ctx.send(m.id, body, { meta, idempotencyKey: `${m.id}:${++this.seq}` });
  }

  member(id: MemberId): MemberState {
    let m = this.members.get(id);
    if (!m) {
      let snap = this.snapshotCached();
      if (!snap.members.some(x => x.id === id)) { this.dirty = true; snap = this.snapshotCached(); }
      const mem = snap.members.find(x => x.id === id);
      const name = mem?.name ?? id;
      const [first, last] = name.split(" ");
      this.fullNames.set(id, name);
      const home = snap.presence.find(p => p.memberId === id && p.type === "home")?.areas[0];
      m = {
        id, first: first ?? name, display: last ? `${first} ${last[0]}.` : name, area: home ?? "Midtown",
        quietHours: mem?.prefs.quietHours ?? [21, 9], state: mem?.state ?? "normal",
        // Fail closed: no visible adult age means treated as a minor.
        minor: !canBeMatched(mem?.age), minorSignal: false, stage: "new",
        optedOut: false, unanswered: 0, proactive: [], lastInbound: 0, joinedAt: this.now(), invitedBy: mem?.invitedBy,
        invites: [], invitesBlockedUntil: 0, lastGrowthAsk: 0, lastInterview: 0,
        learned: { interests: new Set(), skills: new Set(), desires: new Set() }, noShows: 0, completedSinceNoShow: 0, msgsIn: 0, asked: 0, answered: 0,
      };
      this.members.set(id, m);
    }
    return m;
  }
  memberList() { return [...this.members.values()]; }
}

interface KnownProfile { interests: Set<string>; skills: Set<string>; strongSkills: Set<string>; desires: Set<string>; intents: number }

function interestLabel(tag: string) { return INTERESTS.find(i => i.tag === tag)?.label ?? tag.replace(/_/g, " "); }
function skillLabel(tag: string) { const l = SKILLS.find(s => s.tag === tag)?.label ?? tag; return l; }
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** What the opportunity is, in plain words, for probes ("a small group dinner", not engine jargon). */
function detailOf(p: Proposal): string {
  const obj = (p.objective ?? "").toLowerCase().replace(/^[a-z-]+ intro: /, "").replace(/^(intro|group|help|event_coattend):\s*/, "");
  if (p.kind === "group") return `a small group ${obj.replace(/^(a |an )/, "") || "meetup"}`;
  if (p.kind === "help") return "helping someone out with a quick favor";
  if (p.kind === "newcomer_welcome") return "a welcome coffee with someone new to the Network";
  return obj && obj.length < 60 ? obj.replace(/^(meet|find) /, "meeting ") : "";
}

export type { WorldSnapshot };
