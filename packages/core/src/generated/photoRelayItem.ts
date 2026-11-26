// GENERATED from spec/photoRelayItem.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
export type PhotoPick = "ProposePhotos" | "ChoosePhotos" | "ListPhotos" | "NoMatchingPhoto" | "AlreadyShared" | "TooManyPhotos" | "OwnPhotosOnly" | "NoPhotoCodes" | "NotByLooks" | "AskWhichMatch" | "AddPhotosFirst" | "PhotosUnavailable";
/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
export interface PhotoPickResult { pick: PhotoPick; chosen: number }
/** Story: Send my photo to my match / A yes counts only for the proposal the member was just shown (spec/photoRelayItem.md) */
export type DraftReply = "NotForTheDraft" | "DraftLapsed" | "ChangeProposal" | "CancelDraft" | "AskWhichOne" | "PhotosChanged" | "ConsentGiven";
/** Story: Send my photo to my match / A photo offer goes to one adult match who has room for it (spec/photoRelayItem.md) */
export type OfferAdmission = "OfferAsk" | "OfferSilentDecline" | "OfferWaitForAnswer" | "OfferCoolingDown" | "OfferPhotosOff" | "OfferDailyLimit" | "OfferUnavailable";
/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
export type OfferPhase = "Asking" | "Reviewing" | "Ready" | "Declined" | "Lapsed" | "Rejected" | "CheckTimedOut" | "Revoked" | "Ended" | "Reported";
/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
export interface PhotoOffer { phase: OfferPhase; answerBy: number }
/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
export type OfferNotice = "NoNotice" | "TellSent" | "TellNotTaken" | "TellNotApproved" | "TellCheckTimedOut";
/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
export type PhotoSenderView = "SeesNothing" | "SeesAsked" | "SeesChecking" | "SeesSent" | "SeesTakenBack";
/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
export type PhotoTakeBack = "TakeBackNothing" | "TakeBackOffer" | "TakeBackQuietly" | "TakeBackSeen";
/** Story: Send my photo to my match / Only a yes or no to the newest ask answers it (spec/photoRelayItem.md) */
export type AskAnswer = "NotForTheAsk" | "ReceiverTakes" | "ReceiverDeclines" | "ReceiverDeclinesAll";

