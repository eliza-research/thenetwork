# Record a signed turn receipt

The [signed turn model](models/turn_consent.md) follows the gateway turn, its collected replies, and the consent projection. This module decides which acknowledgments can update a completed handled turn. Signature verification, exact reply comparison, and the transaction remain in the service.

## Story: Record the gateway's delivery result once

> As an operator, I want the service to acknowledge the exact replies it collected and record only the delivery status the gateway confirmed.

### A receipt belongs to a completed handled turn under current authority

Check the existing turn and its route authority under the receipt transaction's lock. A repeated acknowledgment with the same values is a successful replay. A different acknowledgment can replace one that was unknown only when it supplies a final outcome. Other differences cause a conflict.

```quint
type ReceiptPhase = ReadingTurn | CheckingAuthority | CheckingPrevious | CheckingScope | CheckingDelivery |
  AwaitingEmptyWrite | AwaitingReplyWrite | Stored | Replayed | TurnUnavailable | AuthorityInvalid | Conflict | ScopeInvalid | DeliveryInvalid
type TurnReceipt = { phase: ReceiptPhase }

pure val initial: TurnReceipt = { phase: ReadingTurn }

pure def canCheckTurn(receipt: TurnReceipt): bool = receipt.phase == ReadingTurn
pure def checkTurn(receipt: TurnReceipt, handled: bool): TurnReceipt =
  { phase: if (handled) CheckingAuthority else TurnUnavailable }

pure def canCheckAuthority(receipt: TurnReceipt): bool = receipt.phase == CheckingAuthority
pure def checkAuthority(receipt: TurnReceipt, validAuthority: bool): TurnReceipt =
  { phase: if (validAuthority) CheckingPrevious else AuthorityInvalid }

pure def canReadPrevious(receipt: TurnReceipt): bool = receipt.phase == CheckingPrevious
pure def readPrevious(receipt: TurnReceipt, identical: bool, alreadyStored: bool, previouslyUnknown: bool, finalDelivery: bool): TurnReceipt =
  if (identical) { phase: Replayed }
  else if (alreadyStored and not(previouslyUnknown and finalDelivery)) { phase: Conflict }
  else { phase: CheckingScope }
```

### A receipt names exactly the replies the turn collected

If the turn collected no replies, accept only an empty receipt with no provider IDs or recorded history. For a turn with replies, require the same reply IDs in the same order. An accepted delivery needs a provider ID and recorded history. Only a stored account-free policy reply or canonical join prompt may omit history. Unknown and rejected results must omit recorded history.

```quint
pure def canCheckScope(receipt: TurnReceipt): bool = receipt.phase == CheckingScope
pure def checkScope(receipt: TurnReceipt, collectedReplies: bool, orderedIdsMatch: bool, providerIds: bool, history: bool): TurnReceipt =
  if (not(orderedIdsMatch) or (not(collectedReplies) and (providerIds or history))) { phase: ScopeInvalid }
  else { phase: if (collectedReplies) CheckingDelivery else AwaitingEmptyWrite }

pure def canCheckDelivery(receipt: TurnReceipt): bool = receipt.phase == CheckingDelivery
pure def checkDelivery(receipt: TurnReceipt, accepted: bool, providerIds: bool, history: bool, accountFree: bool): TurnReceipt =
  if (if (accepted) providerIds and (history or accountFree) else not(history)) { phase: AwaitingReplyWrite }
  else { phase: DeliveryInvalid }

pure def noHistoryAllowed(accountFree: bool, compliance: bool, canonicalJoinPrompt: bool): bool =
  accountFree and (compliance or canonicalJoinPrompt)
```

### Update the turn and the reply history together

Store the validated receipt. For a turn with replies also update each collected or unknown reply in the same transaction. Accepted results record the send, unknown results leave it pending, and rejected results end it. Replayed receipts need no new write.

```quint
pure def canRecordReceipt(receipt: TurnReceipt): bool = receipt.phase == AwaitingEmptyWrite or receipt.phase == AwaitingReplyWrite
pure def recordReceipt(receipt: TurnReceipt): TurnReceipt = { phase: Stored }

pure def receiptAccepted(delivery: str): bool = delivery == "accepted"
pure def receiptFinal(delivery: str): bool = receiptAccepted(delivery) or delivery == "rejected"
pure def receiptMessageStatus(delivery: str): str =
  if (receiptAccepted(delivery)) "sent" else if (delivery == "unknown") "send_unknown" else "refused_gateway"

pure def stepReceiptNeedsAdmission(before: TurnReceipt, via: str, after: TurnReceipt): bool =
  after.phase == Stored implies (via == "recordReceipt" and canRecordReceipt(before))

pure def sometimesCanStoreReceipt(receipt: TurnReceipt): bool = receipt.phase == Stored
pure def sometimesCanReplayReceipt(receipt: TurnReceipt): bool = receipt.phase == Replayed
```
