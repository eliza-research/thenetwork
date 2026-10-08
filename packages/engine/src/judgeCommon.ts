// Shared pieces of the three LLM judgment passes (judgeScreen.ts = pass 1, judge.ts = pass 2,
// judgeDeep.ts = pass 3; the one context builder is judgeContext.ts). Every pass returns structured
// JSON whose FIRST field is an internal, fact-citing explanation, then the verdict, then the
// confidence, and only then any member-facing text. Internal reasoning is never shown to members;
// member-facing text goes through a deterministic leak gate before it can be used.
//
// This module holds what the passes share: the runner (one call with retry, core chatJson), the
// verdict cache and the cached, bounded-concurrency pass loop, the parser base (field readers that
// collect schema errors), the leak gate, evidence helpers and the shared prompt fragments.
import type { ChatMessage, LLM, MemberId } from "@thenetwork/core";
import { chatJson, labelHash, LeakGuard, textVariants } from "@thenetwork/core";
import { tokenize } from "./embed.ts";
import { sha256 } from "./rng.ts";
import type { Candidate, JudgeVerdict } from "./types.ts";
import type { World } from "./world.ts";

// Moved: prompt-independent constants live in judgeConstants.ts; The Network's judging guidance moved
// verbatim to packs/network/prompts.ts. Re-exported here so every existing import keeps working.
export { CITATION_RULES, HYPOTHESIS_CONFIDENCE, STALE_DAYS } from "./judgeConstants.ts";
export { CODE_ENFORCED_V3, JUDGING_NOTES, JUDGING_NOTES_V3 } from "./packs/network/prompts.ts";
import { HYPOTHESIS_CONFIDENCE, STALE_DAYS } from "./judgeConstants.ts";

// ---- runner, cache, pass loop ---------------------------------------------------------------------

/** System prompt + the context object as the user message (the prompt bytes every pass sends). */
export const passMessages = (system: string, context: unknown): ChatMessage[] =>
  [{ role: "system", content: system }, { role: "user", content: JSON.stringify(context) }];

/** One pass call: ask for JSON, validate with `parse`, one retry (the engine's budget for every pass). */
export function runPass<V>(llm: LLM, messages: ChatMessage[], parse: (raw: unknown) => V, maxTokens: number, temperature?: number): Promise<V> {
  return chatJson(llm, messages, parse, { attempts: 2, maxTokens, temperature });
}

export class JudgeCache<V = JudgeVerdict> {
  private m = new Map<string, { verdict: V; at: number }>();
  constructor(public ttlMs: number) {}
  get(key: string, now: number): V | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (now - e.at >= this.ttlMs || now < e.at) { this.m.delete(key); return undefined; }
    return e.verdict;
  }
  set(key: string, verdict: V, now: number) { this.m.set(key, { verdict, at: now }); }
  get size() { return this.m.size; }
  /** Drop every entry involving a member whose profile changed (keys also embed revisions). */
  clear() { this.m.clear(); }
}

/**
 * Cache key: prompt version, configuration shape, every participant's profile revision, and what
 * else the judge sees (engine-pipeline-19): the connector (via) and their revision, the city, a
 * fixed time window, and the pass-2 context setting.
 */
export function passCacheKey(w: World, c: Candidate, version: string): string {
  const parts = [...c.participants].sort().map(id => `${id}@${w.get(id)?.revision ?? "?"}`);
  const via = c.via ? `${c.via}@${w.get(c.via)?.revision ?? "?"}` : "-";
  // Only a fixed time is part of the key: an open window starts at "now" and would never hit.
  const when = `${c.city ?? "-"}:${c.fixedWindow ? `${c.window?.start ?? c.fixedWindow.start}-${c.window?.end ?? c.fixedWindow.end}` : "-"}`;
  return sha256(`${version}|${c.kind}|${c.category}|${c.anchor?.type}:${c.anchor?.id}|${parts.join(",")}|${via}|${when}|${w.cfg.judge.pass2Context}`).slice(0, 24);
}

