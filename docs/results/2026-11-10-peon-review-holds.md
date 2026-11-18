# Stop Peon review when the company becomes held

Date: 2026-11-10. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

**Draft: one blocking quality gate fails after correcting the simulation.** The pack/keyword interviews-per-hire ratio changes from 0.7481334227910708 to 0.7503590460012804 against the existing 0.75 limit. The threshold and matcher are unchanged. This report provides the defect proof and the failing qualification result for maintainer review; it does not claim merge readiness.

## Problem and requirement

The Peon hiring simulator checks a company's hold before entering employer review. A candidate report or relay screen can hold the company inside that review loop, but the rest of the current batch keeps processing. It can open more simulated scam contacts after the hold, including further reports from other candidates.

This is a reproduced simulation defect under CONTRIBUTING 3.1, PRD 34.3–34.4 and the Peon harness's documented rule that held members are not delivered. It concerns synthetic hiring-world behavior, not a live service or real messages.

The base reproduction uses the repository's generated market and built-in keyword matcher: seed 1, four weeks, 80 candidates and 30 jobs per city. Under V1 without relay screening, the same company receives two report/block outcomes in one review batch even though the first holds it. V2 also records two. With screening enabled, multiple applications are reviewed after the first screen has already held the company.

## Cause and fix

The initial `held(jid)` check cannot catch a hold created later by `schedule`. V1's acceptable-application loop continues calling it. V2's `canInterview` returns true unconditionally for scams, even after a hold, so on-file and unread applications keep advancing.

Recheck the hold while processing the V1 batch, and include it in V2's interview eligibility predicate. This stops subsequent scheduling and prevents V2 from spending more reading time once the current company becomes held. The first report or screen remains the event that activates the hold.

Checking only before the batch reproduces the bug. Suppressing only the final contact flag would still record employer consent, increase channel trust and consume review work after the hold. A new queue or a matcher change is unnecessary; both native review algorithms already have the needed control points.

PR #366 separately fixes rereading an already invited on-file application. This branch starts from main and does not include that change. No matching weights, thresholds, random draws or realism settings change.

## measurement

One integration case runs four native hiring worlds: both realism profiles, with and without relay screening, using the real keyword matcher and generated personas. It checks that the company becomes held, that no second reporting candidate is reached, and that the screened fixture stops after its first review. No matcher implementation, oracle output or network behavior is mocked.

| Same regression | Base | Candidate |
|---|---:|---:|
| Passing / failing cases | 0 / 1 | 1 / 0 |
| Assertions reached | 2 | 12 |
| Case duration | 227.85 ms | 456.71 ms |

The independent paired measurement runs 72 worlds per revision:

- 32 keyword worlds: seeds 1, 7, 11, 23, 13, 14, 15 and 16; V1/V2; relay screening off/on.
- 16 pack worlds: the same eight seeds and both profiles, using the native pack matcher defaults.
- Eight oracle worlds: the same seeds, V2, native oracle matcher.
- 16 keyword controls: seeds 1, 7, 11 and 23; both profiles and screening settings; generated scam companies and their jobs removed from the population before the native run.

All use 80 candidates and 30 jobs per city before filtering. Seeds 1, 7, 11 and 23 run four weeks; seeds 13–16 run eight weeks. Seeds 13–16 were added after the initial reproduction and guard design. The controls alter supplied synthetic populations, not matcher or oracle implementations.

| Paired result | Before | After |
|---|---:|---:|
| Report/screen outcomes beyond the first hold-triggering outcome per company | 213 | 0 |
| Company/run instances with multiple such outcomes | 47 | 0 |
| Simulated scam contacts, including contacts before the first hold | 250 | 54 |
| Complete pack/oracle/scam-free control results unchanged | reference | 40 / 40 |
| Hire records unchanged | reference | 72 / 72 |
| Non-scam flow records unchanged | reference | 64 / 72 |

