# Restore routine requests after START

Date: 2026-11-07. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement and cause

PRD 34.3 requires persona actions at times drawn from their routines.
The simulator README includes routine requests, trip announcements and adversarial messages.
This fixes a reproduced simulator defect under CONTRIBUTING 3.1.

When an initiative check ran during STOP, `onInitiative` did not schedule another check.
START cleared the member's opt-out state but did not recreate the routine timer.
The member could reply again, but could never initiate another request.

Keep scheduling the normal routine until the simulation ends.
The existing opt-out guard still skips the agent call and message while stopped.
START allows the next normal check to act; it does not send an immediate request.
The timing RNG is a separate fork and does not advance the parent RNG.

Alternatives considered:

1. Schedule a new timer on START. This needs tracking or cancellation to avoid duplicate timers after short pauses.
2. Poll every simulation tick. This adds frequent checks and changes the normal routine cadence.

## Regression evidence

One integration case runs nine complete worlds: seeds 1, 2 and 3, each with resumed, permanently stopped and active members.
It uses the existing STOP persona, real policy agent, scheduler and simulated channel.
The repository's StubNetwork has random introductions disabled to isolate routine requests.
No agent responses, clock callbacks, metrics or log records are mocked.

Each world lasts 45 days. The persona joins at 09:00 SF on day 0.
STOP occurs at 20:00 that day, before the first routine check.
The resumed member sends canonical START at 11:00 on day 7.
The active control sends neither command.
Requests count only when an `ask` memory signal has a matching inbound channel record.

```sh
bun test --conditions eliza-source packages/sim/test/initiative-resume.integration.test.ts
```

Run the same new test on the base revision, then with the source fix.

| Result | Before | After |
|---|---|---|
| Regression | 0 pass, 1 fail; 1 assertion | 1 pass, 0 fail; 1 assertion |
| Case duration | 71.13 ms | 71.67 ms |
| Command duration | 116 ms | 117 ms |

The three resumed worlds failed before the fix and pass afterwards.
The case also checks stopped-member silence, final opt-out state, runtime errors and invariants.
It runs `runWorld`, not the original STOP-only scenario's permanent-stop grader.
That fixture and its expectations stay unchanged.

## measurement

The wider comparison uses 767 paired worlds on the same base and fixed source.
There are 720 single-person worlds: seeds 1-120 across the six variants below.
An initial probe used seeds 1-24; seeds 25-120 were not used to choose the fix.
The script also runs 20 generated worlds and all nine existing scenarios on three seeds each.

| Variant, 120 worlds each | Requests before | Requests after | Members requesting before / after |
|---|---:|---:|---:|
| STOP day 0; START day 7 | 0 | 265 | 0 / 104 |
| Permanently stopped | 0 | 0 | 0 / 0 |
| Always active | 265 | 265 | 104 / 104 |
| Short pause; START day 1 at 09:00 | 265 | 265 | 104 / 104 |
| Second STOP day 21; second START day 28 | 0 | 119 | 0 / 78 |
| Forced silence day 5; START day 7 | 0 | 0 | 0 / 0 |

Requests count after day 7 at 11:00, except the repeated cycle, which counts after day 28 at 11:00.
All times use SF. These synthetic counts are deterministic, not an estimate of member demand.
After the fix, all 120 resumed request schedules match their always-active controls after day 7.
No persona messages occur while opted out in any variant, before or after.

All 527 control worlds retain identical metrics and behavioral records.
For 287 controls, the complete record hash is identical after removing only wall-clock duration.
The other 240 are the permanent-stop and forced-silence controls.
Their only record difference is the processed-event count at run end.
No message, decision, outcome or other record field is excluded from that comparison.
All 767 persona hashes and all 27 original scenario grades stay identical.

The 120 permanent-stop worlds process 136,100 events before and 136,789 afterwards: 689 extra dormant checks, about 0.51%.
The maximum increase is 11 events in one 45-day permanent-stop world.
Forced-silence controls also add 689 checks, with the same maximum.
This is scheduler overhead, not extra agent calls while opted out.
No wall-time performance improvement is claimed.

The 720 lifecycle worlds and 27 scenario controls have zero invariant findings before and after.
The 20 generated controls retain three existing `decliner_exposed` findings, with identical traces.
Runtime errors, minor contacts and canary leaks remain zero across all 767 paired worlds.
No policy, safety threshold, matching rule or gate classification changes.

