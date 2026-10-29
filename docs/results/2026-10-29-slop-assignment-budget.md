# Slop assignment respects each member's remaining proposal budget

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Final code and regression gate: `4b0006bbd576f5657624542da578878a78314764`.
Scope: PRD 28.3 (outreach control), 32.9 and 40.4.

## Problem, fix and alternatives

Slop replaces the shared selector with its own assignment algorithm.
Its per-tick limit ignores the member's remaining rolling proposal budget.
Both algorithms can return two proposals when the budget permits one. Backup rounds have the same defect.
This measures engine output. It does not establish excess live messages; the later outreach controller still applies its limits.

Check both members' budgets before each round. Count recent proposals and proposals already selected in this run.
Use each member's participation state to select the budget.
Profile questions have a separate allowance in `ConsentNetwork.sendAsks`. They do not consume this proposal budget.
An earlier guard counted reserved questions too. It reduced bookings and broke two existing database-backed date workflows.
That version was rejected. The final guard counts proposals only, and both workflows pass again.

Two other implementations were considered:

1. Use the shared selector. This would also change Slop's congestion and stable assignment rules.
2. Trim excess proposals afterward. This would discard selected partners without trying their other candidates.

Checking eligibility before each round preserves those assignment rules.

## measurement

The comparison uses real `runEngine` execution and synthetic Slop personas.
Seeds: 1, 2 and 3. Each world has 60 personas per city across SF, NYC and LA.
Sample: three worlds of 180 personas, evaluated with both assignment algorithms.
The limit is one proposal per seven days. Two rounds are enabled. Profile questions are disabled to isolate assignment.
Both revisions use identical inputs, configuration and measurement code.

| Assignment | Seed | Proposals before | Proposals after | Members over budget before | Members over budget after |
|---|---|---:|---:|---:|---:|
| greedy | 1 | 100 | 52 | 78 | 0 |
| greedy | 2 | 87 | 44 | 67 | 0 |
| greedy | 3 | 83 | 43 | 63 | 0 |
| stable | 1 | 95 | 52 | 74 | 0 |
| stable | 2 | 85 | 43 | 68 | 0 |
| stable | 3 | 81 | 41 | 62 | 0 |

Maximum proposals per member: two before, one after, in all six runs.
Fewer proposals are expected when the configured budget is enforced.
This is a deterministic correctness result, not a matching-quality improvement or statistical significance claim.

Save this code as `runs/reproduce-slop-budget.ts` in each checkout:

```ts
import { slopWorld } from '../scripts/sim/slop.ts';
import { runEngine } from '../packages/engine/src/engine.ts';
import { makeSlopPack, SLOP_ENGINE_CONFIG } from '../packages/engine/src/packs/slop/index.ts';
for (const seed of [1, 2, 3]) {
  const input = slopWorld(seed, {perCity: 60});
  const cfg = {...SLOP_ENGINE_CONFIG, seed, budgets: {open:{limit:1,periodDays:7},normal:{limit:1,periodDays:7},receiving:{limit:1,periodDays:7}}};
  for (const assignment of ['greedy', 'stable'] as const) {
    const result = await runEngine(input, cfg, {pack:makeSlopPack({assignment, asks:false,compatAsks:false, congestion:{perMemberPerTick:2,backupMaxDegree:0}})});
    const count = new Map<string,number>();
    for (const p of result.proposals) for (const id of p.participants) count.set(id,(count.get(id)??0)+1);
    console.log(JSON.stringify({seed,assignment,proposals:result.proposals.length,maxPerMember:Math.max(0,...count.values()),overBudget:[...count.values()].filter(n=>n>1).length}));
  }
}
```

Run `bun run --conditions eliza-source runs/reproduce-slop-budget.ts` on both revisions.
Expected results are in the table above. Keep the temporary file untracked.

## Regression gate

The one new gate in `scripts/sim/slop.ts` exercises both algorithms, ordinary and backup rounds, and seeds 1-3.
It covers fresh members with a one-proposal budget and recent proposals under the default two-proposal budget.
Historical proposals come from a preceding real engine run.
Every case requires more than ten proposals. Historical cases require more than five members with history who receive a new proposal.
The gate cannot pass by excluding everyone.

