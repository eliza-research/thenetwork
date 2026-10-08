// Offline unit tests for the core client hooks (no network, no keys, no global fetch patching).
import { afterEach, expect, test } from "bun:test";
import { SimClock } from "./clock.ts";
import {
  backoffMs, LLMBudget, normalizeModelId, CerebrasLLM, DEFAULT_TIMEOUT_MS, defaultLLM, endpointsFor, judgeLLM, llmFor, LLMError, OpenAILLM, parseJson, parseProvider, recommenderLLM,
  timeoutFor, usageOf, type FallbackInfo, type ResponseInfo,
} from "./llm.ts";

const ok = (content: string, usage: object = { prompt_tokens: 4, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 1 }, buyer_cost_micro: 9 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage }), { status: 200 });

const ENV = [
  "DEFAULT_LLM_PROVIDER", "DEFAULT_LLM_MODEL", "JUDGE_PROVIDER", "JUDGE_MODEL", "RECOMMENDER_PROVIDER", "RECOMMENDER_MODEL", "SURPLUS_API_KEY", "OPENAI_API_KEY",
  "CEREBRAS_API_KEY", "LLM_TIMEOUT_MS", "LLM_MAX_RETRIES",
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

test("surplus provider: Surplus then OpenAI on 429, OpenAI alone without a Surplus key, error without either", async () => {
  for (const k of ENV) delete process.env[k];
  process.env.SURPLUS_API_KEY = "s-key";
  process.env.OPENAI_API_KEY = "o-key";
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
    expect(warnings.some(w => w.includes("falling back to api.openai.com"))).toBe(true);

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
  await new OpenAILLM("k", "m", "https://x.invalid/v1", { timeoutMs: 0, deadlineMs: 0, fetch: async (_u, init) => { signals.push(init.signal); return ok("x"); } }).chat([{ role: "user", content: "x" }]);
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
  // deadlineMs: 0 isolates the retry bound (the default deadline, 3x the timeout, would end this call first under load).
  await expect(new OpenAILLM("k", "m", "https://x.invalid/v1", { fetch: hang, timeoutMs: 20, deadlineMs: 0, maxRetries: 2, retryBaseMs: 1 }).chat([{ role: "user", content: "x" }]))
    .rejects.toThrow("after 2 retries");
  expect(n).toBe(3);
  expect(Date.now() - t0).toBeLessThan(2_000);
});

test("backoff doubles, is capped at 30 s, is jittered, and honours Retry-After up to 5 min", () => {
  expect(backoffMs(0, 1000, undefined, () => 1)).toBe(1000);
  expect(backoffMs(3, 1000, undefined, () => 1)).toBe(8000);
  expect(backoffMs(10, 1000, undefined, () => 1)).toBe(30_000);
  expect(backoffMs(2, 1000, undefined, () => 0)).toBe(2000); // 50% jitter floor
  expect(backoffMs(0, 1000, 5000, () => 1)).toBe(5000);
  // A Retry-After longer than the 30 s backoff cap is honoured (core-18), up to 5 min.
  expect(backoffMs(0, 1000, 60_000, () => 1)).toBe(60_000);
  expect(backoffMs(0, 1000, 600_000, () => 1)).toBe(300_000);
});

test("cost: provider-reported cost wins; OpenAI responses are priced from OPENAI_PRICES", () => {
  expect(usageOf({ model: "gpt-6-luna", usage: { prompt_tokens: 1000, completion_tokens: 100, buyer_cost_micro: 7 } }).costMicro).toBe(7);
  // 1,000 prompt (200 cached, 100 cache writes) + 2,000 completion on gpt-6-luna:
  // 700 * 0.10 + 200 * 0.01 + 100 * 0.125 + 2000 * 0.50 = 1084.5 micro-USD
  const u = usageOf({ model: "gpt-6-luna", usage: { prompt_tokens: 1000, completion_tokens: 2000, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 } } });
  expect(u.costMicro).toBeCloseTo(1084.5, 6);
  expect(usageOf({ model: "unknown-model", usage: { prompt_tokens: 10, completion_tokens: 10 } }).costMicro).toBe(0);
});

