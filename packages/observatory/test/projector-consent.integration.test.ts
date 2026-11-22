import { expect, test } from "vitest";
import type { RunRecordInput } from "@thenetwork/core";
import { Projector } from "../src/projector.ts";
import { evaluateMissions, scoreboard, scoreOpportunity } from "../src/scoring.ts";
import { emptyCounters, Store } from "../src/store.ts";

function simulatedOpportunity(participants: string[]) {
  const start = 1_760_000_000_000;
  const store = new Store({
    mode: "game", label: "Synthetic", dataset: "Synthetic",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false },
  }, { now: start, start, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const id of participants) {
    store.upsertMember({ id, name: id, city: "nyc", joined: true, minor: false, state: "normal", counters: emptyCounters() });
  }
  const projector = new Projector(store);
  let time = start;
  const apply = (record: RunRecordInput) => projector.apply({ ...record, t: ++time });
  const proposalId = "intro-1";
  apply({
    type: "proposal", source: "player",
    proposal: {
      id: proposalId, participants, kind: participants.length > 2 ? "group" : "intro", city: "nyc",
      alternates: [], objective: "Meet", score: 0, exploration: false, explanations: {}, generator: "player",
      createdAt: time, components: {
        fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
        interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
      },
    },
    oracle: { compatible: true, quality: 1, minEnjoyment: 1, flags: [], participants: {} },
  });
  for (const memberId of participants) {
    apply({ type: "message", msg: {
      id: `invite-${memberId}`, direction: "outbound", ts: time, memberId, body: "Want to meet?",
      status: "delivered", meta: { type: "proposal", proposalId },
    } });
  }
  const reply = (memberId: string, intent: string, messageType = "proposal") => apply({
    type: "decision", proposalId, memberId, messageId: `invite-${memberId}`, messageType, intent, decision: intent, delayMs: 0,
  });
  const book = (roster: string[]) => apply({
    type: "meeting_scheduled", proposalId, meetingId: "meeting-1", participants: roster, at: start + 86_400_000, city: "nyc",
  });
  const counts = () => ({
    total: store.counts.accepts, members: participants.map(id => store.member(id)!.counters.accepted),
  });
  return { store, opportunity: store.opps.get(proposalId)!, reply, book, counts };
}

test("a late addition to a scheduled group counts each confirmed member once", () => {
  const { store, opportunity, reply, book, counts } = simulatedOpportunity(["a", "b", "c", "d"]);
  for (const id of ["a", "b", "c"]) reply(id, "accept");
  book(["a", "b", "c"]);
  expect(counts()).toEqual({ total: 3, members: [1, 1, 1, 0] });

  book(["a", "b", "c", "d"]);
  book(["a", "b", "c", "d"]);

  expect(opportunity.status).toEqual({ a: "confirmed", b: "confirmed", c: "confirmed", d: "confirmed" });
  expect(store.counts.meetingsScheduled).toBe(1);
  expect(counts()).toEqual({ total: 4, members: [1, 1, 1, 1] });

  reply("b", "flake_notice", "reminder");
  book(["a", "b", "c", "d"]);
  expect(opportunity.status.b).toBe("cancelled_with_notice");
  expect(counts()).toEqual({ total: 4, members: [1, 1, 1, 1] });
});

test("a counteroffer earns no acceptance, points, mission, introduced edge or flake credit", () => {
  const { store, opportunity, reply, counts } = simulatedOpportunity(["a", "b"]);
  reply("a", "counter");
  reply("a", "flake_notice", "reminder");

  const scores = scoreboard(store.opps.values());
  const spark = evaluateMissions(store.opps.values(), {
    now: store.clock.now, start: store.clock.start, community: () => undefined, newcomer: () => false, scores,
  }).find(m => m.id === "first_spark");
  expect({
    status: opportunity.status.a, counts: counts(), points: scoreOpportunity(opportunity).points,
    scoredAcceptances: scores[0]!.accepted, spark: spark?.done,
  }).toEqual({ status: "countered", counts: { total: 0, members: [0, 0] }, points: 0, scoredAcceptances: 0, spark: false });

  reply("b", "accept");
  expect(opportunity.state).toBe("PARTIALLY_ACCEPTED");
  expect(store.edges.size).toBe(0);
  expect(counts()).toEqual({ total: 1, members: [0, 1] });

  reply("b", "counter");
  expect(opportunity.state).toBe("INVITING");
  expect(counts()).toEqual({ total: 0, members: [0, 0] });

  reply("a", "accept");
  reply("b", "accept");
  expect(opportunity.state).toBe("MUTUALLY_ACCEPTED");
  expect(store.edges.has("introduced:a|b")).toBe(true);
  expect(scoreOpportunity(opportunity).points).toBe(20);
  expect(counts()).toEqual({ total: 2, members: [1, 1] });
});
