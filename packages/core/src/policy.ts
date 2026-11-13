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
