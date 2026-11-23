// Age policy (founder decisions 2026-10-05 and 2026-10-07). One source of truth for every package.
//  - Under 13: cannot join. Declined kindly at join; nothing is stored.
//  - 13-17: can join and use the agent as a personal agent (chat, events, things to do), but are
//    NEVER matched with or connected to other people, in any role.
//  - 18+: full membership (romance and other adult-only features stay 18+).
// Missing or invalid ages fail closed: they cannot join and cannot be matched.

import { adultAge, ageConjunctionAllowed, ageInRange, ageQualifierFollows, fractionalAgeEvidence, joinableAge, matchableAge, maxAge, minMemberAge, precedingBirthdayAge } from "./generated/memberAge.ts";

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
export const AGE_STATED_BIRTHDAY = "\\bi (?:just )?turned\\s+";
const AGE_HALF = "(?:\\s+and\\s+(?:a|one)\\s+half\\b|\\.5(?!\\d)|\\s+1/2\\b)";
const AGE_MONTHS_OR_QUARTER = "\\s+and\\s+(?:(?:[1-9]|1[01]|a few|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\\s+months?|[13]/4|three quarters|a quarter)\\b";
export const AGE_PART = `(?:${AGE_HALF}|${AGE_MONTHS_OR_QUARTER}|\\s+years?${AGE_MONTHS_OR_QUARTER}(?=\\s+old\\b))`;
export const AGE_NUMBER_END = "(?:\\b|(?=y(?:rs?|ears?|\\/?o)\\b))";
export const AGE_LOOSE_TAIL = "and\\b(?!\\s+(?:\\d|(?:a|one)\\s+half\\b))|now\\b|too\\b";
export const ARTICLE_AGE_END =
  "(?:\\s+(?:(?:trans|cis|single|straight|gay|bi|queer|lesbian|pan)\\s+)*(?:person|human|guy|girl|boy|man|woman|kid|teen(?:ager)?|student|non[- ]?binary|enby))?" +
  "(?=\\s*(?:$|[.,!?;:)]|but\\b|so\\b|btw\\b|lol\\b|haha\\b|lmao\\b|here\\b|tho(?:ugh)?\\b|from\\b|looking\\b|in (?:high|middle) school\\b))";

// Grammar shared by the deterministic profile and conversation readers.
export const AGE_CURRENT_ADVERB = "(?:(?:still|currently|now)\\s+)?";
const BIRTHDAY_MONTH = "january|february|march|april|may|june|july|august|september|october|november|december";
const BIRTHDAY_WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const BIRTHDAY_COUNT = "(?:an?|a\\s+few|a\\s+couple(?:\\s+of)?|[1-9]\\d?|one|two|three|four|five|six|seven|eight|nine|ten)";
const BIRTHDAY_TIME = `(?:in\\s+(?:${BIRTHDAY_COUNT}\\s+(?:minutes?|hours?|days?|weeks?|months?)|${BIRTHDAY_MONTH}|one\\s+year|a\\s+year)|next\\s+(?:week|month|year|${BIRTHDAY_WEEKDAY})|(?:on|this)\\s+(?:${BIRTHDAY_WEEKDAY})|tomorrow|tonight|soon)\\b`;
const BIRTHDAY_SEPARATOR = "(?:\\s+|\\s*[,(]\\s*)";
const BIRTHDAY_AGE_MARKER = "(?:y(?:ears?|rs?)[\\s-]+old|y\\/?o|years of age)(?![a-z])";
export const AGE_BIRTHDAY_AFTER_AGE = `(?:\\s*${BIRTHDAY_AGE_MARKER})?${BIRTHDAY_SEPARATOR}${BIRTHDAY_TIME}`;
const DISTANT_BIRTHDAY_COUNT = "(?:[2-9]\\d?|1\\d|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a few|a couple(?: of)?)";
const DISTANT_BIRTHDAY_TIME = `in\\s+${DISTANT_BIRTHDAY_COUNT}\\s+years?\\b`;
export const AGE_DISTANT_BIRTHDAY_AFTER_AGE = `(?:\\s*${BIRTHDAY_AGE_MARKER})?${BIRTHDAY_SEPARATOR}${DISTANT_BIRTHDAY_TIME}`;
export const NOT_DISTANT_BIRTHDAY = `(?!${AGE_DISTANT_BIRTHDAY_AFTER_AGE})`;
export const AGE_BIRTHDAY_END = "(?=\\s*(?:$|[.,!?;:)]|and\\b|but\\b|lol\\b|btw\\b|tho(?:ugh)?\\b))";
const DOTTED_AGE = /(?<![a-z])y\.o\b\.?/g;
const AFTER_DOTTED_NEAR_BIRTHDAY = new RegExp(`^${BIRTHDAY_SEPARATOR}${BIRTHDAY_TIME}${AGE_BIRTHDAY_END}`);
const AFTER_DOTTED_DISTANT_BIRTHDAY = new RegExp(`^${BIRTHDAY_SEPARATOR}${DISTANT_BIRTHDAY_TIME}`);

