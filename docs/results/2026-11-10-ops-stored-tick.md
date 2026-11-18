# Stored matcher ticks, not state writes, drive heartbeat alerts

Date: 2026-11-10. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Problem and requirement

`GET /ops/metrics` can report a fresh matcher heartbeat when a matcher has stopped, or has never run. `collectNetwork()` takes the later of the persisted matcher tick and the row's `saved_at`. `PgStore.save()` updates `saved_at` for every unit of work, including inbound messages and staff actions. These writes are not matcher ticks. They can suppress `tick_late:<network>` while requests continue to arrive.

This is a reproduced defect under CONTRIBUTING 3.1 and the approved Slop scope. PRD 35.2 requires matcher heartbeat alerts; MVP-plan item 11 requires monitoring and alerts; `docs/deploy.md` 7.2 defines `tick_late` as no stored tick for 15 minutes and `/ops/metrics` as the age of the last tick.

Use only `lastTick.stored`. Keep the existing null result for a network with no tick, the startup grace period, the strict greater-than threshold, and the zero clamp for a future tick. The stored tick is shared by replicas. A completed tick updates it even when proactive matching is paused.

The existing ops simulation fixture supplies a tick 30 seconds ago and a state save 20 seconds ago. Its assertion now expects 30 seconds. The fixture and every gate threshold stay the same. There is one new PostgreSQL/HTTP integration case.

Alternatives considered:

1. Use this process's last tick. It cannot see a tick committed by another replica and is lost on restart.
2. Add a dedicated heartbeat table or column. The canonical stored state already contains the tick timestamp. A second stored value needs new write and migration paths.

## Regression

`deploy/backend/ops-stored-tick.integration.test.ts` uses actual `NetworkService` runtimes, `PgStore`, `PgAlertStore`, the backend HTTP route, and a loopback webhook. It calls a real tick on one network, leaves another unticked, then performs staff matching-switch units on both. The service clock is controlled; PostgreSQL supplies the wall-time anchor. The old tick is 16 minutes before that anchor and the staff saves are current database writes.

The base HTTP response reports ages `[0, 0]`; the required response is `[960000, null]`. The fixed round persists and delivers two firing alerts. Real ticks on both paused networks produce one resolution each. A later round produces no duplicate notice. No backend, SQL, store or webhook mocks are used.

Same final test copied into a clean detached base, then removed:

| Command/result | Base | Fix |
| --- | --- | --- |
| `bun test --conditions eliza-source deploy/backend/ops-stored-tick.integration.test.ts` | 0 pass, 1 fail; 7 assertions | 1 pass, 0 fail; 19 assertions |
| Case duration | 4959.55 ms | 4224.70 ms |
| Suite duration | 5.05 s | 4.30 s |

Durations are validation observations, not a performance claim. The original typecheck found a missing test callback annotation; it was corrected before the final checks.

## measurement

| Observation | Before | After |
| --- | --- | --- |
| Correct heartbeat age and open-alert state | 32/120 | 120/120 |
| Incorrect heartbeat ages | 88 | 0 |
| Missed overdue open-alert observations | 44 | 0 |

All 32 already-correct observations stay correct and identical. Mismatch counts overlap.

The same complete program below runs against base and candidate. It creates 12 native worlds: seeds 1, 7, 13 and 16, each on ntwrk, slop and friends, using the default NYC dataset, engine-v1, `spam_wave`, human review, policy persona agents, and the default 60-day limit. Each advances one day plus five minutes to end on an actual matcher tick. The one-hour `pushMs` and `tickMs` options only slow wall-clock UI timers; they do not change the native simulation tick schedule.

Each snapshot is written to an isolated PostgreSQL database. The actual service then runs eight controlled observations: fresh; a staff save at 14 minutes; a save exactly at 15 minutes; a save at 16 minutes; a real tick attempt skipped under a held PostgreSQL advisory lock at 17 minutes; an ops runner restart and save at 18 minutes; a real tick at 19 minutes; and another staff save one minute later. The native world itself stays unchanged during this service replay.

Four additional empty-runtime sequences, one per app including Peon, cover no stored state, never-ticked staff saves before/at/after the startup grace limit, repeated overdue saves, and the first actual tick. These are fresh service fixtures, not additional native worlds or Peon match simulations.

The paired program uses a fixed injected clock. After a real runtime write, it sets only `network_state.saved_at` to that clock. This keeps PostgreSQL's wall clock and the service clock in one time domain for the comparison. It never changes `state.lastTick`. The integration regression above separately exercises the actual SQL timestamps without this alignment. The expected heartbeat age comes from `state.lastTick` read directly from SQL, and the expected alert comes from the documented threshold/grace rule.

