// Event anchor romance gates and canMeet checks (packages/engine/src/packs/network/generators.ts).
import { describe, expect, test } from "bun:test";
import { DAY, EngineRng as Rng, type Member } from "@thenetwork/core";
import { DEFAULT_CONFIG, localEmbed, World, type EngineInput } from "../../engine/src/index.ts";
import { eventAnchor } from "../../engine/src/packs/network/generators.ts";

function makeMember(id: string, name: string, city: "sf" | "nyc" = "sf", romance: boolean = true): Member {
  return {
    id,
    name,
    homeCity: city,
    state: "normal",
    age: 28,
    joinedAt: Date.UTC(2026, 9, 1),
    prefs: {
      categoriesOptIn: ["social", "events", "romance"],
      formats: ["one_to_one", "small_group", "event"],
      quietHours: [22, 8],
      romanceOptIn: romance,
      maxTravelMinutes: 60,
      onlyWhenAsked: false,
    },
    unansweredProactive: 0,
  };
}

describe("eventAnchor generator romance and canMeet gates", () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const cfg = { ...DEFAULT_CONFIG };

  test("romance-category event never composes groups even with 4 eligible attendees", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_a", "Alice", "sf", true),
        makeMember("m_b", "Bob", "sf", true),
        makeMember("m_c", "Charlie", "sf", true),
        makeMember("m_d", "Diana", "sf", true),
      ],
      facets: [
        { id: "f_a", memberId: "m_a", kind: "interest", value: "speed dating cocktail night", tags: ["dating", "cocktails"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_b", memberId: "m_b", kind: "interest", value: "speed dating cocktail night", tags: ["dating", "cocktails"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_c", memberId: "m_c", kind: "interest", value: "speed dating cocktail night", tags: ["dating", "cocktails"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_d", memberId: "m_d", kind: "interest", value: "speed dating cocktail night", tags: ["dating", "cocktails"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_a_pref", memberId: "m_a", kind: "preference", value: "dating preferences", tags: ["romance:is:woman", "romance:seeks:man", "romance:age:20-40"], scope: "agent_private", provenance: "said", confidence: 1 },
        { id: "f_b_pref", memberId: "m_b", kind: "preference", value: "dating preferences", tags: ["romance:is:man", "romance:seeks:woman", "romance:age:20-40"], scope: "agent_private", provenance: "said", confidence: 1 },
        { id: "f_c_pref", memberId: "m_c", kind: "preference", value: "dating preferences", tags: ["romance:is:woman", "romance:seeks:man", "romance:age:20-40"], scope: "agent_private", provenance: "said", confidence: 1 },
        { id: "f_d_pref", memberId: "m_d", kind: "preference", value: "dating preferences", tags: ["romance:is:man", "romance:seeks:woman", "romance:age:20-40"], scope: "agent_private", provenance: "said", confidence: 1 },
      ],
      intents: [],
      presence: [
        { memberId: "m_a", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_c", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_d", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [],
      interactions: [],
      feedback: [],
      recentProposals: [],
      events: [
        {
          id: "ev_romance",
          title: "Speed Dating & Cocktail Mixer",
          category: "romance",
          city: "sf",
          start: now + DAY,
          end: now + DAY + 3 * 3600 * 1000,
          description: "Singles cocktail mixer and speed dating",
          tags: ["dating", "cocktails"],
        },
      ],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = eventAnchor(ctx);

    // Candidates should only be 1-on-1 pairs (size === 2), never groups (size > 2)
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.participants.length).toBe(2);
      expect(c.category).toBe("romance");
      expect(c.alternates?.length ?? 0).toBe(0);
    }
  });

  test("non-romance event composes both pairs and group when >= 3 attendees match", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_a", "Alice", "sf", false),
        makeMember("m_b", "Bob", "sf", false),
        makeMember("m_c", "Charlie", "sf", false),
      ],
      facets: [
        { id: "f_a", memberId: "m_a", kind: "interest", value: "bouldering climbing gym meet", tags: ["climbing"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_b", memberId: "m_b", kind: "interest", value: "bouldering climbing gym meet", tags: ["climbing"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_c", memberId: "m_c", kind: "interest", value: "bouldering climbing gym meet", tags: ["climbing"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m_a", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_c", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [],
      interactions: [],
      feedback: [],
      recentProposals: [],
      events: [
        {
          id: "ev_social",
          title: "Community Bouldering Night",
          category: "events",
          city: "sf",
          start: now + DAY,
          end: now + DAY + 3 * 3600 * 1000,
          description: "Fun social climbing session",
          tags: ["climbing"],
        },
      ],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = eventAnchor(ctx);

    expect(candidates.length).toBeGreaterThan(0);
    const groups = candidates.filter(c => c.participants.length >= 3);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0]!.category).toBe("events");
  });

  test("canMeet excludes pairs with no mutual city or presence overlap", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_sf", "San Francisco Member", "sf"),
        makeMember("m_nyc", "New York Member", "nyc"),
      ],
      facets: [
        { id: "f_sf", memberId: "m_sf", kind: "interest", value: "tech mixer meetup", tags: ["tech"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_nyc", memberId: "m_nyc", kind: "interest", value: "tech mixer meetup", tags: ["tech"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        // m_sf is in sf, m_nyc is in nyc.
        { memberId: "m_sf", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_nyc", city: "nyc", type: "home", areas: ["brooklyn"] },
      ],
      edges: [],
      interactions: [],
      feedback: [],
      recentProposals: [],
      events: [
        {
          id: "ev_sf",
          title: "SF Tech Networking Night",
          category: "social",
          city: "sf",
          start: now + DAY,
          end: now + DAY + 2 * 3600 * 1000,
          description: "Casual evening drinks for engineers",
          tags: ["tech"],
        },
      ],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    expect(w.canMeet(["m_sf", "m_nyc"])).toBe(false);

    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = eventAnchor(ctx);
    // m_nyc is not in sf so pool only has m_sf, no pairs generated
    expect(candidates).toHaveLength(0);
  });
});