## Reproduce the wider comparison

Save the following script outside the checkout as `initiative-resume-measure.ts`.
Run it against separate base and fixed checkouts, each with its frozen dependencies installed.

```sh
bun run --conditions eliza-source ../initiative-resume-measure.ts ../base > ../before.jsonl
bun run --conditions eliza-source ../initiative-resume-measure.ts . > ../after.jsonl
```

Pair rows by `kind` and `seed`.
Compare `metrics`, `results`, `personas`, request timestamps and both trace hashes.
The second hash also removes only `run_end.stats.events` to distinguish dormant checks from behavioral changes.
The script and scenario variants are hand-configured; personas and outcomes come from the existing simulator.


```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]!);
const { loadScenario, scenarioWorldOptions, runScenario } = await import(pathToFileURL(resolve(root, "packages/sim/src/scenario.ts")).href);
const { runWorld, DEFAULT_START } = await import(pathToFileURL(resolve(root, "packages/sim/src/world.ts")).href);
const { StubNetwork } = await import(pathToFileURL(resolve(root, "packages/sim/src/stubNetwork.ts")).href);
const { generatePersonas } = await import(pathToFileURL(resolve(root, "packages/sim/src/generator.ts")).href);
const DAY = 86_400_000, HOUR = 3_600_000;
const fixture = await loadScenario(resolve(root, "packages/sim/scenarios/stop-keyword.json"));
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
function emit(seed: number, kind: string, world: any, cutoff?: number, results?: any) {
  const inbound = world.records.flatMap((r: any) => r.type === "message" && r.msg.direction === "inbound" && r.msg.memberId === "quitter" ? [r.msg] : []);
  let stopped = false, whileStopped = 0;
  for (const m of inbound) { if (m.keyword === "STOP") stopped = true; else if (m.keyword === "START") stopped = false; else if (stopped) whileStopped++; }
  const requestTimes = (world.memories.get("quitter")?.signals ?? []).filter((x: any) => x.source === "ask" && (cutoff === undefined || x.at > cutoff) && inbound.some((m: any) => m.ts === x.at)).map((x: any) => x.at);
  console.log(JSON.stringify({ seed, kind, requestTimes, whileStopped, events: world.events,
    trace: digest(world.records.map((r: any) => r.type === "run_end" ? { ...r, wallMs: 0 } : r)),
    traceWithoutEventCount: digest(world.records.map((r: any) => r.type === "run_end" ? { ...r, wallMs: 0, stats: { ...r.stats, events: 0 } } : r)),
    personas: digest(world.personas), metrics: world.metrics, results }));
}
for (let seed = 1; seed <= 120; seed++) for (const kind of ["resumed", "stopped", "active", "short-pause", "twice", "silent-resume"]) {
  const s = structuredClone(fixture);
  s.days = 45; s.background = { personas: 0 }; s.stub = { randomIntros: false };
  s.actions = kind === "active" ? [] : [{ do: "opt_out", persona: "quitter", at: { day: 0, hour: 20 } }];
  if (!["active", "stopped"].includes(kind)) s.actions.push({ do: "say", persona: "quitter", text: "START", at: { day: kind === "short-pause" ? 1 : 7, hour: kind === "short-pause" ? 9 : 11 } });
  if (kind === "twice") s.actions.push({ do: "opt_out", persona: "quitter", at: { day: 21, hour: 11 } }, { do: "say", persona: "quitter", text: "START", at: { day: 28, hour: 11 } });
  if (kind === "silent-resume") s.actions.push({ do: "go_silent", persona: "quitter", at: { day: 5, hour: 12 } });
  const wo = scenarioWorldOptions(s, { seed, writeLog: false, network: (x: any) => new StubNetwork({ seed, ...x.stub }) });
  emit(seed, kind, await runWorld(wo), DEFAULT_START + (kind === "twice" ? 28 : 7) * DAY + 11 * HOUR);
}
for (let seed = 1; seed <= 20; seed++) {
  const world = await runWorld({ seed, personas: generatePersonas({ n: 40, seed }), days: 30, runId: `initiative-random-${seed}`, writeLog: false, network: new StubNetwork({ seed }) });
  emit(seed, "random", world);
}
for (const file of (await readdir(resolve(root, "packages/sim/scenarios"))).filter(x => x.endsWith(".json")).sort()) {
  const s = await loadScenario(resolve(root, "packages/sim/scenarios", file));
  for (let delta = 0; delta < 3; delta++) {
    const seed = s.seed + delta;
    const r = await runScenario(structuredClone(s), { seed, writeLog: false, network: (x: any) => new StubNetwork({ seed, ...x.stub }) });
    emit(seed, file, r.world, undefined, r.results);
  }
}
```

