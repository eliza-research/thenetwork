// Offline unit tests for the core client hooks (no network, no keys, no global fetch patching).
import { afterEach, expect, test } from "bun:test";
import {
  backoffMs, CerebrasLLM, DEFAULT_TIMEOUT_MS, defaultLLM, endpointsFor, judgeLLM, llmFor, OpenAILLM, parseProvider, recommenderLLM,
  timeoutFor, usageOf, type ResponseInfo,
} from "./llm.ts";

const ok = (content: string, usage: object = { prompt_tokens: 4, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 1 }, buyer_cost_micro: 9 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage }), { status: 200 });

const ENV = [
  "DEFAULT_LLM_PROVIDER", "DEFAULT_LLM_MODEL", "JUDGE_PROVIDER", "JUDGE_MODEL", "RECOMMENDER_PROVIDER", "RECOMMENDER_MODEL", "SURPLUS_API_KEY", "OPENAI_API_KEY",
  "CEREBRAS_API_KEY", "LLM_ALLOW_OPENAI_FALLBACK", "LLM_TIMEOUT_MS", "LLM_MAX_RETRIES",
] as const;
const saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test("extraBody is merged, onResponse reports usage + cost, custom fetch is used, key never in the info", async () => {
  const bodies: any[] = [], infos: ResponseInfo[] = [];
  const before = globalThis.fetch;
  const llm = new OpenAILLM("sk-SECRET", "m1", "https://x.invalid/v1", {
    extraBody: { reasoning_effort: "low" },
    fetch: async (url, init) => { expect(url).toBe("https://x.invalid/v1/chat/completions"); bodies.push(JSON.parse(String(init.body))); return ok("hi"); },
    onResponse: i => infos.push(i),
  });
  expect(await llm.chat([{ role: "user", content: "x" }], { maxTokens: 50, json: true })).toBe("hi");
  expect(globalThis.fetch).toBe(before);
  expect(bodies[0]).toEqual({ model: "m1", messages: [{ role: "user", content: "x" }], max_completion_tokens: 50, response_format: { type: "json_object" }, reasoning_effort: "low" });
  expect(infos[0]!.costMicro).toBe(9);
  expect(infos[0]!.usage).toEqual({ promptTokens: 4, completionTokens: 2, reasoningTokens: 1 });
  expect(JSON.stringify(infos[0]!.request)).not.toContain("SECRET");
});

test("without hooks the request body is unchanged from before (existing call sites and caches)", async () => {
  const bodies: any[] = [];
  const c = new CerebrasLLM("k", "qwen", "https://x.invalid/v1", { fetch: async (_u, init) => { bodies.push(JSON.parse(String(init.body))); return ok("y"); } });
  await c.chat([{ role: "user", content: "x" }], { maxTokens: 10, temperature: 0.9 });
  expect(bodies[0]).toEqual({ model: "qwen", messages: [{ role: "user", content: "x" }], max_tokens: 10, temperature: 0.9 });
});

test("429 is retried with backoff, 4xx fails fast, empty content doubles the budget", async () => {
  const statuses: number[] = [];
  let n = 0;
  const llm = new OpenAILLM("k", "m", "https://x.invalid/v1", {
    fetch: async (_u, init) => {
      n++;
      if (n === 1) return new Response("slow down", { status: 429 });
      if (n === 2) return ok("");
      expect(JSON.parse(String(init.body)).max_completion_tokens).toBe(200);
      return ok("done");
    },
    onResponse: i => statuses.push(i.status),
  });
  expect(await llm.chat([{ role: "user", content: "x" }], { maxTokens: 100 })).toBe("done");
  expect(statuses).toEqual([429, 200, 200]);
  const bad = new OpenAILLM("k", "m", "https://x.invalid/v1", { fetch: async () => new Response("nope", { status: 400 }) });
  await expect(bad.chat([{ role: "user", content: "x" }])).rejects.toThrow("400");
}, 10_000);

