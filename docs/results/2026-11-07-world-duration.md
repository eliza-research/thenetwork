# Reject unusable world durations

Date: 2026-11-07. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Environment: Windows, Bun 1.4.2, PostgreSQL 16.15, PowerShell 7.6.9.

## Requirement, cause and change

This is a reproduced simulation-validation bug under the approved contribution scope.
PRD 34.3 requires virtual time, scenario scripts and reproducible runs.
`WorldOptions.days` controls the simulation end and the initial event schedule.
The constructor accepted zero, negative and non-finite durations without checking them.
Malformed JSON scenario values also reached that constructor.

The existing private-disclosure scenario reports PASS with zero events, joins and messages when `days` is zero, negative or null.
NaN takes a different path: comparisons against its end time are false, so it runs an unintended schedule and still reports PASS.
These results do not describe the requested experiment.

Require a positive finite number of days before constructing the world.
The shared check covers ordinary worlds, scenario runs and the CLI paths that construct them.
Positive fractional durations remain supported. No arbitrary maximum or integer restriction is added.

Two alternatives:

1. Check only the CLI or scenario reader. Direct callers of the shared World API would still accept invalid durations.
2. Clamp invalid values or use a default. That silently changes the requested experiment and can hide a configuration error.

This does not validate whether a positive duration reaches every scenario action or exercises every expectation.
It does not change seed validation or scenario repetition counts, which have separate existing PRs.

## measurement

The existing fixture is `packages/sim/scenarios/private-disclosure-canary.json`, seed 31, 21 personas, normally seven days.
Run it through `runScenario` with each listed duration; use the real StubNetwork, channel, policy, world and grader.

| Duration | Before | After |
|---|---|---|
| 0 | PASS; 0 events, 0 joins, 0 messages | Rejected before world startup |
| -1 | PASS; 0 events, 0 joins, 0 messages | Rejected before world startup |
| NaN | PASS; 165 events, 21 joins, 102 messages | Rejected before world startup |
| null | PASS; 0 events, 0 joins, 0 messages | Rejected before world startup |
| 7 | PASS; 384 events, 21 joins, 138 messages | Identical valid run |

One integration case loads that checked-in fixture and attempts these five scenario runs.
No Network, persona, scheduler or grader output is mocked.

```sh
bun test --conditions eliza-source packages/sim/test/world-duration.integration.test.ts
```

| Check | Before | After |
|---|---:|---:|
| Integration case | 0 pass, 1 fail | 1 pass, 0 fail |
| Assertions | 1 | 1 |
| Case duration | 48.84 ms | 40.95 ms |
| Command duration | 96.00 ms | 90.00 ms |

Timings are observations, not a performance claim.

A paired measurement used held-out seeds 11-22, with 201 output rows per revision.
The invalid scenario inputs were 0, -1, -0.25, NaN, negative infinity, null, missing, and the string `"7"`.
All eight are outside the positive finite number contract.

| Held-out or entry-path check | Before | After |
|---|---:|---:|
| Invalid-duration scenarios accepted and graded PASS | 96 / 96 | 0 / 96 |
| Invalid scenarios passing with zero events | 60 | 0 |
| Valid ordinary worlds | 60 | All identical |
| Valid existing scenario runs | 36 | All identical |
| Non-finite World constructors accepted | 3 / 3 | 0 / 3 |
| Invalid CLI invocations exiting successfully | 4 / 6 | 0 / 6 |
| CLI invocations with the explicit duration diagnostic | 0 / 6 | 6 / 6 |

The 60 valid worlds use 24 personas and durations 0.125, 1, 7, 14 and 28 days.
The 36 scenario controls use the unchanged private-disclosure, STOP and morning-of-flake fixtures.
All valid run records, metrics, channel messages and persona memories match.
Only measured wall-clock durations are excluded from trace hashes; run IDs are deterministic in these controls.
Unchanged results do not imply that every stochastic scenario expectation passes on every seed.

The CLI checks use four personas and seed 11 with `--days=0`, `-1`, `-0.25`, `NaN`, `nope`, and `-Infinity`.
The NaN and `nope` CLI cases already exited nonzero from a later invalid-time error on this seed.
They now fail at the shared duration check. The other four previously emitted successful reports.
Positive infinity was checked at construction only; no unbounded baseline simulation was started.

## Reproduce the paired measurement

Save this program as `../world-duration-measure.ts` beside two installed checkouts.
Use a clean base checkout named `../friends-crew-base` at the commit above.
Run from the fixed checkout with live-send and deployment flags unset:

```sh
bun run --conditions eliza-source ../world-duration-measure.ts ../friends-crew-base > ../world-duration-before.jsonl
bun run --conditions eliza-source ../world-duration-measure.ts . > ../world-duration-after.jsonl
```

