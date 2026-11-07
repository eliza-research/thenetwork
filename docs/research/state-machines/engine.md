# State machines: packages/engine

Scope key: `engine`. Scope: `packages/engine` (16,410 lines): pipeline order, hard filters, retrieval, generators, scoring, judges, group composer, global selection, budgets, attention, fairness, exposure, the four packs, the slop onboarding loop, the relay classifier and `relayItem`.

Paths without a prefix are in `packages/engine/src/`. Date of the read: 2026-11-07. Branch: `claude/quint-state-machines`, base commit a0ed7bc.

## 0. How to read this file

The engine is mostly pure functions. It holds almost no state between calls. So most machines here are one of three shapes:

1. **Stage order inside one call** (`runEngine`). State is local to the call. There is no crash window, because nothing is emitted until the call returns (ME-010).
2. **Reducer over a value that the caller stores** (`recordPlanAnswer`, `relayItem`, `extractSlopProfile`). The engine owns the transition function. `packages/network` owns the stored value, the transaction and the crash window.
3. **Derived state from a snapshot** (cooldowns, budgets, review holds, asks). No row holds the state. The World rebuilds it on each run from history rows and the clock.

**The package has no tests.** They were deleted on 2026-10-08 (README line 123). `bun run sim` checks the engine through `scripts/sim/conformance.ts` and the pack worlds. Intended behaviour below comes from comments, README tables and those sims.

### Wiring status matters

Several explicit machines in `attention.ts` have **no production caller**. A grep over `packages`, `scripts` and `tests` outside `packages/engine` gave these results:

| Function or machine | Caller outside the engine | Status |
|---|---|---|
| `recordPlanAnswer`, `startPlanRun`, `checkPlanDeadline`, `planFallback` | `packages/network/src/network.ts` | **WIRED** |
| `detectCrews`, `crewOptIn`, `crewSessionPlan` | `network.ts`, sim friends | **WIRED** |
| `relayItem`, `relayItemAsync`, `parseRelayRequest`, `relayItemFromRequest` | `packages/network/src/relay.ts`, `service/relay-endpoint.ts` | **WIRED** |
| `extractSlopProfile`, `applyCorrection`, `readBack`, `nextQuestion`, `markAsked`, `slopOnboardTags` | `packages/network/service/packs.ts` | **WIRED** |
| `extractSlopProfileLLM` | `scripts/sim/onboard.ts`, `scripts/sim/slop-live.ts` only | SIM ONLY |
| `composeMessage` | `network.ts` plan allowance path only | **WIRED, one path** |
| `inSendWindow`, `nextDigestSlot`, `memberQuietEnd`, `inMemberQuietHours`, `canInterrupt`, `canSendLogistics`, `learnSendProfile`, `chooseTimeOptions`, `candidateSlots`, `withPausePath` | `network.ts` and others | **WIRED** |
| `startProbeFlow`, `startProbeFlowFor`, `recordProbeAnswer`, `canReveal`, `revealFor` | `scripts/sim/conformance.ts`, `scripts/sim/slop.ts` only | **LIBRARY** |
| `addToHold`, `revalidateHold` | none | **LIBRARY** |
| `reengagement` (the attention function) | none. `network.ts` has its own. | **LIBRARY** |
| `itemsForProposal`, `partnerItem`, `digestDue`, `capFor`, `breakInLimit`, `unansweredInterruptions`, `digestText`, `applyLearnedCadence`, `warmMention` | none | **LIBRARY** (some used inside `composeMessage`) |
| `eligibilityFor`, `sendTimeReason` | none | **LIBRARY** |
| `partnerPlanFor` | none outside `plans.ts`; its result is dropped by `network.ts` | **DEAD IN PRODUCTION** |

The production consent flow is the `Opp` machine in `packages/network/src/network.ts`. It is in the `network-service-*` research files, not here. A Quint model of `ProbeFlow` proves nothing about production until something calls it. Decide first: wire it or delete it.

## 1. Inventory

| # | id | kind | wiring | priority | Quint |
|---|---|---|---|---|---|
| 1 | engine-pipeline | explicit stage order | wired | P0 | alone, small |
| 2 | candidate-lifecycle | implicit (`eligible`, `reason`) | wired | P0 | merge with 1 |
| 3 | hard-filter-chain | implicit (first failing rule) | wired | P0 | alone |
| 4 | minors-age-gate | implicit, multi-layer | wired | P0 | alone; merge with onboarding age ratchet |
| 5 | global-selection | explicit passes | wired | P1 | alone |
| 6 | member-budgets-and-cooldowns | implicit, rolling windows | wired | P1 | merge with 5 |
| 7 | judge-passes-and-cache | implicit, TTL cache | wired | P1 | small |
| 8 | exposure-debt | implicit, carried value | wired | P2 | no model needed |
| 9 | plan-run | explicit (`PlanRun.stage`, `PlanAnswer`) | wired | P0 | merge with network Opp |
| 10 | plan-fallback | explicit (`Fallback`) | wired, partly dropped | P0 | merge with 9 |
| 11 | crew-lifecycle | implicit | wired | P1 | small |
| 12 | relay-item | explicit (`RelayDecision`) | wired | P0 | merge with network relay desk |
| 13 | relay-classifier-hook | implicit | wired | P1 | merge with 12 |
| 14 | slop-onboarding | explicit fields, booleans, counters | wired | P0 | alone |
| 15 | slop-ask-loop | implicit, derived from `recentAsks` | wired | P1 | merge with 14 |
| 16 | slop-review-hold | implicit tag latch | partly wired | P0 | small |
| 17 | slop-assignment | explicit rounds, stable-roommates phases | wired (greedy) | P1 | alone, greedy only |
| 18 | probe-flow | explicit (`ProbeFlow.stage`) | library | P0 if wired | alone |
| 19 | attention-compose | explicit gate order | wired one path | P1 | alone |
| 20 | attention-ledger-annoyance | implicit | partly wired | P1 | merge with 19 |
| 21 | hold-queue | explicit (`HoldReason`, `HoldResult`) | library | P2 | skip until wired |
| 22 | digest-slot-cursor | implicit | library | P2 | skip until wired |
| 23 | reengagement-d6 | implicit | library | P2 | skip until wired |
| 24 | peon-seat-capacity | implicit | wired | P1 | small |
| 25 | peon-application | declared stages | declared only | P2 | model in network |
| 26 | friends-weekly-planner | explicit pass order | wired, local only | P2 | no |
| 27 | photo-rating | implicit gate | wired | P0 for age gate | small |

## 2. engine-pipeline (explicit stage order)

**Where.** `engine.ts:74-299`. State is local to `runEngine`. Output: `{proposals, asks, runLog}`.

**States.** `index` -> `member_funnel` -> `generate` -> `filter` -> `score_dedupe` -> `judge_screen?` -> `judge_rubric?` -> `judge_deep?` -> `count_funnel` -> `plan_asks` -> `select` -> `final_minor_guard` -> `build_proposals` -> `logs` -> `done`.

| From | Trigger | Guard | Effect | To | Evidence |
|---|---|---|---|---|---|
| start | caller (cron `dailyRun`, sim, observatory shadow) | none | canonical input order, resolved config, World built, throws on duplicate member id | index | engine.ts:78-84, world.ts:96-100 |
| index | automatic | none | one `memberReason` per member into `memberFunnel` | member_funnel | engine.ts:101-106 |
| member_funnel | automatic | generator not switched off in `cfg.generators` | candidates appended in pack order | generate | engine.ts:113-121 |
| generate | automatic | none | `candidateReason` on each candidate; also market check; mutates `c.city`, `c.window` | filter | engine.ts:126-141, filters.ts:208-215 |
| filter | automatic | none | score; dedupe by sorted participant set, keep best | score_dedupe | engine.ts:146-154 |
| score_dedupe | automatic | `llm && judge.enabled && topK>0 && pack.judge` | judge passes | judge_* | engine.ts:164 |
| judge_* or score_dedupe | automatic | none | funnel counts | count_funnel | engine.ts:224-229 |
| count_funnel | automatic | none | `planAsks`, then `selectProposals` | select | engine.ts:234-237 |
| select | automatic | none | drop anything `involvesMinor` | final_minor_guard | engine.ts:240-241 |
| final_minor_guard | automatic | none | proposals with `explain` text and TTL | build_proposals | engine.ts:254-270 |
| build_proposals | automatic | none | run log, fairness, blocking pairs, exposure debt, empty states | done | engine.ts:274-295 |

**Ordering facts that matter.**

