import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { composeGroup, evaluateGroup, makeCompat, type ComposeOptions } from "../src/group.ts";
import type { EngineInput } from "../src/types.ts";
import { baseMember, emptyInput, facet, mkWorld, NOW } from "./helpers.ts";

function world(n: number, f: (i: EngineInput, ids: string[]) => void = () => {}) {
  const inp = emptyInput(NOW);
  const ids = Array.from({ length: n }, (_, k) => `p${k}`);
  for (const id of ids) {
    inp.members.push(baseMember(id));
    inp.presence.push({ memberId: id, city: "sf", type: "home", areas: ["mission"] });
    inp.facets.push(facet(id, 0, "interest", "independent film and cinema", ["film"]));
  }
  f(inp, ids);
  return { w: mkWorld(inp), ids };
}
const opts = (ids: string[], over: Partial<ComposeOptions> = {}): ComposeOptions => ({
  pool: ids.map((id, k) => ({ id, affinity: 1 - k * 0.01 })), category: "social", minSize: 3, maxSize: 6,
  window: { start: NOW, end: NOW + 7 * DAY }, preferredCity: "sf", needHost: false, beamWidth: 8, minPairwise: 0.05, alternates: 3, ...over,
});

describe("group composer (beam search, Section 33.7)", () => {
  test("produces a 3-6 primary plus ranked alternates", () => {
    const { w, ids } = world(10);
    const g = composeGroup(w, opts(ids))!;
    expect(g.primary.length).toBeGreaterThanOrEqual(3);
    expect(g.primary.length).toBeLessThanOrEqual(6);
    expect(g.alternates.length).toBe(3);
    for (const a of g.alternates) expect(g.primary).not.toContain(a);
  });

  test("respects maxSize and minSize", () => {
    const { w, ids } = world(10);
    expect(composeGroup(w, opts(ids, { maxSize: 4 }))!.primary.length).toBeLessThanOrEqual(4);
    const small = world(2);
    expect(composeGroup(small.w, opts(small.ids))).toBeNull();
  });

  test("never puts a blocked pair together, and blocked members are not alternates for each other", () => {
    const { w, ids } = world(6, (i) => { i.edges.push({ from: "p0", to: "p1", type: "blocked", strength: 1, explicit: true, createdAt: NOW }); });
    const g = composeGroup(w, opts(ids))!;
    expect(g.primary.includes("p0") && g.primary.includes("p1")).toBe(false);
    if (g.primary.includes("p0")) expect(g.alternates).not.toContain("p1");
    if (g.primary.includes("p1")) expect(g.alternates).not.toContain("p0");
  });

  test("minimum pairwise floor: someone incompatible with everyone is left out", () => {
    const { w, ids } = world(6, (i) => {
      i.facets = i.facets.filter(f => f.memberId !== "p0");
      i.facets.push(facet("p0", 0, "skill", "tax accounting spreadsheets", ["finance"]));
    });
    const g = composeGroup(w, opts(ids, { minPairwise: 0.2 }))!;
    expect(g.primary).not.toContain("p0");
    expect(g.stats.minBest).toBeGreaterThanOrEqual(0.2);
  });

  test("role coverage: needHost picks a group with a host", () => {
    const { w, ids } = world(8, (i) => { i.facets.push(facet("p7", 1, "offer", "hosts small film screenings", ["film", "host"])); });
    const g = composeGroup(w, opts(ids, { needHost: true }))!;
    expect(g.primary).toContain("p7");
    expect(g.roles.p7).toBe("host");
  });

  test("prefers 1-2 warm ties over a closed clique or a cold group", () => {
    const { w } = world(6, (i) => {
      // p0..p3 is a clique of mutual friends; p4, p5 are strangers.
      for (const [a, b] of [["p0", "p1"], ["p0", "p2"], ["p0", "p3"], ["p1", "p2"], ["p1", "p3"], ["p2", "p3"]] as const)
        i.edges.push({ from: a, to: b, type: "knows", strength: 0.8, explicit: true, createdAt: NOW - DAY });
    });
    const o = opts(["p0", "p1", "p2", "p3", "p4", "p5"]);
    const compat = makeCompat(w, "social");
    const aff = new Map(o.pool.map(p => [p.id, 0.5]));
    const clique = evaluateGroup(w, ["p0", "p1", "p2", "p3"], o, compat, aff)!;
    const mixed = evaluateGroup(w, ["p0", "p1", "p4", "p5"], o, compat, aff)!;
    const cold = evaluateGroup(w, ["p4", "p5", "p2"], o, compat, aff)!;
    expect(clique.stats.warmTies).toBe(6);
    expect(mixed.stats.warmTies).toBe(1);
    expect(mixed.score).toBeGreaterThan(clique.score);
    expect(cold.stats.warmTies).toBe(0);
  });

  test("cluster diversity is measured and rewarded", () => {
    const { w } = world(4, (i) => {
      i.facets.push(facet("p3", 2, "desire", "rock climbing", ["climbing"]), facet("p3", 3, "desire", "bouldering", ["climbing"]));
    });
    const o = opts(["p0", "p1", "p2", "p3"]);
    const compat = makeCompat(w, "social");
    const aff = new Map(o.pool.map(p => [p.id, 0.5]));
    expect(evaluateGroup(w, ["p0", "p1", "p3"], o, compat, aff)!.stats.clusterDiversity).toBeGreaterThan(evaluateGroup(w, ["p0", "p1", "p2"], o, compat, aff)!.stats.clusterDiversity);
  });

  test("availability intersection: a member away all window cannot join", () => {
    const { w, ids } = world(5, (i) => { i.presence.push({ memberId: "p0", city: "nyc", type: "temporary", areas: [], from: NOW - DAY, to: NOW + 8 * DAY }); });
    const g = composeGroup(w, opts(ids))!;
    expect(g.primary).not.toContain("p0");
    expect(g.alternates).not.toContain("p0");
    expect(g.stats.overlapHours).toBeGreaterThan(24);
  });

  test("forced members are always included (newcomer seed)", () => {
    const { w, ids } = world(6);
    const g = composeGroup(w, opts(ids.slice(1), { forced: ["p0"], forcedRole: "newcomer", maxSize: 4 }))!;
    expect(g.primary[0]).toBe("p0");
    expect(g.roles.p0).toBe("newcomer");
  });

  test("deterministic", () => {
    const { w, ids } = world(12);
    expect(composeGroup(w, opts(ids))).toEqual(composeGroup(w, opts(ids)));
  });
});
