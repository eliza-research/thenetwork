# State machines: the ConsentNetwork core

Scope: `packages/network` outside `service/` and `harness/`, plus `packages/network/db/network-state.sql`.
Branch: `claude/quint-state-machines` (a0ed7bc). This is research only. Nothing was fixed.

File shorthand used below:

| Short | File |
|---|---|
| `N` | `packages/network/src/network.ts` |
| `S` | `packages/network/src/store.ts` |
| `T` | `packages/network/src/trust.ts` |
| `R` | `packages/network/src/relay.ts` |
| `J` | `packages/network/src/jobs.ts` |
| `C` | `packages/network/src/classify.ts` |
| `O` | `packages/network/src/outreach.ts` |
| `E` | `packages/engine/src/plans.ts` (read only where the Network calls it) |

Actors: **member** (inbound message), **staff** (review or safety API), **clock** (the service tick, `tick(now)`), **service** (the platform, through `runStored`), **gateway** (Eliza, through `/internal/*`).

## 0. Method and what "verified" means

- I read all source files in scope. I read the schema. I read the tests that exercise this code (the list is in the coverage file). For the `profile-suggestion*` tests and some integration tests I read only the titles, because they test `service/`, which is out of scope.
- "Reproduced" below means that I ran a scenario on the real `ConsentNetwork` with `packages/network/test/mini.ts`, in memory, from a script in the session scratchpad. No model, no Postgres, no external service. No repository file changed.
- "Read" means that I traced the code path but did not run it.
- The whole Network state is one JSON document per network. Every unit of work runs under one lock (machine `store-unit-of-work`). So inside the Network there are no data races between units. The concurrency questions are mostly: what a unit can see, what crosses the service boundary, and what goes stale between two units.

## 1. Machine index

| # | id | Kind | Where the state lives | Priority |
|---|---|---|---|---|
| 1 | `opportunity-lifecycle` | explicit | `Opp.stage` | P0 |
| 2 | `opp-participant-status` | explicit | `Opp.status: Map<MemberId, PStatus>` | P0 |
| 3 | `review-item` | implicit | `Opp.review` (nullable fields) | P0 |
| 4 | `plan-run` | explicit | `Opp.planRun.stage`, `.answers` | P0 |
| 5 | `booked-attendance` | implicit | `bookedTold`, `bookedAt`, `confirmed`, `explicit`, `post`, `finalized` | P1 |
| 6 | `member-request` | explicit | `Request.outcome`, `closed`, `tries`, `lastTry` | P1 |
| 7 | `member-age-policy` | implicit | `MemberState.minor`, `minorSignal`, `ageUnknown`, `ageConflict`, `minorReported`, `statedAge`, `age` | P0 |
| 8 | `member-onboarding-stage` | explicit | `MemberState.stage` | P2 |
| 9 | `member-opt-out-and-forget` | implicit | `optedOut`, `declinedIds` | P0 |
| 10 | `awaiting-slot` | explicit | `MemberState.awaiting` | P0 |
| 11 | `outreach-attention` | implicit | `pendingAsks`, `unanswered`, `onlyWhenAsked`, `reengaged`, `outbound`, `openAskAt`, `proactive`, `unsol*`, `planInvites` | P1 |
| 12 | `send-pipeline-and-deferred` | implicit | `ConsentNetwork.deferred`, `SendHook` | P0 |
| 13 | `trust-level` | explicit | `TrustRecord.level`, `score` | P0 |
| 14 | `safety-case` | explicit | `SafetyCase.status` | P1 |
| 15 | `safety-report` | explicit | `SafetyReport.status` | P0 |
| 16 | `pending-safety-who` | implicit | `MemberState.pendingSafety` | P1 |
| 17 | `pair-relations` | implicit | `blocks`, `avoid`, `declined`, `again`, `planAgain` | P0 |
| 18 | `relay-held-item` | explicit | `RelayHeld.status`, `RelayRecord.decision` | P0 |
| 19 | `relay-number-swap` | implicit | `RelayState.swaps`, deferred sends | P0 |
| 20 | `relay-match-view` | implicit | derived: `relayMatchOf`, `relayDispatchCheck` | P0 |
| 21 | `job-posting` | explicit | `JobPosting.status`, `PostingDraft`, `MemberState.posting` | P1 |
| 22 | `job-seat-item` | implicit | `Opp.seat`, `checkSeats` | P1 |
| 23 | `crew-offer-and-crew` | implicit | `CrewOffer.resolved`, `Crew.handedOff`, `sessions` | P2 |
| 24 | `fraud-item` | explicit | `FraudItem.status` | P2 |
| 25 | `store-unit-of-work` | implicit | advisory lock, `network_state` row, in-process `Queue` | P0 |
| 26 | `daily-gates-and-switches` | implicit | `lastRunDay`, `lastPlanRunDay`, `matchingEnabled`, `opts.review` | P1 |
| 27 | `ledger-emitter` | implicit | `emit` ids, `joinedLedger`, `activated` | P2 |

## 2. Suspected defects, ranked

Each one has the trigger, the evidence and my confidence. All were checked by reading the code. "Reproduced" is stated when I ran it.

### P0 (consent, privacy, safety rules)

**D1. A counter-offer counts as a yes to a probe, and silence after it reveals names.** AGENTS.md decision 11: "only `answer: "yes"` is consent, a counter is not a yes."
- `C:666` (no options): `c.answer === "yes" || c.answer === "counter" ? "yes"`. `C:719` (with options): `if (c.answer === "counter") return { answer: "yes", keys: [] }`.
- `N:772` then treats it as a yes. `N:2300` sets `available` and `primed`. With options: `N:2314-2322` sends a time retry. `N:3378` keeps the yes on silence ("no answer keeps the yes").
- Trigger: probe; the member says "how about next week instead?"; silence for 26 h; the partner says yes. Result: the plan is booked and the member gets "You're both in: meet Ben I.".
- A job seat probe has no options (`N:2180`), so the first branch applies with no retry at all.
- Reproduced end to end. Confidence: high.

**D2. A group plan that falls to two people books the pair directly, with names.** Engine contract at `E:600-606`: "Exactly two: they said yes to a group, not to a one-to-one meeting, so the pair is NEVER booked directly" (engine-attention-plans-10), and `partnerPlan` is always set.
- `N:3118`: `if (fallback.kind === "smaller") return this.bookPlan(o, fallback.members, true);`. The Network never reads `fallback.partnerPlan` (no reference in `packages/network`).
- `N:3060` has the same hole on a shrink: `keep.length >= 2 && a.groupSize[0] <= 2`.
- Trigger: plan of 3 (quorum 3, activity `bouldering`, groupSize `[2, 6]`). Two yes, one no. The deadline passes. Both get "You're in: bouldering ... with Ben I.".
- Reproduced. Confidence: high.

