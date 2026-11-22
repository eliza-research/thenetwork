// Age policy (founder decisions 2026-10-05 and 2026-10-07). One source of truth for every package.
//  - Under 13: cannot join. Declined kindly at join; nothing is stored.
//  - 13-17: can join and use the agent as a personal agent (chat, events, things to do), but are
//    NEVER matched with or connected to other people, in any role.
//  - 18+: full membership (romance and other adult-only features stay 18+).
// Missing or invalid ages fail closed: they cannot join and cannot be matched.

import { adultAge, ageInRange, joinableAge, matchableAge, maxAge, minMemberAge } from "./generated/memberAge.ts";

// spec/memberAge.md, "Age data outside the human range is unusable"
export const MIN_MEMBER_AGE = minMemberAge;
export const ADULT_AGE = adultAge;
export const MAX_AGE = maxAge;

/** True for a usable age. Unknown or invalid input fails closed. */
export const validAge = (age: unknown): age is number => typeof age === "number" && ageInRange(age);

/** True if someone of this age may join The Network. */
export const canJoin = (age: unknown): boolean => typeof age === "number" && joinableAge(age);

/** True if this age is under 18, or unknown or invalid. */
export const isMinor = (age: unknown): boolean => !canBeMatched(age);

/** True if a member of this age may be matched with or connected to other people. */
export const canBeMatched = (age: unknown): boolean => typeof age === "number" && matchableAge(age);

/** The kind decline sent to someone under 13. Never says why in more detail than needed; stores nothing. */
export const UNDER_MIN_AGE_DECLINE =
  "Thanks for your interest in The Network. You need to be at least 13 to join, so we can't sign you up right now. We'd love to hear from you when you're older.";

/**
 * Fragments shared by the slop reader and the network reader. Each reader still has its own
 * other endings. These are the pieces that have to stay the same, or the two readers drift.
 */

/** Bare "and", "now", or "too". This ends an age only at MIN_MEMBER_AGE or older. */
export const AGE_LOOSE_TAIL = "and\\b|now\\b|too\\b";

/** "and I/we/my ..." starts a new clause, so the number is the age at every age. "and 0" is not. */
export const AGE_AND_CLAUSE = "(?=\\s+and(?:\\s+also)?\\s+(?:i(?:'m|\\s+am)?|im|we|my)\\b)";

/** "and a half" or "and one half" stays part of the age. */
export const AGE_AND_A_HALF = "\\s+and\\s+(?:a|one)\\s+half\\b";

/** "and a half", ".5", or "1/2" stays part of the age. */
export const AGE_HALF = `(?:${AGE_AND_A_HALF}|\\s*\\.5(?!\\d)|\\s+1\\/2\\b)`;

/** A measure after a half is not an age. "years old" stays an age. */
export const AGE_NOT_MEASURE = "(?!\\s*(?:minutes?|mins?|hours?|hrs?|miles?|mi\\b|km\\b|blocks?|percent|%|feet|ft\\b|inch(?:es)?\\b|steps?\\b|days?\\b|weeks?\\b|months?\\b|years?(?!\\s+old)\\b))";

/**
 * The number, when a bare "and", "now", or "too" may end it. Under MIN_MEMBER_AGE this is not an
 * age, so the decline path never sees it. A move of the generated minimum moves this test with it.
 */
export const ageAtLeastMin = (n: number): number => (n >= MIN_MEMBER_AGE && n < 100 ? n : NaN);
