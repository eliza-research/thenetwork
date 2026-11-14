# Observatory member counts require a held meeting

Date: 2026-11-07. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (`main`).
Scope: a reproduced Observatory counting defect, under CONTRIBUTING section 3.1 and the approved Slop bug-fix scope.
PRD sections 34.3–34.4 require outcome and member-experience measurements.
`docs/observatory.md` defines member meeting counters and meeting outcomes in its shared view model.
The report's `people.membersWhoMet` uses `member.counters.meetings > 0`.

## Problem and cause

A member who arrived alone received one meeting credit. The global held-meeting count correctly required two attendees.
This made the Observatory claim that some members had met someone when they had not.
The live game projector counted every arrival. The database reader also counted every `attended` participation, including abandoned opportunities.

Seed 4 produced four held meetings and three solo arrivals. Eight members actually met someone.
Both sources reported ten members who met. Three member counters were wrong:

| Synthetic member | Before | Expected and after |
|---|---:|---:|
| m0014 | 1 | 0 |
| m0015 | 2 | 1 |
| m0076 | 1 | 0 |

## Change and alternatives

The projector credits a member only when at least two people attended.
The SQL aggregate requires `COMPLETED` or `FEEDBACK_COLLECTED`, using its existing `HELD` list.
This matches the existing global count and enjoyment aggregates.
Arrival, cancellation, and no-show records still describe what happened.

Alternatives:

1. Recompute only `membersWhoMet` in the report. This leaves incorrect counters in the state API and member details.
2. Convert solo arrivals to no-shows. This would falsely penalize the member who arrived.
3. Add a new stored counter. Existing outcomes already contain everything needed; no schema change is necessary.

One integration case is added. It runs the actual HTTP server and a 30-day generated world.
It derives expected counts from simulator outcomes, then checks game and PostgreSQL-backed API state.
The case requires both held meetings and solo arrivals, so it cannot pass on an empty simulation.
A separate file keeps its temporary server and database lifecycle together.

## measurement

Environment: Windows, PowerShell 7.6.9, Bun 1.4.2, PostgreSQL 16.15 on local port 54339.
`bun install --frozen-lockfile` succeeded without manifest or lockfile changes.
The same final integration file ran on both revisions:

```sh
bun test --conditions eliza-source --timeout 120000 packages/observatory/test/held-member-counts.integration.test.ts
```

| Revision | Result | Assertions | Elapsed |
|---|---|---:|---:|
| Base, with only the new case copied in | 0 pass, 1 fail | 8 | 5.42s |
| Fixed sources | 1 pass, 0 fail | 8 | 5.14s |

The final assertion compares all 80 member counters in both API responses with the independent outcome tally.
Both source responses failed on the base. Both passed after the fix.

The separate measurement program below ran unchanged on both revisions.
Stub/random worlds used 80 generated personas, 30 days, and `city: "all"`.
ConsentNetwork/engine-v1 worlds used 40 generated personas, 14 days, and the same city selection.
The engine used the simulator's existing automatic reviewer. No live messages or production data were used.

| Sample | Worlds | Solo arrivals | Held meetings | Wrong member counters, before → after | Members who met, before → after | Meeting credits, before → after |
|---|---:|---:|---:|---:|---:|---:|
| Development: stub seed 4 | 1 | 3 | 4 | 3 → 0 | 10 → 8 | 11 → 8 |
| Control: stub seed 7 | 1 | 0 | 11 | 0 → 0 | 16 → 16 | 22 → 22 |
| Held out: stub seeds 11–30 | 20 | 17 | 77 | 17 → 0 | 161 → 145 | 171 → 154 |
| Held out: consent seeds 11–16 | 6 | 3 | 11 | 3 → 0 | 22 → 20 | 25 → 22 |

Each row applies separately to both sources. Totals sum member counts across worlds, not unique people across worlds.
Thirteen held-out stub worlds and two consent worlds contained solo arrivals.
All fixed counts equal the counts derived from actual outcomes. No statistical improvement or population estimate is claimed.

Discovery also sampled stub seeds 1–3 with 40 personas over 10 days; those had no solo arrivals.
Seeds 4–10 with 80 personas over 30 days identified seed 4 and the seed 7 control.
Those exploratory runs did not choose the held-out seed ranges.

Before/after SHA-256 comparisons matched in all 28 worlds for:

- Outcome records, excluding the run-start and run-end envelope records.
- Persisted rows, excluding engine wall-time measurements.
- Judge metrics, with only the run identifier normalized.
- Every other member counter, compared within each source.
- Global held meetings, attendance, no-shows, cancellations, and enjoyment totals.

