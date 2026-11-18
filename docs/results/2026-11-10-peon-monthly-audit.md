# Peon monthly audit cadence (2026-11-10)

## Defect and scope

The Peon world calls its monthly adverse-impact audit only at zero-based weeks 3 and 7. Longer runs never audit month three or later. This omits flags and, in the existing `audit: "hold"` ablation, company holds. The public CLI accepts longer horizons through `--weeks`; native callers can supply populations whose candidates and jobs arrive later.

This is a reproduced simulation defect under CONTRIBUTING 3.1 and PRD 34.3/40.8. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. The fix replaces the two fixed week numbers with a four-week cadence. It keeps the original first two audit dates, runs after each complete four-week period, and leaves a partial final period unaudited. Here a simulation month means four weeks, as in the existing schedule; this is not a calendar-month scheduler.

One integration case runs the real engine-backed Peon matcher, generated populations, employer decisions and auditor. It moves candidate join weeks and job posting weeks eight weeks later, without replacing profiles, skills, sealed attributes or oracle functions. In both realism profiles, seed 7 produces an audit flag for `co-sf-19` after the second month. The case checks all three audit modes, the empty first two months, the final report against the actual recorded decisions, and holds on the flagged company's job seats.

Focused regression: **0 pass / 1 fail / 1 assertion → 1 pass / 0 fail / 38 assertions**. The final test file was run unchanged on both revisions. The original code returned two audits instead of four. Runtime: case 1271.25 ms before and 8024.26 ms after; suite 1321.00 ms and 8.06 s. The before case stops at its first assertion; these times do not compare simulation performance.

## measurement

The same program runs **72 native worlds per revision**, with no mocked decisions:

| Matrix | Seeds | Profiles | Audit modes | Population and duration |
|---|---|---|---|---|
| 48 long worlds | 1, 7, 13, 16 | V1 and V2 | off, flag, hold | 200 candidates and 40 jobs per city, NYC and SF; 16 weeks; original arrival dates or all join/posting weeks shifted by +8 |
| 24 boundary worlds | 7 | V2 | off, flag, hold | 80 candidates and 30 jobs per city; 3, 4, 7, 8, 11, 12, 15 and 16 weeks; original arrival dates |

The supplied-population shift is a hand-written scenario using generated people and jobs. It does not fabricate applications, flags or outcomes. For each completed month, the measurement reconstructs employer decisions available by that week from the real flow ledger (`reviewWeek` and `interviewWeek`), then passes those decisions to the existing auditor. Later decisions are excluded. All actual audit records must equal those reconstructed records. The comparison checks complete population hashes, behavior (flows, hires, recruiter hours, closures and assessed candidates), final state, metrics, and all control rows. Map and Set contents are retained in hashes. JSON preserves existing nonfinite metric results as `null` on both revisions.

**Missing monthly audits: 72 → 0.** The world recorded 88 monthly reports before and all 160 due reports after. Every report equals the auditor's result from decisions available at that month end.

- All **32 designated controls** (24 audit-off worlds and eight enabled-audit worlds of at most eight weeks) remain identical in every recorded field. The two enabled-audit 11-week boundary worlds also remain identical: no third month has completed. In total, **34/72 complete rows are unchanged**.
- All **24 flag-only worlds** retain identical behavior and final-state hashes. Their audit reports can now include later flags.
- **70/72 behavior hashes, 66/72 state hashes and 60/72 complete metrics are unchanged.** The six changed states are late-cohort hold worlds with a newly reported company. Only the seed-7 late-cohort hold worlds change flow behavior: intros/delivered probes are 597 → 596 in V1 and 551 → 550 in V2, with corresponding reply/application/qualification and congestion rates changing. No hiring improvement is claimed.
- **All 998 hire records are identical across all 72 paired worlds**, including employer, candidate, time to fill, retention and quality-of-hire fields.

The late-cohort flag and hold runs originally returned two empty reports. The corrected reports are the same by company in V1 and V2:

| Seed | Month 3 (week index 11) | Month 4 (week index 15) | Hidden-truth classification |
|---|---|---|---|
| 1 | no flag | co-nyc-9 | false flag |
| 7 | co-sf-19 | co-sf-19 | discriminatory employer |
| 13 | no flag | co-sf-10 | false flag |
| 16 | no flag | no flag | none |

