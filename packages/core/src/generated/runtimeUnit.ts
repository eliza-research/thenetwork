// GENERATED from spec/runtimeUnit.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export type UnitPhase = "LoadingSnapshot" | "RestoringSnapshot" | "RunningAction" | "SavingState" | "StateSaved";
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export interface RuntimeUnit { phase: UnitPhase }
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
export type StartupPlan = "RecoverDeliveryQueue" | "RepairProjection";

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordAction" }
  | { type: "recordSave" }
  | { type: "recordLoad"; snapshotFound: boolean }
  | { type: "recordRestore" };

/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
export const maxEngineAttempts: number = 2;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export const initial: RuntimeUnit = { phase: "LoadingSnapshot" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: RuntimeUnit): boolean {
  return true;
}

/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md) */
//@ pure
export function tickMayEnter(acquired: boolean): boolean {
  return acquired;
}

/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md) */
//@ pure
export function tickMayTryLock(locallyBusy: boolean): boolean {
  return !locallyBusy;
}

/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md) */
//@ pure
export function lawBusyTickSkips(locallyBusy: boolean): boolean {
  //@ ensures \result === true
  return !locallyBusy || !tickMayTryLock(locallyBusy);
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function canRecordAction(unit: RuntimeUnit): boolean {
  return unit.phase === "RunningAction";
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function recordAction(unit: RuntimeUnit): RuntimeUnit {
  //@ ensures (inv(unit) && canRecordAction(unit)) ==> stepSaveFollowsAction(unit, "recordAction", \result)
  return { phase: "SavingState" };
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function canRecordSave(unit: RuntimeUnit): boolean {
  return unit.phase === "SavingState";
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function recordSave(unit: RuntimeUnit): RuntimeUnit {
  //@ ensures (inv(unit) && canRecordSave(unit)) ==> stepSaveFollowsAction(unit, "recordSave", \result)
  return { phase: "StateSaved" };
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function stepSaveFollowsAction(before: RuntimeUnit, via: string, after: RuntimeUnit): boolean {
  return !(after.phase === "StateSaved") || (before.phase === "SavingState" && via === "recordSave");
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function sometimesCanSave(unit: RuntimeUnit): boolean {
  return unit.phase === "StateSaved";
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function canRecordLoad(unit: RuntimeUnit): boolean {
  return unit.phase === "LoadingSnapshot";
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function recordLoad(unit: RuntimeUnit, snapshotFound: boolean): RuntimeUnit {
  //@ ensures (inv(unit) && canRecordLoad(unit)) ==> stepSaveFollowsAction(unit, "recordLoad", \result)
  return { phase: snapshotFound ? "RestoringSnapshot" : "RunningAction" };
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function canRecordRestore(unit: RuntimeUnit): boolean {
  return unit.phase === "RestoringSnapshot";
}

/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function recordRestore(unit: RuntimeUnit): RuntimeUnit {
  //@ ensures (inv(unit) && canRecordRestore(unit)) ==> stepSaveFollowsAction(unit, "recordRestore", \result)
  return { phase: "RunningAction" };
}

/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
//@ pure
export function tickMayStartBesideEngine(engineInFlight: boolean): boolean {
  return !engineInFlight;
}

/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
//@ pure
export function engineAttemptAllowed(attempt: number): boolean {
  return attempt >= 0 && attempt < maxEngineAttempts;
}

/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
//@ pure
export function lawComputingTickSkips(engineInFlight: boolean): boolean {
  //@ ensures \result === true
  return !engineInFlight || !tickMayStartBesideEngine(engineInFlight);
}

/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
//@ pure
export function lawEngineAttemptsBounded(attempt: number): boolean {
  //@ ensures \result === true
  return !engineAttemptAllowed(attempt) || attempt < maxEngineAttempts;
}

/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function preparedRunUsable(sameKey: boolean, sameConfig: boolean, sameSharedEvidence: boolean): boolean {
  return sameKey && sameConfig && sameSharedEvidence;
}

/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function preparedItemCommits(runUsable: boolean, membersUnchanged: boolean): boolean {
  return runUsable && membersUnchanged;
}

/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function lawChangedMemberNeverCommits(runUsable: boolean, membersUnchanged: boolean): boolean {
  //@ ensures \result === true
  return !(!membersUnchanged) || !preparedItemCommits(runUsable, membersUnchanged);
}

/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function lawStaleRunNeverCommits(sameKey: boolean, sameConfig: boolean, sameSharedEvidence: boolean, membersUnchanged: boolean): boolean {
  //@ ensures \result === true
  return !(!preparedRunUsable(sameKey, sameConfig, sameSharedEvidence)) || !preparedItemCommits(preparedRunUsable(sameKey, sameConfig, sameSharedEvidence), membersUnchanged);
}

/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
//@ pure
export function matchingDisabledByRegistry(matchingAllowed: boolean): boolean {
  return !matchingAllowed;
}

/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
//@ pure
export function tickRepairsProjection(ran: boolean, queuedAdapter: boolean): boolean {
  return ran && !queuedAdapter;
}

/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
//@ pure
export function tickRunsFollowup(ran: boolean, hookConfigured: boolean): boolean {
  return ran && hookConfigured;
}

/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
//@ pure
export function startupPlan(queuedAdapter: boolean): StartupPlan {
  return queuedAdapter ? "RecoverDeliveryQueue" : "RepairProjection";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: RuntimeUnit, event: Event): boolean {
  if (event.type === "recordAction") return canRecordAction(current);
  if (event.type === "recordSave") return canRecordSave(current);
  if (event.type === "recordLoad") return canRecordLoad(current);
  if (event.type === "recordRestore") return canRecordRestore(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: RuntimeUnit, event: Event): RuntimeUnit {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordAction") return canRecordAction(current) ? recordAction(current) : current;
  if (event.type === "recordSave") return canRecordSave(current) ? recordSave(current) : current;
  if (event.type === "recordLoad") return canRecordLoad(current) ? recordLoad(current, event.snapshotFound) : current;
  if (event.type === "recordRestore") return canRecordRestore(current) ? recordRestore(current) : current;
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
  if (raw.type === "recordAction") return { type: "recordAction" };
  if (raw.type === "recordSave") return { type: "recordSave" };
  if (raw.type === "recordLoad" && typeof raw.snapshotFound === "boolean") return { type: "recordLoad", snapshotFound: raw.snapshotFound };
  if (raw.type === "recordRestore") return { type: "recordRestore" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): RuntimeUnit | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "LoadingSnapshot" || raw.phase === "RestoringSnapshot" || raw.phase === "RunningAction" || raw.phase === "SavingState" || raw.phase === "StateSaved") && Object.keys(raw).length === 1)) return undefined;
  const parsed: RuntimeUnit = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): RuntimeUnit {
  //@ ensures inv(\result)
  return initial;
}
