# Quint findings: matching_engine

Model: [quint/matching_engine.qnt](../../../quint/matching_engine.qnt). Module plan: section 6.16 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Code base: ad67275. This file is
hand-written. The check output below is copied from the tools.

## 1. What the model contains

- **slop part.** Three adults (a, b, c; b smokes) and one member aged 15 (k). The onboarding loop
  (`memberSays`, `agentNext`, `sweep`), the persisted app tags, the engine ask for the basics, the daily
  run (engine pick and the Network gate in one action), review, the probe outcome and the booked date.
- **peon part.** One hiring manager with postings A and B, one candidate. Drafts by text (`sms` or
  `mcp`), the manager's yes, the staff postings API, employer verification, the engine run for a seat,
  review, the candidate's and the manager's answers, and `checkSeats` at each tick.
- **probe-flow part.** The `ProbeFlow` library with one or two participants.
- **plan part.** The member-rule chain that `planMemberReason` reads.
- Oracles: the message reader (a message is one "kind"), the score (any eligible pair), the judge.
- The parts share only `now`. A trace steps one part (`focus`). "slopSafety" and "peonSafety" add holds
  and late minor ages. "slop" and "peon" leave them out, so that the deep witnesses stay reachable.
- peon runs on two environments: `prod` (the service as deployed: `jobPostingRoutes` is not
  registered and nothing writes candidate facts) and `harness` (the integration tests call
  `jobPostingRoutes` and seed candidate rows, as `packages/network/test/peon-postings.integration.test.ts`).

## 2. Check output

`bun run quint:check quint/matching_engine.qnt` (seed 0x5eed, max-steps 40, max-samples 4000):

```
ok   quint/matching_engine.qnt typecheck
ok   quint/matching_engine.qnt test            (25 runs)
FAIL quint/matching_engine.qnt safety
ok   quint/matching_engine.qnt witness_readBackConfirmed (must be reachable)
ok   quint/matching_engine.qnt witness_matchedAfterConfirm (must be reachable)
ok   quint/matching_engine.qnt witness_postingActive (must be reachable)
ok   quint/matching_engine.qnt witness_postingFilled (must be reachable)
ok   quint/matching_engine.qnt witness_flowRevealed (must be reachable)
ok   quint/matching_engine.qnt witness_probeDeclined (must be reachable)
1 models, 1 failures
```

`safety` fails as expected: it shows the defects below. Each invariant was also run alone with the same
seed and bounds (`quint run ... --invariant <name>`):

| Invariant | Simulation | Register id |
|---|---|---|
| minorNeverCandidate | holds | - |
| heldNeverCandidate | holds | - |
| readBackBeforeMatch | violated | SD-060 |
| locatedBeforeMatch | violated | SD-209 |
| deletedFieldClearsTag | violated | SD-061 |
| readBackHasPath | violated | SD-418 |
| answersReachLoop | violated | SD-427 |
| askTerminates | violated | SD-419 |
| engineAgreesWithGate | violated | SD-223 |
| unsentNotBilled | violated | SD-262, SD-210 |
| budgetAcrossAssign | violated | SD-207 |
| judgeCacheReused | violated (judge on only) | SD-420 |
| activityFitsSlot | violated | SD-443 |
| closedTerminal | violated (harness only) | SD-114 |
| openingsPreserved | violated (harness only) | SD-114 |
| confirmedInOwnThread | violated | SD-042 |
| filledRecorded | violated | SD-327 |
| acceptedPostingPersists | violated | SD-227 |
| activeIsLive | violated | SD-121 |
| postedCanMatch | violated | SD-226 |
| postedVerifiable | violated (prod) | SD-225 |
| candidatesWritable | violated (prod) | SD-224 |
| inFlightMatchesPosting | not found by simulation; the run `staleYesTest` shows it | SD-440 |
| declineScopedToJob | violated (harness) | SD-439 |
| engineNeverSelectsHeld | found on some seeds; the run `heldSeatTest` shows it | SD-296 |
| seatCapacity | holds | - |
| probeFlowProgresses | violated | SD-063 |
| planSeatHonorsHoldout | violated | SD-206 |

