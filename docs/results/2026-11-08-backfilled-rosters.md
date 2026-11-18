# Preserve backfills and final probe alternates

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15 on isolated local port 54339.

## Requirement and reproduced defect

This fixes a reproduced Observatory projection defect under the approved scope.
PRD 32.10 requires group quorum and alternates; `docs/observatory.md` defines a
shared game/database view model with participant and alternate rosters.

The Network emits `probe_replaced` both for a swap (`out`, `in`) and for a plan
backfill (`in`, without `out`). Both carry the current proposal snapshot. The
projector always tried to replace an existing member, omitting added participants
and retaining consumed alternates. `rowsFromGame` then stored backfills as alternates.
In generated seed 4, plan `nw-4-4` gets two backfills: the Network has six
participants and no alternates, while both views have four participants and two alternates.

A probe can also consume its last ineligible alternates and close without another
replacement event. The old close event contains only its ID and reason. At day 21,
seed-4 opportunities `nw-4-23` and `nw-4-29` are closed with no native alternates,
but the projection retains one and two respectively. The replacement snapshot
alone cannot communicate those subsequent removals.

## Fix and alternatives

Copy participant and alternate arrays from replacement proposal snapshots. Keep
the status and explanation updates. Older records without a snapshot retain swap
handling and support additive backfills without duplicating the incoming ID.

Add the final alternate array to `probe_closed` and apply it even if an earlier
review event already made the projected opportunity terminal. Preserve the existing
terminal state and reason in that case. Older close records without this field
keep their previous behavior; their discarded candidates cannot be reconstructed
retroactively. The arrays are copied rather than shared with mutable Network state.

Adding only the incoming participant would leave stale alternates. Clearing every
closed probe's alternates would discard unused candidates the Network still holds.
The actual snapshot handles both cases without changing matching, review, sending,
database schemas or UI code. The additive close-event metadata is intentional.

## Regression

One PostgreSQL integration case drives a real `GameSource`, `ConsentNetwork`,
generated personas, review, planner, `rowsFromGame`, `writeRows` and `RealSource`.
It runs seed 4, 80 initial personas, both cities, engine-v1, simulated automatic
review, 21 days from `2026-10-05T07:00:00Z`, with time-aware behavior off.
It observes 23 replacement events, including 2 backfills, and compares
all 68 replaced or closed opportunities with the final native Network rosters.
Ordinary swaps and closures with retained alternates are positive controls. No
roster, event, decision or database response is mocked.

```text
bun test --conditions eliza-source packages/observatory/test/backfilled-roster.integration.test.ts
```

Base plus the final regression: **0 pass, 1 fail; 8 assertions; 6.58 s**.
Candidate: **1 pass, 0 fail; 8 assertions; 6.44 s**.
In this fixture, wrong game rosters fall from 9 to zero and wrong database
rosters from 8 to zero. Both missing participants appear in the correct role.

## measurement

The same program below ran on base and candidate. Each arm runs 18 complete worlds:

- ConsentNetwork, seven days, seeds 4, 7, 11 and 12.
- ConsentNetwork, 21 days, seeds 4, 7 and 11 through 20.
- StubNetwork controls, 30 days, seeds 4 and 7.

All use 80 initial generated personas, both cities, engine-v1, the same default
start, automatic review and time-aware behavior off. Each world is persisted into
real PostgreSQL and read back through `RealSource`. The comparison includes the
union of opportunities with replacement events and opportunities with close events.
There are 233 replacement events, 38 backfills, 898 close events and 952
affected opportunity occurrences. Seven-day and 21-day fixtures overlap; these
are occurrence counts, not unique people or independent population samples.

| Observation | Before | After |
| --- | ---: | ---: |
| Missing participant entries, game mode | 38 | 0 |
| Missing participant entries, database mode | 38 | 0 |
| Incorrect rosters, game mode | 114 | 0 |
| Incorrect rosters, database mode | 90 | 0 |
| Extra alternate entries, game mode | 227 | 0 |
| Extra alternate entries, database mode | 143 | 0 |

There are no extra participants or missing alternates in either arm. Every final
roster in the selected union matches the Network after the fix. This does not
claim exhaustive coverage of other transitions or complete activity-counter parity.

All 898 new close events carry the snapshot; 370 retain nonempty alternate lists.
These retained lists make clearing all alternates an invalid alternative.

The paired native Network rosters, metrics and game activity counters are unchanged.
Simulation records are identical after excluding run-start/end records and only
the new `probe_closed.detail.alternates` field. Persisted tables outside
`participations` are identical after excluding engine elapsed times and that same
new field in persisted close-event payloads. Metric comparison normalizes run IDs.
Participation changes comprise 38 corrected participant rows and 105 removed stale
alternate rows. Database member proposal totals increase by 38 for the recovered
participants; other counter totals retain their values. Existing per-member
proposal-history discrepancies outside this roster correction remain out of scope.

## safety_gates

The same 22 baseline invariant findings remain: `minor_contact` 3, `quiet_hours` 7,
`name_before_reveal` 4, `over_budget` 4 and `decliner_exposed` 4. Counts include
overlapping fixtures. No clean broad-simulation safety result is claimed. There
are no canary leaks or runtime errors. No matching, sending, review or scoring
threshold changes. Live sends were disabled; all data was synthetic.

Fresh affected-block checks used the same command before and after:

```text
bun run sim --only network,safety,audit,ops --json ../closed-roster-gates-<arm>.json
```

