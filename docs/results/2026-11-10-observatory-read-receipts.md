# Preserve delivered-message metrics after read receipts

Date: 2026-11-10. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Problem and requirement

The production queue advances an outbound message from `delivered` to `read` and the runtime stores that status in `network.messages`. The Observatory requires an exact `delivered` status in its proactive-message counters and scorecard calculations. Reading a message therefore removes a delivery from those metrics. The message still exists and was still delivered.

This is a reproduced defect within the approved contribution scope and CONTRIBUTING 3.1. PRD 28.2 and 35.2 require the scorecard; 35.3 and `docs/observatory.md` require consistent game/database data. `docs/admin-console.md` 3.10 describes the current worthwhile-interruption proxy: a proactive message answered within 72 hours without STOP. A read receipt changes neither the original interruption nor the reply history.

Include `read` with `delivered` in the shared scorecard predicate and both SQL proactive counts: the global total and the per-member total. The shared predicate covers the worthwhile-interruption denominator/numerator and attention burden. The simulator's channel has no `read` delivery status, so its projector needs no change. No UI, provider, queue, receipt, matching or consent behavior changes.

Alternatives considered:

1. Keep the database status at delivered. That would discard useful read progress from the production receipt path.
2. Count every attempted or accepted status. Sent/accepted messages do not prove delivery; that would change the metric's existing meaning.
3. Read provider timestamps in the Observatory. The existing read status already proves delivery, so another table join is unnecessary.

## Regression

The new `packages/observatory/test/read-receipts.integration.test.ts` creates a native default NYC world with seed 1 and five days of automatic simulated review. It persists the snapshot in real PostgreSQL and opens the actual authenticated Observatory HTTP reader. A controlled queue receipt fixture names one native delivered proactive message. `BlooioAdapter.status` processes a `read` update, and `NetworkRuntime.storeStatuses` projects it into the actual message row. No provider send occurs.

On base, this one receipt changes the global proactive count **151 → 150**, its member's count **2 → 1**, the worthwhile-proxy sample **123 → 122**, and attention burden **0.846 → 0.841**. After the fix all four remain unchanged. Total messages and outbound messages also remain unchanged. A later stale `delivered` update is rejected by the existing queue, leaving the read status intact.

| Same test command | Base | Fix |
| --- | --- | --- |
| `bun test --conditions eliza-source packages/observatory/test/read-receipts.integration.test.ts` | 0 pass, 1 fail; 9 assertions | 1 pass, 0 fail; 12 assertions |
| Case duration | 8564.05 ms | 8182.12 ms |
| Suite duration | 8.66 s | 8.27 s |

These include local setup and are not performance measurements. The native simulation, queue status handler, runtime projection, database reader and HTTP route are real. The persisted provider receipt is an explicit synthetic fixture; no live carrier or production deployment is qualified.

## measurement

| Observation | Before | After |
| --- | --- | --- |
| Correct proactive counts and affected scorecard entries | 72/168 | 168/168 |
| Incorrect global proactive count | 96 | 0 |
| Incorrect member proactive counts | 96 | 0 |
| Incorrect affected scorecard entries | 96 | 0 |

All 72 already-correct observations remain correct and identical. Counts overlap. The twelve native snapshots contain 1,785 delivered proactive message rows across the app views.

The unchanged programs below run against both checkouts. Twelve native worlds use seeds 1, 7, 13 and 16 × ntwrk/slop/friends views; the default NYC dataset, engine-v1, automatic simulated reviewer, policy persona agents and 60-day horizon. Each advances five days. The one-hour wall-clock UI timers do not alter simulation scheduling. These app views use the shared NYC game, not the separate per-app CLI matching simulators.

Each native snapshot is written to PostgreSQL. Six HTTP observations follow: delivered baseline; one proactive message read; half read; all read; a repeated refresh without new receipts; and restoration of the original delivered statuses as a control. The native world's state and records are unchanged. SQL status transitions are controlled receipt-projection fixtures; the integration case above proves the actual queue/runtime transition. The target oracle is the delivered baseline: read confirmation must preserve the global and every member's proactive counts and both complete affected scorecard entries. Baseline counts are checked against the original native messages.

