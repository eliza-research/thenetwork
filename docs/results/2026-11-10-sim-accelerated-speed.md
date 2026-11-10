# Reject invalid accelerated simulation speeds

Date: 2026-11-10. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Problem and requirement

The world CLI accepts zero, negative and nonfinite accelerated speeds and reports successful runs without the requested pacing. This is a reproduced simulator defect under CONTRIBUTING 3.1 and PRD 34.3's accelerated virtual-time mode.

```sh
bun run --conditions eliza-source packages/sim/src/cli.ts --personas 80 --days 1 --seed 7 --mode accelerated --speed=NaN --json --no-log
```

On base, this exits 0 with 65 joined members. So do `Infinity`, `-Infinity`, `0`, `-1`, `bad`, an empty value and whitespace. These eight runs took 172–415 ms including process startup, versus 1,278–1,297 ms for valid speed 86400 across the four measured seeds. This is successful execution with invalid configuration, not an empty-world or startup-only probe.

## Cause and fix

`Scheduler.runUntil` divides simulated time by unchecked `speed`. NaN and nonpositive delays skip the wait; a zero divisor produces an infinite timer that Bun reduces to one millisecond. None prevents the world from completing and emitting metrics.

Validate an explicitly supplied accelerated speed in the Scheduler constructor: it must be finite and greater than zero. This protects the CLI, World API and direct scheduler callers in one place. Invalid values throw `accelerated speed must be a positive finite number`; the CLI exits 1 without a report. An omitted accelerated speed still defaults to 1440. Positive fractions remain supported. Discrete and realtime modes continue to ignore this accelerated-only setting.

A CLI-only guard would leave native World callers affected. Falling back or clamping would silently change the requested pacing. The guard leaves the event loop, queue, matching logic and timers unchanged.

PR #356 addresses events inserted during a paced wait. This branch is independent from main and changes constructor validation only; it neither contains nor replaces that event-loop fix. PR #422 addresses Observatory HTTP time controls rather than this Scheduler option.

## measurement

One integration case runs the actual CLI with 80 personas and native World workflows using real timers. It exercises all eight invalid CLI strings, two valid CLI speeds, five invalid native numeric values, omitted and fractional accelerated speeds, and ignored-speed controls for discrete and realtime modes. No network, scheduler, clock or timer is mocked.

| Same regression | Base | Candidate |
|---|---:|---:|
| Passing / failing cases | 0 / 1 | 1 / 0 |
| Assertions reached | 1 | 19 |
| Case duration | 201.08 ms | 2,862.97 ms |

The paired programs below run the same 126 workflows per revision:

- 96 valid native worlds: seeds 1, 7, 11 and 23; native StubNetwork and ConsentNetwork; six accelerated settings (omitted, 0.5, 1, 2, 1440, 86400), plus omitted, NaN and zero speed in each of discrete and realtime modes.
- Ten invalid native worlds: NaN, positive/negative infinity, zero and -1, using both networks at seed 7.
- Twelve valid CLI worlds: all four seeds, 80 personas and one day, with accelerated speeds 86400 and 1e6 plus discrete mode with an ignored NaN speed.
- Eight invalid CLI worlds: the strings listed above, 80 personas and one day at seed 7. The CLI's built-in network is StubNetwork; ConsentNetwork is exercised through the World API.

Native worlds have 12 generated NYC personas and a 120 ms simulated horizon. Scripted actions join two members, send an inbound message and opt one member out at 10/30/80/100 ms. They use the actual channel, persona policy, network and run metrics. They deliberately provide short, nonempty workflows for realtime and fractional-speed controls; they do not measure match quality or realistic per-week message rates.

| Paired outcome | Before | After |
|---|---:|---:|
| Invalid native worlds completing | 10 / 10 | 0 / 10 |
| Invalid CLI invocations exiting 0 | 8 / 8 | 0 / 8 |
| Valid native workflows unchanged | reference | 96 / 96 |
| Valid CLI results unchanged | reference | 12 / 12 |
| Subprocess timeouts | 0 | 0 |

Every invalid native input now throws before the world runs; every invalid CLI input exits 1 with the diagnostic and no JSON. Valid native metrics, population, event count, normalized full record hash, channel hash and persona-memory hash remain identical. Only run IDs and elapsed wall time are removed. Complete valid CLI metrics are compared after removing run ID; subprocess elapsed time is excluded. This is exact deterministic equality, not a statistical improvement claim. Seeds 11 and 23 are additional controls beyond the initial seed-1 probe and seed-7 populated reproduction.

## safety_gates

All 108 valid workflows retain zero invariant violations, canary leaks and minor contacts. The invalid baseline workflows also have zero in these fields; rejection corrects their configuration rather than claiming a safety or matching-quality gain. The native ConsentNetwork uses simulated auto review; StubNetwork has no review or leak guard.

