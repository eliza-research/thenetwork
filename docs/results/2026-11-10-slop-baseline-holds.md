# Slop baseline hold intervals (2026-11-10)

## Defect and scope

Slop's random and greedy simulation matchers exclude every member who ever received a safety hold. They ignore its end time. An honest member remains excluded after the simulated reviewer clears the hold. The oracle matcher has the opposite error: it builds the same exclusion set but never checks it.

This is a reproduced simulation defect under the approved Slop scope, CONTRIBUTING 3.1 and PRD Section 34. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. The simulation's existing review model clears honest members after a configured delay. Its comparison matchers must respect that interval. Production matching and relay code do not change.

The fix filters holds with `from <= now && (to === undefined || to > now)`. This is the engine world's existing interval rule. Random and greedy already use the shared exclusion set. The oracle now checks that set too. Holds are active at their start and inactive at their end; open-ended holds remain active. An overlapping active hold still excludes the member. Existing blocks and previously met pairs remain excluded.

One integration case drives the native random, greedy and oracle matchers through generated eight-week worlds. It uses seed 16, 120 personas per city, relay enabled, and no review or review after 10, 3 and 7 days. All holds arise through native relay and review behavior. No hold, proposal, persona decision or model response is fabricated. The default false-positive probability remains 0.005. The case checks no active-hold proposals, resumed proposals after three-day review, and release exactly at a seven-day hold's end.

Focused regression, same final test file on both revisions: **0 pass / 1 fail / 2 assertions → 1 pass / 0 fail / 8 assertions**. Before, three proposals include an actively held member. Case runtime: 2563.03 ms before and 2629.19 ms after; suite runtime: 2.62 s and 2.68 s.

## measurement

The same program runs **64 native worlds per revision**, each with 120 personas per city in SF, NYC and LA, for eight weeks:

| Matrix | Seeds | Arms | Relay/review settings |
|---|---|---|---|
| 60 baseline worlds | 5, 7, 13, 16 | random, greedy, oracle | relay with no review; review after 3, 7 or 10 days; relay off |
| 4 engine-pack controls | 5, 7, 13, 16 | real Slop engine matcher | relay with three-day review |

The matrix uses the generated population defaults and native behavior. Relay uses the existing probability model: scam recall 0.85, hostile recall 0.7, false-positive probability 0.005. Review uses `clearHonest: 0.95` and `catchAdversary: 0.8`. Verification, photos, rater and widening remain off in this diagnostic matrix. All review here is simulated. These are simulation assumptions, not live classifier measurements. The engine-pack controls therefore differ from the official fully configured launch-gate worlds.

The wrapper only observes each matcher's input and returned proposals. It does not consume randomness or change proposals. Active and cleared holds refer to the weekly input snapshot. Expired exclusions count matchable, unpaused cleared members still present in random/greedy's exclusion set. Counts are member-week observations, not distinct people. The oracle is not counted as an expired exclusion because it previously ignored that set altogether.

Probes count each member whose native flow has `firstYes` or `partnerYes` set, including a silent response recorded as false. Each count uses that flow's weekly input snapshot. The measurement retains complete metrics and extra fields, population hashes, final-state hashes and behavior hashes (flows, asks, relay and photo records). Hash serialization retains Map and Set entries. The comparison also checks identical complete rows for designated controls. JSON serializes existing nonfinite metric values as `null` on both revisions.

| Observed defect / behavior | Before | After |
| --- | --- | --- |
| Proposals including an actively held member | 6 | 0 |
| Probes delivered to actively held members | 3 | 0 |
| Expired-hold exclusions (member-week observations) | 109 | 0 |
| Of those, exclusions exactly at hold expiry | 8 | 0 |
| Proposals including a cleared member | 10 | 150 |
| Probes delivered to cleared members | 5 | 107 |

Random expired exclusions are **50 → 0**, greedy **59 → 0**. Their cleared-member probes are **0 → 20** and **0 → 82**. Oracle active-hold proposals are **6 → 0** and active-hold probes **3 → 0**; its cleared-member probes remain **5 → 5**. All counts refer to holds at the matcher's weekly input snapshot.

The 24 designated controls are 12 relay-off baseline worlds, eight random/greedy worlds without review, and four engine-pack worlds. All are identical in every recorded field. Overall, 42/64 complete rows, behavior hashes, final-state hashes and full metric records remain identical. The other 22 worlds change because eligibility changes. This is a deterministic correctness comparison, not evidence of better date quality. No statistical significance or real-world benefit is claimed.

