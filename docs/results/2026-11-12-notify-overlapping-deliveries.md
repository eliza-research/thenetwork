# Claim overlapping notification batches once

Date: 2026-11-12. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Requirement and cause

This is a reproduced scheduler defect under the approved Slop scope and CONTRIBUTING 3.1.
PRD 28.3 includes outreach control. PRD 32.9 specifies one notification inbox and one message per send.
The entry-flows design, section 5, requires one notification per event.
The Notify README says replicas can run the scheduler concurrently.

One worker plans item A. Item B arrives before another worker plans A and B.
Both workers re-read A before either commits its delivery.
Their delivery IDs differ because those IDs include the complete item set.
The delivery-ID conflict check therefore permits both messages. A appears twice.
The existing conditional item update prevents a second owner field, but does not reject the second delivery.

`PgNotifyStore.recordDelivery` now locks the batch's inbox rows in ID order inside its existing transaction.
It refuses the whole batch when any item is already notified.
The scheduler already handles a refused delivery without enqueueing it.
Unclaimed items remain available for the next tick.
`MemoryNotifyStore` uses the same overlap rule, synchronously, for the shared storage contract.

No schema, dependency, delivery-ID, wire-contract, copy or authorization changes are needed.
The existing erasure trigger still owns surviving references. Its locks follow the same inbox-before-delivery order.

## measurement

The paired program uses real PostgreSQL, two real Notifiers and the persisted OutboundQueue.
Its provider is a recording `sim` adapter. No carrier, model, production account or external server is contacted.
Fifteen fictional adults and their Friends memberships are created through the existing PostgreSQL stores.
The program adds 24 requested inbox items across 12 cases: four cohorts, each repeated three times.

| Cohort | Cases | Item appearances before | Item appearances after | Expected |
| --- | ---: | ---: | ---: | ---: |
| Different batches share A; B arrives between plans | 3 | 9 | 6 | 6 |
| Two workers plan the same item | 3 | 6 | 6 | 6 |
| Two sequential dispatches | 3 | 6 | 6 | 6 |
| Different recipients dispatch independently | 3 | 6 | 6 | 6 |
| Total | 12 | 27 | 24 | 24 |

Duplicate appearances fall from **3 to 0**. All **24 items** arrive exactly once after the fix.
Both runs make 24 recording-provider calls. The fix removes repeated content from overlapping messages; it does not reduce that call count.
Each stale overlapping batch is rejected. Its remaining item is sent by a newly constructed Notifier on the next tick.
The queue is also reconstructed from persisted rows before it drains.
Repeated dispatch and drain calls add nothing.

All nine complete control cases match, including items, deliveries, queue rows, provider requests and dispatch results.
Only the order of the two identical workers' results is normalized; either worker may win that race.
The fixture IDs and times are fixed. No timestamps, business fields or provider results are removed from the controls.
In the three changed cases, inbox fields outside the delivery-owner ID also match.

Concurrency is coordinated with a held PostgreSQL row lock and observed database lock waits.
No Notifier or store method is replaced. The recording provider does not model a real carrier.
The independent-recipient control completes while the first recipient remains locked.
These are controlled schedules, not a load test or an estimate of production duplicate frequency.
There is no statistical significance claim or parameter tuning.

One integration case exercises the real queue and verifies duplicate-free provider calls and complete item ownership.
It fails on the base with two appearances of the first update instead of one.

```text
Base:      0 pass / 1 fail / 1 expect() call / 2.61s
Candidate: 1 pass / 0 fail / 7 expect() calls / 2.01s
```

One implementation candidate was measured.
The first paired run used random person IDs and also measured 27 to 24 item appearances.
The final paired run uses fixed synthetic IDs to compare complete queue records without random delivery-ID tie ordering.
A test-only implicit-any error was fixed with result type annotations; final type checks and integration rerun cover that correction.
An initial local test attempt failed before execution because the owned test cluster started on its default port.
After confirming zero other clients, it was restarted on the required port 54339. That setup failure is not bug evidence.

## safety_gates

