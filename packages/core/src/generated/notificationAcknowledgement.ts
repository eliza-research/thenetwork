// GENERATED from spec/notificationAcknowledgement.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
export type AcknowledgementPhase = "AcknowledgementStarting" | "AwaitingReadToken" | "MarkingInboxSeen" | "InboxSeen" | "NoInboxRead" | "DeliveryUnchanged" | "DeliveryActed";
/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
export interface AcknowledgementFlow { phase: AcknowledgementPhase }

/** One variant per transition in the spec. */
export type Event =
  | { type: "selectInboxRead"; withToken: boolean }
  | { type: "resolveInboxReadToken"; valid: boolean }
  | { type: "selectShownSubjects"; hasVisibleItems: boolean }
  | { type: "recordInboxSeen" }
  | { type: "readDeliveryClosure"; deliveryClosed: boolean };

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
export const initial: AcknowledgementFlow = { phase: "AcknowledgementStarting" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: AcknowledgementFlow): boolean {
  return true;
}

/** Story: See my own updates on the surface I am using / A scoped surface shows only items from its app (spec/notificationAcknowledgement.md) */
//@ pure
export function appAllowsInboxItem(scoped: boolean, sameApp: boolean): boolean {
  return !scoped || sameApp;
}

/** Story: See my own updates on the surface I am using / A scoped surface shows only items from its app (spec/notificationAcknowledgement.md) */
//@ pure
export function lawScopedReadRequiresAppMatch(sameApp: boolean): boolean {
  //@ ensures \result === true
  return !appAllowsInboxItem(true, sameApp) || sameApp;
}

/** Story: See my own updates on the surface I am using / A delivered text can appear only once and its opportunity must still be current (spec/notificationAcknowledgement.md) */
//@ pure
export function inboxOpportunityTerminal(opportunityStatus: string): boolean {
  return opportunityStatus === "COMPLETED" || opportunityStatus === "FEEDBACK_COLLECTED" || opportunityStatus === "DECLINED" || opportunityStatus === "EXPIRED" || opportunityStatus === "CANCELLED" || opportunityStatus === "SKIPPED" || opportunityStatus === "ABANDONED" || opportunityStatus === "QUORUM_FAILED";
}

/** Story: See my own updates on the surface I am using / A delivered text can appear only once and its opportunity must still be current (spec/notificationAcknowledgement.md) */
//@ pure
export function inboxOpportunityAllowsUpdate(bound: boolean, found: boolean, opportunityStatus: string): boolean {
  return !bound || (found && !inboxOpportunityTerminal(opportunityStatus));
}

/** Story: See my own updates on the surface I am using / A delivered text can appear only once and its opportunity must still be current (spec/notificationAcknowledgement.md) */
//@ pure
export function lawClosedOpportunityCannotDisplay(opportunityStatus: string): boolean {
  //@ ensures \result === true
  return !inboxOpportunityTerminal(opportunityStatus) || !inboxOpportunityAllowsUpdate(true, true, opportunityStatus);
}

/** Story: See my own updates on the surface I am using / A delivered text can appear only once and its opportunity must still be current (spec/notificationAcknowledgement.md) */
//@ pure
export function lawMissingBoundOpportunityCannotDisplay(opportunityStatus: string): boolean {
  //@ ensures \result === true
  return !inboxOpportunityAllowsUpdate(true, false, opportunityStatus);
}

/** Story: See my own updates on the surface I am using / Only a live update token of this member can resolve items (spec/notificationAcknowledgement.md) */
//@ pure
export function mayRedeemInboxToken(sameOwner: boolean, expiresAt: number, at: number): boolean {
  return sameOwner && !(expiresAt <= at);
}

