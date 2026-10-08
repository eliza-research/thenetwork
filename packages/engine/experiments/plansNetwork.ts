// HARNESS ONLY (2026-10-08 plans experiment). The attention-v1.2 harness network
// (attentionNetwork.ts, unchanged and inherited) plus the planner (src/plans.ts):
// - capture: standing availability stated at onboarding and an opt-in weekly "what's your week
//   like?" check-in (a profiling ask: never on the cap, on the Blooio streak, outside quiet hours);
// - a daily planner run per city (09:00 local) over members with a stated or inferred window;
// - each plan becomes plan_probe items in the hold queue (simulated reviewer: approved), sent through
//   the same composer, cap, quiet hours and Blooio rules as every other item; the probe carries the
//   plan's time; quorum -> the booked-plan reveal ("You're in: ... Reply if you can't make it");
//   backfill from alternates; fallbacks (smaller, solo event, next week); crews.
// The inherited class's private methods are reached through `this.s` (an `any` view) and patched
// per instance for plan proposals only, so the baseline path is byte-for-byte the attention harness.
import { DAY, HOUR, type City, type MemberId } from "@thenetwork/core";
import type { InboundMessage } from "../../sim/src/network.ts";
import { fmtLocal } from "../../sim/src/time.ts";
import { activityById, type Venue } from "../src/activities.ts";
import * as A from "../src/attention.ts";
import { resolveConfig, resolvePlans, type AttentionConfig, type PlansConfig, type PlansConfigInput } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { eligibilityFor } from "../src/filters.ts";
import { localParts } from "../src/outreach.ts";
import * as P from "../src/plans.ts";
import { objectivesFor } from "../src/taxonomy.ts";
import type { AttentionItem, AttentionLedgerEntry, EngineInput, EngineProposal, HeldItem } from "../src/types.ts";
import { World } from "../src/world.ts";
import { AttentionNetwork, type AttentionNetOptions } from "./attentionNetwork.ts";

export interface PlanNetOptions extends AttentionNetOptions {
  plans?: PlansConfigInput | false;
  venues?: Venue[];
  /** HARNESS: weekly check-in opt-in, its answer, and standing availability at onboarding. */
  checkInOptIn?: (id: MemberId) => boolean;
  checkInAnswer?: (id: MemberId, slots: A.TimeSlot[]) => A.TimeSlot[];
  standing?: (id: MemberId, at: number) => A.StandingAvailability[];
  /** HARNESS: the post-plan factual answer and "anyone you'd do this again with?" (who came, who was positive). */
  planFeedback?: (plan: P.Plan, going: MemberId[]) => { attended: MemberId[]; positive: MemberId[] };
  /** HARNESS: does this member opt in to a proposed crew (offered in the reply to their post-plan answer)? */
  crewOptIn?: (id: MemberId, crew: P.Crew) => boolean;
}

const TZ: Record<City, string> = { sf: "America/Los_Angeles", nyc: "America/New_York", la: "America/Los_Angeles" };
const ENGINE_CFG = resolveConfig({});
const CHECKIN_TEXT = "Quick one: what's your week like? Tell me when you're free and what you're up for, and I'll try to put a small plan together. Skip it anytime.";

interface Live { run: P.PlanRun; plan: P.Plan; probed: Set<MemberId>; bookedAt?: number; going: MemberId[]; fallback?: string; feedbackDone?: boolean }

export class PlanNetwork extends AttentionNetwork {
  readonly pcfg?: PlansConfig;
  readonly live = new Map<string, Live>();
  readonly planIds = new Set<string>();
  readonly crews: P.Crew[] = [];
  readonly history: P.PlanOutcomeRecord[] = [];
  private standing = new Map<MemberId, A.StandingAvailability[]>();
  readonly stated = new Map<MemberId, P.StatedWindows>();
  private checkInPending = new Map<MemberId, number>();
  private checkInWeek = new Map<MemberId, number>();
  private carry: { memberId: MemberId; activityId: string; until: number }[] = [];
  private lastRun = new Map<City, string>();
  private lastPlannedAt = new Map<MemberId, number>();
  /** The plan allowance (founder decision 2026-10-08): plan items held and sent in their own lane, and the plan invites sent. */
  readonly planHold = new Map<MemberId, HeldItem[]>();
  readonly planInviteIds = new Set<string>();
  private offeredCrews = new Set<string>();
  private planServed = new Map<MemberId, string>();
  /** Age gate for the plan bench: a member the Network now knows is a minor (or of unknown age) is never backfilled. */
  private readonly runOpts: P.PlanRunOpts = { canMatch: id => !this.x.member(id).minor };
  readonly planStats = {
    runs: 0, plans: 0, partnerPlans: 0, eventPlans: 0, crewSessions: 0, crewsFormed: 0, probesSent: 0, planYes: 0, planNo: 0, cantMakeTime: 0,
    booked: 0, bookedSmaller: 0, joins: 0, backfills: 0, fallbacks: { smaller: 0, solo_event: 0, next_week: 0, none: 0 } as Record<string, number>,
    confirmedSeats: 0, backouts: 0, cancelled: 0, checkInsSent: 0, checkInAnswers: 0, checkInQuiet: 0, statedMembers: new Set<MemberId>(), standingMembers: 0,
    minorsInPlans: 0, probeNameLeaks: 0, conflictsAvoided: 0, allowanceInvites: 0, introLanePlanItems: 0, crewOffers: 0, crewOptIns: 0, crewsDeclined: 0, probedPlans: new Set<string>(), demandMembers: new Set<MemberId>(), plannedMembers: new Set<MemberId>(),
  };

