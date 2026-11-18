# Reject invalid experiment CLI seeds

Date: 2026-11-09 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.
Scope: reproduced simulation-validation defect, CONTRIBUTING 3.1 and PRD 34.3 (determinism and replay).

## Problem and cause

The experiment CLI accepts `--seed not-a-seed`, runs the NYC world, prints a normal report, and exits 0.
It also accepts NaN, infinity, numeric overflow, and empty values.
A failed numeric conversion therefore looks like a successful experiment.

The CLI passed `Number(a.seed)` directly to each arm without validation.
JavaScript converts an empty or whitespace-only string to zero and invalid numeric text to NaN.
The simulator then receives these values as seeds.
This report does not equate the resulting worlds with seed zero: different helpers use the seed differently.

## Fix and alternatives

Convert the argument once, then reject blank text and non-finite numbers before applying overrides or running any arm.
Print `--seed must be a finite number` and exit 2.
Pass the validated number to every selected arm.

Keep the default seed 1 and all existing finite numeric conversions.
Zero, negative numbers, fractions, hexadecimal, exponential notation, and numbers larger than 32 bits remain accepted.
The typed `runArm` API keeps its current behavior.

Alternatives considered:

1. Substitute a default seed after conversion fails. This would continue reporting success for an invalid experiment configuration.
2. Require an unsigned 32-bit integer. This would reject finite seed inputs that the CLI already accepts.
3. Change the shared random-number generator. That affects other callers and still cannot distinguish empty CLI text from explicit zero.

PR #396 validates a separate entry point, `packages/sim/src/cli.ts`.
PR #426 validates experiment arm names. Neither validates this experiment seed argument.

## measurement

Use the same 24 real CLI commands on base and candidate.
Each command starts a separate Bun process and runs the actual NYC dataset, Network, engine, persona policies, and judge.
There are no replacement worlds or mocked arm results.

Dataset: `data/synthetic/v1/manifest.json`.
SHA-256: `30a54c830194ba8f0a970d07d942d5f35438109c9f098a33b7e0d19a460ae3e9`.

| Check | Before | After |
|---|---|---|
| Invalid seed commands rejected before an arm completes | 0/9 | 9/9, exit 2 |
| Arm results produced from invalid seeds | 11 | 0 |
| Valid commands returning success | 15/15 | 15/15 |
| Valid command JSON, compared byte for byte | Reference | 15/15 identical |
| Valid arm reports, including every metric and judge field | Reference | 19/19 identical |
| Omitted seed versus explicit seed 1 | Identical | Identical |
| Final regression on base versus candidate | 0 pass, 1 fail | 1 pass, 0 fail; 16 assertions |

The nine invalid lists cover nonnumeric text, NaN, positive and negative infinity, overflow, empty and whitespace-only values, and a numeric prefix.
Both `--seed VALUE` and `--seed=VALUE` are exercised.
The NaN command selects the default three arms; the other invalid commands select consent.

The 15 valid commands cover:

- All three default arms at two days, with omitted seed and explicit seed 1.
- Two-day consent runs with `0`, `-7`, `1.5`, `0x10`, `1e2`, padded `23`, `1e100`, and `4294967296`.
- Fourteen-day consent runs on seeds 1, 11, and 23.
- Seed 7 with time-aware personas, live asks, and capital enabled.
- Seed 3 with plans off, simulator plans on, max-new zero, and explicit primed probabilities.

The last two commands run for two days.
The comparison checks stdout SHA-256 and full parsed JSON equality for every valid command.
Elapsed-time diagnostics are on stderr and are excluded from that equality check.
All 19 valid arm reports have zero judge invariants, canary leaks, and minor contacts on both revisions.
These are deterministic input checks, not an estimate of a population effect; no confidence interval applies.

The final regression failed on base in 3.51 seconds and passed on candidate in 28.06 seconds.
It is one integration case with real subprocesses, nine invalid argument lists, the default control, and six finite input controls.
Each child has a 30-second deadline; the complete case has 120 seconds.

An initial validation draft used `--seed -7`, which the existing argument parser rejects as ambiguous.
The final commands use its supported `--seed=-7` form. That initial draft is excluded from the paired measurements.

## safety_gates and validation

`bun install --frozen-lockfile`: 50 installs checked, no changes.
`bun run typecheck`: all four configurations pass.

Run the affected block in both checkouts:

```sh
bun run sim --only network --json <scratch>/gates.json
```

