// Generated from spec/outboundReceipt.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import { Context, Effect, Layer, Stream } from "effect";
export type * from "./outboundReceipt.ts";
import { initial, inv, receiptRank, recordAcceptance, applyReceipt, canRecordAcceptance, stepReceiptsDoNotRegress, canApplyReceipt, lawDeliveredIgnoresFailure, keepScrubbedRecipientCount, lawFailedReceiptHasNoScrubbedRecipientCount, lawScrubbedRecipientCountRequiresOpenWindow, canHoldUnrecordedReceipt, holdUnrecordedReceipt, stepUnrecordedReceiptWaits, canConfirmNeverAdmitted, confirmNeverAdmitted, canExpireUnknown, expireUnknown, sometimesCanCheckUnknown, sometimesCanRead, canRecordProviderError, recordProviderError, lawAnUnknownResultDoesNotRetry, returnsPersonSlot, lawUncertainSendKeepsSlot, acceptanceRecordsSend, acceptanceEndsRow, lawFailedAcceptanceRecordsNoSend, lawReceiptOwnerEndsNonMemberRow, keepAcceptedRecipientCount, lawReceiptOwnerAcceptanceKeepsRecipientCount, lawFailedAcceptanceHasNoRecipientCount, gatewayReceiptApplies, gatewayReplySendTime, gatewayReplyPhase, lawExpiredReplySendsAtCollection, lawReplySendTimeNotAfterReceipt, lawLateUnknownReceiptKeepsExpiredReply, lawGatewayReceiptNeverChangesAFinalReply, lawLateFinalReceiptEndsAnExpiredReply, lawExpiredGatewayReplyKeepsSlot, enabled, step, parseEvent, parseState } from "./outboundReceipt.effect.vibe.pure.js";
export { initial, inv, receiptRank, recordAcceptance, applyReceipt, canRecordAcceptance, stepReceiptsDoNotRegress, canApplyReceipt, lawDeliveredIgnoresFailure, keepScrubbedRecipientCount, lawFailedReceiptHasNoScrubbedRecipientCount, lawScrubbedRecipientCountRequiresOpenWindow, canHoldUnrecordedReceipt, holdUnrecordedReceipt, stepUnrecordedReceiptWaits, canConfirmNeverAdmitted, confirmNeverAdmitted, canExpireUnknown, expireUnknown, sometimesCanCheckUnknown, sometimesCanRead, canRecordProviderError, recordProviderError, lawAnUnknownResultDoesNotRetry, returnsPersonSlot, lawUncertainSendKeepsSlot, acceptanceRecordsSend, acceptanceEndsRow, lawFailedAcceptanceRecordsNoSend, lawReceiptOwnerEndsNonMemberRow, keepAcceptedRecipientCount, lawReceiptOwnerAcceptanceKeepsRecipientCount, lawFailedAcceptanceHasNoRecipientCount, gatewayReceiptApplies, gatewayReplySendTime, gatewayReplyPhase, lawExpiredReplySendsAtCollection, lawReplySendTimeNotAfterReceipt, lawLateUnknownReceiptKeepsExpiredReply, lawGatewayReceiptNeverChangesAFinalReply, lawLateFinalReceiptEndsAnExpiredReply, lawExpiredGatewayReplyKeepsSlot, enabled, step, parseEvent, parseState };
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import type * as T from "./outboundReceipt.ts";
declare const Rejected_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Rejected";
} & Readonly<A>;
/** The rules do not allow this event in this state. */
export declare class Rejected extends Rejected_base<{
    readonly event: T.Event;
    readonly state: T.ReceiptLifecycle;
}> {
}
declare const NotAnEvent_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "NotAnEvent";
} & Readonly<A>;
/** An untrusted value that is not an event. */
export declare class NotAnEvent extends NotAnEvent_base<{
    readonly input: unknown;
}> {
}
declare const NotAState_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "NotAState";
} & Readonly<A>;
/** An untrusted value that is not a state satisfying every `always` rule. */
export declare class NotAState extends NotAState_base<{
    readonly input: unknown;
}> {
}
/** `parseEvent`, failing where it returns undefined. */
export declare function decodeEvent(input: unknown): Effect.Effect<T.Event, NotAnEvent>;
/** `parseState`, failing where it returns undefined. */
export declare function decodeState(input: unknown): Effect.Effect<T.ReceiptLifecycle, NotAState>;
/** `step`, failing where `enabled` refuses the event instead of leaving the state unchanged. */
export declare function apply(current: T.ReceiptLifecycle, event: T.Event): Effect.Effect<T.ReceiptLifecycle, Rejected>;
type Machine_shape = {
    /** The state the Machine was made with, or the last one an event sent to it led to; then each one an event sent to it leads to. */
    readonly changes: Stream.Stream<T.ReceiptLifecycle>;
    /** The state as it is kept now. */
    get(): Effect.Effect<T.ReceiptLifecycle>;
    /** An event already parsed. An optional source check runs under the writer immediately before saving. A value from outside goes through `receive`. */
    send(event: T.Event, isCurrent?: 
    /** @throws {never} */
    (state: T.ReceiptLifecycle) => boolean): Effect.Effect<T.ReceiptLifecycle, Rejected>;
    receive(input: unknown): Effect.Effect<T.ReceiptLifecycle, NotAnEvent | Rejected>;
};
declare const Machine_base: Context.ServiceClass<Machine, "thenetwork/spec/outboundReceipt.md#Machine", Machine_shape>;
/** The state, and the one way to change it: an event the rules allow, applied before the next is looked at. */
export declare class Machine extends Machine_base {
}
export declare namespace Machine {
    type Shape = Machine_shape;
}
/**
 * A Machine over a state kept elsewhere: `load` reads it and `keep` writes it. Each event is applied to what `load`
 * reads when it is sent, so that a state another writer kept since is stepped from, never written over, and the state
 * it leads to goes to `keep` before `send` returns. It fails as the first `load` does; where a later `load` fails
 * or `keep` dies, `send` dies and the state stays as it was. It never shares a state with its callers.
 */
export declare function machineOver<E>(load: () => Effect.Effect<T.ReceiptLifecycle, E>, keep: (next: T.ReceiptLifecycle) => Effect.Effect<void>): Effect.Effect<Machine.Shape, E>;
/** A Machine in memory, from `initial` or a state `decodeState` returned. */
export declare function machine(start?: T.ReceiptLifecycle): Layer.Layer<Machine, never, never>;
/**
 * A Machine kept in the KeyValueStore under `key`, as JSON: each event is applied to what is stored there when it
 * is sent, read through `decodeState`, or to `start` where nothing is, so that a state another page or program
 * stored since is stepped from, never written over. What is stored and is not a state fails the layer with NotAState,
 * and a later `send` dies on it, so that it is never written over either. Each state an event leads to is stored
 * before `send` returns: where the store does not take it, `send` dies and the state stays as it was.
 */
export declare function stored(key: string, start?: T.ReceiptLifecycle): Layer.Layer<Machine, KeyValueStore.KeyValueStoreError | NotAState, KeyValueStore.KeyValueStore>;
