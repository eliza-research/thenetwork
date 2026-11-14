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
const ABSENCE = /\b(no[- ]?show(ed)?|(?:never|didn'?t|did not) (?:show(?:ed)?(?: up)?|c[ao]me|turn(?:ed)? up|arriv(?:e|ed))(?!\s+(?:me|us|you|him|her|them|up|off|around|any|much)\b)|stood (?:me|us) up)\b/i;

const KINDS: [ReportKind, RegExp][] = [
  ["minor", /\b(under ?age|underage|a minor|(he|she|they)(?:'s|'re| is| was| are| were) (?:only |just )?(1[0-7]|[0-9])(?![\d:.'"]|\s*(min|mins|minutes|hours?|hrs?|days?|weeks?|dollars|bucks|blocks|stops|am|pm|ft|foot|feet|out of|years? (older|younger))\b)|(1[0-7]|[0-9]) years? old|in (high|middle) school|a (kid|child|teen(ager)?))\b/i],
  ["unsafe", /\b(unsafe|not safe|scared|afraid|terrified|threat(en(ed|ing)?)?|follow(ed|ing) me|stalk(ed|ing)? me|(?:wouldn'?t|would not|didn'?t|did not|refused to) let me (go|leave|out)|grabbed|touched me|assault(ed)?|(?:hit|punched|slapped|shoved|kicked|attacked) me|drugged|spiked|forced|hurt me|violent|(?:pulled|pointed|brandished) (?:out )?(?:a |their |his |her )?(?:knife|gun|weapon))\b/i],
  ["harassment", /\b(harass(ed|ing|ment)?|creep(y)?|kept (texting|messaging|calling)|(?:wouldn'?t|would not|refused to) stop|rude|insult(ed|ing)?|aggressive|hostile|abusive|slur|pushy|inappropriate|sexual comments?)\b/i],
  ["scam", /\b(scam(mer|med)?|(?:asked|demanded|requested)(?: me| that i)? (?:for |to (?:send|wire|transfer|buy) |(?:send|wire|transfer|buy) )(?:some |a |the )?(?:money|cash|gift cards?|crypto|bitcoin)|asked to borrow money|wire (?:me|money))\b/i],
  ["lying", /\b(lied|lying|liar|fake|catfish(ed)?|not (who|what) (they|he|she) said|(didn'?t|doesn'?t) look like (their|his|her) (photos?|pics?|pictures?)|old photos?|(lied|lying) about (their|his|her) age|older than|younger than (they|he|she) said|married|has a (girlfriend|boyfriend|wife|husband|partner))\b/i],
];

const ACTIVE_DENIAL = /\b(?:not(?! only\b)|never|nothing|without|no(?! way\b)|(?:is|are|was|were|did|do|would)n't|(?:no|don't|do not) need to)\s+(?:(?:at all|really|very|even|remotely|a bit|make me feel|an?|be) +)*(?:[a-z]+ (?:or|nor) +)?$/i;
const CORRECTED_MARRIAGE = /\b(?:not married|isn't married|wasn't married)\s*[,;]?\s*but\s+(?:he|she|they)\s+(?:is|was|are|were)\s*(?:$|[.!?,;])/i;

function reportsHarm(text: string, marker: RegExp): boolean {
  for (const m of text.matchAll(new RegExp(marker.source, "gi"))) {
    const clause = text.slice(0, m.index).split(/[,.!?:;]|\b(?:but|however|although)\b/i).at(-1) ?? "";
    if (!ACTIVE_DENIAL.test(clause)) return true;
  }
  return false;
}

export const reportsAbsence = (text: string): boolean => reportsHarm(text, ABSENCE);

/** The kind of a report from its words (most serious first). "other" when nothing names a kind. */
export function reportKindOf(text: string): ReportKind {
  const t = text.normalize("NFKC").replace(/[‘’ʼ]/g, "'");
  for (const [k, re] of KINDS) {
    if (k === "minor" ? re.test(t) : reportsHarm(t, re) || (k === "lying" && CORRECTED_MARRIAGE.test(t))) return k;
  }
  if (reportsAbsence(t) || reportsHarm(t, /\bghosted me\b/i)) return "no_show";
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
