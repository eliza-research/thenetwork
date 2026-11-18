// GENERATED from spec/photoRelayItem.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md) */
export type PhotoDeliveryPhase = "PhotoWaiting" | "PhotoApproved";
/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md) */
export interface PhotoDelivery { phase: PhotoDeliveryPhase; expiresAt: number; boundAction: boolean; actionKey: string; boundIntent: boolean; intentKey: string; hasDeadline: boolean; deliveryUntil: number }
/** Story: Choose the photo to relay in the conversation / A photo request delivers an approved choice, lists the photos, or records the named photo (spec/photoRelayItem.md) */
export type PhotoRelayEntry = "DeliverApprovedPhoto" | "OfferPhotoChoices" | "RecordPhotoChoice" | "AskForPhotosFirst" | "PhotoRelayOff" | "PhotoChoiceUnknown";

/** One variant per transition in the spec. */
export type Event =
  | { type: "claimAction"; actionKey: string; currentItem: boolean }
  | { type: "observeApproval"; expiresAt: number }
  | { type: "issueDelivery"; intentKey: string; currentItem: boolean; issueAt: number; checkedAt: number };

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md) */
export const providerFetchTtlMs: number = 60000;
/** Story: Choose the photo to relay in the conversation / A photo request delivers an approved choice, lists the photos, or records the named photo (spec/photoRelayItem.md) */
export const photoRelayOfferTtlMs: number = 900000;
/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md) */
export const initial: PhotoDelivery = { phase: "PhotoWaiting", expiresAt: 0, boundAction: false, actionKey: "", boundIntent: false, intentKey: "", hasDeadline: false, deliveryUntil: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoDelivery): boolean {
  return true;
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md) */
//@ pure
export function claimAction(photo: PhotoDelivery, actionKey: string, currentItem: boolean): PhotoDelivery {
  //@ ensures (inv(photo) && canClaimAction(photo, actionKey, currentItem)) ==> stepAnActionBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canClaimAction(photo, actionKey, currentItem)) ==> stepAnIntentBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canClaimAction(photo, actionKey, currentItem)) ==> stepAFixedDeadlineNeverChanges(photo, \result)
  return { ...photo, boundAction: true, actionKey: actionKey };
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md) */
//@ pure
export function stepAnActionBindingNeverChanges(before: PhotoDelivery, after: PhotoDelivery): boolean {
  return !before.boundAction || (after.boundAction && after.actionKey === before.actionKey);
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md) */
//@ pure
export function canObserveApproval(photo: PhotoDelivery): boolean {
  return photo.phase === "PhotoWaiting";
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md) */
//@ pure
export function observeApproval(photo: PhotoDelivery, expiresAt: number): PhotoDelivery {
  //@ ensures (inv(photo) && canObserveApproval(photo)) ==> stepAnActionBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canObserveApproval(photo)) ==> stepAnIntentBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canObserveApproval(photo)) ==> stepAFixedDeadlineNeverChanges(photo, \result)
  return { ...photo, phase: "PhotoApproved", expiresAt: expiresAt };
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md) */
//@ pure
export function canClaimAction(photo: PhotoDelivery, actionKey: string, currentItem: boolean): boolean {
  return currentItem && photo.phase === "PhotoApproved" && (!photo.boundAction || photo.actionKey === actionKey);
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md) */
//@ pure
export function deadlineForDelivery(photo: PhotoDelivery, at: number): number {
  return photo.hasDeadline ? photo.deliveryUntil : (photo.expiresAt < exact_photoRelayItem(at + providerFetchTtlMs) ? photo.expiresAt : exact_photoRelayItem(at + providerFetchTtlMs));
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md) */
//@ pure
export function permitsIntentBinding(photo: PhotoDelivery, intentKey: string): boolean {
  return photo.phase === "PhotoApproved" && photo.boundAction && photo.actionKey !== "" && (!photo.boundIntent || photo.intentKey === intentKey);
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md) */
//@ pure
export function stepAnIntentBindingNeverChanges(before: PhotoDelivery, after: PhotoDelivery): boolean {
  return !before.boundIntent || (after.boundIntent && after.intentKey === before.intentKey);
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md) */
//@ pure
export function stepAFixedDeadlineNeverChanges(before: PhotoDelivery, after: PhotoDelivery): boolean {
  return !before.hasDeadline || (after.hasDeadline && after.deliveryUntil === before.deliveryUntil);
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md) */
//@ pure
export function sometimesDeliveryWasIssued(photo: PhotoDelivery): boolean {
  return photo.boundIntent && photo.hasDeadline;
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md) */
//@ pure
export function canIssueDelivery(photo: PhotoDelivery, intentKey: string, currentItem: boolean, issueAt: number, checkedAt: number): boolean {
  return currentItem && permitsIntentBinding(photo, intentKey) && deadlineForDelivery(photo, issueAt) > checkedAt;
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md) */
//@ pure
export function issueDelivery(photo: PhotoDelivery, intentKey: string, currentItem: boolean, issueAt: number, checkedAt: number): PhotoDelivery {
  //@ ensures (inv(photo) && canIssueDelivery(photo, intentKey, currentItem, issueAt, checkedAt)) ==> stepAnActionBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canIssueDelivery(photo, intentKey, currentItem, issueAt, checkedAt)) ==> stepAnIntentBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canIssueDelivery(photo, intentKey, currentItem, issueAt, checkedAt)) ==> stepAFixedDeadlineNeverChanges(photo, \result)
  return { ...photo, boundIntent: true, intentKey: intentKey, hasDeadline: true, deliveryUntil: deadlineForDelivery(photo, issueAt) };
}

