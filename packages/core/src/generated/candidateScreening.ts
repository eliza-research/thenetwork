// GENERATED from spec/candidateScreening.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Refuse an ineligible match before scoring it / Hard checks run in a fixed order (spec/candidateScreening.md:9) */
export type CheckPhase = "Duplicates" | "PackPre" | "Age" | "Intermediary" | "Members" | "Pairs" | "PackPost" | "Presence" | "Passed" | "Refused";
/** Story: Refuse an ineligible match before scoring it / Hard checks run in a fixed order (spec/candidateScreening.md:9) */
export interface Screening { phase: CheckPhase; refusal: string }

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordCheck"; checked: CheckPhase; reason: string };

/** Story: Refuse an ineligible match before scoring it / Hard checks run in a fixed order (spec/candidateScreening.md:9) */
export const initial: Screening = { phase: "Duplicates", refusal: "" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Screening): boolean {
  return alwaysRefusalHasReason(current);
}

/** Story: Refuse an ineligible match before scoring it / Hard checks run in a fixed order (spec/candidateScreening.md:9) */
//@ pure
export function nextPhase(phase: CheckPhase): CheckPhase {
  return phase === "Duplicates" ? "PackPre" : (phase === "PackPre" ? "Age" : (phase === "Age" ? "Intermediary" : (phase === "Intermediary" ? "Members" : (phase === "Members" ? "Pairs" : (phase === "Pairs" ? "PackPost" : (phase === "PackPost" ? "Presence" : "Passed"))))));
}

/** Story: Refuse an ineligible match before scoring it / Hard checks run in a fixed order (spec/candidateScreening.md:9) */
//@ pure
export function canRecordCheck(s: Screening, checked: CheckPhase): boolean {
  return s.phase === checked && s.phase !== "Passed" && s.phase !== "Refused";
}

/** Story: Refuse an ineligible match before scoring it / Hard checks run in a fixed order (spec/candidateScreening.md:9) */
//@ pure
export function recordCheck(s: Screening, checked: CheckPhase, reason: string): Screening {
  //@ ensures (inv(s) && canRecordCheck(s, checked)) ==> alwaysRefusalHasReason(\result)
  //@ ensures (inv(s) && canRecordCheck(s, checked)) ==> stepCompletedScreenStaysClosed(s, \result)
  //@ ensures (inv(s) && canRecordCheck(s, checked)) ==> stepPassedRequiresPresence(s, \result)
  return reason === "" ? ({ phase: nextPhase(s.phase), refusal: "" } as Screening) : ({ phase: "Refused", refusal: reason } as Screening);
}

/** Story: Refuse an ineligible match before scoring it / The first refusal ends screening (spec/candidateScreening.md:38) */
//@ pure
export function alwaysRefusalHasReason(s: Screening): boolean {
  return (s.phase === "Refused") === (s.refusal !== "");
}

/** Story: Refuse an ineligible match before scoring it / The first refusal ends screening (spec/candidateScreening.md:38) */
//@ pure
export function stepCompletedScreenStaysClosed(before: Screening, after: Screening): boolean {
  return !(before.phase === "Refused" || before.phase === "Passed") || (after.phase === before.phase && after.refusal === before.refusal);
}

/** Story: Refuse an ineligible match before scoring it / The first refusal ends screening (spec/candidateScreening.md:38) */
//@ pure
export function stepPassedRequiresPresence(before: Screening, after: Screening): boolean {
  return !(after.phase === "Passed" && before.phase !== "Passed") || before.phase === "Presence";
}

/** Story: Refuse an ineligible match before scoring it / The first refusal ends screening (spec/candidateScreening.md:38) */
//@ pure
export function sometimesPassed(s: Screening): boolean {
  return s.phase === "Passed";
}

/** Story: Refuse an ineligible match before scoring it / The first refusal ends screening (spec/candidateScreening.md:38) */
//@ pure
export function sometimesRefused(s: Screening): boolean {
  return s.phase === "Refused";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Screening, event: Event): boolean {
  if (event.type === "recordCheck") return canRecordCheck(current, event.checked);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Screening, event: Event): Screening {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordCheck" && canRecordCheck(current, event.checked)) return recordCheck(current, event.checked, event.reason);
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
  if (raw.type === "recordCheck" && (raw.checked === "Duplicates" || raw.checked === "PackPre" || raw.checked === "Age" || raw.checked === "Intermediary" || raw.checked === "Members" || raw.checked === "Pairs" || raw.checked === "PackPost" || raw.checked === "Presence" || raw.checked === "Passed" || raw.checked === "Refused") && typeof raw.reason === "string") return { type: "recordCheck", checked: raw.checked, reason: raw.reason };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): Screening | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Duplicates" || raw.phase === "PackPre" || raw.phase === "Age" || raw.phase === "Intermediary" || raw.phase === "Members" || raw.phase === "Pairs" || raw.phase === "PackPost" || raw.phase === "Presence" || raw.phase === "Passed" || raw.phase === "Refused") && typeof raw.refusal === "string" && Object.keys(raw).length === 2)) return undefined;
  const parsed: Screening = ({ phase: raw.phase, refusal: raw.refusal });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Screening {
  //@ ensures inv(\result)
  return initial;
}
