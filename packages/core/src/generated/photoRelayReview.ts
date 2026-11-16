// GENERATED from spec/photoRelayReview.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
export type ReviewState = "PendingReview" | "ApprovedReview" | "RejectedReview" | "RevokedReview";
/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
export type SelectionPhase = "Selecting" | "CheckingParties" | "CheckingPhoto" | "ResolvingNotice" | "ReadyToStore" | "StoredSelection" | "SelectionRefused";
/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
export interface PhotoSelection { phase: SelectionPhase; review: ReviewState }
/** Story: Choose one photo and allow a designated reviewer to decide / A designated reviewer can approve a current pending item (spec/photoRelayReview.md:43) */
export type ReviewChoice = "ApprovePhoto" | "RejectPhoto" | "KeepPending";

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkSelection"; inputValid: boolean; explicitConsent: boolean }
  | { type: "checkParties"; senderMatches: boolean; differentPeople: boolean; differentMembers: boolean }
  | { type: "checkPhoto"; currentPhoto: boolean }
  | { type: "resolveNotice"; readyNotice: boolean }
  | { type: "recordSelection" }
  | { type: "recordReview"; choice: ReviewChoice; reviewerAuthorized: boolean; currentItem: boolean; itemLive: boolean }
  | { type: "revokeSelection"; ownerMatches: boolean };

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
export const relayItemTtlMs: number = 900000;
/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
export const initial: PhotoSelection = { phase: "Selecting", review: "PendingReview" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoSelection): boolean {
  return alwaysSelectionStartsPending(current);
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function checkSelection(s: PhotoSelection, inputValid: boolean, explicitConsent: boolean): PhotoSelection {
  //@ ensures (inv(s) && canCheckSelection(s)) ==> alwaysSelectionStartsPending(\result)
  //@ ensures (inv(s) && canCheckSelection(s)) ==> stepOnlyReviewApproves(s, "checkSelection", \result)
  //@ ensures (inv(s) && canCheckSelection(s)) ==> stepRevocationIsFinal(s, \result)
  return { ...s, phase: inputValid && explicitConsent ? "CheckingParties" : "SelectionRefused" };
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function canCheckParties(s: PhotoSelection): boolean {
  return s.phase === "CheckingParties";
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function checkParties(s: PhotoSelection, senderMatches: boolean, differentPeople: boolean, differentMembers: boolean): PhotoSelection {
  //@ ensures (inv(s) && canCheckParties(s)) ==> alwaysSelectionStartsPending(\result)
  //@ ensures (inv(s) && canCheckParties(s)) ==> stepOnlyReviewApproves(s, "checkParties", \result)
  //@ ensures (inv(s) && canCheckParties(s)) ==> stepRevocationIsFinal(s, \result)
  return { ...s, phase: senderMatches && differentPeople && differentMembers ? "CheckingPhoto" : "SelectionRefused" };
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function canCheckPhoto(s: PhotoSelection): boolean {
  return s.phase === "CheckingPhoto";
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function checkPhoto(s: PhotoSelection, currentPhoto: boolean): PhotoSelection {
  //@ ensures (inv(s) && canCheckPhoto(s)) ==> alwaysSelectionStartsPending(\result)
  //@ ensures (inv(s) && canCheckPhoto(s)) ==> stepOnlyReviewApproves(s, "checkPhoto", \result)
  //@ ensures (inv(s) && canCheckPhoto(s)) ==> stepRevocationIsFinal(s, \result)
  return { ...s, phase: currentPhoto ? "ResolvingNotice" : "SelectionRefused" };
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function canResolveNotice(s: PhotoSelection): boolean {
  return s.phase === "ResolvingNotice";
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function resolveNotice(s: PhotoSelection, readyNotice: boolean): PhotoSelection {
  //@ ensures (inv(s) && canResolveNotice(s)) ==> alwaysSelectionStartsPending(\result)
  //@ ensures (inv(s) && canResolveNotice(s)) ==> stepOnlyReviewApproves(s, "resolveNotice", \result)
  //@ ensures (inv(s) && canResolveNotice(s)) ==> stepRevocationIsFinal(s, \result)
  return { ...s, phase: readyNotice ? "ReadyToStore" : "SelectionRefused" };
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function canRecordSelection(s: PhotoSelection): boolean {
  return s.phase === "ReadyToStore";
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function recordSelection(s: PhotoSelection): PhotoSelection {
  //@ ensures (inv(s) && canRecordSelection(s)) ==> alwaysSelectionStartsPending(\result)
  //@ ensures (inv(s) && canRecordSelection(s)) ==> stepOnlyReviewApproves(s, "recordSelection", \result)
  //@ ensures (inv(s) && canRecordSelection(s)) ==> stepRevocationIsFinal(s, \result)
  return { ...s, phase: "StoredSelection" };
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function alwaysSelectionStartsPending(s: PhotoSelection): boolean {
  return !(s.phase !== "StoredSelection") || s.review === "PendingReview";
}

/** Story: Choose one photo and allow a designated reviewer to decide / Select one eligible photo using the current notice (spec/photoRelayReview.md:9) */
//@ pure
export function canCheckSelection(s: PhotoSelection): boolean {
  return s.phase === "Selecting";
}

/** Story: Choose one photo and allow a designated reviewer to decide / A designated reviewer can approve a current pending item (spec/photoRelayReview.md:43) */
//@ pure
export function photoReviewable(s: PhotoSelection): boolean {
  return s.phase === "StoredSelection" && (s.review === "PendingReview" || s.review === "ApprovedReview");
}

/** Story: Choose one photo and allow a designated reviewer to decide / A designated reviewer can approve a current pending item (spec/photoRelayReview.md:43) */
//@ pure
export function reviewNeedsCurrent(choice: ReviewChoice): boolean {
  return choice === "ApprovePhoto";
}

/** Story: Choose one photo and allow a designated reviewer to decide / A designated reviewer can approve a current pending item (spec/photoRelayReview.md:43) */
//@ pure
export function recordReview(s: PhotoSelection, choice: ReviewChoice, reviewerAuthorized: boolean, currentItem: boolean, itemLive: boolean): PhotoSelection {
  //@ ensures (inv(s) && canRecordReview(s, choice, reviewerAuthorized, currentItem, itemLive)) ==> alwaysSelectionStartsPending(\result)
  //@ ensures (inv(s) && canRecordReview(s, choice, reviewerAuthorized, currentItem, itemLive)) ==> stepOnlyReviewApproves(s, "recordReview", \result)
  //@ ensures (inv(s) && canRecordReview(s, choice, reviewerAuthorized, currentItem, itemLive)) ==> stepRevocationIsFinal(s, \result)
  return { ...s, review: choice === "ApprovePhoto" ? "ApprovedReview" : (s.review === "ApprovedReview" ? "RevokedReview" : "RejectedReview") };
}

/** Story: Choose one photo and allow a designated reviewer to decide / A designated reviewer can approve a current pending item (spec/photoRelayReview.md:43) */
//@ pure
export function stepOnlyReviewApproves(before: PhotoSelection, via: string, after: PhotoSelection): boolean {
  return !(before.review !== "ApprovedReview" && after.review === "ApprovedReview") || via === "recordReview";
}

/** Story: Choose one photo and allow a designated reviewer to decide / A designated reviewer can approve a current pending item (spec/photoRelayReview.md:43) */
//@ pure
export function photoReviewMayProceed(s: PhotoSelection, choice: ReviewChoice, reviewerAuthorized: boolean, itemLive: boolean): boolean {
  return photoReviewable(s) && reviewerAuthorized && itemLive && (choice === "RejectPhoto" || (choice === "ApprovePhoto" && s.review === "PendingReview"));
}

/** Story: Choose one photo and allow a designated reviewer to decide / A designated reviewer can approve a current pending item (spec/photoRelayReview.md:43) */
//@ pure
export function canRecordReview(s: PhotoSelection, choice: ReviewChoice, reviewerAuthorized: boolean, currentItem: boolean, itemLive: boolean): boolean {
  return photoReviewMayProceed(s, choice, reviewerAuthorized, itemLive) && (!reviewNeedsCurrent(choice) || currentItem);
}

/** Story: Choose one photo and allow a designated reviewer to decide / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md:68) */
//@ pure
export function canRevokeSelection(s: PhotoSelection, ownerMatches: boolean): boolean {
  return s.phase === "StoredSelection" && ownerMatches;
}

/** Story: Choose one photo and allow a designated reviewer to decide / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md:68) */
//@ pure
export function revokeSelection(s: PhotoSelection, ownerMatches: boolean): PhotoSelection {
  //@ ensures (inv(s) && canRevokeSelection(s, ownerMatches)) ==> alwaysSelectionStartsPending(\result)
  //@ ensures (inv(s) && canRevokeSelection(s, ownerMatches)) ==> stepOnlyReviewApproves(s, "revokeSelection", \result)
  //@ ensures (inv(s) && canRevokeSelection(s, ownerMatches)) ==> stepRevocationIsFinal(s, \result)
  return { ...s, review: "RevokedReview" };
}

/** Story: Choose one photo and allow a designated reviewer to decide / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md:68) */
//@ pure
export function stepRevocationIsFinal(before: PhotoSelection, after: PhotoSelection): boolean {
  return !(before.review === "RevokedReview") || after.review === "RevokedReview";
}

/** Story: Choose one photo and allow a designated reviewer to decide / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md:68) */
//@ pure
export function sometimesApproved(s: PhotoSelection): boolean {
  return s.review === "ApprovedReview";
}

/** Story: Choose one photo and allow a designated reviewer to decide / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md:68) */
//@ pure
export function sometimesRevoked(s: PhotoSelection): boolean {
  return s.review === "RevokedReview";
}

/** Story: Choose one photo and allow a designated reviewer to decide / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md:68) */
//@ pure
export function photoHeldForReview(s: PhotoSelection, claimed: boolean): boolean {
  return photoReviewable(s) && (s.review === "PendingReview" || !claimed);
}

/** Story: Choose one photo and allow a designated reviewer to decide / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md:68) */
//@ pure
export function reviewAuthorizationCurrent(s: PhotoSelection, configured: boolean, reviewerAuthorized: boolean, itemLive: boolean, samePolicy: boolean): boolean {
  return photoReviewable(s) && configured && reviewerAuthorized && itemLive && samePolicy;
}

/** Story: Choose one photo and allow a designated reviewer to decide / Held visibility is separate from delivery and owner cancellation (spec/photoRelayReview.md:68) */
//@ pure
export function reviewPreviewAllowed(s: PhotoSelection, claimed: boolean, reviewerAuthorized: boolean, itemLive: boolean): boolean {
  return photoHeldForReview(s, claimed) && reviewerAuthorized && itemLive;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoSelection, event: Event): boolean {
  if (event.type === "checkSelection") return canCheckSelection(current);
  if (event.type === "checkParties") return canCheckParties(current);
  if (event.type === "checkPhoto") return canCheckPhoto(current);
  if (event.type === "resolveNotice") return canResolveNotice(current);
  if (event.type === "recordSelection") return canRecordSelection(current);
  if (event.type === "recordReview") return canRecordReview(current, event.choice, event.reviewerAuthorized, event.currentItem, event.itemLive);
  if (event.type === "revokeSelection") return canRevokeSelection(current, event.ownerMatches);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoSelection, event: Event): PhotoSelection {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkSelection" && canCheckSelection(current)) return checkSelection(current, event.inputValid, event.explicitConsent);
  if (event.type === "checkParties" && canCheckParties(current)) return checkParties(current, event.senderMatches, event.differentPeople, event.differentMembers);
  if (event.type === "checkPhoto" && canCheckPhoto(current)) return checkPhoto(current, event.currentPhoto);
  if (event.type === "resolveNotice" && canResolveNotice(current)) return resolveNotice(current, event.readyNotice);
  if (event.type === "recordSelection" && canRecordSelection(current)) return recordSelection(current);
  if (event.type === "recordReview" && canRecordReview(current, event.choice, event.reviewerAuthorized, event.currentItem, event.itemLive)) return recordReview(current, event.choice, event.reviewerAuthorized, event.currentItem, event.itemLive);
  if (event.type === "revokeSelection" && canRevokeSelection(current, event.ownerMatches)) return revokeSelection(current, event.ownerMatches);
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
  if (raw.type === "recordReview" && (raw.choice === "ApprovePhoto" || raw.choice === "RejectPhoto" || raw.choice === "KeepPending") && typeof raw.reviewerAuthorized === "boolean" && typeof raw.currentItem === "boolean" && typeof raw.itemLive === "boolean") return { type: "recordReview", choice: raw.choice, reviewerAuthorized: raw.reviewerAuthorized, currentItem: raw.currentItem, itemLive: raw.itemLive };
  if (raw.type === "revokeSelection" && typeof raw.ownerMatches === "boolean") return { type: "revokeSelection", ownerMatches: raw.ownerMatches };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Selecting" || raw.phase === "CheckingParties" || raw.phase === "CheckingPhoto" || raw.phase === "ResolvingNotice" || raw.phase === "ReadyToStore" || raw.phase === "StoredSelection" || raw.phase === "SelectionRefused") && (raw.review === "PendingReview" || raw.review === "ApprovedReview" || raw.review === "RejectedReview" || raw.review === "RevokedReview") && Object.keys(raw).length === 2)) return undefined;
  const parsed: PhotoSelection = ({ phase: raw.phase, review: raw.review });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoSelection {
  //@ ensures inv(\result)
  return initial;
}
