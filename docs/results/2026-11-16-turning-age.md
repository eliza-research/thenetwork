# Short teen ages without a pronoun: turning 16/17

Date: 2026-11-16. Base: `ebf3e61`.

## Problem

`agesStated` reads "turning 18 next month" as 17. It reads nothing for the
same shape at 16 and 17: "turning 16 next month", "turning 17 in June",
"turning 16 soon", "almost 16", "nearly 17" all return `{}`. A member with an
adult record who says one of these gives no minor signal, so the member stays
matchable as an adult (`packages/network/src/network.ts`: the stated age feeds
`minorSignal` at lines 726-728, and the minor flip at 757-758 never fires).
Note: an unknown age is already treated as a minor and never matched
(`network.ts`, "Unknown age (6.3)"). The miss is only the adult-record case.

## Cause

`SHORT_AGE_RX` in `packages/network/src/classify.ts` (added by #501) has one
rule for "almost / nearly / turning 18" that returns 17. There is no rule for
16 or 17. Pronoun forms ("I'm turning 16 next month" -> 15) work, because the
`AGE_RX` rules read them.

## Fix

Generalize that one rule in place: it now reads 16, 17 and 18, and returns
the stated age minus one (`atLeast13`, same as the pronoun forms). The 18
case still returns 17. Added 11 corpus rows to
`evals/network/teen-age.jsonl` (10 teen rows with the exact stated age, 1
adult guard: "almost 16 years married").

Other implementations considered:

1. One literal rule per age (16 -> 15, 17 -> 16). Rejected: it copies the
   same pattern three times. The file already computes "one less" for the
   pronoun forms.
2. Extend the `AGE_RX` pronoun rules to pronoun-less forms. Rejected: those
   rules read every sentence. They would over-read ("my son is turning 16",
   "turning 16 years married"). The short rules stay anchored to the whole
   message, so a quote, a question, or a school-years account does not lower
   the sender's age. That anchor is the #501 design.

## Measurement

Command: `bun run sim --only evals` (same command, same seeds, same data).
Provider keys were not set, so the sim called no model. This change is
deterministic text parsing; no LLM reads or writes an age.

| Gate | Before | After |
|---|---|---|
| teen ages: recall >= 95% (n 263) | FAIL 93.1% | PASS 100.0% |
| teen ages: 0 adults read as minors | PASS | PASS |
| third-party ages are read exactly | PASS | PASS |
| stated ages: youngest real age | FAIL ("turning 16 next month" -> none, want 15; 4 more) | PASS |
| evals block, blocking gates | 28/30 pass | 30/30 pass, exit 0 |

The 252 pre-existing corpus rows still pass after the fix. They are the
untuned check: recall 100.0% covers them too.

`bun run typecheck`: exit 0 after the fix.

The `network` block (`bun run sim --only network`) ran after the fix with
the same method. Result: **66/66 blocking gates pass, 0 tracked off target,
1514.7s, exit 0.** Key gates: "invariants (seed 3, 10 days): 0 invariant
violations, minor contacts, canary leaks, errors", "minors: no minor is ever
an alternate", "plans: 0 minors in any plan role", "send-time recipient
policy: minors, declined pairs and replies; stated ages fail closed". Base
HEAD `ebf3e61` is CI green (`integration: success`, `offline: success`), so
no separate before run was made for this block.
