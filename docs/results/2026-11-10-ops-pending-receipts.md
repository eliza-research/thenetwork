# Pending receipts do not count as completed send outcomes

Date: 2026-11-10. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Problem and requirement

The queue treats `unknown_acceptance` as waiting for a receipt. It may later become `accepted`, or finish as `failed_unknown`. The ops collector has an older copy of the waiting-status list without this state, so it falls through to the completed-attempt counter. For five failures among 250 completed outcomes, one pending receipt changes the reported failure ratio from 2% to 1.992%, suppressing the default send-failure alert.

This is a reproduced defect under CONTRIBUTING 3.1 and the approved Slop scope. PRD 35.2 and MVP-plan item 11 require send-failure monitoring; `docs/deploy.md` 7.2 defines the failure alert. `sendOutcomes()` documents final outcomes, and the existing blocking ops gate explicitly excludes waiting rows. `WAITING_STATUSES` in the production channel is also the list used by the runtime's outbound backlog.

Use that shared list instead of the stale local list. The effective change is to exclude `unknown_acceptance` while it waits. Confirmed acceptance still increases attempted sends. `failed_unknown` still increases both attempted and failed sends. No delivery, receipt, retry, TTL or failure threshold changes.

One existing simulation fixture now contains seven unknown receipts, with the same expected completed outcomes. One new integration case covers the production queue and monitoring path.

Alternatives considered:

1. Add the missing string to the copied list. This fixes the present example but keeps a second waiting-status list to maintain.
2. Count all provider calls, including pending retries and unresolved receipts. That changes the existing final-outcome metric and its alert policy. It would also require attempt-history data rather than one current status per message.

## Regression

`deploy/backend/ops-pending-receipts.integration.test.ts` uses real PostgreSQL, `NetworkService`, the persisted outbound queue, the backend HTTP route and `PgAlertStore`. A simulated provider with `kind: "sim"` talks only to a loopback HTTP server. Its controlled unresolved/accepted responses exercise the queue's actual receipt path. The test uses the explicitly supported simulated-provider gate; no live-send environment flag is set.

An explicit historical fixture stores 245 delivered and five failed outcomes. A synthetic verified member produces one requested reminder through the real runtime. The queue and `network.messages` both store `unknown_acceptance`. On base, HTTP reports 251 attempted sends instead of 250. After the fix, the failure alert fires. A receipt-only lookup then confirms acceptance, with no repeated send; attempts become 251 and the alert resolves. A second unresolved reminder reaches the real six-hour receipt TTL, becomes `failed_unknown`, and produces 252 attempted / six failed sends and a new firing alert. The loopback webhook receives the firing/resolved/firing sequence.

| Same test command | Base | Fix |
| --- | --- | --- |
| `bun test --conditions eliza-source deploy/backend/ops-pending-receipts.integration.test.ts` | 0 pass, 1 fail; 5 assertions | 1 pass, 0 fail; 18 assertions |
| Case duration | 7314.12 ms | 2659.47 ms |
| Suite duration | 7.45 s | 2.73 s |

These durations include local setup and are not a performance comparison. Backend, database, queue and alert-store behavior is real; the provider responses and historical outcomes are synthetic. No claim is made about a real carrier or Cloud deployment.

## measurement

| Observation | Before | After |
| --- | --- | --- |
| Correct send counters and open-alert state | 120/228 | 228/228 |
| Incorrect completed-send counters | 108 | 0 |
| Missed send-failure open-alert observations | 32 | 0 |

All 120 already-correct observations stay correct and identical. Mismatch counts overlap.

The complete paired program below runs unchanged against base and candidate. It creates 12 native worlds: seeds 1, 7, 13 and 16 × ntwrk, slop and friends; default NYC dataset; engine-v1; `spam_wave`; human review; policy persona agents; default 60-day limit. Each advances one day plus five minutes. The one-hour wall-clock UI timer settings do not change the simulation's tick schedule.