`quint verify` (Apalache, Java 21):

- `--invariant safety --max-steps 6`: counterexample in 5 s, at step 1 (`setPlanFacts` with
  budgetFull and reliabilityHold: SD-206).
- `minorNeverCandidate`, `heldNeverCandidate`: no violation to 5 steps (31 s and 33 s).
  `seatCapacity`: no violation to 6 steps (116 s). At 6 steps, two runs stopped with "Connection
  dropped" from the Apalache server (other agents use the machine).

## 3. Defects the model reproduces

Each trace is the short form of a `run` in the model. All of them are real defects (the model follows
the code). None is a model error.

### SD-060: slop matching does not wait for the read-back (P0)

`run unconfirmedMatchTest`: a and b each state the hard fields (`agentNext`, `core`, `loc`); the
read-back goes out and nobody answers; `slopDailyRun(a,b)` puts the pair in review.

- Tags are written on every read: `network.ts:1048-1060` (`learnAppTags`), and `packInput` sends every
  app tag to the engine (`network.ts:3752`). Nothing reads `SlopOnboarding.confirmed` or `matchable`
  (`extract.ts:865`) on the match path.
- Rule: `extract.ts:77` (matchable = adult, every hard field set, and confirmed); `onboard.ts:1-4`.

### SD-209: a member with no location matches (P1)

`run unlocatedMatchTest`: a and c state only gender, seeks, age range and distance. The run proposes them.
`rules.ts:28-38` asks for a zip only when `zipUnknown`; with no zip tag that is false.
`extract.ts:41` lists `location` as a hard field. Same root as SD-060 (tags persist before the loop
is complete).

### SD-061: a deleted dealbreaker leaves its tag (P0)

`run deletedDealbreakerTest`: `dbAdd` ("no smokers"), then `dbRemove` ("smoking is fine"). The onboarding
state has no dealbreaker; `slop:dealbreaker:smoker` stays. `run staleTagFiltersTest` shows that the
stale tag still filters a from b (a smoker).

- `extract.ts:832` removes it from the list; `extract.ts:939` adds the `slop:dealbreaker:` prefix to
  `replaces` only when the list is not empty or `noDealbreakers` is set; `network.ts:1055-1056` keeps
  every old tag that no prefix replaces.

### SD-418: the read-back cap leaves a stuck state (P2)

`run readBackCapTest`: hard fields, read-back 1, a correction, a goal, read-back 2, a correction. Now
`readBacks = 2`, `confirmed = false`, and `next()` never sends a read-back again
(`service/packs.ts:140`). Simulation also finds a second path: read-back 2 gets no answer, and the
3-day sweep (`network.ts:3285`) clears it.

### SD-427: an answer after the 3-day sweep is lost (P2)

`run sweptAnswerTest`: `agentNext(a)` (a question), `tick(3)`, `tick(1)`, `sweep(a)`, then the answer.
With `awaiting` cleared, the text goes to an open turn; the loop does not read it (`network.ts:3285`,
`network.ts:1115-1130`). The same path drops a "yes" to a read-back, so the confirmation is lost too.

### SD-419: the basics ask repeats for ever (P2)

`run basicsLoopTest`: a answers every hard field, a goal and "no dealbreakers", and confirms. Then
`engineBasicsAsk(a)` fires, and again every 21 days. `needsBasics` (`rules.ts:41-43`) reads tags; "no
dealbreakers" leaves no tag and no politics value. `index.ts:137` has no `capped` check. The loop has
nothing left, so `sendAsks` sends the engine's own text (`network.ts:3497-3499`).

### SD-223: the engine re-proposes a declined pair that the gate drops (P1)

`run reprobeGateTest`: a probe "no" on day 0; `tick(7)`; `slopDailyRun(a,b)` picks the same pair again.
The engine allows a re-probe after 7 days (`options.ts:158`, `rules.ts:92-99`); the gate refuses for
60 days (`network.ts:2041-2044`, `network.ts:3607`). With `perMemberPerTick: 1` the dropped pick takes
the member's one slot. Simulation also reaches it through a review reject: `network.ts:1930` marks
the pair declined for the Network only, and the engine never sees a review reject at all.

