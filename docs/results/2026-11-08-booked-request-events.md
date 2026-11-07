# Booked request events in Observatory timelines and search

## What changed

- [`packages/observatory/src/events.ts`](../../packages/observatory/src/events.ts): format `request_result` events with `outcome: "booked"` as `` `Request booked in ${p.hours}h` `` with `severity: "good"` instead of falling through to the `waiting` branch.
- [`packages/observatory/test/booked-request-events.integration.test.ts`](../../packages/observatory/test/booked-request-events.integration.test.ts): end-to-end PostgreSQL and HTTP regression test for `request_result` event formatting across `probing`, `booked`, `fulfilled`, and `waiting` outcomes in `/api/member/:id/timeline` and `/api/search`.

When the consent Network books a meeting for a member request (`ConsentNetwork.reveal` in `packages/network/src/network.ts`), it sets `r.outcome = "booked"` and logs a `request_result` event with `{ requestId, memberId, outcome: "booked", hours }` and no `reason` field. Later, when the requester and another participant attend the meeting (`finalizeAttendance`), the Network sets `r.outcome = "fulfilled"` and logs a second `request_result` event with `outcome: "fulfilled"`.

In `packages/observatory/src/events.ts`, `describe()` checked `p.outcome === "fulfilled"` and `p.outcome === "probing"`, then fell back to `` `Request waiting (${human(p.reason)})` `` with `severity = p.outcome === "fulfilled" ? "good" : p.outcome === "waiting" ? "warn" : undefined`. Because `p.reason` is `undefined` on a booked request event, `describe()` returned `text: "Request waiting ()"` and `severity: undefined`. Member timelines (`/api/member/:id/timeline`) showed `"Request waiting ()"` when a request was booked, `/api/search?q=Request%20waiting` returned booked request events as waiting hits, and `/api/search?q=Request%20booked%20in` returned zero hits.

## Fix and alternatives

Add the `p.outcome === "booked"` branch to `describe()` in `packages/observatory/src/events.ts` so booked request events render as `` `Request booked in ${p.hours}h` `` with `severity: "good"`. Both `GameSource` and `RealSource` call `describe()` for timeline entries and event search, so one change fixes both modes.

Other implementations considered:

1. Treat `outcome === "booked"` as `"Request fulfilled in ${p.hours}h"`. That obscures the distinction between a booked meeting and a meeting where attendance was verified (`matching-e2e-7`).
2. Add a separate event type in `packages/network/src/network.ts`. That changes the Network event schema and leaves existing stored `request_result` rows with `outcome: "booked"` broken.
3. Patch only `RealSource.timeline` or `RealSource.search`. That duplicates event formatting and leaves `GameSource` inconsistent with `RealSource`.

No Network state, matching logic, outbound message, database schema, or safety threshold changes.

## Measurement

The integration test in `packages/observatory/test/booked-request-events.integration.test.ts` ran on the unedited `main` base and on the fix. It drives a native `ConsentNetwork` world (`Mini` with seed 1 and the simulated reviewer) where two adults (`a` and `b`) onboard, `a` asks for a climbing partner, both answer probes to book the meeting (`outcome: "booked"`), and both later confirm attendance (`outcome: "fulfilled"`), while a third adult (`c`) asks for a pottery partner with no match (`outcome: "waiting"`, `reason: "density_gap"`). The test writes the state and events to PostgreSQL, starts the Observatory HTTP server in `real` mode, and queries `/api/member/a/timeline`, `/api/search?q=Request%20waiting`, and `/api/search?q=Request%20booked%20in`.

| Observation | Before | After |
|---|---|---|
| Timeline `request_result` (`outcome: "probing"`) for `a` | `"Request: checking 1 candidates"`, `severity: null` | Same |
| Timeline `request_result` (`outcome: "booked"`) for `a` | `"Request waiting ()"`, `severity: null` | `"Request booked in 0h"`, `severity: "good"` |
| Timeline `request_result` (`outcome: "fulfilled"`) for `a` | `"Request fulfilled in 122h"`, `severity: "good"` | Same |
| `/api/search?q=Request%20waiting` hits | `[["a", "Request waiting ()"], ["c", "Request waiting (density gap)"]]` | `[["c", "Request waiting (density gap)"]]` |
| `/api/search?q=Request%20booked%20in` hits | `[]` | `[["a", "Request booked in 0h"]]` |

```text
Before: 0 pass, 1 fail, 4 expect() calls; 4.42 seconds
After:  1 pass, 0 fail, 4 expect() calls; 2.03 seconds
```

Four native `GameSource` simulations (`seeds = [1, 7, 11, 23]`, 80 generated personas, 10 simulated days advanced out of 12, `network: "consent"`, `city: "nyc"`) also ran before and after using the standalone script below.

| Seed | Members | Total `request_result` events | Booked `request_result` events | Misformatted as `"Request waiting ()"` (before -> after) | Formatted as `"Request booked in <h>h"` with `severity: "good"` (before -> after) | `search("Request waiting ()")` hits (before -> after) | `search("Request booked in ")` hits (before -> after) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 84 | 63 | 7 | 7 -> 0 | 0 -> 7 | 7 -> 0 | 0 -> 7 |
| 7 | 85 | 76 | 7 | 7 -> 0 | 0 -> 7 | 7 -> 0 | 0 -> 7 |
| 11 | 82 | 44 | 6 | 6 -> 0 | 0 -> 6 | 6 -> 0 | 0 -> 6 |
| 23 | 88 | 49 | 4 | 4 -> 0 | 0 -> 4 | 4 -> 0 | 0 -> 4 |
| **Total** | **339** | **232** | **24** | **24 -> 0** | **0 -> 24** | **24 -> 0** | **0 -> 24** |

