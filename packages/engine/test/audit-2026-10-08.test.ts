// Regression tests for the 2026-10-08 adversarial audit (engine findings). Each test names its
// finding id and failed before the fix.
import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config.ts";
import { runEngine } from "../src/engine.ts";
import { MatcherScheduler, MemoryProposalStore } from "../src/tick.ts";
import { eligibilityFor, isHomeEntry, riskTerms } from "../src/filters.ts";
import { randomWorld } from "../src/testkit.ts";
import { DAY, HOUR } from "@thenetwork/core";
import { baseMember, emptyInput, facet, FakeLLM, mkWorld, NOW } from "./helpers.ts";

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

describe("engine-pipeline-5 / -22: per-city ticks share budgets and ids; the tick id covers the config", () => {
  test("sf then nyc tick: no crash on a duplicate id, no member over budget across both ticks", async () => {
    let over = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const inp = randomWorld({ members: 200, seed });
      const sch = new MatcherScheduler(new MemoryProposalStore());
      const a = await sch.tick("sf", inp, { seed });
      const b = await sch.tick("nyc", inp, { seed });
      const cnt = new Map<string, number>();
      for (const p of [...a.proposals, ...b.proposals]) for (const id of p.participants) cnt.set(id, (cnt.get(id) ?? 0) + 1);
      for (const m of inp.members) {
        const recent = (inp.recentProposals ?? []).filter(p => p.participants.includes(m.id) && inp.now - p.createdAt < DEFAULT_CONFIG.budgets[m.state].periodDays * DAY).length;
        if ((cnt.get(m.id) ?? 0) > 0 && recent + cnt.get(m.id)! > DEFAULT_CONFIG.budgets[m.state].limit) over++;
      }
    }
    expect(over).toBe(0);
  }, 60_000);
  test("a re-run with a different config is a new tick", async () => {
    const inp = randomWorld({ members: 60, seed: 3 });
    const sch = new MatcherScheduler(new MemoryProposalStore());
    const a = await sch.tick("sf", inp, { seed: 1 });
    const b = await sch.tick("sf", inp, { seed: 1, exploration: { rate: 0 } });
    expect(a.status).toBe("ran");
    expect(b.status).toBe("ran");
  });
});

describe("engine-pipeline-10: send-time re-check covers withdrawn lane consent and the match age", () => {
  test("romance opt-out after the proposal, a dropped lane and an age under config.ageMin fail at send time", () => {
    const inp = emptyInput(NOW);
    inp.members.push(
      baseMember("a", { prefs: { romanceOptIn: true, categoriesOptIn: ["romance", "social"] } as never }),
      baseMember("withdrew", { prefs: { romanceOptIn: false, categoriesOptIn: ["romance", "social"] } as never }),
      baseMember("nolane", { prefs: { romanceOptIn: true, categoriesOptIn: ["social"] } as never }),
      baseMember("young", { age: 20 }),
    );
    const w = mkWorld(inp, { ageMin: 21 });
    const romance = eligibilityFor(w, undefined, "romance");
    expect(romance("a", ["withdrew"])).toBeNull();
    expect(romance("withdrew", ["a"])).toBe("romance_opt_out");
    expect(romance("nolane", ["a"])).toBe("category_opt_out");
    expect(eligibilityFor(w)("young", [])).toBe("underage");
  });
});

describe("engine-pipeline-7 / -8: pass 2 can only remove; judge coverage is reported", () => {
  test("an all-yes judge never turns a below-threshold configuration eligible", async () => {
    const llm = new FakeLLM(msgs => {
      const ctx = JSON.parse(msgs[1]!.content);
      const refs = (ctx.people ?? ctx.participants ?? []).filter((p: { attending?: boolean }) => p.attending !== false).map((p: { ref: string }) => p.ref);
      return JSON.stringify({ reasoning: "P1 and P2 fit.", cited_facts: [], verdict: "yes", match_probability: 0.95,
        fit: 5, mutual_value: 5, capacity_realism: 5, timing: 5, social_comfort: 5, red_flags: 1, certainty: 5, dealbreaker: false, dealbreaker_reason: "",
        why: Object.fromEntries(refs.map((r: string) => [r, "You two would get along."])) });
    });
    let promoted = 0, coverageSeen = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const inp = randomWorld({ members: 40, seed });
      const base = await runEngine(inp, { seed });
      const baseReason = new Map(base.runLog.scored.map(s => [s.key, s.reason]));
      const r = await runEngine(inp, { seed }, { llm });
      for (const s of r.runLog.scored) if (s.eligible && s.judged && baseReason.get(s.key) === "below_threshold") promoted++;
      const cov = r.runLog.judge.coverage;
      if (cov) { coverageSeen++; expect(cov.selected).toBe(r.proposals.length); expect(cov.judged).toBe(r.proposals.filter(p => p.judged).length); }
    }
    expect(promoted).toBe(0);
    expect(coverageSeen).toBeGreaterThan(0);
  }, 60_000);
});
