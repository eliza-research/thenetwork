// slopPack goldens (fast tier, every `bun test`): runEngine with slopPack on slop worlds, and a short
// run of the slop harness with the engine-backed matcher. A mismatch prints the first differing path.
// The networkPack goldens (golden.test.ts, goldens/fast.json) are separate and stay byte-identical.
// Re-capture only on a deliberate change to slopPack: SLOP_GOLDEN_CAPTURE=1 bun test ./packages/engine/test/slop-golden.test.ts
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { configHash, resolveConfig } from "../src/config.ts";
import { runEngine } from "../src/engine.ts";
import { SLOP_ENGINE_CONFIG, SLOP_PACK_VERSION, slopPack } from "../src/packs/slop/index.ts";
import { slopEngineMatcher } from "../../worlds/src/slop/enginePack.ts";
import { slopMetrics } from "../../worlds/src/slop/metrics.ts";
import { runSlopWorldAsync } from "../../worlds/src/slop/world.ts";
import { firstDiff } from "./goldens/compute.ts";
import { slopWorld } from "./slopkit.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const canonical = (v: unknown) => JSON.stringify(v, (k, x) => (k === "timingsMs" ? undefined : x === Infinity ? "Infinity" : x));
const FILE = `${import.meta.dir}/goldens/slop.json`;

async function compute(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { packVersion: SLOP_PACK_VERSION };
  for (const seed of [1, 2]) {
    const cfg = { ...SLOP_ENGINE_CONFIG, seed };
    const r = await runEngine(slopWorld(seed, { perCity: 60 }), cfg, { pack: slopPack });
    const f = r.runLog.funnel;
    out[`engine.seed${seed}`] = {
      configHash: configHash(resolveConfig(cfg)), runId: r.runLog.runId, proposals: r.proposals.length, asks: r.asks.length,
      funnel: { generated: f.generated, byGenerator: f.byGenerator, rejectedBy: f.rejectedBy, memberExclusions: f.memberExclusions, eligible: f.eligible, selected: f.selected },
      proposalIds: r.proposals.map(p => p.id),
      sha: { proposals: sha(canonical(r.proposals)), asks: sha(canonical(r.asks)), runLog: sha(canonical(r.runLog)) },
    };
  }
  const res = await runSlopWorldAsync({ seed: 1, perCity: 60, weeks: 2, matcher: slopEngineMatcher({ seed: 1 }) });
  const m = slopMetrics(res);
  out["harness.seed1"] = {
    proposals: m.proposals, dates: m.dates, mutualYesRate: m.mutualYesRate, secondDateRate: m.secondDateRate, minorContacts: m.safety.minorContacts,
    asks: res.asks ?? null, sha: { flows: sha(canonical(res.flows)), metrics: sha(canonical(m)) },
  };
  return out;
}

describe("goldens: slopPack", () => {
  test("runEngine with slopPack (2 seeds) and a 2-week slop harness run reproduce the captured bytes", async () => {
    const now = JSON.parse(canonical(await compute()));
    if (process.env.SLOP_GOLDEN_CAPTURE) { await Bun.write(FILE, JSON.stringify(now, null, 1) + "\n"); return; }
    const golden = await Bun.file(FILE).json();
    expect(firstDiff(now, golden)).toBeNull();
  }, 120_000);
});
