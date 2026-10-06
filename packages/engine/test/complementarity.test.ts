// Structured complementarity (complementarity.ts, taxonomy.ts) and its use in scoring/retrieval.
import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { complementarity, intentSatisfaction, romanceMutual, satisfaction, sideBenefit } from "../src/complementarity.ts";
import { retrieveForIntent } from "../src/retrieval.ts";
import { computeComponents } from "../src/scoring.ts";
import { OBJECTIVES, detailTags, objectivesFor } from "../src/taxonomy.ts";
import { DESIRES } from "../../sim/src/taxonomy.ts";
import { NOW, baseMember, cand, emptyInput, facet, intent, mkWorld } from "./helpers.ts";
import type { EngineInput } from "../src/types.ts";

/** a wants a climbing partner; b belays beginners; c is into chess only; d also wants a climbing partner. */
function world(): EngineInput {
  const inp = emptyInput(NOW);
  inp.members.push(baseMember("a"), baseMember("b"), baseMember("c"), baseMember("d"));
  for (const id of ["a", "b", "c", "d"]) inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
  inp.facets.push(
    facet("a", 0, "interest", "bouldering and climbing", ["climbing", "outdoors"]),
    facet("a", 1, "interest", "specialty coffee", ["coffee", "food"]),
    facet("b", 0, "skill", "experienced climber who likes taking beginners", ["climbing_belay", "climbing"]),
    facet("b", 1, "interest", "bouldering and climbing", ["climbing", "outdoors"]),
    facet("c", 0, "interest", "chess", ["chess", "play"]),
    facet("d", 0, "interest", "bouldering and climbing", ["climbing", "outdoors"]),
  );
  inp.intents.push(
    intent("a", "find a regular climbing partner", "hobby"),
    intent("d", "find a regular climbing partner", "hobby"),
  );
  return inp;
}

describe("objective taxonomy", () => {
  test("every synthetic desire maps to exactly the engine objective with the same needs / pool / interests (drift guard)", () => {
    for (const d of DESIRES) {
      const got = objectivesFor(d.text, undefined, d.category);
      expect(got.map(o => o.id)).toEqual([d.id]);
      expect(got[0]!.needs).toEqual(d.needsSkills);
      expect(got[0]!.pool).toBe(d.category === "romance" ? "romance" : d.pool);
      expect(got[0]!.interests).toEqual(d.needsInterests);
    }
    expect(OBJECTIVES.length).toBe(DESIRES.length);
  });

  test("vague wants: friends maps to the friends pool; others stay unmapped; detail tags are a fallback", () => {
    expect(objectivesFor("meet some new people").map(o => o.id)).toEqual(["new_friends"]);
    expect(objectivesFor("find something fun to do on weekends")).toEqual([]);
    expect(objectivesFor("maybe meet someone", undefined, "romance").map(o => o.id)).toEqual(["dating"]);
    expect(detailTags("I'd love that. (format: small_group; tags: rock_music,guitar,band)")).toEqual(["rock_music", "guitar", "band"]);
    expect(objectivesFor("something musical", "(format: small_group; tags: rock_music,guitar,band)").map(o => o.id)).toEqual(["start_band"]);
  });
});

