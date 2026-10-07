// Plans (src/plans.ts): planner scoring and least misery, the minors and romance exclusions, quorum,
// backfill and fallbacks, crews, and the probe content rules (D5). Deterministic, no LLM calls.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import type { Venue } from "../src/activities.ts";
import * as A from "../src/attention.ts";
import { DEFAULT_PLANS, resolvePlans } from "../src/config.ts";
import { fromLocal } from "../src/outreach.ts";
import * as P from "../src/plans.ts";
import type { EngineInput, NetworkEvent } from "../src/types.ts";
import { NOW, baseMember, emptyInput, facet, mkWorld } from "./helpers.ts";

const TZ = "America/Los_Angeles";
// NOW is Monday 2026-10-05 09:00 in San Francisco; Saturday 7pm is inside the planning horizon.
const SAT = fromLocal(2026, 10, 10, 19, TZ);
const VENUE: Venue = { id: "v1", city: "sf", area: "mission", name: "the mission climbing gym", activities: ["bouldering"], priceTier: 2, ageMin: 18,
  hours: { weekday: [9, 23], weekend: [9, 23] }, public: true, source: "curated" };

function climbers(ids: string[], over: (id: string, inp: EngineInput) => void = () => {}): EngineInput {
  const inp = emptyInput(NOW);
  for (const id of ids) {
    inp.members.push(baseMember(id, { name: `${id[0]!.toUpperCase()}${id.slice(1)} Q` }));
    inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
    inp.facets.push(facet(id, 0, "interest", "bouldering and climbing", ["climbing"]));
    over(id, inp);
  }
  return inp;
}
const stated = (id: string, windows = [{ start: SAT, end: SAT + 2 * HOUR }]): P.PlanEvidence =>
  ({ memberId: id, tz: TZ, stated: { windows, at: NOW - HOUR, until: NOW + 7 * DAY } });
const evidence = (ids: string[]) => new Map(ids.map(id => [id, stated(id)]));
const plan = (o: Partial<P.Plan> = {}): P.Plan => ({
  id: "plan_x", city: "sf", activityId: "bouldering", venueId: "v1", place: { name: VENUE.name, area: "mission" }, window: { start: SAT, end: SAT + 2 * HOUR },
  invited: ["a", "b", "c", "d"], alternates: ["e", "f"], partner: false, size: { min: 3, target: 4, max: 6 }, quorum: 3,
  probeDeadline: SAT - 30 * HOUR, score: 0.6, u: {}, familiar: {}, createdAt: NOW, category: "social", ...o,
});

describe("least-misery scoring (4.5)", () => {
  const compat = () => 0.5;
  const none = () => false;
  test("one miserable member pulls U down more than the mean would", () => {
    const even = P.scorePlanGroup(["a", "b", "c"].map(id => ({ id, fit: 0.8, venueFit: 1, timeFit: 1 })), compat, none)!;
    const skewed = P.scorePlanGroup([{ id: "a", fit: 1, venueFit: 1, timeFit: 1 }, { id: "b", fit: 1, venueFit: 1, timeFit: 1 }, { id: "c", fit: 0.4, venueFit: 1, timeFit: 1 }], compat, none)!;
    expect(skewed.mean).toBeCloseTo(even.mean, 5);
    expect(skewed.score).toBeLessThan(even.score);
    expect(even.score).toBeCloseTo(0.6 * even.min + 0.4 * even.mean, 6);
    // Scored by the mean alone (minWeight 0), the two tie: least misery is what separates them.
    const mean0 = (g: typeof even) => g.mean;
    expect(mean0(skewed)).toBeCloseTo(mean0(even), 6);
  });
  test("u_i multiplies activity, venue and time fit by social fit", () => {
    expect(P.memberUtility({ id: "a", fit: 1, venueFit: 0.85, timeFit: 0.8 }, ["b"], () => 1)).toBeCloseTo(0.68, 6);
    expect(P.memberUtility({ id: "a", fit: 1, venueFit: 1, timeFit: 1 }, ["b"], () => 0)).toBeCloseTo(0.5, 6);
  });
  test("one familiar face plus new people is rewarded; a closed clique is penalised", () => {
    const ids = ["a", "b", "c", "d"].map(id => ({ id, fit: 1, venueFit: 1, timeFit: 1 }));
    const base = P.scorePlanGroup(ids, () => 0.5, () => false)!;
    const pair = new Set(["a|b", "b|a"]);
    const oneFace = P.scorePlanGroup(ids, () => 0.5, (x, y) => pair.has(`${x}|${y}`))!;
    const clique = P.scorePlanGroup(ids, () => 0.5, () => true)!;
    expect(oneFace.score).toBeGreaterThan(base.score);
    expect(oneFace.familiar.a).toEqual(["b"]);
    expect(clique.score).toBeLessThan(base.score);
  });
  test("a hard pair rule (block, dealbreaker, cooldown) makes the group impossible", () => {
    expect(P.scorePlanGroup(["a", "b", "c"].map(id => ({ id, fit: 1, venueFit: 1, timeFit: 1 })), (x, y) => (x === "a" && y === "c" ? -Infinity : 0.5), () => false)).toBeNull();
  });
});

