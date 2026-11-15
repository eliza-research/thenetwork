// GENERATED from spec/databaseRestore.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md:9) */
export type RestorePhase = "Starting" | "ReadingManifest" | "CheckingSource" | "CheckingTarget" | "CreatingTarget" | "RestoringDump" | "CheckingCounts" | "Finished" | "Refused";
/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md:9) */
export type RestoreReason = "NoneYet" | "InvalidTarget" | "UnknownManifest" | "OwnDatabase" | "RolesOnSource" | "NeedsDecryption" | "TargetExists";
/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md:9) */
export interface Restore { phase: RestorePhase; reason: RestoreReason; runRoles: boolean; keepPrivileges: boolean; countsAgree: boolean }
/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md:27) */
export interface ManifestFacts { sourceKnown: boolean; sameServer: boolean; ownDatabase: boolean; rolesRequested: boolean; encrypted: boolean; dumpPresent: boolean; keepPrivileges: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkName"; name: string; validName: boolean }
  | { type: "checkVersion"; versionOne: boolean }
  | { type: "checkManifest"; manifest: ManifestFacts }
  | { type: "checkTarget"; targetExists: boolean }
  | { type: "recordCreation" }
  | { type: "recordDump" }
  | { type: "recordCounts"; countsAgree: boolean };

/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md:9) */
export const liveNames: string[] = ["railway", "network", "postgres", "template0", "template1"];
/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md:9) */
export const initial: Restore = { phase: "Starting", reason: "NoneYet", runRoles: false, keepPrivileges: false, countsAgree: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Restore): boolean {
  return true;
}

/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md:9) */
//@ pure
export function canCheckName(restore: Restore): boolean {
  return restore.phase === "Starting";
}

/** Story: Check a backup by restoring it into a new database / The target must be a valid scratch database name (spec/databaseRestore.md:9) */
//@ pure
export function checkName(restore: Restore, name: string, validName: boolean): Restore {
  //@ ensures (inv(restore) && canCheckName(restore)) ==> stepCountsFollowRestore(restore, "checkName", \result)
  return validName && !liveNames.includes(name) ? ({ ...restore, phase: "ReadingManifest" } as Restore) : ({ ...restore, phase: "Refused", reason: "InvalidTarget" } as Restore);
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md:27) */
//@ pure
export function canCheckVersion(restore: Restore): boolean {
  return restore.phase === "ReadingManifest";
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md:27) */
//@ pure
export function checkVersion(restore: Restore, versionOne: boolean): Restore {
  //@ ensures (inv(restore) && canCheckVersion(restore)) ==> stepCountsFollowRestore(restore, "checkVersion", \result)
  return versionOne ? ({ ...restore, phase: "CheckingSource" } as Restore) : ({ ...restore, phase: "Refused", reason: "UnknownManifest" } as Restore);
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md:27) */
//@ pure
export function canCheckManifest(restore: Restore): boolean {
  return restore.phase === "CheckingSource";
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md:27) */
//@ pure
export function checkManifest(restore: Restore, manifest: ManifestFacts): Restore {
  //@ ensures (inv(restore) && canCheckManifest(restore)) ==> stepCountsFollowRestore(restore, "checkManifest", \result)
  const source: boolean = !manifest.sourceKnown || manifest.sameServer;
  return source && manifest.ownDatabase ? ({ ...restore, phase: "Refused", reason: "OwnDatabase" } as Restore) : (source && manifest.rolesRequested ? ({ ...restore, phase: "Refused", reason: "RolesOnSource" } as Restore) : (manifest.encrypted && !manifest.dumpPresent ? ({ ...restore, phase: "Refused", reason: "NeedsDecryption" } as Restore) : ({ ...restore, phase: "CheckingTarget", runRoles: manifest.rolesRequested, keepPrivileges: manifest.keepPrivileges } as Restore)));
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md:27) */
//@ pure
export function shouldApplyRoles(restore: Restore, rolesPresent: boolean): boolean {
  return restore.phase === "RestoringDump" && restore.runRoles && rolesPresent;
}

