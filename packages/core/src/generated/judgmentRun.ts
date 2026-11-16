// GENERATED from spec/judgmentRun.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Review the strongest possible matches in order / The rubric pass enables the run (spec/judgmentRun.md:9) */
export interface PassOption { enabled: boolean; limit: number; supported: boolean }
/** Story: Review the strongest possible matches in order / The rubric pass enables the run (spec/judgmentRun.md:9) */
export type JudgmentPhase = "AwaitingSetup" | "Screening" | "Rubric" | "DeepReview" | "Complete";
/** Story: Review the strongest possible matches in order / The rubric pass enables the run (spec/judgmentRun.md:9) */
export interface JudgmentRun { phase: JudgmentPhase; deepAllowed: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "configureRun"; rubricOption: PassOption; screenOption: PassOption }
  | { type: "finishScreen" }
  | { type: "finishRubric"; deepOption: PassOption }
  | { type: "finishDeepReview" };

/** Story: Review the strongest possible matches in order / The rubric pass enables the run (spec/judgmentRun.md:9) */
export const initial: JudgmentRun = { phase: "AwaitingSetup", deepAllowed: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: JudgmentRun): boolean {
  return alwaysDeepReviewWasEnabled(current);
}

/** Story: Review the strongest possible matches in order / The rubric pass enables the run (spec/judgmentRun.md:9) */
//@ pure
export function passAvailable(option: PassOption): boolean {
  return option.enabled && option.limit > 0 && option.supported;
}

/** Story: Review the strongest possible matches in order / The rubric pass enables the run (spec/judgmentRun.md:9) */
//@ pure
export function canConfigureRun(review: JudgmentRun): boolean {
  return review.phase === "AwaitingSetup";
}

/** Story: Review the strongest possible matches in order / The rubric pass enables the run (spec/judgmentRun.md:9) */
//@ pure
export function configureRun(review: JudgmentRun, rubricOption: PassOption, screenOption: PassOption): JudgmentRun {
  //@ ensures (inv(review) && canConfigureRun(review)) ==> alwaysDeepReviewWasEnabled(\result)
  //@ ensures (inv(review) && canConfigureRun(review)) ==> stepDeepReviewFollowsRubric(review, \result)
  //@ ensures (inv(review) && canConfigureRun(review)) ==> stepCompletedRunStaysClosed(review, \result)
  return !passAvailable(rubricOption) ? ({ ...review, phase: "Complete" } as JudgmentRun) : ({ ...review, phase: passAvailable(screenOption) ? "Screening" : "Rubric" } as JudgmentRun);
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function canFinishScreen(review: JudgmentRun): boolean {
  return review.phase === "Screening";
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function finishScreen(review: JudgmentRun): JudgmentRun {
  //@ ensures (inv(review) && canFinishScreen(review)) ==> alwaysDeepReviewWasEnabled(\result)
  //@ ensures (inv(review) && canFinishScreen(review)) ==> stepDeepReviewFollowsRubric(review, \result)
  //@ ensures (inv(review) && canFinishScreen(review)) ==> stepCompletedRunStaysClosed(review, \result)
  return { ...review, phase: "Rubric" };
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function canFinishRubric(review: JudgmentRun): boolean {
  return review.phase === "Rubric";
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function finishRubric(review: JudgmentRun, deepOption: PassOption): JudgmentRun {
  //@ ensures (inv(review) && canFinishRubric(review)) ==> alwaysDeepReviewWasEnabled(\result)
  //@ ensures (inv(review) && canFinishRubric(review)) ==> stepDeepReviewFollowsRubric(review, \result)
  //@ ensures (inv(review) && canFinishRubric(review)) ==> stepCompletedRunStaysClosed(review, \result)
  return passAvailable(deepOption) ? ({ phase: "DeepReview", deepAllowed: true } as JudgmentRun) : ({ ...review, phase: "Complete" } as JudgmentRun);
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function canFinishDeepReview(review: JudgmentRun): boolean {
  return review.phase === "DeepReview";
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function finishDeepReview(review: JudgmentRun): JudgmentRun {
  //@ ensures (inv(review) && canFinishDeepReview(review)) ==> alwaysDeepReviewWasEnabled(\result)
  //@ ensures (inv(review) && canFinishDeepReview(review)) ==> stepDeepReviewFollowsRubric(review, \result)
  //@ ensures (inv(review) && canFinishDeepReview(review)) ==> stepCompletedRunStaysClosed(review, \result)
  return { ...review, phase: "Complete" };
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function alwaysDeepReviewWasEnabled(review: JudgmentRun): boolean {
  return !(review.phase === "DeepReview") || review.deepAllowed;
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function stepDeepReviewFollowsRubric(before: JudgmentRun, after: JudgmentRun): boolean {
  return !(before.phase !== "DeepReview" && after.phase === "DeepReview") || before.phase === "Rubric";
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function stepCompletedRunStaysClosed(before: JudgmentRun, after: JudgmentRun): boolean {
  return !(before.phase === "Complete") || equal_judgmentRun(after, before);
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function sometimesScreening(review: JudgmentRun): boolean {
  return review.phase === "Screening";
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function sometimesDeepReview(review: JudgmentRun): boolean {
  return review.phase === "DeepReview";
}

/** Story: Review the strongest possible matches in order / Each completed pass advances the run once (spec/judgmentRun.md:38) */
//@ pure
export function sometimesComplete(review: JudgmentRun): boolean {
  return review.phase === "Complete";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: JudgmentRun, event: Event): boolean {
  if (event.type === "configureRun") return canConfigureRun(current);
  if (event.type === "finishScreen") return canFinishScreen(current);
  if (event.type === "finishRubric") return canFinishRubric(current);
  if (event.type === "finishDeepReview") return canFinishDeepReview(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: JudgmentRun, event: Event): JudgmentRun {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "configureRun" && canConfigureRun(current)) return configureRun(current, event.rubricOption, event.screenOption);
  if (event.type === "finishScreen" && canFinishScreen(current)) return finishScreen(current);
  if (event.type === "finishRubric" && canFinishRubric(current)) return finishRubric(current, event.deepOption);
  if (event.type === "finishDeepReview" && canFinishDeepReview(current)) return finishDeepReview(current);
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
  const is_PassOption = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.enabled === "boolean" && Number.isSafeInteger(v.limit) && typeof v.supported === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "configureRun" && is_PassOption(raw.rubricOption) && is_PassOption(raw.screenOption)) return { type: "configureRun", rubricOption: ({ enabled: raw.rubricOption.enabled, limit: raw.rubricOption.limit, supported: raw.rubricOption.supported }), screenOption: ({ enabled: raw.screenOption.enabled, limit: raw.screenOption.limit, supported: raw.screenOption.supported }) };
  if (raw.type === "finishScreen") return { type: "finishScreen" };
  if (raw.type === "finishRubric" && is_PassOption(raw.deepOption)) return { type: "finishRubric", deepOption: ({ enabled: raw.deepOption.enabled, limit: raw.deepOption.limit, supported: raw.deepOption.supported }) };
  if (raw.type === "finishDeepReview") return { type: "finishDeepReview" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): JudgmentRun | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingSetup" || raw.phase === "Screening" || raw.phase === "Rubric" || raw.phase === "DeepReview" || raw.phase === "Complete") && typeof raw.deepAllowed === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: JudgmentRun = ({ phase: raw.phase, deepAllowed: raw.deepAllowed });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): JudgmentRun {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_judgmentRun(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_judgmentRun((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
