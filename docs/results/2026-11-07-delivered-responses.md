# Count simulator responses only after delivery

## Problem and requirement

The response report counts a persona's decision before its reply reaches the channel.
A reply can fall beyond the run horizon, or STOP can suppress it before delivery.
Both cases still increase accepted, declined, countered, or consent-probe answer counts on main.

This is a reproduced simulation defect under the approved contribution scope and PRD 34.3–34.4.
The base is current main, `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
This branch contains no other pending contribution.

For example, generate 40 adult personas with seed 1 and run StubNetwork for 10 days.
Use `joinSpreadDays: 1`, `minorShare: 0`, `adversarialRate: 0`, and the default start.
Main reports eight acceptances from 33 invitations.
One accepted reply is scheduled 12.43 hours after the run ends, following a 24.85-hour reply delay.
Only seven accepted replies reached the channel.
The fix reports seven acceptances, five unanswered invitations, and an acceptance rate of 0.212 instead of 0.242.

## Implementation and alternatives

The primary queued persona reply carries the originating message ID.
When that reply reaches the channel, its inbound record gets `meta.inReplyTo`.
Reaction metadata remains intact.
The World log declares `config.replyTracking: true`.
The response judge requires a delivered inbound reply for the same member and message ID in these logs.

The judge retains decision-only counting for older logs without that declaration.
This avoids interpreting missing historical metadata as proof that every old reply failed.
The existing `ignored` counters mean unanswered at the cutoff; they include pending and suppressed replies.
The invitation and probe denominators remain unchanged.

Decision records stay at decision time for diagnostics.
The new metadata is simulator bookkeeping and is not passed into `Network.onInbound`.
Follow-ups and scripted sends do not masquerade as primary replies.
No scheduling, persona policy, matching, message text, safety rule, or threshold changes.

Two alternatives were rejected:

- Counting by scheduled reply time still counts replies suppressed by STOP.
- Moving decision records to delivery loses ignored decisions and the original decision-time evidence.

Explicit delivery evidence handles both failures and preserves replay compatibility.

## measurement

The same program below ran against base and changed source.
It runs complete worlds with the real policy agent and either StubNetwork or ConsentNetwork.
The observer records the agent's actual reply without modifying it.
Expected counts come from delivered channel messages with the same member, scheduled timestamp, and actual reply text.
This independent check does not use `inReplyTo` to decide whether a reply arrived.
It rejects ambiguous channel matches.

Each group uses seeds 1–30 and 40 generated adult personas with a one-day join spread.
ConsentNetwork uses simulated automatic review, with growth and plans disabled.
The STOP variants stop one member halfway between a generated decision and its queued reply.
The proposal variant selects the first replying proposal; the consent variant selects the first replying probe.
The reaction variant enables the policy agent's real reaction support.

| Group | Days | Worlds | Incorrect reports before | After | False responses removed |
|---|---:|---:|---:|---:|---:|
| StubNetwork | 3 | 30 | 1 | 0 | 1 decline |
| StubNetwork | 10 | 30 | 2 | 0 | 1 acceptance, 1 decline |
| StubNetwork | 14 | 30 | 0 | 0 | 0 |
| StubNetwork with reactions | 10 | 30 | 2 | 0 | 2 declines |
| ConsentNetwork | 10 | 30 | 2 | 0 | 2 acceptances |
| ConsentNetwork with STOP before a probe reply | 10 | 30 | 30 | 0 | 1 counter, 14 probe yes, 17 probe no |
| StubNetwork with STOP before a proposal reply | 10 | 30 | 30 | 0 | 4 acceptances, 28 declines |
| Total | | 210 | 67 | 0 | 71 |

The 71 false responses comprise 11 replies beyond the horizon and 60 replies suppressed by STOP.
The fix correctly links 17,812 delivered primary replies, including 108 reactions, with zero incorrect links.
All 143 unaffected worlds retain identical complete metrics.
All 210 worlds retain identical populations, non-response metrics, and old-log replay metrics.
Complete event traces match after removing only the new reply metadata, its configuration declaration, and wall time.

Initial exploration used seeds 1–12 at 2, 3, 5, and 10 days.
It found five ordinary horizon failures before the change.
The integration case used seeds 1–3 during development.
The wider measurement includes seeds 13–30, which were not used to tune the fix.
These are exact paired accounting checks, not estimates of a matching improvement; no significance claim is made.

## safety_gates

Run the same command on base and changed source with local PostgreSQL on port 54339 and `REQUIRE_PG=1`:

```sh
bun run sim --only network,slop,safety,audit --json ../gates.json
```

Both revisions pass all 133 blocking gates, across 153 gate records.
All blocking results and values are identical, and both runs have eight existing tracked misses.
Only two tracked event fingerprints change:

| Fingerprint | Before | After |
|---|---|---|
| Network invariant run, seed 3, 10 days | `24bb81f068060b33` | `6843aecf34a5c2e2` |
| Slop live runs, seeds 21–22, 30 days | `eaeaf7bbe8c99c81` | `cc46d9b1d6eadb9c` |

Replaying those three official worlds and removing only `inReplyTo` restores both exact original fingerprints.
The official fingerprint already excludes run start, run end, and changing engine run IDs.
All other metrics match after normalizing the generated run ID.
The Slop seed-21 report removes one undelivered acceptance: 36 becomes 35, and ignored changes from five to six.
The Network and Slop seed-22 response reports are unchanged.

| Block | Base seconds | Changed seconds |
|---|---:|---:|
| Network | 187.9 | 142.4 |
| Slop | 34.3 | 27.3 |
| Safety | 9.6 | 6.6 |
| Audit | 23.9 | 16.0 |
| Total | 255.7 | 192.3 |

Wall times are observations from a shared machine, not performance evidence.
The agent's one full-simulation run was used earlier; this qualification runs the affected blocks under the AGENTS.md machine-load rule.

The seven integration worlds have zero invariant violations and runtime errors.
The wider 210-world comparison retains six existing `decliner_exposed` violations in four StubNetwork worlds.
Seed 18 has two at both 10 and 14 days; seed 22 has one at both horizons.
Their full normalized traces and complete invariant metrics are identical before and after.
The remaining 206 worlds have zero violations.
Every measured world has zero runtime errors, minor contacts, and canary leaks before and after.
The official safety gates remain clean.

## Regression and validation

One new integration case runs seven complete worlds: a late reply, a longer horizon, STOP before delivery, reactions, and three consent worlds.
It checks actual channel evidence, response counts, and old-log replay behavior.
The unmodified policy agent supplies all reply decisions, delays, text, and reactions.

```sh
bun test --conditions eliza-source --timeout 120000 packages/sim/test/delivered-responses.integration.test.ts
bun run typecheck
bun run test:integration
bun run test:e2e
```

The new case fails on base: 0 pass, 1 fail, 1 assertion; 1080.65 ms for the case, 1199 ms overall.
It passes after the fix: 1 pass, 0 fail, 1 assertion; 1036.57 ms for the case, 1090 ms overall.
All four TypeScript configurations pass.
The full integration run records 676 pass, 8 skip, 6 fail, and 13,742 assertions in 387.42 seconds.
The new case passes there in 990.15 ms.
The same six Windows failures occur on the recorded base qualification, with identical test names and underlying causes:

- Wrangler cannot spawn `/bin/bash` in this Windows configuration.
- The boot test receives SIGTERM exit status 143 instead of its expected zero.
- Four site-build checks expect a slash-form `.well-known/agent-skills/index.json` path against Windows-native paths.

These failures are retained and reported, not waived as passes.
The security suite is included in the integration command; none of its checks fails.
Eight optional cleanup reconciliation cases are skipped.
E2E records 42 pass, 1 optional browser-SDK skip, 0 fail, and 654 assertions in 31.17 seconds.
No browser automation is required for those HTTP and database tests.

## llm_evidence and agent_clients

Real model qualification is N/A for this deterministic simulator accounting change.
The measured policy agent and scripted Slop agent make no model calls.
Model calls: zero; model cost: $0; sampling settings: N/A.
This is not evidence about model quality or member-facing client acceptance.

| Client or runtime | Version | Provider/model | Result |
|---|---|---|---|
| Codex desktop, authoring | 26.1103.3517.0 | OpenAI; exact model identifier unavailable | Direct GitHub API and CLI workflow |
| Bun on Windows | 1.4.2 | No model | Paired worlds, gates and tests above |
| PowerShell | 7.6.9 | No model | Local orchestration |
| PostgreSQL | 16.15 | No model | Task-local database on port 54339 |
| Other agent clients | Not tested | N/A | No changed member-facing workflow |

The operator forbids computer use; no browser or desktop automation was used.
No live messages, deployment flags, production data, or credentials are used in the evidence.
This changes reported counts, not actual meeting or matching outcomes.
Old logs retain their old interpretation; they cannot gain delivery evidence retroactively.
The result does not claim exhaustive coverage of every custom persona agent.

## Reproduce the wider comparison

Save the first program below outside the repository as `response-delivery-measure.ts`.
Save the second as `response-delivery-compare.ts`.
Use separate base and changed checkouts with the same locked dependencies.
From the changed checkout, with both programs and output files in its parent directory, run:

```sh
bun run --conditions eliza-source ../response-delivery-measure.ts ../base > ../response-delivery-before.jsonl
bun run --conditions eliza-source ../response-delivery-measure.ts . > ../response-delivery-after.jsonl
bun run ../response-delivery-compare.ts
```

Expected: 210 paired worlds, the table above, and an empty `changes` array.


```ts
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root=resolve(process.argv[2]!);
const from=(p:string)=>import(pathToFileURL(resolve(root,p)).href);
const { runWorld, DEFAULT_START }=await from("packages/sim/src/world.ts");
const { generatePersonas }=await from("packages/sim/src/generator.ts");
const { StubNetwork }=await from("packages/sim/src/stubNetwork.ts");
const { ConsentNetwork }=await from("packages/network/src/network.ts");
const { PolicyPersonaAgent }=await from("packages/sim/src/agent/policy.ts");
const { computeMetrics }=await from("packages/sim/src/judge/metrics.ts");
const DAY=86400000, hash=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
async function run(seed:number,days:number,kind:string,actions?:any[]) {
  const observed:any[]=[];
  const policy=new PolicyPersonaAgent(DEFAULT_START,{reactions:kind==="reactions"});
  const agent={mode:"policy",joinMessage:(ctx:any)=>policy.joinMessage(ctx),initiative:(ctx:any)=>policy.initiative(ctx),async respond(ctx:any,msg:any){const reply=await policy.respond(ctx,msg);observed.push({memberId:msg.memberId,messageId:msg.id,at:ctx.now,reply});return reply;}};
  const w=await runWorld({seed,days,runId:`responses-${kind}-${seed}-${days}`,writeLog:false,agent,actions,
    personas:generatePersonas({n:40,seed,joinSpreadDays:1,minorShare:0,adversarialRate:0}),
    network:kind.startsWith("consent")?new ConsentNetwork({seed,review:"auto",growth:false,plans:false}):new StubNetwork({seed})});
  const expected={invitesDelivered:0,accepted:0,declined:0,countered:0,ignored:0,acceptRate:0,probes:{asked:0,yes:0,no:0,ignored:0}};
  const missed={accepted:0,declined:0,countered:0,probeYes:0,probeNo:0,pending:0,suppressed:0};
  const inbound=w.channel.all().filter((m:any)=>m.direction==="inbound"&&m.status==="delivered");
  let linked=0,linkedReactions=0,wrongLinks=0;
  for(const x of observed){
    const d=x.reply;
    const matches=d.action==="reply"&&d.text?inbound.filter((m:any)=>m.memberId===x.memberId&&m.ts===x.at+d.delayMs&&m.body===d.text):[];
    if(matches.length>1)throw new Error("Ambiguous channel evidence");
    const delivered=matches.length===1;
    if(delivered&&matches[0].meta?.inReplyTo===x.messageId){linked++;if(d.reaction)linkedReactions++;}
    if(delivered&&matches[0].meta?.inReplyTo!==undefined&&matches[0].meta.inReplyTo!==x.messageId)wrongLinks++;
    if(d.messageType!=="proposal"&&d.messageType!=="probe")continue;
    if(!delivered&&d.action==="reply"){
      if(x.at+d.delayMs>DEFAULT_START+days*DAY)missed.pending++;
      else if(w.channel.isOptedOut(x.memberId))missed.suppressed++;
      if(d.messageType==="probe") {if(d.intent==="probe_yes")missed.probeYes++;else if(d.intent==="probe_no")missed.probeNo++;}
      else if(d.decision==="accept")missed.accepted++;else if(d.decision==="decline")missed.declined++;else if(d.decision==="counter")missed.countered++;
    }
    if(d.messageType==="probe"){
      expected.probes.asked++;
      if(delivered&&d.intent==="probe_yes")expected.probes.yes++;else if(delivered&&d.intent==="probe_no")expected.probes.no++;else expected.probes.ignored++;
    } else {
      expected.invitesDelivered++;
      if(!delivered||d.intent==="ignore")expected.ignored++;else if(d.decision==="accept")expected.accepted++;else if(d.decision==="decline")expected.declined++;else if(d.decision==="counter")expected.countered++;
    }
  }
  expected.acceptRate=expected.invitesDelivered?Math.round((expected.accepted+expected.countered)/expected.invitesDelivered*1000)/1000:0;
  const normalized=structuredClone(w.records);
  for(const r of normalized){
    if(r.type==="run_start")delete r.config.replyTracking;
    if(r.type==="message"&&r.msg.meta){delete r.msg.meta.inReplyTo;if(!Object.keys(r.msg.meta).length)delete r.msg.meta;}
    if(r.type==="run_end")delete r.wallMs;
  }
  const legacy=computeMetrics(normalized);
  const {responses,...otherMetrics}=w.metrics;
  console.log(JSON.stringify({seed,days,kind,correct:JSON.stringify(responses)===JSON.stringify(expected),responses,expected,missed,linked,linkedReactions,wrongLinks,
    trace:hash(normalized),otherMetrics:hash(otherMetrics),legacy:hash(legacy),metrics:hash(w.metrics),personas:hash(w.personas),
    invariants:w.metrics.invariants.total,invariantRules:w.metrics.invariants.byRule,errors:w.metrics.errors,minorContacts:w.metrics.safety.minorContacts,canaryLeaks:w.metrics.privacy.canaryLeaks}));
  return observed;
}
for(let seed=1;seed<=30;seed++){
  await run(seed,3,"stub");
  const initial=await run(seed,10,"stub");
  await run(seed,14,"stub");
  await run(seed,10,"reactions");
  const consent=await run(seed,10,"consent");
  const probe=consent.find(x=>x.reply.messageType==="probe"&&x.reply.action==="reply"&&x.reply.delayMs>0);
  if(!probe)throw new Error(`Missing consent probe for seed ${seed}`);
  await run(seed,10,"consent-stopped",[{at:probe.at+probe.reply.delayMs/2,action:{do:"opt_out",persona:probe.memberId}}]);
  const target=initial.find(x=>x.reply.messageType==="proposal"&&x.reply.action==="reply"&&x.reply.delayMs>0);
  if(!target)throw new Error(`Missing STOP target for seed ${seed}`);
  await run(seed,10,"stopped",[{at:target.at+target.reply.delayMs/2,action:{do:"opt_out",persona:target.memberId}}]);
}
```

```ts
const read=async(p:string)=>(await Bun.file(p).text()).trim().split(/\r?\n/).map(x=>JSON.parse(x));
const b=await read("../response-delivery-before.jsonl"),a=await read("../response-delivery-after.jsonl");
if(b.length!==210||a.length!==210)throw new Error("Incomplete measurement");
const groups:Record<string,any>={},changes:any[]=[];
for(let i=0;i<b.length;i++){
  const x=b[i],y=a[i];
  for(const k of ["seed","days","kind","trace","otherMetrics","legacy","personas","expected","missed","invariants","invariantRules","errors","minorContacts","canaryLeaks"])
    if(JSON.stringify(x[k])!==JSON.stringify(y[k]))changes.push({kind:x.kind,seed:x.seed,days:x.days,key:k});
  if(!y.correct||y.wrongLinks)changes.push({kind:x.kind,seed:x.seed,days:x.days,key:"incorrect counter or link"});
  const g=groups[`${x.kind}/${x.days}`]??={worlds:0,wrongBefore:0,wrongAfter:0,unchanged:0,missing:{accepted:0,declined:0,countered:0,probeYes:0,probeNo:0,pending:0,suppressed:0},linked:0,linkedReactions:0,invariants:0,errors:0,minorContacts:0,canaryLeaks:0};
  g.worlds++;if(!x.correct)g.wrongBefore++;if(!y.correct)g.wrongAfter++;if(x.metrics===y.metrics)g.unchanged++;
  for(const k of Object.keys(g.missing))g.missing[k]+=x.missed[k];
  for(const k of ["linked","linkedReactions","invariants","errors","minorContacts","canaryLeaks"])g[k]+=y[k];
}
console.log(JSON.stringify({worlds:b.length,groups,changes},null,2));if(changes.length)process.exitCode=1;
```
