// LIVE: runs the judge with the default LLM (defaultLLM(): Surplus gpt-6-luna unless DEFAULT_LLM_* say
// otherwise) on 3 configurations and validates the JSON schema. Skipped unless LIVE_TESTS=1 and that provider's
// API key is set (Bun loads .env from the repo root).
import { describe, expect, test } from "bun:test";
import { defaultLLM, endpointsFor, liveTestsEnabled, type Provider } from "@thenetwork/core";
import { candidateReason } from "../src/filters.ts";
import { buildJudgeMessages, judgeOne } from "../src/judge.ts";
import { baseMember, cand, emptyInput, facet, mkWorld, NOW } from "./helpers.ts";

// Opt-in only: LIVE_TESTS=1 as well as a key (Bun loads the root .env, so a key alone is not consent).
const live = liveTestsEnabled() && endpointsFor((process.env.DEFAULT_LLM_PROVIDER || "surplus") as Provider).length > 0;

describe.skipIf(!live)("LIVE judge (default LLM)", () => {
  test("judges 3 configurations with a valid schema and leak-free inputs", async () => {
    const inp = emptyInput(NOW);
    for (const id of ["a", "b", "c", "d"]) {
      inp.members.push(baseMember(id));
      inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
    }
    inp.facets.push(
      facet("a", 0, "interest", "sailing on the bay", ["sailing"]),
      facet("a", 1, "fact", "zq canary private health disclosure", ["private"], "agent_private"),
      facet("b", 0, "offer", "teaches sailing to beginners", ["sailing"]),
      facet("c", 0, "skill", "plays drums in a rock band", ["music"]),
      facet("d", 0, "skill", "plays guitar in a rock band", ["music"]),
      facet("c", 1, "interest", "independent film", ["film"]),
      facet("d", 1, "interest", "independent film and cinema", ["film"]),
    );
    inp.intents.push({ id: "ia", memberId: "a", objective: "learn sailing this season", category: "hobby", horizonDays: 60, status: "active", createdAt: NOW - 86_400_000 });
    const w = mkWorld(inp);
    const configs = [
      cand(["a", "b"], { kind: "intro", category: "hobby", objective: "Intro: sailing", roles: { a: "seeker", b: "provider" }, anchor: { type: "intent", id: "ia" }, evidence: { b: ["b-f0"] } }),
      cand(["c", "d"], { kind: "intro", category: "hobby", objective: "Intro: music", evidence: { c: ["c-f0"], d: ["d-f0"] } }),
      cand(["b", "c", "d"], { kind: "group", category: "social", format: "small_group", objective: "Small group around film" }),
    ];
    for (const c of configs) expect(candidateReason(w, c)).toBeNull();
    const llm = defaultLLM();
    const verdicts = await Promise.all(configs.map(c => judgeOne(w, c, llm, 2500)));
    for (const [i, v] of verdicts.entries()) {
      const c = configs[i]!;
      for (const k of ["fit", "mutualValue", "capacityRealism", "timing", "socialComfort", "redFlags", "certainty"] as const) {
        expect(v[k]).toBeGreaterThanOrEqual(0);
        expect(v[k]).toBeLessThanOrEqual(1);
      }
      expect(typeof v.dealbreaker).toBe("boolean");
      for (const id of c.participants) expect(v.why[id]!.length).toBeGreaterThan(5);
      expect(JSON.stringify(buildJudgeMessages(w, c).messages)).not.toContain("canary");
      expect(JSON.stringify(v)).not.toContain("canary");
    }
    // The sailing learner + teacher should look like a real fit.
    expect(verdicts[0]!.fit).toBeGreaterThanOrEqual(0.5);
    expect(verdicts[0]!.dealbreaker).toBe(false);
  }, 180_000);
});
