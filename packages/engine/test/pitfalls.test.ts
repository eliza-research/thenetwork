// Soulmates-pitfall regressions (PRD 30.4) and ME-005..ME-010 specifics.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { runEngine } from "../src/engine.ts";
import { JudgeCache } from "../src/judge.ts";
import { MatcherScheduler, MemoryProposalStore } from "../src/tick.ts";
import { randomWorld } from "../src/testkit.ts";
import { runBench } from "../src/bench.ts";
import type { EngineInput } from "../src/types.ts";
import { FakeLLM, facet, NOW, sailingPair, verdictJson } from "./helpers.ts";

const pairIn = (ps: { participants: string[] }[], a: string, b: string) => ps.some(p => p.participants.includes(a) && p.participants.includes(b));

describe("Soulmates pitfalls", () => {
  test("a completed match never blocks either member from further matching (ME-005)", async () => {
    const inp = sailingPair();
    inp.interactions = [{ id: "done", kind: "intro", category: "hobby", participants: ["a", "b"], at: NOW - 20 * DAY, outcome: "completed" }];
    inp.feedback = [
      { id: "f1", from: "a", about: "b", opportunityId: "done", at: NOW - 19 * DAY, sentiment: "positive", wouldMeetAgain: true, processed: true },
      { id: "f2", from: "b", about: "a", opportunityId: "done", at: NOW - 19 * DAY, sentiment: "positive", wouldMeetAgain: true, processed: true },
    ];
    const { proposals } = await runEngine(inp, { seed: 1 });
    expect(pairIn(proposals, "a", "b")).toBe(true);
    // and either member can still be matched with someone new
    const inp2 = structuredClone(inp) as EngineInput;
    inp2.members.push({ ...inp2.members[1]!, id: "c", name: "C" });
    inp2.presence.push({ memberId: "c", city: "sf", type: "home", areas: ["mission"] });
    inp2.facets.push(facet("c", 0, "offer", "teaches sailing to beginners", ["sailing"]));
    inp2.edges.push({ from: "a", to: "b", type: "blocked", strength: 1, explicit: true, createdAt: NOW });
    const r2 = await runEngine(inp2, { seed: 1 });
    expect(pairIn(r2.proposals, "a", "c")).toBe(true);
  });

  test("blocks, holds and feedback stored in another id space are still enforced (ME-006)", async () => {
    const inp = sailingPair();
    inp.idAliases = { "phone:+15550001": "a", "legacy-77": "b" };
    inp.edges.push({ from: "legacy-77", to: "phone:+15550001", type: "blocked", strength: 1, explicit: true, createdAt: NOW - DAY });
    expect((await runEngine(inp, { seed: 1 })).proposals.length).toBe(0);
    const held = sailingPair();
    held.idAliases = { "phone:+15550002": "b" };
    held.safetyHolds = [{ memberId: "phone:+15550002", from: NOW - HOUR }];
    expect((await runEngine(held, { seed: 1 })).proposals.length).toBe(0);
    const fb = sailingPair();
    fb.idAliases = { "wa:123": "a" };
    fb.feedback = [{ id: "n", from: "wa:123", about: "b", at: NOW - 5 * DAY, sentiment: "negative", processed: true }];
    expect((await runEngine(fb, { seed: 1 })).proposals.length).toBe(0);
  });

  test("negative-feedback cooldown keeps working after the feedback is processed (ME-006)", async () => {
    const inp = sailingPair();
    inp.feedback = [{ id: "n", from: "b", about: "a", at: NOW - 10 * DAY, sentiment: "negative", processed: false }];
    expect((await runEngine(inp, { seed: 1 })).proposals.length).toBe(0);
    inp.feedback[0]!.processed = true; // the feedback processor ran
    expect((await runEngine(inp, { seed: 1 })).proposals.length).toBe(0);
    inp.now += 91 * DAY; inp.intents[0]!.createdAt = inp.now - DAY; // cooldown ends on time, not on processing
    expect((await runEngine(inp, { seed: 1 })).proposals.length).toBe(1);
  });

  test("a cached zero from one noisy judge verdict expires (ME-008)", async () => {
    let n = 0;
    const llm = new FakeLLM(() => (n++ === 0 ? verdictJson({ fit: 1, mutual_value: 1, dealbreaker: true }) : verdictJson()));
    const cache = new JudgeCache(3 * DAY);
    const inp = sailingPair();
    expect((await runEngine(inp, { seed: 1 }, { llm, judgeCache: cache })).proposals.length).toBe(0);
    expect((await runEngine(inp, { seed: 1 }, { llm, judgeCache: cache })).proposals.length).toBe(0); // cached
    inp.now += 3 * DAY;
    inp.intents[0]!.createdAt = inp.now - DAY;
    expect((await runEngine(inp, { seed: 1 }, { llm, judgeCache: cache })).proposals.length).toBe(1);
  });

  test("configured minimum thresholds are actually applied (ME-009)", async () => {
    const w = randomWorld({ members: 80, seed: 5 });
    const base = await runEngine(w, { seed: 1 });
    const strict = await runEngine(w, { seed: 1, thresholds: { byState: { open: 0.45, normal: 0.45, quiet: 0.5, receiving: 0.45 } } });
    expect(strict.proposals.filter(p => !p.exploration).every(p => p.score >= 0.45)).toBe(true);
    expect(strict.proposals.length).toBeLessThan(base.proposals.length);
  });

  test("an LLM score never overrides safety, blocks or load", async () => {
    const llm = new FakeLLM(() => verdictJson()); // judge loves everything
    const inp = sailingPair();
    inp.safetyHolds = [{ memberId: "b", from: NOW - HOUR }];
    expect((await runEngine(inp, { seed: 1 }, { llm })).proposals.length).toBe(0);
    expect(llm.calls).toBe(0); // hard-filtered configurations are never even judged

    // Load: same configuration, b recently over-asked as a helper -> lower score even with a perfect judge.
    const fresh = await runEngine(sailingPair(), { seed: 1 }, { llm: new FakeLLM(() => verdictJson()) });
    const loaded = sailingPair();
    loaded.interactions = [{ id: "h", kind: "help", category: "help", participants: ["z", "b"], at: NOW - 2 * DAY, outcome: "completed", contributors: ["b"] }];
    const r = await runEngine(loaded, { seed: 1 }, { llm: new FakeLLM(() => verdictJson()) });
    expect(r.proposals[0]!.components.load).toBeGreaterThan(fresh.proposals[0]!.components.load);
    expect(r.proposals[0]!.score).toBeLessThan(fresh.proposals[0]!.score);
    // Over the contribution budget -> excluded no matter what the judge says.
    loaded.interactions.push({ id: "h2", kind: "help", category: "help", participants: ["y", "b"], at: NOW - DAY, outcome: "completed", contributors: ["b"] });
    expect((await runEngine(loaded, { seed: 1 }, { llm: new FakeLLM(() => verdictJson()) })).proposals.length).toBe(0);
  });

  test("stated dealbreakers are enforced as hard filters end to end", async () => {
    const inp = sailingPair();
    inp.facets.push(facet("a", 5, "boundary", "no smokers please", ["dealbreaker:smoking"], "matchable"), facet("b", 5, "trait", "smokes socially", ["smoking"], "matchable"));
    const r = await runEngine(inp, { seed: 1 });
    expect(r.proposals.length).toBe(0);
    expect(r.runLog.funnel.memberExclusions).toBeDefined();
  });

  test("no hidden wall clock: engine reads time only from the snapshot", async () => {
    const real = Date.now;
    Date.now = () => { throw new Error("Date.now called in engine"); };
    try {
      const r = await runEngine(randomWorld({ members: 40, seed: 3 }), { seed: 1 });
      expect(r.runLog.now).toBe(NOW);
    } finally { Date.now = real; }
  });

  test("profile updates never erase engine-learned state (ME-007): blocks, feedback and reliability survive a profile change", async () => {
    const inp = sailingPair();
    inp.reliability = { b: { noShows: 2, completedSinceLastNoShow: 0 } };
    inp.feedback = [{ id: "n", from: "a", about: "b", at: NOW - 2 * DAY, sentiment: "negative", processed: true }];
    const before = JSON.stringify({ e: inp.edges, f: inp.feedback, r: inp.reliability });
    await runEngine(inp, { seed: 1 });
    inp.facets = [facet("a", 0, "interest", "sailing and racing", ["sailing"]), facet("b", 0, "offer", "teaches sailing to beginners", ["sailing"])];
    const r = await runEngine(inp, { seed: 1 });
    expect(JSON.stringify({ e: inp.edges, f: inp.feedback, r: inp.reliability })).toBe(before);
    expect(r.proposals.length).toBe(0);
  });
});

