import { expect, test } from "vitest";
import { DAY, HOUR, type Facet, type MemberId } from "@thenetwork/core";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, friendsPack, localEmbed, planFriendsWeek, resolveConfig, World, type EngineInput, type plans } from "@thenetwork/engine";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini, START } from "./mini.ts";

const TZ = "America/New_York";

test("friends: weekly standbys do not duplicate initial invitations", () => {
  const venue = PLAN_VENUES.find(v => v.activities.includes("coffee_crawl"));
  if (!venue) throw new Error("Missing curated coffee crawl venue");
  const climbing = { ...venue, id: "local-climbing", activities: ["bouldering"] };
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const mini = new Mini(ids.map(id => ({ id, name: id, age: 30, area: venue.area, interests: ["coffee", "climbing"] })));
  for (const id of ids) mini.facets.push({
    id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"],
    scope: "agent_private", provenance: "said", confidence: 1,
  });
  const world = new World({ ...mini.ctx().snapshot(), interactions: [
    { id: "earlier-activity", kind: "group", category: "social", participants: ids.slice(0, 4), at: START - 12 * DAY, outcome: "completed" },
    { id: "earlier-table", kind: "group", category: "social", participants: ids.slice(4), at: START - 12 * DAY, outcome: "completed" },
  ] }, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
  const start = Date.UTC(2026, 9, 10, 16);
  const windows = [{ start, end: start + 5 * HOUR }];
  const evidence = new Map(ids.map((id): [MemberId, plans.PlanEvidence] => [id, {
    memberId: id, tz: TZ, quietHours: [22, 8], stated: { windows, at: START, until: START + 7 * DAY },
  }]));
  const input = { now: START, tz: TZ, evidence, venues: [venue, climbing], crews: [], outcomes: [], offered: [] };
  const plan = (openTable: boolean, partnerIntros = DEFAULT_FRIENDS_POLICY.partnerIntros) => planFriendsWeek(world, input, {
    ...DEFAULT_FRIENDS_POLICY, crews: false, spreadNew: true, openTable, partnerIntros,
  }, FRIENDS_PLANS);

  const open = plan(true);
  const overflow = open.plans.flatMap(table => table.alternates);
  const partnerInvitees = open.partners.flatMap(pair => pair.invited);
  expect(overflow).toHaveLength(2);
  expect(partnerInvitees).toEqual(expect.arrayContaining(overflow));

  const closed = plan(false);
  expect(closed.plans.map(table => table.invited)).toEqual(open.plans.map(table => table.invited));
  expect(closed.partners.flatMap(pair => pair.invited)).toEqual(partnerInvitees);
  expect.soft(closed.plans.flatMap(table => table.alternates)).toEqual([]);
  expect(plan(false, 0).plans.flatMap(table => table.alternates)).toEqual(overflow);

  const outcome: plans.PlanOutcomeRecord = { planId: "previous-coffee", activityId: "coffee_crawl", venueId: venue.id,
    city: "nyc", at: start - 7 * DAY, attended: ["a", "b", "c", "g"], positive: ["a", "b", "c"], recurringWant: [] };
  const withRepeat = planFriendsWeek(world, { ...input, outcomes: [outcome] }, {
    ...DEFAULT_FRIENDS_POLICY, crews: false, spreadNew: true, openTable: true,
  }, FRIENDS_PLANS);
  expect(withRepeat.partners.flatMap(pair => pair.invited)).toContain("g");
  expect(withRepeat.repeats).toMatchObject([{ invited: ["a", "b", "c"], alternates: [] }]);
});

test("friends: a fitting triangle survives an unavailable or isolated seat candidate", () => {
  // spec/friendsWeek.md and spec/groupFormation.md: circles form among the members a table can seat.
  // d pairs best with a and b, so the triangle a-b-d is the strongest; c and d have a block between
  // them, so no circle holds all four. d has no window this week. Each member is in one circle per
  // run, so a circle that keeps d would hold a and b and leave a table of two.
  const venue = PLAN_VENUES.find(v => v.activities.includes("coffee_crawl"));
  if (!venue) throw new Error("Missing curated coffee crawl venue");
  const wide = ["coffee", "climbing"];
  const mini = new Mini([
    { id: "a", name: "Ana Diaz", age: 30, area: venue.area, interests: wide },
    { id: "b", name: "Ben Ito", age: 31, area: venue.area, interests: wide },
    { id: "c", name: "Cara Li", age: 29, area: venue.area, interests: ["coffee"] },
    { id: "d", name: "Dan Wu", age: 30, area: venue.area, interests: wide },
  ]);
  const ids: MemberId[] = ["a", "b", "c", "d"];
  for (const id of ids) mini.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 } satisfies Facet);
  const snapshot = JSON.parse(JSON.stringify(mini.ctx().snapshot())) as EngineInput;
  const input: EngineInput = { ...snapshot, edges: [{ from: "c", to: "d", type: "blocked", strength: 1, explicit: true, createdAt: START - DAY }] };
  const w = new World(input, resolveConfig({ seed: 1, cities: ["nyc"] }), localEmbed, friendsPack);

  // The coffee crawl fits the curated venue's weekend hours, 12:00-17:00 New York.
  const windows = [10, 11].map(day => {
    const start = Date.UTC(2026, 9, day, 16);
    return { start, end: start + 5 * HOUR };
  });
  const evidence = new Map<MemberId, plans.PlanEvidence>(["a", "b", "c"].map(id => [id, { memberId: id, tz: TZ, quietHours: [22, 8], stated: { windows, at: START, until: START + 7 * DAY } }]));
  // The production policy (network.ts friendsWeekPlans): alternates only as replacements.
  const week = planFriendsWeek(w, { now: START, tz: TZ, evidence, venues: [venue], crews: [], outcomes: [], offered: [] }, { ...DEFAULT_FRIENDS_POLICY, openTable: false }, FRIENDS_PLANS);

  expect(week.plans.some(p => ["a", "b", "c"].every(id => p.invited.includes(id)))).toBe(true);
  expect([...week.plans, ...week.partners].some(p => p.invited.includes("d") || p.alternates.includes("d"))).toBe(false);

  // With the strongest window, d seeds the first table but can have at most one compatible partner.
  // The search must still try a different seed among the available members.
  const available = new Map(evidence);
  available.set("d", { memberId: "d", tz: TZ, quietHours: [22, 8], stated: { windows, at: START, until: START + 7 * DAY, confidence: 1 } });
  for (const blocked of [["a", "b", "c"], ["a", "c"]]) {
    const isolated = new World({ ...input, edges: blocked.map(to => ({ from: "d", to, type: "blocked", strength: 1, explicit: true, createdAt: START - DAY })) },
      resolveConfig({ seed: 1, cities: ["nyc"] }), localEmbed, friendsPack);
    const retried = planFriendsWeek(isolated, { now: START, tz: TZ, evidence: available, venues: [venue], crews: [], outcomes: [], offered: [] },
      { ...DEFAULT_FRIENDS_POLICY, openTable: false }, FRIENDS_PLANS);
    expect(retried.plans).toMatchObject([{ invited: ["a", "b", "c"], alternates: [] }]);
  }
});