export interface JudgeRunStats { calls: number; cacheHits: number; failures: number }

/**
 * Run one judgment pass over candidates with caching and bounded concurrency (shared by all three
 * passes). Returns key -> verdict (null on failure). Failures are never cached (ME-008).
 */
export async function runCachedPass<V>(w: World, cands: Candidate[], version: string, cache: JudgeCache<V>, stats: JudgeRunStats,
  judge: (c: Candidate) => Promise<V>, log: { key: string; cacheKey: string; verdict: V | null; cached: boolean }[]): Promise<Map<string, V | null>> {
  const out = new Map<string, V | null>();
  const hits = new Set<string>();
  const queue = [...cands];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift()!;
      const ck = passCacheKey(w, c, version);
      const hit = cache.get(ck, w.now);
      if (hit) { stats.cacheHits++; hits.add(c.key); out.set(c.key, hit); continue; }
      stats.calls++;
      try {
        const v = await judge(c);
        cache.set(ck, v, w.now);
        out.set(c.key, v);
      } catch {
        stats.failures++;
        out.set(c.key, null); // not cached: a noisy failure must not stick (ME-008)
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, w.cfg.judge.concurrency) }, worker));
  // Deterministic log order.
  for (const c of [...cands].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    log.push({ key: c.key, cacheKey: passCacheKey(w, c, version), verdict: out.get(c.key) ?? null, cached: hits.has(c.key) });
  }
  return out;
}

/** Attending refs (participants, not the connector) of a ref map. */
export const attendingRefs = (refs: Record<string, MemberId>, c: Pick<Candidate, "participants">) =>
  Object.entries(refs).filter(([, id]) => c.participants.includes(id)).map(([r]) => r);

// ---- parser base -----------------------------------------------------------------------------------

/**
 * Field readers for a raw model reply that collect schema errors. Each pass reads its fields in its
 * own order with its own error labels (the error text is part of recorded eval results), then calls
 * `done(prefix, separator)`, which throws if anything was missing.
 */
export class ReplyFields {
  readonly errs: string[] = [];
  readonly o: Record<string, any>;
  constructor(raw: unknown, notObject: string) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(notObject);
    this.o = raw as Record<string, any>;
  }
  /** Non-empty trimmed text (capped at 4000 chars); `err` is recorded when empty. */
  text(key: string, err = key): string { const v = str(this.o[key]); if (!v) this.errs.push(err); return v; }
  verdict(allowInsufficient: boolean, err = "verdict"): PassVerdict | undefined {
    const v = parsePassVerdict(this.o.verdict, allowInsufficient);
    if (!v) this.errs.push(err);
    return v;
  }
  prob(key: string, value: unknown = this.o[key], err = key): number | undefined {
    const p = prob(value);
    if (p === undefined) this.errs.push(err);
    return p;
  }
  bool(key: string, err = key): void { if (typeof this.o[key] !== "boolean") this.errs.push(err); }
  /** Integer-ish score in [1,5] (undefined + error otherwise). */
  score(value: unknown, err: string): number | undefined {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 1 || v > 5) { this.errs.push(err); return undefined; }
    return v;
  }
  done(prefix: string, sep: string): void { if (this.errs.length) throw new Error(`${prefix}${this.errs.join(sep)}`); }
  citedFacts(): CitedFact[] { return parseCitedFacts(this.o.cited_facts); }
  /** The model wrote `before` keys before its verdict (JSON key order). */
  reasoningFirst(before: string[] = ["reasoning"]): boolean { return keyOrderOk(this.o, before, "verdict"); }
}

/** One fact the model says it relied on, addressed by field (e.g. {ref:"P1", field:"intents[0]"}). */
export interface CitedFact { ref: string; field: string; fact: string }

export type PassVerdict = "yes" | "no" | "insufficient_information";

