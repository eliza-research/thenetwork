// GENERATED from spec/travelPresenceJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type PresenceWindow as travelPresence_PresenceWindow, type TravelEntry as travelPresence_TravelEntry, type TravelDestinationCorrection as travelPresence_TravelDestinationCorrection, presenceWindowValid as travelPresence_presenceWindowValid, presenceWindowCurrentOrFuture as travelPresence_presenceWindowCurrentOrFuture, lawTripLeavesSnapshotAtItsEnd as travelPresence_lawTripLeavesSnapshotAtItsEnd, presenceWindowContains as travelPresence_presenceWindowContains, presenceWindowsOverlap as travelPresence_presenceWindowsOverlap, presenceWindowCovers as travelPresence_presenceWindowCovers, lawTripEndsExclusively as travelPresence_lawTripEndsExclusively, lawCoveringTripSharesTime as travelPresence_lawCoveringTripSharesTime, meetingAreaInterval as travelPresence_meetingAreaInterval, lawMeetingAreaNeedsStrictOverlap as travelPresence_lawMeetingAreaNeedsStrictOverlap, travelEntryReplyAllowed as travelPresence_travelEntryReplyAllowed, samePresenceWindow as travelPresence_samePresenceWindow, decideTravelEntry as travelPresence_decideTravelEntry, lawUnavailableTravelNeverSaves as travelPresence_lawUnavailableTravelNeverSaves, lawRepeatedTravelDoesNotSave as travelPresence_lawRepeatedTravelDoesNotSave, decideTravelDestinationCorrection as travelPresence_decideTravelDestinationCorrection, lawDestinationCorrectionReplacesOneOnlyWhenSaved as travelPresence_lawDestinationCorrectionReplacesOneOnlyWhenSaved, lawUnauthorizedDestinationCorrectionChangesNothing as travelPresence_lawUnauthorizedDestinationCorrectionChangesNothing, lawDestinationCorrectionNeedsDatesWhenEnded as travelPresence_lawDestinationCorrectionNeedsDatesWhenEnded, lawDestinationCorrectionConflictChangesNothing as travelPresence_lawDestinationCorrectionConflictChangesNothing } from "./travelPresence.ts";

