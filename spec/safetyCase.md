# Safety cases and report review

The Network stores one open case at a time for a member and records each report separately. This module makes the case and report transitions. The [standalone safety and trust model](models/safety_trust.md) covers the related trust scores, contact restrictions, and cross-app service actions. The shell owns case and report records, trust updates, staff logs, and notifications. The model receives no member messages, names, or staff notes.

## Story: Review a safety case without removing a hold by accident

> As a staff member, I want to record a decision on a case and control the hold separately.

### An event opens a case or adds to its current record

If a member has no open case, the next event opens one, except a trust decay event. An event after a lift reopens the case, except for the event that records the lift itself. A closed case stays closed. The shell starts a new case for a later event instead of changing the old record.

A decay event (see [trust levels](trustLevel.md)) never changes the phase. Clean time alone never opens a case and never reopens a lifted one. The shell adds a decay event to a live case and records nothing when the result has no case.

```quint
type CasePhase = NoCase | CaseOpen | CaseHeld | CaseLifted | CaseClosed
type SafetyCase = { phase: CasePhase }
pure val initial: SafetyCase = { phase: NoCase }

pure def canRecordCaseEvent(c: SafetyCase): bool = c.phase != CaseClosed

pure def recordCaseEvent(c: SafetyCase, liftEvent: bool, decayEvent: bool): SafetyCase =
  if (decayEvent) c
  else if (c.phase == NoCase or (c.phase == CaseLifted and not(liftEvent))) { phase: CaseOpen }
  else c

pure def lawDecayNeverOpensCase(liftEvent: bool): bool =
  recordCaseEvent(initial, liftEvent, true) == initial
```

### A recorded hold or lift updates the open case

A trust hold marks the case held. An authorized staff lift removes the trust hold, and the case records the lift. The lift depends on the trust hold, not on the case phase: a lift marks any live case lifted, also an open case that started after an earlier held case closed while the trust hold stayed. Closing the case leaves the trust decision unchanged.

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

## Story: Get immediate safety guidance in a member conversation

> As a member who says that I am in danger now, I want emergency guidance before any report confirmation or follow-up.

### Direct current-danger text gets immediate guidance first

Recognize a direct affirmative statement of current danger or an explicit request for emergency help now. Do not infer immediacy from a past event or an urgent report category alone. Inspect only the person’s own plain text, after carrier commands and existing identity admission. A copied profile or reaction cannot take this branch. Reply to the member without asking for contact details or opening a normal conversation. The reply starts with guidance to contact local emergency services. Use a fixed reply so a saved acknowledgement or other updates do not move ahead of it.

A report that named a subject still follows the same report and block decisions. A danger disclosure during a post-meeting check-in can record a report only with an exact current check-in receipt and explicit report language about the counterpart. It does not confirm attendance or consent to meet again. Otherwise, leave unrelated prompts unchanged and issue guidance alone. The Network does not dispatch emergency services.

```quint
pure def immediateDangerReply(directText: bool, currentDanger: bool): bool =
  directText and currentDanger

pure def lawEmergencyReplyRequiresOwnText(currentDanger: bool): bool =
  not(immediateDangerReply(false, currentDanger))

pure def lawEmergencyReplyRequiresCurrentDanger(directText: bool): bool =
  not(immediateDangerReply(directText, false))

pure def emergencyCheckInReport(exactReceipt: bool, attributedReport: bool): bool =
  exactReceipt and attributedReport

pure def lawEmergencyCheckInNeedsReceipt(attributedReport: bool): bool =
  not(emergencyCheckInReport(false, attributedReport))
```

## Story: Block or report a person directly

> As a member, I want a clearly requested block or report to reach the right person or ask me who I mean.

### Direct polite safety requests use the existing counterpart chooser

A direct request beginning with “can you” or “could you” can ask to block or report. For these forms, conditional, hypothetical and delayed wording cannot start the action. “My date” and “my match” refer to a counterpart under the existing target rules. Use the existing chooser for uncertainty, including confirmation for a report by reference after a past meeting.

```quint
pure def safetyRequestMayResolveTarget(directCommand: bool, conditionalOrDelayed: bool): bool =
  directCommand and not(conditionalOrDelayed)

pure def lawConditionalSafetyRequestCannotResolveTarget(directCommand: bool): bool =
  not(safetyRequestMayResolveTarget(directCommand, true))
```

### Report language distinguishes physical harm from casual contact

