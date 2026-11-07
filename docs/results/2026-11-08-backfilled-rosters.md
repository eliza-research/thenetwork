# Project plan backfills from the Network roster

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15 on isolated local port 54339.

## Requirement and reproduced defect

This fixes a reproduced Observatory projection defect under the approved scope.
PRD 32.10 requires group quorum and alternates; `docs/observatory.md` defines a
shared game/database view model with participant and alternate rosters.

The Network emits `probe_replaced` both for a swap (`out`, `in`) and for a plan
backfill (`in`, without `out`). Both events carry the current proposal snapshot.
The projector always maps an existing `out` member to `in`. With no `out`, it adds
the new member's status but never adds them to `participants`. It also leaves
consumed alternates in the alternate list. `rowsFromGame` consequently persists
backfilled members as alternates instead of participants.

In an unmodified generated seed-4 world, plan `nw-4-4` gets two backfills. The
Network roster has six participants and no alternates; game and database modes
show four participants and the two backfills as alternates. Another replacement
in the same world retains an alternate the Network already discarded.

## Fix and alternatives

Use the participant and alternate lists from the event's proposal snapshot.
Copy both arrays so the view does not share mutable roster arrays with the event.
Continue recording the incoming member's status and the recomposed explanations.
For older records without a proposal snapshot, keep swap handling and support an
add-only event without duplicating the incoming ID.

Adding only `in` when `out` is absent would fix the missing participant but retain
stale alternates. Clearing all alternates would discard candidates the Network
still holds. The existing snapshot carries both authoritative lists and requires
no Network behavior, event schema or database schema change.

## Regression

One PostgreSQL integration case drives a real `GameSource`, `ConsentNetwork`,
generated personas, review, planner, `rowsFromGame`, `writeRows` and `RealSource`.
It runs seed 4, 80 initial personas, both cities, engine-v1, simulated automatic
review, seven days from `2026-10-05T07:00:00Z`, with time-aware behavior off.
It observes five replacement events, including two backfills, across three
opportunities. It compares both projected rosters with `ConsentNetwork.exportState`.
The ordinary swaps are controls. No roster, event, decision or database response
is mocked.

```text
bun test --conditions eliza-source packages/observatory/test/backfilled-roster.integration.test.ts
```

Base plus the new regression: **0 pass, 1 fail; 6 assertions; 5.80 s**.
Candidate: **1 pass, 0 fail; 6 assertions; 5.53 s**.
In each view, two incorrect rosters become zero, and both missing participants
appear in the correct role.

## Paired measurement

The same program below ran on base and candidate. Each arm runs 18 complete worlds:

- ConsentNetwork, seven days, seeds 4, 7, 11 and 12.
- ConsentNetwork, 21 days, seeds 4, 7 and 11 through 20.
- StubNetwork controls, 30 days, seeds 4 and 7.

All use 80 initial generated personas, both cities, engine-v1, the same default
start, automatic review and time-aware behavior off. Each world is persisted into
real PostgreSQL and read back through `RealSource`. The comparator uses the final
Network roster for opportunities with at least one `probe_replaced` event.
There are 233 events, 38 backfills and 153 affected opportunity occurrences.
The seven-day and 21-day runs overlap; counts are occurrences across fixtures,
not unique people or independent population samples.

| Observation | Before | After |
| --- | ---: | ---: |
| Missing participant entries, game mode | 38 | 0 |
| Missing participant entries, database mode | 38 | 0 |
| Incorrect rosters, game mode | 109 | 17 |
| Incorrect rosters, database mode | 85 | 17 |
| Extra alternate entries, game mode | 216 | 22 |
| Extra alternate entries, database mode | 132 | 22 |

There are no extra participants or missing alternates in either arm. All remaining
17 roster differences are extra alternate entries in the final-state comparison.
This patch corrects the projection of replacement/backfill snapshots; it does not
claim to reconcile every later roster transition or remove those 22 remaining
alternate entries.

Simulation record hashes, metrics, final Network rosters and all persisted tables
except `participations` are identical in all 18 pairs. Normalization excludes
run-start/end records, run IDs and engine elapsed times. Game activity counters
also remain unchanged. The changed participation rows comprise 38 corrected
participant rows and 72 removed stale alternate rows. The database member proposal totals increase by 38 because
the recovered rows now have the participant role. Other database counter totals
retain their values. Complete per-member counter parity is not claimed; the
separate baseline discrepancies observed during PR #405's controls remain outside
this roster change.

This is deterministic projection evidence, not a matching-quality estimate.

## safety_gates

The same 22 baseline invariant findings remain: `minor_contact` 3, `quiet_hours` 7,
`name_before_reveal` 4, `over_budget` 4 and `decliner_exposed` 4. Counts include
overlapping fixtures. No clean broad-simulation safety result is claimed. There
are no canary leaks or runtime errors. No matching, sending, review or scoring
threshold changes; the recorded simulation behavior and metrics are identical.

Fresh audit and operations checks use the same command before and after:

```text
bun run sim --only audit,ops --json ../backfilled-roster-gates-<arm>.json
```

All four typecheck configurations passed. Both audit/operations runs passed
**30/30 blocking gates**, with zero tracked misses. All 31 result records match
after excluding elapsed time and the backup label's restore-time text.
Base: 36.2 s (audit 23.1, operations 13.1). Candidate: 34.6 s (audit 21.8,
operations 12.8).
`bun run test:integration`, including security: **676 pass, 8 skip, 6 fail**;
13,747 assertions, 551.75 s. The regression passed inside this command in 5.75 s.
All six failures match the previously reproduced base failures in name and cause:
missing `/bin/bash` at `uv_spawn`, SIGTERM exit 143 versus expected 0, and four
Windows path assertions for `.well-known/agent-skills/index.json`.
The eight optional reconciliation cases were skipped. A fully green local
integration suite is not claimed.
`bun run test:e2e`: **42 pass, 1 skip, 0 fail**; 654 assertions, 73.31 s.
The optional browser SDK case was skipped.
The full simulation was not repeated: AGENTS.md permits one full run per agent,
and that allowance was used earlier. Only affected blocks ran.
Live sends were disabled; all personas and database contents were synthetic.

