import { describe, expect, test } from "bun:test";
import { evaluateMissions, POINTS, scoreboard, scoreOpportunity } from "../src/scoring.ts";
import type { ObsOpportunity } from "../src/types.ts";

const opp = (o: Partial<ObsOpportunity>): ObsOpportunity => ({
  id: "o", kind: "intro", source: "player", generator: "player", city: "sf", objective: "x", score: 0, explanations: {}, exploration: false,
  participants: ["a", "b"], alternates: [], state: "PROPOSED", status: { a: "pending", b: "pending" }, enjoyment: {}, createdAt: 0, updatedAt: 0, ...o,
});

describe("scoring", () => {
  test("a good meeting", () => {
    const s = scoreOpportunity(opp({ state: "COMPLETED", status: { a: "attended", b: "attended" }, enjoyment: { a: 0.8, b: 0.6 } }));
    expect(s.points).toBe(2 * POINTS.accept + 70);
  });
  test("decline, no-show and unsafe", () => {
    expect(scoreOpportunity(opp({ state: "DECLINED", status: { a: "accepted", b: "declined" } })).points).toBe(POINTS.accept + POINTS.decline);
    expect(scoreOpportunity(opp({ state: "ABANDONED", status: { a: "attended", b: "no_show" } })).points).toBe(2 * POINTS.accept + POINTS.noShow);
    const unsafe = opp({ state: "SKIPPED", oracle: { compatible: false, unsafe: true, quality: 0, minEnjoyment: 0, flags: ["minor_included"], participants: {} } });
    expect(scoreOpportunity(unsafe).points).toBe(POINTS.unsafe);
  });
  test("scoreboard: same rules per source, player first, peeks via extra points", () => {
    const rows = scoreboard([
      opp({ id: "1", source: "engine", state: "COMPLETED", status: { a: "attended", b: "attended" }, enjoyment: { a: 1, b: 1 }, oracle: { compatible: true, unsafe: false, quality: 1, minEnjoyment: 1, flags: [], participants: {} } }),
      opp({ id: "2", source: "engine", state: "DECLINED", status: { a: "declined", b: "pending" } }),
      opp({ id: "3", source: "shadow" }),
    ], { player: POINTS.peek });
    expect(rows.map(r => r.source)).toEqual(["player", "engine"]);
    const eng = rows[1]!;
    expect(eng.points).toBe(2 * POINTS.accept + 100 + POINTS.decline);
    expect(eng.proposals).toBe(2);
    expect(eng.meetings).toBe(1);
    expect(eng.showRate).toBe(1);
    expect(eng.precision).toBe(1);
    expect(rows[0]!.points).toBe(POINTS.peek);
  });
  test("missions complete and stay complete", () => {
    const ctx = { now: 8 * 86_400_000, start: 0, community: (id: string) => (id === "a" ? "sf:arts" : "sf:tech"), newcomer: (id: string) => id === "b", scores: [] };
    const m1 = evaluateMissions([opp({ state: "COMPLETED", status: { a: "attended", b: "attended" }, enjoyment: { a: 0.8, b: 0.75 } })], ctx);
    const done = Object.fromEntries(m1.map(m => [m.id, m.done]));
    expect(done).toMatchObject({ first_spark: true, good_chemistry: true, bridge_builder: true, welcome_wagon: true, dinner_party: false, do_no_harm: false });
    const m2 = evaluateMissions([], ctx, m1);
    expect(m2.find(m => m.id === "good_chemistry")!.done).toBe(true);
  });
});