/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
export type TravelCity = "SanFrancisco" | "LosAngeles";
/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
export type SavedTrip = "NoTrip" | "SanFranciscoTrip" | "LosAngelesTrip";
/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
export type TravelEffect = "TripSaved" | "TripAlreadySaved" | "DatesNeeded" | "DatesConflict" | "NoTravelReply" | "SaveReplayed" | "ReplayRefused";
/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
export interface TravelPresenceJourney { activeFriends: boolean; activeSlop: boolean; reachedEnd: boolean; trip: SavedTrip; hasSaveToRetry: boolean; visibleForMatching: boolean; slopTripCount: number }
/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
export interface TravelStep { state: TravelPresenceJourney; out: TravelEffect[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "declareTrip"; city: TravelCity; hasDates: boolean }
  | { type: "reachTripEnd" }
  | { type: "retryTripSave" }
  | { type: "leaveTravelApp" };

/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
export const initial: TravelPresenceJourney = { activeFriends: true, activeSlop: true, reachedEnd: false, trip: "NoTrip", hasSaveToRetry: false, visibleForMatching: false, slopTripCount: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: TravelPresenceJourney): boolean {
  return alwaysOnlyFriendsOwnsTheTrip(current) && alwaysMatchingUsesTheLiveTrip(current);
}

/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
//@ pure
export function stayIn(city: TravelCity): SavedTrip {
  return city === "SanFrancisco" ? "SanFranciscoTrip" : "LosAngelesTrip";
}

/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
//@ pure
export function canDeclareTrip(s: TravelPresenceJourney, city: TravelCity, hasDates: boolean): boolean {
  return true;
}

/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
//@ pure
export function declareTrip(s: TravelPresenceJourney, city: TravelCity, hasDates: boolean): TravelStep {
  //@ ensures (inv(s) && canDeclareTrip(s, city, hasDates)) ==> alwaysOnlyFriendsOwnsTheTrip(\result.state)
  //@ ensures (inv(s) && canDeclareTrip(s, city, hasDates)) ==> alwaysMatchingUsesTheLiveTrip(\result.state)
  const local_0: SavedTrip = stayIn(city);
  const local_1: travelPresence_TravelEntry = travelPresence_decideTravelEntry(s.activeFriends, hasDates, ({ from: 0, to: 1 } as travelPresence_PresenceWindow), s.reachedEnd ? 1 : 0, s.trip !== "NoTrip" && s.trip !== local_0, s.trip === local_0);
  return local_1 === "TravelSave" ? ({ state: ({ ...s, trip: local_0, hasSaveToRetry: true, visibleForMatching: true } as TravelPresenceJourney), out: (["TripSaved"] as TravelEffect[]) } as TravelStep) : ({ state: s, out: ([local_1 === "TravelAlreadySaved" ? "TripAlreadySaved" : (local_1 === "TravelNeedsDates" ? "DatesNeeded" : (local_1 === "TravelDateConflict" ? "DatesConflict" : "NoTravelReply"))] as TravelEffect[]) } as TravelStep);
}

/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
//@ pure
export function alwaysOnlyFriendsOwnsTheTrip(s: TravelPresenceJourney): boolean {
  return s.activeSlop && s.slopTripCount === 0 && (!(s.trip !== "NoTrip") || s.activeFriends);
}

/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
//@ pure
export function sometimesSavesSanFrancisco(s: TravelPresenceJourney): boolean {
  return s.trip === "SanFranciscoTrip";
}

/** Story: Keep my travel dates in the app that owns them / A new statement can save one trip in Friends (spec/travelPresenceJourney.md) */
//@ pure
export function sometimesSavesLosAngeles(s: TravelPresenceJourney): boolean {
  return s.trip === "LosAngelesTrip";
}

/** Story: Keep my travel dates in the app that owns them / The matching snapshot loses the trip at its exclusive end (spec/travelPresenceJourney.md) */
//@ pure
export function canReachTripEnd(s: TravelPresenceJourney): boolean {
  return true;
}

/** Story: Keep my travel dates in the app that owns them / The matching snapshot loses the trip at its exclusive end (spec/travelPresenceJourney.md) */
//@ pure
export function reachTripEnd(s: TravelPresenceJourney): TravelStep {
  //@ ensures (inv(s) && canReachTripEnd(s)) ==> alwaysOnlyFriendsOwnsTheTrip(\result.state)
  //@ ensures (inv(s) && canReachTripEnd(s)) ==> alwaysMatchingUsesTheLiveTrip(\result.state)
  return { state: ({ ...s, reachedEnd: true, visibleForMatching: false } as TravelPresenceJourney), out: ([] as TravelEffect[]) };
}

/** Story: Keep my travel dates in the app that owns them / The matching snapshot loses the trip at its exclusive end (spec/travelPresenceJourney.md) */
//@ pure
export function canRetryTripSave(s: TravelPresenceJourney): boolean {
  return s.hasSaveToRetry;
}

/** Story: Keep my travel dates in the app that owns them / The matching snapshot loses the trip at its exclusive end (spec/travelPresenceJourney.md) */
//@ pure
export function retryTripSave(s: TravelPresenceJourney): TravelStep {
  //@ ensures (inv(s) && canRetryTripSave(s)) ==> alwaysOnlyFriendsOwnsTheTrip(\result.state)
  //@ ensures (inv(s) && canRetryTripSave(s)) ==> alwaysMatchingUsesTheLiveTrip(\result.state)
  return { state: s, out: ([s.activeFriends ? "SaveReplayed" : "ReplayRefused"] as TravelEffect[]) };
}

/** Story: Keep my travel dates in the app that owns them / The matching snapshot loses the trip at its exclusive end (spec/travelPresenceJourney.md) */
//@ pure
export function alwaysMatchingUsesTheLiveTrip(s: TravelPresenceJourney): boolean {
  return s.visibleForMatching === (s.trip !== "NoTrip" && !s.reachedEnd);
}

/** Story: Keep my travel dates in the app that owns them / The matching snapshot loses the trip at its exclusive end (spec/travelPresenceJourney.md) */
//@ pure
export function sometimesTheSavedTripExpires(s: TravelPresenceJourney): boolean {
  return s.trip !== "NoTrip" && s.reachedEnd;
}

/** Story: Keep my travel dates in the app that owns them / Leaving Friends removes the trip and retires its saved reply (spec/travelPresenceJourney.md) */
//@ pure
export function canLeaveTravelApp(s: TravelPresenceJourney): boolean {
  return true;
}

/** Story: Keep my travel dates in the app that owns them / Leaving Friends removes the trip and retires its saved reply (spec/travelPresenceJourney.md) */
//@ pure
export function leaveTravelApp(s: TravelPresenceJourney): TravelStep {
  //@ ensures (inv(s) && canLeaveTravelApp(s)) ==> alwaysOnlyFriendsOwnsTheTrip(\result.state)
  //@ ensures (inv(s) && canLeaveTravelApp(s)) ==> alwaysMatchingUsesTheLiveTrip(\result.state)
  return { state: ({ ...s, activeFriends: false, trip: "NoTrip", visibleForMatching: false } as TravelPresenceJourney), out: ([] as TravelEffect[]) };
}

/** Story: Keep my travel dates in the app that owns them / Leaving Friends removes the trip and retires its saved reply (spec/travelPresenceJourney.md) */
//@ pure
export function sometimesLeavesAfterSaving(s: TravelPresenceJourney): boolean {
  return s.hasSaveToRetry && !s.activeFriends;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: TravelPresenceJourney, event: Event): boolean {
  if (event.type === "declareTrip") return canDeclareTrip(current, event.city, event.hasDates);
  if (event.type === "reachTripEnd") return canReachTripEnd(current);
  if (event.type === "retryTripSave") return canRetryTripSave(current);
  if (event.type === "leaveTravelApp") return canLeaveTravelApp(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: TravelPresenceJourney, event: Event): TravelStep {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "declareTrip") return canDeclareTrip(current, event.city, event.hasDates) ? declareTrip(current, event.city, event.hasDates) : { state: current, out: ([] as TravelEffect[]) };
  if (event.type === "reachTripEnd") return canReachTripEnd(current) ? reachTripEnd(current) : { state: current, out: ([] as TravelEffect[]) };
  if (event.type === "retryTripSave") return canRetryTripSave(current) ? retryTripSave(current) : { state: current, out: ([] as TravelEffect[]) };
  if (event.type === "leaveTravelApp") return canLeaveTravelApp(current) ? leaveTravelApp(current) : { state: current, out: ([] as TravelEffect[]) };
  return { state: current, out: ([] as TravelEffect[]) };
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
  if (raw.type === "declareTrip" && (raw.city === "SanFrancisco" || raw.city === "LosAngeles") && typeof raw.hasDates === "boolean") return { type: "declareTrip", city: raw.city, hasDates: raw.hasDates };
  if (raw.type === "reachTripEnd") return { type: "reachTripEnd" };
  if (raw.type === "retryTripSave") return { type: "retryTripSave" };
  if (raw.type === "leaveTravelApp") return { type: "leaveTravelApp" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): TravelPresenceJourney | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.activeFriends === "boolean" && typeof raw.activeSlop === "boolean" && typeof raw.reachedEnd === "boolean" && (raw.trip === "NoTrip" || raw.trip === "SanFranciscoTrip" || raw.trip === "LosAngelesTrip") && typeof raw.hasSaveToRetry === "boolean" && typeof raw.visibleForMatching === "boolean" && Number.isSafeInteger(raw.slopTripCount) && Object.keys(raw).length === 7)) return undefined;
  const parsed: TravelPresenceJourney = ({ activeFriends: raw.activeFriends, activeSlop: raw.activeSlop, reachedEnd: raw.reachedEnd, trip: raw.trip, hasSaveToRetry: raw.hasSaveToRetry, visibleForMatching: raw.visibleForMatching, slopTripCount: raw.slopTripCount });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): TravelPresenceJourney {
  //@ ensures inv(\result)
  return initial;
}
