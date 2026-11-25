# Selected-photo consent and review

The [whole-flow model](models/photo_relay_item.md) follows the offer from the sender's words to the receiver's view ([photo relay](photoRelayItem.md)). This machine controls the review item of each photo of an offer: intake, the automatic check, the staff review of a flagged photo, and owner cancellation. The shell owns policy and party lookups, file and reviewer authority, the image safety classifier call, item locks, audit, and photo bytes. The machine receives only the results of those checks.

## Story: Let an automatic check clear each photo of my offer

> As the sender, I want each photo of an offer that my match accepted to become its own item with my current consent. I want an automatic check to clear each item before the receiver can see it, and a staff member with the safety role to decide only a photo that the check did not clear. I can take it back while it remains in the system.

### Store one item for each photo of an accepted offer

The service makes the items of an offer when the receiver says yes to it: one item for each photo of the offer, with the sender's consent to the offer as the consent, and with explicit consent only when the offer's notice version is the current `PHOTO_SEND_NOTICE` version. An item requires configured policy and storage, a valid request and selection, and explicit consent to the current version. Resolve the exact sender and a separate recipient. Check that the photo is still eligible and that the current thread can supply the recipient label for the notice. Store an item bound to this consent that waits for the automatic check (ScreeningReview). An idempotent retry reads the original stored item and deadline. The item deadline is twelve hours after the receiver's yes; the automatic check and any staff review of a flagged photo end before it. A pending item that nobody decides by its deadline ends in ExpiredReview. Changed (audit OPP21 and owner decisions 2026-11-22, D4 and D14): the sender selected one photo, the item waited for a person in PendingReview with a deadline fifteen minutes after the consent, and an undecided item had no end state -> each photo of an accepted offer is one item that starts in the automatic check with a twelve-hour deadline and can expire, because the owner replaced the staff review of every photo with an automatic check and no photo crosses the fifteen-minute Eliza wire now.

```quint
type SelectionPhase = Selecting | CheckingParties | CheckingPhoto | ResolvingNotice | ReadyToStore | StoredSelection | SelectionRefused
type ReviewState = ScreeningReview | PendingReview | ApprovedReview | RejectedReview | RevokedReview | ExpiredReview
type PhotoSelection = { phase: SelectionPhase, review: ReviewState }

pure val relayItemTtlMs: int = 43200000
pure val initial: PhotoSelection = { phase: Selecting, review: ScreeningReview }

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

pure def alwaysSelectionStartsScreening(s: PhotoSelection): bool = s.phase != StoredSelection implies s.review == ScreeningReview
```

### An automatic check screens each photo, and only a photo it does not clear goes to staff

After the receiver's yes, an image safety classifier (Workers AI, the provider of the photo rater) screens each item. The shell parses the classifier's answers strictly: each safety question must have an answer from 0 to 1, and the risk is the highest answer in thousandths. A photo that the classifier cannot take (larger than its image limit) is unusable. A photo with a risk below one tenth is clean and is released at once. A photo with a higher risk is flagged, and goes to the staff safety role as an exception, where it waits as a pending item until its deadline. When the classifier cannot run (a model error, a timeout, an answer that does not parse, missing credentials), the item stays in the check and is tried again after one, five, fifteen and sixty minutes; the fifth failure sends it to staff. So no photo is released without a clean answer from the classifier or the approval of a person on the safety team. The check runs only before the item deadline; an item that is still in the check at its deadline expires. The shell claims each attempt under the item lock before it calls the classifier, and it saves the outcome only for the attempt that it claimed, so each attempt is one classifier call and one cost row, also with two replicas. Changed (owner decision 2026-11-22, D14): a person on the safety team checked every photo within twelve hours -> an automatic check clears each photo and staff see only the photos that it does not clear, because the owner chose an automatic check.

