# Slop dispatch after a safety hold (2026-11-10)

## Defect and scope

The Slop simulation selects a weekly batch, then resolves its proposals in order. A completed flow can put a member on hold through relay checks or a reported harm. Later proposals still use the earlier batch. The resolver checks age and pause state, but not the current holds. It can probe either member of a pair after one has been held.

This is a reproduced simulation defect under the approved Slop scope, CONTRIBUTING 3.1 and PRD Sections 34.3–34.4. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. The one-line fix checks both members against active holds before starting each proposal's probe flow. It uses the engine world's existing interval rule, `from <= now && (to === undefined || to > now)`. Both synchronous and asynchronous runners use this shared resolver.

The rejected proposal keeps its existing `dropped_policy` flow record. It creates no interaction, sends no probe and spends no invitation capacity. Expired or future holds do not block the flow. The resolver does not remove hold history or change the matcher. This is separate from PR #453, which fixes baseline selection against the weekly snapshot, and PR #299, which changes production date planning.

One integration case runs the native greedy matcher with seed 7, 120 personas per city and eight weeks. It covers relay off, the existing relay probability model, and the real engine relay policy with its native simulated exchanges. Relay-enabled worlds use three-day review. The case observes `answerProbe` calls and delegates every call unchanged to the native behavior. It checks that probes and native holds occur, and that no probe concerns a pair with an active hold.

The same final test file gives **0 pass / 1 fail / 3 assertions → 1 pass / 0 fail / 9 assertions**. Before, the relay-off world delivers nine such probes. It stops at that assertion. After, all three worlds pass. Case runtime: 254.45 ms before and 836.74 ms after; suite runtime: 295 ms and 1044 ms. The different completed workloads do not measure performance.

## measurement

The same program runs **48 native worlds per revision**: four seeds (5, 7, 13, 16), four arms (random, greedy, oracle, engine pack), and three relay modes (off, probability model, engine policy). Each world has 120 personas per city in SF, NYC and LA and lasts eight weeks. The engine-pack arm uses the asynchronous runner. Other arms use the synchronous runner.

Population distributions and all behavior settings remain at their native defaults. The relay probability mode uses scam recall 0.85, hostile recall 0.7 and false-positive probability 0.005. Relay-enabled worlds use review after three days, with `clearHonest: 0.95` and `catchAdversary: 0.8`. Verification, photos, rater and widening remain off. Review and members are simulated. Engine relay mode uses the repository's native scripted exchanges and policy; it makes no live classifier calls.

The observer records each selected proposal and checks holds immediately before each native `answerProbe` call. It records whether the recipient is held, and whether the hold was absent at weekly selection. It changes no proposal, decision or random choice. Observed probe totals must equal the harness's delivered-probe metric. All population hashes match across revisions. Selection hashes include proposals and the active-hold set seen at selection; state and behavior hashes retain Map and Set contents. Complete metrics and extra fields are retained. JSON represents existing nonfinite metric values as `null` on both revisions.

| Observed behavior | Before | After |
| --- | --- | --- |
| Probes concerning a pair with an active hold | 112 | 0 |
| Of those, probes sent to the held member | 5 | 0 |
| Total delivered probes | 69321 | 69209 |
| Proposals dropped by policy | 130 | 291 |

All 112 offending calls concern holds created after that week's selection. Five calls go to the held member; the other 107 go to the proposed partner. All 36 non-greedy controls are identical in every recorded field. All 48 selection hashes remain identical, including the greedy proposals. Dispatch changes 12 greedy worlds; their behavior, state and metric records change. These are exact deterministic comparisons, not a statistical estimate of real-world safety or matching quality.

All changed worlds are listed below. Policy drops can increase by more than the suppressed probe count: some held proposals previously stopped later at a capacity check. This changes their rejection classification too.