test("parseJson returns the first balanced value that parses and prefers a ```json block (core-9)", () => {
  const cases: [string, unknown][] = [
    ['{"verdict":"ok"}\nNote: I used {placeholders}.', { verdict: "ok" }],
    ['Here is [my answer]: {"verdict":"ok"}', { verdict: "ok" }],
    ['<think>maybe {"verdict":"bad"}</think>{"verdict":"ok"}', { verdict: "ok" }],
    ['{"a":1} {"b":2}', { a: 1 }],
    ['Sure! [1,2] then {"verdict":"ok"}', { verdict: "ok" }],
    ['{"verdict":"ok","why":"she said \\"} {\\""}', { verdict: "ok", why: 'she said "} {"' }],
    ['Draft: {"verdict":"bad"}\n```json\n{"verdict":"ok"}\n```', { verdict: "ok" }],
    ['```json\n[{"id":1}]\n```', [{ id: 1 }]],
    ["[1, 2, 3]", [1, 2, 3]],
  ];
  for (const [text, want] of cases) expect<unknown>(parseJson(text)).toEqual(want);
  // Many unmatched brackets stay fast.
  const t0 = performance.now();
  expect(() => parseJson("{".repeat(50_000))).toThrow("no JSON");
  expect(performance.now() - t0).toBeLessThan(2_000);
});

