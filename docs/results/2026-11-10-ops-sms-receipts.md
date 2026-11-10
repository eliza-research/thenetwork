# Count accepted SMS receipts in monitoring and daily costs

Date: 2026-11-10. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Problem and requirement

The outbound queue stores SMS as `transport: "sms"` alongside a normal receipt status such as `sent`, `delivered` or `read`. The ops collector counts only message rows whose status is `fell_back`. Consequently, an actual SMS receipt can appear in neither the SMS counters nor the daily SMS cost accrual, and its budget alert can be missed. Later delivery updates do not fix this: transport remains SMS while status advances normally.

This is a reproduced defect under CONTRIBUTING 3.1 and the approved Slop scope. PRD 35.2 and 36 cover monitoring and per-day cost alerts; MVP-plan items 11 and 12 cover monitoring and cost tracking. `docs/deploy.md` 7.2 and 7.3 specify the operational counters, daily ledger and budget alerts.

The collector now joins messages to the same app's persisted outbound receipts. A stored SMS transport with a non-null acceptance time counts on its acceptance UTC day, and within the rolling 24-hour window when appropriate. Legacy `fell_back` rows remain supported. A message bearing both the legacy marker and an SMS receipt counts once. `smsByDay` keeps its existing public shape; the probe also supplies a rolling count for `sends24h.smsFallback`. Probes without that optional count retain the legacy status-derived behavior. The two existing cost descriptions now describe the receipt source.

This uses the durable transport field instead of rewriting delivery statuses to a synthetic fallback status, which would discard normal delivery progress. Joining once also avoids adding two independently counted populations and double billing rows that have both representations. Rates, budget thresholds, ledger IDs and dispatch policy are unchanged.

## Regression

`deploy/backend/ops-sms-receipts.integration.test.ts` uses real PostgreSQL, `NetworkService`, its persisted outbound queue, `CostLedger`, the backend HTTP route and `PgAlertStore`. An explicitly simulated provider communicates with a loopback HTTP endpoint. Its controlled sent/unresolved receipts exercise the actual adapter, send and receipt-recovery paths. No live-send environment flag is set. A synthetic verified-profile fixture supplies phone proof; no real OTP or carrier is involved.

At 23:59 UTC, one requested reminder receives an SMS `sent` receipt and another has unresolved acceptance. The first is stored as `sent`, with SMS transport. On base, the HTTP metrics report zero SMS instead of one. After the fix, the daily cost is $0.0083 at the repository's default estimate and a deliberately small $0.005 test budget alerts.

After midnight, the first message advances to `delivered` without resupplying its transport, and receipt recovery accepts the second SMS without another send. Both UTC days receive one SMS charge. An iMessage control adds no SMS charge. Explicit compatibility fixtures add a legacy-only SMS and put the legacy marker on the receipt-backed second SMS. The result is two SMS charges today and one yesterday, not a duplicate charge for the overlapping row. Another ops round leaves today's quantity and cost unchanged.

| Same test command | Base | Fix |
| --- | --- | --- |
| `bun test --conditions eliza-source deploy/backend/ops-sms-receipts.integration.test.ts` | 0 pass, 1 fail; 4 assertions | 1 pass, 0 fail; 19 assertions |
| Case duration | 5048.54 ms | 2953.40 ms |
| Suite duration | 5.13 s | 3.18 s |

The final test file was copied unchanged to the clean base for the failing run and then removed. Durations include local setup and are not performance evidence. Backend, database, queue, ledger and dispatcher behavior is real; provider responses, member proof and compatibility rows are synthetic. No real carrier or Cloud deployment is qualified by this test.

## measurement

| Observation | Before | After |
| --- | --- | --- |
| Correct SMS counters, cost rows and budget state | 64/172 | 172/172 |
| Incorrect SMS counters | 108 | 0 |
| Incorrect cost totals or daily ledger rows | 108 | 0 |
| Missed budget open-alert observations | 96 | 0 |

All 64 already-correct observations stay correct and identical. Mismatch counts overlap; the 96 missed-alert observations are not 96 distinct incidents.

The paired programs below run unchanged against base and candidate. They generate 12 native worlds: seeds 1, 7, 13 and 16 × ntwrk, slop and friends; default NYC dataset; engine-v1; `spam_wave`; human review; policy persona agents; default 60-day limit. Each advances one day plus five minutes. The one-hour wall-clock UI timer settings do not change the simulation's tick schedule. The original native world is left unchanged during the monitoring experiment.

