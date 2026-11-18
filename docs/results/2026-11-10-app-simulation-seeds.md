# App simulation seed selection

Date: 2026-11-10 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, current main.
Candidate: this PR, branched from that base.
Runtime: Windows, Bun 1.4.2, PostgreSQL 16.15 for integration and end-to-end validation.

## Requirement and reproduced defect

A seed fixes a simulation's random choices.
PRD 34.3 requires seeded, replayable runs. CONTRIBUTING 3.1 accepts corrections to incorrect simulation validation.
The app CLIs must run the requested seeds so their reported comparisons can be reproduced.

The Peon, Friends, Slop baseline, and Slop pack CLIs split seed text at every minus sign.
They interpreted `-3` as the range from zero to three.
They interpreted `1e-3` as an empty range, although it is the finite number 0.001.
The range expansion also accepted missing parts or ignored extra parts.
Reversed and nonnumeric ranges could produce no runs.
Peon could then exit successfully and save an empty results file.
The other CLIs could print partial tables and fail later while formatting absent results.

Examples on the base revision:

```text
peon/cli.ts --seeds -3 --arms keyword --per-city 20 --jobs 5 --weeks 1
Exit 0; runs seed 0, seed 1, seed 2, seed 3.

peon/cli.ts --seeds 1e-3 --arms keyword --per-city 20 --jobs 5 --weeks 1
Exit 0; no runs; table values are NaN.

peon/cli.ts --seeds 3-1 --arms keyword --per-city 20 --jobs 5 --weeks 1
Exit 0; no runs; the JSON report is {"keyword":[]}.
```

## Fix and alternatives

Use one shared range parser in all four CLIs.
Read a complete finite number first, so numeric signs and exponent signs stay attached to that number.
Otherwise, recognize a separator only when both sides are complete finite numbers.
Require an ascending range with an array-representable number of unit steps.
Reject missing, nonnumeric, non-finite, reversed, and extra-component ranges before any world starts or report is written.

Keep existing defaults, zero, positive numeric forms, fractional unit-step ranges, and whitespace handling.
Friends keeps comma-separated lists, their order, and repeated seeds. Each list element must now be valid.
The other CLIs retain their single-seed or single-range interface.

The new helper replaces four copies of range expansion; it adds no dependency or new public package export.
No matcher, persona generator, RNG, world, metric, gate threshold, or model configuration changes.
No UI markup, style, or member-facing copy changes.

Alternatives considered:

1. Reject empty expanded arrays only. That still turns `-3` into four runs and silently ignores malformed list elements.
2. Require unsigned integers. Native simulations already accept finite negative and fractional seeds; that would reject usable inputs.
3. Duplicate sign-aware parsing in each CLI. A shared helper keeps all four consumers consistent and removes the duplicated expansion.

## Paired CLI and native-API measurement

The same measurement program ran on base and candidate.
It invoked real CLI subprocesses and independently called the existing native world APIs with explicitly listed expected seeds.
It did not use the new parser to calculate expected seeds.
All outcomes came from the repository's native app worlds. No matcher, model response, or CLI output was mocked.

Each CLI used four simulated weeks:

- Peon: keyword arm, 40 candidates and 10 jobs per city, realism v2.
- Friends: random arm, 80 personas, one weekly plan allowance.
- Slop baseline and Slop pack CLI: random arm, 40 personas per city.

There were 96 CLI invocations per revision and 75 cached native API results per revision.
Repeated requests reused each native reference result; Slop's two entry points have separate reference calls.
All 75 native reference results are identical before and after, including every safety field.

| Measure | Before | After |
|---|---:|---:|
| Numeric selections that match the requested native runs | 0 / 21 | 21 / 21 |
| Invalid selections that exit successfully | 20 / 38 | 0 / 38 |
| Invalid selections rejected at argument parsing | 0 / 38 | 38 / 38 |
| Existing valid controls matching their native references | 37 / 37 | 37 / 37 |
| Existing valid JSON reports and printed tables unchanged | baseline | 37 / 37 |
| Native reference results unchanged | baseline | 75 / 75 |

The 21 corrected selections cover `-3`, `1e-3`, `-3--1`, `-1e-3`, and `1e-3-2` in each CLI.
They also cover Friends' mixed list `-2,1e-3,2-3`.
The range `1e-3-2` selects 0.001 and 1.001, retaining the existing unit-step rule.
Twelve of these requests previously exited 0 with the wrong or empty result; nine failed while formatting empty data.