/** Story: Check a backup by restoring it into a new database / Manifest admission refuses source writes and unavailable dump files (spec/databaseRestore.md:27) */
//@ pure
export function lawRolesRequireKnownOtherServer(manifest: ManifestFacts): boolean {
  //@ ensures \result === true
  return !checkManifest(({ ...initial, phase: "CheckingSource" } as Restore), manifest).runRoles || (manifest.sourceKnown && !manifest.sameServer);
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function canCheckTarget(restore: Restore): boolean {
  return restore.phase === "CheckingTarget";
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function checkTarget(restore: Restore, targetExists: boolean): Restore {
  //@ ensures (inv(restore) && canCheckTarget(restore)) ==> stepCountsFollowRestore(restore, "checkTarget", \result)
  return targetExists ? ({ ...restore, phase: "Refused", reason: "TargetExists" } as Restore) : ({ ...restore, phase: "CreatingTarget" } as Restore);
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function canRecordCreation(restore: Restore): boolean {
  return restore.phase === "CreatingTarget";
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function recordCreation(restore: Restore): Restore {
  //@ ensures (inv(restore) && canRecordCreation(restore)) ==> stepCountsFollowRestore(restore, "recordCreation", \result)
  return { ...restore, phase: "RestoringDump" };
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function canRecordDump(restore: Restore): boolean {
  return restore.phase === "RestoringDump";
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function recordDump(restore: Restore): Restore {
  //@ ensures (inv(restore) && canRecordDump(restore)) ==> stepCountsFollowRestore(restore, "recordDump", \result)
  return { ...restore, phase: "CheckingCounts" };
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function canRecordCounts(restore: Restore): boolean {
  return restore.phase === "CheckingCounts";
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function recordCounts(restore: Restore, countsAgree: boolean): Restore {
  //@ ensures (inv(restore) && canRecordCounts(restore)) ==> stepCountsFollowRestore(restore, "recordCounts", \result)
  return { ...restore, phase: "Finished", countsAgree: countsAgree };
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function stepCountsFollowRestore(before: Restore, via: string, after: Restore): boolean {
  return !(after.phase === "Finished") || (via === "recordCounts" && before.phase === "CheckingCounts");
}

/** Story: Check a backup by restoring it into a new database / Create the database before restoring and compare counts after the dump (spec/databaseRestore.md:65) */
//@ pure
export function sometimesFinishes(restore: Restore): boolean {
  return restore.phase === "Finished" && restore.countsAgree;
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
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Restore, event: Event): Restore {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkName" && canCheckName(current)) return checkName(current, event.name, event.validName);
  if (event.type === "checkVersion" && canCheckVersion(current)) return checkVersion(current, event.versionOne);
  if (event.type === "checkManifest" && canCheckManifest(current)) return checkManifest(current, event.manifest);
  if (event.type === "checkTarget" && canCheckTarget(current)) return checkTarget(current, event.targetExists);
  if (event.type === "recordCreation" && canRecordCreation(current)) return recordCreation(current);
  if (event.type === "recordDump" && canRecordDump(current)) return recordDump(current);
  if (event.type === "recordCounts" && canRecordCounts(current)) return recordCounts(current, event.countsAgree);
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
  if (raw.type === "checkName" && typeof raw.name === "string" && typeof raw.validName === "boolean") return { type: "checkName", name: raw.name, validName: raw.validName };
  if (raw.type === "checkVersion" && typeof raw.versionOne === "boolean") return { type: "checkVersion", versionOne: raw.versionOne };
  if (raw.type === "checkManifest" && typeof raw.manifest === "object" && raw.manifest !== null && !Array.isArray(raw.manifest) && typeof raw.manifest.sourceKnown === "boolean" && typeof raw.manifest.sameServer === "boolean" && typeof raw.manifest.ownDatabase === "boolean" && typeof raw.manifest.rolesRequested === "boolean" && typeof raw.manifest.encrypted === "boolean" && typeof raw.manifest.dumpPresent === "boolean" && typeof raw.manifest.keepPrivileges === "boolean") return { type: "checkManifest", manifest: ({ sourceKnown: raw.manifest.sourceKnown, sameServer: raw.manifest.sameServer, ownDatabase: raw.manifest.ownDatabase, rolesRequested: raw.manifest.rolesRequested, encrypted: raw.manifest.encrypted, dumpPresent: raw.manifest.dumpPresent, keepPrivileges: raw.manifest.keepPrivileges }) };
  if (raw.type === "checkTarget" && typeof raw.targetExists === "boolean") return { type: "checkTarget", targetExists: raw.targetExists };
  if (raw.type === "recordCreation") return { type: "recordCreation" };
  if (raw.type === "recordDump") return { type: "recordDump" };
  if (raw.type === "recordCounts" && typeof raw.countsAgree === "boolean") return { type: "recordCounts", countsAgree: raw.countsAgree };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Starting" || raw.phase === "ReadingManifest" || raw.phase === "CheckingSource" || raw.phase === "CheckingTarget" || raw.phase === "CreatingTarget" || raw.phase === "RestoringDump" || raw.phase === "CheckingCounts" || raw.phase === "Finished" || raw.phase === "Refused") && (raw.reason === "NoneYet" || raw.reason === "InvalidTarget" || raw.reason === "UnknownManifest" || raw.reason === "OwnDatabase" || raw.reason === "RolesOnSource" || raw.reason === "NeedsDecryption" || raw.reason === "TargetExists") && typeof raw.runRoles === "boolean" && typeof raw.keepPrivileges === "boolean" && typeof raw.countsAgree === "boolean" && Object.keys(raw).length === 5)) return undefined;
  const parsed: Restore = ({ phase: raw.phase, reason: raw.reason, runRoles: raw.runRoles, keepPrivileges: raw.keepPrivileges, countsAgree: raw.countsAgree });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Restore {
  //@ ensures inv(\result)
  return initial;
}
