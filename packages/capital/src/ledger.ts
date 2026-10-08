// The NC ledger (design 2.1-2.4, 2.7). Append-only, itemized, private.
//
// - `record(event)` turns one Network event into zero or more entries. It is idempotent by event
//   id and requires non-decreasing time. Entries are never edited or deleted: reversals
//   (clawback, a lost vouch credit) are new entries that reference the entry they reverse.
// - Members aged 13-17, and members whose age is unknown (fail closed, core policy.ts), get no
//   entries at all. Events about unknown members are ignored.
// - Declining, participation-state changes, inactivity, asking for help and sharing data never
//   write an entry.
// - Anti-gaming: every credit is multiplied by a per-counterpart-pair decay and a per-category,
//   per-period decay, then clipped by a per-period cap. Credits reduced to 0 are still written
//   (amount 0), so detection sees the behaviour.
import { DAY, HOUR } from "../../core/src/clock.ts";
import { isMinor } from "../../core/src/policy.ts";
import { resolveCapital, type CapitalConfig, type CapitalConfigInput } from "./config.ts";
import type { CapitalEvent, EarnCategory, EntryCategory, LedgerEntry, LoseCategory, MemberId, Viewer } from "./types.ts";
import { CapitalEventRejected, validateCapitalEvent } from "./validate.ts";
import type { CapitalStore } from "./store.ts";

interface MemberRec {
  joinedAt: number; eligible: boolean; vouchedBy?: MemberId;
  activated: boolean; valueInWindow: boolean; safetyFlagged: boolean;
  /** Providers who confirmed the invitee's first creditable value (vouch provenance). */
  valueProviders: MemberId[];
  vouchCreditId?: string; stakeTaken: boolean;
  /** Removed for any reason: earns nothing more. */
  removed: boolean;
  /** First confirmed abuse: the vouch stake window is measured to this time, not to the removal. */
  abuseAt?: number;
}
interface PlanRec { accepted: boolean; startsAt: number; confirmed: boolean; resolved: boolean; attendedEntry?: LedgerEntry; feedback: boolean }
interface HelpRec { helper: MemberId; recipient: MemberId; resolved: boolean }

type Prov = LedgerEntry["provenance"];

export interface StaffRead { t: number; staff: string; role: string; reason: string; member: MemberId }
/** An event `record` refused (malformed or out of time order). Kept so a caller that catches the error cannot hide it. */
export interface Rejection { id: string; t: unknown; reason: string }

export class CapitalLedger {
  readonly cfg: CapitalConfig;
  private readonly log: LedgerEntry[] = [];
  private readonly byMember = new Map<MemberId, LedgerEntry[]>();
  private readonly members = new Map<MemberId, MemberRec>();
  private readonly plans = new Map<string, PlanRec>();
  private readonly helps = new Map<string, HelpRec>();
  private readonly seen = new Set<string>();
  private readonly reversed = new Set<string>();
  private readonly staffReads: StaffRead[] = [];
  private readonly rejects: Rejection[] = [];
  private lastT = -Infinity;

  private store?: CapitalStore;

  /**
   * With a `store`, the ledger replays the stored events and staff reads first (capital-5), then
   * appends every event it accepts before applying it. A restart keeps balances, levers and audit.
   */
  constructor(cfg: CapitalConfigInput = {}, opts: { store?: CapitalStore } = {}) {
    this.cfg = resolveCapital(cfg);
    if (opts.store) {
      const { events, reads } = opts.store.load();
      for (const e of events) this.record(e);
      this.staffReads.push(...reads);
      this.store = opts.store;
    }
  }

  /** A ledger rebuilt from an event log (duplicates are skipped). Same events, same entries. */
  static replay(events: Iterable<CapitalEvent>, cfg: CapitalConfigInput = {}): CapitalLedger {
    const L = new CapitalLedger(cfg);
    for (const e of events) L.record(e);
    return L;
  }