  constructor(private po: PlanNetOptions) {
    super(po);
    if (po.plans === false || po.plans === undefined) return;
    this.pcfg = resolvePlans(po.plans);
    const self = this as any;
    const isPlan = (pid?: string) => !!pid && this.planIds.has(pid);
    const answer = self.answer.bind(self);
    self.answer = (pid: string, id: MemberId, yes: boolean, why: string) => (isPlan(pid) ? this.planAnswer(pid, id, yes, why) : answer(pid, id, yes, why));
    const itemText = self.itemText.bind(self);
    self.itemText = (w: World, it: AttentionItem, now: number) => (it.kind === "plan_probe" && isPlan(it.sourceProposalId) ? this.planProbeText(w, it, now) : itemText(w, it, now));
    const onReveal = self.onReveal.bind(self);
    self.onReveal = (pid: string, id: MemberId, yes: boolean, now: number) => (isPlan(pid) ? this.planReveal(pid, id, yes) : onReveal(pid, id, yes, now));
    const onDropped = self.onDropped.bind(self);
    self.onDropped = (it: AttentionItem, reason: string) => {
      if (it.kind === "plan_probe" && isPlan(it.sourceProposalId)) { self.bump(self.stats.dropped, `plan:${reason.split(":")[0]}`); this.planAnswer(it.sourceProposalId!, it.memberId, false, reason); return; }
      onDropped(it, reason);
    };
    // The Network knows its own booked plans: a pair meeting is never set on top of one (those hours count as away).
    const evidence = self.evidence.bind(self);
    self.evidence = (w: World, id: MemberId, tz: string, now: number) => {
      const ev = evidence(w, id, tz, now);
      const booked = [...this.live.values()].filter(l => l.bookedAt !== undefined && l.going.includes(id) && l.plan.window.end > now).map(l => ({ start: l.plan.window.start - 3 * HOUR, end: l.plan.window.end + 3 * HOUR }));
      return booked.length ? { ...ev, away: [...(ev.away ?? []), ...booked] } : ev;
    };
    const scheduleFlow = self.scheduleFlow.bind(self);
    self.scheduleFlow = (fl: any, going: MemberId[], now: number, notify?: boolean) => {
      if (fl.times && !this.planIds.has(fl.p.id)) fl.times = fl.times.filter((t: A.TimeSlot) => !going.some(id => this.conflict(id, t.start, fl.p.id)));
      return scheduleFlow(fl, going, now, notify);
    };
    // The plan allowance: plan invites sent in the plan lane never count against the intro cap. The intro
    // composer sees the ledger without them (its cap is unchanged); the member's two-unanswered state
    // (view().onlyWhenAsked, from the full ledger and the stub's unanswered count) still includes them.
    if (this.pcfg.allowance.enabled) {
      const attempt = self.attempt.bind(self);
      self.attempt = (...args: unknown[]) => {
        const full = self.ledger as AttentionLedgerEntry[];
        const view = full.filter(e => !this.planInviteIds.has(e.messageId));
        const n = view.length;
        self.ledger = view;
        try { return attempt(...args); } finally { self.ledger = full; for (const e of view.slice(n)) full.push(e); }
      };
    }
    // A plan does not need every invitee: another invitee being busy never holds back this member's probe.
    const busy = self.busy.bind(self);
    self.busy = (id: MemberId, except?: string) => (except && isPlan(except) ? false : busy(id, except));
  }
  private get x(): any { return this as any; }

  override async tick(now: number) {
    await super.tick(now);
    if (!this.pcfg) return;
    this.captureTick(now);
    for (const [pid, l] of this.live) this.liveTick(pid, l, now);
    if (this.pcfg.allowance.enabled) this.planLane(now);
    for (const city of ["sf", "nyc"] as City[]) {
      const lp = localParts(now, TZ[city]);
      const key = `${lp.year}-${lp.month}-${lp.day}`;
      if (lp.hour >= 9 && this.lastRun.get(city) !== key && this.pcfg.runDays.includes((lp.weekday + 1) % 7)) { this.lastRun.set(city, key); this.runPlanner(city, now); }
    }
  }

