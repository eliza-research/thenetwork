// GENERATED from spec/relayLifecycle.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
export type DeliveryResult = "Delivered" | "Queued" | "Refused";
/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
export type RelayVerdict = "Pass" | "Block";
/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
export type RelayPhase = "AwaitingVerdict" | "Blocked" | "ReadyToSend" | "Sent" | "Deferred" | "SendRefused";
/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
export interface RelayLifecycle { phase: RelayPhase; cleared: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordVerdict"; verdict: RelayVerdict }
  | { type: "recordDelivery"; delivery: DeliveryResult };

/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
export const initial: RelayLifecycle = { phase: "AwaitingVerdict", cleared: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: RelayLifecycle): boolean {
  return alwaysClearedExactlyAfterAPass(current);
}

/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
//@ pure
export function recordVerdict(relay: RelayLifecycle, verdict: RelayVerdict): RelayLifecycle {
  //@ ensures (inv(relay) && canRecordVerdict(relay)) ==> alwaysClearedExactlyAfterAPass(\result)
  //@ ensures (inv(relay) && canRecordVerdict(relay)) ==> stepABlockedItemStaysBlocked(relay, \result)
  return verdict === "Pass" ? ({ phase: "ReadyToSend", cleared: true } as RelayLifecycle) : ({ phase: "Blocked", cleared: false } as RelayLifecycle);
}

/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
//@ pure
export function alwaysClearedExactlyAfterAPass(relay: RelayLifecycle): boolean {
  return relay.cleared === (relay.phase === "ReadyToSend" || relay.phase === "Sent" || relay.phase === "Deferred" || relay.phase === "SendRefused");
}

/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
//@ pure
export function stepABlockedItemStaysBlocked(before: RelayLifecycle, after: RelayLifecycle): boolean {
  return !(before.phase === "Blocked") || after.phase === "Blocked";
}

/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
//@ pure
export function sometimesBlocked(relay: RelayLifecycle): boolean {
  return relay.phase === "Blocked";
}

/** Story: Decide and deliver a selected relay item / A first decision blocks or admits an item (spec/relayLifecycle.md) */
//@ pure
export function canRecordVerdict(relay: RelayLifecycle): boolean {
  return relay.phase === "AwaitingVerdict";
}

/** Story: Decide and deliver a selected relay item / The send path determines the result of an admitted item (spec/relayLifecycle.md) */
//@ pure
export function canRecordDelivery(relay: RelayLifecycle): boolean {
  return relay.phase === "ReadyToSend";
}

/** Story: Decide and deliver a selected relay item / The send path determines the result of an admitted item (spec/relayLifecycle.md) */
//@ pure
export function recordDelivery(relay: RelayLifecycle, delivery: DeliveryResult): RelayLifecycle {
  //@ ensures (inv(relay) && canRecordDelivery(relay)) ==> alwaysClearedExactlyAfterAPass(\result)
  //@ ensures (inv(relay) && canRecordDelivery(relay)) ==> stepABlockedItemStaysBlocked(relay, \result)
  return { ...relay, phase: delivery === "Delivered" ? "Sent" : (delivery === "Queued" ? "Deferred" : "SendRefused") };
}

/** Story: Decide and deliver a selected relay item / The send path determines the result of an admitted item (spec/relayLifecycle.md) */
//@ pure
export function sometimesDeliveryWaits(relay: RelayLifecycle): boolean {
  return relay.phase === "Deferred";
}

/** Story: Decide and deliver a selected relay item / The send path determines the result of an admitted item (spec/relayLifecycle.md) */
//@ pure
export function sometimesSent(relay: RelayLifecycle): boolean {
  return relay.phase === "Sent";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: RelayLifecycle, event: Event): boolean {
  if (event.type === "recordVerdict") return canRecordVerdict(current);
  if (event.type === "recordDelivery") return canRecordDelivery(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: RelayLifecycle, event: Event): RelayLifecycle {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordVerdict") return canRecordVerdict(current) ? recordVerdict(current, event.verdict) : current;
  if (event.type === "recordDelivery") return canRecordDelivery(current) ? recordDelivery(current, event.delivery) : current;
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
  if (raw.type === "recordVerdict" && (raw.verdict === "Pass" || raw.verdict === "Block")) return { type: "recordVerdict", verdict: raw.verdict };
  if (raw.type === "recordDelivery" && (raw.delivery === "Delivered" || raw.delivery === "Queued" || raw.delivery === "Refused")) return { type: "recordDelivery", delivery: raw.delivery };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingVerdict" || raw.phase === "Blocked" || raw.phase === "ReadyToSend" || raw.phase === "Sent" || raw.phase === "Deferred" || raw.phase === "SendRefused") && typeof raw.cleared === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: RelayLifecycle = ({ phase: raw.phase, cleared: raw.cleared });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): RelayLifecycle {
  //@ ensures inv(\result)
  return initial;
}
