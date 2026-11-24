// R21-TA: the opportunity detail's People "busy" mark must agree with the
// Network's own busy rule (source level; the DOM level is
// opp-detail-people-busy.test.tsx).
//
// The Network's busy() (packages/network/src/network.ts) counts only ACTIVE
// participants of another open opportunity: a member whose status there is
// "unavailable", "no" or "dropped" (activeOpportunityParticipant) is not
// busy. The console's isBusyElsewhere (web/review.tsx) and store.busy()
// (web/store.ts) ignore status entirely: any participant of any other open
// opportunity reads as busy, even when the same People section shows that
// member already left that opportunity.
//
// Correct: a member who declined a group opportunity, said no to its probe,
// or called off its booked plan is not busy because of it. A member who
// accepted, never answered (dropped at booking: the Network still counts
// them, their status there is queued/probing, not "dropped"), or is still
// pending stays busy. A member whose only other opportunity closed is not
// busy either.
// Reachability: every state below is produced by the real Projector from
// real records (proposal / decision / probe_answer / meeting_scheduled /
// booked-notice message), not hand-built.
import { afterAll, expect, test } from "vitest";
import { Window } from "happy-dom";
import { installDom } from "./dom.ts";
import { Projector } from "../src/projector.ts";
import { emptyCounters, Store } from "../src/store.ts";
import type { RunRecordInput } from "@thenetwork/core";

