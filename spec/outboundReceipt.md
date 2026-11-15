# Outbound provider receipts

The [outbound queue model](models/outbound_queue.md) covers queue admission, opt-out, leases, and delivery. This module owns the provider-facing status and retry transitions. The queue shell stores statuses, claims leases, calls the provider, and accounts for accepted deliveries.

## Story: Know whether a queued message reached the provider

> As an operator, I want a message to retain its latest delivery status even when provider updates arrive out of order.

### A provider receipt advances through acceptance, send, delivery, and read

The provider's queued response means accepted. Subsequent status updates advance accepted, sent, delivered, and read in that order. A failure update can end an accepted or sent message. A delivered or read message ignores a later failure. A legacy row stored as queued can advance on send, delivery, or read, and keeps its existing failure behavior.

```quint
type ReceiptPhase = Sending | LegacyQueued | ProviderAccepted | ProviderSent | ProviderDelivered | ProviderRead | ProviderFailed |
  AcceptanceUnknown | AcceptanceExpired | RetryScheduled | WaitingForReply | ProviderBlocked | OutsideReceipt
type ReceiptLifecycle = { phase: ReceiptPhase }

pure val initial: ReceiptLifecycle = { phase: Sending }

pure def receiptRank(phase: ReceiptPhase): int =
  if (phase == ProviderAccepted or phase == LegacyQueued) 1
  else if (phase == ProviderSent) 2
  else if (phase == ProviderDelivered) 3
  else if (phase == ProviderRead) 4
  else 0

pure def canRecordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): bool =
  (outbound.phase == Sending or outbound.phase == AcceptanceUnknown) and
    ((receiptRank(providerPhase) > 0 and providerPhase != LegacyQueued) or providerPhase == ProviderFailed)

pure def recordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle =
  { phase: providerPhase }

pure def canApplyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): bool =
  val rank = receiptRank(outbound.phase)
  rank > 0 and
    (if (providerPhase == ProviderFailed) outbound.phase == ProviderAccepted or outbound.phase == ProviderSent
     else receiptRank(providerPhase) > rank)

pure def applyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle =
  { phase: providerPhase }

pure def stepReceiptsDoNotRegress(before: ReceiptLifecycle, via: str, after: ReceiptLifecycle): bool =
  (via == "applyReceipt" and after.phase != ProviderFailed) implies receiptRank(after.phase) > receiptRank(before.phase)

pure def lawDeliveredIgnoresFailure(phase: ReceiptPhase): bool =
  (phase == ProviderDelivered or phase == ProviderRead) implies
    not(canApplyReceipt({ phase: phase }, ProviderFailed))
```

### An uncertain send waits for a receipt instead of sending again

After an ambiguous provider response, wait for receipt lookup with the original idempotency key. If the provider confirms it never admitted the key, the queue can retry with that same key. If the lookup remains uncertain past the retention deadline, the queue fails the row without resending.

```quint
pure def canConfirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: bool): bool =
  outbound.phase == AcceptanceUnknown and neverAdmitted

pure def confirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: bool): ReceiptLifecycle =
  { phase: RetryScheduled }

pure def canExpireUnknown(outbound: ReceiptLifecycle, pastLimit: bool): bool =
  outbound.phase == AcceptanceUnknown and pastLimit

pure def expireUnknown(outbound: ReceiptLifecycle, pastLimit: bool): ReceiptLifecycle =
  { phase: AcceptanceExpired }

pure def sometimesCanCheckUnknown(outbound: ReceiptLifecycle): bool = outbound.phase == AcceptanceUnknown
pure def sometimesCanRead(outbound: ReceiptLifecycle): bool = outbound.phase == ProviderRead
```

### A provider failure either waits or ends the send

Retryable errors can schedule another attempt while attempts remain. A provider conversation limit holds the row until the recipient responds. A provider block ends it as blocked. Other errors end it as failed.

```quint
type FailureKind = UnknownResult | Retryable | NeedReply | BlockedNumber | TerminalError

pure def canRecordProviderError(outbound: ReceiptLifecycle): bool = outbound.phase == Sending

pure def recordProviderError(outbound: ReceiptLifecycle, failure: FailureKind, hasAttemptsLeft: bool): ReceiptLifecycle =
  { phase:
    if (failure == UnknownResult) AcceptanceUnknown
    else if (failure == NeedReply) WaitingForReply
    else if (failure == BlockedNumber) ProviderBlocked
    else if (failure == Retryable and hasAttemptsLeft) RetryScheduled
    else ProviderFailed }

pure def lawAnUnknownResultDoesNotRetry(hasAttemptsLeft: bool): bool =
  recordProviderError(initial, UnknownResult, hasAttemptsLeft).phase == AcceptanceUnknown
```
