// GENERATED from spec/sharedLineConsentJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type StopConjunct as carrierConsent_StopConjunct, type CoordinatedStop as carrierConsent_CoordinatedStop, stopWordAllowsCourtesy as carrierConsent_stopWordAllowsCourtesy, lawCourtesyCannotTurnAmbiguousCommandsIntoStop as carrierConsent_lawCourtesyCannotTurnAmbiguousCommandsIntoStop, textRefusalStops as carrierConsent_textRefusalStops, lawBareTextRefusalNeedsPermanence as carrierConsent_lawBareTextRefusalNeedsPermanence, refusalStopsLine as carrierConsent_refusalStopsLine, lawTimeBoundedRefusalCannotStop as carrierConsent_lawTimeBoundedRefusalCannotStop, lawUnboundedRefusalStillStops as carrierConsent_lawUnboundedRefusalStillStops, sharedLineStopStatementStops as carrierConsent_sharedLineStopStatementStops, lawAnIndirectStopStatementCannotStop as carrierConsent_lawAnIndirectStopStatementCannotStop, lawARecognizedDirectStopStatementStops as carrierConsent_lawARecognizedDirectStopStatementStops, coordinatedStopClause as carrierConsent_coordinatedStopClause, lawIncompleteNegationDoesNotMakeASeparateStop as carrierConsent_lawIncompleteNegationDoesNotMakeASeparateStop, appOptInBeatsStop as carrierConsent_appOptInBeatsStop, lawStopWinsATie as carrierConsent_lawStopWinsATie, appMayText as carrierConsent_appMayText, lawNoAppOptInMeansNoPermission as carrierConsent_lawNoAppOptInMeansNoPermission, matchesSpokenAppDomain as carrierConsent_matchesSpokenAppDomain, lawArticleDoesNotTurnSpacedLabelIntoDomain as carrierConsent_lawArticleDoesNotTurnSpacedLabelIntoDomain } from "./carrierConsent.ts";

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md) */
export type AppUnderObservation = "Slop" | "Friends";
/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md) */
export type StopWording = "StopKeyword" | "StopTextsKeepCalls" | "QuitNow" | "EndPlease" | "StopTextsAnymore" | "SpanishCourtesyStop";
/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md) */
export type ConsentUpdate = "AllOptedOut" | "SlopOptedIn" | "FriendsOptedIn";
/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md) */
export interface LineConsent { slopMayText: boolean; friendsMayText: boolean }
/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md) */
export interface Turn { state: LineConsent; out: ConsentUpdate[] }
/** Story: Stop the shared line and resume one app / An ambiguous message leaves shared-line consent unchanged (spec/sharedLineConsentJourney.md) */
export type OtherWording = "CoordinatedNegation" | "AppNamedInClause" | "ReportedUnsubscribe" | "CancelPlease" | "TextsAboutOneCategory" | "TextsUntilAugust" | "SpanishCancelPlease" | "SpanishBajaNow";

/** One variant per transition in the spec. */
export type Event =
  | { type: "textStop"; wording: StopWording }
  | { type: "textOther"; other: OtherWording }
  | { type: "textStart"; app: AppUnderObservation; sentWithLastStop: boolean };

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md) */
export const initial: LineConsent = { slopMayText: true, friendsMayText: true };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: LineConsent): boolean {
  return true;
}

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md) */
//@ pure
export function canTextStop(s: LineConsent, wording: StopWording): boolean {
  return true;
}

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md) */
//@ pure
export function textStop(s: LineConsent, wording: StopWording): Turn {
  //@ ensures (inv(s) && canTextStop(s, wording)) ==> stepOneTextCannotRestoreBoth(s, \result.state)
  return { state: ({ slopMayText: false, friendsMayText: false } as LineConsent), out: (["AllOptedOut"] as ConsentUpdate[]) };
}

