import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { runEngine } from "../src/engine.ts";
import { buildJudgeMessages, JudgeCache, judgeCacheKey, parseVerdict } from "../src/judge.ts";
import { harmonic, mutualBenefit, scoreCandidate } from "../src/scoring.ts";
import { candidateReason } from "../src/filters.ts";
import { cand, FakeLLM, facet, mkWorld, sailingPair, verdictJson } from "./helpers.ts";

describe("scoring (Section 33.6)", () => {
  test("pair mutual benefit is the harmonic mean (punishes lopsided matches)", () => {
    expect(harmonic([0.9, 0.9])).toBeCloseTo(0.9);
    expect(mutualBenefit([0.9, 0.1])).toBeLessThan((0.9 + 0.1) / 2);
    expect(mutualBenefit([0.9, 0])).toBe(0);
  });
  test("group mutual benefit uses average-without-misery", () => {
    expect(mutualBenefit([0.9, 0.9, 0.9])).toBeCloseTo(0.9);
    expect(mutualBenefit([0.9, 0.9, 0.1])).toBeCloseTo(0.2);
  });
  test("components are all in [0,1] and logged; confidence multiplies", () => {
    const w = mkWorld(sailingPair());
    const c = cand(["a", "b"], { evidence: { b: ["b-f0"] } });
    expect(candidateReason(w, c)).toBeNull();
    const s = scoreCandidate(w, c);
    for (const v of Object.values(s.components)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(s.eligible).toBe(true);
  });
  test("floors make a configuration ineligible no matter how good the rest is", () => {
    const w = mkWorld(sailingPair());
    const c = cand(["a", "b"], { fit: 0.01, warm: 1 });
    candidateReason(w, c);
    const s = scoreCandidate(w, c);
    expect(s.eligible).toBe(false);
    expect(s.reason).toBe("fit_floor");
    const c2 = cand(["a", "b"], { benefit: { a: 0.9, b: 0 } });
    candidateReason(w, c2);
    expect(scoreCandidate(w, c2).reason).toBe("mutual_benefit_floor");
  });
  test("threshold = strictest participant state (quiet needs higher confidence)", () => {
    const inp = sailingPair();
    inp.members[1]!.state = "quiet";
    const w = mkWorld(inp);
    const c = cand(["a", "b"]);
    candidateReason(w, c);
    expect(scoreCandidate(w, c).threshold).toBe(w.cfg.thresholds.byState.quiet);
  });
  test("configured thresholds are applied (ME-009)", async () => {
    expect((await runEngine(sailingPair(), { seed: 1 })).proposals.length).toBe(1);
    const hi = await runEngine(sailingPair(), { seed: 1, thresholds: { byState: { open: 0.99 } } });
    expect(hi.proposals.length).toBe(0);
    expect(hi.runLog.funnel.belowThreshold).toBeGreaterThan(0);
    const cat = await runEngine(sailingPair(), { seed: 1, thresholds: { byCategory: { hobby: 0.99 } } });
    expect(cat.proposals.length).toBe(0);
    const floor = await runEngine(sailingPair(), { seed: 1, floors: { fit: 0.99 } });
    expect(floor.proposals.length).toBe(0);
    expect(floor.runLog.funnel.floorViolations.fit_floor).toBeGreaterThan(0);
  });
});

describe("LLM judge", () => {
  test("schema validation", () => {
    const refs = { P1: "a", P2: "b" };
    const v = parseVerdict(JSON.parse(verdictJson()), refs);
    expect(v.fit).toBe(1); expect(v.redFlags).toBe(0); expect(v.why.a).toContain("water");
    expect(() => parseVerdict({ ...JSON.parse(verdictJson()), fit: 9 }, refs)).toThrow(/fit/);
    expect(() => parseVerdict({ ...JSON.parse(verdictJson()), dealbreaker: "no" }, refs)).toThrow(/dealbreaker/);
    expect(() => parseVerdict({ ...JSON.parse(verdictJson()), why: { P1: "x" } }, refs)).toThrow(/why.P2/);
  });

  test("judge prompt is scrubbed: pseudonymous refs, no names, no agent_private facets", () => {
    const inp = sailingPair();
    inp.facets.push(facet("a", 9, "fact", "zq canary private health disclosure", ["private"], "agent_private"));
    const w = mkWorld(inp);
    const { messages } = buildJudgeMessages(w, cand(["a", "b"]));
    const all = messages.map(m => m.content).join("\n");
    expect(all).not.toContain("canary");
    expect(all).not.toContain('"A"');
    expect(all).toContain("P1");
  });

  test("judge is one input: positive verdict marks proposal judged; dealbreaker removes it", async () => {
    const ok = new FakeLLM(() => verdictJson());
    const r1 = await runEngine(sailingPair(), { seed: 1 }, { llm: ok });
    expect(r1.proposals[0]!.judged).toBe(true);
    expect(r1.proposals[0]!.explanations.a).toContain("water");
    const no = new FakeLLM(() => verdictJson({ dealbreaker: true, dealbreaker_reason: "boundary" }));
    const r2 = await runEngine(sailingPair(), { seed: 1 }, { llm: no });
    expect(r2.proposals.length).toBe(0);
    expect(r2.runLog.funnel.dealbreakers).toBe(1);
  });

  test("judge minimum floors: one very low dimension makes it ineligible", async () => {
    const low = new FakeLLM(() => verdictJson({ social_comfort: 1 }));
    expect((await runEngine(sailingPair(), { seed: 1 }, { llm: low })).proposals.length).toBe(0);
  });

  test("malformed judge output: counted as failure, never cached, engine falls back to heuristic score", async () => {
    const bad = new FakeLLM(() => "I think they are great!");
    const cache = new JudgeCache(7 * DAY);
    const r = await runEngine(sailingPair(), { seed: 1 }, { llm: bad, judgeCache: cache });
    expect(r.runLog.judge.failures).toBe(1);
    expect(cache.size).toBe(0);
    expect(r.proposals.length).toBe(1);
    expect(r.proposals[0]!.judged).toBe(false);
  });

  test("judge 'why' that leaks a non-shareable fact is rejected for the template", async () => {
    const inp = sailingPair();
    inp.facets.push(facet("b", 7, "fact", "recovering from divorce", ["private"], "matchable"));
    const leaky = new FakeLLM(() => verdictJson({ why: { P1: "B is recovering from a divorce and wants company.", P2: "Sailing!" } }));
    const r = await runEngine(inp, { seed: 1 }, { llm: leaky });
    expect(r.proposals[0]!.explanations.a).not.toContain("divorce");
    expect(r.proposals[0]!.explanations.a).toContain("teaches sailing");
  });

  test("cache: hit on rerun, miss after profile revision, miss after TTL (ME-008)", async () => {
    const llm = new FakeLLM(() => verdictJson());
    const cache = new JudgeCache(2 * DAY);
    const inp = sailingPair();
    await runEngine(inp, { seed: 1 }, { llm, judgeCache: cache });
    expect(llm.calls).toBe(1);
    const r2 = await runEngine(inp, { seed: 1 }, { llm, judgeCache: cache });
    expect(llm.calls).toBe(1);
    expect(r2.runLog.judge.cacheHits).toBe(1);
    // profile revision
    const changed = sailingPair();
    changed.facets.push(facet("b", 3, "interest", "racing dinghies", ["sailing"]));
    await runEngine(changed, { seed: 1 }, { llm, judgeCache: cache });
    expect(llm.calls).toBe(2);
    // time expiry
    const later = sailingPair();
    later.now += 3 * DAY;
    later.intents[0]!.createdAt = later.now - DAY;
    await runEngine(later, { seed: 1 }, { llm, judgeCache: cache });
    expect(llm.calls).toBe(3);
  });

  test("cache keys include every participant's revision", () => {
    const a = mkWorld(sailingPair());
    const inp = sailingPair(); inp.members[0]!.prefs.formats = ["event"];
    const b = mkWorld(inp);
    expect(judgeCacheKey(a, cand(["a", "b"]))).not.toBe(judgeCacheKey(b, cand(["a", "b"])));
  });
});
