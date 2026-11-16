// Generated from spec/backendLifecycle.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import type { BackendLifecycle, Event } from "./backendLifecycle.ts";
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export declare const initial: BackendLifecycle;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export declare function inv(current: BackendLifecycle): boolean;
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export declare function canReleaseTick(s: BackendLifecycle, tickKey: string): boolean;
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export declare function releaseTick(s: BackendLifecycle, tickKey: string): BackendLifecycle;
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export declare function stepNewTicksRequireServing(before: BackendLifecycle, via: string, after: BackendLifecycle): boolean;
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export declare function backendAcceptsWork(s: BackendLifecycle): boolean;
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export declare function reserveTick(s: BackendLifecycle, tickKey: string): BackendLifecycle;
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export declare function canReserveTick(s: BackendLifecycle, tickKey: string): boolean;
/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md) @throws {never} */
export declare function startTimer(s: BackendLifecycle, at: number): BackendLifecycle;
/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md) @throws {never} */
export declare function sometimesTimerStarts(s: BackendLifecycle): boolean;
/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md) @throws {never} */
export declare function canStartTimer(s: BackendLifecycle): boolean;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function beginShutdown(s: BackendLifecycle): BackendLifecycle;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function canRecordListenerDrain(s: BackendLifecycle): boolean;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function recordListenerDrain(s: BackendLifecycle): BackendLifecycle;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function canSettleWorkDrain(s: BackendLifecycle, timedOut: boolean): boolean;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function settleWorkDrain(s: BackendLifecycle, timedOut: boolean): BackendLifecycle;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function canRecordBackendClose(s: BackendLifecycle): boolean;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function recordBackendClose(s: BackendLifecycle): BackendLifecycle;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function shutdownWasClean(s: BackendLifecycle): boolean;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function stepCleanDrainWaitsForListeners(before: BackendLifecycle, after: BackendLifecycle): boolean;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function sometimesClosesCleanly(s: BackendLifecycle): boolean;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function sometimesClosesAfterGrace(s: BackendLifecycle): boolean;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function canBeginShutdown(s: BackendLifecycle): boolean;
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export declare function stepDrainNeverReopens(before: BackendLifecycle, after: BackendLifecycle): boolean;
/** Do the rules allow this event in this state? @throws {never} */
export declare function enabled(current: BackendLifecycle, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export declare function step(current: BackendLifecycle, event: Event): BackendLifecycle;
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseEvent(x: unknown): Event | undefined;
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseState(x: unknown): BackendLifecycle | undefined;
/** A Machine never shares its held state with callers. @throws {never} */
export declare function snapshot_backendLifecycle<A>(value: A): A;
