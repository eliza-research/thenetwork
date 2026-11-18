// GENERATED from spec/databaseRestore.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md) */
export type RestorePhase = "Starting" | "ReadingManifest" | "CheckingSource" | "CheckingTarget" | "CreatingTarget" | "RestoringDump" | "CheckingCounts" | "ReplayingPrivacy" | "Finished" | "Refused";
/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md) */
export type RestoreReason = "NoneYet" | "InvalidTarget" | "UnknownManifest" | "OwnDatabase" | "RolesOnSource" | "NeedsDecryption" | "TargetExists" | "NeedsReplaySource";
/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md) */
export interface Restore { phase: RestorePhase; reason: RestoreReason; runRoles: boolean; keepPrivileges: boolean; countsAgree: boolean; replayPrivacy: boolean; privacyReplayed: boolean }
/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md) */
export interface ManifestFacts { sourceKnown: boolean; sameServer: boolean; ownDatabase: boolean; rolesRequested: boolean; encrypted: boolean; dumpPresent: boolean; keepPrivileges: boolean; replaySource: boolean; sourceLost: boolean }
/** Story: Carry privacy changes made after the backup into the restored database / The backend runs the queued replay at start, and each item by one runner until it holds (spec/databaseRestore.md) */
export type ReplayOutcome = "ReplayApplied" | "ReplayAlreadyApplied" | "ReplayTargetHeld" | "ReplayTargetWithoutPhone" | "ReplayRefused";

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkName"; name: string; validName: boolean }
  | { type: "checkVersion"; versionOne: boolean }
  | { type: "checkManifest"; manifest: ManifestFacts }
  | { type: "checkTarget"; targetExists: boolean }
  | { type: "recordCreation" }
  | { type: "recordDump" }
  | { type: "recordCounts"; countsAgree: boolean }
  | { type: "recordPrivacyReplay" };

/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md) */
export const liveNames: string[] = ["railway", "network", "postgres", "template0", "template1"];
/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md) */
export const initial: Restore = { phase: "Starting", reason: "NoneYet", runRoles: false, keepPrivileges: false, countsAgree: false, replayPrivacy: false, privacyReplayed: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Restore): boolean {
  return alwaysReplayRequestedBeforeFinish(current);
}

/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md) */
//@ pure
export function canCheckName(restore: Restore): boolean {
  return restore.phase === "Starting";
}

