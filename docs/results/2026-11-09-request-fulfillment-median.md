# Report the median request fulfillment duration

Date: 2026-11-09 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for integration and end-to-end validation.

## Problem, scope and implementation

The experiment report overstates the median request fulfillment duration when an even cohort has different middle values.
Seed 1, 14 days, produces 28 fulfilled people requests through the native ConsentNetwork.
The middle durations are 70 hours 5 minutes and 89 hours 5 minutes.
Their median is 79 hours 35 minutes, or 80 hours in the report's existing whole-hour format.
The report instead selects the upper middle value and prints 89 hours.

This is a reproduced simulation-reporting defect under the approved scope and CONTRIBUTING 3.1.
PRD 34 and the MVP validation plan require simulations that measure real behavior.
This changes `requestMedianHours` in the experiment harness; it does not change when requests are fulfilled.

Keep the existing sorted fulfilled-request durations and whole-hour rounding.
For an even cohort, average its two middle values before rounding.
Odd cohorts still use the middle value; empty cohorts still return `null`.
The push-baseline arm still omits this consent-specific field.

Alternatives considered:

1. Introduce a shared statistics helper and migrate other reports. That expands a correction needed by one caller into a refactor.
2. Return a fractional median. That changes the existing whole-hour output contract unnecessarily.

The existing median fixes in PRs #277 and #310 concern different Slop metrics and files.
PR #426 validates experiment arm names at the CLI entry point. This change has no dependency on that PR.

## measurement

One integration case runs the real experiment harness, PolicyPersonaAgent, ConsentNetwork, simulator, and existing synthetic NYC dataset.
No requests, outcomes, model responses, or result functions are replaced.
It derives durations from native request-open and fulfillment event timestamps, independently of the returned summary.
It verifies the 28-request cohort, both middle durations, and the expected rounded median.

```sh
bun test --conditions eliza-source packages/network/test/experiment-median.integration.test.ts
```

Before: 0 pass, 1 fail, 2 assertions; 13.91 seconds.
The failure is the reported median, 89 instead of 80; both event-derived middle durations match.
After: 1 pass, 0 fail, 2 assertions; 15.20 seconds.

The separate paired measurement runs ten native experiments per revision:

- Consent: seeds 1, 2, 3, 11 and 23 for 14 days; seed 1 for 2 days; seed 11 for 21 days.
- Push-v2: seeds 1 and 11 for 14 days.
- Push baseline: seed 1 for 14 days.

Each run starts with the existing 250 synthetic NYC members and uses the harness's default settings.
Consent growth remains enabled; ending populations range from 250 to 272.
The synthetic manifest SHA-256 is `30a54c830194ba8f0a970d07d942d5f35438109c9f098a33b7e0d19a460ae3e9`.
Initial exploration also checked seeds 1-3 at 2, 14 and 21 days; only seed 1 at 14 days exposed this defect.
Seeds 11 and 23 were not used to select the fix.

| Arm | Seed | Days | Fulfilled requests | Before median hours | After median hours |
|---|---:|---:|---:|---:|---:|
| consent | 1 | 14 | 28 | 89 | 80 |
| consent | 2 | 14 | 21 | 70 | 70 |
| consent | 3 | 14 | 23 | 69 | 69 |
| consent | 11 | 14 | 25 | 68 | 68 |
| consent | 23 | 14 | 27 | 49 | 49 |
| consent | 1 | 2 | 0 | null | null |
| consent | 11 | 21 | 39 | 76 | 76 |
| push_v2 | 1 | 14 | 27 | 49 | 49 |
| push_v2 | 11 | 14 | 20 | 91 | 91 |
| push_baseline | 1 | 14 | N/A | omitted | omitted |

Correct request medians: 8/9 before, 9/9 after.
The sample contains 210 completed request durations: two even cohorts, six odd cohorts and one empty cohort.
Nine complete reports remain identical, including the even cohort whose rounded result was already correct.
All ten record hashes and all other result fields remain identical.

The scripts below record only aggregate results, durations and hashes, not conversation bodies.
Record hashes exclude only the generated run ID on `run_start` and elapsed wall time on `run_end`.
All other run-record fields remain in the hash.
The reference median uses raw millisecond differences before whole-hour rounding, rather than the log's already-rounded `hours` field.
This is deterministic metric correctness evidence, not a statistical claim about matching quality or faster fulfillment.

