# Count open member turns as notification actions

Date: 2026-11-12. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Requirement and cause

This is a reproduced backend defect under the approved Slop scope and CONTRIBUTING 3.1.
The notification design in `docs/research/2026-10-08-entry-flows.md`, sections 4 and 5, uses replies as actions on notifications.
The Notify README says member texts call `threadReply`.
The shared-agent contract returns `open` when the backend hands an ordinary conversation to the member's agent.

`NetworkService.memberMessage` recorded notification actions only when the Network returned `handled`.
An ordinary member reply could return `open`, bypass the hook, and later leave all pending notifications marked ignored.
HELP used the hook correctly. Reply classification depended on which component answered the member.

The predicate now accepts both `handled` and `open`.
It retains the source, STOP and profile-read exclusions, and credits the member's actual thread channel.
The same hook records the thread's last-used time. Both open-reply cases retain the exact reply time after restart and sweep.
Request replay still uses the persisted response and does not enter the hook again.

## measurement

The same program ran on base and candidate using real PostgreSQL and signed loopback HTTP.
Ten fictional adults join Friends. Matching is disabled; the Network seed is 1.
Each receives three requested producer fixtures through the real notification scheduler and dry-run Network adapter.
These 30 notifications are controlled fixtures, not naturally generated matches or real carrier deliveries.

The matrix pairs iMessage/Blooio and SMS/Twilio inputs with five actions:
an open conversation, HELP, a saved-profile read, an assistant profile submission, and no response.
Profile submission uses the service method used by MCP, with its normal database owners; it does not launch an assistant client.
No service or database method is mocked.

The script replays the same signed requests, restarts the service, advances four days, and runs the outcome sweep twice.
It captures six database snapshots per case and the complete HTTP response bodies.

| Outcomes across both transports | Base | Candidate | Expected |
| --- | ---: | ---: | ---: |
| Open replies: acted / ignored | 0 / 6 | 6 / 0 | 6 / 0 |
| HELP: acted / ignored | 6 / 0 | 6 / 0 | 6 / 0 |
| Profile read: acted / ignored | 0 / 6 | 0 / 6 | 0 / 6 |
| Assistant profile: acted / ignored | 0 / 6 | 0 / 6 | 0 / 6 |
| No response: acted / ignored | 0 / 6 | 0 / 6 | 0 / 6 |
| Correct classifications | 24 / 30 | 30 / 30 | 30 / 30 |

The six false ignored outcomes become zero. Replays and repeated sweeps add no duplicate outcomes or notifications.
Acted outcomes credit iMessage or SMS according to the actual member reply.
All 48 complete control snapshots match.
Inbox items, messages and member rows match across all 60 paired snapshots.
Delivery metadata outside outcome and outcome time also matches.
Complete join, action and replay HTTP bodies match.

Comparison replaces fresh person/member UUIDs, their derived delivery IDs, assistant profile message UUIDs and the database-generated `network.members.created_at` value.
It then sorts rows after replacing identities. It preserves all other timestamps and business fields.

One new integration case covers both transports, a new notification after the first reply, replay, profile exclusions, restart and HELP.
Replaying the earlier open request leaves the later notification pending; a new reply acts on it.
It fails on base at the first ordinary reply: two pending notifications instead of zero.
That failing test stops before the later assertions; the paired program runs the full matrix on both revisions.

```text
Base:      0 pass / 1 fail / 9 expect() calls / 3.28s
Candidate: 1 pass / 0 fail / 62 expect() calls / 3.87s
```

One implementation candidate was measured. A test-only TypeScript inference error was fixed by naming the SQL result before asserting it.
No runtime behavior or input changed in that correction. The final integration suite reran the adjusted test successfully in 2.90s.
These are deterministic reproductions, not estimates of production reply frequency.
There is no parameter tuning or statistical significance claim.

## safety_gates

The same `bun run sim --only network,safety,audit --json <output>` command passes **94/94 blocking gates** before and after.
All **96 complete gate records** match after removing only execution duration.
All tracked records pass. Runtime: 230.3s before and 230.5s after.
Gate definitions, seeds, thresholds and simulation parameters are unchanged.

