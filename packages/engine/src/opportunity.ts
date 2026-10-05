// Opportunity workflow and consent state machine (Section 32.10, flows F11, F12, F27, F29).
// The allowed transitions are an explicit table (from, to, trigger, actor, timer). Anything not
// in the table throws InvalidTransitionError. Transitions are idempotent by event id, permission
// checked against the actor, and logged as events. Expiry timers run on a Clock.
import type { Clock, MemberId, OpportunityState } from "@thenetwork/core";
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
  // Invitations (independent per participant; F11/F12).
  R("INVITING", "PARTIALLY_ACCEPTED", "accept", ["member"]),
  R("INVITING", "MUTUALLY_ACCEPTED", "accept", ["member"]),
  R("INVITING", "QUORUM_MET", "accept", ["member"]),
  R("INVITING", "DECLINED", "decline", ["member"]),
  R("INVITING", "NEEDS_REPLACEMENT", "decline", ["member"]),
  R("INVITING", "NEEDS_REPLACEMENT", "invite_expired", ["clock"], "invite TTL (48h; same-day 3h)"),
  R("INVITING", "EXPIRED", "invite_expired", ["clock"], "invite TTL (48h; same-day 3h)"),
  R("INVITING", "QUORUM_FAILED", "quorum_deadline", ["clock"], "quorum deadline"),
  R("PARTIALLY_ACCEPTED", "PARTIALLY_ACCEPTED", "accept", ["member"]),
  R("PARTIALLY_ACCEPTED", "MUTUALLY_ACCEPTED", "accept", ["member"]),
  R("PARTIALLY_ACCEPTED", "QUORUM_MET", "accept", ["member"]),
  R("PARTIALLY_ACCEPTED", "DECLINED", "decline", ["member"]),
  R("PARTIALLY_ACCEPTED", "NEEDS_REPLACEMENT", "decline", ["member"]),
  R("PARTIALLY_ACCEPTED", "NEEDS_REPLACEMENT", "invite_expired", ["clock"], "invite TTL"),
  R("PARTIALLY_ACCEPTED", "EXPIRED", "invite_expired", ["clock"], "invite TTL"),
  R("PARTIALLY_ACCEPTED", "QUORUM_FAILED", "quorum_deadline", ["clock"], "quorum deadline"),
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

export interface Opportunity {
  id: string; state: OpportunityState; isGroup: boolean;
  participants: Record<MemberId, ParticipationStatus>;
  inviteExpiresAt: Record<MemberId, number>;
  alternates: MemberId[]; quorum: number;
  quorumDeadline?: number; sameDay: boolean;
  heldFrom?: OpportunityState;
  events: OpportunityEvent[];
  appliedEventIds: string[];
}

export function createOpportunity(p: { id: string; participants: MemberId[]; alternates?: MemberId[]; quorum?: number; sameDay?: boolean }): Opportunity {
  const isGroup = p.participants.length > 2;
  return {
    id: p.id, state: "DRAFT", isGroup,
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

/** Approved -> Inviting: invite every pending participant with an expiry timer (F29). */
export function dispatchInvites(o: Opportunity, clock: Clock, eventId: string): Opportunity {
  if (o.appliedEventIds.includes(eventId)) return o;
  transition(o, "INVITING", "dispatch", "system", clock, eventId);
  for (const [id, st] of Object.entries(o.participants)) if (st === "pending") {
    o.participants[id] = "invited";
    o.inviteExpiresAt[id] = clock.now() + inviteTtl(o);
  }
  o.quorumDeadline ??= clock.now() + inviteTtl(o) * 2;
  return o;
}

const accepted = (o: Opportunity) => Object.values(o.participants).filter(s => s === "accepted" || s === "confirmed").length;
const outstanding = (o: Opportunity) => Object.values(o.participants).filter(s => s === "invited").length;

/** Member accepts or declines (independently; nobody learns another's decline). */
export function respond(o: Opportunity, memberId: MemberId, accept: boolean, clock: Clock, eventId: string): Opportunity {
  if (o.appliedEventIds.includes(eventId)) return o;
  if (o.participants[memberId] !== "invited") throw new InvalidTransitionError(o.state, o.state, accept ? "accept" : "decline", "member", `${memberId} has no open invitation`);
  if (clock.now() >= (o.inviteExpiresAt[memberId] ?? Infinity)) throw new InvalidTransitionError(o.state, o.state, accept ? "accept" : "decline", "member", "invitation expired");
  const prevStatus = o.participants[memberId];
  o.participants[memberId] = accept ? "accepted" : "declined";
  try {
    if (accept) {
      const n = accepted(o);
      const total = Object.keys(o.participants).filter(id => o.participants[id] !== "declined" && o.participants[id] !== "expired" && o.participants[id] !== "replaced").length;
      let to: OpportunityState;
      if (o.state === "NEEDS_REPLACEMENT") to = "QUORUM_MET";
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
export function inviteAlternates(o: Opportunity, clock: Clock, eventId: string): Opportunity {
  if (o.appliedEventIds.includes(eventId)) return o;
  if (o.alternates.length === 0) return transition(o, "QUORUM_FAILED", "no_alternates", "system", clock, eventId);
  if (!findRule(o.state, "INVITING", "invite_alternates")) throw new InvalidTransitionError(o.state, "INVITING", "invite_alternates", "system", "not in transition table");
  const shortfall = Math.max(1, o.quorum - accepted(o) - outstanding(o));
  const next = o.alternates.splice(0, shortfall);
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
