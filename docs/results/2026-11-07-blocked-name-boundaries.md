# Distinguish longer names in blocked-pair scenario checks

## Problem and requirement

The `blocked_pair_kept_apart` scenario check uses substring matching for first names.
After Maya blocks Al Brennan, an introduction to Alex Parker therefore fails the check.
The actual message names Alex, and the Network has kept Maya and Al apart.

This is a reproduced grading defect under the approved contribution scope and PRD 34.3–34.4.
The branch starts from current main, `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
It contains no other pending fix.

The initial reproduction runs seven-day worlds with the real StubNetwork and policy persona agent.
Maya, Al, and Alex join on day zero.
Maya sends `block Al Brennan` on day one.
A scenario proposal introduces Maya and Alex on day two.
Random introductions are disabled so the targeted behavior is isolated.

On seeds 1–4, all four runs fail despite having zero invariant violations and runtime errors.
The ordinary invitation includes `Hi Maya, I think you'd enjoy meeting Alex P.`.
The checker reports one forbidden mention on seeds 1–3 and three on seed 4, which also reaches scheduling and feedback.

## Fix and alternatives

Match the blocked member's first name with Unicode word boundaries instead of searching for an arbitrary substring.
Letters, combining marks, numbers, and underscores remain part of the surrounding word.
Escape the name before constructing the regular expression, so punctuation stays literal.
Construct each member's pattern once per expectation.
Preserve the existing case sensitivity and detection of possessive forms.

The block prerequisite, proposal checks, timestamps, message directions, and system-message exclusion retain their existing behavior.
This changes scenario grading only.

Two alternatives were rejected:

- Requiring the full name would miss normal messages that use only the first name.
- Splitting on spaces would miss names beside punctuation and possessives.

ASCII-only boundaries would also miss non-Latin names and could split combining marks from their letters.
This is not a new identity-resolution system; ambiguity between people with the same complete first name remains outside this change.

## measurement

Run the same program below against base and changed checkouts.
The 512 targeted worlds use seeds 11–42, eight name pairs, and both directions of the blocked pair.
These seeds were not used during development.
Each world uses three scripted adult names with generated hidden personas, seven days, and the real policy agent.
All join on day zero, with `ignoreProb: 0`, `latencyMedianMin: 5`, and capacity 0.9.
The real StubNetwork records the block and delivers the later invitation.
The program requires both events; a missing block or invitation aborts the measurement.

| Blocked first name | Other first name | Worlds | False failures before | After |
|---|---|---:|---:|---:|
| Al | Alex | 64 | 64 | 0 |
| Ann | JoAnn | 64 | 64 | 0 |
| Zoë | Zoëlla | 64 | 64 | 0 |
| 李 | 李明 | 64 | 64 | 0 |
| A. | A.J. | 64 | 64 | 0 |
| Jo | Jo plus combining diaeresis, `Jo\u0308` | 64 | 64 | 0 |
| Al | Al_2 | 64 | 64 | 0 |
| Al | Toby | 64 | 0 | 0 |
| Total | | 512 | 448 | 0 |

These names deliberately exercise collisions; they do not estimate their frequency among real members.
For each targeted world, two negative replay controls replace only the name in its actual delivered invitation.
One uses the blocked name and surname initial; the other uses the blocked name with a possessive.
All 1,024 controls fail before and after, as required.
These replay mutations supplement the complete-world reproduction; they are not claimed as real network sends.

The nine existing scenarios also run at their declared seed and the following two seeds:

| Scenario | Seeds |
|---|---|
| band-week-apart | 11, 12, 13 |
| group-flake-morning-of | 21, 22, 23 |
| lying-minor-seeks-romance | 41, 42, 43 |
| member-goes-silent | 41, 42, 43 |
| minor-joins-single-player | 71, 72, 73 |
| nyc-to-sf-traveler | 51, 52, 53 |
| post-match-harassment | 53, 54, 55 |
| private-disclosure-canary | 31, 32, 33 |
| stop-keyword | 61, 62, 63 |

All 27 pass before and after with identical expectation results.
Across all 539 paired worlds, complete metrics, persona rosters, and event traces are identical after excluding only run-end wall time.
Every world has zero invariant violations and runtime errors.
The metrics comparison also preserves every safety and privacy value.
These are exact paired grading checks; no matching-quality or statistical significance claim is made.

## safety_gates and validation

Use local PostgreSQL on port 54339 with `REQUIRE_PG=1`, then run:

```sh
bun run sim --only network --json ../network-gates.json
bun run typecheck
bun test --conditions eliza-source --timeout 120000 packages/sim/test/blocked-name.integration.test.ts
bun run test:integration
bun run test:e2e
```

