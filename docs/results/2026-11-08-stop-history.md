# Preserve STOP history in interruption scores

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, PostgreSQL 16.15, Windows; isolated local port 54339.

## Requirement and reproduced defect

PRD 28.2 requires a worthwhile-interruption measure; 35.2 requires that measure
in the console scorecard, and 35.3 requires a shared game/database view model.
The existing proxy counts a delivered proactive message positively when its
recipient replies within 72 hours without a STOP in that window.

Both scorecard sources reduced the opt-out event history to one timestamp per
member. In game mode each new STOP overwrote the previous one. The database
reader overwrote it in query-result order, without an ordering guarantee.
After STOP, START and a later STOP, an earlier rejected interruption could
become positive: its original STOP was forgotten, while that same inbound
message still qualified as a reply. Database results could also depend on
which event happened to be read last.

In the seed-4 NYC regression, two delivered proactive messages precede two
STOPs more than 72 hours apart. After the second STOP, both views report
`0.769` instead of `0.760` over 104 eligible messages. This is an accounting
defect in the existing proxy; it does not establish member satisfaction.

## Fix and alternatives

Keep every opt-out timestamp per member in both sources. The shared scorer
checks whether any timestamp falls inside each message's existing 72-hour
window. Game reset clears the complete history as before. No sorting or
database migration is needed; the event ledger already contains the facts.

Keeping only the first STOP would miss rejection in a later window: the paired
worlds contain three such distinct messages. Keeping only the last STOP loses
nine earlier rejected messages. Checking only current opt-out status would
retroactively change historical results when a member resumes. The full list
preserves each message's own history and works regardless of query row order.

The change is confined to scorecard inputs and arithmetic. It does not change
consent, keyword parsing, matching, sending, stored events, schemas, UI code
or the member-state projection addressed separately by PR #407.

## Regression

One integration case drives a real ConsentNetwork game through public controls,
exports its actual rows to PostgreSQL, then reads the score through RealSource.
It uses seed 4, 80 initial generated personas, NYC, engine off and automatic
simulated review. No channel, Network, persistence or reader is mocked.

At day 8 it selects a recent delivered proactive message and sends STOP. After
four days it sends START, waits for the same member's next delivered proactive
message, and sends STOP again. It compares the score to all recorded refusal
windows after the first STOP, after resumed contact, after the second STOP,
and after rewriting the same events in reverse insertion order. The score is
computed independently by collecting rejected and answered message IDs.

The final case fails on unchanged base: **0 pass, 1 fail; 5 assertions; 9.10 s**.
The same case passes in the candidate full suite: **5 assertions; 9.61 s**.

## measurement

Eight paired 21-day worlds use seeds **4, 7, 11, 12**, each with engine **off**
and **engine-v1**. All use ConsentNetwork, 80 initial personas, both cities,
automatic simulated review, time-aware behavior off and start
`2026-10-05T07:00:00Z`.

The complete program below records six snapshots per world: initial day 8;
first STOP; resumed; second STOP; the same second-STOP snapshot with reversed
event insertion; and end of day 21. After four stopped days, the member resumes;
the program waits up to seven days for another proactive message before the
second STOP. Three worlds deliver one; five do not during that bounded wait.
Each snapshot writes and reads real PostgreSQL rows at the same observation
time. All eight worlds finish the full 21 days in each arm.

| Observations across 48 snapshots | Before | After |
| --- | ---: | ---: |
| Incorrect worthwhile-interruption scores, game | 24 | 0 |
| Incorrect worthwhile-interruption scores, database | 19 | 0 |
| Incorrect 70% target decisions, either mode | 0 | 0 |

Nine distinct delivered proactive messages were wrongly credited by the
latest-STOP calculation across the eight worlds. These are deterministic
repeated observations, not independent population samples. No matching-quality
improvement or survey result is claimed. The three initial/first-STOP/resumed
control snapshots in every world remain correct. All denominators are unchanged.

| Seed 4, both cities, engine off | Before, both modes | Corrected, both modes | Eligible messages |
| --- | ---: | ---: | ---: |
| initial | 0.733 | 0.733 | 15 |
| first STOP | 0.667 | 0.667 | 15 |
| resumed | 0.778 | 0.778 | 63 |
| second STOP | 0.778 | 0.762 | 63 |
| reversed event insertion | 0.778 | 0.762 | 63 |
| end | 0.676 | 0.667 | 102 |

Before/after comparisons match every simulation record except run boundaries,
every judge metric after normalizing run ID, native Network state, member
activity counters, and every other game/database statistic and scorecard row.
All persisted rows match after excluding engine elapsed times. The score change
does not alter the simulation or its database export.

## safety_gates

The same seven baseline invariant findings remain: **quiet_hours 5** and
**minor_contact 2**. Canary leaks and runtime errors remain zero. These runs
are not a clean broad safety result. They prove the score correction without
changing the underlying simulation behavior or any safety measurement.