Use Bun 1.4.2 and locked dependencies:

```sh
bun install --frozen-lockfile
bun run sim --only slop
bun run typecheck
```

Keep the new gate and restore only `assign.ts` from the base revision.
The budget gate fails with `expected 2 to be <= 1`. Restore the final guard; that gate passes.
The base failure was reproduced before the fix.

## safety_gates

Full offline simulation: **330/331 blocking gates pass across 13 blocks; exit 1 (bash absent from PATH)**.
Focused audit retry: **16/16 blocking gates pass; exit 0 after adding existing Git Bash to PATH**.
All blocking checks pass across the full run and corrected audit retry. A single all-green full run is not claimed.
Base Slop: 39/39 blocking gates pass. Final Slop: 40/40 pass, including the new budget gate.
Final Slop has 8 tracked gates off target. Their thresholds and blocking classifications are unchanged.
The declared-minor exclusion, zero-leak and consent gates pass.

The pinned Slop world uses seeds 13-16, four weeks and 300 personas per city.
Slop-live uses seeds 21-22 and its unchanged 30-day protocol, with a simulated reviewer.
No gate threshold, seed, safety rule or member-facing text changes.

| Existing metric | Base | Final fix |
|---|---|---|
| gate Dates per member-month vs random (>= 0.9x) | 1.005 | 1.005 |
| gate Minor contacts (age liars) cut vs random (>= 90%) | 76.5% | 76.5% |
| gate Adversary contacts cut (scammers, harassers, age liars) (>= 90%) | 45.4% | 45.4% |
| relay world: scam and harassment items held or blocked >= 90% (in thread and on content alone) | 100.0% in thread, 100.0% content only (n 43) | 100.0% in thread, 100.0% content only (n 43) |
| slop-live quality: probes sent (pooled) | 342 | 313 |
| slop-live style: probe texts that break the Network's style rules (target 0) | 4 of 342 (too_long) | 3 of 313 (too_long) |
| slop-live quality: yes per probe answer | 0.461 | 0.417 |
| slop-live quality: dates booked per opportunity approved | 42 dates, 268 opportunities, 256 approvals | 35 dates, 253 opportunities, 242 approvals |
| slop-live quality: dates held (both showed) | 32 | 28 |
| slop-live quality: share of adult daters booked at least once in 30 days | 0.391 | 0.340 |

These counters describe synthetic worlds, not human match quality.

## Executed validation

Environment: Windows, Bun 1.4.2 (`744846f84`), PostgreSQL 16.15 and locked dependencies.
Final checks use a clean LF checkout of the final code revision.
PostgreSQL runs locally on port 54339 with `REQUIRE_PG=1`.
No live-send, deployment or provider credentials are supplied.

| Check | Final result |
|---|---|
| New gate on base assignment | FAIL: `expected 2 to be <= 1` |
| Full offline simulation | 330/331 blocking gates pass across 13 blocks; exit 1 (bash absent from PATH) |
| Focused `audit` retry | 16/16 blocking gates pass; exit 0 after adding existing Git Bash to PATH |
| `bun run typecheck` | PASS, exit 0 |
| `bun run plugins/build.ts --check` | PASS, snapshots current |
| Integration file set: 68 files | 675 pass, 6 fail, 8 skip |
| Security subset: 11 files | 175 pass, 1 fail, 0 skip |
| E2E file set: 3 files | 42 pass, 0 fail, 1 skip |
| Four public site builds | PASS; four separate output-path assertions fail on Windows |

Security files are included in integration counts. Do not add those rows together.
Across integration and e2e: 71 files, 717 pass, 6 fail, 9 skip.
Tests run sequentially, one fresh Bun process per file, with the package scripts' conditions and timeouts.
This avoids this host's process-memory accumulation. No test or assertion changes.
The monolithic package commands are not claimed as passing.

The per-file commands are:

```sh
bun test --conditions eliza-source --timeout 120000 <integration-file>
bun test --conditions eliza-source --timeout 180000 <e2e-file>
```

