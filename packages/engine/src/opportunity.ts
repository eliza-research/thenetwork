// Opportunity workflow and consent state machine (Section 32.10, flows F11, F12, F27, F29).
// The allowed transitions are an explicit table (from, to, trigger, actor, timer). Anything not
// in the table throws InvalidTransitionError. Transitions are idempotent by event id, permission
// checked against the actor, and logged as events. Expiry timers run on a Clock.
import type { Category, Clock, MemberId, OpportunityState } from "@thenetwork/core";
import { HOUR } from "@thenetwork/core";

export type Actor = "engine" | "system" | "reviewer" | "member" | "clock" | "steward";
export type Trigger =
  | "propose" | "discard" | "enqueue_review" | "approve" | "reject" | "reroll" | "review_sla_missed"
  | "dispatch" | "accept" | "decline" | "invite_expired" | "quorum_deadline" | "invite_alternates"
  | "no_alternates" | "start_scheduling" | "async_intro" | "confirm_time" | "request_reschedule"
  | "scheduling_timeout" | "participant_dropped" | "replacement_found" | "start" | "complete" | "no_show"
  | "feedback" | "dispute" | "resolve_dispute" | "cancel" | "safety_report" | "release_hold" | "safety_cancel";

export interface TransitionRule { from: OpportunityState; to: OpportunityState; trigger: Trigger; actors: Actor[]; timer?: string }

export const TERMINAL_STATES: ReadonlySet<OpportunityState> = new Set<OpportunityState>([
  "FEEDBACK_COLLECTED", "REJECTED_IN_REVIEW", "DECLINED", "EXPIRED", "QUORUM_FAILED", "CANCELLED", "ABANDONED",
]);

const R = (from: OpportunityState, to: OpportunityState, trigger: Trigger, actors: Actor[], timer?: string): TransitionRule => ({ from, to, trigger, actors, timer });

