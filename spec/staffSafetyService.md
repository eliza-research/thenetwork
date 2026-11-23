# Apply staff safety decisions in the service

The [case and report spec](safetyCase.md) governs decisions inside one Network runtime. This module governs the service's targets, action admission, and audit stages. The service resolves staff authority and owned records, writes audits, and calls one runtime at a time. When a member has no linked person, the service's discovery returns only the requested member, so that member is the only target. The service writes the request audit before it runs an admitted action; when that write fails, the action does not run. The hold decision runs inside the audited action. The ban admission runs before the request audit, and the ban rows are written inside the audited action. The requested member's runtime checks, under the case and report spec, that the member and any supplied report match.

## Story: Hold a member without exposing their other memberships

> As a staff member, I want a hold to reach the runtimes I am authorized to act on, with an audit of the decision.

### Staff act within their resolved scope

Staff with safety authority on every app may act on the person's relevant memberships. An app-scoped action only includes the requested runtime. Discovery skips invited and removed memberships. The requested member remains the fallback target when there is no linked person. The hold audit records the authorized scope without recording a membership count. The hold and the minor-signal clear answer the staff member with their reach: `all` when the staff member has authority on every app and the member has a linked person, otherwise `app`. The reach comes from the staff member's authority, so it never tells how many apps the person uses. Changed (audit SD-070): the service returned no reach -> it answers with its reach, because the console said "on every app" also when it acted on one app only.

```quint
pure def staffSafetyMembershipLive(membership: str): bool =
  membership != "removed" and membership != "invited"

pure def staffSafetySelectsTarget(everywhere: bool, requestedRuntime: bool): bool =
  everywhere or requestedRuntime

pure def staffSafetyAuditScope(targets: int): str = if (targets > 1) "every_app" else "this_app"

pure def staffSafetyActionReach(allAppsAuthority: bool, linkedPerson: bool): str =
  if (allAppsAuthority and linkedPerson) "all" else "app"

pure def lawAppStaffReachOneApp(linkedPerson: bool): bool =
  staffSafetyActionReach(false, linkedPerson) == "app"

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

An ordinary leave removes the app membership and personal data while retaining the scoped restriction. The person can join again and receive permitted replies and safety notices. The matching snapshot and final contact claims check the current app's restriction even if its runtime projection is pending. Whole-account erasure keeps the hold record, as it keeps a ban and the person's tombstone, so a later join by the same number revives the person with the hold. Only the staff release of a held number to a new holder removes it. Changed (audit SIG70): erasure removed the hold -> the hold stays, because a held person who erased the account and joined again was matched without staff review of the hold.

```quint
pure def durableStaffHoldScope(allAppsAuthority: bool, currentApp: str): str =
  if (allAppsAuthority) "*" else currentApp

pure def durableStaffHoldCoversApp(localHold: bool, globalHold: bool, appReleased: bool): bool =
  localHold or (globalHold and not(appReleased))

pure def durableStaffHoldLiftAllowed(globallyCovered: bool, allAppsAuthority: bool): bool =
  not(globallyCovered) or allAppsAuthority

pure def durableStaffHoldSnapshotStatus(accountStatus: str, staffHeld: bool): str =
  if (staffHeld) "restricted" else accountStatus

pure def erasureKeepsStaffHold(releasedToNewHolder: bool): bool = not(releasedToNewHolder)

pure def lawErasedThenRejoinedNumberStaysHeld(accountStatus: str): bool =
  durableStaffHoldSnapshotStatus(accountStatus, erasureKeepsStaffHold(false)) == "restricted"

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

The audit stages are a run of their own, apart from the hold and ban runs. The action runs only after the request audit is recorded. An action that returns gets a subsequent result audit, and only after the action. Preserve the existing best-effort handling for a result-audit failure. Changed (audit OPS27): the leak-review release and drop and the inbound turn release acted before their only audit row, and the phone-hold decision wrote no result row -> they follow this run too, because a step without its audit rows could not be traced.

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

Record each ban once under the person write lock. The saved ban takes effect immediately. Keep the ban pending until phone suppression, rating cleanup, all current app restrictions, and the deletion of the connector signup drafts of every banned number in every app finish. The draft deletion runs after the runtime updates and before completion, so a failed deletion leaves the ban pending for the retry. Changed 2026-11-22 (owner decision of 2026-11-22, carry-over of the connector review): the code already deleted the drafts before it recorded completion, but this list did not name that step, so the rule and the code did not agree. An authorized retry uses the original decision and finishes pending work without writing another ban. The saved report ID goes only to the runtime that holds it for that member. The runtime records the hold and account restriction together. Record completion only after every runtime update commits. A later completed duplicate returns already banned.

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

