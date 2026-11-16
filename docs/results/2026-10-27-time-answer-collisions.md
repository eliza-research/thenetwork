# Time answers that name one option must not record the others

Date: 2026-10-27
Command: `bun run --conditions eliza-source .review/probe-timeexposure.ts 14 1` (local probe; the same measurement is not kept in the tree)
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

`evals/network/time-answer-collisions.jsonl` holds 24 hand-written rows with
their own option sets. The gate in `scripts/sim/evals.ts` reads them, and a row
marked `modelYes` is read again through `mergeConsent` with a model yes:

- On the fixed branch: `PASS time answers: only a single named option is a pick, and a
  model yes cannot promote an unclear time (n 24)` and `31/31 blocking gates pass`.
- With the previous head's parser (`4385fe3`) substituted into this tree, the same
  gate fails on six rows: `Friday anytime works -> yes [a,b,c] | Wednesday anytime
  works -> yes [a,b,c] | Friday any of them works -> yes [a,b,c] | Saturday anytime
  works -> yes [a,b,c] | 7:30pm -> model yes made it yes [a,b] | Thursday 7:30pm ->
  model yes made it yes [a,b]`. That
  substitution also reverts unrelated work `main` gained since, so no gate total is
  quoted for that arm; the row-level count below comes from the parser-only probe.

## Review round 2026-11-16 (maintainer sweep)

Date: 2026-11-16
Review: `lalalune`, `CHANGES_REQUESTED` at `4385fe3`.
Command: `bun run --conditions eliza-source scripts/sim/probe-time-answer-arms.ts [<parser file>]`
Provider and model: none (offline parser, no model call). The model reader is
exercised by passing a model yes to `mergeConsent`, the same merge the flow uses
at `packages/network/src/network.ts:801`.

Rows read by three parsers with the same corpus:

- Current branch, rebased on `ebf3e61`: **24/24 rows pass**.
- Previous head `4385fe3`: **18/24 rows pass**.
- `main` `ebf3e61`: **7/24 rows pass**.

The six rows the previous head read wrong:

| Reply | Previous head | Now |
|---|---|---|
| `Friday anytime works` | `yes [a,b,c]` | `unclear []` |
| `Wednesday anytime works` | `yes [a,b,c]` | `unclear []` |
| `Friday any of them works` | `yes [a,b,c]` | `unclear []` |
| `Saturday anytime works` (two Saturday options offered) | `yes [a,b,c]` | `unclear []` |
| `7:30pm` + model yes | `yes [a,b]` | `unclear []` |
| `Thursday 7:30pm` + model yes | `yes [a,b]` | `unclear []` |

Two control rows keep their earlier answer:

- `I have a wedding Friday but any of those work` stays `yes [a,b,c]`: the day
  nobody offered sits in another clause, so the clause-local skip must not fire.
- `anytime works for me` stays `yes [a,b,c]`: the universal with no time mention
  still accepts every option.

The row order matters. `Saturday anytime works` offers two Saturday options, so
the day is ambiguous and not unoffered: gating the universal on the unoffered
flag alone would still answer `yes [b,c]` (both Saturdays, which `main` does) and
then `yes [a,b,c]` on the previous head. Only checking the ambiguity first makes
it ask again.

## Limits

- No LLM provider key exists in this environment. No model call was made and no
  agent client was driven.
- The full `bun run sim` run and the browser end-to-end run are recorded
  separately in the pull request.
