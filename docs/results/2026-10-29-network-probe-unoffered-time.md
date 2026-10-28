# 2026-10-29: a probe answer that names a time nobody offered (issue #134)

## Problem

A member answers a probe: "Friday night works". The probe offered Saturday 10am and Sunday 10am.
The Network recorded a yes to both offered times: `o.picks` held both starts, both counted as
"accepted" in `availHistory`, and the member's own probe advanced as if they had picked them.

## Root cause

`parseProbeReply` (`packages/network/src/classify.ts`) marks a day or clock as a pick only when an
offered option carries it. A day nobody offered matched nothing, so the reply fell through to the
plain-yes branch and returned every option the member had not refused (`keys: open`). On the plain
yes branch, `mergeConsent` (`packages/network/src/extract.ts`) also took every offered option when
the LLM reader said yes without a time (`keys = options.map(...)`), so neither reading kept the
member's own time out of the picks.

## Fix

- `parseProbeReply` reports `unoffered: true` when a day or a clock the member names is carried by no
  option and is not refused ("if the sun's out" is not a clock). An affirmative reply with that flag
  keeps no pick. The reply is still a yes.
- `mergeConsent` keeps the parser's pick when `unoffered` is set: the LLM may still add wants,
  interests and an age, but it cannot turn the reply back into a pick of every offered time.
- `onProbeAnswer` (`packages/network/src/network.ts`) takes `namedNone`: it records no pick and no
  `declined_time` for the offered times, leaves the times open for the partner's picks, and offers
  other times once (the existing "yes, but none of those" retry).
- The probe log line carries `unoffered: true` for this answer.

## Evidence

Command (deterministic, no seed, no model): `bun run sim --only evals`, plus the exact-match corpus
gate `probe replies naming no offered time: read as labelled` over
`evals/network/probe-unoffered-time.jsonl` (9 rows; options Thursday 7pm, Saturday 11am, Sunday 2pm).

| Reply | Before (`main` a0ed7bc) | After |
|---|---|---|
| Friday night works | yes ["a","b","c"] | yes [] |
| Friday works | yes ["a","b","c"] | yes [] |
| Friday evening works | yes ["a","b","c"] | yes [] |
| Friday after work works | yes ["a","b","c"] | yes [] |
| Friday works (options Saturday 10am, Sunday 10am) | yes ["a","b"] | yes [] |
| Saturday 11am works for me | yes ["b"] | yes ["b"] |
| Sunday 2pm works | yes ["c"] | yes ["c"] |
| Friday night please | unclear [] | unclear [] |
| How about a different day? | yes [] ("none of those fit") | yes [] ("none of those fit") |

"None of those fit" was tried first for every such reply. As the open PR #152 reports, that path
writes every offered start to `declinedTimes` and to the member's `availHistory` as
`declined_time`. That is correct for `NEITHER` ("none of those work"), but for "How about a different
day?" it writes off times the member never refused. This change keeps the existing `NEITHER` path
as it is and moves only the unoffered-day reply to the yes-with-no-pick path above.

Integration case: `packages/network/test/probe-unoffered-time.integration.test.ts` (the real
`ConsentNetwork` in the `Mini` world, `review: "auto"`, a scripted LLM reader that names no time).
Before the fix it fails (the first three tests; `o.picks` held both offered starts); after, 4/4 pass.

Sim, full run, same machine and data:

| Run | Result |
|---|---|
| `main` a0ed7bc (same host, same data) | `FAIL: 299/305 blocking gates, 20 tracked off target` |
| this branch, final run | `FAIL: 322/328 blocking gates, 14 tracked off target` (live Postgres on :54339 for safety, ops and pipeline) |
| this branch, earlier run without a live Postgres for those blocks | `FAIL: 300/306 blocking gates, 20 tracked off target` |

The one new gate is this corpus gate. Every other gate has the same result. The 6 failures are in the
`audit` block and fail the same way on `main` on this Windows host (site builds, shell scripts);
they are not related to this change. The consent-vs-push metrics are unchanged: everyone-yes 0.847,
invite-yes 0.919, meetings 144, `network` 61/61, `slop` 39/39.

`bun run typecheck`: exit 0.

`bun run test:integration` (dev Postgres on :54339, `REQUIRE_PG=1`): 596 pass, 8 skip, 9 fail. The
same 9 fail on clean `main` on this host (58 pass, 9 fail in those 7 files): two need `/bin/bash`,
two need the built site pages, two compare a plugin checkout that is not present, and the rest use a
different local database role. `bun run test:e2e` stops at the site build ("build failed for
ntwrk.party"), the same failure as `main` here.

## Relation to PR #152

PR #152 ("never book an offered time the member did not name", open) fixes the same parser defect for
days and clocks. This change adds the part #152 records as a follow-up: `mergeConsent` can no longer
turn the reply back into a pick of every offered time, and the probe records the answer as a yes that
books none of them (not as unclear, which asks a second question). Both branches were merged in a
scratch copy: this test passes, and both exact-match gates pass. Two files need a hand merge there
(`classify.ts`, `evals.ts`); whoever merges second does that. If #152 merges first, this branch
replaces its `unclear` answer on the parser with the yes with no pick described above.

## Not changed

- Relative times ("tomorrow works", "tonight works") name no day or clock and still take the plain-yes
  path. They are not covered here or in PR #152.