The invalid set covers blank text, `nope`, `NaN`, `Infinity`, `1e999`, `3-1`, `1-`, `-`, and `1-2-3` in each CLI.
Friends also checks `1,3-1` and `1,,2`, where the old parser silently ignored a range or inserted seed zero.
Previously, 18 invalid invocations already exited nonzero, but none gave the new early argument refusal.
The other 20 exited successfully. All 38 now fail with a `--seeds` diagnostic, empty stdout, and no JSON file.

The unchanged controls cover omitted defaults, zero, 7, 13-14, 2.5-3.5, hexadecimal 0x10, +2, padded `2 - 3`, and 1e2.
Friends also checks `3,1-2,3`, preserving list order and the repeated seed.
Every full JSON report and printed table matches before and after. No normalization was needed for those outputs.
Progress timings and error stacks on stderr are not compared byte for byte.

The comparator verifies complete native results, not just seed labels or row counts.
The three table CLIs also print the exact requested seed list; the Slop pack report carries that list as JSON.
This is exact selection and replay evidence, not a statistical quality improvement. No confidence interval is applicable.

## Safety evidence and limits

These measurements use the existing random and keyword baselines, including their existing hidden-age failures.
They do not establish safe matching quality or a passing launch configuration for those baselines.
The following totals cover the 75 native reference results, not a deduplicated population:

| Native entry | Reference results | Minor field (total) | Hidden-age contacts | Hidden-age proposals |
|---|---:|---|---:|---:|
| peon | 18 | `minorsMatched`: 0 | Not reported | Not reported |
| friends | 18 | `declaredMinorContacts`: 0 | 8 | Not reported |
| slop | 21 | `minorContacts`: 0 | 15 | 91 |
| slop-pack | 18 | `minorContacts`: 0 | 14 | 76 |

Hidden-age contact fields are Friends' `hiddenMinorContacts` and Slop's `undisclosedMinorContacts`; the proposal field is Slop's `undisclosedMinorProposals`.

Peon's `minorsMatched`, Friends' `declaredMinorContacts`, and Slop's `minorContacts` remain zero in every native reference result where they are reported.
The nonzero hidden-age counters shown above are present identically on the base and candidate APIs.
Corrected CLI requests select the intended native results; the matcher itself is unchanged.
The fixed-seed official gate comparison below checks the app packs' safety and quality values separately.

Fresh `bun run sim --only slop,peon,friends` runs passed all 84 blocking gates on each revision.
All 106 records match: 84 blocking and 22 tracked, including nine tracked results below their targets.
Base elapsed time: 128.2 seconds. Candidate: 127.5 seconds.
Normal gate inputs were Slop seeds 13-16 for four weeks with 300 personas per city; Peon seeds 13-16 for eight weeks; and Friends seeds 5-8 for eight weeks with 400 personas.
The following tracked results remain below target on both revisions:

| Block | Tracked check | Unchanged result |
|---|---|---|
| slop | gate Minor contacts (age liars) cut vs random (>= 90%) | 76.5% |
| slop | gate Adversary contacts cut (scammers, harassers, age liars) (>= 90%) | 45.4% |
| slop | gate Second-date rate vs random (and >= 20%) (>= 2.5x) | 1.733 |
| slop | gate Second dates per seed vs random (>= 2x) | 1.676 |
| slop | gate Lowest group vs overall (man:gay) (>= 0.7x) | 0.506 |
| slop | gate Same, feasible members (man:gay) (>= 0.7x) | 0.603 |
| slop | gate Back-outs at reveal (< 10%) | 0.122 |
| slop | slop-live style: probe texts that break the Network's style rules (target 0) | 4 of 342 (too_long) |
| friends | tracked Harm from undetected adversaries vs random (target <= 0.5x) | 17.5 vs 10.5 per seed (1.67x) |

All gate values, names, details, pass states, and blocking classifications are identical, excluding elapsed time.
The full simulation was not repeated: AGENTS.md permits one per agent, already used on the earlier contribution.
Only the affected Slop, Peon, and Friends blocks ran here, with their normal pinned seeds and durations.

## One regression and required validation