/** Probability in [0,1]; accepts "0.7", 70 (percent). Undefined if invalid. */
export function prob(x: unknown): number | undefined {
  const n = typeof x === "string" ? Number(x) : x;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  // A percent only from 2 up (engine-pipeline-23): 1.5 is ambiguous (150%? 1.5%?) and is rejected.
  const v = n > 1 ? (n >= 2 && n <= 100 ? n / 100 : NaN) : n;
  return !(v >= 0 && v <= 1) ? undefined : v;
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
/** Non-global copy for .test() (a /g regex keeps lastIndex between calls). */
const CANARY_TOKEN_ONE = new RegExp(CANARY_TOKEN.source);
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
  /**
   * Why the text was rejected: canary, private_vocabulary:<hash>, forbidden_phrase, contact, too_long.
   * Reasons never carry the matched private word.
   */
  reasons: string[];
}

/** Compiled core guards per vocabulary set (privateVocabulary returns a fresh set per candidate). */
const guards = new WeakMap<Set<string>, { size: number; guard: LeakGuard }>();
function vocabGuard(privateVocab: Set<string>): LeakGuard {
  const hit = guards.get(privateVocab);
  if (hit && hit.size === privateVocab.size) return hit.guard;
  const guard = new LeakGuard({ privateVocab: [...privateVocab] });
  guards.set(privateVocab, { size: privateVocab.size, guard });
  return guard;
}

/**
 * Leak reasons for text that could reach a member: the shared core guard (packages/core/src/guard.ts:
 * private vocabulary on folded, de-leeted and letter-collapsed variants; phone, email, address, URL
 * and handle patterns; `extraForbidden` as exact strings) plus the engine's own stricter checks (any
 * "canary" word or sim canary token, stemmed vocabulary tokens, the legacy phone/email regexes).
 */
function leakReasons(text: string, privateVocab: Set<string>, extraForbidden: string[]): string[] {
  const reasons = new Set<string>();
  if (/canary/i.test(text) || CANARY_TOKEN_ONE.test(text) || textVariants(text).some(v => /canary/.test(v))) reasons.add("canary");
  for (const t of tokenize(text)) if (privateVocab.has(t)) { reasons.add(`private_vocabulary:${labelHash(t)}`); break; }
  const forbidden = extraForbidden.filter(Boolean);
  if (forbidden.some(f => text.toLowerCase().includes(f.toLowerCase()))) reasons.add("forbidden_phrase");
  if (/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.test(text) || /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(text)) reasons.add("contact");
  const core = forbidden.length ? new LeakGuard({ privateVocab: [...privateVocab], exact: forbidden }).check(text) : vocabGuard(privateVocab).check(text);
  for (const r of core) {
    if (r.startsWith("private_vocab:")) { if (![...reasons].some(x => x.startsWith("private_vocabulary:"))) reasons.add(`private_vocabulary:${r.slice("private_vocab:".length)}`); }
    else if (r.startsWith("forbidden:")) reasons.add("forbidden_phrase");
    else if (r.startsWith("contact:")) reasons.add("contact");
    else if (r.startsWith("canary:")) reasons.add("canary");
  }
  return [...reasons];
}

/** True if `text` leaks: canary, private vocabulary, contact details or a forbidden phrase (no length limit). */
export function leaksMemberFacing(text: string, privateVocab: Set<string>, extraForbidden: string[] = []): boolean {
  return leakReasons(text, privateVocab, extraForbidden).length > 0;
}

/**
 * Deterministic gate for any text that could reach a member. `privateVocab` = words found only in
 * non-shareable facets of the people involved (explain.ts privateVocabulary). A model's internal
 * reasoning never goes through here because it is never shown to members.
 */
export function checkMemberFacing(text: string, privateVocab: Set<string>, extraForbidden: string[] = []): MemberTextCheck {
  const reasons = leakReasons(text, privateVocab, extraForbidden);
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

// ---- v3 additions (2026-10-07, docs/results/2026-10-07-judge-v2.md) ---------------------------

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

