# Reject malformed Observatory report seeds

Date: 2026-11-10. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Problem and requirement

The Observatory report command accepts malformed seed text, runs a world, and exits successfully. NaN and infinities serialize as `world.seed: null`; empty or whitespace-only arguments silently become seed zero. The report no longer identifies the numeric configuration the caller asked to run.

Reproduction on base:

```sh
bun run --conditions eliza-source packages/observatory/src/report.ts --personas 80 --days 2 --seed=NaN
bun run --conditions eliza-source packages/observatory/src/report.ts --personas 80 --days 2 --seed=
```

Both exit 0 and print complete reports. The first reports a null seed; the second reports zero. This is a reproduced simulation-validation defect under CONTRIBUTING 3.1 and PRD 34.3 (determinism and replay) / 34.4 (simulation measurements).

## Cause and fix

The command used unchecked `Number(a.seed)` both when creating `GameSource` and when writing the report. Validate the original text and converted number before world initialization, then reuse the validated number in both places. Empty text and nonfinite values exit 2 with `--seed must be a finite number` and no report. Omitted seed 1 and all previously supported finite numbers retain their behavior.

Falling back to another seed would still silently change the requested experiment. Restricting seeds to positive integers would reject working zero, negative and fractional seeds. Changing the shared RNG or GameSource API would broaden the change to other callers and supported seed types. The guard belongs at this CLI's numeric argument boundary.

PR #437 validates this command's mode selectors. PRs #396 and #432 validate the distinct world and experiment CLIs. None covers this report seed path; this branch starts independently from main. Other report options, RNG behavior and matching logic are unchanged.

## measurement

One integration case launches the actual command and native worlds without substituting the generator, network, engine or timer. It rejects nine invalid strings and preserves nine default/finite controls.

| Same regression | Base | Candidate |
|---|---:|---:|
| Passing / failing cases | 0 / 1 | 1 / 0 |
| Assertions reached | 1 | 18 |
| Case duration | 271.01 ms | 3,600.00 ms |

The base fails on the explicit empty seed because it exits 0 with a seed-zero report. All invalid arguments exit 2 with the diagnostic and empty stdout after the fix. Valid controls check the returned seed, population and duration after the actual world finishes.

The independent paired measurement below executes the same 88 CLI invocations on each revision:

- 48 valid seven-day worlds: seeds 1, 7, 11 and 23; 80 initial generated personas; all 12 combinations of engine-v1/random/off, consent/stub and auto/human review.
- Four two-day worlds using the default committed dataset (250 NYC members), one per seed.
- Nine two-day finite/default syntax controls: omitted seed, explicit 1, 0, -7, 1.5, 1e2, 0x10, +9 and whitespace surrounding 3; 80 generated personas.
- 27 invalid invocations: empty, whitespace, NaN, both infinities, both overflow signs, nonnumeric text and a comma-separated value, each in default, human-review and random/stub modes; two days and 80 personas.

| Paired result | Before | After |
|---|---:|---:|
| Invalid invocations exiting successfully | 27 / 27 | 0 / 27 |
| Invalid reports with a null seed | 21 | 0 |
| Blank seeds silently reported as zero | 6 | 0 |
| Valid complete reports unchanged | reference | 61 / 61 |

The comparator removes only `world.wallMs`, then compares each entire valid report and command result. It retains engine-run summaries, population counts, review counters, proposals, oracle assessments, member metrics, learned graph, scoreboard and judge output. It does not claim to compare raw world records or private persona memories, which this CLI does not output. These are exact deterministic results; no statistical improvement is claimed. Seeds 7, 11 and 23 were not used to design the guard.

## safety_gates

All 61 valid reports retain zero judge invariants, canary leaks and minor contacts. Oracle assessments are also unchanged: 22 reports contain 106 oracle-unsafe proposals in total. Those proposals remain explicitly unsafe; zero judge counts do not turn them into safe proposals. The complete reports, including all these findings, compare identically.

Fresh `bun run sim --only audit,ops`: 30 blocking gates and one tracked check pass on both revisions. All 31 gate records match after excluding per-gate durations and the backup restore duration in its label. Base: 25 seconds; candidate: 25.2 seconds.

The guard does not change dispatch, matching, review decisions, thresholds or gate classifications. The repository's AGENTS.md permits at most one full `bun run sim` per agent; that allowance was used earlier in this contribution session. This change has fresh audit/operations runs and paired actual report workflows, not a fresh all-block simulation run.

## Validation

Windows, Bun 1.4.2, PostgreSQL 16.15 on isolated localhost port 54339, `REQUIRE_PG=1`. Frozen installation made no dependency changes. Live-send, deployment and provider flags were cleared. The measurements use synthetic local data.

- Typecheck: all four configurations passed.
- Integration, including the security suite: 676 pass, 8 skip, 6 fail; 13,759 assertions. Ran 690 tests across 69 files. [460.69s]
- The new regression passed in the official integration command in 3670.12 ms.
- The six failures match the baseline by name and cause: missing /bin/bash, SIGTERM exit 143 versus 0, and four Windows path assertions.
- The eight optional integration skips match the preceding completed run.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions. Ran 43 tests across 3 files. [36.20s]
- The optional browser SDK case was skipped. The isolated database was stopped after validation.

A fully green local integration suite is not claimed.

## llm_evidence and agent_clients

Live model behavior is N/A for this numeric CLI guard and was not tested. The measured reports run native policy personas and the repository's deterministic local matching path: model requests 0, cost $0. No mocked LLM responses are used. Live persona enrichment, judges and member-facing agent clients are not claimed as qualified.

