import { describe, expect, test } from "bun:test";
import { HOUR, SimClock, type OpportunityState } from "@thenetwork/core";
import {
  createOpportunity, dispatchInvites, findRule, inviteAlternates, InvalidTransitionError, respond, tick,
  TRANSITIONS, transition, visibleTo, type Opportunity,
} from "../src/opportunity.ts";

const ALL_STATES: OpportunityState[] = [
  "DRAFT", "PROPOSED", "IN_REVIEW", "APPROVED", "INVITING", "PARTIALLY_ACCEPTED", "MUTUALLY_ACCEPTED", "QUORUM_MET",
  "SCHEDULING", "SCHEDULED", "RESCHEDULE_REQUESTED", "NEEDS_REPLACEMENT", "IN_PROGRESS", "COMPLETED", "FEEDBACK_COLLECTED",
  "REJECTED_IN_REVIEW", "DECLINED", "EXPIRED", "QUORUM_FAILED", "CANCELLED", "SAFETY_HOLD", "DISPUTED", "ABANDONED",
];

function at(state: OpportunityState, heldFrom?: OpportunityState): Opportunity {
  const o = createOpportunity({ id: "o1", participants: ["a", "b"] });
  o.state = state;
  if (heldFrom) o.heldFrom = heldFrom;
  return o;
}

describe("opportunity state machine: transitions table (32.10)", () => {
  test("every row in the table is applicable by its listed actors", () => {
    let n = 0;
    for (const r of TRANSITIONS) for (const actor of r.actors) {
      const o = at(r.from, r.trigger === "release_hold" ? r.to : undefined);
      transition(o, r.to, r.trigger, actor, new SimClock(), `e${n++}`);
      expect(o.state).toBe(r.to);
      expect(o.events.at(-1)).toMatchObject({ from: r.from, to: r.to, trigger: r.trigger, actor });
    }
    expect(n).toBeGreaterThan(80);
  });

  test("every (from,to,trigger) not in the table throws, including all terminal exits", () => {
    const triggers = [...new Set(TRANSITIONS.map(r => r.trigger))];
    let invalid = 0;
    for (const from of ALL_STATES) for (const to of ALL_STATES) for (const trig of triggers) {
      if (findRule(from, to, trig)) continue;
      invalid++;
      expect(() => transition(at(from, from === "SAFETY_HOLD" ? to : undefined), to, trig, "system", new SimClock(), "x")).toThrow(InvalidTransitionError);
    }
    expect(invalid).toBeGreaterThan(10_000);
  });

  test("terminal states have no outgoing transitions", () => {
    for (const s of ["FEEDBACK_COLLECTED", "REJECTED_IN_REVIEW", "DECLINED", "EXPIRED", "QUORUM_FAILED", "CANCELLED", "ABANDONED"] as const)
      expect(TRANSITIONS.filter(r => r.from === s)).toEqual([]);
  });

  test("permission checks: wrong actor throws", () => {
    expect(() => transition(at("IN_REVIEW"), "APPROVED", "approve", "engine", new SimClock(), "x")).toThrow(/actor not permitted/);
    expect(() => transition(at("SCHEDULED"), "IN_PROGRESS", "start", "member", new SimClock(), "x")).toThrow(/actor not permitted/);
  });

  test("idempotent by event id", () => {
    const o = at("IN_REVIEW");
    const c = new SimClock();
    transition(o, "APPROVED", "approve", "reviewer", c, "ev1");
    transition(o, "APPROVED", "approve", "reviewer", c, "ev1");
    expect(o.events.length).toBe(1);
    expect(o.state).toBe("APPROVED");
  });

  test("safety hold remembers and only releases to the prior state", () => {
    const o = at("SCHEDULED");
    const c = new SimClock();
    transition(o, "SAFETY_HOLD", "safety_report", "system", c, "h");
    expect(o.heldFrom).toBe("SCHEDULED");
    expect(() => transition(o, "INVITING", "release_hold", "steward", c, "r1")).toThrow(/release to SCHEDULED/);
    transition(o, "SCHEDULED", "release_hold", "steward", c, "r2");
    expect(o.state).toBe("SCHEDULED");
  });
});

