# Refusals must not become repeat-meeting interest

Date: 2026-11-08. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (`main`).
Scope: a reproduced simulation defect under CONTRIBUTING section 3.1 and the approved Slop bug-fix scope.
PRD sections 34.3–34.4 require realistic member decisions and accurate simulation outcomes.
`docs/results/2026-10-08-plans.md` documents repeat plans and crews based on attendees saying they would meet again.
`planAgainEdges` explicitly promises to derive repeat interest from members' answers after a plan.

## Problem and change

The simulator's reference parser omitted explicit refusals already understood by the Network:
`nope`, `won't do this/that/it again`, `won't go again`, `not again`, and `never again`.
An answer containing one of these forms and the word `again` fell through to the positive pattern.
The next matching snapshot then contained an explicit `would_interact_again` edge for a member who refused.

The fix adds those forms to the existing refusal pattern, before the positive check.
The attendance-fact check remains first. The parser still returns `yes`, `no`, or `unclear`.
No Network parser, matching threshold, model prompt, or policy changes.

An initial candidate matched any `won't`. Review caught that this would turn the affirmative
"Yes, I won't miss doing that again" from `yes` to `no`. The final pattern requires an explicit
`won't do this/that/it again` or `won't go again` phrase instead. The same integration case
includes this affirmative control. Results below qualify the final pattern.

Alternatives:

1. Filter edges after parsing. This leaves the reference parser incorrect for other callers.
2. Remove repeat-interest reconstruction. This discards positive feedback and breaks the existing simulator contract.
3. Import the Network's parser into this reference parser. Keeping the simulator's interpretation independent avoids coupling both sides of the comparison.

PR #272 changes broader phrases in the Network's `planAgainOf` classifier.
It does not change this simulator parser or its snapshot consumer. The four refusal replies below already return `no` on current `main` there.
The production parser's broader `won't` handling still misreads the added affirmative control;
that existing discrepancy is recorded here and is outside this simulator fix.

## measurement

Runtime: Windows, PowerShell 7.6.9, Bun 1.4.2, PostgreSQL 16.15 for qualification.
The frozen dependency install succeeded without manifest or lockfile changes.

One integration case uses the real World, ConsentNetwork, policy personas, channel, plan outcomes, and matching snapshot builder.
It loads the repository's 250 synthetic NYC personas with seed 4, automatic review, plans enabled, and channel failure rate 0.15.
The world has a 21-day cap. It advances until a delivered feedback question follows a held plan.
Discovery finds question `o002750` at day 10.7951388889 for member `ny-0033`, after plan `nw-4-123`.
That member and `ny-0093` actually attended.

Each answer uses a fresh deterministic replay to that question's time.
A scripted member action sends the answer through the actual channel.
The check reads the next matching snapshot one millisecond later, before the scheduled automatic persona reply.
It asserts that the member's answer arrived and that no repeat-interest edge existed beforehand.
No proposal, attendance, inbound message record, or edge is fabricated.

| Actual channel answer | Network classifier | Edges on base | Edges after fix |
|---|---|---:|---:|
| Never again. | no | 1 | 0 |
| Not again, thanks. | no | 1 | 0 |
| I won't do that again. | no | 1 | 0 |
| Nope, not doing that again. | no | 1 | 0 |
| Yes, I'd do it again! | yes | 1 | 1 |
| Yes, I won't miss doing that again. | no (existing production discrepancy) | 1 | 1 |

The false edges point from the refusing attendee to the other actual attendee.
This proves an incorrect matching input, not that a later engine run selected another meeting.
The six replay prefixes are controlled cases, not independent population samples or complete 21-day runs.
No statistical improvement or live-member outcome claim is made.

Run the same final case on both revisions:

```sh
bun test --conditions eliza-source packages/sim/test/negative-repeat-feedback.integration.test.ts
```

| Revision | Result | Assertions | Elapsed |
|---|---|---:|---:|
| Base with only the new case copied in | 0 pass, 1 fail | 20 | 49.98s |
| Fixed parser | 1 pass, 0 fail | 20 | 49.87s |

The separate measurement program below runs the same six replies and records before/after fingerprints.
It compares every run record except start/end envelopes, plus all judge metrics with only the run ID normalized.
All six record and metric fingerprints match. Each replay retains zero canary leaks, minor contacts, invariant violations, and runtime errors.
Expected labels come from the explicit replies, not from agreement with the production classifier.

An external, hand-labelled 26-answer corpus adds five refusal variants beyond the four integration replies.
It also includes all eight generated `planAgainText` replies, ordinary affirmative controls, and unclear attendance or preference answers.
The corpus is supplementary measurement; the committed regression exercises the real workflow.
Errors fall from 9/26 to 0/26. All eight generated replies retain their previous interpretation.
Three affirmative `won't` phrases check that the new refusal pattern does not match them.

