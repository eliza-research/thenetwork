// Group composer host eligibility and role coverage enforcement (packages/engine/src/group.ts).
import { describe, expect, test } from "bun:test";
import { DAY, type Member } from "@thenetwork/core";
import { DEFAULT_CONFIG, localEmbed, World, type EngineInput } from "../../engine/src/index.ts";
import { composeGroup } from "../../engine/src/group.ts";

function makeMember(id: string, name: string, city: "sf" | "nyc", state: "normal" | "receiving" | "open" = "normal"): Member {
  return {
    id,
    name,
    homeCity: city,
    state,
    age: 28,
    joinedAt: Date.UTC(2026, 9, 1),
    prefs: {
      categoriesOptIn: ["social", "hobby", "professional"],
      formats: ["small_group", "one_to_one"],
      quietHours: [22, 8],
      romanceOptIn: false,
      maxTravelMinutes: 30,
      onlyWhenAsked: false,
    },
    unansweredProactive: 0,
  };
}

describe("group composer host eligibility gates", () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const cfg = { ...DEFAULT_CONFIG };

  test("member with isHost flag in receiving state cannot satisfy needHost in composeGroup", () => {
    // m_recv has host flag in facets (host tag or similar) but is in 'receiving' state (contributor role prohibited)
    const input: EngineInput = {
      members: [
        makeMember("m_guest1", "Guest 1", "sf", "normal"),
        makeMember("m_guest2", "Guest 2", "sf", "normal"),
        makeMember("m_recv", "Host Recv", "sf", "receiving"),
      ],
      facets: [
        { id: "f1", memberId: "m_guest1", kind: "interest", value: "board games", tags: ["boardgames"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f2", memberId: "m_guest2", kind: "interest", value: "board games", tags: ["boardgames"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f3", memberId: "m_recv", kind: "interest", value: "board games", tags: ["boardgames"], scope: "shareable", provenance: "said", confidence: 0.9 },
        // host skill/tag
        { id: "f_host", memberId: "m_recv", kind: "skill", value: "experienced dinner host and meetup organizer", tags: ["host"], scope: "shareable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m_guest1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_guest2", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_recv", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [],
      interactions: [],
      feedback: [],
      recentProposals: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    expect(w.get("m_recv")!.isHost).toBe(true);

    const pool = [
      { id: "m_guest1", affinity: 0.8 },
      { id: "m_guest2", affinity: 0.8 },
      { id: "m_recv", affinity: 0.8 },
    ];

    const g = composeGroup(w, {
      pool,
      category: "social",
      minSize: 3,
      maxSize: 3,
      window: { start: now, end: now + 7 * DAY },
      preferredCity: "sf",
      requireCity: true,
      needHost: true,
      beamWidth: 4,
      minPairwise: -1,
      alternates: 0,
    });

    // Since m_recv cannot host due to receiving state, needHost cannot be satisfied
    expect(g).toBeNull();
  });

  test("composeGroup with needHost selects eligible host over receiving-state member and assigns host role", () => {
    const input: EngineInput = {
      members: [
        makeMember("m_guest1", "Guest 1", "sf", "normal"),
        makeMember("m_guest2", "Guest 2", "sf", "normal"),
        makeMember("m_recv", "Host Recv", "sf", "receiving"),
        makeMember("m_valid_host", "Valid Host", "sf", "normal"),
      ],
      facets: [
        { id: "f1", memberId: "m_guest1", kind: "interest", value: "board games", tags: ["boardgames"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f2", memberId: "m_guest2", kind: "interest", value: "board games", tags: ["boardgames"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f3", memberId: "m_recv", kind: "interest", value: "board games", tags: ["boardgames"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f_recv_host", memberId: "m_recv", kind: "skill", value: "dinner host", tags: ["host"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f4", memberId: "m_valid_host", kind: "interest", value: "board games", tags: ["boardgames"], scope: "shareable", provenance: "said", confidence: 0.9 },
        { id: "f_valid_host", memberId: "m_valid_host", kind: "skill", value: "experienced community host", tags: ["host"], scope: "shareable", provenance: "said", confidence: 0.9 },
      ],
      intents: [],
      presence: [
        { memberId: "m_guest1", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_guest2", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_recv", city: "sf", type: "home", areas: ["mission"] },
        { memberId: "m_valid_host", city: "sf", type: "home", areas: ["mission"] },
      ],
      edges: [],
      interactions: [],
      feedback: [],
      recentProposals: [],
      now,
    };

    const w = new World(input, cfg, localEmbed);
    expect(w.get("m_recv")!.isHost).toBe(true);
    expect(w.get("m_valid_host")!.isHost).toBe(true);

    const pool = [
      { id: "m_guest1", affinity: 0.8 },
      { id: "m_guest2", affinity: 0.8 },
      { id: "m_recv", affinity: 0.9 }, // higher affinity but ineligible to host
      { id: "m_valid_host", affinity: 0.7 },
    ];

    const g = composeGroup(w, {
      pool,
      category: "social",
      minSize: 3,
      maxSize: 3,
      window: { start: now, end: now + 7 * DAY },
      preferredCity: "sf",
      requireCity: true,
      needHost: true,
      beamWidth: 4,
      minPairwise: -1,
      alternates: 0,
    });

    expect(g).not.toBeNull();
    expect(g!.primary).toContain("m_valid_host");
    expect(g!.roles["m_valid_host"]).toBe("host");
    expect(Object.values(g!.roles)).toContain("host");
  });
});
