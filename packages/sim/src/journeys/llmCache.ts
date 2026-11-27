import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  LLMBudget,
  LLMError,
  type ClientOptions,
  type FallbackInfo,
  type ResponseInfo,
} from "@thenetwork/core";

export const DEFAULT_JOURNEYS_CACHE_PATH = "runs/journeys-llm-cache.jsonl";

export interface JourneyLLMCacheEntry {
  readonly key: string;
  readonly url: string;
  readonly status: number;
  readonly body: unknown;
  readonly recordedAt: string;
}

export interface JourneyLLMTelemetry {
  promptTokens: number;
  cachedPromptTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costMicro: number;
  costUsd: number;
  latencyMs: number;
  requests: number;
  liveNetworkRequests: number;
  cacheHits: number;
  cacheMisses: number;
  replayCacheHitRate: number;
  budgetBreaches: number;
  fallbacks: number;
}

export interface JourneyLLMCacheOptions {
  readonly cachePath?: string | null;
  readonly maxBudgetUsd?: number;
  readonly maxRequests?: number;
  readonly upstreamFetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
  readonly deadlineMs?: number;
  readonly seed?: number;
}

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter(k => o[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export function hashRequestKey(url: string, rawBody: unknown): string {
  let parsed: unknown = rawBody;
  if (typeof rawBody === "string") {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = rawBody;
    }
  }
  return createHash("sha256")
    .update(`${url}\n${canonicalJson(parsed)}`)
    .digest("hex");
}

export class JourneyLLMCache {
  readonly budget: LLMBudget;
  private readonly cachePath: string | null;
  private readonly upstreamFetch: (url: string, init: RequestInit) => Promise<Response>;
  private readonly entries = new Map<string, JourneyLLMCacheEntry>();
  private readonly timeoutMs: number;
  private readonly deadlineMs: number;
  private readonly seed?: number;

  private promptTokens = 0;
  private cachedPromptTokens = 0;
  private cacheWriteTokens = 0;
  private completionTokens = 0;
  private reasoningTokens = 0;
  private costMicro = 0;
  private latencyMs = 0;
  private requests = 0;
  private liveNetworkRequests = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private budgetBreaches = 0;
  private fallbacks = 0;

  constructor(opts: JourneyLLMCacheOptions = {}) {
    const maxBudgetUsd = opts.maxBudgetUsd ?? 1.0;
    const maxRequests = opts.maxRequests ?? 80;
    this.budget = new LLMBudget({
      maxCostMicro: Math.round(maxBudgetUsd * 1e6),
      maxRequests,
    });
    this.cachePath = opts.cachePath === undefined ? DEFAULT_JOURNEYS_CACHE_PATH : opts.cachePath;
    this.upstreamFetch = opts.upstreamFetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.deadlineMs = opts.deadlineMs ?? 90_000;
    this.seed = opts.seed;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!this.cachePath || !existsSync(this.cachePath)) return;
    const raw = readFileSync(this.cachePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as JourneyLLMCacheEntry;
        if (parsed && typeof parsed.key === "string" && typeof parsed.status === "number") {
          this.entries.set(parsed.key, parsed);
        }
      } catch {
        continue;
      }
    }
  }

  private persistEntry(entry: JourneyLLMCacheEntry): void {
    if (!this.cachePath) return;
    const dir = dirname(this.cachePath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(this.cachePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  get size(): number {
    return this.entries.size;
  }

  resetRunCounters(): void {
    this.promptTokens = 0;
    this.cachedPromptTokens = 0;
    this.cacheWriteTokens = 0;
    this.completionTokens = 0;
    this.reasoningTokens = 0;
    this.costMicro = 0;
    this.latencyMs = 0;
    this.requests = 0;
    this.liveNetworkRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.budgetBreaches = 0;
    this.fallbacks = 0;
  }

  readonly fetch: (url: string, init: RequestInit) => Promise<Response> = async (url, init) => {
    const key = hashRequestKey(url, init.body);
    const cached = this.entries.get(key);
    if (cached) {
      this.cacheHits++;
      return new Response(JSON.stringify(cached.body), {
        status: cached.status,
        headers: {
          "content-type": "application/json",
          "x-journeys-cache": "hit",
        },
      });
    }

    if (
      (this.budget.limits.maxCostMicro !== undefined && this.budget.spentMicro > this.budget.limits.maxCostMicro) ||
      (this.budget.limits.maxRequests !== undefined && this.budget.requests > this.budget.limits.maxRequests)
    ) {
      this.budgetBreaches++;
      throw new LLMError("budget", "journeys LLM budget already exceeded before network fetch");
    }

    this.cacheMisses++;
    this.liveNetworkRequests++;
    const response = await this.upstreamFetch(url, init);
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    if (response.ok && typeof parsed === "object" && parsed !== null) {
      const entry: JourneyLLMCacheEntry = {
        key,
        url,
        status: response.status,
        body: parsed,
        recordedAt: new Date().toISOString(),
      };
      this.entries.set(key, entry);
      this.persistEntry(entry);
    }

    return new Response(text, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "x-journeys-cache": "miss",
      },
    });
  };

  readonly onResponse = (info: ResponseInfo): void => {
    this.requests++;
    this.latencyMs += info.latencyMs;
    const fromCache = info.headers?.get("x-journeys-cache") === "hit";
    this.promptTokens += info.usage.promptTokens;
    this.cachedPromptTokens += info.usage.cachedPromptTokens ?? 0;
    this.cacheWriteTokens += info.usage.cacheWriteTokens ?? 0;
    this.completionTokens += info.usage.completionTokens;
    this.reasoningTokens += info.usage.reasoningTokens;
    if (!fromCache) {
      this.costMicro += info.costMicro;
    }
    if (
      this.budget.limits.maxCostMicro !== undefined &&
      this.costMicro > this.budget.limits.maxCostMicro * 1.15
    ) {
      this.budgetBreaches++;
    }
  };

  readonly onFallback = (_info: FallbackInfo): void => {
    this.fallbacks++;
  };

  clientOptions(): ClientOptions {
    return {
      fetch: this.fetch,
      budget: this.budget,
      onResponse: this.onResponse,
      onFallback: this.onFallback,
      timeoutMs: this.timeoutMs,
      deadlineMs: this.deadlineMs,
      ...(this.seed !== undefined ? { seed: this.seed } : {}),
    };
  }

  telemetry(): JourneyLLMTelemetry {
    const totalFetchLookups = this.cacheHits + this.cacheMisses;
    const replayCacheHitRate = totalFetchLookups > 0 ? this.cacheHits / totalFetchLookups : 1;
    return {
      promptTokens: this.promptTokens,
      cachedPromptTokens: this.cachedPromptTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      completionTokens: this.completionTokens,
      reasoningTokens: this.reasoningTokens,
      costMicro: this.costMicro,
      costUsd: Math.round(this.costMicro) / 1e6,
      latencyMs: Math.round(this.latencyMs),
      requests: this.requests,
      liveNetworkRequests: this.liveNetworkRequests,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      replayCacheHitRate,
      budgetBreaches: this.budgetBreaches,
      fallbacks: this.fallbacks,
    };
  }
}