All changed worlds are listed below. The complete programs also retain every changed metric and extra field.

| Arm / review | Seed | Expired exclusions | Active proposals | Cleared probes | Dates |
| --- | --- | --- | --- | --- | --- |
| random / three-day | 13 | 7 → 0 | 0 → 0 | 0 → 4 | 55 → 56 |
| random / three-day | 16 | 11 → 0 | 0 → 0 | 0 → 3 | 69 → 75 |
| random / seven-day | 13 | 7 → 0 | 0 → 0 | 0 → 4 | 55 → 56 |
| random / seven-day | 16 | 11 → 0 | 0 → 0 | 0 → 3 | 69 → 75 |
| random / ten-day | 13 | 6 → 0 | 0 → 0 | 0 → 2 | 55 → 71 |
| random / ten-day | 16 | 8 → 0 | 0 → 0 | 0 → 4 | 69 → 78 |
| greedy / three-day | 5 | 7 → 0 | 0 → 0 | 0 → 14 | 85 → 74 |
| greedy / three-day | 7 | 6 → 0 | 0 → 0 | 0 → 8 | 75 → 74 |
| greedy / three-day | 13 | 2 → 0 | 0 → 0 | 0 → 2 | 59 → 61 |
| greedy / three-day | 16 | 6 → 0 | 0 → 0 | 0 → 8 | 50 → 60 |
| greedy / seven-day | 5 | 7 → 0 | 0 → 0 | 0 → 14 | 85 → 74 |
| greedy / seven-day | 7 | 6 → 0 | 0 → 0 | 0 → 8 | 75 → 74 |
| greedy / seven-day | 13 | 2 → 0 | 0 → 0 | 0 → 2 | 59 → 61 |
| greedy / seven-day | 16 | 6 → 0 | 0 → 0 | 0 → 8 | 50 → 60 |
| greedy / ten-day | 5 | 6 → 0 | 0 → 0 | 0 → 6 | 85 → 76 |
| greedy / ten-day | 7 | 5 → 0 | 0 → 0 | 0 → 6 | 75 → 77 |
| greedy / ten-day | 13 | 1 → 0 | 0 → 0 | 0 → 1 | 59 → 62 |
| greedy / ten-day | 16 | 5 → 0 | 0 → 0 | 0 → 5 | 50 → 67 |
| oracle / none | 5 | 0 → 0 | 2 → 0 | 0 → 0 | 112 → 113 |
| oracle / none | 16 | 0 → 0 | 2 → 0 | 0 → 0 | 136 → 132 |
| oracle / ten-day | 5 | 0 → 0 | 1 → 0 | 1 → 1 | 112 → 113 |
| oracle / ten-day | 16 | 0 → 0 | 1 → 0 | 0 → 0 | 136 → 133 |

## safety_gates

The same `bun run sim --only slop --json <output>` command passes **39/39 blocking gates before and after**. All **57 complete gate records** are identical after excluding execution duration, including fingerprints. Of 18 tracked records, eight remain off target. Runtime: 36.6s before and 35.8s after. Official launch worlds use seeds 13–16, 300 personas per city and four weeks; Slop live-service worlds use seeds 21–22 and 30 days. The official random comparison has no relay/review stack, while the engine-pack arm retains its existing configured stack. This explains why correcting these baseline holds does not change the official launch comparison.

The exploratory matrix has **46/64 identical safety records**. Declared-minor proposals remain zero in every world. All oracle safety fields remain zero. All engine-pack safety fields remain identical, including existing nonzero hidden-minor and adversary contacts. Restoring eligible members changes random/greedy pairings and their native random choices. Their safety fields do not all remain constant.

The following sums include all 64 worlds. They count repeated simulation observations, not distinct people or real incidents.

| Safety field | Before | After |
| --- | --- | --- |
| `minorContacts` | 0 | 0 |
| `undisclosedMinorContacts` | 138 | 130 |
| `undisclosedMinorProposals` | 1084 | 1099 |
| `adversaryProposals` | 6393 | 6329 |
| `adversaryContacts` | 1049 | 1062 |
| `harms.deception` | 98 | 93 |
| `harms.harassment` | 37 | 40 |
| `harms.minor_contact` | 138 | 130 |
| `harms.catfish_reveal` | 101 | 106 |
| `harmsReported` | 182 | 195 |
| `harms.offplatform_move` | 33 | 39 |
| `harms.financial_loss` | 2 | 2 |
| `harms.money_ask` | 17 | 20 |