describe("the planner", () => {
  test("builds a 4-6 person plan at a public venue for members with a stated window and the interest", () => {
    const ids = ["ana", "ben", "cy", "dee", "eve"];
    const w = mkWorld(climbers(ids));
    const ps = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [VENUE] });
    expect(ps.length).toBe(1);
    const p = ps[0]!;
    expect(p.activityId).toBe("bouldering");
    expect(p.venueId).toBe("v1");
    expect(p.category).toBe("social");
    expect(p.window.start).toBe(SAT);
    expect(p.invited.length).toBeGreaterThanOrEqual(DEFAULT_PLANS.minInvite);
    expect(p.invited.length).toBeLessThanOrEqual(6);
    expect(p.quorum).toBe(3);
    expect(p.probeDeadline).toBeLessThanOrEqual(SAT - 30 * HOUR);
    expect(Math.min(...Object.values(p.u))).toBeGreaterThanOrEqual(DEFAULT_PLANS.minMemberU);
  });
  test("only members with a stated or inferred window: no evidence, or the daypart prior alone, is no demand", () => {
    const ids = ["ana", "ben", "cy", "dee", "eve"];
    const w = mkWorld(climbers(ids));
    const ev = evidence(["ana", "ben", "cy"]);
    ev.set("dee", { memberId: "dee", tz: TZ }); // prior only
    const ps = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: ev, venues: [VENUE] });
    for (const p of ps) { expect(p.invited).not.toContain("dee"); expect(p.invited).not.toContain("eve"); }
    expect(P.hasWindow({ memberId: "x", tz: TZ }, { start: SAT, end: SAT + 2 * HOUR }, NOW)).toBe(0);
    expect(P.hasWindow(stated("x"), { start: SAT, end: SAT + 2 * HOUR }, NOW)).toBeGreaterThan(0.5);
    // A standing window counts (inferred demand); a stated week that leaves the slot out is not demand.
    expect(P.hasWindow({ memberId: "x", tz: TZ, standing: [{ byDay: [6], startHour: 17, endHour: 22, source: "onboarding", statedAt: NOW }] }, { start: SAT, end: SAT + 2 * HOUR }, NOW)).toBeGreaterThan(0);
    expect(P.hasWindow(stated("x", [{ start: SAT - DAY, end: SAT - DAY + 2 * HOUR }]), { start: SAT, end: SAT + 2 * HOUR }, NOW)).toBe(0);
  });
  test("minors are never in a plan in any role, even with the interest, a window and a host tag", () => {
    const ids = ["ana", "ben", "cy", "kid", "kid2", "dee"];
    const w = mkWorld(climbers(ids, (id, inp) => {
      if (id.startsWith("kid")) { inp.members.find(m => m.id === id)!.age = 16; inp.facets.push(facet(id, 1, "skill", "loves hosting", ["hosting", "host"])); }
    }));
    const ps = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [VENUE] });
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) for (const id of [...p.invited, ...p.alternates, p.hostId]) expect(id?.startsWith("kid") ?? false).toBe(false);
    // And a minor gets no plan probe, and their item is gated by attention (members 13-17: never people).
    expect(P.buildPlanProbe(w, plan({ invited: ["ana", "ben", "kid"] }), "kid", NOW, TZ)).toBeNull();
    expect(P.buildPlanProbe(w, plan({ invited: ["ana", "ben", "kid"] }), "ana", NOW, TZ)).toBeNull();
    const it = P.planItem(plan({ invited: ["kid", "ana", "ben"] }), "kid", { now: NOW, reviewState: "approved" });
    const kidView: A.MemberAttention = { memberId: "kid", state: "normal", age: 16, tz: TZ, quietHours: [22, 8], onlyWhenAsked: false, newcomer: false, prefs: A.defaultCadence("normal") };
    expect(A.itemGate(kidView, it, NOW)).toBe("minor_restricted");
  });
  test("romance is never in a plan: plans are social, romance-only members are not planned, romance prefs are ignored", () => {
    const ids = ["ana", "ben", "cy", "dee", "rom"];
    const w = mkWorld(climbers(ids, (id, inp) => {
      if (id === "rom") inp.members.find(m => m.id === id)!.prefs = { ...inp.members.find(m => m.id === id)!.prefs, categoriesOptIn: ["romance"], romanceOptIn: true };
    }));
    const ps = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [VENUE] });
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) { expect(p.category).not.toBe("romance"); expect(p.invited).not.toContain("rom"); expect(P.planToProposal(p).category).toBe("social"); }
    expect(P.buildPlanProbe(w, plan({ invited: ["ana", "ben", "cy"], category: "romance" }), "ana", NOW, TZ)).toBeNull();
  });
  test("blocked members are never grouped together; paused and opted-out members are not planned", () => {
    const ids = ["ana", "ben", "cy", "dee", "eve", "fay"];
    const w = mkWorld(climbers(ids, (id, inp) => {
      if (id === "ana") inp.edges.push({ from: "ana", to: "ben", type: "blocked", strength: 1, explicit: true, createdAt: NOW - DAY });
      if (id === "fay") inp.members.find(m => m.id === id)!.state = "paused";
    }));
    const ps = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [VENUE] });
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) {
      expect(p.invited.includes("ana") && p.invited.includes("ben")).toBe(false);
      expect(p.invited).not.toContain("fay");
      for (const alt of p.alternates) expect(p.invited.every(x => !(x === "ana" && alt === "ben") && !(x === "ben" && alt === "ana"))).toBe(true);
    }
  });
  test("public venues only: no open, age-appropriate public venue for the activity, no plan", () => {
    const ids = ["ana", "ben", "cy", "dee"];
    const w = mkWorld(climbers(ids));
    const closed = { ...VENUE, hours: { weekday: [9, 17], weekend: [9, 17] } } as Venue;
    expect(P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [closed] })).toEqual([]);
    expect(P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [] })).toEqual([]);
  });
  test("a member invited recently is not planned again within the cooldown", () => {
    const ids = ["ana", "ben", "cy", "dee", "eve"];
    const w = mkWorld(climbers(ids));
    const ps = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [VENUE], lastPlannedAt: new Map([["ana", NOW - DAY]]) });
    for (const p of ps) expect([...p.invited, ...p.alternates]).not.toContain("ana");
  });
});