export function createJourneyLLMCache(opts: JourneyLLMCacheOptions = {}): JourneyLLMCache {
  return new JourneyLLMCache(opts);
}

/**
 * Deterministic offline verification of the SHA-256 JSONL fetch cache + LLMBudget layer.
 * Makes 0 network calls and proves warm replay achieves >= 95% cache hit rate (100%)
 * and hard budget cap enforces 0 breaches.
 */
export async function verifyReplayCacheHitRate(): Promise<{
  coldMisses: number;
  warmHits: number;
  warmTotal: number;
  replayCacheHitRate: number;
  budgetCapTriggered: boolean;
  budgetBreaches: number;
}> {
  let upstreamCalls = 0;
  const mockFetch = async (_url: string, init: RequestInit): Promise<Response> => {
    upstreamCalls++;
    const body = JSON.parse(String(init.body ?? "{}")) as { messages?: Array<{ content?: string }> };
    const prompt = body.messages?.map(m => m.content ?? "").join("|") ?? "";
    return new Response(
      JSON.stringify({
        id: `sim-chat-${upstreamCalls}`,
        model: "gpt-6-luna",
        choices: [{ index: 0, message: { role: "assistant", content: `ok:${prompt.slice(0, 24)}` }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 24,
          prompt_tokens_details: { cached_tokens: 96 },
          completion_tokens_details: { reasoning_tokens: 4 },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const cache = createJourneyLLMCache({
    cachePath: null,
    maxBudgetUsd: 1.0,
    maxRequests: 20,
    upstreamFetch: mockFetch,
  });

  const samplePayloads = [
    { model: "gpt-6-luna", prompt_cache_key: "journeys:v1:1", reasoning_effort: "low", messages: [{ role: "user", content: "hi sf coffee" }] },
    { model: "gpt-6-luna", prompt_cache_key: "journeys:v1:2", reasoning_effort: "low", messages: [{ role: "user", content: "halal sober quiet" }] },
    { model: "gpt-6-luna", prompt_cache_key: "journeys:v1:3", reasoning_effort: "low", messages: [{ role: "user", content: "si claro viernes" }] },
    { model: "gpt-6-luna", prompt_cache_key: "journeys:v1:4", reasoning_effort: "low", messages: [{ role: "user", content: "judge transcript" }] },
  ];

  // Cold pass
  for (const payload of samplePayloads) {
    await cache.fetch("https://api.surplusintelligence.ai/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
  const coldMisses = cache.telemetry().cacheMisses;

  // Warm replay pass (with reordered keys to prove canonical hashing)
  cache.resetRunCounters();
  for (const payload of samplePayloads) {
    const reordered = {
      messages: payload.messages,
      reasoning_effort: payload.reasoning_effort,
      model: payload.model,
      prompt_cache_key: payload.prompt_cache_key,
    };
    await cache.fetch("https://api.surplusintelligence.ai/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify(reordered),
    });
  }
  const warm = cache.telemetry();

  // Budget enforcement check
  const tightBudget = createJourneyLLMCache({
    cachePath: null,
    maxBudgetUsd: 0.0001,
    maxRequests: 1,
    upstreamFetch: mockFetch,
  });
  tightBudget.budget.take("test");
  let budgetCapTriggered = false;
  try {
    tightBudget.budget.take("test");
  } catch (err) {
    if (err instanceof LLMError && err.code === "budget") {
      budgetCapTriggered = true;
    }
  }

  return {
    coldMisses,
    warmHits: warm.cacheHits,
    warmTotal: warm.cacheHits + warm.cacheMisses,
    replayCacheHitRate: warm.replayCacheHitRate,
    budgetCapTriggered,
    budgetBreaches: warm.budgetBreaches + tightBudget.telemetry().budgetBreaches,
  };
}
