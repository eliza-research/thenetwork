import { expect, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import { BASELINES } from "../src/apps/slop/baselines.ts";
import { slopEngineMatcher } from "../src/apps/slop/enginePack.ts";
import { slopMetrics } from "../src/apps/slop/metrics.ts";
import { isSafe, SlopOracle } from "../src/apps/slop/oracle.ts";
import { extraOf, worldOptions, type Extra } from "../src/apps/slop/packEval.ts";
import { generateSlopPersonas, groupOf } from "../src/apps/slop/persona.ts";
import { runSlopWorld, runSlopWorldAsync } from "../src/apps/slop/world.ts";

test("Slop's initial feasible cohort stays fixed when real widening answers change profiles", async () => {
  const rows = [];
  for (const seed of [1, 2, 9]) {
    const settings = { seed, perCity: 70, weeks: 4 };
    const initial = generateSlopPersonas(settings), real = initial.filter(isSafe);
    const oracle = new SlopOracle(initial, seed);
    // Establish membership before any engine or persona action.
    const eligible = real.filter(p => real.some(q => oracle.statedMutual(p, q, 0)));
    for (const arm of ["widen", "no-widen", "random"] as const) {
      const opts = { ...settings, personas: structuredClone(initial) };
      const r = arm === "random"
        ? runSlopWorld({ ...opts, matcher: BASELINES.random })
        : await runSlopWorldAsync({ ...opts, matcher: slopEngineMatcher({ seed }), ...worldOptions({ widen: arm === "widen" }) });
      const expected: Extra["feasibleGroups"] = {};
      for (const p of eligible) {
        const g = expected[groupOf(p)] ??= { dates: 0, memberMonths: 0 };
        g.memberMonths += settings.weeks / 4.345;
        g.dates += r.flows.filter(f => f.stage === "date" && (f.first === p.id || f.partner === p.id)).length;
      }
      const actual = extraOf(r, slopMetrics(r)).feasibleGroups;
      rows.push({ seed, arm, widened: r.asks?.widened ?? 0, initialMembers: eligible.length,
        reportedMembers: Math.round(Object.values(actual).reduce((n, g) => n + g.memberMonths, 0) / (settings.weeks / 4.345)),
        initialDates: Object.values(expected).reduce((n, g) => n + g.dates, 0),
        reportedDates: Object.values(actual).reduce((n, g) => n + g.dates, 0),
        groupsMatch: isDeepStrictEqual(actual, expected) });
    }
  }
  // Run all nine worlds before asserting; widening and both controls are observed on the base.
  console.table(rows);
  for (const row of rows) {
    expect(row.initialMembers).toBeGreaterThan(0);
    if (row.arm === "widen") expect(row.widened).toBeGreaterThan(0);
    else expect(row.widened).toBe(0);
  }
  expect(rows.map(({ seed, arm, groupsMatch }) => ({ seed, arm, groupsMatch })))
    .toEqual([1, 2, 9].flatMap(seed => (["widen", "no-widen", "random"] as const).map(arm => ({ seed, arm, groupsMatch: true }))));
}, 120_000);
