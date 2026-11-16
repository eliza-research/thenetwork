// GENERATED from spec/outboundReceipt.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export type ReceiptPhase = "Sending" | "LegacyQueued" | "ProviderAccepted" | "ProviderSent" | "ProviderDelivered" | "ProviderRead" | "ProviderFailed" | "AcceptanceUnknown" | "AcceptanceExpired" | "RetryScheduled" | "WaitingForReply" | "ProviderBlocked" | "OutsideReceipt";
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export interface ReceiptLifecycle { phase: ReceiptPhase }
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md:72) */
export type FailureKind = "UnknownResult" | "Retryable" | "NeedReply" | "BlockedNumber" | "TerminalError";

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordAcceptance"; providerPhase: ReceiptPhase }
  | { type: "applyReceipt"; providerPhase: ReceiptPhase }
  | { type: "confirmNeverAdmitted"; neverAdmitted: boolean }
  | { type: "expireUnknown"; pastLimit: boolean }
  | { type: "recordProviderError"; failure: FailureKind; hasAttemptsLeft: boolean };

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export const initial: ReceiptLifecycle = { phase: "Sending" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ReceiptLifecycle): boolean {
  return true;
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
//@ pure
export function receiptRank(phase: ReceiptPhase): number {
  return phase === "ProviderAccepted" || phase === "LegacyQueued" ? 1 : (phase === "ProviderSent" ? 2 : (phase === "ProviderDelivered" ? 3 : (phase === "ProviderRead" ? 4 : 0)));
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
//@ pure
export function recordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canRecordAcceptance(outbound, providerPhase)) ==> stepReceiptsDoNotRegress(outbound, "recordAcceptance", \result)
  return { phase: providerPhase };
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
//@ pure
export function applyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canApplyReceipt(outbound, providerPhase)) ==> stepReceiptsDoNotRegress(outbound, "applyReceipt", \result)
  return { phase: providerPhase };
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
//@ pure
export function canRecordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): boolean {
  return (outbound.phase === "Sending" || outbound.phase === "AcceptanceUnknown") && ((receiptRank(providerPhase) > 0 && providerPhase !== "LegacyQueued") || providerPhase === "ProviderFailed");
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
//@ pure
export function stepReceiptsDoNotRegress(before: ReceiptLifecycle, via: string, after: ReceiptLifecycle): boolean {
  return !(via === "applyReceipt" && after.phase !== "ProviderFailed") || receiptRank(after.phase) > receiptRank(before.phase);
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
//@ pure
export function canApplyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): boolean {
  const rank: number = receiptRank(outbound.phase);
  return rank > 0 && (providerPhase === "ProviderFailed" ? outbound.phase === "ProviderAccepted" || outbound.phase === "ProviderSent" : receiptRank(providerPhase) > rank);
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
//@ pure
export function lawDeliveredIgnoresFailure(phase: ReceiptPhase): boolean {
  //@ ensures \result === true
  return !(phase === "ProviderDelivered" || phase === "ProviderRead") || !canApplyReceipt(({ phase: phase } as ReceiptLifecycle), "ProviderFailed");
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
//@ pure
export function canConfirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: boolean): boolean {
  return outbound.phase === "AcceptanceUnknown" && neverAdmitted;
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
//@ pure
export function confirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: boolean): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canConfirmNeverAdmitted(outbound, neverAdmitted)) ==> stepReceiptsDoNotRegress(outbound, "confirmNeverAdmitted", \result)
  return { phase: "RetryScheduled" };
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
//@ pure
export function canExpireUnknown(outbound: ReceiptLifecycle, pastLimit: boolean): boolean {
  return outbound.phase === "AcceptanceUnknown" && pastLimit;
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
//@ pure
export function expireUnknown(outbound: ReceiptLifecycle, pastLimit: boolean): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canExpireUnknown(outbound, pastLimit)) ==> stepReceiptsDoNotRegress(outbound, "expireUnknown", \result)
  return { phase: "AcceptanceExpired" };
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
//@ pure
export function sometimesCanCheckUnknown(outbound: ReceiptLifecycle): boolean {
  return outbound.phase === "AcceptanceUnknown";
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
//@ pure
export function sometimesCanRead(outbound: ReceiptLifecycle): boolean {
  return outbound.phase === "ProviderRead";
}

/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md:72) */
//@ pure
export function canRecordProviderError(outbound: ReceiptLifecycle): boolean {
  return outbound.phase === "Sending";
}

/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md:72) */
//@ pure
export function recordProviderError(outbound: ReceiptLifecycle, failure: FailureKind, hasAttemptsLeft: boolean): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canRecordProviderError(outbound)) ==> stepReceiptsDoNotRegress(outbound, "recordProviderError", \result)
  return { phase: failure === "UnknownResult" ? "AcceptanceUnknown" : (failure === "NeedReply" ? "WaitingForReply" : (failure === "BlockedNumber" ? "ProviderBlocked" : (failure === "Retryable" && hasAttemptsLeft ? "RetryScheduled" : "ProviderFailed"))) };
}

