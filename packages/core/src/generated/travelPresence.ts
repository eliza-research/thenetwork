// GENERATED from spec/travelPresence.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use my travel dates for matching / A temporary presence needs both dates in order (spec/travelPresence.md:9) */
export interface PresenceWindow { from: number; to: number }
/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md:55) */
export type TravelEntry = "TravelUnavailable" | "TravelNeedsDates" | "TravelDateConflict" | "TravelAlreadySaved" | "TravelSave";


/** Story: Use my travel dates for matching / A temporary presence needs both dates in order (spec/travelPresence.md:9) */
//@ pure
export function presenceWindowValid(window: PresenceWindow): boolean {
  return window.from < window.to;
}

/** Story: Use my travel dates for matching / A temporary presence needs both dates in order (spec/travelPresence.md:9) */
//@ pure
export function presenceWindowCurrentOrFuture(window: PresenceWindow, now: number): boolean {
  return presenceWindowValid(window) && now < window.to;
}

/** Story: Use my travel dates for matching / A temporary presence needs both dates in order (spec/travelPresence.md:9) */
//@ pure
export function lawTripLeavesSnapshotAtItsEnd(window: PresenceWindow): boolean {
  //@ ensures \result === true
  return !presenceWindowCurrentOrFuture(window, window.to);
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md:30) */
//@ pure
export function presenceWindowContains(window: PresenceWindow, at: number): boolean {
  return window.from <= at && at < window.to;
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md:30) */
//@ pure
export function presenceWindowsOverlap(first: PresenceWindow, second: PresenceWindow): boolean {
  return presenceWindowValid(first) && presenceWindowValid(second) && first.from < second.to && second.from < first.to;
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md:30) */
//@ pure
export function presenceWindowCovers(presence: PresenceWindow, requested: PresenceWindow): boolean {
  return presenceWindowValid(presence) && presenceWindowValid(requested) && presence.from <= requested.from && requested.to <= presence.to;
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md:30) */
//@ pure
export function lawTripEndsExclusively(window: PresenceWindow): boolean {
  //@ ensures \result === true
  return !presenceWindowContains(window, window.to);
}

/** Story: Use my travel dates for matching / City presence starts inclusively and ends exclusively (spec/travelPresence.md:30) */
//@ pure
export function lawCoveringTripSharesTime(window: PresenceWindow, requested: PresenceWindow): boolean {
  //@ ensures \result === true
  return !presenceWindowCovers(window, requested) || presenceWindowsOverlap(window, requested);
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md:55) */
//@ pure
export function travelEntryReplyAllowed(canonicalMember: boolean, activeMemberRow: boolean): boolean {
  return canonicalMember && activeMemberRow;
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md:55) */
//@ pure
export function samePresenceWindow(first: PresenceWindow, second: PresenceWindow): boolean {
  return first.from === second.from && first.to === second.to;
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md:55) */
//@ pure
export function decideTravelEntry(authorized: boolean, hasDates: boolean, window: PresenceWindow, now: number, conflict: boolean, saved: boolean): TravelEntry {
  return !authorized ? "TravelUnavailable" : (!hasDates || !presenceWindowCurrentOrFuture(window, now) ? "TravelNeedsDates" : (conflict ? "TravelDateConflict" : (saved ? "TravelAlreadySaved" : "TravelSave")));
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md:55) */
//@ pure
export function lawUnavailableTravelNeverSaves(hasDates: boolean, window: PresenceWindow, now: number, conflict: boolean, saved: boolean): boolean {
  //@ ensures \result === true
  return decideTravelEntry(false, hasDates, window, now, conflict, saved) === "TravelUnavailable";
}

/** Story: Tell the Network my travel dates / A signed travel statement saves only the member's own dates in that app (spec/travelPresence.md:55) */
//@ pure
export function lawRepeatedTravelDoesNotSave(window: PresenceWindow, now: number, conflict: boolean): boolean {
  //@ ensures \result === true
  return decideTravelEntry(true, true, window, now, conflict, true) !== "TravelSave";
}
