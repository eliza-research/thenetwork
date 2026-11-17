# Apply staff safety decisions in the service

The [case and report spec](safetyCase.md) governs decisions inside one Network runtime. This module governs the service's targets, action admission, and audit stages. The service resolves staff authority and owned records, writes audits, and calls one runtime at a time. When a member has no linked person, the service's discovery returns only the requested member, so that member is the only target. The service writes the request audit before it runs an admitted action; when that write fails, the action does not run. The hold decision runs inside the audited action. The ban admission runs before the request audit, and the ban rows are written inside the audited action. The requested member's runtime checks, under the case and report spec, that the member and any supplied report match.

## Story: Hold a member without exposing their other memberships

> As a staff member, I want a hold to reach the runtimes I am authorized to act on, with an audit of the decision.

### Staff act within their resolved scope

Staff with safety authority on every app may act on the person's relevant memberships. An app-scoped action only includes the requested runtime. Discovery skips invited and removed memberships. The requested member remains the fallback target when there is no linked person. The hold audit records the authorized scope without recording a membership count.

```quint
pure def staffSafetyMembershipLive(membership: str): bool =
  membership != "removed" and membership != "invited"

pure def staffSafetySelectsTarget(everywhere: bool, requestedRuntime: bool): bool =
  everywhere or requestedRuntime

pure def staffSafetyAuditScope(targets: int): str = if (targets > 1) "every_app" else "this_app"

pure def lawLocalStaffTargetStaysInScope(requestedRuntime: bool): bool =
  staffSafetySelectsTarget(false, requestedRuntime) implies requestedRuntime
```

### Apply a hold to the requested member first

The runtime checks that the member and any supplied report match. Apply holds on the remaining selected targets only if the primary hold succeeds. The supplied report ID goes only to the runtime that owns that member's report. A related target receives no report ID and applies the decision to its own reports.

```quint
type ServiceSafetyPhase =
  ServiceSafetyStarting | HoldRemainingTargets | HoldDidNotApply | BanNeedsCrossApp | BanNoPerson |
  ReadingBanPhones | BanNoPhone | ReadingExistingBan | BanAlreadyExists | ApplyingPhoneBan | ApplyingPersonBan | ResumingBanProjection |
  PerformingAuditedAction | RecordingAuditResult
type ServiceSafetyFlow = { phase: ServiceSafetyPhase, phoneOnly: bool }
pure val initial: ServiceSafetyFlow = { phase: ServiceSafetyStarting, phoneOnly: false }

pure def canReadPrimaryHold(flow: ServiceSafetyFlow): bool = flow.phase == ServiceSafetyStarting
pure def readPrimaryHold(flow: ServiceSafetyFlow, applied: bool): ServiceSafetyFlow =
  { ...flow, phase: if (applied) HoldRemainingTargets else HoldDidNotApply }

pure def staffSafetyReportFor(ownsReport: bool, reportId: str): str = if (ownsReport) reportId else ""

pure def lawOtherTargetsGetNoReport(reportId: str): bool = staffSafetyReportFor(false, reportId) == ""

pure def sometimesCanHoldRelatedTargets(flow: ServiceSafetyFlow): bool = flow.phase == HoldRemainingTargets
```

### A staff hold survives ordinary app membership changes

Commit a successful staff hold for a linked person with the primary runtime decision. An app-scoped actor sets a hold for the requested app. An all-app actor can place a global hold. An authorized lift clears the requested app only. An app-scoped actor can lift a local hold but cannot release global coverage. An all-app actor can release one app from global coverage while the other apps retain it. A new global hold covers all apps again. Recheck ownership and the exact current decision when committing a lift or projecting a related runtime. Keep the scope and decision data private. When migrating older records, preserve an active, identifiable prior staff hold in the app that recorded it.

An ordinary leave removes the app membership and personal data while retaining the scoped restriction. The person can join again and receive permitted replies and safety notices. The matching snapshot and final contact claims check the current app's restriction even if its runtime projection is pending. Whole-account erasure removes the hold record with the other personal data under the existing account privacy procedure.

