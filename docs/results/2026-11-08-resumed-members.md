# Restore resumed members in the Observatory

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15 on isolated local port 54339.

## Requirement and defect

PRD 35.2 requires live member counts by state and an accurate member timeline.
PRD 35.3 and `docs/observatory.md` require one view model for game and database
modes. This fixes a reproduced projection defect under the approved scope.

Send STOP followed by START through `GameSource.control({type: 'say', ...})`.
The actual channel, persona memory and ConsentNetwork clear their opt-out flags,
but the projector previously returned after counting the inbound message. Its
member stayed `opted_out`; `rowsFromGame` then persisted `opted_out: true`, so
`RealSource` also showed the stale state. A resumed quiet member additionally
lost the quiet participation state in the persisted view.

The projector also counted every STOP cumulatively, while RealSource counts
currently opted-out member rows. A second STOP/START cycle inflated the game
counter further. Historical STOP records remain useful; they are distinct from
the current-state count corrected here.

## Fix and alternatives

On an inbound message with the channel's recognized START keyword, restore an
opted-out member's configured join state (`normal` or `quiet`) and decrement
the current opt-out count. An unjoined persona remains `not_joined`: START does
not claim they joined. Count STOP only when the projected member enters
`opted_out`. Repeated START and unrelated text cannot change an active member
or decrement the count again. Mark the changed member for state updates.

Changing only the label would leave exported rows and counts wrong. Changing
the database reader would leave game state and persistence inconsistent. Always
restoring `normal` would erase quiet mode or make an unjoined persona look active.
The existing join-state callback provides the correct participation state.
No change to keyword recognition, live consent handling, eligibility, message
delivery, database schemas, dependencies or UI code.

## Regression

One real PostgreSQL integration case runs ConsentNetwork and StubNetwork game
worlds with generated personas. It uses the public control path, actual channel
classification, persona memory, native Network state, `rowsFromGame`, `writeRows`
and `RealSource`. Nothing in that path is mocked.

For each Network it checks normal and quiet members, a third member who stays
stopped, unrelated `start later` text, repeated START, and a second STOP/START
cycle. A separate initial-world control verifies that an unjoined persona stays
unjoined after STOP/START. All fixtures use seed 4 and 80 initial personas.

```text
bun test --conditions eliza-source packages/observatory/test/resumed-members.integration.test.ts
```

Base plus the final case: **0 pass, 1 fail; 6 assertions; 10.91 s**.
Candidate: **1 pass, 0 fail; 17 assertions; 17.74 s**.
Base stops at the first completed Network's state comparison; candidate reaches
both Networks and the unjoined controls. The test also passes in the full suite.

## measurement

The same program below runs ten complete 14-day worlds in each arm:

- Seeds 4, 7, 11 and 12 with both ConsentNetwork and StubNetwork, engine off.
- Seed 4 with both Networks and engine-v1 enabled as ordinary matching controls.

Each uses 80 initial personas, both cities, automatic simulated review, time-aware
behavior off and start `2026-10-05T07:00:00Z`. After eight days, select one joined
normal member, one joined quiet member and another normal member to stay stopped.
Record the initial state; stop all three; try unrelated text; resume the normal
member; repeat START; resume the quiet member; stop and resume the normal member
again; then finish the world. Nine snapshots per world each write real PostgreSQL
rows and read them through RealSource. The channel's current opt-out set provides
the expected count; memory and native Network flags are recorded as cross-checks.

| Observation across 90 snapshots | Before | After |
| --- | ---: | ---: |
| Incorrect member-state observations, game | 90 | 0 |
| Incorrect member-state observations, database | 90 | 0 |
| Snapshots with an incorrect current opt-out count, game | 60 | 0 |
| Snapshots with an incorrect current opt-out count, database | 60 | 0 |

There are 20 resumed member trajectories and ten controls that remain stopped.
The 90 state differences are repeated observations, not 90 distinct people or
independent population samples. All selected statuses and all current opt-out
counts match after the fix. No general matching-quality improvement is claimed.