The same `bun run sim --only network,safety,audit --json <output>` command passes **94/94 blocking gates** before and after.
All **96 complete gate records** match after removing only execution duration.
All tracked records pass. Runtime: 229.4s before and 233.7s after.
Gate definitions, seeds, thresholds and simulation parameters are unchanged.

All four TypeScript configurations pass. The final integration run includes the adjusted regression test.
Integration, including security:

```text
676 pass
 8 skip
 6 fail
 13748 expect() calls
Ran 690 tests across 68 files. [459.06s]
error: script "test:integration" exited with code 1
```

The six failure names and causes match the clean-base Windows reproduction.
They are missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions.
Integration is not green; eight optional skips remain.

E2E:

```text
(skip) failed security checks give recovery feedback and a later SDK success clears only that feedback

 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [38.90s]
```

One optional SDK/browser test remains skipped.
No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was used earlier in this session.
This candidate has fresh affected-block validation. Hosted CI is reported in the PR body.


## llm_evidence

N/A: this changes a deterministic database claim before message delivery.
Model calls: 0. Cost: $0. Provider, model and request settings for validation: N/A.
No model-backed behavior, matching quality or downstream assistant response is newly qualified.

## agent_clients

Codex desktop 26.1103.7773.0, Windows, Bun 1.4.2 and PostgreSQL 16.15.
Authoring provider: OpenAI. Exact authoring model identifier: unavailable.
GitHub connector and Git/gh were used directly. No computer or browser use.
This is a native store and queue workflow, not an interactive agent-client test.
No acceptance result in another client or on a real carrier is claimed.

## Alternatives and limits

A person-wide advisory lock around planning and enqueueing could also serialize batches.
It would cover more work and couple the scheduler to database-specific coordination.
Rebuilding the batch inside the claim transaction would require the store to own directory, token and composition work.
The existing transaction can reject stale batches without those extra responsibilities.

A rejected batch may delay its remaining items until the next scheduler tick.
Rows are locked in ID order so overlapping batches acquire shared items in a consistent order.
There is no new global lock; the independent-recipient control verifies progress for another person.
Existing record-before-enqueue crash behavior remains: that crash window can lose a text.
The change does not recover historic duplicates or change weekly-cap enforcement between disjoint concurrent batches.
Requested thread deliveries are the measured path. Link preferences and other carriers are not newly qualified.
No UI or message template changes; the duplicate item claim is the only intended behavior change.

## Reproduction

Use Bun 1.4.2 and local PostgreSQL on port 54339. Use an owned test cluster and synthetic data only.
Install the locked dependencies in this checkout and a clean worktree at the base commit above.
Keep live-send, deploy and model-provider flags unset. Set `REQUIRE_PG=1`.

Save the two programs below beside the worktrees. Run from the candidate checkout:

```text
bun --conditions eliza-source ../notify-overlap-measure.ts ../notify-overlap-base ../notify-overlap-before.json
bun --conditions eliza-source ../notify-overlap-measure.ts . ../notify-overlap-after.json
bun ../notify-overlap-compare.ts ../notify-overlap-before.json ../notify-overlap-after.json
bun test --conditions eliza-source packages/notify/test/wiring.test.ts --test-name-pattern "overlapping dispatches"
bun run typecheck
bun run sim --only network,safety,audit --json ../notify-overlap-gates-after.json
bun run test:integration
bun run test:e2e
```

Run the same affected-block simulation command from the base worktree, with a separate output file.
To reproduce the failing regression, copy only the candidate's `wiring.test.ts` into that clean base worktree.
Run the same filtered test there before changing production code.
The comparison must report three duplicate appearances before, zero after, and nine unchanged control cases.
Each measurement creates and drops its own test database. It does not use real member data.

### Paired workflow program

