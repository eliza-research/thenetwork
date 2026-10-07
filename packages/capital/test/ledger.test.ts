import { describe, expect, test } from "bun:test";
import { CapitalLedger, type CapitalEventInput, detectGaming, effortOverlay, effortTier, organizingReach, vouchCapacity, whatYouBuilt, EFFORT_TABLE, OVERLAY_ENGINE_KEYS, DEFAULT_CAPITAL, type CapitalEvent } from "../src/index.ts";

const DAY = 86_400_000, HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 5, 16);
let seq = 0;
const ev = (e: CapitalEventInput): CapitalEvent => ({ id: `e${++seq}`, ...e }) as CapitalEvent;

function world(members: Record<string, number | null> = { a: 30, b: 31, c: 32, d: 33 }, cfg = {}) {
  const L = new CapitalLedger(cfg);
  for (const [m, age] of Object.entries(members)) L.record(ev({ type: "member_joined", t: T0, member: m, age }));
  return L;
}
/** a and others accept, confirm, attend a plan at time t (engine-started, checked in). */
function attend(L: CapitalLedger, member: string, planId: string, t: number, counterparts: string[], o: { origin?: "engine" | "member"; verifiedBy?: ("counterpart" | "checkin")[] } = {}) {
  L.record(ev({ type: "plan_accepted", t, member, planId, kind: "intro", startsAt: t + DAY }));
  L.record(ev({ type: "plan_confirmed", t: t + DAY / 2, member, planId }));
  return L.record(ev({ type: "plan_attended", t: t + DAY, member, planId, counterparts, verifiedBy: o.verifiedBy ?? ["checkin"], origin: o.origin ?? "engine", publicVenue: true }));
}
function plan(L: CapitalLedger, member: string, planId: string, t: number, startsAt = t + DAY, confirm = true) {
  L.record(ev({ type: "plan_accepted", t, member, planId, kind: "intro", startsAt }));
  if (confirm) L.record(ev({ type: "plan_confirmed", t: t + 1, member, planId }));
}

