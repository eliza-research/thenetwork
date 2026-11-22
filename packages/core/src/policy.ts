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

const ageAndSpeaker = "\\s+and(?:\\s+also)?\\s+(?:i(?:'m|\\s+am)?|im|we|my)\\b";
export const AGE_AND_CLAUSE = `(?=${ageAndSpeaker})`;
export const AGE_HALF = "(?:\\s+and\\s+(?:a|one)\\s+half\\b|\\.5(?!\\d)|\\s+1/2\\b)";
/** "15 and 3 months", "17 and 3/4": a part of a year after the age. */
export const AGE_MONTHS = "(?:\\s+and\\s+(?:\\d{1,2}|a few|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\\s+months?\\b|\\s+and\\s+(?:3/4|three quarters|a quarter)\\b)";
/** What may follow "15 and a half", "16.5" or "15 and 3 months" when the age is 13 or more. */
export const AGE_PART_TAIL = "$|[,!?;:)]|\\.(?!\\d)|and\\b|now\\b|too\\b|but\\b|so\\b|btw\\b|lol\\b|haha\\b|lmao\\b|tho(?:ugh)?\\b|actually\\b|tbh\\b|old\\b|in (?:high|middle) school\\b";
/** Bare "5.5" and "5 1/2" can give a height in feet. */
const heightInFeet = /(?:\.5|\s1\/2)$/;
const statedBirthday = /^i (?:just )?turned\s/;
const statedHalfAge = new RegExp(`${AGE_HALF}$`);
const explicitAgeUnits = /^\s*(?:y(?:ears?|rs?)[\s-]+old|y\.?\/?o\.?|years of age)\b/;
const sportsCountSuffix = new RegExp(`^${ageAndSpeaker}\\s+(?:undefeated|won|winning)\\b`);
export function ageBeforeConjunction(age: number, match: RegExpExecArray): number {
  if (canJoin(age) || statedBirthday.test(match[0])) return age;
  const suffix = match.input.slice(match.index + match[0].length);
  if (age < 8 && heightInFeet.test(match[0]) && !explicitAgeUnits.test(suffix)) return NaN;
  if (statedHalfAge.test(match[0])) return age;
  return sportsCountSuffix.test(suffix) ? NaN : age;
}

export const AGE_LOOSE_TAIL = "and\\b(?!\\s+(?:\\d|(?:a|one)\\s+half\\b))|now\\b|too\\b";
export const ARTICLE_AGE_END =
  "(?:\\s+(?:(?:trans|cis|single|straight|gay|bi|queer|lesbian|pan)\\s+)*(?:person|human|guy|girl|boy|man|woman|kid|teen(?:ager)?|student|non[- ]?binary|enby))?" +
  "(?=\\s*(?:$|[.,!?;:)]|but\\b|so\\b|btw\\b|lol\\b|haha\\b|lmao\\b|here\\b|tho(?:ugh)?\\b|from\\b|looking\\b|in (?:high|middle) school\\b))";