```typescript
import {SQL} from "bun";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const root = resolve(process.argv[2]!), output = resolve(process.argv[3]!);
const mod = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const {testDb, dropTestDb} = await mod("packages/observatory/test/pg.ts");
const {PgNotifyStore} = await mod("packages/notify/src/pg-store.ts");
const {PgPeopleStore} = await mod("packages/platform/src/pg-store.ts");
const {Notifier, queuePolicy, queueSink} = await mod("packages/notify/src/index.ts");
const {OutboundQueue} = await mod("packages/blooio/src/outbound-queue.ts");
const {SimClock} = await mod("packages/core/src/clock.ts");
const url = await testDb(), sql = new SQL({url, max: 6}), locker = new SQL({url, max: 1});
const [{db}] = await sql`select current_database() as db`;
const clock = new SimClock(Date.UTC(2026, 9, 9, 16)), now = () => clock.now();
const people = new PgPeopleStore(sql), results: any[] = [], allPeople: string[] = [];
let sequence = 0;
try {
  for (let repeat = 0; repeat < 3; repeat++) for (const mode of ["overlap", "identical", "serial", "independent"]) {
    const recipients = new Map<string, any>(), calls: any[] = [];
    const summaries = ["First requested update is ready.", "Second requested update is ready."];
    const newPerson = async () => {
      const to = `+121255501${String(++sequence).padStart(2, "0")}`;
      const person = await people.createPerson({id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, e164: to, method: "inbound_message", at: now(), lowestAge: 28});
      await people.putMembership({app: "friends", personId: person.id, memberId: `overlap_${sequence}`, state: "active", review: null,
        firstName: "Synthetic", profile: {}, joinedAt: now(), leftAt: null});
      const r = {personId: person.id, to, timeZone: "America/New_York", prefs: {channel: "imessage"}, proactiveAllowed: true};
      recipients.set(person.id, r); allPeople.push(person.id); return r;
    };
    const a = await newPerson(), b = mode === "independent" ? await newPerson() : a;
    const make = () => new Notifier(new PgNotifyStore(sql), {get: (id: string) => recipients.get(id)});
    const notifier = make();
    const makeQueue = () => new OutboundQueue({sql, clock, provider: {kind: "sim", async send(req: any) {
      calls.push(req); return {providerMessageId: `sim:${req.idempotencyKey}`, chatId: req.to, status: "sent", transport: "sim"};
    }}, line: "+12125550100", app: "friends", checks: {live: () => true, recipient: queuePolicy(notifier, clock)}});
    let queue = makeQueue();
    const sink = queueSink(queue);
    const add = (r: any, i: number) => notifier.add({personId: r.personId, app: "friends", eventType: "requested",
      subjectId: `item-${i}`, urgency: "requested", summary: summaries[i]}, now());
    const first = (await add(a, 0)).item;
    const dispatches: Promise<any>[] = [];
    if (mode === "serial") { dispatches.push(notifier.dispatch(now(), sink)); await dispatches[0]; await add(b, 1); dispatches.push(make().dispatch(now(), sink)); }
    else {
      let release!: () => void, acquired!: () => void;
      const gate = new Promise<void>(r => {release = r;}), locked = new Promise<void>(r => {acquired = r;});
      const held = locker.begin(async tx => {await tx`select id from notify.inbox_items where id = ${first.id.slice(4)} for update`; acquired(); await gate;});
      await locked;
      const waitFor = async (n: number) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const [r] = await sql`select count(*)::int as n from pg_stat_activity where datname = ${db} and wait_event_type = 'Lock'`;
          if (r.n >= n) return;
          await Bun.sleep(10);
        }
        throw Error(`Expected ${n} blocked dispatches for ${mode}`);
      };
      try {
        dispatches.push(notifier.dispatch(now(), sink)); await waitFor(1);
        if (mode !== "identical") await add(b, 1);
        // Separate directories keep the disjoint-recipient control out of the held person's batch.
        const other = mode === "independent" ? new Notifier(new PgNotifyStore(sql), {get: (id: string) => id === b.personId ? b : undefined}) : make();
        dispatches.push(other.dispatch(now(), sink));
        if (mode === "independent") await dispatches[1]; else await waitFor(2);
      } finally {release(); await held; await Promise.allSettled(dispatches);}
    }
    const dispatchResults = await Promise.all(dispatches);
    if (mode === "identical") await add(b, 1);
    const resumed = make();
    const retry = await resumed.dispatch(now(), sink);
    // Reconstruct the queue from persisted rows before draining; no process-local send list is reused.
    queue = makeQueue(); await queue.drain(); await queue.drain();
    const replay = await resumed.dispatch(now(), queueSink(queue)); await queue.drain();
    const ids = [...recipients.keys()];
    const items = await sql`select * from notify.inbox_items where person_id = any(${sql.array(ids, "text")}) order by id`;
    const deliveries = await sql`select * from notify.deliveries where person_id = any(${sql.array(ids, "text")}) order by delivery_id`;
    const outgoing = await sql`select * from platform.outbound where to_address = any(${sql.array([...recipients.values()].map(r => r.to), "text")}) order by id`;
    results.push({repeat, mode, recipients: [...recipients.values()], dispatchResults, retry, replay, items, deliveries, outgoing, calls,
      appearances: summaries.map(s => calls.filter(c => c.text.includes(s)).length)});
  }
  await Bun.write(output, JSON.stringify({cases: results, people: allPeople.length, seed: null, clock: now()}, null, 2));
  console.log(JSON.stringify({cases: results.length, people: allPeople.length, items: results.reduce((n, r) => n + r.items.length, 0),
    appearances: results.reduce((n, r) => n + r.appearances.reduce((a: number, b: number) => a + b, 0), 0)}));
} finally {await locker.close(); await sql.close(); await dropTestDb();}
```