describe("invitations, quorum, alternates, expiry on the Clock (F11, F12, F29)", () => {
  const toInviting = (o: Opportunity, c: SimClock) => {
    transition(o, "PROPOSED", "propose", "engine", c, "1");
    transition(o, "IN_REVIEW", "enqueue_review", "system", c, "2");
    transition(o, "APPROVED", "approve", "reviewer", c, "3");
    return dispatchInvites(o, c, "4");
  };

  test("pair: both accept -> MUTUALLY_ACCEPTED -> scheduling", () => {
    const c = new SimClock();
    const o = toInviting(createOpportunity({ id: "p", participants: ["a", "b"] }), c);
    expect(o.inviteExpiresAt.a).toBe(c.now() + 48 * HOUR);
    respond(o, "a", true, c, "ra");
    expect(o.state).toBe("PARTIALLY_ACCEPTED");
    respond(o, "b", true, c, "rb");
    expect(o.state).toBe("MUTUALLY_ACCEPTED");
    transition(o, "SCHEDULING", "start_scheduling", "system", c, "s");
    transition(o, "SCHEDULED", "confirm_time", "member", c, "t");
    expect(o.state).toBe("SCHEDULED");
  });

  test("pair: a decline ends it; the other side never learns who declined", () => {
    const c = new SimClock();
    const o = toInviting(createOpportunity({ id: "p", participants: ["a", "b"] }), c);
    respond(o, "a", true, c, "ra");
    respond(o, "b", false, c, "rb");
    expect(o.state).toBe("DECLINED");
    const v = visibleTo(o, "a");
    expect(JSON.stringify(v)).not.toContain("b");
    expect(v.mine).toBe("accepted");
  });

  test("same-day invites expire in 3h, others in 48h; expiry on tick", () => {
    const c = new SimClock();
    const o = toInviting(createOpportunity({ id: "p", participants: ["a", "b"], sameDay: true }), c);
    expect(o.inviteExpiresAt.a).toBe(c.now() + 3 * HOUR);
    c.advance(3 * HOUR);
    tick(o, c);
    expect(o.state).toBe("EXPIRED");
    expect(() => respond(o, "a", true, c, "late")).toThrow();
  });

  test("group: quorum met with partial acceptance; declines are private", () => {
    const c = new SimClock();
    const o = toInviting(createOpportunity({ id: "g", participants: ["a", "b", "c", "d", "e", "f"], quorum: 4, alternates: ["x"] }), c);
    for (const id of ["a", "b", "c"]) respond(o, id, true, c, `r${id}`);
    expect(o.state).toBe("PARTIALLY_ACCEPTED");
    respond(o, "d", false, c, "rd");
    expect(o.state).toBe("PARTIALLY_ACCEPTED");
    respond(o, "e", true, c, "re");
    expect(o.state).toBe("QUORUM_MET");
  });

  test("group: shortfall -> NEEDS_REPLACEMENT -> alternates invited -> QUORUM_MET", () => {
    const c = new SimClock();
    const o = toInviting(createOpportunity({ id: "g", participants: ["a", "b", "c", "d"], quorum: 3, alternates: ["x", "y"] }), c);
    respond(o, "a", true, c, "1a");
    respond(o, "b", false, c, "1b");
    respond(o, "c", false, c, "1c");
    expect(o.state).toBe("NEEDS_REPLACEMENT");
    inviteAlternates(o, c, "alt");
    expect(o.state).toBe("INVITING");
    expect(o.participants.x).toBe("invited");
    respond(o, "d", true, c, "1d");
    respond(o, "x", true, c, "1x");
    expect(o.state).toBe("QUORUM_MET");
  });

  test("group: no alternates left -> QUORUM_FAILED; quorum deadline on the Clock", () => {
    const c = new SimClock();
    const o = toInviting(createOpportunity({ id: "g", participants: ["a", "b", "c"], quorum: 3 }), c);
    respond(o, "a", false, c, "x");
    expect(o.state).toBe("NEEDS_REPLACEMENT");
    inviteAlternates(o, c, "none");
    expect(o.state).toBe("QUORUM_FAILED");
    const c2 = new SimClock();
    const o2 = toInviting(createOpportunity({ id: "g2", participants: ["a", "b", "c", "d"], quorum: 3, alternates: [] }), c2);
    respond(o2, "a", true, c2, "y");
    c2.advance(96 * HOUR);
    tick(o2, c2);
    expect(o2.state).toBe("QUORUM_FAILED");
    const o3 = createOpportunity({ id: "g3", participants: ["a", "b", "c", "d"], quorum: 3 });
    o3.state = "NEEDS_REPLACEMENT";
    inviteAlternates(o3, c2, "z");
    expect(o3.state as OpportunityState).toBe("QUORUM_FAILED");
  });

  test("expired invitations with alternates -> NEEDS_REPLACEMENT", () => {
    const c = new SimClock();
    const o = toInviting(createOpportunity({ id: "g", participants: ["a", "b", "c"], quorum: 3, alternates: ["x"] }), c);
    respond(o, "a", true, c, "1");
    c.advance(48 * HOUR);
    tick(o, c);
    expect(o.state).toBe("NEEDS_REPLACEMENT");
    expect(o.participants.b).toBe("expired");
  });

  test("invalid operations throw: responding without an invitation, inviting alternates from wrong state", () => {
    const c = new SimClock();
    const o = toInviting(createOpportunity({ id: "p", participants: ["a", "b"] }), c);
    expect(() => respond(o, "zz", true, c, "q")).toThrow(InvalidTransitionError);
    const d = createOpportunity({ id: "d", participants: ["a", "b"], alternates: ["x"] });
    expect(() => inviteAlternates(d, c, "w")).toThrow(InvalidTransitionError);
    expect(d.alternates).toEqual(["x"]); // no partial mutation
  });
});