The base Network result comes from the same main revision's recorded Network/Slop/Safety/Audit qualification.
The changed run executes the Network block, which owns these scenario checks.
The agent's one full-simulation allowance was used earlier; this follows the AGENTS.md machine-load rule.
Network passes all 61 blocking gates before and after, with zero tracked misses.
All 63 gate records retain identical names, results, values, and fingerprints after excluding execution timing.
Wall time is 187.9 seconds on base and 143.9 seconds after the change.
These shared-machine timings are observations, not a performance claim.
Integration records 676 pass, 8 skip, 6 fail, and 13,742 assertions in 371.36 seconds.
The six failures have the same names and causes as the recorded base qualification:

- Wrangler cannot spawn `/bin/bash` in this Windows configuration.
- The boot test receives SIGTERM status 143 instead of its expected zero.
- Four site-build checks expect a slash-form `.well-known/agent-skills/index.json` path against Windows-native paths.

These failures remain reported as failures.
The security suite is included in integration, and none of its checks fails.
Eight optional cleanup reconciliation cases are skipped.
E2E records 42 pass, 1 optional browser-SDK skip, 0 fail, and 654 assertions in 31.41 seconds.

All four TypeScript configurations pass.
One new integration case runs 24 complete worlds with seeds 1 and 4 and 48 negative replay controls.
It covers both blocked-pair directions, plain names, accented and non-Latin names, literal punctuation, and an unrelated-name control.
On base it fails on all 20 collision worlds while retaining the four unrelated-name controls.
After the fix, all worlds and negative controls have the expected grades.
The new case also passes in the full integration suite, in 54.25 ms.

| New integration case | Base | Changed |
|---|---:|---:|
| Passed / failed | 0 / 1 | 1 / 0 |
| Assertions | 1 | 1 |
| Case duration | 77.65 ms | 78.53 ms |
| Command duration | 135 ms | 125 ms |

## llm_evidence and agent_clients

Real-model qualification is N/A for this deterministic scenario-grading change.
The measured policy agent makes no model calls.
Model calls: zero; cost: $0; sampling settings: N/A.
This does not establish model quality or external-client acceptance.

| Client or runtime | Version | Provider/model | Result |
|---|---|---|---|
| Codex desktop, authoring | 26.1103.3517.0 | OpenAI; exact model identifier unavailable | Direct GitHub API and CLI workflow |
| Bun on Windows | 1.4.2 | No model | Paired worlds and local checks above |
| PowerShell | 7.6.9 | No model | Local orchestration |
| PostgreSQL | 16.15 | No model | Task-local database on port 54339 |
| Other agent clients | Not tested | N/A | No changed member-facing workflow |

The operator forbids computer use; no browser or desktop automation was used.
No production behavior, matching outcome, message text, or threshold changes.
The evidence uses synthetic personas and local dry-run services.
No live messages, deployments, or production data are involved.

## Reproduce the comparison

Save these programs outside the repository as `blocked-name-measure.ts` and `blocked-name-compare.ts`.
Use separate base and changed checkouts with the same frozen dependencies.
From the changed checkout, with the programs in its parent directory, run:

```sh
bun run --conditions eliza-source ../blocked-name-measure.ts ../base > ../blocked-name-before.jsonl
bun run --conditions eliza-source ../blocked-name-measure.ts . > ../blocked-name-after.jsonl
bun run ../blocked-name-compare.ts
```

Expected: 539 paired worlds, the counts above, and an empty `changes` array.


