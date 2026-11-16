// Generated from spec/outboundReceipt.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export type ReceiptPhase = "Sending" | "LegacyQueued" | "ProviderAccepted" | "ProviderSent" | "ProviderDelivered" | "ProviderRead" | "ProviderFailed" | "AcceptanceUnknown" | "AcceptanceExpired" | "RetryScheduled" | "WaitingForReply" | "ProviderBlocked" | "OutsideReceipt";
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export interface ReceiptLifecycle {
    phase: ReceiptPhase;
}
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md:80) */
export type FailureKind = "UnknownResult" | "Retryable" | "NeedReply" | "BlockedNumber" | "TerminalError";
/** One variant per transition in the spec. */
export type Event = {
    type: "recordAcceptance";
    providerPhase: ReceiptPhase;
} | {
    type: "applyReceipt";
    providerPhase: ReceiptPhase;
} | {
    type: "holdUnrecordedReceipt";
} | {
    type: "confirmNeverAdmitted";
    neverAdmitted: boolean;
} | {
    type: "expireUnknown";
    pastLimit: boolean;
} | {
    type: "recordProviderError";
    failure: FailureKind;
    hasAttemptsLeft: boolean;
};
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export declare const initial: ReceiptLifecycle;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export declare function receiptRank(phase: ReceiptPhase): number;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export declare function recordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export declare function applyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export declare function canRecordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export declare function stepReceiptsDoNotRegress(before: ReceiptLifecycle, via: string, after: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export declare function canApplyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md:9) */
export declare function lawDeliveredIgnoresFailure(phase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
export declare function canHoldUnrecordedReceipt(outbound: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
export declare function holdUnrecordedReceipt(outbound: ReceiptLifecycle): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
export declare function stepUnrecordedReceiptWaits(before: ReceiptLifecycle, via: string, after: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
export declare function canConfirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: boolean): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
export declare function confirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: boolean): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
export declare function canExpireUnknown(outbound: ReceiptLifecycle, pastLimit: boolean): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
export declare function expireUnknown(outbound: ReceiptLifecycle, pastLimit: boolean): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
export declare function sometimesCanCheckUnknown(outbound: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md:51) */
export declare function sometimesCanRead(outbound: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md:80) */
export declare function canRecordProviderError(outbound: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md:80) */
export declare function recordProviderError(outbound: ReceiptLifecycle, failure: FailureKind, hasAttemptsLeft: boolean): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md:80) */
export declare function lawAnUnknownResultDoesNotRetry(hasAttemptsLeft: boolean): boolean;
/** Do the rules allow this event in this state? */
export declare function enabled(current: ReceiptLifecycle, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
export declare function step(current: ReceiptLifecycle, event: Event): ReceiptLifecycle;
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
export declare function parseEvent(x: unknown): Event | undefined;
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
export declare function parseState(x: unknown): ReceiptLifecycle | undefined;
/** Proof obligation: the initial state satisfies every `always` rule. */
export declare function initialHolds(): ReceiptLifecycle;