Codex desktop 26.1103.7773.0 drove the CLI and local validation with Bun 1.4.2 on Windows. Contribution provider: OpenAI; exact contribution model metadata is unavailable. No browser or computer use was used. No other client is claimed as tested.

## Reproduce

Run after `bun install --frozen-lockfile`, with the isolated local PostgreSQL environment for the broad checks:

```sh
bun test --conditions eliza-source packages/observatory/test/report-seed.integration.test.ts
bun run typecheck
bun run sim --only audit,ops --json ../report-seed-gates.json
bun run test:integration
bun run test:e2e
```

For the failing baseline case, copy only the new integration file into a clean base checkout. Expect its first assertion to fail. On the candidate, expect one passing case with 18 assertions. Remove the copied file from the baseline after the red check.

Save the two programs below beside separate base and candidate checkouts, then run from their parent directory:

```sh
bun run report-seed-measure.ts ./base report-seed-before.json
bun run report-seed-measure.ts ./candidate report-seed-after.json
bun run report-seed-compare.ts report-seed-before.json report-seed-after.json report-seed-comparison.json
```

The hand-written programs orchestrate actual CLI subprocesses; the worlds and reports are generated by native code. Raw generated reports remain local. Expected summary: 61 identical valid reports, 27 successful invalid commands before and zero after, with 21 null-seed reports and six blank-to-zero reports eliminated.

### Paired measurement program

```ts
import { resolve } from "node:path";
const [rootArg, output] = process.argv.slice(2), root = resolve(rootArg!);
const observations: any[] = [];
async function run(id: string, args: string[], valid: boolean) {
  const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/observatory/src/report.ts", ...args], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 30_000);
  try {
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    let report;
    try { report = JSON.parse(out); delete report.world.wallMs; } catch {}
    observations.push({ id, args, valid, exit, outputEmpty: out.trim() === "", diagnostic: err.includes("--seed must be a finite number"), report });
  } finally { clearTimeout(timer); }
}
for (const seed of [1, 7, 11, 23]) {
  for (const engine of ["engine-v1", "random", "off"]) for (const network of ["consent", "stub"]) for (const review of ["auto", "human"]) {
    await run(`modes:${seed}:${engine}:${network}:${review}`, ["--personas", "80", "--days", "7", `--seed=${seed}`, "--engine", engine, "--network", network, "--review", review], true);
  }
  await run(`dataset:${seed}`, ["--days", "2", `--seed=${seed}`], true);
  console.log(`completed valid modes and dataset seed ${seed}`);
}
for (const seed of [undefined, "1", "0", "-7", "1.5", "1e2", "0x10", "+9", " 3 "]) {
  await run(`syntax:${seed === undefined ? "default" : JSON.stringify(seed)}`, ["--personas", "80", "--days", "2", ...(seed === undefined ? [] : [`--seed=${seed}`])], true);
}
for (const seed of ["", " ", "NaN", "Infinity", "-Infinity", "1e309", "-1e309", "not-a-seed", "1,2"]) {
  for (const mode of ["default", "human", "stub"]) {
    const extra = mode === "human" ? ["--review", "human"] : mode === "stub" ? ["--network", "stub", "--engine", "random"] : [];
    await run(`invalid:${JSON.stringify(seed)}:${mode}`, ["--personas", "80", "--days", "2", `--seed=${seed}`, ...extra], false);
  }
}
await Bun.write(output!, JSON.stringify(observations, null, 2));
console.log(JSON.stringify({ observations: observations.length, valid: observations.filter(x => x.valid && x.exit === 0).length,
  invalidSuccess: observations.filter(x => !x.valid && x.exit === 0).length }));
```

### Complete-report comparison program

```ts
import { strict as assert } from "node:assert";
const [beforePath, afterPath, output] = process.argv.slice(2);
const before = await Bun.file(beforePath!).json(), after = await Bun.file(afterPath!).json();
assert.equal(before.length, 88); assert.equal(after.length, 88);
let unchanged = 0, rejected = 0, nullBefore = 0, zeroBefore = 0;
for (let i = 0; i < before.length; i++) {
  const a = before[i], b = after[i];
  for (const key of ["id", "args", "valid"]) assert.deepEqual(a[key], b[key]);
  assert.equal(a.exit, 0);
  if (a.valid) { assert.deepEqual(a, b); unchanged++; }
  else {
    assert.equal(b.exit, 2); assert.equal(b.outputEmpty, true); assert.equal(b.diagnostic, true); assert.equal(b.report, undefined); rejected++;
    if (a.report.world.seed === null) nullBefore++; else if (a.report.world.seed === 0) zeroBefore++; else assert.fail("unexpected invalid baseline seed");
  }
}
const valid = after.filter((r: any) => r.valid);
const result = { unchangedValidReports: unchanged, invalidSuccessBefore: rejected, invalidSuccessAfter: 0,
  nullSeedReportsBefore: nullBefore, blankSeedZeroReportsBefore: zeroBefore,
  validReportsWithExistingSafetyFindings: valid.filter((r: any) => r.report.judge.invariants || r.report.judge.canaryLeaks || r.report.judge.minorContacts).length,
  unchangedSafetyTotals: {
    invariants: valid.reduce((s: number, r: any) => s + r.report.judge.invariants, 0),
    canaryLeaks: valid.reduce((s: number, r: any) => s + r.report.judge.canaryLeaks, 0),
    minorContacts: valid.reduce((s: number, r: any) => s + r.report.judge.minorContacts, 0),
  } };
await Bun.write(output!, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
```
