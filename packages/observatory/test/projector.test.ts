// Projection of simulator records into observatory state: the opportunity state machine,
// per-participant statuses, learned edges (PRD 32.13) and counters.
import { describe, expect, test } from "bun:test";
import type { Proposal } from "@thenetwork/core";
import type { OracleSummary, RunRecord } from "@thenetwork/judge";
import { Projector } from "../src/projector.ts";
import { edgeId, emptyCounters, Store } from "../src/store.ts";

function setup() {
  const store = new Store(
    { mode: "game", label: "t", dataset: "t", capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false } },
    { now: 0, start: 0, day: 1, playing: false, speed: 1, waitingForPlayer: false },
  );
  for (const [id, name] of [["a", "Ana Diaz"], ["b", "Ben Ito"], ["c", "Cy Moss"], ["d", "Dee Park"]] as const)
    store.upsertMember({ id, name, city: "sf", state: "not_joined", joined: false, minor: false, counters: emptyCounters() });
  const p = new Projector(store, { joinState: () => "normal" });
  return { store, p };
}
const oracle: OracleSummary = { compatible: true, unsafe: false, quality: 0.7, minEnjoyment: 0.6, flags: [], participants: {} };
const proposal = (id: string, participants: string[]): Proposal => ({
  id, kind: participants.length > 2 ? "group" : "intro", participants, alternates: [], objective: "coffee", city: "sf", score: 0.5,
  components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
  exploration: false, explanations: {}, generator: "warm_path", createdAt: 0,
});
const invite = (t: number, memberId: string, pid: string): RunRecord => ({ t, type: "message", msg: { id: `m${t}${memberId}`, ts: t, direction: "outbound", memberId, body: "want an intro?", status: "delivered", meta: { type: "proposal", proposalId: pid, proactive: true } } });
const decide = (t: number, memberId: string, pid: string, intent: string): RunRecord => ({ t, type: "decision", memberId, messageId: "x", messageType: "proposal", intent, decision: intent, proposalId: pid, delayMs: 0 });

