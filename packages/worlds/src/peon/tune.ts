// Tuning sweeps on the TUNING seeds (1-4 by default). Overrides are JSON for the pack's knobs:
//   bun run packages/worlds/src/peon/tune.ts --seeds 1-4 '{"congestion":{"slateBase":3},"match":{"claimDiscount":0.6},"retrieval":{"jobsPerCandidate":10},"cfg":{...}}' [...more configs]
import { MATCH_TUNING } from "@thenetwork/engine/src/packs/peon/match.ts";
import { RETRIEVAL } from "@thenetwork/engine/src/packs/peon/generators.ts";
import { CONGESTION } from "@thenetwork/engine/src/packs/peon/selection.ts";
import { packMatcher } from "./baselines.ts";
import { peonMetrics, poolImpact, type PeonMetrics } from "./metrics.ts";
import { runPeonWorld } from "./world.ts";

const i = process.argv.indexOf("--seeds");
const [s0, s1] = (i >= 0 ? process.argv[i + 1]! : "1-4").split("-").map(Number);
const seeds = Array.from({ length: (s1 ?? s0!) - s0! + 1 }, (_, k) => s0! + k);
const configs = process.argv.slice(2).filter((a, k, xs) => a.startsWith("{") && xs[k - 1] !== "--seeds");
const base = { c: { ...CONGESTION }, m: { ...MATCH_TUNING }, r: { ...RETRIEVAL } };
for (const raw of configs.length ? configs : ["{}"]) {
  const o = JSON.parse(raw);
  Object.assign(CONGESTION, base.c, o.congestion ?? {}); Object.assign(MATCH_TUNING, base.m, o.match ?? {}); Object.assign(RETRIEVAL, base.r, o.retrieval ?? {});
  const ms: PeonMetrics[] = [];
  for (const seed of seeds) ms.push(peonMetrics(await runPeonWorld({ seed, matcher: packMatcher({ cfg: o.cfg, audit: o.audit ?? "flag" }) })));
  const mean = (f: (m: PeonMetrics) => number) => ms.reduce((s, m) => s + f(m), 0) / ms.length;
  console.log(`${raw}: hires ${mean(m => m.hires).toFixed(1)} ivph ${mean(m => m.interviewsPerHire).toFixed(2)} ret ${(mean(m => m.retention90) * 100).toFixed(1)} ua ${mean(m => m.underApplied.hires).toFixed(1)} intros ${mean(m => m.probesDelivered).toFixed(0)} zero ${(mean(m => m.congestion.zeroIntroCandidateShare) * 100).toFixed(1)}% exp ${mean(m => m.congestion.expiredApplications).toFixed(0)} imp ${poolImpact(ms.map(m => m.impact)).minAutomated.toFixed(2)} qoh ${mean(m => m.qualityOfHire).toFixed(3)}`);
}
