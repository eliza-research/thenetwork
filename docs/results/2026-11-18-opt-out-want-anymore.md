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
parser). Sample size: 50 `opt-out-parse.jsonl` rows (43 before) and 165
`opt-out.jsonl` rows (156 before).

## Problem

A member who texts "I don't want texts anymore", "I don't want messages
anymore", "I don't want to get texts anymore" or "I don't want to receive
messages anymore" was not read as a STOP by either opt-out reader:

- the platform consent ledger (`detectKeyword`, `packages/platform/src/consent.ts`)
  returned nothing, so the member stayed opted in and kept getting texts;
- the conversational reader (`parseOptOut`, `packages/core/src/replies.ts`)
  returned "none".

The strict ledger reader already read the determiner forms ("I don't want
these texts", "i dont want any more messages"); the conversational reader
returned "none" for them on base. The miss is the form without a determiner
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
FAIL core parseOptOut (n 50): every row read as labelled:
     "I don't want texts anymore" -> none; "I don't want messages anymore" -> none;
     "I don't want to get texts anymore" -> none
FAIL platform opt-out (n 165, en + es): every opt-out line is a STOP, no other line is:
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

- `OPT_OUT_EN`: the want-form now reads "i don't want <MSGS> anymore" (an
  optional "to get / to receive" sits between "want" and the noun), and keeps
  the determiner forms as they were ("i don't want these texts", with or
  without an "anymore" tail). Without a determiner the "anymore" tail is
  required, so a scoped preference ("I don't want texts about jobs") is not
  read as a STOP. The noun stays restricted to the message words (`MSGS`:
  texts, messages, msgs, sms, notifications, spam), so "I don't want coffee
  anymore" and "I don't want to date anymore" stay out.
- `LIKELY_EN`: the same want-form added as one alternative.

Guard rows prove the boundary: "I don't want coffee anymore" and "I don't want
to date anymore" stay not-stop in both readers. Not-stop rows for the scoped
forms ("I don't want texts about jobs", "on weekends", "after 9pm") prove a
member narrowing their texts is not unsubscribed from all of them.

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
| I don't want texts about jobs | none | none |
| I don't want texts on weekends | none | none |
| I don't want texts after 9pm | none | none |

Unchanged: the 156 pre-existing `opt-out.jsonl` rows and the 43 pre-existing
`opt-out-parse.jsonl` rows read the same; "leave <app>" stays app-scoped;
Spanish rows are still tagged. In the strict ledger the determiner forms keep
their existing read ("I don't want these texts" stays a STOP; "I don't want
these texts about jobs" also stays a STOP, as it already was on base). In the
conversational reader the want-form reads them "likely" (none on base).

## Review follow-up (2026-11-19)

Reviewer dd12m54 found that the first version of this change made the
"anymore" tail optional in both patterns, so a scoped preference ("I don't
want texts about jobs", "texts on weekends", "texts after 9pm", bare "I don't
want texts") read as a global STOP — the exact case "Other implementations
considered" 2 says was rejected. Measured on the first head (`06f1bde`):

| Message | `detectKeyword` | `parseOptOut` |
|---|---|---|
| I don't want texts about jobs | stop | likely |
| I don't want messages about jobs | stop | likely |
| I don't want texts on weekends | stop | likely |
| I don't want texts after 9pm | stop | likely |
| I don't want messages about the hike | stop | likely |
| I don't want texts | stop | likely |

The fix: the "anymore" tail is required when there is no determiner. The four
fix sentences all end in "anymore", so they keep their STOP reading; every row
above now reads none / none. Not-stop rows for "I don't want texts about
jobs", "on weekends" and "after 9pm" were added to both corpora, so the gates
fail on them if the tail becomes optional again (verified: with only the
`replies.ts` change reverted, both opt-out gates fail on exactly the three
new rows).

## Results

- `bun run sim --only evals` (all new corpus rows, the first head's readers,
  `06f1bde`): 28/30 blocking gates — the two opt-out gates fail on exactly the
  three new not-stop rows ("I don't want texts about jobs" -> stop/likely,
  "on weekends" -> stop/likely, "after 9pm" -> stop/likely). With the base
  readers (`ebf3e61`) the same two gates fail on exactly the four new stop
  rows (the "Before" block above).
- `bun run sim --only evals` (after the fix): 30/30 blocking gates pass.
- `bun run sim` (full, after the fix): PASS, 365/365 blocking gates,
  15 tracked off target, 565.1s, exit 0. Dev Postgres up, so the safety, ops,
  pipeline, pipeline-slop and audit blocks ran; the simulator used its
  standard `review: "auto"` reviewer.
- `bun run typecheck`: pass.
- `bun run test:integration`: 704 pass, 0 fail, 8 skip (238.78s), dev
  Postgres up; the same 704 pass, 0 fail, 8 skip with `REQUIRE_PG=1`
  (186.17s), so the 8 skips are environment-gated, not Postgres skips. The
  PR's previous head (`06f1bde`) runs the same 704 pass, 0 fail, 8 skip with
  the same toolchain. (All runs need bun >= 1.4: with bun 1.3.14 the same
  suite hangs in the Postgres real-mode files — 23 failures that are the
  toolchain's, not the code's.)
- `bun run test:e2e`: 42 pass, 0 fail, 1 skip (12.60s).
- Real-LLM evidence: N/A — the fix and its gates are in the deterministic
  offline readers (PRD 32.14), which by design never call a model.
- Agent clients: N/A — no flow or transport change; both readers are called
  before any message is sent or stored.
- Vibespec: N/A — no spec or generated module changes; `spec/` is untouched.