- Order of generators is a contract. `network_growth` reads `ctx.unmatchedIntents`, written by earlier generators (network/generators.ts:534, 628).
- `slopPack` extra asks read `runDegree`, a WeakMap written by the slop generator (slop/generators.ts:83, slop/index.ts:134). So `planAsks` must run after generators. It does.
- `candidateReason` writes `c.city` and `c.window`. Scoring reads them. So filter must run before score. It does. `candidateReason` also may set `c.safetyClass = "medium"` (network/rules.ts:112). So a rule has a side effect on the candidate.

**Invariants.**

- I1 (AGENTS "Nothing is emitted unless the whole run completes", ME-010): an exception in any stage yields no proposals. True: there is no `yield` and no store write.
- I2: hard filters run before scoring and before every judge pass (pack.ts:17). True by order.
- I3: pass 1, 2, 3 can only remove (engine.ts:185-192, 215-217). True.
- I4: minors appear in no output (pack.ts:12-15). Final guard at engine.ts:240.
- I5 determinism: no `Date.now`, no `Math.random`. `performance.now` is used only for timings (engine.ts:75). World uses `input.now`.

**Concurrency and failure.** One call has no shared state, except `deps.judgeCache` and the module-level WeakMaps keyed by World or input. Two concurrent runs on one input share nothing harmful. The real concurrency boundary is the tick lock in `packages/network`. The snapshot goes stale between the run and the send. `gateReason` and `checkRecipient` in `network.ts` recheck.

**Quint notes.** Model as a single `step` action over an enum. Only worthwhile with machine 2. Bound: 1 candidate. Invariant: `emitted implies stage = done`.

## 3. candidate-lifecycle (implicit)

**Where.** Fields `Scored.eligible`, `Scored.reason`, `Scored.verdict`, `Scored.memberWhy` (scoring.ts:11-18). Candidate kept in `scored`, then `Selected` (policy.ts:17).

**States.** `generated`, `rejected:<filter>`, `no_market`, `deduped_out`, `eligible`, `below_threshold`, `floor:<fit|mutual_benefit|confidence|social_risk|judge_floor>`, `dealbreaker`, `judge_reject`, `screen_reject`, `deep_reject`, `deep_insufficient`, `hard_gate:<reason>`, then `selected_floor`, `selected_explore`, `selected_greedy`, `budget_skip`, `trimmed_exploration`, `withheld_minor`, `proposed`.

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| generated | filter | `candidateReason` returns r | rejected:r | engine.ts:129-137 |
| generated | filter | city not in markets | no_market | engine.ts:139 |
| generated | score | floor violation | floor:x | scoring.ts:186-196, 207-208 |
| generated | score | `score < thr` | below_threshold | scoring.ts:208 |
| generated | score | otherwise | eligible | scoring.ts:207 |
| eligible, below_threshold | dedupe | a sibling with same participant set scores higher | deduped_out | engine.ts:147-154 |
| eligible, below_threshold | screen | verdict no or dealbreaker | screen_reject | engine.ts:177-178 |
| eligible, below_threshold | screen | call failed (null) | unchanged, goes to pass 2 | engine.ts:180 |
| eligible | rubric | verdict gives floor, dealbreaker or `no` | that reason | engine.ts:187-192 |
| below_threshold | rubric | verdict lifts score | stays below_threshold (ratchet) | engine.ts:191 |
| eligible with verdict | deep | gate fires | hard_gate:r | engine.ts:206, 215 |
| eligible with verdict | deep | verdict no | deep_reject | engine.ts:216 |
| eligible with verdict | deep | insufficient | deep_insufficient | engine.ts:217 |
| eligible | select | chosen in floor pass | selected_floor | policy.ts:153-161 |
| eligible, below_threshold with `reason` in allow-list and no `no` verdict | select | exploration draw | selected_explore | policy.ts:169-183 |
| eligible | select | greedy | selected_greedy | policy.ts:186-196 |
| eligible | select | never picked | budget_skip | policy.ts:197 |
| selected_explore | trim | over `maxE` | trimmed_exploration | policy.ts:74-77 |
| selected | guard | touches a minor | withheld_minor | engine.ts:240 |
| selected | build | none | proposed | engine.ts:254 |

**Safety property.** A proposal with `reason` in `{dealbreaker, judge_reject, screen_reject, deep_reject, deep_insufficient, hard_gate:*, floor:*}` is never selected. True: greedy uses `x.eligible`, exploration uses an allow-list (policy.ts:169).

**Known non-property.** A candidate outside `topK` is never judged and can still be selected. A top candidate that the judge rejected is dropped, and a lower unjudged one is sent. This is logged as `judge.coverage` (engine.ts:246-250, audit engine-pipeline-8). Screen has the same shape: `pool.filter(res.has)` removes unscreened ones from pass 2, but they stay eligible.

**Quint.** Variables `reason`, `eligible`, `verdict`. Actions `screen`, `rubric`, `deep`, `select`. Invariant `selected => allowed(reason)`. Bounds: 1 candidate, 3 passes, verdict in {none, yes, no, fail}.

## 4. hard-filter-chain (implicit)

**Where.** `filters.ts:50-65` (`memberReason`), `:68-83` (`pairReason`), `:164-217` (`candidateReason`), `:229-244` (`sendTimeReason`). Pack rules: `packs/*/rules.ts`.

**Shape.** First failing rule wins. The result is a single reason string. So a later rule is not evaluated when an earlier rule fails. This is correct for "remove", but it is wrong when a caller **forgives** one reason. See D6 and D10.

**Member chain (network).** unknown_member -> underage -> safety_hold -> state_paused -> state_receiving_contributor -> category_opt_out -> romance_opt_out -> only_when_asked -> interruption_budget -> contribution_budget -> category_quota -> category_cooldown -> reliability_holdout (network/rules.ts:12-47).

**Member chain (slop).** Core prefix, then lane -> romance_opt_out -> review_hold -> needs_answer -> basics_pending -> your_turn -> recently_matched (slop/rules.ts:65-84). No budget rule.

**Member chain (peon).** Core prefix, then peon_not_onboarded -> job_closed -> employer_unverified -> no_pay_range -> employer_scam_signal -> not_searching -> identity_signal -> interruption_budget -> active_intro_cap (peon/rules.ts:14-32).

**Member chain (friends).** Core prefix, then romance_excluded -> category_opt_out -> unverified -> safety_review -> only_when_asked -> reliability_holdout -> group_first (friends/rules.ts:44-52). No budget rule.

**Pair chain.** duplicate_participant -> underage -> blocked -> unknown_member -> pack rules -> geo pair reason (filters.ts:68-83).

**Candidate chain.** duplicate -> pack pre rules -> minors in any role -> `via` checks -> member checks -> pair checks -> pack post rules -> presence overlap (filters.ts:164-217).

**Invariants.**

- Blocks win (pack.ts:16). `pairReason` runs `blocked` before pack rules. `World` removes blocked pairs from the warm graph (world.ts:123-126).
- Pack rules run after the core prefix and can only remove (pack.ts:9-11).
- `sendTimeReason` is documented as "these always win at send time" (filters.ts:219-228). Its order puts `underage` first. See D10.

**Quint.** Model the chain as an ordered list of predicates over abstract booleans. Check `forgiven(reason) => no later predicate is true`. That one invariant finds D6 and D10.

## 5. minors-age-gate (implicit, multi-layer)

**Where.** `world.ts:102` (`World.minors`), `filters.ts:32-47, 56, 70, 173, 233`, `group.ts:82-83`, `engine.ts:240`, `attention.ts:66, 113, 124, 212, 269-279, 428, 436-439, 922`, `plans.ts:262, 351, 489`, `policy.ts:57, 275`, `relay.ts:308, 367`, `packs/slop/plan.ts:84`, `packs/slop/appearance.ts:44`, `packs/slop/extract.ts:812-814, 848-849`.

**States of a person, as the engine sees them.** `unknown_age`, `under_13`, `minor_13_17`, `adult`. Unknown and invalid fail closed (`canBeMatched`, filters.ts:32).

| Transition | Trigger | Effect | Evidence |
|---|---|---|---|
| any -> lower age | member message | lowest age wins, `p.age` never rises | extract.ts:812 |
| any -> minor flag | first-person sign, no number | `p.minor = true`, sticky | extract.ts:813, 180-189 |
| any -> declined | strict stated age under 13 | fields cleared | extract.ts:814, 849 |
| relay text says age | rule | `minor:signal` blocks, `record.ageSignal=true` | relay.ts:367, 395 |

**Safety properties (AGENTS code invariants; pack.ts core 1).**

- S1: no minor in `participants`, `alternates` or `via` of any proposal or plan.
- S2: `minorContacts = 0`.
- S3: the age ratchet: `age' <= age` over messages in one profile.
- S4: `matchable => canBeMatched(age)`.

All hold in engine code on the wired paths. Leaks to check are in the sticky direction (D12, D14, D15).

