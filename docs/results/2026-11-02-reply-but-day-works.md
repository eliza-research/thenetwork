# A refused day and another day that works

Date: 2026-11-02. No model call. The sim clears provider keys. Cost: $0.

## Command

```sh
bun -e 'import { classifyYesNo } from "./packages/core/src/replies.ts"; ...'
bun run sim --only evals
```

The corpus check is the evals block gate `core replies: every row read as labelled`. One new row: `Not Thursday but Friday works` -> `unsure`. The same words with a comma were already a row.

## Result

| Text | Before | After |
|---|---|---|
| Not Thursday but Friday works | no (`time_refusal`) | unsure (`time_refused_other_offered`, counter, leans yes) |
| Not Thursday, but Friday works | unsure | unsure |
| Corpus misses | 1 of 185 | 0 of 185 |

The other 184 rows did not change. `not this week, thanks` stays a no.

A later check found that the strong yes also fired with no refused day. `it was bad but friday works` was a yes. The rule now keeps that yes only when a time refusal comes first.

| Text | Answer |
|---|---|
| no, but Friday works | no |
| please stop but tomorrow works | no (opt-out still likely) |
| it was bad but friday works | unsure |
| Not Thursday but Friday works | unsure, counter, leans yes |

Corpus after these three rows: 0 misses of 188.

## Full suites (2026-11-09)

`bun run sim` (Postgres 16 on :54339, no provider key):

`PASS: 327/327 blocking gates, 15 tracked off target, 411.1s (evals 0.3s, onboard 1s, network 239.1s, slop 46.8s, relay 0.9s, peon 46.2s, peon-seats 0.1s, friends 49.6s, clef 0.8s, safety 7.5s, ops 0.9s, pipeline 4s, audit 14s)`

The reply gate is `PASS core replies (n 188): every row read as labelled`. The 15 tracked misses are existing quality tracks. One of them is an ops Postgres rollback. None is this parser.

`bun run test:integration`:

`680 pass, 8 skip, 1 fail, 13973 expect() calls. Ran 689 tests across 68 files. [230.47s]`

The one fail is `packages/observatory/test/real-fixes.test.ts`: two shadow runs both return false. The error is Bun SQL: `The argument 'strings' has an enumerable 'raw' property, so it is not a template object.` This file is not in the diff.

`bun run test:e2e`:

`42 pass, 1 skip, 0 fail, 654 expect() calls. Ran 43 tests across 3 files. [11.73s]`

`bun run typecheck` exits 0. There is no lint script.
