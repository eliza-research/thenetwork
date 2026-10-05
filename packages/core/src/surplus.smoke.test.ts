import { test, expect } from "bun:test";
import { judgeLLM, parseJson } from "./llm.ts";
test.skipIf(!process.env.SURPLUS_API_KEY)("surplus judge model returns JSON", async () => {
  const out = await judgeLLM().chat([{ role: "user", content: 'Return only this JSON: {"ok": true}' }], { json: true });
  expect(parseJson(out).ok).toBe(true);
}, 60_000);
