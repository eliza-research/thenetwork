# Friends and Peon population count validation (2026-11-10)

## Problem, requirement and fix

Friends and Peon accept negative, non-finite and fractional population counts. Their generators use numeric loop comparisons without validating the count. A negative or `NaN` count produces an empty member or job list; 2.5 produces three members or jobs per city. The real CLIs return exit 0 and write a report for these malformed configurations. Blank strings also become zero through `Number` coercion.

This fixes a reproduced simulator defect under the approved Slop scope, CONTRIBUTING 3.1 and PRD 34.3's repeatable generated populations. Base: current upstream main `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. The branch contains no other pending contribution.

Validate Friends `n` and Peon `perCity`/`jobsPerCity` as non-negative safe integers at generation, before allocation or random draws. Reject blank or missing values in those CLIs through the same validation. Preserve explicit zero, defaults, valid integer syntax and the existing supplied-population path (generation options are unused when callers supply personas/populations). Slop's generator already rejects negative, non-finite and fractional numeric counts through array construction; its CLI parsing is outside this fix.

For example, seed 5 and two weeks:

- Friends `--n NaN` and `--n -1` previously wrote successful reports with zero members; `--n 2.5` created three.
- Peon `--per-city 2.5 --jobs 4` created six candidates in two cities; `--per-city 12 --jobs 2.5` created six jobs.
- Invalid configurations now throw a count-specific diagnostic and the CLI exits nonzero without writing a new report. `--n 0`, `--per-city 0` and `--jobs 0` remain valid empty-world controls.

Two alternatives were considered:

1. Validate only in the CLIs. That leaves native worlds and other generator callers accepting malformed counts.
2. Floor, clamp or replace the count with a default. That silently changes the requested experiment size. Rejection preserves the distinction between malformed input and an explicit zero.

No new helper, dependency, population cap, model parameter, threshold or persisted field is added. The one integration case drives the real CLIs, actual worlds and native matchers; it does not mock generation, matching or outcomes.

## measurement

The same measurement program runs on both revisions: **184 workflows per revision**.

| Group | Cases | Before | After |
| --- | ---: | --- | --- |
| Valid native worlds | 106 | accepted | accepted; full measured records identical |
| Valid real CLI reports | 42 | exit 0; report written | same complete JSON reports |
| Invalid native counts | 12 | accepted, empty or rounded-up populations | rejected with count diagnostic |
| Invalid CLI configurations | 24 | exit 0; report written | nonzero exit; diagnostic; no new report |

All **148 valid workflow records are identical**; all **36 malformed workflows now reject**. The comparator checks entire valid rows, including all metrics and counts, not selected headline fields. Populations, flow arrays and output ledgers use SHA-256 with Map/Set contents included; no output fields are normalized away. CLI comparisons use the complete parsed JSON report, which contains no execution duration.

Native settings:

- Friends: seeds 5–8, four weeks, pack/random/oracle, each at `n=0,1,80` (36 worlds); the same seeds with the random arm and default 400 members (four); one supplied 24-person seed-5 population with unused `n=NaN` (one).
- Peon: seeds 13–16, four weeks, pack/keyword/oracle, each with `(perCity,jobsPerCity)` equal to `(0,0),(0,8),(12,0),(12,4),(80,30)` (60 worlds); the same seeds with keyword and default 400 candidates/80 jobs per city (four); one supplied seed-5 population with 24 candidates/eight jobs per city and unused invalid generation counts (one).
- Native malformed cases: seed 5, four weeks, Friends random and Peon keyword; each of the three count fields receives `NaN`, negative infinity, -1 and 2.5 (12 worlds).

CLI settings:

- Valid: seeds 5 and 7, two weeks; each count flag receives `0`, `1`, `12`, `1e1`, `0x10`, whitespace-padded `12`, or is omitted (42 reports). Friends uses random; Peon uses keyword, with the other count fixed at 12 candidates or four jobs per city.
- Invalid: seed 5, two weeks; each flag receives `NaN`, `-Infinity`, `-1`, `2.5`, `bad`, empty string, whitespace only, or no following value (24 reports).

Positive infinity and an unsafe positive integer are additionally checked by the regression after validation is installed. They are not executed on the unvalidated base. No claim is made about base completion for those inputs or practical resource limits for very large valid populations.

Focused regression command, same file and method before and after:

