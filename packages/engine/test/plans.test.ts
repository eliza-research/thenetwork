// Plans (src/plans.ts): planner scoring and least misery, the minors and romance exclusions, quorum,
// backfill and fallbacks, crews, and the probe content rules (D5). Deterministic, no LLM calls.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, isSensitiveTerm } from "@thenetwork/core";
import { ACTIVITIES, type Venue } from "../src/activities.ts";
import * as A from "../src/attention.ts";
import { DEFAULT_PLANS, resolvePlans } from "../src/config.ts";
import { fromLocal, localParts as localPartsOf } from "../src/outreach.ts";
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
    expect(P.planFallback(two, NOW, [ev]).fallback).toMatchObject({ kind: "smaller", members: ["a", "b"] });
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
    expect(P.buildPlanProbe(w, plan({ invited: ["ana", "ben"], crewId: "crew_1" }), "ana", NOW, TZ)).toContain("Your crew for bouldering is on again");
    expect(P.buildPlanProbe(w, plan({ invited: ["ana", "ben"] }), "zed", NOW, TZ)).toBeNull();
  });
  test("ordinary words of the fixed copy in another invitee's private facts do not drop the probe; their private words still never appear", () => {
    // Network build report: about 1/3 of plan probes were null because "Free." matched another invitee's private words.
    const ids = ["ana", "ben", "cy", "dee"];
    const inp = climbers(ids, (id, x) => {
      x.facets.push(facet(id, 1, "fact", "free most evenings since the divorce, only wants people who share recovery goals", ["sensitive"], "agent_private"));
    });
    const w = mkWorld(inp);
    for (const p of [plan({ invited: ids, activityId: "group_run" }), plan({ invited: ids }), plan({ invited: ["ana", "ben"], partner: true, activityId: "group_run" }), plan({ invited: ids, crewId: "crew_1", activityId: "group_run" })]) {
      const text = P.buildPlanProbe(w, p, "ana", NOW, TZ);
      expect(text).not.toBeNull();
      expect(text!).not.toMatch(/divorce|recovery|evenings|goals/i);
    }
    expect(P.buildPlanProbe(w, plan({ invited: ids, activityId: "group_run" }), "ana", NOW, TZ)).toContain("Free.");
  });
  test("the probe copy allowlist never contains a sensitive term", () => {
    for (const t of P.PLAN_COPY_PUBLIC) expect(isSensitiveTerm(t)).toBe(false);
  });
  test("crew, partner and group probe copy reads as English for every activity", () => {
    const w = mkWorld(climbers(["ana", "ben", "cy"]));
    for (const a of ACTIVITIES) {
      const crew = P.buildPlanProbe(w, plan({ invited: ["ana", "ben", "cy"], crewId: "crew_1", activityId: a.id }), "ana", NOW, TZ);
      if (!crew) continue;
      expect(crew).toStartWith(`Your crew for ${a.label} is on again: `);
      expect(crew).not.toMatch(/\bYour (a|an|the) /);
      const partner = P.buildPlanProbe(w, plan({ invited: ["ana", "ben"], partner: true, activityId: a.id }), "ana", NOW, TZ)!;
      expect(partner).toStartWith(`Up for ${a.label} with someone`);
      expect(partner).not.toMatch(/\b(a|an) (a|an)\b|  |\.\./);
    }
    expect(P.buildPlanProbe(w, plan({ invited: ["ana", "ben", "cy"], crewId: "crew_1", activityId: "group_run" }), "ana", NOW, TZ)).toStartWith("Your crew for an easy group run is on again: ");
  });
});

