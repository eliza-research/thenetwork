//@ backend dafny
// The state machine of one selected-photo relay item (photo-relay.ts). Import-free, proved by
// LemmaScript (docs/formal-verification.md). PhotoRelayService calls these functions for every state
// change and every gate. The SQL row lock, the photo bytes and the HMAC are the unproved shell.
// The high-level model is quint/relay.qnt (claude/quint-state-machines) and quint/photo_relay_item.qnt.
//
// The item starts "pending" only when the member gave consent to the exact notice version
// (photoSelectGate). Only a "safe" review moves it to "approved", and only from "pending". Only an
// "approved" item can be claimed by an action, get a delivery capability, or be fetched.

export type PhotoRelayState = "pending" | "approved" | "rejected" | "revoked";

/** The inputs of PhotoRelayService.select, as booleans and the two notice versions. */
export interface PhotoSelectInput {
  requestIdOk: boolean;
  enabled: boolean;
  photoIdOk: boolean;
  threadOk: boolean;
  consent: boolean;
  noticeVersion: string;
  policyVersion: string;
}

/** The delivery fetch: the item as read under its lock, the signed exp and the time now. */
export interface PhotoFetch {
  state: PhotoRelayState;
  hasAction: boolean;
  hasIntent: boolean;
  exp: number;
  now: number;
  hasDeliveryExp: boolean;
  deliveryExpiresAt: number;
  expiresAt: number;
}

/** The allowed edges. A sender can revoke from every state; review moves pending and approved only. */
export function photoEdge(from: PhotoRelayState, to: PhotoRelayState): boolean {
  //@ verify
  //@ ensures \result && to === "approved" ==> from === "pending"
  //@ ensures \result && to === "rejected" ==> from === "pending"
  //@ ensures \result ==> to !== "pending"
  return to === "revoked" || (from === "pending" && (to === "approved" || to === "rejected"));
}

/**
 * True when select may create an item. It needs the member's consent to the notice version that the
 * policy has now. A false result creates nothing.
 */
export function photoSelectGate(s: PhotoSelectInput): boolean {
  //@ verify
  //@ ensures \result ==> s.consent && s.enabled && s.noticeVersion === s.policyVersion
  //@ ensures \result ==> s.requestIdOk && s.photoIdOk && s.threadOk
  return s.requestIdOk && s.enabled && s.photoIdOk && s.threadOk && s.consent && s.noticeVersion === s.policyVersion;
}

/** The state of a new item. */
export function photoSelected(): PhotoRelayState {
  //@ verify
  //@ ensures \result === "pending"
  return "pending";
}

/** The sender withdraws the item. Every state goes to revoked. */
export function photoRevokeNext(state: PhotoRelayState): PhotoRelayState {
  //@ verify
  //@ ensures \result === "revoked" && photoEdge(state, \result)
  return "revoked";
}

/** A reviewer can act on the item. */
export function photoReviewable(state: PhotoRelayState): boolean {
  //@ verify
  return state === "pending" || state === "approved";
}

/**
 * The state after a review, or null when the review changes nothing. "unknown" and an expired item
 * change nothing. "safe" needs a pending item that is current (parties, policy, photo); "unsafe"
 * rejects a pending item and revokes an approved one, even one that an action claimed.
 */
export function photoReviewNext(state: PhotoRelayState, decision: string, expired: boolean, current: boolean): PhotoRelayState | null {
  //@ verify
  //@ ensures \result !== null ==> photoEdge(state, \result) && \result !== state
  //@ ensures \result === "approved" ==> state === "pending" && decision === "safe" && current && !expired
  //@ ensures expired || !photoReviewable(state) ==> \result === null
  //@ ensures decision !== "safe" && decision !== "unsafe" ==> \result === null
  //@ ensures decision === "unsafe" && !expired && photoReviewable(state) ==> \result === "rejected" || \result === "revoked"
  if (!photoReviewable(state) || expired) return null;
  if (decision === "safe") return state === "pending" && current ? "approved" : null;
  if (decision === "unsafe") return state === "approved" ? "revoked" : "rejected";
  return null;
}

/** A held item: it waits for a review, or it is approved and no action claimed it yet. */
export function photoHeld(state: PhotoRelayState, hasAction: boolean): boolean {
  //@ verify
  //@ ensures \result ==> photoReviewable(state)
  return state === "pending" || (state === "approved" && !hasAction);
}

/** An approved item that no action claimed. */
export function photoUnclaimed(state: PhotoRelayState, hasAction: boolean): boolean {
  //@ verify
  //@ ensures \result ==> state === "approved" && photoHeld(state, hasAction)
  return state === "approved" && !hasAction;
}

/** An action may claim the item: it is approved, and no other action has it. One item binds one action. */
export function photoClaimable(state: PhotoRelayState, hasAction: boolean, boundAction: string, actionId: string): boolean {
  //@ verify
  //@ ensures \result ==> state === "approved"
  //@ ensures \result && hasAction ==> boundAction === actionId
  return state === "approved" && (!hasAction || boundAction === actionId);
}

/** A delivery capability may be issued: approved, claimed, and no other provider intent bound. */
export function photoMayIssue(state: PhotoRelayState, hasAction: boolean, hasIntent: boolean, boundIntent: string, intent: string): boolean {
  //@ verify
  //@ ensures \result ==> state === "approved" && hasAction
  //@ ensures \result && hasIntent ==> boundIntent === intent
  return hasAction && state === "approved" && (!hasIntent || boundIntent === intent);
}

/**
 * The deadline of a delivery capability. The first issue fixes it; a later issue keeps it, so the same
 * intent can never extend it. A new deadline is never after the item expires.
 */
export function photoDeliveryDeadline(hasDeliveryExp: boolean, deliveryExpiresAt: number, expiresAt: number, now: number, fetchTtl: number): number {
  //@ verify
  //@ ensures hasDeliveryExp ==> \result === deliveryExpiresAt
  //@ ensures !hasDeliveryExp ==> \result <= expiresAt && \result <= now + fetchTtl
  if (hasDeliveryExp) return deliveryExpiresAt;
  return expiresAt < now + fetchTtl ? expiresAt : now + fetchTtl;
}

/** The provider may fetch the bytes: approved, claimed, intent bound, and exp is the bound live deadline. */
export function photoFetchable(f: PhotoFetch): boolean {
  //@ verify
  //@ ensures \result ==> f.state === "approved" && f.hasAction && f.hasIntent
  //@ ensures \result ==> f.now < f.exp && f.hasDeliveryExp && f.exp === f.deliveryExpiresAt && f.exp <= f.expiresAt
  return f.hasAction && f.hasIntent && f.state === "approved" && f.exp > f.now && f.hasDeliveryExp && f.exp === f.deliveryExpiresAt && f.exp <= f.expiresAt;
}
