# Grade STOP intervals through later START commands

Date: 2026-11-07. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement, cause and fix

PRD F20 says STOP takes effect immediately and members can resume at any time.
PRD 34.3 requires scenario grading from the completed world.
This fixes a reproduced simulation-validation defect under CONTRIBUTING 3.1.

`no_messages_after_stop` counted every delivered message after the first STOP timestamp.
It ignored later START commands.
A valid welcome-back reply and requested information therefore failed the scenario.
The separate consent invariants correctly reported zero violations in these runs.

Replay the selected persona's recorded STOP and START commands in order.
Count delivered, non-system outbound messages only while that persona is stopped.
A later STOP starts a new blocked interval.
Record order also distinguishes messages and commands sharing one timestamp.
The check still fails when no STOP occurred.
The existing system-message and delivery-status exemptions stay unchanged.

Alternatives considered:

1. Ignore all messages when any START exists. This misses messages before that START and after a later STOP.
2. Check only the final STOP. This discards earlier blocked intervals.

## Regression evidence

One integration case runs 12 complete worlds: seeds 1-3 across four variants.
It uses the existing STOP persona, real policy agent, channel and scenario grader.
The repository's StubNetwork disables random introductions to isolate the conversation.
No agent output, delivery record or metric is fabricated.

The six-day scenario joins at 09:00 SF on day 0 and sends STOP at 11:00 on day 2.
The resumed variant sends START at 11:00 on day 3, then asks about gardening classes at noon.
The same-time variant sends STOP and START at 11:00 on day 2, in that order, then asks at noon.
Both variants send another STOP at 11:00 on day 4.
The other variants keep the original permanent STOP or omit STOP entirely.

Six extra grading replays deliberately omit the recorded inbound START while retaining every actual delivery.
Those replays must fail and count both delivered messages, including a message at the STOP timestamp.
This is missing-consent-evidence fault injection, not a claim that the real channel delivered while opted out.

```sh
bun test --conditions eliza-source packages/sim/test/stop-intervals.integration.test.ts
```

Copy this new test into the clean base checkout to reproduce the failure.
Run the same test with the source fix to reproduce the pass.

| Result | Before | After |
|---|---|---|
| Integration case | 0 pass, 1 fail; 1 assertion | 1 pass, 0 fail; 1 assertion |
| Case duration | 32.84 ms | 31.50 ms |
| Command duration | 256 ms | 85 ms |

The base has six false failures for permitted resumptions.
It also undercounts three same-time fault replays.
All 12 worlds retain zero invariant findings and runtime errors.

## measurement

The wider comparison uses 867 paired worlds: 120 seeds across seven lifecycle variants, plus all nine original scenarios on three seeds.
The original scenarios use their fixture seed and the next two seeds.
Only seeds 1-3 were used to choose the fix; seeds 4-120 were additional checks.

| Variant | Worlds | Incorrect status before / after |
|---|---:|---:|
| START on day 3; STOP again on day 4 | 120 | 120 / 0 |
| STOP and START at the same time; STOP again on day 4 | 120 | 120 / 0 |
| Two resume cycles; final STOP on day 6 | 120 | 120 / 0 |
| Permanent STOP | 120 | 0 / 0 |
| No STOP; must fail | 120 | 0 / 0 |
| START before the only STOP | 120 | 0 / 0 |
| Another persona resumes; target remains stopped | 120 | 0 / 0 |

All 360 false failures become passes.
All 507 control worlds, including the 27 original scenario runs, retain identical grades.
Every world's trace, metrics and generated personas remain identical before and after.
Trace hashing removes only `run_end.wallMs`; no message, event counter, decision or outcome is excluded.
Every other expectation result remains identical.

The 360 missing-START replays all fail before and after.
Their counted deliveries increase from 906 to the expected 1,027.
The difference is 121 deliveries sharing the first STOP timestamp, previously missed by strict timestamp comparison.
These are deterministic grading corrections, not estimates of production behavior or statistical quality improvements.

All 867 complete worlds retain zero invariant findings, runtime errors, minor contacts and canary leaks.
No channel behavior, send policy, matching rule, safety threshold or gate classification changes.

## Reproduce the wider comparison

Save this script outside the checkout as `stop-interval-measure.ts`.
Install frozen dependencies in separate base and fixed checkouts, then run:

```sh
bun run --conditions eliza-source ../stop-interval-measure.ts ../base > ../before.jsonl
bun run --conditions eliza-source ../stop-interval-measure.ts . > ../after.jsonl
```

Pair rows by `kind` and `seed`; compare grades, replay counts, metric objects, trace hashes and persona hashes.
The script and variants are hand-configured. The existing simulator generates the personas and outcomes.


