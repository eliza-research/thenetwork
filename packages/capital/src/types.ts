// Network capital (NC) ledger types. Design: docs/design/2026-10-07-growth-capital-ownership.md
// section 2; PRD Section 39.2. NC is an internal, private, itemized ledger. It is never shown to
// other members and never read by anyone else's matching or ranking.
import type { MemberId } from "../../core/src/types.ts";

export type { MemberId };

/** Ledger categories (design 2.4). Penalty categories are separate so the view can tell them apart. */
export type EarnCategory = "vouch" | "attendance" | "feedback" | "help" | "organizing" | "needs_answered" | "review";
export type LoseCategory = "vouch_stake" | "no_show" | "ghosting" | "abuse" | "clawback" | "fraud";
export type EntryCategory = EarnCategory | LoseCategory;

/** How an attendance or outcome was verified. Only `counterpart` creates a member-to-member confirmation edge. */
export type Verification = "counterpart" | "checkin" | "organizer" | "reviewer";

/** Who started the plan. Member-started plans with counterpart-only verification are the staged-meetup surface. */
export type PlanOrigin = "engine" | "member" | "organizer";

export type PlanKind = "intro" | "group" | "plan" | "event" | "crew";

// ------------------------------------------------------------------------------------------------
// Input events. The Network emits these from records it already keeps (design 2.7, "built from
// events the MVP already records"). Every event has a unique id (idempotent) and a time `t` (ms,
// from the Network's Clock). Events must be recorded in non-decreasing time order. `record` checks
// every event (`validateCapitalEvent`) before it changes anything and rejects a bad one with a
// `CapitalEventRejected` error.

interface Base { id: string; t: number }

export type CapitalEvent =
  /** A member joined. `age` drives the minors exclusion (13-17 and unknown ages are excluded, fail closed). */
  | Base & { type: "member_joined"; member: MemberId; age: number | null; vouchedBy?: MemberId }
  /** First real engagement after joining (completed onboarding and replied / accepted something). */
  | Base & { type: "member_activated"; member: MemberId }
  /**
   * A value event (V14 sense: met + worthwhile, useful help received, acted-on recommendation). `with` = the other members who provided it (empty = the agent or the outside world).
   * The member's own say-so is not proof for a vouch credit: `confirmedBy` lists the providers in `with` who confirmed the interaction
   * themselves (their own check-in or feedback), and `verifiedBy` how else it was verified (check-in, organizer, reviewer).
   */
  | Base & { type: "value_received"; member: MemberId; with: MemberId[]; confirmedBy?: MemberId[]; verifiedBy?: Verification[] }
  /** The member's age changed (birthday, or a correction). Drives eligibility from now on: a minor or unknown age stops accrual. */
  | Base & { type: "age_updated"; member: MemberId; age: number | null }
  /** A safety flag on a member. `serious` = spam, harassment, scam or a serious policy violation under review or confirmed. */
  | Base & { type: "safety_flag"; member: MemberId; serious: boolean }
  /** Removal of a member. Only `serious_abuse` (confirmed) costs the voucher's stake. */
  | Base & { type: "member_removed"; member: MemberId; reason: "serious_abuse" | "left" | "other" }
  /** Confirmed spam, harassment, scam or policy violation by the member themself (alongside safety action). */
  | Base & { type: "abuse_confirmed"; member: MemberId; kind: "spam" | "harassment" | "scam" | "policy" }
  /** The member said yes to an intro, group, plan or event. */
  | Base & { type: "plan_accepted"; member: MemberId; planId: string; kind: PlanKind; startsAt: number }
  /** The member confirmed (day-before / morning-of check). A no-show only costs NC after this. */
  | Base & { type: "plan_confirmed"; member: MemberId; planId: string }
  /** The member cancelled. Free when at least `cancelCutoffHours` before `startsAt`. */
  | Base & { type: "plan_cancelled"; member: MemberId; planId: string }
  /** The member attended. `counterparts` = other attendees; `verifiedBy` lists how attendance was verified. */
  | Base & { type: "plan_attended"; member: MemberId; planId: string; counterparts: MemberId[]; verifiedBy: Verification[]; origin: PlanOrigin; publicVenue: boolean; confirmers?: MemberId[] }
  /** The member did not show up (and did not cancel). */
  | Base & { type: "plan_no_show"; member: MemberId; planId: string }
  /** The member accepted, then stopped responding (no confirm, no cancel, no show). */
  | Base & { type: "plan_ghosted"; member: MemberId; planId: string }
  /** Feedback after an attended plan. */
  | Base & { type: "feedback_given"; member: MemberId; planId: string }
  /** The member helped someone (answered an ask, gave advice, made an introduction, shared knowledge). Earns nothing until the recipient confirms. */
  | Base & { type: "help_given"; helper: MemberId; recipient: MemberId; helpId: string }
  /** The recipient confirms the help happened and was useful. */
  | Base & { type: "help_confirmed"; helpId: string; recipient: MemberId; useful: boolean }
  /** The member organized a plan or recurring crew session. `attendees` = members who attended (checked in), excluding the organizer. */
  | Base & { type: "organized"; organizer: MemberId; planId: string; publicVenue: boolean; recurring: boolean; attendees: MemberId[]; label: string }
  /** The member answered an item on the Network's needs list, confirmed by the member or staff who raised it. */
  | Base & { type: "need_answered"; member: MemberId; needId: string; confirmedBy: MemberId | "staff"; label?: string }
  /** Reviewing / stewarding work (staff, later trained members). */
  | Base & { type: "review_completed"; member: MemberId; items: number }
  /** A reviewer confirmed gaming. Every credit these members earned with each other is clawed back. */
  | Base & { type: "fraud_confirmed"; members: MemberId[]; note?: string }
  /** Events that never change NC (design 2.4). Accepted so callers can stream everything; nothing is written. */
  | Base & { type: "declined"; member: MemberId; planId?: string }
  | Base & { type: "state_changed"; member: MemberId; state: "open" | "normal" | "quiet" | "receiving" | "paused" }
  | Base & { type: "data_shared"; member: MemberId }
  | Base & { type: "help_asked"; member: MemberId };

