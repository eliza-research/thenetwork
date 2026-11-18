# Reject invalid simulator population shares

Date: 2026-11-10. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Problem and scope

The world CLI accepted invalid population shares and returned successful simulation reports for a different population. With 80 personas, one day and seed 7, the defaults produced six adversaries and four honest minors. `--adversarial-rate=NaN` instead produced zero of both, exited 0 and reported zero invariant violations. `--minor-share=NaN` silently removed the honest minors. Nonfinite and out-of-range native disclosure rates likewise silently removed or saturated the private-disclosure canaries.

This is a reproduced simulation-validation defect under CONTRIBUTING 3.1 and PRD 34.3 (population generation and reproducible configuration) / 34.4 (invariants and privacy measurement). The sim README documents the population controls and the default honest-minor population. A successful run should not silently reinterpret an invalid share as an empty cohort.

The generator now rejects explicitly supplied `adversarialRate`, `minorShare` and `disclosureRate` unless they are finite numbers in [0, 1]. Validation happens before creating the RNG or population. The CLI preserves omitted defaults but converts empty or whitespace-only share arguments to an invalid value instead of silently treating them as a default or zero.

Central validation covers native generator callers too. A CLI-only check would miss those callers, including the population step used by LLM enrichment. Clamping or substituting a default would still run a population different from the requested configuration. Valid zero, one, fractional and omitted shares retain their existing behavior, including the minimum adversarial-kind allocation for positive rates in larger populations. Other numeric options and population-mix weights are outside this change.

## measurement

One integration case launches the actual world CLI, without replacing the generator, world, network or channel. It tests both share flags with `NaN`, positive/negative infinity, -0.01, 1.01, empty and whitespace-only arguments, and four valid controls. Equals syntax ensures negative values reach the share parser rather than being rejected as option names.

| Same regression on each revision | Before | After |
|---|---:|---:|
| Passing / failing cases | 0 / 1 | 1 / 0 |
| Assertions reached | 1 | 18 |
| Case duration | 110.34 ms | 1,324.58 ms |

The baseline fails immediately because `NaN` exits 0 and emits a full JSON report. The candidate exits 1 with a share-specific diagnostic and no report for every invalid CLI argument. The valid controls complete with 80 personas and zero invariant violations, canary leaks and minor contacts.

The independent paired program below runs 87 native configurations and 38 CLI invocations per revision:

- 72 valid native worlds: seeds 1, 7, 11 and 23; 12 and 80 personas; nine population configurations; seven days in NYC through native `World` and `ConsentNetwork` with automatic simulation review.
- Nine configurations: defaults; each of adversarial, minor and disclosure shares independently at zero or one; mixed shares 0.25/0.25/0.75; and all three at 0.01.
- 15 invalid native configurations: each of the three fields with NaN, both infinities, -0.01 and 1.01; seed 7, 80 personas, one day.
- 24 valid actual CLI reports: the same four seeds, 80 personas, one day; default, zero, one, mixed fractional and scientific-notation share arguments.
- 14 invalid actual CLI invocations: both exposed share flags with the five invalid numeric values, empty and whitespace-only values; seed 7.

| Paired result | Before | After |
|---|---:|---:|
| Invalid native configurations completing a world | 15 / 15 | 0 / 15 |
| Invalid CLI arguments reporting success | 14 / 14 | 0 / 14 |
| Valid native worlds identical to baseline | reference | 72 / 72 |
| Valid CLI reports identical to baseline | reference | 24 / 24 |

For every valid native world, the comparison checks the entire metric object and SHA-256 hashes of generated personas, records, channel messages and memories. Only run identifiers and the run-end wall-clock duration are excluded. Every valid CLI report is compared in full after removing its run identifier. These are exact deterministic comparisons, not a statistical matching-quality improvement.

## safety_gates

The broader valid-population matrix retains existing baseline safety failures: 17 of 72 native worlds have nonzero safety counts on both revisions, totaling 30 invariant violations, 28 minor contacts and zero canary leaks. All counts and detailed metric results are identical before and after; none of those worlds was dropped, reseeded or reclassified. This is evidence that valid population behavior is unchanged, not a safety qualification of those populations. The fix does not resolve those existing failures.

Fresh `bun run sim --only network,safety,audit,ops` results: all 108 blocking gates and three tracked gates pass on both revisions. All 111 gate records match after excluding per-gate `ms` and the backup restore duration in its label. Base took 217.6 seconds; candidate took 221.7 seconds.

| Block | Blocking passes | Tracked passes | Off target |
|---|---:|---:|---:|
| network | 61 | 2 | 0 |
| safety | 17 | 0 | 0 |
| audit | 16 | 0 | 0 |
| ops | 14 | 1 | 0 |

