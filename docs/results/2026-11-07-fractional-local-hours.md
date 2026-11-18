# Fractional local hours retain their minutes

Date: 2026-11-07. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Environment: Windows, Bun 1.4.2, PostgreSQL 16.15, PowerShell 7.6.9.

## Requirement and defect

This is a reproduced scheduling bug under the approved contribution scope.
PRD 28.3 and 32.12 require availability capture and time proposals.
PRD 40.6 covers the Friends planner and its local simulation.

The existing attention configuration accepts numeric template hours and digest hours.
For example, a template hour of `19.5` describes 19:30.
`candidateSlots` passes that value through core's shared `fromLocal` conversion.
The converter passed it into the hour argument of `Date.UTC`, which discards the fractional part.
Real Friends plans and offered options therefore used 19:00 instead of 19:30.
The digest scheduler has the same conversion path.

The shipped default templates use whole hours. This report does not claim a defect in those default times.
It reproduces the failure with accepted fractional configuration through the existing planner.

## Change and alternatives

Convert the requested local hour to rounded total minutes before constructing the UTC guess.
Keep the existing time-zone offset correction and spring-forward gap handling.
The helper operates at minute precision; values finer than a minute round to the nearest minute.
There is no new dependency or configuration field.

Two alternatives:

1. Split hours and minutes separately in each caller. This repeats conversion logic and leaves other callers exposed.
2. Reject fractional hours. This prevents the existing numeric configuration from expressing times such as 19:30.

The shared conversion fixes both planning and digest scheduling with one implementation change.
One integration case exercises real generated Friends worlds and the weekly planner.
The new test file keeps this scenario with the simulator fixtures it uses.

## measurement

Run the new case with the base implementation, then with the fix:

```sh
bun test --conditions eliza-source packages/sim/test/fractional-plan-hours.integration.test.ts
```

Both runs use seeds 1 and 2, 160 personas, and three weeks per world.
Each resulting public snapshot goes through the planner with minute offsets 0, 15, 30 and 45.
The case checks primary plan starts and offered option starts, including partner plans.
It requires nonempty planner results. No planner or model output is mocked.

| Check | Before | After |
|---|---:|---:|
| Integration case | 0 pass, 1 fail | 1 pass, 0 fail |
| Assertions | 1 | 1 |
| Case duration | 4,213.17 ms | 4,689.51 ms |
| Command duration | 4.25 s | 4.73 s |

These timings are observations, not a performance claim. The fixed case ran alongside typechecking.
The exploratory reproduction found 282 incorrect fractional timestamps across those two worlds.
Whole-hour controls had no incorrect minutes.

A separate paired run used held-out seeds 11 through 22 with the same world size and duration.
It compared 1,184 output rows per revision.
It hashed complete world results, including Map and Set entries, and compared all world metrics.
It also hashed complete planner results for the whole-hour controls.

| Held-out or compatibility check | Before | After |
|---|---:|---:|
| Correct fractional plan and option starts | 0 / 1,662 | 1,662 / 1,662 |
| Fractional planner runs | 36 | 36 |
| Default world results and metrics | 12 | 12 identical |
| Whole-hour planner results | 12 | 12 identical |
| Whole-hour conversions | 1,080 | 1,080 identical |
| Digest slots at the configured local hour and minute | 9 / 36 | 36 / 36 |
| Explicit fractional DST and UTC-offset expectations | 2 / 8 | 8 / 8 |

The 1,080 compatibility conversions cover five zones, eight dates, and hours -1 through 25.
Zones: New York, Los Angeles, UTC, Tokyo and Kolkata.
Dates include both US clock changes and the year boundary.
The digest checks cover three zones, three start dates and four configured hours, with burst jitter disabled.
For every fixed digest result, `lastDigestSlot` at that instant equals `nextDigestSlot`'s result.

The eight independent timestamp expectations cover spring gaps, repeated fall times and Kolkata's half-hour UTC offset.
A nonexistent 02:30 still moves to 03:00 under the existing gap policy.
The tested repeated 01:30 still selects the earlier occurrence.
These examples do not establish a new policy for every historical time-zone transition.

## Paired measurement reproduction