test("defaults: gpt-6-luna on Surplus for default, judge and recommender; env overrides", () => {
  for (const k of ENV) delete process.env[k];
  process.env.SURPLUS_API_KEY = "test-key";
  for (const f of [defaultLLM, judgeLLM, recommenderLLM]) {
    const l = f() as any;
    expect(l).toBeInstanceOf(OpenAILLM);
    expect(l.model).toBe("gpt-6-luna");
    expect(l.baseUrl).toContain("surplus");
  }
  process.env.DEFAULT_LLM_MODEL = "other-model";
  expect((defaultLLM() as any).model).toBe("other-model");
});

test("surplus provider: no silent OpenAI fallback by default (audit P1-14)", async () => {
  for (const k of ENV) delete process.env[k];
  process.env.SURPLUS_API_KEY = "s-key";
  process.env.OPENAI_API_KEY = "o-key";
  const calls: string[] = [];
  const fakeFetch = (surplusStatus: number) => async (url: string, init: RequestInit) => {
    const host = new URL(url).host, auth = (init.headers as Record<string, string>).Authorization;
    calls.push(`${host} ${auth}`);
    return host.includes("surplus") ? new Response("busy", { status: surplusStatus }) : ok("from openai");
  };
  expect(endpointsFor("surplus").map(e => new URL(e.baseUrl).host)).toEqual(["api.surplusintelligence.ai"]);
  await expect(llmFor("surplus", "gpt-6-luna", { fetch: fakeFetch(429), maxRetries: 1, retryBaseMs: 1 }).chat([{ role: "user", content: "x" }])).rejects.toThrow("429");
  expect(calls.every(c => c.startsWith("api.surplusintelligence.ai"))).toBe(true);
  expect(calls.length).toBe(2); // first try + 1 bounded retry, never OpenAI

  delete process.env.SURPLUS_API_KEY;
  expect(() => defaultLLM()).toThrow("SURPLUS_API_KEY missing");
});

test("surplus provider: LLM_ALLOW_OPENAI_FALLBACK=1 enables the fallback explicitly, with a warning", async () => {
  for (const k of ENV) delete process.env[k];
  process.env.SURPLUS_API_KEY = "s-key";
  process.env.OPENAI_API_KEY = "o-key";
  process.env.LLM_ALLOW_OPENAI_FALLBACK = "1";
  const warn = console.warn, warnings: string[] = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
  try {
    const calls: string[] = [];
    const fakeFetch = (surplusStatus: number) => async (url: string, init: RequestInit) => {
      const host = new URL(url).host, auth = (init.headers as Record<string, string>).Authorization;
      calls.push(`${host} ${auth}`);
      return host.includes("surplus") ? new Response("busy", { status: surplusStatus }) : ok("from openai");
    };
    expect(await llmFor("surplus", "gpt-6-luna", { fetch: fakeFetch(429) }).chat([{ role: "user", content: "x" }])).toBe("from openai");
    expect(calls).toEqual(["api.surplusintelligence.ai Bearer s-key", "api.openai.com Bearer o-key"]);
    expect(warnings.some(w => w.includes("LLM_ALLOW_OPENAI_FALLBACK"))).toBe(true);

    calls.length = 0;
    await expect(llmFor("surplus", "gpt-6-luna", { fetch: fakeFetch(400) }).chat([{ role: "user", content: "x" }])).rejects.toThrow("400");
    expect(calls).toEqual(["api.surplusintelligence.ai Bearer s-key"]);

    calls.length = 0;
    delete process.env.SURPLUS_API_KEY;
    expect(await defaultLLM({ fetch: fakeFetch(200) }).chat([{ role: "user", content: "x" }])).toBe("from openai");
    expect(calls).toEqual(["api.openai.com Bearer o-key"]);

    delete process.env.OPENAI_API_KEY;
    expect(() => defaultLLM()).toThrow("SURPLUS_API_KEY or OPENAI_API_KEY missing");
  } finally {
    console.warn = warn;
  }
});

