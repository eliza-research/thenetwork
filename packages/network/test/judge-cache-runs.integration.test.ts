// The engine judge's verdicts are kept across the daily runs of one Network (ME-008;
// spec/models/matching_engine.md, judgeCacheReused): an unchanged configuration is not judged again
// within the cache's time to live. The model provider is simulated at its boundary (it costs money);
// the Network, the engine and the judge parser are real.
import { expect, test } from "vitest";
import { DAY, type LLM } from "@thenetwork/core";
import type { MatchingRunLog } from "@thenetwork/engine";
import { Mini } from "./mini.ts";

/** A judge reply in the engine's schema: the explanation before the verdict, and a "no" (no member-facing text). */
const NO_VERDICT = JSON.stringify({
  reasoning: "Synthetic verdict for a cache test.", fit: 3, mutual_value: 3, capacity_realism: 3, timing: 3, social_comfort: 3,
  red_flags: 1, certainty: 3, dealbreaker: false, match_probability: 0.2, verdict: "no",
});

test("a Network's engine runs reuse the judge verdicts of its earlier runs", async () => {
  let calls = 0;
  const llm: LLM = { chat: async () => { calls++; return NO_VERDICT; } };
  const runs: MatchingRunLog["judge"][] = [];
  const ids = ["a", "b", "c", "d", "e", "f"];
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find a climbing partner", category: "hobby" as const }],
  })), { seed: 1, matchingEnabled: true, plans: false, engineLLM: llm, onEngineRun: log => { runs.push(log.judge); } });
  await w.onboard(...ids);
  const settled = runs.length;
  await w.run(3 * DAY);
  const later = runs.slice(settled).filter(j => j.calls + j.cacheHits > 0);
  expect(later.length).toBeGreaterThan(1);
  // After the first judged run, the same configurations come from the cache.
  expect(later.slice(1).every(j => j.cacheHits > 0)).toBe(true);
  expect(later.slice(1).reduce((n, j) => n + j.calls, 0)).toBe(0);
  expect(calls).toBeGreaterThan(0);
});