const CORE_RULES: TransitionRule[] = [
  R("DRAFT", "PROPOSED", "propose", ["engine"]),
  R("DRAFT", "CANCELLED", "discard", ["engine", "system"]),
  R("PROPOSED", "IN_REVIEW", "enqueue_review", ["system"]),
  R("PROPOSED", "EXPIRED", "review_sla_missed", ["clock"], "review SLA (12h standard, 1h same-day)"),
  R("IN_REVIEW", "APPROVED", "approve", ["reviewer"]),
  R("IN_REVIEW", "REJECTED_IN_REVIEW", "reject", ["reviewer"]),
  R("IN_REVIEW", "DRAFT", "reroll", ["reviewer"]),
  R("IN_REVIEW", "EXPIRED", "review_sla_missed", ["clock"], "review SLA (12h standard, 1h same-day)"),
  R("APPROVED", "INVITING", "dispatch", ["system"]),
  R("APPROVED", "EXPIRED", "review_sla_missed", ["clock"], "dispatch window"),
  // Send-time eligibility (audit P1-5): an anchor who became ineligible before dispatch cancels it.
  R("APPROVED", "CANCELLED", "cancel", ["system"]),
  // Invitations (independent per participant; F11/F12).
  R("INVITING", "PARTIALLY_ACCEPTED", "accept", ["member"]),
  R("INVITING", "MUTUALLY_ACCEPTED", "accept", ["member"]),
  R("INVITING", "QUORUM_MET", "accept", ["member"]),
  R("INVITING", "DECLINED", "decline", ["member"]),
  R("INVITING", "NEEDS_REPLACEMENT", "decline", ["member"]),
  R("INVITING", "NEEDS_REPLACEMENT", "invite_expired", ["clock"], "invite TTL (48h; same-day 3h)"),
  R("INVITING", "EXPIRED", "invite_expired", ["clock"], "invite TTL (48h; same-day 3h)"),
  R("INVITING", "QUORUM_FAILED", "quorum_deadline", ["clock"], "quorum deadline"),
  // The seeker/initiator (an anchor) declining, or becoming ineligible, ends the opportunity: no backfill (audit P1-9).
  R("INVITING", "CANCELLED", "cancel", ["member", "system"]),
  // Not enough eligible people left to invite at dispatch or backfill time.
  R("INVITING", "QUORUM_FAILED", "no_alternates", ["system"]),
  R("PARTIALLY_ACCEPTED", "PARTIALLY_ACCEPTED", "accept", ["member"]),
  R("PARTIALLY_ACCEPTED", "MUTUALLY_ACCEPTED", "accept", ["member"]),
  R("PARTIALLY_ACCEPTED", "QUORUM_MET", "accept", ["member"]),
  R("PARTIALLY_ACCEPTED", "DECLINED", "decline", ["member"]),
  R("PARTIALLY_ACCEPTED", "NEEDS_REPLACEMENT", "decline", ["member"]),
  R("PARTIALLY_ACCEPTED", "NEEDS_REPLACEMENT", "invite_expired", ["clock"], "invite TTL"),
  R("PARTIALLY_ACCEPTED", "EXPIRED", "invite_expired", ["clock"], "invite TTL"),
  R("PARTIALLY_ACCEPTED", "QUORUM_FAILED", "quorum_deadline", ["clock"], "quorum deadline"),
  R("PARTIALLY_ACCEPTED", "CANCELLED", "cancel", ["member", "system"]),
  R("NEEDS_REPLACEMENT", "INVITING", "invite_alternates", ["system"]),
  R("NEEDS_REPLACEMENT", "QUORUM_FAILED", "no_alternates", ["system"]),
  R("NEEDS_REPLACEMENT", "QUORUM_MET", "replacement_found", ["member"]),
  R("NEEDS_REPLACEMENT", "SCHEDULED", "replacement_found", ["member"]),
  R("NEEDS_REPLACEMENT", "CANCELLED", "cancel", ["system", "member"]),
  R("NEEDS_REPLACEMENT", "QUORUM_FAILED", "quorum_deadline", ["clock"], "quorum deadline"),
  // Scheduling (F17).
  R("MUTUALLY_ACCEPTED", "SCHEDULING", "start_scheduling", ["system"]),
  R("MUTUALLY_ACCEPTED", "COMPLETED", "async_intro", ["system"]),
  R("MUTUALLY_ACCEPTED", "CANCELLED", "cancel", ["member", "system"]),
  // Late acceptances once a group is going ahead: recorded, no state change (previously these
  // threw, so the 5th and 6th invitees of a 6-person group with quorum 4 could never say yes).
  R("QUORUM_MET", "QUORUM_MET", "accept", ["member"]),
  R("SCHEDULING", "SCHEDULING", "accept", ["member"]),
  R("SCHEDULED", "SCHEDULED", "accept", ["member"]),
  R("RESCHEDULE_REQUESTED", "RESCHEDULE_REQUESTED", "accept", ["member"]),
  R("QUORUM_MET", "SCHEDULING", "start_scheduling", ["system"]),
  R("QUORUM_MET", "CANCELLED", "cancel", ["member", "system"]),
  R("SCHEDULING", "SCHEDULED", "confirm_time", ["member"]),
  R("SCHEDULING", "CANCELLED", "cancel", ["member", "system"]),
  R("SCHEDULING", "ABANDONED", "scheduling_timeout", ["clock"], "scheduling timeout"),
  R("SCHEDULED", "RESCHEDULE_REQUESTED", "request_reschedule", ["member"]),
  R("SCHEDULED", "NEEDS_REPLACEMENT", "participant_dropped", ["member", "system"]),
  R("SCHEDULED", "CANCELLED", "cancel", ["member", "system"]),
  R("SCHEDULED", "IN_PROGRESS", "start", ["clock"], "scheduled start time"),
  R("RESCHEDULE_REQUESTED", "SCHEDULED", "confirm_time", ["member"]),
  R("RESCHEDULE_REQUESTED", "CANCELLED", "cancel", ["member", "system"]),
  R("RESCHEDULE_REQUESTED", "ABANDONED", "scheduling_timeout", ["clock"], "reschedule timeout"),
  // Meeting and after (F18, F19).
  R("IN_PROGRESS", "COMPLETED", "complete", ["member", "system"]),
  R("IN_PROGRESS", "ABANDONED", "no_show", ["member", "system"]),
  R("IN_PROGRESS", "DISPUTED", "dispute", ["member"]),
  R("COMPLETED", "FEEDBACK_COLLECTED", "feedback", ["member", "system"]),
  R("COMPLETED", "DISPUTED", "dispute", ["member"]),
  R("DISPUTED", "COMPLETED", "resolve_dispute", ["steward"]),
  R("DISPUTED", "CANCELLED", "resolve_dispute", ["steward"]),
];