A direct affirmative statement that the counterpart choked the reporter is unsafe report evidence. Treat “hit me up” as a casual contact idiom. Disregard that idiom and denied evidence when classifying the report. The established counterpart and check-in receipt rules still apply.

```quint
pure def acceptsReportEvidence(affirmative: bool, casualContact: bool): bool =
  affirmative and not(casualContact)

pure def lawCasualContactDoesNotEstablishHarm(affirmative: bool): bool =
  not(acceptsReportEvidence(affirmative, true))

pure def lawDeniedEvidenceDoesNotEstablishHarm(casualContact: bool): bool =
  not(acceptsReportEvidence(false, casualContact))
```

### A minor report needs affirmative attributable evidence

Use the same age reading for a direct report and a post-meeting check-in.
A direct statement about a person can use digits, a spelled age, or a
compound form such as “16-year-old.” “My date was sixteen” can open the
same review as “he's sixteen.” Ignore times, prices, ages of relatives
or objects, questions, and qualified or quoted statements. A statement
that the member reports about a counterpart can place a safety hold in
the existing app and does not overwrite that person's stated age.

```quint
pure def acceptsMinorReportEvidence(eligibleSubject: bool, minorAgeSignal: bool, affirmative: bool): bool =
  eligibleSubject and minorAgeSignal and affirmative

pure def lawMinorReportNeedsAffirmation(eligibleSubject: bool, minorAgeSignal: bool): bool =
  not(acceptsMinorReportEvidence(eligibleSubject, minorAgeSignal, false))

pure def lawMinorReportNeedsAnEligibleSubject(minorAgeSignal: bool, affirmative: bool): bool =
  not(acceptsMinorReportEvidence(false, minorAgeSignal, affirmative))
```

## Story: Resolve a report with its own disposition

> As a staff member, I want a report to show whether it is open, dismissed, held, or banned.

### A hold, ban, or dismissal updates the matching report

An open report can be dismissed or marked held. A hold updates the named report, or every open report for the member when no report is named. A ban updates the member's open and held reports. A dismissed report stays dismissed. Until staff decide, an open urgent report from a reporter who met the member restricts that member's matching. A held, banned or dismissed report does not restrict matching through this rule.

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

pure def lawDecidedReportDoesNotRestrictMatching(decision: ReportDecision, metBefore: bool, urgent: bool): bool =
  not(reportRestrictsMatching(reportAfterDecision(ReportOpen, decision, true, true), metBefore, urgent))

pure def lawDismissedReportStaysDismissed(decision: ReportDecision, sameMember: bool, reportMatches: bool): bool =
  reportAfterDecision(ReportDismissed, decision, sameMember, reportMatches) == ReportDismissed
```

### The exact open report follows its subject through ordinary app leave

An open, urgent report from a member who met the subject continues to restrict matching in the originating app after ordinary leave. At the forget transaction, an open minor report also carries if the member has an active age signal from a report. This applies when the reporter has not met the subject and when the report arrives after leave starts. The member's own stated age uses the person-level age policy. The shell records only the app, originating runtime, exact report ID, and verified canonical subject. Its review remains with that runtime. The shell erases the association on account erasure or phone reassignment. A generic lift and closing a case leave this report open. Exact dismissal removes only its own restriction. An authorized hold of an archived report records the durable staff hold and marks the exact report held in the same transaction. A ban still requires the existing verified person and staff authority.

```quint
pure def carryReportOnAppLeave(ordinaryLeave: bool, reportPhase: ReportPhase, metBefore: bool, urgent: bool, reportedMinor: bool): bool =
  ordinaryLeave and (reportRestrictsMatching(reportPhase, metBefore, urgent) or (reportPhase == ReportOpen and reportedMinor))

pure def archivedReportHoldAllowed(exactSubject: bool, matchingRestriction: bool): bool =
  exactSubject and matchingRestriction

pure def lawOnlyOpenReportsCarry(ordinaryLeave: bool, reportPhase: ReportPhase, metBefore: bool, urgent: bool, reportedMinor: bool): bool =
  carryReportOnAppLeave(ordinaryLeave, reportPhase, metBefore, urgent, reportedMinor) implies reportPhase == ReportOpen

pure def lawReportedMinorSignalSurvivesOrdinaryLeave(urgent: bool): bool =
  carryReportOnAppLeave(true, ReportOpen, false, urgent, true)

pure def lawAccountErasureCarriesNoReport(reportPhase: ReportPhase, metBefore: bool, urgent: bool, reportedMinor: bool): bool =
  not(carryReportOnAppLeave(false, reportPhase, metBefore, urgent, reportedMinor))

