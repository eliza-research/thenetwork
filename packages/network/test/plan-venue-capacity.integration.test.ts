import { expect, test } from "vitest";
import { DAY, type Facet } from "@thenetwork/core";
import { World } from "../../engine/src/world.ts";
import { resolveConfig } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { planProposals, type PlanEvidence, type Venue } from "../../engine/src/plans.ts";
import type { EngineInput } from "../../engine/src/types.ts";

test("planned groups and partner fallbacks fit their public venue capacity", () => {
  for (const seed of [1, 2, 3]) for (const activity of [{ id: "board_game_cafe", tag: "board_games", min: 3 }, { id: "tennis", tag: "tennis", min: 2 }]) for (const capacity of [0, 1, 2, 3, 4, 6, undefined]) {
    const now = Date.UTC(2026, 9, 12, 13), ids = ["a", "b", "c", "d", "e", "f"];
    const input: EngineInput = { now, members: [], facets: [], intents: [], presence: [], edges: [], recentProposals: [] };
    for (const id of ids) {
      input.members.push({ id, name: id, age: 30, homeCity: "nyc", state: "normal", joinedAt: now - 40 * DAY, unansweredProactive: 0,
        prefs: { categoriesOptIn: ["social"], quietHours: [22, 8], romanceOptIn: false, formats: ["small_group", "one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false } });
      input.presence.push({ memberId: id, city: "nyc", type: "home", areas: ["manhattan"] });
      input.facets.push({ id: `${id}-interest`, memberId: id, kind: "interest", value: `I enjoy ${activity.tag}`, tags: [activity.tag], scope: "shareable", confidence: 1, provenance: "said" });
    }
    const w = new World(input, resolveConfig({ seed }), localEmbed);
    const evidence = new Map<string, PlanEvidence>(ids.map(memberId => [memberId, { memberId, tz: "America/New_York", quietHours: [22, 8],
      standing: [{ byDay: [0, 1, 2, 3, 4, 5, 6], startHour: 17, endHour: 22, source: "conversation", statedAt: now }] }]));
    const venue: Venue = { id: "small-cafe", city: "nyc", area: "manhattan", name: "Synthetic public venue", activities: [activity.id], priceTier: 1, ageMin: 18,
      hours: { weekday: [9, 23], weekend: [9, 23] }, public: true, source: "curated", ...(capacity === undefined ? {} : { capacity }) };
    const plans = planProposals(w, { now, city: "nyc", tz: "America/New_York", evidence, venues: [venue] });
    if (capacity !== undefined && capacity < activity.min) {
      expect(plans).toHaveLength(0);
      const larger = { ...venue, id: "z-large-cafe", capacity: 6 };
      const viable = planProposals(w, { now, city: "nyc", tz: "America/New_York", evidence, venues: [venue, larger] });
      expect(viable.length).toBeGreaterThan(0);
      expect(viable.every(p => p.venueId === larger.id)).toBe(true);
    }
    else {
      expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) {
        expect(p.venueId).toBe(venue.id);
        expect(p.invited.length).toBeLessThanOrEqual(capacity ?? 6);
        expect(p.size.max).toBeLessThanOrEqual(capacity ?? 6);
      }
    }
  }
});

test("plans find a compatible group among the members available at the slot", () => {
  // spec/planFormation.md, "Check pairs inside the available slot pool"
  const now = Date.UTC(2026, 9, 12, 15), tz = "America/New_York", area = "Greenpoint";
  const ids = Array.from({ length: 24 }, (_, i) => `runner-${String(i).padStart(2, "0")}`);
  // The rest of the city has equivalent tastes and ranks earlier in the discovery lists.
  const available = ids.slice(-4);
  const facets: [Facet["kind"], string, string[]][] = [
    ["goal", "find a running partner", ["lane:Friend", "running"]],
    ["interest", "running", ["running"]],
    ["offer", "run with someone", ["running"]],
  ];
  const input: EngineInput = {
    now, intents: [], edges: [], recentProposals: [],
    members: ids.map(id => ({
      id, name: id, age: 30, homeCity: "nyc", state: "normal", apps: ["ntwrk"], joinedAt: now - 100 * DAY, unansweredProactive: 0,
      prefs: { categoriesOptIn: ["social"], quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one", "small_group"], maxTravelMinutes: 45, onlyWhenAsked: false },
    })),
    facets: ids.flatMap(memberId => facets.map(([kind, value, tags]) => ({
      id: `${memberId}/${kind}`, memberId, kind, value, tags, scope: "shareable", provenance: "said", confidence: 1, app: "ntwrk",
    }))),
    presence: ids.map(memberId => ({ memberId, city: "nyc", type: "home", areas: [area] })),
  };
  const evidence = new Map<string, PlanEvidence>(available.map(memberId => [memberId, {
    memberId, tz, stated: { at: now, until: now + 8 * DAY, windows: [{ start: now, end: now + 8 * DAY }] },
  }]));
  const venue: Venue = { id: "public-park", name: "Public park", area, city: "nyc", public: true, ageMin: 18, capacity: 6,
    priceTier: 0, activities: ["group_run"], hours: { weekday: [9, 22], weekend: [9, 22] }, source: "curated" };
  const run = (snapshot: EngineInput) => planProposals(new World(snapshot, resolveConfig({}), localEmbed),
    { now, city: "nyc", tz, evidence, venues: [venue] });
  expect(run(input)).toMatchObject([{ activityId: "group_run", invited: expect.arrayContaining(available), quorum: 3, partner: false }]);

  const [from, to] = available;
  const blocked = run({ ...input, edges: [{ from, to, type: "blocked", strength: 1, explicit: true, createdAt: now }] });
  expect(blocked.every(plan => ![...plan.invited, ...plan.alternates].includes(from) ||
    ![...plan.invited, ...plan.alternates].includes(to))).toBe(true);
  expect(blocked.some(plan => !plan.partner)).toBe(false);

  // spec/networkIntentLane.md, "One request can open one lane"
  const withWorkGoal = { ...input, intents: [{
    id: "independent-work-goal", memberId: from, app: "ntwrk", category: "professional", status: "active",
    objective: "Meet founders working on climate and hardware and get advice on AI", createdAt: now - DAY, horizonDays: 7,
  }] } satisfies EngineInput;
  expect(run(withWorkGoal)).toMatchObject([{ activityId: "group_run", invited: expect.arrayContaining(available), partner: false }]);

  const technologyMeetup = { ...venue, activities: ["tech_meetup"] };
  const hobbyGoals = available.map(memberId => ({
    id: `hardware-hobby-${memberId}`, memberId, app: "ntwrk", category: "hobby", status: "active",
    objective: "Meet people who build hardware projects as a hobby", createdAt: now - DAY, horizonDays: 7,
  } satisfies EngineInput["intents"][number]));
  const runTechMeetup = (intents: EngineInput["intents"]) =>
    planProposals(new World({ ...input, facets: [], intents }, resolveConfig({}), localEmbed),
      { now, city: "nyc", tz, evidence, venues: [technologyMeetup] });
  expect(runTechMeetup(hobbyGoals))
    .toMatchObject([{ activityId: "tech_meetup", invited: expect.arrayContaining(available), partner: false }]);
  expect(runTechMeetup(hobbyGoals.map(goal => ({ ...goal, category: "professional" })))).toEqual([]);
});