/** Every non-terminal state can be placed on safety hold, released back, or cancelled (F23). */
const HOLDABLE: OpportunityState[] = [
  "DRAFT", "PROPOSED", "IN_REVIEW", "APPROVED", "INVITING", "PARTIALLY_ACCEPTED", "MUTUALLY_ACCEPTED", "QUORUM_MET",
  "SCHEDULING", "SCHEDULED", "RESCHEDULE_REQUESTED", "NEEDS_REPLACEMENT", "IN_PROGRESS", "COMPLETED", "DISPUTED",
];
export const TRANSITIONS: readonly TransitionRule[] = Object.freeze([
  ...CORE_RULES,
  ...HOLDABLE.map(s => R(s, "SAFETY_HOLD", "safety_report", ["steward", "system"])),
  ...HOLDABLE.map(s => R("SAFETY_HOLD", s, "release_hold", ["steward"])),
  R("SAFETY_HOLD", "CANCELLED", "safety_cancel", ["steward"]),
]);

export class InvalidTransitionError extends Error {
  constructor(public from: OpportunityState, public to: OpportunityState, public trigger: string, public actor: Actor, why: string) {
    super(`invalid transition ${from} -> ${to} (${trigger} by ${actor}): ${why}`);
    this.name = "InvalidTransitionError";
  }
}

export type ParticipationStatus =
  | "pending" | "invited" | "accepted" | "declined" | "expired" | "confirmed" | "attended"
  | "cancelled_with_notice" | "no_show" | "replaced";

export interface OpportunityEvent { eventId: string; at: number; from: OpportunityState; to: OpportunityState; trigger: Trigger; actor: Actor; memberId?: MemberId }

/**
 * Send-time eligibility re-check (audit P1-5). Returns null if `memberId` may still be invited or
 * stay in this opportunity alongside `others`, else a reason ("state_paused", "blocked",
 * "safety_hold", "underage", "opted_out", ...). Build one from a World with `eligibilityFor`
 * (filters.ts). Without it, dispatch/accept/backfill act on ids only, as before.
 */
/** `lane`: the opportunity's category, when the caller knows it (re-checks lane opt-ins). */
export type EligibilityCheck = (memberId: MemberId, others: MemberId[], lane?: Category) => string | null;
export interface EligibilityOpts {
  eligible?: EligibilityCheck;
  /**
   * Age gate for alternates (backfill): false for a minor or an unknown age (core canBeMatched,
   * fail closed). Applied even without `eligible`, so an id-only caller still never backfills a minor.
   */
  canMatch?: (memberId: MemberId) => boolean;
}

export interface Opportunity {
  id: string; state: OpportunityState; isGroup: boolean;
  /**
   * The seeker/initiator(s) the opportunity exists for. If an anchor declines or becomes ineligible,
   * the opportunity is cancelled instead of backfilled; only helper/peer roles are replaced.
   */
  anchors: MemberId[];
  /** Why members were removed at send time (member -> reason). Never shown to other participants. */
  removed: Record<MemberId, string>;
  participants: Record<MemberId, ParticipationStatus>;
  inviteExpiresAt: Record<MemberId, number>;
  alternates: MemberId[]; quorum: number;
  quorumDeadline?: number; sameDay: boolean;
  heldFrom?: OpportunityState;
  events: OpportunityEvent[];
  appliedEventIds: string[];
}

export function createOpportunity(p: { id: string; participants: MemberId[]; alternates?: MemberId[]; quorum?: number; sameDay?: boolean; anchors?: MemberId[] }): Opportunity {
  const isGroup = p.participants.length > 2;
  for (const a of p.anchors ?? []) if (!p.participants.includes(a)) throw new Error(`anchor ${a} is not a participant`);
  return {
    id: p.id, state: "DRAFT", isGroup, anchors: [...(p.anchors ?? [])], removed: {},
    participants: Object.fromEntries(p.participants.map(id => [id, "pending" as ParticipationStatus])),
    inviteExpiresAt: {}, alternates: [...(p.alternates ?? [])],
    quorum: p.quorum ?? (isGroup ? Math.max(3, Math.ceil(p.participants.length * 2 / 3)) : p.participants.length),
    sameDay: !!p.sameDay, events: [], appliedEventIds: [],
  };
}