Across all four seeds, channel message SHA-256 hashes (`48d6bcc50be4fa53`, `ae37481f8e0de8a5`, `f3ef1b26cd950ea7`, `4fcdbb36a26aa95c`), scorecard metrics, and safety judge results are identical before and after. Canary leaks, minor contacts, and invariant violations are `0` on every seed before and after.

## Validation and safety_gates

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | Frozen lockfile verified; no changes |
| `bun test --conditions eliza-source packages/observatory/test/booked-request-events.integration.test.ts` (before fix) | 0 pass, 1 fail; 4 assertions; 4.42 seconds |
| `bun test --conditions eliza-source packages/observatory/test/booked-request-events.integration.test.ts` (after fix) | 1 pass, 0 fail; 4 assertions; 2.03 seconds |
| `bun run typecheck` | All four TypeScript configurations passed with 0 errors |
| `bun run sim --only audit,ops --json /tmp/sim-audit-ops.json` | 27/27 blocking gates passed (audit 16/16, ops 11/11); 66.5 seconds |
| `bun test --conditions eliza-source packages/observatory/test/real-console.test.ts` | 8 pass, 0 fail; 1,076 assertions; 37.68 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 26.14 seconds |
| `bun run security` | 176 pass, 0 fail; 2,647 assertions; 44.82 seconds |

Safety gates across all four seeds (`[1, 7, 11, 23]`):

- `invariants`: `0` before, `0` after
- `canaryLeaks`: `0` before, `0` after
- `minorContacts`: `0` before, `0` after

## llm_evidence

N/A: `describe()` in `packages/observatory/src/events.ts` is a deterministic event formatter and does not call an LLM.
Real-model calls: 0. Cost: $0. Request settings: N/A.

## agent_clients

N/A: no member-facing agent or MCP client flow changed.
Antigravity (`google/gemini-3.1-pro-preview`) drove Bun, PostgreSQL, and local HTTP requests.

## Reproduction and limits

Run the integration test against local PostgreSQL:

```bash
bun test --conditions eliza-source packages/observatory/test/booked-request-events.integration.test.ts
```

To reproduce the four-seed simulation comparison, save the script below outside the checkout as `/tmp/booked-request-events-game.ts` and run it from the repository root:

```bash
BOOKED_REQ_GAME_OUTPUT=/tmp/booked-request-events-game-before.json bun run --conditions eliza-source /tmp/booked-request-events-game.ts
```

Limits:

- This change updates event formatting in `describe()` (`packages/observatory/src/events.ts`) for `request_result` rows with `outcome: "booked"`.
- It does not add a separate live-feed entry in `Projector` when a request is booked because `meeting_scheduled` already pushes a `"Meeting set"` feed item at booking time.

```ts
import { pathToFileURL } from "node:url";

const root = process.cwd().replaceAll("\\", "/");
const { GameSource } = await import(pathToFileURL(`${root}/packages/observatory/src/sources/game.ts`).href);
const { describe, eventOf } = await import(pathToFileURL(`${root}/packages/observatory/src/events.ts`).href);

const DAY = 86_400_000;
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const results = [];

for (const seed of [1, 7, 11, 23]) {
  const game = new GameSource({ seed, personas: 80, days: 12, network: "consent", city: "nyc", pushMs: 3_600_000, tickMs: 3_600_000 });
  try {
    await game.init();
    if (!(await game.control({ type: "step", ms: 10 * DAY })).ok) throw Error("World did not advance");
    const state = game.state();
    const records = game.world.records;
    const rows = records.map(eventOf).filter((x: unknown): x is Record<string, any> => !!x);
    const requestResults = rows.filter((r: any) => r.type === "request_result");
    const bookedRows = requestResults.filter((r: any) => r.payload?.outcome === "booked");
    const describedBooked = bookedRows.map((r: any) => describe(r, (id: string) => game.store.member(id)?.name ?? id));
    const misformattedBooked = describedBooked.filter((e: any) => e.text === "Request waiting ()" || e.severity !== "good");
    const properlyFormattedBooked = describedBooked.filter(
      (e: any) => /^Request booked in \d+h$/.test(e.text) && e.severity === "good" && e.detail?.outcome === "booked",
    );
    const searchWaitingEmpty = (await game.search("Request waiting ()", 500)).length;
    const searchRequestBooked = (await game.search("Request booked in ", 500)).length;
    results.push({
      seed,
      members: state.members.length,
      requestResultsTotal: requestResults.length,
      bookedEvents: bookedRows.length,
      misformattedBooked: misformattedBooked.length,
      properlyFormattedBooked: properlyFormattedBooked.length,
      searchWaitingEmpty,
      searchRequestBooked,
      sampleTexts: describedBooked.slice(0, 3).map((e: any) => ({ text: e.text, severity: e.severity ?? null, detail: e.detail })),
      channelHash: hash(game.world.channel.all()),
      scorecard: state.stats.scorecard,
      safety: state.stats.judge,
    });
  } finally {
    await game.dispose();
  }
}

if (process.env.BOOKED_REQ_GAME_OUTPUT) {
  await Bun.write(process.env.BOOKED_REQ_GAME_OUTPUT, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results.map(({ channelHash, scorecard, safety, ...r }) => ({
  ...r,
  invariants: safety?.invariants ?? 0,
  canaryLeaks: safety?.canaryLeaks ?? 0,
  minorContacts: safety?.minorContacts ?? 0,
})), null, 2));
```
