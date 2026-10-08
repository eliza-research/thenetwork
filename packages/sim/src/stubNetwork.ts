// A deliberately simple Network implementation used to exercise the harness end-to-end
// before the real agent/engine exist: it onboards new members, asks one question, proposes
// random one-to-one intros daily (or dispatches proposals handed to it by an Engine or a
// scenario), runs a minimal consent -> schedule -> remind -> feedback loop, and honours
// STOP, quiet hours, a weekly proactive budget, blocks and the two-unanswered rule.
// Minors policy (PRD 17.4 as amended 2026-10-05): even as a baseline it never connects a member
// under 18 to anyone (no random intros, and any proposal involving one is refused at dispatch);
// minors get single-player value only: onboarding plus concierge answers and public suggestions.
import { DAY, HOUR, MINUTE, type City, type MemberId, type Proposal, type ScoreComponents, type WorldSnapshot } from "@thenetwork/core";
// Engine availability helpers (pure; their import chain does not reach the simulator, so no cycle).
import { availabilityProb, candidateSlots, standingFromFacets, type AvailabilityEvidence, type TimeSlot } from "../../engine/src/attention.ts";
import { parseYesNo } from "./agent/policy.ts";
import type { SimMeta } from "./channel.ts";
import type { InboundMessage, NetworkContext, NetworkUnderTest } from "./network.ts";
import { Rng, hash32 } from "@thenetwork/core";
import { CITY_TZ, fmtLocal, localHour, localParts, nextLocalHour } from "./time.ts";

export interface StubOptions {
  seed?: number | string;
  /** Generate random intros itself (default true). Set false when an Engine feeds proposals. */
  randomIntros?: boolean;
  /** Share of eligible members per city paired each day (default 0.1). */
  introRate?: number;
  /** Max proactive messages per member per 7 days (default 2). */
  weeklyBudget?: number;
  /** Local hour of the daily matching run (default 10). */
  runHour?: number;
  /** TEST ONLY: quote members' onboarding answers in intros (leaks private disclosures). */
  leakyExplanations?: boolean;
  /**
   * Meeting times from availability (default false: every meeting at 19:00 two days after the last yes).
   * The meeting goes at the candidate slot (engine availability.templates: weekday 19:00, weekend 10:00,
   * 14:00, 19:00; from 24 hours ahead) inside the proposal window with the best joint chance that every
   * member is free, from what the members told the Network (availability_pattern facets, trips away,
   * quiet hours) and the engine's priors. Slots within 80% of the best are spread by proposal id.
   * Off by default so baselines (the push arm, the attention experiment's R) do not move.
   */
  timeAware?: boolean;
}

interface MemberState {
  id: MemberId; first: string; display: string; city: City; area: string; quietHours: [number, number];
  /** Declared age under 18 (or unknown): never connected to anyone. */
  minor: boolean; ageSeen: boolean; interests: string[]; conciergeCount: number;
  stage: "new" | "asked" | "onboarded"; answers: string[];
  optedOut: boolean; unanswered: number; proactive: number[]; lastInbound: number;
  awaiting?: { kind: "invite" | "feedback"; pid: string };
}
interface Invite { status: "pending" | "yes" | "no" | "expired" | "dropped"; sentAt?: number }
interface Opp {
  p: Proposal; invites: Map<MemberId, Invite>; stage: "inviting" | "scheduled" | "done" | "cancelled";
  quorum: number; deadline: number; meetingAt?: number; reminded?: boolean; feedbackSent?: boolean;
}

const ZERO: ScoreComponents = {
  fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
  interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
};
const ALLOWED: [number, number] = [9, 20]; // local hours when proactive texts may go out
const INVITE_TTL = 48 * HOUR;
const ACK_DEDUP_MS = 10 * MINUTE;