The comparison checks full metrics and hashes of populations, flows, hires, state, audits and assessed candidates. Maps and sets are serialized with their contents. All 72 populations, hire records, audit results, assessed-candidate sets, flow counts and role-closure counts remain identical. The 32 keyword worlds containing scams change; no claim of universal result equality is made. Across the 72 alternative runs, all 248 hire records remain identical. Recruiter time changes from 2,237.1 to 2,219.2 simulated hours.

The repeated-outcome measure counts employer-accepted scam flows that either hit the relay screen or appear in the native report/block edges. A company can acquire its hold only once. Additional such outcomes demonstrate continued processing after that transition. This counter does not separately time every unreported contact; total contacts are reported alongside it.

### Secondary effects

V2 increases channel trust on employer acceptance. Stopping later scam reviews removes those increases; the existing expiry logic can later lower trust. A focused rerun of the eight changed keyword worlds inspected every non-scam flow: 20 records changed, including 18 replies becoming no-response and downstream queue changes. Their hire records remain identical. The supplied follow-up program makes these effects reproducible. This is a simulator correction, not a claim that all legitimate application outcomes or matching quality improve.

## safety_gates and the draft blocker

In the 72-world comparison, minors proposed/matched remain zero. Every other safety field is identical except scam reach and fake candidates reaching an employer, which never increase. Keyword and scam-free controls retain their original unverified-employer and missing-pay-range exposures; these negative controls are not labeled safe. The pack/oracle controls compare identically.

Fresh `bun run sim --only peon,audit,ops` runs 59 checks: 57 blocking and two tracked. Base passes all 57 blocking gates in 79.1 seconds. Candidate passes 56/57 in 74.8 seconds; both tracked checks remain on target. After excluding durations, 56 of the 59 gate records remain identical. The three differences are the combined fingerprint, the interviews-per-hire gate changing from pass to fail, and the pack scam-reach gate improving from `1 (n=1, max 1)` to `0 (n=1, max 0)`.

An independent run of the exact pinned qualification configuration saves the metrics behind the rounded gate label: seeds 13–16, eight weeks, 400 candidates and 80 jobs per city, V2, pack/keyword/oracle.

| Pinned quantity | Before | After |
|---|---:|---:|
| Mean pack interviews per hire | 3.9812893081761005 | 3.9812893081761005 |
| Mean keyword interviews per hire | 5.3216300554024905 | 5.305845687331537 |
| Pack / keyword ratio | 0.7481334227910708 | 0.7503590460012804 |
| Gate `ratio <= 0.75` | pass | **fail** |

Every pinned pack seed retains its hires and interviews; all oracle metrics are identical. Pack seed 15 changes review/expiry/safety measurements, including eliminating its remaining scam contact. Keyword seed 15 hires change 41→40; seed 16 hires change 44→45 and interviews 211→207. These larger markets therefore do not preserve every hire record. The ratio uses the mean of per-seed ratios, as the existing gate specifies.

The existing [Peon results report](2026-10-08-peon-pack.md) already describes this quality gate as close to its threshold. That history does not waive the new failure. No threshold, gate classification or hidden-data access is relaxed. Maintainer acceptance of this simulation correction and its qualification impact remains outstanding; the PR stays a draft.

AGENTS.md permits one full `bun run sim` per agent; that allowance was used earlier in this contribution session. These are fresh affected-block runs, not a new all-block pass.

## Validation

Windows, Bun 1.4.2, PostgreSQL 16.15 on isolated localhost port 54339 with `REQUIRE_PG=1`. Frozen installation made no changes. Provider, live-send and deployment flags were cleared. The initial validation script stopped on the quality-gate failure; the remaining suites were then run separately. The failing gate result remains recorded above.

