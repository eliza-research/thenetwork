// Regression tests for the 2026-10-08 adversarial audit (engine findings). Each test names its
// finding id and failed before the fix.
import { describe, expect, test } from "bun:test";
import { runEngine } from "../src/engine.ts";
import { randomWorld } from "../src/testkit.ts";
import { FakeLLM } from "./helpers.ts";

describe("engine-pipeline-1: exploration never selects judge-rejected configurations", () => {
  test("a judge that says no to everything: no selected proposal carries a rejection reason or the 'no' text", async () => {
    const llm = new FakeLLM(msgs => {
      const ctx = JSON.parse(msgs[1]!.content);
      const people = ctx.people ?? ctx.participants ?? [];
      const refs = people.filter((p: { attending?: boolean }) => p.attending !== false).map((p: { ref: string }) => p.ref);
      return JSON.stringify({ reasoning: "P1 and P2 have nothing in common.", cited_facts: [], verdict: "no", match_probability: 0.05,
        fit: 3, mutual_value: 3, capacity_realism: 3, timing: 3, social_comfort: 3, red_flags: 1, certainty: 5, dealbreaker: false, dealbreaker_reason: "",
        why: Object.fromEntries(refs.map((r: string) => [r, "JUDGE-SAID-NO text"])) });
    });
    let rejectedSelected = 0, noText = 0;
    for (const seed of [1, 2, 3]) {
      const r = await runEngine(randomWorld({ members: 200, seed }), { seed, judge: { topK: 40, groupTopK: 3 } }, { llm });
      const byKey = new Map(r.runLog.scored.map(s => [`${s.generator}|${s.participants.join()}|${s.score}`, s]));
      for (const p of r.proposals) {
        const s = byKey.get(`${p.generator}|${p.participants.join()}|${p.score}`);
        if (s && s.reason && s.reason !== "below_threshold") rejectedSelected++;
        if (Object.values(p.explanations).some(t => t.includes("JUDGE-SAID-NO"))) noText++;
      }
    }
    expect(rejectedSelected).toBe(0);
    expect(noText).toBe(0);
  }, 60_000);
});

describe("engine-pipeline-6: exploration keeps Quiet and romance bars", () => {
  test("no exploration pick puts a Quiet member under the Quiet bar or a romance pair under the romance bar", async () => {
    let bad = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const inp = randomWorld({ members: 200, seed });
      const state = new Map(inp.members.map(m => [m.id, m.state]));
      const r = await runEngine(inp, { seed });
      for (const p of r.proposals) {
        if (!p.exploration) continue;
        if (p.participants.some(id => state.get(id) === "quiet") && p.score < 0.42) bad++;
        if (p.category === "romance" && p.score < 0.35) bad++;
      }
    }
    expect(bad).toBe(0);
  }, 60_000);
});