test("parseJson errors carry the reply length, never the reply text (core-12)", () => {
  const reply = "Sam is going through a divorce, so no.";
  let err: unknown;
  try { parseJson(reply); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(LLMError);
  expect((err as LLMError).code).toBe("no_json");
  expect(String(err)).toContain(String(reply.length));
  expect(String(err)).not.toContain("divorce");
});

const X = [{ role: "user" as const, content: "x" }];
const reply = (content: string, finish = "stop", usage: object = {}, model?: string) =>
  new Response(JSON.stringify({ ...(model ? { model } : {}), choices: [{ message: { content }, finish_reason: finish }], usage }), { status: 200 });
const errOf = async (p: Promise<unknown>): Promise<any> => { try { await p; } catch (e) { return e; } throw new Error("expected a rejection"); };

test("dated and prefixed model ids are priced; unknown ids are flagged (core-10)", () => {
  expect(normalizeModelId("gpt-6-luna-2026-09-01")).toBe("gpt-6-luna");
  expect(normalizeModelId("openai/GPT-6-luna-20260901")).toBe("gpt-6-luna");
  const usage = { prompt_tokens: 1000, completion_tokens: 1000 };
  const want = usageOf({ model: "gpt-6-luna", usage }).costMicro;
  expect(want).toBeCloseTo(600, 6);
  expect(usageOf({ model: "gpt-6-luna-2026-09-01", usage }).costMicro).toBeCloseTo(want, 6);
  // No model in the body: priced from the requested model.
  expect(usageOf({ usage }, "gpt-6-luna").costMicro).toBeCloseTo(want, 6);
  expect(usageOf({ model: "mystery-1", usage }).costKnown).toBe(false);
  expect(usageOf({ model: "mystery-1", usage: { ...usage, buyer_cost_micro: 3 } }).costKnown).toBe(true);
});

test("a shared budget stops every client before its next HTTP attempt (core-10)", async () => {
  let http = 0;
  const budget = new LLMBudget({ maxCostMicro: 1000 });
  const mk = () => new OpenAILLM("k", "gpt-6-luna", "https://x.invalid/v1", {
    budget, fetch: async () => { http++; return reply("ok", "stop", { prompt_tokens: 1000, completion_tokens: 1000 }, "gpt-6-luna-2026-09-01"); },
  });
  const a = mk(), b = mk();
  expect(await a.chat(X)).toBe("ok"); // 600 micro
  expect(await b.chat(X)).toBe("ok"); // 1200 micro: now spent
  const err = await errOf(a.chat(X));
  expect(err).toBeInstanceOf(LLMError);
  expect(err.code).toBe("budget");
  await expect(b.chat(X)).rejects.toThrow("budget");
  expect(http).toBe(2);
  expect(budget.spentMicro).toBeCloseTo(1200, 6);
  // maxRequests counts retries too.
  let n = 0;
  const capped = new OpenAILLM("k", "m", "https://x.invalid/v1", { budget: new LLMBudget({ maxRequests: 3 }), retryBaseMs: 1, fetch: async () => { n++; return new Response("busy", { status: 503 }); } });
  expect((await errOf(capped.chat(X))).code).toBe("budget");
  expect(n).toBe(3);
});

test("budget regrows are visible and do not share a counter with 429 retries (core-10, core-18)", async () => {
  const infos: ResponseInfo[] = [], sent: number[] = [];
  let n = 0;
  const llm = new OpenAILLM("k", "m", "https://x.invalid/v1", {
    retryBaseMs: 1, onResponse: i => infos.push(i),
    fetch: async (_u, init) => {
      n++;
      sent.push(JSON.parse(String(init.body)).max_completion_tokens);
      if (n <= 2) return new Response("busy", { status: 429 });
      return n < 5 ? reply("", "length") : reply("done");
    },
  });
  expect(await llm.chat(X, { maxTokens: 100 })).toBe("done");
  expect(sent).toEqual([100, 100, 100, 200, 400]);
  expect(infos.map(i => i.regrows)).toEqual([0, 0, 0, 1, 2]);
});

test("a reply still truncated after the budget doublings is rejected, not returned (core-18)", async () => {
  let n = 0;
  const llm = new OpenAILLM("k", "m", "https://x.invalid/v1", { fetch: async () => { n++; return reply('{"partial": "SECRET-OUTPUT', "length"); } });
  const err = await errOf(llm.chat(X, { maxTokens: 100 }));
  expect(err.code).toBe("truncated");
  expect(String(err)).not.toContain("SECRET-OUTPUT");
  expect(n).toBe(3);
});

test("408 is retried; a non-JSON 200 is observed and retried (core-18)", async () => {
  let n = 0;
  const statuses: [number, boolean][] = [];
  const llm = new OpenAILLM("k", "m", "https://x.invalid/v1", {
    retryBaseMs: 1, onResponse: i => statuses.push([i.status, i.ok]),
    fetch: async () => { n++; return n === 1 ? new Response("timeout", { status: 408 }) : n === 2 ? new Response("<html>gateway</html>", { status: 200 }) : reply("ok"); },
  });
  expect(await llm.chat(X)).toBe("ok");
  expect(statuses).toEqual([[408, false], [200, false], [200, true]]);
  const html = new OpenAILLM("k", "m", "https://x.invalid/v1", { retryBaseMs: 1, maxRetries: 1, fetch: async () => new Response("<html>gateway</html>", { status: 200 }) });
  expect((await errOf(html.chat(X))).code).toBe("bad_response");
});

test("Retry-After dates are read against the injected clock (core-22)", async () => {
  // A Retry-After date years ahead of real time but equal to the injected clock's time.
  const clock = new SimClock(Date.UTC(2030, 0, 1));
  const waits: number[] = [];
  let n = 0;
  const t0 = Date.now();
  const llm = new OpenAILLM("k", "m", "https://x.invalid/v1", {
    clock, deadlineMs: 0, retryBaseMs: 1,
    fetch: async () => { n++; waits.push(Date.now() - t0); return n === 1 ? new Response("busy", { status: 429, headers: { "retry-after": new Date(Date.UTC(2030, 0, 1)).toUTCString() } }) : reply("ok"); },
  });
  expect(await llm.chat(X)).toBe("ok");
  // Read against real time this would wait the 5 min Retry-After cap.
  expect(waits[1]! - waits[0]!).toBeLessThan(1_000);
});

test("seed is sent when set and absent otherwise (core-22)", async () => {
  const bodies: any[] = [];
  const f = async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return reply("ok"); };
  await new OpenAILLM("k", "m", "https://x.invalid/v1", { seed: 7, fetch: f }).chat(X);
  await new OpenAILLM("k", "m", "https://x.invalid/v1", { fetch: f }).chat(X);
  expect(bodies[0].seed).toBe(7);
  expect("seed" in bodies[1]).toBe(false);
});