Every observation uses real loopback HTTP. Each response is checked against the committed tick and the persisted alert state. Every read leaves the measured source rows unchanged. The comparator checks complete stored state, review, opportunity and message row hashes; other HTTP metrics; and every non-heartbeat notice and open alert. These are identical before and after. Full native state and normalized run-record hashes, command results and final judge objects also match. Run IDs and run-end wall duration are excluded from the record hash. SQL row-to-JSON reads avoid a text/binary float32 decoding difference without rounding values.

All 16 sequences deliver exactly one heartbeat firing and one resolution after the fix; repeated saves and the restart do not duplicate the notice. All webhooks are local HTTP 200 responses. Production throughput and provider behavior are not measured.

| Phase | Reads per revision | Wrong before | Wrong after |
| --- | --- | --- | --- |
| native/fresh | 12 | 0 | 0 |
| native/before-limit-save | 12 | 12 | 0 |
| native/at-limit-save | 12 | 12 | 0 |
| native/overdue-save | 12 | 12 | 0 |
| native/lock-skipped | 12 | 12 | 0 |
| native/runner-restart-save | 12 | 12 | 0 |
| native/real-tick | 12 | 0 | 0 |
| native/healthy-save | 12 | 12 | 0 |
| cold/no-state-grace | 4 | 0 | 0 |
| cold/never-ticked-grace | 4 | 4 | 0 |
| cold/never-ticked-at-limit | 4 | 4 | 0 |
| cold/never-ticked-overdue | 4 | 4 | 0 |
| cold/never-ticked-repeat-save | 4 | 4 | 0 |
| cold/first-tick | 4 | 0 | 0 |

## safety_gates

All 12 native worlds have **zero invariant violations, zero minor contacts, zero canary leaks and zero recorded errors before and after**. Complete final judge results match. These results cover the one-day-plus-five-minute native sequences and the unchanged snapshots used by the service replay.

The same `bun run sim --only audit,ops --json <output>` command passes **30/30 blocking gates before and after**. All **31 complete gate records** match after excluding execution and restore duration. The tracked backup drill passes: 69 tables, 71 rows, 274 KiB on both sides; restore 2021 ms before and 2094 ms after. Runtime: 25.1s before and 25.2s after. The one heartbeat-age assertion is corrected; all gate classifications and thresholds are unchanged.

