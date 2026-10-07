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

interface MemberRec {
  joinedAt: number; eligible: boolean; vouchedBy?: MemberId;
  activated: boolean; valueInWindow: boolean; safetyFlagged: boolean;
  vouchCreditId?: string; stakeTaken: boolean;
}
interface PlanRec { accepted: boolean; startsAt: number; confirmed: boolean; resolved: boolean; attendedEntry?: LedgerEntry; feedback: boolean }
interface HelpRec { helper: MemberId; recipient: MemberId; resolved: boolean }

type Prov = LedgerEntry["provenance"];

export interface StaffRead { t: number; staff: string; role: string; reason: string; member: MemberId }

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
  private lastT = -Infinity;

  constructor(cfg: CapitalConfigInput = {}) { this.cfg = resolveCapital(cfg); }

  // ---------------------------------------------------------------------------------------------- reads

  /** Entries for one member. Only the member themself, or an audited staff role, may read them. */
  entriesFor(viewer: Viewer, member: MemberId): readonly LedgerEntry[] {
    if ("member" in viewer) {
      if (viewer.member !== member) throw new Error("NC entries are private to the member");
    } else {
      if (!viewer.reason) throw new Error("staff reads need a reason");
      this.staffReads.push({ t: this.lastT, staff: viewer.staff, role: viewer.role, reason: viewer.reason, member });
    }
    return this.byMember.get(member) ?? [];
  }

  /** Internal read for the Network's own levers and detection (never exposed to other members). */
  internalEntries(member: MemberId): readonly LedgerEntry[] { return this.byMember.get(member) ?? []; }

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

  // ---------------------------------------------------------------------------------------------- writes

  /** Record one Network event. Returns the entries it wrote (often none). */
  record(ev: CapitalEvent): LedgerEntry[] {
    if (this.seen.has(ev.id)) return [];
    if (ev.t < this.lastT) throw new Error(`events must be recorded in time order (${ev.id})`);
    this.seen.add(ev.id);
    this.lastT = ev.t;
    const out: LedgerEntry[] = [];
    const c = this.cfg;
    switch (ev.type) {
      case "member_joined": {
        if (this.members.has(ev.member)) break;
        this.members.set(ev.member, {
          joinedAt: ev.t, eligible: !isMinor(ev.age), vouchedBy: ev.vouchedBy,
          activated: false, valueInWindow: false, safetyFlagged: false, stakeTaken: false,
        });
        break;
      }
      case "member_activated": {
        const m = this.members.get(ev.member);
        if (!m) break;
        m.activated = true;
        this.tryVouchCredit(ev, ev.member, [], out);
        break;
      }
      case "value_received": {
        const m = this.members.get(ev.member);
        if (!m || !m.vouchedBy) break;
        if (ev.t - m.joinedAt > c.vouch.valueWindowDays * DAY) break;
        // Value only counts toward the vouch when someone other than the voucher provided it
        // (or the agent / outside world did): a voucher cannot manufacture their invitee's value.
        // Nor can the voucher's close circle: providers tied to the voucher by member-controlled
        // credits (help, needs, member-started plans) inside the pair window do not count.
        const ties = this.tiesOf(m.vouchedBy, ev.t);
        const others = ev.with.filter(w => w !== m.vouchedBy && w !== ev.member && !ties.has(w));
        if (ev.with.length && !others.length) break;
        m.valueInWindow = true;
        this.tryVouchCredit(ev, ev.member, others, out);
        break;
      }
      case "safety_flag": {
        const m = this.members.get(ev.member);
        if (m) m.safetyFlagged = true;
        break;
      }
      case "member_removed": {
        const m = this.members.get(ev.member);
        if (!m || ev.reason !== "serious_abuse" || !m.vouchedBy || m.stakeTaken) break;
        if (ev.t - m.joinedAt > c.vouch.stakeWindowDays * DAY) break;
        m.stakeTaken = true;
        const v = m.vouchedBy;
        if (!this.isEligible(v)) break;
        if (m.vouchCreditId) this.reverse(v, m.vouchCreditId, ev, "vouch credit reversed: invitee removed", out);
        this.penalize(v, "vouch_stake", c.penalty.vouchStake, ev, [ev.member], "vouch stake: invitee removed for serious abuse", out);
        break;
      }
      case "abuse_confirmed": {
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
        const counterparts = uniq(ev.counterparts.filter(x => x !== ev.member && this.members.has(x)));
        const confirmedBy = uniq((ev.confirmers ?? (ev.verifiedBy.includes("counterpart") ? counterparts : [])).filter(x => x !== ev.member));
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
        // Feedback inherits the attendance's anti-gaming multiplier, so repeat staged plans can't farm it.
        this.credit(ev.member, "attendance", c.credit.feedback * p.attendedEntry.multiplier, ev, [], [], "gave feedback", out, { planId: ev.planId });
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
        if (!ev.useful) break;
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
        if (by[0] === ev.member) break;
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
            if (involved) this.reverse(m, e.id, ev, "clawback: credit found to be fraudulent", out);
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

  private tryVouchCredit(ev: CapitalEvent, invitee: MemberId, confirmedBy: MemberId[], out: LedgerEntry[]) {
    const m = this.members.get(invitee)!;
    if (!m.vouchedBy || m.vouchCreditId || m.stakeTaken) return;
    if (!m.activated || !m.valueInWindow || m.safetyFlagged) return;
    if (ev.t - m.joinedAt > this.cfg.vouch.valueWindowDays * DAY) return;
    const e = this.credit(m.vouchedBy, "vouch", this.cfg.credit.vouch, ev, [invitee], confirmedBy, "vouch: invitee active and got value", out);
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
    if (!this.isEligible(member) || base <= 0) return undefined;
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