Each native snapshot is written to PostgreSQL and observed seven times: unchanged baseline; one pending receipt; 50 pending receipts; those 50 plus one row for each other waiting state; 50 confirmed acceptances; 50 final unknown failures; and all additional rows removed. The program verifies that native outbound outcomes are delivered. It calculates their expected count from the original native rows inside each phase's rolling 24-hour window, including rows aging out as time advances. Pending rows add nothing; confirmed outcomes add attempts; final failures add attempts and failures. This is a controlled monitoring experiment over native snapshots, not a claim that the simulator emitted those transport outcomes.

Twenty-four stored-history cohorts cover all four apps, including Peon, with `(failed, delivered)` counts `(0,0)`, `(4,0)`, `(5,244)`, `(5,245)`, `(5,246)` and `(6,294)`. Each has six phases: baseline; 1, 10 and 100 pending receipts; 100 accepted outcomes; and 100 final failures. This covers no outcomes, the five-failure minimum, and the default 2% boundary. These cohorts use explicit synthetic stored outcomes on a native schema/state template, not additional native worlds or Peon match simulations.

Every phase uses the actual HTTP metrics route, dispatcher, persisted alert rows and a loopback HTTP 200 webhook. Expected cohort counters come from the fixture counts; the alert oracle uses the documented minimum and ratio. The program checks that each read leaves the measured source tables unchanged. The comparator checks complete stored-state, review, opportunity and message hashes; all HTTP metrics outside `sends24h`; and all non-send-failure notices and open alerts. These remain identical before and after. Target notices match what the local webhook received. Full native state, normalized run records, command results and final judge objects also match; only nondeterministic run IDs and run-end wall duration are omitted from the record hash. SQL row-to-JSON reads preserve stable numeric values without rounding.

| Phase | Reads per revision | Wrong before | Wrong after |
| --- | --- | --- | --- |
| native/native-baseline | 12 | 0 | 0 |
| native/unknown-one | 12 | 12 | 0 |
| native/unknown-fifty | 12 | 12 | 0 |
| native/all-waiting-states | 12 | 12 | 0 |
| native/accepted-fifty | 12 | 0 | 0 |
| native/failed-fifty | 12 | 0 | 0 |
| native/extras-removed | 12 | 0 | 0 |
| cohorts/completed-baseline | 24 | 0 | 0 |
| cohorts/unknown-1 | 24 | 24 | 0 |
| cohorts/unknown-10 | 24 | 24 | 0 |
| cohorts/unknown-100 | 24 | 24 | 0 |
| cohorts/accepted-100 | 24 | 0 | 0 |
| cohorts/failed-100 | 24 | 0 | 0 |

## safety_gates

All 12 native worlds have **zero invariant violations, zero minor contacts, zero canary leaks and zero recorded errors before and after**. Complete final judge results match. These results cover the one-day-plus-five-minute native sequences and the unchanged snapshots used for monitoring.

The same `bun run sim --only audit,ops --json <output>` command passes **30/30 blocking gates before and after**. All **31 complete gate records** match after excluding execution and restore duration. The tracked backup drill passes: 69 tables, 71 rows, 274 KiB on both sides; restore 2167 ms before and 2029 ms after. Runtime: 26s before and 26.2s after. The existing send-outcome fixture gains the missing waiting state; all expected outcomes, classifications and thresholds are unchanged.

