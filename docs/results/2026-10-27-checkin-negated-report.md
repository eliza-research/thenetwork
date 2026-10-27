# Check-in reports: a denial is not the harm

Date: 2026-10-27. Base: `main` `a0ed7bc`. No issue. The requirement is PRD 36.3 and PRD 40.5: a check-in after a date files a report from the member's words. Audit finding network-consent-17 asked for the same no-show fix. The check-in copy tells the member to say "weren't who they said".

This file is hand-written. The command output is copied from the runs below.

## What is wrong

slop.date sets `postDateReports`. After a date, `checkInReport` reads the answer. A match files a report and blocks the pair. An urgent kind (harassment, unsafe, scam, minor) also takes the other person out of matching.

The reader treats a harm word as the harm. It does not read a denial.

| Answer | Before | After |
|---|---|---|
| didn't show me her art but it was great | no_show | no report |
| she was not rude at all, it was a great date | harassment | no report |
| I wasn't scared, he was easy to talk to | unsafe | no report |
| not a scam, he paid for his coffee | scam | no report |
| he didn't come off as creepy | harassment | no report |
| the museum didn't come up, but the date was nice | no_show | no report |
| she was not a no-show, we had a great time | no_show | no report |
| not fake, the photos were recent | lying | no report |
| they weren't who they said | no report | lying |

Real reports stay reports. "they never showed up" stays no_show. "he was rude" stays harassment. "I felt unsafe" stays unsafe. "he asked me for money" stays scam.

The feedback reader did not agree. "didn't come up" and "not a no-show" set `otherNoShow`. `onFeedback` uses that flag when `checkInReport` is empty, so the false no-show came back. Both readers now use `isNoShowClaim`.

## Command

No seed. No model. The function is deterministic. Provider keys were unset. Calls: 0. Cost: 0.

Before, on `main`, with the new gate rows and the old reader:

```
bun run sim --only safety
```

The check-in gate failed. Actual kinds began `no_show, harassment, unsafe, scam, harassment, no_show, no_show, lying` for the eight denials. "they weren't who they said" was null. Result: 10/11 blocking gates. Postgres was not installed, so the Postgres scenarios were a tracked skip.

After the fix, same command, Postgres 16 on port 54339:

```
bun run sim
```

Result: `PASS: 327/327 blocking gates, 14 tracked off target, 365.2s`. Safety: 17/17 blocking gates, including the check-in gate. Canary leaks, invariant violations and minor contacts stayed 0. The 14 tracked misses are the known slop and relay targets. This change does not move them.

A direct read of the same sentences, before and after, used:

```
bun -e 'import { checkInReport } from "./packages/network/src/reports.ts"; ...'
```

Before: the eight denials returned a kind. After: `bad 0` on 35 sentences, including the live check-in lines "He was really rude..." and "she threatened me".

## Limits

A negation more than four words before the harm word is not seen. "I would never call him rude" can still read as harassment. "no way he was rude" stays harassment, because "no way" is not a denial of "rude".

The reader does not call a model.

## Other commands

Same tree. Postgres 16 on port 54339. No model.

| Command | Result |
|---|---|
| `bun run typecheck` | pass |
| `bun run test:integration` | 681 pass, 8 skip, 0 fail, 221.44 s |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail, 11.63 s |

The integration run includes the slop date path: join, a booked date, the check-in, and a harassment report on the safety queue. The 8 skips and the 1 e2e skip are existing isolated-database cases. They are not this change.
