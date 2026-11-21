// Generated from spec/runtimeUnit.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/runtimeUnit.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
export const maxEngineAttempts = 2;
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
export const initial = { phase: "LoadingSnapshot" };
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return true;
}
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md) */
//@ pure
export function tickMayEnter(acquired) {
    return acquired;
}
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md) */
//@ pure
export function tickMayTryLock(locallyBusy) {
    return !locallyBusy;
}
/** Story: Work from the latest saved network state / A tick skips a busy store while an inbound or staff action waits (spec/runtimeUnit.md) */
//@ pure
export function lawBusyTickSkips(locallyBusy) {
    //@ ensures \result === true
    return !locallyBusy || !tickMayTryLock(locallyBusy);
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function canRecordAction(unit) {
    return unit.phase === "RunningAction";
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function recordAction(unit) {
    //@ ensures (inv(unit) && canRecordAction(unit)) ==> stepSaveFollowsAction(unit, "recordAction", \result)
    return { phase: "SavingState" };
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function canRecordSave(unit) {
    return unit.phase === "SavingState";
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function recordSave(unit) {
    //@ ensures (inv(unit) && canRecordSave(unit)) ==> stepSaveFollowsAction(unit, "recordSave", \result)
    return { phase: "StateSaved" };
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function stepSaveFollowsAction(before, via, after) {
    return !(after.phase === "StateSaved") || (before.phase === "SavingState" && via === "recordSave");
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function sometimesCanSave(unit) {
    return unit.phase === "StateSaved";
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function canRecordLoad(unit) {
    return unit.phase === "LoadingSnapshot";
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function recordLoad(unit, snapshotFound) {
    //@ ensures (inv(unit) && canRecordLoad(unit)) ==> stepSaveFollowsAction(unit, "recordLoad", \result)
    return { phase: snapshotFound ? "RestoringSnapshot" : "RunningAction" };
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function canRecordRestore(unit) {
    return unit.phase === "RestoringSnapshot";
}
/** Story: Work from the latest saved network state / Restore a saved snapshot before running and make one save after success (spec/runtimeUnit.md) */
//@ pure
export function recordRestore(unit) {
    //@ ensures (inv(unit) && canRecordRestore(unit)) ==> stepSaveFollowsAction(unit, "recordRestore", \result)
    return { phase: "RunningAction" };
}
/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
//@ pure
export function tickMayStartBesideEngine(engineInFlight) {
    return !engineInFlight;
}
/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
//@ pure
export function engineAttemptAllowed(attempt) {
    return attempt >= 0 && attempt < maxEngineAttempts;
}
/** Story: Work from the latest saved network state / The engine runs on a snapshot outside the store lock (spec/runtimeUnit.md) */
//@ pure
export function lawComputingTickSkips(engineInFlight) {
    //@ ensures \result === true
    return !engineInFlight || !tickMayStartBesideEngine(engineInFlight);
}
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function preparedRunUsable(sameKey, sameConfig, sameSharedEvidence) {
    return sameKey && sameConfig && sameSharedEvidence;
}
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function preparedItemCommits(runUsable, named, changed) {
    return runUsable && !named.some((owner) => changed.includes(owner));
}
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function evidenceOwner(publicEvent, namesMember) {
    return publicEvent ? "EventEvidence" : (namesMember ? "MemberEvidence" : "SharedEvidence");
}
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function lawChangedOwnerNeverCommits(runUsable, named, changed, owner) {
    //@ ensures \result === true
    return !(named.includes(owner) && changed.includes(owner)) || !preparedItemCommits(runUsable, named, changed);
}
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function lawUnchangedItemOfUsableRunCommits(named, changed) {
    //@ ensures \result === true
    return !(!named.some((owner) => !(!changed.includes(owner)))) || preparedItemCommits(true, named, changed);
}
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function lawStaleRunNeverCommits(sameKey, sameConfig, sameSharedEvidence, named, changed) {
    //@ ensures \result === true
    return !(!preparedRunUsable(sameKey, sameConfig, sameSharedEvidence)) || !preparedItemCommits(preparedRunUsable(sameKey, sameConfig, sameSharedEvidence), named, changed);
}
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function lawMemberEntryIsNeverShared(publicEvent, namesMember) {
    //@ ensures \result === true
    return !namesMember || evidenceOwner(publicEvent, namesMember) !== "SharedEvidence";
}
/** Story: Work from the latest saved network state / A prepared engine result commits only for members whose evidence did not change (spec/runtimeUnit.md) */
//@ pure
export function lawEventEntryIsItsOwnEvidence(publicEvent, namesMember) {
    //@ ensures \result === true
    return !publicEvent || evidenceOwner(publicEvent, namesMember) === "EventEvidence";
}
/** Story: Work from the latest saved network state / Matching runs for an app only inside its launch scope (spec/runtimeUnit.md) */
//@ pure
export function appMatchingLocalOnly(app) {
    return app === "friends" || app === "peon";
}
/** Story: Work from the latest saved network state / Matching runs for an app only inside its launch scope (spec/runtimeUnit.md) */
//@ pure
export function matchingSwitchAllowed(registryAllows, app, production, liveApproved) {
    return registryAllows && (!appMatchingLocalOnly(app) || !production || liveApproved);
}
/** Story: Work from the latest saved network state / Matching runs for an app only inside its launch scope (spec/runtimeUnit.md) */
//@ pure
export function lawRegistryOffNeverAllowsMatching(app, production, liveApproved) {
    //@ ensures \result === true
    return !matchingSwitchAllowed(false, app, production, liveApproved);
}
/** Story: Work from the latest saved network state / Matching runs for an app only inside its launch scope (spec/runtimeUnit.md) */
//@ pure
export function lawLocalOnlyAppNeedsLiveDecisionInProduction(registryAllows, app) {
    //@ ensures \result === true
    return !appMatchingLocalOnly(app) || !matchingSwitchAllowed(registryAllows, app, true, false);
}
/** Story: Work from the latest saved network state / Matching runs for an app only inside its launch scope (spec/runtimeUnit.md) */
//@ pure
export function lawLocalOnlyAppMatchesOutsideProduction(app, liveApproved) {
    //@ ensures \result === true
    return matchingSwitchAllowed(true, app, false, liveApproved);
}
/** Story: Work from the latest saved network state / Matching runs for an app only inside its launch scope (spec/runtimeUnit.md) */
//@ pure
export function lawPilotAppFollowsRegistry(registryAllows, app, production, liveApproved) {
    //@ ensures \result === true
    return !(!appMatchingLocalOnly(app)) || matchingSwitchAllowed(registryAllows, app, production, liveApproved) === registryAllows;
}
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
//@ pure
export function matchingDisabledByRegistry(matchingAllowed) {
    return !matchingAllowed;
}
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
//@ pure
export function tickRepairsProjection(ran, queuedAdapter) {
    return ran && !queuedAdapter;
}
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
//@ pure
export function tickRunsFollowup(ran, hookConfigured) {
    return ran && hookConfigured;
}
/** Story: Work from the latest saved network state / Runtime follow-up depends on the adapter and whether the tick ran (spec/runtimeUnit.md) */
//@ pure
export function startupPlan(queuedAdapter) {
    return queuedAdapter ? "RecoverDeliveryQueue" : "RepairProjection";
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
    if (event.type === "recordAction")
        return canRecordAction(current);
    if (event.type === "recordSave")
        return canRecordSave(current);
    if (event.type === "recordLoad")
        return canRecordLoad(current);
    if (event.type === "recordRestore")
        return canRecordRestore(current);
    return false;
}
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current, event) {
    //@ requires inv(current)
    //@ ensures inv(\result)
    if (event.type === "recordAction")
        return canRecordAction(current) ? recordAction(current) : current;
    if (event.type === "recordSave")
        return canRecordSave(current) ? recordSave(current) : current;
    if (event.type === "recordLoad")
        return canRecordLoad(current) ? recordLoad(current, event.snapshotFound) : current;
    if (event.type === "recordRestore")
        return canRecordRestore(current) ? recordRestore(current) : current;
    return current;
}
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (typeof raw !== "object" || raw === null)
        return undefined;
    if (raw.type === "recordAction")
        return { type: "recordAction" };
    if (raw.type === "recordSave")
        return { type: "recordSave" };
    if (raw.type === "recordLoad" && typeof raw.snapshotFound === "boolean")
        return { type: "recordLoad", snapshotFound: raw.snapshotFound };
    if (raw.type === "recordRestore")
        return { type: "recordRestore" };
    return undefined;
}
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "LoadingSnapshot" || raw.phase === "RestoringSnapshot" || raw.phase === "RunningAction" || raw.phase === "SavingState" || raw.phase === "StateSaved") && Object.keys(raw).length === 1))
        return undefined;
    const parsed = ({ phase: raw.phase });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
