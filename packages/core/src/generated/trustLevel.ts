// GENERATED from spec/trustLevel.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md) */
export type TrustLevel = "Ok" | "Watch" | "Hold";

/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md) */
export const watchScore: number = 3;
/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md) */
export const holdScore: number = 6;
/** Story: Pause unsafe activity / Clean time lowers the score through a recorded decay event (spec/trustLevel.md) */
export const trustDecayDays: number = 14;

/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md) */
//@ pure
export function levelForScore(score: number, held: boolean): TrustLevel {
  return held || score >= holdScore ? "Hold" : (score >= watchScore ? "Watch" : "Ok");
}

/** Story: Pause unsafe activity / An explicit attempt to bypass contact consent triggers watch (spec/trustLevel.md) */
//@ pure
export function contactExtractionRisk(explicitBypass: boolean): number {
  return explicitBypass ? watchScore : 2;
}

/** Story: Pause unsafe activity / An explicit attempt to bypass contact consent triggers watch (spec/trustLevel.md) */
//@ pure
export function lawExplicitContactBypassTriggersWatch(explicitBypass: boolean): boolean {
  //@ ensures \result === true
  return levelForScore(contactExtractionRisk(explicitBypass), false) === (explicitBypass ? "Watch" : "Ok");
}

/** Story: Pause unsafe activity / A choice of alternatives does not supply a threat signal (spec/trustLevel.md) */
//@ pure
export function orElseIsThreat(terminal: boolean, harmfulConsequence: boolean): boolean {
  return terminal || harmfulConsequence;
}

/** Story: Pause unsafe activity / A choice of alternatives does not supply a threat signal (spec/trustLevel.md) */
//@ pure
export function lawNonterminalOrElseNeedsHarm(harmfulConsequence: boolean): boolean {
  //@ ensures \result === true
  return orElseIsThreat(false, harmfulConsequence) === harmfulConsequence;
}

/** Story: Pause unsafe activity / A choice of alternatives does not supply a threat signal (spec/trustLevel.md) */
//@ pure
export function lawTerminalOrElseSuppliesThreat(harmfulConsequence: boolean): boolean {
  //@ ensures \result === true
  return orElseIsThreat(true, harmfulConsequence);
}

/** Story: Pause unsafe activity / A hold stays in place until staff lift it (spec/trustLevel.md) */
//@ pure
export function lawScoreUpdatesKeepHolds(score: number): boolean {
  //@ ensures \result === true
  return levelForScore(score, true) === "Hold";
}

/** Story: Pause unsafe activity / Clean time lowers the score through a recorded decay event (spec/trustLevel.md) */
//@ pure
export function trustDecayPoints(score: number, steps: number, held: boolean): number {
  return held || score <= 0 || steps <= 0 ? 0 : (steps < score ? exact_trustLevel(0 - steps) : exact_trustLevel(0 - score));
}

/** Story: Pause unsafe activity / Clean time lowers the score through a recorded decay event (spec/trustLevel.md) */
//@ pure
export function lawTrustDecayKeepsScoreInRange(score: number, steps: number, held: boolean): boolean {
  //@ ensures \result === true
  const local_0 = trustDecayPoints(score, steps, held);
  return local_0 <= 0 && (!(score >= 0) || exact_trustLevel(score + local_0) >= 0);
}

/** Story: Pause unsafe activity / Clean time lowers the score through a recorded decay event (spec/trustLevel.md) */
//@ pure
export function lawTrustDecayLeavesHoldsAlone(score: number, steps: number): boolean {
  //@ ensures \result === true
  return trustDecayPoints(score, steps, true) === 0;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_trustLevel(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
