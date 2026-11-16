// Generated from spec/runtimeUnit.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./runtimeUnit.js";
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export const initial = M.initial;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md:9) @throws {never} */
export function tickMayEnter(acquired) { return M.tickMayEnter(acquired); }
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md:9) @throws {never} */
export function tickMayTryLock(locallyBusy) { return M.tickMayTryLock(locallyBusy); }
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md:9) @throws {never} */
export function lawBusyTickSkips(locallyBusy) { return M.lawBusyTickSkips(locallyBusy); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function canRecordAction(unit) { return M.canRecordAction(unit); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function recordAction(unit) { return M.recordAction(unit); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function canRecordSave(unit) { return M.canRecordSave(unit); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function recordSave(unit) { return M.recordSave(unit); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function stepSaveFollowsAction(before, via, after) { return M.stepSaveFollowsAction(before, via, after); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function sometimesCanSave(unit) { return M.sometimesCanSave(unit); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function canRecordLoad(unit) { return M.canRecordLoad(unit); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function recordLoad(unit, snapshotFound) { return M.recordLoad(unit, snapshotFound); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function canRecordRestore(unit) { return M.canRecordRestore(unit); }
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md:21) @throws {never} */
export function recordRestore(unit) { return M.recordRestore(unit); }
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md:50) @throws {never} */
export function matchingDisabledByRegistry(matchingAllowed) { return M.matchingDisabledByRegistry(matchingAllowed); }
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md:50) @throws {never} */
export function tickRepairsProjection(ran, queuedAdapter) { return M.tickRepairsProjection(ran, queuedAdapter); }
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md:50) @throws {never} */
export function tickRunsFollowup(ran, hookConfigured) { return M.tickRunsFollowup(ran, hookConfigured); }
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md:50) @throws {never} */
export function startupPlan(queuedAdapter) { return M.startupPlan(queuedAdapter); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** A Machine never shares its held state with callers. @throws {never} */
export function snapshot_runtimeUnit(value) { return structuredClone(value); }
