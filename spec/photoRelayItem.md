# Photo relay: naming, offering and viewing a photo

After a match, an adult slop.date member can send their own photo to the match through the agent (founder decision 9). The member says which photo in their own words. The service reads the words without a model (`readPhotoMessage` in `packages/network/service/photoReference.ts`), proposes the photos that the words name, and shows them on a check page. Only YES to that proposal, or Send on that page, is consent. The receiver is asked first. After the receiver says yes, an automatic image safety check screens each photo, and a person on the safety team sees only a photo that the check did not clear ([photo consent and review](photoRelayReview.md)). Then the receiver gets a private link that opens the photos for the receiver's browser until the sender takes them back or the access ends for another reason. The [whole-flow model](models/photo_relay_item.md) follows one offer from the words to the view. Changed (owner decisions 2026-11-22, D4 and D14): the member chose a photo by a number from a list, a person checked every photo, and the photo went out as an MMS or a view that opened on one phone for 24 hours -> the member's words pick the photos, the receiver is asked first, an automatic check clears each photo, and the view stays open until the sender takes it back, because the owner wants no model choosing a photo and no time limit on a private link.

The shell owns the words, the photo rows, the offer, draft and link rows, the row locks, the texts and the pages. These decisions receive only numbers, flags and photo masks. A photo mask holds one bit for each of the sender's photos: photo 1 is bit 1, photo 2 is bit 2, photo 3 is bit 4, and so on up to photo 6. The photos are numbered 1 to the count, oldest first, everywhere.

## Story: Send my photo to my match

> As an adult slop.date member with a match, I want to say which of my photos to send in my own words, see exactly those photos before I agree, and know that my match chose to get them, so that no photo goes out that I did not choose for that person.

### A reference names only the sender's own photos and never guesses between two

The reader turns the member's words into masks: `candidates` (the photos that the words name), `exact` (the photos whose name equals the words), `excluded` (the photos that the words exclude) and `shared` (the photos that the match already has). The flags say that the words name another person's photo (`otherOwner`), hold a photo code or a link (`codeTyped`), or choose by looks (`byLooks`). `hadFeature` says that the words hold any selector or content word, and `wantsSet` says that the words ask for more than one photo. The member can refer to a photo by its number, its position, its day, its name (also the full name without a photo word, "send her the beach sunset"), the newest or oldest ones, or the photo another match has. "Of" before a capitalized place name or a word of the member's own photo names ("the photo of Sunset Park") does not name another person's photo. A refusal proposes nothing and lists the sender's photos again. Words that name no photo ask the member to choose. Words that name two or more photos, when the member asked for one, ask which one, unless exactly one of them has the exact name. The decision never proposes a photo outside the sender's own photos, an excluded photo, or a photo that the match already has, and never proposes more than three. Changed (owner decision 2026-11-22, D4): the member chose a photo by a number from a list -> the member's own words name the photos and the decision never guesses between two, because fixed rules and not a model pick the photos. Changed (verification 2026-11-23): the bit test divided by the bit weight without a check, and a weight of 0 stopped the simulator -> a weight below 1 reads as no photo and the simulator tries only the six weights 1, 2, 4, 8, 16 and 32, because callers pass only those weights and the test must be defined for every input.

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

pure val dValues = Set(1, 2, 4, 8, 16, 32)

pure def slotBit(m: int, d: int): int = if (d < 1) 0 else (cleanMask(m) / d) % 2

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

A proposal names each photo and links to the check page. A reply answers the proposal only when the proposal is the newest prompt to the member and the reply holds a photo reference, a yes or a no. A reply after fifteen minutes has lapsed and sends nothing. A reply that names photos changes the proposal and is never a yes. A no cancels it. A yes to a question that proposed no photo asks which one. A yes after the photos or the notice changed shows the new proposal and sends nothing. Only a yes to the unchanged, newest, fresh proposal is consent. A reply that names another match, two matches, everyone or an unknown name after "to", "with" or "for" is never a yes to the proposal: the reader reads it as a new request for that recipient, which needs its own proposal and its own yes. A reply that is about something else leaves the proposal as it is. A yes that the member reports from someone else ("Ana said yes", "tell her yes") or that sits in a message for a third party ("tell them I can send them my number") is never a yes. Changed (verification 2026-11-23, relay requests review): the reader took "Ana said yes" as consent to the proposal -> only the member's own direct yes counts, because a reported yes is not the member's consent. Changed (owner decision 2026-11-22, D4): a number in any later message chose a photo, and "yes, send it to Jordan" to a proposal for Maya sent the photo to Maya -> only a yes to the newest proposal for that recipient is consent, because the consent of each recipient must hold.

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

