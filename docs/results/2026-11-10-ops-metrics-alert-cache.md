# Publish completed alerts in the ops metrics cache (2026-11-10)

## Defect and requirement

The backend caches metrics before it dispatches their alerts. Dispatch then updates `lastAlerts`, but leaves the cached response unchanged. An immediate `GET /ops/metrics` can omit the first alert summary, retain alerts that just resolved, and show an older post count. The discrepancy lasts until another metrics collection, even though PostgreSQL already contains the completed round.

This is a reproduced backend API defect under the approved Slop scope and CONTRIBUTING 3.1. PRD 35.2 and MVP-plan item 11 require operational alert reporting. `docs/deploy.md` 7.2 says `/ops/metrics` includes open alerts. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

After a completed dispatch, the runner now publishes its alert summary into the current metrics cache. It updates the latest cache, because a concurrent HTTP request can replace the original snapshot while the webhook is pending. Other metrics, their collection timestamp and the 15-second cache lifetime remain unchanged. The patch adds one assignment and its comment.

## Native PostgreSQL and HTTP regression

One integration case uses the actual GameSource, consent Network, engine, native review controls, migrated PostgreSQL, NetworkService runtime, ops runner, dispatcher and backend route. An authenticated request reaches `/ops/metrics` through a loopback HTTP server. A second local HTTP server receives the real webhook. No SQL, service or backend mocks are used.

Seed 1 with `spam_wave` produces a 20-item review queue after one day. The first completed ops round stores the queue alert and one webhook attempt. Before the fix, the HTTP response has no `alerts` field. The exact final case gives **0 pass / 1 fail / 2 assertions**, 4.90 s, on the base. After: **1 pass / 0 fail / 18 assertions**, 8.03 s. Case runtimes are 4804.55 ms and 7934.55 ms. The baseline stops at its first failure; these times are not a performance comparison.

The case also clears the queue through native reviewer decisions and checks the completed summary against PostgreSQL. Another native day creates new review items. While the next webhook waits on a controlled local barrier, the injected clock advances 16 seconds. A real HTTP request refreshes the expired cache. Completing dispatch must update this newer cache, preserve its timestamp and network metrics, and expose the committed alert state. The clock advance is simulated; the webhook does not wait 16 wall-clock seconds.

## measurement

The complete paired program below runs **12 native worlds per revision**: seeds **1, 7, 13 and 16**, across **ntwrk, slop and friends**. Each uses the default 250-member NYC synthetic-v1 cohort, engine-v1, consent Network, human review, `spam_wave` and one-hour push/tick settings. The world limit is 60 days; native controls advance two days. These are shared NYC game views, not the separate app CLI simulators.

Each world has 13 HTTP observations. Initial queues contain 19 reviews for seed 7 and 20 for the other seeds. Observations cover the initial read, completed firing, completed resolution, a refresh during pending dispatch, completed overlap, and a later round with no new notice. Reads at 14,999 and 15,000 milliseconds check the existing cache boundary. Another same-clock read checks reuse. Expected summaries come from committed PostgreSQL alert rows and post counts. While dispatch is pending, the expected summary remains the last completed round.

There are also **16 supplemental stored-state cohorts**: normal delivery, HTTP 503 delivery failures, a one-post hourly limit, and a competing transaction's advisory lock, across all four apps. These copy native state shapes and use explicit app scopes. They are fixtures, not additional native worlds or Peon matches. Actual local HTTP responses and PostgreSQL locking exercise the delivery and skip paths. Counts decrease, queues clear, and an hour passes. These cases include post-count changes without a new alert and a skipped dispatch that must retain the previous summary.

| Observed result | Before | After |
| --- | --- | --- |
| HTTP observations with the correct alert summary | 108/240 | 240/240 |
| Missing completed alert summaries | 40 | 0 |
| Open-alert mismatches (including missing summaries) | 120 | 0 |
| Post-count mismatches (including missing summaries) | 112 | 0 |

All 108 already-correct summaries remain identical. The mismatch categories overlap.

