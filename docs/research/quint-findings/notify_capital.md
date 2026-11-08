# Quint findings: notify_capital

Date: 2026-11-08. Model: [quint/notify_capital.qnt](../../../quint/notify_capital.qnt). Plan: [2026-11-07-state-machines.md](../2026-11-07-state-machines.md) section 6.17. Base commit ad67275. This file is hand-written. The traces are from `quint run` (rust backend) and `quint verify` (Apalache 0.62.4), shortened by hand. No code was changed.

## 1. What the model covers

Two parts in one file, with no shared state. A variable `part` picks one part for each simulated trace, so that random traces reach deep states. Apalache explores both values.

**Part A, Notify** (`packages/notify`, the service wiring in `packages/network/service/service.ts:609-688` and `runtime.ts:590-647`).

- One person, two apps (`ntwrk`, `slop`), two inbox subjects (1 is ntwrk, 2 is slop), three Network texts.
- The projection of a delivered Network text: `recordSent` is two commits, `add` then `recordDelivery(net:<id>)` (`scheduler.ts:105-111`). A throw between them leaves the stage at 1, and the next drain runs `add` again.
- Two scheduler replicas. `dispatch` is split at its awaits: `plan`, `reread`, `recordDelivery` (one transaction), `enqueue` (the `notifySink` unit of work), and `crash` at any phase.
- The outbound queue is an oracle: it sends a row, or ends it `refused`, `expired` or `obsolete` (`stillNeeded` false). Assumption: the queue checks the member of the app the row is queued on (`channel.ts:183-184` uses that runtime's policy).
- The member reads updates per app (`readApp`, with `touch`), redeems a Claude link (`redeem`), pauses an app, accepts an invite, or leaves one app (`forget_data`, `retention.sql:78-128`). The sweep closes open deliveries as `ignored`.
- The surface score in `resolveDelivery` is an oracle: the scheduler may point at Claude only while Claude is usable (`surface.ts:47`).

**Part B, Capital** (`packages/capital/src/ledger.ts`, `packages/network/src/network.ts` emitters, `packages/network/service/runtime.ts` persistence).

- Three members, one plan (`o1`), one help round (`o2`), clock 0..3 with one backward step.
- The Network emitters as the code calls them: `ledgerJoined` (`network.ts:2690-2696`), `activate` (`2699-2705`), the minor path with no emit (`715-727`), `plan_accepted`, `finalize` (`2755-2756`), `value_received` with no `confirmedBy` (`2604`), the help round (`2802-2803`).
- The in-memory ledger records every event at emit time; the event goes into `Unit.capital` whether the ledger accepted it or not (`runtime.ts:162`, `capital.ts:57`). `cCommit` stores the unit (`runtime.ts:504-507`). `cAbort` drops the unit and reloads the Network state; the ledger keeps what it recorded. `cForget` deletes every stored event whose JSON names the member (`runtime.ts:537`). `cRestart` replays the stored events `order by t, id` (`runtime.ts:342-344`).
- Multipliers, decay and the period cap are fixed at 1. The fraud review, levers and gaming flags are left out: `runtime.ts:118` builds the ledger with `reader: false`, so they have no production trigger.

## 2. Check results

```
bun run quint:check quint/notify_capital.qnt
ok   typecheck
ok   test                (11 run tests)
FAIL safety              (expected: the model shows the defects below)
ok   witness_digestSent, witness_networkTextProjected, witness_assistantLinkIgnored,
     witness_attendanceCredited, witness_helpCredited, witness_restartWithEvents (all reachable)
```

`quint verify --invariant safety --max-steps 3` finds a counterexample in 12 s (the model header sets `verify-steps=3`). Deeper `--verify` on all of `safety` does not finish: the capital replay (`sortedLog`, a fold over time, type and key) makes Apalache run out of an 8 GB heap at 5 steps. Each Notify invariant was verified alone on the Notify part (`quint verify --init initNotify --step stepNotify`, private Apalache server, 8 GB). The capital invariants were checked by simulation on the capital part (`--init initCapital --step stepCapital`) and by run tests. The table gives the result for each invariant.

| Invariant | Rule | Result | Shortest trace found by | Register |
|---|---|---|---|---|
| `oneNotifyTextPerItem` | notify README "at most one message per send", "replicas may overlap safely"; `scheduler.ts:185` | violated | run test `replicaOverlapTest` (14 steps) | SD-150 |
| `noRepeatOfNetworkText` | `service.ts:611-612`, `scheduler.ts:100-104` "never texts it again" | violated | verify, 7 steps | SD-151 |
| `refusedNotCounted` | PRD 32.9 (the cap counts messages); `scheduler.ts:6-7` | violated | verify, 7 steps | SD-095 |
| `refusedItemsStayPending` | `scheduler.ts:3-5` | violated | verify, 7 steps | SD-095 |
| `schedulerRespectsCap` | PRD 32.9; `scheduler.ts:6-7` | violated | run test `replicaOverlapTest` (14 steps) | SD-150 |
| `pausedAppGetsNoProactive` | `scheduler.ts:29-30`; AGENTS.md per-app consent | violated | verify, 8 steps | SD-152 |
| `droppedSurfaceReturnsOnUse` | `surface.ts:3-4` | violated | run test `droppedSurfaceStaysTest` (20 steps) | SD-339 |
| `signalsKeptForPending` | `retention.sql:116-117` | violated | verify, 2 steps | SD-341 |
| `everyNetworkTextInInbox` | notify README "every event becomes one inbox item" | violated | verify, 5 steps | SD-303 (NT-5 part) |
| `noMinorEligible` | AGENTS.md age policy; PRD 39.2.6; `ledger.ts:6-7, 152-153` | violated | verify, 2 steps | SD-049 |
| `replayEqualsLive` | `ledger.ts:59-60`; `store.ts:1-2` | violated | simulation, run tests | SD-153, SD-156 |
| `forgetKeepsOthers` | capital.md S4 | violated | simulation | SD-155 (refuted in the register) |
| `vouchCreditFollowsValue` | PRD 39.2.2; AGENTS.md decision 11 (fixes-core 26) | violated | run test | SD-154 |

## 3. Counterexamples and their mapping to the code

All traces start with the person a member of ntwrk (active) and slop (active), and empty stores.

### SD-151: the projection gap texts a delivered message again

```
netSend(t=1, subj 2, proactive)        a Network text was accepted (runtime.ts:590-597)
projAdd(1)                             recordSent: add commits; item pending (scheduler.ts:107)
                                       -- recordDelivery throws or the process stops (scheduler.ts:109)
plan(r2) -> reread(r2)                 notifyTick: the item is pending, due (scheduler.ts:123-147, 181)
recordDelivery(r2)                     ntf_ delivery {2} recorded (scheduler.ts:186-190)
enqueue(r2) -> queueSend({2})          notifySink -> rt.system -> sent (service.ts:667-675)
=> noRepeatOfNetworkText false: the member gets the same update twice.
```

Real defect. As no producer calls `add`, this is the only route into `dispatch` in production, as SD-151 says. On one replica the tick runs the drains first (`deploy/backend/backend.ts:397`), so the gap needs a failed `recordDelivery`, a crash or a second replica. Run test: `projectionGapDuplicateTest`.

### SD-095: a refused text still counts and keeps its items notified

```
netSend(1, subj 2, proactive) -> projAdd(1)
plan(r2) -> reread(r2) -> recordDelivery(r2)   items notified, delivery counts (pg-store.ts:104-117)
enqueue(r2) -> queueEnd({2}, refused)           consent ledger / person cap refuses the row
=> refusedNotCounted false: capCount = 1 with no message sent (pg-store.ts:124-130).
=> refusedItemsStayPending false: the item is notified, so plan() never takes it again (scheduler.ts:126).
```

Real defect. Nothing goes back from the queue to Notify. The sweep later records `ignored` against a surface that got nothing (`scheduler.ts:277-280`). Run test: `refusedStillCountsTest`.

### SD-150: replica overlap, two texts with one item, cap passed

```
netSend(1, subj 1, proactive) -> projAdd(1)          item 1 pending
plan(r1)                                              r1 plans {1}; capCount 0 < CAP
netSend(2, subj 2, proactive) -> projAdd(2)           item 2 pending
plan(r2)                                              r2 plans {1,2}; capCount 0 < CAP
reread(r1), reread(r2)                                both see item 1 unnotified (scheduler.ts:181)
recordDelivery(r1), recordDelivery(r2)                ids differ (hash of the item set,
                                                      scheduler.ts:84-85): both insert; the update
                                                      of item 1 matches no row the second time
                                                      but does not fail (pg-store.ts:112-114)
enqueue(r1), enqueue(r2), queueSend({1}), queueSend({1,2})
=> oneNotifyTextPerItem false (item 1 in two texts), schedulerRespectsCap false (2 counting texts).
```

The trace is 14 steps. Apalache did not finish 14 steps on the Notify part in 20 minutes, and random simulation did not reach it, so the trace is the run test, which replays it step by step.

Real defect, dormant: it needs two replicas (`backend.ts:409-415` guards one process only) and the SD-151 gap to make the items pending. Run test: `replicaOverlapTest`.

### SD-152: a slop item goes out on the ntwrk member while slop is paused

```
netSend(3, subj 2 (slop), proactive) -> projAdd(3)
plan(r2) -> reread(r2)                  recipient = first live member, ntwrk first (service.ts:649-660)
setPaused(slop)                          the slop member pauses
recordDelivery(r2) -> enqueue(r2)        queued on the ntwrk member
queueSend({2})                           the queue checks the ntwrk member, who is not paused
=> pausedAppGetsNoProactive false.
```

Real defect, dormant. `proactiveAllowed` is always true (`service.ts:657`), so the documented rule in `scheduler.ts:29-30` has no effect, and the queue reads the ntwrk member. The same trace with the pause before `plan` gives the same result.

### SD-339: a dropped surface cannot come back

```
setActive(true)                                      the Claude grant
netSend(1, subj 1) -> projAdd(1) -> plan(r1, claude) -> reread -> recordDelivery -> enqueue
netSend(2, subj 2) -> projAdd(2) -> plan(r1, claude) -> reread -> recordDelivery -> enqueue
sweepOne({1}), sweepOne({2})                         two unused links: streak 2 (pg-store.ts:199-202)
setActive(false), setActive(true)                    grant off and on: streak unchanged
readApp(ntwrk, claude)                               the member uses Claude: touch only
=> droppedSurfaceReturnsOnUse false: streak 2, Claude is not usable, every later text is a thread.
```

The trace is 20 steps; it is the run test `droppedSurfaceStaysTest` (too deep for the simulator and for Apalache in reasonable time).

Real defect. `touch` writes only `last_used_at` (`pg-store.ts:186-190`); the grant toggle writes only `active` (`pg-store.ts:180-184`). Only `recordOutcome("acted")` resets the streak (`pg-store.ts:193-197`), and it needs an open delivery on that surface, which `resolveDelivery` no longer makes (`surface.ts:47, 61`). In production `prefs` is always `{channel: "imessage"}` (`service.ts:657`), so the score path is the only path to Claude.

### SD-341: signals are deleted while an invited membership remains

```
init: ntwrk active, slop invited
setActive(true)            the Claude grant writes a signal row (insert trigger allows it: retention.sql:62-66)
leave(ntwrk)               forget_data: the keep rule skips 'invited' (retention.sql:119-120)
=> signalsKeptForPending false; a new grant can write the row again (retention.sql:62-66).
```

Real defect (the two rules disagree, as SD-341 says).

### SD-303 (the NT-5 part): a second event for one subject gets no inbox item

```
netSend(1, subj 1, reply) -> projAdd(1) -> projRecord(1)   item 1 = text 1, notified net:1
netSend(3, subj 1, proactive) -> projAdd(3)                 add returns the first item
                                                            (pg-store.ts:62-64); it is notified, so
                                                            no delivery is written (scheduler.ts:108)
=> everyNetworkTextInInbox false: text 3 has no inbox item, and the proactive text is not counted.
```

Real defect. `service.ts:626` uses `subjectId: oppId ?? id`, and the dedupe key omits the message. The retention part of SD-303 (no delete of old items, deliveries and tokens) has no time in this model, so the model cannot show it.

### SD-049: a member found to be a minor stays eligible in the ledger

```
cJoin(a, adult)            member_joined with an age: eligible (ledger.ts:142-149)
cLearnMinor(a)             m.minor = true, member dropped (network.ts:715-727); no age_updated
=> noMinorEligible false (verify, 2 steps).
```

Real defect, latent: nothing reads the ledger in production (`reader: false`). A second route was found by simulation: a unit that joined the member as an adult fails (`cAbort`); the ledger keeps `member_joined` (memory before commit, SD-344); a later join of the same member as a minor emits the same id, which the ledger skips (`ledger.ts:134`). Run test: `minorStaysEligibleTest`.

### SD-153: the replay order is not the accepted order

```
cJoin(a), cJoin(b)                 t = 0
cHelp(a, b)                        help_given:o2, help_confirmed:o2 at t = 0 (network.ts:2802-2803)
cCommit                            live balance a = 3 NC
=> replay(pg): "help_confirmed:o2" < "help_given:o2"; the confirmation finds no record
   (ledger.ts:279-281). Replay balance a = 0. replayEqualsLive false; after cRestart the balance is 0.
```

The simulator also found a form that the register does not list, with the same root:

```
cJoin(b) -> cActivate(b) -> cCommit          member_joined:b and member_activated:b at one t
=> "member_activated:b" < "member_joined:b": the replay drops the activation (unknown member).
```

In the product, `activate` emits `member_joined` (through `ledgerJoined`) and `member_activated` in one call, at one t (`network.ts:2699-2705`), whenever the age was known only at onboarding. After a restart the member is not activated in the ledger, so a vouch credit (if SD-154 is fixed) could not follow. The feedback form (`feedback_given:*` before `plan_attended:*`, `network.ts:2755-2756`) is in the model too. Run tests: `helpReplayTest`, `activateReplayTest`.

### SD-156: a refused event is stored and accepted on replay

```
cJoin(a)  t=0;  cTick; cTick;  cActivate(a)  t=2 (lastT = 2)
cClockBack                       the wall clock steps back to t=1
cJoin(b)                         member_joined:b at t=1 < lastT: refused live (ledger.ts:135),
                                 caught (capital.ts:57), but still pushed into the unit (runtime.ts:162)
cCommit                          stored
=> live: b unknown; replay: b known and eligible. replayEqualsLive false.
```

Real defect, latent (nothing reads the ledger). Run test: `clockBackReplayTest`.

### SD-154: vouch credit is unreachable

```
cJoin(a); cJoin(b, invited by a); cJoin(c); cActivate(b); cValue(b, provider c)
=> value_received has no confirmedBy and no verifiedBy (network.ts:2604); the ledger drops it
   (ledger.ts:179-181). vouchCreditFollowsValue false; a's balance stays 0.
```

Real defect. Run test: `vouchNeverCreditedTest`. The random simulator did not find this trace in 60 000 samples (it needs five matching choices); the run test shows it.

### SD-155 (refuted in the register): forget deletes events about other members

```
cJoin(b); cCommit; cJoin(c, minor, invited by b); cCommit; cForget(b)
=> member_joined:c names b in vouchedBy; runtime.ts:537 deletes it. After a replay c is unknown.
```

The model reproduces the state change. The register refutes SD-155 because nothing in production reads the replayed ledger; the model agrees that the effect is latent. It is not in this module's list, and it needs no new id.

## 4. Register defects of this module

| Id | Reproduced | Note |
|---|---|---|
| SD-049 | yes | `noMinorEligible`, 2 steps |
| SD-095 | yes | `refusedNotCounted`, `refusedItemsStayPending` |
| SD-150 | yes | `oneNotifyTextPerItem`, `schedulerRespectsCap`; needs two replicas |
| SD-151 | yes | `noRepeatOfNetworkText` |
| SD-152 | yes | `pausedAppGetsNoProactive` |
| SD-153 | yes | `replayEqualsLive`; also the `member_activated` form |
| SD-154 | yes | `vouchCreditFollowsValue` (run test) |
| SD-156 | yes | `replayEqualsLive` with a clock step back |
| SD-303 | partly | the permanent dedupe key (NT-5) yes; retention cannot be reached: the model has no time and no retention job |
| SD-339 | yes | `droppedSurfaceReturnsOnUse` |
| SD-341 | yes | `signalsKeptForPending` |
| SD-342 | no | API with no production caller. Not a state property; the model includes only what production calls (it leaves out `shownSubjects`, `redeemSubjects`, `threadHooks`, `queuePolicy`, `queueSink`) |
| SD-348 | no | A missing transition: no event type reverses a penalty or a clawback. A model of the code cannot contain an action that does not exist, and the fraud path has no production trigger (`reader: false`). Confirmed by absence only |
| SD-350 | no | `tiesOf` only matters inside `value_received`, which SD-154 makes a no-op in the product. With the product's event shape no trace reaches it |
| SD-354 | no | The sim gates measure a synthetic event stream. A gate gap, not a state of the product |
| SD-355 | no | Config fields that are written and never read. No state machine |

## 5. New findings

None. Every violation maps to a register id. The `member_activated` replay form is a new trace for SD-153 (same cause: `order by t, id` is not the accepted order), and the abort route for SD-049 combines SD-049 with SD-344.

## 6. Notes for the fixes

- A Notify fix that adds a send result back to the inbox must keep the `stillNeeded` fence (`scheduler.ts:209-215`): the model shows it cancels a text whose items were all seen or erased.
- A capital fix for SD-153 and SD-156 is one change: a sequence column in `network.capital_events` and replay in accepted order, and no stored row for a refused event. A test for it: restart the service after a help round and compare `/health` capital counts and the replayed balances (integration, `packages/network/test/`).
