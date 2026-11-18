# Preserve alerts when their metrics cannot be read (2026-11-10)

## Defect and requirement

A monitoring read failure can falsely resolve an active alert. The collector correctly reports `ops_read:<network>`, `line_read` or `cost_read`. The dispatcher then treats the missing source alerts as ended. It posts recovery notices and closes their stored state, even when their underlying records remain.

This is a reproduced monitoring defect under the approved Slop scope and CONTRIBUTING 3.1. PRD 35.2 and MVP-plan item 11 require operational and safety alerts. `docs/deploy.md` 7.2 requires one resolved notice when an alert ends, and persistent alert state across restarts. A failed read does not establish that a condition ended. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The dispatcher now retains missing alerts belonging to an unread source. Network read failures retain that network's alerts. Shared-line failures retain line restrictions and held-text alerts. Ledger failures retain budget alerts. Readable sources still resolve independently. The last observed state and notification timestamps stay unchanged until the source is readable. The existing read-error warning reports the outage.

The change adds six lines to the dispatcher. It reuses the existing alert key scopes and changes no alert thresholds, SQL, access rules or webhook payload format.

## Native PostgreSQL and HTTP regression

One integration case uses the actual GameSource, consent Network, engine, review controls, migrated PostgreSQL, NetworkService runtimes, ops collector and dispatcher. A local HTTP server receives the real webhook requests. The service and notifier are not started; no message reaches a real member or external webhook.

Seed 1 with `spam_wave` creates 20 native review items after one day. Explicit synthetic line, held-text and cost records add four more alerts. Temporary table renames make all three source reads fail. The alert tables and local webhook stay available.

Before the fix, the webhook receives five false resolved notices: `queue_review:ntwrk:nyc`, `line_safety`, `leak_review:slop`, `budget:total` and `budget:ntwrk`. Their source records remain. The final case reports **0 pass / 1 fail / 4 assertions**, 5.06 s. After: **1 pass / 0 fail / 13 assertions**, 5.72 s. Case runtimes are 4849.30 ms and 5640.53 ms. The baseline stops at the first failure; these times are not a performance comparison.

The passing case also restarts the ops runner during the outage and checks the complete stored rows. Restoring reads resolves only the read-error alerts. The original conditions then end: native review decisions empty the queue, the synthetic line restriction and held text clear, and a new UTC day has no cost events. Only then do the original alerts resolve, once.

## measurement

The complete paired program below exercises **12 native worlds per revision**: seeds **1, 7, 13 and 16** across **ntwrk, slop and friends**. Each uses the default 250-member NYC synthetic-v1 cohort, engine-v1, consent Network, human review, `spam_wave` and one-hour push/tick settings. The world limit is 60 days; controls advance one day and later reject the waiting proposals. Monitoring reads use separate one-minute observation increments.

These are shared NYC game views, not the separate app CLI simulators. Peon's locked matching is not bypassed. Each sequence includes explicit synthetic cost, line and held-text records. A synthetic second runtime starts with an old heartbeat and recovers during the first runtime's outage. That control verifies that readable networks can still resolve independently.

There are also **32 stored-state cohorts**: every subset of the three unread sources, including none, for each of four apps. These use copies of native state shapes with explicit app scopes. They are fixtures, not additional simulated worlds or native Peon matches. Budget inputs are synthetic two-dollar rows, not paid calls. Fixture recovery sets their quantity and cost to zero; the integration case instead uses the next UTC day.

Each sequence has six observations: initial alerts, outage, runner restart during the outage, reads recovered with original conditions still active, conditions ended, and a quiet follow-up. In the matrix, a deliberately invalid report timestamp fails only the selected app's actual PostgreSQL report query. Temporary line/ledger table renames fail those reads. Readable conditions end during the outage. Unread conditions keep their records until the later recovery step.