## safety_gates and qualification

| Command | Result |
|---|---|
| `bun run typecheck` | All four configurations pass |
| `bun run sim --only network,safety,audit --json <output>` on base | 94/94 blocking gates pass; zero tracked misses; 181.4s |
| Same command on final fix | 94/94 blocking gates pass; zero tracked misses; 175.9s |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,761 assertions; 587.37s |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 68.82s |

All 96 gate records match between base and the final fix after removing only elapsed time.
Gate names, values, classifications, thresholds, and details retain their values.

The six integration failures have the same names and underlying causes as the recorded base failures:

- The Wrangler OS-session check cannot spawn `/bin/bash` on this Windows machine (`ENOENT`, `uv_spawn`).
- The backend boot check receives exit 143 after SIGTERM instead of its expected 0.
- Four site-build checks fail on Windows paths for `.well-known/agent-skills/index.json`.

The suite is not green. Its eight skips belong to completed-cleanup reconciliation, which requires
`NETWORK_RETRY_RECONCILIATION_TEST=1` and a separate database URL.
The e2e skip is the optional browser-SDK case that requires `PLAYWRIGHT_MODULE`.

The affected-block command uses the repository's pinned settings, with no `--quick` flag:
Network invariants use seed 3 for 10 days; consent uses seeds 1–3 for 21 days against push seed 1;
engine conformance uses seeds 1–4; audit uses seed 3 for nine days.
Scenario files retain their own pinned seeds. Safety's routing scenario uses seed 7.
ConsentNetwork worlds use the simulated automatic reviewer. PostgreSQL runs locally on port 54339 with `REQUIRE_PG=1`.

Integration includes the security suite. The security subset was not repeated separately.
The six Windows failure causes were reproduced earlier on the same unchanged base revision.
A fresh full baseline integration run was not repeated for this PR.
The full simulation was not repeated: AGENTS.md permits one full run per agent, already used during PR #355.
That earlier full run is not qualification for this change.

## llm_evidence

N/A: deterministic reference parsing and snapshot reconstruction.
Reproduction and measurement use policy personas and scripted member answers, not mocked model responses.
Real-model calls: zero. Model API cost: $0. Provider, model, temperature, and token settings for these runs: N/A.
The cases do not establish broad natural-language or model quality.

## agent_clients

N/A: no agent connector, member-facing protocol, or production conversation path changes.
The reproduction runs locally under Bun 1.4.2. No external-client acceptance is claimed.
No computer use or browser automation was used.
Authoring: OpenAI, Codex desktop 26.1103.3517.0. The exact authoring model ID is unavailable and is disclosed as such.

## Reproduce and limits

1. Install the pinned dependencies with `bun install --frozen-lockfile`.
2. Run the integration command above. Expect one pass after the fix.
3. Copy only that case into base `a0ed7bc` and repeat. Expect four false edges in the final comparison.
4. Save the measurement program outside each checkout as `negative-repeat-probe.ts`.
5. Run `bun run --conditions eliza-source ../negative-repeat-probe.ts ../before.json` from the base checkout.
6. Run it from the fixed checkout, writing `../after.json`. Expect four false edges removed and both positive edges retained.
7. Save the supplementary corpus program outside the checkout and run it on both revisions with `--conditions eliza-source`.

The source change affects these explicit refusal forms wherever the simulator reconstructs plan feedback.
It does not add a general-purpose natural-language parser or change the Network's actual handling of these replies.
Existing raw logs can be re-read; this change does not rewrite previously saved snapshots.
No UI, schema, dependency, secret, `.env`, `runs/`, or real member-data changes are included.
No hosted CI or external-client success is claimed by the local results.

## Measurement program

