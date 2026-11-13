# Observatory health refresh after game actions (2026-11-10)

## Defect and scope

Game mode caches health, requests, the scorecard and growth by simulated hour. Actions can change their inputs without moving that clock. After a state read warms the cache, turning matching off changes the Network panel but leaves its health alert absent. Sending a plans request adds the native request but leaves the Requests tab and growth count stale. Repeated reads do not repair either value until the next simulated hour.

This is a reproduced simulation/API defect under the approved Slop scope and CONTRIBUTING 3.1. PRD 35 covers the admin console and 28.2 the scorecard. `docs/admin-console.md` 3.8 and 3.10 define the requests, health and metrics views. `docs/observatory.md` section 2 defines the event-sourced view and full-state/delta transport. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

After projecting a run record, `GameSource.onRecord` invalidates the existing health-hour cache. The next explicit state read refreshes it even when simulation time is paused. Streamed updates retain their two-second wall-time throttle. The new-hour refresh also remains. Repeated reads without new records or a new hour reuse the cache. The formulas and the separate hourly judge cache do not change.

## Native HTTP regression

One integration case starts the actual Observatory HTTP server with seed 7, 30 generated NYC personas, five days, consent Network and engine off. It warms the cache, turns matching off and on, and checks the alert at the same clock time. It then advances two days and sends a plans request from a joined adult through the normal control route. The next state read must contain the new request without advancing time.

The same final case produces **0 pass / 1 fail / 6 assertions before**, then **1 pass / 0 fail / 18 assertions after**. Before, `network.matchingEnabled` is false while the `matching_off` alert is absent. Case runtime is 116.37 ms before and 199.54 ms after; suite runtime is 182 ms and 263 ms. The before case stops at the first failure, so these times are not a performance comparison. There are no mocks or model calls.

## measurement

The complete program below runs **32 native worlds per revision**: seeds **5, 7, 13 and 16**, engines **off and engine-v1**, and all four app views. Each world has 60 generated NYC personas, a ten-day limit, the consent Network and human review. App views use the current shared NYC game implementation; these are not the separate Slop, Peon or Friends CLI worlds.

Each world warms its state, switches matching off/on, advances seven days, switches matching off, sends a plans request, reads twice, switches matching on, rejects a queued proposal when one exists, reads again, then advances one hour. Peon's matching-on control remains locked: both attempts in each Peon world return the existing `409 matching_locked`. Fifteen worlds have a queued proposal to reject. There are **335 HTTP snapshots per revision**, including repeated observations of the same worlds.

| Observed result | Before | After |
| --- | --- | --- |
| Snapshots matching all four measured dimensions | 144/335 | 335/335 |
| Snapshots with stale matching/queue alerts | 126 | 0 |
| Snapshots with stale request lists | 143 | 0 |
| Snapshots with stale growth objects | 143 | 0 |
| Snapshots with scorecard mismatches | 0 | 0 |

The 144 already-correct snapshots keep the same measured payload. All 335 scorecards already match the existing formula on both revisions; this matrix does not demonstrate a scorecard-value correction. It demonstrates the shared cache repair through requests, growth and the selected health alerts. The four dimensions overlap, so their mismatch counts must not be added.

For seed 5 / engine off / ntwrk at day 7, switching matching off leaves its alert false on the base. The next plans request changes the native request count from 15 to 16 and the activated seed count from 5/60 (0.083) to 6/60 (0.1), but the old HTTP state retains 15 requests and 5/60. Rejecting the queued proposal leaves the old queue alert at one instead of zero. All three views are current after the fix.

| Read phase | Reads per revision | Wrong before | Wrong after |
| --- | --- | --- | --- |
| initial | 32 | 0 | 0 |
| initial-off | 32 | 24 | 0 |
| initial-on | 32 | 0 | 0 |
| day7 | 32 | 0 | 0 |
| day7-off | 32 | 24 | 0 |
| request | 32 | 32 | 0 |
| request-repeat-read | 32 | 32 | 0 |
| request-on | 32 | 32 | 0 |
| reviewed | 15 | 15 | 0 |
| repeat-read | 32 | 32 | 0 |
| next-hour | 32 | 0 | 0 |

Each capture compares the full public request list with `GameSource.requestList()`, and full growth/scorecard objects with the existing formulas evaluated on current native inputs. Alert checks cover `matching_off` and `review_queue` only; other alert rules are not independently qualified by this matrix. No formula is replaced or copied into product code. The measurement uses native state only for observation; every mutation goes through the actual HTTP control route.

## safety_gates

The same `bun run sim --only audit,ops --json <output>` command passes **30/30 blocking gates before and after**. All **31 complete gate records** are identical after excluding execution and restore duration. The tracked backup record passes: 69 tables, 71 rows and a 274 KiB dump on both sides; restore takes 2327 ms before and 2469 ms after. Runtime: 31.7s before and 26.1s after. Gate definitions, thresholds and simulation parameters are unchanged.

