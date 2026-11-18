# Reject unregistered simulation blocks

Date: 2026-11-05 (Asia/Tokyo). Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows. This is a reproduced simulation-validation defect under PRD 34.1 and CONTRIBUTING 3.1.

## Problem and fix

`bun run sim --only constructor` reports `PASS: 0/0 blocking gates` and exits 0.
There is no registered block named `constructor`.

The selector checks `BLOCKS[x]` for a value. That lookup includes inherited JavaScript properties.
It accepts `constructor`, `toString`, and `hasOwnProperty` as block functions.
Those functions add no gates. A mixed selection can also report success after silently accepting an invalid block.

Use `Object.hasOwn(BLOCKS, x)` to check the registered names before any block runs.
Rejected names use the existing diagnostic and exit code 2.

Two other implementations were considered:

1. Convert the dispatch table to a `Map`. That changes registration and dispatch for a membership check.
2. Keep a separate list of allowed names. That duplicates the dispatch table and can drift from it.

## measurement

The regression invokes the real CLI in child Bun processes. It imports the actual blocks and runs the actual eval corpora.
It uses no mocked result or replacement block.

| Check | Base | Fix |
|---|---|---|
| `bun run sim --only constructor` | Exit 0; `PASS: 0/0` | Exit 2; unknown block |
| `bun run sim --only no-such-block` | Exit 2; unknown block | Exit 2; unknown block |
| `bun run sim --only evals` | 25/25 gates pass | 25/25 gates pass |
| CLI regression | 0 pass, 1 fail | 1 pass, 0 fail; 7 assertions |
| `bun run typecheck` | Not run on base | Pass |
| `bun run sim --only audit,ops` with LF checkout and PostgreSQL on 54339 | 30/30 gates pass | 30/30 gates pass |

Regression command:

```sh
bun test --conditions eliza-source packages/sim/test/cli.integration.test.ts
```

The same test failed on the base selector, then passed after the fix.
It rejects three inherited names, an ordinary unknown name, and the mixed selection `evals,constructor`.
The control runs `--only=evals` and requires a successful result with nonzero gates.
There is one regression case. These selector checks have no seed or statistical sampling.

## safety_gates

The fix changes only CLI block selection. It changes no block, gate threshold, matching rule, message, or safety policy.
The unchanged eval corpus passes all 25 gates before and after.

The full `bun run sim` ran once with the repository's default seeds and simulated reviewer.
It initially reported 322/327 blocking gates passing and 16 tracked gates off target.
The five failures were in the audit block: CRLF checkout text broke site metadata parsing and the console source scan.
Two operations checks skipped because that block uses port 54339 directly, while the isolated database used 54349.

I restored tracked files to their committed LF bytes and moved the isolated PostgreSQL 16.15 cluster to the free port 54339.
These were local setup changes; they add no source changes to this PR.
Then I ran `bun run sim --only audit,ops` with the base selector and again with the fixed selector.
Both runs passed all 30 blocking gates, including the real database backup and restore.
All gate pass states matched. The backup gate's name includes elapsed time, which differed between runs.

The other blocks passed all 300 blocking gates in the full run.
Thus all 330 blocking gates passed across that run and the corrected audit/operations rerun.
The remaining 14 off-target gates are tracked, as before; no threshold or gate classification changed.
Default seeds include network 3 and 1-3, slop 13-16 and 21-22, onboard 13-14, peon 13-16, friends 5-8, and Clef 1.

## Integration and end-to-end validation

`bun run test:integration`: 676 pass, 8 skip, 6 fail across 69 files; 13,748 assertions, 529.73 seconds.
The new CLI regression passes in this suite. The suite includes the repository's security tests.

All six failures also reproduce with the base selector and the same LF checkout and PostgreSQL configuration:

- `deploy/wrangler.integration.test.ts`: `/bin/bash` does not exist on Windows.
- `deploy/backend/backend.test.ts`: the child exits 143 after SIGTERM; the test expects 0.
- `sites/test/sites.test.ts`: four artifact assertions expect slash-separated paths; Windows returns backslash-separated paths.

Base reproduction:

```sh
bun test --conditions eliza-source --timeout 120000 deploy/wrangler.integration.test.ts deploy/backend/backend.test.ts sites/test/sites.test.ts -t 'Wrangler OS-session|migrates on boot|the build ships the files'
```

