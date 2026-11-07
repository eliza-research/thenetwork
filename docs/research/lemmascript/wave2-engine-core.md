# Wave 2: engine-core

Date: 2026-11-07. Scope: files directly in `packages/engine/src`. Hand-written. Counts come from `lsc check --backend=dafny`
(lsc 0.6.6, Dafny 4.11). No LLM calls.

## Proved files

Each file below is import-free. Shipping code calls it and the old inline logic is gone.

| File | Verified | Functions | Production call site |
|---|---|---|---|
| selectionGuard.ts | 18 | touchesMinor, countIn, cityCount, repeatsPair, dropReason, enforceSelection | policy.ts `guardSelection`, engine.ts step 5 |
| relayCore.ts | 13 | stateReason, partyReasons, consentReason, reasonFamily, decisionOf, severity, withHookReasons, headOutcome | relay.ts `relayItem`, `finish`, `relayItemAsync`; relayClef.ts `relayClefDecide` |
| filterCore.ts | 3 | memberCore, pairCore, eligibleAfterJudge | filters.ts `memberReason`, `pairReason`, `sendTimeReason`; engine.ts pass 2 |
| planCore.ts | 7 | inPlan, invitedIn, takenIn, pickPlans, planStep, planSettles, smallerKind, groupQuorum | plans.ts `planProposals`, `recordPlanAnswer`, `planFallback`; attention.ts `startProbeFlow` |
| attentionCore.ts | 6 | capValue, stricterCap, capBlocks, itemHardGate | attention.ts `capFor`, `itemGate`, `composeMessage`; plans.ts `planAllowanceConfig` |
| intervalCore.ts | 4 | insideOne, subtractSpan, mergeSorted | interval.ts `subtract`, `union` |
| pairKey.ts | 4 | pairKey | world.ts (re-exported, same name) |
| scoreCore.ts | 12 | fmin, fmax, acceptanceEstimate, debtStep, netValueOf | world.ts `acceptanceOf`, policy.ts `updateExposureDebt`, scoring.ts `netValue` |

Proof additions: selectionGuard (2 forall calls, 4 lemmas on the count functions), planCore (5 asserts), pairKey (2 string lemmas),
scoreCore (acceptance arithmetic, a `NetValueRisesWithPos` lemma). Trust: assume 0, havoc 0, extern 0, axiom 0.

## What the proofs do not cover

- Inputs passed as booleans or functions are trusted: `matchable`, `minor`, `blocked`, `held`, `allow`, `kindAllowedForMinor`.
- `itemHardGate` is not a proof of human review. The only live caller sets `reviewState` itself.
- `capValue` covers the plan-invite cap only, not intros or the cap of 3 a day (packages/network).
- The selection guard does not check the contribution budget or fixed-time overlap. `selectOnce` still does; a pack hook is not held to them.
- A proved `requires` is not checked at the call. `netValueOf` needs norm > 0, `capValue` needs period > 0, `subtractSpan` needs a non-empty cut. `resolveConfig` and `resolveAttention` check none of these.
- Numbers are ideal reals. NaN, Infinity and rounding are out. `pairKey` is proved symmetric, not injective: an id with `|` can collide.
