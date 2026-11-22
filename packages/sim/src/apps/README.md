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
  `docs/results/2026-10-08-peon-pack.md`. `yardstick.ts` is an offline yardstick for the peon
  selector. It never runs in the engine path and never changes a proposal. Each week the engine-backed
  matcher (`packMatcher`) records a `PeonMarket`: the eligible Hire pairs that the engine scored, the
  value that the greedy order uses for each pair (the score times 1,000, rounded), and the room of each
  member. The room is rebuilt from the pack and engine rules, not read from the run: 0 in an open
  opportunity, else the smaller of the proactive budget left and the pack limit (a seat's slate cap,
  the Hire weekly capacity of a candidate). `load` holds every proposal of the run, in all lanes, for
  each member, against the same room. `optimumSelection` finds the largest total value of pairs within
  every room, each pair at most once: a maximum-weight b-matching, solved exactly as a min-cost flow
  (successive shortest paths with potentials on source, candidate, seat, sink, cost minus the value).
  It stops at the first path that does not raise the total, so the flow has the largest value, not the
  largest size. It is deterministic: the pairs are sorted and ties keep the first path. The other
  matchers record no market. `marketMeasures` sums the weeks of one run, and `trackedGates`
  (`gates.ts`) prints the tracked measures: the role-level gap of backed pairs, the greedy share of the
  optimum, proposals over room, and the load of candidates and seats. Each tracked measure has a
  target, and the targets never block. Results: `docs/results/2026-11-22-peon-level-gap-and-yardstick.md`.
- `friends/`: friends.help (NYC friendship). Personas, meetups, crews, `officialGates` and tracked
  metrics: `docs/results/2026-10-08-friends-pack.md`.

`pnpm run sim` runs each app's official gates on pinned seeds (scripts/sim/{slop,peon,friends}.ts).
The CLIs print the full tables and exit 1 when an official gate fails:

```bash
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/slop/cli.ts --seeds 1-8 --per-city 300 --weeks 4     # slop baselines
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/slop/packEval.ts --seeds 13-16 --weeks 4 --arms random,slop --gates3 \
  --population '{"catfish":0.005,"bodyTypes":true}' --world '{"verification":true,"relay":true,"review":3,"widen":true,"checkin":true,"photos":1,"rater":true}'
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/peon/cli.ts --seeds 13-16
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/friends/cli.ts --seeds 5-8
```

Network code never imports hidden truth from here: matchers read only the snapshot. The worlds run
without any LLM.
