# Peon applications lost to closed roles

Date: 2026-11-07. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Requirement and defect

This is a reproduced simulation defect under the approved project scope and PRD 34.3, 40.6 and 40.8.
The Peon world models hiring decisions, role deadlines, external fills and remaining openings.
Its `lostToClosedRole` metric counts applications lost because the role closed while they waited.

The queue stage already records these closures.
Two later stages omitted them:

- A scheduled interview was cancelled when the job had no openings, but did not get the `roleClosed` flag.
- A passing interview candidate received an employer rejection when the role closed before the offer decision.

Closures can come from deadlines, external fills or another platform hire using the last opening.
Failed interviews remain employer rejections.
A candidate already hired elsewhere in the simulation retains the existing candidate cancellation precedence.

## Change and alternatives

Set the existing `roleClosed` flag when a closed role cancels an interview.
At the offer decision, record a cancellation for a passing, unhired candidate when no opening remains.
The existing metric then counts both stages without a new metric or threshold.

Other implementations considered:

1. Count every unsuccessful application against a job that eventually closes. That also counts earlier refusals and failed interviews.
2. Change only the metric. The stored history would still falsely attribute the closure to an employer rejection.
3. Add a separate closure event stream. The existing flow flag and interaction outcome already express this result.

The patch changes no selection, interview, offer-allocation or hiring decision.
The regression exercises complete generated hiring worlds with the pack, keyword and oracle matchers.
Its observer records round state and forwards each real matcher call unchanged.

## Measurement

The same measurement program ran against base and fixed source.
It observed 156 paired worlds and 159,891 proposal flows per revision.
Every world ran for eight weeks.

| Matrix | Seeds | Candidates and jobs per city | Worlds |
|---|---|---|---:|
| Default realism V2, three matchers | 13–36 | 100 / 20 | 72 |
| Realism V1, three matchers | 13–36 | 100 / 20 | 72 |
| Official pinned size, V2, three matchers | 13–16 | 400 / 80 | 12 |

Development used V2 small worlds on seeds 13–16.
Seeds 17–36, V1 and the larger pinned worlds were additional checks without tuning the fix.

| Result | Before | After |
|---|---:|---:|
| Missing closure records | 1,201 | 0 |
| Missing records at scheduled interviews | 1,098 | 0 |
| False employer rejections after passing interviews | 103 | 0 |
| Reported applications lost to closed roles | 3,296 | 4,497 |
| Worlds with unrelated changes | 0 | 0 |

| Profile / matcher | Missing interview records | False rejections | Reported losses before → after |
|---|---:|---:|---:|
| V2 / pack | 87 | 16 | 129 → 232 |
| V2 / keyword | 122 | 14 | 338 → 474 |
| V2 / oracle | 115 | 13 | 201 → 329 |
| V1 / pack | 48 | 0 | 57 → 105 |
| V1 / keyword | 81 | 0 | 210 → 291 |
| V1 / oracle | 71 | 0 | 94 → 165 |
| Pinned / pack | 189 | 19 | 431 → 639 |
| Pinned / keyword | 205 | 16 | 1,403 → 1,624 |
| Pinned / oracle | 180 | 25 | 433 → 638 |

All hires, populations, audits, assessed candidates and metrics other than `lostToClosedRole` were identical.
Every other flow field and final state field was identical.
Comparison normalized only the independently identified missing closure flags and false rejection records.
It restored those specific records to their old representation before hashing.
The other flows retained their exact fields, including genuine rejections, ghosting, offers and candidate cancellations.
Thirteen worlds had no affected application and remained entirely unchanged.

These are accounting corrections in deterministic worlds, not an improvement in hiring outcomes or a population-level estimate.

## Regression and validation

One integration case runs twelve complete worlds, with three matchers and seeds 13–16.
It checks scheduled-interview cancellations, decisions after passing interviews and the aggregate closure count.
It also requires both affected stages to occur.

```sh
bun install --frozen-lockfile
bun test --conditions eliza-source --timeout 120000 packages/sim/test/peon-closed-role.integration.test.ts
bun run typecheck
bun run sim --only peon --json peon-gates.json
bun run test:integration
bun run test:e2e
```

The regression ran on the base runtime with only its new test added, then on the fixed runtime.

| Check | Before | After |
|---|---|---|
| New integration case | 0 pass / 1 fail / 1 assertion; 3.21 s | 1 pass / 0 fail / 1 assertion; 3.26 s |
| Case time | 3,185.64 ms | 3,229.04 ms |
| TypeScript | Existing base qualification | All four configurations pass |
| Peon simulation | 27/27 blocking gates; 26.6 s | 27/27 blocking gates; 26.8 s |

All 27 blocking gate records retain their exact values.
Only the tracked metrics fingerprint changes: `b7736da857812394` → `bb20e128ad453b96`.
That fingerprint includes the corrected closure count. All other metrics are identical in the paired comparison.
There are zero tracked misses before and after.

Integration, including security: **676 pass, 8 skip, 6 fail**, 13,742 assertions, 375.12 seconds.
The six failures match the recorded base failures by name and underlying cause:

- Wrangler cannot spawn `/bin/bash` on this Windows host.
- The boot test receives exit 143 after SIGTERM instead of its expected zero.
- Four site build assertions use a path form that differs on Windows.

The eight skips are the existing optional cleanup reconciliation cases.
The full integration suite remains red; these failures are not presented as passes.
No additional integration failure appeared.