After the sender's consent, the service makes one offer for one match with one to three photos. `partiesOk` says that both people are adults, neither blocked the other, neither said STOP or left, neither is on hold, the thread is open, and the sender may still keep photos. `openToPair` counts the offers of this pair that wait for the receiver's answer or for the check (asking or reviewing), or whose sender notice is not yet due; a ready offer does not count. `unopenedEnds` counts the declined and lapsed offers of this pair that never reached ready, and `lastUnopenedEndAt` is the latest of their notice due times. `photosLastDay` counts the photos that the sender offered in the last 24 hours. After two offers that the match never opened, photos are off for the pair. After one, the sender waits three days. A receiver who said NO MORE PHOTOS is never asked: the offer ends at once as declined, and the sender hears the same as for a decline, at the same time. Changed (owner decisions 2026-11-22, D4 and D14): the receiver had no choice and `openToPair` counted ready offers -> the receiver chooses whether to receive, repeated unopened offers stop, and a ready offer does not block the next one, because a ready offer no longer ends on a clock.

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

An offer starts asking. The service asks the receiver once and gives them 24 hours to answer. A yes before that time starts the automatic check of each photo; a no declines; no answer lapses. The offer is ready as soon as the check or a person on the safety team approved at least one photo, so a clean photo is released at once while a flagged photo of the same offer still waits for staff. When every photo is decided and none is approved, the offer is rejected if staff rejected one, else timed out. A ready offer stays ready, with no time limit, until the sender takes back all its photos (revoked), the receiver reports it (reported), or the access ends for another reason (ended): a block, a report, a ban, STOP, leaving the app, erasure, the match or the thread ending, or an age reading under 18. A photo that the sender takes back, and a photo whose row changed or was deleted, stop showing at once, while the other photos of the offer stay; when no photo of the offer is left, nothing shows. An ended offer never changes again. The transaction that records a block, a ban, STOP, leaving, a hold or a restriction, erasure or an age reading under 18 also records an end fact on every open offer of that person, in both directions, and an offer with an end fact is not current, so a condition that is lifted later (START after STOP, a hold that is released) never opens the offer again; the tick then ends it. `itemsCurrent` says that the offer has no end fact, its parties are current, and at least one approved photo of the offer is still current: not taken back, its photo row the same, and its notice the one in force. Changed (owner decision 2026-11-22, D14): a ready offer lapsed when nobody opened it in 48 hours and closed 24 hours after the first open, the end reasons were read only when the page opened or the tick came, and one deleted photo hid the whole offer -> no clock ends a ready offer, an end fact is written in the same transaction as its cause, and each photo stops on its own, because the view stays open until the sender takes it back.

The view page confirms a report only when the photo closed and the service filed a safety report. If the photo closed without a safety report, the page shows the closed step with the help address. A report from the view page gets one text confirmation: that the photo is closed and, when a safety report was filed, that the safety team will look at it. The confirmation answers the receiver's own action on the page, so it goes at once and is not proactive outreach: it takes no slot of a budget or a cap and is never deferred as an interruption. The page action is not a message in the receiver's thread, so it leaves the outreach pause, the unanswered entries, the thread counters and the response windows in place, as the [outreach policy](outreachPolicy.md) requires. The send still applies the recipient checks, the opt-out of the member and the leak guard. Changed (review of the photo relay, 2026-11-23): the report marked the receiver as heard so that the confirmation could pass the outreach controller -> the confirmation answers the page action and the receiver is not marked as heard, because only a current message from the member's thread clears the outreach pause.

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

pure def canAskReceiver(o: PhotoOffer): bool = o.phase == Asking and o.answerBy == 0
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

pure def photoPageReportConfirmed(closed: bool, filed: bool): bool = closed and filed

pure def lawPhotoPageReportNeedsFiling(closed: bool, filed: bool): bool =
  photoPageReportConfirmed(closed, filed) iff (closed and filed)

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

