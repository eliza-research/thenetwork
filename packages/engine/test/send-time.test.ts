// Regression tests for the 2026-10-07 audit:
//  P1-5  eligibility is re-checked at invite, accept and backfill time;
//  P1-9  the seeker/initiator (anchor) declining cancels instead of backfilling;
//  P1-8  quiet hours and pause apply to every agent-initiated outreach kind.
import { describe, expect, test } from "bun:test";
import { HOUR, MINUTE, SimClock, type MemberId } from "@thenetwork/core";
import { eligibilityFor, sendTimeReason } from "../src/filters.ts";
import { createOpportunity, dispatchInvites, inviteAlternates, InvalidTransitionError, respond, transition, type Opportunity } from "../src/opportunity.ts";
import { isAgentInitiated, OutreachController, type OutboundMessage } from "../src/outreach.ts";
import { baseMember, emptyInput, mkWorld, NOW } from "./helpers.ts";

function approved(o: Opportunity, c: SimClock): Opportunity {
  transition(o, "PROPOSED", "propose", "engine", c, "1");
  transition(o, "IN_REVIEW", "enqueue_review", "system", c, "2");
  return transition(o, "APPROVED", "approve", "reviewer", c, "3");
}

/** A mutable eligibility table standing in for the member store. */
function table() {
  const reasons = new Map<MemberId, string>();
  const blocks = new Set<string>();
  const eligible = (id: MemberId, others: MemberId[]) =>
    reasons.get(id) ?? (others.some((o) => blocks.has([id, o].sort().join("|"))) ? "blocked" : null);
  return { reasons, blocks, eligible };
}

describe("anchor decline cancels; helpers are backfilled", () => {
  test("pair: seeker declines with alternates available -> CANCELLED, no alternate invited", () => {
    const c = new SimClock(NOW);
    const o = dispatchInvites(approved(createOpportunity({ id: "p", participants: ["seeker", "helper"], alternates: ["alt"], anchors: ["seeker"] }), c), c, "d");
    respond(o, "helper", true, c, "rh");
    respond(o, "seeker", false, c, "rs");
    expect(o.state).toBe("CANCELLED");
    expect(o.participants.alt).toBeUndefined();
    expect(() => inviteAlternates(o, c, "ia")).toThrow(InvalidTransitionError);
  });

  test("pair: helper declines -> NEEDS_REPLACEMENT -> alternate invited (unchanged)", () => {
    const c = new SimClock(NOW);
    const o = dispatchInvites(approved(createOpportunity({ id: "p", participants: ["seeker", "helper"], alternates: ["alt"], anchors: ["seeker"] }), c), c, "d");
    respond(o, "helper", false, c, "rh");
    expect(o.state).toBe("NEEDS_REPLACEMENT");
    inviteAlternates(o, c, "ia");
    expect(o.participants.alt).toBe("invited");
  });

  test("group: initiator declines even though quorum is still reachable -> CANCELLED", () => {
    const c = new SimClock(NOW);
    const o = dispatchInvites(approved(createOpportunity({ id: "g", participants: ["host", "a", "b", "c", "d"], quorum: 3, alternates: ["x"], anchors: ["host"] }), c), c, "d");
    respond(o, "a", true, c, "ra");
    respond(o, "host", false, c, "rh");
    expect(o.state).toBe("CANCELLED");
  });

  test("no responses are taken once the opportunity is terminal or on safety hold", () => {
    const c = new SimClock(NOW);
    const o = dispatchInvites(approved(createOpportunity({ id: "p", participants: ["s", "h"], anchors: ["s"] }), c), c, "d");
    respond(o, "s", false, c, "rs");
    expect(() => respond(o, "h", true, c, "rh")).toThrow(InvalidTransitionError);
    const o2 = dispatchInvites(approved(createOpportunity({ id: "p2", participants: ["s", "h"] }), c), c, "d");
    transition(o2, "SAFETY_HOLD", "safety_report", "system", c, "hold");
    expect(() => respond(o2, "h", false, c, "rh")).toThrow(InvalidTransitionError);
    expect(o2.participants.h).toBe("invited");
  });

  test("anchors must be participants", () => {
    expect(() => createOpportunity({ id: "x", participants: ["a", "b"], anchors: ["z"] })).toThrow("anchor");
  });
});

