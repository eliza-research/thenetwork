// Review for slop and shadow mode, in memory (no database): the reviewer sees the pack's probe and
// an edit changes what goes out; slop cards carry no score; a reviewer's own opportunity passes the
// Network's filters and is refused for a minor; the review SLA per app; shadow items are labels that
// never reach a member, and their precision; double review; the urgent case kinds; event descriptions.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type MemberId } from "@thenetwork/core";
import { consoleRows, SIM_AUTO_REVIEWER, type ConsentNetwork } from "@thenetwork/network";
import type { EngineProposal } from "@thenetwork/engine";
import { makeSlopPack } from "@thenetwork/engine";
import { appWiring } from "../../network/service/packs.ts";
import { REVIEW_SLA_HOURS } from "../../platform/src/apps.ts";
import { DEFAULT_SLA_HOURS, matchingAllowed, PACK_READY } from "../src/apps.ts";
import { appEngineInput, runEngineSummarized } from "../src/engineCapture.ts";
import { describe as describeEvent, eventOf, NETWORK_EVENT_KINDS } from "../src/events.ts";
import { reviewAgreement, safetyInfo, scorecard, shadowPrecision, URGENT_CASE_KINDS } from "../src/health.ts";
import { scoreless, shapeState } from "../src/shape.ts";
import type { ObsOpportunity, ObsState } from "../src/types.ts";
import { T0, testNetwork } from "./net.ts";

const W = ["romance:is:woman", "romance:seeks:man"], M = ["romance:is:man", "romance:seeks:woman"];
const ADULTS = [{ id: "ana", age: 29, tags: W }, { id: "ben", age: 31, area: "Chelsea", tags: M }, { id: "cat", age: 27, area: "SoHo", tags: W }, { id: "dan", age: 33, area: "Gramercy", tags: M }];

/** An engine proposal for two members (the shape the engine hands the Network). */
function proposal(id: string, a: MemberId, b: MemberId, category: EngineProposal["category"] = "social"): EngineProposal {
  return {
    id, kind: "intro", participants: [a, b], alternates: [], objective: "coffee", category, city: "nyc", window: { start: T0 + DAY, end: T0 + 5 * DAY },
    score: 0.8, components: { fit: 0.8, mutualBenefit: 0.5, warmPath: 0, novelty: 0.5, timingFit: 0.5, activationCost: 0.1, interruptionCost: 0.1, load: 0, repetition: 0, socialRisk: 0, confidence: 0.8 },
    exploration: false, explanations: { [a]: "you both like climbing", [b]: "you both like climbing" }, generator: "test", createdAt: T0,
    roles: { [a]: "seeker", [b]: "peer" }, anchor: { type: "interest", id: "climbing" },
  } as unknown as EngineProposal;
}

/** Hand-ticks until a probe went to `id` (it waits for their send window), up to 3 days. */
async function probeTo(h: ReturnType<typeof testNetwork>, id: string) {
  for (let i = 0; i < 72; i++) {
    const p = h.sent.find(m => m.memberId === id && m.meta?.type === "probe");
    if (p) return p;
    h.clock.advance(HOUR); await h.net.tick(h.clock.now());
  }
  return undefined;
}

