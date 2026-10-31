// Expansion generator pairReason constraints enforcement (packages/engine/src/packs/network/generators.ts).
import { describe, expect, test } from "bun:test";
import { DAY, EngineRng as Rng, type Member } from "@thenetwork/core";
import { DEFAULT_CONFIG, localEmbed, World, type EngineInput } from "../../engine/src/index.ts";
import { expansion } from "../../engine/src/packs/network/generators.ts";

function makeMember(id: string, name: string, city: "sf" | "nyc" = "sf"): Member {
  return {
    id,
    name,
    homeCity: city,
    state: "normal",
    age: 28,
    joinedAt: Date.UTC(2026, 9, 1),
    prefs: {
      categoriesOptIn: ["social", "hobby", "professional"],
      formats: ["one_to_one"],
      quietHours: [22, 8],
      romanceOptIn: false,
      maxTravelMinutes: 30,
      onlyWhenAsked: false,
    },
    unansweredProactive: 0,
  };
}

describe("expansion generator pairReason gates", () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const cfg = { ...DEFAULT_CONFIG };

  test("blocked member is excluded from expansion candidate pool", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_seeker", "Seeker"),
        makeMember("m_provider", "Provider"),
      ],
      facets: [
        // Seeker's primary cluster is climbing (dominant tag)
        { id: "f_dom1", memberId: "m_seeker", kind: "interest", value: "bouldering in the gym", tags: ["climbing"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_dom2", memberId: "m_seeker", kind: "interest", value: "outdoor lead climbing", tags: ["climbing"], scope: "matchable", provenance: "said", confidence: 0.9 },
        // Seeker's outside desire (ceramics)
        { id: "f_outside", memberId: "m_seeker", kind: "desire", value: "learn pottery and wheel throwing ceramics", tags: ["ceramics"], scope: "matchable", provenance: "said", confidence: 0.9 },
        // Provider's cluster is ceramics and offers ceramics teaching
        { id: "f_prov1", memberId: "m_provider", kind: "interest", value: "ceramics open studio", tags: ["ceramics"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_prov_skill", memberId: "m_provider", kind: "skill", value: "teaches pottery wheel throwing and ceramics", tags: ["ceramics"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_provider", city: "sf", type: "home", areas: ["mission"] },
      ],
      // Seeker blocked provider
      edges: [
        { from: "m_seeker", to: "m_provider", type: "blocked", strength: 1, explicit: true, createdAt: now - DAY },
      ],
      interactions: [],
      feedback: [],
      recentProposals: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    expect(w.get("m_seeker")!.cluster).toBe("climbing");
    expect(w.get("m_provider")!.cluster).toBe("ceramics");
    expect(w.blocked.has("m_provider|m_seeker")).toBe(true);

    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = expansion(ctx);
    expect(candidates).toHaveLength(0);
  });

  test("member with dealbreaker is excluded from expansion candidate pool", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_seeker", "Seeker"),
        makeMember("m_provider", "Provider"),
      ],
      facets: [
        // Seeker's primary cluster is climbing
        { id: "f_dom1", memberId: "m_seeker", kind: "interest", value: "bouldering in the gym", tags: ["climbing"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_dom2", memberId: "m_seeker", kind: "interest", value: "outdoor lead climbing", tags: ["climbing"], scope: "matchable", provenance: "said", confidence: 0.9 },
        // Seeker has a dealbreaker boundary against smokers
        { id: "f_deal", memberId: "m_seeker", kind: "boundary", value: "no smokers please", tags: ["dealbreaker:smoker"], scope: "agent_private", provenance: "said", confidence: 1 },
        // Seeker's outside desire (ceramics)
        { id: "f_outside", memberId: "m_seeker", kind: "desire", value: "learn pottery and wheel throwing ceramics", tags: ["ceramics"], scope: "matchable", provenance: "said", confidence: 0.9 },
        // Provider is in ceramics cluster but has smoker tag
        { id: "f_prov1", memberId: "m_provider", kind: "interest", value: "ceramics open studio", tags: ["ceramics", "smoker"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_prov_skill", memberId: "m_provider", kind: "skill", value: "teaches pottery wheel throwing and ceramics", tags: ["ceramics"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_provider", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [],
      interactions: [],
      feedback: [],
      recentProposals: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    expect(w.get("m_seeker")!.dealbreakers).toContain("smoker");

    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = expansion(ctx);
    expect(candidates).toHaveLength(0);
  });

  test("eligible and unblocked member is proposed through expansion", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_seeker", "Seeker"),
        makeMember("m_provider", "Provider"),
      ],
      facets: [
        { id: "f_dom1", memberId: "m_seeker", kind: "interest", value: "bouldering in the gym", tags: ["climbing"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_dom2", memberId: "m_seeker", kind: "interest", value: "outdoor lead climbing", tags: ["climbing"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_outside", memberId: "m_seeker", kind: "desire", value: "learn pottery and wheel throwing ceramics", tags: ["ceramics"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_prov1", memberId: "m_provider", kind: "interest", value: "ceramics open studio", tags: ["ceramics"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_prov_skill", memberId: "m_provider", kind: "skill", value: "teaches pottery wheel throwing and ceramics", tags: ["ceramics"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_provider", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [],
      interactions: [],
      feedback: [],
      recentProposals: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = expansion(ctx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.kind).toBe("expansion");
    expect(candidates[0]!.participants).toEqual(["m_seeker", "m_provider"]);
  });
});