const START = 1_760_000_000_000;
const window = new Window({ url: "http://127.0.0.1/" });
const restoreDom = installDom(window, {
  window, document: window.document, navigator: window.navigator,
  location: window.location, history: window.history,
  localStorage: window.localStorage, sessionStorage: window.sessionStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
afterAll(() => restoreDom());
const { store } = await import("../web/store.ts");
const { isBusyElsewhere } = await import("../web/review.tsx");

function world(ids: string[]) {
  const src = new Store({
    mode: "game", label: "Synthetic", dataset: "Synthetic",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false },
  }, { now: START, start: START, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const id of ids) src.upsertMember({ id, name: id, city: "nyc", joined: true, minor: false, state: "normal", counters: emptyCounters() });
  const projector = new Projector(src);
  let time = START;
  const apply = (record: RunRecordInput) => projector.apply({ ...record, t: ++time });
  const propose = (id: string, participants: string[]) => apply({
    type: "proposal", source: "player",
    proposal: {
      id, participants, kind: participants.length > 2 ? "group" : "intro", city: "nyc",
      alternates: [], objective: "Meet", score: 0, exploration: false, explanations: {}, generator: "player",
      createdAt: time, components: {
        fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
        interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
      },
    },
    oracle: { compatible: true, quality: 1, minEnjoyment: 1, flags: [], participants: {} },
  });
  const invite = (oppId: string, memberId: string) => apply({
    type: "message", msg: {
      id: `invite-${oppId}-${memberId}`, direction: "outbound", ts: time, memberId, body: "Want to meet?",
      status: "delivered", meta: { type: "proposal", proposalId: oppId },
    },
  });
  const inviteAll = (oppId: string, participants: string[]) => participants.forEach(id => invite(oppId, id));
  const reply = (oppId: string, memberId: string, intent: string) => apply({
    type: "decision", proposalId: oppId, memberId, messageId: `invite-${oppId}-${memberId}`,
    messageType: "proposal", intent, decision: intent, delayMs: 0,
  });
  const probeNo = (oppId: string, memberId: string) => apply({
    type: "network_log", kind: "probe_answer", detail: { oppId, memberId, yes: false },
  });
  const book = (oppId: string, roster: string[]) => apply({
    type: "meeting_scheduled", proposalId: oppId, meetingId: `meeting-${oppId}`,
    participants: roster, at: START + 86_400_000, city: "nyc",
  });
  const giveNotice = (oppId: string, memberId: string) => apply({
    type: "message", bookingNoticeMeetingId: `meeting-${oppId}`,
    msg: { id: `notice-${oppId}-${memberId}`, direction: "inbound", ts: time, memberId, body: "I can't make it", status: "delivered" },
  });
  return { src, propose, inviteAll, reply, probeNo, book, giveNotice, opp: (id: string) => src.opps.get(id)! };
}

function seed(...opps: ReturnType<ReturnType<typeof world>["opp"]>[]) {
  store.members.clear(); store.opps.clear(); store.feed = [];
  for (const o of opps) store.opps.set(o.id, o);
}

function subjectOppA(id: string, subject: string, other: string) {
  const w = world([subject, other]);
  w.propose(id, [subject, other]);
  return w.opp(id);
}

test("declined in a group opportunity: still listed there, not busy elsewhere", () => {
  const a = subjectOppA("oppA", "m1", "m9");
  const w = world(["m1", "m2", "m3"]);
  w.propose("oppB", ["m1", "m2", "m3"]);
  w.inviteAll("oppB", ["m1", "m2", "m3"]);
  w.reply("oppB", "m1", "decline");
  const b = w.opp("oppB");
  expect(b.status.m1).toBe("declined");
  expect(["PROPOSED", "INVITING", "PARTIALLY_ACCEPTED"]).toContain(b.state);
  seed(a, b);
  expect(isBusyElsewhere(a, "m1")).toBe(false);
});

test("probe no: unavailable in that opportunity, not busy elsewhere", () => {
  const a = subjectOppA("oppA", "m1", "m9");
  const w = world(["m1", "m2", "m3"]);
  w.propose("oppB", ["m1", "m2", "m3"]);
  w.probeNo("oppB", "m1");
  const b = w.opp("oppB");
  expect(b.status.m1).toBe("unavailable");
  expect(b.state).toBe("PROPOSED");
  seed(a, b);
  expect(isBusyElsewhere(a, "m1")).toBe(false);
});

test("called off a booked plan: cancelled with notice, not busy elsewhere", () => {
  const a = subjectOppA("oppA", "m1", "m9");
  const w = world(["m1", "m2", "m3", "m4"]);
  w.propose("oppB", ["m1", "m2", "m3", "m4"]);
  w.inviteAll("oppB", ["m1", "m2", "m3", "m4"]);
  w.reply("oppB", "m1", "accept"); w.reply("oppB", "m2", "accept"); w.reply("oppB", "m3", "accept");
  w.book("oppB", ["m1", "m2", "m3"]);
  w.giveNotice("oppB", "m1");
  const b = w.opp("oppB");
  expect(b.status.m1).toBe("cancelled_with_notice");
  expect(b.state).toBe("SCHEDULED");
  seed(a, b);
  expect(isBusyElsewhere(a, "m1")).toBe(false);
});

test("accepted in another open opportunity: still busy", () => {
  const a = subjectOppA("oppA", "m1", "m9");
  const w = world(["m1", "m2", "m3"]);
  w.propose("oppB", ["m1", "m2", "m3"]);
  w.inviteAll("oppB", ["m1", "m2", "m3"]);
  w.reply("oppB", "m1", "accept");
  const b = w.opp("oppB");
  expect(b.status.m1).toBe("accepted");
  expect(b.state).toBe("PARTIALLY_ACCEPTED");
  seed(a, b);
  expect(isBusyElsewhere(a, "m1")).toBe(true);
});

test("dropped at booking (never answered): still busy, the Network still counts them", () => {
  const a = subjectOppA("oppA", "m1", "m9");
  const w = world(["m1", "m2", "m3", "m4"]);
  w.propose("oppB", ["m1", "m2", "m3", "m4"]);
  w.inviteAll("oppB", ["m1", "m2", "m3", "m4"]);
  w.reply("oppB", "m2", "accept"); w.reply("oppB", "m3", "accept"); w.reply("oppB", "m4", "accept");
  w.book("oppB", ["m2", "m3", "m4"]);
  const b = w.opp("oppB");
  expect(b.status.m1).toBe("dropped");
  expect(b.state).toBe("SCHEDULED");
  seed(a, b);
  expect(isBusyElsewhere(a, "m1")).toBe(true);
});

test("pending in another open opportunity: still busy", () => {
  const a = subjectOppA("oppA", "m1", "m9");
  const w = world(["m1", "m2"]);
  w.propose("oppB", ["m1", "m2"]);
  const b = w.opp("oppB");
  expect(b.status.m1).toBe("pending");
  expect(b.state).toBe("PROPOSED");
  seed(a, b);
  expect(isBusyElsewhere(a, "m1")).toBe(true);
});

test("only other opportunity closed: not busy", () => {
  const a = subjectOppA("oppA", "m1", "m9");
  const w = world(["m1", "m2"]);
  w.propose("oppB", ["m1", "m2"]);
  w.inviteAll("oppB", ["m1", "m2"]);
  w.reply("oppB", "m1", "decline");
  const b = w.opp("oppB");
  expect(b.state).toBe("DECLINED");
  seed(a, b);
  expect(isBusyElsewhere(a, "m1")).toBe(false);
});

test("store.busy() applies the same rule to every member at once", () => {
  const declined = world(["d1", "x1", "x2"]);
  declined.propose("b1", ["d1", "x1", "x2"]);
  declined.inviteAll("b1", ["d1", "x1", "x2"]);
  declined.reply("b1", "d1", "decline");
  const unavail = world(["d2", "x3", "x4"]);
  unavail.propose("b2", ["d2", "x3", "x4"]);
  unavail.probeNo("b2", "d2");
  const cancelled = world(["d3", "x5", "x6", "x7"]);
  cancelled.propose("b3", ["d3", "x5", "x6", "x7"]);
  cancelled.inviteAll("b3", ["d3", "x5", "x6", "x7"]);
  cancelled.reply("b3", "d3", "accept"); cancelled.reply("b3", "x5", "accept"); cancelled.reply("b3", "x6", "accept");
  cancelled.book("b3", ["d3", "x5", "x6"]);
  cancelled.giveNotice("b3", "d3");
  const accepted = world(["d4", "x8", "x9"]);
  accepted.propose("b4", ["d4", "x8", "x9"]);
  accepted.inviteAll("b4", ["d4", "x8", "x9"]);
  accepted.reply("b4", "d4", "accept");
  const dropped = world(["d5", "x10", "x11", "x12"]);
  dropped.propose("b5", ["d5", "x10", "x11", "x12"]);
  dropped.inviteAll("b5", ["d5", "x10", "x11", "x12"]);
  dropped.reply("b5", "x10", "accept"); dropped.reply("b5", "x11", "accept"); dropped.reply("b5", "x12", "accept");
  dropped.book("b5", ["x10", "x11", "x12"]);
  const pending = world(["d6", "x13"]);
  pending.propose("b6", ["d6", "x13"]);
  const closed = world(["d7", "x14"]);
  closed.propose("b7", ["d7", "x14"]);
  closed.inviteAll("b7", ["d7", "x14"]);
  closed.reply("b7", "d7", "decline");
  seed(
    declined.opp("b1"), unavail.opp("b2"), cancelled.opp("b3"), accepted.opp("b4"),
    dropped.opp("b5"), pending.opp("b6"), closed.opp("b7"),
  );
  expect(declined.opp("b1").status.d1).toBe("declined");
  expect(unavail.opp("b2").status.d2).toBe("unavailable");
  expect(cancelled.opp("b3").status.d3).toBe("cancelled_with_notice");
  expect(accepted.opp("b4").status.d4).toBe("accepted");
  expect(dropped.opp("b5").status.d5).toBe("dropped");
  expect(pending.opp("b6").status.d6).toBe("pending");
  expect(closed.opp("b7").state).toBe("DECLINED");
  const busy = store.busy();
  expect(busy.has("d1")).toBe(false);
  expect(busy.has("d2")).toBe(false);
  expect(busy.has("d3")).toBe(false);
  expect(busy.has("d4")).toBe(true);
  expect(busy.has("d5")).toBe(true);
  expect(busy.has("d6")).toBe(true);
  expect(busy.has("d7")).toBe(false);
});
