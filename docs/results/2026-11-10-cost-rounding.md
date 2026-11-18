# Cost summary rounding

Date: 2026-11-10 (Asia/Tokyo). Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, PostgreSQL 16.15, Windows.

This fixes a reproduced defect in the cost panel's backend reader.
Requirement: MVP plan items 10 and 12; `docs/deploy.md` section 7.3.

## Cause and result

`CostView.summary` rounded each category before adding the next category to daily totals.
It also rounded each app/shared contribution to a category before combining them.
These steps discarded or added fractions of a cent before the sum was complete.

App-only budget lines then used that rounded daily total.
With `everyApp` and a total budget, the same app's budget line used an unrounded SQL sum instead.
The same ledger could therefore produce different app budget shares for the two readers.

For example, three app costs of $0.000425, $0.000020 and $0.000035 total $0.000480.
With a $0.000600 budget, the correct share is 80%.
The app-only path returned 66.6667%; the cross-app path returned 80%.
The displayed app total was $0.0004 instead of $0.0005.
A shared `other` cost of $0.000035 also exposed category rounding: $0.000070 displayed as zero instead of $0.0001.

Keep unrounded sums until aggregation and budget-share calculation finish.
Then round monetary display values to the existing four decimal places.
The database, cost recording, budget thresholds, returned fields and decimal display precision stay the same.

Other implementations considered:

1. Add SQL queries for each daily and category total. This adds database work to data already returned by the grouped query.
2. Increase the display precision. This changes the output contract and still rounds before addition.

The open formal-verification PR #438 changes the cost reader's database login for the cross-app total.
Its cost reader patch and regression address that separate issue; they do not change this aggregation.
This measurement uses an isolated local login that can read the fixture, and makes no claim about production login configuration.

## measurement

One PostgreSQL integration case uses the native `CostLedger.record`, `PgCostSink`, and `CostView.summary`.
It fails against the base implementation and passes with the change. There are no mocked methods or SQL results.

| Check | Before | After |
|---|---|---|
| New integration case | 0 pass, 1 fail; 1 assertion reached | 1 pass, 0 fail; 6 assertions |
| Case duration | 2375.84 ms | 2358.01 ms |
| Whole summaries matching the independent ledger calculation | 36/96 | 96/96 |
| Daily totals and category totals | 48/96 | 96/96 |
| Today's app and shared display amounts | 56/96 | 96/96 |
| Budget lines | 64/96 | 96/96 |
| Quantities and estimated share | 96/96 | 96/96 |

The paired program below ran unchanged against base and candidate.
It creates six fixtures through the native ledger: mixed small charges, upward rounding, downward rounding, exact amounts, zeros, and ordinary rates.
Each fixture has four apps, all six supported cost kinds, shared costs, and rows at offsets 0, 1, 13 and 14 days.
It reads one-day and fourteen-day windows with both `everyApp` settings: 6 × 4 × 2 × 2 = 96 summaries.
Each revision writes 600 synthetic rows across six fresh fixture contents.
The current fixture is cleared only in the program's own test database.
No seed applies: the amounts and observation time are fixed.

Expected daily and category amounts come from PostgreSQL's decimal `round(sum(cost_usd), 4)`.
Expected budget lines come from the backend's `budgetLines` using native `ledger.totals`, without display rounding before division.
The comparator tolerates at most 1e-12 in floating values.
The two runs have identical expected results, 36 preserved correct summaries, and 60 corrected summaries.
Every quantity and estimated-share value is unchanged.
All twelve before/after table fingerprints match within their run: the reader changes no ledger row.
Ledger IDs are random; cross-revision raw-row identity is not claimed.

An initial measurement mistakenly compared Bun SQL result-array metadata against ordinary arrays.
That made even equal daily results fail comparison. The capture was discarded.
The program now copies SQL rows into an ordinary array, and both revisions were measured again.
The integration reproduction did not use that comparator and was unaffected.

Commands from the repository root, with the two programs below saved in the parent directory:

