import type { Intent } from "@thenetwork/core";
import { describe, expect, it } from "vitest";
import {
  classifyEmptyStateRemedy,
  DEFAULT_CONFIG,
  humanVectorOf,
  intersectCount,
  localEmbed,
  peonPack,
  slopPack,
  venueCostFitsTier,
  World,
} from "../src/index.ts";
import { friendsPack } from "../src/packs/friends/index.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";

function makeIntent(id: string, memberId: string, objective: string, category: Intent["category"], createdAt: number): Intent {
  return { id, memberId, objective, category, horizonDays: 14, status: "active", createdAt };
}

describe("wave 1 engine foundation: humanVector slimming, seniority, cost tiers, remedies, intersectCount", () => {
  it("enforces canonical 0..4 price tiers in venueCostFitsTier", () => {
    expect(venueCostFitsTier("free", 0)).toBe(true);
    expect(venueCostFitsTier("free", 1)).toBe(false);
    expect(venueCostFitsTier("low", 1)).toBe(true);
    expect(venueCostFitsTier("low", 2)).toBe(false);
    expect(venueCostFitsTier("moderate", 2)).toBe(true);
    expect(venueCostFitsTier("moderate", 3)).toBe(false);
    expect(venueCostFitsTier("high", 3)).toBe(true);
    expect(venueCostFitsTier("high", 4)).toBe(false);
    expect(venueCostFitsTier("unconstrained", 4)).toBe(true);
    expect(venueCostFitsTier("free", -1)).toBe(false);
  });

  it("reads peon:seniority:* from matchable fact and goal facets and keeps vouchQuality live", () => {
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    const a = baseMember("a", { age: 29, homeCity: "chicago" });
    const b = baseMember("b", { age: 31, homeCity: "chicago" });
    const wPeon = new World({
      ...emptyInput(now),
      members: [a, b],
      facets: [
        facet("a", 1, "fact", "senior analyst role", ["peon:family:data_analyst", "peon:seniority:3"], "matchable"),
        facet("b", 1, "goal", "wants data analyst work", ["peon:family:data_analyst", "peon:seniority:2"], "matchable"),
      ],
    }, DEFAULT_CONFIG, localEmbed, peonPack);

    expect(humanVectorOf(wPeon, "a")?.capital.domainRungs.career?.value).toBe(6);
    expect(humanVectorOf(wPeon, "b")?.capital.domainRungs.career?.value).toBe(4);

    const wNet = new World({
      ...emptyInput(now),
      members: [a, b],
      facets: [],
      edges: [{ from: "a", to: "b", type: "vouched_for", strength: 0.9, explicit: true, createdAt: now - 1000 }],
    }, DEFAULT_CONFIG, localEmbed);

    expect(humanVectorOf(wNet, "a")?.capital.social.vouchQuality.value).toBeGreaterThan(0.35);
    expect(humanVectorOf(wNet, "b")?.capital.social.vouchQuality.value).toBeGreaterThan(0.35);
  });

  it("locks minors strictly to solo allAges concierge and routes sparse adult remedies cleanly", () => {
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    const minor = baseMember("m16", { age: 16, homeCity: "miami" });
    const adult = baseMember("a28", { age: 28, homeCity: "miami" });
    const wFriends = new World({
      ...emptyInput(now),
      members: [minor, adult],
      facets: [
        facet("a28", 1, "interest", "ceramics", ["ceramics", "coffee", "running"]),
        facet("a28", 2, "interest", "board games", ["board_games", "books"]),
        facet("a28", 3, "trait", "curious", ["curious"]),
      ],
      intents: [
        makeIntent("i-minor", "m16", "meet friends", "social", now - 1000),
        makeIntent("i-adult", "a28", "meet friends", "social", now - 1000),
      ],
    }, DEFAULT_CONFIG, localEmbed, friendsPack);

    const minorRem = classifyEmptyStateRemedy(
      wFriends,
      { intentId: "i-minor", memberId: "m16", reason: "density_gap" },
      { densityTier: "sparse", city: "miami", appId: "friends", photoReadinessIssues: true },
    );
    expect(minorRem?.stage).toBe("single_player_concierge");
    expect(minorRem?.remedyKind).toBe("local_public_events");
    expect(minorRem?.involvesOtherMembers).toBe(false);
    expect(minorRem?.diagnosticCodes).toContain("all_ages_public_only");

    const friendsSparse = classifyEmptyStateRemedy(
      wFriends,
      { intentId: "i-adult", memberId: "a28", reason: "density_gap" },
      { densityTier: "sparse", city: "miami", appId: "friends" },
    );
    expect(friendsSparse?.stage).toBe("external_bridge");
    expect(friendsSparse?.remedyKind).toBe("external_open_event_bridge");
    expect(friendsSparse?.involvesOtherMembers).toBe(false);

    const wSlop = new World({
      ...emptyInput(now),
      members: [adult],
      facets: [
        facet("a28", 1, "interest", "coffee", ["coffee", "books"]),
        facet("a28", 2, "interest", "music", ["music", "running"]),
        facet("a28", 3, "trait", "warm", ["warm"]),
      ],
      intents: [makeIntent("i-date", "a28", "meet someone", "romance", now - 1000)],
    }, DEFAULT_CONFIG, localEmbed, slopPack);

    const slopPhoto = classifyEmptyStateRemedy(
      wSlop,
      { intentId: "i-date", memberId: "a28", reason: "density_gap" },
      { densityTier: "sparse", city: "miami", appId: "slop", photoReadinessIssues: true },
    );
    expect(slopPhoto?.remedyKind).toBe("photo_readiness_coaching");
    expect(slopPhoto?.involvesOtherMembers).toBe(false);

    const slopSparse = classifyEmptyStateRemedy(
      wSlop,
      { intentId: "i-date", memberId: "a28", reason: "density_gap" },
      { densityTier: "sparse", city: "miami", appId: "slop" },
    );
    expect(slopSparse?.remedyKind).toBe("external_matchmaker_sourcing");
    expect(slopSparse?.involvesOtherMembers).toBe(false);
  });

  it("exports intersectCount for sorted TagSets", () => {
    expect(intersectCount([1, 3, 5, 9], [2, 3, 5, 8, 9])).toBe(3);
    expect(intersectCount([1, 2], [3, 4])).toBe(0);
  });
});
