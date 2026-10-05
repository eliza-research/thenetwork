import { test, expect } from "bun:test";
import { OpenAILLM, parseJson } from "./llm.ts";
test.skipIf(!process.env.OPENAI_API_KEY)("openai judge model returns JSON", async () => {
  const out = await new OpenAILLM().chat([{ role: "user", content: 'Return only this JSON: {"ok": true}' }], { json: true });
  expect(parseJson(out).ok).toBe(true);
}, 60_000);