**D3. A number swap can go one way, and the relay log then says that it was shared.** `R:284-286` says "so nobody's number goes one way".
- `R:292-299` checks only `first.decision !== "sent"`. `apply` answers `"sent"` also when the send was **deferred** (`R:248`). The second share then goes at once.
- A deferred send has no hook, so a later refusal at `N:3276` never reaches the desk. `undelivered` (`R:252`) does not run.
- Trigger (reproduced): `a` has quiet hours 21-9, `b` has 23-7. At 22:00 `b` then `a` ask to swap. `b` gets `a`'s number at once. `b`'s number to `a` is deferred. `b` blocks `a`. The deferred share is refused at the morning tick. Final state: `b` holds `a`'s number, `a` never got `b`'s, and `relayLog()` has both items as `pass, contactShared: true`.
- The same window breaks withdrawal: `cancelSwaps` (`R:308`) removes only pending swaps. A deferred share still goes after "don't send my number".
- The deferred record keeps the plain phone number in `network_state`: `Deferred.body` and `o.relayContact` (`N:3888`). The file header says the relay state keeps no contact value (`R:22-24`).
- The swap ask itself can be deferred (`R:281`) past its "in the next 15 minutes" text (`R:154`).
- `service/relay-endpoint` and the outbound queue can re-check a queued item (`relayDispatchCheck`), but a deferred send is held in the Network state, before that queue. Confidence: high for the Network. The service-side final check is out of my scope.

**D4. An MCP profile can start and confirm a job post.** The comment at `N:735-738` says that an assistant's profile "skips every answer below". `J:11-13` says "never an LLM's open-turn output".
- `N:755` calls `postingTurn` with no `mcp` check, before `N:758-759`.
- Trigger (reproduced): `source: "mcp"` with "We're hiring a data analyst, 2 openings, $90k-$120k, hybrid in Brooklyn", then `source: "mcp"` with "yes". `onPosting` fires. The member never confirmed in their own thread. Confidence: high.

**D5. The single `awaiting` slot loses the answer path of a pending probe.** Three writers skip `expect()` (`N:4136`), which exists to protect a pending yes or no:
- `N:4055` (probe), `N:4093` (plan probe): overwrite `booked` and `probe`.
- `N:4636` (posting): overwrites `probe` and `booked`.
- `N:2154-2173`: a hiring manager is never busy for seat items (`N:4372`), and `probe()` does not look at `awaiting`. Two candidates in review at once: the second probe takes the slot, and the manager's "yes" answers only the second. The first expires after 26 h and the candidate's opportunity closes. Read, confidence medium-high.
- Reproduced for posting: a member with a pending probe sends a job post; then "no" drops the draft ("OK, I didn't post anything"), `awaiting` is cleared, the probe stays `probing` until expiry.
- A booked plan overwritten by a probe: "can't make it" reaches the probe branch (`N:765`) and the booked plan stays on. Only a manager can reach this state (`busy()` stops everyone else). Read, confidence medium.

**D6. `metBefore` counts a person who only got an anonymous probe, so a stranger's report holds someone.** `N:1387-1390` uses `o.contacted` and `o.participants`. A plan keeps people who said no in `participants` (`N:3014`), and `contacted` means "got a probe". `counterparts` was fixed for this (`N:1468-1470`). `metBefore` was not.
- Trigger (reproduced with a state edit like `block-target-plan.test.ts`): plan booked for A, B, C; D was probed and said no; D texts "report Ana Diaz, she harassed me". `met: true`, the report is urgent, `reportHeld(A)` is true, A is out of matching and the plan closes.
- The reverse also holds: a primed requester who never got a probe (fixed venue, or no time options) is not in `contacted`, so their own report on a real date counts as `met: false` until feedback. `minorAfterContact` (`N:1223`) has the same flaw. Confidence: high.

**D7. A block closes a whole plan, even when the blocker is not going.** `N:1434-1445` tests only `participants`.
- `N:3051` protects the quorum before booking ("one block cannot collapse the quorum"). After booking, one block ends the plan for everyone. A person who said no can cancel a plan they are not in.
- Reproduced: D (status `no`) blocks Ana. Stage goes to `closed`, Ben gets `declinedQuiet`. Confidence: high. Severity: medium.

**D8. A stale `plan.invited` refuses later plan probes.** `N:2995` passes `about: o.plan.invited`. `invited` is set once in `beginPlan` (`N:2942`). `planOut` does not change it. `checkRecipient` (`N:4228-4235`) refuses when any `about` member is on watch, paused or a minor.
- Trigger (reproduced): four invited, probes wait for the send window, C goes on watch, D's plan probe is refused with `other_on_watch`, then `planOut`. The plan fails. Note: in that run A and B fell to `plan_copy`, the known engine gap. Confidence: medium-high.
- The probe is anonymous, so the `about` check adds nothing here and harms the quorum.

**D9. `dropMember` treats every participant of a scheduled opportunity as going.** `N:2581` calls `handleDrop` for any status.
- A plan participant with status `no`, `unavailable`, `dropped` or `probing` who leaves, opts out or goes on watch makes the going members hear "one person can't make it now" about nobody they were told about. `bookedCancelled` also counts it.
- In a pair-like plan (`participants.length > 2`, `still.length < 2`) the plan may close on a person who was never in it.
- A member who dropped and then sends STOP runs `handleDrop` twice. Reproduced: the counter went to 2. The second notice was stopped only by the 10-minute duplicate rule (`N:3930`), so a later STOP sends it again. Confidence: high.

**D10. A replaced prober keeps a dead `awaiting: probe` forever.** `N:2580` and `N:2579` do not clear it. The expiry path does (`N:3381`). `N:3285` never expires `probe`, and `close()` clears only current `participants` (`N:2535-2538`).
- Reproduced: b is probing, b sends STOP, c replaces b, b sends START. Five days later `awaiting` is still `probe`. Then "tell me more about it" gets "Just to check: is that a yes or a no?" about a dead probe.
- While stale it blocks asks (`N:3880`), plan probes (`N:2975`), the planner (`N:2909`) and engine asks (`N:3495`).
- `N:3378` (a time retry that expires) also leaves the slot set. Confidence: high.

**D11. A reviewer can approve an item past its SLA.** PRD 32.8 and `docs/network.md` 2: "It is never sent late". The check is only in `advance()` (`N:3345`). `decide()` and `reviewBlock()` have no deadline check.
- Reproduced: `clock.set(deadline + 3h)` with no tick, `decide(..., "approve")` returns ok and the item starts probing.
- The window is one tick in production, or longer when `withTickLock` skips ticks. Confidence: high. Severity: low-medium.

### P1 (data integrity, liveness)

**D12. A booked request stays `booked` for good after its meeting is called off.** `N:2442` sets it. `handleDrop` closes the opportunity on its own path (`N:2518`). `close()` resets only `probing` (`N:2544`). So the request is never fulfilled, never retried (`N:3695` needs `none`) and the requester is not told again.
- Reproduced: `outcome: "booked"`, opportunity `closed`, unchanged after 3 days.
- `handleDrop`'s private close also skips the `interactions` row, and leaves the other member's `awaiting: booked` set (reproduced), so their "yes" arms `bookedThanks` for the next message. Confidence: high.

**D13. A declined probe is recorded as expired.** `N:2334` sets `unavailable`, never `no`. `N:2559` looks for `reason === "declined"`, and no caller uses that reason. `declinedBy` is always `[]` for intros.
- Reproduced: `{ outcome: "expired", declinedBy: [] }` after "no thanks".
- The engine reads these fields (`engine/src/world.ts:160,392`, `packs/slop/profile.ts:239`, `packs/slop/learn.ts:40`, `packs/peon/profile.ts:208`). The console status is also wrong: `partStatus` shows `unavailable`. `o.status.get(req.id) !== "no"` at `N:2548` is always true for intros. Confidence: high.

