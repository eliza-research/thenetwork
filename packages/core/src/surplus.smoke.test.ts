import { test, expect } from "bun:test";
// LIVE: runs only with LIVE_TESTS=1 and SURPLUS_API_KEY.
import { judgeLLM, liveTestsEnabled, parseJson } from "./llm.ts";
test.skipIf(!liveTestsEnabled() || !process.env.SURPLUS_API_KEY)("surplus judge model returns JSON", async () => {
  const out = await judgeLLM().chat([{ role: "user", content: 'Return only this JSON: {"ok": true}' }], { json: true });
  expect(parseJson(out).ok).toBe(true);
}, 60_000);
