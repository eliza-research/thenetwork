// Age policy (founder decisions 2026-10-05 and 2026-10-07). One source of truth for every package.
//  - Under 13: cannot join. Declined kindly at join; nothing is stored.
//  - 13-17: can join and use the agent as a personal agent (chat, events, things to do), but are
//    NEVER matched with or connected to other people, in any role.
//  - 18+: full membership (romance and other adult-only features stay 18+).
// Missing or invalid ages fail closed: they cannot join and cannot be matched.

export const MIN_MEMBER_AGE = 13;
export const ADULT_AGE = 18;

/** Oldest plausible human age. Anything above is a data error, treated as unknown (fail closed). */
export const MAX_AGE = 120;

/** True for a number in the usable range. NaN and Infinity fail both comparisons, so they fall out here too. */
export function ageInRange(age: number): boolean {
  //@ verify
  //@ type age real
  //@ ensures \result === (age >= 0 && age <= MAX_AGE)
  return age >= 0 && age <= MAX_AGE;
}

/** True for a number from MIN_MEMBER_AGE to MAX_AGE. */
export function joinableAge(age: number): boolean {
  //@ verify
  //@ type age real
  //@ ensures \result ==> age >= MIN_MEMBER_AGE && age <= MAX_AGE
  //@ ensures age < MIN_MEMBER_AGE ==> !\result
  return ageInRange(age) && age >= MIN_MEMBER_AGE;
}

/** True for a number from ADULT_AGE to MAX_AGE. */
export function adultAge(age: number): boolean {
  //@ verify
  //@ type age real
  //@ ensures \result ==> age >= ADULT_AGE && age <= MAX_AGE
  //@ ensures age < ADULT_AGE ==> !\result
  return ageInRange(age) && age >= ADULT_AGE;
}

/** True for a usable age: a number from 0 to MAX_AGE. Anything else is treated as unknown (fail closed). */
export const validAge = (age: unknown): age is number => typeof age === "number" && ageInRange(age);

/** True if someone of this age may join The Network (13 or older). */
export const canJoin = (age: unknown): boolean => typeof age === "number" && joinableAge(age);

/** True if this age is under 18, or unknown/invalid (fail closed). */
export const isMinor = (age: unknown): boolean => !(typeof age === "number" && adultAge(age));

/** True if a member of this age may be matched with or connected to other people (18 or older). */
export const canBeMatched = (age: unknown): boolean => !isMinor(age);

/** The kind decline sent to someone under 13. Never says why in more detail than needed; stores nothing. */
export const UNDER_MIN_AGE_DECLINE =
  "Thanks for your interest in The Network. You need to be at least 13 to join, so we can't sign you up right now. We'd love to hear from you when you're older.";