All **335 complete Network-state hashes and 335 normalized run-record hashes match across revisions**. Each GET also leaves its own native state and run records unchanged. Command bodies, HTTP statuses/results, simulation times and final judge results are identical for all 32 world pairs. Run-record normalization excludes only random `run_start.runId` and `run_end.wallMs`.

The comparison worlds are not all safe. Seed 16 has one existing `minor_contact` finding in each engine/app combination: **eight repeated world findings before and eight after**. The judge says an outbound message names a minor. Other seeds have none. Canary leaks and error counts remain zero. This change repairs reporting and does not fix that separate simulation finding or improve matching outcomes.

Every other normalized top-level state section is identical, with one expected transport exception: all 32 `next-hour` reads have a version number one higher after the fix. The refreshed health/requests mark `Store` dirty, so `takeDelta` advances its version for the extra change. All prior snapshot versions match and all versions remain monotonic. An initial strict whole-state comparison caught this difference; a full-state diagnostic identified `version` alone, then the full matrix was rerun with per-section hashes and explicit version accounting. Engine-run timing fields `wallMs` and `timingsMs` are excluded. Health alerts, requests, scorecard and growth are the affected fields, checked as described above.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13759 expect() calls
Ran 690 tests across 69 files. [415.57s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [37.76s]
```

The one optional SDK/browser test remains skipped.

No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was used earlier in this session. This revision has fresh affected-block validation. The HTTP matrix exercises this source; audit/ops check the surrounding simulation and operational gates. PostgreSQL ran locally on port 54339 and was stopped after confirming no other client connections.

## Reproduction

Use Bun 1.4.2 and PostgreSQL 16.15. Disable provider keys, live-send and deploy flags. Use local PostgreSQL on port 54339 for the integration and E2E suites. The focused case and paired HTTP measurement need no database or external service. Prepare base and candidate checkouts; save the complete programs below outside both checkouts.

```sh
bun install --frozen-lockfile
bun test --conditions eliza-source --timeout 120000 packages/observatory/test/game-health-refresh.integration.test.ts
bun game-health-measure.ts /path/to/base game-health-before.json
bun game-health-measure.ts /path/to/fix game-health-after.json
bun game-health-compare.ts game-health-before.json game-health-after.json comparison.json
bun run sim --only audit,ops --json gates.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

Copy the integration case into the base checkout to reproduce the failure. Run the measurement and gate commands in both checkouts. Expected: 335/335 measured snapshots current after the fix, 144/335 before; identical native state and records; unchanged blocking gates. The integration command includes the full security suite. The Windows failures above remain. Optional fourth argument `debug` runs only seed 5 / engine off / ntwrk and saves its full normalized state for comparison.

## Design and limits

Recomputing on every read would repeat the full message scan when no inputs changed. Invalidating only inside individual controls would miss recorded autonomous events and require each new control to remember the cache. Invalidation after projection covers both through the existing event path and preserves the stream throttle. Advancing the game solely to repair a read would also change the simulation, so it is not an acceptable workaround for paused inspection.

Explicit reads after recorded actions can now do more work, proportional to the existing scorecard scan. The matrix is a correctness check, not a load benchmark. Streamed health remains throttled to two seconds, and the matrix does not independently test that timing. Time-only values without new records retain hourly refresh. The judge retains its separate hourly cache. Real mode and formula definitions are unchanged. The new test file contains one complete HTTP regression for this defect; measurement tools are reproduced here rather than added as another test suite.

No UI or member-facing text changes. No live sends, deployments, secrets, `.env`, `runs/` or real member data are included.

## llm_evidence

N/A: deterministic cache invalidation; no prompts or model-backed behavior change. Validation model calls: **0**, cost: **$0**. Native worlds use policy persona agents. No real-model qualification is claimed.

## agent_clients

Codex desktop **26.1103.7773.0**, primary runtime **26.1104.2876.0**, Windows, Bun **1.4.2**, PostgreSQL **16.15**. Authoring provider: OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests. No agent-client workflow changes.

## Complete measurement programs

### game-health-measure.ts

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
const root=resolve(process.argv[2]!), out=resolve(process.argv[3]!);
const imp=(p:string)=>import(pathToFileURL(join(root,p)).href);
const {createServer}=await imp("packages/observatory/src/server.ts");
const {scorecard,growthStats}=await imp("packages/observatory/src/health.ts");
const {SIM_AUTO_REVIEWER}=await imp("packages/network/src/network.ts");
const {computeMetrics}=await imp("packages/sim/src/judge/metrics.ts");
const {matchingAllowed}=await imp("packages/observatory/src/apps.ts");
const DAY=86_400_000,HOUR=3_600_000;
const hash=(x:unknown)=>new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const rows:any[]=[];
for(const seed of [5,7,13,16])for(const engine of ["off","engine-v1"])for(const app of ["ntwrk","slop","peon","friends"]){
  if(process.argv[4]==="debug"&&(seed!==5||engine!=="off"||app!=="ntwrk"))continue;
  const dir=await mkdtemp(join(tmpdir(),"game-health-measure-"));
  const token="local-game-health-measure-0000000000",headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
  const server=await createServer({port:0,development:false,token,staffRolesUrl:false,peopleUrl:false,audit:{dir:join(dir,"audit")},lab:{dir:join(dir,"lab")},game:{seed,personas:60,days:10,city:"nyc",engine,network:"consent",review:"human",pushMs:HOUR,tickMs:HOUR}});
  const source=await server.source("game",app) as any, n=source.consent;
  const commands:any[]=[],frames:any[]=[];
  const records=()=>source.world.records.map((r:any)=>{
    if(r.type==="run_start"){const{runId,...rest}=r;return rest;}
    if(r.type==="run_end"){const{wallMs,...rest}=r;return rest;}
    return r;
  });
  const control=async(body:any)=>{
    const r=await fetch(`${server.url}/api/control?app=${app}`,{method:"POST",headers,body:JSON.stringify(body)}), result=await r.json();
    const locked=body.type==="matching"&&body.on&&!matchingAllowed(app);
    if(locked ? r.status!==409||result.code!=="matching_locked" : r.status!==200||!result.ok)throw Error(`Control failed ${seed}/${engine}/${app}: ${JSON.stringify(result)}`);
    commands.push({body,status:r.status,result});
  };
  const capture=async(phase:string)=>{
    const networkHash=hash(n.exportState()),recordsHash=hash(records());
    const r=await fetch(`${server.url}/api/state?app=${app}`,{headers});
    if(r.status!==200)throw Error(`State HTTP ${r.status}`);
    const s=await r.json(),requests=source.requestList(),members=[...source.store.members.values()],opps=[...source.store.opps.values()],c=source.store.counts,judge=source.store.judge;
    const expectedCard=scorecard({now:s.clock.now,start:s.clock.start,members,opps,requests,optOutAt:source.optOutAt,invites:c.invites,accepts:c.accepts,
      messages:source.world.channel.all().filter((m:any)=>!m.system).map((m:any)=>({memberId:m.memberId,ts:m.ts,direction:m.direction,proactive:!!m.meta?.proactive,status:m.status})),
      reviewSeconds:opps.reduce((sum:number,o:any)=>sum+(o.review?.secondsSpent??0),0),sentProposals:opps.filter((o:any)=>o.review?.decision==="approve"&&!o.review.invalidated&&o.review.reviewer!==SIM_AUTO_REVIEWER).length,
      inviters:source.inviters.size,minorContacts:judge?.minorContacts??null,leaks:judge?.canaryLeaks??null});
    const expectedGrowth=growthStats({members,opps,requests,invitees:n.invitedIds,invitesSent:n.counters.invitesSent,growthAsks:n.counters.growthAsks,inviters:source.inviters.size});
    const actualAlerts={off:s.stats.alerts.some((a:any)=>a.key==="matching_off"),queue:s.stats.alerts.find((a:any)=>a.key==="review_queue")?.count??0};
    const expectedAlerts={off:!matchingAllowed(app)||!n.matchingEnabled(),queue:n.reviewQueue().length};
    const actual={alerts:actualAlerts,requests:s.requests,scorecard:s.stats.scorecard,growth:s.stats.growth}, expected={alerts:expectedAlerts,requests,scorecard:expectedCard,growth:expectedGrowth};
    const exact=Object.fromEntries(Object.keys(expected).map(k=>[k,eq(actual[k as keyof typeof actual],expected[k as keyof typeof expected])]));
    const {alerts,scorecard:card,growth,...otherStats}=s.stats;
    const other={...s,requests:undefined,stats:otherStats,engineRuns:s.engineRuns.map(({wallMs,timingsMs,...run}:any)=>run)};
    if(hash(n.exportState())!==networkHash||hash(records())!==recordsHash)throw Error("State read mutated native state");
    frames.push({phase,now:s.clock.now,actual,expected,exact,networkHash,recordsHash,otherStateHash:hash(other),otherStateParts:Object.fromEntries(Object.entries(other).filter(([k,v])=>v!==undefined).map(([k,v])=>[k,hash(v)])),version:s.version,...(process.argv[4]==="debug"?{other}:{}),recordCount:source.world.records.length});
  };
  try{
    await capture("initial");
    await control({type:"matching",on:false});await capture("initial-off");
    await control({type:"matching",on:true});await capture("initial-on");
    await control({type:"step",ms:7*DAY});await capture("day7");
    await control({type:"matching",on:false});await capture("day7-off");
    const members=[...source.store.members.values()] as any[];
    let requested=false;
    for(const m of members.filter(m=>m.joined&&!m.minor&&!m.declined&&m.state!=="opted_out").slice(0,12)){
      const before=source.requestList().length;
      await control({type:"say",memberId:m.id,text:"Any plans for this weekend?"});
      if(source.requestList().length>before){requested=true;break;}
    }
    if(!requested)throw Error(`No native request ${seed}/${engine}/${app}`);
    await capture("request");await capture("request-repeat-read");
    await control({type:"matching",on:true});await capture("request-on");
    const review=n.reviewQueue()[0];
    if(review){await control({type:"review",oppId:review.oppId,decision:"reject",reason:"other",note:"Synthetic review to measure the current health snapshot",secondsSpent:12});await capture("reviewed");}
    await capture("repeat-read");
    await control({type:"step",ms:HOUR});await capture("next-hour");
    const m=computeMetrics(source.world.records,{requireReview:true});
    rows.push({seed,engine,app,commands,frames,judge:{invariants:m.invariants,canaryLeaks:m.privacy.canaryLeaks,minorContacts:m.safety.minorContacts,errors:m.errors}});
    console.log(JSON.stringify({seed,engine,app,frames:frames.length,wrong:frames.filter(f=>Object.values(f.exact).some(x=>!x)).length}));
  }finally{
    await server.stop();
    if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes("game-health-measure-"))throw Error("Unexpected temporary directory");
    await rm(dir,{recursive:true,force:true});
  }
}
await Bun.write(out,JSON.stringify(rows,null,2));
```

### game-health-compare.ts

```ts
const before=await Bun.file(process.argv[2]!).json(),after=await Bun.file(process.argv[3]!).json();
const eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
if(before.length!==32||after.length!==32)throw Error("World count");
const result={worlds:32,frames:0,correctBefore:0,correctAfter:0,unchanged:0,versionChanges:[] as any[],wrongBefore:{alerts:0,requests:0,scorecard:0,growth:0},wrongAfter:{alerts:0,requests:0,scorecard:0,growth:0},phases:{} as Record<string,{n:number;wrongBefore:number;changed:number}>,invariants:{} as Record<string,number>,canaryLeaks:0,minorContacts:0,errors:0};
for(let i=0;i<before.length;i++){
  const a=before[i],b=after[i];
  for(const key of ["seed","engine","app","commands","judge"])if(!eq(a[key],b[key]))throw Error(`World drift ${i}/${key}`);
  if(a.frames.length!==b.frames.length)throw Error("Frame count");
  for(let j=0;j<a.frames.length;j++){
    const x=a.frames[j],y=b.frames[j];
    for(const key of ["phase","now","expected","networkHash","recordsHash","recordCount"])if(!eq(x[key],y[key]))throw Error(`Frame drift ${i}/${j}/${key}`);
    // setHealth/setRequests mark the Store dirty; takeDelta can legitimately increment its
    // transport version once more when the refreshed payload is emitted. Compare every other
    // top-level part, and retain each version difference as evidence instead of hiding it.
    const {version:xv,...xp}=x.otherStateParts,{version:yv,...yp}=y.otherStateParts;
    if(!eq(xp,yp))throw Error(`Other state drift ${i}/${j}: ${Object.keys(xp).filter(k=>xp[k]!==yp[k])}`);
    if(x.version!==y.version)result.versionChanges.push({seed:a.seed,engine:a.engine,app:a.app,phase:x.phase,before:x.version,after:y.version});
    if(j&&(x.version<a.frames[j-1].version||y.version<b.frames[j-1].version))throw Error("Non-monotonic transport version");
    result.frames++;
    const correctX=Object.values(x.exact).every(Boolean),correctY=Object.values(y.exact).every(Boolean),same=eq(x.actual,y.actual);
    result.correctBefore+=+correctX;result.correctAfter+=+correctY;result.unchanged+=+same;
    for(const key of ["alerts","requests","scorecard","growth"] as const){result.wrongBefore[key]+=+!x.exact[key];result.wrongAfter[key]+=+!y.exact[key];}
    const p=result.phases[x.phase]??={n:0,wrongBefore:0,changed:0};p.n++;p.wrongBefore+=+!correctX;p.changed+=+!same;
    if(!correctY)throw Error(`Still stale ${i}/${j}: ${JSON.stringify(y.exact)}`);
  }
  for(const[k,v]of Object.entries(b.judge.invariants.byRule))result.invariants[k]=(result.invariants[k]??0)+(v as number);
  result.canaryLeaks+=b.judge.canaryLeaks;result.minorContacts+=b.judge.minorContacts;result.errors+=b.judge.errors;
}
await Bun.write(process.argv[4]!,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
```