**Interactions.** `network.ts:3710` puts minors into `safetyHolds`. `packInput` removes them before the engine sees them (network.ts:3742-3770). `ntwrk` does not remove them; World and filters do.

**Quint.** Variables `statedAges: Set[int]`, `minorFlag`, `declined`. Invariant: `effectiveAge = min(statedAges)`. Bound ages to {12, 15, 17, 18, 30, none}. Merge with machine 14.

## 6. global-selection (explicit passes)

**Where.** `policy.ts:65-200`. Per-run maps: `proactive`, `contribution`, `timesSelected`, `usedPairs`, `fixedSlots`, `perCity`, `taken`.

**Passes.** dry run (no exploration, sizes the slice) -> floor -> exploration -> greedy -> trim exploration -> rerank (policy.ts:71-78). A pack `assign` replaces all of this (policy.ts:67-68).

| Pass | Guard | Effect | Evidence |
|---|---|---|---|
| floor | `lowExposure && (newcomer||lowData||exposure30==0)`, under `floorCap`, `canTake`, adjusted value over bar when a hook exists | `take(best,false,1)` | policy.ts:149-161 |
| exploration | `slots` from dry run; alternates expansion and general; seeded draw | `take(x,true,p)` | policy.ts:164-183 |
| greedy | adjusted value over threshold and `canTake` | `take(best,false,1)` | policy.ts:186-196 |
| trim | exploration count over `maxShare * total` | remove | policy.ts:74-77 |

**`canTake` guards.** Not taken; city cap; proactive budget; `inOpenOpportunity`; `exclude`; contribution budget; fixed-time overlap; no pair reused (policy.ts:93-113).

**Invariants.** ME-002: per member, recent + extra + in-run <= limit. No pair twice in one run. Fixed windows do not overlap for one member. `exploration share <= maxShare`.

**Concurrency.** None. Pure. `rng.fork` depends on label and parent state only (core rng.ts:117), so dry and real runs see the same streams for the same label if the parent is unchanged.

**Quint.** Finite members (3), candidates (4). Abstract score to an order. Check budget and pair invariants under all orders. Do not model exploration weights; model it as a nondeterministic pick.

## 7. member-budgets-and-cooldowns (implicit, rolling windows)

**Where.** World build: `world.ts:142-181, 222-251`. Rules: `network/rules.ts:17-46, 58-73`.

| Derived state | Source | Window | Clears when | Evidence |
|---|---|---|---|---|
| `recentProactive` | `recentProposals` | state period | age passes period | world.ts:233-235 |
| `recentContribution` | proposals plus interaction contributors | contribution period | age passes period | world.ts:236-238, 248-251 |
| `categoryCount30` | proposals with category | 30 days | age | world.ts:239-244 |
| `activePairs` | pending or accepted interaction; recent unresolved proposal | 28 days; 7 days | resolved, or age | world.ts:157, 179 |
| `recentPairs` | proposals | 30 days in repetition | age | world.ts:178, scoring.ts:137 |
| `negativeFeedback` | negative or would-not-meet | 90 days | age; ignores `processed` | world.ts:135-140, rules.ts:60-63 |
| `pair_cooldown` | declined, expired, cancelled | 30 days | age | rules.ts:66-71 |
| `memberCategoryDeclines` | declined or expired | 7 days | age | world.ts:159-166, rules.ts:36-39 |
| `holds` | `safetyHolds` active at now | from..to | `to` passes | world.ts:129-131 |
| `inOpenOpportunity` | `openOpportunities` with `until` unset or future | until | closes | world.ts:143-146 |
| `reliability_holdout` | noShows>=2 and completedSince==0 | no time limit | a completed meetup | rules.ts:42-45 |

**Exit paths.** All time-based except reliability, which needs a completed meetup. A member in hold-out can still attend a one-to-one, so the exit exists (`c.format !== "one_to_one" || timeSensitive`).

**Inputs the engine expects and the service does not send.** See D21.

**Clock skew.** `age < 0` skips a future-dated proposal (world.ts:228). `pair_cooldown` with future `r.at`: `w.now - r.at` is negative, so `< 30d` is true. The cooldown lasts longer. Safe direction.

**Quint.** Use a discrete day clock and a list of events. Check that cooldowns expire (liveness under fairness) and that `processed` has no effect.

## 8. judge-passes-and-cache (implicit, TTL)

**Where.** `judgeCommon.ts:34-96`, `judge.ts`, `judgeScreen.ts`, `judgeDeep.ts`, `engine.ts:163-223`.

**Cache states per key.** `absent`, `fresh`, `expired`, and implicit `failed` (not cached).

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| absent | call ok | none | fresh | judgeCommon.ts:80-83 |
| absent | call throws | none | absent, `null` in result map | :84-87 |
| fresh | get | `now-at >= ttl` or `now < at` | expired -> absent | :40 |
| fresh | get | else | fresh, hit | :41 |

Key: prompt version, kind, category, anchor, each participant's revision, `via` revision, city and fixed window, `pass2Context` (:54-60). A profile change changes the revision, so the key moves.

**Invariants.** ME-008: failures never cached; no permanent zero. Reasoning precedes verdict is recorded, not enforced (`reasoningFirst`).

**Bounded concurrency.** Workers pop a shared queue (`queue.shift`) on one event loop, so no race. Result maps are written per key.

**Failure.** `chatJson` has 2 attempts. A failed pass fails open to the prior stage (`pipelineDecision`, judge.ts:121-135). That is intended.

**Quint.** Not needed for safety. If modelled, small: key, clock, TTL. D20 is the only finding.

## 9. exposure-debt (implicit, carried value)

**Where.** `policy.ts:268-282`, read `engine.ts:232-233`, returned `runLog.exposureDebt`, stored by `network.ts:3446` in memory state.

Each run: `debt' = clamp(0, 2*cap, debt + rel - got)`. Zero is dropped from the map. Minors have no row.

Only the last run's value carries. A failed run keeps the old value (line 3446 runs after `runEngine` returns). Non-negative and bounded. No Quint model needed.

## 10. plan-run (explicit)

**Where.** `plans.ts:522-597`. Value stored in `Opp.planRun` in `packages/network/src/network.ts`.

**States.** Stage: `probing`, `booked`, `closed`. Answer per member: `pending`, `yes`, `no`, `late`. Implied: `not_yet_probed` (id on `bench`, no key in `answers`).

| From | Event | Actor | Guard | Effect | To | Evidence |
|---|---|---|---|---|---|---|
| (none) | `startPlanRun` | network `beginPlan`, after review | none | answers for `first`; bench is partner plus alternates, filtered by `canMatch` | probing | plans.ts:544-549; network.ts:2944 |
| any | answer | member | stage closed, or answer not pending | none | same | plans.ts:568 |
| probing | yes | member | `yesOf >= quorum` | action book | booked | :578 |
| probing | yes | member | partner plan, before deadline, bench has someone | that one pending, action `probe_partner` | probing | :579 |
| probing | yes | member | otherwise | none | probing | :580 |
| probing | no | member | partner plan and member is first | action fallback | closed | :584 |
| probing | no | member | before deadline, bench has someone | next pending, action backfill | probing | :585-588 |
| probing | no | member | nobody pending, yes below quorum | action fallback | closed | :589 |
| probing | no | member | else | none | probing | :590 |
| booked | yes | member | before `start - lateJoinHours` | action join | booked | :572-573 |
| booked | yes | member | too late | answer `late` | booked | :574-575 |
| booked | no | member | none | none | booked | :582 |
| probing | deadline | tick | `now >= probeDeadline` | action fallback | closed | :594-597; network.ts:3366 |

**Invariants.**

- P1 (D5): nobody is named before quorum. `book` needs `yes >= quorum`.
- P2: terminal stages hold, except booked accepts `join`.
- P3 (engine-attention-plans-10): two yes-sayers of a group plan are never booked directly. **Broken in production.** See D1.
- P4: a member on `bench` is probed only after `canMatch` passes. `startPlanRun` filters the bench only. `first` is not filtered (:546-547). The planner already excluded minors at plan time. `network.ts` calls `startPlanRun(o.plan)` with no `canMatch`, so `canMatch` is never used in production (network.ts:2944, 3011). `planProbe` checks `planSeatOk` first, so the guard exists there.
- P5 liveness: every probing run reaches booked or closed. True if the tick fires, because `checkPlanDeadline` closes it.

**Concurrency and failure.** `recordPlanAnswer` copies; it does not mutate. The caller does `if (run === o.planRun) return` (network.ts:3012). Duplicate answers are safe because a non-pending answer returns the same object. Out-of-order: a `yes` after the deadline but before the tick still books (D24). Crash: `planRun` is in the `Opp` blob. See the network files.