All four TypeScript configurations pass.
Integration, including the security suite:

```text
676 pass
 8 skip
 6 fail
 13803 expect() calls
Ran 690 tests across 69 files. [427.58s]
error: script "test:integration" exited with code 1
```

The six failure names and causes match the clean-base Windows reproduction.
They are missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions.
Integration is not green; eight optional skips remain.

E2E:

```text
(skip) failed security checks give recovery feedback and a later SDK success clears only that feedback

 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [38.81s]
```

One optional SDK/browser test remains skipped.
No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was used earlier in this session.
This candidate has fresh affected-block validation. Hosted CI is reported in the PR body.


## llm_evidence

N/A: deterministic backend outcome accounting, before any model reply is requested.
Validation provider, model and request settings: N/A. Model calls: 0. Cost: $0.
The HTTP test stops at the real `open` response. It does not exercise the downstream shared-agent model or claim real-model qualification.

## agent_clients

Codex desktop 26.1103.7773.0, Windows, Bun 1.4.2, PostgreSQL 16.15.
Authoring provider: OpenAI. Exact model identifier: unavailable.
GitHub connector and Git/gh were used directly. No computer or browser use.
No acceptance run in another agent client is claimed.

## Alternatives and limits

1. Count every inbound request before routing. That would include excluded profile reads, assistant submissions, and requests without a member conversation.
2. Count actions in the shared-agent gateway. That would duplicate the existing outcome owner and require an upstream change outside this repository.
3. Treat `open` as `handled`. That would change the gateway contract and prevent the normal agent handoff.

The existing member hook already has the source, disposition and channel. Extending its predicate keeps these decisions together.
Past ignored outcomes are not rewritten. This change does not add recovery after a failed counter write.
The integration exercises Friends on both thread transports. It does not claim real carriers, other apps' enrollment flows, or downstream model responses.
Matching is disabled in the new workflow fixture; the existing simulation blocks provide separate regression evidence.
The service's assistant-preference settings and producer migration remain unimplemented, as the Notify README states.

The repository is starred and the PR comes from the existing fork.
No UI or member-facing copy changes; section 9's video exception is not applicable.
No secrets, `.env`, `runs/` or real member data belong in this diff.

## Reproduce

Use local PostgreSQL on port 54339, with `pg_ctl`, `psql` and `pg_dump` on PATH.
Set `REQUIRE_PG=1` and the local PostgreSQL user. Keep model keys and live-send and deploy flags unset.
Run `bun install --frozen-lockfile` in both checkouts.

1. Save the two programs below beside the base and candidate checkouts.
2. Run `bun run --conditions eliza-source open-notify-measure.ts <base-checkout> open-notify-before.json`.
3. Run the same command with the candidate checkout and `open-notify-after.json`.
4. Run `bun run open-notify-compare.ts`. Expect `passed: true` and false ignored outcomes to change from six to zero.
5. Run `bun test --conditions eliza-source packages/network/test/notify-open-turns.integration.test.ts` on candidate.
6. Copy only the test file to a clean base checkout to repeat its failing pending-count assertion.

The program creates and drops its own database, binds only to loopback, and uses fictional 555-01xx phone numbers.

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
const db=`notify_open_${randomUUID().replaceAll("-","")}`,prefix=`postgres://${process.env.USER??"postgres"}@127.0.0.1:54339/`;
await devPgUp();const admin=new SQL({url:prefix+"postgres",max:1});
await admin.unsafe(`create database ${db}`);const url=prefix+db;await applySchema(url,{lockTimeout:"5s"});
const sql=new SQL({url,max:4}),clock=new SimClock(Date.UTC(2026,9,9,16));
const secret="synthetic-open-notify-measure-2026",logs:string[]=[];
const make=()=>new NetworkService({url,clock,photoStorage:null,instance:"open-notify-measure",
  env:{PLATFORM_ENV:"dev",SERVICE_TURN_SECRET:secret,CLEF_RATINGS:"off"},
  networks:[{id:"friends:nyc",matchingEnabled:false}],network:{seed:1},
  adapter:()=>new DryRunAdapter(()=>{}),log:(s:string)=>logs.push(s)});
