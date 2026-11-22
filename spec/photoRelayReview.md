# Selected-photo consent and review

The [standalone relay model](models/photo_relay_item.md) follows the item from selection through delivery. This machine controls selected-item intake, staff review, and owner cancellation. The shell owns policy and party lookups, file and reviewer authority, item locks, audit, and photo bytes. The machine receives only the results of those checks.

## Story: Choose one photo and allow a designated reviewer to decide

> As the sender, I want to choose one photo for one recipient with current consent. I want a designated reviewer to approve that specific item before it can be delivered. I can withdraw it while it remains in the system.

### Select one eligible photo using the current notice

A selection requires configured policy and storage, a valid request and selection, and explicit consent to the current version. Resolve the exact sender and a separate recipient. Check that the selected photo is still eligible and that the current thread can supply the recipient label for the notice. Store a pending item bound to this consent. An idempotent retry reads the original stored item and deadline. The item deadline is fifteen minutes after the consent, because the Eliza wire contract refuses an approved photo whose deadline is more than fifteen minutes after its consent (`RELAY_PHOTO_CONSENT_TTL_MS`). A longer review window needs an upstream contract change and a founder decision first. Changed: the review states now include ExpiredReview, so that a pending item that no reviewer decides by its deadline has an end of its own (audit OPP21).

```quint
type SelectionPhase = Selecting | CheckingParties | CheckingPhoto | ResolvingNotice | ReadyToStore | StoredSelection | SelectionRefused
type ReviewState = PendingReview | ApprovedReview | RejectedReview | RevokedReview | ExpiredReview
type PhotoSelection = { phase: SelectionPhase, review: ReviewState }

pure val relayItemTtlMs: int = 900000
pure val initial: PhotoSelection = { phase: Selecting, review: PendingReview }

pure def canCheckSelection(s: PhotoSelection): bool = s.phase == Selecting
pure def checkSelection(s: PhotoSelection, inputValid: bool, explicitConsent: bool): PhotoSelection =
  { ...s, phase: if (inputValid and explicitConsent) CheckingParties else SelectionRefused }

pure def canCheckParties(s: PhotoSelection): bool = s.phase == CheckingParties
pure def checkParties(s: PhotoSelection, senderMatches: bool, differentPeople: bool, differentMembers: bool): PhotoSelection =
  { ...s, phase: if (senderMatches and differentPeople and differentMembers) CheckingPhoto else SelectionRefused }

pure def canCheckPhoto(s: PhotoSelection): bool = s.phase == CheckingPhoto
pure def checkPhoto(s: PhotoSelection, currentPhoto: bool): PhotoSelection =
  { ...s, phase: if (currentPhoto) ResolvingNotice else SelectionRefused }

pure def canResolveNotice(s: PhotoSelection): bool = s.phase == ResolvingNotice
pure def resolveNotice(s: PhotoSelection, readyNotice: bool): PhotoSelection =
  { ...s, phase: if (readyNotice) ReadyToStore else SelectionRefused }

pure def canRecordSelection(s: PhotoSelection): bool = s.phase == ReadyToStore
pure def recordSelection(s: PhotoSelection): PhotoSelection = { ...s, phase: StoredSelection }

pure def alwaysSelectionStartsPending(s: PhotoSelection): bool = s.phase != StoredSelection implies s.review == PendingReview
```

### A designated reviewer can approve a current pending item

The review needs the configured policy and its exact stored notice, an eligible item state, an authorized reviewer, and a live deadline. Approval requires a pending item and fresh party and photo authority. A safety rejection rejects a pending item or revokes an approved item. An uncertain decision leaves the stored item alone. Before saving a decision, check the deadline again while holding the item lock.

