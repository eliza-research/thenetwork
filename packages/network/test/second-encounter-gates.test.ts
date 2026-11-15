// Second encounter generator gating and fallback behavior (packages/engine/src/packs/network/generators.ts).
import { describe, expect, test } from "bun:test";
import { DAY, EngineRng as Rng, type Member } from "@thenetwork/core";
import { DEFAULT_CONFIG, localEmbed, World, type EngineInput } from "../../engine/src/index.ts";
import { secondEncounter } from "../../engine/src/packs/network/generators.ts";

function makeMember(id: string, name: string, city: "sf" | "nyc", formats: ("one_to_one" | "small_group" | "event")[] = ["one_to_one"]): Member {
  return {
    id,
    name,
    homeCity: city,
    state: "normal",
    age: 28,
    joinedAt: Date.UTC(2026, 9, 1),
    prefs: {
      categoriesOptIn: ["social", "hobby", "professional"],
      formats,
      quietHours: [22, 8],
      romanceOptIn: false,
      maxTravelMinutes: 30,
      onlyWhenAsked: false,
    },
    unansweredProactive: 0,
  };
}

describe("secondEncounter generator gates and fallback alignment", () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const cfg = { ...DEFAULT_CONFIG };

  test("blocked pair after a completed positive meeting produces no second encounter", () => {
    const input: EngineInput = {
      members: [
        makeMember("m01", "Alice", "sf", ["one_to_one", "event"]),
        makeMember("m02", "Bob", "sf", ["one_to_one", "event"]),
      ],
      facets: [
        { id: "f1", memberId: "m01", kind: "interest", value: "bouldering and rock climbing", tags: ["climbing"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f2", memberId: "m02", kind: "interest", value: "bouldering and outdoor climbing", tags: ["climbing"], scope: "shareable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m01", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m02", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [
        { from: "m01", to: "m02", type: "blocked", strength: 1, explicit: true, createdAt: now - DAY },
      ],
      interactions: [
        { id: "int1", kind: "intro", category: "social", at: now - 5 * DAY, participants: ["m01", "m02"], outcome: "completed" },
      ],
      feedback: [
        { id: "fb1", at: now - 4 * DAY, from: "m01", about: "m02", sentiment: "positive", wouldMeetAgain: true, opportunityId: "int1" },
        { id: "fb2", at: now - 4 * DAY, from: "m02", about: "m01", sentiment: "positive", wouldMeetAgain: true, opportunityId: "int1" },
      ],
      recentProposals: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = secondEncounter(ctx);
    expect(candidates).toHaveLength(0);
  });

  test("pair without presence overlap produces no second encounter", () => {
    const input: EngineInput = {
      members: [
        makeMember("m01", "Alice", "sf", ["one_to_one", "event"]),
        makeMember("m02", "Bob", "nyc", ["one_to_one", "event"]),
      ],
      facets: [
        { id: "f1", memberId: "m01", kind: "interest", value: "bouldering and rock climbing", tags: ["climbing"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f2", memberId: "m02", kind: "interest", value: "bouldering and outdoor climbing", tags: ["climbing"], scope: "shareable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m01", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m02", city: "nyc", type: "home", areas: ["williamsburg"] },
      ],
      edges: [],
      interactions: [
        { id: "int1", kind: "intro", category: "social", at: now - 5 * DAY, participants: ["m01", "m02"], outcome: "completed" },
      ],
      feedback: [
        { id: "fb1", at: now - 4 * DAY, from: "m01", about: "m02", sentiment: "positive", wouldMeetAgain: true, opportunityId: "int1" },
        { id: "fb2", at: now - 4 * DAY, from: "m02", about: "m01", sentiment: "positive", wouldMeetAgain: true, opportunityId: "int1" },
      ],
      recentProposals: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = secondEncounter(ctx);
    expect(candidates).toHaveLength(0);
  });

  test("event below similarity threshold falls back to one_to_one and social category without failing member format gate", () => {
    const input: EngineInput = {
      members: [
        // Member only opts in to one_to_one, not event
        makeMember("m01", "Alice", "sf", ["one_to_one"]),
        makeMember("m02", "Bob", "sf", ["one_to_one"]),
      ],
      facets: [
        { id: "f1", memberId: "m01", kind: "interest", value: "bouldering and rock climbing", tags: ["climbing"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f2", memberId: "m02", kind: "interest", value: "bouldering and outdoor climbing", tags: ["climbing"], scope: "shareable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m01", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m02", city: "sf", type: "home", areas: ["mission"] },
      ],
      events: [
        // An event with completely unrelated theme so similarity is very low (< minSim * 0.8)
        { id: "ev1", title: "Classical Opera and Baroque Vocal Masterclass", city: "sf", category: "hobby", start: now + DAY, end: now + DAY + 2 * 3600 * 1000, tags: ["opera", "baroque"], riskTags: [] },
      ],
      edges: [],
      interactions: [
        { id: "int1", kind: "intro", category: "social", at: now - 5 * DAY, participants: ["m01", "m02"], outcome: "completed" },
      ],
      feedback: [
        { id: "fb1", at: now - 4 * DAY, from: "m01", about: "m02", sentiment: "positive", wouldMeetAgain: true, opportunityId: "int1" },
        { id: "fb2", at: now - 4 * DAY, from: "m02", about: "m01", sentiment: "positive", wouldMeetAgain: true, opportunityId: "int1" },
      ],
      recentProposals: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = secondEncounter(ctx);
    expect(candidates).toHaveLength(1);
    const c0 = candidates[0]!;
    expect(c0.format).toBe("one_to_one");
    expect(c0.category).toBe("social");
    expect(c0.anchor?.type).toBe("interaction");
    expect(c0.anchor?.id).toBe("int1");
  });

  test("event above similarity threshold uses event format and event category", () => {
    const input: EngineInput = {
      members: [
        makeMember("m01", "Alice", "sf", ["one_to_one", "event"]),
        makeMember("m02", "Bob", "sf", ["one_to_one", "event"]),
      ],
      facets: [
        { id: "f1", memberId: "m01", kind: "interest", value: "bouldering and rock climbing gym partner", tags: ["climbing"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f2", memberId: "m02", kind: "interest", value: "bouldering and rock climbing gym meetup", tags: ["climbing"], scope: "shareable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m01", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m02", city: "sf", type: "home", areas: ["mission"] },
      ],
      events: [
        { id: "ev_climb", title: "Bouldering and Rock Climbing Social", city: "sf", category: "hobby", start: now + DAY, end: now + DAY + 2 * 3600 * 1000, tags: ["climbing", "bouldering"], riskTags: [] },
      ],
      edges: [],
      interactions: [
        { id: "int1", kind: "intro", category: "social", at: now - 5 * DAY, participants: ["m01", "m02"], outcome: "completed" },
      ],
      feedback: [
        { id: "fb1", at: now - 4 * DAY, from: "m01", about: "m02", sentiment: "positive", wouldMeetAgain: true, opportunityId: "int1" },
        { id: "fb2", at: now - 4 * DAY, from: "m02", about: "m01", sentiment: "positive", wouldMeetAgain: true, opportunityId: "int1" },
      ],
      recentProposals: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = secondEncounter(ctx);
    expect(candidates).toHaveLength(1);
    const c0 = candidates[0]!;
    expect(c0.format).toBe("event");
    expect(c0.category).toBe("hobby");
    expect(c0.anchor?.type).toBe("event");
    expect(c0.anchor?.id).toBe("ev_climb");
  });
});
