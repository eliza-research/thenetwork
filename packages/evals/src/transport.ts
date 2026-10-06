// Instrumented transport for eval calls made through `llmFor("surplus", model)`.
//
// The shared LLM interface (packages/core/src/llm.ts) returns only message text, but evals need
// usage, cost, latency and a response cache. Rather than fork the client, we wrap global fetch
// for the duration of an eval call (scoped with AsyncLocalStorage, so concurrent calls never mix):
//   - injects identical request settings for every model (reasoning_effort, ...);
//   - caches each chat-completions response on disk keyed by the exact request body + attempt,
//     so reruns are free and deterministic;
//   - records latency, tokens and Surplus cost (usage.buyer_cost_micro) per HTTP request.
// API keys are never logged or written: only the request BODY is hashed/stored, never headers.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RequestSettings {
  /** Surplus/OpenAI reasoning effort, applied identically to every model. */
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
}

export interface HttpRecord {
  model: string; status: number; cached: boolean; latencyMs: number;
  promptTokens: number; completionTokens: number; reasoningTokens: number;
  /** Surplus buyer cost in micro-USD (usage.buyer_cost_micro). */
  costMicro: number; finishReason?: string; error?: string;
}

export interface CallScope {
  records: HttpRecord[];
  attempt: number;
  cacheDir: string;
  settings: RequestSettings;
  /** When true, never touch the network (cache-only replay). */
  offline?: boolean;
}

const scope = new AsyncLocalStorage<CallScope>();
let installed = false;
let realFetch: typeof fetch;

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export function installTransport() {
  if (installed) return;
  installed = true;
  realFetch = globalThis.fetch;
  const patched = async (input: any, init?: any): Promise<Response> => {
    const s = scope.getStore();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if (!s || !url || !String(url).endsWith("/chat/completions") || !init?.body) return realFetch(input, init);
    const body = JSON.parse(String(init.body));
    Object.assign(body, s.settings);
    const key = sha(stable({ body, attempt: s.attempt, v: 1 }));
    const dir = join(s.cacheDir, String(body.model).replace(/[^\w.-]/g, "_"));
    const file = join(dir, `${key}.json`);
    if (existsSync(file)) {
      const c = JSON.parse(readFileSync(file, "utf8"));
      s.records.push({ ...recordFrom(body.model, 200, c.data, c.latencyMs), cached: true });
      return new Response(JSON.stringify(c.data), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (s.offline) {
      s.records.push({ ...emptyRecord(body.model, 599), error: "offline cache miss" });
      throw new Error(`offline: no cached response for ${body.model}`);
    }
    const t0 = performance.now();
    let res: Response;
    try {
      res = await realFetch(input, { ...init, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
    } catch (e) {
      s.records.push({ ...emptyRecord(body.model, 0), latencyMs: performance.now() - t0, error: String(e).slice(0, 200) });
      // Surface as a retryable 5xx so the core client's backoff handles it.
      return new Response(JSON.stringify({ error: "network error" }), { status: 503 });
    }
    const latencyMs = performance.now() - t0;
    const text = await res.text();
    if (!res.ok) {
      s.records.push({ ...emptyRecord(body.model, res.status), latencyMs, error: text.slice(0, 300) });
      return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
    }
    const data = JSON.parse(text);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ request: body, latencyMs, data }));
    s.records.push(recordFrom(body.model, res.status, data, latencyMs));
    return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
  };
  globalThis.fetch = Object.assign(patched, { preconnect: (realFetch as any).preconnect }) as typeof fetch;
}

function emptyRecord(model: string, status: number): HttpRecord {
  return { model, status, cached: false, latencyMs: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costMicro: 0 };
}

export function recordFrom(model: string, status: number, data: any, latencyMs: number): HttpRecord {
  const u = data?.usage ?? {};
  return {
    model, status, cached: false, latencyMs,
    promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    costMicro: Number(u.buyer_cost_micro ?? (typeof u.cost === "number" ? u.cost * 1e6 : 0)) || 0,
    finishReason: data?.choices?.[0]?.finish_reason,
  };
}

/** Run `fn` with instrumented, cached transport; returns its value plus the HTTP records. */
export async function withScope<T>(s: Omit<CallScope, "records">, fn: () => Promise<T>): Promise<{ value?: T; error?: string; records: HttpRecord[] }> {
  installTransport();
  const full: CallScope = { ...s, records: [] };
  try {
    const value = await scope.run(full, fn);
    return { value, records: full.records };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e).slice(0, 300), records: full.records };
  }
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