// spec/planFormation.md, "Alternates must fit the entire offered group"
test("friends: alternates need a Friend pair value with everyone before they can fill a seat", () => {
  const venue = PLAN_VENUES.find(v => v.activities.includes("coffee_crawl"));
  if (!venue) throw new Error("Missing curated coffee crawl venue");
  const wide = ["coffee", "climbing"];
  const samples = [
    { id: "a", name: "Ana Diaz", interests: wide },
    { id: "b", name: "Ben Ito", interests: wide },
    { id: "c", name: "Cara Li", interests: ["climbing"] },
    { id: "d", name: "Dan Wu", interests: wide },
    { id: "e", name: "Eve Lu", interests: ["coffee"] },
    { id: "f", name: "Felix Chen", interests: wide },
    { id: "g", name: "Grace Park", interests: wide },
  ];
  const mini = new Mini(samples.map(sample => ({ ...sample, age: 30, area: venue.area })));
  for (const { id } of samples) mini.facets.push({
    id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"],
    scope: "agent_private", provenance: "said", confidence: 1,
  });
  const snap = mini.ctx().snapshot();
  const cfg = resolveConfig({ seed: 1, cities: ["nyc"] });
  const policy = { ...DEFAULT_FRIENDS_POLICY, crews: false, openTable: false, partnerIntros: 0 };
  const run = (world: World, evidence: Map<MemberId, plans.PlanEvidence>, outcomes: plans.PlanOutcomeRecord[] = []) =>
    planFriendsWeek(world, { now: START, tz: TZ, evidence, venues: [venue], crews: [], outcomes, offered: [] }, policy, FRIENDS_PLANS);
  const block = (from: MemberId, to: MemberId) => ({ from, to, type: "blocked" as const, strength: 1, explicit: true, createdAt: START - DAY });

  const available = new Set(["a", "b", "c", "e"]);
  const newWorld = new World({ ...snap, members: snap.members.filter(m => available.has(m.id)),
    facets: snap.facets.filter(f => available.has(f.memberId)), presence: snap.presence.filter(p => available.has(p.memberId)),
    edges: [block("c", "e")],
  }, cfg, localEmbed, friendsPack);
  const windows = [10, 11].map(day => {
    const start = Date.UTC(2026, 9, day, 16);
    return { start, end: start + 5 * HOUR };
  });
  const evidence = new Map<MemberId, plans.PlanEvidence>([...available].map(id =>
    [id, { memberId: id, tz: TZ, quietHours: [22, 8], stated: { windows, at: START, until: START + 7 * DAY } }]));
  // c and e each fit a and b. Their block prevents them sharing the table or its alternate list.
  const newGroup = run(newWorld, evidence).plans;
  expect(newGroup).toHaveLength(1);
  expect(newGroup[0]!.invited).toHaveLength(3);
  expect(newGroup[0]!.invited).toEqual(expect.arrayContaining(["a", "b"]));
  expect(newGroup[0]!.invited.filter(id => id === "c" || id === "e")).toHaveLength(1);
  expect(newGroup[0]!.alternates).toEqual([]);

  const repeatWorld = new World({
    ...snap, facets: snap.facets.map(f => f.id === "b:verified" ? { ...f, tags: [...f.tags, "friends:max_travel:1"] } : f),
    edges: [block("c", "d"), block("c", "e"), block("f", "g")],
  }, cfg, localEmbed, friendsPack);
  const outcome: plans.PlanOutcomeRecord = { planId: "prior-table", activityId: "coffee_crawl", venueId: venue.id,
    city: "nyc", at: Date.UTC(2026, 9, 3, 16), attended: samples.map(({ id }) => id), positive: ["a", "b", "c"], recurringWant: [] };
  // b cannot make the trip. c's blocks exclude d and e, and the last block excludes g once f joins.
  const repeats = run(repeatWorld, new Map(), [outcome]).repeats;
  expect(repeats).toMatchObject([{ invited: ["a", "c", "f"], alternates: [] }]);
  expect(repeats).toEqual(run(repeatWorld, new Map(), [{ ...outcome, attended: ["a", "b", "c", "f"] }]).repeats);
});
