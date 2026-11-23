# Photo relay: naming, offering and viewing a photo

After a match, an adult slop.date member can send their own photo to the match through the agent (founder decision 9). The member says which photo in their own words. The service reads the words without a model (`readPhotoMessage` in `packages/network/service/photoReference.ts`), proposes the photos that the words name, and shows them on a check page. Only YES to that proposal, or Send on that page, is consent. The receiver is asked first. After the receiver says yes, an automatic image safety check screens each photo, and a person on the safety team sees only a photo that the check did not clear ([photo consent and review](photoRelayReview.md)). Then the receiver gets a private link that opens the photos for the receiver's browser until the sender takes them back or the access ends for another reason. The [whole-flow model](models/photo_relay_item.md) follows one offer from the words to the view. Changed (owner decision 2026-11-22): photo relay is on in production. Before this change the member chose a photo by a number from a list, the photo went out as an MMS with a fifteen-minute review window, and the policy and the delivery origin were not set at boot, so a photo relay could not complete. Changed (owner decision D14 of 2026-11-22, "automatic check. i like private link, but not the 24 hours restriction, its enabled until its retracted by the user"): a person checked every photo, and the view link opened on one phone for 24 hours; now an automatic check clears each photo and the view has no time limit.

The shell owns the words, the photo rows, the offer, draft and link rows, the row locks, the texts and the pages. These decisions receive only numbers, flags and photo masks. A photo mask holds one bit for each of the sender's photos: photo 1 is bit 1, photo 2 is bit 2, photo 3 is bit 4, and so on up to photo 6. The photos are numbered 1 to the count, oldest first, everywhere.

## Story: Send my photo to my match

> As an adult slop.date member with a match, I want to say which of my photos to send in my own words, see exactly those photos before I agree, and know that my match chose to get them, so that no photo goes out that I did not choose for that person.

### A reference names only the sender's own photos and never guesses between two

The reader turns the member's words into masks: `candidates` (the photos that the words name), `exact` (the photos whose name equals the words), `excluded` (the photos that the words exclude) and `shared` (the photos that the match already has). The flags say that the words name another person's photo (`otherOwner`), hold a photo code or a link (`codeTyped`), or choose by looks (`byLooks`). `hadFeature` says that the words hold any selector or content word, and `wantsSet` says that the words ask for more than one photo. A refusal proposes nothing and lists the sender's photos again. Words that name no photo ask the member to choose. Words that name two or more photos, when the member asked for one, ask which one, unless exactly one of them has the exact name. The decision never proposes a photo outside the sender's own photos, an excluded photo, or a photo that the match already has, and never proposes more than three. Added (owner decision 2026-11-22): the member can refer to a photo by its number, its position, its day, its name, the newest or oldest ones, or the photo another match has, and the decision never guesses between two photos. Changed after review (owner decision 2026-11-22): the full name of one photo ("send her the beach sunset") now counts as a photo reference without a photo word, so a member can name a photo as they named it; and "of" before a capitalized place name or a word of the member's own photo names ("the photo of Sunset Park") no longer reads as another person's photo.

