# Backend engine precision cohort (2026-11-10)

## Defect and requirement

The backend's seven-day engine precision includes human decisions on member requests and staff-composed proposals. Those decisions do not measure engine quality. Unrelated rejections can trigger a false precision alert. Unrelated approvals can hide an engine precision failure.

This is a reproduced defect under the approved Slop scope and CONTRIBUTING 3.1. PRD 32.8 defines the review precision gate; 34.6 defines shadow mode. `docs/admin-console.md` 3.10 explicitly requires the backend's `precision7d` to use the scorecard's engine-proposal cohort over seven days. `docs/runbook-real.md` 8.4 documents the 80% target and 20-decision minimum. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The SQL counted every approved or rejected human review. It now joins each review to its opportunity within the app and selects `source = 'engine'`. The seven-day cutoff, simulated-reviewer exclusion, edited-approval handling, target and minimum stay unchanged. Legacy engine records with a null review origin remain eligible. The console already uses the opportunity source.

The console can also measure in-memory shadow proposals. PostgreSQL's current opportunity schema has no `shadow` source, and the writer omits those proposals. This change does not add persisted shadow coverage.

## Native regression

One integration case uses the actual `GameSource`, consent Network, engine, review controls, row exporter and a migrated local PostgreSQL database. It reads the production `runtimeProbe` through `collectNetwork` on an actual `NetworkService` runtime. No SQL or service mocks are used.

With seed 1 and the native `spam_wave` scenario, advance one day and reject one generated engine proposal. The metric is one decision and zero clean approvals. Compose a player proposal, advance another day, and approve it. The metric must remain one and zero. Finally, approve another engine proposal: the expected metric is two and one.

The same final case fails before the fix: after the player approval, the backend reports two decisions and one clean approval. Before: **0 pass / 1 fail / 6 assertions**, 6.61 s. After: **1 pass / 0 fail / 8 assertions**, 8.56 s. Case runtimes are 6530.01 ms and 8474.95 ms. The baseline stops at its first failure; these times are not a performance comparison.

## measurement

The complete programs below compare **12 native worlds per revision**: seeds **1, 7, 13 and 16**, across **ntwrk, slop and friends**. Each uses the default synthetic-v1 NYC cohort of 250 members, engine-v1, consent Network, human review, `spam_wave`, and one-hour push/tick settings. The world limit is 60 days; control actions advance only two days. These are shared NYC game app views, not the separate app CLI simulators. Peon's matching lock prevents the same native engine sequence; it is covered only by the database cohorts below.

Each world has eight observations: empty, engine rejection, player approval, engine approval, engine edit, one millisecond before the first decision's seven-day cutoff, exactly at that cutoff, and after all decisions expire. The final three reads change the observation time without advancing or rewriting the world. The service's injected observation clock uses that same time.

There are also **52 supplemental database observations**. Twelve controlled cohorts run for each of four apps, followed by four reads with all app cohorts stored together. These are explicit fixtures copied from native opportunity/review shapes, not additional simulated worlds. They exercise the 20-decision minimum, the 80% target, unrelated approvals/rejections, missing reviewers, automatic reviewers, edited approvals, legacy null origins, the strict cutoff and app isolation. IDs are globally unique as the schema requires.

Expected values are computed independently from the exported review and opportunity rows. Alert expectations apply the documented minimum and target. The actual values use the production SQL, collector and alert evaluator.

| Observed result | Before | After |
| --- | --- | --- |
| Native observations with correct counts and precision alerts | 36/96 | 96/96 |
| Supplemental observations with correct counts and precision alerts | 30/52 | 52/52 |
| False precision alerts | 14 | 0 |
| Missed precision alerts | 4 | 0 |
| Alerts with the wrong precision percentage | 0 | 0 |

All 66 already-correct measured count/alert pairs remain identical.

