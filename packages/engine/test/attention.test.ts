// Attention budget (docs/design/2026-10-07-experience-design.md section 1, Phase 1; founder
// defaults D1-D18): cost function, cap math, digest packing, quiet hours, hold queue,
// consent-first probes (D5), re-engagement (D6), learned cadence never increases frequency (D11).
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import * as A from "../src/attention.ts";
import { DEFAULT_ATTENTION, engineSupplyBudgets, resolveAttention } from "../src/config.ts";
import { privateVocabulary } from "../src/explain.ts";
import { eligibilityFor } from "../src/filters.ts";
import { checkMemberFacing } from "../src/judgeCommon.ts";
import { localParts } from "../src/outreach.ts";
import { randomWorld } from "../src/testkit.ts";
import type { AttentionItem, AttentionLedgerEntry, EngineProposal, HeldItem } from "../src/types.ts";
import { baseMember, emptyInput, facet, mkWorld, NOW } from "./helpers.ts";

// NOW = Monday 2026-10-05 16:00 UTC = 09:00 PDT.
const T = NOW + 6 * HOUR; // Monday 15:00 PDT: not quiet hours
const LA = "America/Los_Angeles";

const item = (id: string, over: Partial<AttentionItem> = {}): AttentionItem => ({
  id, memberId: "a", kind: "intro_probe", category: "social", others: [`x${id}`], involvesMember: true, effort: "meet_short",
  enjoy: 0.6, accept: 0.5, urgency: { expiresAt: NOW + 10 * DAY }, createdAt: NOW, reviewState: "approved", key: `k${id}`, stage: "first", ...over,
});
const member = (over: Partial<A.MemberAttention> = {}): A.MemberAttention => ({
  memberId: "a", state: "normal", age: 30, tz: LA, quietHours: [21, 9], onlyWhenAsked: false, prefs: A.defaultCadence("normal"), ...over,
});
/** The iteration-1 founder default (D2): a weekly Thursday 18:00 digest; still available on request. */
const weeklyPrefs = () => ({ ...A.defaultCadence("normal"), digestDays: [4], digestHour: 18 });
const entry = (messageId: string, at: number, over: Partial<AttentionLedgerEntry> = {}): AttentionLedgerEntry => ({
  messageId, memberId: "a", at, kind: "digest", itemIds: [], countsAgainstCap: true, repliedAt: at + HOUR, replyKind: "pick", ...over,
});
const compose = (over: Partial<A.ComposeInput> = {}) => A.composeMessage({
  member: member(), items: [], ledger: [], conversation: { outboundSinceInbound: 0 }, now: T, mode: "digest", ...over,
});
const held = (it: AttentionItem): HeldItem => ({ ...it, heldReason: "digest_wait", heldAt: NOW, revalidateAt: NOW + DAY });

describe("cost function (1.3)", () => {
  test("V = Ê x sqrt(P̂acc) x w_kind x w_m x u", () => {
    const it = item("1", { enjoy: 0.6, accept: 0.25 });
    expect(A.itemValue(it, { categoryWeight: {} })).toBeCloseTo(0.3, 9);
    expect(A.itemValue(it, { categoryWeight: { social: 1.5 } })).toBeCloseTo(0.45, 9); // "more of"
    expect(A.itemValue(it, { categoryWeight: { social: 0 } })).toBe(0); // off
    expect(A.itemValue({ ...it, kind: "event_suggestion" }, { categoryWeight: {} })).toBeCloseTo(0.21, 9);
    expect(A.itemValue({ ...it, kind: "place_suggestion" }, { categoryWeight: {} })).toBeCloseTo(0.15, 9);
    // u(t) = 1.3 for an item that expires before the next digest slot.
    expect(A.itemValue(it, { categoryWeight: {} }, DEFAULT_ATTENTION, NOW + 20 * DAY)).toBeCloseTo(0.39, 9);
    // Profiling questions are worth their expected value of information, capped at 0.5.
    expect(A.kindWeight({ kind: "profiling_question", evi: 0.2 })).toBe(0.2);
    expect(A.kindWeight({ kind: "profiling_question", evi: 0.9 })).toBe(0.5);
  });

  test("A(M) = 1 + Σ e_i (1 - Ê_i): the buzz plus effort weighted by the chance it is wasted", () => {
    expect(A.attentionCost([])).toBe(1);
    expect(A.attentionCost([{ effort: "meet_short", enjoy: 0.6 }])).toBeCloseTo(1.16, 9);
    expect(A.attentionCost([{ effort: "glance", enjoy: 0.9 }, { effort: "contribute", enjoy: 0.5 }])).toBeCloseTo(1 + 0.01 + 0.4, 9);
    // A confident glance is nearly free; an uncertain contribute ask is expensive.
    expect(A.attentionCost([{ effort: "glance", enjoy: 0.95 }]) - 1).toBeLessThan(0.01);
    expect(A.attentionCost([{ effort: "contribute", enjoy: 0.2 }]) - 1).toBeCloseTo(0.64, 9);
  });

  test("λ = λ_state x (1 + used/cap)^2 x r", () => {
    const m = member();
    expect(A.shadowPrice(m, 0, 2, 1)).toBeCloseTo(0.25, 9);
    expect(A.shadowPrice(m, 1, 2, 1)).toBeCloseTo(0.25 * 2.25, 9);
    expect(A.shadowPrice(m, 1, 2, 1.5)).toBeCloseTo(0.25 * 2.25 * 1.5, 9);
    expect(A.shadowPrice({ ...m, state: "open" }, 0, 4, 1)).toBeCloseTo(0.15, 9);
    expect(A.shadowPrice({ ...m, state: "quiet" }, 0, 1, 1)).toBeCloseTo(0.5, 9);
    expect(A.shadowPrice({ ...m, state: "paused" }, 0, 2, 1)).toBe(Infinity);
    expect(A.shadowPrice(m, 0, 0, 1)).toBe(Infinity);
    expect(A.shadowPrice({ ...m, newcomer: true }, 0, 2, 1)).toBeCloseTo(0.2, 9);
    expect(A.shadowPrice({ ...m, age: 15, state: "open" }, 0, 1, 1)).toBeCloseTo(0.25, 9);
    expect(A.messageUtility([0.3, 0.2], 1.2, 0.25)).toBeCloseTo(0.2, 9);
    expect(A.messageUtility([1], 1, Infinity)).toBe(-Infinity);
  });

  test("annoyance r: x1.25 unanswered, x1.5 'less', x0.8 explicit 'more'; clamped to [0.5, 3]", () => {
    expect(A.annoyance([], "a", T)).toBe(1);
    const un = entry("m1", NOW, { repliedAt: undefined, replyKind: undefined });
    expect(A.annoyance([un], "a", NOW + 72 * HOUR)).toBeCloseTo(1.25, 6);
    expect(A.annoyance([un], "a", NOW + 71 * HOUR)).toBe(1); // still pending
    expect(A.annoyance([entry("m1", NOW, { replyKind: "less" })], "a", NOW + HOUR)).toBeCloseTo(1.5, 6);
    expect(A.annoyance([entry("m1", NOW, { replyKind: "more" })], "a", NOW + HOUR)).toBeCloseTo(0.8, 6);
    // Decays toward 1 with a 30-day half-life.
    expect(A.annoyance([entry("m1", NOW, { replyKind: "less" })], "a", NOW + HOUR + 30 * DAY)).toBeCloseTo(1.25, 3);
    const many = Array.from({ length: 6 }, (_, i) => entry(`m${i}`, NOW + i * MINUTE, { replyKind: "less", repliedAt: NOW + i * MINUTE + 1 }));
    expect(A.annoyance(many, "a", NOW + HOUR)).toBeCloseTo(3, 2);
  });
});

