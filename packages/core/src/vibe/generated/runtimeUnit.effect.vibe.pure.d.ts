// Generated from spec/runtimeUnit.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import type { RuntimeUnit, StartupPlan, Event } from "./runtimeUnit.ts";
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare const initial: RuntimeUnit;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export declare function inv(current: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md:9) @throws {never} */
export declare function tickMayEnter(acquired: boolean): boolean;
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md:9) @throws {never} */
export declare function tickMayTryLock(locallyBusy: boolean): boolean;
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md:9) @throws {never} */
export declare function lawBusyTickSkips(locallyBusy: boolean): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function canRecordAction(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function recordAction(unit: RuntimeUnit): RuntimeUnit;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function canRecordSave(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function recordSave(unit: RuntimeUnit): RuntimeUnit;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function stepSaveFollowsAction(before: RuntimeUnit, via: string, after: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function sometimesCanSave(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function canRecordLoad(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function recordLoad(unit: RuntimeUnit, snapshotFound: boolean): RuntimeUnit;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function canRecordRestore(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export declare function recordRestore(unit: RuntimeUnit): RuntimeUnit;
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md:50) @throws {never} */
export declare function matchingDisabledByRegistry(matchingAllowed: boolean): boolean;
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md:50) @throws {never} */
export declare function tickRepairsProjection(ran: boolean, queuedAdapter: boolean): boolean;
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md:50) @throws {never} */
export declare function tickRunsFollowup(ran: boolean, hookConfigured: boolean): boolean;
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md:50) @throws {never} */
export declare function startupPlan(queuedAdapter: boolean): StartupPlan;
/** Do the rules allow this event in this state? @throws {never} */
export declare function enabled(current: RuntimeUnit, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export declare function step(current: RuntimeUnit, event: Event): RuntimeUnit;
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseEvent(x: unknown): Event | undefined;
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseState(x: unknown): RuntimeUnit | undefined;
/** A Machine never shares its held state with callers. @throws {never} */
export declare function snapshot_runtimeUnit<A>(value: A): A;
