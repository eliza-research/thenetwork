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

After handling succeeds, record completion. A STOP selects for cancellation every ordinary row in its window other than itself. Complete the STOP and cancel these rows in one database write. Other compliance requests select no rows, and a STOP never selects a compliance row. The queue reports completion only after the write commits.

```quint
type WebhookPhase = RunningWebhook | CompleteWebhook | CancelEarlier | WebhookDone | RetryWebhook | DropWebhook
type WebhookTurn = { phase: WebhookPhase }
pure val initial: WebhookTurn = { phase: RunningWebhook }

pure def canRecordHandled(turn: WebhookTurn): bool = turn.phase == RunningWebhook
pure def recordHandled(turn: WebhookTurn, stopCommand: bool): WebhookTurn =
  { phase: if (stopCommand) CancelEarlier else CompleteWebhook }

pure def canRecordCompletion(turn: WebhookTurn): bool = turn.phase == CompleteWebhook or turn.phase == CancelEarlier
pure def recordCompletion(turn: WebhookTurn): WebhookTurn = { phase: WebhookDone }

pure def stepDoneRequiresCompletion(before: WebhookTurn, via: str, after: WebhookTurn): bool =
  after.phase == WebhookDone implies (via == "recordCompletion" and canRecordCompletion(before))

pure def sometimesCanCompleteWebhook(turn: WebhookTurn): bool = turn.phase == WebhookDone

pure def earlierWebhookCancellable(selectedTurn: bool, compliance: bool): bool =
  not(selectedTurn) and not(compliance)

pure def lawNeverCancelCompliance(selectedTurn: bool): bool = not(earlierWebhookCancellable(selectedTurn, true))
```

### A failed STOP stays pending and other rows can exhaust their attempts

If the handler or completion write fails, count the failure. Any completion changes roll back. While attempts remain, keep the row pending for the next drain and stop this sender's current drain. After the fifth failure of an ordinary row or a different compliance command, mark it failed and continue. STOP and STOP ALL stay pending even after five failures.

```quint
pure val webhookAttemptLimit: int = 5

pure def canRecordFailure(turn: WebhookTurn): bool = turn.phase == RunningWebhook or canRecordCompletion(turn)
pure def recordFailure(turn: WebhookTurn, attempts: int, stopCommand: bool): WebhookTurn =
  { phase: if (attempts >= webhookAttemptLimit and not(stopCommand)) DropWebhook else RetryWebhook }

pure def lawStopNeverDrops(turn: WebhookTurn, attempts: int): bool =
  recordFailure(turn, attempts, true).phase == RetryWebhook

pure def sometimesCanRetryWebhook(turn: WebhookTurn): bool = turn.phase == RetryWebhook
```

### Report the received row's stored result after draining

Return the stored result for a completed row, report failure for a failed row, and leave other rows pending for a later attempt.

```quint
type WebhookAnswer = StoredWebhookAnswer | StoredWebhookFailure | WaitForRetry
pure def webhookAnswer(done: bool, failed: bool): WebhookAnswer =
  if (done) StoredWebhookAnswer else if (failed) StoredWebhookFailure else WaitForRetry
```