| Phase, seed 4 / ConsentNetwork / engine off | Native opt-outs | Before: game / database | After: both |
| --- | ---: | --- | ---: |
| initial | 0 | 0 / 0 | 0 |
| stopped | 3 | 3 / 3 | 3 |
| not a resume | 3 | 3 / 3 | 3 |
| normal resumed | 2 | 3 / 3 | 2 |
| repeated START | 2 | 3 / 3 | 2 |
| quiet resumed | 1 | 3 / 3 | 1 |
| stopped again | 2 | 4 / 3 | 2 |
| resumed again | 1 | 4 / 3 | 1 |
| end | 1 | 4 / 3 | 1 |

Every paired simulation record and normalized judge metric is identical. The
channel, memory and native Network flags are identical. All member activity
counters and all raw projector counters other than `optOuts` are unchanged.
There are 90 corrected member-row observations across snapshots. Only their
`opted_out` and `participation_state` fields change; every other persisted field
and table matches after excluding engine elapsed times. Record comparison
excludes run-start/end boundaries; metric comparison normalizes run IDs.

## safety_gates

Three baseline invariant findings remain unchanged: `quiet_hours` 1,
`minor_contact` 1 and `send_after_stop` 1. The minor-contact finding is included
in that total. Canary leaks and runtime errors remain zero. This does not claim
clean broad-simulation safety. No gate, threshold or classifier changes.

```text
bun run sim --only audit,ops --json ../resumed-members-gates-<arm>.json
```

Both arms pass **30/30 blocking gates**, zero tracked misses. All 31 result records
match after excluding elapsed times and the backup label's restore-time text.
Base: 36.6 s (audit 22.7, operations 14.0). Candidate: 37.8 s (audit 23.8, operations 14.0).
The full simulation was not repeated: AGENTS.md permits one full run per agent,
and that allowance was used earlier. Only the affected blocks ran.

All four typecheck configurations pass.
Integration, including security: **676 pass, 8 skip, 6 fail**; 13,758 assertions, 583.11 s.
The six failures match the recorded base in name and cause: missing `/bin/bash`
at `uv_spawn`, SIGTERM exit 143 versus expected 0, and four Windows path assertions
for `.well-known/agent-skills/index.json`. Eight optional reconciliation cases skip.
A fully green local integration suite is not claimed.
E2E: **42 pass, 1 skip, 0 fail**; 654 assertions, 74.78 s.
The optional browser SDK case skips. All data was synthetic and live sends disabled.

## llm_evidence

Zero validation model calls; provider cost $0. This deterministic projection does
not invoke a model or claim model-backed quality.

## agent_clients

Codex desktop 26.1103.3517.0 drove Bun and PostgreSQL directly. No member-facing
agent entry point changed and no external-client acceptance is claimed. No
computer use or browser automation. Exact authoring model ID was not exposed;
the disclosure helper's supported `unavailable` value is used.

## Reproducible measurement program

Save this as `../resumed-members-measure.ts` relative to each checkout, use the
same isolated PostgreSQL setup, and run from each repository root:

```text
bun run --conditions eliza-source ../resumed-members-measure.ts ../resumed-members-<arm>.jsonl
```

Compare each snapshot's game and real views with `expected`. Compare the paired
record, metric, counter and row hashes; only the two member-state columns are
excluded from the row hashes. Expected differences are listed above.

