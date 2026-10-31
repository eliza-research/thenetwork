// Help request home entry safety, presence overlap, and format gates.
import { describe, expect, test } from "bun:test";
import { DAY, EngineRng as Rng, type Member } from "@thenetwork/core";
import { DEFAULT_CONFIG, localEmbed, World, type EngineInput } from "../../engine/src/index.ts";
import { helpRequest } from "../../engine/src/packs/network/generators.ts";

function makeMember(id: string, name: string, city: "sf" | "nyc" = "sf", formats: string[] = ["one_to_one", "small_group"]): Member {
  return {
    id,
    name,
    homeCity: city,
    state: "normal",
    age: 28,
    joinedAt: Date.UTC(2026, 9, 1),
    prefs: {
      categoriesOptIn: ["social", "events", "help"],
      formats: formats as any,
      quietHours: [22, 8],
      romanceOptIn: false,
      maxTravelMinutes: 60,
      onlyWhenAsked: false,
    },
    unansweredProactive: 0,
  };
}

describe("helpRequest generator home entry and canMeet gates", () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const cfg = { ...DEFAULT_CONFIG };

  test("home entry with unacquainted helpers enforces at least 2 helpers (F14 safety rule)", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_seeker", "Seeker Sam", "sf"),
        makeMember("m_h1", "Helper One", "sf"),
        makeMember("m_h2", "Helper Two", "sf"),
      ],
      facets: [
        { id: "f_h1", memberId: "m_h1", kind: "offer", value: "help moving heavy couch furniture into apartment living room", tags: ["moving", "furniture", "couch"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_h2", memberId: "m_h2", kind: "offer", value: "help moving heavy couch furniture into apartment living room", tags: ["moving", "furniture", "couch"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [
        {
          id: "int_home",
          memberId: "m_seeker",
          category: "help",
          objective: "need help moving heavy couch furniture into apartment living room",
          status: "active",
          horizonDays: 14,
          createdAt: now - DAY,
        },
      ],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h2", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [], // No prior edges: both helpers are strangers to seeker
      interactions: [],
      feedback: [],
      recentProposals: [],
      events: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = helpRequest(ctx);

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.safetyClass).toBe("medium");
      // Must have at least 2 helpers (total participants >= 3: 1 seeker + 2 helpers)
      expect(c.participants.length).toBeGreaterThanOrEqual(3);
      expect(c.format).toBe("small_group");
    }
  });

  test("home entry with only 1 stranger available fails safe without dispatching lone stranger", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_seeker", "Seeker Sam", "sf"),
        makeMember("m_h1", "Helper One", "sf"),
      ],
      facets: [
        { id: "f_h1", memberId: "m_h1", kind: "offer", value: "help moving couch furniture inside apartment living room", tags: ["moving", "furniture"], scope: "matchable", provenance: "said", confidence: 0.9 },
      ],
      intents: [
        {
          id: "int_home",
          memberId: "m_seeker",
          category: "help",
          objective: "need help moving couch furniture inside apartment living room",
          status: "active",
          horizonDays: 14,
          createdAt: now - DAY,
        },
      ],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h1", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [], // stranger
      interactions: [],
      feedback: [],
      recentProposals: [],
      events: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = helpRequest(ctx);

    // Should NOT produce a candidate with a single stranger entering home
    expect(candidates).toHaveLength(0);
    expect(ctx.unmatchedIntents.has("int_home")).toBe(true);
  });

  test("home entry allows solo helper if acquainted, but variant with unacquainted helper recruits 2 helpers", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_seeker", "Seeker Sam", "sf"),
        makeMember("m_h1", "Acquainted Friend", "sf"),
        makeMember("m_h2", "Stranger Bob", "sf"),
        makeMember("m_h3", "Stranger Carol", "sf"),
      ],
      facets: [
        { id: "f_h1", memberId: "m_h1", kind: "offer", value: "help moving boxes into apartment home", tags: ["moving", "apartment"], scope: "matchable", provenance: "said", confidence: 0.95 },
        { id: "f_h2", memberId: "m_h2", kind: "offer", value: "help moving boxes into apartment home", tags: ["moving", "apartment"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_h3", memberId: "m_h3", kind: "offer", value: "help moving boxes into apartment home", tags: ["moving", "apartment"], scope: "matchable", provenance: "said", confidence: 0.85 },
      ],
      intents: [
        {
          id: "int_home",
          memberId: "m_seeker",
          category: "help",
          objective: "need help moving boxes into apartment home",
          status: "active",
          horizonDays: 14,
          createdAt: now - DAY,
        },
      ],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h2", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h3", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [
        // m_seeker and m_h1 have met
        { from: "m_seeker", to: "m_h1", type: "met", strength: 1, explicit: true, createdAt: now - 10 * DAY },
      ],
      interactions: [],
      feedback: [],
      recentProposals: [],
      events: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = helpRequest(ctx);

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of candidates) {
      const helperIds = c.participants.filter(id => id !== "m_seeker");
      if (helperIds.length === 1) {
        // Solo helper MUST be the acquainted one (m_h1), never a stranger
        expect(helperIds[0]).toBe("m_h1");
        expect(c.format).toBe("one_to_one");
      } else {
        // Unacquainted helpers must have at least 2 helpers
        expect(helperIds.length).toBeGreaterThanOrEqual(2);
        expect(c.format).toBe("small_group");
      }
    }
  });

  test("canMeet enforces mutual availability across all helpers and seeker", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_seeker", "Seeker Sam", "sf"),
        makeMember("m_h1", "Helper One", "sf"),
        makeMember("m_h2", "Helper Two", "sf"),
        makeMember("m_h3", "Helper Three", "sf"),
      ],
      facets: [
        { id: "f_h1", memberId: "m_h1", kind: "offer", value: "yard work gardening outdoor tasks", tags: ["yard", "gardening"], scope: "matchable", provenance: "said", confidence: 0.95 },
        { id: "f_h2", memberId: "m_h2", kind: "offer", value: "yard work gardening outdoor tasks", tags: ["yard", "gardening"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_h3", memberId: "m_h3", kind: "offer", value: "yard work gardening outdoor tasks", tags: ["yard", "gardening"], scope: "matchable", provenance: "said", confidence: 0.85 },
      ],
      intents: [
        {
          id: "int_outdoor",
          memberId: "m_seeker",
          category: "help",
          objective: "need two helpers for yard work gardening outdoor tasks",
          status: "active",
          horizonDays: 14,
          createdAt: now - DAY,
        },
      ],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        // h1 is in SF, but travels to NYC on days 3-7
        { memberId: "m_h1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h1", city: "nyc", type: "temporary", areas: ["soho"], from: now + 3 * DAY, to: now + 7 * DAY },
        // h2 is in NYC on days 0-3, then in SF on days 3-7
        { memberId: "m_h2", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h2", city: "nyc", type: "temporary", areas: ["soho"], from: now, to: now + 3 * DAY },
        // h3 is in SF full time
        { memberId: "m_h3", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [],
      interactions: [],
      feedback: [],
      recentProposals: [],
      events: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    // Verify that h1 and h2 cannot meet together
    expect(w.canMeet(["m_seeker", "m_h1", "m_h2"])).toBe(false);
    // But h1 and h3 CAN meet together
    expect(w.canMeet(["m_seeker", "m_h1", "m_h3"])).toBe(true);

    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = helpRequest(ctx);

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      // Must be able to meet together
      expect(w.canMeet(c.participants)).toBe(true);
      const helpers = c.participants.filter(id => id !== "m_seeker");
      // Helpers cannot be h1 and h2 simultaneously because they have disjoint presence schedules
      expect(helpers.includes("m_h1") && helpers.includes("m_h2")).toBe(false);
    }
  });

  test("reliability holdout: members with 2+ unrecovered no-shows are excluded from multi-helper requests", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_seeker", "Seeker Sam", "sf"),
        makeMember("m_h1", "Helper Unreliable", "sf"),
        makeMember("m_h2", "Helper Group One", "sf"),
        makeMember("m_h3", "Helper Group Two", "sf"),
      ],
      facets: [
        { id: "f_h1", memberId: "m_h1", kind: "offer", value: "yard work heavy cleanup tasks", tags: ["yard", "cleanup"], scope: "matchable", provenance: "said", confidence: 0.95 },
        { id: "f_h2", memberId: "m_h2", kind: "offer", value: "yard work heavy cleanup tasks", tags: ["yard", "cleanup"], scope: "matchable", provenance: "said", confidence: 0.9 },
        { id: "f_h3", memberId: "m_h3", kind: "offer", value: "yard work heavy cleanup tasks", tags: ["yard", "cleanup"], scope: "matchable", provenance: "said", confidence: 0.85 },
      ],
      intents: [
        {
          id: "int_group_help",
          memberId: "m_seeker",
          category: "help",
          objective: "need two helpers for yard work heavy cleanup tasks",
          status: "active",
          horizonDays: 14,
          createdAt: now - DAY,
        },
      ],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h2", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h3", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [],
      interactions: [],
      feedback: [],
      reliability: {
        // m_h1 has 2 no-shows without recovery: blocked from format !== "one_to_one"
        m_h1: { noShows: 2, completedSinceLastNoShow: 0 },
      },
      recentProposals: [],
      events: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = helpRequest(ctx);

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.format).toBe("small_group");
      // m_h1 is on reliability holdout for small_group and must be excluded
      expect(c.participants).not.toContain("m_h1");
      expect(c.participants).toContain("m_h2");
      expect(c.participants).toContain("m_h3");
    }
  });

  test("alternates enforce presence overlap and solo home entry acquainted constraints", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_seeker", "Seeker Sam", "sf"),
        makeMember("m_h1", "Acquainted Friend", "sf"),
        makeMember("m_alt_stranger", "Stranger Alt", "sf"),
        makeMember("m_alt_acquainted", "Acquainted Alt", "sf"),
        makeMember("m_alt_no_overlap", "No Overlap Alt", "sf"),
      ],
      facets: [
        { id: "f_h1", memberId: "m_h1", kind: "offer", value: "help moving boxes into apartment home", tags: ["moving", "apartment"], scope: "matchable", provenance: "said", confidence: 0.95 },
        { id: "f_alt_acq", memberId: "m_alt_acquainted", kind: "offer", value: "help moving boxes into apartment home", tags: ["moving", "apartment"], scope: "matchable", provenance: "said", confidence: 0.90 },
        { id: "f_alt_stranger", memberId: "m_alt_stranger", kind: "offer", value: "help moving boxes into apartment home", tags: ["moving", "apartment"], scope: "matchable", provenance: "said", confidence: 0.85 },
        { id: "f_alt_no", memberId: "m_alt_no_overlap", kind: "offer", value: "help moving boxes into apartment home", tags: ["moving", "apartment"], scope: "matchable", provenance: "said", confidence: 0.80 },
      ],
      intents: [
        {
          id: "int_home",
          memberId: "m_seeker",
          category: "help",
          objective: "help moving boxes into apartment home",
          status: "active",
          horizonDays: 14,
          createdAt: now - DAY,
        },
      ],
      presence: [
        { memberId: "m_seeker", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_h1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_alt_stranger", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_alt_acquainted", city: "sf", type: "home", areas: ["mission"] },
        // m_alt_no_overlap is away in NYC during the entire window
        { memberId: "m_alt_no_overlap", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_alt_no_overlap", city: "nyc", type: "temporary", areas: ["soho"], from: now, to: now + 14 * DAY },
      ],
      edges: [
        // m_seeker has met m_h1 and m_alt_acquainted
        { from: "m_seeker", to: "m_h1", type: "met", strength: 1, explicit: true, createdAt: now - 10 * DAY },
        { from: "m_seeker", to: "m_alt_acquainted", type: "met", strength: 1, explicit: true, createdAt: now - 10 * DAY },
      ],
      interactions: [],
      feedback: [],
      recentProposals: [],
      events: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    const ctx = { w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() };
    const candidates = helpRequest(ctx);

    expect(candidates.length).toBeGreaterThan(0);
    // Find the solo candidate with acquainted helper m_h1
    const solo = candidates.find(c => c.participants.length === 2 && c.participants.includes("m_h1"));
    expect(solo).toBeDefined();
    // Alternates for solo home entry must NOT contain m_alt_stranger (stranger cannot solo enter home)
    expect(solo!.alternates).not.toContain("m_alt_stranger");
    // Alternates must NOT contain m_alt_no_overlap (no presence overlap with seeker)
    expect(solo!.alternates).not.toContain("m_alt_no_overlap");
    // Must contain m_alt_acquainted (acquainted and overlapping)
    expect(solo!.alternates).toContain("m_alt_acquainted");
  });
});