test("deadlineMs bounds the whole call; a caller signal stops further fetches (core-11)", async () => {
  const hang = async (_u: string, init: RequestInit) =>
    new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  let t0 = Date.now();
  const err = await errOf(new OpenAILLM("k", "m", "https://x.invalid/v1", { fetch: hang, retryBaseMs: 1 }).chat(X, { deadlineMs: 100 }));
  expect(err.code).toBe("deadline");
  expect(Date.now() - t0).toBeLessThan(150 + 100); // slack for a loaded CI box

  // Abort during backoff: no further fetch happens.
  let n = 0;
  const ctrl = new AbortController();
  const llm = new OpenAILLM("k", "m", "https://x.invalid/v1", { retryBaseMs: 10_000, fetch: async () => { n++; setTimeout(() => ctrl.abort(), 20); return new Response("busy", { status: 503 }); } });
  t0 = Date.now();
  expect((await errOf(llm.chat(X, { signal: ctrl.signal }))).code).toBe("aborted");
  expect(n).toBe(1);
  expect(Date.now() - t0).toBeLessThan(1_000);
  // Abort during a request.
  const c2 = new AbortController();
  setTimeout(() => c2.abort(), 20);
  expect((await errOf(new OpenAILLM("k", "m", "https://x.invalid/v1", { fetch: hang }).chat(X, { signal: c2.signal }))).code).toBe("aborted");
  // The default deadline is 3x the timeout.
  for (const k of ENV) delete process.env[k];
  const { deadlineFor } = await import("./llm.ts");
  expect(deadlineFor({})).toBe(180_000);
  expect(deadlineFor({ timeoutMs: 0 })).toBe(0);
});

test("errors and logs carry codes and lengths, not provider bodies or prompts (core-12)", async () => {
  const CANARY = "CANARY-prompt-echo-9f3";
  const warn = console.warn, warnings: string[] = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
  try {
    const errs = [
      await errOf(new OpenAILLM("k", "m", "https://x.invalid/v1", { fetch: async () => new Response(`bad request: ${CANARY}`, { status: 400 }) }).chat([{ role: "user", content: CANARY }])),
      await errOf(new OpenAILLM("k", "m", "https://x.invalid/v1", { maxRetries: 0, fetch: async () => new Response(`overloaded ${CANARY}`, { status: 503 }) }, [{ baseUrl: "https://y.invalid/v1", apiKey: "k2" }]).chat(X)),
      await errOf(new OpenAILLM("k", "m", "https://x.invalid/v1", { maxRetries: 0, fetch: async () => { throw new Error(`socket said ${CANARY}`); } }).chat(X)),
    ];
    for (const e of errs) { expect(e).toBeInstanceOf(LLMError); expect(String(e)).not.toContain(CANARY); }
    expect(errs[0].detail.status).toBe(400);
    // The provider body is kept off the message, for callers that choose to inspect it.
    expect(errs[0].body).toContain(CANARY);
    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) expect(w).not.toContain(CANARY);
  } finally {
    console.warn = warn;
  }
});

test("every fallback is logged and reported; fallback: false stays on the first provider (core-12)", async () => {
  const warn = console.warn, warnings: string[] = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
  try {
    const hosts: string[] = [], reports: FallbackInfo[] = [];
    const f = async (url: string) => { hosts.push(new URL(url).host); return url.includes("first") ? new Response("busy", { status: 503 }) : reply("second"); };
    const llm = new OpenAILLM("k", "m", "https://first.invalid/v1", { fetch: f, onFallback: i => reports.push(i), maxRetries: 0 }, [{ baseUrl: "https://second.invalid/v1", apiKey: "k2" }]);
    expect(await llm.chat(X)).toBe("second");
    expect(await llm.chat(X)).toBe("second");
    expect(reports.map(r => [r.from, r.to, r.reason])).toEqual([["first.invalid", "second.invalid", "http 503 (body 4 chars)"], ["first.invalid", "second.invalid", "http 503 (body 4 chars)"]]);
    expect(warnings.filter(w => w.includes("falling back to second.invalid")).length).toBe(2);
    hosts.length = 0;
    expect((await errOf(llm.chat(X, { fallback: false }))).detail.status).toBe(503);
    expect(hosts).toEqual(["first.invalid"]);
  } finally {
    console.warn = warn;
  }
});
