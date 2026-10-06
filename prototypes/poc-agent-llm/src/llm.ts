// LLM plumbing for the POC: env loading, disk cache transport, usage/cost metering, zod-validated
// structured calls with at most one repair retry. Uses packages/core clients unmodified.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { defaultLLM, llmFor, parseJson, type ChatMessage, type ClientOptions, type LLM, type ResponseInfo } from "../../../packages/core/src/llm.ts";

export const ROOT = join(import.meta.dir, "..");
const REPO = join(ROOT, "..", "..");

// Load repo .env when run from this folder (Bun only auto-loads .env from cwd). Never prints values.
(function loadEnv() {
  const p = join(REPO, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

export interface CallRecord {
  callType: string; model: string; status: number; ok: boolean; attempt: number; cached: boolean;
  latencyMs: number; promptTokens: number; completionTokens: number; reasoningTokens: number; costMicro: number;
  finishReason?: string; error?: string; t: number;
}
export const calls: CallRecord[] = [];

const CACHE_DIR = join(ROOT, "cache");
/** Cache key: hash of the exact request body plus an optional salt (bench uses a salt per run to force fresh calls). */
function key(body: string, salt: string) { return createHash("sha256").update(salt + "\n" + body).digest("hex"); }

/** fetch transport that serves/stores successful responses from cache/<model>/<hash>.json. */
function cachedFetch(salt: string, useCache: boolean) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    const body = String(init.body);
    const model = (JSON.parse(body).model as string).replace(/[^a-z0-9.\-]/gi, "_");
    const file = join(CACHE_DIR, model, key(body, salt) + ".json");
    if (useCache && existsSync(file)) {
      const c = JSON.parse(readFileSync(file, "utf8"));
      return new Response(c.body, { status: c.status, headers: { "content-type": "application/json", "x-cache": "hit", "x-orig-latency": String(c.latencyMs) } });
    }
    const t0 = performance.now();
    const res = await fetch(url, init);
    const latencyMs = performance.now() - t0;
    if (!res.ok) return res;
    const text = await res.text();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ status: res.status, latencyMs, body: text, at: new Date().toISOString() }));
    return new Response(text, { status: res.status, headers: { "content-type": "application/json", "x-cache": "miss" } });
  };
}

export interface ClientCfg { callType: string; provider?: "surplus"; model?: string; salt?: string; useCache?: boolean; extraBody?: Record<string, unknown> }

/** A metered, cached client. Default = production model (DEFAULT_LLM_*). */
export function client(cfg: ClientCfg): LLM {
  const hooks: ClientOptions = {
    fetch: cachedFetch(cfg.salt ?? "", cfg.useCache ?? true),
    timeoutMs: 120_000,
    extraBody: cfg.extraBody,
    onResponse: (i: ResponseInfo) => {
      const hit = i.headers?.get("x-cache") === "hit";
      calls.push({
        callType: cfg.callType, model: i.model, status: i.status, ok: i.ok, attempt: i.attempt, cached: hit,
        latencyMs: hit ? Number(i.headers?.get("x-orig-latency")) : i.latencyMs,
        promptTokens: i.usage.promptTokens, completionTokens: i.usage.completionTokens, reasoningTokens: i.usage.reasoningTokens,
        costMicro: i.costMicro, finishReason: i.finishReason, error: i.error, t: Date.now(),
      });
    },
  };
  return cfg.model ? llmFor(cfg.provider ?? "surplus", cfg.model, hooks) : defaultLLM(hooks);
}

export interface StructuredResult<T> { value?: T; validFirst: boolean; validAfterRepair: boolean; raw: string; repairRaw?: string; error?: string }

/** chat → JSON → zod; on failure one repair turn with the validation errors. */
export async function structured<T>(llm: LLM, messages: ChatMessage[], schema: z.ZodType<T>, maxTokens = 4096): Promise<StructuredResult<T>> {
  const tryParse = (raw: string): { ok: true; v: T } | { ok: false; err: string } => {
    let obj: unknown;
    try { obj = parseJson(raw); } catch (e) { return { ok: false, err: "not JSON: " + String((e as Error).message).slice(0, 200) }; }
    const r = schema.safeParse(obj);
    return r.success ? { ok: true, v: r.data } : { ok: false, err: JSON.stringify(r.error.issues.slice(0, 8)).slice(0, 1200) };
  };
  let raw = "";
  try { raw = await llm.chat(messages, { json: true, maxTokens }); } catch (e) { return { validFirst: false, validAfterRepair: false, raw: "", error: String(e).slice(0, 300) }; }
  const a = tryParse(raw);
  if (a.ok) return { value: a.v, validFirst: true, validAfterRepair: true, raw };
  let repairRaw = "";
  try {
    repairRaw = await llm.chat([...messages, { role: "assistant", content: raw },
      { role: "user", content: `Your JSON failed schema validation: ${a.err}\nReturn ONLY the corrected JSON object, same schema.` }], { json: true, maxTokens });
  } catch (e) { return { validFirst: false, validAfterRepair: false, raw, error: String(e).slice(0, 300) }; }
  const b = tryParse(repairRaw);
  return b.ok ? { value: b.v, validFirst: false, validAfterRepair: true, raw, repairRaw } : { validFirst: false, validAfterRepair: false, raw, repairRaw, error: b.err };
}

/** Bounded-concurrency map preserving order. */
export async function pool<A, B>(items: A[], n: number, fn: (a: A, i: number) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export const readJsonl = <T = any>(p: string): T[] => readFileSync(join(ROOT, p), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
export const writeJsonl = (p: string, rows: unknown[]) => { mkdirSync(dirname(join(ROOT, p)), { recursive: true }); writeFileSync(join(ROOT, p), rows.map(r => JSON.stringify(r)).join("\n") + "\n"); };
export const writeJson = (p: string, v: unknown) => { mkdirSync(dirname(join(ROOT, p)), { recursive: true }); writeFileSync(join(ROOT, p), JSON.stringify(v, null, 2)); };

/** Seeded RNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const r = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { r, pick: <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)], chance: (p: number) => r() < p };
}

export function pct(xs: number[], p: number) { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }
