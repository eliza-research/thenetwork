import { test, expect } from "bun:test";
// LIVE: runs only with LIVE_TESTS=1 and OPENAI_API_KEY.
import { liveTestsEnabled, OpenAILLM, parseJson } from "./llm.ts";
test.skipIf(!liveTestsEnabled() || !process.env.OPENAI_API_KEY)("openai judge model returns JSON", async () => {
  const out = await new OpenAILLM().chat([{ role: "user", content: 'Return only this JSON: {"ok": true}' }], { json: true });
  expect(parseJson(out).ok).toBe(true);
}, 60_000);
