// GENERATED from spec/photosViewPage.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
export type ViewScreen = "ViewOpening" | "ViewTap" | "ViewShowing" | "ViewConfirmReport" | "ViewReported" | "ViewOtherDevice" | "ViewGone" | "ViewReplaced";
/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
export type ViewPending = "ViewIdle" | "ViewOpeningLink" | "ViewLoadingPhotos" | "ViewReporting";
/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
export type ViewError = "ViewNoError" | "ViewUnreachable" | "ViewRequestFailed";
/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
export interface PhotosViewPage { screen: ViewScreen; pending: ViewPending; error: ViewError; linkHeld: boolean; opened: boolean; count: number; loaded: number; missing: number; reportLost: boolean }
/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
export type ViewOpenKind = "OpenShown" | "OpenOtherDevice" | "OpenGone" | "OpenReplaced" | "OpenUnreachable" | "OpenFailed";
/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
export interface ViewOpenAnswer { kind: ViewOpenKind; count: number }
/** Story: See the photo my match chose to send me / The page loads each photo of the offer once and shows only what the server gives (spec/photosViewPage.md) */
export type ViewImageAnswer = "ImageShown" | "ImageMissing" | "ImageOtherDevice" | "ImageGone" | "ImageReplaced" | "ImageUnreachable" | "ImageFailed";
/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
export type ViewReportAnswer = "ReportDone" | "ReportGone" | "ReportOtherDevice" | "ReportReplaced" | "ReportUnreachable" | "ReportFailed";