/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md:72) */
//@ pure
export function lawAnUnknownResultDoesNotRetry(hasAttemptsLeft: boolean): boolean {
  //@ ensures \result === true
  return recordProviderError(initial, "UnknownResult", hasAttemptsLeft).phase === "AcceptanceUnknown";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ReceiptLifecycle, event: Event): boolean {
  if (event.type === "recordAcceptance") return canRecordAcceptance(current, event.providerPhase);
  if (event.type === "applyReceipt") return canApplyReceipt(current, event.providerPhase);
  if (event.type === "confirmNeverAdmitted") return canConfirmNeverAdmitted(current, event.neverAdmitted);
  if (event.type === "expireUnknown") return canExpireUnknown(current, event.pastLimit);
  if (event.type === "recordProviderError") return canRecordProviderError(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ReceiptLifecycle, event: Event): ReceiptLifecycle {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordAcceptance" && canRecordAcceptance(current, event.providerPhase)) return recordAcceptance(current, event.providerPhase);
  if (event.type === "applyReceipt" && canApplyReceipt(current, event.providerPhase)) return applyReceipt(current, event.providerPhase);
  if (event.type === "confirmNeverAdmitted" && canConfirmNeverAdmitted(current, event.neverAdmitted)) return confirmNeverAdmitted(current, event.neverAdmitted);
  if (event.type === "expireUnknown" && canExpireUnknown(current, event.pastLimit)) return expireUnknown(current, event.pastLimit);
  if (event.type === "recordProviderError" && canRecordProviderError(current)) return recordProviderError(current, event.failure, event.hasAttemptsLeft);
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
  if (raw.type === "recordAcceptance" && (raw.providerPhase === "Sending" || raw.providerPhase === "LegacyQueued" || raw.providerPhase === "ProviderAccepted" || raw.providerPhase === "ProviderSent" || raw.providerPhase === "ProviderDelivered" || raw.providerPhase === "ProviderRead" || raw.providerPhase === "ProviderFailed" || raw.providerPhase === "AcceptanceUnknown" || raw.providerPhase === "AcceptanceExpired" || raw.providerPhase === "RetryScheduled" || raw.providerPhase === "WaitingForReply" || raw.providerPhase === "ProviderBlocked" || raw.providerPhase === "OutsideReceipt")) return { type: "recordAcceptance", providerPhase: raw.providerPhase };
  if (raw.type === "applyReceipt" && (raw.providerPhase === "Sending" || raw.providerPhase === "LegacyQueued" || raw.providerPhase === "ProviderAccepted" || raw.providerPhase === "ProviderSent" || raw.providerPhase === "ProviderDelivered" || raw.providerPhase === "ProviderRead" || raw.providerPhase === "ProviderFailed" || raw.providerPhase === "AcceptanceUnknown" || raw.providerPhase === "AcceptanceExpired" || raw.providerPhase === "RetryScheduled" || raw.providerPhase === "WaitingForReply" || raw.providerPhase === "ProviderBlocked" || raw.providerPhase === "OutsideReceipt")) return { type: "applyReceipt", providerPhase: raw.providerPhase };
  if (raw.type === "confirmNeverAdmitted" && typeof raw.neverAdmitted === "boolean") return { type: "confirmNeverAdmitted", neverAdmitted: raw.neverAdmitted };
  if (raw.type === "expireUnknown" && typeof raw.pastLimit === "boolean") return { type: "expireUnknown", pastLimit: raw.pastLimit };
  if (raw.type === "recordProviderError" && (raw.failure === "UnknownResult" || raw.failure === "Retryable" || raw.failure === "NeedReply" || raw.failure === "BlockedNumber" || raw.failure === "TerminalError") && typeof raw.hasAttemptsLeft === "boolean") return { type: "recordProviderError", failure: raw.failure, hasAttemptsLeft: raw.hasAttemptsLeft };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ReceiptLifecycle | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Sending" || raw.phase === "LegacyQueued" || raw.phase === "ProviderAccepted" || raw.phase === "ProviderSent" || raw.phase === "ProviderDelivered" || raw.phase === "ProviderRead" || raw.phase === "ProviderFailed" || raw.phase === "AcceptanceUnknown" || raw.phase === "AcceptanceExpired" || raw.phase === "RetryScheduled" || raw.phase === "WaitingForReply" || raw.phase === "ProviderBlocked" || raw.phase === "OutsideReceipt") && Object.keys(raw).length === 1)) return undefined;
  const parsed: ReceiptLifecycle = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ReceiptLifecycle {
  //@ ensures inv(\result)
  return initial;
}
