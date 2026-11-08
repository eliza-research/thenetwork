# Quint findings: `quint/relay.qnt`

Hand-written. Model: [quint/relay.qnt](../../../quint/relay.qnt). Module plan: section 6.8 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). The first version of the model followed the code at
commit ad67275 and showed the defects in section 3. The model now follows the code after the fixes on branch
`wave2/relay` (commits e2a3043 to f72d226). Every check passes (section 2).

## 1. What the model covers

| Machine | Code | In the model |
|---|---|---|
| relay-item | packages/network/src/relay.ts (request, apply, deliver, unsent, prior, log, release, reject, forget) | `commitText`, `apply`, `deliver`, `syncUnsent`, `staffRelease`, `staffReject` |
| relay-swap | packages/network/src/relay.ts:278-339 (swap, cancelSwaps) | `commitShare`, `commitWithdraw` |
| relay-match-view | packages/network/src/network.ts (relayMatchOf) | `w.matchOpen` (and `closeMatch`) |
| photo-relay-item | packages/platform/src/photo-relay.ts:111-224 | `selectPhoto`, `reviewPhoto`, `revokePhoto`, `photoRequest`, `staffPhotoReject`, `resolvePhoto`, `fetchBytes` |
| action-receipt | packages/network/service/relay-endpoint.ts:175-263 | `claim`, `commit*`, `unitThrow`, `postCommitDeliverError`, `answer`, `crash`, `replay` |
| relay-classifier-hook | packages/engine/src/relay.ts:430-447 | oracle outcomes `minorClef`, `hold`, `block` in `textDecision` |

Other actions: the Network tick that flushes deferred sends and takes back a refused relayed item (`tickFlush`,
network.ts:3269-3277), the queue admission (`queueSend`, runtime.ts:246-281), a queue end for reasons outside the
relay (`queueFail`), the review SLA check (`slaTick`, service.ts:533-537), STOP, block, close, safety hold, minor
flag, erasure (`erase`, runtime.ts:537-571 and relay.ts:430-434), quiet hours and time.

Bounds: 2 members, 1 match, 4 member requests, 1 photo item. One fault at most per committed request (the faults
combine across requests). `RELAY_LOG_MAX` is scaled from 5000 to 3. The review SLA (6 to 24 hours in
`DEFAULT_SLA_HOURS`) is scaled to 30 minutes. The photo path is on in the model as a regression guard; it is off in
production (no `PhotoRelayPolicy`).

## 2. Check results (final state)

`bun run quint:check quint/relay.qnt` (seed 0x5eed, max-steps 25, max-samples 10000):

```
ok   typecheck
ok   test                     (20 run tests pass)
ok   safety                   (16 invariants, no violation in 10000 traces of 25 steps)
ok   witness_bothNumbersGo, witness_heldReleased, witness_deferredFlushed, witness_withdrawn,
     witness_photoServed, witness_heldAlerted, witness_unsentSynced   (all reachable)
```

`bun run quint:check --verify quint/relay.qnt` (the same steps, then `quint verify --invariant safety --max-steps 3`,
Apalache): every step `ok`, 1 model, 0 failures, 55 s in all. See section 6 for the bounds.

### Invariants in `safety`

