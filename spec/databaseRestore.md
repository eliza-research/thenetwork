# Restore a database backup

The [imported restore model](models/backup_restore.md) describes target placement and operator cleanup. This module drives the restore command from scratch-target admission through row-count comparison and the privacy replay. The shell supplies filesystem, server identity, Postgres, and command results. [Story F24](product/stories.md#story-f24--export-or-delete-my-data) requires that an erasure propagates through a restore.

## Story: Check a backup by restoring it into a new database

> As an operator, I want a restore to use a new scratch database and report whether its row counts agree with the backup.

### The target must be a valid scratch database name

Check the name before reading the manifest. Reserved live and maintenance names cannot be scratch targets. The shell supplies the name grammar result.

```quint
type RestorePhase = Starting | ReadingManifest | CheckingSource | CheckingTarget | CreatingTarget | RestoringDump | CheckingCounts | ReplayingPrivacy | Finished | Refused
type RestoreReason = NoneYet | InvalidTarget | UnknownManifest | OwnDatabase | RolesOnSource | NeedsDecryption | TargetExists | NeedsReplaySource
type Restore = { phase: RestorePhase, reason: RestoreReason, runRoles: bool, keepPrivileges: bool, countsAgree: bool,
  replayPrivacy: bool, privacyReplayed: bool }

pure val initial: Restore = { phase: Starting, reason: NoneYet, runRoles: false, keepPrivileges: false, countsAgree: false,
  replayPrivacy: false, privacyReplayed: false }
pure val liveNames: Set[str] = Set("railway", "network", "postgres", "template0", "template1")

pure def canCheckName(restore: Restore): bool = restore.phase == Starting
pure def checkName(restore: Restore, name: str, validName: bool): Restore =
  if (validName and not(liveNames.contains(name))) { ...restore, phase: ReadingManifest }
  else { ...restore, phase: Refused, reason: InvalidTarget }
```

### Manifest admission refuses source writes and unavailable dump files

Version 1 is the supported manifest. If the manifest omits the source, use the same restrictions as for the source server. The backup's own database and a whole-server role restore are refused on that server. An encrypted manifest needs a decrypted dump at the path it names. Preserve object privileges only on an explicit request. Apply the role file only on an explicit request with the file present after source checks. A recovery, which preserves privileges, also needs a privacy replay source or the operator's explicit statement that the source database is lost. Changed for F24: before this change a recovery could bring back erased people and undo a STOP, leave or ban made after the backup, so a recovery now refuses to start until the operator names the replay source or states that it is lost.

```quint
type ManifestFacts = { sourceKnown: bool, sameServer: bool, ownDatabase: bool,
  rolesRequested: bool, encrypted: bool, dumpPresent: bool, keepPrivileges: bool, replaySource: bool, sourceLost: bool }

pure val manifestValues: Set[ManifestFacts] = Set(
  { sourceKnown: true, sameServer: true, ownDatabase: true, rolesRequested: false, encrypted: false, dumpPresent: true, keepPrivileges: false, replaySource: false, sourceLost: false },
  { sourceKnown: false, sameServer: false, ownDatabase: false, rolesRequested: true, encrypted: false, dumpPresent: true, keepPrivileges: true, replaySource: false, sourceLost: true },
  { sourceKnown: true, sameServer: true, ownDatabase: false, rolesRequested: false, encrypted: false, dumpPresent: true, keepPrivileges: false, replaySource: false, sourceLost: false },
  { sourceKnown: true, sameServer: true, ownDatabase: false, rolesRequested: false, encrypted: false, dumpPresent: true, keepPrivileges: false, replaySource: true, sourceLost: false },
  { sourceKnown: true, sameServer: false, ownDatabase: false, rolesRequested: true, encrypted: true, dumpPresent: false, keepPrivileges: true, replaySource: true, sourceLost: false },
  { sourceKnown: true, sameServer: false, ownDatabase: false, rolesRequested: true, encrypted: true, dumpPresent: true, keepPrivileges: true, replaySource: true, sourceLost: false },
  { sourceKnown: true, sameServer: false, ownDatabase: false, rolesRequested: false, encrypted: false, dumpPresent: true, keepPrivileges: true, replaySource: false, sourceLost: false }
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
  else if (manifest.keepPrivileges and not(manifest.replaySource or manifest.sourceLost)) { ...restore, phase: Refused, reason: NeedsReplaySource }
  else { ...restore, phase: CheckingTarget, runRoles: manifest.rolesRequested,
    keepPrivileges: manifest.keepPrivileges, replayPrivacy: manifest.replaySource }
}

pure def shouldApplyRoles(restore: Restore, rolesPresent: bool): bool =
  restore.phase == RestoringDump and restore.runRoles and rolesPresent

pure def lawRolesRequireKnownOtherServer(manifest: ManifestFacts): bool =
  checkManifest({ ...initial, phase: CheckingSource }, manifest).runRoles implies manifest.sourceKnown and not(manifest.sameServer)

pure def lawRecoveryDecidesPrivacyReplay(manifest: ManifestFacts): bool =
  (manifest.keepPrivileges and checkManifest({ ...initial, phase: CheckingSource }, manifest).phase == CheckingTarget) implies
    (manifest.replaySource or manifest.sourceLost)
```

### Create the database before restoring and compare counts after the dump

Refuse a target that already exists. Restore only after Postgres creates the database. After the dump is applied, compare the restored row counts with the manifest and report the result. With a replay source, the privacy replay follows the count check, and the restore finishes only after it. Errors from file reads, database creation, the dump, or the replay continue to abort the command. Changed for F24: the restore used to finish at the count check; with a replay source it now finishes after the privacy replay.

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
pure def recordCounts(restore: Restore, countsAgree: bool): Restore =
  { ...restore, phase: if (restore.replayPrivacy) ReplayingPrivacy else Finished, countsAgree: countsAgree }

pure def canRecordPrivacyReplay(restore: Restore): bool = restore.phase == ReplayingPrivacy
pure def recordPrivacyReplay(restore: Restore): Restore = { ...restore, phase: Finished, privacyReplayed: true }

pure def stepCountsFollowRestore(before: Restore, via: str, after: Restore): bool =
  after.phase == Finished implies
    ((via == "recordCounts" and before.phase == CheckingCounts) or (via == "recordPrivacyReplay" and before.phase == ReplayingPrivacy))

pure def alwaysReplayRequestedBeforeFinish(restore: Restore): bool =
  (restore.phase == Finished and restore.replayPrivacy) implies restore.privacyReplayed

pure def sometimesFinishes(restore: Restore): bool = restore.phase == Finished and restore.countsAgree
pure def sometimesFinishesAfterReplay(restore: Restore): bool = restore.phase == Finished and restore.privacyReplayed
```

## Story: Carry privacy changes made after the backup into the restored database

> As a member who erased my account, said STOP, left an app, or was banned after the last backup, I want a restore to keep that change.

The replay source is the source database: the command reads it after the dump is applied and before the backend serves the restored database. The dump is one snapshot, so a source row that the restored database does not have was written after the backup. The shell copies the missing consent events, bans and suppressions at once: the send path, joins and sign-in read them, so no message reaches these people even before the backend runs. It queues each erasure and leave for the backend, which runs the member's own account erasure or app leave through the staff replay route and its hooks. A copied ban starts without its projection receipt, and the replay route resumes the ban projection. If the source database cannot be read, nothing can be replayed: the operator states it and records the lost window.

### A source row that the restored database lacks is replayed

New rule (F24): consent events, bans and suppressions are append-only facts. A row that the restored database does not have is copied with its own identifier, so a second replay copies nothing.

```quint
pure def replaysSourceRow(inRestored: bool): bool = not(inRestored)
pure def lawReplayCopiesOnlyMissingRows(inRestored: bool): bool = replaysSourceRow(inRestored) implies not(inRestored)
```

### An erasure after the backup is replayed

New rule (F24): a person whose tombstone is in the source and who is live in the restored database is erased again with the account erasure.

```quint
pure def replaysErasure(sourceErased: bool, restoredErased: bool): bool = sourceErased and not(restoredErased)
pure def lawErasedPersonDoesNotStayLive(sourceErased: bool, restoredErased: bool): bool =
  sourceErased implies (restoredErased or replaysErasure(sourceErased, restoredErased))
```

### A leave after the backup is replayed

New rule (F24): a live restored membership whose source membership was removed, or replaced by a new member after a leave and a new join, leaves the app again. A person erased in the source has no membership rows there, and the erasure covers them.

```quint
pure def replaysLeave(restoredLive: bool, sourceHasMembership: bool, sourceLive: bool, sameMember: bool): bool =
  restoredLive and sourceHasMembership and not(sourceLive and sameMember)
pure def lawUnchangedMembershipStays(restoredLive: bool): bool = not(replaysLeave(restoredLive, true, true, true))
pure def lawRemovedMembershipLeavesAgain(sameMember: bool): bool = replaysLeave(true, true, false, sameMember)
```