```quint
type PhotoPick = ProposePhotos | ChoosePhotos | ListPhotos | NoMatchingPhoto | AlreadyShared | TooManyPhotos | OwnPhotosOnly | NoPhotoCodes | NotByLooks | AskWhichMatch | AddPhotosFirst | PhotosUnavailable
type PhotoPickResult = { pick: PhotoPick, chosen: int }

pure val photoSlotsMax: int = 6
pure val photoSetMax: int = 3
pure val maskAll: int = 63

pure val availableValues = Set(true, false)
pure val otherOwnerValues = Set(true, false)
pure val codeTypedValues = Set(true, false)
pure val byLooksValues = Set(true, false)
pure val recipientsValues = Set(-1, 0, 1, 2)
pure val countValues = Set(-1, 0, 1, 2, 3, 4, 6)
pure val hadFeatureValues = Set(true, false)
pure val wantsSetValues = Set(true, false)
pure val candidatesValues = Set(-1, 0, 1, 3, 9, 48, 63, 64)
pure val exactValues = Set(-1, 0, 1, 3, 9, 48, 63, 64)
pure val excludedValues = Set(-1, 0, 1, 3, 9, 48, 63, 64)
pure val sharedValues = Set(-1, 0, 1, 3, 9, 48, 63, 64)

pure def cleanMask(m: int): int = if (m < 0 or m > maskAll) 0 else m

pure def slotBit(m: int, d: int): int = (cleanMask(m) / d) % 2

pure def slotCount(m: int): int =
  slotBit(m, 1) + slotBit(m, 2) + slotBit(m, 4) + slotBit(m, 8) + slotBit(m, 16) + slotBit(m, 32)

pure def bothMasks(a: int, b: int): int =
  slotBit(a, 1) * slotBit(b, 1) + slotBit(a, 2) * slotBit(b, 2) * 2 + slotBit(a, 4) * slotBit(b, 4) * 4 +
  slotBit(a, 8) * slotBit(b, 8) * 8 + slotBit(a, 16) * slotBit(b, 16) * 16 + slotBit(a, 32) * slotBit(b, 32) * 32

pure def withoutMask(m: int, x: int): int = cleanMask(m) - bothMasks(m, x)

pure def ownSlots(count: int): int =
  if (count <= 0) 0 else if (count == 1) 1 else if (count == 2) 3 else if (count == 3) 7
  else if (count == 4) 15 else if (count == 5) 31 else maskAll

pure def photoPickFor(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int,
    hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int): PhotoPickResult = {
  val own = ownSlots(count)
  val open = withoutMask(bothMasks(candidates, own), excluded)
  val fresh = withoutMask(open, shared)
  val exactOpen = bothMasks(open, exact)
  val rest = withoutMask(own, excluded)
  if (not(available)) { pick: PhotosUnavailable, chosen: 0 }
  else if (otherOwner) { pick: OwnPhotosOnly, chosen: rest }
  else if (codeTyped) { pick: NoPhotoCodes, chosen: rest }
  else if (byLooks) { pick: NotByLooks, chosen: rest }
  else if (recipients != 1) { pick: AskWhichMatch, chosen: 0 }
  else if (count <= 0) { pick: AddPhotosFirst, chosen: 0 }
  else if (not(hadFeature)) { pick: ListPhotos, chosen: rest }
  else if (open == 0) { pick: NoMatchingPhoto, chosen: rest }
  else if (wantsSet and fresh == 0) { pick: AlreadyShared, chosen: open }
  else if (wantsSet and slotCount(fresh) <= photoSetMax) { pick: ProposePhotos, chosen: fresh }
  else if (wantsSet) { pick: TooManyPhotos, chosen: fresh }
  else if (slotCount(open) == 1 and fresh == 0) { pick: AlreadyShared, chosen: open }
  else if (slotCount(open) == 1) { pick: ProposePhotos, chosen: open }
  else if (slotCount(exactOpen) == 1 and bothMasks(fresh, exact) == 0) { pick: AlreadyShared, chosen: exactOpen }
  else if (slotCount(exactOpen) == 1) { pick: ProposePhotos, chosen: exactOpen }
  else { pick: ChoosePhotos, chosen: open }
}

pure def lawChosenAreOwnPhotos(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int,
    hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int): bool =
  val r = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared)
  withoutMask(r.chosen, ownSlots(count)) == 0

pure def lawExcludedNeverProposed(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int,
    hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int): bool =
  val r = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared)
  r.pick == ProposePhotos implies bothMasks(r.chosen, excluded) == 0

pure def lawProposalHoldsOneToThree(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int,
    hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int): bool =
  val r = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared)
  r.pick == ProposePhotos implies (slotCount(r.chosen) >= 1 and slotCount(r.chosen) <= photoSetMax)

pure def lawNeverGuessesBetweenPhotos(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int,
    hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int): bool =
  val r = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared)
  (r.pick == ProposePhotos and not(wantsSet)) implies slotCount(r.chosen) == 1

pure def lawSharedNeverProposedAgain(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int,
    hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int): bool =
  val r = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared)
  r.pick == ProposePhotos implies bothMasks(r.chosen, shared) == 0

pure def lawRefusedNeverProposes(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int,
    hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int): bool =
  val r = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared)
  (not(available) or otherOwner or codeTyped or byLooks) implies r.pick != ProposePhotos

pure def lawOneMatchAtATime(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int,
    hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int): bool =
  val r = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared)
  recipients != 1 implies r.pick != ProposePhotos
```

### A yes counts only for the proposal the member was just shown

A proposal names each photo and links to the check page. A reply answers the proposal only when the proposal is the newest prompt to the member and the reply holds a photo reference, a yes or a no. A reply after fifteen minutes has lapsed and sends nothing. A reply that names photos changes the proposal and is never a yes. A no cancels it. A yes to a question that proposed no photo asks which one. A yes after the photos or the notice changed shows the new proposal and sends nothing. Only a yes to the unchanged, newest, fresh proposal is consent. A reply that names another match, two matches, everyone or an unknown name after "to", "with" or "for" is never a yes to the proposal: the reader reads it as a new request for that recipient, which needs its own proposal and its own yes. Changed after review (owner decision 2026-11-22): before this change "yes, send it to Jordan" to a proposal for Maya read as a yes and sent the photo to Maya, so the consent for each recipient did not hold. A reply that is about something else leaves the proposal as it is. Added (owner decision 2026-11-22): before this rule a number in any later message chose a photo, so a yes to another question could not be told from a yes to the photo.

