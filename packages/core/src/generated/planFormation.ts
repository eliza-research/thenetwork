// GENERATED from spec/planFormation.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Give each invited member one plan per city run / Reserve ranked plans until the city limit is reached (spec/planFormation.md) */
export type PlanRunPhase = "ReservingPlans" | "PlansPublished";
/** Story: Give each invited member one plan per city run / Reserve ranked plans until the city limit is reached (spec/planFormation.md) */
export interface CityPlanRun { phase: PlanRunPhase; count: number; occupied: Record<string, boolean> }

/** One variant per transition in the spec. */
export type Event =
  | { type: "reservePlan"; invited: string[]; limit: number }
  | { type: "publishPlans" };

/** Story: Give each invited member one plan per city run / Reserve ranked plans until the city limit is reached (spec/planFormation.md) */
export const initial: CityPlanRun = { phase: "ReservingPlans", count: 0, occupied: ({} as Record<string, boolean>) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: CityPlanRun): boolean {
  return true;
}

/** Story: Find a public activity that fits the group / A public venue must fit the activity and the proposed number of people (spec/planFormation.md) */
//@ pure
export function venueCanHostActivity(isPublic: boolean, sameCity: boolean, supportsActivity: boolean, capacity: number, openAtSlot: boolean): boolean {
  return isPublic && sameCity && supportsActivity && capacity >= 2 && openAtSlot;
}

/** Story: Find a public activity that fits the group / A public venue must fit the activity and the proposed number of people (spec/planFormation.md) */
//@ pure
export function venueCanHoldGroup(capacity: number, eligiblePeople: number, minimumGroup: number): boolean {
  return capacity >= minimumGroup && eligiblePeople >= minimumGroup;
}

/** Story: Find a public activity that fits the group / A public venue must fit the activity and the proposed number of people (spec/planFormation.md) */
//@ pure
export function planInviteLimit(planMaximum: number, placeCapacity: number): number {
  return placeCapacity < planMaximum ? placeCapacity : planMaximum;
}

/** Story: Find a public activity that fits the group / A public venue must fit the activity and the proposed number of people (spec/planFormation.md) */
//@ pure
export function planCanFitPlace(maximumGroup: number, minimumPlace: number): boolean {
  return !(maximumGroup < minimumPlace);
}

/** Story: Find a public activity that fits the group / A public venue must fit the activity and the proposed number of people (spec/planFormation.md) */
//@ pure
export function lawPlaceCapsInvites(planMaximum: number, placeCapacity: number): boolean {
  //@ ensures \result === true
  return !(planInviteLimit(planMaximum, placeCapacity) > placeCapacity) && !(planInviteLimit(planMaximum, placeCapacity) > planMaximum);
}

/** Story: Find a public activity that fits the group / Friends prefers a venue every primary invitee can reach (spec/planFormation.md) */
//@ pure
export function preferPlanVenue(candidateFitsEveryone: boolean, selectedFitsEveryone: boolean, candidateWinsTravelTieBreak: boolean): boolean {
  return candidateFitsEveryone === selectedFitsEveryone ? candidateWinsTravelTieBreak : candidateFitsEveryone;
}

/** Story: Find a public activity that fits the group / Friends prefers a venue every primary invitee can reach (spec/planFormation.md) */
//@ pure
export function lawReachablePlanVenueWins(travelTieBreak: boolean): boolean {
  //@ ensures \result === true
  return preferPlanVenue(true, false, travelTieBreak) && !preferPlanVenue(false, true, travelTieBreak);
}

/** Story: Find a public activity that fits the group / Check pairs inside the available slot pool (spec/planFormation.md) */
//@ pure
export function planSlotPairCanConnect(pairWorth: number): boolean {
  return pairWorth >= 0;
}

/** Story: Find a public activity that fits the group / Search for a qualifying group before an activity partner (spec/planFormation.md) */
//@ pure
export function searchForPlanGroup(available: number, minimumInvite: number, maximumGroup: number, minimumGroup: number): boolean {
  return available >= minimumInvite && maximumGroup >= minimumGroup;
}