  // ------------------------------------------------------------------ capture
  private captureTick(now: number) {
    const snapMembers = this.x.snapMembers?.byId as Map<MemberId, any> | undefined;
    if (!snapMembers) return;
    for (const [id, mem] of snapMembers) {
      if (!(typeof mem.age === "number" && mem.age >= 18)) continue;
      if (!this.standing.has(id)) { const s = this.po.standing?.(id, mem.joinedAt ?? now) ?? []; this.standing.set(id, s); if (s.length) this.planStats.standingMembers++; }
      const pend = this.checkInPending.get(id);
      if (pend !== undefined && now - pend > 24 * HOUR) { this.checkInPending.delete(id); const m = this.x.member(id); if (m.awaiting?.kind === "checkin") m.awaiting = undefined; }
      if (!this.po.checkInOptIn?.(id)) continue;
      // Opt-in weekly check-in at the member's local Sunday 17:00 (cfg.availability.weeklyCheckIn), once per week.
      const tz = TZ[mem.homeCity as City];
      const lp = localParts(now, tz), jd = (lp.weekday + 1) % 7;
      const ci = this.cfg.availability.weeklyCheckIn;
      if (jd !== ci.day || lp.hour < ci.hour || lp.hour >= ci.hour + 3) continue;
      const week = Math.floor(now / (7 * DAY));
      if (this.checkInWeek.get(id) === week) continue;
      const m = this.x.member(id);
      if (m.optedOut || m.awaiting || m.unanswered >= 2) continue;
      const v = this.x.view(id, now) as A.MemberAttention | undefined;
      if (!v || v.onlyWhenAsked) continue;
      if (A.inMemberQuietHours(v, now, this.cfg)) continue;
      // A profiling ask: not an interruption (decision 3), but it needs the Blooio reservation like one.
      if (!A.canInterrupt(this.x.convOf(id), this.cfg)) continue;
      this.checkInWeek.set(id, week);
      // An opt-in profiling ask, not an interruption (founder decision 3); still carries a pause path (PRD PH-003).
      const msg = this.x.send(m, A.withPausePath(CHECKIN_TEXT), { type: "question", proactive: false, checkIn: true });
      if (!msg || msg.status !== "delivered") continue;
      if (A.inMemberQuietHours(v, now, this.cfg)) this.planStats.checkInQuiet++;
      this.ledger.push({ messageId: msg.id, memberId: id, at: now, kind: "question", itemIds: [], countsAgainstCap: false });
      this.planStats.checkInsSent++;
      m.awaiting = { kind: "checkin", pid: "" };
      this.checkInPending.set(id, now);
    }
  }

  override async onInbound(msg: InboundMessage) {
    const m = this.pcfg ? this.x.member(msg.memberId) : undefined;
    if (m && !msg.keyword && m.awaiting?.kind === "checkin" && this.checkInPending.has(msg.memberId)) {
      const now = this.x.now();
      const c = this.x.convOf(msg.memberId);
      c.outboundSinceInbound = 0; c.lastInboundAt = now;
      m.lastInbound = now; m.unanswered = 0; m.awaiting = undefined;
      this.checkInPending.delete(msg.memberId);
      const tz = TZ[m.city as City];
      const slots = A.candidateSlots(tz, now, { window: { start: now, end: now + 7 * DAY } }, this.cfg);
      const windows = this.po.checkInAnswer?.(msg.memberId, slots) ?? [];
      this.stated.set(msg.memberId, { windows, at: now, until: now + 7 * DAY });
      this.planStats.checkInAnswers++;
      if (windows.length) this.planStats.statedMembers.add(msg.memberId);
      return;
    }
    return super.onInbound(msg);
  }

  // ------------------------------------------------------------------ planner
  private evidenceFor(id: MemberId, tz: string, now: number, w: World): P.PlanEvidence | undefined {
    const standing = [...(this.standing.get(id) ?? []), ...A.standingFromFacets(w.input.facets.filter(f => f.memberId === id), now)];
    const history = (this.x.availHistory.get(id) ?? []) as A.AvailabilityEvidence["history"];
    const stated = this.stated.get(id);
    if (!standing.length && !history?.length && !(stated && stated.until > now)) return undefined;
    const v = this.x.view(id, now) as A.MemberAttention | undefined;
    return { memberId: id, tz, quietHours: v?.quietHours, standing, history, ...(stated && stated.until > now ? { stated } : {}) };
  }

