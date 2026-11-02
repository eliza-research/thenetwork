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

`bun run sim --only evals` after the fix: 25/25 blocking gates pass, 0 tracked off target, 0.4s. The reply gate is `PASS core replies (n 185): every row read as labelled`. `bun run typecheck` exits 0. There is no lint script.
