// Offline: the instrumented transport injects identical settings, caches by request, records
// cost/latency, and never writes the API key to disk.
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAILLM } from "../../core/src/llm.ts";

test("transport: settings injection, cache, usage, no key on disk", async () => {
  const seen: any[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, buyer_cost_micro: 42 } }), { status: 200 });
  }) as any;
  try {
    const { withScope } = await import("../src/transport.ts");
    const dir = mkdtempSync(join(tmpdir(), "evals-cache-"));
    const llm = new OpenAILLM("sk-test-SECRET-KEY", "test-model", "https://example.invalid/v1");
    const call = () => withScope({ attempt: 0, cacheDir: dir, settings: { reasoning_effort: "low" } }, () => llm.chat([{ role: "user", content: "hi" }], { json: true }));
    const a = await call();
    expect(a.value).toBe('{"ok":true}');
    expect(seen.length).toBe(1);
    expect(seen[0].reasoning_effort).toBe("low");
    expect(a.records[0]!.costMicro).toBe(42);
    expect(a.records[0]!.cached).toBe(false);
    const b = await call();
    expect(seen.length).toBe(1); // served from cache
    expect(b.records[0]!.cached).toBe(true);
    expect(b.records[0]!.costMicro).toBe(42);
    const files = readdirSync(join(dir, "test-model"));
    expect(files.length).toBe(1);
    expect(readFileSync(join(dir, "test-model", files[0]!), "utf8")).not.toContain("SECRET-KEY");
    // A different attempt number is a different cache key (retries are real re-asks).
    await withScope({ attempt: 1, cacheDir: dir, settings: { reasoning_effort: "low" } }, () => llm.chat([{ role: "user", content: "hi" }], { json: true }));
    expect(seen.length).toBe(2);
    // Offline mode never hits the network.
    const off = await withScope({ attempt: 7, cacheDir: dir, settings: {}, offline: true }, () => llm.chat([{ role: "user", content: "hi" }]));
    expect(off.error).toContain("offline");
    expect(seen.length).toBe(2);
  } finally {
    globalThis.fetch = orig;
  }
});
