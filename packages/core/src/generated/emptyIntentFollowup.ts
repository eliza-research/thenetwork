// GENERATED from spec/emptyIntentFollowup.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Hear when nothing fits yet / Explain an empty search after its configured wait (spec/emptyIntentFollowup.md) */
export const emptyIntentDefaultWaitDays: number = 10;
/** Story: Hear when nothing fits yet / Explain an empty search after its configured wait (spec/emptyIntentFollowup.md) */
export const emptyIntentDayMs: number = 86400000;

/** Story: Hear when nothing fits yet / Explain an empty search after its configured wait (spec/emptyIntentFollowup.md) */
//@ pure
export function emptyIntentFollowupReasonAllowed(reason: string): boolean {
  return reason === "no_candidates" || reason === "density_gap" || reason === "below_threshold" || reason === "filtered";
}

/** Story: Hear when nothing fits yet / Explain an empty search after its configured wait (spec/emptyIntentFollowup.md) */
//@ pure
export function emptyIntentWaitOver(statementAgeMs: number, waitDays: number): boolean {
  return statementAgeMs >= exact_emptyIntentFollowup(waitDays * emptyIntentDayMs);
}

/** Story: Hear when nothing fits yet / Explain an empty search after its configured wait (spec/emptyIntentFollowup.md) */
//@ pure
export function lawNewStatementWaitsBeforeAFollowup(waitDays: number): boolean {
  //@ ensures \result === true
  return waitDays <= 0 || !emptyIntentWaitOver(0, waitDays);
}

/** Story: Hear when nothing fits yet / Explain an empty search after its configured wait (spec/emptyIntentFollowup.md) */
//@ pure
export function lawDefaultWaitHoldsAStatementForTenDays(statementAgeMs: number): boolean {
  //@ ensures \result === true
  return !(statementAgeMs < exact_emptyIntentFollowup(10 * emptyIntentDayMs)) || !emptyIntentWaitOver(statementAgeMs, emptyIntentDefaultWaitDays);
}

/** Story: Hear when nothing fits yet / A pending follow-up uses current permission and the same live statement (spec/emptyIntentFollowup.md) */
//@ pure
export function emptyIntentFollowupReady(liveStatement: boolean, eligible: boolean, categoryAllowed: boolean, quietConversation: boolean, sameSearchDay: boolean, alreadyReported: boolean): boolean {
  return liveStatement && eligible && categoryAllowed && quietConversation && sameSearchDay && !alreadyReported;
}

/** Story: Hear when nothing fits yet / A pending follow-up uses current permission and the same live statement (spec/emptyIntentFollowup.md) */
//@ pure
export function lawReportedIntentDoesNotRepeat(liveStatement: boolean, eligible: boolean, categoryAllowed: boolean, quietConversation: boolean, sameSearchDay: boolean): boolean {
  //@ ensures \result === true
  return !emptyIntentFollowupReady(liveStatement, eligible, categoryAllowed, quietConversation, sameSearchDay, true);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_emptyIntentFollowup(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
