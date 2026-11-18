# Remove retracted acceptances from member counts

Date: 2026-11-08. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (`main`).
Scope: a reproduced defect under CONTRIBUTING section 3.1 and the approved Slop bug-fix scope.
PRD 35.2 requires member activity and opportunity metrics. PRD 35.3 specifies one view model for simulated worlds and the real database.

## Problem and change

The game projector counts a member's acceptance when a meeting is booked.
If that member then refuses, the projector changes the participant status to `declined` and decrements the overall acceptance count.
It fails to decrement the member's `counters.accepted` value.
The database view excludes that declined participation, so the same world gives different member counts in game and persisted modes.

Decrement the member counter in the existing branch that retracts an overall acceptance.
That branch runs only when the prior status was `accepted`, `countered`, or `confirmed`.
An initial refusal does not subtract an acceptance. The existing check for an unchanged status prevents counting the same refusal twice.
The counter helper also marks the member for the next state delta.

Alternatives considered:

1. Recompute every member's counter from all opportunities on every state request. This adds a separate calculation to the incremental projector.
2. Change SQL and overall counters to count every historical yes. This changes the metric's meaning and preserves the inconsistency with current participant statuses.

This fix uses the existing status transition and counter update.
PR #402 fixes held-meeting counts in the same projector; it is separate and is not included here.

## measurement

Runtime: Windows, PowerShell 7.6.9, Bun 1.4.2, PostgreSQL 16.15 on local port 54339 with `REQUIRE_PG=1`.
The frozen install changed no dependency or lockfile.
Worlds start at the repository's `DEFAULT_START`, 2026-10-05T07:00:00Z.
They use generated synthetic personas, the real `engine-v1`, the policy persona agent, both cities, and the actual simulated channel.
ConsentNetwork worlds use the simulated automatic reviewer. No live message is sent.

The primary reproduction is seed 4, 80 initial personas, 21 days, ConsentNetwork, and `timeAware: true`.
The real policy agent refuses a booked meeting for member `m0038` (opportunity `nw-4-69`).
The participation becomes `declined`; the member has no remaining accepted participation.
Game mode still reports one acceptance. Persisting the unmodified world rows and reading them through `RealSource` reports zero.
The overall count is already correct at 11, while the game member counters sum to 12.
After the fix the member count is zero and both sums are 11.

One integration case runs that world and an ordinary, non-time-aware control using the same seed and population.
It advances through the real game controls, completes the worlds, verifies actual booked-refusal decisions and final statuses,
writes their rows through `writeRows`, and opens the real PostgreSQL reader.
It checks both modes' member counts against accepted participant statuses, including positive acceptances.
No decision, booking, participation, status, or database row is fabricated.

```sh
bun test --conditions eliza-source packages/observatory/test/declined-accept-count.integration.test.ts
```

| Revision | Result | Assertions | Elapsed |
|---|---|---:|---:|
| Base plus the new case | 0 pass, 1 fail | 11 | 10.76s |
| Fixed projector | 1 pass, 0 fail | 11 | 8.58s |

The paired program below tests 20 complete worlds on both revisions:

- ConsentNetwork with time awareness: seed 4 for development; seeds 7 and 11–20 for additional validation; 80 initial personas and 21 days each.
- ConsentNetwork without time awareness: seeds 4, 7, 11, 12; 80 initial personas and 21 days each.
- Stub controls: seeds 4 and 7, each with time awareness off and on; 80 initial personas and 30 days each. The stub has no human-review or leak-check guarantee.

| Worlds | Member counts that disagree with actual statuses, before → after | Game acceptance total, before → after | Correct persisted total, before → after |
|---|---:|---:|---:|
| Primary time-aware ConsentNetwork world | 1 → 0 | 12 → 11 | 11 → 11 |
| 11 additional time-aware ConsentNetwork worlds | 21 → 0 | 142 → 121 | 121 → 121 |
| Four non-time-aware ConsentNetwork worlds | 1 → 0 | 91 → 90 | 90 → 90 |
| Four stub worlds | 0 → 0 | 394 → 394 | 394 → 394 |
| Total | 23 → 0 | 639 → 616 | 616 → 616 |