Compare rows by kind and identifying fields.
Expect all `world` and `scenario` rows to match exactly.
Expect every invalid scenario and non-finite constructor to reject after the fix.
Expect every invalid CLI case to exit nonzero with the duration diagnostic and no metrics report.

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]!);
const from = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { loadScenario, runScenario } = await from("packages/sim/src/scenario.ts");
const { World, runWorld } = await from("packages/sim/src/world.ts");
const { StubNetwork } = await from("packages/sim/src/stubNetwork.ts");
const { generatePersonas } = await from("packages/sim/src/generator.ts");
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x, (k, v) => k === "wallMs" ? 0 : v instanceof Map || v instanceof Set ? [...v] : v)).digest("hex");
const fixture = await loadScenario(resolve(root, "packages/sim/scenarios/private-disclosure-canary.json"));
const invalid = [["zero", 0], ["negative", -1], ["fractional-negative", -0.25], ["nan", Number.NaN], ["negative-infinity", -Infinity], ["null", null], ["missing", undefined], ["string", "7"]] as const;
for (let seed = 11; seed <= 22; seed++) {
  for (const [label, days] of invalid) {
    try {
      const r = await runScenario({ ...fixture, seed, days }, { network: (s: any) => new StubNetwork({ seed: s.seed }), writeLog: false });
      console.log(JSON.stringify({ kind: "invalid", seed, label, accepted: true, pass: r.pass, events: r.world.events, joined: r.world.metrics.run.joined, messages: r.world.channel.all().length }));
    } catch (e) {
      console.log(JSON.stringify({ kind: "invalid", seed, label, accepted: false, error: String(e) }));
    }
  }
  for (const days of [0.125, 1, 7, 14, 28]) {
    const personas = generatePersonas({ n: 24, seed, joinSpreadDays: Math.min(7, days) });
    const r = await runWorld({ seed, personas, days, runId: `duration-${seed}-${days}`, network: new StubNetwork({ seed }), writeLog: false });
    console.log(JSON.stringify({ kind: "world", seed, days, trace: hash(r.records), metrics: r.metrics, messages: hash(r.channel.all()), memories: hash(r.memories) }));
  }
  for (const name of ["private-disclosure-canary", "stop-keyword", "group-flake-morning-of"]) {
    const s = await loadScenario(resolve(root, `packages/sim/scenarios/${name}.json`));
    const r = await runScenario(s, { seed, network: (sc: any) => new StubNetwork({ seed, ...sc.stub }), writeLog: false });
    console.log(JSON.stringify({ kind: "scenario", seed, name, pass: r.pass, results: r.results, trace: hash(r.world.records), metrics: r.world.metrics, messages: hash(r.world.channel.all()), memories: hash(r.world.memories) }));
  }
}
// Check non-finite construction without starting an unbounded baseline run.
for (const days of [Infinity, -Infinity, Number.NaN]) {
  try { const w = new World({ seed: 1, personas: [], days, network: new StubNetwork({ seed: 1 }), writeLog: false }); console.log(JSON.stringify({ kind: "constructor", label: String(days), accepted: true, end: String(w.end) })); }
  catch (e) { console.log(JSON.stringify({ kind: "constructor", label: String(days), accepted: false, error: String(e) })); }
}
// Actual CLI parsing and exit behavior; all these baseline runs are bounded.
for (const value of ["0", "-1", "-0.25", "NaN", "nope", "-Infinity"]) {
  const proc = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", resolve(root, "packages/sim/src/cli.ts"), "--personas", "4", `--days=${value}`, "--seed", "11", "--json", "--no-log"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  let run; try { run = JSON.parse(stdout).run; } catch {}
  console.log(JSON.stringify({ kind: "cli", value, code, run, rejected: stderr.includes("world days must be a positive finite number") }));
}
```

## Validation and safety_gates

| Command | Result |
|---|---|
| `bun run typecheck` | All four configurations pass; exit 0 |
| Network and Friends simulation, base | 79/79 blocking gates pass; 245.3 seconds |
| Same simulation command, fixed revision | 79/79 blocking gates pass; 202.8 seconds |
| `bun run test:integration` | 676 pass, 8 skip, 6 known failures; 13,742 assertions; 522.73 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 73.68 seconds |

All 84 simulation gate records are identical after excluding elapsed time.
The five tracked records include one existing miss: undetected-adversary harm remains 17.5 versus 10.5 per seed (1.67x).
Invariant, canary-leak and minor-contact gates retain their passing values.

The new regression passed inside the official integration command in 21.88 ms.
The six failures match the recorded base by test name and underlying error:
missing `/bin/bash` for Wrangler, SIGTERM exit 143 instead of 0, and four Windows site-build path assertions.
The integration command includes the security suite. It exited 1; a fully green integration suite is not claimed.
Eight optional isolated-cleanup cases skipped. The optional browser SDK end-to-end case also skipped.
The task-owned database was stopped after both suites finished and no client sessions remained.

The paired gate command is `bun run sim --only network,friends --json <output>`, without `--quick`.
The baseline is the earlier successful run at the same unchanged main commit, reused from the fractional-hours qualification.
Network uses its checked-in seed 3 invariant run, seeds 1-3 consent arms, scenarios and conformance checks.
Friends uses seeds 5-8, 400 personas, eight weeks and its additional conformance and planner checks.
Simulated reviewers handle approvals in these offline runs.

The full simulation was not repeated: AGENTS.md permits one per agent, already used for PR #355.
No gate threshold or simulation behavior for valid durations changes.
Live sends and deployments were disabled. Service tests use isolated local PostgreSQL on port 54339.

## llm_evidence and agent_clients

N/A for real-model qualification: the change rejects invalid configuration before the world starts.
No model-backed behavior changes or claims. Real-model calls: 0; cost: $0; request settings: N/A.

Codex desktop 26.1103.3517.0 drove the local commands on 2026-11-07.
Assistant provider: OpenAI. Its exact model identifier was not exposed and is reported as unavailable.
No member-facing agent-client workflow changes; no other client is claimed as tested.
No browser or computer use was performed, as instructed by the operator.
No production member data, secrets or raw run logs are included.
