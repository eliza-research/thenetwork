# Reject invalid Slop evaluation presets

Date: 2026-11-10 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement and reproduced defect

CONTRIBUTING 3.1 accepts reproduced defects in simulation validation.
PRD 34.1 defines the Slop evaluation and safety gates.
The preset interface reproduces the experiments documented in `docs/results/2026-10-08-slop-pack.md`.
For example, that report uses `--preset it4held`, `it4tune`, and `it4bias`.

A misspelled preset silently omits the requested experiment variants.
The command can exit successfully and overwrite a previous JSON report with incomplete results.

```sh
bun run --conditions eliza-source packages/sim/src/apps/slop/packEval.ts --arms random --preset it5biass --seeds 1 --weeks 1 --per-city 20 --json result.json
```

Before: exit 0, a baseline table, and JSON containing only `random`.
After: exit 2, an unknown-preset diagnostic with the registered names, no table, and no report write.

## Cause and fix

`PRESETS[p] ?? []` silently substitutes an empty variant list for an unknown name.
The same behavior occurs for an empty or missing argument.
Inherited object names instead reach an unrelated iteration error.

Check all requested names with `Object.hasOwn` before expanding presets or running arms.
Reject unknown names with exit 2 and list the supported names.
Quoted values make an empty or whitespace argument visible; a missing value prints `<missing>`.
All existing preset definitions, ordering, repetitions, explicit variants, and custom arm labels retain their behavior.

Other implementations considered:

1. Warn and continue. This still produces incomplete experiment evidence and a successful exit.
2. Replace the table and argument reader with a Map or parser package. That changes more interfaces than this defect requires.

The fix adds no helper, dependency, model call, gate, threshold, or matching rule.

## measurement

The single new integration case runs the real CLI in child processes.
It executes the native random baseline and actual Slop engine variants without mocks.
It checks 11 invalid argument lists, a baseline control, a valid preset, a repeated preset, and an explicit variant with a preset.
It checks exit status, report creation, diagnostics, arm selection, ordering, and complete control results.

Regression command:

```sh
bun test --conditions eliza-source packages/sim/test/slop-presets.integration.test.ts
```

Before: 0 pass, 1 fail, 1 assertion, 72.10 ms for the case.
After: 1 pass, 0 fail, 21 assertions, 1399.39 ms for the case.
The exact final test failed on unchanged base production code before the fix.

The broader paired capture runs the same 102 actual CLI invocations on each revision.
It uses seeds 1, 7, and 11 separately, two weeks, and 40 generated personas per city.
No world or population overrides are supplied.
There are 20 valid configurations per seed: all 15 registered presets, no preset, repeated and combined presets, an explicit variant, and a custom arm label.
There are 14 invalid configurations per seed: misspellings, casing, whitespace, missing values, inherited names, mixed valid/invalid selections, and an existing report.

| Check | Before | After |
|---|---|---|
| 42 invalid commands | 30 successful exits; 12 inherited-name iteration errors | 42 explicit exit-2 refusals |
| Existing reports on invalid input | Three overwrites | Zero overwrites |
| 60 valid commands | 504 native arm executions | All complete JSON and stdout byte-identical |

All 15 registered presets were exercised on each seed. Valid configurations include repeated and combined presets, explicit variants, and a custom arm label.

The comparison requires byte-identical full JSON and stdout for every valid command.
This includes every metric and `extra` field, arm order, seed, table, and printed gate result.
Elapsed timings on stderr are excluded.
Invalid commands must exit 2, produce no stdout, start no baseline arm, and preserve an existing report or leave no output file.
The same seeded native simulations supply both sides; no generated or mocked expected metrics are used.
These are deterministic paired checks, so no confidence interval is claimed.
Repeated configurations are deliberate compatibility checks, not independent samples of matching quality.

## safety_gates

Fresh `bun run sim --only slop` runs passed 39/39 blocking gates on both revisions.
All 57 semantic records match: 39 blocking and 18 tracked, including eight existing tracked results below target.
Only elapsed time is excluded. Base: 35.4s; candidate: 35.9s.
The normal pack inputs are seeds 13-16, four weeks, and 300 personas per city. The live-style arm uses seeds 21-22 for 30 days.

