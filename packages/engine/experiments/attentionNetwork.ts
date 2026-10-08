// HARNESS ONLY (2026-10-07 attention budget experiment). A Network under test for the simulator
// that is the sim's StubNetwork (packages/sim/src/stubNetwork.ts, unchanged and inherited, so the
// "v12" mode IS today's behaviour) plus, in "attention" mode, the Phase 1 send path from
// src/attention.ts: per-member hold queues, weekly digests of up to 3 items, break-ins, the
// interruption cap and shadow price, the Blooio streak, and (with `probes`) consent-first probes
// with a reveal only after both say yes.
//
// The stub can't represent menus, so member choice is simulated here: when a digest carries
// several items, `choose` (the experiment's oracle, offline) names the item the member would value
// most; the persona agent then decides on that item exactly as it decides on a single invitation
// (accept / decline / ignore). One pick per digest. The engine never sees the oracle.
//
// Private StubNetwork members are reached through `this.s` (an `any` view): TypeScript `private`
// is compile-time only, and copying the stub would risk the baseline drifting from the real one.
import { DAY, HOUR, type MemberId, type Proposal } from "@thenetwork/core";
import { parseYesNo } from "../../sim/src/agent/policy.ts";
import type { SimMeta } from "../../sim/src/channel.ts";
import type { InboundMessage, NetworkContext } from "../../sim/src/network.ts";
import { publicEvents } from "../../sim/src/snapshot.ts";
import { StubNetwork, type StubOptions } from "../../sim/src/stubNetwork.ts";
import { fmtLocal } from "../../sim/src/time.ts";
import * as A from "../src/attention.ts";
import { resolveAttention, resolveConfig, type AttentionConfig, type AttentionConfigInput } from "../src/config.ts";
import { eligibilityFor } from "../src/filters.ts";
import type { AttentionItem, AttentionLedgerEntry, EngineInput, EngineProposal, HeldItem } from "../src/types.ts";
import { World } from "../src/world.ts";

export interface AttentionNetOptions extends StubOptions {
  mode: "v12" | "attention";
  /** Consent-first probes (D5): anonymous items, partner probed after the first yes, reveal after both. */
  probes?: boolean;
  attention?: AttentionConfigInput;
  calibrate?: A.Calibrator;
  /** HARNESS ONLY: which item of a digest the member picks (oracle, offline). Default: highest V. */
  choose?: (memberId: MemberId, items: AttentionItem[], proposals: ReadonlyMap<string, EngineProposal>, now: number) => string;
  /** Ablation: send whenever the cap allows (drop the θ_bar and U(M) > 0 rules). */
  capOnly?: boolean;
  /** Report held pairs to the engine as pending (blocks re-proposing the same pair; not billed). Default true. */
  blockHeldPairs?: boolean;
  /**
   * What the engine is billed for (its per-member proposal budget): "shown" (default) = every item a
   * message carried, as "bill only sent" in v1.2; "picked" = only items a member said yes to.
   */
  bill?: "shown" | "picked";
  /** Do not send content-free acknowledgements ("Thanks, noted.") as separate messages. */
  suppressAcks?: boolean;
  /** Hours after a digest slot during which a missed slot may still be served (default 6 days). */
  slotWindowHours?: number;
  /** Partner probes (the first member already said yes) may use any remaining cap, not only the break-in allowance. */
  partnerAnyCap?: boolean;
  // ---- iteration 2 ----
  /** Scale λ_state (1 = the doc's price, 0 = no price; the quality bar stays). */
  lambdaScale?: number;
  /**
   * Digest cadence for Normal members: "weekly" (D2), "twice" (Tue + Thu), "rolling" (a daily 18:00
   * slot used only when the best held item clears the bar and the member has cap; everything else
   * ready is batched into it), "immediate" (send as items arrive, as today's daily dispatch).
   */
  cadence?: "weekly" | "twice" | "rolling" | "immediate";
  /** Acknowledgements are sent but do not count on the Network's streak (they are replies, not interruptions). */
  ackExempt?: boolean;
  /** Learned per-member cadence within D11: digest hour from the member's own messages; weekly for members who left one unanswered. */
  learnedCadence?: boolean;
  /** Outside-world items: public events matching a member's stated interests, offered in digests. */
  outsideWorld?: boolean;
  /** HARNESS ONLY: does the member act on (go to) this event? Decided offline from hidden truth. */
  actOnEvent?: (memberId: MemberId, ev: SimEventLite, now: number) => boolean;
  /** How an item the member saw and passed on is reported to the engine (default "pending": blocks the pair ~28 days, no decline cooldown). */
  passedAs?: "pending" | "cancelled";
  /** Items shown alongside the one the member picked go back to the hold queue (picking one is not a pass on the others). */
  requeueUnpicked?: boolean;
  /** Outside-world items may make up a message on their own (default true); false = only as companions of a people item. */
  eventsAlone?: boolean;
  // ---- iteration 3 (founder decisions 1-4) ----
  /** Decision 1: per-member send time learned from the member's replies (attention.ts learnSendProfile); "fixed" = cfg digest.hour. */
  sendTime?: "learned" | "fixed";
  /** Hours after a rolling slot during which it may still be served (default: slotWindowHours). */
  sendWindowHours?: number;
  /** Decision 3: a partner probe goes out as soon as the first member said yes, inside the partner's send window, within their cap (no break-in). */
  partnerInWindow?: boolean;
  /** Decision 4: 2-3 time options in each probe (attention.ts chooseTimeOptions); the meeting is set at a time both picked. */
  timeOptions?: boolean;
  /** HARNESS ONLY: is the member actually free at t (hidden weekly availability)? Used to simulate which offered slots a persona picks, and its calendar. */
  hiddenFree?: (memberId: MemberId, t: number) => boolean;
  /** HARNESS ONLY: does the member connect their calendar when offered (after their first accepted plan)? */
  connectsCalendar?: (memberId: MemberId) => boolean;
  /** HARNESS ONLY: does a connected calendar show this hidden-busy slot as busy (busy recall)? */
  calendarShowsBusy?: (memberId: MemberId, t: number) => boolean;
  // ---- iteration 4 (cheaper probe-first) ----
  /** (a) Probe both members of a pair at once; reveal when both said yes. */
  parallelProbes?: boolean;
  /** (b) After both yeses the reveal IS the booked plan, with an easy opt-out ("Reply if you can't make it"); no third yes. */
  revealOptOut?: boolean;
  /** (d) Warm mentions: "a friend of <mutual>" in the probe when both the mutual and the person described consented (attention.ts warmMention). */
  warmConsent?: (memberId: MemberId) => boolean;
}

export interface SimEventLite { id: string; title: string; city: string; start: number; end: number; tags: string[] }

interface Flow {
  p: EngineProposal; f: A.ProbeFlow; stage: "probing" | "revealing" | "scheduled" | "closed"; reveal: Map<MemberId, "sent" | "yes" | "no">; revealDeadline?: number;
  /** Decision 4: slots still open (offered and picked by everyone who said yes so far); undefined = no time options in play. */
  times?: A.TimeSlot[];
  /** Iteration 4: each member's picked slot starts (empty = none fit), and the options offered in a parallel flow (both see the same). */
  picks?: Map<MemberId, number[]>;
  offered?: A.TimeSlot[];
  /** Members shown an initial invite for this opportunity (for the wasted-invite count). */
  shown?: Set<MemberId>;
}
interface Pending { messageId: string; memberId: MemberId; at: number; kind: "digest" | "break_in" | "reengage"; items: AttentionItem[]; picked?: AttentionItem }