describe("cap math (D1, D4, D9)", () => {
  test("caps count interruptions per state: Open 4/7d, Normal 2/7d, Quiet 1/30d, Paused 0; minors 1/7d", () => {
    expect(A.capFor(member({ state: "open" }))).toEqual({ limit: 4, periodDays: 7 });
    expect(A.capFor(member())).toEqual({ limit: 2, periodDays: 7 });
    expect(A.capFor(member({ state: "quiet" }))).toEqual({ limit: 1, periodDays: 30 });
    expect(A.capFor(member({ state: "paused" })).limit).toBe(0);
    expect(A.capFor(member({ state: "open", age: 15 }))).toEqual({ limit: 1, periodDays: 7 });
    expect(A.capFor(member({ onlyWhenAsked: true })).limit).toBe(0);
    expect(A.capFor(member({ prefs: { ...A.defaultCadence("normal"), mode: "only_when_asked" } })).limit).toBe(0);
  });

  test("bundled items share one message id: one interruption; the window is rolling", () => {
    const ledger = [entry("m1", T - HOUR), entry("m1", T - HOUR), entry("m0", T - 8 * DAY), entry("r", T - HOUR, { kind: "reply", countsAgainstCap: false })];
    expect(A.interruptionsUsed(ledger, "a", T, 7)).toBe(1);
    expect(A.interruptionsUsed(ledger, "a", T, 30)).toBe(2);
    expect(A.interruptionsUsed(ledger, "b", T, 7)).toBe(0);
  });

  test("no send at the cap; one digest leaves room for one break-in (Normal)", () => {
    const its = [item("1", { enjoy: 0.8, accept: 0.8 })];
    expect(compose({ items: its, ledger: [entry("m1", T - DAY), entry("m2", T - 2 * DAY)] }).reason).toBe("cap");
    expect(compose({ items: its, ledger: [entry("m1", T - DAY)] }).send).toBe(true);
    expect(compose({ items: its, ledger: [entry("m1", T - 8 * DAY), entry("m2", T - 9 * DAY)] }).send).toBe(true);
  });

  test("break-ins: Normal 1/7d, Open 2/7d, Quiet 0, minors 0, newcomers 1; always within the cap", () => {
    expect(A.breakInLimit(member()).limit).toBe(1);
    expect(A.breakInLimit(member({ state: "open" })).limit).toBe(2);
    expect(A.breakInLimit(member({ state: "quiet" })).limit).toBe(0);
    expect(A.breakInLimit(member({ age: 16 })).limit).toBe(0);
    expect(A.breakInLimit(member({ state: "open", newcomer: true })).limit).toBe(1);
    expect(() => resolveAttention({ breakIns: { normal: { limit: 3, periodDays: 7 } } })).toThrow();
    const urgent = item("u", { enjoy: 0.8, accept: 0.8, urgency: { expiresAt: T + DAY } }); // expires before Thursday's slot
    // Break-ins matter for members on a weekly digest; with rolling daily slots (founder decision 1) the next slot is always < 24h away.
    const wk = (o: Partial<A.MemberAttention> = {}) => member({ prefs: weeklyPrefs(), ...o });
    const breakIn = (ledger: AttentionLedgerEntry[], m = wk()) => compose({ items: [urgent], ledger, mode: "break_in", member: m });
    expect(breakIn([]).send).toBe(true);
    expect(breakIn([entry("b1", T - DAY, { kind: "break_in" })]).reason).toBe("break_in_limit");
    expect(breakIn([entry("b1", T - DAY, { kind: "break_in" })], wk({ state: "open" })).send).toBe(true);
    expect(breakIn([], wk({ state: "quiet", age: 30 })).send).toBe(false);
    // Only items that expire before the next slot, with V >= 1.5 x the median digest V.
    expect(compose({ items: [item("n", { enjoy: 0.8, accept: 0.8 })], mode: "break_in", member: wk() }).reason).toBe("no_urgent_item");
    expect(compose({ items: [urgent], mode: "break_in", medianDigestValue: 2, member: wk() }).reason).toBe("no_urgent_item");
  });

  test("held (unsent) items never count against the cap", () => {
    const q: HeldItem[] = Array.from({ length: 10 }, (_, i) => held(item(`h${i}`)));
    expect(A.interruptionsUsed([], "a", T, 7)).toBe(0);
    expect(compose({ items: q }).used).toBe(0);
  });

  test("engine supply budget under D1: cap x items per message", () => {
    expect(engineSupplyBudgets().budgets!.normal).toEqual({ limit: 6, periodDays: 7 });
    expect(engineSupplyBudgets().budgets!.quiet).toEqual({ limit: 2, periodDays: 30 });
  });
});

