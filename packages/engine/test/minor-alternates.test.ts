// Minors (and unknown ages) are never alternates or backfill candidates, in any selector: the group
// composer, the plan planner, the plan bench (backfill and the partner of a partner plan), and the
// opportunity state machine's backfill. Each case has a positive control: the same world with an
// adult in that seat does pick them. Deterministic, no LLM calls.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import type { Venue } from "../src/activities.ts";
import { fromLocal } from "../src/outreach.ts";
import { composeGroup } from "../src/group.ts";
import { createOpportunity, dispatchInvites, inviteAlternates, respond, transition } from "../src/opportunity.ts";
import * as P from "../src/plans.ts";
import type { EngineInput } from "../src/types.ts";
import { baseMember, emptyInput, facet, mkWorld, NOW } from "./helpers.ts";

const setAge = (inp: EngineInput, id: string, age: unknown) => { inp.members.find(m => m.id === id)!.age = age as number; return inp; };
const BAD_AGES: [string, unknown][] = [["minor", 16], ["unknown (NaN)", Number.NaN], ["unknown (missing)", undefined], ["implausible", 150]];

describe("group composer: alternates", () => {
  const world = (ageOfX: unknown) => {
    const inp = emptyInput(NOW);
    for (const id of ["a", "b", "c", "x"]) {
      inp.members.push(baseMember(id));
      inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
      inp.facets.push(facet(id, 0, "interest", "board games", ["boardgames"]));
    }
    if (ageOfX !== 30) setAge(inp, "x", ageOfX);
    return mkWorld(inp);
  };
  // x has the lowest anchor affinity, so the primary group is a, b, c and x is the natural alternate.
  const opts = {
    category: "social" as const, minSize: 3, maxSize: 3, window: { start: NOW, end: NOW + 7 * DAY }, preferredCity: "sf" as const, needHost: false,
    beamWidth: 8, minPairwise: -1, alternates: 3, pool: ["a", "b", "c", "x"].map(id => ({ id, affinity: id === "x" ? 0.1 : 0.5 })),
  };
  test("positive control: an adult outside the primary group is an alternate", () => {
    const g = composeGroup(world(30), opts)!;
    expect(g.primary.sort()).toEqual(["a", "b", "c"]);
    expect(g.alternates).toEqual(["x"]);
  });
  for (const [name, age] of BAD_AGES) test(`${name}: never an alternate`, () => {
    const g = composeGroup(world(age), opts)!;
    expect(g.primary.sort()).toEqual(["a", "b", "c"]);
    expect(g.alternates).not.toContain("x");
  });
});

describe("plan planner: alternates", () => {
  const TZ = "America/Los_Angeles";
  const SAT = fromLocal(2026, 10, 10, 19, TZ);
  const VENUE: Venue = { id: "v1", city: "sf", area: "mission", name: "the mission climbing gym", activities: ["bouldering"], priceTier: 2, ageMin: 18,
    hours: { weekday: [9, 23], weekend: [9, 23] }, public: true, source: "curated" };
  // Seven climbers: a six-person plan plus one alternate (eight would split into a plan and a pair).
  const ids = ["ana", "ben", "cy", "dee", "eve", "fay", "gus"];
  const plans = (bad: Record<string, unknown>) => {
    const inp = emptyInput(NOW);
    for (const id of ids) {
      inp.members.push(baseMember(id, { name: `${id[0]!.toUpperCase()}${id.slice(1)} Q` }));
      inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
      inp.facets.push(facet(id, 0, "interest", "bouldering and climbing", ["climbing"]));
    }
    for (const [id, age] of Object.entries(bad)) setAge(inp, id, age);
    const evidence = new Map(ids.map(id => [id, { memberId: id, tz: TZ, stated: { windows: [{ start: SAT, end: SAT + 2 * HOUR }], at: NOW - HOUR, until: NOW + 7 * DAY } } as P.PlanEvidence]));
    return P.planProposals(mkWorld(inp), { now: NOW, city: "sf", tz: TZ, evidence, venues: [VENUE] });
  };
  test("positive control: with seven adults, a six-person plan keeps an alternate", () => {
    expect(plans({}).some(p => p.alternates.length > 0)).toBe(true);
  });
  for (const [name, age] of BAD_AGES) test(`${name}: never invited, never an alternate`, () => {
    const ps = plans({ fay: age, gus: age });
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) for (const id of [...p.invited, ...p.alternates, p.hostId]) expect(["fay", "gus"]).not.toContain(id);
  });
});

