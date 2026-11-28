import { createHash } from "node:crypto";
import { RealClock, type Clock } from "../../../packages/core/src/clock.ts";
import { DEFAULT_MODEL, OPENAI_PRICES, priceFor } from "../../../packages/core/src/llm.ts";
import { parseOptOut } from "../../../packages/core/src/replies.ts";
import { detectUnderageText, type UnderageDetectionResult } from "./constants.ts";
import type { PersonaId, SubscriptionProvider } from "./types.ts";
import { VIP_ARCHETYPE_KEYWORDS } from "./vip-engine.ts";

export { detectUnderageText, type UnderageDetectionResult };

export interface PromptCacheKeyInput {
  readonly provider: SubscriptionProvider | (string & {});
  readonly model: string;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly personaId?: PersonaId | (string & {});
  readonly scope?: string;
}

export interface PromptCacheEntry {
  readonly key: string;
  readonly promptHash: string;
  readonly provider: string;
  readonly model: string;
  readonly text: string;
  readonly cachedAtMs: number;
  readonly expiresAtMs: number;
}

export interface PromptCacheStats {
  readonly size: number;
  readonly maxEntries: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRate: number;
  readonly evictions: number;
}

export interface PromptCacheOptions {
  readonly clock?: Clock;
  readonly maxEntries?: number;
  readonly defaultTtlMs?: number;
}

export interface LlmCostEstimateInput {
  readonly model?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly cacheWriteTokens?: number;
}

export type DeterministicTaskHint =
  | "auto"
  | "opt_out_check"
  | "applicant_screen"
  | "script_lint"
  | "vip_classify";

export interface DeterministicRouteInput {
  readonly prompt: string;
  readonly personaId?: PersonaId;
  readonly taskHint?: DeterministicTaskHint;
}

export interface DeterministicRouteResult {
  readonly handled: true;
  readonly rule: "opt_out_check" | "applicant_screen" | "script_lint" | "vip_classify";
  readonly outputText: string;
  readonly data: Record<string, unknown>;
  readonly inputTokens: 0;
  readonly outputTokens: 0;
  readonly costMicros: 0;
  readonly costCents: 0;
}

const DEFAULT_MAX_CACHE_ENTRIES = 512;
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;
const FALLBACK_MODEL_PRICE = OPENAI_PRICES[DEFAULT_MODEL] ?? {
  input: 0.1,
  cachedInput: 0.01,
  cacheWrite: 0.125,
  output: 0.5,
};

function normalizePromptWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashPromptText(systemPrompt: string, prompt: string): string {
  return sha256Hex(
    JSON.stringify([
      normalizePromptWhitespace(systemPrompt),
      normalizePromptWhitespace(prompt),
    ]),
  );
}