  // ---------------------------------------------------------------------------------------------- reads

  /** Entries for one member. Only the member themself, or an audited staff role, may read them. */
  entriesFor(viewer: Viewer, member: MemberId): readonly LedgerEntry[] {
    if ("member" in viewer) {
      if (viewer.member !== member) throw new Error("NC entries are private to the member");
    } else {
      if (!viewer.reason) throw new Error("staff reads need a reason");
      const r: StaffRead = { t: this.lastT, staff: viewer.staff, role: viewer.role, reason: viewer.reason, member };
      this.store?.appendRead(r);
      this.staffReads.push(r);
    }
    return this.byMember.get(member) ?? [];
  }

  /**
   * Internal read for the Network's own levers (never exposed to other members). Empty for a member
   * who is not eligible now (a minor or an unknown age), so their levers sit at the floor.
   */
  internalEntries(member: MemberId): readonly LedgerEntry[] {
    const m = this.members.get(member);
    return m && !m.eligible ? [] : this.byMember.get(member) ?? [];
  }

  /** All entries, for detection and audit. */
  all(): readonly LedgerEntry[] { return this.log; }

  /** Audit trail of staff reads. */
  audit(): readonly StaffRead[] { return this.staffReads; }

  /** Sum of entry amounts up to and including `at`. Internal only: never shown to anyone. */
  balance(member: MemberId, at = Infinity): number {
    let s = 0;
    for (const e of this.byMember.get(member) ?? []) if (e.t <= at) s += e.amount;
    return s;
  }

  isEligible(member: MemberId): boolean { return this.members.get(member)?.eligible ?? false; }

  /** Events this ledger refused, in order. The service should log each one and a harness should fail on any. */
  rejected(): readonly Rejection[] { return this.rejects; }

  // ---------------------------------------------------------------------------------------------- writes

