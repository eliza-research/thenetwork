// Offline unit tests for the core client hooks (no network, no keys, no global fetch patching).
import { afterEach, expect, test } from "bun:test";
import { CerebrasLLM, defaultLLM, judgeLLM, OpenAILLM, recommenderLLM, type ResponseInfo } from "./llm.ts";

const ok = (content: string, usage: object = { prompt_tokens: 4, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 1 }, buyer_cost_micro: 9 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage }), { status: 200 });

const ENV = ["DEFAULT_LLM_PROVIDER", "DEFAULT_LLM_MODEL", "JUDGE_PROVIDER", "JUDGE_MODEL", "RECOMMENDER_PROVIDER", "RECOMMENDER_MODEL", "SURPLUS_API_KEY"] as const;
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