The repository's AGENTS.md permits at most one full `bun run sim` per agent. That allowance was used earlier in this contribution session. This change has fresh runs of the affected `network,safety,audit,ops` blocks on both revisions; no fresh all-block run is claimed. Gate thresholds and classifications are unchanged.

## Validation

Environment: Windows, Bun 1.4.2, PostgreSQL 16.15 on isolated localhost port 54339 with `REQUIRE_PG=1`. Frozen dependency installation completed. Live-send, deployment and model-provider flags were cleared for these runs. All data and messages were synthetic and local.

- Typecheck: all four configurations passed.
- Integration, including the security suite: 676 pass, 8 skip, 6 fail; 13,759 assertions. Ran 690 tests across 69 files. [423.49s]
- The new regression passed inside the official integration run in 1369.98 ms.
- The six failures match the base failure names and causes: missing /bin/bash, SIGTERM exit 143 versus 0, and four Windows path assertions.
- The eight optional integration skips match the preceding completed run.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions. Ran 43 tests across 3 files. [44.48s]
- The optional browser SDK case was skipped. The isolated database was stopped after validation.

A fully green local integration suite is not claimed.

## llm_evidence and agent_clients

Model-backed behavior was not changed or qualified. This fix rejects malformed numeric inputs before deterministic population generation; the native LLM-persona wrapper uses that generator before enrichment. No live model calls were made: provider/model for the measured workflows is N/A, requests 0 and cost $0. The recorded worlds use the native scripted persona path, not mocked LLM responses. Live persona enrichment, LLM judges and member-facing agent integrations remain untested by this report.

The CLI and local validation were driven through Codex desktop 26.1103.7773.0 using Bun 1.4.2 on Windows. Contribution provider: OpenAI; exact contribution model: unavailable in the runtime metadata. No other agent client or browser workflow is claimed as tested.

## Reproduce

Run from the corresponding revision after `bun install --frozen-lockfile`:

```sh
bun run --conditions eliza-source packages/sim/src/cli.ts --personas 80 --days 1 --seed 7 --no-log --json --adversarial-rate=NaN
bun test --conditions eliza-source packages/sim/test/population-shares.integration.test.ts
bun run typecheck
bun run sim --only network,safety,audit,ops --json ../population-shares-gates.json
bun run test:integration
bun run test:e2e
```

For the red regression, copy only the new integration case into a clean base checkout, run it, then remove the copied file. Its first assertion must fail there. On the candidate the same case must pass. The CLI reproduction must change from exit 0 with a report to exit 1 with no report and the finite-share diagnostic.

Save the two programs below alongside separate base and candidate checkouts. From their shared parent directory:

```sh
bun run --conditions eliza-source population-shares-measure.ts ./base population-shares-before.json
bun run --conditions eliza-source population-shares-measure.ts ./candidate population-shares-after.json
bun run population-shares-compare.ts population-shares-before.json population-shares-after.json population-shares-comparison.json
```

The programs are hand-written orchestration of the repository's actual generator, worlds and CLI. The populations, messages, metrics and hashes are generated by those native workflows. Raw run data stays local; only aggregate counts and the reproduction programs are included here.

### Paired measurement program

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [rootArg, output] = process.argv.slice(2), root = resolve(rootArg!);
const from = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { World, generatePersonas } = await from("packages/sim/src/index.ts");
const { ConsentNetwork } = await from("packages/network/src/index.ts");
const hash = (x: any) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const configs = [
  { id: "default", options: {} }, { id: "no_adversaries", options: { adversarialRate: 0 } },
  { id: "all_adversaries", options: { adversarialRate: 1 } }, { id: "no_minors", options: { minorShare: 0 } },
  { id: "all_honest_minors", options: { minorShare: 1 } }, { id: "no_disclosures", options: { disclosureRate: 0 } },
  { id: "all_honest_disclosures", options: { disclosureRate: 1 } },
  { id: "mixed", options: { adversarialRate: 0.25, minorShare: 0.25, disclosureRate: 0.75 } },
  { id: "small_shares", options: { adversarialRate: 0.01, minorShare: 0.01, disclosureRate: 0.01 } },
];
const invalid = [NaN, Infinity, -Infinity, -0.01, 1.01];
const native: any[] = [], cli: any[] = [];
async function runNative(id: string, seed: number, n: number, options: any, valid: boolean) {
  try {
    const personas = generatePersonas({ n, seed, cityWeights: { nyc: 1, sf: 0 }, ...options });
    const world = new World({ seed, personas, days: valid ? 7 : 1, network: new ConsentNetwork({ seed, review: "auto" }), writeLog: false });
    const result = await world.run();
    const records = result.records.map((r: any) => {
      if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
      if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
      return r;
    });
    const { runId, ...run } = result.metrics.run;
    native.push({ id, seed, n, valid, completed: true, populationHash: hash(personas), recordsHash: hash(records),
      channelHash: hash(world.channel.all()), memoriesHash: hash([...result.memories]),
      metrics: { ...result.metrics, run }, canaries: personas.filter((p: any) => p.hidden.privateDisclosure).length });
  } catch (error) { native.push({ id, seed, n, valid, completed: false, error: String((error as Error).message) }); }
}
for (const seed of [1, 7, 11, 23]) for (const n of [12, 80]) for (const c of configs) await runNative(c.id, seed, n, c.options, true);
for (const key of ["adversarialRate", "minorShare", "disclosureRate"]) for (const value of invalid) await runNative(`${key}:${value}`, 7, 80, { [key]: value }, false);
async function runCli(args: string[], seed: number, valid: boolean) {
  const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/sim/src/cli.ts", "--personas", "80", "--days", "1", "--seed", String(seed), "--no-log", "--json", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    let metrics;
    try { metrics = JSON.parse(out); delete metrics.run.runId; } catch {}
    cli.push({ args, seed, valid, exit, metrics, outputEmpty: out.trim() === "", diagnostic: err.includes("must be a finite number between 0 and 1") });
  } finally { clearTimeout(timer); }
}
const validArgs = [[], ["--adversarial-rate=0", "--minor-share=0"], ["--adversarial-rate=1"],
  ["--adversarial-rate=0", "--minor-share=1"], ["--adversarial-rate=.25", "--minor-share=.25"], ["--adversarial-rate=8e-2", "--minor-share=0.05"]];
