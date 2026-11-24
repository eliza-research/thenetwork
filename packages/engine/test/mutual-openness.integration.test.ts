import { DAY, type Facet, type Intent, type Member } from "@thenetwork/core";
import { describe, expect, it } from "vitest";
import { cofounderIntentDetails, cofounderIntentObjective } from "../../core/src/generated/cofounderIntent.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { runEngine } from "../src/engine.ts";
import { pairReason } from "../src/filters.ts";
import { eligiblePair } from "../src/match/pair.ts";
import { FT, friendsPack, VERIFY_PASS } from "../src/packs/friends/index.ts";
import { PEON_ENGINE_CONFIG, peonPack } from "../src/packs/peon/index.ts";
import { emptyOnboarding, extractSlopProfile, slopPack, SLOP_ENGINE_DEFAULTS, slopOnboardTags } from "../src/packs/slop/index.ts";
import { nextOnboardingPrompt } from "../src/packs/slop/onboard.ts";
import { datingFactsOf } from "../src/packs/slop/profile.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import type { EngineInput } from "../src/types.ts";
import { World } from "../src/world.ts";

function dater(input: EngineInput, id: string, tags: string[]): void {
  input.members.push(baseMember(id, { homeCity: "nyc", prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } }));
  input.facets.push(facet(id, 0, "preference", "Private dating preferences", [...tags, "romance:age:18-65", "slop:zip:11222", "slop:max_miles:10"], "agent_private"));
}

const DATERS: Record<string, string[]> = {
  straightMan: ["romance:is:man", "romance:seeks:woman"],
  straightManOpen: ["romance:is:man", "romance:seeks:woman", "romance:open_trans:open"],
  straightManDeclined: ["romance:is:man", "romance:seeks:woman", "romance:open_trans:declined"],
  cisWoman: ["romance:is:woman", "romance:seeks:man", "romance:trans:no"],
  transWoman: ["romance:is:woman", "romance:seeks:man", "romance:trans:yes", "romance:open_trans:open"],
  transWomanT4T: ["romance:is:woman", "romance:seeks:man", "romance:seeks:woman", "romance:trans:yes", "romance:open_trans:only"],
  transManT4T: ["romance:is:man", "romance:seeks:woman", "romance:trans:yes", "romance:open_trans:only"],
  biWoman: ["romance:is:woman", "romance:seeks:man", "romance:seeks:woman", "romance:seeks:nonbinary"],
  nonbinaryShownToMen: ["romance:is:nonbinary", "romance:seeks:man", "romance:shown_to:man"],
  nonbinary: ["romance:is:nonbinary", "romance:seeks:man"],
  gayMan: ["romance:is:man", "romance:seeks:man"],
  noGender: ["romance:seeks:woman"],
};

describe("Date mutual openness", () => {
  const input = emptyInput();
  for (const [id, tags] of Object.entries(DATERS)) dater(input, id, tags);
  const w = new World(input, SLOP_ENGINE_DEFAULTS, localEmbed, slopPack);
  const open = (a: string, b: string) => pairReason(w, a, b, "romance", "Date") !== "orientation_mismatch";

  it.each([
    ["straightMan", "cisWoman", true],
    ["straightMan", "transWoman", false],
    ["straightManDeclined", "transWoman", false],
    ["straightManOpen", "transWoman", true],
    ["transManT4T", "cisWoman", false],
    ["transManT4T", "transWoman", true],
    ["transManT4T", "transWomanT4T", true],
    ["straightMan", "biWoman", true],
    ["straightMan", "nonbinary", false],
    ["straightMan", "nonbinaryShownToMen", false],
    ["noGender", "cisWoman", false],
    ["biWoman", "nonbinaryShownToMen", false],
    ["gayMan", "nonbinaryShownToMen", true],
    ["gayMan", "nonbinary", false],
  ] as const)("%s and %s: open %s, both ways", (a, b, expected) => {
    expect(open(a, b)).toBe(expected);
    expect(open(b, a)).toBe(expected);
  });

  it("reads an unknown gender, trans or openness tag as not stated", () => {
    expect(datingFactsOf(["romance:is:robot", "romance:seeks:robot", "romance:seeks:man", "romance:trans:maybe", "romance:open_trans:sometimes"]))
      .toEqual({ is: undefined, seeks: ["man"], trans: undefined, transOpenness: undefined, shownTo: [] });
  });

  it("the Date segment never refuses a pair the pair rules admit", () => {
    const ids = Object.keys(DATERS);
    let admitted = 0;
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const pa = w.match.profileIn(a, "Date"), pb = w.match.profileIn(b, "Date");
      if (!pa || !pb || pairReason(w, a, b, "romance", "Date") !== null) continue;
      admitted++;
      expect(eligiblePair(w, pa, pb)).not.toBe("segment_unreachable");
    }
    expect(admitted).toBeGreaterThan(4);
  });
});

