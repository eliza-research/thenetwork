# Restore a database backup

The [imported restore model](models/backup_restore.md) describes target placement and operator cleanup. This module drives the restore command from scratch-target admission through row-count comparison, the privacy replay and the queued texts of the restored database. The shell supplies filesystem, server identity, Postgres, and command results. [Story F24](product/stories.md#story-f24--export-or-delete-my-data) requires that an erasure propagates through a restore.

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

The replay source is the source database: the command reads it after the dump is applied and before the backend serves the restored database. The dump is one snapshot, so a source row that the restored database does not have was written after the backup. The shell copies the missing consent events, bans and suppressions at once: the send path, joins and sign-in read them, so no message reaches these people even before the backend runs. It queues each erasure, leave and STOP for the backend, which runs the member's own account erasure, app leave or STOP path and their hooks; the backend registers every forget and erasure hook (the connector grants included) before it runs the queue. A copied ban starts without its projection receipt, and the backend resumes the ban projection; in the same restore transaction the shell removes the banned number's queued texts and revokes the banned person's live shares, as the live ban write does. The backend runs the queue when it starts, before its first tick and before it serves a request; the staff replay route runs the same queue again for the items that could not run. If the source database cannot be read, nothing can be replayed: the operator states it and records the lost window. Changed after review: the STOP replay used to copy only the consent events, so a member who sent STOP after the backup stayed eligible for matching; and the queue used to wait for a staff call.

### A source row that the restored database lacks is replayed

New rule (F24): consent events, bans and suppressions are append-only facts. A row that the restored database does not have is copied with its own identifier, so a second replay copies nothing.

```quint
pure def replaysSourceRow(inRestored: bool): bool = not(inRestored)
pure def lawReplayCopiesOnlyMissingRows(inRestored: bool): bool = replaysSourceRow(inRestored) implies not(inRestored)
```

### An erasure after the backup is replayed

New rule (F24): every account erasure appends one row to the erasure ledger, and a later join of the same number does not remove it. A person with a ledger row in the source that the restored database lacks, and who is live in the restored database, is erased again with the account erasure. Changed after review: the rule used to read the source tombstone, but a new join by the same number revives the tombstone, so a person who erased and then joined another app was missed and the restore brought back the erased memberships, profiles and opt-ins.

```quint
pure def replaysErasure(erasedAfterBackup: bool, restoredErased: bool): bool = erasedAfterBackup and not(restoredErased)
pure def lawErasedPersonDoesNotStayLive(erasedAfterBackup: bool, restoredErased: bool): bool =
  erasedAfterBackup implies (restoredErased or replaysErasure(erasedAfterBackup, restoredErased))
pure def lawNoErasureNoReplay(restoredErased: bool): bool = not(replaysErasure(false, restoredErased))
```

### A leave after the backup is replayed

New rule (F24): a live restored membership whose source membership was removed, or replaced by a new member after a leave and a new join, leaves the app again. A person erased in the source has no membership rows there, and the erasure ledger covers them, also after the same number joined again. Changed after review: the last sentence used to rely on the tombstone, which a new join revives.

```quint
pure def replaysLeave(restoredLive: bool, sourceHasMembership: bool, sourceLive: bool, sameMember: bool): bool =
  restoredLive and sourceHasMembership and not(sourceLive and sameMember)
pure def lawUnchangedMembershipStays(restoredLive: bool): bool = not(replaysLeave(restoredLive, true, true, true))
pure def lawRemovedMembershipLeavesAgain(sameMember: bool): bool = replaysLeave(true, true, false, sameMember)
```

### A STOP after the backup is replayed on each membership it still covers

New rule (F24, after review): a copied consent event that is an opt-out, for one app or for every app, reaches each live membership of the number's person in its scope whose consent for that app still resolves to opted out after the copy. The backend runs the member path of a STOP on that membership: the Network's STOP handling, the opted-out flag that matching reads, and the paused membership. It sends no confirmation, because the member had it before the restore. A later START that was copied too keeps the membership, so the replay never undoes a newer opt-in. Before this rule only the consent events were copied, and the member stayed eligible for matching.

```quint
pure def replaysStop(copiedOptOut: bool, inScope: bool, membershipLive: bool, stillOptedOut: bool): bool =
  copiedOptOut and inScope and membershipLive and stillOptedOut
pure def lawLaterStartIsKept(copiedOptOut: bool, inScope: bool, membershipLive: bool): bool =
  not(replaysStop(copiedOptOut, inScope, membershipLive, false))
pure def lawStoppedMembershipStops(membershipLive: bool): bool = membershipLive implies replaysStop(true, true, membershipLive, true)
pure def lawStopOutsideScopeStays(stillOptedOut: bool): bool = not(replaysStop(true, false, true, stillOptedOut))
```

### The backend runs a queued erasure or leave only after the connector hooks are registered

New rule (F24, after review): the start refuses to run the queue while an erasure or leave item is open, the database has the connector schema, and no connector forget hook is registered. Before this rule the production backend ran the queue before it registered the connector hooks, so a replayed erasure or leave marked the item done and kept the restored OAuth grants, tokens and connector requests.

```quint
pure def replayStartAllowed(openForgetItem: bool, connectorSchema: bool, connectorHooks: bool): bool =
  not(openForgetItem and connectorSchema and not(connectorHooks))
pure def lawForgetReplayNeedsConnectorHooks(openForgetItem: bool, connectorHooks: bool): bool =
  (openForgetItem and not(connectorHooks)) implies not(replayStartAllowed(openForgetItem, true, connectorHooks))
pure def lawNoConnectorSchemaNoWait(openForgetItem: bool, connectorHooks: bool): bool =
  replayStartAllowed(openForgetItem, false, connectorHooks)
```

### The backend runs the queued replay at start, and each item by one runner until it holds

New rule (F24, after review): a runner takes an item only when it is not done and no other runner holds an unexpired claim on it. An item is done when its change was applied or was already in place. An item that cannot run yet (the phone is on hold, the person has no phone, or the account path refused it) stays open: the start logs an alert, and each later start or staff replay retries it. Before this rule the queue ran only on a staff call, two calls could run one item twice, and a skipped item was marked done for good.

```quint
type ReplayOutcome = ReplayApplied | ReplayAlreadyApplied | ReplayTargetHeld | ReplayTargetWithoutPhone | ReplayRefused

pure def replayClaims(done: bool, claimedByOther: bool): bool = not(done) and not(claimedByOther)
pure def replayItemDone(result: ReplayOutcome): bool = result == ReplayApplied or result == ReplayAlreadyApplied

pure def lawOneRunnerPerItem(done: bool): bool = not(replayClaims(done, true))
pure def lawDoneItemRunsOnce(claimedByOther: bool): bool = not(replayClaims(true, claimedByOther))
pure def lawSkippedItemStaysOpen(result: ReplayOutcome): bool =
  (result == ReplayTargetHeld or result == ReplayTargetWithoutPhone or result == ReplayRefused) implies not(replayItemDone(result))
```

## Story: Do not send a text again after a restore

> As a member, I want a restore never to send me again a text that the Network sent or ended after the backup.

### A restored text that is not settled takes the source's outcome, or ends

New rule: the backup holds each queued text in the state it had at backup time, so a text that was sent after the backup still waits in the restored database. A restored text is not settled when the backend can still send it (it waits), when staff can still release it (it is parked for leak review), or when its outcome is in doubt (the gateway collected it, its send is unknown, or it failed with an unknown outcome). With a replay source, each restored text that is not settled takes the status and the send record of the same text in the source. A waiting or parked text that the source no longer has ends as expired. When the operator states that the source database is lost, every waiting or parked text ends as expired, because nothing shows which of them went out. A text in doubt that the source does not show keeps its restored state, because the backend never sends it again and it keeps its person-cap slot. A settled text keeps its restored state. Before this rule a recovery sent again every text that the backup held as pending. Changed (review): parked and in-doubt texts now also take the source's outcome, because before this change a parked text that staff released and sent after the backup was parked again in the restored database, and staff could release it a second time.

```quint
type RestoredText = KeepRestoredText | TakeSourceText | EndRestoredText
type RestoredTextStatus = SettledText | WaitingText | ParkedText | InDoubtText

pure def restoredText(status: RestoredTextStatus, sourceRead: bool, sourceHasText: bool): RestoredText =
  if (status == SettledText) KeepRestoredText
  else if (sourceRead and sourceHasText) TakeSourceText
  else if (status == InDoubtText) KeepRestoredText
  else EndRestoredText

pure def lawWaitingTextNeverStaysAsRestored(sourceRead: bool, sourceHasText: bool): bool =
  restoredText(WaitingText, sourceRead, sourceHasText) != KeepRestoredText and
    restoredText(ParkedText, sourceRead, sourceHasText) != KeepRestoredText
pure def lawLostSourceEndsWaitingText(sourceHasText: bool): bool =
  restoredText(WaitingText, false, sourceHasText) == EndRestoredText and
    restoredText(ParkedText, false, sourceHasText) == EndRestoredText
pure def lawSettledTextKeepsItsState(sourceRead: bool, sourceHasText: bool): bool =
  restoredText(SettledText, sourceRead, sourceHasText) == KeepRestoredText
pure def lawSourceOutcomeWins(status: RestoredTextStatus): bool =
  status != SettledText implies restoredText(status, true, true) == TakeSourceText
pure def lawInDoubtTextNeverEnds(sourceRead: bool, sourceHasText: bool): bool =
  restoredText(InDoubtText, sourceRead, sourceHasText) != EndRestoredText
```
