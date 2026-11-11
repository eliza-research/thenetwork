// The time rules of signed service proofs and of the Google collection consent, proved with
// LemmaScript (docs/formal-verification.md). No imports and no regex. Times are integer milliseconds:
// each caller checks Number.isSafeInteger before or after these functions, and the proofs model
// unbounded integers, so that check stays the guard against values above 2^53.

/** A proof is live: issued, not yet expired, and its lifetime is at most `maxTtl`. */
export function proofWindowOk(issuedAt: number, expiresAt: number, now: number, maxTtl: number): boolean {
  //@ verify
  //@ ensures \result === (issuedAt <= now && now < expiresAt && issuedAt < expiresAt && expiresAt - issuedAt <= maxTtl)
  return !(issuedAt > now || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > maxTtl);
}

/** The fixed expiry of a turn's collection consent, counted from the turn; undefined once it has passed. */
export function collectionExpiry(turnReceivedAt: number, now: number, retentionMs: number): number | undefined {
  //@ verify
  //@ ensures \result !== undefined ==> turnReceivedAt > 0 && now >= turnReceivedAt
  //@ ensures \result !== undefined ==> \result === turnReceivedAt + retentionMs && now < \result
  //@ ensures turnReceivedAt > 0 && now >= turnReceivedAt && now < turnReceivedAt + retentionMs ==> \result !== undefined
  if (turnReceivedAt <= 0 || now < turnReceivedAt) return undefined;
  const expiresAt = turnReceivedAt + retentionMs;
  return now < expiresAt ? expiresAt : undefined;
}
