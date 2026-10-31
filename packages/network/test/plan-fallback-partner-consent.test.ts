import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";
import { planProposals } from "../../engine/src/plans.ts";
import { World } from "../../engine/src/world.ts";
import { networkPack } from "../../engine/src/packs/network/index.ts";
import { DEFAULT_PLANS, resolveConfig } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";

const climber = (id: string, name: string) => ({
  id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

describe("plan fallback partner consent and pair constraints", () => {
  test("a group plan that falls back to 2 yes-sayers submits a partner plan instead of booking directly", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { review: "auto" });
    await w.onboard("a", "b", "c");

    // Manually construct a group plan opportunity
    const now = w.clock.now();
    const plan = {
      id: "plan_test_group", city: "nyc" as const, activityId: "bouldering",
      place: { name: "Brooklyn Boulders", area: "Greenpoint" },
      window: { start: now + 2 * DAY, end: now + 2 * DAY + 2 * HOUR },
      invited: ["a", "b", "c"], alternates: [], partner: false,
      size: { min: 3, target: 3, max: 3 }, quorum: 3,
      probeDeadline: now + DAY, score: 0.8, u: { a: 0.8, b: 0.8, c: 0.8 }, familiar: {},
      createdAt: now, category: "social" as const,
    };
    (w.net as any).submitPlan(plan, now);

    const netAny = w.net as any;
    const opp = [...netAny.opps.values()].find((o: any) => o.plan?.id === "plan_test_group")!;
    expect(opp).toBeDefined();
    expect(opp.stage).toBe("probing");

    // "a" and "b" answer yes, "c" answers no
    opp.status.set("a", "yes");
    opp.status.set("b", "yes");
    opp.status.set("c", "no");
    opp.planRun.answers["a"] = "yes";
    opp.planRun.answers["b"] = "yes";
    opp.planRun.answers["c"] = "no";

    // Trigger planFallback
    netAny.planFallback(opp);

    // The original plan opportunity is closed with "plan did not come together"
    expect(opp.stage).toBe("closed");
    expect(opp.closedReason).toBe("plan did not come together");

    // No meeting was booked yet (the 2 members never gave 1:1 consent)
    expect(w.meetings.length).toBe(0);

    // A fresh partner plan opportunity was submitted!
    const partnerOpp = [...netAny.opps.values()].find((o: any) => o.plan?.partner === true && o.stage !== "closed");
    expect(partnerOpp).toBeDefined();
    expect(partnerOpp.plan.invited.sort()).toEqual(["a", "b"]);
    expect(partnerOpp.origin).toBe("planner");
    expect(partnerOpp.plan.quorum).toBe(2);
  });

  test("planFallback does not submit partnerPlan if the 2 yes-sayers have an avoid or block relationship", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { review: "auto" });
    await w.onboard("a", "b", "c");

    const now = w.clock.now();
    const netAny = w.net as any;

    const plan = {
      id: "plan_test_avoid", city: "nyc" as const, activityId: "bouldering",
      place: { name: "Brooklyn Boulders", area: "Greenpoint" },
      window: { start: now + 2 * DAY, end: now + 2 * DAY + 2 * HOUR },
      invited: ["a", "b", "c"], alternates: [], partner: false,
      size: { min: 3, target: 3, max: 3 }, quorum: 3,
      probeDeadline: now + DAY, score: 0.8, u: { a: 0.8, b: 0.8, c: 0.8 }, familiar: {},
      createdAt: now, category: "social" as const,
    };
    netAny.submitPlan(plan, now);
    const opp = [...netAny.opps.values()].find((o: any) => o.plan?.id === "plan_test_avoid")!;

    // Record an avoid relationship between a and b after plan started
    netAny.avoid.add(pairKey("a", "b"));

    opp.status.set("a", "yes");
    opp.status.set("b", "yes");
    opp.status.set("c", "no");
    opp.planRun.answers["a"] = "yes";
    opp.planRun.answers["b"] = "yes";
    opp.planRun.answers["c"] = "no";

    netAny.planFallback(opp);

    // Group plan is closed
    expect(opp.stage).toBe("closed");
    // No partner plan was submitted because they have an avoid relationship
    const partnerOpp = [...netAny.opps.values()].find((o: any) => o.plan?.partner === true && o.stage !== "closed");
    expect(partnerOpp).toBeUndefined();
    expect(w.meetings.length).toBe(0);
  });

  test("bookPlan refuses seating members who have an avoid relationship", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { review: "auto" });
    await w.onboard("a", "b", "c");

    const now = w.clock.now();
    const netAny = w.net as any;
    // Record an avoid relationship between a and b
    netAny.avoid.add(pairKey("a", "b"));

    const plan = {
      id: "plan_test_book", city: "nyc" as const, activityId: "bouldering",
      place: { name: "Brooklyn Boulders", area: "Greenpoint" },
      window: { start: now + 2 * DAY, end: now + 2 * DAY + 2 * HOUR },
      invited: ["a", "b", "c"], alternates: [], partner: false,
      size: { min: 2, target: 3, max: 3 }, quorum: 2,
      probeDeadline: now + DAY, score: 0.8, u: { a: 0.8, b: 0.8, c: 0.8 }, familiar: {},
      createdAt: now, category: "social" as const,
    };
    netAny.submitPlan(plan, now);
    const opp = [...netAny.opps.values()].find((o: any) => o.plan?.id === "plan_test_book")!;

    // Call bookPlan with [a, b]
    netAny.bookPlan(opp, ["a", "b"]);

    // "b" should have been refused seating because "a" was already seated and they have an avoid edge
    expect(opp.status.get("b")).toBe("unavailable");
  });

  test("planProposals deduplicates alternates across candidate plans and excludes already invited members", () => {
    const members = [];
    const presence = [];
    const facets = [];
    for (let i = 1; i <= 10; i++) {
      members.push({
        id: `m${i}`, name: `Member ${i}`, homeCity: "nyc" as const, state: "normal" as const, joinedAt: 0, age: 25, unansweredProactive: 0,
        prefs: { categoriesOptIn: ["social" as const, "hobby" as const], quietHours: [22, 8] as [number, number], romanceOptIn: false, formats: ["small_group" as const], maxTravelMinutes: 45, onlyWhenAsked: false },
      });
      presence.push({ memberId: `m${i}`, city: "nyc" as const, type: "home" as const, areas: ["Greenpoint"] });
      facets.push({ id: `m${i}:interest:climbing`, memberId: `m${i}`, kind: "interest" as const, value: "climbing", tags: ["climbing"], scope: "matchable" as const, provenance: "said" as const, confidence: 1, validFrom: 0, source: "chat" as const, observedAt: 0, inferred: false, confirmedByMember: true });
    }

    const world = new World({
      now: 100000, members, presence, facets, intents: [], edges: [], recentProposals: [],
    }, resolveConfig({ seed: 42 }), localEmbed, networkPack);

    const evidence = new Map<string, any>();
    for (let i = 1; i <= 10; i++) {
      evidence.set(`m${i}`, {
        tz: "America/New_York",
        standing: [{ byDay: [0, 1, 2, 3, 4, 5, 6], startHour: 10, endHour: 22 }],
      });
    }

    const plans = planProposals(world, {
      now: 100000, city: "nyc", tz: "America/New_York",
      evidence,
      venues: [{ id: "v1", name: "Boulders", city: "nyc", area: "Greenpoint", public: true, source: "curated", activities: ["bouldering"], ageMin: 18, priceTier: 1, hours: { weekday: [8, 23], weekend: [8, 23] } }],
    }, {
      ...DEFAULT_PLANS,
      minFit: 0.1, poolSize: 10, minMemberU: 0.1, threshold: 0.1, maxPlansPerCityRun: 5, alternates: 2,
    });

    // Check that across all generated plans, no member appears in more than one plan
    const allSeen = new Set<string>();
    for (const plan of plans) {
      for (const id of plan.invited) {
        expect(allSeen.has(id)).toBe(false);
        allSeen.add(id);
      }
      for (const alt of plan.alternates) {
        expect(allSeen.has(alt)).toBe(false);
        allSeen.add(alt);
      }
    }
  });

  test("distinctAlternates filters out alternates who have an avoid edge or recent history with participants", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")], { review: "auto" });
    await w.onboard("a", "b", "c", "d");

    const netAny = w.net as any;
    // Record avoid edge between participant a and alternate c
    netAny.avoid.add(pairKey("a", "c"));

    const distinct = netAny.distinctAlternates(["a", "b"], ["c", "d"]);
    // c should be excluded because of avoid edge with a
    expect(distinct).toEqual(["d"]);
  });

  test("approvalCheck invalidates opportunity review if participants have an avoid relationship", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");

    const netAny = w.net as any;
    // Record avoid edge between a and b
    netAny.avoid.add(pairKey("a", "b"));

    const o = netAny.newOpp({
      origin: "player", kind: "intro", category: "social", objective: "climb", detail: "climbing",
      participants: ["a", "b"], alternates: [], primed: [], explanations: {}, score: 0.8, generator: "player", tags: [],
    });

    const check = netAny.approvalCheck(o);
    expect(check).toBe("pair_history");
  });
});

