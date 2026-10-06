// Shared pieces of the three LLM judgment passes (see judgeScreen.ts = pass 1, judge.ts = pass 2,
// judgeDeep.ts = pass 3). Every pass returns structured JSON whose FIRST field is an internal,
// fact-citing explanation, then the verdict, then the confidence, and only then any member-facing
// text. Internal reasoning is never shown to members; member-facing text goes through a
// deterministic leak gate before it can be used.
import type { MemberId } from "@thenetwork/core";
import { tokenize } from "./embed.ts";

/** One fact the model says it relied on, addressed by field (e.g. {ref:"P1", field:"intents[0]"}). */
export interface CitedFact { ref: string; field: string; fact: string }

export type PassVerdict = "yes" | "no" | "insufficient_information";

/** Probability in [0,1]; accepts "0.7", 70 (percent). Undefined if invalid. */
export function prob(x: unknown): number | undefined {
  const n = typeof x === "string" ? Number(x) : x;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const v = n > 1 && n <= 100 ? n / 100 : n;
  return v < 0 || v > 1 ? undefined : v;
}

export const str = (x: unknown, max = 4000): string => (typeof x === "string" ? x.trim().slice(0, max) : "");

/** Lenient parse of a cited-facts array (bad entries are dropped, never fatal). */
export function parseCitedFacts(x: unknown, max = 12): CitedFact[] {
  if (!Array.isArray(x)) return [];
  const out: CitedFact[] = [];
  for (const e of x) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const fact = str(o.fact, 300);
    if (!fact) continue;
    out.push({ ref: str(o.ref, 12), field: str(o.field, 80), fact });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * True if every `before` key that is present appears before the `after` key in the object's key
 * order (JSON.parse preserves source order for non-integer keys). Used to check that the model
 * wrote its explanation before its verdict.
 */
export function keyOrderOk(raw: unknown, before: string[], after: string): boolean {
  if (!raw || typeof raw !== "object") return false;
  const keys = Object.keys(raw as object);
  const ia = keys.indexOf(after);
  if (ia < 0) return false;
  return before.every(k => { const i = keys.indexOf(k); return i >= 0 && i < ia; });
}

/** Sim-style canary tokens (e.g. "QX-4821-ORCHID") and "(ref ...)" markers on private facts. */
const CANARY_TOKEN = /\b[A-Z]{2}-\d{4}-[A-Z]{3,}\b/g;
const REF_MARKER = /\s*\(ref [^)]*\)/gi;

/**
 * Redact canary-like tokens before a private value is shown to any model. Canaries exist only to
 * detect leaks; they carry no meaning, so the model never needs them and can therefore never echo them.
 */
export function redactPrivate(s: string): string {
  return s.replace(REF_MARKER, "").replace(CANARY_TOKEN, "[redacted]").trim();
}

/** Replace member-id-like strings inside free text with refs (or a neutral token). */
export function scrubIds(s: string, refOf: Map<MemberId, string>): string {
  return s.replace(/\b[a-z]{2,4}-\d-\d{4}\b/gi, m => refOf.get(m) ?? "another member");
}

export interface MemberTextCheck {
  ok: boolean;
  /** Why the text was rejected: canary, private_vocabulary:<word>, contact, too_long. */
  reasons: string[];
}

/**
 * Deterministic gate for any text that could reach a member. `privateVocab` = words found only in
 * non-shareable facets of the people involved (explain.ts privateVocabulary). A model's internal
 * reasoning never goes through here because it is never shown to members.
 */
export function checkMemberFacing(text: string, privateVocab: Set<string>, extraForbidden: string[] = []): MemberTextCheck {
  const reasons: string[] = [];
  if (/canary/i.test(text) || /\b[A-Z]{2}-\d{4}-[A-Z]{3,}\b/.test(text)) reasons.push("canary");
  for (const t of tokenize(text)) if (privateVocab.has(t)) { reasons.push(`private_vocabulary:${t}`); break; }
  for (const f of extraForbidden) if (f && text.toLowerCase().includes(f.toLowerCase())) { reasons.push("forbidden_phrase"); break; }
  if (/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.test(text) || /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(text)) reasons.push("contact");
  if (text.length > 600) reasons.push("too_long");
  return { ok: reasons.length === 0, reasons };
}

/** Calibration-friendly decision rule shared by passes: a "yes" verdict without a dealbreaker. */
export const isYes = (v: PassVerdict | undefined, dealbreaker = false) => v === "yes" && !dealbreaker;

/** Normalise a verdict string ("Yes", "insufficient info", ...) or undefined. */
export function parsePassVerdict(x: unknown, allowInsufficient: boolean): PassVerdict | undefined {
  if (typeof x === "boolean") return x ? "yes" : "no";
  if (typeof x !== "string") return undefined;
  const s = x.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "yes" || s === "propose" || s === "true") return "yes";
  if (s === "no" || s === "reject" || s === "false") return "no";
  if (allowInsufficient && /^insufficient(_info(rmation)?)?$|^abstain$|^need(s)?_more_info(rmation)?$/.test(s)) return "insufficient_information";
  return undefined;
}

/** Shared wording: how to cite facts and what stays internal. Embedded in every pass prompt. */
export const CITATION_RULES = `Cite facts by field using the person's ref and the field path exactly as it appears in the input (for example P1.intents[0], P2.matchable_do_not_quote[1], P1.preferences.formats, P2.presence[0], relationships[0]). Quote or closely paraphrase the actual value you rely on; do not cite fields that do not exist.`;

/**
 * Shared judging guidance for passes 2 and 3 (added after the v1 error analysis: both passes
 * rejected most good intros over format wording and over opt-ins that code already enforces).
 */
export const JUDGING_NOTES = `Judging notes:
- Opt-ins (categories_opted_in, romance_opt_in), ages, blocks, holds and budgets are enforced by code before you see a candidate. Do not reject or lower scores because of them; judge fit.
- An introduction is a first step. A pair intro anchored on a group-shaped intent (a dinner group, a running crew, a small-group format in the intent details) still serves that intent: people often find a group through one person. Treat format only as a soft signal, and as a real problem only when a person's own preferences.formats excludes it or a boundary says so.
- A shared, current intent or a clear skill-for-need match is real mutual value even when the rest of the profile is thin. Thin evidence lowers your confidence; it is not by itself a reason to say no.`;
