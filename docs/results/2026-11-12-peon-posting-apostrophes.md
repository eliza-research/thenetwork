# Peon posting intake with smart apostrophes — 2026-11-12

An adult Peon member types `We’re hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL`. The service answers with a generic onboarding question instead of a job-post read-back. The same sentence with `We're` works. A subsequent yes cannot save the smart-apostrophe version because no posting draft exists.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. This is a reproduced defect in the documented rules-based text intake (`docs/network.md` 1.4), within the approved scope and the local Peon pilot in PRD 40.6.

## Cause and change

`readPostingText` tested an ASCII-only command expression against the original text. Phone-keyboard apostrophes U+2018 and U+2019 did not match the supported `We're` and `I'm` commands. The same characters prevented negative sponsorship contractions from appearing in the read-back.

Normalize those two characters to an ASCII apostrophe at the intake boundary, before command detection and field parsing. Reusing the existing parser keeps all supported commands and field interpretation together. The original inbound message still goes through the normal service storage path. No schema, matching policy, eligibility guard, confirmation rule or message template changes.

## Regression through HTTP and Postgres

`packages/network/test/posting-apostrophes.integration.test.ts` starts the real `NetworkService` and a loopback HTTP server with signed Blooio webhook requests. Members join by text, receive the posting read-back, explicitly confirm, and get persisted job rows and engine seats after a service restart. The test includes both smart apostrophes, an ASCII control, a negative sponsorship field and a minor who cannot post. The provider adapter is the repository's `DryRunAdapter`; no real text is sent.

```powershell
bun test --conditions eliza-source packages/network/test/posting-apostrophes.integration.test.ts
```

Regression on base: **0 pass, 1 fail, 4 assertions**, failing on the missing posting read-back (8802.98 ms case, 9.08 s suite, including initial database startup). After: **1 pass, 0 fail, 41 assertions** (3087.18 ms case, 3.16 s suite). These times are not a performance claim.

The base failure receives `Thanks, that helps. When are you usually free, and which neighborhood are you around most?` where the documented posting read-back is expected. The test verifies that no row is saved before the member's yes.

## measurement

The paired programs below run **96 actual HTTP/Postgres intake workflows per revision**, 24 cases for each service seed **1, 7, 13, 16**. Each cohort has its own synthetic phone identity and joins through the shared-line handler. Four signed inbound HTTP requests per case give **384 requests per revision**. Each seed cohort is followed by a service restart and inspection of the persisted postings and the real snapshot's job seats.

- Twelve cases per seed cross `We're` / `I'm`, straight / left-smart / right-smart apostrophes, and yes / no confirmation.
- Six cases use an ASCII opening with smart-apostrophe `can't`, `won't` or `don't` sponsorship statements.
- Five controls use uncontracted openings or positive, explicit-negative and unstated sponsorship.
- One minor case uses the smart-apostrophe opening and must receive the existing adults-only refusal, with no posting saved.

| Observation | Before | After |
| --- | --- | --- |
| Correct intake outcomes | 36/96 | 96/96 |
| Adult posting read-backs | 60/92 | 92/92 |
| Expected confirmed postings saved and restored | 52/68 | 68/68 |
| Smart-apostrophe sponsorship fields in the read-back | 0/24 | 24/24 |
| Postings saved before confirmation | 0 | 0 |
| Postings saved for minors | 0 | 0 |

All 36 already-correct controls remain identical. Counts overlap.

The 60 corrected workflows consist of 32 missing read-backs, 24 missing sponsorship read-back fields, and four missing adults-only responses. Counts in the table overlap. For the sponsorship cases, the existing row writer already defaulted the unstated value to `no`; this fix restores the explicit field in the read-back rather than changing that storage default.

