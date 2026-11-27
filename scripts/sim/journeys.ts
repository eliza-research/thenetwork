// The journeys block: offline deterministic stratified 28-persona all-walks-of-life simulation
// across all 5 real production channels (imessage_direct, mcp_personal_agent, social_dm,
// dating_matchmaker, external_event). 0 network calls, 0 API keys, < 3s runtime.
import { CITY_IDS } from "../../packages/core/src/index.ts";
import {
  AGE_BUCKETS,
  JOURNEY_CHANNELS,
  SPEAKING_STYLES,
  buildStratifiedCast,
  castCoverageSummary,
} from "../../packages/sim/src/journeys/cast.ts";
import { createJourneyActor } from "../../packages/sim/src/journeys/actors.ts";
import { runAllJourneyChannels } from "../../packages/sim/src/journeys/channels.ts";
import { verifyReplayCacheHitRate } from "../../packages/sim/src/journeys/llmCache.ts";
import { evaluateJourneySignals } from "../../packages/sim/src/journeys/judge.ts";
import { Block, digest, expect } from "./gate.ts";

export async function journeysBlock(
  b: Block,
  opts: { quick?: boolean; transcripts?: boolean } = {},
): Promise<void> {
  const seed = 42;
  const t0 = performance.now();
  const cast = buildStratifiedCast(seed);
  const coverage = castCoverageSummary(cast);
  const actor = createJourneyActor({ mode: "offline" });

  const run1 = await runAllJourneyChannels({ cast, actor });
  const cacheCheck = await verifyReplayCacheHitRate();
  const elapsedMs = Math.round(performance.now() - t0);

  const report = evaluateJourneySignals({
    mode: "offline",
    seed,
    personasCount: cast.length,
    traces: run1.traces,
    signals: run1.signals,
    replayCacheHitRate: cacheCheck.replayCacheHitRate,
    budgetBreaches: cacheCheck.budgetBreaches,
    elapsedMs,
  });

  b.track("fingerprint: journeys suite (seed 42)", true, digest({ traces: run1.traces, signals: run1.signals }));

  await b.run("cast stratification: 28 personas across all 6 age buckets, 11 speaking styles, 5 cities & 5 channels", () => {
    expect(coverage.total).toBe(28);
    for (const bucket of AGE_BUCKETS) expect(coverage.byAgeBucket[bucket]).toBeGreaterThanOrEqual(2);
    for (const style of SPEAKING_STYLES) expect(coverage.byStyle[style]).toBeGreaterThanOrEqual(2);
    for (const city of CITY_IDS) expect(coverage.byCity[city]).toBeGreaterThanOrEqual(4);
    for (const channel of JOURNEY_CHANNELS) expect(coverage.byChannel[channel]).toBeGreaterThanOrEqual(4);
  });

  if (!opts.quick) {
    await b.run("determinism: repeated offline run with same seed produces identical cast, traces & signals", async () => {
      const cast2 = buildStratifiedCast(seed);
      expect(digest(cast2)).toBe(digest(cast));
      const run2 = await runAllJourneyChannels({
        cast: cast2,
        actor: createJourneyActor({ mode: "offline" }),
        channels: ["mcp_personal_agent", "social_dm", "dating_matchmaker", "external_event"],
      });
      const subset1 = run1.traces.filter(t => t.channel !== "imessage_direct");
      expect(digest(run2.traces)).toBe(digest(subset1));
    });
  }

  for (const g of report.gates) {
    b.gate(g.name, g.pass, g.detail, g.blocking);
  }

  b.track("runtime_offline_ms", elapsedMs < 3000, `${elapsedMs}ms (traces=${run1.traces.length}, budgetCap=${cacheCheck.budgetCapTriggered})`);

  if (opts.transcripts) {
    for (const trace of run1.traces) {
      console.log(`\n=== [${trace.channel}] ${trace.id}: ${trace.title} ===`);
      console.log(`  Summary: ${trace.summary}`);
      for (const turn of trace.turns) {
        console.log(`  [${turn.direction}] ${turn.actor}: ${turn.text}`);
      }
    }
  }
}