export class StubNetwork implements NetworkUnderTest {
  readonly name = "stub";
  private ctx!: NetworkContext;
  private members = new Map<MemberId, MemberState>();
  private opps = new Map<string, Opp>();
  private queued: Proposal[] = [];
  private lastRunDay = new Map<City, string>();
  private blocks = new Set<string>();
  private pairsTried = new Set<string>();
  private deferred: { memberId: MemberId; pid: string }[] = [];
  /** Last text sent to each member (acknowledgement de-duplication). */
  private lastSent = new Map<MemberId, { body: string; at: number }>();
  private rng: Rng;
  private seq = 0;
  private pseq = 0;
  constructor(private opts: StubOptions = {}) { this.rng = new Rng(`stub:${opts.seed ?? 0}`); }

  init(ctx: NetworkContext) { this.ctx = ctx; }

  // ------------------------------------------------------------------ inbound
  async onInbound(msg: InboundMessage) {
    const now = this.ctx.clock.now();
    const m = this.member(msg.memberId);
    m.lastInbound = now; m.unanswered = 0;
    if (msg.keyword === "STOP") { m.optedOut = true; this.dropFromOpenOpps(m.id); return; }
    if (msg.keyword === "START") { m.optedOut = false; this.send(m, "Welcome back. I'll only reach out when something looks worth it.", { type: "info" }); return; }
    if (msg.keyword === "HELP") return;
    const body = msg.body.trim();

    if (m.stage === "new" && m.minor) {
      m.stage = "asked";
      this.send(m, `Hi ${m.first}, I'm the Network's agent (an AI). Since you're under 18, I won't introduce you to other members, but I can answer questions and point you to public events and places. Reply STOP anytime to opt out. What are you into?`,
        { type: "onboarding", proactive: false, firstContact: true });
      return;
    }
    if (m.stage === "new") {
      m.stage = "asked";
      this.send(m, `Hi ${m.first}, I'm the Network's agent (an AI). Now and then I'll suggest people or plans that seem worth your time. Reply STOP anytime to opt out. To start: what would you like more of in your life right now?`,
        { type: "onboarding", proactive: false, firstContact: true });
      return;
    }
    const block = body.match(/^(block|report)\s+(.+)$/i);
    if (block) return this.handleBlock(m, block[1]!.toLowerCase() as "block" | "report", block[2]!);

    if (m.awaiting?.kind === "invite") {
      const yn = parseYesNo(body);
      if (yn !== "unclear") return this.handleInviteReply(m, m.awaiting.pid, yn === "no" ? "no" : "yes");
    }
    if (/can'?t make it|have to bail|can'?t come|cancel/i.test(body)) {
      const opp = [...this.opps.values()].find(o => o.stage === "scheduled" && o.invites.get(m.id)?.status === "yes");
      if (opp) return this.handleDrop(m, opp);
    }
    if (m.awaiting?.kind === "feedback") {
      this.ctx.log("feedback", { memberId: m.id, proposalId: m.awaiting.pid, text: body });
      m.awaiting = undefined;
      this.send(m, "Thanks, that's really helpful.", { type: "info" });
      return;
    }
    if (m.minor) return this.concierge(m, body);
    if (m.stage === "asked") {
      m.answers.push(body); m.stage = "onboarded";
      this.send(m, "Thanks, got it. I'll keep an eye out and only text when something looks worth your time.", { type: "info" });
      return;
    }
    if (/\b(number|phone|address|private|contact details|notes)\b/i.test(body)) {
      this.send(m, "I can't share other members' contact details or private info. If both people want to after meeting, I can swap numbers.", { type: "info" });
      return;
    }
    if (/^(thanks|thank you|got it|ok|okay|👍|see you|sounds good|perfect|works for me|yes)/i.test(body) || body.length < 12) return;
    m.answers.push(body);
    this.send(m, "Thanks, noted. I'll reach out if something fits.", { type: "info" });
  }

  // ------------------------------------------------------------------ tick
  async tick(now: number) {
    // Deferred proactive invites (they came due during someone's quiet hours).
    const waiting = this.deferred; this.deferred = [];
    for (const d of waiting) {
      const opp = this.opps.get(d.pid);
      if (opp?.stage === "inviting") this.invite(this.member(d.memberId), opp, now);
    }
    for (const opp of this.opps.values()) this.advance(opp, now);
    for (const city of ["sf", "nyc"] as City[]) {
      const lp = localParts(now, city);
      const dayKey = `${lp.year}-${lp.month}-${lp.day}`;
      const runHour = this.opts.runHour ?? 10;
      if (lp.hour >= runHour && lp.hour < ALLOWED[1] && this.lastRunDay.get(city) !== dayKey) {
        this.lastRunDay.set(city, dayKey);
        this.dailyRun(city, now);
      }
    }
  }