const trivialEmbed = () => [0];
const ACK = /^(Thanks, noted\.|Thanks, got it\.|No problem at all|Thanks, that's really helpful)/;
const ENGINE_CFG = resolveConfig({});

export class AttentionNetwork extends StubNetwork {
  readonly cfg: AttentionConfig;
  readonly hold = new Map<MemberId, HeldItem[]>();
  readonly proposals = new Map<string, EngineProposal>();
  /** Proposals some member engaged with (picked, partner-probed, revealed): billed to the engine like sent invites. */
  readonly engaged = new Set<string>();
  /** Proposals shown to some member in a message. */
  readonly shownPids = new Set<string>();
  private shownAt = new Map<string, number>();
  readonly flows = new Map<string, Flow>();
  readonly ledger: AttentionLedgerEntry[] = [];
  readonly conv = new Map<MemberId, A.Conversation>();
  private served = new Map<MemberId, number>();
  private dismissed = new Map<MemberId, Map<string, number>>();
  private digestValues = new Map<MemberId, number[]>();
  private pending = new Map<MemberId, Pending>();
  private reveals = new Map<MemberId, { pid: string; at: number }>();
  /** "That intro didn't come together" notes, folded into the member's next message (never a standalone send). */
  private notes = new Map<MemberId, string>();
  private wcache?: { at: number; w: World };
  /** Diagnostics for the results doc. */
  readonly stats = {
    held: 0, heldRejected: {} as Record<string, number>, dropped: {} as Record<string, number>, digests: 0, breakIns: 0, reengaged: 0,
    itemsShown: 0, shownTo: new Map<MemberId, number>(), shown: [] as { pid: string; memberId: MemberId; at: number }[],
    composeNo: {} as Record<string, number>, autoPauses: [] as { memberId: MemberId; at: number }[], probeGate: 0, picks: 0, nones: 0, unanswered: 0,
    selfQuiet: 0, selfOverCap: 0, selfStreak: 0, suppressedLogistics: 0, suppressedAcks: 0,
    wastedInvites: 0, wastedYes: 0, backouts: 0, warmProbes: 0, revealOptOut: 0,
    sendHourMoved: 0, sendHourMembers: new Set<MemberId>(), probesWithOptions: 0, optionsOffered: 0, optionPicked: 0, optionNoneFit: 0, timedMeetings: 0, untimedMeetings: 0, calendarsConnected: 0, partnerInWindow: 0,
    eventItems: 0, eventsShown: 0, eventValues: [] as { memberId: MemberId; at: number }[], eventOnlyMessages: 0, exemptAcks: 0,
    funnel: { firstYes: 0, partnerCreated: 0, partnerShown: 0, partnerYes: 0, groupYes: 0, revealSent: 0, revealYes: 0, scheduled: 0, partnerDropped: {} as Record<string, number> },
  };
  private autoPaused = new Set<MemberId>();
  private events = new Map<string, SimEventLite>();
  private eventDay = -1;
  private inboundHours = new Map<MemberId, number[]>();
  /** Decision 1: timestamps of each member's inbound messages (replies), for the learned send time. */
  private inboundTimes = new Map<MemberId, number[]>();
  /** Decision 4: options offered per item id; accepted / declined times per member; connected calendars; accepted plans per member. */
  private itemOptions = new Map<string, A.TimeSlot[]>();
  private availHistory = new Map<MemberId, { at: number; outcome: "accepted" | "attended" | "declined_time" }[]>();
  private calendars = new Set<MemberId>();
  private acceptedPlans = new Map<MemberId, number>();
  /** Iteration 4 (d): probes that named a mutual, keyed `${proposalId}|${memberId}` (read by the harness persona model). */
  readonly warmMentioned = new Set<string>();
  /** Sequential flows start at the first answer: who was shown the first invite before that. */
  private preShown = new Map<string, MemberId>();

  constructor(private o: AttentionNetOptions) {
    super(o);
    this.cfg = resolveAttention(o.attention);
  }
  private get s(): any { return this as any; }

  override init(ctx: NetworkContext) {
    // Count every outbound message per conversation (the unified Blooio streak, 1.9).
    const send = ctx.send.bind(ctx);
    const wrapped: NetworkContext = {
      ...ctx,
      send: (memberId, body, opts) => {
        const c0 = this.convOf(memberId);
        // Option: content-free acknowledgements are not sent as their own message (each one is an
        // outbound message on Blooio's per-conversation streak).
        if (this.o.mode === "attention" && this.o.suppressAcks && opts?.meta?.type === "info" && ACK.test(body)) {
          this.stats.suppressedAcks++;
          return { id: `ack:${memberId}:${this.now()}`, ts: this.now(), direction: "outbound", channel: "imessage", from: "network", to: memberId, memberId, body, status: "failed" };
        }
        // 1.9: logistics inside an accepted item go out only while outboundSinceInbound <= 2; a member who
        // stops answering mid-plan is not messaged a fourth time (the plan continues without them).
        if (this.o.mode === "attention" && !opts?.meta?.proactive && opts?.meta?.type !== "onboarding" && opts?.meta?.type !== "system" && !A.canSendLogistics(c0, this.cfg)) {
          this.stats.suppressedLogistics++;
          return { id: `suppressed:${memberId}:${this.now()}`, ts: this.now(), direction: "outbound", channel: "imessage", from: "network", to: memberId, memberId, body, status: "failed" };
        }
        const m = send(memberId, body, opts);
        if (m.status === "delivered" && this.o.mode === "attention" && this.o.ackExempt && opts?.meta?.type === "info" && ACK.test(body)) { this.stats.exemptAcks++; return m; }
        if (m.status === "delivered") {
          const c = this.convOf(memberId);
          if (c.outboundSinceInbound >= 3) this.stats.selfStreak++; // would be Blooio's 4th unanswered
          c.outboundSinceInbound++;
        }
        return m;
      },
    };
    super.init(wrapped);
  }

  private convOf(id: MemberId): A.Conversation {
    let c = this.conv.get(id);
    if (!c) { c = { outboundSinceInbound: 0 }; this.conv.set(id, c); }
    return c;
  }
  private now(): number { return this.s.ctx.clock.now(); }

  // ------------------------------------------------------------------ proposals in
  override submitProposal(p: Proposal) {
    if (this.o.mode !== "attention") return super.submitProposal(p);
    const ep = p as EngineProposal;
    const now = this.now();
    // Same hard policy as the stub's dispatch: anything touching a minor is refused whole.
    if ([...ep.participants, ...(ep.alternates ?? [])].some(id => this.s.member(id).minor)) {
      this.s.ctx.log("proposal_skipped", { proposalId: ep.id, reason: "minors_policy" });
      return;
    }
    this.proposals.set(ep.id, ep);
    // Sim: no human reviewer exists (the stub has no review step either), so items are approved here.
    const parallel = !!this.o.parallelProbes && this.o.probes && ep.participants.length === 2;
    if (parallel) this.flows.set(ep.id, { p: ep, f: A.startProbeFlow(ep, { parallel: true }), stage: "probing", reveal: new Map() });
    for (const it of A.itemsForProposal(ep, { now, calibrate: this.o.calibrate, cfg: this.cfg, reviewState: "approved", parallel })) this.addHeld(it, now);
  }

  private addHeld(it: AttentionItem, now: number): boolean {
    const m = this.s.member(it.memberId);
    if (m.optedOut) { this.bump(this.stats.heldRejected, "opted_out"); return false; }
    const prefs = A.defaultCadence("normal", this.cfg);
    const r = A.addToHold(this.hold.get(it.memberId) ?? [], it, prefs, now, { dismissed: this.dismissed.get(it.memberId), cfg: this.cfg });
    this.hold.set(it.memberId, r.queue);
    for (const e of r.evicted) if (e.key !== it.key) this.onDropped(e, "evicted");
    if (!r.added) { this.bump(this.stats.heldRejected, r.reason ?? "?"); return false; }
    this.stats.held++;
    return true;
  }
  private bump(o: Record<string, number>, k: string) { o[k] = (o[k] ?? 0) + 1; }
  /** A live parallel flow: an unanswered, dropped or passed item is that member's no. */
  private isParallel(pid?: string) { const fl = pid ? this.flows.get(pid) : undefined; return !!fl?.f.parallel && fl.stage === "probing"; }
  private onDropped(it: HeldItem | AttentionItem, reason: string) {
    this.bump(this.stats.dropped, reason.split(":")[0]!);
    if (it.stage === "partner") this.bump(this.stats.funnel.partnerDropped, reason.split(":")[0]!);
    // A partner item that can no longer be sent ends the opportunity.
    if ((it.stage === "partner" || this.isParallel(it.sourceProposalId)) && it.sourceProposalId) this.answer(it.sourceProposalId, it.memberId, false, "partner_item_dropped");
  }

  // ------------------------------------------------------------------ member view
  private viewCache = new Map<MemberId, { at: number; v: A.MemberAttention }>();
  private snapMembers?: { at: number; byId: Map<MemberId, any> };
  private view(id: MemberId, now: number): A.MemberAttention | undefined {
    if (!this.snapMembers || now - this.snapMembers.at > 6 * HOUR) {
      const snap = this.s.ctx.snapshot();
      this.snapMembers = { at: now, byId: new Map(snap.members.map((m: any) => [m.id, m])) };
    }
    const mem = this.snapMembers.byId.get(id);
    if (!mem) return undefined;
    const st = this.s.member(id);
    const [qs, qe] = mem.prefs.quietHours as [number, number];
    // The stub only texts 09:00-20:00 local; keep that window as part of quiet hours for parity.
    const quietHours: [number, number] = [qs >= 12 ? Math.min(qs, 20) : 20, Math.max(qe, 9)];
    const state = st.optedOut ? "paused" : mem.state;
    let prefs = A.defaultCadence(mem.state, this.cfg);
    const cad = this.o.cadence ?? "weekly";
    if (mem.state === "normal" || mem.state === "open") {
      if (cad === "twice") prefs = { ...prefs, digestDays: [2, 4] };
      else if (cad === "rolling") prefs = { ...prefs, digestDays: [0, 1, 2, 3, 4, 5, 6] };
    }
    if (cad === "immediate") prefs = { ...prefs, mode: "as_it_comes" };
    if (this.o.learnedCadence) {
      // D11: learning moves the hour and can only make it quieter.
      const hs = this.inboundHours.get(id) ?? [];
      const learned: Partial<A.MemberAttention["prefs"]> = {};
      if (hs.length >= 3) {
        const counts = new Map<number, number>();
        for (const h of hs) counts.set(h, (counts.get(h) ?? 0) + 1);
        const best = [...counts].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))[0]![0];
        learned.digestHour = Math.max(10, Math.min(18, best));
      }
      if (this.ledger.some(e => e.memberId === id && e.countsAgainstCap && e.repliedAt === undefined && now - e.at > this.cfg.annoyance.unansweredHours * HOUR && now - e.at < 14 * DAY)) {
        learned.digestDays = [4]; learned.maxItemsPerDigest = 2;
        if (prefs.mode === "as_it_comes") learned.mode = "digest";
      }
      prefs = A.applyLearnedCadence(prefs, learned);
    }
    const tz = mem.homeCity === "sf" ? "America/Los_Angeles" : "America/New_York";
    if (this.o.sendTime === "learned") {
      const prof = A.learnSendProfile(this.inboundTimes.get(id) ?? [], tz, now, quietHours, this.cfg);
      prefs = { ...prefs, sendHours: { weekday: prof.weekday, weekend: prof.weekend } };
      if ((prof.learned.weekday || prof.learned.weekend) && !this.stats.sendHourMembers.has(id)) { this.stats.sendHourMembers.add(id); this.stats.sendHourMoved++; }
    }
    return {
      memberId: id, state, age: mem.age, tz, quietHours,
      onlyWhenAsked: st.unanswered >= 2 || A.unansweredInterruptions(this.ledger, id, now, this.cfg, this.convOf(id).lastInboundAt) >= 2,
      newcomer: now - (mem.joinedAt ?? 0) < this.cfg.newcomer.days * DAY,
      prefs, categoriesOptIn: mem.prefs.categoriesOptIn,
    };
  }

  /**
   * Members already committed somewhere (stub opportunity, a yes in a live flow, an open digest or
   * reveal): never double-book. `except`: the opportunity being probed does not count against itself.
   */
  private busy(id: MemberId, except?: string): boolean {
    for (const o of this.s.opps.values()) if ((o.stage === "inviting" || o.stage === "scheduled") && o.p.participants.includes(id) && o.invites.get(id)?.status !== "no") return true;
    for (const fl of this.flows.values()) {
      if (fl.stage === "closed" || fl.stage === "scheduled" || fl.p.id === except) continue;
      if (fl.f.answers[id] === "yes" || fl.reveal.has(id)) return true;
    }
    if (this.pending.has(id) && !(except && this.pending.get(id)!.items.some(it => it.sourceProposalId === except))) return true;
    return this.reveals.has(id) && this.reveals.get(id)!.pid !== except;
  }

  private world(now: number): World {
    if (!this.wcache || this.wcache.at !== now) this.wcache = { at: now, w: new World(this.s.ctx.snapshot() as EngineInput, ENGINE_CFG, trivialEmbed) };
    return this.wcache.w;
  }

  // ------------------------------------------------------------------ tick
  override async tick(now: number) {
    await super.tick(now);
    if (this.o.mode !== "attention") return;
    this.expirePending(now);
    this.reengage(now);
    if (this.o.outsideWorld && Math.floor(now / DAY) !== this.eventDay) { this.eventDay = Math.floor(now / DAY); this.refreshEvents(now); }
    for (const [id, q] of this.hold) {
      if (!q.length) continue;
      // Cheap expiry pass every tick; full revalidation happens right before a send.
      const r = A.revalidateHold(q, now, undefined, undefined, this.cfg);
      for (const d of r.dropped) this.onDropped(d.item, d.reason);
      this.hold.set(id, r.kept);
      if (!r.kept.length) continue;
      const v = this.view(id, now);
      if (!v) continue;
      // A slot missed for a transient reason (busy in an open opportunity, quiet hours, the
      // conversation streak) is served at the first chance before the next slot.
      const slot = A.digestDue(v, now, this.served.get(id), this.cfg, this.o.sendWindowHours ?? this.o.slotWindowHours ?? 6 * 24);
      if (slot !== undefined) { this.attempt(id, v, now, "digest", slot); continue; }
      // Decision 3: a partner probe needs no break-in: it goes inside the partner's send window, within their cap.
      if (this.o.partnerInWindow) {
        if (r.kept.some(it => it.stage === "partner") && A.inSendWindow(v, now, this.o.sendWindowHours ? { ...this.cfg, sendTime: { ...this.cfg.sendTime, windowHours: this.o.sendWindowHours } } : this.cfg)) {
          this.stats.partnerInWindow++;
          this.attempt(id, v, now, "digest", undefined, true);
        }
        continue;
      }
      const next = A.nextDigestSlot(v, now, this.cfg);
      if (this.o.partnerAnyCap && r.kept.some(it => it.stage === "partner")) { this.attempt(id, v, now, "break_in", undefined, true); continue; }
      if (r.kept.some(it => it.urgency.expiresAt < next)) this.attempt(id, v, now, "break_in");
    }
  }

  private attempt(id: MemberId, v: A.MemberAttention, now: number, mode: "digest" | "break_in", slot?: number, partnerOnly = false) {
    const m = this.s.member(id);
    if (m.optedOut) { if (slot !== undefined) this.served.set(id, slot); return; }
    if (this.busy(id)) { this.bump(this.stats.composeNo, `${mode}:busy`); return; }
    let cfg = this.o.capOnly ? { ...this.cfg, lambda: { ...this.cfg.lambda, open: 0, normal: 0, quiet: 0, receiving: 0 }, qualityBar: { ...this.cfg.qualityBar, open: 0, normal: 0, quiet: 0, receiving: 0 } } : this.cfg;
    if (this.o.lambdaScale !== undefined && !this.o.capOnly) {
      const k = this.o.lambdaScale;
      cfg = { ...cfg, lambda: { ...cfg.lambda, open: cfg.lambda.open * k, normal: cfg.lambda.normal * k, quiet: cfg.lambda.quiet * k, receiving: cfg.lambda.receiving * k } };
    }
    // Diagnostic: a partner probe may use any remaining cap (no break-in allowance, no 1.5x median bar).
    if (partnerOnly) cfg = { ...cfg, breakIns: cfg.caps, breakIn: { ...cfg.breakIn, valueRatio: 0 } };
    const pool = (q: readonly HeldItem[]) => (partnerOnly ? q.filter(it => it.stage === "partner") : q);
    const med = this.digestValues.get(id);
    const medianDigestValue = med?.length ? A.quantile(med, 0.5) : undefined;
    // Cheap pre-check (gates, cap, price) before building the eligibility view.
    const pre = A.composeMessage({ member: v, items: pool(this.hold.get(id) ?? []), ledger: this.ledger, conversation: this.convOf(id), now, mode, medianDigestValue, cfg });
    if (!pre.send) {
      this.bump(this.stats.composeNo, `${mode}:${pre.reason}`);
      if (slot !== undefined && !["quiet_hours", "conversation_streak"].includes(pre.reason)) this.served.set(id, slot);
      return;
    }
    // Re-validate with the existing send-time check (filters.ts eligibilityFor) before any send.
    const w = this.world(now);
    const check = eligibilityFor(w, x => this.s.member(x).optedOut);
    const rv = A.revalidateHold(this.hold.get(id) ?? [], now, check, it => (it.others.some(o => this.busy(o, it.sourceProposalId)) ? "partner_busy" : null), this.cfg);
    // A busy partner is temporary: keep those held, drop the rest.
    const keep = [...rv.kept];
    for (const d of rv.dropped) { if (d.reason === "partner_busy") keep.push(d.item); else this.onDropped(d.item, d.reason); }
    this.hold.set(id, keep);
    const candidates = pool(rv.kept);
    // Probe texts first: an item whose probe cannot pass the leak gate is never sent.
    const texts = new Map<string, string>();
    for (const it of candidates) {
      const t = this.itemText(w, it, now);
      if (t) texts.set(it.id, t); else { this.stats.probeGate++; this.onDropped(it, "probe_gate"); this.hold.set(id, (this.hold.get(id) ?? []).filter(x => x.id !== it.id)); }
    }
    const res = A.composeMessage({
      member: v, items: candidates.filter(it => texts.has(it.id)), ledger: this.ledger, conversation: this.convOf(id), now, mode, medianDigestValue, cfg,
    });
    if (!res.send) {
      this.bump(this.stats.composeNo, `${mode}:${res.reason}`);
      // Retry later in the slot window only for transient reasons.
      if (slot !== undefined && !["quiet_hours", "conversation_streak"].includes(res.reason)) this.served.set(id, slot);
      return;
    }
    if (this.o.eventsAlone === false && res.items.every(it => !it.sourceProposalId)) {
      this.bump(this.stats.composeNo, `${mode}:events_need_company`);
      if (slot !== undefined) this.served.set(id, slot);
      return;
    }
    if (slot !== undefined) this.served.set(id, slot);
    this.sendItems(id, v, res.items, res.values, mode, texts, now);
  }

  /** Member-facing line for one item: an anonymous probe (D5) or, without probes, the stub's named invite. */
  private itemText(w: World, it: AttentionItem, now: number): string | null {
    if (it.kind === "event_suggestion") {
      const ev = this.events.get(it.key.slice(3));
      if (!ev) return null;
      const d = new Date(ev.start).toLocaleString("en-US", { timeZone: ev.city === "sf" ? "America/Los_Angeles" : "America/New_York", weekday: "short", hour: "numeric" });
      return `${ev.title}, ${d}. Want the link?`;
    }
    const p = this.proposals.get(it.sourceProposalId!);
    if (!p) return null;
    if (this.o.probes) {
      const tz = p.city === "sf" ? "America/Los_Angeles" : "America/New_York";
      const options = this.o.timeOptions ? this.optionsFor(w, it, p, tz, now) : undefined;
      const mutual = this.o.warmConsent ? A.warmMention(w, p.via, it.memberId, it.others, this.o.warmConsent, p.category, this.cfg) ?? undefined : undefined;
      const pr = A.buildProbe(w, { proposalId: p.id, kind: p.kind, category: p.category, objective: p.objective, window: p.window, tz, role: p.roles?.[it.memberId], ...(options?.length ? { options } : {}), ...(mutual ? { mutual } : {}) },
        it.memberId, it.others, now);
      if (pr && options?.length) this.itemOptions.set(it.id, options); else this.itemOptions.delete(it.id);
      if (pr?.mutual) this.warmMentioned.add(`${p.id}|${it.memberId}`); else this.warmMentioned.delete(`${p.id}|${it.memberId}`);
      return pr?.text ?? null;
    }
    const others = it.others.map(id => this.s.member(id));
    const why = p.explanations[it.memberId] ?? "it seemed like a good fit";
    return others.length === 1 ? `Meet ${others[0].display}: ${why}` : `A small ${p.objective} with ${others.length} others (${why}).`;
  }

  /** Decision 4: everything the Network knows about when a member is free (engine-visible only). */
  private evidence(w: World, id: MemberId, tz: string, now: number): A.AvailabilityEvidence {
    const v = this.view(id, now);
    const facets = w.input.facets.filter(f => f.memberId === id);
    const ev: A.AvailabilityEvidence = { memberId: id, tz, quietHours: v?.quietHours, standing: A.standingFromFacets(facets, now), history: this.availHistory.get(id) ?? [] };
    const home = this.snapMembers?.byId.get(id)?.homeCity;
    const away = w.input.presence.filter(pr => pr.memberId === id && pr.type === "temporary" && pr.city !== home && pr.from !== undefined && pr.to !== undefined);
    if (away.length) ev.away = away.map(pr => ({ start: pr.from!, end: pr.to! }));
    if (this.calendars.has(id) && this.o.hiddenFree) {
      // Free/busy only: the calendar's busy blocks over the candidate slots (harness: hidden availability, imperfect recall).
      ev.calendar = { busy: A.candidateSlots(tz, now, {}, this.cfg).filter(sl => !this.o.hiddenFree!(id, sl.start) && (this.o.calendarShowsBusy?.(id, sl.start) ?? true)) };
    }
    return ev;
  }
  /** Time options for a probe: the partner gets the slots the first member picked; otherwise the best joint slots for everyone involved. */
  private optionsFor(w: World, it: AttentionItem, p: EngineProposal, tz: string, now: number): A.TimeSlot[] | undefined {
    const fl = this.flows.get(p.id);
    if (it.stage === "partner" && fl?.times !== undefined) {
      // The partner chooses among the slots the first member picked; if none of the first member's options fit, no times (scheduled the default way).
      const xs = fl.times.filter(t => t.start > now + 12 * HOUR).slice(0, this.cfg.availability.maxOptions);
      return xs.length ? xs : undefined;
    }
    // Parallel: both members see the same options (computed once per opportunity), so their picks can meet.
    const shared = fl?.f.parallel ? fl.offered?.filter(t => t.start > now + 12 * HOUR) : undefined;
    if (shared?.length) return shared;
    const fixed = p.anchor?.type === "event" && !!p.window && p.window.end - p.window.start <= 6 * HOUR;
    const ids = [it.memberId, ...it.others];
    const r = A.chooseTimeOptions(ids.map(x => this.evidence(w, x, tz, now)), now, { tz, ...(fixed ? { fixed: true, window: p.window } : {}) }, this.cfg);
    const out = r.slots.map(x => x.slot);
    if (fl?.f.parallel) fl.offered = out;
    return out;
  }
  /** HARNESS: the persona said yes to a probe with options; which of them they pick comes from their hidden weekly availability. */
  private pickTimes(pid: string, it: AttentionItem, id: MemberId, now: number) {
    const opts = this.itemOptions.get(it.id);
    this.itemOptions.delete(it.id);
    const fl = this.flows.get(pid);
    if (!fl || !opts?.length || !this.o.hiddenFree) return;
    const ok = opts.filter(t => t.start > now && this.o.hiddenFree!(id, t.start));
    const hist = this.availHistory.get(id) ?? [];
    if (!ok.length) {
      // "Yes, but none of those times": the opportunity goes on without a time (best estimated slot at the reveal).
      this.stats.optionNoneFit++;
      for (const t of opts) hist.push({ at: t.start, outcome: "declined_time" });
      this.availHistory.set(id, hist);
    } else this.stats.optionPicked++;
    // Slots every member who answered with options picked (sequential: the partner chose among the first member's picks).
    const picks = fl.picks ?? new Map<MemberId, number[]>();
    fl.picks = picks;
    picks.set(id, ok.map(t => t.start));
    const pool = new Map([...(fl.times ?? []), ...opts].map(t => [t.start, t]));
    fl.times = [...pool.values()].filter(t => [...picks.values()].every(xs => xs.includes(t.start))).sort((a, b) => a.start - b.start);
  }

  private sendItems(id: MemberId, v: A.MemberAttention, items: AttentionItem[], values: number[], kind: "digest" | "break_in" | "reengage", texts: Map<string, string>, now: number) {
    const m = this.s.member(id);
    // Member items carry the decision; outside-world items are glances the member may act on.
    const memberItems = items.filter(x => x.sourceProposalId);
    const pickedId = memberItems.length > 1 && this.o.choose ? this.o.choose(id, memberItems, this.proposals, now) : memberItems[0]?.id;
    const picked = memberItems.find(x => x.id === pickedId) ?? memberItems[0];
    const p = picked ? this.proposals.get(picked.sourceProposalId!)! : undefined;
    let body = A.digestText(items.map(it => texts.get(it.id) ?? ""));
    if (kind === "reengage") body = `${body} ${A.REENGAGE_SUFFIX}`;
    const note = this.notes.get(id);
    if (note) { body = `${note}\n\n${body}`; this.notes.delete(id); }
    const attention = { kind, items: items.map(x => x.sourceProposalId ?? x.key), picked: picked?.sourceProposalId };
    const meta: SimMeta = !p ? { type: "concierge", proactive: true, attention }
      : this.o.probes
        ? { type: "probe", proactive: true, probe: { key: p.id, category: p.category, participants: [...p.participants], kind: p.kind, window: p.window }, attention }
        : { type: "proposal", proposalId: p.id, participants: p.participants, proactive: true, attention };
    if (!p) this.stats.eventOnlyMessages++;
    for (const it of items) if (it.kind === "event_suggestion") {
      this.stats.eventsShown++;
      const ev = this.events.get(it.key.slice(3));
      if (ev && this.o.actOnEvent?.(id, ev, now)) this.stats.eventValues.push({ memberId: id, at: ev.start });
    }
    if (A.inMemberQuietHours(v, now, this.cfg)) this.stats.selfQuiet++;
    const cap = A.capFor({ ...v, onlyWhenAsked: false }, this.cfg);
    if (A.interruptionsUsed(this.ledger, id, now, cap.periodDays) >= cap.limit && kind !== "reengage") this.stats.selfOverCap++;
    const msg = this.s.send(m, body, meta);
    m.awaiting = { kind: "digest", pid: p?.id ?? "" };
    m.proactive.push(now);
    // Decision 3: a message counts against the cap iff it carries an initial invite (all harness items are invites).
    this.ledger.push({ messageId: msg.id, memberId: id, at: now, kind, itemIds: items.map(x => x.id), countsAgainstCap: A.countsAgainstCap(items, this.cfg) });
    for (const it of items) if (this.itemOptions.has(it.id)) { this.stats.probesWithOptions++; this.stats.optionsOffered += this.itemOptions.get(it.id)!.length; }
    this.pending.set(id, { messageId: msg.id, memberId: id, at: now, kind, items, picked });
    const sent = new Set(items.map(x => x.id));
    this.hold.set(id, (this.hold.get(id) ?? []).filter(x => !sent.has(x.id)));
    if (kind === "digest") this.stats.digests++; else if (kind === "break_in") this.stats.breakIns++; else this.stats.reengaged++;
    if (kind === "digest") this.digestValues.set(id, [...(this.digestValues.get(id) ?? []), ...values]);
    this.stats.itemsShown += items.length;
    this.stats.shownTo.set(id, (this.stats.shownTo.get(id) ?? 0) + items.length);
    for (const it of memberItems) this.stats.shown.push({ pid: it.sourceProposalId!, memberId: id, at: now });
    for (const it of items) if (it.stage === "partner") this.stats.funnel.partnerShown++;
    for (const it of memberItems) { this.shownPids.add(it.sourceProposalId!); if (!this.shownAt.has(it.sourceProposalId!)) this.shownAt.set(it.sourceProposalId!, now); }
    for (const it of memberItems) if (this.warmMentioned.has(`${it.sourceProposalId}|${id}`)) this.stats.warmProbes++;
    for (const it of memberItems) { const fl = this.flows.get(it.sourceProposalId!); if (fl) (fl.shown ??= new Set()).add(id); else this.preShown.set(it.sourceProposalId!, id); }
  }

  // ------------------------------------------------------------------ replies
  override async onInbound(msg: InboundMessage) {
    if (this.o.mode !== "attention") return super.onInbound(msg);
    const now = this.now();
    const c = this.convOf(msg.memberId);
    c.outboundSinceInbound = 0; c.lastInboundAt = now;
    if (this.o.sendTime === "learned" && !msg.keyword) this.inboundTimes.set(msg.memberId, [...(this.inboundTimes.get(msg.memberId) ?? []), now]);
    if (this.o.learnedCadence) {
      const city = this.snapMembers?.byId.get(msg.memberId)?.homeCity ?? "sf";
      const h = Number(new Date(now).toLocaleString("en-US", { timeZone: city === "sf" ? "America/Los_Angeles" : "America/New_York", hour: "numeric", hourCycle: "h23" }));
      this.inboundHours.set(msg.memberId, [...(this.inboundHours.get(msg.memberId) ?? []), h % 24]);
    }
    const m = this.s.member(msg.memberId);
    if (msg.keyword === "STOP") {
      await super.onInbound(msg);
      this.markReplied(msg.memberId, now, "stop");
      this.dropMember(msg.memberId, "opted_out");
      return;
    }
    const pend = this.pending.get(msg.memberId);
    if (pend && !msg.keyword && m.awaiting?.kind === "digest") {
      m.lastInbound = now; m.unanswered = 0; m.awaiting = undefined;
      const yn = parseYesNo(msg.body);
      const pick = yn === "yes" || yn === "counter";
      this.markReplied(msg.memberId, now, pick ? "pick" : "none");
      this.pending.delete(msg.memberId);
      this.resolveDigest(pend, pick, now);
      return;
    }
    const rv = this.reveals.get(msg.memberId);
    if (rv && !msg.keyword && m.awaiting?.kind === "reveal") {
      m.lastInbound = now; m.unanswered = 0; m.awaiting = undefined;
      this.reveals.delete(msg.memberId);
      const yn = parseYesNo(msg.body);
      const ok = yn === "yes" || yn === "counter";
      if (!ok) this.s.send(m, "No problem at all, thanks for letting me know.", { type: "info" });
      this.onReveal(rv.pid, msg.memberId, ok, now);
      return;
    }
    this.markReplied(msg.memberId, now, "other");
    return super.onInbound(msg);
  }

  /** Any inbound message answers the member's open interruptions (1.4: any reply, including "none" and a tapback). */
  private markReplied(id: MemberId, now: number, kind: AttentionLedgerEntry["replyKind"]) {
    for (const e of this.ledger) if (e.memberId === id && e.repliedAt === undefined && e.countsAgainstCap && now - e.at <= this.cfg.annoyance.unansweredHours * HOUR) { e.repliedAt = now; e.replyKind = kind; }
  }

  private resolveDigest(pend: Pending, pick: boolean, now: number) {
    const id = pend.memberId;
    const dis = this.dismissed.get(id) ?? new Map<string, number>();
    const requeue: AttentionItem[] = [];
    for (const it of pend.items) {
      if (pick && it === pend.picked) continue;
      this.itemOptions.delete(it.id);
      if (pick && this.o.requeueUnpicked && it.stage !== "partner" && it.urgency.expiresAt > now) { requeue.push(it); continue; }
      void 0;
      // Seen and passed on: not offered again for 30 days; "none" is not a decline of any person.
      dis.set(it.key, now + this.cfg.hold.dismissDays * DAY);
      if (it.sourceProposalId && (it.stage === "partner" || it.others.length > 1 || this.isParallel(it.sourceProposalId))) this.answer(it.sourceProposalId, id, false, "not_picked");
    }
    this.dismissed.set(id, dis);
    for (const it of requeue) this.addHeld(it, now);
    const m = this.s.member(id);
    if (!pend.picked) return; // an outside-world-only message: any reply answers it
    if (!pick) { this.stats.nones++; this.s.send(m, "No problem at all, thanks for letting me know.", { type: "info" }); return; }
    this.stats.picks++;
    if (this.o.timeOptions && this.o.probes) {
      const pid = pend.picked.sourceProposalId!;
      const fl = this.flows.get(pid) ?? this.newFlow(pid);
      this.flows.set(pid, fl);
      this.pickTimes(pid, pend.picked, id, now);
    }
    this.answer(pend.picked.sourceProposalId!, id, true, "picked");
  }

  private newFlow(pid: string): Flow {
    const p = this.proposals.get(pid)!;
    const fl: Flow = { p, f: A.startProbeFlow(p), stage: "probing", reveal: new Map() };
    const pre = this.preShown.get(pid);
    if (pre) fl.shown = new Set([pre]);
    this.flows.set(pid, fl);
    return fl;
  }

  /** Record a member's yes/no on an opportunity and move its flow on. */
  private answer(pid: string, id: MemberId, yes: boolean, why: string) {
    const p = this.proposals.get(pid);
    if (!p) return;
    const now = this.now();
    let fl = this.flows.get(pid);
    if (!fl) fl = this.newFlow(pid);
    if (fl.stage !== "probing") return;
    // The first item may go to someone startProbeFlow did not expect (pairs always start with firstToProbe).
    const before = fl.f.stage;
    fl.f = A.recordProbeAnswer(fl.f, id, yes);
    if (yes) this.engaged.add(pid);
    if (yes) { if (fl.f.group) this.stats.funnel.groupYes++; else if (id === fl.f.first) this.stats.funnel.firstYes++; else this.stats.funnel.partnerYes++; }
    const m = this.s.member(id);
    if (fl.f.stage === "closed") {
      fl.stage = "closed";
      // Tell people who said yes, without revealing who declined (F11, F29).
      for (const [x, a] of Object.entries(fl.f.answers)) if (a === "yes" && x !== id) this.notes.set(x, "That intro didn't come together this time; I'll keep an eye out.");
      // An initial invite spent on someone whose opportunity died on another member's no or silence.
      for (const x of fl.shown ?? []) if (x !== id && fl.f.answers[x] !== "no") { this.stats.wastedInvites++; if (fl.f.answers[x] === "yes") this.stats.wastedYes++; }
      // Drop anyone's still-held item for this opportunity.
      for (const [mid, q] of this.hold) this.hold.set(mid, q.filter(x => x.sourceProposalId !== pid || x.memberId === id));
      void why;
      return;
    }
    if (!yes) return;
    if (canRevealOrSchedule(fl)) return this.reveal(fl, now);
    if (!fl.f.group && before === "probing_first" && fl.f.stage === "probing_partners") {
      this.s.send(m, "Great, I'll check with them and let you know.", { type: "info" });
      for (const partner of A.toProbe(fl.f)) {
        const it = A.partnerItem(p, partner, { now, calibrate: this.o.calibrate, cfg: this.cfg, reviewState: "approved" });
        this.stats.funnel.partnerCreated++;
        this.engaged.add(pid);
        if (!this.addHeld(it, now)) this.answer(pid, partner, false, "partner_unavailable");
      }
      return;
    }
    if (fl.f.group) this.s.send(m, "Great, you're in. I'll confirm once enough people are set.", { type: "info" });
  }

  /** Both (or quorum) said yes. Probes: reveal names, each confirms. Without probes: they already saw who, so schedule. */
  private reveal(fl: Flow, now: number) {
    const yes = Object.keys(fl.f.answers).filter(x => fl.f.answers[x] === "yes");
    if (!this.o.probes) return this.scheduleFlow(fl, yes, now);
    if (this.o.revealOptOut) return this.revealBooked(fl, yes, now);
    fl.stage = "revealing";
    fl.revealDeadline = now + 48 * HOUR;
    for (const id of yes) {
      const m = this.s.member(id);
      const r = A.revealFor(fl.f, id, x => this.s.member(x).display);
      if (!r) continue;
      if (!A.canSendLogistics(this.convOf(id), this.cfg)) { fl.reveal.set(id, "no"); continue; }
      const why = fl.p.explanations[id] ?? "";
      const when = fl.times?.length ? ` ${fmtLocal(fl.times[0]!.start, fl.p.city)} works for both of you.` : "";
      this.s.send(m, `Good news: ${r.names.join(", ")} ${r.names.length > 1 ? "are" : "is"} up for it too.${when} ${why} Want me to set it up?`.replace(/\s+/g, " ").trim(),
        { type: "proposal", proposalId: fl.p.id, participants: fl.p.participants, proactive: false, reveal: true });
      this.ledger.push({ messageId: `reveal:${fl.p.id}:${id}`, memberId: id, at: now, kind: "logistics", itemIds: [], countsAgainstCap: false });
      fl.reveal.set(id, "sent");
      this.stats.funnel.revealSent++;
      m.awaiting = { kind: "reveal", pid: fl.p.id };
      this.reveals.set(id, { pid: fl.p.id, at: now });
    }
    this.checkReveal(fl, now);
  }
  /**
   * (b) The reveal is the booked plan: "You're both in: meet Sam, Thu 7pm near X. Reply if you can't
   * make it." No third yes; silence means in. A "can't" cancels the plan and tells the other person.
   */
  private revealBooked(fl: Flow, going: MemberId[], now: number) {
    const t = this.scheduleFlow(fl, going, now, false);
    for (const id of going) {
      const m = this.s.member(id);
      const r = A.revealFor(fl.f, id, x => this.s.member(x).display);
      if (!r) continue;
      if (!A.canSendLogistics(this.convOf(id), this.cfg)) continue;
      const why = fl.p.explanations[id] ?? "";
      const when = t ? `${fmtLocal(t, fl.p.city)} near ${this.s.member(going[0]!).area}` : "this week";
      this.s.send(m, `You're both in: meet ${r.names.join(", ")}, ${when}. ${why} Reply if you can't make it.`.replace(/\s+/g, " ").trim(),
        { type: "proposal", proposalId: fl.p.id, participants: fl.p.participants, proactive: false, reveal: true, ...(t ? { meetingAt: t } : {}) });
      this.ledger.push({ messageId: `reveal:${fl.p.id}:${id}`, memberId: id, at: now, kind: "logistics", itemIds: [], countsAgainstCap: false });
      this.stats.funnel.revealSent++; this.stats.revealOptOut++;
      m.awaiting = { kind: "reveal", pid: fl.p.id };
      this.reveals.set(id, { pid: fl.p.id, at: now });
    }
  }
  private onReveal(pid: string, id: MemberId, yes: boolean, now: number) {
    const fl = this.flows.get(pid);
    if (this.o.revealOptOut) {
      // Opt-out reveal: silence (yes = true from the deadline) keeps the plan; only an explicit "can't" cancels it.
      if (!fl || fl.stage !== "scheduled" || yes) { if (yes && fl?.stage === "scheduled") this.stats.funnel.revealYes++; return; }
      this.stats.backouts++;
      fl.stage = "closed";
      const opp = this.s.opps.get(pid);
      if (opp) this.s.cancel(opp, "backed_out");
      for (const x of Object.keys(fl.f.answers)) if (x !== id) this.notes.set(x, "That plan fell through on their side, sorry. I'll keep an eye out.");
      return;
    }
    if (!fl || fl.stage !== "revealing") return;
    fl.reveal.set(id, yes ? "yes" : "no");
    if (yes) this.stats.funnel.revealYes++;
    this.checkReveal(fl, now);
  }
  private checkReveal(fl: Flow, now: number) {
    const yes = [...fl.reveal].filter(([, s]) => s === "yes").map(([x]) => x);
    const open = [...fl.reveal].filter(([, s]) => s === "sent").length;
    const need = fl.f.group ? fl.f.quorum : 2;
    if (yes.length >= need && (open === 0 || !fl.f.group)) return this.scheduleFlow(fl, yes, now);
    if (yes.length + open < need) {
      fl.stage = "closed";
      for (const x of yes) this.notes.set(x, "That intro didn't come together this time; I'll keep an eye out.");
      for (const [x, s] of fl.reveal) if (s === "sent") { this.reveals.delete(x); const mm = this.s.member(x); if (mm.awaiting?.pid === fl.p.id) mm.awaiting = undefined; }
    }
  }
  private scheduleFlow(fl: Flow, going: MemberId[], now: number, notify = true): number | undefined {
    fl.stage = "scheduled";
    this.stats.funnel.scheduled++;
    this.engaged.add(fl.p.id);
    for (const [mid, q] of this.hold) this.hold.set(mid, q.filter(x => x.sourceProposalId !== fl.p.id));
    const opp = {
      p: fl.p, invites: new Map(fl.p.participants.map(x => [x, { status: going.includes(x) ? "yes" : "dropped", sentAt: now }])), stage: "inviting",
      quorum: fl.f.group ? fl.f.quorum : 2, deadline: now + 48 * HOUR,
    };
    this.s.opps.set(fl.p.id, opp);
    let t = fl.times?.find(x => x.start > now + 2 * HOUR);
    if (fl.times !== undefined) { if (t) this.stats.timedMeetings++; else this.stats.untimedMeetings++; }
    if (!t && (this.o.timeOptions || this.o.revealOptOut)) {
      // No option fit everyone: the reveal proposes the best estimated joint slot instead of a fixed default (inference only, 4e/4b/4c).
      const tz = fl.p.city === "sf" ? "America/Los_Angeles" : "America/New_York";
      const w = this.world(now);
      t = A.chooseTimeOptions(going.map(x => this.evidence(w, x, tz, now)), now, { tz }, { ...this.cfg, availability: { ...this.cfg.availability, minOptions: 1, maxOptions: 1 } }).slots[0]?.slot;
    }
    if (!t) { this.s.schedule(opp, now); return (opp as any).meetingAt; }
    // Decision 4: the meeting is at the time everyone picked.
    (opp as any).stage = "scheduled";
    (opp as any).meetingAt = t.start;
    this.s.ctx.recordMeeting({ proposalId: fl.p.id, participants: going, at: t.start, city: fl.p.city, kind: fl.p.kind });
    for (const id of going) {
      const m = this.s.member(id);
      const others = going.filter(x => x !== id).map(x => this.s.member(x).first).join(", ");
      if (notify) this.s.send(m, `You're all set with ${others}: ${fmtLocal(t.start, fl.p.city)} near ${this.s.member(going[0]!).area}. I'll send a reminder that day.`,
        { type: "scheduling", proposalId: fl.p.id, meetingAt: t.start, proactive: false });
      const h = this.availHistory.get(id) ?? [];
      h.push({ at: t.start, outcome: "accepted" });
      this.availHistory.set(id, h);
      // 4c: offer the calendar at the moment of value (folded into this confirmation; no extra message).
      const n = (this.acceptedPlans.get(id) ?? 0) + 1;
      this.acceptedPlans.set(id, n);
      if (n === this.cfg.availability.calendar.offerAfterAcceptedPlans && !this.calendars.has(id) && this.o.connectsCalendar?.(id)) { this.calendars.add(id); this.stats.calendarsConnected++; }
    }
    return t.start;
  }

  private expirePending(now: number) {
    for (const [id, pend] of [...this.pending]) {
      if (now - pend.at < this.cfg.annoyance.unansweredHours * HOUR) continue;
      // Unanswered interruption (72h): counts toward the two-unanswered rule; the items are released.
      this.pending.delete(id);
      const m = this.s.member(id);
      if (m.awaiting?.kind === "digest") m.awaiting = undefined;
      m.unanswered++;
      this.stats.unanswered++;
      for (const it of pend.items) if (it.sourceProposalId && (it.stage === "partner" || it.others.length > 1 || it === pend.picked || this.isParallel(it.sourceProposalId))) this.answer(it.sourceProposalId, id, false, "unanswered");
      if (!this.autoPaused.has(id) && (m.unanswered >= 2 || A.unansweredInterruptions(this.ledger, id, now, this.cfg, this.convOf(id).lastInboundAt) >= 2)) {
        this.autoPaused.add(id);
        this.stats.autoPauses.push({ memberId: id, at: now });
      }
    }
    for (const [id, r] of [...this.reveals]) {
      if (now - r.at < 48 * HOUR) continue;
      this.reveals.delete(id);
      const m = this.s.member(id);
      if (m.awaiting?.kind === "reveal") m.awaiting = undefined;
      this.onReveal(r.pid, id, !!this.o.revealOptOut, now);
    }
    if (this.autoPaused.size) for (const id of this.autoPaused) if (this.s.member(id).unanswered === 0 && A.unansweredInterruptions(this.ledger, id, now, this.cfg, this.convOf(id).lastInboundAt) < 2) this.autoPaused.delete(id);
  }

  /** D6: one re-engagement for auto-paused members after >= 30 days of silence, high-value item only. */
  private reengage(now: number) {
    for (const id of this.autoPaused) {
      const m = this.s.member(id);
      const q = this.hold.get(id) ?? [];
      if (m.optedOut || !q.length || this.busy(id)) continue;
      const v = this.view(id, now);
      if (!v) continue;
      const c = this.convOf(id);
      const r = A.reengagement({ member: v, autoPaused: true, optedOut: m.optedOut, conversation: c, joinedAt: this.snapMembers?.byId.get(id)?.joinedAt ?? 0,
        items: q, valueHistory: this.digestValues.get(id) ?? [], now, cfg: this.cfg });
      if (!r.send || !r.item) continue;
      const w = this.world(now);
      const t = this.itemText(w, r.item, now);
      if (!t) continue;
      c.reengagedAt = now;
      this.sendItems(id, v, [r.item], [r.value ?? 0], "reengage", new Map([[r.item.id, t]]), now);
    }
  }

  /** Outside-world items: this week's public events (sim snapshot listings) for members who stated a matching interest. */
  private refreshEvents(now: number) {
    const snap = this.s.ctx.snapshot();
    const evs = publicEvents(snap, 6).filter(e => e.start > now + 24 * HOUR && e.start < now + 8 * DAY);
    for (const e of evs) this.events.set(e.id, e);
    const interests = new Map<MemberId, Set<string>>();
    for (const f of snap.facets) if (f.kind === "interest") { if (!interests.has(f.memberId)) interests.set(f.memberId, new Set()); for (const t of f.tags) interests.get(f.memberId)!.add(t); }
    for (const mem of snap.members) {
      if (this.s.member(mem.id).optedOut) continue;
      for (const e of evs) {
        if (e.city !== mem.homeCity || !e.tags.some(t => interests.get(mem.id)?.has(t))) continue;
        const it: AttentionItem = {
          id: `ev:${e.id}:${mem.id}`, memberId: mem.id, kind: "event_suggestion", category: "events", others: [], involvesMember: false, effort: "glance",
          enjoy: 0.5, accept: this.cfg.acceptancePrior, urgency: { expiresAt: e.start - this.cfg.expiry.eventLeadHours * HOUR, bestBy: e.start },
          createdAt: now, reviewState: "not_needed", key: `ev:${e.id}`,
        };
        if (this.addHeld(it, now)) this.stats.eventItems++;
      }
    }
  }

  private dropMember(id: MemberId, reason: string) {
    for (const it of this.hold.get(id) ?? []) this.onDropped(it, reason);
    this.hold.set(id, []);
    this.pending.delete(id); this.reveals.delete(id);
    for (const fl of this.flows.values()) if (fl.stage === "probing" && id in fl.f.answers && fl.f.answers[id] !== "no") this.answer(fl.p.id, id, false, reason);
  }

  // ------------------------------------------------------------------ engine view
  /**
   * What the Network reports to the engine (P1/P2 of the v1.2 results, extended): proposals no
   * member engaged with are UNSENT (not billed, pair not blocked); live flows are open
   * opportunities; probe "no" answers are declines.
   */
  engineView(input: EngineInput): EngineInput {
    if (this.o.mode !== "attention") return input;
    const now = input.now;
    const billed = (id: string) => this.engaged.has(id) || (this.o.bill !== "picked" && this.shownPids.has(id));
    const unsent = new Set([...this.proposals.keys()].filter(id => !billed(id)));
    const live = new Map([...this.flows].filter(([, f]) => f.stage === "probing" || f.stage === "revealing"));
    const interactions = (input.interactions ?? []).filter(r => !unsent.has(r.id)).map(r => {
      const fl = this.flows.get(r.id);
      // Shown and passed on ("none" or another pick): not a decline of anyone, no cooldown (1.4).
      // The pair stays blocked for a while (pending since it was shown), so the engine proposes someone
      // else instead of re-proposing a pair the member just passed on.
      if (!fl || (fl.stage === "closed" && !this.engaged.has(r.id))) return this.shownPids.has(r.id) && !this.engaged.has(r.id) ? { ...r, outcome: (this.o.passedAs ?? "pending") as "pending", at: this.shownAt.get(r.id) ?? r.at, declinedBy: undefined, noResponse: undefined } : r;
      if (live.has(r.id)) return { ...r, outcome: "pending" as const, at: now };
      const no = Object.keys(fl.f.answers).filter(x => fl.f.answers[x] === "no");
      if (fl.stage === "closed" && no.length && r.outcome !== "declined") return { ...r, outcome: "declined" as const, declinedBy: [...new Set([...(r.declinedBy ?? []), ...no])] };
      return r;
    });
    // Held items block their pair (the engine proposes the next-best partner instead of the same one
    // again) without being billed: a pending interaction with nobody invited yet.
    if (this.o.blockHeldPairs !== false) for (const q of this.hold.values()) for (const it of q) {
      const p = this.proposals.get(it.sourceProposalId!);
      if (p && it.stage !== "partner") interactions.push({ id: `held:${p.id}`, kind: p.kind, category: p.category, participants: [...p.participants], at: now, outcome: "pending" });
    }
    const openOpportunities = (input.openOpportunities ?? []).filter(o => !unsent.has(o.id) && !live.has(o.id));
    for (const [id, fl] of live) openOpportunities.push({ id, participants: [...fl.p.participants], stage: "inviting", until: now + 3 * DAY });
    return { ...input, interactions, openOpportunities, unsentProposalIds: [...new Set([...(input.unsentProposalIds ?? []), ...unsent])] };
  }
}

function canRevealOrSchedule(fl: Flow): boolean { return A.canReveal(fl.f); }
