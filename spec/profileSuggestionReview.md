# Review a proposed profile fact

A member can read an eligible batch of suggestions and send an explicit command for one item. The resulting intent goes to the store. The store independently rechecks owner, source consent, revision and expiry when it applies an action.

## Story: Review suggestions before they change my profile

> As a member, I want to see where a suggested fact came from and decide what can happen to it.

### A review starts with no authorized batch

The shell receives the batch and authenticated owner. It validates integer time and revision values, and checks the batch ID format. The model receives whether the batch is pending and whether the person, app and chat match.

```quint
type ReviewPhase = Unchecked | NeedsItems | BatchUnavailable | ReadyToReview | CommandRefused | AcceptItem | RejectItem | PreviewEdit
type ReviewVerb = AcceptVerb | RejectVerb | EditVerb
type ReviewRequest = { phase: ReviewPhase, metadataApproved: bool, itemsApproved: bool, commandBound: bool }

pure val initial: ReviewRequest = {
  phase: Unchecked, metadataApproved: false, itemsApproved: false, commandBound: false,
}
```

### Only a current batch for the same person, app and chat enters review

The batch is pending, has a valid ID and a positive revision, belongs to the authenticated person, app and chat, and expires strictly after the check time.

```quint
pure def canCheckBatch(review: ReviewRequest): bool = review.phase == Unchecked

pure def reviewBeforeExpiry(asOf: int, expiresAt: int): bool = asOf < expiresAt

pure def checkBatch(review: ReviewRequest, pending: bool, ownerMatches: bool,
    batchIdValid: bool, revision: int, asOf: int, expiresAt: int): ReviewRequest =
  val eligible = pending and ownerMatches and batchIdValid and revision > 0 and reviewBeforeExpiry(asOf, expiresAt)
  { ...review, metadataApproved: eligible, phase: if (eligible) NeedsItems else BatchUnavailable }

pure def lawDeadlineDoesNotIncludeExpiry(expiresAt: int): bool =
  not(reviewBeforeExpiry(expiresAt, expiresAt))
```

### Only a bounded batch of distinct, valid suggestions can be shown

A batch has one to ten items with distinct IDs. The shell checks each item's ID, content, source, field type and observed time before the model makes the batch available. A Gmail suggestion must be observed at or before the check. A Calendar suggestion carries its event start, which can be in the future. The store applies the same observed-time rule when it saves a collection, so a batch that the store saves can always be shown. Changed 2026-11-18: the rendering path refused a future Calendar event start that the store had saved, and the member was then told that nothing was saved (SD-240).

```quint
pure def observedTimeAllowed(fromCalendar: bool, observedAt: int, asOf: int): bool =
  fromCalendar or observedAt <= asOf

pure def lawFutureGmailRefused(asOf: int): bool =
  not(observedTimeAllowed(false, asOf + 1, asOf))

pure val maxSuggestions: int = 10
pure val itemCountValues = Set(0, 1, 2, 10, 11)

pure def canCheckItems(review: ReviewRequest): bool =
  review.phase == NeedsItems and review.metadataApproved

pure def checkItems(review: ReviewRequest, itemCount: int, distinctIds: bool, allItemsValid: bool): ReviewRequest =
  val eligible = itemCount > 0 and itemCount <= maxSuggestions and distinctIds and allItemsValid
  { ...review, itemsApproved: eligible, phase: if (eligible) ReadyToReview else BatchUnavailable }
```

### A command targets this batch revision and one existing item

Accept needs an explicit private or matching scope. Reject takes no scope or wording. Edit takes valid replacement wording and requests a preview. The shell recognizes the command text and checks wording. It recognizes only the words private and matching as a scope, so a given scope is always one of these two scopes. Any other scope word makes the command text unrecognized, and the shell refuses it. The command must name the exact batch and revision and point to an existing item. A refused command sends no decision to the store.

```quint
pure def canReadCommand(review: ReviewRequest): bool =
  review.phase == ReadyToReview and review.metadataApproved and review.itemsApproved

pure def readCommand(review: ReviewRequest, verb: ReviewVerb, tokenMatches: bool, itemExists: bool,
    scopeGiven: bool, wordingGiven: bool, wordingValid: bool): ReviewRequest =
  val bound = tokenMatches and itemExists
  val resultingPhase =
    if (not(bound)) CommandRefused
    else if (verb == AcceptVerb and scopeGiven and not(wordingGiven)) AcceptItem
    else if (verb == RejectVerb and not(scopeGiven) and not(wordingGiven)) RejectItem
    else if (verb == EditVerb and not(scopeGiven) and wordingGiven and wordingValid) PreviewEdit
    else CommandRefused
  { ...review, phase: resultingPhase, commandBound: bound }
```

### A review action requires an eligible batch and a bound command

A displayable batch passed the owner, deadline and item checks. An accept, reject or edit intent also passed the batch token and item selection checks. These rules govern the intent before storage.

```quint
pure def alwaysReviewNeedsEligibleBatch(review: ReviewRequest): bool =
  (review.phase == ReadyToReview or review.phase == AcceptItem or
    review.phase == RejectItem or review.phase == PreviewEdit) implies
    (review.metadataApproved and review.itemsApproved)

pure def alwaysActionNeedsBoundCommand(review: ReviewRequest): bool =
  (review.phase == AcceptItem or review.phase == RejectItem or review.phase == PreviewEdit) implies
    review.commandBound
```

### A retried review command returns its stored result

The store keeps the result of each committed decide or delete on the member's review turn, in the same transaction as the change. When the gateway sends the same signed request again after a lost reply, the store returns that result while the owner still exists. A stored preview comes back only while the batch keeps that revision and has not expired. Another request for the same batch on the same turn is refused. Added 2026-11-18: a retry after a lost reply was refused although the first request had committed, against the idempotent service contract (SD-458).

```quint
type StoredReview = StoredSaved | StoredDeleted | StoredPreview

pure def storedReviewReplays(stored: StoredReview, ownerExists: bool, sameRequest: bool,
    revisionCurrent: bool, beforeExpiry: bool): bool =
  ownerExists and sameRequest and (stored != StoredPreview or (revisionCurrent and beforeExpiry))

pure def lawReplayNeedsOwner(sameRequest: bool, revisionCurrent: bool, beforeExpiry: bool): bool =
  not(storedReviewReplays(StoredSaved, false, sameRequest, revisionCurrent, beforeExpiry))

pure def lawStalePreviewNotReplayed(beforeExpiry: bool): bool =
  not(storedReviewReplays(StoredPreview, true, true, false, beforeExpiry))
```

### A member can reach review, accept, reject and edit

Each supported command can reach its own outcome. A batch that fails its admission checks stays unavailable.

```quint
pure def sometimesReadyToReview(review: ReviewRequest): bool = review.phase == ReadyToReview
pure def sometimesCanAccept(review: ReviewRequest): bool = review.phase == AcceptItem
pure def sometimesCanReject(review: ReviewRequest): bool = review.phase == RejectItem
pure def sometimesCanEdit(review: ReviewRequest): bool = review.phase == PreviewEdit
pure def sometimesBatchUnavailable(review: ReviewRequest): bool = review.phase == BatchUnavailable
```
