# Quint findings: matching_engine

Model: [quint/matching_engine.qnt](../../../quint/matching_engine.qnt). Module plan: section 6.16 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Code base: branch `wave2/matching_engine`
(ad67275 plus the defect fixes in section 3). This file is hand-written. The check output below is copied
from the tools.

## 1. Final state

`safety` passes in simulation and in bounded model checking. Each fixed defect has its invariant in
`safety`, and each action that a fix changed follows the fixed code. The defects that are not fixed are
kept out of `safety`. Each one has its own named value with the defect id and the reason (section 4).
Those values are still violated on the current code, so the model still shows them.

## 2. What the model contains

- **slop part.** Three adults (a, b, c; b smokes) and one member aged 15 (k). The onboarding loop
  (`memberSays`, `agentNext`, `sweep`, and the late answer after the sweep), the persisted app tags, the
  location ask and its 7-day silent fallback, the engine's basics ask, the daily run (engine pick, judge
  cache and the Network gate in one action), review, the probe outcome and the booked date.
- **peon part.** One hiring manager with postings A and B, one candidate. Drafts by text (`sms`) or by the
  assistant (`mcp`), the manager's yes, the staff postings API (served in prod), employer verification,
  the engine run for a seat, review, the candidate's and the manager's answers, and `checkSeats` at each
  tick.
- **probe-flow part.** The `ProbeFlow` library with one or two participants.
- **plan part.** The member-rule chain that `planMemberReason` reads.
- Oracles: the message reader (a message is one "kind"), the score (any eligible pair), the judge verdict.
- The parts share only `now`. A trace steps one part (`focus`). "slopSafety" and "peonSafety" add holds
  and late minor ages. "slop" and "peon" leave them out, so that the deep witnesses stay reachable.
- peon runs on two environments: `prod` (the service as deployed: nothing writes candidate facts, SD-224)
  and `harness` (the integration tests seed candidate rows).

## 3. Defects: status and model change