describe("slop review: the reviewer sees the probe the pack sends", () => {
  test("a review item carries the slop draft probe, and an edit changes what the probe sends", async () => {
    const h = testNetwork({ app: "slop", members: ADULTS });
    const c = h.net.compose({ participants: ["ana", "ben"], objective: "coffee date", reviewer: "composer@x.com" });
    expect(c.ok).toBe(true);
    const item = h.net.reviewQueue({ drafts: true }).find(i => i.oppId === c.oppId)!;
    expect(item.drafts?.probe.ana).toContain("go on a date");
    expect(item.drafts?.probe.ben).toContain("go on a date");
    expect(item.drafts?.reveal?.ana).toContain("first date");
    // Never a name in the probe.
    expect(item.drafts!.probe.ana).not.toMatch(/Ben/);
    // Appearance words are refused on slop, and so is a contact detail.
    expect(h.net.decide(c.oppId!, "edit", { probes: { ana: "Someone really cute nearby wants coffee. In?" }, reviewer: "r2@x.com" })).toEqual({ ok: false, reason: "appearance_leak" });
    expect(h.net.decide(c.oppId!, "edit", { probes: { ana: "Text me at 212-555-0199 for a coffee date" }, reviewer: "r2@x.com" })).toEqual({ ok: false, reason: "edit_leak" });
    const mine = "Someone near you is up for coffee this week and loves live music. Want me to check if they're in? I'll only share who it is if you both say yes.";
    expect(h.net.decide(c.oppId!, "edit", { probes: { ana: mine }, reviewer: "r2@x.com" })).toEqual({ ok: true });
    const sent = await probeTo(h, "ana");
    expect(sent?.body.startsWith(mine)).toBe(true);
    // The edit is recorded for the training label.
    const opp = h.net.exportState().opps.find(o => o.id === c.oppId)!;
    expect(opp.review?.edits).toContain("probe:ana");
  });

  test("slop card data has no score and no components; other apps keep them", () => {
    const o = { id: "o1", kind: "intro", source: "engine", generator: "g", city: "nyc", objective: "", score: 0.91, components: { fit: 0.9 }, explanations: {}, exploration: false, participants: [], alternates: [], state: "IN_REVIEW", status: {}, enjoyment: {}, createdAt: 0, updatedAt: 0 } as unknown as ObsOpportunity;
    const s = scoreless(o);
    expect(s.score).toBe(0);
    expect("components" in s).toBe(false);
    const st = { opportunities: [o], engineRuns: [{ id: "r", top: [{ score: 1, components: {} }] }], members: [], feed: [] } as unknown as ObsState;
    const slop = shapeState(st, "full", false, { scoreless: true });
    expect(JSON.stringify(slop.opportunities)).not.toContain("0.91");
    expect(slop.engineRuns[0]!.top).toEqual([]);
    expect(shapeState(st, "full", false).opportunities[0]!.score).toBe(0.91);
  });
});

describe("a reviewer's own opportunity (compose)", () => {
  test("on slop, the stated preferences must fit both ways", () => {
    const h = testNetwork({ app: "slop", members: ADULTS });
    expect(h.net.compose({ participants: ["ana", "cat"], objective: "a date", reviewer: "r1@x.com" }).ok).toBe(false);
    expect(h.net.compose({ participants: ["ana", "ben"], objective: "a date", reviewer: "r1@x.com" }).ok).toBe(true);
  });

  test("passes the filters and waits for review; refused for a minor, a block and a missing objective", () => {
    const h = testNetwork({ members: [...ADULTS, { id: "kid", age: 16 }] });
    const ok = h.net.compose({ participants: ["ana", "ben"], objective: "coffee about climbing", explanations: { ana: "you both climb", ben: "you both climb" }, reviewer: "r1@x.com" });
    expect(ok.ok).toBe(true);
    const item = h.net.reviewQueue().find(i => i.oppId === ok.oppId)!;
    expect(item.origin).toBe("human_composed");
    expect(h.sent.length).toBe(0); // nobody is contacted before review
    expect(h.net.compose({ participants: ["cat", "kid"], objective: "coffee", reviewer: "r1@x.com" })).toEqual({ ok: false, reason: "participant_minor" });
    expect(h.net.compose({ participants: ["cat", "cat"], objective: "coffee", reviewer: "r1@x.com" })).toEqual({ ok: false, reason: "bad_participants" });
    expect(h.net.compose({ participants: ["cat", "dan"], objective: " ", reviewer: "r1@x.com" })).toEqual({ ok: false, reason: "objective_required" });
    // Busy: ana is in the first item already.
    expect(h.net.compose({ participants: ["ana", "cat"], objective: "coffee", reviewer: "r1@x.com" })).toEqual({ ok: false, reason: "busy_elsewhere" });
    // Matching off: nothing new is composed.
    h.net.setMatchingEnabled(false, "admin");
    expect(h.net.compose({ participants: ["cat", "dan"], objective: "coffee", reviewer: "r1@x.com" })).toEqual({ ok: false, reason: "matching_paused" });
    // The console's store row says where it came from.
    const rows = consoleRows(h.net.exportState());
    expect(rows.opportunities.find(r => r.id === ok.oppId)?.source).toBe("reviewer");
  });
});