Twenty-four additional cohorts cover all four app readers, including Peon: answered, unanswered after 72 hours, unanswered within the open window, STOP after the message, answer just outside 72 hours, and answer exactly at 72 hours. Each stores one delivered proactive message alongside sent, accepted, queued, unknown-acceptance, failed, dry-run and refused controls. It also stores read-status inbound, non-proactive outbound and system controls. Only the delivered proactive message should count. The worthwhile oracle is explicitly 1 for an answer in the window, 0 for a mature unanswered/stopped/late-answer message, and null with sample 0 while still awaiting an answer. Each cohort has baseline/read/repeated-read/restored-delivered phases.

These are real PostgreSQL reads through the authenticated HTTP state and refresh routes. Expected values and source hashes match between revisions. The reader leaves measured state, messages, opportunities, participations and events unchanged. Every member field except proactive count, all other stats and all other scorecard entries remain identical between revisions. The complete target entries include labels, units, sample sizes, targets and target-result flags. Native state, normalized records, control results and complete invariant objects match; only run IDs and run-end wall duration are removed from record hashes. Row-to-JSON reads avoid text/binary float differences without rounding source values.

| Phase | Reads per revision | Wrong before | Wrong after |
| --- | --- | --- | --- |
| native/delivered-baseline | 12 | 0 | 0 |
| native/one-read | 12 | 12 | 0 |
| native/half-read | 12 | 12 | 0 |
| native/all-read | 12 | 12 | 0 |
| native/repeat-read-refresh | 12 | 12 | 0 |
| native/delivered-control-restored | 12 | 0 | 0 |
| cohorts/delivered-baseline | 24 | 0 | 0 |
| cohorts/read-receipt | 24 | 24 | 0 |
| cohorts/repeat-read-refresh | 24 | 24 | 0 |
| cohorts/delivered-control-restored | 24 | 0 | 0 |

This is a deterministic invariance check on the listed receipts and histories. It is not survey evidence, a matching-quality estimate, a real-provider delivery benchmark or a statistical claim about population effects. The existing 72-hour proxy and its thresholds are unchanged. The separate repeated-STOP-history correction in PR #408 is not included here.

## safety_gates

Native judge findings remain identical before and after: seed 13 has one existing `decliner_exposed` finding in each of its three app views (three observations of the shared world finding). The other nine worlds have none. All twelve retain zero minor contacts, zero canary leaks and zero recorded errors. Complete invariant objects, including their examples, match. These are five-day native results, not a claim that every native judge count is zero.

The same `bun run sim --only audit,ops --json <output>` command passes **30/30 blocking gates before and after**. All **31 complete gate records** match after excluding execution and restore duration. The tracked backup drill passes: 69 tables, 71 rows, 274 KiB on both sides; restore 2723 ms before and 2387 ms after. Runtime: 27.4s before and 26.1s after. Gate definitions, fixtures, expected values and thresholds are unchanged.

