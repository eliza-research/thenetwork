// Game mode: a booked group plan's late joiner must show in the opportunity detail.
// spec/planDecision.md, "After booking, acceptances can add a member up to and including the
// late-join cutoff." The Network records the late joiner on the meeting (planJoin), but the
// booking already recorded the proposal with only the seated roster, so the projector's detail
// roster drops the joiner: the title counts the seated members, People has no row for them,
// while the meeting (and its History line) names them.
import { expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { Mini } from "../../../packages/network/test/mini.ts";
import { Projector } from "../src/projector.ts";
import { emptyCounters, Store } from "../src/store.ts";

test("a booked plan's late joiner shows in the opportunity detail roster", async () => {
  const invited = ["a", "b", "c", "d"];
  const world = new Mini(invited.map(id => ({ id, name: id, age: 30, area: "Inwood", interests: ["hiking"] })), { review: "human" });
  await world.onboard(...invited);
  const now = world.clock.now();
  const startsAt = Date.UTC(2026, 9, 10, 14);
  const window = { start: startsAt, end: startsAt + 4 * HOUR };
  const plan: plans.Plan = {
    id: "observatory-late-joiner", city: "nyc", activityId: "day_hike", venueId: "inwood-hill",
    place: { name: "Inwood Hill Park", area: "Inwood" }, window, invited, alternates: [],
    partner: false, size: { min: 3, target: 4, max: 4 }, quorum: 3, probeDeadline: startsAt - 30 * HOUR,
    score: 0.8, u: {}, familiar: {}, createdAt: now, category: "social",
  };
  const snapshot = world.net.exportState();
  for (const member of snapshot.members) member.stated = { windows: [window], at: now, until: now + 7 * DAY };
  world.net.importState(snapshot);
  (world.net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
  const { oppId } = world.net.reviewQueue()[0]!;
  expect(world.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await world.runUntil(() => invited.every(id => world.probed(id)), DAY)).toBe(true);

  const store = new Store({
    mode: "game", label: "Synthetic", dataset: "Synthetic",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false },
  }, { now, start: now, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const id of invited) {
    store.upsertMember({ id, name: id, city: "nyc", joined: true, minor: false, state: "normal", counters: emptyCounters() });
  }
  const projector = new Projector(store);
  let consumedLogs = 0, consumedProposals = 0, consumedMeetings = 0;
  const refreshLogs = () => {
    for (const record of world.logs.slice(consumedLogs)) projector.apply({ ...record, type: "network_log" });
    consumedLogs = world.logs.length;
  };
  const refreshProposals = () => {
    for (const p of world.proposals.slice(consumedProposals)) {
      projector.apply({
        t: p.t, type: "proposal", source: p.source as "network", proposal: p.proposal,
        oracle: { compatible: true, quality: 1, minEnjoyment: 1, flags: [], participants: {} },
      });
    }
    consumedProposals = world.proposals.length;
  };
  const refreshMeetings = () => {
    for (const m of world.meetings.slice(consumedMeetings)) {
      projector.apply({
        t: world.clock.now(), type: "meeting_scheduled", meetingId: `mt${consumedMeetings + 1}`,
        proposalId: m.proposalId, participants: m.participants, at: m.at, city: "nyc",
      });
      consumedMeetings++;
    }
  };
  const detail = () => store.opps.get(oppId)!;

  for (const id of ["a", "b", "c"]) await world.say(id, "yes");
  expect(world.meetings).toMatchObject([{ proposalId: oppId, participants: ["a", "b", "c"], at: startsAt }]);
  expect(world.net.exportState().opps.find(o => o.id === oppId)?.stage).toBe("scheduled");
  refreshLogs();
  refreshProposals();
  refreshMeetings();
  // The booking recorded the seated roster: the detail counts three members and d is out.
  expect(detail().state).toBe("SCHEDULED");
  expect(detail().participants).toEqual(["a", "b", "c"]);
  // d was counted at approval (they were invited); the counter still credits them.
  expect(store.member("d")!.counters.proposals).toBe(1);

  await world.say("d", "yes");
  expect(world.meetings).toMatchObject([
    { proposalId: oppId, participants: ["a", "b", "c"], at: startsAt },
    { proposalId: oppId, participants: ["d"], at: startsAt },
  ]);
  expect(world.net.exportState().opps.find(o => o.id === oppId)?.stage).toBe("scheduled");
  refreshLogs();
  refreshMeetings();
  // The late joiner is confirmed for the meeting: the projector knows it (status) ...
  expect(detail().status.d).toBe("confirmed");
  // ... so the detail roster must name them too: title count and People rows agree with the meeting.
  expect(detail().participants).toEqual(["a", "b", "c", "d"]);
  // No double count: d was already credited at approval; the late join adds the row, not a second credit.
  expect(store.member("d")!.counters.proposals).toBe(1);
});
