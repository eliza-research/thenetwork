# Honor minute boundaries in member quiet hours

Date: 2026-11-07. Base: a0ed7bc6495d9e524afc3d500738212a28dc7bc2.
Environment: Windows, Bun 1.4.2, PostgreSQL 16.15, PowerShell 7.6.9.

## Requirement, cause and change

This is a reproduced timing defect under the approved contribution scope.
PRD 7.2 and 32.9 require member quiet hours to control outreach.
PRD 34.3 and 34.4 require realistic simulator behavior and useful member-experience measurements.
Member preferences store quiet hours as numeric local hours.
The carrier implementation already compares their minute values.

The shared core check used only the integer hour from the local timestamp.
It treated 21:50 as 21 when comparing it with a 21.5 quiet-hours start.
The engine therefore allowed the Network to send reminders after the member's quiet period began.
The same truncation delayed fractional end boundaries until the next whole hour.

The check now includes minute / 60 in the local hour.
It retains the existing inclusive start, exclusive end, midnight wrapping and equal-endpoints behavior.
The same helper serves the engine's message composition, timing and quiet-period end calculation.
The carrier implementation and message text do not change.

Two alternatives:

1. Round member preferences to whole hours. This would change the chosen boundaries and disagree with the carrier implementation.
2. Patch each Network caller. That would leave other engine callers using the incorrect shared check.

This change is separate from PR #397, which converts fractional local hours to UTC.
This check reads an existing timestamp; it performs no local-to-UTC conversion.
It is also separate from PR #330, which selects the member's time zone in the service adapter.

## measurement

One integration case runs the real World, ConsentNetwork, channel, persona policy and oracle.
It generates 60 adult NYC personas on seed 2, with joins spread across one day.
Each persona's sleep time is 21.5, which the existing snapshot maps to a 21:30 quiet-hours start.
The world runs 14 simulated days with 15-minute Network ticks and simulated review approval.
Growth matching is disabled.
No messages, Network decisions, policy replies or oracle results are mocked.

The base delivers a reminder to m0044 for proposal nw-2-30 at 21:50 New York time on October 10.
The fixed revision delivers that same reminder at 21:20, before quiet hours start.
The timestamp changes from 2026-10-11T01:50:00Z to 2026-10-11T01:20:00Z.
The reminder ID remains o000608 in this example.

~~~sh
bun test --conditions eliza-source packages/network/test/fractional-quiet-hours.integration.test.ts
~~~

| Check | Before | After |
|---|---:|---:|
| Regression case | 0 pass, 1 fail | 1 pass, 0 fail |
| Assertions | 1 | 1 |
| Reminders at or after the 21:30 boundary | 1 | 0 |
| Case duration | 1,879.43 ms | 1,864.80 ms |
| Command duration | 1.94 s | 1.93 s |

Timings are observations, not a performance claim.

Held-out worlds use seeds 11-18, separate from the regression seed.
Each seed runs two 60-person, 14-day worlds, with quiet hours starting at 20:30 or 21:30.
The generation, Network settings and 15-minute ticks match the regression method.
Eight control worlds use seeds 11-14, 40 personas and whole-hour starts of 21:00 or 22:00.

| Held-out world check | Before | After |
|---|---:|---:|
| Worlds with a reminder after the quiet-hours start | 8 / 16 | 0 / 16 |
| Reminders after the quiet-hours start | 15 | 0 |
| Delivered reminders | 348 | 348 |
| Reminder recipient/proposal pairs | 348 | All retained |
| Canary leaks, minor contacts, Network errors | 0 | 0 |
| Whole-hour control worlds | 8 | All unchanged |

Control records, metrics, messages and persona memories match.
Only wall-clock durations are normalized for comparison; run IDs are deterministic.
Fractional-hour runs can change downstream message order and reply timing.
No general matching-quality or performance improvement is claimed.
The defect and correction are deterministic, so no statistical significance claim is needed.

