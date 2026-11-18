# slop onboarding: a letter before an age range is who the member seeks, not who they are

Date: 2026-11-01. Hand-written. Rules-only reader (no model). Simulator review mode: not used (corpus gates only).

## Problem

The slop onboarding reader (`packages/engine/src/packs/slop/extract.ts`) reads letter-first shorthand
("f27", "m 31") as the member's own gender and age. It also read the letter and the first number of a
target range in a seek phrase:

| Message | Before | After |
|---|---|---|
| `29F seeking M 30-40` | gender `man`, seeks `man` | gender `woman`, seeks `man` |
| `32M seeking F 28-35` | gender `woman`, age 28 | gender `man`, age 32 |
| `looking for f 25-30` | gender `woman`, age 25 | gender unset, age unset |
| `into m 30-40` | gender `man`, age 30 | gender unset, age unset |

The later match wins in `readGender`, so the misread replaced the correct "29F" or "32M" read. A
straight woman became a gay man in the profile, and the read-back said so ("you're a woman 25-30" for
the third row).

## Cause

Two rules match `(f|m) <two digits>` with no check of what follows the digits:

- the shorthand gender rule in `readGender`;
- the shorthand age rule in `AGE_RULES`.

The gender-word age rule next to them already refuses a number that starts a range
(`(?!\s*(?:-|to)\s*\d)`). The two letter rules did not have that guard.

## Fix

Add the same range guard to the two letter-first rules. A two-digit number followed by "-" or "to"
and a digit is the start of an age range, never the member's own age.

## Measurement

Command: `bun run sim --only onboard` (rules only, fixed corpora and persona seeds 13, 14). Two corpus
rows added (append-only): one in `hard.jsonl`, one in `ages.jsonl`.

| Gate | Before (rows added, fix not applied) | After |
|---|---|---|
| hard fields: 0 wrong gender or seeking parses | FAIL (`29F seeking M 30-40` -> `man`) | PASS |
| hard fields: accuracy | 99.7% (308/309) | 100.0% (309/309) |
| stated ages read exactly | FAIL (`32M seeking F 28-35` -> 28) | PASS |
| onboard blocking gates | 17/19 | 19/19 |

Every other line of the onboard output is identical before and after (the P4 persona sim: 89.7% of
hard fields filled within 24 h; ported parser rows 94.1%). `bun run sim --only slop --quick --json`
output is byte-identical before and after (same arm fingerprint).

## Limits

- A seek letter with one number and no range ("seeking F 28") is still read as the member's own
  shorthand. It is rare in a dating answer, and a guard on seek verbs is a wider change.
- "F" alone is not a seek word ("32M seeking F" leaves seeks unset). That is a miss, not a wrong value.
- No real-LLM run: this reader is deterministic and makes no model call.
