// Reports about another member (PRD 36.3, 40.5; docs/admin-console.md 3.7.1): "report X ..." in any
// app, and the answer to slop's check-in after a date. A report keeps ids and a kind, never the
// reporter's words. Urgent kinds (harassment, unsafe, scam, minor) have a 1-hour staff target; the
// others 24 hours.
import type { MemberId } from "@thenetwork/core";

export type ReportKind = "harassment" | "lying" | "no_show" | "unsafe" | "scam" | "minor" | "other";
export type ReportStatus = "open" | "held" | "banned" | "dismissed";
export interface SafetyReport {
  id: string; kind: ReportKind; reporterId: MemberId; subjectId: MemberId; opportunityId?: string; at: number; status: ReportStatus;
  /** "message": "report X"; "check_in": the answer after a date. */
  source: "message" | "check_in";
  decidedBy?: string; decidedAt?: number;
}
export const URGENT_REPORTS: ReadonlySet<ReportKind> = new Set(["harassment", "unsafe", "scam", "minor"]);

const MINOR_KIN = "son|daughter|kid|kids|child|baby|brother|sister|nephew|niece|cousin|dog|cat|puppy|car|lease|apartment|building|startup|company|record|streak|bike|laptop|phone|team|group|band|club|class|cohort|batch";
const MINOR_NOT_AGE = "(?![\\d:.'\"]|\\s*(?:min|mins|minutes|hours?|hrs?|days?|weeks?|dollars|bucks|blocks|stops|am|pm|ft|foot|feet|out of|people|members|years? (?:older|younger))\\b)";
const MINOR_SUBJ = "(?:he|she|they|my (?:date|match)|the (?:guy|girl|person)|this (?:guy|girl|person)|[a-z][a-z'-]+)";
const MINOR_VERB = "(?:'s|'re| is| was| are| were|\\s+(?:turned|turns) out to be|\\s+(?:said|told me) (?:he|she|they) (?:is|was))";
const MINOR_MOD = "(?:(?:only|just|actually|literally|like|barely)\\s+)?";
const MINOR_NUM = "(1[0-7]|[0-9])";

const KINDS: [ReportKind, RegExp][] = [
  ["minor", new RegExp(
    `\\b(` +
    `under ?age|underage|a minor|not (?:18|an adult) yet|in (?:high|middle) school|a (?:kid|child|teen(?:ager)?)|` +
    `(?!(?:${MINOR_KIN}|i|it|that|this|there|which|what|who)\\b)${MINOR_SUBJ}${MINOR_VERB}\\s+${MINOR_MOD}${MINOR_NUM}${MINOR_NOT_AGE}|` +
    `a\\s+${MINOR_NUM}[\\s-]?(?:years?|yrs?)[\\s-]?old\\b|` +
    `${MINOR_NUM}[\\s-]?(?:years?|yrs?)[\\s-]?old\\b|` +
    `(?:${MINOR_VERB}\\s+${MINOR_MOD}|a\\s+)${MINOR_NUM}[\\s-]?(?:yo|y\\/?o)\\b|` +
    `\\b${MINOR_NUM}[\\s-]?(?:yo|y\\/?o)\\b(?!\\s*(?:whisky|whiskey|scotch|bourbon|wine|cheese|rum|brandy|cask|barrel|dog|cat|puppy))` +
    `)\\b`,
    "i"
  )],
  ["unsafe", /\b(unsafe|not safe|scared|afraid|threat(en(ed|ing)?)?|follow(ed|ing) me|wouldn'?t let me (go|leave)|grabbed|touched me|assault(ed)?|drugged|spiked|forced|hurt me|violent)\b/i],
  ["harassment", /\b(harass(ed|ing|ment)?|creep(y)?|kept (texting|messaging|calling)|wouldn'?t stop|rude|insult(ed|ing)?|aggressive|hostile|abusive|slur|pushy|inappropriate|sexual comments?)\b/i],
  ["scam", /\b(scam(mer|med)?|asked (me )?for money|venmo|cash ?app|zelle|crypto|bitcoin|gift cards?|invest(ment)?|wire (me|money))\b/i],
  ["lying", /\b(lied|lying|liar|fake|catfish(ed)?|not (who|what) (they|he|she) said|(didn'?t|doesn'?t) look like (their|his|her) (photos?|pics?|pictures?)|old photos?|(lied|lying) about (their|his|her) age|older than|younger than (they|he|she) said|married|has a (girlfriend|boyfriend|wife|husband|partner))\b/i],
  ["no_show", /\b(no[- ]?show(ed)?|never (showed|came|turned up)|didn'?t (show|come|turn up)|stood me up|ghosted me)\b/i],
];

/** The kind of a report from its words (most serious first). "other" when nothing names a kind. */
export function reportKindOf(text: string): ReportKind {
  const t = text.normalize("NFKC").replace(/[‘’]/g, "'");
  for (const [k, re] of KINDS) if (re.test(t)) return k;
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
  return /\b(report|flag|safety team)\b/i.test(text) ? "other" : undefined;
}