pure def lawArchivedHoldRequiresExactSubject(matchingRestriction: bool): bool =
  not(archivedReportHoldAllowed(false, matchingRestriction))
```

### A unique offered report name routes back to its app

An explicit app choice or dedicated line sets the app. The shared-line fallback can use a current report question to route the verified member's own signed text. The text must name exactly one counterpart shown in the stored question across the member's app memberships. The counterpart must still belong to that question and be a current counterpart. The reply must arrive at or after the question and no later than processing, within one day of the question. Apply the report in the question's app only if the same member and choice remain current at the write. With no matching question, use the ordinary routing rules. With several matching questions, preserve them for an explicit app choice.

```quint
type SharedReportRoute = NoReportRoute | UniqueReportRoute | AmbiguousReportRoute

pure def sharedReportRoute(signedMember: bool, choices: int): SharedReportRoute =
  if (not(signedMember) or choices <= 0) NoReportRoute
  else if (choices == 1) UniqueReportRoute
  else AmbiguousReportRoute

pure def reportClarificationTimeCurrent(askedAt: int, receivedAt: int, asOf: int, oldestPrompt: int): bool =
  oldestPrompt <= askedAt and askedAt <= receivedAt and receivedAt <= asOf

pure def lawSharedReportRequiresOneChoice(signedMember: bool, choices: int): bool =
  sharedReportRoute(signedMember, choices) == UniqueReportRoute implies signedMember and choices == 1

pure def lawReportReplyCannotPredateQuestion(askedAt: int, receivedAt: int, asOf: int, oldestPrompt: int): bool =
  reportClarificationTimeCurrent(askedAt, receivedAt, asOf, oldestPrompt) implies receivedAt >= askedAt
```

### An unrelated reply keeps a current safety question

This rule applies when the reply reaches the app that holds the safety question. A signed reply can answer or close it only if the gateway received the reply at or after the question opened and at or before the current time. An exact allowed name answers the question, even when another prompt is open. A bare confirmation can supply the target only when no other prompt is waiting. Any pending reply slot, including a meeting feedback prompt, counts as another prompt.

An explicit cancellation ends the question. If the question offered one person, an opening clause that explicitly rejects that person's name also ends it without filing. The complete opening statement "it was someone else" or "it was somebody else" does the same even when another prompt is waiting. A question, a qualified guess, or an incidental statement about someone else supplies no exclusion. Without a competing prompt, a direct unnamed rejection such as "not him" can end the question in the same way. A competing prompt can still handle the reply after cancellation or exclusion. If the opening sentence says it was someone else, that sentence and its leading "no" or "nope" answer only the safety question. Pass any separate reply after that sentence to the competing prompt.

Read a bare confirmation, refusal, or cancellation as a control reply, even when the words match a member's name. A control reply cannot select an exact name on the current app or on another app. A member can give a full name or use "I mean" to name someone in the current app when their displayed name matches a control reply.

When the reply supplies no allowed target, cancellation, or exclusion, a competing prompt keeps the safety question open. A bare yes or no can answer that prompt. Without another prompt, a short unresolved reply ends the question. A longer unrelated reply keeps it available through the one-day reply window. After that window, the stored question cannot intercept a reply or delay an invitation survey.

```quint
pure def safetyQuestionIsCurrent(askedAt: int, oldestQuestion: int): bool = askedAt >= oldestQuestion

pure def lawExpiredSafetyQuestionCannotAct(askedAt: int, oldestQuestion: int): bool =
  askedAt < oldestQuestion implies not(safetyQuestionIsCurrent(askedAt, oldestQuestion))

pure def safetyQuestionAcceptsName(confirmation: bool, refusal: bool, cancellation: bool): bool =
  not(confirmation or refusal or cancellation)

pure def lawSafetyControlCannotNameTarget(confirmation: bool, refusal: bool, cancellation: bool): bool =
  (confirmation or refusal or cancellation) implies not(safetyQuestionAcceptsName(confirmation, refusal, cancellation))

pure def safetyQuestionAppliesTarget(allowedTarget: bool, excludesTarget: bool): bool =
  allowedTarget and not(excludesTarget)

pure def safetyQuestionExclusion(explicitExclusion: bool, ambiguousExclusion: bool, competingPrompt: bool): bool =
  explicitExclusion or (ambiguousExclusion and not(competingPrompt))

pure def lawCompetingPromptNeedsExplicitSafetyExclusion(ambiguousExclusion: bool): bool =
  not(safetyQuestionExclusion(false, ambiguousExclusion, true))

