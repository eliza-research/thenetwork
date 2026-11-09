# Measure proactive messages over observed membership time

Date: 2026-11-09 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for integration and end-to-end validation.

## Problem, scope and implementation

The experiment report understates proactive messages per member-week when people join after the run starts.
It divides delivered proactive messages by the final join count times the whole run duration.
That denominator assigns time before joining to every later joiner, including people invited during the simulation.

Seed 1 over 14 days records 263 joins and 392 delivered proactive messages.
The old denominator is 526 member-weeks. Actual time from each join to the run end totals 495.457315749 member-weeks.
The report therefore prints 0.745 instead of the correct rounded rate, 0.791.
The messages and their timestamps do not change.

This is a reproduced simulation-reporting defect under the approved scope, CONTRIBUTING 3.1 and PRD 34.4's member-experience metrics.
The simulator judge already normalizes its message rates by time since each member's join.
This fix applies that duration definition to the experiment's existing delivered-proactive numerator.

Move the existing join-time map before result construction and sum elapsed member-weeks using the simulated clock.
Divide the existing message count by that duration, retaining three-decimal rounding and zero for an empty denominator.
The same join map still supplies the first-outcome scorecard; its behavior is unchanged.

Alternatives considered:

1. Reuse the judge's complete proactive rate. Its message classifier deliberately differs from the experiment's metadata-based count, so that also changes the numerator.
2. Average each person's individual rate. That weights recent joiners equally with long-tenured members, instead of weighting observed member-time.

