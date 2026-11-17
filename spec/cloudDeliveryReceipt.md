# Eliza Cloud delivery receipts

## Story: Recover a delivery through the canonical Cloud transport

> As an operator, I want the outbound queue to retry a confirmed temporary refusal under the original key and to reconcile uncertain acceptance without sending again.

### Transient refusal has a different response from unknown acceptance

On the dispatch path, Cloud can refuse temporarily while another delivery is pending, while infrastructure is unavailable, or after the gateway proves that it did not admit the send. A retryable refusal retries the same persisted delivery key. During receipt lookup, these transient responses do not prove absence. Only the explicit never-admitted result can put an unknown delivery back on the queue. A missing or malformed response remains unknown.

```quint
pure def cloudDispatchMayRetry(receiptLookup: bool, failed: bool, retryable: bool, status: int, code: str): bool =
  not(receiptLookup) and failed and retryable and
    ((status == 503 and code == "unavailable") or (status == 423 and code == "delivery_pending") or
     (status == 422 and code == "rejected"))

pure def cloudLookupConfirmsAbsence(receiptLookup: bool, failed: bool, retryable: bool, status: int, code: str): bool =
  receiptLookup and failed and retryable and status == 422 and code == "rejected"

pure def lawCloudLookupNeverUsesDispatchRetry(failed: bool, retryable: bool, status: int, code: str): bool =
  not(cloudDispatchMayRetry(true, failed, retryable, status, code))

pure def lawCloudTemporaryLookupDoesNotProveAbsence(failed: bool, retryable: bool, status: int): bool =
  not(cloudLookupConfirmsAbsence(true, failed, retryable, status, "unavailable"))
```

### The queued adapter requires a current canonical receipt

The queued adapter accepts a success only with a verified Cloud history result, a replay flag and distinct provider message IDs. First-contact handled turns use their separate gateway path. A supplied timestamp must be the gateway's canonical UTC acceptance time within the queue's creation and current time, allowing the existing signing clock tolerance at both ends. Preserve that original timestamp for accounting. An older response may omit the timestamp, in which case the queue records its own clock. An out-of-window or malformed supplied value leaves acceptance unknown and does not update history, counters or notifications.

```quint
pure def cloudReceiptTimeAllowed(queueCreatedAt: int, observedAt: int, tolerance: int,
    hasTime: bool, canonicalTime: bool, acceptedAt: int): bool =
  0 <= queueCreatedAt and 0 <= observedAt and 0 <= tolerance and queueCreatedAt <= observedAt + tolerance and
    (not(hasTime) or (canonicalTime and queueCreatedAt - tolerance <= acceptedAt and acceptedAt <= observedAt + tolerance))

pure def cloudDeliveryReceiptAllowed(status: int, accepted: bool, hasHistory: bool, hasIds: bool,
    hasReplayFlag: bool, validTime: bool): bool =
  status == 200 and accepted and hasHistory and hasIds and hasReplayFlag and validTime

pure def lawCloudQueuedReceiptNeedsHistory(status: int, accepted: bool, hasIds: bool, hasReplayFlag: bool, validTime: bool): bool =
  not(cloudDeliveryReceiptAllowed(status, accepted, false, hasIds, hasReplayFlag, validTime))
```
