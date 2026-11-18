# Slop bias report: date-window timestamps

Date: 2026-11-12. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Requirement and defect

PRD 40.5 and MVP-plan item 5 require a weekly bias monitor. The service's existing monitor measures proposals, dates and second dates over the last 28 days (`packages/network/service/bias.ts`). This is a reproduced reporting defect under the approved contribution scope, not a new compliance gate.

The monitor first filters opportunities by `createdAt`, then derives dates from that filtered list. A date drops out when the proposal leaves the 28-day window, even if the meeting happened more recently. A weekly report can therefore understate dates and the outcome rates used by the monitor.

Select done opportunities with `meetingAt` inside the window directly from the full opportunity list. Proposals keep their creation-time window. The existing inclusive lower bound, current-time upper bound, done-state requirement, member eligibility, grouping, second-date pair calculation and alert thresholds stay in place.

Two alternatives: widen the creation-time window by a fixed booking delay, which fails for longer delays; or change stored creation timestamps to meeting timestamps, which corrupts the proposal history. Reading each event's own timestamp uses the data already present.

## Native service regression

The integration case uses real local HTTP, signed Blooio webhooks, PostgreSQL, NetworkService, the Slop pack and DryRunAdapter. Two fictional adults join and complete onboarding. Matching produces a review item; a reviewer approves it; both members accept the offered time. The service books the date and later marks the opportunity done. After a service restart and a stored-state read, the monitor writes four reports, each read through the staff HTTP API.

| Observation time | Proposal count per member | Date count before | Date count after |
| --- | ---: | ---: | ---: |
| Creation time + 28 days | 1 | 1 | 1 |
| Creation time + 28 days + 1 ms | 0 | 0 | 1 |
| Meeting time + 28 days | 0 | 0 | 1 |
| Meeting time + 28 days + 1 ms | 0 | 0 | 0 |

The identical regression: **0 pass, 1 fail, 39 assertions** on base; **1 pass, 0 fail, 39 assertions** after. Suite times: 5.96s before and 9.50s after, under varying local load. These are functional results, not a performance claim.

The test uses no inserted opportunity, edited timestamp, fake parser, model response or mocked service. Every outbound row is dry-run. A done opportunity is the monitor's existing date proxy; this work does not add independent attendance verification.

## measurement

| Observation | Before | After |
| --- | --- | --- |
| Correct report snapshots | 19/382 | 382/382 |
| Snapshots with understated date counts | 363 | 0 |
| Incorrect member date-count observations | 4272 | 0 |

All 19 already-correct snapshots remain identical. Counts overlap.

The same program runs native GameSource worlds for seeds 1, 7, 13 and 16 for 14 simulated days on each revision. The Slop game view uses the shared NYC ConsentNetwork simulation with policy persona agents and automatic simulated review; it is not a claim about the separate Slop-world population. The service regression above separately drives the actual Slop service pack.

The four worlds yield 114 done pair opportunities with meeting timestamps. Read-only reports run at the final world clock and at one millisecond before, exactly at, and one millisecond after each distinct creation-time and meeting-time expiry. These are repeated observations of the same synthetic histories, not 382 independent populations or a production-frequency estimate.

| Seed | Done opportunities | Report snapshots | Incorrect before | Incorrect after |
| --- | ---: | ---: | ---: | ---: |
| 1 | 29 | 88 | 84 | 0 |
| 7 | 24 | 91 | 84 | 0 |
| 13 | 35 | 115 | 111 | 0 |
| 16 | 26 | 88 | 84 | 0 |

The independent oracle counts member participation in done opportunities by the actual meeting timestamp. Every candidate row equals that oracle. All 19 already-correct snapshots retain identical complete rows and reports. Proposal counts, member-month denominators and group assignments match before and after for every snapshot. Complete Network state, run records and final judge results are also identical. Only run IDs and run-end wall durations are normalized before comparing simulation output; no decisions or safety findings are removed. Report reads leave their inputs unchanged.

All measured members are unrated, so this matrix does not qualify changes in rated-quintile alerts. No pair has two done opportunities inside these windows: second-date counts remain zero. The existing pair-count calculation is unchanged and uses the corrected date set. The current window definition still requires both dates to be inside the window.

## safety_gates

The same `bun run sim --only slop,safety,audit --json <output>` passes **72/72 blocking gates before and after**, with local PostgreSQL and `REQUIRE_PG=1`. All **90 complete gate records** match after excluding execution duration. Eight existing Slop tracked targets remain off target. Runtime: 64.9s before and 66s after.

