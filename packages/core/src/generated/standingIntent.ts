// GENERATED from spec/standingIntent.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md:9) */
export type StandingIntentPhase = "IntentLive" | "IntentExpired" | "IntentPaused" | "IntentClosed" | "IntentInactive";

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md:28) */
export const learnedIntentDays: number = 60;

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md:9) */
//@ pure
export function cachedStandingIntentsCurrent(firstExpiry: number, asOf: number): boolean {
  return firstExpiry > asOf;
}

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md:9) */
//@ pure
export function classifyStandingIntent(status: string, expiresAt: number, asOf: number): StandingIntentPhase {
  return status === "active" ? (expiresAt > asOf ? "IntentLive" : "IntentExpired") : (status === "paused" ? "IntentPaused" : (status === "closed" ? "IntentClosed" : "IntentInactive"));
}

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md:9) */
//@ pure
export function lawDeadlineEndsAnActiveIntent(expiresAt: number): boolean {
  //@ ensures \result === true
  return classifyStandingIntent("active", expiresAt, expiresAt) === "IntentExpired";
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md:28) */
//@ pure
export function standingIntentBlocksLearnedCopy(phase: StandingIntentPhase): boolean {
  return phase !== "IntentExpired";
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md:28) */
//@ pure
export function learnedIntentMayProject(phase: StandingIntentPhase, blockingRecord: boolean): boolean {
  return phase === "IntentLive" && !blockingRecord;
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md:28) */
//@ pure
export function lawBlockingRecordPreventsLearnedProjection(phase: StandingIntentPhase): boolean {
  //@ ensures \result === true
  return !learnedIntentMayProject(phase, true);
}