In particular, random seed 16 with ten-day review increases hidden-minor contacts from 7 to 8. Greedy adversary contacts increase from 422 to 446 across its 20 worlds. The totals also include existing harms in the unchanged engine-pack controls. These arms are not claimed safe. This patch repairs comparison-matcher hold semantics; it does not tune their safety or quality. The official safety gate values and fingerprints remain unchanged.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13749 expect() calls
Ran 690 tests across 69 files. [461.13s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [44.97s]
```

The one optional SDK/browser test remains skipped.

No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was already used earlier in this session. This revision has fresh affected-block validation, including the Slop live-service simulation and conformance checks.

## Reproduction

Use Bun 1.4.2 and PostgreSQL 16.15. Disable provider keys, live-send and deploy flags. Use local PostgreSQL on port 54339 for integration and E2E. Prepare the base and this PR in separate checkouts. Save the complete programs below outside the checkouts. The analysis program reads the named before/after JSON files beside itself.

```sh
bun install --frozen-lockfile
bun test --conditions eliza-source --timeout 120000 packages/sim/test/slop-baseline-holds.integration.test.ts
bun slop-baseline-holds-measure.ts /path/to/base slop-baseline-holds-before.json
bun slop-baseline-holds-measure.ts /path/to/fix slop-baseline-holds-after.json
bun slop-baseline-holds-compare.ts slop-baseline-holds-before.json slop-baseline-holds-after.json comparison.json
bun slop-baseline-holds-analyze.ts
bun run sim --only slop --json gates.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

Copy the integration case into the base checkout to see its failure. Run the same Slop gate command in each checkout. Expected fixed result: zero active-hold proposals and expired exclusions, positive resumed proposals, and 39/39 blocking gates. The integration command includes the full security suite; retain the known Windows failures in its reported result.

## Design and limits

Deleting expired holds from world state would discard history and change other consumers. Repeating the interval rule inside every matcher would duplicate logic and leave the exported exclusion helper incorrect. Filtering the existing helper and using it in the oracle fixes both consumers without another abstraction.

The regression and measurement cover native open-ended holds, review delays shorter and longer than one week, and exact expiry. They do not create synthetic future or overlapping holds. The interval predicate follows the engine's rule for those cases. The matrix does not exhaust all populations or horizons.

This checks holds active when a weekly batch is selected. It does not add dispatch-time checks for holds created later in that batch. The production plan guard in PR #299 is separate. No production authorization, review, relay, model, threshold, distribution, UI or member-facing text changes. The test and measurement programs are hand-written; all member populations and outcomes are generated by repository code. No secrets, real member data, `.env` or `runs/` files are included.

## llm_evidence

N/A: these comparison matchers and interval checks are deterministic. No prompt or model-backed behavior changes. Validation model calls: **0**, cost: **$0**. No real-model qualification is claimed.

## agent_clients

Codex desktop **26.1103.7773.0**, primary runtime **26.1104.2876.0**, Windows, Bun **1.4.2**, PostgreSQL **16.15**. Authoring provider: OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests. No agent-client workflow changes.

## Complete measurement programs

### measure.ts

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = resolve(process.argv[2]!), out = resolve(process.argv[3]!);
const load = (p: string) => import(pathToFileURL(resolve(repo, p)).href);
const { runSlopWorld, runSlopWorldAsync } = await load("packages/sim/src/apps/slop/world.ts");
const { BASELINES, visibleExclusions } = await load("packages/sim/src/apps/slop/baselines.ts");
const { slopEngineMatcher } = await load("packages/sim/src/apps/slop/enginePack.ts");
const { worldOptions, extraOf } = await load("packages/sim/src/apps/slop/packEval.ts");
const { slopMetrics } = await load("packages/sim/src/apps/slop/metrics.ts");
const json = (x: unknown) => JSON.stringify(x, (_, v) => v instanceof Map ? { map: [...v] } : v instanceof Set ? { set: [...v] } : v);
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(json(x)).digest("hex");
const specs: any[] = [];
for (const arm of ["random", "greedy", "oracle"]) for (const model of ["none", "three-day", "seven-day", "ten-day", "off"]) for (const seed of [5, 7, 13, 16]) specs.push({ arm, model, seed });
for (const seed of [5, 7, 13, 16]) specs.push({ arm: "pack", model: "three-day", seed });
const rows = [];
for (const spec of specs) {
  const { arm, model, seed } = spec, steps: any[] = [];
  const review = model === "three-day" ? 3 : model === "seven-day" ? 7 : model === "ten-day" ? 10 : undefined;
  const run = arm === "pack" ? runSlopWorldAsync : runSlopWorld;
  const r = await run({ seed, perCity: 120, weeks: 8, ...worldOptions(model === "off" ? {} : { relay: true, review }), matcher: (w: any) => {
    const native = arm === "pack" ? slopEngineMatcher({ seed }) : BASELINES[arm](w);
    return { ...native, propose(ctx: any) {
      const { now, safetyHolds } = ctx.snapshot;
      const active = new Set(safetyHolds.filter((h: any) => h.from <= now && (h.to === undefined || h.to > now)).map((h: any) => h.memberId));
      const cleared = [...new Set(safetyHolds.filter((h: any) => h.to !== undefined && h.to <= now && !active.has(h.memberId)).map((h: any) => h.memberId))].filter(id => ctx.profiles.get(id)?.matchable && !ctx.profiles.get(id)?.paused);
      const boundary = new Set(safetyHolds.filter((h: any) => h.to === now && !active.has(h.memberId)).map((h: any) => h.memberId));
      const excluded = arm === "random" || arm === "greedy" ? cleared.filter(id => visibleExclusions(ctx).held.has(id)) : [];
      const capture = (value: any) => {
        const ps = Array.isArray(value) ? value : value.proposals;
        steps.push({ week: ctx.week, active: [...active].sort(), cleared: cleared.sort(), excluded: excluded.sort(), boundaryExcluded: excluded.filter(id => boundary.has(id)), activeProposals: ps.filter((p: any) => active.has(p.first) || active.has(p.partner)), clearedProposals: ps.filter((p: any) => cleared.includes(p.first) || cleared.includes(p.partner)) });
        return value;
      };
      const value = native.propose(ctx);
      return value instanceof Promise ? value.then(capture) : capture(value);
    } };
  } });
  const sum = (key: string) => steps.reduce((n, s) => n + s[key].length, 0);
  const probed = (key: "active" | "cleared") => r.flows.reduce((n: number, f: any) => n + Number(f.firstYes !== undefined && steps[f.week][key].includes(f.first)) + Number(f.partnerYes !== undefined && steps[f.week][key].includes(f.partner)), 0);
  const metrics = slopMetrics(r);
  const row = { spec, activeMemberWeeks: sum("active"), clearedMemberWeeks: sum("cleared"), expiredExclusions: sum("excluded"), boundaryExclusions: sum("boundaryExcluded"), activeProposals: sum("activeProposals"), clearedProposals: sum("clearedProposals"), activeProbes: probed("active"), clearedProbes: probed("cleared"), steps,
    holds: r.world.state.safetyHolds, metrics, extra: extraOf(r, metrics), populationHash: hash(r.world.personas), stateHash: hash(r.world.state), behaviorHash: hash({ flows: r.flows, asks: r.asks, relay: r.relay, photos: r.photos }) };
  rows.push(row);
  console.log(JSON.stringify({ done: rows.length, spec, expiredExclusions: row.expiredExclusions, activeProposals: row.activeProposals, activeProbes: row.activeProbes, clearedProbes: row.clearedProbes }));
}
await Bun.write(out, JSON.stringify(rows, null, 2));
```

### compare.ts

```ts
const a = await Bun.file(process.argv[2]!).json(), b = await Bun.file(process.argv[3]!).json();
const eq = (x: any, y: any) => JSON.stringify(x) === JSON.stringify(y);
if (a.length !== 64 || b.length !== 64) throw new Error("Expected 64 worlds per revision");
const changes = [], controls = [], safetyChanges = [];
for (let i = 0; i < a.length; i++) {
  const x = a[i], y = b[i], { arm, model } = y.spec;
  if (!eq(x.spec, y.spec) || x.populationHash !== y.populationHash) throw new Error(`Input changed ${i}`);
  if (y.activeProposals || y.activeProbes || y.expiredExclusions || y.boundaryExclusions) throw new Error(`Hold invariant failed ${i}`);
  if (model === "off" || arm === "pack" || (model === "none" && arm !== "oracle")) {
    if (!eq(x, y)) throw new Error(`Control changed ${i}`);
    controls.push(i);
  }
  if (!eq(x.metrics.safety, y.metrics.safety)) safetyChanges.push({ i, spec: y.spec, before: x.metrics.safety, after: y.metrics.safety });
  if (!eq(x, y)) changes.push({ i, spec: y.spec, behaviorSame: x.behaviorHash === y.behaviorHash, stateSame: x.stateHash === y.stateHash, metricsSame: eq(x.metrics, y.metrics), activeProposals: [x.activeProposals, y.activeProposals], activeProbes: [x.activeProbes, y.activeProbes], expiredExclusions: [x.expiredExclusions, y.expiredExclusions], clearedProbes: [x.clearedProbes, y.clearedProbes], dates: [x.metrics.dates, y.metrics.dates] });
}
const sum = (rows: any[], key: string) => rows.reduce((n, r) => n + r[key], 0);
const total = (key: string) => [sum(a, key), sum(b, key)];
const summary = { worlds: b.length, controls: controls.length, unchanged: b.length - changes.length, activeProposals: total("activeProposals"), activeProbes: total("activeProbes"), expiredExclusions: total("expiredExclusions"), boundaryExclusions: total("boundaryExclusions"), clearedProposals: total("clearedProposals"), clearedProbes: total("clearedProbes"), changes, safetyChanges };
await Bun.write(process.argv[4]!, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, changes: changes.length, safetyChanges: safetyChanges.length }));
```

### analyze.ts

```ts
const dir = import.meta.dir;
const a = await Bun.file(`${dir}/slop-baseline-holds-before.json`).json(), b = await Bun.file(`${dir}/slop-baseline-holds-after.json`).json();
const eq = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
const flatten = (x: any, prefix = ""): Record<string, any> => Object.assign({}, ...Object.entries(x).map(([k, v]) => {
  const key = prefix ? `${prefix}.${k}` : k;
  return v && typeof v === "object" && !Array.isArray(v) ? flatten(v, key) : { [key]: v };
}));
const safetyTotals = (rows: any[]) => {
  const out: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(flatten(r.metrics.safety))) if (typeof v === "number") out[k] = (out[k] ?? 0) + v;
  return out;
};
const arms = ["random", "greedy", "oracle", "pack"].map(arm => {
  const x = a.filter((r: any) => r.spec.arm === arm), y = b.filter((r: any) => r.spec.arm === arm);
  const sum = (rows: any[], k: string) => rows.reduce((n, r) => n + r[k], 0);
  return { arm, worlds: x.length, counts: Object.fromEntries(["activeProposals", "activeProbes", "expiredExclusions", "boundaryExclusions", "clearedProposals", "clearedProbes"].map(k => [k, [sum(x, k), sum(y, k)]])), safety: [safetyTotals(x), safetyTotals(y)] };
});
const changes = a.flatMap((x: any, i: number) => {
  const y = b[i], m = flatten(x.metrics), n = flatten(y.metrics), e = flatten(x.extra), f = flatten(y.extra);
  const differences = (l: any, r: any) => Object.fromEntries([...new Set([...Object.keys(l), ...Object.keys(r)])].filter(k => !eq(l[k], r[k])).map(k => [k, [l[k] ?? null, r[k] ?? null]]));
  return eq(x, y) ? [] : [{ spec: y.spec, metrics: differences(m, n), extra: differences(e, f) }];
});
const out = { worlds: b.length, behaviorSame: a.filter((x: any, i: number) => x.behaviorHash === b[i].behaviorHash).length, stateSame: a.filter((x: any, i: number) => x.stateHash === b[i].stateHash).length, metricsSame: a.filter((x: any, i: number) => eq(x.metrics, b[i].metrics)).length, safetySame: a.filter((x: any, i: number) => eq(x.metrics.safety, b[i].metrics.safety)).length, arms, safetyTotals: [safetyTotals(a), safetyTotals(b)], changes };
await Bun.write(`${dir}/slop-baseline-holds-analysis.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, changes: changes.length }));
```