The numeric measurement compares core and engine results with the separate carrier implementation.
It uses New York, Los Angeles and UTC on March 7-8 and October 31-November 1, 2026.
These dates cover both US daylight-saving transitions.
Every UTC day is sampled at 15-minute intervals.
Fractional windows are [21.5, 8.5], [13.25, 14.75] and [23.75, 0.25].
Whole-hour controls are [21, 8], [8, 20] and [0, 0].
Quiet-period end checks start every three hours and use the existing 15-minute release resolution.

| Numeric check | Before | After |
|---|---:|---:|
| Incorrect core results, fractional windows | 144 / 3,456 | 0 / 3,456 |
| Incorrect engine results, fractional windows | 144 / 3,456 | 0 / 3,456 |
| Incorrect quiet-period end timestamps, fractional windows | 52 / 288 | 0 / 288 |
| Incorrect core or engine results, whole-hour windows | 0 / 3,456 | 0 / 3,456 |
| Incorrect end timestamps, whole-hour windows | 0 / 288 | 0 / 288 |

The supplementary numeric checks describe boundary behavior.
The regression and held-out worlds prove its effect on actual Network sends.

## Reproduce the paired measurement

Save this program as ../fractional-quiet-measure.ts beside two installed checkouts.
Use a clean base checkout named ../friends-crew-base at the commit above.
Run from the fixed checkout with live-send and deployment flags unset:

~~~sh
bun run --conditions eliza-source ../fractional-quiet-measure.ts ../friends-crew-base > ../fractional-quiet-before.jsonl
bun run --conditions eliza-source ../fractional-quiet-measure.ts . > ../fractional-quiet-after.jsonl
~~~

Each output has 98 rows: 18 fractional worlds, eight control worlds and 72 numeric groups.
Seed 2 provides the reproduced example; seeds 11-18 provide the held-out world measurements.
Compare rows by kind, seed, quietStart, zone, date and quietHours as applicable.
Expect no late reminders or numeric mismatches after the fix.
Expect every control row to match after normalizing wallMs.
Compare sorted memberId/proposalId pairs to verify the held-out reminders were retained.

~~~ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]!);
const from = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { generatePersonas } = await from("packages/sim/src/generator.ts");
const { runWorld } = await from("packages/sim/src/world.ts");
const { ConsentNetwork } = await from("packages/network/src/network.ts");
const { inQuietHours, localParts } = await from("packages/core/src/time.ts");
const { inMemberQuietHours, memberQuietEnd } = await from("packages/engine/src/attention.ts");
const { isQuietAt } = await from("packages/blooio/src/quiet-hours.ts");
const MINUTE = 60_000, DAY = 86400_000;
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x, (k, v) => k === "wallMs" ? 0 : v instanceof Map || v instanceof Set ? [...v] : v)).digest("hex");
for (const seed of [2, 11, 12, 13, 14, 15, 16, 17, 18]) {
  const windows = seed >= 11 && seed <= 14 ? [20.5, 21.5, 21, 22] : [20.5, 21.5];
  for (const quietStart of windows) {
    const control = Number.isInteger(quietStart);
    const personas = generatePersonas({ n: control ? 40 : 60, seed, cityWeights: { sf: 0, nyc: 1 }, adversarialRate: 0, minorShare: 0, joinSpreadDays: 1 });
    for (const p of personas) p.routine.sleep = quietStart;
    const r = await runWorld({ seed, personas, days: 14, tickMinutes: 15, writeLog: false,
      runId: "fractional-quiet-" + seed + "-" + quietStart,
      network: new ConsentNetwork({ seed, review: "auto", growth: false }) });
    const reminders = r.channel.all().filter((m: any) => m.direction === "outbound" && m.status === "delivered" && m.meta?.type === "reminder");
    const late = reminders.filter((m: any) => {
      const { hour, minute } = localParts(m.ts, "America/New_York");
      return hour + minute / 60 >= quietStart;
    });
    console.log(JSON.stringify({ kind: control ? "control" : "world", seed, quietStart,
      reminders: reminders.map((m: any) => ({ id: m.id, memberId: m.memberId, proposalId: m.meta?.proposalId, at: new Date(m.ts).toISOString() })),
      late: late.map((m: any) => ({ memberId: m.memberId, proposalId: m.meta?.proposalId, at: new Date(m.ts).toISOString() })),
      trace: hash(r.records), messages: hash(r.channel.all()), memories: hash(r.memories), metrics: r.metrics }));
  }
}
// Compare the core and engine paths with the separate carrier implementation at minute precision.
for (const tz of ["America/New_York", "America/Los_Angeles", "UTC"]) {
  for (const date of ["2026-03-07", "2026-03-08", "2026-10-31", "2026-11-01"]) {
    for (const quietHours of [[21.5, 8.5], [13.25, 14.75], [23.75, 0.25], [21, 8], [8, 20], [0, 0]]) {
      const start = Date.parse(date + "T00:00:00Z");
      const m = { age: 30, tz, quietHours };
      const carrier = { startHour: quietHours[0], endHour: quietHours[1] };
      const fractional = quietHours.some(x => !Number.isInteger(x));
      let checked = 0, coreWrong = 0, engineWrong = 0, endsChecked = 0, endWrong = 0;
      for (let t = start; t < start + DAY; t += 15 * MINUTE) {
        const expected = isQuietAt(t, tz, carrier);
        checked++;
        if (inQuietHours(t, tz, quietHours) !== expected) coreWrong++;
        if (inMemberQuietHours(m, t) !== expected) engineWrong++;
        if (t % (3 * 3600_000) !== 0) continue;
        let end = t;
        while (isQuietAt(end, tz, carrier)) end += 15 * MINUTE;
        endsChecked++;
        if (memberQuietEnd(m, t) !== end) endWrong++;
      }
      console.log(JSON.stringify({ kind: "grid", tz, date, quietHours, fractional, checked, coreWrong, engineWrong, endsChecked, endWrong }));
    }
  }
}
~~~

