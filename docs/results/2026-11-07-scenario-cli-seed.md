# Honor scenario CLI seed overrides — 2026-11-07

## Problem and scope

The scenario CLI accepts `--seed` but does not pass it to `runScenarioPassK`.
The flag changes the StubNetwork seed while the world still uses the fixture's seed.
This prevents a user from selecting or replaying the requested scenario trials.

For example, `stop-keyword.json` has seed 61.
On base, this command runs worlds 61 and 62 instead of 73 and 74:

```text
bun run --conditions eliza-source packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --seed 73 --k 2 --no-log
```

This is a reproduced simulator defect under CONTRIBUTING 3.1 and the approved project scope.
PRD 34.3 requires scenario scripts and repeatable simulated outcomes.
The existing CLI documents `--seed` as the run seed.
The shared runner already supports an explicit starting seed and increments it for each repetition.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, current main.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for service validation.
The frozen dependency installation made no changes.

## Cause and fix

The CLI parses a seed but only supplies it to random worlds and the StubNetwork constructor.
Its scenario call omits `ScenarioRunOptions.seed`.
The argument parser also supplies a default value, which hides whether the user requested an override.

Keep the parsed option absent when it was not supplied.
Retain seed one for ordinary worlds and the StubNetwork's default.
Forward an explicit scenario seed, including zero, to the existing runner.
The runner then uses `seed`, `seed + 1`, and so on for the requested repetitions.

The fixture still controls scenario seeds when the flag is omitted.
The StubNetwork's seed selection is unchanged: it remains the explicit CLI seed, or one, across the repetitions.
No scenario fixture, world behavior, grader, threshold or random-number algorithm changes.

Other implementations considered:

1. Always pass the CLI's default seed one. That silently replaces every fixture's default and changes existing scenario commands.
2. Mutate the loaded fixture's seed. That bypasses the runner's existing override option and changes scenario input unnecessarily.

## measurement

### Committed regression

One integration case launches six actual CLI processes, each running two complete worlds.
It uses `stop-keyword.json` and `group-flake-morning-of.json` with no override, `--seed 73`, and `--seed=0`.
Each invocation writes its normal JSONL records and metrics to a unique temporary run name.
The test reads those files and compares them with the public scenario API using the requested seed.
It checks exit status, printed seeds, saved seeds, every record and all metrics.
Record comparison excludes only elapsed wall time.
The test removes only its own run directories and temporary fixture.

No messages, persona decisions, outcomes or random-number generators are mocked.
The policy personas and StubNetwork are the repository's normal deterministic simulation components.
The StubNetwork has no human-review gate; the qualification block separately exercises ConsentNetwork with simulated review.

```text
bun test --conditions eliza-source packages/sim/test/scenario-seed.integration.test.ts

Before: 0 pass, 1 fail, 1 assertion; case 981.58 ms, command 1036 ms
After:  1 pass, 0 fail, 1 assertion; case 898.89 ms, command 948 ms
```

Eight overridden worlds use the wrong seed on base.
All twelve saved worlds match their requested API reference after the fix.
The four worlds without an override preserve fixture defaults.
These timings are observations, not a performance claim.

### Wider comparison

Use three existing fixtures: `stop-keyword`, `group-flake-morning-of`, and `band-week-apart`.
Run two worlds per CLI invocation.
The primary set uses no override, zero, seven, 73, and the fixture's own seed.
The fixture seeds are 61, 21 and 11 respectively.
The additional set uses starting seeds 101 through 108.

The measurement helper uses identical fixture names and data on base and fix.
This matters because scenario names also enter proposal identifiers used by seeded decisions.
The shared temporary name prefix was `scenario-seed-evidence-4f04b692e08c4b32913f729f039aa76c`.
Each fixture name adds its original name and the starting-seed label, or `default`.
All other fixture fields remain unchanged.
For each run, compare the saved records and metrics with a fresh direct API run.
Also compare base and fix controls after excluding only `run_end.wallMs`.

Each saved CLI trial uses this command, with `--seed` omitted for the default control:

```text
bun run --conditions eliza-source packages/sim/src/cli.ts --scenario <temporary-fixture.json> --seed <starting-seed> --k 2
```

Its direct reference uses the same loaded fixture and starting seed:

```ts
await runScenarioPassK(scenario, 2, {
  seed: startingSeed, writeLog: false,
  network: sc => new StubNetwork({ seed: startingSeed ?? 1, randomIntros: true, ...sc.stub }),
});
```

| Corpus | Scenario worlds per revision | Wrong seeds before | Wrong seeds after | Unchanged controls |
|---|---:|---:|---:|---:|
| Primary | 30 | 18 | 0 | 12 |
| Additional | 48 | 48 | 0 | 0 |
| Total | 78 | 66 | 0 | 12 |