Audit/operations pass **30/30 blocking gates**, with no tracked miss, before
and after. All 31 records match after excluding gate durations and the backup
restore time in its label (36.1 s before, 36.3 s after).
All four typecheck configurations pass.

Integration including the security suite: **676 pass, 8 optional skips, 6 known
Windows baseline failures**; 13,746 assertions; 560.38 s. Failure names and
causes match base: missing `/bin/bash`, SIGTERM 143 versus 0, and four Windows
`.well-known/agent-skills/index.json` path assertions. E2E: **42 pass, 1 optional
browser SDK skip, 0 fail**; 654 assertions; 77.63 s.

The full simulation was not repeated: AGENTS.md limits an agent to one full
run, and that allowance was used earlier. The affected audit/operations blocks
ran in both arms. All data is synthetic; sends remain local and dry-run.

## llm_evidence

Zero validation model calls, provider cost $0. This arithmetic change makes
no model-backed quality claim. Engine-v1 uses its ordinary offline game adapter.

## agent_clients

Codex desktop 26.1103.3517.0, Bun 1.4.2, PostgreSQL 16.15 on Windows. No
member-facing agent entry point changed; no external-client acceptance claim.
No computer use or browser automation. The exact authoring model identifier
is unavailable. Analysis, code, regression and measurement program were
agent-authored; personas and world activity were generated by the repository.

## Reproduce

With local PostgreSQL on 54339 and the repository's test environment:

```text
bun test --conditions eliza-source packages/observatory/test/stop-history.integration.test.ts
bun run typecheck
bun run sim --only audit,ops --json <gate-report.json>
bun run test:integration
bun run test:e2e
```

Save the program below outside the repository as `stop-history-measure.test.ts`.
Run from a clean base checkout and the candidate with separate output paths:

```powershell
$env:STOP_HISTORY_OUTPUT = '../stop-history-before.jsonl'
bun test --conditions eliza-source ../stop-history-measure.test.ts
```

Set the output to `../stop-history-after.jsonl` for the candidate. Compare worlds
by seed/engine and snapshots by phase. Expect every candidate score and
denominator to equal `expected`; the recorded row, state, statistic, record and
metric hashes must match across arms. The nine false-positive message IDs
belong to their respective world; do not deduplicate IDs across different seeds.

