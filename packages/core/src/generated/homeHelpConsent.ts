// GENERATED from spec/homeHelpConsent.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Decide privately about the exact reviewed plan / Only the current approved roster can receive a notice (spec/homeHelpConsent.md) */
export type HomeHelpConsentPhase = "Unstaged" | "Pending" | "Sent" | "Accepted" | "Declined" | "Withdrawn" | "Cancelled";
/** Story: Decide privately about the exact reviewed plan / Only the current approved roster can receive a notice (spec/homeHelpConsent.md) */
export interface HomeHelpRecipientConsent { phase: HomeHelpConsentPhase }

/** One variant per transition in the spec. */
export type Event =
  | { type: "stageNotice"; reviewedNow: boolean }
  | { type: "recordNoticeSent"; deliveryAllowed: boolean; exactReceipt: boolean }
  | { type: "chooseHomeHelp"; responseAllowed: boolean; exactActor: boolean; wantsHelp: boolean }
  | { type: "withdrawHomeHelp"; exactActor: boolean }
  | { type: "invalidateHomeHelp"; planInvalidated: boolean };

/** Story: Decide privately about the exact reviewed plan / Only the current approved roster can receive a notice (spec/homeHelpConsent.md) */
export const initial: HomeHelpRecipientConsent = { phase: "Unstaged" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: HomeHelpRecipientConsent): boolean {
  return true;
}

/** Story: Decide privately about the exact reviewed plan / Only the current approved roster can receive a notice (spec/homeHelpConsent.md) */
//@ pure
export function canStageNotice(c: HomeHelpRecipientConsent, reviewedNow: boolean): boolean {
  return c.phase === "Unstaged" && reviewedNow;
}

/** Story: Decide privately about the exact reviewed plan / Only the current approved roster can receive a notice (spec/homeHelpConsent.md) */
//@ pure
export function stageNotice(c: HomeHelpRecipientConsent, reviewedNow: boolean): HomeHelpRecipientConsent {
  //@ ensures (inv(c) && canStageNotice(c, reviewedNow)) ==> stepAcceptanceFollowsDelivery(c, \result)
  //@ ensures (inv(c) && canStageNotice(c, reviewedNow)) ==> stepStoppedConsentStaysStopped(c, \result)
  return canStageNotice(c, reviewedNow) ? ({ phase: "Pending" } as HomeHelpRecipientConsent) : c;
}

/** Story: Decide privately about the exact reviewed plan / Only the current approved roster can receive a notice (spec/homeHelpConsent.md) */
//@ pure
export function homeHelpConsentStopped(phase: HomeHelpConsentPhase): boolean {
  return phase === "Declined" || phase === "Withdrawn" || phase === "Cancelled";
}

/** Story: Decide privately about the exact reviewed plan / Only the current approved roster can receive a notice (spec/homeHelpConsent.md) */
//@ pure
export function homeHelpNoticeAllowed(phase: HomeHelpConsentPhase, reviewedNow: boolean, exactRoster: boolean, consentStopped: boolean, requesterNotice: boolean, requesterAccepted: boolean): boolean {
  return phase === "Pending" && reviewedNow && exactRoster && !consentStopped && (requesterNotice || requesterAccepted);
}

/** Story: Decide privately about the exact reviewed plan / Only the current approved roster can receive a notice (spec/homeHelpConsent.md) */
//@ pure
export function lawHelperNoticeRequiresRequester(phase: HomeHelpConsentPhase, reviewedNow: boolean, exactRoster: boolean, consentStopped: boolean): boolean {
  //@ ensures \result === true
  return !homeHelpNoticeAllowed(phase, reviewedNow, exactRoster, consentStopped, false, false);
}

/** Story: Decide privately about the exact reviewed plan / Only the current approved roster can receive a notice (spec/homeHelpConsent.md) */
//@ pure
export function sometimesNoticePending(c: HomeHelpRecipientConsent): boolean {
  return c.phase === "Pending";
}

