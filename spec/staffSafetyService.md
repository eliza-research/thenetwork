# Apply staff safety decisions in the service

The [case and report spec](safetyCase.md) governs decisions inside one Network runtime. This module governs the service's targets, action admission, and audit stages. The service resolves staff authority and owned records, writes audits, and calls one runtime at a time. When a member has no linked person, the service's discovery returns only the requested member, so that member is the only target. The service writes the request audit before it runs an admitted action; when that write fails, the action does not run. The hold decision runs inside the audited action. The ban admission runs before the request audit, and the ban rows are written inside the audited action. The requested member's runtime checks, under the case and report spec, that the member and any supplied report match.

## Story: Hold a member without exposing their other memberships

> As a staff member, I want a hold to reach the runtimes I am authorized to act on, with an audit of the decision.

### Staff act within their resolved scope

Staff with safety authority on every app may act on the person's relevant memberships. An app-scoped action only includes the requested runtime. Discovery skips invited and removed memberships. The audit records whether the action covers one runtime or more than one without recording a membership count.

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

Apply holds on the remaining selected targets only if the primary hold succeeds. The supplied report ID goes only to the requested member's runtime: every other target gets no report ID, for a hold and for a ban.

```quint
type ServiceSafetyPhase =
  ServiceSafetyStarting | HoldRemainingTargets | HoldDidNotApply | BanNeedsCrossApp | BanNoPerson |
  ReadingBanPhones | BanNoPhone | ReadingExistingBan | BanAlreadyExists | ApplyingPhoneBan | ApplyingPersonBan |
  PerformingAuditedAction | RecordingAuditResult
type ServiceSafetyFlow = { phase: ServiceSafetyPhase, phoneOnly: bool }
pure val initial: ServiceSafetyFlow = { phase: ServiceSafetyStarting, phoneOnly: false }

pure def canReadPrimaryHold(flow: ServiceSafetyFlow): bool = flow.phase == ServiceSafetyStarting
pure def readPrimaryHold(flow: ServiceSafetyFlow, applied: bool): ServiceSafetyFlow =
  { ...flow, phase: if (applied) HoldRemainingTargets else HoldDidNotApply }

pure def staffSafetyReportFor(isRequested: bool, reportId: str): str = if (isRequested) reportId else ""

pure def lawOtherTargetsGetNoReport(reportId: str): bool = staffSafetyReportFor(false, reportId) == ""

pure def sometimesCanHoldRelatedTargets(flow: ServiceSafetyFlow): bool = flow.phase == HoldRemainingTargets
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

A phone ban requires at least one keyed phone hash. Check whether every selected phone is already banned. A person ban can proceed without a phone and checks for an existing person ban. An already-applied ban is refused. After admission the service records ban rows, suppresses the person's current phones, drops private appearance ratings, and restricts live memberships in its existing order.

```quint
pure def canStartStaffBan(flow: ServiceSafetyFlow): bool = flow.phase == ServiceSafetyStarting
pure def startStaffBan(flow: ServiceSafetyFlow, everywhere: bool, hasPerson: bool, phoneOnly: bool): ServiceSafetyFlow =
  { phoneOnly: phoneOnly,
    phase: if (not(everywhere)) BanNeedsCrossApp else if (not(hasPerson)) BanNoPerson else ReadingBanPhones }

pure def canReadStaffBanPhones(flow: ServiceSafetyFlow): bool = flow.phase == ReadingBanPhones
pure def readStaffBanPhones(flow: ServiceSafetyFlow, hasPhone: bool): ServiceSafetyFlow =
  { ...flow, phase: if (flow.phoneOnly and not(hasPhone)) BanNoPhone else ReadingExistingBan }

pure def canCheckExistingStaffBan(flow: ServiceSafetyFlow): bool = flow.phase == ReadingExistingBan
pure def checkExistingStaffBan(flow: ServiceSafetyFlow, alreadyBanned: bool): ServiceSafetyFlow =
  { ...flow, phase: if (alreadyBanned) BanAlreadyExists else if (flow.phoneOnly) ApplyingPhoneBan else ApplyingPersonBan }

pure def sometimesAppliesPhoneBan(flow: ServiceSafetyFlow): bool = flow.phase == ApplyingPhoneBan
pure def sometimesAppliesPersonBan(flow: ServiceSafetyFlow): bool = flow.phase == ApplyingPersonBan
```