## Story: Route an agent signal to an accountable decision

> As a member who tells the shared agent about a safety problem, or that I want no more introductions, I want that signal to reach a person or to take effect, and never to wait unread. When it pauses my matching, I want to be told once what was paused and how to undo it.

### An agent signal goes to the decision that owns it

The shared agent sends a signal only inside the member's own open turn, and the service checks that turn and the member's active membership first. A safety concern opens or joins that member's safety case with the reason code `agent_safety_concern` and no evidence text, and it waits for safety staff. An opt-out pauses matching in that app only, with the same setting that the member's "pause matching" command writes. It does not change carrier consent: only STOP on the shared line does that, and the signal response has no consent fence for the gateway. A travel signal stays private context. When the work for a safety concern fails, its receipt stays unresolved and the service raises an operations alert that names the app and the member, so a person looks at it. Changed (audits COV05 and SIG-unresolved-concern): safety concerns and opt-outs were stored as proposals that nobody decided, and a failed concern raised no alert -> a concern opens a safety case, an opt-out pauses matching, and a failed concern raises an alert, because the signals changed nothing and never reached safety staff.

```quint
import participationControls as Controls from "./participationControls"

type AgentSignalRoute = SignalOpensSafetyCase | SignalPausesApp | SignalKeptAsContext

pure def agentSignalRoute(kind: str): AgentSignalRoute =
  if (kind == "safety_concern") SignalOpensSafetyCase
  else if (kind == "opt_out") SignalPausesApp
  else SignalKeptAsContext

pure def agentSignalWaitsForStaff(kind: str): bool = agentSignalRoute(kind) == SignalOpensSafetyCase

pure def agentOptOutParticipation(kind: str, saved: str): str =
  if (agentSignalRoute(kind) == SignalPausesApp) Controls::participationControlState(true) else saved

pure def lawAgentSafetyConcernReachesStaff(kind: str): bool =
  kind == "safety_concern" implies agentSignalWaitsForStaff(kind)

pure def lawAgentOptOutPausesOnlyMatching(saved: str): bool =
  agentOptOutParticipation("opt_out", saved) == "paused" and not(agentSignalWaitsForStaff("opt_out"))

pure def lawOtherSignalsLeaveParticipation(kind: str, saved: str): bool =
  kind != "opt_out" implies agentOptOutParticipation(kind, saved) == saved
```

### An applied agent pause gives the member one confirmation

When an opt-out signal changes the saved setting of the member to paused, the service gives the member exactly one confirmation. The confirmation says that matching is paused in that app, and that the member can say ‘resume matching’ to undo the pause. A signal that changes nothing, because matching is already paused, gives no confirmation. A retry of the same signal replays its stored receipt and does not run again. The service makes the decision in the transaction that holds the lock on the member row and writes the pause, the confirmation and the receipt, so two replicas cannot both confirm one pause. The text confirmation is a reply to the action of the member in their own open turn through the shared agent. It is not proactive outreach, so it does not use a slot of the daily cap of three proactive messages: that cap counts proactive messages only. The outbound queue still applies the reply window, the consent ledger, the opt-out of the member and the leak guard to the text at send time. When the texts of the member are off (the consent ledger of their number or their member row says opted out), the service does not text the confirmation. It adds an inbox update. The agent of the member reads that update through the connector, and the updates read of the shared line shows it after the member sends START. The connector and the updates read apply the output leak gate to it. The inbox update is a requested item, so after the member sends START the notify digest can text it if their agent did not read it first. Thus its words stay true before START, after START and after the member resumes: it says that matching on that app was paused as the member asked, that the member can text ‘resume matching’ on the line of that app to undo it, and that a member who turned texts off replies START first. Other signal kinds give no confirmation. A STOP that commits after the pause stops the queued text at send time: the member then gets no confirmation, and is not texted after STOP. Changed (owner decision 2026-11-22, D7): an agent opt-out paused matching silently -> the member gets one confirmation with the undo, by text or as an inbox update whose words stay true after START, because the member did not know that the pause took effect or how to undo it.