```quint
pure def durableStaffHoldScope(allAppsAuthority: bool, currentApp: str): str =
  if (allAppsAuthority) "*" else currentApp

pure def durableStaffHoldCoversApp(localHold: bool, globalHold: bool, appReleased: bool): bool =
  localHold or (globalHold and not(appReleased))

pure def durableStaffHoldLiftAllowed(globallyCovered: bool, allAppsAuthority: bool): bool =
  not(globallyCovered) or allAppsAuthority

pure def durableStaffHoldSnapshotStatus(accountStatus: str, staffHeld: bool): str =
  if (staffHeld) "restricted" else accountStatus

pure def lawLocalStaffCannotReleaseGlobalHold(globallyCovered: bool): bool =
  globallyCovered implies not(durableStaffHoldLiftAllowed(globallyCovered, false))

pure def lawReleaseOfOneAppLeavesOtherAppsHeld(globalHold: bool): bool =
  globalHold implies (not(durableStaffHoldCoversApp(false, globalHold, true)) and durableStaffHoldCoversApp(false, globalHold, false))
```

### A committed trust hold follows the person through ordinary app leave

Read the current trust level inside the same runtime unit that forgets an ordinary app member. Preserve a committed hard hold as one scoped record for the exact linked person and app, including a hard hold reached from corroborated reports. Write the restriction before erasing runtime data in that transaction. An existing applicable staff hold or canonical ban already provides authority. A watch, a report without a hard hold, or an existing age restriction does not create a hard-hold record. Phone reassignment and whole-account erasure follow the account cleanup procedure.

Carry only the restriction's source kind, person, app, decision key and time. A member can rejoin. The existing snapshot and peer-contact gates apply the held bit, and authorized staff can lift the carried hard hold for the app. A new explicit staff decision uses the existing staff scope and audit.

```quint
pure def carryTrustHoldOnAppLeave(ordinaryAppLeave: bool, trustLevel: str): bool =
  ordinaryAppLeave and trustLevel == "hold"

pure def carriedTrustHoldRecordAllowed(currentOwner: bool, canonicalBan: bool, staffHoldCoversApp: bool): bool =
  currentOwner and not(canonicalBan or staffHoldCoversApp)

pure def lawWatchDoesNotCarryAcrossLeave(ordinaryAppLeave: bool): bool =
  not(carryTrustHoldOnAppLeave(ordinaryAppLeave, "watch"))

pure def lawCarriedTrustHoldRequiresOneCurrentOwner(canonicalBan: bool, staffHoldCoversApp: bool): bool =
  not(carriedTrustHoldRecordAllowed(false, canonicalBan, staffHoldCoversApp))
```

### Keep the requested and result audits in order

The audit stages are a run of their own, apart from the hold and ban runs. The action runs only after the request audit is recorded. An action that returns gets a subsequent result audit, and only after the action. Preserve the existing best-effort handling for a result-audit failure.

```quint
pure def canRecordRequestedSafetyAudit(flow: ServiceSafetyFlow): bool = flow.phase == ServiceSafetyStarting
pure def recordRequestedSafetyAudit(flow: ServiceSafetyFlow): ServiceSafetyFlow =
  { ...flow, phase: PerformingAuditedAction }

pure def canRecordCompletedSafetyAction(flow: ServiceSafetyFlow): bool = flow.phase == PerformingAuditedAction
pure def recordCompletedSafetyAction(flow: ServiceSafetyFlow): ServiceSafetyFlow =
  { ...flow, phase: RecordingAuditResult }

pure def stepSafetyResultFollowsAction(before: ServiceSafetyFlow, via: str, after: ServiceSafetyFlow): bool =
  after.phase == RecordingAuditResult implies (before.phase == PerformingAuditedAction and via == "recordCompletedSafetyAction")
```

## Story: Resolve a minor signal without dismissing a valid concern

> As a staff member, I want to clear a mistake while preserving the age and report checks on each member.

### Age clearance dismisses only the selected member's open minor reports

Each selected runtime makes its own age-clearance decision. A successful clear or an absent signal can proceed to dismiss the member's open minor reports. Any other refusal leaves their reports in place. An app reports success if the signal cleared or an eligible report was dismissed. Return the first substantive refusal if any runtime refused. Otherwise, any successful app makes the action successful, and no changes returns no signal.

```quint
pure def staffAgeMayReviewReports(cleared: bool, noSignal: bool): bool = cleared or noSignal

pure def staffMinorReportDismissible(sameMember: bool, minorReport: bool, open: bool): bool =
  sameMember and minorReport and open

pure def staffAgeAppCleared(cleared: bool, dismissed: bool): bool = cleared or dismissed

type StaffClearSummary = ClearRefused | ClearSucceeded | ClearNoSignal
pure def staffAgeClearSummary(refused: bool, anyCleared: bool): StaffClearSummary =
  if (refused) ClearRefused else if (anyCleared) ClearSucceeded else ClearNoSignal
```