/** One variant per transition in the spec. */
export type Event =
  | { type: "askReceiver"; at: number }
  | { type: "answerYes"; at: number }
  | { type: "answerNo" }
  | { type: "lapseAnswer"; at: number }
  | { type: "settleReview"; approved: number; rejected: number; timedOut: number; total: number }
  | { type: "revokeOffer"; ownerMatches: boolean }
  | { type: "endOffer" }
  | { type: "reportOffer"; byReceiver: boolean };

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
export const photoSlotsMax: number = 6;
/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
export const photoSetMax: number = 3;
/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
export const maskAll: number = 63;
/** Story: Send my photo to my match / A yes counts only for the proposal the member was just shown (spec/photoRelayItem.md) */
export const photoDraftTtlMs: number = 900000;
/** Story: Send my photo to my match / A photo offer goes to one adult match who has room for it (spec/photoRelayItem.md) */
export const photoOfferCooldownMs: number = 259200000;
/** Story: Send my photo to my match / A photo offer goes to one adult match who has room for it (spec/photoRelayItem.md) */
export const photoOfferUnopenedMax: number = 2;
/** Story: Send my photo to my match / A photo offer goes to one adult match who has room for it (spec/photoRelayItem.md) */
export const photoOffersDaily: number = 6;
/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
export const offerAnswerMs: number = 86400000;
/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
export const initial: PhotoOffer = { phase: "Asking", answerBy: 0 };
/** Story: Send my photo to my match / A photo link only serves its own page (spec/photoRelayItem.md) */
export const photoPagePurposeHeader: string = "x-photo-page-purpose";
/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
export const photoPageLinkTtlMs: number = 900000;

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoOffer): boolean {
  return true;
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function cleanMask(m: number): number {
  return m < 0 || m > maskAll ? 0 : m;
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function slotBit(m: number, d: number): number {
  return d < 1 ? 0 : remainder_photoRelayItem(quotient_photoRelayItem(cleanMask(m), d), 2);
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function slotCount(m: number): number {
  return exact_photoRelayItem(exact_photoRelayItem(exact_photoRelayItem(exact_photoRelayItem(exact_photoRelayItem(slotBit(m, 1) + slotBit(m, 2)) + slotBit(m, 4)) + slotBit(m, 8)) + slotBit(m, 16)) + slotBit(m, 32));
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function bothMasks(a: number, b: number): number {
  return exact_photoRelayItem(exact_photoRelayItem(exact_photoRelayItem(exact_photoRelayItem(exact_photoRelayItem(exact_photoRelayItem(slotBit(a, 1) * slotBit(b, 1)) + exact_photoRelayItem(exact_photoRelayItem(slotBit(a, 2) * slotBit(b, 2)) * 2)) + exact_photoRelayItem(exact_photoRelayItem(slotBit(a, 4) * slotBit(b, 4)) * 4)) + exact_photoRelayItem(exact_photoRelayItem(slotBit(a, 8) * slotBit(b, 8)) * 8)) + exact_photoRelayItem(exact_photoRelayItem(slotBit(a, 16) * slotBit(b, 16)) * 16)) + exact_photoRelayItem(exact_photoRelayItem(slotBit(a, 32) * slotBit(b, 32)) * 32));
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function withoutMask(m: number, x: number): number {
  return exact_photoRelayItem(cleanMask(m) - bothMasks(m, x));
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function ownSlots(count: number): number {
  return count <= 0 ? 0 : (count === 1 ? 1 : (count === 2 ? 3 : (count === 3 ? 7 : (count === 4 ? 15 : (count === 5 ? 31 : maskAll)))));
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function photoPickFor(available: boolean, otherOwner: boolean, codeTyped: boolean, byLooks: boolean, recipients: number, count: number, hadFeature: boolean, wantsSet: boolean, candidates: number, exact: number, excluded: number, shared: number): PhotoPickResult {
  const local_0 = ownSlots(count);
  const local_1 = withoutMask(bothMasks(candidates, local_0), excluded);
  const local_2 = withoutMask(local_1, shared);
  const local_3 = bothMasks(local_1, exact);
  const local_4 = withoutMask(local_0, excluded);
  return !available ? ({ pick: "PhotosUnavailable", chosen: 0 } as PhotoPickResult) : (otherOwner ? ({ pick: "OwnPhotosOnly", chosen: local_4 } as PhotoPickResult) : (codeTyped ? ({ pick: "NoPhotoCodes", chosen: local_4 } as PhotoPickResult) : (byLooks ? ({ pick: "NotByLooks", chosen: local_4 } as PhotoPickResult) : (recipients !== 1 ? ({ pick: "AskWhichMatch", chosen: 0 } as PhotoPickResult) : (count <= 0 ? ({ pick: "AddPhotosFirst", chosen: 0 } as PhotoPickResult) : (!hadFeature ? ({ pick: "ListPhotos", chosen: local_4 } as PhotoPickResult) : (local_1 === 0 ? ({ pick: "NoMatchingPhoto", chosen: local_4 } as PhotoPickResult) : (wantsSet && local_2 === 0 ? ({ pick: "AlreadyShared", chosen: local_1 } as PhotoPickResult) : (wantsSet && slotCount(local_2) <= photoSetMax ? ({ pick: "ProposePhotos", chosen: local_2 } as PhotoPickResult) : (wantsSet ? ({ pick: "TooManyPhotos", chosen: local_2 } as PhotoPickResult) : (slotCount(local_1) === 1 && local_2 === 0 ? ({ pick: "AlreadyShared", chosen: local_1 } as PhotoPickResult) : (slotCount(local_1) === 1 ? ({ pick: "ProposePhotos", chosen: local_1 } as PhotoPickResult) : (slotCount(local_3) === 1 && bothMasks(local_2, exact) === 0 ? ({ pick: "AlreadyShared", chosen: local_3 } as PhotoPickResult) : (slotCount(local_3) === 1 ? ({ pick: "ProposePhotos", chosen: local_3 } as PhotoPickResult) : ({ pick: "ChoosePhotos", chosen: local_1 } as PhotoPickResult)))))))))))))));
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function lawChosenAreOwnPhotos(available: boolean, otherOwner: boolean, codeTyped: boolean, byLooks: boolean, recipients: number, count: number, hadFeature: boolean, wantsSet: boolean, candidates: number, exact: number, excluded: number, shared: number): boolean {
  //@ ensures \result === true
  const local_5: PhotoPickResult = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  return withoutMask(local_5.chosen, ownSlots(count)) === 0;
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function lawExcludedNeverProposed(available: boolean, otherOwner: boolean, codeTyped: boolean, byLooks: boolean, recipients: number, count: number, hadFeature: boolean, wantsSet: boolean, candidates: number, exact: number, excluded: number, shared: number): boolean {
  //@ ensures \result === true
  const local_6: PhotoPickResult = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  return !(local_6.pick === "ProposePhotos") || bothMasks(local_6.chosen, excluded) === 0;
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function lawProposalHoldsOneToThree(available: boolean, otherOwner: boolean, codeTyped: boolean, byLooks: boolean, recipients: number, count: number, hadFeature: boolean, wantsSet: boolean, candidates: number, exact: number, excluded: number, shared: number): boolean {
  //@ ensures \result === true
  const local_7: PhotoPickResult = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  return !(local_7.pick === "ProposePhotos") || (slotCount(local_7.chosen) >= 1 && slotCount(local_7.chosen) <= photoSetMax);
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function lawNeverGuessesBetweenPhotos(available: boolean, otherOwner: boolean, codeTyped: boolean, byLooks: boolean, recipients: number, count: number, hadFeature: boolean, wantsSet: boolean, candidates: number, exact: number, excluded: number, shared: number): boolean {
  //@ ensures \result === true
  const local_8: PhotoPickResult = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  return !(local_8.pick === "ProposePhotos" && !wantsSet) || slotCount(local_8.chosen) === 1;
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function lawSharedNeverProposedAgain(available: boolean, otherOwner: boolean, codeTyped: boolean, byLooks: boolean, recipients: number, count: number, hadFeature: boolean, wantsSet: boolean, candidates: number, exact: number, excluded: number, shared: number): boolean {
  //@ ensures \result === true
  const local_9: PhotoPickResult = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  return !(local_9.pick === "ProposePhotos") || bothMasks(local_9.chosen, shared) === 0;
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function lawRefusedNeverProposes(available: boolean, otherOwner: boolean, codeTyped: boolean, byLooks: boolean, recipients: number, count: number, hadFeature: boolean, wantsSet: boolean, candidates: number, exact: number, excluded: number, shared: number): boolean {
  //@ ensures \result === true
  const local_10: PhotoPickResult = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  return !(!available || otherOwner || codeTyped || byLooks) || local_10.pick !== "ProposePhotos";
}

/** Story: Send my photo to my match / A reference names only the sender's own photos and never guesses between two (spec/photoRelayItem.md) */
//@ pure
export function lawOneMatchAtATime(available: boolean, otherOwner: boolean, codeTyped: boolean, byLooks: boolean, recipients: number, count: number, hadFeature: boolean, wantsSet: boolean, candidates: number, exact: number, excluded: number, shared: number): boolean {
  //@ ensures \result === true
  const local_11: PhotoPickResult = photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  return !(recipients !== 1) || local_11.pick !== "ProposePhotos";
}

/** Story: Send my photo to my match / A yes counts only for the proposal the member was just shown (spec/photoRelayItem.md) */
//@ pure
export function photoDraftReplyFor(promptIsNewest: boolean, shownAt: number, at: number, hasReference: boolean, yes: boolean, no: boolean, proposed: boolean, sameNotice: boolean, sameSet: boolean): DraftReply {
  return !promptIsNewest || !(hasReference || yes || no) ? "NotForTheDraft" : (at < shownAt || exact_photoRelayItem(at - shownAt) >= photoDraftTtlMs ? "DraftLapsed" : (hasReference ? "ChangeProposal" : (no ? "CancelDraft" : (!proposed ? "AskWhichOne" : (!sameNotice || !sameSet ? "PhotosChanged" : "ConsentGiven")))));
}

/** Story: Send my photo to my match / A yes counts only for the proposal the member was just shown (spec/photoRelayItem.md) */
//@ pure
export function lawConsentNeedsAFreshUnchangedProposal(promptIsNewest: boolean, shownAt: number, at: number, hasReference: boolean, yes: boolean, no: boolean, proposed: boolean, sameNotice: boolean, sameSet: boolean): boolean {
  //@ ensures \result === true
  return !(photoDraftReplyFor(promptIsNewest, shownAt, at, hasReference, yes, no, proposed, sameNotice, sameSet) === "ConsentGiven") || (promptIsNewest && at >= shownAt && exact_photoRelayItem(at - shownAt) < photoDraftTtlMs && !hasReference && yes && !no && proposed && sameNotice && sameSet);
}

/** Story: Send my photo to my match / A yes counts only for the proposal the member was just shown (spec/photoRelayItem.md) */
//@ pure
export function lawLapsedDraftNeverConsents(promptIsNewest: boolean, shownAt: number, hasReference: boolean, yes: boolean, no: boolean, proposed: boolean, sameNotice: boolean, sameSet: boolean): boolean {
  //@ ensures \result === true
  return photoDraftReplyFor(promptIsNewest, shownAt, exact_photoRelayItem(shownAt + photoDraftTtlMs), hasReference, yes, no, proposed, sameNotice, sameSet) !== "ConsentGiven";
}

/** Story: Send my photo to my match / A yes counts only for the proposal the member was just shown (spec/photoRelayItem.md) */
//@ pure
export function lawCorrectionIsNeverAYes(promptIsNewest: boolean, shownAt: number, at: number, yes: boolean, no: boolean, proposed: boolean, sameNotice: boolean, sameSet: boolean): boolean {
  //@ ensures \result === true
  return photoDraftReplyFor(promptIsNewest, shownAt, at, true, yes, no, proposed, sameNotice, sameSet) !== "ConsentGiven";
}

/** Story: Send my photo to my match / A yes counts only for the proposal the member was just shown (spec/photoRelayItem.md) */
//@ pure
export function lawAnotherQuestionKeepsTheYes(promptIsNewest: boolean, shownAt: number, at: number, proposed: boolean, sameNotice: boolean, sameSet: boolean): boolean {
  //@ ensures \result === true
  return photoDraftReplyFor(promptIsNewest, shownAt, at, false, false, false, proposed, sameNotice, sameSet) === "NotForTheDraft";
}

/** Story: Send my photo to my match / A photo offer goes to one adult match who has room for it (spec/photoRelayItem.md) */
//@ pure
export function photoOfferAdmissionFor(partiesOk: boolean, openToPair: number, unopenedEnds: number, lastUnopenedEndAt: number, at: number, photosLastDay: number, count: number, receiverNever: boolean): OfferAdmission {
  return !partiesOk || count < 1 || count > photoSetMax ? "OfferUnavailable" : (unopenedEnds >= photoOfferUnopenedMax ? "OfferPhotosOff" : (openToPair > 0 ? "OfferWaitForAnswer" : (unopenedEnds > 0 && exact_photoRelayItem(at - lastUnopenedEndAt) < photoOfferCooldownMs ? "OfferCoolingDown" : (exact_photoRelayItem(photosLastDay + count) > photoOffersDaily ? "OfferDailyLimit" : (receiverNever ? "OfferSilentDecline" : "OfferAsk")))));
}

/** Story: Send my photo to my match / A photo offer goes to one adult match who has room for it (spec/photoRelayItem.md) */
//@ pure
export function lawAskNeedsAdultPairAndRoom(partiesOk: boolean, openToPair: number, unopenedEnds: number, lastUnopenedEndAt: number, at: number, photosLastDay: number, count: number, receiverNever: boolean): boolean {
  //@ ensures \result === true
  return !(photoOfferAdmissionFor(partiesOk, openToPair, unopenedEnds, lastUnopenedEndAt, at, photosLastDay, count, receiverNever) === "OfferAsk") || (partiesOk && count >= 1 && count <= photoSetMax && openToPair <= 0 && unopenedEnds < photoOfferUnopenedMax && (unopenedEnds <= 0 || exact_photoRelayItem(at - lastUnopenedEndAt) >= photoOfferCooldownMs) && exact_photoRelayItem(photosLastDay + count) <= photoOffersDaily && !receiverNever);
}

/** Story: Send my photo to my match / A photo offer goes to one adult match who has room for it (spec/photoRelayItem.md) */
//@ pure
export function lawNeverMeansNeverAsked(partiesOk: boolean, openToPair: number, unopenedEnds: number, lastUnopenedEndAt: number, at: number, photosLastDay: number, count: number): boolean {
  //@ ensures \result === true
  return photoOfferAdmissionFor(partiesOk, openToPair, unopenedEnds, lastUnopenedEndAt, at, photosLastDay, count, true) !== "OfferAsk";
}

/** Story: Send my photo to my match / A photo offer goes to one adult match who has room for it (spec/photoRelayItem.md) */
//@ pure
export function lawOneOpenOfferPerPair(partiesOk: boolean, unopenedEnds: number, lastUnopenedEndAt: number, at: number, photosLastDay: number, count: number, receiverNever: boolean): boolean {
  //@ ensures \result === true
  const local_12: OfferAdmission = photoOfferAdmissionFor(partiesOk, 1, unopenedEnds, lastUnopenedEndAt, at, photosLastDay, count, receiverNever);
  return local_12 !== "OfferAsk" && local_12 !== "OfferSilentDecline";
}

/** Story: Send my photo to my match / A photo offer goes to one adult match who has room for it (spec/photoRelayItem.md) */
//@ pure
export function lawPhotosOffAfterTwoUnopened(openToPair: number, lastUnopenedEndAt: number, at: number, photosLastDay: number, count: number, receiverNever: boolean): boolean {
  //@ ensures \result === true
  return !(count >= 1 && count <= photoSetMax) || photoOfferAdmissionFor(true, openToPair, photoOfferUnopenedMax, lastUnopenedEndAt, at, photosLastDay, count, receiverNever) === "OfferPhotosOff";
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function offerOpen(o: PhotoOffer): boolean {
  return o.phase === "Asking" || o.phase === "Reviewing" || o.phase === "Ready";
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function canAskReceiver(o: PhotoOffer): boolean {
  return o.phase === "Asking" && o.answerBy === 0;
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function askReceiver(o: PhotoOffer, at: number): PhotoOffer {
  //@ ensures (inv(o) && canAskReceiver(o)) ==> stepEndsAreFinal(o, \result)
  //@ ensures (inv(o) && canAskReceiver(o)) ==> stepOnlyReviewMakesReady(o, "askReceiver", \result)
  //@ ensures (inv(o) && canAskReceiver(o)) ==> stepOnlyTheReceiverStartsTheCheck(o, "askReceiver", \result)
  //@ ensures (inv(o) && canAskReceiver(o)) ==> stepNoClockEndsAReadyOffer(o, "askReceiver", \result)
  return { ...o, answerBy: exact_photoRelayItem(at + offerAnswerMs) };
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function canAnswerYes(o: PhotoOffer, at: number): boolean {
  return o.phase === "Asking" && o.answerBy > 0 && at < o.answerBy;
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function answerYes(o: PhotoOffer, at: number): PhotoOffer {
  //@ ensures (inv(o) && canAnswerYes(o, at)) ==> stepEndsAreFinal(o, \result)
  //@ ensures (inv(o) && canAnswerYes(o, at)) ==> stepOnlyReviewMakesReady(o, "answerYes", \result)
  //@ ensures (inv(o) && canAnswerYes(o, at)) ==> stepOnlyTheReceiverStartsTheCheck(o, "answerYes", \result)
  //@ ensures (inv(o) && canAnswerYes(o, at)) ==> stepNoClockEndsAReadyOffer(o, "answerYes", \result)
  return { ...o, phase: "Reviewing" };
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function canAnswerNo(o: PhotoOffer): boolean {
  return o.phase === "Asking";
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function answerNo(o: PhotoOffer): PhotoOffer {
  //@ ensures (inv(o) && canAnswerNo(o)) ==> stepEndsAreFinal(o, \result)
  //@ ensures (inv(o) && canAnswerNo(o)) ==> stepOnlyReviewMakesReady(o, "answerNo", \result)
  //@ ensures (inv(o) && canAnswerNo(o)) ==> stepOnlyTheReceiverStartsTheCheck(o, "answerNo", \result)
  //@ ensures (inv(o) && canAnswerNo(o)) ==> stepNoClockEndsAReadyOffer(o, "answerNo", \result)
  return { ...o, phase: "Declined" };
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function canLapseAnswer(o: PhotoOffer, at: number): boolean {
  return o.phase === "Asking" && o.answerBy > 0 && at >= o.answerBy;
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function lapseAnswer(o: PhotoOffer, at: number): PhotoOffer {
  //@ ensures (inv(o) && canLapseAnswer(o, at)) ==> stepEndsAreFinal(o, \result)
  //@ ensures (inv(o) && canLapseAnswer(o, at)) ==> stepOnlyReviewMakesReady(o, "lapseAnswer", \result)
  //@ ensures (inv(o) && canLapseAnswer(o, at)) ==> stepOnlyTheReceiverStartsTheCheck(o, "lapseAnswer", \result)
  //@ ensures (inv(o) && canLapseAnswer(o, at)) ==> stepNoClockEndsAReadyOffer(o, "lapseAnswer", \result)
  return { ...o, phase: "Lapsed" };
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function canSettleReview(o: PhotoOffer, approved: number, rejected: number, timedOut: number, total: number): boolean {
  return o.phase === "Reviewing" && total >= 1 && approved >= 0 && rejected >= 0 && timedOut >= 0 && exact_photoRelayItem(exact_photoRelayItem(approved + rejected) + timedOut) <= total && (approved > 0 || exact_photoRelayItem(exact_photoRelayItem(approved + rejected) + timedOut) === total);
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function settleReview(o: PhotoOffer, approved: number, rejected: number, timedOut: number, total: number): PhotoOffer {
  //@ ensures (inv(o) && canSettleReview(o, approved, rejected, timedOut, total)) ==> stepEndsAreFinal(o, \result)
  //@ ensures (inv(o) && canSettleReview(o, approved, rejected, timedOut, total)) ==> stepOnlyReviewMakesReady(o, "settleReview", \result)
  //@ ensures (inv(o) && canSettleReview(o, approved, rejected, timedOut, total)) ==> stepOnlyTheReceiverStartsTheCheck(o, "settleReview", \result)
  //@ ensures (inv(o) && canSettleReview(o, approved, rejected, timedOut, total)) ==> stepNoClockEndsAReadyOffer(o, "settleReview", \result)
  return approved > 0 ? ({ ...o, phase: "Ready" } as PhotoOffer) : (rejected > 0 ? ({ ...o, phase: "Rejected" } as PhotoOffer) : ({ ...o, phase: "CheckTimedOut" } as PhotoOffer));
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function canRevokeOffer(o: PhotoOffer, ownerMatches: boolean): boolean {
  return ownerMatches && offerOpen(o);
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function revokeOffer(o: PhotoOffer, ownerMatches: boolean): PhotoOffer {
  //@ ensures (inv(o) && canRevokeOffer(o, ownerMatches)) ==> stepEndsAreFinal(o, \result)
  //@ ensures (inv(o) && canRevokeOffer(o, ownerMatches)) ==> stepOnlyReviewMakesReady(o, "revokeOffer", \result)
  //@ ensures (inv(o) && canRevokeOffer(o, ownerMatches)) ==> stepOnlyTheReceiverStartsTheCheck(o, "revokeOffer", \result)
  //@ ensures (inv(o) && canRevokeOffer(o, ownerMatches)) ==> stepNoClockEndsAReadyOffer(o, "revokeOffer", \result)
  return { ...o, phase: "Revoked" };
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function canEndOffer(o: PhotoOffer): boolean {
  return offerOpen(o);
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function endOffer(o: PhotoOffer): PhotoOffer {
  //@ ensures (inv(o) && canEndOffer(o)) ==> stepEndsAreFinal(o, \result)
  //@ ensures (inv(o) && canEndOffer(o)) ==> stepOnlyReviewMakesReady(o, "endOffer", \result)
  //@ ensures (inv(o) && canEndOffer(o)) ==> stepOnlyTheReceiverStartsTheCheck(o, "endOffer", \result)
  //@ ensures (inv(o) && canEndOffer(o)) ==> stepNoClockEndsAReadyOffer(o, "endOffer", \result)
  return { ...o, phase: "Ended" };
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function canReportOffer(o: PhotoOffer, byReceiver: boolean): boolean {
  return byReceiver && o.phase === "Ready";
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function reportOffer(o: PhotoOffer, byReceiver: boolean): PhotoOffer {
  //@ ensures (inv(o) && canReportOffer(o, byReceiver)) ==> stepEndsAreFinal(o, \result)
  //@ ensures (inv(o) && canReportOffer(o, byReceiver)) ==> stepOnlyReviewMakesReady(o, "reportOffer", \result)
  //@ ensures (inv(o) && canReportOffer(o, byReceiver)) ==> stepOnlyTheReceiverStartsTheCheck(o, "reportOffer", \result)
  //@ ensures (inv(o) && canReportOffer(o, byReceiver)) ==> stepNoClockEndsAReadyOffer(o, "reportOffer", \result)
  return { ...o, phase: "Reported" };
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function photoPageReportConfirmed(closed: boolean, filed: boolean): boolean {
  return closed && filed;
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function lawPhotoPageReportNeedsFiling(closed: boolean, filed: boolean): boolean {
  //@ ensures \result === true
  return photoPageReportConfirmed(closed, filed) === (closed && filed);
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function stepEndsAreFinal(before: PhotoOffer, after: PhotoOffer): boolean {
  return !(!offerOpen(before)) || equal_photoRelayItem(after, before);
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function stepOnlyReviewMakesReady(before: PhotoOffer, via: string, after: PhotoOffer): boolean {
  return !(before.phase !== "Ready" && after.phase === "Ready") || via === "settleReview";
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function stepOnlyTheReceiverStartsTheCheck(before: PhotoOffer, via: string, after: PhotoOffer): boolean {
  return !(before.phase !== "Reviewing" && after.phase === "Reviewing") || via === "answerYes";
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function stepNoClockEndsAReadyOffer(before: PhotoOffer, via: string, after: PhotoOffer): boolean {
  return !(before.phase === "Ready" && after.phase !== "Ready") || (via === "revokeOffer" || via === "endOffer" || via === "reportOffer");
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function sometimesReady(o: PhotoOffer): boolean {
  return o.phase === "Ready";
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function sometimesReported(o: PhotoOffer): boolean {
  return o.phase === "Reported";
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function sometimesRevoked(o: PhotoOffer): boolean {
  return o.phase === "Revoked";
}

/** Story: Send my photo to my match / The receiver answers, an automatic check clears each photo, and the view stays open until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function sometimesLapsed(o: PhotoOffer): boolean {
  return o.phase === "Lapsed";
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function senderNoticeFor(phase: OfferPhase, endedBySender: boolean, wasReady: boolean): OfferNotice {
  return endedBySender ? "NoNotice" : (phase === "Ready" ? "TellSent" : (wasReady ? "NoNotice" : (phase === "Declined" || phase === "Lapsed" || phase === "Ended" ? "TellNotTaken" : (phase === "Rejected" ? "TellNotApproved" : (phase === "CheckTimedOut" ? "TellCheckTimedOut" : "NoNotice")))));
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function senderNoticeDueAt(notice: OfferNotice, at: number, answerBy: number): number {
  return notice === "TellNotTaken" && at < answerBy ? answerBy : at;
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawDeclineLooksLikeALapse(wasReady: boolean): boolean {
  //@ ensures \result === true
  return senderNoticeFor("Declined", false, wasReady) === senderNoticeFor("Lapsed", false, wasReady);
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawNotTakenWaitsForTheAnswerDeadline(at: number, answerBy: number): boolean {
  //@ ensures \result === true
  return senderNoticeDueAt("TellNotTaken", at, answerBy) >= answerBy;
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawNoReadReceipt(phase: OfferPhase): boolean {
  //@ ensures \result === true
  return senderNoticeFor(phase, false, true) === "NoNotice" || phase === "Ready";
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function unsentNoticeKept(notice: OfferNotice, phase: OfferPhase): boolean {
  return notice !== "TellSent" || phase === "Ready";
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function photoSenderViewFor(phase: OfferPhase, wasReady: boolean, endedBySender: boolean, noticeLater: boolean): PhotoSenderView {
  return phase === "Asking" ? "SeesAsked" : (phase === "Reviewing" ? "SeesChecking" : (phase === "Ready" ? "SeesSent" : (phase === "Revoked" || endedBySender ? "SeesTakenBack" : (wasReady && (phase === "Ended" || phase === "Reported") ? "SeesSent" : ((phase === "Declined" || phase === "Lapsed" || phase === "Ended") && noticeLater ? "SeesAsked" : "SeesNothing")))));
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function photoListedAs(seen: PhotoSenderView, photoTakenBack: boolean): PhotoSenderView {
  return photoTakenBack ? "SeesTakenBack" : seen;
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function photoTakeBackFor(phase: OfferPhase, wasReady: boolean, endedBySender: boolean, noticeLater: boolean): PhotoTakeBack {
  const local_13: PhotoSenderView = photoSenderViewFor(phase, wasReady, endedBySender, noticeLater);
  return local_13 === "SeesNothing" || local_13 === "SeesTakenBack" ? "TakeBackNothing" : (phase === "Asking" || phase === "Reviewing" || phase === "Ready" ? "TakeBackOffer" : (local_13 === "SeesAsked" ? "TakeBackQuietly" : "TakeBackSeen"));
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawSentIsNotToldAfterTheEnd(phase: OfferPhase): boolean {
  //@ ensures \result === true
  return !(phase !== "Ready") || !unsentNoticeKept("TellSent", phase);
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawDeclineListsAsAskedUntilTheNotice(noticeLater: boolean): boolean {
  //@ ensures \result === true
  return photoSenderViewFor("Declined", false, false, noticeLater) === photoSenderViewFor("Lapsed", false, false, noticeLater) && photoSenderViewFor("Ended", false, false, noticeLater) === photoSenderViewFor("Declined", false, false, noticeLater) && (!noticeLater || photoSenderViewFor("Declined", false, false, noticeLater) === photoSenderViewFor("Asking", false, false, noticeLater));
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawTheListIsNoReadReceipt(noticeLater: boolean): boolean {
  //@ ensures \result === true
  return photoSenderViewFor("Ready", true, false, noticeLater) === photoSenderViewFor("Reported", true, false, noticeLater) && photoSenderViewFor("Ended", true, false, noticeLater) === photoSenderViewFor("Reported", true, false, noticeLater);
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawTakeBackIsNoReadReceipt(noticeLater: boolean): boolean {
  //@ ensures \result === true
  return photoTakeBackFor("Ended", true, false, noticeLater) === photoTakeBackFor("Reported", true, false, noticeLater);
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawTakeBackHidesADecline(noticeLater: boolean): boolean {
  //@ ensures \result === true
  return !noticeLater || (photoTakeBackFor("Declined", false, false, noticeLater) === "TakeBackQuietly" && photoTakeBackFor("Ended", false, false, noticeLater) === "TakeBackQuietly");
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawTakenBackShowsAsTakenBack(wasReady: boolean, noticeLater: boolean): boolean {
  //@ ensures \result === true
  return photoSenderViewFor("Revoked", wasReady, true, noticeLater) === "SeesTakenBack" && photoSenderViewFor("Declined", wasReady, true, noticeLater) === "SeesTakenBack";
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawATakenBackPhotoListsAsTakenBack(seen: PhotoSenderView): boolean {
  //@ ensures \result === true
  return photoListedAs(seen, true) === "SeesTakenBack";
}

/** Story: Send my photo to my match / The sender learns only sent, not taken, not approved or timed out (spec/photoRelayItem.md) */
//@ pure
export function lawTakenBackIsNotTakenBackAgain(wasReady: boolean, noticeLater: boolean): boolean {
  //@ ensures \result === true
  return photoTakeBackFor("Revoked", wasReady, true, noticeLater) === "TakeBackNothing";
}

/** Story: Send my photo to my match / A photo link only serves its own page (spec/photoRelayItem.md) */
//@ pure
export function photoPagePurposeMatches(requestedPurpose: string, storedPurpose: string): boolean {
  return requestedPurpose === storedPurpose && (storedPurpose === "check" || storedPurpose === "mine" || storedPurpose === "view");
}

/** Story: Send my photo to my match / A photo link only serves its own page (spec/photoRelayItem.md) */
//@ pure
export function lawWrongPhotoPagePurposeIsRefused(requestedPurpose: string, storedPurpose: string): boolean {
  //@ ensures \result === true
  return !(requestedPurpose !== storedPurpose || (storedPurpose !== "check" && storedPurpose !== "mine" && storedPurpose !== "view")) || !photoPagePurposeMatches(requestedPurpose, storedPurpose);
}

/** Story: Send my photo to my match / The check page serves only photos from its proposal (spec/photoRelayItem.md) */
//@ pure
export function photoCheckSetMatches(proposalSetHash: string, currentSetHash: string): boolean {
  return proposalSetHash === currentSetHash;
}

/** Story: Send my photo to my match / The check page serves only photos from its proposal (spec/photoRelayItem.md) */
//@ pure
export function lawChangedPhotoSetCannotSupplyCheckImage(proposalSetHash: string, currentSetHash: string): boolean {
  //@ ensures \result === true
  return !(proposalSetHash !== currentSetHash) || !photoCheckSetMatches(proposalSetHash, currentSetHash);
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function photoPageLinkLive(issuedAt: number, at: number, deviceBound: boolean, sameDevice: boolean, sameRevision: boolean): boolean {
  return sameRevision && at >= issuedAt && exact_photoRelayItem(at - issuedAt) < photoPageLinkTtlMs && (!deviceBound || sameDevice);
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function photoViewAllowed(phase: OfferPhase, deviceBound: boolean, sameDevice: boolean, itemsCurrent: boolean): boolean {
  return itemsCurrent && phase === "Ready" && (!deviceBound || sameDevice);
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function photoViewLinkRenewable(phase: OfferPhase, isReceiver: boolean, itemsCurrent: boolean): boolean {
  return isReceiver && itemsCurrent && phase === "Ready";
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function lawStaleLinkIsNotLive(issuedAt: number, deviceBound: boolean, sameDevice: boolean, sameRevision: boolean): boolean {
  //@ ensures \result === true
  return !photoPageLinkLive(issuedAt, exact_photoRelayItem(issuedAt + photoPageLinkTtlMs), deviceBound, sameDevice, sameRevision);
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function lawViewNeedsTheBoundBrowser(phase: OfferPhase, itemsCurrent: boolean): boolean {
  //@ ensures \result === true
  return !photoViewAllowed(phase, true, false, itemsCurrent);
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function lawNoViewAfterTheOfferEnds(phase: OfferPhase, deviceBound: boolean, sameDevice: boolean, itemsCurrent: boolean): boolean {
  //@ ensures \result === true
  return !(phase !== "Ready") || !photoViewAllowed(phase, deviceBound, sameDevice, itemsCurrent);
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function lawNoViewWhenNotCurrent(phase: OfferPhase, deviceBound: boolean, sameDevice: boolean): boolean {
  //@ ensures \result === true
  return !photoViewAllowed(phase, deviceBound, sameDevice, false);
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function lawNoClockEndsAView(deviceBound: boolean): boolean {
  //@ ensures \result === true
  return photoViewAllowed("Ready", deviceBound, true, true);
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function lawOnlyTheReceiverRenewsTheLink(phase: OfferPhase, itemsCurrent: boolean): boolean {
  //@ ensures \result === true
  return !photoViewLinkRenewable(phase, false, itemsCurrent);
}

/** Story: Send my photo to my match / A page opens only from its own fresh link, and a view only for the receiver's bound browser until the photo is taken back (spec/photoRelayItem.md) */
//@ pure
export function lawNoNewLinkAfterTheOfferEnds(phase: OfferPhase, isReceiver: boolean, itemsCurrent: boolean): boolean {
  //@ ensures \result === true
  return !(phase !== "Ready") || !photoViewLinkRenewable(phase, isReceiver, itemsCurrent);
}

/** Story: Send my photo to my match / Only a yes or no to the newest ask answers it (spec/photoRelayItem.md) */
//@ pure
export function photoAskAnswerFor(promptIsNewest: boolean, asking: boolean, yes: boolean, no: boolean, noMore: boolean): AskAnswer {
  return noMore ? "ReceiverDeclinesAll" : (!promptIsNewest || !asking ? "NotForTheAsk" : (no ? "ReceiverDeclines" : (yes ? "ReceiverTakes" : "NotForTheAsk")));
}

/** Story: Send my photo to my match / Only a yes or no to the newest ask answers it (spec/photoRelayItem.md) */
//@ pure
export function lawOnlyAYesToTheNewestAskTakes(promptIsNewest: boolean, asking: boolean, yes: boolean, no: boolean, noMore: boolean): boolean {
  //@ ensures \result === true
  return !(photoAskAnswerFor(promptIsNewest, asking, yes, no, noMore) === "ReceiverTakes") || (promptIsNewest && asking && yes && !no && !noMore);
}

/** Story: Send my photo to my match / Only a yes or no to the newest ask answers it (spec/photoRelayItem.md) */
//@ pure
export function lawNoMorePhotosDeclinesEveryAsk(promptIsNewest: boolean, asking: boolean, yes: boolean, no: boolean): boolean {
  //@ ensures \result === true
  return photoAskAnswerFor(promptIsNewest, asking, yes, no, true) === "ReceiverDeclinesAll";
}

/** Story: Send my photo to my match / A take-back revokes the member's open photo items for the match (spec/photoRelayItem.md) */
//@ pure
export function photoItemWithdrawable(ownItem: boolean, sameMatch: boolean, open: boolean): boolean {
  return ownItem && sameMatch && open;
}

/** Story: Send my photo to my match / A take-back revokes the member's open photo items for the match (spec/photoRelayItem.md) */
//@ pure
export function lawOnlyOwnItemsAreWithdrawn(sameMatch: boolean, open: boolean): boolean {
  //@ ensures \result === true
  return !photoItemWithdrawable(false, sameMatch, open);
}

/** Story: Send my photo to my match / A take-back revokes the member's open photo items for the match (spec/photoRelayItem.md) */
//@ pure
export function lawOnlyThisMatchIsWithdrawn(ownItem: boolean, open: boolean): boolean {
  //@ ensures \result === true
  return !photoItemWithdrawable(ownItem, false, open);
}

/** Story: Send my photo to my match / The photo page takes back exactly one listed share (spec/photoRelayItem.md) */
//@ pure
export function photoMineShareMatches(requestedShare: string, listedShare: string, ownsPhoto: boolean, currentMatch: boolean): boolean {
  return requestedShare === listedShare && ownsPhoto && currentMatch;
}

/** Story: Send my photo to my match / The photo page takes back exactly one listed share (spec/photoRelayItem.md) */
//@ pure
export function lawUnlistedPhotoShareCannotBeTakenBack(requestedShare: string, listedShare: string, ownsPhoto: boolean, currentMatch: boolean): boolean {
  //@ ensures \result === true
  return !(requestedShare !== listedShare || !ownsPhoto || !currentMatch) || !photoMineShareMatches(requestedShare, listedShare, ownsPhoto, currentMatch);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoOffer, event: Event): boolean {
  if (event.type === "askReceiver") return canAskReceiver(current);
  if (event.type === "answerYes") return canAnswerYes(current, event.at);
  if (event.type === "answerNo") return canAnswerNo(current);
  if (event.type === "lapseAnswer") return canLapseAnswer(current, event.at);
  if (event.type === "settleReview") return canSettleReview(current, event.approved, event.rejected, event.timedOut, event.total);
  if (event.type === "revokeOffer") return canRevokeOffer(current, event.ownerMatches);
  if (event.type === "endOffer") return canEndOffer(current);
  if (event.type === "reportOffer") return canReportOffer(current, event.byReceiver);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoOffer, event: Event): PhotoOffer {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "askReceiver") return canAskReceiver(current) ? askReceiver(current, event.at) : current;
  if (event.type === "answerYes") return canAnswerYes(current, event.at) ? answerYes(current, event.at) : current;
  if (event.type === "answerNo") return canAnswerNo(current) ? answerNo(current) : current;
  if (event.type === "lapseAnswer") return canLapseAnswer(current, event.at) ? lapseAnswer(current, event.at) : current;
  if (event.type === "settleReview") return canSettleReview(current, event.approved, event.rejected, event.timedOut, event.total) ? settleReview(current, event.approved, event.rejected, event.timedOut, event.total) : current;
  if (event.type === "revokeOffer") return canRevokeOffer(current, event.ownerMatches) ? revokeOffer(current, event.ownerMatches) : current;
  if (event.type === "endOffer") return canEndOffer(current) ? endOffer(current) : current;
  if (event.type === "reportOffer") return canReportOffer(current, event.byReceiver) ? reportOffer(current, event.byReceiver) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "askReceiver" && Number.isSafeInteger(raw.at)) return { type: "askReceiver", at: raw.at };
  if (raw.type === "answerYes" && Number.isSafeInteger(raw.at)) return { type: "answerYes", at: raw.at };
  if (raw.type === "answerNo") return { type: "answerNo" };
  if (raw.type === "lapseAnswer" && Number.isSafeInteger(raw.at)) return { type: "lapseAnswer", at: raw.at };
  if (raw.type === "settleReview" && Number.isSafeInteger(raw.approved) && Number.isSafeInteger(raw.rejected) && Number.isSafeInteger(raw.timedOut) && Number.isSafeInteger(raw.total)) return { type: "settleReview", approved: raw.approved, rejected: raw.rejected, timedOut: raw.timedOut, total: raw.total };
  if (raw.type === "revokeOffer" && typeof raw.ownerMatches === "boolean") return { type: "revokeOffer", ownerMatches: raw.ownerMatches };
  if (raw.type === "endOffer") return { type: "endOffer" };
  if (raw.type === "reportOffer" && typeof raw.byReceiver === "boolean") return { type: "reportOffer", byReceiver: raw.byReceiver };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhotoOffer | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Asking" || raw.phase === "Reviewing" || raw.phase === "Ready" || raw.phase === "Declined" || raw.phase === "Lapsed" || raw.phase === "Rejected" || raw.phase === "CheckTimedOut" || raw.phase === "Revoked" || raw.phase === "Ended" || raw.phase === "Reported") && Number.isSafeInteger(raw.answerBy) && Object.keys(raw).length === 2)) return undefined;
  const parsed: PhotoOffer = ({ phase: raw.phase, answerBy: raw.answerBy });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoOffer {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_photoRelayItem(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_photoRelayItem(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_photoRelayItem((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_photoRelayItem(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}

/** The remainder of that division; it has the sign of the dividend. */
//@ pure
export function remainder_photoRelayItem(a: number, b: number): number {
  //@ requires b !== 0
  return a - b * quotient_photoRelayItem(a, b);
}