**Quint.** Variables `stage`, `answers: id -> answer`, `bench`, `now` (coarse: before deadline, after deadline, after start). Actions `answer(id,bool)`, `deadlineTick`. Bounds: 4 invited, 2 alternates, quorum 3. Invariants P1, P2, and "backfilled member is reachable by probe" (this one finds D2).

## 11. plan-fallback (explicit)

**Where.** `plans.ts:599-654`. Network side: `network.ts:3109-3127`.

**States.** `Fallback.kind`: `smaller` (with or without `partnerPlan`), `solo_event`, `next_week`, `none`.

| Guard | Result | carry | Evidence |
|---|---|---|---|
| no yes-sayers | none | [] | plans.ts:644 |
| yes>=2, activity allows 2, `start-now > lateJoinHours`, exactly 2 | smaller, partnerPlan | **[]** | :645-646 |
| same, 3 or more | smaller | **[]** | :647 |
| soloEvent and an event matches | solo_event | carry | :649-652 |
| nextWeek | next_week | carry | :653 |
| else | none | carry | :653 |

**Network behaviour.** `if (fallback.kind === "smaller") return this.bookPlan(o, fallback.members, true);` (network.ts:3118). `partnerPlan` is read by nobody. `bookPlan` accepts `keep.length >= 2 && a.groupSize[0] <= 2` (network.ts:3060). See D1.

**Quint.** Merge with machine 10. Add invariant: `booked and |going| = 2 and not plan.partner => false`.

## 12. crew-lifecycle (implicit)

**Where.** `plans.ts:659-740`. Network: `CrewOffer` (network.ts:93), `crews`. Friends: `planner.ts:243-280`.

**States.** `none`, `offered` (`CrewOffer`), `formed` (`Crew`), `session_k`, `handed_off` (`crew.handedOff`), `no_crew` (under `minMembers` opt-ins).

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| none | plan completes | `>= minMembers` positive; not already in a crew for that activity | offered | plans.ts:675-703; network.ts:3177 |
| offered | all answers in | `crewOptIn` yes >= minMembers | formed | plans.ts:709-714; network.ts:3204 |
| offered | all answers in | under minMembers | no_crew | plans.ts:711 |
| formed | tick | `!handedOff`, enough eligible members | session_k | plans.ts:717-740; network.ts:3226-3236 |
| session_k | count reaches `handOffAfterSessions` | none | handed_off | network.ts:3235 |

**Note.** `handedOff` is set only in `network.ts` and sim code. Engine reads it (plans.ts:719; friends/planner.ts:245).

`detectCrews` keeps `inCrew` so a member is in at most one crew per activity. Existing crews and offers are passed in, so a repeated outcome does not re-offer (plans.ts:677).

**Safety gap.** Sessions recheck member eligibility, not pair blocks. See D26.

**Quint.** Small enum and a counter. Liveness: every formed crew reaches handed_off if sessions keep running.

## 13. relay-item (explicit)

**Where.** `relay.ts:300-445`. Stored by `packages/network/src/relay.ts` (`RelayRecord`, `RelayHeld`).

**States of one item.** Input kind: `text`, `contact_share`, `photo`. Decision: `pass`, `hold`, `block`. Staff follow-up (network): `held` -> `released` or `rejected`.

**Decision rule.** `block` if any reason's family is in the block list; else `hold` if any reason; else `pass` (relay.ts:384). All checks run. Most severe wins.

| Check | Reason | Family | Evidence |
|---|---|---|---|
| not participants, self | party:not_participant | block | :307 |
| minor or unknown age | minor:party | block | :308 |
| block edge | party:blocked | block | :309 |
| opted out | optout:* | block | :310-311 |
| safety hold | safety:*_held | hold | :312-313 |
| status not mutual | state:<status> | block | :315 |
| mutual without both yes | state:not_mutual | block | :316 |
| consent absent, wrong, stale | consent:* | block | :319-325 |
| bad contact, free text | contact_share:* | block | :334-335 |
| photo count, ref, no consent, not owned | photo:* | block | :340-344 |
| empty text, unknown kind | format:* | block | :346-347 |
| over length | text:too_long | hold, and skips all text checks | :351 |
| leaks | canary block, leak hold, contact hold | :354-360 |
| rules | scam, offplatform, fishing, injection, rating, harass hold; harass_severe block | :361-366 |
| minor self-disclosure | minor:signal, block, `ageSignal` | :367 |
| extra rules (appearance) | pack code | hold | :368 |
| burst, daily, photos daily | rate:* | hold | :373-376 |
| second contact share | contact_share:already_shared | block | :377 |

**Invariants.**

- R1: `rendered` is `""` unless decision is pass (:386-391).
- R2: hook only adds reasons (:439-444). It never lowers the decision.
- R3: an item with `decision != pass` carries no photos (:401).
- R4 (founder 9): a contact share needs consent for this item, by this sender, fresh within 15 minutes.
- R5: `RelayRecord` has no body and no contact value.
- R6: one contact share per sender per opportunity (`history` with `contactShared`).

**Idempotency.** `mine` drops rows with the same `itemId` (:373). So a replay of one item passes the rate checks and the one-share check. Verified by test script: same id gives `pass` twice. This is intended as idempotency for release, but it means R6 depends on the caller's replay check (`network/src/relay.ts:321`). The Quint model must include that check.

**Concurrency.** `relayItem` is pure. `history` is read before the write. Two concurrent contact shares with different item ids can both pass. That is a network-layer TOCTOU; see the service file.

**Clock.** `item.at` and `ctx.now` come from the caller. `c.at > item.at` is stale. The burst and daily windows ignore a future row (`>= 0`), but the photo count does not (:376).

**Quint.** Reasons as a set of booleans (`partyOk`, `mutual`, `consentFresh`, `leak`, `scam`, `hook`). One action per item. Invariant: `delivered => all block and hold booleans are false`. Merge with `network/src/relay.ts` for held, release, replay.

## 14. relay-classifier-hook (implicit)

**Where.** `relay.ts:430-445`, `relayClef.ts:262-301`. Wiring: `service/relay-endpoint.ts:83-97`.

**States of one classification.** `cache_hit`, `live_ok`, `timeout`, `error`, `miss`, then `flags`, `block`, `uncertain`, `unavailable`, `none`.

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| start | answers hit | none | cache_hit | relayClef.ts:279 |
| start | no answer | not live | miss -> fallback | :281 |
| start | live call | ok in 2.5 s | live_ok | :287 |
| start | live call | timeout or error | fallback | :288-291 |
| fallback | cue present | `holdOnUnavailable` | flag `unavailable` (hold) | :272-276 |
| fallback | no cue | none | no flags (rules decide) | :272-276 |
| ok | decide | p >= hold, severe feature | block | :176 |
| ok | decide | p >= hold | hold | :177 |
| ok | decide | low confidence, high-risk p >= floor | `uncertain` hold | :179 |

**Fail-closed path.** Without a Workers AI token, production uses a hook that always throws (relay-endpoint.ts:85-88). `relayItemAsync` turns that into `llm:error` hold (relay.ts:437). Good.

**Invariant.** Clef never passes an item the rules hold. True: the hook is skipped on a block, and on a hold unless `escalateHeld`.

**Defect.** Clef's `minor_signal` category does not set `ageSignal` (D12).

## 15. slop-onboarding (explicit)

**Where.** `SlopOnboarding` (extract.ts:47-81), reducers `mergeReading`, `finalize` (extract.ts:808-867), `applyCorrection`, `nextQuestion`, `markAsked` (onboard.ts). Stored in `MemberState.onboarding`. Loop: `service/packs.ts:120-149`, `network.ts:1047-1078`.

**State variables.** Fields (`age`, `gender`, `seeks`, `ageRange`, `distance`, `location`, soft fields), booleans `minor`, `declined`, `confirmed`, `matchable`, map `askCounts`, counter `turns`.

**Named states.**

- `collecting`: hard field missing.
- `awaiting_readback`: hard complete, not confirmed, read-backs left.
- `confirmed`: `confirmed && canBeMatched(age)`, so `matchable`.
- `confirmed_no_age`: confirmed, no age.
- `unconfirmed_exhausted`: hard complete, not confirmed, read-back cap spent. **No exit by prompt.**
- `stalled`: hard missing, all asks at cap. Exit only if the member writes in.
- `minor` (sticky), `declined` (sticky, terminal).

