# Probe answer naming an unoffered day books every option (#134)

Date: 2026-10-26
Issue: #134 "Network probe books an offered time when the member names a different day"
Branch: `fix/network-consent-unoffered-time-134`, tree at `d7286ab` (identical to the fix commit `2f6ad48`; the follow-up commit is reverted, see "Rejected widening")
Commands: run from the repo root with `bun` 1.4.0
Sample size: `evals/network/consent-replies.jsonl` 323 rows, `evals/network/consent-heldout.jsonl` 75 rows, `bun run sim --only network,slop` (2 blocks, fixed pinned seeds from `scripts/sim/`)
Provider and model: none. `parseProbeReply` is a pure function and `bun run sim` is offline and deterministic by design (`scripts/sim.ts` header: "no LLM, no network"). No request settings apply.

## Root cause

`parseProbeReply` (`packages/network/src/classify.ts`) turns the times a reply names into picks. The day scan marked the options whose label starts with the named day, and the clock scan marked the options whose label ends with the named time. When the reply named a day or time that **no** option offered, the scan matched nothing but the reply was still an affirmative one, so the code fell through to the plain-yes branch and returned **every** option the member had not refused. A member answering "Friday works" to an offer of Thursday 7pm / Saturday 11am / Sunday 2pm was booked on all three.

## Before and after

Same command, same data, same options (`Thu 7pm`/a, `Sat 11am`/b, `Sun 2pm`/c):

```
bun run --conditions eliza-source <scoring script importing parseProbeReply and evals/network/*.jsonl>
```

| Reply | Before (`main`, a0ed7bc) | After (this branch) |
|---|---|---|
| `Friday works` | `{"answer":"yes","keys":["a","b","c"],"why":"affirm"}` | `{"answer":"unclear","keys":[],"why":"none"}` |
| `tomorrow works` | `{"answer":"yes","keys":["a","b","c"],"why":"affirm"}` | unchanged (see Follow-ups) |
| `would love to, can we find another time?` | `{"answer":"yes","keys":["a","b","c"],"why":"affirm"}` | unchanged (see Follow-ups) |
| `Saturday 11am works` | `{"answer":"yes","keys":["b"],"why":"affirm"}` | unchanged |
| `thursday or sunday` | `{"answer":"yes","keys":["a","c"],"why":"none"}` | unchanged |
| `Friday doesnt work, saturday 11am does` | `{"answer":"yes","keys":["b"],"why":"none"}` | unchanged |

Corpus scores (the parser gates from `scripts/sim/evals.ts:54-65`, scored directly):

| Corpus | Before | After | Gate |
|---|---|---|---|
| `consent-replies.jsonl` | 323/323 | **323/323 (100.00%)** | ≥ 97%, 0 no/unclear read as yes |
| `consent-heldout.jsonl` | 75/75 | 75/75 (100.00%) | ≥ 97%, 0 no/unclear read as yes |

The `consent-replies.jsonl` row for `Friday works` is retyped from `yes` to `unclear` (not deleted: that corpus is append-only).

A corpus row cannot pin this behaviour: one miss in 323 rows is 99.7%, inside the 97% bar, so the regression would come
back with every gate green. The fix is therefore gated by an exact-match block instead, in
`evals/network/unoffered-time-answers.jsonl` and its gate in `scripts/sim/evals.ts` (100%, each row carrying its own
option set): `Friday works` must be `unclear` with no keys, `Saturday 11am works` must still be `["b"]`. Every row in
that file fails on `main` today, and any regression fails the gate outright:

```
with the fix:     PASS  time answers: a day or time nobody offered is never a pick (n 2, exact match): 2/2 exact
fix stashed:      FAIL  time answers: ...: Friday works -> yes ["a","b","c"], want unclear []   (24/26 blocking gates)
```

## sim and typecheck

`bun run sim --only network,slop` on this tree:

```
-- network: 61/61 blocking gates pass, 2 tracked (109.5s)
-- slop: 39/39 blocking gates pass, 18 tracked (21.2s)
PASS: 100/100 blocking gates, 8 tracked off target, 130.7s (network 109.5s, slop 21.2s)
```

`bun run typecheck`: exit 0, no compiler output.

`test:integration` and `test:e2e` were **not** run for this branch: both need a Postgres instance (`tests/e2e/harness.ts` reads `DATABASE_URL`, the dev cluster is expected on `:54339`) which this environment does not have. Not reported as passing.

## Rejected implementations

1. **Decide it in `consentOf` instead of `parseProbeReply`.** `consentOf` (`classify.ts:553`) has no access to the offered options, so it cannot tell an unoffered day from an offered one; it would need a new signature on a function used elsewhere, to answer a question only the caller can pose.
2. **Drop the keys in the caller, `onProbeAnswer` (`network.ts:2300-2316`).** That re-parses member text outside `classify.ts`, leaving `parseProbeReply` still wrong when called directly (as `scripts/sim/evals.ts` and the corpora do), and duplicates the day/clock matching in a second place.
3. **Thread a miss channel through the shared `mark()` helper.** `mark` is used by five scans in `parseProbeReply` (option letters, option words, ordinals, day labels, clock labels), so a miss channel changes behaviour for cases unrelated to this bug.

Rejected widening: treating relative days ("tomorrow", "tonight", "this weekend") and "another time" the same way. It
fixed those inputs but broke four blocking sim gates (`decliner_exposed: 1`, `consent vs push: meetings (pooled) 144 -> 119`,
the sequential-probe gate, and `slop-live: one date at a time`), because at the time `keys: []` took the "none of those fit"
path at `network.ts:2303-2306`. Reverted; those cases stay unchanged from `main` and are follow-ups. That rejection was
against the `counter` version of this fix; the `unclear` version below does **not** take that path, so the widening is worth
re-testing on its own, and is not part of this branch.

## Risks and trade-offs

`unclear` with `why: "none"` is not the "none of those fit" path. `network.ts:772` returns before `onProbeAnswer` whenever
`r.answer === "unclear"`, so "Friday works" appends nothing to `o.declinedTimes`, bumps no `optionsNoneFit`, and writes no
`declined_time` outcome into `m.availHistory`; the reply falls through to `clarify()`, which asks again. The `counter`
version of this fix did record those three times as declined for a member who never refused them; that is why it was
replaced.

The value is not new: `unclear` / `why: "none"` is what `parseProbeReply` already returns for a reply it cannot read
(`classify.ts:602`). Refusals, hedges and conditionals are untouched: the guard at `classify.ts:732` runs after those early
returns (`classify.ts:719-720`) and requires `answer === "yes"`. This also matches the answer sibling PRs #161 and #135
chose for the same input, so the pair agree rather than diverge.

## Follow-ups

- Relative days ("tomorrow works", "tonight works", "this weekend works") still book every option. The guard here only
  covers day and clock words, so this needs the widening above, re-tested against `unclear`.
- `COUNTER_RX` (`classify.ts:543`) does not match "another time", so "can we find another time?" still books every option; `consent-replies.jsonl:94` pins no keys, so the gate cannot see it. Pin the keys when fixing.
- `docs/network.md:282` was updated in this branch to describe the new behaviour.