No new full `bun run sim` was run: AGENTS.md permits one full run per agent, already used earlier in this session. These are fresh affected-block checks. No matching implementation, review policy, safety rule, authorization, channel delivery or gate threshold changes.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13760 expect() calls
Ran 690 tests across 69 files. [474.49s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [44.10s]
```

The optional SDK/browser case remains skipped.

## llm_evidence

N/A: deterministic monitoring of persisted timestamps. Validation model calls: 0; cost: $0. Policy persona agents produced the native worlds. No real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0 / primary runtime 26.1104.2876.0; Windows; Bun 1.4.2; PostgreSQL 16.15. Authoring provider: OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use, live-send flags, deploy flags or other client acceptance tests. This does not change an agent-client workflow.

## Limits

Correct heartbeat alerts can now surface on a deployment that kept writing state while its worker was stopped. An absent tick still uses process uptime for the grace period; the grace period starts again with a new ops runner. Future tick timestamps still clamp to zero age. Clock synchronization, scheduler repair and deployment qualification are outside this change. The measurement's restart case has an existing stored tick.

## Reproduce the paired comparison

Save the two programs below outside the checkouts. Use a clean base and the PR branch with frozen dependencies, Bun 1.4.2, local PostgreSQL 16 on port 54339, `USER=postgres`, and `REQUIRE_PG=1`. Keep all live-send, deployment and model-provider variables unset. On this Windows host, the PostgreSQL binaries and Git's `bash` are on PATH. Both programs use the repository's disposable process-specific test database helper.

```text
bun run --conditions eliza-source ops-tick-measure.ts <base-checkout> before.json
bun run --conditions eliza-source ops-tick-measure.ts <candidate-checkout> after.json
bun ops-tick-compare.ts before.json after.json comparison.json
bun run typecheck
bun run sim --only audit,ops --json gates.json
bun run test:integration
bun run test:e2e
```

Expected paired result: 120/120 correct after; 32/120 before; 88 wrong ages and 44 missed open-alert observations before, zero after. The mismatch categories overlap. The comparator exits nonzero for source drift, any changed non-heartbeat metric/alert, wrong transition, or wrong final heartbeat. See the validation limits above for this host's full integration command.

### ops-tick-measure.ts

```ts
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {SQL} from "bun";
const root=resolve(process.argv[2]!),out=resolve(process.argv[3]!);
const imp=(p:string)=>import(pathToFileURL(join(root,p)).href);
const {GameSource}=await imp("packages/observatory/src/sources/game.ts"),{NetworkService}=await imp("packages/network/service/service.ts");
const {createBackend,loadConfig,jsonLogger}=await imp("deploy/backend/backend.ts");
const {createOps,PgAlertStore,runtimeProbe}=await imp("deploy/backend/ops.ts");
const {testDb,dropTestDb}=await imp("packages/observatory/test/pg.ts"),{rowsFromGame,writeRows}=await imp("packages/observatory/db/writer.ts");
const {computeMetrics}=await imp("packages/sim/src/judge/metrics.ts");
const MIN=60_000,HOUR=60*MIN,DAY=24*HOUR,apps=["ntwrk","slop","peon","friends"];
const hash=(x:any)=>new Bun.CryptoHasher("sha256").update(JSON.stringify(x,(_k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest("hex");
let now=0;
const clock={now:()=>now},url=await testDb(),sql=new SQL({url,max:2}),locks=new SQL({url,max:1});
const svc=new NetworkService({url,clock,networks:apps.map(app=>({id:`${app}:nyc`})),env:{PLATFORM_ENV:"dev"},notify:false,log:()=>{}});
const posts:any[]=[],native:any[]=[],cold:any[]=[];
const webhook=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){posts.push(await req.json());return new Response("ok");}});
const source=async()=>({state:await sql`select id,state,saved_at from network.network_state order by id`,
  reviews:await sql`select row_to_json(r) as row from network.review_items r order by opportunity_id`,
  opps:await sql`select row_to_json(o) as row from network.opportunities o order by id`,
  messages:await sql`select row_to_json(m) as row from network.messages m order by id`});
const setup=(app:string)=>{
  const rt=svc.runtimes.get(`${app}:nyc`),key=`tick_late:${rt.id}`,frames:any[]=[],token="synthetic-ops-tick-token".padEnd(40,"x");
  const config=loadConfig({PLATFORM_ENV:"dev",DATABASE_URL:url,OPS_METRICS_TOKEN:token,ALERT_WEBHOOK_URL:webhook.url.href});
  const log=jsonLogger(()=>{});let started=now,ops:any,http:any;
  const restart=()=>{
    http?.stop(true);started=now;
    ops=createOps({config:config.ops,probes:()=>[runtimeProbe(rt)],store:new PgAlertStore(sql),now:clock.now,log});
    const backend=createBackend({svc,config,log,ops,now:clock.now,ping:async()=>{await sql`select 1`;return true;}});
    http=Bun.serve({hostname:"127.0.0.1",port:0,fetch:backend.publicFetch});
  };
  restart();
  // PgStore uses SQL now(), while the test clock is deterministic. Set only that
  // diagnostic column to the same injected clock after real runtime saves/ticks.
  const alignSave=async()=>{await sql`update network.network_state set saved_at=${new Date(now)} where id=${rt.id}`;};
  const save=async()=>{await rt.unitOfWork((n:any)=>n.setMatchingEnabled(false,"operator@example.test"));await alignSave();};
  const tick=async()=>{if(!await rt.tick())throw Error("Expected a real tick");await alignSave();};
  const read=async(phase:string)=>{
    const sourceBefore=await source(),before=hash(sourceBefore);
    const [row]=await sql`select state->>'lastTick' as tick from network.network_state where id=${rt.id}`;
    const t=row?.tick&&+row.tick?+row.tick:null,age=t===null?null:Math.max(0,now-t);
    const expectedOpen=age===null?now-started>config.ops.tickLateMs:age>config.ops.tickLateMs;
    const res=await fetch(new URL("/ops/metrics",http.url),{headers:{authorization:`Bearer ${token}`}});
    if(res.status!==200)throw Error(`HTTP ${res.status}`);
    const m=await res.json(),sourceAfter=await source();
    if(hash(sourceAfter)!==before){await Bun.write(`${out}.drift.json`,JSON.stringify({phase,before:sourceBefore,after:sourceAfter}));throw Error(`Metrics changed stored source data: ${phase}`);}
    if(m.networks.length!==1||m.networks[0].error)throw Error("Network read failed");
    const {lastTickAgoMs,...network}=m.networks[0],{alerts,networks,...metrics}=m;
    const r=await ops.tick();if(!r)throw Error(`Skipped ops round ${phase}`);
    const open=r.open.some((a:any)=>a.key===key),notices=r.notices.filter((a:any)=>a.key===key);
    const stored=await sql`select key from network.ops_alerts where open and key=${key}`;
    if(open!==!!stored.length)throw Error("Dispatcher differs from stored alerts");
    frames.push({phase,now,storedTick:t,expectedAge:age,expectedOpen,age:lastTickAgoMs,open,notices,
      exact:lastTickAgoMs===age&&open===expectedOpen,sourceHash:before,
      otherMetricsHash:hash({...metrics,networks:[network]}),
      otherNotices:r.notices.filter((a:any)=>a.key!==key),otherOpen:r.open.filter((a:any)=>a.key!==key)});
  };
  return {rt,key,frames,restart,save,tick,read,close:()=>http.stop(true)};
};
try{
  for(const seed of [1,7,13,16])for(const app of ["ntwrk","slop","friends"]){
    const g=new GameSource({app,seed,scenario:"spam_wave",review:"human",pushMs:HOUR,tickMs:HOUR});let run:any;
    try{
      await g.init();const step=await g.control({type:"step",ms:DAY+5*MIN},"reviewer@example.test");if(!step.ok)throw Error(step.error);
      const records=()=>g.world.records.map((r:any)=>{if(r.type==="run_start"){const{runId,...v}=r;return v;}if(r.type==="run_end"){const{wallMs,...v}=r;return v;}return r;});
      const before={network:hash(g.consent.exportState()),records:hash(records())};
      const rows=rowsFromGame(g),start=rows.network_state[0].state.lastTick;
      if(start!==g.world.clock.now())throw Error("Native snapshot does not end on its last tick");
      await sql`truncate network.ops_alerts,network.ops_alert_posts restart identity`;posts.length=0;
      await writeRows(sql,rows,{truncate:true});now=start;run=setup(app);await run.read("fresh");
      for(const [phase,minutes] of [["before-limit-save",14],["at-limit-save",15],["overdue-save",16]] as const){now=start+minutes*MIN;await run.save();await run.read(phase);}
      now=start+17*MIN;
      await locks.begin(async tx=>{await tx`select pg_advisory_xact_lock(hashtext(${`network-tick-${run.rt.id}`}))`;if(await run.rt.tick())throw Error("Contended tick ran");await run.read("lock-skipped");});
      now=start+18*MIN;run.restart();await run.save();await run.read("runner-restart-save");
      now=start+19*MIN;await run.tick();await run.read("real-tick");
      now=start+20*MIN;await run.save();await run.read("healthy-save");
      const m=computeMetrics(g.world.records,{requireReview:true});
      native.push({seed,app,step,before,after:{network:hash(g.consent.exportState()),records:hash(records())},frames:run.frames,posts:structuredClone(posts),
        judge:{invariants:m.invariants,minorContacts:m.safety.minorContacts,canaryLeaks:m.privacy.canaryLeaks,errors:m.errors}});
      console.log(JSON.stringify({kind:"native",seed,app,frames:run.frames.length,wrong:run.frames.filter((f:any)=>!f.exact).length}));
    }finally{run?.close();await g.dispose();}
  }
  // Real fresh service runtimes, no generated members: zero-tick startup and its grace period.
  for(const app of apps){
    await sql`truncate network.ops_alerts,network.ops_alert_posts restart identity`;posts.length=0;
    // Clear only this process's disposable test DB; all network rows are reset through the writer.
    const g=new GameSource({app:"ntwrk",seed:1,review:"human",pushMs:HOUR,tickMs:HOUR});
    await g.init();const empty=rowsFromGame(g);await g.dispose();for(const k of Object.keys(empty))if(Array.isArray(empty[k]))empty[k]=[];empty.app=app;
    await writeRows(sql,empty,{truncate:true});
    now=Date.UTC(2026,9,8,15);const start=now,run=setup(app);
    // A new runtime avoids retaining the previous world's in-memory state on an empty store.
    const fresh=new NetworkService({url,clock,networks:[{id:`${app}:nyc`}],env:{PLATFORM_ENV:"dev"},notify:false,log:()=>{}});
    const prior=svc.runtimes.get(`${app}:nyc`);svc.runtimes.set(`${app}:nyc`,fresh.runtimes.get(`${app}:nyc`));run.close();
    const freshRun=setup(app);
    try{
      await freshRun.read("no-state-grace");
      now=start+14*MIN;await freshRun.save();await freshRun.read("never-ticked-grace");
      now=start+15*MIN;await freshRun.save();await freshRun.read("never-ticked-at-limit");
      now=start+16*MIN;await freshRun.save();await freshRun.read("never-ticked-overdue");
      now=start+17*MIN;await freshRun.save();await freshRun.read("never-ticked-repeat-save");
      now=start+18*MIN;await freshRun.tick();await freshRun.read("first-tick");
      cold.push({app,frames:freshRun.frames,posts:structuredClone(posts)});
      console.log(JSON.stringify({kind:"cold",app,frames:freshRun.frames.length,wrong:freshRun.frames.filter((f:any)=>!f.exact).length}));
    }finally{freshRun.close();svc.runtimes.set(`${app}:nyc`,prior);await fresh.close();}
  }
  await Bun.write(out,JSON.stringify({native,cold},null,2));
}finally{webhook.stop(true);await svc.close();await locks.close();await sql.close();await dropTestDb();}
```

### ops-tick-compare.ts

```ts
const a=await Bun.file(process.argv[2]!).json(),b=await Bun.file(process.argv[3]!).json();
const eq=(x:any,y:any)=>JSON.stringify(x)===JSON.stringify(y);
if(a.native.length!==12||b.native.length!==12||a.cold.length!==4||b.cold.length!==4)throw Error("Matrix size changed");
const result={nativeWorlds:12,coldNetworks:4,frames:0,correctBefore:0,correctAfter:0,unchanged:0,wrongAgesBefore:0,missedAlertsBefore:0,
  invariants:{} as Record<string,number>,minorContacts:0,canaryLeaks:0,errors:0,phases:{} as Record<string,any>};
for(const kind of ["native","cold"]){
  for(let i=0;i<a[kind].length;i++){
    const x=a[kind][i],y=b[kind][i];
    for(const k of ["seed","app","step","before","after","judge"])if(!eq(x[k],y[k]))throw Error(`Native drift ${kind}/${i}/${k}`);
    if(kind==="native"&&!eq(x.before,x.after))throw Error("Measurement changed the native world");
    if(x.frames.length!==(kind==="native"?8:6)||y.frames.length!==x.frames.length)throw Error("Phase count changed");
    for(let j=0;j<x.frames.length;j++){
      const p=x.frames[j],q=y.frames[j];
      for(const k of ["phase","now","storedTick","expectedAge","expectedOpen","sourceHash","otherMetricsHash","otherNotices","otherOpen"])
        if(!eq(p[k],q[k]))throw Error(`Unexpected drift ${kind}/${i}/${j}/${k}: ${JSON.stringify([p[k],q[k]])}`);
      if(!q.exact)throw Error(`Wrong after ${kind}/${i}/${q.phase}: ${JSON.stringify(q)}`);
      const notice=q.phase==="overdue-save"||q.phase==="never-ticked-overdue"?"firing":q.phase==="real-tick"||q.phase==="first-tick"?"resolved":null;
      if(!eq(q.notices.map((n:any)=>n.state),notice?[notice]:[]))throw Error(`Wrong transition ${kind}/${i}/${q.phase}`);
      result.frames++;result.correctBefore+=+p.exact;result.correctAfter+=+q.exact;
      result.unchanged+=+(p.age===q.age&&p.open===q.open);
      result.wrongAgesBefore+=+(p.age!==p.expectedAge);result.missedAlertsBefore+=+(p.expectedOpen&&!p.open);
      const phase=result.phases[`${kind}/${q.phase}`]??={n:0,wrongBefore:0,wrongAfter:0};phase.n++;phase.wrongBefore+=+!p.exact;phase.wrongAfter+=+!q.exact;
    }
    const targetPosts=y.posts.flatMap((p:any)=>p.alerts.filter((n:any)=>n.key===`tick_late:${y.app}:nyc`));
    if(!eq(targetPosts.map((n:any)=>n.state),["firing","resolved"]))throw Error("Wrong webhook transitions");
    if(kind==="native"){
      for(const [k,v] of Object.entries(y.judge.invariants.byRule))result.invariants[k]=(result.invariants[k]??0)+(v as number);
      result.minorContacts+=y.judge.minorContacts;result.canaryLeaks+=y.judge.canaryLeaks;result.errors+=y.judge.errors;
    }
  }
}
if(result.frames!==120)throw Error("Wrong number of observations");
await Bun.write(process.argv[4]!,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
```