**D14. The watch period can last one day, not 14.** `T:85` does `r.lastDecay ??= now`, so a member who has a record keeps the old grid. `T:129` moves it by whole steps.
- Reproduced: score 1 at day 0, decays at day 14, +3 at day 27 (watch), `decay` at day 28 gives `ok`, score 2.
- The header (`T:4-5`) says "14 days from 3". `docs/network.md` 6.2 says "for each 14 days with no new signal". Confidence: high.

**D15. Any inbound resets the pause rules, including an MCP profile and carrier keywords.** `N:615` calls `heardFrom` with no source check. `N:641` clears `onlyWhenAsked`. `N:267`: "no proactive messages until the member writes again". `N:613` already says that MCP "is not the member answering".
- Reproduced: `onlyWhenAsked: true, unsolStreak: 2` becomes `false, 0` after one `source: "mcp"` message. Confidence: high that it happens. Medium that it is a bug (a founder call).

**D16. Pair history is not checked on three composition paths.** `N:2327` says "never probed again for a while, from any path". `N:1808-1809` (plans buddy) checks only `blocked`. `N:3813-3819` (second encounter) and `N:3825-3838` (newcomer welcome) do not check `declined`, `avoid` or `blocked` directly. `approvalCheck` runs `gateReason` for engine items only (`N:2000`). A human reviewer is the only guard. Read. Confidence: high. Severity: medium.

**D17. Crew session dedupe compares the wrong id.** `N:3232` pushes `plan.id` (`plan_<hash>`). `N:2928` creates the opportunity with no id (`nw-...`). `N:3230` does `this.opps.get(id)`, which is never found. So a session rejected or expired in review is proposed again for the same window on the next day, and each try counts toward `handedOff` (`N:3235`). Read. Confidence: high.

**D18. Age unknown at a web join gets the teen welcome.** `welcomeJoined` (`N:4825`) does not run the age branch of `handleInbound`, so `ageUnknown` is false, `m.minor` is true (fail closed), and `N:985` sends `welcomeMinor` with stage `active`, not `welcomeAskAge`. Reproduced. It is safe but wrong, and `/api/join` may always carry an age. Confidence: high for the code path, low for reach.

**D19. A deferred reveal that goes invalid is dropped with no effect on the plan.** `N:3274` skips a send when `valid()` is false, and `valid` is false after the meeting time (`N:4076`). `onRefused` does not run, so the plan stays `scheduled` with one member never told, while the reminder path can still reach them (`N:3397`). It needs quiet hours that cover from booking to the meeting. Read. Confidence: medium. Severity: low.

**D20. No fencing on the state write.** `S:288` upserts with no version compare. `S:320-333` holds a session advisory lock on one reserved connection, but `load` and `save` use other connections. If the reserved connection dies, the server frees the lock while `fn` runs. Another process can take the lock, and the two saves race (last writer wins, a STOP can be lost). Read. Confidence: medium (needs a connection loss during a unit).

### P2 (small)

- **D21.** `o.deadline` is written (`N:2065`, `N:2103`, `N:2943`) and never read. State written, never used.
- **D22.** `reengage` sets `reengaged` on `deferred` (`N:3340`). If the deferred send is later refused, the one re-engagement is spent.
- **D23.** "We filled it" closes with `closedReason: "closed"` (`J:188`). Only staff can write `filled`. `endSeat` then logs `posting closed`.
- **D24.** A late feedback answer counts a no-show twice: `finalize` (`N:2773`) at +4 days, then `onFeedback` (`N:2621`) until +7 days through `feedbackDue` (`N:2590`).
- **D25.** `POSTING_COPY.readBackClose` says that intros "not done yet end". `endSeat` keeps scheduled ones (`N:4562`).
- **D26.** Doc drift: the `N:269` and `N:3332` comments and AGENTS.md say 14 days of silence. `O:28` is 30 days. `N:3323` says 48 h. `O:24` is 72 h.
- **D27.** `startPlanRun` and `recordPlanAnswer` are called with no `canMatch` (`N:2944`, `N:3011`), and `dropMember` does not filter `planRun.bench`. A minor stays on the bench and enters `participants` before `planSeatOk` refuses them (`N:2969`). No contact happens. It loses one layer of defense.
- **D28.** The swap replay after pruning: `R:322` finds the swap only until `swaps` is filtered. A replay of the same signed item after 15 minutes starts a new swap ask (`R:281`). Outbound id dedupe should catch it.
- **D29.** Not a state machine, seen on the way: `copy.ts:195-197`. The "built phrases" `if` has no push of its own, so `raw_tag` is checked only when that regex matches, and the phrase rule never reports.

### Checked and not a defect

- A stuck request in `probing` after `forget`: `dropMember` closes the opportunity first.
- Rejoin after leave: a new `memberId` is minted (`platform/accounts.ts:377`), so `declinedIds` cannot trap a person.
- `understand` (LLM in `onInbound`, `N:598`) is not wired in `service/`, so no model call sits under the lock today. The Clef relay hook does run under the lock (`service/relay-endpoint.ts:239`). That is a latency point, not a logic bug.
- `banned` then `liftHold`: the platform sets `account_status = restricted`, so `m.account` still keeps the member out (`N:4421`).
- Review mode cannot be restored from state: `exportState` leaves it out (test in `store.test.ts`), and the service refuses `auto`.

---

## 3. The machines

Format: states, transitions, invariants, interactions, concurrency and failure, Quint notes. Defect references point to section 2.

### 3.1 `opportunity-lifecycle` (`Opp.stage`) P0

Kind: explicit. `N:338`. Mirror: `network.opportunities.state` (console words, `S:86-94`, read-only). The real state is the JSON document.

States: `review`, `probing`, `scheduled`, `done`, `closed`. Implied: `closed(closedFrom)` where `closedFrom` is `review`, `probing` or `scheduled`. `newOpp` also starts in `review` with no `o.review` for one synchronous step before `submit` (`N:2103`).