Every control's complete read-back, response after confirmation or rejection, stored posting fields, restored fields and seat count is identical before and after. Posting IDs, manager IDs and creation/update timestamps are omitted from the paired comparison because each cohort creates new identities. All 68 expected postings survive restart and have a job seat. All outbound rows are verified `dry_run`; every case has zero postings before confirmation, and every minor has zero postings. Peon matching remains locked in this service workflow; matching safety is measured separately by the simulation gates.

Environment: Windows, Bun 1.4.2, PostgreSQL 16.15 on local port 54339, Codex desktop 26.1103.7773.0. Frozen dependency installation made no changes. Real provider keys and live-send/deploy flags were cleared. No model response, mocked parser, or manually inserted posting is used as proof.

## safety_gates

The same `bun run sim --only peon,safety,audit --json <output>` passes **60/60 blocking gates before and after**, with local PostgreSQL and `REQUIRE_PG=1`: Peon 27, safety 17, audit 16. All **61 complete gate records** match after excluding execution duration, including the tracked pack/keyword/oracle fingerprint `b7736da857812394`. Runtime: 64.2s before and 62.2s after. No tracked gate is off target.

The full simulation was already run earlier in this agent session. `AGENTS.md` limits each agent to one full run; this change uses fresh affected blocks. No gate threshold or expectation changed.

## Repository validation

All four TypeScript configurations pass. Integration includes the security suite:

```text
 676 pass
 8 skip
 6 fail
 13782 expect() calls
Ran 690 tests across 69 files. [406.43s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green; the eight optional skips remain.

E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [35.94s]
```

The optional SDK/browser case remains skipped.

## llm_evidence and agent_clients

Real LLM: N/A. `docs/network.md` 1.4 specifies rules-only posting intake that never consumes open-turn LLM output. The change normalizes two characters before that parser. The real service, HTTP handler, database, restart and snapshot are exercised without model calls.

Tested authoring client: Codex desktop 26.1103.7773.0, PowerShell and Bun 1.4.2. Provider: OpenAI; exact authoring model identifier unavailable, not inferred. No external agent-client qualification is claimed; the affected path is the service's text handler.

Limits: only U+2018 and U+2019 are normalized. This does not expand the supported job grammar, change direct `parsePosting` callers, change confirmation parsing, or enable Peon matching or live sends. Service seeds exercise the intake, not new matching populations; the official Peon simulation supplies separate matching evidence.

## Reproduce the paired measurement

Save the following hand-written programs beside the base and candidate checkouts. The HTTP workflows and database results are generated by the actual service.

```powershell
bun --conditions eliza-source posting-quotes-measure.ts ./friends-crew-base ./posting-quotes-before.json
bun --conditions eliza-source posting-quotes-measure.ts ./thenetwork ./posting-quotes-after.json
bun posting-quotes-compare.ts
```

### posting-quotes-measure.ts