| From | Event | Guard | Effect | To | Evidence |
|---|---|---|---|---|---|
| any | message | not declined | merge; `turns++`; lowest age; hard change resets `confirmed` | collecting or awaiting_readback | extract.ts:808-841, 864 |
| any | stated under 18 | none | `minor=true` | minor | extract.ts:848 |
| any | strict stated under 13 | none | cleared | declined | extract.ts:814, 849 |
| awaiting_readback | reply changes a viewed field | none | `confirmed=false` | awaiting_readback | onboard.ts:92 |
| awaiting_readback | reply yes, no change | not minor, not declined | `confirmed=true` | confirmed | onboard.ts:93-94 |
| awaiting_readback | reply no, no change | none | `confirmed=false` | awaiting_readback | onboard.ts:94 |
| collecting | question sent | under cap | `askCounts[r]++` | collecting | onboard.ts:146-148 |
| collecting | seeks asked twice, woman or man, no blocking orientation | next `finalize` | default straight seeks, conf 0.6 | collecting | extract.ts:861-863 |
| any | `read` when minor or declined | service | tags none; `replaces` romance and slop prefixes | same | packs.ts:133 |

**Service loop guard.** Read-back only when `hardComplete && !confirmed && !skip && askCounts[readback] < 2` (packs.ts:140). Else `nextQuestion`.

**Invariants.**

- O1: `matchable => adult && hard complete && confirmed` (extract.ts:865). True as a value.
- O2 (AGENTS, Clef ratings note): the read-back is the confirmation gate. **Nothing reads `matchable` or `confirmed` in production.** See D4.
- O3: age lowers only. True.
- O4: `declined` keeps only `turns`, `age`, `askCounts`. True in `finalize`.
- O5: tags reflect the profile. **False after a deletion.** See D5.
- O6: LLM never raises an age or declines. True, and see D14.

**Concurrency.** `onboarding` is plain JSON on the member. Read and write run inside the inbound turn. Two concurrent turns for one member are a network-layer concern (lost update on `askCounts`, `confirmed`).

**Quint.** Fields as `{unset, low, high}`; age as `{none, 12, 15, 30}`; `askCounts` bounded at 2. Actions `say(field)`, `sayNo`, `sayYes`, `correct(field)`, `deleteField(field)`, `askQuestion`. Invariants O1, O3, O5, and `tagsView = profileView`. Liveness: from `collecting`, under fair member replies, reach `confirmed`. This finds `unconfirmed_exhausted`.

## 16. slop-ask-loop (implicit)

**Where.** `slop/index.ts:121-139`, `slop/rules.ts:28-43`, `slop/profile.ts:130-145`, `policy.ts:39-62`, `network.ts:3490-3505`.

**State.** Derived per (member, reason) from `recentAsks`: `never_asked`, `open` (under 7 days, unanswered), `silent` (7+ days, unanswered), `answered`, `capped` (`askCounts >= maxAsksPerField`).

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| never_asked or silent | engine run | hard field missing, last ask 7+ days ago, not capped, not held | open | index.ts:130 |
| open | member reply | network sets `answeredAt` | answered | profile.ts:133 |
| open | 7 days | none | silent | profile.ts:137-145 |
| any | count reaches 2 | none | capped | index.ts:127 |
| no record | run | widen conditions, `askCounts.slop_widen` zero | open (once) | index.ts:134 |
| any | run | `needsBasics`, 21 days since last | open, **no cap** | index.ts:137 |
| any | run | `typeAsk`, wants or self missing, 21 days since last | open, **no cap** | index.ts:138 |

**Hold-back.** Hard-field asks hold the member from matching (`needs_answer`). `silentFallback` is off, so a member with a capped, unanswered hard field stays held with no further ask. By design: "then wait for the member".

**Ask dispatch.** `sendAsks` drops asks for members not `active`, or with `awaiting`, or asked within `ASK_EVERY_DAYS`. If the onboarding loop has a next question, it sends that one instead, tagged with its own reason. So the recorded reason may differ from the engine's.

**Defect.** D17: two asks can never be satisfied in production.

**Quint.** Merge with machine 15. Clock in weeks. Liveness: `eventually (asked = false or answered)`.

## 17. slop-review-hold (implicit tag latch)

**Where.** `slop/rules.ts:46-62`, `slop/profile.ts:193-200`, `friends/info.ts:88-89`.

**States.** `clear`, `verification_failed`, `unverified` (off by default), `safety_review`, `trust_review`, `review_confirmed`, `review_cleared`.

| From | Trigger | Guard | To | Evidence |
|---|---|---|---|---|
| clear | fact `verify:*:fail` | not cleared | verification_failed | rules.ts:50 |
| clear | fact `safety:*` in cues | not cleared | safety_review | rules.ts:52 |
| clear | blockedBy >= 2 or noShows >= 2 with noShows > dates | trust on | trust_review | rules.ts:53-60 |
| any | tag `review:confirmed` | wins | review_confirmed | rules.ts:48 |
| safety_review, verification_failed | tag `review:cleared` | none | clear (latched) | rules.ts:49-52 |

**Facts from grep.**

- No production writer of `review:cleared` or `review:confirmed`. The only writer is `packages/sim/src/apps/friends/snapshot.ts:164`.
- No production writer of `safety:*` tags in `packages/network/src`, `packages/network/service` or `packages/platform/src`.
- So in production, `safety_review`, `review_cleared` and `review_confirmed` are unreachable through tags. Holds in production come from `trust.ok`, `reportHeld`, and `safetyHolds`.

**Defects.** D18.

**Quint.** Add a timestamp to each cue and to the clear. Invariant: `newCue after clear => held`.

## 18. slop-assignment (explicit)

**Where.** `slop/assign.ts:60-219`. Default `assignment: "greedy"` (options.ts:147).

**Stages.** compute degree and demand -> filter `usable` -> sort by tier then value -> rounds 1..`rounds` -> greedy or stable.

`usable` = not excluded and not in an open opportunity (:76). Per member at most `round` picks (:103). Default `perMemberPerTick: 1`.

Stable roommates has phase 1 and phase 2 with guards `1e6` and `1e5` (:162-206). It is not the default.

**Invariants.** Each member at most once per round. A chosen edge is `eligible`. No pair twice.

**Not enforced here.** Interruption budget. See D7.

**Quint.** Greedy only. A proof of Irving's algorithm is out of scope.

## 19. probe-flow (explicit, LIBRARY)

**Where.** `attention.ts:768-831`.

**States.** Stage: `probing_first`, `probing_partners`, `revealed`, `closed`. Answer: `pending`, `yes`, `no`.

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| start | pair, sequential | none | probing_first | :789 |
| start | group or parallel | none | probing_partners | :789 |
| probing_first | first yes | pair | probing_partners | :819 |
| probing_first | first no | pair | closed | :819 |
| probing_first | partner answers | | ignored | :812 |
| probing_partners | partner yes | first is yes | revealed | :820 |
| probing_partners | partner no | | closed | :820 |
| probing_partners, parallel | any no | | closed | :817 |
| probing_partners, parallel | all yes | | revealed | :817 |
| probing_partners, group | yes count >= quorum | | revealed | :821 |
| probing_partners, group | yes + pending < quorum | | closed | :822 |
| revealed, closed | any answer | | ignored | :811 |

**Invariant.** `revealFor` returns null unless revealed and the recipient said yes (:828-830). Never names who declined.

**Defects.** D11.

**Quint.** Easy. Worth it only if the module is wired. Add answer idempotence: `answers[id] != pending => no change`, which fails today.

## 20. attention-compose (explicit gate order)

**Where.** `attention.ts:469-550`.

**Gate order.** paused -> only_when_asked (or two unanswered) -> conversation_streak -> quiet_hours -> cap (all invites) -> break_in_limit -> per-item gates (`itemGate`) -> pack items -> quality bar -> `U(M) > 0` -> send.

`itemGate` order: wrong_member -> expired -> review_rejected -> awaiting_review -> minor_restricted -> pack lane gate -> category_opt_out -> category_off -> receiving_no_contribute -> below_quiet_bar -> below_great_bar (:431-449).

**Invariants.**

- A1: `involvesMember && reviewState != approved` never sends (:435). AGENTS review rule.
- A2: a minor never gets an item that names or involves another member (:428, 438).
- A3: at most `maxMemberItems` member items; never two items about one person (:511-512).
- A4: at cap, no invite is sent, but a non-invite may be.
- A5: the romance lane ships alone unless the member allows it (:533-537).
- A6: cap never rises by learning (D11 design decision, `applyLearnedCadence`, `capFor`).

**Wired path.** Only `network.ts:2981` calls it, with `planAllowanceConfig`, a plan ledger and `items: [item]`. The plan item's `reviewState` is hard-coded `"approved"` (network.ts:2980). Other sends use `outreach.ts`, not this function.

**Concurrency.** Pure. Ledger and streak are caller state.

