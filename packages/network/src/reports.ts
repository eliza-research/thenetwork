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

const KINDS: [ReportKind, RegExp][] = [
  ["minor", /\b(under ?age|underage|a minor|(he|she|they)(?:'s|'re| is| was| are| were) (?:only |just )?(1[0-7]|[0-9])(?![\d:.'"]|\s*(min|mins|minutes|hours?|hrs?|days?|weeks?|dollars|bucks|blocks|stops|am|pm|ft|foot|feet|out of|years? (older|younger))\b)|(1[0-7]|[0-9]) years? old|in (high|middle) school|a (kid|child|teen(ager)?))\b/i],
  ["unsafe", /\b(unsafe|not safe|scared|afraid|threat(en(ed|ing)?)?|follow(ed|ing) me|wouldn'?t let me (go|leave)|grabbed|touched me|assault(ed)?|drugged|spiked|forced|hurt me|violent)\b/i],
  ["harassment", /\b(harass(ed|ing|ment)?|creep(y)?|kept (texting|messaging|calling)|wouldn'?t stop|rude|insult(ed|ing)?|aggressive|hostile|abusive|slur|pushy|inappropriate|sexual comments?)\b/i],
  ["scam", /\b(scam(mer|med)?|asked (me )?for money|venmo|cash ?app|zelle|crypto|bitcoin|gift cards?|invest(ment)?|wire (me|money))\b/i],
  ["lying", /\b(lied|lying|liar|fake|catfish(ed)?|(?:not|weren'?t|wasn'?t|isn'?t|aren'?t) (who|what) (they|he|she) said|(didn'?t|doesn'?t) look like (their|his|her) (photos?|pics?|pictures?)|old photos?|(lied|lying) about (their|his|her) age|older than|younger than (they|he|she) said|married|has a (girlfriend|boyfriend|wife|husband|partner))\b/i],
];

/** Straight quotes, so "didn't" and "didn’t" are the same word. */
function normReport(text: string): string {
  return text.normalize("NFKC").replace(/[‘’ʼ]/g, "'");
}

/**
 * A negation in the same clause, in the four words before `at`. "no way" is not a negation.
 * The check-in files a report from these words. "not rude" must not become harassment.
 */
export function negatedInClause(text: string, at: number): boolean {
  const before = text.slice(0, at).split(/[,.;!?]|\bbut\b|\bhowever\b|\bthough\b/i).pop() ?? "";
  const tail = before.trim().split(/\s+/).slice(-4).join(" ");
  return /\b(?:not|never|didn'?t|doesn'?t|don'?t|isn'?t|aren'?t|wasn'?t|weren'?t|won'?t|can'?t|cannot|without|no(?!\s+way\b))\b/i.test(tail);
}

/**
 * A no-show claim: "never showed up", "didn't come", "no-show", "stood me up", "ghosted me".
 * "didn't show me her art", "didn't come up" and "didn't come off as" are not claims.
 * "not a no-show" is not a claim. One pattern, so the feedback reader and the report kind agree.
 */
const NO_SHOW_SOURCE = String.raw`\b(?:never|didn'?t|did not) (?:show(?:ed)?(?: up)?|turn(?:ed)? up|c[ao]me)\b(?! (?:me|us|you|him|her|them|off|around|any|much|up)\b)|\bno[- ]?shows?\b|\bstood (?:me|us) up\b|\bghosted me\b`;

/** True when the text claims the other person did not come. A negated claim is false. */
export function isNoShowClaim(text: string): boolean {
  const t = normReport(text);
  for (const m of t.matchAll(new RegExp(NO_SHOW_SOURCE, "gi"))) {
    if (!negatedInClause(t, m.index)) return true;
  }
  return false;
}

/** The first match of `re` that a negation in the same clause does not cancel. */
function firstHarm(text: string, re: RegExp): boolean {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  for (const m of text.matchAll(new RegExp(re.source, flags))) {
    if (!negatedInClause(text, m.index)) return true;
  }
  return false;
}

/** The kind of a report from its words (most serious first). "other" when nothing names a kind. */
export function reportKindOf(text: string): ReportKind {
  const t = normReport(text);
  for (const [k, re] of KINDS) if (firstHarm(t, re)) return k;
  if (isNoShowClaim(t)) return "no_show";
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
  const t = normReport(text);
  for (const m of t.matchAll(/\b(?:report|flag|safety team)\b/gi)) {
    if (!negatedInClause(t, m.index)) return "other";
  }
  return undefined;
}
