// Alternates in group configurations must be pairwise compatible with each other and with the primary group.
// Mutually blocked alternates or alternates under safety hold must never be proposed together or pass hard gates.
import { describe, expect, test } from "bun:test";
import { DAY, type Member } from "@thenetwork/core";
import { composeGroup } from "@thenetwork/engine/src/group.ts";
import { hardGate } from "@thenetwork/engine/src/judgeDeep.ts";
import { World } from "@thenetwork/engine/src/world.ts";
import { networkPack } from "@thenetwork/engine/src/packs/network/index.ts";
import { DEFAULT_CONFIG } from "@thenetwork/engine/src/config.ts";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";

const now = 1_700_000_000_000;

function makeMember(id: string): Member {
  return {
    id,
    name: id,
    age: 26,
    homeCity: "nyc",
    state: "normal",
    joinedAt: now,
    unansweredProactive: 0,
    prefs: { categoriesOptIn: ["social", "help"], romanceOptIn: false, radiusKm: 20, pacing: "normal" } as any,
  };
}

function buildTestWorld(blockedPairs: [string, string][] = [], safetyHolds: string[] = []): World {
  const members = [
    makeMember("p1"), makeMember("p2"), makeMember("p3"),
    makeMember("alt1"), makeMember("alt2"), makeMember("alt3")
  ];

  const presence = members.map(m => ({
    memberId: m.id, city: "nyc" as const, start: now, end: now + 7 * DAY,
    type: "home" as const, areas: ["williamsburg"],
  }));

  const edges = blockedPairs.map(([from, to]) => ({
    from, to, type: "blocked" as const, at: now,
    strength: 1, explicit: true, createdAt: now,
  }));

  const input: EngineInput = {
    now,
    members,
    facets: members.map(m => ({
      id: `f_${m.id}`, memberId: m.id, kind: "interest" as const, value: "climbing", tags: ["climbing"],
      shareable: true, scope: "shareable" as const, provenance: "said" as const, confidence: 1,
    })),
    intents: [],
    presence,
    edges,
    recentProposals: [],
    events: [],
    safetyHolds: safetyHolds.map(id => ({ memberId: id, from: now - DAY, reason: "harassment" })),
    feedback: [],
    interactions: [],
    reliability: {},
    categoryQuotas: {},
  };

  const cfg = {
    ...DEFAULT_CONFIG,
    cities: ["nyc"] as any,
    windowDays: 7,
    group: {
      ...DEFAULT_CONFIG.group,
      minSize: 3,
      maxSize: 3,
      poolSize: 10,
      alternates: 2,
      beamWidth: 4,
      minPairwise: -1,
    },
  };

  const fakeEmbed = () => new Array(32).fill(0);
  return new World(input, cfg as any, fakeEmbed, networkPack);
}

describe("group alternates pairwise safety", () => {
  test("composeGroup does not select mutually blocked alternates into the same group alternates", () => {
    const w = buildTestWorld([["alt1", "alt2"]]);

    const pool = [
      { id: "p1", affinity: 0.95 },
      { id: "p2", affinity: 0.95 },
      { id: "p3", affinity: 0.95 },
      { id: "alt1", affinity: 0.85 },
      { id: "alt2", affinity: 0.80 },
      { id: "alt3", affinity: 0.70 },
    ];

    const res = composeGroup(w, {
      pool,
      category: "social",
      minSize: 3,
      maxSize: 3,
      window: { start: now, end: now + 7 * DAY },
      preferredCity: "nyc",
      requireCity: true,
      needHost: false,
      beamWidth: 4,
      minPairwise: -1,
      alternates: 2,
    });

    expect(res).not.toBeNull();
    expect(res!.primary).toEqual(["p1", "p2", "p3"]);
    // alt1 and alt2 are mutually blocked, so only the higher-affinity alt1 plus alt3 should be in alternates
    expect(res!.alternates.includes("alt1")).toBe(true);
    expect(res!.alternates.includes("alt2")).toBe(false);
    expect(res!.alternates.includes("alt3")).toBe(true);
  });

  test("hardGate flags a candidate when alternates include a member on safety hold", () => {
    const w = buildTestWorld([], ["alt1"]);

    const cand = {
      participants: ["p1", "p2", "p3"],
      alternates: ["alt1"],
      category: "social" as const,
    };

    expect(hardGate(w, cand)).toBe("safety_hold");
  });

  test("hardGate flags a candidate when two alternates are mutually blocked", () => {
    const w = buildTestWorld([["alt1", "alt2"]]);

    const cand = {
      participants: ["p1", "p2", "p3"],
      alternates: ["alt1", "alt2"],
      category: "social" as const,
    };

    expect(hardGate(w, cand)).toBe("blocked");
  });

  test("hardGate passes when alternates are clean and pairwise compatible", () => {
    const w = buildTestWorld();

    const cand = {
      participants: ["p1", "p2", "p3"],
      alternates: ["alt1", "alt3"],
      category: "social" as const,
    };

    expect(hardGate(w, cand)).toBeNull();
  });
});