export function buildPromptCacheKey(input: PromptCacheKeyInput): string {
  const scope = input.scope ? normalizePromptWhitespace(input.scope) : "";
  const parts = [
    String(input.personaId ?? "").trim().toLowerCase(),
    String(input.provider).trim().toLowerCase(),
    input.model.trim().toLowerCase(),
    normalizePromptWhitespace(input.systemPrompt),
    normalizePromptWhitespace(input.prompt),
  ];
  if (scope) parts.push(scope);
  return sha256Hex(JSON.stringify(parts));
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function estimateLlmCostMicros(input: LlmCostEstimateInput): number {
  const p = priceFor(input.model ?? DEFAULT_MODEL) ?? FALLBACK_MODEL_PRICE;
  const inputTokens = Math.max(0, Math.floor(input.inputTokens));
  const outputTokens = Math.max(0, Math.floor(input.outputTokens));
  const cachedTokens = Math.max(0, Math.min(inputTokens, Math.floor(input.cachedTokens ?? 0)));
  const cacheWriteTokens = Math.max(
    0,
    Math.min(inputTokens - cachedTokens, Math.floor(input.cacheWriteTokens ?? 0)),
  );
  const uncachedInput = Math.max(0, inputTokens - cachedTokens - cacheWriteTokens);
  const micros =
    uncachedInput * p.input +
    cachedTokens * p.cachedInput +
    cacheWriteTokens * p.cacheWrite +
    outputTokens * p.output;
  return Math.max(0, Math.round(micros));
}

export function estimateLlmCostCents(input: LlmCostEstimateInput): number {
  const micros = estimateLlmCostMicros(input);
  return Math.floor((micros + 5_000) / 10_000);
}

export class PromptCache {
  private readonly clock: Clock;
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly entries = new Map<string, PromptCacheEntry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(opts: PromptCacheOptions = {}) {
    this.clock = opts.clock ?? new RealClock();
    const rawMax = opts.maxEntries;
    this.maxEntries =
      typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 1
        ? Math.floor(rawMax)
        : DEFAULT_MAX_CACHE_ENTRIES;
    const rawTtl = opts.defaultTtlMs;
    this.defaultTtlMs =
      typeof rawTtl === "number" && Number.isFinite(rawTtl) && rawTtl >= 1_000
        ? Math.floor(rawTtl)
        : DEFAULT_CACHE_TTL_MS;
  }

  get(key: string): PromptCacheEntry | null {
    const existing = this.entries.get(key);
    if (!existing) {
      this.misses += 1;
      return null;
    }
    const nowMs = this.clock.now();
    if (nowMs >= existing.expiresAtMs) {
      this.entries.delete(key);
      this.evictions += 1;
      this.misses += 1;
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, existing);
    this.hits += 1;
    return { ...existing };
  }

  set(
    key: string,
    payload: {
      readonly promptHash: string;
      readonly provider: string;
      readonly model: string;
      readonly text: string;
    },
    ttlMs?: number,
  ): PromptCacheEntry | null {
    const cleanText = payload.text.trim();
    if (!cleanText) return null;

    const nowMs = this.clock.now();
    const effectiveTtl =
      ttlMs !== undefined && Number.isFinite(ttlMs) && ttlMs > 0
        ? Math.floor(ttlMs)
        : this.defaultTtlMs;

    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      this.pruneExpired(nowMs);
      while (this.entries.size >= this.maxEntries) {
        const oldestKey = this.entries.keys().next().value;
        if (oldestKey === undefined) break;
        this.entries.delete(oldestKey);
        this.evictions += 1;
      }
    }

    const entry: PromptCacheEntry = {
      key,
      promptHash: payload.promptHash,
      provider: payload.provider,
      model: payload.model,
      text: cleanText,
      cachedAtMs: nowMs,
      expiresAtMs: nowMs + effectiveTtl,
    };
    this.entries.set(key, entry);
    return { ...entry };
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  pruneExpired(nowMs = this.clock.now()): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (nowMs >= entry.expiresAtMs) {
        this.entries.delete(key);
        this.evictions += 1;
        removed += 1;
      }
    }
    return removed;
  }

  stats(): PromptCacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Number((this.hits / total).toFixed(4)) : 0,
      evictions: this.evictions,
    };
  }
}

const SCRIPT_FORBIDDEN_RULES: ReadonlyArray<{ readonly code: string; readonly re: RegExp }> = [
  {
    code: "clef_secrecy_violation",
    re: /\b(clef\s*score|clef\s*rating|attractiveness\s*score|looks\s*rating|rated\s+a\s+[0-9](\.[0-9])?\/10)\b/i,
  },
  {
    code: "minor_targeting_violation",
    re: /\b(high\s*school(er)?s?|high\s*school\s*(?:freshman|sophomore|junior|senior|student)|under\s*18|1[3-7]\s*y\/?o|16[\s-]year[\s-]old|17[\s-]year[\s-]old|turning\s+18|middle\s*school(er)?s?|prom\s*date|teen\s*dating)\b/i,
  },
  {
    code: "raw_phone_number_exposure",
    re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  },
  {
    code: "forbidden_gimmick_hardware",
    re: /\b(wearable\s*billboard|portable\s*receipt\s*printer|thermal\s*printer\s*citation)\b/i,
  },
];

function stripPrefix(prompt: string, prefixRe: RegExp): string {
  return prompt.replace(prefixRe, "").trim();
}