Result: 0 pass, 6 fail, 103 filtered out. The six failures match the full integration run.
No deployment or site source was changed to address them.

`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions, 91.58 seconds.
The skipped case needs the optional browser SDK environment. Browser acceptance is not claimed.
The isolated PostgreSQL cluster was stopped after validation.

## llm_evidence

N/A: this defect occurs before simulation dispatch and does not use a model.
No real-LLM run was made. Calls: 0. Cost: $0. Provider and model for these tests: none.

## agent_clients

N/A: no member-facing agent workflow changes. The tested interface is the Bun CLI.
Codex desktop 26.1027.6604.0 ran the commands, using OpenAI assistance.
The exact assistant model identifier was not exposed, so the Slop disclosure uses its supported `unavailable` value.
No other agent client is claimed as tested.

## Limits

The regression covers selection and exit behavior, not the scientific validity of each simulation.
It does not change the behavior of registered blocks or other command-line options.

## Review follow-up: empty and repeated selectors

Date: 2026-11-06 (Asia/Tokyo). Before revision: `1a2deb299404d6c6139e966fc8271daf3d53bf25`.
This addresses [both selector findings in review](https://github.com/eliza-research/thenetwork/pull/355#pullrequestreview-5785638780).
The runtime remains Bun 1.4.2 on Windows.

The argument reader removed empty comma-separated fields before validation.
An explicit empty selector therefore became indistinguishable from no selector and selected the default suite.
The dispatch list also retained duplicate names, so repeated blocks inflated gate counts and replaced their first timing entry.

Keep raw fields until validation, trim each block name, and use a `Set` to retain each name's first occurrence.
An empty name now uses the existing unknown-block exit code 2, with `<empty>` in the diagnostic.
The JSON output option still selects its first nonempty value.

Alternatives considered:

1. Reject repeated valid names. Deduplication preserves repeatable flags without running a block twice.
2. Add a separate selector parser or argument library. The existing reader already preserves raw fields with one change.

### measurement

The same real CLI calls ran before and after the fix, without replacement blocks or mocked output.
For the four empty-selector reproductions, the harness stopped the process when the first block banner appeared.
This proves incorrect dispatch without running the full suite again; exit 143 below is the harness termination.

| Arguments to `bun run sim` | Before | After |
|---|---|---|
| `--only ""`, `--only=`, `--only ,`, trailing `--only` | Started default `evals`; stopped with exit 143 | Exit 2; no block started |
| `--only evals,` | Exit 0; 25/25 gates | Exit 2; no block started |
| `--only evals,evals` | Exit 0; two runs; 50/50 gates | Exit 0; one run; 25/25 gates |
| `--only evals --only evals` | Exit 0; two runs; 50/50 gates | Exit 0; one run; 25/25 gates |
| Expanded CLI integration case | 0 pass, 1 fail at `evals,` | 1 pass, 0 fail; 19 assertions |
| `bun run sim --only evals --json <output>` | 25/25 gates | 25/25 gates |

All 25 gate names, results, classifications, and details match between the JSON reports; elapsed times are excluded.
The existing single integration case now checks 13 invalid argument lists, one valid control, and four repeated selections.
It includes whitespace, missing values, both flag syntaxes, and an empty value after a valid selection.
Each child has a ten-second deadline; the case has sixty seconds for all subprocesses.
The fixed case completed in 4.50 seconds locally.

Commands:

```sh
bun test --conditions eliza-source packages/sim/test/cli.integration.test.ts
bun run sim --only evals --json <output>
bun run typecheck
```

Typecheck passes all four configurations.
The selector has no random seed; the eval corpus is unchanged.
No gate threshold, safety behavior, or model-backed behavior changes.
The earlier `safety_gates`, `llm_evidence`, and `agent_clients` declarations still apply.
The full simulation was not repeated: AGENTS.md permits at most one full run per agent, already recorded above.

`bun run test:integration`: 676 pass, 8 skip, 6 fail; 13,760 assertions across 69 files, 560.24 seconds.
The expanded CLI case passed inside this official suite in 3.07 seconds.
The six failures are the same base-reproduced Windows failures described above; no new failure appeared.
This run includes the security suite and uses the isolated PostgreSQL 16.15 cluster on port 54339.

`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions, 73.15 seconds.
The optional browser SDK case remains skipped. No browser or computer use was performed.
The isolated database was stopped after validation.