The hold mode places each flagged company's seats on hold at the first listed audit; flag-only mode adds no holds. The four seed-7 observations (two profiles × flag/hold) now record one detected discriminatory employer each. The eight seed-1/13 observations now record one false flag each. These are repeated world observations, not distinct real employers. Restoring the cadence exposes the auditor's existing false positives as well as its detections. The first two reports and all original-arrival hiring records stay unchanged.

These exact paired simulator comparisons prove audit scheduling; they do not establish real-world discrimination or hiring benefits. The auditor's existing statistical method and thresholds are unchanged. A flag is a request for review, not proof of discrimination; the `hold` mode remains the existing immediate-suspension ablation.

## safety_gates

The same `bun run sim --only peon --json <output>` command passes **27/27 blocking gates before and after**. All **28 complete records** are identical after excluding execution duration, including the pack/keyword/oracle fingerprint. The one tracked record is on target. Runtime: 37.4s before, 36.4s after. The official worlds use seeds 13–16, 400 candidates and 80 jobs per city, V2, eight weeks, with the existing harness and conformance checks. These gates validate the preserved eight-week baseline; the separate 72-world measurement validates longer horizons.

Every safety field is identical in all 72 paired measurement worlds. Minors proposed/matched, scam intros/reach, unverified-employer intros, no-pay-range intros and fake hires remain zero in that matrix. Fake candidates reaching employers remain **135 flow observations** summed across worlds; that existing nonzero result is not hidden or claimed safe. The separate official eight-week gate matrix retains its own complete baseline fingerprint. No statistical threshold, matcher parameter, generated distribution, model-backed path or production service changes.

## Validation

- All four TypeScript configurations pass.
- Integration, including the security suite:

```text
 676 pass
 8 skip
 6 fail
 13779 expect() calls
Ran 690 tests across 69 files. [463.00s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green. The eight optional skips remain.

- E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [43.66s]
```

The one optional SDK/browser test remains skipped.

No new full `bun run sim`: AGENTS.md's one-full-run-per-agent allowance was already used earlier in this session. This revision has fresh affected-block validation. The production audit and staff-review services are not changed. The existing same-batch scam hold issue is a separate draft PR (#449).

## Reproduction

Use Bun 1.4.2 and PostgreSQL 16.15. Disable live-send and deploy flags and provider keys; use the local dev PostgreSQL server on port 54339 for integration and E2E. Start from the current base and this PR in separate checkouts. Save the programs below outside the checkouts. The optional analysis program reads `peon-monthly-audit-before.json` and `peon-monthly-audit-after.json` beside itself.