```quint
type ReviewChoice = ApprovePhoto | RejectPhoto | KeepPending

pure def photoReviewable(s: PhotoSelection): bool =
  s.phase == StoredSelection and (s.review == PendingReview or s.review == ApprovedReview)

pure def reviewNeedsCurrent(choice: ReviewChoice): bool = choice == ApprovePhoto

pure def photoReviewMayProceed(s: PhotoSelection, choice: ReviewChoice, reviewerAuthorized: bool, itemLive: bool): bool =
  photoReviewable(s) and reviewerAuthorized and itemLive and (choice == RejectPhoto or (choice == ApprovePhoto and s.review == PendingReview))

pure def canRecordReview(s: PhotoSelection, choice: ReviewChoice, reviewerAuthorized: bool, currentItem: bool, itemLive: bool): bool =
  photoReviewMayProceed(s, choice, reviewerAuthorized, itemLive) and (not(reviewNeedsCurrent(choice)) or currentItem)

pure def recordReview(s: PhotoSelection, choice: ReviewChoice, reviewerAuthorized: bool, currentItem: bool, itemLive: bool): PhotoSelection =
  { ...s, review: if (choice == ApprovePhoto) ApprovedReview else if (s.review == ApprovedReview) RevokedReview else RejectedReview }

pure def stepOnlyReviewApproves(before: PhotoSelection, via: str, after: PhotoSelection): bool =
  (before.review != ApprovedReview and after.review == ApprovedReview) implies via == "recordReview"
```

### Held visibility is separate from delivery and owner cancellation

Staff can see a current pending item or an unclaimed approved item in the held list. A preview also requires the designated reviewer's authorization and a live item before the byte read. Check the deadline after reading bytes and before showing them. Release authorization can recheck a current pending or approved item, including an approved item already claimed. The sender can revoke an owned item on the same app even when it is no longer eligible for review.

```quint
pure def photoHeldForReview(s: PhotoSelection, claimed: bool): bool =
  photoReviewable(s) and (s.review == PendingReview or not(claimed))

pure def reviewPreviewAllowed(s: PhotoSelection, claimed: bool, reviewerAuthorized: bool, itemLive: bool): bool =
  photoHeldForReview(s, claimed) and reviewerAuthorized and itemLive

pure def reviewAuthorizationCurrent(s: PhotoSelection, configured: bool, reviewerAuthorized: bool, itemLive: bool, samePolicy: bool): bool =
  photoReviewable(s) and configured and reviewerAuthorized and itemLive and samePolicy

pure def canRevokeSelection(s: PhotoSelection, ownerMatches: bool): bool = s.phase == StoredSelection and ownerMatches
pure def revokeSelection(s: PhotoSelection, ownerMatches: bool): PhotoSelection = { ...s, review: RevokedReview }

pure def stepRevocationIsFinal(before: PhotoSelection, after: PhotoSelection): bool =
  before.review == RevokedReview implies after.review == RevokedReview

pure def sometimesApproved(s: PhotoSelection): bool = s.review == ApprovedReview
pure def sometimesRevoked(s: PhotoSelection): bool = s.review == RevokedReview
```

### A pending photo that no reviewer decides by its deadline expires, and the sender is told

At or after the deadline, a pending item expires. An expired item is never reviewed, shown in the held list, claimed or delivered. The service expires due pending items at each tick of the app's first network, oldest deadline first and at most 100 items for each tick. In the same transaction it sends the sender at most one notice that the photo did not go, and it records a review expiry, which the operations alerts count as a missed review SLA. The notice goes through the normal send rules, so STOP, the daily cap or a member who left can refuse it, or the rules can defer it; the item expires anyway, because an undecided photo must not stay open for delivery. The sender can still revoke an expired item. This rule changed from "tells the sender once" because the send rules can refuse the notice, and it now names the batch limit of the indexed deadline query. New rule: before this change a pending item ended at its deadline in silence, with no notice to the sender and no alert, although the reply had said that a person checks the photo first (audit OPP21).

```quint
pure def canExpireSelection(s: PhotoSelection, now: int, deadline: int): bool =
  s.phase == StoredSelection and s.review == PendingReview and now >= deadline
pure def expireSelection(s: PhotoSelection, now: int, deadline: int): PhotoSelection = { ...s, review: ExpiredReview }

pure def stepOnlyDeadlineExpires(before: PhotoSelection, via: str, after: PhotoSelection): bool =
  (before.review != ExpiredReview and after.review == ExpiredReview) implies via == "expireSelection"
pure def stepExpiredStaysUndelivered(before: PhotoSelection, after: PhotoSelection): bool =
  before.review == ExpiredReview implies (after.review == ExpiredReview or after.review == RevokedReview)

pure def sometimesExpired(s: PhotoSelection): bool = s.review == ExpiredReview
```
