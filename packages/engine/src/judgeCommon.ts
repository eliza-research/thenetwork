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

// ---- v3 additions (2026-10-07, docs/results/2026-10-07-judge-v2.md) ---------------------------

/** Facts older than this are flagged as possibly stale in every pass. */
export const STALE_DAYS = 180;
/** An unconfirmed inferred/observed fact below this confidence is a hypothesis (never a sole anchor). */
export const HYPOTHESIS_CONFIDENCE = 0.65;

type FacetProvenance = { source?: string; observedAt?: number; inferred?: boolean; confirmedByMember?: boolean; provenance: string; validFrom?: number; confidence: number };

export type EvidenceBasis = "stated" | "confirmed" | "observed" | "inferred" | "vouched";

/**
 * Evidence basis of a fact: "stated" = the member said it (chat / onboarding); "confirmed" = taken
 * from a connected source and confirmed by the member; "observed" = taken verbatim from a connected
 * source, not confirmed; "inferred" = derived or guessed (never confirmed); "vouched" = an inviter said it.
 */
export function basisOf(f: FacetProvenance): EvidenceBasis {
  const fromChat = f.source === undefined ? f.provenance === "said" : /^(chat|said|conversation|onboarding)$/i.test(f.source);
  if (f.provenance === "vouched" || f.source === "vouch") return "vouched";
  if (fromChat) return f.inferred === true || f.provenance === "inferred" ? "inferred" : "stated";
  if (f.confirmedByMember === true) return "confirmed";
  if (f.inferred === true || f.provenance === "inferred") return "inferred";
  return "observed";
}

/** Age of the evidence behind a fact in whole days (undefined if unknown). */
export function factAgeDays(f: FacetProvenance, now: number): number | undefined {
  const at = typeof f.observedAt === "number" ? f.observedAt : f.validFrom;
  return at !== undefined ? Math.max(0, Math.round((now - at) / 86_400_000)) : undefined;
}

/** True for an unconfirmed inferred/observed fact with confidence below HYPOTHESIS_CONFIDENCE. */
export function isHypothesis(f: FacetProvenance): boolean {
  const b = basisOf(f);
  return (b === "inferred" || b === "observed") && f.confidence < HYPOTHESIS_CONFIDENCE;
}

/** Compact evidence tag for one-line fact lists (pass 1 v3): "[stated, conf 1, 3d]" / "[inferred via gmail, conf 0.55, 12d, HYPOTHESIS]". */
export function evidenceTag(f: FacetProvenance, now: number): string {
  const b = basisOf(f);
  const age = factAgeDays(f, now);
  const parts = [`${b}${f.source && b !== "stated" ? ` via ${f.source}` : ""}`, `conf ${Math.round(f.confidence * 100) / 100}`];
  if (age !== undefined) parts.push(`${age}d old${age > STALE_DAYS ? ", possibly stale" : ""}`);
  if (isHypothesis(f)) parts.push("HYPOTHESIS");
  return `[${parts.join(", ")}]`;
}

/**
 * Redacted private-boundary signal: WHICH aspect of this configuration one of the person's private
 * boundaries is relevant to, never the boundary itself. Only aspects the configuration actually
 * touches are returned: "format" (a one-to-one meeting with someone who is not a direct tie),
 * "category" (the intro's category, e.g. professional networking or a romantic setup), "topic"
 * (what the intro is about, e.g. work). Venue / time-of-day boundaries are left to the logistics
 * step (they constrain where and when, not whether).
 */
export function boundaryRelevance(boundaries: string[], cfg: { category: string; attendingCount: number; directTie?: boolean }): ("format" | "category" | "topic")[] {
  const out = new Set<"format" | "category" | "topic">();
  for (const raw of boundaries) {
    const b = raw.toLowerCase();
    if (/\bgroups?\b.*\b(one[- ]on[- ]one|1:1|one[- ]to[- ]one)\b|\b(one[- ]on[- ]one|1:1|one[- ]to[- ]one)\b/.test(b) && cfg.attendingCount === 2 && !cfg.directTie) out.add("format");
    if (/network/.test(b) && (cfg.category === "professional" || cfg.category === "growth")) out.add("category");
    if (/\b(romantic|romance|dating|set ?ups?)\b/.test(b) && cfg.category === "romance") out.add("category");
    if (/\b(work|career|job)\b/.test(b) && /network/.test(b) === false && (cfg.category === "professional" || cfg.category === "growth")) out.add("topic");
  }
  return [...out].sort();
}

/**
 * Shared judging guidance for every v3 pass (from the luna error analysis, 2026-10-06, recs 3-5).
 * The label the passes are scored against is "would each attending person enjoy and benefit from
 * meeting if it happens", so the notes target that question, not acceptance.
 */
export const JUDGING_NOTES_V3 = `What "good" means, and how to judge it:
- The question is whether every attending person would ENJOY AND BENEFIT FROM meeting if it happens, not whether they would accept today. Busy schedules, capacity and acceptance are reported separately (accept_probability); they do not decide the verdict.
- Each attending person's gain must map to one of their OWN live intents, or to a stated skill or offer they want to use. Name it for each person. If one person gains and the other has no intent or offer this serves, the fit is one-sided: say no. A shared interest alone, when neither person's intent is about it, is usually not enough.
- A shared or complementary stated intent IS sufficient grounds by itself: both want to make new friends, both want a climbing partner, both want to meet other parents, or one needs a skill the other has. Do not also require a shared hobby or a "hook". Calibrate it, though: two people with the same broad intent and nothing else in common go well only a little more often than not (match_probability about 0.55-0.6); shared interests, area or life stage raise it; a specific need met by a specific skill raises it most.
- Dating is the exception. The Network does not know who each person wants to date (gender, age range), and most pairs of people who both want to date are not a match. Two dating intents alone are NOT sufficient: unless the listed facts show that each is looking for someone like the other, say no with match_probability about 0.25-0.3.
- Groups: judge the group as a whole. Say yes when every member gets something from one of their own intents or clearly shares the group's anchor, and nobody is left with nothing. One member without the identical wording of the intent is fine; a member whose intents and interests are unrelated to the group makes it a no. Bigger groups of strangers (4-5) need a stronger common purpose than a pair.
- Most candidates are NOT good. If you find yourself saying yes to nearly everything, you are being too lenient.
- Unknown or unlisted schedules are normal (most members never list them). Reject on logistics only when presence or overlap makes meeting in the window impossible.
- Evidence: every fact shows its basis (stated, confirmed, observed, inferred, vouched), source, confidence and age. Stated and confirmed facts are strong. An inferred or observed fact that is unconfirmed with confidence below ${HYPOTHESIS_CONFIDENCE} is a HYPOTHESIS (it may be a gift, a partner's account, a friend's hobby): never anchor an intro on a single such fact. Facts older than ${STALE_DAYS} days may be stale (an old job, an old goal).
- Private boundaries are penalties, not vetoes. A format boundary (e.g. preferring groups to one-to-one with strangers) or a topic boundary lowers the fit; it vetoes only when it is a hard dealbreaker for THIS intro (e.g. "no romantic setups" on a romantic intro for someone with no dating intent).
- Format is a soft signal: a pair intro can be the first step toward a group-shaped intent.`;

/** Passes 2-3 only (pass 1 keeps its own hard-policy list, so its model-only verdict is policy-safe). */
export const CODE_ENFORCED_V3 = `- Opt-ins (categories_opted_in, romance_opt_in), ages, blocks, holds and budgets are enforced by code before and after you. Do not reject or lower scores because of them; judge fit.`;
