// GENERATED from spec/photosMinePage.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
export type HoldingsPending = "HoldingsIdle" | "HoldingsReading" | "HoldingsTakingBack";
/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
export type HoldingsNotice = "HoldingsNoNotice" | "HoldingsUnreachable" | "HoldingsFailed";
/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
export type HoldingsScreen = "HoldingsOpening" | "HoldingsList" | "HoldingsEmpty" | "HoldingsTimedOut" | "HoldingsUnavailable" | "HoldingsOtherPhone" | "HoldingsOpenFailed";
/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
export interface PhotoHoldingsPage { screen: HoldingsScreen; pending: HoldingsPending; notice: HoldingsNotice; linkHeld: boolean; photos: number; grants: number; takenBack: number }
/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
export type OpenKind = "OpenListed" | "OpenUnavailable" | "OpenTimedOut" | "OpenOtherPhone" | "OpenUnreachable" | "OpenFailed";
/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
export interface OpenAnswer { kind: OpenKind; photos: number; grants: number }
/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
export type GrantWire = "WireAsked" | "WireChecking" | "WireReady" | "WireOpened" | "WireTakenBack" | "WireUnknown";
/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
export type GrantAccess = "GrantAsked" | "GrantChecking" | "GrantReady" | "GrantShared" | "GrantWasTakenBack";
/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
export type GrantMark = "GrantOpen" | "GrantTakingBack" | "GrantTakenBack" | "GrantClosed";
/** Story: See which matches have my photos and take one back / Each photo shows its image only from its own answer (spec/photosMinePage.md) */
export type PhotoTile = "TileLoading" | "TileShown" | "TileMissing";
/** Story: See which matches have my photos and take one back / Each photo shows its image only from its own answer (spec/photosMinePage.md) */
export type ImageKind = "ImageShown" | "ImageMissing" | "ImageTimedOut" | "ImageUnavailable" | "ImageOtherPhone";
/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
export type TakeBackKind = "TakeBackDone" | "TakeBackNothingOpen" | "TakeBackTimedOut" | "TakeBackUnavailable" | "TakeBackOtherPhone" | "TakeBackUnreachable" | "TakeBackFailed";

/** One variant per transition in the spec. */
export type Event =
  | { type: "openHoldingsPage"; tokenWellFormed: boolean }
  | { type: "retryOpen" }
  | { type: "answerOpen"; opened: OpenAnswer }
  | { type: "answerImage"; imageAnswer: ImageKind }
  | { type: "takeBack" }
  | { type: "reopenAfterTakeBack" }
  | { type: "answerTakeBack"; takeBackAnswer: TakeBackKind };

/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
export const holdingsPhotoMax: number = 6;
/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
export const initial: PhotoHoldingsPage = { screen: "HoldingsOpening", pending: "HoldingsIdle", notice: "HoldingsNoNotice", linkHeld: false, photos: 0, grants: 0, takenBack: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoHoldingsPage): boolean {
  return alwaysReadingHoldsTheLink(current) && alwaysClosedScreensDropTheLink(current) && alwaysListHasAPhotoAndTheLink(current) && alwaysOnlyTheListHasPhotos(current) && alwaysRetryHoldsTheLink(current) && alwaysTakeBackOnlyOnTheList(current) && alwaysCountsNeverNegative(current) && alwaysNoticeOnlyWithTheLink(current);
}

/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
//@ pure
export function canOpenHoldingsPage(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsOpening" && page.pending === "HoldingsIdle" && !page.linkHeld;
}