These are member/world observations, not unique people across seeds.
The extra error in the non-time-aware seed 11 world is also a retracted acceptance and uses the same guarded branch.
No statistical match-quality or live-member outcome improvement is claimed.

Across all 20 paired worlds, every run-record fingerprint matches after excluding run-start/end envelopes.
All judge metrics match after normalizing only the run ID.
All persisted row fingerprints match after excluding engine wall-time measurements (`wall_ms`, `summary.wallMs`, `summary.timingsMs`).
Every other member counter is identical in each mode; overall accepted, declined, scheduled, and held counts are identical.
The real reader's acceptance totals and per-member results remain unchanged and correct.

## safety_gates and qualification

**The supplementary worlds do not have zero invariant findings.** Their baseline findings remain identical after this change to the member counter:

| Judge finding | Before | After |
|---|---:|---:|
| ConsentNetwork: `minor_contact` | 7 | 7 |
| ConsentNetwork: `quiet_hours` | 11 | 11 |
| Stub: `over_budget` | 8 | 8 |
| Stub: `decliner_exposed` | 6 | 6 |
| Total invariant findings | 32 | 32 |
| Canary leaks | 0 | 0 |
| Runtime errors | 0 | 0 |

Minor-contact totals are seven on both revisions, and those seven are included in the invariant total.
These findings were present on the unchanged base. They are not dismissed as benign and are not repaired by this metric fix.
The comparisons preserve every metric and example; the report does not claim that these broader worlds satisfy the repository's zero-safety-finding target.

| Command | Result |
|---|---|
| `bun run typecheck` | All four configurations pass |
| `bun run sim --only audit,ops --json <output>` on base | 30/30 blocking gates pass; zero tracked misses; 34.6s |
| Same command on the fix | 30/30 blocking gates pass; zero tracked misses; 33.1s |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,752 assertions; 563.13s |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 78.65s |

All 31 affected-block gate records match after removing elapsed times, including the restore time embedded in the backup-drill label.
Audit retains its pinned seed 3, nine-day world. Operations retains its seeded database and backup/restore checks.
Integration includes the security suite; that subset was not repeated separately.
The full simulation allowance in AGENTS.md was used during PR #355. That earlier run is not evidence for this change.

The integration suite is not green. All six failure names and causes match failures previously reproduced on the same unchanged base:
missing `/bin/bash` (`ENOENT`, `uv_spawn`), SIGTERM exit 143 instead of 0, and four Windows path checks for `.well-known/agent-skills/index.json`.
A fresh full baseline integration suite was not repeated for this PR.
The eight integration skips are opt-in completed-cleanup reconciliation; the e2e skip is the optional browser-SDK case requiring `PLAYWRIGHT_MODULE`.

## llm_evidence

N/A: deterministic event projection. These runs use policy personas, not mocked model output.
Real-model calls: zero; model API cost: $0. Provider, model, temperature, and token settings for validation: N/A.

## agent_clients

N/A: this changes an internal activity counter, with no agent connector or conversation-protocol change.
No external-client or browser acceptance is claimed. No computer use was performed.
Authoring: OpenAI, Codex desktop 26.1103.3517.0. The exact authoring model ID is unavailable and is disclosed as such.

## Reproduce and limits

1. Install pinned dependencies with `bun install --frozen-lockfile` and provide local PostgreSQL on port 54339.
2. Run the integration case above. Expect one passing case and 11 assertions.
3. Restore only `projector.ts` from base and repeat. Expect the game count for `m0038` to remain one when the status and SQL count say zero.
4. Save the program below outside the checkout as `declined-accept-measure.ts`.
5. From base run `bun run --conditions eliza-source ../declined-accept-measure.ts ../before.jsonl`.
6. Repeat from the fix, writing `../after.jsonl`. Expect 23 stale acceptance credits removed, 616 valid credits retained, and the invariant findings above unchanged.