- Typecheck: all four configurations passed.
- Integration, including the security suite: 676 pass, 8 skip, 6 fail; 13,753 assertions. Ran 690 tests across 69 files. [510.37s]
- The new regression passed in the official integration command in 593.22 ms.
- The six integration failures match the baseline by name and cause: missing /bin/bash, SIGTERM exit 143 versus 0, and four Windows path assertions.
- The eight optional integration skips match the preceding completed run.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions. Ran 43 tests across 3 files. [41.72s]
- The optional browser SDK case was skipped. The isolated database was stopped after validation.

The new Peon quality-gate failure is separate from these six baseline integration failures. A fully green validation result is not claimed.

## llm_evidence and agent_clients

No model-backed behavior is qualified: these native hiring worlds use deterministic policies and oracles. Model requests 0; cost $0. Live models and member-facing clients were not tested. This harness has simulated review decisions, not live human review.

Codex desktop 26.1103.7773.0 drove Bun and local PostgreSQL on Windows. Contribution provider: OpenAI; exact contribution model metadata is unavailable. No browser/computer use or other agent client is claimed.

## Reproduce

After the frozen install and local PostgreSQL setup:

```sh
bun test --conditions eliza-source packages/sim/test/peon-review-holds.integration.test.ts
bun run typecheck
bun run sim --only peon,audit,ops --json ../peon-review-holds-gates-after.json
bun run test:integration
bun run test:e2e
```

Expect the targeted regression to pass and the simulation command to exit 1 at the documented quality gate. Save the four programs below beside independent base and candidate checkouts and run each measurement on both, then compare:

```sh
bun run --conditions eliza-source peon-review-holds-measure.ts friends-crew-base peon-review-holds-before.json
bun run --conditions eliza-source peon-review-holds-measure.ts thenetwork peon-review-holds-after.json
bun run --conditions eliza-source peon-review-holds-flow-effects.ts friends-crew-base peon-review-holds-effects-before.json
bun run --conditions eliza-source peon-review-holds-flow-effects.ts thenetwork peon-review-holds-effects-after.json
bun run --conditions eliza-source peon-review-holds-pinned.ts friends-crew-base peon-review-holds-pinned-before.json
bun run --conditions eliza-source peon-review-holds-pinned.ts thenetwork peon-review-holds-pinned-after.json
# Also save the paired affected-block JSON files as shown above, one per revision.
cd friends-crew-base
bun run sim --only peon,audit,ops --json ../peon-review-holds-gates-before.json
cd ../thenetwork
bun run sim --only peon,audit,ops --json ../peon-review-holds-gates-after.json
cd ..
bun run peon-review-holds-compare.ts
```

The programs are manually specified measurement logic authored with Codex. Native generated worlds provide the results. These exact deterministic comparisons do not claim statistical or real-world performance gains. Existing pending-application expiry rules and other open Peon simulator fixes remain outside this change.

