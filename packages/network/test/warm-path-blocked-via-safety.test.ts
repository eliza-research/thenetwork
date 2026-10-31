// Enforce safety holds, paused state, and blocking constraints on intermediaries (via) in twoHop and warmPath.
import { describe, expect, test } from "bun:test";
import { DAY, EngineRng as Rng, type Edge, type EdgeType, type Member } from "@thenetwork/core";
import { DEFAULT_CONFIG, localEmbed, World, type EngineInput } from "../../engine/src/index.ts";
import { twoHop } from "../../engine/src/retrieval.ts";
import { warmPath } from "../../engine/src/packs/network/generators.ts";
import type { GenCtx } from "../../engine/src/genkit.ts";

function makeMember(id: string, name: string, city: "sf" | "nyc" = "sf", state: "normal" | "paused" = "normal"): Member {
  return {
    id,
    name,
    homeCity: city,
    state,
    age: 30,
    joinedAt: Date.UTC(2026, 9, 1),
    prefs: {
      categoriesOptIn: ["social", "events", "hobby"],
      formats: ["one_to_one", "small_group"],
      quietHours: [22, 8],
      romanceOptIn: false,
      maxTravelMinutes: 60,
      onlyWhenAsked: false,
    },
    unansweredProactive: 0,
  };
}