Fresh `bun run sim --only network,safety,audit,ops`: 108 blocking gates and three tracked checks pass on both revisions. All 111 gate records match after excluding per-gate durations and the backup restore duration in its label. Base: 357.1 seconds; candidate: 385.9 seconds.

No thresholds, gate classifications, dispatch or matching code changes. AGENTS.md limits each agent to one full `bun run sim`; that allowance was used earlier in this contribution session. Fresh affected-block runs are reported here, not a fresh all-block run.

## Validation

Windows, Bun 1.4.2, PostgreSQL 16.15 on isolated localhost port 54339 with `REQUIRE_PG=1`. Frozen installation made no changes. Provider, live-send and deployment flags were cleared. All data is synthetic and local.

- Typecheck: all four configurations passed.
- Integration, including the security suite: 676 pass, 8 skip, 6 fail; 13,760 assertions. Ran 690 tests across 69 files. [494.14s]
- The new regression passed in the official integration command in 2468.72 ms.
- The six failures match the baseline by name and cause: missing /bin/bash, SIGTERM exit 143 versus 0, and four Windows path assertions.
- The eight optional integration skips match the preceding completed run.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions. Ran 43 tests across 3 files. [47.93s]
- The optional browser SDK case was skipped. The isolated database was stopped after validation.

A fully green local integration suite is not claimed.

## llm_evidence and agent_clients

This numeric scheduler guard does not change model-backed behavior. Live LLM paths were not tested: zero model calls, $0. The native policy personas and networks above ran without mocked model outputs. Live persona enrichment, LLM judges and member-facing agent clients are not claimed as qualified.

Codex desktop 26.1103.7773.0 drove Bun on Windows. Contribution provider: OpenAI; exact contribution model metadata is unavailable. No browser or computer use was used. Other clients were not tested.

## Limits

The change rejects invalid speed values; it does not change timer granularity, pace the final empty tail of a world, or solve insertion during an active wait. Very small positive speeds can still exceed the runtime's maximum timer duration; that existing timer-range behavior is outside this guard. Scenario mode has its own discrete runner and does not use the CLI's accelerated speed option. Real-time demo accuracy over long periods is not established by these short controls.

## Reproduce

After `bun install --frozen-lockfile` and local PostgreSQL setup for the broad checks:

```sh
bun test --conditions eliza-source packages/sim/test/speed.integration.test.ts
bun run typecheck
bun run sim --only network,safety,audit,ops --json ../sim-speed-gates-after.json
bun run test:integration
bun run test:e2e
```

Save the programs below beside two independent checkouts at base and candidate, then run from their parent directory:

```sh
bun run --conditions eliza-source sim-speed-measure.ts friends-crew-base sim-speed-before.json
bun run --conditions eliza-source sim-speed-measure.ts thenetwork sim-speed-after.json
bun run sim-speed-compare.ts
```

The programs are manually specified measurement logic, authored with Codex; generated output comes from the repository's native worlds and CLI.

### Measurement program

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [rootArg, output] = process.argv.slice(2), root = resolve(rootArg!);
const from = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { World, StubNetwork, generatePersonas, DEFAULT_START } = await from("packages/sim/src/index.ts");
const { ConsentNetwork } = await from("packages/network/src/index.ts");
const hash = (x: any) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const configs = [
  ...[undefined, 0.5, 1, 2, 1440, 86400].map(speed => ({ mode: "accelerated", speed })),
  ...["discrete", "realtime"].flatMap(mode => [undefined, NaN, 0].map(speed => ({ mode, speed }))),
];
const invalid = [NaN, Infinity, -Infinity, 0, -1];
const native: any[] = [], cli: any[] = [];
async function runNative(seed: number, networkName: string, config: any, valid: boolean) {
  const id = `${seed}:${networkName}:${config.mode}:${String(config.speed)}`, began = performance.now();
  try {
    const personas = generatePersonas({ n: 12, seed, cityWeights: { nyc: 1, sf: 0 } });
    const network = networkName === "consent" ? new ConsentNetwork({ seed, review: "auto" }) : new StubNetwork({ seed });
    const actions = [
      { at: DEFAULT_START + 10, action: { do: "join", persona: personas[0].id } },
      { at: DEFAULT_START + 30, action: { do: "join", persona: personas[1].id } },
      { at: DEFAULT_START + 80, action: { do: "say", persona: personas[0].id, text: "I enjoy hiking and coffee with friends." } },
      { at: DEFAULT_START + 100, action: { do: "opt_out", persona: personas[1].id } },
    ];
    const world = new World({ seed, personas, network, days: 120 / 86400000, actions, writeLog: false, ...config });
    const result = await world.run();
    const records = result.records.map((r: any) => {
      if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
      if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
      return r;
    });
    const { runId, ...run } = result.metrics.run;
    native.push({ id, valid, completed: true, recordsHash: hash(records), populationHash: hash(personas),
      channelHash: hash(result.channel.all()), memoriesHash: hash([...result.memories]), events: result.events,
      metrics: { ...result.metrics, run }, wallMs: Math.round(performance.now() - began) });
  } catch (error) { native.push({ id, valid, completed: false, error: String((error as Error).message) }); }
}
for (const seed of [1, 7, 11, 23]) for (const network of ["stub", "consent"]) for (const config of configs) await runNative(seed, network, config, true);
for (const network of ["stub", "consent"]) for (const speed of invalid) await runNative(7, network, { mode: "accelerated", speed }, false);
async function runCli(seed: number, network: string, args: string[], valid: boolean) {
  const began = performance.now();
  const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/sim/src/cli.ts",
    "--personas", "80", "--days", "1", "--seed", String(seed), "--network", network, "--no-log", "--json", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10000);
  try {
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    let metrics;
    try { metrics = JSON.parse(out); delete metrics.run.runId; } catch {}
    cli.push({ seed, network, args, valid, exit, timedOut, metrics, outputEmpty: out.trim() === "",
      diagnostic: err.includes("accelerated speed must be a positive finite number"), wallMs: Math.round(performance.now() - began) });
  } finally { clearTimeout(timer); }
}
const validArgs = [["--mode=accelerated", "--speed=86400"], ["--mode=accelerated", "--speed=1e6"], ["--mode=discrete", "--speed=NaN"]];
for (const seed of [1, 7, 11, 23]) for (const args of validArgs) await runCli(seed, "stub", args, true);
for (const value of [...invalid.map(String), "bad", "", " "]) await runCli(7, "stub", ["--mode=accelerated", `--speed=${value}`], false);
await Bun.write(output!, JSON.stringify({ native, cli }, null, 2));
console.log(JSON.stringify({ native: native.length, nativeCompleted: native.filter(r => r.completed).length, cli: cli.length,
  cliExitZero: cli.filter(r => r.exit === 0).length, timeouts: cli.filter(r => r.timedOut).length }));