export function tryDeterministicRoute(
  input: DeterministicRouteInput,
): DeterministicRouteResult | null {
  const trimmed = input.prompt.trim();
  if (!trimmed) return null;

  const hint = input.taskHint ?? "auto";

  if (hint === "opt_out_check" || /^(?:CLASSIFY_OPT_OUT|CHECK_STOP):/i.test(trimmed)) {
    const body = stripPrefix(trimmed, /^(?:CLASSIFY_OPT_OUT|CHECK_STOP):/i);
    const reading = parseOptOut(body);
    const optedOut = reading.match !== "none";
    const data = { optedOut, match: reading.match };
    return {
      handled: true,
      rule: "opt_out_check",
      outputText: JSON.stringify(data),
      data,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      costCents: 0,
    };
  }

  if (hint === "script_lint" || /^LINT_SCRIPT:/i.test(trimmed)) {
    const body = stripPrefix(trimmed, /^LINT_SCRIPT:/i);
    const errors: string[] = [];
    for (const rule of SCRIPT_FORBIDDEN_RULES) {
      if (rule.re.test(body)) errors.push(rule.code);
    }
    const sponsored = /\bsponsored\b/i.test(body);
    if (sponsored && !/(#ad\b|paid\s+partnership|sponsored\s+by)/i.test(body)) {
      errors.push("missing_ftc_disclosure");
    }
    const data = { pass: errors.length === 0, errors };
    return {
      handled: true,
      rule: "script_lint",
      outputText: JSON.stringify(data),
      data,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      costCents: 0,
    };
  }

  if (hint === "applicant_screen" || /^SCREEN_APPLICANT:/i.test(trimmed)) {
    const body = stripPrefix(trimmed, /^SCREEN_APPLICANT:/i);
    const reading = parseOptOut(body);
    if (reading.match !== "none") {
      const data = { decision: "rejected_opt_out", score: 0, reasons: ["applicant_opted_out"] };
      return {
        handled: true,
        rule: "applicant_screen",
        outputText: JSON.stringify(data),
        data,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        costCents: 0,
      };
    }
    const underage = detectUnderageText(body);
    if (underage.isMinor) {
      const data = {
        decision: "rejected_underage",
        score: 0,
        statedAge: underage.statedAge,
        reasons: ["worker_must_be_18_plus", ...(underage.reason ? [underage.reason] : [])],
      };
      return {
        handled: true,
        rule: "applicant_screen",
        outputText: JSON.stringify(data),
        data,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        costCents: 0,
      };
    }
    const lower = body.toLowerCase();
    let score = 0;
    const reasons: string[] = [];
    if (/(?:^|\W)18\+(?:\W|$)|\bconfirmed\b/.test(lower)) score += 25;
    else reasons.push("missing_age_confirmation");
    if (/\b(promo|street team|ambassador|hospitality|sales|filming|youtube|tiktok|events?)\b/i.test(lower)) {
      score += 25;
    } else {
      reasons.push("missing_relevant_experience");
    }
    if (/\b(https?:\/\/|clip|reel|portfolio|video)\b/i.test(lower)) score += 25;
    else reasons.push("missing_intro_clip");
    if (/\b(available|confirm|subway|train|transit|downtown|local)\b/i.test(lower)) score += 25;
    else reasons.push("missing_locality_or_availability");
    const decision =
      score >= 75 ? "auto_hire" : score >= 50 ? "standby_bench" : "rejected_low_score";
    const data = { decision, score, reasons };
    return {
      handled: true,
      rule: "applicant_screen",
      outputText: JSON.stringify(data),
      data,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      costCents: 0,
    };
  }

  if (hint === "vip_classify" || /^CLASSIFY_VIP:/i.test(trimmed)) {
    const body = stripPrefix(trimmed, /^CLASSIFY_VIP:/i).toLowerCase();
    let bestSlug = "startup_founder";
    let bestHits = 0;
    for (const [slug, keywords] of VIP_ARCHETYPE_KEYWORDS) {
      let hits = 0;
      for (const kw of keywords) {
        if (body.includes(kw)) hits += 1;
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestSlug = slug;
      }
    }
    const data = { archetype: bestSlug, matchedKeywords: bestHits };
    return {
      handled: true,
      rule: "vip_classify",
      outputText: JSON.stringify(data),
      data,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      costCents: 0,
    };
  }

  return null;
}
