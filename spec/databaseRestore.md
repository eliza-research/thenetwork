# Restore a database backup

The [imported restore model](models/backup_restore.md) describes target placement and operator cleanup. This module drives the restore command from scratch-target admission through row-count comparison. The shell supplies filesystem, server identity, Postgres, and command results.

## Story: Check a backup by restoring it into a new database

> As an operator, I want a restore to use a new scratch database and report whether its row counts agree with the backup.

### The target must be a valid scratch database name

Check the name before reading the manifest. Reserved live and maintenance names cannot be scratch targets. The shell supplies the name grammar result.

```quint
type RestorePhase = Starting | ReadingManifest | CheckingSource | CheckingTarget | CreatingTarget | RestoringDump | CheckingCounts | Finished | Refused
type RestoreReason = NoneYet | InvalidTarget | UnknownManifest | OwnDatabase | RolesOnSource | NeedsDecryption | TargetExists
type Restore = { phase: RestorePhase, reason: RestoreReason, runRoles: bool, keepPrivileges: bool, countsAgree: bool }

pure val initial: Restore = { phase: Starting, reason: NoneYet, runRoles: false, keepPrivileges: false, countsAgree: false }
pure val liveNames: Set[str] = Set("railway", "network", "postgres", "template0", "template1")

pure def canCheckName(restore: Restore): bool = restore.phase == Starting
pure def checkName(restore: Restore, name: str, validName: bool): Restore =
  if (validName and not(liveNames.contains(name))) { ...restore, phase: ReadingManifest }
  else { ...restore, phase: Refused, reason: InvalidTarget }
```

### Manifest admission refuses source writes and unavailable dump files

Version 1 is the supported manifest. If the manifest omits the source, use the same restrictions as for the source server. The backup's own database and a whole-server role restore are refused on that server. An encrypted manifest needs a decrypted dump at the path it names. Preserve object privileges only on an explicit request. Apply the role file only on an explicit request with the file present after source checks.

```quint
type ManifestFacts = { sourceKnown: bool, sameServer: bool, ownDatabase: bool,
  rolesRequested: bool, encrypted: bool, dumpPresent: bool, keepPrivileges: bool }

pure val manifestValues: Set[ManifestFacts] = Set(
  { sourceKnown: true, sameServer: true, ownDatabase: true, rolesRequested: false, encrypted: false, dumpPresent: true, keepPrivileges: false },
  { sourceKnown: false, sameServer: false, ownDatabase: false, rolesRequested: true, encrypted: false, dumpPresent: true, keepPrivileges: true },
  { sourceKnown: true, sameServer: true, ownDatabase: false, rolesRequested: false, encrypted: false, dumpPresent: true, keepPrivileges: false },
  { sourceKnown: true, sameServer: false, ownDatabase: false, rolesRequested: true, encrypted: true, dumpPresent: false, keepPrivileges: true },
  { sourceKnown: true, sameServer: false, ownDatabase: false, rolesRequested: true, encrypted: true, dumpPresent: true, keepPrivileges: true }
)

pure def canCheckVersion(restore: Restore): bool = restore.phase == ReadingManifest
pure def checkVersion(restore: Restore, versionOne: bool): Restore =
  if (versionOne) { ...restore, phase: CheckingSource }
  else { ...restore, phase: Refused, reason: UnknownManifest }

pure def canCheckManifest(restore: Restore): bool = restore.phase == CheckingSource
pure def checkManifest(restore: Restore, manifest: ManifestFacts): Restore = {
  val source = not(manifest.sourceKnown) or manifest.sameServer
  if (source and manifest.ownDatabase) { ...restore, phase: Refused, reason: OwnDatabase }
  else if (source and manifest.rolesRequested) { ...restore, phase: Refused, reason: RolesOnSource }
  else if (manifest.encrypted and not(manifest.dumpPresent)) { ...restore, phase: Refused, reason: NeedsDecryption }
  else { ...restore, phase: CheckingTarget, runRoles: manifest.rolesRequested,
    keepPrivileges: manifest.keepPrivileges }
}

pure def shouldApplyRoles(restore: Restore, rolesPresent: bool): bool =
  restore.phase == RestoringDump and restore.runRoles and rolesPresent

pure def lawRolesRequireKnownOtherServer(manifest: ManifestFacts): bool =
  checkManifest({ ...initial, phase: CheckingSource }, manifest).runRoles implies manifest.sourceKnown and not(manifest.sameServer)
```

### Create the database before restoring and compare counts after the dump

Refuse a target that already exists. Restore only after Postgres creates the database. After the dump is applied, compare the restored row counts with the manifest and report the result. Errors from file reads, database creation, or the dump continue to abort the command.

```quint
pure def canCheckTarget(restore: Restore): bool = restore.phase == CheckingTarget
pure def checkTarget(restore: Restore, targetExists: bool): Restore =
  if (targetExists) { ...restore, phase: Refused, reason: TargetExists }
  else { ...restore, phase: CreatingTarget }

pure def canRecordCreation(restore: Restore): bool = restore.phase == CreatingTarget
pure def recordCreation(restore: Restore): Restore = { ...restore, phase: RestoringDump }

pure def canRecordDump(restore: Restore): bool = restore.phase == RestoringDump
pure def recordDump(restore: Restore): Restore = { ...restore, phase: CheckingCounts }

pure def canRecordCounts(restore: Restore): bool = restore.phase == CheckingCounts
pure def recordCounts(restore: Restore, countsAgree: bool): Restore = { ...restore, phase: Finished, countsAgree: countsAgree }

pure def stepCountsFollowRestore(before: Restore, via: str, after: Restore): bool =
  after.phase == Finished implies (via == "recordCounts" and before.phase == CheckingCounts)

pure def sometimesFinishes(restore: Restore): bool = restore.phase == Finished and restore.countsAgree
```