## llm_evidence

Zero validation model calls, provider cost $0. This deterministic event projection
does not invoke a model or claim model-backed quality.

## agent_clients

Codex desktop 26.1103.3517.0 drove Bun and PostgreSQL directly. No member-facing
agent entry point changed and no external-client acceptance is claimed. No
computer use or browser automation was performed. Exact authoring model ID was
not exposed; the disclosure helper's supported `unavailable` value is used.

## Reproducible measurement program

Save the following as `../backfilled-roster-measure.ts` relative to each checkout.
Use the same isolated local PostgreSQL setup, then run from each repository root:

```text
bun run --conditions eliza-source ../backfilled-roster-measure.ts ../backfilled-roster-<arm>.jsonl
```

```typescript
import { pathToFileURL } from "node:url";
import { writeFileSync, appendFileSync } from "node:fs";
import { SQL } from "bun";
const root=process.cwd().replaceAll("\\","/");
const mod=(p:string)=>import(pathToFileURL(root+"/"+p).href);
const {GameSource}=await mod("packages/observatory/src/sources/game.ts");
const {RealSource}=await mod("packages/observatory/src/sources/real.ts");
const {rowsFromGame,writeRows}=await mod("packages/observatory/db/writer.ts");
const {testDb,dropTestDb}=await mod("packages/observatory/test/pg.ts");
const out=Bun.argv[2]!;writeFileSync(out,"");
const url=await testDb(),sql=new SQL(url);
const hash=(v:unknown)=>new Bun.CryptoHasher("sha256").update(JSON.stringify(v)).digest("hex");
const configs=[
  ...[4,7,11,12].map(seed=>({seed,network:"consent",days:7})),
  ...[4,7,...Array.from({length:10},(_,i)=>i+11)].map(seed=>({seed,network:"consent",days:21})),
  ...[4,7].map(seed=>({seed,network:"stub",days:30})),
];
const roster=(o:any)=>({id:o.id,participants:[...o.participants].sort(),alternates:[...o.alternates].sort()});
try {
  for(const config of configs) {
    const game=new GameSource({...config,personas:80,engine:"engine-v1",city:"all",review:"auto",pushMs:3_600_000,tickMs:3_600_000});
    let real:any;
    try {
      await game.init();await game.control({type:"step",ms:config.days*86_400_000});
      const result=await game.world.complete(),state=game.state();
      const changes=result.records.filter((r:any)=>r.type==="network_log"&&r.kind==="probe_replaced");
      const ids=new Set(changes.map((r:any)=>r.detail.oppId));
      const native=new Map((game.consent?.exportState().opps??[]).filter((o:any)=>ids.has(o.id)).map((o:any)=>[o.id,roster(o)]));
      const rows=rowsFromGame(game);await writeRows(sql,rows,{truncate:true});
      real=new RealSource({url,service:false,pollMs:3_600_000,pushMs:3_600_000});await real.init();
      if(real.state().env.error)throw Error(real.state().env.error);
      const summarize=(s:any)=>{
        const wrong=s.opportunities.filter((o:any)=>ids.has(o.id)&&JSON.stringify(roster(o))!==JSON.stringify(native.get(o.id))).map((o:any)=>({actual:roster(o),expected:native.get(o.id)}));
        const allRosters=s.opportunities.map(roster).sort((a:any,b:any)=>a.id.localeCompare(b.id));
        const counters=s.members.map((m:any)=>[m.id,m.counters]).sort((a:any,b:any)=>a[0].localeCompare(b[0]));
        return {wrong,allRostersHash:hash(allRosters),countersHash:hash(counters),totals:s.members.reduce((t:any,m:any)=>{for(const [k,v]of Object.entries(m.counters))t[k]=(t[k]??0)+(v as number);return t;},{})};
      };
      const {participations,matching_runs,...otherRows}=rows;
      const stableRows={...otherRows,matching_runs:matching_runs.map((r:any)=>{
        const {wall_ms,summary,...rest}=r;const {wallMs,timingsMs,...behavior}=summary;return {...rest,summary:behavior};
      })};
      const row={...config,events:changes.length,backfills:changes.filter((r:any)=>!r.detail.out).length,affected:ids.size,
        nativeHash:hash([...native.values()].sort((a:any,b:any)=>a.id.localeCompare(b.id))),game:summarize(state),real:summarize(real.state()),
        recordsHash:hash(result.records.filter((r:any)=>r.type!=="run_start"&&r.type!=="run_end")),
        otherRowsHash:hash(stableRows),participations,
        metricsHash:hash({...result.metrics,run:{...result.metrics.run,runId:"normalized"}}),invariants:result.metrics.invariants,
        safety:{leaks:result.metrics.privacy.canaryLeaks,minors:result.metrics.safety.minorContacts,errors:result.metrics.errors},
      };
      appendFileSync(out,JSON.stringify(row)+"\n");
      console.log(JSON.stringify({...config,events:row.events,backfills:row.backfills,affected:row.affected,wrongGame:row.game.wrong.length,wrongReal:row.real.wrong.length,invariants:row.invariants.byRule,safety:row.safety}));
    }finally{await real?.dispose();await game.dispose();}
  }
}finally{await sql.close();await dropTestDb();}
```