  /**
   * Record one Network event. Returns the entries it wrote (often none). A malformed or out-of-order
   * event throws `CapitalEventRejected` and changes nothing (it is listed in `rejected()`).
   */
  record(ev: CapitalEvent): LedgerEntry[] {
    const bad = validateCapitalEvent(ev);
    if (bad) this.reject(ev, bad);
    if (this.seen.has(ev.id)) return [];
    if (ev.t < this.lastT) this.reject(ev, `events must be recorded in time order (t ${ev.t} < ${this.lastT})`);
    this.store?.appendEvent(ev);
    this.seen.add(ev.id);
    this.lastT = ev.t;
    const out: LedgerEntry[] = [];
    const c = this.cfg;
    switch (ev.type) {
      case "member_joined": {
        if (this.members.has(ev.member)) break;
        this.members.set(ev.member, {
          // A member cannot vouch for themself (capital-17).
          joinedAt: ev.t, eligible: !isMinor(ev.age), vouchedBy: ev.vouchedBy === ev.member ? undefined : ev.vouchedBy,
          activated: false, valueInWindow: false, valueProviders: [], safetyFlagged: false, stakeTaken: false, removed: false,
        });
        break;
      }
      case "age_updated": {
        // Eligibility follows the current age (capital-4): a member found to be a minor stops
        // accruing now; a member who turns 18 starts accruing from now (nothing is back-filled).
        const m = this.members.get(ev.member);
        if (m) m.eligible = !isMinor(ev.age);
        break;
      }
      case "member_activated": {
        const m = this.members.get(ev.member);
        if (!m) break;
        m.activated = true;
        this.tryVouchCredit(ev, ev.member, out);
        break;
      }
      case "value_received": {
        const m = this.members.get(ev.member);
        if (!m || !m.vouchedBy) break;
        if (ev.t - m.joinedAt > c.vouch.valueWindowDays * DAY) break;
        if (m.valueInWindow) break;
        // Value only counts toward the vouch when an eligible adult member other than the voucher
        // provided it: a voucher cannot manufacture their invitee's value. Nor can the voucher's
        // close circle: providers tied to the voucher by member-controlled credits (help, needs,
        // member-started plans) inside the pair window do not count.
        const ties = this.tiesOf(m.vouchedBy, ev.t);
        const others = uniq(ev.with.filter(w => w !== m.vouchedBy && w !== ev.member && !ties.has(w) && this.isEligible(w)));
        // The invitee's own say-so is not proof (capital-1): a sybil can say "it was great" about
        // anything. A provider must confirm the interaction, or a check-in, organizer or reviewer
        // must verify it. Value from the agent alone (no provider) does not count.
        const confirmed = others.filter(w => (ev.confirmedBy ?? []).includes(w));
        const verified = (ev.verifiedBy ?? []).some(v => v !== "counterpart");
        if (!others.length || (!confirmed.length && !verified)) break;
        m.valueInWindow = true;
        m.valueProviders = confirmed;
        this.tryVouchCredit(ev, ev.member, out);
        break;
      }
      case "safety_flag": {
        const m = this.members.get(ev.member);
        if (m) m.safetyFlagged = true;
        break;
      }
      case "member_removed": {
        const m = this.members.get(ev.member);
        if (!m) break;
        m.removed = true;
        if (ev.reason !== "serious_abuse" || !m.vouchedBy || m.stakeTaken) break;
        // The window runs to the confirmed abuse, so a slow removal process does not save the stake.
        if (Math.min(m.abuseAt ?? ev.t, ev.t) - m.joinedAt > c.vouch.stakeWindowDays * DAY) break;
        m.stakeTaken = true;
        const v = m.vouchedBy;
        if (!this.isEligible(v)) break;
        if (m.vouchCreditId) this.reverse(v, m.vouchCreditId, ev, "vouch credit reversed: invitee removed", out);
        this.penalize(v, "vouch_stake", c.penalty.vouchStake, ev, [ev.member], "vouch stake: invitee removed for serious abuse", out);
        break;
      }
      case "abuse_confirmed": {
        const m = this.members.get(ev.member);
        if (m && m.abuseAt === undefined) m.abuseAt = ev.t;
        if (!this.isEligible(ev.member)) break;
        this.penalize(ev.member, "abuse", c.penalty.abuse, ev, [], `confirmed ${ev.kind}`, out);
        break;
      }
      case "plan_accepted": {
        const k = planKey(ev.member, ev.planId);
        if (!this.plans.has(k)) this.plans.set(k, { accepted: true, startsAt: ev.startsAt, confirmed: false, resolved: false, feedback: false });
        break;
      }
      case "plan_confirmed": {
        const p = this.plans.get(planKey(ev.member, ev.planId));
        if (p && !p.resolved) p.confirmed = true;
        break;
      }
      case "plan_cancelled": {
        const p = this.plans.get(planKey(ev.member, ev.planId));
        if (!p || p.resolved) break;
        p.resolved = true;
        // Free with notice. A very late cancellation after confirming is treated as a no-show (15.2).
        if (ev.t <= p.startsAt - c.flake.cancelCutoffHours * HOUR || !p.confirmed) break;
        this.noShow(ev.member, ev, "late cancellation after confirming", out);
        break;
      }
      case "plan_no_show": {
        const p = this.plans.get(planKey(ev.member, ev.planId));
        if (!p || p.resolved) break;
        p.resolved = true;
        if (!p.confirmed) break; // only a no-show after confirming costs NC
        this.noShow(ev.member, ev, "no-show after confirming", out);
        break;
      }
      case "plan_ghosted": {
        const p = this.plans.get(planKey(ev.member, ev.planId));
        if (!p || p.resolved || !p.accepted) break;
        p.resolved = true;
        if (!this.isEligible(ev.member)) break;
        this.penalize(ev.member, "ghosting", c.penalty.ghosting, ev, [], "stopped responding after accepting", out);
        break;
      }
      case "plan_attended": {
        const p = this.plans.get(planKey(ev.member, ev.planId));
        if (!p || !p.accepted || p.resolved) break;
        p.resolved = true;
        if (!ev.verifiedBy.length) break;
        // Only eligible adult members count as counterparts or confirmers (capital-9).
        const counterparts = uniq(ev.counterparts.filter(x => x !== ev.member && this.isEligible(x)));
        const confirmedBy = uniq((ev.confirmers ?? (ev.verifiedBy.includes("counterpart") ? counterparts : [])).filter(x => x !== ev.member && this.isEligible(x)));
        // Verified only by counterparts, and none of them counts: nobody verified it.
        if (ev.verifiedBy.every(v => v === "counterpart") && !confirmedBy.length) break;
        const e = this.credit(ev.member, "attendance", c.credit.attendance, ev, counterparts, confirmedBy, "attended",
          out, { planId: ev.planId, origin: ev.origin, verification: [...ev.verifiedBy] });
        if (e) p.attendedEntry = e;
        break;
      }
      case "feedback_given": {
        const p = this.plans.get(planKey(ev.member, ev.planId));
        if (!p || !p.attendedEntry || p.feedback) break;
        p.feedback = true;
        // No counterparts: feedback must not speed up the pair decay for the next real meeting.
        // Its own category (capital-7): as "attendance" it sped up the attendance decay, so giving
        // feedback lowered total NC. Feedback inherits the attendance's anti-gaming multiplier, so
        // repeat staged plans can't farm it, and it is reversed with the attendance (`basis`).
        this.credit(ev.member, "feedback", c.credit.feedback * p.attendedEntry.multiplier, ev, [], [], "gave feedback", out, { planId: ev.planId, basis: p.attendedEntry.id });
        break;
      }
      case "help_given": {
        if (ev.helper === ev.recipient || this.helps.has(ev.helpId)) break;
        this.helps.set(ev.helpId, { helper: ev.helper, recipient: ev.recipient, resolved: false });
        break;
      }
      case "help_confirmed": {
        const h = this.helps.get(ev.helpId);
        if (!h || h.resolved || h.recipient !== ev.recipient) break;
        h.resolved = true;
        if (!ev.useful || !this.isEligible(h.recipient)) break;
        this.credit(h.helper, "help", c.credit.help, ev, [h.recipient], [h.recipient], "help confirmed useful by the recipient", out);
        break;
      }
      case "organized": {
        if (!ev.publicVenue) break; // organizing credit is for public venues only (MVP)
        const attendees = uniq(ev.attendees.filter(a => a !== ev.organizer && this.isEligible(a)));
        if (attendees.length < c.organizing.minAttendees) break;
        this.credit(ev.organizer, "organizing", c.credit.organizing, ev, attendees, [],
          ev.recurring ? "led a recurring crew session" : "organized a plan", out, { planId: ev.planId, label: ev.label });
        break;
      }
      case "need_answered": {
        const by = ev.confirmedBy === "staff" ? [] : [ev.confirmedBy];
        if (by[0] === ev.member || (by.length && !this.isEligible(by[0]!))) break;
        this.credit(ev.member, "needs_answered", c.credit.needs_answered, ev, by, by, "answered a Network need", out, { label: ev.label });
        break;
      }
      case "review_completed": {
        this.credit(ev.member, "review", c.credit.review * Math.max(0, Math.min(ev.items, 5)), ev, [], [], "reviewing and stewarding", out);
        break;
      }
      case "fraud_confirmed": {
        const set = new Set(ev.members);
        for (const m of set) {
          if (!this.isEligible(m)) continue;
          for (const e of [...(this.byMember.get(m) ?? [])]) {
            if (e.sign !== 1 || e.amount <= 0 || this.reversed.has(e.id)) continue;
            const involved = [...e.provenance.counterparts, ...e.provenance.confirmedBy].some(x => set.has(x));
            // A credit that exists only because of a reversed credit (feedback on a staged plan) goes too.
            const dependent = e.provenance.basis !== undefined && this.reversed.has(e.provenance.basis);
            if (involved || dependent) this.reverse(m, e.id, ev, "clawback: credit found to be fraudulent", out);
          }
          // One fraud penalty per member per period: several review cases about the same ring only claw back.
          const recentFraud = (this.byMember.get(m) ?? []).some(e => e.category === "fraud" && ev.t - e.t < c.antiGaming.periodDays * DAY);
          if (!recentFraud) this.penalize(m, "fraud", c.penalty.fraud, ev, [...set].filter(x => x !== m), "gaming confirmed by review", out);
        }
        break;
      }
      // Never earned or lost (design 2.4).
      case "declined": case "state_changed": case "data_shared": case "help_asked":
        break;
    }
    return out;
  }