describe("Date onboarding never infers who a member seeks", () => {
  it("asks a stated bi member plainly instead of defaulting, and reads a stated exclusion", () => {
    const bi = extractSlopProfile(["I'm a woman, bi", "idk tbh", "depends lol"], { ...emptyOnboarding(), askCounts: { slop_seeks: 2 } });
    expect(bi.seeks).toBeUndefined();
    expect(nextOnboardingPrompt({ ...bi, age: { value: 30, confidence: 1, evidence: bi.gender!.evidence, source: "rules" } })?.reason).toBe("slop_seeks_genders");
    const p = extractSlopProfile(["i'm a guy looking for women but not trans women"]);
    expect(p.seeks?.value).toEqual(["woman"]);
    const tags = slopOnboardTags(p).tags;
    expect(tags.find(t => t.tag === "romance:open_trans:not_open")?.scope).toBe("agent_private");
  });
});

describe("Friend openness", () => {
  function friend(input: EngineInput, id: string, tags: string[]): void {
    input.members.push(baseMember(id, { homeCity: "nyc", apps: ["friends"], prefs: { categoriesOptIn: ["social", "hobby"] } }));
    input.presence.push({ memberId: id, city: "nyc", type: "home", areas: ["williamsburg"] });
    input.facets.push(facet(id, 0, "fact", "Verified", [`${FT.liveness}${VERIFY_PASS}`, `${FT.age}${VERIFY_PASS}`], "agent_private"));
    if (tags.length) input.facets.push(facet(id, 1, "preference", "Friendship openness", tags, "agent_private"));
  }
  const input = emptyInput();
  friend(input, "womanOnlyWomen", [`${FT.gender}woman`, `${FT.openGender}women`]);
  friend(input, "woman", [`${FT.gender}woman`]);
  friend(input, "man", [`${FT.gender}man`]);
  friend(input, "unstated", []);
  const w = new World(input, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
  const reason = (a: string, b: string) => pairReason(w, a, b, "social", "Friend");

  it.each([
    ["womanOnlyWomen", "woman", true],
    ["womanOnlyWomen", "man", false],
    ["womanOnlyWomen", "unstated", false],
    ["man", "unstated", true],
  ] as const)("%s and %s: open %s, both ways", (a, b, expected) => {
    for (const [x, y] of [[a, b], [b, a]]) expect(reason(x, y) === "friend_openness").toBe(!expected);
  });

  it("the Friend segment never refuses a pair the pair rules admit", () => {
    for (const a of ["womanOnlyWomen", "woman", "man", "unstated"]) for (const b of ["womanOnlyWomen", "woman", "man", "unstated"]) {
      if (a === b || reason(a, b) !== null) continue;
      expect(eligiblePair(w, w.match.profileIn(a, "Friend")!, w.match.profileIn(b, "Friend")!)).not.toBe("segment_unreachable");
    }
  });
});

describe("Cofounders as equals", () => {
  const now = Date.UTC(2026, 10, 16, 16);
  const adult = (id: string): Member => ({
    id, name: id, age: 28, joinedAt: now - 7 * DAY, state: "normal", homeCity: "nyc", unansweredProactive: 0, apps: ["peon"],
    prefs: { categoriesOptIn: ["professional"], romanceOptIn: false, formats: ["one_to_one"], quietHours: [22, 8], maxTravelMinutes: 30, onlyWhenAsked: false },
  });
  const work = (id: string, tags: string[], kind: Facet["kind"] = "fact"): Facet => ({ id: `${id}:${tags[0]}`, memberId: id, app: "peon", kind, value: tags[0]!, tags, scope: "matchable", provenance: "said", confidence: 1, confirmedByMember: true });
  const goal = (memberId: string): Intent => ({ id: `${memberId}-goal`, memberId, app: "peon", objective: cofounderIntentObjective, details: cofounderIntentDetails, category: "professional", horizonDays: 60, status: "active", createdAt: now - DAY });
  const input = (ari: string[], ren: string[]): EngineInput => ({
    now, members: [adult("ari"), adult("ren")], intents: [goal("ari"), goal("ren")],
    facets: [work("ari", ["design"], "skill"), work("ren", ["fundraising"], "skill"), ...(ari.length ? [work("ari", ari)] : []), ...(ren.length ? [work("ren", ren)] : [])],
    presence: [], edges: [], recentProposals: [], events: [],
  });
  const proposals = async (ari: string[], ren: string[]) => (await runEngine(input(ari, ren), PEON_ENGINE_CONFIG, { pack: peonPack })).proposals;

  it("proposes complementary roles as peers", async () => {
    const p = await proposals(["cofounder:role:technical", "cofounder:must:role", "cofounder:commitment:full_time_now"], ["cofounder:role:business", "cofounder:commitment:full_time_now"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ lane: "Cofounder", roles: { ari: "peer", ren: "peer" } });
  });

  it.each([
    ["the same role against a role must-have", ["cofounder:role:technical", "cofounder:must:role"], ["cofounder:role:technical"]],
    ["an unstated role against a role must-have", ["cofounder:role:business", "cofounder:must:role"], []],
    ["a different commitment against a commitment must-have", ["cofounder:commitment:full_time_now", "cofounder:must:commitment"], ["cofounder:commitment:part_time"]],
  ] as const)("refuses %s", async (_what, ari, ren) => {
    expect(await proposals([...ari], [...ren])).toEqual([]);
  });
});