No new full `bun run sim`: AGENTS.md permits one full run per agent, already used earlier in this session. These are fresh affected-block checks. The change does not alter matching, consent, review, delivery authorization or any safety policy.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13759 expect() calls
Ran 690 tests across 69 files. [474.98s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [43.79s]
```

The optional SDK/browser case remains skipped.

## llm_evidence

N/A: deterministic status aggregation. Validation model calls: 0; cost: $0. Native worlds use policy persona agents. No real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0 / primary runtime 26.1104.2876.0, Windows, Bun 1.4.2, PostgreSQL 16.15. Authoring provider OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests. No agent-client workflow changes.

## Limits

Failure alerts previously diluted by unresolved receipts can now fire. Pending receipts still appear in the outbound backlog. Accepted receipts and final failures retain their existing counter behavior. This is a count of current final message outcomes, not total HTTP call attempts. Unknown statuses outside the queue's registered waiting list retain their existing handling. The change does not alter receipt recovery, delivery limits, production clocks or real-provider behavior.

## Reproduce

Save both programs outside the two checkouts. Use frozen dependencies, Bun 1.4.2, local PostgreSQL 16 on port 54339, `USER=postgres`, and `REQUIRE_PG=1`. Keep model-provider keys, live-send and deployment flags unset. PostgreSQL binaries and Git's `bash` are on PATH on this Windows host. The measurement creates and drops its own process-specific test database.

```text
bun run --conditions eliza-source ops-receipts-measure.ts <base-checkout> before.json
bun run --conditions eliza-source ops-receipts-measure.ts <candidate-checkout> after.json
bun ops-receipts-compare.ts before.json after.json comparison.json
bun run typecheck
bun run sim --only audit,ops --json gates.json
bun run test:integration
bun run test:e2e
```

The comparator rejects any wrong candidate counter/open-alert state, source drift, changed non-send-failure metric/alert, or difference between dispatch notices and loopback delivery. Full integration has the host limits listed above.

### ops-receipts-measure.ts

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
const eq=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
let now=0,template:any;
const clock={now:()=>now},url=await testDb(),sql=new SQL({url,max:2});
const svc=new NetworkService({url,clock,networks:apps.map(app=>({id:`${app}:nyc`})),env:{PLATFORM_ENV:"dev"},notify:false,log:()=>{}});
const posts:any[]=[],native:any[]=[],cohorts:any[]=[];
const webhook=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){posts.push(await req.json());return new Response("ok");}});
const source=async()=>({state:await sql`select id,state,saved_at from network.network_state order by id`,
  messages:await sql`select row_to_json(m) as row from network.messages m order by id`,reviews:await sql`select row_to_json(r) as row from network.review_items r order by opportunity_id`,
  opps:await sql`select row_to_json(o) as row from network.opportunities o order by id`});
const setup=async(rows:any,app:string,history?:{failed:number;accepted:number})=>{
  now=+new Date(rows.network_state[0].saved_at);posts.length=0;
  await sql`truncate network.ops_alerts,network.ops_alert_posts restart identity`;
  await writeRows(sql,rows,{truncate:true});
  const member=rows.members[0].id;
  const nativeOut=rows.messages.filter((m:any)=>m.direction==="outbound");
  if(!history&&nativeOut.some((m:any)=>m.status!=="delivered"))throw Error("Native control contains another outcome kind");
  if(history){
    await sql`delete from network.messages where app_id=${app}`;
    const count=history.failed+history.accepted;
    await sql`insert into network.messages (id,app_id,member_id,direction,body,status,ts)
      select 'receipt-history-'||i,${app},${member},'outbound','Synthetic completed outcome',case when i<=${history.failed} then 'failed' else 'delivered' end,${new Date(now)}
      from generate_series(1,${count}::int) i`;
  }
  const key=`send_failures:${app}:nyc`,frames:any[]=[],token="synthetic-ops-receipts-token".padEnd(40,"x");
  const config=loadConfig({PLATFORM_ENV:"dev",DATABASE_URL:url,OPS_METRICS_TOKEN:token,ALERT_WEBHOOK_URL:webhook.url.href});
  const log=jsonLogger(()=>{}),ops=createOps({config:config.ops,probes:()=>[runtimeProbe(svc.runtimes.get(`${app}:nyc`))],store:new PgAlertStore(sql),now:clock.now,log});
  const backend=createBackend({svc,config,log,ops,now:clock.now,ping:async()=>{await sql`select 1`;return true;}});
  const http=Bun.serve({hostname:"127.0.0.1",port:0,fetch:backend.publicFetch});
  const extras=async(n:number,status:string,others=false)=>{
    await sql`delete from network.messages where app_id=${app} and id like 'receipt-extra-%'`;
    await sql`insert into network.messages (id,app_id,member_id,direction,body,status,ts)
      select 'receipt-extra-'||i,${app},${member},'outbound','Synthetic pending outcome',${status},${new Date(now)} from generate_series(1,${n}::int) i`;
    if(others)for(const s of ["queued","pending","sending","deferred_quiet_hours","held_awaiting_reply","retry_scheduled"])
      await sql`insert into network.messages (id,app_id,member_id,direction,body,status,ts) values (${'receipt-extra-'+s},${app},${member},'outbound','Synthetic waiting outcome',${s},${new Date(now)})`;
  };
  const read=async(phase:string,addedAttempts=0,addedFailures=0)=>{
    const before=hash(await source());
    const res=await fetch(new URL("/ops/metrics",http.url),{headers:{authorization:`Bearer ${token}`}});if(res.status!==200)throw Error(`HTTP ${res.status}`);
    const m=await res.json();if(hash(await source())!==before)throw Error("Read changed source rows");
    if(m.networks.length!==1||m.networks[0].error)throw Error("Network read failed");
    const {sends24h,...network}=m.networks[0],{alerts,networks,...metrics}=m;
    const baseline=history?{attempted:history.failed+history.accepted,failed:history.failed,refused:0,dryRun:0,smsFallback:0}
      :{attempted:nativeOut.filter((m:any)=>+new Date(m.ts)>now-DAY).length,failed:0,refused:0,dryRun:0,smsFallback:0};
    const expected={...baseline,attempted:baseline.attempted+addedAttempts,failed:baseline.failed+addedFailures};
    const expectedOpen=expected.failed>=5&&expected.attempted>0&&expected.failed/expected.attempted>=0.02;
    const r=await ops.tick();if(!r)throw Error("Ops did not run");
    const open=r.open.some((a:any)=>a.key===key),stored=await sql`select key from network.ops_alerts where key=${key} and open`;
    if(open!==!!stored.length)throw Error("Dispatch differs from persisted alerts");
    frames.push({phase,now,expected,actual:sends24h,expectedOpen,open,exact:eq(sends24h,expected)&&open===expectedOpen,sourceHash:before,
      otherMetricsHash:hash({...metrics,networks:[network]}),notices:r.notices.filter((a:any)=>a.key===key),
      otherNotices:r.notices.filter((a:any)=>a.key!==key),otherOpen:r.open.filter((a:any)=>a.key!==key)});
    now+=MIN;
  };
  return {frames,extras,read,close:()=>http.stop(true)};
};
try{
  for(const seed of [1,7,13,16])for(const app of ["ntwrk","slop","friends"]){
    const g=new GameSource({app,seed,scenario:"spam_wave",review:"human",pushMs:HOUR,tickMs:HOUR});let run:any;
    try{
      await g.init();const step=await g.control({type:"step",ms:DAY+5*MIN},"reviewer@example.test");if(!step.ok)throw Error(step.error);
      const records=()=>g.world.records.map((r:any)=>{if(r.type==="run_start"){const{runId,...v}=r;return v;}if(r.type==="run_end"){const{wallMs,...v}=r;return v;}return r;});
      const before={network:hash(g.consent.exportState()),records:hash(records())},rows=rowsFromGame(g);template??=structuredClone(rows);
      run=await setup(rows,app);await run.read("native-baseline");
      await run.extras(1,"unknown_acceptance");await run.read("unknown-one");
      await run.extras(50,"unknown_acceptance");await run.read("unknown-fifty");
      await run.extras(50,"unknown_acceptance",true);await run.read("all-waiting-states");
      await run.extras(50,"accepted");await run.read("accepted-fifty",50);
      await run.extras(50,"failed_unknown");await run.read("failed-fifty",50,50);
      await run.extras(0,"unknown_acceptance");await run.read("extras-removed");
      const m=computeMetrics(g.world.records,{requireReview:true});
      native.push({seed,app,step,before,after:{network:hash(g.consent.exportState()),records:hash(records())},frames:run.frames,posts:structuredClone(posts),
        judge:{invariants:m.invariants,minorContacts:m.safety.minorContacts,canaryLeaks:m.privacy.canaryLeaks,errors:m.errors}});
      console.log(JSON.stringify({kind:"native",seed,app,frames:run.frames.length,wrong:run.frames.filter((f:any)=>!f.exact).length}));
    }finally{run?.close();await g.dispose();}
  }
  for(const app of apps)for(const history of [{failed:0,accepted:0},{failed:4,accepted:0},{failed:5,accepted:244},{failed:5,accepted:245},{failed:5,accepted:246},{failed:6,accepted:294}]){
    const rows=structuredClone(template);rows.app=app;rows.network_state[0].id=`${app}:nyc`;
    const run=await setup(rows,app,history);
    try{
      await run.read("completed-baseline");
      for(const n of [1,10,100]){await run.extras(n,"unknown_acceptance");await run.read(`unknown-${n}`);}
      await run.extras(100,"accepted");await run.read("accepted-100",100);
      await run.extras(100,"failed_unknown");await run.read("failed-100",100,100);
      cohorts.push({app,history,frames:run.frames,posts:structuredClone(posts)});
      console.log(JSON.stringify({kind:"cohort",app,history,wrong:run.frames.filter((f:any)=>!f.exact).length}));
    }finally{run.close();}
  }
  await Bun.write(out,JSON.stringify({native,cohorts},null,2));
}finally{webhook.stop(true);await svc.close();await sql.close();await dropTestDb();}
```

### ops-receipts-compare.ts

```ts
const a=await Bun.file(process.argv[2]!).json(),b=await Bun.file(process.argv[3]!).json();
const eq=(x:any,y:any)=>JSON.stringify(x)===JSON.stringify(y);
if(a.native.length!==12||b.native.length!==12||a.cohorts.length!==24||b.cohorts.length!==24)throw Error("Unexpected matrix size");
const result={nativeWorlds:12,cohorts:24,frames:0,correctBefore:0,correctAfter:0,unchanged:0,wrongCountersBefore:0,missedAlertsBefore:0,
  invariants:{} as Record<string,number>,minorContacts:0,canaryLeaks:0,errors:0,phases:{} as Record<string,any>};
for(const kind of ["native","cohorts"]){
  for(let i=0;i<a[kind].length;i++){
    const x=a[kind][i],y=b[kind][i];
    for(const k of ["seed","app","history","step","before","after","judge"])if(!eq(x[k],y[k]))throw Error(`Input drift ${kind}/${i}/${k}`);
    if(kind==="native"&&!eq(x.before,x.after))throw Error("Native world changed during measurement");
    if(x.frames.length!==(kind==="native"?7:6)||x.frames.length!==y.frames.length)throw Error("Wrong phase count");
    for(let j=0;j<x.frames.length;j++){
      const p=x.frames[j],q=y.frames[j];
      for(const k of ["phase","now","expected","expectedOpen","sourceHash","otherMetricsHash","otherNotices","otherOpen"])
        if(!eq(p[k],q[k]))throw Error(`Unexpected drift ${kind}/${i}/${j}/${k}`);
      if(!q.exact)throw Error(`Wrong after ${kind}/${i}/${q.phase}`);
      result.frames++;result.correctBefore+=+p.exact;result.correctAfter+=+q.exact;
      result.unchanged+=+(eq(p.actual,q.actual)&&p.open===q.open);result.wrongCountersBefore+=+!eq(p.actual,p.expected);result.missedAlertsBefore+=+(p.expectedOpen&&!p.open);
      const phase=result.phases[`${kind}/${q.phase}`]??={n:0,wrongBefore:0,wrongAfter:0};phase.n++;phase.wrongBefore+=+!p.exact;phase.wrongAfter+=+!q.exact;
    }
    for(const w of [x,y]){
      const sent=w.posts.flatMap((p:any)=>p.alerts.filter((n:any)=>n.key===`send_failures:${w.app}:nyc`));
      if(!eq(sent,w.frames.flatMap((f:any)=>f.notices)))throw Error("Webhook delivery differs from dispatch");
    }
    if(kind==="native"){
      for(const [k,v] of Object.entries(y.judge.invariants.byRule))result.invariants[k]=(result.invariants[k]??0)+(v as number);
      result.minorContacts+=y.judge.minorContacts;result.canaryLeaks+=y.judge.canaryLeaks;result.errors+=y.judge.errors;
    }
  }
}
if(result.frames!==228)throw Error("Wrong observation count");
await Bun.write(process.argv[4]!,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
```
