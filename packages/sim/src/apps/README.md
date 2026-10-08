# @thenetwork/worlds

Simulated worlds for the apps on The Network's shared matching engine. One folder per app.

- `src/slop/`: slop.date (dating). Personas with hidden truth, the agent-visible snapshot
  (`buildSlopSnapshot`, read back with `visibleProfiles`), the oracle (`SlopOracle`, soft labels
  over chemistry), the persona behaviour model, the probe-first booked-plan harness
  (`runSlopWorld`), metrics and baselines (random, greedy-by-desirability, oracle-optimal).
  Model, calibration, snapshot mapping and baseline numbers: `docs/results/2026-10-08-slop-world.md`.
  The slop.date AppPack runs here through the real engine (`enginePack.ts slopEngineMatcher`,
  async: `runSlopWorldAsync`); `packEval.ts` compares it with the baselines and checks the launch
  gates: `docs/results/2026-10-08-slop-pack.md`.
- `peon/`, `buddies/`: later.

```bash
bun run packages/worlds/src/slop/cli.ts --seeds 1-8 --per-city 300 --weeks 4   # baselines
bun run packages/worlds/src/slop/calibrate.ts --seeds 1-8 --diag               # calibration
bun run packages/worlds/src/slop/packEval.ts --seeds 5-8 --weeks 4 --arms random,greedy,oracle,slop  # slopPack + gates
bun test --conditions eliza-source ./packages/worlds
```

Network code never imports hidden truth from here: matchers read only the snapshot. The world runs
without any LLM; `prose.ts` (optional bios via `defaultLLM()`) is cached in `runs/worlds/`.
