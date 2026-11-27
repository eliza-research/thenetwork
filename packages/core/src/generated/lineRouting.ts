// GENERATED from spec/lineRouting.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, maxAge as memberAge_maxAge, ageInRange as memberAge_ageInRange, minMemberAge as memberAge_minMemberAge, joinableAge as memberAge_joinableAge, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, adultAge as memberAge_adultAge, matchableAge as memberAge_matchableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, recordedChatAge as memberAge_recordedChatAge, confirmedUnderage as memberAge_confirmedUnderage, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, ownAgeEvidenceAllowed as memberAge_ownAgeEvidenceAllowed, lawQuotedWordsDoNotSetSenderAge as memberAge_lawQuotedWordsDoNotSetSenderAge, ownYouthCueAllowed as memberAge_ownYouthCueAllowed, lawAnotherSpeakersYouthCueCannotRestrictSender as memberAge_lawAnotherSpeakersYouthCueCannotRestrictSender, underageCleanupRequired as memberAge_underageCleanupRequired, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart, precedingBirthdayAge as memberAge_precedingBirthdayAge, ageQualifierFollows as memberAge_ageQualifierFollows, lawDistantBirthdayQualifiesTheAge as memberAge_lawDistantBirthdayQualifiesTheAge, lawBeforeAnEighteenthBirthdayIsNotAdult as memberAge_lawBeforeAnEighteenthBirthdayIsNotAdult, minLooseHeightAge as memberAge_minLooseHeightAge, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, minLooseTeamAge as memberAge_minLooseTeamAge, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lowerAge as memberAge_lowerAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, ageOnDay as memberAge_ageOnDay, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, statedAgeBeforeBirthDates as memberAge_statedAgeBeforeBirthDates, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, laterBirthKey as memberAge_laterBirthKey, mergeReading as memberAge_mergeReading, readingsConflict as memberAge_readingsConflict, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, effectiveAge as memberAge_effectiveAge, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawMinorBeforeBirthDatesKeepsMinorAge as memberAge_lawMinorBeforeBirthDatesKeepsMinorAge, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, verifiedBrowserBirthMayBeKept as memberAge_verifiedBrowserBirthMayBeKept, lawBrowserBirthNeedsEligibleVerifiedEnrollment as memberAge_lawBrowserBirthNeedsEligibleVerifiedEnrollment, signupAgeAt as memberAge_signupAgeAt, signupAgeCapNeeded as memberAge_signupAgeCapNeeded, lawMatchingSignupBirthKeepsBirthdays as memberAge_lawMatchingSignupBirthKeepsBirthdays, lawOtherBirthCannotAdvanceSignupMinor as memberAge_lawOtherBirthCannotAdvanceSignupMinor, lawSignupAgeDoesNotAdvanceEarly as memberAge_lawSignupAgeDoesNotAdvanceEarly, lawSignupAgeAdvancesAtEligibility as memberAge_lawSignupAgeAdvancesAtEligibility, lawSignupAgeKeepsAnIndependentFloor as memberAge_lawSignupAgeKeepsAnIndependentFloor, mayClearMaturedSignupMinor as memberAge_mayClearMaturedSignupMinor, lawOtherYouthEvidenceKeepsMinorRestricted as memberAge_lawOtherYouthEvidenceKeepsMinorRestricted, keepLaterEligibilityDate as memberAge_keepLaterEligibilityDate, lawAnotherSignupCannotAdvanceEligibility as memberAge_lawAnotherSignupCannotAdvanceEligibility } from "./memberAge.ts";
import { type CasePhase as safetyCase_CasePhase, type SafetyCase as safetyCase_SafetyCase, type StaffActionResult as safetyCase_StaffActionResult, type ReportPhase as safetyCase_ReportPhase, type ReportDecision as safetyCase_ReportDecision, type SharedReportRoute as safetyCase_SharedReportRoute, initial as safetyCase_initial, canRecordCaseEvent as safetyCase_canRecordCaseEvent, recordCaseEvent as safetyCase_recordCaseEvent, lawDecayNeverOpensCase as safetyCase_lawDecayNeverOpensCase, liveCase as safetyCase_liveCase, canMarkCaseHeld as safetyCase_canMarkCaseHeld, markCaseHeld as safetyCase_markCaseHeld, canMarkCaseLifted as safetyCase_canMarkCaseLifted, markCaseLifted as safetyCase_markCaseLifted, canCloseCase as safetyCase_canCloseCase, closeCase as safetyCase_closeCase, stepClosedCaseStaysClosed as safetyCase_stepClosedCaseStaysClosed, sometimesCaseCloses as safetyCase_sometimesCaseCloses, sometimesCaseWasLifted as safetyCase_sometimesCaseWasLifted, holdLiftResult as safetyCase_holdLiftResult, caseCloseResult as safetyCase_caseCloseResult, holdAuthority as safetyCase_holdAuthority, holdSubjectKnown as safetyCase_holdSubjectKnown, immediateDangerReply as safetyCase_immediateDangerReply, lawEmergencyReplyRequiresOwnText as safetyCase_lawEmergencyReplyRequiresOwnText, lawEmergencyReplyRequiresCurrentDanger as safetyCase_lawEmergencyReplyRequiresCurrentDanger, emergencyCheckInReport as safetyCase_emergencyCheckInReport, lawEmergencyCheckInNeedsReceipt as safetyCase_lawEmergencyCheckInNeedsReceipt, safetyRequestMayResolveTarget as safetyCase_safetyRequestMayResolveTarget, lawConditionalSafetyRequestCannotResolveTarget as safetyCase_lawConditionalSafetyRequestCannotResolveTarget, acceptsReportEvidence as safetyCase_acceptsReportEvidence, lawCasualContactDoesNotEstablishHarm as safetyCase_lawCasualContactDoesNotEstablishHarm, lawDeniedEvidenceDoesNotEstablishHarm as safetyCase_lawDeniedEvidenceDoesNotEstablishHarm, acceptsMinorReportEvidence as safetyCase_acceptsMinorReportEvidence, lawMinorReportNeedsAffirmation as safetyCase_lawMinorReportNeedsAffirmation, lawMinorReportNeedsAnEligibleSubject as safetyCase_lawMinorReportNeedsAnEligibleSubject, reportAfterDecision as safetyCase_reportAfterDecision, reportRestrictsMatching as safetyCase_reportRestrictsMatching, lawDecidedReportDoesNotRestrictMatching as safetyCase_lawDecidedReportDoesNotRestrictMatching, lawDismissedReportStaysDismissed as safetyCase_lawDismissedReportStaysDismissed, carryReportOnAppLeave as safetyCase_carryReportOnAppLeave, archivedReportHoldAllowed as safetyCase_archivedReportHoldAllowed, lawOnlyOpenReportsCarry as safetyCase_lawOnlyOpenReportsCarry, lawReportedMinorSignalSurvivesOrdinaryLeave as safetyCase_lawReportedMinorSignalSurvivesOrdinaryLeave, lawAccountErasureCarriesNoReport as safetyCase_lawAccountErasureCarriesNoReport, lawArchivedHoldRequiresExactSubject as safetyCase_lawArchivedHoldRequiresExactSubject, sharedReportRoute as safetyCase_sharedReportRoute, reportClarificationTimeCurrent as safetyCase_reportClarificationTimeCurrent, lawSharedReportRequiresOneChoice as safetyCase_lawSharedReportRequiresOneChoice, lawReportReplyCannotPredateQuestion as safetyCase_lawReportReplyCannotPredateQuestion, safetyQuestionIsCurrent as safetyCase_safetyQuestionIsCurrent, lawExpiredSafetyQuestionCannotAct as safetyCase_lawExpiredSafetyQuestionCannotAct, safetyQuestionAcceptsName as safetyCase_safetyQuestionAcceptsName, lawSafetyControlCannotNameTarget as safetyCase_lawSafetyControlCannotNameTarget, safetyQuestionAppliesTarget as safetyCase_safetyQuestionAppliesTarget, safetyQuestionExclusion as safetyCase_safetyQuestionExclusion, lawCompetingPromptNeedsExplicitSafetyExclusion as safetyCase_lawCompetingPromptNeedsExplicitSafetyExclusion, lawExplicitSafetyExclusionStillApplies as safetyCase_lawExplicitSafetyExclusionStillApplies, safetyReplyAfterExclusion as safetyCase_safetyReplyAfterExclusion, lawSafetyReplacementSendsOnlySeparateReply as safetyCase_lawSafetyReplacementSendsOnlySeparateReply, lawSafetyReplacementAloneDoesNotAnswerAnotherPrompt as safetyCase_lawSafetyReplacementAloneDoesNotAnswerAnotherPrompt, safetyQuestionResolves as safetyCase_safetyQuestionResolves, lawCompetingPromptKeepsUnresolvedSafety as safetyCase_lawCompetingPromptKeepsUnresolvedSafety, lawCancellationResolvesSafety as safetyCase_lawCancellationResolvesSafety, lawAllowedTargetResolvesSafety as safetyCase_lawAllowedTargetResolvesSafety, lawTargetExclusionClosesWithoutFiling as safetyCase_lawTargetExclusionClosesWithoutFiling, lawLongUnrelatedReplyKeepsSafety as safetyCase_lawLongUnrelatedReplyKeepsSafety, safetyQuestionUsesSoleOffer as safetyCase_safetyQuestionUsesSoleOffer, lawCompetingPromptCannotUseSoleSafetyOffer as safetyCase_lawCompetingPromptCannotUseSoleSafetyOffer, lawSoleSafetyOfferRequiresExactConfirmation as safetyCase_lawSoleSafetyOfferRequiresExactConfirmation, lawNamedSafetyAnswerCannotUseSoleOffer as safetyCase_lawNamedSafetyAnswerCannotUseSoleOffer, inboundAllowedAfterBan as safetyCase_inboundAllowedAfterBan, lawBanBlocksOrdinaryInbound as safetyCase_lawBanBlocksOrdinaryInbound, minorClearResult as safetyCase_minorClearResult, teenDoubtClearResult as safetyCase_teenDoubtClearResult, lawTeenDoubtClearNeverClearsABar as safetyCase_lawTeenDoubtClearNeverClearsABar, lawTeenDoubtClearNeverClearsOlderReport as safetyCase_lawTeenDoubtClearNeverClearsOlderReport, lawTeenDoubtClearNeedsExactTeenBirth as safetyCase_lawTeenDoubtClearNeedsExactTeenBirth, lawTeenDoubtClearRefusesAnAdultBirth as safetyCase_lawTeenDoubtClearRefusesAnAdultBirth, personMinorSignalOpen as safetyCase_personMinorSignalOpen, lawAnUnclearedMinorSignalHoldsThePerson as safetyCase_lawAnUnclearedMinorSignalHoldsThePerson, lawAClearAtOrAfterTheSignalEndsIt as safetyCase_lawAClearAtOrAfterTheSignalEndsIt, lawANewSignalAfterAClearHoldsAgain as safetyCase_lawANewSignalAfterAClearHoldsAgain, lawNoSignalHoldsNobody as safetyCase_lawNoSignalHoldsNobody, personMinorSignalEndsEverywhere as safetyCase_personMinorSignalEndsEverywhere, lawAnUnclearedMembershipKeepsThePersonSignal as safetyCase_lawAnUnclearedMembershipKeepsThePersonSignal, lawASignalAfterTheEarliestClearStays as safetyCase_lawASignalAfterTheEarliestClearStays, lawClearsAtOrAfterTheSignalEverywhereEndIt as safetyCase_lawClearsAtOrAfterTheSignalEverywhereEndIt, pairOpportunityClosesOnBlock as safetyCase_pairOpportunityClosesOnBlock, pairBlockCancellationGoesTo as safetyCase_pairBlockCancellationGoesTo, lawOtherOpportunitiesStay as safetyCase_lawOtherOpportunitiesStay, lawAClosedOpportunityStaysClosed as safetyCase_lawAClosedOpportunityStaysClosed, lawTheKnownActorGetsNoCancellation as safetyCase_lawTheKnownActorGetsNoCancellation, lawTheOthersOfABookingHearItIsOff as safetyCase_lawTheOthersOfABookingHearItIsOff, lawWithAnUnknownActorEveryParticipantHears as safetyCase_lawWithAnUnknownActorEveryParticipantHears, lawNoCancellationBeforeABooking as safetyCase_lawNoCancellationBeforeABooking } from "./safetyCase.ts";
import { type AgeSide as friendIntroAge_AgeSide } from "./friendIntroAge.ts";