| From | Event | Guard | Effects | To | Actor | Line |
|---|---|---|---|---|---|---|
| (none) | `newOpp` + `submit` | category allowed | `review` record, statuses `queued`, log | `review` | clock, member | N:2096, 2047 |
| (none) | `submit` | category not allowed | gate log | `closed` | any | N:2050 |
| review | approve or edit | `reviewBlock`, `editBlock`, `approvalCheck` pass | decision stored, `begin` | `probing` | staff | N:1918-1927, 2063 |
| review | approve | `approvalCheck` fails | `invalidated` | `closed` | staff | N:1920-1925 |
| review | reject | - | `markDeclined`, close | `closed` | staff | N:1930 |
| review | reroll, alternate found | eligible alternate | swap, new deadline | `review` | staff | N:2027-2036 |
| review | reroll, no alternate | - | `markDeclined`, close | `closed` | staff | N:2023 |
| review | SLA passed | `now >= review.deadline` | `expired` | `closed` | clock | N:3345 |
| review | participant dropped | any `dropMember` | - | `closed` | any | N:2578 |
| probing | everyone `available` | `reveal` checks pass, a time exists | names go out | `scheduled` | member | N:2402, 2438 |
| probing | plan quorum | `bookPlan` | names go out | `scheduled` | member | N:3020, 3071 |
| probing | no common time | - | - | `closed` | member, clock | N:2216 |
| probing | nobody left | `replaceOrClose` | - | `closed` | any | N:2397 |
| probing | requester or manager out | - | - | `closed` | any | N:2370, 2372 |
| probing | minor or alternate minor | `dropMember` | - | `closed` | any | N:2575-2577 |
| probing | block between two | - | - | `closed` | member | N:1444 |
| probing | seat ended | `endSeat` | - | `closed` | clock, service | N:4569 |
| probing | plan deadline | fallback | - | `closed` or `scheduled` | clock | N:3367, 3109 |
| scheduled | `meetingAt + 3h` | `!feedbackSent` | feedback asks | `done` | clock | N:3405 |
| scheduled | drop, `keep` false | `handleDrop` | own close path | `closed` | member, any | N:2518 |
| scheduled | drop, `keep` true | - | notice | `scheduled` | member, any | N:2514 |
| scheduled | block | - | neutral notice | `closed` | member | N:1436-1444 |
| done | attendance | once | `finalize` | `done` | clock, member | N:3425 |
| any | `forget` | participant or requester | row deleted | (removed) | service | N:920 |

`closed` and `done` are terminal (`N:2527`). No opportunity is ever removed except by `forget`, so the state document grows without limit (see 3.25).

Invariants:
- `reviewGate`: `stage` in {probing, scheduled, done} implies `review.decision == "approve"` and no `invalidated`. Holds by construction: `begin` has one caller chain (`decide`), and `startProbes` only `begin`. AGENTS.md "must go through human review".
- `noContactBeforeApproval`: no `probe`, `reveal` or `plan_probe` send for an opportunity while `stage == review`.
- `minorNever`: no participant with status in {queued, probing, available, yes} is a minor while `stage` is open. Note the exception in `N:2575`: an alternate-only minor on a `scheduled` item leaves it open by design.
- `namesAfterAllYes`: a `reveal` send implies that every going participant has status `yes`, and each of them answered a real yes. Broken by D1, D2.
- Terminal stability: `closed` and `done` never change stage.
- Liveness: given ticks, every `review` item leaves in the SLA; every `probing` item leaves within `max(PROBE_TTL, PROBE_WAIT)` per participant, times at most 4 replacements; every `scheduled` item leaves at `meetingAt + 3h`.

Interactions: drives 2, 3, 4, 5, 6, 10, 20, 22. `busy()` (`N:4368`) ties it to admission of other opportunities.

Concurrency and failure: all in one unit. A crash before `save` loses the unit and its sends together, given the `also` transaction (`S:263`). Expiry during processing: `advance` runs review expiry before anything else in the tick. `decide` does not check it (D11).

Quint notes: merge machines 1, 2, 3, 4, 5, 22 into one module. Variables: `stage: OppId -> Stage`, `status: (OppId, Member) -> PStatus`, `review`, `revealed: Set[(OppId, Member)]`. Bounds: 2 opportunities, 4 members (one minor, one alternate), 2 ticks of clock per TTL. Abstract time to named deadlines (`reviewDeadline`, `probeTtl`, `meetingAt`). Actions: `submit`, `approve`, `approveLate`, `reject`, `reroll`, `expireReview`, `probeSend`, `answerYes`, `answerNo`, `answerCounter`, `dropMember`, `block`, `meetingPassed`.

### 3.2 `opp-participant-status` P0

Kind: explicit. `PStatus` at `N:333`: `queued`, `probing`, `available`, `unavailable`, `yes`, `no`, `dropped`. Implied: not present (replaced or removed).

| From | Event | Guard | To | Line |
|---|---|---|---|---|
| - | `newOpp`, `submit`, `begin` | - | queued | N:2102, 2056, 2067 |
| queued, probing | primed, no time question | not contacted | available | N:2136 |
| queued | turn comes | first, or first is in | probing | N:2143 |
| probing | yes | status probing | available | N:2300 |
| available | yes, no pick, retry offered | fresh options | probing | N:2318 |
| probing | retry send refused | - | available | N:4073 |
| probing | no | - | unavailable | N:2334 |
| probing | expiry, not in retry | TTL or wait | unavailable | N:3382 |
| probing | expiry, in retry | - | available | N:3378 |
| probing | send refused, away | - | unavailable | N:4065, 2176 |
| available | reveal check fails | - | unavailable | N:2420 |
| any open | `dropMember` in probing | - | unavailable | N:2580 |
| available | reveal | all pass | yes | N:2439 |
| queued (plan) | plan answer yes | - | available | N:3014 |
| probing (plan) | plan answer no | not silent | no | N:3014 |
| probing (plan) | silent | - | unavailable | N:3014 |
| available (plan) | `planOut` | - | unavailable | N:3136 |
| available (plan) | bookPlan left out | conflict or check | unavailable | N:3046, 3056 |
| available (plan) | booked | - | yes | N:3073 |
| pending (plan, booked) | late yes | window | yes | N:3098 |
| yes (or any, D9) | `handleDrop` | - | dropped | N:2505 |
| any | replaced, removed | - | absent | N:2385, 2393, 2029 |

`no` is reachable for plans only (D13).

Invariants: `yes` implies `stage` in {scheduled, done}. `dropped` is final for that opportunity. `unavailable` never returns to an active status (no transition found). Also `available` with a non-empty `first` means the first member is in.

Stuck check: a member in `queued` with `first` not `available` waits on `first`, which has a TTL. In a group the path at `N:2392` removes `out` and returns with no `advanceProbes`; the next tick continues it. No stuck state found.

### 3.3 `review-item` P0

Kind: implicit. `Opp.review`: `decision` undefined, `approve`, `reject`, `expired`; `invalidated` set or not. Mirror: `network.review_items` with `CHECK (decision in ('approve','reject','expired'))` and a partial index on open items. Written on every save (`S:294`).

States: `waiting`, `waiting(rerolled n)`, `approved`, `approved-invalidated`, `rejected`, `expired`. Implied: `edited` is `approved` plus `edits`.

Transitions are in 3.1. Guards, in order: `not_in_review`, `unknown_decision`, `note_required`, `participant_declined`, `participant_minor`, `matching_paused`, `edit_leak`, `not_a_participant`, `nothing_to_edit`, then the gates.

Invariants:
- A decided item has `decidedAt`. `expired` has no reviewer.
- `approved` and not invalidated is the only way out toward members.
- Reroll keeps `stage == review`. It resets the deadline and it does not reset `queuedAt`. So staff can extend an item without limit.
- Reroll never swaps the requester or the seat manager (`N:2013`).
- Replacements after approval (`N:2375-2388`, plan `backfill`) add a person the reviewer saw only as an alternate. Their text is generated with no review; the leak guard still runs at send.