  private runPlanner(city: City, now: number) {
    this.planStats.runs++;
    const tz = TZ[city];
    const input = this.engineView(this.x.ctx.snapshot() as EngineInput);
    const w = new World(input, { ...ENGINE_CFG, cities: [city] }, localEmbed);
    const busyIds = new Set<MemberId>();
    for (const l of this.live.values()) {
      if (l.run.stage === "closed" || l.plan.window.end < now) continue;
      for (const id of Object.keys(l.run.answers)) if (l.run.answers[id] !== "no") busyIds.add(id);
    }
    const evidence = new Map<MemberId, P.PlanEvidence>();
    for (const mi of w.members.values()) {
      if (mi.m.homeCity !== city) continue;
      const ev = this.evidenceFor(mi.m.id, tz, now, w);
      if (ev) evidence.set(mi.m.id, ev);
    }
    const opps = [...this.x.opps.values()].filter((o: any) => o.stage === "scheduled" && o.meetingAt);
    const busyAt = (id: MemberId, s: A.TimeSlot) => opps.some((o: any) => o.invites.get(id)?.status === "yes" && Math.abs(o.meetingAt - s.start) < 4 * HOUR);
    // Crew sessions first (each is opt-in by reply), then one-off plans.
    for (const crew of this.crews) this.maybeCrewSession(crew, w, now, busyIds);
    this.carry = this.carry.filter(c => c.until > now);
    const served = new Set<MemberId>();
    for (const [id, q] of this.hold) if (q.some(it => it.sourceProposalId && !this.planIds.has(it.sourceProposalId))) served.add(id);
    for (const [pid, fl] of this.flows as Map<string, any>) if (!this.planIds.has(pid) && fl.stage !== "closed") for (const id of fl.p.participants) served.add(id);
    const plans = P.planProposals(w, { now, city, tz, evidence, served, venues: this.po.venues ?? [], busyAt, exclude: busyIds, carry: this.carry, lastPlannedAt: this.lastPlannedAt }, this.pcfg!, this.cfg);
    for (const id of evidence.keys()) this.planStats.demandMembers.add(id);
    for (const plan of plans) this.submitPlan(plan, now);
  }

  private maybeCrewSession(crew: P.Crew, w: World, now: number, busyIds: Set<MemberId>) {
    if (crew.handedOff) return;
    if ([...this.live.values()].some(l => l.plan.crewId === crew.id && l.plan.window.end > now)) return;
    if (crew.sessions.length >= this.pcfg!.crews.handOffAfterSessions) { crew.handedOff = true; return; }
    const v = (this.po.venues ?? []).find(x => x.id === crew.venueId);
    const plan = P.crewSessionPlan(crew, now, { name: v?.name ?? "the usual place", ...(v?.area ? { area: v.area } : {}) }, this.pcfg);
    if (!plan || plan.window.start > now + this.pcfg!.horizonDays * DAY) return;
    plan.invited = plan.invited.filter(id => !busyIds.has(id) && !P.planMemberReason(w, id));
    if (plan.invited.length < plan.quorum) return;
    crew.sessions.push(plan.id);
    this.planStats.crewSessions++;
    this.submitPlan(plan, now);
  }

  private submitPlan(plan: P.Plan, now: number) {
    // Hard rule, re-checked: no member under 18 in any role.
    if ([...plan.invited, ...plan.alternates, ...(plan.hostId ? [plan.hostId] : [])].some(id => this.x.member(id).minor)) { this.planStats.minorsInPlans++; return; }
    const p = P.planToProposal(plan, this.pcfg);
    this.proposals.set(plan.id, p);
    this.planIds.add(plan.id);
    const run = P.startPlanRun(plan, this.runOpts);
    this.flows.set(plan.id, { p, f: { ...A.startProbeFlow(p), answers: { ...run.answers }, quorum: plan.quorum }, stage: "probing", reveal: new Map() } as any);
    const l: Live = { run, plan, probed: new Set(), going: [] };
    this.live.set(plan.id, l);
    this.planStats.plans++;
    if (plan.partner) this.planStats.partnerPlans++;
    if (plan.eventId) this.planStats.eventPlans++;
    for (const id of plan.invited) { this.planStats.plannedMembers.add(id); this.lastPlannedAt.set(id, now); }
    for (const id of P.pendingOf(run)) this.probe(l, id, now, "first");
  }

