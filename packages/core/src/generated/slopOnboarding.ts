// GENERATED from spec/slopOnboarding.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Review the information used for dating / Age restrictions stop dating onboarding before a prompt (spec/slopOnboarding.md:9) */
export type PromptPhase = "AwaitingProfile" | "Withheld" | "ReadbackOffered" | "QuestionSearch" | "ReadbackReady" | "QuestionReady" | "NoQuestion";
/** Story: Review the information used for dating / Age restrictions stop dating onboarding before a prompt (spec/slopOnboarding.md:9) */
export interface PromptRun { phase: PromptPhase; reason: string }
/** Story: Review the information used for dating / Ask the first missing field that can still be requested (spec/slopOnboarding.md:36) */
export interface QuestionFacts { ageMissing: boolean; genderMissing: boolean; seeksMissing: boolean; ageRangeMissing: boolean; distanceMissing: boolean; locationMissing: boolean; unknownZip: boolean; dealbreakersMissing: boolean; goalMissing: boolean; interestsMissing: boolean; activitiesMissing: boolean; freeMissing: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "resolveReadback"; textAvailable: boolean }
  | { type: "routeProfile"; restricted: boolean; wantsReadback: boolean }
  | { type: "chooseQuestion"; facts: QuestionFacts; unavailable: string[] };

/** Story: Review the information used for dating / Age restrictions stop dating onboarding before a prompt (spec/slopOnboarding.md:9) */
export const readbackReason: string = "slop_readback";
/** Story: Review the information used for dating / Age restrictions stop dating onboarding before a prompt (spec/slopOnboarding.md:9) */
export const initial: PromptRun = { phase: "AwaitingProfile", reason: "" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PromptRun): boolean {
  return alwaysReadyHasReason(current);
}

/** Story: Review the information used for dating / Age restrictions stop dating onboarding before a prompt (spec/slopOnboarding.md:9) */
//@ pure
export function readbackEligible(hardComplete: boolean, confirmed: boolean, skipped: boolean, belowAskCap: boolean): boolean {
  return hardComplete && !confirmed && !skipped && belowAskCap;
}

/** Story: Review the information used for dating / Age restrictions stop dating onboarding before a prompt (spec/slopOnboarding.md:9) */
//@ pure
export function canResolveReadback(p: PromptRun): boolean {
  return p.phase === "ReadbackOffered";
}

/** Story: Review the information used for dating / Age restrictions stop dating onboarding before a prompt (spec/slopOnboarding.md:9) */
//@ pure
export function resolveReadback(p: PromptRun, textAvailable: boolean): PromptRun {
  //@ ensures (inv(p) && canResolveReadback(p)) ==> alwaysReadyHasReason(\result)
  //@ ensures (inv(p) && canResolveReadback(p)) ==> stepRestrictedStaysWithheld(p, \result)
  return textAvailable ? ({ phase: "ReadbackReady", reason: readbackReason } as PromptRun) : ({ ...p, phase: "QuestionSearch" } as PromptRun);
}

/** Story: Review the information used for dating / Age restrictions stop dating onboarding before a prompt (spec/slopOnboarding.md:9) */
//@ pure
export function canRouteProfile(p: PromptRun): boolean {
  return p.phase === "AwaitingProfile";
}

/** Story: Review the information used for dating / Age restrictions stop dating onboarding before a prompt (spec/slopOnboarding.md:9) */
//@ pure
export function routeProfile(p: PromptRun, restricted: boolean, wantsReadback: boolean): PromptRun {
  //@ ensures (inv(p) && canRouteProfile(p)) ==> alwaysReadyHasReason(\result)
  //@ ensures (inv(p) && canRouteProfile(p)) ==> stepRestrictedStaysWithheld(p, \result)
  return { ...p, phase: restricted ? "Withheld" : (wantsReadback ? "ReadbackOffered" : "QuestionSearch") };
}

/** Story: Review the information used for dating / Ask the first missing field that can still be requested (spec/slopOnboarding.md:36) */
//@ pure
export function nextQuestionReason(facts: QuestionFacts, unavailable: string[]): string {
  return facts.ageMissing && !unavailable.includes("slop_age") ? "slop_age" : (facts.genderMissing && facts.seeksMissing && !unavailable.includes("slop_orientation") ? "slop_orientation" : (facts.seeksMissing && !unavailable.includes("slop_seeks") ? "slop_seeks" : (facts.genderMissing && !unavailable.includes("slop_gender") ? "slop_gender" : (facts.ageRangeMissing && !unavailable.includes("slop_age_range") ? "slop_age_range" : (facts.distanceMissing && !unavailable.includes("slop_distance") ? "slop_distance" : (facts.locationMissing && facts.unknownZip && !unavailable.includes("slop_zip") ? "slop_zip" : (facts.locationMissing && !unavailable.includes("slop_location") ? "slop_location" : (facts.dealbreakersMissing && facts.goalMissing && !unavailable.includes("slop_basics") ? "slop_basics" : (facts.goalMissing && !unavailable.includes("slop_goal") ? "slop_goal" : (facts.interestsMissing && !unavailable.includes("slop_interests") ? "slop_interests" : (facts.activitiesMissing && !unavailable.includes("slop_activities") ? "slop_activities" : (facts.freeMissing && !unavailable.includes("slop_free") ? "slop_free" : ""))))))))))));
}

/** Story: Review the information used for dating / Ask the first missing field that can still be requested (spec/slopOnboarding.md:36) */
//@ pure
export function canChooseQuestion(p: PromptRun): boolean {
  return p.phase === "QuestionSearch";
}

