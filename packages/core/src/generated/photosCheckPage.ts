// GENERATED from spec/photosCheckPage.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
export type ProposalScreen = "ProposalOpening" | "ProposalBadLink" | "ProposalOpenFailed" | "ProposalShown" | "ProposalPicking" | "ProposalSent" | "ProposalClosed" | "ProposalLapsed" | "ProposalChanged" | "ProposalRefused" | "ProposalOtherDevice";
/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
export type ProposalPending = "ProposalIdle" | "ProposalLoading" | "ProposalSending" | "ProposalChoosing";
/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
export type ProposalError = "ProposalNoError" | "ProposalPickCount" | "ProposalUnreachable" | "ProposalRequestFailed";
/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
export interface PhotoCheck { screen: ProposalScreen; pending: ProposalPending; error: ProposalError; linkOpen: boolean; photoCount: number; proposedCount: number; picked: number; seen: boolean }
/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
export type CheckOpenAnswerKind = "CheckOpenShown" | "CheckOpenGone" | "CheckOpenExpired" | "CheckOpenOtherDevice" | "CheckOpenInvalid" | "CheckOpenUnreachable";
/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
export interface CheckOpenAnswer { kind: CheckOpenAnswerKind; photoCount: number; proposedCount: number }
/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
export type CheckAnswerKind = "CheckOffered" | "CheckProposed" | "CheckChanged" | "CheckLapsed" | "CheckRefused" | "CheckClosed" | "CheckOtherDevice" | "CheckInvalid" | "CheckUnreachable";
/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
export interface CheckAnswer { kind: CheckAnswerKind; proposedCount: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "readCheckLink"; tokenWellFormed: boolean }
  | { type: "answerOpen"; opened: CheckOpenAnswer }
  | { type: "retryOpen" }
  | { type: "seeProposal"; loaded: boolean }
  | { type: "sendProposal" }
  | { type: "showOthers" }
  | { type: "pickPhotos"; picked: number }
  | { type: "choosePicked" }
  | { type: "answerCheck"; answer: CheckAnswer };

/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
export const initial: PhotoCheck = { screen: "ProposalOpening", pending: "ProposalIdle", error: "ProposalNoError", linkOpen: false, photoCount: 0, proposedCount: 0, picked: 0, seen: false };
/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
export const checkSlotsMax: number = 6;
/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
export const checkSetMax: number = 3;

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoCheck): boolean {
  return alwaysEndedScreensCloseTheLink(current) && alwaysLoadingOnlyWhileOpening(current) && alwaysShownHoldsOneToThree(current) && alwaysPhotosOnlyOnTheStep(current) && alwaysSeenOnlyOnTheProposal(current) && alwaysSendingNeedsASeenProposal(current) && alwaysChoosingNeedsAFittingPick(current) && alwaysPickedWithinThePhotos(current) && alwaysSendOnlyOnAnOpenLink(current);
}

/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
//@ pure
export function proposalEnded(screen: ProposalScreen): boolean {
  return screen === "ProposalBadLink" || screen === "ProposalSent" || screen === "ProposalClosed" || screen === "ProposalLapsed" || screen === "ProposalChanged" || screen === "ProposalRefused" || screen === "ProposalOtherDevice";
}

/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
//@ pure
export function canReadCheckLink(page: PhotoCheck): boolean {
  return page.screen === "ProposalOpening" && page.pending === "ProposalIdle" && !page.linkOpen;
}

