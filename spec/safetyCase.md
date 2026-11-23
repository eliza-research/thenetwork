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
  | TeenBarred | TeenOlderReported

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

An open, urgent report from a member who met the subject continues to restrict matching in the originating app after ordinary leave. When the runtime forgets the member, the shell records only the app, originating runtime, exact report ID, and verified canonical subject. Its review remains with that runtime. The shell erases the association on account erasure or phone reassignment. A generic lift and closing a case leave this report open. Exact dismissal removes only its own restriction. An authorized hold of an archived report records the durable staff hold and marks the exact report held in the same transaction. A ban still requires the existing verified person and staff authority.

```quint
pure def carryReportOnAppLeave(ordinaryLeave: bool, reportPhase: ReportPhase, metBefore: bool, urgent: bool): bool =
  ordinaryLeave and reportRestrictsMatching(reportPhase, metBefore, urgent)

pure def archivedReportHoldAllowed(exactSubject: bool, matchingRestriction: bool): bool =
  exactSubject and matchingRestriction

pure def lawOnlyOpenReportsCarry(ordinaryLeave: bool, reportPhase: ReportPhase, metBefore: bool, urgent: bool): bool =
  carryReportOnAppLeave(ordinaryLeave, reportPhase, metBefore, urgent) implies reportPhase == ReportOpen

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

### Staff clear doubt about a teen's age only for a clean teen birth date

A member aged 13 to 17 with an exact birth date is teen ready without a staff step. A stored doubt (a minor signal, a minor report or an age conflict) keeps the member out of every teen pool until a staff member with the `safety` or `admin` role clears it. This clear is the one resolution route for a doubt, not a step for every teen; it also covers the minor signal that the age block stored for every member who was a minor before the teen decision. The clear is allowed only for a known actor and a known member who has a doubt to clear, whose record has an exact birth date that passes `teenPartnerAge` of [friend introductions with a minor](friendIntroAge.md) on the teen check days, whose phone has no teen-pool bar, and who has no `older_than_stated` or `lying` report. A `minor` report about a known minor is a stored doubt and not a bar: the person minor signal and the teen pool hold keep the member out of the teen pools of the other apps until the clear. A clear never removes the minor mark, a bar or an `older_than_stated` report. A clear dismisses the open and held `minor` reports about the member, and it leaves every other report as it is. Changed (owner decision 2026-11-22, A2 to A5): a safety reviewer confirmed every teen age before the first introduction, a `minor` report barred the phone and the clear kept the open `minor` reports -> only a stored doubt needs a staff clear, the clear dismisses the `minor` reports, and the rule reads the teen age from `teenPartnerAge`, because the owner chose no extra checks and the shell had computed the teen age by hand.

```quint
import friendIntroAge as FriendAge from "./friendIntroAge"

pure val birthKeyValues = Set(19950101, 20071122, 20100315, 20131122, 20131123)
pure val minDayValues = Set(20261122)
pure val maxDayValues = Set(20261122, 20261123)

pure def teenDoubtClearResult(actorPresent: bool, memberKnown: bool, hasDoubt: bool, birthExact: bool, birthKey: int,
    minDay: int, maxDay: int, barred: bool, olderOrLyingReport: bool): StaffActionResult =
  if (not(actorPresent)) ActorRequired
  else if (not(memberKnown)) UnknownMember
  else if (not(hasDoubt)) NoMinorSignal
  else if (not(birthExact) or not(FriendAge::teenPartnerAge(birthKey, minDay, maxDay))) AgeUnknown
  else if (barred) TeenBarred
  else if (olderOrLyingReport) TeenOlderReported
  else AllowedAction

pure def lawTeenDoubtClearNeverClearsABar(actorPresent: bool, memberKnown: bool, hasDoubt: bool, birthExact: bool, birthKey: int,
    minDay: int, maxDay: int, olderOrLyingReport: bool): bool =
  teenDoubtClearResult(actorPresent, memberKnown, hasDoubt, birthExact, birthKey, minDay, maxDay, true, olderOrLyingReport) != AllowedAction

pure def lawTeenDoubtClearNeverClearsOlderReport(actorPresent: bool, memberKnown: bool, hasDoubt: bool, birthExact: bool, birthKey: int,
    minDay: int, maxDay: int, barred: bool): bool =
  teenDoubtClearResult(actorPresent, memberKnown, hasDoubt, birthExact, birthKey, minDay, maxDay, barred, true) != AllowedAction

pure def lawTeenDoubtClearNeedsExactTeenBirth(actorPresent: bool, memberKnown: bool, hasDoubt: bool, birthExact: bool, birthKey: int,
    minDay: int, maxDay: int, barred: bool, olderOrLyingReport: bool): bool =
  teenDoubtClearResult(actorPresent, memberKnown, hasDoubt, birthExact, birthKey, minDay, maxDay, barred, olderOrLyingReport) == AllowedAction
    implies (actorPresent and memberKnown and hasDoubt and birthExact and FriendAge::teenPartnerAge(birthKey, minDay, maxDay)
      and not(barred) and not(olderOrLyingReport))

pure def lawTeenDoubtClearRefusesAnAdultBirth(barred: bool): bool =
  teenDoubtClearResult(true, true, true, true, 19950101, 20261122, 20261122, barred, false) == AgeUnknown
