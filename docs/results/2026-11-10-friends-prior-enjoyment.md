# Friends invitations use the latest completed meetup (2026-11-10)

## Problem, scope and cause

The Friends simulator can answer a repeat or crew invitation using enjoyment from an older meetup, even though the member attended a newer one. The weekly harness processes proposals by type and priority, not by meeting time. Each held meetup immediately overwrote `lastEnjoy`, so a partner meetup processed later could replace the outcome of a later-dated plan. The next week's invitation then reads the wrong experience. The oracle uses that value in its repeat-answer probability and crew opt-in probability.

This is a reproduced simulation defect within the approved Slop scope and PRD 34.3's virtual-world/replay requirements. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, the current upstream main. The branch contains no other pending PR's fix.

For example, pinned seed 5, member `f0192`, week 3 crew offer `w3:7:crew_offer`: the base supplies 0.17186188117031304 from `w2:72:partner`; the latest completed meeting is `w2:35:plan`, with enjoyment 0.5279012929633153. Both the crew opt-in and invitation-input observations count when that member reaches both decisions. Counts below are decision invocations, not unique people.

## Implementation and alternatives

Collect the week's held-meetup enjoyment with its actual booking timestamp. Keep `lastEnjoy` fixed while processing that week's invitations, then apply the completed outcomes in time order for the next week. Include independent crew sessions using their established weekly slot. Use timestamps, since the existing meetup `day` field cannot distinguish a morning meeting from an evening meeting on the same day. No persisted schema or public record field is added.

Alternatives considered:

1. Sort all proposals before running them. The chosen booking can depend on responses to multiple offered slots; proposal reordering would also change invitation priority and capacity allocation.
2. Track the greatest timestamp and update `lastEnjoy` inside each meetup. That fixes overwriting by an older meetup but still allows the field used during the current invitation batch to change. Updating it after the weekly batch preserves the existing weekly invitation model.

One new blocking gate observes real oracle calls and the existing pinned worlds. The wrappers call the original oracle methods and return their results unchanged. Expected prior experience is reconstructed from completed interaction timestamps and independent crew slots; the gate also checks every final memory. It introduces no extra qualification worlds. No matcher, reply, draw, attendance or enjoyment is mocked.

## measurement

Same method on both revisions, 20 native worlds per revision:

- Pinned pack/random/oracle: seeds 5–8, 400 NYC personas, eight weeks (12 worlds).
- Additional pack seeds 9–12: 160 personas, eight weeks (four worlds).
- Pack controls with crews and repeats disabled: seeds 5–8, 160 personas, eight weeks (four worlds).

| Cohort | Worlds | Wrong invitation inputs, before → after | Wrong final memories, before → after |
| --- | ---: | ---: | ---: |
| pinned pack | 4 | 27 → 0 | 14 → 0 |
| pinned random | 4 | 0 → 0 | 0 → 0 |
| pinned oracle | 4 | 0 → 0 | 0 → 0 |
| additional pack | 4 | 6 → 0 | 3 → 0 |
| no-repeat controls | 4 | 0 → 0 | 2 → 0 |

The pinned gate checks 3,389 invitation/crew decision inputs and 2,907 final member memories. Its errors fall from 27 and 14 respectively to zero. The complete 20-world matrix records 3,806 relevant decision invocations per revision, with 33 incorrect inputs before and zero after. Final stale values fall from 19 to zero.

The measurement serializes Maps and Sets with their contents before SHA-256 hashing. It does not remove fields or normalize outcomes. `lastEnjoy` entries are sorted by member ID before hashing so map insertion order does not count as a value difference. All 20 populations, flow arrays, meetup arrays, contacts, value-day maps, simulation state and measured ledgers (`hours`, `hoursByWeek`, `bond`, `mutual`, `selfTogether`) are identical. All 20 complete metric objects are identical. Twelve final `lastEnjoy` maps are identical; eight change to correct the 19 stale values.

All 33 observed invitation mismatches came from older outcomes in completed weeks. No same-week future-outcome input was observed in this matrix. The fix also keeps the invitation phase's prior-week memory fixed by construction. These runs demonstrate corrected decision inputs and final memories, not a measured increase in attendance, friendship or production matching quality. Native deterministic draws produced the same recorded flows and outcomes in these runs. No confidence interval or significance claim is appropriate for identical outcomes.

## safety_gates

The same command, `bun run sim --only friends --json <output>`, passes **18/19 → 19/19 blocking gates**, with three tracked records. Only the new regression fails before the fix. All 21 pre-existing gate records, including the full pack/random/oracle fingerprint, are identical after removing duration fields. Runtime: 56.4s before, 77.8s after. One existing tracked metric remains off target.

All safety fields are exactly unchanged in every measured world. Pinned pack declared-minor proposals/contacts and known-adversary contacts remain zero; total harm remains 17.5 events per seed against 41.5 for random (0.42x, below the 0.5x blocking ceiling). The existing tracked undetected-harm comparison remains off target at 1.67x random. Pinned oracle harm remains zero. The random baseline is an unsafe comparison arm: its 119 total known-adversary contacts remain unchanged and are not described as a safety pass. Thresholds, realism parameters, matcher behavior and random draws were not tuned.

## Validation

- All four TypeScript configurations pass.
- Integration, including security: the six failure names and causes match the clean-base Windows reproduction (missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions). Integration is not green; those failures remain. Eight optional skips remain.

```text
 675 pass
 8 skip
 6 fail
 13741 expect() calls
Ran 689 tests across 68 files. [466.35s]
```

- E2E passes; the one optional SDK/browser test remains skipped.

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [44.86s]
```

The additional `bun run sim --only friends --quick` check passes 13/13 blocking gates in 11.1s, with three tracked metrics off target. The new gate remains blocking and passes on the quick sample.

## Reproduction

Use Windows PowerShell, Bun 1.4.2 and the repository's pinned dependencies. The baseline checkout is main at the SHA above; copy only the final `scripts/sim/friends.ts` gate into it. Leave its runtime unchanged. From each checkout, run `bun install --frozen-lockfile`, then:

```text
bun run typecheck
bun run sim --only friends --json ../friends-prior-enjoyment-gates-<before-or-after>.json
bun run test:integration
bun run test:e2e
```

The baseline Friends command exits 1 solely because the new regression gate fails; the corrected command exits 0. Existing tracked misses do not change. Use the repository's local PostgreSQL on port 54339 for integration and E2E. This run cleared live-send/deploy flags and provider keys. No live messages or production data were used.

Save the following programs as `friends-prior-enjoyment-measure.ts` and `friends-prior-enjoyment-compare.ts` beside the checkouts, then run the same commands with each root:

```text
bun friends-prior-enjoyment-measure.ts <base-root> friends-prior-enjoyment-before.json
bun friends-prior-enjoyment-measure.ts <fixed-root> friends-prior-enjoyment-after.json
bun friends-prior-enjoyment-compare.ts friends-prior-enjoyment-before.json friends-prior-enjoyment-after.json friends-prior-enjoyment-comparison.json
```

The comparison output includes every changed metric, per-world hash equality, and the incorrect baseline inputs with their source meetup keys.

### measure.ts

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [rootArg, output] = process.argv.slice(2), root = resolve(rootArg!);
const from = (p: string) => import(pathToFileURL(resolve(root, "packages/sim/src/apps/friends", p)).href);
const { runFriendsWorld, slotOfCrew } = await from("world.ts");
const { SLOTS } = await from("persona.ts");
const { slotTime } = await from("snapshot.ts");
const { friendsPackMatcher } = await from("packMatcher.ts");
const { BASELINES } = await from("baselines.ts");
const { friendsMetrics } = await from("metrics.ts");
const encode = (x: any) => JSON.stringify(x, (_, v) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v);
const hash = (x: any) => new Bun.CryptoHasher("sha256").update(encode(x)).digest("hex");
const rows: any[] = [];
const specs = [
  ...["pack", "random", "oracle"].flatMap(arm => [5, 6, 7, 8].map(seed => ({arm, seed, n:400, weeks:8}))),
  ...[9, 10, 11, 12].map(seed => ({arm:"pack", seed, n:160, weeks:8})),
  ...[5, 6, 7, 8].map(seed => ({arm:"no-repeat", seed, n:160, weeks:8})),
];
for (const spec of specs) {
  const decisions: any[] = [];
  const r = runFriendsWorld({...spec, matcher:(w: any) => {
    const answer = w.oracle.answer.bind(w.oracle), crew = w.oracle.crewOptIn.bind(w.oracle);
    w.oracle.answer = (id: string, key: string, c: any) => {
      const result = answer(id, key, c);
      if (!/:(plan|partner)$/.test(key)) decisions.push({id,key,week:c.week,actual:c.prevEnjoy,crew:false,result});
      return result;
    };
    w.oracle.crewOptIn = (id: string, key: string, enjoyed: number) => {
      const result = crew(id,key,enjoyed);
      decisions.push({id,key,week:w.state.week,actual:enjoyed,crew:true,result});
      return result;
    };
    if (spec.arm === "pack") return friendsPackMatcher();
    if (spec.arm === "no-repeat") return friendsPackMatcher({policy:{crews:false,repeat:false}});
    return typeof BASELINES[spec.arm] === "function" ? BASELINES[spec.arm](w) : BASELINES[spec.arm];
  }});
  const latest = new Map<string, any>();
  const bookedAt = new Map(r.world.state.interactions.map((x:any)=>[x.id,x.at]));
  const at = (m:any) => m.kind === "crew_self"
    ? slotTime(m.week,SLOTS.indexOf(slotOfCrew(r.world.state.crews.find((c:any)=>c.id===m.crewId))))
    : bookedAt.get(m.key) as number;
  const wrong: any[] = [];
  for (let week=0;week<spec.weeks;week++) {
    for (const d of decisions.filter(x=>x.week===week)) {
      const m=latest.get(d.id), expected=m?.enjoy[d.id] ?? (d.crew ? 0.5 : undefined);
      if (d.actual !== expected) wrong.push({...d,expected,expectedKey:m?.key,
        actualSource:r.meetups.find((x:any)=>x.enjoy[d.id] === d.actual)?.key});
    }
    for (const m of r.meetups.filter((x:any)=>x.week===week).sort((a:any,b:any)=>at(a)-at(b)))
      for(const id of m.attendees) latest.set(id,m);
  }
  const memoryWrong=[...new Set([...latest.keys(),...r.world.lastEnjoy.keys()])].filter(id=>r.world.lastEnjoy.get(id)!==latest.get(id)?.enjoy[id]);
  rows.push({...spec, decisions:decisions.length, wrong, memoryWrong, metrics:friendsMetrics(r),
    populationHash:hash(r.world.personas), flowsHash:hash(r.flows), meetupsHash:hash(r.meetups),
    contactsHash:hash(r.contacts), valuesHash:hash(r.valueDays), stateHash:hash(r.world.state),
    hoursHash:hash([r.world.hours,r.world.hoursByWeek,r.world.bond,r.world.mutual,r.world.selfTogether]),
    lastEnjoyHash:hash([...r.world.lastEnjoy].sort(([a]:any,[b]:any)=>a.localeCompare(b))),
  });
  await Bun.write(output!, JSON.stringify(rows,null,2)+"\n");
  console.log(JSON.stringify({spec,wrong:wrong.length,memoryWrong:memoryWrong.length,meetups:r.meetups.length}));
}
```

### compare.ts

```ts
const [beforePath, afterPath, output] = process.argv.slice(2);
const before = await Bun.file(beforePath!).json(), after = await Bun.file(afterPath!).json();
if (before.length !== 20 || after.length !== 20) throw new Error("Expected all 20 worlds per revision");
const equal = (a:any,b:any) => JSON.stringify(a)===JSON.stringify(b);
function diff(a:any,b:any,path=""):any[] {
  if (equal(a,b)) return [];
  if (a && b && typeof a==="object" && typeof b==="object" && !Array.isArray(a) && !Array.isArray(b))
    return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],path?`${path}.${k}`:k));
  return [{path,before:a,after:b}];
}
const hashes=["populationHash","flowsHash","meetupsHash","contactsHash","valuesHash","stateHash","hoursHash","lastEnjoyHash"];
const rows=before.map((a:any,i:number)=>{
  const b=after[i];
  if(!equal([a.arm,a.seed,a.n,a.weeks],[b.arm,b.seed,b.n,b.weeks])) throw new Error("Mismatched world");
  return {arm:a.arm,seed:a.seed,n:a.n,weeks:a.weeks,
    decisions:[a.decisions,b.decisions],wrong:[a.wrong.length,b.wrong.length],memoryWrong:[a.memoryWrong.length,b.memoryWrong.length],
    identical:Object.fromEntries(hashes.map(k=>[k,a[k]===b[k]])),metricChanges:diff(a.metrics,b.metrics),
    beforeErrors:a.wrong,
  };
});
const sum=(xs:any[],f:(x:any)=>number)=>xs.reduce((s,x)=>s+f(x),0);
const groups=[
  {name:"pinned pack",select:(r:any)=>r.arm==="pack"&&r.n===400},
  {name:"pinned random",select:(r:any)=>r.arm==="random"},
  {name:"pinned oracle",select:(r:any)=>r.arm==="oracle"},
  {name:"additional pack",select:(r:any)=>r.arm==="pack"&&r.n===160},
  {name:"no-repeat controls",select:(r:any)=>r.arm==="no-repeat"},
].map(({name,select})=>{
  const a=before.filter(select),b=after.filter(select);
  return {name,worlds:a.length,wrong:[sum(a,x=>x.wrong.length),sum(b,x=>x.wrong.length)],
    memoryWrong:[sum(a,x=>x.memoryWrong.length),sum(b,x=>x.memoryWrong.length)],
    decisions:[sum(a,x=>x.decisions),sum(b,x=>x.decisions)],
    meanMetrics:[a,b].map(xs=>({meetups:sum(xs,x=>x.metrics.meetups)/xs.length,
      repeatRate:sum(xs,x=>x.metrics.repeatRate)/xs.length,v14:sum(xs,x=>x.metrics.v14)/xs.length,
      friendship:sum(xs,x=>x.metrics.friendshipTrackShare)/xs.length,
      harm:sum(xs,x=>Object.values(x.metrics.safety.harms).reduce((s:any,v:any)=>s+v,0) as number)/xs.length,
      declaredMinor:sum(xs,x=>x.metrics.safety.declaredMinorContacts),knownAdversary:sum(xs,x=>x.metrics.safety.knownAdversaryContacts)}))};
});
const summary={groups,hashEquality:Object.fromEntries(hashes.map(k=>[k,rows.filter((x:any)=>x.identical[k]).length])),
  fullMetricsEqual:rows.filter((x:any)=>x.metricChanges.length===0).length,
  safetyChanges:rows.flatMap((x:any)=>x.metricChanges.filter((d:any)=>d.path.startsWith("safety.")).map((d:any)=>({arm:x.arm,seed:x.seed,...d}))),rows};
await Bun.write(output!,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify({...summary,rows:rows.map(({beforeErrors,metricChanges,...x}:any)=>({...x,metricChangedPaths:metricChanges.map((d:any)=>d.path)}))},null,2));
```

## Limits and related work

This corrects the personal prior-enjoyment ledger. It does not reorder every event or relationship update within a weekly batch. It does not change the source meetup times, the hidden enjoyment model, or when feedback reaches the Network.

PR #365 concerns feedback arrival in planner snapshots; PR #370 corrects published `met` edge timestamps. Neither changes `lastEnjoy`. This PR overlaps #370's private `held` helper call sites, so merging both will require reconciling those arguments while retaining both behaviors. PR #364 addresses independent crew booking collisions. Its fix is not included here. Equal-time records retain their existing order; this change does not resolve those pre-existing duplicate bookings. No combined qualification with those pending branches is claimed.

Only the affected Friends block was rerun. AGENTS.md limits an agent to one full `bun run sim`, already used earlier in this contribution session. No new full-simulation run is claimed.

## llm_evidence

N/A: the affected harness, oracle, planner and regression are deterministic and use no LLM. Validation model calls: 0; cost: $0; no model request settings. No prompt or model-backed behavior changed. No real-model qualification is claimed.

## agent_clients

Codex desktop 26.1103.7773.0, primary runtime 26.1104.2876.0, Windows, Bun 1.4.2, PostgreSQL 16.15. Authoring provider: OpenAI; exact authoring model identifier: unavailable. Tests were driven through command-line tools; GitHub access used the connector and Git/gh. No computer/browser use or other agent-client acceptance tests were performed. No external-client compatibility claim is made.
