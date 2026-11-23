# Outbound provider receipts

The [outbound queue model](models/outbound_queue.md) covers queue admission, opt-out, leases, and delivery. This module owns the provider-facing status and retry transitions. The [VibeLang send shell](../packages/core/src/vibe/outboundReceiptShell.vibe) sequences the provider call and its outcome writes. The queue owns immutable content, the lease, receipt lookup, and accepted-delivery accounting.

## Story: Know whether a queued message reached the provider

> As an operator, I want a message to retain its latest delivery status even when provider updates arrive out of order.

### A provider receipt advances through acceptance, send, delivery, and read

The provider's queued response means accepted. Subsequent status updates advance accepted, sent, delivered, and read in that order. A failure update can end an accepted or sent message. A delivered or read message ignores a later failure. A row that the provider queued before the queue recorded its own acceptance (`QueuedBeforeAcceptance`) can advance on send, delivery, or read, and keeps its existing failure behavior. Changed (2026-11-23): only the name of this phase changed, from `LegacyQueued`, because the new name says what the state is.

```quint
type ReceiptPhase = Sending | QueuedBeforeAcceptance | ProviderAccepted | ProviderSent | ProviderDelivered | ProviderRead | ProviderFailed |
  AcceptanceUnknown | AcceptanceExpired | RetryScheduled | WaitingForReply | ProviderBlocked | OutsideReceipt
type ReceiptLifecycle = { phase: ReceiptPhase }

pure val initial: ReceiptLifecycle = { phase: Sending }

pure def receiptRank(phase: ReceiptPhase): int =
  if (phase == ProviderAccepted or phase == QueuedBeforeAcceptance) 1
  else if (phase == ProviderSent) 2
  else if (phase == ProviderDelivered) 3
  else if (phase == ProviderRead) 4
  else 0

pure def canRecordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): bool =
  (outbound.phase == Sending or outbound.phase == AcceptanceUnknown) and
    ((receiptRank(providerPhase) > 0 and providerPhase != QueuedBeforeAcceptance) or providerPhase == ProviderFailed)

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

After an ambiguous provider response, wait for receipt lookup with the original idempotency key. If a response arrives but its acceptance cannot be validated or committed, retain the request for the same lookup. The queue updates only the send attempt whose lease still owns the row. If the outcome write also fails, leave the lease for recovery. If the provider confirms it never admitted the key, the queue can retry with that same key. If the lookup remains uncertain past the retention deadline, the queue fails the row without resending.

```quint
pure def canHoldUnrecordedReceipt(outbound: ReceiptLifecycle): bool = outbound.phase == Sending

pure def holdUnrecordedReceipt(outbound: ReceiptLifecycle): ReceiptLifecycle =
  { phase: AcceptanceUnknown }

pure def stepUnrecordedReceiptWaits(before: ReceiptLifecycle, via: str, after: ReceiptLifecycle): bool =
  via == "holdUnrecordedReceipt" implies before.phase == Sending and after.phase == AcceptanceUnknown

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

### A send that may have reached the person keeps its person-cap slot

Only a send that the provider refused or reported failed gives back its slot of the person's daily cap of proactive messages. A send whose acceptance is unknown, or stayed unknown past the deadline, may have reached the person, so it keeps its slot, as does an accepted send. Changed 2026-11-18: the queue gave back the slot of a send that expired unknown (SD-090), so a further proactive text could go the same day.

```quint
pure def returnsPersonSlot(phase: ReceiptPhase): bool = phase == ProviderFailed or phase == ProviderBlocked

pure def lawUncertainSendKeepsSlot(phase: ReceiptPhase): bool =
  (phase == AcceptanceUnknown or phase == AcceptanceExpired or receiptRank(phase) > 0) implies not(returnsPersonSlot(phase))
```

### An acceptance records a send time only for a send that went out

An acceptance whose provider status is failed gets no send time, because the caps and the leak guard's thread history read the send time. A row to someone who is not a member ends at acceptance when the provider owns the delivery receipts (Eliza Cloud sends none to the queue), and then keeps no address and no text. Changed 2026-11-18: a failed acceptance wrote a send time (SD-337), and under Cloud a row to a non-member kept its address and text after acceptance (SD-091).

