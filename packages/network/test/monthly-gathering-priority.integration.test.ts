import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { rankGatheringInvitees } from "../service/monthly-gathering-rsvp.ts";
import type { NetworkState } from "../src/network.ts";
import { Mini } from "./mini.ts";

test("gathering priority uses current adult event consent and local participation evidence", async () => {
  const ids = ["a-known", "b-new", "c-isolated", "d-repeat", "e-repeat", "f-watch", "g-opt-out", "h-minor", "i-away"];
  const world = new Mini(ids.map(id => ({ id, name: `Person ${id}`, age: id === "h-minor" ? 17 : 30 })));
  await world.onboard(...ids);
  const now = world.clock.now();
  for (const member of world.members) member.joinedAt = now - (member.id === "b-new" ? 7 : 31) * DAY;
  world.members.find(member => member.id === "g-opt-out")!.prefs.categoriesOptIn = ["social"];
  world.members.find(member => member.id === "i-away")!.homeCity = "sf";
  const stored = world.net.exportState();
  const meeting = (id: string, participants: string[], at: number, stage: "done" | "scheduled"): NetworkState["opps"][number] => ({
    id, participants, createdAt: now - 6 * DAY, meetingAt: at, stage, origin: "engine", category: "social", kind: "intro",
    objective: "get coffee", detail: "coffee", alternates: [], primed: [], status: participants.map(participant => [participant, "yes"]),
    explanations: {}, deadline: now + DAY, score: 0, generator: "fixture", exploration: false, sameDay: false,
    components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
      interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
    contacted: participants, reminded: [], feedbackFrom: [], tags: [], replacements: 0,
  });
  const first = meeting("first-repeat-meeting", ["d-repeat", "e-repeat"], now - 2 * DAY, "done");
  stored.opps.push(first, meeting("known-upcoming", ["a-known", "g-opt-out"], now + DAY, "scheduled"));
  for (const [from, about] of [["d-repeat", "e-repeat"], ["e-repeat", "d-repeat"]] as const) stored.feedback.push({
    id: `repeat-${from}`, from, about, opportunityId: first.id, at: now - DAY, sentiment: "positive", repeatConsent: true,
  });
  stored.trust.push({ id: "f-watch", score: 3, level: "watch", events: [], reportsFrom: [], blocksMade: [] });
  world.net.importState(stored);

  const evidence = world.net.gatheringPriorityEvidence(now);
  expect(evidence).toEqual([
    { memberId: "a-known", eligible: true, newcomer: false, isolated: false, pendingSecondEncounter: false },
    { memberId: "b-new", eligible: true, newcomer: true, isolated: false, pendingSecondEncounter: false },
    { memberId: "c-isolated", eligible: true, newcomer: false, isolated: true, pendingSecondEncounter: false },
    { memberId: "d-repeat", eligible: true, newcomer: false, isolated: false, pendingSecondEncounter: true },
    { memberId: "e-repeat", eligible: true, newcomer: false, isolated: false, pendingSecondEncounter: true },
  ]);
  expect(rankGatheringInvitees(evidence)).toEqual(["b-new", "c-isolated", "d-repeat", "e-repeat", "a-known"]);
  stored.blocks.push("d-repeat|e-repeat");
  world.net.importState(stored);
  expect(world.net.gatheringPriorityEvidence(now).filter(row => row.pendingSecondEncounter)).toEqual([]);
});
