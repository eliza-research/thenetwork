// GENERATED from spec/travelPresence.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use my travel dates for matching / A temporary presence needs both dates in order (spec/travelPresence.md) */
export interface PresenceWindow { from: number; to: number }
/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md) */
export type TravelEntry = "TravelUnavailable" | "TravelNeedsDates" | "TravelDateConflict" | "TravelAlreadySaved" | "TravelSave";
/** Story: Tell the Network my travel dates / A signed destination correction replaces one saved trip (spec/travelPresence.md) */
export type TravelDestinationCorrection = "TravelCorrectUnavailable" | "TravelCorrectNone" | "TravelCorrectNeedsDates" | "TravelCorrectConflict" | "TravelCorrectOne";


/** Story: Use my travel dates for matching / A temporary presence needs both dates in order (spec/travelPresence.md) */
//@ pure
export function presenceWindowValid(window: PresenceWindow): boolean {
  return window.from < window.to;
}

/** Story: Use my travel dates for matching / A temporary presence needs both dates in order (spec/travelPresence.md) */
//@ pure
export function presenceWindowCurrentOrFuture(window: PresenceWindow, now: number): boolean {
  return presenceWindowValid(window) && now < window.to;
}

/** Story: Use my travel dates for matching / A temporary presence needs both dates in order (spec/travelPresence.md) */
//@ pure
export function lawTripLeavesSnapshotAtItsEnd(window: PresenceWindow): boolean {
  //@ ensures \result === true
  return !presenceWindowCurrentOrFuture(window, window.to);
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md) */
//@ pure
export function presenceWindowContains(window: PresenceWindow, at: number): boolean {
  return window.from <= at && at < window.to;
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md) */
//@ pure
export function presenceWindowsOverlap(first: PresenceWindow, second: PresenceWindow): boolean {
  return presenceWindowValid(first) && presenceWindowValid(second) && first.from < second.to && second.from < first.to;
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md) */
//@ pure
export function presenceWindowCovers(presence: PresenceWindow, requested: PresenceWindow): boolean {
  return presenceWindowValid(presence) && presenceWindowValid(requested) && presence.from <= requested.from && requested.to <= presence.to;
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md) */
//@ pure
export function lawTripEndsExclusively(window: PresenceWindow): boolean {
  //@ ensures \result === true
  return !presenceWindowContains(window, window.to);
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md) */
//@ pure
export function lawCoveringTripSharesTime(window: PresenceWindow, requested: PresenceWindow): boolean {
  //@ ensures \result === true
  return !presenceWindowCovers(window, requested) || presenceWindowsOverlap(window, requested);
}

/** Story: Use my travel dates for matching / Shared areas lower cost only during the meeting window (spec/travelPresence.md) */
//@ pure
export function meetingAreaInterval(presence: PresenceWindow, requested: PresenceWindow): PresenceWindow {
  return { from: presence.from > requested.from ? presence.from : requested.from, to: presence.to < requested.to ? presence.to : requested.to };
}

/** Story: Use my travel dates for matching / Shared areas lower cost only during the meeting window (spec/travelPresence.md) */
//@ pure
export function lawMeetingAreaNeedsStrictOverlap(presence: PresenceWindow, requested: PresenceWindow): boolean {
  //@ ensures \result === true
  return presenceWindowValid(meetingAreaInterval(presence, requested)) === presenceWindowsOverlap(presence, requested);
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md) */
//@ pure
export function travelEntryReplyAllowed(canonicalMember: boolean, activeMemberRow: boolean): boolean {
  return canonicalMember && activeMemberRow;
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md) */
//@ pure
export function samePresenceWindow(first: PresenceWindow, second: PresenceWindow): boolean {
  return first.from === second.from && first.to === second.to;
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md) */
//@ pure
export function decideTravelEntry(authorized: boolean, hasDates: boolean, window: PresenceWindow, now: number, conflict: boolean, saved: boolean): TravelEntry {
  return !authorized ? "TravelUnavailable" : (!hasDates || !presenceWindowCurrentOrFuture(window, now) ? "TravelNeedsDates" : (conflict ? "TravelDateConflict" : (saved ? "TravelAlreadySaved" : "TravelSave")));
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md) */
//@ pure
export function lawUnavailableTravelNeverSaves(hasDates: boolean, window: PresenceWindow, now: number, conflict: boolean, saved: boolean): boolean {
  //@ ensures \result === true
  return decideTravelEntry(false, hasDates, window, now, conflict, saved) === "TravelUnavailable";
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md) */
//@ pure
export function lawRepeatedTravelDoesNotSave(window: PresenceWindow, now: number, conflict: boolean): boolean {
  //@ ensures \result === true
  return decideTravelEntry(true, true, window, now, conflict, true) !== "TravelSave";
}

/** Story: Tell the Network my travel dates / A signed destination correction replaces one saved trip (spec/travelPresence.md) */
//@ pure
export function decideTravelDestinationCorrection(authorized: boolean, savedTrips: number, window: PresenceWindow, now: number, conflict: boolean): TravelDestinationCorrection {
  return !authorized ? "TravelCorrectUnavailable" : (savedTrips === 0 ? "TravelCorrectNone" : (!presenceWindowCurrentOrFuture(window, now) ? "TravelCorrectNeedsDates" : (conflict ? "TravelCorrectConflict" : "TravelCorrectOne")));
}

/** Story: Tell the Network my travel dates / A signed destination correction replaces one saved trip (spec/travelPresence.md) */
//@ pure
export function lawDestinationCorrectionReplacesOneOnlyWhenSaved(authorized: boolean, savedTrips: number, window: PresenceWindow, now: number, conflict: boolean): boolean {
  //@ ensures \result === true
  return !(decideTravelDestinationCorrection(authorized, savedTrips, window, now, conflict) === "TravelCorrectOne") || (authorized && savedTrips > 0 && presenceWindowCurrentOrFuture(window, now) && !conflict);
}

/** Story: Tell the Network my travel dates / A signed destination correction replaces one saved trip (spec/travelPresence.md) */
//@ pure
export function lawUnauthorizedDestinationCorrectionChangesNothing(savedTrips: number, window: PresenceWindow, now: number, conflict: boolean): boolean {
  //@ ensures \result === true
  return decideTravelDestinationCorrection(false, savedTrips, window, now, conflict) === "TravelCorrectUnavailable";
}

/** Story: Tell the Network my travel dates / A signed destination correction replaces one saved trip (spec/travelPresence.md) */
//@ pure
export function lawDestinationCorrectionNeedsDatesWhenEnded(savedTrips: number, window: PresenceWindow, now: number, conflict: boolean): boolean {
  //@ ensures \result === true
  return !(savedTrips > 0 && !presenceWindowCurrentOrFuture(window, now)) || decideTravelDestinationCorrection(true, savedTrips, window, now, conflict) === "TravelCorrectNeedsDates";
}

/** Story: Tell the Network my travel dates / A signed destination correction replaces one saved trip (spec/travelPresence.md) */
//@ pure
export function lawDestinationCorrectionConflictChangesNothing(savedTrips: number, window: PresenceWindow, now: number): boolean {
  //@ ensures \result === true
  return !(savedTrips > 0 && presenceWindowCurrentOrFuture(window, now)) || decideTravelDestinationCorrection(true, savedTrips, window, now, true) === "TravelCorrectConflict";
}
