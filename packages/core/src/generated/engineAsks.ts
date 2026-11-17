// GENERATED from spec/engineAsks.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
export type QuestionPhase = "AwaitingOptions" | "PlanningQuestions" | "QuestionsPublished";
/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
export interface AskRun { phase: QuestionPhase; counts: Record<string, number> }
/** Story: Ask for the information needed to find a match / Slop finishes required questions before proposing optional ones (spec/engineAsks.md) */
export type SlopQuestionTrack = "RequiredQuestions" | "OptionalQuestions";

/** One variant per transition in the spec. */
export type Event =
  | { type: "publishQuestions" }
  | { type: "setAvailability"; configured: boolean }
  | { type: "reserveQuestion"; memberId: string; adult: boolean; supportedMarket: boolean };

/** Story: Ask for the information needed to find a match / Slop finishes required questions before proposing optional ones (spec/engineAsks.md) */
export const requiredQuestionWaitMs: number = 604800000;
/** Story: Ask for the information needed to find a match / Slop can offer a wider radius or ask about compatibility (spec/engineAsks.md) */
export const compatibilityWaitMs: number = 1814400000;
/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
export const initial: AskRun = { phase: "AwaitingOptions", counts: ({} as Record<string, number>) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: AskRun): boolean {
  return true;
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function canPublishQuestions(s: AskRun): boolean {
  return s.phase === "PlanningQuestions";
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function publishQuestions(s: AskRun): AskRun {
  //@ ensures (inv(s) && canPublishQuestions(s)) ==> stepPublishedQuestionsStayClosed(s, \result)
  return { ...s, phase: "QuestionsPublished" };
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function stepPublishedQuestionsStayClosed(before: AskRun, after: AskRun): boolean {
  return !(before.phase === "QuestionsPublished") || equal_engineAsks(after, before);
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function canSetAvailability(s: AskRun): boolean {
  return s.phase === "AwaitingOptions";
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function setAvailability(s: AskRun, configured: boolean): AskRun {
  //@ ensures (inv(s) && canSetAvailability(s)) ==> stepPublishedQuestionsStayClosed(s, \result)
  return { ...s, phase: configured ? "PlanningQuestions" : "QuestionsPublished" };
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function questionSubjectAllowed(s: AskRun, adult: boolean, supportedMarket: boolean): boolean {
  return s.phase === "PlanningQuestions" && adult && supportedMarket;
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function countReservedQuestions(s: AskRun, memberId: string): number {
  return lookup0_engineAsks(s.counts, memberId, 0);
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function canReserveQuestion(s: AskRun, memberId: string, adult: boolean, supportedMarket: boolean): boolean {
  return questionSubjectAllowed(s, adult, supportedMarket);
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function reserveQuestion(s: AskRun, memberId: string, adult: boolean, supportedMarket: boolean): AskRun {
  //@ ensures (inv(s) && canReserveQuestion(s, memberId, adult, supportedMarket)) ==> stepPublishedQuestionsStayClosed(s, \result)
  return { ...s, counts: ({ ...s.counts, ["$" + memberId]: exact_engineAsks(countReservedQuestions(s, memberId) + 1) } as Record<string, number>) };
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function countPublishedQuestions(s: AskRun, memberId: string): number {
  return s.phase === "QuestionsPublished" ? countReservedQuestions(s, memberId) : 0;
}

/** Story: Ask for the information needed to find a match / An enabled run considers adults in a supported market (spec/engineAsks.md) */
//@ pure
export function sometimesPublishesQuestions(s: AskRun): boolean {
  return s.phase === "QuestionsPublished" && countReservedQuestions(s, "a") > 0;
}

/** Story: Ask for the information needed to find a match / The Network asks for dating preferences once (spec/engineAsks.md) */
//@ pure
export function networkPreferenceQuestion(datingEligible: boolean, missingPreferences: boolean, activeIntent: boolean, previouslyAsked: boolean): boolean {
  return datingEligible && missingPreferences && activeIntent && !previouslyAsked;
}

/** Story: Ask for the information needed to find a match / The Network asks for dating preferences once (spec/engineAsks.md) */
//@ pure
export function lawIneligibleMemberGetsNoPreferenceQuestion(missingPreferences: boolean, activeIntent: boolean, previouslyAsked: boolean): boolean {
  //@ ensures \result === true
  return !networkPreferenceQuestion(false, missingPreferences, activeIntent, previouslyAsked);
}

/** Story: Ask for the information needed to find a match / Slop finishes required questions before proposing optional ones (spec/engineAsks.md) */
//@ pure
export function slopQuestionSubject(adult: boolean, optedIn: boolean, paused: boolean, held: boolean): boolean {
  return adult && optedIn && !paused && !held;
}

/** Story: Ask for the information needed to find a match / Slop finishes required questions before proposing optional ones (spec/engineAsks.md) */
//@ pure
export function requiredQuestionDue(elapsedMs: number, asked: number, cap: number): boolean {
  return elapsedMs >= requiredQuestionWaitMs && !(cap > 0 && asked >= cap);
}

/** Story: Ask for the information needed to find a match / Slop finishes required questions before proposing optional ones (spec/engineAsks.md) */
//@ pure
export function slopQuestionTrack(missingFields: boolean): SlopQuestionTrack {
  return missingFields ? "RequiredQuestions" : "OptionalQuestions";
}

/** Story: Ask for the information needed to find a match / Slop can offer a wider radius or ask about compatibility (spec/engineAsks.md) */
//@ pure
export function wideningPoolEligible(wideningEnabled: boolean, degree: number, maximumDegree: number): boolean {
  return wideningEnabled && degree <= maximumDegree;
}

/** Story: Ask for the information needed to find a match / Slop can offer a wider radius or ask about compatibility (spec/engineAsks.md) */
//@ pure
export function widerRadiusQuestion(radius: number, offeredRadius: number, alreadyAsked: boolean): boolean {
  return radius < offeredRadius && !alreadyAsked;
}

/** Story: Ask for the information needed to find a match / Slop can offer a wider radius or ask about compatibility (spec/engineAsks.md) */
//@ pure
export function compatibilityQuestionDue(elapsedMs: number): boolean {
  return elapsedMs >= compatibilityWaitMs;
}

/** Story: Ask for the information needed to find a match / Slop can offer a wider radius or ask about compatibility (spec/engineAsks.md) */
//@ pure
export function compatibilityTypeQuestionDue(typeEnabled: boolean, typeMissing: boolean, elapsedMs: number): boolean {
  return typeEnabled && typeMissing && compatibilityQuestionDue(elapsedMs);
}

/** Story: Ask for the information needed to find a match / Slop can offer a wider radius or ask about compatibility (spec/engineAsks.md) */
//@ pure
export function lawTypeQuestionNeedsItsSwitch(typeMissing: boolean, elapsedMs: number): boolean {
  //@ ensures \result === true
  return !compatibilityTypeQuestionDue(false, typeMissing, elapsedMs);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: AskRun, event: Event): boolean {
  if (event.type === "publishQuestions") return canPublishQuestions(current);
  if (event.type === "setAvailability") return canSetAvailability(current);
  if (event.type === "reserveQuestion") return canReserveQuestion(current, event.memberId, event.adult, event.supportedMarket);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: AskRun, event: Event): AskRun {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "publishQuestions" && canPublishQuestions(current)) return publishQuestions(current);
  if (event.type === "setAvailability" && canSetAvailability(current)) return setAvailability(current, event.configured);
  if (event.type === "reserveQuestion" && canReserveQuestion(current, event.memberId, event.adult, event.supportedMarket)) return reserveQuestion(current, event.memberId, event.adult, event.supportedMarket);
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
  if (raw.type === "publishQuestions") return { type: "publishQuestions" };
  if (raw.type === "setAvailability" && typeof raw.configured === "boolean") return { type: "setAvailability", configured: raw.configured };
  if (raw.type === "reserveQuestion" && typeof raw.memberId === "string" && typeof raw.adult === "boolean" && typeof raw.supportedMarket === "boolean") return { type: "reserveQuestion", memberId: raw.memberId, adult: raw.adult, supportedMarket: raw.supportedMarket };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): AskRun | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingOptions" || raw.phase === "PlanningQuestions" || raw.phase === "QuestionsPublished") && typeof raw.counts === "object" && raw.counts !== null && !Array.isArray(raw.counts) && Object.entries(raw.counts).every(([k1, x1]: [string, any]) => k1.startsWith("$") && Number.isSafeInteger(x1)) && Object.keys(raw).length === 2)) return undefined;
  const parsed: AskRun = ({ phase: raw.phase, counts: Object.fromEntries(Object.entries(raw.counts).map(([k1, x1]: [string, any]) => [k1, x1])) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): AskRun {
  //@ ensures inv(\result)
  return initial;
}

/** What a map holds for a key, or `otherwise` if it holds nothing for it. */
//@ pure
export function lookup0_engineAsks(m: Record<string, number>, k: string, otherwise: number): number {
  const key = "$" + k;
  return key in m ? m[key] : otherwise;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_engineAsks(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_engineAsks(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_engineAsks((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
