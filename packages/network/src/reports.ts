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
  ["minor", /\b(under ?age|underage|a minor|(?:he|she|they|the (?:guy|girl|dude|person|date|man|woman)|[A-Z][a-z]+)(?:'s|'re| is| was| are| were) (?:only |just )?(1[0-7]|[0-9])(?![\d:.'"]|\s*(years?|yrs?|months?|min|mins|minutes|hours?|hrs?|days?|weeks?|dollars|bucks|blocks|stops|am|pm|ft|foot|feet|out of)\b)|(1[0-7]|[0-9])\s*(?:years?|yrs?|yo)?\s*old|(1[0-7]|[0-9])\s*yo\b|in (high|middle) school|a (kid|child|teen(ager)?))\b/i],
  ["unsafe", /\b(unsafe|not safe|scared|afraid|threat(en(ed|ing)?)?|follow(ed|ing) me|wouldn'?t let me (go|leave)|grabbed|touched me|assault(ed)?|attack(ed)?|drugged|spiked|forced|hurt me|violent|violence|weapon|knife|gun|punched|hit me|struck me|shoved me|beat me)\b/i],
  ["harassment", /\b(harass(ed|ing|ment)?|creep(y)?|kept (texting|messaging|calling)|wouldn'?t stop|rude|insult(ed|ing)?|aggressive|hostile|abusive|slur|pushy|inappropriate|sexual comments?|stalk(ed|ing)?)\b/i],
  ["scam", /\b(scam(mer|med)?|asked (?:me )?(?:for|to send) (?:money|cash)|asked for (?:cash|money)|borrow(ed)? money|venmo|cash ?app|zelle|paypal|apple ?pay|crypto|bitcoin|usdt|gift cards?|invest(ment)?|wire (?:me|money)|ponzi|pyramid scheme)\b/i],
  ["lying", /\b(lied|lying|liar|fake|catfish(ed)?|not (who|what) (they|he|she) said|(didn'?t|doesn'?t) look like (their|his|her) (photos?|pics?|pictures?)|old photos?|(lied|lying) about (their|his|her) age|older than|younger than (they|he|she) said|married|has a (girlfriend|boyfriend|wife|husband|partner))\b/i],
  ["no_show", /\b(no[- ]?show(ed)?|never (showed( up)?|came|turned up|arrived)|didn'?t (show( up)?|come|turn up|arrive)|stood me up|ghosted( me)?|bailed( on me)?)\b/i],
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
