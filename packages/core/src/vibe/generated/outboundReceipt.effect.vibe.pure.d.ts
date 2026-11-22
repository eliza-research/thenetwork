// Generated from spec/outboundReceipt.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import type { ReceiptPhase, ReceiptLifecycle, FailureKind, Event } from "./outboundReceipt.ts";
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export declare const initial: ReceiptLifecycle;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export declare function inv(current: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export declare function receiptRank(phase: ReceiptPhase): number;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export declare function recordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export declare function applyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export declare function canRecordAcceptance(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export declare function stepReceiptsDoNotRegress(before: ReceiptLifecycle, via: string, after: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export declare function canApplyReceipt(outbound: ReceiptLifecycle, providerPhase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export declare function lawDeliveredIgnoresFailure(phase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export declare function canHoldUnrecordedReceipt(outbound: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export declare function holdUnrecordedReceipt(outbound: ReceiptLifecycle): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export declare function stepUnrecordedReceiptWaits(before: ReceiptLifecycle, via: string, after: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export declare function canConfirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: boolean): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export declare function confirmNeverAdmitted(outbound: ReceiptLifecycle, neverAdmitted: boolean): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export declare function canExpireUnknown(outbound: ReceiptLifecycle, pastLimit: boolean): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export declare function expireUnknown(outbound: ReceiptLifecycle, pastLimit: boolean): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export declare function sometimesCanCheckUnknown(outbound: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export declare function sometimesCanRead(outbound: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) @throws {never} */
export declare function canRecordProviderError(outbound: ReceiptLifecycle): boolean;
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) @throws {never} */
export declare function recordProviderError(outbound: ReceiptLifecycle, failure: FailureKind, hasAttemptsLeft: boolean): ReceiptLifecycle;
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) @throws {never} */
export declare function lawAnUnknownResultDoesNotRetry(hasAttemptsLeft: boolean): boolean;
/** Story: Know whether a queued message reached the provider / A send that may have reached the person keeps its person-cap slot (spec/outboundReceipt.md) @throws {never} */
export declare function returnsPersonSlot(phase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / A send that may have reached the person keeps its person-cap slot (spec/outboundReceipt.md) @throws {never} */
export declare function lawUncertainSendKeepsSlot(phase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / An acceptance records a send time only for a send that went out (spec/outboundReceipt.md) @throws {never} */
export declare function acceptanceRecordsSend(phase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / An acceptance records a send time only for a send that went out (spec/outboundReceipt.md) @throws {never} */
export declare function acceptanceEndsRow(phase: ReceiptPhase, receiptOwner: boolean, member: boolean): boolean;
/** Story: Know whether a queued message reached the provider / An acceptance records a send time only for a send that went out (spec/outboundReceipt.md) @throws {never} */
export declare function lawFailedAcceptanceRecordsNoSend(phase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / An acceptance records a send time only for a send that went out (spec/outboundReceipt.md) @throws {never} */
export declare function lawReceiptOwnerEndsNonMemberRow(phase: ReceiptPhase): boolean;
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export declare function gatewayReceiptApplies(replyStatus: string, delivery: string): boolean;
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export declare function gatewayReplySendTime(replyStatus: string, collectedAt: number, receivedAt: number): number;
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export declare function gatewayReplyPhase(pastLimit: boolean): ReceiptPhase;
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export declare function lawExpiredReplySendsAtCollection(replyStatus: string, collectedAt: number, receivedAt: number): boolean;
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export declare function lawReplySendTimeNotAfterReceipt(replyStatus: string, collectedAt: number, receivedAt: number): boolean;
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export declare function lawLateUnknownReceiptKeepsExpiredReply(replyStatus: string): boolean;
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export declare function lawGatewayReceiptChangesOnlyGatewayReplies(replyStatus: string, delivery: string): boolean;
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export declare function lawGatewayReplyEndsOnlyPastLimit(pastLimit: boolean): boolean;
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export declare function lawExpiredGatewayReplyKeepsSlot(pastLimit: boolean): boolean;
/** Do the rules allow this event in this state? @throws {never} */
export declare function enabled(current: ReceiptLifecycle, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export declare function step(current: ReceiptLifecycle, event: Event): ReceiptLifecycle;
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseEvent(x: unknown): Event | undefined;
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseState(x: unknown): ReceiptLifecycle | undefined;
/** A Machine never shares a state with its callers. @throws {never} */
export declare function snapshot_outboundReceipt<A>(value: A): A;