The sender hears that the photo is on its way when the offer is ready, and never hears whether the receiver opened it. A decline, a lapse, a receiver who said NO MORE PHOTOS and an end before ready all read "not taken", and that notice is not due before the answer deadline, so a decline, a lapse and an end before ready (for example a block by the receiver) look the same in words and in time. A rejected offer and an offer that the safety team did not check in time each have their own notice. A sender who took the photos back hears only the reply to that request. A "sent" notice that is not yet out when the offer ends is dropped, so the sender is never told that a photo is on its way after it stopped. The sender's photo list and a take-back follow the same rule: a declined offer and an offer that ended before ready show as asked until the notice is due, and a take-back of either gets the same reply as a take-back of an open ask and drops its notice; from ready on, the list shows one state, whether the receiver opened the photo, reported it or the match ended, and a take-back gets one reply. A photo that the sender took back shows as taken back for that match, for a whole offer and for one photo of an offer, and a take-back of it takes nothing more back. Changed (owner decisions 2026-11-22, Q9 and D14): the list showed a decline or an end before ready at once, showed whether the receiver opened the photo, and showed nothing for a taken-back photo -> the list and the take-back reply hide a decline and an end before ready until the notice is due, never show an open, and show a taken-back photo as taken back, because the sender must not learn the receiver's choice early and must see that the take-back worked.

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
  else if ((phase == Declined or phase == Lapsed or phase == Ended) and noticeLater) SeesAsked
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
    and photoSenderViewFor(Ended, false, false, noticeLater) == photoSenderViewFor(Declined, false, false, noticeLater)
    and (noticeLater implies photoSenderViewFor(Declined, false, false, noticeLater) == photoSenderViewFor(Asking, false, false, noticeLater))

pure def lawTheListIsNoReadReceipt(noticeLater: bool): bool =
  photoSenderViewFor(Ready, true, false, noticeLater) == photoSenderViewFor(Reported, true, false, noticeLater)
    and photoSenderViewFor(Ended, true, false, noticeLater) == photoSenderViewFor(Reported, true, false, noticeLater)

pure def lawTakeBackIsNoReadReceipt(noticeLater: bool): bool =
  photoTakeBackFor(Ended, true, false, noticeLater) == photoTakeBackFor(Reported, true, false, noticeLater)

pure def lawTakeBackHidesADecline(noticeLater: bool): bool =
  noticeLater implies (photoTakeBackFor(Declined, false, false, noticeLater) == TakeBackQuietly
    and photoTakeBackFor(Ended, false, false, noticeLater) == TakeBackQuietly)

pure def lawTakenBackShowsAsTakenBack(wasReady: bool, noticeLater: bool): bool =
  photoSenderViewFor(Revoked, wasReady, true, noticeLater) == SeesTakenBack and photoSenderViewFor(Declined, wasReady, true, noticeLater) == SeesTakenBack

pure def lawATakenBackPhotoListsAsTakenBack(seen: PhotoSenderView): bool = photoListedAs(seen, true) == SeesTakenBack

pure def lawTakenBackIsNotTakenBackAgain(wasReady: bool, noticeLater: bool): bool =
  photoTakeBackFor(Revoked, wasReady, true, noticeLater) == TakeBackNothing
```

### A photo link only serves its own page

Every open, image and answer request names the page's own purpose in the `X-Photo-Page-Purpose` header. The purpose must agree with the stored link and be `check`, `mine` or `view`. A missing or different purpose gets the same answer as an unknown link. The request binds no browser, reads no page metadata or bytes, and starts no action.

```quint
pure val photoPagePurposeHeader: str = "x-photo-page-purpose"
pure val requestedPurposeValues = Set("", "check", "mine", "view", "other")
pure val storedPurposeValues = Set("check", "mine", "view", "other")

pure def photoPagePurposeMatches(requestedPurpose: str, storedPurpose: str): bool =
  requestedPurpose == storedPurpose and (storedPurpose == "check" or storedPurpose == "mine" or storedPurpose == "view")

pure def lawWrongPhotoPagePurposeIsRefused(requestedPurpose: str, storedPurpose: str): bool =
  (requestedPurpose != storedPurpose or (storedPurpose != "check" and storedPurpose != "mine" and storedPurpose != "view"))
    implies not(photoPagePurposeMatches(requestedPurpose, storedPurpose))
```

### The check page serves only photos from its proposal

The check page reads the photo number from the same ordered set that the proposal showed. Before it reads the numbered photo, the service compares the current set hash with the hash in the draft. A changed set cannot make a number show another photo. The service checks the proposal revision again after it reads the bytes. A pick compares the same set under the photo owner lock and updates only the current draft revision. A change to that set leaves the draft untouched.

```quint
pure def photoCheckSetMatches(proposalSetHash: str, currentSetHash: str): bool =
  proposalSetHash == currentSetHash

pure def lawChangedPhotoSetCannotSupplyCheckImage(proposalSetHash: str, currentSetHash: str): bool =
  proposalSetHash != currentSetHash implies not(photoCheckSetMatches(proposalSetHash, currentSetHash))