| Observed result | Before | After |
| --- | --- | --- |
| Observations with correct open state and notices | 144/264 | 264/264 |
| False resolved notices | 140 | 0 |
| False new firing notices after reads recovered | 140 | 0 |
| Missing open-alert entries across outage and restart observations | 280 | 0 |
| Readable counterpart recoveries delivered | 44 | 44 |

All 144 already-correct measured state/notice observations remain identical. Unknown-source rows retain their complete state, including first/last observation and notification timestamps.

| Read phase | Reads per revision | Wrong before | Wrong after |
| --- | --- | --- | --- |
| native/initial | 12 | 0 | 0 |
| native/outage | 12 | 12 | 0 |
| native/restart | 12 | 12 | 0 |
| native/read-recovered | 12 | 12 | 0 |
| native/conditions-ended | 12 | 0 | 0 |
| native/quiet | 12 | 0 | 0 |
| cohorts/initial | 32 | 0 | 0 |
| cohorts/outage | 32 | 28 | 0 |
| cohorts/restart | 32 | 28 | 0 |
| cohorts/read-recovered | 32 | 28 | 0 |
| cohorts/conditions-ended | 32 | 0 | 0 |
| cohorts/quiet | 32 | 0 | 0 |

Counts include repeated observations of the same sources. They measure deterministic behavior, not independent statistical samples. All webhook calls stay on loopback and return HTTP 200. The new matrix does not qualify combined outages with an exhausted post quota or a failed webhook; the existing ops gates separately cover rate limits and retry behavior.

## safety_gates

All 12 native worlds have **zero invariant violations, zero minor contacts, zero canary leaks and zero recorded errors before and after**. Their complete final judge results match. These results cover the measured one-day sequences only.

All native control responses, initial/final consent-state hashes and normalized run-record hashes match between revisions. Record normalization removes only the run identifier and measured duration. The stored source inputs and collected network, line and cost metrics match at every observation. The cached alert-summary field is excluded because alert state is the intended change. Ops reads leave the measured source rows unchanged; only the isolated fault/recovery steps modify them.

The same `bun run sim --only audit,ops --json <output>` command passes **30/30 blocking gates before and after**. All **31 complete gate records** match after excluding execution and restore duration. The tracked backup record passes: 69 tables, 71 rows and a 274 KiB dump on both sides; restore takes 1981 ms before and 1772 ms after. Runtime: 25.7s before and 24.3s after. Gate definitions, thresholds and simulation parameters are unchanged.

No new full `bun run sim` was run. AGENTS.md permits one full run per agent; this session used that allowance earlier. This revision has fresh affected-block evidence, not a claim that the complete simulation passes here.