**Note on `network_growth`.** It has one participant, so `itemFor` gives `others=[]`, `involvesMember=false`, `reviewState="not_needed"` (attention.ts:727-735). If `itemsForProposal` were ever wired, a growth ask would skip the A1 gate. The AGENTS rule says "every proactive proposal". Not live today, since `itemsForProposal` has no caller. Keep this in mind when wiring.

**Quint.** Booleans for each gate. Check A1, A2, A4.

## 21. attention-ledger-annoyance (implicit)

**Where.** `attention.ts:129-159, 230-255`. `AttentionLedgerEntry` (types.ts:268-272).

States per ledger entry: `pending` (before deadline, no reply), `replied`, `late_reply`, `unanswered`.

`unansweredInterruptions` walks newest first. A reply in time stops the count. `since` (last inbound) drops older entries, so any later message lifts the two-unanswered pause (engine-attention-plans-1). If `since > now` (clock skew), the filter is ignored, so the pause is not lifted. Safe direction.

`annoyance` multiplier `r` is clamped to [0.5, 3] and decays with a 30-day half-life. Learned positives only bring it down to 1.

Both are pure. In production these are not called except through `composeMessage` on the plan path (`planLedger`). The Network's `unansweredProactive` is its own counter.

**Quint.** A short ledger of 3 entries is enough. Merge with machine 20.

## 22. hold-queue (explicit, LIBRARY)

**Where.** `attention.ts:606-689`. `HoldReason` (types.ts:223).

`addToHold` outcomes: `added`, `duplicate`, `hold_full`, `expired`, `dismissed`. Partner stage always replaces a cold item with the same key. Eviction by lowest value; partner evicted last. `revalidateHold` drops `expired`, `review_rejected`, `ineligible:<why>`, `partner_ineligible:<why>`.

`holdExpiry` ignores `EngineProposal.expiresAt`, so the item outlives the proposal TTL (48h vs 14 days). The comment on line 612 says "event anchors, plans", but the code handles only `anchor.type === "event"`.

No caller. See D10. Do not model until wired.

## 23. digest-slot-cursor (implicit, LIBRARY)

**Where.** `attention.ts:293-335`. Cursor: `lastServedSlot`, held by the caller. `digestDue` returns a slot once. `inSendWindow` is wired. `digestDue` has no caller.

## 24. reengagement-d6 (implicit, LIBRARY)

**Where.** `attention.ts:576-601`. States: `not_auto_paused`, `paused`, `already_reengaged`, `too_soon`, `quiet_hours`, `conversation_streak`, `nothing_eligible`, `not_high_value`, `ok`. `network.ts` has its own version. No caller.

## 25. peon-seat-capacity (implicit)

**Where.** `peon/seats.ts`, `peon/selection.ts:95-131`, `peon/rules.ts:14-66`, `peon/profile.ts:195-211`. Wired in `service/snapshot.ts:136` and `service/packs.ts`.

**States of a seat.** `no_seat` (owner not adult), `closed` (openings 0, or no intent), `open`, `at_cap_this_run`, `probation`, `trusted`.

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| posting | snapshot | owner age integer >= 18 | open or closed | seats.ts:65, 79 |
| open | snapshot | fills >= openings | closed | seats.ts:120, profile.ts:188 |
| closed | a fill ends (declined, expired, cancelled, no_show) | none | open | seats.ts:96-111 |
| open | selection | `times(job) >= slateCap` | at_cap_this_run | selection.ts:121-123 |
| probation | employer answers an application | none | trusted | selection.ts:60-71 |

**Invariants.** One member per opening. `seatCap` caps a run. Candidate at most 3 roles per week. `already_introduced` is permanent per pair.

**Mapping.** `seatRoute` swaps the seat for the manager, and `seatView` swaps back (network.ts:4468-4480, 4515-4537). This is a two-way id mapping that must be exact. A mismatch would mis-count fills.

**Holds.** `peonSeats` copies blocks but not holds. See D29.

**Quint.** Variables `openings`, `fills`. Action `propose`, `accept`, `decline`. Invariant `fills <= openings`. Include the in-flight window of the review queue.

## 26. peon-application (declared)

`peonPack.consent.default` lists stages: `candidate_probe`, `candidate_yes`, `employer_review`, `employer_yes`, `intro`, `interview`, `offer`, `hire`, `check_in_90d` (peon/index.ts:97-101). No engine code reads `stages`, `blindReview`, `initiator` or `reviewer`. `startProbeFlowFor` treats `application` as a wanter-first pair. The real flow is in `packages/network/src/jobs.ts` and the Opp machine.

## 27. friends-weekly-planner (explicit pass order)

**Where.** `friends/planner.ts:187-480`. Passes: crew sessions -> crew offers -> repeats -> universal tables -> activity tables -> single slot by zone -> near zones -> borough -> loose pass -> universal sparse -> activity partners -> alternates cleanup.

Sets: `taken`, `used`, `busy` (empty unless `spreadNew`). Default `spreadNew: false`, so a member in a crew session may also get a new plan in the same week. `busyAt` is not passed to `planProposals` here.

Local only for now (AGENTS decision 4). No Quint model needed. D26 and D27 apply.

## 28. photo-rating (implicit gate)

**Where.** `slop/appearance.ts:44-59, 138-153`, `slop/clef.ts:184-239`, `slop/clefWeights.ts`.

States: `refused_minor_or_unverified`, `no_usable_photo`, `rated`, stored as agent_private facet. `canRatePhotos` runs before any photo is read (clef.ts:207, 219). `adultsOnly` wraps it again. `slopProfiles` ignores a rating on a non-adult (profile.ts:197).

Invariant: no rating on a non-adult, no rating text in any member-facing string (`appearanceLeak`). Weights: placeholder or fitted; the platform refuses a file without provenance (`packages/platform/src/photos.ts`).

**Quint.** Only the gate, as part of machine 5.

## 29. Suspected defects

Each was verified by reading the code. "Run" means I also ran a small offline script on the engine functions (no model, no network). Confidence is about the code path. Impact notes say what is mitigated.

### D1. Two yes-sayers of a group plan are booked directly, against the engine's contract (P0, consent)

- **Where.** `plans.ts:600-606, 612-618, 646` state that a pair is never booked directly and must get a fresh `partnerPlan`. `packages/network/src/network.ts:3118` calls `this.bookPlan(o, fallback.members, true)` for every `smaller`, and never reads `partnerPlan`. `network.ts:3060` allows `keep.length >= 2 && a.groupSize[0] <= 2`.
- **Trigger.** Group plan for `bouldering` (`groupSize [2,6]`), quorum 3, 4 invited. Two say yes. The deadline passes. `planFallback` returns `smaller` with `partnerPlan`. `bookPlan` books the two and sends `planBooked` with names.
- **Effect.** Two members who said yes to "with 3 others... I'll share who's coming once enough people say yes" are named to each other in a one-to-one meeting. This is the case audit item engine-attention-plans-10 was to stop.
- **Confidence.** High. `grep partnerPlan` in `network.ts` gives no match.

### D2. A backfilled alternate is never probed (P1, delivery, plans)

- **Where.** `plans.ts:488` returns null when `!plan.invited.includes(recipient)`. `recordPlanAnswer` puts the alternate into `answers` only (`plans.ts:587`). `Plan.invited` doc says "plus alternates once backfilled" (`plans.ts:199`), but nothing does that. `network.ts:3019-3027` pushes to `o.participants`, not to `o.plan.invited`. The only writes to `o.plan` are lines 928, 2932, 2942. `planProbe` then calls `buildPlanProbe(..., o.plan, id)` (2989).
- **Trigger.** Invited a, b, c; alternates e, f. a says no. Action `backfill e`. `planProbe(e)`: text is null. `refuse(e, "probe", "plan_copy")`, then `planAnswer(o, e, false, true)`. That backfills f the same way. The bench drains with no message sent. Run confirms the `plan.invited` is unchanged after backfill.
- **Effect.** Backfill never works on planner plans. Plans fail quorum that could have met it. `size` in `network.ts:2994` and `about:` would also miss the alternate.
- **Confidence.** High on the code path. Medium on full end-to-end, as I did not run the network harness.

### D3. `partnerPlanFor` makes a plan that is already expired, and demand is lost (P1, currently masked by D1)

- **Where.** `plans.ts:624`: `probeDeadline = min(window.start - deadlineBeforeStartHours, now + probeWindowHours)`. `plans.ts:646` returns `carry: []`.
- **Trigger.** Plan with start 80h away, deadline `start-30h`. `checkPlanDeadline` closes at the deadline. `planFallback` gives `partnerPlan.probeDeadline - now = 0`. Run confirms 0. `planItem.urgency.expiresAt` is then not after now, so `itemGate` returns `expired`.
- **Effect.** After a deadline close (the common path, when lead <= 126h), the fresh partner plan cannot run. `carry` is empty, so the yes-sayers' demand is dropped too. Wiring D1's fix without this fix closes the plan with no outcome.
- **Confidence.** High.

### D4. Slop matching does not wait for the read-back (P0, stated preferences)

- **Where.** `confirmed` and `matchable` are set in `extract.ts:865`, `onboard.ts:92-94`. No production code reads them: `AppHooks` doc says "the Network never reads inside it" (`apphooks.ts:22-23`); `packs.ts:133-135` persists tags on every read; `network.ts:1085-1089` activates the member after the first answer; `missingFields` (`slop/rules.ts:28-38`) reads only tags.
- **Trigger.** Member states all fields. Tags persist. Member replies "no" to the read-back, or does not reply. The next `dailyRun` can propose them, on the unconfirmed values. The founder's default (`seeks` straight at confidence 0.6, `extract.ts:861-863`), which relies on the read-back to catch errors, also goes to matching unconfirmed.
- **Effect.** The read-back is advisory. A wrong gender or seeks reading can reach human review and a probe.
- **Confidence.** High. Human review is a partial mitigation only.

### D5. Deleting a field leaves the old tag (P0, stated preferences; run)

- **Where.** `extract.ts:917` `if (p.seeks) ... replaces.push`, `:939` `if (p.dealbreakers.length || p.noDealbreakers)`, `:943` `if (p.free.length)`. `network.ts:1055` keeps every tag not matched by `replaces`.
- **Trigger 1.** `no smokers`, then `smoking is fine`. Dealbreaker list is empty; `replaces` has no `slop:dealbreaker:`. Run confirms. The tag stays, so `statedDealbreaker` still filters.
- **Trigger 2.** Seeks `[man]`, then `no men`. `seeks` deleted. `replaces` has no `romance:seeks:`. Run confirms. The engine still sees `seeks: man`, and the member is matched to men against their last message.
- **Trigger 3.** Same for `free`.
- **Confidence.** High.

### D6. `planMemberReason` masks later rules (P1, reliability and cooldowns)

- **Where.** `plans.ts:146-149`. `memberReason` returns the first failure. `network/rules.ts:22-46` puts `interruption_budget` before `category_quota`, `category_cooldown`, `reliability_holdout`.
- **Trigger.** Member with two no-shows and no completed meetup since, and also at the weekly budget. `memberReason` returns `interruption_budget`. `planMemberReason` returns null. Planner seats them. `planSeatOk` (network.ts:2890) does not check no-shows.
- **Effect.** The doc says "every filters.ts memberReason except the interruption and contribution budgets". The busiest members skip hold-outs. `contribution_budget` for guests does not fire, so only the first case is live. friends rules have no budget rule, so friends is safe.
- **Confidence.** High.

### D7. slopAssign ignores interruption budgets (P1)

- **Where.** `slop/assign.ts:76` checks only `exclude` and open opportunity. `slop/rules.ts` has no budget rule. `AssignContext.extraProactive` is never read in `packs/`. `SLOP_ENGINE_CONFIG.budgets` (`slop/index.ts:42`) therefore has no engine effect on proposals. Friends uses core selection, so its budget holds in `canTake` only.
- **Effect.** ME-002 does not hold in the engine for slop. `network.ts` `eligible()` has `overBudget`, so production is mitigated. A sim or any other caller is not. `extraProactive` for asks is ignored too.
- **Confidence.** High on the code, low on production impact.

### D8. The retrieval "need" channel is dead (P2, liveness)

- **Where.** `retrieval.ts:73-79, 85`. The comment says members who meet a need are kept below `minSim`. `channels.add("need")` occurs nowhere (grep). `structured` need changes only the rank.
- **Effect.** A member with exactly the skill, but low text similarity, is dropped. `network/index.ts:52` lists the channel.
- **Confidence.** High.

### D9. `AskPlan.exclude` is never filled (P2, dead state)

- **Where.** `policy.ts:41, 51-54` never writes `exclude`. `f.askFirst` is always 0 (`engine.ts:236`). The comment in `types.ts:152`, `pack.ts:40-41` and `policy.ts:22` describe a hold-back that does not exist.
- **Confidence.** High.

### D10. `sendTimeReason` puts `underage` before holds and opt-out (P0 if wired; LIBRARY today; run)

- **Where.** `filters.ts:233-236`. `attention.ts:677-678` forgives `underage` for solo items.
- **Trigger.** Minor with a safety hold, or who sent STOP (`optedOut`), has a solo event item. `sendTimeReason` returns `underage`. Run: `minor held underage`, adult gets `safety_hold`. `revalidateHold` forgives it and keeps the item. `composeMessage` does not check holds or STOP.
- **Effect.** A held or opted-out minor keeps a live item. No production caller today.
- **Confidence.** High on code. No live impact.

### D11. `ProbeFlow` gaps (P0 if wired; LIBRARY; run)

- **a. Stuck state.** One participant (`network_growth`, `kinds` size [1,1]): yes moves to `probing_partners`, `toProbe` is empty, never revealed or closed (`attention.ts:819`). Run confirms.
- **b. Re-answer.** Group: a yes can flip to no with no guard (`:813`). Run confirms. Sequential: a first who said yes can say no later, which closes it.
- **c. Quorum ignored.** `startProbeFlowFor` ignores `flow.quorum` and `lateJoinHours` (`:799-803`, `:787`). Pack says `event_coattend` quorum 2; code uses `max(3, ...)`. A two-person `group_rsvp` is run as sequential.
- **d. No late join.** After `revealed`, a pending member's yes is dropped (run), though `group_rsvp` declares `lateJoinHours`.
- **e. No expiry.** `double_opt_in.expiresHours` is never read. No timeout transition.
- **f.** `application.stages` is never read.
- **Confidence.** High.

### D12. Clef `minor_signal` does not set `ageSignal`; relay age signals do not lower the age (P0; run)

- **Where.** `relay.ts:444` passes `first.record.ageSignal`. Clef `clef:minor_signal` sets no signal. Run: `hold [ "clef:minor_signal" ] false`. `network/src/relay.ts:242` keeps the text for staff unless `ageSignal`. The comment in `relay.ts:21` says the block "flags the age for the platform", but `ageSignal` has no reader besides line 242 and the store (`store.ts:157, 208`).
- **Effect.** A message Clef reads as a minor's is kept as text and shown to staff (rule: "Never a minor's words", `network/src/relay.ts:339`). The member's age state does not change from the relay path. The inbound turn parser may catch the same words if the message passes through `/internal/turn` first (`network.ts:716-722`). I did not prove that path covers every relay message.
- **Confidence.** High for the flag. Medium for the age-state gap.

### D14. LLM reader: under-13 ignored, and `confirmed` reset (P1, SIM ONLY today; run)

- **Where.** `extract.ts:1069`: `a < 18 && a >= MIN_MEMBER_AGE`. An LLM age of 12 sets nothing. Run: `age undefined, minor false`. `extract.ts:1084`: `finalize(p, true)` always resets `confirmed`. Run: an empty reading on a confirmed profile sets `confirmed false`. `selfAge` is always in `missing`, so the reader runs on every message.
- **Effect.** Comment says "an LLM age only marks a minor". A 12-year-old is not marked. If wired, every message un-confirms.
- **Confidence.** High. Not in production (`packs.ts:103` "Rules only, no model").

### D15. Non-strict under-13 age is minor, not declined (P2; run)

- **Where.** `extract.ts:814`. `almost 13` gives age 12, `minor true`, `declined false`. Core policy: under 13 cannot join, nothing stored. Header says "an explicit statement", so this may be intended.
- **Confidence.** High on the code. Medium on it being a defect.

### D16. Read-back cap gives a stuck state (P2)

- **Where.** `packs.ts:140`, `onboard.ts:89-94`, `extract.ts:844`.
- **Trigger.** Hard fields set at join; age comes later or a field changes. Two read-backs spent, then one more hard change. `confirmed=false`, cap reached. `next()` goes to `nextQuestion`, never again to read-back. `matchable` stays false for good. `hardComplete` also excludes age, so a read-back can precede the age question, and the age answer resets `confirmed` (run: `after age confirmed false`).
- **Effect.** Masked by D4. Fixing D4 makes this a lockout.
- **Confidence.** High.

### D17. Two slop asks can never be satisfied (P2, attention; verified by grep)