Failure: `approvalCheck` does not check `m.account`, `onlyWhenAsked`, `reportHeld` for non-engine origins. The first `syncMember` and the send-time check cover these. `dropMember` closes review items for a report (`N:1285`).

Quint: part of module 1. Add `approve` with a time guard variant so that the model finds D11.

### 3.4 `plan-run` P0

Kind: explicit, in the engine, driven by the Network. `PlanRun.stage`: `probing`, `booked`, `closed` (`E:544-600`). `answers[m]`: absent, `pending`, `yes`, `no`, `late`.

| From | Event | Guard | Action | To |
|---|---|---|---|---|
| probing | yes | yes count ≥ quorum | book | booked |
| probing | yes, partner plan | deadline ahead, bench left | probe_partner | probing |
| probing | no, first of partner | - | fallback | closed |
| probing | no | deadline ahead, bench left | backfill | probing |
| probing | no | no pending and quorum gone | fallback | closed |
| probing | deadline | `now >= probeDeadline` | fallback | closed |
| booked | yes | before `lateJoinHours` | join | booked |
| booked | yes | too late | answer `late` | booked |
| booked | no | - | none | booked |

Network side:
- `planProbe` gates: `planSeatOk`, in NYC, not busy, send window, no pending yes or no, one a day, allowance or budget, `buildPlanProbe` (`N:2966-2997`).
- `bookPlan` (`N:3041`): removes conflicts, seats members in yes order, then quorum check. Not enough: `closed`, or a second try through fallback. `fromFallback` stops recursion.
- Fallback (`N:3109`): `smaller`, `solo_event`, `next_week`, `none`.

Invariants: quorum yes before any name. `partner` plans never swap the first member. `planOut` keeps `answers` and `status` in step. A pair is never booked from a group (broken: D2). `answers[m] == "yes"` with `status == unavailable` is reachable (`N:3056`) and is harmless.

Interactions: D7, D8, D9. `busy()` does not count a plan yes-sayer (`N:4376`), so `syncMember` does not drop a yes-sayer who became a minor or paused (`N:4431`). `bookPlan`'s check covers this.

Quint: model alone first (`planRun.qnt`), bound 5 members, quorum 2 or 3, then add the seating step. Check `pairNeverBookedFromGroup`, `noNameBeforeQuorum`.

### 3.5 `booked-attendance` P1

Kind: implicit, per member, per opportunity.

States: `booked-untold` (status yes, not in `bookedTold`), `told` (`bookedAt` set), `confirmed-said`, `confirmed-silent`, `dropped`, `feedback-asked`, `answered` (`post[m]`), `finalized`. Opportunity flag `finalized`, `feedbackSent`.

Transitions: reveal send (`N:4077-4084`), confirm in words (`N:785`), confirm by silence 48 h or at start (`N:3392`), drop (`N:784`, `N:800`), reminder (`N:3397-3404`), feedback (`N:3405-3421`), answer (`N:2593`), finalize at all answered or +4 d (`N:3425-3427`).

Invariants: `plan_confirmed` once per pair (`N:2359`). `plan_accepted` once (`emit` key). `finalize` once. A reminder goes only with status `yes`. Only told members hear a change (`N:2516`).

Stuck: `going.every(p => o.post?.[p])` with `going` empty is vacuously true, and `finalize` exits. Fine.

`N:800` picks the first scheduled opportunity for a bare cancel. A manager with two intros cancels the older.

### 3.6 `member-request` P1

Kind: explicit. `Request.outcome`: undefined, `probing`, `booked`, `fulfilled`, `none`, `answered`. `closed`, `noCount`, `toldNone`, `toldRetryNone`, `lastTry`, `lastConfirmAt`. Mirror: `network.requests`.

| From | Event | Guard | To | Line |
|---|---|---|---|---|
| - | people ask | in scope | undefined | N:1607 |
| undefined | matching off | - | none | N:1636 |
| undefined | watch or busy | - | none | N:1617 |
| undefined | nobody fits | - | none | N:1643 |
| undefined, none | candidate found | - | probing | N:1684 |
| none | retry, daily | not closed, ≤7 d, 20 h since try, 72 h since confirm, eligible | probing | N:3693-3703 |
| probing | opportunity closes | - | none | N:2544-2554 |
| probing | reveal | - | booked | N:2442 |
| booked | attendance | requester and another present | fulfilled | N:2779 |
| any | second no from requester | - | `closed` flag | N:2332 |
| - | plans ask | - | answered | N:1793 |

Invariants: at most one `probing` request per (member, want) (`N:1587-1591`). `fulfilled` needs two present. Stuck: `booked` with a closed opportunity (D12).

Note: `closed` is set by the second no, but the `prior` query at `N:1587` still returns it, so a third ask within the re-search days goes to `tellNoneYet`, which is silent if `toldNone`.

Quint: model with machine 1 on one request.

### 3.7 `member-age-policy` P0

Kind: implicit. Flags: `age`, `statedAge`, `minor`, `minorSignal`, `ageUnknown`, `ageConflict`, `minorReported`.

Derived states: `adult`, `unknown` (minor=true, ageUnknown), `minor-stated`, `minor-signal`, `minor-reported`, `age-conflict`, `declined` (forgotten).

| Event | Guard | Effect | Line |
|---|---|---|---|
| member loaded | - | `minor = isMinor(record age)` | N:4448 |
| message, no known age | - | `ageUnknown = true` | N:709 |
| message, age resolves | no record, adult, no signal, no conflict, not reported | `minor = false` | N:713 |
| message, any | minor age or signal, not yet minor | `minor, minorSignal = true`, `minorAfterContact`, `dropMember` | N:717-728 |
| message, explicit under join age | record not adult | decline, `forget` | N:697 |
| message, under join age | not explicit, or adult record | `ageConflict` | N:701 |
| record age under 18 | - | `minor` (sticky) | N:4424 |
| report "minor" | not yet minor | `minor`, `minorSignal`, `minorReported`, drop | N:1550 |
| staff clear | record ≥ 18, stated ≥ 18 | all flags off | N:1565 |

`statedAge` only goes down (`N:688`), matching "lowest age wins". `withUnderstanding` can only lower it (`N:653`).

Invariants (AGENTS.md founder decision 1, core `policy.ts`):
- `minor == false` implies a valid age ≥ 18 is known. The member-loaded branch fails closed.
- `minor` true means no status in an open opportunity.
- `isMinor(Infinity)` is true by `validAge`, so `N:716` with no ages is safe.
- Staff clear never lowers safety when any age is under 18.

Check: `age` updates from the record can raise `m.age` (`N:4423`), but `minor` stays sticky. Good. `packInput` excludes all doubtful flags (`N:3746`). `gateReason` for ntwrk relies on `eligible`, which reads `m.minor`.

Failure: `minorAfterContact` relies on `contacted` (D6).

Quint: a small standalone module. State is a record of flags. Actions: `recordAge(n)`, `statesAge(n, explicit)`, `signal`, `reported`, `clear`. Check `neverAdultWithLowerAge`, and `matchable` implies `min(ages) >= 18`.

### 3.8 `member-onboarding-stage` P2

Kind: explicit. `new`, `age`, `q1`, `q2`, `q3`, `active`. `N:243`.