test("provider names are validated case-insensitively; unknown names throw", () => {
  for (const k of ENV) delete process.env[k];
  expect(parseProvider("Surplus")).toBe("surplus");
  expect(parseProvider(" OPENAI ")).toBe("openai");
  expect(() => parseProvider("surplu")).toThrow("Unknown LLM provider");
  expect(() => parseProvider(undefined)).toThrow("Unknown LLM provider");
  process.env.SURPLUS_API_KEY = "s-key";
  process.env.CEREBRAS_API_KEY = "c-key";
  // "Surplus" used to route to the Cerebras endpoint.
  expect((llmFor("Surplus", "gpt-6-luna") as any).baseUrl).toContain("surplus");
  process.env.JUDGE_PROVIDER = "SURPLUS";
  expect((judgeLLM() as any).baseUrl).toContain("surplus");
  process.env.JUDGE_PROVIDER = "anthropic";
  expect(() => judgeLLM()).toThrow("Unknown LLM provider");
  expect(() => endpointsFor("nope")).toThrow("Unknown LLM provider");
});

test("every request gets a default timeout (60 s, LLM_TIMEOUT_MS, or the hook); 0 disables", async () => {
  for (const k of ENV) delete process.env[k];
  expect(timeoutFor({})).toBe(DEFAULT_TIMEOUT_MS);
  expect(DEFAULT_TIMEOUT_MS).toBe(60_000);
  process.env.LLM_TIMEOUT_MS = "1234";
  expect(timeoutFor({})).toBe(1234);
  expect(timeoutFor({ timeoutMs: 5 })).toBe(5);
  delete process.env.LLM_TIMEOUT_MS;
  const signals: (AbortSignal | null | undefined)[] = [];
  await new OpenAILLM("k", "m", "https://x.invalid/v1", { fetch: async (_u, init) => { signals.push(init.signal); return ok("x"); } }).chat([{ role: "user", content: "x" }]);
  expect(signals[0]).toBeInstanceOf(AbortSignal);
  await new OpenAILLM("k", "m", "https://x.invalid/v1", { timeoutMs: 0, fetch: async (_u, init) => { signals.push(init.signal); return ok("x"); } }).chat([{ role: "user", content: "x" }]);
  expect(signals[1]).toBeUndefined();
});

test("a hung request times out and retries are bounded", async () => {
  for (const k of ENV) delete process.env[k];
  let n = 0;
  const hang = async (_u: string, init: RequestInit) => {
    n++;
    return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("The operation timed out."))));
  };
  const t0 = Date.now();
  await expect(new OpenAILLM("k", "m", "https://x.invalid/v1", { fetch: hang, timeoutMs: 20, maxRetries: 2, retryBaseMs: 1 }).chat([{ role: "user", content: "x" }]))
    .rejects.toThrow("after 2 retries");
  expect(n).toBe(3);
  expect(Date.now() - t0).toBeLessThan(2_000);
});

test("backoff doubles, is capped at 30 s, is jittered, and honours a shorter Retry-After", () => {
  expect(backoffMs(0, 1000, undefined, () => 1)).toBe(1000);
  expect(backoffMs(3, 1000, undefined, () => 1)).toBe(8000);
  expect(backoffMs(10, 1000, undefined, () => 1)).toBe(30_000);
  expect(backoffMs(2, 1000, undefined, () => 0)).toBe(2000); // 50% jitter floor
  expect(backoffMs(0, 1000, 5000, () => 1)).toBe(5000);
  expect(backoffMs(0, 1000, 600_000, () => 1)).toBe(30_000);
});

test("cost: provider-reported cost wins; OpenAI responses are priced from OPENAI_PRICES", () => {
  expect(usageOf({ model: "gpt-6-luna", usage: { prompt_tokens: 1000, completion_tokens: 100, buyer_cost_micro: 7 } }).costMicro).toBe(7);
  // 1,000 prompt (200 cached, 100 cache writes) + 2,000 completion on gpt-6-luna:
  // 700 * 0.10 + 200 * 0.01 + 100 * 0.125 + 2000 * 0.50 = 1084.5 micro-USD
  const u = usageOf({ model: "gpt-6-luna", usage: { prompt_tokens: 1000, completion_tokens: 2000, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 } } });
  expect(u.costMicro).toBeCloseTo(1084.5, 6);
  expect(usageOf({ model: "unknown-model", usage: { prompt_tokens: 10, completion_tokens: 10 } }).costMicro).toBe(0);
});