  submitProposal(p: Proposal) { this.queued.push(p); }

  private dailyRun(city: City, now: number) {
    const mine = this.queued.filter(p => p.city === city);
    this.queued = this.queued.filter(p => p.city !== city);
    for (const p of mine) this.dispatch(p, now);
    if (this.opts.randomIntros === false) return;
    const eligible = this.rng.shuffle([...this.members.values()].filter(m => m.city === city && this.canPropose(m, now)));
    const nPairs = Math.max(eligible.length >= 2 ? 1 : 0, Math.round(eligible.length * (this.opts.introRate ?? 0.1)));
    const used = new Set<MemberId>();
    const snap = this.ctx.snapshot();
    for (let i = 0; i < eligible.length && used.size / 2 < nPairs; i++) {
      const a = eligible[i]!;
      if (used.has(a.id)) continue;
      const b = eligible.find(x => x.id !== a.id && !used.has(x.id) && !this.isBlocked(a.id, x.id) && !this.pairsTried.has(key(a.id, x.id)));
      if (!b) continue;
      used.add(a.id); used.add(b.id);
      const shared = this.sharedInterests(snap, a.id, b.id);
      const why = shared.length ? `you're both into ${shared.slice(0, 2).join(" and ")}` : "I have a hunch you two would get along";
      const p = this.makeProposal("intro", [a.id, b.id], city, "one-to-one intro", { [a.id]: why, [b.id]: why }, now);
      this.ctx.recordProposal(p, "network");
      this.dispatch(p, now);
    }
  }

  private makeProposal(kind: Proposal["kind"], participants: MemberId[], city: City, objective: string, explanations: Record<MemberId, string>, now: number): Proposal {
    return {
      id: `stub-p${++this.pseq}`, kind, participants, alternates: [], objective, city,
      window: { start: now + 2 * DAY, end: now + 4 * DAY }, score: this.rng.next(), components: ZERO,
      exploration: true, explanations, generator: "stub_random", createdAt: now,
    };
  }

  /** Single-player value for minors: answers and public suggestions, never other members. */
  private concierge(m: MemberState, body: string) {
    if (m.stage === "asked") {
      m.answers.push(body); m.stage = "onboarded";
      this.send(m, "Thanks, got it. Text me anytime for ideas: public events, classes and places near you.", { type: "info" });
      return;
    }
    // Acknowledgements get no reply (same rule as for adults).
    if (/^(thanks|thank you|got it|ok|okay|👍|cool|nice|see you|sounds good|perfect)/i.test(body.trim()) || body.trim().length < 12) return;
    const topic = m.interests.find(t => body.toLowerCase().includes(t.toLowerCase().split(" ")[0]!))
      ?? m.interests[m.conciergeCount % Math.max(1, m.interests.length)] ?? "something new";
    const ideas = [
      `look for an all-ages drop-in or public class near ${m.area}: rec centers, libraries and community gyms post them weekly`,
      `check the free public events listings for ${m.area} this week; parks and libraries often run all-ages sessions`,
    ];
    m.conciergeCount++;
    this.send(m, `For ${topic}, ${ideas[m.conciergeCount % ideas.length]}. Happy to suggest more anytime.`, { type: "concierge", proactive: false });
  }