/** Story: Deliver only the approved selected photo / Fetches require the approved item and its exact live capability (spec/photoRelayItem.md) */
//@ pure
export function photoDeliveryStillLive(photo: PhotoDelivery, deadline: number, at: number): boolean {
  return deadline > at && photo.expiresAt > at;
}

/** Story: Deliver only the approved selected photo / Fetches require the approved item and its exact live capability (spec/photoRelayItem.md) */
//@ pure
export function photoFetchAllowed(photo: PhotoDelivery, deadline: number, at: number): boolean {
  return photo.phase === "PhotoApproved" && photo.boundAction && photo.actionKey !== "" && photo.boundIntent && photo.intentKey !== "" && photo.hasDeadline && deadline === photo.deliveryUntil && deadline <= photo.expiresAt && photoDeliveryStillLive(photo, deadline, at);
}

/** Story: Choose the photo to relay in the conversation / A photo request delivers an approved choice, lists the photos, or records the named photo (spec/photoRelayItem.md) */
//@ pure
export function photoRelayOfferLive(offeredAt: number, at: number, sameNotice: boolean): boolean {
  return sameNotice && at >= offeredAt && exact_photoRelayItem(at - offeredAt) < photoRelayOfferTtlMs;
}

/** Story: Choose the photo to relay in the conversation / A photo request delivers an approved choice, lists the photos, or records the named photo (spec/photoRelayItem.md) */
//@ pure
export function photoRelayEntryFor(relayOn: boolean, approvedReady: boolean, photoCount: number, choice: number, offerLive: boolean, offerSize: number): PhotoRelayEntry {
  return approvedReady ? "DeliverApprovedPhoto" : (!relayOn ? "PhotoRelayOff" : (choice === 0 && photoCount > 0 ? "OfferPhotoChoices" : (choice === 0 ? "AskForPhotosFirst" : (offerLive && choice >= 1 && choice <= offerSize ? "RecordPhotoChoice" : "PhotoChoiceUnknown"))));
}

/** Story: Choose the photo to relay in the conversation / A photo request delivers an approved choice, lists the photos, or records the named photo (spec/photoRelayItem.md) */
//@ pure
export function lawStaleListIsNotLive(offeredAt: number, sameNotice: boolean): boolean {
  //@ ensures \result === true
  return !photoRelayOfferLive(offeredAt, exact_photoRelayItem(offeredAt + photoRelayOfferTtlMs), sameNotice);
}

