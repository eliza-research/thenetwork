// Regression tests for the 2026-10-08 adversarial audit (engine findings). Each test names its
// finding id and failed before the fix.
import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../src/config.ts";
import { runEngine } from "../src/engine.ts";
import { isHomeEntry, riskTerms } from "../src/filters.ts";
import { randomWorld } from "../src/testkit.ts";
import { DAY, HOUR } from "@thenetwork/core";
import { baseMember, emptyInput, facet, FakeLLM, NOW } from "./helpers.ts";

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

describe("engine-pipeline-4: curated risk and home-entry corpus", () => {
  const cfg = resolveConfig({});
  const risky = [
    "can someone watch my 6 year old saturday", "pick up my 8yo from school", "need a sitter for my toddler", "tutor my 12 year old in math",
    "baby-sitting needed", "my 15 yo son wants a coding mentor", "give my kids a ride", "watch my twelve-year-old after school",
    "can someone spot me $200 till friday", "venmo me 50 bucks", "looking for a sugar daddy", "lend me money",
    "selling edibles", "need someone to hold my meds", "chill and smoke 420", "help me get some molly",
    "need a ride to the clinic after my procedure",
  ];
  const benign = [
    "dog sitter needed for the weekend", "pet-sitter swap", "a 5 year old startup", "diet coke and pizza", "mushroom foraging walk",
    "joint venture ideas", "I teach yoga to adults", "I mentor junior engineers", "my son's soccer team parents", "parents of toddlers coffee",
    "high school reunion", "send me the link", "give me a call", "coding mentor for a career switch", "nurse who loves hiking",
    "running buddies, I'm 35 years old", "my 30 year old brother", "a 3 year old dog who loves the park", "pay 20 dollars for the class",
    "I have two kids and love board games", "parents with young kids", "I can lend a hand with a small furniture move",
  ];
  for (const t of risky) test(`risky: ${t}`, () => expect(riskTerms(cfg, t).length).toBeGreaterThan(0));
  for (const t of benign) test(`benign: ${t}`, () => expect(riskTerms(cfg, t)).toEqual([]));
  const home = [
    "need help assembling a bed at my condo", "help me hang shelves in my flat", "come over to my studio to fix my sink", "help at home!",
    "help at my home?", "help me paint my bedroom", "help carry a dresser up to my 4th floor walkup", "plumbing help at my house; urgent",
  ];
  for (const t of home) test(`home entry: ${t}`, () => expect(isHomeEntry(cfg, t)).toBe(true));
  test("not home entry: a park cleanup", () => expect(isHomeEntry(cfg, "help with a park cleanup on Saturday")).toBe(false));
});

describe("engine-pipeline-15: romance is pairs-only and needs stated preferences everywhere", () => {
  const world = (withPrefs: boolean) => {
    const inp = emptyInput(NOW);
    for (const id of ["a", "b", "c", "d", "e"]) {
      inp.members.push(baseMember(id, { prefs: { romanceOptIn: true, categoriesOptIn: ["romance", "social"] } as never }));
      inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
      inp.facets.push(facet(id, 0, "interest", "salsa dancing nights", ["salsa"]));
      if (withPrefs) inp.facets.push({ ...facet(id, 1, "preference", "x", ["romance:is:q", "romance:seeks:q"]), scope: "matchable" });
    }
    inp.events.push({ id: "ev1", title: "Salsa dancing singles night", description: "salsa dancing", tags: ["salsa"], category: "romance", city: "sf", start: NOW + 2 * DAY, end: NOW + 2 * DAY + 3 * HOUR });
    return inp;
  };
  test("a romance-category event never yields a romance configuration of more than two people", async () => {
    const r = await runEngine(world(true), { seed: 1, thresholds: { byGenerator: { event_anchor: 0.1 } } });
    expect(r.runLog.scored.filter(s => s.key.includes(":ev1:") && s.participants.length > 2).length).toBe(0);
    expect(r.runLog.funnel.rejectedBy.romance_group).toBe(1);
    expect(r.proposals.filter(p => p.category === "romance" && p.participants.length !== 2)).toEqual([]);
  });
  test("no romance proposal for members without stated preferences (any generator)", async () => {
    const r = await runEngine(world(false), { seed: 1, thresholds: { byGenerator: { event_anchor: 0.1 } } });
    expect(r.proposals.filter(p => p.category === "romance")).toEqual([]);
  });
});
