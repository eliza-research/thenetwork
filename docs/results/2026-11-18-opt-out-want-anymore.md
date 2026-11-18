# 2026-11-18 — "I don't want texts anymore" reads as a STOP

## Command

```
bun run sim --only evals     # same command, same data, before and after
bun run sim                  # full run, after the fix
bun run typecheck
bun run test:integration     # also with REQUIRE_PG=1
bun run test:e2e
```

Seed: n/a (deterministic text parsing; no LLM). Provider/model: n/a (offline
parser). Request settings: none. Sample size: 47 `opt-out-parse.jsonl` rows
(43 before) and 162 `opt-out.jsonl` rows (156 before).

## Problem

A member who texts "I don't want texts anymore", "I don't want messages
anymore", "I don't want to get texts anymore" or "I don't want to receive
messages anymore" was not read as a STOP by either opt-out reader:

- the platform consent ledger (`detectKeyword`, `packages/platform/src/consent.ts`)
  returned nothing, so the member stayed opted in and kept getting texts;
- the conversational reader (`parseOptOut`, `packages/core/src/replies.ts`)
  returned "none".

Both readers already read the determiner forms ("I don't want these texts",
"i dont want any more messages"). The miss is the form without a determiner
and the form with "to get / to receive" between "want" and the noun.

## Before (upstream main, `ebf3e61f`)

| Message | `detectKeyword` | `parseOptOut` |
|---|---|---|
| I don't want texts anymore | none | none |
| I don't want messages anymore | none | none |
| I don't want to get texts anymore | none | none |
| I don't want to receive messages anymore | none | none |

Evals gates on the new corpus rows (before the fix):

```
FAIL core parseOptOut (n 47): every row read as labelled:
     "I don't want texts anymore" -> none; "I don't want messages anymore" -> none;
     "I don't want to get texts anymore" -> none
FAIL platform opt-out (n 162, en + es): every opt-out line is a STOP, no other line is:
     stop: I don't want texts anymore -> none; ... (4 rows)
```

## Cause

`OPT_OUT_EN` in `packages/core/src/replies.ts` (the strict ledger reader) had
one want-form rule: `i don't want (these|your|any|any more|anymore|more|the)
MSGS`. The determiner slot was required, so a bare "want texts" never matched.
`LIKELY_EN` (the conversational reader) had no want-form rule at all: its
"don't" alternatives only covered "don't text/message/contact/send me".

## Fix

One rule in each reader, in place:

- `OPT_OUT_EN`: the determiner slot is now optional, an optional "to get / to
  receive" sits between "want" and the noun, and an optional "anymore" tail
  follows the noun. The noun stays restricted to the message words
  (`MSGS`: texts, messages, msgs, sms, notifications, spam), so "I don't want
  coffee anymore" and "I don't want to date anymore" stay out.
- `LIKELY_EN`: the same want-form added as one alternative.

Guard rows prove the boundary: "I don't want coffee anymore" and "I don't want
to date anymore" stay not-stop in both readers.

## Other implementations considered

1. Read every "don't want ... anymore" sentence as an opt-out, whatever the
   noun. Rejected: "I don't want coffee anymore" and "I don't want to date
   anymore" would stop a member who only declined a suggestion.
2. Make the determiner optional without the "anymore" tail, so any "I don't
   want texts" sentence stops. Rejected: "I don't want texts about jobs"
   would stop all texts, not only the job texts; the "anymore" family is the
   unambiguous one. (The determiner forms keep their existing, narrower read.)

## After (fix/opt-out-want-anymore)

| Message | `detectKeyword` | `parseOptOut` |
|---|---|---|
| I don't want texts anymore | stop | likely |
| I don't want messages anymore | stop | likely |
| I don't want to get texts anymore | stop | likely |
| I don't want to receive messages anymore | stop | likely |
| I don't want coffee anymore | none | none |
| I don't want to date anymore | none | none |

Unchanged: the 156 pre-existing `opt-out.jsonl` rows and the 43 pre-existing
`opt-out-parse.jsonl` rows read the same; "leave <app>" stays app-scoped;
Spanish rows are still tagged.

## Results

- `bun run sim --only evals` (new corpus rows, before the code fix): 28/30
  blocking gates — the two opt-out gates fail on exactly the new rows.
- `bun run sim --only evals` (after the fix): 30/30 blocking gates pass.
- `bun run sim` (full, after the fix): PASS, 365/365 blocking gates,
  15 tracked off target, 1161.8s, exit 0.
- `bun run typecheck`: pass.
- `bun run test:integration`: 704 pass, 0 fail, 8 skip (734.12s). Unmodified
  main also runs 704 pass, 0 fail, 8 skip, and the same 8 skips appear with
  `REQUIRE_PG=1`; they are environment-gated, not Postgres skips.
- `bun run test:e2e`: 42 pass, 0 fail, 1 skip (12.99s).
- Real-LLM evidence: N/A — the fix and its gates are in the deterministic
  offline readers (PRD 32.14), which by design never call a model.
- Agent clients: N/A — no flow or transport change; both readers are called
  before any message is sent or stored.
- Vibespec: N/A — no spec or generated module changes; `spec/` is untouched.