```ts
import { pathToFileURL } from "node:url";
import { writeFileSync, appendFileSync } from "node:fs";
import { SQL } from "bun";
const root = process.cwd().replaceAll("\\", "/");
const mod = (p: string) => import(pathToFileURL(`${root}/${p}`).href);
const { GameSource } = await mod("packages/observatory/src/sources/game.ts");
const { RealSource } = await mod("packages/observatory/src/sources/real.ts");
const { rowsFromGame, writeRows } = await mod("packages/observatory/db/writer.ts");
const { testDb, dropTestDb } = await mod("packages/observatory/test/pg.ts");
const output = Bun.argv[2]!; writeFileSync(output, "");
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const url = await testDb(), sql = new SQL(url);
const configs = [
  ...[4, 7, 11, 12].flatMap(seed => ["consent", "stub"].map(network => ({ seed, network, engine: "off" }))),
  ...["consent", "stub"].map(network => ({ seed: 4, network, engine: "engine-v1" })),
];
try {
  for (const config of configs) {
    const game = new GameSource({ ...config, personas: 80, days: 14, city: "all", review: "auto", pushMs: 3_600_000, tickMs: 3_600_000 });
    try {
      await game.init(); await game.control({ type: "step", ms: 8 * 86_400_000 });
      const selected = ["normal", "quiet"].map(state => {
        const m = game.state().members.find((m: any) => m.joined && !m.minor && m.state === state);
        if (!m) throw Error(`Missing ${state} control`);
        return { id: m.id, state: m.state };
      });
      const stayStopped = game.state().members.find((m: any) => m.joined && !m.minor && m.state === "normal" && !selected.some(s => s.id === m.id));
      if (!stayStopped) throw Error("Missing stopped control");
      selected.push({ id: stayStopped.id, state: stayStopped.state });
      const snapshots: any[] = [];
      const snapshot = async (phase: string) => {
        const rows = rowsFromGame(game);
        await writeRows(sql, rows, { truncate: true });
        const real = new RealSource({ url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 });
        try {
          await real.init(); if (real.state().env.error) throw Error(real.state().env.error);
          const expected = {
            optedOut: game.state().members.filter((m: any) => game.world.channel.isOptedOut(m.id)).length,
            states: selected.map(m => ({ id: m.id, state: game.world.channel.isOptedOut(m.id) ? "opted_out" : m.state })),
          };
          const view = (s: any) => ({ optedOut: s.stats.optOuts, states: selected.map(m => ({ id: m.id, state: s.members.find((x: any) => x.id === m.id)?.state })) });
          const { members, matching_runs, ...rest } = rows;
          const stableRows = { ...rest, members: members.map((m: any) => { const { opted_out, participation_state, ...other } = m; return other; }), matching_runs: matching_runs.map((r: any) => {
            const { wall_ms, summary, ...other } = r; const { wallMs, timingsMs, ...behavior } = summary; return { ...other, summary: behavior };
          }) };
          const { optOuts, ...otherCounts } = game.store.counts;
          const stateRows = members.map((m: any) => ({ id: m.id, opted_out: m.opted_out, participation_state: m.participation_state }));
          snapshots.push({ phase, expected, game: view(game.state()), real: view(real.state()),
            native: selected.map(m => ({ id: m.id, channel: game.world.channel.isOptedOut(m.id), memory: game.world.memories.get(m.id)?.optedOut, ...(game.consent ? { network: game.consent.exportState().members.find((x: any) => x.id === m.id)?.optedOut } : {}) })),
            stateRows, otherRowsHash: hash(stableRows), otherCountsHash: hash(otherCounts),
            memberCountersHash: hash(game.state().members.map((m: any) => [m.id, m.counters])),
          });
        } finally { await real.dispose(); }
      };
      const say = async (id: string, text: string) => { const r = await game.control({ type: "say", memberId: id, text }); if (!r.ok) throw Error(r.error); };
      await snapshot("initial");
      for (const m of selected) await say(m.id, "STOP");
      await snapshot("stopped");
      await say(selected[0]!.id, "start later"); await snapshot("not a resume");
      await say(selected[0]!.id, "START"); await snapshot("normal resumed");
      await say(selected[0]!.id, "START"); await snapshot("repeated START");
      await say(selected[1]!.id, "START"); await snapshot("quiet resumed");
      await say(selected[0]!.id, "STOP"); await snapshot("stopped again");
      await say(selected[0]!.id, "START"); await snapshot("resumed again");
      await game.control({ type: "step", ms: 6 * 86_400_000 }); await snapshot("end");
      const run = await game.world.complete();
      const result = { ...config, selected, snapshots, recordsHash: hash(run.records.filter((r: any) => r.type !== "run_start" && r.type !== "run_end")), metricsHash: hash({ ...run.metrics, run: { ...run.metrics.run, runId: "normalized" } }), invariants: run.metrics.invariants, safety: { leaks: run.metrics.privacy.canaryLeaks, minors: run.metrics.safety.minorContacts, errors: run.metrics.errors } };
      appendFileSync(output, JSON.stringify(result) + "\n");
      console.log(JSON.stringify({ ...config, snapshots: snapshots.length, wrongGameStates: snapshots.reduce((n, s) => n + s.game.states.filter((m: any, i: number) => m.state !== s.expected.states[i].state).length, 0), wrongRealStates: snapshots.reduce((n, s) => n + s.real.states.filter((m: any, i: number) => m.state !== s.expected.states[i].state).length, 0), invariants: result.invariants.byRule, safety: result.safety }));
    } finally { await game.dispose(); }
  }
} finally { await sql.close(); await dropTestDb(); }
```