  private dispatch(p: Proposal, now: number) {
    // Hard policy before anything else: a proposal touching a minor in any role is refused whole.
    if ([...p.participants, ...(p.alternates ?? [])].some(id => this.member(id).minor)) {
      this.ctx.log("proposal_skipped", { proposalId: p.id, reason: "minors_policy" });
      return;
    }
    // Never double-book: drop anyone already in an open or scheduled opportunity.
    const busy = (id: MemberId) => [...this.opps.values()].some(o => (o.stage === "inviting" || o.stage === "scheduled") && o.invites.get(id)?.status !== "no" && o.p.participants.includes(id));
    const free = p.participants.filter(id => !busy(id) && !this.member(id).optedOut);
    if (free.length < (p.participants.length > 2 ? 3 : 2) || (p.participants.length === 2 && free.length < 2)) {
      this.ctx.log("proposal_skipped", { proposalId: p.id, reason: "participants busy or opted out" });
      return;
    }
    if (free.length !== p.participants.length) p = { ...p, participants: free };
    const parts = p.participants.map(id => this.member(id));
    if (p.participants.some((a, i) => p.participants.slice(i + 1).some(b => this.isBlocked(a, b)))) return;
    for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) this.pairsTried.add(key(p.participants[i]!, p.participants[j]!));
    const group = p.participants.length > 2;
    const opp: Opp = {
      p, invites: new Map(p.participants.map(id => [id, { status: "pending" as const }])), stage: "inviting",
      quorum: group ? Math.max(3, Math.ceil(p.participants.length * 0.66)) : 2, deadline: now + INVITE_TTL,
    };
    this.opps.set(p.id, opp);
    if (group) for (const m of parts) this.invite(m, opp, now);
    else this.invite(parts[0]!, opp, now); // pairs: ask the first party, then the second on yes
  }

  private invite(m: MemberState, opp: Opp, now: number) {
    if (!this.proactiveAllowed(m, now)) {
      this.deferred.push({ memberId: m.id, pid: opp.p.id });
      opp.deadline = Math.max(opp.deadline, now + INVITE_TTL);
      return;
    }
    const others = opp.p.participants.filter(x => x !== m.id).map(id => this.member(id));
    const why = opp.p.explanations[m.id] ?? "it seemed like a good fit";
    let body: string;
    if (others.length === 1) {
      body = `Hi ${m.first}, I think you'd enjoy meeting ${others[0]!.display}: ${why}. Want an intro? An easy no is totally fine. Reply STOP anytime to opt out.`;
      if (this.opts.leakyExplanations && others[0]!.answers.length) body += ` They told me: "${others[0]!.answers.join(" ")}"`;
    } else {
      body = `Hi ${m.first}, I'm putting together a small ${opp.p.objective} with ${others.length} others (${why}). Want in? No pressure either way. Reply STOP anytime to opt out.`;
    }
    opp.invites.set(m.id, { status: "pending", sentAt: now });
    m.awaiting = { kind: "invite", pid: opp.p.id };
    this.send(m, body, { type: "proposal", proposalId: opp.p.id, participants: opp.p.participants, proactive: true });
    m.proactive.push(now);
  }

  private handleInviteReply(m: MemberState, pid: string, yn: "yes" | "no") {
    const opp = this.opps.get(pid);
    m.awaiting = undefined;
    if (opp && opp.stage === "scheduled" && yn === "yes" && opp.p.participants.length > 2 && opp.meetingAt && opp.meetingAt > this.ctx.clock.now() + 2 * HOUR) {
      // Late yes to a group that already reached quorum: there's still room, add them.
      opp.invites.set(m.id, { ...opp.invites.get(m.id)!, status: "yes" });
      const going = [...opp.invites].filter(([, i]) => i.status === "yes").map(([id]) => id);
      this.ctx.recordMeeting({ proposalId: opp.p.id, participants: going, at: opp.meetingAt, city: opp.p.city, kind: opp.p.kind });
      const others = going.filter(x => x !== m.id).map(x => this.member(x).first).join(", ");
      this.send(m, `You're in with ${others}: ${fmtLocal(opp.meetingAt, opp.p.city)} near ${this.member(going[0]!).area}. I'll send a reminder that day.`,
        { type: "scheduling", proposalId: opp.p.id, meetingAt: opp.meetingAt, proactive: false });
      return;
    }
    if (!opp || opp.stage !== "inviting") { this.send(m, "Thanks! That one has closed, but I'll keep you in mind.", { type: "info" }); return; }
    const now = this.ctx.clock.now();
    opp.invites.set(m.id, { ...opp.invites.get(m.id)!, status: yn });
    if (yn === "no") {
      this.send(m, "No problem at all, thanks for letting me know.", { type: "info" });
      if (opp.p.participants.length === 2) this.cancel(opp, "declined");
      return;
    }
    const yes = [...opp.invites].filter(([, i]) => i.status === "yes").map(([id]) => id);
    if (opp.p.participants.length === 2) {
      const other = opp.p.participants.find(x => x !== m.id)!;
      if (opp.invites.get(other)!.status === "pending" && !opp.invites.get(other)!.sentAt) {
        this.send(m, "Great, I'll check with them and let you know.", { type: "info" });
        opp.deadline = now + INVITE_TTL;
        const o = this.member(other);
        if (o.optedOut || o.unanswered >= 2) return this.cancel(opp, "unavailable");
        this.invite(o, opp, now);
        return;
      }
      if (yes.length === 2) this.schedule(opp, now);
      return;
    }
    if (yes.length >= opp.quorum) this.schedule(opp, now);
    else this.send(m, "Great, you're in. I'll confirm once enough people are set.", { type: "info" });
  }

  private schedule(opp: Opp, now: number) {
    const going = [...opp.invites].filter(([, i]) => i.status === "yes").map(([id]) => id);
    opp.stage = "scheduled";
    for (const [id, inv] of opp.invites) if (inv.status === "pending") inv.status = "dropped";
    const at = this.opts.timeAware ? this.pickSlot(opp.p, going, now) : nextLocalHour(now + 2 * DAY, opp.p.city, 19);
    opp.meetingAt = at;
    const area = this.member(going[0]!).area;
    this.ctx.recordMeeting({ proposalId: opp.p.id, participants: going, at, city: opp.p.city, kind: opp.p.kind });
    for (const id of going) {
      const m = this.member(id);
      const others = going.filter(x => x !== id).map(x => this.member(x).first).join(", ");
      this.send(m, `You're all set with ${others}: ${fmtLocal(at, opp.p.city)} near ${area}. I'll send a reminder that day.`,
        { type: "scheduling", proposalId: opp.p.id, meetingAt: at, proactive: false });
    }
  }

  private handleDrop(m: MemberState, opp: Opp) {
    opp.invites.set(m.id, { ...opp.invites.get(m.id)!, status: "dropped" });
    this.send(m, "No worries, thanks for the heads up.", { type: "info" });
    const still = [...opp.invites].filter(([, i]) => i.status === "yes").map(([id]) => id);
    const keep = still.length >= Math.min(opp.quorum, 2) && (opp.p.participants.length > 2 ? still.length >= 2 : false);
    for (const id of still) {
      this.send(this.member(id), keep
        ? `Quick update: ${m.first} can't make it today, sorry about the change. The rest of you are still on.`
        : `Quick update: ${m.first} can't make it today, so I'm calling this one off. Sorry about that, I'll look for another time.`,
        { type: "cancellation", proposalId: opp.p.id });
    }
    if (!keep) opp.stage = "cancelled";
  }

  private advance(opp: Opp, now: number) {
    if (opp.stage === "inviting" && now >= opp.deadline) {
      for (const [id, inv] of opp.invites) if (inv.status === "pending" && inv.sentAt) {
        inv.status = "expired";
        const m = this.member(id);
        m.unanswered++;
        if (m.awaiting?.pid === opp.p.id) m.awaiting = undefined;
      }
      const yes = [...opp.invites].filter(([, i]) => i.status === "yes").length;
      if (opp.p.participants.length > 2 && yes >= Math.max(3, opp.quorum - 1)) this.schedule(opp, now);
      else this.cancel(opp, "expired");
    }
    if (opp.stage === "scheduled" && opp.meetingAt) {
      if (!opp.reminded && now >= opp.meetingAt - 4 * HOUR && now < opp.meetingAt) {
        opp.reminded = true;
        for (const [id, inv] of opp.invites) if (inv.status === "yes")
          this.send(this.member(id), `Reminder: today at ${hourText(localHour(opp.meetingAt, opp.p.city))}. Have fun!`, { type: "reminder", proposalId: opp.p.id });
      }
      if (!opp.feedbackSent && now >= opp.meetingAt + 3 * HOUR && localHour(now, opp.p.city) >= ALLOWED[0] && localHour(now, opp.p.city) < 21) {
        opp.feedbackSent = true; opp.stage = "done";
        for (const [id, inv] of opp.invites) if (inv.status === "yes") {
          const m = this.member(id);
          const others = [...opp.invites].filter(([x, i]) => x !== id && i.status === "yes").map(([x]) => this.member(x).first).join(" and ") || "the group";
          m.awaiting = { kind: "feedback", pid: opp.p.id };
          this.send(m, `How did it go with ${others}?`, { type: "feedback_request", proposalId: opp.p.id });
        }
      }
    }
  }

  private cancel(opp: Opp, reason: string) {
    if (opp.stage === "cancelled") return;
    const notify = opp.stage === "inviting" && opp.p.participants.length === 2 && reason !== "declined_first";
    opp.stage = "cancelled";
    for (const [id, inv] of opp.invites) {
      const m = this.member(id);
      if (m.awaiting?.pid === opp.p.id) m.awaiting = undefined;
      // Tell people who said yes, without revealing who declined (F11, F29).
      if (notify && inv.status === "yes")
        this.send(m, "That intro didn't come together this time. No action needed, I'll keep an eye out.", { type: "info", proposalId: opp.p.id });
    }
    this.ctx.log("opportunity_closed", { proposalId: opp.p.id, reason });
  }

  private handleBlock(m: MemberState, verb: "block" | "report", name: string) {
    const target = [...this.members.values()].find(x => x.id !== m.id && (name.toLowerCase().includes(x.first.toLowerCase())));
    if (!target) { this.send(m, "I couldn't find who you mean. Can you give me their full name?", { type: "question", proactive: false }); return; }
    this.blocks.add(key(m.id, target.id));
    this.ctx.recordBlock(m.id, target.id);
    for (const opp of this.opps.values())
      if (["inviting", "scheduled"].includes(opp.stage) && opp.p.participants.includes(m.id) && opp.p.participants.includes(target.id)) this.cancel(opp, "blocked");
    this.send(m, verb === "block"
      ? "Done. You won't be matched with them, and they won't be told."
      : "Thanks for telling me. I've blocked them for you and flagged this for the safety team. If you're ever in danger, call 911 first.", { type: "info" });
  }

  private dropFromOpenOpps(id: MemberId) {
    for (const opp of this.opps.values()) if (opp.stage === "inviting" && opp.invites.has(id)) {
      opp.invites.get(id)!.status = "dropped";
      if (opp.p.participants.length === 2) this.cancel(opp, "opted_out");
    }
  }

  // ------------------------------------------------------------------ helpers
  /** StubOptions.timeAware: the meeting slot from the members' stated availability (see StubOptions). */
  private pickSlot(p: Proposal, going: MemberId[], now: number): number {
    const tz = CITY_TZ[p.city];
    const snap = this.ctx.snapshot();
    const ev = going.map(id => this.statedAvailability(snap, id, p.city, tz, now));
    let cands: TimeSlot[] = p.window ? candidateSlots(tz, now, { window: p.window }) : [];
    if (!cands.length) cands = candidateSlots(tz, now);
    const scored = cands.map(slot => ({ slot, joint: ev.reduce((acc, e) => acc * availabilityProb(e, slot, now), 1) }));
    const best = Math.max(0, ...scored.map(x => x.joint));
    const near = scored.filter(x => x.joint > 0 && x.joint >= 0.8 * best);
    if (!near.length) return nextLocalHour(now + 2 * DAY, p.city, 19);
    return near[hash32(p.id) % near.length]!.slot.start;
  }

  /** What the Network was told about when a member is free (never hidden truth). */
  private statedAvailability(snap: WorldSnapshot, id: MemberId, city: City, tz: string, now: number): AvailabilityEvidence {
    // Day tags go as the sim emits them ("evening:tue"); the engine parses them case-insensitively.
    const facets = snap.facets.filter(f => f.memberId === id && f.kind === "availability_pattern");
    const away = snap.presence.filter(x => x.memberId === id && x.type === "temporary" && x.city !== city && x.from !== undefined && x.to !== undefined)
      .map(x => ({ start: x.from!, end: x.to! }));
    return { memberId: id, tz, quietHours: this.member(id).quietHours, standing: standingFromFacets(facets, now), away };
  }

  private canPropose(m: MemberState, now: number) {
    if (m.minor) return false;
    if (m.stage !== "onboarded" || m.optedOut || m.unanswered >= 2 || m.awaiting) return false;
    if (m.proactive.filter(t => now - t < 7 * DAY).length >= (this.opts.weeklyBudget ?? 2)) return false;
    if (!this.proactiveAllowed(m, now)) return false;
    return ![...this.opps.values()].some(o => (o.stage === "inviting" || o.stage === "scheduled") && o.p.participants.includes(m.id));
  }
  /** Proactive texts only 9am-8pm local and outside the member's own quiet hours. */
  private proactiveAllowed(m: MemberState, now: number) {
    const h = localHour(now, m.city);
    if (h < ALLOWED[0] || h >= ALLOWED[1]) return false;
    const [qs, qe] = m.quietHours;
    return !(qs <= qe ? h >= qs && h < qe : h >= qs || h < qe);
  }
  private isBlocked(a: MemberId, b: MemberId) { return this.blocks.has(key(a, b)); }

  private sharedInterests(snap: WorldSnapshot, a: MemberId, b: MemberId): string[] {
    const of = (id: MemberId) => new Set(snap.facets.filter(f => f.memberId === id && f.kind === "interest" && f.scope !== "agent_private").map(f => f.value));
    const A = of(a), B = of(b);
    return [...A].filter(x => B.has(x));
  }

  private member(id: MemberId): MemberState {
    let m = this.members.get(id);
    if (m && !m.ageSeen) {
      // Created before the member was visible (e.g. not yet joined): re-read the declared age.
      const mem = this.ctx.snapshot().members.find(x => x.id === id);
      if (mem) { m.minor = !(typeof mem.age === "number" && mem.age >= 18); m.ageSeen = true; }
    }
    if (!m) {
      const snap = this.ctx.snapshot();
      const mem = snap.members.find(x => x.id === id);
      const name = mem?.name ?? id;
      const [first, last] = name.split(" ");
      const area = snap.facets.find(f => f.memberId === id && f.tags.includes("neighborhood"))?.value.replace(/^lives near /, "") ?? "downtown";
      m = {
        id, first: first ?? name, display: last ? `${first} ${last[0]}.` : name, city: mem?.homeCity ?? "sf", area,
        // Fail closed: a member we can't see an adult age for is treated as a minor.
        minor: !(typeof mem?.age === "number" && mem.age >= 18), ageSeen: !!mem,
        interests: snap.facets.filter(f => f.memberId === id && f.kind === "interest").map(f => f.value), conciergeCount: 0,
        quietHours: mem?.prefs.quietHours ?? [21, 9],
        stage: "new", answers: [], optedOut: false, unanswered: 0, proactive: [], lastInbound: 0,
      };
      this.members.set(id, m);
    }
    return m;
  }

  private send(m: MemberState, body: string, meta: SimMeta) {
    // Never repeat an acknowledgement: the same info/concierge text to the same member within
    // 10 minutes (e.g. two quick messages both answered "Thanks, noted...") is sent once.
    const now = this.ctx.clock.now();
    const last = this.lastSent.get(m.id);
    if ((meta.type === "info" || meta.type === "concierge") && last && last.body === body && now - last.at < ACK_DEDUP_MS) return;
    this.lastSent.set(m.id, { body, at: now });
    return this.ctx.send(m.id, body, { meta, idempotencyKey: `${m.id}:${++this.seq}` });
  }
}

/** 19 -> "7pm", 10 -> "10am", 12.5 -> "12:30pm". */
function hourText(h: number): string {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `${hh % 12 === 0 ? 12 : hh % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${hh < 12 ? "am" : "pm"}`;
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