/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
//@ pure
export function readCheckLink(page: PhotoCheck, tokenWellFormed: boolean): PhotoCheck {
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> alwaysEndedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> alwaysLoadingOnlyWhileOpening(\result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> alwaysShownHoldsOneToThree(\result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> alwaysPhotosOnlyOnTheStep(\result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> alwaysSeenOnlyOnTheProposal(\result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> alwaysSendingNeedsASeenProposal(\result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> alwaysChoosingNeedsAFittingPick(\result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> alwaysPickedWithinThePhotos(\result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> alwaysSendOnlyOnAnOpenLink(\result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> stepOnlyTheSendTapSends(page, "readCheckLink", \result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> stepANewProposalIsSeenAgain(page, \result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> stepOneRequestAtATime(page, \result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> stepSentOnlyAfterTheSendTap(page, "readCheckLink", \result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> stepEndedStepNeverChanges(page, \result)
  //@ ensures (inv(page) && canReadCheckLink(page)) ==> stepLinkNeverReopens(page, \result)
  return tokenWellFormed ? ({ ...page, pending: "ProposalLoading", linkOpen: true } as PhotoCheck) : ({ ...page, screen: "ProposalBadLink", linkOpen: false } as PhotoCheck);
}

/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
//@ pure
export function alwaysEndedScreensCloseTheLink(page: PhotoCheck): boolean {
  return !proposalEnded(page.screen) || !page.linkOpen;
}

/** Story: Check my photo before it goes to my match / The page reads the token from the fragment once and opens the link only for a well-formed token (spec/photosCheckPage.md) */
//@ pure
export function alwaysLoadingOnlyWhileOpening(page: PhotoCheck): boolean {
  return !(page.pending === "ProposalLoading") || (page.screen === "ProposalOpening" && page.linkOpen);
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function photosFit(photoCount: number): boolean {
  return photoCount >= 1 && photoCount <= checkSlotsMax;
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function proposalFits(photoCount: number, proposedCount: number): boolean {
  return photosFit(photoCount) && proposedCount >= 1 && proposedCount <= checkSetMax && proposedCount <= photoCount;
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function screenForOpen(kind: CheckOpenAnswerKind, photoCount: number, proposedCount: number): ProposalScreen {
  return kind === "CheckOpenShown" ? (proposalFits(photoCount, proposedCount) ? "ProposalShown" : (photosFit(photoCount) && proposedCount === 0 ? "ProposalPicking" : "ProposalOpenFailed")) : (kind === "CheckOpenGone" ? "ProposalClosed" : (kind === "CheckOpenExpired" ? "ProposalLapsed" : (kind === "CheckOpenOtherDevice" ? "ProposalOtherDevice" : "ProposalOpenFailed")));
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function openErrorFor(kind: CheckOpenAnswerKind, photoCount: number, proposedCount: number): ProposalError {
  return screenForOpen(kind, photoCount, proposedCount) !== "ProposalOpenFailed" ? "ProposalNoError" : (kind === "CheckOpenUnreachable" ? "ProposalUnreachable" : "ProposalRequestFailed");
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function canAnswerOpen(page: PhotoCheck): boolean {
  return page.pending === "ProposalLoading";
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function answerOpen(page: PhotoCheck, opened: CheckOpenAnswer): PhotoCheck {
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysEndedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysLoadingOnlyWhileOpening(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysShownHoldsOneToThree(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysPhotosOnlyOnTheStep(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysSeenOnlyOnTheProposal(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysSendingNeedsASeenProposal(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysChoosingNeedsAFittingPick(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysPickedWithinThePhotos(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysSendOnlyOnAnOpenLink(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepOnlyTheSendTapSends(page, "answerOpen", \result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepANewProposalIsSeenAgain(page, \result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepOneRequestAtATime(page, \result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepSentOnlyAfterTheSendTap(page, "answerOpen", \result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepEndedStepNeverChanges(page, \result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepLinkNeverReopens(page, \result)
  const local_0: ProposalScreen = screenForOpen(opened.kind, opened.photoCount, opened.proposedCount);
  const local_1 = local_0 === "ProposalShown" || local_0 === "ProposalPicking";
  return { ...page, screen: local_0, pending: "ProposalIdle", error: openErrorFor(opened.kind, opened.photoCount, opened.proposedCount), linkOpen: !proposalEnded(local_0), photoCount: local_1 ? opened.photoCount : 0, proposedCount: local_0 === "ProposalShown" ? opened.proposedCount : 0, picked: 0, seen: false };
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function canRetryOpen(page: PhotoCheck): boolean {
  return page.screen === "ProposalOpenFailed" && page.pending === "ProposalIdle" && page.linkOpen;
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function retryOpen(page: PhotoCheck): PhotoCheck {
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysEndedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysLoadingOnlyWhileOpening(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysShownHoldsOneToThree(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysPhotosOnlyOnTheStep(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysSeenOnlyOnTheProposal(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysSendingNeedsASeenProposal(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysChoosingNeedsAFittingPick(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysPickedWithinThePhotos(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysSendOnlyOnAnOpenLink(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepOnlyTheSendTapSends(page, "retryOpen", \result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepANewProposalIsSeenAgain(page, \result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepOneRequestAtATime(page, \result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepSentOnlyAfterTheSendTap(page, "retryOpen", \result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepEndedStepNeverChanges(page, \result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepLinkNeverReopens(page, \result)
  return { ...page, screen: "ProposalOpening", pending: "ProposalLoading", error: "ProposalNoError" };
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function lawEmptyProposalOpensThePicker(photoCount: number): boolean {
  //@ ensures \result === true
  return !photosFit(photoCount) || screenForOpen("CheckOpenShown", photoCount, 0) === "ProposalPicking";
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function lawProposalNeverAboveThree(photoCount: number, proposedCount: number): boolean {
  //@ ensures \result === true
  return !(screenForOpen("CheckOpenShown", photoCount, proposedCount) === "ProposalShown") || (proposedCount >= 1 && proposedCount <= checkSetMax && proposedCount <= photoCount);
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function lawOnlyAShownAnswerShowsPhotos(kind: CheckOpenAnswerKind, photoCount: number, proposedCount: number): boolean {
  //@ ensures \result === true
  return !(screenForOpen(kind, photoCount, proposedCount) === "ProposalShown" || screenForOpen(kind, photoCount, proposedCount) === "ProposalPicking") || kind === "CheckOpenShown";
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function lawOpenFailureShowsAnError(kind: CheckOpenAnswerKind, photoCount: number, proposedCount: number): boolean {
  //@ ensures \result === true
  return (screenForOpen(kind, photoCount, proposedCount) === "ProposalOpenFailed") === (openErrorFor(kind, photoCount, proposedCount) !== "ProposalNoError");
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function alwaysShownHoldsOneToThree(page: PhotoCheck): boolean {
  return !(page.screen === "ProposalShown") || proposalFits(page.photoCount, page.proposedCount);
}

/** Story: Check my photo before it goes to my match / The open answer shows the proposal, the photos to choose from, or why the link does not work (spec/photosCheckPage.md) */
//@ pure
export function alwaysPhotosOnlyOnTheStep(page: PhotoCheck): boolean {
  return !(page.photoCount > 0) || (page.screen === "ProposalShown" || page.screen === "ProposalPicking");
}

/** Story: Check my photo before it goes to my match / The page sends only the proposal that the person saw, and only when the person taps "Send" (spec/photosCheckPage.md) */
//@ pure
export function canSeeProposal(page: PhotoCheck): boolean {
  return page.screen === "ProposalShown" && page.pending === "ProposalIdle";
}

/** Story: Check my photo before it goes to my match / The page sends only the proposal that the person saw, and only when the person taps "Send" (spec/photosCheckPage.md) */
//@ pure
export function seeProposal(page: PhotoCheck, loaded: boolean): PhotoCheck {
  //@ ensures (inv(page) && canSeeProposal(page)) ==> alwaysEndedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> alwaysLoadingOnlyWhileOpening(\result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> alwaysShownHoldsOneToThree(\result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> alwaysPhotosOnlyOnTheStep(\result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> alwaysSeenOnlyOnTheProposal(\result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> alwaysSendingNeedsASeenProposal(\result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> alwaysChoosingNeedsAFittingPick(\result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> alwaysPickedWithinThePhotos(\result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> alwaysSendOnlyOnAnOpenLink(\result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> stepOnlyTheSendTapSends(page, "seeProposal", \result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> stepANewProposalIsSeenAgain(page, \result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> stepOneRequestAtATime(page, \result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> stepSentOnlyAfterTheSendTap(page, "seeProposal", \result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> stepEndedStepNeverChanges(page, \result)
  //@ ensures (inv(page) && canSeeProposal(page)) ==> stepLinkNeverReopens(page, \result)
  return { ...page, seen: loaded };
}

/** Story: Check my photo before it goes to my match / The page sends only the proposal that the person saw, and only when the person taps "Send" (spec/photosCheckPage.md) */
//@ pure
export function canSendProposal(page: PhotoCheck): boolean {
  return page.screen === "ProposalShown" && page.pending === "ProposalIdle" && page.linkOpen && page.seen && proposalFits(page.photoCount, page.proposedCount);
}

/** Story: Check my photo before it goes to my match / The page sends only the proposal that the person saw, and only when the person taps "Send" (spec/photosCheckPage.md) */
//@ pure
export function sendProposal(page: PhotoCheck): PhotoCheck {
  //@ ensures (inv(page) && canSendProposal(page)) ==> alwaysEndedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> alwaysLoadingOnlyWhileOpening(\result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> alwaysShownHoldsOneToThree(\result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> alwaysPhotosOnlyOnTheStep(\result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> alwaysSeenOnlyOnTheProposal(\result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> alwaysSendingNeedsASeenProposal(\result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> alwaysChoosingNeedsAFittingPick(\result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> alwaysPickedWithinThePhotos(\result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> alwaysSendOnlyOnAnOpenLink(\result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> stepOnlyTheSendTapSends(page, "sendProposal", \result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> stepANewProposalIsSeenAgain(page, \result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> stepOneRequestAtATime(page, \result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> stepSentOnlyAfterTheSendTap(page, "sendProposal", \result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> stepEndedStepNeverChanges(page, \result)
  //@ ensures (inv(page) && canSendProposal(page)) ==> stepLinkNeverReopens(page, \result)
  return { ...page, pending: "ProposalSending", error: "ProposalNoError" };
}

/** Story: Check my photo before it goes to my match / The page sends only the proposal that the person saw, and only when the person taps "Send" (spec/photosCheckPage.md) */
//@ pure
export function alwaysSeenOnlyOnTheProposal(page: PhotoCheck): boolean {
  return !page.seen || page.screen === "ProposalShown";
}

/** Story: Check my photo before it goes to my match / The page sends only the proposal that the person saw, and only when the person taps "Send" (spec/photosCheckPage.md) */
//@ pure
export function alwaysSendingNeedsASeenProposal(page: PhotoCheck): boolean {
  return !(page.pending === "ProposalSending") || (page.screen === "ProposalShown" && page.seen && page.linkOpen && proposalFits(page.photoCount, page.proposedCount));
}

/** Story: Check my photo before it goes to my match / The page sends only the proposal that the person saw, and only when the person taps "Send" (spec/photosCheckPage.md) */
//@ pure
export function stepOnlyTheSendTapSends(before: PhotoCheck, via: string, after: PhotoCheck): boolean {
  return !(after.pending === "ProposalSending" && before.pending !== "ProposalSending") || (via === "sendProposal" && before.seen);
}

/** Story: Check my photo before it goes to my match / The page sends only the proposal that the person saw, and only when the person taps "Send" (spec/photosCheckPage.md) */
//@ pure
export function stepANewProposalIsSeenAgain(before: PhotoCheck, after: PhotoCheck): boolean {
  return !(after.screen === "ProposalShown" && before.screen !== "ProposalShown") || !after.seen;
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function pickFits(photoCount: number, picked: number): boolean {
  return picked >= 1 && picked <= checkSetMax && picked <= photoCount;
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function canShowOthers(page: PhotoCheck): boolean {
  return page.screen === "ProposalShown" && page.pending === "ProposalIdle";
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function showOthers(page: PhotoCheck): PhotoCheck {
  //@ ensures (inv(page) && canShowOthers(page)) ==> alwaysEndedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> alwaysLoadingOnlyWhileOpening(\result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> alwaysShownHoldsOneToThree(\result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> alwaysPhotosOnlyOnTheStep(\result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> alwaysSeenOnlyOnTheProposal(\result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> alwaysSendingNeedsASeenProposal(\result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> alwaysChoosingNeedsAFittingPick(\result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> alwaysPickedWithinThePhotos(\result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> alwaysSendOnlyOnAnOpenLink(\result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> stepOnlyTheSendTapSends(page, "showOthers", \result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> stepANewProposalIsSeenAgain(page, \result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> stepOneRequestAtATime(page, \result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> stepSentOnlyAfterTheSendTap(page, "showOthers", \result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> stepEndedStepNeverChanges(page, \result)
  //@ ensures (inv(page) && canShowOthers(page)) ==> stepLinkNeverReopens(page, \result)
  return { ...page, screen: "ProposalPicking", picked: 0, seen: false, error: "ProposalNoError" };
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function canPickPhotos(page: PhotoCheck, picked: number): boolean {
  return page.screen === "ProposalPicking" && page.pending === "ProposalIdle" && picked >= 0 && picked <= page.photoCount;
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function pickPhotos(page: PhotoCheck, picked: number): PhotoCheck {
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> alwaysEndedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> alwaysLoadingOnlyWhileOpening(\result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> alwaysShownHoldsOneToThree(\result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> alwaysPhotosOnlyOnTheStep(\result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> alwaysSeenOnlyOnTheProposal(\result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> alwaysSendingNeedsASeenProposal(\result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> alwaysChoosingNeedsAFittingPick(\result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> alwaysPickedWithinThePhotos(\result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> alwaysSendOnlyOnAnOpenLink(\result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> stepOnlyTheSendTapSends(page, "pickPhotos", \result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> stepANewProposalIsSeenAgain(page, \result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> stepOneRequestAtATime(page, \result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> stepSentOnlyAfterTheSendTap(page, "pickPhotos", \result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> stepEndedStepNeverChanges(page, \result)
  //@ ensures (inv(page) && canPickPhotos(page, picked)) ==> stepLinkNeverReopens(page, \result)
  return { ...page, picked: picked, error: picked > checkSetMax ? "ProposalPickCount" : "ProposalNoError" };
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function canChoosePicked(page: PhotoCheck): boolean {
  return page.screen === "ProposalPicking" && page.pending === "ProposalIdle" && page.linkOpen;
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function choosePicked(page: PhotoCheck): PhotoCheck {
  //@ ensures (inv(page) && canChoosePicked(page)) ==> alwaysEndedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> alwaysLoadingOnlyWhileOpening(\result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> alwaysShownHoldsOneToThree(\result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> alwaysPhotosOnlyOnTheStep(\result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> alwaysSeenOnlyOnTheProposal(\result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> alwaysSendingNeedsASeenProposal(\result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> alwaysChoosingNeedsAFittingPick(\result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> alwaysPickedWithinThePhotos(\result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> alwaysSendOnlyOnAnOpenLink(\result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> stepOnlyTheSendTapSends(page, "choosePicked", \result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> stepANewProposalIsSeenAgain(page, \result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> stepOneRequestAtATime(page, \result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> stepSentOnlyAfterTheSendTap(page, "choosePicked", \result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> stepEndedStepNeverChanges(page, \result)
  //@ ensures (inv(page) && canChoosePicked(page)) ==> stepLinkNeverReopens(page, \result)
  return pickFits(page.photoCount, page.picked) ? ({ ...page, pending: "ProposalChoosing", error: "ProposalNoError" } as PhotoCheck) : ({ ...page, error: "ProposalPickCount" } as PhotoCheck);
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function lawPickOutsideOneToThreeIsNeverSent(photoCount: number, picked: number): boolean {
  //@ ensures \result === true
  return !(picked < 1 || picked > checkSetMax) || !pickFits(photoCount, picked);
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function alwaysChoosingNeedsAFittingPick(page: PhotoCheck): boolean {
  return !(page.pending === "ProposalChoosing") || (page.screen === "ProposalPicking" && pickFits(page.photoCount, page.picked) && page.linkOpen);
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function alwaysPickedWithinThePhotos(page: PhotoCheck): boolean {
  return page.picked >= 0 && page.picked <= page.photoCount;
}

/** Story: Check my photo before it goes to my match / "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send (spec/photosCheckPage.md) */
//@ pure
export function stepOneRequestAtATime(before: PhotoCheck, after: PhotoCheck): boolean {
  return !(after.pending !== "ProposalIdle" && after.pending !== before.pending) || before.pending === "ProposalIdle";
}

/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
//@ pure
export function endedScreenFor(answerKind: CheckAnswerKind): ProposalScreen {
  return answerKind === "CheckChanged" ? "ProposalChanged" : (answerKind === "CheckLapsed" ? "ProposalLapsed" : (answerKind === "CheckRefused" ? "ProposalRefused" : (answerKind === "CheckClosed" ? "ProposalClosed" : (answerKind === "CheckOtherDevice" ? "ProposalOtherDevice" : "ProposalOpening"))));
}

/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
//@ pure
export function answerEndsTheStep(answerKind: CheckAnswerKind): boolean {
  return endedScreenFor(answerKind) !== "ProposalOpening";
}

/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
//@ pure
export function canAnswerCheck(page: PhotoCheck): boolean {
  return page.pending === "ProposalSending" || page.pending === "ProposalChoosing";
}

/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
//@ pure
export function answerCheck(page: PhotoCheck, answer: CheckAnswer): PhotoCheck {
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> alwaysEndedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> alwaysLoadingOnlyWhileOpening(\result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> alwaysShownHoldsOneToThree(\result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> alwaysPhotosOnlyOnTheStep(\result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> alwaysSeenOnlyOnTheProposal(\result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> alwaysSendingNeedsASeenProposal(\result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> alwaysChoosingNeedsAFittingPick(\result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> alwaysPickedWithinThePhotos(\result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> alwaysSendOnlyOnAnOpenLink(\result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> stepOnlyTheSendTapSends(page, "answerCheck", \result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> stepANewProposalIsSeenAgain(page, \result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> stepOneRequestAtATime(page, \result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> stepSentOnlyAfterTheSendTap(page, "answerCheck", \result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> stepEndedStepNeverChanges(page, \result)
  //@ ensures (inv(page) && canAnswerCheck(page)) ==> stepLinkNeverReopens(page, \result)
  const local_2: PhotoCheck = { ...page, pending: "ProposalIdle" };
  const local_3: PhotoCheck = { ...local_2, linkOpen: false, photoCount: 0, proposedCount: 0, picked: 0, seen: false, error: "ProposalNoError" };
  return answer.kind === "CheckOffered" && page.pending === "ProposalSending" ? ({ ...local_3, screen: "ProposalSent" } as PhotoCheck) : (answer.kind === "CheckProposed" && proposalFits(page.photoCount, answer.proposedCount) ? ({ ...local_2, screen: "ProposalShown", proposedCount: answer.proposedCount, picked: 0, seen: false, error: "ProposalNoError" } as PhotoCheck) : (answerEndsTheStep(answer.kind) ? ({ ...local_3, screen: endedScreenFor(answer.kind) } as PhotoCheck) : (answer.kind === "CheckUnreachable" ? ({ ...local_2, error: "ProposalUnreachable" } as PhotoCheck) : ({ ...local_2, error: "ProposalRequestFailed" } as PhotoCheck))));
}

/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
//@ pure
export function lawEveryEndingAnswerIsAnEndedScreen(answerKind: CheckAnswerKind): boolean {
  //@ ensures \result === true
  return !answerEndsTheStep(answerKind) || proposalEnded(endedScreenFor(answerKind));
}

/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
//@ pure
export function lawRetryAnswersKeepTheStep(answerKind: CheckAnswerKind): boolean {
  //@ ensures \result === true
  return !(answerKind === "CheckUnreachable" || answerKind === "CheckInvalid") || !answerEndsTheStep(answerKind);
}

/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
//@ pure
export function stepSentOnlyAfterTheSendTap(before: PhotoCheck, via: string, after: PhotoCheck): boolean {
  return !(after.screen === "ProposalSent" && before.screen !== "ProposalSent") || (via === "answerCheck" && before.pending === "ProposalSending" && before.seen);
}

/** Story: Check my photo before it goes to my match / The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed (spec/photosCheckPage.md) */
//@ pure
export function stepEndedStepNeverChanges(before: PhotoCheck, after: PhotoCheck): boolean {
  return !proposalEnded(before.screen) || equal_photosCheckPage(after, before);
}

/** Story: A closed proposal sends nothing / An ended step never opens again (spec/photosCheckPage.md) */
//@ pure
export function photoCheckOffersSend(page: PhotoCheck): boolean {
  return canSendProposal(page);
}

/** Story: A closed proposal sends nothing / An ended step never opens again (spec/photosCheckPage.md) */
//@ pure
export function alwaysSendOnlyOnAnOpenLink(page: PhotoCheck): boolean {
  return !photoCheckOffersSend(page) || page.linkOpen;
}

/** Story: A closed proposal sends nothing / An ended step never opens again (spec/photosCheckPage.md) */
//@ pure
export function stepLinkNeverReopens(before: PhotoCheck, after: PhotoCheck): boolean {
  return !(!before.linkOpen && before.screen !== "ProposalOpening") || !after.linkOpen;
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesWaitingForThePhotos(page: PhotoCheck): boolean {
  return page.screen === "ProposalShown" && !page.seen;
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesReadyToSend(page: PhotoCheck): boolean {
  return canSendProposal(page);
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesSending(page: PhotoCheck): boolean {
  return page.pending === "ProposalSending";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesSent(page: PhotoCheck): boolean {
  return page.screen === "ProposalSent";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesPicking(page: PhotoCheck): boolean {
  return page.screen === "ProposalPicking" && page.picked >= 1;
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesChoosing(page: PhotoCheck): boolean {
  return page.pending === "ProposalChoosing";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesPickCount(page: PhotoCheck): boolean {
  return page.error === "ProposalPickCount";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesNewProposalAfterAPick(page: PhotoCheck): boolean {
  return page.screen === "ProposalShown" && page.proposedCount === 3;
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesClosed(page: PhotoCheck): boolean {
  return page.screen === "ProposalClosed";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesLapsed(page: PhotoCheck): boolean {
  return page.screen === "ProposalLapsed";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesChanged(page: PhotoCheck): boolean {
  return page.screen === "ProposalChanged";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesRefused(page: PhotoCheck): boolean {
  return page.screen === "ProposalRefused";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesOtherDevice(page: PhotoCheck): boolean {
  return page.screen === "ProposalOtherDevice";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesBadLink(page: PhotoCheck): boolean {
  return page.screen === "ProposalBadLink";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesOpenFailed(page: PhotoCheck): boolean {
  return page.screen === "ProposalOpenFailed" && page.error === "ProposalUnreachable";
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesUnreachableOnTheProposal(page: PhotoCheck): boolean {
  return page.screen === "ProposalShown" && page.error === "ProposalUnreachable" && page.seen;
}

/** Story: Reach every outcome / A person can send, choose other photos, and see each closed step and each error (spec/photosCheckPage.md) */
//@ pure
export function sometimesRequestFailed(page: PhotoCheck): boolean {
  return page.error === "ProposalRequestFailed" && page.linkOpen;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoCheck, event: Event): boolean {
  if (event.type === "readCheckLink") return canReadCheckLink(current);
  if (event.type === "answerOpen") return canAnswerOpen(current);
  if (event.type === "retryOpen") return canRetryOpen(current);
  if (event.type === "seeProposal") return canSeeProposal(current);
  if (event.type === "sendProposal") return canSendProposal(current);
  if (event.type === "showOthers") return canShowOthers(current);
  if (event.type === "pickPhotos") return canPickPhotos(current, event.picked);
  if (event.type === "choosePicked") return canChoosePicked(current);
  if (event.type === "answerCheck") return canAnswerCheck(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoCheck, event: Event): PhotoCheck {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "readCheckLink") return canReadCheckLink(current) ? readCheckLink(current, event.tokenWellFormed) : current;
  if (event.type === "answerOpen") return canAnswerOpen(current) ? answerOpen(current, event.opened) : current;
  if (event.type === "retryOpen") return canRetryOpen(current) ? retryOpen(current) : current;
  if (event.type === "seeProposal") return canSeeProposal(current) ? seeProposal(current, event.loaded) : current;
  if (event.type === "sendProposal") return canSendProposal(current) ? sendProposal(current) : current;
  if (event.type === "showOthers") return canShowOthers(current) ? showOthers(current) : current;
  if (event.type === "pickPhotos") return canPickPhotos(current, event.picked) ? pickPhotos(current, event.picked) : current;
  if (event.type === "choosePicked") return canChoosePicked(current) ? choosePicked(current) : current;
  if (event.type === "answerCheck") return canAnswerCheck(current) ? answerCheck(current, event.answer) : current;
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
  const is_CheckOpenAnswer = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && (v.kind === "CheckOpenShown" || v.kind === "CheckOpenGone" || v.kind === "CheckOpenExpired" || v.kind === "CheckOpenOtherDevice" || v.kind === "CheckOpenInvalid" || v.kind === "CheckOpenUnreachable") && Number.isSafeInteger(v.photoCount) && Number.isSafeInteger(v.proposedCount);
  const is_CheckAnswer = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && (v.kind === "CheckOffered" || v.kind === "CheckProposed" || v.kind === "CheckChanged" || v.kind === "CheckLapsed" || v.kind === "CheckRefused" || v.kind === "CheckClosed" || v.kind === "CheckOtherDevice" || v.kind === "CheckInvalid" || v.kind === "CheckUnreachable") && Number.isSafeInteger(v.proposedCount);
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "readCheckLink" && typeof raw.tokenWellFormed === "boolean") return { type: "readCheckLink", tokenWellFormed: raw.tokenWellFormed };
  if (raw.type === "answerOpen" && is_CheckOpenAnswer(raw.opened)) return { type: "answerOpen", opened: ({ kind: raw.opened.kind, photoCount: raw.opened.photoCount, proposedCount: raw.opened.proposedCount }) };
  if (raw.type === "retryOpen") return { type: "retryOpen" };
  if (raw.type === "seeProposal" && typeof raw.loaded === "boolean") return { type: "seeProposal", loaded: raw.loaded };
  if (raw.type === "sendProposal") return { type: "sendProposal" };
  if (raw.type === "showOthers") return { type: "showOthers" };
  if (raw.type === "pickPhotos" && Number.isSafeInteger(raw.picked)) return { type: "pickPhotos", picked: raw.picked };
  if (raw.type === "choosePicked") return { type: "choosePicked" };
  if (raw.type === "answerCheck" && is_CheckAnswer(raw.answer)) return { type: "answerCheck", answer: ({ kind: raw.answer.kind, proposedCount: raw.answer.proposedCount }) };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhotoCheck | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.screen === "ProposalOpening" || raw.screen === "ProposalBadLink" || raw.screen === "ProposalOpenFailed" || raw.screen === "ProposalShown" || raw.screen === "ProposalPicking" || raw.screen === "ProposalSent" || raw.screen === "ProposalClosed" || raw.screen === "ProposalLapsed" || raw.screen === "ProposalChanged" || raw.screen === "ProposalRefused" || raw.screen === "ProposalOtherDevice") && (raw.pending === "ProposalIdle" || raw.pending === "ProposalLoading" || raw.pending === "ProposalSending" || raw.pending === "ProposalChoosing") && (raw.error === "ProposalNoError" || raw.error === "ProposalPickCount" || raw.error === "ProposalUnreachable" || raw.error === "ProposalRequestFailed") && typeof raw.linkOpen === "boolean" && Number.isSafeInteger(raw.photoCount) && Number.isSafeInteger(raw.proposedCount) && Number.isSafeInteger(raw.picked) && typeof raw.seen === "boolean" && Object.keys(raw).length === 8)) return undefined;
  const parsed: PhotoCheck = ({ screen: raw.screen, pending: raw.pending, error: raw.error, linkOpen: raw.linkOpen, photoCount: raw.photoCount, proposedCount: raw.proposedCount, picked: raw.picked, seen: raw.seen });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoCheck {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_photosCheckPage(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_photosCheckPage((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