/** Story: Keep carrier commands, bans and age ahead of every other reading / STOP ends the message before any other check (spec/lineRouting.md) */
export type LineCommand = "LineNoCommand" | "LineStop" | "LineHelp" | "LineStart";
/** Story: Keep carrier commands, bans and age ahead of every other reading / STOP ends the message before any other check (spec/lineRouting.md) */
export type LineGatePhase = "LineAwaitingCommand" | "LineAwaitingBan" | "LineAwaitingAge" | "LineAwaitingInviteDecline" | "LineAwaitingNumberHold" | "LineStopped" | "LineBannedIgnored" | "LineBannedHelp" | "LineAgeDeclined" | "LineUnderageHelp" | "LineInviteDeclined" | "LineNumberHeld" | "LineContinue";
/** Story: Keep carrier commands, bans and age ahead of every other reading / STOP ends the message before any other check (spec/lineRouting.md) */
export interface LineGate { phase: LineGatePhase; command: LineCommand; leaveNamed: boolean; banned: boolean; underage: boolean }
/** Story: Keep carrier commands, bans and age ahead of every other reading / Every app leave gets one honest reply (spec/lineRouting.md) */
export type LeaveReply = "LeftAppReply" | "NotInAppReply";
/** Story: Join the apps I asked for from The Network / A refused app is never enrolled, even with "all of them" (spec/lineRouting.md) */
export type LookingForMention = "MentionAbsent" | "MentionWanted" | "MentionRefused";
/** Story: Join the apps I asked for from The Network / A refused app is never enrolled, even with "all of them" (spec/lineRouting.md) */
export interface LookingForReading { friends: LookingForMention; dating: LookingForMention; work: LookingForMention; everything: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "readLineCommand"; command: LineCommand; leaveNamed: boolean }
  | { type: "checkLineBan"; banned: boolean }
  | { type: "checkLineAge"; age: number }
  | { type: "checkLineInviteDecline"; declines: boolean }
  | { type: "checkLineNumberHold"; held: boolean };

