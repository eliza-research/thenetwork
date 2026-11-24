// Reports about another member (PRD 36.3, 40.5; docs/admin-console.md 3.7.1): "report X ..." in any
// app, and the answer to slop's check-in after a date. A report keeps ids and a kind, never the
// reporter's words. Urgent kinds (harassment, unsafe, scam, minor) have a 1-hour staff target; the
// others 24 hours.
import type { MemberId } from "@thenetwork/core";
import { ADULT_AGE, isMinor, quoteStillOpen, validAge } from "@thenetwork/core";
import { acceptsMinorReportEvidence, acceptsReportEvidence } from "../../core/src/generated/safetyCase.ts";

export type ReportKind = "harassment" | "lying" | "no_show" | "unsafe" | "scam" | "minor" | "other";
export type ReportStatus = "open" | "held" | "banned" | "dismissed";
export interface SafetyReport {
  id: string; kind: ReportKind; reporterId: MemberId; subjectId: MemberId; opportunityId?: string; at: number; status: ReportStatus;
  /** "message": "report X"; "check_in": the answer after a date. */
  source: "message" | "check_in";
  decidedBy?: string; decidedAt?: number;
}
export const URGENT_REPORTS: ReadonlySet<ReportKind> = new Set(["harassment", "unsafe", "scam", "minor"]);
const ABSENCE = /\b(no[- ]?show(ed)?|(?:never|didn'?t|did not) (?:show(?:ed)?(?: up)?|c[ao]me|turn(?:ed)? up|arriv(?:e|ed))(?!\s+(?:me|us|you|him|her|them|up|off|around|any|much)\b)|stood (?:me|us) up)\b/i;
const MISSED_MEETING = /\b(?:(?:couldn'?t|could not|didn'?t|did not)\s+make\s+it\b(?!\s+(?:happen|work|awkward|worse|better|easy|hard)\b)|had\s+to\s+bail\b(?!\s+(?:me|us|you|him|her|them|out)\b))/i;
const ABSENCE_PHRASE = new RegExp(`${ABSENCE.source}|${MISSED_MEETING.source}`, "gi");
const FIRST_PERSON_ABSENCE = /\b(?:i|we)(?:\s+(?:[a-z]+ly|just|still|even|also|both))*(?:\s+(?:was|were)(?:\s+(?:a|the))?)?\s+$/i;
const IMPLIED_FIRST_PERSON = /^\s*(?:sorry|sadly|unfortunately)?\s*$/i;

const NON_COUNTERPART_SUBJECT = /^(?:i|we|it|you|that|this|there|which|what|who|son|daughter|kid|kids|child|baby|brother|sister|nephew|niece|cousin|dog|cat|puppy|car|lease|apartment|building|startup|company|record|streak|bike|laptop|phone|team|group|band|club|class|cohort|batch|dinner|coffee|parking|uber|lyft|bill|weather|food|drinks?|meal|lunch|breakfast|table|ticket|cab|taxi|venue|place|restaurant|bar|cafe|hotel|service|film|movie|show|drive|ride|walk|flight|trip|check|order|cost|price|entry|cocktail|beer|wine|tip|admission)$/i;
const SUBJECT_AGE_WORDS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen".split(" ");
const GRADE_WORDS = "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth";
const YOUTH_MARKER = "a minor|under\\s*age|under 18|not (?:18|an adult) yet|in (?:high|middle) school|a (?:high school|hs|middle school) (?:student|freshman|sophomore|junior|senior)|a (?:freshman|sophomore|junior|senior) in (?:high school|hs)|a kid|a child|a teen(?:ager)?"
  + `|in (?:the )?(?:\\d{1,2}(?:st|nd|rd|th)|${GRADE_WORDS}) grade|a (?:\\d{1,2}(?:st|nd|rd|th)|${GRADE_WORDS}) grader`;
const AGE_REPORT = new RegExp(
  "\\b(?<subject>my (?:date|match)|(?:the|this) (?:guy|girl|person(?: i met)?|dude|man|woman)|[a-z][a-z'-]+?)"
  + "(?:'s|'re| is| was| are| were| turned out to be| turns out to be| just turned| turned| turns| will turn|'s turning|'s just turned)[ \\t]+"
  + "(?:(?:only|just|actually|literally|barely|like|still)[ \\t]+){0,2}"
  + "(?:(?:an?[ \\t]+)?(?<age>\\d{1,2}(?!\\d)|(?:" + SUBJECT_AGE_WORDS.join("|") + ")\\b)"
  + "(?:[ \\t-]*(?:years?[ \\t-]+old|yrs?[ \\t-]+old|y/?o)\\b)?"
  + "(?=[ \\t]*(?:$|\\.(?!\\d)|[,!?;)\n]|(?:and|but|from|here|tbh|apparently)\\b|(?:last|next|this) (?:week|month|year)\\b|yesterday\\b|tomorrow\\b|today\\b|recently\\b|in (?:january|february|march|april|may|june|july|august|september|october|november|december)\\b))"
  + "|(?<youth>" + YOUTH_MARKER + ")\\b(?![ \\t]+(?:teacher|counselor|coach|principal|nurse|staff|at heart|of a)\\b))",
  "gi",
);
const BARE_MINOR_REPORT = new RegExp("^(?:report[ \\t]+[^:;,]+[:;,][ \\t]*)?(?:" + YOUTH_MARKER + ")[.!]*$", "i");
const AGE_REPORT_CONDITION = /\b(?:if|unless|suppose|whether|imagine|hypothetically)\b/i;

/** Current or newly discovered counterpart age evidence. Age reports do not write a person's stated age. */
export function otherAgeStated(body: string): number | undefined {
  const t = body.normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
  let lowest: number | undefined;
  for (const match of t.matchAll(AGE_REPORT)) {
    const { subject, age, youth } = match.groups!;
    const value = youth ? ADULT_AGE - 1 : age && /^\d/.test(age) ? Number(age) : SUBJECT_AGE_WORDS.indexOf(age?.toLowerCase() ?? "");
    const eligibleSubject = !!subject && !NON_COUNTERPART_SUBJECT.test(subject);
    const prefix = reportClauseBefore(t, match.index);
    const affirmative = !quoteStillOpen(t.slice(0, match.index)) && !ACTIVE_DENIAL.test(prefix)
      && !AGE_REPORT_CONDITION.test(prefix) && !t.slice(match.index + match[0].length).trimStart().startsWith("?");
    if (acceptsMinorReportEvidence(eligibleSubject, validAge(value) && isMinor(value), affirmative)) {
      lowest = lowest === undefined ? value : Math.min(lowest, value);
    }
  }
  return lowest;
}

const KINDS: [ReportKind, RegExp][] = [
  ["unsafe", /\b(unsafe|not safe|scared|afraid|terrified|threat(en(ed|ing)?)?|follow(ed|ing) me|stalk(ed|ing)? me|(?:wouldn'?t|would not|didn'?t|did not|refused to) let me (go|leave|out)|grabbed|touched me|assault(ed)?|hit me(?<casualContact>\s+up\b)?|(?:punched|slapped|shoved|kicked|attacked) me|drugged|spiked|forced|hurt me|violent|(?:pulled|pointed|brandished) (?:out )?(?:a |their |his |her )?(?:knife|gun|weapon))\b/i],
  ["harassment", /\b(harass(ed|ing|ment)?|creep(y)?|kept (texting|messaging|calling)|(?:wouldn'?t|would not|refused to) stop|rude|insult(ed|ing)?|aggressive|hostile|abusive|slur|pushy|inappropriate|sexual comments?)\b/i],
  ["scam", /\b(scam(mer|med)?|(?:asked|demanded|requested)(?: me| that i)? (?:for |to (?:send|wire|transfer|buy) |(?:send|wire|transfer|buy) )(?:some |a |the )?(?:money|cash|gift cards?|crypto|bitcoin)|asked to borrow money|wire (?:me|money))\b/i],
  ["lying", /\b(lied|lying|liar|fake|catfish(ed)?|not (who|what) (they|he|she) said|(didn'?t|doesn'?t) look like (their|his|her) (photos?|pics?|pictures?)|old photos?|(lied|lying) about (their|his|her) age|older than|younger than (they|he|she) said|married|has a (girlfriend|boyfriend|wife|husband|partner))\b/i],
];

const ACTIVE_DENIAL = /\b(?:not(?! only\b)|never|nothing|without|no(?! way\b)|(?:is|are|was|were|did|do|would)n't|(?:no|don't|do not) need to)\s+(?:(?:at all|really|very|even|remotely|a bit|make me feel|an?|be) +)*(?:[a-z]+ (?:or|nor) +)?$/i;
const CORRECTED_MARRIAGE = /\b(?:not married|isn't married|wasn't married)\s*[,;]?\s*but\s+(?:he|she|they)\s+(?:is|was|are|were)\s*(?:$|[.!?,;])/i;
const CURRENT_DANGER = /^(?:(?:i am|i'm|we are|we're) (?:in (?:immediate )?danger(?: (?:right now|now))?|(?:not safe|being threatened) (?:right now|now))|(?:i |we )?need emergency help(?: (?:right now|now))?|(?:(?:he|she|they|someone) (?:is|are)|he's|she's|they're) (?:following|threatening|attacking) (?:me|us)(?: (?:right now|now))?)$/i;
const COUNTERPART_SUBJECT = /^(?:he|she|they|my date|the person i met)\b/i;
const DIRECT_CHOKING_REPORT = /^(?:he|she|they|my date|the person i met) choked me[.!]?$/i;

function directClauses(text: string): string[] {
  return (text.normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/"[^"]*(?:"|$)/g, "")
    .match(/[^.!?,;:\n—]+[!?]?/g) ?? []).map(clause => clause.trim());
}

/** A direct present-tense disclosure, without treating a report category as proof of danger now. */
export function statesImmediateDanger(text: string): boolean {
  return directClauses(text).some(clause => CURRENT_DANGER.test(clause.replace(/!$/, "")));
}

/** Keep a first-person disclosure separate from an attributable reply about the meeting. */
export function emergencyCheckInReportKind(text: string): ReportKind | undefined {
  for (const clause of directClauses(text)) {
    if (!COUNTERPART_SUBJECT.test(clause) || clause.endsWith("?")) continue;
    const kind = checkInReport(clause);
    if (kind) return kind;
  }
}

const reportClauseBefore = (text: string, at: number) =>
  text.slice(0, at).split(/[,.!?:;]|\b(?:but|however|although)\b/i).at(-1) ?? "";

function reportsHarm(text: string, marker: RegExp): boolean {
  for (const m of text.matchAll(new RegExp(marker.source, "gi"))) {
    const affirmative = !ACTIVE_DENIAL.test(reportClauseBefore(text, m.index));
    if (acceptsReportEvidence(affirmative, m.groups?.casualContact !== undefined)) return true;
  }
  return false;
}

/** Read the speaker's past absence separately from an allegation about a counterpart. */
export function attendanceAbsences(text: string): { self: boolean; other: boolean } {
  const t = text.normalize("NFKC").replace(/[‘’ʼ]/g, "'");
  let self = false, other = false;
  for (const match of t.matchAll(ABSENCE_PHRASE)) {
    const prefix = reportClauseBefore(t, match.index);
    if (ACTIVE_DENIAL.test(prefix)) continue;
    if (FIRST_PERSON_ABSENCE.test(prefix) || (IMPLIED_FIRST_PERSON.test(prefix) && MISSED_MEETING.test(match[0]))) self = true;
    else other = true;
  }
  return { self, other };
}

const ARRIVAL_LEAD = /^i (?:came|showed up|was there)(?:[,.]\s*|\s+)(?:but\s+)?/i;
const NOBODY_ARRIVED = /^(?:nobody|no one) (?:came|showed up|turned up)$/i;
const ABSENT_COUNTERPART = /^(.+?) (?:flaked(?: out)?(?: on (?:me|us))?|bailed on (?:me|us))$/i;
const DIRECT_COUNTERPART = /^(?:he|she|they|my date|the person i met)$/i;

/** Read a direct absence statement in a receipt-backed check-in about one accepted counterpart. */
export function directFeedbackAbsence(text: string, counterpartNames: readonly string[]): boolean {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  const statement = normalize(text).replace(/[.!]$/, "").replace(ARRIVAL_LEAD, "");
  if (NOBODY_ARRIVED.test(statement)) return true;
  const subject = ABSENT_COUNTERPART.exec(statement)?.[1];
  return subject !== undefined && (DIRECT_COUNTERPART.test(subject) || counterpartNames.some(name => normalize(name) === subject));
}

/** Read each direct named absence in a group reply. Resolve each name against the booked roster. */
export function groupFeedbackAbsence(text: string, attendees: readonly { id: MemberId; names: readonly string[] }[]): MemberId[] {
  const report = text.normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/"[^"]*(?:"|$)/g, "");
  const clauses = report.split(/(?<=[.!?;:])\s*|[\n—]|\b(?:but|while|whereas|however)\b/i);
  const missing = new Set<MemberId>();
  for (const value of clauses) {
    const clause = value.trim();
    if (!clause || clause.endsWith("?")) continue;
    const statement = clause.replace(/[.!;:]$/, "").trim();
    if (/^(?:nobody|no one) else (?:came|showed(?: up)?|turned up)$/i.test(statement)) return attendees.map(attendee => attendee.id);
    const [match] = statement.matchAll(ABSENCE_PHRASE);
    if (!match || !match.index || statement.slice(match.index + match[0].length).trim()) continue;
    const subjects = statement.slice(0, match.index).trim().toLowerCase().split(/\s*(?:,\s*(?:and\s+)?|\band\b)\s*/i);
    const ids = subjects.map(subject => {
      const names = attendees.filter(attendee => attendee.names.some(name => name.normalize("NFKC").trim().toLowerCase() === subject));
      return names.length === 1 ? names[0]!.id : undefined;
    });
    if (ids.every((id): id is MemberId => id !== undefined)) for (const id of ids) missing.add(id);
  }
  return [...missing];
}

/** The kind of a report from its words (most serious first). "other" when nothing names a kind. */
export function reportKindOf(text: string): ReportKind {
  const t = text.normalize("NFKC").replace(/[‘’ʼ]/g, "'");
  if (otherAgeStated(t) !== undefined || BARE_MINOR_REPORT.test(t.trim())) return "minor";
  for (const [k, re] of KINDS) {
    const directHarm = k === "unsafe" && DIRECT_CHOKING_REPORT.test(t.trim());
    if (reportsHarm(t, re) || directHarm || (k === "lying" && CORRECTED_MARRIAGE.test(t))) return k;
  }
  if (attendanceAbsences(t).other || reportsHarm(t, /\bghosted me\b/i)) return "no_show";
  return "other";
}

/**
 * Does an answer to the post-date check-in report something? A no-show, or any report kind, said
 * about the date ("he never showed", "she was rude and kept pushing", "report: fake photos"). A plain
 * "it was fine" or "not my type" is not a report.
 */
export function checkInReport(text: string): ReportKind | undefined {
  const k = reportKindOf(text);
  if (k !== "other") return k;
  return reportsHarm(text.normalize("NFKC").replace(/[‘’ʼ]/g, "'"), /\b(report|flag|safety team)\b/i) ? "other" : undefined;
}
