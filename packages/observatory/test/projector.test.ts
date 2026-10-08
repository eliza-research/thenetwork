// Projection of simulator records into observatory state: the opportunity state machine,
// per-participant statuses, learned edges (PRD 32.13) and counters.
import { describe, expect, test } from "bun:test";
import { UNDER_MIN_AGE_DECLINE, type Proposal } from "@thenetwork/core";
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

  test("consent logs: review queue and decisions, the leak guard (no text), age signals", () => {
    const { store, p } = setup();
    const log = (t: number, kind: string, detail: Record<string, unknown>): RunRecord => ({ t, type: "network_log", kind, detail });
    p.apply(log(1, "review_queued", { proposal: proposal("r1", ["a", "b"]), origin: "engine", deadline: 50 }));
    p.apply(log(1, "review_queued", { proposal: proposal("r2", ["c", "d"]), origin: "request", deadline: 50 }));
    expect(store.opps.get("r1")).toMatchObject({ state: "IN_REVIEW", review: { queuedAt: 1, deadline: 50 }, status: { a: "pending", b: "pending" } });
    expect(store.member("a")!.counters.proposals).toBe(0); // waiting for review: not a proposal to anyone yet
    p.apply(log(2, "review_decision", { oppId: "r1", decision: "approve", reason: null, note: null, reviewer: "player" }));
    p.apply(log(2, "probe_started", { proposal: proposal("r1", ["a", "b"]), origin: "engine", primed: [] }));
    expect(store.opps.get("r1")).toMatchObject({ state: "PROPOSED", status: { a: "checking", b: "checking" }, review: { decision: "approve", reviewer: "player", decidedAt: 2 } });
    expect(store.member("a")!.counters.proposals).toBe(1); // counted once, at approval
    p.apply(log(3, "review_decision", { oppId: "r2", decision: "reject", reason: "privacy_risk", note: "too personal", reviewer: "player" }));
    p.apply(log(3, "probe_closed", { proposalId: "r2", reason: "not sent: rejected in review" }));
    expect(store.opps.get("r2")).toMatchObject({ state: "SKIPPED", reason: "rejected in review (privacy risk)", review: { decision: "reject", reason: "privacy_risk" } });
    expect([store.member("c")!.counters.proposals, store.member("d")!.counters.proposals]).toEqual([0, 0]); // rejected: never counted
    p.apply(log(4, "guard_blocked", { memberId: "a", kind: "reveal", reasons: ["canary"], fallback: false }));
    const guard = store.feed.find(f => f.kind === "guard")!;
    expect(guard.text).toContain("nothing sent");
    expect(guard.text).not.toContain("canary");
    p.apply(log(5, "minor_signal", { memberId: "c" }));
    expect(store.member("c")!.minor).toBe(true);
    p.apply({ t: 6, type: "message", msg: { id: "m6", ts: 6, direction: "outbound", memberId: "d", body: UNDER_MIN_AGE_DECLINE, status: "delivered", meta: { type: "info" } } });
    p.apply(log(6, "join_declined", { reason: "under_min_age" }));
    expect(store.member("d")).toMatchObject({ minor: true, declined: true });
    expect(store.feed[store.feed.length - 1]!.members).toBeUndefined();
  });

  test("a staff-composed intro counts for its members only once a reviewer approves it", () => {
    const { store, p } = setup();
    const log = (t: number, kind: string, detail: Record<string, unknown>): RunRecord => ({ t, type: "network_log", kind, detail });
    p.apply({ t: 1, type: "proposal", source: "player", proposal: proposal("x1", ["a", "b"]), oracle });
    p.apply(log(2, "review_queued", { proposal: proposal("x1", ["a", "b"]), origin: "player", deadline: 50 }));
    expect(store.member("a")!.counters.proposals).toBe(0);
    p.apply(log(3, "review_decision", { oppId: "x1", decision: "approve", reason: null, note: null, reviewer: "player" }));
    p.apply(log(3, "probe_started", { proposal: proposal("x1", ["a", "b"]), origin: "player", primed: [] }));
    p.apply({ t: 9, type: "proposal", source: "player", proposal: proposal("x1", ["a", "b"]), oracle }); // recorded again at the reveal
    expect([store.member("a")!.counters.proposals, store.member("b")!.counters.proposals]).toEqual([1, 1]);
    // An engine proposal under the StubNetwork (no review) still counts at once.
    p.apply({ t: 10, type: "proposal", source: "engine", proposal: proposal("x2", ["c", "d"]), oracle });
    expect(store.member("c")!.counters.proposals).toBe(1);
  });

  test("request and invite feed items name the want, never the member's words", () => {
    const { store, p } = setup();
    const log = (t: number, kind: string, detail: Record<string, unknown>): RunRecord => ({ t, type: "network_log", kind, detail });
    p.apply(log(1, "request", { requestId: "q1", memberId: "a", kind: "people", category: "hobby", desireId: "tennis_partner", tags: ["tennis"] }));
    p.apply(log(2, "request", { requestId: "q2", memberId: "b", kind: "people", category: "social", tags: [] }));
    p.apply(log(3, "invite", { from: "a", newMemberId: "c" }));
    expect(store.feed.map(f => f.text)).toEqual(["Ana asked: find a weekend tennis partner", "Ben asked: a social request", "Ana invited Cy"]);
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
  test("review: a re-roll is not an approval (the item waits again with the swapped participant); an approval stopped on the re-check is uncounted and closed", () => {
    const { store, p } = setup();
    for (const id of ["a", "b", "c"]) p.apply({ t: 1, type: "join", memberId: id });
    const log = (t: number, kind: string, detail: Record<string, unknown>): RunRecord => ({ t, type: "network_log", kind, detail });
    p.apply(log(2, "review_queued", { proposal: { ...proposal("r1", ["a", "b"]), alternates: ["c"] }, origin: "engine", deadline: 50 }));
    expect(store.opps.get("r1")!.state).toBe("IN_REVIEW");
    p.apply(log(3, "review_decision", { oppId: "r1", decision: "reroll", out: "b", in: "c", next: "review", reviewer: "rev@x", secondsSpent: 20 }));
    p.apply(log(3, "review_queued", { proposal: proposal("r1", ["a", "c"]), origin: "engine", deadline: 60, rerolled: true }));
    let o = store.opps.get("r1")!;
    expect([o.state, o.participants, o.review?.decision, o.review?.rerolls, o.review?.secondsSpent, o.review?.deadline]).toEqual(["IN_REVIEW", ["a", "c"], undefined, 1, 20, 60]);
    expect(store.member("a")!.counters.proposals).toBe(0);
    p.apply(log(4, "review_decision", { oppId: "r1", decision: "approve", reviewer: "rev@x", edited: ["objective"], secondsSpent: 10 }));
    expect(store.member("c")!.counters.proposals).toBe(1);
    p.apply(log(4, "review_invalidated", { oppId: "r1", reason: "busy_elsewhere" }));
    o = store.opps.get("r1")!;
    expect([o.state, o.review?.decision, o.review?.invalidated, o.review?.edits, o.review?.secondsSpent]).toEqual(["SKIPPED", "approve", "busy_elsewhere", ["objective"], 30]);
    expect(store.member("c")!.counters.proposals).toBe(0);
    // No alternate: the re-roll closes the item back to the engine.
    p.apply(log(5, "review_queued", { proposal: proposal("r2", ["a", "b"]), origin: "engine", deadline: 70 }));
    p.apply(log(6, "review_decision", { oppId: "r2", decision: "reroll", out: null, in: null, next: "engine", reviewer: "rev@x" }));
    expect(store.opps.get("r2")!.state).toBe("SKIPPED");
    expect(store.opps.get("r2")!.review?.decision).toBeUndefined();
  });
});