| Greedy relay mode | Seed | Held-pair probes | Held-recipient probes | Policy drops | Delivered probes | Dates |
| --- | --- | --- | --- | --- | --- | --- |
| off | 5 | 5 → 0 | 0 → 0 | 28 → 38 | 1994 → 1989 | 70 → 70 |
| off | 7 | 9 → 0 | 2 → 0 | 11 → 23 | 2093 → 2084 | 66 → 66 |
| off | 13 | 1 → 0 | 0 → 0 | 9 → 14 | 2191 → 2190 | 64 → 64 |
| off | 16 | 3 → 0 | 0 → 0 | 6 → 10 | 2184 → 2181 | 54 → 54 |
| probability | 5 | 8 → 0 | 0 → 0 | 27 → 38 | 1999 → 1991 | 85 → 85 |
| probability | 7 | 11 → 0 | 1 → 0 | 2 → 18 | 2104 → 2093 | 75 → 75 |
| probability | 13 | 22 → 0 | 0 → 0 | 5 → 34 | 2162 → 2140 | 59 → 59 |
| probability | 16 | 2 → 0 | 0 → 0 | 2 → 5 | 2176 → 2174 | 50 → 50 |
| engine | 5 | 8 → 0 | 0 → 0 | 31 → 43 | 1983 → 1975 | 73 → 73 |
| engine | 7 | 14 → 0 | 2 → 0 | 2 → 21 | 2100 → 2086 | 79 → 78 |
| engine | 13 | 23 → 0 | 0 → 0 | 5 → 35 | 2162 → 2139 | 59 → 59 |
| engine | 16 | 6 → 0 | 0 → 0 | 2 → 12 | 2164 → 2158 | 53 → 53 |

### The one prevented date

In the greedy engine-relay world, seed 7, `w5:155:sf-035:sf-004` originally reaches a date. At both probe calls, `sf-004` already has a `relay: flagged` hold placed earlier in that weekly batch. Its generated hidden type is `harasser`. With the fix, that same selected proposal ends at `dropped_policy`, with no probe or reveal.

The world's dates change **79 → 78** and adversary contacts **27 → 26**. The remaining 47 worlds retain their date counts. Harms recorded for the prevented date were already empty; the patch does not claim a measured reduction in harm events. The changed world also has four fewer engine relay items (723 → 719), and its rate and demographic totals reflect the removed date.

A separate focused check runs this world without instrumentation on both revisions. Its full behavior hash equals the corresponding instrumented result each time. This verifies that the observer did not create the observed date change. The full program and the exact flow comparison are reproducible below.

## safety_gates

The same `bun run sim --only slop --json <output>` command passes **39/39 blocking gates before and after**. All **57 complete gate records** are identical after excluding execution duration, including fingerprints. Of 18 tracked records, eight remain off target. Runtime: 35s before and 34.7s after. Official launch worlds use seeds 13–16, 300 personas per city and four weeks; Slop live-service worlds use seeds 21–22 and 30 days. Their existing configuration, review simulation and conformance checks are unchanged.

The diagnostic matrix has **47/48 identical safety records**. The only changed safety field is the engine-relay greedy world's adversary contact count, 27 → 26. Declared-minor proposals remain zero in every world. Existing hidden-minor and other adversary contacts remain visible; these comparison arms are not claimed safe.

The following sums cover all 48 worlds and count repeated simulation observations, not distinct people or real incidents.