```sh
bun install --frozen-lockfile
bun test --conditions eliza-source packages/observatory/test/cost-rounding.integration.test.ts
bun run --conditions eliza-source ../cost-rounding-measure.ts ../base ../cost-rounding-before.json
bun run --conditions eliza-source ../cost-rounding-measure.ts . ../cost-rounding-after.json
bun run ../cost-rounding-compare.ts ../cost-rounding-before.json ../cost-rounding-after.json ../cost-rounding-comparison.json ../cost-rounding-gates-before.json ../cost-rounding-gates-after.json
bun run sim --only audit,ops --json ../cost-rounding-gates-after.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

`../base` is a clean worktree at the base commit with installed dependencies.
The integration case is added to base only for its failing run.
Set `USER=postgres`, `OBSERVATORY_PG_PORT=54339`, `REQUIRE_PG=1`, and the local PostgreSQL binary path.
Start the isolated local cluster before running the tests. The case and measurement drop their own test databases.
The paired gate command also ran on the clean base with a separate output path.

Fresh validation:

- Typecheck: all four configurations passed.
- Integration, including security: 676 pass, 8 skip, 6 fail; 13,747 assertions. Ran 690 tests across 69 files. [428.30s]
- The new regression passed inside the official integration run in 2247.71 ms.
- The six failures match the base failure names and causes: missing /bin/bash, SIGTERM exit 143 versus 0, and four Windows path assertions.
- The eight optional integration skips match the previous completed run.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions. Ran 43 tests across 3 files. [39.61s]
- The optional browser SDK case was skipped. The isolated database was stopped after validation.

A fully green local integration suite is not claimed.

## safety_gates

Fresh `bun run sim --only audit,ops` results: 30 blocking gates and one tracked gate pass on both revisions.
All 31 gate records match after excluding `ms` fields and the backup restore duration in its label.
Base took 25.8 seconds; candidate took 24.7 seconds. No safety threshold or gate classification changes.

The full simulation was not repeated. AGENTS.md's machine-load rule allows one full run per agent, already used earlier in this session.
The fresh evidence for this revision is the affected audit and operations blocks above.

This is reporting arithmetic. Matching, review, consent, outbound delivery and budget alert decisions are unchanged.
The fixture contains only app IDs, cost kinds, numeric amounts and a synthetic provider label.
It has no people, messages, photos, or model output.
The audit and operations blocks use their existing pinned inputs and simulated reviewers where applicable.
Provider keys and live-send/deploy flags were removed from the validation process environment.

## llm_evidence

N/A: aggregation and display rounding use no model. Real-model calls: 0; cost: $0.
Synthetic ledger entries test arithmetic, not the accuracy of provider billing or model responses.

## agent_clients

N/A: this changes an internal cost reader, with no member-facing agent flow.
Codex desktop 26.1103.7773.0 drove Bun 1.4.2. No other client is claimed as tested.
No browser or computer use was performed. The exact assistant model identifier was not exposed.
The disclosure uses the helper's supported `unavailable` value.

## Limits

The measured contract is the native PostgreSQL reader and ledger, not a rendered UI or authenticated HTTP session.
Existing UI display precision stays at four decimals, so a small displayed category can still be zero.
The sum of individually displayed categories can differ from the displayed grand total because each final value rounds independently.
JavaScript floating arithmetic remains in use; this is not an arbitrary-precision accounting implementation.
No production invoice, real provider call, or production workload was tested.

## Paired measurement program

```ts
import { SQL } from "bun";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [root, output] = process.argv.slice(2);
if (!root || !output) throw new Error("usage: cost-rounding-measure.ts REPO OUTPUT");
const from = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { CostLedger, PgCostSink, costBudgetsFromEnv, budgetLines } = await from("packages/network/service/cost.ts");
const { CostView } = await from("packages/observatory/src/ops.ts");
const { testDb, dropTestDb } = await from("packages/observatory/test/pg.ts");
const apps = ["ntwrk", "slop", "peon", "friends"];
const kinds = ["llm", "photo_rating", "otp_verify", "blooio_line", "sms_fallback", "other"];
const fixtures = [
  { name: "mixed_micro", usd: [0.00002, 0.000425, 0, 0, 0, 0.000035], shared: 0.000035 },
  { name: "round_up", usd: kinds.map(() => 0.000065), shared: 0.000065 },
  { name: "round_down", usd: kinds.map(() => 0.000035), shared: 0.000035 },
  { name: "exact_control", usd: kinds.map(() => 0.01), shared: 0.01 },
  { name: "zero_control", usd: kinds.map(() => 0), shared: 0 },
  { name: "ordinary_rates", usd: [0.00042, 0.000425, 0.058, 0, 0.0083, 0.000135], shared: 70 / 30 },
];
const now = Date.UTC(2026, 9, 9, 15), today = "2026-10-09", DAY = 86_400_000;
let at = now;
const url = await testDb(), sql = new SQL({ url, max: 1 }), view = new CostView(() => url);
const errors: string[] = [], ledger = new CostLedger({ sink: new PgCostSink(sql), clock: { now: () => at }, log: (s: string) => errors.push(s) });
const same = (a: any, b: any): boolean => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-12;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a).sort();
    return JSON.stringify(keys) === JSON.stringify(Object.keys(b).sort()) && keys.every(k => same(a[k], b[k]));
  }
  return a === b;
};
const fingerprint = async () => (await sql`select md5(jsonb_agg(to_jsonb(c) order by id)::text) as hash from network.cost_ledger c`)[0].hash;
const results: any[] = [], fingerprints: any[] = [];
try {
  for (const fixture of fixtures) {
    await sql`delete from network.cost_ledger`;
    for (const offset of [0, 1, 13, 14]) {
      at = now - offset * DAY;
      for (const [index, app] of apps.entries()) for (const [i, kind] of kinds.entries()) {
        await ledger.record({ app, kind, provider: "synthetic-local", costUsd: fixture.usd[i]! * (index + 1), quantity: index + 1, estimated: kind !== "llm" });
      }
      await ledger.record({ app: "shared", kind: "other", provider: "synthetic-local", costUsd: fixture.shared });
    }
    if (errors.length) throw new Error(errors.join("\n"));
    const before = await fingerprint(), totals = await ledger.totals(today);
    for (const app of apps) for (const days of [1, 14]) {
      const start = new Date(now - (days - 1) * DAY).toISOString().slice(0, 10);
      const expectedDays = Array.from(await sql`select day::text as day, round(sum(cost_usd),4)::float8 as total
        from network.cost_ledger where day >= ${start}::date and app_id in (${app}, 'shared') group by day order by day desc`);
      for (const d of expectedDays) {
        const byKind = await sql`select kind, round(sum(cost_usd),4)::float8 as usd from network.cost_ledger
          where day = ${d.day}::date and app_id in (${app}, 'shared') group by kind`;
        d.byKind = Object.fromEntries(byKind.map(r => [r.kind, r.usd]));
      }
      const qty = await sql`select kind, sum(quantity)::float8 as qty from network.cost_ledger
        where day >= ${start}::date and app_id in (${app}, 'shared') group by kind`;
      const est = await sql`select coalesce(round(sum(case when estimated then cost_usd else 0 end)/nullif(sum(cost_usd),0),4),0)::float8 as share
        from network.cost_ledger where day >= ${start}::date and app_id in (${app}, 'shared')`;
      const round = (n: number) => Math.round(n * 10000) / 10000;
      for (const everyApp of [false, true]) {
        const env = { [`COST_BUDGET_DAILY_USD_${app.toUpperCase()}`]: "0.001", ...(everyApp ? { COST_BUDGET_DAILY_USD: "1" } : {}) };
        const actual = await view.summary(app, now, { days, env, everyApp });
        const expected = { app, days: expectedDays, today: { day: today, app: round(totals[app] ?? 0), shared: round(totals.shared ?? 0) },
          budgets: budgetLines(totals, costBudgetsFromEnv(env)), quantities: Object.fromEntries(qty.map(r => [r.kind, r.qty])), estimatedShare: est[0].share };
        results.push({ fixture: fixture.name, app, days, everyApp, correct: same(actual, expected),
          checks: Object.fromEntries(Object.keys(expected).map(k => [k, same(actual[k], expected[k])])), actual, expected });
      }
    }
    fingerprints.push({ fixture: fixture.name, before, after: await fingerprint(), rows: Number((await sql`select count(*) as n from network.cost_ledger`)[0].n) });
  }
  await Bun.write(output, JSON.stringify({ results, fingerprints, ledgerErrors: errors }, null, 2));
  console.log(JSON.stringify({ summaries: results.length, correct: results.filter(r => r.correct).length,
    checks: Object.fromEntries(Object.keys(results[0].checks).map(k => [k, results.filter(r => r.checks[k]).length])),
    unchangedLedgers: fingerprints.filter(f => f.before === f.after).length, ledgerRows: fingerprints.reduce((s, f) => s + f.rows, 0) }));
} finally { await view.close(); await sql.close(); await dropTestDb(); }
```

## Paired comparison program

```ts
import { strict as assert } from "node:assert";
const [beforePath, afterPath, output, gatesBeforePath, gatesAfterPath] = process.argv.slice(2);
const before = await Bun.file(beforePath!).json(), after = await Bun.file(afterPath!).json();
const canonical = (x: any): any => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object"
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const same = (a: any, b: any): boolean => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-12;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a).sort();
    return JSON.stringify(keys) === JSON.stringify(Object.keys(b).sort()) && keys.every(k => same(a[k], b[k]));
  }
  return a === b;
};
assert.equal(before.results.length, 96); assert.equal(after.results.length, 96);
let preserved = 0;
for (let i = 0; i < before.results.length; i++) {
  const a = before.results[i], b = after.results[i];
  for (const key of ["fixture", "app", "days", "everyApp"]) assert.deepEqual(a[key], b[key]);
  assert.deepEqual(canonical(a.expected), canonical(b.expected));
  assert.equal(b.correct, true);
  if (a.correct) { assert.deepEqual(canonical(a.actual), canonical(b.actual)); preserved++; }
  for (const key of ["app", "quantities", "estimatedShare"]) assert(same(a.actual[key], b.actual[key]));
}
for (const result of [before, after]) {
  assert.deepEqual(result.ledgerErrors, []);
  for (const f of result.fingerprints) { assert.equal(f.before, f.after); assert.equal(f.rows, 100); }
}
let gates;
if (gatesBeforePath && gatesAfterPath) {
  const a = await Bun.file(gatesBeforePath).json(), b = await Bun.file(gatesAfterPath).json();
  const normalized = (gs: any[]) => gs.map(({ ms, ...g }) => ({ ...g, name: g.name.replace(/restore \d+ ms/, "restore <duration> ms") }));
  assert.deepEqual(normalized(a.gates), normalized(b.gates));
  assert.equal(b.gates.length, 31); assert(b.gates.every((g: any) => g.pass));
  gates = { count: b.gates.length, blocking: b.gates.filter((g: any) => g.blocking).length,
    tracked: b.gates.filter((g: any) => !g.blocking).length, beforeSeconds: a.total, afterSeconds: b.total };
}
const summary = { summaries: 96, beforeCorrect: before.results.filter((r: any) => r.correct).length,
  afterCorrect: 96, preserved, corrected: 96 - preserved,
  fields: Object.fromEntries(Object.keys(before.results[0].checks).map(k => [k, {
    before: before.results.filter((r: any) => r.checks[k]).length,
    after: after.results.filter((r: any) => r.checks[k]).length,
  }])), unchangedLedgerChecks: 12, ledgerRowsPerRevision: 600, gates };
await Bun.write(output!, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
```
