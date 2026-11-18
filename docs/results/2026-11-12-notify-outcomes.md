# Notification outcome writes survive database failures

Date: 2026-11-12. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Requirement and cause

This is a reproduced backend defect under the approved Slop scope and CONTRIBUTING 3.1.
The notification design in `docs/research/2026-10-08-entry-flows.md`, sections 4 and 5, uses acted and ignored outcomes to score surfaces.
`packages/notify/README.md` describes the service's persisted outcome sweep.

The scheduler first closed a delivery, then wrote its surface counter separately.
A failure of the second write left the delivery closed without its counter.
Later replies and sweeps skipped the closed delivery, even after a service restart.
For a sweep, one failure could lose every remaining counter in the batch.

Each PostgreSQL transition now writes its counter in the same SQL statement.
The statement contains a data-changing common table expression, which supplies only newly closed deliveries to the counter write.
Failed counter writes roll back the transition.
Ignored deliveries are grouped by person and target, so several deliveries increment one counter by their total.
The memory store follows the same contract; the scheduler no longer writes counters a second time.

The reply path still credits the replying surface. Expiry still credits the delivery's target.
No schema migration, dependency, send, selection threshold, notification text or expiry boundary changes.

## measurement

The same program ran on base and candidate with seed 1, a simulated clock, and real PostgreSQL and loopback HTTP.
It uses nine fictional adults across three cohorts. Matching is disabled.
Each adult joins Friends through signed HTTP and receives three requested notifications through the real scheduler and dry-run Network adapter.
The inputs are controlled producer fixtures, not naturally generated matching opportunities or real carrier deliveries.

One member per cohort replies with HELP; the other two let their notifications expire.
Each cohort has nine notifications. Each restarts the service before retrying the reply and the sweep.
The retry includes overlapping sweeps and repeated calls.

Database triggers raise a real PostgreSQL exception during a counter update.
The controlled fault positions are the first and second counter update, plus a no-fault control.
Both faulted runs prove an error occurred; no SQL function or service method is mocked.

| Counter totals after restart and retry | Base | Candidate | Expected |
| --- | ---: | ---: | ---: |
| No fault: acted / ignored | 3 / 6 | 3 / 6 | 3 / 6 |
| First counter update fails: acted / ignored | 2 / 0 | 3 / 6 | 3 / 6 |
| Second counter update fails: acted / ignored | 2 / 1 | 3 / 6 | 3 / 6 |
| Recorded outcomes across all 27 deliveries | 14 | 27 | 27 |
| Missing outcomes after recovery | 13 | 0 | 0 |

Repeated calls leave all totals unchanged. No additional notification is sent.
All six complete no-fault snapshots match.
Inbox items and notification messages match across all 18 paired snapshots, including bodies, statuses and timestamps.
Every delivery field outside its outcome and outcome time also matches.
Comparison replaces fresh person/member UUIDs and their derived delivery IDs, then sorts rows by their normalized values.
It removes no business fields or timestamps.

One new integration case fails on base at the first recovery assertion: two pending deliveries instead of three.
It passes on candidate, including ignored outcomes, restart, overlapping sweeps and replay checks.
The baseline case stops at that first failure; the separate paired program exercises every phase on both revisions.

```text
Base:      0 pass / 1 fail / 19 expect() calls / 3.19s
Candidate: 1 pass / 0 fail / 30 expect() calls / 3.88s
```

The initial exploratory program used an open conversation turn, which does not enter the existing handled-reply outcome hook.
The final paired program uses HELP and faults only counter updates, not the preceding insert attempt of an upsert.
There was one implementation candidate. No scoring parameter or corpus was tuned.
These are deterministic fault reproductions; they do not estimate production failure frequency or a statistical effect.

## safety_gates

The same `bun run sim --only network,safety,audit --json <output>` command passes **94/94 blocking gates** before and after.
All **96 complete gate records** match after removing only execution duration.
Every tracked record also passes. Runtime: 228.2s before and 230.4s after.
Gate definitions, seeds, thresholds and simulation parameters are unchanged.

The workflow fixture uses adults, disables matching and uses dry-run sends.
It does not claim a new matching-quality or production safety benchmark.

All four TypeScript configurations pass.
Integration, including the security suite:

```text

 676 pass
 8 skip
 6 fail
 13771 expect() calls
Ran 690 tests across 69 files. [436.63s]
error: script "test:integration" exited with code 1
```

The six failure names and causes match the clean-base Windows reproduction.
They are missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions.
Integration is not green. The eight optional skips remain.

E2E:

```text
(skip) failed security checks give recovery feedback and a later SDK success clears only that feedback

 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [33.60s]
```