The new integration case launches all four real CLIs and compares valid reports with direct native world calls.
It covers signed seeds, negative exponents, signed ranges, a positive-range control, and Friends' mixed lists.
Invalid inputs must fail before producing a table or file.

```text
bun test --conditions eliza-source packages/sim/test/app-seeds.integration.test.ts
Base code: 0 pass, 1 fail; 1 assertion; 163.00 ms.
For --seeds -3, expected one result and received four.
Fixed code: 1 pass, 0 fail; 91 assertions; 2.59 seconds.
```

Fresh validation on the final code:

- Frozen install: 50 installs checked across 44 packages, unchanged.
- Typecheck: all four configurations passed.
- Integration, including security: 676 pass, 8 skip, 6 known failures; 13,832 assertions.
- The new regression passed inside the official integration command in 2557.05 ms.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions.
- Integration: 690 tests across 69 files, 444.99s. End-to-end: 43 tests across 3 files, 43.55s.

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

The six integration failures match the clean-main Windows baseline in both test names and causes:
one missing `/bin/bash`, one SIGTERM exit 143 versus 0, and four site-build path assertions.
All eight integration skips and the one end-to-end skip match the previous validated run.
A fully green integration suite is not claimed.

There was one implementation attempt: the shared numeric/range parser.
The initial reversed-range probes found a successful empty Peon report and formatter errors in the other CLIs.
The signed-number probes then confirmed the common parsing cause before implementation.
The regression failed on base and passed after the fix; the broader paired comparison passed on its first run.

Real-LLM evidence: N/A; argument parsing does not use a model. Model calls: 0. Cost: $0.
The app worlds are native offline simulations; they do not claim to test model-backed behavior.
Their existing simulated review behavior is unchanged.
Agent clients: N/A; this changes developer simulation commands, not a member-facing agent integration.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2. No other client is claimed as tested.
No browser or computer use was performed.
The exact assistant model identifier was not exposed; attribution uses the helper's supported `unavailable` value.

Only synthetic local data was used. Live-send and deploy flags were unset, and provider keys were removed from the test process.
PostgreSQL was stopped after validation, with no client connections remaining.
Raw captures and logs remain local; the diff contains only source, one regression case, and this report.
Large but representable ranges can still be expensive. This fix does not impose a new experiment-size policy.

## Reproduce the paired measurement

1. Check out the base commit and this PR in separate directories.
2. Run `bun install --frozen-lockfile` in each checkout.
3. Save the measurement program below as `../app-seeds-measure.ts`.
4. From base, run `bun run --conditions eliza-source ../app-seeds-measure.ts ../before.json`.
5. From candidate, run the same command with `../after.json`.
6. Save the comparator below as `../app-seeds-compare.ts`.
7. Run `bun ../app-seeds-compare.ts ../before.json ../after.json`.
8. Expect 21 corrected selections, 38 refused invalid selections, 37 unchanged reports, and 75 unchanged native references.
9. Run `bun run sim --only slop,peon,friends --json <output.json>` on each checkout to reproduce the gate comparison.

No model credentials or PostgreSQL are needed for the paired CLI measurement.
The official integration and end-to-end suites require the local development PostgreSQL setup from CONTRIBUTING 5.1.
The programs and input matrix were written by the contributor. The counts and hashes were generated by executing them.

### app-seeds-measure.ts

