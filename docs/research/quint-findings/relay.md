# Quint findings: `quint/relay.qnt`

Hand-written. Model: [quint/relay.qnt](../../../quint/relay.qnt). Module plan: section 6.8 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Code at commit ad67275.

## 1. What the model covers

| Machine | Code | In the model |
|---|---|---|
| relay-item | packages/network/src/relay.ts:178-266, 347-376 | `commitText`, `apply`, `deliver`, `staffRelease`, `staffReject` |
| relay-swap | packages/network/src/relay.ts:269-312 | `commitShare`, `commitWithdraw` |
| relay-match-view | packages/network/src/network.ts:4895-4903 | `w.matchOpen` (and `closeMatch`) |
| photo-relay-item | packages/platform/src/photo-relay.ts:111-224 | `selectPhoto`, `reviewPhoto`, `revokePhoto`, `photoRequest`, `staffPhotoReject`, `resolvePhoto`, `fetchBytes` |
| action-receipt | packages/network/service/relay-endpoint.ts:175-261 | `claim`, `commit*`, `unitThrow`, `postCommitThrow`, `answer`, `crash`, `replay` |
| relay-classifier-hook | packages/engine/src/relay.ts:430-445 | oracle outcomes `minorClef`, `hold`, `block` in `textDecision` |

Other actions: the Network tick that flushes deferred sends (`tickFlush`, network.ts:3269-3276), the queue
admission (`queueSend`, runtime.ts:238-269), a queue end for reasons outside the relay (`queueFail`), STOP,
block, close, safety hold, minor flag, erasure (`erase`, runtime.ts:525-552 and relay.ts:398-402), quiet
hours and time.

Bounds: 2 members, 1 match, 4 member requests, 1 photo item. One fault at most per committed request (the
faults combine across requests). `RELAY_LOG_MAX` is scaled from 5000 to 3. The photo path is on in the model
as a regression guard; it is off in production (no `PhotoRelayPolicy`).

## 2. Check results

`bun run quint:check quint/relay.qnt` (seed 0x5eed, max-steps 25, max-samples 10000):

```
ok   typecheck
ok   test                     (15 run tests pass)
FAIL safety                   (expected: the model shows the defects below)
ok   witness_bothNumbersGo, witness_heldReleased, witness_deferredFlushed, witness_withdrawn, witness_photoServed
```

Each conjunct of `safety`, simulated alone with the same seed and bounds:

| Invariant | Simulation | Register |
|---|---|---|
| noOneWayNumber | violated | SD-007 |
| numberMovesOnlyIfBothConsented | holds | - |
| withdrawnNotSent | holds in simulation; violated by `withdrawAfterSwapTest` | SD-039 |
| rowSentImpliesPass | holds | - |
| threadOnlyDelivered | violated | Q-relay-1 |
| minorTextNeverKept | violated | SD-064 |
| contactSharedImpliesDelivered | violated | SD-252 |
| erasedNumberGone | violated | SD-040 |
| waitingSwapAsked | violated | SD-138 |
| askInsideWindow | violated | SD-138 |
| effectAtMostOncePerKey | holds | - |
| completedIffCommitted | holds | - |
| failureMeansNoEffect | violated | SD-137 |
| bytesServedImpliesApprovedBound | holds | - |
| photoHeldDecidable | holds (see SD-320 below) | - |
| photoRetryAfterRateHold | violated by `photoRateHoldTest` | SD-320 |
| recordReviewMatches | violated (log cap scaled to 3) | SD-387 |

Properties outside `safety` (no rule states them as safety; checked alone):

| Property | Result | Register |
|---|---|---|
| consentFreshAtDelivery | violated: a number goes 20 minutes after the consent | (by design, see below) |
| heldDecidedInTime | violated: a held item waits past 60 minutes, with no alert | SD-133 |
| noStuckKey | violated: a crash leaves the key `processing` | SD-093 |
| heldAnswerHasRow | violated: a rate-only hold answers "held" with no held row | SD-426 |

`quint verify --invariant safety --max-steps 7` (Apalache) finds a counterexample in 8 s (the refused swap
ask, SD-138, at step 2). The Apalache runs for the invariants that hold are in section 5.

## 3. Defects and traces

Traces are in short form: `action(args)`; time in minutes.

### SD-007: a number swap goes one way (reproduced, three triggers)

