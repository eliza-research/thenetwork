# 2026-11-18 — "I'm still 17": a leading adverb before a stated age

## Command

```
bun run sim --only evals     # same command, same data, before and after
bun run sim                  # full run, after the fix
bun run typecheck
bun run test:integration
bun run test:e2e
```

Seed: n/a (deterministic text parsing; no LLM). Provider/model: n/a (offline
parser). Request settings: none. Sample size: 266 `teen-age.jsonl` rows
(252 before).

## Problem

`agesStated` read no age when a leading adverb sat between "I'm" and the
number: "I'm still 17", "im still 16", "I'm currently 17", "I'm now 16",
"I'm still fifteen" all returned `{}`. A member with an adult record who
writes one of these gives no `statedAge`, so the minor flip
(`packages/network/src/network.ts`, the stated age feeds `minorSignal`) never
fires. An unknown age is already treated as a minor and never matched; the
miss is the adult-record case: the member keeps being matchable as an adult.

"I'm 17 now" (trailing "now") already worked through `AGE_END_LOOSE`.

## Before (upstream main, `ebf3e61f`)

| Message | `statedAge` | `minorSignal` |
|---|---|---|
| I'm still 17 | none | false |
| im still 16 | none | false |
| I'm still fifteen | none | false |
| I'm currently 17 | none | false |
| I'm now 16 | none | false |
| I'm still 12 | none | false |
| I am still 14 | none | false |

Evals gate on the new corpus rows (before the code fix):

```
FAIL stated ages: the youngest real age in the message:
     "I'm still 17" -> none (want 17) | "im still 16" -> none (want 16) |
     "I'm still fifteen" -> none (want 15) | "I'm currently 17" -> none (want 17) |
     "I'm now 16" -> none (want 16)
```

## Cause

The `AGE_RX` rules in `packages/network/src/classify.ts` allow only the
intensity adverbs (`SAME`: only, just, literally, like, barely) between "I'm"
and the number. "still", "currently" and "now" were not in any rule, and the
plain rule requires the number directly after "I'm".

## Fix

Two rules added to `AGE_RX`, mirroring the existing strict/loose pair: an
optional `(?:still|currently|now)` between "I'm" and a plain age, once with
`AGE_END` (reads under 13 too: "I'm still 12") and once with `AGE_END_LOOSE`
(`atLeast13`, for endings like "and", "too"). The clause must still end like
an age, so a following unit ("5 minutes away"), a word ("in 2 minds") or a
time ("until 3") reads nothing.

## Other implementations considered

1. Add the three adverbs to `SAME`. Rejected: `SAME` also feeds the "almost /
   turning" one-less rules ("I'm still almost 16") and the spelled and
   `AGE_SEX` rules; one shared list would read "I'm now literally 5 minutes
   away" wherever `SAME` appears, and "just/only" already overlap it.
2. Extend the `AGE_END_LOOSE` lookahead to accept leading adverbs. Rejected:
   the lookahead runs after the number; the adverb is before it. The rule
   shape, not the terminator, is what misses.

## After (fix/stated-age-leading-adverb)

| Message | `statedAge` | `minorSignal` |
|---|---|---|
| I'm still 17 | 17 | true |
| im still 16 | 16 | true |
| I'm still fifteen | 15 | true |
| I'm currently 17 | 17 | true |
| I'm now 16 | 16 | true |
| I'm still 12 | 12 | true |
| I am still 14 | 14 | true |
| I'm still 25 | 25 | false |
| I'm currently 30 | 30 | false |
| I'm now 40 | 40 | false |
| I'm still 5 minutes away | none | false |
| I'm still waiting on my 10 dollars | none | false |
| I'm now in 2 minds | none | false |
| I'm currently in a meeting until 3 | none | false |
| I'm now 2 years into my career | none | false |

Unchanged: the 252 pre-existing corpus rows read the same; third-party ages
("he's still 15") are untouched (a different rule set, out of this defect).

## Results

- `bun run sim --only evals` (new corpus rows, before the code fix):
  29/30 blocking gates — "stated ages: the youngest real age in the message"
  fails on exactly the new rows; teen recall dipped to 95.1% (still passing).
- `bun run sim --only evals` (after the fix): 30/30 blocking gates, teen
  recall 100.0%.
- `bun run sim` (full, after the fix): PASS, 365/365 blocking gates,
  15 tracked off target, 317.6s, exit 0. Dev Postgres up; the simulator used
  its standard `review: "auto"` reviewer.
- `bun run typecheck`: pass.
- `bun run test:integration`: 704 pass, 0 fail, 8 skip (183.26s). The same 8
  environment-gated skips are on unmodified main.
- `bun run test:e2e`: 42 pass, 0 fail, 1 skip (12.10s).
- Real-LLM evidence: N/A — the fix and its gates are in the deterministic
  offline parser (PRD 32.14), which by design never depends on a model.
- Agent clients: N/A — no flow or transport change.
- Vibespec: N/A — no spec or generated module changes; `spec/` is untouched.