describe("review SLA per app", () => {
  test("one source of truth: the Network's wiring and the console's defaults", () => {
    expect(appWiring("slop").reviewSlaHours).toBe(6);
    expect(appWiring("peon").reviewSlaHours).toBe(24);
    expect(appWiring("ntwrk").reviewSlaHours).toBe(12);
    expect(DEFAULT_SLA_HOURS).toEqual({ ...REVIEW_SLA_HOURS });
  });

  for (const [app, hours] of [["slop", 6], ["peon", 24]] as const) {
    test(`${app}: an item expires unsent after ${hours} h`, async () => {
      const h = testNetwork({ app, members: ADULTS });
      const c = h.net.compose({ participants: ["cat", "dan"], objective: "meet", category: app === "slop" ? "romance" : "professional", reviewer: "r1@x.com" });
      expect(c.ok).toBe(true);
      await h.runUntil(T0 + (hours - 1) * HOUR);
      expect(h.net.reviewQueue().some(i => i.oppId === c.oppId)).toBe(true);
      await h.runUntil(T0 + (hours + 1) * HOUR);
      expect(h.net.reviewQueue().some(i => i.oppId === c.oppId)).toBe(false);
      const opp = h.net.exportState().opps.find(o => o.id === c.oppId)!;
      expect(opp.review?.decision).toBe("expired");
      expect(opp.review!.deadline - opp.review!.queuedAt).toBe(hours * HOUR);
      expect(h.sent.filter(m => m.meta?.type === "probe").length).toBe(0);
    });
  }
});

describe("shadow mode", () => {
  test("shadow items are labelled, never sent, and give a precision", async () => {
    const h = testNetwork({ members: ADULTS, network: { matchingEnabled: false, shadow: true } });
    expect(h.net.queueShadow([proposal("p1", "ana", "ben"), proposal("p2", "cat", "dan")])).toBe(2);
    const items = h.net.reviewQueue();
    expect(items.length).toBe(2);
    expect(items.every(i => i.shadow)).toBe(true);
    const [a, b] = items;
    // Matching is off, but a label is not a send: approve and reject are taken. Edit and re-roll are not.
    expect(h.net.decide(a!.oppId, "edit", { objective: "x", reviewer: "r1@x.com" })).toEqual({ ok: false, reason: "shadow_label_only" });
    expect(h.net.decide(a!.oppId, "approve", { reviewer: "r1@x.com" })).toEqual({ ok: true });
    expect(h.net.decide(b!.oppId, "reject", { reason: "weak_reason", reviewer: "r1@x.com" })).toEqual({ ok: true });
    await h.runUntil(T0 + 3 * DAY);
    expect(h.sent.filter(m => ["probe", "proposal"].includes(String(m.meta?.type))).length).toBe(0);
    expect(h.net.counters.shadowApproved).toBe(1);
    expect(h.net.counters.shadowRejected).toBe(1);
    expect(h.net.counters.reviewApproved).toBe(0);
    expect(h.net.shadowLabelDays(h.clock.now())).toEqual({ days: 1, labels: 2 });
    // A shadow item never makes anyone busy: a real compose for the same people goes through once matching is on.
    h.net.setMatchingEnabled(true, "admin");
    expect(h.net.compose({ participants: ["ana", "ben"], objective: "coffee", reviewer: "r1@x.com" }).ok).toBe(true);
    // The console's rows carry the shadow flag; precision is approved over labelled.
    const rows = consoleRows(h.net.exportState());
    expect(rows.review_items.filter(r => r.shadow).length).toBe(2);
    const opps = rows.review_items.filter(r => r.shadow).map(r => ({
      id: r.opportunity_id, source: "engine", review: { shadow: true, decision: r.decision, decidedAt: new Date(r.decided_at as Date).getTime(), queuedAt: 0, deadline: 0 },
    })) as unknown as ObsOpportunity[];
    expect(shadowPrecision(opps, h.clock.now())).toEqual({ approved: 1, decided: 2, days: 1 });
    const card = scorecard({ now: h.clock.now(), start: T0, members: [], opps, messages: [], requests: [], optOutAt: new Map(), invites: 0, accepts: 0, reviewSeconds: 0, sentProposals: 0, inviters: 0, minorContacts: 0, leaks: 0 });
    expect(card.find(m => m.key === "shadow_precision")?.value).toBe(0.5);
  });

  test("the daily run with matching off and shadow on is a shadow run; with shadow off nothing runs", async () => {
    const runs: boolean[] = [];
    const h = testNetwork({ members: ADULTS, network: { matchingEnabled: false, shadow: true, onEngineRun: (_l, _p, _t, o) => runs.push(!!o?.shadow) } });
    // Tue 14:00 to 20:00 New York: one daily run.
    await h.runUntil(T0 + 6 * HOUR);
    expect(h.net.counters.shadowRuns).toBe(1);
    expect(h.net.counters.engineRuns).toBe(0);
    expect(runs).toEqual([true]);
    expect(h.logs.some(l => l.type === "shadow_run")).toBe(true);
    const off = testNetwork({ members: ADULTS, network: { matchingEnabled: false, shadow: false } });
    await off.runUntil(T0 + DAY);
    expect(off.net.counters.shadowRuns + off.net.counters.engineRuns).toBe(0);
    // The switch is stored with the state.
    h.net.setShadowEnabled(false, "admin");
    expect(h.net.exportState().shadow).toBe(false);
  });

  test("an unlabelled shadow item expires without counting as a missed SLA", async () => {
    const h = testNetwork({ members: ADULTS, network: { matchingEnabled: false, shadow: true } });
    h.net.queueShadow([proposal("p1", "ana", "ben")]);
    await h.runUntil(T0 + 13 * HOUR);
    expect(h.net.reviewQueue().length).toBe(0);
    expect(h.net.counters.reviewExpired).toBe(0);
  });

  test("the simulated reviewer never labels shadow items", () => {
    const h = testNetwork({ members: ADULTS, network: { matchingEnabled: false, shadow: true, review: "auto" } });
    h.net.queueShadow([proposal("p1", "ana", "ben")]);
    expect(h.net.reviewQueue().length).toBe(1);
    h.net.setReviewMode("auto", "test");
    expect(h.net.reviewQueue().length).toBe(1);
  });

  test("the console's shadow run uses the slop pack, adults only, and the city it is given", async () => {
    const h = testNetwork({ app: "slop", members: [...ADULTS, { id: "kid", age: 16 }] });
    const snap = { now: T0, members: [], facets: [], intents: [], presence: [], edges: [], recentProposals: [] } as Parameters<typeof appEngineInput>[0];
    const real = (h.net as ConsentNetwork).packInput(T0);
    const snapshot = { ...snap, members: [...real.members, { ...real.members[0]!, id: "kid", age: 16 }], presence: real.presence, facets: real.facets };
    const input = appEngineInput(snapshot, "slop");
    expect(input.members.some(m => m.id === "kid")).toBe(false);
    const { summary, proposals } = await runEngineSummarized(snapshot, { seed: 1, city: "nyc", shadow: true, app: "slop" });
    const slopGenerators = new Set<string>(makeSlopPack({ verification: { required: false } }).generators.map(g => g.name));
    expect(Object.keys(summary.byGenerator).every(g => slopGenerators.has(g))).toBe(true);
    expect(Object.keys(summary.byGenerator).length).toBeGreaterThan(0);
    expect(summary.shadow).toBe(true);
    expect(proposals.every(p => p.city === "nyc" && !p.participants.includes("kid"))).toBe(true);
  });
});

