// The pure decisions of the platform, free of imports so that they can be proved
// (LemmaScript, docs/formal-verification.md). store.ts, sessions.ts, proxy.ts, photos.ts, age.ts and
// accounts.ts call them. Facts passed in as booleans are trusted here: the proofs cover the decision, not
// the query that produced the fact. The SQL in pg-store.ts repeats hitPasses and challengeClaimable.

// ------------------------------------------------------------------ rate limits and codes

/** A hit counts when it stays under the limit and keeps the gap. A refused hit is not counted. */
//@ verify
//@ ensures limit !== undefined ==> \result ==> count < limit
//@ ensures minGapMs !== undefined ==> prevAt !== null ==> \result ==> at - prevAt >= minGapMs
export function hitPasses(count: number, prevAt: number | null, at: number, limit: number | undefined, minGapMs: number | undefined): boolean {
  if (limit !== undefined && count >= limit) return false;
  if (minGapMs === undefined || prevAt === null) return true;
  return at - prevAt >= minGapMs;
}

/** A code can take one more attempt only when it is unused, unexpired and under the attempt limit. */
//@ verify
//@ ensures \result <==> consumedAt === null && at < expiresAt && attempts < max
export function challengeClaimable(consumedAt: number | null, expiresAt: number, attempts: number, max: number, at: number): boolean {
  return !(consumedAt !== null || expiresAt <= at || attempts >= max);
}

// ------------------------------------------------------------------ sessions and the proxy

/** When a new session ends: never past its own time, the end of the login's chain, or the cap the caller gives. */
//@ verify
//@ requires ttl >= 0 && maxMs >= 0
//@ ensures \result <= at + ttl && \result <= started + maxMs
//@ ensures expiresBefore !== undefined ==> \result <= expiresBefore
export function sessionExpiry(at: number, ttl: number, started: number, maxMs: number, expiresBefore: number | undefined): number {
  const capped = Math.min(at + ttl, started + maxMs);
  return expiresBefore === undefined ? capped : Math.min(capped, expiresBefore);
}

/** A session is live for its own app only, before its end and before any revocation. */
//@ verify
//@ ensures \result ==> sessionApp === app && expiresAt > at
//@ ensures revokedAt !== null ==> \result ==> revokedAt > at
//@ ensures revokedAt === null ==> sessionApp === app ==> expiresAt > at ==> \result
export function sessionLive(sessionApp: string, app: string, revokedAt: number | null, expiresAt: number, at: number): boolean {
  if (sessionApp !== app || expiresAt <= at) return false;
  return revokedAt === null ? true : revokedAt > at;
}

/** A signed time is accepted only within maxSkew seconds of now, on either side. */
//@ verify
//@ ensures \result <==> nowS - t <= maxSkew && t - nowS <= maxSkew
export function withinSkew(nowS: number, t: number, maxSkew: number): boolean {
  return !(Math.abs(nowS - t) > maxSkew);
}

// ------------------------------------------------------------------ age

/** The lower of two known ages. Unknown never raises an age. */
//@ verify
//@ ensures a === null ==> \result === b
//@ ensures a !== null ==> b === null ==> \result === a
//@ ensures a !== null ==> b !== null ==> \result !== null
//@ ensures a !== null ==> b !== null ==> \result !== null ==> \result <= a && \result <= b
export function lowerOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** The lowest of the ages stated: no later statement can raise it. */
//@ verify
//@ requires stated.length > 0
//@ ensures forall(k: nat, k < stated.length ==> \result <= stated[k])
export function lowestOf(stated: readonly number[]): number {
  let low = stated[0]!, i = 1;
  while (i < stated.length) {
    //@ invariant 1 <= i && i <= stated.length
    //@ invariant forall(k: nat, k < i ==> low <= stated[k])
    //@ decreases stated.length - i
    low = Math.min(low, stated[i]!);
    i = i + 1;
  }
  return low;
}

export type AdultCheck = "adults_only" | "not_verified" | "ok";

/** A person may give a photo only as a known adult (core isMinor), alive, and past the app's own check. */
//@ verify
//@ ensures \result === "ok" ==> adult && live && eligible
//@ ensures !adult ==> \result === "adults_only"
//@ ensures !live ==> \result === "adults_only"
export function adultGate(adult: boolean, live: boolean, eligible: boolean): AdultCheck {
  if (!live || !adult) return "adults_only";
  return eligible ? "ok" : "not_verified";
}

// ------------------------------------------------------------------ the join

export interface JoinFacts {
  wordingOk: boolean;
  /** The number is on hold for staff, or the number or person is banned. */
  held: boolean;
  banned: boolean;
  /** A membership in this app that is not removed and not an open invitation. */
  member: boolean;
  inviteOnly: boolean;
  invited: boolean;
  /** The age told in this request (null: not a valid age), and the lowest one known before it. */
  stated: number | null;
  lowest: number | null;
  minJoinAge: number;
}
export type JoinStep = "consent_wording" | "review" | "existing" | "invite_only" | "under_age" | "join";
export interface JoinPlan {
  step: JoinStep;
  /** Keep the told age. Only a number on hold or banned is left out: it may have a new owner, and nothing about it changes. */
  recordAge: boolean;
  /** The lowest age with this statement in it. */
  effective: number | null;
}

/**
 * The order of a join. The lowest age ever stated wins, so every exit that reads a statement keeps it,
 * whatever the answer. A join needs every check, and an age that holds for this statement and for
 * every earlier one.
 */
//@ verify
//@ ensures \result.step === "join" ==> f.wordingOk && !f.held && !f.banned && !f.member && (!f.inviteOnly || f.invited) && f.stated !== null
//@ ensures \result.step === "existing" ==> f.wordingOk && !f.held && !f.banned && f.member && f.stated !== null
//@ ensures \result.step === "join" || \result.step === "existing" ==> \result.effective !== null
//@ ensures \result.effective !== null ==> (\result.step === "join" || \result.step === "existing") ==> \result.effective >= f.minJoinAge
//@ ensures f.stated !== null ==> \result.effective !== null ==> \result.effective <= f.stated
//@ ensures f.lowest !== null ==> \result.effective !== null ==> \result.effective <= f.lowest
//@ ensures \result.recordAge <==> !f.held && !f.banned
export function joinPlan(f: JoinFacts): JoinPlan {
  const clear = !f.held && !f.banned;
  const stated = f.stated;
  let effective: number | null = null;
  if (stated !== null) effective = lowerOf(stated, f.lowest);
  if (!f.wordingOk) return { step: "consent_wording", recordAge: clear, effective };
  if (!clear) return { step: "review", recordAge: false, effective };
  let ageOk = false;
  if (effective !== null) ageOk = effective >= f.minJoinAge;
  if (f.member) return { step: ageOk ? "existing" : "under_age", recordAge: true, effective };
  if (f.inviteOnly && !f.invited) return { step: "invite_only", recordAge: true, effective };
  return { step: ageOk ? "join" : "under_age", recordAge: true, effective };
}