export function findRule(from: OpportunityState, to: OpportunityState, trigger: Trigger): TransitionRule | undefined {
  return TRANSITIONS.find(r => r.from === from && r.to === to && r.trigger === trigger);
}

/**
 * Low-level transition. Idempotent by eventId (a repeated event is a no-op), permission-checked
 * against the table's actors, and logged. Throws InvalidTransitionError for anything else.
 */
export function transition(o: Opportunity, to: OpportunityState, trigger: Trigger, actor: Actor, clock: Clock, eventId: string, memberId?: MemberId): Opportunity {
  if (o.appliedEventIds.includes(eventId)) return o;
  const rule = findRule(o.state, to, trigger);
  if (!rule) throw new InvalidTransitionError(o.state, to, trigger, actor, "not in transition table");
  if (!rule.actors.includes(actor)) throw new InvalidTransitionError(o.state, to, trigger, actor, `actor not permitted (allowed: ${rule.actors.join(",")})`);
  if (trigger === "release_hold" && o.heldFrom !== to) throw new InvalidTransitionError(o.state, to, trigger, actor, `hold must release to ${o.heldFrom}`);
  if (to === "SAFETY_HOLD") o.heldFrom = o.state;
  if (trigger === "release_hold") o.heldFrom = undefined;
  o.events.push({ eventId, at: clock.now(), from: o.state, to, trigger, actor, memberId });
  o.appliedEventIds.push(eventId);
  o.state = to;
  return o;
}

export const inviteTtl = (o: Opportunity) => (o.sameDay ? 3 * HOUR : 48 * HOUR);

const isAnchor = (o: Opportunity, id: MemberId) => o.anchors.includes(id);
/** Members still in the opportunity (not declined, expired, replaced or removed). */
const live = (o: Opportunity) => Object.keys(o.participants).filter(id => !["declined", "expired", "replaced"].includes(o.participants[id]!));
const ineligible = (o: Opportunity, id: MemberId, opts: EligibilityOpts) =>
  opts.eligible?.(id, live(o).filter(x => x !== id)) ?? null;

/** Remove a member at send time; returns true if that ends the opportunity (anchor). */
function removeIneligible(o: Opportunity, id: MemberId, reason: string): boolean {
  o.participants[id] = "replaced";
  o.removed[id] = reason;
  return isAnchor(o, id);
}

/** Pop eligible alternates (dropping ineligible ones from the list) to cover `n` places. */
function takeAlternates(o: Opportunity, n: number, opts: EligibilityOpts): MemberId[] {
  const out: MemberId[] = [];
  while (out.length < n && o.alternates.length) {
    const id = o.alternates.shift()!;
    if (o.participants[id] !== undefined && o.participants[id] !== "pending") continue; // already involved
    if (opts.canMatch && !opts.canMatch(id)) { o.removed[id] = "underage"; continue; } // never backfill a minor
    const why = opts.eligible?.(id, [...live(o), ...out]) ?? null;
    if (why) { o.removed[id] = why; continue; }
    out.push(id);
  }
  return out;
}

/**
 * Approved -> Inviting: invite every pending participant with an expiry timer (F29). With
 * `opts.eligible`, every invitee is re-checked first (paused, blocked, safety hold, minor, opted
 * out). An ineligible anchor cancels the opportunity; an ineligible helper/peer is removed and
 * backfilled from eligible alternates; if quorum is then out of reach it fails.
 */
