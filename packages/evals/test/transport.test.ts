// Offline: the instrumented transport injects identical settings via the core client's hooks,
// caches by request, records cost/latency, never writes the API key, and never patches global fetch.
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, stable, withScope } from "../src/transport.ts";

const reply = (usage: Record<string, unknown> = { prompt_tokens: 10, completion_tokens: 5, buyer_cost_micro: 42 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage }), { status: 200 });

test("transport: settings injection, cache, usage, no key on disk, no global fetch patch", async () => {
  const seen: any[] = [];
  const globalBefore = globalThis.fetch;
  const net = async (_url: string, init: RequestInit) => { seen.push(JSON.parse(String(init.body))); return reply(); };
  const dir = mkdtempSync(join(tmpdir(), "evals-cache-"));
  const scope = (attempt: number, extra: object = {}) => ({ attempt, cacheDir: dir, settings: { reasoning_effort: "low" as const }, fetch: net, apiKey: "sk-test-SECRET-KEY", baseUrl: "https://example.invalid/v1", ...extra });
  const call = () => withScope("test-model", scope(0), llm => llm.chat([{ role: "user", content: "hi" }], { json: true }));

  const a = await call();
  expect(globalThis.fetch).toBe(globalBefore);
  expect(a.value).toBe('{"ok":true}');
  expect(seen.length).toBe(1);
  expect(seen[0].reasoning_effort).toBe("low");
  expect(seen[0].model).toBe("test-model");
  expect(a.records[0]!.costMicro).toBe(42);
  expect(a.records[0]!.promptTokens).toBe(10);
  expect(a.records[0]!.cached).toBe(false);

  const b = await call();
  expect(seen.length).toBe(1); // served from cache
  expect(b.records[0]!.cached).toBe(true);
  expect(b.records[0]!.costMicro).toBe(42);

  const files = readdirSync(join(dir, "test-model"));
  expect(files.length).toBe(1);
  // Key format is unchanged from the old fetch-patch transport, so existing caches stay valid.
  expect(files[0]).toBe(`${cacheKey(seen[0], 0)}.json`);
  expect(readFileSync(join(dir, "test-model", files[0]!), "utf8")).not.toContain("SECRET-KEY");

  // A different eval attempt is a different cache key (retries are real re-asks).
  await withScope("test-model", scope(1), llm => llm.chat([{ role: "user", content: "hi" }], { json: true }));
  expect(seen.length).toBe(2);

  // Offline mode never hits the network and fails fast (no backoff retries).
  const t0 = performance.now();
  const off = await withScope("test-model", scope(7, { offline: true }), llm => llm.chat([{ role: "user", content: "hi" }]));
  expect(off.error).toContain("offline");
  expect(off.records[0]!.status).toBe(412);
  expect(performance.now() - t0).toBeLessThan(500);
  expect(seen.length).toBe(2);
});

test("transport: network errors and 5xx are recorded and retried by the core client", async () => {
  let n = 0;
  const dir = mkdtempSync(join(tmpdir(), "evals-cache-"));
  const net = async () => {
    n++;
    if (n === 1) throw new TypeError("socket hang up");
    if (n === 2) return new Response("busy", { status: 503 });
    return reply({ prompt_tokens: 3, completion_tokens: 2, cost: 0.000007 });
  };
  const r = await withScope("m", { attempt: 0, cacheDir: dir, settings: {}, fetch: net, apiKey: "k" }, llm => llm.chat([{ role: "user", content: "x" }]));
  expect(r.value).toBe('{"ok":true}');
  expect(r.records.map(x => x.status)).toEqual([0, 503, 200]);
  expect(r.records[0]!.error).toContain("socket hang up");
  expect(r.records[2]!.costMicro).toBeCloseTo(7);
}, 20_000);

test("stable() is key-order independent", () => {
  expect(stable({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(stable({ a: [{ x: 1, y: 2 }], b: 1 }));
});
