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
import { StubNetwork, type StubOptions } from "../../sim/src/stubNetwork.ts";
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
}

interface Flow { p: EngineProposal; f: A.ProbeFlow; stage: "probing" | "revealing" | "scheduled" | "closed"; reveal: Map<MemberId, "sent" | "yes" | "no">; revealDeadline?: number }
interface Pending { messageId: string; memberId: MemberId; at: number; kind: "digest" | "break_in" | "reengage"; items: AttentionItem[]; picked: AttentionItem }

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
    funnel: { firstYes: 0, partnerCreated: 0, partnerShown: 0, partnerYes: 0, groupYes: 0, revealSent: 0, revealYes: 0, scheduled: 0, partnerDropped: {} as Record<string, number> },
  };
  private autoPaused = new Set<MemberId>();

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
    for (const it of A.itemsForProposal(ep, { now, calibrate: this.o.calibrate, cfg: this.cfg, reviewState: "approved" })) this.addHeld(it, now);
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
  private onDropped(it: HeldItem | AttentionItem, reason: string) {
    this.bump(this.stats.dropped, reason.split(":")[0]!);
    if (it.stage === "partner") this.bump(this.stats.funnel.partnerDropped, reason.split(":")[0]!);
    // A partner item that can no longer be sent ends the opportunity.
    if (it.stage === "partner" && it.sourceProposalId) this.answer(it.sourceProposalId, it.memberId, false, "partner_item_dropped");
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
    return {
      memberId: id, state, age: mem.age, tz: mem.homeCity === "sf" ? "America/Los_Angeles" : "America/New_York", quietHours,
      onlyWhenAsked: st.unanswered >= 2 || A.unansweredInterruptions(this.ledger, id, now, this.cfg) >= 2,
      newcomer: now - (mem.joinedAt ?? 0) < this.cfg.newcomer.days * DAY,
      prefs: A.defaultCadence(mem.state, this.cfg), categoriesOptIn: mem.prefs.categoriesOptIn,
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
      const slot = A.digestDue(v, now, this.served.get(id), this.cfg, this.o.slotWindowHours ?? 6 * 24);
      if (slot !== undefined) { this.attempt(id, v, now, "digest", slot); continue; }
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
    if (slot !== undefined) this.served.set(id, slot);
    this.sendItems(id, v, res.items, res.values, mode, texts, now);
  }

  /** Member-facing line for one item: an anonymous probe (D5) or, without probes, the stub's named invite. */
  private itemText(w: World, it: AttentionItem, now: number): string | null {
    const p = this.proposals.get(it.sourceProposalId!);
    if (!p) return null;
    if (this.o.probes) {
      const pr = A.buildProbe(w, { proposalId: p.id, kind: p.kind, category: p.category, objective: p.objective, window: p.window, tz: p.city === "sf" ? "America/Los_Angeles" : "America/New_York", role: p.roles?.[it.memberId] },
        it.memberId, it.others, now);
      return pr?.text ?? null;
    }
    const others = it.others.map(id => this.s.member(id));
    const why = p.explanations[it.memberId] ?? "it seemed like a good fit";
    return others.length === 1 ? `Meet ${others[0].display}: ${why}` : `A small ${p.objective} with ${others.length} others (${why}).`;
  }

  private sendItems(id: MemberId, v: A.MemberAttention, items: AttentionItem[], values: number[], kind: "digest" | "break_in" | "reengage", texts: Map<string, string>, now: number) {
    const m = this.s.member(id);
    const pickedId = items.length > 1 && this.o.choose ? this.o.choose(id, items, this.proposals, now) : items[0]!.id;
    const picked = items.find(x => x.id === pickedId) ?? items[0]!;
    const p = this.proposals.get(picked.sourceProposalId!)!;
    let body = A.digestText(items.map(it => texts.get(it.id) ?? ""));
    if (kind === "reengage") body = `${body} ${A.REENGAGE_SUFFIX}`;
    const note = this.notes.get(id);
    if (note) { body = `${note}\n\n${body}`; this.notes.delete(id); }
    const attention = { kind, items: items.map(x => x.sourceProposalId), picked: picked.sourceProposalId };
    const meta: SimMeta = this.o.probes
      ? { type: "probe", proactive: true, probe: { key: p.id, category: p.category, participants: [...p.participants], kind: p.kind, window: p.window }, attention }
      : { type: "proposal", proposalId: p.id, participants: p.participants, proactive: true, attention };
    if (A.inMemberQuietHours(v, now, this.cfg)) this.stats.selfQuiet++;
    const cap = A.capFor({ ...v, onlyWhenAsked: false }, this.cfg);
    if (A.interruptionsUsed(this.ledger, id, now, cap.periodDays) >= cap.limit && kind !== "reengage") this.stats.selfOverCap++;
    const msg = this.s.send(m, body, meta);
    m.awaiting = { kind: "digest", pid: p.id };
    m.proactive.push(now);
    this.ledger.push({ messageId: msg.id, memberId: id, at: now, kind, itemIds: items.map(x => x.id), countsAgainstCap: true });
    this.pending.set(id, { messageId: msg.id, memberId: id, at: now, kind, items, picked });
    const sent = new Set(items.map(x => x.id));
    this.hold.set(id, (this.hold.get(id) ?? []).filter(x => !sent.has(x.id)));
    if (kind === "digest") this.stats.digests++; else if (kind === "break_in") this.stats.breakIns++; else this.stats.reengaged++;
    if (kind === "digest") this.digestValues.set(id, [...(this.digestValues.get(id) ?? []), ...values]);
    this.stats.itemsShown += items.length;
    this.stats.shownTo.set(id, (this.stats.shownTo.get(id) ?? 0) + items.length);
    for (const it of items) this.stats.shown.push({ pid: it.sourceProposalId!, memberId: id, at: now });
    for (const it of items) if (it.stage === "partner") this.stats.funnel.partnerShown++;
    for (const it of items) this.shownPids.add(it.sourceProposalId!);
  }

  // ------------------------------------------------------------------ replies
  override async onInbound(msg: InboundMessage) {
    if (this.o.mode !== "attention") return super.onInbound(msg);
    const now = this.now();
    const c = this.convOf(msg.memberId);
    c.outboundSinceInbound = 0; c.lastInboundAt = now;
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
    for (const it of pend.items) {
      if (pick && it === pend.picked) continue;
      // Seen and passed on: not offered again for 30 days; "none" is not a decline of any person.
      dis.set(it.key, now + this.cfg.hold.dismissDays * DAY);
      if (it.stage === "partner" || (it.others.length > 1)) this.answer(it.sourceProposalId!, id, false, "not_picked");
    }
    this.dismissed.set(id, dis);
    const m = this.s.member(id);
    if (!pick) { this.stats.nones++; this.s.send(m, "No problem at all, thanks for letting me know.", { type: "info" }); return; }
    this.stats.picks++;
    this.answer(pend.picked.sourceProposalId!, id, true, "picked");
  }

  /** Record a member's yes/no on an opportunity and move its flow on. */
  private answer(pid: string, id: MemberId, yes: boolean, why: string) {
    const p = this.proposals.get(pid);
    if (!p) return;
    const now = this.now();
    let fl = this.flows.get(pid);
    if (!fl) { fl = { p, f: A.startProbeFlow(p), stage: "probing", reveal: new Map() }; this.flows.set(pid, fl); }
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
    fl.stage = "revealing";
    fl.revealDeadline = now + 48 * HOUR;
    for (const id of yes) {
      const m = this.s.member(id);
      const r = A.revealFor(fl.f, id, x => this.s.member(x).display);
      if (!r) continue;
      if (!A.canSendLogistics(this.convOf(id), this.cfg)) { fl.reveal.set(id, "no"); continue; }
      const why = fl.p.explanations[id] ?? "";
      this.s.send(m, `Good news: ${r.names.join(", ")} ${r.names.length > 1 ? "are" : "is"} up for it too. ${why} Want me to set it up?`.replace(/\s+/g, " ").trim(),
        { type: "proposal", proposalId: fl.p.id, participants: fl.p.participants, proactive: false });
      this.ledger.push({ messageId: `reveal:${fl.p.id}:${id}`, memberId: id, at: now, kind: "logistics", itemIds: [], countsAgainstCap: false });
      fl.reveal.set(id, "sent");
      this.stats.funnel.revealSent++;
      m.awaiting = { kind: "reveal", pid: fl.p.id };
      this.reveals.set(id, { pid: fl.p.id, at: now });
    }
    this.checkReveal(fl, now);
  }
  private onReveal(pid: string, id: MemberId, yes: boolean, now: number) {
    const fl = this.flows.get(pid);
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
  private scheduleFlow(fl: Flow, going: MemberId[], now: number) {
    fl.stage = "scheduled";
    this.stats.funnel.scheduled++;
    this.engaged.add(fl.p.id);
    for (const [mid, q] of this.hold) this.hold.set(mid, q.filter(x => x.sourceProposalId !== fl.p.id));
    const opp = {
      p: fl.p, invites: new Map(fl.p.participants.map(x => [x, { status: going.includes(x) ? "yes" : "dropped", sentAt: now }])), stage: "inviting",
      quorum: fl.f.group ? fl.f.quorum : 2, deadline: now + 48 * HOUR,
    };
    this.s.opps.set(fl.p.id, opp);
    this.s.schedule(opp, now);
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
      for (const it of pend.items) if (it.stage === "partner" || it.others.length > 1 || it === pend.picked) this.answer(it.sourceProposalId!, id, false, "unanswered");
      if (!this.autoPaused.has(id) && (m.unanswered >= 2 || A.unansweredInterruptions(this.ledger, id, now, this.cfg) >= 2)) {
        this.autoPaused.add(id);
        this.stats.autoPauses.push({ memberId: id, at: now });
      }
    }
    for (const [id, r] of [...this.reveals]) {
      if (now - r.at < 48 * HOUR) continue;
      this.reveals.delete(id);
      const m = this.s.member(id);
      if (m.awaiting?.kind === "reveal") m.awaiting = undefined;
      this.onReveal(r.pid, id, false, now);
    }
    if (this.autoPaused.size) for (const id of this.autoPaused) if (this.s.member(id).unanswered === 0 && A.unansweredInterruptions(this.ledger, id, now, this.cfg) < 2) this.autoPaused.delete(id);
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
      if (!fl || (fl.stage === "closed" && !this.engaged.has(r.id))) return this.shownPids.has(r.id) && !this.engaged.has(r.id) ? { ...r, outcome: "cancelled" as const, declinedBy: undefined, noResponse: undefined } : r;
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
