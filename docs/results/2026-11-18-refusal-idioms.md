# 2026-11-18 — "afraid not" and "not a chance" are refusals, not unclear

## Command

```
bun run sim --only evals     # same command, same data, before and after
bun run sim                  # full run, after the fix
bun run typecheck
bun run test:integration
bun run test:e2e
```

Seed: n/a (deterministic text parsing; no LLM). Provider/model: n/a (offline
parser). Request settings: none. Sample size: 189 `replies.jsonl` rows
(184 before) and 325 `consent-replies.jsonl` rows (322 before).

## Problem

Both reply readers read a clear refusal as "no answer":

- core `parseReply` (`packages/core/src/replies.ts`): "afraid not", "I'm
  afraid not", "not a chance" and "no chance" all returned "unsure".
- the Network's `consentOf` (`packages/network/src/classify.ts`): "afraid
  not", "I'm afraid not" and "not a chance" returned "unclear".

A member who answers a probe with "I'm afraid not" is asked again. The same
member has already refused. That is one extra interruption after a clear no
(PRD interruption budget). "no chance" was already a refusal for `consentOf`
(its bare-no rule lists "chance"), so only the core reader missed it.

## Before (upstream main, `ebf3e61f`)

| Message | `parseReply` | `consentOf` |
|---|---|---|
| afraid not | unsure | unclear |
| I'm afraid not | unsure | unclear |
| not a chance | unsure | unclear |
| no chance | unsure | no |

Evals gate on the new corpus rows (before the code fix):

```
FAIL core replies (n 189): every row read as labelled:
     "afraid not" -> unsure (want no); "I'm afraid not" -> unsure (want no);
     "not a chance" -> unsure (want no); "no chance" -> unsure (want no)
```

## Cause

`parseReply` had no pattern for either idiom: "not" alone is not a signal,
and the bare-"no" lookahead list does not include "chance". `consentOf`'s
`(intensifier) not` refusal rule lists intensifiers, not "afraid", and its
"not (...)" rule does not include "a chance".

## Fix

Three one-line extensions:

- core `parseReply`: "afraid not", "not a chance" and "no chance" join the
  strong refusal list (masked before yes words are read, like "no way").
- `consentOf` REFUSAL_RX: "afraid" joins the `(intensifier) not` rule;
  "a chance" joins the "not (...)" rule.

## Other implementations considered

1. Add "chance" to the core bare-"no" lookahead list and treat "not a" as a
   refusal prefix. Rejected: "not a good fit" is in another rule, "not a
   chance in hell" needs the whole idiom, and a bare "not a" prefix would
   over-fire on "not a fan of morning meets" (already covered elsewhere).
2. Read "afraid" as a refusal word whenever "not" follows in the sentence.
   Rejected: "I'm not afraid of the venue" would become a refusal. The fixed
   phrase "afraid not" is the idiom; the guard row proves the boundary.

## After (fix/refusal-idioms-both-readers)

| Message | `parseReply` | `consentOf` |
|---|---|---|
| afraid not | no | no |
| I'm afraid not | no | no |
| not a chance | no | no |
| no chance | no | no |
| not a chance in hell | no | no |
| I'm afraid so | unsure | unclear (guard: a reluctant yes, still re-asked, never booked) |
| give me a second chance | unsure | unclear (guard) |
| any chance you could move it to friday? | unsure | unclear (guard: a question, not an answer) |
| afraid so, but thursday works | yes (time constraint) | yes (guard: the yes path is untouched) |
| we're afraid of the rain forecast lol | unsure | unclear (guard) |

Unchanged: the 184 pre-existing `replies.jsonl` rows and the 322
pre-existing `consent-replies.jsonl` rows read the same.

## Results

- `bun run sim --only evals` (new corpus rows, before the code fix):
  29/30 blocking gates — "core replies: every row read as labelled" fails on
  exactly the four new rows. The consent-replies accuracy gate stayed above
  its 97% floor (99.1%) and is not the blocking proof.
- `bun run sim --only evals` (after the fix): 30/30 blocking gates; the
  consent-replies accuracy rose from 99.1% to 100.0% (n 325).
- `bun run sim` (full, after the fix): PASS, 365/365 blocking gates,
  15 tracked off target, 305.8s, exit 0. Dev Postgres up; the simulator used
  its standard `review: "auto"` reviewer.
- `bun run typecheck`: pass.
- `bun run test:integration`: 704 pass, 0 fail, 8 skip (179.78s). The same 8
  environment-gated skips are on unmodified main.
- `bun run test:e2e`: 42 pass, 0 fail, 1 skip (11.73s).
- Real-LLM evidence: N/A — the fix and its gates are in the deterministic
  offline readers (PRD 32.14), which by design never call a model.
- Agent clients: N/A — no flow or transport change.
- Vibespec: N/A — no spec or generated module changes; `spec/` is untouched.
