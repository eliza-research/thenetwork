// GENERATED from spec/outboundReceipt.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
export type ReceiptPhase = "Sending" | "LegacyQueued" | "ProviderAccepted" | "ProviderSent" | "ProviderDelivered" | "ProviderRead" | "ProviderFailed" | "AcceptanceUnknown" | "AcceptanceExpired" | "RetryScheduled" | "WaitingForReply" | "ProviderBlocked" | "OutsideReceipt";
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
export interface ReceiptLifecycle { phase: ReceiptPhase }
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) */
export type FailureKind = "UnknownResult" | "Retryable" | "NeedReply" | "BlockedNumber" | "TerminalError";

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordAcceptance"; providerPhase: ReceiptPhase }
  | { type: "applyReceipt"; providerPhase: ReceiptPhase }
  | { type: "holdUnrecordedReceipt" }
  | { type: "confirmNeverAdmitted"; neverAdmitted: boolean }
  | { type: "expireUnknown"; pastLimit: boolean }
  | { type: "recordProviderError"; failure: FailureKind; hasAttemptsLeft: boolean };

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
export const initial: ReceiptLifecycle = { phase: "Sending" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ReceiptLifecycle): boolean {
  return true;
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
//@ pure
export function receiptRank(phase: ReceiptPhase): number {
  return phase === "ProviderAccepted" || phase === "LegacyQueued" ? 1 : (phase === "ProviderSent" ? 2 : (phase === "ProviderDelivered" ? 3 : (phase === "ProviderRead" ? 4 : 0)));
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
//@ pure
export function recordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canRecordAcceptance(outbound, providerPhase)) ==> stepReceiptsDoNotRegress(outbound, "recordAcceptance", \result)
  //@ ensures (inv(outbound) && canRecordAcceptance(outbound, providerPhase)) ==> stepUnrecordedReceiptWaits(outbound, "recordAcceptance", \result)
  return { phase: providerPhase };
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
//@ pure
export function applyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canApplyReceipt(outbound, providerPhase)) ==> stepReceiptsDoNotRegress(outbound, "applyReceipt", \result)
  //@ ensures (inv(outbound) && canApplyReceipt(outbound, providerPhase)) ==> stepUnrecordedReceiptWaits(outbound, "applyReceipt", \result)
  return { phase: providerPhase };
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
//@ pure
export function canRecordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): boolean {
  return (outbound.phase === "Sending" || outbound.phase === "AcceptanceUnknown") && ((receiptRank(providerPhase) > 0 && providerPhase !== "LegacyQueued") || providerPhase === "ProviderFailed");
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
//@ pure
export function stepReceiptsDoNotRegress(before: ReceiptLifecycle, via: string, after: ReceiptLifecycle): boolean {
  return !(via === "applyReceipt" && after.phase !== "ProviderFailed") || receiptRank(after.phase) > receiptRank(before.phase);
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
//@ pure
export function canApplyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): boolean {
  const local_0 = receiptRank(outbound.phase);
  return local_0 > 0 && (providerPhase === "ProviderFailed" ? outbound.phase === "ProviderAccepted" || outbound.phase === "ProviderSent" : receiptRank(providerPhase) > local_0);
}

/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) */
//@ pure
export function lawDeliveredIgnoresFailure(phase: ReceiptPhase): boolean {
  //@ ensures \result === true
  return !(phase === "ProviderDelivered" || phase === "ProviderRead") || !canApplyReceipt(({ phase: phase } as ReceiptLifecycle), "ProviderFailed");
}

/** Story: Know whether a queued message reached the provider / A terminal receipt preserves the recipient cap after payload erasure (spec/outboundReceipt.md) */
//@ pure
export function keepScrubbedRecipientCount(phase: ReceiptPhase, nonmember: boolean, hadAddress: boolean, windowOpen: boolean): boolean {
  return (phase === "ProviderDelivered" || phase === "ProviderRead") && nonmember && hadAddress && windowOpen;
}

/** Story: Know whether a queued message reached the provider / A terminal receipt preserves the recipient cap after payload erasure (spec/outboundReceipt.md) */
//@ pure
export function lawFailedReceiptHasNoScrubbedRecipientCount(nonmember: boolean, hadAddress: boolean, windowOpen: boolean): boolean {
  //@ ensures \result === true
  return !keepScrubbedRecipientCount("ProviderFailed", nonmember, hadAddress, windowOpen);
}

