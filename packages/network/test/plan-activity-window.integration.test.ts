import { expect, test } from "vitest";
import { DAY, HOUR, type NetworkEvent } from "@thenetwork/core";
import { localEmbed, plans, resolveConfig, World } from "@thenetwork/engine";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini, START } from "./mini.ts";

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

  const event: NetworkEvent = { id: "guided-walk", title: "Ranger-guided hike", city: "nyc", category: "social", tags: ["hiking"], start, end: start + HOUR };
  const eventWorld = new World({ ...snapshot, events: [event] }, cfg, localEmbed);
  const published = plans.planProposals(eventWorld, { now: START, city: "nyc", tz, venues: [], evidence: makeEvidence(1, 1) });
  expect(published).toMatchObject([{ eventId: event.id, window: { start, end: event.end }, invited: expect.arrayContaining(ids) }]);
});
