// Generated from spec/backendLifecycle.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import { Context, Effect, Layer, Stream } from "effect";
export type * from "./backendLifecycle.ts";
import { initial, inv, canReleaseTick, releaseTick, stepNewTicksRequireServing, backendAcceptsWork, reserveTick, canReserveTick, startTimer, sometimesTimerStarts, canStartTimer, beginShutdown, canRecordListenerDrain, recordListenerDrain, canSettleWorkDrain, settleWorkDrain, canRecordBackendClose, recordBackendClose, shutdownWasClean, stepCleanDrainWaitsForListeners, sometimesClosesCleanly, sometimesClosesAfterGrace, canBeginShutdown, stepDrainNeverReopens, enabled, step, parseEvent, parseState } from "./backendLifecycle.effect.vibe.pure.js";
export { initial, inv, canReleaseTick, releaseTick, stepNewTicksRequireServing, backendAcceptsWork, reserveTick, canReserveTick, startTimer, sometimesTimerStarts, canStartTimer, beginShutdown, canRecordListenerDrain, recordListenerDrain, canSettleWorkDrain, settleWorkDrain, canRecordBackendClose, recordBackendClose, shutdownWasClean, stepCleanDrainWaitsForListeners, sometimesClosesCleanly, sometimesClosesAfterGrace, canBeginShutdown, stepDrainNeverReopens, enabled, step, parseEvent, parseState };
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import type * as T from "./backendLifecycle.ts";
declare const Rejected_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Rejected";
} & Readonly<A>;
/** The rules do not allow this event in this state. */
export declare class Rejected extends Rejected_base<{
    readonly event: T.Event;
    readonly state: T.BackendLifecycle;
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
export declare function decodeState(input: unknown): Effect.Effect<T.BackendLifecycle, NotAState>;
/** `step`, failing where `enabled` refuses the event instead of leaving the state unchanged. */
export declare function apply(current: T.BackendLifecycle, event: T.Event): Effect.Effect<T.BackendLifecycle, Rejected>;
type Machine_shape = {
    /** The current state, then every later one. */
    readonly changes: Stream.Stream<T.BackendLifecycle>;
    get(): Effect.Effect<T.BackendLifecycle>;
    /** An event already parsed; a value from outside goes through `receive`. */
    send(event: T.Event): Effect.Effect<T.BackendLifecycle, Rejected>;
    receive(input: unknown): Effect.Effect<T.BackendLifecycle, NotAnEvent | Rejected>;
};
declare const Machine_base: Context.ServiceClass<Machine, "thenetwork/spec/backendLifecycle.md#Machine", Machine_shape>;
/** The state, and the one way to change it: an event the rules allow, applied before the next is looked at. */
export declare class Machine extends Machine_base {
}
export declare namespace Machine {
    type Shape = Machine_shape;
}
/**
 * A Machine from `start` that gives each state an event leads to to `keep` before it is the current one: where `keep`
 * dies, `send` dies and the state stays as it was. It never shares the state it holds with its callers.
 */
export declare function machineOver(start: T.BackendLifecycle, keep: (next: T.BackendLifecycle) => Effect.Effect<void>): Effect.Effect<Machine.Shape>;
/** A Machine in memory, from `initial` or a state `decodeState` returned. */
export declare function machine(start?: T.BackendLifecycle): Layer.Layer<Machine, never, never>;
/**
 * A Machine kept in the KeyValueStore under `key`, as JSON. It starts from what is stored there, read through
 * `decodeState`, or from `start` where nothing is; what is stored and is not a state fails the layer with NotAState,
 * so that it is never written over. Each state an event leads to is stored before it is the current one: where the
 * store does not take it, `send` dies and the state stays as it was.
 */
export declare function stored(key: string, start?: T.BackendLifecycle): Layer.Layer<Machine, KeyValueStore.KeyValueStoreError | NotAState, KeyValueStore.KeyValueStore>;