describe("eligibility re-checked at invite, accept and backfill", () => {
  test("dispatch: an anchor who became ineligible cancels the opportunity; nobody is invited", () => {
    const c = new SimClock(NOW);
    const t = table();
    const o = approved(createOpportunity({ id: "p", participants: ["seeker", "helper"], alternates: ["alt"], anchors: ["seeker"] }), c);
    t.reasons.set("seeker", "state_paused");
    dispatchInvites(o, c, "d", { eligible: t.eligible });
    expect(o.state).toBe("CANCELLED");
    expect(Object.values(o.participants)).not.toContain("invited");
    expect(o.removed.seeker).toBe("state_paused");
  });

  test("dispatch: an ineligible helper (now a minor) is skipped and an eligible alternate invited", () => {
    const c = new SimClock(NOW);
    const t = table();
    const o = approved(createOpportunity({ id: "p", participants: ["seeker", "helper"], alternates: ["minorAlt", "alt"], anchors: ["seeker"] }), c);
    t.reasons.set("helper", "underage");
    t.reasons.set("minorAlt", "underage");
    dispatchInvites(o, c, "d", { eligible: t.eligible });
    expect(o.state).toBe("INVITING");
    expect(o.participants).toEqual({ seeker: "invited", helper: "replaced", alt: "invited" });
    expect(o.removed).toMatchObject({ helper: "underage", minorAlt: "underage" });
  });

  test("dispatch: no eligible replacement -> QUORUM_FAILED, no partial invite left open", () => {
    const c = new SimClock(NOW);
    const t = table();
    const o = approved(createOpportunity({ id: "p", participants: ["seeker", "helper"], anchors: ["seeker"] }), c);
    t.reasons.set("helper", "safety_hold");
    dispatchInvites(o, c, "d", { eligible: t.eligible });
    expect(o.state).toBe("QUORUM_FAILED");
  });

  test("accept: a member who was blocked by the other side after the invite is removed, not accepted", () => {
    const c = new SimClock(NOW);
    const t = table();
    const o = dispatchInvites(approved(createOpportunity({ id: "p", participants: ["seeker", "helper"], alternates: ["alt"], anchors: ["seeker"] }), c), c, "d", { eligible: t.eligible });
    respond(o, "seeker", true, c, "rs", { eligible: t.eligible });
    t.blocks.add(["helper", "seeker"].sort().join("|"));
    respond(o, "helper", true, c, "rh", { eligible: t.eligible });
    expect(o.participants.helper).toBe("replaced");
    expect(o.removed.helper).toBe("blocked");
    expect(o.state).toBe("NEEDS_REPLACEMENT");
    expect(o.state).not.toBe("MUTUALLY_ACCEPTED");
  });

  test("accept: an anchor who went on safety hold cancels the opportunity", () => {
    const c = new SimClock(NOW);
    const t = table();
    const o = dispatchInvites(approved(createOpportunity({ id: "p", participants: ["seeker", "helper"], anchors: ["seeker"] }), c), c, "d");
    respond(o, "helper", true, c, "rh", { eligible: t.eligible });
    t.reasons.set("seeker", "safety_hold");
    respond(o, "seeker", true, c, "rs", { eligible: t.eligible });
    expect(o.state).toBe("CANCELLED");
    expect(o.events.at(-1)?.actor).toBe("system");
  });

  test("backfill: ineligible alternates are skipped; ineligible anchor cancels", () => {
    const c = new SimClock(NOW);
    const t = table();
    const o = dispatchInvites(approved(createOpportunity({ id: "g", participants: ["host", "a", "b", "c"], quorum: 3, alternates: ["paused", "ok"], anchors: ["host"] }), c), c, "d");
    respond(o, "a", false, c, "ra");
    respond(o, "b", false, c, "rb");
    expect(o.state).toBe("NEEDS_REPLACEMENT");
    t.reasons.set("paused", "state_paused");
    inviteAlternates(o, c, "ia", { eligible: t.eligible });
    expect(o.participants.paused).toBeUndefined();
    expect(o.participants.ok).toBe("invited");

    const o2 = dispatchInvites(approved(createOpportunity({ id: "g2", participants: ["host", "a", "b", "c"], quorum: 3, alternates: ["ok"], anchors: ["host"] }), c), c, "d");
    respond(o2, "a", false, c, "ra");
    respond(o2, "b", false, c, "rb");
    t.reasons.set("host", "underage");
    inviteAlternates(o2, c, "ia", { eligible: t.eligible });
    expect(o2.state).toBe("CANCELLED");
    expect(o2.participants.ok).toBeUndefined();
  });
});

