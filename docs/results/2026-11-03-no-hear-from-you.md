# No "hear from you": a permanent refusal of contact is not an opt-out

Date: 2026-11-03. Type: bug fix, consent reading. Provider and model: none. The two readers are
deterministic functions. This run makes no model call, needs no seed and costs nothing.

## Problem

The Network reads a stop request in two places. `parseOptOut` in `packages/core/src/replies.ts` is
the conversational reading. `optOutPhrase` in the same file is the strict reading that the platform
consent ledger acts on. A member who states a permanent refusal of contact is read as no opt-out:

| Member text | `parseOptOut` before | `optOutPhrase` before |
|---|---|---|
| "Do not contact me again" | likely | true |
| "I never want to hear from you again" | none | false |
| "I don't want to hear from you anymore" | none | false |

The first row works. The other two rows make the same request in other words, and they do nothing.
In production the consent ledger keeps the member subscribed, and the agent keeps talking to a
person who asked for no more contact.

## Root cause

Every opt-out pattern looks for an imperative: "stop texting me", "do not contact me", "remove me".
No pattern reads a first-person statement about future contact ("I never want to hear from you").
That sentence is not a command, so both readers return no opt-out.

The two readers agree on this text, so no existing gate shows the defect. The gap is a missing
reading, not a disagreement.

## Fix

One shared pattern, `NO_HEAR_FROM_YOU`, in `packages/core/src/replies.ts`. Both readers use it. The
pattern needs "from you", so a sentence about another person or a thing stays out.

| Member text | `parseOptOut` after | `optOutPhrase` after |
|---|---|---|
| "I never want to hear from you again" | likely | true |
| "I don't want to hear from you anymore" | likely | true |
| "I never want to hear anything from you" | likely | true |

These lines do not change. All stay "none" and not a stop: "I never want to hear that song again",
"I never want to hear from my ex again", "I want to hear from you", "I never want to hear from your
side", "do not contact me again" (already a stop), "leave slop" (one app only).

## Evidence

The change adds one row to each corpus. Each row fails before the fix and passes after it.

Command, the same before and after:

```bash
bun run sim --only evals
```

Before the fix:

```
FAIL  core parseOptOut (n 41): every row read as labelled: "i never want to hear from you again" -> none
FAIL  platform opt-out (n 105, en + es): every opt-out line is a STOP, no other line is: stop: I never want to hear from you again -> none
-- evals: 23/25 blocking gates pass
```

After the fix:

```
PASS  core parseOptOut (n 41): every row read as labelled
PASS  platform opt-out (n 105, en + es): every opt-out line is a STOP, no other line is
-- evals: 25/25 blocking gates pass
```

Sample size: 2 new corpus rows, 1 in `evals/opt-out-parse.jsonl` and 1 in `evals/opt-out.jsonl`.
The gates read 41 and 105 rows. The result is exact. No confidence interval applies.

## Limits

- This is a deterministic reader. The change adds no model call and no protocol change.
- The pattern needs "from you". A member who writes "I never want to hear from my ex again" asks us
  to stop relaying that person, not to stop all messages. The relay path reads that request on its
  own. The two readings stay separate.
- The pattern reads "I never want to hear from you two" as a stop. The member addresses our line,
  and a member can reply START to resume. A missed stop has no such undo, so the wider reading is
  the safer error.
- `bun run typecheck` passes. `bun run test:integration`, `bun run test:e2e` and `bun run security`
  need PostgreSQL on :54339. This host has no PostgreSQL server and no container runtime, so these
  suites did not run here. The change touches no database path and no e2e path.
- The full `bun run sim` reports 300/305 blocking gates. The 5 failures are in the audit block, and
  they are the same 5 on unmodified `main` at `a0ed7bc`. They come from the local site build on
  Windows, not from this change: `observatory-1`, `sites-infra-10`, `sites-infra-14`, `platform-5`
  and `plugin-prototypes-26` (a temporary folder with no `SKILL.md`).