Save the following program as `../fractional-hours-measure.ts` next to two installed checkouts.
Use a clean base checkout named `../friends-crew-base` at the base commit above.
Run these commands from the fixed checkout, with live-send and deployment flags unset:

```sh
bun run --conditions eliza-source ../fractional-hours-measure.ts ../friends-crew-base > ../fractional-hours-before.jsonl
bun run --conditions eliza-source ../fractional-hours-measure.ts . > ../fractional-hours-after.jsonl
```

Compare rows by order and their identifying fields.
Expect identical `world` rows, integer conversion rows, and whole-hour planner rows.
For fractional planner rows, sum `times` and `wrong`; expect 1,662 timestamps and zero incorrect minutes after the fix.
Expect all digest and DST rows to have `correct: true` after the fix.

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]!);
const from = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { runFriendsWorld, VENUES } = await from("packages/sim/src/apps/friends/world.ts");
const { friendsPackMatcher, engineInputOf, evidenceOf } = await from("packages/sim/src/apps/friends/packMatcher.ts");
const { buildFriendsSnapshot, NYC_TZ } = await from("packages/sim/src/apps/friends/snapshot.ts");
const { friendsMetrics } = await from("packages/sim/src/apps/friends/metrics.ts");
const { World } = await from("packages/engine/src/world.ts");
const { localEmbed } = await from("packages/engine/src/embed.ts");
const { resolveConfig, resolveAttention } = await from("packages/engine/src/config.ts");
const { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, friendsPack, planFriendsWeek } = await from("packages/engine/src/packs/friends/index.ts");
const { fromLocal, localParts } = await from("packages/core/src/time.ts");
const { nextDigestSlot, lastDigestSlot, defaultCadence } = await from("packages/engine/src/attention.ts");
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x, (_k, v) => v instanceof Map || v instanceof Set ? [...v] : v)).digest("hex");
for (let seed = 11; seed <= 22; seed++) {
  const r = runFriendsWorld({ seed, n: 160, weeks: 3, matcher: friendsPackMatcher() });
  console.log(JSON.stringify({ kind: "world", seed, trace: hash(r), metrics: friendsMetrics(r) }));
  const state = r.world.state; state.week = 3; state.now += 7 * 86_400_000;
  const s = buildFriendsSnapshot(r.world.personas, state);
  for (const minute of [0, 15, 30, 45]) {
    const att = resolveAttention({ availability: { templates: { weekday: [19 + minute / 60], weekend: [10 + minute / 60, 14 + minute / 60, 19 + minute / 60] } } });
    const w = new World(engineInputOf(s), resolveConfig({ seed }), localEmbed, friendsPack);
    const week = planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, s), venues: VENUES, crews: [], outcomes: [], offered: [] }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, att);
    const plans = [...week.plans, ...week.partners];
    const times = plans.flatMap((p: any) => [p.window.start, ...p.options.map((o: any) => o.start)]);
    console.log(JSON.stringify({ kind: "planner", seed, minute, plans: plans.length, times: times.length,
      wrong: times.filter((t: number) => localParts(t, NYC_TZ).minute !== minute).length, trace: hash(week) }));
  }
}
// Integer-hour compatibility at regular dates, DST transitions, and date rollovers.
for (const tz of ["America/New_York", "America/Los_Angeles", "UTC", "Asia/Tokyo", "Asia/Kolkata"])
  for (const [y, m, d] of [[2026, 3, 7], [2026, 3, 8], [2026, 3, 9], [2026, 10, 31], [2026, 11, 1], [2026, 11, 2], [2026, 12, 31], [2027, 1, 1]])
    for (let hour = -1; hour <= 25; hour++)
      console.log(JSON.stringify({ kind: "integer", tz, y, m, d, hour, at: fromLocal(y, m, d, hour, tz) }));