| Read phase | Reads per revision | Wrong before | Wrong after |
| --- | --- | --- | --- |
| native/before-first-round | 12 | 0 | 0 |
| native/first-completed | 12 | 12 | 0 |
| native/first-cached | 12 | 12 | 0 |
| native/first-expired | 12 | 0 | 0 |
| native/resolution-completed | 12 | 12 | 0 |
| native/resolution-cached | 12 | 12 | 0 |
| native/resolution-expired | 12 | 0 | 0 |
| native/overlap-pending | 12 | 0 | 0 |
| native/overlap-completed | 12 | 12 | 0 |
| native/overlap-cached | 12 | 12 | 0 |
| native/overlap-expired | 12 | 0 | 0 |
| native/quiet-round | 12 | 0 | 0 |
| native/quiet-cached | 12 | 0 | 0 |
| cohorts/before-first-round | 16 | 0 | 0 |
| cohorts/first-completed | 16 | 16 | 0 |
| cohorts/count-decreased | 16 | 16 | 0 |
| cohorts/queue-cleared | 16 | 12 | 0 |
| cohorts/hour-elapsed | 16 | 16 | 0 |
| cohorts/lock-skipped | 4 | 0 | 0 |

Counts include repeated observations and overlap between missing-summary, open-alert and post-count mismatches. They are deterministic correctness checks, not independent statistical samples. The program asserts the expected cache timestamp at every read, on both revisions.

## safety_gates

All 12 native worlds have **zero invariant violations, zero minor contacts, zero canary leaks and zero recorded errors before and after**. Complete final judge results match. These results cover the measured two-day sequences only.

All native control responses, initial/final consent-state hashes and normalized records match between revisions. Record normalization removes only the run identifier and measured duration. Complete dispatch results and local webhook requests match. Stored source data, alert rows and post records match at every observation, as do all HTTP fields outside `alerts`. HTTP reads leave those database rows unchanged.

The same `bun run sim --only audit,ops --json <output>` command passes **30/30 blocking gates before and after**. All **31 complete gate records** match after excluding execution and restore duration. The tracked backup record passes: 69 tables, 71 rows and a 274 KiB dump on both sides; restore takes 2398 ms before and 2073 ms after. Runtime: 25.6s before and 25.5s after. Gate definitions, thresholds and simulation parameters are unchanged.

No new full `bun run sim` was run. AGENTS.md permits one full run per agent; this session used that allowance earlier. This revision has fresh affected-block evidence, not a claim that the complete simulation passes here.

