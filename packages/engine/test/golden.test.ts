// Golden replay: networkPack must reproduce the pre-refactor outputs byte for byte
// (docs/research/2026-10-08-engine-generalization.md 3.2, 5.2). The fast tier runs on every
// `bun test`; the full tier only with GOLDEN_FULL=1 (nightly). A mismatch names the first
// differing JSON path. Re-capture only on a deliberate re-baseline:
//   bun packages/engine/test/goldens/capture.ts [--full]
import { describe, expect, test } from "bun:test";
import { computeTier, FAST, FULL, firstDiff, type Artifact } from "./goldens/compute.ts";

async function check(file: string, tier: Record<string, () => Promise<Artifact>>) {
  const golden = (await Bun.file(`${import.meta.dir}/goldens/${file}`).json()) as Record<string, Artifact>;
  const now = await computeTier(tier);
  expect(Object.keys(now)).toEqual(Object.keys(golden));
  for (const k of Object.keys(golden)) {
    const d = firstDiff(JSON.parse(JSON.stringify(now[k])), golden[k], k);
    expect(d).toBeNull();
  }
}

describe("goldens (networkPack is byte-identical to the baseline)", () => {
  test("fast tier: runEngine (synthetic + sim + judged), attention v1.2, plans v1.1, capital, sim CLI", () => check("fast.json", FAST), 180_000);
  test.skipIf(!process.env.GOLDEN_FULL)("full tier (GOLDEN_FULL=1)", () => check("full.json", FULL), 3_600_000);
});