  private reject(ev: unknown, reason: string): never {
    const e = (typeof ev === "object" && ev !== null ? ev : {}) as { id?: unknown; t?: unknown };
    const id = typeof e.id === "string" ? e.id : String(e.id);
    this.rejects.push({ id, t: e.t, reason });
    throw new CapitalEventRejected(id, reason);
  }

  // ---------------------------------------------------------------------------------------------- rules

  /** Members tied to `member` by member-controlled credits (either direction) inside the pair window. */
  private tiesOf(member: MemberId, t: number): Set<MemberId> {
    const ties = new Set<MemberId>();
    const from = t - this.cfg.antiGaming.pairWindowDays * DAY;
    for (let i = this.log.length - 1; i >= 0; i--) {
      const e = this.log[i]!;
      if (e.t < from) break;
      if (e.sign !== 1 || !memberControlled(e)) continue;
      if (e.member === member) for (const x of [...e.provenance.counterparts, ...e.provenance.confirmedBy]) ties.add(x);
      else if (e.provenance.confirmedBy.includes(member) || e.provenance.counterparts.includes(member)) ties.add(e.member);
    }
    ties.delete(member);
    return ties;
  }

  private tryVouchCredit(ev: CapitalEvent, invitee: MemberId, out: LedgerEntry[]) {
    const m = this.members.get(invitee)!;
    if (!m.vouchedBy || m.vouchCreditId || m.stakeTaken) return;
    // Recruiting a minor, or someone whose age is unknown, earns nothing (capital-9).
    if (!m.eligible || !m.activated || !m.valueInWindow || m.safetyFlagged || m.removed) return;
    if (ev.t - m.joinedAt > this.cfg.vouch.valueWindowDays * DAY) return;
    const e = this.credit(m.vouchedBy, "vouch", this.cfg.credit.vouch, ev, [invitee], m.valueProviders, "vouch: invitee active and got value", out);
    if (e) m.vouchCreditId = e.id;
  }