Each native snapshot is written to PostgreSQL and observed eight times: baseline; an accepted SMS; its delivered update; its read update; an overlapping legacy marker plus one legacy-only SMS; midnight with a delayed receipt queued two days earlier but accepted now; an iMessage control; and exactly 24 hours after the first SMS acceptance. Expectations are explicit phase counts. The last phase excludes the first receipt from the rolling window but retains the later legacy and delayed receipts. These are controlled transport fixtures over native snapshots, not SMS outcomes emitted by the native simulator.

Nineteen single-observation fixtures run for each of all four apps, including Peon: accepted, sent, delivered, read, failed after acceptance, SMS without acceptance, unknown transport, iMessage, RCS, inbound, a receipt from another app, queued two days earlier, yesterday's acceptance, the exact 24-hour cutoff, older than yesterday, overlapping legacy/receipt representations, legacy-only today, legacy-only yesterday, and the inclusive start of yesterday. These 76 cohorts use a native schema/state template and explicit synthetic outcomes; they are not additional native worlds or Peon matching simulations.

Every observation calls the real ops round, then the actual authenticated HTTP metrics route. It compares both SMS counters, the complete daily cost object, SMS ledger day/quantity/amount rows, and the persisted budget-alert state with the fixture oracle. The small per-app test budget is $0.005; the existing default SMS estimate is $0.0083. Repeated native phases verify that daily rows are replaced idempotently rather than added again. The loopback webhook returns HTTP 200 and its received budget notices must equal dispatcher notices.

Before and after use identical stored-state, message, review, opportunity and outbound-queue hashes. Ops and HTTP reads leave these measured source tables unchanged. All HTTP metrics other than cost and the two SMS counters, and all non-budget notices/open alerts, remain identical between revisions. The cached `alerts` field is excluded because it reports the preceding completed round on this base; persisted and returned dispatcher state are checked directly. Full native state, normalized run records, command results and complete invariant objects also match, along with minor-contact, canary-leak and recorded-error counts. Only run IDs and run-end wall duration are removed from the native record hash. SQL row-to-JSON reads preserve stable numeric values without rounding.

| Phase | Reads per revision | Wrong before | Wrong after |
| --- | --- | --- | --- |
| native/native-baseline | 12 | 0 | 0 |
| native/accepted-sms | 12 | 12 | 0 |
| native/delivered-sms | 12 | 12 | 0 |
| native/read-sms | 12 | 12 | 0 |
| native/legacy-overlap | 12 | 0 | 0 |
| native/midnight-delayed-receipt | 12 | 12 | 0 |
| native/imessage-control | 12 | 12 | 0 |
| native/exact-24h-cutoff | 12 | 12 | 0 |
| cohorts/accepted | 4 | 4 | 0 |
| cohorts/sent | 4 | 4 | 0 |
| cohorts/delivered | 4 | 4 | 0 |
| cohorts/read | 4 | 4 | 0 |
| cohorts/failed-after-acceptance | 4 | 4 | 0 |
| cohorts/sms-without-acceptance | 4 | 0 | 0 |
| cohorts/unknown-transport | 4 | 0 | 0 |
| cohorts/imessage | 4 | 0 | 0 |
| cohorts/rcs | 4 | 0 | 0 |
| cohorts/inbound | 4 | 0 | 0 |
| cohorts/other-app | 4 | 0 | 0 |
| cohorts/queued-two-days-ago | 4 | 4 | 0 |
| cohorts/yesterday | 4 | 4 | 0 |
| cohorts/exact-24h | 4 | 4 | 0 |
| cohorts/older-than-yesterday | 4 | 0 | 0 |
| cohorts/legacy-overlap | 4 | 0 | 0 |
| cohorts/legacy-today | 4 | 0 | 0 |
| cohorts/legacy-yesterday | 4 | 0 | 0 |
| cohorts/yesterday-start | 4 | 4 | 0 |

These are exact deterministic comparisons on the listed fixtures and seeds, not a sampled estimate of carrier traffic or a statistical claim about matching quality.

## safety_gates

All 12 native worlds have **zero invariant violations, zero minor contacts, zero canary leaks and zero recorded errors before and after**. Complete invariant objects match. These results cover the one-day-plus-five-minute native sequences and their unchanged snapshots used for monitoring.

