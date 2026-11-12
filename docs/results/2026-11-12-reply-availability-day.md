# An availability refusal of a named day is read as a plain yes

Date: 2026-11-12
Base: `a0ed7bc` (`main`)
Package: `packages/core/src/replies.ts` (`parseReply`), corpus `evals/replies.jsonl`
Model: none. This reader is deterministic and makes no LLM call.

## Result

`parseReply` had no reading for an availability refusal of a named day when an availability
word sits between the negator and the day ("not around Thursday", "not available on Friday",
"not free Thursday"). The existing time-refusal rule expects the day right after the negator, so
it did not match, and the rest of the sentence was read on its own:

- "I'm not around Thursday, but Friday works" became a plain `yes` with no constraint. The
  member refused Thursday and offered Friday, and the reply was read as consent to the day they
  refused. The same happened with "not in town Friday, but Saturday works".
- "I'm not around Thursday" became `unsure` (no signal) instead of a refusal, so the caller asks
  again instead of reading the refusal.
- "I'm not free Thursday, but Friday works" became a hard `no` with no constraint and no counter,
  because the generic strong refusal "not free" matched first. The offered Friday was dropped, so
  the flow never answers the time the member offered. That contradicts the parser's own
  documented reading of "Not Thursday, but Friday works" (`unsure`, counter, leaning yes).

`packages/sim/src/agent/policy.ts` `parseYesNo` delegates to `parseReply`, so the simulator's
planner books the day the member refused and never tests the offered alternative.

## Reproduction

```bash
cd /tmp/wt-tn   # a checkout of main
bun -e '
import { parseReply } from "./packages/core/src/replies.ts";
for (const t of [
  "I'\''m not around Thursday, but Friday works",
  "not in town Friday, but Saturday works",
  "I'\''m not around Thursday",
  "I'\''m not free Thursday, but Friday works",
]) console.log(JSON.stringify(t).padEnd(50), JSON.stringify(parseReply(t)));
'
```

`main` (`a0ed7bc`):

```
"I'm not around Thursday, but Friday works"         {"answer":"yes","constraints":[],"counter":false,"reason":"yes"}
"not in town Friday, but Saturday works"            {"answer":"yes","constraints":[],"counter":false,"reason":"yes"}
"I'm not around Thursday"                           {"answer":"unsure","constraints":[],"counter":false,"reason":"no_signal"}
"I'm not free Thursday, but Friday works"           {"answer":"no","constraints":[],"counter":false,"reason":"refusal"}
```

The gate fails on `main` with the corpus rows added (a labels-only change), including the
existing "no negated or hedged reply read as yes" invariant:

```
$ bun run sim --only evals
FAIL  core replies (n 189): every row read as labelled: "I'm not around Thursday, but Friday works" -> yes (want unsure); "not in town Friday, but Saturday works" -> yes (want unsure); "I'm not around Thursday" -> unsure (want no); "I'm not free Thursday, but Friday works" -> no (want unsure)
FAIL  core replies: no negated or hedged reply read as yes
FAIL: 23/25 blocking gates, 0 tracked off target, 0.7s (evals 0.7s)
```

With the fix:

```
$ bun run sim --only evals
PASS: 25/25 blocking gates, 0 tracked off target, 0.6s (evals 0.6s)
```

Readings after the fix:

```
"I'm not around Thursday, but Friday works"         {"answer":"unsure","constraints":[{"kind":"time","text":"not around thursday"}],"counter":true,"leaning":"yes","reason":"time_refused_other_offered"}
"not in town Friday, but Saturday works"            {"answer":"unsure","constraints":[{"kind":"time","text":"not in town friday"}],"counter":true,"leaning":"yes","reason":"time_refused_other_offered"}
"I'm not around Thursday"                           {"answer":"no","constraints":[{"kind":"time","text":"not around thursday"}],"counter":false,"reason":"time_refusal"}
"I'm not free Thursday, but Friday works"           {"answer":"unsure","constraints":[{"kind":"time","text":"not free thursday"}],"counter":true,"leaning":"yes","reason":"time_refused_other_offered"}
```