```quint
type AgentPauseConfirmation = PauseConfirmedByReplyText | PauseConfirmedInInbox | PauseNotConfirmed

pure def agentPauseConfirmation(kind: str, pauseApplied: bool, textsOff: bool): AgentPauseConfirmation =
  if (agentSignalRoute(kind) != SignalPausesApp or not(pauseApplied)) PauseNotConfirmed
  else if (textsOff) PauseConfirmedInInbox
  else PauseConfirmedByReplyText

pure val kindValues = Set("opt_out", "travel", "safety_concern", "pause")
pure val pauseAppliedValues = Set(true, false)
pure val textsOffValues = Set(true, false)

pure def lawAppliedPauseGetsOneConfirmation(textsOff: bool): bool =
  agentPauseConfirmation("opt_out", true, textsOff) != PauseNotConfirmed

pure def lawUnchangedPauseGetsNoConfirmation(kind: str, textsOff: bool): bool =
  agentPauseConfirmation(kind, false, textsOff) == PauseNotConfirmed

pure def lawOptedOutMemberIsNeverTexted(kind: str, pauseApplied: bool): bool =
  agentPauseConfirmation(kind, pauseApplied, true) != PauseConfirmedByReplyText

pure def lawTextsOnGetTheReplyText(pauseApplied: bool): bool =
  pauseApplied implies agentPauseConfirmation("opt_out", pauseApplied, false) == PauseConfirmedByReplyText

pure def lawOnlyAPauseIsConfirmed(kind: str, pauseApplied: bool, textsOff: bool): bool =
  agentSignalRoute(kind) != SignalPausesApp implies agentPauseConfirmation(kind, pauseApplied, textsOff) == PauseNotConfirmed
```

### Safety staff decide a waiting agent signal once

A signal that waits for staff is listed for reviewer and safety staff in that app. Only a safety staff member in that app can decide it, with a reason, and the service writes the request audit before the decision. The decision marks the signal reviewed or dismissed. A decided signal keeps its decision. The member's safety case stays open until staff use the existing hold, lift or close actions. The operations alert counts only waiting signals. Only a safety concern waits: an opt-out takes effect when it arrives. A migration applied the pause of each opt-out signal that an older version stored as waiting, unless the member changed the setting after it, and marked those signals reviewed. The service refuses a staff member without the safety role before it reads the signal, and gives the same role answer to the decision. The evidence of a member who is under 18 or whose age is in doubt is shown only to safety staff, who decide the concern; reviewer staff see that the signal exists and that its evidence is withheld. Changed (audits COV05, signals-r19-1, signals-r19-2 and signals-r19-4): no staff action resolved a signal, old opt-outs stayed waiting unapplied, the decision had a constant role answer, and every reviewer read a minor's evidence -> safety staff decide a waiting concern, the migration applied the old pauses, the role check is real, and a minor's evidence is for safety staff only, because the alert could not clear and a minor's words reached more staff than needed.

```quint
type AgentSignalPhase = SignalWaiting | SignalReviewed | SignalDismissed

pure def agentSignalDecisionAllowed(safetyRole: bool, phase: AgentSignalPhase): bool =
  safetyRole and phase == SignalWaiting

pure def agentSignalAfterDecision(phase: AgentSignalPhase, safetyRole: bool, dismiss: bool): AgentSignalPhase =
  if (agentSignalDecisionAllowed(safetyRole, phase)) { if (dismiss) SignalDismissed else SignalReviewed } else phase

pure def lawDecidedAgentSignalStaysDecided(phase: AgentSignalPhase, safetyRole: bool, dismiss: bool): bool =
  phase != SignalWaiting implies agentSignalAfterDecision(phase, safetyRole, dismiss) == phase

pure def lawOnlySafetyStaffDecideAgentSignals(phase: AgentSignalPhase, dismiss: bool): bool =
  agentSignalAfterDecision(phase, false, dismiss) == phase

pure def agentSignalEvidenceShown(safetyRole: bool, ageInDoubt: bool): bool =
  safetyRole or not(ageInDoubt)

pure def lawReviewerNeverReadsMinorEvidence(ageInDoubt: bool): bool =
  ageInDoubt implies not(agentSignalEvidenceShown(false, ageInDoubt))

pure def lawAdultEvidenceShownToReviewers(safetyRole: bool): bool =
  agentSignalEvidenceShown(safetyRole, false)
```
