# Reject invalid Observatory report selectors

Date: 2026-11-10 (Asia/Tokyo). Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15 on local port 54339.

## Requirement and defect

PRD 34.3 requires reproducible simulations with a recorded configuration.
PRD 34.4 defines the measurements reported by the simulator.
CONTRIBUTING 3.1 accepts fixes to simulations that measure the wrong result.

The report command accepted any string for its engine, network and review selectors.
TypeScript assertions did not validate those strings at runtime.
An unknown network selected `StubNetwork`; an unknown engine disabled the external engine.
An unknown review mode followed the non-automatic review path and remained in the report as an unsupported label.
All these commands returned success and printed a report.

The concrete reproduction used 80 generated personas, seven days and seed 1:

```sh
bun run --conditions eliza-source packages/observatory/src/report.ts --days 7 --seed 1 --personas 80 --network consens --review human
```

Before: exit 0, `world.network` was `consens`, no review section existed, and 60 simulated invitations were sent.
The typo selected the stub baseline, which has no human review.
After: exit 2, an invalid-network diagnostic, and no report or world run.
This is a local simulation configuration defect; these runs send no real messages.

## Fix and alternatives

Validate the three selectors before constructing `GameSource`.
Reject unsupported values, including empty strings, whitespace and incorrect case.
Print the invalid value and allowed values, then exit 2.
Preserve all existing valid options and defaults, including `--engine off`.
The usage comment and type assertion now include that existing option.

Alternatives considered:

1. Validate in `GameSource`. That also changes callers outside this report command.
2. Normalize unknown values or use defaults. That still runs a different configuration from the explicit request.
3. Add a schema library. Three fixed selectors need no new dependency.

## measurement

One integration case drives actual CLI subprocesses, the generated world, both networks and their native reports.
It uses no mock, external provider or hand-built report.

The paired measurement uses 64 invocations per revision, with identical arguments and generated inputs:

- Twelve invalid selections: four values for each of network, engine and review, seed 1.
- Forty-eight valid selections: three engines, two networks, two review modes and seeds 1, 7, 11, 23.
- Four controls with all three selectors omitted, one per seed.
- Every run requests seven days and 80 generated personas. Seeds 7, 11 and 23 were not used to design the fix.

| Check | Before | After |
|---|---|---|
| Four invalid network values, with human review requested | Exit 0; 60 invitations each; no review section | Exit 2; no report |
| Four invalid engines, with the stub network | Exit 0; no engine invitations; invalid engine labels | Exit 2; no report |
| Four invalid review modes, with ConsentNetwork | Exit 0; invalid review labels; no invitations | Exit 2; no report |
| All 52 valid controls | Successful native reports | Entire reports identical, excluding `world.wallMs` |
| One real CLI regression | 0 pass, 1 fail; expected exit 2, received 0 | 1 pass, 0 fail; 92 assertions |
| `network,audit,ops` simulation gates | 91/91 blocking; zero off target | 91/91 blocking; zero off target; 94 semantic gate records identical |

The comparison also checks identical keys, seeds, arguments, exit codes and stderr for every valid control.
Only the report's elapsed wall time is removed.
No fairness, outcome, review, invitation, score or judge field is excluded.
These are exact deterministic comparisons, not an estimated performance improvement.
No confidence interval is needed for rejecting invalid inputs or exact equality.

SHA-256 of the paired artifacts:

- Before: `37fd4a93cbf9af5177d99162cc276d4bd7b82299354b2d853fb3256ae71a1847`.
- After: `006e82ff229b49761c6c6a983d169b6212faac67367015b3687aff2b4acedf08`.

The artifact JSON contains generated simulation results and remains outside the repository.
The complete measurement and comparison programs below reproduce it.

## safety_gates

All 64 base runs and all 52 candidate worlds had zero judge invariants, canary leaks and minor contacts.
The twelve rejected candidate commands created no worlds.
The 52 valid reports are unchanged, including their oracle flags and safety counters.
This does not claim that the stub baseline has production review or leak protections.

The unchanged base gate evidence comes from the earlier Lab validation at the same base commit and environment.
The clean base checkout and unchanged dependency lock were checked before reuse.
Command: `bun run sim --only network,audit,ops --json <output>`.
Base: 91/91 blocking gates, all three tracked gates passing, 249.6 seconds.
Candidate: 238 seconds, with all 94 semantic gate records identical.
The comparison removes gate timings and the backup-drill duration embedded in its name.
The network block uses its pinned seeds and scenarios; the paired CLI runs use the seeds listed above.

The full simulation was not repeated: AGENTS.md permits one full run per agent, already used earlier in this contribution session.
No new full-suite result is claimed for this change.
Consent `auto` runs use the simulated reviewer; `human` runs receive no review decisions.
Stub runs retain their documented baseline behavior.
Live-send, provider and deployment flags were cleared for local validation.
The isolated database was stopped after validation, with zero other clients.

## Required checks

- Frozen installation: 50 installs across 44 packages checked; no changes.
- `bun run typecheck`: all four configurations passed.
- `bun run test:integration`, including every security-suite file: 676 pass, 8 skip, 6 fail; 13833 assertions; 690 tests in 69 files, 451.05s.
- The new case passed inside that official command: 9380.02ms.
- The six failures match the base names and causes: one missing `/bin/bash`, one SIGTERM exit 143 versus 0, four Windows path assertions.
- All eight integration skips match the previous full validation, including repeated unnamed entries.
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions; 43 tests in 3 files, 36.95s. The optional browser SDK case remains skipped.
- `git diff --check`: passed.

The integration suite is not fully green on this Windows environment.
No failure is suppressed or converted into a pass.

## llm_evidence

