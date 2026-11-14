# Member proposal counts respect review holds

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15 on isolated local port 54339.

## Requirement and defect

This is a reproduced Observatory reporting defect under the approved bug-fix scope.
PRD 32.8 holds opportunities until review; `docs/observatory.md` defines one view model
for game and database modes. `Projector.count` explicitly excludes a proposal while
it waits for approval, and retracts it if the approval re-check fails.

The database source instead counts every participant row. A pending, rejected or
expired review therefore increases a member's proposal activity without approval.
In generated seed 4, game mode reports zero member proposals at the first sampled
review queue; persisting that same state and reading it through `RealSource` reports
nine. Rejecting one item and approving another changes the correct count to two,
but the database view still reports nine.

## Fix and alternatives

Reuse the already-loaded review rows and participant rows. Subtract participants
whose review has no approval or whose approval was invalidated from the SQL total.
Only participant roles count. Proposals without a review record keep their existing
behavior. Keep the existing review-query fallback for older schemas.

A SQL join could do this subtraction, but would make the aggregate depend on review
columns that the separate query already reads with a compatibility fallback.
Filtering all `SKIPPED` opportunities is incorrect: a valid approved proposal may
later be skipped, while its approval remains part of the member's activity.

The full opportunity inventory still includes review holds. Messages, participation
statuses, matching, review decisions and all other member counters are unchanged.
This changes backend projection data; there is no UI or copy change.

## Regression

One PostgreSQL integration case drives `GameSource`, its real `ConsentNetwork`,
generated personas, actual review commands, `rowsFromGame`, `writeRows`, and
`RealSource`. No matching result, review decision or database response is mocked.
It samples pending review, rejection plus approval, and subsequent expiry, then
checks a StubNetwork control with proposals that have no review metadata.

```text
bun test --conditions eliza-source packages/observatory/test/reviewed-proposal-count.integration.test.ts
```

The new case on unchanged base source: **0 pass, 1 fail; 17 assertions; 9.31 s**.
After the fix: **1 pass, 0 fail; 17 assertions; 8.41 s**.
It also checks that the overall opportunity count retains the review inventory.

## Paired measurement

The same program below ran from the base worktree and the candidate checkout.
Ten generated worlds per arm: 80 initial personas, both cities, engine-v1,
time-aware behavior off, default start `2026-10-05T07:00:00Z`.
Manual-review seeds 4, 7, 11 and 12 each yield three snapshots: the first queue with
at least two items, one rejection plus one approval, then two days later.
Automatic-review ConsentNetwork controls use seeds 4, 7, 11 and 12 for seven days;
StubNetwork controls use seeds 4 and 7 for seven days. This yields 18 snapshots per arm.
The manual-review worlds are observed through the last phase, not claimed as full
14-day runs. The configured 14 days bounds the search for a review queue.

| Sample | Before database total | After database total | Game total |
| --- | ---: | ---: | ---: |
| Seed 4: pending | 9 | 0 | 0 |
| Seed 4: decided | 9 | 2 | 2 |
| Seed 4: later expiry | 27 | 2 | 2 |
| All 12 manual-review snapshots | 142 | 16 | 16 |
| Four automatic-review controls | 165 | 165 | 165 |
| Two no-review controls | 219 | 219 | 219 |

Across the manual-review snapshots, **99 incorrect per-member counters become 0**;
the sum loses **126 unapproved proposal counts**. These are deterministic snapshot
comparisons; the phases overlap in time, so these totals are not unique proposals,
people, independent samples or an estimate of population-quality improvement.

All 18 pairs have identical hashes for simulation records, persisted rows,
computed metrics, the database opportunity inventory and other member counters.
Normalization excludes run IDs, run-start/end records, engine elapsed times, and
wall-clock-derived opportunity ages. It retains behavioral records, review data,
all gate findings and other simulation measurements.

The automatic-review controls retain **12 per-member differences** between the two
modes, despite equal totals. This patch does not resolve those separate baseline
differences; the changed review rule does not apply to their approved proposals.
No claim of complete mode parity is made.

## safety_gates

The manual-review snapshots and controls retain the exact same invariant findings.
Two sampled snapshots have one `minor_contact` finding each (seed 7, manual-review
expiry and automatic-review control). They were present on base and remain present;
they are not treated as a clean safety result. There are no canary leaks or runtime
errors in these measurements. The simulation records and metrics are unchanged.

Fresh audit and operations blocks are run before and after with the same command:

```text
bun run sim --only audit,ops --json ../review-count-gates-<arm>.json
```

Both runs passed **30/30 blocking gates**, with zero tracked misses. All 31 result
records match after excluding elapsed time and the restore-time text in the backup
drill's label. Base: 39.1 s (audit 26.3, operations 12.8). Candidate: 37.2 s
(audit 23.6, operations 13.5).

All four `bun run typecheck` configurations passed.
`bun run test:integration`, including security: **676 pass, 8 skip, 6 fail**;
13,758 assertions, 587.27 s. The new regression also passed in this command (8.05 s).
All six failures match the previously reproduced Windows base failures in both
name and cause: `/bin/bash` missing at `uv_spawn`, SIGTERM exit 143 versus expected
0, and four native-path assertions for `.well-known/agent-skills/index.json`.
The eight optional reconciliation cases were skipped. A fully green local
integration suite is not claimed.
`bun run test:e2e`: **42 pass, 1 skip, 0 fail**; 654 assertions, 72.22 s.
The optional browser SDK case was skipped.
The full simulation was not repeated: AGENTS.md allows at most one full run per
agent, and that allowance was used earlier. Only affected validation blocks ran.
Live sends were disabled; every database and generated persona was local and synthetic.

