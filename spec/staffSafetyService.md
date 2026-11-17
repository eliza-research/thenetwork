# Apply staff safety decisions in the service

The [case and report spec](safetyCase.md) governs decisions inside one Network runtime. This module governs the service's targets, action admission, and audit stages. The service resolves staff authority and owned records, writes audits, and calls one runtime at a time.

## Story: Hold a member without exposing their other memberships

> As a staff member, I want a hold to reach the runtimes I am authorized to act on, with an audit of the decision.

### Staff act within their resolved scope

Staff with safety authority on every app may act on the person's relevant memberships. An app-scoped action only includes the requested runtime. Discovery skips invited and removed memberships. The requested member remains the fallback target when there is no linked person. The audit records whether the action covers one runtime or more than one without recording a membership count.

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

The runtime checks that the member and any supplied report match. Apply holds on the remaining selected targets only if the primary hold succeeds. The supplied report ID goes only to the requested member's runtime.

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

pure def sometimesCanHoldRelatedTargets(flow: ServiceSafetyFlow): bool = flow.phase == HoldRemainingTargets
```

### Keep the requested and result audits in order

Persist the request audit before performing an admitted cross-runtime safety action. If the requested audit fails, the caller cannot proceed. An action that returns gets a subsequent result audit. Preserve the existing best-effort handling for a result-audit failure.

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

A phone ban requires at least one keyed phone hash. Check whether every selected phone is already banned. A person ban can proceed without a phone and checks for an existing person ban. After admission the service records ban rows, suppresses the person's current phones and drops private appearance ratings.

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

### An interrupted ban resumes from its saved authority

Record each ban once under the person write lock. The saved ban takes effect immediately. Keep the ban pending until phone suppression, rating cleanup, and all current app restrictions finish. An authorized retry uses the original decision and finishes pending work without writing another ban. The runtime records the hold and account restriction together. Record completion only after every runtime update commits. A later completed duplicate returns already banned.

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
