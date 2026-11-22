# Scenario repetition count

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-11-14-scenario-repetition.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

On November 14, 2026, the stop-keyword scenario on `a8b60e7` reported
`PASS (0/0 runs)` when given `--k 0`. The runner now rejects zero,
negative, fractional and non-finite counts before building a world.
The fixed-seed regression checks four invalid counts plus the default
and an explicit one-run count through the same runner. Both valid controls
complete one run and preserve the scenario's expected result.

Run the Network gate with `pnpm run sim --only network`. Run
`node --import tsx --env-file-if-exists=.env packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 0`
to see the command refuse zero runs. The default path and explicit one-run
control call no model.