for (const seed of [1, 7, 11, 23]) for (const args of validArgs) await runCli(args, seed, true);
for (const option of ["adversarial-rate", "minor-share"]) for (const value of [...invalid.map(String), "", " "]) await runCli([`--${option}=${value}`], 7, false);
await Bun.write(output!, JSON.stringify({ native, cli }, null, 2));
console.log(JSON.stringify({ native: native.length, completedNativeInvalid: native.filter(r => !r.valid && r.completed).length,
  validNativeCompleted: native.filter(r => r.valid && r.completed).length, cli: cli.length,
  invalidCliSuccess: cli.filter(r => !r.valid && r.exit === 0).length, validCliSuccess: cli.filter(r => r.valid && r.exit === 0).length,
  validSafetyFailures: native.filter(r => r.valid && r.completed && (r.metrics.invariants.total || r.metrics.privacy.canaryLeaks || r.metrics.safety.minorContacts)).length }));
```

### Exact comparison program

```ts
import { strict as assert } from "node:assert";
const [beforePath, afterPath, output] = process.argv.slice(2);
const before = await Bun.file(beforePath!).json(), after = await Bun.file(afterPath!).json();
assert.equal(before.native.length, 87); assert.equal(after.native.length, 87);
assert.equal(before.cli.length, 38); assert.equal(after.cli.length, 38);
let validWorlds = 0, nativeRefusals = 0, validCli = 0, cliRefusals = 0;
for (let i = 0; i < before.native.length; i++) {
  const a = before.native[i], b = after.native[i];
  for (const key of ["id", "seed", "n", "valid"]) assert.equal(a[key], b[key]);
  assert.equal(a.completed, true);
  if (a.valid) {
    assert.deepEqual(a, b); validWorlds++;
  } else { assert.equal(b.completed, false); assert.match(b.error, /must be a finite number between 0 and 1/); nativeRefusals++; }
}
for (let i = 0; i < before.cli.length; i++) {
  const a = before.cli[i], b = after.cli[i];
  for (const key of ["args", "seed", "valid"]) assert.deepEqual(a[key], b[key]);
  assert.equal(a.exit, 0);
  if (a.valid) { assert.deepEqual(a, b); validCli++; }
  else { assert.equal(b.exit, 1); assert.equal(b.outputEmpty, true); assert.equal(b.diagnostic, true); cliRefusals++; }
}
const valid = after.native.filter((r: any) => r.valid);
const result = { unchangedNativeWorlds: validWorlds, invalidNativeCompletedBefore: nativeRefusals, invalidNativeCompletedAfter: 0,
  unchangedCliReports: validCli, invalidCliSuccessBefore: cliRefusals, invalidCliSuccessAfter: 0,
  validWorldsWithExistingSafetyFailures: valid.filter((r: any) => r.metrics.invariants.total || r.metrics.privacy.canaryLeaks || r.metrics.safety.minorContacts).length,
  unchangedSafetyTotals: { invariants: valid.reduce((s: number, r: any) => s + r.metrics.invariants.total, 0),
    canaryLeaks: valid.reduce((s: number, r: any) => s + r.metrics.privacy.canaryLeaks, 0),
    minorContacts: valid.reduce((s: number, r: any) => s + r.metrics.safety.minorContacts, 0) } };
await Bun.write(output!, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
```