describe("matcher ticks (ME-010)", () => {
  test("one tick per city at a time; idempotent per tick id", async () => {
    const store = new MemoryProposalStore();
    const s = new MatcherScheduler(store);
    const w = randomWorld({ members: 60, seed: 11 });
    const [t1, t2] = await Promise.all([s.tick("sf", w, { seed: 1 }), s.tick("sf", w, { seed: 1 })]);
    expect([t1.status, t2.status].sort()).toEqual(["ran", "skipped_locked"]);
    const t3 = await s.tick("sf", w, { seed: 1 });
    expect(t3.status).toBe("already_done");
    expect(t3.proposals).toEqual((t1.status === "ran" ? t1 : t2).proposals);
    for (const p of t3.proposals) expect(p.city).toBe("sf");
    const n = store.proposals.size;
    await s.tick("nyc", w, { seed: 1 });
    expect(store.proposals.size).toBeGreaterThanOrEqual(n);
  });

  test("a crashed tick leaves no partial proposals and releases the lock", async () => {
    const store = new MemoryProposalStore();
    const s = new MatcherScheduler(store);
    const w = randomWorld({ members: 60, seed: 11 });
    const boom = { chat: async () => { throw new Error("boom"); } };
    // Make the run crash mid-way via an embedding function that throws after some calls.
    let calls = 0;
    const embed = (t: string) => { if (++calls > 200) throw new Error("embedding service down"); return new Array(8).fill(t.length % 7); };
    await expect(s.tick("sf", w, { seed: 1 }, { embed, llm: boom })).rejects.toThrow("embedding service down");
    expect(store.proposals.size).toBe(0);
    expect(s.isLocked("sf")).toBe(false);
  });
});

describe("benchmark runs the production code path (ME-009)", () => {
  test("runBench uses runEngine and reports funnel + fairness", async () => {
    const r = await runBench({ members: 80, seed: 3 });
    const direct = await runEngine(randomWorld({ members: 80, seed: 3 }), { seed: 3 });
    expect(r.result.proposals).toEqual(direct.proposals);
    expect(r.report).toContain("Filter funnel");
  });
});