```quint
pure def acceptanceRecordsSend(phase: ReceiptPhase): bool = receiptRank(phase) > 0

pure def acceptanceEndsRow(phase: ReceiptPhase, receiptOwner: bool, member: bool): bool =
  phase == ProviderDelivered or phase == ProviderRead or phase == ProviderFailed or
    (receiptOwner and not(member) and receiptRank(phase) > 0)

pure def lawFailedAcceptanceRecordsNoSend(phase: ReceiptPhase): bool =
  phase == ProviderFailed implies not(acceptanceRecordsSend(phase))

pure def lawReceiptOwnerEndsNonMemberRow(phase: ReceiptPhase): bool =
  receiptRank(phase) > 0 implies acceptanceEndsRow(phase, true, false)
```

### A gateway reply with no final receipt ends after the receipt deadline

A reply that the gateway took in a signed turn waits for the turn receipt, as does a reply whose receipt said unknown. The gateway may have sent it, so the queue never sends it. When no accepted or rejected receipt came before the deadline of an unknown acceptance, counted from when the reply was collected, the reply ends as an expired acceptance (failed unknown). It keeps its text and returns no person-cap slot. A turn receipt names only the replies of its own turn, so a receipt that comes after the deadline still records what the gateway did: an accepted receipt makes the expired reply sent, with its send time, its place in the thread history and its count in the unanswered streak, and a rejected receipt makes it refused. An expired reply records its send at the time it was collected, not at the time the late receipt came, because the gateway sends the replies of a turn when the turn ends; the unanswered streak then does not count a reply that the member answered before the receipt came. A late unknown receipt changes nothing. Changed (audit SD-100): nothing ended such a reply, the queue dropped a late accepted receipt, and a late receipt recorded the send at its own time -> the reply expires at the deadline and a late final receipt still records it at the time it was collected, because a reply stayed open forever, a sent booking notice never counted as received, and a reply that the member had answered counted in the unanswered streak.

```quint
pure def gatewayReplyPhase(pastLimit: bool): ReceiptPhase = if (pastLimit) AcceptanceExpired else AcceptanceUnknown

pure val replyStatusValues = Set("collected", "send_unknown", "failed_unknown", "sent", "accepted")
pure val deliveryValues = Set("accepted", "unknown", "rejected")

pure def gatewayReceiptApplies(replyStatus: str, delivery: str): bool =
  replyStatus == "collected" or replyStatus == "send_unknown" or (replyStatus == "failed_unknown" and delivery != "unknown")

pure def gatewayReplySendTime(replyStatus: str, collectedAt: int, receivedAt: int): int =
  if (replyStatus == "failed_unknown") collectedAt else receivedAt

pure def lawExpiredReplySendsAtCollection(replyStatus: str, collectedAt: int, receivedAt: int): bool =
  replyStatus == "failed_unknown" implies gatewayReplySendTime(replyStatus, collectedAt, receivedAt) == collectedAt

pure def lawReplySendTimeNotAfterReceipt(replyStatus: str, collectedAt: int, receivedAt: int): bool =
  collectedAt <= receivedAt implies gatewayReplySendTime(replyStatus, collectedAt, receivedAt) <= receivedAt

pure def lawLateUnknownReceiptKeepsExpiredReply(replyStatus: str): bool =
  replyStatus == "failed_unknown" implies not(gatewayReceiptApplies(replyStatus, "unknown"))

pure def lawGatewayReceiptNeverChangesAFinalReply(delivery: str): bool =
  not(gatewayReceiptApplies("sent", delivery)) and not(gatewayReceiptApplies("accepted", delivery))

pure def lawLateFinalReceiptEndsAnExpiredReply(delivery: str): bool =
  delivery != "unknown" implies gatewayReceiptApplies("failed_unknown", delivery)

pure def lawExpiredGatewayReplyKeepsSlot(pastLimit: bool): bool = not(returnsPersonSlot(gatewayReplyPhase(pastLimit)))
```

Conformance. test/fixtures/outboundReceiptWorker.ts queues one compliance text for each key, each on its own line and clock. The provider holds each send until an event decides it, so Sending is the row that the queue claimed and leased. Receipts come through the status and receipt-lookup paths of the queue. A receipt event for a phase that has no provider delivery status sends nothing.
