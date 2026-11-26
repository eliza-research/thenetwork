import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import { friendsPack, FRIENDS_PLANS, type plans } from "@thenetwork/engine";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini, START } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

async function crewFixture(handOffAfterSessions = 3, ids = ["a", "b", "c"]) {
  const venue = PLAN_VENUES.find(v => v.activities.includes("day_hike"))!;
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: venue.area, interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find a hiking group", category: "hobby" as const }],
  })), {
    app: "friends", pack: friendsPack, inlineJudge: holdEveryItem.inline, plans: true, matchingEnabled: true,
    plansConfig: { ...FRIENDS_PLANS, runDays: [], crews: { ...FRIENDS_PLANS.crews, handOffAfterSessions } },
  });
  w.verify(...ids);
  await w.onboard(...ids);
  const crew: plans.Crew = {
    id: "crew_handoff", activityId: "day_hike", venueId: venue.id, city: "nyc", members: ids, cadenceDays: 7,
    hostRotation: ids, sessions: [], handedOff: false, slot: { start: START + 3 * DAY + 2 * HOUR },
  };
  w.net.crews.push(crew);
  const session = () => w.net.reviewQueue().find(q => w.net.exportState().opps.find(o => o.id === q.oppId)?.plan?.crewId === crew.id);
  return { w, ids, crew, session };
}

test("a newly restricted seat does not keep an eligible crew from reaching review", async () => {
  const { w, crew, session } = await crewFixture(3, ["a", "b", "c", "d"]);
  w.edges.push({ from: "d", to: "a", type: "avoid", explicit: true, strength: 1, createdAt: w.clock.now() });
  expect(await w.runUntil(() => !!session(), 2 * DAY)).toBe(true);
  expect(session()!.proposal.participants).toEqual(["a", "b", "c"]);
  expect(crew.sessions).toHaveLength(1);
  expect(w.sent.some(message => message.meta.type === "plan_probe")).toBe(false);
});

test("a conflicting crew occurrence waits for a viable slot and still needs fresh review and replies", async () => {
  // spec/crewOffer.md, "A new recurring session needs a currently usable time"
  const { w, ids, crew, session } = await crewFixture();
  const blockedStart = crew.slot.start;
  w.presence.push({ memberId: "b", city: "sf", type: "temporary", areas: [], from: blockedStart - HOUR, to: blockedStart + 6 * HOUR });
  await w.run(HOUR);
  expect(session()).toBeUndefined();
  expect(crew.sessions).toEqual([]);
  expect(w.sent.some(message => message.meta.type === "plan_probe")).toBe(false);
  w.restart();

  expect(await w.runUntil(() => !!session(), 5 * DAY)).toBe(true);
  const queued = session()!;
  expect(queued.proposal).toMatchObject({ participants: ids, window: { start: blockedStart + 7 * DAY } });
  expect(w.sent.some(message => message.meta.type === "plan_probe")).toBe(false);
  expect(w.net.review(queued.oppId, "approve", { reviewer: "sim_staff", revision: queued.revision })).toBe(true);
  expect(await w.runUntil(() => ids.every(id => w.probed(id)), 2 * DAY)).toBe(true);
  for (const id of ids.slice(0, 2)) await w.say(id, "yes");
  expect(w.meetings).toEqual([]);
  await w.say(ids[2]!, "yes");
  expect(w.meetings).toMatchObject([{ proposalId: queued.oppId, participants: ids }]);
});

test("rejected, underfilled, and cancelled crew sessions do not count toward handoff", async () => {
  // spec/crewOffer.md, "Handoff counts booked sessions that reached feedback"
  const { w, ids, crew, session } = await crewFixture();
  expect(await w.runUntil(() => !!session(), 10 * DAY)).toBe(true);
  const rejected = session()!;
  expect(w.net.review(rejected.oppId, "reject", { reviewer: "sim_staff", revision: rejected.revision })).toBe(true);

  expect(await w.runUntil(() => !!session(), 10 * DAY)).toBe(true);
  const underfilled = session()!;
  expect(w.net.review(underfilled.oppId, "approve", { reviewer: "sim_staff", revision: underfilled.revision })).toBe(true);
  expect(await w.runUntil(() => ids.every(id => w.probed(id)), 2 * DAY)).toBe(true);
  for (const id of ids) await w.say(id, "no");

  expect(await w.runUntil(() => !!session(), 10 * DAY)).toBe(true);
  const cancelled = session()!;
  expect(w.net.review(cancelled.oppId, "approve", { reviewer: "sim_staff", revision: cancelled.revision })).toBe(true);
  expect(await w.runUntil(() => ids.every(id => w.probed(id)), 2 * DAY)).toBe(true);
  for (const id of ids) await w.say(id, "yes");
  expect(w.meetings).toMatchObject([{ proposalId: cancelled.oppId, participants: ids }]);
  await w.say("a", "No, I can't make it.");

  const failedIds = [rejected.oppId, underfilled.oppId, cancelled.oppId];
  expect(w.net.exportState().opps.filter(o => failedIds.includes(o.id)).map(o => o.stage)).toEqual(["closed", "closed", "closed"]);
  expect(crew.sessions).toHaveLength(3);
  expect(w.log("crew_handoff")).toEqual([]);
  expect(crew.handedOff).toBe(false);
  expect(await w.runUntil(() => !!session(), 10 * DAY)).toBe(true);
  expect(failedIds).not.toContain(session()!.oppId);
  expect(new Set(crew.sessions).size).toBe(4);
});

test("a crew hands off only once after its booked session reaches feedback", async () => {
  // spec/crewOffer.md, "Handoff counts booked sessions that reached feedback"
  const { w, ids, crew, session } = await crewFixture(1);
  expect(await w.runUntil(() => !!session(), 10 * DAY)).toBe(true);
  const q = session()!;
  expect(w.net.review(q.oppId, "approve", { reviewer: "sim_staff", revision: q.revision })).toBe(true);
  expect(await w.runUntil(() => ids.every(id => w.probed(id)), 2 * DAY)).toBe(true);
  for (const id of ids) await w.say(id, "yes");
  expect(w.meetings).toMatchObject([{ proposalId: q.oppId, participants: ids }]);
  expect(crew.handedOff).toBe(false);
  w.restart();
  expect(await w.runUntil(() => w.net.crews.find(c => c.id === crew.id)?.handedOff === true, 10 * DAY)).toBe(true);
  expect(w.net.exportState().opps.find(o => o.id === q.oppId)?.stage).toBe("done");
  await w.run(8 * DAY);
  expect(w.log("crew_handoff")).toHaveLength(1);
  expect(session()).toBeUndefined();
});
