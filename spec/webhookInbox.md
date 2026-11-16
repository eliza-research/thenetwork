# Process a sender's queued webhook messages

The [signed turn model](models/turn_consent.md) also covers the sender's pending webhook inbox. This spec governs the webhook queue's selection and attempt transitions. Postgres owns durable insertion, the sender lock, sorted reads, and row updates.

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

### A completed STOP clears earlier ordinary rows and errors retry at most five times

On success, record completion. A STOP cancels selected pending ordinary rows from the same sender with receive times at or before its own. Other compliance requests do not cancel them. If handling throws, count the failure. Retain the row for the next tick when attempts remain and stop this sender's current drain. After the fifth failure, record the row as failed and proceed to the next row.

```quint
pure val webhookAttemptLimit: int = 5
type WebhookPhase = RunningWebhook | CancelEarlier | WebhookDone | RetryWebhook | DropWebhook
type WebhookTurn = { phase: WebhookPhase }
pure val initial: WebhookTurn = { phase: RunningWebhook }

pure def canRecordHandled(turn: WebhookTurn): bool = turn.phase == RunningWebhook
pure def recordHandled(turn: WebhookTurn, stopCommand: bool): WebhookTurn =
  { phase: if (stopCommand) CancelEarlier else WebhookDone }

pure def canRecordFailure(turn: WebhookTurn): bool = turn.phase == RunningWebhook
pure def recordFailure(turn: WebhookTurn, attempts: int): WebhookTurn =
  { phase: if (attempts >= webhookAttemptLimit) DropWebhook else RetryWebhook }

pure def earlierWebhookCancellable(selectedTurn: bool, compliance: bool): bool =
  not(selectedTurn) and not(compliance)

pure def lawNeverCancelCompliance(selectedTurn: bool): bool = not(earlierWebhookCancellable(selectedTurn, true))

pure def sometimesCanRetryWebhook(turn: WebhookTurn): bool = turn.phase == RetryWebhook
```

### Report the received row's stored result after draining

Return the stored result for a completed row, report failure for a failed row, and leave other rows pending for a later attempt.

```quint
type WebhookAnswer = StoredWebhookAnswer | StoredWebhookFailure | WaitForRetry
pure def webhookAnswer(done: bool, failed: bool): WebhookAnswer =
  if (done) StoredWebhookAnswer else if (failed) StoredWebhookFailure else WaitForRetry
```