describe("digest packing (1.3, 1.4, D1, D9, D10)", () => {
  test("up to 3 items, at most 2 that involve another member, never two about the same person", () => {
    const its = [
      item("1", { enjoy: 0.9, accept: 0.8 }), item("2", { enjoy: 0.85, accept: 0.8 }), item("3", { enjoy: 0.8, accept: 0.8 }),
      item("e", { kind: "event_suggestion", others: [], involvesMember: false, effort: "glance", enjoy: 0.7, accept: 0.7, reviewState: "not_needed" }),
    ];
    const r = compose({ items: its });
    expect(r.send).toBe(true);
    expect(r.items.map(i => i.id)).toEqual(["1", "2", "e"]);
    expect(r.kind).toBe("digest");
    const same = compose({ items: [item("1", { others: ["z"] }), item("2", { others: ["z"] })] });
    expect(same.items.map(i => i.id)).toEqual(["1"]);
    expect(A.maxItemsFor(member({ state: "quiet" }))).toBe(2);
    expect(A.maxItemsFor(member({ prefs: { ...A.defaultCadence("normal"), maxItemsPerDigest: 1 } }))).toBe(1);
  });

  test("an item joins only if it adds value; nothing below the quality bar; nothing when U(M) <= 0", () => {
    const strong = item("s", { enjoy: 0.9, accept: 0.9 });
    const weak = item("w", { enjoy: 0.05, accept: 0.05, effort: "contribute" });
    expect(compose({ items: [strong, weak] }).items.map(i => i.id)).toEqual(["s"]);
    expect(compose({ items: [item("b", { enjoy: 0.2, accept: 1 })] }).reason).toBe("below_quality_bar");
    const r = compose({ items: [item("v", { enjoy: 0.35, accept: 0.1 })] });
    expect(r.reason).toBe("below_send_value");
    expect(r.utility).toBeLessThanOrEqual(0);
  });

  test("D10: romance goes in its own message unless the member allows it in a digest", () => {
    const rom = item("r", { category: "romance", enjoy: 0.95, accept: 0.9 });
    const soc = item("s", { enjoy: 0.8, accept: 0.8 });
    const r = compose({ items: [rom, soc] });
    expect(r.items.map(i => i.id)).toEqual(["r"]);
    const weakRom = item("r2", { category: "romance", enjoy: 0.5, accept: 0.3 });
    expect(compose({ items: [weakRom, soc] }).items.map(i => i.id)).toEqual(["s"]);
    const allow = member({ prefs: { ...A.defaultCadence("normal"), romanceInDigest: true } });
    expect(compose({ items: [rom, soc], member: allow }).items.map(i => i.id).sort()).toEqual(["r", "s"]);
    expect(compose({ items: [rom], member: member({ categoriesOptIn: ["social"] }) }).reason).toBe("nothing_eligible");
  });

  test("D9: members aged 13-17 get events, places and solo plans only, at most 2, never people", () => {
    const minor = member({ age: 15, state: "open" });
    const person = item("p", { enjoy: 0.95, accept: 0.95 });
    const ev = (id: string) => item(id, { kind: "event_suggestion", others: [], involvesMember: false, effort: "glance", enjoy: 0.8, accept: 0.8, reviewState: "not_needed" });
    const plan = item("plan", { kind: "plan_probe", others: [], involvesMember: false, enjoy: 0.8, accept: 0.8, reviewState: "not_needed" });
    const groupPlan = item("gplan", { kind: "plan_probe", others: ["x"], enjoy: 0.9, accept: 0.9 });
    const r = compose({ items: [person, ev("e1"), ev("e2"), plan, groupPlan], member: minor });
    expect(r.send).toBe(true);
    expect(r.items.length).toBe(2);
    expect(r.items.every(i => i.others.length === 0 && !i.involvesMember)).toBe(true);
    expect(r.skipped.find(s => s.itemId === "p")?.reason).toBe("minor_restricted");
    expect(r.skipped.find(s => s.itemId === "gplan")?.reason).toBe("minor_restricted");
    expect(compose({ items: [item("rom", { category: "romance", others: [], involvesMember: false, kind: "event_suggestion" })], member: minor }).send).toBe(false);
  });

  test("hard gates: paused, review, receiving, quiet bar, only_when_great", () => {
    expect(compose({ items: [item("1")], member: member({ state: "paused" }) }).reason).toBe("paused");
    expect(compose({ items: [item("1", { reviewState: "pending" })] }).skipped[0]!.reason).toBe("awaiting_review");
    expect(compose({ items: [item("1", { effort: "contribute" })], member: member({ state: "receiving" }) }).skipped[0]!.reason).toBe("receiving_no_contribute");
    expect(compose({ items: [item("1", { enjoy: 0.5 })], member: member({ state: "quiet" }) }).skipped[0]!.reason).toBe("below_quiet_bar");
    expect(compose({ items: [item("1", { enjoy: 0.5 })], member: member({ prefs: { ...A.defaultCadence("normal"), mode: "only_when_great" } }) }).skipped[0]!.reason).toBe("below_great_bar");
    expect(compose({ items: [item("1", { urgency: { expiresAt: T } })] }).skipped[0]!.reason).toBe("expired");
  });
});

describe("Blooio coupling and the two-unanswered rule (1.9)", () => {
  const its = [item("1", { enjoy: 0.8, accept: 0.8 })];
  test("a new interruption needs outboundSinceInbound <= 1; logistics <= 2", () => {
    expect(compose({ items: its, conversation: { outboundSinceInbound: 1 } }).send).toBe(true);
    expect(compose({ items: its, conversation: { outboundSinceInbound: 2 } }).reason).toBe("conversation_streak");
    expect(A.canSendLogistics({ outboundSinceInbound: 2 })).toBe(true);
    expect(A.canSendLogistics({ outboundSinceInbound: 3 })).toBe(false);
    expect(A.canInterrupt({ outboundSinceInbound: 1 })).toBe(true);
  });
  test("the two-unanswered pause comes first", () => {
    const ledger = [entry("m1", T - 5 * DAY, { repliedAt: undefined }), entry("m2", T - 4 * DAY, { repliedAt: undefined })];
    expect(A.unansweredInterruptions(ledger, "a", T)).toBe(2);
    expect(compose({ items: its, ledger, conversation: { outboundSinceInbound: 5 } }).reason).toBe("only_when_asked");
    // A reply to the latest ends the streak.
    expect(A.unansweredInterruptions([...ledger, entry("m3", T - DAY)], "a", T)).toBe(0);
    // Pending (inside 72h) interruptions are not counted yet.
    expect(A.unansweredInterruptions([entry("m1", T - HOUR, { repliedAt: undefined })], "a", T)).toBe(0);
  });
});

describe("quiet hours and digest slots (D2, D9)", () => {
  test("no interruption in the member's quiet hours", () => {
    const night = NOW + 14 * HOUR; // 23:00 PDT
    expect(compose({ items: [item("1", { enjoy: 0.8, accept: 0.8 })], now: night }).reason).toBe("quiet_hours");
    expect(A.memberQuietEnd(member(), night)).toBeGreaterThan(night);
    expect(localParts(A.memberQuietEnd(member(), night), LA).hour).toBe(9);
  });

  test("D9: minors also have quiet hours 20:00-08:00 on school nights only", () => {
    const minor = member({ age: 15, quietHours: [23, 7] });
    const at = (dayOffset: number, hour: number) => NOW - 9 * HOUR + dayOffset * DAY + hour * HOUR; // Monday 00:00 PDT + offset
    expect(A.inMemberQuietHours(minor, at(-1, 21))).toBe(true); // Sunday 21:00: school night
    expect(A.inMemberQuietHours(minor, at(0, 7))).toBe(true); // Monday 07:00
    expect(A.inMemberQuietHours(minor, at(3, 20))).toBe(true); // Thursday 20:00
    expect(A.inMemberQuietHours(minor, at(4, 21))).toBe(false); // Friday 21:00: no school next day
    expect(A.inMemberQuietHours(minor, at(5, 7.5))).toBe(false); // Saturday 07:30
    expect(A.inMemberQuietHours(minor, at(4, 23.5))).toBe(true); // own quiet hours still apply
    expect(A.inMemberQuietHours(member({ quietHours: [23, 7] }), at(0, 21))).toBe(false); // adults: own hours only
  });

  test("founder decision 1: a rolling daily slot at 12:00 local by default; learned weekday / weekend hours", () => {
    const m = member();
    const s = A.nextDigestSlot(m, NOW); // Monday 09:00 PDT -> Monday 12:00 (+ jitter under 2h)
    expect(s - A.digestJitter("a") - Date.UTC(2026, 9, 5, 19)).toBe(0);
    expect(A.nextDigestSlot(m, s) - A.digestJitter("a") - Date.UTC(2026, 9, 6, 19)).toBe(0); // next day
    expect(A.inSendWindow(m, s + 5 * HOUR)).toBe(true);
    expect(A.inSendWindow(m, s + 7 * HOUR)).toBe(false);
    const learned = member({ prefs: { ...A.defaultCadence("normal"), sendHours: { weekday: 18, weekend: 9 } } });
    const j = A.digestJitter("a");
    expect(localParts(A.nextDigestSlot(learned, NOW) - j, LA)).toMatchObject({ day: 5, hour: 18, minute: 0 });
    expect(localParts(A.nextDigestSlot(learned, Date.UTC(2026, 9, 10, 7)) - j, LA)).toMatchObject({ day: 10, weekday: 5, hour: 9, minute: 0 }); // Saturday 00:00 -> Saturday 09:00
  });

  test("weekly Thursday 18:00 digest on request (per-member spread under 2h); monthly = first Thursday", () => {
    const m = member({ prefs: weeklyPrefs() });
    const s = A.nextDigestSlot(m, NOW);
    const p = localParts(s, LA);
    expect(p.weekday).toBe(3); // Thursday (Monday = 0)
    expect(p.day).toBe(8);
    expect(p.hour === 18 || p.hour === 19).toBe(true);
    expect(s - A.digestJitter("a") - Date.UTC(2026, 9, 9, 1)).toBe(0); // Thu 18:00 PDT
    expect(A.digestDue(m, s - MINUTE, undefined)).toBeUndefined();
    expect(A.digestDue(m, s + HOUR, undefined)).toBe(s);
    expect(A.digestDue(m, s + HOUR, s)).toBeUndefined(); // served
    expect(A.digestDue(m, s + 30 * HOUR, undefined)).toBeUndefined(); // window passed
    const monthly = member({ state: "quiet", prefs: { ...weeklyPrefs(), digestPeriod: "month" } });
    const ms = A.nextDigestSlot(monthly, NOW);
    expect(localParts(ms, LA)).toMatchObject({ month: 11, day: 5, weekday: 3 });
    const ny = member({ tz: "America/New_York", prefs: weeklyPrefs() });
    expect(localParts(A.nextDigestSlot(ny, NOW), "America/New_York").weekday).toBe(3);
    expect(A.digestDue(member({ prefs: { ...A.defaultCadence("normal"), mode: "as_it_comes" } }), T, T - HOUR)).toBe(T);
  });
});

