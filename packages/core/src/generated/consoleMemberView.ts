// GENERATED from spec/consoleMemberView.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
export interface DetailGate { lastTicket: number; closedThrough: number }
/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md:35) */
export type StaffPhotoView = "HidePhotos" | "ShowPhotoForm" | "ShowGallery";

/** One variant per transition in the spec. */
export type Event =
  | { type: "beginDetail" }
  | { type: "cancelDetails" }
  | { type: "finishDetail"; readTicket: number };

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
export const initial: DetailGate = { lastTicket: 0, closedThrough: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: DetailGate): boolean {
  return alwaysTicketBounds(current);
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
//@ pure
export function sometimesADetailFinishes(gate: DetailGate): boolean {
  return gate.lastTicket > 0 && gate.closedThrough === gate.lastTicket;
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
//@ pure
export function sometimesADetailWaits(gate: DetailGate): boolean {
  return gate.closedThrough < gate.lastTicket;
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
//@ pure
export function beginDetail(gate: DetailGate): DetailGate {
  //@ ensures (inv(gate)) ==> alwaysTicketBounds(\result)
  //@ ensures (inv(gate)) ==> stepDetailBoundaryNeverFalls(gate, \result)
  return { ...gate, lastTicket: gate.lastTicket + 1 };
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
//@ pure
export function cancelDetails(gate: DetailGate): DetailGate {
  //@ ensures (inv(gate)) ==> alwaysTicketBounds(\result)
  //@ ensures (inv(gate)) ==> stepDetailBoundaryNeverFalls(gate, \result)
  return { ...gate, closedThrough: gate.lastTicket };
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
//@ pure
export function canFinishDetail(gate: DetailGate, readTicket: number): boolean {
  return readTicket > gate.closedThrough && readTicket <= gate.lastTicket;
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
//@ pure
export function finishDetail(gate: DetailGate, readTicket: number): DetailGate {
  //@ ensures (inv(gate) && canFinishDetail(gate, readTicket)) ==> alwaysTicketBounds(\result)
  //@ ensures (inv(gate) && canFinishDetail(gate, readTicket)) ==> stepDetailBoundaryNeverFalls(gate, \result)
  return { ...gate, closedThrough: readTicket };
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
//@ pure
export function alwaysTicketBounds(gate: DetailGate): boolean {
  return gate.closedThrough >= 0 && gate.closedThrough <= gate.lastTicket;
}

/** Story: Read details for the current subject / Only an outstanding read in the current view can publish (spec/consoleMemberView.md:9) */
//@ pure
export function stepDetailBoundaryNeverFalls(before: DetailGate, after: DetailGate): boolean {
  return after.closedThrough >= before.closedThrough;
}

/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md:35) */
//@ pure
export function staffPhotoAllowed(rulePermitsRead: boolean, canSafety: boolean, liveAdult: boolean): boolean {
  return rulePermitsRead && canSafety && liveAdult;
}

/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md:35) */
//@ pure
export function staffPhotoReasonReady(lengthOfReason: number): boolean {
  return lengthOfReason >= 5;
}

/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md:35) */
//@ pure
export function staffPhotoView(allowedRead: boolean, loaded: boolean): StaffPhotoView {
  return !allowedRead ? "HidePhotos" : (loaded ? "ShowGallery" : "ShowPhotoForm");
}

/** Story: Open Slop photos for a verified adult / Photo access requires the current member and staff permission (spec/consoleMemberView.md:35) */
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
  if (event.type === "finishDetail" && canFinishDetail(current, event.readTicket)) return finishDetail(current, event.readTicket);
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
