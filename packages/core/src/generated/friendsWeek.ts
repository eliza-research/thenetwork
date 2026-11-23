// GENERATED from spec/friendsWeek.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
export type WeekPhase = "CrewSessions" | "CrewOffers" | "RepeatPlans" | "NewPlans" | "PartnerIntros" | "WeekComplete";
/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
export interface FriendsRun { phase: WeekPhase; spreadNew: boolean; recurring: Record<string, boolean>; newUsed: Record<string, boolean>; newInvited: Record<string, boolean>; partnerCounts: Record<string, number> }
/** Story: Find time with familiar people or meet someone nearby / Recurring plans reserve places for later passes (spec/friendsWeek.md) */
export type RecurringKind = "Session" | "Offer" | "Repeat";
/** Story: Find time with familiar people or meet someone nearby / Activity partner reservations use a separate per-member allowance (spec/friendsWeek.md) */
export interface PartnerPair { first: string; second: string }

/** One variant per transition in the spec. */
export type Event =
  | { type: "beginCrewOffers" }
  | { type: "beginRepeats" }
  | { type: "beginNewPlans"; spreadNew: boolean }
  | { type: "beginPartners" }
  | { type: "finishWeek" }
  | { type: "reserveRecurring"; kind: RecurringKind; members: string[] }
  | { type: "reserveNewPlan"; invited: string[]; alternates: string[]; reserveAlternates: boolean }
  | { type: "reservePartner"; pair: PartnerPair; limit: number };

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
export const initial: FriendsRun = { phase: "CrewSessions", spreadNew: false, recurring: ({} as Record<string, boolean>), newUsed: ({} as Record<string, boolean>), newInvited: ({} as Record<string, boolean>), partnerCounts: ({} as Record<string, number>) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: FriendsRun): boolean {
  return true;
}

/** Story: Find time with familiar people or meet someone nearby / A split table still belongs to one invitation in the simulator report (spec/friendsWeek.md) */
//@ pure
export function friendCountsProposal(additionalTable: boolean): boolean {
  return !additionalTable;
}

/** Story: Find time with familiar people or meet someone nearby / A split table still belongs to one invitation in the simulator report (spec/friendsWeek.md) */
//@ pure
export function friendCountsProbedProposal(additionalTable: boolean, probes: number): boolean {
  return friendCountsProposal(additionalTable) && probes > 0;
}