describe("plan bench: backfill and partner probes skip minors and unknown ages", () => {
  const plan = (o: Partial<P.Plan> = {}): P.Plan => ({
    id: "plan_x", city: "sf", activityId: "bouldering", place: { name: "gym", area: "mission" }, window: { start: NOW + 5 * DAY, end: NOW + 5 * DAY + 2 * HOUR },
    invited: ["a", "b", "c", "d"], alternates: ["k", "e"], partner: false, size: { min: 3, target: 4, max: 6 }, quorum: 3,
    probeDeadline: NOW + 4 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: NOW, category: "social", ...o,
  });
  const inp = emptyInput(NOW);
  for (const id of ["a", "b", "c", "d", "e", "k", "u"]) inp.members.push(baseMember(id));
  setAge(inp, "k", 15); setAge(inp, "u", undefined);
  const canMatch = P.canMatchIn(mkWorld(inp));
  const opts: P.PlanRunOpts = { canMatch };

  test("canMatchIn: adults yes; minors, unknown ages and unknown ids no", () => {
    expect(["a", "e", "k", "u", "nobody"].map(canMatch)).toEqual([true, true, false, false, false]);
  });
  test("a minor alternate is dropped from the bench; the next adult is backfilled", () => {
    const r = P.startPlanRun(plan(), opts);
    expect(r.bench).toEqual(["e"]);
    const a = P.recordPlanAnswer(r, "b", false, NOW, undefined, opts);
    expect(a.action).toEqual({ kind: "backfill", member: "e" });
  });
  test("a member learned to be a minor after the run started is skipped at backfill time", () => {
    const r = P.startPlanRun(plan({ alternates: ["e2", "e"] }));
    expect(r.bench).toEqual(["e2", "e"]);
    // e2 is now known to be a minor: the backfill goes to e, and e2 is never probed.
    const gate: P.PlanRunOpts = { canMatch: id => id !== "e2" };
    const a = P.recordPlanAnswer(r, "b", false, NOW, undefined, gate);
    expect(a.action).toEqual({ kind: "backfill", member: "e" });
    expect(Object.keys(a.run.answers)).not.toContain("e2");
    // With only a minor left on the bench and nobody pending who could reach quorum: fallback, no probe to the minor.
    let r2 = P.startPlanRun(plan({ invited: ["a", "b", "c"], alternates: ["k"] }));
    r2 = P.recordPlanAnswer(r2, "a", true, NOW, undefined, opts).run;
    r2 = P.recordPlanAnswer(r2, "b", false, NOW, undefined, opts).run;
    const last = P.recordPlanAnswer(r2, "c", false, NOW, undefined, opts);
    expect(last.action.kind).toBe("fallback");
    expect(Object.keys(last.run.answers)).not.toContain("k");
  });
  test("a partner plan never probes a minor as the partner or the replacement partner", () => {
    const pp = plan({ invited: ["a", "k"], alternates: ["u", "e"], partner: true, quorum: 2, size: { min: 2, target: 2, max: 2 } });
    const r = P.startPlanRun(pp, opts);
    expect(r.bench).toEqual(["e"]);
    expect(P.recordPlanAnswer(r, "a", true, NOW, undefined, opts).action).toEqual({ kind: "probe_partner", member: "e" });
  });
});

describe("opportunity backfill: canMatch", () => {
  test("a minor or unknown-age alternate is never invited; an adult one is", () => {
    const clock = new SimClock();
    const o = createOpportunity({ id: "o", participants: ["a", "b", "c"], alternates: ["k", "u", "e"], quorum: 3 });
    const canMatch = (id: string) => !["k", "u"].includes(id);
    transition(o, "PROPOSED", "propose", "engine", clock, "1");
    transition(o, "IN_REVIEW", "enqueue_review", "system", clock, "2");
    transition(o, "APPROVED", "approve", "reviewer", clock, "3");
    dispatchInvites(o, clock, "d", { canMatch });
    respond(o, "c", false, clock, "c1");
    inviteAlternates(o, clock, "ia", { canMatch });
    expect(o.participants.e).toBe("invited");
    expect(o.participants.k).toBeUndefined();
    expect(o.participants.u).toBeUndefined();
    expect(o.removed).toMatchObject({ k: "underage", u: "underage" });
  });
});