/** Story: Find a public activity that fits the group / Search for a qualifying group before an activity partner (spec/planFormation.md) */
//@ pure
export function planScoreQualifies(minimumScore: number, overallScore: number, memberFloor: number, planFloor: number): boolean {
  return minimumScore >= memberFloor && overallScore >= planFloor;
}

/** Story: Find a public activity that fits the group / Search for a qualifying group before an activity partner (spec/planFormation.md) */
//@ pure
export function searchForPlanPartner(hasGroup: boolean, partnerEnabled: boolean, activityMinimum: number, capacity: number): boolean {
  return !hasGroup && partnerEnabled && activityMinimum <= 2 && capacity >= 2;
}

/** Story: Find a public activity that fits the group / Search for a qualifying group before an activity partner (spec/planFormation.md) */
//@ pure
export function planGroupCanReserve(coherent: boolean, minimumScore: number, overallScore: number, memberFloor: number, planFloor: number): boolean {
  return coherent && planScoreQualifies(minimumScore, overallScore, memberFloor, planFloor);
}

/** Story: Find a public activity that fits the group / Search for a qualifying group before an activity partner (spec/planFormation.md) */
//@ pure
export function lawPlanGroupReservationRequiresBothScores(coherent: boolean, minimumScore: number, overallScore: number, memberFloor: number, planFloor: number): boolean {
  //@ ensures \result === true
  return !planGroupCanReserve(coherent, minimumScore, overallScore, memberFloor, planFloor) || (coherent && minimumScore >= memberFloor && overallScore >= planFloor);
}

/** Story: Find a public activity that fits the group / Alternates must fit the entire offered group (spec/planFormation.md) */
//@ pure
export function isPlanAlternate(adult: boolean, compatibleWithEveryone: boolean): boolean {
  return adult && compatibleWithEveryone;
}

/** Story: Find a public activity that fits the group / Alternates must fit the entire offered group (spec/planFormation.md) */
//@ pure
export function planAlternateLimitReached(alternates: number, partner: boolean, groupLimit: number): boolean {
  return alternates >= (partner ? 1 : groupLimit);
}

/** Story: Give each invited member one plan per city run / Reserve ranked plans until the city limit is reached (spec/planFormation.md) */
//@ pure
export function cityPlanLimitReached(s: CityPlanRun, limit: number): boolean {
  return s.count >= limit;
}

/** Story: Give each invited member one plan per city run / Reserve ranked plans until the city limit is reached (spec/planFormation.md) */
//@ pure
export function memberAlreadyInvited(s: CityPlanRun, memberId: string): boolean {
  return ("$" + memberId) in s.occupied;
}

/** Story: Give each invited member one plan per city run / Reserve ranked plans until the city limit is reached (spec/planFormation.md) */
//@ pure
export function reservePlan(s: CityPlanRun, invited: string[], limit: number): CityPlanRun {
  //@ ensures (inv(s) && canReservePlan(s, invited, limit)) ==> stepPlanCountChangesOnlyOnReservation(s, "reservePlan", \result)
  //@ ensures (inv(s) && canReservePlan(s, invited, limit)) ==> stepPublishedPlansStayClosed(s, \result)
  return { ...s, count: exact_planFormation(s.count + 1), occupied: invited.reduce((members: Record<string, boolean>, memberId: string) => ({ ...members, ["$" + memberId]: true } as Record<string, boolean>), s.occupied) };
}

/** Story: Give each invited member one plan per city run / Reserve ranked plans until the city limit is reached (spec/planFormation.md) */
//@ pure
export function stepPlanCountChangesOnlyOnReservation(before: CityPlanRun, via: string, after: CityPlanRun): boolean {
  return via === "reservePlan" ? after.count === exact_planFormation(before.count + 1) : after.count === before.count;
}

/** Story: Give each invited member one plan per city run / Reserve ranked plans until the city limit is reached (spec/planFormation.md) */
//@ pure
export function canReservePlan(s: CityPlanRun, invited: string[], limit: number): boolean {
  return s.phase === "ReservingPlans" && !cityPlanLimitReached(s, limit) && !invited.some((memberId: string) => !(!memberAlreadyInvited(s, memberId)));
}

