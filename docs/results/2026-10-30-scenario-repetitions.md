# Reject empty scenario validation runs

## Problem and requirement

PRD 34.3 defines repeatable scenario scripts. CONTRIBUTING.md section 3.1 accepts corrections to simulations that measure the wrong result.

The scenario CLI accepted `--k 0`, ran no scenarios, printed `pass^0: PASS (0/0)`, and exited successfully.
`runScenarioPassK` used a zero-iteration loop and compared zero passing runs with the requested zero runs.
An empty validation run could therefore produce a green result without checking anything.

## Fix

Require a positive integer before the shared runner executes any scenario.
The CLI and direct API callers use the same check. Valid repetition counts and seed progression keep their existing behavior.

Two alternatives were rejected:

1. Silently replace zero with one. This hides the invalid configuration and changes what the caller requested.
2. Validate only the CLI flag. Direct callers could still obtain a passing result from zero runs.

## Evidence

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Runtime: Bun 1.4.2.
The existing `band-week-apart.json` scenario uses seed 11. No real model or fake model is supplied.

```bash
bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/band-week-apart.json --k=0 --no-log
bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/band-week-apart.json --k=1 --no-log
```

| CLI case | Before | After |
|---|---|---|
| `--k=0` | Exit 0; `PASS (0/0)`; no scenario checks | Exit 1; positive-integer error; no scenario runs |
| `--k=-1` | Invalid input was not rejected by the runner | Exit 1 before scenario execution |
| `--k=1.5` | Invalid input was not rejected by the runner | Exit 1 before scenario execution |
| `--k=invalid` | Invalid input was not rejected by the runner | Exit 1 before scenario execution |
| Default `k` | One run passes | Exit 0; one run and metric assertions pass |
| `--k=1` | One run passes | Exit 0; one run and metric assertions pass |

One CLI-level simulation gate covers these six invocations. It fails against the base runner and passes with the guard.
The controls verify actual metric assertion output, not just the final PASS text.
The scenario's engine-only expectation remains explicitly skipped under the CLI's built-in stub network.
The probes use `--no-log` and do not create run-state directories.

## Validation and limits

- The focused gate fails before the production change and passes afterward.
- Type checking passes.
- `bun run sim --only network`: 62/62 blocking gates pass, two tracked gates, zero tracked off target, 270.4 seconds.
- The network block also exercises the existing scenario corpus at three seeds each and preserves its safety and conformance gates.
- The baseline at the same base revision passed the original 61/61 network gates. The added CLI gate failed before the guard and passes afterward.
- No all-block simulation, database integration, end-to-end, real-LLM, or agent-client qualification is claimed for this local patch.
- This is deterministic validation logic. No matching or consent logic, member-facing text, model prompt, or tool schema changed.
- Local validation added no dependency or service and made no account or credential changes.
