# Time answers that name one option must not record the others

Date: 2026-10-27
Command: `bun run --conditions eliza-source .review/probe-timeexposure.ts 14 1`
Seed: 1. World: ConsentNetwork, 250 NYC personas, 14 days. Provider and model: none (offline simulation, no model call).

## Problem

Two options can share a day or a clock time. The weekday templates offer every
option at 19:00. The slop application offers `Thursday 7pm`, `Saturday 2pm` and
`Saturday 7pm`. The parser matched a day word or a clock time against every
option that shared it. A member who named one option was recorded as free at the
others. The record then became availability evidence for later offers and could
set a meeting at a time the member never named.

## Measurement, same command and seed

| Metric | Before | After |
|---|---|---|
| Distinct option sets offered | 86 | 90 |
| Option sets where a one-option reply is misread | 69 | 0 |
| Reply forms checked | 876 | 908 |
| Forms widened to more than the named option | 163 | 0 |

The run diverges after the first probe answer, because the Network stops
recording false availability. The option-set counts therefore differ between
the two runs.

## Gate

`evals/network/time-answer-collisions.jsonl` holds 17 hand-written rows with
their own option sets. The new gate in `scripts/sim/evals.ts` reads them:

- Before the fix: `FAIL time answers: a mention that fits more than one option is never a pick (n 17)`
  and `25/26 blocking gates pass`.
- After the fix: `PASS … (n 17)` and `26/26 blocking gates pass`.

## Limits

- No LLM provider key exists in this environment. No model call was made and no
  agent client was driven.
- The full `bun run sim` run and the browser end-to-end run are recorded
  separately in the pull request.