```quint
type DraftReply = NotForTheDraft | DraftLapsed | ChangeProposal | CancelDraft | AskWhichOne | PhotosChanged | ConsentGiven

pure val photoDraftTtlMs: int = 900000

pure val promptIsNewestValues = Set(true, false)
pure val shownAtValues = Set(0, 1, 900000)
pure val atValues = Set(0, 1, 899999, 900000, 86400000, 172800000, 259200000)
pure val hasReferenceValues = Set(true, false)
pure val yesValues = Set(true, false)
pure val noValues = Set(true, false)
pure val proposedValues = Set(true, false)
pure val sameNoticeValues = Set(true, false)
pure val sameSetValues = Set(true, false)

pure def photoDraftReplyFor(promptIsNewest: bool, shownAt: int, at: int, hasReference: bool, yes: bool, no: bool,
    proposed: bool, sameNotice: bool, sameSet: bool): DraftReply =
  if (not(promptIsNewest) or not(hasReference or yes or no)) NotForTheDraft
  else if (at < shownAt or at - shownAt >= photoDraftTtlMs) DraftLapsed
  else if (hasReference) ChangeProposal
  else if (no) CancelDraft
  else if (not(proposed)) AskWhichOne
  else if (not(sameNotice) or not(sameSet)) PhotosChanged
  else ConsentGiven

pure def lawConsentNeedsAFreshUnchangedProposal(promptIsNewest: bool, shownAt: int, at: int, hasReference: bool, yes: bool, no: bool,
    proposed: bool, sameNotice: bool, sameSet: bool): bool =
  photoDraftReplyFor(promptIsNewest, shownAt, at, hasReference, yes, no, proposed, sameNotice, sameSet) == ConsentGiven implies
    (promptIsNewest and at >= shownAt and at - shownAt < photoDraftTtlMs and not(hasReference) and yes and not(no)
     and proposed and sameNotice and sameSet)

pure def lawLapsedDraftNeverConsents(promptIsNewest: bool, shownAt: int, hasReference: bool, yes: bool, no: bool,
    proposed: bool, sameNotice: bool, sameSet: bool): bool =
  photoDraftReplyFor(promptIsNewest, shownAt, shownAt + photoDraftTtlMs, hasReference, yes, no, proposed, sameNotice, sameSet) != ConsentGiven

pure def lawCorrectionIsNeverAYes(promptIsNewest: bool, shownAt: int, at: int, yes: bool, no: bool,
    proposed: bool, sameNotice: bool, sameSet: bool): bool =
  photoDraftReplyFor(promptIsNewest, shownAt, at, true, yes, no, proposed, sameNotice, sameSet) != ConsentGiven

pure def lawAnotherQuestionKeepsTheYes(promptIsNewest: bool, shownAt: int, at: int, proposed: bool, sameNotice: bool, sameSet: bool): bool =
  photoDraftReplyFor(promptIsNewest, shownAt, at, false, false, false, proposed, sameNotice, sameSet) == NotForTheDraft
```

### A photo offer goes to one adult match who has room for it

After the sender's consent, the service makes one offer for one match with one to three photos. `partiesOk` says that both people are adults, neither blocked the other, neither said STOP or left, neither is on hold, the thread is open, and the sender may still keep photos. `openToPair` counts the offers of this pair that wait for the receiver's answer or for the check (asking or reviewing), or whose sender notice is not yet due; a ready offer does not count. `unopenedEnds` counts the declined and lapsed offers of this pair that never reached ready, and `lastUnopenedEndAt` is the latest of their notice due times. `photosLastDay` counts the photos that the sender offered in the last 24 hours. After two offers that the match never opened, photos are off for the pair. After one, the sender waits three days. A receiver who said NO MORE PHOTOS is never asked: the offer ends at once as declined, and the sender hears the same as for a decline, at the same time. Added (owner decision 2026-11-22): the receiver also chooses whether to receive, and repeated offers that the receiver did not open stop. Changed after review (owner decision D14 of 2026-11-22, "its enabled until its retracted by the user"): `openToPair` counted ready offers too; a ready offer no longer ends on a clock, so after one photo reached the match every later offer waited, with the false text that the match had not answered, until the sender took the photo back.

