// GENERATED from spec/photoRelayReview.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
export type ReviewState = "ScreeningReview" | "PendingReview" | "ApprovedReview" | "RejectedReview" | "RevokedReview" | "ExpiredReview";
/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
export type SelectionPhase = "Selecting" | "CheckingParties" | "CheckingPhoto" | "ResolvingNotice" | "ReadyToStore" | "StoredSelection" | "SelectionRefused";
/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
export interface PhotoSelection { phase: SelectionPhase; review: ReviewState }
/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
export type ScreenVerdict = "ScreenClean" | "ScreenFlagged" | "ScreenUnusable" | "ScreenCannotRun";
/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
export type ScreenOutcome = "ReleasePhoto" | "HoldForStaff" | "RetryScreen";
/** Story: Choose one photo and let an automatic check clear it / A designated reviewer can approve a current pending item (spec/photoRelayReview.md) */
export type ReviewChoice = "ApprovePhoto" | "RejectPhoto" | "KeepPending";

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkSelection"; inputValid: boolean; explicitConsent: boolean }
  | { type: "checkParties"; senderMatches: boolean; differentPeople: boolean; differentMembers: boolean }
  | { type: "checkPhoto"; currentPhoto: boolean }
  | { type: "resolveNotice"; readyNotice: boolean }
  | { type: "recordSelection" }
  | { type: "screenSelection"; screenOutcome: ScreenOutcome; now: number; deadline: number }
  | { type: "recordReview"; choice: ReviewChoice; reviewerAuthorized: boolean; currentItem: boolean; itemLive: boolean }
  | { type: "revokeSelection"; ownerMatches: boolean }
  | { type: "expireSelection"; now: number; deadline: number };

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
export const photoScreenCleanBelow: number = 100;
/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
export const photoScreenRetryMax: number = 5;
/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
export const relayItemTtlMs: number = 43200000;
/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
export const initial: PhotoSelection = { phase: "Selecting", review: "ScreeningReview" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoSelection): boolean {
  return alwaysSelectionStartsScreening(current);
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function checkSelection(s: PhotoSelection, inputValid: boolean, explicitConsent: boolean): PhotoSelection {
  //@ ensures (inv(s) && canCheckSelection(s)) ==> alwaysSelectionStartsScreening(\result)
  //@ ensures (inv(s) && canCheckSelection(s)) ==> stepOnlyTheScreenLeavesTheCheck(s, "checkSelection", \result)
  //@ ensures (inv(s) && canCheckSelection(s)) ==> stepOnlyReviewApproves(s, "checkSelection", \result)
  //@ ensures (inv(s) && canCheckSelection(s)) ==> stepRevocationIsFinal(s, \result)
  //@ ensures (inv(s) && canCheckSelection(s)) ==> stepOnlyDeadlineExpires(s, "checkSelection", \result)
  //@ ensures (inv(s) && canCheckSelection(s)) ==> stepExpiredStaysUndelivered(s, \result)
  return { ...s, phase: inputValid && explicitConsent ? "CheckingParties" : "SelectionRefused" };
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function canCheckParties(s: PhotoSelection): boolean {
  return s.phase === "CheckingParties";
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function checkParties(s: PhotoSelection, senderMatches: boolean, differentPeople: boolean, differentMembers: boolean): PhotoSelection {
  //@ ensures (inv(s) && canCheckParties(s)) ==> alwaysSelectionStartsScreening(\result)
  //@ ensures (inv(s) && canCheckParties(s)) ==> stepOnlyTheScreenLeavesTheCheck(s, "checkParties", \result)
  //@ ensures (inv(s) && canCheckParties(s)) ==> stepOnlyReviewApproves(s, "checkParties", \result)
  //@ ensures (inv(s) && canCheckParties(s)) ==> stepRevocationIsFinal(s, \result)
  //@ ensures (inv(s) && canCheckParties(s)) ==> stepOnlyDeadlineExpires(s, "checkParties", \result)
  //@ ensures (inv(s) && canCheckParties(s)) ==> stepExpiredStaysUndelivered(s, \result)
  return { ...s, phase: senderMatches && differentPeople && differentMembers ? "CheckingPhoto" : "SelectionRefused" };
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function canCheckPhoto(s: PhotoSelection): boolean {
  return s.phase === "CheckingPhoto";
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function checkPhoto(s: PhotoSelection, currentPhoto: boolean): PhotoSelection {
  //@ ensures (inv(s) && canCheckPhoto(s)) ==> alwaysSelectionStartsScreening(\result)
  //@ ensures (inv(s) && canCheckPhoto(s)) ==> stepOnlyTheScreenLeavesTheCheck(s, "checkPhoto", \result)
  //@ ensures (inv(s) && canCheckPhoto(s)) ==> stepOnlyReviewApproves(s, "checkPhoto", \result)
  //@ ensures (inv(s) && canCheckPhoto(s)) ==> stepRevocationIsFinal(s, \result)
  //@ ensures (inv(s) && canCheckPhoto(s)) ==> stepOnlyDeadlineExpires(s, "checkPhoto", \result)
  //@ ensures (inv(s) && canCheckPhoto(s)) ==> stepExpiredStaysUndelivered(s, \result)
  return { ...s, phase: currentPhoto ? "ResolvingNotice" : "SelectionRefused" };
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function canResolveNotice(s: PhotoSelection): boolean {
  return s.phase === "ResolvingNotice";
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function resolveNotice(s: PhotoSelection, readyNotice: boolean): PhotoSelection {
  //@ ensures (inv(s) && canResolveNotice(s)) ==> alwaysSelectionStartsScreening(\result)
  //@ ensures (inv(s) && canResolveNotice(s)) ==> stepOnlyTheScreenLeavesTheCheck(s, "resolveNotice", \result)
  //@ ensures (inv(s) && canResolveNotice(s)) ==> stepOnlyReviewApproves(s, "resolveNotice", \result)
  //@ ensures (inv(s) && canResolveNotice(s)) ==> stepRevocationIsFinal(s, \result)
  //@ ensures (inv(s) && canResolveNotice(s)) ==> stepOnlyDeadlineExpires(s, "resolveNotice", \result)
  //@ ensures (inv(s) && canResolveNotice(s)) ==> stepExpiredStaysUndelivered(s, \result)
  return { ...s, phase: readyNotice ? "ReadyToStore" : "SelectionRefused" };
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function canRecordSelection(s: PhotoSelection): boolean {
  return s.phase === "ReadyToStore";
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function recordSelection(s: PhotoSelection): PhotoSelection {
  //@ ensures (inv(s) && canRecordSelection(s)) ==> alwaysSelectionStartsScreening(\result)
  //@ ensures (inv(s) && canRecordSelection(s)) ==> stepOnlyTheScreenLeavesTheCheck(s, "recordSelection", \result)
  //@ ensures (inv(s) && canRecordSelection(s)) ==> stepOnlyReviewApproves(s, "recordSelection", \result)
  //@ ensures (inv(s) && canRecordSelection(s)) ==> stepRevocationIsFinal(s, \result)
  //@ ensures (inv(s) && canRecordSelection(s)) ==> stepOnlyDeadlineExpires(s, "recordSelection", \result)
  //@ ensures (inv(s) && canRecordSelection(s)) ==> stepExpiredStaysUndelivered(s, \result)
  return { ...s, phase: "StoredSelection" };
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function alwaysSelectionStartsScreening(s: PhotoSelection): boolean {
  return !(s.phase !== "StoredSelection") || s.review === "ScreeningReview";
}

/** Story: Choose one photo and let an automatic check clear it / Select one eligible photo using the current notice (spec/photoRelayReview.md) */
//@ pure
export function canCheckSelection(s: PhotoSelection): boolean {
  return s.phase === "Selecting";
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function photoScreenRetryDelayMs(attempts: number): number {
  return attempts <= 0 ? 60000 : (attempts === 1 ? 300000 : (attempts === 2 ? 900000 : 3600000));
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function photoScreenVerdictFor(usable: boolean, answered: boolean, riskPerMille: number): ScreenVerdict {
  return !usable ? "ScreenUnusable" : (!answered || riskPerMille < 0 || riskPerMille > 1000 ? "ScreenCannotRun" : (riskPerMille < photoScreenCleanBelow ? "ScreenClean" : "ScreenFlagged"));
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function photoScreenOutcomeFor(verdict: ScreenVerdict, attempts: number): ScreenOutcome {
  return verdict === "ScreenClean" ? "ReleasePhoto" : (verdict === "ScreenFlagged" || verdict === "ScreenUnusable" ? "HoldForStaff" : (exact_photoRelayReview(attempts + 1) >= photoScreenRetryMax ? "HoldForStaff" : "RetryScreen"));
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function canScreenSelection(s: PhotoSelection, now: number, deadline: number): boolean {
  return s.phase === "StoredSelection" && s.review === "ScreeningReview" && now < deadline;
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function screenSelection(s: PhotoSelection, screenOutcome: ScreenOutcome, now: number, deadline: number): PhotoSelection {
  //@ ensures (inv(s) && canScreenSelection(s, now, deadline)) ==> alwaysSelectionStartsScreening(\result)
  //@ ensures (inv(s) && canScreenSelection(s, now, deadline)) ==> stepOnlyTheScreenLeavesTheCheck(s, "screenSelection", \result)
  //@ ensures (inv(s) && canScreenSelection(s, now, deadline)) ==> stepOnlyReviewApproves(s, "screenSelection", \result)
  //@ ensures (inv(s) && canScreenSelection(s, now, deadline)) ==> stepRevocationIsFinal(s, \result)
  //@ ensures (inv(s) && canScreenSelection(s, now, deadline)) ==> stepOnlyDeadlineExpires(s, "screenSelection", \result)
  //@ ensures (inv(s) && canScreenSelection(s, now, deadline)) ==> stepExpiredStaysUndelivered(s, \result)
  return { ...s, review: screenOutcome === "ReleasePhoto" ? "ApprovedReview" : (screenOutcome === "HoldForStaff" ? "PendingReview" : "ScreeningReview") };
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function lawRetryWaits(attempts: number): boolean {
  //@ ensures \result === true
  return photoScreenRetryDelayMs(attempts) > 0;
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function stepOnlyTheScreenLeavesTheCheck(before: PhotoSelection, via: string, after: PhotoSelection): boolean {
  return !(before.review === "ScreeningReview" && after.review !== "ScreeningReview") || (via === "screenSelection" || via === "revokeSelection" || via === "expireSelection");
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function sometimesScreening(s: PhotoSelection): boolean {
  return s.phase === "StoredSelection" && s.review === "ScreeningReview";
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function sometimesHeldForStaff(s: PhotoSelection): boolean {
  return s.phase === "StoredSelection" && s.review === "PendingReview";
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function lawOnlyACleanScreenReleases(verdict: ScreenVerdict, attempts: number): boolean {
  //@ ensures \result === true
  return !(photoScreenOutcomeFor(verdict, attempts) === "ReleasePhoto") || verdict === "ScreenClean";
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function lawAScreenThatCannotRunNeverReleases(attempts: number): boolean {
  //@ ensures \result === true
  return photoScreenOutcomeFor("ScreenCannotRun", attempts) !== "ReleasePhoto";
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function lawFlaggedPhotosGoToStaff(attempts: number): boolean {
  //@ ensures \result === true
  return photoScreenOutcomeFor("ScreenFlagged", attempts) === "HoldForStaff" && photoScreenOutcomeFor("ScreenUnusable", attempts) === "HoldForStaff";
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function lawRetriesEndAtStaff(attempts: number): boolean {
  //@ ensures \result === true
  return !(exact_photoRelayReview(attempts + 1) >= photoScreenRetryMax) || photoScreenOutcomeFor("ScreenCannotRun", attempts) === "HoldForStaff";
}

/** Story: Choose one photo and let an automatic check clear it / An automatic check screens each photo, and only a photo it does not clear goes to staff (spec/photoRelayReview.md) */
//@ pure
export function lawCleanNeedsAnAnswer(usable: boolean, riskPerMille: number): boolean {
  //@ ensures \result === true
  return photoScreenVerdictFor(usable, false, riskPerMille) !== "ScreenClean";
}

/** Story: Choose one photo and let an automatic check clear it / A designated reviewer can approve a current pending item (spec/photoRelayReview.md) */
//@ pure
export function photoReviewable(s: PhotoSelection): boolean {
  return s.phase === "StoredSelection" && (s.review === "PendingReview" || s.review === "ApprovedReview");
}

/** Story: Choose one photo and let an automatic check clear it / A designated reviewer can approve a current pending item (spec/photoRelayReview.md) */
//@ pure
export function reviewNeedsCurrent(choice: ReviewChoice): boolean {
  return choice === "ApprovePhoto";
}

/** Story: Choose one photo and let an automatic check clear it / A designated reviewer can approve a current pending item (spec/photoRelayReview.md) */
//@ pure
export function recordReview(s: PhotoSelection, choice: ReviewChoice, reviewerAuthorized: boolean, currentItem: boolean, itemLive: boolean): PhotoSelection {
  //@ ensures (inv(s) && canRecordReview(s, choice, reviewerAuthorized, currentItem, itemLive)) ==> alwaysSelectionStartsScreening(\result)
  //@ ensures (inv(s) && canRecordReview(s, choice, reviewerAuthorized, currentItem, itemLive)) ==> stepOnlyTheScreenLeavesTheCheck(s, "recordReview", \result)
  //@ ensures (inv(s) && canRecordReview(s, choice, reviewerAuthorized, currentItem, itemLive)) ==> stepOnlyReviewApproves(s, "recordReview", \result)
  //@ ensures (inv(s) && canRecordReview(s, choice, reviewerAuthorized, currentItem, itemLive)) ==> stepRevocationIsFinal(s, \result)
  //@ ensures (inv(s) && canRecordReview(s, choice, reviewerAuthorized, currentItem, itemLive)) ==> stepOnlyDeadlineExpires(s, "recordReview", \result)
  //@ ensures (inv(s) && canRecordReview(s, choice, reviewerAuthorized, currentItem, itemLive)) ==> stepExpiredStaysUndelivered(s, \result)
  return { ...s, review: choice === "ApprovePhoto" ? "ApprovedReview" : (s.review === "ApprovedReview" ? "RevokedReview" : "RejectedReview") };
}

/** Story: Choose one photo and let an automatic check clear it / A designated reviewer can approve a current pending item (spec/photoRelayReview.md) */
//@ pure
export function stepOnlyReviewApproves(before: PhotoSelection, via: string, after: PhotoSelection): boolean {
  return !(before.review !== "ApprovedReview" && after.review === "ApprovedReview") || (via === "recordReview" || via === "screenSelection");
}

/** Story: Choose one photo and let an automatic check clear it / A designated reviewer can approve a current pending item (spec/photoRelayReview.md) */
//@ pure
export function photoReviewMayProceed(s: PhotoSelection, choice: ReviewChoice, reviewerAuthorized: boolean, itemLive: boolean): boolean {
  return photoReviewable(s) && reviewerAuthorized && itemLive && (choice === "RejectPhoto" || (choice === "ApprovePhoto" && s.review === "PendingReview"));
}

/** Story: Choose one photo and let an automatic check clear it / A designated reviewer can approve a current pending item (spec/photoRelayReview.md) */
//@ pure
export function canRecordReview(s: PhotoSelection, choice: ReviewChoice, reviewerAuthorized: boolean, currentItem: boolean, itemLive: boolean): boolean {
  return photoReviewMayProceed(s, choice, reviewerAuthorized, itemLive) && (!reviewNeedsCurrent(choice) || currentItem);
}

/** Story: Choose one photo and let an automatic check clear it / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md) */
//@ pure
export function photoHeldForReview(s: PhotoSelection): boolean {
  return s.phase === "StoredSelection" && s.review === "PendingReview";
}

/** Story: Choose one photo and let an automatic check clear it / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md) */
//@ pure
export function canRevokeSelection(s: PhotoSelection, ownerMatches: boolean): boolean {
  return s.phase === "StoredSelection" && ownerMatches;
}

/** Story: Choose one photo and let an automatic check clear it / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md) */
//@ pure
export function revokeSelection(s: PhotoSelection, ownerMatches: boolean): PhotoSelection {
  //@ ensures (inv(s) && canRevokeSelection(s, ownerMatches)) ==> alwaysSelectionStartsScreening(\result)
  //@ ensures (inv(s) && canRevokeSelection(s, ownerMatches)) ==> stepOnlyTheScreenLeavesTheCheck(s, "revokeSelection", \result)
  //@ ensures (inv(s) && canRevokeSelection(s, ownerMatches)) ==> stepOnlyReviewApproves(s, "revokeSelection", \result)
  //@ ensures (inv(s) && canRevokeSelection(s, ownerMatches)) ==> stepRevocationIsFinal(s, \result)
  //@ ensures (inv(s) && canRevokeSelection(s, ownerMatches)) ==> stepOnlyDeadlineExpires(s, "revokeSelection", \result)
  //@ ensures (inv(s) && canRevokeSelection(s, ownerMatches)) ==> stepExpiredStaysUndelivered(s, \result)
  return { ...s, review: "RevokedReview" };
}

/** Story: Choose one photo and let an automatic check clear it / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md) */
//@ pure
export function stepRevocationIsFinal(before: PhotoSelection, after: PhotoSelection): boolean {
  return !(before.review === "RevokedReview") || after.review === "RevokedReview";
}

/** Story: Choose one photo and let an automatic check clear it / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md) */
//@ pure
export function sometimesApproved(s: PhotoSelection): boolean {
  return s.review === "ApprovedReview";
}

/** Story: Choose one photo and let an automatic check clear it / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md) */
//@ pure
export function sometimesRevoked(s: PhotoSelection): boolean {
  return s.review === "RevokedReview";
}

/** Story: Choose one photo and let an automatic check clear it / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md) */
//@ pure
export function reviewPreviewAllowed(s: PhotoSelection, reviewerAuthorized: boolean, itemLive: boolean): boolean {
  return photoHeldForReview(s) && reviewerAuthorized && itemLive;
}

/** Story: Choose one photo and let an automatic check clear it / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md) */
//@ pure
export function reviewAuthorizationCurrent(s: PhotoSelection, configured: boolean, reviewerAuthorized: boolean, itemLive: boolean, samePolicy: boolean): boolean {
  return photoReviewable(s) && configured && reviewerAuthorized && itemLive && samePolicy;
}

/** Story: Choose one photo and let an automatic check clear it / A photo that is not cleared by its deadline expires, and its offer settles (spec/photoRelayReview.md) */
//@ pure
export function canExpireSelection(s: PhotoSelection, now: number, deadline: number): boolean {
  return s.phase === "StoredSelection" && (s.review === "PendingReview" || s.review === "ScreeningReview") && now >= deadline;
}

/** Story: Choose one photo and let an automatic check clear it / A photo that is not cleared by its deadline expires, and its offer settles (spec/photoRelayReview.md) */
//@ pure
export function expireSelection(s: PhotoSelection, now: number, deadline: number): PhotoSelection {
  //@ ensures (inv(s) && canExpireSelection(s, now, deadline)) ==> alwaysSelectionStartsScreening(\result)
  //@ ensures (inv(s) && canExpireSelection(s, now, deadline)) ==> stepOnlyTheScreenLeavesTheCheck(s, "expireSelection", \result)
  //@ ensures (inv(s) && canExpireSelection(s, now, deadline)) ==> stepOnlyReviewApproves(s, "expireSelection", \result)
  //@ ensures (inv(s) && canExpireSelection(s, now, deadline)) ==> stepRevocationIsFinal(s, \result)
  //@ ensures (inv(s) && canExpireSelection(s, now, deadline)) ==> stepOnlyDeadlineExpires(s, "expireSelection", \result)
  //@ ensures (inv(s) && canExpireSelection(s, now, deadline)) ==> stepExpiredStaysUndelivered(s, \result)
  return { ...s, review: "ExpiredReview" };
}

/** Story: Choose one photo and let an automatic check clear it / A photo that is not cleared by its deadline expires, and its offer settles (spec/photoRelayReview.md) */
//@ pure
export function stepOnlyDeadlineExpires(before: PhotoSelection, via: string, after: PhotoSelection): boolean {
  return !(before.review !== "ExpiredReview" && after.review === "ExpiredReview") || via === "expireSelection";
}

/** Story: Choose one photo and let an automatic check clear it / A photo that is not cleared by its deadline expires, and its offer settles (spec/photoRelayReview.md) */
//@ pure
export function stepExpiredStaysUndelivered(before: PhotoSelection, after: PhotoSelection): boolean {
  return !(before.review === "ExpiredReview") || (after.review === "ExpiredReview" || after.review === "RevokedReview");
}

/** Story: Choose one photo and let an automatic check clear it / A photo that is not cleared by its deadline expires, and its offer settles (spec/photoRelayReview.md) */
//@ pure
export function sometimesExpired(s: PhotoSelection): boolean {
  return s.review === "ExpiredReview";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoSelection, event: Event): boolean {
  if (event.type === "checkSelection") return canCheckSelection(current);
  if (event.type === "checkParties") return canCheckParties(current);
  if (event.type === "checkPhoto") return canCheckPhoto(current);
  if (event.type === "resolveNotice") return canResolveNotice(current);
  if (event.type === "recordSelection") return canRecordSelection(current);
  if (event.type === "screenSelection") return canScreenSelection(current, event.now, event.deadline);
  if (event.type === "recordReview") return canRecordReview(current, event.choice, event.reviewerAuthorized, event.currentItem, event.itemLive);
  if (event.type === "revokeSelection") return canRevokeSelection(current, event.ownerMatches);
  if (event.type === "expireSelection") return canExpireSelection(current, event.now, event.deadline);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoSelection, event: Event): PhotoSelection {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkSelection") return canCheckSelection(current) ? checkSelection(current, event.inputValid, event.explicitConsent) : current;
  if (event.type === "checkParties") return canCheckParties(current) ? checkParties(current, event.senderMatches, event.differentPeople, event.differentMembers) : current;
  if (event.type === "checkPhoto") return canCheckPhoto(current) ? checkPhoto(current, event.currentPhoto) : current;
  if (event.type === "resolveNotice") return canResolveNotice(current) ? resolveNotice(current, event.readyNotice) : current;
  if (event.type === "recordSelection") return canRecordSelection(current) ? recordSelection(current) : current;
  if (event.type === "screenSelection") return canScreenSelection(current, event.now, event.deadline) ? screenSelection(current, event.screenOutcome, event.now, event.deadline) : current;
  if (event.type === "recordReview") return canRecordReview(current, event.choice, event.reviewerAuthorized, event.currentItem, event.itemLive) ? recordReview(current, event.choice, event.reviewerAuthorized, event.currentItem, event.itemLive) : current;
  if (event.type === "revokeSelection") return canRevokeSelection(current, event.ownerMatches) ? revokeSelection(current, event.ownerMatches) : current;
  if (event.type === "expireSelection") return canExpireSelection(current, event.now, event.deadline) ? expireSelection(current, event.now, event.deadline) : current;
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
  if (raw.type === "checkSelection" && typeof raw.inputValid === "boolean" && typeof raw.explicitConsent === "boolean") return { type: "checkSelection", inputValid: raw.inputValid, explicitConsent: raw.explicitConsent };
  if (raw.type === "checkParties" && typeof raw.senderMatches === "boolean" && typeof raw.differentPeople === "boolean" && typeof raw.differentMembers === "boolean") return { type: "checkParties", senderMatches: raw.senderMatches, differentPeople: raw.differentPeople, differentMembers: raw.differentMembers };
  if (raw.type === "checkPhoto" && typeof raw.currentPhoto === "boolean") return { type: "checkPhoto", currentPhoto: raw.currentPhoto };
  if (raw.type === "resolveNotice" && typeof raw.readyNotice === "boolean") return { type: "resolveNotice", readyNotice: raw.readyNotice };
  if (raw.type === "recordSelection") return { type: "recordSelection" };
  if (raw.type === "screenSelection" && (raw.screenOutcome === "ReleasePhoto" || raw.screenOutcome === "HoldForStaff" || raw.screenOutcome === "RetryScreen") && Number.isSafeInteger(raw.now) && Number.isSafeInteger(raw.deadline)) return { type: "screenSelection", screenOutcome: raw.screenOutcome, now: raw.now, deadline: raw.deadline };
  if (raw.type === "recordReview" && (raw.choice === "ApprovePhoto" || raw.choice === "RejectPhoto" || raw.choice === "KeepPending") && typeof raw.reviewerAuthorized === "boolean" && typeof raw.currentItem === "boolean" && typeof raw.itemLive === "boolean") return { type: "recordReview", choice: raw.choice, reviewerAuthorized: raw.reviewerAuthorized, currentItem: raw.currentItem, itemLive: raw.itemLive };
  if (raw.type === "revokeSelection" && typeof raw.ownerMatches === "boolean") return { type: "revokeSelection", ownerMatches: raw.ownerMatches };
  if (raw.type === "expireSelection" && Number.isSafeInteger(raw.now) && Number.isSafeInteger(raw.deadline)) return { type: "expireSelection", now: raw.now, deadline: raw.deadline };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhotoSelection | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Selecting" || raw.phase === "CheckingParties" || raw.phase === "CheckingPhoto" || raw.phase === "ResolvingNotice" || raw.phase === "ReadyToStore" || raw.phase === "StoredSelection" || raw.phase === "SelectionRefused") && (raw.review === "ScreeningReview" || raw.review === "PendingReview" || raw.review === "ApprovedReview" || raw.review === "RejectedReview" || raw.review === "RevokedReview" || raw.review === "ExpiredReview") && Object.keys(raw).length === 2)) return undefined;
  const parsed: PhotoSelection = ({ phase: raw.phase, review: raw.review });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoSelection {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_photoRelayReview(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
