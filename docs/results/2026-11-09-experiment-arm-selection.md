# Reject invalid experiment arm selections

Date: 2026-11-09. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for integration and e2e.

## Requirement and cause

This is a reproduced simulation-validation defect under the approved Slop scope
and CONTRIBUTING section 3.1. PRD 34.3 requires reproducible simulator comparisons.
The three supported arms and the `--only` option are specified in
`docs/runbook-simulation.md`, section 3.1.

The experiment CLI cast unchecked strings to the arm union. A misspelled name,
such as `consnet` or `push-baseline`, reached `runArm`, ran a world and returned
exit 0 with that name in the result. Unknown names enter the ConsentNetwork
branch but do not enable the default plan-aware personas or the capital wiring.
This can produce a comparison under a name that does not identify a supported
configuration. An empty option instead selected all three default arms.

Validate the entire selected list before the first call to `runArm` and before
changing `PRIMED_MODEL`. Reject unknown names and empty segments with exit 2,
an error listing the allowed names, and no result JSON. Only an absent `--only`
uses the default list. Names must match exactly; whitespace is not normalized.
Valid names keep their order, repetition and existing configuration.

Alternatives considered:

1. Validate each call inside `runArm`. That also affects its typed API and lets
   an earlier valid arm run before a later invalid name is found.
2. Replace the arm branches with a registry of configuration factories. That
   reorganizes the simulation setup; this defect only needs CLI preflight.

PR #355 fixes a different entry point, `scripts/sim.ts`, which selects gate
blocks. This PR fixes the three-arm comparison CLI used by the Observatory lab.

## measurement

The committed integration case launches real CLI subprocesses against the
synthetic NYC dataset. It covers 11 malformed argument lists and two valid
comparisons at seed 1 for two days. The valid comparisons run all three arms,
then request `consent,push_baseline` and compare their complete result objects
with the default run. At least one proposal must occur. There are no mocks.

```sh
bun test --conditions eliza-source packages/network/test/experiment-cli.integration.test.ts
```

The same final test on the base fails at the first malformed selector:
0 pass, 1 fail, 1 assertion, 3,487.77 ms. With the fix: 1 pass, 0 fail,
17 assertions, 12,403.85 ms. It takes longer after the fix because the test
reaches all invalid cases and the valid comparisons.

The wider measurement uses the program below from each checkout. Each command
uses the real CLI, PolicyPersonaAgent, matching implementation and judge.
The dataset starts with 250 synthetic NYC personas; growth may add members.
Consent arms use the simulated reviewer (`review: "auto"`).

- Eleven malformed commands at seed 1, two days. On base they all exit 0 and
  run 20 unintended arms. After the fix all exit 2 before any arm starts,
  emit no JSON and print the arm diagnostic.
- Four default comparisons at seeds 13, 17, 23 and 31, each for 14 days.
- Four consent comparisons at those seeds with time awareness, live-ask
  filtering and capital enabled.
- Three individual-arm commands, an ordered subset, repeated valid arms and
  the plans-off/sim-plans-on configuration, all at seed 13 for 14 days.

The comparison includes 14 valid commands with 24 complete arm results per
revision. It compares every parsed output field and each command's SHA-256
output fingerprint. There are no wall-clock fields in these result objects;
none are removed. Stderr timings are excluded. This is an exact deterministic
comparison, not a statistical estimate of matching quality.

| Measurement | Before | After |
|---|---:|---:|
| Malformed commands returning success | 11/11 | 0/11 |
| Unintended arms executed by those commands | 20 | 0 |
| Valid commands with identical complete output | 14 | 14 |
| Valid arm result objects | 24 | 24, identical |
| Proposals across those results | 3,465 | 3,465 |
| Meetings held across those results | 667 | 667 |

The 24 results include repeated controls at seed 13; they are not 24 independent
samples. Ending populations range from 250 to 267.

## safety_gates

The 24 valid results retain zero canary leaks and zero minor contacts. They also
retain all 12 existing invariant findings across seven result objects:

| Command / arm | Findings on both revisions |
|---|---|
| default-13 / push_baseline | `over_budget`: 1 |
| default-17 / push_baseline | `decliner_exposed`: 2 |
| default-23 / push_baseline | `decliner_exposed`: 3; `over_budget`: 1 |
| default-31 / push_baseline | `over_budget`: 1 |
| default-31 / consent | `decliner_exposed`: 2 |
| single-push_baseline / push_baseline | `over_budget`: 1 |
| ordered / push_baseline | `over_budget`: 1 |

All other valid result objects have zero invariant findings. The comparison
asserts equality of the complete judge objects, including their examples.
These held-out findings are not counted as passing safety assertions.

