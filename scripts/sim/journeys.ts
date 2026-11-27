// Unified journeys block for `pnpm run sim --only journeys`.
// Runs both:
//   1. Pass 3 stratified 28-persona all-walks-of-life simulation across all 5 real production channels
//      (imessage_direct, mcp_personal_agent, social_dm, dating_matchmaker, external_event).
//   2. Pass 4 broad-spectrum 14-channel / 14-style / 6-age-bracket / 6-bad-actor / league-gap journey suite
//      (with optional `--llm` live gpt-6-luna friction rubric; tracked only, skips cleanly without API key).
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
import { runJourneySim } from "../../packages/sim/src/journeys/runner.ts";
import type { JourneySimSummary } from "../../packages/sim/src/journeys/report.ts";
import { Block, digest, expect } from "./gate.ts";

export interface JourneysBlockOpts {
  quick?: boolean;
  llm?: boolean;
  transcripts?: boolean;
  maxCostUsd?: number;
  maxRequests?: number;
}

function outcomePassed(runs: readonly JourneySimSummary[], id: string): boolean {
  return runs.every(r => r.outcomes.some(o => o.id === id && o.pass));
}

export async function journeysBlock(
  b: Block,
  opts: JourneysBlockOpts = {},
): Promise<void> {
  // ---- Part 1: Pass 3 stratified 28-persona 5-channel simulation ----
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

  // ---- Part 2: Pass 4 broad-spectrum 14-channel / 14-style / quality & league suite ----
  const seeds = opts.quick ? [42] : [42, 43];
  const runs: JourneySimSummary[] = [];
  for (const s of seeds) {
    runs.push(await runJourneySim({ seed: s }));
  }
  const replay = await runJourneySim({ seed: seeds[0]! });

  const totalLeaks = runs.reduce((s, r) => s + r.totalLeaks, 0);
  const totalRankingLeaks = runs.reduce((s, r) => s + r.totalRankingLeaks, 0);
  const maxWallMs = Math.max(...runs.map(r => r.elapsedMs), replay.elapsedMs);
  const sumWallMs = runs.reduce((s, r) => s + r.elapsedMs, 0);
  const first = runs[0]!;

  b.gate(
    "all 14 speaking styles + multi-city timezone & natural reschedule pass",
    outcomePassed(runs, "J-STYLES-14") && first.stylesCovered === 14,
    `styles=${first.stylesCovered}, seeds=${seeds.join(",")}`,
  );
  b.gate(
    "all 6 age brackets (<13 decline, 13-17 teen isolation, adults 18-75+) pass",
    outcomePassed(runs, "J-AGE-TIERS") && first.ageBracketsCovered === 6,
    `ageBrackets=${first.ageBracketsCovered}, seeds=${seeds.join(",")}`,
  );
  b.gate(
    "all 4 communication clarity & verbosity bands pass",
    outcomePassed(runs, "J-CLARITY-4") && first.clarityBandsCovered === 4,
    `clarityBands=${first.clarityBandsCovered}`,
  );
  b.gate(
    "own-agent MCP (/mcp + /mcp/openai) & warm_email channels pass",
    outcomePassed(runs, "J-CHAN-MCP") && outcomePassed(runs, "J-CHAN-WORK-EMAIL"),
    `mcp+warm_email ok across seeds ${seeds.join(",")}`,
  );
  b.gate(
    "all 10 canonical out-of-network platforms pass (14 total channels)",
    outcomePassed(runs, "J-CHAN-EXT-10") && first.channelsCovered === 14,
    `channels=${first.channelsCovered} (4 in-network + 10 out-of-network)`,
  );
  b.gate(
    "0 privacy/canary leaks & 0 internal ranking leaks across all journeys",
    totalLeaks === 0 && totalRankingLeaks === 0,
    `leaks=${totalLeaks}, rankingLeaks=${totalRankingLeaks}`,
  );
  b.gate(
    "all 6 bad-actor defenses (flakes, creeps/SD-072, vampires, slop, injectors, ranking guard) hold",
    outcomePassed(runs, "J-BAD-ACTORS"),
    `bad_actor containment ok across seeds ${seeds.join(",")}`,
  );
  b.gate(
    "league-gap bilateral value, peon firewall & aesthetic wall hold",
    outcomePassed(runs, "J-LEAGUE-BILATERAL"),
    `strata=${first.strataCovered}, bilateral+firewalls ok`,
  );
  await b.run("deterministic replay digest & all journeys pass (<2s warm)", () => {
    expect(replay.digest).toBe(first.digest);
    expect(runs.every(r => r.passedJourneys === r.totalJourneys)).toBe(true);
    expect(replay.elapsedMs).toBeLessThan(5_000);
  });

  b.track(
    "offline journey wall time (<2000ms per seed)",
    maxWallMs < 2_000,
    `max=${maxWallMs}ms, sum=${sumWallMs}ms across ${runs.length} seed(s)`,
  );
  b.track(
    "journey cohort & replay digest",
    replay.digest === first.digest,
    `seed${first.seed}=${first.digest}, cohort=${first.cohortCount}, journeys=${first.passedJourneys}/${first.totalJourneys}`,
  );

  if (opts.llm) {
    const maxCostUsd = opts.maxCostUsd ?? 0.25;
    const maxRequests = opts.maxRequests ?? 80;
    const live = await runJourneySim({
      seed: seeds[0]!,
      llm: true,
      maxCostUsd,
      maxRequests,
    });
    if (live.llmSkippedReason) {
      b.track("live-LLM journey friction rubric", true, `skipped (${live.llmSkippedReason})`);
    } else {
      const t = live.telemetry;
      const cachePct = t.promptTokens > 0 ? Math.round((t.cachedTokens / t.promptTokens) * 100) : 0;
      const costUsd = (t.costMicro / 1_000_000).toFixed(4);
      b.track(
        "live-LLM journey friction rubric pass rate",
        live.llmGradedCount > 0 && live.llmRubricPassCount === live.llmGradedCount,
        `${live.llmRubricPassCount}/${live.llmGradedCount} graded pass, cost=$${costUsd}/${maxCostUsd.toFixed(2)}, calls=${t.llmCalls}/${maxRequests}`,
      );
      b.track(
        "live-LLM prompt & local cache telemetry",
        t.llmCacheHits >= 1,
        `localCacheHits=${t.llmCacheHits}/${t.llmCacheHits + t.llmCacheMisses}, providerCachedTokens=${t.cachedTokens}/${t.promptTokens} (${cachePct}%), fallbacks=${t.fallbackCount}`,
      );
    }
  }
}