/** Story: See my own updates on the surface I am using / Only a live update token of this member can resolve items (spec/notificationAcknowledgement.md) */
//@ pure
export function lawInboxTokenExpiresAtDeadline(expiresAt: number): boolean {
  //@ ensures \result === true
  return !mayRedeemInboxToken(true, expiresAt, expiresAt);
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function canSelectInboxRead(flow: AcknowledgementFlow): boolean {
  return flow.phase === "AcknowledgementStarting";
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function selectInboxRead(flow: AcknowledgementFlow, withToken: boolean): AcknowledgementFlow {
  //@ ensures (inv(flow) && canSelectInboxRead(flow)) ==> stepInboxResponseFollowsSeenWrite(flow, "selectInboxRead", \result)
  return { phase: withToken ? "AwaitingReadToken" : "MarkingInboxSeen" };
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function canResolveInboxReadToken(flow: AcknowledgementFlow): boolean {
  return flow.phase === "AwaitingReadToken";
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function resolveInboxReadToken(flow: AcknowledgementFlow, valid: boolean): AcknowledgementFlow {
  //@ ensures (inv(flow) && canResolveInboxReadToken(flow)) ==> stepInboxResponseFollowsSeenWrite(flow, "resolveInboxReadToken", \result)
  return { phase: valid ? "MarkingInboxSeen" : "NoInboxRead" };
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function canSelectShownSubjects(flow: AcknowledgementFlow): boolean {
  return flow.phase === "AcknowledgementStarting";
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function selectShownSubjects(flow: AcknowledgementFlow, hasVisibleItems: boolean): AcknowledgementFlow {
  //@ ensures (inv(flow) && canSelectShownSubjects(flow)) ==> stepInboxResponseFollowsSeenWrite(flow, "selectShownSubjects", \result)
  return { phase: hasVisibleItems ? "MarkingInboxSeen" : "NoInboxRead" };
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function canRecordInboxSeen(flow: AcknowledgementFlow): boolean {
  return flow.phase === "MarkingInboxSeen";
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function recordInboxSeen(flow: AcknowledgementFlow): AcknowledgementFlow {
  //@ ensures (inv(flow) && canRecordInboxSeen(flow)) ==> stepInboxResponseFollowsSeenWrite(flow, "recordInboxSeen", \result)
  return { phase: "InboxSeen" };
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function stepInboxResponseFollowsSeenWrite(before: AcknowledgementFlow, via: string, after: AcknowledgementFlow): boolean {
  return !(after.phase === "InboxSeen") || (before.phase === "MarkingInboxSeen" && via === "recordInboxSeen");
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function sometimesMarksInboxSeen(flow: AcknowledgementFlow): boolean {
  return flow.phase === "InboxSeen";
}

/** Story: See my own updates on the surface I am using / A read marks the selected items seen before responding (spec/notificationAcknowledgement.md) */
//@ pure
export function sometimesLeavesInboxUnchanged(flow: AcknowledgementFlow): boolean {
  return flow.phase === "NoInboxRead";
}

/** Story: See my own updates on the surface I am using / Count a delivery action only when the store closes a pending delivery (spec/notificationAcknowledgement.md) */
//@ pure
export function canReadDeliveryClosure(flow: AcknowledgementFlow): boolean {
  return flow.phase === "AcknowledgementStarting";
}

/** Story: See my own updates on the surface I am using / Count a delivery action only when the store closes a pending delivery (spec/notificationAcknowledgement.md) */
//@ pure
export function readDeliveryClosure(flow: AcknowledgementFlow, deliveryClosed: boolean): AcknowledgementFlow {
  //@ ensures (inv(flow) && canReadDeliveryClosure(flow)) ==> stepInboxResponseFollowsSeenWrite(flow, "readDeliveryClosure", \result)
  return { phase: deliveryClosed ? "DeliveryActed" : "DeliveryUnchanged" };
}

/** Story: See my own updates on the surface I am using / Count a delivery action only when the store closes a pending delivery (spec/notificationAcknowledgement.md) */
//@ pure
export function sometimesRecordsDeliveryAction(flow: AcknowledgementFlow): boolean {
  return flow.phase === "DeliveryActed";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: AcknowledgementFlow, event: Event): boolean {
  if (event.type === "selectInboxRead") return canSelectInboxRead(current);
  if (event.type === "resolveInboxReadToken") return canResolveInboxReadToken(current);
  if (event.type === "selectShownSubjects") return canSelectShownSubjects(current);
  if (event.type === "recordInboxSeen") return canRecordInboxSeen(current);
  if (event.type === "readDeliveryClosure") return canReadDeliveryClosure(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: AcknowledgementFlow, event: Event): AcknowledgementFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "selectInboxRead" && canSelectInboxRead(current)) return selectInboxRead(current, event.withToken);
  if (event.type === "resolveInboxReadToken" && canResolveInboxReadToken(current)) return resolveInboxReadToken(current, event.valid);
  if (event.type === "selectShownSubjects" && canSelectShownSubjects(current)) return selectShownSubjects(current, event.hasVisibleItems);
  if (event.type === "recordInboxSeen" && canRecordInboxSeen(current)) return recordInboxSeen(current);
  if (event.type === "readDeliveryClosure" && canReadDeliveryClosure(current)) return readDeliveryClosure(current, event.deliveryClosed);
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
  if (raw.type === "selectInboxRead" && typeof raw.withToken === "boolean") return { type: "selectInboxRead", withToken: raw.withToken };
  if (raw.type === "resolveInboxReadToken" && typeof raw.valid === "boolean") return { type: "resolveInboxReadToken", valid: raw.valid };
  if (raw.type === "selectShownSubjects" && typeof raw.hasVisibleItems === "boolean") return { type: "selectShownSubjects", hasVisibleItems: raw.hasVisibleItems };
  if (raw.type === "recordInboxSeen") return { type: "recordInboxSeen" };
  if (raw.type === "readDeliveryClosure" && typeof raw.deliveryClosed === "boolean") return { type: "readDeliveryClosure", deliveryClosed: raw.deliveryClosed };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): AcknowledgementFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AcknowledgementStarting" || raw.phase === "AwaitingReadToken" || raw.phase === "MarkingInboxSeen" || raw.phase === "InboxSeen" || raw.phase === "NoInboxRead" || raw.phase === "DeliveryUnchanged" || raw.phase === "DeliveryActed") && Object.keys(raw).length === 1)) return undefined;
  const parsed: AcknowledgementFlow = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): AcknowledgementFlow {
  //@ ensures inv(\result)
  return initial;
}