## safety_gates

All ten judge results remain identical before and after.
The nine consent and push-v2 runs have zero invariant violations, canary leaks and minor contacts.
The push-baseline control retains one pre-existing `over_budget` violation, with zero canary leaks and minor contacts.
This known baseline finding is not hidden or presented as a clean safety run.
`bun run sim --only network --json <path>` passes 61/61 blocking gates on both revisions, with zero tracked misses.
All 63 gate records match exactly, including both fingerprints and all safety details.
The run took 195.6 seconds before and 179.9 seconds after; timing is not an improvement claim.
Pinned checks include the invariant world at seed 3, ten days; consent seeds 1-3 and push seed 1, 21 days;
all NYC scenarios; simulator scenarios at pass^3; and pack conformance seeds 1-4.

Native consent and push-v2 runs use the harness's simulated reviewer.
No matching, review, send, consent, safety, gate threshold, or gate classification changes.
All people are synthetic. Provider and live-send flags were unset; no live sends or deployment occurred.

## Validation and limits

`bun install --frozen-lockfile`: 50 installs checked, no dependency changes.
`bun run typecheck`: all four configurations pass.
The paired Network runs pass 61/61 blocking gates and preserve all 63 gate records.

`bun run test:integration`: 676 pass, 8 skip, 6 fail; 13,743 assertions across 69 files, 450.43 seconds.
This includes all security-suite files and the new regression, which passes in 13.61 seconds.
The six failures match the previously reproduced base failures by test name and error cause:

- Wrangler OS-session test: `/bin/bash` is absent on Windows (`ENOENT`, `uv_spawn`).
- Backend boot test: the SIGTERM child exit is 143; the assertion expects 0.
- Four site artifact tests: Windows path separators do not match the slash-separated `.well-known/agent-skills/index.json` assertion.

`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions, 34.45 seconds.
The optional browser SDK case is skipped; browser acceptance is not claimed.
Database tests use the isolated PostgreSQL cluster on port 54339, with `REQUIRE_PG=1`.
The cluster is stopped after validation and after checking for zero remaining client connections.

The full simulation was not repeated. AGENTS.md allows at most one full run per agent, already used earlier in this contribution session.
The affected Network block runs before and after with the same pinned seeds and scenarios.
No evidence from an earlier PR is presented as fresh validation of this change.

This report retains the existing definition of a fulfilled request.
It does not change request eligibility, fulfillment timestamps, rounding precision, or any member workflow.

## llm_evidence

N/A: this calculation consumes completed simulator state and makes no model call.
Real-model calls: 0; cost: $0. No model-backed behavior is claimed.

## agent_clients

N/A: this is a developer experiment report, with no changed member-facing agent flow.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2. No other client is claimed as tested.
OpenAI provided the assistant; its exact model identifier was unavailable.
No browser or computer use was performed.

## Reproduce the paired measurement

Save the two TypeScript blocks below outside the checkout as `request-median-measure.ts` and `request-median-compare.ts`.
Run the measurement from each checkout, using the same script and frozen dependencies:

```sh
# From a clean checkout of the base revision:
bun run --conditions eliza-source ../request-median-measure.ts ../request-median-before.json
bun run sim --only network --json ../request-median-gates-before.json
# From the fixed revision:
bun run --conditions eliza-source ../request-median-measure.ts ../request-median-after.json
bun run sim --only network --json ../request-median-gates-after.json
bun run ../request-median-compare.ts ../request-median-before.json ../request-median-after.json ../request-median-gates-before.json ../request-median-gates-after.json
```

```typescript
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const { runArm } = await import(pathToFileURL(`${process.cwd()}/packages/network/harness/experiment.ts`).href);
const output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cases = [
  ...[1, 2, 3, 11, 23].map(seed => ({ arm: "consent", seed, days: 14 })),
  { arm: "consent", seed: 1, days: 2 },
  { arm: "consent", seed: 11, days: 21 },
  ...[1, 11].map(seed => ({ arm: "push_v2", seed, days: 14 })),
  { arm: "push_baseline", seed: 1, days: 14 },
];
const rows = [];
for (const c of cases) {
  let records: any[] = [];
  const result = await runArm(c.arm, { days: c.days, seed: c.seed, onRecords: (r: any[]) => records = r });
  const logs = records.filter(r => r.type === "network_log");
  const opened = new Map(logs.filter(r => r.kind === "request" && r.detail.kind === "people").map(r => [r.detail.requestId, r.t]));
  const durations = logs.filter(r => r.kind === "request_result" && r.detail.outcome === "fulfilled")
    .map(r => {
      const at = opened.get(r.detail.requestId);
      if (typeof at !== "number") throw new Error(`Missing request start: ${r.detail.requestId}`);
      return r.t - at;
    }).sort((a, b) => a - b);
  const middle = durations.slice(Math.floor((durations.length - 1) / 2), Math.floor(durations.length / 2) + 1);
  const expected = durations.length ? Math.round(middle.reduce((a, b) => a + b, 0) / middle.length / 3_600_000) : null;
  const normalized = records.map(r => {
    if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
    if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
    return r;
  });
  const row = { ...c, fulfilled: durations.length, durationsMs: durations, expected,
    records: records.length, recordHash: hash(normalized), result };
  rows.push(row);
  console.error(JSON.stringify({ ...c, fulfilled: row.fulfilled, expected, actual: result.requestMedianHours ?? null }));
}
const git = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
const [revision, exit] = await Promise.all([new Response(git.stdout).text(), git.exited]);
if (exit !== 0) throw new Error("Cannot read revision");
await Bun.write(output, JSON.stringify({ revision: revision.trim(), rows }, null, 2) + "\n");
```

```typescript
import assert from "node:assert/strict";

