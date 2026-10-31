import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

describe("plans, crews, and organizing reach pair constraints", () => {
  test("crewSessions filters out blocked and avoided members so no blocked pair is invited together", async () => {
    const specs = [
      { id: "h", name: "Host Member", age: 30, area: "Williamsburg", interests: ["coffee"] },
      { id: "m1", name: "Member One", age: 28, area: "Williamsburg", interests: ["coffee"] },
      { id: "m2", name: "Member Two", age: 29, area: "Williamsburg", interests: ["coffee"] },
      { id: "m3", name: "Member Three", age: 31, area: "Williamsburg", interests: ["coffee"] },
    ];
    const mini = new Mini(specs, { review: "human", plans: true, matchingEnabled: true });
    for (const s of specs) await mini.onboard(s.id);

    // Setup an existing crew with 4 members
    const st = mini.net.exportState();
    st.plans = {
      crews: [{
        id: "crew_coffee",
        activityId: "bouldering",
        city: "nyc",
        members: ["h", "m1", "m2", "m3"],
        cadenceDays: 7,
        hostRotation: ["h", "m1"],
        sessions: [],
        handedOff: false,
        slot: { start: mini.clock.now() + 2 * DAY },
      }],
      crewOffers: [],
      carry: [],
      lastPlannedAt: [],
      lastRunDay: "",
      again: [],
      counters: { ...mini.net["plansCounters"] },
    };
    // Add a block between m2 and m3
    st.blocks.push("m2|m3");
    mini.net.importState(st);

    // Trigger crew sessions
    const now = mini.clock.now();
    (mini.net as any).crewSessions(now);

    const opps = (mini.net as any).openOpps();
    const crewOpp = opps.find((o: any) => o.plan?.crewId === "crew_coffee");
    expect(crewOpp).toBeDefined();

    const invited = crewOpp!.plan!.invited;
    // Both m2 and m3 must not be together in the invited list
    expect(invited.includes("m2") && invited.includes("m3")).toBe(false);
    // Crew should have formed with the remaining compatible members
    expect(invited.length).toBeGreaterThanOrEqual(3);
    expect(invited).toContain("h");

    // approvalCheck must pass (not invalidated by blocked_pair)
    const reason = (mini.net as any).approvalCheck(crewOpp!);
    expect(reason).toBeUndefined();
  });

  test("withReach does not add mutually blocked or avoided candidates together", async () => {
    const specs = [
      { id: "host", name: "Host Person", age: 35, area: "Williamsburg", interests: ["climbing"] },
      { id: "p1", name: "Partner One", age: 32, area: "Williamsburg", interests: ["climbing"] },
      { id: "c1", name: "Candidate One", age: 30, area: "Williamsburg", interests: ["climbing"] },
      { id: "c2", name: "Candidate Two", age: 29, area: "Williamsburg", interests: ["climbing"] },
    ];
    // Mock capital organizing reach that provides 2 extra reach slots
    const mockCapital = {
      organizingReach: (_host: string, _now: number) => ({
        max: 4,
        reservedForLowExposure: 2,
      }),
    };

    const mini = new Mini(specs, { review: "human", plans: true, matchingEnabled: true, capital: mockCapital as any });
    for (const s of specs) await mini.onboard(s.id);

    // Mark c1 and c2 as mutual avoid (e.g. from negative feedback)
    const st = mini.net.exportState();
    st.avoid.push("c1|c2");
    mini.net.importState(st);

    const now = mini.clock.now();
    const basePlan = {
      id: "plan_test",
      city: "nyc" as const,
      activityId: "bouldering",
      place: { name: "Test Venue", area: "Williamsburg" },
      window: { start: now + 2 * DAY, end: now + 2 * DAY + 2 * HOUR },
      invited: ["host", "p1"],
      alternates: [],
      hostId: "host",
      partner: false,
      size: { min: 3, target: 2, max: 4 },
      quorum: 2,
      probeDeadline: now + DAY,
      score: 0.8,
      u: {},
      familiar: {},
      createdAt: now,
      category: "social" as const,
    };

    const expanded = (mini.net as any).withReach(basePlan, now);
    // Both c1 and c2 must not be added together
    expect(expanded.invited.includes("c1") && expanded.invited.includes("c2")).toBe(false);
  });

  test("approvalCheck invalidates planner opportunities containing an avoid pair", async () => {
    const specs = [
      { id: "a", name: "Member A", age: 25, area: "Williamsburg", interests: ["coffee"] },
      { id: "b", name: "Member B", age: 26, area: "Williamsburg", interests: ["coffee"] },
      { id: "c", name: "Member C", age: 27, area: "Williamsburg", interests: ["coffee"] },
    ];
    const mini = new Mini(specs, { review: "human" });
    for (const s of specs) await mini.onboard(s.id);

    const st = mini.net.exportState();
    st.avoid.push("a|b");
    mini.net.importState(st);

    const opp = (mini.net as any).newOpp({
      origin: "planner",
      kind: "intro",
      category: "social",
      objective: "coffee",
      detail: "coffee meetup",
      participants: ["a", "b", "c"],
      alternates: [],
      primed: [],
      explanations: {},
      score: 0.7,
      generator: "plan",
      tags: ["coffee"],
    });

    const check = (mini.net as any).approvalCheck(opp);
    expect(check).toBe("pair_history");
  });
});
