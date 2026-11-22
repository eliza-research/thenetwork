# Scorecard comparison uses one observation time

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-19-scorecard-observation-time.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

The existing PostgreSQL integration case compares the simulator with the database reader.
The simulator uses its fixed dataset date. The database reader uses the current wall clock.
After the simulated meeting dates pass, the database side counts more overdue meetings.
The completion score differs even though the stored data is identical.

Set the test wall clock to the simulated snapshot time before starting the database reader.
Restore the clock during cleanup. Production code and scorecard rules do not change.

Command: `pnpm exec vitest run --testTimeout 300000 packages/observatory/test/real-console.test.ts`.
Seed: 1. Scenario: `spam_wave`. Duration: five simulated days. Runtime: the former runtime 1.4.2 and local PostgreSQL.

Before: 7 pass, 1 fail, 1064 assertions. Completion is 0.5 in game mode and 0.313 in database mode.
After: 8 pass, 0 fail, 1076 assertions. Both completion scores are 0.5.
The unchanged base reproduced the same failure, including with TZ=UTC.
These are deterministic integration assertions, not sampled quality estimates. Confidence intervals do not apply.

Alternatives: moving the fixture date only postpones the failure. Removing completion from the assertion hides broken parity.
This repair preserves the real database round trip and all scorecard assertions.
No LLM, agent client, production data, provider delivery, or deployment was used.
This report is hand-written; counts come from test output.