```quint
type OfferAdmission = OfferAsk | OfferSilentDecline | OfferWaitForAnswer | OfferCoolingDown | OfferPhotosOff | OfferDailyLimit | OfferUnavailable

pure val photoOfferCooldownMs: int = 259200000
pure val photoOfferUnopenedMax: int = 2
pure val photoOffersDaily: int = 6

pure val partiesOkValues = Set(true, false)
pure val openToPairValues = Set(-1, 0, 1, 2)
pure val unopenedEndsValues = Set(-1, 0, 1, 2, 3)
pure val lastUnopenedEndAtValues = Set(0, 1, 259200000)
pure val photosLastDayValues = Set(-1, 0, 3, 4, 5, 6, 7)
pure val receiverNeverValues = Set(true, false)

pure def photoOfferAdmissionFor(partiesOk: bool, openToPair: int, unopenedEnds: int, lastUnopenedEndAt: int, at: int,
    photosLastDay: int, count: int, receiverNever: bool): OfferAdmission =
  if (not(partiesOk) or count < 1 or count > photoSetMax) OfferUnavailable
  else if (unopenedEnds >= photoOfferUnopenedMax) OfferPhotosOff
  else if (openToPair > 0) OfferWaitForAnswer
  else if (unopenedEnds > 0 and at - lastUnopenedEndAt < photoOfferCooldownMs) OfferCoolingDown
  else if (photosLastDay + count > photoOffersDaily) OfferDailyLimit
  else if (receiverNever) OfferSilentDecline
  else OfferAsk

pure def lawAskNeedsAdultPairAndRoom(partiesOk: bool, openToPair: int, unopenedEnds: int, lastUnopenedEndAt: int, at: int,
    photosLastDay: int, count: int, receiverNever: bool): bool =
  photoOfferAdmissionFor(partiesOk, openToPair, unopenedEnds, lastUnopenedEndAt, at, photosLastDay, count, receiverNever) == OfferAsk implies
    (partiesOk and count >= 1 and count <= photoSetMax and openToPair <= 0 and unopenedEnds < photoOfferUnopenedMax
     and (unopenedEnds <= 0 or at - lastUnopenedEndAt >= photoOfferCooldownMs)
     and photosLastDay + count <= photoOffersDaily and not(receiverNever))

pure def lawNeverMeansNeverAsked(partiesOk: bool, openToPair: int, unopenedEnds: int, lastUnopenedEndAt: int, at: int,
    photosLastDay: int, count: int): bool =
  photoOfferAdmissionFor(partiesOk, openToPair, unopenedEnds, lastUnopenedEndAt, at, photosLastDay, count, true) != OfferAsk

pure def lawOneOpenOfferPerPair(partiesOk: bool, unopenedEnds: int, lastUnopenedEndAt: int, at: int,
    photosLastDay: int, count: int, receiverNever: bool): bool =
  val r = photoOfferAdmissionFor(partiesOk, 1, unopenedEnds, lastUnopenedEndAt, at, photosLastDay, count, receiverNever)
  r != OfferAsk and r != OfferSilentDecline

pure def lawPhotosOffAfterTwoUnopened(openToPair: int, lastUnopenedEndAt: int, at: int, photosLastDay: int, count: int, receiverNever: bool): bool =
  (count >= 1 and count <= photoSetMax) implies
    photoOfferAdmissionFor(true, openToPair, photoOfferUnopenedMax, lastUnopenedEndAt, at, photosLastDay, count, receiverNever) == OfferPhotosOff
```

### The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back

An offer starts asking. The service asks the receiver once and gives them 24 hours to answer. A yes before that time starts the automatic check of each photo; a no declines; no answer lapses. The offer is ready as soon as the check or a person on the safety team approved at least one photo, so a clean photo is released at once while a flagged photo of the same offer still waits for staff. When every photo is decided and none is approved, the offer is rejected if staff rejected one, else timed out. A ready offer stays ready, with no time limit, until the sender takes back all its photos (revoked), the receiver reports it (reported), or the access ends for another reason (ended): a block, a report, a ban, STOP, leaving the app, erasure, the match or the thread ending, or an age reading under 18. A photo that the sender takes back, and a photo whose row changed or was deleted, stop showing at once, while the other photos of the offer stay; when no photo of the offer is left, nothing shows. An ended offer never changes again. The transaction that records a block, a ban, STOP, leaving, a hold or a restriction, erasure or an age reading under 18 also records an end fact on every open offer of that person, in both directions, and an offer with an end fact is not current, so a condition that is lifted later (START after STOP, a hold that is released) never opens the offer again; the tick then ends it. `itemsCurrent` says that the offer has no end fact, its parties are current, and at least one approved photo of the offer is still current: not taken back, its photo row the same, and its notice the one in force. Changed after review (owner decision D14 of 2026-11-22): the end reasons were checked only when someone opened the page or when the tick visited the offer, so STOP then START, or a hold that was released before the visit, opened the photo again, and one deleted photo hid the whole offer. Added (owner decision 2026-11-22): the receiver is asked before any check, and the photo opens only for the receiver, so the sender can take it back and the receiver can report it. Changed (owner decision D14 of 2026-11-22, "its enabled until its retracted by the user"): a ready offer lapsed when nobody opened it within 48 hours, and an opened offer closed 24 hours after the first open; the owner removed both limits, so the Viewing and Closed phases, the open deadline and the view window are gone, and the offer is ready as soon as one photo is approved, because the automatic check clears a clean photo at once.

