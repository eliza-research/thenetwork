# Whole-week durations for app simulations

Date: 2026-11-10 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, current main.
Candidate: this PR, branched from that base.
Runtime: Windows, Bun 1.4.2, PostgreSQL 16.15 for the required integration and end-to-end suites.

## Requirement and reproduced defect

PRD 34.3 requires reproducible simulated worlds; CONTRIBUTING 3.1 accepts fixes to incorrect simulation validation.
The Peon, Friends and Slop app worlds advance in whole weekly rounds.
Their metrics use the requested week count as the reporting duration.
They did not validate that count before generating a population or starting a run.

All four runners (including Slop's synchronous and asynchronous APIs) returned empty successful runs for zero weeks.
Peon and Friends also returned empty runs for negative and NaN durations.
Peon ran two rounds for 1.5 weeks, while retaining 1.5 as the reporting duration.
On seed 1 with 40 candidates and 10 jobs per city, that run produced 138 flows and ended at week index 1.
Slop's generated population and Friends' hour ledger could instead fail with a generic array-length error.
Supplying an existing population bypassed those incidental array checks.

The initial native probe exercised 0, -1, NaN and 1.5 weeks in all four runners.
It found nine successful invalid runs and seven generic array failures.
No infinite or oversized simulation was executed on base.

## Fix and alternatives

Validate the week count in all three world constructors, before population generation, oracle setup or matcher execution.
One shared helper requires a positive safe integer and preserves each world's default: eight weeks for Peon and Friends, four for Slop.
This also covers both Slop runners, the four app CLIs, and callers supplying their own populations.
The diagnostic identifies weeks and the positive-safe-integer requirement.

No matcher, persona generator, RNG, metric formula, gate threshold, model setting or dependency changes.
No UI markup, style or member-facing text changes.

Alternatives considered:

1. Validate only CLI arguments. Direct API callers and supplied populations would still accept invalid durations.
2. Round fractional durations. That silently changes the experiment the caller requested.
3. Support partial weekly rounds. That needs new timing and metric semantics; the existing app worlds execute whole rounds.

PR #398 validates the separate event-driven World duration in days, which supports fractional days.
PR #441 validates app CLI seed selections. Neither PR changes these app-world duration constructors, and neither is required here.

## Paired native and CLI measurement

The same program ran on base and candidate with the same data and arguments.
It uses real repository runners, generated populations and subprocess CLIs. It mocks no matcher, model reply, outcome or report.

The 48 valid native executions cover four runners, seeds 1, 7 and 11, and omitted/default, one, two and four weeks.
The omitted and explicit four-week Slop cases intentionally exercise both forms of the default.
Peon uses the keyword arm with 40 candidates and 10 jobs per city; Friends uses the random arm with 80 personas; both Slop runners use random with 40 personas per city.
All other settings retain repository defaults, including Peon realism v2.

For each valid run, the program checks the reported duration and final week index.
It captures complete metrics and hashes the serialized native run, including flows, outcomes, population and world state.
Maps and sets are serialized explicitly; non-finite metric values keep their string representations.
All 48 native run hashes and complete metric objects match before and after.

The 20 invalid runner calls cover 0, -1, -0.5, 1.5 and NaN weeks across the four runners at seed 1.
The 24 constructor checks cover those values plus positive infinity, negative infinity and 9007199254740992.
Constructor checks reuse populations from the real one-week runs, and do not run a scheduler.
This tests the constructor boundary independently of accidental array-length errors during population generation.
Infinite and oversized values are not executed on base; the final regression confirms the fixed runners reject them.

The 52 CLI invocations cover Peon, Friends, Slop baseline and Slop pack commands, with seed 1 and the same small populations.
Twenty-four valid controls use omitted/default, `1`, `2`, `4`, `2.0` and `2e0` weeks.
Twenty-eight invalid cases use `0`, `-1`, `-0.5`, `1.5`, `NaN`, `nope` and blank text.

| Check | Before | After |
|---|---:|---:|
| Invalid runner calls returning successfully | 11 / 20 | 0 / 20 |
| Invalid supplied-population constructors returning successfully | 24 / 24 | 0 / 24 |
| Invalid CLI commands exiting successfully | 17 / 28 | 0 / 28 |
| Invalid CLI commands giving the early weeks diagnostic, empty stdout and no report | 0 / 28 | 28 / 28 |
| Complete valid native runs and metrics unchanged | baseline | 48 / 48 |
| Complete valid CLI reports and printed tables unchanged | baseline | 24 / 24 |

The other nine invalid runner calls and eleven invalid CLI calls already failed on base, through incidental array failures.
All invalid cases now fail at the duration boundary with the same clear diagnostic.
Valid CLI JSON and stdout match exactly; stderr execution timings and error stacks are not compared byte for byte.
No normalization was needed for valid run hashes, metrics, JSON reports or stdout.
This measures input correctness and preserved execution, not a statistical improvement in match quality.
Confidence intervals are not applicable to the exact comparisons.

## Safety and gate evidence

These small measurements use existing keyword and random baselines, including their existing harmful contacts.
They do not establish launch safety for those arms.
Every complete safety object is unchanged in the 48 native comparisons, along with the serialized run data.
Selected totals across those executions are below; they are not counts of a deduplicated population.

| Runner | Executions | Policy minor field | Hidden-age fields | Other existing adverse fields |
|---|---:|---|---|---|
| peon | 12 | minorsMatched: 0 | Not reported | scamReach: 16; unverifiedIntros: 163; noRangeIntros: 198 |
| friends | 12 | declaredMinorContacts: 0 | hiddenMinorContacts: 14 | adversaryContacts: 22; known: 10; harmsUndetected: 7 |
| slop | 12 | minorContacts: 0 | undisclosedMinorContacts: 11; proposals: 55 | adversaryContacts: 38; proposals: 166 |
| slop-async | 12 | minorContacts: 0 | undisclosedMinorContacts: 11; proposals: 55 | adversaryContacts: 38; proposals: 166 |

The Slop synchronous and asynchronous rows repeat the same configurations to check both entry points.
Peon's `minorsMatched`, Friends' `declaredMinorContacts` and Slop's `minorContacts` stay zero in every applicable execution.
The nonzero counters above remain present identically before and after.

Fresh `bun run sim --only slop,peon,friends` runs passed 84/84 blocking gates on both revisions.
All 106 semantic records match: 84 blocking and 22 tracked, including nine existing tracked results below target.
Only elapsed time is excluded. Base: 127.6s; candidate: 129.6s.
The normal inputs were Slop seeds 13-16 for four weeks and 300 personas per city; Peon seeds 13-16 for eight weeks; Friends seeds 5-8 for eight weeks and 400 personas.

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

The gate comparator excludes elapsed time only. All values, details, pass states and blocking classifications remain identical.
The full simulation was not repeated: AGENTS.md permits one full run per agent, already used on the earlier contribution.
Only the affected Slop, Peon and Friends blocks ran, with their normal pinned settings.

## Regression and required validation

One integration case invokes all four native runners and all four real CLIs.
Native invalid inputs include zero, negative, fractional, NaN, both infinities and an unsafe integer.
Positive one- and two-week controls finish at the expected final week and produce real flows.
The CLI controls produce reports; invalid CLI inputs produce neither a table nor a report.

```text
bun test --conditions eliza-source packages/sim/test/app-weeks.integration.test.ts
Final case on base: 0 pass, 1 fail; 1 assertion; 69.00 ms.
Peon's zero-week call resolves instead of rejecting.
Final case on candidate: 1 pass, 0 fail; 76 assertions; 997.00 ms.
```

Fresh validation on the final code:

- Frozen install: 50 installs checked across 44 packages, unchanged.
- Typecheck: all four configurations passed.
- Integration, including security: 676 pass, 8 skip, 6 known failures; 13,817 assertions.
- The new regression passed in the official integration command in 1070.70 ms.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions.
- Integration: 690 tests across 69 files, 464.27s. End-to-end: 43 tests across 3 files, 45.34s.

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

The six integration failures match the clean-main Windows baseline in names and causes:
one missing `/bin/bash`, one SIGTERM exit 143 versus 0, and four site-build path assertions.
Integration skips and the end-to-end skip match the previous validated run.
A fully green Windows integration suite is not claimed.

There was one production implementation attempt: the shared constructor validation.
The first typecheck caught TypeScript inference in the test's heterogeneous promise wrapper; an async wrapper corrected it.
The final regression was rerun on base and candidate after that test-only adjustment.
The broader paired comparison passed on its first run; its production code did not change afterward.

Real-LLM evidence: N/A; duration validation does not use a model. Real-model calls: 0. Cost: $0.
The offline worlds do not qualify model-backed behavior; their simulated review behavior is unchanged.
Agent clients: N/A; this affects developer simulations, not a member-facing agent integration.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2. No other client is claimed as tested.
No browser or computer use was performed. The exact assistant model identifier was unavailable.

Only synthetic local data was used. Live-send and deploy flags were unset and provider keys removed from the test process.
PostgreSQL was stopped after validation with no client connections remaining.
Large positive durations can still be expensive and subject to the existing population/array limits.
This change establishes whole positive weeks, not a new experiment-size quota.

## Reproduce

1. Check out the base commit and this PR in separate directories; run `bun install --frozen-lockfile` in each.
2. Save `app-weeks-measure.ts` below outside each checkout.
3. From base, run `bun run --conditions eliza-source ../app-weeks-measure.ts ../before.json`.
4. From candidate, run the same command with `../after.json`.
5. Save the comparator and run `bun ../app-weeks-compare.ts ../before.json ../after.json`.
6. Expect 48 unchanged native runs, 24 unchanged CLI outputs, and refusal of all 20 runner, 24 constructor and 28 CLI invalid cases.
7. Run `bun run sim --only slop,peon,friends --json <output.json>` in each checkout, then compare with the gate program below.

The paired measurement needs no model credentials or PostgreSQL.
The official integration and end-to-end suites use the local development PostgreSQL setup in CONTRIBUTING 5.1.
The programs and input matrix were written by the contributor; executed programs generated the results and hashes.
Raw captures and logs remain local.

### app-weeks-measure.ts

```ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
const imp = (p: string) => import(join(process.cwd(), "packages/sim/src/apps", p));
const [pw, pa, pm, fw, fa, fm, sw, sa, sm] = await Promise.all([
  imp("peon/world.ts"), imp("peon/arms.ts"), imp("peon/metrics.ts"), imp("friends/world.ts"), imp("friends/arms.ts"), imp("friends/metrics.ts"),
  imp("slop/world.ts"), imp("slop/baselines.ts"), imp("slop/metrics.ts"),
]);
const canonical = (v: unknown) => JSON.stringify(v, (_k, x) => x instanceof Map ? { map: [...x] } : x instanceof Set ? { set: [...x] } : typeof x === "number" && !Number.isFinite(x) ? String(x) : x);
const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
const specs = [
  { app: "peon", fallback: 8, run: (seed: number, weeks?: number) => pw.runPeonWorld({ seed, weeks, perCity: 40, jobsPerCity: 10, matcher: pa.ARMS.keyword.matcher }), metrics: pm.peonMetrics },
  { app: "friends", fallback: 8, run: (seed: number, weeks?: number) => fw.runFriendsWorld({ seed, weeks, n: 80, matcher: fa.friendsArms({}).random }), metrics: fm.friendsMetrics },
  { app: "slop", fallback: 4, run: (seed: number, weeks?: number) => sw.runSlopWorld({ seed, weeks, perCity: 40, matcher: sa.BASELINES.random }), metrics: sm.slopMetrics },
  { app: "slop-async", fallback: 4, run: (seed: number, weeks?: number) => sw.runSlopWorldAsync({ seed, weeks, perCity: 40, matcher: sa.BASELINES.random }), metrics: sm.slopMetrics },
];
const native: any[] = [], constructors: any[] = [], cli: any[] = [], fixtures = new Map<string, any>();
for (const s of specs) for (const seed of [1, 7, 11]) for (const weeks of [undefined, 1, 2, 4]) {
  const r = await s.run(seed, weeks), m = s.metrics(r);
  assert.equal(r.world.weeks, weeks ?? s.fallback);
  assert.equal(r.world.state.week, (weeks ?? s.fallback) - 1);
  native.push({ app: s.app, kind: "valid", seed, input: weeks === undefined ? "default" : String(weeks), weeks: r.world.weeks,
    lastWeek: r.world.state.week, flows: r.flows.length, runHash: hash(r), metrics: JSON.parse(canonical(m)) });
  if (seed === 1 && weeks === 1) fixtures.set(s.app, r.world);
}
for (const s of specs) for (const weeks of [0, -1, -.5, 1.5, NaN]) {
  const row: any = { app: s.app, kind: "invalid", seed: 1, input: String(weeks) };
  try {
    const r = await s.run(1, weeks);
    Object.assign(row, { returned: true, weeks: String(r.world.weeks), lastWeek: r.world.state.week, flows: r.flows.length, metrics: JSON.parse(canonical(s.metrics(r))) });
  } catch (e) { Object.assign(row, { returned: false, error: String(e) }); }
  native.push(row);
}
// Supplied populations come from the valid native worlds above. Construction cannot start a run.
for (const app of ["peon", "friends", "slop"]) for (const weeks of [0, -1, -.5, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  const row: any = { app, input: String(weeks) };
  try {
    const w = fixtures.get(app);
    const r = app === "peon" ? pw.createPeonWorld({ seed: 1, weeks, pop: w.pop })
      : app === "friends" ? fw.createFriendsWorld({ seed: 1, weeks, personas: w.personas })
      : sw.createSlopWorld({ seed: 1, weeks, personas: w.personas });
    Object.assign(row, { returned: true, weeks: String(r.weeks) });
  } catch (e) { Object.assign(row, { returned: false, error: String(e) }); }
  constructors.push(row);
}
const entries = [
  { app: "peon", entry: "peon/cli.ts", args: ["--arms", "keyword", "--per-city", "40", "--jobs", "10"] },
  { app: "friends", entry: "friends/cli.ts", args: ["--only", "random", "--n", "80"] },
  { app: "slop", entry: "slop/cli.ts", args: ["--only", "random", "--per-city", "40"] },
  { app: "slop-pack", entry: "slop/packEval.ts", args: ["--arms", "random", "--per-city", "40"] },
];
const dir = await mkdtemp(join(tmpdir(), "app-weeks-measure-"));
try {
  let id = 0;
  for (const s of entries) for (const input of [undefined, "1", "2", "4", "2.0", "2e0", "0", "-1", "-0.5", "1.5", "NaN", "nope", ""]) {
    const file = join(dir, `${id++}.json`), valid = input === undefined || ["1", "2", "4", "2.0", "2e0"].includes(input);
    const p = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", `packages/sim/src/apps/${s.entry}`, ...s.args, "--seeds", "1",
      ...(input === undefined ? [] : ["--weeks", input]), "--json", file], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    const report = await Bun.file(file).exists() ? await Bun.file(file).json() : null;
    const row = { app: s.app, input: input ?? "default", kind: valid ? "valid" : "invalid", code, stdout, stderr, report };
    if (valid) { assert.equal(code, 0); assert.notEqual(report, null); }
    cli.push(row);
  }
} finally {
  const target = resolve(dir), parent = resolve(tmpdir());
  if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("app-weeks-measure-")) throw new Error("Unsafe cleanup path");
  await rm(target, { recursive: true, force: true });
}
await Bun.write(process.argv[2]!, JSON.stringify({ native, constructors, cli }, null, 2));
console.log(JSON.stringify({ native: native.length, constructors: constructors.length, cli: cli.length,
  invalidNativeReturned: native.filter(r => r.kind === "invalid" && r.returned).length,
  invalidCliSuccesses: cli.filter(r => r.kind === "invalid" && r.code === 0).length,
  invalidConstructorsReturned: constructors.filter(r => r.returned).length }));
```

### app-weeks-compare.ts

```ts
import assert from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const summary: any = { nativeControls: 0, nativeRefusals: 0, nativeAcceptedBefore: 0, constructorRefusals: 0, constructorAcceptedBefore: 0, cliControls: 0, cliRefusals: 0, cliSuccessesBefore: 0, safety: {} };
assert.deepEqual([before.native.length, after.native.length, before.constructors.length, after.constructors.length, before.cli.length, after.cli.length], [68, 68, 24, 24, 52, 52]);
for (let i = 0; i < after.native.length; i++) {
  const b = before.native[i], a = after.native[i];
  assert.deepEqual([a.app, a.kind, a.seed, a.input], [b.app, b.kind, b.seed, b.input]);
  if (a.kind === "valid") {
    assert.deepEqual(a, b); summary.nativeControls++;
    const s = summary.safety[a.app] ??= { worlds: 0, totals: {} };
    s.worlds++;
    for (const [key, n] of Object.entries(a.metrics.safety)) if (typeof n === "number") s.totals[key] = (s.totals[key] ?? 0) + n;
  } else {
    assert.equal(a.returned, false); assert.match(a.error, /weeks.*positive safe integer/);
    summary.nativeRefusals++; summary.nativeAcceptedBefore += Number(b.returned);
  }
}
for (let i = 0; i < after.constructors.length; i++) {
  const b = before.constructors[i], a = after.constructors[i];
  assert.deepEqual([a.app, a.input], [b.app, b.input]);
  assert.equal(a.returned, false); assert.match(a.error, /weeks.*positive safe integer/);
  summary.constructorRefusals++; summary.constructorAcceptedBefore += Number(b.returned);
}
for (let i = 0; i < after.cli.length; i++) {
  const b = before.cli[i], a = after.cli[i];
  assert.deepEqual([a.app, a.kind, a.input], [b.app, b.kind, b.input]);
  if (a.kind === "valid") {
    assert.equal(a.code, 0); assert.equal(a.code, b.code); assert.deepEqual(a.report, b.report); assert.equal(a.stdout, b.stdout);
    summary.cliControls++;
  } else {
    assert.notEqual(a.code, 0); assert.equal(a.stdout, ""); assert.equal(a.report, null); assert.match(a.stderr, /weeks.*positive safe integer/);
    summary.cliRefusals++; summary.cliSuccessesBefore += Number(b.code === 0);
  }
}
assert.deepEqual([summary.nativeControls, summary.nativeRefusals, summary.constructorRefusals, summary.cliControls, summary.cliRefusals], [48, 20, 24, 24, 28]);
console.log(JSON.stringify(summary, null, 2));
```

### app-weeks-gates-compare.ts

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

Capture files remain local.

- app-weeks-before.json: `d70a3112967877b4c29ca1b9e6ecdf35e2deddcaa8fbdf018749d4551d078974`
- app-weeks-after.json: `913ca260e5b549e5fb1a381dd12490158d51c2874dd691a6d6245e4d404568b1`
- app-weeks-gates-before.json: `7fa32437eb2f9629557965bce78e61bd51e3f7a558fee2a808ebc4799f6d0500`
- app-weeks-gates-after.json: `f56e0a32575119bb3f2bea5dbfdbd881837876e771c5081e61968b40e941a7a8`
