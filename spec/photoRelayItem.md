# Selected-photo relay delivery

One approved relay item belongs to one sender, one recipient, and one selection. The [standalone relay item model](models/photo_relay_item.md) also covers selection and review. Production uses this state machine for action binding, capability issuance, and fetch admission. The shell validates the parties, consent, policy, descriptor, and signature and keeps all writes under the existing item lock. The state machine receives no photo data.

## Story: Deliver only the approved selected photo

> As the sender, I want my consent to cover only the photo and delivery I approved.

### A current approved item binds to one action

The delivery phase begins after item approval. A claim requires current approval and the same eligible parties. The first claim records the action ID. A retry of the same action may use the item, while another action cannot claim it.

```quint
type PhotoDeliveryPhase = PhotoWaiting | PhotoApproved
type PhotoDelivery = {
  phase: PhotoDeliveryPhase,
  expiresAt: int,
  boundAction: bool, actionKey: str,
  boundIntent: bool, intentKey: str,
  hasDeadline: bool, deliveryUntil: int,
}

pure val initial: PhotoDelivery = {
  phase: PhotoWaiting, expiresAt: 0,
  boundAction: false, actionKey: "", boundIntent: false, intentKey: "", hasDeadline: false, deliveryUntil: 0,
}

pure def canObserveApproval(photo: PhotoDelivery): bool = photo.phase == PhotoWaiting
pure def observeApproval(photo: PhotoDelivery, expiresAt: int): PhotoDelivery = { ...photo, phase: PhotoApproved, expiresAt: expiresAt }

pure def canClaimAction(photo: PhotoDelivery, actionKey: str, currentItem: bool): bool =
  currentItem and photo.phase == PhotoApproved and (not(photo.boundAction) or photo.actionKey == actionKey)

pure def claimAction(photo: PhotoDelivery, actionKey: str, currentItem: bool): PhotoDelivery =
  { ...photo, boundAction: true, actionKey: actionKey }

pure def stepAnActionBindingNeverChanges(before: PhotoDelivery, after: PhotoDelivery): bool =
  before.boundAction implies after.boundAction and after.actionKey == before.actionKey
```

### Issuing a capability fixes the intent and deadline

Only a current approved item with a claimed action may issue a delivery capability. The first issuance binds the provider intent and fixes the earlier of the item's expiry and 60 seconds from issuance. Retrying the same intent keeps the fixed expiry. The capability must still be usable before return.

```quint
pure val providerFetchTtlMs: int = 60000

pure def deadlineForDelivery(photo: PhotoDelivery, at: int): int =
  if (photo.hasDeadline) photo.deliveryUntil
  else if (photo.expiresAt < at + providerFetchTtlMs) photo.expiresAt
  else at + providerFetchTtlMs

pure def canIssueDelivery(photo: PhotoDelivery, intentKey: str, currentItem: bool, issueAt: int, checkedAt: int): bool =
  currentItem and permitsIntentBinding(photo, intentKey) and deadlineForDelivery(photo, issueAt) > checkedAt

pure def permitsIntentBinding(photo: PhotoDelivery, intentKey: str): bool =
  photo.phase == PhotoApproved and photo.boundAction and photo.actionKey != "" and
    (not(photo.boundIntent) or photo.intentKey == intentKey)

pure def issueDelivery(photo: PhotoDelivery, intentKey: str, currentItem: bool, issueAt: int, checkedAt: int): PhotoDelivery =
  { ...photo, boundIntent: true, intentKey: intentKey, hasDeadline: true, deliveryUntil: deadlineForDelivery(photo, issueAt) }

pure def stepAnIntentBindingNeverChanges(before: PhotoDelivery, after: PhotoDelivery): bool =
  before.boundIntent implies after.boundIntent and after.intentKey == before.intentKey

pure def stepAFixedDeadlineNeverChanges(before: PhotoDelivery, after: PhotoDelivery): bool =
  before.hasDeadline implies after.hasDeadline and after.deliveryUntil == before.deliveryUntil

pure def sometimesDeliveryWasIssued(photo: PhotoDelivery): bool = photo.boundIntent and photo.hasDeadline
```

### Fetches require the approved item and its exact live capability

The fetch needs the approved item, a non-empty bound action and intent, and its exact fixed deadline. A fetch at or after the capability or item expiry is unavailable. Before returning any bytes, recheck the expiry after the existing signature, policy, party, and content checks.

```quint
pure def photoDeliveryStillLive(photo: PhotoDelivery, deadline: int, at: int): bool =
  deadline > at and photo.expiresAt > at

pure def photoFetchAllowed(photo: PhotoDelivery, deadline: int, at: int): bool =
  photo.phase == PhotoApproved and photo.boundAction and photo.actionKey != "" and photo.boundIntent and photo.intentKey != "" and
    photo.hasDeadline and deadline == photo.deliveryUntil and deadline <= photo.expiresAt and photoDeliveryStillLive(photo, deadline, at)
```

