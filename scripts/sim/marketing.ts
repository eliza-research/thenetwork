// marketing block for `pnpm run sim --only marketing`.
// Offline, deterministic, zero-LLM, zero-Postgres multi-city marketing growth simulation:
//   - Full mode: seeds 1-4, 30 simulated days across NYC + SF
//   - Quick mode (--quick): seeds 1-2, 14 simulated days across NYC + SF
//   - 12 blocking safety/invariant/determinism gates + 3 tracked performance metrics.

import { runMarketingSim, type MarketingSimSummary } from "../../apps/marketing/src/sim.ts";
import { expect, type Block } from "./gate.ts";

export async function marketingBlock(b: Block, opts: { quick: boolean }): Promise<void> {
  const seeds = opts.quick ? [1, 2] : [1, 2, 3, 4];
  const days = opts.quick ? 14 : 30;

  const runs: MarketingSimSummary[] = [];
  for (const seed of seeds) {
    runs.push(
      await runMarketingSim({
        seed,
        days,
        cities: ["nyc", "sf"],
        quick: opts.quick,
      }),
    );
  }

  const replaySeed1 = await runMarketingSim({
    seed: seeds[0]!,
    days,
    cities: ["nyc", "sf"],
    quick: opts.quick,
  });

  const sumAdv = (
    pick: (r: MarketingSimSummary) => number,
  ): number => runs.reduce((acc, r) => acc + pick(r), 0);

  const minorTotal = sumAdv((r) => r.adversarial.minorViolations);
  const leakTotal = sumAdv((r) => r.adversarial.leakEscapes);
  const budgetTotal = sumAdv((r) => r.adversarial.budgetOverruns);
  const fraudTotal = sumAdv((r) => r.adversarial.antifraudViolations);
  const deviceTotal = sumAdv((r) => r.adversarial.unsafeDeviceDispatches);
  const slopCashTotal = sumAdv((r) => r.adversarial.slopCashUnauthorizedSettles);
  const stopCooldownTotal = sumAdv((r) => r.adversarial.stopOrCooldownViolations);
  const llmBreachTotal = sumAdv((r) => r.adversarial.llmBudgetBreaches);
  const llmBlocksTotal = sumAdv((r) => r.adversarial.llmBudgetBlocksTriggered);
  const bpIgnoredTotal = sumAdv((r) => r.adversarial.backpressureIgnoredSends);
  const allHysteresisHeld = runs.every((r) => r.adversarial.backpressureHysteresisHeld);
  const allStopLocked = runs.every((r) => r.adversarial.stopSpikeAutoLockdownTriggered);
  const allLiquidityReached = runs.every(
    (r) => r.metrics.citiesReadyCount === r.cities.length,
  );

  const avgBanditLift = Number(
    (
      runs.reduce((acc, r) => acc + r.metrics.banditCpaImprovementPct, 0) / runs.length
    ).toFixed(2),
  );
  const avgBlendedCpa = Math.round(
    runs.reduce((acc, r) => acc + r.metrics.blendedCpaCents, 0) / runs.length,
  );
  const avgUniformCpa = Math.round(
    runs.reduce((acc, r) => acc + r.metrics.uniformBlendedCpaCents, 0) / runs.length,
  );
  const avgTokenSavings = Number(
    (
      runs.reduce((acc, r) => acc + r.metrics.llmTokenSavingsPct, 0) / runs.length
    ).toFixed(2),
  );
  const totalSignups = runs.reduce((acc, r) => acc + r.metrics.totalVerifiedSignups, 0);

  // 12 Blocking Safety, Policy, Quality & Determinism Gates
  b.gate(
    "0 minor (<18) payouts or contacts",
    minorTotal === 0,
    `${minorTotal} across seeds ${seeds.join(",")}`,
  );
  b.gate(
    "0 LeakGuard escapes on prompt-injection storm",
    leakTotal === 0,
    `${leakTotal} across seeds ${seeds.join(",")}`,
  );
  b.gate(
    "0 budget, daily-cap, reserve, or disarmed Tier-4 overruns",
    budgetTotal === 0,
    `${budgetTotal} across seeds ${seeds.join(",")}`,
  );
  b.gate(
    "0 Sybil, VoIP, MVNO, lifetime, W-9, or duplicate-media payouts",
    fraudTotal === 0,
    `${fraudTotal} violations (quarantined=${runs[0]?.adversarial.sybilClaimsQuarantined ?? 0}/seed)`,
  );
  b.gate(
    "0 thermal/battery/CAPTCHA/foreign-lease device dispatches",
    deviceTotal === 0,
    `${deviceTotal} across seeds ${seeds.join(",")}`,
  );
  b.gate(
    "0 disabled or consumer-task slop.cash settlements",
    slopCashTotal === 0,
    `${slopCashTotal} across seeds ${seeds.join(",")}`,
  );
  b.gate(
    "0 STOP-fence, quiet-hours, or cold-cooldown violations",
    stopCooldownTotal === 0,
    `${stopCooldownTotal} across seeds ${seeds.join(",")}`,
  );
  b.gate(
    "0 LLM daily token/cost cap breaches (circuit breaker enforced)",
    llmBreachTotal === 0 && llmBlocksTotal > 0,
    `breaches=${llmBreachTotal}, blocked=${llmBlocksTotal}`,
  );
  b.gate(
    "0 core queue-pressure ignored sends (+80% hysteresis held)",
    bpIgnoredTotal === 0 && allHysteresisHeld,
    `ignored=${bpIgnoredTotal}, hysteresisHeld=${allHysteresisHeld}`,
  );
  b.gate(
    "STOP-rate spike automatically triggers campaign lockdown",
    allStopLocked,
    `locked=${runs.filter((r) => r.adversarial.stopSpikeAutoLockdownTriggered).length}/${runs.length} seeds`,
  );
  b.gate(
    "Thompson Sampling Bandit beats uniform CPA baseline",
    avgBanditLift > 0,
    `bandit=$${(avgBlendedCpa / 100).toFixed(2)} vs uniform=$${(avgUniformCpa / 100).toFixed(2)} (+${avgBanditLift}%)`,
    !opts.quick,
  );
  await b.run("deterministic replay digest & multi-city liquidity reached", () => {
    expect(replaySeed1.digest).toBe(runs[0]!.digest);
    expect(allLiquidityReached).toBe(true);
    expect(runs.every((r) => r.allBlockingPass)).toBe(true);
  });

  // 3 Tracked Performance Metrics
  b.track(
    "blended CPA across NYC+SF",
    avgBlendedCpa <= 1_500,
    `$${(avgBlendedCpa / 100).toFixed(2)} (${totalSignups} verified signups over ${seeds.length}x${days}d)`,
  );
  b.track(
    "LLM zero-token savings (deterministic router + PromptCache)",
    avgTokenSavings >= 20,
    `${avgTokenSavings}% saved (cache=${runs[0]?.metrics.llmCacheHits ?? 0}, det=${runs[0]?.metrics.llmDeterministicHits ?? 0})`,
  );
  b.track(
    "multi-city launch readiness digest",
    allLiquidityReached,
    `seed1=${runs[0]!.digest}, cities=${runs[0]!.cities.join("+")}`,
  );
}