The file list comes from tracked test files under `deploy`, `packages`, `sites`, and `tests/e2e`.
The security subset is the explicit list in `package.json`'s `security` script.
The local database uses UTF-8 and UTC, with canonical migrations applied.
PostgreSQL settings: `shared_buffers=32MB`, `work_mem=1MB`, `maintenance_work_mem=16MB`.
The full simulation command was:

```sh
bun --smol run --conditions eliza-source scripts/sim.ts --json runs/sim-final.json
```

This runs the same full simulation entry point as `bun run sim`, with Bun's lower-memory runtime option.
Its only failure was the unchanged deploy-guard test: `Executable not found in $PATH: "bash"`.
Add the existing Git installation's `bin` directory to PATH, then repeat only `--only audit` with the same database setup.
That block passes all 16 gates. This changes only the test environment, not source code or deploy authorization.

All six failures also occur on the unchanged base with the same setup:

| File | Failures | Base and final behavior |
|---|---:|---|
| `deploy/backend/backend.test.ts` | 1 | SIGTERM produces exit code 143; the test expects zero |
| `deploy/wrangler.integration.test.ts` | 1 | Hardcoded `/bin/bash` is absent on native Windows |
| `sites/test/sites.test.ts` | 4 | Built-file paths use Windows separators; assertions expect POSIX paths |

The same five files were compared on base and final, including both affected Slop integration files.
The six failing assertions match. Neither final Slop integration file fails.
`slop-block-target.integration.test.ts` passes 1/1; `slop-date-path.integration.test.ts` passes 3/3.

Eight skipped JUnit records belong to the opt-in profile cleanup reconciliation suite.
It needs `NETWORK_RETRY_RECONCILIATION_TEST=1` and an explicitly supplied synthetic database.
That unrelated suite was not enabled. The count includes two unnamed JUnit records.
The other skip is optional browser auth-feedback e2e: `PLAYWRIGHT_MODULE` is not configured.
Skipped cases are not presented as executed passes.

Upstream hosted CI has reported `action_required`, with no executed jobs.
The contributor later authorized fork Actions. Activation succeeded on 2026-10-29.
The original [Ubuntu 24.04 run](https://github.com/miracle2044/thenetwork/actions/runs/40834482440) never obtained runners.
Its first attempt waited about 15 minutes. One retry also remained queued.
Both attempts were cancelled before any test step ran. Neither is counted as test evidence.

An independent [Ubuntu 22.04 run](https://github.com/miracle2044/thenetwork/actions/runs/40836688774) tries another hosted runner pool.
The validation branch is `ci/slop-budget-linux22`; workflow commit: `24acf3607490917f9f249edd7d28320064022efa`.
It differs from source `f422e5b7e130623ae482c9e777994d8b2a5b1347` only in `.github/workflows/ci.yml`.
Both jobs use Ubuntu 22.04 and explicitly check out that source commit.
Test commands, pinned actions, Bun version, PostgreSQL image, empty provider keys and permissions remain the same.
The validation branch is not part of this PR.
Current observed status: `queued`. No Linux CI pass is claimed while no runner has executed tests.
No deployment workflow, paid model or live-send path was invoked.

## llm_evidence

The repository asks for real-model qualification. It remains unexecuted.
The operator explicitly declined paid-model access and did not supply test credentials.
Test provider/model: none. Requests: zero. Request settings: N/A. Provider cost: zero.
These results prove deterministic assignment after scoring, using real engine execution.
They do not prove model-backed behavior or replace real-model qualification with mock responses.

## agent_clients

N/A for changed client flows: no signup, MCP, OAuth, gateway or client workflow changes.
No multi-client signup qualification was performed or claimed.
Local validation used Codex desktop `26.1023.6123.0`, verified from the installed Windows package.
Contribution provider: OpenAI. Exact model supplied by the operator: `gpt-6.1-sol`.
This contribution model is separate from the repository's unexecuted model qualification.

## Limits

The gate covers three seeds, two algorithms, two round modes and two budget histories.
It does not prove live messaging outcomes or human match quality.
Required real-model qualification and a supported Linux CI run remain outstanding.
The six reproduced base failures remain unchanged.
All data is synthetic. No deployment, live send or model charge was performed.
