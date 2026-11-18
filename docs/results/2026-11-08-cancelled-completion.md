# Completion after a booking is cancelled

Date: 2026-11-08. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement and cause

PRD 28.2 requires completion of at least 70% of mutually accepted opportunities.
PRD 35.2 places completion in the console scorecard; 35.3 specifies one game/database view model.
The existing scorecard defines the denominator as mutually accepted opportunities whose meeting time has passed.

The shared `scorecard` function omitted `CANCELLED` from its accepted opportunity states.
A mutually accepted booking therefore disappeared from the denominator after a member cancelled.
The database preserved both its cancelled state and its meeting time correctly.

The native reproduction uses the repository's `Mini` flow harness and real `ConsentNetwork`:
two adults onboard, receive probes, answer yes, book a meeting, and one replies, "I can't make it anymore".
The exported opportunity changes from scheduled to closed, with `closedFrom: "scheduled"` and the original meeting time.
`PgStore.save` writes it as `CANCELLED`.
After that time passes, the Observatory HTTP API reports no eligible meetings, instead of one incomplete booking.

## Fix and alternatives

Count a cancelled opportunity when it has a recorded meeting time and that time is due.
Keep future cancellations and cancellations without a meeting time outside this denominator.
The shared function applies this rule to both sources.

Other implementations considered:

1. Count every cancellation immediately. That includes future bookings and cancellations with no evidence of a scheduled meeting.
2. Store cancelled bookings as abandoned meetings. That destroys the distinction between an explicit cancellation and a failed meeting.
3. Correct only the database query. That duplicates scorecard arithmetic and leaves the game implementation different.

No booking state, participation status, message, scheduling behavior, threshold, or display text changes.

## Measurement

The same final integration case ran on the clean base and the fix.
It uses real PostgreSQL, `PgStore`, the Observatory server, and `/api/state` after an explicit refresh.
There is one native booking and cancellation, with two synthetic adults and Mini's default seed 1 and simulated reviewer.
Controlled database rows then check held, abandoned, future-cancelled, unscheduled-cancelled, and unbooked states.
Those rows test metric projection; they are not claimed as additional native meetings.
Seven HTTP snapshots compare the denominator, completion rate, and whether the 70% target is met.

| Snapshot | Before | After |
|---|---|---|
| Scheduled booking, one hour before due | No value; n=0 | Same |
| Cancelled booking, one hour before due | No value; n=0 | Same |
| Native cancellation, when due | No value; n=0 | 0%; n=1; target not met |
| Native cancellation, one hour later | No value; n=0 | 0%; n=1; target not met |
| Add one held-meeting control | 100%; n=1; target met | 50%; n=2; target not met |
| Add abandoned, future-cancelled, unscheduled, and unbooked controls | 50%; n=2 | 33.3%; n=3 |
| Later cancelled booking becomes due | 50%; n=2 | 25%; n=4 |

Incorrect snapshots: 5/7 before, 0/7 after.
These are repeated observations of one workflow and controlled rows, not independent population samples.
This corrects a measurement; it does not claim higher underlying completion.

```text
Before: 0 pass, 1 fail, 4 expect() calls; 2.61 seconds
After:  1 pass, 0 fail, 4 expect() calls; 3.00 seconds
```

The first fixture used PostgreSQL's current default timestamps for its control rows.
That advanced the reader's clock beyond the intended simulated date and made the future case fail.
The fixture now sets those timestamps explicitly and checks future bookings one hour before they are due.
The corrected final file was rerun on both revisions. There was one production-fix candidate.

Two native game controls also ran before and after, using the program below.
Each starts with 80 generated personas, advances ten of twelve days, and uses the consent Network and simulated reviewer.
Seeds 1 and 7 end with 84 and 85 members after growth joins.
The completion denominator is checked independently against due `meeting_scheduled` records.
The numerator is checked against outcomes with at least two attendees.

| Seed | Due bookings | Held meetings | Completion, before and after |
|---|---:|---:|---:|
| 1 | 5 | 2 | 40% |
| 7 | 8 | 7 | 87.5% |

Both worlds retain identical full scorecards, channel-record hashes, meeting-record hashes, and judge results.
They total 13 due bookings and nine held meetings.
Canary leaks, minor contacts, and invariant violations are zero on each revision for both controls.