```ts
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {SQL} from "bun";
const [rootArg, output]=process.argv.slice(2),root=resolve(rootArg!);
const from=(p:string)=>import(pathToFileURL(resolve(root,p)).href);
const {MINUTE,DAY,SimClock}=await from("packages/core/src/index.ts");
const {signBlooioPayload}=await from("packages/blooio/src/blooio/webhook.ts");
const {testDb,dropTestDb}=await from("packages/observatory/test/pg.ts");
const {NetworkService,WEBHOOK_PATH}=await from("packages/network/service/service.ts");
const {DryRunAdapter}=await from("packages/network/service/channel.ts");
const {loadPostings}=await from("packages/network/service/postings.ts");
const {loadSnapshot}=await from("packages/network/service/snapshot.ts");
const {START}=await from("packages/network/test/mini.ts");
const cases:any[]=[];
for(const q of ["'","’","‘"])for(const prefix of [`We${q}re`,`I${q}m`])for(const answer of ["yes","no"])
  cases.push({name:`${prefix}-${answer}`,prefix,answer,sponsor:`We can${q}t sponsor`,expectedSponsor:false,control:q==="'"});
for(const word of ["can","won","don"])for(const q of ["’","‘"])
  cases.push({name:`${word}${q}t`,prefix:"We're",answer:"yes",sponsor:`We ${word}${q}t sponsor`,expectedSponsor:false,control:false});
for(const prefix of ["We are","I am"])cases.push({name:prefix,prefix,answer:"yes",sponsor:"No visa sponsorship",expectedSponsor:false,control:true});
for(const [name,sponsor,expectedSponsor] of [["positive","We can sponsor",true],["negative","No visa sponsorship",false],["unstated","",undefined]])
  cases.push({name,prefix:"We're",answer:"yes",sponsor,expectedSponsor,control:true});
cases.push({name:"minor",prefix:"We’re",answer:"yes",sponsor:"",minor:true,control:false});
if(cases.length!==24)throw Error("Case count changed");
const url=await testDb(),sql=new SQL({url,max:2}),rows:any[]=[];
let svc:any,http:any,seq=0;
const secret="synthetic-posting-quotes-webhook";
const clean=(p:any)=>{const{id,managerId,createdAt,updatedAt,...fields}=p;return fields;};
try {
 for(const [si,seed] of [1,7,13,16].entries()){
  const clock=new SimClock(START+si*DAY);
  const service=()=>new NetworkService({url,clock,instance:"posting-quotes",log:()=>{},env:{PLATFORM_ENV:"dev"},
    networks:[{id:"ntwrk:nyc"},{id:"peon:nyc"}],webhookSecret:secret,network:{seed},photoStorage:null,notify:false,adapter:()=>new DryRunAdapter(()=>{})});
  svc=service();await svc.start();http=Bun.serve({hostname:"127.0.0.1",port:0,fetch:(r:Request)=>svc.fetch(r)});
  const say=async(phone:string,body:string)=>{
   const n=++seq,raw=JSON.stringify({id:`quotes-${n}`,type:"message.received",api_version:"2026-10-01",created_at:clock.now(),organization_id:"org_test",
     data:{message_id:`quotes-message-${n}`,sender:phone,chat_id:phone,text:body,protocol:"imessage"}});
   const r=await fetch(`${http.url}${WEBHOOK_PATH.slice(1)}`,{method:"POST",headers:{"content-type":"application/json","x-blooio-signature":signBlooioPayload(secret,raw,Math.floor(clock.now()/1000))},body:raw});
   if(r.status!==200)throw Error(`HTTP ${r.status}`);await r.arrayBuffer();clock.advance(MINUTE);
  };
  const member=async(phone:string)=>(await sql`select m.id from network.members m join platform.phone_identities p on p.person_id=m.person_id where m.app_id='peon' and p.e164=${phone}`)[0].id;
  const last=async(id:string)=>(await sql`select body from network.messages where app_id='peon' and member_id=${id} and direction='outbound' order by ts desc,id desc limit 1`)[0].body;
  const cohort:any[]=[];
  for(const [ci,c] of cases.entries()){
   const phone=`+121255501${String(si*24+ci).padStart(2,"0")}`;
   await say(phone,"peon");await say(phone,`Rowan, ${c.minor?15:34}`);const id=await member(phone);
   await say(phone,`${c.prefix} hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL. ${c.sponsor}`);
   const reply=await last(id),before=(await loadPostings(sql,"peon",id)).length;
   if(before!==0)throw Error("A posting was saved before confirmation");
   const readback=reply.startsWith("Here's your job post:"),sponsorText=c.expectedSponsor===undefined?!reply.includes("Visa sponsorship:"):reply.includes(`Visa sponsorship: ${c.expectedSponsor?"yes":"no"}.`);
   await say(phone,c.answer);const posts=await loadPostings(sql,"peon",id);
   const expectedSaved=!c.minor&&c.answer==="yes"?1:0;
   // The existing row writer persists an unstated sponsorship value as "no".
   const fieldsOk=posts.length===0||posts.every((p:any)=>p.title==="data analyst"&&p.openings===2&&p.payMin===90&&p.payMax===120&&p.mode==="hybrid"&&p.sponsors===(c.expectedSponsor??false));
   const expected=c.minor?reply==="Job posts are for adults (18+) only.":readback&&sponsorText;
   const r={seed,name:c.name,control:c.control,minor:!!c.minor,expectedSaved,exact:expected&&posts.length===expectedSaved&&fieldsOk,
     readback,reply,afterReply:await last(id),beforeSaved:before,posts:posts.map(clean),ids:posts.map((p:any)=>p.id),member:id};
   rows.push(r);cohort.push(r);
  }
  await http.stop(true);http=undefined;await svc.close();svc=service();await svc.start();
  const snap=await loadSnapshot(sql,clock.now(),{app:"peon",city:"nyc"});
  for(const r of cohort){
   const restored=await loadPostings(sql,"peon",r.member);r.restored=restored.map(clean);r.seats=r.ids.filter((id:string)=>snap.members.some((m:any)=>m.id===`job:${id}`)).length;
   if(JSON.stringify(r.posts)!==JSON.stringify(r.restored)||r.seats!==r.posts.length)throw Error("Restart lost posting data");
   delete r.ids;delete r.member;
  }
  const counts=await sql`select status,count(*)::int as n from network.messages where direction='outbound' group by status`;
  if(counts.some((r:any)=>r.status!=="dry_run"))throw Error("Non-dry-run outbound message");
  await svc.close();svc=undefined;
  console.log(JSON.stringify({seed,cases:cohort.length,correct:cohort.filter(r=>r.exact).length,posts:cohort.reduce((n,r)=>n+r.posts.length,0)}));
 }
 await Bun.write(output!,JSON.stringify(rows,null,2));
}finally{await http?.stop(true);await svc?.close();await sql.close();await dropTestDb();}
```

