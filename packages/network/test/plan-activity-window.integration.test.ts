import { expect, test } from "vitest";
import { DAY, fromLocal, HOUR, type NetworkEvent } from "@thenetwork/core";
import { localEmbed, plans, resolveConfig, World } from "@thenetwork/engine";
import { PLAN_VENUES, statedWindows } from "../src/plans.ts";
import { Mini, START } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test("a weekly check-in applies to the first remaining local occurrence across the clock change", async () => {
  // spec/planFormation.md, "The member's latest weekly answer takes precedence"
  const tz = "America/New_York";
  const first = (hour: number) => fromLocal(2026, 10, 26, hour, tz);
  const next = (hour: number) => fromLocal(2026, 11, 2, hour, tz);
  for (const answerHour of [20.5, 9, 23]) {
    const mini = new Mini([{ id: "a", name: "Ana", age: 30 }], {
      seed: 1, growth: false, matchingEnabled: false,
    });
    mini.clock.set(fromLocal(2026, 10, 25, 13, tz));
    await mini.onboard("a");
    await mini.say("a", "WEEKLY");
    expect(await mini.runUntil(() => mini.to("a").some(message => message.meta.checkIn), 10 * HOUR)).toBe(true);

    const now = first(answerHour);
    mini.clock.set(now);
    await mini.say("a", "I'm free Monday evening.");
    const recorded = mini.net.exportState().members.find(member => member.id === "a")?.stated;
    const nextWeek = { start: next(18), end: next(19) };
    expect(plans.planWindowMatchesStated(recorded, nextWeek, now)).toBe(answerHour !== 20.5);
    const laterOccurrence = answerHour === 23;
    expect(recorded).toEqual({
      at: now, until: now + 7 * DAY, windows: [laterOccurrence
        ? { start: next(17), end: next(22) }
        : { start: Math.max(now, first(17)), end: first(22) }],
    });
    const afterExpiry = { start: now + 7 * DAY, end: now + 7 * DAY + HOUR };
    expect(plans.planWindowMatchesStated(recorded, afterExpiry, now)).toBe(true);
  }
});

test.each([
  "Weekday evenings, excluding Friday.",
  "Weekday evenings, any day but Friday works.",
  "Weekday evenings, anytime but Friday works.",
])("a named exclusion in the weekly reply %j leaves that evening unavailable", async reply => {
  // spec/planFormation.md, "The member's latest weekly answer takes precedence"
  const tz = "America/New_York";
  const clockDay = (day: number, hour: number) => fromLocal(2026, 10, day, hour, tz);
  const mini = new Mini([{ id: "a", name: "Ana", age: 30 }], { growth: false, matchingEnabled: false });
  mini.clock.set(clockDay(25, 13));
  await mini.onboard("a");
  await mini.say("a", "WEEKLY");
  expect(await mini.runUntil(() => mini.to("a").some(message => message.meta.checkIn), 10 * HOUR)).toBe(true);

  const now = clockDay(26, 13);
  mini.clock.set(now);
  await mini.say("a", reply);
  const member = mini.net.exportState().members.find(member => member.id === "a");
  expect(member?.availability?.at(-1)?.tags).toEqual(["evening:Mon", "evening:Tue", "evening:Wed", "evening:Thu"]);
  const window = (day: number) => ({ start: clockDay(day, 18), end: clockDay(day, 19) });
  expect(plans.planWindowMatchesStated(member?.stated, window(29), now)).toBe(true);
  expect(plans.planWindowMatchesStated(member?.stated, window(30), now)).toBe(false);
  expect(mini.log("probe_answer")).toEqual([]);
  expect(mini.meetings).toEqual([]);
});

test("the generic planner checks availability through the end of a four-hour hike", () => {
  const venue = PLAN_VENUES.find(v => v.id === "inwood-hill");
  if (!venue) throw new Error("Missing the curated Inwood Hill Park venue");
  const ids = ["a", "b", "c", "d"];
  const mini = new Mini(ids.map(id => ({ id, name: id, age: 30, area: venue.area, interests: ["hiking"] })));
  const snapshot = mini.ctx().snapshot();
  const cfg = resolveConfig({ seed: 1, cities: ["nyc"] });
  const world = new World(snapshot, cfg, localEmbed);
  const tz = "America/New_York";
  const start = Date.UTC(2026, 9, 10, 14);
  const hike = { start, end: start + 4 * HOUR };
  const makeEvidence = (busyHour: number, hoursFree = 4) => new Map(ids.map((id): [string, plans.PlanEvidence] => [id, {
    memberId: id, tz, quietHours: [22, 8],
    stated: { windows: [{ start, end: start + hoursFree * HOUR }], at: START, until: START + 7 * DAY },
    ...(id === "a" ? { calendar: {
      observedAt: START, expiresAt: START + DAY, coverage: { start: START, end: START + 7 * DAY },
      busy: [{ start: start + busyHour * HOUR, end: start + (busyHour + 1) * HOUR }],
    } } : {}),
  }]));
  const run = (evidence: Map<string, plans.PlanEvidence>, busyAt?: plans.PlannerInput["busyAt"]) =>
    plans.planProposals(world, { now: START, city: "nyc", tz, venues: [venue], evidence, busyAt });

  expect(run(makeEvidence(4))).toMatchObject([{ activityId: "day_hike", window: hike, invited: expect.arrayContaining(ids) }]);
  expect(run(makeEvidence(3))).toEqual([]);
  expect(run(makeEvidence(4, 2))).toEqual([]);
  expect(run(makeEvidence(4), (id, slot) => id === "a" && slot.end > start + 3 * HOUR && slot.start < hike.end)).toEqual([]);

  // spec/planFormation.md, "A standing window applies to the whole activity"
  const makeStanding = (endHour: number) => new Map(ids.map((id): [string, plans.PlanEvidence] => [id, {
    memberId: id, tz, quietHours: [22, 8],
    standing: [{ byDay: [6], startHour: 10, endHour, source: "conversation", statedAt: START }],
  }]));
  expect(run(makeStanding(14))).toMatchObject([{ activityId: "day_hike", window: hike, invited: expect.arrayContaining(ids) }]);
  expect(run(makeStanding(12))).toEqual([]);

  const updatedWeek = makeStanding(14);
  for (const member of updatedWeek.values()) member.stated = { windows: [], at: START, until: START + 7 * DAY, confidence: 0.5 };
  expect(run(updatedWeek)).toEqual([]);
  for (const member of updatedWeek.values()) member.stated = { windows: [], at: START, until: start };
  expect(run(updatedWeek)).toMatchObject([{ activityId: "day_hike", window: hike, invited: expect.arrayContaining(ids) }]);

  const event: NetworkEvent = { id: "guided-walk", title: "Ranger-guided hike", city: "nyc", category: "social", tags: ["hiking"], start, end: start + HOUR };
  const eventWorld = new World({ ...snapshot, events: [event] }, cfg, localEmbed);
  const published = plans.planProposals(eventWorld, { now: START, city: "nyc", tz, venues: [], evidence: makeEvidence(1, 1) });
  expect(published).toMatchObject([{ eventId: event.id, window: { start, end: event.end }, invited: expect.arrayContaining(ids) }]);
});