/** Story: Stop the shared line and resume one app / STOP on the shared line withdraws every app's permission (spec/sharedLineConsentJourney.md) */
//@ pure
export function sometimesBothAppsStop(s: LineConsent): boolean {
  return !s.slopMayText && !s.friendsMayText;
}

/** Story: Stop the shared line and resume one app / An ambiguous message leaves shared-line consent unchanged (spec/sharedLineConsentJourney.md) */
//@ pure
export function textOther(s: LineConsent, other: OtherWording): Turn {
  //@ ensures (inv(s)) ==> stepOneTextCannotRestoreBoth(s, \result.state)
  return { state: s, out: ([] as ConsentUpdate[]) };
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md) */
//@ pure
export function mayTextAfterStart(alreadyAllowed: boolean, sentWithLastStop: boolean): boolean {
  return alreadyAllowed || carrierConsent_appMayText(true, true, sentWithLastStop ? 0 : 1, 0);
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md) */
//@ pure
export function canTextStart(s: LineConsent, app: AppUnderObservation, sentWithLastStop: boolean): boolean {
  return true;
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md) */
//@ pure
export function textStart(s: LineConsent, app: AppUnderObservation, sentWithLastStop: boolean): Turn {
  //@ ensures (inv(s) && canTextStart(s, app, sentWithLastStop)) ==> stepOneTextCannotRestoreBoth(s, \result.state)
  const local_0 = mayTextAfterStart(app === "Slop" ? s.slopMayText : s.friendsMayText, sentWithLastStop);
  return { state: app === "Slop" ? ({ ...s, slopMayText: local_0 } as LineConsent) : ({ ...s, friendsMayText: local_0 } as LineConsent), out: local_0 ? ([app === "Slop" ? "SlopOptedIn" : "FriendsOptedIn"] as ConsentUpdate[]) : ([] as ConsentUpdate[]) };
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md) */
//@ pure
export function sometimesOnlySlopResumes(s: LineConsent): boolean {
  return s.slopMayText && !s.friendsMayText;
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md) */
//@ pure
export function sometimesOnlyFriendsResumes(s: LineConsent): boolean {
  return s.friendsMayText && !s.slopMayText;
}

/** Story: Stop the shared line and resume one app / A new START permits texts in the chosen app only (spec/sharedLineConsentJourney.md) */
//@ pure
export function stepOneTextCannotRestoreBoth(before: LineConsent, after: LineConsent): boolean {
  return !(!before.slopMayText && !before.friendsMayText) || !(after.slopMayText && after.friendsMayText);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: LineConsent, event: Event): boolean {
  if (event.type === "textStop") return canTextStop(current, event.wording);
  if (event.type === "textOther") return true;
  if (event.type === "textStart") return canTextStart(current, event.app, event.sentWithLastStop);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: LineConsent, event: Event): Turn {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "textStop") return canTextStop(current, event.wording) ? textStop(current, event.wording) : { state: current, out: ([] as ConsentUpdate[]) };
  if (event.type === "textOther") return textOther(current, event.other);
  if (event.type === "textStart") return canTextStart(current, event.app, event.sentWithLastStop) ? textStart(current, event.app, event.sentWithLastStop) : { state: current, out: ([] as ConsentUpdate[]) };
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
  if (raw.type === "textStop" && (raw.wording === "StopKeyword" || raw.wording === "StopTextsKeepCalls" || raw.wording === "QuitNow" || raw.wording === "EndPlease" || raw.wording === "StopTextsAnymore" || raw.wording === "SpanishCourtesyStop")) return { type: "textStop", wording: raw.wording };
  if (raw.type === "textOther" && (raw.other === "CoordinatedNegation" || raw.other === "AppNamedInClause" || raw.other === "ReportedUnsubscribe" || raw.other === "CancelPlease" || raw.other === "TextsAboutOneCategory" || raw.other === "TextsUntilAugust" || raw.other === "SpanishCancelPlease" || raw.other === "SpanishBajaNow")) return { type: "textOther", other: raw.other };
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
