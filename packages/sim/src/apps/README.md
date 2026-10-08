# packages/sim/src/apps: the per-app worlds

Simulated worlds for the apps on The Network's shared matching engine, one folder per app. They were
`@thenetwork/worlds` until 2026-10-08. The Network's own world is the rest of `packages/sim`.

- `slop/`: slop.date (dating). Personas with hidden truth, the agent-visible snapshot
  (`buildSlopSnapshot`, read back with `visibleProfiles`), the oracle (`SlopOracle`, soft labels
  over chemistry), the persona behaviour model, the probe-first booked-plan harness
  (`runSlopWorld`), metrics and baselines (random, greedy-by-desirability, oracle-optimal).
  Model, calibration, snapshot mapping and baseline numbers: `docs/results/2026-10-08-slop-world.md`.
  The slop.date AppPack runs here through the real engine (`enginePack.ts slopEngineMatcher`,
  async: `runSlopWorldAsync`); `packEval.ts` compares it with the baselines and checks the launch
  gates: `docs/results/2026-10-08-slop-pack.md`.
- `peon/`: peon.biz (hiring). Candidates, companies and jobs with hidden truth and a sealed store,
  the application-flow harness, the adverse-impact audit, `officialGates`:
  `docs/results/2026-10-08-peon-pack.md`.
- `friends/`: friends.help (NYC friendship). Personas, meetups, crews, `officialGates` and tracked
  metrics: `docs/results/2026-10-08-friends-pack.md`.

`bun run sim` runs each app's official gates on pinned seeds (scripts/sim/{slop,peon,friends}.ts).
The CLIs print the full tables and exit 1 when an official gate fails:

```bash
bun run packages/sim/src/apps/slop/cli.ts --seeds 1-8 --per-city 300 --weeks 4     # slop baselines
bun run packages/sim/src/apps/slop/packEval.ts --seeds 13-16 --weeks 4 --arms random,slop --gates3 \
  --population '{"catfish":0.005,"bodyTypes":true}' --world '{"verification":true,"relay":true,"review":3,"widen":true,"checkin":true,"photos":1,"rater":true}'
bun run packages/sim/src/apps/peon/cli.ts --seeds 13-16
bun run packages/sim/src/apps/friends/cli.ts --seeds 5-8
```

Network code never imports hidden truth from here: matchers read only the snapshot. The worlds run
without any LLM.
