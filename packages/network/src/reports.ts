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
  ["unsafe", /\b(unsafe|not safe|scared|afraid|terrified|terrifying|threat(en(ed|ing)?)?|follow(ed|ing) me|stalk(ed|ing)? me|a stalker|(?:wouldn'?t|would not|didn'?t|did not|refused to) let me (?:go|leave|out)|grabbed|touched me|assault(ed)?|physically (?:attacked|assaulted|threatened|hurt|violent)|(?:hit|punched|attacked|choked|strangled|slapped|shoved|pushed|cornered|trapped|locked) me|drugged|spiked|forced|(?:had|pulled|threatened me with) a (?:weapon|knife|gun)|hurt me|violent)\b/i],
  ["harassment", /\b(harass(ed|ing|ment)?|creep(y)?|kept (texting|messaging|calling)|(?:wouldn'?t|would not|refused to) stop|rude|insult(ed|ing)?|aggressive|hostile|abusive|slur|pushy|inappropriate|sexual comments?|unsolicited (?:pics?|photos?|pictures?|nudes?)|dick pics?|(?:unwanted|inappropriate) (?:touch(ing)?|physical contact))\b/i],
  ["scam", /\b(scam(mer|med)?|(?:asked|demanded)(?: me)?(?: for)? (?:money|cash)|asked to borrow money|borrow money|lend money|venmo|cash ?app|zelle|paypal|crypto|bitcoin|gift cards?|invest(ment)?|wire (?:me|money|funds))\b/i],
  ["lying", /\b(lied|lying|liar|fake|catfish(ed)?|not (who|what) (they|he|she) said|(?:didn'?t|did not|doesn'?t|does not) look like (?:their|his|her) (?:photos?|pics?|pictures?)|old photos?|(lied|lying) about (their|his|her) age|older than|younger than (they|he|she) said|married|has a (girlfriend|boyfriend|wife|husband|partner))\b/i],
  ["no_show", /\b(no[- ]?show(ed)?|never (?:showed|came|turned up|arrived)|(?:didn'?t|did not) (?:show|come|turn up|arrive)|stood (?:me|us) up|ghosted me)\b/i],
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