```text
bun test --conditions eliza-source packages/sim/test/app-population-counts.integration.test.ts
Before: 0 pass, 1 fail, 1 assertion; 70.21ms case / 124.00ms suite
After:  1 pass, 0 fail, 78 assertions; 1170.62ms case / 1274.00ms suite
```

The base fails on the first actual CLI exit-code assertion. The corrected case checks 18 invalid CLI invocations, 18 invalid native counts and six valid population-size observations. These are deterministic input-validation comparisons, not estimates of matching lift or a statistical significance claim.

## safety_gates

The same `bun run sim --only peon,friends --json <output>` command passes **45/45 blocking gates before and after**. All **49 complete gate records** are identical after removing execution-duration fields, including both world fingerprints. The four tracked records retain one off-target Friends undetected-harm metric. Runtime: 149.4s before, 93.7s after. The official worlds use Peon seeds 13–16 (400 candidates/80 jobs per city, eight weeks) and Friends seeds 5–8 (400 NYC personas, eight weeks), plus each block's existing harness and conformance checks.

Every safety field is unchanged in all valid paired workflows. Declared-minor proposals/contacts in Friends, and minors proposed/matched in Peon, remain zero. The broad matrix includes deliberately unsafe baseline arms and does not establish zero harm in every world:

| Native observations, summed across valid worlds | Before | After |
| --- | ---: | ---: |
| Friends hidden-minor contacts | 10 | 10 |
| Friends adversary / known-adversary contacts | 167 / 87 | 167 / 87 |
| Peon scam reach | 214 | 214 |
| Peon unverified / missing-pay-range intros | 3793 / 3152 | 3793 / 3152 |
| Peon fake hires | 3 | 3 |