export function dispatchInvites(o: Opportunity, clock: Clock, eventId: string, opts: EligibilityOpts = {}): Opportunity {
  if (o.appliedEventIds.includes(eventId)) return o;
  if (opts.eligible) {
    for (const [id, st] of Object.entries(o.participants)) if (st === "pending") {
      const why = ineligible(o, id, opts);
      if (why && removeIneligible(o, id, why)) return transition(o, "CANCELLED", "cancel", "system", clock, eventId);
    }
  }
  transition(o, "INVITING", "dispatch", "system", clock, eventId);
  for (const [id, st] of Object.entries(o.participants)) if (st === "pending") {
    o.participants[id] = "invited";
    o.inviteExpiresAt[id] = clock.now() + inviteTtl(o);
  }
  o.quorumDeadline ??= clock.now() + inviteTtl(o) * 2;
  const short = o.quorum - accepted(o) - outstanding(o);
  if (short > 0) {
    for (const id of takeAlternates(o, short, opts)) { o.participants[id] = "invited"; o.inviteExpiresAt[id] = clock.now() + inviteTtl(o); }
    if (accepted(o) + outstanding(o) < o.quorum) return transition(o, "QUORUM_FAILED", "no_alternates", "system", clock, `${eventId}:short`);
  }
  return o;
}

const LATE_ACCEPT_STATES: ReadonlySet<OpportunityState> = new Set<OpportunityState>(["QUORUM_MET", "SCHEDULING", "SCHEDULED", "RESCHEDULE_REQUESTED"]);
const accepted = (o: Opportunity) => Object.values(o.participants).filter(s => s === "accepted" || s === "confirmed").length;
const outstanding = (o: Opportunity) => Object.values(o.participants).filter(s => s === "invited").length;

/**
 * Member accepts or declines (independently; nobody learns another's decline).
 * - A decline by an anchor (the seeker/initiator) cancels the opportunity; it is never backfilled.
 * - With `opts.eligible`, an accept from a member who has since become ineligible (paused, blocked,
 *   held, minor, opted out) is not recorded as an acceptance: the member is removed, and the
 *   opportunity continues as if they had declined (or is cancelled if they are an anchor).
 * - No responses are taken on a terminal or safety-held opportunity.
 */
export function respond(o: Opportunity, memberId: MemberId, accept: boolean, clock: Clock, eventId: string, opts: EligibilityOpts = {}): Opportunity {
  if (o.appliedEventIds.includes(eventId)) return o;
  if (TERMINAL_STATES.has(o.state) || o.state === "SAFETY_HOLD") throw new InvalidTransitionError(o.state, o.state, accept ? "accept" : "decline", "member", `opportunity is ${o.state}`);
  if (o.participants[memberId] !== "invited") throw new InvalidTransitionError(o.state, o.state, accept ? "accept" : "decline", "member", `${memberId} has no open invitation`);
  if (clock.now() >= (o.inviteExpiresAt[memberId] ?? Infinity)) throw new InvalidTransitionError(o.state, o.state, accept ? "accept" : "decline", "member", "invitation expired");
  const prevStatus = o.participants[memberId];
  const why = accept ? ineligible(o, memberId, opts) : null;
  if (why) {
    // Became ineligible since the invite: treat as a withdrawal, never as a yes.
    accept = false;
    o.removed[memberId] = why;
  }
  o.participants[memberId] = why ? "replaced" : accept ? "accepted" : "declined";
  try {
    if (!accept && isAnchor(o, memberId)) {
      // The seeker/initiator said no (or can't take part): end it, don't find them a substitute.
      transition(o, "CANCELLED", "cancel", why ? "system" : "member", clock, eventId, memberId);
    } else if (accept) {
      const n = accepted(o);
      const total = Object.keys(o.participants).filter(id => o.participants[id] !== "declined" && o.participants[id] !== "expired" && o.participants[id] !== "replaced").length;
      let to: OpportunityState;
      if (LATE_ACCEPT_STATES.has(o.state)) to = o.state;
      else if (o.state === "NEEDS_REPLACEMENT") to = "QUORUM_MET";
      else if (!o.isGroup) to = n === total && n >= o.quorum ? "MUTUALLY_ACCEPTED" : "PARTIALLY_ACCEPTED";
      else to = n >= o.quorum ? "QUORUM_MET" : "PARTIALLY_ACCEPTED";
      if (o.state === "NEEDS_REPLACEMENT" && n < o.quorum) { o.events.push({ eventId, at: clock.now(), from: o.state, to: o.state, trigger: "accept", actor: "member", memberId }); o.appliedEventIds.push(eventId); return o; }
      transition(o, to, o.state === "NEEDS_REPLACEMENT" ? "replacement_found" : "accept", "member", clock, eventId, memberId);
    } else {
      const canReplace = o.alternates.length > 0;
      const stillPossible = accepted(o) + outstanding(o) >= o.quorum;
      if (stillPossible) {
        // Others can still reach quorum; record the decline privately with no state change.
        o.events.push({ eventId, at: clock.now(), from: o.state, to: o.state, trigger: "decline", actor: "member", memberId });
        o.appliedEventIds.push(eventId);
      } else {
        // Groups go to replacement (which fails the quorum if no alternates remain); pairs decline.
        transition(o, canReplace || o.isGroup ? "NEEDS_REPLACEMENT" : "DECLINED", "decline", "member", clock, eventId, memberId);
      }
    }
  } catch (e) { o.participants[memberId] = prevStatus!; throw e; }
  return o;
}

