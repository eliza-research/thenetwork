# No-hear-from-you false positives: a pause, a question and reported speech are not a stop

Date: 2026-11-09. Type: bug fix, consent reading. Provider and model: none. The two readers are
deterministic functions. This run makes no model call, needs no seed and costs nothing.

## Problem

`packages/core/src/replies.ts` reads a stop request in two places. `parseOptOut` is the conversational
reading. `optOutPhrase` is the strict reading that the platform consent ledger acts on. The
`NO_HEAR_FROM_YOU` pattern, added for "I never want to hear from you again", was too wide. It read a
temporary pause, a question and reported speech as a permanent refusal of all contact. The consent
ledger then sends the carrier `STOP`, which stops every app.

Review of pull request 351 reported three groups. All three reproduce on the pull request head
`e781a25`:

| Member text | `parseOptOut` before | `optOutPhrase` before |
|---|---|---|
| "I don't want to hear from you right now" | likely | true |
| "I don't want to hear from you this week" | likely | true |
| "My ex said I never want to hear from you again" | likely | true |
| "I don't want to hear from you?" | likely | true |

## Root cause

Three separate gaps in one pattern:

1. **Permanence.** The pattern accepted `don't` and `do not` without `never`, so a request with a
   temporary bound ("right now", "this week") reached the same reading as a permanent refusal.
2. **Reported speech.** `parseOptOut` had a reported-speech guard, but it only covered
   `said ... stop`. Nothing guarded the no-hear-from-you phrase, and `optOutPhrase` has no
   reported-speech guard at all.
3. **Questions.** `parseOptOut` drops `?` while it normalizes, and `optOutPhrase` drops every
   punctuation mark before it tests. The phrase therefore matched a question about stopping.

## Fix

`NO_HEAR_FROM_YOU` now carries the permanence rule, a temporary-bound guard, and the question and
reported-speech guards. Both readers call one shared predicate, `readsNoHearFromYou`.

- **Permanence.** `never` carries it alone. `don't` and `do not` need `again`, `anymore`, `any more`
  or `ever`.
- **Temporary bound.** `right now`, `today`, `tonight`, `this week`, `this weekend`, `this month`,
  `for now`, `for a bit`, `for a while` and `until` cancel the reading, with or without `again`.
- **Question.** Text that ends in `?` is a question about stopping, not a stop.
- **Reported speech.** A third-person subject before a reporting verb ("my ex said", "she told me")
  makes the sentence a report about another person. "I said I never want to hear from you again"
  repeats the member's own request, so it stays a stop.

| Member text | `parseOptOut` after | `optOutPhrase` after |
|---|---|---|
| "I never want to hear from you again" | likely | true |
| "I don't want to hear from you anymore" | likely | true |
| "I do not want to hear from you again" | likely | true |
| "I said I never want to hear from you again" | likely | true |
| "I don't want to hear from you right now" | none | false |
| "I don't want to hear from you this week" | none | false |
| "My ex said I never want to hear from you again" | none | false |
| "I don't want to hear from you?" | none | false |

These lines do not change. All stay "none" and not a stop: "I never want to hear that song again",
"I never want to hear from my ex again", "I want to hear from you", "leave slop" (one app only).
"Please stop texting me" and the carrier keywords are unaffected.

## Other implementations considered

1. **A list of temporary bounds only.** Reject a phrase that contains "right now", "this week" and
   the rest. The reviewer reported this option. It leaves "I don't want to hear from you" open to the
   next temporary phrasing that is not on the list, and it still reads questions and reported speech
   as a stop. Not used.
2. **An anchor at the start of a clause.** Require the phrase to start the message or follow a
   sentence break. This removes reported speech, but it also removes real stops that follow a
   courtesy word ("Honestly, I never want to hear from you again"). A missed stop has no undo, so the
   narrower reported-speech guard is the safer error. Not used.
3. **The change above.** Permanence in the pattern, then two guards that remove only the reported
   forms.

## Evidence

The change adds six rows to each corpus. Four rows fail before the fix. Two rows hold the permanent
readings in place.

Command, the same before and after:

```bash
bun run sim --only evals
```

Before the fix, with the new rows in place and the source change removed:

```
FAIL  core parseOptOut (n 47): every row read as labelled: "I don't want to hear from you right now" -> likely; "I don't want to hear from you this week" -> likely; "My ex said I never want to hear from you again" -> likely; "I don't want to hear from you?" -> likely
FAIL  platform opt-out (n 111, en + es): every opt-out line is a STOP, no other line is: not_stop: I don't want to hear from you right now -> stop; not_stop: I don't want to hear from you this week -> stop; not_stop: My ex said I never want to hear from you again -> stop; not_stop: I don't want to hear from you? -> stop
-- evals: 23/25 blocking gates pass
```

After the fix:

```
PASS  core parseOptOut (n 47): every row read as labelled
PASS  platform opt-out (n 111, en + es): every opt-out line is a STOP, no other line is
-- evals: 25/25 blocking gates pass
```

| Metric | Before | After | Command |
|---|---|---|---|
| blocking eval gates | 23/25 | 25/25 | `bun run sim --only evals` |
| `core parseOptOut` rows read as labelled | 43/47 | 47/47 | same |
| `platform opt-out` rows read as labelled | 107/111 | 111/111 | same |
| `bun run typecheck` | pass | pass | `bun run typecheck` |

Sample size: 6 new rows in each corpus; the gates read 47 and 111 rows. The readers are
deterministic, so the result is exact. No confidence interval applies.

Full run, one run at the end:

```bash
bun run sim
```

Result: 300/305 blocking gates, 20 tracked gates off target, 584.1 s. The five failures are in the
audit block and come from the local site build on Windows: `observatory-1`, `sites-infra-10`,
`sites-infra-14`, `platform-5` and `plugin-prototypes-26`. The earlier run at `a0ed7bc` reported the
same five ([2026-11-03-no-hear-from-you.md](2026-11-03-no-hear-from-you.md)). This change touches no
site build, no console page and no prototype folder.

## Limits

- This is a deterministic reader. The change adds no model call and no protocol change.
- "I never want to hear from you until Friday" is read as a temporary pause. The member can reply
  STOP for the permanent reading.
- Reported speech is detected from a third-person subject and a reporting verb before the phrase.
  "A friend of mine said I never want to hear from you again" stays a stop, because "a friend of mine"
  is not one of the guarded subjects. That reading is the wider one, and the safer error.
- The pattern still reads "I never want to hear from you two" as a stop, as before.
- `bun run typecheck` passes. `bun run test:integration`, `bun run test:e2e` and `bun run security`
  need PostgreSQL on :54339. This host has no PostgreSQL server and no container runtime, so these
  suites did not run here. The change touches no database path and no e2e path.
- No real-LLM run: the two readers make no model call, and the sim clears provider keys. No agent
  client runs: the change alters a pure function that every client reaches through the same gateway
  path, so no client shows a different result.