  private noShow(member: MemberId, ev: CapitalEvent, outcome: string, out: LedgerEntry[]) {
    if (!this.isEligible(member)) return;
    const f = this.cfg.flake;
    const forgivenRecently = (this.byMember.get(member) ?? []).filter(e => e.category === "no_show" && e.provenance.forgiven && ev.t - e.t < f.forgivenessWindowDays * DAY).length;
    if (forgivenRecently < f.forgivenNoShows) {
      this.write(member, "no_show", -1, 0, 0, 1, ev, { counterparts: [], confirmedBy: [], outcome: `${outcome} (forgiven)`, forgiven: true }, out);
      return;
    }
    this.penalize(member, "no_show", this.cfg.penalty.noShow, ev, [], outcome, out);
  }

  /** Earn entry with anti-gaming multipliers. Returns undefined for excluded members. */
  private credit(member: MemberId, cat: EarnCategory, base: number, ev: CapitalEvent, counterparts: MemberId[], confirmedBy: MemberId[],
    outcome: string, out: LedgerEntry[], extra: Partial<Prov> = {}): LedgerEntry | undefined {
    if (!this.isEligible(member) || this.members.get(member)!.removed || base <= 0) return undefined;
    const ag = this.cfg.antiGaming;
    const prior = this.byMember.get(member) ?? [];
    const earned = prior.filter(e => e.sign === 1);
    // Per counterpart pair.
    let pairMult = 1;
    if (counterparts.length) {
      // Credits the pair chose themselves (help, needs, member-started plans) decay over a longer window.
      const controlled = cat === "help" || cat === "needs_answered" || (cat === "attendance" && extra.origin === "member");
      const window = (controlled ? ag.controlledPairWindowDays : ag.pairWindowDays) * DAY;
      const inPair = earned.filter(e => ev.t - e.t < window && e.base > 0);
      pairMult = counterparts.reduce((s, cp) => s + ag.pairDecay ** inPair.filter(e => e.provenance.counterparts.includes(cp)).length, 0) / counterparts.length;
    }
    // Per category and period.
    const nCat = earned.filter(e => e.category === cat && ev.t - e.t < ag.periodDays * DAY && e.base > 0).length;
    const catMult = 1 / (1 + nCat / ag.categorySoftN[cat]);
    // Per period cap on positive NC (net of clawbacks of credits inside the period).
    const inPeriod = prior.filter(e => ev.t - e.t < ag.periodDays * DAY && (e.sign === 1 || e.category === "clawback")).reduce((s, e) => s + e.amount, 0);
    const room = Math.max(0, ag.periodCap - inPeriod);
    const amount = round(Math.min(base * pairMult * catMult, room));
    return this.write(member, cat, 1, amount, base, base > 0 ? amount / base : 0, ev, { counterparts, confirmedBy, outcome, ...extra }, out);
  }

