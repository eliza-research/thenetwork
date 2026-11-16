// GENERATED from spec/weeklyBias.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Detect differences in outcomes without exposing individual ratings / Report rates and alert only below the configured ratio (spec/weeklyBias.md:64) */
export const biasProductionGroupMinimum: number = 8;
/** Story: Detect differences in outcomes without exposing individual ratings / Report rates and alert only below the configured ratio (spec/weeklyBias.md:64) */
export const biasAnalysisGroupMinimum: number = 15;
/** Story: Detect differences in outcomes without exposing individual ratings / Report rates and alert only below the configured ratio (spec/weeklyBias.md:64) */
export const biasThresholdNumerator: number = 4;
/** Story: Detect differences in outcomes without exposing individual ratings / Report rates and alert only below the configured ratio (spec/weeklyBias.md:64) */
export const biasThresholdDenominator: number = 5;
/** Story: Detect differences in outcomes without exposing individual ratings / The weekly run waits until the stored report is one week old (spec/weeklyBias.md:9) */
export const biasEveryMs: number = 604800000;
/** Story: Detect differences in outcomes without exposing individual ratings / Adult members need at least one day of exposure in the window (spec/weeklyBias.md:28) */
export const biasWindowMs: number = 2419200000;
/** Story: Detect differences in outcomes without exposing individual ratings / Adult members need at least one day of exposure in the window (spec/weeklyBias.md:28) */
export const biasMinimumExposureMs: number = 86400000;

/** Story: Detect differences in outcomes without exposing individual ratings / The weekly run waits until the stored report is one week old (spec/weeklyBias.md:9) */
//@ pure
export function weeklyBiasDue(forced: boolean, hasReport: boolean, elapsed: number): boolean {
  return forced || !(hasReport && elapsed < biasEveryMs);
}

/** Story: Detect differences in outcomes without exposing individual ratings / The weekly run waits until the stored report is one week old (spec/weeklyBias.md:9) */
//@ pure
export function lawRecentBiasReportDefersWeeklyRun(elapsed: number): boolean {
  //@ ensures \result === true
  return !(elapsed < biasEveryMs) || !weeklyBiasDue(false, true, elapsed);
}

/** Story: Detect differences in outcomes without exposing individual ratings / Adult members need at least one day of exposure in the window (spec/weeklyBias.md:28) */
//@ pure
export function biasMemberEligible(age: number, adultAge: number, exposure: number): boolean {
  return age >= adultAge && exposure >= biasMinimumExposureMs;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Adult members need at least one day of exposure in the window (spec/weeklyBias.md:28) */
//@ pure
export function biasRatingQuintile(rank: number, population: number): number {
  return population > 0 ? exact_weeklyBias(1 + quotient_weeklyBias(exact_weeklyBias(5 * rank), population)) : 1;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Outcomes count only the opportunities in the observation window (spec/weeklyBias.md:43) */
//@ pure
export function biasOpportunityReached(stage: string, closedFrom: string): boolean {
  return stage !== "review" && !(stage === "closed" && closedFrom === "review");
}

/** Story: Detect differences in outcomes without exposing individual ratings / Outcomes count only the opportunities in the observation window (spec/weeklyBias.md:43) */
//@ pure
export function biasDateHeld(stage: string, hasMeeting: boolean, meetingAt: number, from: number, asOf: number): boolean {
  return stage === "done" && hasMeeting && meetingAt >= from && meetingAt <= asOf;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Outcomes count only the opportunities in the observation window (spec/weeklyBias.md:43) */
//@ pure
export function biasSinglePair(participants: number): boolean {
  return participants === 2;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Outcomes count only the opportunities in the observation window (spec/weeklyBias.md:43) */
//@ pure
export function biasPairMetAgain(dates: number): boolean {
  return dates >= 2;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Outcomes count only the opportunities in the observation window (spec/weeklyBias.md:43) */
//@ pure
export function biasOpportunityInWindow(createdAt: number, from: number, asOf: number): boolean {
  return createdAt >= from && createdAt <= asOf;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Outcomes count only the opportunities in the observation window (spec/weeklyBias.md:43) */
//@ pure
export function lawBiasDateCountsByMeetingTime(meetingAt: number, from: number, asOf: number): boolean {
  //@ ensures \result === true
  return biasDateHeld("done", true, meetingAt, from, asOf) === biasOpportunityInWindow(meetingAt, from, asOf);
}

/** Story: Detect differences in outcomes without exposing individual ratings / Report rates and alert only below the configured ratio (spec/weeklyBias.md:64) */
//@ pure
export function biasRateFor(hasExposure: boolean, quotient: number): number {
  return hasExposure ? quotient : 0;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Report rates and alert only below the configured ratio (spec/weeklyBias.md:64) */
//@ pure
export function biasRatioFor(hasOverallRate: boolean, quotient: number): number {
  return hasOverallRate ? quotient : 1;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Report rates and alert only below the configured ratio (spec/weeklyBias.md:64) */
//@ pure
export function biasGroupEligible(members: number, minimum: number): boolean {
  return members >= minimum;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Report rates and alert only below the configured ratio (spec/weeklyBias.md:64) */
//@ pure
export function biasRatioBelowThreshold(ratio: number, threshold: number): boolean {
  return ratio < threshold;
}

/** Story: Detect differences in outcomes without exposing individual ratings / Report rates and alert only below the configured ratio (spec/weeklyBias.md:64) */
//@ pure
export function lawBiasAtThresholdIsQuiet(threshold: number): boolean {
  //@ ensures \result === true
  return !biasRatioBelowThreshold(threshold, threshold);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_weeklyBias(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_weeklyBias(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