```quint
type OfferPhase = Asking | Reviewing | Ready | Declined | Lapsed | Rejected | CheckTimedOut | Revoked | Ended | Reported
type PhotoOffer = { phase: OfferPhase, answerBy: int }

pure val offerAnswerMs: int = 86400000

pure val approvedValues = Set(-1, 0, 1, 2, 3)
pure val rejectedValues = Set(-1, 0, 1, 2, 3)
pure val timedOutValues = Set(-1, 0, 1, 2, 3)
pure val totalValues = Set(0, 1, 2, 3)
pure val ownerMatchesValues = Set(true, false)
pure val byReceiverValues = Set(true, false)

pure val initial: PhotoOffer = { phase: Asking, answerBy: 0 }

pure def offerOpen(o: PhotoOffer): bool = o.phase == Asking or o.phase == Reviewing or o.phase == Ready

pure def canAskReceiver(o: PhotoOffer, at: int): bool = o.phase == Asking and o.answerBy == 0
pure def askReceiver(o: PhotoOffer, at: int): PhotoOffer = { ...o, answerBy: at + offerAnswerMs }

pure def canAnswerYes(o: PhotoOffer, at: int): bool = o.phase == Asking and o.answerBy > 0 and at < o.answerBy
pure def answerYes(o: PhotoOffer, at: int): PhotoOffer = { ...o, phase: Reviewing }

pure def canAnswerNo(o: PhotoOffer): bool = o.phase == Asking
pure def answerNo(o: PhotoOffer): PhotoOffer = { ...o, phase: Declined }

pure def canLapseAnswer(o: PhotoOffer, at: int): bool = o.phase == Asking and o.answerBy > 0 and at >= o.answerBy
pure def lapseAnswer(o: PhotoOffer, at: int): PhotoOffer = { ...o, phase: Lapsed }

pure def canSettleReview(o: PhotoOffer, approved: int, rejected: int, timedOut: int, total: int): bool =
  o.phase == Reviewing and total >= 1 and approved >= 0 and rejected >= 0 and timedOut >= 0
    and approved + rejected + timedOut <= total and (approved > 0 or approved + rejected + timedOut == total)
pure def settleReview(o: PhotoOffer, approved: int, rejected: int, timedOut: int, total: int): PhotoOffer =
  if (approved > 0) { ...o, phase: Ready }
  else if (rejected > 0) { ...o, phase: Rejected }
  else { ...o, phase: CheckTimedOut }

pure def canRevokeOffer(o: PhotoOffer, ownerMatches: bool): bool = ownerMatches and offerOpen(o)
pure def revokeOffer(o: PhotoOffer, ownerMatches: bool): PhotoOffer = { ...o, phase: Revoked }

pure def canEndOffer(o: PhotoOffer): bool = offerOpen(o)
pure def endOffer(o: PhotoOffer): PhotoOffer = { ...o, phase: Ended }

pure def canReportOffer(o: PhotoOffer, byReceiver: bool): bool = byReceiver and o.phase == Ready
pure def reportOffer(o: PhotoOffer, byReceiver: bool): PhotoOffer = { ...o, phase: Reported }

pure def stepEndsAreFinal(before: PhotoOffer, after: PhotoOffer): bool = not(offerOpen(before)) implies after == before

pure def stepOnlyReviewMakesReady(before: PhotoOffer, via: str, after: PhotoOffer): bool =
  (before.phase != Ready and after.phase == Ready) implies via == "settleReview"

pure def stepOnlyTheReceiverStartsTheCheck(before: PhotoOffer, via: str, after: PhotoOffer): bool =
  (before.phase != Reviewing and after.phase == Reviewing) implies via == "answerYes"

pure def stepNoClockEndsAReadyOffer(before: PhotoOffer, via: str, after: PhotoOffer): bool =
  (before.phase == Ready and after.phase != Ready) implies (via == "revokeOffer" or via == "endOffer" or via == "reportOffer")

pure def sometimesReady(o: PhotoOffer): bool = o.phase == Ready
pure def sometimesReported(o: PhotoOffer): bool = o.phase == Reported
pure def sometimesRevoked(o: PhotoOffer): bool = o.phase == Revoked
pure def sometimesLapsed(o: PhotoOffer): bool = o.phase == Lapsed
```

### The sender learns only sent, not taken, not approved or timed out