// Digest consumers must preserve an explicit hour's minutes too; burst jitter is disabled.
for (const tz of ["America/New_York", "America/Los_Angeles", "Asia/Kolkata"])
  for (const now of [Date.UTC(2026, 2, 7), Date.UTC(2026, 9, 31), Date.UTC(2026, 10, 7)])
    for (const hour of [9, 9.25, 12.5, 19.75]) {
      const att = resolveAttention({ digest: { spreadMinutes: 0 } });
      const member = { memberId: "digest-control", tz, prefs: { ...defaultCadence("normal", att), digestDays: [0, 1, 2, 3, 4, 5, 6], digestHour: hour } };
      const at = nextDigestSlot(member, now, att), p = localParts(at, tz);
      console.log(JSON.stringify({ kind: "digest", tz, now, hour, at, last: lastDigestSlot(member, at, att), correct: p.hour * 60 + p.minute === hour * 60 }));
    }
// Independent UTC expectations for fractional times across US DST boundaries.
for (const [tz, m, d, hour, expected] of [
  ["America/New_York", 3, 8, 1.5, "2026-03-08T06:30:00.000Z"],
  ["America/New_York", 3, 8, 2.5, "2026-03-08T07:00:00.000Z"],
  ["America/New_York", 3, 8, 3.5, "2026-03-08T07:30:00.000Z"],
  ["America/New_York", 11, 1, 1.5, "2026-11-01T05:30:00.000Z"],
  ["America/New_York", 11, 1, 2.5, "2026-11-01T07:30:00.000Z"],
  ["America/Los_Angeles", 3, 8, 2.5, "2026-03-08T10:00:00.000Z"],
  ["America/Los_Angeles", 11, 1, 1.5, "2026-11-01T08:30:00.000Z"],
  ["Asia/Kolkata", 11, 1, 19.75, "2026-11-01T14:15:00.000Z"],
] as const) {
  const actual = new Date(fromLocal(2026, m, d, hour, tz)).toISOString();
  console.log(JSON.stringify({ kind: "dst", tz, m, d, hour, expected, actual, correct: actual === expected }));
}
```

## Validation and safety_gates

| Command | Result |
|---|---|
| `bun run typecheck` | All four configurations pass; exit 0 |
| `bun run sim --only network,friends --json <output>` on base | 79/79 blocking gates pass; 245.3 seconds |
| Same simulation command with the fix | 79/79 blocking gates pass; 222.0 seconds |
| `bun run test:integration` | 676 pass, 8 skip, 6 known failures; 13,742 assertions; 398.84 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 40.76 seconds |

All 84 simulation gate records are identical after excluding elapsed time.
The five tracked records include one existing miss: undetected-adversary harm is 17.5 versus 10.5 per seed (1.67x).
Invariant, canary-leak and minor-contact gates retain their passing values.

The six integration failures match the recorded base by test name and underlying error:
missing `/bin/bash` for Wrangler, SIGTERM exit 143 instead of 0, and four Windows site-build path assertions.
The integration command includes the security suite. It exited 1, so a fully green integration suite is not claimed.
Eight optional isolated-cleanup cases skipped. The optional browser SDK end-to-end case also skipped.
The task-owned database was stopped after both suites finished and no client sessions remained.

The affected simulation blocks use their checked-in seeds and defaults, without `--quick`.
Network includes seed 3 over ten days, consent arms on seeds 1-3, and its scenario and conformance checks.
Friends uses seeds 5-8, 400 personas and eight weeks for the pack, random and oracle arms.
It also runs its checked-in conformance and planner gates.
The simulated reviewer approves proposals in these offline runs.

No threshold or safety gate changes. No live sends or deployments.
Tests use an isolated local PostgreSQL instance on port 54339.
The full simulation was not repeated: AGENTS.md limits this agent to one full run, already used for PR #355.
This contribution uses paired runs of the affected Network and Friends blocks.

## llm_evidence and agent_clients

N/A for model qualification: the changed operation converts configured local time into a timestamp.
No model-backed behavior changes or claims. Real-model calls: 0; cost: $0; request settings: N/A.

Codex desktop 26.1103.3517.0 drove the local commands on 2026-11-07.
Assistant provider: OpenAI. The exact assistant model identifier was not exposed and is reported as unavailable.
No member-facing agent-client workflow changed. Other clients were not tested.
No browser or computer use was performed, as instructed by the operator.

## Limits

The fix preserves fractional hours to minute precision and the tested existing DST behavior.
It does not change quiet-hour interpretation, select templates, or alter ranking and consent policy.
The evidence uses synthetic populations and configured local schedules.
No production member data or raw run logs are included.
