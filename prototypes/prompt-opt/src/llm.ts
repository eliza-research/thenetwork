// luna client for the pilot: defaultLLM() (Surplus gpt-6-luna, OpenAI fallback) with
//   - the same request settings as the passes eval (reasoning_effort=medium, max_completion_tokens 4000, json);
//   - a disk cache keyed exactly like packages/evals/src/transport.ts (sha256 of {body, attempt, v:1}).
//     The evals cache (runs/evals/cache) is READ (so the committed seed outputs replay for free and prove
//     the seed prompt is byte-identical); new responses are written only to prototypes/prompt-opt/.cache;
//   - a hard spend cap: no new HTTP call once fresh spend reaches the cap.
// Never logs headers or keys.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultLLM, parseJson, type ChatMessage, type ResponseInfo } from "../../../packages/core/src/llm.ts";
import { ROOT } from "./data.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const cacheKey = (body: unknown, attempt: number) => sha(stable({ body, attempt, v: 1 }));

const EVALS_CACHE = join(ROOT, "runs/evals/cache");
const OWN_CACHE = join(import.meta.dir, "../.cache");

export class Budget {
  freshMicro = 0; freshCalls = 0; cachedCalls = 0; evalsCacheHits = 0; fallbackCalls = 0;
  promptTokens = 0; completionTokens = 0; latencies: number[] = [];
  /** Observed Surplus micro-USD per token (for estimating any OpenAI-fallback call, which reports no cost). */
  private microPerTok = 0.2;
  constructor(public capUsd: number) {}
  check() { if (this.freshMicro / 1e6 >= this.capUsd) throw new Error(`spend cap $${this.capUsd} reached`); }
  add(info: ResponseInfo, cached: boolean) {
    if (cached || !info.ok) return;
    this.freshCalls++;
    this.promptTokens += info.usage.promptTokens; this.completionTokens += info.usage.completionTokens;
    this.latencies.push(info.latencyMs);
    const toks = info.usage.promptTokens + info.usage.completionTokens;
    if (info.costMicro > 0) { this.freshMicro += info.costMicro; if (toks) this.microPerTok = 0.8 * this.microPerTok + 0.2 * (info.costMicro / toks); }
    else { this.fallbackCalls++; this.freshMicro += toks * this.microPerTok * 3; } // conservative estimate
  }
  get usd() { return this.freshMicro / 1e6; }
}

export interface CallOpts { maxTokens?: number; attempt?: number; budget: Budget }

/** One chat call through the cache. Returns the parsed JSON object (throws on non-JSON). */
export async function chatJson(messages: ChatMessage[], o: CallOpts): Promise<{ raw: string; json: any; cached: boolean }> {
  const attempt = o.attempt ?? 0;
  let cached = false;
  o.budget.check(); // checked before the call (a throw inside fetch would trigger the client's retries)
  const fetchC = async (url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body));
    const sub = String(body.model).replace(/[^\w.-]/g, "_");
    const key = `${cacheKey(body, attempt)}.json`;
    for (const dir of [join(EVALS_CACHE, sub), join(OWN_CACHE, sub)]) {
      const f = join(dir, key);
      if (existsSync(f)) {
        cached = true;
        if (dir.startsWith(EVALS_CACHE)) o.budget.evalsCacheHits++;
        o.budget.cachedCalls++;
        return new Response(JSON.stringify(JSON.parse(readFileSync(f, "utf8")).data), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
    const t0 = performance.now();
    const res = await fetch(url, init);
    const text = await res.text();
    if (res.ok) {
      mkdirSync(join(OWN_CACHE, sub), { recursive: true });
      writeFileSync(join(OWN_CACHE, sub, key), JSON.stringify({ request: body, latencyMs: performance.now() - t0, data: JSON.parse(text) }));
    }
    return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
  };
  const llm = defaultLLM({
    extraBody: { reasoning_effort: "medium" }, fetch: fetchC, maxRetries: 4, timeoutMs: 180_000,
    onResponse: info => o.budget.add(info, cached),
  });
  const raw = await llm.chat(messages, { maxTokens: o.maxTokens ?? 4000, json: true });
  return { raw, json: parseJson(raw), cached };
}

export async function pmap<T, R>(xs: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (next < xs.length) { const i = next++; out[i] = await f(xs[i]!, i); }
  }));
  return out;
}