describe("double review", () => {
  test("a sampled decision comes back blind to another reviewer; the second changes nothing; agreement is counted", () => {
    const h = testNetwork({ members: ADULTS, network: { doubleReviewShare: 1 } });
    const c = h.net.compose({ participants: ["ana", "ben"], objective: "coffee", reviewer: "c@x.com" });
    expect(h.net.decide(c.oppId!, "reject", { reason: "weak_reason", reviewer: "r1@x.com" })).toEqual({ ok: true });
    const second = h.net.reviewQueue().find(i => i.oppId === c.oppId)!;
    expect(second.second).toEqual({ firstReviewer: "r1@x.com" });
    expect(h.net.decide(c.oppId!, "approve", { reviewer: "r1@x.com" })).toEqual({ ok: false, reason: "same_reviewer" });
    expect(h.net.decide(c.oppId!, "reroll", { reviewer: "r2@x.com" })).toEqual({ ok: false, reason: "not_applicable" });
    expect(h.net.decide(c.oppId!, "approve", { reviewer: "r2@x.com" })).toEqual({ ok: true });
    const opp = h.net.exportState().opps.find(o => o.id === c.oppId)!;
    expect(opp.stage).toBe("closed"); // the first decision (reject) stands
    expect(opp.review?.second).toMatchObject({ status: "done", decision: "approve", reviewer: "r2@x.com" });
    expect(h.net.counters.secondReviews).toBe(1);
    expect(h.net.counters.secondAgreed).toBe(0);
    expect(h.sent.length).toBe(0);
    const obs = [{ review: { decision: "reject", second: { status: "done", decision: "approve" } } }, { review: { decision: "approve", second: { status: "done", decision: "approve" } } }] as unknown as ObsOpportunity[];
    expect(reviewAgreement(obs)).toEqual({ agreed: 1, done: 2 });
    // The default share is 10%, picked per item; the simulated reviewer is never sampled.
    const sim = testNetwork({ members: ADULTS, network: { doubleReviewShare: 1 } });
    const s = sim.net.compose({ participants: ["cat", "dan"], objective: "coffee", reviewer: "c@x.com" });
    sim.net.decide(s.oppId!, "reject", { reason: "weak_reason", reviewer: SIM_AUTO_REVIEWER });
    expect(sim.net.reviewQueue().length).toBe(0);
  });

  test("off with share 0", () => {
    const h = testNetwork({ members: ADULTS, network: { doubleReviewShare: 0 } });
    const c = h.net.compose({ participants: ["ana", "ben"], objective: "coffee", reviewer: "c@x.com" });
    h.net.decide(c.oppId!, "reject", { reason: "weak_reason", reviewer: "r1@x.com" });
    expect(h.net.reviewQueue().length).toBe(0);
  });
});