The first raw-row comparison differed for the six consent worlds.
A seed 15 row diff identified engine `wall_ms`, `summary.wallMs`, and `summary.timingsMs` as the varying fields.
The final program excludes only those fields from its persisted-row fingerprint.
Both complete 28-world measurements were then repeated with that exact program.

## safety_gates

The fresh audit and operations blocks passed before and after:

```sh
bun run sim --only audit,ops --json ../observatory-meeting-gates.json
```

| Check | Before | After |
|---|---:|---:|
| Blocking gates | 30/30 | 30/30 |
| Tracked gates off target | 0 | 0 |
| Gate records | 31 | 31 |
| Total elapsed | 36.7s | 32.1s |

All gate records match after excluding elapsed times.
The tracked backup drill retained 69 tables, 71 rows, and a 274 KiB dump.
Its restore time changed from 4298ms to 3362ms; this is not a performance claim.
No gate or threshold changed.

The sampled worlds retain their exact judge values. They are not uniformly clean:

| Sample | Canary leaks | Minor contacts | Invariant violations | Errors |
|---|---:|---:|---:|---:|
| Development seed 4 | 0 → 0 | 0 → 0 | 1 → 1 | 0 → 0 |
| Control seed 7 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Held-out stub worlds | 0 → 0 | 0 → 0 | 2 → 2 | 0 → 0 |
| Held-out consent worlds | 0 → 0 | 2 → 2 | 4 → 4 | 0 → 0 |

These are pre-existing simulator results, not evidence that every safety measure is zero.
The counter correction changes neither the generated records nor their judge metrics.

## Qualification

| Command | Result |
|---|---|
| `bun run typecheck` | Pass, all four TypeScript projects |
| `bun run test:integration` | 676 pass, 8 skip, 6 baseline failures; 13,748 assertions; 574.07s |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 70.27s |

Integration exits 1. Its exact six failure names and underlying causes match the recorded base results:

- Wrangler OS-session opt-in: `/bin/bash` cannot be spawned on this Windows host.
- Backend boot: SIGTERM exits 143 instead of the expected 0.
- Four site build checks: native Windows paths do not match the expected `.well-known/agent-skills/index.json` string.

The eight integration skips are the optional isolated cleanup reconciliation group.
The e2e skip is the optional browser SDK recovery case; `PLAYWRIGHT_MODULE` was not configured.
The new regression also passed inside the full integration run (5197.74ms).

The full simulation was not repeated. This agent already used its one full-run allowance during the PR #355 work.
AGENTS.md's machine-load rule limits subsequent runs to affected blocks.
The full integration command includes the security suite, so it was not run a second time separately.
The six Windows failure causes were reproduced earlier on the same unchanged base revision.
A fresh full baseline integration run was not repeated for this PR.

## llm_evidence

N/A: the defect is deterministic aggregation of observed attendance.
No model-backed behavior or model quality changes. These reproduction and measurement runs made zero model calls and cost $0 in model API usage.
Runtime provider, model, temperature, and token settings: N/A.

## agent_clients

N/A: no onboarding, agent connector, or member conversation flow changes.
The tests use Bun's HTTP client against the real local Observatory server and PostgreSQL.
Claude Code, ChatGPT, Hermes Agent, OpenClaw, Muse, Grok, elizaOS, and Cursor were not exercised.
No computer use or browser automation was used.

Authoring client: Codex desktop 26.1103.3517.0; provider OpenAI.
The runtime does not expose the exact authoring model ID; it is disclosed as `unavailable`.

## Reproduce and limits

1. Install the pinned dependencies with `bun install --frozen-lockfile`.
2. Start a private local PostgreSQL 16 cluster on port 54339.
3. Set `REQUIRE_PG=1` and the repository's local database environment.
4. Run the integration command above. Expect one passing case after the fix.
5. Copy only that test into base `a0ed7bc` and repeat. Expect the final counter comparison to fail.
6. Save the program below outside the checkout as `observatory-meeting-measure.ts`.
7. Run `bun run --conditions eliza-source ../observatory-meeting-measure.ts ../before.jsonl` from the base checkout.
8. Run the same command from the fixed checkout, writing `../after.jsonl`.
9. Compare each world. Expect no wrong member counters after the fix and identical behavior fingerprints.

The program uses its process-specific test database and closes it afterward.
No schema, dependency, UI markup, style, or copy changes are included.
Displayed meeting counts decrease for members previously credited for arriving alone.
Arrival rates retain their existing meaning. There is no repair of underlying attendance data.
The database reader relies on the existing completed-state definition, as its global meeting count already does.
No hosted CI or external-client success is claimed by these local results.