```ts
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
const root = process.cwd();
const imp = (path: string) => import(join(root, "packages/sim/src/apps", path));
const [pw, pm, pa, fw, fm, fa, sw, sm, sa, sp] = await Promise.all([
  imp("peon/world.ts"), imp("peon/metrics.ts"), imp("peon/arms.ts"), imp("friends/world.ts"), imp("friends/metrics.ts"), imp("friends/arms.ts"),
  imp("slop/world.ts"), imp("slop/metrics.ts"), imp("slop/baselines.ts"), imp("slop/packEval.ts"),
]);
const specs = [
  { name: "peon", entry: "peon/cli.ts", arm: "keyword", args: ["--arms", "keyword", "--per-city", "40", "--jobs", "10", "--weeks", "4"], defaults: [1, 2, 3, 4] },
  { name: "friends", entry: "friends/cli.ts", arm: "random", args: ["--only", "random", "--n", "80", "--weeks", "4"], defaults: [1, 2, 3, 4] },
  { name: "slop", entry: "slop/cli.ts", arm: "random", args: ["--only", "random", "--per-city", "40", "--weeks", "4"], defaults: [1, 2, 3, 4, 5, 6, 7, 8] },
  { name: "slop-pack", entry: "slop/packEval.ts", arm: "random", args: ["--arms", "random", "--per-city", "40", "--weeks", "4"], defaults: [1, 2, 3, 4] },
];
type Case = { kind: "unchanged" | "corrected" | "invalid"; input?: string; seeds?: number[] };
const cases: Case[] = [
  { kind: "unchanged" },
  ...[["0", [0]], ["7", [7]], ["13-14", [13, 14]], ["2.5-3.5", [2.5, 3.5]], ["0x10", [16]], ["+2", [2]], [" 2 - 3 ", [2, 3]], ["1e2", [100]]].map(([input, seeds]) => ({ kind: "unchanged" as const, input: input as string, seeds: seeds as number[] })),
  ...[["-3", [-3]], ["1e-3", [.001]], ["-3--1", [-3, -2, -1]], ["-1e-3", [-.001]], ["1e-3-2", [.001, 1.001]]].map(([input, seeds]) => ({ kind: "corrected" as const, input: input as string, seeds: seeds as number[] })),
  ...["", "nope", "NaN", "Infinity", "1e999", "3-1", "1-", "-", "1-2-3"].map(input => ({ kind: "invalid" as const, input })),
];
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const native = new Map<string, any>();
async function one(name: string, seed: number) {
  const key = `${name}:${seed}`;
  if (!native.has(key)) {
    const r = name === "peon" ? pm.peonMetrics(await pw.runPeonWorld({ seed, perCity: 40, jobsPerCity: 10, weeks: 4, matcher: pa.ARMS.keyword.matcher, realism: pw.REALISM_V2 }))
      : name === "friends" ? fm.friendsMetrics(fw.runFriendsWorld({ seed, n: 80, weeks: 4, planCap: 1, matcher: fa.friendsArms({}).random }))
      : name === "slop" ? sm.slopMetrics(sw.runSlopWorld({ seed, perCity: 40, weeks: 4, matcher: sa.BASELINES.random }))
      : await sp.runArm("random", [seed], 4, 40);
    native.set(key, JSON.parse(JSON.stringify(r)));
  }
  return native.get(key);
}
const dir = await mkdtemp(join(tmpdir(), "app-seeds-measure-"));
const rows = [];
try {
  for (const s of specs) {
    const selected = [...cases];
    if (s.name === "friends") selected.push(
      { kind: "unchanged", input: "3,1-2,3", seeds: [3, 1, 2, 3] },
      { kind: "corrected", input: "-2,1e-3,2-3", seeds: [-2, .001, 2, 3] },
      { kind: "invalid", input: "1,3-1" }, { kind: "invalid", input: "1,,2" },
    );
    for (const c of selected) {
      const file = join(dir, `${rows.length}.json`);
      const args = ["run", "--conditions", "eliza-source", `packages/sim/src/apps/${s.entry}`, ...s.args,
        ...(c.input === undefined ? [] : ["--seeds", c.input]), "--json", file];
      const p = Bun.spawn([process.execPath, ...args], { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
      const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      const output = await Bun.file(file).exists() ? await Bun.file(file).json() : null;
      const seeds = c.seeds ?? (c.kind === "unchanged" ? s.defaults : undefined);
      let expected;
      if (seeds) {
        const values = [];
        for (const seed of seeds) values.push(await one(s.name, seed));
        expected = s.name === "slop-pack" ? [{ arm: "random", seeds, metrics: values.flatMap(v => v.metrics), extra: values.flatMap(v => v.extra) }] : { [s.arm]: values };
      }
      const row = { app: s.name, kind: c.kind, input: c.input ?? "<default>", seeds, code, stdout, stderr, output,
        expectedHash: expected === undefined ? null : hash(expected), outputHash: output === null ? null : hash(output),
        matchesNative: expected !== undefined && hash(output) === hash(expected) };
      rows.push(row);
      console.log(JSON.stringify({ app: row.app, input: row.input, kind: row.kind, code, matchesNative: row.matchesNative, wroteReport: output !== null }));
    }
  }
  assert.equal(rows.length, 96);
  await Bun.write(process.argv[2]!, JSON.stringify({ rows, native: Object.fromEntries(native) }));
} finally {
  const target = resolve(dir), parent = resolve(tmpdir());
  if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("app-seeds-measure-")) throw new Error("Unsafe cleanup path");
  await rm(target, { recursive: true, force: true });
}
```