/** One variant per transition in the spec. */
export type Event =
  | { type: "openViewPage"; tokenWellFormed: boolean }
  | { type: "tapToView" }
  | { type: "answerViewOpen"; openAnswer: ViewOpenAnswer }
  | { type: "answerViewImage"; image: ViewImageAnswer }
  | { type: "askToReport" }
  | { type: "keepViewing" }
  | { type: "sendReport" }
  | { type: "answerReport"; report: ViewReportAnswer };

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
export const initial: PhotosViewPage = { screen: "ViewOpening", pending: "ViewIdle", error: "ViewNoError", linkHeld: false, opened: false, count: 0, loaded: 0, missing: 0, reportLost: false };
/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
export const photoViewMax: number = 3;

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotosViewPage): boolean {
  return alwaysNoPhotoBeforeTheOpen(current) && alwaysRequestsNeedTheLink(current) && alwaysPhotosWithinTheOffer(current) && alwaysShowingHasAPhotoOrLoads(current) && alwaysPhotosOnlyOnTheViewSteps(current) && alwaysConfirmHidesThePhotos(current) && alwaysConfirmHasAPhoto(current) && alwaysReportLostOnlyOnAClosedStep(current) && alwaysEndedPagesHoldNothing(current);
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function viewClosed(screen: ViewScreen, opened: boolean, reportLost: boolean): PhotosViewPage {
  return { ...initial, screen: screen, opened: opened, reportLost: reportLost };
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function viewCountOk(count: number): boolean {
  return count >= 1 && count <= photoViewMax;
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function viewScreenAfterOpen(openAnswer: ViewOpenAnswer): ViewScreen {
  return openAnswer.kind === "OpenShown" && viewCountOk(openAnswer.count) ? "ViewShowing" : (openAnswer.kind === "OpenOtherDevice" ? "ViewOtherDevice" : (openAnswer.kind === "OpenGone" ? "ViewGone" : (openAnswer.kind === "OpenReplaced" ? "ViewReplaced" : "ViewTap")));
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function viewOpenError(kind: ViewOpenKind): ViewError {
  return kind === "OpenUnreachable" ? "ViewUnreachable" : "ViewRequestFailed";
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function canOpenViewPage(page: PhotosViewPage): boolean {
  return page.screen === "ViewOpening";
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function openViewPage(page: PhotosViewPage, tokenWellFormed: boolean): PhotosViewPage {
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> alwaysNoPhotoBeforeTheOpen(\result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> alwaysRequestsNeedTheLink(\result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> alwaysPhotosWithinTheOffer(\result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> alwaysShowingHasAPhotoOrLoads(\result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> alwaysPhotosOnlyOnTheViewSteps(\result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> alwaysConfirmHidesThePhotos(\result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> alwaysConfirmHasAPhoto(\result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> alwaysReportLostOnlyOnAClosedStep(\result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> alwaysEndedPagesHoldNothing(\result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> stepOpenOnlyByTap(page, "openViewPage", \result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> stepNoClockClosesThePhotos(page, "openViewPage", \result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> stepReportOnlyAfterTheConfirm(page, "openViewPage", \result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> stepReportedOnlyFromTheServer(page, "openViewPage", \result)
  //@ ensures (inv(page) && canOpenViewPage(page)) ==> stepEndsAreFinal(page, \result)
  return tokenWellFormed ? ({ ...page, screen: "ViewTap", linkHeld: true } as PhotosViewPage) : viewClosed("ViewGone", false, false);
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function canTapToView(page: PhotosViewPage): boolean {
  return page.screen === "ViewTap" && page.pending === "ViewIdle" && page.linkHeld;
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function tapToView(page: PhotosViewPage): PhotosViewPage {
  //@ ensures (inv(page) && canTapToView(page)) ==> alwaysNoPhotoBeforeTheOpen(\result)
  //@ ensures (inv(page) && canTapToView(page)) ==> alwaysRequestsNeedTheLink(\result)
  //@ ensures (inv(page) && canTapToView(page)) ==> alwaysPhotosWithinTheOffer(\result)
  //@ ensures (inv(page) && canTapToView(page)) ==> alwaysShowingHasAPhotoOrLoads(\result)
  //@ ensures (inv(page) && canTapToView(page)) ==> alwaysPhotosOnlyOnTheViewSteps(\result)
  //@ ensures (inv(page) && canTapToView(page)) ==> alwaysConfirmHidesThePhotos(\result)
  //@ ensures (inv(page) && canTapToView(page)) ==> alwaysConfirmHasAPhoto(\result)
  //@ ensures (inv(page) && canTapToView(page)) ==> alwaysReportLostOnlyOnAClosedStep(\result)
  //@ ensures (inv(page) && canTapToView(page)) ==> alwaysEndedPagesHoldNothing(\result)
  //@ ensures (inv(page) && canTapToView(page)) ==> stepOpenOnlyByTap(page, "tapToView", \result)
  //@ ensures (inv(page) && canTapToView(page)) ==> stepNoClockClosesThePhotos(page, "tapToView", \result)
  //@ ensures (inv(page) && canTapToView(page)) ==> stepReportOnlyAfterTheConfirm(page, "tapToView", \result)
  //@ ensures (inv(page) && canTapToView(page)) ==> stepReportedOnlyFromTheServer(page, "tapToView", \result)
  //@ ensures (inv(page) && canTapToView(page)) ==> stepEndsAreFinal(page, \result)
  return { ...page, pending: "ViewOpeningLink", error: "ViewNoError" };
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function canAnswerViewOpen(page: PhotosViewPage): boolean {
  return page.screen === "ViewTap" && page.pending === "ViewOpeningLink";
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function answerViewOpen(page: PhotosViewPage, openAnswer: ViewOpenAnswer): PhotosViewPage {
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> alwaysNoPhotoBeforeTheOpen(\result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> alwaysRequestsNeedTheLink(\result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> alwaysPhotosWithinTheOffer(\result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> alwaysShowingHasAPhotoOrLoads(\result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> alwaysPhotosOnlyOnTheViewSteps(\result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> alwaysConfirmHidesThePhotos(\result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> alwaysConfirmHasAPhoto(\result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> alwaysReportLostOnlyOnAClosedStep(\result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> alwaysEndedPagesHoldNothing(\result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> stepOpenOnlyByTap(page, "answerViewOpen", \result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> stepNoClockClosesThePhotos(page, "answerViewOpen", \result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> stepReportOnlyAfterTheConfirm(page, "answerViewOpen", \result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> stepReportedOnlyFromTheServer(page, "answerViewOpen", \result)
  //@ ensures (inv(page) && canAnswerViewOpen(page)) ==> stepEndsAreFinal(page, \result)
  const local_0: ViewScreen = viewScreenAfterOpen(openAnswer);
  return local_0 === "ViewShowing" ? ({ ...page, screen: "ViewShowing", pending: "ViewLoadingPhotos", error: "ViewNoError", opened: true, count: openAnswer.count, loaded: 0, missing: 0 } as PhotosViewPage) : (local_0 === "ViewTap" ? ({ ...page, pending: "ViewIdle", error: viewOpenError(openAnswer.kind) } as PhotosViewPage) : viewClosed(local_0, page.opened, false));
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function lawOnlyAGoodOpenShowsPhotos(openAnswer: ViewOpenAnswer): boolean {
  //@ ensures \result === true
  return (viewScreenAfterOpen(openAnswer) === "ViewShowing") === (openAnswer.kind === "OpenShown" && viewCountOk(openAnswer.count));
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function lawOpenRetryShowsAnError(openAnswer: ViewOpenAnswer): boolean {
  //@ ensures \result === true
  return !(viewScreenAfterOpen(openAnswer) === "ViewTap") || viewOpenError(openAnswer.kind) !== "ViewNoError";
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function stepOpenOnlyByTap(before: PhotosViewPage, via: string, after: PhotosViewPage): boolean {
  return !(after.pending === "ViewOpeningLink" && before.pending !== "ViewOpeningLink") || (via === "tapToView" && before.screen === "ViewTap");
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function alwaysNoPhotoBeforeTheOpen(page: PhotosViewPage): boolean {
  return !(page.loaded > 0 || page.screen === "ViewShowing" || page.screen === "ViewConfirmReport") || page.opened;
}

/** Story: See the photo my match chose to send me / The page opens the photos only when the person taps, and only from a well-formed token (spec/photosViewPage.md) */
//@ pure
export function alwaysRequestsNeedTheLink(page: PhotosViewPage): boolean {
  return !(page.pending !== "ViewIdle") || page.linkHeld;
}

/** Story: See the photo my match chose to send me / The page loads each photo of the offer once and shows only what the server gives (spec/photosViewPage.md) */
//@ pure
export function viewLoadSettles(loaded: number, missing: number, count: number): boolean {
  return exact_photosViewPage(exact_photosViewPage(loaded + missing) + 1) >= count;
}

/** Story: See the photo my match chose to send me / The page loads each photo of the offer once and shows only what the server gives (spec/photosViewPage.md) */
//@ pure
export function canAnswerViewImage(page: PhotosViewPage): boolean {
  return page.screen === "ViewShowing" && page.pending === "ViewLoadingPhotos" && exact_photosViewPage(page.loaded + page.missing) < page.count;
}

/** Story: See the photo my match chose to send me / The page loads each photo of the offer once and shows only what the server gives (spec/photosViewPage.md) */
//@ pure
export function answerViewImage(page: PhotosViewPage, image: ViewImageAnswer): PhotosViewPage {
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> alwaysNoPhotoBeforeTheOpen(\result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> alwaysRequestsNeedTheLink(\result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> alwaysPhotosWithinTheOffer(\result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> alwaysShowingHasAPhotoOrLoads(\result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> alwaysPhotosOnlyOnTheViewSteps(\result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> alwaysConfirmHidesThePhotos(\result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> alwaysConfirmHasAPhoto(\result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> alwaysReportLostOnlyOnAClosedStep(\result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> alwaysEndedPagesHoldNothing(\result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> stepOpenOnlyByTap(page, "answerViewImage", \result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> stepNoClockClosesThePhotos(page, "answerViewImage", \result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> stepReportOnlyAfterTheConfirm(page, "answerViewImage", \result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> stepReportedOnlyFromTheServer(page, "answerViewImage", \result)
  //@ ensures (inv(page) && canAnswerViewImage(page)) ==> stepEndsAreFinal(page, \result)
  const local_1 = viewLoadSettles(page.loaded, page.missing, page.count);
  const local_2: ViewPending = local_1 ? "ViewIdle" : "ViewLoadingPhotos";
  return image === "ImageShown" ? ({ ...page, loaded: exact_photosViewPage(page.loaded + 1), pending: local_2 } as PhotosViewPage) : (image === "ImageMissing" && local_1 && page.loaded === 0 ? viewClosed("ViewGone", true, false) : (image === "ImageMissing" ? ({ ...page, missing: exact_photosViewPage(page.missing + 1), pending: local_2 } as PhotosViewPage) : (image === "ImageOtherDevice" ? viewClosed("ViewOtherDevice", true, false) : (image === "ImageGone" ? viewClosed("ViewGone", true, false) : (image === "ImageReplaced" ? viewClosed("ViewReplaced", true, false) : ({ ...page, screen: "ViewTap", pending: "ViewIdle", loaded: 0, missing: 0, error: image === "ImageUnreachable" ? "ViewUnreachable" : "ViewRequestFailed" } as PhotosViewPage))))));
}

/** Story: See the photo my match chose to send me / The page loads each photo of the offer once and shows only what the server gives (spec/photosViewPage.md) */
//@ pure
export function alwaysPhotosWithinTheOffer(page: PhotosViewPage): boolean {
  return page.loaded >= 0 && page.missing >= 0 && exact_photosViewPage(page.loaded + page.missing) <= page.count && page.count <= photoViewMax;
}

/** Story: See the photo my match chose to send me / The page loads each photo of the offer once and shows only what the server gives (spec/photosViewPage.md) */
//@ pure
export function alwaysShowingHasAPhotoOrLoads(page: PhotosViewPage): boolean {
  return !(page.screen === "ViewShowing") || (page.loaded > 0 || page.pending === "ViewLoadingPhotos");
}

/** Story: See the photo my match chose to send me / The page offers no way to save the photo, and says what it cannot stop (spec/photosViewPage.md) */
//@ pure
export function viewPhotosHeld(page: PhotosViewPage): boolean {
  return page.loaded > 0 && (page.screen === "ViewShowing" || page.screen === "ViewConfirmReport");
}

/** Story: See the photo my match chose to send me / The page offers no way to save the photo, and says what it cannot stop (spec/photosViewPage.md) */
//@ pure
export function viewPhotosShown(page: PhotosViewPage): boolean {
  return page.screen === "ViewShowing" && page.loaded > 0;
}

/** Story: See the photo my match chose to send me / The page offers no way to save the photo, and says what it cannot stop (spec/photosViewPage.md) */
//@ pure
export function alwaysPhotosOnlyOnTheViewSteps(page: PhotosViewPage): boolean {
  return !(page.loaded > 0) || (page.screen === "ViewShowing" || page.screen === "ViewConfirmReport");
}

/** Story: See the photo my match chose to send me / The page offers no way to save the photo, and says what it cannot stop (spec/photosViewPage.md) */
//@ pure
export function alwaysConfirmHidesThePhotos(page: PhotosViewPage): boolean {
  return !(page.screen === "ViewConfirmReport") || !viewPhotosShown(page);
}

/** Story: See the photo my match chose to send me / No clock closes the photos (spec/photosViewPage.md) */
//@ pure
export function stepNoClockClosesThePhotos(before: PhotosViewPage, via: string, after: PhotosViewPage): boolean {
  return !(viewPhotosHeld(before) && !viewPhotosHeld(after)) || (via === "answerViewImage" || via === "askToReport" || via === "answerReport");
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function viewScreenAfterReport(report: ViewReportAnswer): ViewScreen {
  return report === "ReportDone" ? "ViewReported" : (report === "ReportGone" ? "ViewGone" : (report === "ReportOtherDevice" ? "ViewOtherDevice" : (report === "ReportReplaced" ? "ViewReplaced" : "ViewConfirmReport")));
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function canAskToReport(page: PhotosViewPage): boolean {
  return page.screen === "ViewShowing" && page.pending === "ViewIdle" && page.loaded >= 1;
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function askToReport(page: PhotosViewPage): PhotosViewPage {
  //@ ensures (inv(page) && canAskToReport(page)) ==> alwaysNoPhotoBeforeTheOpen(\result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> alwaysRequestsNeedTheLink(\result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> alwaysPhotosWithinTheOffer(\result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> alwaysShowingHasAPhotoOrLoads(\result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> alwaysPhotosOnlyOnTheViewSteps(\result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> alwaysConfirmHidesThePhotos(\result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> alwaysConfirmHasAPhoto(\result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> alwaysReportLostOnlyOnAClosedStep(\result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> alwaysEndedPagesHoldNothing(\result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> stepOpenOnlyByTap(page, "askToReport", \result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> stepNoClockClosesThePhotos(page, "askToReport", \result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> stepReportOnlyAfterTheConfirm(page, "askToReport", \result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> stepReportedOnlyFromTheServer(page, "askToReport", \result)
  //@ ensures (inv(page) && canAskToReport(page)) ==> stepEndsAreFinal(page, \result)
  return { ...page, screen: "ViewConfirmReport", error: "ViewNoError" };
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function canKeepViewing(page: PhotosViewPage): boolean {
  return page.screen === "ViewConfirmReport" && page.pending === "ViewIdle";
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function keepViewing(page: PhotosViewPage): PhotosViewPage {
  //@ ensures (inv(page) && canKeepViewing(page)) ==> alwaysNoPhotoBeforeTheOpen(\result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> alwaysRequestsNeedTheLink(\result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> alwaysPhotosWithinTheOffer(\result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> alwaysShowingHasAPhotoOrLoads(\result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> alwaysPhotosOnlyOnTheViewSteps(\result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> alwaysConfirmHidesThePhotos(\result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> alwaysConfirmHasAPhoto(\result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> alwaysReportLostOnlyOnAClosedStep(\result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> alwaysEndedPagesHoldNothing(\result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> stepOpenOnlyByTap(page, "keepViewing", \result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> stepNoClockClosesThePhotos(page, "keepViewing", \result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> stepReportOnlyAfterTheConfirm(page, "keepViewing", \result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> stepReportedOnlyFromTheServer(page, "keepViewing", \result)
  //@ ensures (inv(page) && canKeepViewing(page)) ==> stepEndsAreFinal(page, \result)
  return { ...page, screen: "ViewShowing", error: "ViewNoError" };
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function canSendReport(page: PhotosViewPage): boolean {
  return page.screen === "ViewConfirmReport" && page.pending === "ViewIdle" && page.linkHeld;
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function sendReport(page: PhotosViewPage): PhotosViewPage {
  //@ ensures (inv(page) && canSendReport(page)) ==> alwaysNoPhotoBeforeTheOpen(\result)
  //@ ensures (inv(page) && canSendReport(page)) ==> alwaysRequestsNeedTheLink(\result)
  //@ ensures (inv(page) && canSendReport(page)) ==> alwaysPhotosWithinTheOffer(\result)
  //@ ensures (inv(page) && canSendReport(page)) ==> alwaysShowingHasAPhotoOrLoads(\result)
  //@ ensures (inv(page) && canSendReport(page)) ==> alwaysPhotosOnlyOnTheViewSteps(\result)
  //@ ensures (inv(page) && canSendReport(page)) ==> alwaysConfirmHidesThePhotos(\result)
  //@ ensures (inv(page) && canSendReport(page)) ==> alwaysConfirmHasAPhoto(\result)
  //@ ensures (inv(page) && canSendReport(page)) ==> alwaysReportLostOnlyOnAClosedStep(\result)
  //@ ensures (inv(page) && canSendReport(page)) ==> alwaysEndedPagesHoldNothing(\result)
  //@ ensures (inv(page) && canSendReport(page)) ==> stepOpenOnlyByTap(page, "sendReport", \result)
  //@ ensures (inv(page) && canSendReport(page)) ==> stepNoClockClosesThePhotos(page, "sendReport", \result)
  //@ ensures (inv(page) && canSendReport(page)) ==> stepReportOnlyAfterTheConfirm(page, "sendReport", \result)
  //@ ensures (inv(page) && canSendReport(page)) ==> stepReportedOnlyFromTheServer(page, "sendReport", \result)
  //@ ensures (inv(page) && canSendReport(page)) ==> stepEndsAreFinal(page, \result)
  return { ...page, pending: "ViewReporting", error: "ViewNoError" };
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function canAnswerReport(page: PhotosViewPage): boolean {
  return page.pending === "ViewReporting";
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function answerReport(page: PhotosViewPage, report: ViewReportAnswer): PhotosViewPage {
  //@ ensures (inv(page) && canAnswerReport(page)) ==> alwaysNoPhotoBeforeTheOpen(\result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> alwaysRequestsNeedTheLink(\result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> alwaysPhotosWithinTheOffer(\result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> alwaysShowingHasAPhotoOrLoads(\result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> alwaysPhotosOnlyOnTheViewSteps(\result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> alwaysConfirmHidesThePhotos(\result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> alwaysConfirmHasAPhoto(\result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> alwaysReportLostOnlyOnAClosedStep(\result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> alwaysEndedPagesHoldNothing(\result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> stepOpenOnlyByTap(page, "answerReport", \result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> stepNoClockClosesThePhotos(page, "answerReport", \result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> stepReportOnlyAfterTheConfirm(page, "answerReport", \result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> stepReportedOnlyFromTheServer(page, "answerReport", \result)
  //@ ensures (inv(page) && canAnswerReport(page)) ==> stepEndsAreFinal(page, \result)
  const local_3: ViewScreen = viewScreenAfterReport(report);
  return local_3 === "ViewConfirmReport" ? ({ ...page, pending: "ViewIdle", error: report === "ReportUnreachable" ? "ViewUnreachable" : "ViewRequestFailed" } as PhotosViewPage) : viewClosed(local_3, true, local_3 !== "ViewReported");
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function lawOnlyTheServerConfirmsAReport(report: ViewReportAnswer): boolean {
  //@ ensures \result === true
  return (viewScreenAfterReport(report) === "ViewReported") === (report === "ReportDone");
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function lawAFailedReportCanBeSentAgain(report: ViewReportAnswer): boolean {
  //@ ensures \result === true
  return !(report === "ReportUnreachable" || report === "ReportFailed") || viewScreenAfterReport(report) === "ViewConfirmReport";
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function stepReportOnlyAfterTheConfirm(before: PhotosViewPage, via: string, after: PhotosViewPage): boolean {
  return !(after.pending === "ViewReporting" && before.pending !== "ViewReporting") || (via === "sendReport" && before.screen === "ViewConfirmReport");
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function stepReportedOnlyFromTheServer(before: PhotosViewPage, via: string, after: PhotosViewPage): boolean {
  return !(after.screen === "ViewReported" && before.screen !== "ViewReported") || (via === "answerReport" && before.pending === "ViewReporting");
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function alwaysConfirmHasAPhoto(page: PhotosViewPage): boolean {
  return !(page.screen === "ViewConfirmReport") || (page.loaded >= 1 && page.opened);
}

/** Story: Report a photo that is not okay / A report needs a confirm, goes once, and only the server's answer says it is done (spec/photosViewPage.md) */
//@ pure
export function alwaysReportLostOnlyOnAClosedStep(page: PhotosViewPage): boolean {
  return !page.reportLost || (page.screen === "ViewGone" || page.screen === "ViewOtherDevice" || page.screen === "ViewReplaced");
}

/** Story: A link on another phone, an ended offer or a report shows nothing / A closed step never opens again, and a withdrawn photo looks like an expired one (spec/photosViewPage.md) */
//@ pure
export function viewEnded(screen: ViewScreen): boolean {
  return screen === "ViewReported" || screen === "ViewOtherDevice" || screen === "ViewGone" || screen === "ViewReplaced";
}

/** Story: A link on another phone, an ended offer or a report shows nothing / A closed step never opens again, and a withdrawn photo looks like an expired one (spec/photosViewPage.md) */
//@ pure
export function alwaysEndedPagesHoldNothing(page: PhotosViewPage): boolean {
  return !viewEnded(page.screen) || (!page.linkHeld && page.loaded === 0 && page.pending === "ViewIdle");
}

/** Story: A link on another phone, an ended offer or a report shows nothing / A closed step never opens again, and a withdrawn photo looks like an expired one (spec/photosViewPage.md) */
//@ pure
export function stepEndsAreFinal(before: PhotosViewPage, after: PhotosViewPage): boolean {
  return !viewEnded(before.screen) || equal_photosViewPage(after, before);
}

/** Story: A link on another phone, an ended offer or a report shows nothing / A closed step never opens again, and a withdrawn photo looks like an expired one (spec/photosViewPage.md) */
//@ pure
export function lawEveryEndedOfferLooksTheSame(count: number): boolean {
  //@ ensures \result === true
  return viewScreenAfterOpen(({ kind: "OpenGone", count: count } as ViewOpenAnswer)) === "ViewGone";
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesTap(page: PhotosViewPage): boolean {
  return page.screen === "ViewTap" && !page.opened;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesOpening(page: PhotosViewPage): boolean {
  return page.pending === "ViewOpeningLink";
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesLoading(page: PhotosViewPage): boolean {
  return page.pending === "ViewLoadingPhotos" && page.loaded >= 1;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesShowingOne(page: PhotosViewPage): boolean {
  return viewPhotosShown(page) && page.pending === "ViewIdle" && page.count === 1;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesShowingThree(page: PhotosViewPage): boolean {
  return viewPhotosShown(page) && page.pending === "ViewIdle" && page.loaded === 3;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesShowingPart(page: PhotosViewPage): boolean {
  return viewPhotosShown(page) && page.pending === "ViewIdle" && page.missing > 0;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesConfirmReport(page: PhotosViewPage): boolean {
  return page.screen === "ViewConfirmReport" && page.pending === "ViewIdle";
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesReporting(page: PhotosViewPage): boolean {
  return page.pending === "ViewReporting";
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesReportRetry(page: PhotosViewPage): boolean {
  return page.screen === "ViewConfirmReport" && page.error === "ViewUnreachable" && canSendReport(page);
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesReported(page: PhotosViewPage): boolean {
  return page.screen === "ViewReported";
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesOtherDevice(page: PhotosViewPage): boolean {
  return page.screen === "ViewOtherDevice" && !page.reportLost;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesGone(page: PhotosViewPage): boolean {
  return page.screen === "ViewGone" && !page.opened;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesGoneAfterTheOpen(page: PhotosViewPage): boolean {
  return page.screen === "ViewGone" && page.opened && !page.reportLost;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesReplaced(page: PhotosViewPage): boolean {
  return page.screen === "ViewReplaced" && !page.reportLost;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesReportLost(page: PhotosViewPage): boolean {
  return page.screen === "ViewGone" && page.reportLost;
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesUnreachable(page: PhotosViewPage): boolean {
  return page.screen === "ViewTap" && page.error === "ViewUnreachable" && canTapToView(page);
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesRequestFailed(page: PhotosViewPage): boolean {
  return page.screen === "ViewTap" && page.error === "ViewRequestFailed";
}

/** Story: Reach every outcome / A person can see one or three photos, see part of an offer, report, and find each closed step and error (spec/photosViewPage.md) */
//@ pure
export function sometimesTapAgainAfterAPhotoFailed(page: PhotosViewPage): boolean {
  return page.screen === "ViewTap" && page.opened && page.error !== "ViewNoError";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotosViewPage, event: Event): boolean {
  if (event.type === "openViewPage") return canOpenViewPage(current);
  if (event.type === "tapToView") return canTapToView(current);
  if (event.type === "answerViewOpen") return canAnswerViewOpen(current);
  if (event.type === "answerViewImage") return canAnswerViewImage(current);
  if (event.type === "askToReport") return canAskToReport(current);
  if (event.type === "keepViewing") return canKeepViewing(current);
  if (event.type === "sendReport") return canSendReport(current);
  if (event.type === "answerReport") return canAnswerReport(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotosViewPage, event: Event): PhotosViewPage {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openViewPage") return canOpenViewPage(current) ? openViewPage(current, event.tokenWellFormed) : current;
  if (event.type === "tapToView") return canTapToView(current) ? tapToView(current) : current;
  if (event.type === "answerViewOpen") return canAnswerViewOpen(current) ? answerViewOpen(current, event.openAnswer) : current;
  if (event.type === "answerViewImage") return canAnswerViewImage(current) ? answerViewImage(current, event.image) : current;
  if (event.type === "askToReport") return canAskToReport(current) ? askToReport(current) : current;
  if (event.type === "keepViewing") return canKeepViewing(current) ? keepViewing(current) : current;
  if (event.type === "sendReport") return canSendReport(current) ? sendReport(current) : current;
  if (event.type === "answerReport") return canAnswerReport(current) ? answerReport(current, event.report) : current;
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
  const is_ViewOpenAnswer = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && (v.kind === "OpenShown" || v.kind === "OpenOtherDevice" || v.kind === "OpenGone" || v.kind === "OpenReplaced" || v.kind === "OpenUnreachable" || v.kind === "OpenFailed") && Number.isSafeInteger(v.count);
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "openViewPage" && typeof raw.tokenWellFormed === "boolean") return { type: "openViewPage", tokenWellFormed: raw.tokenWellFormed };
  if (raw.type === "tapToView") return { type: "tapToView" };
  if (raw.type === "answerViewOpen" && is_ViewOpenAnswer(raw.openAnswer)) return { type: "answerViewOpen", openAnswer: ({ kind: raw.openAnswer.kind, count: raw.openAnswer.count }) };
  if (raw.type === "answerViewImage" && (raw.image === "ImageShown" || raw.image === "ImageMissing" || raw.image === "ImageOtherDevice" || raw.image === "ImageGone" || raw.image === "ImageReplaced" || raw.image === "ImageUnreachable" || raw.image === "ImageFailed")) return { type: "answerViewImage", image: raw.image };
  if (raw.type === "askToReport") return { type: "askToReport" };
  if (raw.type === "keepViewing") return { type: "keepViewing" };
  if (raw.type === "sendReport") return { type: "sendReport" };
  if (raw.type === "answerReport" && (raw.report === "ReportDone" || raw.report === "ReportGone" || raw.report === "ReportOtherDevice" || raw.report === "ReportReplaced" || raw.report === "ReportUnreachable" || raw.report === "ReportFailed")) return { type: "answerReport", report: raw.report };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhotosViewPage | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.screen === "ViewOpening" || raw.screen === "ViewTap" || raw.screen === "ViewShowing" || raw.screen === "ViewConfirmReport" || raw.screen === "ViewReported" || raw.screen === "ViewOtherDevice" || raw.screen === "ViewGone" || raw.screen === "ViewReplaced") && (raw.pending === "ViewIdle" || raw.pending === "ViewOpeningLink" || raw.pending === "ViewLoadingPhotos" || raw.pending === "ViewReporting") && (raw.error === "ViewNoError" || raw.error === "ViewUnreachable" || raw.error === "ViewRequestFailed") && typeof raw.linkHeld === "boolean" && typeof raw.opened === "boolean" && Number.isSafeInteger(raw.count) && Number.isSafeInteger(raw.loaded) && Number.isSafeInteger(raw.missing) && typeof raw.reportLost === "boolean" && Object.keys(raw).length === 9)) return undefined;
  const parsed: PhotosViewPage = ({ screen: raw.screen, pending: raw.pending, error: raw.error, linkHeld: raw.linkHeld, opened: raw.opened, count: raw.count, loaded: raw.loaded, missing: raw.missing, reportLost: raw.reportLost });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotosViewPage {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_photosViewPage(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_photosViewPage(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_photosViewPage((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