```

### A minor signal on one app holds the person on every app until a later clear

A minor report or a minor signal on one app is a fact about the person, so it holds the person out of matching on every app where the person is a member, including an app that the person joins later. The signal stays open on an app until staff clear it there after the signal time. A signal that comes after a clear opens again. The person signal ends, and its row in `platform.person_minor_signals` is deleted, only when every live membership of the person has a clear at or after the signal time; a membership that was never cleared keeps it, so a person who joins a new app after one-app clears on some apps only is still held there. A membership that its app has not loaded yet is loaded from its record when the person signal is open for it, so staff can clear it like any other. The per-app console views (`matching_ages_<app>`) do not show the signal time, because a signal can come from another app and its time would tell one-app staff about an event on that app; only the base view that the service reads has it. Changed (audit ST-D3): a report or a signal marked only the member on its own app, a membership that was not loaded refused the clear, and the per-app views showed the signal time -> the signal holds the person on every app until each membership is cleared, because the person stayed matchable on the other apps and one-app staff learned about an event on another app.

```quint
pure def personMinorSignalOpen(signalKnown: bool, signalAt: int, clearedKnown: bool, clearedAt: int): bool =
  signalKnown and (not(clearedKnown) or signalAt > clearedAt)

pure val signalAtValues = Set(-1, 0, 1, 2)
pure val clearedAtValues = Set(-1, 0, 1, 2)

pure def lawAnUnclearedMinorSignalHoldsThePerson(signalAt: int): bool =
  personMinorSignalOpen(true, signalAt, false, 0)

pure def lawAClearAtOrAfterTheSignalEndsIt(signalAt: int, clearedAt: int): bool =
  clearedAt >= signalAt implies not(personMinorSignalOpen(true, signalAt, true, clearedAt))

pure def lawANewSignalAfterAClearHoldsAgain(signalAt: int, clearedAt: int): bool =
  signalAt > clearedAt implies personMinorSignalOpen(true, signalAt, true, clearedAt)

pure def lawNoSignalHoldsNobody(signalAt: int, clearedKnown: bool, clearedAt: int): bool =
  not(personMinorSignalOpen(false, signalAt, clearedKnown, clearedAt))

pure def personMinorSignalEndsEverywhere(everyMembershipCleared: bool, signalAt: int, earliestClearAt: int): bool =
  everyMembershipCleared and not(personMinorSignalOpen(true, signalAt, true, earliestClearAt))

pure val earliestClearAtValues = Set(-1, 0, 1, 2)

pure def lawAnUnclearedMembershipKeepsThePersonSignal(signalAt: int, earliestClearAt: int): bool =
  not(personMinorSignalEndsEverywhere(false, signalAt, earliestClearAt))

pure def lawASignalAfterTheEarliestClearStays(signalAt: int, earliestClearAt: int): bool =
  signalAt > earliestClearAt implies not(personMinorSignalEndsEverywhere(true, signalAt, earliestClearAt))

pure def lawClearsAtOrAfterTheSignalEverywhereEndIt(signalAt: int, earliestClearAt: int): bool =
  earliestClearAt >= signalAt implies personMinorSignalEndsEverywhere(true, signalAt, earliestClearAt)
```

### A block or a report about a person closes every open opportunity of the pair

A block, a report, and a check-in report about a person who met the reporter all block the pair. Each open opportunity that has both people on its active roster closes: one in review, one that probes, and one that is booked ([opportunity lifecycle](opportunityLifecycle.md), `closesForBlock`; on a booked opportunity the active roster is the people who said yes, and on an earlier stage it is the active participants). The members of a booked opportunity hear that it is off, and the message does not say who acted. A block made on another app reaches this app as a person block, and the next tick closes the open opportunities of that pair here too. A check-in report also counts toward the subject's trust score in the same way as a report in a message from someone who met the subject. A group opportunity closes for all its members too, because a plan that keeps both people of a blocked pair would put them in one meeting, and a plan that drops only one of them would tell the others or the person who is dropped that something happened between them. A friends plan does not seat a member next to a person that the member blocked (`planFriendSeatFits`), so only a block made after the plan formed closes it. The pair's opportunities close before the report is filed, because a report from someone who met the subject can hold the subject, and that hold would otherwise close a shared booking as "participant dropped" with no word to the other person. The cancellation of a booked opportunity goes to every participant except the person who acted, when that person is known (a block or a report in a message, a check-in report); when the tick finds a block from the snapshot, the actor is not known and every participant hears it. A person who already left the opportunity does not close it for the others. Changed (audits ST-D1, ST-D7 and SD-229): only a block in a message on the same app closed the pair's opportunities, and check-in reports did not count toward trust -> a block on any app, a report and a check-in report close every shared opportunity and the cancellation recipients come from `pairBlockCancellationGoesTo`, because two people who blocked each other on another app or in a check-in stayed booked together.

```quint
pure def pairOpportunityClosesOnBlock(open: bool, bothOnIt: bool): bool = open and bothOnIt

pure def pairBlockCancellationGoesTo(booked: bool, actorKnown: bool, isActor: bool): bool =
  booked and (not(actorKnown) or not(isActor))

pure def lawOtherOpportunitiesStay(open: bool, bothOnIt: bool): bool =
  not(bothOnIt) implies not(pairOpportunityClosesOnBlock(open, bothOnIt))

pure def lawAClosedOpportunityStaysClosed(bothOnIt: bool): bool =
  not(pairOpportunityClosesOnBlock(false, bothOnIt))

pure def lawTheKnownActorGetsNoCancellation(booked: bool): bool =
  not(pairBlockCancellationGoesTo(booked, true, true))

pure def lawTheOthersOfABookingHearItIsOff(actorKnown: bool): bool =
  pairBlockCancellationGoesTo(true, actorKnown, false)

pure def lawWithAnUnknownActorEveryParticipantHears(isActor: bool): bool =
  pairBlockCancellationGoesTo(true, false, isActor)

pure def lawNoCancellationBeforeABooking(actorKnown: bool, isActor: bool): bool =
  not(pairBlockCancellationGoesTo(false, actorKnown, isActor))
```