## Fix

One `timeNeg` rule before the existing time-refusal rule:

```
\b(?:not|never)\s+(?:be\s+)?(?:free|available|around|in town)\s+(?:(?:on|the|this|for)\s+)?${DAY}\b
```

It reuses the existing `DAY` word list and the existing `timeNeg` path, so a refused day with a
later "but Friday works" returns `unsure` with `counter: true`, `leaning: "yes"` and the refused
day as a `time` constraint, and a refused day alone returns `no` with that constraint.

Two other implementations were rejected:

1. Widen the one existing `timeNeg` rule so any words may sit between the negator and the day.
   That makes "not a fan of Thursday" and "never been to Thursday's bar" time refusals.
2. Read the day refusal in the callers (`packages/sim/src/agent/policy.ts`). That is the
   duplicate parser AGENTS.md decision 11 removes; the simulator must not grade the system with
   its own reader.

## Measurements

The corpus rows are the only data change. Before and after, the same command and the same corpus:

| Reply | `main` (a0ed7bc) | This branch | Corpus label |
|---|---|---|---|
| I'm not around Thursday, but Friday works | `yes` (a refusal read as consent) | `unsure`, counter, leaning yes | unsure |
| not in town Friday, but Saturday works | `yes` (a refusal read as consent) | `unsure`, counter, leaning yes | unsure |
| I'm not around Thursday | `unsure` | `no` + time constraint | no |
| I'm not free Thursday, but Friday works | `no`, no constraint, no counter | `unsure`, counter, leaning yes | unsure |
| I'm not around people I don't know | `unsure` | `unsure` (unchanged guard) | unsure |

The other 184 corpus rows keep their labels; the invariants the evals block already holds stay
green (no negated or hedged reply read as yes, the reason never carries member text, the
constraints and counters keep their shape).

## Suite runs

Re-run on 2026-11-13: Linux, Bun 1.4.2, local Postgres 16 on port 54339, no provider key set.

| Revision | Command | Result |
|---|---|---|
| `main` (`a0ed7bc`) | `bun run sim` | `PASS: 327/327 blocking gates, 14 tracked off target, 741.2s` |
| this branch | `bun run sim` | `PASS: 327/327 blocking gates, 14 tracked off target, 745.9s` |
| this branch | `bun run typecheck` | exits 0 |
| this branch | `bun run test:integration` | `681 pass, 8 skip, 0 fail, 13974 expect() calls. Ran 689 tests across 68 files.` |
| this branch | `bun run test:e2e` | `42 pass, 1 skip, 0 fail, 654 expect() calls. Ran 43 tests across 3 files.` |

The full run on `main` uses the corpus without the four new rows. With those rows on `main` the
evals block fails as shown above. No other gate or tracked number moves between the two revisions.

## Limits

- The rule lists only words whose negation means unavailable. "I don't work Thursdays" and "I'm
  not working Thursday" are left out on purpose: in a scheduling answer they usually mean the
  member is free that day, so reading them as a refusal would be wrong. A member who means "that
  day does not work for me" and names no other day is still read as `unsure`.
- "not free until Friday" is unchanged: "until Friday" is availability from Friday, so the day
  is not a refusal.
- Other phrasings of the same intent remain open and are not claimed here: "Thursday is no good"
  (already a `no`, the day is not kept as a constraint), and a day written as a date ("the 12th").
- `packages/network/src/classify.ts` `consentOf` keeps its own refusal list and its own counter
  rules. Its last-word guard asks the shared reader only whether it reads a `no`, so this change
  does not alter `consentOf`'s answers. That reader is not changed here.
- No model is involved: the reader is deterministic. The provider and model for this work are in
  the pull request footer.