Rule: "Both go out only when both pass and the first one was delivered, so nobody's number goes one way"
(packages/network/src/relay.ts:284-286). The verdict for SD-007 is "refuted" because the deferral trigger was
thought to need one share deferred and one sent. Quiet hours are per member
(packages/engine/src/attention.ts:269-279, `m.quietHours`), so the model reaches it. It also reaches two
other triggers. I recommend that the verdict is opened again.

1. Deferral (`oneWayDeferredTest`): `claim(a1,share) commitShare(a1)` -> `setQuiet(A,true)` ->
   `claim(b1,share) commitShare(b1)`: A's number to B is queued, B's number to A is deferred
   (relay.ts:248 answers "sent" for "deferred", so line 294 lets the second share go) -> `queueSend(a1)` ->
   `blockPair` -> `setQuiet(A,false) tickFlush`: the deferred share is refused (network.ts:3272-3276).
   B has A's number; A has nothing.
2. Queue (`oneWayQueueTest`, outbound D2): both rows are queued; `queueSend(b1)`; `queueFail(a1)` (the
   unanswered rule, a leak park or a provider failure). The simulator also found a variant: a safety hold
   on A between the two admissions (`queueSend(b1) safetyHold(A) queueSend(a2)`).
3. Inside one unit (`oneWayInUnitTest`): the first share is queued; `Network.send` refuses the second (the
   conversation streak, network.ts:3884, or the leak guard). relay.ts:299 returns the refusal, but the first
   share is already in the unit. B has A's number, and A is told "I can't swap numbers right now".

### SD-039: withdrawal does not stop a queued number share (reproduced)

`withdrawAfterSwapTest`: both shares pass while both members are in quiet hours, so both wait in
`Network.deferred` -> `claim(a2,withdraw) commitWithdraw(a2)`: `cancelSwaps` removes nothing
(relay.ts:308-312; relay-endpoint.ts:216 ignores the count) and the answer is "Okay, I won't share your
number" (relay-endpoint.ts:217) -> quiet hours end -> `tickFlush` -> `queueSend(a1)`. A's number goes. The
tick (network.ts:3269-3276) and the admission (runtime.ts:238-269) read no withdrawal.

### SD-040: an erased member's number stays in the recipient's rows (reproduced)

`erasedNumberStaysTest`: the swap completes -> `erase(A)`. The forget path nulls only rows with
`member_id = A` (runtime.ts:548-550). Row `a1` (to B) keeps A's number. The simulator also found the case
where the row to B is still queued: admission refuses it later, but the body stays.

### SD-064: a text that Clef reads as a minor's is kept for staff (reproduced)

