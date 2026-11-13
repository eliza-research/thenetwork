# Safety cases and report review

The Network stores one open case at a time for a member and records each report separately. This module makes the case and report transitions. The [standalone safety and trust model](models/safety_trust.md) covers the related trust scores, contact restrictions, and cross-app service actions. The shell owns case and report records, trust updates, staff logs, and notifications. The model receives no member messages, names, or staff notes.

## Story: Review a safety case without removing a hold by accident

> As a staff member, I want to record a decision on a case and control the hold separately.

### An event opens a case or adds to its current record

If a member has no open case, the next event opens one. An event after a lift reopens the case, except for the event that records the lift itself. A closed case stays closed. The shell starts a new case for a later event instead of changing the old record.

```quint
type CasePhase = NoCase | CaseOpen | CaseHeld | CaseLifted | CaseClosed
type SafetyCase = { phase: CasePhase }
pure val initial: SafetyCase = { phase: NoCase }

pure def canRecordCaseEvent(c: SafetyCase): bool = c.phase != CaseClosed

pure def recordCaseEvent(c: SafetyCase, liftEvent: bool): SafetyCase =
  if (c.phase == NoCase or (c.phase == CaseLifted and not(liftEvent))) { phase: CaseOpen } else c
```

### A recorded hold or lift updates the open case

A trust hold marks the case held. An authorized staff lift removes the trust hold, and the case records the lift. Closing the case leaves the trust decision unchanged.

```quint
pure def liveCase(c: SafetyCase): bool = c.phase != NoCase and c.phase != CaseClosed

pure def canMarkCaseHeld(c: SafetyCase): bool = liveCase(c)
pure def markCaseHeld(c: SafetyCase): SafetyCase = { phase: CaseHeld }

pure def canMarkCaseLifted(c: SafetyCase): bool = liveCase(c)
pure def markCaseLifted(c: SafetyCase): SafetyCase = { phase: CaseLifted }

pure def canCloseCase(c: SafetyCase): bool = liveCase(c)
pure def closeCase(c: SafetyCase): SafetyCase = { phase: CaseClosed }

pure def stepClosedCaseStaysClosed(before: SafetyCase, after: SafetyCase): bool =
  before.phase == CaseClosed implies after.phase == CaseClosed

pure def sometimesCaseCloses(c: SafetyCase): bool = c.phase == CaseClosed
pure def sometimesCaseWasLifted(c: SafetyCase): bool = c.phase == CaseLifted
```

### A staff action requires an actor and an applicable record

An actor is required. Lifting a hold requires an existing trust hold. Closing a case requires a case that is still live. If a hold names a report, that report must belong to the member. The member must be known or have a report on file.

```quint
type StaffActionResult = AllowedAction | ActorRequired | NotOnHold | UnknownCase | AlreadyClosed | UnknownReport | UnknownMember | NoMinorSignal | AgeUnknown | RecordMinor | StatedMinor

pure def holdLiftResult(actorPresent: bool, currentlyHeld: bool): StaffActionResult =
  if (not(actorPresent)) ActorRequired else if (currentlyHeld) AllowedAction else NotOnHold

pure def caseCloseResult(actorPresent: bool, casePhase: CasePhase): StaffActionResult =
  if (not(actorPresent)) ActorRequired
  else if (casePhase == NoCase) UnknownCase
  else if (casePhase == CaseClosed) AlreadyClosed
  else AllowedAction

pure def holdAuthority(actorPresent: bool, reportMatches: bool): StaffActionResult =
  if (not(actorPresent)) ActorRequired
  else if (not(reportMatches)) UnknownReport
  else AllowedAction

pure def holdSubjectKnown(knownMember: bool, reportOnFile: bool): bool = knownMember or reportOnFile
```

## Story: Resolve a report with its own disposition

> As a staff member, I want a report to show whether it is open, dismissed, held, or banned.

### A hold, ban, or dismissal updates the matching report

An open report can be dismissed or marked held. A hold updates the named report, or every open report for the member when no report is named. A ban updates the member's open and held reports. A dismissed report stays dismissed.

```quint
type ReportPhase = ReportOpen | ReportHeld | ReportBanned | ReportDismissed
type ReportDecision = HoldReport | BanReport | DismissReport

pure def reportAfterDecision(reportPhase: ReportPhase, decision: ReportDecision, sameMember: bool, reportMatches: bool): ReportPhase =
  if (not(sameMember)) reportPhase
  else if (decision == BanReport and (reportPhase == ReportOpen or reportPhase == ReportHeld)) ReportBanned
  else if (reportMatches and reportPhase == ReportOpen) {
    if (decision == HoldReport) ReportHeld else if (decision == DismissReport) ReportDismissed else reportPhase
  } else reportPhase

pure def reportRestrictsMatching(reportPhase: ReportPhase, metBefore: bool, urgent: bool): bool =
  reportPhase == ReportOpen and metBefore and urgent

pure def lawDismissedReportStaysDismissed(decision: ReportDecision, sameMember: bool, reportMatches: bool): bool =
  reportAfterDecision(ReportDismissed, decision, sameMember, reportMatches) == ReportDismissed
```

## Story: Clear a mistaken minor signal after checking ages

> As a staff member, I want to clear a false signal only when the record confirms an adult and the member never stated a lower age.

### A clear requires a known adult record and no stated minor age

The member and signal must exist. The recorded age must be known and adult. A stated age below 18 prevents the clearance, even when the recorded age is adult.

```quint
pure def minorClearResult(actorPresent: bool, memberKnown: bool, hasSignal: bool, ageKnown: bool,
    recordMinor: bool, statedMinor: bool): StaffActionResult =
  if (not(actorPresent)) ActorRequired
  else if (not(memberKnown)) UnknownMember
  else if (not(hasSignal)) NoMinorSignal
  else if (not(ageKnown)) AgeUnknown
  else if (recordMinor) RecordMinor
  else if (statedMinor) StatedMinor
  else AllowedAction
```