## Validation and reproduction

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13754 expect() calls
Ran 690 tests across 69 files. [466.76s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [37.45s]
```

The one optional SDK/browser test remains skipped.

From the repository root, with Bun 1.4.2 and PostgreSQL 16.15:

```text
bun install --frozen-lockfile
bun test --conditions eliza-source deploy/backend/ops-unread.integration.test.ts
bun run typecheck
bun run sim --only audit,ops --json <output>
bun run test:integration
bun run test:e2e
```

Use the isolated development database on port 54339 with `REQUIRE_PG=1`. The integration case must run and report one pass with 13 assertions. The affected simulation blocks must pass all 30 blocking gates.

Save the complete programs below beside two installed checkouts, then run:

```text
bun ops-unread-measure.ts <base-checkout> ops-unread-before.json
bun ops-unread-measure.ts <patched-checkout> ops-unread-after.json
bun ops-unread-compare.ts ops-unread-before.json ops-unread-after.json ops-unread-comparison.json
```

The comparator must exit zero. It requires equal native commands, control responses, state, judge results and source inputs. Every patched observation must match its expected open alerts and HTTP notices. Unknown sources must retain their complete stored alert rows across the outage and restart. Each run creates and drops a disposable test database. Keep every live-send, deploy and live-test flag unset.

## Alternatives and limits

1. Abort the entire alert round when any source fails. This would hide the read-error warning and delay valid recoveries for readable sources.
2. Replay the last alerts as fresh input. That would update their observation times and could repeat stale conditions as current findings.

Keeping the existing rows until a successful read preserves the last known state without inventing new observations. Read-error warnings continue through the existing delivery rules. The fix relies on the documented alert key scopes; future alert families must keep their source association. A complete database outage still prevents alert-store writes, as before. External uptime/heartbeat monitoring remains necessary. No outage-detection or production-load performance claim is made.

## llm_evidence

N/A: deterministic alert-state handling; no model-backed behavior changes. Validation model calls: **0**; cost: **$0**. Native worlds use policy persona agents. The ledger values are explicit synthetic inputs. No real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0, primary runtime 26.1104.2876.0, Windows, Bun 1.4.2 and PostgreSQL 16.15. Authoring provider OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests. This change does not alter an agent-client workflow.

## Complete measurement programs

### ops-unread-measure.ts

```ts
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {SQL} from "bun";
const root=resolve(process.argv[2]!),out=resolve(process.argv[3]!);
const imp=(p:string)=>import(pathToFileURL(join(root,p)).href);
const {GameSource}=await imp("packages/observatory/src/sources/game.ts"),{NetworkService}=await imp("packages/network/service/service.ts");
const {CostLedger,PgCostSink,dayOf}=await imp("packages/network/service/cost.ts");
const {createOps,lineMetrics,opsConfigFromEnv,PgAlertStore,runtimeProbe}=await imp("deploy/backend/ops.ts");
const {testDb,dropTestDb}=await imp("packages/observatory/test/pg.ts"),{rowsFromGame,writeRows}=await imp("packages/observatory/db/writer.ts");
const {computeMetrics}=await imp("packages/sim/src/judge/metrics.ts");
const MIN=60_000,HOUR=60*MIN,DAY=24*HOUR,apps=["ntwrk","slop","peon","friends"];
const hash=(x:any)=>new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const eq=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
let now=0;
const clock={now:()=>now},url=await testDb(),sql=new SQL({url,max:2});
const svc=new NetworkService({url,clock,networks:apps.map(app=>({id:`${app}:nyc`})),env:{PLATFORM_ENV:"dev"},notify:false,log:()=>{}});
const sink=new PgCostSink(sql),cost=new CostLedger({sink,clock}),posts:any[]=[];
const webhook=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){posts.push(await req.json());return new Response("ok");}});
const native:any[]=[],cohorts:any[]=[];
let template:any;
const exercise=async(rows:any,app:string,mask:number,clearNative?:()=>Promise<any>)=>{
  const other=app==="friends"?"ntwrk":"friends",controlKey=`tick_late:${other}:nyc`;
  now=+new Date(rows.network_state[0].saved_at);
  await sql`truncate network.ops_alerts,network.ops_alert_posts,network.cost_ledger,platform.line_safety,platform.outbound cascade`;
  await writeRows(sql,rows,{truncate:true});posts.length=0;
  const original=structuredClone(rows.network_state[0].state);
  const counterpart={...structuredClone(original),opps:[],deferred:[],reports:[],lastTick:now-DAY};
  await sql`insert into network.network_state (id,version,state,saved_at) values (${`${other}:nyc`},1,${counterpart}::jsonb,${new Date(now-DAY)})`;
  await sink.write([{id:"fixture-cost",app,day:dayOf(now),at:now,kind:"other",provider:"synthetic",quantity:1,unitCostUsd:2,costUsd:2,estimated:true,detail:{}}]);
  await sql`insert into platform.line_safety(line,action,event_type,at) values ('+12125550100','review','safety.review',${new Date(now)})`;
  await sql`insert into platform.outbound(id,app_id,line,to_address,kind,body,fingerprint,time_zone,status,next_attempt_at,created_at,updated_at)
    values ('held',${app},'+12125550100','+12125550101','proactive','synthetic text','held','America/New_York','parked_leak_review',${new Date(now)},${new Date(now)},${new Date(now)})`;
  const cfg=opsConfigFromEnv({ALERT_WEBHOOK_URL:webhook.url.href,ALERT_REVIEW_BACKLOG:"1",COST_BUDGET_DAILY_USD:"1",[`COST_BUDGET_DAILY_USD_${app.toUpperCase()}`]:"1"},{env:"dev",build:"measurement",deployed:false});
  const makeOps=()=>createOps({config:cfg,probes:()=>[app,other].map(a=>runtimeProbe(svc.runtimes.get(`${a}:nyc`))),line:()=>lineMetrics(sql),cost,store:new PgAlertStore(sql),now:clock.now,log:{info(){},warn(){},error(){}}});
  let ops=makeOps(),lineUnread=false,costUnread=false;
  const groups:any={1:[`queue_review:${app}:nyc`],2:["line_safety",`leak_review:${app}`],4:["budget:total",`budget:${app}`]};
  const keys=Object.values(groups).flat() as string[],held=Object.entries(groups).filter(([bit])=>mask&+bit).flatMap(([,v])=>v as string[]).sort();
  const readErrors=[...(mask&1?[`ops_read:${app}:nyc`]:[]),...(mask&2?["line_read"]:[]),...(mask&4?["cost_read"]:[])].sort();
  const tracked=new Set([...keys,controlKey,`ops_read:${app}:nyc`,"line_read","cost_read"]),frames:any[]=[];
  const notices=(ks:string[],state:string)=>ks.map(key=>`${key}:${state}`).sort();
  const stored=async()=>((await sql`select * from network.ops_alerts order by key`) as any[]).filter(r=>held.includes(r.key));
  let initialRows:any;
  const inputs=async()=>({
    states:await sql`select id,app_id,state,saved_at from network.network_state order by id`,
    reviews:await sql`select * from network.review_items order by app_id,opportunity_id`,
    line:await sql.unsafe(`select * from platform.${lineUnread?"line_safety_unread":"line_safety"} order by line`),
    outbound:await sql`select id,app_id,status,created_at from platform.outbound order by id`,
    cost:await sql.unsafe(`select * from network.${costUnread?"cost_ledger_unread":"cost_ledger"} order by id`),
  });
  const frame=async(phase:string,expectedOpen:string[],expectedNotices:string[],hold=false)=>{
    const inputHash=hash(await inputs()),beforePosts=posts.length,r=await ops.tick();
    if(!r)throw Error(`Missing round ${phase}`);
    if(hash(await inputs())!==inputHash)throw Error(`Ops mutated source rows ${phase}`);
    const actualOpen=r.open.map((a:any)=>a.key).filter((k:string)=>tracked.has(k)).sort();
    const actualNotices=r.notices.filter((n:any)=>tracked.has(n.key)).map((n:any)=>`${n.key}:${n.state}`).sort();
    if(r.posted&&(!r.ok||posts.length!==beforePosts+1))throw Error("Local webhook delivery failed");
    const delivered=posts.slice(beforePosts).flatMap(p=>p.alerts).filter((n:any)=>tracked.has(n.key)).map((n:any)=>`${n.key}:${n.state}`).sort();
    if(!eq(actualNotices,delivered))throw Error("Webhook differs from dispatch result");
    const {alerts,...metrics}=await ops.metrics();
    const retained=!hold||eq(await stored(),initialRows);
    frames.push({phase,now,actualOpen,expectedOpen:[...expectedOpen].sort(),actualNotices,expectedNotices:[...expectedNotices].sort(),retained,
      inputHash,metricsHash:hash(metrics),exact:eq(actualOpen,[...expectedOpen].sort())&&eq(actualNotices,[...expectedNotices].sort())&&retained});
  };
  const clearQueue=async()=>{
    if(clearNative)await writeRows(sql,await clearNative(),{truncate:true});
    else await sql`update network.network_state set state=jsonb_set(state,'{opps}',${original.opps.filter((o:any)=>o.stage!=="review")}::jsonb) where id=${`${app}:nyc`}`;
  };
  const clearLine=async()=>{await sql`update platform.line_safety set action='none'`;await sql`update platform.outbound set status='dropped'`;};
  const clearCost=async()=>{await sql`update network.cost_ledger set quantity=0,cost_usd=0 where id='fixture-cost'`;};
  await frame("initial",[...keys,controlKey],notices([...keys,controlKey],"firing"));initialRows=await stored();
  // A bad timestamp fails only this app's real report query; the other runtime stays readable.
  if(mask&1)await sql`update network.network_state set state=jsonb_set(state,'{reports}',${[{id:"synthetic-fault",kind:"harassment",at:"unreadable"}]}::jsonb) where id=${`${app}:nyc`}`;
  else await clearQueue();
  if(mask&2){await sql.unsafe("alter table platform.line_safety rename to line_safety_unread");lineUnread=true;}else await clearLine();
  if(mask&4){await sql.unsafe("alter table network.cost_ledger rename to cost_ledger_unread");costUnread=true;}else await clearCost();
  await sql`update network.network_state set state=jsonb_set(state,'{lastTick}',to_jsonb(${now}::float8)),saved_at=${new Date(now)} where id=${`${other}:nyc`}`;
  now+=MIN;
  await frame("outage",[...held,...readErrors],[...notices([...keys.filter(k=>!held.includes(k)),controlKey],"resolved"),...notices(readErrors,"firing")],true);
  ops=makeOps();now+=MIN;await frame("restart",[...held,...readErrors],[],true);
  if(mask&1)await sql`update network.network_state set state=${original}::jsonb where id=${`${app}:nyc`}`;
  if(lineUnread){await sql.unsafe("alter table platform.line_safety_unread rename to line_safety");lineUnread=false;}
  if(costUnread){await sql.unsafe("alter table network.cost_ledger_unread rename to cost_ledger");costUnread=false;}
  now+=MIN;await frame("read-recovered",held,notices(readErrors,"resolved"));
  if(mask&1)await clearQueue();
  if(mask&2)await clearLine();if(mask&4)await clearCost();
  now+=MIN;await frame("conditions-ended",[],notices(held,"resolved"));
  now+=MIN;await frame("quiet",[],[]);
  return frames;
};
try{
  for(const seed of [1,7,13,16])for(const app of ["ntwrk","slop","friends"]){
    const g=new GameSource({app,seed,scenario:"spam_wave",review:"human",pushMs:HOUR,tickMs:HOUR}),commands:any[]=[];
    const control=async(cmd:any)=>{const r=await g.control(cmd,"reviewer@example.test");if(!r.ok)throw Error(JSON.stringify(r));commands.push({cmd,result:r});};
    const records=()=>g.world.records.map((r:any)=>{if(r.type==="run_start"){const{runId,...v}=r;return v;}if(r.type==="run_end"){const{wallMs,...v}=r;return v;}return r;});
    try{
      await g.init();await control({type:"step",ms:DAY});
      const rows=rowsFromGame(g),before={network:hash(g.consent.exportState()),records:hash(records())};template??=structuredClone(rows);
      const frames=await exercise(rows,app,7,async()=>{
        for(const o of g.state().opportunities.filter((o:any)=>o.state==="IN_REVIEW"))await control({type:"review",oppId:o.id,decision:"reject",reason:"weak_reason"});
        return rowsFromGame(g);
      });
      const m=computeMetrics(g.world.records,{requireReview:true});
      native.push({seed,app,commands,before,after:{network:hash(g.consent.exportState()),records:hash(records())},frames,
        judge:{invariants:m.invariants,minorContacts:m.safety.minorContacts,canaryLeaks:m.privacy.canaryLeaks,errors:m.errors}});
      console.log(JSON.stringify({kind:"native",seed,app,frames:frames.length,wrong:frames.filter((f:any)=>!f.exact).length}));
    }finally{await g.dispose();}
  }
  // Supplemental stored-state cohorts, not additional native app worlds. Keep valid native state
  // shapes but change the app scope. Other tables are unnecessary for these read-only health checks.
  for(const app of apps)for(let mask=0;mask<8;mask++){
    const rows=structuredClone(template);for(const k of Object.keys(rows))if(k!=="app"&&k!=="network_state")rows[k]=[];
    rows.app=app;rows.network_state[0].id=`${app}:nyc`;
    const frames=await exercise(rows,app,mask);cohorts.push({app,mask,frames});
  }
  await Bun.write(out,JSON.stringify({native,cohorts},null,2));
  console.log(JSON.stringify({native:native.length,cohorts:cohorts.length,frames:[...native,...cohorts].flatMap(x=>x.frames).length}));
}finally{webhook.stop(true);await svc.close();await sql.close();await dropTestDb();}
```

### ops-unread-compare.ts

```ts
const a=await Bun.file(process.argv[2]!).json(),b=await Bun.file(process.argv[3]!).json();
const eq=(x:any,y:any)=>JSON.stringify(x)===JSON.stringify(y);
if(a.native.length!==12||b.native.length!==12||a.cohorts.length!==32||b.cohorts.length!==32)throw Error("Unexpected matrix size");
const result={nativeWorlds:12,cohorts:32,frames:0,correctBefore:0,correctAfter:0,falseResolutionsBefore:0,falseFiringsBefore:0,missedOpenBefore:0,
  unchanged:0,controlResolutions:0,invariants:{} as Record<string,number>,minorContacts:0,canaryLeaks:0,errors:0,phases:{} as Record<string,any>};