## Measurement program

```ts
import { pathToFileURL } from "node:url";
import { writeFileSync, appendFileSync } from "node:fs";
import { SQL } from "bun";
const root = process.cwd().replaceAll("\\", "/");
const mod = (path: string) => import(pathToFileURL(root + "/" + path).href);
const { GameSource } = await mod("packages/observatory/src/sources/game.ts");
const { RealSource } = await mod("packages/observatory/src/sources/real.ts");
const { rowsFromGame, writeRows } = await mod("packages/observatory/db/writer.ts");
const { testDb, dropTestDb } = await mod("packages/observatory/test/pg.ts");
const out = Bun.argv[2]!;
writeFileSync(out, "");
const url = await testDb();
const sql = new SQL(url);
const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
// Engine timings are measured in wall time; keep all persisted behavior fields.
const normalizedRows = (rows: any) => ({ ...rows, matching_runs: rows.matching_runs.map((r: any) => {
  const { wall_ms, summary, ...rest } = r;
  const { wallMs, timingsMs, ...behavior } = summary;
  return { ...rest, summary: behavior };
}) });
const cases = [
  ...[4, 7, ...Array.from({ length: 20 }, (_, i) => i + 11)].map(seed => ({ seed, network: "stub", engine: "random", personas: 80, days: 30 })),
  ...[11, 12, 13, 14, 15, 16].map(seed => ({ seed, network: "consent", engine: "engine-v1", personas: 40, days: 14 })),
];
try {
  for (const config of cases) {
    const g = new GameSource({ ...config, city: "all", pushMs: 3_600_000, tickMs: 3_600_000 });
    let real: InstanceType<typeof RealSource> | undefined;
    try {
      await g.init();
      const stepped = await g.control({ type: "step", ms: config.days * 86_400_000 });
      if (!stepped.ok) throw new Error(JSON.stringify(stepped));
      const result = await g.world.complete();
      const state = g.state();
      const expected = new Map<string, number>();
      let solo = 0, held = 0;
      for (const r of result.records) {
        if (r.type !== "outcome") continue;
        const attended = Object.entries(r.attendance).filter(([, a]: any) => a.showed).map(([id]) => id);
        if (attended.length === 1) solo++;
        if (attended.length < 2) continue;
        held++;
        for (const id of attended) expected.set(id, (expected.get(id) ?? 0) + 1);
      }
      const rows = rowsFromGame(g);
      await writeRows(sql, rows, { truncate: true });
      real = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000, service: false });
      await real.init();
      const summarize = (s: any) => ({
        held: s.stats.meetingsHeld,
        peopleWhoMet: s.members.filter((m: any) => m.counters.meetings > 0).length,
        meetingCredits: s.members.reduce((sum: number, m: any) => sum + m.counters.meetings, 0),
        wrongMembers: s.members.filter((m: any) => m.counters.meetings !== (expected.get(m.id) ?? 0)).map((m: any) => m.id),
        otherCountersHash: hash(s.members.map((m: any) => { const { meetings, ...rest } = m.counters; return [m.id, rest]; }).sort((a: any, b: any) => a[0].localeCompare(b[0]))),
        attendance: { attended: s.stats.attended, noShows: s.stats.noShows, cancelled: s.stats.cancelledWithNotice, enjoymentSum: s.stats.enjoymentSum, enjoymentN: s.stats.enjoymentN },
      });
      const row = { ...config, solo, held, expectedPeopleWhoMet: expected.size, expectedCredits: [...expected.values()].reduce((a, b) => a + b, 0),
        game: summarize(state), real: summarize(real.state()), recordsHash: hash(result.records.filter((r: any) => r.type !== "run_start" && r.type !== "run_end")),
        rowsHash: hash(normalizedRows(rows)), metricsHash: hash({ ...result.metrics, run: { ...result.metrics.run, runId: "normalized" } }),
        safety: { leaks: result.metrics.privacy.canaryLeaks, minors: result.metrics.safety.minorContacts, invariants: result.metrics.invariants.total, errors: result.metrics.errors },
      };
      appendFileSync(out, JSON.stringify(row) + "\n");
      console.log(JSON.stringify({ network: config.network, seed: config.seed, solo, held, wrongGame: row.game.wrongMembers.length, wrongReal: row.real.wrongMembers.length }));
    } finally { await real?.dispose(); await g.dispose(); }
  }
} finally { await sql.close(); await dropTestDb(); }
```