pure def lawExplicitSafetyExclusionStillApplies(ambiguousExclusion: bool, competingPrompt: bool): bool =
  safetyQuestionExclusion(true, ambiguousExclusion, competingPrompt)

pure def safetyReplyAfterExclusion(competingPrompt: bool, replacementSentence: bool, reply: str, separateReply: str): str =
  if (not(competingPrompt)) "" else if (replacementSentence) separateReply else reply

pure def lawSafetyReplacementSendsOnlySeparateReply(competingPrompt: bool, reply: str, separateReply: str): bool =
  safetyReplyAfterExclusion(competingPrompt, true, reply, separateReply) == (if (competingPrompt) separateReply else "")

pure def lawSafetyReplacementAloneDoesNotAnswerAnotherPrompt(competingPrompt: bool, reply: str): bool =
  safetyReplyAfterExclusion(competingPrompt, true, reply, "") == ""

pure def safetyQuestionResolves(allowedTarget: bool, competingPrompt: bool, cancels: bool, excludesTarget: bool, shortReply: bool): bool =
  safetyQuestionAppliesTarget(allowedTarget, excludesTarget) or cancels or excludesTarget or (not(competingPrompt) and shortReply)

pure def lawCompetingPromptKeepsUnresolvedSafety(shortReply: bool): bool =
  not(safetyQuestionResolves(false, true, false, false, shortReply))

pure def lawCancellationResolvesSafety(competingPrompt: bool, shortReply: bool): bool =
  safetyQuestionResolves(false, competingPrompt, true, false, shortReply)

pure def lawAllowedTargetResolvesSafety(competingPrompt: bool, cancels: bool, shortReply: bool): bool =
  safetyQuestionResolves(true, competingPrompt, cancels, false, shortReply)

pure def lawTargetExclusionClosesWithoutFiling(allowedTarget: bool, competingPrompt: bool, shortReply: bool): bool =
  safetyQuestionResolves(allowedTarget, competingPrompt, false, true, shortReply) and
    not(safetyQuestionAppliesTarget(allowedTarget, true))

pure def lawLongUnrelatedReplyKeepsSafety(competingPrompt: bool): bool =
  not(safetyQuestionResolves(false, competingPrompt, false, false, false))
```

### A complete name or confirmation identifies one safety target

A fixed affirmative prefix or courtesy suffix can accompany the full name. If the literal and qualified readings identify different people, the answer is ambiguous.

A bare affirmative or a complete positive expression such as "him" or "that's her" can use the sole person offered only when no other prompt is waiting. A pronoun followed by another suggestion, a refusal, or a question cannot select the offered person.

Shared-line routing requires a unique exact displayed name across the active app questions. An unnamed confirmation cannot choose the app.

```quint
pure def safetyQuestionUsesSoleOffer(soleOffer: bool, competingPrompt: bool, exactConfirmation: bool, hasNamedMatch: bool): bool =
  soleOffer and not(competingPrompt) and exactConfirmation and not(hasNamedMatch)

pure def lawCompetingPromptCannotUseSoleSafetyOffer(soleOffer: bool, exactConfirmation: bool, hasNamedMatch: bool): bool =
  not(safetyQuestionUsesSoleOffer(soleOffer, true, exactConfirmation, hasNamedMatch))

pure def lawSoleSafetyOfferRequiresExactConfirmation(soleOffer: bool, competingPrompt: bool, hasNamedMatch: bool): bool =
  not(safetyQuestionUsesSoleOffer(soleOffer, competingPrompt, false, hasNamedMatch))

pure def lawNamedSafetyAnswerCannotUseSoleOffer(soleOffer: bool, competingPrompt: bool, exactConfirmation: bool): bool =
  not(safetyQuestionUsesSoleOffer(soleOffer, competingPrompt, exactConfirmation, true))
```

### A ban allows only carrier commands and app leave

A banned person cannot start or continue ordinary work on the text line. An ordinary text, a reaction, or a photo does not count as engagement and opens no flow. STOP and HELP still work. The person can leave an app that they are a member of. The shell records the ban, revokes the person's profile-share grants, and deletes the phone's pending text flows in one database transaction. A share request takes the same lock and reads the ban first, so a share cannot complete after the ban.

```quint
pure def inboundAllowedAfterBan(banned: bool, compliance: bool): bool = not(banned) or compliance

pure def lawBanBlocksOrdinaryInbound(compliance: bool): bool =
  inboundAllowedAfterBan(true, compliance) == compliance
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