The one optional SDK/browser test remains skipped.
No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was used earlier in this session.
This candidate has fresh affected-block validation. Hosted CI is reported in the PR body.


## llm_evidence

N/A: this changes deterministic database outcome accounting. Model calls: 0. Cost: $0.
No model-backed behavior or real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0, Windows, Bun 1.4.2, PostgreSQL 16.15.
Authoring provider: OpenAI. Exact model identifier: unavailable.
GitHub connector and Git/gh were used directly. No computer or browser use.
No changed agent-client flow or acceptance run in another client is claimed.

## Alternatives and limits

1. Retry the counter separately after closing the delivery. This needs a durable pending marker to avoid losing or doubling increments.
2. Wrap calls in a scheduler transaction. This exposes PostgreSQL transaction ownership through the generic store and memory implementation.
3. Recompute counters from all deliveries. An acted delivery does not retain the replying surface, so the existing rows cannot reconstruct that history.

The store already owns the transition and its database connection. One statement keeps the two writes together with existing tables and permissions.
The expiry statement locks counter rows for its batch. Production load and database outages were not newly benchmarked.
Old missing counters are not reconstructed.
Thread replies still process deliveries individually; successful earlier transitions survive a later failure and are skipped on retry.
The change does not make token redemption, inbox reads or an entire thread reply one transaction.
Real crash timing, real carriers and real assistant apps are not exercised.
The service still uses its current thread preference. Assistant preference settings and producer migration remain unimplemented, as the README states.

The repository is starred and the PR comes from the existing fork.
No UI or member-facing copy changes; section 9's video exception is not applicable.
No secrets, `.env`, `runs/` or real member data belong in this diff.

## Reproduce

Use a local PostgreSQL cluster on port 54339, with `pg_ctl`, `psql` and `pg_dump` on PATH.
Set `REQUIRE_PG=1` and the local PostgreSQL user. Keep model keys and all live-send and deploy flags unset.
Run `bun install --frozen-lockfile` in each checkout.

1. Save the two programs below beside the base and candidate checkouts.
2. Run `bun run --conditions eliza-source notify-outcomes-measure.ts <base-checkout> notify-outcomes-before.json`.
3. Run the same command with the candidate checkout and `notify-outcomes-after.json`.
4. Run `bun run notify-outcomes-compare.ts`. Expect `passed: true`, 14 outcomes before and 27 after.
5. Run `bun test --conditions eliza-source packages/network/test/notify-outcomes.integration.test.ts` on candidate.
6. To repeat the failing test, copy only that test file to a clean base checkout. Expect the pending-count assertion to fail.

The measurement creates and drops its own database. It binds only to loopback and uses fictional 555-01xx phone numbers.

### Paired workflow program

```typescript
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";

const root=resolve(process.argv[2]!),out=resolve(process.argv[3]!);
const moduleAt=(p:string)=>import(pathToFileURL(resolve(root,p)).href);
const {SimClock,MINUTE,DAY}=await moduleAt("packages/core/src/clock.ts");
const {devPgUp,applySchema}=await moduleAt("packages/observatory/db/dev-pg.ts");
const {svcSign}=await moduleAt("packages/core/src/svc/svc-auth.ts");
const {TURN_PATH}=await moduleAt("packages/core/src/svc/contract.ts");
const {NetworkService}=await moduleAt("packages/network/service/service.ts");
const {DryRunAdapter}=await moduleAt("packages/network/service/channel.ts");
const db=`notify_outcomes_${randomUUID().replaceAll("-","")}`;
const prefix=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/`;
await devPgUp();
const admin=new SQL({url:prefix+"postgres",max:1});
await admin.unsafe(`create database ${db}`);
const url=prefix+db;await applySchema(url,{lockTimeout:"5s"});
const sql=new SQL({url,max:4}),clock=new SimClock(Date.UTC(2026,9,9,16));
const secret="synthetic-notify-outcome-measure-2026";
const logs:string[]=[];
const make=()=>new NetworkService({url,clock,photoStorage:null,instance:"notify-outcomes-measure",
  env:{PLATFORM_ENV:"dev",SERVICE_TURN_SECRET:secret,CLEF_RATINGS:"off"},
  networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},
  adapter:()=>new DryRunAdapter(()=>{}),log:(s:string)=>logs.push(s)});