The official Network block separately passes 61/61 blocking gates on both
revisions, with zero tracked gates off target. All 63 gate records, including
fingerprints and details, match after removing only each gate's elapsed `ms`.
The block uses its pinned seeds: seed 3 for the 10-day invariants world,
seeds 1-3 for the 21-day arm comparison, plus its scenarios and conformance runs.
Wall time: 172.6 seconds before, 169.3 seconds after.

```sh
bun run sim --only network --json ../experiment-arms-gates-before.json
# In the changed checkout:
bun run sim --only network --json ../experiment-arms-gates-after.json
```

The full simulation was not repeated: AGENTS.md permits one full run per agent,
which was already used for PR #355. That older full-run result is not claimed
as validation of this change. The affected Network block was run fresh.

## Validation

All commands ran with provider keys and live-send/deploy flags cleared.
Integration and e2e used the isolated local PostgreSQL cluster on port 54339
with `REQUIRE_PG=1`; the test harness creates and drops its own databases.

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | 50 installs across 44 packages checked; no changes |
| `bun run typecheck` | All four configurations pass |
| CLI regression | 1 pass, 0 fail; 17 assertions |
| `bun run sim --only network` | 61/61 blocking gates before and after; 63 identical records excluding `ms` |
| `bun run test:integration` | 676 pass, 8 skip, 6 known baseline failures; 13,758 assertions; 454.88 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 34.39 seconds |

The CLI regression also passes inside the official integration command in
13,512.18 ms. The security suite is included in that command's file set.
The six failures match the previously reproduced unchanged-base failures in
both test identity and cause: one Wrangler test cannot spawn `/bin/bash` on
Windows, the backend shutdown test receives SIGTERM exit 143 instead of 0,
and four site-build assertions expect forward-slash paths on Windows.
No new integration failure occurred; a completely green local suite is not
claimed. Eight optional cleanup-reconciliation cases and one optional browser
SDK e2e case were skipped. No browser-driven result is claimed.

## llm_evidence

N/A: selector validation and these policy-persona comparisons do not call a
model. Real-model calls: 0; cost: $0. `--live-asks` filters synthetic wants;
it is not a live-LLM flag. No model-backed behavior is claimed.

## agent_clients

N/A: this changes a developer CLI, not a member-facing agent workflow.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2. Provider: OpenAI; exact assistant
model identifier unavailable in this session. No other client was tested.
No browser or computer use was performed.

## Limits

The guard is at the CLI boundary. It does not change matching, judge rules,
numeric options, repeated-flag parsing, or the typed `runArm` API. Existing
invariant findings in the comparison controls are listed above. No claim
is made that all possible seeds are free of findings. No UI changes, live
sends, production data or deployments are involved.

## Reproduce the measurement

Save the first program as `experiment-arms-measure.ts` outside the checkout.
Save the second as `experiment-arms-compare.ts`. Run the same programs from
base and changed checkouts that have the repository dependencies installed.
Clear provider keys and live-send/deploy flags in the test environment first.
The programs do not print environment values or raw messages.

```sh
# From base:
bun run ../experiment-arms-measure.ts ../experiment-arms-before.json
# From the changed checkout:
bun run ../experiment-arms-measure.ts ../experiment-arms-after.json
# After the two Network gate runs above:
bun run ../experiment-arms-compare.ts ../experiment-arms-before.json ../experiment-arms-after.json ../experiment-arms-gates-before.json ../experiment-arms-gates-after.json
```

Measurement program, authored for this report:

```ts
import { createHash } from "node:crypto";

const cwd = process.cwd();
const output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");
const rows: unknown[] = [];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function run(id: string, valid: boolean, seed: number, days: number, args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source",
    "packages/network/harness/experiment.ts", "--days", String(days), "--seed", String(seed), ...args],
  { cwd, stdout: "pipe", stderr: "pipe", timeout: 120_000 });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  const result = stdout.trim() ? JSON.parse(stdout) : null;
  if (valid && exit !== 0) throw new Error(`${id}: ${exit}: ${stderr}`);
  if (!valid && ![0, 2].includes(exit)) throw new Error(`${id}: unexpected exit ${exit}: ${stderr}`);
  rows.push({ id, valid, seed, days, args, exit,
    started: [...stderr.matchAll(/^.*: \d+ms$/gm)].length,
    diagnostic: stderr.match(/^unknown arm: .*$/m)?.[0] ?? null,
    outputHash: result === null ? null : hash(result), result });
  console.error(`${id}: exit ${exit}; ${result?.results.length ?? 0} arms`);
}
const invalid = [
  ["--only", "consnet"], ["--only", "push-baseline"], ["--only", "constructor"],
  ["--only", "consent,missing"], ["--only", "missing,consent"],
  ["--only", ""], ["--only="], ["--only", ","],
  ["--only", "consent,"], ["--only", ",consent"], ["--only", " "],
];
for (let i = 0; i < invalid.length; i++) await run(`invalid-${i}`, false, 1, 2, invalid[i]!);
for (const seed of [13, 17, 23, 31]) {
  await run(`default-${seed}`, true, seed, 14, []);
  await run(`options-${seed}`, true, seed, 14,
    ["--only", "consent", "--time-aware", "--live-asks", "--capital"]);
}
for (const arm of ["push_baseline", "push_v2", "consent"]) {
  await run(`single-${arm}`, true, 13, 14, ["--only", arm]);
}
await run("ordered", true, 13, 14, ["--only", "consent,push_baseline"]);
await run("duplicates", true, 13, 14, ["--only", "consent,consent"]);
await run("plans-off", true, 13, 14, ["--only=consent", "--plans", "off", "--sim-plans", "on"]);
const revision = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdout: "pipe", stderr: "pipe" });
const [sha, gitExit] = await Promise.all([new Response(revision.stdout).text(), revision.exited]);
if (gitExit !== 0) throw new Error("Cannot identify checkout");
await Bun.write(output, JSON.stringify({ revision: sha.trim(), rows }, null, 2) + "\n");
```