These sums count observations across test worlds, not unique people. The fix does not claim to repair those outcomes. No matcher, generated distribution, consent policy, hold rule or quality/safety threshold changes for valid inputs.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13819 expect() calls
Ran 690 tests across 69 files. [558.11s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [62.60s]
```

The one optional SDK/browser test remains skipped.

## Reproduction

Use Bun 1.4.2 and pinned dependencies. Check out the base SHA above and the PR commit in separate worktrees; run `bun install --frozen-lockfile` in both. For the failing regression, copy only the final test file into the base checkout. Run the focused command above from each checkout.

Save the complete measurement and comparison programs below beside the checkouts:

```text
bun app-population-counts-measure.ts <base-root> app-population-counts-before.json
bun app-population-counts-measure.ts <fixed-root> app-population-counts-after.json
bun app-population-counts-compare.ts app-population-counts-before.json app-population-counts-after.json app-population-counts-comparison.json
```

The comparison fails if any valid result changes or any invalid case still succeeds. Its output lists each malformed configuration, original generated counts or CLI success, and the corrected rejection. The programs use temporary files for CLI reports.

For qualification, run from both checkouts:

```text
bun run sim --only peon,friends --json ../app-population-counts-gates-<before-or-after>.json
```

Then run `bun run typecheck`, `bun run test:integration` and `bun run test:e2e` on the corrected checkout. Integration/E2E use local PostgreSQL 16.15 on port 54339. This run cleared provider keys and all live-send/deploy flags. No production data, live messages or deployments were used.

### measure.ts

```ts
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
const [rootArg, output] = process.argv.slice(2), root = resolve(rootArg!);
const from = (p:string) => import(pathToFileURL(resolve(root,"packages/sim/src/apps",p)).href);
const {runFriendsWorld}=await from("friends/world.ts"), {BASELINES}=await from("friends/baselines.ts"), {friendsPackMatcher}=await from("friends/packMatcher.ts");
const {friendsMetrics}=await from("friends/metrics.ts"), {generateFriendsPersonas}=await from("friends/persona.ts");
const {runPeonWorld}=await from("peon/world.ts"), {keywordMatcher,packMatcher,oracleMatcher}=await from("peon/baselines.ts");
const {peonMetrics}=await from("peon/metrics.ts"), {generatePeonPopulation}=await from("peon/persona.ts");
const encode=(x:any)=>JSON.stringify(x,(_,v)=>v instanceof Map?[...v]:v instanceof Set?[...v]:v);
const hash=(x:any)=>new Bun.CryptoHasher("sha256").update(encode(x)).digest("hex");
const rows:any[]=[];
async function native(app:string,seed:number,arm:string,opts:any,id:string,valid=true) {
  const row:any={type:"native",app,seed,arm,id,valid};
  try {
    if(app==="friends") {
      const matcher=arm==="pack"?friendsPackMatcher():BASELINES[arm];
      const r=runFriendsWorld({seed,weeks:4,...opts,matcher});
      Object.assign(row,{accepted:true,counts:{members:r.world.personas.length},metrics:friendsMetrics(r),
        populationHash:hash(r.world.personas),flowsHash:hash(r.flows),outputsHash:hash([r.meetups,r.contacts,r.valueDays,r.world.state,r.world.hours,r.world.hoursByWeek,r.world.bond,r.world.mutual,r.world.disliked,r.world.meetupsTogether,r.world.selfTogether,r.world.lastEnjoy,r.world.selfHangouts])});
    } else {
      const matcher={keyword:keywordMatcher,pack:packMatcher,oracle:oracleMatcher}[arm]!;
      const r=await runPeonWorld({seed,weeks:4,...opts,matcher});
      Object.assign(row,{accepted:true,counts:{candidates:r.world.pop.candidates.length,jobs:r.world.pop.jobs.length},metrics:peonMetrics(r),
        populationHash:hash(r.world.pop),flowsHash:hash(r.flows),outputsHash:hash([r.hires,r.audits,r.heldCompanies,r.assessed,r.recruiterHours,r.closed,r.world.state])});
    }
  } catch(e) {Object.assign(row,{accepted:false,error:String(e)});}
  rows.push(row);
}
for(const seed of [5,6,7,8]) {
  for(const arm of ["pack","random","oracle"]) for(const n of [0,1,80]) await native("friends",seed,arm,{n},`n=${n}`);
  await native("friends",seed,"random",{},"defaults");
}
for(const seed of [13,14,15,16]) {
  for(const arm of ["pack","keyword","oracle"]) for(const [perCity,jobsPerCity] of [[0,0],[0,8],[12,0],[12,4],[80,30]])
    await native("peon",seed,arm,{perCity,jobsPerCity},`c=${perCity},j=${jobsPerCity}`);
  await native("peon",seed,"keyword",{},"defaults");
}
await native("friends",5,"random",{n:NaN,personas:generateFriendsPersonas({seed:5,n:24})},"supplied population ignores count");
await native("peon",5,"keyword",{perCity:NaN,jobsPerCity:NaN,pop:generatePeonPopulation({seed:5,perCity:24,jobsPerCity:8})},"supplied population ignores counts");
for(const field of ["friends-n","peon-candidates","peon-jobs"]) for(const value of [NaN,-Infinity,-1,2.5])
  await native(field==="friends-n"?"friends":"peon",5,field==="friends-n"?"random":"keyword",
    field==="friends-n"?{n:value}:{perCity:field==="peon-candidates"?value:12,jobsPerCity:field==="peon-jobs"?value:4},`${field}=${String(value)}`,false);
await Bun.write(output!,JSON.stringify(rows,null,2)+"\n");
console.log(`Native worlds complete: ${rows.length}`);
const dir=await mkdtemp(join(tmpdir(),"app-population-count-measure-"));
let sequence=0;
async function cli(field:string,seed:number,raw:string|undefined,valid:boolean,missing=false) {
  const app=field==="friends-n"?"friends":"peon", file=join(dir,`${sequence++}.json`);
  const args=app==="friends"?["--only","random"]:["--arms","keyword",...(field==="peon-candidates"?["--jobs","4"]:["--per-city","12"])];
  const flag=field==="friends-n"?"--n":field==="peon-candidates"?"--per-city":"--jobs";
  if(raw!==undefined) args.push(flag,raw);
  args.push("--seeds",String(seed),"--weeks","2","--json",file);
  if(missing) args.push(flag);
  const p=Bun.spawn([process.execPath,resolve(root,`packages/sim/src/apps/${app}/cli.ts`),...args],{cwd:root,stdout:"pipe",stderr:"pipe"});
  const [exit,stdout,stderr]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);
  const report=await Bun.file(file).exists();
  rows.push({type:"cli",app,seed,field,raw:missing?"<missing>":raw??"<default>",valid,exit,report,
    ...(report?{metrics:await Bun.file(file).json()}:{diagnostic:stderr.includes("non-negative safe integer")}),outputPrinted:stdout.includes("Metric")});
}
for(const field of ["friends-n","peon-candidates","peon-jobs"]) {
  for(const seed of [5,7]) for(const raw of ["0","1","12","1e1","0x10"," 12 ",undefined]) await cli(field,seed,raw,true);
  for(const raw of ["NaN","-Infinity","-1","2.5","bad",""," "]) await cli(field,5,raw,false);
  await cli(field,5,undefined,false,true);
}
await Bun.write(output!,JSON.stringify(rows,null,2)+"\n");
console.log(JSON.stringify({rows:rows.length,native:rows.filter(r=>r.type==="native").length,cli:rows.filter(r=>r.type==="cli").length}));
```

### compare.ts

```ts
const [aPath,bPath,out]=process.argv.slice(2),a=await Bun.file(aPath!).json(),b=await Bun.file(bPath!).json();
if(a.length!==184||b.length!==184) throw new Error("Incomplete matrix");
const eq=(x:any,y:any)=>JSON.stringify(x)===JSON.stringify(y);
const valid=[],invalid=[];
for(let i=0;i<a.length;i++) {
  const x=a[i],y=b[i];
  if(!eq([x.type,x.app,x.seed,x.arm,x.id,x.field,x.raw,x.valid],[y.type,y.app,y.seed,y.arm,y.id,y.field,y.raw,y.valid])) throw new Error("Mismatched case");
  if(x.valid) {
    if(!eq(x,y)|| (x.type==="native"?!x.accepted:x.exit!==0||!x.report)) throw new Error(`Changed or unsuccessful valid case ${i}`);
    valid.push(x);
  } else {
    if(x.type==="native") {
      if(!x.accepted||y.accepted||!y.error.includes("non-negative safe integer")) throw new Error(`Unexpected native rejection ${i}`);
    } else if(x.exit!==0||!x.report||y.exit===0||y.report||!y.diagnostic||y.outputPrinted) throw new Error(`Unexpected CLI rejection ${i}`);
    invalid.push({type:x.type,app:x.app,id:x.id??`${x.field}=${JSON.stringify(x.raw)}`,before:x.type==="native"?x.counts:{exit:x.exit,report:x.report},after:x.type==="native"?y.error:{exit:y.exit,report:y.report,diagnostic:y.diagnostic}});
  }
}
const safety:any={};
for(const app of ["friends","peon"]) {
  const rows=valid.filter((x:any)=>x.type==="native"&&x.app===app);
  const names=app==="friends"?["declaredMinorProposals","declaredMinorContacts","hiddenMinorContacts","adversaryContacts","knownAdversaryContacts"]:["minorsMatched","minorsProposed","scamReach","unverifiedIntros","noRangeIntros","fakeHires"];
  safety[app]={worlds:rows.length,totals:Object.fromEntries(names.map(k=>[k,rows.reduce((s:any,r:any)=>s+r.metrics.safety[k],0)])),nonzeroSafetyWorlds:rows.filter((r:any)=>names.some(k=>r.metrics.safety[k]>0)).length};
}
const summary={cases:a.length,validIdentical:valid.length,nativeValid:valid.filter((r:any)=>r.type==="native").length,cliValid:valid.filter((r:any)=>r.type==="cli").length,
  invalidRejected:invalid.length,nativeInvalid:invalid.filter((r:any)=>r.type==="native").length,cliInvalid:invalid.filter((r:any)=>r.type==="cli").length,safety,invalid};
await Bun.write(out!,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify({...summary,invalid:undefined},null,2));
```

## Limits and related work

Zero-size controls retain their existing empty-result metrics, including undefined rates serialized as JSON null. They are not treated as full-scale quality qualification. A supplied population still bypasses unused generator options. No other numeric setting is changed: week counts are addressed in #442 and seed selections in #441. No combined qualification with pending PRs is claimed.

The affected Peon and Friends blocks were run fresh. AGENTS.md's one-full-`bun run sim` allowance per agent was used earlier in this contribution session; no new full-simulation run is claimed.

## llm_evidence

N/A: these generators, native matchers and CLI paths are deterministic; no prompt or model-backed behavior changes. Validation model calls: 0; cost: $0; no model request settings. No real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0 / primary runtime 26.1104.2876.0, Windows, Bun 1.4.2, PostgreSQL 16.15. Authoring provider: OpenAI; exact model identifier: unavailable. Commands and GitHub connector/Git/gh were used directly. No computer/browser use or other agent-client acceptance tests; no external-client compatibility claim.