  private probe(l: Live, id: MemberId, now: number, stage: "first" | "partner") {
    l.probed.add(id);
    const fl = this.flows.get(l.plan.id) as any;
    if (fl) fl.f.answers[id] = "pending";
    // Simulated reviewer: the proposal (primary group and alternates) was reviewed before the first probe.
    const it = P.planItem(l.plan, id, { now, reviewState: "approved", stage, pcfg: this.pcfg, att: this.cfg });
    it.others = Object.keys(l.run.answers).filter(x => x !== id && l.run.answers[x] !== "no");
    if (this.pcfg!.allowance.enabled && this.allowanceEligible(id, now)) {
      const r = A.addToHold(this.planHold.get(id) ?? [], it, A.defaultCadence("normal", this.cfg), now, { cfg: this.cfg });
      this.planHold.set(id, r.queue);
      for (const e of r.evicted) if (e.key !== it.key) this.planAnswer(e.sourceProposalId!, e.memberId, false, "evicted");
      if (!r.added) this.planAnswer(l.plan.id, id, false, "not_held");
      return;
    }
    this.planStats.introLanePlanItems++;
    if (!this.x.addHeld(it, now)) this.planAnswer(l.plan.id, id, false, "not_held");
  }

  /** Allowance eligibility: a stated (this week), standing or learned window, or the opt-in weekly check-in. */
  private allowanceEligible(id: MemberId, now: number): boolean {
    const ev: P.PlanEvidence = { memberId: id, tz: "UTC", standing: this.standing.get(id) ?? [], history: this.x.availHistory.get(id) ?? [], ...(this.stated.get(id) ? { stated: this.stated.get(id)! } : {}) };
    return P.planAllowanceEligible(ev, !!this.po.checkInOptIn?.(id), now);
  }

  /**
   * The plan lane: once per member per day, inside their send window, one plan item per message under
   * the plan allowance (1 per 7 days). Same gates as every interruption: paused, only-when-asked and the
   * two-unanswered pause, the Blooio conversation streak, quiet hours, review, minors, revalidation.
   */
  private planLane(now: number) {
    const acfg = P.planAllowanceConfig(this.o0(), this.pcfg);
    for (const [id, q0] of this.planHold) {
      if (!q0.length) continue;
      // Expiry and send-time eligibility (age, holds, paused, blocks) before anything else.
      const w = this.x.world(now) as World;
      const rv = A.revalidateHold(q0, now, eligibilityFor(w, (x: MemberId) => this.x.member(x).optedOut), undefined, this.cfg);
      this.planHold.set(id, rv.kept);
      for (const d of rv.dropped) { this.x.bump(this.x.stats.dropped, `plan:${d.reason.split(":")[0]}`); this.planAnswer(d.item.sourceProposalId!, id, false, d.reason); }
      const q = this.planHold.get(id) ?? [];
      if (!q.length) continue;
      const v = this.x.view(id, now) as A.MemberAttention | undefined;
      if (!v || !A.inSendWindow(v, now, this.cfg)) continue;
      const lp = localParts(now, v.tz), day = `${lp.year}-${lp.month}-${lp.day}`;
      if (this.planServed.get(id) === day) continue;
      if (this.x.member(id).optedOut || this.x.busy(id)) continue;
      // Outside-world items held for this member may ride along as companions (never alone here).
      const companions = ((this.x.hold.get(id) ?? []) as HeldItem[]).filter(it => it.kind === "event_suggestion" || it.kind === "place_suggestion");
      const texts = new Map<string, string>();
      for (const it of [...q, ...companions]) { const t = this.x.itemText(w, it, now); if (t) texts.set(it.id, t); }
      const ledger = (this.ledger as AttentionLedgerEntry[]).filter(e => e.memberId === id && this.planInviteIds.has(e.messageId));
      const res = A.composeMessage({ member: v, items: [...q, ...companions].filter(it => texts.has(it.id)), ledger, conversation: this.x.convOf(id), now, mode: "digest", cfg: acfg });
      if (!res.send || !res.items.some(it => it.kind === "plan_probe")) { if (!["quiet_hours", "conversation_streak"].includes(res.reason)) this.planServed.set(id, day); continue; }
      this.planServed.set(id, day);
      // Send through the shared path; the ledger entry goes to the plan allowance, not the intro cap.
      const full = this.ledger as AttentionLedgerEntry[];
      const tmp: AttentionLedgerEntry[] = [];
      this.x.ledger = tmp;
      try { this.x.sendItems(id, v, res.items, res.values, "digest", texts, now); } finally { this.x.ledger = full; }
      for (const e of tmp) { full.push(e); this.planInviteIds.add(e.messageId); }
      this.planStats.allowanceInvites++;
      const sent = new Set(res.items.map(x => x.id));
      this.planHold.set(id, q.filter(x => !sent.has(x.id)));
    }
  }
  /** The attention config with the harness's price setting (lambdaScale), as the intro lane uses it. */
  private o0(): AttentionConfig {
    const k = this.po.lambdaScale;
    if (k === undefined) return this.cfg;
    return { ...this.cfg, lambda: { ...this.cfg.lambda, open: this.cfg.lambda.open * k, normal: this.cfg.lambda.normal * k, quiet: this.cfg.lambda.quiet * k, receiving: this.cfg.lambda.receiving * k } };
  }