## Validation and reproduction

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13759 expect() calls
Ran 690 tests across 69 files. [469.89s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [34.52s]
```

The one optional SDK/browser test remains skipped.

From the repository root, with Bun 1.4.2 and PostgreSQL 16.15:

```text
bun install --frozen-lockfile
bun test --conditions eliza-source deploy/backend/ops-metrics-cache.integration.test.ts
bun run typecheck
bun run sim --only audit,ops --json <output>
bun run test:integration
bun run test:e2e
```

Use the isolated development database on port 54339 with `REQUIRE_PG=1`. The integration case must run and report one pass with 18 assertions. The affected simulation blocks must pass all 30 blocking gates.

Save the complete programs below beside two installed checkouts, then run:

```text
bun ops-cache-measure.ts <base-checkout> ops-cache-before.json
bun ops-cache-measure.ts <patched-checkout> ops-cache-after.json
bun ops-cache-compare.ts ops-cache-before.json ops-cache-after.json ops-cache-comparison.json
```

The comparator must exit zero. It checks native commands, state, judge results, persisted rows, dispatch results, webhook requests and HTTP metrics outside `alerts`. Every patched summary must match the committed round, with the same cache timing on both revisions. Runs create and drop disposable databases. Keep all live-send, deploy and live-test flags unset. HTTP servers use loopback and synthetic bearer tokens. No background service ticks, real notifications or external webhooks start.

## Alternatives and limits

1. Invalidate the entire cache after dispatch. That would repeat network and ledger reads within the existing 15-second cache window.
2. Update only the round's original snapshot. That misses a newer cache created by an HTTP request during webhook delivery. The overlap case proves this distinction.

Publishing into the current cache changes only the completed alert summary. It does not refresh other metrics or their timestamp. Alerts still describe the last completed local dispatch. A skipped dispatch retains that prior summary; synchronization with another replica's later work is unchanged. The measurements do not qualify production throughput or broad replica synchronization. Alert rules, persistence, notification delivery, authorization and payload shape are unchanged.

## llm_evidence

N/A: deterministic backend cache publication; no model-backed behavior changes. Validation model calls: **0**; cost: **$0**. Native worlds use policy persona agents. No real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0, primary runtime 26.1104.2876.0, Windows, Bun 1.4.2 and PostgreSQL 16.15. Authoring provider OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests. No agent-client workflow changes.

## Complete measurement programs

### ops-cache-measure.ts

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
const hash=(x:any)=>new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const eq=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
const canonical=(a:any)=>a&&({...a,open:[...a.open].sort((x:any,y:any)=>x.key.localeCompare(y.key))});
let now=0,status=200,blockNext:any;
const clock={now:()=>now},url=await testDb(),sql=new SQL({url,max:2}),lockSql=new SQL({url,max:1});
const svc=new NetworkService({url,clock,networks:apps.map(app=>({id:`${app}:nyc`})),env:{PLATFORM_ENV:"dev"},notify:false,log:()=>{}});
const posts:any[]=[],native:any[]=[],cohorts:any[]=[];
const webhook=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){
  const body=await req.json();posts.push({status,body});
  if(blockNext){const b=blockNext;blockNext=undefined;b.arrived();await b.wait;}
  return new Response("synthetic webhook",{status});
}});
let template:any;
const database=async()=>({
  source:{states:await sql`select id,state,saved_at from network.network_state order by id`,reviews:await sql`select * from network.review_items order by opportunity_id`,opps:await sql`select row_to_json(o) as row from network.opportunities o order by id`},
  alerts:await sql`select * from network.ops_alerts order by key`,posts:await sql`select at,alerts,ok from network.ops_alert_posts order by id`,
});
const setup=async(rows:any,app:string,mode="normal")=>{
  now=+new Date(rows.network_state[0].saved_at);status=mode==="failed-webhook"?503:200;posts.length=0;
  await sql`truncate network.ops_alerts,network.ops_alert_posts restart identity`;
  await writeRows(sql,rows,{truncate:true});
  const token="synthetic-ops-cache-token".padEnd(40,"x");
  const cfg=loadConfig({PLATFORM_ENV:"dev",DATABASE_URL:url,OPS_METRICS_TOKEN:token,ALERT_REVIEW_BACKLOG:"1",ALERT_WEBHOOK_URL:webhook.url.href,ALERT_MAX_PER_HOUR:mode==="rate-limit"?"1":"12"});
  const log=jsonLogger(()=>{}),ops=createOps({config:cfg.ops,probes:()=>[runtimeProbe(svc.runtimes.get(`${app}:nyc`))],store:new PgAlertStore(sql),now:clock.now,log});
  const backend=createBackend({svc,config:cfg,log,ops,now:clock.now,ping:async()=>{await sql`select 1`;return true;}});
  const http=Bun.serve({hostname:"127.0.0.1",port:0,fetch:backend.publicFetch}),frames:any[]=[],rounds:any[]=[];
  let expected:any;
  const committed=async(r:any)=>{
    if(!r)throw Error("Expected a completed dispatch");
    const open=await sql`select key,level,count from network.ops_alerts where open order by key`;
    const [p]=await sql`select count(*)::int as n from network.ops_alert_posts where at > ${new Date(now-HOUR)}`;
    expected=canonical({open:[...open],postsLastHour:p.n});
    if(!eq(expected,canonical({open:r.open,postsLastHour:r.postsLastHour})))throw Error("Dispatch differs from committed SQL state");
    rounds.push(r);
  };
  const tick=async()=>{await committed(await ops.tick());};
  const read=async(phase:string,expectedAt:number)=>{
    const before=hash(await database());
    const res=await fetch(new URL("/ops/metrics",http.url),{headers:{authorization:`Bearer ${token}`}});
    if(res.status!==200)throw Error(`HTTP ${res.status}`);
    const m=await res.json(),{alerts,...metrics}=m,actual=canonical(alerts);
    if(hash(await database())!==before)throw Error("HTTP metrics mutated persisted rows");
    if(m.at!==expectedAt)throw Error(`Cache age changed ${phase}: ${m.at} != ${expectedAt}`);
    frames.push({phase,now,at:m.at,actual,expected:structuredClone(expected),exact:eq(actual,expected),metricsHash:hash(metrics),databaseHash:before});
  };
  return {ops,frames,rounds,read,tick,committed,close:()=>http.stop(true)};
};
try{
  for(const seed of [1,7,13,16])for(const app of ["ntwrk","slop","friends"]){
    const g=new GameSource({app,seed,scenario:"spam_wave",review:"human",pushMs:HOUR,tickMs:HOUR}),commands:any[]=[];
    let run:any,pending:Promise<any>|undefined,release=()=>{};
    const control=async(cmd:any)=>{const r=await g.control(cmd,"reviewer@example.test");if(!r.ok)throw Error(JSON.stringify(r));commands.push({cmd,result:r});};
    const records=()=>g.world.records.map((r:any)=>{if(r.type==="run_start"){const{runId,...v}=r;return v;}if(r.type==="run_end"){const{wallMs,...v}=r;return v;}return r;});
    try{
      await g.init();await control({type:"step",ms:DAY});
      const rows=rowsFromGame(g);template??=structuredClone(rows);
      const before={network:hash(g.consent.exportState()),records:hash(records())};
      run=await setup(rows,app);await run.read("before-first-round",now);
      await run.tick();const first=now;await run.read("first-completed",first);
      now=first+14_999;await run.read("first-cached",first);
      now=first+15_000;await run.read("first-expired",now);
      for(const o of g.state().opportunities.filter((o:any)=>o.state==="IN_REVIEW"))await control({type:"review",oppId:o.id,decision:"reject",reason:"weak_reason"});
      await writeRows(sql,rowsFromGame(g),{truncate:true});now+=MIN;
      await run.tick();const cleared=now;await run.read("resolution-completed",cleared);
      now=cleared+14_999;await run.read("resolution-cached",cleared);
      now=cleared+15_000;await run.read("resolution-expired",now);
      await control({type:"step",ms:DAY});await writeRows(sql,rowsFromGame(g),{truncate:true});now=g.state().clock.now;
      let arrived=()=>{};const ready=new Promise<void>(r=>{arrived=r;}),wait=new Promise<void>(r=>{release=r;});
      blockNext={arrived,wait};pending=run.ops.tick();
      await Promise.race([ready,pending!.then(()=>{throw Error("Webhook did not wait");})]);
      now+=16_000;await run.read("overlap-pending",now);const refreshed=now;
      release();await run.committed(await pending);pending=undefined;
      await run.read("overlap-completed",refreshed);
      now=refreshed+14_999;await run.read("overlap-cached",refreshed);
      now=refreshed+15_000;await run.read("overlap-expired",now);
      now+=MIN;await run.tick();await run.read("quiet-round",now);await run.read("quiet-cached",now);
      const m=computeMetrics(g.world.records,{requireReview:true});
      native.push({seed,app,commands,before,after:{network:hash(g.consent.exportState()),records:hash(records())},frames:run.frames,rounds:run.rounds,posts:structuredClone(posts),
        judge:{invariants:m.invariants,minorContacts:m.safety.minorContacts,canaryLeaks:m.privacy.canaryLeaks,errors:m.errors}});
      console.log(JSON.stringify({kind:"native",seed,app,frames:run.frames.length,wrong:run.frames.filter((f:any)=>!f.exact).length}));
    }finally{release();await pending?.catch(()=>{});blockNext=undefined;run?.close();await g.dispose();}
  }
  // Supplemental persisted-state cohorts exercise the same HTTP route and actual delivery/store
  // behavior. They are not additional native app worlds or live provider calls.
  for(const app of apps)for(const mode of ["normal","failed-webhook","rate-limit","lock-held"]){
    const rows=structuredClone(template);for(const k of Object.keys(rows))if(k!=="app"&&k!=="network_state")rows[k]=[];
    rows.app=app;rows.network_state[0].id=`${app}:nyc`;
    const original=structuredClone(rows.network_state[0].state),run=await setup(rows,app,mode);
    try{
      await run.read("before-first-round",now);await run.tick();await run.read("first-completed",now);
      const reduced={...structuredClone(original),opps:original.opps.filter((o:any,i:number)=>o.stage!=="review"||i%2===0)};
      await sql`update network.network_state set state=${reduced}::jsonb where id=${`${app}:nyc`}`;
      if(mode==="lock-held"){
        now+=MIN;
        await lockSql.begin(async tx=>{
          await tx`select pg_advisory_xact_lock(hashtext('thenetwork-ops-alerts'))`;
          if(await run.ops.tick()!==undefined)throw Error("Competing lock was ignored");
          await run.read("lock-skipped",now);
        });
      }
      now+=MIN;await run.tick();await run.read("count-decreased",now);
      const cleared={...reduced,opps:reduced.opps.filter((o:any)=>o.stage!=="review")};
      await sql`update network.network_state set state=${cleared}::jsonb where id=${`${app}:nyc`}`;
      now+=MIN;await run.tick();await run.read("queue-cleared",now);
      status=200;now+=HOUR;
      await sql`update network.network_state set state=${{...cleared,lastTick:now}}::jsonb,saved_at=${new Date(now)} where id=${`${app}:nyc`}`;
      await run.tick();await run.read("hour-elapsed",now);
      cohorts.push({app,mode,frames:run.frames,rounds:run.rounds,posts:structuredClone(posts)});
    }finally{run.close();}
  }
  await Bun.write(out,JSON.stringify({native,cohorts},null,2));
  console.log(JSON.stringify({native:native.length,cohorts:cohorts.length,frames:[...native,...cohorts].flatMap(x=>x.frames).length}));
}finally{webhook.stop(true);await svc.close();await sql.close();await lockSql.close();await dropTestDb();}
```

### ops-cache-compare.ts

```ts
const a=await Bun.file(process.argv[2]!).json(),b=await Bun.file(process.argv[3]!).json();
const eq=(x:any,y:any)=>JSON.stringify(x)===JSON.stringify(y);
if(a.native.length!==12||b.native.length!==12||a.cohorts.length!==16||b.cohorts.length!==16)throw Error("Unexpected matrix size");
const result={nativeWorlds:12,cohorts:16,frames:0,correctBefore:0,correctAfter:0,unchanged:0,missingSummariesBefore:0,wrongOpenBefore:0,wrongPostCountBefore:0,
  invariants:{} as Record<string,number>,minorContacts:0,canaryLeaks:0,errors:0,phases:{} as Record<string,any>,modes:{} as Record<string,any>};
for(const kind of ["native","cohorts"]){
  for(let i=0;i<a[kind].length;i++){
    const x=a[kind][i],y=b[kind][i];
    for(const k of ["seed","app","mode","commands","before","after","judge","rounds","posts"])if(!eq(x[k],y[k]))throw Error(`Source, dispatch or native drift ${kind}/${i}/${k}`);
    const count=kind==="native"?13:x.mode==="lock-held"?6:5;
    if(x.frames.length!==count||y.frames.length!==count)throw Error("Unexpected phase count");
    for(let j=0;j<x.frames.length;j++){
      const p=x.frames[j],q=y.frames[j];
      for(const k of ["phase","now","at","expected","metricsHash","databaseHash"])if(!eq(p[k],q[k]))throw Error(`Frame drift ${kind}/${i}/${j}/${k}`);
      result.frames++;result.correctBefore+=+p.exact;result.correctAfter+=+q.exact;result.unchanged+=+eq(p.actual,q.actual);
      if(!q.exact)throw Error(`Wrong after ${kind}/${i}/${q.phase}: ${JSON.stringify(q)}`);
      result.missingSummariesBefore+=+(!!p.expected&&!p.actual);
      result.wrongOpenBefore+=+!eq(p.actual?.open,p.expected?.open);
      result.wrongPostCountBefore+=+!eq(p.actual?.postsLastHour,p.expected?.postsLastHour);
      const phase=result.phases[`${kind}/${q.phase}`]??={n:0,wrongBefore:0,wrongAfter:0};phase.n++;phase.wrongBefore+=+!p.exact;phase.wrongAfter+=+!q.exact;
      if(kind==="cohorts"){const mode=result.modes[x.mode]??={n:0,wrongBefore:0,wrongAfter:0};mode.n++;mode.wrongBefore+=+!p.exact;mode.wrongAfter+=+!q.exact;}
    }
    if(kind==="native"){
      for(const [k,v] of Object.entries(y.judge.invariants.byRule))result.invariants[k]=(result.invariants[k]??0)+(v as number);
      result.minorContacts+=y.judge.minorContacts;result.canaryLeaks+=y.judge.canaryLeaks;result.errors+=y.judge.errors;
    }
  }
}
if(result.frames!==240)throw Error("Unexpected total observations");
await Bun.write(process.argv[4]!,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
```
