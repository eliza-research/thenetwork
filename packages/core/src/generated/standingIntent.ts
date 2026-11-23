// GENERATED from spec/standingIntent.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md) */
export type StandingIntentPhase = "IntentLive" | "IntentExpired" | "IntentPaused" | "IntentClosed" | "IntentInactive";
/** Story: Match only on a current standing intent / Changed matching evidence starts another standing intent search (spec/standingIntent.md) */
export type StandingPresencePhase = "IgnorePresence" | "FuturePresence" | "CurrentPresence";

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
export const learnedIntentDays: number = 60;
/** Story: Match only on a current standing intent / One renewal question before a searched want lapses (spec/standingIntent.md) */
export const renewalAskDays: number = 7;
/** Story: Match only on a current standing intent / One renewal question before a searched want lapses (spec/standingIntent.md) */
export const renewalRetryMs: number = 86400000;

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
export function standingIntentSuppliesEvidence(phase: StandingIntentPhase): boolean {
  return phase === "IntentLive";
}

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md) */
//@ pure
export function lawPausedOrClosedSuppliesNoEvidence(expiresAt: number, asOf: number): boolean {
  //@ ensures \result === true
  return !standingIntentSuppliesEvidence(classifyStandingIntent("paused", expiresAt, asOf)) && !standingIntentSuppliesEvidence(classifyStandingIntent("closed", expiresAt, asOf));
}

/** Story: Match only on a current standing intent / A standing intent expires at its recorded deadline (spec/standingIntent.md) */
//@ pure
export function lawDeadlineEndsAnActiveIntent(expiresAt: number): boolean {
  //@ ensures \result === true
  return classifyStandingIntent("active", expiresAt, expiresAt) === "IntentExpired";
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
//@ pure
export function learnedIntentMayProject(phase: StandingIntentPhase, blockingRecord: boolean): boolean {
  return phase === "IntentLive" && !blockingRecord;
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
//@ pure
export function standingIntentBlocksLearnedCopy(phase: StandingIntentPhase): boolean {
  return phase !== "IntentExpired";
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
//@ pure
export function lawBlockingRecordPreventsLearnedProjection(phase: StandingIntentPhase): boolean {
  //@ ensures \result === true
  return !learnedIntentMayProject(phase, true);
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
//@ pure
export function lawOnlyExpiredRecordLetsLearnedCopyThrough(status: string, expiresAt: number, asOf: number): boolean {
  //@ ensures \result === true
  return standingIntentBlocksLearnedCopy(classifyStandingIntent(status, expiresAt, asOf)) === !(status === "active" && expiresAt <= asOf);
}

/** Story: Match only on a current standing intent / A fresh statement can replace an expired copy (spec/standingIntent.md) */
//@ pure
export function lawExpiredActiveRowStopsSuperseding(expiresAt: number, asOf: number): boolean {
  //@ ensures \result === true
  return !(asOf >= expiresAt) || !standingIntentSuppliesEvidence(classifyStandingIntent("active", expiresAt, asOf));
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
export function standingPresencePhase(eligibleMember: boolean, hasStart: boolean, startsAt: number, hasEnd: boolean, endsAt: number, asOf: number): StandingPresencePhase {
  return !eligibleMember || (hasStart && hasEnd && startsAt >= endsAt) || (hasEnd && endsAt <= asOf) ? "IgnorePresence" : (hasStart && asOf < startsAt ? "FuturePresence" : "CurrentPresence");
}

/** Story: Match only on a current standing intent / Changed matching evidence starts another standing intent search (spec/standingIntent.md) */
//@ pure
export function standingIntentRecheckDue(previous: string, evidence: string, liveIntents: number, queuedToday: number, dailyCap: number): boolean {
  return previous !== evidence && liveIntents > 0 && canQueueEngineOpportunity(queuedToday, dailyCap);
}

/** Story: Match only on a current standing intent / Changed matching evidence starts another standing intent search (spec/standingIntent.md) */
//@ pure
export function lawEndedPresenceDoesNotContribute(eligibleMember: boolean, hasStart: boolean, startsAt: number, endsAt: number): boolean {
  //@ ensures \result === true
  return standingPresencePhase(eligibleMember, hasStart, startsAt, true, endsAt, endsAt) === "IgnorePresence";
}

/** Story: Match only on a current standing intent / Changed matching evidence starts another standing intent search (spec/standingIntent.md) */
//@ pure
export function lawStartingTripChangesEvidence(startsAt: number, endsAt: number): boolean {
  //@ ensures \result === true
  return !(startsAt < endsAt) || (standingPresencePhase(true, true, startsAt, true, endsAt, exact_standingIntent(startsAt - 1)) === "FuturePresence" && standingPresencePhase(true, true, startsAt, true, endsAt, startsAt) === "CurrentPresence");
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

/** Story: Match only on a current standing intent / One renewal question before a searched want lapses (spec/standingIntent.md) */
//@ pure
export function standingRenewalAskDue(live: boolean, searching: boolean, daysLeft: number, askedThisDeadline: boolean, refusedAgoMs: number): boolean {
  return live && searching && daysLeft > 0 && daysLeft <= renewalAskDays && !askedThisDeadline && (refusedAgoMs < 0 || refusedAgoMs >= renewalRetryMs);
}

/** Story: Match only on a current standing intent / One renewal question before a searched want lapses (spec/standingIntent.md) */
//@ pure
export function lawOneRenewalAskPerDeadline(live: boolean, searching: boolean, daysLeft: number, refusedAgoMs: number): boolean {
  //@ ensures \result === true
  return !standingRenewalAskDue(live, searching, daysLeft, true, refusedAgoMs);
}

/** Story: Match only on a current standing intent / One renewal question before a searched want lapses (spec/standingIntent.md) */
//@ pure
export function lawNoRenewalAskEarly(live: boolean, searching: boolean, askedThisDeadline: boolean, refusedAgoMs: number): boolean {
  //@ ensures \result === true
  return !standingRenewalAskDue(live, searching, exact_standingIntent(renewalAskDays + 1), askedThisDeadline, refusedAgoMs);
}

/** Story: Match only on a current standing intent / One renewal question before a searched want lapses (spec/standingIntent.md) */
//@ pure
export function lawPausedOrClosedIsNotAsked(searching: boolean, daysLeft: number, askedThisDeadline: boolean, refusedAgoMs: number): boolean {
  //@ ensures \result === true
  return !standingRenewalAskDue(false, searching, daysLeft, askedThisDeadline, refusedAgoMs);
}

/** Story: Match only on a current standing intent / One renewal question before a searched want lapses (spec/standingIntent.md) */
//@ pure
export function lawRefusedAskWaitsADay(live: boolean, searching: boolean, daysLeft: number, askedThisDeadline: boolean): boolean {
  //@ ensures \result === true
  return !standingRenewalAskDue(live, searching, daysLeft, askedThisDeadline, 0) && !standingRenewalAskDue(live, searching, daysLeft, askedThisDeadline, exact_standingIntent(renewalRetryMs - 1));
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_standingIntent(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
