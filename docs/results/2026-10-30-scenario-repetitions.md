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
| `--k=-1` | Exit 1; `FAIL (0/-1)`; no scenario runs | Exit 1; positive-integer error; no scenario runs |
| `--k=1.5` | Exit 1; `FAIL (2/1.5)`; two completed scenario runs | Exit 1; positive-integer error; no scenario runs |
| `--k=invalid` | Exit 1; `FAIL (0/NaN)`; no scenario runs | Exit 1; positive-integer error; no scenario runs |
| Default `k` | One run passes | Exit 0; one run and metric assertions pass |
| `--k=1` | One run passes | Exit 0; one run and metric assertions pass |

Only zero produced a false pass. The other invalid inputs already exited 1; the fractional count also wasted two runs.
These corrected rows were independently reproduced on 2026-11-03 against base `a0ed7bc` and PR head `e2b0933`, with Bun 1.4.2.

One CLI-level simulation gate covers these six invocations. It fails against the base runner and passes with the guard.
The controls verify actual metric assertion output, not just the final PASS text.
The scenario's engine-only expectation remains explicitly skipped under the CLI's built-in stub network.
The probes use `--no-log` and do not create run-state directories.

## Original validation and limits (2026-10-30)

- The focused gate fails before the production change and passes afterward.
- Type checking passes.
- `bun run sim --only network`: 62/62 blocking gates pass, two tracked gates, zero tracked off target, 270.4 seconds.
- The network block also exercises the existing scenario corpus at three seeds each and preserves its safety and conformance gates.
- The baseline at the same base revision passed the original 61/61 network gates. The added CLI gate failed before the guard and passes afterward.
- No all-block simulation, database integration, end-to-end, real-LLM, or agent-client qualification is claimed for this local patch.
- This is deterministic validation logic. No matching or consent logic, member-facing text, model prompt, or tool schema changed.
- Local validation added no dependency or service and made no account or credential changes.

## Independent cloud validation (2026-11-03)

The tested code is PR head `e2b0933314499c8b3ec7c8dfdca41381e2ed1bf0`.
The comparison base remains `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, also the current upstream main.
Only this report changed during validation. The production guard and its existing gate remain unchanged.

Runtime: Bun 1.4.2. Database: PostgreSQL 16.15 on local port 54339.
The database, full simulation, integration suite and standard e2e command ran in the CI-pinned image:
`postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`.
The container had external networking disabled. All accounts and database contents were synthetic.

The six CLI cases above ran once per tree: 12 invocations, scenario seed 11, default stub network, and `--no-log`.
The base fractional case completed seeds 11 and 12 before failing.
The existing CLI gate failed against the base production code and passed on the PR head.
No additional regression gate was added.

| Check | Result |
|---|---|
| `bun run typecheck` | Exit 0; all four TypeScript projects pass |
| `REQUIRE_PG=1 bun run sim --json <local-evidence>/sim-gates.json` | 331/331 blocking gates pass; 45 tracked, 14 off target; 359.3 seconds |
| Network block within the full run | 62/62 blocking gates pass; two tracked, zero off target; 190.8 seconds |
| PostgreSQL simulation blocks | Safety, ops, pipeline and audit ran; no PostgreSQL gate skipped |
| `bun run test:integration` with `REQUIRE_PG=1` and reconciliation enabled | 687 pass, zero skip, zero fail; 14,044 assertions across 68 files; 207.14 seconds |
| `bun run test:e2e` with `REQUIRE_PG=1` | 42 pass, one optional browser case skipped, zero fail; 654 assertions |
| The skipped browser case, run separately | One pass, zero fail; 16 assertions; actual Chromium 154.0.8037.57 through Playwright 1.62.1 |
| `bun run plugins/build.ts --check` | Plugin skill snapshots are up to date |
| `DEPLOY_TARGET=production bun run sites:build` | All four sites build; warnings report the absent production Turnstile site key |

The browser case used the installed Chromium executable through a local Playwright launcher.
Its source and assertions were unchanged. Its existing controlled SDK callbacks do not prove a real Turnstile challenge.
The normal e2e command and the separate browser command together exercised every e2e case.

The first integration attempt recorded 677 pass, eight skip, and four fail.
The four failures were local S3 fixtures using the inherited HTTP proxy, which was unreachable inside the isolated container.
All six backup cases passed after clearing proxy variables for that local-only process.
External networking remained disabled. No repository code or test assertion changed.

The final full integration command also enabled the six reconciliation cases that the default command skips:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  REQUIRE_PG=1 NETWORK_RETRY_RECONCILIATION_TEST=1 \
  NETWORK_RETRY_POSTGRES_URL=postgres://agent@127.0.0.1:54339/network_retry_246e2b0933 \
  bun run test:integration
```

The explicitly supplied synthetic database was created empty before this command.
The final run passed every integration case, including backup and reconciliation, without skips.

The full simulation uses its pinned seeds. ConsentNetwork worlds use simulated human review (`review: "auto"`).
The CLI probe uses the stub network, which has no human review or engine judge.
The 14 off-target tracked results remain visible in the JSON report; this run does not prove every quality target is met.
They cover onboarding parsing, Slop quality and safety reductions, relay heldout recall, and Friends adversary harm.

No real-model call occurred: provider and model N/A, zero requests, zero provider cost.
CONTRIBUTING.md section 7.2 and AGENTS.md still require real-model evidence.
No provider credential or spending authorization was available. No exception from a maintainer is claimed.
No agent-client flow changed or was qualified. The original authoring attribution remains operator-reported.
No Apollo result is used as cloud evidence, and no result for another commit is attributed to this head.

Hosted CI remains a separate qualification gap.
At review, CI run `41034727567` for `e2b0933` reported `action_required` and contained no jobs.
That status is an approval gate, not a failed test. These local results do not establish hosted CI success.
