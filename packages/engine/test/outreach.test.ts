import { describe, expect, test } from "bun:test";
import { DAY, HOUR, SimClock, type ParticipationState } from "@thenetwork/core";
import {
  BUDGETS, inQuietHours, isProactive, localParts, nextWindowStart, OutreachController, unansweredStreak, windowStart,
  type OutboundMessage,
} from "../src/outreach.ts";
import { baseMember } from "./helpers.ts";

// Monday 2026-10-05 16:00 UTC = 09:00 PDT in SF.
const MON = Date.UTC(2026, 9, 5, 16);
const msg = (id: string, at: number, over: Partial<OutboundMessage> = {}): OutboundMessage => ({ id, memberId: "a", kind: "invitation", at, ...over });

describe("outreach controller (32.9, F28)", () => {
  test("what counts as proactive: initial invites only (founder decision 3)", () => {
    for (const k of ["invitation", "recommendation"] as const) expect(isProactive(k)).toBe(true);
    for (const k of ["profiling_question", "worthwhile_check", "reply", "scheduling", "reminder", "check_in", "relay", "safety_notice", "account_notice"] as const) expect(isProactive(k)).toBe(false);
  });

  test("profiling and feedback asks are not budgeted but follow the one-question rule", () => {
    const clock = new SimClock(MON);
    const oc = new OutreachController(clock);
    const m = baseMember("a", { state: "normal" });
    // Budget used up by two invites this week: an ask still goes out, and does not count.
    const hist = [msg("x1", MON - 2 * HOUR, { repliedAt: MON - HOUR }), msg("x2", MON - HOUR, { repliedAt: MON - 30 * 60_000 })];
    const d1 = oc.decide(m, msg("q1", MON, { kind: "profiling_question" }), hist);
    expect(d1).toMatchObject({ action: "send", countsAgainstBudget: false });
    hist.push(msg("q1", MON, { kind: "profiling_question" }));
    clock.advance(HOUR);
    expect(oc.decide(m, msg("q2", clock.now(), { kind: "worthwhile_check" }), hist)).toMatchObject({ action: "hold", reason: "one_question" });
    // Answered: the next ask may go. Unanswered asks never trip the two-unanswered pause.
    hist[2] = { ...hist[2]!, repliedAt: clock.now() };
    expect(oc.decide(m, msg("q3", clock.now(), { kind: "worthwhile_check" }), hist).action).toBe("send");
    expect(unansweredStreak([msg("q", MON - 10 * DAY, { kind: "profiling_question" }), msg("w", MON - 9 * DAY, { kind: "worthwhile_check" })], MON)).toBe(0);
  });

  test("budgets per state: Open 4/wk, Normal 2/wk, Quiet 1/mo, Paused 0", () => {
    expect(BUDGETS.open).toEqual({ limit: 4, period: "week" });
    expect(BUDGETS.normal).toEqual({ limit: 2, period: "week" });
    expect(BUDGETS.quiet).toEqual({ limit: 1, period: "month" });
    expect(BUDGETS.paused.limit).toBe(0);
    const expectSends = (state: ParticipationState, n: number) => {
      const clock = new SimClock(MON);
      const oc = new OutreachController(clock);
      const m = baseMember("a", { state });
      const hist: OutboundMessage[] = [];
      let sent = 0;
      for (let i = 0; i < 6; i++) {
        const d = oc.decide(m, msg(`m${i}`, clock.now()), hist);
        if (d.action === "send") { sent++; hist.push({ ...msg(`m${i}`, clock.now()), repliedAt: clock.now() + HOUR }); }
        clock.advance(2 * HOUR);
      }
      expect(sent).toBe(n);
    };
    expectSends("open", 4); expectSends("normal", 2); expectSends("quiet", 1); expectSends("paused", 0);
  });

  test("budget exhausted defers to next local week (Monday 00:00 local)", () => {
    const clock = new SimClock(MON);
    const oc = new OutreachController(clock);
    const m = baseMember("a", { state: "normal" });
    const hist = [msg("x1", MON - HOUR, { repliedAt: MON }), msg("x2", MON - 30 * 60_000, { repliedAt: MON })];
    const d = oc.decide(m, msg("n", MON), hist);
    expect(d.action).toBe("defer");
    if (d.action !== "defer") throw 0;
    expect(d.reason).toBe("budget_exhausted");
    const p = localParts(d.sendAt, "America/Los_Angeles");
    expect([p.weekday, p.hour, p.minute]).toEqual([0, 8, 0]); // next Monday 00:00 is quiet hours -> 08:00
    expect(d.sendAt - MON).toBeGreaterThan(6 * DAY);
  });

  test("week windows are in member local time (NYC vs SF)", () => {
    // Monday 05:00 UTC = Monday 01:00 EDT but still Sunday 22:00 PDT.
    const t = Date.UTC(2026, 9, 5, 5);
    expect(localParts(windowStart(t, "America/New_York", "week"), "America/New_York")).toMatchObject({ weekday: 0, hour: 0, day: 5 });
    expect(localParts(windowStart(t, "America/Los_Angeles", "week"), "America/Los_Angeles")).toMatchObject({ weekday: 0, hour: 0, day: 28 });
    expect(localParts(nextWindowStart(t, "America/Los_Angeles", "month"), "America/Los_Angeles")).toMatchObject({ day: 1, month: 11, hour: 0 });
  });

  test("monthly window across DST change (Nov 1 2026) stays at local midnight", () => {
    const t = Date.UTC(2026, 10, 15, 12);
    const s = windowStart(t, "America/Los_Angeles", "month");
    expect(localParts(s, "America/Los_Angeles")).toMatchObject({ day: 1, hour: 0, minute: 0, month: 11 });
  });

  test("quiet hours in local time defer to the end of quiet hours", () => {
    // 05:00 UTC Tuesday = 22:00 PDT Monday -> quiet [22,8)
    const t = Date.UTC(2026, 9, 6, 5);
    expect(inQuietHours(t, "America/Los_Angeles", [22, 8])).toBe(true);
    expect(inQuietHours(t, "America/New_York", [22, 8])).toBe(true); // 01:00 EDT
    // 03:00 UTC = 23:00 EDT (quiet) but 20:00 PDT (not quiet): local time matters
    expect(inQuietHours(Date.UTC(2026, 9, 6, 3), "America/New_York", [22, 8])).toBe(true);
    expect(inQuietHours(Date.UTC(2026, 9, 6, 3), "America/Los_Angeles", [22, 8])).toBe(false);
  });

  test("quiet hours deferral", () => {
    const t = Date.UTC(2026, 9, 6, 5); // 22:00 PDT
    const oc = new OutreachController(new SimClock(t));
    const d = oc.decide(baseMember("a"), msg("n", t), []);
    expect(d.action).toBe("defer");
    if (d.action !== "defer") throw 0;
    expect(d.reason).toBe("quiet_hours");
    expect(localParts(d.sendAt, "America/Los_Angeles").hour).toBe(8);
  });

  test("deferral past expiry drops the message", () => {
    const t = Date.UTC(2026, 9, 6, 5);
    const oc = new OutreachController(new SimClock(t));
    expect(oc.decide(baseMember("a"), msg("n", t, { expiresAt: t + 2 * HOUR }), []).action).toBe("drop");
  });

  test("two-unanswered rule: 72h or expiry, whichever first; pending ones do not count", () => {
    const now = MON + 10 * DAY;
    const h = [
      msg("1", now - 9 * DAY, { repliedAt: now - 9 * DAY + HOUR }),
      msg("2", now - 6 * DAY),                                         // unanswered (72h passed)
      msg("3", now - 2 * DAY, { expiresAt: now - 1 * DAY, repliedAt: now - 0.5 * DAY }), // replied after expiry -> unanswered
      msg("4", now - HOUR),                                            // pending
    ];
    expect(unansweredStreak(h, now)).toBe(2);
    const oc = new OutreachController(new SimClock(now));
    const m = baseMember("a");
    expect(oc.applyUnansweredRule(m, h)).toMatchObject({ onlyWhenAsked: true, changed: true });
    expect(oc.decide(m, msg("5", now), h)).toMatchObject({ action: "hold", reason: "only_when_asked" });
    // ...but in-opportunity messages and safety notices keep flowing
    expect(oc.decide(m, msg("6", now, { kind: "reminder" }), h).action).toBe("send");
    expect(oc.decide(m, msg("7", now, { kind: "safety_notice" }), h).action).toBe("send");
    // next inbound: visible notice and offer to resume
    expect(oc.onInbound(m, h).notice).toContain("turn them back on");
  });

  test("a reply within 72h breaks the streak", () => {
    const now = MON + 10 * DAY;
    expect(unansweredStreak([msg("1", now - 6 * DAY), msg("2", now - 5 * DAY, { repliedAt: now - 5 * DAY + 70 * HOUR })], now)).toBe(0);
  });

  test("Paused: no proactive outreach; Receiving: support-only; non-proactive never budgeted", () => {
    const oc = new OutreachController(new SimClock(MON));
    expect(oc.decide(baseMember("a", { state: "paused" }), msg("1", MON), []).action).toBe("drop");
    expect(oc.decide(baseMember("a", { state: "paused" }), msg("2", MON, { kind: "account_notice" }), []).action).toBe("send");
    expect(oc.decide(baseMember("a", { state: "receiving" }), msg("3", MON), [])).toMatchObject({ action: "hold" });
    expect(oc.decide(baseMember("a", { state: "receiving" }), msg("4", MON, { supportive: true }), []).action).toBe("send");
    const d = oc.decide(baseMember("a", { state: "normal" }), msg("5", MON, { kind: "scheduling" }), [msg("x", MON - HOUR), msg("y", MON - HOUR)]);
    expect(d).toMatchObject({ action: "send", countsAgainstBudget: false });
  });

  test("per-category preference respected; every decision logged with a reason", () => {
    const oc = new OutreachController(new SimClock(MON));
    const m = baseMember("a", { prefs: { categoriesOptIn: ["hobby"] } });
    expect(oc.decide(m, msg("1", MON, { category: "professional" }), [])).toMatchObject({ action: "drop", reason: "category_opt_out" });
    expect(oc.log.length).toBe(1);
    expect(oc.log[0]!.decision.action).toBe("drop");
  });

  test("bundling: priority ordering, one message for competing items", () => {
    const oc = new OutreachController(new SimClock(MON));
    const b = oc.bundle([msg("lo", MON, { priority: 1 }), msg("hi", MON, { priority: 5 }), msg("mid", MON, { priority: 3 }), msg("x", MON)], 3)!;
    expect(b.primary.id).toBe("hi");
    expect(b.bundled.map(x => x.id)).toEqual(["mid", "lo"]);
    expect(b.deferred.map(x => x.id)).toEqual(["x"]);
  });
});

