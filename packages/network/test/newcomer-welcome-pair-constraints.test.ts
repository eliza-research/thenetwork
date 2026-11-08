import { describe, expect, test } from "bun:test";
import { DAY, HOUR, EngineRng as Rng, type Category, type Edge, type Facet, type Intent, type Member, type MemberId, type Presence } from "@thenetwork/core";
import { DEFAULT_CONFIG } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { newcomerWelcome } from "../../engine/src/packs/network/generators.ts";
import type { GenCtx } from "../../engine/src/genkit.ts";
import { World, pairKey } from "../../engine/src/world.ts";
import type { EngineInput } from "../../engine/src/types.ts";
import { Mini } from "./mini.ts";

function makeInput(overrides: Partial<EngineInput> = {}): EngineInput {
  const now = 1_000_000_000;
  return {
    now,
    members: [],
    facets: [],
    intents: [],
    presence: [],
    edges: [],
    recentProposals: [],
    ...overrides,
  };
}

function makeMember(id: MemberId, name: string, city: string = "nyc", daysJoined: number = 30, state: "normal" | "open" | "quiet" | "paused" = "normal"): Member {
  return {
    id,
    name,
    homeCity: city as any,
    state,
    joinedAt: 1_000_000_000 - daysJoined * DAY,
    age: 28,
    unansweredProactive: 0,
    prefs: {
      categoriesOptIn: ["social"],
      quietHours: [22, 8],
      romanceOptIn: false,
      formats: ["small_group", "one_to_one"],
      maxTravelMinutes: 60,
      onlyWhenAsked: false,
    },
  };
}

function makeFacet(id: string, memberId: MemberId, kind: Facet["kind"], value: string, tags: string[]): Facet {
  return {
    id,
    memberId,
    kind,
    value,
    tags,
    scope: "shareable",
    provenance: "said",
    confidence: 1.0,
  };
}

function makeEdge(from: MemberId, to: MemberId, type: Edge["type"], createdAt: number): Edge {
  return {
    from,
    to,
    type,
    strength: 1.0,
    explicit: true,
    createdAt,
  };
}