/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
//@ pure
export function openHoldingsPage(page: PhotoHoldingsPage, tokenWellFormed: boolean): PhotoHoldingsPage {
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> alwaysReadingHoldsTheLink(\result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> alwaysClosedScreensDropTheLink(\result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> alwaysListHasAPhotoAndTheLink(\result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> alwaysOnlyTheListHasPhotos(\result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> alwaysRetryHoldsTheLink(\result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> alwaysTakeBackOnlyOnTheList(\result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> alwaysCountsNeverNegative(\result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> alwaysNoticeOnlyWithTheLink(\result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> stepReopenOnlyAfterATakeBack(page, "openHoldingsPage", \result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> stepOneTakeBackAtATime(page, "openHoldingsPage", \result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> stepTakenBackOnlyFromTheAnswer(page, "openHoldingsPage", \result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> stepSharesNeverGrow(page, "openHoldingsPage", \result)
  //@ ensures (inv(page) && canOpenHoldingsPage(page)) ==> stepClosedLinkNeverReopens(page, \result)
  return tokenWellFormed ? ({ ...page, pending: "HoldingsReading", linkHeld: true } as PhotoHoldingsPage) : ({ ...page, screen: "HoldingsUnavailable", linkHeld: false } as PhotoHoldingsPage);
}

/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
//@ pure
export function holdingsClosed(screen: HoldingsScreen): boolean {
  return screen === "HoldingsEmpty" || screen === "HoldingsTimedOut" || screen === "HoldingsUnavailable" || screen === "HoldingsOtherPhone";
}

/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
//@ pure
export function alwaysReadingHoldsTheLink(page: PhotoHoldingsPage): boolean {
  return !(page.pending === "HoldingsReading") || (page.linkHeld && page.screen === "HoldingsOpening");
}

/** Story: See which matches have my photos and take one back / The page reads the token from the fragment once and asks for the list only for a well-formed token (spec/photosMinePage.md) */
//@ pure
export function alwaysClosedScreensDropTheLink(page: PhotoHoldingsPage): boolean {
  return !holdingsClosed(page.screen) || (!page.linkHeld && page.pending === "HoldingsIdle");
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function photosShown(count: number): number {
  return count < 0 ? 0 : (count > holdingsPhotoMax ? holdingsPhotoMax : count);
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function grantsShown(photos: number, grants: number): number {
  return photosShown(photos) === 0 || grants < 0 ? 0 : grants;
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function closedScreenFor(kind: OpenKind): HoldingsScreen {
  return kind === "OpenTimedOut" ? "HoldingsTimedOut" : (kind === "OpenOtherPhone" ? "HoldingsOtherPhone" : "HoldingsUnavailable");
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function canAnswerOpen(page: PhotoHoldingsPage): boolean {
  return page.pending === "HoldingsReading";
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function canRetryOpen(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsOpenFailed" && page.pending === "HoldingsIdle" && page.linkHeld;
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function retryOpen(page: PhotoHoldingsPage): PhotoHoldingsPage {
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysReadingHoldsTheLink(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysClosedScreensDropTheLink(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysListHasAPhotoAndTheLink(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysOnlyTheListHasPhotos(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysRetryHoldsTheLink(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysTakeBackOnlyOnTheList(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysCountsNeverNegative(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> alwaysNoticeOnlyWithTheLink(\result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepReopenOnlyAfterATakeBack(page, "retryOpen", \result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepOneTakeBackAtATime(page, "retryOpen", \result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepTakenBackOnlyFromTheAnswer(page, "retryOpen", \result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepSharesNeverGrow(page, "retryOpen", \result)
  //@ ensures (inv(page) && canRetryOpen(page)) ==> stepClosedLinkNeverReopens(page, \result)
  return { ...page, screen: "HoldingsOpening", pending: "HoldingsReading", notice: "HoldingsNoNotice" };
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function lawPhotosShownFitTheLimit(count: number): boolean {
  //@ ensures \result === true
  return photosShown(count) >= 0 && photosShown(count) <= holdingsPhotoMax;
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function alwaysListHasAPhotoAndTheLink(page: PhotoHoldingsPage): boolean {
  return !(page.screen === "HoldingsList") || (page.photos >= 1 && page.photos <= holdingsPhotoMax && page.linkHeld);
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function alwaysOnlyTheListHasPhotos(page: PhotoHoldingsPage): boolean {
  return !(page.screen !== "HoldingsList") || (page.photos === 0 && page.grants === 0 && page.takenBack === 0);
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function alwaysRetryHoldsTheLink(page: PhotoHoldingsPage): boolean {
  return !(page.screen === "HoldingsOpenFailed") || (page.linkHeld && page.notice !== "HoldingsNoNotice");
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function answerOpen(page: PhotoHoldingsPage, opened: OpenAnswer): PhotoHoldingsPage {
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysReadingHoldsTheLink(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysClosedScreensDropTheLink(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysListHasAPhotoAndTheLink(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysOnlyTheListHasPhotos(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysRetryHoldsTheLink(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysTakeBackOnlyOnTheList(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysCountsNeverNegative(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> alwaysNoticeOnlyWithTheLink(\result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepReopenOnlyAfterATakeBack(page, "answerOpen", \result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepOneTakeBackAtATime(page, "answerOpen", \result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepTakenBackOnlyFromTheAnswer(page, "answerOpen", \result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepSharesNeverGrow(page, "answerOpen", \result)
  //@ ensures (inv(page) && canAnswerOpen(page)) ==> stepClosedLinkNeverReopens(page, \result)
  const local_0: PhotoHoldingsPage = { ...page, pending: "HoldingsIdle", notice: "HoldingsNoNotice" };
  const local_1 = photosShown(opened.photos);
  return opened.kind === "OpenListed" && local_1 >= 1 ? ({ ...local_0, screen: "HoldingsList", photos: local_1, grants: grantsShown(opened.photos, opened.grants), takenBack: 0 } as PhotoHoldingsPage) : (opened.kind === "OpenListed" ? ({ ...local_0, screen: "HoldingsEmpty", linkHeld: false, photos: 0, grants: 0, takenBack: 0 } as PhotoHoldingsPage) : (opened.kind === "OpenUnreachable" ? ({ ...local_0, screen: "HoldingsOpenFailed", notice: "HoldingsUnreachable" } as PhotoHoldingsPage) : (opened.kind === "OpenFailed" ? ({ ...local_0, screen: "HoldingsOpenFailed", notice: "HoldingsFailed" } as PhotoHoldingsPage) : ({ ...local_0, screen: closedScreenFor(opened.kind), linkHeld: false, photos: 0, grants: 0, takenBack: 0 } as PhotoHoldingsPage))));
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function lawNoPhotoMeansNoShare(grants: number): boolean {
  //@ ensures \result === true
  return grantsShown(0, grants) === 0;
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function lawOnlyAListOpensTheList(page: PhotoHoldingsPage, opened: OpenAnswer): boolean {
  //@ ensures \result === true
  return !(canAnswerOpen(page) && answerOpen(page, opened).screen === "HoldingsList") || opened.kind === "OpenListed";
}

/** Story: See which matches have my photos and take one back / The open answer decides between the list, the empty list, a closed link and a retry (spec/photosMinePage.md) */
//@ pure
export function lawRetryKindsKeepTheLink(page: PhotoHoldingsPage, opened: OpenAnswer): boolean {
  //@ ensures \result === true
  return !(canAnswerOpen(page) && page.linkHeld && (opened.kind === "OpenUnreachable" || opened.kind === "OpenFailed")) || (answerOpen(page, opened).linkHeld === page.linkHeld && canRetryOpen(answerOpen(page, opened)));
}

/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
//@ pure
export function grantAccessOf(wire: GrantWire): GrantAccess {
  return wire === "WireAsked" ? "GrantAsked" : (wire === "WireChecking" ? "GrantChecking" : (wire === "WireReady" || wire === "WireOpened" ? "GrantReady" : (wire === "WireTakenBack" ? "GrantWasTakenBack" : "GrantShared")));
}

/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
//@ pure
export function grantCanBeTakenBack(access: GrantAccess): boolean {
  return access !== "GrantWasTakenBack";
}

/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
//@ pure
export function grantMarkOnOpen(access: GrantAccess): GrantMark {
  return grantCanBeTakenBack(access) ? "GrantOpen" : "GrantTakenBack";
}

/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
//@ pure
export function lawOpenedLooksLikeReady(wire: GrantWire): boolean {
  //@ ensures \result === true
  return (wire === "WireOpened" || wire === "WireReady") === (grantAccessOf(wire) === "GrantReady");
}

/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
//@ pure
export function lawEveryWireStateShowsAShare(wire: GrantWire): boolean {
  //@ ensures \result === true
  return !(grantAccessOf(wire) !== "GrantWasTakenBack") || grantCanBeTakenBack(grantAccessOf(wire));
}

/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
//@ pure
export function lawOnlyTakenBackOnTheWireShowsTakenBack(wire: GrantWire): boolean {
  //@ ensures \result === true
  return (grantAccessOf(wire) === "GrantWasTakenBack") === (wire === "WireTakenBack");
}

/** Story: See which matches have my photos and take one back / Each share shows who has the photo and how far the offer is, and never whether it was opened (spec/photosMinePage.md) */
//@ pure
export function lawTakenBackShareOffersNothing(access: GrantAccess): boolean {
  //@ ensures \result === true
  return (access === "GrantWasTakenBack") === (grantMarkOnOpen(access) === "GrantTakenBack");
}

/** Story: See which matches have my photos and take one back / Each photo shows its image only from its own answer (spec/photosMinePage.md) */
//@ pure
export function photoTileFor(kind: ImageKind): PhotoTile {
  return kind === "ImageShown" ? "TileShown" : "TileMissing";
}

/** Story: See which matches have my photos and take one back / Each photo shows its image only from its own answer (spec/photosMinePage.md) */
//@ pure
export function imageClosesThePage(kind: ImageKind): boolean {
  return kind === "ImageTimedOut" || kind === "ImageUnavailable" || kind === "ImageOtherPhone";
}

/** Story: See which matches have my photos and take one back / Each photo shows its image only from its own answer (spec/photosMinePage.md) */
//@ pure
export function canAnswerImage(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsList";
}

/** Story: See which matches have my photos and take one back / Each photo shows its image only from its own answer (spec/photosMinePage.md) */
//@ pure
export function answerImage(page: PhotoHoldingsPage, imageAnswer: ImageKind): PhotoHoldingsPage {
  //@ ensures (inv(page) && canAnswerImage(page)) ==> alwaysReadingHoldsTheLink(\result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> alwaysClosedScreensDropTheLink(\result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> alwaysListHasAPhotoAndTheLink(\result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> alwaysOnlyTheListHasPhotos(\result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> alwaysRetryHoldsTheLink(\result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> alwaysTakeBackOnlyOnTheList(\result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> alwaysCountsNeverNegative(\result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> alwaysNoticeOnlyWithTheLink(\result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> stepReopenOnlyAfterATakeBack(page, "answerImage", \result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> stepOneTakeBackAtATime(page, "answerImage", \result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> stepTakenBackOnlyFromTheAnswer(page, "answerImage", \result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> stepSharesNeverGrow(page, "answerImage", \result)
  //@ ensures (inv(page) && canAnswerImage(page)) ==> stepClosedLinkNeverReopens(page, \result)
  const local_2: PhotoHoldingsPage = { ...page, pending: "HoldingsIdle", notice: "HoldingsNoNotice", linkHeld: false, photos: 0, grants: 0, takenBack: 0 };
  return imageAnswer === "ImageTimedOut" ? ({ ...local_2, screen: "HoldingsTimedOut" } as PhotoHoldingsPage) : (imageAnswer === "ImageUnavailable" ? ({ ...local_2, screen: "HoldingsUnavailable" } as PhotoHoldingsPage) : (imageAnswer === "ImageOtherPhone" ? ({ ...local_2, screen: "HoldingsOtherPhone" } as PhotoHoldingsPage) : page));
}

/** Story: See which matches have my photos and take one back / Each photo shows its image only from its own answer (spec/photosMinePage.md) */
//@ pure
export function lawOnlyAnImageShowsATile(kind: ImageKind): boolean {
  //@ ensures \result === true
  return (photoTileFor(kind) === "TileShown") === (kind === "ImageShown");
}

/** Story: See which matches have my photos and take one back / Each photo shows its image only from its own answer (spec/photosMinePage.md) */
//@ pure
export function lawAMissingImageKeepsThePage(page: PhotoHoldingsPage, imageAnswer: ImageKind): boolean {
  //@ ensures \result === true
  return !(!imageClosesThePage(imageAnswer)) || equal_photosMinePage(answerImage(page, imageAnswer), page);
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function grantMarkAfter(kind: TakeBackKind): GrantMark {
  return kind === "TakeBackDone" ? "GrantTakenBack" : (kind === "TakeBackNothingOpen" ? "GrantClosed" : "GrantOpen");
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function grantOffersTakeBack(page: PhotoHoldingsPage, mark: GrantMark): boolean {
  return page.screen === "HoldingsList" && page.pending === "HoldingsIdle" && page.linkHeld && page.grants >= 1 && mark === "GrantOpen";
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function canTakeBack(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsList" && page.pending === "HoldingsIdle" && page.linkHeld && page.grants >= 1;
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function takeBack(page: PhotoHoldingsPage): PhotoHoldingsPage {
  //@ ensures (inv(page) && canTakeBack(page)) ==> alwaysReadingHoldsTheLink(\result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> alwaysClosedScreensDropTheLink(\result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> alwaysListHasAPhotoAndTheLink(\result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> alwaysOnlyTheListHasPhotos(\result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> alwaysRetryHoldsTheLink(\result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> alwaysTakeBackOnlyOnTheList(\result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> alwaysCountsNeverNegative(\result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> alwaysNoticeOnlyWithTheLink(\result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> stepReopenOnlyAfterATakeBack(page, "takeBack", \result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> stepOneTakeBackAtATime(page, "takeBack", \result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> stepTakenBackOnlyFromTheAnswer(page, "takeBack", \result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> stepSharesNeverGrow(page, "takeBack", \result)
  //@ ensures (inv(page) && canTakeBack(page)) ==> stepClosedLinkNeverReopens(page, \result)
  return { ...page, pending: "HoldingsTakingBack", notice: "HoldingsNoNotice" };
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function canAnswerTakeBack(page: PhotoHoldingsPage): boolean {
  return page.pending === "HoldingsTakingBack";
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function canReopenAfterTakeBack(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsList" && page.pending === "HoldingsIdle" && page.linkHeld && page.takenBack >= 1;
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function reopenAfterTakeBack(page: PhotoHoldingsPage): PhotoHoldingsPage {
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> alwaysReadingHoldsTheLink(\result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> alwaysClosedScreensDropTheLink(\result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> alwaysListHasAPhotoAndTheLink(\result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> alwaysOnlyTheListHasPhotos(\result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> alwaysRetryHoldsTheLink(\result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> alwaysTakeBackOnlyOnTheList(\result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> alwaysCountsNeverNegative(\result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> alwaysNoticeOnlyWithTheLink(\result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> stepReopenOnlyAfterATakeBack(page, "reopenAfterTakeBack", \result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> stepOneTakeBackAtATime(page, "reopenAfterTakeBack", \result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> stepTakenBackOnlyFromTheAnswer(page, "reopenAfterTakeBack", \result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> stepSharesNeverGrow(page, "reopenAfterTakeBack", \result)
  //@ ensures (inv(page) && canReopenAfterTakeBack(page)) ==> stepClosedLinkNeverReopens(page, \result)
  return { ...page, screen: "HoldingsOpening", pending: "HoldingsReading", notice: "HoldingsNoNotice", photos: 0, grants: 0, takenBack: 0 };
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function stepReopenOnlyAfterATakeBack(before: PhotoHoldingsPage, via: string, after: PhotoHoldingsPage): boolean {
  return !(before.screen === "HoldingsList" && after.screen === "HoldingsOpening") || (via === "reopenAfterTakeBack" && before.takenBack >= 1);
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function alwaysTakeBackOnlyOnTheList(page: PhotoHoldingsPage): boolean {
  return !(page.pending === "HoldingsTakingBack") || (page.screen === "HoldingsList" && page.linkHeld && page.grants >= 1);
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function alwaysCountsNeverNegative(page: PhotoHoldingsPage): boolean {
  return page.photos >= 0 && page.grants >= 0 && page.takenBack >= 0;
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function alwaysNoticeOnlyWithTheLink(page: PhotoHoldingsPage): boolean {
  return !(page.notice !== "HoldingsNoNotice") || (page.linkHeld && (page.screen === "HoldingsList" || page.screen === "HoldingsOpenFailed"));
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function stepOneTakeBackAtATime(before: PhotoHoldingsPage, via: string, after: PhotoHoldingsPage): boolean {
  return !(after.pending === "HoldingsTakingBack" && before.pending !== "HoldingsTakingBack") || (via === "takeBack" && before.pending === "HoldingsIdle");
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function stepTakenBackOnlyFromTheAnswer(before: PhotoHoldingsPage, via: string, after: PhotoHoldingsPage): boolean {
  return !(after.takenBack > before.takenBack) || (via === "answerTakeBack" && before.pending === "HoldingsTakingBack" && after.takenBack === exact_photosMinePage(before.takenBack + 1));
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function stepSharesNeverGrow(before: PhotoHoldingsPage, via: string, after: PhotoHoldingsPage): boolean {
  return !(before.screen === "HoldingsList" && after.screen === "HoldingsList") || after.grants <= before.grants;
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function lawOnlyTheServerMarksTakenBack(kind: TakeBackKind): boolean {
  //@ ensures \result === true
  return (grantMarkAfter(kind) === "GrantTakenBack") === (kind === "TakeBackDone");
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function lawAFailedTakeBackOffersItAgain(kind: TakeBackKind): boolean {
  //@ ensures \result === true
  return !(kind === "TakeBackUnreachable" || kind === "TakeBackFailed") || grantMarkAfter(kind) === "GrantOpen";
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function lawNoTakeBackWhileOneRuns(page: PhotoHoldingsPage, mark: GrantMark): boolean {
  //@ ensures \result === true
  return !(page.pending === "HoldingsTakingBack") || !grantOffersTakeBack(page, mark);
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function lawATakeBackNeedsAShare(page: PhotoHoldingsPage): boolean {
  //@ ensures \result === true
  return !canTakeBack(page) || page.grants >= 1;
}

/** Story: See which matches have my photos and take one back / The person takes back one share at a time, and only the server's answer marks it taken back (spec/photosMinePage.md) */
//@ pure
export function answerTakeBack(page: PhotoHoldingsPage, takeBackAnswer: TakeBackKind): PhotoHoldingsPage {
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> alwaysReadingHoldsTheLink(\result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> alwaysClosedScreensDropTheLink(\result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> alwaysListHasAPhotoAndTheLink(\result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> alwaysOnlyTheListHasPhotos(\result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> alwaysRetryHoldsTheLink(\result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> alwaysTakeBackOnlyOnTheList(\result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> alwaysCountsNeverNegative(\result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> alwaysNoticeOnlyWithTheLink(\result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> stepReopenOnlyAfterATakeBack(page, "answerTakeBack", \result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> stepOneTakeBackAtATime(page, "answerTakeBack", \result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> stepTakenBackOnlyFromTheAnswer(page, "answerTakeBack", \result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> stepSharesNeverGrow(page, "answerTakeBack", \result)
  //@ ensures (inv(page) && canAnswerTakeBack(page)) ==> stepClosedLinkNeverReopens(page, \result)
  const local_3: PhotoHoldingsPage = { ...page, pending: "HoldingsIdle", notice: "HoldingsNoNotice" };
  const local_4: PhotoHoldingsPage = { ...local_3, linkHeld: false, photos: 0, grants: 0, takenBack: 0 };
  const local_5 = page.grants >= 1 ? exact_photosMinePage(page.grants - 1) : 0;
  return takeBackAnswer === "TakeBackDone" ? ({ ...local_3, grants: local_5, takenBack: exact_photosMinePage(page.takenBack + 1) } as PhotoHoldingsPage) : (takeBackAnswer === "TakeBackNothingOpen" ? ({ ...local_3, grants: local_5 } as PhotoHoldingsPage) : (takeBackAnswer === "TakeBackTimedOut" ? ({ ...local_4, screen: "HoldingsTimedOut" } as PhotoHoldingsPage) : (takeBackAnswer === "TakeBackUnavailable" ? ({ ...local_4, screen: "HoldingsUnavailable" } as PhotoHoldingsPage) : (takeBackAnswer === "TakeBackOtherPhone" ? ({ ...local_4, screen: "HoldingsOtherPhone" } as PhotoHoldingsPage) : (takeBackAnswer === "TakeBackUnreachable" ? ({ ...local_3, notice: "HoldingsUnreachable" } as PhotoHoldingsPage) : ({ ...local_3, notice: "HoldingsFailed" } as PhotoHoldingsPage))))));
}

/** Story: A timed-out or moved link shows nothing / A closed link never opens again on the page (spec/photosMinePage.md) */
//@ pure
export function holdingsActionOffered(page: PhotoHoldingsPage): boolean {
  return canTakeBack(page) || canRetryOpen(page);
}

/** Story: A timed-out or moved link shows nothing / A closed link never opens again on the page (spec/photosMinePage.md) */
//@ pure
export function stepClosedLinkNeverReopens(before: PhotoHoldingsPage, after: PhotoHoldingsPage): boolean {
  return !holdingsClosed(before.screen) || equal_photosMinePage(after, before);
}

/** Story: A timed-out or moved link shows nothing / A closed link never opens again on the page (spec/photosMinePage.md) */
//@ pure
export function lawClosedScreensOfferNothing(page: PhotoHoldingsPage): boolean {
  //@ ensures \result === true
  return !holdingsClosed(page.screen) || !holdingsActionOffered(page);
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesList(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsList" && page.grants >= 1;
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesListNobodyHasThem(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsList" && page.grants === 0 && page.takenBack === 0;
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesEmpty(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsEmpty";
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesTimedOut(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsTimedOut";
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesUnavailable(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsUnavailable";
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesOtherPhone(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsOtherPhone";
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesOpenUnreachable(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsOpenFailed" && page.notice === "HoldingsUnreachable";
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesOpenFailed(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsOpenFailed" && page.notice === "HoldingsFailed";
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesTakingBack(page: PhotoHoldingsPage): boolean {
  return page.pending === "HoldingsTakingBack";
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesTakenBack(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsList" && page.takenBack >= 1 && page.grants >= 1;
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesAllTakenBack(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsList" && page.takenBack >= 1 && page.grants === 0;
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesTakeBackUnreachable(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsList" && page.notice === "HoldingsUnreachable";
}

/** Story: Reach every outcome / A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to (spec/photosMinePage.md) */
//@ pure
export function sometimesTakeBackFailed(page: PhotoHoldingsPage): boolean {
  return page.screen === "HoldingsList" && page.notice === "HoldingsFailed" && canTakeBack(page);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoHoldingsPage, event: Event): boolean {
  if (event.type === "openHoldingsPage") return canOpenHoldingsPage(current);
  if (event.type === "retryOpen") return canRetryOpen(current);
  if (event.type === "answerOpen") return canAnswerOpen(current);
  if (event.type === "answerImage") return canAnswerImage(current);
  if (event.type === "takeBack") return canTakeBack(current);
  if (event.type === "reopenAfterTakeBack") return canReopenAfterTakeBack(current);
  if (event.type === "answerTakeBack") return canAnswerTakeBack(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoHoldingsPage, event: Event): PhotoHoldingsPage {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openHoldingsPage") return canOpenHoldingsPage(current) ? openHoldingsPage(current, event.tokenWellFormed) : current;
  if (event.type === "retryOpen") return canRetryOpen(current) ? retryOpen(current) : current;
  if (event.type === "answerOpen") return canAnswerOpen(current) ? answerOpen(current, event.opened) : current;
  if (event.type === "answerImage") return canAnswerImage(current) ? answerImage(current, event.imageAnswer) : current;
  if (event.type === "takeBack") return canTakeBack(current) ? takeBack(current) : current;
  if (event.type === "reopenAfterTakeBack") return canReopenAfterTakeBack(current) ? reopenAfterTakeBack(current) : current;
  if (event.type === "answerTakeBack") return canAnswerTakeBack(current) ? answerTakeBack(current, event.takeBackAnswer) : current;
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
  const is_OpenAnswer = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && (v.kind === "OpenListed" || v.kind === "OpenUnavailable" || v.kind === "OpenTimedOut" || v.kind === "OpenOtherPhone" || v.kind === "OpenUnreachable" || v.kind === "OpenFailed") && Number.isSafeInteger(v.photos) && Number.isSafeInteger(v.grants);
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "openHoldingsPage" && typeof raw.tokenWellFormed === "boolean") return { type: "openHoldingsPage", tokenWellFormed: raw.tokenWellFormed };
  if (raw.type === "retryOpen") return { type: "retryOpen" };
  if (raw.type === "answerOpen" && is_OpenAnswer(raw.opened)) return { type: "answerOpen", opened: ({ kind: raw.opened.kind, photos: raw.opened.photos, grants: raw.opened.grants }) };
  if (raw.type === "answerImage" && (raw.imageAnswer === "ImageShown" || raw.imageAnswer === "ImageMissing" || raw.imageAnswer === "ImageTimedOut" || raw.imageAnswer === "ImageUnavailable" || raw.imageAnswer === "ImageOtherPhone")) return { type: "answerImage", imageAnswer: raw.imageAnswer };
  if (raw.type === "takeBack") return { type: "takeBack" };
  if (raw.type === "reopenAfterTakeBack") return { type: "reopenAfterTakeBack" };
  if (raw.type === "answerTakeBack" && (raw.takeBackAnswer === "TakeBackDone" || raw.takeBackAnswer === "TakeBackNothingOpen" || raw.takeBackAnswer === "TakeBackTimedOut" || raw.takeBackAnswer === "TakeBackUnavailable" || raw.takeBackAnswer === "TakeBackOtherPhone" || raw.takeBackAnswer === "TakeBackUnreachable" || raw.takeBackAnswer === "TakeBackFailed")) return { type: "answerTakeBack", takeBackAnswer: raw.takeBackAnswer };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhotoHoldingsPage | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.screen === "HoldingsOpening" || raw.screen === "HoldingsList" || raw.screen === "HoldingsEmpty" || raw.screen === "HoldingsTimedOut" || raw.screen === "HoldingsUnavailable" || raw.screen === "HoldingsOtherPhone" || raw.screen === "HoldingsOpenFailed") && (raw.pending === "HoldingsIdle" || raw.pending === "HoldingsReading" || raw.pending === "HoldingsTakingBack") && (raw.notice === "HoldingsNoNotice" || raw.notice === "HoldingsUnreachable" || raw.notice === "HoldingsFailed") && typeof raw.linkHeld === "boolean" && Number.isSafeInteger(raw.photos) && Number.isSafeInteger(raw.grants) && Number.isSafeInteger(raw.takenBack) && Object.keys(raw).length === 7)) return undefined;
  const parsed: PhotoHoldingsPage = ({ screen: raw.screen, pending: raw.pending, notice: raw.notice, linkHeld: raw.linkHeld, photos: raw.photos, grants: raw.grants, takenBack: raw.takenBack });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoHoldingsPage {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_photosMinePage(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_photosMinePage(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_photosMinePage((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