for(const kind of ["native","cohorts"]){
  for(let i=0;i<a[kind].length;i++){
    const x=a[kind][i],y=b[kind][i];
    for(const k of ["seed","app","mask","commands","before","after","judge"])if(!eq(x[k],y[k]))throw Error(`Input or native drift ${kind}/${i}/${k}`);
    if(x.frames.length!==6||y.frames.length!==6)throw Error("Unexpected phase count");
    for(let j=0;j<x.frames.length;j++){
      const p=x.frames[j],q=y.frames[j];
      for(const k of ["phase","now","expectedOpen","expectedNotices","inputHash","metricsHash"])if(!eq(p[k],q[k]))throw Error(`Frame drift ${kind}/${i}/${j}/${k}`);
      result.frames++;result.correctBefore+=+p.exact;result.correctAfter+=+q.exact;
      if(!q.exact)throw Error(`Wrong after ${kind}/${i}/${q.phase}: ${JSON.stringify(q)}`);
      result.falseResolutionsBefore+=p.actualNotices.filter((n:string)=>n.endsWith(":resolved")&&!p.expectedNotices.includes(n)).length;
      result.falseFiringsBefore+=p.actualNotices.filter((n:string)=>n.endsWith(":firing")&&!p.expectedNotices.includes(n)).length;
      result.missedOpenBefore+=p.expectedOpen.filter((k:string)=>!p.actualOpen.includes(k)).length;
      result.unchanged+=+(eq(p.actualOpen,q.actualOpen)&&eq(p.actualNotices,q.actualNotices)&&p.retained===q.retained);
      const control=`tick_late:${x.app==="friends"?"ntwrk":"friends"}:nyc:resolved`;
      if(q.phase==="outage"&&q.actualNotices.includes(control)&&p.actualNotices.includes(control))result.controlResolutions++;
      const phase=result.phases[`${kind}/${q.phase}`]??={n:0,wrongBefore:0,wrongAfter:0};phase.n++;phase.wrongBefore+=+!p.exact;phase.wrongAfter+=+!q.exact;
    }
    if(kind==="native"){
      for(const [k,v] of Object.entries(y.judge.invariants.byRule))result.invariants[k]=(result.invariants[k]??0)+(v as number);
      result.minorContacts+=y.judge.minorContacts;result.canaryLeaks+=y.judge.canaryLeaks;result.errors+=y.judge.errors;
    }
  }
}
await Bun.write(process.argv[4]!,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
```