| Safety field | Before | After |
| --- | --- | --- |
| `minorContacts` | 0 | 0 |
| `undisclosedMinorContacts` | 82 | 82 |
| `undisclosedMinorProposals` | 659 | 659 |
| `adversaryProposals` | 4489 | 4489 |
| `adversaryContacts` | 791 | 790 |
| `harms.deception` | 62 | 62 |
| `harms.harassment` | 34 | 34 |
| `harms.minor_contact` | 82 | 82 |
| `harms.catfish_reveal` | 85 | 85 |
| `harms.offplatform_move` | 36 | 36 |
| `harms.financial_loss` | 4 | 4 |
| `harmsReported` | 151 | 151 |
| `harms.money_ask` | 20 | 20 |

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13750 expect() calls
Ran 690 tests across 69 files. [463.53s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [44.34s]
```

The one optional SDK/browser test remains skipped.

No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was already used earlier in this session. This revision has fresh affected-block validation, including the Slop live-service simulation and conformance checks.

## Reproduction

Use Bun 1.4.2 and PostgreSQL 16.15. Disable provider keys, live-send and deploy flags. Use local PostgreSQL on port 54339 for integration and E2E. Prepare the base and this PR in separate checkouts. Save the complete programs below outside the checkouts. The analysis and focused-flow programs read the named before/after JSON files beside themselves.

```sh
bun install --frozen-lockfile
bun test --conditions eliza-source --timeout 120000 packages/sim/test/slop-dispatch-holds.integration.test.ts
bun slop-dispatch-holds-measure.ts /path/to/base slop-dispatch-holds-before.json
bun slop-dispatch-holds-measure.ts /path/to/fix slop-dispatch-holds-after.json
bun slop-dispatch-holds-compare.ts slop-dispatch-holds-before.json slop-dispatch-holds-after.json comparison.json
bun slop-dispatch-holds-analyze.ts
bun slop-dispatch-holds-flow.ts /path/to/base /path/to/fix
bun run sim --only slop --json gates.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

Copy the integration case into the base checkout to reproduce the failure. Run the same Slop gate command in each checkout. Expected fixed result: zero probes concerning active holds, 36 unchanged control worlds, and 39/39 blocking gates. The integration command includes the full security suite; retain the known Windows failures in its reported result.

## Design and limits

Filtering the batch once after selection would still miss holds created while resolving earlier proposals. Making the greedy matcher use each member once would change its intended congestion baseline and leave the resolver dependent on matcher behavior. Checking current holds before each flow preserves the selected batch and enforces the policy where the probe starts.

The native resolver makes no asynchronous call between the two probes and creates holds only after their reveal or outcome. One check of both members before the first probe therefore covers both calls. This is not a change to the production dispatcher. The matrix covers three native hold paths and both runner APIs, but does not exhaust every population or horizon. It does not fabricate future or overlapping holds. The interval rule follows the engine for those cases.

The fix preserves the harness's existing weekly processing order and hold timestamps. It does not rework intraweek chronology, selection after an expired hold, asks, human review, relay classification or model assumptions. Production planning and snapshot selection fixes remain separate PRs. The test and measurement programs are hand-written; populations, proposals, holds and outcomes come from repository code. No UI, member-facing text, secrets, `.env`, `runs/` or real member data are included.

## llm_evidence

N/A: this deterministic dispatch guard changes no prompt or model-backed behavior. Validation model calls: **0**, cost: **$0**. No real-model qualification is claimed.

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
const { BASELINES } = await load("packages/sim/src/apps/slop/baselines.ts");
const { slopEngineMatcher } = await load("packages/sim/src/apps/slop/enginePack.ts");
const { worldOptions, extraOf } = await load("packages/sim/src/apps/slop/packEval.ts");
const { slopMetrics } = await load("packages/sim/src/apps/slop/metrics.ts");
const json = (x: unknown) => JSON.stringify(x, (_, v) => v instanceof Map ? { map: [...v] } : v instanceof Set ? { set: [...v] } : v);
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(json(x)).digest("hex");
const rows = [];
for (const arm of ["random", "greedy", "oracle", "pack"]) for (const mode of ["off", "probability", "engine"]) for (const seed of [5, 7, 13, 16]) {
  const events: any[] = [], selected = new Map<string, any>();
  let probes = 0;
  const run = arm === "pack" ? runSlopWorldAsync : runSlopWorld;
  const r = await run({ seed, perCity: 120, weeks: 8, ...worldOptions(mode === "off" ? {} : { relay: mode === "engine" ? { engine: true } : true, review: 3 }), matcher(w: any) {
    const native = arm === "pack" ? slopEngineMatcher({ seed }) : BASELINES[arm](w);
    const answer = w.behavior.answerProbe.bind(w.behavior);
    w.behavior.answerProbe = (...args: any[]) => {
      const p = selected.get(args[1]);
      if (!p) throw new Error("Unknown proposal");
      probes++;
      const active = w.state.safetyHolds.filter((h: any) => h.from <= w.state.now && (h.to === undefined || h.to > w.state.now) && (h.memberId === p.first || h.memberId === p.partner));
      if (active.length) events.push({ week: w.state.week, id: args[0], key: args[1], active, newlyHeld: active.some((h: any) => !p.initial.has(h.memberId)), recipientHeld: active.some((h: any) => h.memberId === args[0]) });
      return answer(...args);
    };
    return { ...native, propose(ctx: any) {
      const initial = new Set(ctx.snapshot.safetyHolds.filter((h: any) => h.from <= ctx.snapshot.now && (h.to === undefined || h.to > ctx.snapshot.now)).map((h: any) => h.memberId));
      const capture = (output: any) => {
        const ps = Array.isArray(output) ? output : output.proposals;
        ps.forEach((p: any, i: number) => selected.set(`w${ctx.week}:${i}:${p.first}:${p.partner}`, { ...p, initial }));
        return output;
      };
      const output = native.propose(ctx);
      return output instanceof Promise ? output.then(capture) : capture(output);
    } };
  } });
  const metrics = slopMetrics(r);
  if (metrics.probesDelivered !== probes) throw new Error("Probe instrumentation drift");
  const row = { spec: { arm, mode, seed }, probes, heldPairProbes: events.length, newHoldProbes: events.filter(e => e.newlyHeld).length, heldRecipientProbes: events.filter(e => e.recipientHeld).length, newHoldRecipientProbes: events.filter(e => e.newlyHeld && e.recipientHeld).length, policyDrops: r.flows.filter((f: any) => f.stage === "dropped_policy").length, events, holds: r.world.state.safetyHolds, metrics, extra: extraOf(r, metrics), populationHash: hash(r.world.personas), stateHash: hash(r.world.state), selectionHash: hash(selected), behaviorHash: hash({ flows: r.flows, asks: r.asks, relay: r.relay, photos: r.photos }) };
  rows.push(row);
  console.log(JSON.stringify({ done: rows.length, spec: row.spec, probes, heldPairProbes: row.heldPairProbes, newHoldProbes: row.newHoldProbes, heldRecipientProbes: row.heldRecipientProbes, policyDrops: row.policyDrops }));
}
await Bun.write(out, JSON.stringify(rows, null, 2));
```

### compare.ts

```ts
const a = await Bun.file(process.argv[2]!).json(), b = await Bun.file(process.argv[3]!).json();
const eq = (x: any, y: any) => JSON.stringify(x) === JSON.stringify(y);
if (a.length !== 48 || b.length !== 48) throw new Error("Expected 48 worlds per revision");
const changes = [], controls = [], safetyChanges = [];
for (let i = 0; i < a.length; i++) {
  const x = a[i], y = b[i];
  if (!eq(x.spec, y.spec) || x.populationHash !== y.populationHash) throw new Error(`Input changed ${i}`);
  if (y.heldPairProbes || y.heldRecipientProbes || y.newHoldProbes) throw new Error(`Dispatch invariant failed ${i}`);
  if (y.spec.arm !== "greedy") {
    if (!eq(x, y)) throw new Error(`Control changed ${i}`);
    controls.push(i);
  }
  if (!eq(x.metrics.safety, y.metrics.safety)) safetyChanges.push({ i, spec: y.spec, before: x.metrics.safety, after: y.metrics.safety });
  if (!eq(x, y)) changes.push({ i, spec: y.spec, selectionSame: x.selectionHash === y.selectionHash, stateSame: x.stateHash === y.stateHash, behaviorSame: x.behaviorHash === y.behaviorHash, metricsSame: eq(x.metrics, y.metrics), heldPairProbes: [x.heldPairProbes, y.heldPairProbes], heldRecipientProbes: [x.heldRecipientProbes, y.heldRecipientProbes], policyDrops: [x.policyDrops, y.policyDrops], probes: [x.probes, y.probes], dates: [x.metrics.dates, y.metrics.dates] });
}
const sum = (rows: any[], key: string) => rows.reduce((n, r) => n + r[key], 0);
const total = (key: string) => [sum(a, key), sum(b, key)];
const summary = { worlds: b.length, controls: controls.length, unchanged: b.length - changes.length, heldPairProbes: total("heldPairProbes"), heldRecipientProbes: total("heldRecipientProbes"), newHoldProbes: total("newHoldProbes"), newHoldRecipientProbes: total("newHoldRecipientProbes"), policyDrops: total("policyDrops"), probes: total("probes"), changes, safetyChanges };
await Bun.write(process.argv[4]!, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, changes: changes.length, safetyChanges: safetyChanges.length }));
```

### analyze.ts

```ts
const dir = import.meta.dir;
const a = await Bun.file(`${dir}/slop-dispatch-holds-before.json`).json(), b = await Bun.file(`${dir}/slop-dispatch-holds-after.json`).json();
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
const changes = a.flatMap((x: any, i: number) => {
  const y = b[i], m = flatten(x.metrics), n = flatten(y.metrics), e = flatten(x.extra), f = flatten(y.extra);
  const differences = (l: any, r: any) => Object.fromEntries([...new Set([...Object.keys(l), ...Object.keys(r)])].filter(k => !eq(l[k], r[k])).map(k => [k, [l[k] ?? null, r[k] ?? null]]));
  return eq(x, y) ? [] : [{ spec: y.spec, metrics: differences(m, n), extra: differences(e, f) }];
});
const out = { worlds: b.length, selectionSame: a.filter((x: any, i: number) => x.selectionHash === b[i].selectionHash).length, behaviorSame: a.filter((x: any, i: number) => x.behaviorHash === b[i].behaviorHash).length, stateSame: a.filter((x: any, i: number) => x.stateHash === b[i].stateHash).length, metricsSame: a.filter((x: any, i: number) => eq(x.metrics, b[i].metrics)).length, safetySame: a.filter((x: any, i: number) => eq(x.metrics.safety, b[i].metrics.safety)).length, safetyTotals: [safetyTotals(a), safetyTotals(b)], changes };
await Bun.write(`${dir}/slop-dispatch-holds-analysis.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, changes: changes.map(x => ({ spec: x.spec, metrics: Object.keys(x.metrics), extra: Object.keys(x.extra) })) }));
```

### flow.ts

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const dir = import.meta.dir, rows = [];
const json = (x: unknown) => JSON.stringify(x, (_, v) => v instanceof Map ? { map: [...v] } : v instanceof Set ? { set: [...v] } : v);
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(json(x)).digest("hex");
for (const [index, label] of ["before", "after"].entries()) {
  const repo = resolve(process.argv[index + 2]!);
  const load = (p: string) => import(pathToFileURL(resolve(repo, p)).href);
  const { runSlopWorld } = await load("packages/sim/src/apps/slop/world.ts");
  const { BASELINES } = await load("packages/sim/src/apps/slop/baselines.ts");
  const { worldOptions } = await load("packages/sim/src/apps/slop/packEval.ts");
  const measured = (await Bun.file(`${dir}/slop-dispatch-holds-${label}.json`).json()).find((x: any) => x.spec.arm === "greedy" && x.spec.mode === "engine" && x.spec.seed === 7);
  const r = runSlopWorld({ seed: 7, perCity: 120, weeks: 8, ...worldOptions({ relay: { engine: true }, review: 3 }), matcher: BASELINES.greedy });
  if (hash({ flows: r.flows, asks: r.asks, relay: r.relay, photos: r.photos }) !== measured.behaviorHash) throw new Error("Instrumented/uninstrumented result differs");
  rows.push({ label, flows: r.flows, personas: r.world.personas.map((p: any) => ({ id: p.id, adversary: p.hidden.adversary, minor: p.hidden.isMinor })), events: measured.events });
}
const prevented = rows[0]!.flows.flatMap((f: any, i: number) => f.stage === "date" && rows[1]!.flows[i]?.stage !== "date" ? [{ before: f, after: rows[1]!.flows[i], participants: rows[0]!.personas.filter((p: any) => p.id === f.first || p.id === f.partner), events: rows[0]!.events.filter((e: any) => e.key === f.key) }] : []);
await Bun.write(`${dir}/slop-dispatch-holds-flow.json`, JSON.stringify(prevented, null, 2));
console.log(JSON.stringify(prevented));
```