```sh
bun install --frozen-lockfile
bun test --conditions eliza-source --timeout 120000 packages/sim/test/peon-monthly-audit.integration.test.ts
bun peon-monthly-audit-measure.ts /path/to/base peon-monthly-audit-before.json
bun peon-monthly-audit-measure.ts /path/to/fix peon-monthly-audit-after.json
bun peon-monthly-audit-compare.ts peon-monthly-audit-before.json peon-monthly-audit-after.json comparison.json
bun peon-monthly-audit-analyze.ts
bun run sim --only peon --json gates.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

Copy the new integration file to the base checkout to reproduce its failure before applying the one-line production fix. Run the same Peon gate command in each checkout. `test:integration` includes the full security suite. Keep its known Windows failures visible; do not replace them with a successful exit.

## Design and limits

Adding more explicit dates (weeks 11, 15, etc.) would postpone the same failure to a later horizon. Running only once at the end would miss intermediate flags and holds and would audit incomplete months. The recurring four-week condition uses the existing loop and preserves the established audit phase after weekly decisions. No helper, timer, configuration field, threshold or audit-policy change is needed.

The test matrix covers through 16 weeks, both supported realism profiles, all audit modes, late cohorts and partial months. The recurrence itself has no eight- or sixteen-week cap. It does not change the validity rules for duration inputs, the cumulative decision window used by the auditor, or the statistical quality of its flags. A separate pending duration-validation PR (#442) handles malformed horizons.

## llm_evidence

N/A: this is deterministic simulation scheduling. No model-backed behavior or prompt changes. Validation model calls: **0**, cost: **$0**. No real-model qualification is claimed.

## agent_clients

Codex desktop **26.1103.7773.0**, primary runtime **26.1104.2876.0**, Windows, Bun **1.4.2**, PostgreSQL **16.15**. Authoring provider: OpenAI; exact model identifier unavailable. GitHub connector and Git/gh used directly. No computer/browser use or other client acceptance tests.

## Complete measurement programs

### measure.ts

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = resolve(process.argv[2]!), out = resolve(process.argv[3]!);
const load = (p: string) => import(pathToFileURL(resolve(repo, p)).href);
const { runPeonWorld, REALISM_V1, REALISM_V2 } = await load("packages/sim/src/apps/peon/world.ts");
const { packMatcher } = await load("packages/sim/src/apps/peon/baselines.ts");
const { generatePeonPopulation } = await load("packages/sim/src/apps/peon/persona.ts");
const { auditCompanies } = await load("packages/sim/src/apps/peon/audit.ts");
const { peonMetrics } = await load("packages/sim/src/apps/peon/metrics.ts");
const { PEON_WORLD_START } = await load("packages/sim/src/apps/peon/snapshot.ts");
const json = (x: unknown) => JSON.stringify(x, (_, v) => v instanceof Map ? { map: [...v] } : v instanceof Set ? { set: [...v] } : v);
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(json(x)).digest("hex");
const specs: any[] = [];
for (const profile of ["v1", "v2"]) for (const seed of [1, 7, 13, 16])
  for (const audit of ["off", "flag", "hold"]) for (const shift of [0, 8])
    specs.push({ profile, seed, audit, shift, weeks: 16, perCity: 200, jobsPerCity: 40 });
for (const weeks of [3, 4, 7, 8, 11, 12, 15, 16]) for (const audit of ["off", "flag", "hold"])
  specs.push({ profile: "v2", seed: 7, audit, shift: 0, weeks, perCity: 80, jobsPerCity: 30 });
const rows = [];
for (const spec of specs) {
  const { profile, seed, audit, shift, weeks, perCity, jobsPerCity } = spec;
  const pop = generatePeonPopulation({ seed, perCity, jobsPerCity });
  for (const c of pop.candidates) c.joinWeek += shift;
  for (const j of pop.jobs) j.postedWeek += shift;
  const r = await runPeonWorld({ seed, weeks, pop, realism: profile === "v1" ? REALISM_V1 : REALISM_V2, matcher: packMatcher({ audit }) });
  const expected = [];
  if (audit !== "off") for (let week = 3; week < weeks; week += 4) {
    // Reconstruct the actual decisions available at each month end, excluding later reviews/interviews.
    const flows = r.flows.map((f: any) => ({ ...f, reviewed: f.reviewed && f.reviewWeek <= week, interviewed: f.interviewed && f.interviewWeek <= week }));
    expected.push({ week, flags: auditCompanies(flows, r.world) });
  }
  const row = {
    spec, audits: r.audits, expected,
    auditHolds: r.world.state.safetyHolds.filter((h: any) => h.reason.startsWith("audit:")).map((h: any) => ({ ...h, week: (h.from - PEON_WORLD_START - 12 * 3_600_000) / (7 * 86_400_000), company: r.world.oracle.job.get(h.memberId)?.company })),
    metrics: peonMetrics(r), populationHash: hash(pop), stateHash: hash(r.world.state),
    behaviorHash: hash({ flows: r.flows, hires: r.hires, recruiterHours: r.recruiterHours, closed: r.closed, assessed: r.assessed }),
    hires: r.hires, heldCompanies: [...r.heldCompanies].sort(),
    flows: r.flows.length, reviewed: r.flows.filter((f: any) => f.reviewed).length,
  };
  rows.push(row);
  console.log(JSON.stringify({ done: rows.length, spec, audits: r.audits.length, expected: expected.length, flags: r.audits.map((fs: any[]) => fs.length) }));
}
await Bun.write(out, JSON.stringify(rows, null, 2));
```

### compare.ts

