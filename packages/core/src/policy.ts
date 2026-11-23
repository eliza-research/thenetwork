import type { AgeSide } from "./generated/friendIntroAge.ts";
import { adultAge, ageConjunctionAllowed, ageInRange, fractionalAgeEvidence, joinableAge, matchableAge, maxAge, minMemberAge } from "./generated/memberAge.ts";
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

const ageAndSpeaker = "\\s+and(?:\\s+also)?\\s+(?:i(?:'m|\\s+am)?|im|we|my)\\b";
export const AGE_AND_CLAUSE = `(?=${ageAndSpeaker})`;
const AGE_STATED_BIRTHDAY = "\\bi (?:just )?turned\\s+";
const AGE_HALF = "(?:\\s+and\\s+(?:a|one)\\s+half\\b|\\.5(?!\\d)|\\s+1/2\\b)";
const AGE_MONTHS_OR_QUARTER = "\\s+and\\s+(?:(?:[1-9]|1[01]|a few|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\\s+months?|[13]/4|three quarters|a quarter)\\b";
export const AGE_PART = `(?:${AGE_HALF}|${AGE_MONTHS_OR_QUARTER}|\\s+years?${AGE_MONTHS_OR_QUARTER}(?=\\s+old\\b))`;
const BIRTHDAY_MONTH = "january|february|march|april|may|june|july|august|september|october|november|december";
const BIRTHDAY_WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const BIRTHDAY_COUNT = "(?:an?|a\\s+few|a\\s+couple(?:\\s+of)?|[1-9]\\d?|one|two|three|four|five|six|seven|eight|nine|ten)";
const BIRTHDAY_TIME = `(?:in\\s+(?:${BIRTHDAY_COUNT}\\s+(?:minutes?|hours?|days?|weeks?|months?)|${BIRTHDAY_MONTH}|one\\s+year|a\\s+year)|next\\s+(?:week|month|year|${BIRTHDAY_WEEKDAY})|on\\s+(?:${BIRTHDAY_WEEKDAY})|tomorrow|tonight|soon)\\b`;
const BIRTHDAY_SEPARATOR = "(?:\\s+|\\s*[,(]\\s*)";
const BIRTHDAY_AGE_MARKER = "(?:y(?:ears?|rs?)[\\s-]+old|y\\/?o|years of age)(?![a-z])";
const AGE_BIRTHDAY_AFTER_AGE = `(?:\\s*${BIRTHDAY_AGE_MARKER})?${BIRTHDAY_SEPARATOR}${BIRTHDAY_TIME}`;
const DISTANT_BIRTHDAY_COUNT = "(?:[2-9]\\d?|1\\d|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a few|a couple(?: of)?)";
const DISTANT_BIRTHDAY_TIME = `in\\s+${DISTANT_BIRTHDAY_COUNT}\\s+years?\\b`;
const AGE_DISTANT_BIRTHDAY_AFTER_AGE = `(?:\\s*${BIRTHDAY_AGE_MARKER})?${BIRTHDAY_SEPARATOR}${DISTANT_BIRTHDAY_TIME}`;

const STATED_BIRTHDAY = new RegExp(`^${AGE_STATED_BIRTHDAY}`);
const SPORTS_RECORD = new RegExp(`^${ageAndSpeaker}\\s+(?:undefeated|won|winning|record|bracket|season|score|team\\s+(?:score|record))\\b`);
const TEAM_RESULT = new RegExp(`^${ageAndSpeaker}\\s+team\\b`);

export function ageBeforeConjunction(age: number, match: RegExpExecArray): number {
  const after = match.input.slice(match.index + match[0].length);
  return ageConjunctionAllowed(age, STATED_BIRTHDAY.test(match[0]), SPORTS_RECORD.test(after), TEAM_RESULT.test(after)) ? age : NaN;
}

