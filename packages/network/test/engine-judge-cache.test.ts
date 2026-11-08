// The engine judge cache across daily runs (docs/research/2026-11-07-state-machines.md, module
// matching_engine, SD-420): the real ConsentNetwork and engine in the small NYC world (mini.ts). The
// judge verdict for one pair stays valid for judge.ttlMs (7 days) while no profile changes (ME-008).
// dailyRun passed no judge caches, so the engine made a new cache for each run, and with
// NETWORK_ENGINE_JUDGE=1 every daily run asked the model again about the same pairs. The engine LLM
// here is a local counter that gives a fixed "no" verdict: no model is called.
import { describe, expect, test } from "bun:test";
import { DAY, type LLM } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const VERDICT = JSON.stringify({
  reasoning: "Fixed local verdict for the cache test.", verdict: "no", match_probability: 0.2,
  fit: 3, mutual_value: 3, capacity_realism: 3, timing: 3, social_comfort: 3, red_flags: 3, certainty: 3, dealbreaker: false,
});

describe("engine judge cache", () => {
  test("a second daily run inside the TTL reuses the judge verdicts of the first", async () => {
    let calls = 0;
    const llm: LLM = { chat: async () => { calls++; return VERDICT; } };
    const runs: { calls: number; cacheHits: number }[] = [];
    const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking", "coffee"], wants: [{ objective: "find a bouldering partner for weekend climbing sessions", category: "hobby" as const }] });
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Park")], {
      matchingEnabled: true, engineLLM: llm,
      onEngineRun: log => { runs.push({ calls: log.judge.calls, cacheHits: log.judge.cacheHits }); },
    });
    await w.onboard("a", "b", "c");
    await w.run(2 * DAY);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const [first, second] = runs;
    expect(first!.calls).toBeGreaterThan(0);
    expect(calls).toBeGreaterThan(0);
    // The members did not change, so the second run finds every verdict in the cache.
    expect(second).toEqual({ calls: 0, cacheHits: first!.calls });
  });
});