describe("crews (4.7)", () => {
  const rec = (planId: string, at: number, positive: string[], recurringWant: string[] = []): P.PlanOutcomeRecord =>
    ({ planId, activityId: "bouldering", venueId: "v1", city: "sf", at, attended: positive, positive, recurringWant });
  test("founder default: one great plan (>= 3 would do it again) proposes a crew; each person opts in", () => {
    const c = P.detectCrews([rec("p1", NOW, ["a", "b", "c", "d"])], [], id => id === "d");
    expect(c.length).toBe(1);
    expect(c[0]!.members).toEqual(["a", "b", "c", "d"]);
    expect(P.detectCrews([rec("p1", NOW, ["a", "b"])], [], () => false)).toEqual([]);
    const joined = P.crewOptIn(c[0]!, ["a", "b", "c"])!;
    expect(joined.members).toEqual(["a", "b", "c"]);
    expect(joined.hostRotation).toEqual(["a", "b", "c"]); // the only host-tagged member did not opt in
    expect(P.crewOptIn(c[0]!, ["a", "b"])).toBeNull();
    expect(P.crewOptIn(c[0]!, ["a", "b", "x", "y"])).toBeNull(); // only proposed members can join
  });
  test("previous rule (minPlans 2): three members positive at two plans together; one plan is not enough without a recurring want", () => {
    const two = resolvePlans({ crews: { minPlans: 2 } });
    expect(P.detectCrews([rec("p1", NOW, ["a", "b", "c", "d"])], [], () => false, two)).toEqual([]);
    const crews = P.detectCrews([rec("p1", NOW, ["a", "b", "c", "d"]), rec("p2", NOW + 7 * DAY, ["a", "b", "c", "e"])], [], id => id === "b", two);
    expect(crews.length).toBe(1);
    expect(crews[0]!.members).toEqual(["a", "b", "c"]);
    expect(crews[0]!.hostRotation).toEqual(["b"]);
    expect(P.detectCrews([rec("p1", NOW, ["a", "b", "c"], ["a"])], [], () => false, two).length).toBe(1);
    // Not re-grouped once in a crew.
    expect(P.detectCrews([rec("p1", NOW, ["a", "b", "c", "d"]), rec("p2", NOW + 7 * DAY, ["a", "b", "c"])], crews, () => false, two)).toEqual([]);
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

describe("the plan allowance (founder decision 2026-10-08)", () => {
  const view = (o: Partial<A.MemberAttention> = {}): A.MemberAttention => ({ memberId: "a", state: "normal", age: 30, tz: TZ, quietHours: [22, 8], onlyWhenAsked: false, newcomer: false, prefs: A.defaultCadence("normal"), ...o });
  // Monday 12:30 in San Francisco: inside the default send window, outside quiet hours.
  const T = fromLocal(2026, 10, 5, 12, TZ) + 30 * 60_000;
  const item = (id = "plan_x") => ({ ...P.planItem(plan({ id }), "a", { now: T - DAY, reviewState: "approved" }), urgency: { expiresAt: T + 3 * DAY } });
  const entry = (at: number, id = "m1", repliedAt?: number): import("../src/types.ts").AttentionLedgerEntry => ({ messageId: id, memberId: "a", at, kind: "digest", itemIds: [], countsAgainstCap: true, ...(repliedAt ? { repliedAt } : {}) });
  test("only members with a stated, standing or learned window, or the weekly check-in, use it", () => {
    expect(P.planAllowanceEligible(undefined, false, NOW)).toBe(false);
    expect(P.planAllowanceEligible({ memberId: "a", tz: TZ }, false, NOW)).toBe(false);
    expect(P.planAllowanceEligible(undefined, true, NOW)).toBe(true);
    expect(P.planAllowanceEligible(stated("a"), false, NOW)).toBe(true);
    expect(P.planAllowanceEligible({ ...stated("a"), stated: { windows: [], at: NOW - 9 * DAY, until: NOW - 2 * DAY } }, false, NOW)).toBe(false);
    expect(P.planAllowanceEligible({ memberId: "a", tz: TZ, standing: [{ byDay: [6], startHour: 17, endHour: 22, source: "onboarding", statedAt: NOW }] }, false, NOW)).toBe(true);
    expect(P.planAllowanceEligible({ memberId: "a", tz: TZ, history: [{ at: NOW - DAY, outcome: "attended" }] }, false, NOW)).toBe(true);
    expect(P.planAllowanceEligible({ memberId: "a", tz: TZ, history: [{ at: NOW - DAY, outcome: "declined_time" }] }, false, NOW)).toBe(false);
  });
  test("1 plan invite per 7 days, separate from the intro cap; one plan per message (outside-world companions allowed); no break-ins", () => {
    const acfg = P.planAllowanceConfig();
    expect(acfg.caps.normal).toEqual({ limit: 1, periodDays: 7 });
    expect(acfg.caps.quiet).toEqual({ limit: 1, periodDays: 7 });
    expect(acfg.caps.paused.limit).toBe(0);
    expect(acfg.maxMemberItems).toBe(1);
    // The intro cap itself is unchanged.
    expect(A.capFor(view())).toEqual({ limit: 2, periodDays: 7 });
    const conv = { outboundSinceInbound: 0 };
    // The plan lane passes only the member's plan invites as the ledger, so intros already sent this
    // week (the intro cap used up) do not block a plan invite.
    const ok = A.composeMessage({ member: view(), items: [item()], ledger: [], conversation: conv, now: T, mode: "digest", cfg: acfg });
    expect(ok.send).toBe(true);
    expect(ok.countsAgainstCap).toBe(true);
    // A plan invite already this week: the allowance is spent.
    expect(A.composeMessage({ member: view(), items: [item("plan_y")], ledger: [entry(T - 2 * DAY, "p1", T - 2 * DAY + HOUR)], conversation: conv, now: T, mode: "digest", cfg: acfg }).reason).toBe("cap");
    // Two plans held: one per message.
    expect(A.composeMessage({ member: view(), items: [item("plan_a"), item("plan_b")], ledger: [], conversation: conv, now: T, mode: "digest", cfg: acfg }).items.length).toBe(1);
  });
  test("quiet hours, the two-unanswered pause and the Blooio streak still apply", () => {
    const acfg = P.planAllowanceConfig();
    const conv = { outboundSinceInbound: 0 };
    expect(A.composeMessage({ member: view({ quietHours: [12, 13] }), items: [item()], ledger: [], conversation: conv, now: T, mode: "digest", cfg: acfg }).reason).toBe("quiet_hours");
    expect(A.composeMessage({ member: view({ onlyWhenAsked: true }), items: [item()], ledger: [], conversation: conv, now: T, mode: "digest", cfg: acfg }).reason).toBe("only_when_asked");
    expect(A.composeMessage({ member: view(), items: [item()], ledger: [], conversation: { outboundSinceInbound: 2 }, now: T, mode: "digest", cfg: acfg }).reason).toBe("conversation_streak");
    expect(A.composeMessage({ member: view({ state: "paused" }), items: [item()], ledger: [], conversation: conv, now: T, mode: "digest", cfg: acfg }).send).toBe(false);
    expect(A.composeMessage({ member: view({ age: 16 }), items: [item()], ledger: [], conversation: conv, now: T, mode: "digest", cfg: acfg }).send).toBe(false);
  });
});

describe("config", () => {
  test("group plans are 3-6 and partner plans 2 (D15)", () => {
    expect(() => resolvePlans({ size: { max: 7 } })).toThrow();
    expect(() => resolvePlans({ size: { partner: 3 } })).toThrow();
    expect(resolvePlans().quorum.group).toBe(3);
    expect(resolvePlans().allowance).toEqual({ enabled: true, limit: 1, periodDays: 7 });
    expect(resolvePlans().crews.minPlans).toBe(1);
    expect(() => resolvePlans({ crews: { minPlans: 3 } })).toThrow();
  });
});

describe("audit 2026-10-08 (engine-attention-plans-2, -4, -10, -12, -13)", () => {
  test("plans-2: alternates are pairwise compatible with each other", () => {
    const ids = ["ana", "ben", "cy", "dee", "eve", "fay", "gus", "hal"];
    const inp = climbers(ids);
    // The would-be alternates block each other: at most one of them may be an alternate.
    for (const [a, b] of [["fay", "gus"], ["fay", "hal"], ["gus", "hal"]]) inp.edges.push({ from: a!, to: b!, type: "blocked", strength: 1, explicit: true, createdAt: NOW - DAY });
    const w = mkWorld(inp);
    // fay, gus and hal are less sure they are free: they are the alternates, never the primary group.
    const ev = new Map(ids.map(id => [id, ["fay", "gus", "hal"].includes(id) ? { ...stated(id), stated: { ...stated(id).stated!, confidence: 0.3 } } : stated(id)]));
    const ps = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: ev, venues: [VENUE] });
    expect(ps.some(p => p.alternates.length > 0)).toBe(true);
    for (const p of ps) {
      const all = [...p.invited, ...p.alternates];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(w.blocked.has([all[i]!, all[j]!].sort().join("|"))).toBe(false);
    }
  });
  test("plans-4: crew sessions keep the local time across a DST change", () => {
    const NY = "America/New_York";
    const first = fromLocal(2026, 10, 24, 19, NY); // Saturday 19:00 EDT, before the 1 November change
    const crew: P.Crew = { id: "c", activityId: "bouldering", city: "nyc", members: ["a", "b", "c"], cadenceDays: 7, hostRotation: ["a"], sessions: [], handedOff: false, slot: { start: first } };
    const s = P.crewSessionPlan(crew, fromLocal(2026, 10, 27, 9, NY), { name: "x" })!;
    const lp = localPartsOf(s.window.start, NY);
    expect([lp.day, lp.hour]).toEqual([31, 19]);
    const after = P.crewSessionPlan(crew, fromLocal(2026, 11, 3, 9, NY), { name: "x" })!;
    expect(localPartsOf(after.window.start, NY).hour).toBe(19);
  });
  test("plans-10: two yes-sayers of a group plan get a fresh partner probe, not a booking", () => {
    const two = { ...P.startPlanRun(plan()), answers: { a: "yes", b: "yes", c: "no", d: "no" } as Record<string, P.PlanAnswer>, stage: "closed" as const };
    const f = P.planFallback(two, NOW, []).fallback;
    expect(f.kind).toBe("smaller");
    const pp = f.kind === "smaller" ? f.partnerPlan! : undefined;
    expect(pp?.partner).toBe(true);
    expect(pp?.invited).toEqual(["a", "b"]);
    expect(pp?.id).not.toBe("plan_x");
    // One-to-one rules: only the first member is probed at the start.
    expect(Object.keys(P.startPlanRun(pp!).answers)).toEqual(["a"]);
  });
  test("plans-12: equal members do not lose every plan to the lowest ids", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `m${String(i).padStart(2, "0")}`);
    const w = mkWorld(climbers(ids));
    const ps = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [VENUE] });
    const invited = new Set(ps.flatMap(p => p.invited));
    expect(ps.length).toBeGreaterThan(1);
    expect(invited.size).toBeGreaterThan(6);
  });
  test("plans-13: no plan at a romance event, and event capacity bounds the group", () => {
    const ids = ["ana", "ben", "cy", "dee", "eve"];
    const inp = climbers(ids);
    const ev = (id: string, category: NetworkEvent["category"], capacity?: number): NetworkEvent =>
      ({ id, title: `climbing ${id}`, city: "sf", area: "mission", start: SAT, end: SAT + 2 * HOUR, tags: ["climbing"], category, ...(capacity ? { capacity } : {}) });
    inp.events = [ev("rom", "romance"), ev("small", "social", 2)];
    const w = mkWorld(inp);
    const ps = P.planProposals(w, { now: NOW, city: "sf", tz: TZ, evidence: evidence(ids), venues: [] });
    expect(ps.some(p => p.eventId === "rom")).toBe(false);
    expect(ps.some(p => p.eventId === "small")).toBe(true);
    for (const p of ps.filter(p => p.eventId === "small")) expect(p.invited.length).toBeLessThanOrEqual(2);
  });
});
