import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapitalLedger, JsonlCapitalStore, MemoryCapitalStore, effortOverlay, organizingReach, vouchCapacity, type CapitalEvent, type CapitalEventInput } from "../src/index.ts";

const DAY = 86_400_000, HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 5, 16);

/** A mixed event stream: joins, a vouch, help, plans, a no-show, a fraud clawback. */
function stream(): CapitalEvent[] {
  let n = 0;
  const out: CapitalEvent[] = [];
  const e = (x: CapitalEventInput) => out.push({ id: `s${++n}`, ...x } as CapitalEvent);
  for (const m of ["a", "b", "c", "d"]) e({ type: "member_joined", t: T0, member: m, age: 30 });
  e({ type: "member_joined", t: T0, member: "inv", age: 28, vouchedBy: "a" });
  e({ type: "member_activated", t: T0 + HOUR, member: "inv" });
  e({ type: "value_received", t: T0 + 2 * HOUR, member: "inv", with: ["c"], confirmedBy: ["c"] });
  for (let i = 0; i < 6; i++) {
    const t = T0 + (i + 1) * DAY;
    e({ type: "help_given", t, helper: "b", recipient: i % 2 ? "c" : "d", helpId: `h${i}` });
    e({ type: "help_confirmed", t, helpId: `h${i}`, recipient: i % 2 ? "c" : "d", useful: true });
    e({ type: "plan_accepted", t, member: "a", planId: `p${i}`, kind: "intro", startsAt: t + DAY });
    e({ type: "plan_confirmed", t: t + HOUR, member: "a", planId: `p${i}` });
    if (i === 3) e({ type: "plan_no_show", t: t + DAY, member: "a", planId: `p${i}` });
    else e({ type: "plan_attended", t: t + DAY, member: "a", planId: `p${i}`, counterparts: ["b"], verifiedBy: ["checkin"], origin: "engine", publicVenue: true });
    e({ type: "organized", t: t + DAY + HOUR, organizer: "d", planId: `o${i}`, publicVenue: true, recurring: true, attendees: ["a", "b"], label: "run club" });
  }
  e({ type: "fraud_confirmed", t: T0 + 10 * DAY, members: ["b", "c"] });
  return out.sort((x, y) => x.t - y.t);
}

const snapshot = (L: CapitalLedger, at: number) => ({
  entries: L.all(),
  levers: ["a", "b", "c", "d"].map(m => [L.balance(m), effortOverlay(L.internalEntries(m), at, L.cfg).tier, vouchCapacity(L.internalEntries(m), at, L.cfg), organizingReach(L.internalEntries(m), at, L.cfg).max]),
  audit: L.audit(),
});

describe("persistence (capital-5)", () => {
  test("replay of the stored log, with duplicates, gives the same ledger", () => {
    const store = new MemoryCapitalStore();
    const L = new CapitalLedger({}, { store });
    for (const ev of stream()) L.record(ev);
    const { events } = store.load();
    expect(events.length).toBe(stream().length);
    const withDupes = events.flatMap((e, i) => (i % 3 ? [e] : [e, e]));
    expect(snapshot(CapitalLedger.replay(withDupes), T0 + 11 * DAY)).toEqual(snapshot(L, T0 + 11 * DAY));
  });

  test("a restart from the JSONL file keeps balances, levers, audit trail and the time order", () => {
    const path = join(mkdtempSync(join(tmpdir(), "nc-")), "ledger.jsonl");
    const L = new CapitalLedger({}, { store: new JsonlCapitalStore(path) });
    for (const ev of stream()) L.record(ev);
    L.entriesFor({ staff: "s1", role: "audit", reason: "appeal 7" }, "a");
    const before = snapshot(L, T0 + 11 * DAY);
    expect(before.entries.length).toBeGreaterThan(10);

    const R = new CapitalLedger({}, { store: new JsonlCapitalStore(path) });
    expect(snapshot(R, T0 + 11 * DAY)).toEqual(before);
    // the restarted ledger still refuses back-dated events and appends new ones
    expect(() => R.record({ id: "old", type: "declined", t: T0, member: "a" })).toThrow();
    expect(R.record({ id: "new", type: "need_answered", t: T0 + 12 * DAY, member: "a", needId: "n", confirmedBy: "staff" })).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toContain('"id":"new"');
    expect(readFileSync(path, "utf8")).not.toContain('"id":"old"');
  });

  test("a torn last line (crash during the append) is dropped, and the next append starts clean", () => {
    const path = join(mkdtempSync(join(tmpdir(), "nc-")), "ledger.jsonl");
    const L = new CapitalLedger({}, { store: new JsonlCapitalStore(path) });
    L.record({ id: "j", type: "member_joined", t: T0, member: "a", age: 30 });
    appendFileSync(path, '{"event":{"id":"torn","ty');
    const R = new CapitalLedger({}, { store: new JsonlCapitalStore(path) });
    R.record({ id: "n", type: "need_answered", t: T0 + 1, member: "a", needId: "n", confirmedBy: "staff" });
    expect(new CapitalLedger({}, { store: new JsonlCapitalStore(path) }).balance("a")).toBe(3);
  });
});
