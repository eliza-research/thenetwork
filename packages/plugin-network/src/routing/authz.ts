/**
 * Deterministic authorizer for model-PROPOSED Network actions, ported from the
 * Network agent prototype (`thenetwork-poc/prototypes/poc-agent-llm/src/authz.ts`).
 * The model only proposes; this code decides whether anything changes.
 *
 * Ported rules that apply to SET_STATE:
 *  - input sanitization (Unicode tag smuggling, zero-width/bidi controls, NFKC);
 *  - evidence must be a verbatim (normalized) quote of the member's own text and
 *    must not sit inside quoted / forwarded third-party text;
 *  - state must be one of the member states, and `until` a valid, future date.
 * The prototype's item attribution (`attribution.ts`: thread/opportunity
 * targeting by reply-to and timeline) only applies to item-targeting actions
 * (RELAY_MESSAGE, SCHEDULE, RESPOND_TO_OPPORTUNITY, ...) and is not needed for
 * a self-only SET_STATE; it ports with those actions.
 */
import { NETWORK_MEMBER_STATES, type NetworkMemberState } from "../types.js";
import { resolveWindow } from "./dates.js";

/** Applied before evidence comparison (prototype `sanitize`). */
export function sanitize(text: string): string {
  return text
    .replace(/[\u{E0000}-\u{E007F}]/gu, "")
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, "")
    .normalize("NFKC");
}

const norm = (text: string) =>
  sanitize(text)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'+@.]+/gu, " ")
    .trim();

/** Spans quoting someone else: "...", “...”, and lines starting with ">". */
function quotedSpans(text: string): string[] {
  const spans: string[] = [];
  for (const match of text.matchAll(/"([^"]{3,})"|“([^”]{3,})”/g)) {
    spans.push(match[1] ?? match[2] ?? "");
  }
  for (const line of text.split("\n")) {
    if (line.trim().startsWith(">")) spans.push(line.replace(/^\s*>/, ""));
  }
  return spans;
}

export function evidenceOk(
  evidence: string,
  memberText: string,
): { ok: true } | { ok: false; why: string } {
  const e = norm(evidence);
  const t = norm(memberText);
  if (e.length < 2) return { ok: false, why: "empty evidence" };
  if (!t.includes(e)) return { ok: false, why: "evidence not in member text" };
  if (quotedSpans(memberText).some((quote) => norm(quote).includes(e))) {
    return { ok: false, why: "evidence is inside quoted third-party text" };
  }
  return { ok: true };
}

// Busy keeps intros flowing at a lower rate; paused stops them. Models over-read
// "swamped, hold off on new intros" as a full pause (6/40 in the 2026-10-07 eval),
// so a proposed pause is downgraded to busy unless the member's own words ask to stop.
const EXPLICIT_PAUSE = /\b(?:pause|unpause|stop|break|on hold|mute|snooze|don'?t (?:message|text|contact|ping)|do not (?:message|text|contact|ping)|no (?:more )?(?:intros|messages|texts))\b/i;
const BUSY_CUE = /\b(?:busy|slammed|swamped|underwater|buried|crazy|hectic|insane|nuts|fewer|less|go easy|only (?:ping|message|text|contact) me if|hold off on new|minimum)\b/i;

/** Applies the busy-vs-paused rule to a proposed state, using only the member's own (unquoted) words. */
export function resolveBusyVsPaused(state: NetworkMemberState, memberText: string): NetworkMemberState {
  if (state !== "paused") return state;
  let own = sanitize(memberText);
  for (const q of quotedSpans(memberText)) own = own.replace(q, " ");
  return BUSY_CUE.test(own) && !EXPLICIT_PAUSE.test(own) ? "busy" : state;
}

// Date guards (2026-10-07 live eval): the model sometimes dropped an end date the
// member gave ("stop the intros until after new years" became an indefinite pause) or
// asked about dates it could resolve. Code never invents dates; it refuses a proposal
// that ignores or contradicts dates in the member's own words, and the agent asks.
const END_MARKER = /\b(?:until|till|til|thru|through|back (?:on|by|the|in)|after|for (?:a |an |the )?(?:\d+|one|two|three|four|five|six|few|a few|couple|a couple(?: of)?)\s*(?:days?|weeks?|months?))\b|\bthis week\b|\bnext week\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi;
const ORDINAL_RE = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/gi;

/** Member's own words with quoted third-party spans removed. */
function ownWords(memberText: string): string {
  let own = sanitize(memberText);
  for (const q of quotedSpans(memberText)) own = own.replace(q, " ");
  return own;
}

export type DateGuard = { ok: true } | { ok: false; reason: "missing until" | "date mismatch" };

/** Checks proposed dates against the dates the member actually stated. */
export function checkDates(
  state: NetworkMemberState,
  from: string | null,
  until: string | null,
  memberText: string,
): DateGuard {
  if (state === "open") return { ok: true };
  const own = ownWords(memberText);
  if (!until && END_MARKER.test(own)) return { ok: false, reason: "missing until" };
  const proposed = [from, until].filter((d): d is string => Boolean(d)).map((d) => new Date(d));
  if (proposed.length === 0) return { ok: true };
  const days = [...own.matchAll(ORDINAL_RE)].map((m) => Number(m[1]));
  if (days.length && !proposed.some((d) => days.includes(d.getUTCDate()))) {
    return { ok: false, reason: "date mismatch" };
  }
  const months = [...own.matchAll(MONTH_RE)].map((m) => MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()));
  if (months.length && !proposed.some((d) => months.includes(d.getUTCMonth()))) {
    // "until december" may resolve to Dec 1 or to the first of January; both name December.
    const lastDayOf = proposed.some((d) => d.getUTCDate() === 1 && months.includes((d.getUTCMonth() + 11) % 12));
    if (!lastDayOf) return { ok: false, reason: "date mismatch" };
  }
  return { ok: true };
}

