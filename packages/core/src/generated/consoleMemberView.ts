// GENERATED from spec/consoleMemberView.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
export interface DetailGate { lastTicket: number; closedThrough: number }
/** Story: Read details for the current subject / The timeline shows recorded delivery and leak evidence for the exact message (spec/consoleMemberView.md) */
export type ConsoleDeliveryGuard = "DeliveryGuardUnrecorded" | "DeliveryGuardBlocked" | "DeliveryGuardReleased" | "DeliveryGuardChecked";
/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md) */
export type StaffPhotoView = "HidePhotos" | "ShowPhotoForm" | "ShowGallery";

/** One variant per transition in the spec. */
export type Event =
  | { type: "beginDetail" }
  | { type: "cancelDetails" }
  | { type: "finishDetail"; readTicket: number };

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
export const initial: DetailGate = { lastTicket: 0, closedThrough: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: DetailGate): boolean {
  return alwaysTicketBounds(current);
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
//@ pure
export function beginDetail(gate: DetailGate): DetailGate {
  //@ ensures (inv(gate)) ==> alwaysTicketBounds(\result)
  //@ ensures (inv(gate)) ==> stepDetailBoundaryNeverFalls(gate, \result)
  return { ...gate, lastTicket: exact_consoleMemberView(gate.lastTicket + 1) };
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
//@ pure
export function cancelDetails(gate: DetailGate): DetailGate {
  //@ ensures (inv(gate)) ==> alwaysTicketBounds(\result)
  //@ ensures (inv(gate)) ==> stepDetailBoundaryNeverFalls(gate, \result)
  return { ...gate, closedThrough: gate.lastTicket };
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
//@ pure
export function canFinishDetail(gate: DetailGate, readTicket: number): boolean {
  return readTicket > gate.closedThrough && readTicket <= gate.lastTicket;
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
//@ pure
export function finishDetail(gate: DetailGate, readTicket: number): DetailGate {
  //@ ensures (inv(gate) && canFinishDetail(gate, readTicket)) ==> alwaysTicketBounds(\result)
  //@ ensures (inv(gate) && canFinishDetail(gate, readTicket)) ==> stepDetailBoundaryNeverFalls(gate, \result)
  return { ...gate, closedThrough: readTicket };
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
//@ pure
export function alwaysTicketBounds(gate: DetailGate): boolean {
  return gate.closedThrough >= 0 && gate.closedThrough <= gate.lastTicket;
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
//@ pure
export function stepDetailBoundaryNeverFalls(before: DetailGate, after: DetailGate): boolean {
  return after.closedThrough >= before.closedThrough;
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
//@ pure
export function sometimesADetailFinishes(gate: DetailGate): boolean {
  return gate.lastTicket > 0 && gate.closedThrough === gate.lastTicket;
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md) */
//@ pure
export function sometimesADetailWaits(gate: DetailGate): boolean {
  return gate.closedThrough < gate.lastTicket;
}

/** Story: Read details for the current subject / Serving revealed details requires current staff authority (spec/consoleMemberView.md) */
//@ pure
export function staffRevealMayDisclose(sameView: boolean, safetyAllowed: boolean, signInCurrent: boolean, grantTimeLeftMs: number): boolean {
  return sameView && safetyAllowed && signInCurrent && grantTimeLeftMs > 0;
}

/** Story: Read details for the current subject / Serving revealed details requires current staff authority (spec/consoleMemberView.md) */
//@ pure
export function lawStaffRevealNeedsCurrentSafety(sameView: boolean, signInCurrent: boolean, grantTimeLeftMs: number): boolean {
  //@ ensures \result === true
  return !staffRevealMayDisclose(sameView, false, signInCurrent, grantTimeLeftMs);
}

/** Story: Read details for the current subject / The timeline shows recorded delivery and leak evidence for the exact message (spec/consoleMemberView.md) */
//@ pure
export function consoleDeliveryEvidenceAllowed(sameApp: boolean, sameMember: boolean, sameMessage: boolean, memberOutbound: boolean): boolean {
  return sameApp && sameMember && sameMessage && memberOutbound;
}

/** Story: Read details for the current subject / The timeline shows recorded delivery and leak evidence for the exact message (spec/consoleMemberView.md) */
//@ pure
export function consoleDeliveryGuard(exactEvidence: boolean, leakStopped: boolean, staffReleased: boolean, attempted: boolean): ConsoleDeliveryGuard {
  return !exactEvidence ? "DeliveryGuardUnrecorded" : (leakStopped ? "DeliveryGuardBlocked" : (staffReleased ? "DeliveryGuardReleased" : (attempted ? "DeliveryGuardChecked" : "DeliveryGuardUnrecorded")));
}

/** Story: Read details for the current subject / The timeline shows recorded delivery and leak evidence for the exact message (spec/consoleMemberView.md) */
//@ pure
export function consolePreparedBodyWithheld(guardResult: ConsoleDeliveryGuard, storedLeakStop: boolean): boolean {
  return guardResult === "DeliveryGuardBlocked" || storedLeakStop;
}

/** Story: Read details for the current subject / The timeline shows recorded delivery and leak evidence for the exact message (spec/consoleMemberView.md) */
//@ pure
export function lawUnmatchedDeliveryShowsNoLeakCheck(leakStopped: boolean, staffReleased: boolean, attempted: boolean): boolean {
  //@ ensures \result === true
  return consoleDeliveryGuard(false, leakStopped, staffReleased, attempted) === "DeliveryGuardUnrecorded";
}

/** Story: Read details for the current subject / The timeline shows recorded delivery and leak evidence for the exact message (spec/consoleMemberView.md) */
//@ pure
export function lawUnattemptedDeliveryCannotShowChecked(exactEvidence: boolean, leakStopped: boolean, staffReleased: boolean): boolean {
  //@ ensures \result === true
  return consoleDeliveryGuard(exactEvidence, leakStopped, staffReleased, false) !== "DeliveryGuardChecked";
}

/** Story: Read details for the current subject / The timeline shows recorded delivery and leak evidence for the exact message (spec/consoleMemberView.md) */
//@ pure
export function lawRecordedLeakStopWithholdsPreparedBody(guardResult: ConsoleDeliveryGuard): boolean {
  //@ ensures \result === true
  return consolePreparedBodyWithheld(guardResult, true);
}

/** Story: Read details for the current subject / A booked plan shows only receipts for its current notice (spec/consoleMemberView.md) */
//@ pure
export function consoleBookingReceiptCurrent(exactBooking: boolean, recipientOnRoster: boolean, delivered: boolean, receivedAt: number, asOf: number): boolean {
  return exactBooking && recipientOnRoster && delivered && receivedAt >= 0 && receivedAt <= asOf;
}

/** Story: Read details for the current subject / A booked plan shows only receipts for its current notice (spec/consoleMemberView.md) */
//@ pure
export function lawUnreceivedBookingHasNoClock(exactBooking: boolean, recipientOnRoster: boolean, receivedAt: number, asOf: number): boolean {
  //@ ensures \result === true
  return !consoleBookingReceiptCurrent(exactBooking, recipientOnRoster, false, receivedAt, asOf);
}

/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md) */
//@ pure
export function staffPhotoAllowed(rulePermitsRead: boolean, canSafety: boolean, liveAdult: boolean): boolean {
  return rulePermitsRead && canSafety && liveAdult;
}

/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md) */
//@ pure
export function staffPhotoView(allowedRead: boolean, loaded: boolean): StaffPhotoView {
  return !allowedRead ? "HidePhotos" : (loaded ? "ShowGallery" : "ShowPhotoForm");
}

/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md) */
//@ pure
export function staffPhotoReasonReady(lengthOfReason: number): boolean {
  return lengthOfReason >= 5;
}

/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md) */
//@ pure
export function lawGalleryNeedsPermission(allowedRead: boolean, loaded: boolean): boolean {
  //@ ensures \result === true
  return !(staffPhotoView(allowedRead, loaded) === "ShowGallery") || (allowedRead && loaded);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: DetailGate, event: Event): boolean {
  if (event.type === "beginDetail") return true;
  if (event.type === "cancelDetails") return true;
  if (event.type === "finishDetail") return canFinishDetail(current, event.readTicket);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: DetailGate, event: Event): DetailGate {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "beginDetail") return beginDetail(current);
  if (event.type === "cancelDetails") return cancelDetails(current);
  if (event.type === "finishDetail") return canFinishDetail(current, event.readTicket) ? finishDetail(current, event.readTicket) : current;
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
  if (raw.type === "beginDetail") return { type: "beginDetail" };
  if (raw.type === "cancelDetails") return { type: "cancelDetails" };
  if (raw.type === "finishDetail" && Number.isSafeInteger(raw.readTicket)) return { type: "finishDetail", readTicket: raw.readTicket };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): DetailGate | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && Number.isSafeInteger(raw.lastTicket) && Number.isSafeInteger(raw.closedThrough) && Object.keys(raw).length === 2)) return undefined;
  const parsed: DetailGate = ({ lastTicket: raw.lastTicket, closedThrough: raw.closedThrough });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): DetailGate {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_consoleMemberView(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
