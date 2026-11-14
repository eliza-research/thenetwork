import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { slopEngineMatcher } from "../src/apps/slop/enginePack.ts";
import { slopMetrics } from "../src/apps/slop/metrics.ts";
import { worldOptions } from "../src/apps/slop/packEval.ts";
import { generateSlopPersonas } from "../src/apps/slop/persona.ts";
import { runSlopWorldAsync, type SlopRunResult } from "../src/apps/slop/world.ts";

const trace = (r: SlopRunResult) => createHash("sha256").update(JSON.stringify({
  flows: r.flows, asks: r.asks, metrics: slopMetrics(r), personas: r.world.personas,
  state: { ...r.world.state, paused: [...r.world.state.paused],
    learned: [...(r.world.state.learned ?? [])].map(([id, fields]) => [id, [...fields]]) },
})).digest("hex");

test("Slop widening stays within its world and a supplied population replays unchanged", async () => {
  const rows = [];
  for (const seed of [1, 2, 9]) {
    const settings = { seed, perCity: 70, weeks: 4 };
    const personas = generateSlopPersonas(settings), initial = structuredClone(personas);
    const run = (population: typeof personas) => runSlopWorldAsync({
      ...settings, personas: population, matcher: slopEngineMatcher({ seed }),
      ...worldOptions({ widen: true }),
    });
    // The real pack asks to widen; generated personas decide whether to answer and agree.
    const first = await run(personas), firstTrace = trace(first);
    const changedInWorld = first.world.personas.filter((p, i) => JSON.stringify(p) !== JSON.stringify(initial[i])).length;
    const inputChanged = personas.filter((p, i) => JSON.stringify(p) !== JSON.stringify(initial[i])).length;
    const replay = await run(personas), fresh = await run(structuredClone(initial));
    rows.push({ seed, widened: first.asks?.widened ?? 0, changedInWorld, inputChanged,
      replayEqual: trace(replay) === firstTrace, freshEqual: trace(fresh) === firstTrace,
      firstWorldUnchanged: trace(first) === firstTrace });
  }
  // Complete every real workflow before asserting, so the base failure covers all seeds.
  console.table(rows);
  for (const row of rows) {
    expect(row.widened).toBeGreaterThan(0);
    expect(row.changedInWorld).toBe(row.widened);
    expect(row.freshEqual).toBe(true);
  }
  expect(rows.map(({ seed, inputChanged, replayEqual, firstWorldUnchanged }) => ({ seed, inputChanged, replayEqual, firstWorldUnchanged })))
    .toEqual([1, 2, 9].map(seed => ({ seed, inputChanged: 0, replayEqual: true, firstWorldUnchanged: true })));
}, 120_000);