The fix changes a derived game counter. Existing saved SQL rows already have the correct statuses; no data migration applies.
An existing game projection must be rebuilt to repair a count accumulated by the old code.
This PR does not change UI, message copy, matching, consent decisions, schema, dependencies, or thresholds.
No credentials, raw run logs, `.env`, `runs/`, or real member data are included.

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
const url = await testDb(), sql = new SQL(url);
const yes = new Set(["accepted", "countered", "confirmed", "attended", "no_show", "cancelled_with_notice"]);
const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
const normalizedRows = (rows: any) => ({ ...rows, matching_runs: rows.matching_runs.map((r: any) => {
  const { wall_ms, summary, ...rest } = r;
  const { wallMs, timingsMs, ...behavior } = summary;
  return { ...rest, summary: behavior };
}) });
const cases = [
  ...[4, 7, ...Array.from({ length: 10 }, (_, i) => i + 11)].map(seed => ({ seed, network: "consent", timeAware: true, days: 21 })),
  ...[4, 7, 11, 12].map(seed => ({ seed, network: "consent", timeAware: false, days: 21 })),
  ...[4, 7].flatMap(seed => [false, true].map(timeAware => ({ seed, network: "stub", timeAware, days: 30 }))),
].map(c => ({ ...c, engine: "engine-v1", personas: 80 }));
try {
  for (const config of cases) {
    const game = new GameSource({ ...config, city: "all", review: "auto", pushMs: 3_600_000, tickMs: 3_600_000 });
    let real: InstanceType<typeof RealSource> | undefined;
    try {
      await game.init();
      const stepped = await game.control({ type: "step", ms: config.days * 86_400_000 });
      if (!stepped.ok) throw Error(JSON.stringify(stepped));
      const result = await game.world.complete(), state = game.state();
      const expected = new Map<string, number>();
      for (const o of state.opportunities.filter((o: any) => o.source !== "shadow")) {
        for (const id of o.participants) if (yes.has(o.status[id])) expected.set(id, (expected.get(id) ?? 0) + 1);
      }
      const rows = rowsFromGame(game);
      await writeRows(sql, rows, { truncate: true });
      real = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000, service: false });
      await real.init();
      if (real.state().env.error) throw Error(real.state().env.error);
      const summarize = (s: any) => ({
        total: s.members.reduce((n: number, m: any) => n + m.counters.accepted, 0),
        wrongMembers: s.members.filter((m: any) => m.counters.accepted !== (expected.get(m.id) ?? 0)).map((m: any) => ({ id: m.id, actual: m.counters.accepted, expected: expected.get(m.id) ?? 0 })),
        otherCountersHash: hash(s.members.map((m: any) => { const { accepted, ...rest } = m.counters; return [m.id, rest]; }).sort((a: any, b: any) => a[0].localeCompare(b[0]))),
        global: { accepted: s.stats.accepts, declined: s.stats.declines, scheduled: s.stats.meetingsScheduled, held: s.stats.meetingsHeld },
      });
      const row = { ...config,
        bookedRefusals: result.records.filter((r: any) => r.type === "decision" && r.intent === "booked_cancel").length,
        expectedTotal: [...expected.values()].reduce((a, b) => a + b, 0),
        game: summarize(state), real: summarize(real.state()),
        recordsHash: hash(result.records.filter((r: any) => r.type !== "run_start" && r.type !== "run_end")),
        rowsHash: hash(normalizedRows(rows)), metricsHash: hash({ ...result.metrics, run: { ...result.metrics.run, runId: "normalized" } }),
        invariants: result.metrics.invariants,
        safety: { leaks: result.metrics.privacy.canaryLeaks, minors: result.metrics.safety.minorContacts, invariants: result.metrics.invariants.total, errors: result.metrics.errors },
      };
      appendFileSync(out, JSON.stringify(row) + "\n");
      console.log(JSON.stringify({ ...config, bookedRefusals: row.bookedRefusals, expected: row.expectedTotal, game: row.game.total, real: row.real.total, wrongGame: row.game.wrongMembers.length, wrongReal: row.real.wrongMembers.length, safety: row.safety, rules: row.invariants.byRule }));
    } finally { await real?.dispose(); await game.dispose(); }
  }
} finally { await sql.close(); await dropTestDb(); }
```