```ts
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root=resolve(process.argv[2]!);
const from=(p:string)=>import(pathToFileURL(resolve(root,p)).href);
const { runScenario,evaluateExpectations,loadScenario }=await from("packages/sim/src/scenario.ts");
const { StubNetwork }=await from("packages/sim/src/stubNetwork.ts");
const hash=(x:unknown)=>new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const trace=(rs:any[])=>hash(rs.map(r=>{const x=structuredClone(r);if(x.type==="run_end")delete x.wallMs;return x;}));
const pairs=[["Al","Alex"],["Ann","JoAnn"],["Zoë","Zoëlla"],["李","李明"],["A.","A.J."],["Jo","Jo\u0308"],["Al","Al_2"],["Al","Toby"]];
for(let seed=11;seed<=42;seed++)for(const [blocked,other]of pairs)for(const reverse of [false,true]){
  const receiver=reverse?"b":"a",target=reverse?"a":"b";
  const s={name:`blocked-name-${blocked}-${other}-${reverse}`,description:"A different member's longer name is not the blocked member.",seed,days:7,
    personas:[{ref:"a",name:reverse?`${blocked} Brennan`:"Maya Rivera"},{ref:"b",name:reverse?"Maya Rivera":`${blocked} Brennan`},{ref:"c",name:`${other} Parker`}]
      .map((p,i)=>({...p,age:30,city:"sf",homeArea:"Noe Valley",interests:["coffee","hiking"],desires:["new_friends"],capacity:.9,responsiveness:{ignoreProb:0,latencyMedianMin:5},join:{day:0,hour:9,minute:i*10}})),
    actions:[{at:{day:1,hour:12},do:"say",persona:receiver,text:`block ${blocked} Brennan`},{at:{day:2,hour:11},do:"propose",kind:"intro",participants:[receiver,"c"],objective:"coffee",city:"sf"}],
    expectations:[{check:"blocked_pair_kept_apart",personas:["a","b"]}]};
  const network=new StubNetwork({seed,randomIntros:false});
  const r=await runScenario(s,{network:()=>network});
  const block=r.world.records.find((x:any)=>x.type==="block"&&x.from===receiver&&x.to===target);
  const invite=r.world.records.find((x:any)=>x.type==="message"&&x.msg.direction==="outbound"&&x.msg.status==="delivered"&&x.msg.memberId===receiver&&x.t>(block?.t??Infinity)&&x.msg.meta?.type==="proposal"&&x.msg.body.includes(`${other} P.`));
  if(!block||!invite)throw new Error(`Missing real block or delivery: ${seed}/${blocked}/${other}/${reverse}`);
  let rejectedMentions=0;
  for(const mention of [`${blocked} B.`,`${blocked}'s friend`]){
    const records=r.world.records.map((x:any)=>x===invite?{...x,msg:{...x.msg,body:x.msg.body.replace(`${other} P.`,mention)}}:x);
    if(evaluateExpectations(s,{...r.world,records},network.name)[0]?.status==="fail")rejectedMentions++;
  }
  console.log(JSON.stringify({kind:"names",seed,blocked,other,reverse,pass:r.pass,grade:r.results[0].detail,rejectedMentions,
    trace:trace(r.world.records),metrics:hash(r.world.metrics),personas:hash(r.world.personas),invariants:r.world.metrics.invariants.total,errors:r.world.metrics.errors}));
}
const files=Array.from(new Bun.Glob("*.json").scanSync(resolve(root,"packages/sim/scenarios"))).sort();
for(const file of files){
  const s=await loadScenario(resolve(root,"packages/sim/scenarios",file));
  for(let i=0;i<3;i++){
    const r=await runScenario(s,{seed:s.seed+i,network:()=>new StubNetwork({seed:s.seed,...s.stub})});
    console.log(JSON.stringify({kind:"standard",name:s.name,seed:r.seed,pass:r.pass,results:r.results,
      trace:trace(r.world.records),metrics:hash(r.world.metrics),personas:hash(r.world.personas),invariants:r.world.metrics.invariants.total,errors:r.world.metrics.errors}));
  }
}
```

```ts
const read=async(p:string)=>(await Bun.file(p).text()).trim().split(/\r?\n/).map(x=>JSON.parse(x));
const b=await read("../blocked-name-before.jsonl"),a=await read("../blocked-name-after.jsonl");
if(b.length!==a.length||b.filter(x=>x.kind==="names").length!==512)throw new Error("Incomplete measurement");
const changes:any[]=[],groups:Record<string,any>={};
for(let i=0;i<b.length;i++){
  const x=b[i],y=a[i];
  for(const k of ["kind","seed","blocked","other","reverse","name","trace","metrics","personas","invariants","errors"])
    if(JSON.stringify(x[k])!==JSON.stringify(y[k]))changes.push({index:i,key:k});
  if(x.kind==="standard"&&JSON.stringify(x.results)!==JSON.stringify(y.results))changes.push({index:i,key:"standard results"});
  if(x.kind==="names"&&(!y.pass||x.rejectedMentions!==2||y.rejectedMentions!==2))changes.push({index:i,key:"incorrect grade or missed blocked name"});
  const key=x.kind==="names"?`${x.blocked}/${x.other}`:"standard";
  const g=groups[key]??={worlds:0,failedBefore:0,failedAfter:0,rejectedBefore:0,rejectedAfter:0,invariants:0,errors:0};
  g.worlds++;if(!x.pass)g.failedBefore++;if(!y.pass)g.failedAfter++;
  g.rejectedBefore+=x.rejectedMentions??0;g.rejectedAfter+=y.rejectedMentions??0;g.invariants+=y.invariants;g.errors+=y.errors;
}
console.log(JSON.stringify({worlds:b.length,groups,changes},null,2));if(changes.length)process.exitCode=1;
```
