# Trust score decay history

Date: 2026-11-12. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Requirement and defect

PRD 32.14 requires safety cases with preserved evidence.
`docs/network.md` section 6.2 defines trust scores and their event history.
This is a reproduced defect under CONTRIBUTING section 3.1.

Clean time reduces a trust score, but the old decay path records no event.
A member can have score 2 while their history still contains only a +3 event.
The open staff case also lacks the reduction.
The same incomplete history survives a service restart.

The fix uses the existing trust-event path for the actual score reduction.
The negative amount cannot exceed the remaining score.
Open cases receive the event. Decay alone cannot open or reopen a staff case.
Scores, levels, decay times, matching decisions and member messages keep their existing behavior.

Other implementations considered:

1. Reconstruct decay events when staff read the case. That cannot reliably recover old event times or staff decisions.
2. Duplicate event creation inside `decay`. The existing `add` path already records events, calls the case hook and changes levels.
3. Send decay through the case hook without a guard. That would open a new case after staff closed the previous case.

PR #162 changes when the decay clock restarts after a new risk signal.
This change records reductions from the existing clock; it does not change that policy.

## measurement

Runtime: Windows, Bun 1.4.2, PostgreSQL 16.15 on isolated local port 54339.
No live sends, deployment, production data or model calls were used.

The regression uses real signed HTTP requests, the Network service and Postgres.
Four fictional members produce an open watch case, a closed watch case, a held account and a clean control.
The test advances the service clock and restarts the service three times.

| Check | Before | After |
|---|---|---|
| Service integration case | 0 pass, 1 fail; 18 assertions | 1 pass, 0 fail; 33 assertions |
| Score after the first decay | 2 | 2 |
| Its recorded point history | `[3]` | `[3, -1]` |

The before test took 7.92 seconds, including local database startup; the after test took 3.60 seconds.
These times are not a performance claim.
The after test checks the exhausted history `[3, -1, -2]`, with sum 0, and no extra event at zero.
It verifies that the held account keeps score 6 and its original events.
The closed case stays closed without another case or event; the clean member gets no case.
It also checks persistence after restart and dry-run outbound receipts only.
The base test stops at the first missing decay event; these later assertions run only on the candidate.

The native measurement uses the same program on both revisions.
It runs the NYC dataset through `GameSource`, the ConsentNetwork and policy personas for 42 days.
The simulated reviewer approves eligible proposals; it is not a human review qualification.
Seeds are 1, 7, 13 and 16. There is no parameter tuning.

| Seed | Members including growth | Trust records | Incorrect balances before | After | New decay events |
|---|---:|---:|---:|---:|---:|
| 1 | 280 | 18 | 8 | 0 | 8 |
| 7 | 285 | 20 | 10 | 0 | 10 |
| 13 | 281 | 16 | 8 | 0 | 8 |
| 16 | 287 | 16 | 8 | 0 | 8 |
| Total across runs | 1,133 | 70 | 34 | 0 | 34 |

These are records across repeated worlds, not 1,133 distinct real people.
All 36 unaffected histories are identical.
All 108,828 run records match after excluding `run_start` and `run_end` wall-clock records.
The complete exported Network states match after removing the new decay events from trust and case histories.
Every computed metric matches after excluding the run ID.
This includes every trust score and level, all opportunity states, matching results and outbound messages.

## safety_gates

Run on both revisions with PostgreSQL required:

```powershell
bun run sim --only network,safety,audit --json <output.json>
```

| Block | Blocking gates before | After |
|---|---:|---:|
| network | 61/61 | 61/61 |
| safety | 17/17 | 17/17 |
| audit | 16/16 | 16/16 |
| Total | 94/94 | 94/94 |

All 96 gate records match, including names, classifications, results and details; only elapsed milliseconds are excluded.
Both runs have zero tracked gates off target.
Elapsed time: 229.4 seconds before, 227.8 seconds after.
The blocks use their checked-in seeds, corpora and simulated reviewers.
The network block includes seed 3 over 10 days, pooled seeds 1-3 over 21 days, and the native scenarios.
No threshold or seed was changed.
The full simulation command was not repeated: AGENTS.md permits one full run per agent, already used earlier in this session.
The 94 affected blocking gates above are the fresh evidence for this change.

The native worlds retain zero canary leaks, minor contacts and network errors on every seed.
Seed 13 retains two existing `decliner_exposed` findings on both revisions.
The other three seeds retain zero invariant violations.
This change does not resolve that separate finding or claim that every native world is clean.

## Validation

| Command | Candidate result |
|---|---|
| `bun run typecheck` | All four configurations pass |
| `bun run test:integration` | 676 pass, 8 skip, 6 baseline failures; 13,774 assertions; 425.49 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 38.05 seconds |

The integration command includes the complete security suite.
The regression passes within that command in 3.36 seconds.
All six failure names and causes match the previously reproduced Windows baseline:
missing `/bin/bash`, SIGTERM exit 143 instead of 0, and four slash-versus-backslash build-path assertions.
The local integration suite is not fully green. These failures were not hidden or skipped by this change.
The E2E skip is the optional browser SDK case. No browser-client acceptance is claimed.
After validation, PostgreSQL was stopped after confirming it had no other client connections.

## llm_evidence

N/A: this fixes deterministic audit-event bookkeeping.
Provider and model for runtime calls: none. Requests: 0. Cost: $0.
The native worlds use policy personas and the simulated reviewer.
No model-backed classification or conversation result is claimed.

## agent_clients

Codex desktop 26.1103.7773.0 drove the local shell, Bun and GitHub directly.
Authoring provider: OpenAI. The exact authoring model identifier was not exposed.
The PR uses the disclosure helper's supported `unavailable` value.
No browser or computer use was performed.
Other agent clients are N/A: no client protocol or member conversation flow changed.
No acceptance result in an external agent client is claimed.