```ts
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const mod = (p: string) => import(pathToFileURL(root + "/" + p).href);
const { World } = await mod("packages/sim/src/world.ts");
const { ConsentNetwork } = await mod("packages/network/src/index.ts");
const { planAgainOf } = await mod("packages/network/src/classify.ts");
const { nycPersonas } = await mod("packages/network/harness/experiment.ts");
const { planAgainEdges } = await mod("packages/sim/src/snapshot.ts");
const { PLAN_AGAIN_RE, planAgainAnswer } = await mod("packages/sim/src/plans.ts");
const { DATA_DIR } = await mod("scripts/synthetic/common.ts");
const start = (await Bun.file(DATA_DIR + "/manifest.json").json()).snapshotNow;
const { computeMetrics } = await mod("packages/sim/src/judge/metrics.ts");
const hash = (v: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(v)).digest("hex");
const measurements: any[] = [];
const seed = 4;
const make = async () => new World({ seed, personas: await nycPersonas(), days: 21, start, writeLog: false,
  network: new ConsentNetwork({ seed, review: "auto" }), plans: true, failureRate: 0.15 });
const discovery = await make();
await discovery.begin();
let question: any;
while (!question && discovery.clock.now() < discovery.end) {
  await discovery.advanceTo(discovery.clock.now() + 6 * 3_600_000);
  question = discovery.records.find((r: any) => r.type === "message" && r.msg.direction === "outbound" && r.msg.status === "delivered" && r.msg.meta?.type === "feedback_request"
    && (r.msg.meta.plan || PLAN_AGAIN_RE.test(r.msg.body)) && discovery.records.some((o: any) => o.type === "outcome" && o.proposalId === r.msg.meta.proposalId && o.attendance[r.msg.memberId]?.showed && Object.values(o.attendance).filter((a: any) => a.showed).length >= 2));
}
if (!question) throw Error("No held-plan feedback question");
console.log(JSON.stringify({ question: question.msg, day: (question.t - start) / 86_400_000 }));
const cases: [string, "yes" | "no"][] = [
  ["Never again.", "no"], ["Not again, thanks.", "no"], ["I won't do that again.", "no"],
  ["Nope, not doing that again.", "no"], ["Yes, I'd do it again!", "yes"], ["Yes, I won't miss doing that again.", "yes"],
];
for (const [text, expected] of cases) {
  const w = await make();
  await w.begin();
  await w.advanceTo(question.t);
  const id = question.msg.memberId;
  const before = planAgainEdges(w.records, w.clock.now()).filter((e: any) => e.from === id);
  w.act({ do: "say", persona: id, text });
  await w.advanceTo(question.t + 1);
  const after = planAgainEdges(w.records, w.clock.now()).filter((e: any) => e.from === id);
  const snapEdges = w.snapshot().edges.filter((e: any) => e.from === id && e.type === "would_interact_again");
  const metrics = computeMetrics(w.records);
  const row = { text, expected, simulator: planAgainAnswer(text), network: planAgainOf(text), before, after, snapEdges,
    recordsHash: hash(w.records.filter((r: any) => r.type !== "run_start" && r.type !== "run_end")),
    metricsHash: hash({ ...metrics, run: { ...metrics.run, runId: "normalized" } }),
    safety: { leaks: metrics.privacy.canaryLeaks, minors: metrics.safety.minorContacts, invariants: metrics.invariants.total, errors: metrics.errors },
  };
  measurements.push(row);
  console.log(JSON.stringify(row));
}
if (Bun.argv[2]) await Bun.write(Bun.argv[2], JSON.stringify({ seed, start, personas: discovery.personaList().length, failureRate: 0.15, question: question.msg, results: measurements }, null, 2));
```

## Supplementary corpus program

```ts
import { pathToFileURL } from "node:url";
const { planAgainAnswer } = await import(pathToFileURL(process.cwd().replaceAll("\\", "/") + "/packages/sim/src/plans.ts").href);
const cases: [string, string][] = [
  ...["Never again.", "Not again, thanks.", "I won't do that again.", "Nope, not doing that again.",
    "Never again, thank you.", "Not again with this group.", "Won't go again.", "I won’t do it again.", "Nope, I'd pass on doing it again."].map(x => [x, "no"] as [string, string]),
  ...["Probably not, it wasn't really my thing.", "Not really, but thanks for setting it up.", "Probably not, thanks though."].map(x => [x, "no"] as [string, string]),
  ...["Yes, I'd do it again!", "Definitely, that was fun. Would do it again.", "Yes! Count me in next time.", "Yes, again please.", "Yeah, for sure.", "Absolutely, I'd go again."].map(x => [x, "yes"] as [string, string]),
  ...["Yes, I won't miss doing that again.", "Yes, I won’t miss doing that again.", "I won't hesitate to go again."].map(x => [x, "yes"] as [string, string]),
  ...["I couldn't make it in the end, sorry.", "Nobody else came, so hard to say.", "They never showed, so hard to say.", "Maybe.", "I'm not sure."].map(x => [x, "unclear"] as [string, string]),
];
const rows = cases.map(([text, expected]) => ({ text, expected, actual: planAgainAnswer(text) }));
console.log(JSON.stringify({ cases: rows.length, wrong: rows.filter(r => r.actual !== r.expected), rows }, null, 2));
```