## llm_evidence

Zero validation model calls; provider cost $0. This deterministic read-model change
does not invoke a model or claim model-backed quality. The optional LLM modes were
not run.

## agent_clients

Codex desktop 26.1103.3517.0 drove Bun and PostgreSQL directly. No member-facing agent
entry point changed, and no external-client acceptance is claimed. No computer use
or browser automation was performed. The exact authoring model identifier was not
exposed; attribution uses the disclosure helper's supported `unavailable` value.

## Reproducible measurement program

Save the following as `../review-count-measure.ts` relative to either checkout.
Use the same isolated local PostgreSQL setup for both arms; from each repository root:

```text
bun run --conditions eliza-source ../review-count-measure.ts ../review-count-<arm>.jsonl
```

```typescript
import { pathToFileURL } from "node:url";
import { writeFileSync, appendFileSync } from "node:fs";
import { SQL } from "bun";
const root = process.cwd().replaceAll("\\", "/");
const mod = (path: string) => import(pathToFileURL(root + "/" + path).href);
const { GameSource } = await mod("packages/observatory/src/sources/game.ts");
const { RealSource } = await mod("packages/observatory/src/sources/real.ts");
const { rowsFromGame, writeRows } = await mod("packages/observatory/db/writer.ts");
const { testDb, dropTestDb } = await mod("packages/observatory/test/pg.ts");
const { computeMetrics } = await mod("packages/sim/src/judge/metrics.ts");
const out = Bun.argv[2]!;
writeFileSync(out, "");
const url = await testDb(), sql = new SQL(url);
const hash = (v: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(v)).digest("hex");
const configs = [
  ...[4, 7, 11, 12].map(seed => ({seed, network:"consent", review:"human"})),
  ...[4, 7, 11, 12].map(seed => ({seed, network:"consent", review:"auto"})),
  ...[4, 7].map(seed => ({seed, network:"stub", review:"auto"})),
];
try {
  for (const config of configs) {
    const game = new GameSource({...config, personas:80, days:14, city:"all", engine:"engine-v1", pushMs:3_600_000, tickMs:3_600_000});
    const snapshot = async (phase: string) => {
      const state=game.state(), rows=rowsFromGame(game);
      await writeRows(sql,rows,{truncate:true});
      const real = new RealSource({url,service:false,pollMs:3_600_000,pushMs:3_600_000});
      try {
        await real.init();
        const db=real.state();
        if(db.env.error) throw Error(db.env.error);
        const expected=new Map(state.members.map((m: any)=>[m.id,m.counters.proposals]));
        const metrics=computeMetrics(game.world.records,{requireReview:config.network==="consent"});
        const normalizedRows={...rows,matching_runs:rows.matching_runs.map((r: any)=>{
          const {wall_ms,summary,...rest}=r;
          const {wallMs,timingsMs,...behavior}=summary;
          return {...rest,summary:behavior};
        })};
        const row={...config,phase,t:state.clock.now,
          expectedTotal:state.members.reduce((n:number,m:any)=>n+m.counters.proposals,0),
          actualTotal:db.members.reduce((n:number,m:any)=>n+m.counters.proposals,0),
          wrong:db.members.filter((m:any)=>m.counters.proposals!==expected.get(m.id)).map((m:any)=>({id:m.id,actual:m.counters.proposals,expected:expected.get(m.id)})),
          otherCountersHash:hash(db.members.map((m:any)=>{const {proposals,...rest}=m.counters;return [m.id,rest]}).sort((a:any,b:any)=>a[0].localeCompare(b[0]))),
          inventoryHash:hash(db.opportunities.map(({ageHours,...o}:any)=>o).sort((a:any,b:any)=>a.id.localeCompare(b.id))),
          recordsHash:hash(game.world.records.filter((r:any)=>r.type!=="run_start"&&r.type!=="run_end")),
          rowsHash:hash(normalizedRows),metricsHash:hash({...metrics,run:{...metrics.run,runId:"normalized"}}),
          invariants:metrics.invariants,safety:{leaks:metrics.privacy.canaryLeaks,minors:metrics.safety.minorContacts,errors:metrics.errors},
        };
        appendFileSync(out,JSON.stringify(row)+"\n");
        console.log(JSON.stringify({ ...config,phase,expected:row.expectedTotal,actual:row.actualTotal,wrong:row.wrong.length,invariants:row.invariants.byRule,safety:row.safety}));
      } finally {await real.dispose();}
    };
    try {
      await game.init();
      if(config.review==="human") {
        for(let h=0;h<14*24&&game.state().opportunities.filter((o:any)=>o.state==="IN_REVIEW").length<2;h++) await game.control({type:"step",ms:3_600_000});
        const queued=game.state().opportunities.filter((o:any)=>o.state==="IN_REVIEW");
        if(queued.length<2) throw Error("No review fixture");
        await snapshot("pending");
        for(const cmd of [{type:"review",oppId:queued[0].id,decision:"reject",reason:"weak_reason",note:"Synthetic fixture"},{type:"review",oppId:queued[1].id,decision:"approve"}]) {
          const r=await game.control(cmd);if(!r.ok)throw Error(JSON.stringify(r));
        }
        await snapshot("decided");
        await game.control({type:"step",ms:2*86_400_000});
        await snapshot("expired");
      } else {
        await game.control({type:"step",ms:7*86_400_000});
        await game.world.complete();
        await snapshot("control");
      }
    } finally {await game.dispose();}
  }
} finally {await sql.close();await dropTestDb();}
```