describe("over-budget deferral counts what is already deferred (audit P2-12)", () => {
  test("three messages against a budget of 2: the third waits for the window after", () => {
    const clock = new SimClock(MON);
    const oc = new OutreachController(clock);
    const m = baseMember("a", { state: "normal" });
    const hist: OutboundMessage[] = [msg("x1", MON - 2 * HOUR, { repliedAt: MON - HOUR }), msg("x2", MON - HOUR, { repliedAt: MON - HOUR })];
    const sendAts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const d = oc.decide(m, msg(`n${i}`, MON), hist);
      expect(d.action).toBe("defer");
      if (d.action !== "defer") throw 0;
      sendAts.push(d.sendAt);
      hist.push(msg(`n${i}`, d.sendAt)); // the deferred message is queued at its send time
    }
    expect(sendAts[0]).toBe(sendAts[1]);
    expect(sendAts[2]! - sendAts[0]!).toBeGreaterThanOrEqual(6 * DAY);
    expect(localParts(sendAts[2]!, "America/Los_Angeles").weekday).toBe(0);
  });
  test("the caps are the attention budget's caps (one definition, P2-13)", () => {
    expect(BUDGETS.normal.limit).toBe(2);
    expect(BUDGETS.open.limit).toBe(4);
    expect(BUDGETS.quiet).toEqual({ limit: 1, period: "month" });
  });
});