The same `bun run sim --only audit,ops --json <output>` command passes **30/30 blocking gates before and after**. All **31 complete gate records** match after excluding execution and restore duration. The tracked backup drill passes: 69 tables, 71 rows, 274 KiB on both sides; restore 2038 ms before and 1977 ms after. Runtime: 26.3s before and 26.2s after. This includes the real service-role probe under row-level security. Existing gate fixtures, expected values and thresholds are unchanged.

No new full `bun run sim`: AGENTS.md permits one full run per agent, already used earlier in this session. These are fresh affected-block checks. The production change does not alter matching, review, consent, send authorization or delivery controls.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13760 expect() calls
Ran 690 tests across 69 files. [410.87s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [36.37s]
```

The optional SDK/browser case remains skipped.

## llm_evidence

N/A: deterministic receipt aggregation and cost accounting. Validation model calls: 0; cost: $0. Native worlds use policy persona agents. No real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0 / primary runtime 26.1104.2876.0, Windows, Bun 1.4.2, PostgreSQL 16.15. Authoring provider OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests. No agent-client workflow changes.

## Limits

Daily costs may rise and budget alerts may fire when previously omitted SMS receipts are counted. Prices remain estimates with the existing `COST_SMS_USD` override. Acceptance is required for a receipt-backed SMS charge; a later failure does not erase that acceptance. A legacy-only row still uses its message timestamp because it has no receipt time.

This collector counts retained outbound network messages with persisted receipt transport, plus legacy markers. It does not create missing transport metadata, backfill older days beyond the existing today/yesterday accrual window, count orphaned/non-member queue rows, or change data deletion policy. The Cloud wire contract is unchanged. Other send outcome counters still use their existing message timestamps and statuses; only the SMS counter uses the receipt acceptance time. No production pricing, throughput or real-provider behavior was tested.

## Reproduce

Save both programs outside the two checkouts. Use frozen dependencies, Bun 1.4.2, local PostgreSQL 16 on port 54339, `USER=postgres`, and `REQUIRE_PG=1`. Keep model-provider keys, live-send and deployment flags unset. PostgreSQL binaries and Git's `bash` are on PATH on this Windows host. Each measurement creates and drops its own process-specific test database.

```text
bun run --conditions eliza-source ops-sms-measure.ts <base-checkout> before.json
bun run --conditions eliza-source ops-sms-measure.ts <candidate-checkout> after.json
bun ops-sms-compare.ts before.json after.json comparison.json
bun run typecheck
bun run sim --only audit,ops --json gates.json
bun run test:integration
bun run test:e2e
```

The comparator rejects any wrong candidate target result, source drift, changed non-target metric/alert, or difference between budget notices and loopback delivery. Full integration has the host limits above.

### ops-sms-measure.ts

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
const MIN=60_000,HOUR=60*MIN,DAY=24*HOUR,apps=["ntwrk","slop","peon","friends"],rate=0.0083;
const hash=(x:any)=>new Bun.CryptoHasher("sha256").update(JSON.stringify(x,(_k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest("hex");
const eq=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b),day=(t:number)=>new Date(t).toISOString().slice(0,10),usd=(n:number)=>Math.round(n*rate*10000)/10000;
let now=0,template:any;
const clock={now:()=>now},url=await testDb(),sql=new SQL({url,max:2});
const svc=new NetworkService({url,clock,networks:apps.map(app=>({id:`${app}:nyc`})),env:{PLATFORM_ENV:"dev"},notify:false,log:()=>{}});
const posts:any[]=[],native:any[]=[],cohorts:any[]=[];
const webhook=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){posts.push(await req.json());return new Response("ok");}});
const source=async()=>({state:await sql`select id,state,saved_at from network.network_state order by id`,
  messages:await sql`select row_to_json(m) as row from network.messages m order by id`,reviews:await sql`select row_to_json(r) as row from network.review_items r order by opportunity_id`,
  opps:await sql`select row_to_json(o) as row from network.opportunities o order by id`,queue:await sql`select row_to_json(o) as row from platform.outbound o order by id`});
const setup=async(rows:any,app:string,cohort=false)=>{
  now=+new Date(rows.network_state[0].saved_at);posts.length=0;
  await sql`truncate network.ops_alerts,network.ops_alert_posts,network.cost_ledger,platform.outbound restart identity`;
  await writeRows(sql,rows,{truncate:true});
  if(cohort){now=Math.floor(now/DAY)*DAY+15*HOUR;await sql`delete from network.messages where app_id=${app}`;}
  else if(rows.messages.some((m:any)=>m.direction==="outbound"&&m.status!=="delivered"))throw Error("Unexpected native outcome");
  const member=rows.members[0].id,key=`budget:${app}`,frames:any[]=[],ledger=new Map<string,number>(),token="synthetic-ops-sms-token".padEnd(40,"x");
  const config=loadConfig({PLATFORM_ENV:"dev",DATABASE_URL:url,OPS_METRICS_TOKEN:token,ALERT_WEBHOOK_URL:webhook.url.href,[`COST_BUDGET_DAILY_USD_${app.toUpperCase()}`]:"0.005"});
  const log=jsonLogger(()=>{}),ops=createOps({config:config.ops,probes:()=>[runtimeProbe(svc.runtimes.get(`${app}:nyc`))],store:new PgAlertStore(sql),cost:svc.cost,now:clock.now,log});
  const backend=createBackend({svc,config,log,ops,now:clock.now,ping:async()=>{await sql`select 1`;return true;}});
  const http=Bun.serve({hostname:"127.0.0.1",port:0,fetch:backend.publicFetch});
  const add=async(id:string,o:{status?:string;transport?:string|null;sent?:number|null;ts?:number;direction?:string;queueApp?:string;legacyOnly?:boolean}={})=>{
    const ts=o.ts??now,status=o.status??"sent",sent=o.sent===undefined?now:o.sent;
    await sql`insert into network.messages (id,app_id,member_id,direction,body,status,ts)
      values (${id},${app},${member},${o.direction??"outbound"},'Synthetic transport receipt',${status},${new Date(ts)})`;
    if(!o.legacyOnly)await sql`insert into platform.outbound (id,app_id,member_id,line,to_address,kind,body,fingerprint,time_zone,status,next_attempt_at,created_at,updated_at,transport,sent_at)
      values (${id},${o.queueApp??app},${member},'+12125550170','+12125550171','reply','Synthetic transport receipt',${id},'UTC',${status},${new Date(ts)},${new Date(ts)},${new Date(ts)},${o.transport===undefined?"sms":o.transport},${sent===null?null:new Date(sent)})`;
  };
  const status=async(id:string,value:string)=>{await sql`update network.messages set status=${value} where id=${id}`;await sql`update platform.outbound set status=${value} where id=${id}`;};
  const read=async(phase:string,today:number,yesterday:number,last24h:number)=>{
    const before=hash(await source()),r=await ops.tick();if(!r)throw Error("Ops did not run");
    const res=await fetch(new URL("/ops/metrics",http.url),{headers:{authorization:`Bearer ${token}`}});if(res.status!==200)throw Error(`HTTP ${res.status}`);
    const m=await res.json();if(hash(await source())!==before)throw Error("Monitoring changed source rows");
    if(m.networks.length!==1||m.networks[0].error||m.cost.error)throw Error("Metrics read failed");
    const {smsByDay,sends24h,...network}=m.networks[0],{smsFallback,...otherSends}=sends24h,{alerts,networks,cost,...metrics}=m;
    if(today)ledger.set(day(now),today);if(yesterday)ledger.set(day(now-DAY),yesterday);
    const expectedLedger=[...ledger.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([day,quantity])=>({day,quantity,cost_usd:usd(quantity)}));
    const actualLedger=await sql`select day::text,quantity::float8,cost_usd::float8 from network.cost_ledger where app_id=${app} and kind='sms_fallback' order by day`;
    const expectedCost={day:day(now),totalUsd:usd(today),byApp:today?{[app]:usd(today)}:{},budgets:[{scope:app,usedUsd:usd(today),budgetUsd:0.005,share:usd(today)/0.005}]};
    const expected={smsByDay:{today,yesterday},smsFallback:last24h,cost:expectedCost,ledger:expectedLedger};
    const actual={smsByDay,smsFallback,cost,ledger:actualLedger};
    const open=r.open.some((a:any)=>a.key===key),stored=await sql`select key from network.ops_alerts where key=${key} and open`,expectedOpen=today>0;
    if(open!==!!stored.length)throw Error("Dispatch differs from persisted alerts");
    frames.push({phase,now,expected,actual,expectedOpen,open,exact:eq(actual,expected)&&open===expectedOpen,sourceHash:before,
      otherMetricsHash:hash({...metrics,networks:[{...network,sends24h:otherSends}]}),notices:r.notices.filter((a:any)=>a.key===key),
      otherNotices:r.notices.filter((a:any)=>a.key!==key),otherOpen:r.open.filter((a:any)=>a.key!==key)});
    now+=MIN;
  };
  return {frames,add,status,read,close:()=>http.stop(true)};
};
try{
  for(const seed of [1,7,13,16])for(const app of ["ntwrk","slop","friends"]){
    const g=new GameSource({app,seed,scenario:"spam_wave",review:"human",pushMs:HOUR,tickMs:HOUR});let run:any;
    try{
      await g.init();const step=await g.control({type:"step",ms:DAY+5*MIN},"reviewer@example.test");if(!step.ok)throw Error(step.error);
      const records=()=>g.world.records.map((r:any)=>{if(r.type==="run_start"){const{runId,...v}=r;return v;}if(r.type==="run_end"){const{wallMs,...v}=r;return v;}return r;});
      const before={network:hash(g.consent.exportState()),records:hash(records())},rows=rowsFromGame(g);template??=structuredClone(rows);
      run=await setup(rows,app);await run.read("native-baseline",0,0,0);
      const first=now;await run.add("sms-accepted");await run.read("accepted-sms",1,0,1);
      await run.status("sms-accepted","delivered");await run.read("delivered-sms",1,0,1);
      await run.status("sms-accepted","read");await run.read("read-sms",1,0,1);
      await run.status("sms-accepted","fell_back");await run.add("sms-legacy",{status:"fell_back",legacyOnly:true});await run.read("legacy-overlap",2,0,2);
      now=(Math.floor(now/DAY)+1)*DAY;await run.add("sms-delayed",{ts:now-2*DAY});await run.read("midnight-delayed-receipt",1,2,3);
      await run.add("imessage-control",{transport:"imessage"});await run.read("imessage-control",1,2,3);
      now=first+DAY;await run.read("exact-24h-cutoff",1,2,2);
      const m=computeMetrics(g.world.records,{requireReview:true});
      native.push({seed,app,step,before,after:{network:hash(g.consent.exportState()),records:hash(records())},frames:run.frames,posts:structuredClone(posts),
        judge:{invariants:m.invariants,minorContacts:m.safety.minorContacts,canaryLeaks:m.privacy.canaryLeaks,errors:m.errors}});
      console.log(JSON.stringify({kind:"native",seed,app,frames:run.frames.length,wrong:run.frames.filter((f:any)=>!f.exact).length}));
    }finally{run?.close();await g.dispose();}
  }
  for(const app of apps)for(const name of ["accepted","sent","delivered","read","failed-after-acceptance","sms-without-acceptance","unknown-transport","imessage","rcs","inbound","other-app","queued-two-days-ago","yesterday","exact-24h","older-than-yesterday","legacy-overlap","legacy-today","legacy-yesterday","yesterday-start"]){
    const rows=structuredClone(template);rows.app=app;rows.network_state[0].id=`${app}:nyc`;
    const run=await setup(rows,app,true);
    try{
      const start=Math.floor(now/DAY)*DAY;
      let fixture:any={},expected=[1,0,1];
      if(["accepted","sent","delivered","read"].includes(name))fixture.status=name;
      else if(name==="failed-after-acceptance")fixture.status="failed";
      else if(name==="sms-without-acceptance"){fixture={status:"unknown_acceptance",sent:null};expected=[0,0,0];}
      else if(name==="unknown-transport"){fixture.transport=null;expected=[0,0,0];}
      else if(["imessage","rcs"].includes(name)){fixture.transport=name;expected=[0,0,0];}
      else if(name==="inbound"){fixture.direction="inbound";expected=[0,0,0];}
      else if(name==="other-app"){fixture.queueApp=apps.find(a=>a!==app);expected=[0,0,0];}
      else if(name==="queued-two-days-ago")fixture.ts=now-2*DAY;
      else if(name==="yesterday"){fixture.sent=start-1;expected=[0,1,1];}
      else if(name==="exact-24h"){fixture.sent=now-DAY;expected=[0,1,0];}
      else if(name==="older-than-yesterday"){fixture.sent=start-DAY-1;expected=[0,0,0];}
      else if(name==="legacy-overlap")fixture.status="fell_back";
      else if(name==="legacy-today")fixture={status:"fell_back",legacyOnly:true};
      else if(name==="legacy-yesterday"){fixture={status:"fell_back",legacyOnly:true,ts:start-1};expected=[0,1,1];}
      else if(name==="yesterday-start"){fixture.sent=start-DAY;expected=[0,1,0];}
      await run.add("sms-fixture",fixture);await run.read(name,...expected as [number,number,number]);
      cohorts.push({app,name,fixture,frames:run.frames,posts:structuredClone(posts)});
      console.log(JSON.stringify({kind:"cohort",app,name,wrong:run.frames.filter((f:any)=>!f.exact).length}));
    }finally{run.close();}
  }
  await Bun.write(out,JSON.stringify({native,cohorts},null,2));
}finally{webhook.stop(true);await svc.close();await sql.close();await dropTestDb();}
```

### ops-sms-compare.ts

```ts
const a=await Bun.file(process.argv[2]!).json(),b=await Bun.file(process.argv[3]!).json();
const eq=(x:any,y:any)=>JSON.stringify(x)===JSON.stringify(y);
if(a.native.length!==12||b.native.length!==12||a.cohorts.length!==76||b.cohorts.length!==76)throw Error("Unexpected matrix size");
const result={nativeWorlds:12,cohorts:76,frames:0,correctBefore:0,correctAfter:0,unchanged:0,wrongCountersBefore:0,wrongCostBefore:0,missedAlertsBefore:0,
  invariants:{} as Record<string,number>,minorContacts:0,canaryLeaks:0,errors:0,phases:{} as Record<string,any>};
for(const kind of ["native","cohorts"]){
  for(let i=0;i<a[kind].length;i++){
    const x=a[kind][i],y=b[kind][i];
    for(const k of ["seed","app","name","fixture","step","before","after","judge"])if(!eq(x[k],y[k]))throw Error(`Input drift ${kind}/${i}/${k}`);
    if(kind==="native"&&!eq(x.before,x.after))throw Error("Native world changed during measurement");
    if(x.frames.length!==(kind==="native"?8:1)||x.frames.length!==y.frames.length)throw Error("Wrong phase count");
    for(let j=0;j<x.frames.length;j++){
      const p=x.frames[j],q=y.frames[j];
      for(const k of ["phase","now","expected","expectedOpen","sourceHash","otherMetricsHash","otherNotices","otherOpen"])
        if(!eq(p[k],q[k]))throw Error(`Unexpected drift ${kind}/${i}/${j}/${k}`);
      if(!q.exact)throw Error(`Wrong after ${kind}/${i}/${q.phase}: ${JSON.stringify({actual:q.actual,expected:q.expected,open:q.open})}`);
      result.frames++;result.correctBefore+=+p.exact;result.correctAfter+=+q.exact;
      result.unchanged+=+(eq(p.actual,q.actual)&&p.open===q.open);
      result.wrongCountersBefore+=+(!eq(p.actual.smsByDay,p.expected.smsByDay)||p.actual.smsFallback!==p.expected.smsFallback);
      result.wrongCostBefore+=+(!eq(p.actual.cost,p.expected.cost)||!eq(p.actual.ledger,p.expected.ledger));
      result.missedAlertsBefore+=+(p.expectedOpen&&!p.open);
      const phase=result.phases[`${kind}/${q.phase}`]??={n:0,wrongBefore:0,wrongAfter:0};phase.n++;phase.wrongBefore+=+!p.exact;phase.wrongAfter+=+!q.exact;
    }
    for(const w of [x,y]){
      const sent=w.posts.flatMap((p:any)=>p.alerts.filter((n:any)=>n.key===`budget:${w.app}`));
      if(!eq(sent,w.frames.flatMap((f:any)=>f.notices)))throw Error("Webhook delivery differs from dispatch");
    }
    if(kind==="native"){
      if(y.judge.invariants.total||y.judge.minorContacts||y.judge.canaryLeaks||y.judge.errors)throw Error("Native safety gate failed");
      for(const [k,v] of Object.entries(y.judge.invariants.byRule))result.invariants[k]=(result.invariants[k]??0)+(v as number);
      result.minorContacts+=y.judge.minorContacts;result.canaryLeaks+=y.judge.canaryLeaks;result.errors+=y.judge.errors;
    }
  }
}
if(result.frames!==172)throw Error("Wrong observation count");
await Bun.write(process.argv[4]!,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
```