## safety_gates and qualification

| Check | Result |
|---|---|
| bun run typecheck | All four configurations pass; exit 0 |
| Network and Friends simulation, base | 79/79 blocking gates pass; 245.3 seconds |
| Same simulation command, fixed revision | 79/79 blocking gates pass; 265.7 seconds |
| bun run test:integration | 676 pass, 8 skip, 6 known failures; 13,742 assertions; 569.52 seconds |
| bun run test:e2e | 42 pass, 1 skip, 0 fail; 654 assertions; 78.01 seconds |

All 84 simulation gate records are identical after excluding elapsed time.
The five tracked records include one existing miss: undetected-adversary harm remains 17.5 versus 10.5 per seed (1.67x).
Invariant, canary-leak and minor-contact gates retain their passing values.

The new regression passed inside the official integration command in 1,699.71 ms.
The six failures match the recorded base by test name and underlying error:
missing /bin/bash for Wrangler, SIGTERM exit 143 instead of 0, and four Windows site-build path assertions.
The integration command includes the security suite. It exited 1; a fully green integration suite is not claimed.
Eight optional isolated-cleanup cases skipped. The optional browser SDK end-to-end case also skipped.
The task-owned database was stopped after both suites finished and no client sessions remained.

The paired gate command is bun run sim --only network,friends --json OUTPUT, without --quick.
The baseline is the earlier successful run at the same unchanged main commit, reused from the fractional-hours qualification.
Network uses its checked-in seed 3 invariant run, seeds 1-3 consent arms, scenarios and conformance checks.
Friends uses seeds 5-8, 400 personas, eight weeks and its additional conformance and planner checks.
Simulated reviewers handle approvals in these offline runs.

The full simulation was not repeated: AGENTS.md permits one per agent, already used for PR #355.
No gate threshold changes.
Live sends and deployments were disabled.
Service tests use isolated local PostgreSQL on port 54339.

## llm_evidence and agent_clients

N/A for real-model qualification: the change compares local time with member preferences and invokes no model.
No prompt, provider adapter or message wording changes.
Real-model calls: 0; cost: $0; request settings: N/A.

Codex desktop 26.1103.3517.0 drove the local commands on 2026-11-07.
Assistant provider: OpenAI. Its exact model identifier was not exposed and is reported as unavailable.
External agent-client delivery timing was not exercised.
The evidence covers the real Network and simulated channel locally; no external-client qualification is claimed.
No browser or computer use was performed, as instructed by the operator.
No production member data, secrets or raw run logs are included.