- **Where.** `slop/rules.ts:41-43`: `needsBasics = !goal || (!dealbreakers.length && values.politics === undefined)`. `extract.ts` `readValues` has no politics. `noDealbreakers` writes no tag (`extract.ts:939`). `slop/index.ts:138`: `!p.wants || !p.self`. No production writer of `slop:wants:` or `slop:self:` (grep over `packages/network`, `packages/platform`).
- **Trigger.** Member with goal, who says "no dealbreakers". Every 21 days the engine asks `slop_basics`, and `slop_type` always. Neither has a `capped` check (`index.ts:137-138`), unlike the hard asks.
- **Effect.** Asks repeat for as long as the member stays. They are `proactive:false`, so they skip the cap (network.ts:3484-3488).
- **Confidence.** High.

### D18. Review tags: latch, no writer, no exit (P0 for design)

- **a. Latch.** `review:cleared` has no time. A new cue after a clear is ignored for good (`slop/rules.ts:49-52`, `friends/info.ts:89`).
- **b. No production writer.** No `review:*` or `safety:*` writer in production (grep). States unreachable. Friends `safety_review` and slop `safety_review` do not fire from any live signal.
- **c. `trust_review` has no exit.** `cleared` does not apply to it (`rules.ts:53-60`). `blockedBy` counts every `blocked` edge for all time (`profile.ts:273`). Two blocks hold a member from matching, with no staff exit in this rule.
- **Confidence.** High on a and c; high on b for the three source trees I searched.

### D19. Member with no location is placed at the market anchor (P1, radius promise)

- **Where.** `slop/rules.ts:28-38` asks only when `zipUnknown`. `profile.ts:285-287` `cellIn` falls back to `MARKET_ANCHOR_ZIP` when `cell` is unset. `slop/rules.ts` comment: only "after a week without an answer".
- **Trigger.** Member with radius, no zip, no home area. `zipUnknown` false. No ask. `mutualMarkets` treats them as at 10003. They match within radius of the East Village, wherever they live. `HARD_FIELDS` includes `location`, but the engine does not.
- **Confidence.** High. `packs.ts` `engineInput` fills a zip from a home area when one exists, so this needs a member with no area.

### D20. Judge cache does not persist in the service (P2, cost)

- **Where.** `engine.ts:174, 184, 199`: `deps.* ?? new JudgeCache`. `network.ts:3443` passes only `llm` and `pack`. Grep finds no `judgeCache` outside the engine.
- **Effect.** ME-008's TTL never applies. Each daily run repeats all calls when `NETWORK_ENGINE_JUDGE=1`.
- **Confidence.** High.

### D21. Inputs the engine expects are not sent (P1)

- **Where.** `network.ts:3713-3726` `engineInput` has no `unsentProposalIds`, `openOpportunities`, `events`, `categoryQuotas`.
- **Effect.**
  - `billOnlySent` does nothing. An Opp rejected or expired in review still counts against budget and blocks the pair through `activePairs` for 7 days (`world.ts:171-179`). `recent` is all Opps of 30 days.
  - For `ntwrk`, `skipOpenOpportunities` does nothing (`packInput` adds it for apps only). `eligible()` covers it.
  - `event_anchor` has no events in `dailyRun`, so that generator returns nothing. `planWorld` adds events (line 2858), but `packInput` does not.
  - `categoryQuotas`: `category_quota` rule never fires. I found no writer in `network.ts`.
- **Confidence.** High on absence in `engineInput`.

### D22. `responseHistory` skips alias resolution (P2)

- **Where.** `world.ts:149-151` canonicalizes `participants`, `declinedBy`, `contributors`, not `acceptedBy`, `noResponse`. `:389-394` reads them. Breaks the ME-006 "one id space" rule for the acceptance estimate. Not a safety path.
- **Confidence.** High.

### D23. Trimmed exploration still consumed budget (P2)

- **Where.** `policy.ts:74-77`. The trim happens after greedy ran, so greedy saw capacity used by picks that are later dropped. `selectionProbability` of survivors is not updated. Low impact.
- **Confidence.** High.

### D24. A yes after the deadline books the plan (P2; run)

- **Where.** `plans.ts:568-578` has no deadline check for yes. Run: yes at `now+500h` returns `book`. `network.ts:3366` tick normally closes first. If the tick is late, a plan can book after its deadline, or after its start.
- **Confidence.** High on code; low likelihood.

### D25. Comment says silence backfills; code does not (P2)

- **Where.** `plans.ts:565`: "No (or silence)". Engine has no silence event. `checkPlanDeadline` just closes. Silent callers in `network.ts` call `planAnswer(..., true)` for refused seats, not for true silence.
- **Confidence.** High.

### D26. Crew sessions do not recheck blocks (P1)

- **Where.** `plans.ts:717-740` copies `crew.members`. `friends/planner.ts:246` and `network.ts:3226-3229` filter by member eligibility only. `withReach` checks blocks for added people only.
- **Trigger.** Crew of a, b, c, d. a blocks b. Next session invites both. `bookPlan` drops one at reveal (network.ts:3051-3058). The probe still goes to both. friends' repeat path has the check (`planner.ts:288`), so this one is a gap.
- **Confidence.** High. Mitigated at reveal in the network path.

### D27. friends: probe deadline can equal now (P2, liveness)

- **Where.** `friends/planner.ts:49` `minLeadHours: 30`; inherited `deadlineBeforeStartHours: 30`; `:300`, `:466`, `:382`.
- **Trigger.** A slot exactly 30h ahead has `probeDeadline = now`. Monday 09:00 run with Tuesday 19:00 slot leaves 4h, less than the review SLA of 12h.
- **Confidence.** High on arithmetic. Friends matching is local only.

### D29. Seat is not held when its manager is held (P2)

- **Where.** `peon/seats.ts:50-92` copies blocks, not `safetyHolds`. `network.ts:3710` makes holds from `this.members` (no seat ids). The engine spends slate on the seat. `gateReason` -> `eligibleIn` -> `managerProblem` stops it later.
- **Confidence.** High. Mitigated.

### D30. Rate notice claims a hold that does not exist (P2, cross-package)

- **Where.** `relay.ts:290` "I'll hold that one for a bit". `packages/network/src/relay.ts:238` returns held and stores nothing, so the item is dropped.
- **Confidence.** High. Belongs to the network relay file too.

## 30. Cross-machine notes

- **Snapshot vs send.** Everything the engine decides is stale by send time. `gateReason`, `eligible` and `checkRecipient` recheck. The Quint model must treat the engine as an untrusted proposer and put the safety invariants on the send action.
- **Two consent flows exist.** `ProbeFlow` here and `Opp` in `network.ts`. Same words, different code. One name per machine would help.
- **Two TTLs.** `EngineProposal.expiresAt` (48h, 3h same day) and `holdExpiry` (14 days) differ. `planToProposal` uses `probeDeadline`. Production uses `PROBE_TTL`.
- **Three age checks** read differently: `canBeMatched`, `m.age >= cfg.ageMin`, pack `minMatchAge`. `filters.ts:56` and `:233` use all three. `fairnessMetrics` (policy.ts:216) uses only `ageMin`.
- **Two seat ids.** `peonSeats` and `seatRoute` must agree. Include both in any seat model.
- **Module caches.** WeakMaps keyed on `EngineInput` or `World` (`slopProfiles`, `friendsInfo`, `peon` caches, `riskCache`, `guards`). Safe only if the input is never mutated. `canonicalInput` builds a new object per run, so `planFromInput(input, ...)` with a different object rebuilds. `slopProfiles(input)` in `plan.ts:53` is called with no `canonical` argument, while `World` passes `w.canonical`. The cache key is the input object, so the first caller's `canonical` wins. Low risk, and aliases are not used in slop production.

## 31. Quint plan

Recommended order, by value:

1. **plan-run + plan-fallback** with `planProbe` reachability. Finds D1, D2, D3, D24.
2. **slop-onboarding + tag projection + ask loop**. Finds D4, D5, D16, D17.
3. **relay-item + network replay and staff release**. Checks R1 to R6.
4. **hard-filter-chain with forgiven reasons**. Finds D6, D10.
5. **global-selection with budgets**, one spec per pack `assign`. Finds D7.
6. **peon-seat-capacity** across the review window.
7. **probe-flow**, only after a decision to wire it.

Shared abstractions: a day-grained clock; 3 to 4 members; ages `{12, 15, 30, none}`; reasons as enums. Do not model scores. Replace them with nondeterministic order.

## 32. What was not done

- I read `scripts/sim/conformance.ts` and `scripts/sim/slop.ts` only at the lines that call `ProbeFlow`.
- I read parts of `packages/network/src/network.ts`, `service/packs.ts`, `src/relay.ts`, `service/relay-endpoint.ts`, `service/snapshot.ts` to verify boundary claims. Their full analysis is in the network files.
- I did not run `bun run sim`, the network harness or any model. The two scripts in the scratchpad called engine functions only.
- Nothing was fixed.