/** Story: Decide privately about the exact reviewed plan / A response belongs to the recipient of a delivered notice (spec/homeHelpConsent.md) */
//@ pure
export function canRecordNoticeSent(c: HomeHelpRecipientConsent, deliveryAllowed: boolean, exactReceipt: boolean): boolean {
  return c.phase === "Pending" && deliveryAllowed && exactReceipt;
}

/** Story: Decide privately about the exact reviewed plan / A response belongs to the recipient of a delivered notice (spec/homeHelpConsent.md) */
//@ pure
export function recordNoticeSent(c: HomeHelpRecipientConsent, deliveryAllowed: boolean, exactReceipt: boolean): HomeHelpRecipientConsent {
  //@ ensures (inv(c) && canRecordNoticeSent(c, deliveryAllowed, exactReceipt)) ==> stepAcceptanceFollowsDelivery(c, \result)
  //@ ensures (inv(c) && canRecordNoticeSent(c, deliveryAllowed, exactReceipt)) ==> stepStoppedConsentStaysStopped(c, \result)
  return canRecordNoticeSent(c, deliveryAllowed, exactReceipt) ? ({ phase: "Sent" } as HomeHelpRecipientConsent) : c;
}

/** Story: Decide privately about the exact reviewed plan / A response belongs to the recipient of a delivered notice (spec/homeHelpConsent.md) */
//@ pure
export function canChooseHomeHelp(c: HomeHelpRecipientConsent, responseAllowed: boolean, exactActor: boolean): boolean {
  return c.phase === "Sent" && responseAllowed && exactActor;
}

/** Story: Decide privately about the exact reviewed plan / A response belongs to the recipient of a delivered notice (spec/homeHelpConsent.md) */
//@ pure
export function homeHelpResponseAfterDelivery(sentAt: number, receivedAt: number, now: number): boolean {
  return sentAt >= 0 && sentAt <= receivedAt && receivedAt <= now;
}

/** Story: Decide privately about the exact reviewed plan / A response belongs to the recipient of a delivered notice (spec/homeHelpConsent.md) */
//@ pure
export function lawPrematureHomeHelpResponseRefused(sentAt: number, receivedAt: number, now: number): boolean {
  //@ ensures \result === true
  return !(receivedAt < sentAt) || !homeHelpResponseAfterDelivery(sentAt, receivedAt, now);
}

/** Story: Decide privately about the exact reviewed plan / A response belongs to the recipient of a delivered notice (spec/homeHelpConsent.md) */
//@ pure
export function chooseHomeHelp(c: HomeHelpRecipientConsent, responseAllowed: boolean, exactActor: boolean, wantsHelp: boolean): HomeHelpRecipientConsent {
  //@ ensures (inv(c) && canChooseHomeHelp(c, responseAllowed, exactActor)) ==> stepAcceptanceFollowsDelivery(c, \result)
  //@ ensures (inv(c) && canChooseHomeHelp(c, responseAllowed, exactActor)) ==> stepStoppedConsentStaysStopped(c, \result)
  return canChooseHomeHelp(c, responseAllowed, exactActor) ? (wantsHelp ? ({ phase: "Accepted" } as HomeHelpRecipientConsent) : ({ phase: "Declined" } as HomeHelpRecipientConsent)) : c;
}

/** Story: Decide privately about the exact reviewed plan / A response belongs to the recipient of a delivered notice (spec/homeHelpConsent.md) */
//@ pure
export function stepAcceptanceFollowsDelivery(before: HomeHelpRecipientConsent, after: HomeHelpRecipientConsent): boolean {
  return !(after.phase === "Accepted") || (before.phase === "Sent" || before.phase === "Accepted");
}

/** Story: Decide privately about the exact reviewed plan / A response belongs to the recipient of a delivered notice (spec/homeHelpConsent.md) */
//@ pure
export function sometimesAccepted(c: HomeHelpRecipientConsent): boolean {
  return c.phase === "Accepted";
}