/** Story: Give each invited member one plan per city run / Publish alternates after all invitations are reserved (spec/planFormation.md) */
//@ pure
export function canPublishPlans(s: CityPlanRun): boolean {
  return s.phase === "ReservingPlans";
}

/** Story: Give each invited member one plan per city run / Publish alternates after all invitations are reserved (spec/planFormation.md) */
//@ pure
export function publishPlans(s: CityPlanRun): CityPlanRun {
  //@ ensures (inv(s) && canPublishPlans(s)) ==> stepPlanCountChangesOnlyOnReservation(s, "publishPlans", \result)
  //@ ensures (inv(s) && canPublishPlans(s)) ==> stepPublishedPlansStayClosed(s, \result)
  return { ...s, phase: "PlansPublished" };
}

/** Story: Give each invited member one plan per city run / Publish alternates after all invitations are reserved (spec/planFormation.md) */
//@ pure
export function stepPublishedPlansStayClosed(before: CityPlanRun, after: CityPlanRun): boolean {
  return !(before.phase === "PlansPublished") || equal_planFormation(after, before);
}

/** Story: Give each invited member one plan per city run / Publish alternates after all invitations are reserved (spec/planFormation.md) */
//@ pure
export function sometimesPublishesAnInvitation(s: CityPlanRun): boolean {
  return s.phase === "PlansPublished" && s.count > 0;
}

/** Story: Give each invited member one plan per city run / Publish alternates after all invitations are reserved (spec/planFormation.md) */
//@ pure
export function planAlternateCanRemain(s: CityPlanRun, memberId: string): boolean {
  return s.phase === "PlansPublished" && !memberAlreadyInvited(s, memberId);
}

/** Story: Use the same activity window for availability and a proposal / A template supplies the start and the activity supplies the end (spec/planFormation.md) */
//@ pure
export function planActivityWindowEnd(startsAt: number, durationMinutes: number): number {
  return exact_planFormation(startsAt + exact_planFormation(durationMinutes * 60000));
}

/** Story: Use the same activity window for availability and a proposal / A template supplies the start and the activity supplies the end (spec/planFormation.md) */
//@ pure
export function lawPlanActivityWindowEndsAfterStart(startsAt: number, durationMinutes: number): boolean {
  //@ ensures \result === true
  return !(durationMinutes > 0) || planActivityWindowEnd(startsAt, durationMinutes) > startsAt;
}

/** Story: Use the same activity window for availability and a proposal / A standing window applies to the whole activity (spec/planFormation.md) */
//@ pure
export function planStandingWindowCoversSlot(windowStart: number, windowEnd: number, slotStart: number, slotEnd: number): boolean {
  return windowStart <= slotStart && slotStart < slotEnd && slotEnd <= windowEnd;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: CityPlanRun, event: Event): boolean {
  if (event.type === "reservePlan") return canReservePlan(current, event.invited, event.limit);
  if (event.type === "publishPlans") return canPublishPlans(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: CityPlanRun, event: Event): CityPlanRun {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "reservePlan") return canReservePlan(current, event.invited, event.limit) ? reservePlan(current, event.invited, event.limit) : current;
  if (event.type === "publishPlans") return canPublishPlans(current) ? publishPlans(current) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "reservePlan" && Array.isArray(raw.invited) && raw.invited.every((x0: any) => typeof x0 === "string") && Number.isSafeInteger(raw.limit)) return { type: "reservePlan", invited: raw.invited.map((x0: any) => x0), limit: raw.limit };
  if (raw.type === "publishPlans") return { type: "publishPlans" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): CityPlanRun | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "ReservingPlans" || raw.phase === "PlansPublished") && Number.isSafeInteger(raw.count) && typeof raw.occupied === "object" && raw.occupied !== null && !Array.isArray(raw.occupied) && Object.entries(raw.occupied).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && Object.keys(raw).length === 3)) return undefined;
  const parsed: CityPlanRun = ({ phase: raw.phase, count: raw.count, occupied: Object.fromEntries(Object.entries(raw.occupied).map(([k1, x1]: [string, any]) => [k1, x1])) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): CityPlanRun {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_planFormation(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_planFormation(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_planFormation((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