describe("twoHop retrieval and warmPath generator safety and block constraints", () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const cfg = { ...DEFAULT_CONFIG };

  function makeEdge(from: string, to: string, type: EdgeType, strength = 1.0): Edge {
    return { from, to, type, strength, explicit: true, createdAt: now - DAY };
  }

  function makeInput(partial: Partial<EngineInput> & { members: Member[] }): EngineInput {
    return {
      now,
      recentProposals: [],
      interactions: [],
      feedback: [],
      facets: [],
      intents: [],
      presence: [],
      edges: [],
      ...partial,
    };
  }

  function makeCtx(w: World): GenCtx {
    return {
      w,
      rng: new Rng(1),
      unmatchedIntents: new Set<string>(),
      memberExclusions: {} as Record<string, number>,
    };
  }

  test("twoHop excludes intermediary blocked with seeker", () => {
    const input = makeInput({
      members: [
        makeMember("m_a", "Alice"),
        makeMember("m_x", "Xander"),
        makeMember("m_b", "Bob"),
      ],
      presence: [
        { memberId: "m_a", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [
        makeEdge("m_a", "m_x", "knows", 0.8),
        makeEdge("m_x", "m_b", "knows", 0.8),
        makeEdge("m_a", "m_x", "blocked", 1.0), // A blocked X
      ],
    });

    const w = new World(input, cfg, localEmbed);
    const hop = twoHop(w, "m_a");
    expect(hop.has("m_b")).toBe(false);
  });

  test("twoHop excludes candidate blocked with intermediary", () => {
    const input = makeInput({
      members: [
        makeMember("m_a", "Alice"),
        makeMember("m_x", "Xander"),
        makeMember("m_b", "Bob"),
      ],
      presence: [
        { memberId: "m_a", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [
        makeEdge("m_a", "m_x", "knows", 0.8),
        makeEdge("m_x", "m_b", "knows", 0.8),
        makeEdge("m_b", "m_x", "blocked", 1.0), // B blocked X
      ],
    });

    const w = new World(input, cfg, localEmbed);
    const hop = twoHop(w, "m_a");
    expect(hop.has("m_b")).toBe(false);
  });

  test("twoHop excludes candidate directly blocked with seeker", () => {
    const input = makeInput({
      members: [
        makeMember("m_a", "Alice"),
        makeMember("m_x", "Xander"),
        makeMember("m_b", "Bob"),
      ],
      presence: [
        { memberId: "m_a", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [
        makeEdge("m_a", "m_x", "knows", 0.8),
        makeEdge("m_x", "m_b", "knows", 0.8),
        makeEdge("m_a", "m_b", "blocked", 1.0), // A blocked B directly
      ],
    });

    const w = new World(input, cfg, localEmbed);
    const hop = twoHop(w, "m_a");
    expect(hop.has("m_b")).toBe(false);
  });

  test("twoHop chooses unblocked alternative intermediary when higher strength intermediary is blocked", () => {
    const input = makeInput({
      members: [
        makeMember("m_a", "Alice"),
        makeMember("m_x1", "Xavier"),
        makeMember("m_x2", "Xena"),
        makeMember("m_b", "Bob"),
      ],
      presence: [
        { memberId: "m_a", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x2", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [
        // Path 1 via X1: strength 0.9, but B blocked X1
        makeEdge("m_a", "m_x1", "knows", 0.9),
        makeEdge("m_x1", "m_b", "knows", 0.9),
        makeEdge("m_b", "m_x1", "blocked", 1.0),
        // Path 2 via X2: strength 0.7, clean
        makeEdge("m_a", "m_x2", "knows", 0.7),
        makeEdge("m_x2", "m_b", "knows", 0.7),
      ],
    });

    const w = new World(input, cfg, localEmbed);
    const hop = twoHop(w, "m_a");
    expect(hop.has("m_b")).toBe(true);
    const path = hop.get("m_b")!;
    expect(path.via).toBe("m_x2");
    expect(path.strength).toBeCloseTo(0.49, 2);
  });

  test("twoHop excludes intermediary or candidate on safety hold or paused", () => {
    const input = makeInput({
      members: [
        makeMember("m_a", "Alice"),
        makeMember("m_x_held", "Held Intermediary"),
        makeMember("m_b1", "Bob 1"),
        makeMember("m_x_normal", "Normal Intermediary"),
        makeMember("m_b_paused", "Paused Bob", "sf", "paused"),
      ],
      presence: [
        { memberId: "m_a", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x_held", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x_normal", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b_paused", city: "sf", type: "home", areas: ["mission"] },
      ],
      safetyHolds: [
        { memberId: "m_x_held", reason: "investigation", from: now - DAY },
      ],
      edges: [
        makeEdge("m_a", "m_x_held", "knows", 0.8),
        makeEdge("m_x_held", "m_b1", "knows", 0.8),
        makeEdge("m_a", "m_x_normal", "knows", 0.8),
        makeEdge("m_x_normal", "m_b_paused", "knows", 0.8),
      ],
    });

    const w = new World(input, cfg, localEmbed);
    const hop = twoHop(w, "m_a");
    expect(hop.has("m_b1")).toBe(false);
    expect(hop.has("m_b_paused")).toBe(false);
  });

  test("warmPath generator excludes blocked intermediary and proposes valid candidate", () => {
    const input = makeInput({
      members: [
        makeMember("m_seeker", "Seeker Sam"),
        makeMember("m_x_blocked", "Blocked Connector"),
        makeMember("m_b_blocked", "Blocked Candidate"),
        makeMember("m_x_clean", "Clean Connector"),
        makeMember("m_b_clean", "Clean Candidate"),
      ],
      facets: [
        { id: "f_b_blocked", memberId: "m_b_blocked", kind: "offer", value: "love hiking trails and outdoor adventures", tags: ["hiking", "outdoors"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_b_clean", memberId: "m_b_clean", kind: "offer", value: "love hiking trails and outdoor adventures", tags: ["hiking", "outdoors"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [
        {
          id: "int_social",
          memberId: "m_seeker",
          category: "social",
          objective: "find someone to go hiking with on weekend trails",
          status: "active",
          horizonDays: 14,
          createdAt: now - DAY,
        },
      ],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x_blocked", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b_blocked", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x_clean", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b_clean", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [
        // Path 1: Seeker -> X_blocked -> B_blocked, but Seeker blocked X_blocked
        makeEdge("m_seeker", "m_x_blocked", "knows", 0.9),
        makeEdge("m_x_blocked", "m_b_blocked", "knows", 0.9),
        makeEdge("m_seeker", "m_x_blocked", "blocked", 1.0),
        // Path 2: Seeker -> X_clean -> B_clean, completely valid
        makeEdge("m_seeker", "m_x_clean", "knows", 0.8),
        makeEdge("m_x_clean", "m_b_clean", "knows", 0.8),
      ],
    });

    const w = new World(input, cfg, localEmbed);
    const ctx = makeCtx(w);

    const candidates = warmPath(ctx);
    expect(candidates.length).toBeGreaterThan(0);
    // None of the generated candidates should use the blocked connector
    for (const c of candidates) {
      expect(c.via).not.toBe("m_x_blocked");
      expect(c.participants).not.toContain("m_b_blocked");
    }
    // Clean candidate is proposed
    const cleanCand = candidates.find(c => c.participants.includes("m_b_clean"));
    expect(cleanCand).toBeDefined();
    expect(cleanCand!.via).toBe("m_x_clean");
    expect(cleanCand!.generator).toBe("warm_path");
  });

  test("warmPath excludes intermediary on safety hold or paused state", () => {
    const input = makeInput({
      members: [
        makeMember("m_seeker", "Seeker Sam"),
        makeMember("m_x_held", "Held Connector"),
        makeMember("m_b1", "Candidate 1"),
        makeMember("m_x_paused", "Paused Connector", "sf", "paused"),
        makeMember("m_b2", "Candidate 2"),
      ],
      facets: [
        { id: "f_b1", memberId: "m_b1", kind: "offer", value: "love hiking trails and outdoor adventures", tags: ["hiking", "outdoors"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_b2", memberId: "m_b2", kind: "offer", value: "love hiking trails and outdoor adventures", tags: ["hiking", "outdoors"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [
        {
          id: "int_social",
          memberId: "m_seeker",
          category: "social",
          objective: "find someone to go hiking with on weekend trails",
          status: "active",
          horizonDays: 14,
          createdAt: now - DAY,
        },
      ],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x_held", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x_paused", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b2", city: "sf", type: "home", areas: ["mission"] },
      ],
      safetyHolds: [
        { memberId: "m_x_held", reason: "safety_complaint", from: now - DAY },
      ],
      edges: [
        makeEdge("m_seeker", "m_x_held", "knows", 0.8),
        makeEdge("m_x_held", "m_b1", "knows", 0.8),
        makeEdge("m_seeker", "m_x_paused", "knows", 0.8),
        makeEdge("m_x_paused", "m_b2", "knows", 0.8),
      ],
    });

    const w = new World(input, cfg, localEmbed);
    const ctx = makeCtx(w);

    const candidates = warmPath(ctx);
    expect(candidates).toHaveLength(0);
  });

  test("warmPath excludes candidate when recipient blocked the intermediary", () => {
    const input = makeInput({
      members: [
        makeMember("m_seeker", "Seeker Sam"),
        makeMember("m_x", "Connector"),
        makeMember("m_b", "Recipient Bob"),
      ],
      facets: [
        { id: "f_b", memberId: "m_b", kind: "offer", value: "love hiking trails and outdoor adventures", tags: ["hiking", "outdoors"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [
        {
          id: "int_social",
          memberId: "m_seeker",
          category: "social",
          objective: "find someone to go hiking with on weekend trails",
          status: "active",
          horizonDays: 14,
          createdAt: now - DAY,
        },
      ],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_x", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_b", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [
        makeEdge("m_seeker", "m_x", "knows", 0.8),
        makeEdge("m_x", "m_b", "knows", 0.8),
        makeEdge("m_b", "m_x", "blocked", 1.0), // Bob blocked connector X
      ],
    });

    const w = new World(input, cfg, localEmbed);
    const ctx = makeCtx(w);

    const candidates = warmPath(ctx);
    expect(candidates).toHaveLength(0);
  });
});