Both runs pass **108/108 blocking gates**, with zero tracked misses. Of 111 result
records, 110 match after removing elapsed time and the backup label's restore time.
Only the tracked event fingerprint changes, from `24bb81f068060b33` to
`f6bde63dc35cc630`. Replaying that exact seed-3, ten-day world and removing only
the new alternate field from its 122 close events restores `24bb81f068060b33`
across all 8,691 non-boundary records. The check is reproduced below.
Base: 240.5 s (network 194.4, safety 10.0, audit 22.6, operations 13.5).
Candidate: 246.9 s (network 206.9, safety 9.5, audit 20.4, operations 10.1).

All four typecheck configurations pass.
Integration, including security: **676 pass, 8 skip, 6 fail**; 13,749 assertions, 555.52 s.
The new regression passes within the suite in 7.17 s. The six failures match
the recorded base in both name and cause: missing `/bin/bash` at `uv_spawn`,
SIGTERM exit 143 versus expected 0, and four Windows path assertions for
`.well-known/agent-skills/index.json`. Eight optional reconciliation cases skip.
A fully green local integration suite is not claimed.
E2E: **42 pass, 1 skip, 0 fail**; 654 assertions, 71.81 s.
The optional browser SDK case skips. The full simulation was not repeated:
AGENTS.md permits one full run per agent, and that allowance was used earlier.

## llm_evidence

Zero validation model calls, provider cost $0. This deterministic projection
does not invoke a model or claim model-backed quality.

## agent_clients

Codex desktop 26.1103.3517.0 drove Bun and PostgreSQL directly. No member-facing
agent entry point changed and no external-client acceptance is claimed. No
computer use or browser automation was performed. Exact authoring model ID was
not exposed; the disclosure helper's supported `unavailable` value is used.

## Reproducible measurement programs

Save this as `../closed-roster-measure.ts` relative to each checkout. With the
same isolated PostgreSQL setup, run from each root:

```text
bun run --conditions eliza-source ../closed-roster-measure.ts ../closed-roster-<arm>.jsonl
```

Compare each arm's `game.wrong`, `real.wrong`, closure metadata, participation rows
and hashes. The expected changes and explicit normalizations are described above.

```ts
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
      const closures=result.records.filter((r:any)=>r.type==="network_log"&&r.kind==="probe_closed");
      const ids=new Set([...changes,...closures].map((r:any)=>r.detail.oppId??r.detail.proposalId));
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
      const normalizeClose=(r:any)=>{
        if(r.type!=="network_log"||r.kind!=="probe_closed")return r;
        const {alternates,...detail}=r.detail;return {...r,detail};
      };
      const {participations,matching_runs,...otherRows}=rows;
      const stableRows={...otherRows,events:rows.events.map((r:any)=>{
        if(r.type!=="probe_closed")return r;
        const {alternates,...payload}=r.payload;return {...r,payload};
      }),matching_runs:matching_runs.map((r:any)=>{
        const {wall_ms,summary,...rest}=r;const {wallMs,timingsMs,...behavior}=summary;return {...rest,summary:behavior};
      })};
      const row={...config,events:changes.length,backfills:changes.filter((r:any)=>!r.detail.out).length,affected:ids.size,
        nativeHash:hash([...native.values()].sort((a:any,b:any)=>a.id.localeCompare(b.id))),game:summarize(state),real:summarize(real.state()),
        recordsHash:hash(result.records.filter((r:any)=>r.type!=="run_start"&&r.type!=="run_end").map(normalizeClose)),
        closureMetadata:{events:closures.length,withSnapshot:closures.filter((r:any)=>Array.isArray(r.detail.alternates)).length,retainedAlternates:closures.filter((r:any)=>r.detail.alternates?.length).length},
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

Save the following as `../closed-roster-fingerprint.ts` and run on the candidate:

```text
bun run --conditions eliza-source ../closed-roster-fingerprint.ts
```

Expect `raw: f6bde63dc35cc630` and `withoutCloseAlternates: 24bb81f068060b33`.

```ts
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const mod = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { World, PolicyPersonaAgent } = await mod("packages/sim/src/index.ts");
const { ConsentNetwork } = await mod("packages/network/src/index.ts");
const { nycPersonas, friendFactory } = await mod("packages/network/harness/index.ts");
const { DATA_DIR } = await mod("scripts/synthetic/common.ts");
const { digest } = await mod("scripts/sim/gate.ts");
const seed = 3, personas = await nycPersonas();
const start = (await Bun.file(`${DATA_DIR}/manifest.json`).json()).snapshotNow;
const net = new ConsentNetwork({ seed, review: "auto" });
const records: any[] = [];
const world = new World({ seed, personas, days: 10, start, writeLog: false, network: net, agent: new PolicyPersonaAgent(start), spawnFriend: friendFactory({ seed }), onRecord: (r: any) => records.push(r) });
await world.begin(); await world.advanceTo(world.end); await world.complete();
const relevant = records.filter(r => r.type !== "run_start" && r.type !== "run_end");
const fingerprint = (rows: any[]) => digest(rows.map(r => JSON.stringify(r).replace(/"runId":"[^"]*"/g, "")));
const normalized = relevant.map(r => {
  if (r.type !== "network_log" || r.kind !== "probe_closed") return r;
  const { alternates, ...detail } = r.detail;
  return { ...r, detail };
});
console.log(JSON.stringify({ records: relevant.length, closures: relevant.filter(r => r.kind === "probe_closed").length, raw: fingerprint(relevant), withoutCloseAlternates: fingerprint(normalized) }));
```