N/A: command-line selector validation does not use a model.
The world uses the repository's deterministic simulated personas and reviewer.
Real-model calls: 0. Cost: $0. Model request settings: N/A.

## agent_clients

Codex desktop 26.1103.4239.0 drove the Bun commands on Windows.
Provider: OpenAI. The exact assistant model identifier was unavailable in this session.
The supported disclosure footer records `unavailable`; no exact model is inferred.
This developer CLI does not alter a member-facing agent workflow.
No other client, browser or computer-use workflow is claimed as tested.

## Attempts and limits

An earlier hypothesis about unsafe invitation totals in held reviews did not reproduce and produced no code change.
The first regression invocation used an incorrect child working directory and exited 1 before loading the CLI.
That setup error was corrected before the recorded base regression, which reaches the CLI and exits 0.
The production fix passed its first tested version.

Validation is local to the report CLI. Other callers retain their existing validation.
Numeric options are outside this change.
Rejecting case variants and whitespace is intentional: supported selectors are exact names.
The fixed-size allowlist must follow future additions to report modes.
No UI, member copy, matching algorithm, review rule or gate threshold changes.

## Reproduce

1. Run `bun install --frozen-lockfile`.
2. Run the reproduction above. Expect exit 2 and no JSON report.
3. Run `bun test --conditions eliza-source packages/observatory/test/report-cli.integration.test.ts`.
4. Expect one passing integration case with 92 assertions.
5. Save the programs below beside separate base and candidate checkouts.
6. Run the measurement against each checkout, then compare the two JSON files.

```sh
bun report-selectors-measure.ts /path/to/base before.json
bun report-selectors-measure.ts /path/to/candidate after.json
bun report-selectors-compare.ts before.json after.json
bun lab-matching-gates-compare.ts gates-before.json gates-after.json
```

### report-selectors-measure.ts

```ts
import { resolve } from "node:path";

const [repo, dest] = process.argv.slice(2);
if (!repo || !dest) throw new Error("usage: measure.ts <repository> <output.json>");
const rows: unknown[] = [];
async function run(key: string, seed: number, args: string[]) {
  const cmd = [process.execPath, "run", "--conditions", "eliza-source", "packages/observatory/src/report.ts",
    "--days", "7", "--seed", String(seed), "--personas", "80", ...args];
  const p = Bun.spawn(cmd, { cwd: resolve(repo), stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const report = stdout.trim() ? JSON.parse(stdout) : null;
  if (report) delete report.world.wallMs;
  rows.push({ key, seed, args, exit, stdoutEmpty: stdout === "", report, stderr });
  console.log(`${key}: exit=${exit}, invites=${report?.people.invites ?? "none"}`);
}
for (const [name, values] of Object.entries({ network: ["consens", "", " ", "CONSENT"], engine: ["engne-v1", "", " ", "ENGINE-V1"], review: ["manual", "", " ", "HUMAN"] })) {
  for (const value of values) await run(`invalid:${name}:${JSON.stringify(value)}`, 1,
    [...(name === "network" ? ["--review", "human"] : name === "engine" ? ["--network", "stub"] : []), `--${name}`, value]);
}
for (const seed of [1, 7, 11, 23]) {
  for (const engine of ["engine-v1", "random", "off"]) for (const network of ["consent", "stub"]) for (const review of ["auto", "human"]) {
    await run(`valid:${seed}:${engine}:${network}:${review}`, seed, ["--engine", engine, "--network", network, "--review", review]);
  }
  await run(`default:${seed}`, seed, []);
}
await Bun.write(dest, JSON.stringify(rows, null, 2) + "\n");
```

### report-selectors-compare.ts

```ts
import assert from "node:assert/strict";
const [before, after] = await Promise.all(process.argv.slice(2).map(path => Bun.file(path).json()));
assert.equal(before.length, 64);
assert.equal(after.length, 64);
const unchanged: string[] = [], rejected: unknown[] = [], safety: unknown[] = [];
for (let i = 0; i < before.length; i++) {
  const a = before[i], b = after[i];
  assert.deepEqual([a.key, a.seed, a.args], [b.key, b.seed, b.args]);
  assert.equal(a.exit, 0);
  if (a.key.startsWith("invalid:")) {
    assert.equal(b.exit, 2);
    assert.equal(b.stdoutEmpty, true);
    assert.equal(b.report, null);
    const flag = a.key.split(":")[1];
    assert.ok(b.stderr.includes(`invalid --${flag}:`));
    rejected.push({ key: a.key, beforeInvites: a.report.people.invites, beforeEngine: a.report.world.engine,
      beforeNetwork: a.report.world.network, beforeReview: a.report.review?.mode ?? null });
  } else {
    assert.deepEqual(b, a);
    unchanged.push(a.key);
    const j = a.report.judge;
    if (j.invariants || j.canaryLeaks || j.minorContacts) safety.push({ key: a.key, ...j });
  }
}
assert.equal(unchanged.length, 52);
assert.equal(rejected.length, 12);
console.log(JSON.stringify({ rejected, unchangedControlCount: unchanged.length, unchangedNonzeroJudgeResults: safety }, null, 2));
```

### lab-matching-gates-compare.ts

```ts
import { isDeepStrictEqual } from "node:util";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const gates = (r: any) => r.gates.map(({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name,
}));
if (!isDeepStrictEqual(gates(before), gates(after))) throw Error("Gate values changed");
if (after.gates.length !== 94 || after.gates.filter((g: any) => g.blocking).length !== 91 || after.gates.some((g: any) => !g.pass))
  throw Error("Expected all 91 blocking gates and three tracked gates to pass");
console.log(JSON.stringify({ identicalGateRecords: 94, blockingGatesPassed: 91, trackedOffTarget: 0 }, null, 2));
```