export interface ProposedSetState {
  state: NetworkMemberState;
  until: string | null;
  evidence: string;
}

export type SetStateDecision =
  | { allowed: true; state: NetworkMemberState; from: string | null; until: string | null }
  | { allowed: false; reason: string };

export function authorizeSetState(
  proposal: { state: unknown; from?: unknown; until: unknown; evidence: unknown },
  memberText: string,
  now: Date = new Date(),
): SetStateDecision {
  if (
    typeof proposal.state !== "string" ||
    !(NETWORK_MEMBER_STATES as readonly string[]).includes(proposal.state)
  ) {
    return { allowed: false, reason: "invalid state" };
  }
  if (typeof proposal.evidence !== "string") {
    return { allowed: false, reason: "missing evidence" };
  }
  const evidence = evidenceOk(proposal.evidence, memberText);
  if (!evidence.ok) return { allowed: false, reason: evidence.why };
  let until: string | null = null;
  if (typeof proposal.until === "string" && proposal.until.trim()) {
    const parsed = Date.parse(proposal.until);
    if (Number.isNaN(parsed)) return { allowed: false, reason: "invalid until" };
    // Allow a date-only "today"; reject anything already in the past.
    if (parsed < now.getTime() - 24 * 60 * 60 * 1000) {
      return { allowed: false, reason: "until is in the past" };
    }
    until = new Date(parsed).toISOString();
  }
  let from: string | null = null;
  if (typeof proposal.from === "string" && proposal.from.trim()) {
    const parsed = Date.parse(proposal.from);
    if (Number.isNaN(parsed)) return { allowed: false, reason: "invalid from" };
    if (parsed < now.getTime() - 24 * 60 * 60 * 1000) return { allowed: false, reason: "from is in the past" };
    // A window that starts today or earlier is simply "now".
    from = parsed > now.getTime() ? new Date(parsed).toISOString() : null;
  }
  // Dates stated in the member's own words win over the model's: resolved deterministically.
  const stated = resolveWindow(ownWords(memberText), now);
  if (stated.until) until = stated.until;
  if (stated.from) from = Date.parse(stated.from) > now.getTime() ? stated.from : null;
  if (from && until && Date.parse(until) <= Date.parse(from)) {
    return { allowed: false, reason: "until is not after from" };
  }
  const state = resolveBusyVsPaused(proposal.state as NetworkMemberState, memberText);
  const dates = checkDates(state, from, until, memberText);
  if (!dates.ok) return { allowed: false, reason: dates.reason };
  return {
    allowed: true,
    state,
    from: state === "open" ? null : from,
    until: state === "open" ? null : until,
  };
}