describe("quorum, backfill and fallbacks (4.6)", () => {
  test("quorum books the plan; a later yes joins; nobody learns who declined", () => {
    let r = P.startPlanRun(plan());
    expect(P.pendingOf(r).sort()).toEqual(["a", "b", "c", "d"]);
    let a = P.recordPlanAnswer(r, "a", true, NOW); r = a.run; expect(a.action.kind).toBe("none");
    a = P.recordPlanAnswer(r, "b", false, NOW); r = a.run; expect(a.action).toEqual({ kind: "backfill", member: "e" });
    a = P.recordPlanAnswer(r, "c", true, NOW); r = a.run; expect(a.action.kind).toBe("none");
    a = P.recordPlanAnswer(r, "d", true, NOW); r = a.run;
    expect(a.action).toEqual({ kind: "book", going: ["a", "c", "d"] });
    expect(r.stage).toBe("booked");
    a = P.recordPlanAnswer(r, "e", true, NOW); expect(a.action).toEqual({ kind: "join", member: "e" });
    // Too late to join: within lateJoinHours of the start.
    const late = P.recordPlanAnswer(r, "e", true, SAT - HOUR);
    expect(late.action.kind).toBe("none");
    // Answers are not counted twice.
    expect(P.recordPlanAnswer(a.run, "a", false, NOW).action.kind).toBe("none");
  });
  test("no quorum once everyone answered and the bench is empty -> fallback; the deadline also falls back", () => {
    let r = P.startPlanRun(plan({ invited: ["a", "b", "c"], alternates: [] }));
    r = P.recordPlanAnswer(r, "a", true, NOW).run;
    r = P.recordPlanAnswer(r, "b", false, NOW).run;
    const last = P.recordPlanAnswer(r, "c", false, NOW);
    expect(last.action.kind).toBe("fallback");
    expect(last.run.stage).toBe("closed");
    const r2 = P.startPlanRun(plan());
    expect(P.checkPlanDeadline(r2, NOW).action.kind).toBe("none");
    expect(P.checkPlanDeadline(r2, SAT - 30 * HOUR).action.kind).toBe("fallback");
    // No backfill after the deadline.
    expect(P.recordPlanAnswer(r2, "a", false, SAT - 29 * HOUR).action.kind).not.toBe("backfill");
  });
  test("activity-partner plans follow one-to-one rules: the partner is probed only after the first yes", () => {
    const pp = plan({ invited: ["a", "b"], alternates: ["c"], partner: true, quorum: 2, size: { min: 2, target: 2, max: 2 } });
    let r = P.startPlanRun(pp);
    expect(P.pendingOf(r)).toEqual(["a"]);
    const y = P.recordPlanAnswer(r, "a", true, NOW);
    expect(y.action).toEqual({ kind: "probe_partner", member: "b" });
    r = y.run;
    const n = P.recordPlanAnswer(r, "b", false, NOW);
    expect(n.action).toEqual({ kind: "backfill", member: "c" });
    expect(P.recordPlanAnswer(n.run, "c", true, NOW).action).toEqual({ kind: "book", going: ["a", "c"] });
    const first = P.recordPlanAnswer(P.startPlanRun(pp), "a", false, NOW);
    expect(first.action.kind).toBe("fallback");
  });
  test("fallback order: smaller group (activity allows 2), else a solo public event, else next week (demand carried)", () => {
    const ev: NetworkEvent = { id: "ev1", title: "climbing night", city: "sf", start: NOW + 3 * DAY, end: NOW + 3 * DAY + 3 * HOUR, tags: ["climbing"], category: "social" };
    const two = { ...P.startPlanRun(plan()), answers: { a: "yes", b: "yes", c: "no", d: "no" } as Record<string, P.PlanAnswer>, stage: "closed" as const };
    expect(P.planFallback(two, NOW, [ev]).fallback).toEqual({ kind: "smaller", members: ["a", "b"] });
    const noPair = { ...two, plan: plan({ activityId: "restaurant_dinner" }) };
    expect(P.planFallback(noPair, NOW, [ev]).fallback.kind).toBe("next_week");
    const one = { ...two, answers: { a: "yes", b: "no", c: "no", d: "no" } as Record<string, P.PlanAnswer> };
    const f = P.planFallback(one, NOW, [ev]);
    expect(f.fallback).toEqual({ kind: "solo_event", members: ["a"], eventId: "ev1" });
    expect(f.carry).toEqual([{ memberId: "a", activityId: "bouldering", until: NOW + DEFAULT_PLANS.fallback.carryDays * DAY }]);
    expect(P.planFallback(one, NOW, []).fallback).toEqual({ kind: "next_week", members: ["a"] });
    const none = { ...two, answers: { a: "no", b: "no", c: "no", d: "no" } as Record<string, P.PlanAnswer> };
    expect(P.planFallback(none, NOW, [ev]).fallback.kind).toBe("none");
    const off = resolvePlans({ fallback: { smaller: false, soloEvent: false, nextWeek: false } });
    expect(P.planFallback(two, NOW, [ev], off).fallback.kind).toBe("none");
  });
  test("carried demand raises the activity's fit for the next run", () => {
    const ids = ["ana", "ben", "cy", "dee"];
    const w = mkWorld(climbers(ids));
    const base = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [VENUE] })[0]!;
    const carried = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [VENUE], carry: ids.map(memberId => ({ memberId, activityId: "bouldering", until: NOW + DAY })) })[0]!;
    expect(carried.score).toBeGreaterThanOrEqual(base.score);
  });
});