```

### Comparison program

```ts
import { strict as assert } from "node:assert";
const before = await Bun.file("sim-speed-before.json").json(), after = await Bun.file("sim-speed-after.json").json();
assert.equal(before.native.length, 106); assert.equal(after.native.length, 106);
assert.equal(before.cli.length, 20); assert.equal(after.cli.length, 20);
const safety = (m: any) => [m.invariants.total, m.privacy.canaryLeaks, m.safety.minorContacts];
let nativeUnchanged = 0, nativeRejected = 0, cliUnchanged = 0, cliRejected = 0;
for (let i = 0; i < before.native.length; i++) {
  const b = before.native[i], a = after.native[i];
  assert.equal(a.id, b.id); assert.equal(a.valid, b.valid); assert.equal(b.completed, true);
  assert.equal(b.metrics.run.joined, 2); assert.equal(b.metrics.experience.optOuts, 1);
  assert.equal(b.metrics.errors, 0);
  assert(b.events >= 10); assert.deepEqual(safety(b.metrics), [0, 0, 0]);
  if (b.valid) {
    const { wallMs: bw, ...bn } = b, { wallMs: aw, ...an } = a;
    assert.deepEqual(an, bn); nativeUnchanged++;
  } else {
    assert.equal(a.completed, false); assert.equal(a.error, "accelerated speed must be a positive finite number"); nativeRejected++;
  }
}
for (let i = 0; i < before.cli.length; i++) {
  const b = before.cli[i], a = after.cli[i];
  assert.deepEqual([a.seed, a.network, a.args, a.valid], [b.seed, b.network, b.args, b.valid]);
  assert.equal(b.timedOut, false); assert.equal(a.timedOut, false); assert.equal(b.exit, 0);
  assert(b.metrics.run.joined > 0); assert.deepEqual(safety(b.metrics), [0, 0, 0]);
  assert.equal(b.metrics.errors, 0);
  if (b.valid) {
    const { wallMs: bw, ...bn } = b, { wallMs: aw, ...an } = a;
    assert.deepEqual(an, bn); cliUnchanged++;
  } else {
    assert.equal(a.exit, 1); assert.equal(a.outputEmpty, true); assert.equal(a.diagnostic, true);
    assert.equal(a.metrics, undefined); assert.equal(b.metrics.run.joined, 65); cliRejected++;
  }
}
assert.deepEqual([nativeUnchanged, nativeRejected, cliUnchanged, cliRejected], [96, 10, 12, 8]);
const range = (rows: any[]) => [Math.min(...rows.map(r => r.wallMs)), Math.max(...rows.map(r => r.wallMs))];
const result = { nativeUnchanged, nativeRejected, cliUnchanged, cliRejected,
  invalidCliBeforeWallMs: range(before.cli.filter((r: any) => !r.valid)),
  speed86400BeforeWallMs: range(before.cli.filter((r: any) => r.args.includes("--speed=86400"))),
  nativeSafetyAllZero: true, cliSafetyAllZero: true, timeouts: 0 };
await Bun.write("sim-speed-comparison.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
```