## safety_gates

```sh
bun run sim --only network,slop,safety,audit --json ../gates.json
```

The base evidence reuses a completed run on the identical clean base revision, with identical dependencies and PostgreSQL setup.
The fixed source was measured afresh. Neither run uses `--quick`.

| Block | Blocking gates before / after | Gate records | Seconds before / after |
|---|---:|---:|---:|
| Network | 61 / 61 | 63 | 187.9 / 153.9 |
| Slop | 39 / 39 | 57 | 34.3 / 28.9 |
| Safety | 17 / 17 | 17 | 9.6 / 7.4 |
| Audit | 16 / 16 | 16 | 23.9 / 17.4 |
| Total | 133 / 133 | 153 | 255.7 / 207.5 |

All 153 gate objects match, excluding only each gate's elapsed time.
Names, results, details and blocking classifications stay identical.
Eight tracked gates remain off target; they are not counted as passes.
The run uses the blocks' pinned defaults, including Network seeds 1-3 and Slop seeds 13-16.
The Slop live-world arm uses seeds 21-22.
The unmodified scripts define each remaining corpus and seed.
Simulations use the simulated reviewer, not human approval of synthetic proposals.
These are the blocks that exercise the generic World or its scenario consumers.
A full simulation was already run earlier in this agent session and was not repeated, per AGENTS.md's one-full-run limit.

## Full service validation

| Command | Result |
|---|---|
| `bun run typecheck` | All four configurations pass; exit 0 |
| `bun run test:integration` | 676 pass, 8 skip, 6 known failures; 13,742 assertions; 440.64 seconds |
| New regression inside integration | Pass; 72.42 ms |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 37.47 seconds |

Integration includes the security suite.
All six failures match the recorded base failures by test name and underlying cause:
missing `/bin/bash` for Wrangler, SIGTERM exit 143 instead of 0, and four Windows path assertions in `sites/test/sites.test.ts`.
The eight integration skips are optional cleanup-reconciliation cases.
The end-to-end skip requires the optional browser SDK setup; it was not enabled.
A fully green local integration suite is not claimed.

An initial integration attempt was interrupted when local PostgreSQL exited with Windows exception `0xC000026B`.
A replacement attempt started during database recovery and was stopped before completion.
Neither incomplete attempt counts as a qualification result.
The final run began after PostgreSQL accepted connections and answered `SHOW port` with `54339`.
The completed simulation gate run was preserved and not repeated.
The isolated database was stopped after qualification and a zero-client check.

## llm_evidence and agent_clients

The timer decision does not call a model. These runs use the real deterministic policy agent and simulated networks.
Real-model calls: 0. Cost: $0. Model request settings: N/A.
Model-written initiative content and model-backed outcomes were not qualified.
No member-facing client interface changes; no external agent client is claimed as tested.
Codex desktop 26.1029.7803.0 drove the measurements through Bun 1.4.2.
The final integration and end-to-end qualification uses Codex desktop 26.1103.3517.0 after the environment resumed.
Provider: OpenAI. The exact assistant model identifier was not exposed; attribution uses the disclosure helper's supported `unavailable` value.
No computer or browser UI automation was used.

## Limits

Stopped personas retain one recurring routine timer, bounded by the simulation end.
The event-count increase is expected and documented above.
A resumed member waits for the next routine check and may still choose not to ask.
The fix does not promise every member sends a request within a fixed number of days.

The canonical START path already clears the channel and persona flags.
This branch is independent of #385, which fixes acceptance of START aliases in the simulator.
No combined qualification with other open PRs is claimed.
Production consent handling, message copy and member interfaces do not change.
There were no live sends or deployments, and no credentials, member data or raw conversation logs are included.