test("the Network offers a public hike only to adults who can reach the reviewed venue within their travel limit", async () => {
  const local = ["a", "b", "c", "d"];
  const ids = [...local, "e"];
  const mini = new Mini(ids.map(id => ({ id, name: id, age: 30, area: id === "e" ? "St. George" : "Inwood", interests: ["hiking"] })),
    { inlineJudge: holdEveryItem.inline, plans: true, matchingEnabled: true });
  mini.members.find(member => member.id === "e")!.prefs.maxTravelMinutes = 15;
  await mini.onboard(...ids);
  const state = mini.net.exportState();
  const start = Date.UTC(2026, 9, 10, 14);
  const window = { start, end: start + 4 * HOUR };
  for (const member of state.members) member.stated = { windows: [window], at: START, until: START + 7 * DAY };
  mini.net.importState(state);

  await mini.run(HOUR);
  await mini.net.tick(mini.clock.now());
  const hike = mini.net.reviewQueue().find(item => item.origin === "planner");
  expect(hike?.proposal.participants.slice().sort()).toEqual(local);
  const plan = mini.net.exportState().opps.find(opp => opp.id === hike?.oppId)?.plan;
  expect(plan).toMatchObject({ venueId: "inwood-hill", window, alternates: [] });
  expect(mini.sent.some(message => message.meta.type === "plan_probe")).toBe(false);
});

// spec/planFormation.md, "A standing window applies to the whole activity": adjacent parts of a day
// that a member said they are free form one window, so a hike can start in one part and end in the next.
test("a member free for adjacent parts of Saturday can be offered a hike that crosses from one part into the next", async () => {
  const offeredHike = async (availability: string) => {
    const ids = ["a", "b", "c"];
    const mini = new Mini(ids.map(id => ({ id, name: id, age: 30, area: "Inwood", interests: ["hiking"] })),
      { inlineJudge: holdEveryItem.inline, growth: false, maxNewPerDay: 0, plansConfig: { minInvite: 3, size: { max: 3, target: 3 }, partnerPlans: false } });
    for (const id of ids) for (const text of ["Hi!", "I like hiking and parks.", availability, "Small groups are good."]) await mini.say(id, text);
    await mini.run(HOUR);
    await mini.net.tick(mini.clock.now());
    const item = mini.net.reviewQueue().find(review => review.origin === "planner");
    return item && mini.net.exportState().opps.find(opp => opp.id === item.oppId)?.plan;
  };

  // 14:00-18:00 New York starts in the afternoon (12-17) and ends in the evening (17-22).
  const start = Date.UTC(2026, 9, 10, 18);
  const crossing = { activityId: "day_hike", venueId: "inwood-hill", window: { start, end: start + 4 * HOUR } };
  expect(await offeredHike("Saturdays work for me.")).toMatchObject(crossing);
  expect(await offeredHike("Saturday afternoons and evenings work for me.")).toMatchObject(crossing);
  // Morning (7-12) and evening (17-22) are not adjacent: no window holds a four-hour hike.
  expect((await offeredHike("Saturday mornings and evenings work for me."))?.activityId).not.toBe("day_hike");

  // The weekly check-in answer joins adjacent parts the same way.
  const now = Date.UTC(2026, 9, 5, 17);
  expect(statedWindows(["afternoon:Sat", "evening:Sat"], now)?.windows).toEqual([{ start: Date.UTC(2026, 9, 10, 16), end: Date.UTC(2026, 9, 11, 2) }]);
  expect(statedWindows(["morning:Sat", "evening:Sat"], now)?.windows).toEqual([
    { start: Date.UTC(2026, 9, 10, 13), end: Date.UTC(2026, 9, 10, 16) },
    { start: Date.UTC(2026, 9, 10, 21), end: Date.UTC(2026, 9, 11, 2) },
  ]);
});