describe("hold queue (1.6)", () => {
  const prefs = { categoryWeight: {} };
  test("capacity 10, lowest V evicted; a new item below everything is refused", () => {
    let q: HeldItem[] = [];
    for (let i = 0; i < 10; i++) q = A.addToHold(q, item(`i${i}`, { enjoy: 0.5 + i * 0.02 }), prefs, NOW).queue;
    expect(q.length).toBe(10);
    const r = A.addToHold(q, item("best", { enjoy: 0.95 }), prefs, NOW);
    expect(r.added).toBe(true);
    expect(r.queue.length).toBe(10);
    expect(r.evicted.map(e => e.id)).toEqual(["i0"]);
    const low = A.addToHold(r.queue, item("low", { enjoy: 0.1 }), prefs, NOW);
    expect(low.added).toBe(false);
    expect(low.reason).toBe("hold_full");
    // A partner probe (someone already said yes) is evicted last.
    const withPartner = A.addToHold(r.queue.slice(0, 9), item("p", { enjoy: 0.1, stage: "partner" }), prefs, NOW).queue;
    const after = A.addToHold(withPartner, item("z", { enjoy: 0.9 }), prefs, NOW);
    expect(after.queue.some(x => x.id === "p")).toBe(true);
  });

  test("same opportunity re-proposed: replaced only with V higher by the hysteresis margin; dismissed and expired refused", () => {
    const q = A.addToHold([], item("a1", { key: "k", enjoy: 0.6 }), prefs, NOW).queue;
    expect(A.addToHold(q, item("a2", { key: "k", enjoy: 0.65 }), prefs, NOW).reason).toBe("duplicate");
    const rep = A.addToHold(q, item("a3", { key: "k", enjoy: 0.9 }), prefs, NOW);
    expect(rep.added).toBe(true);
    expect(rep.queue.map(x => x.id)).toEqual(["a3"]);
    expect(A.addToHold(q, item("a4", { key: "k", enjoy: 0.6, stage: "partner" }), prefs, NOW).added).toBe(true);
    expect(A.addToHold([], item("d", { key: "kd" }), prefs, NOW, { dismissed: new Map([["kd", NOW + DAY]]) }).reason).toBe("dismissed");
    expect(A.addToHold([], item("x", { urgency: { expiresAt: NOW } }), prefs, NOW).reason).toBe("expired");
  });

  test("expired items are dropped with a reason; eligibility is re-checked with the send-time check", () => {
    const inp = emptyInput(NOW);
    inp.members.push(baseMember("a"), baseMember("b"), baseMember("kid", { age: 15 }), baseMember("off", { state: "paused" }), baseMember("held"), baseMember("blk"));
    inp.safetyHolds = [{ memberId: "held", from: NOW - HOUR }];
    inp.edges.push({ from: "a", to: "blk", type: "blocked", strength: 1, explicit: true, createdAt: NOW - HOUR });
    const w = mkWorld(inp);
    const q = [
      held(item("ok", { others: ["b"] })), held(item("old", { others: ["b"], urgency: { expiresAt: NOW - 1 } })),
      held(item("k", { memberId: "kid", others: ["b"] })), held(item("p", { others: ["off"] })),
      held(item("h", { others: ["held"] })), held(item("bl", { others: ["blk"] })), held(item("busy", { others: ["b"], key: "kb" })),
    ];
    const r = A.revalidateHold(q, NOW, eligibilityFor(w), it => (it.key === "kb" ? "partner_busy" : null));
    expect(r.kept.map(x => x.id)).toEqual(["ok"]);
    expect(Object.fromEntries(r.dropped.map(d => [d.item.id, d.reason]))).toEqual({
      old: "expired", k: "ineligible:underage", p: "partner_ineligible:state_paused", h: "partner_ineligible:safety_hold",
      bl: "ineligible:blocked", busy: "partner_busy",
    });
    expect(r.kept[0]!.revalidateAt).toBe(NOW + 24 * HOUR);
    // D9: a member aged 13-17 keeps outside-world items (no other member involved); people items are dropped.
    const ev = held(item("ev", { memberId: "kid", kind: "event_suggestion", others: [], involvesMember: false, reviewState: "not_needed" }));
    const r2 = A.revalidateHold([ev, held(item("pp", { memberId: "kid", others: ["b"] }))], NOW, eligibilityFor(w));
    expect(r2.kept.map(x => x.id)).toEqual(["ev"]);
    expect(r2.dropped.map(d => d.reason)).toEqual(["ineligible:underage"]);
  });

  test("items from proposals: the member with the want first; groups in parallel; event items expire 24h before the start", () => {
    const p = {
      id: "p1", kind: "intro", participants: ["prov", "seek"], roles: { prov: "provider", seek: "seeker" }, category: "hobby", score: 0.45,
      acceptance: { prov: 0.36, seek: 0.64 }, explanations: {}, alternates: [], objective: "Intro: sailing", city: "sf",
    } as unknown as EngineProposal;
    const its = A.itemsForProposal(p, { now: NOW });
    expect(its.map(i => i.memberId)).toEqual(["seek"]);
    expect(its[0]!.kind).toBe("intro_probe");
    expect(its[0]!.accept).toBeCloseTo(0.36 * 0.64, 9); // a cold pair needs both yeses (D13)
    expect(its[0]!.reviewState).toBe("pending");
    expect(its[0]!.urgency.expiresAt).toBe(NOW + 14 * DAY);
    const partner = A.partnerItem(p, "prov", { now: NOW, reviewState: "approved" });
    expect([partner.kind, partner.effort, partner.stage, partner.accept]).toEqual(["help_ask", "contribute", "partner", 0.36]);
    expect(partner.urgency.expiresAt).toBe(NOW + DEFAULT_ATTENTION.expiry.partnerProbeDays * DAY);
    const g = { ...p, participants: ["a", "b", "c"], roles: {}, anchor: { type: "event", id: "e" }, window: { start: NOW + 3 * DAY, end: NOW + 3 * DAY + 2 * HOUR } } as unknown as EngineProposal;
    const gi = A.itemsForProposal(g, { now: NOW });
    expect(gi.map(i => i.kind)).toEqual(["group_probe", "group_probe", "group_probe"]);
    expect(gi[0]!.urgency.expiresAt).toBe(NOW + 2 * DAY);
    expect(A.knotCalibrator([[0.3, 0.4], [0.5, 0.8]], {})(0.4, "social")).toBeCloseTo(0.6, 9);
  });
});