No new full simulation: AGENTS.md permits one full `bun run sim` per agent, already used earlier in this session. These are fresh affected audit/ops checks. No safety policy is changed.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13753 expect() calls
Ran 690 tests across 69 files. [462.36s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [44.59s]
```

The optional SDK/browser case remains skipped.

## llm_evidence

N/A: deterministic counters and receipt classification. Model calls: 0; validation provider cost: $0. Native worlds use policy persona agents. No real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0 / primary runtime 26.1104.2876.0, Windows, Bun 1.4.2, PostgreSQL 16.15. Authoring provider OpenAI; exact model identifier unavailable. GitHub connector and Git/gh directly, with no computer/browser use. No agent-client workflow changes or other client acceptance tests.

## Limits

Read confirmations preserve delivered-message counts. A read receipt by itself is not treated as a worthwhile reply; the existing inbound-message and STOP rules still decide that proxy. Sent, accepted, queued, failed, dry-run and refused messages remain outside the delivered count. Existing timestamp, retention, reply attribution and message-deletion behavior is unchanged. There is no schema migration or rewrite of stored statuses.

## Reproduce

Save the programs outside the checkouts. Use frozen dependencies, Bun 1.4.2, local PostgreSQL 16 on port 54339, `USER=postgres`, `REQUIRE_PG=1`, and PostgreSQL binaries/Git's bash on PATH. Keep model-provider keys, live-send and deployment flags unset. Each run owns a process-specific test database. The paired reader clock is fixed with `Date.now` and restored afterward; original source clocks and records remain unchanged. Local synthetic HTTP audit logs go under `obs-read-local-<pid>` next to the programs.

```text
bun run --conditions eliza-source obs-read-measure.ts <base-checkout> before.json
bun run --conditions eliza-source obs-read-measure.ts <candidate-checkout> after.json
bun obs-read-compare.ts before.json after.json comparison.json
bun run typecheck
bun run sim --only audit,ops --json gates.json
bun run test:integration
bun run test:e2e
```

The comparator rejects incorrect candidate metrics, changes to unrelated metrics/source rows or drift in native inputs and judged results. Full integration has the host limits above.

### obs-read-measure.ts

```ts
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {SQL} from "bun";
const root=resolve(process.argv[2]!),out=resolve(process.argv[3]!),imp=(p:string)=>import(pathToFileURL(join(root,p)).href);
const {GameSource}=await imp("packages/observatory/src/sources/game.ts"),{createServer}=await imp("packages/observatory/src/server.ts");
const {FileAudit}=await imp("packages/observatory/src/staff.ts"),{testDb,dropTestDb}=await imp("packages/observatory/test/pg.ts");
const {rowsFromGame,writeRows}=await imp("packages/observatory/db/writer.ts"),{computeMetrics}=await imp("packages/sim/src/judge/metrics.ts");
const MIN=60000,HOUR=60*MIN,DAY=24*HOUR,apps=["ntwrk","slop","peon","friends"],targetKeys=["worthwhile_interruption","attention_burden"];
const hash=(x:any)=>new Bun.CryptoHasher("sha256").update(JSON.stringify(x,(_k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest("hex");
const eq=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b),savedNow=Date.now;
let now=0,template:any;Date.now=()=>now;
const url=await testDb(),sql=new SQL({url,max:2}),native:any[]=[],cohorts:any[]=[];
const source=async()=>({state:await sql`select id,state,saved_at from network.network_state order by id`,
  messages:await sql`select row_to_json(m) as row from network.messages m order by id`,opps:await sql`select row_to_json(o) as row from network.opportunities o order by id`,
  parts:await sql`select row_to_json(p) as row from network.participations p order by opportunity_id,member_id`,events:await sql`select row_to_json(e) as row from network.events e order by id`});
const setup=async(rows:any,app:string)=>{
  now=+new Date(rows.network_state[0].saved_at);await writeRows(sql,rows,{truncate:true});
  const token="synthetic-obs-read-measure-token".padEnd(40,"x"),headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
  const dir=resolve(import.meta.dir,`obs-read-local-${process.pid}`);
  const server=await createServer({port:0,mode:"real",development:false,token,platformEnv:"dev",staffRolesUrl:false,peopleUrl:false,
    audit:new FileAudit(join(dir,"audit")),lab:{dir:join(dir,"lab")},real:{url,service:false,pollMs:HOUR,pushMs:HOUR}});
  const frames:any[]=[];
  const read=async(phase:string,expected?:any)=>{
    const before=hash(await source());
    const refreshed=await fetch(`${server.url}/api/control?mode=real&app=${app}`,{method:"POST",headers,body:JSON.stringify({type:"refresh"})});
    if(refreshed.status!==200||!(await refreshed.json()).ok)throw Error("Refresh failed");
    const res=await fetch(`${server.url}/api/state?mode=real&app=${app}`,{headers});if(res.status!==200)throw Error(`HTTP ${res.status}`);
    const s=await res.json();if(s.env.error)throw Error(s.env.error);if(hash(await source())!==before)throw Error("Reader changed source data");
    const actual={proactive:s.stats.proactive,members:s.members.map((m:any)=>[m.id,m.counters.proactive]).sort(([a]:any,[b]:any)=>a.localeCompare(b)),
      scorecard:s.stats.scorecard.filter((m:any)=>targetKeys.includes(m.key))};
    const {proactive,scorecard,...stats}=s.stats;
    const members=s.members.map((m:any)=>{const{proactive,...counters}=m.counters;return {...m,counters};}).sort((a:any,b:any)=>a.id.localeCompare(b.id));
    frames.push({phase,expected:expected??actual,actual,exact:eq(expected??actual,actual),sourceHash:before,
      otherHash:hash({stats,scorecard:scorecard.filter((m:any)=>!targetKeys.includes(m.key)),members})});
    return actual;
  };
  return {read,frames,close:()=>server.stop()};
};
try{
  for(const seed of [1,7,13,16])for(const app of ["ntwrk","slop","friends"]){
    const g=new GameSource({app,seed,pushMs:HOUR,tickMs:HOUR});let run:any;
    try{
      await g.init();const step=await g.control({type:"step",ms:5*DAY},"reviewer@example.test");if(!step.ok)throw Error(step.error);
      const records=()=>g.world.records.map((r:any)=>{if(r.type==="run_start"){const{runId,...v}=r;return v;}if(r.type==="run_end"){const{wallMs,...v}=r;return v;}return r;});
      const before={network:hash(g.consent.exportState()),records:hash(records())},rows=rowsFromGame(g);template??=structuredClone(rows);
      const ids=rows.messages.filter((m:any)=>m.direction==="outbound"&&m.proactive&&!m.system&&m.status==="delivered").map((m:any)=>m.id);
      if(ids.length<2)throw Error("Native world needs multiple delivered proactive messages");
      run=await setup(rows,app);const expected=await run.read("delivered-baseline");
      if(expected.proactive!==ids.length)throw Error("Native baseline differs from source rows");
      for(const [phase,n] of [["one-read",1],["half-read",Math.ceil(ids.length/2)],["all-read",ids.length]] as const){
        await sql`update network.messages set status='read' where app_id=${app} and id=any(${sql.array(ids.slice(0,n),"TEXT")})`;
        await run.read(phase,expected);
      }
      await run.read("repeat-read-refresh",expected);
      await sql`update network.messages set status='delivered' where app_id=${app} and id=any(${sql.array(ids,"TEXT")})`;
      await run.read("delivered-control-restored",expected);
      const m=computeMetrics(g.world.records,{requireReview:true});
      native.push({seed,app,step,n:ids.length,before,after:{network:hash(g.consent.exportState()),records:hash(records())},frames:run.frames,
        judge:{invariants:m.invariants,minorContacts:m.safety.minorContacts,canaryLeaks:m.privacy.canaryLeaks,errors:m.errors}});
      console.log(JSON.stringify({kind:"native",seed,app,n:ids.length,wrong:run.frames.filter((f:any)=>!f.exact).length}));
    }finally{await run?.close();await g.dispose();}
  }
  for(const app of apps)for(const scenario of ["answered","unanswered-mature","unanswered-open","stopped","outside-window","exact-window"]){
    const rows=structuredClone(template);rows.app=app;rows.network_state[0].id=`${app}:nyc`;rows.messages=[];
    rows.events=rows.events.filter((e:any)=>e.type!=="member_opted_out");
    const member=rows.members.find((m:any)=>m.account_status==="active"&&m.age>=18).id;
    const at=+new Date(rows.network_state[0].saved_at),ts=scenario==="unanswered-open"?at-HOUR:at-4*DAY;
    const run=await setup(rows,app);
    try{
      const statuses=["delivered","sent","accepted","queued","unknown_acceptance","failed","dry_run","refused_opted_out"];
      for(const [i,status] of statuses.entries())await sql`insert into network.messages (id,app_id,member_id,direction,body,status,proactive,system,ts)
        values (${'receipt-'+i},${app},${member},'outbound','Synthetic outcome',${status},true,false,${new Date(ts)})`;
      // Read controls that must not increase proactive counts.
      await sql`insert into network.messages (id,app_id,member_id,direction,body,status,proactive,system,ts) values
        ('read-inbound',${app},${member},'inbound','Synthetic earlier input','read',false,false,${new Date(ts-MIN)}),
        ('read-reply',${app},${member},'outbound','Synthetic reply','read',false,false,${new Date(ts)}),
        ('read-system',${app},${member},'outbound','Synthetic system receipt','read',true,true,${new Date(ts)})`;
      const answered=["answered","stopped","outside-window","exact-window"].includes(scenario);
      if(answered){const delay=scenario==="outside-window"?72*HOUR+1:scenario==="exact-window"?72*HOUR:MIN;
        await sql`insert into network.messages (id,app_id,member_id,direction,body,status,proactive,system,ts)
          values ('answer',${app},${member},'inbound','Synthetic response','delivered',false,false,${new Date(ts+delay)})`;}
      if(scenario==="stopped")await sql`insert into network.events (app_id,at,actor_type,actor_id,type,object_type,object_id,payload)
        values (${app},${new Date(ts+2*MIN)},'member',${member},'member_opted_out','member',${member},'{}'::jsonb)`;
      const expected=await run.read("delivered-baseline"),wi=expected.scorecard.find((m:any)=>m.key==="worthwhile_interruption");
      if(expected.proactive!==1||expected.members.find(([id]:any)=>id===member)[1]!==1||wi.n!==(scenario==="unanswered-open"?0:1)||wi.value!==(scenario==="unanswered-open"?null:["answered","exact-window"].includes(scenario)?1:0))throw Error("Controlled baseline oracle mismatch");
      await sql`update network.messages set status='read' where app_id=${app} and id='receipt-0'`;await run.read("read-receipt",expected);
      await run.read("repeat-read-refresh",expected);
      await sql`update network.messages set status='delivered' where app_id=${app} and id='receipt-0'`;await run.read("delivered-control-restored",expected);
      cohorts.push({app,scenario,frames:run.frames});
      console.log(JSON.stringify({kind:"cohort",app,scenario,wrong:run.frames.filter((f:any)=>!f.exact).length}));
    }finally{await run.close();}
  }
  await Bun.write(out,JSON.stringify({native,cohorts},null,2));
}finally{Date.now=savedNow;await sql.close();await dropTestDb();}
```

### obs-read-compare.ts

```ts
const a=await Bun.file(process.argv[2]!).json(),b=await Bun.file(process.argv[3]!).json(),eq=(x:any,y:any)=>JSON.stringify(x)===JSON.stringify(y);
if(a.native.length!==12||b.native.length!==12||a.cohorts.length!==24||b.cohorts.length!==24)throw Error("Matrix size changed");
const result={worlds:12,cohorts:24,frames:0,correctBefore:0,correctAfter:0,unchanged:0,wrongProactiveBefore:0,wrongMembersBefore:0,wrongScoresBefore:0,
  nativeProactive:0,invariants:0,minorContacts:0,canaryLeaks:0,errors:0,phases:{} as Record<string,any>};
for(const kind of ["native","cohorts"])for(let i=0;i<a[kind].length;i++){
  const x=a[kind][i],y=b[kind][i];
  for(const k of ["seed","app","scenario","step","n","before","after","judge"])if(!eq(x[k],y[k]))throw Error(`Input drift ${kind}/${i}/${k}`);
  if(kind==="native"&&!eq(y.before,y.after))throw Error("Native world changed");
  if(x.frames.length!==(kind==="native"?6:4)||x.frames.length!==y.frames.length)throw Error("Phase count changed");
  for(let j=0;j<x.frames.length;j++){
    const p=x.frames[j],q=y.frames[j];
    for(const k of ["phase","expected","sourceHash","otherHash"])if(!eq(p[k],q[k]))throw Error(`Unexpected drift ${kind}/${i}/${j}/${k}`);
    if(!q.exact)throw Error(`Incorrect after ${kind}/${i}/${q.phase}`);
    result.frames++;result.correctBefore+=+p.exact;result.correctAfter+=+q.exact;result.unchanged+=+eq(p.actual,q.actual);
    result.wrongProactiveBefore+=+(p.actual.proactive!==p.expected.proactive);result.wrongMembersBefore+=+!eq(p.actual.members,p.expected.members);result.wrongScoresBefore+=+!eq(p.actual.scorecard,p.expected.scorecard);
    const phase=result.phases[`${kind}/${q.phase}`]??={n:0,wrongBefore:0,wrongAfter:0};phase.n++;phase.wrongBefore+=+!p.exact;phase.wrongAfter+=+!q.exact;
  }
  if(kind==="native"){result.nativeProactive+=y.n;result.invariants+=y.judge.invariants.total;result.minorContacts+=y.judge.minorContacts;result.canaryLeaks+=y.judge.canaryLeaks;result.errors+=y.judge.errors;}
}
if(result.frames!==168)throw Error("Wrong observation count");
await Bun.write(process.argv[4]!,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
```
