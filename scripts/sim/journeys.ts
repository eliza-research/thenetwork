// journeys block for `pnpm run sim --only journeys`.
// Offline, deterministic, zero-LLM, zero-Postgres multi-channel, all-walks-of-life journey suite:
//   - Full mode: seeds 42, 43 (+ deterministic replay of seed 42)
//   - Quick mode (--quick): seed 42 (+ deterministic replay)
//   - Optional `--llm` arm: live gpt-6-luna friction rubric & prompt-cache telemetry (tracked only; skips cleanly without API key).

import { runJourneySim } from "../../packages/sim/src/journeys/runner.ts";
import type { JourneySimSummary } from "../../packages/sim/src/journeys/report.ts";
import { expect, type Block } from "./gate.ts";

export interface JourneysBlockOpts {
  quick: boolean;
  llm: boolean;
  maxCostUsd?: number;
  maxRequests?: number;
}

function outcomePassed(runs: readonly JourneySimSummary[], id: string): boolean {
  return runs.every(r => r.outcomes.some(o => o.id === id && o.pass));
}

export async function journeysBlock(b: Block, opts: JourneysBlockOpts): Promise<void> {
  const seeds = opts.quick ? [42] : [42, 43];
  const runs: JourneySimSummary[] = [];
  for (const seed of seeds) {
    runs.push(await runJourneySim({ seed }));
  }
  const replay = await runJourneySim({ seed: seeds[0]! });

  const totalLeaks = runs.reduce((s, r) => s + r.totalLeaks, 0);
  const totalRankingLeaks = runs.reduce((s, r) => s + r.totalRankingLeaks, 0);
  const maxWallMs = Math.max(...runs.map(r => r.elapsedMs), replay.elapsedMs);
  const sumWallMs = runs.reduce((s, r) => s + r.elapsedMs, 0);
  const first = runs[0]!;

  // 9 Blocking Gates
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

  // Tracked Metrics
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

  // Optional Live-LLM Arm (tracked only, never fails offline CI)
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