describe("plan items and probe content (D5)", () => {
  test("a plan item is a plan_probe that involves other members, needs review, and expires at the probe deadline", () => {
    const it = P.planItem(plan(), "a", { now: NOW });
    expect(it.kind).toBe("plan_probe");
    expect(it.involvesMember).toBe(true);
    expect(it.reviewState).toBe("pending");
    expect(it.others.sort()).toEqual(["b", "c", "d"]);
    expect(it.urgency.expiresAt).toBe(SAT - 30 * HOUR);
    expect(A.isInitialInvite(it)).toBe(true);
    const view: A.MemberAttention = { memberId: "a", state: "normal", age: 30, tz: TZ, quietHours: [22, 8], onlyWhenAsked: false, newcomer: false, prefs: A.defaultCadence("normal") };
    expect(A.itemGate(view, it, NOW)).toBe("awaiting_review");
  });
  test("the probe shows activity, time, public place, size and cost; never a name, an employer or a private fact", () => {
    const ids = ["ana", "ben", "cy", "dee"];
    const inp = climbers(ids, (id, x) => {
      x.facets.push(facet(id, 1, "fact", `secret canary zq${id}x9 diagnosis`, ["sensitive"], "agent_private"));
      x.facets.push(facet(id, 2, "fact", "works at Initech as a manager", ["employer"], "matchable"));
    });
    const w = mkWorld(inp);
    const text = P.buildPlanProbe(w, plan({ invited: ids }), "ana", NOW, TZ)!;
    expect(text).toContain("Saturday 7pm");
    expect(text).toContain("bouldering");
    expect(text).toContain("the mission climbing gym");
    expect(text).toContain("3 others");
    expect(text).toContain("everyone pays their own way");
    expect(text).toContain("once enough people say yes");
    for (const id of ["Ben", "Cy", "Dee", "Q"]) expect(text).not.toMatch(new RegExp(`\\b${id}\\b`));
    expect(text).not.toMatch(/zq|canary|diagnosis|Initech|manager/i);
  });
  test("'who are into X' only when X is shareable for every other invitee", () => {
    const ids = ["ana", "ben", "cy"];
    const shared = mkWorld(climbers(ids));
    expect(P.buildPlanProbe(shared, plan({ invited: ids }), "ana", NOW, TZ)).toContain("who are into climbing");
    const oneMatchable = mkWorld(climbers(ids, (id, x) => { if (id === "cy") x.facets.find(f => f.memberId === "cy")!.scope = "matchable"; }));
    expect(P.buildPlanProbe(oneMatchable, plan({ invited: ids }), "ana", NOW, TZ)).not.toContain("into climbing");
  });
  test("partner and crew probes; partner probes promise no reveal before both say yes", () => {
    const w = mkWorld(climbers(["ana", "ben"]));
    expect(P.buildPlanProbe(w, plan({ invited: ["ana", "ben"], partner: true }), "ana", NOW, TZ)).toContain("if you both say yes");
    expect(P.buildPlanProbe(w, plan({ invited: ["ana", "ben"], crewId: "crew_1" }), "ana", NOW, TZ)).toContain("crew is on again");
    expect(P.buildPlanProbe(w, plan({ invited: ["ana", "ben"] }), "zed", NOW, TZ)).toBeNull();
  });
});