| Unchanged tracked miss | Value |
| --- | --- |
| gate Minor contacts (age liars) cut vs random (>= 90%) | 76.5% |
| gate Adversary contacts cut (scammers, harassers, age liars) (>= 90%) | 45.4% |
| gate Second-date rate vs random (and >= 20%) (>= 2.5x) | 1.733 |
| gate Second dates per seed vs random (>= 2x) | 1.676 |
| gate Lowest group vs overall (man:gay) (>= 0.7x) | 0.506 |
| gate Same, feasible members (man:gay) (>= 0.7x) | 0.603 |
| gate Back-outs at reveal (< 10%) | 0.122 |
| slop-live style: probe texts that break the Network's style rules (target 0) | 4 of 342 (too_long) |

The native 14-day worlds have zero minor contacts, zero canary leaks and zero recorded errors on both revisions. Seeds 1, 7 and 16 have zero invariant violations. Seed 13 retains two `decliner_exposed` findings, with identical rule details and message records. This reporting fix does not resolve those baseline findings.

No new full `bun run sim`: AGENTS.md allows one full run per agent, already used in the contribution session. Fresh affected-block qualification is reported here. No gate or threshold is weakened.

## Validation

All four TypeScript configurations pass. Integration includes the security suite:

```text
 676 pass
 8 skip
 6 fail
 13780 expect() calls
Ran 690 tests across 69 files. [440.28s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green; the eight optional skips remain.

E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [35.96s]
```

The optional SDK/browser case remains skipped.

Commands, from the relevant checkout with the same local test environment:

```text
bun install --frozen-lockfile
bun test --conditions eliza-source packages/network/test/bias-date-window.integration.test.ts
bun run --conditions eliza-source ../bias-window-measure.ts . ../bias-window-before.json
bun run --conditions eliza-source ../bias-window-measure.ts . ../bias-window-after.json
bun run ../bias-window-compare.ts
bun run sim --only slop,safety,audit --json ../bias-window-gates-before.json
bun run typecheck
bun run sim --only slop,safety,audit --json ../bias-window-gates-after.json
bun run test:integration
bun run test:e2e
```

The before commands use the clean base; the after commands use this branch. The regression file is identical on both runs. `REQUIRE_PG=1`, local PostgreSQL on port 54339, live-send/deployment flags and model-provider keys cleared. No production data or external sends.

## llm_evidence and agent_clients

N/A for real-model evidence: deterministic time-window reporting. No prompt, model-backed behavior, rater or matching-policy change. Validation model calls: zero; cost: zero. Native worlds use policy agents.

Codex desktop 26.1103.7773.0, PowerShell, Bun 1.4.2 and PostgreSQL 16.15. Authoring provider OpenAI; the exact model identifier is unavailable. GitHub connector and Git/gh directly; no computer/browser use. No other agent-client qualification is claimed.

AI assistance authored the fix, regression and measurement programs; the real service and simulations generated the evidence. No UI, member-facing copy, membership, consent, live-send or deployment changes.

## Reproduction programs

Save these programs beside the base and candidate checkouts. Their first argument is the checkout root; the measurement's second argument is the output JSON path. The comparator reads the two named outputs beside itself.

### bias-window-measure.ts