  private penalize(member: MemberId, cat: LoseCategory, size: number, ev: CapitalEvent, counterparts: MemberId[], outcome: string, out: LedgerEntry[]) {
    return this.write(member, cat, -1, -size, size, 1, ev, { counterparts, confirmedBy: [], outcome }, out);
  }

  private reverse(member: MemberId, entryId: string, ev: CapitalEvent, outcome: string, out: LedgerEntry[]) {
    const orig = (this.byMember.get(member) ?? []).find(e => e.id === entryId);
    if (!orig || this.reversed.has(entryId)) return;
    this.reversed.add(entryId);
    this.write(member, "clawback", -1, -orig.amount, orig.amount, 1, ev,
      { counterparts: orig.provenance.counterparts, confirmedBy: [], outcome, reverses: entryId, label: orig.provenance.label }, out);
  }

  private write(member: MemberId, category: EntryCategory, sign: 1 | -1, amount: number, base: number, multiplier: number, ev: CapitalEvent,
    p: Omit<Prov, "eventId" | "eventType">, out: LedgerEntry[]): LedgerEntry {
    const list = this.byMember.get(member) ?? [];
    const e: LedgerEntry = Object.freeze({
      id: `${ev.id}:${member}:${out.length}`, member, t: ev.t, category, sign, amount: amount === 0 ? 0 : amount, base, multiplier,
      provenance: Object.freeze({ eventId: ev.id, eventType: ev.type, ...p }),
    }) as LedgerEntry;
    list.push(e);
    this.byMember.set(member, list);
    this.log.push(e);
    out.push(e);
    return e;
  }

  /** Ids of entries that have been reversed (clawed back). */
  isReversed(entryId: string): boolean { return this.reversed.has(entryId); }
}

/**
 * Credits whose occurrence the members themselves chose: help, needs answered, and member-started
 * plans. Engine- and organizer-made matches are not chosen by the pair, so they cannot be staged.
 */
export const memberControlled = (e: LedgerEntry) =>
  e.category === "help" || e.category === "needs_answered" || (e.category === "attendance" && e.provenance.origin === "member");

const planKey = (m: MemberId, p: string) => `${m}|${p}`;
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const round = (x: number) => Math.round(x * 1000) / 1000;