/** Keep source offsets and keep a following birthday phrase with the age token. */
export function normalizeAgeInitialism(text: string): string {
  return text.replace(DOTTED_AGE, (marker: string, at: number) => {
    if (!marker.endsWith(".")) return "y/o";
    const after = text.slice(at + marker.length);
    const qualified = ageQualifierFollows(AFTER_DOTTED_NEAR_BIRTHDAY.test(after), AFTER_DOTTED_DISTANT_BIRTHDAY.test(after));
    return qualified ? "y/o " : "y/o.";
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


const STATED_BIRTHDAY = new RegExp(`^${AGE_STATED_BIRTHDAY}`);
const SPORTS_RECORD = new RegExp(`^${ageAndSpeaker}\\s+(?:undefeated|won|winning|record|bracket|season|score|team\\s+(?:score|record))\\b`);
const TEAM_RESULT = new RegExp(`^${ageAndSpeaker}\\s+team\\b`);

export function ageBeforeConjunction(age: number, match: RegExpExecArray): number {
  const after = match.input.slice(match.index + match[0].length);
  return ageConjunctionAllowed(age, STATED_BIRTHDAY.test(match[0]), SPORTS_RECORD.test(after), TEAM_RESULT.test(after)) ? age : NaN;
}

const AGE_FORM_START = "(?:^|[.!?;]\\s*)(?:(?:hey|hi|hello|yo)[, !]+)?";
const AGE_FORM_SELF = "(?:i'm|im|i am)\\s+";
const AGE_FORM_QUALIFIER = `${AGE_CURRENT_ADVERB}(?:(?:just|only|barely)\\s+)?`;
const AGE_FORM_END = "(?=\\s*(?:$|[!?.;](?!\\d)|,(?!\\s*\\d)|(?:is that ok(?:ay)?|here|lol|btw|tho(?:ugh)?|rn)\\b))";
const AGE_FORM_SEX = "(?:[fx](?=\\s*(?:$|[!.?,;]|here\\b|lol\\b|btw\\b|from\\b|looking\\b))|m(?=\\s*(?:$|[!.?,;]|here\\b|lol\\b|btw\\b|looking\\b)))";
const AGE_FORM_SLASH_SEX = "(?:\\s*[/]\\s*[mfx])(?=\\s*(?:$|[!.?,;]|here\\b|lol\\b|btw\\b|from\\b|looking\\b))";
const AGE_FORM_SELF_NUMBER = new RegExp(`${AGE_FORM_START}${AGE_FORM_SELF}${AGE_FORM_QUALIFIER}(\\d{1,2})(?!\\d)(?:\\s*${BIRTHDAY_AGE_MARKER})?${AGE_FORM_END}`, "g");
const AGE_FORM_SHORTHAND = new RegExp(`${AGE_FORM_START}(?:${AGE_FORM_SELF}${AGE_FORM_QUALIFIER})?(\\d{1,2})(?!\\d)(?:\\s*${AGE_FORM_SEX}|${AGE_FORM_SLASH_SEX}|\\s*${BIRTHDAY_AGE_MARKER}${AGE_FORM_END})`, "g");
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
  const future = ageQualifierFollows(AFTER_AGE_NEAR_BIRTHDAY.test(qualifier), AFTER_AGE_DISTANT_BIRTHDAY.test(qualifier));
  const possibleHeight = HEIGHT_IN_FEET.test(part);
  const birthday = possibleHeight && context !== undefined && STATED_BIRTHDAY.test(context.reading) && FRACTIONAL_BIRTHDAY_END.test(after);
  // A birthday can supply a profile age. An existing account still requires explicit age units for a refusal.
  const writtenAsAge = old !== null || AGE_PART_MARKER.test(after) || (birthday && context?.birthdaySetsProfileAge === true);
  return fractionalAgeEvidence(age, possibleHeight && !birthday, monthsOrQuarter, writtenAsAge, atClauseEnd || birthday, AGE_PART_TAIL.test(after), future);
}

const AGE_FORM_EXPLICIT_PART = new RegExp(`${AGE_FORM_START}${AGE_FORM_SELF}${AGE_FORM_QUALIFIER}(\\d{1,2})(${AGE_PART})`, "g");
const AGE_FORM_NEAR_BIRTHDAY = new RegExp(`${AGE_FORM_START}${AGE_FORM_SELF}${AGE_FORM_QUALIFIER}(\\d{1,2})\\b${AGE_BIRTHDAY_AFTER_AGE}${AGE_BIRTHDAY_END}`, "g");

/** Read a direct age disclosure in the limited relay forms. A birthday estimate can only flag the item. */
export function relayMinorAge(text: string, includeUpcoming = false): number | undefined {
  const normalized = normalizeAgeInitialism(text.trim().toLowerCase().replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"'));
  let youngest: number | undefined;
  for (const rule of [AGE_FORM_SELF_NUMBER, AGE_FORM_SHORTHAND, AGE_FORM_EXPLICIT_PART, ...(includeUpcoming ? [AGE_FORM_NEAR_BIRTHDAY] : [])]) {
    for (const reading of normalized.matchAll(rule)) {
      const digits = reading[1]!;
      const at = reading.index + reading[0].indexOf(digits);
      // The dot in 18.5 cannot start a new age at the digit 5.
      if (normalized[at - 1] === "." && /\d/.test(normalized[at - 2] ?? "")) continue;
      if (quoteStillOpen(normalized.slice(0, at))) continue;
      if (rule === AGE_FORM_EXPLICIT_PART &&
          agePartEvidenceOf(Number(digits), reading[2]!, normalized.slice(reading.index + reading[0].length), false) !== "FractionalAgeExplicit") continue;
      const approximate = rule === AGE_FORM_NEAR_BIRTHDAY;
      if (!approximate) {
        const after = normalized.slice(at + digits.length);
        if (ageQualifierFollows(AFTER_AGE_NEAR_BIRTHDAY.test(after), AFTER_AGE_DISTANT_BIRTHDAY.test(after))) continue;
      }
      const stated = Number(digits);
      const age = approximate ? precedingBirthdayAge(stated) : stated;
      if (!validAge(age) || age < 1 || canBeMatched(age)) continue;
      if (youngest === undefined || age < youngest) youngest = age;
    }
  }
  return youngest;
}