| Invariant | Rule | Defect it guards |
|---|---|---|
| numberMovesOnlyIfBothConsented | founder decision 9 | - |
| withdrawnNotSent | founder decision 9, relay-endpoint.ts "won't share" | SD-039 |
| rowSentImpliesPass | AGENTS.md Relay (#7), runtime.ts final dispatch | - |
| decisionsReadDelivered | relay.ts:93 (thread), engine relay.ts:125 (contactShared) | Q-relay-1, SD-252 |
| minorTextNeverKept | relay.ts "never a minor's words" | SD-064 |
| erasedNumberGone | runtime.ts forget path | SD-040 |
| waitingSwapAsked, askInsideWindow | relay.ts:15, relay.ts:154 | SD-138 |
| effectAtMostOncePerKey, completedIffCommitted | relay-endpoint.ts:8-9, 26-27 | - |
| failureMeansNoEffect | RelaySendResponse, retryable:false | SD-137 |
| bytesServedImpliesApprovedBound | photo-relay.ts:215-224 | - |
| photoHeldDecidable | service.ts staff route | SD-320 (safety half) |
| photoRetryAfterRateHold | relay.ts rate-only hold comment | SD-320 |
| recordReviewMatches | store.ts:143-144 | SD-387 |
| heldSlaAlerted | AGENTS.md human review, service.ts afterTick | SD-133 |

`decisionsReadDelivered` replaces the state invariants `threadOnlyDelivered` and `contactSharedImpliesDelivered` in
`safety`. The fix is lazy by design: `RelayDesk.unsent` runs before each endpoint decision in the match
(relay-endpoint.ts:232) and in the tick for a refused deferred item, not when the outbound row ends. So the state forms
fail between the loss of a row and the next decision. The rule that matters is that no decision reads a lost item as
delivered: the ghost `staleRead` records every endpoint decision (text, share, photo) that can deliver and reads a
lost item in the thread or as `contactShared`. Before the fix this ghost fills at once (`queueFail(a1)` then any
request of B). The two state forms stay in the model as named values (section 4).

`heldSlaAlerted` is new. It reads the ghost of the SLA check: every held item that waited past the SLA at the last
check raised the alert. Before the fix `slaAlerts` read only the review queue, so this fails.

### Properties outside `safety` (each simulated alone with the same seed and bounds)

| Property | Result | Why it is outside `safety` |
|---|---|---|
| noOneWayNumber | violated | SD-007, not in this fix batch (section 4) |
| threadOnlyDelivered, contactSharedImpliesDelivered | violated | lazy sync by design; the decision form is in `safety` |
| releaseReadsDelivered | violated | Q-relay-1 residual on the staff route (section 4) |
| consentFreshAtDelivery | violated | by design: freshness is checked at decision time |
| heldDecidedInTime | violated | by design: a held relay item does not expire; SD-133 is fixed by the alert |
| noStuckKey | violated | SD-093, liveness, not in this batch |
| heldAnswerHasRow | violated | SD-426, skipped (copy change) |

## 3. Defects: status and model changes

| Id | Status | Commit | Model change | Run tests |
|---|---|---|---|---|
| SD-039 | fixed | e2a3043 | `commitWithdraw` adds `withdrawn` to each passed share of the member; `queueSend` refuses an item row whose record is `withdrawn` | `withdrawAfterSwapTest` |
| SD-040 | fixed | 5b49e03 | `erase` also nulls rows of items relayed from the member (by their `relay_records` row) and ends the ones that wait | `erasedNumberGoneTest`, `erasedQueuedShareTest` |
| SD-064 | fixed (flag half) | d77edd7 | `textDecision("minorClef")` sets `ageSignal`, so the held row keeps no text | `clefMinorNotKeptTest` |
| SD-133 | fixed | 7226ac6 | new action `slaTick`; new invariant `heldSlaAlerted` | `heldSlaAlertTest` |
| SD-137 | fixed | 65f8618 | `postCommitThrow` became `postCommitDeliverError`, which answers the committed decision | `postCommitDeliverErrorTest` |
| SD-138 | fixed | 8da2400 | the swap ask is not deferred; a refused or quiet-hours ask logs nothing and leaves no swap; `queueSend` sends an ask only while its swap waits inside 15 minutes | `askRefusedTest`, `askQuietTest`, `askLateTest` |
| SD-252 | fixed | 1457b23 | `syncUnsent` before each endpoint decision; `tickFlush` calls `unsentDesk` for refused deferred items | `unsentShareResetTest`, `deferredShareRefusedTest`, `oneWayDeferredTest` |
| Q-relay-1 | fixed (endpoint path) | 1457b23 | the same sync removes the wording from the thread | `threadDropsUndeliveredTest` |
| SD-320 | fixed (rate half) | 26731a6 | `LogRec.rateOnly`; `priorReplays` does not replay a rate-only hold, so `photoRequest` can run again | `photoRateHoldTest` |
| SD-387 | fixed | f72d226 | `logPut` never drops the row of an item in status `held` | `logCapTest` |
| SD-426 | skipped | - | none; `heldAnswerHasRow` stays outside `safety` | - |

Notes:

- SD-064: only the flag half is fixed. A relay age signal still does not change the member's age state. That needs a
  founder decision on whether a Clef model guess alone may mark a member as a minor and drop them from matching. The
  model has no age state change on this path.
- SD-320: the safety-hold half is not reproduced. `relayPairAdmission` refuses a held party before the desk runs, so
  no desk-held photo row is made (`photoHeldDecidable` holds).
- SD-426: skipped. Copy change, not allowed. The rate-only hold is answered and not queued on purpose (relay.ts "the
  member can try again"). A fix needs either a new notice text or a new behaviour that keeps the item and sends it
  later (a feature outside scope, which needs a founder decision).
- SD-138: an ask that the queue refuses (`relay:ask_expired`) after its swap completed or expired is correct: the
  number shares themselves carry the swap from then on.

## 4. Open findings after the fixes

### SD-007: a number swap still goes one way (open; not in this batch)

`noOneWayNumber` is outside `safety` with a comment. The register verdict is "refuted"; the first version of this
file asked to open it again. Four triggers are reachable:

1. Deferral (`oneWayDeferredTest`): B's share to A waits for A's quiet hours, B blocks A, the tick refuses it. A's
   share to B already went. (The SD-252 fix now writes B's record as not shared.)
2. Queue (`oneWayQueueTest`): one row goes, the other ends unsent.
3. Inside one unit: `Network.send` refuses the second share after the first is queued.
4. New with the SD-039 fix (`withdrawAfterSwapTest`): both shares pass in quiet hours, A withdraws, only A's share
   is stopped. B's number still goes to A, who took the swap back.

A fix needs a design decision on an all-or-nothing swap (for example, both rows wait until both are admitted, and a
withdrawal or refusal of one stops the other). That is outside this step.

### Q-relay-1 residual: a staff release reads the thread with no sync

`releaseReadsDelivered` (outside `safety`; `releaseReadsLostTest`). The staff release route (service.ts) does not
call `relayUnsent` before `RelayDesk.release`, and the release decides again with the thread as context
(relay.ts:389). A text that never went can still be in the thread then. The effect is low: it makes the release check
stricter, not looser. The fix direction is to call the same sync in the staff release unit.

### Lazy sync leaves stale rows when no decision comes

`threadOnlyDelivered` and `contactSharedImpliesDelivered` fail for ever when no later endpoint decision comes in the
match: the match closed, or a member was erased (the forget path drops deferred sends with no `unsent`). No decision
reads them then, but `network.relay_records.contact_shared` can stay `true` for a share that never went.

### Withdrawal and the log cap (not reachable in the bounds)

`cancelSwaps` marks only shares still in the in-memory log. A passed share whose log row the cap dropped (5000 newer
rows in the match's app) keeps its `relay_records` row without `consent:withdrawn`. The model cannot reach it with 4
requests; the gap is in the code.

### SD-137 residual: the answer read after commit

`answer()` (relay-endpoint.ts:127-136) reads the outbound row after the unit committed. If that read fails, the same
catch answers 409 `action_unresolved` though the effect committed. The model does not have this action; it needs a
database error on a read.

### SD-093: a crashed key stays `processing` (open; not in this batch)

`noStuckKey`: `claim(k) crash(k) replay(k)` answers 409 for ever. No effect was committed, so at-most-once holds.

### Consent freshness at delivery (not a defect)

A share decided inside the 15-minute TTL can be delivered later after quiet hours. The engine checks freshness at
decision time, and deferral is by design. Withdrawal now stops a waiting share (SD-039).

## 5. Register defects of this module not reproduced

| Id | Why |
|---|---|
| SD-319 | `review === "rejected"` with `decision === "pass"` is unreachable (a reject never changes the decision). |
| SD-321, SD-374, SD-375 | Photo states with no transition after expiry or a revoke over a rejection change nothing that the invariants read; the fixed delivery deadline is modelled and fails closed. |
| SD-332 | The endpoint receipt stops a replay of the same signed request before the desk. |
| SD-445 | Copy promise while the RELAY flag is off: outside the relay machine. |

## 6. Apalache

The model header sets `verify-steps=3` (it was 7). The first version found a counterexample at step 2 in 8 s, so 7
steps did not cost much then. With every invariant holding, Apalache must explore every path:

| Command | Result |
|---|---|
| `quint verify ... --invariant safety --max-steps 3` | no violation, 27 s (also through `bun run quint:check --verify`) |
| `quint verify ... --invariant safety --max-steps 4 --server-endpoint localhost:18847` | no violation up to the last invariant checks of state 4, when the 580 s limit stopped the run; not finished |
| `quint verify ... --invariant safety --max-steps 7 --server-endpoint localhost:18847` | stopped after 30 min with no result |

The default Apalache port (8822) is shared with other sessions on this machine and once dropped the connection
("Connection dropped"); the runs above with `--server-endpoint` used a private port. The random simulation (10000
traces of 25 steps) covers the longer traces.