```ts
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
if (before.length !== 72 || after.length !== 72) throw new Error("Expected 72 worlds per revision");
const changed = [], controls = [], safetyChanges = [];
let baseMissing = 0, afterMissing = 0, flagBehaviorUnchanged = 0, auditRecordsBefore = 0, auditRecordsAfter = 0;
for (let i = 0; i < before.length; i++) {
  const a = before[i], b = after[i];
  if (!eq(a.spec, b.spec) || a.populationHash !== b.populationHash) throw new Error(`Input mismatch ${i}`);
  if (!eq(a.audits, a.expected.slice(0, a.audits.length).map((x: any) => x.flags))) throw new Error(`Base audit mismatch ${i}`);
  if (!eq(b.audits, b.expected.map((x: any) => x.flags))) throw new Error(`After audit mismatch ${i}`);
  baseMissing += a.expected.length - a.audits.length;
  afterMissing += b.expected.length - b.audits.length;
  auditRecordsBefore += a.audits.length; auditRecordsAfter += b.audits.length;
  if (b.spec.audit === "off" || b.spec.weeks <= 8) {
    if (!eq(a, b)) throw new Error(`Control changed ${i}`);
    controls.push(i);
  }
  if (b.spec.audit === "flag") {
    if (a.behaviorHash !== b.behaviorHash || a.stateHash !== b.stateHash) throw new Error(`Flag mode changes behavior ${i}`);
    flagBehaviorUnchanged++;
  }
  if (!eq(a.metrics.safety, b.metrics.safety)) safetyChanges.push({ i, spec: b.spec, before: a.metrics.safety, after: b.metrics.safety });
  if (!eq(a, b)) changed.push({ i, spec: b.spec, behaviorSame: a.behaviorHash === b.behaviorHash, stateSame: a.stateHash === b.stateHash, metricsSame: eq(a.metrics, b.metrics), hiresSame: eq(a.hires, b.hires),
    audits: [a.audits.length, b.audits.length], flags: [a.audits.map((fs: any[]) => fs.map(f => f.company)), b.audits.map((fs: any[]) => fs.map(f => f.company))],
    auditCompanies: [[...new Set(a.auditHolds.map((h: any) => h.company))], [...new Set(b.auditHolds.map((h: any) => h.company))]],
    detected: [a.metrics.discrimination, b.metrics.discrimination], hires: [a.hires.length, b.hires.length] });
}
const summary = { worlds: 72, controls: controls.length, flagBehaviorUnchanged, baseMissing, afterMissing, auditRecordsBefore, auditRecordsAfter, changed, safetyChanges };
await Bun.write(process.argv[4]!, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, changed: changed.length, safetyChanges: safetyChanges.length }));
```

### analyze.ts

```ts
const dir = import.meta.dir, prefix = `${dir}/peon-monthly-audit-`;
const a = await Bun.file(`${prefix}before.json`).json(), b = await Bun.file(`${prefix}after.json`).json();
const same = (x: any, y: any) => JSON.stringify(x) === JSON.stringify(y);
const diff = (x: any, y: any, path = ""): any[] => {
  if (same(x, y)) return [];
  if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x)) return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap(k => diff(x[k], y[k], path ? `${path}.${k}` : k));
  return [{ path, before: x, after: y }];
};
const changed = b.flatMap((r: any, i: number) => !same(a[i].metrics, r.metrics) || a[i].stateHash !== r.stateHash ? [{ i, spec: r.spec, behaviorSame: a[i].behaviorHash === r.behaviorHash, metricDiff: diff(a[i].metrics, r.metrics), auditHolds: r.auditHolds, flags: r.audits }] : []);
const safetyTotals = Object.fromEntries(Object.keys(b[0].metrics.safety).filter(k => typeof b[0].metrics.safety[k] === "number").map(k => [k, b.reduce((n: number, r: any) => n + r.metrics.safety[k], 0)]));
const summary = { fullRowsSame: b.filter((r: any, i: number) => same(a[i], r)).length, behaviorSame: b.filter((r: any, i: number) => a[i].behaviorHash === r.behaviorHash).length, stateSame: b.filter((r: any, i: number) => a[i].stateHash === r.stateHash).length, metricsSame: b.filter((r: any, i: number) => same(a[i].metrics, r.metrics)).length, hiresSame: b.filter((r: any, i: number) => same(a[i].hires, r.hires)).length, totalHires: b.reduce((n: number, r: any) => n + r.hires.length, 0), safetyTotals, changed };
await Bun.write(`${prefix}analysis.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, changed: changed.map((r: any) => ({ ...r, auditHolds: [...new Set(r.auditHolds.map((h: any) => `${h.company}@${h.week}`))], flags: r.flags.map((fs: any[]) => fs.map(f => f.company)) })) }));
```
