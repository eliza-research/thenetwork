// GENERATED from spec/savedProfileJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: See only my saved profile for the app I use / A read returns only this member's current profile for the requested app (spec/savedProfileJourney.md:14) */
export type ProfileReadKind = "ReadOwn" | "ReadSomeoneElse" | "ReadOnOtherLine";
/** Story: See only my saved profile for the app I use / A read returns only this member's current profile for the requested app (spec/savedProfileJourney.md:14) */
export type ProfileApp = "Slop" | "Friends";
/** Story: See only my saved profile for the app I use / A read returns only this member's current profile for the requested app (spec/savedProfileJourney.md:14) */
export type ProfileShown = "SlopProfile" | "FriendsProfile";
/** Story: See only my saved profile for the app I use / A read returns only this member's current profile for the requested app (spec/savedProfileJourney.md:14) */
export interface ProfileMemberships { inSlop: boolean; inFriends: boolean }
/** Story: See only my saved profile for the app I use / A read returns only this member's current profile for the requested app (spec/savedProfileJourney.md:14) */
export interface ProfileTurn { state: ProfileMemberships; out: ProfileShown[] }
/** Story: See only my saved profile for the app I use / A displayed profile uses the saved location and the signed-turn size limit (spec/savedProfileJourney.md:55) */
export type LocationLabel = "NeighborhoodLabel" | "BayAreaLabel" | "NewYorkLabel" | "NoLocationLabel";

/** One variant per transition in the spec. */
export type Event =
  | { type: "readProfile"; app: ProfileApp; kind: ProfileReadKind }
  | { type: "leaveProfileApp"; app: ProfileApp };

/** Story: See only my saved profile for the app I use / A displayed profile uses the saved location and the signed-turn size limit (spec/savedProfileJourney.md:55) */
export const savedProfileReplyLimit: number = 1600;
/** Story: See only my saved profile for the app I use / A read returns only this member's current profile for the requested app (spec/savedProfileJourney.md:14) */
export const initial: ProfileMemberships = { inSlop: true, inFriends: true };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ProfileMemberships): boolean {
  return true;
}

/** Story: See only my saved profile for the app I use / A read returns only this member's current profile for the requested app (spec/savedProfileJourney.md:14) */
//@ pure
export function stepReadingKeepsMemberships(before: ProfileMemberships, via: string, after: ProfileMemberships): boolean {
  return !(via === "readProfile") || equal_savedProfileJourney(after, before);
}

/** Story: See only my saved profile for the app I use / A read returns only this member's current profile for the requested app (spec/savedProfileJourney.md:14) */
//@ pure
export function canReadProfile(s: ProfileMemberships, app: ProfileApp, kind: ProfileReadKind): boolean {
  return true;
}

/** Story: See only my saved profile for the app I use / A read returns only this member's current profile for the requested app (spec/savedProfileJourney.md:14) */
//@ pure
export function readProfile(s: ProfileMemberships, app: ProfileApp, kind: ProfileReadKind): ProfileTurn {
  //@ ensures (inv(s) && canReadProfile(s, app, kind)) ==> stepReadingKeepsMemberships(s, "readProfile", \result.state)
  const local_0 = app === "Slop" ? s.inSlop : s.inFriends;
  return { state: s, out: kind === "ReadOwn" && local_0 ? ([app === "Slop" ? "SlopProfile" : "FriendsProfile"] as ProfileShown[]) : ([] as ProfileShown[]) };
}

/** Story: See only my saved profile for the app I use / An app leave removes that app's profile from later reads (spec/savedProfileJourney.md:40) */
//@ pure
export function canLeaveProfileApp(s: ProfileMemberships, app: ProfileApp): boolean {
  return true;
}

/** Story: See only my saved profile for the app I use / An app leave removes that app's profile from later reads (spec/savedProfileJourney.md:40) */
//@ pure
export function sometimesKeepsOnlySlop(s: ProfileMemberships): boolean {
  return s.inSlop && !s.inFriends;
}

/** Story: See only my saved profile for the app I use / An app leave removes that app's profile from later reads (spec/savedProfileJourney.md:40) */
//@ pure
export function sometimesKeepsOnlyFriends(s: ProfileMemberships): boolean {
  return s.inFriends && !s.inSlop;
}

/** Story: See only my saved profile for the app I use / An app leave removes that app's profile from later reads (spec/savedProfileJourney.md:40) */
//@ pure
export function sometimesLeavesBothApps(s: ProfileMemberships): boolean {
  return !s.inFriends && !s.inSlop;
}

/** Story: See only my saved profile for the app I use / An app leave removes that app's profile from later reads (spec/savedProfileJourney.md:40) */
//@ pure
export function leaveProfileApp(s: ProfileMemberships, app: ProfileApp): ProfileTurn {
  //@ ensures (inv(s) && canLeaveProfileApp(s, app)) ==> stepReadingKeepsMemberships(s, "leaveProfileApp", \result.state)
  return { state: app === "Slop" ? ({ ...s, inSlop: false } as ProfileMemberships) : ({ ...s, inFriends: false } as ProfileMemberships), out: ([] as ProfileShown[]) };
}

/** Story: See only my saved profile for the app I use / A displayed profile uses the saved location and the signed-turn size limit (spec/savedProfileJourney.md:55) */
//@ pure
export function savedProfileFitsReply(units: number): boolean {
  return units <= savedProfileReplyLimit;
}

/** Story: See only my saved profile for the app I use / A displayed profile uses the saved location and the signed-turn size limit (spec/savedProfileJourney.md:55) */
//@ pure
export function savedProfileLocation(hasNeighborhood: boolean, homeCity: string): LocationLabel {
  return hasNeighborhood ? "NeighborhoodLabel" : (homeCity === "sf" ? "BayAreaLabel" : (homeCity === "nyc" ? "NewYorkLabel" : "NoLocationLabel"));
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ProfileMemberships, event: Event): boolean {
  if (event.type === "readProfile") return canReadProfile(current, event.app, event.kind);
  if (event.type === "leaveProfileApp") return canLeaveProfileApp(current, event.app);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: ProfileMemberships, event: Event): ProfileTurn {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "readProfile" && canReadProfile(current, event.app, event.kind)) return readProfile(current, event.app, event.kind);
  if (event.type === "leaveProfileApp" && canLeaveProfileApp(current, event.app)) return leaveProfileApp(current, event.app);
  return { state: current, out: ([] as ProfileShown[]) };
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
  if (raw.type === "readProfile" && (raw.app === "Slop" || raw.app === "Friends") && (raw.kind === "ReadOwn" || raw.kind === "ReadSomeoneElse" || raw.kind === "ReadOnOtherLine")) return { type: "readProfile", app: raw.app, kind: raw.kind };
  if (raw.type === "leaveProfileApp" && (raw.app === "Slop" || raw.app === "Friends")) return { type: "leaveProfileApp", app: raw.app };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ProfileMemberships | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.inSlop === "boolean" && typeof raw.inFriends === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: ProfileMemberships = ({ inSlop: raw.inSlop, inFriends: raw.inFriends });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ProfileMemberships {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_savedProfileJourney(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_savedProfileJourney((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
