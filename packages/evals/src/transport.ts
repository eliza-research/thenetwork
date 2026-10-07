// Instrumented, cached transport for eval calls.
//
// Uses the core client's hooks (packages/core/src/llm.ts ClientOptions) instead of patching global
// fetch: each eval call gets its own client with
//   - extraBody: identical request settings for every model (reasoning_effort, ...);
//   - fetch: a disk cache keyed by the exact request body + eval attempt, so reruns are free and
//     deterministic (and --offline replays without network);
//   - onResponse: latency, tokens and Surplus cost (usage.buyer_cost_micro) per HTTP request.
// API keys are never logged or written: only the request BODY is hashed/stored, never headers.
// Cache key format is unchanged from the earlier fetch-patch version (sha256 of {body, attempt, v:1}),
// so existing runs/evals/cache entries stay valid.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endpointsFor, OpenAILLM, type LLM, type ResponseInfo } from "../../core/src/index.ts";

export interface RequestSettings {
  /** Surplus/OpenAI reasoning effort, applied identically to every model. */
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
}

export interface HttpRecord {
  model: string; baseUrl: string; status: number; cached: boolean; latencyMs: number;
  promptTokens: number; completionTokens: number; reasoningTokens: number;
  /** Surplus buyer cost in micro-USD (usage.buyer_cost_micro). */
  costMicro: number; finishReason?: string; error?: string;
}

export interface CallScope {
  /** Eval-level attempt (a re-ask after a schema failure is a new cache key). */
  attempt: number;
  cacheDir: string;
  settings: RequestSettings;
  /** When true, never touch the network (cache-only replay). */
  offline?: boolean;
  /** Network transport behind the cache (default global fetch). Tests pass a fake. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Override the endpoint / key (default: Surplus, falling back to OpenAI, from .env). */
  baseUrl?: string; apiKey?: string;
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export const cacheKey = (body: unknown, attempt: number) => sha(stable({ body, attempt, v: 1 }));

const CACHE_HEADER = "x-evals-cache";
const LATENCY_HEADER = "x-evals-cached-latency-ms";
/** Status used for an offline cache miss: non-retryable, so the core client fails fast. */
export const OFFLINE_MISS_STATUS = 412;

/** A fetch-compatible function that serves/stores chat-completions responses from a disk cache. */
export function cachingFetch(s: CallScope): (url: string, init: RequestInit) => Promise<Response> {
  const net = s.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  return async (url, init) => {
    const body = JSON.parse(String(init.body));
    const dir = join(s.cacheDir, String(body.model).replace(/[^\w.-]/g, "_"));
    const file = join(dir, `${cacheKey(body, s.attempt)}.json`);
    if (existsSync(file)) {
      const c = JSON.parse(readFileSync(file, "utf8"));
      return new Response(JSON.stringify(c.data), {
        status: 200, headers: { "Content-Type": "application/json", [CACHE_HEADER]: "hit", [LATENCY_HEADER]: String(c.latencyMs ?? 0) },
      });
    }
    if (s.offline) return new Response(`offline: no cached response for ${body.model}`, { status: OFFLINE_MISS_STATUS });
    const t0 = performance.now();
    const res = await net(url, init);
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify({ request: body, latencyMs: performance.now() - t0, data }));
    }
    return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
  };
}

export function recordOf(info: ResponseInfo): HttpRecord {
  const cached = info.headers?.get(CACHE_HEADER) === "hit";
  return {
    model: info.model, baseUrl: info.baseUrl, status: info.status, cached,
    latencyMs: cached ? Number(info.headers?.get(LATENCY_HEADER) ?? 0) : info.latencyMs,
    promptTokens: info.usage.promptTokens, completionTokens: info.usage.completionTokens, reasoningTokens: info.usage.reasoningTokens,
    costMicro: info.costMicro, finishReason: info.finishReason, ...(info.error ? { error: info.error } : {}),
  };
}

/** A Surplus client (OpenAI fallback) for `model` wired to the cache + recorder for one eval call. */
export function instrumentedLLM(model: string, s: CallScope, records: HttpRecord[]): LLM {
  const surplusUrl = "https://api.surplusintelligence.ai/v1";
  const [first, ...fallbacks] = s.baseUrl || s.apiKey ? [{ baseUrl: s.baseUrl ?? surplusUrl, apiKey: s.apiKey ?? "" }] : endpointsFor("surplus");
  // Offline replay needs no key: the cache answers or the call fails fast with OFFLINE_MISS_STATUS.
  const { baseUrl, apiKey } = first ?? { baseUrl: surplusUrl, apiKey: s.offline ? "offline-no-key" : "" };
  return new OpenAILLM(apiKey, model, baseUrl, {
    extraBody: { ...s.settings },
    fetch: cachingFetch(s),
    onResponse: info => records.push(recordOf(info)),
    timeoutMs: 180_000,
  }, fallbacks);
}

/** How an eval call's error is recorded in results (first 300 chars of the message). */
export const errorText = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300);

/** Run one eval call with an instrumented, cached client; returns its value plus the HTTP records. */
export async function withScope<T>(model: string, s: CallScope, fn: (llm: LLM) => Promise<T>): Promise<{ value?: T; error?: string; records: HttpRecord[] }> {
  const records: HttpRecord[] = [];
  try {
    const value = await fn(instrumentedLLM(model, s, records));
    return { value, records };
  } catch (e) {
    return { error: errorText(e), records };
  }
}

/**
 * Per-attempt clients for core tryChatJson: attempt n gets its own cache scope (eval attempt
 * n + offset, so a re-ask after a schema failure is a new cache key), and `records()` returns the
 * HTTP records of the attempt that ran last.
 */
export function attemptScopes(model: string, base: Omit<CallScope, "attempt">, offset = 0): { llm: (attempt: number) => LLM; records: () => HttpRecord[] } {
  let current: HttpRecord[] = [];
  return {
    llm: attempt => { current = []; return instrumentedLLM(model, { ...base, attempt: attempt + offset }, current); },
    records: () => current,
  };
}

/** Bounded-concurrency map preserving order. */
export async function pmap<T, R>(xs: T[], n: number, f: (x: T, i: number) => Promise<R>, onDone?: (k: number) => void): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await f(xs[i]!, i);
      onDone?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, xs.length)) }, worker));
  return out;
}
