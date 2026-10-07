// engine-v1.2 levers (docs/results/2026-10-07-engine-v1.2.md). Each test fails with the lever off.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { runEngine } from "../src/engine.ts";
import { intentToCapability, type GenCtx } from "../src/generators.ts";
import { Rng } from "../src/rng.ts";
import { thresholdFor } from "../src/scoring.ts";
import type { EngineInput } from "../src/types.ts";
import { baseMember, cand, emptyInput, facet, intent, mkWorld, NOW, sailingPair } from "./helpers.ts";

const ctx = (inp: EngineInput, cfg = {}): GenCtx => ({ w: mkWorld(inp, cfg), memberExclusions: {}, rng: new Rng(1), unmatchedIntents: new Set() });

describe("engine-v1.2", () => {
  test("a personal-growth want ('learn sailing', category growth) reaches the intent generators as hobby", () => {
    const inp = sailingPair();
    inp.intents = [intent("a", "learn sailing this season", "growth")];
    inp.members = inp.members.map(m => ({ ...m, prefs: { ...m.prefs, categoriesOptIn: m.id === "a" ? ["social", "growth"] : m.prefs.categoriesOptIn } }));
    expect(intentToCapability(ctx(inp, { personalGrowthAsHobby: false }))).toEqual([]);
    const out = intentToCapability(ctx(inp, { personalGrowthAsHobby: true }));
    expect(out.map(c => [c.participants, c.category])).toEqual([[["a", "b"], "hobby"]]);
    // "grow the Network" stays network growth.
    inp.intents = [intent("a", "invite friends to join the network", "growth")];
    expect(intentToCapability(ctx(inp, { personalGrowthAsHobby: true }))).toEqual([]);
  });

  test("category override lowers the bar for Normal members but never for Quiet ones", () => {
    const inp = sailingPair();
    inp.members = inp.members.map(m => ({ ...m, state: "normal" as const }));
    const on = { thresholds: { useCategoryOverride: true } };
    expect(thresholdFor(mkWorld(inp), cand(["a", "b"], { category: "hobby" }))).toBe(0.3);
    expect(thresholdFor(mkWorld(inp, on), cand(["a", "b"], { category: "hobby" }))).toBe(0.26);
    expect(thresholdFor(mkWorld(inp, on), cand(["a", "b"], { category: "professional" }))).toBe(0.38);
    // Per-generator bar (on by default): event pairs and theme groups need 0.40.
    expect(thresholdFor(mkWorld(inp), cand(["a", "b"], { generator: "event_anchor" }))).toBe(0.4);
    expect(thresholdFor(mkWorld(inp, { thresholds: { useByGenerator: false } }), cand(["a", "b"], { generator: "event_anchor" }))).toBe(0.3);
    inp.members[1] = { ...inp.members[1]!, state: "quiet" };
    expect(thresholdFor(mkWorld(inp, on), cand(["a", "b"], { category: "hobby" }))).toBe(0.42);
  });

  test("dispatch-aware: a member in an open opportunity is not proposed; an unsent proposal costs no budget", async () => {
    const open = sailingPair();
    open.openOpportunities = [{ id: "o1", participants: ["b", "x"], stage: "inviting", until: NOW + DAY }];
    expect((await runEngine(open, { dispatch: { skipOpenOpportunities: false } })).proposals.length).toBe(1);
    expect((await runEngine(open, { dispatch: { skipOpenOpportunities: true } })).proposals.length).toBe(0);

    const billed = sailingPair();
    billed.members = billed.members.map(m => ({ ...m, state: "normal" as const }));
    const stale = (id: string) => ({ id, kind: "intro" as const, participants: ["b", `z${id}`], alternates: [], objective: "Intro", city: "sf" as const, score: 0.5, components: {} as any, exploration: false, explanations: {}, generator: "x", createdAt: NOW - DAY });
    billed.recentProposals = [stale("p1"), stale("p2")]; // b is at the Normal budget (2/week)
    billed.unsentProposalIds = ["p1", "p2"];
    const v11 = { budgets: { normal: { limit: 2, periodDays: 7 } } };
    expect((await runEngine(billed, { ...v11, dispatch: { billOnlySent: false } })).proposals.length).toBe(0);
    expect((await runEngine(billed, { ...v11, dispatch: { billOnlySent: true } })).proposals.length).toBe(1);
  });

  test("romance needs stated preferences on both sides; the member without them is asked", async () => {
    const inp = emptyInput(NOW);
    for (const id of ["a", "b"]) {
      inp.members.push(baseMember(id, { state: "normal", prefs: { romanceOptIn: true, categoriesOptIn: ["social", "romance"] } }));
      inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
    }
    inp.facets.push(facet("a", 0, "interest", "live jazz and cooking", ["music"]), facet("b", 0, "interest", "live jazz and cooking dinners", ["music"]),
      facet("a", 1, "interest", "natural wine", ["wine"]), facet("b", 1, "interest", "natural wine bars", ["wine"]), facet("a", 2, "interest", "film", ["film"]), facet("b", 2, "interest", "film", ["film"]));
    inp.intents.push(intent("a", "open to dating someone who loves live jazz", "romance"), intent("b", "open to dating someone who loves cooking and jazz", "romance"));
    // b said who they are but not who they hope to meet.
    inp.facets.push(facet("a", 9, "preference", "dating: men", ["romance:is:woman", "romance:seeks:man"], "agent_private"), facet("b", 9, "preference", "a man", ["romance:is:man"], "agent_private"));
    const off = await runEngine(inp, { romance: { requireStatedPrefs: false } });
    expect(off.proposals.filter(p => p.category === "romance").length).toBe(1);
    const on = await runEngine(inp);
    expect(on.proposals.filter(p => p.category === "romance")).toEqual([]);
    expect(on.asks.map(a => [a.memberId, a.reason])).toEqual([["b", "romance_prefs"]]);
  });

  test("acceptance estimate: yes history raises it, declines and silence lower it", () => {
    const inp = sailingPair();
    inp.interactions = [
      { id: "i1", kind: "intro", category: "hobby", participants: ["a", "c"], at: NOW - 5 * DAY, outcome: "completed", acceptedBy: ["a", "c"] },
      { id: "i2", kind: "intro", category: "hobby", participants: ["b", "d"], at: NOW - 5 * DAY, outcome: "declined", declinedBy: ["b"] },
      { id: "i3", kind: "intro", category: "hobby", participants: ["b", "e"], at: NOW - 4 * DAY, outcome: "expired", noResponse: ["b"] },
    ];
    const w = mkWorld(inp);
    expect(w.get("a")!.acceptance).toBeGreaterThan(0.45);
    expect(w.get("b")!.acceptance).toBeLessThan(0.45);
  });

  test("ask before proposing: a low-data member gets a question, not a proposal, until they answer", async () => {
    const inp = emptyInput(NOW);
    inp.members.push(baseMember("a"), baseMember("b"));
    for (const id of ["a", "b"]) inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
    inp.facets.push(facet("a", 0, "interest", "sailing on the bay", ["sailing"]), facet("b", 0, "offer", "teaches sailing to beginners", ["sailing"]), facet("b", 1, "interest", "sailing", ["sailing"]), facet("b", 2, "skill", "sailing instructor", ["sailing_instructor"]));
    inp.intents.push(intent("a", "learn sailing this season", "hobby"));
    const off = await runEngine(inp, { ask: { enabled: false } });
    expect(off.proposals.length).toBe(1);
    expect(off.asks).toEqual([]);
    const on = await runEngine(inp, { ask: { enabled: true } });
    expect(on.proposals).toEqual([]); // "a" has one matchable facet: ask first
    // "a" has a thin profile, "b" no want of their own: both are asked and held back.
    expect(on.asks.map(a => [a.memberId, a.reason])).toEqual([["a", "few_facets"], ["b", "no_structured_want"]]);
    const answered = await runEngine({ ...inp, recentAsks: [{ memberId: "a", at: NOW - DAY, reason: "few_facets", answeredAt: NOW - 3_600_000 }, { memberId: "b", at: NOW - DAY, reason: "no_structured_want", answeredAt: NOW - 3_600_000 }] }, { ask: { enabled: true } });
    expect(answered.proposals.length).toBe(1);
    expect(answered.asks).toEqual([]);
  });
});