### SD-262 and SD-210: unsent proposals still count (P1)

`run rejectedBilledTest`: `slopDailyRun(a,c)`, `slopReview(a,c, reject)`. The engine bills a for a
proposal nobody received: `engineCount(a) = 1`, `sentCount(a) = 0`. `SLOP_ENGINE_CONFIG` sets
`dispatch.billOnlySent` (`index.ts:50`), but `engineInput` never sets `unsentProposalIds`
(`network.ts:3712-3725`; `world.ts:171`).

### SD-207: slop selection ignores budgets (P1)

`run overBudgetTest`: two proposals for a in one week (both rejected in review), then the engine
selects a a third time. `slopMemberRules` has no `interruption_budget` rule and `slopAssign`
(`assign.ts:60-118`) does not read budgets. The Network gate (`network.ts:4199-4203`, `eligible`)
refuses by sent count, so no member gets a third invite in production. The engine still wastes the
pick (same effect as SD-223).

### SD-420: the judge cache does not persist (P2)

Simulation, `judgeOn = true`: the daily run on two days within 7 days judges the same pair twice.
`dailyRun` passes no `judgeCache` (`network.ts:3443`), so `engine.ts:184` builds a new cache per run.
The judge is off unless `NETWORK_ENGINE_JUDGE=1`.

### SD-443: an evening slot for a daytime activity (P2)

Simulation: `slopProbe(p, yes, hike, eve)`. The slot logic does not read the activity, while the copy
says "a daytime hike" (`service/packs.ts:153`).

### SD-042: an MCP profile starts and confirms a job post (P0)

`run mcpPostingTest`: `mgrDraftNew(A, ...)`, `mgrYes(mcp)`. `postingTurn` runs before the `mcp` branch
(`network.ts:755` before `network.ts:758-759`), so the assistant's text is read as the manager's yes.
The register note says a bare "yes" is too short for the MCP tool; a longer text ("yes, post it") is not.

### SD-327: "we filled it" closes as "closed" (P2)

`run filledTest`: `mgrDraftClose(A, filled)`, `mgrYes(sms)`. `postingFromDraft` always writes
`closedReason: "closed"` (`jobs.ts:188`), so `applyPosting` logs "posting closed" (`network.ts:4600`).

### SD-227: a repeated must-have fails the save (P1)

`run dupMustTest`: a draft with the same must-have twice, then yes. The manager is told "Posted", but
`savePosting` inserts two facets with the same id (`jobs.ts:225`, `postings.ts:33-36`) and the unit's
transaction fails. The posting is not stored.

### SD-121: silent expiry after 90 days (P1)

`run silentExpiryTest`: post on day 0, `tick(30)` three times. The intent has `horizonDays: 90`
(`jobs.ts:229`); `world.ts:207` drops it; `peon/profile.ts:188` sets `open = false`. The row stays
`active` and nobody is told.

### SD-226: "Posted" for a job that can never match (P1)

Simulation: `mgrDraftNew(A, n, seniority=false, ...)`, `mgrYes`. `postingProblem` (`jobs.ts:201-209`)
accepts a post with no seniority, and `seniority_band` (`peon/rules.ts:57-59`) then fails for every
candidate. An onsite post with no area fails `locationOk` (`peon/rules.ts:45`) the same way.

### SD-225 and SD-224: no production writer for verification or candidates (P1)

Simulation in `prod`: any posting that becomes active violates `postedVerifiable` and
`candidatesWritable`. `jobPostingRoutes` and `verifyEmployer` have no caller outside
`peon-postings.integration.test.ts` (grep of `packages` and `deploy`), so `peon:verified` is never
written and `employer_unverified` always fires. Nothing in `packages/network`, `packages/mcp` or
`packages/platform` writes `peon:entity` for a candidate. In `prod` no posting can fill; the witness
`witness_postingFilled` is reached only in `harness`.

