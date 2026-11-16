// GENERATED from spec/standingIntent.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md) */
export type StandingIntentPhase = "IntentLive" | "IntentExpired" | "IntentPaused" | "IntentClosed" | "IntentInactive";

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
export const learnedIntentDays: number = 60;

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md) */
//@ pure
export function cachedStandingIntentsCurrent(firstExpiry: number, asOf: number): boolean {
  return firstExpiry > asOf;
}

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md) */
//@ pure
export function classifyStandingIntent(status: string, expiresAt: number, asOf: number): StandingIntentPhase {
  return status === "active" ? (expiresAt > asOf ? "IntentLive" : "IntentExpired") : (status === "paused" ? "IntentPaused" : (status === "closed" ? "IntentClosed" : "IntentInactive"));
}

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md) */
//@ pure
export function lawDeadlineEndsAnActiveIntent(expiresAt: number): boolean {
  //@ ensures \result === true
  return classifyStandingIntent("active", expiresAt, expiresAt) === "IntentExpired";
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
//@ pure
export function standingIntentBlocksLearnedCopy(phase: StandingIntentPhase): boolean {
  return phase !== "IntentExpired";
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
//@ pure
export function learnedIntentMayProject(phase: StandingIntentPhase, blockingRecord: boolean): boolean {
  return phase === "IntentLive" && !blockingRecord;
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
//@ pure
export function lawBlockingRecordPreventsLearnedProjection(phase: StandingIntentPhase): boolean {
  //@ ensures \result === true
  return !learnedIntentMayProject(phase, true);
}

/** Story: Match only on a current standing intent / Changed matching evidence starts another standing intent search (spec/standingIntent.md) */
//@ pure
export function standingIntentFacetEvidence(scope: string, fresh: boolean): boolean {
  return fresh && (scope === "matchable" || scope === "shareable");
}

/** Story: Match only on a current standing intent / Changed matching evidence starts another standing intent search (spec/standingIntent.md) */
//@ pure
export function canQueueEngineOpportunity(queuedToday: number, dailyCap: number): boolean {
  return queuedToday < dailyCap;
}

/** Story: Match only on a current standing intent / Changed matching evidence starts another standing intent search (spec/standingIntent.md) */
//@ pure
export function standingIntentRecheckDue(previous: string, evidence: string, liveIntents: number, queuedToday: number, dailyCap: number): boolean {
  return previous !== evidence && liveIntents > 0 && canQueueEngineOpportunity(queuedToday, dailyCap);
}

/** Story: Match only on a current standing intent / Changed matching evidence starts another standing intent search (spec/standingIntent.md) */
//@ pure
export function lawUnchangedEvidenceDoesNotRecheck(evidence: string, liveIntents: number, queuedToday: number, dailyCap: number): boolean {
  //@ ensures \result === true
  return !standingIntentRecheckDue(evidence, evidence, liveIntents, queuedToday, dailyCap);
}

/** Story: Match only on a current standing intent / Another search can queue only opportunities that serve a live intent (spec/standingIntent.md) */
//@ pure
export function standingIntentCandidateInScope(scoped: boolean, matchesIntent: boolean, eventFitsIntent: boolean): boolean {
  return !scoped || matchesIntent || eventFitsIntent;
}
