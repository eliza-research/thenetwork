import { describe, expect, test } from "bun:test";
import { SimClock } from "../../../packages/core/src/clock.ts";
import { ConsentLedger, defaultCopy, detectKeyword, handleKeyword } from "../src/keywords.ts";
import { isQuietAt, nextAllowedAt } from "../src/quiet-hours.ts";

describe("keyword detection", () => {
  test.each(["STOP", "stop", " Stop. ", "STOP!!", "unsubscribe", "Cancel", "end", "quit", "opt out", "OPT-OUT", "stopall", "revoke", "stop 🛑"])("%p -> opt_out", (t) => {
    expect(detectKeyword(t)).toBe("opt_out");
  });
  test.each(["START", "unstop", "Resume"])("%p -> opt_in", (t) => expect(detectKeyword(t)).toBe("opt_in"));
  test.each(["HELP", "help?", "Info"])("%p -> help", (t) => expect(detectKeyword(t)).toBe("help"));
  test.each(["stop by later?", "don't stop", "yes", "YES", "help me find a climbing partner", "the end of the week works", ""])("%p -> null", (t) => {
    expect(detectKeyword(t)).toBeNull();
  });
});

describe("consent ledger and keyword outcomes", () => {
  test("STOP opts out immediately, records source, replies once; START restores", () => {
    const clock = new SimClock();
    const l = new ConsentLedger(clock);
    l.record("blooio", "+15551234567", "opted_in", "invite_acceptance", "I agree to receive messages from The Network");
    const copy = defaultCopy();
    const out = handleKeyword(l, copy, { channel: "blooio", from: "+15551234567", text: "stop", isGroup: false });
    expect(out).toEqual({ action: "opt_out", reply: copy.optOut });
    expect(l.isOptedOut("blooio", "+15551234567")).toBe(true);
    expect(l.isOptedOut("twilio", "+15551234567")).toBe(true); // address-scoped: SMS fallback also stops
    expect(l.get("blooio", "+15551234567")?.source).toBe("keyword:STOP");
    handleKeyword(l, copy, { channel: "blooio", from: "+15551234567", text: "START", isGroup: false });
    expect(l.isOptedOut("blooio", "+15551234567")).toBe(false);
    expect(l.history.map((h) => h.state)).toEqual(["opted_in", "opted_out", "opted_in"]);
  });
  test("in a group, STOP applies to the sender but posts nothing to the group", () => {
    const l = new ConsentLedger(new SimClock());
    expect(handleKeyword(l, defaultCopy(), { channel: "blooio", from: "+1555", text: "STOP", isGroup: true })).toEqual({ action: "opt_out", reply: null });
    expect(l.isOptedOut("blooio", "+1555")).toBe(true);
  });
});

describe("quiet hours (default 21:00-09:00 recipient local)", () => {
  const at = (iso: string) => Date.parse(iso);
  test("same instant, different zones", () => {
    const t = at("2026-10-06T04:30:00Z"); // 21:30 PDT, 00:30 EDT
    expect(isQuietAt(t, "America/Los_Angeles")).toBe(true);
    expect(isQuietAt(at("2026-10-06T02:30:00Z"), "America/Los_Angeles")).toBe(false); // 19:30 PDT
    expect(isQuietAt(at("2026-10-05T23:30:00Z"), "America/New_York")).toBe(false); // 19:30 EDT
    expect(isQuietAt(at("2026-10-06T01:30:00Z"), "America/New_York")).toBe(true); // 21:30 EDT
  });
  test("boundaries are [start, end)", () => {
    expect(isQuietAt(at("2026-10-06T04:00:00Z"), "America/Los_Angeles")).toBe(true); // 21:00 PDT
    expect(isQuietAt(at("2026-10-06T03:59:00Z"), "America/Los_Angeles")).toBe(false); // 20:59
    expect(isQuietAt(at("2026-10-06T16:00:00Z"), "America/Los_Angeles")).toBe(false); // 09:00
    expect(isQuietAt(at("2026-10-06T15:59:00Z"), "America/Los_Angeles")).toBe(true); // 08:59
  });
  test("nextAllowedAt lands on 09:00 local", () => {
    expect(new Date(nextAllowedAt(at("2026-10-06T04:30:00Z"), "America/Los_Angeles")).toISOString()).toBe("2026-10-06T16:00:00.000Z");
    expect(new Date(nextAllowedAt(at("2026-10-06T05:30:00Z"), "America/New_York")).toISOString()).toBe("2026-10-06T13:00:00.000Z");
    const ok = at("2026-10-06T18:00:00Z");
    expect(nextAllowedAt(ok, "America/New_York")).toBe(ok);
  });
  test("DST fall-back night (2026-11-01, New York) still lands on 09:00 EST", () => {
    const t = at("2026-11-01T03:30:00Z"); // 23:30 EDT Oct 31
    expect(new Date(nextAllowedAt(t, "America/New_York")).toISOString()).toBe("2026-11-01T14:00:00.000Z"); // 09:00 EST
  });
  test("custom window and invalid zone", () => {
    expect(isQuietAt(at("2026-10-06T03:30:00Z"), "America/Los_Angeles", { startHour: 20, endHour: 8 })).toBe(true);
    expect(() => isQuietAt(0, "Mars/Olympus")).toThrow();
  });
});