### SD-114: a closed posting reopens, openings reset to 1 (P1; harness only)

`run staffReopenTest` (harness): post with 2 openings, `staffClose(A, filled)`, `staffSave(A)` with no
openings. The posting is active again with 1 opening. `postings.ts:149` forces `status: "active"`;
`jobs.ts:242` reads the closed openings facet (0) as `Number("0") || 1`. A stale update draft confirmed
after a staff close does the same through `jobs.ts:196`. Both paths need the staff API, which is not
registered in production (SD-225). The text path alone cannot reopen a post (`jobs.ts:168-174` picks
active posts only).

### SD-439: a decline for job A blocks job B (P2; harness only)

`run crossJobTest`: postings A and B, the candidate says no to A; `peonEngineRun(B)` is gated with
`pair_history`. `seatRoute` swaps the seat for the manager, so `markDeclined` keys the pair as
(candidate, manager) (`network.ts:2328`, `network.ts:4468-4480`); the engine keys it by seat and keeps
proposing B.

### SD-440: an edit does not touch items in flight (P2; harness only)

`run staleYesTest`: the candidate says yes to version 1; the manager confirms an update; the item stays
at `candYes` on version 1. `applyPosting` calls `endSeat` only for a closed posting (`network.ts:4600`).
Random simulation did not find this trace at the default bounds.

### SD-296: a held manager's seat stays in the engine input (P2; harness only)

`run heldSeatTest`: `setMgrHold(true)`, `peonEngineRun(A)`. The engine selects the seat (holds list
member ids, `network.ts:3710`; the seat id has none); the gate refuses it (`managerProblem`,
`network.ts:4497-4506`). Nobody is contacted. The engine wastes the pick.

### SD-063: a one-participant probe flow sticks (P0 in the register; library not wired)

`run oneParticipantFlowTest`: `flowStart(1)`, `flowAnswer(x, yes)`. The stage is `probing_partners` and
`toProbe` is empty (`attention.ts:805-808`, `attention.ts:819`). No production code calls
`startProbeFlow` or `recordProbeAnswer` (grep of `packages`), so this is a library defect only.

### SD-206: planMemberReason masks later rules (P1)

`run planHoldoutTest`: a member at the weekly budget and in the reliability hold-out. `memberReason`
returns `interruption_budget` first; `planMemberReason` maps it to null (`plans.ts:146-149`), so the
hold-out (`network/rules.ts:41-46`) is never checked. `planSeatOk` (`network.ts:2888-2891`) does not
check reliability either.

## 4. Register defects of this module that the model does not reach

| Id | Why not |
|---|---|
| SD-228 | No hire, offer or 90-day states exist in production code. It is a missing feature, not a reachable state. |
| SD-260 | Repeat plans and the plans buddy belong to the plan machines (quint/plan_run.qnt). This model has no plans category path. |
| SD-329 | A copy text ("intros not done yet end") against `endSeat`, which keeps booked items. The model shows that booked items stay; the text itself is not a state. |
| SD-415 | The retrieval "need" channel is part of scoring, which is an oracle here. |
| SD-422 | Exploration trimming is inside selection scoring; slop runs with exploration rate 0. Abstracted. |
| SD-435 | The venue table (`geo.ts:45`) is data, not state. |
| SD-441 | Peon history inputs (`acceptedBy`, `declinedBy`) feed scores and the history profile only. Abstracted. |

## 5. Invariants that hold

`minorNeverCandidate` and `heldNeverCandidate` hold in simulation and to 5 steps in Apalache:
`packInput` (`network.ts:3747-3753`) keeps every minor, minor signal and unknown age out of the engine
input, and the gate (`network.ts:4357-4366`) refuses held members. `seatCapacity` holds to 6 steps.

## 6. New defects

None. Every violation maps to a register id. Two traces extend existing rows:

- SD-223 also happens after a review reject: `network.ts:1930` marks the pair declined for 60 days, but
  a review reject is not an interaction, so the engine proposes the pair again on the next day.
- SD-418 also happens when the second read-back gets no answer and the 3-day sweep clears it.