The sender hears that the photo is on its way when the offer is ready, and never hears whether the receiver opened it. A decline, a lapse, a receiver who said NO MORE PHOTOS and an end before ready all read "not taken", and that notice is not due before the answer deadline, so a decline looks the same as a lapse in words and in time. A rejected offer and an offer that the safety team did not check in time each have their own notice. A sender who took the photos back hears only the reply to that request. A "sent" notice that is not yet out when the offer ends is dropped, so the sender is never told that a photo is on its way after it stopped. The sender's photo list and a take-back follow the same rule: a declined offer shows as asked until its notice is due, and a take-back of it gets the same reply as a take-back of an open ask and drops its notice; from ready on, the list shows one state, whether the receiver opened the photo, reported it or the match ended, and a take-back gets one reply. A photo that the sender took back shows as taken back for that match, for a whole offer and for one photo of an offer, and a take-back of it takes nothing more back. Added (owner decision 2026-11-22): before this rule the sender could tell a fast decline from a lapse. Changed after review (owner decision 2026-11-22, Q9 "no opened receipt"): the photo list and the take-back reply first showed a decline at once and showed whether the receiver opened the photo. Changed (owner decision D14 of 2026-11-22, "enabled until its retracted by the user"): the Viewing and Closed phases are gone with the view window, and a taken-back photo showed nothing in the list; it now shows as taken back (SeesTakenBack), so the sender can see that the retraction took effect.

```quint
type OfferNotice = NoNotice | TellSent | TellNotTaken | TellNotApproved | TellCheckTimedOut

pure val phaseValues = Set(Asking, Reviewing, Ready, Declined, Lapsed, Rejected, CheckTimedOut, Revoked, Ended, Reported)
pure val endedBySenderValues = Set(true, false)
pure val wasReadyValues = Set(true, false)
pure val noticeValues = Set(NoNotice, TellSent, TellNotTaken, TellNotApproved, TellCheckTimedOut)
pure val answerByValues = Set(0, 1, 86400000)

pure def senderNoticeFor(phase: OfferPhase, endedBySender: bool, wasReady: bool): OfferNotice =
  if (endedBySender) NoNotice
  else if (phase == Ready) TellSent
  else if (wasReady) NoNotice
  else if (phase == Declined or phase == Lapsed or phase == Ended) TellNotTaken
  else if (phase == Rejected) TellNotApproved
  else if (phase == CheckTimedOut) TellCheckTimedOut
  else NoNotice

pure def senderNoticeDueAt(notice: OfferNotice, at: int, answerBy: int): int =
  if (notice == TellNotTaken and at < answerBy) answerBy else at

pure def lawDeclineLooksLikeALapse(wasReady: bool): bool =
  senderNoticeFor(Declined, false, wasReady) == senderNoticeFor(Lapsed, false, wasReady)

pure def lawNotTakenWaitsForTheAnswerDeadline(at: int, answerBy: int): bool =
  senderNoticeDueAt(TellNotTaken, at, answerBy) >= answerBy

pure def lawNoReadReceipt(phase: OfferPhase): bool =
  senderNoticeFor(phase, false, true) == NoNotice or phase == Ready

type PhotoSenderView = SeesNothing | SeesAsked | SeesChecking | SeesSent | SeesTakenBack
type PhotoTakeBack = TakeBackNothing | TakeBackOffer | TakeBackQuietly | TakeBackSeen

pure val noticeLaterValues = Set(true, false)
pure val photoTakenBackValues = Set(true, false)
pure val seenValues = Set(SeesNothing, SeesAsked, SeesChecking, SeesSent, SeesTakenBack)

pure def unsentNoticeKept(notice: OfferNotice, phase: OfferPhase): bool =
  notice != TellSent or phase == Ready

pure def photoSenderViewFor(phase: OfferPhase, wasReady: bool, endedBySender: bool, noticeLater: bool): PhotoSenderView =
  if (phase == Asking) SeesAsked
  else if (phase == Reviewing) SeesChecking
  else if (phase == Ready) SeesSent
  else if (phase == Revoked or endedBySender) SeesTakenBack
  else if (wasReady and (phase == Ended or phase == Reported)) SeesSent
  else if ((phase == Declined or phase == Lapsed) and noticeLater) SeesAsked
  else SeesNothing

pure def photoListedAs(seen: PhotoSenderView, photoTakenBack: bool): PhotoSenderView =
  if (photoTakenBack) SeesTakenBack else seen

pure def photoTakeBackFor(phase: OfferPhase, wasReady: bool, endedBySender: bool, noticeLater: bool): PhotoTakeBack = {
  val seen = photoSenderViewFor(phase, wasReady, endedBySender, noticeLater)
  if (seen == SeesNothing or seen == SeesTakenBack) TakeBackNothing
  else if (phase == Asking or phase == Reviewing or phase == Ready) TakeBackOffer
  else if (seen == SeesAsked) TakeBackQuietly
  else TakeBackSeen
}

pure def lawSentIsNotToldAfterTheEnd(phase: OfferPhase): bool =
  phase != Ready implies not(unsentNoticeKept(TellSent, phase))

pure def lawDeclineListsAsAskedUntilTheNotice(noticeLater: bool): bool =
  photoSenderViewFor(Declined, false, false, noticeLater) == photoSenderViewFor(Lapsed, false, false, noticeLater)
    and (noticeLater implies photoSenderViewFor(Declined, false, false, noticeLater) == photoSenderViewFor(Asking, false, false, noticeLater))

pure def lawTheListIsNoReadReceipt(noticeLater: bool): bool =
  photoSenderViewFor(Ready, true, false, noticeLater) == photoSenderViewFor(Reported, true, false, noticeLater)
    and photoSenderViewFor(Ended, true, false, noticeLater) == photoSenderViewFor(Reported, true, false, noticeLater)

pure def lawTakeBackIsNoReadReceipt(noticeLater: bool): bool =
  photoTakeBackFor(Ended, true, false, noticeLater) == photoTakeBackFor(Reported, true, false, noticeLater)

pure def lawTakeBackHidesADecline(noticeLater: bool): bool =
  noticeLater implies photoTakeBackFor(Declined, false, false, noticeLater) == TakeBackQuietly

pure def lawTakenBackShowsAsTakenBack(wasReady: bool, noticeLater: bool): bool =
  photoSenderViewFor(Revoked, wasReady, true, noticeLater) == SeesTakenBack and photoSenderViewFor(Declined, wasReady, true, noticeLater) == SeesTakenBack

pure def lawATakenBackPhotoListsAsTakenBack(seen: PhotoSenderView): bool = photoListedAs(seen, true) == SeesTakenBack

pure def lawTakenBackIsNotTakenBackAgain(wasReady: bool, noticeLater: bool): bool =
  photoTakeBackFor(Revoked, wasReady, true, noticeLater) == TakeBackNothing
```

