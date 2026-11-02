# Own stop repeat: "I said stop" is an opt-out

Date: 2026-11-02. Type: bug fix, consent reading. Provider and model: none. The two readers are
deterministic functions. This run makes no model call, needs no seed and costs nothing.

## Problem

The Network reads a stop request in two places. `parseOptOut` in `packages/core/src/replies.ts` is
the conversational reading. `optOutPhrase` in the same file is the strict reading that the platform
consent ledger acts on. A member who repeats their own request is read as no opt-out:

| Member text | `parseOptOut` before | `optOutPhrase` before |
|---|---|---|
| "I said stop" | none | false |
| "I already said stop" | none | false |
| "I told you to stop" | likely | false |

The last row is the worst one. The two readers disagree about the same message. The file header
says both readers must read member text the same way.

## Root cause

The reported-speech guard catches third-party speech. It looks for "said", "says", "told" or "asked"
in front of "stop", with no subject. So it also catches the member's own sentence. The guard was
written for "my friend said stop". It treats "I said stop" the same way.

The strict reading has no first-person rule at all, so it never reads the repeat as a stop.

## Fix

One shared pattern, `OWN_STOP`, in `packages/core/src/replies.ts`. Both readers use it. A preposition
after "stop" keeps the sentence out: "I said stop by", "I said stop after work".

| Member text | `parseOptOut` after | `optOutPhrase` after |
|---|---|---|
| "I said stop" | likely | true |
| "I already said stop" | likely | true |
| "I told you to stop" | likely | true |

These lines do not change: "my friend said stop", "she told me to stop", "I never said stop",
"how do I stop", "stop by at 7", "I said stop by", "leave slop". All stay none.

## Evidence

The change adds rows to two corpora. Each row fails before the fix and passes after it.

Command, the same before and after:

```bash
bun run sim --only evals
```

Before the fix:

```
FAIL  core parseOptOut (n 43): every row read as labelled: "i said stop" -> none; "i already said stop" -> none
FAIL  platform opt-out (n 107, en + es): every opt-out line is a STOP, no other line is: stop: I said stop -> none; stop: I already said stop -> none; stop: I told you to stop -> none
-- evals: 23/25 blocking gates pass
```

After the fix:

```
PASS  core parseOptOut (n 43): every row read as labelled
PASS  platform opt-out (n 107, en + es): every opt-out line is a STOP, no other line is
-- evals: 25/25 blocking gates pass
```

Sample size: 6 new corpus rows, 3 in `evals/opt-out-parse.jsonl` and 3 in `evals/opt-out.jsonl`.
The gates read 43 and 107 rows. The result is exact. No confidence interval applies.

## Limits

- This is a deterministic reader. The change adds no model call and no protocol change.
- The Windows run reports 5 audit gate failures in the sites build. They are local harness problems
  (a temp folder has no `SKILL.md`, and the site build throws `parsed.description`). They are not
  related to this change, and CI is green on `main` at `a0ed7bc`.