Comparison program (throws on a changed valid result or gate):

```ts
import { isDeepStrictEqual } from "node:util";

const before = await Bun.file(process.argv[2]!).json();
const after = await Bun.file(process.argv[3]!).json();
const beforeGates = await Bun.file(process.argv[4]!).json();
const afterGates = await Bun.file(process.argv[5]!).json();
const gateResults = (report: any) => report.gates.map(({ ms, ...result }: any) => result);
if (!isDeepStrictEqual(gateResults(beforeGates), gateResults(afterGates))) throw new Error("Gate results differ");
if (before.rows.length !== 25 || after.rows.length !== 25) throw new Error("Expected 25 commands per revision");
const invalid = after.rows.filter((r: any) => !r.valid);
const controls = after.rows.filter((r: any) => r.valid);
for (const row of after.rows) {
  const previous = before.rows.find((r: any) => r.id === row.id);
  if (!previous || !isDeepStrictEqual([row.args, row.days, row.seed, row.valid],
    [previous.args, previous.days, previous.seed, previous.valid])) throw new Error(`${row.id}: inputs differ`);
  if (row.valid && !isDeepStrictEqual(row, previous)) throw new Error(`${row.id}: valid result changed`);
  if (!row.valid && (row.exit !== 2 || row.started !== 0 || row.result !== null || !row.diagnostic)) {
    throw new Error(`${row.id}: invalid selector was not rejected before dispatch`);
  }
}
const arms = controls.flatMap((r: any) => r.result.results.map((a: any) => ({ case: r.id, ...a })));
const safety = arms.filter((a: any) => a.judge.invariants || a.judge.minorContacts || a.judge.canaryLeaks)
  .map((a: any) => ({ case: a.case, arm: a.arm, judge: a.judge }));
const beforeInvalid = before.rows.filter((r: any) => !r.valid);
const summary = {
  identicalGateRecords: afterGates.gates.length,
  blockingGates: afterGates.gates.filter((g: any) => g.blocking).length,
  gateFailures: afterGates.gates.filter((g: any) => !g.pass).length,
  commandsPerRevision: after.rows.length,
  invalidCommands: invalid.length,
  invalidSuccessBefore: beforeInvalid.filter((r: any) => r.exit === 0).length,
  invalidSuccessAfter: invalid.filter((r: any) => r.exit === 0).length,
  unintendedArmRunsBefore: beforeInvalid.reduce((n: number, r: any) => n + r.started, 0),
  unintendedArmRunsAfter: invalid.reduce((n: number, r: any) => n + r.started, 0),
  identicalValidCommands: controls.length,
  identicalValidArmResults: arms.length,
  controlSeeds: [...new Set(controls.map((r: any) => r.seed))],
  controlDays: [...new Set(controls.map((r: any) => r.days))],
  memberCounts: [...new Set(arms.map((a: any) => a.members))],
  proposals: arms.reduce((n: number, a: any) => n + a.proposals, 0),
  meetingsHeld: arms.reduce((n: number, a: any) => n + a.meetingsHeld, 0),
  canaryLeaks: arms.reduce((n: number, a: any) => n + a.judge.canaryLeaks, 0),
  minorContacts: arms.reduce((n: number, a: any) => n + a.judge.minorContacts, 0),
  invariantFindings: arms.reduce((n: number, a: any) => n + a.judge.invariants, 0),
  unchangedSafetyFindings: safety,
};
console.log(JSON.stringify(summary, null, 2));
```