```ts
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]!), output = resolve(process.argv[3]!);
const imp = (p: string) => import(pathToFileURL(join(root, p)).href);
const { GameSource } = await imp("packages/observatory/src/sources/game.ts");
const { biasRows, biasReport, BIAS_WINDOW_MS } = await imp("packages/network/service/bias.ts");
const { computeMetrics } = await imp("packages/sim/src/judge/metrics.ts");
const DAY = 86400000;
const hash = (x: any) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x, (k,v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v)).digest("hex");
const worlds: any[] = [];
for (const seed of [1, 7, 13, 16]) {
  const g = new GameSource({ app: "slop", seed, review: "auto", tickMs: DAY, pushMs: DAY });
  try {
    await g.init();
    const step = await g.control({ type: "step", ms: 14 * DAY });
    if (!step.ok) throw Error(step.error);
    const opps = [...g.consent.opps.values()] as any[];
    const members = g.world.snapshot().members.map((m: any) => ({ id: m.id, age: m.age, joinedAt: m.joinedAt, tags: [] }));
    const done = opps.filter(o => o.stage === "done" && o.meetingAt !== undefined);
    if (!done.length) throw Error("Native world has no completed meetings");
    const times = new Set<number>([g.world.clock.now()]);
    for (const o of done) for (const t of [o.createdAt, o.meetingAt]) for (const d of [-1, 0, 1]) times.add(t + BIAS_WINDOW_MS + d);
    const source = { members, opps }, sourceHash = hash(source), frames: any[] = [];
    for (const now of [...times].sort((a,b) => a-b)) {
      const rows = biasRows(members, opps, now);
      const from = now-BIAS_WINDOW_MS;
      const completed = done.filter(o => o.meetingAt >= from && o.meetingAt <= now);
      const pairs = new Map<string, number>();
      for (const o of completed) if (o.participants.length === 2) { const key = [...o.participants].sort().join("|"); pairs.set(key, (pairs.get(key) ?? 0)+1); }
      const eligible = members.filter((m:any) => typeof m.age === "number" && m.age >= 18 && m.joinedAt !== null && now-Math.max(m.joinedAt,from)>=DAY);
      const expected = eligible.map((m:any) => ({
        group: "unrated", memberMonths: (now-Math.max(m.joinedAt,from))/(30.44*DAY),
        proposals: opps.filter(o => o.createdAt >= from && o.createdAt <= now && o.stage !== "review" && !(o.stage === "closed" && (o.closedFrom ?? "review") === "review") && o.participants.includes(m.id)).length,
        dates: completed.filter(o => o.participants.includes(m.id)).length,
        secondDates: [...pairs].filter(([key,n]) => n>=2 && key.split("|").includes(m.id)).length,
      }));
      if (rows.length !== expected.length) throw Error("Member eligibility drift");
      const wrongDates = rows.filter((r:any,i:number)=>r.dates!==expected[i].dates).length;
      const wrongSecond = rows.filter((r:any,i:number)=>r.secondDates!==expected[i].secondDates).length;
      if (rows.some((r:any,i:number)=>r.proposals!==expected[i].proposals || r.memberMonths!==expected[i].memberMonths || r.group!==expected[i].group)) throw Error("Unrelated row mismatch");
      const report = biasReport("slop:nyc", "slop", members, opps, now);
      const sum = (field:string,rs:any[]) => rs.reduce((s,r)=>s+r[field],0);
      frames.push({ now, correct: !wrongDates && !wrongSecond, wrongDates, wrongSecond,
        actualDates: sum("dates",rows), expectedDates: sum("dates",expected), actualSecondDates:sum("secondDates",rows), expectedSecondDates:sum("secondDates",expected),
        rowsHash: hash(rows), expectedRowsHash: hash(expected), reportHash: hash(report),
        unchangedHash:hash(rows.map(({dates,secondDates,...r}:any)=>r)), overall:report.report.overall });
    }
    if(hash(source)!==sourceHash)throw Error("Bias reads mutated source data");
    const records = g.world.records.map((r:any)=>{if(r.type==="run_start"){const{runId,...v}=r;return v;}if(r.type==="run_end"){const{wallMs,...v}=r;return v;}return r;});
    const metrics=computeMetrics(g.world.records,{requireReview:true});metrics.run.runId="normalized";
    const result={seed,frames,done:done.length,pairDates:done.filter(o=>o.participants.length===2).length,sourceHash,
      recordsHash:hash(records),networkHash:hash(g.consent.exportState()),metrics,metricsHash:hash(metrics)};
    worlds.push(result);
    console.log(JSON.stringify({seed,frames:frames.length,wrong:frames.filter(f=>!f.correct).length,done:result.done,pairDates:result.pairDates,
      secondFrames:frames.filter(f=>f.expectedSecondDates>0).length,minor:metrics.safety.minorContacts,leaks:metrics.privacy.canaryLeaks,invariants:metrics.invariants}));
  } finally { await g.dispose(); }
}
await Bun.write(output,JSON.stringify(worlds,null,2));
```

### bias-window-compare.ts

```ts
import { strict as assert } from "node:assert";
const dir = import.meta.dir;
const a = await Bun.file(`${dir}/bias-window-before.json`).json();
const b = await Bun.file(`${dir}/bias-window-after.json`).json();
let frames = 0, correctBefore = 0, wrongDateRowsBefore = 0, done = 0;
assert.equal(a.length, 4); assert.equal(b.length, 4);
for (let i = 0; i < a.length; i++) {
  assert.equal(a[i].seed, b[i].seed);
  for (const key of ["sourceHash", "recordsHash", "networkHash", "metricsHash"]) assert.equal(a[i][key], b[i][key], `${key}: seed ${a[i].seed}`);
  assert.deepEqual(a[i].metrics, b[i].metrics);
  assert.equal(a[i].frames.length, b[i].frames.length);
  done += a[i].done;
  for (let j = 0; j < a[i].frames.length; j++) {
    const x = a[i].frames[j], y = b[i].frames[j];
    for (const key of ["now", "expectedRowsHash", "unchangedHash"]) assert.equal(x[key], y[key]);
    assert.equal(y.correct, true); assert.equal(y.rowsHash, y.expectedRowsHash);
    if (x.correct) { correctBefore++; assert.equal(x.rowsHash, y.rowsHash); assert.equal(x.reportHash, y.reportHash); }
    wrongDateRowsBefore += x.wrongDates; frames++;
  }
}
const result = { worlds: a.length, done, frames, correctBefore, correctAfter: frames,
  wrongFrames: frames-correctBefore, wrongDateRowsBefore, wrongDateRowsAfter: 0, nativeUnchanged: true };
assert.deepEqual([done,frames,correctBefore,wrongDateRowsBefore], [114,382,19,4272]);
await Bun.write(`${dir}/bias-window-comparison.json`, JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
```