## Reproduction

1. Create separate base and candidate checkouts. Run `bun install --frozen-lockfile` in each.
2. Use Bun 1.4.2 and local PostgreSQL 16. Set the test environment for port 54339.
3. Copy the candidate regression file into the same path in the base checkout.
4. Run the command below in each checkout.
5. Expect the base to miss `decay: -1`; expect the candidate to pass all 33 assertions.

```powershell
bun test --conditions eliza-source packages/network/test/trust-decay-history.integration.test.ts
```

The native measurement and comparison programs follow below.
Save them outside the two checkouts, beside their output files.
Run each measurement from its checkout with the same environment.

```powershell
# In the base checkout:
bun run --conditions eliza-source ../trust-decay-measure.ts . ../trust-decay-before.json
# In the candidate checkout:
bun run --conditions eliza-source ../trust-decay-measure.ts . ../trust-decay-after.json
bun run ../trust-decay-compare.ts
```

The comparison must report zero incorrect balances after the fix and identical behavior outside the new audit events.

## Limits

This records future reductions. It does not reconstruct missing events in previously saved histories.
Closed cases retain the evidence visible when staff closed them; the trust ledger still records subsequent decay.
A delayed tick records one event for its actual total reduction at that tick's time.
There is no schema migration, score-policy change, UI edit or member-message edit.

## Measurement program


```typescript
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const repo = resolve(process.argv[2]!), output = resolve(process.argv[3]!);
const { GameSource } = await import(pathToFileURL(join(repo, "packages/observatory/src/sources/game.ts")).href);
const { computeMetrics } = await import(pathToFileURL(join(repo, "packages/sim/src/judge/metrics.ts")).href);
const DAY = 86_400_000, rows = [];
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
for (const seed of [1, 7, 13, 16]) {
  const g = new GameSource({ seed, days: 42, network: "consent", review: "auto", pushMs: 3_600_000, tickMs: 3_600_000 });
  try {
    await g.init();
    await g.control({ type: "step", ms: 42 * DAY });
    const state = g.consent.exportState();
    const trust = state.trust.map((t: any) => ({ id: t.id, score: t.score, level: t.level,
      balance: t.events.reduce((sum: number, e: any) => sum + e.points, 0),
      decay: t.events.filter((e: any) => e.kind === "decay").map((e: any) => ({ at: e.at, points: e.points })) }));
    const withoutDecay = { ...state,
      trust: state.trust.map((t: any) => ({ ...t, events: t.events.filter((e: any) => e.kind !== "decay") })),
      cases: state.cases.map((c: any) => ({ ...c, events: c.events.filter((e: any) => e.kind !== "decay") })) };
    const records = g.world.records.filter((r: any) => r.type !== "run_start" && r.type !== "run_end");
    const metrics = computeMetrics(g.world.records, { requireReview: true });
    const row = { seed, days: 42, members: g.state().members.length, records: records.length,
      stateHashWithoutDecay: hash(withoutDecay), recordsHash: hash(records), metrics,
      trust, imbalanced: trust.filter((t: any) => t.balance !== t.score).length,
      decayEvents: trust.reduce((n: number, t: any) => n + t.decay.length, 0),
      cases: state.cases.map((c: any) => ({ id: c.id, memberId: c.memberId, status: c.status, events: c.events })) };
    rows.push(row);
    console.log(JSON.stringify({ seed, records: row.records, trust: trust.length, imbalanced: row.imbalanced, decayEvents: row.decayEvents }));
  } finally { await g.dispose(); }
}
await Bun.write(output, JSON.stringify(rows, null, 2));

```

## Comparison program


```typescript
import { strict as assert } from "node:assert";
const dir = import.meta.dir;
const a = await Bun.file(`${dir}/trust-decay-before.json`).json();
const b = await Bun.file(`${dir}/trust-decay-after.json`).json();
assert.equal(a.length, 4); assert.equal(b.length, 4);
const rows = [];
for (let i = 0; i < a.length; i++) {
  const x = a[i], y = b[i];
  assert.equal(x.seed, y.seed);
  assert.equal(y.imbalanced, 0);
  assert.equal(x.recordsHash, y.recordsHash);
  assert.equal(x.stateHashWithoutDecay, y.stateHashWithoutDecay);
  const metric = (r: any) => ({ ...r.metrics, run: { ...r.metrics.run, runId: "ignored" } });
  assert.deepEqual(metric(x), metric(y));
  assert.deepEqual(x.trust.map((t: any) => [t.id, t.score, t.level]), y.trust.map((t: any) => [t.id, t.score, t.level]));
  const affected = new Set(x.trust.filter((t: any) => t.balance !== t.score).map((t: any) => t.id));
  for (const t of y.trust) if (!affected.has(t.id)) assert.deepEqual(t, x.trust.find((o: any) => o.id === t.id));
  rows.push({ seed: x.seed, records: x.records, members: x.members, trustRecords: x.trust.length,
    imbalancedBefore: x.imbalanced, imbalancedAfter: y.imbalanced, decayEvents: y.decayEvents,
    unchangedHistories: y.trust.length - affected.size,
    invariants: y.metrics.invariants, canaryLeaks: y.metrics.privacy.canaryLeaks,
    minorContacts: y.metrics.safety.minorContacts, errors: y.metrics.errors,
    recordsIdentical: true, stateIdenticalExceptDecay: true, metricsIdentical: true });
}
assert.ok(rows.reduce((n, r) => n + r.imbalancedBefore, 0) > 0);
await Bun.write(`${dir}/trust-decay-comparison.json`, JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows));

```