describe("consent-first probes (1.8, D5)", () => {
  const pair = { id: "p", participants: ["prov", "seek"], roles: { prov: "provider", seek: "seeker" } } as unknown as EngineProposal;
  test("the member with the want is probed first; the partner only after their yes; reveal only after both", () => {
    let f = A.startProbeFlow(pair);
    expect(f.first).toBe("seek");
    expect(A.toProbe(f)).toEqual(["seek"]);
    expect(A.recordProbeAnswer(f, "prov", true)).toBe(f); // partner can't answer before being probed
    expect(A.revealFor(f, "seek", x => x)).toBeNull();
    f = A.recordProbeAnswer(f, "seek", true);
    expect(A.toProbe(f)).toEqual(["prov"]);
    expect(A.canReveal(f)).toBe(false);
    expect(A.revealFor(f, "seek", x => x)).toBeNull();
    f = A.recordProbeAnswer(f, "prov", true);
    expect(A.canReveal(f)).toBe(true);
    expect(A.revealFor(f, "seek", x => x.toUpperCase())).toEqual({ names: ["PROV"] });
    expect(A.revealFor(f, "prov", x => x.toUpperCase())).toEqual({ names: ["SEEK"] });
  });
  test("a decline closes it and nobody learns who declined", () => {
    const no1 = A.recordProbeAnswer(A.startProbeFlow(pair), "seek", false);
    expect(no1.stage).toBe("closed");
    expect(A.toProbe(no1)).toEqual([]);
    const no2 = A.recordProbeAnswer(A.recordProbeAnswer(A.startProbeFlow(pair), "seek", true), "prov", false);
    expect(no2.stage).toBe("closed");
    expect(A.revealFor(no2, "seek", x => x)).toBeNull();
    // Groups: reveal at quorum, only the yes-sayers' names, never the decliner's.
    const g = { id: "g", participants: ["a", "b", "c", "d"], roles: {} } as unknown as EngineProposal;
    let gf = A.startProbeFlow(g);
    expect(A.toProbe(gf).sort()).toEqual(["a", "b", "c", "d"]);
    for (const [id, y] of [["a", true], ["b", false], ["c", true]] as const) gf = A.recordProbeAnswer(gf, id, y);
    expect(A.canReveal(gf)).toBe(false);
    gf = A.recordProbeAnswer(gf, "d", true);
    expect(A.canReveal(gf)).toBe(true);
    expect(A.revealFor(gf, "a", x => x)!.names.sort()).toEqual(["c", "d"]);
    expect(A.revealFor(gf, "b", x => x)).toBeNull();
  });

  // A partner with a name, an employer (even shareable), a matchable fact and an agent_private canary.
  function probeWorld() {
    const inp = emptyInput(NOW);
    inp.members.push(baseMember("seek", { name: "Ada Lovelace" }), baseMember("prov", { name: "Zelda Quintana" }), baseMember("kid", { age: 15 }));
    inp.presence.push({ memberId: "seek", city: "sf", type: "home", areas: ["Mission"] }, { memberId: "prov", city: "sf", type: "home", areas: ["Mission"] });
    inp.facets.push(
      facet("prov", 0, "interest", "film photography", ["film_photography"]),
      facet("prov", 1, "fact", "works at Acme Robotics", ["employer"]),
      facet("prov", 2, "interest", "falconry weekends", ["falconry"], "matchable"),
      facet("prov", 3, "fact", "recovering from burnout (ref QX-4821-ORCHID)", ["health"], "agent_private"),
      facet("prov", 4, "skill", "senior engineer at Globex", ["occupation"]),
      facet("seek", 0, "interest", "film photography", ["film_photography"]),
    );
    return mkWorld(inp);
  }
  const spec = (over: Partial<A.ProbeSpec> = {}): A.ProbeSpec => ({ proposalId: "p", kind: "intro", category: "hobby", objective: "Intro: film photography", tz: LA, window: { start: NOW + 3 * DAY, end: NOW + 4 * DAY }, ...over });

  test("a probe reveals activity, time, area and at most one shareable attribute; never name, employer or private text", () => {
    const w = probeWorld();
    const p = A.buildProbe(w, spec(), "seek", ["prov"], NOW)!;
    expect(p).not.toBeNull();
    for (const bad of ["Zelda", "Quintana", "Acme", "Robotics", "Globex", "falconry", "burnout", "QX-4821-ORCHID", "canary"]) expect(p.text.toLowerCase()).not.toContain(bad.toLowerCase());
    expect(p.text).toContain("film photography");
    expect(p.text).toContain("Thursday");
    expect(p.area).toBe("Mission");
    expect(p.attribute).toBe("film photography");
    expect(checkMemberFacing(p.text, privateVocabulary(w, ["prov"])).ok).toBe(true);
    // Objectives that carry private words fall back to a generic activity, never to the private word.
    const q = A.buildProbe(w, spec({ objective: "Intro: falconry" }), "seek", ["prov"], NOW)!;
    expect(q.text.toLowerCase()).not.toContain("falconry");
    // Romance probes say what they are; minors never get or appear in a probe.
    expect(A.buildProbe(w, spec({ category: "romance" }), "seek", ["prov"], NOW)!.text).toContain("date");
    expect(A.buildProbe(w, spec(), "kid", ["prov"], NOW)).toBeNull();
    expect(A.buildProbe(w, spec(), "seek", ["kid"], NOW)).toBeNull();
    // Founder decision 4a: time options in the probe itself, still through the leak gate.
    const opt = A.buildProbe(w, spec({ options: [{ start: Date.UTC(2026, 9, 9, 2), end: Date.UTC(2026, 9, 9, 4) }, { start: Date.UTC(2026, 9, 10, 17), end: Date.UTC(2026, 9, 10, 19) }] }), "seek", ["prov"], NOW)!;
    expect(opt.text).toContain("Thursday 7pm or Saturday 10am");
    for (const bad of ["Zelda", "Acme", "falconry", "QX-4821-ORCHID"]) expect(opt.text).not.toContain(bad);
  });

  test("property: probes on random worlds never contain the other person's name, a canary, or a non-shareable-only word", () => {
    let checked = 0;
    for (const seed of [1, 2, 3]) {
      const inp = randomWorld({ seed, members: 40 } as any);
      const w = mkWorld(inp);
      const adults = w.ids.filter(id => (w.get(id)!.m.age ?? 0) >= 18);
      for (let i = 0; i + 1 < adults.length; i += 2) {
        const [a, b] = [adults[i]!, adults[i + 1]!];
        const pr = A.buildProbe(w, spec({ objective: `Intro: ${w.get(b)!.match[0]?.value ?? "something"}` }), a, [b], NOW);
        if (!pr) continue;
        checked++;
        const names = (w.get(b)!.m.name ?? "").toLowerCase().split(/\s+/).filter(x => x.length > 2);
        for (const n of names) expect(pr.text.toLowerCase().split(/[^a-z0-9']+/)).not.toContain(n);
        expect(/canary|\b[A-Z]{2}-\d{4}-[A-Z]{3,}\b/.test(pr.text)).toBe(false);
        expect(checkMemberFacing(pr.text, privateVocabulary(w, [b])).ok).toBe(true);
        for (const f of inp.facets.filter(f => f.memberId === b && f.scope === "agent_private")) expect(pr.text).not.toContain(f.value);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  test("the digest menu text carries the reply grammar", () => {
    expect(A.digestText(["one"])).toBe("one");
    expect(A.digestText(["one", "two", "three"])).toBe('Three things for this week, reply with a number (or "none"):\n1. one\n2. two\n3. three');
  });
});

describe("re-engagement (D6)", () => {
  const far = { expiresAt: NOW + 90 * DAY };
  const its = [item("hi", { enjoy: 0.9, accept: 0.9, urgency: far }), item("lo", { enjoy: 0.4, accept: 0.4, urgency: far })];
  const base = {
    member: member({ onlyWhenAsked: true }), autoPaused: true, optedOut: false, joinedAt: NOW - 60 * DAY,
    conversation: { outboundSinceInbound: 2, lastInboundAt: NOW - 31 * DAY }, items: its, valueHistory: [0.1, 0.2, 0.3, 0.4], now: T,
  };
  test("once, after >= 30 days of silence, only for an item above the member's 75th percentile", () => {
    const r = A.reengagement(base);
    expect(r.send).toBe(true);
    expect(r.item!.id).toBe("hi");
    expect(A.REENGAGE_SUFFIX).toBe("Want me to keep sending these?");
    expect(A.reengagement({ ...base, conversation: { ...base.conversation, lastInboundAt: NOW - 20 * DAY } }).reason).toBe("too_soon");
    expect(A.reengagement({ ...base, conversation: { ...base.conversation, reengagedAt: NOW - DAY } }).reason).toBe("already_reengaged");
    // After the member writes in again, a later auto-pause may get its one re-engagement.
    expect(A.reengagement({ ...base, now: T + 40 * DAY, conversation: { outboundSinceInbound: 2, reengagedAt: NOW - 10 * DAY, lastInboundAt: NOW - 5 * DAY } }).send).toBe(true);
    expect(A.reengagement({ ...base, valueHistory: [0.9, 1, 1.1, 1.2] }).reason).toBe("not_high_value");
    expect(A.reengagement({ ...base, optedOut: true }).send).toBe(false);
    expect(A.reengagement({ ...base, autoPaused: false }).reason).toBe("not_auto_paused");
    expect(A.reengagement({ ...base, member: member({ onlyWhenAsked: true, prefs: { ...A.defaultCadence("normal"), mode: "only_when_asked" } }) }).reason).toBe("not_auto_paused");
    expect(A.reengagement({ ...base, now: NOW + 14 * HOUR }).reason).toBe("quiet_hours");
  });
});

describe("learned cadence never increases frequency (D11)", () => {
  const explicit = weeklyPrefs();
  test("learned prefs can only make it quieter", () => {
    expect(A.applyLearnedCadence(A.defaultCadence("normal"), { digestDays: [1, 2] }).digestDays).toEqual([1, 2]); // rolling -> fewer days only
    const learned = A.applyLearnedCadence(explicit, { digestDays: [1, 2, 3, 4, 5], maxItemsPerDigest: 3, capOverride: 9, mode: "as_it_comes", categoryWeight: { social: 3 }, digestHour: 12 });
    expect(learned.digestDays).toEqual([4]);
    expect(learned.maxItemsPerDigest).toBe(3);
    expect(learned.mode).toBe("digest");
    expect(learned.categoryWeight.social).toBe(1);
    expect(learned.capOverride).toBe(9);
    expect(A.capFor(member({ prefs: learned })).limit).toBe(2); // never above the state cap
    expect(learned.digestHour).toBe(12); // timing is not frequency
    const quieter = A.applyLearnedCadence(explicit, { maxItemsPerDigest: 1, capOverride: 1, mode: "only_when_great", digestPeriod: "month" });
    expect([quieter.maxItemsPerDigest, quieter.capOverride, quieter.mode, quieter.digestPeriod]).toEqual([1, 1, "only_when_great", "month"]);
  });

  test("property: for random learned prefs, no frequency field ever exceeds the explicit one", () => {
    const modes = ["digest", "as_it_comes", "only_when_great", "only_when_asked"] as const;
    const q = { as_it_comes: 0, digest: 1, only_when_great: 2, only_when_asked: 3 };
    let s = 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 300; i++) {
      const ex = { ...explicit, digestDays: [2, 4].filter(() => rnd() < 0.7), maxItemsPerDigest: (1 + Math.floor(rnd() * 3)) as 1 | 2 | 3, mode: modes[Math.floor(rnd() * 4)]!, capOverride: rnd() < 0.5 ? Math.floor(rnd() * 4) : undefined };
      if (!ex.digestDays.length) ex.digestDays = [4];
      const le = { digestDays: [0, 1, 2, 3, 4, 5, 6].filter(() => rnd() < 0.5), maxItemsPerDigest: (1 + Math.floor(rnd() * 3)) as 1 | 2 | 3, mode: modes[Math.floor(rnd() * 4)]!, capOverride: Math.floor(rnd() * 6), categoryWeight: { social: rnd() * 3 } };
      const out = A.applyLearnedCadence(ex, le);
      expect(out.digestDays.every(d => ex.digestDays.includes(d))).toBe(true);
      expect(out.digestDays.length).toBeLessThanOrEqual(ex.digestDays.length);
      expect(out.maxItemsPerDigest).toBeLessThanOrEqual(ex.maxItemsPerDigest);
      expect(q[out.mode]).toBeGreaterThanOrEqual(q[ex.mode]);
      expect(out.capOverride ?? Infinity).toBeLessThanOrEqual(ex.capOverride ?? Infinity);
      expect(out.categoryWeight.social ?? 1).toBeLessThanOrEqual(ex.categoryWeight.social ?? 1);
      expect(A.capFor(member({ prefs: out })).limit).toBeLessThanOrEqual(A.capFor(member({ prefs: ex })).limit);
    }
  });

  test("learned positive signals never push the price below its baseline; only an explicit 'more' does", () => {
    const fast = Array.from({ length: 5 }, (_, i) => entry(`f${i}`, NOW + i * DAY, { replyKind: "pick", repliedAt: NOW + i * DAY + 10 * MINUTE }));
    expect(A.annoyance(fast, "a", NOW + 6 * DAY)).toBe(1);
    // After annoyance, fast picks bring it back down to 1, not below.
    const mixed = [entry("u", NOW - 5 * DAY, { repliedAt: undefined }), ...fast];
    expect(A.annoyance(mixed, "a", NOW + 6 * DAY)).toBeGreaterThanOrEqual(1);
    expect(A.annoyance([entry("m", NOW, { replyKind: "more" })], "a", NOW + HOUR)).toBeLessThan(1);
    expect(A.shadowPrice(member(), 0, 2, A.annoyance(fast, "a", NOW + 6 * DAY))).toBeCloseTo(0.25, 9);
  });
});

describe("metrics (1.10, 3.3)", () => {
  test("V14: share of eligible members (tenure >= 14d, not paused) with a value event in the last 14 days, averaged over days", () => {
    const start = NOW;
    const members: A.MemberSpan[] = [
      { id: "a", joinedAt: start, adult: true }, { id: "b", joinedAt: start, adult: true },
      { id: "kid", joinedAt: start, adult: false }, { id: "late", joinedAt: start + 10 * DAY, adult: true },
      { id: "gone", joinedAt: start, adult: true, leftAt: start + 15 * DAY },
    ];
    const v = A.v14([{ memberId: "a", at: start + 5 * DAY }, { memberId: "b", at: start + 16 * DAY + HOUR }], members, start, start + 20 * DAY);
    // Days 14..20 (t = start + d*DAY): eligible a, b (+ gone on day 14..15); a counts through day 18, b from day 17.
    const byDay = v.byDay.map(d => `${(d.t - start) / DAY}:${d.withValue}/${d.eligible}`);
    expect(byDay).toEqual(["14:1/3", "15:1/2", "16:1/2", "17:2/2", "18:2/2", "19:1/2", "20:1/2"]);
    expect(v.mean).toBeCloseTo((1 / 3 + 0.5 + 0.5 + 1 + 1 + 0.5 + 0.5) / 7, 9);
  });

  test("annoyance and value per interruption from the ledger", () => {
    const ledger = [entry("m1", NOW, { itemIds: ["i1", "i2", "i3"] }), entry("m2", NOW + DAY, { repliedAt: undefined, itemIds: ["i4"] }), entry("r", NOW, { countsAgainstCap: false, kind: "reply" })];
    const m = A.attentionMetrics({
      ledger, members: [{ id: "a", joinedAt: NOW, adult: true }], values: [{ memberId: "a", at: NOW + 3 * DAY }],
      autoPauses: [], stops: [{ memberId: "a", at: NOW + 10 * DAY }], start: NOW, end: NOW + 14 * DAY,
    });
    expect(m.interruptions).toBe(2);
    expect(m.itemsPerInterruption).toBe(2);
    expect(m.unansweredRate).toBe(0.5);
    expect(m.valuePerInterruption).toBe(0.5);
    expect(m.stopPer1000).toBe(500);
    expect(m.interruptionsPerMemberWeek).toBe(1);
    expect(m.timeToValueDaysMedian).toBe(3);
  });
});

describe("iteration 3: founder decisions 1-4 (send time, initial invites, availability)", () => {
  // Replies at a given local hour on weekdays (Oct 2026: Mon 5 .. Fri 9, Mon 12 ..) and weekends (Sat 10, Sun 11).
  const at = (y: number, mo: number, d: number, h: number) => Date.UTC(y, mo - 1, d, h + 7); // PDT
  const weekdays = (h: number, n: number) => Array.from({ length: n }, (_, i) => at(2026, 10, [5, 6, 7, 8, 9, 12, 13, 14][i]!, h));
  const END = at(2026, 10, 15, 8);

  test("send time: default 12:00 until enough replies; weekday and weekend learned separately; quiet hours win", () => {
    const none = A.learnSendProfile([], LA, END, [22, 8]);
    expect([none.weekday, none.weekend, none.learned.weekday]).toEqual([12, 12, false]);
    // 4 evening replies: below the minimum sample size, no move.
    expect(A.learnSendProfile(weekdays(19, 4), LA, END, [22, 8]).weekday).toBe(12);
    // 6 evening replies on weekdays: weekday moves to the evening slot, weekend stays at the default.
    const ev = A.learnSendProfile(weekdays(19, 6), LA, END, [22, 8]);
    expect([ev.weekday, ev.weekend, ev.samples.weekday, ev.samples.weekend]).toEqual([17, 12, 6, 0]);
    // Evening slot needs 3 open hours before quiet hours: quiet from 19:00 leaves 2, so stay at the default.
    expect(A.learnSendProfile(weekdays(19, 6), LA, END, [19, 8]).weekday).toBe(12);
    // Mixed replies with no clear winner over lunch: stay at the default.
    expect(A.learnSendProfile([...weekdays(19, 3), ...weekdays(12, 3)], LA, END, [22, 8]).weekday).toBe(12);
    // Recency: old evening replies are outweighed by recent lunchtime ones.
    const old = Array.from({ length: 6 }, (_, i) => at(2026, 8, 1 + i, 19)); // early September weekdays and a weekend
    expect(A.learnSendProfile([...old, ...weekdays(9, 6)], LA, END, [22, 8]).weekday).toBe(9);
    // The learned slot is never in quiet hours (quiet 17:00-09:00 here): fall back to the default.
    expect(A.learnSendProfile(weekdays(19, 6), LA, END, [17, 9]).weekday).toBe(12);
  });

  test("only initial invites count against the cap; a profiling ask at cap still goes, without counting", () => {
    const full = [entry("i1", T - 2 * DAY), entry("i2", T - DAY)];
    expect(compose({ items: [item("x")], ledger: full }).reason).toBe("cap");
    const ask = item("q", { kind: "profiling_question", others: [], involvesMember: false, effort: "reply", evi: 0.5, enjoy: 0.9, accept: 0.9, reviewState: "not_needed" });
    const r = compose({ items: [item("x"), ask], ledger: full });
    expect(r.send).toBe(true);
    expect(r.items.map(i => i.id)).toEqual(["q"]);
    expect(r.countsAgainstCap).toBe(false);
    // A partner's first probe is THEIR initial invite: it counts.
    expect(compose({ items: [item("p", { stage: "partner" })] }).countsAgainstCap).toBe(true);
    // A "what's your week like?" check-in counts only when it carries a proposal.
    expect(A.countsAgainstCap([ask])).toBe(false);
    expect(A.countsAgainstCap([ask, item("x")])).toBe(true);
    // Reveal, scheduling, reminders and acks are not items; unanswered asks do not trip the pause.
    expect(A.unansweredInterruptions([entry("q1", T - 10 * DAY, { countsAgainstCap: false, repliedAt: undefined }), entry("q2", T - 9 * DAY, { countsAgainstCap: false, repliedAt: undefined })], "a", T)).toBe(0);
  });

  test("time options maximize joint availability from calendar, standing availability, learned times and presence", () => {
    const now = at(2026, 10, 5, 9); // Monday 09:00 PDT
    const thu7 = at(2026, 10, 8, 19), sat10 = at(2026, 10, 10, 10), tue7 = at(2026, 10, 6, 19);
    const a: A.AvailabilityEvidence = { memberId: "a", tz: LA, quietHours: [22, 8], standing: [{ byDay: [4], startHour: 17, endHour: 22, source: "onboarding", statedAt: now - DAY }] };
    const b: A.AvailabilityEvidence = { memberId: "b", tz: LA, quietHours: [22, 8], calendar: { busy: [{ start: tue7, end: tue7 + 3 * HOUR }] }, history: [{ at: sat10 - 14 * DAY, outcome: "attended" }] };
    const r = A.chooseTimeOptions([a, b], now, { tz: LA });
    expect(r.slots.length).toBeGreaterThanOrEqual(2);
    expect(r.slots.length).toBeLessThanOrEqual(3);
    const starts = r.slots.map(x => x.slot.start);
    expect(starts).toContain(thu7); // a's standing window, b's calendar free
    expect(starts).not.toContain(tue7); // b's calendar is busy
    expect(new Set(starts.map(t => localParts(t, LA).day)).size).toBe(starts.length); // one per day
    expect(r.pAny).toBeGreaterThan(Math.max(...r.slots.map(x => x.joint)));
    // Each source moves the estimate the right way.
    const p = (ev: A.AvailabilityEvidence, t: number) => A.availabilityProb(ev, { start: t, end: t + 2 * HOUR }, now);
    const bare: A.AvailabilityEvidence = { memberId: "c", tz: LA };
    expect(p(a, thu7)).toBeGreaterThan(p(bare, thu7));
    expect(p(a, tue7)).toBeLessThan(p(bare, tue7)); // outside the stated windows
    expect(p(b, tue7)).toBeLessThan(0.05);
    expect(p(b, sat10)).toBeGreaterThan(p(bare, sat10));
    expect(p({ ...bare, away: [{ start: thu7 - DAY, end: thu7 + DAY }] }, thu7)).toBe(0);
    // Standing availability decays until re-confirmed.
    const stale = { ...a, standing: [{ ...a.standing![0]!, statedAt: now - 120 * DAY }] };
    expect(p(stale, thu7)).toBeLessThan(p(a, thu7));
    expect(A.needsReconfirm(stale.standing[0]!, now)).toBe(true);
    // A fixed-time opportunity (an event) offers its own time only.
    expect(A.chooseTimeOptions([a, b], now, { tz: LA, fixed: true, window: { start: sat10, end: sat10 + 2 * HOUR } }).slots.map(x => x.slot.start)).toEqual([sat10]);
    expect(A.timeOptionsPhrase(r.slots.map(x => x.slot), LA)).toMatch(/^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day \d+(am|pm)/);
    // Standing availability from availability_pattern facets.
    expect(A.standingFromFacets([{ kind: "availability_pattern", tags: ["evening:Tue", "evening:Thu"], inferred: true }], now)).toEqual([{ byDay: [2, 4], startHour: 17, endHour: 22, source: "calendar_pattern", statedAt: now, inferred: true }]);
    // Lowercase day tags (as sim sources.ts emits them) parse the same.
    expect(A.standingFromFacets([{ kind: "availability_pattern", tags: ["evening:tue", "evening:thu"], inferred: true }], now)).toEqual([{ byDay: [2, 4], startHour: 17, endHour: 22, source: "calendar_pattern", statedAt: now, inferred: true }]);
  });
});

describe("iteration 4: cheaper probe-first (parallel probes, warm mentions)", () => {
  const pair = { id: "p", participants: ["prov", "seek"], roles: { prov: "provider", seek: "seeker" } } as unknown as EngineProposal;
  test("parallel probes: both at once, any order; reveal only when both said yes; any no closes it", () => {
    let f = A.startProbeFlow(pair, { parallel: true });
    expect(A.toProbe(f).sort()).toEqual(["prov", "seek"]);
    f = A.recordProbeAnswer(f, "prov", true); // the partner may answer first
    expect(A.canReveal(f)).toBe(false);
    expect(A.revealFor(f, "prov", x => x)).toBeNull();
    expect(A.toProbe(f)).toEqual(["seek"]);
    f = A.recordProbeAnswer(f, "seek", true);
    expect(A.revealFor(f, "prov", x => x)).toEqual({ names: ["seek"] });
    const no = A.recordProbeAnswer(A.recordProbeAnswer(A.startProbeFlow(pair, { parallel: true }), "prov", true), "seek", false);
    expect(no.stage).toBe("closed");
    expect(A.revealFor(no, "prov", x => x)).toBeNull();
    const p = { ...pair, kind: "intro", category: "hobby", score: 0.45, explanations: {}, alternates: [], objective: "Intro: sailing", city: "sf" } as unknown as EngineProposal;
    expect(A.itemsForProposal(p, { now: NOW, parallel: true }).map(i => [i.memberId, i.stage])).toEqual([["prov", "first"], ["seek", "first"]]);
  });

  test("warm mention: consent of the mutual and of the person described, both tied to the mutual, an anonymity set of >= 3, never romance; replaces the attribute", () => {
    const inp = emptyInput(NOW);
    inp.members.push(baseMember("seek", { name: "Ada Lovelace" }), baseMember("prov", { name: "Zelda Quintana" }), baseMember("sam", { name: "Sam Rivera" }),
      baseMember("f1"), baseMember("f2"), baseMember("kid", { age: 15, name: "Kim Young" }));
    inp.presence.push({ memberId: "seek", city: "sf", type: "home", areas: ["Mission"] });
    inp.facets.push(facet("prov", 0, "interest", "film photography", ["film_photography"]), facet("seek", 0, "interest", "film photography", ["film_photography"]));
    const edge = (a: string, b: string) => ({ from: a, to: b, type: "knows" as const, strength: 0.8, explicit: true, createdAt: NOW - 30 * DAY });
    inp.edges.push(edge("sam", "seek"), edge("sam", "prov"), edge("sam", "f1"), edge("kid", "seek"), edge("kid", "prov"));
    const all = () => true;
    let w = mkWorld(inp);
    // Sam's friends other than the recipient: prov, f1 (2 < 3): could single out the person.
    expect(A.warmMention(w, "sam", "seek", ["prov"], all, "hobby")).toBeNull();
    inp.edges.push(edge("sam", "f2"));
    w = mkWorld(inp);
    expect(A.warmMention(w, "sam", "seek", ["prov"], all, "hobby")).toBe("Sam");
    expect(A.warmMention(w, "sam", "seek", ["prov"], id => id !== "sam", "hobby")).toBeNull(); // the mutual did not consent
    expect(A.warmMention(w, "sam", "seek", ["prov"], id => id !== "prov", "hobby")).toBeNull(); // the person described did not
    expect(A.warmMention(w, "sam", "seek", ["prov"], all, "romance")).toBeNull();
    expect(A.warmMention(w, "kid", "seek", ["prov"], all, "hobby")).toBeNull(); // a minor is never a mutual
    expect(A.warmMention(w, "sam", "f9", ["prov"], all, "hobby")).toBeNull(); // the recipient must know the mutual
    const spec: A.ProbeSpec = { proposalId: "p", kind: "member_intro", category: "hobby", objective: "Friend-of-a-friend intro: film photography", tz: LA, window: { start: NOW + 3 * DAY, end: NOW + 4 * DAY } };
    const pr = A.buildProbe(w, { ...spec, mutual: "Sam" }, "seek", ["prov"], NOW)!;
    expect(pr.text).toContain("a friend of Sam");
    expect(pr.mutual).toBe("Sam");
    expect(pr.attribute).toBeUndefined(); // the connection is the one fact (D5)
    for (const bad of ["Zelda", "Quintana"]) expect(pr.text).not.toContain(bad);
    expect(A.buildProbe(w, spec, "seek", ["prov"], NOW)!.attribute).toBe("film photography");
  });
});