  private planProbeText(w: World, it: AttentionItem, now: number): string | null {
    const l = this.live.get(it.sourceProposalId!);
    if (!l || l.run.stage === "closed") return null;
    const invited = Object.keys(l.run.answers).filter(x => l.run.answers[x] !== "no");
    const text = P.buildPlanProbe(w, { ...l.plan, invited: invited.includes(it.memberId) ? invited : [...invited, it.memberId] }, it.memberId, now, TZ[l.plan.city]);
    if (text) {
      this.planStats.probedPlans.add(l.plan.id);
      // Invariant check: no other invitee's name in the probe.
      for (const o of invited) if (o !== it.memberId && new RegExp(`\\b${this.x.member(o).first}\\b`).test(text)) this.planStats.probeNameLeaks++;
    }
    return text;
  }

  // ------------------------------------------------------------------ answers, quorum, booking
  private planAnswer(pid: string, id: MemberId, yes: boolean, why: string) {
    const l = this.live.get(pid);
    if (!l) return;
    const now = this.x.now();
    if (yes && this.conflict(id, l.plan.window.start, pid)) { yes = false; why = "double_booked"; this.planStats.conflictsAvoided++; }
    if (yes && this.po.hiddenFree && !this.po.hiddenFree(id, l.plan.window.start)) {
      // HARNESS: the probe carried the time; a member not free then answers "can't make that time".
      yes = false; why = "cant_make_time";
      this.planStats.cantMakeTime++;
      const h = this.x.availHistory.get(id) ?? [];
      h.push({ at: l.plan.window.start, outcome: "declined_time" });
      this.x.availHistory.set(id, h);
    }
    const prev = l.run;
    const r = P.recordPlanAnswer(l.run, id, yes, now, this.pcfg, this.runOpts);
    l.run = r.run;
    if (r.run !== prev) { if (yes) this.planStats.planYes++; else this.planStats.planNo++; }
    const fl = this.flows.get(pid) as any;
    // yesHolds false: a yes waiting for quorum does not make the member busy (attentionNetwork.busy reads these answers).
    if (fl) fl.f.answers = Object.fromEntries(Object.entries(l.run.answers).map(([k, x]) => [k, x === "yes" && !this.pcfg!.yesHolds && l.run.stage === "probing" ? "pending" : x]));
    const m = this.x.member(id);
    const act = r.action;
    if (yes && act.kind === "none" && l.run.stage === "probing") this.x.send(m, "Great, you're in. I'll confirm once enough people are set.", { type: "info" });
    if (act.kind === "probe_partner") { this.x.send(m, "Great, I'll check with them and let you know.", { type: "info" }); this.probe(l, act.member, now, "partner"); }
    else if (act.kind === "backfill") { this.planStats.backfills++; this.probe(l, act.member, now, "first"); }
    else if (act.kind === "book") this.book(l, act.going, now);
    else if (act.kind === "join") this.join(l, act.member, now);
    else if (act.kind === "fallback") this.fallback(l, now);
    void why;
  }