```

### A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back

The check page and the photos page open from a link that the agent sent in the conversation. The link lives fifteen minutes, and a check page link is only for the proposal revision that it was made for. The first open binds the link to that browser, and every later call needs the same browser. The view link goes only to the receiver's own phone line. Its first open binds it to that browser, and from then on it opens only there, for a ready offer whose photos are current, with no time limit. The browser keeps the binding when it restarts: the binding cookie lives 400 days, and each open of the view renews it. The receiver can ask for a new view link by text (PHOTO LINK): the new link replaces the old one, which then opens nothing, so the receiver can move to another phone and a forwarded old link stays useless. Only the receiver of a ready offer with current photos gets a new link. No page opens for photos that are no longer current. If STOP, a leave, block, hold or other party end commits during the request, the service checks again before it binds a browser or returns view metadata or bytes. An item taken back during a byte read does not return the old image. The photos travel only through these one-purpose pages, never as a public link or an MMS. Changed (owner decision 2026-11-22, D14): the view opened a ready offer only within 48 hours and the bound phone only for 24 hours, with a session cookie -> a bound browser opens it with no time limit and a renewable link, because the view stays open until the sender takes it back.

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

The receiver's reply answers an ask only when the ask is the newest prompt to the receiver and the offer is still asking. NO MORE PHOTOS declines every open ask to the receiver, whatever came last, and stops later asks. Any other reply is not an answer to the ask. Changed (owner decision 2026-11-22, D4): the receiver was not asked -> the receiver chooses whether to receive each offer, because the receiver is asked first.

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

pure def lawNoMorePhotosDeclinesEveryAsk(promptIsNewest: bool, asking: bool, yes: bool, no: bool): bool =
  photoAskAnswerFor(promptIsNewest, asking, yes, no, true) == ReceiverDeclinesAll
```

### A take-back revokes the member's open photo items for the match

A member who says not to send their photo ("don't send my photo") or takes it back ("take back photo 2", "unsend it") withdraws it. "Take back" is a withdrawal only when a photo reference follows it (a photo word, a number, "one" or a photo name), so "take back what I said" takes back nothing. A take-back acts the same on every path: the text line, the Take back button of the photos page, and the member's own agent through `photo_request`. For the current match, the shell revokes each item that the member owns for this match and that is still open (an offer that asks the receiver, an item in the check, or a ready view), in the transaction that completes the action. A revoked item is never shown, and the next page or image call of the receiver finds nothing. The reply says that the photo will not be sent, or that no photo was waiting for this match; a view that the receiver already saw cannot be undone, and the reply says so. When an item that the reply counted is no longer withdrawable at the commit (another revoke took it first), the action fails and the reply is not sent, so the member is never told that a photo will not be sent when it was. Changed (audit PRI-D1 and owner decision 2026-11-22, D14): only a site route could revoke an item, and the reply counted the items before the commit -> every path revokes in one transaction and the reply counts the commit, because the sites have no account portal and the view now ends only when the sender takes it back.

```quint
pure val ownItemValues = Set(true, false)
pure val sameMatchValues = Set(true, false)
pure val openValues = Set(true, false)

pure def photoItemWithdrawable(ownItem: bool, sameMatch: bool, open: bool): bool =
  ownItem and sameMatch and open

pure def lawOnlyOwnItemsAreWithdrawn(sameMatch: bool, open: bool): bool =
  not(photoItemWithdrawable(false, sameMatch, open))

pure def lawOnlyThisMatchIsWithdrawn(ownItem: bool, open: bool): bool =
  not(photoItemWithdrawable(ownItem, false, open))
```

### The photo page takes back exactly one listed share

The photo page sends the opaque reference from the selected share. The service uses the existing sender, app, offer and photo to make that reference. The first name and photo number are display values. A request affects only its exact reference when the photo is still owned and the match is available to the sender. An absent or stale reference takes back nothing. The withdrawal still uses the existing offer lock and rules.

```quint
pure val requestedShareValues = Set("first", "second", "unknown")
pure val listedShareValues = Set("first", "second")

pure def photoMineShareMatches(requestedShare: str, listedShare: str, ownsPhoto: bool, currentMatch: bool): bool =
  requestedShare == listedShare and ownsPhoto and currentMatch

pure def lawUnlistedPhotoShareCannotBeTakenBack(requestedShare: str, listedShare: str, ownsPhoto: bool, currentMatch: bool): bool =
  (requestedShare != listedShare or not(ownsPhoto) or not(currentMatch))
    implies not(photoMineShareMatches(requestedShare, listedShare, ownsPhoto, currentMatch))
```