### A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back

The check page and the photos page open from a link that the agent sent in the conversation. The link lives fifteen minutes, and a check page link is only for the proposal revision that it was made for. The first open binds the link to that browser, and every later call needs the same browser. The view link goes only to the receiver's own phone line. Its first open binds it to that browser, and from then on it opens only there, for a ready offer whose photos are current, with no time limit. The browser keeps the binding when it restarts: the binding cookie lives 400 days, and each open of the view renews it. Changed after review (owner decision D14 of 2026-11-22): the binding cookie ended with the browser session, so a restart lost a view that has no time limit. The receiver can ask for a new view link by text (PHOTO LINK): the new link replaces the old one, which then opens nothing, so the receiver can move to another phone and a forwarded old link stays useless. Only the receiver of a ready offer with current photos gets a new link. No page opens for photos that are no longer current. Added (owner decision 2026-11-22): the photos travel only through these one-purpose pages, never as a public link or an MMS. Changed (owner decision D14 of 2026-11-22, "i like private link, but not the 24 hours restriction"): the view link opened a ready offer only within 48 hours and the bound phone only for 24 hours after the first open; the bound browser now replaces the phone-for-24-hours binding with no time limit, and the receiver's renewable link replaces a new offer when the receiver changes phone. The receiver's own site session was the other choice; the sites have no sign-in (the founder correction of 2026-10-19), so a session would add a sign-in page, while the renewal goes through the receiver's own verified phone line.