The unchanged gate fingerprints cover the normal random and Slop arms.
The block also runs its engine conformance and live-style simulation checks.
No model provider is called by these offline simulations.

| Tracked check | Unchanged result |
|---|---|
| gate Minor contacts (age liars) cut vs random (>= 90%) | 76.5% |
| gate Adversary contacts cut (scammers, harassers, age liars) (>= 90%) | 45.4% |
| gate Second-date rate vs random (and >= 20%) (>= 2.5x) | 1.733 |
| gate Second dates per seed vs random (>= 2x) | 1.676 |
| gate Lowest group vs overall (man:gay) (>= 0.7x) | 0.506 |
| gate Same, feasible members (man:gay) (>= 0.7x) | 0.603 |
| gate Back-outs at reveal (< 10%) | 0.122 |
| slop-live style: probe texts that break the Network's style rules (target 0) | 4 of 342 (too_long) |

All complete safety objects in the 60 valid CLI captures match before and after.
Selected totals across these 504 arm executions (including repeated configurations) are unchanged:

- minorContacts: 0
- undisclosedMinorContacts: 169
- undisclosedMinorProposals: 958
- adversaryProposals: 3427
- adversaryContacts: 651
- harmsReported: 181

The research presets include intentional ablations and random baselines.
Their existing adverse outcomes are not evidence of launch readiness.
The fix concerns requested experiment selection; it does not improve those outcomes or waive any gate.

## Validation

Fresh validation on the final code:

- Frozen install: 50 installs checked across 44 packages, unchanged.
- Typecheck: all four configurations passed.
- Integration, including security: 676 pass, 8 skip, 6 known failures; 13,762 assertions.
- The new regression passed in the official integration command in 1441.26 ms.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions.
- Integration: 690 tests across 69 files, 453.72s. End-to-end: 43 tests across 3 files, 47.64s.

Integration skips (including two distinct unnamed cases):

- isolated PostgreSQL completed cleanup reconciliation > (unnamed)
- isolated PostgreSQL completed cleanup reconciliation > V2 exact retry returns the original counts after profile removal and newer batches without any mutation
- isolated PostgreSQL completed cleanup reconciliation > V1 exact retry returns its original retention result after later edits without rerunning cleanup
- isolated PostgreSQL completed cleanup reconciliation > changed completed identity hash operation cutoff nonce and stale proof deny without touching either protocol
- isolated PostgreSQL completed cleanup reconciliation > legacy and partial completions deny while the canonical runtime receipt ACL remains SELECT INSERT only
- isolated PostgreSQL completed cleanup reconciliation > post-write owner loss rolls profile data and completion receipts back together for V1 and V2
- isolated PostgreSQL completed cleanup reconciliation > concurrent cross-app owners sharing one V1 nonce commit once and roll the losing profile back
- isolated PostgreSQL completed cleanup reconciliation > (unnamed)

End-to-end skip:

- failed security checks give recovery feedback and a later SDK success clears only that feedback

All six integration failures match the established base failures by test name and diagnostic:
one missing `/bin/bash` executable, one SIGTERM exit 143 versus 0, and four Windows path assertions.
No new failure appeared. A fully green integration suite is not claimed.
The integration command includes every security-suite file.
The isolated PostgreSQL cluster used port 54339 and stopped after validation with zero remaining client connections.
The full simulation was not repeated: AGENTS.md permits one full run per agent, already used on PR #355.
This change received fresh paired runs of its affected Slop block.

## llm_evidence

N/A: preset selection is deterministic CLI dispatch and does not use a model.
Real-model calls: 0. Cost: $0. Test provider/model: none.
No model-backed behavior is claimed.

## agent_clients

N/A: this changes a developer evaluation command, with no member-facing agent flow.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2 on Windows. No other client is claimed as tested.
The exact assistant model identifier is unavailable; attribution uses the disclosure helper's supported `unavailable` value.
No browser or computer use was performed.

## Limits

Preset names remain case-sensitive and exact; surrounding whitespace is rejected.
Repeated valid presets continue to produce repeated variant groups.
This does not introduce new command-line flag syntax or validate unrelated argument types.
Custom arm labels remain supported by `runArm`.
The small paired runs check selection and preservation of behavior, not the statistical quality of every research preset.
The normal Slop gates use their full pinned population and durations.