/** Story: Know whether a queued message reached the provider / A terminal receipt preserves the recipient cap after payload erasure (spec/outboundReceipt.md) */
//@ pure
export function lawScrubbedRecipientCountRequiresOpenWindow(phase: ReceiptPhase, nonmember: boolean, hadAddress: boolean): boolean {
  //@ ensures \result === true
  return !keepScrubbedRecipientCount(phase, nonmember, hadAddress, false);
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) */
//@ pure
export function canHoldUnrecordedReceipt(outbound: ReceiptLifecycle): boolean {
  return outbound.phase === "Sending";
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) */
//@ pure
export function holdUnrecordedReceipt(outbound: ReceiptLifecycle): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canHoldUnrecordedReceipt(outbound)) ==> stepReceiptsDoNotRegress(outbound, "holdUnrecordedReceipt", \result)
  //@ ensures (inv(outbound) && canHoldUnrecordedReceipt(outbound)) ==> stepUnrecordedReceiptWaits(outbound, "holdUnrecordedReceipt", \result)
  return { phase: "AcceptanceUnknown" };
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) */
//@ pure
export function stepUnrecordedReceiptWaits(before: ReceiptLifecycle, via: string, after: ReceiptLifecycle): boolean {
  return !(via === "holdUnrecordedReceipt") || (before.phase === "Sending" && after.phase === "AcceptanceUnknown");
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) */
//@ pure
export function canConfirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: boolean): boolean {
  return outbound.phase === "AcceptanceUnknown" && neverAdmitted;
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) */
//@ pure
export function confirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: boolean): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canConfirmNeverAdmitted(outbound, neverAdmitted)) ==> stepReceiptsDoNotRegress(outbound, "confirmNeverAdmitted", \result)
  //@ ensures (inv(outbound) && canConfirmNeverAdmitted(outbound, neverAdmitted)) ==> stepUnrecordedReceiptWaits(outbound, "confirmNeverAdmitted", \result)
  return { phase: "RetryScheduled" };
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) */
//@ pure
export function canExpireUnknown(outbound: ReceiptLifecycle, pastLimit: boolean): boolean {
  return outbound.phase === "AcceptanceUnknown" && pastLimit;
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) */
//@ pure
export function expireUnknown(outbound: ReceiptLifecycle, pastLimit: boolean): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canExpireUnknown(outbound, pastLimit)) ==> stepReceiptsDoNotRegress(outbound, "expireUnknown", \result)
  //@ ensures (inv(outbound) && canExpireUnknown(outbound, pastLimit)) ==> stepUnrecordedReceiptWaits(outbound, "expireUnknown", \result)
  return { phase: "AcceptanceExpired" };
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) */
//@ pure
export function sometimesCanCheckUnknown(outbound: ReceiptLifecycle): boolean {
  return outbound.phase === "AcceptanceUnknown";
}

/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) */
//@ pure
export function sometimesCanRead(outbound: ReceiptLifecycle): boolean {
  return outbound.phase === "ProviderRead";
}

/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) */
//@ pure
export function canRecordProviderError(outbound: ReceiptLifecycle): boolean {
  return outbound.phase === "Sending";
}

/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) */
//@ pure
export function recordProviderError(outbound: ReceiptLifecycle, failure: FailureKind, hasAttemptsLeft: boolean): ReceiptLifecycle {
  //@ ensures (inv(outbound) && canRecordProviderError(outbound)) ==> stepReceiptsDoNotRegress(outbound, "recordProviderError", \result)
  //@ ensures (inv(outbound) && canRecordProviderError(outbound)) ==> stepUnrecordedReceiptWaits(outbound, "recordProviderError", \result)
  return { phase: failure === "UnknownResult" ? "AcceptanceUnknown" : (failure === "NeedReply" ? "WaitingForReply" : (failure === "BlockedNumber" ? "ProviderBlocked" : (failure === "Retryable" && hasAttemptsLeft ? "RetryScheduled" : "ProviderFailed"))) };
}

/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) */
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
  if (event.type === "holdUnrecordedReceipt") return canHoldUnrecordedReceipt(current);
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
  if (event.type === "recordAcceptance") return canRecordAcceptance(current, event.providerPhase) ? recordAcceptance(current, event.providerPhase) : current;
  if (event.type === "applyReceipt") return canApplyReceipt(current, event.providerPhase) ? applyReceipt(current, event.providerPhase) : current;
  if (event.type === "holdUnrecordedReceipt") return canHoldUnrecordedReceipt(current) ? holdUnrecordedReceipt(current) : current;
  if (event.type === "confirmNeverAdmitted") return canConfirmNeverAdmitted(current, event.neverAdmitted) ? confirmNeverAdmitted(current, event.neverAdmitted) : current;
  if (event.type === "expireUnknown") return canExpireUnknown(current, event.pastLimit) ? expireUnknown(current, event.pastLimit) : current;
  if (event.type === "recordProviderError") return canRecordProviderError(current) ? recordProviderError(current, event.failure, event.hasAttemptsLeft) : current;
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
  if (raw.type === "holdUnrecordedReceipt") return { type: "holdUnrecordedReceipt" };
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