| Read phase | Reads per revision | Wrong before | Wrong after |
| --- | --- | --- | --- |
| native/empty | 12 | 0 | 0 |
| native/engine-reject | 12 | 0 | 0 |
| native/player-approve | 12 | 12 | 0 |
| native/engine-approve | 12 | 12 | 0 |
| native/engine-edit | 12 | 12 | 0 |
| native/first-decision-before-cutoff | 12 | 12 | 0 |
| native/first-decision-at-cutoff | 12 | 12 | 0 |
| native/all-decisions-expired | 12 | 0 | 0 |
| boundary/below-minimum | 4 | 4 | 0 |
| boundary/at-target | 4 | 4 | 0 |
| boundary/masked-low-precision | 4 | 4 | 0 |
| boundary/all-approved-control | 4 | 0 | 0 |
| boundary/all-rejected-control | 4 | 0 | 0 |
| boundary/non-engine-only | 4 | 4 | 0 |
| boundary/legacy-null-origin | 4 | 0 | 0 |
| boundary/auto-excluded | 4 | 4 | 0 |
| boundary/missing-reviewer-control | 4 | 0 | 0 |
| boundary/edited-approvals-control | 4 | 0 | 0 |
| boundary/cutoff-control | 4 | 0 | 0 |
| boundary/just-in-window-control | 4 | 0 | 0 |
| boundary/app-isolation | 4 | 2 | 0 |

Counts include repeated observations of the same worlds. They are deterministic correctness comparisons, not independent statistical samples or a performance benchmark.

## safety_gates

All 12 native worlds have **zero invariant violations, zero minor contacts, zero canary leaks and zero recorded errors before and after**. The final judge objects match exactly. These results cover the measured two-day sequences only.

For every observation, stored opportunity/review rows and every other collected metric and alert match between revisions. Reads leave those database rows unchanged. All native control responses, full consent-state hashes and normalized record hashes match. Record normalization removes only the run identifier and measured run duration. The matcher, consent system, review controls, live-send settings and safety thresholds are unchanged.

The same `bun run sim --only audit,ops --json <output>` command passes **30/30 blocking gates before and after**. All **31 complete gate records** match after excluding execution and restore duration. The tracked backup record passes: 69 tables, 71 rows and a 274 KiB dump on both sides; restore takes 1607 ms before and 1989 ms after. Runtime: 22.9s before and 25.2s after. Gate definitions, thresholds and simulation parameters are unchanged.