describe("Projector", () => {
  test("pair: proposed → inviting → mutually accepted → scheduled → completed → feedback, with learned edges", () => {
    const { store, p } = setup();
    p.apply({ t: 1, type: "join", memberId: "a" });
    p.apply({ t: 1, type: "join", memberId: "b" });
    expect(store.member("a")!.state).toBe("normal");
    p.apply({ t: 2, type: "proposal", source: "engine", proposal: proposal("p1", ["a", "b"]), oracle });
    expect(store.opps.get("p1")!.state).toBe("PROPOSED");
    p.apply(invite(3, "a", "p1"));
    expect(store.opps.get("p1")!.state).toBe("INVITING");
    expect(store.opps.get("p1")!.status.a).toBe("invited");
    p.apply(decide(4, "a", "p1", "accept"));
    expect(store.opps.get("p1")!.state).toBe("PARTIALLY_ACCEPTED");
    p.apply(invite(5, "b", "p1"));
    p.apply(decide(6, "b", "p1", "accept"));
    expect(store.opps.get("p1")!.state).toBe("MUTUALLY_ACCEPTED");
    expect(store.edges.has(edgeId("introduced", "a", "b"))).toBe(true);
    p.apply({ t: 7, type: "meeting_scheduled", meetingId: "mt1", proposalId: "p1", participants: ["a", "b"], at: 100, city: "sf" });
    expect(store.opps.get("p1")!.state).toBe("SCHEDULED");
    expect(store.opps.get("p1")!.status.b).toBe("confirmed");
    p.apply({ t: 100, type: "outcome", meetingId: "mt1", proposalId: "p1", at: 100, attendance: { a: { showed: true, cancelledWithNotice: false, enjoyment: 0.8 }, b: { showed: true, cancelledWithNotice: false, enjoyment: 0.9 } } });
    const o = store.opps.get("p1")!;
    expect(o.state).toBe("COMPLETED");
    expect(o.status).toEqual({ a: "attended", b: "attended" });
    for (const t of ["met", "enjoyed", "would_interact_again"]) expect(store.edges.has(edgeId(t, "b", "a"))).toBe(true);
    p.apply({ t: 101, type: "feedback", memberId: "a", proposalId: "p1", text: "great" });
    expect(store.opps.get("p1")!.state).toBe("FEEDBACK_COLLECTED");
    const s = store.stats();
    expect(s.meetingsHeld).toBe(1);
    expect(s.attended).toBe(2);
    expect(s.accepts).toBe(2);
    expect(s.invites).toBe(2);
    expect(s.enjoymentSum).toBeCloseTo(1.7);
    expect(store.member("a")!.counters.meetings).toBe(1);
  });

  test("decline closes a pair; network logs map to SKIPPED / EXPIRED; blocks and opt-outs", () => {
    const { store, p } = setup();
    p.apply({ t: 1, type: "proposal", source: "player", proposal: proposal("p2", ["a", "c"]), oracle });
    p.apply(invite(2, "a", "p2"));
    p.apply(decide(3, "a", "p2", "decline"));
    expect(store.opps.get("p2")!.state).toBe("DECLINED");
    p.apply({ t: 4, type: "proposal", source: "engine", proposal: proposal("p3", ["b", "d"]), oracle });
    p.apply({ t: 5, type: "network_log", kind: "proposal_skipped", detail: { proposalId: "p3", reason: "minors_policy" } });
    expect(store.opps.get("p3")!.state).toBe("SKIPPED");
    expect(store.opps.get("p3")!.reason).toBe("minors_policy");
    p.apply({ t: 6, type: "proposal", source: "engine", proposal: proposal("p4", ["c", "d"]), oracle });
    p.apply(invite(7, "c", "p4"));
    p.apply({ t: 8, type: "network_log", kind: "opportunity_closed", detail: { proposalId: "p4", reason: "expired" } });
    expect(store.opps.get("p4")!.state).toBe("EXPIRED");
    expect(store.opps.get("p4")!.status.c).toBe("expired");
    p.apply({ t: 9, type: "block", from: "a", to: "b" });
    p.apply({ t: 9, type: "opt_out", memberId: "c" });
    expect(store.edges.has(edgeId("blocked", "a", "b"))).toBe(true);
    expect(store.edges.has(edgeId("blocked", "b", "a"))).toBe(false); // directed
    expect(store.member("c")!.state).toBe("opted_out");
    const s = store.stats();
    expect(s.proposalsBySource).toEqual({ player: 1, engine: 2 });
    expect(s.blocks).toBe(1);
    expect(s.optOuts).toBe(1);
  });

  test("group quorum, no-shows and a bad meeting (avoid edge)", () => {
    const { store, p } = setup();
    p.apply({ t: 1, type: "proposal", source: "engine", proposal: proposal("g1", ["a", "b", "c", "d"]), oracle });
    for (const id of ["a", "b", "c"]) { p.apply(invite(2, id, "g1")); p.apply(decide(3, id, "g1", "accept")); }
    expect(store.opps.get("g1")!.state).toBe("QUORUM_MET");
    p.apply({ t: 4, type: "meeting_scheduled", meetingId: "m", proposalId: "g1", participants: ["a", "b", "c"], at: 50, city: "sf" });
    expect(store.opps.get("g1")!.status.d).toBe("dropped");
    p.apply({ t: 50, type: "outcome", meetingId: "m", proposalId: "g1", at: 50, attendance: {
      a: { showed: true, cancelledWithNotice: false, enjoyment: 0.1 }, b: { showed: true, cancelledWithNotice: false, enjoyment: 0.15 }, c: { showed: false, cancelledWithNotice: false, enjoyment: 0 },
    } });
    expect(store.opps.get("g1")!.status.c).toBe("no_show");
    expect(store.edges.has(edgeId("avoid", "a", "b"))).toBe(true);
    expect(store.edges.has(edgeId("enjoyed", "a", "b"))).toBe(false);
    expect(store.stats().noShows).toBe(1);
  });

  test("deltas carry only what changed", () => {
    const { store, p } = setup();
    store.takeDelta();
    p.apply({ t: 1, type: "join", memberId: "a" });
    const d = store.takeDelta();
    expect(d.members?.map(m => m.id)).toEqual(["a"]);
    expect(d.feed?.length).toBe(1);
    const empty = store.takeDelta();
    expect(empty.members).toBeUndefined();
    expect(empty.version).toBe(d.version);
  });
});
