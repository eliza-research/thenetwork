import { describe, expect, test } from "bun:test";
import { DAY, EngineRng as Rng, type Preferences } from "@thenetwork/core";
import { resolveConfig } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { friendsPack } from "../../engine/src/packs/friends/index.ts";
import { activityPartner, sameTableAgain } from "../../engine/src/packs/friends/generators.ts";
import type { EngineInput } from "../../engine/src/types.ts";
import { World } from "../../engine/src/world.ts";

const defaultPrefs: Preferences = {
  categoriesOptIn: ["social", "hobby"],
  quietHours: [22, 8],
  formats: ["one_to_one", "small_group"],
  maxTravelMinutes: 45,
  onlyWhenAsked: false,
  romanceOptIn: false,
};

function makeCtx(w: World) {
  return {
    w,
    memberExclusions: {},
    rng: new Rng(12345),
    unmatchedIntents: new Set<string>(),
  };
}

describe("friends generators canMeet and participants consistency gates", () => {
  test("sameTableAgain respects canMeet on group participants", () => {
    const now = 100_000_000;
    const baseInput: EngineInput = {
      now,
      members: [
        { id: "a", name: "Alice", homeCity: "nyc", state: "normal", prefs: defaultPrefs, joinedAt: 0, age: 25, unansweredProactive: 0 },
        { id: "b", name: "Bob", homeCity: "nyc", state: "normal", prefs: defaultPrefs, joinedAt: 0, age: 26, unansweredProactive: 0 },
        { id: "c", name: "Charlie", homeCity: "nyc", state: "normal", prefs: defaultPrefs, joinedAt: 0, age: 27, unansweredProactive: 0 },
      ],
      facets: [
        { id: "f_v1", memberId: "a", kind: "trait", value: "verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 },
        { id: "f_v2", memberId: "b", kind: "trait", value: "verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 },
        { id: "f_v3", memberId: "c", kind: "trait", value: "verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 },
      ],
      intents: [],
      presence: [
        { memberId: "a", city: "nyc", type: "home", areas: ["Greenpoint"] },
        { memberId: "b", city: "nyc", type: "home", areas: ["Greenpoint"] },
        { memberId: "c", city: "nyc", type: "home", areas: ["Greenpoint"] },
      ],
      edges: [],
      recentProposals: [],
      interactions: [
        { id: "opp_1", kind: "group", category: "social", participants: ["a", "b", "c"], at: now - 5 * DAY, outcome: "completed" },
      ],
      feedback: [
        { id: "fb1", from: "a", about: "b", opportunityId: "opp_1", at: now - 4 * DAY, sentiment: "positive", wouldMeetAgain: true },
        { id: "fb2", from: "b", about: "a", opportunityId: "opp_1", at: now - 4 * DAY, sentiment: "positive", wouldMeetAgain: true },
        { id: "fb3", from: "a", about: "c", opportunityId: "opp_1", at: now - 4 * DAY, sentiment: "positive", wouldMeetAgain: true },
        { id: "fb4", from: "c", about: "a", opportunityId: "opp_1", at: now - 4 * DAY, sentiment: "positive", wouldMeetAgain: true },
      ],
    };

    // When all 3 are in NYC -> canMeet is satisfied
    const w1 = new World(baseInput, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    const candidates1 = sameTableAgain(makeCtx(w1));
    expect(candidates1.length).toBe(1);
    expect(candidates1[0]?.generator).toBe("same_table_again");
    expect(candidates1[0]?.participants.sort()).toEqual(["a", "b", "c"]);

    // If member c is only in SF and has no presence in NYC -> canMeet fails for the group
    const inputWithAbsentC: EngineInput = {
      ...baseInput,
      presence: [
        { memberId: "a", city: "nyc", type: "home", areas: ["Greenpoint"] },
        { memberId: "b", city: "nyc", type: "home", areas: ["Greenpoint"] },
        { memberId: "c", city: "sf", type: "temporary", from: now - DAY, to: now + 14 * DAY, areas: ["Mission"] },
      ],
    };
    const w2 = new World(inputWithAbsentC, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    const candidates2 = sameTableAgain(makeCtx(w2));
    // Candidate with all 3 cannot meet in NYC
    const hasGroupWithC = candidates2.some(c => c.participants.includes("c"));
    expect(hasGroupWithC).toBe(false);
  });

  test("sameTableAgain ensures participants, roles, evidence, and benefit are strictly consistent", () => {
    const now = 100_000_000;
    const members = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];
    const input: EngineInput = {
      now,
      members: members.map((id, i) => ({
        id,
        name: `Member ${i}`,
        homeCity: "nyc",
        state: "normal",
        prefs: defaultPrefs,
        joinedAt: 0,
        age: 25 + i,
        unansweredProactive: 0,
      })),
      facets: members.map((id, i) => ({
        id: `f_${i}`,
        memberId: id,
        kind: "trait",
        value: "verified",
        tags: ["verify:liveness:pass", "verify:age:pass"],
        scope: "agent_private",
        provenance: "said",
        confidence: 1,
      })),
      intents: [],
      presence: members.map(id => ({ memberId: id, city: "nyc", type: "home", areas: ["Greenpoint"] })),
      edges: [],
      recentProposals: [],
      interactions: [
        { id: "opp_big", kind: "group", category: "social", participants: members, at: now - 3 * DAY, outcome: "completed" },
      ],
      feedback: members.flatMap(a =>
        members.filter(b => b !== a).map((b, idx) => ({
          id: `fb_${a}_${b}_${idx}`,
          from: a,
          about: b,
          opportunityId: "opp_big",
          at: now - 2 * DAY,
          sentiment: "positive" as const,
          wouldMeetAgain: true,
        }))
      ),
    };

    const w = new World(input, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    const candidates = sameTableAgain(makeCtx(w));
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.participants.length).toBeLessThanOrEqual(6);
      expect(Object.keys(c.roles).sort()).toEqual([...c.participants].sort());
      expect(Object.keys(c.evidence).sort()).toEqual([...c.participants].sort());
      expect(Object.keys(c.benefit).sort()).toEqual([...c.participants].sort());
    }
  });

  test("activityPartner enforces canMeet between pair", () => {
    const now = 100_000_000;
    const baseInput: EngineInput = {
      now,
      members: [
        { id: "p1", name: "Player 1", homeCity: "nyc", state: "normal", prefs: defaultPrefs, joinedAt: 0, age: 25, unansweredProactive: 0 },
        { id: "p2", name: "Player 2", homeCity: "nyc", state: "normal", prefs: defaultPrefs, joinedAt: 0, age: 27, unansweredProactive: 0 },
      ],
      facets: [
        { id: "f1", memberId: "p1", kind: "trait", value: "verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 },
        { id: "f2", memberId: "p2", kind: "trait", value: "verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 },
        { id: "f_int1", memberId: "p1", kind: "interest", value: "running", tags: ["running"], scope: "shareable", provenance: "said", confidence: 1 },
        { id: "f_int2", memberId: "p2", kind: "interest", value: "running", tags: ["running"], scope: "shareable", provenance: "said", confidence: 1 },
      ],
      intents: [],
      presence: [
        { memberId: "p1", city: "nyc", type: "home", areas: ["Williamsburg"] },
        { memberId: "p2", city: "nyc", type: "home", areas: ["Greenpoint"] },
      ],
      edges: [],
      recentProposals: [],
      interactions: [
        // Both previously attended a group meetup so group_first passes
        { id: "opp_prev", kind: "group", category: "social", participants: ["p1", "p2", "other"], at: now - 10 * DAY, outcome: "completed" },
      ],
    };

    // When both are in NYC -> activityPartner candidate generated
    const w1 = new World(baseInput, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    const candidates1 = activityPartner(makeCtx(w1));
    expect(candidates1.length).toBe(1);
    expect(candidates1[0]?.generator).toBe("activity_partner");
    expect(candidates1[0]?.participants.sort()).toEqual(["p1", "p2"]);

    // If p2 is located in SF -> canMeet([p1, p2]) fails, candidate rejected
    const inputAbsent: EngineInput = {
      ...baseInput,
      presence: [
        { memberId: "p1", city: "nyc", type: "home", areas: ["Williamsburg"] },
        { memberId: "p2", city: "sf", type: "temporary", from: now - DAY, to: now + 14 * DAY, areas: ["Mission"] },
      ],
    };
    const w2 = new World(inputAbsent, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    const candidates2 = activityPartner(makeCtx(w2));
    expect(candidates2.length).toBe(0);
  });
});