/** Invite the next alternates to cover the shortfall (F12 quorum backfill). */
export function inviteAlternates(o: Opportunity, clock: Clock, eventId: string, opts: EligibilityOpts = {}): Opportunity {
  if (o.appliedEventIds.includes(eventId)) return o;
  // Re-check the people who stay in it: an anchor who became ineligible ends it.
  if (opts.eligible) {
    for (const id of live(o)) {
      const why = ineligible(o, id, opts);
      if (why && removeIneligible(o, id, why)) return transition(o, "CANCELLED", "cancel", "system", clock, eventId);
    }
  }
  if (o.alternates.length === 0) return transition(o, "QUORUM_FAILED", "no_alternates", "system", clock, eventId);
  if (!findRule(o.state, "INVITING", "invite_alternates")) throw new InvalidTransitionError(o.state, "INVITING", "invite_alternates", "system", "not in transition table");
  const shortfall = Math.max(1, o.quorum - accepted(o) - outstanding(o));
  const next = takeAlternates(o, shortfall, opts);
  if (next.length === 0) return transition(o, "QUORUM_FAILED", "no_alternates", "system", clock, eventId);
  for (const id of next) { o.participants[id] = "invited"; o.inviteExpiresAt[id] = clock.now() + inviteTtl(o); }
  return transition(o, "INVITING", "invite_alternates", "system", clock, eventId);
}

/** Clock tick: expire invitations, apply quorum deadline. Idempotent per tick time. */
export function tick(o: Opportunity, clock: Clock): Opportunity {
  const now = clock.now();
  if (o.state !== "INVITING" && o.state !== "PARTIALLY_ACCEPTED" && o.state !== "NEEDS_REPLACEMENT") return o;
  let expiredAny = false;
  for (const [id, st] of Object.entries(o.participants)) {
    if (st === "invited" && now >= (o.inviteExpiresAt[id] ?? Infinity)) { o.participants[id] = "expired"; expiredAny = true; }
  }
  const eid = `tick:${o.id}:${now}`;
  if (o.quorumDeadline !== undefined && now >= o.quorumDeadline && accepted(o) < o.quorum) {
    return transition(o, "QUORUM_FAILED", "quorum_deadline", "clock", clock, eid);
  }
  if (expiredAny && o.state !== "NEEDS_REPLACEMENT" && accepted(o) + outstanding(o) < o.quorum) {
    if (o.alternates.length) return transition(o, "NEEDS_REPLACEMENT", "invite_expired", "clock", clock, eid);
    return transition(o, "EXPIRED", "invite_expired", "clock", clock, eid);
  }
  return o;
}

/** What a participant may see: their own status and whether it is going ahead, never others' declines. */
export function visibleTo(o: Opportunity, memberId: MemberId): { state: OpportunityState; mine: ParticipationStatus | undefined; acceptedCount?: number } {
  const v: { state: OpportunityState; mine: ParticipationStatus | undefined; acceptedCount?: number } = { state: o.state, mine: o.participants[memberId] };
  if (o.state === "QUORUM_MET" || o.state === "MUTUALLY_ACCEPTED" || o.state === "SCHEDULING" || o.state === "SCHEDULED") v.acceptedCount = accepted(o);
  return v;
}
