// GENERATED from spec/repeatEncounter.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Consider another meeting after a mutual positive experience / Require two independent responses about one recent completed opportunity (spec/repeatEncounter.md) */
export const repeatWindowMs: number = exact_repeatEncounter(60 * 86400000);

/** Story: Consider another meeting after a mutual positive experience / Save repeat interest only after an attended meeting (spec/repeatEncounter.md) */
//@ pure
export function recordsRepeatConsent(bookingDelivered: boolean, explicitlyAgain: boolean, wasNegative: boolean, missed: boolean): boolean {
  return bookingDelivered && explicitlyAgain && !(wasNegative || missed);
}

/** Story: Consider another meeting after a mutual positive experience / Save repeat interest only after an attended meeting (spec/repeatEncounter.md) */
//@ pure
export function lawMissedMeetingGivesNoRepeatConsent(bookingDelivered: boolean, explicitlyAgain: boolean, wasNegative: boolean): boolean {
  //@ ensures \result === true
  return !recordsRepeatConsent(bookingDelivered, explicitlyAgain, wasNegative, true);
}

/** Story: Consider another meeting after a mutual positive experience / Require two independent responses about one recent completed opportunity (spec/repeatEncounter.md) */
//@ pure
export function recentRepeatSource(completed: boolean, pair: boolean, elapsedMs: number): boolean {
  return completed && pair && elapsedMs >= 0 && elapsedMs < repeatWindowMs;
}

/** Story: Consider another meeting after a mutual positive experience / Require two independent responses about one recent completed opportunity (spec/repeatEncounter.md) */
//@ pure
export function sameEncounterConsent(consent: boolean, answeredMeeting: string, sourceMeeting: string): boolean {
  return consent && answeredMeeting !== "" && answeredMeeting === sourceMeeting;
}

/** Story: Consider another meeting after a mutual positive experience / Require two independent responses about one recent completed opportunity (spec/repeatEncounter.md) */
//@ pure
export function queueRepeat(firstYes: boolean, secondYes: boolean, eligible: boolean, pairAvailable: boolean, alreadyQueued: boolean): boolean {
  return firstYes && secondYes && eligible && pairAvailable && !alreadyQueued;
}

/** Story: Consider another meeting after a mutual positive experience / Require two independent responses about one recent completed opportunity (spec/repeatEncounter.md) */
//@ pure
export function lawMismatchedMeetingGivesNoRepeatConsent(answeredMeeting: string, sourceMeeting: string): boolean {
  //@ ensures \result === true
  return !(answeredMeeting !== sourceMeeting) || !sameEncounterConsent(true, answeredMeeting, sourceMeeting);
}

/** Story: Consider another meeting after a mutual positive experience / Require two independent responses about one recent completed opportunity (spec/repeatEncounter.md) */
//@ pure
export function lawRepeatNeedsBothResponses(firstYes: boolean, eligible: boolean, pairAvailable: boolean, alreadyQueued: boolean): boolean {
  //@ ensures \result === true
  return !queueRepeat(firstYes, false, eligible, pairAvailable, alreadyQueued);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_repeatEncounter(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