### app-seeds-compare.ts

```ts
import assert from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
assert.equal(before.rows.length, 96); assert.equal(after.rows.length, 96);
assert.deepEqual(after.native, before.native);
const summary: any = { invocations: 96, correctedSelections: 0, unchangedReports: 0, rejectedSelections: 0, invalidSuccessesBefore: 0, invalidSuccessesAfter: 0, referenceWorldsUnchanged: Object.keys(after.native).length, byApp: {}, changes: [] };
for (let i = 0; i < after.rows.length; i++) {
  const b = before.rows[i], a = after.rows[i];
  assert.deepEqual([a.app, a.kind, a.input, a.seeds, a.expectedHash], [b.app, b.kind, b.input, b.seeds, b.expectedHash]);
  const tally = summary.byApp[a.app] ??= { corrected: 0, unchanged: 0, rejected: 0 };
  if (a.kind === "invalid") {
    assert.notEqual(a.code, 0); assert.equal(a.output, null); assert.equal(a.stdout, ""); assert(a.stderr.includes("--seeds"));
    summary.rejectedSelections++; tally.rejected++;
    summary.invalidSuccessesBefore += Number(b.code === 0);
    summary.invalidSuccessesAfter += Number(a.code === 0);
  } else {
    assert.equal(a.code, 0); assert.equal(a.matchesNative, true); assert.equal(a.outputHash, a.expectedHash);
    if (a.app !== "slop-pack") assert(a.stdout.includes(`seeds ${a.seeds.join(",")};`));
    if (a.kind === "unchanged") {
      assert.equal(b.matchesNative, true); assert.equal(b.code, 0); assert.deepEqual(a.output, b.output); assert.equal(a.stdout, b.stdout);
      summary.unchangedReports++; tally.unchanged++;
    } else {
      assert.equal(b.matchesNative, false);
      summary.correctedSelections++; tally.corrected++;
      summary.changes.push({ app: a.app, input: a.input, expectedSeeds: a.seeds, beforeExit: b.code, beforeReport: b.output !== null, afterExit: a.code, matchesNative: a.matchesNative });
    }
  }
}
assert.deepEqual([summary.correctedSelections, summary.unchangedReports, summary.rejectedSelections, summary.invalidSuccessesBefore, summary.invalidSuccessesAfter], [21, 37, 38, 20, 0]);
console.log(JSON.stringify(summary, null, 2));
```

### app-seeds-gates-compare.ts

```ts
import assert from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const semantic = ({ ms, ...rest }: any) => rest;
assert.equal(before.gates.length, 106); assert.equal(after.gates.length, 106);
assert.equal(after.gates.filter((g: any) => g.blocking).length, 84);
assert(after.gates.filter((g: any) => g.blocking).every((g: any) => g.pass));
assert.deepEqual(after.gates.map(semantic), before.gates.map(semantic));
const offTarget = after.gates.filter((g: any) => !g.pass);
assert.equal(offTarget.length, 9); assert(offTarget.every((g: any) => !g.blocking));
console.log(JSON.stringify({ gates: 106, blocking: 84, tracked: 22, unchanged: 106, blockingFailed: 0,
  offTarget: offTarget.map(semantic), baseSeconds: before.total, candidateSeconds: after.total }, null, 2));
```

## Raw artifact SHA-256

Only aggregate hashes are published; the capture files remain local.

- app-seeds-before.json: `51802cec1989b400f8773f50b52c7b109b3ca3e92411e9e58c53227b14fb447b`
- app-seeds-after.json: `47aa45a6d0c33d46883be85ed0b879781e59845d7589f5933eea7cb683c94097`
- app-seeds-gates-before.json: `7c1b94bed9a6e655266ad86022458dddbd2ad6c8d18155c25bed251a3bb75ec6`
- app-seeds-gates-after.json: `6e2894356d2c8c4d2768bc3a082c2f532938253426208155ef61778085ad3944`