### Comparison program

```typescript
import {deepStrictEqual, equal, ok} from "node:assert/strict";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
equal(before.people, 15); equal(after.people, 15); equal(before.cases.length, 12); equal(after.cases.length, 12);
const canonical = (x: any): any => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object"
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const normalize = (c: any) => {
  const copy = structuredClone(c);
  // The two identical workers can win in either order. Their complete result multiset must match.
  if (copy.mode === "identical") copy.dispatchResults.sort((a: any, b: any) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
  return canonical(copy);
};
let controlCases = 0, baseRepeats = 0, fixedRepeats = 0, totalItems = 0, sentBefore = 0, sentAfter = 0;
for (let i = 0; i < before.cases.length; i++) {
  const a = before.cases[i], b = after.cases[i];
  equal(a.mode, b.mode); equal(a.repeat, b.repeat); equal(a.items.length, 2); equal(b.items.length, 2);
  totalItems += b.items.length; sentBefore += a.calls.length; sentAfter += b.calls.length;
  deepStrictEqual(b.appearances, [1, 1]);
  for (const c of [a, b]) {
    equal(c.replay.sent.length, 0);
    ok(c.outgoing.every((r: any) => r.status === "sent" && r.transport === "sim" && r.attempts === 1));
    ok(c.items.every((r: any) => r.notified_at !== null));
    equal(c.calls.length, c.outgoing.length); equal(c.calls.length, c.deliveries.length);
  }
  const memberships = b.deliveries.flatMap((d: any) => d.item_ids).sort();
  deepStrictEqual(memberships, b.items.map((r: any) => r.id).sort());
  baseRepeats += a.appearances.reduce((n: number, count: number) => n + Math.max(0, count - 1), 0);
  fixedRepeats += b.appearances.reduce((n: number, count: number) => n + Math.max(0, count - 1), 0);
  if (a.mode === "overlap") {
    deepStrictEqual(a.appearances, [2, 1]); equal(b.retry.sent.length, 1);
    equal(b.dispatchResults.reduce((n: number, d: any) => n + d.sent.length, 0), 1);
    equal(b.dispatchResults.reduce((n: number, d: any) => n + d.cancelled.length, 0), 1);
    deepStrictEqual(a.items.map(({delivery_id, ...r}: any) => r), b.items.map(({delivery_id, ...r}: any) => r));
  } else {deepStrictEqual(normalize(a), normalize(b)); controlCases++;}
}
equal(baseRepeats, 3); equal(fixedRepeats, 0); equal(controlCases, 9); equal(totalItems, 24);
console.log(JSON.stringify({cases: 12, people: 15, totalItems, controlCases, sentBefore, sentAfter, baseRepeats, fixedRepeats,
  controls: "all fields equal, allowing worker-result order only", timestampsNormalized: 0}, null, 2));
```
