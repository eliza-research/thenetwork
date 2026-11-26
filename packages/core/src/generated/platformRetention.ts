// GENERATED from spec/platformRetention.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Remove expired account data and retain necessary send history / Platform rows and inbox payloads have separate cutoffs (spec/platformRetention.md) */
export const platformKeepMs: number = 172800000;
/** Story: Remove expired account data and retain necessary send history / Platform rows and inbox payloads have separate cutoffs (spec/platformRetention.md) */
export const inboxKeepMs: number = 604800000;
/** Story: Remove expired account data and retain necessary send history / Retain the STOP hint count for its full window (spec/platformRetention.md) */
export const stopHintWindowMs: number = 2592000000;

/** Story: Remove expired account data and retain necessary send history / Platform rows and inbox payloads have separate cutoffs (spec/platformRetention.md) */
//@ pure
export function rowBeforeCutoff(at: number, cutoff: number): boolean {
  return at < cutoff;
}

/** Story: Remove expired account data and retain necessary send history / Platform rows and inbox payloads have separate cutoffs (spec/platformRetention.md) */
//@ pure
export function sessionPastRetention(expiresAt: number, revoked: boolean, revokedAt: number, cutoff: number): boolean {
  return rowBeforeCutoff(expiresAt, cutoff) || (revoked && rowBeforeCutoff(revokedAt, cutoff));
}

/** Story: Remove expired account data and retain necessary send history / Platform rows and inbox payloads have separate cutoffs (spec/platformRetention.md) */
//@ pure
export function phoneChangePastRetention(confirmed: boolean, requestedAt: number, cutoff: number): boolean {
  return !confirmed && rowBeforeCutoff(requestedAt, cutoff);
}

/** Story: Remove expired account data and retain necessary send history / Platform rows and inbox payloads have separate cutoffs (spec/platformRetention.md) */
//@ pure
export function lawConfirmedChangeStays(requestedAt: number, cutoff: number): boolean {
  //@ ensures \result === true
  return !phoneChangePastRetention(true, requestedAt, cutoff);
}

/** Story: Remove expired account data and retain necessary send history / Platform rows and inbox payloads have separate cutoffs (spec/platformRetention.md) */
//@ pure
export function lawRowsAtCutoffStay(cutoff: number): boolean {
  //@ ensures \result === true
  return !rowBeforeCutoff(cutoff, cutoff);
}

/** Story: Remove expired account data and retain necessary send history / Retain the STOP hint count for its full window (spec/platformRetention.md) */
//@ pure
export function rateCounterCutoff(platformCutoff: number, extraKeepMs: number): number {
  return exact_platformRetention(platformCutoff - extraKeepMs);
}

/** Story: Remove expired account data and retain necessary send history / Retain the STOP hint count for its full window (spec/platformRetention.md) */
//@ pure
export function stopHintCounterPastRetention(lastAt: number, platformCutoff: number): boolean {
  return rowBeforeCutoff(lastAt, rateCounterCutoff(platformCutoff, stopHintWindowMs));
}

/** Story: Remove expired account data and retain necessary send history / Retain the STOP hint count for its full window (spec/platformRetention.md) */
//@ pure
export function lawOrdinaryCounterFollowsPlatformCutoff(lastAt: number, platformCutoff: number): boolean {
  //@ ensures \result === true
  return rowBeforeCutoff(lastAt, rateCounterCutoff(platformCutoff, 0)) === rowBeforeCutoff(lastAt, platformCutoff);
}

/** Story: Remove expired account data and retain necessary send history / Retain the STOP hint count for its full window (spec/platformRetention.md) */
//@ pure
export function lawStopHintCounterStaysInWindow(lastAt: number, platformCutoff: number): boolean {
  //@ ensures \result === true
  return !(lastAt >= exact_platformRetention(platformCutoff - stopHintWindowMs)) || !stopHintCounterPastRetention(lastAt, platformCutoff);
}

/** Story: Remove expired account data and retain necessary send history / Finished profile suggestions leave after the platform cutoff (spec/platformRetention.md) */
//@ pure
export function suggestionRetentionCutoff(now: number): number {
  return exact_platformRetention(now - platformKeepMs);
}

/** Story: Remove expired account data and retain necessary send history / Finished profile suggestions leave after the platform cutoff (spec/platformRetention.md) */
//@ pure
export function suggestionFinished(status: string, hasFact: boolean): boolean {
  return status === "rejected" || status === "expired" || status === "withdrawn" || (status === "accepted" && !hasFact);
}

/** Story: Remove expired account data and retain necessary send history / Finished profile suggestions leave after the platform cutoff (spec/platformRetention.md) */
//@ pure
export function suggestionPastRetention(status: string, hasFact: boolean, batchExpiresAt: number, cutoff: number): boolean {
  return suggestionFinished(status, hasFact) && rowBeforeCutoff(batchExpiresAt, cutoff);
}

/** Story: Remove expired account data and retain necessary send history / Finished profile suggestions leave after the platform cutoff (spec/platformRetention.md) */
//@ pure
export function batchPastRetention(remaining: number, batchExpiresAt: number, cutoff: number): boolean {
  return remaining === 0 && rowBeforeCutoff(batchExpiresAt, cutoff);
}

/** Story: Remove expired account data and retain necessary send history / Finished profile suggestions leave after the platform cutoff (spec/platformRetention.md) */
//@ pure
export function lawLiveSuggestionStays(hasFact: boolean, batchExpiresAt: number, cutoff: number): boolean {
  //@ ensures \result === true
  return !suggestionPastRetention("proposed", hasFact, batchExpiresAt, cutoff) && !suggestionPastRetention("accepted", true, batchExpiresAt, cutoff);
}

/** Story: Remove expired account data and retain necessary send history / Finished profile suggestions leave after the platform cutoff (spec/platformRetention.md) */
//@ pure
export function lawAcceptedWithoutFactLeaves(batchExpiresAt: number, cutoff: number): boolean {
  //@ ensures \result === true
  return !rowBeforeCutoff(batchExpiresAt, cutoff) || suggestionPastRetention("accepted", false, batchExpiresAt, cutoff);
}

/** Story: Remove expired account data and retain necessary send history / Finished profile suggestions leave after the platform cutoff (spec/platformRetention.md) */
//@ pure
export function lawBatchWithSuggestionsStays(remaining: number, batchExpiresAt: number, cutoff: number): boolean {
  //@ ensures \result === true
  return !(remaining > 0) || !batchPastRetention(remaining, batchExpiresAt, cutoff);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_platformRetention(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