Base: 61/61 blocking gates pass, zero tracked off target, 207.9 seconds.
Candidate: 61/61 blocking gates pass, zero tracked off target, 205.6 seconds.
All 63 gate records retain their names, pass states, classifications, details, and fingerprints.
The comparison excludes only each gate's elapsed-time `ms` field; it asserts equality for every other field.
Use separate output paths and the included gate comparator:

```sh
bun run <scratch>/experiment-seed-gates-compare.ts <scratch>/gates-before.json <scratch>/gates-after.json
```

The full simulation was not repeated: AGENTS.md permits at most one full run per agent, already used for PR #355.
The fresh evidence above covers the affected Network block and the real experiment CLI.

`bun run test:integration`: 676 pass, 8 skip, 6 fail; 13,757 assertions across 69 files, 471.87 seconds.
The new regression passed inside this official suite in 27.75 seconds.
The suite includes all security test files.
The six failures match the recorded base failures by test name and diagnostic cause:

- Wrangler: `/bin/bash` is unavailable on Windows (`ENOENT`, `uv_spawn`).
- Backend shutdown: SIGTERM produces exit 143, while the assertion expects 0.
- Four site build assertions expect slash-separated paths; Windows returns backslash-separated paths.

The eight skipped integration cases match the previous baseline skip set.
This is not a fully green integration suite; no new failure was introduced.

`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions across three files, 34.32 seconds.
The skipped case requires the optional browser SDK environment. Browser acceptance is not claimed.

Live-send and deploy flags were disabled. Validation used an isolated PostgreSQL cluster on port 54339.
After every test process finished, the database had zero active clients and was stopped.

## llm_evidence

N/A: this change validates CLI input before simulation dispatch and changes no model-backed behavior.
The experiment uses deterministic policy personas and the simulated reviewer (`review: "auto"`).
Real-model calls: 0. Cost: $0. Test provider/model: none.

## agent_clients

N/A: no member-facing agent workflow changes. The tested interface is the Bun CLI.
Codex desktop 26.1103.4239.0 drove the commands with OpenAI assistance.
The exact assistant model identifier was not exposed; the disclosure uses the helper's supported `unavailable` value.
No browser or computer use was performed. No other client is claimed as tested.

## Reproduce

Run this command on both revisions:

```sh
bun run --conditions eliza-source packages/network/harness/experiment.ts --days 2 --only consent --seed not-a-seed
```

Base prints experiment JSON and exits 0. Candidate prints the seed diagnostic, emits no JSON, and exits 2.
Run the regression on candidate:

```sh
bun test --conditions eliza-source packages/network/test/experiment-seed.integration.test.ts
```

Expect one passing case with 16 assertions.
For the paired measurement, save the scripts below outside the checkout.
Run the measurement from each checkout, writing stdout to separate JSONL files.
The comparison takes those two paths as arguments.

```sh
bun run <scratch>/experiment-seed-measure.ts > <scratch>/before.jsonl
bun run <scratch>/experiment-seed-measure.ts > <scratch>/after.jsonl
bun run <scratch>/experiment-seed-compare.ts <scratch>/before.jsonl <scratch>/after.jsonl
```

The first command runs in the base checkout; the second runs in the candidate checkout.
The following scripts are hand-written measurement code.

### experiment-seed-measure.ts

```ts
import { createHash } from "node:crypto";

