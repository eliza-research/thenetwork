# Scenario repetition count

On November 14, 2026, the stop-keyword scenario on `a8b60e7` reported
`PASS (0/0 runs)` when given `--k 0`. The runner now rejects zero,
negative, fractional and non-finite counts before building a world.
The fixed-seed regression checks four invalid counts plus the default
and an explicit one-run count through the same runner. Both valid controls
complete one run and preserve the scenario's expected result.

Run the Network gate with `bun run sim --only network`. Run
`bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 0`
to see the command refuse zero runs. The default path and explicit one-run
control call no model.