/** Story: Find time with familiar people or meet someone nearby / A split table still belongs to one invitation in the simulator report (spec/friendsWeek.md) */
//@ pure
export function lawAdditionalTableCannotCountAsProbed(probes: number): boolean {
  //@ ensures \result === true
  return !friendCountsProbedProposal(true, probes);
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function canBeginCrewOffers(s: FriendsRun): boolean {
  return s.phase === "CrewSessions";
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function beginCrewOffers(s: FriendsRun): FriendsRun {
  //@ ensures (inv(s) && canBeginCrewOffers(s)) ==> stepCompletedWeekStaysClosed(s, \result)
  return { ...s, phase: "CrewOffers" };
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function canBeginRepeats(s: FriendsRun): boolean {
  return s.phase === "CrewOffers";
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function beginRepeats(s: FriendsRun): FriendsRun {
  //@ ensures (inv(s) && canBeginRepeats(s)) ==> stepCompletedWeekStaysClosed(s, \result)
  return { ...s, phase: "RepeatPlans" };
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function canBeginNewPlans(s: FriendsRun): boolean {
  return s.phase === "RepeatPlans";
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function beginNewPlans(s: FriendsRun, spreadNew: boolean): FriendsRun {
  //@ ensures (inv(s) && canBeginNewPlans(s)) ==> stepCompletedWeekStaysClosed(s, \result)
  return { ...s, phase: "NewPlans", spreadNew: spreadNew };
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function canBeginPartners(s: FriendsRun): boolean {
  return s.phase === "NewPlans";
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function beginPartners(s: FriendsRun): FriendsRun {
  //@ ensures (inv(s) && canBeginPartners(s)) ==> stepCompletedWeekStaysClosed(s, \result)
  return { ...s, phase: "PartnerIntros" };
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function canFinishWeek(s: FriendsRun): boolean {
  return s.phase === "PartnerIntros";
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function finishWeek(s: FriendsRun): FriendsRun {
  //@ ensures (inv(s) && canFinishWeek(s)) ==> stepCompletedWeekStaysClosed(s, \result)
  return { ...s, phase: "WeekComplete" };
}

/** Story: Find time with familiar people or meet someone nearby / Crew sessions, offers, repeats, new plans, and partners run in order (spec/friendsWeek.md) */
//@ pure
export function stepCompletedWeekStaysClosed(before: FriendsRun, after: FriendsRun): boolean {
  return !(before.phase === "WeekComplete") || after.phase === "WeekComplete";
}

/** Story: Find time with familiar people or meet someone nearby / Recurring plans reserve places for later passes (spec/friendsWeek.md) */
//@ pure
export function reserveIds(used: Record<string, boolean>, members: string[]): Record<string, boolean> {
  return members.reduce((seen: Record<string, boolean>, memberId: string) => ({ ...seen, ["$" + memberId]: true } as Record<string, boolean>), used);
}

/** Story: Find time with familiar people or meet someone nearby / Recurring plans reserve places for later passes (spec/friendsWeek.md) */
//@ pure
export function recurringAvailable(s: FriendsRun, memberId: string): boolean {
  return !(("$" + memberId) in s.recurring);
}

/** Story: Find time with familiar people or meet someone nearby / Recurring plans reserve places for later passes (spec/friendsWeek.md) */
//@ pure
export function reserveRecurring(s: FriendsRun, kind: RecurringKind, members: string[]): FriendsRun {
  //@ ensures (inv(s) && canReserveRecurring(s, kind, members)) ==> stepCompletedWeekStaysClosed(s, \result)
  return { ...s, recurring: reserveIds(s.recurring, members) };
}

/** Story: Find time with familiar people or meet someone nearby / Recurring plans reserve places for later passes (spec/friendsWeek.md) */
//@ pure
export function canReserveRecurring(s: FriendsRun, kind: RecurringKind, members: string[]): boolean {
  return (s.phase === "CrewSessions" && kind === "Session") || (((s.phase === "CrewOffers" && kind === "Offer") || (s.phase === "RepeatPlans" && kind === "Repeat")) && !members.some((memberId: string) => !recurringAvailable(s, memberId)));
}

/** Story: Find time with familiar people or meet someone nearby / A Friends repeat uses its own completed table and a fresh review (spec/friendsWeek.md) */
//@ pure
export function friendsRepeatSourceAllowed(completed: boolean, settlementComplete: boolean, crewActive: boolean, alreadyOffered: boolean): boolean {
  return completed && settlementComplete && !(crewActive || alreadyOffered);
}

/** Story: Find time with familiar people or meet someone nearby / A Friends repeat uses its own completed table and a fresh review (spec/friendsWeek.md) */
//@ pure
export function friendsRepeatBookingProofCurrent(replyRevision: number, currentRevision: number, settledBooking: boolean): boolean {
  return replyRevision >= 0 && replyRevision === currentRevision && settledBooking;
}

/** Story: Find time with familiar people or meet someone nearby / A Friends repeat uses its own completed table and a fresh review (spec/friendsWeek.md) */
//@ pure
export function friendsRepeatAttendanceAllowed(booked: boolean, came: boolean, again: boolean, noShowReported: boolean, crewDeclined: boolean): boolean {
  return booked && came && again && !(noShowReported || crewDeclined);
}

/** Story: Find time with familiar people or meet someone nearby / A Friends repeat uses its own completed table and a fresh review (spec/friendsWeek.md) */
//@ pure
export function friendsRepeatRosterCurrent(expected: string[], offered: string[]): boolean {
  return expected.length >= 3 && expected.length <= 6 && equal_friendsWeek(expected, offered);
}

/** Story: Find time with familiar people or meet someone nearby / A Friends repeat uses its own completed table and a fresh review (spec/friendsWeek.md) */
//@ pure
export function friendsRepeatHostIndex(previousIndex: number, seats: number): number {
  return previousIndex < 0 || exact_friendsWeek(previousIndex + 1) >= seats ? 0 : exact_friendsWeek(previousIndex + 1);
}

/** Story: Find time with familiar people or meet someone nearby / A Friends repeat uses its own completed table and a fresh review (spec/friendsWeek.md) */
//@ pure
export function lawFriendsRepeatNeedsSettledBooking(replyRevision: number, currentRevision: number): boolean {
  //@ ensures \result === true
  return !friendsRepeatBookingProofCurrent(replyRevision, currentRevision, false);
}

/** Story: Find time with familiar people or meet someone nearby / A Friends repeat uses its own completed table and a fresh review (spec/friendsWeek.md) */
//@ pure
export function lawFriendsRepeatNeedsOriginalRoster(expected: string[], offered: string[]): boolean {
  //@ ensures \result === true
  return !friendsRepeatRosterCurrent(expected, offered) || equal_friendsWeek(expected, offered);
}

/** Story: Find time with familiar people or meet someone nearby / New plans reserve each invitee once (spec/friendsWeek.md) */
//@ pure
export function newPlanUsed(s: FriendsRun, memberId: string): boolean {
  return ("$" + memberId) in s.newUsed;
}

/** Story: Find time with familiar people or meet someone nearby / New plans reserve each invitee once (spec/friendsWeek.md) */
//@ pure
export function newPlanAlternateCanRemain(s: FriendsRun, memberId: string): boolean {
  return !(("$" + memberId) in s.newInvited);
}

/** Story: Find time with familiar people or meet someone nearby / New plans reserve each invitee once (spec/friendsWeek.md) */
//@ pure
export function newPlanAvailable(s: FriendsRun, memberId: string): boolean {
  return !newPlanUsed(s, memberId) && (!s.spreadNew || recurringAvailable(s, memberId));
}

/** Story: Find time with familiar people or meet someone nearby / New plans reserve each invitee once (spec/friendsWeek.md) */
//@ pure
export function reserveNewPlan(s: FriendsRun, invited: string[], alternates: string[], reserveAlternates: boolean): FriendsRun {
  //@ ensures (inv(s) && canReserveNewPlan(s, invited, alternates, reserveAlternates)) ==> stepCompletedWeekStaysClosed(s, \result)
  const local_0 = reserveIds(s.newUsed, invited);
  return { ...s, newInvited: reserveIds(s.newInvited, invited), newUsed: reserveAlternates ? reserveIds(local_0, alternates) : local_0 };
}

/** Story: Find time with familiar people or meet someone nearby / New plans reserve each invitee once (spec/friendsWeek.md) */
//@ pure
export function sometimesPublishesAPlan(s: FriendsRun): boolean {
  return s.phase === "WeekComplete" && !newPlanAlternateCanRemain(s, "one");
}

/** Story: Find time with familiar people or meet someone nearby / New plans reserve each invitee once (spec/friendsWeek.md) */
//@ pure
export function canReserveNewPlan(s: FriendsRun, invited: string[], alternates: string[], reserveAlternates: boolean): boolean {
  return s.phase === "NewPlans" && !invited.some((memberId: string) => !newPlanAvailable(s, memberId)) && (!reserveAlternates || !alternates.some((memberId: string) => !newPlanAvailable(s, memberId)));
}

/** Story: Find time with familiar people or meet someone nearby / A standby has no initial invitation and holds one bench place (spec/friendsWeek.md) */
//@ pure
export function friendStandbyCanRemain(hasInitialInvitation: boolean, hasStandbyPlace: boolean): boolean {
  return !(hasInitialInvitation || hasStandbyPlace);
}

/** Story: Find time with familiar people or meet someone nearby / A standby has no initial invitation and holds one bench place (spec/friendsWeek.md) */
//@ pure
export function lawFriendStandbyHasNoOtherSeat(hasInitialInvitation: boolean, hasStandbyPlace: boolean): boolean {
  //@ ensures \result === true
  return !friendStandbyCanRemain(hasInitialInvitation, hasStandbyPlace) || (!hasInitialInvitation && !hasStandbyPlace);
}

/** Story: Find time with familiar people or meet someone nearby / A standby has no initial invitation and holds one bench place (spec/friendsWeek.md) */
//@ pure
export function lawFriendUnassignedStandbyCanRemain(hasInitialInvitation: boolean, hasStandbyPlace: boolean): boolean {
  //@ ensures \result === true
  return !(!hasInitialInvitation && !hasStandbyPlace) || friendStandbyCanRemain(hasInitialInvitation, hasStandbyPlace);
}

/** Story: Find time with familiar people or meet someone nearby / An unsuccessful starting member leaves the rest of the table candidates available (spec/friendsWeek.md) */
//@ pure
export function friendTableHasMinimumCandidates(compatibleCandidates: number, minimumInvitees: number): boolean {
  return compatibleCandidates >= minimumInvitees;
}

/** Story: Find time with familiar people or meet someone nearby / An unsuccessful starting member leaves the rest of the table candidates available (spec/friendsWeek.md) */
//@ pure
export function friendTableTriesNextStarter(tableReserved: boolean, startersLeft: number): boolean {
  return !tableReserved && startersLeft > 0;
}

/** Story: Find time with familiar people or meet someone nearby / An unsuccessful starting member leaves the rest of the table candidates available (spec/friendsWeek.md) */
//@ pure
export function lawFriendTableBelowMinimumIsRefused(compatibleCandidates: number, minimumInvitees: number): boolean {
  //@ ensures \result === true
  return !(compatibleCandidates < minimumInvitees) || !friendTableHasMinimumCandidates(compatibleCandidates, minimumInvitees);
}

/** Story: Find time with familiar people or meet someone nearby / An unsuccessful starting member leaves the rest of the table candidates available (spec/friendsWeek.md) */
//@ pure
export function lawFriendTableStopsAfterAReservedTable(startersLeft: number): boolean {
  //@ ensures \result === true
  return !friendTableTriesNextStarter(true, startersLeft);
}

/** Story: Find time with familiar people or meet someone nearby / An unsuccessful starting member leaves the rest of the table candidates available (spec/friendsWeek.md) */
//@ pure
export function lawFriendTableStopsWhenNoStarterIsLeft(tableReserved: boolean): boolean {
  //@ ensures \result === true
  return !friendTableTriesNextStarter(tableReserved, 0);
}

/** Story: Find time with familiar people or meet someone nearby / Activity partner reservations use a separate per-member allowance (spec/friendsWeek.md) */
//@ pure
export function partnerCount(s: FriendsRun, memberId: string): number {
  return lookup0_friendsWeek(s.partnerCounts, memberId, 0);
}

/** Story: Find time with familiar people or meet someone nearby / Activity partner reservations use a separate per-member allowance (spec/friendsWeek.md) */
//@ pure
export function canReservePartner(s: FriendsRun, pair: PartnerPair, limit: number): boolean {
  return s.phase === "PartnerIntros" && pair.first !== pair.second && partnerCount(s, pair.first) < limit && partnerCount(s, pair.second) < limit;
}

/** Story: Find time with familiar people or meet someone nearby / Activity partner reservations use a separate per-member allowance (spec/friendsWeek.md) */
//@ pure
export function reservePartner(s: FriendsRun, pair: PartnerPair, limit: number): FriendsRun {
  //@ ensures (inv(s) && canReservePartner(s, pair, limit)) ==> stepCompletedWeekStaysClosed(s, \result)
  return { ...s, partnerCounts: ({ ...({ ...s.partnerCounts, ["$" + pair.first]: exact_friendsWeek(partnerCount(s, pair.first) + 1) } as Record<string, number>), ["$" + pair.second]: exact_friendsWeek(partnerCount(s, pair.second) + 1) } as Record<string, number>) };
}

/** Story: Find time with familiar people or meet someone nearby / Activity partner reservations use a separate per-member allowance (spec/friendsWeek.md) */
//@ pure
export function sometimesPublishesAPartner(s: FriendsRun): boolean {
  return s.phase === "WeekComplete" && partnerCount(s, "one") > 0;
}

/** Story: Find time with familiar people or meet someone nearby / The simulator counts contact after a visible concern (spec/friendsWeek.md) */
//@ pure
export function friendAdversaryKnownAtProposal(visibleConcern: boolean, holdAlreadyInEffect: boolean): boolean {
  return visibleConcern || holdAlreadyInEffect;
}

/** Story: Find time with familiar people or meet someone nearby / The simulator counts contact after a visible concern (spec/friendsWeek.md) */
//@ pure
export function lawFriendExistingHoldMakesAdversaryKnown(visibleConcern: boolean): boolean {
  //@ ensures \result === true
  return friendAdversaryKnownAtProposal(visibleConcern, true);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: FriendsRun, event: Event): boolean {
  if (event.type === "beginCrewOffers") return canBeginCrewOffers(current);
  if (event.type === "beginRepeats") return canBeginRepeats(current);
  if (event.type === "beginNewPlans") return canBeginNewPlans(current);
  if (event.type === "beginPartners") return canBeginPartners(current);
  if (event.type === "finishWeek") return canFinishWeek(current);
  if (event.type === "reserveRecurring") return canReserveRecurring(current, event.kind, event.members);
  if (event.type === "reserveNewPlan") return canReserveNewPlan(current, event.invited, event.alternates, event.reserveAlternates);
  if (event.type === "reservePartner") return canReservePartner(current, event.pair, event.limit);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: FriendsRun, event: Event): FriendsRun {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "beginCrewOffers") return canBeginCrewOffers(current) ? beginCrewOffers(current) : current;
  if (event.type === "beginRepeats") return canBeginRepeats(current) ? beginRepeats(current) : current;
  if (event.type === "beginNewPlans") return canBeginNewPlans(current) ? beginNewPlans(current, event.spreadNew) : current;
  if (event.type === "beginPartners") return canBeginPartners(current) ? beginPartners(current) : current;
  if (event.type === "finishWeek") return canFinishWeek(current) ? finishWeek(current) : current;
  if (event.type === "reserveRecurring") return canReserveRecurring(current, event.kind, event.members) ? reserveRecurring(current, event.kind, event.members) : current;
  if (event.type === "reserveNewPlan") return canReserveNewPlan(current, event.invited, event.alternates, event.reserveAlternates) ? reserveNewPlan(current, event.invited, event.alternates, event.reserveAlternates) : current;
  if (event.type === "reservePartner") return canReservePartner(current, event.pair, event.limit) ? reservePartner(current, event.pair, event.limit) : current;
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
  const is_PartnerPair = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.first === "string" && typeof v.second === "string";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "beginCrewOffers") return { type: "beginCrewOffers" };
  if (raw.type === "beginRepeats") return { type: "beginRepeats" };
  if (raw.type === "beginNewPlans" && typeof raw.spreadNew === "boolean") return { type: "beginNewPlans", spreadNew: raw.spreadNew };
  if (raw.type === "beginPartners") return { type: "beginPartners" };
  if (raw.type === "finishWeek") return { type: "finishWeek" };
  if (raw.type === "reserveRecurring" && (raw.kind === "Session" || raw.kind === "Offer" || raw.kind === "Repeat") && Array.isArray(raw.members) && raw.members.every((x0: any) => typeof x0 === "string")) return { type: "reserveRecurring", kind: raw.kind, members: raw.members.map((x0: any) => x0) };
  if (raw.type === "reserveNewPlan" && Array.isArray(raw.invited) && raw.invited.every((x0: any) => typeof x0 === "string") && Array.isArray(raw.alternates) && raw.alternates.every((x0: any) => typeof x0 === "string") && typeof raw.reserveAlternates === "boolean") return { type: "reserveNewPlan", invited: raw.invited.map((x0: any) => x0), alternates: raw.alternates.map((x0: any) => x0), reserveAlternates: raw.reserveAlternates };
  if (raw.type === "reservePartner" && is_PartnerPair(raw.pair) && Number.isSafeInteger(raw.limit)) return { type: "reservePartner", pair: ({ first: raw.pair.first, second: raw.pair.second }), limit: raw.limit };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): FriendsRun | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "CrewSessions" || raw.phase === "CrewOffers" || raw.phase === "RepeatPlans" || raw.phase === "NewPlans" || raw.phase === "PartnerIntros" || raw.phase === "WeekComplete") && typeof raw.spreadNew === "boolean" && typeof raw.recurring === "object" && raw.recurring !== null && !Array.isArray(raw.recurring) && Object.entries(raw.recurring).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && typeof raw.newUsed === "object" && raw.newUsed !== null && !Array.isArray(raw.newUsed) && Object.entries(raw.newUsed).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && typeof raw.newInvited === "object" && raw.newInvited !== null && !Array.isArray(raw.newInvited) && Object.entries(raw.newInvited).every(([k1, x1]: [string, any]) => k1.startsWith("$") && typeof x1 === "boolean") && typeof raw.partnerCounts === "object" && raw.partnerCounts !== null && !Array.isArray(raw.partnerCounts) && Object.entries(raw.partnerCounts).every(([k1, x1]: [string, any]) => k1.startsWith("$") && Number.isSafeInteger(x1)) && Object.keys(raw).length === 6)) return undefined;
  const parsed: FriendsRun = ({ phase: raw.phase, spreadNew: raw.spreadNew, recurring: Object.fromEntries(Object.entries(raw.recurring).map(([k1, x1]: [string, any]) => [k1, x1])), newUsed: Object.fromEntries(Object.entries(raw.newUsed).map(([k1, x1]: [string, any]) => [k1, x1])), newInvited: Object.fromEntries(Object.entries(raw.newInvited).map(([k1, x1]: [string, any]) => [k1, x1])), partnerCounts: Object.fromEntries(Object.entries(raw.partnerCounts).map(([k1, x1]: [string, any]) => [k1, x1])) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): FriendsRun {
  //@ ensures inv(\result)
  return initial;
}

/** What a map holds for a key, or `otherwise` if it holds nothing for it. */
//@ pure
export function lookup0_friendsWeek(m: Record<string, number>, k: string, otherwise: number): number {
  const key = "$" + k;
  return key in m ? m[key] : otherwise;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_friendsWeek(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_friendsWeek(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_friendsWeek((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