Transitions: `welcome` (`N:976-990`): `age`, `active` (minor) or `q1`. `afterAgeQuestion` (`N:1005`): `active` or `q1`. `onInterviewAnswer`: `q1 → q2 → q3 → active`, or `q1 → active` with app onboarding (`N:1085`). Stall: `N:831-832`.

Unreachable events: a member who becomes adult after `active` never gets the interview or `member_activated` (`N:2701` needs a later `activate`, and nothing calls it from `active`). The member still matches, subject to `thin_profile`.

### 3.9 `member-opt-out-and-forget` P0

Kind: implicit. `optedOut: bool`, `declinedIds`.

| From | Event | Effect | To | Line |
|---|---|---|---|---|
| in | STOP (keyword) | `dropMember` | out | N:675 |
| out | START | welcome back | in | N:676 |
| any | leave, delete, under age | `forget` | gone | N:4819, 905 |
| gone | any inbound | ignored | gone | N:596 |

The parser is the service's: `parseOptOut` is on the inbound path there. The Network sees only `keyword`. `syncRecord` does not read `opted_out` from the member record, so the Network's flag can lag the ledger. Send checks in the service queue cover this (`service-platform.test.ts` SVC-07).

Invariants (AGENTS.md 7): `optedOut` implies no send except a system confirmation; `checkRecipient` is first in `send` and runs again at each deferred send. After `forget`, only the id stays: `N:912-967`. `reports` keep the subject id on purpose (`N:945`).

Note: STOP runs `heardFrom` first (`N:615`), so a member on `onlyWhenAsked` who opts out and returns starts clean.

Concurrency: the service's turn order (STOP ahead of a failing row) is tested in `inbox-order.integration.test.ts`. In the Network STOP is a plain unit under the lock. `service.ts` holds the consent ledger; out of my scope.

Quint: merge with machine 12 as `canSend(member, kind)`. Check `stopWins`: no action after STOP adds a member-visible send for that member.

### 3.10 `awaiting-slot` P0

Kind: explicit, one slot per member. `kind`: `probe`, `booked`, `feedback`, `growth`, `interview`, `age`, `checkin`, `crew`, `posting`, or empty. `clarified` is a sub-flag. `N:278`.

Priority rule in `expect` (`N:4136`): a pending `probe` or `booked` survives feedback, growth, interview, checkin, crew.

| Writer | Respects priority | Line |
|---|---|---|
| probe sent | no | N:4055 |
| plan probe sent | no | N:4093 |
| time retry | no | N:4071 |
| booked (reveal) | yes (it is a priority kind, so it replaces) | N:4079 |
| interview, age hooks | no | N:4047-4048 |
| posting | no | N:4636 |
| feedback, growth, crew, checkin, ask | yes | N:4103-4123 |

Clearers: the answer itself, `close` for current participants, `handleDrop` for the dropping member only, plan and probe expiry, tick: `booked` at 48 h or the meeting, others at 3 days, **`probe` never** (`N:3285`).

Routing order in `handleInbound`: age, STOP or keywords, block or report, pending who, hold, abuse, **posting**, probes, opt-ins, crew, booked, check-in, cancel, feedback, interview, growth.

Invariants wanted:
- `slotOwnerAlive`: `awaiting.kind == probe` implies the opportunity is open and `status[m] == probing` or the plan answer is pending. Broken: D10.
- `noLostAnswer`: while `status[m] == probing` and the probe went out, `awaiting` points at that opportunity. Broken: D5.
- A consent reply is routed only by the slot, so the slot is consent state.

Quint: this is the best value target with machine 2. Model one member, two opportunities (one probe, one booked), one posting. Check the two invariants above.

### 3.11 `outreach-attention` P1

Kind: implicit. Per member: `proactive[]`, `planInvites[]`, `pendingAsks[]`, `unanswered`, `onlyWhenAsked`, `reengaged`, `outbound`, `openAskAt`, `unsol{lane: times}`, `unsolStreak`, `lastOutUnsol`, `askAt`, `askUsed`, `heldHighAt`.

Derived states: `open`, `ask-open` (72 h, 24 h for a probe), `streak-1`, `streak-2`, `only-when-asked`, `reengaged-once`.

| Event | Effect | Line |
|---|---|---|
| proactive send | `proactive` or `planInvites`, `pendingAsks`, `lastAskAt` | N:3938 |
| ask send | `openAskAt` | N:3939 |
| any send | `outbound++` | N:3947 |
| unsolicited send | `unsol`, `unsolStreak++`, pause path text | N:3940-3944 |
| follow-up send | `askUsed++` | N:3945 |
| tick | `unanswered`, then `onlyWhenAsked` at 2 | N:3324 |
| inbound | all reset | N:639 |
| re-engagement | one, at 30 days and a held top-quartile item | N:3333 |

Budgets: `O:18-20` (invites per state), `O:96-98` (PRD), `O:106` (lanes). The person cap of 3 a day across apps is in the service, not here.

Invariants (PRD 32.9, 40.3, AGENTS.md 7): `count(proactive in window) <= budget`. `unsolStreak <= 3`. Under `onlyWhenAsked` no proactive send but the one re-engagement. Every unsolicited send has a pause path (`N:3941`). A `state` budget of 0 means no lane sends. `withPausePath` runs after the leak guard, on fixed text.

D15 and D22 apply. `probe` over budget closes rather than waits: `refuse` then `onRefused`.

Quint: model counters abstractly with a sliding window of size 2 or 3 in discrete days. Keep it alone. Merge only the `canSend` result into 3.12.

### 3.12 `send-pipeline-and-deferred` P0

Kind: implicit. Each `send` is a small state machine, and `deferred` is an outbox inside the state document.

Steps (`N:3862-3954`): recipient check, budget, one question, streak, timing (defer or `noDefer`), fold ack and note, unsolicited check, leak guard (fallback or refuse), duplicate, record, `ctx.send`, `onSent`.

Result: `sent`, `deferred`, `refused`. States of a deferred item: `waiting`, `sent`, `dropped(invalid)`, `dropped(refused)`.

Tick (`N:3269-3277`): for each item, member gone: drop. `valid()` false: drop, with no `onRefused`. Timing not ok: keep. Else `send` runs every check again.

`SendHook` is data so it survives a restart (`N:412-417`).

Invariants (AGENTS.md):
- Every outbound goes through `guardCheck`. `ctx.send` has one call site (`N:3948`).
- A deferred body is checked again at its real send.
- `valid()` is not checked on the first `send`. The caller must be right.
- Duplicate skip never drops a state-changing send (`N:3930`).

Crash: the `ctx.send` call only collects into the unit (service). So state and message commit together (`S:263`). Sim: direct.

Interaction with `relay-number-swap`: a deferred relay has no hook, so nothing reports a later refusal (D3). Deferred `reveal` going invalid: D19.

### 3.13 `trust-level` P0

Kind: explicit. `ok`, `watch`, `hold`. Score thresholds 3 and 6 (`T:27`).

| From | Event | Guard | To | Line |
|---|---|---|---|---|
| ok, watch | `add` | score ≥ 6 | hold | T:139, 142 |
| ok | `add` | 3 ≤ score < 6 | watch | T:139 |
| watch | `decay` | score < 3 | ok | T:131-132 |
| hold | `decay` | - | hold | T:130 |
| hold | staff `lift` | - | ok, score 0, reports cleared | T:60 |
| any | `forget` | - | absent | T:48 |