let svc=make(),seq=0;
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:r=>svc.fetch(r)});
const results:any[]=[];
const post=async(input:any)=>{
  const body=JSON.stringify(input),r=await fetch(new URL(TURN_PATH,server.url),{method:"POST",body,headers:{"content-type":"application/json",
    ...await svcSign(secret,{method:"POST",path:TURN_PATH,id:input.messageId,body,nowS:Math.floor(clock.now()/1000)})}});
  if(r.status!==200)throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
};
try{
  await svc.start();
  for(const transport of ["imessage","sms"])for(const action of ["open","help","profile","assistant","silent"]){
    const phone=`+121255501${80+results.length}`;
    const input=(text:string)=>({messageId:`open-notify-${++seq}`,channel:transport==="sms"?"twilio":"blooio",from:phone,to:null,text,transport,receivedAt:clock.now(),app:"friends"});
    const say=async(text:string)=>{const r=await post(input(text));clock.advance(MINUTE);return r;};
    const joins=[];
    for(const text of ["friends.help","Ari, 29","I enjoy hiking and cooking","Saturday afternoons work for me","Small groups are good"])
      joins.push(await say(text));
    const personId=(await svc.accounts.personFor(phone))!.id,memberId=joins.find((r:any)=>r.reason==="joined").memberId;
    for(let i=0;i<3;i++){
      await svc.notify.add({personId,app:"friends",eventType:"requested",subjectId:`${action}-${i}`,urgency:"requested",summary:"Your requested update is ready."},clock.now());
      await svc.notifyTick();
    }
    const snapshot=async()=>({
      deliveries:await sql`select * from notify.deliveries where person_id=${personId} order by delivery_id`,
      signals:await sql`select * from notify.surface_signals where person_id=${personId} order by surface`,
      items:await sql`select * from notify.inbox_items where person_id=${personId} order by id`,
      messages:await sql`select * from network.messages where member_id=${memberId} order by id`,
      member:await sql`select * from network.members where id=${memberId}`,
    });
    const before=await snapshot();
    if(before.deliveries.length!==3||before.messages.filter((r:any)=>r.type==="notify"&&r.status==="dry_run").length!==3)throw new Error("Missing native notifications");
    let request:any=null,response:any=null,replay:any=null;
    if(action==="assistant")response=await svc.submitProfile(personId,"friends",phone,"I enjoy hiking and cooking");
    else if(action!=="silent"){
      request=input(action==="open"?"Tell me something about the weather":action==="help"?"HELP":"show my friends profile");
      response=await post(request);clock.advance(MINUTE);
      if(response.outcome!==(action==="open"?"open":"handled"))throw new Error(`Unexpected ${action} disposition: ${JSON.stringify(response)}`);
    }
    const acted=await snapshot();
    if(request)replay=await post(request);
    const replayed=await snapshot();
    await svc.close();svc=make();await svc.start();
    const restarted=await snapshot();clock.advance(4*DAY);await svc.notifyTick();
    const after=await snapshot();await svc.notifyTick();const repeated=await snapshot();
    results.push({transport,action,phone,personId,memberId,joins,request,response,replay,before,acted,replayed,restarted,after,repeated,
      counts:{acted:after.signals.reduce((n:number,s:any)=>n+s.acted,0),ignored:after.signals.reduce((n:number,s:any)=>n+s.ignored,0),
        actedSurfaces:after.signals.filter((s:any)=>s.acted).map((s:any)=>({surface:s.surface,acted:s.acted}))},logs:logs.splice(0)});
  }
  await Bun.write(out,JSON.stringify({root,results},null,2)+"\n");
  console.log(JSON.stringify(results.map(r=>({transport:r.transport,action:r.action,counts:r.counts})),null,2));
}finally{server.stop(true);await svc.close();await sql.close();await admin.unsafe(`drop database if exists ${db} with(force)`);await admin.close();}
```

### Comparison program

```typescript
import assert from "node:assert/strict";
const before=await Bun.file(new URL("./open-notify-before.json",import.meta.url)).json();
const after=await Bun.file(new URL("./open-notify-after.json",import.meta.url)).json();
const phases=["before","acted","replayed","restarted","after","repeated"];
function canonical(r:any){
  const replacements=new Map<string,string>([[r.personId,"person"],[r.memberId,"member"]]);
  for(const d of r.before.deliveries){
    const item=r.before.items.find((i:any)=>i.id===d.item_ids[0]);
    replacements.set(d.delivery_id,`delivery-${item.subject_id}`);
  }
  r.after.messages.filter((m:any)=>m.id.startsWith("agent_")).forEach((m:any,i:number)=>replacements.set(m.id,`agent-message-${i}`));
  const pairs=[...replacements].sort((a,b)=>b[0].length-a[0].length);
  const norm=(v:any):any=>typeof v==="string"?pairs.reduce((s,[a,b])=>s.replaceAll(a,b),v)
    :Array.isArray(v)?v.map(norm):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).map(([k,val])=>[k,norm(val)])):v;
  const x=norm(r);
  for(const phase of phases){
    for(const m of x[phase].member)m.created_at="database-created-at";
    for(const field of ["deliveries","signals","items","messages","member"])
      x[phase][field].sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return x;
}
const rows=[];
assert.equal(before.results.length,10);assert.equal(after.results.length,10);
for(let i=0;i<10;i++){
  const b=canonical(before.results[i]),a=canonical(after.results[i]);
  assert.equal(a.action,b.action);assert.equal(a.transport,b.transport);
  for(const key of ["joins","request","response","replay","before"])assert.deepEqual(a[key],b[key]);
  if(a.request)assert.deepEqual(a.response,a.replay);
  for(const phase of phases){
    for(const field of ["items","messages","member"])assert.deepEqual(a[phase][field],b[phase][field]);
    const metadata=(s:any)=>s.deliveries.map(({outcome,outcome_at,...d}:any)=>d);
    assert.deepEqual(metadata(a[phase]),metadata(b[phase]));
    if(a.action!=="open")assert.deepEqual(a[phase],b[phase]);
  }
  assert.deepEqual(a.acted,a.replayed);assert.deepEqual(a.replayed,a.restarted);assert.deepEqual(a.after,a.repeated);
  const acted=a.action==="open"||a.action==="help";
  assert.deepEqual(a.counts,{acted:acted?3:0,ignored:acted?0:3,actedSurfaces:acted?[{surface:a.transport,acted:3}]:[]});
  assert.ok(a.after.deliveries.every((d:any)=>d.outcome===(acted?"acted":"ignored")));
  if(a.action==="open"){
    assert.ok(b.after.deliveries.every((d:any)=>d.outcome==="ignored"));
    assert.equal(a.counts.ignored,0);assert.equal(b.counts.acted,0);
    assert.equal(Date.parse(a.after.signals.find((s:any)=>s.surface===a.transport).last_used_at),a.request.receivedAt);
  }
  assert.equal(a.after.messages.filter((m:any)=>m.type==="notify"&&m.status==="dry_run").length,3);
  rows.push({transport:a.transport,action:a.action,before:b.counts,after:a.counts});
}
const result={passed:true,cases:10,syntheticAdults:10,notifications:30,falseIgnoredBefore:6,falseIgnoredAfter:0,
  correctOutcomesBefore:24,correctOutcomesAfter:30,unchangedControlSnapshots:48,unchangedItemMessageMemberSnapshots:60,rows,
  normalization:"Fresh person/member UUIDs, derived delivery IDs, assistant profile message UUIDs, database-generated member.created_at only, and row order."};
await Bun.write(new URL("./open-notify-comparison.json",import.meta.url),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({...result,rows:undefined},null,2));
```