describe("newcomerWelcome pair constraints and schedule overlap", () => {
  test("excludes blocked host and selects clean host for newcomer welcome group", () => {
    const now = 1_000_000_000;
    // n is a newcomer (joined 3 days ago)
    const n = makeMember("n", "Newcomer", "nyc", 3);
    // h1, h2, p1, p2 joined 30 days ago (not newcomers)
    const h1 = makeMember("h1", "Host 1 Blocked", "nyc", 30);
    const h2 = makeMember("h2", "Host 2 Clean", "nyc", 30);
    const p1 = makeMember("p1", "Peer 1", "nyc", 30);
    const p2 = makeMember("p2", "Peer 2", "nyc", 30);

    const members = [n, h1, h2, p1, p2];

    const facets: Facet[] = [
      makeFacet("f-n", "n", "interest", "climbing", ["climbing"]),
      makeFacet("f-h1", "h1", "interest", "climbing", ["climbing"]),
      makeFacet("f-h1-host", "h1", "skill", "host", ["host"]),
      makeFacet("f-h2", "h2", "interest", "climbing", ["climbing"]),
      makeFacet("f-h2-host", "h2", "skill", "host", ["host"]),
      makeFacet("f-p1", "p1", "interest", "climbing", ["climbing"]),
      makeFacet("f-p2", "p2", "interest", "climbing", ["climbing"]),
    ];

    const presence: Presence[] = [
      { memberId: "n", city: "nyc", type: "home", areas: ["Greenpoint"] },
      { memberId: "h1", city: "nyc", type: "home", areas: ["Greenpoint"] },
      { memberId: "h2", city: "nyc", type: "home", areas: ["Greenpoint"] },
      { memberId: "p1", city: "nyc", type: "home", areas: ["Greenpoint"] },
      { memberId: "p2", city: "nyc", type: "home", areas: ["Greenpoint"] },
    ];

    // Edges: n has blocked h1
    const edges: Edge[] = [
      makeEdge("n", "h1", "blocked", now - 10 * DAY),
    ];

    const input = makeInput({ now, members, facets, presence, edges });
    const cfg = { ...DEFAULT_CONFIG, cities: ["nyc" as any] };
    const w = new World(input, cfg, localEmbed);

    expect(w.get("n")!.newcomer).toBe(true);
    expect(w.get("h1")!.newcomer).toBe(false);
    expect(w.get("h2")!.newcomer).toBe(false);
    expect(w.get("h1")!.isHost).toBe(true);
    expect(w.get("h2")!.isHost).toBe(true);
    expect(w.blocked.has(pairKey("n", "h1"))).toBe(true);

    const ctx: GenCtx = {
      w,
      memberExclusions: {},
      rng: new Rng(1),
      unmatchedIntents: new Set(),
    };

    const cands = newcomerWelcome(ctx);
    // Should successfully generate a newcomer welcome
    expect(cands.length).toBeGreaterThan(0);
    const welcome = cands[0]!;
    expect(welcome.participants).toContain("n");
    // Crucially: blocked host h1 must NEVER be in the group!
    expect(welcome.participants).not.toContain("h1");
    // Clean host h2 must be in the group
    expect(welcome.participants).toContain("h2");
    expect(welcome.roles["h2"]).toBe("host");
    expect(welcome.roles["n"]).toBe("newcomer");
  });

  test("excludes members with disjoint schedule from newcomer welcome pool", () => {
    const now = 1_000_000_000;
    const n = makeMember("n", "Newcomer", "nyc", 3);
    const h1 = makeMember("h1", "Host 1 No Schedule Overlap", "sf", 30);
    const h2 = makeMember("h2", "Host 2 Valid Overlap", "nyc", 30);
    const p1 = makeMember("p1", "Peer 1", "nyc", 30);
    const p2 = makeMember("p2", "Peer 2", "nyc", 30);

    const facets: Facet[] = [
      makeFacet("f-n", "n", "interest", "climbing", ["climbing"]),
      makeFacet("f-h1", "h1", "interest", "climbing", ["climbing"]),
      makeFacet("f-h1-host", "h1", "skill", "host", ["host"]),
      makeFacet("f-h2", "h2", "interest", "climbing", ["climbing"]),
      makeFacet("f-h2-host", "h2", "skill", "host", ["host"]),
      makeFacet("f-p1", "p1", "interest", "climbing", ["climbing"]),
      makeFacet("f-p2", "p2", "interest", "climbing", ["climbing"]),
    ];

    // Give n presence in nyc, but h1 presence only in sf (disjoint presence/schedule)
    const presence: Presence[] = [
      { memberId: "n", city: "nyc", type: "home", areas: ["Greenpoint"] },
      { memberId: "h1", city: "sf", type: "home", areas: ["Mission"] },
      { memberId: "h2", city: "nyc", type: "home", areas: ["Greenpoint"] },
      { memberId: "p1", city: "nyc", type: "home", areas: ["Greenpoint"] },
      { memberId: "p2", city: "nyc", type: "home", areas: ["Greenpoint"] },
    ];

    const input = makeInput({ now, members: [n, h1, h2, p1, p2], facets, presence, edges: [] });
    const cfg = { ...DEFAULT_CONFIG, cities: ["nyc" as any] };
    const w = new World(input, cfg, localEmbed);

    const ctx: GenCtx = {
      w,
      memberExclusions: {},
      rng: new Rng(1),
      unmatchedIntents: new Set(),
    };

    const cands = newcomerWelcome(ctx);
    expect(cands.length).toBeGreaterThan(0);
    const welcome = cands[0]!;
    expect(welcome.participants).toContain("n");
    expect(welcome.participants).not.toContain("h1");
    expect(welcome.participants).toContain("h2");
  });

  test("network local newcomer welcome respects blocked, avoid, and pair history constraints", () => {
    const mini = new Mini([
      { id: "newbie", name: "Newbie Doe", age: 28, area: "Greenpoint", interests: ["climbing"] },
      { id: "host_blocked", name: "Host Blocked", age: 32, area: "Greenpoint", interests: ["climbing"] },
      { id: "host_avoid", name: "Host Avoid", age: 34, area: "Greenpoint", interests: ["climbing"] },
      { id: "host_clean", name: "Host Clean", age: 35, area: "Greenpoint", interests: ["climbing"] },
    ]);

    const net = mini.net as any;
    const now = mini.clock.now();

    // Initialize member states in net.members
    const newbie = net.member("newbie");
    newbie.stage = "active";
    newbie.joinedAt = now - 3 * DAY;
    newbie.invitedBy = "inviter_someone";

    for (const hid of ["host_blocked", "host_avoid", "host_clean"]) {
      const h = net.member(hid);
      h.stage = "active";
      h.joinedAt = now - 15 * DAY;
      h.noShows = 0;
    }

    // Set blocks and avoid edges
    net.blocks.add(pairKey("newbie", "host_blocked"));
    net.avoid.add(pairKey("newbie", "host_avoid"));

    // Run localEncounters
    net.localEncounters(now);

    const opps = [...net.opps.values()];
    const welcomeOpp = opps.find((o: any) => o.kind === "newcomer_welcome");
    expect(welcomeOpp).toBeDefined();
    expect(welcomeOpp.participants).toContain("newbie");
    // Blocked and avoided hosts must NOT be chosen
    expect(welcomeOpp.participants).not.toContain("host_blocked");
    expect(welcomeOpp.participants).not.toContain("host_avoid");
    // Clean host must be chosen
    expect(welcomeOpp.participants).toContain("host_clean");
  });

  test("distinctAlternates excludes alternates with avoid relationships", () => {
    const mini = new Mini([
      { id: "p1", name: "Participant One", age: 30, area: "Greenpoint" },
      { id: "p2", name: "Participant Two", age: 30, area: "Greenpoint" },
      { id: "alt_avoid", name: "Alternate Avoid", age: 30, area: "Greenpoint" },
      { id: "alt_clean", name: "Alternate Clean", age: 30, area: "Greenpoint" },
    ]);

    const net = mini.net as any;
    net.member("p1");
    net.member("p2");
    net.member("alt_avoid");
    net.member("alt_clean");

    net.avoid.add(pairKey("p1", "alt_avoid"));

    const alternates = net.distinctAlternates(["p1", "p2"], ["alt_avoid", "alt_clean"]);
    expect(alternates).not.toContain("alt_avoid");
    expect(alternates).toContain("alt_clean");
  });

  test("checkRecipient rejects messages about others when recipient has avoid relationship with subject", () => {
    const mini = new Mini([
      { id: "alice", name: "Alice Smith", age: 30, area: "Greenpoint" },
      { id: "bob", name: "Bob Jones", age: 30, area: "Greenpoint" },
    ]);

    const net = mini.net as any;
    net.member("alice");
    net.member("bob");

    net.avoid.add(pairKey("alice", "bob"));

    const res = net.recipientPolicy("alice", "probe", { about: ["bob"] });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("blocked_pair");
  });
  test("distinctAlternates and checkRecipient respect snapshot avoid edges", async () => {
    const w = new Mini([
      { id: "a", name: "Alice Adams", age: 28, area: "Greenpoint", interests: ["coffee"] },
      { id: "b", name: "Bob Brown", age: 30, area: "Greenpoint", interests: ["coffee"] },
      { id: "c", name: "Charlie Clark", age: 29, area: "Greenpoint", interests: ["coffee"] },
      { id: "d", name: "David Davis", age: 31, area: "Greenpoint", interests: ["coffee"] },
    ]);
    await w.onboard("a", "b", "c", "d");

    // Add avoid edge between b and c in snapshot
    const snap = (w.net as any).snapshotCached();
    snap.edges.push({ from: "b", to: "c", type: "avoid", createdAt: 0 });

    // distinctAlternates with participants [a, b] and alternates [c, d]
    const alts = (w.net as any).distinctAlternates(["a", "b"], ["c", "d"]);
    // c has a snapshot avoid edge with b, so c must be excluded
    expect(alts).toEqual(["d"]);

    // checkRecipient: b recipient, message about c
    const res = (w.net as any).recipientPolicy("b", "probe", { about: ["c"] });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("blocked_pair");
  });
});