E2E: **42 pass, 1 skip, 0 fail**, 654 assertions, 39.30 seconds.
The skip is the optional browser SDK case requiring `PLAYWRIGHT_MODULE`.
The task PostgreSQL instance used port 54339 and stopped after all test processes finished and no clients remained.

## Safety gates and limits

All safety metrics in the 156-world comparison remained identical.
The keyword and oracle arms retain their documented negative-control behavior; this is not a claim that every arm is safe.
The change does not modify minors, consent, verification, holds, proxy handling or live delivery.
All people, companies and roles were generated locally.

The full simulation had already run for this agent during PR #355.
The repository's one-full-run-per-agent rule therefore limits this qualification to the affected Peon block.
Existing, separate fixes for candidate search exit and queue accounting are not included in this branch.

## LLM evidence and agent clients

N/A for real model qualification: this change corrects deterministic simulator records and their derived count.
The measurement used the real local world, oracle, matchers and engine, with no replacement model output.
No model calls were made; model cost was $0.
It does not prove model-backed or external-client behavior.

Authoring client: Codex desktop 26.1103.3517.0, OpenAI, exact model identifier unavailable.
The local commands used Windows, PowerShell 7.6.9, Bun 1.4.2 and PostgreSQL 16.15.
No external agent client was tested.
The operator forbids computer use; no browser or desktop automation was used.

## Reproduce the wider comparison

Save the following program outside the repository as `peon-closure-measure.ts`.
Give it the absolute path of each checkout and redirect its JSON lines to separate files.
Use the same frozen dependencies and unset live-send, deploy and model-provider flags.
The program uses no credentials or real messages.

```sh
bun peon-closure-measure.ts /path/to/base > before.jsonl
bun peon-closure-measure.ts /path/to/fix > after.jsonl
```

Expected: 156 rows each, matching variant, arm and seed.
All hash fields match, including the independently identified affected flow keys.
The fixed rows have zero `missing`, `falseDeclines` and `badClosure`.
For every row, fixed `lostToClosedRole` equals the base count plus base `missing`.

```ts
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = resolve(process.argv[2]!);
const from = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { runPeonWorld, REALISM_V1 } = await from("packages/sim/src/apps/peon/world.ts");
const { ARMS } = await from("packages/sim/src/apps/peon/arms.ts");
const { peonMetrics } = await from("packages/sim/src/apps/peon/metrics.ts");
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x, (_k, v) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v)).digest("hex");
for (const variant of ["v2", "v1", "pinned"]) for (const arm of ["pack", "keyword", "oracle"]) {
  for (let seed = 13; seed <= (variant === "pinned" ? 16 : 36); seed++) {
    const rounds: any[] = [];
    const r = await runPeonWorld({ seed, perCity: variant === "pinned" ? 400 : 100, jobsPerCity: variant === "pinned" ? 80 : 20,
      weeks: 8, ...(variant === "v1" ? { realism: REALISM_V1 } : {}), matcher: (w: any) => {
        const original = ARMS[arm].matcher;
        const matcher = typeof original === "function" ? original(w) : original;
        return { ...matcher, propose(ctx: any) {
          rounds[ctx.week] = { openings: new Map(w.state.openings), hired: new Set(w.state.hired) };
          return matcher.propose(ctx);
        } };
      } });
    const interviewLost = new Set<string>(), decisionLost = new Set<string>();
    for (const f of r.flows) {
      const iw = f.interviewWeek;
      if (iw === undefined) continue;
      const before = rounds[iw], after = rounds[iw + 1];
      const fills = r.hires.filter((h: any) => h.job === f.job && h.week === iw).length;
      if (f.withdrawn && before && before.openings.get(f.job) - fills <= 0 && !r.hires.some((h: any) => h.cand === f.cand && h.week <= iw)) interviewLost.add(f.key);
      if (f.interviewed && f.passed && f.offered === false && after?.openings.get(f.job) === 0 && !after.hired.has(f.cand)) decisionLost.add(f.key);
    }
    const expected = new Set([...interviewLost, ...decisionLost]);
    const normalizeRec = (rec: any) => {
      const x = structuredClone(rec);
      if (decisionLost.has(x.id)) { x.outcome = "declined"; x.declinedBy = [r.flows.find((f: any) => f.key === x.id).job]; }
      return x;
    };
    const normalized = r.flows.map((f: any) => {
      const x = structuredClone(f);
      if (expected.has(f.key)) delete x.roleClosed;
      if (x.rec) x.rec = normalizeRec(x.rec);
      return x;
    });
    const metrics = peonMetrics(r);
    const { lostToClosedRole, ...otherMetrics } = metrics;
    console.log(JSON.stringify({ variant, arm, seed, flows: r.flows.length,
      interviewLost: interviewLost.size, decisionLost: decisionLost.size,
      missing: r.flows.filter((f: any) => expected.has(f.key) && !f.roleClosed).length,
      falseDeclines: r.flows.filter((f: any) => decisionLost.has(f.key) && f.rec.outcome === "declined").length,
      badClosure: r.flows.filter((f: any) => expected.has(f.key) && (!f.roleClosed || f.rec.outcome !== "cancelled" || f.rec.declinedBy?.length)).length,
      lostToClosedRole, metrics, nonClosureMetrics: hash(otherMetrics), flowsNormalized: hash(normalized),
      stateNormalized: hash({ ...r.world.state, interactions: r.world.state.interactions.map(normalizeRec) }),
      hires: hash(r.hires), population: hash(r.world.pop), audits: hash(r.audits), assessed: hash(r.assessed),
      allExpected: hash([...expected].sort()) }));
  }
}

```