## Validation and safety_gates

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | 50 installs checked across 44 packages; no changes |
| Final integration case on clean base | 0 pass, 1 fail; 4 assertions; 2.61 seconds |
| Final integration case on fix | 1 pass, 0 fail; 4 assertions; 3.00 seconds |
| `bun run typecheck` | All four configurations passed |
| Native game-control program | Both worlds agree with meeting records; complete before/after JSON outputs identical |
| `bun run sim --only audit,ops --json <output>` | Both 30/30 blocking gates passed; zero tracked misses |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,745 assertions; 378.09 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 36.16 seconds |

All 31 audit/operations gate records match after excluding elapsed time and the backup timing label.
Both gate runs took 25.4 seconds.
The full simulation was not repeated: AGENTS.md permits one per agent, already used earlier in this contribution session.

The integration command includes every file listed by `bun run security`.
The new regression passed there in 2.23 seconds.
All six failures match the previously reproduced base failures by name and cause:
missing `/bin/bash` for Wrangler, SIGTERM exit 143 instead of 0, and four Windows site-path assertions.
The eight integration skips are optional reconciliation cases; the end-to-end skip requires the optional browser SDK.
A fully green integration suite is not claimed.

Live sends and deploy flags were disabled. PostgreSQL used isolated process-specific local databases.
No production data, provider traffic, UI, copy, dependency, or safety-threshold changes.

## llm_evidence

N/A: completion arithmetic is deterministic and does not use a model.
The native flow and game controls use the existing policy agents and simulated reviewer.
Real-model calls: 0. Cost: $0. Request settings: N/A.

## agent_clients

N/A: no member-facing agent flow changed.
Codex desktop 26.1103.3517.0 drove Bun, PostgreSQL, and local HTTP calls.
No browser or computer use was performed. No other client is claimed as tested.
Provider: OpenAI. The exact assistant model identifier was unavailable.

## Reproduction and limits

Run `bun test --conditions eliza-source packages/observatory/test/cancelled-completion.integration.test.ts` with local PostgreSQL.
Expect one passing case with four aggregate assertions. The case skips if PostgreSQL is unavailable.
The full test file contains the booking, cancellation, persistence, HTTP reads, fixture rows, and expected values.

This relies on a stored meeting time as evidence that a cancelled opportunity was booked.
Records without that evidence remain excluded.
This does not address the separate native attendance-persistence issue described in PR #359.
The native reproduction here cancels before attendance, so it does not depend on that issue's fix.

Save this game-control program outside each checkout as `cancelled-completion-game.ts`.
Run it from the checkout root with `COMPLETION_GAME_OUTPUT` set to the desired JSON output file.

```powershell
$env:COMPLETION_GAME_OUTPUT = '../cancelled-completion-game-before.json' # use -after.json for the fix
bun run --conditions eliza-source ../cancelled-completion-game.ts
```

Require each output's `actual` to equal `expected`, then compare the complete before/after JSON arrays.

```ts
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const { GameSource } = await import(pathToFileURL(`${root}/packages/observatory/src/sources/game.ts`).href);
const DAY = 86_400_000, results = [];
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
for (const seed of [1, 7]) {
  const game = new GameSource({ seed, personas: 80, days: 12, network: "consent", city: "nyc", pushMs: 3_600_000, tickMs: 3_600_000 });
  try {
    await game.init();
    if (!(await game.control({ type: "step", ms: 10 * DAY })).ok) throw Error("World did not advance");
    const state = game.state(), records = game.world.records;
    const scheduled = records.filter((r: any) => r.type === "meeting_scheduled" && r.at <= state.clock.now);
    const outcomes = records.filter((r: any) => r.type === "outcome" && r.t <= state.clock.now);
    const due = new Set(scheduled.map((r: any) => r.proposalId)).size;
    const held = new Set(outcomes.filter((r: any) => Object.values(r.attendance).filter((a: any) => a.showed).length >= 2).map((r: any) => r.proposalId)).size;
    const expected = { n: due, value: due ? Math.round(held / due * 1000) / 1000 : null };
    const completion = state.stats.scorecard.find((m: any) => m.key === "completion");
    results.push({ seed, personas: state.members.length, held, expected, actual: { n: completion.n, value: completion.value },
      channelHash: hash(game.world.channel.all()), meetingHash: hash([scheduled, outcomes]), scorecard: state.stats.scorecard,
      safety: state.stats.judge });
  } finally { await game.dispose(); }
}
await Bun.write(process.env.COMPLETION_GAME_OUTPUT!, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ channelHash, meetingHash, scorecard, safety, ...r }) => r)));
```