  /** The member is already booked (any opportunity) within 4 hours of t. */
  private conflict(id: MemberId, t: number, except: string): boolean {
    for (const l of this.live.values()) if (l.plan.id !== except && l.bookedAt !== undefined && l.going.includes(id) && Math.abs(l.plan.window.start - t) < 4 * HOUR) return true;
    for (const o of this.x.opps.values() as Iterable<any>) if (o.p.id !== except && o.stage === "scheduled" && o.meetingAt && o.invites.get(id)?.status === "yes" && Math.abs(o.meetingAt - t) < 4 * HOUR) return true;
    return false;
  }
  private book(l: Live, going: MemberId[], now: number) {
    const plan = l.plan, a = activityById.get(plan.activityId)!;
    // Re-check at booking: a member booked elsewhere at that time since their yes is not double-booked.
    const clash = going.filter(id => this.conflict(id, plan.window.start, plan.id));
    if (clash.length) { this.planStats.conflictsAvoided += clash.length; going = going.filter(id => !clash.includes(id)); }
    if (going.length < 2) { l.run = { ...l.run, stage: "closed" }; const fl = this.flows.get(plan.id) as any; if (fl) fl.stage = "closed"; this.planStats.fallbacks.none = (this.planStats.fallbacks.none ?? 0) + 1; return; }
    if (going.length === 2 && !plan.partner) {
      // A group plan down to two: they said yes to a group, not to a one-to-one meeting. A fresh
      // partner plan with one-to-one consent instead of booking the pair (engine-attention-plans-10).
      l.run = { ...l.run, stage: "closed" }; const fl = this.flows.get(plan.id) as any; if (fl) fl.stage = "closed";
      this.planStats.fallbacks.smaller = (this.planStats.fallbacks.smaller ?? 0) + 1;
      this.submitPlan(P.partnerPlanFor(plan, [going[0]!, going[1]!], now, this.pcfg), now);
      return;
    }
    l.bookedAt = now; l.going = [...going];
    this.planStats.booked++;
    const fl = this.flows.get(plan.id) as any;
    if (fl) fl.stage = "scheduled";
    const p = this.proposals.get(plan.id)!;
    this.x.opps.set(plan.id, { p, invites: new Map(going.map(x => [x, { status: "yes", sentAt: now }])), stage: "scheduled", quorum: plan.quorum, deadline: plan.probeDeadline, meetingAt: plan.window.start });
    this.x.ctx.recordMeeting({ proposalId: plan.id, participants: going, at: plan.window.start, city: plan.city, kind: p.kind });
    for (const id of going) this.sendPlanReveal(l, id, now);
    void a;
  }
  /** The booked-plan reveal (attention v1.2 "(c)"): names after quorum, the time they already said yes to, opt-out. */
  private sendPlanReveal(l: Live, id: MemberId, now: number) {
    const plan = l.plan, a = activityById.get(plan.activityId)!;
    const m = this.x.member(id);
    const h = this.x.availHistory.get(id) ?? [];
    h.push({ at: plan.window.start, outcome: "accepted" });
    this.x.availHistory.set(id, h);
    if (!A.canSendLogistics(this.x.convOf(id), this.cfg)) return;
    const names = l.going.filter(x => x !== id).map(x => this.x.member(x).display).join(", ");
    const host = plan.hostId && l.going.includes(plan.hostId) ? (plan.hostId === id ? " You're the host: you pick the table and say hi first." : ` ${this.x.member(plan.hostId).first} is hosting.`) : "";
    this.x.send(m, `You're in: ${a.label} at ${plan.place.name}, ${fmtLocal(plan.window.start, plan.city)}, with ${names}.${host} Everyone pays their own way. Reply if you can't make it.`,
      { type: "proposal", proposalId: plan.id, participants: [...l.going], proactive: false, reveal: true, meetingAt: plan.window.start });
    this.ledger.push({ messageId: `reveal:${plan.id}:${id}`, memberId: id, at: now, kind: "logistics", itemIds: [], countsAgainstCap: false });
    this.planStats.confirmedSeats++;
    m.awaiting = { kind: "reveal", pid: plan.id };
    this.x.reveals.set(id, { pid: plan.id, at: now });
  }
  private join(l: Live, id: MemberId, now: number) {
    this.planStats.joins++;
    l.going.push(id);
    const opp = this.x.opps.get(l.plan.id);
    if (opp) opp.invites.set(id, { status: "yes", sentAt: now });
    this.x.ctx.recordMeeting({ proposalId: l.plan.id, participants: [id], at: l.plan.window.start, city: l.plan.city, kind: "group" });
    this.sendPlanReveal(l, id, now);
  }
  private planReveal(pid: string, id: MemberId, yes: boolean) {
    const l = this.live.get(pid);
    if (!l || yes) return;
    // A "can't make it" after the reveal: that member is out; the plan goes on while >= 2 remain.
    this.planStats.backouts++;
    l.going = l.going.filter(x => x !== id);
    const opp = this.x.opps.get(pid);
    if (opp) opp.invites.set(id, { status: "dropped", sentAt: this.x.now() });
    if (l.going.length < 2 && opp && opp.stage === "scheduled") {
      this.planStats.cancelled++;
      this.x.cancel(opp, "backed_out");
      for (const x of l.going) this.x.notes.set(x, "That plan fell through, sorry. I'll keep an eye out.");
    }
  }