/** Story: Decide privately about the exact reviewed plan / A response belongs to the recipient of a delivered notice (spec/homeHelpConsent.md) */
//@ pure
export function sometimesDeclined(c: HomeHelpRecipientConsent): boolean {
  return c.phase === "Declined";
}

/** Story: Decide privately about the exact reviewed plan / Any withdrawal or invalidation stops the reviewed consent (spec/homeHelpConsent.md) */
//@ pure
export function canWithdrawHomeHelp(c: HomeHelpRecipientConsent, exactActor: boolean): boolean {
  return c.phase === "Accepted" && exactActor;
}

/** Story: Decide privately about the exact reviewed plan / Any withdrawal or invalidation stops the reviewed consent (spec/homeHelpConsent.md) */
//@ pure
export function withdrawHomeHelp(c: HomeHelpRecipientConsent, exactActor: boolean): HomeHelpRecipientConsent {
  //@ ensures (inv(c) && canWithdrawHomeHelp(c, exactActor)) ==> stepAcceptanceFollowsDelivery(c, \result)
  //@ ensures (inv(c) && canWithdrawHomeHelp(c, exactActor)) ==> stepStoppedConsentStaysStopped(c, \result)
  return canWithdrawHomeHelp(c, exactActor) ? ({ phase: "Withdrawn" } as HomeHelpRecipientConsent) : c;
}

/** Story: Decide privately about the exact reviewed plan / Any withdrawal or invalidation stops the reviewed consent (spec/homeHelpConsent.md) */
//@ pure
export function canInvalidateHomeHelp(c: HomeHelpRecipientConsent, planInvalidated: boolean): boolean {
  return planInvalidated && (c.phase === "Pending" || c.phase === "Sent" || c.phase === "Accepted");
}

/** Story: Decide privately about the exact reviewed plan / Any withdrawal or invalidation stops the reviewed consent (spec/homeHelpConsent.md) */
//@ pure
export function invalidateHomeHelp(c: HomeHelpRecipientConsent, planInvalidated: boolean): HomeHelpRecipientConsent {
  //@ ensures (inv(c) && canInvalidateHomeHelp(c, planInvalidated)) ==> stepAcceptanceFollowsDelivery(c, \result)
  //@ ensures (inv(c) && canInvalidateHomeHelp(c, planInvalidated)) ==> stepStoppedConsentStaysStopped(c, \result)
  return canInvalidateHomeHelp(c, planInvalidated) ? ({ phase: "Cancelled" } as HomeHelpRecipientConsent) : c;
}

/** Story: Decide privately about the exact reviewed plan / Any withdrawal or invalidation stops the reviewed consent (spec/homeHelpConsent.md) */
//@ pure
export function stepStoppedConsentStaysStopped(before: HomeHelpRecipientConsent, after: HomeHelpRecipientConsent): boolean {
  return !homeHelpConsentStopped(before.phase) || before.phase === after.phase;
}

/** Story: Decide privately about the exact reviewed plan / Any withdrawal or invalidation stops the reviewed consent (spec/homeHelpConsent.md) */
//@ pure
export function sometimesConsentWithdrawn(c: HomeHelpRecipientConsent): boolean {
  return c.phase === "Withdrawn";
}

/** Story: Decide privately about the exact reviewed plan / Any withdrawal or invalidation stops the reviewed consent (spec/homeHelpConsent.md) */
//@ pure
export function sometimesConsentCancelled(c: HomeHelpRecipientConsent): boolean {
  return c.phase === "Cancelled";
}

/** Story: Decide privately about the exact reviewed plan / The requester and every member of the exact roster must accept (spec/homeHelpConsent.md) */
//@ pure
export function homeHelpConsentComplete(reviewedNow: boolean, exactRoster: boolean, expected: number, accepted: number): boolean {
  return reviewedNow && exactRoster && expected >= 2 && expected <= 4 && accepted === expected;
}

