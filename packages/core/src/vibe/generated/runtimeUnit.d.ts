// Generated from spec/runtimeUnit.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export type UnitPhase = "LoadingSnapshot" | "RestoringSnapshot" | "RunningAction" | "SavingState" | "StateSaved";
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export interface RuntimeUnit {
    phase: UnitPhase;
}
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
export type EvidenceOwner = "SharedEvidence" | "MemberEvidence" | "EventEvidence";
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
export type StartupPlan = "RecoverDeliveryQueue" | "RepairProjection";
/** One variant per transition in the spec. */
export type Event = {
    type: "recordAction";
} | {
    type: "recordSave";
} | {
    type: "recordLoad";
    snapshotFound: boolean;
} | {
    type: "recordRestore";
};
/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
export declare const maxEngineAttempts: number;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare const initial: RuntimeUnit;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md) */
export declare function tickMayEnter(acquired: boolean): boolean;
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md) */
export declare function tickMayTryLock(locallyBusy: boolean): boolean;
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md) */
export declare function lawBusyTickSkips(locallyBusy: boolean): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function canRecordAction(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function recordAction(unit: RuntimeUnit): RuntimeUnit;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function canRecordSave(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function recordSave(unit: RuntimeUnit): RuntimeUnit;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function stepSaveFollowsAction(before: RuntimeUnit, via: string, after: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function sometimesCanSave(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function canRecordLoad(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function recordLoad(unit: RuntimeUnit, snapshotFound: boolean): RuntimeUnit;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function canRecordRestore(unit: RuntimeUnit): boolean;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export declare function recordRestore(unit: RuntimeUnit): RuntimeUnit;
/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
export declare function tickMayStartBesideEngine(engineInFlight: boolean): boolean;
/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
export declare function engineAttemptAllowed(attempt: number): boolean;
/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
export declare function lawComputingTickSkips(engineInFlight: boolean): boolean;
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
export declare function preparedRunUsable(sameKey: boolean, sameConfig: boolean, sameSharedEvidence: boolean): boolean;
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
export declare function preparedItemCommits(runUsable: boolean, named: string[], changed: string[]): boolean;
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
export declare function evidenceOwner(publicEvent: boolean, namesMember: boolean): EvidenceOwner;
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
export declare function lawChangedOwnerNeverCommits(runUsable: boolean, named: string[], changed: string[], owner: string): boolean;
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
export declare function lawUnchangedItemOfUsableRunCommits(named: string[], changed: string[]): boolean;
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
export declare function lawStaleRunNeverCommits(sameKey: boolean, sameConfig: boolean, sameSharedEvidence: boolean, named: string[], changed: string[]): boolean;
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
export declare function lawMemberEntryIsNeverShared(publicEvent: boolean, namesMember: boolean): boolean;
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
export declare function lawEventEntryIsItsOwnEvidence(publicEvent: boolean, namesMember: boolean): boolean;
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
export declare function matchingDisabledByRegistry(matchingAllowed: boolean): boolean;
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
export declare function tickRepairsProjection(ran: boolean, queuedAdapter: boolean): boolean;
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
export declare function tickRunsFollowup(ran: boolean, hookConfigured: boolean): boolean;
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
export declare function startupPlan(queuedAdapter: boolean): StartupPlan;
/** Do the rules allow this event in this state? */
export declare function enabled(current: RuntimeUnit, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
export declare function step(current: RuntimeUnit, event: Event): RuntimeUnit;
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
export declare function parseState(x: unknown): RuntimeUnit | undefined;
/** Proof obligation: the initial state satisfies every `always` rule. */
export declare function initialHolds(): RuntimeUnit;