  private fallback(l: Live, now: number) {
    const fl = this.flows.get(l.plan.id) as any;
    if (fl) fl.stage = "closed";
    // Drop anyone's still-held probe for this plan.
    for (const [mid, q] of this.x.hold as Map<MemberId, any[]>) this.x.hold.set(mid, q.filter((x: any) => x.sourceProposalId !== l.plan.id));
    for (const [mid, q] of this.planHold) this.planHold.set(mid, q.filter(x => x.sourceProposalId !== l.plan.id));
    const events = (this.x.ctx.snapshot().events ?? []) as any[];
    const { fallback, carry } = P.planFallback(l.run, now, events, this.pcfg);
    this.carry.push(...carry);
    l.fallback = fallback.kind;
    this.planStats.fallbacks[fallback.kind] = (this.planStats.fallbacks[fallback.kind] ?? 0) + 1;
    if (fallback.kind === "smaller" && fallback.partnerPlan) {
      // Two yes-sayers of a group plan: a fresh partner plan with one-to-one consent (engine-attention-plans-10).
      this.submitPlan(fallback.partnerPlan, now);
      return;
    }
    if (fallback.kind === "smaller") {
      // A smaller GROUP of the yes-sayers (three or more; two always come with a partner plan): booked like the original.
      l.run = { ...l.run, stage: "booked" };
      this.planStats.bookedSmaller++;
      this.book(l, fallback.members, now);
      return;
    }
    for (const id of P.yesOf(l.run)) this.x.notes.set(id, "That plan didn't come together this time; I'll keep an eye out.");
    if (fallback.kind === "solo_event") {
      const ev = events.find(e => e.id === fallback.eventId);
      if (!ev) return;
      this.x.events.set(ev.id, ev);
      const cfg = this.cfg;
      for (const id of fallback.members) {
        const it: AttentionItem = {
          id: `ev:${ev.id}:${id}`, memberId: id, kind: "event_suggestion", category: "events", others: [], involvesMember: false, effort: "glance",
          enjoy: 0.5, accept: cfg.acceptancePrior, urgency: { expiresAt: ev.start - cfg.expiry.eventLeadHours * HOUR, bestBy: ev.start },
          createdAt: now, reviewState: "not_needed", key: `ev:${ev.id}`,
        };
        this.x.addHeld(it, now);
      }
    }
  }

  private liveTick(pid: string, l: Live, now: number) {
    if (l.run.stage === "probing") {
      const r = P.checkPlanDeadline(l.run, now);
      if (r.action.kind === "fallback") { l.run = r.run; this.fallback(l, now); }
      return;
    }
    // The post-plan answers (6h after the start): who came, and "anyone you'd do this again with?" -> crews.
    if (l.bookedAt !== undefined && !l.feedbackDone && now > l.plan.window.start + 6 * HOUR) {
      l.feedbackDone = true;
      const fb = this.po.planFeedback?.(l.plan, l.going);
      if (!fb) return;
      for (const id of fb.attended) { const h = this.x.availHistory.get(id) ?? []; h.push({ at: l.plan.window.start, outcome: "attended" }); this.x.availHistory.set(id, h); }
      const a = activityById.get(l.plan.activityId)!;
      const snap = this.x.snapMembers ? this.x.ctx.snapshot() : undefined;
      const recurring = fb.positive.filter(id => (snap?.intents ?? []).some((i: any) => i.memberId === id && P.RECURRING_WANT.test(i.objective)
        && (objectivesFor(i.objective, i.details, i.category).some(o => a.objectives.includes(o.id)) || a.tags.some(t => (i.details ?? "").includes(t)))));
      this.history.push({ planId: pid, activityId: l.plan.activityId, ...(l.plan.venueId ? { venueId: l.plan.venueId } : {}), city: l.plan.city, at: l.plan.window.start, attended: fb.attended, positive: fb.positive, recurringWant: recurring });
      if (l.plan.crewId) return;
      const fresh = P.detectCrews(this.history, this.crews, id => !!this.x.world(now).get(id)?.isHost, this.pcfg);
      for (const c of fresh) {
        // Each proposed crew is offered once; a crew nobody (or too few) joined is not offered again.
        if (this.offeredCrews.has(c.id)) continue;
        this.offeredCrews.add(c.id);
        // Offered in the reply to each member's post-plan answer ("want to make this a weekly thing?"); each person opts in.
        this.planStats.crewOffers += c.members.length;
        const yes = c.members.filter(id => this.po.crewOptIn?.(id, c) ?? true);
        this.planStats.crewOptIns += yes.length;
        const crew = P.crewOptIn(c, yes, this.pcfg);
        if (crew) { this.crews.push(crew); this.planStats.crewsFormed++; } else this.planStats.crewsDeclined++;
      }
    }
  }

  /**
   * Plans are not engine proposals. Only members who said yes to a live plan (or are booked in one)
   * are reported as in an open opportunity; a member who was merely probed stays matchable.
   */
  override engineView(input: EngineInput): EngineInput {
    const v = super.engineView(input);
    if (!this.pcfg) return v;
    const open = (v.openOpportunities ?? []).filter(o => !this.planIds.has(o.id));
    for (const [pid, l] of this.live) {
      if (l.run.stage === "closed" || l.plan.window.end < input.now) continue;
      const ids = l.run.stage === "booked" ? l.going : this.pcfg.yesHolds ? P.yesOf(l.run) : [];
      if (ids.length) open.push({ id: pid, participants: [...ids], stage: l.run.stage === "booked" ? "scheduled" : "inviting", until: l.plan.window.end });
    }
    return { ...v, openOpportunities: open, unsentProposalIds: (v.unsentProposalIds ?? []).filter(id => !this.planIds.has(id)) };
  }
}

export type { EngineProposal };
