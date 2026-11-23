// Reports about another member (PRD 36.3, 40.5; docs/admin-console.md 3.7.1): "report X ..." in any
// app, and the answer to slop's check-in after a date. A report keeps ids and a kind, never the
// reporter's words. Urgent kinds (harassment, unsafe, scam, minor) have a 1-hour staff target; the
// others 24 hours.
import { classifyYesNo, type MemberId } from "@thenetwork/core";

export type ReportKind = "harassment" | "lying" | "no_show" | "unsafe" | "scam" | "minor" | "older_than_stated" | "other";
export type ReportStatus = "open" | "held" | "banned" | "dismissed";
export interface SafetyReport {
  id: string; kind: ReportKind; reporterId: MemberId; subjectId: MemberId; opportunityId?: string; at: number; status: ReportStatus;
  /** "message": "report X"; "check_in": the answer after a date. */
  source: "message" | "check_in";
  decidedBy?: string; decidedAt?: number;
}
export const URGENT_REPORTS: ReadonlySet<ReportKind> = new Set(["harassment", "unsafe", "scam", "minor", "older_than_stated"]);
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
const CURRENT_DANGER = /^(?:(?:i am|i'm|we are|we're) (?:in (?:immediate )?danger(?: (?:right now|now))?|(?:not safe|being threatened) (?:right now|now))|(?:i |we )?need emergency help(?: (?:right now|now))?|(?:(?:he|she|they|someone) (?:is|are)|he's|she's|they're) (?:following|threatening|attacking) (?:me|us)(?: (?:right now|now))?)$/i;
const COUNTERPART_SUBJECT = /^(?:he|she|they|my date|the person i met)\b/i;

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

function reportsHarm(text: string, marker: RegExp): boolean {
  for (const m of text.matchAll(new RegExp(marker.source, "gi"))) {
    const clause = text.slice(0, m.index).split(/[,.!?:;]|\b(?:but|however|although)\b/i).at(-1) ?? "";
    if (!ACTIVE_DENIAL.test(clause)) return true;
  }
  return false;
}

export const reportsAbsence = (text: string): boolean => reportsHarm(text, ABSENCE);

const folded = (text: string) => text.normalize("NFKC").replace(/[‘’ʼ]/g, "'");

/** The kind of a report from its words (most serious first). "other" when nothing names a kind. */
export function reportKindOf(text: string): ReportKind {
  const t = folded(text);
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
  return reportsHarm(folded(text), /\b(report|flag|safety team)\b/i) ? "other" : undefined;
}

const CONCERN = /\b(?:uncomfortable|uneasy|unsettl(?:ed|ing)|sketchy|red flags?|(?:made|making) me (?:feel )?(?:weird|bad|uneasy|nervous|on edge)|(?:felt|seemed) off|(?:weird|bad|strange) vibes?|didn'?t feel right|went (?:badly|wrong)|(?:bad|awful|horrible) experience|crossed a line|overstepped)\b/i;
const REPORT_WORD = /\b(?:report|flag)\b/i;
const BLOCK_WORD = /\bblock\b/i;
const REFUSAL = /\b(?:not|never|no|nor|don'?t|do not|doesn'?t|won'?t|wouldn'?t|shouldn'?t|can'?t|cannot)\b/i;
const BOTH_ANSWER = /^(?:both|both of them|both please|both pls|do both|both thanks)$/i;
const NEITHER_ANSWER = /^(?:neither|neither please|neither one|none|nothing|no thanks|no thank you|never ?mind|nvm|forget it|leave it|no need)$/i;

export function checkInConcern(text: string): boolean {
  return reportsHarm(folded(text), CONCERN);
}

function choiceClauses(text: string): { clause: string; asks: boolean }[] {
  return (folded(text).match(/[^,.;:!?\n—]+\?*/g) ?? []).flatMap(part => {
    const asks = part.endsWith("?");
    const pieces = part.replace(/\?+$/, "").split(/\b(?:but|however|although|though)\b/i);
    return pieces.map((piece, i) => ({ clause: piece.trim().toLowerCase(), asks: asks && i === pieces.length - 1 }));
  }).filter(x => x.clause);
}

export function checkInSafetyChoice(text: string): { report: boolean; block: boolean; declines: boolean; namesChoice: boolean } {
  let askedReport = false, askedBlock = false, refusedReport = false, refusedBlock = false, refusal = false, namesChoice = false;
  for (const { clause, asks } of choiceClauses(text)) {
    const r = REPORT_WORD.exec(clause), b = BLOCK_WORD.exec(clause);
    if (r || b) namesChoice = true;
    if (asks) continue;
    if (!r && !b) {
      if (BOTH_ANSWER.test(clause)) { askedReport = true; askedBlock = true; }
      else if (NEITHER_ANSWER.test(clause) || (clause.split(/\s+/).length <= 3 && classifyYesNo(clause) === "no")) refusal = true;
      continue;
    }
    if (r) { if (REFUSAL.test(clause.slice(0, r.index))) refusedReport = true; else askedReport = true; }
    if (b) { if (REFUSAL.test(clause.slice(0, b.index))) refusedBlock = true; else askedBlock = true; }
  }
  const wantsReport = askedReport && !refusedReport, wantsBlock = askedBlock && !refusedBlock;
  return {
    report: wantsReport && !refusedBlock,
    block: wantsBlock,
    declines: refusal || ((refusedReport || refusedBlock) && !wantsReport && !wantsBlock),
    namesChoice,
  };
}