let service=make(),seq=0;
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:r=>service.fetch(r)});
const say=async(from:string,text:string)=>{
  const id=`outcome-${++seq}`,body=JSON.stringify({messageId:id,channel:"blooio",from,to:null,text,transport:"imessage",receivedAt:clock.now(),app:"friends"});
  const response=await fetch(new URL(TURN_PATH,server.url),{method:"POST",body,headers:{"content-type":"application/json",
    ...await svcSign(secret,{method:"POST",path:TURN_PATH,id,body,nowS:Math.floor(clock.now()/1000)})}});
  if(response.status!==200)throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const result=await response.json();clock.advance(MINUTE);return result;
};
const results:any[]=[];
try {
  await service.start();
  for(const failAt of [0,1,2]) {
    const people:string[]=[],phones=[0,1,2].map(i=>`+121255501${80+failAt*3+i}`);
    const joins:any[]=[];
    for(const [i,phone]of phones.entries()) {
      for(const text of ["friends.help",`${i?"Bea":"Ari"}, 29`,"I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"])
        joins.push(await say(phone,text));
      people.push((await service.accounts.personFor(phone))!.id);
    }
    const inputs:any[]=[];
    for(let i=0;i<3;i++)for(const personId of people){
      await service.notify.add({personId,app:"friends",eventType:"requested",subjectId:`${failAt}-${i}`,urgency:"requested",summary:"Your requested update is ready."},clock.now());
      await service.notifyTick();
    }
    const snapshot=async()=>({
      deliveries:await sql`select person_id,delivery_id,item_ids,target,counts_toward_cap,sent_at,outcome,outcome_at from notify.deliveries where person_id=any(${sql.array(people,"text")}) order by person_id,sent_at,delivery_id`,
      signals:await sql`select * from notify.surface_signals where person_id=any(${sql.array(people,"text")}) order by person_id,surface`,
      items:await sql`select * from notify.inbox_items where person_id=any(${sql.array(people,"text")}) order by id`,
      messages:await sql`select m.* from network.messages m join network.members n on n.id=m.member_id where n.person_id=any(${sql.array(people,"uuid")}) and m.type='notify' order by m.id`,
    });
    const before=await snapshot();
    if(before.deliveries.length!==9||before.messages.length!==9||before.messages.some((m:any)=>m.status!=="dry_run"))throw new Error("Native notification sends missing");
    const installFault=async(kind:"acted"|"ignored")=>{
      await sql.unsafe(`create sequence notify.outcome_attempts`);
      await sql.unsafe(`create function notify.reject_outcome() returns trigger language plpgsql as $$ begin
        if new.${kind}>coalesce(old.${kind},0) and nextval('notify.outcome_attempts')=${failAt} then raise exception 'synthetic outcome counter failure'; end if;
        return new; end $$`);
      await sql.unsafe(`create trigger reject_outcome before update on notify.surface_signals for each row execute function notify.reject_outcome()`);
    };
    const removeFault=async()=>{
      const [attempt]=await sql`select last_value::int as attempts,is_called from notify.outcome_attempts`;
      await sql.unsafe(`drop trigger reject_outcome on notify.surface_signals`);
      await sql.unsafe(`drop function notify.reject_outcome()`);
      await sql.unsafe(`drop sequence notify.outcome_attempts`);
      return attempt;
    };
    if(failAt)await installFault("acted");
    const actedResponse=await say(phones[0]!,"HELP");
    const actedFault=await snapshot(),actedAttempts=failAt?await removeFault():null;
    await service.close();service=make();await service.start();
    await say(phones[0]!,"HELP");
    const actedRetry=await snapshot();
    clock.advance(4*DAY);
    if(failAt)await installFault("ignored");
    let sweepError:string|null=null;
    try{await service.notifyTick();}catch(e){sweepError=String((e as Error).message);}
    const ignoredFault=await snapshot(),ignoredAttempts=failAt?await removeFault():null;
    await service.close();service=make();await service.start();
    await Promise.all([service.notifyTick(),service.notifyTick()]);
    const after=await snapshot();
    await say(phones[0]!,"HELP");
    await service.notifyTick();
    const replay=await snapshot();
    const counter=(snap:any,person:string,key:string)=>snap.signals.filter((s:any)=>s.person_id===person).reduce((sum:number,s:any)=>sum+s[key],0);
    results.push({failAt,people,phones,joins,before,actedResponse,actedFault,actedAttempts,actedRetry,sweepError,ignoredFault,ignoredAttempts,after,replay,
      counts:{deliveries:after.deliveries.length,acted:counter(after,people[0]!,'acted'),ignored:people.slice(1).reduce((n,p)=>n+counter(after,p,'ignored'),0),
        actedAgain:counter(replay,people[0]!,'acted'),ignoredAgain:people.slice(1).reduce((n,p)=>n+counter(replay,p,'ignored'),0)},logs:logs.splice(0)});
  }
  await Bun.write(out,JSON.stringify({root,results},null,2)+"\n");
  console.log(JSON.stringify(results.map(r=>({failAt:r.failAt,counts:r.counts,sweepError:r.sweepError})),null,2));
}finally{server.stop(true);await service.close();await sql.close();await admin.unsafe(`drop database if exists ${db} with(force)`);await admin.close();}
```

### Comparison program

```typescript
import assert from "node:assert/strict";
const before=await Bun.file(new URL("./notify-outcomes-before.json",import.meta.url)).json();
const after=await Bun.file(new URL("./notify-outcomes-after.json",import.meta.url)).json();
const canonical=(r:any)=>{
  const replacements=new Map<string,string>();
  r.people.forEach((p:string,i:number)=>replacements.set(p,`person-${i}`));
  r.joins.filter((j:any)=>j.reason==="joined").forEach((j:any,i:number)=>replacements.set(j.memberId,`member-${i}`));
  for(const d of r.before.deliveries){
    const item=r.before.items.find((i:any)=>i.id===d.item_ids[0]);
    replacements.set(d.delivery_id,`delivery-${r.people.indexOf(d.person_id)}-${item.subject_id}`);
  }
  const pairs=[...replacements].sort((a,b)=>b[0].length-a[0].length);
  const norm=(v:any):any=>typeof v==="string"?pairs.reduce((s,[a,b])=>s.replaceAll(a,b),v)
    :Array.isArray(v)?v.map(norm):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).map(([k,val])=>[k,norm(val)])):v;
  const out=norm(r);
  for(const key of ["before","actedFault","actedRetry","ignoredFault","after","replay"])
    for(const field of ["deliveries","signals","messages","items"])
      out[key][field].sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return out;
};
const rows=[];
for(let i=0;i<before.results.length;i++){
  const b=canonical(before.results[i]),a=canonical(after.results[i]);
  assert.equal(a.failAt,b.failAt);assert.deepEqual(a.joins,b.joins);assert.deepEqual(a.actedResponse,b.actedResponse);
  assert.deepEqual(a.before,b.before);
  for(const phase of ["before","actedFault","actedRetry","ignoredFault","after","replay"]){
    assert.deepEqual(a[phase].items,b[phase].items);
    assert.deepEqual(a[phase].messages,b[phase].messages);
    assert.deepEqual(a[phase].items,a.before.items);
    assert.deepEqual(a[phase].messages,a.before.messages);
    const deliveries=(s:any)=>s.deliveries.map(({outcome,outcome_at,...d}:any)=>d);
    assert.deepEqual(deliveries(a[phase]),deliveries(b[phase]));
    if(!a.failAt)assert.deepEqual(a[phase],b[phase]);
  }
  assert.deepEqual(a.counts,{deliveries:9,acted:3,ignored:6,actedAgain:3,ignoredAgain:6});
  assert.equal(a.after.deliveries.filter((d:any)=>d.outcome==="acted").length,3);
  assert.equal(a.after.deliveries.filter((d:any)=>d.outcome==="ignored").length,6);
  assert.deepEqual(a.replay.deliveries,a.after.deliveries);
  assert.equal(a.after.signals.reduce((n:number,s:any)=>n+s.ignored_streak,0),6);
  if(a.failAt){
    assert.equal(a.sweepError,"synthetic outcome counter failure");
    assert.equal(a.actedAttempts.attempts,a.failAt);
    assert.equal(a.ignoredAttempts.attempts,a.failAt);
    assert.equal(a.actedFault.deliveries.filter((d:any)=>d.person_id==="person-0"&&d.outcome===null).length,4-a.failAt);
    assert.equal(a.ignoredFault.deliveries.filter((d:any)=>d.outcome===null).length,6);
    assert.equal(a.ignoredFault.signals.reduce((n:number,s:any)=>n+s.ignored,0),0);
  }
  rows.push({failAt:a.failAt,deliveries:a.counts.deliveries,before:{acted:b.counts.acted,ignored:b.counts.ignored},after:{acted:a.counts.acted,ignored:a.counts.ignored}});
}
const result={passed:true,rows,correctBefore:rows.reduce((n,r)=>n+r.before.acted+r.before.ignored,0),correctAfter:rows.reduce((n,r)=>n+r.after.acted+r.after.ignored,0),
  nativeNotifications:27,syntheticAdults:9,matchingEnabled:false,unchangedCompleteControlSnapshots:6,unchangedItemAndMessageSnapshots:18,
  normalization:"Fresh random person/member UUIDs and derived delivery IDs only; snapshot row order after identity replacement."};
await Bun.write(new URL("./notify-outcomes-comparison.json",import.meta.url),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
```
