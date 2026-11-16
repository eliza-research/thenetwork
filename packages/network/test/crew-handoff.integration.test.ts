// A crew is handed off after the sessions that were held, not after the sessions that were proposed
// (spec/models/plan_crew.md, handoffCountsSessions; network.ts "the Network hands the crew off after
// 3 sessions"). A session that review rejects does not count, and the crew keeps its weekly session.
import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini, START } from "./mini.ts";

test("rejected crew sessions do not count toward the hand-off", async () => {
  const venue = PLAN_VENUES.find(v => v.activities.includes("day_hike"))!;
  const ids = ["a", "b", "c"];
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: venue.area, interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find a hiking group", category: "hobby" as const }],
  })), { seed: 1, review: "human", plans: true, matchingEnabled: true });
  await w.onboard(...ids);
  const crew: plans.Crew = {
    id: "crew_handoff", activityId: "day_hike", venueId: venue.id, city: "nyc", members: ids, cadenceDays: 7,
    hostRotation: ids, sessions: [], handedOff: false, slot: { start: START + 3 * DAY + 2 * HOUR },
  };
  w.net.crews.push(crew);
  const crewSession = () => w.net.reviewQueue().find(q => w.net.exportState().opps.find(o => o.id === q.oppId)?.plan?.crewId === crew.id);

  const rejected: string[] = [];
  for (let k = 0; k < 3; k++) {
    expect(await w.runUntil(() => !!crewSession(), 10 * DAY), `session ${k + 1} proposed`).toBe(true);
    const q = crewSession()!;
    expect(w.net.review(q.oppId, "reject", { reviewer: "sim_staff" })).toBe(true);
    rejected.push(q.oppId);
  }
  expect(crew.sessions).toHaveLength(3);
  expect(w.log("crew_handoff")).toEqual([]);
  expect(crew.handedOff).toBe(false);
  // The crew still gets its next weekly session.
  expect(await w.runUntil(() => !!crewSession(), 10 * DAY)).toBe(true);
  expect(rejected).not.toContain(crewSession()!.oppId);
});