```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]!);
const { loadScenario, runScenario, evaluateExpectations } = await import(pathToFileURL(resolve(root, "packages/sim/src/scenario.ts")).href);
const { StubNetwork } = await import(pathToFileURL(resolve(root, "packages/sim/src/stubNetwork.ts")).href);
const fixture = await loadScenario(resolve(root, "packages/sim/scenarios/stop-keyword.json"));
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
async function measure(s: any, seed: number, kind: string, want?: string) {
  const r = await runScenario(s, { seed, writeLog: false, network: (x: any) => new StubNetwork({ seed, ...x.stub }) });
  const records = r.world.records;
  let replay;
  if (["resumed", "same-time", "repeated"].includes(kind)) {
    const stop = records.findIndex((x: any) => x.type === "message" && x.msg.memberId === "quitter" && x.msg.keyword === "STOP");
    const expectedCount = records.slice(stop + 1).filter((x: any) => x.type === "message" && x.msg.memberId === "quitter" && x.msg.direction === "outbound" && !x.msg.system && x.msg.status === "delivered").length;
    const retained = records.filter((x: any) => !(x.type === "message" && x.msg.memberId === "quitter" && x.msg.direction === "inbound" && x.msg.keyword === "START"));
    const graded = evaluateExpectations(s, { ...r.world, records: retained }, "stub")[0];
    replay = { expectedCount, status: graded.status, counted: Number.parseInt(graded.detail) };
  }
  console.log(JSON.stringify({ seed, kind, want, results: r.results, replay, metrics: r.world.metrics,
    trace: hash(records.map((x: any) => x.type === "run_end" ? { ...x, wallMs: 0 } : x)), personas: hash(r.world.personas) }));
}
for (let seed = 1; seed <= 120; seed++) for (const kind of ["resumed", "same-time", "repeated", "stopped", "no-stop", "start-before-stop", "other-resume"]) {
  const s = structuredClone(fixture);
  s.days = 8; s.background = { personas: 0 }; s.stub = { randomIntros: false };
  const start = (persona: string, day: number) => [
    { do: "say", persona, text: "START", at: { day, hour: 11 } },
    { do: "say", persona, text: "Any gardening classes nearby this weekend?", at: { day, hour: 12 } },
  ];
  if (kind === "no-stop") s.actions = [];
  if (["resumed", "same-time", "repeated"].includes(kind)) {
    s.actions.push(...start("quitter", kind === "same-time" ? 2 : 3), { do: "opt_out", persona: "quitter", at: { day: 4, hour: 11 } });
    if (kind === "repeated") s.actions.push(...start("quitter", 5), { do: "opt_out", persona: "quitter", at: { day: 6, hour: 11 } });
  }
  if (kind === "start-before-stop") s.actions.push(...start("quitter", 1));
  if (kind === "other-resume") {
    s.personas.push({ ...structuredClone(s.personas[0]), ref: "other", name: "Jordan Reed" });
    s.actions.push({ do: "opt_out", persona: "other", at: { day: 2, hour: 12 } }, ...start("other", 3));
  }
  await measure(s, seed, kind, kind === "no-stop" ? "fail" : "pass");
}
for (const file of (await readdir(resolve(root, "packages/sim/scenarios"))).filter(x => x.endsWith(".json")).sort()) {
  const s = await loadScenario(resolve(root, "packages/sim/scenarios", file));
  for (let delta = 0; delta < 3; delta++) await measure(structuredClone(s), s.seed + delta, file);
}
```

## safety_gates

```sh
bun run sim --only network --json ../gates.json
```

| Result | Before | After |
|---|---|---|
| Blocking Network gates | 61 / 61 | 61 / 61 |
| Gate records | 63 | 63, all identical |
| Duration | 156 seconds | 203.2 seconds |

The base evidence reuses a completed run on the identical clean base revision, with the same dependencies and PostgreSQL setup.
The fixed source was measured afresh. Neither run uses `--quick`.
Gate comparison excludes only elapsed time; names, details, results and blocking classifications stay identical.
Both tracked gates remain on target and are excluded from the 61 blocking passes.
The block uses pinned seeds 1-3, the existing NYC scenarios, all simulator scenarios at pass^3, and conformance seeds 1-4.
Simulations use the simulated reviewer, not human approval of synthetic proposals.
Network is the official block that calls this scenario grader.
The full simulation was already run earlier in this agent session and was not repeated, per AGENTS.md's one-full-run limit.

## Full service validation

| Command | Result |
|---|---|
| `bun run typecheck` | All four configurations pass; exit 0 |
| `bun run test:integration` | 676 pass, 8 skip, 6 known failures; 13,742 assertions; 453.76 seconds |
| New regression inside integration | Pass; 24.41 ms |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 36.07 seconds |

Integration includes the security suite.
All six failures match the recorded base failures by test name and underlying cause:
missing `/bin/bash` for Wrangler, SIGTERM exit 143 instead of 0, and four Windows path assertions in `sites/test/sites.test.ts`.
The eight integration skips are optional cleanup-reconciliation cases.
The end-to-end skip requires the optional browser SDK setup; it was not enabled.
A fully green local integration suite is not claimed.
The isolated database was stopped after qualification and a zero-client check.

## llm_evidence

The grader reads recorded keywords and delivery states; it does not call a model.
These runs use the repository's real deterministic policy agent and simulated network.
Real-model calls: 0. Cost: $0. Model request settings: N/A.
Model-generated transcripts and model-backed outcomes were not qualified.

## agent_clients

No member-facing client interface changes; no external agent client is claimed as tested.
Codex desktop 26.1103.3517.0 drove Bun 1.4.2 through the command line.
Provider: OpenAI. The exact assistant model identifier was not exposed; attribution uses the disclosure helper's supported `unavailable` value.
No computer or browser UI automation was used.

## Limits

The grader follows the run log's execution order and recognized keyword metadata, including events with equal timestamps.
It does not infer consent from message wording or outbound acknowledgements.
The missing-START replay controls intentionally remove evidence; they do not modify any real simulated delivery.
The normal world traces and metrics remain untouched.

This branch is independent of #385's resume aliases and #389's routine timer.
It uses canonical START already supported on main. No combined qualification is claimed.
Production consent handling, channel delivery, message copy and member interfaces do not change.
No live sends, deployments, credentials, member data or raw conversation logs are included.
