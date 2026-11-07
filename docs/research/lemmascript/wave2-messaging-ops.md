# LemmaScript wave 2: messaging-ops

Hand-written. Tools: lsc 0.6.6, Dafny 4.11 through the throttled shim. No LLM calls. Status: in progress; the sections below are filled as results arrive.

## Proved files

| File | lsc result | Production call site | Mutation (error reported) |
|---|---|---|---|
| packages/blooio/src/gate.ts | 7 verified | `OutboundQueue.dispatch` (`preCapGate`, `takesSlot`, `finalGate`), `end` (`isNotSent`), `applyStatus` (`nextStatus`) | Removed the leak step, the cap step, the STOP step, the `pass` re-check in `finalGate`; added `failed_unknown` to `isNotSent`; `<=` to `<` in `nextStatus`. Each gives an error on its `ensures`. |
| packages/blooio/src/quiet-window.ts | 5 verified | `isQuietAt`, `nextAllowedAt`, `inHourWindow` (judge and sim) | `end - mins - 1`: 2 errors |
| packages/blooio/src/blooio/client.ts | 1 verified, in place | `classifyFailure` as shipped | Conversation code to `retryable`: 1 error |
| packages/notify/src/decide.ts | 6 verified | `Notifier.plan`, `Notifier.build`, `resolveDelivery` | `>=` to `>` in `capFilter`: 1 error. Removed the ignored-streak step: 1 error |
| packages/capital/src/credit.ts | 13 verified, 2 asserts added in the .dfy | `CapitalLedger.credit`, `effortTier`, `vouchCapacity`, `organizingReach` | Tier 4: error. No room check: 2 errors. `v.max + 1`: error |
| packages/observatory/src/staff-roles.ts | 5 verified | `rolesFor`, `allowed`, `hasEverywhere`, `canCrossApp` | Engineer counts in real mode: 1 error |
| packages/observatory/src/console-gate.ts | 3 verified | `ageView`, `minorAt`, `loginProblem`, `deployGuard` | Removed the record-age step, the superuser step, the remote step: errors on the matching `ensures` |
| packages/observatory/db/numbers.ts | 2 verified | `checkNumbers` | Removed the duplicate return: 1 error (loop invariant) |
| packages/sim/src/judge/predicates.ts | 6 verified | `computeMetrics` (`over_budget`, `two_unanswered`, `person_cap`) | Re-engagement with no once-only check: 1 error |

The mutations ran on copies in the scratchpad, not in the shared tree. A copy has no .dfy additions, so the credit copies also show the known error at the `base` bound; each named mutation adds its own error.

## How the composition is proved

`capTake` is a side effect between the gates, so `dispatch` calls `preCapGate`, then takes the slot, then calls `finalGate`. `finalGate` runs `preCapGate` again on the same facts. So its `ensures` state the whole chain and do not trust the order of the calls in `dispatch`. `takesSlot` proves that a row stopped before step 9 never takes a slot. `dispatch` reads every fact before it decides, so a row that stops early now reads a few more facts than before. The hooks it reads are read-only (`rt.optedOut`, `policy`, `notificationCurrent`).

## What the proofs do not cover

Every fact in `GateFacts` is trusted: the proof says what the gate does with a fact, not that the fact is true. `capTaken` is true when a queue has no `capTake` hook, and a member with no `person_id` gets a slot with no limit in SQL (founder item in messaging-ops.md). Numbers are ideal: `capacity` and `reachOf` are modelled as integers, `perGood` could be fractional in a config; `isQuietMinute` is modelled on integers and the judge calls it with fractional minutes. Daylight saving is outside `quiet-window.ts`. The collected-reply seam does not run `dispatch`. `NaN` and rounding in `creditAmount` are outside the proof. `ledgerProblems` is a run-time check, not a proof.