/** Story: Decide privately about the exact reviewed plan / The requester and every member of the exact roster must accept (spec/homeHelpConsent.md) */
//@ pure
export function lawMissingAcceptanceWithholdsConsent(reviewedNow: boolean, exactRoster: boolean, expected: number, accepted: number): boolean {
  //@ ensures \result === true
  return !(accepted < expected) || !homeHelpConsentComplete(reviewedNow, exactRoster, expected, accepted);
}

/** Story: Decide privately about the exact reviewed plan / The requester and every member of the exact roster must accept (spec/homeHelpConsent.md) */
//@ pure
export function lawStaleRevisionWithholdsConsent(exactRoster: boolean, expected: number, accepted: number): boolean {
  //@ ensures \result === true
  return !homeHelpConsentComplete(false, exactRoster, expected, accepted);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: HomeHelpRecipientConsent, event: Event): boolean {
  if (event.type === "stageNotice") return canStageNotice(current, event.reviewedNow);
  if (event.type === "recordNoticeSent") return canRecordNoticeSent(current, event.deliveryAllowed, event.exactReceipt);
  if (event.type === "chooseHomeHelp") return canChooseHomeHelp(current, event.responseAllowed, event.exactActor);
  if (event.type === "withdrawHomeHelp") return canWithdrawHomeHelp(current, event.exactActor);
  if (event.type === "invalidateHomeHelp") return canInvalidateHomeHelp(current, event.planInvalidated);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: HomeHelpRecipientConsent, event: Event): HomeHelpRecipientConsent {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "stageNotice") return canStageNotice(current, event.reviewedNow) ? stageNotice(current, event.reviewedNow) : current;
  if (event.type === "recordNoticeSent") return canRecordNoticeSent(current, event.deliveryAllowed, event.exactReceipt) ? recordNoticeSent(current, event.deliveryAllowed, event.exactReceipt) : current;
  if (event.type === "chooseHomeHelp") return canChooseHomeHelp(current, event.responseAllowed, event.exactActor) ? chooseHomeHelp(current, event.responseAllowed, event.exactActor, event.wantsHelp) : current;
  if (event.type === "withdrawHomeHelp") return canWithdrawHomeHelp(current, event.exactActor) ? withdrawHomeHelp(current, event.exactActor) : current;
  if (event.type === "invalidateHomeHelp") return canInvalidateHomeHelp(current, event.planInvalidated) ? invalidateHomeHelp(current, event.planInvalidated) : current;
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
  if (raw.type === "stageNotice" && typeof raw.reviewedNow === "boolean") return { type: "stageNotice", reviewedNow: raw.reviewedNow };
  if (raw.type === "recordNoticeSent" && typeof raw.deliveryAllowed === "boolean" && typeof raw.exactReceipt === "boolean") return { type: "recordNoticeSent", deliveryAllowed: raw.deliveryAllowed, exactReceipt: raw.exactReceipt };
  if (raw.type === "chooseHomeHelp" && typeof raw.responseAllowed === "boolean" && typeof raw.exactActor === "boolean" && typeof raw.wantsHelp === "boolean") return { type: "chooseHomeHelp", responseAllowed: raw.responseAllowed, exactActor: raw.exactActor, wantsHelp: raw.wantsHelp };
  if (raw.type === "withdrawHomeHelp" && typeof raw.exactActor === "boolean") return { type: "withdrawHomeHelp", exactActor: raw.exactActor };
  if (raw.type === "invalidateHomeHelp" && typeof raw.planInvalidated === "boolean") return { type: "invalidateHomeHelp", planInvalidated: raw.planInvalidated };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): HomeHelpRecipientConsent | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Unstaged" || raw.phase === "Pending" || raw.phase === "Sent" || raw.phase === "Accepted" || raw.phase === "Declined" || raw.phase === "Withdrawn" || raw.phase === "Cancelled") && Object.keys(raw).length === 1)) return undefined;
  const parsed: HomeHelpRecipientConsent = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): HomeHelpRecipientConsent {
  //@ ensures inv(\result)
  return initial;
}
