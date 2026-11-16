// GENERATED from spec/relayLifecycle.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Decide and deliver a selected relay item / A first decision can block, hold, or admit an item (spec/relayLifecycle.md:9) */
export type RelayPhase = "AwaitingVerdict" | "Blocked" | "RateLimited" | "Held" | "ReadyToSend" | "Released" | "Rejected" | "Sent" | "Deferred" | "SendRefused";
/** Story: Decide and deliver a selected relay item / A first decision can block, hold, or admit an item (spec/relayLifecycle.md:9) */
export type DeliveryResult = "Delivered" | "Queued" | "Refused";
/** Story: Decide and deliver a selected relay item / A first decision can block, hold, or admit an item (spec/relayLifecycle.md:9) */
export type RelayVerdict = "Pass" | "Hold" | "Block";
/** Story: Decide and deliver a selected relay item / A first decision can block, hold, or admit an item (spec/relayLifecycle.md:9) */
export interface RelayLifecycle { phase: RelayPhase; staffReviewed: boolean; retainsText: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordVerdict"; verdict: RelayVerdict; rateOnly: boolean; hasText: boolean; ageSignal: boolean }
  | { type: "recordDelivery"; delivery: DeliveryResult }
  | { type: "reviewHold"; released: boolean };

/** Story: Decide and deliver a selected relay item / A first decision can block, hold, or admit an item (spec/relayLifecycle.md:9) */
export const initial: RelayLifecycle = { phase: "AwaitingVerdict", staffReviewed: false, retainsText: false };
/** Story: Resolve a held item / Staff review clears the held text (spec/relayLifecycle.md:50) */
export const storedHold: RelayLifecycle = { ...initial, phase: "Held" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: RelayLifecycle): boolean {
  return alwaysOnlyHeldItemRetainsText(current);
}

/** Story: Decide and deliver a selected relay item / A first decision can block, hold, or admit an item (spec/relayLifecycle.md:9) */
//@ pure
export function canRecordVerdict(relay: RelayLifecycle): boolean {
  return relay.phase === "AwaitingVerdict";
}

/** Story: Decide and deliver a selected relay item / A first decision can block, hold, or admit an item (spec/relayLifecycle.md:9) */
//@ pure
export function recordVerdict(relay: RelayLifecycle, verdict: RelayVerdict, rateOnly: boolean, hasText: boolean, ageSignal: boolean): RelayLifecycle {
  //@ ensures (inv(relay) && canRecordVerdict(relay)) ==> alwaysOnlyHeldItemRetainsText(\result)
  //@ ensures (inv(relay) && canRecordVerdict(relay)) ==> stepReviewRemainsRecorded(relay, \result)
  return verdict === "Block" ? ({ ...relay, phase: "Blocked" } as RelayLifecycle) : (verdict === "Pass" ? ({ ...relay, phase: "ReadyToSend" } as RelayLifecycle) : (rateOnly ? ({ ...relay, phase: "RateLimited" } as RelayLifecycle) : ({ ...relay, phase: "Held", retainsText: hasText && !ageSignal } as RelayLifecycle)));
}

/** Story: Decide and deliver a selected relay item / A first decision can block, hold, or admit an item (spec/relayLifecycle.md:9) */
//@ pure
export function alwaysOnlyHeldItemRetainsText(relay: RelayLifecycle): boolean {
  return !relay.retainsText || relay.phase === "Held";
}

/** Story: Decide and deliver a selected relay item / The send path determines the result of an admitted item (spec/relayLifecycle.md:33) */
//@ pure
export function canRecordDelivery(relay: RelayLifecycle): boolean {
  return relay.phase === "ReadyToSend" || relay.phase === "Released";
}

/** Story: Decide and deliver a selected relay item / The send path determines the result of an admitted item (spec/relayLifecycle.md:33) */
//@ pure
export function recordDelivery(relay: RelayLifecycle, delivery: DeliveryResult): RelayLifecycle {
  //@ ensures (inv(relay) && canRecordDelivery(relay)) ==> alwaysOnlyHeldItemRetainsText(\result)
  //@ ensures (inv(relay) && canRecordDelivery(relay)) ==> stepReviewRemainsRecorded(relay, \result)
  return { ...relay, phase: delivery === "Delivered" ? "Sent" : (delivery === "Queued" ? "Deferred" : "SendRefused") };
}

/** Story: Decide and deliver a selected relay item / The send path determines the result of an admitted item (spec/relayLifecycle.md:33) */
//@ pure
export function sometimesDeliveryWaits(relay: RelayLifecycle): boolean {
  return relay.phase === "Deferred";
}

/** Story: Resolve a held item / Staff review clears the held text (spec/relayLifecycle.md:50) */
//@ pure
export function canReviewHold(relay: RelayLifecycle): boolean {
  return relay.phase === "Held";
}

/** Story: Resolve a held item / Staff review clears the held text (spec/relayLifecycle.md:50) */
//@ pure
export function reviewHold(relay: RelayLifecycle, released: boolean): RelayLifecycle {
  //@ ensures (inv(relay) && canReviewHold(relay)) ==> alwaysOnlyHeldItemRetainsText(\result)
  //@ ensures (inv(relay) && canReviewHold(relay)) ==> stepReviewRemainsRecorded(relay, \result)
  return { phase: released ? "Released" : "Rejected", staffReviewed: true, retainsText: false };
}

/** Story: Resolve a held item / Staff review clears the held text (spec/relayLifecycle.md:50) */
//@ pure
export function stepReviewRemainsRecorded(before: RelayLifecycle, after: RelayLifecycle): boolean {
  return !before.staffReviewed || after.staffReviewed;
}

/** Story: Resolve a held item / Staff review clears the held text (spec/relayLifecycle.md:50) */
//@ pure
export function sometimesReviewReleases(relay: RelayLifecycle): boolean {
  return relay.phase === "Released";
}

/** Story: Resolve a held item / Staff review clears the held text (spec/relayLifecycle.md:50) */
//@ pure
export function sometimesReviewRejects(relay: RelayLifecycle): boolean {
  return relay.phase === "Rejected";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: RelayLifecycle, event: Event): boolean {
  if (event.type === "recordVerdict") return canRecordVerdict(current);
  if (event.type === "recordDelivery") return canRecordDelivery(current);
  if (event.type === "reviewHold") return canReviewHold(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: RelayLifecycle, event: Event): RelayLifecycle {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordVerdict" && canRecordVerdict(current)) return recordVerdict(current, event.verdict, event.rateOnly, event.hasText, event.ageSignal);
  if (event.type === "recordDelivery" && canRecordDelivery(current)) return recordDelivery(current, event.delivery);
  if (event.type === "reviewHold" && canReviewHold(current)) return reviewHold(current, event.released);
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
  if (raw.type === "recordVerdict" && (raw.verdict === "Pass" || raw.verdict === "Hold" || raw.verdict === "Block") && typeof raw.rateOnly === "boolean" && typeof raw.hasText === "boolean" && typeof raw.ageSignal === "boolean") return { type: "recordVerdict", verdict: raw.verdict, rateOnly: raw.rateOnly, hasText: raw.hasText, ageSignal: raw.ageSignal };
  if (raw.type === "recordDelivery" && (raw.delivery === "Delivered" || raw.delivery === "Queued" || raw.delivery === "Refused")) return { type: "recordDelivery", delivery: raw.delivery };
  if (raw.type === "reviewHold" && typeof raw.released === "boolean") return { type: "reviewHold", released: raw.released };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): RelayLifecycle | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingVerdict" || raw.phase === "Blocked" || raw.phase === "RateLimited" || raw.phase === "Held" || raw.phase === "ReadyToSend" || raw.phase === "Released" || raw.phase === "Rejected" || raw.phase === "Sent" || raw.phase === "Deferred" || raw.phase === "SendRefused") && typeof raw.staffReviewed === "boolean" && typeof raw.retainsText === "boolean" && Object.keys(raw).length === 3)) return undefined;
  const parsed: RelayLifecycle = ({ phase: raw.phase, staffReviewed: raw.staffReviewed, retainsText: raw.retainsText });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): RelayLifecycle {
  //@ ensures inv(\result)
  return initial;
}