/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md) */
//@ pure
export function checkName(restore: Restore, name: string, validName: boolean): Restore {
  //@ ensures (inv(restore) && canCheckName(restore)) ==> alwaysReplayRequestedBeforeFinish(\result)
  //@ ensures (inv(restore) && canCheckName(restore)) ==> stepCountsFollowRestore(restore, "checkName", \result)
  return validName && !liveNames.includes(name) ? ({ ...restore, phase: "ReadingManifest" } as Restore) : ({ ...restore, phase: "Refused", reason: "InvalidTarget" } as Restore);
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md) */
//@ pure
export function canCheckVersion(restore: Restore): boolean {
  return restore.phase === "ReadingManifest";
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md) */
//@ pure
export function checkVersion(restore: Restore, versionOne: boolean): Restore {
  //@ ensures (inv(restore) && canCheckVersion(restore)) ==> alwaysReplayRequestedBeforeFinish(\result)
  //@ ensures (inv(restore) && canCheckVersion(restore)) ==> stepCountsFollowRestore(restore, "checkVersion", \result)
  return versionOne ? ({ ...restore, phase: "CheckingSource" } as Restore) : ({ ...restore, phase: "Refused", reason: "UnknownManifest" } as Restore);
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md) */
//@ pure
export function canCheckManifest(restore: Restore): boolean {
  return restore.phase === "CheckingSource";
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md) */
//@ pure
export function checkManifest(restore: Restore, manifest: ManifestFacts): Restore {
  //@ ensures (inv(restore) && canCheckManifest(restore)) ==> alwaysReplayRequestedBeforeFinish(\result)
  //@ ensures (inv(restore) && canCheckManifest(restore)) ==> stepCountsFollowRestore(restore, "checkManifest", \result)
  const local_0 = !manifest.sourceKnown || manifest.sameServer;
  return local_0 && manifest.ownDatabase ? ({ ...restore, phase: "Refused", reason: "OwnDatabase" } as Restore) : (local_0 && manifest.rolesRequested ? ({ ...restore, phase: "Refused", reason: "RolesOnSource" } as Restore) : (manifest.encrypted && !manifest.dumpPresent ? ({ ...restore, phase: "Refused", reason: "NeedsDecryption" } as Restore) : (manifest.keepPrivileges && !(manifest.replaySource || manifest.sourceLost) ? ({ ...restore, phase: "Refused", reason: "NeedsReplaySource" } as Restore) : ({ ...restore, phase: "CheckingTarget", runRoles: manifest.rolesRequested, keepPrivileges: manifest.keepPrivileges, replayPrivacy: manifest.replaySource } as Restore))));
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md) */
//@ pure
export function shouldApplyRoles(restore: Restore, rolesPresent: boolean): boolean {
  return restore.phase === "RestoringDump" && restore.runRoles && rolesPresent;
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md) */
//@ pure
export function lawRolesRequireKnownOtherServer(manifest: ManifestFacts): boolean {
  //@ ensures \result === true
  return !checkManifest(({ ...initial, phase: "CheckingSource" } as Restore), manifest).runRoles || (manifest.sourceKnown && !manifest.sameServer);
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md) */
//@ pure
export function lawRecoveryDecidesPrivacyReplay(manifest: ManifestFacts): boolean {
  //@ ensures \result === true
  return !(manifest.keepPrivileges && checkManifest(({ ...initial, phase: "CheckingSource" } as Restore), manifest).phase === "CheckingTarget") || (manifest.replaySource || manifest.sourceLost);
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function canCheckTarget(restore: Restore): boolean {
  return restore.phase === "CheckingTarget";
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function checkTarget(restore: Restore, targetExists: boolean): Restore {
  //@ ensures (inv(restore) && canCheckTarget(restore)) ==> alwaysReplayRequestedBeforeFinish(\result)
  //@ ensures (inv(restore) && canCheckTarget(restore)) ==> stepCountsFollowRestore(restore, "checkTarget", \result)
  return targetExists ? ({ ...restore, phase: "Refused", reason: "TargetExists" } as Restore) : ({ ...restore, phase: "CreatingTarget" } as Restore);
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function canRecordCreation(restore: Restore): boolean {
  return restore.phase === "CreatingTarget";
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function recordCreation(restore: Restore): Restore {
  //@ ensures (inv(restore) && canRecordCreation(restore)) ==> alwaysReplayRequestedBeforeFinish(\result)
  //@ ensures (inv(restore) && canRecordCreation(restore)) ==> stepCountsFollowRestore(restore, "recordCreation", \result)
  return { ...restore, phase: "RestoringDump" };
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function canRecordDump(restore: Restore): boolean {
  return restore.phase === "RestoringDump";
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function recordDump(restore: Restore): Restore {
  //@ ensures (inv(restore) && canRecordDump(restore)) ==> alwaysReplayRequestedBeforeFinish(\result)
  //@ ensures (inv(restore) && canRecordDump(restore)) ==> stepCountsFollowRestore(restore, "recordDump", \result)
  return { ...restore, phase: "CheckingCounts" };
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function canRecordCounts(restore: Restore): boolean {
  return restore.phase === "CheckingCounts";
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function recordCounts(restore: Restore, countsAgree: boolean): Restore {
  //@ ensures (inv(restore) && canRecordCounts(restore)) ==> alwaysReplayRequestedBeforeFinish(\result)
  //@ ensures (inv(restore) && canRecordCounts(restore)) ==> stepCountsFollowRestore(restore, "recordCounts", \result)
  return { ...restore, phase: restore.replayPrivacy ? "ReplayingPrivacy" : "Finished", countsAgree: countsAgree };
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function canRecordPrivacyReplay(restore: Restore): boolean {
  return restore.phase === "ReplayingPrivacy";
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function recordPrivacyReplay(restore: Restore): Restore {
  //@ ensures (inv(restore) && canRecordPrivacyReplay(restore)) ==> alwaysReplayRequestedBeforeFinish(\result)
  //@ ensures (inv(restore) && canRecordPrivacyReplay(restore)) ==> stepCountsFollowRestore(restore, "recordPrivacyReplay", \result)
  return { ...restore, phase: "Finished", privacyReplayed: true };
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function stepCountsFollowRestore(before: Restore, via: string, after: Restore): boolean {
  return !(after.phase === "Finished") || ((via === "recordCounts" && before.phase === "CheckingCounts") || (via === "recordPrivacyReplay" && before.phase === "ReplayingPrivacy"));
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function alwaysReplayRequestedBeforeFinish(restore: Restore): boolean {
  return !(restore.phase === "Finished" && restore.replayPrivacy) || restore.privacyReplayed;
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function sometimesFinishes(restore: Restore): boolean {
  return restore.phase === "Finished" && restore.countsAgree;
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md) */
//@ pure
export function sometimesFinishesAfterReplay(restore: Restore): boolean {
  return restore.phase === "Finished" && restore.privacyReplayed;
}

/** Story: Carry privacy changes made after the backup into the restored database / A source row that the restored database lacks is replayed (spec/databaseRestore.md) */
//@ pure
export function replaysSourceRow(inRestored: boolean): boolean {
  return !inRestored;
}

/** Story: Carry privacy changes made after the backup into the restored database / A source row that the restored database lacks is replayed (spec/databaseRestore.md) */
//@ pure
export function lawReplayCopiesOnlyMissingRows(inRestored: boolean): boolean {
  //@ ensures \result === true
  return !replaysSourceRow(inRestored) || !inRestored;
}

/** Story: Carry privacy changes made after the backup into the restored database / An erasure after the backup is replayed (spec/databaseRestore.md) */
//@ pure
export function replaysErasure(sourceErased: boolean, restoredErased: boolean): boolean {
  return sourceErased && !restoredErased;
}

/** Story: Carry privacy changes made after the backup into the restored database / An erasure after the backup is replayed (spec/databaseRestore.md) */
//@ pure
export function lawErasedPersonDoesNotStayLive(sourceErased: boolean, restoredErased: boolean): boolean {
  //@ ensures \result === true
  return !sourceErased || (restoredErased || replaysErasure(sourceErased, restoredErased));
}

/** Story: Carry privacy changes made after the backup into the restored database / A leave after the backup is replayed (spec/databaseRestore.md) */
//@ pure
export function replaysLeave(restoredLive: boolean, sourceHasMembership: boolean, sourceLive: boolean, sameMember: boolean): boolean {
  return restoredLive && sourceHasMembership && !(sourceLive && sameMember);
}

/** Story: Carry privacy changes made after the backup into the restored database / A leave after the backup is replayed (spec/databaseRestore.md) */
//@ pure
export function lawUnchangedMembershipStays(restoredLive: boolean): boolean {
  //@ ensures \result === true
  return !replaysLeave(restoredLive, true, true, true);
}

/** Story: Carry privacy changes made after the backup into the restored database / A leave after the backup is replayed (spec/databaseRestore.md) */
//@ pure
export function lawRemovedMembershipLeavesAgain(sameMember: boolean): boolean {
  //@ ensures \result === true
  return replaysLeave(true, true, false, sameMember);
}

/** Story: Carry privacy changes made after the backup into the restored database / A STOP after the backup is replayed on each membership it still covers (spec/databaseRestore.md) */
//@ pure
export function replaysStop(copiedOptOut: boolean, inScope: boolean, membershipLive: boolean, stillOptedOut: boolean): boolean {
  return copiedOptOut && inScope && membershipLive && stillOptedOut;
}

/** Story: Carry privacy changes made after the backup into the restored database / A STOP after the backup is replayed on each membership it still covers (spec/databaseRestore.md) */
//@ pure
export function lawLaterStartIsKept(copiedOptOut: boolean, inScope: boolean, membershipLive: boolean): boolean {
  //@ ensures \result === true
  return !replaysStop(copiedOptOut, inScope, membershipLive, false);
}

/** Story: Carry privacy changes made after the backup into the restored database / A STOP after the backup is replayed on each membership it still covers (spec/databaseRestore.md) */
//@ pure
export function lawStoppedMembershipStops(membershipLive: boolean): boolean {
  //@ ensures \result === true
  return !membershipLive || replaysStop(true, true, membershipLive, true);
}

/** Story: Carry privacy changes made after the backup into the restored database / A STOP after the backup is replayed on each membership it still covers (spec/databaseRestore.md) */
//@ pure
export function lawStopOutsideScopeStays(stillOptedOut: boolean): boolean {
  //@ ensures \result === true
  return !replaysStop(true, false, true, stillOptedOut);
}

/** Story: Carry privacy changes made after the backup into the restored database / The backend runs the queued replay at start, and each item by one runner until it holds (spec/databaseRestore.md) */
//@ pure
export function replayClaims(done: boolean, claimedByOther: boolean): boolean {
  return !done && !claimedByOther;
}

/** Story: Carry privacy changes made after the backup into the restored database / The backend runs the queued replay at start, and each item by one runner until it holds (spec/databaseRestore.md) */
//@ pure
export function replayItemDone(result: ReplayOutcome): boolean {
  return result === "ReplayApplied" || result === "ReplayAlreadyApplied";
}

/** Story: Carry privacy changes made after the backup into the restored database / The backend runs the queued replay at start, and each item by one runner until it holds (spec/databaseRestore.md) */
//@ pure
export function lawOneRunnerPerItem(done: boolean): boolean {
  //@ ensures \result === true
  return !replayClaims(done, true);
}

/** Story: Carry privacy changes made after the backup into the restored database / The backend runs the queued replay at start, and each item by one runner until it holds (spec/databaseRestore.md) */
//@ pure
export function lawDoneItemRunsOnce(claimedByOther: boolean): boolean {
  //@ ensures \result === true
  return !replayClaims(true, claimedByOther);
}

/** Story: Carry privacy changes made after the backup into the restored database / The backend runs the queued replay at start, and each item by one runner until it holds (spec/databaseRestore.md) */
//@ pure
export function lawSkippedItemStaysOpen(result: ReplayOutcome): boolean {
  //@ ensures \result === true
  return !(result === "ReplayTargetHeld" || result === "ReplayTargetWithoutPhone" || result === "ReplayRefused") || !replayItemDone(result);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Restore, event: Event): boolean {
  if (event.type === "checkName") return canCheckName(current);
  if (event.type === "checkVersion") return canCheckVersion(current);
  if (event.type === "checkManifest") return canCheckManifest(current);
  if (event.type === "checkTarget") return canCheckTarget(current);
  if (event.type === "recordCreation") return canRecordCreation(current);
  if (event.type === "recordDump") return canRecordDump(current);
  if (event.type === "recordCounts") return canRecordCounts(current);
  if (event.type === "recordPrivacyReplay") return canRecordPrivacyReplay(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Restore, event: Event): Restore {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkName") return canCheckName(current) ? checkName(current, event.name, event.validName) : current;
  if (event.type === "checkVersion") return canCheckVersion(current) ? checkVersion(current, event.versionOne) : current;
  if (event.type === "checkManifest") return canCheckManifest(current) ? checkManifest(current, event.manifest) : current;
  if (event.type === "checkTarget") return canCheckTarget(current) ? checkTarget(current, event.targetExists) : current;
  if (event.type === "recordCreation") return canRecordCreation(current) ? recordCreation(current) : current;
  if (event.type === "recordDump") return canRecordDump(current) ? recordDump(current) : current;
  if (event.type === "recordCounts") return canRecordCounts(current) ? recordCounts(current, event.countsAgree) : current;
  if (event.type === "recordPrivacyReplay") return canRecordPrivacyReplay(current) ? recordPrivacyReplay(current) : current;
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
  const is_ManifestFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.sourceKnown === "boolean" && typeof v.sameServer === "boolean" && typeof v.ownDatabase === "boolean" && typeof v.rolesRequested === "boolean" && typeof v.encrypted === "boolean" && typeof v.dumpPresent === "boolean" && typeof v.keepPrivileges === "boolean" && typeof v.replaySource === "boolean" && typeof v.sourceLost === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "checkName" && typeof raw.name === "string" && typeof raw.validName === "boolean") return { type: "checkName", name: raw.name, validName: raw.validName };
  if (raw.type === "checkVersion" && typeof raw.versionOne === "boolean") return { type: "checkVersion", versionOne: raw.versionOne };
  if (raw.type === "checkManifest" && is_ManifestFacts(raw.manifest)) return { type: "checkManifest", manifest: ({ sourceKnown: raw.manifest.sourceKnown, sameServer: raw.manifest.sameServer, ownDatabase: raw.manifest.ownDatabase, rolesRequested: raw.manifest.rolesRequested, encrypted: raw.manifest.encrypted, dumpPresent: raw.manifest.dumpPresent, keepPrivileges: raw.manifest.keepPrivileges, replaySource: raw.manifest.replaySource, sourceLost: raw.manifest.sourceLost }) };
  if (raw.type === "checkTarget" && typeof raw.targetExists === "boolean") return { type: "checkTarget", targetExists: raw.targetExists };
  if (raw.type === "recordCreation") return { type: "recordCreation" };
  if (raw.type === "recordDump") return { type: "recordDump" };
  if (raw.type === "recordCounts" && typeof raw.countsAgree === "boolean") return { type: "recordCounts", countsAgree: raw.countsAgree };
  if (raw.type === "recordPrivacyReplay") return { type: "recordPrivacyReplay" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): Restore | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Starting" || raw.phase === "ReadingManifest" || raw.phase === "CheckingSource" || raw.phase === "CheckingTarget" || raw.phase === "CreatingTarget" || raw.phase === "RestoringDump" || raw.phase === "CheckingCounts" || raw.phase === "ReplayingPrivacy" || raw.phase === "Finished" || raw.phase === "Refused") && (raw.reason === "NoneYet" || raw.reason === "InvalidTarget" || raw.reason === "UnknownManifest" || raw.reason === "OwnDatabase" || raw.reason === "RolesOnSource" || raw.reason === "NeedsDecryption" || raw.reason === "TargetExists" || raw.reason === "NeedsReplaySource") && typeof raw.runRoles === "boolean" && typeof raw.keepPrivileges === "boolean" && typeof raw.countsAgree === "boolean" && typeof raw.replayPrivacy === "boolean" && typeof raw.privacyReplayed === "boolean" && Object.keys(raw).length === 7)) return undefined;
  const parsed: Restore = ({ phase: raw.phase, reason: raw.reason, runRoles: raw.runRoles, keepPrivileges: raw.keepPrivileges, countsAgree: raw.countsAgree, replayPrivacy: raw.replayPrivacy, privacyReplayed: raw.privacyReplayed });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Restore {
  //@ ensures inv(\result)
  return initial;
}