export type CapitalEventType = CapitalEvent["type"];

// ------------------------------------------------------------------------------------------------
// Ledger entries. Append-only: an entry is never edited or deleted. Reversals are new entries
// (`clawback`) that reference the entry they reverse.

export interface LedgerEntry {
  /** `${logIndex}:${eventId}:${member}`, unique within the ledger and the same on replay. */
  id: string;
  member: MemberId;
  t: number;
  category: EntryCategory;
  /** +1 earn, -1 lose. `amount` always has this sign (or is 0 when anti-gaming reduced it to nothing). */
  sign: 1 | -1;
  amount: number;
  /** Credit before anti-gaming multipliers (for audit). */
  base: number;
  /** Product of anti-gaming multipliers applied (1 for penalties). */
  multiplier: number;
  provenance: {
    eventId: string;
    eventType: CapitalEventType;
    /** Other members involved (counterparts, invitee, recipient, attendees). Never shown to others. */
    counterparts: MemberId[];
    /** Members whose action confirmed this credit (recipient, counterpart, invitee's value providers). Drives ring detection. */
    confirmedBy: MemberId[];
    /** What happened, in words with no private facts (17.2): "attended", "help confirmed useful", "vouch: invitee active". */
    outcome: string;
    planId?: string;
    /** Attendance only: who started the plan and how attendance was verified (staged-meetup detection). */
    origin?: PlanOrigin;
    verification?: Verification[];
    /** Public activity label for the view ("climbing night"). Never a private fact. */
    label?: string;
    /** Clawback / stake entries: the entry being reversed. */
    reverses?: string;
    /** Credits that exist only because of another credit (feedback on an attended plan): that entry. Reversed with it. */
    basis?: string;
    /** Penalty forgiven (the one forgiven no-show): amount is 0 and this is true. */
    forgiven?: boolean;
  };
}

/** Who is asking to read the ledger. Members read only their own; staff reads are audited. */
export type Viewer = { member: MemberId } | { staff: string; role: "audit" | "reviewer"; reason: string };

export interface GamingFlag {
  kind: "reciprocal_ring" | "staged_meetup" | "vouch_ring";
  members: MemberId[];
  t: number;
  /** Evidence counts, for the reviewer. */
  evidence: Record<string, number>;
}

/** A CapitalEvent without its id (distributive over the union), for builders. */
export type CapitalEventInput = CapitalEvent extends infer E ? (E extends CapitalEvent ? Omit<E, "id"> : never) : never;