### Paired world measurement

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [rootArg, output] = process.argv.slice(2), root = resolve(rootArg!);
const from = (p: string) => import(pathToFileURL(resolve(root, "packages/sim/src/apps/peon", p)).href);
const { runPeonWorld, REALISM_V1, REALISM_V2 } = await from("world.ts");
const { keywordMatcher, packMatcher, oracleMatcher } = await from("baselines.ts");
const { generatePeonPopulation } = await from("persona.ts");
const { peonMetrics } = await from("metrics.ts");
const encode = (x: any) => JSON.stringify(x, (_, v) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v);
const hash = (x: any) => new Bun.CryptoHasher("sha256").update(encode(x)).digest("hex");
const rows: any[] = [];
async function run(seed: number, realism: any, arm: string, screen: boolean, clean = false) {
  const weeks = seed >= 13 && seed <= 16 ? 8 : 4;
  const pop = generatePeonPopulation({ seed, weeks, perCity: 80, jobsPerCity: 30 });
  if (clean) {
    const scams = new Set(pop.companies.filter((c: any) => c.adversary === "scam").map((c: any) => c.id));
    pop.companies = pop.companies.filter((c: any) => !scams.has(c.id));
    pop.jobs = pop.jobs.filter((j: any) => !scams.has(j.company));
  }
  const matcher = arm === "pack" ? packMatcher() : arm === "oracle" ? (w: any) => oracleMatcher(w) : { ...keywordMatcher, relayScreen: screen };
  const r = await runPeonWorld({ seed, weeks, pop, realism, matcher });
  const companyOf = new Map(r.world.pop.jobs.map((j: any) => [j.id, j.company]));
  const reported = new Set(r.world.state.edges.filter((e: any) => e.type === "blocked").map((e: any) => `${e.from}|${e.to}`));
  const holds = [...r.heldCompanies].map(company => {
    const fs = r.flows.filter((f: any) => f.scam && f.employerYes && companyOf.get(f.job) === company);
    const triggers = fs.filter((f: any) => !f.scamContact || reported.has(`${f.cand}|${f.job}`));
    return { company, triggers: triggers.map((f: any) => f.key), contacts: fs.filter((f: any) => f.scamContact).length,
      reviewed: fs.length, reports: fs.filter((f: any) => reported.has(`${f.cand}|${f.job}`)).length };
  });
  rows.push({ id: `${seed}:${realism.name}:${arm}:${screen}:${clean}`, seed, realism: realism.name, arm, screen, clean, weeks,
    holds, metrics: peonMetrics(r), recruiterHours: r.recruiterHours, populationHash: hash(pop),
    flowsHash: hash(r.flows), hiresHash: hash(r.hires), stateHash: hash(r.world.state), auditsHash: hash(r.audits),
    assessedHash: hash(r.assessed), closed: r.closed, heldCompanies: [...r.heldCompanies],
    flowCount: r.flows.length, totalContacts: r.flows.filter((f: any) => f.scamContact).length,
    nonScamFlowsHash: hash(r.flows.filter((f: any) => !f.scam)) });
}
for (const seed of [1, 7, 11, 23, 13, 14, 15, 16]) {
  for (const realism of [REALISM_V1, REALISM_V2]) for (const screen of [false, true]) await run(seed, realism, "keyword", screen);
  for (const realism of [REALISM_V1, REALISM_V2]) await run(seed, realism, "pack", true);
  await run(seed, REALISM_V2, "oracle", true);
}
for (const seed of [1, 7, 11, 23]) for (const realism of [REALISM_V1, REALISM_V2]) for (const screen of [false, true]) await run(seed, realism, "keyword", screen, true);
await Bun.write(output!, JSON.stringify(rows, null, 2));
console.log(JSON.stringify({ runs: rows.length, multipleTriggers: rows.flatMap(r => r.holds).filter(h => h.triggers.length > 1).length,
  extraTriggers: rows.flatMap(r => r.holds).reduce((n, h) => n + Math.max(0, h.triggers.length - 1), 0),
  totalContacts: rows.reduce((n, r) => n + r.totalContacts, 0) }));
```

### Non-scam flow follow-up

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]!), output = process.argv[3]!;
const from = (p: string) => import(pathToFileURL(resolve(root, "packages/sim/src/apps/peon", p)).href);
const { runPeonWorld, REALISM_V2 } = await from("world.ts");
const { keywordMatcher } = await from("baselines.ts");
const rows = [];
for (const seed of [11, 14, 15, 16]) for (const relayScreen of [false, true]) {
  const r = await runPeonWorld({ seed, weeks: seed === 11 ? 4 : 8, perCity: 80, jobsPerCity: 30,
    realism: REALISM_V2, matcher: { ...keywordMatcher, relayScreen } });
  rows.push({ id: `${seed}:${relayScreen}`, flows: r.flows.filter((f: any) => !f.scam), hires: r.hires });
}
await Bun.write(output, JSON.stringify(rows));
```