```typescript
import { test, setSystemTime } from "bun:test";
import { SQL } from "bun";
import { pathToFileURL } from "node:url";
import { writeFileSync, appendFileSync } from "node:fs";
const root = process.cwd().replaceAll("\\", "/");
const mod = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { GameSource } = await mod("packages/observatory/src/sources/game.ts");
const { RealSource } = await mod("packages/observatory/src/sources/real.ts");
const { rowsFromGame, writeRows } = await mod("packages/observatory/db/writer.ts");
const { testDb, dropTestDb } = await mod("packages/observatory/test/pg.ts");
const HOUR = 3_600_000, DAY = 24 * HOUR, WINDOW = 72 * HOUR;
const output = process.env.STOP_HISTORY_OUTPUT!;
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const configs = [4, 7, 11, 12].flatMap(seed => ["off", "engine-v1"].map(engine => ({ seed, engine })));

test("paired STOP-history measurements", async () => {
  writeFileSync(output, "");
  const url = await testDb(), sql = new SQL(url);
  try {
    for (const config of configs) {
      const game = new GameSource({ ...config, personas: 80, days: 21, network: "consent", city: "all", review: "auto", pushMs: HOUR, tickMs: HOUR });
      try {
        await game.init();
        const step = async (ms: number) => { const r = await game.control({ type: "step", ms }); if (!r.ok) throw Error(r.error); };
        await step(8 * DAY);
        const choose = () => game.world.channel.all().find((m: any) => m.direction === "outbound" && m.meta?.proactive && m.status === "delivered" && m.ts < game.world.clock.now() && game.world.clock.now() - m.ts < DAY && !game.world.channel.isOptedOut(m.memberId));
        for (let i = 0; i < 48 && !choose(); i++) await step(HOUR);
        const first = choose();
        if (!first) throw Error(`No initial proactive message: ${JSON.stringify(config)}`);
        const selected = { member: first.memberId, firstMessage: first.id, firstAt: first.ts };
        const snapshots: any[] = [];
        const snap = async (phase: string, reverseEvents = false) => {
          const state = game.state(), rows = rowsFromGame(game);
          const messages = game.world.channel.all().filter((m: any) => !m.system);
          const stops = game.world.records.filter((r: any) => r.type === "opt_out");
          const rejected = new Set<string>(), answered = new Set<string>();
          for (const r of stops) for (const m of messages) if (m.memberId === r.memberId && r.t >= m.ts && r.t <= m.ts + WINDOW) rejected.add(m.id);
          for (const reply of messages) if (reply.direction === "inbound") {
            for (const m of messages) if (m.memberId === reply.memberId && reply.ts > m.ts && reply.ts <= m.ts + WINDOW) answered.add(m.id);
          }
          const eligible = messages.filter((m: any) => m.direction === "outbound" && m.meta?.proactive && m.status === "delivered" && (state.clock.now - m.ts >= WINDOW || answered.has(m.id)));
          const good = eligible.filter((m: any) => answered.has(m.id) && !rejected.has(m.id));
          const oneStopGood = (latest: boolean) => eligible.filter((m: any) => {
            const times = stops.filter((r: any) => r.memberId === m.memberId).map((r: any) => r.t);
            const t = times.length ? (latest ? Math.max(...times) : Math.min(...times)) : undefined;
            return answered.has(m.id) && !(t !== undefined && t >= m.ts && t <= m.ts + WINDOW);
          }).map((m: any) => m.id);
          const expected = { value: eligible.length ? Math.round(good.length / eligible.length * 1000) / 1000 : null, n: eligible.length, numerator: good.length };
          const goodIds = new Set(good.map((m: any) => m.id));
          const falsePositives = oneStopGood(true).filter((id: string) => !goodIds.has(id));
          const earliestFalsePositives = oneStopGood(false).filter((id: string) => !goodIds.has(id));
          const { matching_runs, ...otherRows } = rows;
          const stableRows = { ...otherRows, matching_runs: matching_runs.map((r: any) => {
            const { wall_ms, summary, ...other } = r; const { wallMs, timingsMs, ...behavior } = summary; return { ...other, summary: behavior };
          }) };
          if (reverseEvents) rows.events.reverse();
          await writeRows(sql, rows, { truncate: true });
          setSystemTime(new Date(state.clock.now));
          const real = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
          try {
            await real.init();
            const rs = real.state();
            if (rs.env.error) throw Error(rs.env.error);
            const view = (s: any) => {
              const metric = s.stats.scorecard.find((x: any) => x.key === "worthwhile_interruption");
              return { value: metric.value, n: metric.n, met: metric.met };
            };
            const otherStats = (s: any) => {
              const { scorecard, ...rest } = s.stats;
              return { ...rest, scorecard: scorecard.filter((x: any) => x.key !== "worthwhile_interruption") };
            };
            snapshots.push({ phase, at: state.clock.now, expected, falsePositives, earliestFalsePositives, game: view(state), real: view(rs),
              stops: stops.filter((r: any) => r.memberId === selected.member).map((r: any) => r.t),
              rowsHash: hash(stableRows), otherGameStatsHash: hash(otherStats(state)), otherRealStatsHash: hash(otherStats(rs)),
              nativeHash: hash(game.consent.exportState()), memberCountersHash: hash(state.members.map((m: any) => [m.id, m.counters])),
            });
          } finally { await real.dispose(); setSystemTime(); }
        };
        const say = async (text: string) => { const r = await game.control({ type: "say", memberId: selected.member, text }); if (!r.ok) throw Error(r.error); };
        await snap("initial");
        await say("STOP"); await step(HOUR); await snap("first STOP");
        await step(4 * DAY); await say("START");
        const resumedAt = game.world.clock.now();
        const next = () => game.world.channel.all().find((m: any) => m.memberId === selected.member && m.direction === "outbound" && m.meta?.proactive && m.status === "delivered" && m.ts > resumedAt);
        for (let i = 0; i < 7 * 24 && !next(); i++) await step(HOUR);
        const second = next();
        await snap("resumed");
        await say("STOP"); await step(HOUR); await snap("second STOP");
        await snap("second STOP, reversed event insertion", true);
        await step(game.state().clock.end - game.world.clock.now()); await snap("end");
        const run = await game.world.complete();
        const result = { ...config, selected, secondMessage: second ? { id: second.id, at: second.ts } : null, snapshots,
          recordsHash: hash(run.records.filter((r: any) => r.type !== "run_start" && r.type !== "run_end")),
          metricsHash: hash({ ...run.metrics, run: { ...run.metrics.run, runId: "normalized" } }), invariants: run.metrics.invariants,
          safety: { leaks: run.metrics.privacy.canaryLeaks, minors: run.metrics.safety.minorContacts, errors: run.metrics.errors },
        };
        appendFileSync(output, JSON.stringify(result) + "\n");
        console.log(JSON.stringify({ ...config, snapshots: snapshots.length, secondMessage: !!second, incorrectGame: snapshots.filter(s => s.game.value !== s.expected.value || s.game.n !== s.expected.n).length, incorrectReal: snapshots.filter(s => s.real.value !== s.expected.value || s.real.n !== s.expected.n).length, invariants: result.invariants.byRule, safety: result.safety }));
      } finally { setSystemTime(); await game.dispose(); }
    }
  } finally { setSystemTime(); await sql.close(); await dropTestDb(); }
}, 600_000);
```
