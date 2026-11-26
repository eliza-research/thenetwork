# Availability: read a stated clock time as its own part of day

Date: 2026-11-26. Baseline: `1b0f3d42`.
Related story: [F17, Schedule a meeting](../../spec/product/stories.md#story-f17--schedule-a-meeting),
which requires the agent to "use stated availability" when it offers times.

## The defect

`availabilityTags` records the day a member names, then fills in a part of day:
the part they said, else a default. A weekday with no part defaults to
`evening`. That default was applied even when the member named an exact clock
time, because the tagger read parts-of-day only from words such as "morning"
and never from a clock. The explicit time was silently dropped.

The same module already reads a clock correctly elsewhere: `partOf(clockMinute(...))`
is how the probe-reply parser classifies an offered label. The reading layer had
two rules for one thing, and the availability one was wrong.

## Reproduce

Before, on the baseline:

```sh
node --import tsx --conditions=eliza-source -e '
import("./packages/network/src/classify.ts")
  .then(m => ["Friday at 9am","Friday at 2pm","Friday at 8pm"]
    .forEach(s => console.log(s, "->", JSON.stringify(m.availabilityTags(s)))))'
```

| Stated | Before | After |
|---|---|---|
| Friday at 9am | `["evening:Fri"]` | `["morning:Fri"]` |
| Friday at 2pm | `["evening:Fri"]` | `["afternoon:Fri"]` |
| Friday at 8pm | `["evening:Fri"]` | `["evening:Fri"]` |
| Friday at noon | `["evening:Fri"]` | `["afternoon:Fri"]` |
| 9am Friday | `["evening:Fri"]` | `["morning:Fri"]` |
| Saturday at 10am | `["morning:Sat","afternoon:Sat","evening:Sat"]` | `["morning:Sat"]` |
| Friday (no clock) | `["evening:Fri"]` | `["evening:Fri"]` |
| Weeknights | five evenings | five evenings |

Effect: a member who answers "Friday at 9am" is recorded as free Friday
evening. `m.availability` feeds the weekly check-in windows that formation,
rescheduling and dispatch read (`spec/planFormation.md`, "The member's latest
weekly answer takes precedence"), so the wrong part of day offers and books the
wrong window.

## The change

`packages/network/src/classify.ts`: `availabilityTags` now takes a clock time
as its own part-of-day token, through the existing `clockMinute`/`partOf` pair,
with the same negation check the word tokens use. Three lines, no new parsing.

`evals/network/availability-clock.jsonl` (new, 14 rows) and one gate in
`scripts/sim/evals.ts` pin the behavior: a stated clock time names its part of
day, and a day with no part still takes the default.

## Test results

| Command | Result |
|---|---|
| `pnpm run sim --only evals` | 41/41 blocking gates pass |
| the same gate with the `classify.ts` change stashed | fails, naming `Friday at 9am -> ["evening:Fri"] want ["morning:Fri"]` |
| `pnpm run typecheck` | passes |
| `pnpm run sim --only network` | 123/123 blocking gates pass, 13 tracked; 1907.6s |

## Risks and trade-offs

- Part boundaries are the ones this module already uses: 05:00-11:59 morning,
  12:00-16:59 afternoon, otherwise evening. `12am` therefore reads as evening,
  as it already does when an offered label carries it.
- An impossible clock ("Friday at 25:00") is not rejected by `CLOCK_MENTION`;
  the hour wraps modulo 12. That is pre-existing and unchanged here.
- A member who states a clock time and a different part of day in words still
  records both, minus refusals, exactly as two stated windows did before.
