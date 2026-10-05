// A deliberately simple Network implementation used to exercise the harness end-to-end
// before the real agent/engine exist: it onboards new members, asks one question, proposes
// random one-to-one intros daily (or dispatches proposals handed to it by an Engine or a
// scenario), runs a minimal consent -> schedule -> remind -> feedback loop, and honours
// STOP, quiet hours, a weekly proactive budget, blocks and the two-unanswered rule.
import { DAY, HOUR, type City, type MemberId, type Proposal, type ScoreComponents, type WorldSnapshot } from "@thenetwork/core";
import { parseYesNo } from "./agent/policy.ts";
import type { SimMeta } from "./channel.ts";
import type { InboundMessage, NetworkContext, NetworkUnderTest } from "./network.ts";
import { Rng } from "./rng.ts";
import { fmtLocal, localHour, localParts, nextLocalHour } from "./time.ts";

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
}

interface MemberState {
  id: MemberId; first: string; display: string; city: City; area: string; quietHours: [number, number];
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

  private dispatch(p: Proposal, now: number) {
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
      body = `Hi ${m.first}, I think you'd enjoy meeting ${others[0]!.display}: ${why}. Want an intro? An easy no is totally fine.`;
      if (this.opts.leakyExplanations && others[0]!.answers.length) body += ` They told me: "${others[0]!.answers.join(" ")}"`;
    } else {
      body = `Hi ${m.first}, I'm putting together a small ${opp.p.objective} with ${others.length} others (${why}). Want in? No pressure either way.`;
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
    const at = nextLocalHour(now + 2 * DAY, opp.p.city, 19);
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
          this.send(this.member(id), `Reminder: today at ${Math.round(localHour(opp.meetingAt, opp.p.city)) - 12}pm. Have fun!`, { type: "reminder", proposalId: opp.p.id });
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
  private canPropose(m: MemberState, now: number) {
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
    if (!m) {
      const snap = this.ctx.snapshot();
      const mem = snap.members.find(x => x.id === id);
      const name = mem?.name ?? id;
      const [first, last] = name.split(" ");
      const area = snap.facets.find(f => f.memberId === id && f.tags.includes("neighborhood"))?.value.replace(/^lives near /, "") ?? "downtown";
      m = {
        id, first: first ?? name, display: last ? `${first} ${last[0]}.` : name, city: mem?.homeCity ?? "sf", area,
        quietHours: mem?.prefs.quietHours ?? [21, 9],
        stage: "new", answers: [], optedOut: false, unanswered: 0, proactive: [], lastInbound: 0,
      };
      this.members.set(id, m);
    }
    return m;
  }

  private send(m: MemberState, body: string, meta: SimMeta) {
    return this.ctx.send(m.id, body, { meta, idempotencyKey: `${m.id}:${++this.seq}` });
  }
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