const AFTER_AGE_NEAR_BIRTHDAY = new RegExp(`^${AGE_BIRTHDAY_AFTER_AGE}`);
const AFTER_AGE_DISTANT_BIRTHDAY = new RegExp(`^${AGE_DISTANT_BIRTHDAY_AFTER_AGE}`);
const AGE_PART_MARKER = new RegExp(`^\\s*${BIRTHDAY_AGE_MARKER}`);
const AGE_PART_OLD = /^\s+old\b/;
const MONTHS_OR_QUARTER = new RegExp(`${AGE_MONTHS_OR_QUARTER}$`);
const HEIGHT_IN_FEET = /^(?:\.5|\s+1\/2)$/;
const FRACTIONAL_BIRTHDAY_END = /^\s*(?:$|[.!?;](?!\d)|,(?!\s*\d))/;
const AGE_PART_TAIL = /^\s*(?:$|[,!?;:)]|\.(?!\d)|(?:and|now|too|but|so|btw|lol|haha|lmao|tho(?:ugh)?|actually|tbh|old|in (?:high|middle) school)\b)/;

/** Read the evidence of a first-person fractional age after the caller checks its scope. */
export function agePartEvidenceOf(age: number, part: string, after: string, atClauseEnd: boolean,
  context?: { reading: string; birthdaySetsProfileAge?: true }) {
  const monthsOrQuarter = MONTHS_OR_QUARTER.test(part);
  const old = monthsOrQuarter ? AGE_PART_OLD.exec(after) : null;
  const qualifier = old ? after.slice(old[0].length) : after;
  const future = AFTER_AGE_NEAR_BIRTHDAY.test(qualifier) || AFTER_AGE_DISTANT_BIRTHDAY.test(qualifier);
  const possibleHeight = HEIGHT_IN_FEET.test(part);
  const birthday = possibleHeight && context !== undefined && STATED_BIRTHDAY.test(context.reading) && FRACTIONAL_BIRTHDAY_END.test(after);
  // A birthday can supply a profile age. An existing account still requires explicit age units for a refusal.
  const writtenAsAge = old !== null || AGE_PART_MARKER.test(after) || (birthday && context?.birthdaySetsProfileAge === true);
  return fractionalAgeEvidence(age, possibleHeight && !birthday, monthsOrQuarter, writtenAsAge, atClauseEnd || birthday, AGE_PART_TAIL.test(after), future);
}

const DOTTED_FRACTIONAL_AGE = new RegExp(`(${AGE_PART}\\s*)y\\.o\\b\\.?`, "g");

/** Keep a fractional age marker and any qualifier in the same sentence. */
export function normalizeFractionalAgeInitialism(text: string): string {
  return text.replace(DOTTED_FRACTIONAL_AGE, (reading: string, agePart: string, at: number) => {
    if (!reading.endsWith(".")) return agePart + "y/o";
    const after = text.slice(at + reading.length);
    const future = AFTER_AGE_NEAR_BIRTHDAY.test(after) || AFTER_AGE_DISTANT_BIRTHDAY.test(after);
    return agePart + (future ? "y/o " : "y/o.");
  });
}

/**
 * True when `prefix` (the text before an age) leaves a quotation open, so the age is inside it
 * (`she said "I'm 15"`, `"I'm 15"`). Apostrophes in "I'm" and "don't", and a foot mark (`5'6`, `5'`),
 * are not quotes. A quote that has closed is not open: `he said "hi" I'm 15` is a real age.
 */
export function quoteStillOpen(prefix: string): boolean {
  let double = false, single = false;
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i]!;
    const prev = i > 0 ? prefix[i - 1]! : "";
    const next = i + 1 < prefix.length ? prefix[i + 1]! : "";
    if (c === "\"") {
      // 6" is inches, unless this mark closes a quote that is already open.
      if (!double && /[0-9]/.test(prev)) continue;
      double = !double;
      continue;
    }
    if (c !== "'") continue;
    if (/[a-z0-9]/.test(prev) && /[a-z0-9]/.test(next)) continue;
    if (!single && (/[0-9]/.test(prev) || /[a-z]/.test(prev))) continue;
    single = !single;
  }
  return double || single;
}

export const AGE_LOOSE_TAIL = "and\\b(?!\\s+(?:\\d|(?:a|one)\\s+half\\b))|now\\b|too\\b";
export const ARTICLE_AGE_END =
  "(?:\\s+(?:(?:trans|cis|single|straight|gay|bi|queer|lesbian|pan)\\s+)*(?:person|human|guy|girl|boy|man|woman|kid|teen(?:ager)?|student|non[- ]?binary|enby))?" +
  "(?=\\s*(?:$|[.,!?;:)]|but\\b|so\\b|btw\\b|lol\\b|haha\\b|lmao\\b|here\\b|tho(?:ugh)?\\b|from\\b|looking\\b|in (?:high|middle) school\\b))";