`clefMinorKeptTest`: `claim(a1,text) commitText(a1, minorClef)`. The rules pass, Clef flags
`clef:minor_signal` (engine relay.ts:433-444 keeps the rules' `ageSignal`, false), so the held row keeps the
text (relay.ts:241-242). The model has no age state change on this path either, which is the second half of
SD-064.

### SD-133: held items have no SLA (reproduced, outside `safety`)

`heldDecidedInTime`: `commitText(.., hold)` then `timePass(20)` x4. The item stays `held`; no action in the
code moves it or raises an alert (relay.ts:405-407 keeps `held` for ever).

### SD-137: a post-commit delivery error returns failure (reproduced)

`postCommitThrowTest`: `claim(a1,text) commitText(a1,pass) postCommitThrow(a1)`. The unit committed the row,
the log and the receipt `completed`; `rt.unitOfWork` then calls `deliver()` (runtime.ts:671-673), which can
throw. The catch (relay-endpoint.ts:257-260) writes nothing, because the receipt is no longer `processing`,
and answers 409 `action_unresolved`, `retryable:false`. The row still goes.

### SD-138: the swap ask result is ignored, and the ask can arrive late (reproduced, both parts)

`askRefusedTest`: `commitShare(a1, refuseAsk)`. `host.send` refuses the ask (relay.ts:281 ignores the
result); the swap still waits and A hears "I'll share your number as soon as they say".
`askLateTest`: the ask row waits in the queue for 20 minutes and then goes; its text says "in the next 15
minutes" (relay.ts:154), and the swap has expired (relay.ts:270).

### SD-252: a failed number share stays `contactShared: true` (reproduced)

`oneWayQueueTest` also breaks `contactSharedImpliesDelivered`: the log row of `a1` says `contactShared`
(engine relay.ts:394) though the row ended unsent. `alreadyShared` (engine relay.ts:377) then blocks a new
share for A in this match. The deferral trigger and erasure of the recipient do the same.

### SD-320: desk-held photo items cannot be decided (partly reproduced)

`photoRateHoldTest`: `selectPhoto reviewPhoto(safe) photoRequest(rate)`. A rate-only hold logs `hold` on the
fixed id `pri_...` with no held row (relay.ts:236-238). Every later request and every staff release replays
"held" (relay.ts:319-321, service.ts:2450-2452). The photo stays `approved` and cannot go, against the comment
"the member can try again" (relay.ts:236).

The model cannot reach the other half of SD-320 (a desk `held` row for a photo because a party is on a safety
hold): `approvedForParty` -> `current()` -> `relayPhotoParties` -> `relayPairAdmission`
(photo-relay.ts:103-110, runtime.ts:290-313) refuses a held party before the desk runs, and the desk reads the
same stored state inside the same unit. `photoHeldDecidable` holds. The photo path is off in production.

### SD-387: a held relay row can stay `held` in `relay_records` (reproduced at a scaled cap)

`logCapTest` (LOG_MAX = 3 for 5000): a held item's log row is pushed out by newer rows (relay.ts:326-330);
`staffReject` then changes only the held entry, and `relayRows` writes records only from the log
(store.ts:146-162), so `network.relay_records.review` stays `held`.

### SD-426: a rate notice says "held" for an item that is not kept (reproduced, outside `safety`)

`heldAnswerHasRow`: a rate-only hold answers "held" and stores no held row (relay.ts:236-238). The comment
says this is by design; the defect is the wording. Copy change, not a code defect for this step.

### SD-093: a crashed key stays `processing` (reproduced, outside `safety`)

`noStuckKey`: `claim(k) crash(k) replay(k)` answers 409 for ever (relay-endpoint.ts:197). No effect was
committed, so at-most-once holds.

### Q-relay-1 (new): the relay thread keeps wording that the other member never got

Rule: "One relay thread per match: the delivered wording only" (packages/network/src/relay.ts:93) and engine
relay.ts:495-500 ("The delivered wording").

`threadKeepsUndeliveredTest`: `claim(a1,text) commitText(a1,pass)` -> `closeMatch` -> `queueSend(a1)`: the
admission refuses the row, but `RelayDesk.deliver` (relay.ts:259-264) added the wording to the thread when
`host.send` answered "sent" (queued) or "deferred". A deferred item that the tick later refuses does the same.
The thread feeds the leak guard's split-number check (`recentTexts`, relay.ts:215) and the Clef context
(relay.ts:224), so later decisions read text the recipient never saw. The effect is low: it makes decisions
stricter, not looser. Fix direction: add the wording to the thread only when the row is admitted, or remove
it when the send ends unsent.

### Consent freshness at delivery (not a defect)

`consentFreshAtDelivery` fails: a share decided inside the 15-minute TTL is delivered 20 minutes later after
quiet hours. The engine checks freshness at decision time (engine relay.ts:319-324), and deferral is by design
("I'll pass that on when it's a reasonable hour", relay.ts:152). Withdrawal is the real gap (SD-039).

## 4. Register defects of this module not reproduced

| Id | Why |
|---|---|
| SD-007 deferral trigger | Reproduced (section 3); the register verdict should be opened again. |
| SD-319 | The model agrees that `review === "rejected"` with `decision === "pass"` is unreachable (a reject never changes the decision). |
| SD-321, SD-374, SD-375 | Photo states with no transition after expiry or a revoke over a rejection change nothing that the model's invariants read; the fixed delivery deadline is modelled and fails closed. |
| SD-332 | The endpoint receipt stops a replay of the same signed request before the desk; the model has no path to the desk with an old item id. |
| SD-445 | Copy promise while the RELAY flag is off: outside the relay machine. |

## 5. Apalache

`quint verify --invariant safety --max-steps 7`: counterexample in 8 s (SD-138, two steps). Runs of the
invariants that hold, `--max-steps 6`, on a private Apalache port (the shared default port dropped the
connection while other sessions used it): see the results appended below.
