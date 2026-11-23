// Age policy (founder decisions 2026-10-05 and 2026-10-07). One source of truth for every package.
//  - Under 13: cannot join. Declined kindly at join; nothing is stored.
//  - 13-17: can join and use the agent as a personal agent (chat, events, things to do), but are
//    NEVER matched with or connected to other people, in any role.
//  - 18+: full membership (romance and other adult-only features stay 18+).
// Missing or invalid ages fail closed: they cannot join and cannot be matched.

import { adultAge, ageConjunctionAllowed, ageInRange, fractionalAgeEvidence, joinableAge, matchableAge, maxAge, minMemberAge, ownAgeEvidenceAllowed, ownYouthCueAllowed } from "./generated/memberAge.ts";

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
  return quoteInSpan(prefix, prefix.length, prefix.length) !== undefined;
}

/** Check the exact evidence span in the normalized message, across sentence boundaries. */
export function unquotedOwnAgeEvidence(text: string, start: number, end: number): boolean {
  const quote = quoteInSpan(text, start, end);
  if (quote === undefined) return ownAgeEvidenceAllowed(false);
  return ownAgeEvidenceAllowed(!unfinishedCasualAside(text, quote));
}

const OWN_QUOTE = /^\s*(?:(?:yesterday|today|earlier|last night|this morning)\s*,?\s+)?(?:(?:i|we)(?:'ve|ve|'d|d)?\s+(?:(?:just|already|literally|basically|actually|honestly)\s+)?(?:said|told|texted|wrote|replied|posted|messaged|asked)(?:\s+(?:him|her|them|you|everyone|my [a-z]+))?|(?:me and my [a-z]+|my [a-z]+ and (?:me|i))\s+(?:(?:just|already|literally)\s+)?(?:said|told|texted|wrote|replied|posted|messaged|asked)(?:\s+(?:him|her|them|you|everyone|my [a-z]+))?|i(?:'m| am)\s+quoting myself)\s*[:,]?\s*$/;
const SPEECH_FRAME = /(?:\b(?:say|said|says|tell|told|tells|text|texted|texts|message|messaged|write|wrote|writes|quote|quoted|reply|replied|asked|asks|posted|read|reads|whispered|was like|is like)\b[^.!?;\n]*|\b(?:one|an?|the|this|that|your)\s+(?:line|draft|dialogue|script|example|excerpt|lyrics?)\s*[:,]?\s*)$/;
const LEADING_ELISION = /^(?:cause|cos|coz|cuz|bout|round|kay|nother|em|sup|til|till|tis|twas)\b/;
const beforeQuote = (text: string, at: number, start = 0): string => text.slice(start, at).split(/[.!?;\n]/).at(-1)!;

/** A repeat of the sender's own disclosure, a bare quote with no introducer, or an unfinished casual aside can still be a youth cue. */
export function ownYouthCue(text: string, start: number, end: number): boolean {
  const quote = quoteInSpan(text, start, end);
  if (!quote) return ownYouthCueAllowed(false, false, false);
  const before = beforeQuote(text, quote.at);
  const speakerBefore = quote.innerAt === undefined ? before : beforeQuote(text, quote.innerAt, quote.at + 1);
  const ownAttribution = OWN_QUOTE.test(before)
    && (quote.innerAt === undefined || OWN_QUOTE.test(speakerBefore));
  const bareQuote = !SPEECH_FRAME.test(speakerBefore);
  const unfinishedCasual = unfinishedCasualAside(text, quote);
  return ownYouthCueAllowed(true, ownAttribution || bareQuote, unfinishedCasual);
}

/** An unclosed quote with no speech frame before it is a casual aside, not another speaker's words. */
function unfinishedCasualAside(text: string, quote: Quote): boolean {
  if (quote.innerAt !== undefined) return false;
  return !SPEECH_FRAME.test(beforeQuote(text, quote.at)) && !hasClosingQuote(text, quote);
}

type Quote = { at: number; mark: "'" | '"'; innerAt?: number };

function hasClosingQuote(text: string, quote: Quote): boolean {
  for (let at = text.indexOf(quote.mark, quote.at + 1); at >= 0; at = text.indexOf(quote.mark, at + 1)) {
    if (quoteDelimiter(text, at, true)) return true;
  }
  return false;
}

function quoteDelimiter(text: string, at: number, closing: boolean): boolean {
  const prev = text[at - 1] ?? "", next = text[at + 1] ?? "";
  if (text[at] === '"') return closing || !/\d/.test(prev);
  if (/[a-z0-9]/i.test(prev) && /[a-z0-9]/i.test(next)) return false;
  if (closing) return true;
  if (/[a-z0-9]/i.test(prev)) return false;
  const after = text.slice(at + 1), before = text.slice(0, at);
  if (/^\d{2}\b/.test(after) && /\bclass of\s*$/i.test(before)) return false;
  return !LEADING_ELISION.test(after) || SPEECH_FRAME.test(beforeQuote(text, at));
}

function quoteInSpan(text: string, start: number, end: number): Quote | undefined {
  let doubleAt = -1, singleAt = -1;
  const active = (): Quote | undefined => {
    if (doubleAt >= 0 && (singleAt < 0 || doubleAt < singleAt)) return { at: doubleAt, mark: '"', innerAt: singleAt >= 0 ? singleAt : undefined };
    if (singleAt >= 0) return { at: singleAt, mark: "'", innerAt: doubleAt >= 0 ? doubleAt : undefined };
  };
  for (let i = 0; i < end; i++) {
    if (i >= start && (doubleAt >= 0 || singleAt >= 0)) return active();
    if (text[i] === '"' && quoteDelimiter(text, i, doubleAt >= 0)) doubleAt = doubleAt < 0 ? i : -1;
    if (text[i] === "'" && quoteDelimiter(text, i, singleAt >= 0)) singleAt = singleAt < 0 ? i : -1;
  }
  return active();
}

export const AGE_LOOSE_TAIL = "and\\b(?!\\s+(?:\\d|(?:a|one)\\s+half\\b))|now\\b|too\\b";
export const ARTICLE_AGE_END =
  "(?:\\s+(?:(?:trans|cis|single|straight|gay|bi|queer|lesbian|pan)\\s+)*(?:person|human|guy|girl|boy|man|woman|kid|teen(?:ager)?|student|non[- ]?binary|enby))?" +
  "(?=\\s*(?:$|[.,!?;:)]|but\\b|so\\b|btw\\b|lol\\b|haha\\b|lmao\\b|here\\b|tho(?:ugh)?\\b|from\\b|looking\\b|in (?:high|middle) school\\b))";