`hold` is absorbing without staff (`T:139`).

Entry rules: `handleAbuse` (`N:1138`) caps a clean member at 5, so one message stops at watch. `report()` needs credible reporter, `met`, new reporter, and a second reporter or `score > 0` (`T:112-120`). `block()`: three strangers in 14 days, +2 once per reach of exactly 3 (`T:98-105`). `staff_hold`: raises to `HOLD` (`N:1319`). `invitee_held`: +1 on the inviter (`N:1202`), which can cascade up an invite chain.

Effects (`N:1188`): any non-ok: `dropMember`. Hold: open case, notice, inviter penalty.

Invariants: a clean member never reaches hold on one message (network-consent-8). One reporter never holds a clean member. `level == hold` implies `heldAt` set. Events add up to the score: true only for points events; `decay` changes the score with no event, and the comment at `T:57` claims "the events still add up", which fails after any decay.

Defects: D14. Also the `met` input is D6.

Quint: standalone, small. Score as int 0..7. Check `noSingleMessageHold`, `holdOnlyLiftedByStaff`, and the decay bound with a real clock to find D14.

### 3.14 `safety-case` P1

Kind: explicit. `open`, `held`, `lifted`, `closed`. `N:112`.

| From | Event | To | Line |
|---|---|---|---|
| - | first event | open | N:1211 |
| open | reach hold | held | N:1195 |
| lifted | new event not `hold_lifted` | open | N:1212 |
| held | staff lift | lifted | N:1248 |
| open, held, lifted | staff close | closed | N:1259 |
| closed | new event | a new case | N:1211 |

At most one non-closed case per member, by `openCase`. A closed case with the member still on hold is a confirmed hold; a new event then opens a case with status `open` while the level is `hold`, so `status` and `level` disagree. `liftHold` still works. `closeCase` emits `abuse_confirmed` and `member_removed` per case, so two closed cases give two ledger events with different keys.

### 3.15 `safety-report` P0

Kind: explicit. `open`, `held`, `banned`, `dismissed`. `reports.ts:8`.

| From | Event | To | Line |
|---|---|---|---|
| - | `fileReport` | open | N:1281 |
| open | staff hold | held | N:1353 |
| open, held | ban | banned | N:1355 |
| open | dismiss | dismissed | N:1346 |

Effect: an open, `met`, urgent report takes the subject out of matching (`reportHeld`, `N:1295`) through `eligible` and `engineInput` holds. `held` and `dismissed` end that effect. So `holdMember` with `reportId` leaves other open reports in force. After `liftHold`, an open urgent report still keeps the member out, which is correct but is a second step for staff. `held` cannot be dismissed (`already_held`). After a lift it stays `held` for good. Terminal in practice.

`met` is the entry guard: D6.

Quint: merge with 13 and 14 as a `safety.qnt` module. Check `urgentMetReportBlocksMatching` and `lowLevelReportNeverHolds`.

### 3.16 `pending-safety-who` P1

Kind: implicit. `MemberState.pendingSafety { verb, kind, at }`. `none → waiting → none`.

Set at `N:1412`. Cleared on entry at `N:1408`, and `N:1530`. A day limit (`N:1531`). If a pending probe, booked or crew is waiting, a short answer goes there and the question is dropped (`N:1537`). No text is stored. Only counterparts may resolve (`N:1534`). Answers can come only from the member's own text (`!mcp`, `N:745`).

### 3.17 `pair-relations` P0

