import type { AgeSide } from "./generated/friendIntroAge.ts";
import { adultAge, ageInRange, joinableAge, matchableAge, maxAge, minMemberAge } from "./generated/memberAge.ts";
import type { Member } from "./types.ts";

export type { AgeSide } from "./generated/friendIntroAge.ts";
export type { BirthReadings } from "./generated/memberAge.ts";

export const MIN_MEMBER_AGE = minMemberAge;
export const ADULT_AGE = adultAge;
export const MAX_AGE = maxAge;

export const validAge = (age: unknown): age is number => typeof age === "number" && ageInRange(age);

export const canJoin = (age: unknown): boolean => typeof age === "number" && joinableAge(age);

export const isMinor = (age: unknown): boolean => !canBeMatched(age);

export const canBeMatched = (age: unknown): boolean => typeof age === "number" && matchableAge(age);

export const ageSideOf = (m: Pick<Member, "age" | "teenReady" | "birthKey">): AgeSide => ({
  adult: canBeMatched(m.age),
  ready: m.teenReady === true,
  birthKey: m.birthKey ?? 0,
});

export const UNDER_MIN_AGE_DECLINE =
  "Thanks for your interest in The Network. You need to be at least 13 to join, so we can't sign you up right now. We'd love to hear from you when you're older.";