### Pinned qualification measurement

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]!), output = process.argv[3]!;
const from = (p: string) => import(pathToFileURL(resolve(root, "packages/sim/src/apps/peon", p)).href);
const { runPeonWorld, REALISM_V2 } = await from("world.ts");
const { ARMS } = await from("arms.ts");
const { peonMetrics } = await from("metrics.ts");
const { officialGates } = await from("gates.ts");
const arms: Record<string, any[]> = { pack: [], keyword: [], oracle: [] };
for (const arm of ["pack", "keyword", "oracle"]) for (const seed of [13, 14, 15, 16]) {
  arms[arm]!.push(peonMetrics(await runPeonWorld({ seed, perCity: 400, jobsPerCity: 80,
    weeks: 8, matcher: ARMS[arm].matcher, realism: REALISM_V2 })));
}
const meanIV = (a: any[]) => a.reduce((n, m) => n + m.interviewsPerHire, 0) / a.length;
const result = { arms, gates: officialGates(arms.pack, arms.keyword, arms.oracle),
  packInterviewsPerHire: meanIV(arms.pack!), keywordInterviewsPerHire: meanIV(arms.keyword!),
  interviewRatio: meanIV(arms.pack!) / meanIV(arms.keyword!) };
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ratio: result.interviewRatio, pack: result.packInterviewsPerHire,
  keyword: result.keywordInterviewsPerHire, failing: result.gates.filter((g: any) => !g.pass) }));