Kind: implicit sets. `blocks` (with the snapshot's `blocked` edges), `avoid`, `declined` (timestamp), `again`, `planAgain`.

`block` is one way and permanent here: there is no unblock. It is also added by a slop check-in report (`N:2612`). `avoid` on negative feedback, permanent. `declined` for 30 or 60 days. `again` needs both sides, and is consumed in `localEncounters` (`N:3816`), even when members are not eligible at that moment, so a good pair loses the second encounter.

Invariant: no opportunity is proposed with a blocked pair, at composition, approval and every send. Blocks are read from the cached snapshot (`N:4387`), so a block made on another app can be 20 minutes late for `blocked()` unless `dirty` is set. `onInbound` sets it. A tick does not.

D16 applies.

### 3.18 `relay-held-item` P0

Kind: explicit. `RelayRecord.decision` (`pass`, `hold`, `block`) and `RelayHeld.status` (`held`, `released`, `rejected`). Mirror: `network.relay_records`, `network.relay_threads` (migration 0026), written in the save transaction (`S:175`).

| From | Event | Guard | To | Line |
|---|---|---|---|---|
| - | request, engine `pass` | send not refused | pass | R:246 |
| - | request, `pass`, send refused | - | block + `send:refused` | R:253 |
| - | request, `hold`, rate only | - | hold, not queued | R:238 |
| - | request, `hold` | - | held, text kept unless age signal | R:239 |
| - | request, `block` | - | block, no text | R:234 |
| held | staff release, engine not `block` | - | released, delivered | R:347-365 |
| held | staff release, no match or no text | - | released, not delivered | R:355 |
| held | staff reject | - | rejected, text gone | R:369 |
| held | `forget` of either | - | rejected by `system:forget` | R:399 |

Restart: `loadRelayRows` restores log and held rows with no text (`S:194`). A release then delivers nothing.

Invariants (AGENTS.md "Relay"): only the engine's `rendered` goes out. No body in the log. A minor's words are never stored or shown (`R:242`, `N:4799`). Release checks again. Idempotent on `itemId` (`R:179`, `prior`).

Weak points: a release after the send is refused leaves the status `released` with no retry, and the log still says `hold`. `contact_share` holds can only end undelivered.

Concurrency: `request` awaits the classifier inside `unitOfWork`, under the lock. So no interleave, at the cost of holding the network lock for the classifier call.

### 3.19 `relay-number-swap` P0

Kind: implicit handshake between two members with a TTL. `RelaySwap`. `R:269-305`.

States: `none`, `waiting(A)`, `consumed`, `a-sent/b-sent`, `a-deferred/...`. Implied: `expired` (filtered at next swap).

| From | Event | Guard | To |
|---|---|---|---|
| none | A asks | engine pass on A's share, value known | waiting(A), ask to B |
| waiting(A) | A asks again | - | waiting(A) (`swapAlready`) |
| waiting(A) | TTL | filtered on next swap | none |
| waiting(A) | A withdraws | `cancelSwaps` | none |
| waiting(A) | B asks | both pass | both sends |
| waiting(A) | B asks | one not pass | none, logged |

Invariants (founder decision 9, `R:15-17`):
- `numberMovesOnlyIfBothConsented`.
- `noOneWayNumber`: after the handshake both numbers delivered, or neither. Broken: D3.
- Consent is never backdated (`R:290`).
- Consent is at most 15 minutes old **at delivery**. The engine checks it at decision. A deferred share can land 10 hours later. Broken by D3.

Failure: `theirs` is removed before the awaits (`R:289`). On a throw the unit does not save, so that is safe.

Quint: small standalone module. Variables: `swap`, `delivered: (from,to) -> Bool`, `queue` for deferred, `blocked`, `quiet: Member -> Bool`. Actions: `ask`, `withdraw`, `tick`, `block`, `timePass`. It will find D3 at depth about 5.

### 3.20 `relay-match-view` P0

Kind: implicit, derived. `relayMatchOf` (`N:4895`): `mutual` for `scheduled` or `done`, `cancelled` for closed from scheduled, else `closed`, or `probing`. `matchFor` needs `mutual` and both in `acceptedBy`. Founder decision 2026-10-11: the thread stays open after the date.

Final check: `relayDispatchCheck` (`N:4912`) on the newest state at queue admission. It checks the pair, the match, age, opt-out, hold and `blocks`. It reads Network blocks only; the runtime adds the canonical checks.

Invariant: a relay needs a current mutual pair. Watch is not in `held`, but `checkRecipient` refuses it (`N:4227-4234`), so the item is `undelivered`.

### 3.21 `job-posting` P1

Kind: explicit plus draft. Posting: `active`, `closed` (`closedReason`). Stored as rows by the service (`onPosting`), and read back from the snapshot. Draft in `MemberState.posting`, `ready`, `asks`.

Draft: `none → collecting → ready → none`. Yes saves (`N:4616`). No, with no digits, drops (`N:4625`). A correction stays. Two questions without a field drop it (`N:4634`). Unrelated text drops it (`N:4628`).

Guards: `managerProblem` (`N:4497`) on start and on save. Close always works.

Defects: D4, D5, D23. An expired `awaiting` (3 days) leaves `m.posting` behind; harmless, since `waiting` needs the slot.

### 3.22 `job-seat-item` P1

Kind: implicit, on `Opp.seat`. Candidate first, then the manager, then the intro. `seatRoute` maps a seat proposal to the manager (`N:4468`). `checkSeats` at each tick ends non-booked items when the posting closed or filled (`N:4543`). A missing `:openings` facet reads as 0, so `filled.size >= 0` ends the item; the snapshot always writes it (`seats.ts:82`).

Invariants: no manager, no proposal. The manager is never swapped (`N:2013`, `N:2372`). Filled count is a count of distinct candidates with `meetingAt` and not closed.

TOCTOU: between ticks two manager yeses can pass `reveal` beyond the openings. `reveal` has no seat check. Low.

Interaction: manager is exempt from `busy`. That is the cause of D5 for managers.

### 3.23 `crew-offer-and-crew` P2

`CrewOffer`: `open`, `resolved`. Resolve: all answered (`N:3199`), or 3 days at the daily plans step (`N:3221`). Crew: `formed`, `handedOff` after N sessions. Session: a plan through review. D17 applies. `crewSessions` runs only when plans are on, so offers stay open while matching is off.

### 3.24 `fraud-item` P2

`review → confirmed | dismissed | expired`. 14-day deadline and dedupe (`N:2813-2818`). The expiry runs once a day. Approve emits `fraud_confirmed`. Nobody is messaged. It shares `decide()` with opportunities through the id prefix. The simulated reviewer never decides it (`N:1851`).

### 3.25 `store-unit-of-work` P0

Kind: implicit. Per network: `free`, `held(process)`. In process, `Queue` (`S:23-34`).

Sequence (`stored`, `S:53-59`): take lock, load, `importState`, run, `exportState`, save with `also`, release.

- `withTickLock`: try lock, returns undefined when busy. `withLock`: waits.
- `load` also heals the relay log from rows (`S:194`).
- `save` in one transaction: delete rows of gone ids, rewrite participations, upsert state, console rows, relay rows, then `also`.

Failure:
- A throw in `fn`: no save. The next `stored` reloads. In-memory mutation is thrown away at that point. Between the two, `reviewQueue` and `readState` also reload.
- Crash after `pg_advisory_lock`: session ends, lock is free, nothing saved.
- Reserved connection loss in `fn`: D20.
- The engine run with a judge LLM runs in `tick` under the lock, so inbound STOP waits. `withLock` has no timeout here. The service's turn path has its own lease and `turn_busy`.
- State size: `opps`, `interactions`, `feedback`, `asks`, `deferred` have no pruning, so each unit writes a growing JSON document and `delete from participations` for all opportunities (`S:277-278`).
- `version` is the format version, not a sequence number. There is no compare-and-swap.

Invariants: `atMostOneUnit`. `noLostWrite`: every saved state descends from the last saved state. `sendsCommitWithState`.

Quint: model two processes, an abstract lock with a `lostConnection` action, `load`, `save`. Check `noLostStop`. Include a fencing variant to show the fix space. Keep it separate.

### 3.26 `daily-gates-and-switches` P1

`lastRunDay`: set before the run (`N:3290`), so a thrown engine run does not repeat in that process, but the unit is not saved, so the next tick repeats it. That is the wanted behavior. `lastPlanRunDay`: same, with the fix-up at `N:3301`. `matchingEnabled`: stored in state (`N:4689`). Off: no run, approve refused (`N:1953`), probes that are approved continue. `opts.review`: never in state.

The window: from `runHour` to 20:00 New York. If no tick runs in that window, the day is skipped, and so is `trust.decay` (it catches up by steps) and `queueFraudFlags`.

### 3.27 `ledger-emitter` P2

`emit` builds `<type>:<key>` ids (`N:2682`). Idempotency depends on stable keys. `safety_flag` and `state_changed` use the clock in the key, so a replay with a different clock adds a row. `member_joined` and `member_activated` are guarded by flags. Time order: `capitalWiring` counts rejects (`capital.ts:57`).

---

## 4. Cross-machine view

```
member text --> awaiting-slot --> participant status --> opportunity stage --> relay match
                     |                                        |
                     v                                        v
               outreach attention <--- send pipeline ---> deferred outbox --> service queue
                                            ^
trust level --> dropMember -----------------+
reports ------> dropMember
age policy ---> dropMember
opt-out ------> dropMember
```

`dropMember` (`N:2564`) is the hub. Every safety machine enters the consent machines through it. It has one branch per stage, and D9, D10 both live there. A Quint model of `dropMember` with each trigger as an action covers most P0 properties.

Things that cross a process boundary:
- Inbound keywords: parsed in the service, seen here as `keyword`.
- `ctx.send`: collected and committed in the unit; delivery is the service's outbox.
- Snapshot: read on demand, cached 20 minutes unless `dirty`.
- `onAgeStated`, `onPosting`, `onLedger`: callbacks inside the unit.
- Staff actions: `staffAction` calls `unitOfWork`.

## 5. Suggested Quint order

1. `consent.qnt`: machines 1, 2, 3, 10, with `answerCounter` and `dropMember`. Finds D1, D5, D9, D10, D11.
2. `planRun.qnt`: machine 4 with seating. Finds D2, D7, D8.
3. `relaySwap.qnt`: machine 19 with quiet hours. Finds D3.
4. `safety.qnt`: machines 13, 14, 15, 7. Finds D6 (with `met` as a derived value), D14.
5. `store.qnt`: machine 25. Finds D20.

Bounds that should be enough: 4 members, 2 opportunities, time abstracted to named events.
