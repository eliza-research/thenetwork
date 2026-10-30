// Expansion (engine section 33.4). A desire stored first, with no provider above minSim, must not
// hide a later desire that does have a provider. The engine runs with its default config. No model.
import { expect, test } from "bun:test";
import { runEngine } from "@thenetwork/engine";
import { expansionDesireInput, expansionFor } from "../../../scripts/sim/engine-expansion-desire.ts";

test("a later desire is proposed when the first stored desire is below minSim", async () => {
  const out = expansionFor(expansionDesireInput("later"));
  expect(out.map(c => c.participants)).toEqual([["ada", "bo"]]);
  expect(out[0]!.evidence.ada).toEqual(["ada-sail"]);
  expect(out[0]!.evidence.bo).toEqual(["bo-sail"]);
  const { runLog } = await runEngine(expansionDesireInput("later"), { seed: 1, cities: ["nyc"] });
  expect(runLog.funnel.byGenerator.expansion).toBe(1);
  const row = runLog.scored.filter(s => s.generator === "expansion");
  expect(row.map(s => s.participants)).toEqual([["ada", "bo"]]);
  expect(row[0]!.eligible).toBe(true);
});

test("the stronger desire wins when it is stored first", () => {
  const out = expansionFor(expansionDesireInput("best"));
  expect(out.map(c => c.participants)).toEqual([["ada", "cy"]]);
  expect(out[0]!.evidence.ada).toEqual(["ada-physics"]);
});

test("no outside desire below minSim is proposed", () => {
  expect(expansionFor(expansionDesireInput("none"))).toEqual([]);
});