| Id | Status | Commit | Model change | Invariant (in `safety`) | Run |
|---|---|---|---|---|---|
| SD-063 | fixed | dcf24da | `flowAnswer`: the first yes of a one-participant flow reveals it | probeFlowProgresses | oneParticipantFlowTest |
| SD-042 | fixed | 7c08084 | `mgrYes("mcp")` changes nothing (postingTurn runs only for the member's own text) | confirmedInOwnThread | mcpPostingTest |
| SD-114 | fixed | ce667b2 | `mgrYes` drops a draft for a stored posting that is not active; `staffSave` refuses it (409) | closedTerminal, openingsPreserved | staffReopenTest, staleDraftTest |
| SD-061 | fixed | 8a14083 | `tagsAfter`: `slop:dealbreaker:` is always replaced | deletedFieldClearsTag | deletedDealbreakerTest, takenBackDealbreakerTest |
| SD-206 | fixed | 7ca8fa2 | `planReason`: the budgets are forgiven, the later rules still run | planSeatHonorsHoldout | planHoldoutTest |
| SD-207 | fixed | 8d018ed | `engineMemberOk`: a member with no budget left is not usable | budgetAcrossAssign | overBudgetTest |
| SD-209 | fixed | 60eecb2 | `engineMemberOk`: a location tag, or a location ask silent for 7 days | locatedBeforeMatch | locationAskedTest, locationSilentTest |
| SD-210 | fixed | 3c059f6 | `slopReview` reject: the item is in unsentProposalIds; the engine does not count it | unsentNotBilled | rejectedBilledTest |
| SD-262 | fixed | 3c059f6 (test 0bc735d) | same as SD-210 (reject and SLA expiry are one action in the model) | unsentNotBilled | rejectedBilledTest |
| SD-223 | fixed | 8e9120e | `enginePairOk`: pairs the gate refuses for 60 days are avoid edges | engineAgreesWithGate | reprobeGateTest, rejectAvoidTest |
| SD-225 | fixed | f581d75 | staff actions no longer need `harness` (`STAFF_API_SERVED`) | witness_prodEmployerVerified (reachable) | prodVerifyTest |
| SD-227 | fixed | 6e5a4c4 | a repeated must-have is saved once; the unit commits | acceptedPostingPersists | dupMustTest |
| SD-260 | fixed | ca8b67a | none: the plans buddy belongs to quint/plan_run.qnt | - | - |
| SD-296 | fixed | d2921d3 | `engineSeatOk`: the seat is held with its manager | engineNeverSelectsHeld | heldSeatTest |
| SD-327 | fixed | dc84661 | `mgrYes`: closedReason "filled" for "we filled it" | filledRecorded | filledTest |
| SD-419 | fixed | 45c479e | `basicsAskDue`: at most MAX_ASKS (2) basics asks | askTerminates | basicsLoopTest |
| SD-420 | fixed | cdce14f | `slopDailyRun`: the judge reads every candidate pair, and a pair judged within the TTL is a cache hit | judgeCacheReused | judgeCacheTest |
| SD-422 | fixed | 07b88dd | none: exploration trimming is inside selection scoring (an oracle) | - | - |
| SD-427 | fixed | 461b02e | `memberSays`: with no open wait, a text that changes the onboarding state is read as the answer to the last unanswered ask | answersReachLoop, witness_lateAnswerRead | sweptAnswerTest, lateNothingTest |
| SD-435 | fixed | 0f14a56 | none: the venue table is data, not state | - | - |
| SD-439 | fixed | c05b9b2 | the decline is kept per seat (`declAt` per posting); the engine gets a (candidate, seat) avoid edge | declineScopedToJob | crossJobTest |
| SD-441 | fixed | f36c9c5 | none: peon history inputs feed scores and the history profile only (abstracted) | - | - |
| SD-443 | fixed | 8f3673a | `slopProbe`: a hike books a day slot only | activityFitsSlot | hikeSlotTest |
| SD-329 | not reproduced | - | none | - | - |
| SD-418 | not reproduced | - | none | readBackHasPath (not in `safety`) | readBackCapTest |
| SD-060 | skipped | - | none | readBackBeforeMatch (not in `safety`) | unconfirmedMatchTest |
| SD-121 | skipped | - | none | activeIsLive (not in `safety`) | silentExpiryTest |
| SD-224 | skipped | - | none | candidatesWritable (not in `safety`) | - |
| SD-226 | skipped | - | none | postedCanMatch (not in `safety`) | - |
| SD-228 | skipped | - | none (no hire or offer states exist) | - | - |
| SD-415 | skipped | - | none (the need channel is part of scoring, an oracle) | - | - |
| SD-440 | skipped | - | none | inFlightMatchesPosting (not in `safety`) | staleYesTest |

Notes on the fixed rows:

- **SD-225.** The old invariant `postedVerifiable` stood in for "a path to verify an employer exists in
  prod". An invariant cannot say that a state is reachable, so the model now has the witness
  `witness_prodEmployerVerified`. The check fails if prod cannot reach a verified employer.
- **SD-209.** The fix keeps the silent fallback of the zip ask (`rules.ts:38`): when the location
  question has had no answer for 7 days, the member is matched at the market anchor cell. The model
  follows this. `locatedBeforeMatch` (in `safety`) says that the engine asked first.
  `locatedBeforeMatchStrict` (not in `safety`) says that both members have a location. It is violated
  through the fallback (`locationSilentTest`). This is by design in the fix (the same "never a lockout"
  rule as for the zip). A change needs a founder decision, because without the fallback a silent member
  is never matched.
- **SD-419.** `askTerminates` now says that the basics ask stops (at most 2 asks). The old form said that
  no basics ask is sent after the member answered. The fix does not give that: `needsBasics` reads tags
  only, so a member who said "no dealbreakers" still gets up to two asks. That old form is kept as
  `noBasicsAfterAnswer`, not in `safety`.
- **SD-420.** The model now lets the judge read every eligible pair of a run, not only the picked one.
  Without this, the 60-day avoid edges (SD-223) would stop every repeat judge call in the model and the
  cache would never be used.
- **SD-262.** The model has one review action for reject and SLA expiry, so the expiry path is the same
  trace as the reject path. The integration test `engine-unsent.integration.test.ts` covers both.

## 4. Defects that are not fixed

| Id | Status | Reason | Model value |
|---|---|---|---|
| SD-060 | skipped | Founder decision. Gating slop matching on the read-back locks out members who onboard only through their AI assistant (no thread read-back; platform decision 10). | `readBackBeforeMatch`, violated (unconfirmedMatchTest) |
| SD-418 | not reproduced | The stop after two read-backs is the designed MAX_ASKS_PER_QUESTION cap. No production code reads `confirmed`, so there is no harmful result. | `readBackHasPath`, violated (readBackCapTest) |
| SD-329 | not reproduced | `endSeat` keeps only booked intros, which are done. Only copy could change, and copy changes are not accepted. | not modeled |
| SD-121 | skipped | Founder decision on posting expiry (close at 90 days with a message, renew on update, or no horizon). | `activeIsLive`, violated (silentExpiryTest) |
| SD-224 | skipped | A missing peon candidate onboarding: new scope, and peon matching runs locally only. | `candidatesWritable`, violated in `prod` |
| SD-226 | skipped | Founder decision: new intake questions or a change to the peon matching rules. | `postedCanMatch`, violated |
| SD-228 | skipped | No interview, offer or hire states exist. It is a missing feature, not a reachable state. | not modeled |
| SD-415 | skipped | A recorded design decision (the need retrieval channel was removed on purpose). It is scoring, an oracle here. | not modeled |
| SD-440 | skipped | Founder decision and new member-facing copy (ask again with the new terms, or end the item). | `inFlightMatchesPosting`, violated by staleYesTest; random simulation does not find it at the default bounds |

## 5. Checks run

`bun run quint:check quint/matching_engine.qnt` (seed 0x5eed, max-steps 40, max-samples 4000; 43 s):

```
ok   quint/matching_engine.qnt typecheck
ok   quint/matching_engine.qnt test
ok   quint/matching_engine.qnt safety
ok   quint/matching_engine.qnt witness_readBackConfirmed (must be reachable)
ok   quint/matching_engine.qnt witness_matchedAfterConfirm (must be reachable)
ok   quint/matching_engine.qnt witness_postingActive (must be reachable)
ok   quint/matching_engine.qnt witness_postingFilled (must be reachable)
ok   quint/matching_engine.qnt witness_flowRevealed (must be reachable)
ok   quint/matching_engine.qnt witness_probeDeclined (must be reachable)
ok   quint/matching_engine.qnt witness_prodEmployerVerified (must be reachable)
ok   quint/matching_engine.qnt witness_postingClosedFilled (must be reachable)
ok   quint/matching_engine.qnt witness_lateAnswerRead (must be reachable)

1 models, 0 failures
```

`quint test`: 32 runs pass.

`bun run quint:check --verify quint/matching_engine.qnt` (Apalache 0.62.4, Java 21, verify-steps 6): every
step above passes and `verify safety` passes (no violation to 6 steps; about 4 minutes on a shared machine).
`quint verify --invariant safety --max-steps 3` takes 19 s. The bound stays at 6, because one more step
makes the run much longer while other agents use the machine.

The values that are not in `safety` were each run alone with the same seed and bounds
(`quint run ... --invariant <name>`): `readBackBeforeMatch`, `readBackHasPath`,
`locatedBeforeMatchStrict`, `noBasicsAfterAnswer`, `activeIsLive`, `postedCanMatch` and
`candidatesWritable` are violated. `inFlightMatchesPosting` is not found by random simulation; the run
`staleYesTest` shows it.

## 6. New observations

- The SD-209 silent fallback (section 3) matches a member with no location at the market anchor cell
  after 7 days of silence. This is the same harm as SD-209, delayed by a week. It is a design choice in
  the fix, not a new register row. It needs a founder decision.
- A member who answers the location question with other content marks the ask as answered without a
  location. The ask then never goes silent, and the member stays held back until a new location ask is
  answered with a location. This is safe (no match) but it can lock the member out. The model shows the
  state (`locAnswered` without a `loc` tag); no invariant covers it. This is read from `rules.ts` and
  `profile.ts` (silentAsks); no test ran it against the code.
