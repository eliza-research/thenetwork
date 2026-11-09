//@ backend dafny
// The decisions of web phone verification (otp.ts). Import-free, proved by LemmaScript
// (docs/formal-verification.md). OtpService calls these functions; the store keeps the counts.
// The store counts the attempts and marks the code used (pg-store.ts claimAttempt and
// consumeChallenge, in SQL). That SQL is not proved. OtpService asks otpMayAttempt first, so a
// challenge that this rule refuses never gets to it. The attempt bound under concurrent checks comes
// from the SQL guard, not from this file.

/** A challenge as verify sees it. consumed is true when consumedAt is set. */
export interface OtpChallengeView { attempts: number; expiresAt: number; consumed: boolean }

/** The windows of the start limits, in milliseconds. */
export interface OtpWindows { hourMs: number; dayMs: number; minGapMs: number }

/** The start limits in the order that OtpService.start asks them. The first one that refuses stops the start. */
export const OTP_REFUSED_IP = 0;
export const OTP_REFUSED_PHONE = 1;
export const OTP_REFUSED_PHONE_DAY = 2;
export const OTP_REFUSED_GLOBAL = 3;

function isDigit(c: number): boolean {
  //@ verify
  return c >= 48 && c <= 57;
}

function allDigits(s: string): boolean {
  //@ verify
  //@ decreases s.length
  return s.length === 0 || (isDigit(s.charCodeAt(0)) && allDigits(s.slice(1)));
}

/** A code that can be right: 4 to 10 ASCII digits. The same as /^\d{4,10}$/. Other text is never checked. */
export function otpCodeShape(code: string): boolean {
  //@ verify
  //@ ensures \result ==> code.length >= 4 && code.length <= 10 && allDigits(code)
  return code.length >= 4 && code.length <= 10 && allDigits(code);
}

/**
 * True when the challenge can take one more code check: not used, not expired at `at`, and fewer
 * than maxAttempts checks so far. An expired or used challenge never verifies.
 */
export function otpMayAttempt(c: OtpChallengeView, maxAttempts: number, at: number): boolean {
  //@ verify
  //@ ensures \result ==> !c.consumed && at < c.expiresAt && c.attempts < maxAttempts
  //@ ensures c.consumed || at >= c.expiresAt || c.attempts >= maxAttempts ==> !\result
  return !c.consumed && at < c.expiresAt && c.attempts < maxAttempts;
}

/** The expiry of a new challenge. */
export function otpExpiry(at: number, ttlMs: number): number {
  //@ verify
  //@ requires ttlMs > 0
  //@ ensures \result > at
  return at + ttlMs;
}

/**
 * The retry-after of a refused start. refused is the index of the limit that refused (OTP_REFUSED_*).
 * The phone limit names the rest of the 30 s gap when the gap refused; the day limit names the end of
 * the day; the others name the end of the hour. prevAt is the last counted send to the number (hasPrev
 * false when there is none).
 */
export function otpRetryAfterMs(refused: number, at: number, hasPrev: boolean, prevAt: number, w: OtpWindows): number {
  //@ verify
  //@ requires 0 <= refused && refused <= 3
  //@ requires at >= 0 && w.hourMs > 0 && w.dayMs > 0 && w.minGapMs > 0
  //@ ensures \result > 0
  //@ ensures refused === 2 ==> \result <= w.dayMs
  //@ ensures refused === 1 && hasPrev && at - prevAt < w.minGapMs ==> \result === w.minGapMs - (at - prevAt)
  //@ ensures !(refused === 1 && hasPrev && at - prevAt < w.minGapMs) && refused !== 2 ==> \result <= w.hourMs
  const hourLeft = w.hourMs - (at % w.hourMs);
  if (refused === 2) return w.dayMs - (at % w.dayMs);
  if (refused === 1 && hasPrev && at - prevAt < w.minGapMs) return w.minGapMs - (at - prevAt);
  return hourLeft;
}