No new full `bun run sim` was run. AGENTS.md limits each agent to one full run; this session used that allowance earlier. This revision has fresh affected-block evidence, not a claim that the complete simulation passes here.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13749 expect() calls
Ran 690 tests across 69 files. [452.68s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [43.43s]
```

The one optional SDK/browser test remains skipped.

Commands, from the repository root with Bun 1.4.2 and PostgreSQL 16.15:

```text
bun install --frozen-lockfile
bun test --conditions eliza-source deploy/backend/ops-precision.integration.test.ts
bun run typecheck
bun run sim --only audit,ops --json <output>
bun run test:integration
bun run test:e2e
```

Use the isolated development database on port 54339, with `REQUIRE_PG=1`. The native regression must run, not skip. It must report one passing case and eight assertions. The affected simulation blocks must pass all 30 blocking gates.

Save the two complete programs below beside the checkouts. Pass each checkout path to the measurement program, then compare its JSON outputs:

```text
bun ops-precision-measure.ts <base-checkout> ops-precision-before.json
bun ops-precision-measure.ts <patched-checkout> ops-precision-after.json
bun ops-precision-compare.ts ops-precision-before.json ops-precision-after.json ops-precision-comparison.json
```

The comparator must exit zero. It checks equal native inputs and control outputs, equal untouched metrics/state, and correct patched values for every observation. These commands create and drop isolated test databases. Keep all live-send, deploy and live-test flags unset. The service runtimes are read directly; the measurement does not start a live backend or notifier.

## Alternatives and limits

1. Filtering only `review_items.origin` avoids the join but drops legacy engine records with null origins. The opportunity source matches the existing scorecard definition.
2. Changing the alert threshold or minimum can suppress one symptom but retains the wrong numerator and denominator. Selecting engine opportunities fixes the cohort at its source.

The join adds a lookup against existing opportunity keys. No migration or index change is needed. This is not a production-volume latency qualification. App-isolation fixtures use valid distinct IDs, not impossible duplicate primary keys. No UI, member-facing copy, authorization, matching or outbound-message behavior changes.

## llm_evidence

N/A: deterministic database metric selection; no model-backed behavior changes. Validation model calls: **0**; cost: **$0**. Native worlds use policy persona agents. No real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0, primary runtime 26.1104.2876.0, Windows, Bun 1.4.2 and PostgreSQL 16.15. Authoring provider: OpenAI; exact model identifier unavailable. GitHub connector and Git/gh were used directly. No computer/browser use. No other agent clients were tested; this change does not alter an agent-client workflow.

## Complete measurement programs

### ops-precision-measure.ts

```ts
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {SQL} from "bun";
const root=resolve(process.argv[2]!),out=resolve(process.argv[3]!);
const imp=(p:string)=>import(pathToFileURL(join(root,p)).href);
const {GameSource}=await imp("packages/observatory/src/sources/game.ts"),{NetworkService}=await imp("packages/network/service/service.ts");
const {SIM_AUTO_REVIEWER}=await imp("packages/network/src/network.ts");
const {runtimeProbe,collectNetwork,evaluate,opsConfigFromEnv}=await imp("deploy/backend/ops.ts");
const {testDb,dropTestDb}=await imp("packages/observatory/test/pg.ts"),{rowsFromGame,writeRows}=await imp("packages/observatory/db/writer.ts");
const {computeMetrics}=await imp("packages/sim/src/judge/metrics.ts");
const DAY=86_400_000,HOUR=3_600_000,apps=["ntwrk","slop","peon","friends"];
const hash=(x:any)=>new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const eq=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
const cfg=opsConfigFromEnv({}, {env:"dev",build:"measurement",deployed:false});
let observedNow=0;
const url=await testDb(),sql=new SQL({url,max:2}),clock={now:()=>observedNow};
const svc=new NetworkService({url,clock,networks:apps.map(app=>({id:`${app}:nyc`})),env:{PLATFORM_ENV:"dev"},notify:false,log:()=>{}});
const native:any[]=[],boundaries:any[]=[];
let template:any,templateNow=0;
const database=async()=>({reviews:await sql`select app_id,opportunity_id,queued_at,deadline,decision,reason,note,reviewer,decided_at,origin,seconds_spent,edits,rerolls,invalidated from network.review_items order by app_id,opportunity_id`,opps:await sql`select row_to_json(o) as row from network.opportunities o order by app_id,id`});
const capture=async(app:string,now:number,phase:string)=>{
  observedNow=now;
  const data=await database(),dbHash=hash(data);
  const eligible=data.reviews.filter((r:any)=>r.app_id===app&&["approve","reject"].includes(r.decision)&&r.reviewer&&r.reviewer!==SIM_AUTO_REVIEWER&&+new Date(r.decided_at)>now-7*DAY&&data.opps.some((o:any)=>o.row.app_id===app&&o.row.id===r.opportunity_id&&o.row.source==="engine"));
  const expected={decided:eligible.length,clean:eligible.filter((r:any)=>r.decision==="approve"&&!(Array.isArray(r.edits)&&r.edits.length)).length};
  const metrics=await collectNetwork(runtimeProbe(svc.runtimes.get(`${app}:nyc`)),now);if(metrics.error)throw Error(metrics.error);
  const actual=metrics.precision7d,alerts=evaluate({networks:[metrics],cost:{budgets:[]}},cfg),precision=alerts.find((a:any)=>a.key===`precision:${app}:nyc`)??null;
  const expectedAlert=expected.decided>=20&&expected.clean/expected.decided<0.8?{level:"warn",count:Math.round(100*expected.clean/expected.decided)}:null;
  const actualAlert=precision?{level:precision.level,count:precision.count}:null;
  const {precision7d,...otherMetrics}=metrics;
  if(hash(await database())!==dbHash)throw Error("Read mutated stored rows");
  return {app,phase,now,actual,expected,actualAlert,expectedAlert,exact:eq(actual,expected)&&eq(actualAlert,expectedAlert),dbHash,otherHash:hash({metrics:otherMetrics,alerts:alerts.filter((a:any)=>a.key!==`precision:${app}:nyc`)})};
};
try {
  for(const seed of [1,7,13,16])for(const app of ["ntwrk","slop","friends"]){
    const g=new GameSource({app,seed,scenario:"spam_wave",review:"human",pushMs:HOUR,tickMs:HOUR});
    const frames:any[]=[],commands:any[]=[];
    const ctl=async(cmd:any)=>{const r=await g.control(cmd,"reviewer@example.test");if(!r.ok)throw Error(JSON.stringify({seed,app,cmd,r}));commands.push({cmd,result:r});return r;};
    const recordHash=()=>hash(g.world.records.map((r:any)=>{if(r.type==="run_start"){const{runId,...v}=r;return v;}if(r.type==="run_end"){const{wallMs,...v}=r;return v;}return r;}));
    const read=async(phase:string,at?:number)=>{
      if(at===undefined)await writeRows(sql,rowsFromGame(g),{truncate:true});
      const networkHash=hash(g.consent.exportState()),recordsHash=recordHash();
      frames.push({...await capture(app,at??g.state().clock.now,phase),networkHash,recordsHash});
      if(hash(g.consent.exportState())!==networkHash||recordHash()!==recordsHash)throw Error("Observation mutated the world");
    };
    try {
      await g.init();await read("empty");await ctl({type:"step",ms:DAY});
      const e=g.state().opportunities.find((o:any)=>o.source==="engine"&&o.state==="IN_REVIEW");if(!e)throw Error("No engine review");
      await ctl({type:"review",oppId:e.id,decision:"reject",reason:"weak_reason",note:"Synthetic review of the generated proposal"});
      const firstAt=g.state().clock.now;await read("engine-reject");
      const ids=g.state().members.filter((m:any)=>m.joined&&!m.minor&&!m.declined&&m.state!=="opted_out").slice(-2).map((m:any)=>m.id);
      const p=await ctl({type:"propose",participants:ids});await ctl({type:"step",ms:DAY});
      await ctl({type:"review",oppId:p.data.id,decision:"approve",secondsSpent:15});await read("player-approve");
      for(const decision of ["approve","edit"]){
        const q=g.state().opportunities.find((o:any)=>o.source==="engine"&&o.state==="IN_REVIEW");if(!q)throw Error("No next engine review");
        await ctl({type:"review",oppId:q.id,decision,secondsSpent:15,...(decision==="edit"?{objective:"A synthetic reviewer clarified this meetup"}:{})});
        await read(`engine-${decision}`);
      }
      const now=g.state().clock.now;
      await read("first-decision-before-cutoff",firstAt+7*DAY-1);
      await read("first-decision-at-cutoff",firstAt+7*DAY);
      await read("all-decisions-expired",now+7*DAY);
      const m=computeMetrics(g.world.records,{requireReview:true});
      native.push({seed,app,commands,frames,judge:{invariants:m.invariants,canaryLeaks:m.privacy.canaryLeaks,minorContacts:m.safety.minorContacts,errors:m.errors}});
      template??=structuredClone(rowsFromGame(g));templateNow ||= now;
      console.log(JSON.stringify({seed,app,frames:frames.length,wrong:frames.filter(f=>!f.exact).length}));
    }finally{await g.dispose();}
  }
  // Supplemental PostgreSQL cohorts use copies of native records to exercise the 20-decision
  // and 80% boundaries, app joins, legacy null origins and existing exclusions. They are fixtures,
  // not additional simulated worlds, and never alter matcher thresholds or recorded native runs.
  const er=template.review_items.find((r:any)=>r.origin==="engine"&&r.decision==="approve"&&!r.edits?.length);
  const eo=template.opportunities.find((o:any)=>o.id===er.opportunity_id);
  const fixture=(app:string,specs:any[])=>{
    const r=structuredClone(template);r.app=app;
    for(const k of Object.keys(r))if(k!=="app")r[k]=[];
    for(const [i,s] of specs.entries()){
      const id=`${app}:fixture-${i}`;
      r.opportunities.push({...structuredClone(eo),id,source:s.source??"engine",run_id:null});
      r.review_items.push({...structuredClone(er),opportunity_id:id,origin:s.origin===undefined?(s.source??"engine"):s.origin,decision:s.decision??"approve",reviewer:s.reviewer===undefined?"reviewer@example.test":s.reviewer,decided_at:new Date(s.at??templateNow),edits:s.edited?["objective"]:null});
    }return r;
  };
  const cohort=(n:number,clean:number,extra:any={})=>Array.from({length:n},(_,i)=>({...extra,decision:i<clean?"approve":"reject"}));
  const cases:any[]=[
    ["below-minimum",[...cohort(19,19),...cohort(10,0,{source:"player"})]],
    ["at-target",[...cohort(20,16),...cohort(5,0,{source:"member"})]],
    ["masked-low-precision",[...cohort(20,15),...cohort(20,20,{source:"player"})]],
    ["all-approved-control",cohort(20,20)],
    ["all-rejected-control",cohort(20,0)],
    ["non-engine-only",cohort(20,20,{source:"network"})],
    ["legacy-null-origin",cohort(20,15,{origin:null})],
    ["auto-excluded",[...cohort(20,20,{reviewer:SIM_AUTO_REVIEWER}),...cohort(20,0,{source:"scenario"})]],
    ["missing-reviewer-control",cohort(20,20,{reviewer:null})],
    ["edited-approvals-control",cohort(20,20,{edited:true})],
    ["cutoff-control",cohort(20,15,{at:templateNow-7*DAY})],
    ["just-in-window-control",cohort(20,15,{at:templateNow-7*DAY+1})],
  ];
  for(const [phase,specs] of cases)for(const app of apps){
    await writeRows(sql,fixture(app,specs),{truncate:true});boundaries.push(await capture(app,templateNow,phase));
  }
  // Four app cohorts coexist with globally unique opportunity ids, as the schema requires.
  for(let i=0;i<apps.length;i++)await writeRows(sql,fixture(apps[i]!,cohort(20,i*5,{source:i%2?"player":"engine"})),{truncate:i===0});
  for(const app of apps)boundaries.push(await capture(app,templateNow,"app-isolation"));
  await Bun.write(out,JSON.stringify({native,boundaries},null,2));
  console.log(JSON.stringify({nativeWorlds:native.length,nativeFrames:native.flatMap(x=>x.frames).length,boundaries:boundaries.length}));
}finally{await svc.close();await sql.close();await dropTestDb();}
```

### ops-precision-compare.ts

```ts
const before=await Bun.file(process.argv[2]!).json(),after=await Bun.file(process.argv[3]!).json();
const eq=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
if(before.native.length!==12||after.native.length!==12||before.boundaries.length!==52||after.boundaries.length!==52)throw Error("Unexpected matrix size");
const result={nativeWorlds:12,nativeFrames:0,nativeCorrectBefore:0,nativeCorrectAfter:0,boundaryFrames:0,boundaryCorrectBefore:0,boundaryCorrectAfter:0,unchanged:0,falseAlertsBefore:0,missedAlertsBefore:0,wrongAlertCountsBefore:0,invariants:{} as Record<string,number>,minorContacts:0,canaryLeaks:0,errors:0,phases:{} as Record<string,any>};
const frame=(a:any,b:any,kind:"native"|"boundary")=>{
  for(const k of ["app","phase","now","expected","expectedAlert","dbHash","otherHash","networkHash","recordsHash"])if(!eq(a[k],b[k]))throw Error(`Drift ${kind}/${a.app}/${a.phase}/${k}`);
  result[kind==="native"?"nativeFrames":"boundaryFrames"]++;
  result[kind==="native"?"nativeCorrectBefore":"boundaryCorrectBefore"]+=+a.exact;
  result[kind==="native"?"nativeCorrectAfter":"boundaryCorrectAfter"]+=+b.exact;
  if(!b.exact)throw Error(`Wrong after ${kind}/${a.app}/${a.phase}`);
  result.unchanged+=+(eq(a.actual,b.actual)&&eq(a.actualAlert,b.actualAlert));
  result.falseAlertsBefore+=+!!(a.actualAlert&&!a.expectedAlert);
  result.missedAlertsBefore+=+!!(!a.actualAlert&&a.expectedAlert);
  result.wrongAlertCountsBefore+=+!!(a.actualAlert&&a.expectedAlert&&!eq(a.actualAlert,a.expectedAlert));
  const p=result.phases[`${kind}/${a.phase}`]??={n:0,wrongBefore:0,wrongAfter:0};p.n++;p.wrongBefore+=+!a.exact;p.wrongAfter+=+!b.exact;
};
for(let i=0;i<before.native.length;i++){
  const a=before.native[i],b=after.native[i];
  for(const k of ["seed","app","commands","judge"])if(!eq(a[k],b[k]))throw Error(`World drift ${i}/${k}`);
  if(a.frames.length!==8||b.frames.length!==8)throw Error("Unexpected native frames");
  for(let j=0;j<a.frames.length;j++)frame(a.frames[j],b.frames[j],"native");
  for(const [k,v]of Object.entries(b.judge.invariants.byRule))result.invariants[k]=(result.invariants[k]??0)+(v as number);
  result.minorContacts+=b.judge.minorContacts;result.canaryLeaks+=b.judge.canaryLeaks;result.errors+=b.judge.errors;
}
for(let i=0;i<before.boundaries.length;i++)frame(before.boundaries[i],after.boundaries[i],"boundary");
await Bun.write(process.argv[4]!,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
```