```quint
type ScreenVerdict = ScreenClean | ScreenFlagged | ScreenUnusable | ScreenCannotRun
type ScreenOutcome = ReleasePhoto | HoldForStaff | RetryScreen

pure val photoScreenCleanBelow: int = 100
pure val photoScreenRetryMax: int = 5

pure val usableValues = Set(true, false)
pure val answeredValues = Set(true, false)
pure val riskPerMilleValues = Set(-1, 0, 99, 100, 500, 1000, 1001)
pure val attemptsValues = Set(-1, 0, 1, 2, 3, 4, 5, 6)
pure val verdictValues = Set(ScreenClean, ScreenFlagged, ScreenUnusable, ScreenCannotRun)
pure val screenOutcomeValues = Set(ReleasePhoto, HoldForStaff, RetryScreen)

pure def photoScreenVerdictFor(usable: bool, answered: bool, riskPerMille: int): ScreenVerdict =
  if (not(usable)) ScreenUnusable
  else if (not(answered) or riskPerMille < 0 or riskPerMille > 1000) ScreenCannotRun
  else if (riskPerMille < photoScreenCleanBelow) ScreenClean
  else ScreenFlagged

pure def photoScreenOutcomeFor(verdict: ScreenVerdict, attempts: int): ScreenOutcome =
  if (verdict == ScreenClean) ReleasePhoto
  else if (verdict == ScreenFlagged or verdict == ScreenUnusable) HoldForStaff
  else if (attempts + 1 >= photoScreenRetryMax) HoldForStaff
  else RetryScreen

pure def photoScreenRetryDelayMs(attempts: int): int =
  if (attempts <= 0) 60000 else if (attempts == 1) 300000 else if (attempts == 2) 900000 else 3600000

pure def canScreenSelection(s: PhotoSelection, now: int, deadline: int): bool =
  s.phase == StoredSelection and s.review == ScreeningReview and now < deadline
pure def screenSelection(s: PhotoSelection, screenOutcome: ScreenOutcome, now: int, deadline: int): PhotoSelection =
  { ...s, review: if (screenOutcome == ReleasePhoto) ApprovedReview else if (screenOutcome == HoldForStaff) PendingReview else ScreeningReview }

pure def lawOnlyACleanScreenReleases(verdict: ScreenVerdict, attempts: int): bool =
  photoScreenOutcomeFor(verdict, attempts) == ReleasePhoto implies verdict == ScreenClean

pure def lawAScreenThatCannotRunNeverReleases(attempts: int): bool =
  photoScreenOutcomeFor(ScreenCannotRun, attempts) != ReleasePhoto

pure def lawFlaggedPhotosGoToStaff(attempts: int): bool =
  photoScreenOutcomeFor(ScreenFlagged, attempts) == HoldForStaff and photoScreenOutcomeFor(ScreenUnusable, attempts) == HoldForStaff

pure def lawRetriesEndAtStaff(attempts: int): bool =
  attempts + 1 >= photoScreenRetryMax implies photoScreenOutcomeFor(ScreenCannotRun, attempts) == HoldForStaff

pure def lawCleanNeedsAnAnswer(usable: bool, riskPerMille: int): bool =
  photoScreenVerdictFor(usable, false, riskPerMille) != ScreenClean

pure def lawRetryWaits(attempts: int): bool = photoScreenRetryDelayMs(attempts) > 0

pure def stepOnlyTheScreenLeavesTheCheck(before: PhotoSelection, via: str, after: PhotoSelection): bool =
  (before.review == ScreeningReview and after.review != ScreeningReview) implies
    (via == "screenSelection" or via == "revokeSelection" or via == "expireSelection")

pure def sometimesScreening(s: PhotoSelection): bool = s.phase == StoredSelection and s.review == ScreeningReview
pure def sometimesHeldForStaff(s: PhotoSelection): bool = s.phase == StoredSelection and s.review == PendingReview
```

### A safety staff member can approve a current pending item