## Story: Apply a confirmed phone or person ban

> As an authorized staff member, I want a confirmed ban to restrict every live membership and preserve evidence for safety review.

### Both ban scopes require authority on every app and a linked person

A phone ban requires at least one keyed phone hash. Check whether every selected phone is already banned. A person ban can proceed without a phone and checks for an existing person ban. A new decision that names a report checks that the requested runtime holds that report for the requested member before it records the ban. After admission the service records ban rows, suppresses the person's current phones and drops private appearance ratings.

```quint
pure def canStartStaffBan(flow: ServiceSafetyFlow): bool = flow.phase == ServiceSafetyStarting
pure def startStaffBan(flow: ServiceSafetyFlow, everywhere: bool, hasPerson: bool, phoneOnly: bool): ServiceSafetyFlow =
  { phoneOnly: phoneOnly,
    phase: if (not(everywhere)) BanNeedsCrossApp else if (not(hasPerson)) BanNoPerson else ReadingBanPhones }

pure def canReadStaffBanPhones(flow: ServiceSafetyFlow): bool = flow.phase == ReadingBanPhones
pure def readStaffBanPhones(flow: ServiceSafetyFlow, hasPhone: bool): ServiceSafetyFlow =
  { ...flow, phase: if (flow.phoneOnly and not(hasPhone)) BanNoPhone else ReadingExistingBan }

pure def canCheckExistingStaffBan(flow: ServiceSafetyFlow): bool = flow.phase == ReadingExistingBan
pure def checkExistingStaffBan(flow: ServiceSafetyFlow, alreadyBanned: bool, pendingProjection: bool): ServiceSafetyFlow =
  { ...flow, phase: if (alreadyBanned and pendingProjection) ResumingBanProjection
    else if (alreadyBanned) BanAlreadyExists else if (flow.phoneOnly) ApplyingPhoneBan else ApplyingPersonBan }

pure def sometimesAppliesPhoneBan(flow: ServiceSafetyFlow): bool = flow.phase == ApplyingPhoneBan
pure def sometimesAppliesPersonBan(flow: ServiceSafetyFlow): bool = flow.phase == ApplyingPersonBan
```

### A ban covers the reported number and the number current at the decision

Persist the recorded number and any different verified number of the same person under the lock used by a number move. Both records carry the same decision, reason and audit authority. Projection and any later retry cover both records. A move that acquires the lock after the ban must read the ban before writing a binding.

```quint
pure def includeLockedBanPhone(observedHash: str, currentHash: str): bool =
  observedHash != "" and currentHash != "" and currentHash != observedHash

pure def lawNoDuplicateLockedBanPhone(hash: str): bool = not(includeLockedBanPhone(hash, hash))
```

### An interrupted ban resumes from its saved authority

Record each ban once under the person write lock. The saved ban takes effect immediately. Keep the ban pending until phone suppression, rating cleanup, and all current app restrictions finish. An authorized retry uses the original decision and finishes pending work without writing another ban. The saved report ID goes only to the runtime that holds it for that member. The runtime records the hold and account restriction together. Record completion only after every runtime update commits. A later completed duplicate returns already banned.

```quint
pure def lawIncompleteRecordedBanCanResume(flow: ServiceSafetyFlow): bool =
  checkExistingStaffBan(flow, true, true).phase == ResumingBanProjection

pure def lawCompletedBanCannotResume(flow: ServiceSafetyFlow): bool =
  checkExistingStaffBan(flow, true, false).phase == BanAlreadyExists
```

### Live enrollment and ban projection use the current person

Check a live person, the authorized phone binding and the canonical ban when committing membership or Network enrollment. An enrollment already in progress can finish only if that check still allows it. Serialize these admission writes and ban recording for the same person. After the ban commits, restrict the current live memberships and discover their current runtime records. A matching snapshot treats a canonical ban as restricted even while runtime projection is pending.

```quint
pure def staffBanEnrollmentAllowed(liveOwner: bool, verifiedBinding: bool, banned: bool): bool =
  liveOwner and verifiedBinding and not(banned)

pure def staffBanSnapshotStatus(accountStatus: str, banned: bool): str =
  if (banned) "restricted" else accountStatus

pure def lawBannedEnrollmentCannotCommit(liveOwner: bool, verifiedBinding: bool): bool =
  not(staffBanEnrollmentAllowed(liveOwner, verifiedBinding, true))
```