```

### Comparison

```ts
import { strict as assert } from "node:assert";
const b = await Bun.file("peon-review-holds-before.json").json(), a = await Bun.file("peon-review-holds-after.json").json();
assert.equal(b.length, 72); assert.equal(a.length, 72);
let unchanged = 0, changed = 0, nonScamUnchanged = 0;
const reach = ["scamReach", "scamReachMaxPerEmployer", "fakeReachedEmployer"];
for (let i = 0; i < b.length; i++) {
  const x = b[i], y = a[i]; assert.equal(x.id, y.id);
  for (const key of ["populationHash", "hiresHash", "auditsHash", "assessedHash", "flowCount", "closed", "heldCompanies"]) assert.deepEqual(y[key], x[key]);
  assert.equal(y.metrics.safety.minorsMatched, 0); assert.equal(x.metrics.safety.minorsMatched, 0);
  for (const key of reach) assert(y.metrics.safety[key] <= x.metrics.safety[key]);
  assert.equal(y.metrics.safety.scamReachByEmployer.length, x.metrics.safety.scamReachByEmployer.length);
  y.metrics.safety.scamReachByEmployer.forEach((v: number, j: number) => assert(v <= x.metrics.safety.scamReachByEmployer[j]));
  for (const key of Object.keys(x.metrics.safety).filter(k => ![...reach, "scamReachByEmployer"].includes(k))) assert.deepEqual(y.metrics.safety[key], x.metrics.safety[key]);
  for (const h of y.holds) assert.equal(h.triggers.length, 1, y.id);
  assert(y.totalContacts <= x.totalContacts);
  if (x.arm !== "keyword" || x.clean) { assert.deepEqual(y, x); unchanged++; }
  else { assert.notDeepEqual(y, x); changed++; }
  if (x.nonScamFlowsHash === y.nonScamFlowsHash) nonScamUnchanged++;
}
assert.deepEqual([unchanged, changed, nonScamUnchanged], [40, 32, 64]);
const extra = (xs: any[]) => xs.flatMap(r => r.holds).reduce((n, h) => n + Math.max(0, h.triggers.length - 1), 0);
const sum = (xs: any[], key: string) => xs.reduce((n, r) => n + r[key], 0);
assert.deepEqual([extra(b), extra(a), sum(b, "totalContacts"), sum(a, "totalContacts")], [213, 0, 250, 54]);
assert.equal(b.flatMap((r: any) => r.holds).filter((h: any) => h.triggers.length > 1).length, 47);
const eb = await Bun.file("peon-review-holds-effects-before.json").json(), ea = await Bun.file("peon-review-holds-effects-after.json").json();
assert.equal(eb.length, 8); assert.equal(ea.length, 8);
let changedFlows = 0, lostReplies = 0;
for (let i = 0; i < eb.length; i++) {
  assert.equal(ea[i].id, eb[i].id); assert.deepEqual(ea[i].hires, eb[i].hires);
  assert.equal(ea[i].flows.length, eb[i].flows.length);
  for (let j = 0; j < eb[i].flows.length; j++) {
    const x = eb[i].flows[j], y = ea[i].flows[j]; assert.equal(y.key, x.key);
    if (JSON.stringify(y) !== JSON.stringify(x)) changedFlows++;
    if (x.replied === true && y.replied === false) lostReplies++;
  }
}
assert.deepEqual([changedFlows, lostReplies], [20, 18]);
const pb = await Bun.file("peon-review-holds-pinned-before.json").json(), pa = await Bun.file("peon-review-holds-pinned-after.json").json();
assert.deepEqual(pa.arms.oracle, pb.arms.oracle);
for (let i = 0; i < 4; i++) {
  assert.equal(pa.arms.pack[i].hires, pb.arms.pack[i].hires);
  assert.equal(pa.arms.pack[i].interviews, pb.arms.pack[i].interviews);
}
assert.equal(pa.packInterviewsPerHire, pb.packInterviewsPerHire);
assert(pb.interviewRatio <= 0.75); assert(pa.interviewRatio > 0.75);
assert.deepEqual(pb.gates.filter((g: any) => !g.pass), []);
assert.deepEqual(pa.gates.filter((g: any) => !g.pass).map((g: any) => g.id), ["interviews_per_hire"]);
const gb = await Bun.file("peon-review-holds-gates-before.json").json(), ga = await Bun.file("peon-review-holds-gates-after.json").json();
const norm = (g: any) => { const { ms, ...rest } = g; return { ...rest, name: rest.name.replace(/restore \d+ ms/, "restore <duration> ms") }; };
assert.deepEqual(ga.blocks, ["peon", "audit", "ops"]); assert.deepEqual(gb.blocks, ga.blocks);
assert.equal(gb.quick, false); assert.equal(ga.quick, false); assert.equal(ga.gates.length, 59);
assert.equal(ga.gates.filter((g: any) => g.blocking).length, 57);
const changedGates = gb.gates.flatMap((g: any, i: number) => JSON.stringify(norm(g)) === JSON.stringify(norm(ga.gates[i])) ? [] : [g.name]);
assert.deepEqual(changedGates, ["fingerprint: pack, keyword and oracle arms", "gate Interviews per hire <= 0.75x keyword", "gate Median reach per scam employer that got an intro <= 1 (max shown)"]);
assert(gb.gates.every((g: any) => g.pass));
assert.deepEqual(ga.gates.filter((g: any) => !g.pass).map((g: any) => g.name), ["gate Interviews per hire <= 0.75x keyword"]);
const result = { runs: 72, unchanged, changed, nonScamUnchanged, extraTriggers: [extra(b), extra(a)],
  contacts: [sum(b, "totalContacts"), sum(a, "totalContacts")], changedNonScamFlows: changedFlows, lostReplies,
  recruiterHours: [sum(b, "recruiterHours"), sum(a, "recruiterHours")],
  interviewRatio: [pb.interviewRatio, pa.interviewRatio], packInterviewsPerHire: pa.packInterviewsPerHire,
  keywordInterviewsPerHire: [pb.keywordInterviewsPerHire, pa.keywordInterviewsPerHire],
  gateCounts: { total: ga.gates.length, blocking: 57, passedBefore: 57, passedAfter: 56, unchanged: 56 },
  gateDurationsSeconds: [gb.total, ga.total] };
await Bun.write("peon-review-holds-comparison.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
```