## Story: Choose the photo to relay in the conversation

> As a matched adult Slop member, I want to pick one of my own photos by text and agree to its notice, so that the choice goes to review without a website.

### A photo request delivers an approved choice, lists the photos, or records the named photo

The relay endpoint reads the member's own message for the current match. An approved, unclaimed item for this match is delivered first. Otherwise, when selected-photo relay is configured, a request without a number lists the member's photos by number with the current notice, and the shell stores that list for this match. A request that names a number records that one offered photo as one pending item for review, which is the member's consent for that item only. The number counts only within fifteen minutes of the list and under the same notice. A member without photos is told how to add them. The shell checks the choice before the reply and writes the item in the same transaction that completes the relay action, so an action that fails keeps no item the member was not told about. Added after the audit (OPP22): before this rule no member surface could choose a photo, so photo relay could never start. Changed after the audit (PRI-D1): before this change the item was written in its own transaction before the action completed.

```quint
type PhotoRelayEntry = DeliverApprovedPhoto | OfferPhotoChoices | RecordPhotoChoice | AskForPhotosFirst | PhotoRelayOff | PhotoChoiceUnknown

pure val photoRelayOfferTtlMs: int = 900000

pure def photoRelayOfferLive(offeredAt: int, at: int, sameNotice: bool): bool =
  sameNotice and at >= offeredAt and at - offeredAt < photoRelayOfferTtlMs

pure def photoRelayEntryFor(relayOn: bool, approvedReady: bool, photoCount: int, choice: int, offerLive: bool, offerSize: int): PhotoRelayEntry =
  if (approvedReady) DeliverApprovedPhoto
  else if (not(relayOn)) PhotoRelayOff
  else if (choice == 0 and photoCount > 0) OfferPhotoChoices
  else if (choice == 0) AskForPhotosFirst
  else if (offerLive and choice >= 1 and choice <= offerSize) RecordPhotoChoice
  else PhotoChoiceUnknown

pure def lawChoiceNeedsLiveOffer(relayOn: bool, approvedReady: bool, photoCount: int, choice: int, offerSize: int): bool =
  photoRelayEntryFor(relayOn, approvedReady, photoCount, choice, false, offerSize) != RecordPhotoChoice

pure def lawChoiceStaysInsideTheList(relayOn: bool, approvedReady: bool, photoCount: int, choice: int, offerLive: bool, offerSize: int): bool =
  photoRelayEntryFor(relayOn, approvedReady, photoCount, choice, offerLive, offerSize) == RecordPhotoChoice implies (choice >= 1 and choice <= offerSize)

pure def lawNothingChosenWhenRelayIsOff(photoCount: int, choice: int, offerLive: bool, offerSize: int): bool =
  photoRelayEntryFor(false, false, photoCount, choice, offerLive, offerSize) == PhotoRelayOff

pure def lawStaleListIsNotLive(offeredAt: int, sameNotice: bool): bool =
  not(photoRelayOfferLive(offeredAt, offeredAt + photoRelayOfferTtlMs, sameNotice))
```

### A withdrawal by text revokes the member's open photo items for the match

A member who says not to send their photo (for example "don't send my photo") withdraws it in the conversation. For the current match, the shell revokes each item that the member owns for this match and that is still pending or approved, also an approved item that a delivery has claimed but not fetched, in the transaction that completes the relay action. A revoked item is never delivered. The reply says that the photo will not be sent, or that no photo was waiting for this match. Added after the audit (PRI-D1): before this rule only a site route could revoke an item, and there is no account portal, so a member who chose a photo by text could not take it back before delivery. When an item that the reply counted is no longer withdrawable at the commit (a delivery or another revoke took it first), the relay action fails and the reply is not sent, so the member is never told that a photo will not be sent when it was. The site revoke and the text withdrawal use the same revoke step. Changed after review: the reply first counted the items before the commit and was sent even when the commit revoked fewer.

```quint
type PhotoWithdrawal = PhotoWithdrawn | NoPhotoToWithdraw

pure def photoItemWithdrawable(ownItem: bool, sameMatch: bool, open: bool): bool =
  ownItem and sameMatch and open

pure def photoWithdrawalFor(withdrawn: int): PhotoWithdrawal =
  if (withdrawn > 0) PhotoWithdrawn else NoPhotoToWithdraw

pure def lawOnlyOwnItemsAreWithdrawn(sameMatch: bool, open: bool): bool =
  not(photoItemWithdrawable(false, sameMatch, open))

pure def lawOnlyThisMatchIsWithdrawn(ownItem: bool, open: bool): bool =
  not(photoItemWithdrawable(ownItem, false, open))

pure def lawNothingWithdrawnSaysSo(withdrawn: int): bool =
  withdrawn <= 0 implies photoWithdrawalFor(withdrawn) == NoPhotoToWithdraw
```
