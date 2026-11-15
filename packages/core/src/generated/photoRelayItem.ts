// GENERATED from spec/photoRelayItem.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md:9) */
export type PhotoDeliveryPhase = "PhotoWaiting" | "PhotoApproved";
/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md:9) */
export interface PhotoDelivery { phase: PhotoDeliveryPhase; expiresAt: number; boundAction: boolean; actionKey: string; boundIntent: boolean; intentKey: string; hasDeadline: boolean; deliveryUntil: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "claimAction"; actionKey: string; currentItem: boolean }
  | { type: "observeApproval"; expiresAt: number }
  | { type: "issueDelivery"; intentKey: string; currentItem: boolean; issueAt: number; checkedAt: number };

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md:41) */
export const providerFetchTtlMs: number = 60000;
/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md:9) */
export const initial: PhotoDelivery = { phase: "PhotoWaiting", expiresAt: 0, boundAction: false, actionKey: "", boundIntent: false, intentKey: "", hasDeadline: false, deliveryUntil: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoDelivery): boolean {
  return true;
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md:9) */
//@ pure
export function claimAction(photo: PhotoDelivery, actionKey: string, currentItem: boolean): PhotoDelivery {
  //@ ensures (inv(photo) && canClaimAction(photo, actionKey, currentItem)) ==> stepAnActionBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canClaimAction(photo, actionKey, currentItem)) ==> stepAnIntentBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canClaimAction(photo, actionKey, currentItem)) ==> stepAFixedDeadlineNeverChanges(photo, \result)
  return { ...photo, boundAction: true, actionKey: actionKey };
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md:9) */
//@ pure
export function stepAnActionBindingNeverChanges(before: PhotoDelivery, after: PhotoDelivery): boolean {
  return !before.boundAction || (after.boundAction && after.actionKey === before.actionKey);
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md:9) */
//@ pure
export function canObserveApproval(photo: PhotoDelivery): boolean {
  return photo.phase === "PhotoWaiting";
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md:9) */
//@ pure
export function observeApproval(photo: PhotoDelivery, expiresAt: number): PhotoDelivery {
  //@ ensures (inv(photo) && canObserveApproval(photo)) ==> stepAnActionBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canObserveApproval(photo)) ==> stepAnIntentBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canObserveApproval(photo)) ==> stepAFixedDeadlineNeverChanges(photo, \result)
  return { ...photo, phase: "PhotoApproved", expiresAt: expiresAt };
}

/** Story: Deliver only the approved selected photo / A current approved item binds to one action (spec/photoRelayItem.md:9) */
//@ pure
export function canClaimAction(photo: PhotoDelivery, actionKey: string, currentItem: boolean): boolean {
  return currentItem && photo.phase === "PhotoApproved" && (!photo.boundAction || photo.actionKey === actionKey);
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md:41) */
//@ pure
export function deadlineForDelivery(photo: PhotoDelivery, at: number): number {
  return photo.hasDeadline ? photo.deliveryUntil : (photo.expiresAt < at + providerFetchTtlMs ? photo.expiresAt : at + providerFetchTtlMs);
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md:41) */
//@ pure
export function permitsIntentBinding(photo: PhotoDelivery, intentKey: string): boolean {
  return photo.phase === "PhotoApproved" && photo.boundAction && photo.actionKey !== "" && (!photo.boundIntent || photo.intentKey === intentKey);
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md:41) */
//@ pure
export function stepAnIntentBindingNeverChanges(before: PhotoDelivery, after: PhotoDelivery): boolean {
  return !before.boundIntent || (after.boundIntent && after.intentKey === before.intentKey);
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md:41) */
//@ pure
export function stepAFixedDeadlineNeverChanges(before: PhotoDelivery, after: PhotoDelivery): boolean {
  return !before.hasDeadline || (after.hasDeadline && after.deliveryUntil === before.deliveryUntil);
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md:41) */
//@ pure
export function sometimesDeliveryWasIssued(photo: PhotoDelivery): boolean {
  return photo.boundIntent && photo.hasDeadline;
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md:41) */
//@ pure
export function canIssueDelivery(photo: PhotoDelivery, intentKey: string, currentItem: boolean, issueAt: number, checkedAt: number): boolean {
  return currentItem && permitsIntentBinding(photo, intentKey) && deadlineForDelivery(photo, issueAt) > checkedAt;
}

/** Story: Deliver only the approved selected photo / Issuing a capability fixes the intent and deadline (spec/photoRelayItem.md:41) */
//@ pure
export function issueDelivery(photo: PhotoDelivery, intentKey: string, currentItem: boolean, issueAt: number, checkedAt: number): PhotoDelivery {
  //@ ensures (inv(photo) && canIssueDelivery(photo, intentKey, currentItem, issueAt, checkedAt)) ==> stepAnActionBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canIssueDelivery(photo, intentKey, currentItem, issueAt, checkedAt)) ==> stepAnIntentBindingNeverChanges(photo, \result)
  //@ ensures (inv(photo) && canIssueDelivery(photo, intentKey, currentItem, issueAt, checkedAt)) ==> stepAFixedDeadlineNeverChanges(photo, \result)
  return { ...photo, boundIntent: true, intentKey: intentKey, hasDeadline: true, deliveryUntil: deadlineForDelivery(photo, issueAt) };
}

/** Story: Deliver only the approved selected photo / Fetches require the approved item and its exact live capability (spec/photoRelayItem.md:72) */
//@ pure
export function photoDeliveryStillLive(photo: PhotoDelivery, deadline: number, at: number): boolean {
  return deadline > at && photo.expiresAt > at;
}

/** Story: Deliver only the approved selected photo / Fetches require the approved item and its exact live capability (spec/photoRelayItem.md:72) */
//@ pure
export function photoFetchAllowed(photo: PhotoDelivery, deadline: number, at: number): boolean {
  return photo.phase === "PhotoApproved" && photo.boundAction && photo.actionKey !== "" && photo.boundIntent && photo.intentKey !== "" && photo.hasDeadline && deadline === photo.deliveryUntil && deadline <= photo.expiresAt && photoDeliveryStillLive(photo, deadline, at);
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
  if (event.type === "claimAction" && canClaimAction(current, event.actionKey, event.currentItem)) return claimAction(current, event.actionKey, event.currentItem);
  if (event.type === "observeApproval" && canObserveApproval(current)) return observeApproval(current, event.expiresAt);
  if (event.type === "issueDelivery" && canIssueDelivery(current, event.intentKey, event.currentItem, event.issueAt, event.checkedAt)) return issueDelivery(current, event.intentKey, event.currentItem, event.issueAt, event.checkedAt);
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