/** Story: Review the information used for dating / Ask the first missing field that can still be requested (spec/slopOnboarding.md:36) */
//@ pure
export function alwaysReadyHasReason(p: PromptRun): boolean {
  return (p.phase === "ReadbackReady" || p.phase === "QuestionReady") === (p.reason !== "");
}

/** Story: Review the information used for dating / Ask the first missing field that can still be requested (spec/slopOnboarding.md:36) */
//@ pure
export function stepRestrictedStaysWithheld(before: PromptRun, after: PromptRun): boolean {
  return !(before.phase === "Withheld") || after.phase === "Withheld";
}

/** Story: Review the information used for dating / Ask the first missing field that can still be requested (spec/slopOnboarding.md:36) */
//@ pure
export function sometimesReadback(p: PromptRun): boolean {
  return p.phase === "ReadbackReady";
}

/** Story: Review the information used for dating / Ask the first missing field that can still be requested (spec/slopOnboarding.md:36) */
//@ pure
export function sometimesQuestion(p: PromptRun): boolean {
  return p.phase === "QuestionReady";
}

/** Story: Review the information used for dating / Ask the first missing field that can still be requested (spec/slopOnboarding.md:36) */
//@ pure
export function chooseQuestion(p: PromptRun, facts: QuestionFacts, unavailable: string[]): PromptRun {
  //@ ensures (inv(p) && canChooseQuestion(p)) ==> alwaysReadyHasReason(\result)
  //@ ensures (inv(p) && canChooseQuestion(p)) ==> stepRestrictedStaysWithheld(p, \result)
  const reason: string = nextQuestionReason(facts, unavailable);
  return { phase: reason === "" ? "NoQuestion" : "QuestionReady", reason: reason };
}

/** Story: Review the information used for dating / A correction needs another confirmation (spec/slopOnboarding.md:91) */
//@ pure
export function confirmationAfterAnswer(changed: boolean, affirmative: boolean, restricted: boolean): boolean {
  return !changed && affirmative && !restricted;
}

/** Story: Review the information used for dating / A correction needs another confirmation (spec/slopOnboarding.md:91) */
//@ pure
export function countAfterPrompt(previous: number): number {
  return previous + 1;
}

/** Story: Review the information used for dating / A correction needs another confirmation (spec/slopOnboarding.md:91) */
//@ pure
export function lawCorrectionNeedsConfirmation(affirmative: boolean, restricted: boolean): boolean {
  //@ ensures \result === true
  return !confirmationAfterAnswer(true, affirmative, restricted);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PromptRun, event: Event): boolean {
  if (event.type === "resolveReadback") return canResolveReadback(current);
  if (event.type === "routeProfile") return canRouteProfile(current);
  if (event.type === "chooseQuestion") return canChooseQuestion(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PromptRun, event: Event): PromptRun {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "resolveReadback" && canResolveReadback(current)) return resolveReadback(current, event.textAvailable);
  if (event.type === "routeProfile" && canRouteProfile(current)) return routeProfile(current, event.restricted, event.wantsReadback);
  if (event.type === "chooseQuestion" && canChooseQuestion(current)) return chooseQuestion(current, event.facts, event.unavailable);
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
  if (raw.type === "resolveReadback" && typeof raw.textAvailable === "boolean") return { type: "resolveReadback", textAvailable: raw.textAvailable };
  if (raw.type === "routeProfile" && typeof raw.restricted === "boolean" && typeof raw.wantsReadback === "boolean") return { type: "routeProfile", restricted: raw.restricted, wantsReadback: raw.wantsReadback };
  if (raw.type === "chooseQuestion" && typeof raw.facts === "object" && raw.facts !== null && !Array.isArray(raw.facts) && typeof raw.facts.ageMissing === "boolean" && typeof raw.facts.genderMissing === "boolean" && typeof raw.facts.seeksMissing === "boolean" && typeof raw.facts.ageRangeMissing === "boolean" && typeof raw.facts.distanceMissing === "boolean" && typeof raw.facts.locationMissing === "boolean" && typeof raw.facts.unknownZip === "boolean" && typeof raw.facts.dealbreakersMissing === "boolean" && typeof raw.facts.goalMissing === "boolean" && typeof raw.facts.interestsMissing === "boolean" && typeof raw.facts.activitiesMissing === "boolean" && typeof raw.facts.freeMissing === "boolean" && Array.isArray(raw.unavailable) && raw.unavailable.every((x0: any) => typeof x0 === "string")) return { type: "chooseQuestion", facts: ({ ageMissing: raw.facts.ageMissing, genderMissing: raw.facts.genderMissing, seeksMissing: raw.facts.seeksMissing, ageRangeMissing: raw.facts.ageRangeMissing, distanceMissing: raw.facts.distanceMissing, locationMissing: raw.facts.locationMissing, unknownZip: raw.facts.unknownZip, dealbreakersMissing: raw.facts.dealbreakersMissing, goalMissing: raw.facts.goalMissing, interestsMissing: raw.facts.interestsMissing, activitiesMissing: raw.facts.activitiesMissing, freeMissing: raw.facts.freeMissing }), unavailable: raw.unavailable.map((x0: any) => x0) };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PromptRun | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingProfile" || raw.phase === "Withheld" || raw.phase === "ReadbackOffered" || raw.phase === "QuestionSearch" || raw.phase === "ReadbackReady" || raw.phase === "QuestionReady" || raw.phase === "NoQuestion") && typeof raw.reason === "string" && Object.keys(raw).length === 2)) return undefined;
  const parsed: PromptRun = ({ phase: raw.phase, reason: raw.reason });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PromptRun {
  //@ ensures inv(\result)
  return initial;
}