describe("crews (4.7)", () => {
  const rec = (planId: string, at: number, positive: string[], recurringWant: string[] = []): P.PlanOutcomeRecord =>
    ({ planId, activityId: "bouldering", venueId: "v1", city: "sf", at, attended: positive, positive, recurringWant });
  test("three members positive at two plans together form a crew; one plan is not enough without a recurring want", () => {
    expect(P.detectCrews([rec("p1", NOW, ["a", "b", "c", "d"])], [], () => false)).toEqual([]);
    const crews = P.detectCrews([rec("p1", NOW, ["a", "b", "c", "d"]), rec("p2", NOW + 7 * DAY, ["a", "b", "c", "e"])], [], id => id === "b");
    expect(crews.length).toBe(1);
    expect(crews[0]!.members).toEqual(["a", "b", "c"]);
    expect(crews[0]!.hostRotation).toEqual(["b"]);
    expect(P.detectCrews([rec("p1", NOW, ["a", "b", "c"], ["a"])], [], () => false).length).toBe(1);
    // Not re-grouped once in a crew.
    expect(P.detectCrews([rec("p1", NOW, ["a", "b", "c", "d"]), rec("p2", NOW + 7 * DAY, ["a", "b", "c"])], crews, () => false)).toEqual([]);
  });
  test("crew sessions repeat weekly at the same time and place, rotate the host, and stop at hand-off", () => {
    const crew = P.detectCrews([rec("p1", SAT - 7 * DAY, ["a", "b", "c"], ["a"])], [], () => true)[0]!;
    const s1 = P.crewSessionPlan(crew, NOW, { name: VENUE.name, area: "mission" })!;
    expect(s1.window.start).toBe(SAT);
    expect(s1.crewId).toBe(crew.id);
    expect(s1.invited).toEqual(["a", "b", "c"]);
    expect(s1.hostId).toBe("a");
    crew.sessions.push(s1.id);
    expect(P.crewSessionPlan(crew, NOW, { name: VENUE.name })!.hostId).toBe("b");
    expect(P.crewSessionPlan({ ...crew, handedOff: true }, NOW, { name: VENUE.name })).toBeNull();
  });
});

describe("config", () => {
  test("group plans are 3-6 and partner plans 2 (D15)", () => {
    expect(() => resolvePlans({ size: { max: 7 } })).toThrow();
    expect(() => resolvePlans({ size: { partner: 3 } })).toThrow();
    expect(resolvePlans().quorum.group).toBe(3);
  });
});