/** Story: Keep carrier commands, bans and age ahead of every other reading / STOP ends the message before any other check (spec/lineRouting.md) */
export const initial: LineGate = { phase: "LineAwaitingCommand", command: "LineNoCommand", leaveNamed: false, banned: false, underage: false };
/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
export const maxWhoAnswerWords: number = 4;

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: LineGate): boolean {
  return alwaysStopGoesNoFurther(current) && alwaysBannedPassesOnlyToLeave(current) && alwaysUnderagePassesOnlyToLeave(current) && alwaysHeldNumberIsNotBanned(current);
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / STOP ends the message before any other check (spec/lineRouting.md) */
//@ pure
export function lineCommandStops(command: LineCommand): boolean {
  return command === "LineStop";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / STOP ends the message before any other check (spec/lineRouting.md) */
//@ pure
export function canReadLineCommand(gate: LineGate): boolean {
  return gate.phase === "LineAwaitingCommand";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / STOP ends the message before any other check (spec/lineRouting.md) */
//@ pure
export function readLineCommand(gate: LineGate, command: LineCommand, leaveNamed: boolean): LineGate {
  //@ ensures (inv(gate) && canReadLineCommand(gate)) ==> alwaysStopGoesNoFurther(\result)
  //@ ensures (inv(gate) && canReadLineCommand(gate)) ==> alwaysBannedPassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canReadLineCommand(gate)) ==> alwaysUnderagePassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canReadLineCommand(gate)) ==> alwaysHeldNumberIsNotBanned(\result)
  return { ...gate, command: command, leaveNamed: leaveNamed, phase: lineCommandStops(command) ? "LineStopped" : "LineAwaitingBan" };
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / STOP ends the message before any other check (spec/lineRouting.md) */
//@ pure
export function alwaysStopGoesNoFurther(gate: LineGate): boolean {
  return !lineCommandStops(gate.command) || gate.phase === "LineStopped";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / STOP ends the message before any other check (spec/lineRouting.md) */
//@ pure
export function sometimesLineStopped(gate: LineGate): boolean {
  return gate.phase === "LineStopped";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A banned number gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function lineCompliance(command: LineCommand, leaveNamed: boolean): boolean {
  return command === "LineHelp" || leaveNamed;
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A banned number gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function linePastBan(phase: LineGatePhase): boolean {
  return phase === "LineAwaitingAge" || phase === "LineAwaitingInviteDecline" || phase === "LineAwaitingNumberHold" || phase === "LineInviteDeclined" || phase === "LineNumberHeld" || phase === "LineContinue";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A banned number gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function canCheckLineBan(gate: LineGate): boolean {
  return gate.phase === "LineAwaitingBan";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A banned number gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function checkLineBan(gate: LineGate, banned: boolean): LineGate {
  //@ ensures (inv(gate) && canCheckLineBan(gate)) ==> alwaysStopGoesNoFurther(\result)
  //@ ensures (inv(gate) && canCheckLineBan(gate)) ==> alwaysBannedPassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canCheckLineBan(gate)) ==> alwaysUnderagePassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canCheckLineBan(gate)) ==> alwaysHeldNumberIsNotBanned(\result)
  return { ...gate, banned: banned, phase: !safetyCase_inboundAllowedAfterBan(banned, lineCompliance(gate.command, gate.leaveNamed)) ? "LineBannedIgnored" : (banned && gate.command === "LineHelp" ? "LineBannedHelp" : "LineAwaitingAge") };
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A banned number gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function alwaysBannedPassesOnlyToLeave(gate: LineGate): boolean {
  return !(linePastBan(gate.phase) && gate.banned) || (gate.leaveNamed && gate.command !== "LineHelp");
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A banned number gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function sometimesBannedLeaves(gate: LineGate): boolean {
  return gate.phase === "LineContinue" && gate.banned;
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A banned number gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function sometimesBannedIgnored(gate: LineGate): boolean {
  return gate.phase === "LineBannedIgnored";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A banned number gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function sometimesBannedGetsHelp(gate: LineGate): boolean {
  return gate.phase === "LineBannedHelp";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A confirmed age under 13 gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function linePastAge(phase: LineGatePhase): boolean {
  return phase === "LineAwaitingInviteDecline" || phase === "LineAwaitingNumberHold" || phase === "LineInviteDeclined" || phase === "LineNumberHeld" || phase === "LineContinue";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A confirmed age under 13 gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function canCheckLineAge(gate: LineGate): boolean {
  return gate.phase === "LineAwaitingAge";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A confirmed age under 13 gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function checkLineAge(gate: LineGate, age: number): LineGate {
  //@ ensures (inv(gate) && canCheckLineAge(gate)) ==> alwaysStopGoesNoFurther(\result)
  //@ ensures (inv(gate) && canCheckLineAge(gate)) ==> alwaysBannedPassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canCheckLineAge(gate)) ==> alwaysUnderagePassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canCheckLineAge(gate)) ==> alwaysHeldNumberIsNotBanned(\result)
  return { ...gate, underage: memberAge_confirmedUnderage(age), phase: !memberAge_textUseAllowedAtAge(age, lineCompliance(gate.command, gate.leaveNamed)) ? "LineAgeDeclined" : (memberAge_confirmedUnderage(age) && gate.command === "LineHelp" ? "LineUnderageHelp" : "LineAwaitingInviteDecline") };
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A confirmed age under 13 gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function alwaysUnderagePassesOnlyToLeave(gate: LineGate): boolean {
  return !(linePastAge(gate.phase) && gate.underage) || (gate.leaveNamed && gate.command !== "LineHelp");
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A confirmed age under 13 gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function lawUnderageStartIsDeclined(age: number): boolean {
  //@ ensures \result === true
  return !memberAge_confirmedUnderage(age) || checkLineAge(({ phase: "LineAwaitingAge", command: "LineStart", leaveNamed: false, banned: false, underage: false } as LineGate), age).phase === "LineAgeDeclined";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A confirmed age under 13 gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function sometimesUnderageLeaves(gate: LineGate): boolean {
  return gate.phase === "LineContinue" && gate.underage;
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A confirmed age under 13 gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function sometimesAgeDeclined(gate: LineGate): boolean {
  return gate.phase === "LineAgeDeclined";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / A confirmed age under 13 gets only HELP and app leave (spec/lineRouting.md) */
//@ pure
export function sometimesUnderageGetsHelp(gate: LineGate): boolean {
  return gate.phase === "LineUnderageHelp";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function canCheckLineInviteDecline(gate: LineGate): boolean {
  return gate.phase === "LineAwaitingInviteDecline";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function checkLineInviteDecline(gate: LineGate, declines: boolean): LineGate {
  //@ ensures (inv(gate) && canCheckLineInviteDecline(gate)) ==> alwaysStopGoesNoFurther(\result)
  //@ ensures (inv(gate) && canCheckLineInviteDecline(gate)) ==> alwaysBannedPassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canCheckLineInviteDecline(gate)) ==> alwaysUnderagePassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canCheckLineInviteDecline(gate)) ==> alwaysHeldNumberIsNotBanned(\result)
  return { ...gate, phase: declines ? "LineInviteDeclined" : "LineAwaitingNumberHold" };
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function lineNumberHoldReadNeeded(banned: boolean): boolean {
  return !banned;
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function canCheckLineNumberHold(gate: LineGate): boolean {
  return gate.phase === "LineAwaitingNumberHold";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function checkLineNumberHold(gate: LineGate, held: boolean): LineGate {
  //@ ensures (inv(gate) && canCheckLineNumberHold(gate)) ==> alwaysStopGoesNoFurther(\result)
  //@ ensures (inv(gate) && canCheckLineNumberHold(gate)) ==> alwaysBannedPassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canCheckLineNumberHold(gate)) ==> alwaysUnderagePassesOnlyToLeave(\result)
  //@ ensures (inv(gate) && canCheckLineNumberHold(gate)) ==> alwaysHeldNumberIsNotBanned(\result)
  return { ...gate, phase: held && lineNumberHoldReadNeeded(gate.banned) ? "LineNumberHeld" : "LineContinue" };
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function lineHeldNumberGetsHelp(phase: LineGatePhase, command: LineCommand): boolean {
  return phase === "LineNumberHeld" && command === "LineHelp";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function alwaysHeldNumberIsNotBanned(gate: LineGate): boolean {
  return !(gate.phase === "LineNumberHeld") || !gate.banned;
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function sometimesInviteDeclined(gate: LineGate): boolean {
  return gate.phase === "LineInviteDeclined";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function sometimesNumberHeld(gate: LineGate): boolean {
  return gate.phase === "LineNumberHeld";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / An invitation decline and a held number come before any flow (spec/lineRouting.md) */
//@ pure
export function sometimesLineContinues(gate: LineGate): boolean {
  return gate.phase === "LineContinue" && !gate.banned && !gate.underage;
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / Every app leave gets one honest reply (spec/lineRouting.md) */
//@ pure
export function leaveReply(routedMember: boolean, membershipInvited: boolean, membershipRemoved: boolean, hasMembership: boolean): LeaveReply {
  return routedMember || (hasMembership && !membershipInvited && !membershipRemoved) ? "LeftAppReply" : "NotInAppReply";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / Every app leave gets one honest reply (spec/lineRouting.md) */
//@ pure
export function lawStrangerHearsNotInApp(membershipInvited: boolean, membershipRemoved: boolean): boolean {
  //@ ensures \result === true
  return leaveReply(false, membershipInvited, membershipRemoved, false) === "NotInAppReply";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / Every app leave gets one honest reply (spec/lineRouting.md) */
//@ pure
export function lawInvitedOrRemovedHearsNotInApp(membershipInvited: boolean, membershipRemoved: boolean): boolean {
  //@ ensures \result === true
  return !(membershipInvited || membershipRemoved) || leaveReply(false, membershipInvited, membershipRemoved, true) === "NotInAppReply";
}

/** Story: Keep carrier commands, bans and age ahead of every other reading / Every app leave gets one honest reply (spec/lineRouting.md) */
//@ pure
export function lawRoutedMemberHearsLeft(membershipInvited: boolean, membershipRemoved: boolean, hasMembership: boolean): boolean {
  //@ ensures \result === true
  return leaveReply(true, membershipInvited, membershipRemoved, hasMembership) === "LeftAppReply";
}

/** Story: Join the apps I asked for from The Network / A refused app is never enrolled, even with "all of them" (spec/lineRouting.md) */
//@ pure
export function lookingForWants(mention: LookingForMention, everything: boolean): boolean {
  return mention === "MentionWanted" || (everything && mention === "MentionAbsent");
}

/** Story: Join the apps I asked for from The Network / A refused app is never enrolled, even with "all of them" (spec/lineRouting.md) */
//@ pure
export function lookingForApps(reading: LookingForReading): string[] {
  const local_0 = lookingForWants(reading.friends, reading.everything) ? (["friends"] as string[]) : ([] as string[]);
  const local_1 = lookingForWants(reading.dating, reading.everything) ? (["slop"] as string[]) : ([] as string[]);
  const local_2 = lookingForWants(reading.work, reading.everything) ? (["peon"] as string[]) : ([] as string[]);
  return local_0.concat(local_1, local_2);
}

/** Story: Join the apps I asked for from The Network / A refused app is never enrolled, even with "all of them" (spec/lineRouting.md) */
//@ pure
export function lawRefusedMentionIsNeverWanted(everything: boolean): boolean {
  //@ ensures \result === true
  return !lookingForWants("MentionRefused", everything);
}

/** Story: Join the apps I asked for from The Network / A refused app is never enrolled, even with "all of them" (spec/lineRouting.md) */
//@ pure
export function lawRefusedDatingNeverEnrollsSlop(friends: LookingForMention, work: LookingForMention, everything: boolean): boolean {
  //@ ensures \result === true
  return !lookingForApps(({ friends: friends, dating: "MentionRefused", work: work, everything: everything } as LookingForReading)).includes("slop");
}

/** Story: Join the apps I asked for from The Network / A refused app is never enrolled, even with "all of them" (spec/lineRouting.md) */
//@ pure
export function lawEverythingAddsUnrefusedApps(friends: LookingForMention, dating: LookingForMention, work: LookingForMention): boolean {
  //@ ensures \result === true
  return !(friends !== "MentionRefused" && dating !== "MentionRefused" && work !== "MentionRefused") || equal_lineRouting(lookingForApps(({ friends: friends, dating: dating, work: work, everything: true } as LookingForReading)), (["friends", "slop", "peon"] as string[]));
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function safetyRouteReadNeeded(memberApps: number, safetyCommand: boolean, words: number): boolean {
  return memberApps > 1 && (safetyCommand || words <= maxWhoAnswerWords);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function safetyAppReadNeeded(safetyCommand: boolean, questionStored: boolean): boolean {
  return safetyCommand || questionStored;
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function safetyCommandClaims(meetingAt: number): boolean {
  return meetingAt >= 0;
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function safetyAnswerClaims(pendingSafetyAt: number, newestOtherMessageAt: number, joinAnswerWithAge: boolean): boolean {
  return pendingSafetyAt >= 0 && pendingSafetyAt >= newestOtherMessageAt && !joinAnswerWithAge;
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function safetyClaimLeads(claims: boolean, at: number, leadAt: number): boolean {
  return claims && at > leadAt;
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawOneAppNeedsNoSafetyRead(safetyCommand: boolean, words: number): boolean {
  //@ ensures \result === true
  return !safetyRouteReadNeeded(1, safetyCommand, words);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawLongTextIsNoWhoAnswer(memberApps: number, words: number): boolean {
  //@ ensures \result === true
  return !(words > maxWhoAnswerWords) || !safetyRouteReadNeeded(memberApps, false, words);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawCommandIsReadForSeveralApps(memberApps: number, words: number): boolean {
  //@ ensures \result === true
  return !(memberApps > 1) || safetyRouteReadNeeded(memberApps, true, words);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawCommandReadsEveryApp(questionStored: boolean): boolean {
  //@ ensures \result === true
  return safetyAppReadNeeded(true, questionStored);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawNoStoredQuestionNoAnswerRead(questionStored: boolean): boolean {
  //@ ensures \result === true
  return !(!questionStored) || !safetyAppReadNeeded(false, questionStored);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawNoMeetingNoCommandClaim(meetingAt: number): boolean {
  //@ ensures \result === true
  return !(meetingAt < 0) || !safetyCommandClaims(meetingAt);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawNoQuestionNoAnswerClaim(newestOtherMessageAt: number, joinAnswerWithAge: boolean): boolean {
  //@ ensures \result === true
  return !safetyAnswerClaims(-1, newestOtherMessageAt, joinAnswerWithAge);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawNewerMessageElsewhereKeepsTheAnswer(pendingSafetyAt: number, newestOtherMessageAt: number, joinAnswerWithAge: boolean): boolean {
  //@ ensures \result === true
  return !(newestOtherMessageAt > pendingSafetyAt) || !safetyAnswerClaims(pendingSafetyAt, newestOtherMessageAt, joinAnswerWithAge);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawJoinAnswerWithAgeKeepsTheAnswer(pendingSafetyAt: number, newestOtherMessageAt: number): boolean {
  //@ ensures \result === true
  return !safetyAnswerClaims(pendingSafetyAt, newestOtherMessageAt, true);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawQuestionAfterEveryMessageClaims(pendingSafetyAt: number, newestOtherMessageAt: number): boolean {
  //@ ensures \result === true
  return !(pendingSafetyAt >= 0 && newestOtherMessageAt <= pendingSafetyAt) || safetyAnswerClaims(pendingSafetyAt, newestOtherMessageAt, false);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawNoClaimNeverLeads(at: number, leadAt: number): boolean {
  //@ ensures \result === true
  return !safetyClaimLeads(false, at, leadAt);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawFirstClaimLeads(at: number): boolean {
  //@ ensures \result === true
  return !(at >= 0) || safetyClaimLeads(true, at, -1);
}

/** Story: Report a person in the app where I met them / A block, a report and the answer to "Who do you mean?" go to the app where they belong (spec/lineRouting.md) */
//@ pure
export function lawEqualTimeKeepsTheLead(at: number): boolean {
  //@ ensures \result === true
  return !safetyClaimLeads(true, at, at);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: LineGate, event: Event): boolean {
  if (event.type === "readLineCommand") return canReadLineCommand(current);
  if (event.type === "checkLineBan") return canCheckLineBan(current);
  if (event.type === "checkLineAge") return canCheckLineAge(current);
  if (event.type === "checkLineInviteDecline") return canCheckLineInviteDecline(current);
  if (event.type === "checkLineNumberHold") return canCheckLineNumberHold(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: LineGate, event: Event): LineGate {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "readLineCommand") return canReadLineCommand(current) ? readLineCommand(current, event.command, event.leaveNamed) : current;
  if (event.type === "checkLineBan") return canCheckLineBan(current) ? checkLineBan(current, event.banned) : current;
  if (event.type === "checkLineAge") return canCheckLineAge(current) ? checkLineAge(current, event.age) : current;
  if (event.type === "checkLineInviteDecline") return canCheckLineInviteDecline(current) ? checkLineInviteDecline(current, event.declines) : current;
  if (event.type === "checkLineNumberHold") return canCheckLineNumberHold(current) ? checkLineNumberHold(current, event.held) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "readLineCommand" && (raw.command === "LineNoCommand" || raw.command === "LineStop" || raw.command === "LineHelp" || raw.command === "LineStart") && typeof raw.leaveNamed === "boolean") return { type: "readLineCommand", command: raw.command, leaveNamed: raw.leaveNamed };
  if (raw.type === "checkLineBan" && typeof raw.banned === "boolean") return { type: "checkLineBan", banned: raw.banned };
  if (raw.type === "checkLineAge" && Number.isSafeInteger(raw.age)) return { type: "checkLineAge", age: raw.age };
  if (raw.type === "checkLineInviteDecline" && typeof raw.declines === "boolean") return { type: "checkLineInviteDecline", declines: raw.declines };
  if (raw.type === "checkLineNumberHold" && typeof raw.held === "boolean") return { type: "checkLineNumberHold", held: raw.held };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): LineGate | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "LineAwaitingCommand" || raw.phase === "LineAwaitingBan" || raw.phase === "LineAwaitingAge" || raw.phase === "LineAwaitingInviteDecline" || raw.phase === "LineAwaitingNumberHold" || raw.phase === "LineStopped" || raw.phase === "LineBannedIgnored" || raw.phase === "LineBannedHelp" || raw.phase === "LineAgeDeclined" || raw.phase === "LineUnderageHelp" || raw.phase === "LineInviteDeclined" || raw.phase === "LineNumberHeld" || raw.phase === "LineContinue") && (raw.command === "LineNoCommand" || raw.command === "LineStop" || raw.command === "LineHelp" || raw.command === "LineStart") && typeof raw.leaveNamed === "boolean" && typeof raw.banned === "boolean" && typeof raw.underage === "boolean" && Object.keys(raw).length === 5)) return undefined;
  const parsed: LineGate = ({ phase: raw.phase, command: raw.command, leaveNamed: raw.leaveNamed, banned: raw.banned, underage: raw.underage });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): LineGate {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_lineRouting(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_lineRouting((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