```quint
pure val photoPageLinkTtlMs: int = 900000

pure val issuedAtValues = Set(0, 1, 900000)
pure val deviceBoundValues = Set(true, false)
pure val sameDeviceValues = Set(true, false)
pure val sameRevisionValues = Set(true, false)
pure val itemsCurrentValues = Set(true, false)
pure val isReceiverValues = Set(true, false)

pure def photoPageLinkLive(issuedAt: int, at: int, deviceBound: bool, sameDevice: bool, sameRevision: bool): bool =
  sameRevision and at >= issuedAt and at - issuedAt < photoPageLinkTtlMs and (not(deviceBound) or sameDevice)

pure def photoViewAllowed(phase: OfferPhase, deviceBound: bool, sameDevice: bool, itemsCurrent: bool): bool =
  itemsCurrent and phase == Ready and (not(deviceBound) or sameDevice)

pure def photoViewLinkRenewable(phase: OfferPhase, isReceiver: bool, itemsCurrent: bool): bool =
  isReceiver and itemsCurrent and phase == Ready

pure def lawStaleLinkIsNotLive(issuedAt: int, deviceBound: bool, sameDevice: bool, sameRevision: bool): bool =
  not(photoPageLinkLive(issuedAt, issuedAt + photoPageLinkTtlMs, deviceBound, sameDevice, sameRevision))

pure def lawViewNeedsTheBoundBrowser(phase: OfferPhase, itemsCurrent: bool): bool =
  not(photoViewAllowed(phase, true, false, itemsCurrent))

pure def lawNoViewAfterTheOfferEnds(phase: OfferPhase, deviceBound: bool, sameDevice: bool, itemsCurrent: bool): bool =
  phase != Ready implies not(photoViewAllowed(phase, deviceBound, sameDevice, itemsCurrent))

pure def lawNoViewWhenNotCurrent(phase: OfferPhase, deviceBound: bool, sameDevice: bool): bool =
  not(photoViewAllowed(phase, deviceBound, sameDevice, false))

pure def lawNoClockEndsAView(deviceBound: bool): bool = photoViewAllowed(Ready, deviceBound, true, true)

pure def lawOnlyTheReceiverRenewsTheLink(phase: OfferPhase, itemsCurrent: bool): bool =
  not(photoViewLinkRenewable(phase, false, itemsCurrent))

pure def lawNoNewLinkAfterTheOfferEnds(phase: OfferPhase, isReceiver: bool, itemsCurrent: bool): bool =
  phase != Ready implies not(photoViewLinkRenewable(phase, isReceiver, itemsCurrent))
```

### Only a yes or no to the newest ask answers it

The receiver's reply answers an ask only when the ask is the newest prompt to the receiver and the offer is still asking. NO MORE PHOTOS declines every open ask to the receiver, whatever came last, and stops later asks. Any other reply is not an answer to the ask. Added (owner decision 2026-11-22): the receiver chooses whether to receive each photo.

```quint
type AskAnswer = NotForTheAsk | ReceiverTakes | ReceiverDeclines | ReceiverDeclinesAll

pure val askingValues = Set(true, false)
pure val noMoreValues = Set(true, false)

pure def photoAskAnswerFor(promptIsNewest: bool, asking: bool, yes: bool, no: bool, noMore: bool): AskAnswer =
  if (noMore) ReceiverDeclinesAll
  else if (not(promptIsNewest) or not(asking)) NotForTheAsk
  else if (no) ReceiverDeclines
  else if (yes) ReceiverTakes
  else NotForTheAsk

pure def lawOnlyAYesToTheNewestAskTakes(promptIsNewest: bool, asking: bool, yes: bool, no: bool, noMore: bool): bool =
  photoAskAnswerFor(promptIsNewest, asking, yes, no, noMore) == ReceiverTakes implies
    (promptIsNewest and asking and yes and not(no) and not(noMore))

pure def lawNeverDeclinesEveryAsk(promptIsNewest: bool, asking: bool, yes: bool, no: bool): bool =
  photoAskAnswerFor(promptIsNewest, asking, yes, no, true) == ReceiverDeclinesAll
```

### A withdrawal by text revokes the member's open photo items for the match

A member who says not to send their photo (for example "don't send my photo") withdraws it in the conversation. For the current match, the shell revokes each item that the member owns for this match and that is still pending or approved, in the transaction that completes the action. A revoked item is never shown. The reply says that the photo will not be sent, or that no photo was waiting for this match. Added after the audit (PRI-D1): before this rule only a site route could revoke an item, and there is no account portal, so a member who chose a photo by text could not take it back before delivery. When an item that the reply counted is no longer withdrawable at the commit (another revoke took it first), the action fails and the reply is not sent, so the member is never told that a photo will not be sent when it was. The site revoke and the text withdrawal use the same revoke step. Changed after review: the reply first counted the items before the commit and was sent even when the commit revoked fewer. Changed (owner decision 2026-11-22): a withdrawal also revokes an offer that is still asking the receiver, and it stops a view that is open, because the photo now travels as an offer and a one-phone view; a view that the receiver already saw cannot be undone, and the reply says so. Changed after review (owner decision 2026-11-22): "take back" is a withdrawal only when a photo reference follows it (a photo word, a number, "one" or a photo name), because "take back what I said" took back every photo of the match. Changed (owner decision D14 of 2026-11-22, "its enabled until its retracted by the user"): a take-back is now the normal end of a view, so it acts at once on every path (the text line, the Take back button of the photos page, and the member's own agent through `photo_request`): the items are revoked in the same transaction, and the next page or image call of the receiver finds nothing.

```quint
type PhotoWithdrawal = PhotoWithdrawn | NoPhotoToWithdraw

pure val ownItemValues = Set(true, false)
pure val sameMatchValues = Set(true, false)
pure val openValues = Set(true, false)
pure val withdrawnValues = Set(-1, 0, 1, 2)

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