describe("complementarity scores", () => {
  test("needs -> offers: the belayer satisfies the climber fully; a shared pool counts; an unrelated member does not", () => {
    const w = mkWorld(world());
    expect(satisfaction(w, "a", "b")).toBe(1);
    expect(satisfaction(w, "a", "d")).toBe(0.85);
    expect(satisfaction(w, "a", "c")).toBe(0);
    expect(intentSatisfaction(w, w.get("a")!.intents[0]!, "b")).toBe(1);
  });

  test("reciprocal: symmetric in participant order, harmonic, and lopsided pairs score below mutual ones", () => {
    const w = mkWorld(world());
    const ab = complementarity(w, ["a", "b"])!, ba = complementarity(w, ["b", "a"])!;
    expect(ab.pair).toBeCloseTo(ba.pair, 12);
    expect(ab.benefit.a).toBeCloseTo(ba.benefit.a!, 12);
    // a gets a lot from b, b only shared climbing + the pleasure of helping: harmonic <= arithmetic.
    expect(ab.benefit.a!).toBeGreaterThan(ab.benefit.b!);
    expect(ab.pair).toBeLessThanOrEqual((ab.benefit.a! + ab.benefit.b!) / 2 + 1e-12);
    // Two climbers who both want a partner (shared pool, both directions) beat the chess pairing.
    expect(complementarity(w, ["a", "d"])!.pair).toBeGreaterThan(complementarity(w, ["a", "c"])!.pair);
    expect(complementarity(w, ["a", "c"])!.pair).toBe(0); // c gets nothing from a: harmonic -> 0
    expect(sideBenefit(w, "a", "b")).toBeLessThanOrEqual(1);
  });

  test("unknown is neutral: a member with no structured profile gets no complementarity term", () => {
    const inp = world();
    inp.members.push(baseMember("e"));
    inp.presence.push({ memberId: "e", city: "sf", type: "home", areas: ["mission"] });
    const w = mkWorld(inp);
    expect(complementarity(w, ["a", "e"])).toBeUndefined();
    expect(complementarity(w, ["a"])).toBeUndefined();
  });

  test("groups: per-member benefit is the mean over the others", () => {
    const w = mkWorld(world());
    const g = complementarity(w, ["a", "b", "d"])!;
    expect(g.benefit.a).toBeCloseTo((sideBenefit(w, "a", "b") + sideBenefit(w, "a", "d")) / 2, 12);
  });

  test("romance needs mutual stated preferences", () => {
    const inp = world();
    inp.members.push(baseMember("x", { prefs: { romanceOptIn: true } }), baseMember("y", { age: 31, prefs: { romanceOptIn: true } }));
    inp.facets.push(
      facet("x", 0, "preference", "Open to dating", ["romance:is:woman", "romance:seeks:man", "romance:age:25-40"], "agent_private"),
      facet("y", 0, "preference", "Open to dating", ["romance:is:man", "romance:seeks:woman", "romance:age:25-40"], "agent_private"),
      facet("c", 1, "preference", "Open to dating", ["romance:is:man", "romance:seeks:man", "romance:age:25-40"], "agent_private"),
    );
    const w = mkWorld(inp);
    expect(romanceMutual(w, "x", "y")).toBe(true);
    expect(romanceMutual(w, "x", "c")).toBe(false);
  });
});

describe("scoring and retrieval integration", () => {
  test("weight 0 leaves fit and mutual benefit exactly as before; weight > 0 separates complementary from unrelated pairs", () => {
    const off = mkWorld(world(), { complementarity: { weight: 0 } });
    const on = mkWorld(world());
    const good = cand(["a", "b"], { fit: 0.4, benefit: { a: 0.4, b: 0.4 } });
    const bad = cand(["a", "c"], { fit: 0.4, benefit: { a: 0.4, c: 0.4 } });
    expect(computeComponents(off, good).fit).toBe(0.4);
    expect(computeComponents(off, good).mutualBenefit).toBeCloseTo(0.4, 12);
    expect(computeComponents(off, bad).fit).toBe(computeComponents(off, good).fit);
    expect(computeComponents(on, good).fit).toBeGreaterThan(computeComponents(on, bad).fit + 0.2);
    expect(computeComponents(on, good).mutualBenefit).toBeGreaterThan(computeComponents(on, bad).mutualBenefit);
  });

  test("default weight is a blend (not off, not a replacement); the retrieval channel is opt-in", () => {
    expect(DEFAULT_CONFIG.complementarity.weight).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.complementarity.weight).toBeLessThan(1);
    const k = DEFAULT_CONFIG.complementarity;
    expect(k.need).toBeGreaterThan(k.overlap);
    expect(k.overlap).toBeGreaterThan(k.give);
    expect(k.retrievalChannel).toBe(false);
  });

  test("need channel: a provider below minSim is retrieved only when the channel is on", () => {
    const cfg = { retrieval: { minSim: 0.99 } };
    const run = (over: object) => {
      const w = mkWorld(world(), { ...cfg, ...over });
      const it = w.get("a")!.intents[0]!;
      return retrieveForIntent({ w, memberExclusions: {} }, it, ["b", "c"], "caps", 0.99).map(r => [r.id, [...r.channels].sort().join(",")]);
    };
    expect(run({ complementarity: { retrievalChannel: false } })).toEqual([]);
    const got = run({ complementarity: { retrievalChannel: true } });
    expect(got.map(x => x[0])).toEqual(["b"]);
    expect(got[0]![1]).toContain("need");
  });
});
