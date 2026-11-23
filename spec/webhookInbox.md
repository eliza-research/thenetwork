# Process a sender's queued webhook messages

The [signed turn model](models/turn_consent.md) also covers the sender's pending webhook inbox. The [VibeLang drain shell](../packages/core/src/vibe/webhookInboxShell.vibe) runs the generated selection and attempt transitions. Postgres owns durable insertion, the sender lock, sorted reads, and atomic completion. The completion write cancels a selected row only when it is still pending, comes from the same sender, and has a receive time at or before the STOP's own.

## Story: Handle my pending messages in order while prioritizing consent

> As a member, I want duplicate webhook delivery to be harmless and a consent request to take priority over ordinary messages.

### Dedupe a received message and choose the next pending turn

A webhook first inserts one durable row for the provider message ID. If the row already exists, report a duplicate. Read at most fifty waiting rows in time and ID order. Choose the first compliance message in that window when one exists. Otherwise choose the first ordinary message when a signed turn does not hold this sender's queue.

```quint
pure val webhookScanLimit: int = 50

type ArrivalResult = DrainSender | DuplicateWebhook
pure def webhookArrival(inserted: bool): ArrivalResult = if (inserted) DrainSender else DuplicateWebhook

type QueueChoice = QueueEmpty | RunCompliance | WaitForSignedTurn | RunOldest
pure def chooseWebhook(hasWaiting: bool, complianceFound: bool, signedTurnBlocks: bool): QueueChoice =
  if (not(hasWaiting)) QueueEmpty
  else if (complianceFound) RunCompliance
  else if (signedTurnBlocks) WaitForSignedTurn
  else RunOldest

pure def lawComplianceGoesFirst(signedTurnBlocks: bool): bool =
  chooseWebhook(true, true, signedTurnBlocks) == RunCompliance
```

### Completing a STOP clears earlier ordinary rows in the same write

The attempt starts when the drain selects a pending row: it stores the row's earlier failure count and whether the row is a STOP, because the completion and failure steps of this attempt must read these values from the attempt, not from the caller. This start step is new, so that the stored values and not an event field decide whether a failed STOP is dropped. Only a pending row is selected, so an ordinary row that already failed five times never starts an attempt. After handling succeeds, record completion. A STOP selects for cancellation every ordinary row in its window other than itself. Complete the STOP and cancel these rows in one database write. Other compliance requests select no rows, and a STOP never selects a compliance row. The queue reports completion only after the write commits.

```quint
type WebhookPhase = WebhookQueued | RunningWebhook | CompleteWebhook | CancelEarlier | WebhookDone | RetryWebhook | DropWebhook
type WebhookTurn = { phase: WebhookPhase, attempts: int, stopCommand: bool }
pure val initial: WebhookTurn = { phase: WebhookQueued, attempts: 0, stopCommand: false }

pure val attemptsValues: Set[int] = Set(0, 1, 4, 5, 6)

pure def canStartWebhook(turn: WebhookTurn, attempts: int, stopCommand: bool): bool =
  turn.phase == WebhookQueued and attempts >= 0 and (stopCommand or attempts < webhookAttemptLimit)
pure def startWebhook(turn: WebhookTurn, attempts: int, stopCommand: bool): WebhookTurn =
  { phase: RunningWebhook, attempts: attempts, stopCommand: stopCommand }

pure def canRecordHandled(turn: WebhookTurn): bool = turn.phase == RunningWebhook
pure def recordHandled(turn: WebhookTurn): WebhookTurn =
  { ...turn, phase: if (turn.stopCommand) CancelEarlier else CompleteWebhook }

pure def canRecordCompletion(turn: WebhookTurn): bool = turn.phase == CompleteWebhook or turn.phase == CancelEarlier
pure def recordCompletion(turn: WebhookTurn): WebhookTurn = { ...turn, phase: WebhookDone }

pure def stepDoneRequiresCompletion(before: WebhookTurn, via: str, after: WebhookTurn): bool =
  after.phase == WebhookDone implies (via == "recordCompletion" and canRecordCompletion(before))

pure def sometimesCanCompleteWebhook(turn: WebhookTurn): bool = turn.phase == WebhookDone

pure def earlierWebhookCancellable(selectedTurn: bool, compliance: bool): bool =
  not(selectedTurn) and not(compliance)

pure def lawNeverCancelCompliance(selectedTurn: bool): bool = not(earlierWebhookCancellable(selectedTurn, true))
```

### A failed STOP stays pending and other rows can exhaust their attempts

If the handler or completion write fails, count the failure. Any completion changes roll back. While attempts remain, keep the row pending for the next drain and stop this sender's current drain. After the fifth failure of an ordinary row or a different compliance command, mark it failed and continue. STOP and STOP ALL stay pending even after five failures. The failure step now counts the failure on the attempt's stored count and reads the attempt's stored STOP flag, where it took both as event fields before, because those fields let a STOP attempt be dropped.

```quint
pure val webhookAttemptLimit: int = 5

pure def canRecordFailure(turn: WebhookTurn): bool = turn.phase == RunningWebhook or canRecordCompletion(turn)
pure def recordFailure(turn: WebhookTurn): WebhookTurn =
  { ...turn, attempts: turn.attempts + 1,
    phase: if (turn.attempts + 1 >= webhookAttemptLimit and not(turn.stopCommand)) DropWebhook else RetryWebhook }

pure def alwaysStopNeverDropped(turn: WebhookTurn): bool =
  turn.phase == DropWebhook implies not(turn.stopCommand)

pure def lawStopNeverDrops(turn: WebhookTurn): bool =
  turn.stopCommand implies recordFailure(turn).phase == RetryWebhook

pure def sometimesCanRetryWebhook(turn: WebhookTurn): bool = turn.phase == RetryWebhook
```

### Report the received row's stored result after draining

Return the stored result for a completed row, report failure for a failed row, and leave other rows pending for a later attempt.

```quint
type WebhookAnswer = StoredWebhookAnswer | StoredWebhookFailure | WaitForRetry
pure def webhookAnswer(done: bool, failed: bool): WebhookAnswer =
  if (done) StoredWebhookAnswer else if (failed) StoredWebhookFailure else WaitForRetry
```

Conformance. test/fixtures/webhookInboxWorker.ts runs one handling attempt of one received row for each key, with its own sender and database, because a drain takes every sender. startWebhook receives the row, fails it the counted number of times, and holds the next attempt in the handler (RunningWebhook). A STOP row arrives after an ordinary row that is pending, so that its completion can cancel a row. The drain refuses an ordinary row that failed five times. The worker holds the completion with a transaction that locks the row, so CompleteWebhook and CancelEarlier are a completion write that waits on the lock; a failed completion write is that statement cancelled. The worker reads the attempt count from the row.
