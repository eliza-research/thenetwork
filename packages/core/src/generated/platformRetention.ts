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
export function lawRowsAtCutoffStay(cutoff: number): boolean {
  //@ ensures \result === true
  return !rowBeforeCutoff(cutoff, cutoff);
}

/** Story: Remove expired account data and retain necessary send history / Platform rows and inbox payloads have separate cutoffs (spec/platformRetention.md) */
//@ pure
export function lawConfirmedChangeStays(requestedAt: number, cutoff: number): boolean {
  //@ ensures \result === true
  return !phoneChangePastRetention(true, requestedAt, cutoff);
}
