// GENERATED from spec/sharedLineConsentJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { appOptInBeatsStop as carrierConsent_appOptInBeatsStop, lawStopWinsATie as carrierConsent_lawStopWinsATie, appMayText as carrierConsent_appMayText, lawNoAppOptInMeansNoPermission as carrierConsent_lawNoAppOptInMeansNoPermission } from "./carrierConsent.ts";

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md:15) */
export type ConsentUpdate = "AllOptedOut" | "SlopOptedIn" | "FriendsOptedIn";
/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md:15) */
export interface LineConsent { slopMayText: boolean; friendsMayText: boolean }
/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md:15) */
export type AppUnderObservation = "Slop" | "Friends";
/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md:15) */
export interface Turn { state: LineConsent; out: ConsentUpdate[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "textStop" }
  | { type: "textStart"; app: AppUnderObservation; sentWithLastStop: boolean };

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md:15) */
export const initial: LineConsent = { slopMayText: true, friendsMayText: true };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: LineConsent): boolean {
  return true;
}

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md:15) */
//@ pure
export function stopCoversEveryApp(explicitAll: boolean, sharedLine: boolean, dedicatedLineGlobal: boolean): boolean {
  return explicitAll || sharedLine || dedicatedLineGlobal;
}

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md:15) */
//@ pure
export function canTextStop(s: LineConsent): boolean {
  return true;
}

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md:15) */
//@ pure
export function sometimesBothAppsStop(s: LineConsent): boolean {
  return !s.slopMayText && !s.friendsMayText;
}

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md:15) */
//@ pure
export function textStop(s: LineConsent): Turn {
  //@ ensures (inv(s) && canTextStop(s)) ==> stepOneTextCannotRestoreBoth(s, \result.state)
  return { state: ({ slopMayText: false, friendsMayText: false } as LineConsent), out: ["AllOptedOut"] };
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md:43) */
//@ pure
export function canTextStart(s: LineConsent, app: AppUnderObservation, sentWithLastStop: boolean): boolean {
  return true;
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md:43) */
//@ pure
export function sometimesOnlySlopResumes(s: LineConsent): boolean {
  return s.slopMayText && !s.friendsMayText;
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md:43) */
//@ pure
export function sometimesOnlyFriendsResumes(s: LineConsent): boolean {
  return s.friendsMayText && !s.slopMayText;
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md:43) */
//@ pure
export function stepOneTextCannotRestoreBoth(before: LineConsent, after: LineConsent): boolean {
  return !(!before.slopMayText && !before.friendsMayText) || !(after.slopMayText && after.friendsMayText);
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md:43) */
//@ pure
export function mayTextAfterStart(alreadyAllowed: boolean, sentWithLastStop: boolean): boolean {
  return alreadyAllowed || carrierConsent_appMayText(true, true, sentWithLastStop ? 0 : 1, 0);
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md:43) */
//@ pure
export function textStart(s: LineConsent, app: AppUnderObservation, sentWithLastStop: boolean): Turn {
  //@ ensures (inv(s) && canTextStart(s, app, sentWithLastStop)) ==> stepOneTextCannotRestoreBoth(s, \result.state)
  const local_0 = mayTextAfterStart(app === "Slop" ? s.slopMayText : s.friendsMayText, sentWithLastStop);
  return { state: app === "Slop" ? ({ ...s, slopMayText: local_0 } as LineConsent) : ({ ...s, friendsMayText: local_0 } as LineConsent), out: local_0 ? [app === "Slop" ? "SlopOptedIn" : "FriendsOptedIn"] : ([] as ConsentUpdate[]) };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: LineConsent, event: Event): boolean {
  if (event.type === "textStop") return canTextStop(current);
  if (event.type === "textStart") return canTextStart(current, event.app, event.sentWithLastStop);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: LineConsent, event: Event): Turn {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "textStop" && canTextStop(current)) return textStop(current);
  if (event.type === "textStart" && canTextStart(current, event.app, event.sentWithLastStop)) return textStart(current, event.app, event.sentWithLastStop);
  return { state: current, out: ([] as ConsentUpdate[]) };
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
  if (raw.type === "textStop") return { type: "textStop" };
  if (raw.type === "textStart" && (raw.app === "Slop" || raw.app === "Friends") && typeof raw.sentWithLastStop === "boolean") return { type: "textStart", app: raw.app, sentWithLastStop: raw.sentWithLastStop };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): LineConsent | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.slopMayText === "boolean" && typeof raw.friendsMayText === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: LineConsent = ({ slopMayText: raw.slopMayText, friendsMayText: raw.friendsMayText });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): LineConsent {
  //@ ensures inv(\result)
  return initial;
}
