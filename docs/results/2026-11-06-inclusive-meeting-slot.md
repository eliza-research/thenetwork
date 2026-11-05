# Keep a meeting slot at the search boundary

Date: 2026-11-06. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Windows, Bun 1.4.2, PostgreSQL 16.15 on local port 54339.

## Problem and scope

`nextAt(t, hour, dayOk)` promises the next matching time at or after `t`.
It always advanced to the next quarter hour, even when `t` was already on one.
Slop's `slotStart` calls it with `now + DAY` to find a date at least 24 hours away.
An exact boundary therefore skipped a valid date slot for a week.

At Friday October 9, 2026, 14:00 New York time:

| Value | Base | Fix |
|---|---|---|
| `slotStart("sat_day", now)` | October 17, 14:00 | October 10, 14:00 |
| `slotStart("sat_eve", now)` | October 10, 19:00 | October 10, 19:00 |
| First offered time in the service flow | October 10, 19:00 | October 10, 14:00 |
| Stored booking after both members pick the first time | October 10, 19:00 | October 10, 14:00 |

This is a reproduced scheduling defect under approved scope, PRD 28.3
(scheduling) and 40.5 (the booked first date). It changes no UI or copy.
Live issue and PR searches found no overlapping `nextAt` or `slotStart` fix.

## Change and alternatives

Round the search start up with `Math.ceil(t / step) * step`, where the step is
15 minutes. An aligned start stays eligible. A later start still advances.
The existing local-time and weekday checks decide whether the candidate fits.

Two alternatives were considered:

1. Subtract a millisecond in `slotStart`. This would work around the shared
   helper's contract at one call site. Other callers would still skip equality.
2. Replace the loop with local-calendar date arithmetic. That would require
   a larger timezone and DST change to fix one rounding expression.

## measurement

One new integration case in `slop-date-path.integration.test.ts` drives three
real service flows on seed 1, with two synthetic adults in each flow:

1. Join by text, finish onboarding, and state Saturday afternoon availability.
2. At Friday 14:00 minus 1 ms, exactly 14:00, or plus 1 ms, run matching.
3. Check that no proposal message went out before staff review; approve it.
4. Read the actual offered time from the Network state.
5. Both members reply yes to the first time. Read the booked time from Postgres
   and check that both members received the booked-date text in the dry-run log.

The first two arms must book Saturday 14:00. The last must book Saturday 19:00:
Saturday 14:00 is then less than 24 hours away and must stay excluded.
The fixtures use the real service, parser, engine, app hooks, review API,
consent flow and database. They do not replace the scheduler or its output.
The fixed clock and dry-run adapter keep the run deterministic and local.

Same command before and after:

```sh
bun test --conditions eliza-source packages/network/test/slop-date-path.integration.test.ts --test-name-pattern 'a date slot exactly'
```

Base: 0 pass, 1 fail, 68 assertions; all three flows reached a stored booking,
then the exact-boundary assertion failed. Fix: 1 pass, 0 fail, 69 assertions.
The targeted fixed run took 12.37 seconds. This is an exact timestamp check,
not an estimated quality improvement; a confidence interval does not apply.

Paired simulation command:

```sh
bun run sim --only network,slop,safety,audit --json <output>
```

The Network block uses the pinned seed 3 invariant run, seeds 1-3 consent/push
arms and the scenario corpus. Slop uses seeds 13-16, four weeks, 300 personas
per city, plus the service-wiring world on seeds 21-22 for 30 days.
Audit uses its pinned seed 3 world. No quick mode or threshold changes.

- Base: 133/133 blocking gates passed, 8 tracked gates off target; 388.4 seconds.
- Fix: 133/133 blocking gates passed, 8 tracked gates off target; 305.5 seconds.
- All 153 gate records have identical names, pass results, classifications and
  details. Elapsed times are excluded. Network: 61 blocking gates; Slop: 39;
  safety: 17; audit: 16. The other 20 gates are tracked.

Other validation:

- `bun run typecheck`: all four configurations passed.
- `bun run test:integration`: 676 pass, 8 skip, 6 fail; 13,810 assertions across
  68 files, 542.44 seconds. The new case passed in 7.76 seconds.
  All six failures match the earlier reproduction on this same base commit:
  `/bin/bash` is unavailable, SIGTERM gives exit 143 instead of 0, and four
  site-build assertions expect forward slashes instead of Windows paths.
  The eight optional cleanup-reconciliation cases were skipped.
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions, 96.23 seconds.
  The optional browser SDK case was skipped because `PLAYWRIGHT_MODULE` was not set.

The integration command includes the security suite. The full simulation was
not repeated: AGENTS.md permits at most one full run per agent, already used
for PR #355. That earlier full run is not evidence for this change.

## safety_gates

The new case checks staff approval before sends and mutual replies before the
booking. The positive-offset control retains the 24-hour minimum.
All safety gate results and details match the base run.
All messages are synthetic and use the dry-run adapter. Live-send and deploy
flags are absent. No production service or data is used.

## llm_evidence

N/A for this deterministic timestamp calculation. No model calls were made;
cost: $0. The tests prove scheduling through the normal rules-based service.
They do not claim to validate model-backed interpretation or a live judge.

## agent_clients

Codex desktop 26.1029.7803.0 drove the local commands. No member-facing agent
client was tested. The change is in backend slot selection; client transport,
prompts and model behavior are unchanged. No browser or computer use was used.
Provider: OpenAI. The exact assistant model identifier was not exposed; the PR
uses the disclosure helper's supported `unavailable` value.

## Limits

The integration case covers the normal New York daytime boundary and its two
adjacent milliseconds. It is not a general DST or calendar integration test.
The change preserves the existing 15-minute search grid and local-time rules.