All 78 fixed CLI worlds match their direct API records, metrics, grades and exit status.
All twelve already-correct scenario controls retain identical complete records and metrics.
Three ordinary random-world controls use six personas, two days, and seeds omitted, zero and 73.
Their saved seed values and all reported metrics remain unchanged, excluding the generated run identifier.

Four individual scenario grades and four CLI exit statuses change when the requested worlds finally run:

| Fixture | Requested starting seed | Repetition | Actual seed after fix | Grade before → after |
|---|---:|---:|---:|---|
| stop-keyword | 0 | First | 0 | PASS → FAIL |
| stop-keyword | 102 | First | 102 | PASS → FAIL |
| stop-keyword | 108 | Second | 109 | PASS → FAIL |
| band-week-apart | 103 | Second | 104 | FAIL → PASS |

All four new results match direct API execution.
The fix does not make these scenarios better; it evaluates the worlds that the caller selected.
This is not a claim that all arbitrary seeds pass every scenario or invariant.

## safety_gates

```text
bun run sim --only network --json <output>
```

Base: 61/61 blocking gates, two tracked gates on target, 156.0 seconds.
Fix: 61/61 blocking gates, two tracked gates on target, 215.2 seconds.
All 63 gate records match exactly after excluding elapsed time, including safety values and fingerprints.
No expected gate value or classification changes.

The baseline qualification reuses PR #378's recorded run on the same main revision and setup.
The independent base checkout was verified clean at that revision.
The regression and all wider CLI comparisons ran specifically for this change.
The full simulation was not repeated: AGENTS.md permits one full run per agent, already used on #355.
That earlier full run is not evidence for this revision.

## Service validation

Typecheck passed all four configurations.

```text
bun run test:integration
676 pass, 8 skip, 6 fail; 13,742 assertions; 405.25 seconds

bun run test:e2e
42 pass, 1 skip, 0 fail; 654 assertions; 35.33 seconds
```

The new case passed within the official integration command in 722.87 ms.
Integration includes the security suite.
All six failures match the recorded base failures by test name and underlying cause:

- The Wrangler test cannot spawn `/bin/bash` on this Windows setup.
- The boot test receives SIGTERM exit 143 instead of zero.
- Four site-build assertions expect slash-separated paths instead of Windows paths.

Eight optional completed-cleanup reconciliation cases were skipped.
The optional browser SDK case requires `PLAYWRIGHT_MODULE` and was skipped.
A fully green integration suite is not claimed.

The first integration attempt used a misconfigured local database port: 5432 instead of the required 54339.
It recorded 353 passes, eight skips and 71 failures in 291.80 seconds, including database setup and cleanup failures.
That attempt is not successful service validation.
The owned cluster was restarted on 54339 after checking that it had no clients.
The service suites were rerun without changing repository code or assertions.
The isolated database stopped after the final runs completed and its client count reached zero.

## Related work

PR #246 rejects invalid repetition counts in `runScenarioPassK`.
This change forwards an existing seed override and does not duplicate its guard or gate.
It starts from main and does not include other open PRs.

## llm_evidence

N/A: deterministic CLI option forwarding, with built-in policy personas.
Real-model calls: zero. Provider cost: $0.
No model-backed behavior is claimed.

## agent_clients

N/A: a developer CLI, with no changed member-facing agent protocol.
Codex desktop 26.1029.7803.0 drove Bun 1.4.2.
Authoring provider: OpenAI; the exact model identifier was unavailable.
No other agent client, browser or computer controls were used.

## How to test

1. Run the integration command above. Expect one passing case over twelve saved worlds and their API references.
2. Run the example CLI command. Expect seeds 73 and 74 in the completed scenario output.
3. Remove `--seed 73` and repeat. Expect the fixture's seeds 61 and 62.
4. Use `--seed=0`. Expect seeds zero and one, with the exit status determined by those actual scenario results.
5. Run the Network qualification command. Expect 61/61 blocking gates and unchanged gate records.

## Risks and limits

Commands with an explicit scenario seed now generate the requested population, decisions and outcomes.
Their grades and exit statuses can differ from the old command's result.
Commands without an override, ordinary worlds and the network seed selection retain their existing behavior.
Previously saved runs are not rewritten; rerun the command to obtain the requested trials.
Invalid seed parsing and invalid repetition counts are outside this change.

Live-send and deployment flags were disabled for validation.
Only synthetic repository fixtures were used.
No UI, message-copy, dependency or production-service change is included.
No credentials, `.env`, raw run logs or member data are committed.
