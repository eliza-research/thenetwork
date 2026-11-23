// GENERATED from spec/photoUploadPage.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { uploadMaxBytes as photoPolicy_uploadMaxBytes, uploadMaxPerPerson as photoPolicy_uploadMaxPerPerson, ratingMaxPhotos as photoPolicy_ratingMaxPhotos, ratingMaxBytes as photoPolicy_ratingMaxBytes, photoMaxPerMessage as photoPolicy_photoMaxPerMessage, textPhotoLineAllowed as photoPolicy_textPhotoLineAllowed, photoSubjectAllowed as photoPolicy_photoSubjectAllowed, photoSlotsFull as photoPolicy_photoSlotsFull, lawDedicatedOtherLineCannotTakeSlopPhoto as photoPolicy_lawDedicatedOtherLineCannotTakeSlopPhoto, lawRatingRequiresAdult as photoPolicy_lawRatingRequiresAdult } from "./photoPolicy.ts";

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
export type PhotoLinkStatusKind = "LinkStatusOpen" | "LinkStatusClosed" | "LinkStatusUnreachable" | "LinkStatusFailed";
/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
export type PhotoPending = "PhotoIdle" | "PhotoReading" | "PhotoUploading";
/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
export type PhotoError = "PhotoNoError" | "PhotoPickCount" | "PhotoPickTooLarge" | "PhotoPickType" | "PhotoConsentNeeded" | "PhotoTooLarge" | "PhotoUnreachable" | "PhotoRequestFailed";
/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
export type PhotoScreen = "PhotoOpening" | "PhotoBadLink" | "PhotoChecking" | "PhotoPick" | "PhotoDone" | "PhotoAllRefused" | "PhotoLinkClosed";
/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
export interface PhotoUploadPage { screen: PhotoScreen; pending: PhotoPending; error: PhotoError; linkOpen: boolean; consentAsked: boolean; consentTicked: boolean; chosen: number; savedCount: number; someRefused: boolean }
/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
export interface PhotoLinkStatus { kind: PhotoLinkStatusKind; consentRequired: boolean }
/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
export interface PhotoBatch { count: number; largestBytes: number; totalBytes: number; typesOk: boolean }
/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
export type PhotoBatchCheck = "BatchOk" | "BatchCount" | "BatchTooLarge" | "BatchType";
/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
export type PhotoAnswerKind = "UploadStored" | "UploadAllRefused" | "UploadLinkClosed" | "UploadTooLarge" | "UploadCount" | "UploadConsentRequired" | "UploadInvalid" | "UploadUnreachable";
/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
export interface PhotoAnswer { kind: PhotoAnswerKind; savedCount: number; someRefused: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "openPhotoPage"; tokenWellFormed: boolean }
  | { type: "retryLinkStatus" }
  | { type: "answerLinkStatus"; linkStatus: PhotoLinkStatus }
  | { type: "choosePhotos"; batch: PhotoBatch }
  | { type: "tickConsent"; ticked: boolean }
  | { type: "uploadPhotos"; batch: PhotoBatch }
  | { type: "answerUpload"; answer: PhotoAnswer };

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
export const initial: PhotoUploadPage = { screen: "PhotoOpening", pending: "PhotoIdle", error: "PhotoNoError", linkOpen: false, consentAsked: false, consentTicked: false, chosen: 0, savedCount: 0, someRefused: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoUploadPage): boolean {
  return alwaysCheckingSendsNoPhotos(current) && alwaysClosedScreensCloseTheLink(current) && alwaysPickHasAnOpenLink(current) && alwaysTickOnlyWhenAsked(current) && alwaysConsentNeededWhileUnticked(current) && alwaysUploadOnlyWhileLinkOpen(current) && alwaysUploadBelongsToThePicker(current) && alwaysSavedOnlyWhenDone(current) && alwaysSavedNoMoreThanChosen(current) && alwaysRefusalsOnlyAfterUse(current);
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function canOpenPhotoPage(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoOpening";
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function openPhotoPage(page: PhotoUploadPage, tokenWellFormed: boolean): PhotoUploadPage {
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysCheckingSendsNoPhotos(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysClosedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysPickHasAnOpenLink(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysTickOnlyWhenAsked(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysConsentNeededWhileUnticked(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysUploadOnlyWhileLinkOpen(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysUploadBelongsToThePicker(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysSavedOnlyWhenDone(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysSavedNoMoreThanChosen(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> alwaysRefusalsOnlyAfterUse(\result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> stepConsentOnlyByThePerson(page, "openPhotoPage", \result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> stepOneUploadAtATime(page, "openPhotoPage", \result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> stepSavedOnlyFromTheAnswer(page, "openPhotoPage", \result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> stepLinkNeverReopens(page, \result)
  //@ ensures (inv(page) && canOpenPhotoPage(page)) ==> stepPickerOnlyFromAnOpenStatus(page, "openPhotoPage", \result)
  return tokenWellFormed ? ({ ...page, screen: "PhotoChecking", pending: "PhotoReading" } as PhotoUploadPage) : ({ ...page, screen: "PhotoBadLink", linkOpen: false } as PhotoUploadPage);
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function canAnswerLinkStatus(page: PhotoUploadPage): boolean {
  return page.pending === "PhotoReading";
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function canRetryLinkStatus(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoChecking" && page.pending === "PhotoIdle" && page.error !== "PhotoNoError";
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function retryLinkStatus(page: PhotoUploadPage): PhotoUploadPage {
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysCheckingSendsNoPhotos(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysClosedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysPickHasAnOpenLink(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysTickOnlyWhenAsked(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysConsentNeededWhileUnticked(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysUploadOnlyWhileLinkOpen(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysUploadBelongsToThePicker(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysSavedOnlyWhenDone(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysSavedNoMoreThanChosen(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> alwaysRefusalsOnlyAfterUse(\result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> stepConsentOnlyByThePerson(page, "retryLinkStatus", \result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> stepOneUploadAtATime(page, "retryLinkStatus", \result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> stepSavedOnlyFromTheAnswer(page, "retryLinkStatus", \result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> stepLinkNeverReopens(page, \result)
  //@ ensures (inv(page) && canRetryLinkStatus(page)) ==> stepPickerOnlyFromAnOpenStatus(page, "retryLinkStatus", \result)
  return { ...page, pending: "PhotoReading", error: "PhotoNoError" };
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function photoLinkHeld(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoChecking" || page.linkOpen;
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function alwaysCheckingSendsNoPhotos(page: PhotoUploadPage): boolean {
  return !(page.screen === "PhotoChecking") || (!page.linkOpen && page.pending !== "PhotoUploading" && page.chosen === 0);
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function alwaysClosedScreensCloseTheLink(page: PhotoUploadPage): boolean {
  return !(page.screen !== "PhotoPick") || !page.linkOpen;
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function alwaysPickHasAnOpenLink(page: PhotoUploadPage): boolean {
  return !(page.screen === "PhotoPick") || page.linkOpen;
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function answerLinkStatus(page: PhotoUploadPage, linkStatus: PhotoLinkStatus): PhotoUploadPage {
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysCheckingSendsNoPhotos(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysClosedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysPickHasAnOpenLink(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysTickOnlyWhenAsked(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysConsentNeededWhileUnticked(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysUploadOnlyWhileLinkOpen(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysUploadBelongsToThePicker(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysSavedOnlyWhenDone(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysSavedNoMoreThanChosen(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> alwaysRefusalsOnlyAfterUse(\result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> stepConsentOnlyByThePerson(page, "answerLinkStatus", \result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> stepOneUploadAtATime(page, "answerLinkStatus", \result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> stepSavedOnlyFromTheAnswer(page, "answerLinkStatus", \result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> stepLinkNeverReopens(page, \result)
  //@ ensures (inv(page) && canAnswerLinkStatus(page)) ==> stepPickerOnlyFromAnOpenStatus(page, "answerLinkStatus", \result)
  const local_0: PhotoUploadPage = { ...page, pending: "PhotoIdle" };
  return linkStatus.kind === "LinkStatusOpen" ? ({ ...local_0, screen: "PhotoPick", linkOpen: true, consentAsked: linkStatus.consentRequired, error: "PhotoNoError" } as PhotoUploadPage) : (linkStatus.kind === "LinkStatusClosed" ? ({ ...local_0, screen: "PhotoLinkClosed", linkOpen: false, error: "PhotoNoError" } as PhotoUploadPage) : (linkStatus.kind === "LinkStatusUnreachable" ? ({ ...local_0, error: "PhotoUnreachable" } as PhotoUploadPage) : ({ ...local_0, error: "PhotoRequestFailed" } as PhotoUploadPage)));
}

/** Story: Add my photos from the link in my conversation / The page reads the token from the fragment once and opens the picker only for a well-formed token (spec/photoUploadPage.md) */
//@ pure
export function lawOnlyAnOpenStatusOpensThePicker(page: PhotoUploadPage, linkStatus: PhotoLinkStatus): boolean {
  //@ ensures \result === true
  return !(canAnswerLinkStatus(page) && answerLinkStatus(page, linkStatus).screen === "PhotoPick") || linkStatus.kind === "LinkStatusOpen";
}

/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
//@ pure
export function photoBatchCheck(batch: PhotoBatch): PhotoBatchCheck {
  return batch.count < 1 || batch.count > photoPolicy_ratingMaxPhotos ? "BatchCount" : (!batch.typesOk ? "BatchType" : (batch.largestBytes > photoPolicy_ratingMaxBytes || batch.totalBytes > photoPolicy_uploadMaxBytes ? "BatchTooLarge" : "BatchOk"));
}

/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
//@ pure
export function batchError(check: PhotoBatchCheck): PhotoError {
  return check === "BatchCount" ? "PhotoPickCount" : (check === "BatchType" ? "PhotoPickType" : (check === "BatchTooLarge" ? "PhotoPickTooLarge" : "PhotoNoError"));
}

/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
//@ pure
export function canChoosePhotos(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoPick" && page.pending === "PhotoIdle";
}

/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
//@ pure
export function lawFiveFilesAreRefused(largestBytes: number, totalBytes: number, typesOk: boolean): boolean {
  //@ ensures \result === true
  return photoBatchCheck(({ count: 5, largestBytes: largestBytes, totalBytes: totalBytes, typesOk: typesOk } as PhotoBatch)) === "BatchCount";
}

/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
//@ pure
export function lawNoFileIsRefused(batch: PhotoBatch): boolean {
  //@ ensures \result === true
  return !(batch.count < 1) || photoBatchCheck(batch) === "BatchCount";
}

/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
//@ pure
export function lawFileOverFourMiBIsRefused(batch: PhotoBatch): boolean {
  //@ ensures \result === true
  return !(batch.largestBytes > photoPolicy_ratingMaxBytes) || photoBatchCheck(batch) !== "BatchOk";
}

/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
//@ pure
export function lawTotalOverEightMiBIsRefused(batch: PhotoBatch): boolean {
  //@ ensures \result === true
  return !(batch.totalBytes > photoPolicy_uploadMaxBytes) || photoBatchCheck(batch) !== "BatchOk";
}

/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
//@ pure
export function lawAcceptedBatchFitsTheLimits(batch: PhotoBatch): boolean {
  //@ ensures \result === true
  return !(photoBatchCheck(batch) === "BatchOk") || (batch.count >= 1 && batch.count <= photoPolicy_ratingMaxPhotos && batch.typesOk && batch.largestBytes <= photoPolicy_ratingMaxBytes && batch.totalBytes <= photoPolicy_uploadMaxBytes);
}

/** Story: Add my photos from the link in my conversation / The page checks the chosen photos against the upload limits before it sends them (spec/photoUploadPage.md) */
//@ pure
export function choosePhotos(page: PhotoUploadPage, batch: PhotoBatch): PhotoUploadPage {
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysCheckingSendsNoPhotos(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysClosedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysPickHasAnOpenLink(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysTickOnlyWhenAsked(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysConsentNeededWhileUnticked(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysUploadOnlyWhileLinkOpen(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysUploadBelongsToThePicker(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysSavedOnlyWhenDone(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysSavedNoMoreThanChosen(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> alwaysRefusalsOnlyAfterUse(\result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> stepConsentOnlyByThePerson(page, "choosePhotos", \result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> stepOneUploadAtATime(page, "choosePhotos", \result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> stepSavedOnlyFromTheAnswer(page, "choosePhotos", \result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> stepLinkNeverReopens(page, \result)
  //@ ensures (inv(page) && canChoosePhotos(page)) ==> stepPickerOnlyFromAnOpenStatus(page, "choosePhotos", \result)
  const local_1: PhotoError = batchError(photoBatchCheck(batch));
  return { ...page, chosen: batch.count, error: local_1 === "PhotoNoError" && page.error === "PhotoConsentNeeded" ? "PhotoConsentNeeded" : local_1 };
}

/** Story: Add my photos from the link in my conversation / The photo consent goes with the upload only when the person ticks it (spec/photoUploadPage.md) */
//@ pure
export function photoConsentHeaderSent(page: PhotoUploadPage): boolean {
  return page.consentTicked;
}

/** Story: Add my photos from the link in my conversation / The photo consent goes with the upload only when the person ticks it (spec/photoUploadPage.md) */
//@ pure
export function canTickConsent(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoPick" && page.pending === "PhotoIdle" && page.consentAsked;
}

/** Story: Add my photos from the link in my conversation / The photo consent goes with the upload only when the person ticks it (spec/photoUploadPage.md) */
//@ pure
export function tickConsent(page: PhotoUploadPage, ticked: boolean): PhotoUploadPage {
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysCheckingSendsNoPhotos(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysClosedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysPickHasAnOpenLink(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysTickOnlyWhenAsked(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysConsentNeededWhileUnticked(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysUploadOnlyWhileLinkOpen(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysUploadBelongsToThePicker(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysSavedOnlyWhenDone(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysSavedNoMoreThanChosen(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> alwaysRefusalsOnlyAfterUse(\result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> stepConsentOnlyByThePerson(page, "tickConsent", \result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> stepOneUploadAtATime(page, "tickConsent", \result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> stepSavedOnlyFromTheAnswer(page, "tickConsent", \result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> stepLinkNeverReopens(page, \result)
  //@ ensures (inv(page) && canTickConsent(page)) ==> stepPickerOnlyFromAnOpenStatus(page, "tickConsent", \result)
  return { ...page, consentTicked: ticked, error: ticked && page.error === "PhotoConsentNeeded" ? "PhotoNoError" : page.error };
}

/** Story: Add my photos from the link in my conversation / The photo consent goes with the upload only when the person ticks it (spec/photoUploadPage.md) */
//@ pure
export function alwaysTickOnlyWhenAsked(page: PhotoUploadPage): boolean {
  return !page.consentTicked || page.consentAsked;
}

/** Story: Add my photos from the link in my conversation / The photo consent goes with the upload only when the person ticks it (spec/photoUploadPage.md) */
//@ pure
export function alwaysConsentNeededWhileUnticked(page: PhotoUploadPage): boolean {
  return !(page.error === "PhotoConsentNeeded") || !page.consentTicked;
}

/** Story: Add my photos from the link in my conversation / The photo consent goes with the upload only when the person ticks it (spec/photoUploadPage.md) */
//@ pure
export function stepConsentOnlyByThePerson(before: PhotoUploadPage, via: string, after: PhotoUploadPage): boolean {
  return !(after.consentTicked && !before.consentTicked) || via === "tickConsent";
}

/** Story: Add my photos from the link in my conversation / The page sends one batch while the link is open and waits for the answer (spec/photoUploadPage.md) */
//@ pure
export function stepOneUploadAtATime(before: PhotoUploadPage, via: string, after: PhotoUploadPage): boolean {
  return !(after.pending === "PhotoUploading" && before.pending !== "PhotoUploading") || (via === "uploadPhotos" && before.pending === "PhotoIdle");
}

/** Story: Add my photos from the link in my conversation / The page sends one batch while the link is open and waits for the answer (spec/photoUploadPage.md) */
//@ pure
export function canUploadPhotos(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoPick" && page.pending === "PhotoIdle" && page.linkOpen;
}

/** Story: Add my photos from the link in my conversation / The page sends one batch while the link is open and waits for the answer (spec/photoUploadPage.md) */
//@ pure
export function alwaysUploadOnlyWhileLinkOpen(page: PhotoUploadPage): boolean {
  return !(page.pending === "PhotoUploading") || page.linkOpen;
}

/** Story: Add my photos from the link in my conversation / The page sends one batch while the link is open and waits for the answer (spec/photoUploadPage.md) */
//@ pure
export function alwaysUploadBelongsToThePicker(page: PhotoUploadPage): boolean {
  return !(page.pending === "PhotoUploading") || (page.screen === "PhotoPick" && page.chosen >= 1 && page.chosen <= photoPolicy_ratingMaxPhotos);
}

/** Story: Add my photos from the link in my conversation / The page sends one batch while the link is open and waits for the answer (spec/photoUploadPage.md) */
//@ pure
export function uploadPhotos(page: PhotoUploadPage, batch: PhotoBatch): PhotoUploadPage {
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysCheckingSendsNoPhotos(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysClosedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysPickHasAnOpenLink(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysTickOnlyWhenAsked(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysConsentNeededWhileUnticked(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysUploadOnlyWhileLinkOpen(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysUploadBelongsToThePicker(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysSavedOnlyWhenDone(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysSavedNoMoreThanChosen(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> alwaysRefusalsOnlyAfterUse(\result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> stepConsentOnlyByThePerson(page, "uploadPhotos", \result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> stepOneUploadAtATime(page, "uploadPhotos", \result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> stepSavedOnlyFromTheAnswer(page, "uploadPhotos", \result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> stepLinkNeverReopens(page, \result)
  //@ ensures (inv(page) && canUploadPhotos(page)) ==> stepPickerOnlyFromAnOpenStatus(page, "uploadPhotos", \result)
  const local_2: PhotoBatchCheck = photoBatchCheck(batch);
  return local_2 !== "BatchOk" ? ({ ...page, chosen: batch.count, error: batchError(local_2) } as PhotoUploadPage) : (page.error === "PhotoConsentNeeded" && !page.consentTicked ? page : ({ ...page, chosen: batch.count, pending: "PhotoUploading", error: "PhotoNoError" } as PhotoUploadPage));
}

/** Story: Add my photos from the link in my conversation / The page sends one batch while the link is open and waits for the answer (spec/photoUploadPage.md) */
//@ pure
export function lawRefusedBatchIsNeverSent(page: PhotoUploadPage, batch: PhotoBatch): boolean {
  //@ ensures \result === true
  return !(photoBatchCheck(batch) !== "BatchOk") || uploadPhotos(page, batch).pending === page.pending;
}

/** Story: Add my photos from the link in my conversation / The page sends one batch while the link is open and waits for the answer (spec/photoUploadPage.md) */
//@ pure
export function lawRefusedConsentIsNotSentAgainUnticked(page: PhotoUploadPage, batch: PhotoBatch): boolean {
  //@ ensures \result === true
  return !(page.error === "PhotoConsentNeeded" && !page.consentTicked) || uploadPhotos(page, batch).pending === page.pending;
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function savedShown(answer: PhotoAnswer, chosen: number): number {
  return answer.savedCount > chosen ? chosen : answer.savedCount;
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function retryError(kind: PhotoAnswerKind): PhotoError {
  return kind === "UploadTooLarge" ? "PhotoTooLarge" : (kind === "UploadCount" ? "PhotoPickCount" : (kind === "UploadConsentRequired" ? "PhotoConsentNeeded" : (kind === "UploadUnreachable" ? "PhotoUnreachable" : "PhotoRequestFailed")));
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function answerClosesTheLink(kind: PhotoAnswerKind): boolean {
  return kind === "UploadStored" || kind === "UploadAllRefused" || kind === "UploadLinkClosed";
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function canAnswerUpload(page: PhotoUploadPage): boolean {
  return page.pending === "PhotoUploading";
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function alwaysSavedOnlyWhenDone(page: PhotoUploadPage): boolean {
  return page.savedCount > 0 === (page.screen === "PhotoDone");
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function alwaysSavedNoMoreThanChosen(page: PhotoUploadPage): boolean {
  return !(page.screen === "PhotoDone") || page.savedCount <= page.chosen;
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function alwaysRefusalsOnlyAfterUse(page: PhotoUploadPage): boolean {
  return !page.someRefused || (page.screen === "PhotoDone" || page.screen === "PhotoAllRefused");
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function stepSavedOnlyFromTheAnswer(before: PhotoUploadPage, via: string, after: PhotoUploadPage): boolean {
  return !(after.screen === "PhotoDone" && before.screen !== "PhotoDone") || (via === "answerUpload" && before.pending === "PhotoUploading");
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function lawRetryAnswersShowAnError(kind: PhotoAnswerKind): boolean {
  //@ ensures \result === true
  return !(!answerClosesTheLink(kind)) || retryError(kind) !== "PhotoNoError";
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function lawSavedNeverAboveSent(answer: PhotoAnswer, chosen: number): boolean {
  //@ ensures \result === true
  return !(chosen >= 0 && answer.savedCount >= 0) || savedShown(answer, chosen) <= chosen;
}

/** Story: Add my photos from the link in my conversation / The server answer decides between saved, refused, closed and a retry (spec/photoUploadPage.md) */
//@ pure
export function answerUpload(page: PhotoUploadPage, answer: PhotoAnswer): PhotoUploadPage {
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysCheckingSendsNoPhotos(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysClosedScreensCloseTheLink(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysPickHasAnOpenLink(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysTickOnlyWhenAsked(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysConsentNeededWhileUnticked(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysUploadOnlyWhileLinkOpen(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysUploadBelongsToThePicker(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysSavedOnlyWhenDone(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysSavedNoMoreThanChosen(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> alwaysRefusalsOnlyAfterUse(\result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> stepConsentOnlyByThePerson(page, "answerUpload", \result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> stepOneUploadAtATime(page, "answerUpload", \result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> stepSavedOnlyFromTheAnswer(page, "answerUpload", \result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> stepLinkNeverReopens(page, \result)
  //@ ensures (inv(page) && canAnswerUpload(page)) ==> stepPickerOnlyFromAnOpenStatus(page, "answerUpload", \result)
  const local_3: PhotoUploadPage = { ...page, pending: "PhotoIdle" };
  const local_4 = savedShown(answer, page.chosen);
  return answer.kind === "UploadStored" && local_4 >= 1 ? ({ ...local_3, screen: "PhotoDone", linkOpen: false, savedCount: local_4, someRefused: answer.someRefused, error: "PhotoNoError" } as PhotoUploadPage) : (answer.kind === "UploadStored" || answer.kind === "UploadAllRefused" ? ({ ...local_3, screen: "PhotoAllRefused", linkOpen: false, savedCount: 0, someRefused: answer.someRefused, error: "PhotoNoError" } as PhotoUploadPage) : (answer.kind === "UploadLinkClosed" ? ({ ...local_3, screen: "PhotoLinkClosed", linkOpen: false, savedCount: 0, someRefused: false, error: "PhotoNoError" } as PhotoUploadPage) : (answer.kind === "UploadConsentRequired" ? ({ ...local_3, consentAsked: true, consentTicked: false, error: "PhotoConsentNeeded" } as PhotoUploadPage) : ({ ...local_3, error: retryError(answer.kind) } as PhotoUploadPage))));
}

/** Story: A used or expired link stores nothing / A closed link never opens again on the page (spec/photoUploadPage.md) */
//@ pure
export function photoUploadOffered(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoPick" && page.linkOpen;
}

/** Story: A used or expired link stores nothing / A closed link never opens again on the page (spec/photoUploadPage.md) */
//@ pure
export function stepLinkNeverReopens(before: PhotoUploadPage, after: PhotoUploadPage): boolean {
  return !(!before.linkOpen && before.screen !== "PhotoOpening" && before.screen !== "PhotoChecking") || !after.linkOpen;
}

/** Story: A used or expired link stores nothing / A closed link never opens again on the page (spec/photoUploadPage.md) */
//@ pure
export function stepPickerOnlyFromAnOpenStatus(before: PhotoUploadPage, via: string, after: PhotoUploadPage): boolean {
  return !(after.screen === "PhotoPick" && before.screen !== "PhotoPick") || (via === "answerLinkStatus" && before.pending === "PhotoReading");
}

/** Story: A used or expired link stores nothing / A closed link never opens again on the page (spec/photoUploadPage.md) */
//@ pure
export function lawClosingAnswerEndsTheUpload(page: PhotoUploadPage, answer: PhotoAnswer): boolean {
  //@ ensures \result === true
  return !(canAnswerUpload(page) && answerClosesTheLink(answer.kind)) || !photoUploadOffered(answerUpload(page, answer));
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesDone(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoDone" && !page.someRefused;
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesDonePartly(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoDone" && page.someRefused;
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesDoneWithConsent(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoDone" && page.consentTicked;
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesAllRefused(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoAllRefused";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesLinkClosed(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoLinkClosed";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesBadLink(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoBadLink";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesUploading(page: PhotoUploadPage): boolean {
  return page.pending === "PhotoUploading";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesPickCount(page: PhotoUploadPage): boolean {
  return page.error === "PhotoPickCount";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesPickTooLarge(page: PhotoUploadPage): boolean {
  return page.error === "PhotoPickTooLarge";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesPickType(page: PhotoUploadPage): boolean {
  return page.error === "PhotoPickType";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesConsentNeeded(page: PhotoUploadPage): boolean {
  return page.error === "PhotoConsentNeeded";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesTooLarge(page: PhotoUploadPage): boolean {
  return page.error === "PhotoTooLarge" && page.linkOpen;
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesRequestFailed(page: PhotoUploadPage): boolean {
  return page.error === "PhotoRequestFailed";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesCheckingLink(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoChecking" && page.pending === "PhotoReading";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesStatusUnreachable(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoChecking" && page.error === "PhotoUnreachable";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesStatusFailed(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoChecking" && page.error === "PhotoRequestFailed";
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesPickWithoutConsentBox(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoPick" && !page.consentAsked;
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesClosedBeforeUpload(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoLinkClosed" && page.chosen === 0;
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesUnreachable(page: PhotoUploadPage): boolean {
  return page.error === "PhotoUnreachable" && photoUploadOffered(page);
}

/** Story: Reach every outcome / A person can save photos, see each refusal, find the link closed or see each error (spec/photoUploadPage.md) */
//@ pure
export function sometimesRetryAfterUnreachable(page: PhotoUploadPage): boolean {
  return page.screen === "PhotoPick" && page.error === "PhotoUnreachable" && canUploadPhotos(page);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoUploadPage, event: Event): boolean {
  if (event.type === "openPhotoPage") return canOpenPhotoPage(current);
  if (event.type === "retryLinkStatus") return canRetryLinkStatus(current);
  if (event.type === "answerLinkStatus") return canAnswerLinkStatus(current);
  if (event.type === "choosePhotos") return canChoosePhotos(current);
  if (event.type === "tickConsent") return canTickConsent(current);
  if (event.type === "uploadPhotos") return canUploadPhotos(current);
  if (event.type === "answerUpload") return canAnswerUpload(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoUploadPage, event: Event): PhotoUploadPage {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openPhotoPage") return canOpenPhotoPage(current) ? openPhotoPage(current, event.tokenWellFormed) : current;
  if (event.type === "retryLinkStatus") return canRetryLinkStatus(current) ? retryLinkStatus(current) : current;
  if (event.type === "answerLinkStatus") return canAnswerLinkStatus(current) ? answerLinkStatus(current, event.linkStatus) : current;
  if (event.type === "choosePhotos") return canChoosePhotos(current) ? choosePhotos(current, event.batch) : current;
  if (event.type === "tickConsent") return canTickConsent(current) ? tickConsent(current, event.ticked) : current;
  if (event.type === "uploadPhotos") return canUploadPhotos(current) ? uploadPhotos(current, event.batch) : current;
  if (event.type === "answerUpload") return canAnswerUpload(current) ? answerUpload(current, event.answer) : current;
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
  const is_PhotoLinkStatus = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && (v.kind === "LinkStatusOpen" || v.kind === "LinkStatusClosed" || v.kind === "LinkStatusUnreachable" || v.kind === "LinkStatusFailed") && typeof v.consentRequired === "boolean";
  const is_PhotoBatch = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && Number.isSafeInteger(v.count) && Number.isSafeInteger(v.largestBytes) && Number.isSafeInteger(v.totalBytes) && typeof v.typesOk === "boolean";
  const is_PhotoAnswer = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && (v.kind === "UploadStored" || v.kind === "UploadAllRefused" || v.kind === "UploadLinkClosed" || v.kind === "UploadTooLarge" || v.kind === "UploadCount" || v.kind === "UploadConsentRequired" || v.kind === "UploadInvalid" || v.kind === "UploadUnreachable") && Number.isSafeInteger(v.savedCount) && typeof v.someRefused === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "openPhotoPage" && typeof raw.tokenWellFormed === "boolean") return { type: "openPhotoPage", tokenWellFormed: raw.tokenWellFormed };
  if (raw.type === "retryLinkStatus") return { type: "retryLinkStatus" };
  if (raw.type === "answerLinkStatus" && is_PhotoLinkStatus(raw.linkStatus)) return { type: "answerLinkStatus", linkStatus: ({ kind: raw.linkStatus.kind, consentRequired: raw.linkStatus.consentRequired }) };
  if (raw.type === "choosePhotos" && is_PhotoBatch(raw.batch)) return { type: "choosePhotos", batch: ({ count: raw.batch.count, largestBytes: raw.batch.largestBytes, totalBytes: raw.batch.totalBytes, typesOk: raw.batch.typesOk }) };
  if (raw.type === "tickConsent" && typeof raw.ticked === "boolean") return { type: "tickConsent", ticked: raw.ticked };
  if (raw.type === "uploadPhotos" && is_PhotoBatch(raw.batch)) return { type: "uploadPhotos", batch: ({ count: raw.batch.count, largestBytes: raw.batch.largestBytes, totalBytes: raw.batch.totalBytes, typesOk: raw.batch.typesOk }) };
  if (raw.type === "answerUpload" && is_PhotoAnswer(raw.answer)) return { type: "answerUpload", answer: ({ kind: raw.answer.kind, savedCount: raw.answer.savedCount, someRefused: raw.answer.someRefused }) };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhotoUploadPage | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.screen === "PhotoOpening" || raw.screen === "PhotoBadLink" || raw.screen === "PhotoChecking" || raw.screen === "PhotoPick" || raw.screen === "PhotoDone" || raw.screen === "PhotoAllRefused" || raw.screen === "PhotoLinkClosed") && (raw.pending === "PhotoIdle" || raw.pending === "PhotoReading" || raw.pending === "PhotoUploading") && (raw.error === "PhotoNoError" || raw.error === "PhotoPickCount" || raw.error === "PhotoPickTooLarge" || raw.error === "PhotoPickType" || raw.error === "PhotoConsentNeeded" || raw.error === "PhotoTooLarge" || raw.error === "PhotoUnreachable" || raw.error === "PhotoRequestFailed") && typeof raw.linkOpen === "boolean" && typeof raw.consentAsked === "boolean" && typeof raw.consentTicked === "boolean" && Number.isSafeInteger(raw.chosen) && Number.isSafeInteger(raw.savedCount) && typeof raw.someRefused === "boolean" && Object.keys(raw).length === 9)) return undefined;
  const parsed: PhotoUploadPage = ({ screen: raw.screen, pending: raw.pending, error: raw.error, linkOpen: raw.linkOpen, consentAsked: raw.consentAsked, consentTicked: raw.consentTicked, chosen: raw.chosen, savedCount: raw.savedCount, someRefused: raw.someRefused });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoUploadPage {
  //@ ensures inv(\result)
  return initial;
}