describe("vouch", () => {
  const invite = (L: CapitalLedger, t = T0) => L.record(ev({ type: "member_joined", t, member: "inv", age: 28, vouchedBy: "a" }));

  test("credit needs activation, value from someone other than the voucher within 30 days, and no safety flags", () => {
    const L = world(); invite(L);
    expect(L.record(ev({ type: "member_activated", t: T0 + DAY, member: "inv" }))).toEqual([]);
    expect(L.record(ev({ type: "value_received", t: T0 + 2 * DAY, member: "inv", with: ["a"] }))).toEqual([]); // voucher only
    const out = L.record(ev({ type: "value_received", t: T0 + 3 * DAY, member: "inv", with: ["b"] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe("vouch");
    expect(out[0]!.member).toBe("a");
    expect(out[0]!.amount).toBe(10);
    // only once
    expect(L.record(ev({ type: "value_received", t: T0 + 4 * DAY, member: "inv", with: ["c"] }))).toEqual([]);
  });

  test("value after 30 days earns nothing", () => {
    const L = world(); invite(L);
    L.record(ev({ type: "member_activated", t: T0 + DAY, member: "inv" }));
    expect(L.record(ev({ type: "value_received", t: T0 + 31 * DAY, member: "inv", with: [] }))).toEqual([]);
  });

  test("any safety flag before the credit blocks it; a minor flag after it changes nothing", () => {
    const L = world(); invite(L);
    L.record(ev({ type: "safety_flag", t: T0 + DAY, member: "inv", serious: false }));
    L.record(ev({ type: "member_activated", t: T0 + DAY, member: "inv" }));
    expect(L.record(ev({ type: "value_received", t: T0 + 2 * DAY, member: "inv", with: [] }))).toEqual([]);

    const L2 = world(); invite(L2);
    L2.record(ev({ type: "member_activated", t: T0 + DAY, member: "inv" }));
    L2.record(ev({ type: "value_received", t: T0 + 2 * DAY, member: "inv", with: [] }));
    expect(L2.record(ev({ type: "safety_flag", t: T0 + 3 * DAY, member: "inv", serious: false }))).toEqual([]);
    expect(L2.balance("a")).toBe(10);
  });

  test("stake is lost only for removal for serious abuse within 90 days; credit is reversed", () => {
    const L = world(); invite(L);
    L.record(ev({ type: "member_activated", t: T0 + DAY, member: "inv" }));
    L.record(ev({ type: "value_received", t: T0 + 2 * DAY, member: "inv", with: [] }));
    const out = L.record(ev({ type: "member_removed", t: T0 + 40 * DAY, member: "inv", reason: "serious_abuse" }));
    expect(out.map(e => e.category).sort()).toEqual(["clawback", "vouch_stake"]);
    expect(L.balance("a")).toBe(-10);
    expect(L.record(ev({ type: "member_removed", t: T0 + 41 * DAY, member: "inv", reason: "serious_abuse" }))).toEqual([]);
  });

  test("no stake loss after 90 days, for leaving, or for quiet / declining invitees", () => {
    const L = world(); invite(L);
    L.record(ev({ type: "declined", t: T0 + DAY, member: "inv" }));
    L.record(ev({ type: "state_changed", t: T0 + DAY, member: "inv", state: "quiet" }));
    expect(L.record(ev({ type: "member_removed", t: T0 + 2 * DAY, member: "inv", reason: "left" }))).toEqual([]);
    const L2 = world(); invite(L2);
    expect(L2.record(ev({ type: "member_removed", t: T0 + 91 * DAY, member: "inv", reason: "serious_abuse" }))).toEqual([]);
    expect(L.balance("a") + L2.balance("a")).toBe(0);
  });
});

describe("attendance, help, organizing, needs, review", () => {
  test("attendance credit needs an accepted plan and verification", () => {
    const L = world();
    expect(L.record(ev({ type: "plan_attended", t: T0, member: "a", planId: "p0", counterparts: ["b"], verifiedBy: ["checkin"], origin: "engine", publicVenue: true }))).toEqual([]);
    expect(attend(L, "a", "p1", T0, ["b"])[0]!.amount).toBe(2);
    L.record(ev({ type: "plan_accepted", t: T0 + 2 * DAY, member: "a", planId: "p2", kind: "intro", startsAt: T0 + 3 * DAY }));
    expect(L.record(ev({ type: "plan_attended", t: T0 + 3 * DAY, member: "a", planId: "p2", counterparts: ["c"], verifiedBy: [], origin: "engine", publicVenue: true }))).toEqual([]);
  });

  test("feedback earns a little, once per attended plan", () => {
    const L = world(); attend(L, "a", "p1", T0, ["b"]);
    expect(L.record(ev({ type: "feedback_given", t: T0 + 2 * DAY, member: "a", planId: "p1" }))).toHaveLength(1);
    expect(L.record(ev({ type: "feedback_given", t: T0 + 2 * DAY, member: "a", planId: "p1" }))).toEqual([]);
    expect(L.record(ev({ type: "feedback_given", t: T0 + 2 * DAY, member: "a", planId: "nope" }))).toEqual([]);
  });

  test("help needs the recipient's confirmation that it was useful", () => {
    const L = world();
    expect(L.record(ev({ type: "help_given", t: T0, helper: "a", recipient: "b", helpId: "h1" }))).toEqual([]);
    expect(L.record(ev({ type: "help_confirmed", t: T0 + 1, helpId: "h1", recipient: "c", useful: true }))).toEqual([]); // wrong person
    expect(L.record(ev({ type: "help_confirmed", t: T0 + 2, helpId: "h1", recipient: "b", useful: true }))[0]!.amount).toBe(3);
    L.record(ev({ type: "help_given", t: T0 + 3, helper: "a", recipient: "c", helpId: "h2" }));
    expect(L.record(ev({ type: "help_confirmed", t: T0 + 4, helpId: "h2", recipient: "c", useful: false }))).toEqual([]);
    L.record(ev({ type: "help_given", t: T0 + 5, helper: "a", recipient: "a", helpId: "self" }));
    expect(L.record(ev({ type: "help_confirmed", t: T0 + 6, helpId: "self", recipient: "a", useful: true }))).toEqual([]);
  });

  test("organizing credit only at public venues with enough attendees", () => {
    const L = world();
    expect(L.record(ev({ type: "organized", t: T0, organizer: "a", planId: "o1", publicVenue: false, recurring: true, attendees: ["b", "c"], label: "climbing night" }))).toEqual([]);
    expect(L.record(ev({ type: "organized", t: T0, organizer: "a", planId: "o2", publicVenue: true, recurring: true, attendees: ["b", "a"], label: "climbing night" }))).toEqual([]);
    expect(L.record(ev({ type: "organized", t: T0, organizer: "a", planId: "o3", publicVenue: true, recurring: true, attendees: ["b", "c"], label: "climbing night" }))[0]!.category).toBe("organizing");
  });

  test("needs answered and review earn", () => {
    const L = world();
    expect(L.record(ev({ type: "need_answered", t: T0, member: "a", needId: "n1", confirmedBy: "staff" }))[0]!.amount).toBe(3);
    expect(L.record(ev({ type: "review_completed", t: T0, member: "a", items: 3 }))[0]!.amount).toBe(3);
  });
});

describe("losing NC", () => {
  test("cancelling before the cutoff is free; a late cancel after confirming counts as a no-show", () => {
    const L = world();
    plan(L, "a", "p1", T0, T0 + DAY);
    expect(L.record(ev({ type: "plan_cancelled", t: T0 + DAY - 5 * HOUR, member: "a", planId: "p1" }))).toEqual([]);
    plan(L, "a", "p2", T0 + DAY, T0 + 2 * DAY);
    const late = L.record(ev({ type: "plan_cancelled", t: T0 + 2 * DAY - HOUR, member: "a", planId: "p2" }));
    expect(late[0]!.category).toBe("no_show");
    expect(late[0]!.provenance.forgiven).toBe(true); // first one forgiven
  });

  test("one no-show forgiven per 90 days, then each costs; no cost without confirming", () => {
    const L = world();
    plan(L, "a", "p1", T0); expect(L.record(ev({ type: "plan_no_show", t: T0 + DAY, member: "a", planId: "p1" }))[0]!.amount).toBe(0);
    plan(L, "a", "p2", T0 + 2 * DAY); expect(L.record(ev({ type: "plan_no_show", t: T0 + 3 * DAY, member: "a", planId: "p2" }))[0]!.amount).toBe(-3);
    plan(L, "a", "p3", T0 + 4 * DAY, T0 + 5 * DAY, false); expect(L.record(ev({ type: "plan_no_show", t: T0 + 5 * DAY, member: "a", planId: "p3" }))).toEqual([]);
    plan(L, "a", "p4", T0 + 100 * DAY); expect(L.record(ev({ type: "plan_no_show", t: T0 + 101 * DAY, member: "a", planId: "p4" }))[0]!.amount).toBe(0);
  });

  test("ghosting after accepting costs; abuse is a penalty", () => {
    const L = world();
    plan(L, "a", "p1", T0, T0 + DAY, false);
    expect(L.record(ev({ type: "plan_ghosted", t: T0 + DAY, member: "a", planId: "p1" }))[0]!.amount).toBe(-2);
    expect(L.record(ev({ type: "abuse_confirmed", t: T0 + DAY, member: "b", kind: "harassment" }))[0]!.amount).toBe(-20);
  });

  test("fraud claws back credits earned with the ring and adds a penalty; honest credit stays", () => {
    const L = world();
    attend(L, "a", "honest", T0, ["d"]);
    L.record(ev({ type: "help_given", t: T0 + 2 * DAY, helper: "a", recipient: "b", helpId: "h" }));
    L.record(ev({ type: "help_confirmed", t: T0 + 2 * DAY, helpId: "h", recipient: "b", useful: true }));
    const before = L.balance("a");
    const out = L.record(ev({ type: "fraud_confirmed", t: T0 + 3 * DAY, members: ["a", "b"] }));
    expect(out.filter(e => e.member === "a").map(e => e.category).sort()).toEqual(["clawback", "fraud"]);
    expect(L.balance("a")).toBe(before - 3 - 10);
    expect(L.balance("a")).toBe(2 - 10);
  });

  test("declines, states, data sharing, asking and inactivity never write entries", () => {
    const L = world();
    const t = T0 + DAY;
    for (const e of [
      ev({ type: "declined", t, member: "a", planId: "x" }), ev({ type: "state_changed", t, member: "a", state: "quiet" }),
      ev({ type: "state_changed", t, member: "a", state: "receiving" }), ev({ type: "state_changed", t, member: "a", state: "paused" }),
      ev({ type: "data_shared", t, member: "a" }), ev({ type: "help_asked", t, member: "a" }),
    ] as CapitalEvent[]) expect(L.record(e)).toEqual([]);
    expect(L.balance("a")).toBe(0);
    // paused for months, then a normal attendance earns the normal credit (no decay)
    expect(attend(L, "a", "p", T0 + 200 * DAY, ["b"])[0]!.amount).toBe(2);
  });
});

describe("exclusions and privacy", () => {
  test("members aged 13-17 and unknown ages get no entries", () => {
    const L = world({ teen: 15, unknown: null, adult: 30 });
    expect(attend(L, "teen", "p", T0, ["adult"])).toEqual([]);
    expect(attend(L, "unknown", "p", T0 + 2 * DAY, ["adult"])).toEqual([]);
    expect(L.record(ev({ type: "abuse_confirmed", t: T0 + 4 * DAY, member: "teen", kind: "spam" }))).toEqual([]);
    expect(L.record(ev({ type: "review_completed", t: T0 + 4 * DAY, member: "never-joined", items: 1 }))).toEqual([]);
    expect(L.all().every(e => e.member === "adult")).toBe(true);
  });

  test("entries are private: other members cannot read them; staff reads are audited", () => {
    const L = world(); attend(L, "a", "p", T0, ["b"]);
    expect(L.entriesFor({ member: "a" }, "a")).toHaveLength(1);
    expect(() => L.entriesFor({ member: "b" }, "a")).toThrow();
    expect(() => L.entriesFor({ staff: "s1", role: "audit", reason: "" }, "a")).toThrow();
    L.entriesFor({ staff: "s1", role: "audit", reason: "appeal 12" }, "a");
    expect(L.audit()).toHaveLength(1);
  });

  test("append-only: entries are frozen, events idempotent, time order enforced", () => {
    const L = world();
    const e = ev({ type: "need_answered", t: T0 + DAY, member: "a", needId: "n", confirmedBy: "staff" });
    const [x] = L.record(e);
    expect(() => { (x as { amount: number }).amount = 99; }).toThrow();
    expect(L.record(e)).toEqual([]);
    expect(() => L.record(ev({ type: "declined", t: T0, member: "a" }))).toThrow();
  });
});

describe("anti-gaming", () => {
  test("credit diminishes per counterpart pair", () => {
    const L = world();
    const amounts = [0, 1, 2, 3].map(i => attend(L, "a", `p${i}`, T0 + i * 2 * DAY, ["b"])[0]!.amount);
    expect(amounts[1]!).toBeLessThan(amounts[0]! * 0.6);
    expect(amounts[3]!).toBeLessThan(0.2);
    // a new person is full price again (modulo the category decay)
    expect(attend(L, "a", "new", T0 + 9 * DAY, ["c"])[0]!.amount).toBeGreaterThan(1.3);
  });

  test("credit diminishes per category per period and is capped per period", () => {
    const L = world({ a: 30, ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}`, 30])) }, { antiGaming: { periodCap: 20 } });
    const amounts: number[] = [];
    for (let i = 0; i < 40; i++) {
      L.record(ev({ type: "help_given", t: T0 + i * HOUR, helper: "a", recipient: `m${i}`, helpId: `h${i}` }));
      amounts.push(L.record(ev({ type: "help_confirmed", t: T0 + i * HOUR, helpId: `h${i}`, recipient: `m${i}`, useful: true }))[0]!.amount);
    }
    expect(amounts[6]!).toBeLessThan(amounts[0]! * 0.6);
    expect(L.balance("a")).toBeCloseTo(20, 5);
    expect(amounts.at(-1)).toBe(0);
    // after the period the room comes back
    L.record(ev({ type: "help_given", t: T0 + 32 * DAY, helper: "a", recipient: "m50", helpId: "late" }));
    expect(L.record(ev({ type: "help_confirmed", t: T0 + 32 * DAY, helpId: "late", recipient: "m50", useful: true }))[0]!.amount).toBe(3);
  });

  test("reciprocal help ring is flagged; one-way honest help is not", () => {
    const L = world({ a: 30, b: 30, c: 30, h: 30, ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`r${i}`, 30])) });
    let t = T0;
    const help = (x: string, y: string) => {
      const id = `h${++seq}`; t += HOUR;
      L.record(ev({ type: "help_given", t, helper: x, recipient: y, helpId: id }));
      L.record(ev({ type: "help_confirmed", t, helpId: id, recipient: y, useful: true }));
    };
    for (let i = 0; i < 4; i++) { help("a", "b"); help("b", "c"); help("c", "a"); help("b", "a"); }
    for (let i = 0; i < 8; i++) help("h", `r${i}`);
    const flags = detectGaming(L.all(), t);
    const ring = flags.filter(f => f.kind === "reciprocal_ring");
    expect(ring.length).toBeGreaterThan(0);
    expect(ring.every(f => !f.members.includes("h"))).toBe(true);
    expect(new Set(ring.flatMap(f => f.members))).toEqual(new Set(["a", "b", "c"]));
  });

  test("staged meetups are flagged; checked-in engine plans with the same people are not", () => {
    const L = world();
    for (let i = 0; i < 3; i++) {
      const b = T0 + i * 8 * DAY;
      attend(L, "a", `s${i}`, b, ["b"], { origin: "member", verifiedBy: ["counterpart"] });
      attend(L, "b", `s${i}`, b + 2 * DAY, ["a"], { origin: "member", verifiedBy: ["counterpart"] });
      attend(L, "c", `e${i}`, b + 4 * DAY, ["d"]);
      attend(L, "d", `e${i}`, b + 6 * DAY, ["c"]);
    }
    const flags = detectGaming(L.all(), T0 + 25 * DAY).filter(f => f.kind === "staged_meetup");
    expect(flags.map(f => f.members)).toEqual([["a", "b"]]);
  });

  test("vouch ring: value from the voucher's close circle earns no vouch credit; ties formed afterwards are flagged", () => {
    const L = world();
    const helpPair = (t: number) => {
      for (const [x, y] of [["a", "b"], ["b", "a"]]) {
        const id = `v${++seq}`;
        L.record(ev({ type: "help_given", t, helper: x!, recipient: y!, helpId: id }));
        L.record(ev({ type: "help_confirmed", t, helpId: id, recipient: y!, useful: true }));
      }
    };
    helpPair(T0);
    L.record(ev({ type: "member_joined", t: T0 + 1, member: "syb", age: 25, vouchedBy: "a" }));
    L.record(ev({ type: "member_activated", t: T0 + 2, member: "syb" }));
    expect(L.record(ev({ type: "value_received", t: T0 + 3, member: "syb", with: ["b"] }))).toEqual([]);

    const L2 = world();
    L2.record(ev({ type: "member_joined", t: T0 + 1, member: "syb", age: 25, vouchedBy: "a" }));
    L2.record(ev({ type: "member_activated", t: T0 + 2, member: "syb" }));
    expect(L2.record(ev({ type: "value_received", t: T0 + 3, member: "syb", with: ["b"] }))[0]!.category).toBe("vouch");
    for (const [x, y] of [["a", "b"], ["b", "a"]]) {
      const id = `w${++seq}`;
      L2.record(ev({ type: "help_given", t: T0 + 4, helper: x!, recipient: y!, helpId: id }));
      L2.record(ev({ type: "help_confirmed", t: T0 + 4, helpId: id, recipient: y!, useful: true }));
    }
    const f = detectGaming(L2.all(), T0 + DAY).find(f => f.kind === "vouch_ring");
    expect(f?.members).toEqual(["a", "b", "syb"]);
  });

  test("engine-made intros never create ring flags, however often the same people meet", () => {
    const L = world();
    for (let i = 0; i < 6; i++) {
      attend(L, "a", `x${i}`, T0 + i * 4 * DAY, ["b"], { verifiedBy: ["counterpart"] });
      attend(L, "b", `x${i}`, T0 + i * 4 * DAY + 2 * DAY, ["a"], { verifiedBy: ["counterpart"] });
    }
    expect(detectGaming(L.all(), T0 + 25 * DAY)).toEqual([]);
  });
});

describe("levers", () => {
  test("effort: everyone gets the floor, the top is capped, returns diminish", () => {
    expect(effortTier(-500)).toBe(0);
    expect(effortTier(0)).toBe(0);
    expect(effortTier(1e9)).toBe(3);
    const idx = [0, 1, 2, 3].map(t => EFFORT_TABLE[t as 0].effortIndex);
    expect(idx[0]).toBe(1);
    expect(Math.max(...idx)).toBeLessThanOrEqual(1.25);
    const steps = idx.slice(1).map((x, i) => x - idx[i]!);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThanOrEqual(steps[i - 1]!);
    // thresholds grow faster than the index: each tier needs more NC than the last
    const th = [0, ...DEFAULT_CAPITAL.levers.effortThresholds];
    for (let i = 2; i < th.length; i++) expect(th[i]! - th[i - 1]!).toBeGreaterThan(th[i - 1]! - th[i - 2]!);
  });

  test("overlay is the floor for a member with no entries and only touches effort knobs", () => {
    const o = effortOverlay([]);
    expect(o.tier).toBe(0);
    expect(o.engine).toEqual({ judge: { topK: 10, groupTopK: 3, deep: { enabled: false } } });
    expect(o.network.intentReSearchDays).toBe(3);
    for (const t of [0, 1, 2, 3] as const) {
      expect(Object.keys(EFFORT_TABLE[t].engine).every(k => (OVERLAY_ENGINE_KEYS as readonly string[]).includes(k))).toBe(true);
      expect(Object.keys(EFFORT_TABLE[t].engine.judge!).sort()).toEqual(["deep", "groupTopK", "topK"]);
    }
  });

  test("vouch capacity grows with good vouches, shrinks with lost stakes, locks after abuse", () => {
    const L = world();
    expect(vouchCapacity(L.internalEntries("a"))).toBe(2);
    for (let i = 0; i < 2; i++) {
      L.record(ev({ type: "member_joined", t: T0 + i, member: `g${i}`, age: 30, vouchedBy: "a" }));
      L.record(ev({ type: "member_activated", t: T0 + i, member: `g${i}` }));
      L.record(ev({ type: "value_received", t: T0 + i, member: `g${i}`, with: [] }));
    }
    expect(vouchCapacity(L.internalEntries("a"))).toBe(4);
    L.record(ev({ type: "member_joined", t: T0 + 5, member: "bad", age: 30, vouchedBy: "a" }));
    L.record(ev({ type: "member_removed", t: T0 + 6, member: "bad", reason: "serious_abuse" }));
    expect(vouchCapacity(L.internalEntries("a"))).toBe(2);
    L.record(ev({ type: "abuse_confirmed", t: T0 + 7, member: "a", kind: "spam" }));
    expect(vouchCapacity(L.internalEntries("a"))).toBe(0);
  });

  test("organizing reach grows with sessions, capped, extra slots reserved for low exposure, reduced after abuse", () => {
    const L = world({ a: 30, ...Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`m${i}`, 30])) });
    expect(organizingReach(L.internalEntries("a"))).toEqual({ max: 8, reservedForLowExposure: 0 });
    for (let i = 0; i < 40; i++) L.record(ev({ type: "organized", t: T0 + i * DAY, organizer: "a", planId: `o${i}`, publicVenue: true, recurring: true, attendees: [`m${2 * i}`, `m${2 * i + 1}`], label: "run club" }));
    expect(organizingReach(L.internalEntries("a"))).toEqual({ max: 16, reservedForLowExposure: 8 });
    L.record(ev({ type: "abuse_confirmed", t: T0 + 41 * DAY, member: "a", kind: "policy" }));
    expect(organizingReach(L.internalEntries("a"))).toEqual({ max: 4, reservedForLowExposure: 0 });
  });
});

describe("what you've built", () => {
  test("a story with no number, clawed-back items left out", () => {
    const L = world();
    L.record(ev({ type: "member_joined", t: T0, member: "inv", age: 30, vouchedBy: "a" }));
    L.record(ev({ type: "member_activated", t: T0, member: "inv" }));
    L.record(ev({ type: "value_received", t: T0, member: "inv", with: [] }));
    for (const r of ["b", "c"]) {
      L.record(ev({ type: "help_given", t: T0, helper: "a", recipient: r, helpId: `hh${r}` }));
      L.record(ev({ type: "help_confirmed", t: T0, helpId: `hh${r}`, recipient: r, useful: true }));
    }
    for (let i = 0; i < 2; i++) L.record(ev({ type: "organized", t: T0 + i, organizer: "a", planId: `c${i}`, publicVenue: true, recurring: true, attendees: ["b", "c"], label: "climbing night" }));
    const s = whatYouBuilt(L.entriesFor({ member: "a" }, "a"));
    expect(s).toBe("You've vouched for someone who is now active; you've helped 2 members; you organized 2 climbing nights.");
    expect(s).not.toMatch(/NC|point|score|tier|balance|\+/i);
    const bal = String(L.balance("a"));
    expect(s.includes(bal)).toBe(false);
    L.record(ev({ type: "fraud_confirmed", t: T0 + 5, members: ["a", "b", "c"] }));
    expect(whatYouBuilt(L.entriesFor({ member: "a" }, "a"))).toBe("You've vouched for someone who is now active.");
  });

  test("empty history", () => {
    expect(whatYouBuilt([])).toMatch(/^Nothing here yet/);
  });
});