describe("console matching for slop and the safety queue", () => {
  test("slop's pack is ready (peon's is not)", () => {
    expect(PACK_READY.has("slop")).toBe(true);
    expect(matchingAllowed("slop")).toBe(true);
    expect(matchingAllowed("peon")).toBe(false);
  });

  test("urgent case kinds: minors, unsafe dates, harassment and scams are 1-hour cases", () => {
    for (const k of ["minor_reported", "report:unsafe", "report:minor", "report:harassment", "report:scam", "harassment", "scam_money", "contact_extraction"]) expect(URGENT_CASE_KINDS.has(k)).toBe(true);
    for (const k of ["report:lying", "report:no_show", "report:other", "spam"]) expect(URGENT_CASE_KINDS.has(k)).toBe(false);
    const info = safetyInfo({
      now: T0 + 2 * HOUR, members: [], opps: [], watch: [], hold: [], canAct: true,
      cases: [
        { id: "c1", memberId: "ana", opened: T0, level: "ok", status: "open", events: [{ at: T0, kind: "report:unsafe", points: 0 }] },
        { id: "c2", memberId: "ben", opened: T0, level: "ok", status: "open", events: [{ at: T0, kind: "minor_reported", points: 0 }] },
        { id: "c3", memberId: "cat", opened: T0, level: "ok", status: "open", events: [{ at: T0, kind: "report:no_show", points: 0 }] },
      ],
    });
    const by = new Map(info.cases.map(c => [c.id, c]));
    expect(by.get("c1")).toMatchObject({ urgent: true, overdue: true });
    expect(by.get("c2")).toMatchObject({ urgent: true, overdue: true });
    expect(by.get("c3")).toMatchObject({ urgent: false, overdue: false });
  });

  test("safety and outcome events are stored and described, minors and urgent reports as high severity", () => {
    for (const k of ["report_received", "minor_reported", "abuse_disclosed", "fraud_queued", "fraud_decision", "meeting_cancelled", "plan_booked", "attendance", "shadow_run", "second_review"]) expect(NETWORK_EVENT_KINDS.has(k)).toBe(true);
    const row = (type: string, payload: Record<string, unknown>) => eventOf({ t: T0, type: "network_log", kind: type, detail: payload } as never)!;
    const rep = row("report_received", { reportId: "r1", kind: "unsafe", memberId: "ana", target: "ben", met: true });
    expect(rep.object_type).toBe("member");
    expect(describeEvent(rep).severity).toBe("bad");
    expect(describeEvent(row("report_received", { kind: "lying", memberId: "ana", target: "ben" })).severity).toBe("warn");
    expect(describeEvent(row("minor_reported", { memberId: "ben", by: "ana" })).severity).toBe("bad");
    expect(describeEvent(row("abuse_disclosed", { memberId: "ana", kinds: ["violence"] })).severity).toBe("bad");
    expect(describeEvent(row("plan_booked", { oppId: "o1", going: 3, quorum: 3 })).text).toContain("3 going");
    expect(describeEvent(row("attendance", { oppId: "o1", booked: 3, present: 2 })).text).toContain("2 of 3");
    expect(describeEvent(row("meeting_cancelled", { proposalId: "o1", reason: "blocked" })).text).toContain("blocked");
  });
});
