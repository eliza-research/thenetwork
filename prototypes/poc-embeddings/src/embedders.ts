// Embedding backends for the retrieval POC: the engine's local hashing embedding and OpenAI
// text-embedding-3-{small,large}, with a content-addressed disk cache so reruns cost nothing.
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { localEmbed } from "../../../packages/engine/src/embed.ts";

export const POC_DIR = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
export const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
export const CACHE_DIR = `${POC_DIR}/cache`;

/** USD per 1M input tokens (OpenAI list price, standard tier; batch API is half). */
export const PRICE_PER_M: Record<string, number> = {
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
};

export interface UsageLog {
  model: string; batches: number; texts: number; tokens: number; costUsd: number;
  latencyMs: number[]; cacheHits: number;
}

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const p = `${REPO}/.env`;
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

const keyOf = (model: string, text: string) => createHash("sha256").update(`${model}\u0000${text}`).digest("hex");

/**
 * Cache file per model: JSONL of {k, v} where v is a base64 Float32Array. Loaded fully into memory.
 */
export class EmbedCache {
  private mem = new Map<string, Float32Array>();
  private file: string;
  constructor(readonly model: string) {
    mkdirSync(CACHE_DIR, { recursive: true });
    this.file = `${CACHE_DIR}/${model}.jsonl`;
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, "utf8").split("\n")) {
        if (!line) continue;
        const { k, v } = JSON.parse(line);
        const buf = Buffer.from(v, "base64");
        this.mem.set(k, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
      }
    }
  }
  get(text: string) { return this.mem.get(keyOf(this.model, text)); }
  put(text: string, v: number[]) {
    const f = Float32Array.from(v);
    const k = keyOf(this.model, text);
    this.mem.set(k, f);
    appendFileSync(this.file, JSON.stringify({ k, v: Buffer.from(f.buffer).toString("base64") }) + "\n");
  }
}

/** Embed `texts` with an OpenAI model, using/refreshing the disk cache. Returns L2-normalised vectors. */
export async function openaiEmbedAll(model: string, texts: string[], log: UsageLog, opts: { batchSize?: number } = {}): Promise<Map<string, number[]>> {
  const cache = new EmbedCache(model);
  const uniq = [...new Set(texts)];
  const missing = uniq.filter(t => !cache.get(t));
  log.cacheHits += uniq.length - missing.length;
  if (missing.length) {
    const env = { ...loadEnv(), ...process.env };
    const key = env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY missing (expected in repo .env)");
    const bs = opts.batchSize ?? 256;
    for (let i = 0; i < missing.length; i += bs) {
      const batch = missing.slice(i, i + bs);
      let attempt = 0;
      while (true) {
        const t0 = performance.now();
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, input: batch, encoding_format: "float" }),
        });
        const ms = performance.now() - t0;
        if (res.status === 429 || res.status >= 500) {
          if (++attempt > 5) throw new Error(`OpenAI ${res.status} after retries`);
          await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const j: any = await res.json();
        for (const d of j.data) cache.put(batch[d.index]!, d.embedding);
        log.batches++; log.texts += batch.length; log.tokens += j.usage?.total_tokens ?? 0;
        log.latencyMs.push(Math.round(ms));
        break;
      }
    }
    log.costUsd = (log.tokens / 1e6) * (PRICE_PER_M[model] ?? 0);
  }
  const out = new Map<string, number[]>();
  for (const t of uniq) out.set(t, normalise(Array.from(cache.get(t)!)));
  return out;
}

export function normalise(v: number[]): number[] {
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

export function localEmbedAll(texts: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const t of new Set(texts)) out.set(t, localEmbed(t));
  return out;
}

export const newLog = (model: string): UsageLog => ({ model, batches: 0, texts: 0, tokens: 0, costUsd: 0, latencyMs: [], cacheHits: 0 });

export function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}
