# Quint findings: outbound_queue

Model: [quint/outbound_queue.qnt](../../../quint/outbound_queue.qnt). Plan: section 6.5 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Source reports:
[network-service-outbound.md](../state-machines/network-service-outbound.md) sections 1-3 and
[blooio-notify.md](../state-machines/blooio-notify.md).

This file is hand-written. The traces are the output of `quint run` and `quint test` on the model, shortened by hand.

## 0. Final state (after the fix wave on branch wave2/outbound_queue)

The model now follows the code after the fix commits 6cc9d1b .. 1e3585b. Sections 1-6 below are the first state
of the model (commit ad67275, before the fixes); they stay as the record of what the model found.

### 0.1 Check results (fixed code)

| Check | Bounds | Result |
|---|---|---|
| `quint typecheck` | - | ok |
| `quint test` | 33 run tests, seed 0x5eed (28 before section 0.6) | 33 passing |
| `safety` (simulation) | seed 0x5eed, 40 steps, 8000 samples | no violation |
| 7 witnesses (6 before section 0.6) | same bounds | all reachable |
| `quint verify --invariant safety` (Apalache) | `--max-steps 3` (the file's `verify-steps`) | no violation (about 60 s) |
| `quint verify --invariant safety` (Apalache) | `--max-steps 4` (run by hand) | no violation (277 s) |

Commands: `bun run quint:check quint/outbound_queue.qnt` and `bun run quint:check --verify quint/outbound_queue.qnt`.
The 4-step Apalache run took 277 s on a shared machine, so the file keeps `verify-steps=3`. A send needs at least 7
steps (enqueue, drainStart, sweepCollected, lockLine, decide, applyDecision, providerCall), so for the send-path
invariants the evidence is the simulation and the run tests, not Apalache.

Each invariant was also simulated alone (seed 0x5eed, 40 steps, 8000 samples): every invariant in `safety` holds.
Two values are kept out of `safety` and still fail; each has a comment in the model:

| Value | Simulation alone | Why it is not in `safety` |
|---|---|---|
| `noStatusRegress` | violated | SD-099: register verdict "refuted", no fix. `noStatusRegressLive` (every row that is not a row of a forgotten member) is in `safety`. Run test `sd099WaitOverErasureTest`. |
| `mirrorSettles` | violated | New defects Q-outbound_queue-3 and Q-outbound_queue-4 (section 0.4). `mirrorNotStuckWaiting` (the part that the SD-136 and SD-336 fixes give) is in `safety`. Run tests `q3StaleStoreTest`, `q4SweepLostTest`. |

### 0.2 Model changes for each fix

| Defect | Commit | Model change | Run test(s) (fixed trace) |
|---|---|---|---|
| SD-020 | 6cc9d1b | Each view carries the stored state version (`ver`); `holdToggle` and `closeItem` save a new version. `drainStart` of a runtime drain needs a current view; the admission transaction returns `stale_view` (row left as it is) when the version moved. | `sd020StaleReplicaTest`, `sd020HoldDuringDispatchTest` |
| SD-090 | a8e4b55 | `ttlSelect` counts the TTL from `nextAt` (when acceptance became unknown). `failed_unknown` left `NOT_SENT`: it keeps its cap slot. | `sd090UnknownTtlTest`, `sd090TtlKeepsSlotTest` |
| SD-091 | 0a787a8 | `acceptedRow`: under Cloud a non-member row loses text and address at acceptance (respond and lookup). | `sd091NonMemberBodyTest` |
| SD-094 | 9e763d7 | Gate 7 (line safety) skips compliance rows. | `sd094ComplianceHeldTest` |
| SD-100 | b6ea5e1 | New action `sweepCollected` in reconcileUnknown (every transport): collected and send_unknown rows older than the TTL end `failed_unknown`. `lockLine` comes after it. `collectedResolvable` now says no such row is older than the TTL at the last sweep. | `sd100CollectedStuckTest`, `sd100SendUnknownTest` |
| SD-101 | ca25f43 | `collect` with a failed guard writes the row `parked_leak_review` at once. `guardFailedReachesStaff` now says such a row is parked until staff decide. | `sd101GuardFailedReplyTest` |
| SD-117 | 2d901dd | `dispatchErr`: a database error in dispatch adds one attempt and waits `retry_scheduled`; it parks the row `parked_error` only when the attempts are used up. | `sd117TransientParksTest`, `sd117RepeatedErrorParksTest` |
| SD-120 | 016eeed | None: the leak guard is an oracle in the model (quint/README.md rule 7). The corpus rows in evals/guard/leaks.jsonl test the reader. | - |
| SD-131 | bdd0698 | `turnStart(acct)`; a collected row records `acctFree`. A no-history accepted receipt is refused only for an account-eligible turn. New invariant `noHistoryReceiptRecorded`. | `sd131NoHistoryReceiptTest` |
| SD-132 | 5a6cf8e | A drain decides only the rows of its own network (`row.net == wk.net`); `enqueue` takes any network. | `sd132ForeignNetworkTest` |
| SD-136 | eb5a589 | `flush` stores the changes of a direct() drain too. | `sd136DirectDropsTest` |
| SD-147 | dde38c4 | `holdAct` (hold()): when the person wrote after dispatch read the conversation, the row goes back to `pending`. Used for the unanswered cap and for `await_recipient`. | `sd147LostWakeupTest` |
| SD-148 | cdd106f | An accepted gateway receipt runs `convAfterAccept` (countSend). | `sd148CollectedNotCountedTest` |
| SD-299 | 8495b7a | A throwing stale hook gives decision `dispatch_error` (drain()'s catch), not "current". | `sd299StaleFailsOpenTest` |
| SD-300 | 66f1601 | `hookWrite` is conditional on the status it read; a miss reads again and decides on the current status. | `sd300ReceiptRegressTest` |
| SD-316 | eb0a9c4 | None: the text of collected replies lives in `platform.inbound` (turn_consent model). This model already drops an unresolved turn's receipt path (`turnFinish(false)`). | - |
| SD-334 | 255a42d | A missed accept commit (respond and lookup) reports the stored status, not `dropped_forgotten`. | `sd334LostRaceTest` |
| SD-336 | efb98a0 | After a runtime drain, `flush` copies the row status to each message that still shows a waiting status. Ghost `lost` marks a change a crash discarded. | `sd336CrashLosesStatusTest` |
| SD-337 | aba939e | A send receipt with status failed writes no `sent_at`. | `sd337FailedSetsSentAtTest` |
| Q-outbound_queue-1 | 1f86525 | Admission reads the consent ledger for every non-compliance row. | `q1NonMemberStopTest` |
| Q-outbound_queue-2 | 1e3585b | A failed accept commit waits `unknown_acceptance` (keeps its slot); the lookup resolves it. | `q2AcceptDbErrorTest` |

Not fixed (the fix wave skipped them):

- **SD-257** skipped: needs a founder decision (what failure text the member gets). The model has no member view of
  failures; no invariant depends on it.
- **SD-304** skipped: needs a maintainer or founder decision (a per-app leave cannot tell which earlier inbox rows
  are its app's). It lives in `platform.inbound` (turn_consent model); this model does not contain it.
- **SD-099** (not in the fix wave; register verdict "refuted"): still reachable; see 0.1.

### 0.3 Other model changes

- The random walk: with no drain in progress, half of the steps now start a drain, add a row or let time pass;
  `holdToggle` and `closeItem` come in an eighth of the draws. These change weights only (each action is still in
  `worldSteps`). Without them, after the SD-020 fence two witnesses were not reached in 8000 samples: before the
  fix the walk reached them through the stale-view defect itself.
- `notSentMeansNotOut` leaves out a row that `recover()` put back to `retry_scheduled` in webhook mode (ghost
  `resent`). With no receipt provider there is no lookup: the code marks the row `in_doubt` and sends it again with
  the same provider key, and a later gate (a STOP, a repeated database error) can end it with a NOT_SENT status
  although the stopped call went out. The first model reached this trace too but did not report it, because SD-090
  failed first. Webhook mode runs only in development; production (Cloud) has the lookup and is checked in full.

### 0.4 New defects found on the fixed code (not fixed in this step)

**Q-outbound_queue-3: storeStatuses overwrites a newer message status with a drain's older one.**
`NetworkRuntime.storeStatuses` writes each change of a drain with no condition (runtime.ts storeStatuses). A staff
leak-review decision (service.ts `/queue/leak-review`: decideLeak, then storeStatuses) or a Blooio delivery receipt
that commits between the queue commit and the drain's store is overwritten. Trace (`q3StaleStoreTest`): a drain parks
r1 (`parked_leak_review`); staff drop r1 (row and message `dropped_leak_review`); the drain stores
`parked_leak_review`. The SD-336 repair does not fix it (it reads only waiting statuses). Effect: the message status
is wrong; both statuses are "not sent", so no text goes out and no cap changes.

**Q-outbound_queue-4: the SD-336 repair does not cover the SD-100 sweep.** The repair in `drainQueue` copies the
queue status only to messages in `WAITING_STATUSES`. A collected reply's message has status `collected`. When the
process stops after the sweep commit and before storeStatuses, the message keeps `collected` for good
(`q4SweepLostTest`). Fix direction: include `collected` and `send_unknown` in the repair's message statuses.

Both need a code fix with an integration test that fails before it; that is outside this modeling step.

Q-outbound_queue-3 is fixed since 2026-11-09 (section 0.6). Q-outbound_queue-4 is still open.

### 0.6 Review fix: `noClaimAfterStop` reads the consent ledger (2026-11-09)

A review found that `noClaimAfterStop` restated the admission guard: the ghost and the guard both read one
boolean `env.optedOut`, so a wrong reading of consent could not be seen. Changes:

- `env.ledger` holds the consent events of the recipient's number (`platform.consent_events`): scope "all"
  (STOP, START on the shared line), "app" (leave, START on the app's line, a join) or "other" (another app),
  state opted_out or opted_in, up to 3 events. The action `consentEvent(scope, state)` adds one; `stop` is
  `consentEvent("all", "opted_out")`.
- The gate and the admission transaction read the code's guard `codeOptedOut`: `lastEvents` and
  `resolveConsent` (`packages/platform/src/consent.ts:39-56`), as `consentRefused` runs them.
- The ghost "afterStop" reads the rule `stoppedByRule`, written over the whole ledger: an opt-out that covers the
  app and that no later opt-in answers (an app opt-in answers every earlier opt-out; a STOP-wide opt-in answers
  only STOP-wide opt-outs).
- Run tests: `consentGuardMatchesRuleTest` (the guard and the rule agree on all 259 ledgers of up to 3 events),
  `leaveDuringDispatchTest`. Witness: `witness_leaveRefuses`.

Mutations (temporary, on a copy; seed 0x5eed, 40 steps, 8000 samples):

| Mutation | Result |
|---|---|
| the admission recheck only for member rows (the Q-outbound_queue-1 defect) | `q1NonMemberStopTest` and `leaveDuringDispatchTest` fail in `quint:check`. The simulation found it with the first weights (a consent event in half the draws); with the final weights (a quarter) it did not in 3 seeds. |
| `codeOptedOut` ignores the STOP-wide event when the app has none | `noClaimAfterStop` violated in simulation (a STOP, then a claim); `consentGuardMatchesRuleTest` fails. The old model could not express this mutation. |

With the code's input the rule holds: no code defect in the consent path.

The consent events changed the random walk. With the same seed the simulator then found two traces that were
in the state space before (no opt-out is in either trace, so the earlier passes were sampling luck):

1. **Q-outbound_queue-3 with a release (fixed).** A drain parks r1 and has not stored its changes; staff release
   r1; the release's delivery sends it (message "accepted"); then the first drain stores "parked_leak_review".
   `mirrorNotSentMeansNotOut` failed: the message says parked for a text Cloud took, and the SD-336 repair does
   not read it (not a waiting status). So section 0.4 understated Q-outbound_queue-3: a text can go out.
   Fix: `NetworkRuntime.storeStatuses` writes the queue row's status read in the same statement
   (`coalesce((select status from platform.outbound ...), change)`); every writer stores after its own queue
   commit, so the last write has the newest row. Test: `packages/network/test/cloud-outbound.integration.test.ts`
   "a drain's late status store never makes a released, sent reply look parked" (failed before the fix: received
   "parked_leak_review"). Model: `flush` writes the row's status; run tests `q3StaleStoreTest` (now fixed) and
   `q3ReleaseSentTest`; both fail with the old `flush`. `mirrorSettles` stays out of `safety` for Q-outbound_queue-4.
2. **Q-outbound_queue-5 (open, not fixed).** `unansweredAtMost` fails in two shapes: the gateway sends a collected
   reply of an earlier turn after the person wrote again and a queue reply went out
   (`q5LateTurnReplyTest`); and a text with an unknown acceptance does not count in the line conversation, so the
   next text to the same address passes the cap gate (`q5UnknownNotCountedTest`). The rule does not say whether a
   late answer counts as unanswered, or whether an unknown acceptance holds a streak slot; this needs a maintainer
   decision. `unansweredAtMost` is now a named value outside `safety` with these two run tests (it was in `safety`
   only because the walk did not reach these traces).

## 1. What the model contains (first state, commit ad67275)

- State: the queue rows (`platform.outbound`: status, kind, member or not, lease, attempts, `person_cap`, text kept or
  cleared, `sent_at`, `leak_released_by`, `in_doubt`), the workers (one per replica or runtime) with their in-memory
  list of status changes, the line conversation (`platform.line_conversations`), the line lock holder, the person cap
  slots (`platform.person_sends`), the provider's admitted ids, the message status mirror (`network.messages.status`),
  each replica's in-memory view of holds and closed items, and two Blooio receipt handlers.
- One action for each transaction or remote call: `enqueue`, `drainStart` (recover), `ttlSelect` and `ttlEnd`
  (reconcileUnknown's TTL), `lookupCall` and `lookupApply` (receipt lookup), `lockLine`, `decide` (gates 0-10 read at
  one instant, and the cap slot), `applyDecision` (the wait or end, or the admission transaction), `providerCall`,
  `respond` (the accept commit or the failure write), `unlockLine`, `flush` (storeStatuses), `crash`, `project` (the
  notify projection repair), `turnStart`, `engaged`, `collect`, `turnFinish`, `gatewaySend`, `gatewayReceipt`, `stop`,
  `holdToggle`, `closeItem`, `refresh`, `erase`, `setSafety`, `staffRelease`, `staffDrop`, `hookRead`, `hookWrite`,
  `tick`.
- Oracles (parameters chosen by `step`): the leak guard (fixed per text), quiet hours, a stale-hook error, a database
  error, Cloud's answer, the receipt lookup answer, the gateway's receipt.
- Two transports: `cloud` (production: Cloud deliver and receipt lookup, no Blooio webhook reaches the service) and
  `blooio` (webhook mode: delivery receipts and line safety events arrive).
- Scaled bounds: the person cap 3 is 1, the unanswered cap 3 is 1, `maxAttempts` 6 is 2. Time thresholds are the
  code's values (one unit is 5 minutes). Three rows, two workers, one crash, two turns.
- Left out: the per-recipient hourly cap and the line caps (three rows cannot reach them), invalid time zones, relay
  rows (the relay model covers them), the live flags as a variable (they are process env; the model fixes them on).

## 2. Check results (first state, before the fixes)

| Check | Result |
|---|---|
| `quint typecheck` | ok |
| `quint test` (22 run tests) | 22 passing |
| `safety` (simulation, seed 0x5eed, 40 steps, 8000 samples) | violated (expected: the model shows the defects) |
| 6 witnesses | all reachable |
| `quint verify --invariant safety --max-steps 3` (Apalache) | violated in 3 steps (SD-100), 21 s |
| `quint verify --invariant leakGate --max-steps 8` | not finished after 20 min (stopped at step 7) |

Each invariant was also simulated alone (same seed and bounds):

| Invariant | Simulation alone | Run test that shows it | Defects |
|---|---|---|---|
| `noClaimAfterStop` | violated | `q1NonMemberStopTest` | Q-outbound_queue-1 |
| `noClaimWhileHeld` | violated | `sd020StaleReplicaTest` | SD-020 |
| `noClaimWhenClosed` | violated | `sd299StaleFailsOpenTest` | SD-020, SD-299 |
| `leakGate` | holds | - | - |
| `unknownNeverResends` | holds | - | - |
| `notSentMeansNotOut` | violated | `sd090UnknownTtlTest`, `q2AcceptDbErrorTest` | SD-090, Q-outbound_queue-2 |
| `mirrorNotSentMeansNotOut` | holds in simulation | `sd334LostRaceTest`, `q2AcceptDbErrorTest` | SD-334, Q-outbound_queue-2 |
| `capAtMost` | holds in simulation | `sd090UnknownTtlTest`, `q2AcceptDbErrorTest` | SD-090, Q-outbound_queue-2 |
| `slotOnlyForLiveRow` | holds | - | - |
| `noStatusRegress` | violated | `sd099WaitOverErasureTest`, `sd300ReceiptRegressTest` | SD-099, SD-300 |
| `complianceAlwaysGoes` | violated | `sd094ComplianceHeldTest` | SD-094 |
| `nonMemberBodyClearedAtEnd` | violated | `sd091NonMemberBodyTest` | SD-091 |
| `guardFailedReachesStaff` | violated | `sd101GuardFailedReplyTest` | SD-101 |
| `collectedResolvable` | violated | `sd100CollectedStuckTest`, `sd131NoHistoryReceiptTest` | SD-100, SD-131 |
| `heldOnlyWhileUnanswered` | holds in simulation | `sd147LostWakeupTest` | SD-147 |
| `unansweredAtMost` | holds in simulation | `sd148CollectedNotCountedTest` | SD-148 |
| `ownNetworkDecides` | violated | `sd132ForeignNetworkTest` | SD-132 |
| `mirrorSettles` | violated | `sd136DirectDropsTest`, `sd336CrashLosesStatusTest`, `sd334LostRaceTest` | SD-136, SD-336, SD-334 |
| `sentAtOnlyIfOut` | violated | `sd337FailedSetsSentAtTest` | SD-337 |

"Holds in simulation" with a run test: the random walk did not find the trace in 8000 samples, and the run test
replays it step by step, so the state is reachable.

## 3. New defects of the first state (fixed since: 1f86525, 1e3585b)

### Q-outbound_queue-1: admission does not recheck consent for a direct text to a non-member

Rule: oq:14-16 ("each reads the database, so a STOP that arrives while a message waits wins"); AGENTS.md keeps STOP as
a safety guard.

Trace (`q1NonMemberStopTest`; the simulator found the same shape on its own):

1. `turnStart`, `engaged`: the person wrote.
2. `enqueue(r1, reply, member=false)`: a direct text (a join question, an invite) to a number that is not a member.
3. `drainStart`, `lockLine`, `decide(r1)`: gate 2 reads the ledger, not opted out; the decision is `send`.
4. `stop`: the same number sends STOP; the ledger commits `opted_out`.
5. `applyDecision`: the admission transaction claims r1 (`sending`). `noClaimAfterStop` fails.
6. `providerCall`: Cloud takes the text after the STOP.

Code: the admission transaction rechecks `member.opted_out` and the `optedOut` hook only inside
`if (row.memberId)` (oq:470-489, the recheck at oq:488). A row with no member (ch:238-243, `BlooioAdapter.direct`) has
no consent read after gate 2 (oq:376). Between them the drain awaits the recipient hook, the conversation read, the
line safety read, the cap counts and the leak guard's thread query (oq:378-433). Fix direction: run the `optedOut`
hook inside the admission transaction for every non-compliance row, not only for member rows.

### Q-outbound_queue-2: a failed accept commit parks a text that went out and gives its cap slot back

Rule: oq:194 ("Statuses that did not go out: their person-cap slot goes back"); PRD 40.3 person cap.

Trace (`q2AcceptDbErrorTest`):

1. `enqueue(r1, proactive, member)`, drain, `decide` takes the cap slot, `applyDecision` claims r1.
2. `providerCall(ok)`: Cloud admits r1.
3. `respond(dbErr=true)`: the accept transaction throws (a deadlock, a reset connection).
4. r1 ends `parked_error`, its slot goes back. `notSentMeansNotOut` and `mirrorNotSentMeansNotOut` fail.
5. `enqueue(r2, proactive)`, drain, `providerCall(ok)`: a second proactive text the same day. `capAtMost` fails.

Code: `send()` returns `this.acceptReceipt(...)` without `await` inside its `try` (oq:505-507). A rejected promise
returned from a `try` block of an async function skips that `catch` (checked with Bun: the error reaches the
caller). The drain's `catch` (oq:293-299) then calls `end(row, "parked_error")`, which releases the slot (oq:345) and,
for a non-member row, clears the text. The same path takes the `ChannelSendError("Invalid acceptance receipt",
"unknown")` of oq:541: it was meant to give `unknown_acceptance`, and it gives `parked_error`. This is related to
SD-117 (a throw before the call parks a row), but here the provider already took the text. Fix direction: `return
await this.acceptReceipt(...)`, and treat an accept commit failure as `unknown_acceptance` (resolved by receipt
lookup), never as an end.

## 4. Register defects the first model reproduced (code lines from ad67275)

Each one is a run test in the model (the name is in section 2) and, where marked, a trace the simulator found alone.

- **SD-020** (simulator). `holdToggle(w2)` commits a hold on replica w2; w1's view is old; w1 decides `send` for a
  transactional row and claims it. Code: `recipient` and `stale` read `rt.net` and `rt.memberOf` (ch:180-186); the
  admission transaction rechecks only the member row, the binding and relay rows (oq:470-491).
- **SD-090** (simulator). A row becomes `unknown_acceptance` more than 6 h after `created_at` (quiet hours). The next
  drain selects it in the TTL loop before any lookup and ends it `failed_unknown` (oq:584-589); the slot goes back
  (oq:345). In the simulator trace Cloud had admitted the row (crash after the call, recover at oq:272-279). The run
  test adds a second proactive text the same day: `capAtMost` fails.
- **SD-091** (simulator). A non-member compliance row is accepted by Cloud and keeps text and address: under Cloud no
  receipt moves `accepted` on, and `end()` never runs (oq:32, oq:336-345, cc:54).
- **SD-094** (simulator). Line safety holds a compliance row: the simulator found `pause_new` with a new conversation;
  the run test uses `review`. Gate 7 has no compliance exemption (oq:405-410); ops.ts:303 says STOP and HELP still go.
- **SD-099** (simulator; the register says refuted, "only the status field changes"). `erase` ends a row between
  `decide` and `applyDecision`; `wait()` writes `deferred_quiet_hours` over `dropped_forgotten` with no status guard
  (oq:350-353, rt:548-550). The model shows the regress; the next dispatch ends the row again at admission.
- **SD-100** (simulator and Apalache, 3 steps). `turnStart`, `collect(r)`, `turnFinish(unresolved)`: the row stays
  `collected` and no receipt can reach it (svc:2009-2011; no sweeper reads `collected`, oq:696-703).
- **SD-101** (simulator). A collected reply fails the guard and goes to the queue; the unit's drain runs before
  `engaged` (svc:2088); gate 4 ends it `suppressed_ineligible` (oq:383-389) before the leak guard can park it (rt:470-477).
- **SD-131** (run test). Cloud sends a collected member reply and reports `history:false`; the receipt is refused
  400 (svc:2028-2033) and the reply stays `collected` though it went out. The model reaches it for a member reply with
  no Eliza account; the register's case (a non-member reply) has no queue row, so the model shows the same check
  through a member row.
- **SD-132** (simulator). A drain of a second network of the app (`sf`) decides an `nyc` row: `memberOf` misses and the
  row ends `suppressed_ineligible` (oq:288-289, ch:185-186, network.ts:4848). Latent: only nyc networks exist now.
- **SD-136** (simulator). A `direct()` drain ends another member's row `refused_opted_out` and drops the change
  (ch:240-241); `network.messages` stays `queued`.
- **SD-147** (run test). `decide` reads `unanswered` at the cap; the person writes; `engaged` resets the streak and
  releases held rows (the row is still `pending`, oq:642-643); `applyDecision` writes `held_awaiting_reply`
  (oq:401). Nothing wakes it until it expires.
- **SD-148** (run test). A collected reply goes out and does not count in `line_conversations` (oq:696-703 writes no
  streak; only `acceptReceipt` does, oq:555-566). A proactive text then passes the unanswered cap.
- **SD-299** (run test). The item closed and this replica knows it, but the stale hook throws; `guarded(..., false)`
  fails open (oq:371), against "Every hook fails closed when it throws" (oq:111).
- **SD-300** (run test, blooio mode). Two receipts read `accepted`; `delivered` writes, then `sent` writes over it
  (oq:613-631).
- **SD-334** (run test). Two replicas look up one unknown row; the first commits `accepted`, the second's guarded
  commit misses and reports `dropped_forgotten` (oq:569); the projection already ran (rt:621-647), so the wrong status
  stays in `network.messages`.
- **SD-336** (run test). A drain ends a row `refused_opted_out`, then the process stops before `storeStatuses`
  (rt:612-617). The projection repairs only accepted rows, so the message stays `queued`.
- **SD-337** (simulator, blooio mode). A send receipt with status `failed` writes `sent_at` before `end(failed)`
  (oq:547-551, oq:570).

## 5. Register defects of this module the model does not reach

- **SD-117** (transient error parks a row for good). The model reaches it (`sd117TransientParksTest`: the admission
  transaction throws, the reply ends `parked_error`, no action leads out). No safety invariant fails, because
  `parked_error` is an end and no written rule says a transient error must be retried. It is a liveness question.
  The harm case where the provider already took the text is Q-outbound_queue-2.
- **SD-120** (the contact guard exempts a number after a keyword). This is a defect in the regex reader. The leak guard
  is an oracle in the model; a corpus row tests the reader (quint/README.md rule 7).
- **SD-257** (no failure is visible to the member). This is about what the member is told. The model has no member
  view of failures and no rule to check.
- **SD-304** (`leave` runs ahead of earlier rows in webhook mode) and **SD-316** (unresolved inbox rows keep collected
  reply text). Both live in `platform.inbound` (inbox.ts), which is the turn_consent model's state. This model keeps
  only whether a turn can still take a receipt.

## 6. Apalache

`quint verify --invariant safety --max-steps 3` finds SD-100 in 21 s. The trace: `turnStart`, `collect(r2)`,
`turnFinish(unresolved)`.

`quint verify --invariant leakGate --max-steps 8` did not finish: after 20 minutes on a shared machine (load average
about 30) it was still at step 7, and I stopped it. A send needs 6 steps (enqueue, drainStart, lockLine, decide,
applyDecision, providerCall), so a bounded proof of `leakGate`, `unknownNeverResends` and `slotOnlyForLiveRow` needs a
depth that Apalache does not reach on this model in reasonable time. For those three invariants the evidence is the
simulation only (8000 samples of 40 steps, seed 0x5eed). The file sets `verify-steps=3`, so that `--verify` finishes.