const cases: { id: string; invalid?: boolean; args: string[] }[] = [
  ...[
    ["--seed", "not-a-seed"], ["--seed=NaN"], ["--seed=Infinity"], ["--seed=-Infinity"],
    ["--seed", "1e999"], ["--seed", ""], ["--seed="], ["--seed", "   "], ["--seed", "1oops"],
  ].map((seed, i) => ({ id: `invalid-${i + 1}`, invalid: true,
    args: ["--days", "2", ...(i === 1 ? [] : ["--only", "consent"]), ...seed] })),
  { id: "default", args: ["--days", "2"] },
  { id: "explicit-default", args: ["--days", "2", "--seed=1"] },
  ...["0", "-7", "1.5", "0x10", "1e2", " 23 ", "1e100", "4294967296"]
    .map((seed, i) => ({ id: `finite-${i + 1}`, args: ["--days", "2", "--only", "consent", `--seed=${seed}`] })),
  ...[1, 11, 23].map(seed => ({ id: `consent-14d-${seed}`,
    args: ["--days", "14", "--only", "consent", `--seed=${seed}`] })),
  { id: "time-aware-capital", args: ["--days", "2", "--only", "consent", "--seed", "7",
    "--time-aware", "--live-asks", "--capital"] },
  { id: "planner-options", args: ["--days", "2", "--only", "consent", "--seed=3",
    "--plans", "off", "--sim-plans", "on", "--max-new", "0",
    "--primed-met", "0.9", "--primed-partial", "0.8", "--primed-identity", "0.9"] },
];
for (const c of cases) {
  const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source",
    "packages/network/harness/experiment.ts", ...c.args],
    { cwd: process.cwd(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 120_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    const report = stdout.trim() ? JSON.parse(stdout) : null;
    console.log(JSON.stringify({ ...c, exit, started: [...stderr.matchAll(/^(\w+): \d+ms$/gm)].map(m => m[1]),
      diagnostic: stderr.includes("--seed must be a finite number"),
      stdoutSha256: createHash("sha256").update(stdout).digest("hex"), report }));
    console.error(`${c.id}: exit ${exit}; ${report?.results?.length ?? 0} arms`);
  } finally { clearTimeout(timer); }
}
```

### experiment-seed-compare.ts

```ts
import { strict as assert } from "node:assert";

const read = async (path: string) => (await Bun.file(path).text()).trim().split(/\r?\n/).map(line => JSON.parse(line));
const before = await read(process.argv[2]);
const after = await read(process.argv[3]);
assert.equal(before.length, 24);
assert.equal(after.length, before.length);
let rejectedBefore = 0, rejectedAfter = 0, invalidArmsBefore = 0, validCommands = 0, validArms = 0;
const safety: unknown[] = [];
for (let i = 0; i < before.length; i++) {
  const b = before[i], a = after[i];
  assert.equal(a.id, b.id);
  assert.deepEqual(a.args, b.args);
  if (b.invalid) {
    assert.equal(b.exit, 0, b.id);
    assert.ok(b.report.results.length > 0, b.id);
    invalidArmsBefore += b.report.results.length;
    rejectedBefore += Number(b.exit !== 0 && b.report === null && !b.started.length);
    assert.deepEqual({ exit: a.exit, report: a.report, started: a.started, diagnostic: a.diagnostic },
      { exit: 2, report: null, started: [], diagnostic: true }, a.id);
    rejectedAfter++;
  } else {
    assert.equal(b.exit, 0, b.id);
    assert.equal(a.exit, 0, a.id);
    assert.equal(a.stdoutSha256, b.stdoutSha256, a.id);
    assert.deepEqual(a.report, b.report, a.id);
    assert.deepEqual(a.started, b.started, a.id);
    assert.equal(a.diagnostic, false, a.id);
    validCommands++;
    validArms += a.report.results.length;
    safety.push({ id: a.id, arms: a.report.results.map((r: any) => ({ arm: r.arm, judge: r.judge })) });
  }
}
for (const rows of [before, after]) {
  assert.equal(rows.find(r => r.id === "default").stdoutSha256,
    rows.find(r => r.id === "explicit-default").stdoutSha256);
}
assert.equal(rejectedAfter, 9);
assert.equal(validCommands, 15);
assert.equal(validArms, 19);
console.log(JSON.stringify({ commandsPerRevision: before.length, rejectedBefore, rejectedAfter,
  invalidArmsBefore, invalidArmsAfter: 0, identicalValidCommands: validCommands,
  identicalValidArmResults: validArms, safety }, null, 2));
```

### experiment-seed-gates-compare.ts

```ts
import { strict as assert } from "node:assert";

const before = await Bun.file(process.argv[2]).json();
const after = await Bun.file(process.argv[3]).json();
const semantic = (gates: any[]) => gates.map(({ ms, ...gate }) => gate);
assert.deepEqual(semantic(after.gates), semantic(before.gates));
for (const report of [before, after]) {
  assert.equal(report.gates.filter((g: any) => g.blocking && !g.pass).length, 0);
  assert.equal(report.gates.filter((g: any) => !g.blocking && !g.pass).length, 0);
}
console.log(JSON.stringify({ identicalGateRecords: after.gates.length,
  blockingPassed: after.gates.filter((g: any) => g.blocking && g.pass).length,
  trackedOffTarget: 0, beforeSeconds: before.total, afterSeconds: after.total }, null, 2));
```
