# Probe replies: a daypart picks only that part of the day

Date: 2026-10-27 (Asia/Shanghai). Base: `main` `a0ed7bc`. No issue. The requirement is founder probe consent (network-consent-1) and approvedScope matching safety: a member is booked only for times they named.

This file is hand-written. The command output is copied from the runs below. No model calls. Provider keys were unset. Cost: 0.

## What is wrong

A probe offers concrete slots, for example Thursday 7pm, Saturday 11am and Sunday 2pm. A reply that names a part of the day without a weekday was read as a plain yes:

| Reply | Before | After |
|---|---|---|
| morning works | yes a,b,c (books the Thursday evening) | yes b |
| evening works | yes a,b,c | yes a |
| night works | yes a,b,c | yes a |
| afternoon works | yes a,b,c | yes c |
| mornings work for me | unclear | yes b |
| evenings work | unclear | yes a |
| morning or afternoon | unclear | yes b,c |
| morning works (only evening slots offered) | yes every evening | yes, keys [] |
| Thursday morning (Thursday slot is 7pm) | yes a and Saturday morning | unclear |
| Sunday evening (Sunday slot is 2pm) | yes a and c | unclear |
| I work Saturdays | unclear | unclear (unchanged) |
| yes / any of those / Thursday | unchanged | unchanged |

Cause: `parseProbeReply` matched day names and clock times, then a bare affirm word ("works") took every open option. Daypart words were stripped as noise and never constrained the pick.

## Fix

Map each offered label's clock time to morning (5:00-11:59), afternoon (12:00-16:59) or evening/night (17:00-4:59). A daypart in the reply marks only the matching options. A day and a daypart in the same clause must both match ("Thursday morning" does not book Thursday 7pm). A daypart with no matching offered slot is "yes, but none of those times" (empty keys), never every slot. Bare "work" is a pick only next to a daypart ("evenings work"), so "I work Saturdays" stays unclear.

Two implementations not used:

1. Ask again on every daypart reply. Safer for recall, but drops clear picks such as "Saturday morning works great" into a second question the member already answered.
2. Call a model to read dayparts. Rejected: the consent floor is deterministic (AGENTS.md, network-consent-1); sim gates need a fixed reading.

## Command

```
bun run sim --only evals
```

Pinned consent options in the gate: Thursday 7pm (a), Saturday 11am (b), Sunday 2pm (c).

Before, on `main` `a0ed7bc`, with the new corpus rows and the old reader: the new daypart rows failed (morning/evening/afternoon "works" returned a,b,c; "evenings work" and "mornings work for me" were unclear). Direct read of the eight primary rows: 8/8 wrong.

After this change, same command:

```
bun run sim --only evals
```

Result: `PASS: 25/25 blocking gates, 0 tracked off target, 0.4s`. Consent replies `consent-replies.jsonl`: accuracy 98.8% (n 335). Held-out: 100.0% (n 75). No refusal or hedge read as yes on either file. Canary leaks, invariant violations and minor contacts are not exercised by the evals block; this change does not touch send paths.

## Limits

Labels without a clock time ("Thursday evening" as the label text with no `7pm`) cannot be mapped; those options are ignored for daypart matching. Custom daypart boundaries (for example treating 4pm as evening) are not configurable. The reader does not call a model.