## Reproduce the paired evidence

Save the programs below outside two checkouts: current main and this candidate.
Install the frozen dependencies in both checkouts.
Clear live-send, deploy, and provider variables as required by AGENTS.md.
Run these commands with Bun 1.4.2; paths are placeholders for local checkouts.

```sh
bun run --conditions eliza-source preset-measure.ts BASE preset-before.json
bun run --conditions eliza-source preset-measure.ts CANDIDATE preset-after.json
bun run preset-compare.ts preset-before.json preset-after.json
# From BASE, then CANDIDATE:
bun run sim --only slop --json ../preset-gates-before.json
bun run sim --only slop --json ../preset-gates-after.json
# From the programs directory:
bun run preset-gates-compare.ts preset-gates-before.json preset-gates-after.json
```

### preset-measure.ts

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2]!), output = resolve(process.argv[3]!);
const { PRESETS } = await import(pathToFileURL(join(root, "packages/sim/src/apps/slop/packEval.ts")).href);
const names = Object.keys(PRESETS);
const controls = [
  { id: "no-preset", args: [], expected: ["random"] },
  ...names.map(p => ({ id: p, args: ["--preset", p], expected: ["random", ...PRESETS[p].map(([n]: [string, object]) => n)] })),
  { id: "repeated", args: ["--preset", "it5bias", "--preset", "it5bias"], expected: ["random", ...PRESETS.it5bias.map(([n]: [string, object]) => n), ...PRESETS.it5bias.map(([n]: [string, object]) => n)] },
  { id: "combined", args: ["--preset", "it4bias", "--preset", "it5bias"], expected: ["random", ...PRESETS.it4bias.map(([n]: [string, object]) => n), ...PRESETS.it5bias.map(([n]: [string, object]) => n)] },
  { id: "explicit-variant", args: ["--variant", "{}", "--variant-name", "manual", "--preset", "it5bias"], expected: ["random", "manual", ...PRESETS.it5bias.map(([n]: [string, object]) => n)] },
  { id: "custom-arm", args: [], arms: "custom-pack", expected: ["custom-pack"] },
];
const invalid = [
  ...["it5biass", "", " ", "IT5BIAS", "it5bias ", "constructor", "toString", "hasOwnProperty", "__proto__"].map(p => ({ id: `name:${JSON.stringify(p)}`, args: ["--preset", p] })),
  { id: "missing", args: ["--preset"] },
  { id: "next-flag", args: ["--preset", "--groups"] },
  { id: "valid-then-invalid", args: ["--preset", "it5bias", "--preset", "it5biass"] },
  { id: "invalid-then-valid", args: ["--preset", "it5biass", "--preset", "it5bias"] },
  { id: "existing-report", args: ["--preset", "it5biass"], sentinel: "previous evaluation\n" },
];
const dir = mkdtempSync(join(tmpdir(), "preset-measure-"));
const records = [];
try {
  for (const seed of [1, 7, 11]) for (const [kind, cases] of [["control", controls], ["invalid", invalid]] as const) {
    for (const c of cases) {
      const out = join(dir, `${records.length}.json`);
      const sentinel = "sentinel" in c ? c.sentinel : undefined;
      if (sentinel) await Bun.write(out, sentinel);
      const args = ["run", "--conditions", "eliza-source", "packages/sim/src/apps/slop/packEval.ts", "--arms", "arms" in c ? c.arms! : "random",
        "--seeds", String(seed), "--weeks", "2", "--per-city", "40", "--json", out, ...c.args];
      const child = Bun.spawn([process.execPath, ...args], { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      const file = Bun.file(out), jsonText = await file.exists() ? await file.text() : null;
      if (kind === "control") {
        assert.equal(exit, 0, `${c.id} seed ${seed}: ${stderr}`);
        assert.deepEqual(JSON.parse(jsonText!).map((r: any) => r.arm), (c as typeof controls[number]).expected);
      }
      records.push({ id: c.id, kind, seed, args: c.args, exit, stdout, stderr, jsonText, sentinel });
    }
    console.error(`${kind} seed ${seed}: ${cases.length} complete`);
  }
  await Bun.write(output, JSON.stringify({ presets: names, records }, null, 2));
  console.log(JSON.stringify({ presets: names.length, controls: controls.length * 3, invalid: invalid.length * 3 }));
} finally {
  if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith("preset-measure-")) throw new Error("Unexpected temporary directory");
  rmSync(dir, { recursive: true, force: true });
}
```

### preset-compare.ts

```ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
assert.deepEqual(after.presets, before.presets);
assert.equal(before.presets.length, 15);
assert.equal(before.records.length, 102);
assert.equal(after.records.length, 102);
const controls = [], refusals = [], safety: Record<string, number> = {};
let armExecutions = 0, invalidSuccessesBefore = 0, overwrittenBefore = 0;
for (let i = 0; i < before.records.length; i++) {
  const b = before.records[i], a = after.records[i];
  assert.deepEqual([a.id, a.kind, a.seed, a.args], [b.id, b.kind, b.seed, b.args]);
  if (a.kind === "control") {
    assert.equal(a.exit, 0);
    assert.equal(a.exit, b.exit);
    assert.equal(a.stdout, b.stdout, `${a.id} seed ${a.seed}: stdout`);
    assert.equal(a.jsonText, b.jsonText, `${a.id} seed ${a.seed}: full result`);
    const results = JSON.parse(a.jsonText);
    for (const r of results) for (const m of r.metrics) {
      armExecutions++;
      for (const [field, value] of Object.entries(m.safety)) if (typeof value === "number") safety[field] = (safety[field] ?? 0) + value;
    }
    controls.push({ id: a.id, seed: a.seed, arms: results.length, sha256: createHash("sha256").update(a.jsonText).digest("hex") });
  } else {
    assert.equal(a.exit, 2);
    assert.equal(a.stdout, "");
    assert.equal(a.jsonText, a.sentinel ?? null);
    assert(a.stderr.includes("unknown preset:") && a.stderr.includes("known:"));
    assert(!/random: \d/.test(a.stderr));
    if (b.exit === 0) invalidSuccessesBefore++;
    if (b.sentinel && b.jsonText !== b.sentinel) overwrittenBefore++;
    refusals.push({ id: a.id, seed: a.seed, beforeExit: b.exit, afterExit: a.exit });
  }
}
assert.equal(controls.length, 60);
assert.equal(refusals.length, 42);
assert.equal(safety.minorContacts, 0);
console.log(JSON.stringify({ presetCount: 15, controls: controls.length, invalid: refusals.length, armExecutions,
  invalidSuccessesBefore, invalidSuccessesAfter: 0, overwrittenBefore, overwrittenAfter: 0, safety, controlHashes: controls, refusals }, null, 2));
```

### preset-gates-compare.ts

```ts
import assert from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const semantic = ({ ms, ...rest }: any) => rest;
assert.deepEqual(before.blocks, ["slop"]);
assert.deepEqual(after.blocks, ["slop"]);
assert.equal(before.gates.length, 57);
assert.equal(after.gates.length, 57);
assert.equal(after.gates.filter((g: any) => g.blocking).length, 39);
assert(after.gates.filter((g: any) => g.blocking).every((g: any) => g.pass));
assert.deepEqual(after.gates.map(semantic), before.gates.map(semantic));
const offTarget = after.gates.filter((g: any) => !g.pass);
assert.equal(offTarget.length, 8);
assert(offTarget.every((g: any) => !g.blocking));
console.log(JSON.stringify({ gates: 57, blocking: 39, tracked: 18, unchanged: 57, blockingFailed: 0,
  offTarget: offTarget.map(semantic), baseSeconds: before.total, candidateSeconds: after.total }, null, 2));
```

## Raw artifact SHA-256

Capture files remain local.

- preset-before.json: `3263cf392bc6e4eb38a06240b97c7a42436f2940119bd97a860dcbe44e4171b0`
- preset-after.json: `8bbff6c1bb793b39d54f4d87f6818133e775d5f96a05ad1bd5aaf6429923f099`
- preset-gates-before.json: `6deb4c8022e142643d7d7cccbb95c6a22b64e61f94f95bba706d58447d879f0a`
- preset-gates-after.json: `2cb15a0ce2060039bf6ececf7fc9a86793f8ad36e69a66bfdc19d32a929ca1a8`
