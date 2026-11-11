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

## Force: one mutation per rule, each rejected by lsc

Run on scratch copies with `lsc regen` (the shipped files were not changed). Every mutation below made `lsc` report an error.

| File | Mutation | Result |
|---|---|---|
| selectionGuard | budget test `count + 1 > allow` to `count > allow` | 2 errors |
| selectionGuard | alternates not checked for minors | 1 error |
| selectionGuard | city cap off by one | 2 errors |
| selectionGuard | repeated-pair check removed | 1 error, 1 time out |
| relayCore | sender hold ignored; not-mutual passes; stale consent passes; hook replaces rule reasons; one reason passes | 1, 1, 1, 2, 1 errors |
| relayCore | Clef head `p < bar` to `p <= bar`; block without a severe feature | 1, 1 errors |
| filterCore | pack age floor skipped; second minor not checked; judge can rescue | 1, 1, 1 errors |
| planCore | the shipped alternates rule (D1); book below quorum; booked plan closes on a no; pair booked directly; quorum below 3 | 1 error each |
| attentionCore | only-when-asked ignored; override above the cap; unreviewed item passes; minors get items with others; allowance always wins | 1 error each |
| intervalCore | subtract keeps the cut; touching intervals not merged; part outside the input | 1 error each |
| pairKey | key keeps argument order | 1 error |
| scoreCore | acceptance above 1; debt cap 3x | 2, 2 errors |

## Defects

| # | Status | Change | Before-fix evidence |
|---|---|---|---|
| D1 plans: one member an alternate in two plans of one run | fixed | plans.ts calls `pickPlans`: alternates exclude anyone invited anywhere or an alternate of a better plan; plan choice is unchanged | test "one member is in at most one plan": `p12` in 2 plans |
| C1 a pack's `assign` output was checked for minors only | fixed (guard) | engine.ts calls `guardSelection` (policy.ts) on any selector | tests "cannot repeat a pair" (32 proposals, 16 repeats) and "open opportunity" (`a` proposed) failed |
| D3 `acceptedBy` / `noResponse` not canonicalised | fixed | world.ts maps both through the alias table | test "answers recorded under an alias": 0.45 instead of 0.843 |
| D7 Clef `minor_signal` did not set `ageSignal` | fixed | relayItemAsync sets it for `clef:minor_signal` (still a hold, as before) | test "a Clef minor signal flags the age": false |
| D2 a closed or expired intent opts a member in to a lane | NOT fixed, reverted | Moving the relabel under the liveness check makes the blocking network gate "trust: no honest member is flagged; bad actors who acted are restricted" fail (`nyc-g2-0001` acted and was not restricted). The sim depends on the defect through its run path. Needs the network trust owner to look at that gate first. | reproduced (lanes `["social","hobby"]` with no live intent) |

All before-fix runs: the integration file on a copy of the tree with my engine files at HEAD: 5 fail, 2 pass. After: 7 pass, 0 fail.

## The selection guard and slopPack (decision for the founder or packs owner)

With `cfg.budgets` and the city cap enforced on `slopAssign` output, the slop block changed: the guard dropped 15 picks per conformance run (`member_budget`), two blocking gates failed and dates per member-month fell from 1.005x to 0.745x random. slopPack declares `budgets` 2 per 7 days but nothing enforces them (no budget rule, and `slopAssign` ignores `extraProactive`). So the guard does not hold a pack with its own `assign` to cfg budgets or the city cap; it does hold it to minors in any role, repeated pairs, and members in an open opportunity or held for an ask. Whether slop's declared budget should bind is a product decision; not decided here. `pack.ts` doc comment updated to say this.

## Sim parity

Method: the shared worktree changed under other agents during the run, so I compared copies of one tree state with and without my engine files (HEAD versions), same command, pinned seeds.

| Block | Result |
|---|---|
| slop, peon, friends | all gates and fingerprints identical |
| relay, audit | all gates identical (16 and 71 gates) |
| network | identical with D1 reverted (bisected). With D1: fingerprints change, all 61 blocking gates pass; consent vs push everyone-yes 0.847 -> 0.836, invite-yes 0.919 -> 0.915, meetings 144 -> 148, plans booked and held 1,0,1 -> 1,0,4. D3 alone: no change. |

Final runs on the worktree: network 61/61, slop 40/40, peon 27/27, friends 18/18, relay 60/60, audit 16/16 blocking gates pass.

## Tests and checks

- `lsc check` on the 8 files: 18, 13, 3, 7, 6, 4, 4, 12 verified, 0 errors. All 8 appended to LemmaScript-files.txt.
- `packages/engine/test/selection-guard.integration.test.ts` (new): 7 pass.
- `packages/network/test/shared-relay.integration.test.ts`: 10 pass.
- `bunx tsc --noEmit -p .`: no errors in my files (earlier runs showed errors only in other areas' files in progress).
- Trust counts for my files: assume 0, havoc 0, extern 0, axiom 0.

## Skipped, with reason

- `harmonic` pair arm: needs a real zero literal (lsc blocker); quality only.
- `interpolate` (calibrator knots): quality only, not a bound anything relies on.
- `pipelineDecision`, `pass2Accepts`, `recordProbeAnswer`, `validatePack` floor: no production caller (evals or sim only).
- `sendTimeReason`, `eligibilityFor` and the other D5 functions: no production caller. `sendTimeReason` now calls `memberCore`, so it removes a copy, but it is still dead code.
- `pairKey` injectivity: false when an id holds `|`; needs an id rule at World build, not added.
- `resolveConfig` / `resolveAttention` checks for norm > 0 and period > 0 (the proved `requires`): a config validation change, not a listed defect.
- D4 (stale need channel) and D6 (dead `exclude`, slop ask counting): dead code or packs area.

## Changes needed in files I do not own

- packs owner: decide whether slopPack's declared `budgets` should bind; if yes, enforce in `slopAssign` (and count `extraProactive`), then the guard can hold `assign` packs to cfg budgets too.
- network trust owner: the trust gate breaks when D2 is fixed; look at it before the D2 fix lands.
- coordinator: `proofs/trust.json` needs no change for my files (all counts 0).