This changes no send, matching, membership, safety or review decision.
The reporting cohort still includes all joined members; this is not a new active-only or opt-out-adjusted rate.
The independent arm-selection and request-median PRs (#426 and #430) are not prerequisites.

## measurement

One integration case runs the real experiment, ConsentNetwork, simulator, policy persona agent and existing synthetic NYC dataset.
It independently sums minutes from native join events to `run_end`, and counts delivered proactive messages.
The fixture verifies 263 joins, 392 messages and 4,994,210 rounded member-minutes before checking the reported rate.
No join, message, decision or model response is mocked.

```sh
bun test --conditions eliza-source packages/network/test/experiment-exposure.integration.test.ts
```

Before: 0 pass, 1 fail, 2 assertions; 15.01 seconds. The rate is 0.745 instead of 0.791.
After: 1 pass, 0 fail, 2 assertions; 14.95 seconds.
Initial probes also reproduced the understatement for consent seed 2 and push-baseline seed 1, both over 14 days.

The paired measurement runs twelve native worlds per revision:

- Consent: seeds 1, 11 and 23 for 14 days; seeds 1-3 for 21 days; seed 1 for 2 days.
- Push baseline: seed 1 for 21 days. Push-v2: seed 11 for 14 days.
- Controls: two generated 80-person NYC worlds, seeds 1 and 11, with all joins at the start of a seven-day run.
- Empty control: the same native seven-day world with zero people.

Experiment arms start with the existing 250 synthetic NYC people and use default harness settings.
The synthetic manifest SHA-256 is `30a54c830194ba8f0a970d07d942d5f35438109c9f098a33b7e0d19a460ae3e9`.
The 80-person controls use the real seeded generator, simulator actions, ConsentNetwork, simulated review and policy agent, with growth disabled.
Their fixed join time is 2026-10-05 17:00 UTC. No synthetic outcome is inserted.
Seeds 11 and 23 were not used to select the fix.

| World | Seed | Days | Proactive messages | Before rate | After rate |
|---|---:|---:|---:|---:|---:|
| consent | 1 | 14 | 392 | 0.745 | 0.791 |
| consent | 11 | 14 | 422 | 0.808 | 0.857 |
| consent | 23 | 14 | 428 | 0.829 | 0.872 |
| consent | 1 | 21 | 622 | 0.768 | 0.818 |
| consent | 2 | 21 | 653 | 0.821 | 0.869 |
| consent | 3 | 21 | 570 | 0.717 | 0.758 |
| push_baseline | 1 | 21 | 389 | 0.519 | 0.529 |
| push_v2 | 11 | 14 | 368 | 0.736 | 0.758 |
| consent | 1 | 2 | 31 | 0.434 | 0.545 |
| 80 joins at start | 1 | 7 | 58 | 0.725 | 0.725 |
| 80 joins at start | 11 | 7 | 38 | 0.475 | 0.475 |
| empty | 1 | 7 | 0 | 0 | 0 |

Correct rates: 3/12 before, 12/12 after.
All twelve native record hashes, message counts, membership durations and other result fields remain identical.
The three control worlds retain their complete results.

The reference rate sums raw member-minutes, then calculates `messages * 10080 / memberMinutes`, rounded to three decimals.
The scripts retain aggregate results and hashes, with no conversation bodies.
Record hashes omit only the generated `run_start.runId` and elapsed `run_end.wallMs`.
Every other record field remains in the hash.
This is deterministic reporting correctness evidence, not a statistical claim about fewer interruptions or better matching.

## safety_gates

All twelve judge results remain identical before and after.
The Network block passes 61/61 blocking gates on both revisions, with zero tracked misses.
All 63 gate names, pass states and blocking classifications are unchanged.
Sixty-two gate records match exactly after excluding elapsed timing.

The consent-versus-push result fingerprint changes from `361f8cc2648fb9a6` to `4cc69fc23af54716`.
The comparator independently reconstructs both fingerprints from the four measured 21-day arm results used by that gate.
Those results differ only in `proactivePerMemberWeek`; all corresponding native records are identical.
The invariant-world fingerprint remains unchanged.
Network run time is 209.2 seconds before and 207.3 seconds after; timing is not an improvement claim.

Pinned checks include the seed-3 invariant world over ten days; consent seeds 1-3 and push seed 1 over 21 days;
all NYC scenarios; simulator scenarios at pass^3; and pack conformance seeds 1-4.

The baseline push arm has nine existing invariant violations: six `over_budget` and three `decliner_exposed`.
It has zero canary leaks and minor contacts. The other eleven worlds have zero violations, leaks and minor contacts.
This baseline limitation is retained and reported; no clean push-baseline safety result is claimed.
All people are synthetic. Provider and live-send flags were unset; no live send or deployment occurred.

## Validation and limits

`bun install --frozen-lockfile`: 50 installs checked, no dependency changes.
`bun run typecheck`: all four configurations pass.
The paired Network runs pass 61/61 blocking gates; their detailed comparison is recorded above.

`bun run test:integration`: 676 pass, 8 skip, 6 fail; 13,743 assertions across 69 files, 457.90 seconds.
This includes all security-suite files and the new regression, which passes in 15.83 seconds.
The six failures match the previously reproduced base failures by test name and error cause:

- Wrangler OS-session test: `/bin/bash` is absent on Windows (`ENOENT`, `uv_spawn`).
- Backend boot test: the SIGTERM child exit is 143; the assertion expects 0.
- Four site artifact tests: Windows path separators do not match the slash-separated `.well-known/agent-skills/index.json` assertion.

`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions, 43.44 seconds.
The optional browser SDK case is skipped; browser acceptance is not claimed.
Database tests use isolated PostgreSQL on port 54339 with `REQUIRE_PG=1`.
The cluster is stopped after validation and after verifying zero remaining client connections.

The full simulation was not repeated. AGENTS.md permits at most one full run per agent, already used earlier in this session.
The affected Network block runs on both revisions with the same pinned seeds and scenarios.
Earlier PR results are not presented as fresh validation of this change.

The numerator still uses delivered outbound messages marked proactive by the experiment.
This does not adopt the judge's separate timing-based message classification or change membership policy after STOP.

## llm_evidence

N/A: elapsed-time normalization consumes completed simulator state and makes no model call.
Real-model calls: 0; cost: $0. No model-backed behavior is claimed.

## agent_clients

N/A: this is a developer experiment report, with no changed member-facing agent flow.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2. No other client is claimed as tested.
OpenAI provided the assistant; its exact model identifier was unavailable.
No browser or computer use was performed.

## Reproduce the paired measurement

Save the scripts below outside the checkout as `member-weeks-measure.ts` and `member-weeks-compare.ts`.
Run each measurement from its checkout, using frozen dependencies and the same scripts:

```sh
# Clean base revision:
bun run --conditions eliza-source ../member-weeks-measure.ts ../member-weeks-before.json
bun run sim --only network --json ../member-weeks-gates-before.json
# Fixed revision:
bun run --conditions eliza-source ../member-weeks-measure.ts ../member-weeks-after.json
bun run sim --only network --json ../member-weeks-gates-after.json
bun run ../member-weeks-compare.ts ../member-weeks-before.json ../member-weeks-after.json ../member-weeks-gates-before.json ../member-weeks-gates-after.json
```

The comparison also reconstructs the Network block's consent-versus-push fingerprint from its four pinned arm results.
It checks that those results differ only in the corrected rate, rather than discarding the changed fingerprint without explanation.

```typescript
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const { runArm, summarize } = await import(pathToFileURL(`${root}/packages/network/harness/experiment.ts`).href);
const { generatePersonas, World, PolicyPersonaAgent } = await import(pathToFileURL(`${root}/packages/sim/src/index.ts`).href);
const { ConsentNetwork } = await import(pathToFileURL(`${root}/packages/network/src/network.ts`).href);
const output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cases = [
  ...[1, 11, 23].map(seed => ({ kind: "arm", arm: "consent", seed, days: 14 })),
  ...[1, 2, 3].map(seed => ({ kind: "arm", arm: "consent", seed, days: 21 })),
  { kind: "arm", arm: "push_baseline", seed: 1, days: 21 },
  { kind: "arm", arm: "push_v2", seed: 11, days: 14 },
  { kind: "arm", arm: "consent", seed: 1, days: 2 },
  ...[1, 11].map(seed => ({ kind: "fixed-joins", arm: "consent", seed, days: 7, n: 80 })),
  { kind: "fixed-joins", arm: "consent", seed: 1, days: 7, n: 0 },
];
const rows = [];
for (const c of cases) {
  let records: any[] = [];
  let result;
  if (c.kind === "arm") {
    result = await runArm(c.arm, { days: c.days, seed: c.seed, onRecords: (r: any[]) => records = r });
  } else {
    const start = Date.UTC(2026, 9, 5, 17);
    const personas = generatePersonas({ n: c.n, seed: c.seed, cityWeights: { nyc: 1 } });
    const network = new ConsentNetwork({ seed: c.seed, review: "auto", growth: false });
    const w = new World({ seed: c.seed, days: c.days, start, personas, network, writeLog: false, plans: true,
      agent: new PolicyPersonaAgent(start, { plans: true }),
      actions: personas.map((p: any) => ({ at: start, action: { do: "join", persona: p.id } })),
      onRecord: (r: any) => records.push(r) });
    await w.begin(); await w.advanceTo(w.end); await w.complete();
    result = summarize(c.arm, c.days, records, w, network);
  }
  const start = records.find(r => r.type === "run_start").start;
  const end = records.find(r => r.type === "run_end").simEnd;
  const joins = records.filter(r => r.type === "join");
  const proactive = records.filter(r => r.type === "message" && r.msg.direction === "outbound" && r.msg.meta?.proactive && r.msg.status === "delivered").length;
  const memberMinutes = joins.reduce((sum, r) => sum + (end - r.t) / 60_000, 0);
  const expected = memberMinutes ? Math.round(proactive * 10_080 / memberMinutes * 1000) / 1000 : 0;
  const normalized = records.map(r => {
    if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
    if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
    return r;
  });
  rows.push({ ...c, joined: joins.length, laterJoins: joins.filter(r => r.t > start).length,
    proactive, memberMinutes, expected, records: records.length, recordHash: hash(normalized), result });
  console.error(JSON.stringify({ ...c, proactive, memberMinutes, expected, actual: result.proactivePerMemberWeek }));
}
const git = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
const [revision, exit] = await Promise.all([new Response(git.stdout).text(), git.exited]);
if (exit !== 0) throw new Error("Cannot read revision");
await Bun.write(output, JSON.stringify({ revision: revision.trim(), rows }, null, 2) + "\n");
```

```typescript
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const [beforePath, afterPath, beforeGatesPath, afterGatesPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !beforeGatesPath || !afterGatesPath) throw new Error("Pass before/after measurement and gate paths");
const before = await Bun.file(beforePath).json(), after = await Bun.file(afterPath).json();
assert.equal(before.rows.length, 12); assert.equal(after.rows.length, 12);
let beforeCorrect = 0, afterCorrect = 0, controls = 0;
const changes = [];
for (let i = 0; i < before.rows.length; i++) {
  const a = before.rows[i], b = after.rows[i];
  const { proactivePerMemberWeek: oldRate, ...oldRest } = a.result;
  const { proactivePerMemberWeek: newRate, ...newRest } = b.result;
  assert.deepEqual({ ...a, result: oldRest }, { ...b, result: newRest });
  assert.equal(newRate, b.expected);
  if (oldRate === a.expected) beforeCorrect++;
  if (newRate === b.expected) afterCorrect++;
  if (a.kind === "fixed-joins") {
    assert.equal(a.laterJoins, 0);
    assert.equal(a.memberMinutes, a.n * a.days * 1440);
    assert.deepEqual(a, b); controls++;
  } else {
    assert.ok(a.laterJoins > 0);
    assert.ok(newRate > oldRate);
    changes.push({ arm: a.arm, seed: a.seed, days: a.days, joined: a.joined,
      proactive: a.proactive, memberMinutes: a.memberMinutes, before: oldRate, after: newRate });
  }
}
assert.equal(beforeCorrect, 3); assert.equal(afterCorrect, 12); assert.equal(controls, 3);
const oldGates = (await Bun.file(beforeGatesPath).json()).gates;
const newGates = (await Bun.file(afterGatesPath).json()).gates;
const fingerprint = "fingerprint: consent vs push arms";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const pinned = (data: any) => [
  data.rows.find((r: any) => r.arm === "push_baseline" && r.days === 21).result,
  ...[1, 2, 3].map(seed => data.rows.find((r: any) => r.kind === "arm" && r.arm === "consent" && r.days === 21 && r.seed === seed).result),
];
assert.equal(oldGates.find((g: any) => g.name === fingerprint).detail, digest(pinned(before)));
assert.equal(newGates.find((g: any) => g.name === fingerprint).detail, digest(pinned(after)));
const normalized = (gates: any[]) => gates.filter(g => g.name !== fingerprint).map(({ ms, ...rest }) => rest);
assert.equal(newGates.length, 63);
assert.equal(newGates.filter((g: any) => g.blocking).length, 61);
assert.ok(newGates.every((g: any) => g.pass));
assert.deepEqual(normalized(oldGates), normalized(newGates));
assert.deepEqual(oldGates.map((g: any) => ({ name: g.name, pass: g.pass, blocking: g.blocking })),
  newGates.map((g: any) => ({ name: g.name, pass: g.pass, blocking: g.blocking })));
console.log(JSON.stringify({ runs: 12, beforeCorrect, afterCorrect, controls, changes,
  identicalRecordHashes: 12, identicalOtherResultFields: 12,
  judges: after.rows.map((r: any) => ({ kind: r.kind, arm: r.arm, seed: r.seed, days: r.days, n: r.n, ...r.result.judge })),
  gates: { records: 63, blocking: 61, failed: 0, identicalRecords: 62,
    fingerprintBefore: digest(pinned(before)), fingerprintAfter: digest(pinned(after)),
    fingerprintChangeAccountedFor: true } }, null, 2));
```
