import { test, expect } from "bun:test";
// LIVE: optional legacy provider. Runs only with LIVE_TESTS=1 and CEREBRAS_API_KEY.
import { CerebrasLLM, liveTestsEnabled, parseJson } from "./llm.ts";
const live = liveTestsEnabled() && !!process.env.CEREBRAS_API_KEY;
test.skipIf(!live)("cerebras returns JSON", async () => {
  const out = await new CerebrasLLM().chat(
    [{ role: "user", content: 'Return only this JSON: {"ok": true}' }], { maxTokens: 512, json: true });
  expect(parseJson(out).ok).toBe(true);
}, 60_000);