const [beforePath, afterPath, beforeGatesPath, afterGatesPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !beforeGatesPath || !afterGatesPath) throw new Error("Pass before/after measurements and gate JSON paths");
const before = await Bun.file(beforePath).json(), after = await Bun.file(afterPath).json();
assert.equal(before.rows.length, 10);
assert.equal(after.rows.length, 10);
let beforeCorrect = 0, afterCorrect = 0, identicalControls = 0;
let odd = 0, empty = 0;
const changes = [];
for (let i = 0; i < before.rows.length; i++) {
  const a = before.rows[i], b = after.rows[i];
  const { requestMedianHours: oldMedian, ...oldRest } = a.result;
  const { requestMedianHours: newMedian, ...newRest } = b.result;
  assert.deepEqual({ ...a, result: oldRest }, { ...b, result: newRest });
  assert.deepEqual(a.result.judge, b.result.judge);
  if (a.arm === "push_baseline") {
    assert.equal(oldMedian, undefined); assert.equal(newMedian, undefined);
    assert.deepEqual(a, b); identicalControls++;
    continue;
  }
  assert.equal(newMedian, b.expected);
  if (a.fulfilled === 0) empty++;
  if (a.fulfilled % 2) odd++;
  if (oldMedian === a.expected) beforeCorrect++;
  if (newMedian === b.expected) afterCorrect++;
  if (oldMedian === newMedian) { assert.deepEqual(a, b); identicalControls++; }
  else changes.push({ arm: a.arm, seed: a.seed, days: a.days, fulfilled: a.fulfilled, before: oldMedian, after: newMedian });
}
assert.ok(changes.length > 0);
assert.ok(odd > 0 && empty > 0);
assert.equal(afterCorrect, 9);
const oldGates = (await Bun.file(beforeGatesPath).json()).gates;
const newGates = (await Bun.file(afterGatesPath).json()).gates;
const normalized = (gates: any[]) => gates.map(({ ms, ...rest }) => rest);
assert.equal(newGates.length, 63);
assert.equal(newGates.filter((g: any) => g.blocking).length, 61);
assert.ok(newGates.every((g: any) => g.pass));
assert.deepEqual(normalized(oldGates), normalized(newGates));
console.log(JSON.stringify({ runs: after.rows.length, requestMedians: 9, beforeCorrect, afterCorrect,
  identicalControls, odd, empty, changes, identicalRecordHashes: 10,
  identicalOtherResultFields: 10, identicalJudgeResults: 10,
  judges: after.rows.map((r: any) => ({ arm: r.arm, seed: r.seed, days: r.days, ...r.result.judge })),
  gates: { records: newGates.length, blocking: 61, failed: 0, identical: true } }, null, 2));
```