The review needs the configured policy and its exact stored notice, an eligible item state, an authorized reviewer, and a live deadline. The authorized reviewer is a staff member with the `safety` role, and the shell writes the audit row before the decision. A pending item is a photo that the automatic check flagged or could not check; an item that waits for the check is not reviewable. Approval requires a pending item and fresh party and photo authority. A safety rejection rejects a pending item or revokes an approved item. An uncertain decision leaves the stored item alone. Before saving a decision, check the deadline again while holding the item lock. Only the automatic check (a clean answer) and this review approve an item. Changed (owner decisions 2026-11-22, D6 and D14): the reviewers were a list in an environment variable and reviewed every photo -> the staff `safety` role reviews only the exceptions, because the owner removed environment switches and an automatic check clears each photo.

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
  (before.review != ApprovedReview and after.review == ApprovedReview) implies (via == "recordReview" or via == "screenSelection")
```

### Held visibility is separate from delivery and owner cancellation

Staff see a current pending item in the held list: a photo that the automatic check flagged or could not check. A preview also requires the safety reviewer's authorization and a live item before the byte read. Check the deadline after reading bytes and before showing them. Release authorization can recheck a current pending or approved item. The sender can revoke an owned item on the same app even when it is no longer eligible for review, also while it waits for the check. Changed (owner decision 2026-11-22, D14): the held list showed every pending item and every approved item that no delivery had claimed -> it shows only the pending exceptions, because an approved photo is released to the receiver's page at once and no delivery claims it.

```quint
pure def photoHeldForReview(s: PhotoSelection): bool = s.phase == StoredSelection and s.review == PendingReview

pure def reviewPreviewAllowed(s: PhotoSelection, reviewerAuthorized: bool, itemLive: bool): bool =
  photoHeldForReview(s) and reviewerAuthorized and itemLive

pure def reviewAuthorizationCurrent(s: PhotoSelection, configured: bool, reviewerAuthorized: bool, itemLive: bool, samePolicy: bool): bool =
  photoReviewable(s) and configured and reviewerAuthorized and itemLive and samePolicy

pure def canRevokeSelection(s: PhotoSelection, ownerMatches: bool): bool = s.phase == StoredSelection and ownerMatches
pure def revokeSelection(s: PhotoSelection, ownerMatches: bool): PhotoSelection = { ...s, review: RevokedReview }

pure def stepRevocationIsFinal(before: PhotoSelection, after: PhotoSelection): bool =
  before.review == RevokedReview implies after.review == RevokedReview

pure def sometimesApproved(s: PhotoSelection): bool = s.review == ApprovedReview
pure def sometimesRevoked(s: PhotoSelection): bool = s.review == RevokedReview
```

### A photo that is not cleared by its deadline expires, and its offer settles

At or after the deadline, a pending item expires, and so does an item that still waits for the automatic check. An expired item is never reviewed, shown in the held list, claimed or delivered. The service expires due pending items at each tick of the app's first network, oldest deadline first and at most 100 items for each tick. In the same transaction it records a review expiry, which the operations alerts count as a missed review SLA. The item expires even when no notice can go, because an undecided photo must not stay open. The sender can still revoke an expired item. The expiry sends no notice of its own: it settles the offer of the item, and the offer tells the sender once that the safety team could not check the photo in time when the send rules allow it ([photo relay](photoRelayItem.md)), so the sender gets at most one notice for each offer. Changed (audit OPP21 and owner decision 2026-11-22, D14): a pending item ended at its deadline in silence with no alert, and an item in the check had no deadline -> every undecided item expires with a review expiry row and the offer notice, because the reply had said that the photo is checked first and a check that never ran must not leave a photo open.

```quint
pure def canExpireSelection(s: PhotoSelection, now: int, deadline: int): bool =
  s.phase == StoredSelection and (s.review == PendingReview or s.review == ScreeningReview) and now >= deadline
pure def expireSelection(s: PhotoSelection, now: int, deadline: int): PhotoSelection = { ...s, review: ExpiredReview }

pure def stepOnlyDeadlineExpires(before: PhotoSelection, via: str, after: PhotoSelection): bool =
  (before.review != ExpiredReview and after.review == ExpiredReview) implies via == "expireSelection"
pure def stepExpiredStaysUndelivered(before: PhotoSelection, after: PhotoSelection): bool =
  before.review == ExpiredReview implies (after.review == ExpiredReview or after.review == RevokedReview)

pure def sometimesExpired(s: PhotoSelection): bool = s.review == ExpiredReview
```