/** Story: Choose the photo to relay in the conversation / A photo request delivers an approved choice, lists the photos, or records the named photo (spec/photoRelayItem.md) */
//@ pure
export function lawChoiceNeedsLiveOffer(relayOn: boolean, approvedReady: boolean, photoCount: number, choice: number, offerSize: number): boolean {
  //@ ensures \result === true
  return photoRelayEntryFor(relayOn, approvedReady, photoCount, choice, false, offerSize) !== "RecordPhotoChoice";
}

/** Story: Choose the photo to relay in the conversation / A photo request delivers an approved choice, lists the photos, or records the named photo (spec/photoRelayItem.md) */
//@ pure
export function lawChoiceStaysInsideTheList(relayOn: boolean, approvedReady: boolean, photoCount: number, choice: number, offerLive: boolean, offerSize: number): boolean {
  //@ ensures \result === true
  return !(photoRelayEntryFor(relayOn, approvedReady, photoCount, choice, offerLive, offerSize) === "RecordPhotoChoice") || (choice >= 1 && choice <= offerSize);
}

/** Story: Choose the photo to relay in the conversation / A photo request delivers an approved choice, lists the photos, or records the named photo (spec/photoRelayItem.md) */
//@ pure
export function lawNothingChosenWhenRelayIsOff(photoCount: number, choice: number, offerLive: boolean, offerSize: number): boolean {
  //@ ensures \result === true
  return photoRelayEntryFor(false, false, photoCount, choice, offerLive, offerSize) === "PhotoRelayOff";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoDelivery, event: Event): boolean {
  if (event.type === "claimAction") return canClaimAction(current, event.actionKey, event.currentItem);
  if (event.type === "observeApproval") return canObserveApproval(current);
  if (event.type === "issueDelivery") return canIssueDelivery(current, event.intentKey, event.currentItem, event.issueAt, event.checkedAt);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoDelivery, event: Event): PhotoDelivery {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "claimAction") return canClaimAction(current, event.actionKey, event.currentItem) ? claimAction(current, event.actionKey, event.currentItem) : current;
  if (event.type === "observeApproval") return canObserveApproval(current) ? observeApproval(current, event.expiresAt) : current;
  if (event.type === "issueDelivery") return canIssueDelivery(current, event.intentKey, event.currentItem, event.issueAt, event.checkedAt) ? issueDelivery(current, event.intentKey, event.currentItem, event.issueAt, event.checkedAt) : current;
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
  if (raw.type === "claimAction" && typeof raw.actionKey === "string" && typeof raw.currentItem === "boolean") return { type: "claimAction", actionKey: raw.actionKey, currentItem: raw.currentItem };
  if (raw.type === "observeApproval" && Number.isSafeInteger(raw.expiresAt)) return { type: "observeApproval", expiresAt: raw.expiresAt };
  if (raw.type === "issueDelivery" && typeof raw.intentKey === "string" && typeof raw.currentItem === "boolean" && Number.isSafeInteger(raw.issueAt) && Number.isSafeInteger(raw.checkedAt)) return { type: "issueDelivery", intentKey: raw.intentKey, currentItem: raw.currentItem, issueAt: raw.issueAt, checkedAt: raw.checkedAt };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhotoDelivery | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "PhotoWaiting" || raw.phase === "PhotoApproved") && Number.isSafeInteger(raw.expiresAt) && typeof raw.boundAction === "boolean" && typeof raw.actionKey === "string" && typeof raw.boundIntent === "boolean" && typeof raw.intentKey === "string" && typeof raw.hasDeadline === "boolean" && Number.isSafeInteger(raw.deliveryUntil) && Object.keys(raw).length === 8)) return undefined;
  const parsed: PhotoDelivery = ({ phase: raw.phase, expiresAt: raw.expiresAt, boundAction: raw.boundAction, actionKey: raw.actionKey, boundIntent: raw.boundIntent, intentKey: raw.intentKey, hasDeadline: raw.hasDeadline, deliveryUntil: raw.deliveryUntil });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoDelivery {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_photoRelayItem(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