describe("eligibilityFor(World)", () => {
  test("paused, held, minor, blocked, opted out, unknown", () => {
    const inp = emptyInput(NOW);
    inp.members.push(
      baseMember("ok"), baseMember("paused", { state: "paused" }), baseMember("kid", { age: 16 }), baseMember("held"),
      baseMember("blocker"), baseMember("stopped"),
    );
    inp.safetyHolds = [{ memberId: "held", from: NOW - HOUR }];
    inp.edges.push({ from: "blocker", to: "ok", type: "blocked", strength: 1, explicit: true, createdAt: NOW - HOUR });
    const w = mkWorld(inp);
    const check = eligibilityFor(w, (id) => id === "stopped");
    expect(check("ok", [])).toBeNull();
    expect(check("paused", [])).toBe("state_paused");
    expect(check("kid", [])).toBe("underage");
    expect(check("held", [])).toBe("safety_hold");
    expect(check("stopped", [])).toBe("opted_out");
    expect(check("ok", ["blocker"])).toBe("blocked");
    expect(check("blocker", ["ok"])).toBe("blocked");
    expect(check("ghost", [])).toBe("unknown_member");
    expect(sendTimeReason(w, "ok", ["paused"])).toBeNull(); // others' state is their own check
  });
});

describe("outreach: quiet hours and pause for every agent-initiated kind", () => {
  // 2026-10-06 10:00 UTC = 03:00 PDT (inside the default 22-8 quiet hours).
  const NIGHT = Date.UTC(2026, 9, 6, 10);
  const msg = (id: string, kind: OutboundMessage["kind"], over: Partial<OutboundMessage> = {}): OutboundMessage => ({ id, memberId: "a", kind, at: NIGHT, ...over });

  test("classification", () => {
    for (const k of ["invitation", "scheduling", "reminder", "check_in", "relay", "recommendation"] as const) expect(isAgentInitiated(k)).toBe(true);
    for (const k of ["reply", "safety_notice", "account_notice"] as const) expect(isAgentInitiated(k)).toBe(false);
  });

  test("reminders, check-ins, scheduling and relays are deferred at 03:00 local, without using budget", () => {
    const oc = new OutreachController(new SimClock(NIGHT));
    const m = baseMember("a");
    for (const kind of ["reminder", "check_in", "scheduling", "relay"] as const) {
      const d = oc.decide(m, msg(kind, kind), []);
      expect(d).toMatchObject({ action: "defer", reason: "quiet_hours", countsAgainstBudget: false });
      if (d.action === "defer") expect(d.sendAt).toBeGreaterThan(NIGHT);
    }
  });

  test("replies and safety notices still go out at night", () => {
    const oc = new OutreachController(new SimClock(NIGHT));
    const m = baseMember("a");
    expect(oc.decide(m, msg("r", "reply"), []).action).toBe("send");
    expect(oc.decide(m, msg("s", "safety_notice"), []).action).toBe("send");
  });

  test("a paused member gets no reminder or check-in (held), but does get replies and notices", () => {
    const oc = new OutreachController(new SimClock(NIGHT + 8 * HOUR)); // daytime
    const m = baseMember("a", { state: "paused" });
    expect(oc.decide(m, msg("1", "reminder"), [])).toMatchObject({ action: "hold", reason: "paused" });
    expect(oc.decide(m, msg("2", "check_in"), [])).toMatchObject({ action: "hold", reason: "paused" });
    expect(oc.decide(m, msg("3", "reply"), []).action).toBe("send");
    expect(oc.decide(m, msg("4", "account_notice"), []).action).toBe("send");
  });

  test("a deferred reminder that would land after its expiry is dropped", () => {
    const oc = new OutreachController(new SimClock(NIGHT));
    expect(oc.decide(baseMember("a"), msg("1", "reminder", { expiresAt: NIGHT + 30 * MINUTE }), [])).toMatchObject({ action: "drop" });
  });

  test("an unknown time zone holds agent-initiated messages instead of using the server's zone", () => {
    const oc = new OutreachController(new SimClock(NIGHT), () => "Not/AZone");
    expect(oc.decide(baseMember("a"), msg("1", "reminder"), [])).toMatchObject({ action: "hold", reason: "unknown_timezone" });
    expect(oc.decide(baseMember("a"), msg("2", "invitation"), [])).toMatchObject({ action: "hold", reason: "unknown_timezone" });
    expect(oc.decide(baseMember("a"), msg("3", "reply"), []).action).toBe("send");
  });
});

describe("engine uses the core age policy", () => {
  test("13-17 and under-13 are never matchable; 18 is", async () => {
    const { isMinorAge, ADULT_AGE } = await import("../src/filters.ts");
    const core = await import("@thenetwork/core");
    expect(ADULT_AGE).toBe(core.ADULT_AGE);
    expect([12, 13, 17, 18].map(isMinorAge)).toEqual([true, true, true, false]);
    const inp = emptyInput(NOW);
    inp.members.push(baseMember("kid", { age: 12 }), baseMember("teen", { age: 15 }), baseMember("adult", { age: 18 }));
    const w = mkWorld(inp);
    expect(sendTimeReason(w, "kid")).toBe("underage");
    expect(sendTimeReason(w, "teen")).toBe("underage");
    expect(sendTimeReason(w, "adult")).toBeNull();
  });
});