### posting-quotes-compare.ts

```ts
import {strict as assert} from "node:assert";
const read=(name:string)=>Bun.file(new URL(name,import.meta.url)).json();
const b=await read("posting-quotes-before.json"),a=await read("posting-quotes-after.json");
assert.equal(b.length,96);assert.equal(a.length,96);
let fixed=0,unchanged=0;
for(let i=0;i<a.length;i++){
 const x=b[i],y=a[i];assert.deepEqual([y.seed,y.name,y.control],[x.seed,x.name,x.control]);assert(y.exact);assert.equal(y.beforeSaved,0);
 if(y.control){assert.deepEqual(y,x);unchanged++;}else{assert(!x.exact);fixed++;}
 assert.equal(y.posts.length,y.expectedSaved);assert.equal(y.seats,y.expectedSaved);assert.deepEqual(y.restored,y.posts);
 if(y.minor)assert.equal(y.posts.length,0);
}
const total=(xs:any[],f:(r:any)=>number)=>xs.reduce((n,r)=>n+f(r),0);
const out={cases:a.length,fixed,unchanged,correctBefore:b.filter((r:any)=>r.exact).length,correctAfter:a.length,
 readbacksBefore:b.filter((r:any)=>r.readback).length,readbacksAfter:a.filter((r:any)=>r.readback).length,
 postsBefore:total(b,r=>r.posts.length),postsAfter:total(a,r=>r.posts.length),expectedPosts:total(a,r=>r.expectedSaved),
 sponsorshipReadbacksCorrectBefore:b.filter((r:any)=>/^(can|won|don)[‘’]t$/.test(r.name)&&r.exact).length,
 sponsorshipReadbacksCorrectAfter:a.filter((r:any)=>/^(can|won|don)[‘’]t$/.test(r.name)&&r.exact).length,
 savedBeforeConfirmation:total(a,r=>r.beforeSaved),minorPosts:total(a.filter((r:any)=>r.minor),r=>r.posts.length)};
await Bun.write(new URL("posting-quotes-comparison.json",import.meta.url),JSON.stringify(out,null,2));console.log(JSON.stringify(out));
```
