// ConsentNetwork: a production-shaped Network for New York (docs/network.md). It replaces the
// StubNetwork in the simulator and is written to run unchanged behind the real channel later.
//
// What it does differently from the stub:
//  - Consent first. Every approved opportunity starts with an anonymous probe ("up for X this week
//    near Y?"); only when every participant says yes does the Network reveal who and propose a time
//    and place. Members who asked for something themselves are not probed: they already said yes.
//  - Selective. Engine output is gated on trust, knowledge, evidence and capacity; one open
//    opportunity per member, with alternates when someone is unavailable (no wasted proposals).
//  - Requests are fulfilled: asks for a person or a plan are classified, searched, probed and answered.
//  - Every send is re-checked at send time (opt-out, decline, hold, minors, watch, blocks), respects
//    quiet hours, the interruption budget and the unanswered rules (outreach.ts), and passes the
//    leak guard (core guard.ts) with other members' private facts and canaries.
//  - Learns. Interview answers become facets, feedback becomes edges and reliability, and all of it
//    is fed back into the engine's input (safetyHolds, feedback, interactions, reliability).
//  - Grows. Invite asks after good experiences and for unmet requests; invitees join and are welcomed.
//  - Real places. Meetings are at public NYC venues that keep everyone's trip short (geo.ts).
//  - Plans (plans v1.1). The engine planner runs Monday and Thursday; each plan is one review item;
//    anonymous plan probes go through a separate plan lane (1 per member per 7 days); quorum books
//    the plan and only then names people; fallbacks, would_interact_again edges and crews (plans.ts).
//  - Network capital. Every NC ledger event goes to one typed emitter (onLedger); the levers are read
//    through an optional reader (capital.ts); gaming flags wait in the review queue as "fraud" items.
import {
  ADULT_AGE, ALCOHOL_CENTRIC_CATEGORIES, ALL_SEED_VENUES, canBeMatched, canJoin, checkExternalEventT24Quorum, checkPublishExternalEvent,
  CITY_TZ, cityTimezone, computeFollowupTimestamp, DAY, directAgreementIdiom, evaluateArrivalRelaySafe, evaluateBackupPivotV2, evaluateDensityTier,
  evaluateExternalSourcingTrigger, evaluateFollowupSend, evaluateVenueQuarantine, evaluateVenueRedLines, fromLocal, HOUR, isCity, isLaunchCity, isMinor,
  isVenueOpenAt, localParts, LeakGuard, MINUTE, pickPrimaryAndBackupVenue, proposeTopOne, quoteStillOpen, rejectAndPivot, rerankTopVenuesWithLLM,
  seedVenuesForCity, selectWorkIntroChannel, UNDER_MIN_AGE_DECLINE, validAge, venueHardEligible,
  type Category, type City, type CityId, type DensityTier, type ExternalEventDraft, type ExternalQuorumDecision, type Facet, type Intent,
  type LaunchCity, type LeakOptions, type LLM, type MemberId, type MemberVenuePrefs, type NetworkEvent,
  type ParticipationState, type PivotFilterOptions, type Preferences, type Presence, type PrimaryBackupVenuePick, type Proposal,
  type ScoreComponents, type TopOneSuggestionState, type VampireTelemetry, type VenueLLMRerankResult, type VenueNoiseLevel, type VenuePriceTier, type VenueRecord,
  type VenueRejectionReason, type WorkIntroState, type WorldSnapshot,
} from "@thenetwork/core";
import {
  attention, CONTRIBUTOR_ROLES, DEFAULT_ATTENTION, existingFriendPlanPairValues, friendsKit, JudgeCache, localEmbed, networkPack, plans, resolveConfig, resolvePlans, seatFills,
  type AskRecord, type EngineAsk, type EngineConfigInput, type EngineDeps, type EngineInput, type EngineProposal, type FeedbackRecord, type InteractionRecord, type MatchingRunLog,
  type AppPack, type PlansConfig, type PlansConfigInput, World as EngineWorld, DEFAULT_FRIENDS_POLICY, planFriendsWeek,
} from "@thenetwork/engine";
import { appKeys, brandFor } from "../../core/src/generated/brandIdentity.ts";
import { mayClearMaturedSignupMinor } from "../../core/src/generated/memberAge.ts";
import { crewHandoffDue, crewMemberWindowAvailable, crewOfferReplyCurrent, crewSessionVenueAllowed, initial as initialCrewOffer, step as stepCrewOffer, type CrewOfferState } from "../../core/src/generated/crewOffer.ts";
import { friendsRepeatAttendanceAllowed, friendsRepeatBookingProofCurrent, friendsRepeatHostIndex, friendsRepeatRosterCurrent, friendsRepeatSourceAllowed } from "../../core/src/generated/friendsWeek.ts";
import {
  immediateRequestSearchAllowed, initial as initialMemberRequest, learnDuringRequestIntake, memberRequestWithdrawable,
  primeMemberRequest, requestDesireWithdrawn, requesterHearsOpportunityClose, requestInReuseWindow, sameStandingRequest, scheduledRequestRetryReady,
  step as stepMemberRequest, waitingMemberRequest, withdrawnRequestKeepsOpportunity, type MemberRequestFlow,
} from "../../core/src/generated/memberRequest.ts";
import {
  defaultMemberInviteCapacity, memberInviteBurst, memberInviteCanAttribute, memberInviteCanIssue, memberInviteConfirmationReady,
  memberInviteDraftCurrent, memberInviteEvidenceValid, memberInviteHeldLinkReleased, memberInviteLinkCanBeShared, memberInviteNeedsReview, memberInviteSourceCurrent,
  memberInviteUsesAllowance, memberInviteVouchWeak, memberInviteWithinBurstWindow, memberInviteWithinWindow, memberMayRequestInvite,
} from "../../core/src/generated/memberInvitation.ts";
import {
  attendanceBookingReceived, availabilityHistoryLimit, checkInReading, checkInSafetyAnswer, checkInSafetyAnswerApplies, checkInSafetyAnswerCurrent, checkInSafetyStep, chooseCheckIn, confirmationChanges, releaseBookingReply, reportedAbsenceIdentifiesMember, confirmationWindowHours as OPT_OUT_HOURS, countAttendance, counterpartConfirmsAttendance, friendsPlanAttendanceAvailability, meetingFeedbackPrefix,
  deliveredInvitee, feedbackDelayHours, feedbackHistorySeat, initial as initialMeetingSettlement, organizerCanVerify, requestAttendanceSatisfied,
  dayBeforeReminderDue, dayBeforeReminderWindow, dayOfCheckInAnswerCurrent, dayOfCheckInDue, dayOfCheckInWindow, dayOfReplyAccepted, nearMeetingReminderLeadMs, nearMeetingReminderWindow,
  meetingFeedbackCandidate, meetingFeedbackCanSettle, meetingFeedbackReplyAllowed, meetingFeedbackWindow, pairedFeedbackAbsence, restoreAttendance,
  settlementDelayDays, silentConfirmationDue, step as stepMeetingSettlement, type AttendanceMark, verifiedMeetingValueAllowed,
} from "../../core/src/generated/meetingSettlement.ts";
import { numberAsk, relayThreadOpen } from "../../core/src/generated/relayDecision.ts";
import { lateArrivalBookingCurrent, lateArrivalBookingReceiptCurrent, lateArrivalMayDispatch, lateArrivalMayReport, lateArrivalReportTimeCurrent, lateArrivalText } from "../../core/src/generated/groupLateArrival.ts";
import { isLateArrivalAdmitted, isLateArrivalPairBooking, isLateArrivalReport, lateArrivalDeliveryId, type LateArrivalDelivery } from "./group-late-arrival.ts";
import { calendarPreferenceCommand, readCalendarFreeBusy, type CalendarFreeBusyAuthority } from "../../core/src/calendar-free-busy.ts";
import { calendarPreferenceMayApply, calendarSchedulingPurpose } from "../../core/src/generated/calendarFreeBusy.ts";
import { bookedCancellationAllowed, bookedCancellationPrefix, peerContactTypes } from "../../core/src/generated/outboundAdmission.ts";
import { slopFirstIntroductionAt, slopPairContactAllowed } from "../../core/src/generated/datingRadius.ts";
import { bookReplacementPlan, canTryGroupReplacement, mayOfferReviewedAlternate, recoveryPlanCanProceed, replacementAnswerAllowed, viableReplacementSlot } from "../../core/src/generated/bookedGroupReplacement.ts";
import { bookingNoticeRosterCurrent, rescheduleAnswerAfterReceipt, rescheduleBookingSelected, rescheduleDeadline, rescheduleDraftCurrent, rescheduleTimeEligible, rescheduleVote } from "../../core/src/generated/meetingReschedule.ts";
import {
  describeBookingStart, localBookingStart, parseNaturalReschedule, parseRescheduleCommand, rescheduleMemberRef, rescheduleNoticeCurrent, rescheduleOfferKey,
  rescheduleUpdateKey, RESCHEDULE_QUEUE_PREFIX, sameRescheduleRoster, type RescheduleCommand, type RescheduleDraft,
} from "./rescheduling.ts";
import {
  bookedGroupCanContinue, bookedReplyCurrent, closesForBlock, closesForMinor, initial as initialOpportunity, minorCloseTellsAcceptor, recurrenceAllowed, releasesOnRequesterClose, releasesPartialAcceptance, step as stepOpportunity,
  acceptedProbeCanWithdraw, acceptedProbeWithdrawalAllowed, bookedReplyDeclines, unlinkedCancellation, upcomingCancellationEligible, type OpportunityLifecycle, type OpportunityPhase,
} from "../../core/src/generated/opportunityLifecycle.ts";
import { queueRepeat, recentRepeatSource, recordsRepeatConsent } from "../../core/src/generated/repeatEncounter.ts";
import { gatheringRepeatMayAnswer, gatheringRepeatMayBook, gatheringRepeatMayStage, gatheringRepeatOppPrefix, gatheringRepeatSourceMatches } from "../../core/src/generated/gatheringRepeat.ts";
import { gatheringPriorityIsolated, gatheringPriorityNewcomer } from "../../core/src/generated/monthlyGatheringRsvp.ts";
import type { GatheringNoticeKind } from "../../core/src/generated/monthlyGatheringNotices.ts";
import { boundedHelpRoute, openHomeHelpCase } from "../../core/src/generated/boundedHelp.ts";
import { isHomeEntry, riskTerms } from "../../engine/src/filters.ts";
import { bookedNeedsSyntheticAcceptance, bookedOccupies, bookedRecordOccupies, closeUnbookedItems, peonAcceptedHistoryAt, peonFeedbackRetainsAcceptance } from "../../core/src/generated/peonCapacity.ts";
import { hireAnswerAllowed, hireClosedProbeReply, hireContactAllowed, hireProbeWasDeclined, managerQuestionDeadline, managerQuestionMayOpen } from "../../core/src/generated/peonHireDispatch.ts";
import { initial as initialPlanDispatch, pendingPlanInviteDecision, planInvitationOpen, planProbeReplyCurrent, planTurnDue, step as stepPlanDispatch } from "../../core/src/generated/planDispatch.ts";
import { clarifiedProbeTimeReading, lateProbeRoute, probeClarificationMayAsk, probeNeedsExplicitTimeChoice, weakProbeAcknowledgementAllowed } from "../../core/src/generated/probeReply.ts";
import { engineQuestionDeliveryPrefix } from "../../core/src/generated/engineAsks.ts";
import { isPlanAlternate, weeklyCheckinEvidence, weeklyCheckinEvidenceMs } from "../../core/src/generated/planFormation.ts";
import { poolEligible } from "../../core/src/generated/groupFormation.ts";
import { noPairValue } from "../../core/src/generated/pairValue.ts";
import { organizingReachSeatTaken } from "../../core/src/generated/capitalLevers.ts";
import { currentFriendPlanSeatFits, friendsPartnerPlanFits, planBookingConsented } from "../../core/src/generated/planDecision.ts";
import {
  alternateAllowed, canRecordReply, groupMayRemainWithoutAlternate, mayTryAlternate, mayUsePriorIntent, needsOtherTimes,
  needsProbeSend, probeAvailability, probeExpired, probeExpiryDeadline, probeIsInvite, probeQuestionHoldUntil, probeResponseMs,
  agreedToRoster, canRecordProbeSent, groupBackfillKeepsYeses, initial as initialProbe, partnerPlanBackfill, probeTiming, queuedProbeCurrent, reviewProbePreviewCurrent, questionHoldMs, replacementJudged, replacementRoute, shouldLookForOtherTimes, slopProbeReplyCurrent, step as stepProbe, turnReached, type ParticipantProbe,
} from "../../core/src/generated/probeDispatch.ts";
import { reviewLate, reviewRevisionCurrent } from "../../core/src/generated/reviewDeadline.ts";
import { reviewPlanPreviewCurrent } from "../../core/src/generated/staffReview.ts";
import { recipientRefusalReason, recipientTimingAllowed, recipientVerdict } from "../../core/src/generated/recipientEligibility.ts";
import { initialInviteBudgetSpent, initialInviteInBudgetWindow, inviteJoinNoticeConflictsWithRole, inviteJoinNoticeCurrent, inviteJoinNoticeLifetimeMs, inviteJoinNoticeMayRideReply, reengagementDeliveryPrefix, reengagementMayStage, unansweredInviteCountAfterInbound, unansweredInviteCounts, unansweredInvitePause } from "../../core/src/generated/outreachPolicy.ts";
import {
  interruptionAnswerMs, interruptionAskUntilMs, interruptionFeedbackAskDue, interruptionFeedbackCurrent, interruptionFeedbackReply, interruptionFeedbackSample,
  interruptionFeedbackUsesFollowupSlot,
} from "../../core/src/generated/interruptionFeedback.ts";
import { interruptionFeedbackAnswer, interruptionFeedbackCode, interruptionFeedbackKey, interruptionSampleBucket, type InterruptionSurvey } from "./interruption-feedback.ts";
import { emptyIntentFollowupReady, emptyIntentFollowupReasonAllowed } from "../../core/src/generated/emptyIntentFollowup.ts";
import { canSaveCofounderIntent, cofounderIntentDetails, cofounderIntentObjective } from "../../core/src/generated/cofounderIntent.ts";
import { cofounderBoundIntentCurrent, cofounderDeliveryAllowed, cofounderIntentEligible, cofounderPairCurrent } from "../../core/src/generated/cofounderDispatch.ts";
import { closedPublicEventIsUnsent, publicBookedEventLinkAllowed, publicEventMemberAllowsMatch, publicEventRevisionMatches } from "../../core/src/generated/publicEventCatalog.ts";
import { approvedVenueBookingLink, venueBookingLink, venueBookingNoticeBase, venueBookingNoticeKey } from "./venue-booking-link.ts";
import { chooseFriendsPlanWindow, friendsPlanOfferedWindows, friendsPlanProbeDeliveryKey, friendsPlanTimeOptions, parseFriendsPlanTimeReply, validFriendsPlanTimeWindows } from "./friends-plan-time-choice.ts";
import { listedEventMinimumAge } from "../../core/src/public-event-age.ts";
import { publicEventRevision } from "./public-event-revision.ts";
import {
  cachedStandingIntentsCurrent, canQueueEngineOpportunity, knownWantCategory, learnedIntentDays, learnedIntentMayProject,
  standingIntentBlocksLearnedCopy, standingIntentFacetEvidence, standingIntentRecheckDue, standingPresencePhase, standingRenewalAskDue, renewalAskDays, renewalRetryMs,
} from "../../core/src/generated/standingIntent.ts";
import {
  effectiveStandingControl, initial as initialIntentManagement, intentManagementAllowed, recentCloseDays, refusedCommandPasses,
  retireIntentSearch, retireStandingOpportunity, sameStandingWant, standingAddRoute, standingChangeOutcome, standingCloseConfirmed,
  standingListNumberCurrent, standingReplyApplies, step as stepIntentManagement, writesStandingIntentRow,
  type IntentCommandPhase, type IntentControl, type StandingPendingKind as StandingPendingPhase, type StandingSource,
} from "../../core/src/generated/standingIntentManagement.ts";
import { standingIntentDeadline, standingIntentLive, standingIntentPhaseAt } from "../../core/src/standing-intent.ts";
import { standingMayRetain } from "../../core/src/generated/memberStanding.ts";
import { laneCategory } from "@thenetwork/engine/src/match/profile.ts";
import { standingKey } from "@thenetwork/engine/src/match/standing.ts";
import type { Format, MemberStandingRow } from "@thenetwork/engine/src/types.ts";
import { presenceWindowCovers, presenceWindowsOverlap, presenceWindowValid } from "../../core/src/generated/travelPresence.ts";
import { temporaryPresenceWindow } from "../../core/src/travel-presence.ts";
import {
  archivedReportHoldAllowed, carryReportOnAppLeave, caseCloseResult, emergencyCheckInReport, holdAuthority, holdLiftResult, holdSubjectKnown,
  immediateDangerReply, initial as initialCase, minorClearResult, pairBlockCancellationGoesTo, pairOpportunityClosesOnBlock, personMinorSignalOpen, reportAfterDecision,
  reportClarificationTimeCurrent, reportRestrictsMatching, safetyQuestionAcceptsName, safetyQuestionAppliesTarget, safetyQuestionExclusion, safetyQuestionIsCurrent, safetyQuestionResolves, safetyQuestionUsesSoleOffer, safetyReplyAfterExclusion,
  step as stepSafetyCase, teenDoubtClearResult, type CasePhase, type ReportPhase, type StaffActionResult,
} from "../../core/src/generated/safetyCase.ts";
import {
  friendsVerifyPasses, groupAgeAllowed, minorSignalOpens, rosterHasMinor, teenFriendCandidate, teenFriendRole, teenIntroShape, teenPartnerAge, teenPlaceAllowed, teenReady, teenRosterMaximum,
  teenRosterSizeAllowed, type AgeSide,
} from "../../core/src/generated/friendIntroAge.ts";
import { laneOffered, teenFriendApp, teenFriendCategory, teenFriendLane, teenGenerator, teenGroupPlanApp, type MatchLane } from "../../core/src/generated/matchLane.ts";
import { ageOnDay } from "../../core/src/generated/memberAge.ts";
import {
  teenFacetAllowed, teenIntroSwitchAllowed, teenIntrosStoredOn, teenItemContinues, teenMeetingAllowed, teenMeetingMs, teenNearbyWindowMs, teenOpenItemHorizonMs,
} from "../../core/src/generated/teenIntroSwitch.ts";
import {
  canCloseReview, canExpireReview, canHoldUnjudged, canRecordJudgment, canStaffDecide, canStaffReroll, canStopApproved, closeReview,
  contactApproved, expireReview, flaggedPairActive, holdUnjudged, judgeCallDecision, recordJudgment as judgmentStep, reviewRubric, staffDecide,
  staffReroll, stopApproved as stopApprovedStep, verdictAtRecord, type Approver, type AutomatedReview,
} from "../../core/src/generated/automatedReview.ts";
import {
  packetSuspect, REVIEW_JUDGE_REVIEWER, SIM_REVIEW_JUDGE, uncalledJudgment, VERDICT_NAME, VERDICT_OF_NAME,
  type CodeCheck, type InlineReviewJudge, type JudgeReasonCode, type JudgeVerdictName, type ReviewJudgment, type ReviewPacket,
  type ReviewPacketMember, type ReviewPacketProbe,
} from "../../engine/src/reviewJudge.ts";
import { earliestDayKeyOf, latestDayKeyOf } from "../../core/src/birth-date.ts";
import { HELP_TEXT, STOP_CONFIRMATION, type InboundMessage, type NetworkContext, type NetworkUnderTest, type SimMeta } from "@thenetwork/core";
import { sha256, stableStringify } from "@thenetwork/engine/src/hash.ts";
import { bookingWithdrawalAcknowledgmentAllowed } from "../../core/src/generated/replyDuplication.ts";
import { recommendationLocation } from "../../core/src/generated/plansLocation.ts";
import { currentPairAllowed } from "../../core/src/generated/currentPairRestrictions.ts";
import { draftUsesMatchingSlot, newMatchCategoryAllowed, newMatchParticipationAllowed, replacementCanTakeRole, reviewDraftWasUnsent } from "../../core/src/generated/newMatchParticipation.ts";
import { DESIRES, desireById, INTERESTS, skillFirstPerson, SKILLS, type DesireDef } from "@thenetwork/engine/src/packs/network/vocabulary.ts";
import { JOB_INTENT } from "@thenetwork/engine/src/packs/peon/schema.ts";
import { birthdayRecorded, minorNoticeFor, minorScopeNoticeDue, scopeNoticeTurnOpens, soloTeenApp, statedAgeNow, teenBirthDateContradicted, type MinorNotice } from "../../core/src/generated/textEnrollment.ts";
import { ageAnswer, agesStated, availabilityTags, birthDateAnswer, birthDateStated, classify, explicitlyBusyThisWeek, explicitRepeatRequest, extractProfile, extractRedLineTags, feedbackOf, isCompleteParticipationRefusal, isNamedProbeTime, isProbeCounterTime, NOBODY_CAME, consentOf, parseProbeReply, planAgainOf, plansPlaceQuestionFor, plansPlaceQuestionForCity, publicPlanLocation, sentencesOf, statedAge, unclearBirthDateAnswer, type Classified, type TimeOption } from "./classify.ts";
import { mergeConsent, type Understand, type Understood } from "./extract.ts";
import {
  directInviteVouch, inviteReviewContactToken, inviteReviewReference, inviteVouchEvidence, inviteVouchRisk, isMemberInvitationLink,
  type InviteReviewReason, type MemberInviteEvidence, type MemberInviteRequest, type MemberInviteResult,
} from "./invitation.ts";
import { brandOf, copy, copyFor, timezoneLabel, type Copy, whenPhrase } from "./copy.ts";
import {
  confirmBeforeCommitRequired, firstNoShowStrikes, lateCancel24hStrikes, lateCancel4hStrikes,
  reliabilityEffectiveStrikes, reliabilityTier, repeatNoShowStrikes, reportRestrictsMatchingV2,
} from "../../core/src/generated/qualityAndLeague.ts";
import { APPS, type AppId, type AppInfo } from "../../platform/src/apps.ts";
import { lowestAge } from "../../platform/src/age.ts";
import { allNeighborhoods, findCityNeighborhood, meetingSpot, nearbyVenues, NEIGHBORHOOD, NEIGHBORHOODS, neighborhood, travelMinutes, travelMinutesInCity, VENUES, venuesForCity, type Venue } from "./geo.ts";
import { isPanicHaltedState, RelayDesk, withdrawsSwap, type RelayAsk, type RelayCallOptions, type RelayHost, type RelayMatch, type RelayMember, type RelayOutcome, type RelayState } from "./relay.ts";
import { VenueManager, type ExternalVenueProvider, type VenueManagerState } from "./venue-manager.ts";
import { MeetupCoordinator, type MeetupCoordHost, type MeetupCoordState } from "./meetup-coord.ts";
import type { RelayRecord } from "../../engine/src/relay.ts";
import { APPEARANCE_PREFIX, appearanceLeak } from "../../engine/src/packs/slop/appearance.ts";
import { datingFactsOf, datingStatementOf, type DatingFacts } from "../../engine/src/packs/slop/profile.ts";
import { mutuallyOpen } from "../../core/src/generated/mutualOpenness.ts";
import { ASK_KINDS, LANE_BUDGETS, localDateParts, NEVER_REPLY, nextAt, NY, nyParts, OUTREACH, PRD_BUDGETS, SLOT_KINDS, tzForCity, type SendKind } from "./outreach.ts";
import { BASE_REACH, FLOOR_EFFORT, type CapitalEvent, type CapitalEventInput, type CapitalReader, type GamingFlag, type NetworkEffort } from "./capital.ts";
import { activityHints, BOOKING_GAP, PLAN_VENUE_AGES, PLAN_VENUES, planLedger, planVenueAgesForCity, planVenuesForCity, statedWindows } from "./plans.ts";
import {
  canonicalStandingReference, STANDING_COPY, standingIntentReference,
  type AgentStandingResult, type StandingEntry, type StandingIntentCommand, type StandingKind, type StandingStatus, type StandingTurn, type StandingView,
} from "./standing-intents.ts";
export type { AgentStandingResult, StandingView } from "./standing-intents.ts";

import type { NetworkStore } from "./store.ts";
import { HOLD, Trust, type TrustLevel, type TrustState } from "./trust.ts";
import { appTagFacet, type AppHooks, type AppTag, type HookOpp } from "./apphooks.ts";
import { confirmPosting, inboundMayCommand, postingDraftCurrent } from "../../core/src/generated/postingPolicy.ts";
import { isPostingCommand, isSeatId, postingDetailsChanged, postingFromDraft, postingFromFacts, postingProblem, postingReplyQualified, postingRevision, postingsOf, POSTING_COPY, readPostingText, seatIdOf, seatOwnerOf, SEAT_COPY, type JobPosting, type PostingDraft } from "./jobs.ts";
import { hireSeatCurrent, readHireEvidence, type HireSeat } from "./peon-hire-dispatch.ts";
import { inlineEngine, type EngineStep } from "./tick-engine.ts";
import { checkInConcern, checkInReport, checkInSafetyChoice, directFeedbackAbsence, groupFeedbackAbsence, emergencyCheckInReportKind, reportKindOf, statesImmediateDanger, URGENT_REPORTS, type ReportKind, type SafetyReport } from "./reports.ts";

/** A ledger event as the Network builds it: the emitter adds the id and the Clock time. */
type LedgerInput = CapitalEventInput extends infer E ? (E extends CapitalEventInput ? Omit<E, "t"> : never) : never;
type LedgerField = LedgerInput extends infer E ? (E extends LedgerInput ? keyof E : never) : never;
const LEDGER_FIELD_NAMES_MEMBER = {
  type: false, member: true, age: false, vouchedBy: true, with: true, confirmedBy: true, verifiedBy: false, serious: false, reason: false, kind: false,
  planId: false, startsAt: false, counterparts: true, origin: false, publicVenue: false, confirmers: true, helper: true, recipient: true, helpId: false,
  useful: false, organizer: true, recurring: false, attendees: true, label: false, needId: false, items: false, members: true, note: false, state: false,
} as const satisfies Record<LedgerField, boolean>;
const LEDGER_MEMBER_FIELDS: ReadonlySet<string> = new Set(Object.entries(LEDGER_FIELD_NAMES_MEMBER).filter(([, member]) => member).map(([field]) => field));

export interface PendingReportChoice { askedAt: number; targetId: MemberId; kind: ReportKind }

const safetyName = (text: string) => text.normalize("NFKC").toLowerCase()
  .replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");

const COMPLETE_SAFETY_CONTROL = /^(?:(?:yes|yeah|sure|ok(?:ay)?)[\s,!.]+)?(?:yes|yeah|yep|yup|sure(?: thing)?|ok(?:ay)?|correct|no|nope|nah|naw|not (?:right )?now)(?:[\s,]+(?:please|pls|thanks|thank you))?$/;

function safetyReplyConsent(text: string) {
  if (isCompleteParticipationRefusal(text)) return "no";
  const normalized = safetyName(text);
  const complete = COMPLETE_SAFETY_CONTROL.test(normalized) || ACK_ONLY.test(normalized) || directAgreementIdiom(text);
  return complete ? consentOf(text).answer : "unclear";
}

function isSafetyAttributionQualifier(text: string): boolean {
  const words = safetyName(text);
  // A qualifier can finish with a guess about who it was. A hedge in a time choice stays separate.
  const attribution = /(?:^|(?:[,:]? (?:if|whether))?[,:]? )(?:it|that) (was(?:n't)?|(?:could|may|might) have been)\b/.exec(words);
  const qualifier = words.slice(0, attribution?.index ?? words.length);
  if (attribution) {
    const subject = words.slice(attribution.index + attribution[0].length).trim();
    const timeChoice = /^(.+?) (?:that|which) (?:works?|worked|(?:would|could) work)(?: for (?:me|us))?$/.exec(subject);
    if (timeChoice && isNamedProbeTime(timeChoice[1]!)) return false;
  }
  const hedge = attribution === null ? qualifier : qualifier.replace(/^(?:actually|well|sorry)[,:]? /, "");
  const modalGuess = attribution !== null && /^(?:could|may|might) /.test(attribution[1]!) && /^(?:actually|well|sorry)?$/.test(qualifier);
  return modalGuess || /^(?:maybe|perhaps|possibly|probably|i think|i guess|(?:i(?:'m| am) )?(?:not sure|unsure))$/.test(hedge)
    || (attribution !== null && /^(?:(?:i(?:'m| am) )?(?:not certain|uncertain)|i don't know|i (?:could|may|might) be wrong)$/.test(hedge))
    || (text.includes("?") && /^(?:right|correct|wasn't it)$/.test(words));
}

function readSoleSafetyTargetExclusion(text: string, names: readonly (string | undefined)[], competing: boolean) {
  const reply = text.normalize("NFKC").trim().replace(/^(?:no|nope)(?:[,.!?;:]\s*|\s+)/i, "");
  let first = sentencesOf(reply, true)[0]!;
  if (first.text.trimEnd().endsWith(";")) {
    const tail = reply.slice(first.at + first.text.length).trim();
    if (isSafetyAttributionQualifier(sentencesOf(tail, true)[0]!.text)) first = sentencesOf(reply.replaceAll(";", ","), true)[0]!;
  }
  const openingSentence = first.text;
  const opening = openingSentence.split(/[,.!?;:]/, 1)[0]!;
  const clause = safetyName(opening);
  const rejectsName = names.some(name => name && clause === `not ${safetyName(name)}`);
  const replacement = clause.replace(/^(?:it was|i mean|i meant) /, "");
  const openingIsQuestion = openingSentence.includes("?");
  const rejectsWithCorrection = first.at === 0 && !openingIsQuestion && /^it was (?:someone|somebody) else$/.test(safetyName(openingSentence));
  const qualified = consentOf(openingSentence).why === "hedged" || isSafetyAttributionQualifier(openingSentence.slice(opening.length + 1));
  const refersToAnotherPerson = !openingIsQuestion && !qualified && ["someone else", "somebody else"].some(phrase =>
    replacement === phrase || (replacement !== clause && replacement.startsWith(`${phrase} `)));
  const unnamedRejection = refersToAnotherPerson || ["not him", "not her", "not them"].includes(clause);
  return {
    excludes: safetyQuestionExclusion(rejectsName || rejectsWithCorrection, unnamedRejection, competing),
    separateReply: rejectsWithCorrection ? reply.slice(first.at + openingSentence.length).trim() : undefined,
  };
}

const SAFETY_TARGET_PREFIX = /^(?:i (?:mean|meant)|it'?s)\s+/;
const SAFETY_BARE_AFFIRMATION = /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|correct)$/;
const SAFETY_PRONOUN_CONFIRMATION = /^(?:that's )?(?:him|her|them)$/;

function isSafetyConfirmation(text: string): boolean {
  return SAFETY_PRONOUN_CONFIRMATION.test(text) || SAFETY_BARE_AFFIRMATION.test(text);
}

function safetyNameCanRoute(name: string): boolean {
  return !ACK_ONLY.test(name) && !isSafetyConfirmation(name) && !NO_SAFETY_TARGET.test(name)
    && !CANCEL_SAFETY_QUESTION.test(name) && safetyReplyConsent(name) === "unclear";
}

function safetyQuestionReply(text: string) {
  const normalized = text.normalize("NFKC").replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  const refuses = NO_SAFETY_TARGET.test(normalized);
  const cancels = CANCEL_SAFETY_QUESTION.test(normalized);
  const consent = safetyReplyConsent(normalized);
  const confirmation = consent === "yes" || isSafetyConfirmation(safetyName(text));
  const refusal = consent === "no" || refuses;
  const names = safetyReplyNames(text);
  const [, qualified] = names;
  const explicitlyNamed = SAFETY_TARGET_PREFIX.test(safetyName(text)) && !names.some(name => SAFETY_PRONOUN_CONFIRMATION.test(name));
  const qualifiedName = qualified !== undefined && safetyNameCanRoute(qualified);
  const implicitConfirmation = !explicitlyNamed && confirmation && !qualifiedName;
  const implicitRefusal = !explicitlyNamed && refusal;
  const acceptsName = safetyQuestionAcceptsName(implicitConfirmation, implicitRefusal, cancels);
  const compareAlternatives = names.length > 1 && !refusal && !cancels;
  return { names, refuses, cancels, explicitlyNamed, acceptsName, compareAlternatives };
}

function safetyReplyNames(text: string): string[] {
  const literal = safetyName(text).replace(SAFETY_TARGET_PREFIX, "");
  if (!literal) return [];
  if (text.normalize("NFKC").includes("?")) return [literal];
  const qualified = safetyName(literal
    .replace(/^(?:yes|yeah|yep|yup|correct|ok|okay)[,.!\s]+/, "")
    .replace(/[,\s]+(?:please|pls|thanks|thank you)$/, ""));
  // Either reading can be an exact name. Keep both so an ambiguous result cannot file a report.
  return qualified && qualified !== literal ? [literal, qualified] : [literal];
}

interface PendingReportReplyName { name: string; routable: boolean }

export function pendingReportReplyNames(text: string): PendingReportReplyName[] {
  const body = text.trim();
  if (/^(?:block|report)\s/i.test(body)) return [];
  const reply = safetyQuestionReply(body);
  if (!reply.acceptsName && !reply.compareAlternatives) return [];
  const acknowledgement = ACK_ONLY.test(body);
  return reply.names.flatMap(name => {
    const routable = reply.acceptsName && !acknowledgement && safetyNameCanRoute(name);
    // A reserved reply cannot choose the app. An alternate exact name can still make the answer ambiguous.
    return routable || reply.names.length > 1 ? [{ name, routable }] : [];
  });
}

/** Where an opportunity came from. "planner": a plan from the engine planner, or a crew session (Opp.crewId). */
export type Origin = "engine" | "request" | "plans" | "planner" | "second_encounter" | "newcomer_welcome" | "player";

/** Current private authority for one gathering pair. No response contents or share codes. */
export interface GatheringRepeatSource {
  gatheringId: string; revision: number; groupReviewId: string; members: [MemberId, MemberId]; consentVersion: string;
}

export { SIM_REVIEW_JUDGE };
type ReviewApprover = "judge" | "staff";
export interface JudgeWork { packet: ReviewPacket; members: Record<string, MemberId>; packetClean: boolean; priorFlag: boolean }
interface ReviewException { verdict: Exclude<JudgeVerdictName, "approve">; reason: JudgeReasonCode; revision: number; at: number; rubric: "adult" | "minor" }
/**
 * A reviewer's action (PRD 32.8). "edit" changes the explanations or the objective, then approves.
 * "reroll" swaps a participant for the best eligible alternate and keeps the item in the queue.
 */
export type ReviewDecision = "approve" | "reject" | "edit" | "reroll";
/**
 * One item waiting for a reviewer. `kind` "fraud": a gaming flag from the NC ledger (rings, staged
 * meetups, help farming). approve = confirm (a `fraud_confirmed` ledger event), reject = dismiss.
 * Its `proposal` only lists the flagged members; nobody is contacted either way.
 */
export interface ReviewItem {
  oppId: string; proposal: Proposal; origin: Origin | "fraud"; queuedAt: number; deadline: number; rerolls: number;
  /** The review revision the reviewer sees; a staff decision carries it back (ReviewOptions.revision). */
  revision: number;
  kind?: "opportunity" | "fraud";
  fraud?: { flag: GamingFlag["kind"]; members: MemberId[]; evidence: Record<string, number> };
  teen?: { members: TeenReviewMember[] };
  exception?: ReviewException;
}
/** Staff-only facts about the proposed activity and ordered standby seats. */
export interface ReviewPlanPreview {
  opportunityId: string; revision: number; deadline: number;
  activity: string; place: { name: string; area?: string };
  start: number; end: number; probeDeadline: number; quorum: number; maxSeats: number;
  options?: { start: number; end: number }[];
  alternates: MemberId[];
}
export interface ReviewProbeText { memberId: MemberId; text: string | null; fallback?: string; reveal: { text: string; fallback?: string } }
export interface ReviewProbePreview {
  opportunityId: string; revision: number; deadline: number;
  probes: ReviewProbeText[];
  replacements: { alternate: MemberId; replaces: MemberId; probes: ReviewProbeText[] }[];
}
export const REVEAL_PLACE_PLACEHOLDER = "[place chosen at booking]";
export const REVEAL_TIME_PLACEHOLDER = "[time chosen at booking]";
const REVEAL_GOING_PLACEHOLDER = "[the members who say yes]";
export interface FraudItem {
  id: string; flag: GamingFlag; queuedAt: number; deadline: number;
  status: "review" | "confirmed" | "dismissed" | "expired";
  decidedAt?: number; reviewer?: string; note?: string; reason?: string;
}
/** A crew offered after one great plan (>= 3 attendees would do it again); each person opts in. */
export interface CrewOffer { crew: plans.Crew; planId: string; at: number; offered: MemberId[]; yes: MemberId[]; no: MemberId[]; resolved?: boolean }
function crewOfferState(offer: CrewOffer): CrewOfferState {
  return { phase: offer.resolved ? "Resolved" : "Open", offered: offer.offered, yes: offer.yes, no: offer.no };
}
/** What a reviewer or staff action did: ok, or the reason it was refused or invalidated. */
export type ActionResult = { ok: true } | { ok: false; reason: string };
export interface StoredStandingIntentChange {
  id: string;
  memberId: MemberId;
  previousStatus: Intent["status"];
  status: "active" | "paused" | "closed";
}
type StandingPendingKind = Exclude<StandingPendingPhase, "NoStandingPending">;
type StandingCheckReason = "said_not_wanted" | "ended_recently";
interface StandingOwn {
  key: string; ref: string; kind: StandingKind; summary: string; phase: "IntentLive" | "IntentPaused" | "IntentClosed";
  objective: string; desire?: string; storedId?: string; requestId?: string; postingId?: string; title?: string; endsAt: number | null;
}
interface StandingWant { desireId?: string; category?: Classified["category"]; tags: readonly string[] }
const STANDING_SOURCE_LOG = { MemberThread: "thread", MemberAgent: "agent", AssistantProfile: "assistant_profile" } as const satisfies Record<StandingSource, string>;
function standingKindOf(key: string): StandingKind {
  return key.startsWith("learned:") ? "want" : key.startsWith("stored:") ? "intent" : key.startsWith("request:") ? "request" : "posting";
}
export interface ReviewOptions {
  reason?: string; note?: string; reviewer?: string;
  /** Seconds the reviewer spent on the item (a training label; PRD 32.8). */
  secondsSpent?: number;
  /** "edit": new explanation per participant (each is leak-checked for its recipient). */
  explanations?: Record<MemberId, string>;
  /** "edit": a new objective (leak-checked). */
  objective?: string;
  /** "reroll": the participant to swap out. */
  swapOut?: MemberId;
  /**
   * The review revision the reviewer saw (ReviewItem.revision). Another revision is refused as
   * "review_stale". Every staff decision sends it; a caller that reads and decides in one unit of work may omit it.
   */
  revision?: number;
}
export interface TeenReviewMember { memberId: MemberId; age: number; maxAge: number }
/** One step of a safety case. Never the member's words: only what happened and the points. */
export interface SafetyCaseEvent { at: number; kind: string; points: number; by?: MemberId }
/** Trust events about one member, grouped for staff (PRD 32.14). */
export interface SafetyCase {
  id: string; memberId: MemberId; opened: number; level: TrustLevel; events: SafetyCaseEvent[];
  status: "open" | "held" | "lifted" | "closed";
  closedAt?: number; closedBy?: string;
}
const CASE_PHASE = { open: "CaseOpen", held: "CaseHeld", lifted: "CaseLifted", closed: "CaseClosed" } as const;
const CASE_STATUS = { CaseOpen: "open", CaseHeld: "held", CaseLifted: "lifted", CaseClosed: "closed", NoCase: "open" } as const satisfies Record<CasePhase, SafetyCase["status"]>;
const REPORT_PHASE = { open: "ReportOpen", held: "ReportHeld", banned: "ReportBanned", dismissed: "ReportDismissed" } as const;

const READ_ONLY_METHODS = new Set<string | symbol>([
  "matchingEnabled", "reviewQueue", "safetyCases", "safetyReports", "memberList", "exportState",
  "snapshotCached", "knownProfiles", "engineInput", "packInput", "rescheduleReplyCurrent",
  "approvedPublicEventLink", "approvedBookingLink", "densityTierFor", "canTriggerExternalSourcingFor",
  "evaluateExternalEventPublish", "evaluateExternalEventQuorum", "reportRestrictionsForLeave",
  "stripNames", "findByName", "stats", "openOpps", "recentRequests", "standingFor", "standingEntries",
  "teenIntrosEnabled", "teenState", "relayState", "auditLog", "pendingCounts", "checkRecipient",
]);

const VENUE_SWAP_INTENT_RX = /\b(?:different (?:place|spot|venue|cafe|bar|restaurant)|another (?:place|spot|venue|cafe)|too (?:loud|noisy|far|expensive|pricey|crowded)|rather not (?:go to )?a bar|don'?t drink|no bars?|somewhere (?:quieter|closer|cheaper)|swap (?:the )?(?:venue|spot|place)|change (?:the )?(?:venue|spot|place))\b/i;
const CANCEL_INTENT_OVERRIDE_RX = /\b(?:can'?t make it|cannot make it|cancel|bail|call it off|not coming|won'?t make it)\b/i;

function pendingReportHold(
  reports: NetworkState["reports"],
  id: MemberId,
  reporterHeld?: (reporterId: MemberId) => boolean,
): boolean {
  const openOrHeld = (reports ?? []).filter(r => r.subjectId === id && (r.status === "open" || r.status === "held"));
  if (!openOrHeld.length) return false;
  const distinctCleanReporters = new Set(
    openOrHeld.filter(r => URGENT_REPORTS.has(r.kind) && !reporterHeld?.(r.reporterId)).map(r => r.reporterId),
  ).size;
  return openOrHeld.some(r => {
    const urgent = URGENT_REPORTS.has(r.kind);
    if (!reportRestrictsMatching(REPORT_PHASE[r.status], r.met, urgent)) return false;
    const isReporterHeld = reporterHeld ? reporterHeld(r.reporterId) : false;
    return reportRestrictsMatchingV2(urgent, r.met, isReporterHeld, distinctCleanReporters, false);
  });
}
const REPORT_STATUS = { ReportOpen: "open", ReportHeld: "held", ReportBanned: "banned", ReportDismissed: "dismissed" } as const satisfies Record<ReportPhase, SafetyReport["status"]>;
const SAFETY_REFUSAL = {
  ActorRequired: "actor_required", NotOnHold: "not_on_hold", UnknownCase: "unknown_case", AlreadyClosed: "already_closed",
  UnknownReport: "unknown_report", UnknownMember: "unknown_member", NoMinorSignal: "no_signal", AgeUnknown: "age_unknown",
  RecordMinor: "record_minor", StatedMinor: "stated_minor", TeenBarred: "teen_barred", TeenOlderReported: "teen_older_reported",
} as const satisfies Record<Exclude<StaffActionResult, "AllowedAction">, string>;
const REVIEW_DECISIONS = new Set<string>(["approve", "reject", "edit", "reroll"]);
const LEGACY_SIM_REVIEWER = "sim_auto_reviewer";

/** Result of a send-time check on a recipient (same shape as the Blooio queue's RecipientCheck). */
export type RecipientCheck = { ok: true } | { ok: false; reason: string };

export interface NetworkOptions {
  /**
   * The app this Network serves (packages/platform apps.ts, default "ntwrk"). It sets the brand words
   * in member-facing copy and the join age (a stated or record age under the app's minJoinAge is
   * declined kindly and nothing is kept). Matching stays 18+ in every app.
   */
  app?: AppId | AppInfo;
  /**
   * The city of this network ('<app>:<city>', default "nyc"). Two networks of one app share the
   * id tables, so the ids of every city but nyc carry the city ("ntwrk.sf.nw-1-1").
   */
  city?: string;
  seed?: number;
  /** Consent-first probes (default true). false = reveal straight away (the push baseline). */
  probes?: boolean;
  /** Gate engine output on trust/knowledge/evidence (default true). */
  selective?: boolean;
  /** Most new engine opportunities started per day (default 20). */
  maxNewPerDay?: number;
  /** Minimum engine score for a proposal to be considered (default 0; the engine's own thresholds apply). */
  minScore?: number;
  /** Minimum known interest/skill facets (or one active intent) per participant (default 2). */
  minKnowledge?: number;
  /** Minimum known-want fit (knownWantMet) for every participant (default 0.8). */
  minWantMet?: number;
  /** Minimum share of our asks a member answers to be put into an opportunity (default 0.6). */
  minResponsiveness?: number;
  /** Local hour of the nightly engine run (default 9). */
  runHour?: number;
  /** Engine config overrides. */
  engine?: EngineConfigInput;
  /** Growth asks after good experiences (default true). */
  growth?: boolean;
  /** Invites per member per 30 days (default 3). */
  invitesPerMonth?: number;
  /** Stage a member's shareable invite with the current service transaction. Never contacts the invitee. */
  issueMemberInvite?: (input: MemberInviteRequest) => MemberInviteResult | undefined;
  /** Confirm this is the inviter's exact signed turn before opening, changing or confirming a draft. */
  memberInviteTurnAllowed?: (memberId: MemberId, messageId: string) => boolean;
  /** Only the exact signed member turn can request a group logistics relay. */
  lateArrivalTurnAllowed?: (memberId: MemberId, messageId: string) => boolean;
  /** Current, purpose-scoped calendar grant and anonymous observation from a trusted preloaded view. */
  calendarFreeBusy?: CalendarFreeBusyAuthority;
  /** Mark the input for private invitation retention in the current service transaction. */
  onPrivateInviteTurn?: (memberId: MemberId, messageId: string) => void;
  /** Private intake instructions for a current signed home-entry request. */
  homeHelpIntakePrompt?: (memberId: MemberId) => string | undefined;
  /** Growth asks per day across the network (default 8). */
  maxGrowthAsksPerDay?: number;
  /** Open a quiet standing request for a specific want named during onboarding (default false). */
  onboardingRequests?: boolean;
  inlineJudge?: InlineReviewJudge;
  judgeReviewer?: string;
  /** Review SLA in hours (default 12; same-day opportunities get 1 hour). A queued item past it expires unsent. */
  reviewSlaHours?: number;
  /** Called with every engine run (observatory capture). */
  onEngineRun?: (log: MatchingRunLog, proposals: EngineProposal[], at: number) => void;
  /**
   * Proactive matching in NYC (default true). Off: no engine run and no new opportunities the
   * Network composes; requests are acknowledged and wait. Items already approved continue.
   */
  matchingEnabled?: boolean;
  /** Where runTick() and runStored() load and save the Network's state (store.ts). */
  store?: NetworkStore;
  /**
   * Network capital: every ledger event (packages/capital CapitalEvent) goes to this one typed
   * emitter, with a unique id and the Clock time, in time order. Optional: nothing changes without it.
   */
  onLedger?: (e: CapitalEvent) => void;
  /**
   * The NC levers, read at run time: vouch capacity at invite time, organizing reach for crew
   * sessions, the per-member effort overlay, and gaming flags for the review queue. Optional:
   * without it the Network uses the floor (3 invites per 30 days, reach 8, research depth 3,
   * re-search every 3 days, 3 plan options) and queues no fraud items.
   */
  capital?: CapitalReader;
  /** The planner and the plan lane (plans v1.1, default true). */
  plans?: boolean;
  /** Plans config overrides (engine DEFAULT_PLANS, plans-v1.1.0). */
  plansConfig?: PlansConfigInput;
  /**
   * The LLM reader of member texts (extract.ts llmUnderstand on defaultLLM(), gpt-6-luna). Optional:
   * without it, and whenever it fails, the Network reads texts with the offline rules alone.
   */
  understand?: Understand;
  /** Optional email lookup for warm double-opt-in work introductions. */
  workIntroEmailOf?: (id: MemberId) => string | undefined;
  /** Optional external venue discovery provider (only called when < 10 local venues qualify). */
  venueProvider?: ExternalVenueProvider;
  /** Send proactive T-75m arrival briefs before scheduled meetings (default: false for NYC to preserve pinned baselines, true for other launch cities). */
  arrivalBriefs?: boolean;
  /**
   * Called with every age a member states about themselves in chat, and when the Network declines a
   * member under the join age. The platform writes it to people.lowest_age, so every app sees the
   * lowest age (network-consent-12). `declined`: the member was declined and forgotten here.
   */
  onAgeStated?: (memberId: MemberId, age: number, o: { explicit: boolean; declined: boolean; birthDate?: number }) => void;
  onMinorSignal?: (memberId: MemberId) => void;
  onTeenBar?: (memberId: MemberId, reason: "older_than_stated") => void;
  onTeenPairAvoid?: (pairs: [MemberId, MemberId][]) => void;
  /**
   * The engine's judge LLM (pass 2). Without it the judge is off in this Network's engine runs, and
   * effectiveEngineConfig() says so (matching-e2e-M2): no run claims a judge it did not run.
   */
  engineLLM?: LLM;
  /** The engine's app pack (default networkPack; slop passes slopPack). */
  pack?: AppPack;
  /** What the app's pack adds to the consent flow (apphooks.ts; packages/network/service/packs.ts). Default: none. */
  hooks?: AppHooks;
  /**
   * The categories this app may start opportunities in (matching-e2e-2). Default per app:
   * ALLOWED_CATEGORIES. Nothing outside it is ever proposed, requested or composed.
   */
  allowedCategories?: readonly Category[];
  /**
   * peon (#9): a job posting a hiring manager confirmed by text, or staff saved (applyPosting). The
   * service writes its rows (intent and facets) in the same transaction as the state (runtime.ts);
   * the next snapshot makes it a job seat. Without it, a confirmed post is logged and not kept.
   */
  onPosting?: (p: JobPosting) => void;
  /** Optional hydrated venue pool, member visit/rejection history, and cross-app concurrent headcounts (zero SQL in core). */
  venues?: readonly VenueRecord[];
  memberVenueHistory?: ReadonlyMap<MemberId, MemberVenueHistory>;
  concurrentHeadcountByVenue?: Record<string, number>;
}

export interface MemberVenueHistory {
  visited: readonly string[];
  rejected: readonly string[];
}

export interface VenueRuntimeContext {
  venues?: readonly VenueRecord[];
  memberVenueHistory?: ReadonlyMap<MemberId, MemberVenueHistory>;
  concurrentHeadcountByVenue?: Record<string, number>;
}

const SHORT_CIRCUIT_AWAITING = new Set(["probe", "checkin", "booked", "confirmation", "gathering"]);
const BARE_YES_NO_RE = /^(?:yes|yeah|yep|yup|ya|sure|definitely|absolutely|bet|for sure|works|works for me|sounds good|all good|both work|either|none of those|down|i'?m down|i'?m in|im in|count me in|no|nope|nah|pass|can'?t|not this time|no thanks|s[ií]|claro|dale|vale|no puedo)[.!?]*$/i;
const BARE_OPTION_KEYS_RE = /^(?:(?:option\s+)?[a-d](?:\s*(?:,|or|and|\/|&)\s*(?:option\s+)?[a-d])*)[.!?]*$/i;
const EXTRA_CLAUSE_RE = /[;\n]|\b(?:but|also|actually|except|though|however|because|moved|live|living|sober|halal|kosher|allerg|years?\s+old)\b/i;
const BARE_SURVEY_YES_NO_RE = /^(?:yes|yeah|yep|yup|no|nope|nah)[.!?]*$/i;

export function classifyVenueRejection(body: string): VenueRejectionReason {
  const t = body.trim().toLowerCase();
  if (/\b(?:sober|alcohol|bar|brewery|wine|halal|kosher|allerg|peanut|shellfish|gluten|celiac|wheelchair|stairs|smoke|smoking|too dark|unsafe|daytime)\b/.test(t)) return "red_line";
  if (/\b(?:already been|been there|went there|just went|go there all the time|too familiar)\b/.test(t)) return "already_been";
  if (/\b(?:too far|far|commute|train|subway|drive|closer|neighborhood|other side|across town)\b/.test(t)) return "too_far";
  if (/\b(?:price|pricey|expensive|cheaper|budget|cost|spend|fancy)\b/.test(t)) return "price";
  if (/\b(?:time|earlier|later|busy|can'?t make|reschedule|another day|wrong day)\b/.test(t)) return "bad_time";
  if (/\b(?:loud|noisy|quiet|vibe|crowded|packed|chill|cozy|coffee|tea|casual|bar-y|stuffy)\b/.test(t)) return "wrong_vibe";
  return "bare_no";
}

function bookedVenueObjection(body: string, yn: string): VenueRejectionReason | undefined {
  const reason = classifyVenueRejection(body);
  if (reason === "bare_no" || reason === "bad_time") return undefined;
  const t = body.trim().toLowerCase();
  const hasObjectionCue = yn === "no" || /\b(?:not|no|don'?t|do not|can'?t|cannot|won'?t|avoid|instead|somewhere|other|rather|prefer|skip|switch|change|too|quieter|closer|cheaper|different|less|more|hate|dislike)\b/.test(t);
  if (reason === "red_line") return extractRedLineTags(body).length > 0 || hasObjectionCue ? "red_line" : undefined;
  if (reason === "already_been") return yn === "yes" && !hasObjectionCue ? undefined : "already_been";
  if (reason === "too_far") return /\b(?:too far|way too far|closer|other side|across town|long commute|long trip|somewhere closer|different (?:area|neighborhood|spot|place)|far from)\b/.test(t) || (hasObjectionCue && /\bfar\b/.test(t)) ? "too_far" : undefined;
  if (reason === "price") return /\b(?:too pricey|pricey|too expensive|expensive|cheaper|less expensive|overpriced|budget|too fancy|cost too much|can'?t afford|more affordable|lower budget)\b/.test(t) ? "price" : undefined;
  if (reason === "wrong_vibe") return /\b(?:too loud|too noisy|quieter|somewhere quiet|more quiet|not feeling|too crowded|too packed|more chill|more casual|cozier|different vibe|wrong vibe|not a bar|coffee instead|tea instead|instead of a bar|rather do|prefer|too stuffy|bar-y|somewhere else)\b/.test(t) ? "wrong_vibe" : undefined;
  return undefined;
}

/**
 * Categories per app (matching-e2e-2). slop is dating only; friends is friendship and hobbies (no events category: its plans are social); peon
 * is work; ntwrk is everything but romance (dating lives on slop). Apps not listed use ntwrk's.
 */
export const ALLOWED_CATEGORIES: Readonly<Record<string, readonly Category[]>> = {
  ntwrk: ["social", "professional", "hobby", "help", "events", "growth"],
  slop: ["romance"],
  friends: ["social", "hobby"],
  peon: ["professional"],
};

type PendingAsk = { kind: SendKind; at: number; opportunityId?: string; deliveryId?: string; acceptedAt?: number; expiredAt?: number };
type PendingWho = { verb: "block" | "report"; kind: ReportKind; at: number; targets?: MemberId[] };
type PendingCheckInSafety = { verb: "check_in"; kind: ReportKind; at: number; targets: [MemberId]; oppId: string };

interface MemberState {
  /** `area`: the neighborhood the member said (or the record says). Undefined when unknown: never a default (matching-e2e-1). */
  id: MemberId; first: string; display: string; area?: string; quietHours: [number, number];
  /** They said where they live, but not as a neighborhood the Network knows. */
  areaUnknown?: boolean;
  /** Another member reported them as under 18 (network-consent-9): out of matching until staff clear it. */
  minorReported?: boolean;
  minorClearedAt?: number;
  olderReported?: true;
  statedAgeDay?: number;
  minorScopeToldAt?: number;
  state: string;
  /** Age from the member record (attested at join) and the youngest age they stated in a message. */
  age?: number; statedAge?: number;
  /** A stated age under 13 contradicted a valid attested age: treated as a minor, logged for staff. */
  ageConflict?: boolean;
  /** No valid age on the record and none stated yet: treated as a minor until they tell us (6.3). */
  ageUnknown?: boolean;
  minor: boolean; minorSignal: boolean; stage: "new" | "age" | "q1" | "q2" | "q3" | "active";
  optedOut: boolean;
  /** The member record's account status when staff paused or restricted the account: never matched, only replies and safety notices. */
  account?: "paused" | "restricted";
  /** Initial invites (and the re-engagement) sent since the member last wrote to us. */
  pendingAsks: PendingAsk[];
  interruptionSurvey?: InterruptionSurvey;
  /** Of those, how many reached terminal expiry or waited at least 72 hours after delivery. */
  unanswered: number;
  /** Every outbound message since the member last wrote to us (the Blooio streak, attention 1.9). */
  outbound?: number;
  /** When the open ask (profiling, growth, weekly check-in) was sent; cleared by any inbound (one-question rule). */
  openAskAt?: number;
  /** Timestamps of the member's own messages (answers to the Network), for the learned send time. */
  replies?: number[];
  /** Times the member picked, attended, or turned down as "can't then" (availability evidence, decision 4e). */
  availHistory?: { at: number; outcome: "accepted" | "attended" | "declined_time" }[];
  /** Stated availability ("Tue and Thu evenings") as availability-pattern tags, and when it was said. */
  availability?: { tags: string[]; at: number }[];
  /** The one-time calendar and weekly check-in offer was made (in the first booked plan). */
  offerMade?: boolean;
  /** The member opted in to using authorized free/busy for scheduling in this app. */
  calendar?: boolean; calendarChoiceAt?: number;
  /** Opted in to the weekly "what's your week like?" check-in (decision 4d), and when it was last sent. */
  weekly?: boolean; lastCheckinAt?: number;
  /** "Only when I ask" (F28): no proactive messages until the member writes again. */
  onlyWhenAsked: boolean;
  /** The one re-engagement after 30 days of silence was staged (reset by an inbound message). */
  reengaged: boolean;
  /** An acknowledgement waiting to be folded into the next message. */
  pendingAck?: { text: string; at: number };
  /** Last time an engine run held a top-quartile item for this member while they were paused (D6). */
  heldHighAt?: number;
  /** When each initial invite went out (the cap counts these, founder decision 3). */
  proactive: number[]; lastInbound: number; lastAskAt: number; joinedAt: number;
  /** What the member's next message probably answers. `ask` names an engine question (EngineResult.asks). */
  awaiting?: {
    kind: "probe" | "booked" | "feedback" | "growth" | "interview" | "age" | "checkin" | "crew" | "posting";
    oppId?: string; ask?: AskRecord; at: number; crewId?: string; clarified?: boolean; timeChoice?: boolean;
    probeReceiptId?: string; probeInboundCount?: number; crewOfferReceiptId?: string; engineQuestionDeliveryId?: string;
    bookedCheckIn?: { meetingAt: number; revision: number };
    counterBody?: string;
  };
  endedProbe?: { oppId: string; sentAt: number; endedAt: number; receiptKey: string; receiptId?: string; plan?: boolean; told: boolean; voided?: boolean };
  pendingSafety?: PendingWho | PendingCheckInSafety;
  invitedBy?: MemberId; invites: number[]; invitesBlockedUntil: number; lastGrowthAsk: number;
  pendingInviteDraft?: MemberInviteDraft;
  pendingInviteJoins?: InviteJoinNotice[];
  /** What the member told us. Desires carry when they were stated: they expire and can be withdrawn. */
  learned: { interests: Set<string>; skills: Set<string>; desires: Map<string, number>; redLines?: Set<string>; area?: string; eveningsOpen?: boolean; groups?: boolean };
  intentControls?: Record<string, IntentControl>;
  standingClosed?: Record<string, number>;
  standingPending?: { kind: StandingPendingKind; keys: string[]; at: number; introNamed?: boolean };
  standingList?: { keys: string[]; at: number };
  agentStandingChanges?: number[];
  renewalAsked?: Record<string, number>;
  renewalRefusedAt?: Record<string, number>;
  assistantProfileCheck?: { at: number; items: { key: string; reason: StandingCheckReason }[] };
  /** Latest statement time for which this member already received a committed empty-intent notice. */
  emptyIntentNotices?: Record<string, number>;
  noShows: number; completedSinceNoShow: number; msgsIn: number;
  /** Pass-4 rolling reliability strikes and vampire/pitch-slap telemetry. */
  strikes?: number;
  lateCancels4h?: number;
  lateCancels24h?: number;
  rescheduleChurn?: number;
  provisionalNoShow?: boolean;
  pitchSignals?: number[];
  selfPromoReports?: { from: MemberId; at: number }[];
  /** Probes/questions/invitations we sent that wanted an answer, and how many got one. */
  asked: number; answered: number;
  /** Venues suggested to this member (venue id -> when), so a repeat ask gets new ideas or nothing. */
  suggested: Map<string, number>;
  /** The last text sent to this member (the duplicate check in send()). */
  lastSent?: { body: string; at: number; consentProbe?: string | null };
  /** The last accepted neutral booking withdrawal reply, regardless of intervening messages. */
  bookingWithdrawalAckAt?: number;
  /** Standing availability said at onboarding ("weekends, mostly"): availability tags that do not expire (plans ask 1). */
  standing?: { tags: string[]; at: number };
  /** This week's stated windows from the weekly check-in answer, and the activities named in it. */
  stated?: plans.StatedWindows; hints?: string[];
  /** When each plan invite went out (the plan allowance's own ledger; never on the intro cap). */
  planInvites?: number[];
  /** The New York day of the last plan invite (at most one a day). */
  planDay?: string;
  /** A short note folded into the next message ("That plan didn't come together this time."), never sent alone. */
  note?: { text: string; at: number };
  /** Ledger events already emitted once for this member (member_joined, member_activated). */
  joinedLedger?: boolean; activated?: boolean;
  /** Profile tags the app's onboarding loop learned from what the member said (AppHooks.onboarding): engine facets, never shown. */
  appTags?: AppTag[];
  /** The app's onboarding state (AppHooks.onboarding), plain JSON the Network never reads inside. */
  onboarding?: unknown;
  /** peon: a job post (or a close) read back to the manager and waiting for their yes (jobs.ts). */
  posting?: PostingDraft;
  /**
   * Unsolicited sends (PRD 32.9, PH-003, F28): anything that is not a reply within 15 minutes, a
   * follow-up to the member's own ask, or part of an opportunity they said yes to. Times per lane
   * ("state", "plan", "check_in"), how many went out in a row with no answer, and whether the last
   * send was one. `askAt`/`askUsed`: the member's own last ask and the follow-ups used on it.
   */
  unsol?: Record<string, number[]>; unsolStreak?: number; lastOutUnsol?: boolean; askAt?: number; askUsed?: number;
}

/** The PRD 32.9 reply window: a send this soon after the member's own message (at most 3 of them) is a reply. */
const REPLY_WINDOW_MS = 15 * MINUTE;
const REPLY_BURST = 3;
/** A member's own ask may get up to 2 follow-ups within 48 hours (requestAck, "found someone", "none yet"). */
const ASK_FOLLOWUPS = 2;
const ASK_WINDOW_MS = 48 * HOUR;
/** One-word replies that are never a friend's first name. */
const NOT_A_NAME = /^(?:yes|yeah|yep|yup|no|nope|nah|sure|ok|okay|maybe|thanks|thank|thx|cool|nice|great|hi|hey|hello|lol|sorry|nobody|none|later|done|perfect|awesome)$/i;
/** How long a probe waits for the answer to an open ask before it goes out anyway. */
/** A member's message that asks for something (their follow-ups are not unsolicited). */
const MEMBER_ASK = /\?|\b(looking for|i'?d (really )?(like|love)|i want|i need|can you|could you|help me|find me|anything (come|came) up|still hoping)\b/i;
/** A later check-in report is about someone: a pronoun or the date (lateCheckInReport). "My boss was rude" is not. */
const ABOUT_SOMEONE = /\b(he|she|they|him|her|them|his|hers|their|my date|the date|our date)\b/i;
/** A bare acknowledgement ("thx", "ok") answers logistics, not an earlier unsolicited message. */
const ACK_ONLY = /^(?:ok(?:ay)?|k|kk|thx|thanks?(?: you)?|ty|cool|great|nice|perfect|got it|sounds good|will do|see you(?: then| there)?|yep|yup|sure|[\s.!,:;)(-]|\p{Extended_Pictographic})+$/iu;

const BOOKING_CANCEL = /^(?:please )?(?:cancel|call off) (?:my|the|this|our) (?:meeting|date|plan|booking)(?: on (\d{4}-\d{2}-\d{2}) at ((?:[01]\d|2[0-3]):[0-5]\d))?(?: please)?[.!]?$/i;
const EXACT_ATTENDANCE_CANCEL = /^(?:sorry[, ]+)?(?:i )?(?:can'?t|cannot|won'?t be able to) (?:make it to|attend) (?:my|the|this|our) (?:meeting|date|plan|booking) on (\d{4}-\d{2}-\d{2}) at ((?:[01]\d|2[0-3]):[0-5]\d)(?: anymore)?(?:, sorry)?[.!]?$/i;
const STANDALONE_CANCEL = /^(?:sorry[, ]+)?(?:i )?(?:(?:need|have) to (?:cancel|call it off)|(?:can'?t|cannot|won'?t be able to) (?:make it|come)(?: anymore)?|have to bail)(?:, sorry)?[.!]?$/i;
const ATTENDANCE_DAY_CANCEL = /^(?:sorry[, ]+)?(?:i )?(?:cancel|(?:can'?t|cannot|won'?t be able to) (?:make it|make|come|attend)(?: to [^.?!;,]{1,80} on)?)\s+(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: anymore)?(?:, sorry)?[.!]?$/i;
const QUALIFIED_ATTENDANCE = /^(?:sorry[, ]+)?(?:i )?(?:can'?t|cannot|won'?t|will not)\b[^.;!?]*\b(?:if|unless|assuming|in case)\b/i;
const KEEP_BOOKING = /^(?:please )?(?:(?:i|we) (?:don'?t|do not) need to|(?:there(?: is|'s) )?no need to|(?:don'?t|do not)) (?:cancel|call off|call it off)\b[^.;!?]*(?:[.!]*)$/i;
type BookingCancellation = { localStart?: string; day?: string; needsExactStart?: boolean };

export function explicitBookingCancellation(text: string): BookingCancellation | undefined {
  const command = text.trim().replace(/[‘’ʼ`´]/g, "'").replace(/\s+/g, " ");
  const booking = BOOKING_CANCEL.exec(command) ?? EXACT_ATTENDANCE_CANCEL.exec(command);
  if (booking) return booking[1] ? { localStart: `${booking[1]} ${booking[2]}` } : {};
  const namedDay = ATTENDANCE_DAY_CANCEL.exec(command);
  if (namedDay) return /\bto .+ on\s+/i.test(command) ? { needsExactStart: true } : { day: namedDay[1]!.toLowerCase() };
  return STANDALONE_CANCEL.test(command) ? {} : undefined;
}

/** The local civil date named by the member at receipt. A bare weekday is its next occurrence. */
function bookingCancellationDay(timeWord: string, receivedAt: number, tz = NY): string {
  const { day, weekday } = localDateParts(receivedAt, tz);
  if (timeWord === "today" || timeWord === "tonight") return day;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const desired = weekdays.findIndex(label => label.toLowerCase() === timeWord.slice(0, 3));
  const offset = timeWord === "tomorrow" ? 1 : (desired - weekdays.indexOf(weekday) + 7) % 7;
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
}

const ATTENDANCE_CLAUSE = /^(?:sorry[,]?\s+)?(?:(?:i\s+)?(?:can'?t|cannot|won'?t|will not)\s+(?:make it|come|attend)|(?:i'?m\s+|i am\s+)?not\s+(?:coming|attending|comfortable meeting)|i\s+(?:need|have)\s+to\s+(?:cancel|call it off))(?:\s+anymore)?[.,!]*$/i;
const ATTENDANCE_JOIN = /[.!;]+|[,—–]|\s+-\s+|\b(?:but|and)\b/gi;
const NO_SWAP_OR_MEETING = /^(?:please[,]?\s+)?(?:i\s+(?:do not|don'?t)\s+want to|i'?m\s+not)\b[^.!?;]+\b(?:or|nor)\s+meet(?:ing)?\s+(?:you|them)\b[.!]*$/i;

function declinesAttendanceAlongsideSwap(body: string): boolean {
  const text = body.toLowerCase().replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"');
  if (NO_SWAP_OR_MEETING.test(text) && !/["“”]/.test(text)) return true;
  const boundaries = [...text.matchAll(ATTENDANCE_JOIN)];
  let start = 0;
  for (const end of boundaries) {
    if (!quoteStillOpen(text.slice(0, start)) && ATTENDANCE_CLAUSE.test(text.slice(start, end.index).trim())) return true;
    start = end.index + end[0].length;
  }
  return !quoteStillOpen(text.slice(0, start)) && ATTENDANCE_CLAUSE.test(text.slice(start).trim());
}

/** The source text for a booked reply, with independent transfer and attendance evidence. */
export function bookedReplyKeepsMeeting(body: string): boolean {
  const text = body.trim().replace(/[‘’ʼ`´]/g, "'");
  return KEEP_BOOKING.test(text) || QUALIFIED_ATTENDANCE.test(text);
}

export function bookedTextDeclines(body: string, ordinaryDecline: boolean): boolean {
  const swapWithdrawal = withdrawsSwap(body);
  return bookedReplyDeclines(ordinaryDecline, swapWithdrawal,
    swapWithdrawal && declinesAttendanceAlongsideSwap(body), bookedReplyKeepsMeeting(body));
}

const VENUE_TARGET = /\b(?:somewhere (?:else|closer)|someplace (?:else|closer)|another (?:place|spot|venue|location)|different (?:place|spot|venue|location)|other (?:place|spot|venue|location))\b/i;
const VENUE_JOINT = /\b(?:can|could|shall|should|will|would) we\b|\blet'?s\b|\bwe (?:could|can|should|might)\b|\bi'?d rather (?:meet|go)\b|\bi (?:want|would like|need) to (?:meet|go|move|switch|change)\b/i;
const VENUE_REFUSAL = /\b(?:cancel (?:it|this|the meeting|our meeting)|call (?:it|this) off|i'?m out|i am out|count me out|won'?t be there|will not be there|not coming|can'?t (?:make it|come|attend)|cannot (?:make it|come|attend)|without me|someone else|somebody else|rather not meet|don'?t want to meet|do not want to meet)\b/i;
const VENUE_ATTENDANCE_REFUSAL = /\bnot interested\b(?!\s+in\b)|\bnot happening\b(?!\s+(?:at|in|there)\b)|\bi'?m done\b|\bi am done\b|\bnot meeting\b|\bfor yourself\b|\bby yourself\b|\bon your own\b|(?:^|[.!?]\s*)(?:nah|no thanks|no|nope)[.!](?:\s|$)/i;

function jointVenueRequest(body: string): boolean {
  return body.split(/(?<=[.!?])\s+/).some(sentence =>
    VENUE_TARGET.test(sentence) && (VENUE_JOINT.test(sentence) || (/\?\s*$/.test(sentence.trim()) && /\b(?:meet|move|switch|change)\b/i.test(sentence))));
}

export function declinesBookedAttendance(body: string): boolean {
  return declinesAttendanceAlongsideSwap(body) || VENUE_REFUSAL.test(body) || VENUE_ATTENDANCE_REFUSAL.test(body);
}

export function venueChangeKeepsBooking(body: string): boolean {
  return jointVenueRequest(body) && !declinesBookedAttendance(body);
}

const PHASE_BY_STAGE = { review: "InReview", probing: "Probing", scheduled: "Scheduled", done: "Done", closed: "Closed" } as const;
const STAGE_BY_PHASE = { InReview: "review", Probing: "probing", Scheduled: "scheduled", Done: "done", Closed: "closed" } as const satisfies Record<OpportunityPhase, keyof typeof PHASE_BY_STAGE>;

function opportunityLifecycle(o: Opp): OpportunityLifecycle {
  // Older snapshots encode a successful review in the stage even when review metadata is absent.
  const phase = PHASE_BY_STAGE[o.stage];
  return { phase, approved: o.stage === "probing" || o.stage === "scheduled" || o.stage === "done" ||
    reviewApproved(o.review) };
}

// spec/reviewDeadline.md, "A decision applies only to the revision the reviewer saw"
/** The review revision: the re-rolls that kept the opportunity in review (a re-roll that closes it ends review). */
function reviewRevision(o: Pick<Opp, "review">): number { return o.review?.rerolls?.length ?? 0; }

export type StoredReview = NonNullable<Opp["review"]>;

function reviewApproverOf(review: StoredReview): Approver {
  if (review.approver === "judge") return "JudgeApprover";
  if (review.approver === "staff") return "StaffApprover";
  return review.approver === undefined && !!review.reviewer?.trim() && review.reviewer !== LEGACY_SIM_REVIEWER ? "StaffApprover" : "NoApprover";
}

export function reviewApproved(review: StoredReview | undefined): boolean {
  if (!review) return false;
  const approvedNow = review.decision === "approve" && !review.invalidated && !review.stopped;
  return contactApproved({ phase: approvedNow ? "ReviewApproved" : "ReviewInvalidated", revision: review.rerolls?.length ?? 0, approver: reviewApproverOf(review) });
}

export function reviewStateOf(o: Pick<Opp, "stage" | "review">): AutomatedReview {
  const revision = reviewRevision(o);
  const review = o.review;
  if (!review) return { phase: "ReviewInvalidated", revision, approver: "NoApprover" };
  if (o.stage === "review") return { phase: review.exception?.revision === revision ? "HeldForStaff" : "AwaitingJudge", revision, approver: "NoApprover" };
  const approver = reviewApproverOf(review);
  if (review.stopped) return { phase: "ReviewStopped", revision, approver };
  if (review.decision === "approve" && !review.invalidated && approver !== "NoApprover") return { phase: "ReviewApproved", revision, approver };
  if (review.decision === "reject") return { phase: "ReviewRejected", revision, approver: "NoApprover" };
  if (review.decision === "expired") return { phase: "ReviewExpired", revision, approver: "NoApprover" };
  return { phase: "ReviewInvalidated", revision, approver: "NoApprover" };
}

function rosterKey(ids: readonly MemberId[]): string { return [...ids].sort().join("|"); }

const PACKET_NAME = /^[\p{L}][\p{L}'-]{0,23}$/u;
const clip = (text: string, max: number) => text.slice(0, max);

type PStatus = "queued" | "probing" | "available" | "unavailable" | "yes" | "no" | "dropped";

function probePhase(status: PStatus | undefined): ParticipantProbe["phase"] {
  switch (status) {
    case "queued": return "Queued";
    case "probing": return "AwaitingReply";
    case "available": return "Available";
    case "unavailable": return "Unavailable";
    default: return "OutsideProbe";
  }
}
const STATUS_OF_PHASE: Partial<Record<ParticipantProbe["phase"], PStatus>> = { Queued: "queued", AwaitingReply: "probing", Available: "available", Unavailable: "unavailable" };
function participantProbe(o: Opp, id: MemberId): ParticipantProbe {
  return { phase: probePhase(o.status.get(id)), roster: o.roster ?? 0, about: o.probeAbout?.[id] ?? 0, told: o.probeDelivery?.[id] !== undefined };
}
function storeProbe(o: Opp, id: MemberId, next: ParticipantProbe, delivery?: string) {
  const status = STATUS_OF_PHASE[next.phase];
  if (status) o.status.set(id, status);
  o.probeAbout = { ...o.probeAbout, [id]: next.about };
  const { [id]: _, ...others } = o.probeDelivery ?? {};
  o.probeDelivery = next.told ? { ...others, [id]: delivery ?? o.probeDelivery?.[id] ?? "" } : others;
}
interface Opp {
  id: string; origin: Origin; kind: Proposal["kind"]; category: Category; objective: string; detail: string;
  participants: MemberId[]; alternates: MemberId[]; primed: Set<MemberId>; requester?: MemberId;
  status: Map<MemberId, PStatus>; explanations: Record<MemberId, string>;
  stage: keyof typeof PHASE_BY_STAGE; deadline: number; createdAt: number;
  score: number; components: ScoreComponents; generator: string; exploration: boolean;
  /** Review record (PRD 32.8). An edit is stored as "approve" with `edits`; a re-roll keeps the item waiting. */
  review?: {
    queuedAt: number; deadline: number; decision?: "approve" | "reject" | "expired"; reason?: string; note?: string; reviewer?: string; decidedAt?: number;
    secondsSpent?: number; edits?: string[]; rerolls?: { at: number; out?: MemberId; in?: MemberId; reviewer: string; note?: string }[];
    /** Approved, but a gate failed on the re-check, so nobody was contacted. */
    invalidated?: string;
    approver?: ReviewApprover;
    judged?: { verdict: JudgeVerdictName; reason: JudgeReasonCode; revision: number; at: number; rubric: "adult" | "minor"; reviewer: string; basePacketHash: string };
    exception?: ReviewException;
    judgeWaitFrom?: number;
    judgedRosters?: string[];
    stopped?: { by: string; at: number };
  };
  /** Engine proposals only: what the gates need to run again at approval. */
  anchor?: EngineProposal["anchor"]; roles?: EngineProposal["roles"];
  lane?: EngineProposal["lane"]; cofounderIntents?: EngineProposal["cofounderIntents"];
  format?: Format; via?: MemberId;
  /** The stage it was in when it closed, and why (console). */
  closedFrom?: string; closedReason?: string;
  minorKnew?: true;
  teenRuleAt?: number;
  sameDay: boolean;
  /** Members a probe or a reveal actually reached. */
  contacted: Set<MemberId>;
  askedAgain?: MemberId[];
  roster?: number;
  probeAbout?: Record<MemberId, number>;
  probeDelivery?: Record<MemberId, string>;
  reminded: Set<MemberId>;
  dayBeforeReminded?: MemberId[];
  /** Changes only on a committed time change. Existing bookings start at revision zero. */
  scheduleRevision?: number;
  reschedule?: RescheduleDraft;
  fixedVenue?: Venue;
  venueId?: string; venue?: string; venueArea?: string; backupVenueId?: string; backupPivoted?: boolean; venueSuggestion?: TopOneSuggestionState; meetingAt?: number; followupAt?: number; feedbackSent?: boolean; recorded?: boolean;
  /** True after one counter-proposal round has been relayed to the partner (prevents ping-pong loops). */
  counterProposed?: boolean;
  /** Original 3+ group opp id when this 1:1 opportunity was offered as an opt-in 3->2 pivot. */
  pivotFromGroup?: string;
  /** Work intro channel state (peon hiring seats and Cofounder lane: never physical venues). */
  workIntro?: WorkIntroState;
  workBounceSent?: boolean;
  /** A booked venue outside the Network's default meeting zone. */
  meetingTimeZone?: string;
  tags: string[]; replacements: number; runId?: string;
  /** Built by the daily retry of a standing request: the requester hears about it only after approval. */
  retry?: boolean;
  /** Probed first (the member with the want); the others are probed only after their yes (attention v1.2). */
  first?: MemberId;
  /** When it became each member's turn to be probed, and when their probe went out. */
  turnAt?: Record<MemberId, number>; sentAt?: Record<MemberId, number>;
  /** Time options offered to each member, the slot starts each picked, and members whose deferral was logged. */
  offered?: Record<MemberId, TimeOption[]>; picks?: Record<MemberId, number[]>; deferLogged?: MemberId[];
  /** An event's own time window (a fixed-time opportunity gets that time as its only option). */
  anchorWindow?: { start: number; end: number };
  /** The public listing reviewed for this opportunity. Content changes require a new review. */
  publicEventRevision?: string;
  /** Slot starts a member was offered and did not pick: never offered again in this opportunity. */
  declinedTimes?: number[];
  /** Members who said "neither" and were offered other times once. */
  timeRetry?: MemberId[];
  /** Members the booked plan reached (only they hear if it changes). */
  bookedTold?: MemberId[];
  /** Last schedule revision each participant reported late, without the original text. */
  lateArrivalReported?: Record<MemberId, number>;
  /** Participants who answered the feedback question. */
  feedbackFrom: Set<MemberId>;
  /** Local simulator delivery at its own channel. Persisted runtimes read committed provider receipts instead. */
  feedbackPromptedAt?: Partial<Record<MemberId, number>>;
  /** Original completed meeting behind this review item. */
  repeatFrom?: string;
  /** Exact gathering consent behind this review item. Never part of member-facing copy. */
  gatheringRepeat?: GatheringRepeatSource;
  /** Planner plans and crew sessions: the engine plan and its quorum run (plans.startPlanRun). */
  plan?: plans.Plan; planRun?: plans.PlanRun;
  /** The cancelled booking behind this separate review item. Never part of member-facing copy. */
  replacementFor?: string;
  fallbackOf?: string;
  /** When the booked plan reached each member, who confirmed it in words, and who confirmed by silence (48 h). */
  bookedAt?: Record<MemberId, number>; explicit?: MemberId[]; confirmed?: MemberId[];
  /** Private post-meeting facts and whether the member valued the experience. */
  post?: Record<MemberId, { came: boolean; again: boolean; otherNoShow: boolean; named: MemberId[]; missing?: MemberId[];
    worthwhile?: true; confirmedRoster?: true; repeatProof?: { revision: number; settledBooking?: true } }>;
  /** Attendance resolved and the ledger told (plan_attended / plan_no_show / plan_ghosted). */
  finalized?: boolean;
  /** Members whose no-show `finalize` counted: a late feedback answer does not count it again (SD-328). */
  noShowCounted?: MemberId[];
  /** Members whose probe reached them and expired without an answer (peon history: an employer who did not answer). */
  noAnswer?: MemberId[];
  /** Findings from receipt-backed attendance settlement. Older states may lack these marks. */
  settledAttendance?: Partial<Record<MemberId, AttendanceMark>>;
  /**
   * peon (#9): the engine proposed a job seat. `id` is the seat (`job:<posting>`), `manager` the hiring
   * manager who owns it and stands in for it here: they get the blind review after the candidate's
   * yes and the intro only after both yeses. The engine's own views (capacity, pair rules) see the seat.
   */
  seat?: HireSeat;
  /** The time both sides' agreements committed the reviewed job introduction. */
  seatAcceptedAt?: number;
  /** Direct answers to the admitted candidate and employer probes for this introduction. */
  seatProbeReplies?: Partial<Record<MemberId, "yes" | "no">>;
  /** New posting text displaced the employer's unanswered question. Its first send time still applies. */
  managerProbeSuspended?: true;
}
/** A member request. The member's own words are not kept: only what the classifier read from them. */
interface Request {
  id: string; memberId: MemberId; at: number; kind: "people" | "plans"; category: Category; desireId?: string; tags: string[];
  /** "booked": a meeting is set; "fulfilled" only once the requester and someone else attended (matching-e2e-7). */
  oppId?: string; outcome?: "probing" | "booked" | "fulfilled" | "none" | "answered"; fulfilledAt?: number; tries?: number; toldNone?: boolean; lastTry?: number;
  /** The requester was told once that a retried match did not come together. */
  toldRetryNone?: boolean;
  /** The requester's own "no" to candidates; the second one closes the request (matching-e2e-3). */
  noCount?: number; closed?: boolean;
  withdrawn?: boolean;
  withdrawnBy?: string;
  /** When the requester last got a confirm question for it: at most one per 72 hours. */
  lastConfirmAt?: number;
  /** Matching came back on while it waited: its standing week of retries starts here, not at `at` (SD-267). */
  openFrom?: number;
}

type SendResult = "sent" | "deferred" | "refused";
interface SendOpts {
  /** Verified public venue address from VenueManager allowed on pre_brief and backup_pivot sends. */
  publicVenueAddress?: string;
  /** Other members the message is about (send-time checks: minors, watch, blocks). */
  about?: MemberId[];
  /** Sent instead when the leak guard blocks the message (it is checked too). */
  fallback?: string;
  /** Do not queue it when it may not go out now: the caller retries (probes compose their time options at send time). */
  noDefer?: boolean;
  /** A reviewed event card must retain its exact body through the outbound claim. */
  immutableBody?: boolean;
  /** The service has checked a current reservation for the exact gathering notice. */
  gatheringRsvpLogistics?: true;
  answersMemberAction?: true;
  /**
   * What the send does, as data: whether a deferred send is still worth sending when the window
   * opens, what runs when it goes out, and what runs when it is refused (hookFns). Data, not
   * closures, so a deferred send survives a restart (exportState).
   */
  hook?: SendHook;
  /** A plan invite under the plan allowance: counts for two-unanswered and the Blooio streak, never on the intro cap. */
  planInvite?: boolean;
  /** The outbound id (relay.ts: "relay:<item>", which the Cloud channel delivers as kind "relay"). Default: the member and a sequence number. */
  key?: string;
  /** A relayed item (relay.ts): the sender's own private facts may be in it (the leak guard skips the sender's and the recipient's). */
  relayFrom?: MemberId;
  /** A number swap both members asked for (relay.ts): the one contact value the leak guard lets through in this text. */
  relayContact?: string;
  /** One server-issued invitation URL on its own line in a direct reply to its requester. */
  memberInviteLink?: string;
  /** One server-issued review reference in a direct reply to its requester. */
  memberInviteReviewReference?: string;
  minorClose?: true;
}
type SendHook =
  | { t: "interview" } | { t: "age" } | { t: "suggested"; venues: string[] } | { t: "retry_found"; oppId: string }
  | { t: "probe"; oppId: string; id: MemberId; roster?: number } | { t: "reveal"; oppId: string; id: MemberId } | { t: "times"; oppId: string; id: MemberId }
  | { t: "drop_notice"; oppId: string; meetingAt?: number } | { t: "feedback"; oppId: string }
  | { t: "reschedule_offer" | "reschedule_updated"; oppId: string; key: string }
  | ({ t: "group_late" } & LateArrivalDelivery)
  | { t: "growth"; kind: string } | { t: "reengage" } | { t: "ask"; reason: AskRecord["reason"]; also?: string[]; follow?: boolean; engineQuestion?: true } | { t: "checkin" }
  | { t: "plan_probe"; oppId: string; id: MemberId; options?: TimeOption[] } | { t: "crew_offer"; crewId: string }
  | { t: "invite_notice"; notice: InviteJoinNotice }
  | { t: "standing_renewal"; key: string; deadline: number }
  | EmptyIntentNotice;
type InviteJoinNotice = { inviteeId: MemberId; at: number };
type MemberInviteDraft = Pick<MemberInviteRequest, "firstName" | "relationship" | "requestId" | "at"> & {
  evidence?: MemberInviteEvidence;
  riskLanguage: boolean;
};
const INVITE_REPLY_MAX_CHARS = 1600;
type EmptyIntentNotice = { t: "empty_intent"; intentId: string; statedAt: number; searchDay: string; reason: string };
interface HookFns { valid?: () => boolean; onSent?: (messageId: string) => void; onRefused?: () => void }
interface Deferred { memberId: MemberId; body: string; meta: SimMeta; kind: SendKind; o: SendOpts; timing?: Timing }
/** When a send may go out: at once (replies, safety), in the member's send slot (interruptions), or outside quiet hours (logistics). */
type Timing = "now" | "slot" | "logistics";

const ZERO: ScoreComponents = { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 };
const PROBE_WAIT = DEFAULT_ATTENTION.expiry.partnerProbeDays * DAY;
/** The daily engine run happens at the first tick from runHour until this New York hour. */
const ENGINE_RUN_UNTIL = 20;
const INTENT_CONTROL_STATUS = { PauseControl: "paused", CloseControl: "closed" } as const satisfies Record<IntentControl, Intent["status"]>;
/** The earliest a booked meeting may start after the last yes, and the earliest offered slot for a partner probe. */
const MIN_NOTICE = 6 * HOUR, PARTNER_LEAD = 12 * HOUR;
/** Employer-like facets never go in a probe (D5). Same rule as the engine's buildProbe, which does not export it. */
const EMPLOYER_TAGS = /^(employer|employer_type|occupation|company|job|job_title|workplace|work|role|title)$/i;
const EMPLOYER_TEXT = /\b(works? (at|for)|employer|employed|company|job|occupation|workplace|engineer at|manager at)\b/i;
/** The gate keeps a declined pair apart this long (gateReason: pair_history); app packs see it as an avoid edge. */
const PAIR_HISTORY_DAYS = 60;
const OPEN_STAGES = new Set(["review", "probing", "scheduled"]);
/** A yes to the probe ("available" while the others are still asked), or to the booked item. */
const saidYes = (s: PStatus | undefined) => s === "available" || s === "yes";

const BOOKED_REMINDER_KINDS = ["day-before-reminder", "near-meeting-reminder", "day-of-checkin"] as const;
export const meetingFeedbackKey = (oppId: string, memberId: MemberId, revision = 0): string => `${meetingFeedbackPrefix}${oppId}:r${revision}:${memberId}`;
/** In-memory lookup for an exact booking notice. This key is never sent. */
type SlopIntroduction = Pick<Opp, "id" | "kind" | "category" | "participants" | "meetingAt" | "stage" |
  "closedFrom" | "origin" | "plan" | "bookedAt" | "review">;
const slopIntroductionId = (oppId: string): string => `${oppId}:introduced`;

export function pendingSlopIntroductions<T extends SlopIntroduction>(opportunities: Iterable<T>,
  interactions: readonly InteractionRecord[]): T[] {
  const recorded = new Set(interactions.filter(item => item.outcome === "accepted").map(item => item.id));
  return [...opportunities].filter(opp => {
    const [first, second] = opp.participants;
    return opp.kind === "intro" && opp.category === "romance" && !opp.plan && opp.origin !== "second_encounter"
      && opp.participants.length === 2 && first !== undefined && second !== undefined && first !== second
      && opp.meetingAt !== undefined && (opp.stage === "scheduled" || opp.stage === "done" || opp.closedFrom === "scheduled")
      && opp.review?.decision === "approve" && opp.bookedAt?.[first] !== undefined && opp.bookedAt?.[second] !== undefined
      && !recorded.has(slopIntroductionId(opp.id));
  });
}

export const bookingNoticeReceiptKey = (oppId: string, memberId: MemberId, revision = 0): string =>
  `booking-notice-receipt:${[oppId, revision, memberId].map(encodeURIComponent).join(":")}`;
export type BookedReminderKind = typeof BOOKED_REMINDER_KINDS[number];
export const replacementProbePrefix = "booked-group-replacement-probe:";

export function replacementProbeKey(oppId: string, memberId: MemberId): string {
  return `${replacementProbePrefix}${oppId}:${memberId}`;
}

export function bookedReminderKind(id: string): BookedReminderKind | undefined {
  return BOOKED_REMINDER_KINDS.find(kind => id.startsWith(`${kind}:`));
}

export function bookedReminderKey(kind: BookedReminderKind, oppId: string, memberId: MemberId, revision = 0): string {
  const scope = kind === "day-before-reminder" && revision === 0 ? oppId : `${oppId}:r${revision}`;
  return `${kind}:${scope}:${memberId}`;
}

export function bookedReminderWindow(kind: BookedReminderKind, now: number, start: number, tz = NY): boolean {
  const remaining = start - now;
  if (kind === "day-before-reminder") return dayBeforeReminderWindow(remaining);
  if (kind === "day-of-checkin") return dayOfCheckInWindow(localDateParts(now, tz).day === localDateParts(start, tz).day, remaining);
  return nearMeetingReminderWindow(remaining);
}

const activeOpportunityParticipant = (o: Opp, id: MemberId) =>
  o.participants.includes(id) && !["unavailable", "no", "dropped"].includes(o.status.get(id) ?? "");
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
function pairsOf(ids: readonly MemberId[]): [MemberId, MemberId][] {
  return ids.flatMap((a, i) => ids.slice(i + 1).map((b): [MemberId, MemberId] => [a, b]));
}
function byMember<T extends { memberId: MemberId }>(rows: readonly T[]): Map<MemberId, T[]> {
  const by = new Map<MemberId, T[]>();
  for (const row of rows) { const own = by.get(row.memberId); if (own) own.push(row); else by.set(row.memberId, [row]); }
  return by;
}

export { gatheringRepeatOppPrefix };

function gatheringRepeatMembersMatch(left: readonly MemberId[], right: readonly MemberId[]): boolean {
  return left.length === 2 && right.length === 2 && left[0] !== left[1] && left.every(memberId => right.includes(memberId));
}

export function sameGatheringRepeatSource(left: GatheringRepeatSource | undefined, right: GatheringRepeatSource | undefined): boolean {
  return !!left && !!right && gatheringRepeatSourceMatches(left.gatheringId === right.gatheringId, left.revision === right.revision,
    left.groupReviewId === right.groupReviewId, gatheringRepeatMembersMatch(left.members, right.members), left.consentVersion === right.consentVersion);
}

export function gatheringRepeatOppId(source: GatheringRepeatSource): string {
  return `${gatheringRepeatOppPrefix}${sha256(stableStringify([source.gatheringId, ...source.members.slice().sort()]))}`;
}

export function gatheringRepeatProbeKey(oppId: string, memberId: MemberId, retry = false): string {
  return `${oppId}:${retry ? "times" : "probe"}:${memberId}`;
}

/** Keep the exact open-question receipt separate from unanswered-message tracking. */
export function probeReplyReceiptKey(oppId: string, memberId: MemberId, slot: { at: number; probeReceiptId?: string }): string {
  return `probe-reply-receipt:${oppId}:${memberId}:${slot.probeReceiptId ?? slot.at}`;
}

function latestOutboundMatchesProbe(last: MemberState["lastSent"], oppId: string, sentAt: number | undefined): boolean {
  return last?.consentProbe === oppId || (last?.consentProbe === undefined && sentAt !== undefined && sentAt === last?.at);
}

/** Resolve the same invitation even after another turn has replaced its open question. */
export function planProbeReceiptSlot(oppId: string, sentAt: number, member?: Pick<MemberState, "awaiting" | "pendingAsks">) {
  const question = member?.awaiting;
  const questionId = question?.kind === "probe" && question.oppId === oppId ? question.probeReceiptId : undefined;
  const deliveryId = questionId ?? member?.pendingAsks.find(ask => ask.kind === "probe" && ask.opportunityId === oppId)?.deliveryId;
  return { at: sentAt, probeReceiptId: deliveryId };
}

function isGatheringRepeat(o: Pick<Opp, "id" | "gatheringRepeat">): boolean {
  return o.id.startsWith(gatheringRepeatOppPrefix) || o.gatheringRepeat !== undefined;
}
/** A tie-break in [0, 1) from the seed and two ids (FNV-1a): stable per run, not id order. */
function seededTie(seed: number, a: string, b: string): number {
  let h = 0x811c9dc5 ^ seed;
  for (const ch of `${a}|${b}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0) / 2 ** 32;
}
/**
 * The Network's own public vocabulary (places, interest and skill labels, wants as it phrases them).
 * The leak guard cuts these out of other members' private facts before matching, so "lives near
 * Hell's Kitchen" or a minor's private interest "AI and machine learning" don't block every message
 * that names the neighborhood or the interest.
 */
const PUBLIC_PHRASES = [
  ...allNeighborhoods().map(n => n.name), ...VENUES.map(v => v.name), ...ALL_SEED_VENUES.map(v => v.name),
  ...INTERESTS.flatMap(i => [i.label, i.tag.replace(/_/g, " ")]), ...SKILLS.flatMap(s => [s.label, s.tag.replace(/_/g, " ")]),
  ...DESIRES.map(d => d.text),
];
/** A canary token inside a private value: "(ref QX-4821-ORCHID)". */
const CANARY_RE = /\(ref ([A-Za-z0-9-]{6,})\)/g;
/** The judge's duplicate_send window: the same text never goes to one member twice inside it. */
const DUPLICATE_WINDOW = 10 * MINUTE;
/** A venue suggested to a member is not suggested again for this long (vary, or say nothing). */
const VENUE_REPEAT_DAYS = 7;
/** At most one engine question (EngineResult.asks) per member in this many days. */
const ASK_EVERY_DAYS = 7;

/** "block him", "report my date": a block or report about the member's counterpart, not a name. */
const PRONOUN_TARGET = /^(?:him|her|them|they|he|she|my date|my match|(?:the|this|that) (?:guy|girl|person|dude|man|woman))\b/i;
/** A reply to "Who do you mean?" that drops the question. */
const CANCEL_SAFETY_QUESTION = /^[^\p{L}\p{M}\p{N}_]*(?:never ?mind|nvm|forget it|cancel that)[^\p{L}\p{M}\p{N}_]*$/iu;
const NO_SAFETY_TARGET = /^[^\p{L}\p{M}\p{N}_]*(?:nobody|no one|none|no|nope|nah|naw)[^\p{L}\p{M}\p{N}_]*$/iu;
const CHECK_IN_ANSWER_TARGET = /^(?:(?:and|&|or)\s+(?:block|report|flag)|both|please|pls|too|now|as well)\b/i;

/** Actual city presence for the whole requested window; conversation ownership grants no location. */
export function presentInCity(snapshot: WorldSnapshot, id: MemberId, city: City, from: number, to: number): boolean {
  return presentFor(snapshot.members.find(m => m.id === id), snapshot.presence.filter(p => p.memberId === id), from, to, city);
}
/** Actual NYC presence for the whole requested window; conversation ownership grants no location. */
export function presentInNyc(snapshot: WorldSnapshot, id: MemberId, from: number, to: number): boolean {
  return presentInCity(snapshot, id, "nyc", from, to);
}
function presentFor(member: WorldSnapshot["members"][number] | undefined, own: readonly Presence[], from: number, to: number, city: City = "nyc"): boolean {
  const requested = { from, to };
  if (!member || !presenceWindowValid(requested)) return false;
  let present = member.homeCity === city;
  for (const p of own) {
    const trip = temporaryPresenceWindow(p);
    if (!trip) continue;
    if (p.city !== city && presenceWindowsOverlap(trip, requested)) return false;
    if (p.city === city && presenceWindowCovers(trip, requested)) present = true;
  }
  return present;
}

export class ConsentNetwork implements NetworkUnderTest {
  readonly name = "consent";
  readonly trust = new Trust();
  readonly venues: VenueManager;
  readonly meetups: MeetupCoordinator;
  private ctx!: NetworkContext;
  private readonly relayDesk: RelayDesk = new RelayDesk(this.relayHost());
  private members = new Map<MemberId, MemberState>();
  readonly opps = new Map<string, Opp>();
  readonly requests: Request[] = [];
  private queued: Proposal[] = [];
  private deferred: Deferred[] = [];
  /** Safety cases (PRD 32.14): trust events about a member, grouped for staff. */
  private cases: SafetyCase[] = [];
  private caseSeq = 0;
  /** Reports about members (reports.ts): ids and a kind only, never the reporter's words. */
  private reports: (SafetyReport & { met: boolean })[] = [];
  private reportSeq = 0;
  /** Declined at join (under 13): only the id is kept, so they are never messaged again. */
  private declinedIds = new Set<MemberId>();
  private blocks = new Set<string>();
  private avoid = new Set<string>();
  /** Pairs not to propose again for a while: a member declined, or a reviewer rejected them. */
  private declined = new Map<string, number>();
  private feedback: FeedbackRecord[] = [];
  private interactions: InteractionRecord[] = [];
  /** Engine questions sent (EngineResult.asks), fed back to the engine as `recentAsks`. */
  private asks: AskRecord[] = [];
  private lastRunDay = "";
  private standingIntentSearch?: NetworkState["standingIntentSearch"];
  /** Engine run that is currently being turned into opportunities (for run linkage). */
  private currentRunId?: string;
  /** Skills confirmed by a good experience (a requester enjoyed meeting the provider). */
  private vouchedSkills = new Map<MemberId, Set<string>>();
  /** Members who joined through an invite made in this run (growth accounting). */
  readonly invitedIds = new Set<MemberId>();
  /** The member whose inbound message is being handled: sends to them are direct replies. */
  private replyTo?: MemberId;
  private memberReply = false;
  private turnSource: "thread" | "mcp" | undefined;
  private turnCause: string | undefined;
  private lastTick = 0;
  private tickGap = HOUR;
  private seq = 0;
  private oppSeq = 0;
  private reqSeq = 0;
  readonly counters = {
    probesSent: 0, probeYes: 0, probeNo: 0, probeExpired: 0, reveals: 0, revealYes: 0, revealNo: 0, revealExpired: 0,
    oppsStarted: 0, oppsRevealed: 0, oppsAllYes: 0, oppsNotAvailable: 0, replacements: 0, scheduled: 0,
    requests: 0, requestsFulfilled: 0, requestsNone: 0, requestRetries: 0, plansAnswered: 0, abuse: 0, holds: 0, watches: 0,
    invitesSent: 0, inviteesJoined: 0, growthAsks: 0, interviews: 0, engineRuns: 0, engineProposals: 0, gatedOut: 0,
    reviewQueued: 0, reviewApproved: 0, reviewRejected: 0, reviewExpired: 0, reviewInvalidated: 0, reviewEdited: 0, reviewRerolled: 0,
    reviewJudged: 0, reviewJudgeApproved: 0, reviewExceptions: 0, reviewStaffApproved: 0, reviewStopped: 0, photoReviewExpired: 0,
    joinDeclined: 0, withdrawnWant: 0, deferred: 0, sendRefused: 0, guardBlocked: 0, onlyWhenAsked: 0, reengagements: 0,
    asksSent: 0, asksAnswered: 0,
    probesWithOptions: 0, optionsNoneFit: 0, noCommonTime: 0, bookedCancelled: 0, calendarOptIns: 0, weeklyOptIns: 0, checkinsSent: 0,
  };
  readonly gateReasons: Record<string, number> = {};
  /** Plans: proposed and formed crews, crew offers, demand carried to next week, and when each member was last planned. */
  readonly crews: plans.Crew[] = [];
  private crewOffers: CrewOffer[] = [];
  private planCarry: { memberId: MemberId; activityId: string; until: number }[] = [];
  private lastPlannedAt = new Map<MemberId, number>();
  private lastPlanRunDay = "";
  /** Attendees of a plan who both said they'd do it again: would_interact_again edges for the engine and the planner. */
  private planAgain = new Map<string, number>();
  /** Gaming flags waiting for (or decided by) a reviewer. */
  private fraud: FraudItem[] = [];
  private fraudSeq = 0;
  readonly plansCounters = { plansProposed: 0, planProbes: 0, planInvitesAllowance: 0, planInvitesIntroCap: 0, planYes: 0, planNo: 0, plansBooked: 0, planLateJoins: 0, planFallbacks: 0, planConflictsDropped: 0, crewOffers: 0, crewsFormed: 0, crewSessions: 0, reachExtra: 0 };
  readonly ledgerCounts: Record<string, number> = {};
  /** The app this Network serves, and its member-facing copy. */
  readonly app: AppInfo;
  private readonly copy: Copy;
  private readonly inlineJudge: InlineReviewJudge | undefined;
  readonly judgeReviewer: string;
  private flagged = new Map<string, { reason: JudgeReasonCode; at: number }>();
  private snapAvoid?: { snap: WorldSnapshot; set: Set<string> };
  private opts: Required<Omit<NetworkOptions, "inlineJudge" | "judgeReviewer" | "app" | "engine" | "onEngineRun" | "store" | "onLedger" | "capital" | "plansConfig" | "understand" | "workIntroEmailOf" | "venueProvider" | "arrivalBriefs" | "onAgeStated" | "onMinorSignal" | "onTeenBar" | "onTeenPairAvoid" | "engineLLM" | "pack" | "allowedCategories" | "hooks" | "onPosting" | "issueMemberInvite" | "memberInviteTurnAllowed" | "lateArrivalTurnAllowed" | "calendarFreeBusy" | "onPrivateInviteTurn" | "homeHelpIntakePrompt" | "venues" | "memberVenueHistory" | "concurrentHeadcountByVenue">>
    & Pick<NetworkOptions, "engine" | "onEngineRun" | "store" | "onLedger" | "capital" | "understand" | "workIntroEmailOf" | "venueProvider" | "arrivalBriefs" | "onAgeStated" | "onMinorSignal" | "onTeenBar" | "onTeenPairAvoid" | "engineLLM" | "pack" | "hooks" | "onPosting" | "issueMemberInvite" | "memberInviteTurnAllowed" | "lateArrivalTurnAllowed" | "calendarFreeBusy" | "onPrivateInviteTurn" | "homeHelpIntakePrompt">;
  private venueRuntimeCtx: VenueRuntimeContext = {};
  /** The categories this app may start opportunities in (ALLOWED_CATEGORIES). */
  readonly allowedCategories: ReadonlySet<Category>;
  /** A service read for the current unit. This authority is never imported or exported with state. */
  private gatheringRepeatSources = new Map<string, GatheringRepeatSource>();
  private pcfg: PlansConfig;
  private teenStop: { by: string; at: number } | undefined;
  private teenDayKey = 0;

  constructor(opts: NetworkOptions = {}) {
    this.app = typeof opts.app === "object" ? opts.app : APPS[opts.app ?? "ntwrk"];
    if (!this.app) throw new Error(`unknown app "${opts.app}"`);
    this.copy = this.app.id === "ntwrk" ? copy : copyFor(brandOf(this.app));
    const resolvedCity = opts.city ?? "nyc";
    this.opts = {
      city: resolvedCity, seed: opts.seed ?? 1, probes: opts.probes ?? true, selective: opts.selective ?? true, maxNewPerDay: opts.maxNewPerDay ?? 20,
      minScore: opts.minScore ?? 0, minKnowledge: opts.minKnowledge ?? 2, minWantMet: opts.minWantMet ?? 0.8, minResponsiveness: opts.minResponsiveness ?? 0.6, runHour: opts.runHour ?? 9, growth: opts.growth ?? true,
      invitesPerMonth: opts.invitesPerMonth ?? defaultMemberInviteCapacity, maxGrowthAsksPerDay: opts.maxGrowthAsksPerDay ?? 8, onboardingRequests: opts.onboardingRequests ?? false,
      reviewSlaHours: opts.reviewSlaHours ?? 12, matchingEnabled: opts.matchingEnabled ?? true,
      engine: opts.engine, onEngineRun: opts.onEngineRun, store: opts.store, onLedger: opts.onLedger, capital: opts.capital, plans: opts.plans ?? true,
      understand: opts.understand, workIntroEmailOf: opts.workIntroEmailOf, venueProvider: opts.venueProvider,
      arrivalBriefs: opts.arrivalBriefs ?? isCity(resolvedCity),
      onAgeStated: opts.onAgeStated, onMinorSignal: opts.onMinorSignal, onTeenBar: opts.onTeenBar, onTeenPairAvoid: opts.onTeenPairAvoid, engineLLM: opts.engineLLM, pack: opts.pack, hooks: opts.hooks, onPosting: opts.onPosting,
      issueMemberInvite: opts.issueMemberInvite,
      memberInviteTurnAllowed: opts.memberInviteTurnAllowed, onPrivateInviteTurn: opts.onPrivateInviteTurn,
      lateArrivalTurnAllowed: opts.lateArrivalTurnAllowed,
      calendarFreeBusy: opts.calendarFreeBusy,
      homeHelpIntakePrompt: opts.homeHelpIntakePrompt,
    };
    this.venueRuntimeCtx = {
      ...(opts.venues !== undefined ? { venues: opts.venues } : {}),
      ...(opts.memberVenueHistory !== undefined ? { memberVenueHistory: opts.memberVenueHistory } : {}),
      ...(opts.concurrentHeadcountByVenue !== undefined ? { concurrentHeadcountByVenue: opts.concurrentHeadcountByVenue } : {}),
    };
    this.venues = new VenueManager({ provider: opts.venueProvider });
    this.meetups = new MeetupCoordinator(this.meetupHost(), {
      onProvisionalNoShow: ev => {
        for (const missingId of ev.missingMemberIds) {
          const mm = this.members.get(missingId);
          if (!mm) continue;
          const hadNoShow = mm.noShows > 0 || (mm.strikes ?? 0) > 0;
          mm.provisionalNoShow = true;
          mm.strikes = (mm.strikes ?? 0) + (hadNoShow ? repeatNoShowStrikes : firstNoShowStrikes);
          mm.completedSinceNoShow = 0;
          this.dirty = true;
          this.ctx?.log("provisional_no_show", { oppId: ev.oppId, memberId: missingId, at: ev.at });
        }
      },
    });
    this.allowedCategories = new Set(opts.allowedCategories ?? ALLOWED_CATEGORIES[this.app.id] ?? ALLOWED_CATEGORIES.ntwrk!);
    this.inlineJudge = opts.inlineJudge;
    this.judgeReviewer = opts.judgeReviewer ?? (opts.inlineJudge ? SIM_REVIEW_JUDGE : REVIEW_JUDGE_REVIEWER);
    this.pcfg = resolvePlans(opts.plansConfig ?? {});
    this.trust.onChange = (id, from, to, why) => this.onTrustChange(id, from, to, why);
    this.trust.onEvent = (id, e) => this.caseEvent(id, e);
    const wrappedMethods = new Map<string | symbol, { fn: (...args: unknown[]) => unknown; wrapped: (...args: unknown[]) => unknown }>();
    return new Proxy(this, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        const fn = value as (...args: unknown[]) => unknown;
        const cached = wrappedMethods.get(key);
        if (cached && cached.fn === fn) return cached.wrapped;
        const wrapped = READ_ONLY_METHODS.has(key)
          ? fn.bind(target)
          : (...args: unknown[]) => { target.beginUnit(); return fn.apply(target, args); };
        wrappedMethods.set(key, { fn, wrapped });
        return wrapped;
      },
    });
  }

  /** The store runTick() uses when none is passed. */
  get store(): NetworkStore | undefined { return this.opts.store; }

  init(ctx: NetworkContext) { this.ctx = ctx; }
  private now() { return Math.floor(this.ctx.clock.now()); }

  // ================================================================== inbound
  async onInbound(msg: InboundMessage, queueCofounderIntent?: (intent: Intent) => void, reportChoice?: PendingReportChoice): Promise<"handled" | "open"> {
    msg = { ...msg, ts: Math.floor(msg.ts), ...(msg.signedReceivedAt !== undefined ? { signedReceivedAt: Math.floor(msg.signedReceivedAt) } : {}) };
    if (this.declinedIds.has(msg.memberId)) return "handled";
    const fromThread = inboundMayCommand(msg.source ?? "thread");
    const currentDanger = immediateDangerReply(fromThread && !msg.keyword && !msg.reaction, statesImmediateDanger(msg.body));
    const privateInviteTurn = !currentDanger && this.isPrivateInviteTurn(msg);
    if (privateInviteTurn) this.opts.onPrivateInviteTurn?.(msg.memberId, msg.id);
    // The LLM reader runs before anything changes, so the unit below stays one synchronous step.
    const u = reportChoice || privateInviteTurn || currentDanger || interruptionFeedbackAnswer(msg.body) ? undefined : await this.understandSafely(msg);
    if (this.declinedIds.has(msg.memberId)) return "handled";
    // What a member says can change the snapshot (a trip, a setting): read it fresh, never up to 20 minutes stale.
    this.dirty = true;
    const m = this.member(msg.memberId);
    this.syncMember(m);
    // spec/outreachPolicy.md, "Count a sent invitation at terminal expiry or after 72 hours"
    const nowIn = this.now(), body = msg.body ?? "";
    const priorInboundAt = m.lastInbound;
    this.outboundBefore = m.outbound ?? 0;
    const replyOpen = this.askOpen(m, nowIn);
    if (fromThread) {
      // The member's own ask permits follow-ups. A logistics acknowledgement keeps the unsolicited streak.
      const initiated = !m.lastSent || nowIn - m.lastSent.at > DAY;
      if (initiated || MEMBER_ASK.test(body)) { m.askAt = nowIn; m.askUsed = 0; }
      if (initiated || m.lastOutUnsol || !ACK_ONLY.test(body.trim())) m.unsolStreak = 0;
      m.lastInbound = nowIn; m.msgsIn++;
      this.invitesBeforeReply = new Set(m.pendingAsks.flatMap(invite => {
        if (!invite.opportunityId) return [];
        const receipt = invite.deliveryId && this.ctx.initialInviteReceipt?.(invite.deliveryId);
        return invite.acceptedAt !== undefined || (receipt && receipt.kind === "accepted") ? [invite.opportunityId] : [];
      }));
      if (!msg.keyword) m.replies = [...(m.replies ?? []), nowIn].slice(-60);
      this.heardFrom(m);
      // "Don't send my number" withdraws a pending number swap at once, whatever else the message says.
      if (!msg.keyword && withdrawsSwap(body) && this.relayDesk.cancelSwaps(m.id)) this.ctx.log("relay_swap_withdrawn", { memberId: m.id });
    }
    this.replyTo = m.id;
    this.memberReply = fromThread && !msg.keyword;
    this.sentThisTurn = false;
    this.turnSource = msg.source ?? "thread";
    this.turnCause = msg.id;
    this.understood = u;
    const toldBefore = m.minorScopeToldAt;
    try {
      const turnOpen = this.handleInbound(m, msg, privateInviteTurn, replyOpen, currentDanger, priorInboundAt, queueCofounderIntent, reportChoice) === "open";
      return scopeNoticeTurnOpens(turnOpen, m.minorScopeToldAt !== toldBefore) ? "open" : "handled";
    }
    finally { this.replyTo = undefined; this.memberReply = false; this.sentThisTurn = false; this.turnSource = undefined; this.turnCause = undefined; this.understood = undefined; this.invitesBeforeReply.clear(); }
  }

  /** How many messages we had sent since the member's previous message, when this one came in. */
  private outboundBefore = 0;
  private sentThisTurn = false;
  private invitesBeforeReply = new Set<string>();

  private handleLateArrival(member: MemberState, now: number, receivedAt: number): boolean {
    if (!this.lateArrivalPartyCurrent(member.id)) return false;
    const meetings = [...this.opps.values()].flatMap(opp => {
      if (opp.meetingAt === undefined || !lateArrivalReportTimeCurrent(opp.meetingAt - receivedAt, receivedAt, now)) return [];
      const roster = lateArrivalRoster(opp, id => opp.status.get(id) === "yes", id => this.lateArrivalBookingReceived(opp, id, receivedAt));
      return currentLateArrivalBooking(opp, roster, member.id, now) ? [{ opp, roster }] : [];
    });
    if (meetings.length !== 1) return false;
    const { opp, roster } = meetings[0]!;
    if (!isLateArrivalAdmitted({ panicTriggered: this.isOppPanicHalted(opp.id, [member.id, ...roster]) })) return false;
    const revision = opp.scheduleRevision ?? 0;
    if (!lateArrivalMayReport(true, true, true, meetings.length, opp.lateArrivalReported?.[member.id] === revision)) return true;
    opp.lateArrivalReported = { ...opp.lateArrivalReported, [member.id]: revision };
    const notice = lateArrivalText(isLateArrivalPairBooking(opp));
    let queued = false;
    for (const to of roster) {
      if (to === member.id || !this.lateArrivalPartyCurrent(to)) continue;
      if (!isLateArrivalAdmitted({
        panicTriggered: this.relayDesk.isPanicTriggered(member.id, opp.id) || this.relayDesk.isPanicTriggered(to, opp.id),
        blocked: this.blocked(member.id, to),
      })) continue;
      const delivery = { app: this.app.id, oppId: opp.id, meetingAt: opp.meetingAt!, revision, from: member.id, to };
      const result = this.send(this.members.get(to)!, notice, { type: "relay", proposalId: opp.id }, "relay", {
        key: lateArrivalDeliveryId(delivery), about: [member.id, to], hook: { t: "group_late", ...delivery },
      });
      if (result !== "refused") queued = true;
    }
    if (queued) this.send(member, "I’ll pass along a short update where I can.", { type: "confirmation" }, "reply");
    this.meetups.recordLateCheckIn(opp.id, member.id, now);
    return true;
  }

  private lateArrivalPartyCurrent(id: MemberId): boolean {
    const member = this.members.get(id);
    if (!member || this.declinedIds.has(id)) return false;
    this.syncRecord(member);
    const view = relayMemberOf(member, !this.trust.ok(id) || this.reportHeld(id), earliestDayKeyOf(this.now()));
    return canBeMatched(view.age) && !view.optedOut && !view.held && member.state !== "paused";
  }

  private lateArrivalBookingReceived(opp: LateArrivalBooking, id: MemberId, at: number): boolean {
    const receivedAt = this.bookingNoticeReceiptAt(opp, id);
    return lateArrivalBookingReceiptCurrent(receivedAt !== undefined, receivedAt ?? -1, at);
  }

  private bookingNoticeReceiptAt(opp: Pick<Opp, "id" | "scheduleRevision" | "bookedAt">, id: MemberId,
    revision = opp.scheduleRevision ?? 0): number | undefined {
    if (!this.ctx.initialInviteReceipt) return opp.bookedAt?.[id];
    const receipt = this.ctx.initialInviteReceipt(bookingNoticeReceiptKey(opp.id, id, revision));
    return receipt?.kind === "accepted" ? receipt.at : undefined;
  }


  private captureSlopIntroductions(opportunities: Iterable<Opp>) {
    if (this.app.id !== "slop" || !this.ctx) return;
    const now = this.now();
    for (const opp of pendingSlopIntroductions(opportunities, this.interactions)) {
      const [first, second] = opp.participants as [MemberId, MemberId];
      const firstAt = this.bookingNoticeReceiptAt(opp, first, 0) ?? -1;
      const secondAt = this.bookingNoticeReceiptAt(opp, second, 0) ?? -1;
      const at = slopFirstIntroductionAt(opp.bookedAt?.[first] ?? -1, firstAt, opp.bookedAt?.[second] ?? -1, secondAt, now);
      if (at < 0) continue;
      this.interactions.push({ id: slopIntroductionId(opp.id), opportunityId: opp.id, kind: opp.kind,
        category: opp.category, participants: [first, second], outcome: "accepted", at });
    }
  }

  /** What the LLM reader made of the message being handled (undefined without a reader, or when it failed). */
  private understood?: Understood;

  private static readonly BARE_CONSENT_RE = /^(?:yes|yeah|yep|yup|ya|no|nope|nah|ok|okay|sure)[.!?]*$/i;

  /** Short-circuit LLM understanding ONLY for active members sending trivial ack/yes-no/option-key/definite command/venue-objection replies. */
  private canShortCircuitUnderstand(
    m: MemberState | undefined,
    body: string,
    aw: MemberState["awaiting"],
    options: readonly TimeOption[] | undefined
  ): boolean {
    if (!m || m.stage !== "active") return false;
    const trimmed = body.trim();
    if (!trimmed) return false;
    const c = classify(trimmed);
    if (c.abuse.length || c.minorSignal || c.statedAge !== undefined || c.pitchSlap) return false;
    if ((c.kind === "block" || c.kind === "report" || c.kind === "cancel") && !c.desireId && !c.tags.length) return true;
    if (aw?.kind === "booked" && bookedVenueObjection(trimmed, consentOf(trimmed).answer) !== undefined) return true;
    if (trimmed.length > 50) return false;
    if (ConsentNetwork.BARE_CONSENT_RE.test(trimmed)) return true;
    const structured = !!aw && SHORT_CIRCUIT_AWAITING.has(String(aw.kind));
    const isBareOption = structured && Boolean(options?.length) && BARE_OPTION_KEYS_RE.test(trimmed);
    const isPureAck = !EXTRA_CLAUSE_RE.test(trimmed) && ACK_ONLY.test(trimmed);
    const isPureShort = isBareOption || isPureAck || (structured && !EXTRA_CLAUSE_RE.test(trimmed) && BARE_YES_NO_RE.test(trimmed));
    if (!isPureShort) return false;
    if (c.tags.length || c.desireId || c.notWanted?.length || extractRedLineTags(trimmed).length) return false;
    const profile = extractProfile(trimmed);
    if (profile.interests.length || profile.skills.length || profile.desireIds.length || profile.notWanted.length || profile.area) return false;
    return true;
  }

  /** The LLM reader on one message, with what the Network asked last. Never throws; undefined fails closed to the offline rules. */
  private async understandSafely(msg: InboundMessage): Promise<Understood | undefined> {
    const fn = this.opts.understand;
    if (!fn || msg.keyword || msg.reaction || !msg.body?.trim()) return undefined;
    const m = this.members.get(msg.memberId);
    if (!m || m.stage === "new" || m.optedOut || m.account || !this.trust.ok(m.id) || this.reportHeld(m.id)) return undefined;
    const aw = m.awaiting;
    const options = aw?.kind === "probe" && aw.oppId ? this.opps.get(aw.oppId)?.offered?.[m.id] : undefined;
    if (this.canShortCircuitUnderstand(m, msg.body, aw, options)) return undefined;
    try { return await fn(msg.body, { city: this.networkCity(), ...(aw ? { awaiting: aw.kind } : {}), ...(options?.length ? { options } : {}) }); } catch { return undefined; }
  }

  /** An inbound message answers everything pending and is the only thing that resets the unanswered rules. */
  private heardFrom(m: MemberState) {
    m.pendingAsks = []; m.unanswered = unansweredInviteCountAfterInbound(m.unanswered, true); m.outbound = 0; m.openAskAt = undefined; m.reengaged = false;
    if (m.onlyWhenAsked) { m.onlyWhenAsked = false; this.ctx.log("outreach_resumed", { memberId: m.id }); }
  }

  /** A fresh, signed follow-up choice is engagement without answering an unrelated pending question. */
  noteGatheringFollowupReply(id: MemberId): void {
    if (this.app.id !== "ntwrk" || this.declinedIds.has(id)) return;
    const member = this.members.get(id);
    if (!member || member.optedOut || member.account) return;
    this.noteHandledReply(member);
  }

  photoMemberHeard(id: MemberId): void {
    if (!this.record(id) || this.declinedIds.has(id)) return;
    const member = this.member(id);
    if (member.optedOut || member.account) return;
    this.noteHandledReply(member);
  }

  private noteHandledReply(member: MemberState): void {
    this.dirty = true;
    const now = this.now();
    member.lastInbound = Math.max(member.lastInbound, now);
    member.msgsIn++;
    member.replies = [...(member.replies ?? []), now].slice(-60);
    member.unsolStreak = 0;
    this.heardFrom(member);
  }

  /**
   * The offline reading plus what the LLM reader added: wants, interests and skills it found that the
   * rules missed, and an age (which can only make the member younger). Negated wants stay out.
   */
  private withUnderstanding(c: Classified, u: Understood | undefined): Classified {
    if (!u) return c;
    const out: Classified = { ...c, tags: [...c.tags] };
    const notWanted = new Set([...(c.notWanted ?? []), ...u.notWanted]);
    if (notWanted.size) out.notWanted = [...notWanted];
    if (u.selfAge !== undefined && (out.statedAge === undefined || u.selfAge < out.statedAge)) { out.statedAge = u.selfAge; if (isMinor(u.selfAge)) out.minorSignal = true; }
    for (const t of [...u.interests, ...u.skills]) if (!out.tags.includes(t)) out.tags.push(t);
    if (out.desireId && notWanted.has(out.desireId)) { delete out.desireId; if (out.kind === "people_request") out.kind = "other"; }
    const want = u.wants.find(w => !notWanted.has(w));
    if (!out.desireId && want && !out.abuse.length && (out.kind === "other" || out.kind === "ack" || out.kind === "people_request")) {
      const def = desireById.get(want)!;
      out.desireId = def.id; out.category = def.category; out.kind = "people_request";
      for (const t of def.needsInterests) if (!out.tags.includes(t)) out.tags.push(t);
    }
    return out;
  }

  /** Yes, no or neither for a plain yes-or-no question; the LLM's answer counts only where the rules found no signal. */
  private yesNoOf(body: string): "yes" | "no" | "counter" | "unclear" {
    const c = consentOf(body);
    const u = this.understood?.consent;
    if (c.answer === "unclear" && c.why === "none" && (u === "yes" || u === "no")) return u;
    return c.answer;
  }

  private handleInbound(m: MemberState, msg: InboundMessage, privateInviteTurn: boolean, replyOpen: boolean, currentDanger: boolean,
    priorInboundAt: number, queueCofounderIntent?: (intent: Intent) => void, reportChoice?: PendingReportChoice) {
    const now = this.now();
    if (msg.keyword === "STOP") { m.optedOut = true; m.pendingInviteDraft = undefined; m.interruptionSurvey = undefined; this.dropMember(m.id, "opted out"); return; }
    if (msg.keyword === "START") { m.optedOut = false; this.send(m, copy.stopWelcomeBack, { type: "info" }, "reply"); return; }
    if (msg.keyword === "HELP") return;
    let body = msg.body.trim();
    // Classify first, the first message included (audit P1-4): the age policy runs before the
    // welcome and before the trust-hold return (P2-17).
    const parsed = classify(body);
    let c = this.withUnderstanding(parsed, this.understood);
    const minDay = earliestDayKeyOf(now), maxDay = latestDayKeyOf(now);
    if (m.awaiting?.kind === "age") {
      const a = ageAnswer(body);
      if (a !== undefined) c = { ...c, statedAge: lowestAge(a, c.statedAge) ?? a, explicitAge: a, oldestAge: Math.max(a, c.oldestAge ?? a), minorSignal: c.minorSignal || isMinor(a) };
      const unclear = a === undefined && !currentDanger ? unclearBirthDateAnswer(body, minDay) : undefined;
      if (unclear) {
        this.send(m, this.copy.birthdayWhich(unclear.monthFirst, unclear.dayFirst), { type: "onboarding", proactive: false }, "interview", { hook: { t: "age" } });
        return;
      }
    }
    const birthDate = (m.awaiting?.kind === "age" ? birthDateAnswer(body, minDay) : undefined) ?? birthDateStated(body, minDay);
    const birthAge = birthDate === undefined ? undefined : ageOnDay(birthDate, minDay);
    if (birthAge !== undefined) {
      c = { ...c, statedAge: lowestAge(birthAge, c.statedAge) ?? birthAge, explicitAge: lowestAge(birthAge, c.explicitAge) ?? birthAge,
        oldestAge: Math.max(birthAge, c.oldestAge ?? birthAge), minorSignal: c.minorSignal || isMinor(birthAge) };
    }
    const statedBefore = statedAgeOn(m, minDay);
    if (c.statedAge !== undefined && (statedBefore === undefined || c.statedAge < statedBefore)) { m.statedAge = c.statedAge; m.statedAgeDay = minDay; }
    const wasMinor = m.minor;
    const attested = this.attestedAge(m);
    const statedNow = statedAgeOn(m, minDay);
    const known = attested ?? statedNow;
    const adultRecord = canBeMatched(attested);
    if ((attested !== undefined && !this.canJoinApp(attested)) || (c.explicitAge !== undefined && !this.canJoinApp(c.explicitAge) && !adultRecord)) {
      return this.declineUnderMinAge(m, Math.min(...[attested, c.explicitAge].filter((x): x is number => x !== undefined && !this.canJoinApp(x))), currentDanger);
    }
    const recordedBirth = birthDate !== undefined && birthdayRecorded(birthDate, minDay) ? birthDate : undefined;
    const storedBirth = this.record(m.id);
    const exactBirthAge = recordedBirth !== undefined && birthAge !== undefined ? birthAge
      : storedBirth?.birthExact === true && storedBirth.birthKey !== undefined ? ageOnDay(storedBirth.birthKey, minDay) : undefined;
    if (c.statedAge !== undefined && (exactBirthAge === undefined || c.statedAge < exactBirthAge)) {
      this.opts.onAgeStated?.(m.id, c.statedAge, { explicit: c.explicitAge === c.statedAge, declined: false });
    }
    if (recordedBirth !== undefined && birthAge !== undefined) this.opts.onAgeStated?.(m.id, birthAge, { explicit: true, declined: false, birthDate: recordedBirth });
    const record = this.record(m.id);
    const olderThanBirth = c.oldestAge !== undefined && (teenBirthDateContradicted(record?.birthExact === true, record?.birthKey ?? 0, minDay, maxDay, c.oldestAge)
      || (recordedBirth !== undefined && teenBirthDateContradicted(true, recordedBirth, minDay, maxDay, c.oldestAge)));
    if (olderThanBirth && !m.olderReported) this.teenAgeContradicted(m.id);
    this.noteAgeConflict(m, attested);
    const recordKnownMinor = validAge(attested) && isMinor(attested);
    const saysYounger = c.statedAge !== undefined && attested !== undefined && c.statedAge < attested;
    if (c.minorSignal && m.minor && minorSignalOpens(recordKnownMinor, saysYounger)) m.minorSignal = true;
    if (known === undefined) {
      if (!m.ageUnknown) { m.ageUnknown = true; this.ctx.log("age_unknown", { memberId: m.id }); }
    } else {
      // A stated age resolves a missing record age: 13-17 stays a minor, 18 or more is an adult
      // (unless something else they said reads like a minor).
      if (attested === undefined && m.minor && !isMinor(known) && !m.minorSignal && !m.ageConflict && !m.minorReported) { m.minor = false; this.ledgerAge(m); }
      if (m.ageUnknown) { m.ageUnknown = false; this.ctx.log("age_resolved", { memberId: m.id, minor: m.minor }); if (m.stage !== "new") this.ledgerJoined(m); }
    }
    const age = lowestAge(attested, statedNow);
    if ((isMinor(age) || c.minorSignal || m.minor) && !wasMinor) {
      this.applyMinorSignal(m, minorSignalOpens(recordKnownMinor, saysYounger), wasMinor);
      if (this.app.minJoinAge > 13) {
        if (currentDanger) this.safetyReply(m, "", true);
        return;
      }
      if (m.stage !== "new" && !currentDanger) {
        if (m.stage === "age") { if (m.awaiting?.kind === "age") m.awaiting = undefined; m.stage = "active"; }
        this.sendMinorNotice(m, "safety");
        return;
      }
    }
    if (!currentDanger && !m.optedOut && m.stage !== "new" && m.stage !== "age"
      && minorScopeNoticeDue(m.minor, soloTeenApp(this.app.id), m.minorScopeToldAt !== undefined)) this.sendMinorNotice(m, "safety");
    if (currentDanger) return this.handleImmediateDanger(m, msg, c);
    if (m.stage === "new") {
      if (body.trim() && !msg.keyword) this.learnFrom(m, body);
      return this.welcome(m);
    }
    if (m.stage === "age" && this.afterAgeQuestion(m, known !== undefined)) return;

    // Blocks and reports first: their words describe someone else, so they are never scored as the
    // sender's abuse, and a member on hold can still block (network-consent-4).
    // spec/postingPolicy.md, "Only the member's own text in the thread issues a command"
    const command = inboundMayCommand(msg.source ?? "thread");
    if (this.memberReply && !msg.reaction && this.calendarOptIn(m, body, msg.ts)) return;
    const checkInQuestion = m.pendingSafety?.verb === "check_in" ? m.pendingSafety : undefined;
    if (checkInQuestion && command && !msg.reaction && this.answerCheckInSafety(m, checkInQuestion, c, body, msg.signedReceivedAt ?? msg.ts)) return;
    if ((c.kind === "block" || c.kind === "report") && command) return this.handleBlock(m, c);
    // Nor is the assistant's block or report scored as the member's abuse: its words describe someone
    // else (network-consent-4), and a watch would drop the member and cancel a booked date. Learned only.
    if (c.kind === "block" || c.kind === "report") return this.learnFrom(m, body);
    if (reportChoice) {
      const names = pendingReportReplyNames(body);
      const matches = this.memberReply && command && !msg.reaction && names.length && msg.signedReceivedAt !== undefined
        ? this.pendingReportChoices(m.id, names, msg.signedReceivedAt) : [];
      const current = matches[0];
      if (matches.length === 1 && current?.routable && current.askedAt === reportChoice.askedAt
        && current.targetId === reportChoice.targetId && current.kind === reportChoice.kind) {
        m.pendingSafety = undefined;
        this.applyBlock(m, "report", current.kind, this.members.get(current.targetId));
      }
      return;
    }
    // The answer to "Who do you mean?" (a block or report waiting for its target): the member's own text only.
    const whoQuestion = m.pendingSafety?.verb === "check_in" ? undefined : m.pendingSafety;
    if (whoQuestion && command) {
      const remaining = this.answerWho(m, whoQuestion, body, msg.signedReceivedAt);
      if (remaining === undefined) return;
      if (remaining !== body) {
        body = remaining;
        this.understood = undefined;
        c = classify(body);
      }
    }
    if (this.trust.level(m.id) === "hold") { if (c.abuse.length) this.trust.add(m.id, now, c.abuse[0]!, 0); return; }
    // "He asked me to venmo him $50": what someone else did, never the sender's abuse (ids and kinds only).
    if (c.disclosure?.length) this.ctx.log("abuse_disclosed", { memberId: m.id, kinds: c.disclosure });
    // Inside a mutual match, "can I get her number?" asks for a number swap (the relay: Eliza's RELAY
    // contact_share, then both must say yes), never the sender's abuse: it goes to the agent unscored.
    if (c.abuse.length && command && !privateInviteTurn && this.swapAsk(m, c, body)) return "open" as const;
    if (c.abuse.length && !this.handleAbuse(m, c, body)) return;
    if (c.pitchSlap && !m.minor) {
      const cutoff = now - 90 * DAY;
      m.pitchSignals = [...(m.pitchSignals ?? []).filter(t => t >= cutoff), now].slice(-20);
      if (!(m.appTags ?? []).some(t => t.tag === "hv:hype:pitch")) {
        m.appTags = [...(m.appTags ?? []), { tag: "hv:hype:pitch", kind: "trait", scope: "agent_private", at: now }];
      }
      this.dirty = true;
    }

    if (privateInviteTurn) {
      if (!c.abuse.length && this.opts.memberInviteTurnAllowed?.(m.id, msg.id)) this.handleInviteVouchTurn(m, msg.id, body);
      return;
    }

    if (!command) return this.learnAssistantProfile(m, c, parsed, body, msg.id);

    const surveyAnswer = interruptionFeedbackAnswer(body) ?? this.plainInterruptionSurveyAnswer(m, body, Boolean(msg.reaction));
    if (surveyAnswer) return this.recordInterruptionFeedback(m, surveyAnswer, now, msg.ts);

    if (!msg.reaction && !c.abuse.length && isLateArrivalReport(body)
      && this.opts.lateArrivalTurnAllowed?.(m.id, msg.id) && this.handleLateArrival(m, now, msg.signedReceivedAt ?? msg.ts)) return;

    if (!msg.reaction && !c.abuse.length && m.awaiting?.kind !== "probe" && (!isLateArrivalReport(body) || !this.opts.lateArrivalTurnAllowed)
      && this.meetups.activeMeetupFor(m.id, now)) {
      const arrival = this.meetups.handleInbound(m.id, body, now);
      if (arrival.handled) {
        if (arrival.meetupId) {
          const opp = this.opps.get(arrival.meetupId);
          if (arrival.pivotedToVenueId) {
            const nextVenue = this.venues.getVenue(arrival.pivotedToVenueId);
            if (opp && nextVenue) {
              opp.venueId = nextVenue.id;
              opp.venue = nextVenue.name;
              opp.venueArea = nextVenue.neighborhood;
              opp.backupPivoted = true;
            }
          } else if (arrival.state === "venue_closed" || arrival.state === "venue_full") {
            this.handleMeetupVenueDisruption(m, arrival.meetupId, arrival.state, now);
          }
        }
        return;
      }
    }

    if (parsed.cofounderAffirmed) {
      // spec/cofounderIntent.md, "Save only the current member's own affirmative goal"
      const eligible = !c.abuse.length && !m.minor && !m.minorSignal && !m.ageConflict && !m.ageUnknown
        && !m.account && !m.optedOut && canBeMatched(age) && this.trust.ok(m.id) && !this.reportHeld(m.id);
      if (!queueCofounderIntent || !canSaveCofounderIntent(this.app.id, true, true, eligible)) return "open" as const;
      queueCofounderIntent({
        id: `cofounder:${sha256(stableStringify([this.app.id, m.id, msg.id]))}`,
        memberId: m.id, objective: cofounderIntentObjective, category: "professional",
        details: cofounderIntentDetails, horizonDays: learnedIntentDays, status: "active", createdAt: now,
      });
      return;
    }

    if (c.kind === "people_request" && c.category === "help" && this.allowedCategories.has("help")
      && this.opts.homeHelpIntakePrompt && this.routeBoundedHelp(m, body, false)) return;

    // peon (#9): a job post by text, read back and saved only on the manager's yes (rules only, never an open-turn LLM output).
    if (this.opts.hooks?.postings && this.postingTurn(m, body)) return;

    if (c.kind === "cofounder_goal") return "open" as const;

    const closed = this.closeNegatedStanding(m, parsed.notWanted ?? [], msg.id);
    if (closed && c.kind !== "people_request" && c.kind !== "plans_request") return this.learnFrom(m, body);

    const pendingReply = m.awaiting;
    const eligibleReply = !c.pastAbsence || pendingReply?.kind === "feedback";
    const aw = pendingReply?.kind === "interview" || eligibleReply ? pendingReply : undefined;
    const tz = this.cityTz();
    const upcomingBookings = this.memberReply && !msg.reaction
      ? [...this.opps.values()].filter(o => o.meetingAt !== undefined && upcomingCancellationEligible(
        opportunityLifecycle(o), o.participants.includes(m.id), o.status.get(m.id) === "yes", true, o.meetingAt, now))
      : [];
    const openRescheduleOffers = this.memberReply && !msg.reaction
      ? [...this.opps.values()].filter(o => o.reschedule?.offered.includes(m.id) && !o.reschedule.accepted.includes(m.id) && this.currentReschedule(o, o.reschedule, now))
      : [];
    const strictReschedule = /^RESCHEDULE\b/i.test(body.trim());
    const openOfferRef = openRescheduleOffers.length === 1 ? rescheduleMemberRef(openRescheduleOffers[0]!.reschedule!, m.id) : undefined;
    const singleOriginalAt = upcomingBookings.length === 1 ? upcomingBookings[0]!.meetingAt : undefined;
    const reschedule = this.memberReply && !msg.reaction
      ? (strictReschedule
        ? parseRescheduleCommand(body, tz)
        : (aw?.kind === "probe" || aw?.kind === "feedback" || aw?.kind === "interview"
          ? undefined
          : parseNaturalReschedule(body, { nowMs: now, tz, originalAt: singleOriginalAt, openRef: openOfferRef })))
      : undefined;
    if (reschedule) return this.handleMeetingReschedule(m, reschedule, msg.id, msg.signedReceivedAt ?? msg.ts, now, !strictReschedule);
    const directBookingReply = this.memberReply && !msg.reaction;
    const bookingText = directBookingReply ? body : "";
    const cancellation = explicitBookingCancellation(bookingText);
    const cancelDay = cancellation?.day ? bookingCancellationDay(cancellation.day, msg.signedReceivedAt ?? msg.ts, tz) : undefined;
    // spec/opportunityLifecycle.md, "An explicit cancellation selects the named upcoming meeting"
    if (cancellation?.needsExactStart) {
      if (upcomingBookings.length === 1 && aw?.kind !== "booked") {
        this.handleDrop(m, upcomingBookings[0]!, true, true);
        return;
      }
      this.send(m, this.copy.bookingStartToCancelFor(this.networkCity()), { type: "info" }, "reply");
      return;
    }
    if (cancellation && (cancellation.localStart || cancelDay)
      && this.handleExplicitCancellation(m, cancellation, now, false, cancelDay)) return;
    if (aw?.kind === "probe" && this.opps.get(aw.oppId!)?.plan) {
      // A plan probe: yes or no to that plan at that time ("can't make that time" is a no, and a time they are not free).
      const po = this.opps.get(aw.oppId!)!;
      const receiptKey = po.replacementFor ? replacementProbeKey(po.id, m.id)
        : probeReplyReceiptKey(po.id, m.id, planProbeReceiptSlot(po.id, po.sentAt?.[m.id] ?? aw.at, m));
      const delivery = this.ctx.initialInviteReceipt?.(receiptKey);
      const acceptedAt = this.ctx.initialInviteReceipt ? (delivery?.kind === "accepted" ? delivery.at : undefined) : aw.at;
      const allowed = po.replacementFor ? replacementAnswerAllowed(this.memberReply, acceptedAt !== undefined, msg.ts, acceptedAt ?? now)
        : planProbeReplyCurrent(this.memberReply, acceptedAt !== undefined, msg.signedReceivedAt ?? msg.ts, acceptedAt ?? now, now);
      if (!allowed) return "open" as const;
      if (po.plan?.reviewedOptions) {
        // spec/friendsPlanTimeChoice.md. A reaction or an LLM reading cannot select an offered time.
        const offered = po.offered?.[m.id];
        if (msg.reaction || !offered?.length) return "open" as const;
        const reply = parseFriendsPlanTimeReply(body, offered);
        if (reply.answer === "yes" || reply.answer === "no") {
          m.awaiting = undefined;
          return this.onPlanProbeAnswer(m, po, reply.answer === "yes", body, reply.picks);
        }
        if (this.clarify(m, aw, c, copy.probeTimeClarify)) return;
        return "open" as const;
      }
      const yn0 = po.replacementFor ? consentOf(body).answer : this.yesNoOf(body);
      // spec/probeReply.md, "A model reading cannot replace a definite or qualified answer": a yes that
      // names a time other than the plan's one time ("yes, Friday 7pm") is asked again, never booked.
      const planTime: TimeOption = { key: "a", start: po.plan!.window.start, end: po.plan!.window.end, label: attention.timeOptionsPhrase([po.plan!.window], tz) };
      const yn = yn0 === "yes" && parseProbeReply(body, [planTime]).why === "slot" ? "unclear" : yn0;
      if (yn === "yes" || yn === "no") { m.awaiting = undefined; return this.onPlanProbeAnswer(m, po, yn === "yes", body); }
      if (yn === "unclear" && this.clarify(m, aw, c)) return;
    } else if (aw?.kind === "probe") {
      const o = this.opps.get(aw.oppId!);
      const options = o?.offered?.[m.id] ?? [];
      if (o?.seat) {
        if (!this.currentHireSeat(o.seat, o.participants)) return this.close(o, "peon_search_changed", { releasePartial: true });
        const receipt = this.ctx.initialInviteReceipt?.(probeReplyReceiptKey(o.id, m.id, aw));
        const acceptedAt = this.ctx.initialInviteReceipt ? (receipt?.kind === "accepted" ? receipt.at : undefined) : aw.at;
        const deadline = o.seat.manager === m.id ? this.managerProbeDeadline(o, m.id) : o.deadline;
        if (!hireAnswerAllowed(this.memberReply && !msg.reaction, acceptedAt !== undefined,
          msg.signedReceivedAt ?? msg.ts, acceptedAt ?? now, now, deadline)) return "open" as const;
      }
      if (this.app.id === "slop" && o?.category === "romance") {
        const receipt = this.ctx.initialInviteReceipt?.(probeReplyReceiptKey(o.id, m.id, aw));
        const acceptedAt = this.ctx.initialInviteReceipt ? (receipt?.kind === "accepted" ? receipt.at : undefined) : aw.at;
        // spec/probeDispatch.md, "A Slop answer follows acceptance of the exact question"
        if (!slopProbeReplyCurrent(this.memberReply && !msg.reaction, acceptedAt !== undefined, msg.ts, acceptedAt ?? now)) return "open" as const;
      }
      const gathering = !!o && isGatheringRepeat(o);
      if (gathering) {
        if (!this.repeatSourceCurrent(o)) return this.close(o, "gathering repeat consent changed");
        const key = gatheringRepeatProbeKey(o.id, m.id, o.timeRetry?.includes(m.id));
        const receipt = this.ctx.initialInviteReceipt?.(key);
        const acceptedAt = this.ctx.initialInviteReceipt ? (receipt?.kind === "accepted" ? receipt.at : undefined) : aw.at;
        if (!gatheringRepeatMayAnswer(true, this.memberReply && !msg.reaction, acceptedAt !== undefined, msg.ts, acceptedAt ?? now)) return "open" as const;
      }
      const parsedAnswer = parseProbeReply(body, options, false, { now, tz });
      // spec/probeReply.md, "An unresolved offered time needs a time choice"
      const legacyClarified = aw.clarified === true && aw.timeChoice === undefined;
      const timeChoice = probeNeedsExplicitTimeChoice(options.length > 0, aw.timeChoice === true, legacyClarified, false);
      const explicit = timeChoice && parsedAnswer.answer === "yes" && parsedAnswer.keys.length > 0
        ? parseProbeReply(body, options, "clarified", { now, tz }) : undefined;
      const timeReading = clarifiedProbeTimeReading(timeChoice, parsedAnswer.answer, parsedAnswer.keys.length,
        explicit?.answer === "yes" ? explicit.keys.length : 0);
      let r = gathering || timeChoice ? parsedAnswer : mergeConsent(parsedAnswer, this.understood, options);
      if (timeReading === "UseExplicitProbeTimes") r = explicit!;
      if (timeReading === "AwaitExplicitProbeTimes") r = { answer: "unclear", keys: [], why: "slot" };
      // spec/probeReply.md, "A short acknowledgement must immediately follow its own probe"
      if (o && r.answer !== "unclear" && ACK_ONLY.test(body.trim())) {
        const key = gathering ? gatheringRepeatProbeKey(o.id, m.id, o.timeRetry?.includes(m.id)) : probeReplyReceiptKey(o.id, m.id, aw);
        const receipt = this.ctx.initialInviteReceipt?.(key);
        const acceptedAt = this.ctx.initialInviteReceipt ? (receipt?.kind === "accepted" ? receipt.at : undefined) : aw.at;
        const uninterrupted = aw.probeInboundCount === undefined ? priorInboundAt <= aw.at : m.msgsIn === aw.probeInboundCount + 1;
        if (!weakProbeAcknowledgementAllowed(this.memberReply, latestOutboundMatchesProbe(m.lastSent, o.id, aw.at), uninterrupted,
          this.outboundBefore, acceptedAt !== undefined, acceptedAt ?? 0, msg.signedReceivedAt ?? msg.ts, now)) {
          r = { ...r, answer: "unclear" };
        }
      }
      if (r.answer !== "unclear") {
        const priorCounterBody = aw.counterBody;
        m.awaiting = undefined;
        return this.onProbeAnswer(m, aw.oppId!, r.answer === "yes", r.keys, body, priorCounterBody);
      }
      if ((r.why === "counter" || r.why === "slot") && o && o.participants.length === 2 && !o.counterProposed) {
        aw.counterBody = body;
      }
      if (o && options.length > 0 && !o.timeRetry?.includes(m.id) && isProbeCounterTime(body, options)) {
        const priorCounterBody = aw.counterBody;
        m.awaiting = undefined;
        return this.onProbeAnswer(m, aw.oppId!, true, [], body, priorCounterBody);
      }
      const askForTimes = probeNeedsExplicitTimeChoice(options.length > 0, aw.timeChoice === true, legacyClarified, r.why === "slot");
      if (askForTimes ? this.clarify(m, aw, c, copy.probeTimeClarify, true) : this.clarify(m, aw, c)) return;
    }
    if (!pendingReply && m.endedProbe && this.lateProbeAnswer(m, m.endedProbe, msg, body, now)) return;
    if (this.weeklyOptIn(m, body)) return;
    if (aw?.kind === "crew" && aw.crewId) {
      const yn = this.yesNoOf(body);
      if (yn === "yes" || yn === "no") {
        const offer = this.crewOffers.find(c => c.crew.id === aw.crewId && !c.resolved);
        const receipt = aw.crewOfferReceiptId ? this.ctx.initialInviteReceipt?.(aw.crewOfferReceiptId) : undefined;
        const acceptedAt = this.ctx.initialInviteReceipt ? (receipt?.kind === "accepted" ? receipt.at : undefined) : aw.at;
        // spec/crewOffer.md, "A crew reply follows acceptance of its exact offer"
        if (!offer || !crewOfferReplyCurrent(this.memberReply && !msg.reaction, acceptedAt !== undefined, offer.at,
          aw.at, acceptedAt ?? -1, msg.signedReceivedAt ?? msg.ts, now)) return "open" as const;
        m.awaiting = undefined;
        return this.onCrewAnswer(m, offer, yn === "yes");
      }
    }
    if (aw?.kind === "booked") {
      // spec/opportunityLifecycle.md, "A closed booking releases its pending replies"
      const o = this.opps.get(aw.oppId!);
      const checkIn = aw.bookedCheckIn;
      // spec/meetingSettlement.md, "The day-of check-in uses one near-meeting message"
      const checkInCurrent = !checkIn || dayOfReplyAccepted(o?.meetingAt === checkIn.meetingAt && (o.scheduleRevision ?? 0) === checkIn.revision,
        localDateParts(now, tz).day === localDateParts(checkIn.meetingAt, tz).day, checkIn.meetingAt - now);
      if (!o || !checkInCurrent || !bookedReplyCurrent(opportunityLifecycle(o), o.status.get(m.id) === "yes")) {
        m.awaiting = undefined;
      } else {
        const yn = this.yesNoOf(body);
        const venueObj = !msg.reaction && !cancellation && !o.workIntro && !o.seat && !o.publicEventRevision && !o.plan?.eventId
          ? bookedVenueObjection(body, yn)
          : undefined;
        if (venueObj && this.handleBookedVenueObjection(m, o, body, venueObj, now)) return;
        // spec/opportunityLifecycle.md, "A number-swap refusal does not decline the booked meeting"
        const venueChange = venueChangeKeepsBooking(bookingText);
        const declines = !venueChange && (bookedTextDeclines(bookingText, cancellation !== undefined || c.kind === "cancel" || yn === "no") || declinesBookedAttendance(bookingText));
        const confirms = !venueChange && (yn === "yes" || c.kind === "ack");
        if (checkIn && (declines || confirms)) {
          const receipt = this.ctx.initialInviteReceipt?.(bookedReminderKey("day-of-checkin", o.id, m.id, checkIn.revision));
          const acceptedAt = this.ctx.initialInviteReceipt ? (receipt?.kind === "accepted" ? receipt.at : undefined) : aw.at;
          const receivedAt = msg.signedReceivedAt ?? msg.ts;
          if (!dayOfCheckInAnswerCurrent(acceptedAt !== undefined, acceptedAt ?? 0, receivedAt, now)) {
            // An independent cancellation request still uses the upcoming-booking selector.
            if (cancellation) this.handleExplicitCancellation(m, cancellation, now, false);
            return;
          }
        }
        if (!checkIn && directBookingReply && !o.plan && !o.workIntro && !o.publicEventRevision && o.meetingAt !== undefined && o.meetingAt > now
          && !declines && !cancellation && !CANCEL_INTENT_OVERRIDE_RX.test(bookingText) && VENUE_SWAP_INTENT_RX.test(bookingText)) {
          const initialState = this.proposeTopOneVenueFor(o.participants, o.meetingAt, {
            city: this.networkCity(),
            teenFriendAllowed: o.teenRuleAt !== undefined,
          });
          const pivoted = this.pivotVenueSuggestion(initialState, body);
          const nextSpot = pivoted.state.current?.venue && pivoted.state.current.venue.id !== o.venueId
            ? pivoted.state.current.venue
            : pivoted.state.backup?.venue && pivoted.state.backup.venue.id !== o.venueId
              ? pivoted.state.backup.venue
              : undefined;
          if (nextSpot) {
            const oldVenueId = o.venueId;
            o.venueId = nextSpot.id;
            o.venue = nextSpot.name;
            o.venueArea = nextSpot.neighborhood;
            this.ctx.log("venue_swapped", { oppId: o.id, memberId: m.id, fromVenueId: oldVenueId ?? null, toVenueId: nextSpot.id, reason: pivoted.reason });
            this.send(m, this.copy.venueSwapProposed(nextSpot.name, nextSpot.neighborhood), { type: "scheduling", proposalId: o.id }, "reply");
            const whenStr = whenPhrase(o.meetingAt, o.meetingTimeZone ?? tz);
            for (const otherId of o.participants) {
              if (otherId === m.id || o.status.get(otherId) !== "yes" || !o.bookedTold?.includes(otherId)) continue;
              this.send(this.member(otherId), this.copy.silentPartnerVenueSwap(whenStr, nextSpot.name, { area: nextSpot.neighborhood }),
                { type: "scheduling", proposalId: o.id }, "scheduling", { about: o.participants });
            }
            return;
          }
        }
        if (declines) {
          return this.handleDrop(m, o, true, !msg.reaction && bookedTextDeclines(bookingText, cancellation !== undefined || c.kind === "cancel" || consentOf(body).answer === "no"));
        }
        if (confirms) {
          m.awaiting = undefined;
          this.confirmPlan(o, m.id, true);
          this.ack(m, copy.bookedThanks, { direct: !whoQuestion });
          return;
        }
      }
    }
    if (!msg.reaction && !c.pastAbsence && !withdrawsSwap(body) && !bookedReplyKeepsMeeting(bookingText)
      && this.withdrawAcceptedProbe(m, body, replyOpen || !!aw)) return;
    if (cancellation && this.handleExplicitCancellation(m, cancellation, now)) return;
    if (aw?.kind === "checkin") {
      const directAnswer = this.memberReply && !msg.reaction;
      if (directAnswer) m.awaiting = undefined;
      const tags = availabilityTags(body, now, tz);
      const evidence = weeklyCheckinEvidence(directAnswer, tags.length > 0, explicitlyBusyThisWeek(body));
      if (evidence !== "KeepEarlier") {
        const stated = evidence === "RecordWindows"
          ? statedWindows(tags, now, this.cityTz()) : { windows: [], at: now, until: now + weeklyCheckinEvidenceMs };
        if (evidence === "RecordWindows") m.availability = [...(m.availability ?? []), { tags, at: now }].slice(-8);
        if (stated) {
          m.stated = stated;
          m.hints = evidence === "RecordWindows" ? activityHints(extractProfile(body).interests) : [];
        }
        this.ctx.log("availability_stated", { memberId: m.id, tags, windows: stated?.windows.length ?? 0 });
        if (c.kind !== "people_request" && c.kind !== "plans_request") { this.ack(m, "Got it, thanks.", { direct: true }); return; }
      }
    }
    const isRequest = c.kind === "people_request" || c.kind === "plans_request";
    const factualFeedback = c.kind === "other" && this.explicitlyConfirmsAttendance(body, true);
    if ((aw?.kind === "feedback" && !isRequest && c.kind !== "invite_friend") || ((c.kind === "feedback_like" || factualFeedback) && aw?.kind !== "interview")) {
      // spec/meetingSettlement.md, "A feedback reply needs receipt of its exact prompt"
      const o = aw?.kind === "feedback" ? this.opps.get(aw.oppId!) : this.feedbackDue(m, now);
      if (o && this.feedbackCandidate(m.id, o, now)) {
        const f = feedbackOf(body);
        const ack = c.kind === "ack" && f.sentiment === "neutral" && !f.selfNoShow && !f.otherNoShow && !(o.plan && planAgainOf(body) !== "unclear");
        const receiptAt = this.feedbackReceiptAt(o, m.id);
        const receivedAt = msg.signedReceivedAt ?? msg.ts;
        if (!ack && meetingFeedbackReplyAllowed(this.memberReply && !msg.reaction, true, receiptAt !== undefined,
          receiptAt ?? -1, receivedAt, now)) {
          if (m.awaiting?.kind === "feedback" && m.awaiting.oppId === o.id) m.awaiting = undefined;
          const start = o.meetingAt!;
          const canSettle = o.workIntro
            ? !o.finalized && now < (o.workIntro.followupDueAt ?? start) + settlementDelayDays * DAY
            : meetingFeedbackCanSettle(!!o.finalized, receivedAt - start, now - start);
          return this.onFeedback(m, o, body, f, canSettle);
        }
        return;
      }
      if (m.awaiting?.kind === "feedback" && m.awaiting === aw) m.awaiting = undefined;
      if (c.kind === "feedback_like") return;
    }
    // Not while another question waits for its answer (a probe, a booked plan, a crew): those words are about that.
    if (!isRequest && !checkInQuestion && c.kind !== "invite_friend" && (!aw || aw.kind === "checkin" || aw.kind === "growth")
      && this.lateCheckInReport(m, body, msg.signedReceivedAt ?? msg.ts)) return;
    if (aw?.kind === "interview" && aw.ask) return this.onAskAnswer(m, aw.ask, c, body);
    // The tick ends the wait for an answer after 3 days: a later message that answers the last question is still its answer (SD-427).
    const late = aw ? undefined : this.lateAnswer(m, body);
    if (late) return this.onAskAnswer(m, late, c, body);
    // A growth ask's answer can be just the friend's name ("My friend Maya!", "Maya").
    // A one-word answer is a name only when it is not an answer word: "Yes!" invites nobody called "Yes".
    const lone = /^\W*([A-Z][a-z]+)\W*$/.exec(body)?.[1];
    const loneName = lone && !NOT_A_NAME.test(lone) && consentOf(lone).answer === "unclear" ? lone : undefined;
    const friend = c.friendName ?? (aw?.kind === "growth" && !isRequest ? (/\b[Mm]y (?:friend|buddy|pal|coworker|roommate|cousin) ([A-Z][a-z]+)\b/.exec(body)?.[1] ?? loneName) : undefined);
    if (friend && (c.kind === "invite_friend" || aw?.kind === "growth") && !this.opts.issueMemberInvite) {
      m.awaiting = undefined;
      return this.invite(m, friend);
    }
    if (aw?.kind === "growth") m.awaiting = undefined; // they moved on; don't swallow what they said
    return this.requestIntake(m, aw, c, body, c.kind === "plans_request" || (c.kind === "people_request" && c.directPeopleAsk === true));
  }

  private learnAssistantProfile(m: MemberState, c: Classified, parsed: Classified, body: string, causeId: string) {
    const interview = m.awaiting?.kind === "interview" ? m.awaiting : undefined;
    this.checkAssistantNegations(m, parsed.notWanted ?? [], causeId);
    if (parsed.cofounderAffirmed) return this.learnFromProfile(m, undefined, c, body);
    if (c.kind !== "people_request") return this.learnFromProfile(m, interview, c, body);
    if (interview?.ask) return this.onAskAnswer(m, interview.ask, c, body);
    return this.requestIntake(m, interview, c, body, false);
  }

  private requestIntake(m: MemberState, aw: MemberState["awaiting"], c: Classified, body: string, directRequest: boolean) {
    const isRequest = c.kind === "people_request" || c.kind === "plans_request";
    // A profile answer teaches us about the member. A direct ask can move past the initial interview.
    if (learnDuringRequestIntake(aw?.kind === "interview", m.stage !== "active", directRequest)) {
      this.onInterviewAnswer(m, body);
      // Only specific wants (a band, a climbing partner, a mentor): "new friends" is what everyone says.
      if (this.opts.onboardingRequests && c.kind === "people_request" && c.desireId && c.category !== "social" && !m.minor) this.openRequest(m, c, { quiet: true });
      return;
    }
    if (!isRequest && m.stage !== "active") this.activate(m); // onboarding stalled; carry on
    if (isRequest && m.stage !== "active") { this.activate(m); m.awaiting = undefined; }
    if (c.kind === "people_request" && (!m.minor || this.teenAdmitted(m.id))) return this.openRequest(m, c, {});
    if (c.kind === "plans_request" || c.kind === "people_request") return this.onPlans(m, c);
    if (m.minor && c.kind === "other" && body.length > 12) return this.concierge(m);
    if (ACK_ONLY.test(body)) return;
    return "open" as const;
  }

  private withdrawAcceptedProbe(member: MemberState, body: string, otherReplyOpen: boolean): boolean {
    const directRefusal = consentOf(body).answer === "no";
    if (!this.memberReply || !directRefusal || otherReplyOpen) return false;
    const matches = [...this.opps.values()].filter(opp => {
      const at = opp.sentAt?.[member.id];
      const accepted = opp.status.get(member.id) === "available" && opp.primed.has(member.id)
        || opp.planRun?.answers[member.id] === "yes";
      const sameProbe = latestOutboundMatchesProbe(member.lastSent, opp.id, at);
      return acceptedProbeCanWithdraw(opportunityLifecycle(opp), accepted, opp.contacted.has(member.id), sameProbe);
    });
    if (!acceptedProbeWithdrawalAllowed(this.memberReply, directRefusal, otherReplyOpen, matches.length)) return false;
    const opp = matches[0]!;
    opp.status.set(member.id, "no");
    if (opp.planRun) {
      for (const id of opp.participants) if (id !== member.id && opp.planRun.answers[id] === "yes") this.noteFor(id, copy.planNotTogether);
      opp.planRun = { ...opp.planRun, stage: "closed", answers: { ...opp.planRun.answers, [member.id]: "no" } };
    } else this.markDeclined(opp.participants, this.now(), member.id);
    this.ctx.log("probe_consent_withdrawn", { oppId: opp.id, memberId: member.id });
    this.close(opp, "consent withdrawn", { releasePartial: true });
    this.send(member, "No problem. I won't go ahead with that.", { type: "info" }, "reply");
    return true;
  }

  private handleExplicitCancellation(m: MemberState, request: BookingCancellation, now: number,
    bookedSlotAvailable = m.awaiting?.kind === "booked", date?: string): boolean {
    const tz = this.cityTz();
    const matches: Opp[] = [];
    for (const o of this.opps.values()) {
      const startAt = o.meetingAt;
      if (!upcomingCancellationEligible(opportunityLifecycle(o), o.participants.includes(m.id),
        o.status.get(m.id) === "yes", startAt !== undefined && Number.isFinite(startAt), startAt ?? 0, now)) continue;
      if (request.localStart !== undefined && localBookingStart(startAt!, tz) !== request.localStart) continue;
      if (date !== undefined && localDateParts(startAt!, tz).day !== date) continue;
      matches.push(o);
      if (matches.length === 2) break;
    }
    const action = unlinkedCancellation(this.memberReply, true, bookedSlotAvailable, request.localStart !== undefined || date !== undefined, matches.length);
    if (action === "NoCancellation") return false;
    if (action === "CancelMatchingBooking") this.handleDrop(m, matches[0]!, true, true);
    else this.send(m, action === "AskWhichBooking" ? this.copy.whichBookingToCancelFor(this.networkCity()) : this.copy.noBookingToCancel, { type: "info" }, "reply");
    return true;
  }

  private rescheduleRoster(o: Opp): MemberId[] {
    return [...new Set(o.participants.filter(id => o.status.get(id) === "yes"))].sort();
  }

  /** A collected signed reply can be replayed only while its exact offer or changed time still applies. */
  rescheduleReplyCurrent(memberId: MemberId, messageId: string): boolean {
    return [...this.opps.values()].some(o => {
      const roster = this.rescheduleRoster(o);
      return rescheduleNoticeCurrent({ ...o, current: o.stage === "scheduled" }, roster, memberId, messageId, this.now())
        && this.checkRecipient(memberId, "scheduling", { about: roster, reply: false, opp: o }).ok;
    });
  }

  private rescheduleSlotViable(o: Opp, roster: readonly MemberId[], start: number, now: number): boolean {
    if (o.publicEventRevision || o.plan?.eventId || o.anchor?.type === "event" || o.seat || o.workIntro || roster.length < 2
      || start > now + DEFAULT_ATTENTION.availability.horizonDays * DAY) return false;
    const city = this.networkCity(), tz = this.cityTz();
    const duration = o.plan ? o.plan.window.end - o.plan.window.start : DEFAULT_ATTENTION.availability.slotHours * HOUR;
    if (duration <= 0) return false;
    const slot = { start, end: start + duration };
    const planVenue = planVenuesForCity(city).find(place => o.plan?.venueId ? place.id === o.plan.venueId : place.name === o.venue && place.area === o.venueArea);
    let venueId: string | undefined;
    if (planVenue) {
      if (!plans.venueOpenForSlot(planVenue, slot, duration / MINUTE, tz)) return false;
      venueId = planVenue.id;
    } else {
      const pool = this.venuePoolForCity(city);
      const record = (o.venueId ? pool.find(v => v.id === o.venueId) ?? this.venues.getVenue(o.venueId) : undefined)
        ?? pool.find(v => v.name === o.venue && v.neighborhood === o.venueArea);
      if (!record || record.status !== "active" || !isVenueOpenAt(record, tz, start, Math.min(30, duration / MINUTE)).open) return false;
      const participantPrefs = this.participantVenuePrefsOf(roster);
      if (participantPrefs.some(p => p.hasRedLines)
        && !this.venueRecordPassesRedLines(record, participantPrefs.map(p => p.prefs), start, tz, o.teenRuleAt !== undefined)) return false;
      venueId = record.id;
    }
    if (!this.teenSlotAllowed(o, slot, venueId)) return false;
    return roster.every(id => {
      const member = this.members.get(id);
      if (!member || !this.checkRecipient(id, "scheduling", { about: [...roster], reply: false, opp: o }).ok
        || this.bookedNear(id, start, o.id)) return false;
      const availability = this.evidence(member, now, o.id);
      return plans.planWindowMatchesStated(member.stated, slot, now)
        && attention.availabilityProb(availability, slot, now) > 0;
    });
  }

  private currentReschedule(o: Opp, draft: RescheduleDraft, now: number): boolean {
    const roster = this.rescheduleRoster(o);
    return rescheduleDraftCurrent(o.stage === "scheduled", o.meetingAt === draft.originalAt, sameRescheduleRoster(draft.roster, roster),
      (o.scheduleRevision ?? 0) === draft.revision,
      rescheduleTimeEligible(now, draft.originalAt, draft.proposedAt, MIN_NOTICE, this.rescheduleSlotViable(o, roster, draft.proposedAt, now)),
      now, draft.expiresAt);
  }

  private handleMeetingReschedule(m: MemberState, command: RescheduleCommand, messageId: string, receivedAt: number, now: number, natural = false) {
    const reply = (body: string) => this.send(m, body, { type: "info" }, "reply");
    if (command.kind === "format") return reply(this.copy.rescheduleFormatFor(this.networkCity()));
    if (command.kind === "request") {
      const matches = [...this.opps.values()].filter(o => o.meetingAt === command.originalAt && upcomingCancellationEligible(
        opportunityLifecycle(o), o.participants.includes(m.id), o.status.get(m.id) === "yes", true, command.originalAt, now));
      // spec/meetingReschedule.md, "A request selects one future booking and one viable slot"
      if (!rescheduleBookingSelected(matches.length)) return reply(matches.length > 1 ? this.copy.whichBookingToReschedule : this.copy.noBookingToCancel);
      const o = matches[0]!;
      if (o.teenRuleAt !== undefined && !this.teenOppAllowed(o, this.teenRescheduleEnd(o, command.proposedAt))) return this.closeTeenItem(o, "age_changed");
      const roster = this.rescheduleRoster(o);
      const expiresAt = rescheduleDeadline(now, command.originalAt, command.proposedAt, MIN_NOTICE);
      if (expiresAt <= now || !rescheduleTimeEligible(now, command.originalAt, command.proposedAt, MIN_NOTICE,
        this.rescheduleSlotViable(o, roster, command.proposedAt, now))) return reply(this.copy.rescheduleUnavailable);
      if (o.reschedule && this.currentReschedule(o, o.reschedule, now)) return reply(this.copy.reschedulePending);
      const draft: RescheduleDraft = {
        ref: sha256(stableStringify([this.app.id, o.id, m.id, messageId, command.originalAt, command.proposedAt])),
        revision: o.scheduleRevision ?? 0, originalAt: command.originalAt, proposedAt: command.proposedAt,
        expiresAt, roster, offered: natural ? [m.id] : [], accepted: natural ? [m.id] : [],
      };
      o.reschedule = draft;
      const tz = this.cityTz(), tzLabel = timezoneLabel(this.networkCity());
      if (natural) {
        reply(this.copy.rescheduleRequested(describeBookingStart(draft.proposedAt, tz), tzLabel));
      }
      for (const id of roster) {
        if (natural && id === m.id) continue;
        const recipient = this.member(id), key = rescheduleOfferKey(draft, id);
        this.send(recipient, this.copy.rescheduleOffer(describeBookingStart(draft.originalAt, tz), describeBookingStart(draft.proposedAt, tz), rescheduleMemberRef(draft, id), tzLabel),
          { type: "scheduling", proposalId: o.id }, "scheduling", { about: roster, key, hook: { t: "reschedule_offer", oppId: o.id, key } });
      }
      return;
    }
    const matches = [...this.opps.values()].filter(item => item.reschedule?.offered.includes(m.id) && rescheduleMemberRef(item.reschedule, m.id) === command.ref);
    const o = matches.length === 1 ? matches[0] : undefined;
    const draft = o?.reschedule;
    if (!o || !draft) return reply(this.copy.rescheduleUnavailable);
    const current = this.currentReschedule(o, draft, now);
    const repeated = command.accepted && draft.accepted.includes(m.id);
    const receipt = this.ctx.initialInviteReceipt?.(rescheduleOfferKey(draft, m.id));
    const deliveredAt = this.ctx.initialInviteReceipt ? (receipt?.kind === "accepted" ? receipt.at : undefined) : draft.deliveredAt?.[m.id];
    const delivered = rescheduleAnswerAfterReceipt(deliveredAt !== undefined, deliveredAt ?? 0, receivedAt, now);
    const action = rescheduleVote(this.memberReply, current, delivered, repeated,
      command.accepted, draft.accepted.length + 1, draft.roster.length);
    if (action === "RejectVote") {
      if (!current) o.reschedule = undefined;
      return reply(repeated && current ? this.copy.reschedulePending : this.copy.rescheduleUnavailable);
    }
    if (action === "KeepOriginal") {
      o.reschedule = undefined;
      return reply(this.copy.rescheduleDeclined);
    }
    draft.accepted.push(m.id);
    if (action === "AwaitParticipants") return reply(this.copy.reschedulePending);
    this.commitMeetingReschedule(o, draft, now);
  }

  private teenRescheduleEnd(o: Opp, start: number): number {
    return start + (o.plan ? o.plan.window.end - o.plan.window.start : teenMeetingMs);
  }

  private commitMeetingReschedule(o: Opp, draft: RescheduleDraft, now: number) {
    o.reschedule = undefined;
    if (o.teenRuleAt !== undefined && !this.teenOppAllowed(o, this.teenRescheduleEnd(o, draft.proposedAt))) return this.closeTeenItem(o, "age_changed");
    o.meetingAt = draft.proposedAt;
    o.scheduleRevision = draft.revision + 1;
    o.reminded.clear();
    o.dayBeforeReminded = undefined;
    o.confirmed = [...draft.roster];
    o.explicit = [...draft.roster];
    if (o.plan && o.planRun) {
      const duration = o.plan.window.end - o.plan.window.start;
      o.plan = { ...o.plan, window: { start: draft.proposedAt, end: draft.proposedAt + duration } };
      const answers: plans.PlanRun["answers"] = Object.fromEntries(Object.entries(o.planRun.answers).map(([id, answer]) => [id, answer === "pending" ? "no" : answer]));
      o.planRun = { ...o.planRun, plan: o.plan, answers, bench: [] };
    }
    for (const id of o.participants) {
      const member = this.members.get(id);
      if (member?.awaiting?.oppId === o.id) member.awaiting = undefined;
      if (o.status.get(id) === "queued" || o.status.get(id) === "probing") o.status.set(id, "unavailable");
    }
    o.alternates = [];
    const city = this.networkCity(), tz = this.cityTz();
    o.followupAt = computeFollowupTimestamp(o.plan ? o.plan.window.end : draft.proposedAt + HOUR, tz).scheduledAt;
    this.ctx.recordMeeting({ proposalId: o.id, participants: draft.roster, at: draft.proposedAt, previousAt: draft.originalAt, city, kind: o.kind });
    this.ctx.log("meeting_rescheduled", { oppId: o.id, revision: o.scheduleRevision, previousAt: draft.originalAt, at: draft.proposedAt, changedAt: now });
    const tzLabel = timezoneLabel(city);
    for (const id of draft.roster) {
      const key = rescheduleUpdateKey(o.id, o.scheduleRevision, id);
      this.send(this.member(id), this.copy.rescheduleUpdated(describeBookingStart(draft.proposedAt, tz), tzLabel), {
        type: "scheduling", proposalId: o.id, bookingUpdate: { at: draft.proposedAt, revision: o.scheduleRevision },
      },
        "scheduling", { about: draft.roster, key, hook: { t: "reschedule_updated", oppId: o.id, key } });
    }
  }

  /**
   * A probe reply that is neither a clear yes nor a clear no (a conditional, a hedge, a mix): ask
   * once more, plainly. Nothing is booked or revealed on it. False when the message is something
   * else (a request, a cancel) or we already asked again for this probe.
   */
  private clarify(m: MemberState, aw: NonNullable<MemberState["awaiting"]>, c: Classified, text = copy.probeClarify, timeChoice = false): boolean {
    if (["people_request", "plans_request", "cancel", "invite_friend", "feedback_like", "block", "report"].includes(c.kind)
      || !probeClarificationMayAsk(timeChoice, aw.clarified === true, aw.timeChoice === true)) return false;
    aw.clarified = true;
    if (aw.kind === "probe") aw.timeChoice = timeChoice;
    this.ctx.log("probe_unclear", { oppId: aw.oppId ?? null, memberId: m.id });
    this.send(m, text, { type: "question", proactive: false, ...(aw.oppId ? { proposalId: aw.oppId } : {}) }, "reply");
    return true;
  }

  private calendarOptIn(m: MemberState, body: string, at: number): boolean {
    const command = calendarPreferenceCommand(body);
    if (!command) return false;
    const enabled = command === "enabled";
    if (enabled && !this.calendarOwnerEligible(m)) return true;
    if (!Number.isSafeInteger(at) || !calendarPreferenceMayApply(at, m.calendarChoiceAt ?? -1, enabled, m.calendar === true)) return true;
    m.calendar = enabled;
    m.calendarChoiceAt = at;
    if (enabled) this.counters.calendarOptIns++;
    this.ctx.log("calendar_consent", { memberId: m.id, on: enabled });
    this.send(m, enabled ? copy.calendarOptIn : copy.calendarOff, { type: "info" }, "reply");
    return true;
  }

  private weeklyOptIn(m: MemberState, body: string): boolean {
    const k = /^\W*(?:yes,?\s+)?weekly(\s+(?:check-?in\s+)?off)?\W*$/i.exec(body);
    if (!k) return false;
    const off = !!k[1];
    // Members aged 13-17 never get the weekly check-in (it exists to find times to meet people).
    if (m.minor) return false;
    m.weekly = !off;
    if (!off) this.counters.weeklyOptIns++;
    this.ctx.log("weekly_checkin_consent", { memberId: m.id, on: !off });
    this.send(m, off ? copy.weeklyOff : copy.weeklyOptIn, { type: "info" }, "reply");
    return true;
  }

  /** The age on the member record (attested at join), or undefined when it is missing or invalid. */
  private attestedAge(m: MemberState): number | undefined {
    if (!validAge(m.age)) {
      this.dirty = true;
      const a = this.snapshotCached().members.find(x => x.id === m.id)?.age;
      if (validAge(a)) { m.age = a; if (!m.minor && isMinor(a)) { m.minor = true; this.ledgerAge(m); } }
    }
    return validAge(m.age) ? m.age : undefined;
  }

  /**
   * Ids that leave this Network (opportunities, requests, engine runs) are stored in tables every app
   * shares, so another app's ids get the app as a prefix ("slop.nw-1-4"), and a city other than nyc
   * gets the app and the city ("ntwrk.sf.nw-1-1"). The ids of ntwrk:nyc stay as they were.
   */
  private sid(id: string) {
    if (this.opts.city !== "nyc") return `${this.app.id}.${this.opts.city}.${id}`;
    return this.app.id === "ntwrk" ? id : `${this.app.id}.${id}`;
  }

  /** The app's join age (core canJoin: 13+; an 18+ app also declines 13-17). */
  private rememberStatedAge(m: MemberState, age: number, explicit: boolean, attested: number | undefined) {
    const day = earliestDayKeyOf(this.now());
    const statedNow = statedAgeOn(m, day);
    if (statedNow === undefined || age < statedNow) { m.statedAge = age; m.statedAgeDay = day; }
    this.opts.onAgeStated?.(m.id, age, { explicit, declined: false });
    this.noteAgeConflict(m, attested);
  }

  private noteAgeConflict(m: MemberState, attested: number | undefined) {
    const stated = this.statedToday(m);
    if (stated === undefined || this.canJoinApp(stated) || m.ageConflict) return;
    m.ageConflict = true;
    this.ctx.log("age_conflict", { memberId: m.id, attestedAge: attested, statedAge: stated });
    this.caseEvent(m.id, { at: this.now(), kind: "age_conflict", points: 0 });
  }

  private applyMinorSignal(m: MemberState, opensSignal: boolean, wasMinor = m.minor) {
    m.minor = true;
    if (opensSignal) { m.minorSignal = true; this.opts.onMinorSignal?.(m.id); }
    if (wasMinor) return;
    this.ledgerAge(m);
    this.minorAfterContact(m.id);
    this.dropMember(m.id, "minors policy");
    // The adult interview stops: a minor is onboarded as "active", like welcome() does.
    if (m.stage === "q1" || m.stage === "q2" || m.stage === "q3") { m.stage = "active"; if (m.awaiting?.kind === "interview") m.awaiting = undefined; }
    this.ctx.log("minor_signal", { memberId: m.id });
    if (this.app.minJoinAge > 13) this.caseEvent(m.id, { at: this.now(), kind: "age_review", points: 0 });
  }

  private canJoinApp(age: number) { return canJoin(age) && age >= this.app.minJoinAge; }

  /** Under the app's join age (13 for ntwrk): decline once, kindly, and keep nothing but the fact that we declined. */
  private declineUnderMinAge(m: MemberState, age?: number, currentDanger = false) {
    // The safety record about the adults this member met is written first and survives the delete
    // (network-consent-3); the platform hears the age so other apps stop matching the person (-12).
    this.minorAfterContact(m.id);
    if (age !== undefined) this.opts.onAgeStated?.(m.id, age, { explicit: true, declined: true });
    // spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person"
    m.minor = true; m.minorSignal = true;
    this.dropMember(m.id, "minors policy");
    const decline = this.app.id === "ntwrk" ? UNDER_MIN_AGE_DECLINE : this.app.brand.underAge;
    if (currentDanger) this.safetyReply(m, decline, true);
    else this.send(m, decline, { type: "info" }, "safety");
    this.counters.joinDeclined++;
    this.ctx.log("join_declined", { reason: "under_min_age" });
    this.forget(m.id);
  }

  /**
   * Delete everything the Network holds about a member; only the id stays, to never message them
   * again. Opportunities, requests, questions and every other record that names them go too.
   */
  private forget(id: MemberId) {
    // Declined and their requests gone first, so closing their opportunities messages and logs nothing about them.
    this.declinedIds.add(id);
    this.venues.forgetMember(id);
    this.meetups.removeMember(id);
    for (let i = this.requests.length - 1; i >= 0; i--) if (this.requests[i]!.memberId === id) this.requests.splice(i, 1);
    this.dropMember(id, "declined");
    for (const [oppId, source] of this.gatheringRepeatSources) if (source.members.includes(id)) this.gatheringRepeatSources.delete(oppId);
    const names = [this.fullNames.get(id), this.members.get(id)?.display].filter((x): x is string => !!x && x !== id);
    const first = this.members.get(id)?.first;
    const scrub = (t: string) => names.reduce((x, n) => x.split(n).join("someone"), first ? t.replaceAll(copy.inviteeJoined(first), "") : t);
    for (const [oid, o] of [...this.opps]) {
      if (o.participants.includes(id) || o.requester === id) { this.opps.delete(oid); continue; }
      o.alternates = o.alternates.filter(x => x !== id);
      for (const set of [o.primed, o.contacted, o.reminded, o.feedbackFrom]) set.delete(id);
      o.status.delete(id); delete o.explanations[id];
      // Every per-member map and list too (network-consent-16): only declinedIds may keep the id.
      for (const k of ["offered", "picks", "turnAt", "sentAt", "bookedAt", "post", "feedbackPromptedAt", "lateArrivalReported", "settledAttendance", "seatProbeReplies"] as const) if (o[k]) delete (o[k] as Record<string, unknown>)[id];
      for (const k of ["explicit", "confirmed", "bookedTold", "dayBeforeReminded", "deferLogged", "timeRetry", "noShowCounted", "noAnswer"] as const) if (o[k]) o[k] = o[k]!.filter(x => x !== id);
      if (o.post) for (const v of Object.values(o.post)) {
        v.named = v.named.filter(x => x !== id);
        if (v.missing) v.missing = v.missing.filter(x => x !== id);
      }
      if (o.plan) o.plan = this.scrubPlan(o.plan, id);
      if (o.planRun) { const { [id]: _, ...answers } = o.planRun.answers; o.planRun = { ...o.planRun, plan: this.scrubPlan(o.planRun.plan, id), answers, bench: o.planRun.bench.filter(x => x !== id) }; }
      o.objective = scrub(o.objective); o.detail = scrub(o.detail);
      for (const k of Object.keys(o.explanations)) o.explanations[k] = scrub(o.explanations[k]!);
    }
    for (const r of this.requests) if (r.oppId && !this.opps.has(r.oppId)) r.oppId = undefined;
    this.queued = this.queued.filter(p => !p.participants.includes(id)).map(p => {
      const { [id]: _, ...explanations } = p.explanations ?? {};
      return { ...p, alternates: (p.alternates ?? []).filter(x => x !== id), explanations: Object.fromEntries(Object.entries(explanations).map(([k, v]) => [k, scrub(v)])), objective: scrub(p.objective) };
    });
    delete this.exposureDebt[id];
    this.asks = this.asks.filter(a => a.memberId !== id);
    for (const m of this.members.values()) if (m.awaiting?.oppId && !this.opps.has(m.awaiting.oppId)) m.awaiting = undefined;
    this.relayDesk.forget(id);
    this.members.delete(id); this.fullNames.delete(id); this.trust.forget(id); this.vouchedSkills.delete(id); this.invitedIds.delete(id);
    this.cases = this.cases.filter(c => c.memberId !== id);
    for (const c of this.cases) for (const e of c.events) if (e.by === id) delete e.by;
    // Reports about them stay (a safety record with ids only: leaving never escapes a ban); a reporter who left is not named.
    for (const r of this.reports) if (r.reporterId === id) r.reporterId = "";
    this.deferred = this.deferred.filter(d => d.memberId !== id && !d.o.about?.includes(id));
    // Texts kept for other members (a deferred send, the last message, an acknowledgement still to fold in) never name them again.
    for (const d of this.deferred) d.body = scrub(d.body);
    for (const x of this.members.values()) {
      if (x.pendingSafety?.targets?.includes(id)) x.pendingSafety = undefined;
      if (x.lastSent) x.lastSent = { ...x.lastSent, body: scrub(x.lastSent.body) };
      if (x.pendingAck) x.pendingAck = { ...x.pendingAck, text: scrub(x.pendingAck.text) };
      if (x.pendingInviteJoins) x.pendingInviteJoins = x.pendingInviteJoins.filter(notice => notice.inviteeId !== id);
    }
    const mine = (k: string) => k.split("|").includes(id);
    for (const s of [this.blocks, this.avoid]) for (const k of [...s]) if (mine(k)) s.delete(k);
    for (const k of [...this.declined.keys()]) if (mine(k)) this.declined.delete(k);
    for (const k of [...this.flagged.keys()]) if (mine(k)) this.flagged.delete(k);
    this.feedback = this.feedback.filter(f => f.from !== id && f.about !== id);
    this.interactions = this.interactions.filter(x => !x.participants.includes(id));
    for (const k of [...this.planAgain.keys()]) if (mine(k)) this.planAgain.delete(k);
    this.lastPlannedAt.delete(id);
    this.planCarry = this.planCarry.filter(c => c.memberId !== id);
    for (const c of this.crews) { c.members = c.members.filter(x => x !== id); c.hostRotation = c.hostRotation.filter(x => x !== id); }
    for (const c of this.crewOffers) {
      const { offered, yes, no } = stepCrewOffer(crewOfferState(c), { type: "forgetCrewInvitee", memberId: id });
      c.offered = offered; c.yes = yes; c.no = no;
      c.crew.members = c.crew.members.filter(x => x !== id);
    }
    this.fraud = this.fraud.filter(x => !x.flag.members.includes(id));
    this.dirty = true;
  }

  /** A plan with one member taken out of every list (forget). */
  private scrubPlan(p: plans.Plan, id: MemberId): plans.Plan {
    const { [id]: _u, ...u } = p.u; const { [id]: _f, ...familiar } = p.familiar;
    for (const k of Object.keys(familiar)) familiar[k] = familiar[k]!.filter(x => x !== id);
    return { ...p, invited: p.invited.filter(x => x !== id), alternates: p.alternates.filter(x => x !== id), u, familiar, ...(p.hostId === id ? { hostId: undefined } : {}) };
  }

  private welcome(m: MemberState) {
    this.dirty = true;
    this.ledgerJoined(m);
    const snapMember = this.snapshotCached().members.find(x => x.id === m.id);
    if (m.ageUnknown) {
      m.stage = "age";
      this.send(m, this.copy.welcomeAskAge(m.first), { type: "onboarding", proactive: false, firstContact: true }, "interview", { hook: { t: "age" } });
      return;
    }
    if (m.minor) {
      m.stage = "active";
      const due = minorScopeNoticeDue(true, soloTeenApp(this.app.id), m.minorScopeToldAt !== undefined);
      const sent = this.send(m, this.copy.welcomeMinor(m.first, this.minorNoticeKind(m)), { type: "onboarding", proactive: false, firstContact: true }, "interview") === "sent";
      if (due && sent) m.minorScopeToldAt = this.now();
      return;
    }
    m.stage = "q1";
    this.send(m, this.copy.welcome(m.first, snapMember?.invitedBy && this.adultMember(snapMember.invitedBy) ? this.members.get(snapMember.invitedBy)?.first : undefined), { type: "onboarding", proactive: false, firstContact: true }, "interview",
      { hook: { t: "interview" } });
    this.inviteeJoined(m);
  }

  /** The inviter hears when the person they invited joins. */
  private inviteeJoined(m: MemberState) {
    const inv = m.invitedBy ? this.members.get(m.invitedBy) : undefined;
    if (!inv || inv.optedOut || !this.invitedIds.has(m.id)) return;
    this.counters.inviteesJoined++;
    this.queueInviteJoin(inv, { inviteeId: m.id, at: this.now() });
  }

  /** Project a verified join from another conversation shard without adding the invitee to this Network. */
  announceVerifiedInviteJoin(inviterId: MemberId, inviteeId: MemberId, at: number): void {
    if (inviterId === inviteeId || this.invitedIds.has(inviteeId) || this.declinedIds.has(inviterId)) return;
    this.dirty = true;
    if (!this.record(inviterId) || !this.ctx.verifiedJoinedInviteeName?.(inviterId, inviteeId)) return;
    const inv = this.member(inviterId);
    this.invitedIds.add(inviteeId);
    if (inv.optedOut) return;
    this.counters.inviteesJoined++;
    this.queueInviteJoin(inv, { inviteeId, at: Math.floor(at) });
  }

  /** Ask for a decision on a reviewed plan. Its record and current approval stay in the service. */
  askReviewedHomeHelpConsent(input: { recipientId: MemberId; role: "requester" | "helper"; deliveryId: string; body: string }): boolean {
    const { recipientId, role, deliveryId, body } = input;
    if (!this.record(recipientId) || this.declinedIds.has(recipientId)) return false;
    const member = this.member(recipientId);
    this.dirty = true;
    return this.send(member, body, { type: "info", proactive: role === "helper", homeHelpConsentFor: role },
      "home_help_consent", { key: deliveryId, noDefer: true }) === "sent";
  }

  /** Stage an exact reviewed gathering invitation using ordinary proactive outreach budgets. */
  askReviewedGatheringInvitation(recipientId: MemberId, deliveryId: string, body: string): boolean {
    const member = this.gatheringOutreachMember(recipientId);
    if (!member) return false;
    this.dirty = true;
    return this.send(member, body, { type: "info", proactive: true }, "info", { key: deliveryId, noDefer: true, immutableBody: true }) === "sent";
  }

  /** Logistics for the recipient's own current RSVP use the same timing as a booked meeting. */
  sendGatheringRsvpNotice(recipientId: MemberId, { id, body, kind, startsAt }:
    { id: string; body: string; kind: GatheringNoticeKind; startsAt: number }): boolean {
    const member = this.gatheringOutreachMember(recipientId);
    if (!member) return false;
    const now = this.now();
    const attendance = kind === "GatheringAttendancePrompt";
    if (attendance && (this.askOpen(member, now) || member.awaiting?.kind === "probe" || member.awaiting?.kind === "booked")) return false;
    if (kind === "GatheringNearStart" && startsAt - now > nearMeetingReminderLeadMs && this.laterAllowedTick(member, now, startsAt - HOUR)) return false;
    this.dirty = true;
    return this.send(member, body, { type: attendance ? "feedback_request" : "reminder" }, attendance ? "feedback" : "reminder", {
      key: id, noDefer: true, immutableBody: true, gatheringRsvpLogistics: true,
    }) === "sent";
  }

  private gatheringOutreachMember(id: MemberId): MemberState | undefined {
    if (this.app.id !== "ntwrk" || !this.matchingEnabled() || this.declinedIds.has(id)) return;
    const member = this.members.get(id);
    const record = this.record(id);
    if (member && record?.homeCity === "nyc" && canBeMatched(record.age) && gatheringEventPreference(record.prefs)
      && gatheringMemberStateCurrent(member, !this.trust.ok(id) || this.reportHeld(id), earliestDayKeyOf(this.now()))) return member;
  }

  private queueInviteJoin(inv: MemberState, notice: InviteJoinNotice) {
    if (this.inviteJoinCopy(inv, notice) === undefined) return;
    inv.pendingInviteJoins = [...(inv.pendingInviteJoins ?? []).filter(x => this.now() - x.at < inviteJoinNoticeLifetimeMs && x.inviteeId !== notice.inviteeId), notice];
    if (!inv.onlyWhenAsked) this.send(inv, "", { type: "info" }, "invite_notice", { about: [notice.inviteeId], hook: { t: "invite_notice", notice } });
  }

  private inviteJoinCopy(inviter: MemberState, notice: InviteJoinNotice): { first: string; text: string } | undefined {
    const invitee = this.members.get(notice.inviteeId);
    const verifiedExternalName = !invitee ? this.ctx.verifiedJoinedInviteeName?.(inviter.id, notice.inviteeId) : undefined;
    const first = invitee?.first ?? verifiedExternalName;
    if (!first) return;
    const eligible = this.checkRecipient(inviter.id, "invite_notice", { about: [notice.inviteeId], reply: false }).ok;
    const attributed = (invitee?.invitedBy === inviter.id || !!verifiedExternalName) && this.invitedIds.has(notice.inviteeId);
    if (inviteJoinNoticeCurrent(attributed, !invitee?.optedOut, eligible, this.now() - notice.at)) return { first, text: copy.inviteeJoined(first) };
  }

  /**
   * The first message after "How old are you?". With an age: a minor hears what they can use the agent
   * for; an adult starts onboarding. Without one: the question was asked once, so the member carries
   * on single-player (treated as a minor) and the message is handled as usual. True when handled here.
   */
  private afterAgeQuestion(m: MemberState, resolved: boolean): boolean {
    if (m.awaiting?.kind === "age") m.awaiting = undefined;
    m.stage = "active";
    if (!resolved) return false;
    if (m.minor) { this.sendMinorNotice(m, "reply"); return true; }
    m.stage = "q1";
    this.send(m, copy.welcomeAfterAge, { type: "onboarding", proactive: false }, "interview", { hook: { t: "interview" } });
    this.inviteeJoined(m);
    return true;
  }

  private minorNoticeKind(m: MemberState): MinorNotice {
    const r = this.record(m.id);
    const doubtStored = (r !== undefined && recordMinorSignalOpen(r, m)) || m.minorSignal || m.minorReported === true || m.olderReported === true
      || m.ageConflict === true || r?.ageConflict === true || r?.teenBarred === true;
    return minorNoticeFor(this.app.id, this.teenIntrosEnabled(), this.rosterSideOf(m.id).ready, r?.birthExact === true, doubtStored);
  }

  private sendMinorNotice(m: MemberState, kind: "safety" | "reply") {
    const due = minorScopeNoticeDue(m.minor, soloTeenApp(this.app.id), m.minorScopeToldAt !== undefined);
    if (this.send(m, this.minorNoticeText(m), { type: "info" }, kind) === "sent" && due) m.minorScopeToldAt = this.now();
  }

  private minorNoticeText(m: MemberState): string {
    return this.copy.minorScopeNotice(this.minorNoticeKind(m));
  }

  private learnFrom(m: MemberState, body: string, reasons: readonly string[] = []) {
    this.learnAppTags(m, body, reasons);
    const x = extractProfile(body);
    const redLines = extractRedLineTags(body);
    const u = this.understood;
    if (u) {
      const no = new Set([...x.notWanted, ...u.notWanted]);
      x.interests = [...new Set([...x.interests, ...u.interests])];
      x.skills = [...new Set([...x.skills, ...u.skills])];
      x.desireIds = [...new Set([...x.desireIds, ...u.wants])].filter(d => !no.has(d));
      if (!x.area && u.area) { x.area = u.area; delete x.areaUnknown; }
    }
    const now = this.now();
    x.interests.forEach(t => m.learned.interests.add(t));
    x.skills.forEach(t => m.learned.skills.add(t));
    if (redLines.length) {
      m.learned.redLines ??= new Set();
      redLines.forEach(t => m.learned.redLines!.add(t));
    }
    x.desireIds.filter(t => !x.notWanted.includes(t)).forEach(t => { if (this.standingAddGate(m, { desireId: t, tags: [] }, false, true)) m.learned.desires.set(t, now); });
    const city = this.networkCity();
    if (x.area && (NEIGHBORHOOD.has(x.area) || findCityNeighborhood(x.area, city))) { m.learned.area = x.area; m.area = x.area; m.areaUnknown = false; }
    else if (x.areaUnknown && !m.area && !m.areaUnknown) { m.areaUnknown = true; this.ctx.log("area_unknown", { memberId: m.id }); }
    if (x.eveningsOpen !== undefined) m.learned.eveningsOpen = x.eveningsOpen;
    if (x.groups !== undefined) m.learned.groups = x.groups;
    const tags = availabilityTags(body, now, this.cityTz());
    if (tags.length) m.availability = [...(m.availability ?? []), { tags, at: now }].slice(-8);
    if (tags.length && m.stage !== "active") m.standing = { tags, at: now };
    this.dirty = true;
    this.ctx.log("learned", { memberId: m.id, interests: x.interests, skills: x.skills, desires: x.desireIds, area: x.area, ...(redLines.length ? { redLines } : {}) });
  }

  /** What the app's onboarding loop reads from the member's words (AppHooks.onboarding). Newer tags replace older ones with the same prefix. Never for a minor. */
  private learnAppTags(m: MemberState, body: string, reasons: readonly string[]) {
    const ob = this.opts.hooks?.onboarding;
    if (!ob || m.minor) return;
    const r = ob.read(m.onboarding, body, reasons, { now: this.now(), age: this.ageOf(m) });
    m.onboarding = r.state;
    this.dirty = true;
    if (!r.tags.length && !r.replaces.length) return;
    const keep = (m.appTags ?? []).filter(t => !r.replaces.some(p => t.tag.startsWith(p)) && !r.tags.some(n => n.tag === t.tag));
    m.appTags = [...keep, ...r.tags];
    this.dirty = true;
    // Ids and tag names only, never the member's words.
    this.ctx.log("app_tags_learned", { memberId: m.id, tags: r.tags.map(t => t.tag.split(":").slice(0, 2).join(":")) });
  }

  /** The age the onboarding loop starts from: the lowest one the member gave. */
  private ageOf(m: MemberState): number | undefined {
    return lowestAge(m.age, this.statedToday(m));
  }

  private statedToday(m: Pick<MemberState, "statedAge" | "statedAgeDay">): number | undefined {
    return statedAgeOn(m, earliestDayKeyOf(this.now()));
  }

  /** Confirmed venue/dietary/accessibility red-line tags learned or stored for a member (own profile read only). */
  memberRedLines(id: MemberId): string[] {
    const m = this.members.get(id);
    if (!m || this.declinedIds.has(id)) return [];
    const { prefs } = this.memberVenuePrefsOf(id);
    const out = new Set<string>(m.learned.redLines ?? []);
    if (prefs.strictSober) out.add("strict_sober");
    if (!prefs.drinksAlcohol && !prefs.strictSober) out.add("non_drinker");
    if (prefs.halal) out.add("halal");
    if (prefs.kosher) out.add("kosher");
    if (prefs.glutenFree) out.add("gluten_free");
    if (prefs.vegetarian) out.add("vegetarian");
    if (prefs.vegan) out.add("vegan");
    if (prefs.severeAllergen) out.add("severe_allergen");
    if (prefs.wheelchairNeeded) out.add("wheelchair");
    if (prefs.smokeFree) out.add("smoke_free");
    if (prefs.lowNoiseRequired) out.add("low_noise");
    if (prefs.daytimeOnly) out.add("daytime_only");
    return [...out].sort();
  }

  /** Structured next onboarding question for MCP / assistant callers without sending unsolicited SMS. */
  nextOnboardingQuestion(id: MemberId, skip: readonly string[] = []): { reason: string; text: string } | undefined {
    const m = this.members.get(id);
    if (!m || m.minor || this.declinedIds.has(id)) return undefined;
    if (m.stage === "q1") return { reason: "availability", text: copy.interview.availability };
    if (m.stage === "q2") return { reason: "format", text: copy.interview.format };
    const ob = this.opts.hooks?.onboarding;
    if (ob) {
      const nx = ob.next(m.onboarding, { age: this.ageOf(m), skip });
      if (nx) return { reason: nx.reason, text: nx.text };
    }
    return undefined;
  }

  /**
   * The app's next onboarding message (AppHooks.onboarding), as a reply: a read-back or one question.
   * `skip`: the questions the member just answered, never repeated right away. False when nothing is left.
   */
  private onboardNext(m: MemberState, skip: readonly string[]): boolean {
    if (this.turnSource === "mcp") return false;
    const ob = this.opts.hooks?.onboarding;
    if (!ob || m.minor) return false;
    const nx = ob.next(m.onboarding, { age: this.ageOf(m), skip });
    if (!nx) return false;
    this.send(m, nx.text, { type: "question", proactive: false }, "interview", { hook: { t: "ask", reason: nx.reason, follow: true } });
    return true;
  }

  private onInterviewAnswer(m: MemberState, body: string) {
    this.learnFrom(m, body);
    m.awaiting = undefined;
    const silentMcp = this.turnSource === "mcp";
    // An app with its own onboarding loop takes over after the first answer.
    if (m.stage === "q1" && this.opts.hooks?.onboarding && !m.minor) {
      this.activate(m);
      if (!silentMcp && !this.onboardNext(m, [])) this.ack(m, copy.ackLearned, { direct: true });
      return;
    }
    const ask = (next: "q2" | "q3", text: string) => {
      m.stage = next;
      if (!silentMcp) this.send(m, text, { type: "question", proactive: false }, "interview", { hook: { t: "interview" } });
    };
    const hasQ2 = Boolean(m.area) && (m.learned.eveningsOpen !== undefined || (m.availability?.length ?? 0) > 0);
    const hasQ3 = m.learned.groups !== undefined;
    if (m.stage === "q1") {
      if (!hasQ2) return ask("q2", copy.interview.availability);
      if (!hasQ3) return ask("q3", copy.interview.format);
      this.activate(m);
      if (!silentMcp) this.ack(m, copy.ackLearned, { direct: true });
      return;
    }
    if (m.stage === "q2") {
      if (!hasQ3) return ask("q3", copy.interview.format);
      this.activate(m);
      if (!silentMcp) this.ack(m, copy.ackLearned, { direct: true });
      return;
    }
    if (m.stage === "q3") this.activate(m);
    if (!silentMcp) this.ack(m, copy.ackLearned, { direct: true });
  }

  /**
   * A profile from the member's AI assistant (InboundMessage.source "mcp") that is not a request: it
   * may answer an onboarding question (it is about the member), and otherwise is learned quietly. It
   * never answers a probe, a plan, the booked date or a check-in (handleInbound leaves those open).
   */
  private learnFromProfile(m: MemberState, aw: MemberState["awaiting"], c: Classified, body: string) {
    if (aw?.kind === "interview" && aw.ask) return this.onAskAnswer(m, aw.ask, c, body);
    if (aw?.kind === "interview" && m.stage !== "active") return this.onInterviewAnswer(m, body);
    this.learnFrom(m, body);
    if (m.stage !== "active" && m.stage !== "new" && m.stage !== "age" && !this.opts.hooks?.onboarding) {
      const hasQ2 = Boolean(m.area) && (m.learned.eveningsOpen !== undefined || (m.availability?.length ?? 0) > 0);
      const hasQ3 = m.learned.groups !== undefined;
      if (hasQ2 && hasQ3) {
        m.awaiting = undefined;
        this.activate(m);
      } else if (hasQ2 && m.stage === "q1") {
        m.stage = "q2";
      }
    }
  }

  /**
   * The member's last question from the app's onboarding loop, still unanswered, when this message
   * answers it: reading it as that answer adds a tag, or moves the loop to another question.
   */
  private lateAnswer(m: MemberState, body: string): AskRecord | undefined {
    const ob = this.opts.hooks?.onboarding;
    if (!ob || m.minor) return undefined;
    const ask = this.asks.filter(a => a.memberId === m.id).at(-1);
    if (!ask || ask.answeredAt !== undefined) return undefined;
    const reasons = this.asks.filter(a => a.memberId === m.id && a.at === ask.at).map(a => a.reason);
    const age = this.ageOf(m);
    const r = ob.read(m.onboarding, body, reasons, { now: this.now(), age });
    const had = new Set((m.appTags ?? []).map(t => t.tag));
    const moved = ob.next(r.state, { age })?.reason !== ob.next(m.onboarding, { age })?.reason;
    return moved || r.tags.some(t => !had.has(t.tag)) ? ask : undefined;
  }

  /**
   * The answer to an engine question (EngineResult.asks): learn from it, record when it came
   * (`answeredAt`, fed back to the engine as recentAsks), then handle a request it contains.
   */
  private onAskAnswer(m: MemberState, ask: AskRecord, c: Classified, body: string) {
    m.awaiting = undefined;
    // Every ask that went out in the same message is answered by this one.
    const together = this.asks.filter(a => a.memberId === m.id && a.at === ask.at && a.answeredAt === undefined);
    for (const a of together) a.answeredAt = this.now();
    ask.answeredAt = this.now();
    m.answered++; this.counters.asksAnswered++;
    const reasons = [...new Set([ask.reason, ...together.map(a => a.reason)])];
    this.learnFrom(m, body, reasons);
    this.ctx.log("ask_answered", { memberId: m.id, reason: ask.reason });
    if (c.kind === "people_request" && (!m.minor || this.teenAdmitted(m.id))) return this.openRequest(m, c, {});
    if (c.kind === "plans_request") return this.onPlans(m, c);
    if (this.turnSource === "mcp") return;
    // The onboarding loop goes on with its next question, else the usual acknowledgement.
    if (this.onboardNext(m, reasons)) return;
    this.ack(m, copy.ackLearned);
  }

  // ================================================================== safety
  /**
   * Abuse in the sender's own words. No single message from a member with a clean record reaches
   * hold (network-consent-8): the first one stops at watch, a second one can hold. True when the
   * message is also a request the member may still make (the reply is folded into its answer).
   */
  private handleAbuse(m: MemberState, c: Classified, body: string): boolean {
    const now = this.now();
    this.counters.abuse++;
    // Privacy (P3): what kind of abuse and how long the message was, never the text itself.
    this.ctx.log("abuse", { memberId: m.id, kinds: c.abuse, risk: c.risk, length: body.length });
    const clean = this.trust.get(m.id).score <= 0;
    const severeOffense = c.abuse.includes("scam_money") || (c.abuse.includes("harassment") && c.risk >= HOLD);
    this.trust.add(m.id, now, c.abuse[0]!, clean && !severeOffense ? Math.min(c.risk, HOLD - 1) : c.risk);
    if (this.trust.level(m.id) === "hold") return false; // onTrustChange already told them
    const reply = c.abuse.includes("scam_money") ? copy.noMoney
      : c.abuse.includes("prompt_injection") ? copy.noInjection
      : c.abuse.includes("contact_extraction") ? copy.noContactDetails
      : c.abuse.includes("harassment") ? copy.giveSpace
      : this.copy.noPromotion;
    if ((c.kind === "people_request" || c.kind === "plans_request") && this.trust.ok(m.id)) { this.ack(m, reply); return true; }
    this.send(m, reply, { type: "info" }, "reply");
    return false;
  }

  private swapAsk(m: MemberState, c: Classified, body: string): boolean {
    if (c.abuse.length !== 1 || c.abuse[0] !== "contact_extraction") return false;
    const live = this.relayDesk.liveMatches(m.id).flatMap(x => {
      const other = x.participants.length === 2 ? this.members.get(x.participants.find(p => p !== m.id)!) : undefined;
      return other ? [{ id: x.id, first: other.first.toLowerCase() }] : [];
    });
    const firsts = new Set(live.map(x => x.first));
    const t = body.normalize("NFKC").replace(/[\u2018\u2019]/g, "'");
    const NUM = String.raw`(?:(?:phone|cell)\s+)?(?:number|phone|cell)\b`;
    let asks = 0, elsewhere = false;
    const rest = t.replace(new RegExp(String.raw`\b(his|her|their|them|[\p{L}]+'s)\s+` + NUM, "giu"), (all: string, w: string) => {
      const whose = w.toLowerCase().replace(/'s$/, "");
      if (["his", "her", "their", "them"].includes(whose) || firsts.has(whose)) { asks++; return " "; }
      elsewhere = true; return all;
    });
    const otherContact = /\b(numbers?|phones?|cells?|address(es)?|emails?|instagram|ig|insta|socials|snap(chat)?|handles?|contacts?|last names?)\b/i.test(rest)
      || classify(rest).abuse.includes("contact_extraction");
    // spec/relayDecision.md, "A number ask with several live matches is never scored as abuse"
    if (numberAsk(live.length, asks > 0, !elsewhere, otherContact) !== "NumberAskOpens") return false;
    this.ctx.log("relay_swap_ask", { memberId: m.id, ...(live.length === 1 ? { matchId: live[0]!.id } : { liveMatches: live.length }) });
    return true;
  }

  private onTrustChange(id: MemberId, from: TrustLevel, to: TrustLevel, why: string) {
    const m = this.members.get(id);
    this.ctx.log("trust", { memberId: id, from, to, why, score: this.trust.get(id).score });
    if (to === "watch") this.counters.watches++;
    if (to !== "ok") { this.emit({ type: "safety_flag", member: id, serious: to === "hold" }, `${id}:${to}:${this.now()}`); this.dropMember(id, `trust ${to}`); }
    if (to === "hold") {
      const c = this.openCase(id);
      if (c) c.status = CASE_STATUS[stepSafetyCase({ phase: CASE_PHASE[c.status] }, { type: "markCaseHeld" }).phase];
      this.counters.holds++;
      if (m) this.send(m, copy.hold, { type: "info", safety: true }, "safety");
      // Inviter accountability: no invites for 30 days, and a risk point.
      const inviter = m?.invitedBy ? this.members.get(m.invitedBy) : undefined;
      if (inviter) {
        inviter.invitesBlockedUntil = this.now() + 30 * DAY;
        this.trust.add(inviter.id, this.now(), "invitee_held", 1);
      }
    }
  }

  // ------------------------------------------------------------------ safety cases (PRD 32.14)
  /** Every trust event goes into the member's open case, or opens one; decay only updates an open case. Cases hold no message text. */
  private caseEvent(id: MemberId, e: SafetyCaseEvent) {
    let c = this.openCase(id);
    // spec/safetyCase.md, "An event opens a case or adds to its current record"
    const { phase } = stepSafetyCase(c ? { phase: CASE_PHASE[c.status] } : initialCase, { type: "recordCaseEvent", liftEvent: e.kind === "hold_lifted", decayEvent: e.kind === "decay" });
    if (phase === "NoCase") return;
    const status = CASE_STATUS[phase];
    if (!c) { c = { id: `sc${++this.caseSeq}`, memberId: id, opened: e.at, level: this.trust.level(id), events: [], status }; this.cases.push(c); }
    else c.status = status;
    c.events.push({ at: e.at, kind: e.kind, points: e.points, ...(e.by ? { by: e.by } : {}) });
  }
  /**
   * A member found to be under 18 after the Network revealed adults to them (a plan was booked):
   * staff must look at those introductions. Opens or adds to the member's safety case, with the
   * adults' ids only, and logs `minor_after_contact`.
   */
  private minorAfterContact(id: MemberId) {
    const adults = new Set<MemberId>();
    for (const o of this.opps.values()) {
      if (o.teenRuleAt !== undefined || !o.participants.includes(id) || !o.contacted.has(id)) continue;
      for (const p of o.participants) if (p !== id && !this.members.get(p)?.minor) adults.add(p);
    }
    if (!adults.size) return;
    const at = this.now();
    for (const by of adults) this.caseEvent(id, { at, kind: "minor_after_contact", points: 0, by });
    // A case on each adult too, with ids only: it survives the minor's under-13 delete (network-consent-3).
    for (const a of adults) this.caseEvent(a, { at, kind: "contact_with_minor", points: 0 });
    this.ctx.log("minor_after_contact", { memberId: id, members: [...adults] });
  }
  private openCase(id: MemberId): SafetyCase | undefined {
    for (let i = this.cases.length - 1; i >= 0; i--) { const c = this.cases[i]!; if (c.memberId === id && c.status !== "closed") return c; }
    return undefined;
  }

  /** Safety cases for staff, oldest first, with each member's trust level now. */
  safetyCases(): SafetyCase[] {
    return this.cases.map(c => ({ ...c, level: this.trust.level(c.memberId), events: c.events.map(e => ({ ...e })) }));
  }

  /** Staff lift a member's hold (only a person can). Their case stays open as "lifted" until staff close it. */
  liftHold(memberId: MemberId, actor: string, note?: string, durableStaffHold = false): ActionResult {
    const runtimeHeld = this.trust.level(memberId) === "hold";
    const decision = holdLiftResult(!!actor.trim(), runtimeHeld || durableStaffHold);
    if (decision !== "AllowedAction") return { ok: false, reason: SAFETY_REFUSAL[decision] };
    if (runtimeHeld && !this.trust.lift(memberId, this.now())) return { ok: false, reason: "not_on_hold" };
    const c = this.openCase(memberId);
    if (c) c.status = CASE_STATUS[stepSafetyCase({ phase: CASE_PHASE[c.status] }, { type: "markCaseLifted" }).phase];
    this.ctx.log("safety_action", { action: "lift_hold", caseId: c?.id ?? null, memberId, actor, note: note ?? null });
    return { ok: true };
  }

  /** Staff close a case with a decision. A member still on hold stays on hold (a confirmed hold). */
  closeCase(caseId: string, actor: string, note?: string): ActionResult {
    const c = this.cases.find(x => x.id === caseId);
    const phase = c ? CASE_PHASE[c.status] : "NoCase";
    const decision = caseCloseResult(!!actor.trim(), phase);
    if (decision !== "AllowedAction") return { ok: false, reason: SAFETY_REFUSAL[decision] };
    if (!c) return { ok: false, reason: "unknown_case" };
    c.status = CASE_STATUS[stepSafetyCase({ phase }, { type: "closeCase" }).phase];
    c.closedAt = this.now(); c.closedBy = actor;
    const held = this.trust.level(c.memberId) === "hold";
    this.ctx.log("safety_action", { action: "close_case", caseId, memberId: c.memberId, actor, note: note ?? null, held });
    if (held) {
      // A confirmed hold: confirmed abuse, and the member is removed (the voucher's stake, NC 2.4).
      const kinds = c.events.map(e => e.kind).join(" ");
      const kind = /scam|money|contact/.test(kinds) ? "scam" : /harass|block_abuse|report/.test(kinds) ? "harassment" : /spam|promo|sales/.test(kinds) ? "spam" : "policy";
      this.emit({ type: "abuse_confirmed", member: c.memberId, kind }, caseId);
      this.emit({ type: "member_removed", member: c.memberId, reason: "serious_abuse" }, caseId);
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ reports (reports.ts; docs/admin-console.md 3.7.1)
  /**
   * A report about a member: a record with ids and a kind (never the words) and a staff case event.
   * An urgent report (harassment, unsafe, scam, minor) by someone who met them (the check-in after a
   * date, or a "report X" text; see reportHeld) takes the member out of matching until staff decide. A "report X" message keeps the trust
   * rules (trust.ts: points need two reporters who met them; a stranger only opens the case).
   */
  private fileReport(reporter: MemberId, subject: MemberId, kind: ReportKind, o: { oppId?: string; source: SafetyReport["source"]; met: boolean; caseEvent?: boolean }) {
    const now = this.now();
    const r = { id: this.sid(`rp${++this.reportSeq}`), kind, reporterId: reporter, subjectId: subject, ...(o.oppId ? { opportunityId: o.oppId } : {}), at: now, status: "open" as const, source: o.source, met: o.met };
    this.reports.push(r);
    if (o.caseEvent !== false) this.caseEvent(subject, { at: now, kind: `report:${kind}`, points: 0, by: reporter });
    this.ctx.log("report_received", { reportId: r.id, kind, memberId: reporter, target: subject, oppId: o.oppId ?? null, source: o.source, met: o.met });
    if (this.reportHeld(subject)) this.dropMember(subject, "report under review");
    this.dirty = true;
  }

  /**
   * An urgent report (harassment, unsafe, scam, minor) by someone who met them through the Network is
   * waiting for staff: out of matching until staff decide. The same for the answer to the check-in
   * after a date and for a "report X" text (PRD 36.3): what matters is that they met, not which
   * question the member was answering. A report by someone they never met holds nobody.
   */
  private reportHeld(id: MemberId): boolean {
    return pendingReportHold(this.reports, id, reporterId => this.trust.level(reporterId) === "hold");
  }

  reportRestrictionsForLeave(id: MemberId, ordinaryLeave: boolean): string[] {
    const member = this.members.get(id);
    const reportedMinor = member?.minorSignal === true && member.minorReported === true;
    return this.reports.filter(r => r.subjectId === id
      && carryReportOnAppLeave(ordinaryLeave, REPORT_PHASE[r.status], r.met, URGENT_REPORTS.has(r.kind), reportedMinor && r.kind === "minor")).map(r => r.id);
  }

  /** Reports for staff, newest first, each with how many earlier reports name the same member. Never the words. */
  safetyReports(): (SafetyReport & { priorReports: number })[] {
    return this.reports.map(r => {
      const { met: _met, ...rest } = r;
      return { ...rest, priorReports: this.reports.filter(x => x.subjectId === r.subjectId && x.at < r.at).length };
    }).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  }

  /**
   * Staff hold a member (pending review), from a report or not. Everything open with them stops and
   * they hear the hold notice once. Their open reports read "held".
   */
  holdMember(memberId: MemberId, actor: string, note?: string, reportId?: string, authority?: "archived" | "projection"): ActionResult {
    const actorPresent = !!actor.trim();
    const reportMatches = reportId === undefined || this.reports.some(r => r.id === reportId && r.subjectId === memberId);
    const beforeLoad = holdAuthority(actorPresent, reportMatches);
    if (beforeLoad !== "AllowedAction") return { ok: false, reason: SAFETY_REFUSAL[beforeLoad] };
    // A member this Network has not loaded yet (no message since the state began) is loaded from the snapshot.
    if (!this.members.has(memberId) && this.record(memberId) && !this.declinedIds.has(memberId)) this.member(memberId);
    const known = this.members.has(memberId);
    if (authority === "archived" && !archivedReportHoldAllowed(reportMatches,
      reportId !== undefined && this.reportRestrictionsForLeave(memberId, true).includes(reportId))) return { ok: false, reason: "unknown_report" };
    if (!holdSubjectKnown(known, authority === "archived")) return { ok: false, reason: "unknown_member" };
    if (known && this.trust.level(memberId) !== "hold") {
      const score = this.trust.get(memberId).score;
      this.trust.add(memberId, this.now(), "staff_hold", Math.max(HOLD - score, 0) || 1);
    }
    if (authority !== "projection") this.decideReports(memberId, "held", actor, reportId);
    this.ctx.log("safety_action", { action: "hold", memberId, actor, note: note ?? null, reportId: reportId ?? null });
    return { ok: true };
  }

  /** The platform banned the member's person or phone: their reports read "banned", and they are held here (never matched or contacted again but for safety notices). */
  markBanned(memberId: MemberId, actor: string, note?: string, reportId?: string): ActionResult {
    if (!actor.trim()) return { ok: false, reason: "actor_required" };
    if (!this.members.has(memberId) && this.record(memberId) && !this.declinedIds.has(memberId)) this.member(memberId);
    if (this.members.has(memberId) && this.trust.level(memberId) !== "hold") {
      const score = this.trust.get(memberId).score;
      this.trust.add(memberId, this.now(), "staff_hold", Math.max(HOLD - score, 0) || 1);
    }
    this.dropMember(memberId, "banned");
    this.decideReports(memberId, "banned", actor, reportId);
    this.ctx.log("safety_action", { action: "ban", memberId, actor, note: note ?? null, reportId: reportId ?? null });
    return { ok: true };
  }

  /** Staff dismiss a report: it no longer keeps the member out of matching. */
  dismissReport(reportId: string, actor: string, note?: string): ActionResult {
    if (!actor.trim()) return { ok: false, reason: "actor_required" };
    const r = this.reports.find(x => x.id === reportId);
    if (!r) return { ok: false, reason: "unknown_report" };
    const next = REPORT_STATUS[reportAfterDecision(REPORT_PHASE[r.status], "DismissReport", true, true)];
    if (next === r.status) return { ok: false, reason: `already_${r.status}` };
    r.status = next; r.decidedBy = actor; r.decidedAt = this.now();
    if (this.members.has(r.subjectId) || this.record(r.subjectId)) {
      this.caseEvent(r.subjectId, { at: this.now(), kind: "report_dismissed", points: 0 });
    }
    this.ctx.log("safety_action", { action: "dismiss_report", reportId, memberId: r.subjectId, actor, note: note ?? null });
    this.dirty = true;
    return { ok: true };
  }

  private decideReports(memberId: MemberId, status: "held" | "banned", actor: string, reportId?: string) {
    const now = this.now();
    const decision = status === "held" ? "HoldReport" : "BanReport";
    for (const r of this.reports) {
      const next = REPORT_STATUS[reportAfterDecision(REPORT_PHASE[r.status], decision, r.subjectId === memberId, reportId === undefined || r.id === reportId)];
      if (next === r.status) continue;
      r.status = next; r.decidedBy = actor; r.decidedAt = now;
    }
    this.dirty = true;
  }

  /** Remove any member's full name (and "Name:" prefixes) from free text. */
  stripNames(text: string): string {
    let t = text;
    for (const [, name] of this.fullNames) if (t.includes(name)) t = t.split(name).join("they");
    // Keep the grammar right after a name became "they" ("Sam is into film" -> "they're into film").
    return t.replace(/\bthey: /g, "they ").replace(/\bthey is\b/g, "they're").replace(/\bthey has\b/g, "they have").replace(/\bthey was\b/g, "they were")
      .replace(/\bthey's\b/g, "their").replace(/\bthey does\b/g, "they do").replace(/\s+/g, " ").trim();
  }

  /** Resolve a name a member typed: full name, then "First L.", then a unique first name (whole words only). */
  findByName(name: string, exclude: MemberId): MemberState | undefined {
    const t = name.toLowerCase().replace(/\s+/g, " ").trim();
    const all = [...this.members.values()].filter(x => x.id !== exclude);
    const full = (x: MemberState) => this.fullNames.get(x.id)?.toLowerCase() ?? "";
    // Unicode-aware whole-word match (names like "José" or "Zoë").
    const word = (w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}])`, "u");
    return all.find(x => full(x) && word(full(x)).test(t))
      ?? all.find(x => word(x.display.toLowerCase()).test(t))
      ?? (() => { const f = all.filter(x => word(x.first.toLowerCase()).test(t)); return f.length === 1 ? f[0] : undefined; })();
  }
  private fullNames = new Map<MemberId, string>();

  /**
   * Did these two members actually meet through the Network (a booked plan reached both, or a
   * meeting was recorded)? Anonymous probes do not count: neither knew who the other was. A plan
   * keeps a member who said no in `participants`, and `contacted` means only "got a probe", so the
   * booked plan must have reached both (`bookedTold`).
   */
  private metBefore(a: MemberId, b: MemberId): boolean {
    for (const o of this.opps.values()) if (o.meetingAt !== undefined && o.bookedTold?.includes(a) && o.bookedTold.includes(b)) return true;
    return this.interactions.some(x => x.participants.includes(a) && x.participants.includes(b) && (x.outcome === "completed" || x.outcome === "no_show"));
  }

  /**
   * "block X" and "report X". Order and rules (network-consent-4, -6, -7, -13, -14, -18; F23):
   *  - the reporter's words are never scored as the reporter's abuse (handled before abuse);
   *  - the target is resolved among the member's counterparts first (resolveTarget): "him" or "my
   *    date" is the one open or most recent counterpart, and a name two counterparts share gets
   *    "Who do you mean?" (only names of people the member was introduced to);
   *  - a name that is no counterpart may still be a member they never met: the block stands, and the
   *    reply is the same as for a name that matches nobody (no membership oracle, never a false "Done");
   *  - every report about a member opens a staff case; points need a shared interaction and
   *    corroboration (trust.ts); "reported" copy is sent only when that case exists and they met;
   *  - a report that the member is under 18 takes them out of matching until staff review (-9);
   *  - a booked meeting between them is called off with a neutral note to the other member.
   */
  private handleBlock(m: MemberState, c: Classified, currentDanger = false) {
    const verb = c.kind as "block" | "report";
    const kind: ReportKind = c.otherAge !== undefined && isMinor(c.otherAge) ? "minor" : reportKindOf(c.text ?? "");
    m.pendingSafety = undefined;
    const r = this.resolveTarget(m, c.target ?? "", verb === "report");
    if (r.ask) {
      // Ids and kinds only: what they said is not kept while we wait for the name.
      m.pendingSafety = { verb, kind, at: this.now(), targets: r.ask.map(x => x.id) };
      this.ctx.log(`${verb}_ambiguous`, { memberId: m.id, options: r.ask.length });
      this.safetyReply(m, copy.whoDoYouMean(this.namesFor(r.ask)), currentDanger, "question");
      return;
    }
    this.applyBlock(m, verb, kind, r.target, currentDanger);
  }

  /** The block or report itself, once the target is known (undefined: the name matched nobody). */
  private applyBlock(m: MemberState, verb: "block" | "report", kind: ReportKind, target: MemberState | undefined, currentDanger = false) {
    if (!target) {
      this.ctx.log(`${verb}_unresolved`, { memberId: m.id });
      this.safetyReply(m, verb === "block" ? copy.blockUnmatched : copy.reportUnmatched(currentDanger), currentDanger);
      return;
    }
    const met = this.metBefore(m.id, target.id);
    this.blockPair(m.id, target.id, met, true);
    if (verb === "report") this.reportSubject(m.id, target.id, kind, { source: "message", met });
    const reply = verb === "block" ? (met ? copy.blocked : copy.blockUnmatched)
      : met ? copy.reported(currentDanger) : copy.reportUnmatched(currentDanger);
    this.safetyReply(m, reply, currentDanger);
  }

  private blockRoster(o: Opp): MemberId[] {
    return o.participants.filter(id => o.stage === "scheduled" ? o.status.get(id) === "yes" : activeOpportunityParticipant(o, id));
  }

  /** Safety guidance is the first sentence and stays with the one direct reply. */
  private safetyReply(member: MemberState, detail: string, currentDanger: boolean, type: "info" | "question" = "info") {
    if (!currentDanger) return this.send(member, detail, { type }, "reply");
    const body = detail ? `${copy.immediateDanger} ${detail}` : copy.immediateDanger;
    return this.send(member, body, { type, safety: true }, "safety", { immutableBody: true });
  }

  private handleImmediateDanger(member: MemberState, msg: InboundMessage, classified: Classified) {
    if (classified.kind === "report" || classified.kind === "block") return this.handleBlock(member, classified, true);
    const awaited = member.awaiting;
    const opp = awaited?.kind === "feedback" && awaited.oppId ? this.opps.get(awaited.oppId) : undefined;
    const now = this.now();
    if (opp && !opp.plan && this.feedbackCandidate(member.id, opp, now)) {
      const receiptAt = this.feedbackReceiptAt(opp, member.id);
      const currentReceipt = meetingFeedbackReplyAllowed(true, true, receiptAt !== undefined,
        receiptAt ?? -1, msg.signedReceivedAt ?? msg.ts, now);
      const reportKind = emergencyCheckInReportKind(msg.body);
      const others = opp.participants.filter(id => id !== member.id && opp.status.get(id) === "yes");
      if (reportKind && emergencyCheckInReport(currentReceipt, true) && others.length === 1) {
        member.awaiting = undefined;
        opp.feedbackFrom.add(member.id);
        this.recordMeetingSafetyReport(member.id, opp, others[0]!, reportKind);
        return this.safetyReply(member, copy.reported(true), true);
      }
    }
    this.safetyReply(member, "", true);
  }

  /**
   * The people the Network introduced this member to, most recent first: the others in a booked or
   * past meeting the member was told about, and recorded meetings. `open`: the meeting is still ahead.
   */
  private counterparts(id: MemberId): { m: MemberState; at: number; open: boolean }[] {
    const by = new Map<MemberId, { at: number; open: boolean }>();
    const add = (x: MemberId, at: number, open: boolean) => {
      if (x === id || !this.members.has(x) || this.declinedIds.has(x)) return;
      const p = by.get(x);
      if (!p || at > p.at || (open && !p.open)) by.set(x, { at: Math.max(at, p?.at ?? at), open: open || !!p?.open });
    };
    // Only a booked meeting the member was told about, and only the others told about it who said yes:
    // a plan's probe goes out with no names, so a member who only got a probe, or an invitee who was
    // probed but never booked (a late joiner, an unavailable or dropped one), is no counterpart.
    for (const o of this.opps.values()) {
      if (!o.participants.includes(id) || o.meetingAt === undefined || !o.bookedTold?.includes(id)) continue;
      const open = o.stage === "scheduled";
      for (const x of o.participants) if (o.bookedTold.includes(x) && o.status.get(x) === "yes") add(x, o.meetingAt, open);
    }
    for (const x of this.interactions) {
      if (!x.participants.includes(id) || (x.outcome !== "completed" && x.outcome !== "no_show")) continue;
      for (const p of x.participants) add(p, x.at, false);
    }
    return [...by].map(([x, v]) => ({ m: this.members.get(x)!, ...v })).sort((a, b) => b.at - a.at || (a.m.id < b.m.id ? -1 : 1));
  }

  /**
   * Who "block X" or "report X" is about (F23). Pronouns ("him", "her", "them", "my date") mean the
   * one open counterpart, else the most recent one. A name is looked up among counterparts (full
   * name, "First L.", first name); with none, among every member (findByName: a member they never
   * met, and the block still stands). Two or more possible people, or a pronoun with no counterpart:
   * `ask`, with the counterparts to choose from.
   */
  private resolveTarget(m: MemberState, raw: string, confirmPast = false): { target?: MemberState; ask?: MemberState[] } {
    const text = raw.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[.!?,;:]+\s*$/, "").trim();
    const cps = this.counterparts(m.id);
    if (!text || PRONOUN_TARGET.test(text)) {
      const open = cps.filter(x => x.open);
      if (open.length === 1) return { target: open[0]!.m };
      if (open.length > 1) return { ask: open.map(x => x.m) };
      const top = cps.filter(x => x.at === cps[0]?.at);
      // A report by pronoun with no date ahead is confirmed first ("Who do you mean: Leo?"): the most
      // recent counterpart may be long ago and not the person the member means.
      return top.length === 1 && !confirmPast ? { target: top[0]!.m } : { ask: top.map(x => x.m) };
    }
    const t = text.toLowerCase().replace(/\s+/g, " ");
    const word = (w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}])`, "u");
    const named = (x: MemberState, k: "full" | "display" | "first") => {
      const v = (k === "full" ? this.fullNames.get(x.id) ?? "" : k === "display" ? x.display : x.first).toLowerCase().replace(/\.$/, "");
      return !!v && word(v).test(t);
    };
    for (const k of ["full", "display", "first"] as const) {
      const hits = cps.filter(x => named(x.m, k)).map(x => x.m);
      if (hits.length === 1) return { target: hits[0]! };
      if (hits.length > 1) return { ask: hits };
    }
    return { target: this.findByName(text, m.id) };
  }

  /** First names for "Who do you mean?", or "First L." when two of them share a first name. */
  private namesFor(list: MemberState[]): string[] {
    const firsts = list.map(x => x.first);
    return list.map(x => (firsts.filter(f => f === x.first).length > 1 ? x.display : x.first));
  }

  pendingReportChoices(memberId: MemberId, replyNames: readonly PendingReportReplyName[], receivedAt: number):
    (PendingReportChoice & { routable: boolean })[] {
    const pending = this.members.get(memberId)?.pendingSafety;
    const now = this.now();
    if (pending?.verb !== "report" || !reportClarificationTimeCurrent(pending.at, receivedAt, now, now - DAY)) return [];
    const offered = (pending.targets ?? []).flatMap(id => {
      const target = this.members.get(id);
      return target ? [target] : [];
    });
    if (offered.length !== pending.targets?.length) return [];
    const counterparts = new Set(this.counterparts(memberId).map(candidate => candidate.m.id));
    const names = this.namesFor(offered);
    return offered.flatMap((target, index) => {
      const displayedName = safetyName(names[index]!);
      const reply = replyNames.find(({ name }) => name === displayedName);
      return reply && counterparts.has(target.id)
        ? [{ askedAt: pending.at, targetId: target.id, kind: pending.kind, routable: reply.routable }]
        : [];
    });
  }

  /**
   * The member's answer to "Who do you mean?" (within a day). A bare yes can confirm the one
   * person named in the question if another action is not also waiting for a reply. Return the
   * text still available for another prompt, or undefined when this question handled it all.
   */
  private answerWho(m: MemberState, p: PendingWho, body: string, signedReceivedAt: number | undefined): string | undefined {
    const now = this.now();
    const oldestQuestion = now - DAY;
    if (!safetyQuestionIsCurrent(p.at, oldestQuestion)) { m.pendingSafety = undefined; return body; }
    if (signedReceivedAt !== undefined && !reportClarificationTimeCurrent(p.at, signedReceivedAt, now, oldestQuestion)) return body;
    const text = body.trim();
    const reply = safetyQuestionReply(text);
    const matches = new Map<MemberId, MemberState>();
    for (const name of reply.acceptsName || reply.compareAlternatives ? reply.names : []) {
      const match = this.resolveTarget(m, name, p.verb === "report").target;
      if (match && [this.fullNames.get(match.id), match.display, match.first].some(value => value && safetyName(value) === name)) {
        matches.set(match.id, match);
      }
    }
    const named = reply.acceptsName && matches.size === 1 ? matches.values().next().value : undefined;
    const competing = Boolean(m.awaiting);
    const sole = p.targets?.length === 1 ? this.members.get(p.targets[0]!) : undefined;
    const exactConfirmation = !reply.explicitlyNamed && !text.normalize("NFKC").includes("?") && reply.names.some(isSafetyConfirmation);
    const confirmed = safetyQuestionUsesSoleOffer(!!sole, competing, exactConfirmation, matches.size > 0) ? sole : undefined;
    const target = named ?? confirmed;
    const allowedTarget = target && (p.verb === "block" || this.counterparts(m.id).some(x => x.m.id === target.id)) ? target : undefined;
    const cancels = reply.cancels || (!competing && reply.refuses);
    const exclusion = sole && readSoleSafetyTargetExclusion(text, [this.fullNames.get(sole.id), sole.display, sole.first], competing);
    const rulesOutTarget = exclusion?.excludes ?? false;
    // spec/safetyCase.md, "An unrelated reply keeps a current safety question"
    if (!safetyQuestionResolves(!!allowedTarget, competing, cancels, rulesOutTarget, text.split(/\s+/).length <= 4)) return body;
    m.pendingSafety = undefined;
    if (allowedTarget && safetyQuestionAppliesTarget(true, rulesOutTarget)) {
      this.applyBlock(m, p.verb, p.kind, allowedTarget);
      return;
    }
    if (competing) return safetyReplyAfterExclusion(competing, exclusion?.separateReply !== undefined, body, exclusion?.separateReply ?? "") || undefined;
    if (cancels) { this.ack(m, copy.safetyNoAction); return; }
    if (p.verb === "block") { this.applyBlock(m, p.verb, p.kind, undefined); return; }
    this.ctx.log(`${p.verb}_unresolved`, { memberId: m.id });
    this.send(m, copy.whoUnresolved, { type: "info" }, "reply");
  }

  safetyRouteFacts(id: MemberId, body: string): { pendingSafetyAt: number; meetingAt: number } {
    const m = this.members.get(id);
    if (!m) return { pendingSafetyAt: -1, meetingAt: -1 };
    const pendingSafetyAt = m.pendingSafety && this.now() - m.pendingSafety.at <= DAY ? m.pendingSafety.at : -1;
    const c = classify(body.trim());
    if (c.kind !== "block" && c.kind !== "report") return { pendingSafetyAt, meetingAt: -1 };
    const r = this.resolveTarget(m, c.target ?? "", c.kind === "report");
    const named = new Set((r.target ? [r.target] : r.ask ?? []).map(x => x.id));
    const meetingAt = Math.max(-1, ...this.counterparts(id).filter(x => named.has(x.m.id)).map(x => x.at));
    return { pendingSafetyAt, meetingAt };
  }

  private minorReported(target: MemberState, by: MemberId) {
    const now = this.now();
    this.caseEvent(target.id, { at: now, kind: "minor_reported", points: 0, by });
    this.ctx.log("minor_reported", { memberId: target.id, by });
    this.opts.onMinorSignal?.(target.id);
    if (target.minor) {
      target.minorReported = true;
      this.endTeenContact(target.id);
      return;
    }
    target.minor = true; target.minorSignal = true; target.minorReported = true;
    this.ledgerAge(target);
    this.minorAfterContact(target.id);
    this.dropMember(target.id, "minors policy");
  }

  clearMinorSignal(memberId: MemberId, actor: string, note?: string): ActionResult {
    const stored = this.record(memberId);
    const m = this.members.get(memberId) ?? (stored && recordMinorSignalOpen(stored) ? this.member(memberId) : undefined);
    if (m) this.syncRecord(m);
    const actorPresent = !!actor.trim();
    const birth = this.record(memberId);
    const { minDay } = this.teenDays();
    if (birth?.birthExact === true && ageOnDay(birth.birthKey ?? 0, minDay) < ADULT_AGE) return this.clearTeenDoubt(memberId, m, birth, actor, note);
    const signal = !!(m?.minorSignal || m?.minorReported || m?.minor);
    const record = m && signal && actorPresent ? this.attestedAge(m) : undefined;
    const decision = minorClearResult(actorPresent, !!m || !!stored, signal, record !== undefined, record !== undefined && record < ADULT_AGE, m !== undefined && (statedAgeOn(m, minDay) ?? ADULT_AGE) < ADULT_AGE);
    if (decision !== "AllowedAction") return { ok: false, reason: SAFETY_REFUSAL[decision] };
    if (!m) return { ok: false, reason: "unknown_member" };
    m.minor = false; m.minorSignal = false; m.minorReported = false; m.ageConflict = false;
    m.minorClearedAt = this.now();
    this.ledgerAge(m);
    this.dirty = true;
    const c = this.openCase(memberId);
    this.caseEvent(memberId, { at: this.now(), kind: "minor_signal_cleared", points: 0 });
    this.ctx.log("safety_action", { action: "clear_minor_signal", caseId: c?.id ?? this.openCase(memberId)?.id ?? null, memberId, actor, note: note ?? null });
    return { ok: true };
  }

  private clearTeenDoubt(memberId: MemberId, m: MemberState | undefined, r: MemberRecord, actor: string, note?: string): ActionResult {
    const { minDay, maxDay } = this.teenDays();
    const key = r.birthKey ?? 0;
    const doubt = !!m && (m.minorSignal || m.minorReported === true || m.ageConflict === true || recordMinorSignalOpen(r, m));
    const older = m?.olderReported === true || this.reports.some(x => x.subjectId === memberId && (x.kind === "older_than_stated" || x.kind === "lying"));
    const decision = teenDoubtClearResult(!!actor.trim(), !!m, doubt, r.birthExact === true,
      key, minDay, maxDay, r.teenBarred === true, older);
    if (decision !== "AllowedAction") return { ok: false, reason: SAFETY_REFUSAL[decision] };
    if (!m) return { ok: false, reason: "unknown_member" };
    m.minorSignal = false; m.minorReported = false; m.ageConflict = false;
    m.minorClearedAt = this.now();
    for (const x of this.reports) {
      if (x.subjectId !== memberId || x.kind !== "minor") continue;
      const next = REPORT_STATUS[reportAfterDecision(REPORT_PHASE[x.status], "DismissReport", true, true)];
      if (next === x.status) continue;
      x.status = next; x.decidedBy = actor; x.decidedAt = this.now();
    }
    this.dirty = true;
    this.teenCachesChanged();
    this.caseEvent(memberId, { at: this.now(), kind: "teen_doubt_cleared", points: 0 });
    this.ctx.log("safety_action", { action: "clear_teen_doubt", caseId: this.openCase(memberId)?.id ?? null, memberId, actor, note: note ?? null });
    return { ok: true };
  }

  minorClearedAt(memberId: MemberId): number | undefined {
    return this.members.get(memberId)?.minorClearedAt;
  }

  // ================================================================== requests
  /** Profile and matching consumers both see the member's durable choices. */
  private controlledIntentSnapshot(snap: WorldSnapshot): WorldSnapshot {
    let changed = false;
    const intents = snap.intents.map(intent => {
      const control = this.members.get(intent.memberId)?.intentControls?.[`stored:${intent.id}`];
      if (!control || intent.details?.startsWith(JOB_INTENT)) return intent;
      changed = true;
      return { ...intent, status: INTENT_CONTROL_STATUS[effectiveStandingControl(intent.status, control)] };
    });
    return changed ? { ...snap, intents } : snap;
  }

  private ownStandingIntents(memberId: MemberId, now: number) {
    const stored = this.snapshotCached().intents.filter(i => i.memberId === memberId && !i.details?.startsWith(JOB_INTENT));
    const own = stored.map(intent => ({ key: `stored:${intent.id}`, intent }));
    const m = this.members.get(memberId);
    for (const [desire, at] of m?.learned.desires ?? []) {
      const def = desireById.get(desire);
      if (!def || stored.some(i => i.objective === def.text && standingIntentBlocksLearnedCopy(standingIntentPhaseAt(i, now)))) continue;
      const key = `learned:${desire}`;
      const control = m?.intentControls?.[key];
      own.push({ key, intent: {
        id: `${memberId}:li:${desire}`, memberId, objective: def.text, category: def.category,
        createdAt: at, horizonDays: learnedIntentDays, status: control ? INTENT_CONTROL_STATUS[control] : "active",
      } });
    }
    return own.sort((a, b) => b.intent.createdAt - a.intent.createdAt || a.key.localeCompare(b.key));
  }

  manageStandingIntents(memberId: MemberId, command: StandingIntentCommand, canonicalMembership: boolean, causeId: string): StandingTurn {
    const known = this.members.get(memberId);
    const scope = stepIntentManagement(initialIntentManagement, {
      type: "authorizeIntentCommand", command: command.kind,
      allowed: intentManagementAllowed(canonicalMembership, canonicalMembership && !!this.record(memberId), !!known?.optedOut),
    });
    if (scope.phase === "MemberRefused")
      return refusedCommandPasses(command.kind, "target" in command && command.target.kind === "pending") ? { kind: "pass" } : { kind: "silent" };
    const m = known ?? this.member(memberId);
    const now = this.now();
    const reply = (body: string): StandingTurn => { this.dirty = true; return { kind: "reply", body }; };
    if (command.kind === "ListIntents") return scope.phase === "ShowIntents" ? reply(this.standingListText(m, command.page, now)) : { kind: "silent" };
    if (command.kind === "UndoIntent") return scope.phase === "UndoRequested" ? reply(this.undoStanding(m, now, causeId)) : { kind: "silent" };
    const entries = this.standingEntries(m, now);
    const target = command.target;
    const pending = target.kind === "pending" ? m.standingPending : undefined;
    let matches: StandingOwn[];
    if (target.kind === "pending") {
      const answer = command.kind === "CloseIntent" ? "CloseReply" : command.kind === "KeepIntent" ? "KeepReply" : undefined;
      if (!answer || !pending || !standingReplyApplies(pending.kind, answer, now - pending.at)) return { kind: "pass" };
      m.standingPending = undefined;
      matches = entries.filter(e => pending.keys.includes(e.key));
      if (!matches.length) return reply(STANDING_COPY.unknown);
    } else if (target.kind === "position") {
      const list = m.standingList;
      if (!list) return reply(STANDING_COPY.unknown);
      if (!standingListNumberCurrent(now - list.at, target.position, list.keys.length)) {
        return reply(standingListNumberCurrent(now - list.at, 1, 1) ? STANDING_COPY.unknown : STANDING_COPY.staleNumber);
      }
      matches = entries.filter(e => e.key === list.keys[target.position - 1]);
    } else matches = entries.filter(e => e.ref === target.reference);
    const decision = stepIntentManagement(scope, {
      type: "chooseOwnedIntent", matches: pending && matches.length ? 1 : matches.length,
      live: matches.some(e => e.phase === "IntentLive"), paused: matches.some(e => e.phase === "IntentPaused"),
    });
    const selected = matches[0];
    if (!selected || decision.phase === "UnknownIntent" || decision.phase === "AmbiguousIntent") return reply(STANDING_COPY.unknown);
    const summaries = matches.map(e => e.summary);
    switch (decision.phase) {
      case "PauseSelected": {
        if (selected.kind === "posting") return reply(STANDING_COPY.postingNoPause(selected.title ?? selected.summary));
        for (const e of matches) this.applyStandingPause(m, e, "MemberThread", causeId);
        const introNamed = matches.some(e => this.standingInProgress(m, e));
        m.standingPending = { kind: "PausedByMember", keys: matches.map(e => e.key), at: now, introNamed };
        return reply(STANDING_COPY.paused(summaries, introNamed));
      }
      case "CloseSelected":
        return reply(this.closeStanding(m, matches, "MemberThread", !!pending && standingCloseConfirmed(pending.kind, pending.introNamed === true), causeId));
      case "ResumeSelected":
        for (const e of matches) this.applyStandingResume(m, e, "MemberThread", causeId, "ResumeSelected");
        return reply(STANDING_COPY.resumed(summaries));
      case "KeepSelected": {
        if (selected.kind === "posting") return reply(STANDING_COPY.already(selected.summary, "on"));
        if (pending?.kind === "CloseAsked") {
          for (const e of matches) this.applyStandingResume(m, e, "MemberThread", causeId, "KeepSelected");
          return reply(STANDING_COPY.resumed(summaries));
        }
        for (const e of matches) this.applyStandingKeep(m, e, causeId);
        const kept = this.standingEntries(m, now).find(e => e.key === selected.key);
        return reply(kept && kept.endsAt !== null ? STANDING_COPY.kept(selected.summary, kept.endsAt) : STANDING_COPY.resumed(summaries));
      }
      default:
        return reply(STANDING_COPY.already(selected.summary, selected.phase === "IntentPaused" ? "paused" : "on"));
    }
  }

  standingView(memberId: MemberId): StandingView {
    const m = this.members.get(memberId);
    if (!m) return { entries: [], closedRecently: [], checkWithPerson: [] };
    const now = this.now();
    const own = this.standingEntries(m, now);
    const entries = own.map((e, i) => this.standingEntryView(m, e, i, now));
    const listed = new Set(own.map(e => e.key));
    const closedRecently = Object.entries(m.standingClosed ?? {}).flatMap(([key, closedAt]) => {
      if (listed.has(key) || Math.floor((now - closedAt) / DAY) >= recentCloseDays) return [];
      const record = this.standingRecordOf(m, key, now);
      return record ? [{ ref: record.ref, summary: record.summary, closedAt }] : [];
    });
    const check = m.assistantProfileCheck && now - m.assistantProfileCheck.at < HOUR ? m.assistantProfileCheck.items : [];
    const checkWithPerson = check.flatMap(({ key, reason }) => {
      const record = this.standingRecordOf(m, key, now);
      return record ? [{ ref: record.ref, summary: record.summary, reason }] : [];
    });
    return { entries, closedRecently, checkWithPerson };
  }

  agentStandingChange(memberId: MemberId, supplied: string, change: "pause" | "resume", adult: boolean, causeId: string): AgentStandingResult {
    const ref = canonicalStandingReference(supplied);
    const m = this.members.get(memberId);
    if (!m || !this.record(memberId) || m.optedOut) return { kind: "refused", reason: "unknown_ref" };
    const now = this.now();
    const refuse = (reason: "unknown_ref" | "daily_limit" | "closed" | "posting" | "adults_only", key?: string): AgentStandingResult => {
      this.logStanding(m, key || { ref }, change, "MemberAgent", "refused", causeId, { reason });
      return { kind: "refused", reason };
    };
    m.agentStandingChanges = (m.agentStandingChanges ?? []).filter(at => at <= now && now - at < DAY);
    const entries = this.standingEntries(m, now);
    const matches = entries.filter(e => e.ref === ref);
    if (matches.length !== 1) {
      const closedKey = Object.entries(m.intentControls ?? {}).find(([key, control]) =>
        control === "CloseControl" && standingIntentReference(this.app.id, m.id, key) === ref)?.[0];
      return closedKey ? refuse("closed", closedKey) : refuse("unknown_ref");
    }
    const e = matches[0]!;
    if (e.kind === "posting") return refuse("posting", e.key);
    if (change === "resume" && !adult) return refuse("adults_only", e.key);
    const index = entries.indexOf(e);
    if ((change === "pause" && e.phase === "IntentPaused") || (change === "resume" && e.phase === "IntentLive")) {
      this.logStanding(m, e.key, change, "MemberAgent", "unchanged", causeId);
      return { kind: "unchanged", entry: this.standingEntryView(m, e, index, now) };
    }
    const inProgress = this.standingInProgress(m, e);
    const outcome = standingChangeOutcome("MemberAgent", change === "pause" ? "PauseStanding" : "ResumeStanding", inProgress, false, m.agentStandingChanges.length, -1);
    if (outcome !== "ApplyNow") return refuse("daily_limit", e.key);
    if (change === "pause") this.applyStandingPause(m, e, "MemberAgent", causeId);
    else this.applyStandingResume(m, e, "MemberAgent", causeId, "ResumeSelected");
    m.agentStandingChanges = [...m.agentStandingChanges, now];
    m.standingPending = { kind: change === "pause" ? "PausedByAgent" : "ResumedByAgent", keys: [e.key], at: now, introNamed: change === "pause" && inProgress };
    this.dirty = true;
    const after = this.standingEntries(m, now);
    const current = after.find(x => x.key === e.key) ?? e;
    const entry = this.standingEntryView(m, current, Math.max(0, after.indexOf(current)), now);
    const notice = change === "pause" ? STANDING_COPY.agentPaused(e.summary, this.app.name, inProgress) : STANDING_COPY.agentResumed(e.summary, this.app.name);
    return { kind: "applied", entry, notice };
  }

  private standingSourceOfTurn(): StandingSource {
    return this.turnSource === "thread" ? "MemberThread" : "AssistantProfile";
  }

  private standingRef(memberId: MemberId, key: string): string {
    return standingIntentReference(this.app.id, memberId, key);
  }

  private standingSummaryText(text: string, memberId: MemberId): string {
    const title = text.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim().slice(0, 90);
    const safe = title && !this.guardCheck(title, memberId).length && (!this.ratesPhotos || appearanceLeak(title) === null);
    return safe ? title : "Saved intent";
  }

  private requestObjective(r: Request): string {
    const def = r.desireId ? desireById.get(r.desireId) : undefined;
    return def?.text ?? (r.tags[0] ? `meet someone into ${interestLabel(r.tags[0])}` : `${r.category} request`);
  }

  private standingEntries(m: MemberState, now: number): StandingOwn[] {
    const entries: StandingOwn[] = [];
    for (const { key, intent } of this.ownStandingIntents(m.id, now)) {
      const phase = standingIntentPhaseAt(intent, now);
      if (phase !== "IntentLive" && phase !== "IntentPaused") continue;
      const learned = key.startsWith("learned:");
      entries.push({
        key, ref: this.standingRef(m.id, key), kind: learned ? "want" : "intent", summary: this.standingSummaryText(intent.objective, m.id),
        phase, objective: intent.objective, desire: learned ? key.slice("learned:".length) : DESIRES.find(d => d.text === intent.objective)?.id,
        ...(learned ? {} : { storedId: intent.id }), endsAt: standingIntentDeadline(intent),
      });
    }
    const covered = new Set(entries.map(e => e.objective));
    for (const r of this.requests) {
      if (r.memberId !== m.id || r.kind !== "people") continue;
      const key = `request:${r.id}`;
      const open = !r.withdrawn && !r.closed && (r.outcome === undefined || r.outcome === "none" || r.outcome === "probing");
      const paused = r.withdrawn === true && r.withdrawnBy === key && m.intentControls?.[key] === "PauseControl";
      const objective = this.requestObjective(r);
      if ((!open && !paused) || covered.has(objective)) continue;
      entries.push({
        key, ref: this.standingRef(m.id, key), kind: "request", summary: this.standingSummaryText(objective, m.id),
        phase: paused ? "IntentPaused" : "IntentLive", objective, ...(r.desireId ? { desire: r.desireId } : {}), requestId: r.id, endsAt: null,
      });
    }
    if (this.opts.hooks?.postings) for (const p of postingsOf(this.snapshotCached(), m.id)) {
      if (!p.active) continue;
      const key = `posting:${p.id}`;
      entries.push({
        key, ref: this.standingRef(m.id, key), kind: "posting", summary: this.standingSummaryText(`${p.title} post`, m.id),
        phase: "IntentLive", objective: p.title, postingId: p.id, title: p.title, endsAt: null,
      });
    }
    return entries;
  }

  private standingRecordOf(m: MemberState, key: string, now: number): StandingOwn | undefined {
    const listed = this.standingEntries(m, now).find(e => e.key === key);
    if (listed) return listed;
    const closed = (objective: string, kind: StandingKind, extra: Partial<StandingOwn>): StandingOwn => ({
      key, ref: this.standingRef(m.id, key), kind, summary: this.standingSummaryText(objective, m.id), phase: "IntentClosed", objective, endsAt: null, ...extra,
    });
    const [prefix, ...rest] = key.split(":");
    const id = rest.join(":");
    if (prefix === "learned") {
      const def = desireById.get(id);
      return def ? closed(def.text, "want", { desire: id }) : undefined;
    }
    if (prefix === "stored") {
      const intent = this.snapshotCached().intents.find(i => i.memberId === m.id && i.id === id);
      return intent ? closed(intent.objective, "intent", { storedId: id, desire: DESIRES.find(d => d.text === intent.objective)?.id }) : undefined;
    }
    if (prefix === "request") {
      const r = this.requests.find(x => x.id === id && x.memberId === m.id);
      return r ? closed(this.requestObjective(r), "request", { requestId: r.id, ...(r.desireId ? { desire: r.desireId } : {}) }) : undefined;
    }
    return undefined;
  }

  private standingEntryView(m: MemberState, e: StandingOwn, index: number, now: number): StandingEntry {
    const pending = m.standingPending;
    const asked = !!pending && pending.keys.includes(e.key) && (pending.kind === "CloseAsked" || pending.kind === "RenewalAsked")
      && standingReplyApplies(pending.kind, "KeepReply", now - pending.at);
    const status: StandingStatus = e.kind === "posting" ? "open" : asked ? "waiting_on_you" : e.phase === "IntentPaused" ? "paused" : "active";
    return { ref: e.ref, number: index + 1, kind: e.kind, summary: e.summary, status, inProgress: this.standingInProgress(m, e), endsAt: e.endsAt };
  }

  private standingListText(m: MemberState, page: number, now: number): string {
    const entries = this.standingEntries(m, now);
    m.standingList = { keys: entries.map(e => e.key), at: now };
    if (!entries.length) return STANDING_COPY.listEmpty(this.app.name);
    const perPage = 6, pages = Math.ceil(entries.length / perPage);
    if (page > pages) return STANDING_COPY.listPages(pages);
    const shown = entries.slice((page - 1) * perPage, page * perPage).map((e, i) => this.standingEntryView(m, e, (page - 1) * perPage + i, now));
    const tz = this.memberZone(m.id);
    return [
      STANDING_COPY.listHeader(this.app.name, page, pages),
      ...shown.map(v => STANDING_COPY.listLine(v, v.endsAt !== null && v.endsAt - now <= renewalAskDays * DAY, tz)),
      STANDING_COPY.listFooter(shown[0]!.number, page < pages ? page + 1 : undefined),
    ].join("\n");
  }

  private standingRequests(m: MemberState, e: StandingOwn, now: number): Request[] {
    const memberId = m.id;
    if (e.kind === "posting") return [];
    if (e.kind === "request") return this.requests.filter(r => r.id === e.requestId && r.memberId === memberId);
    const stillLive = this.standingEntries(m, now).some(x => x.key !== e.key && x.objective === e.objective && x.phase === "IntentLive" && x.kind !== "request");
    if (!e.desire || !retireIntentSearch(true, stillLive)) return [];
    return this.requests.filter(r => r.memberId === memberId && r.kind === "people" && r.desireId === e.desire && (!r.withdrawn || r.withdrawnBy === e.key));
  }

  private standingLinkedOpps(m: MemberState, e: StandingOwn): Opp[] {
    const memberId = m.id;
    const oppIds = new Set(this.standingRequests(m, e, this.now()).flatMap(r => r.oppId ? [r.oppId] : []));
    const anchors = new Set<string>();
    if (e.storedId) anchors.add(e.storedId);
    if (e.kind === "want" && e.desire) {
      anchors.add(`${memberId}:li:${e.desire}`);
      for (const i of this.snapshotCached().intents) if (i.memberId === memberId && i.objective === e.objective && !i.details?.startsWith(JOB_INTENT)) anchors.add(i.id);
    }
    return [...this.opps.values()].filter(o => o.participants.includes(memberId)
      && (oppIds.has(o.id) || (o.anchor?.type === "intent" && anchors.has(o.anchor.id))));
  }

  private standingInProgress(m: MemberState, e: StandingOwn): boolean {
    return this.standingLinkedOpps(m, e).some(o => o.stage === "probing" && o.participants.some(p => p !== m.id && o.contacted.has(p)));
  }

  private writeStandingRow(memberId: MemberId, e: StandingOwn, phase: IntentCommandPhase, paused: boolean) {
    if (!e.storedId) return;
    const command = phase === "PauseSelected" ? "PauseIntent" : phase === "CloseSelected" ? "CloseIntent" : phase === "KeepSelected" ? "KeepIntent" : "ResumeIntent";
    if (!writesStandingIntentRow({ phase, command }, true, paused)) return;
    const row = this.ctx.snapshot().intents.find(i => i.memberId === memberId && i.id === e.storedId);
    if (!row) return;
    const status = phase === "PauseSelected" ? "paused" : phase === "CloseSelected" ? "closed" : "active";
    if (row.status !== status) this.ctx.queueStandingIntentChange?.({ id: row.id, memberId, previousStatus: row.status, status });
  }

  private retireStandingWork(m: MemberState, e: StandingOwn, source: StandingSource, control: IntentControl,
    tally: { retired: string[]; booked: number; intro: boolean; released: { sent: number } }) {
    for (const o of this.standingLinkedOpps(m, e)) {
      if (o.stage === "scheduled") tally.booked++;
      if (!retireStandingOpportunity(true, source, control, o.stage)) continue;
      if (o.stage === "probing" && o.participants.some(p => p !== m.id && o.contacted.has(p))) tally.intro = true;
      tally.retired.push(o.id);
      this.close(o, "requester unavailable", control === "CloseControl" ? { closedBy: m.id, released: tally.released } : {});
    }
    this.withdrawRequests(m, this.standingRequests(m, e, this.now()), e.key);
  }

  private applyStandingPause(m: MemberState, e: StandingOwn, source: StandingSource, causeId: string) {
    const tally = { retired: [] as string[], booked: 0, intro: false, released: { sent: 0 } };
    this.retireStandingWork(m, e, source, "PauseControl", tally);
    m.intentControls = { ...m.intentControls, [e.key]: "PauseControl" };
    this.writeStandingRow(m.id, e, "PauseSelected", false);
    this.dirty = true;
    this.logStanding(m, e.key, "pause", source, "applied", causeId, { retired: tally.retired });
  }

  private applyStandingResume(m: MemberState, e: StandingOwn, source: StandingSource, causeId: string, phase: "ResumeSelected" | "KeepSelected") {
    const { [e.key]: _, ...controls } = m.intentControls ?? {};
    m.intentControls = controls;
    this.writeStandingRow(m.id, e, phase, true);
    this.restoreRequests(m, e.key);
    this.dirty = true;
    this.logStanding(m, e.key, phase === "KeepSelected" ? "keep" : "resume", source, "applied", causeId);
  }

  private applyStandingKeep(m: MemberState, e: StandingOwn, causeId: string) {
    if (e.phase === "IntentPaused") this.applyStandingResume(m, e, "MemberThread", causeId, "KeepSelected");
    else this.logStanding(m, e.key, "keep", "MemberThread", "applied", causeId);
    if (e.kind !== "want" || !e.desire) return;
    m.learned.desires.set(e.desire, this.now());
    const { [e.key]: _, ...asked } = m.renewalAsked ?? {};
    m.renewalAsked = asked;
    this.dirty = true;
  }

  private closeStanding(m: MemberState, targets: readonly StandingOwn[], source: StandingSource, confirmed: boolean, causeId: string): string {
    const now = this.now();
    const posting = targets.length === 1 && targets[0]!.kind === "posting" ? targets[0]! : undefined;
    if (posting) return this.startStandingPostingClose(m, posting, causeId);
    const things = targets.filter(e => e.kind !== "posting");
    const inProgress = things.some(e => this.standingInProgress(m, e));
    const outcome = standingChangeOutcome(source, "CloseStanding", inProgress, confirmed, (m.agentStandingChanges ?? []).length, -1);
    const summaries = things.map(e => e.summary);
    if (outcome === "RefuseChange") {
      for (const e of things) this.logStanding(m, e.key, "close", source, "refused", causeId, { reason: "not_allowed" });
      return STANDING_COPY.unknown;
    }
    if (outcome === "ConfirmFirst") {
      for (const e of things) if (e.phase === "IntentLive") this.applyStandingPause(m, e, source, causeId);
      m.standingPending = { kind: "CloseAsked", keys: things.map(e => e.key), at: now };
      for (const e of things) this.logStanding(m, e.key, "close", source, "asked", causeId);
      this.dirty = true;
      return STANDING_COPY.askFirst(summaries);
    }
    const tally = { retired: [] as string[], booked: 0, intro: false, released: { sent: 0 } };
    for (const e of things) {
      const before = { retired: tally.retired.length, released: tally.released.sent, booked: tally.booked };
      this.retireStandingWork(m, e, source, "CloseControl", tally);
      m.intentControls = { ...m.intentControls, [e.key]: "CloseControl" };
      m.standingClosed = { ...m.standingClosed, [e.key]: now };
      this.writeStandingRow(m.id, e, "CloseSelected", e.phase === "IntentPaused");
      this.logStanding(m, e.key, "close", source, "applied", causeId, {
        retired: tally.retired.slice(before.retired), released: tally.released.sent - before.released, booked: tally.booked - before.booked,
      });
    }
    m.standingPending = { kind: "ClosedByMember", keys: things.map(e => e.key), at: now };
    this.dirty = true;
    const body = tally.intro ? STANDING_COPY.closedWithIntro(summaries, tally.released.sent) : STANDING_COPY.closed(summaries);
    return tally.booked > 0 ? `${body}${STANDING_COPY.bookedStays}` : body;
  }

  private startStandingPostingClose(m: MemberState, e: StandingOwn, causeId: string): string {
    const stored = e.postingId ? this.storedPosting(m.id, e.postingId) : undefined;
    if (!stored || !e.postingId) return STANDING_COPY.unknown;
    const title = e.title ?? stored.title;
    m.posting = { close: true, closeReason: "closed", id: e.postingId, title, revision: postingRevision(stored), asks: 0, ready: true };
    m.awaiting = { kind: "posting", at: this.now() };
    this.dirty = true;
    this.logStanding(m, e.key, "close", "MemberThread", "asked", causeId, { reason: "posting" });
    return POSTING_COPY.readBackClose(title);
  }

  private undoStanding(m: MemberState, now: number, causeId: string): string {
    const pending = m.standingPending;
    if (!pending || !standingReplyApplies(pending.kind, "UndoReply", now - pending.at)) return STANDING_COPY.nothingToUndo;
    m.standingPending = undefined;
    this.dirty = true;
    const targets = pending.keys.flatMap(key => { const record = this.standingRecordOf(m, key, now); return record ? [record] : []; });
    if (!targets.length) return STANDING_COPY.nothingToUndo;
    const summaries = targets.map(e => e.summary);
    if (pending.kind === "ResumedByAgent") {
      for (const e of targets) if (e.phase === "IntentLive") this.applyStandingPause(m, e, "MemberThread", causeId);
      return STANDING_COPY.pausedAgain(summaries);
    }
    for (const e of targets) {
      if (pending.kind === "ClosedByMember") {
        const { [e.key]: _, ...closedAt } = m.standingClosed ?? {};
        m.standingClosed = closedAt;
      }
      if (e.phase !== "IntentLive") this.applyStandingResume(m, e, "MemberThread", causeId, "ResumeSelected");
      this.logStanding(m, e.key, "undo", "MemberThread", "applied", causeId);
    }
    return STANDING_COPY.resumed(summaries);
  }

  private closeNegatedStanding(m: MemberState, notWanted: readonly string[], causeId: string): boolean {
    const targets = this.negatedStanding(m, notWanted);
    if (!targets.length) return false;
    this.send(m, this.closeStanding(m, targets, "MemberThread", false, causeId), { type: "info" }, "reply");
    return true;
  }

  private checkAssistantNegations(m: MemberState, notWanted: readonly string[], causeId: string) {
    const now = this.now();
    const items = this.negatedStanding(m, notWanted).flatMap(e => {
      if (standingChangeOutcome("AssistantProfile", "CloseStanding", false, false, 0, -1) !== "RefuseChange") return [];
      this.logStanding(m, e.key, "close", "AssistantProfile", "refused", causeId, { reason: "not_allowed" });
      return [{ key: e.key, reason: "said_not_wanted" as const }];
    });
    m.assistantProfileCheck = { at: now, items };
    this.dirty = true;
  }

  private negatedStanding(m: MemberState, notWanted: readonly string[]): StandingOwn[] {
    if (!notWanted.length) return [];
    const objectives = new Set(notWanted.flatMap(d => { const text = desireById.get(d)?.text; return text ? [text] : []; }));
    return this.standingEntries(m, this.now()).filter(e => e.kind !== "posting"
      && ((e.desire !== undefined && notWanted.includes(e.desire)) || objectives.has(e.objective)));
  }

  private standingWantKeys(m: MemberState, want: StandingWant, now: number): string[] {
    const keys = new Set([
      ...this.standingEntries(m, now).map(e => e.key), ...Object.keys(m.intentControls ?? {}), ...Object.keys(m.standingClosed ?? {}),
      ...(want.desireId ? [`learned:${want.desireId}`] : []),
    ]);
    return [...keys].filter(key => {
      const record = this.standingRecordOf(m, key, now);
      if (!record || record.kind === "posting") return false;
      const r = record.requestId ? this.requests.find(x => x.id === record.requestId && x.memberId === m.id) : undefined;
      const tags = r?.tags ?? [];
      const category = r?.category ?? (record.desire ? desireById.get(record.desire)?.category : undefined);
      return sameStandingWant(want.desireId !== undefined || record.desire !== undefined, want.desireId !== undefined && record.desire === want.desireId,
        category === (want.category ?? "social"), tags.filter(t => want.tags.includes(t)).length, !tags.length && !want.tags.length);
    });
  }

  private standingAddGate(m: MemberState, want: StandingWant, request: boolean, quiet: boolean): boolean {
    const now = this.now();
    const keys = this.standingWantKeys(m, want, now);
    const pausedEntry = this.standingEntries(m, now).find(e => keys.includes(e.key) && e.phase === "IntentPaused");
    const closedKeys = keys.filter(key => m.intentControls?.[key] === "CloseControl" || m.standingClosed?.[key] !== undefined);
    const ages = closedKeys.flatMap(key => { const at = m.standingClosed?.[key]; return at === undefined ? [] : [Math.floor((now - at) / DAY)]; });
    const closedDaysAgo = ages.length ? Math.min(...ages) : -1;
    const source = this.standingSourceOfTurn();
    const causeId = this.turnCause ?? `system:${now}`;
    const route = standingAddRoute(source, request, pausedEntry !== undefined, closedKeys.length > 0, closedDaysAgo);
    if (route === "AddOpens") return true;
    if (route === "AddKeepsClose") return false;
    if (route === "AddKeepsPause") {
      if (!request || !pausedEntry) return false;
      this.logStanding(m, pausedEntry.key, "add", source, "refused", causeId, { reason: "paused" });
      if (!quiet && source === "MemberThread") this.send(m, STANDING_COPY.pausedStays(pausedEntry.summary), { type: "info" }, "reply");
      this.dirty = true;
      return false;
    }
    if (route === "AddRefused") {
      const check = m.assistantProfileCheck && now - m.assistantProfileCheck.at < HOUR ? m.assistantProfileCheck.items : [];
      const recent = closedKeys.filter(key => { const at = m.standingClosed?.[key]; return at !== undefined && Math.floor((now - at) / DAY) === closedDaysAgo; });
      const fresh = recent.filter(key => !check.some(item => item.key === key && item.reason === "ended_recently"));
      if (fresh.length) {
        m.assistantProfileCheck = { at: now, items: [...check, ...fresh.map(key => ({ key, reason: "ended_recently" as const }))] };
        for (const key of fresh) this.logStanding(m, key, "add", source, "refused", causeId, { reason: "recent_close" });
      }
      this.dirty = true;
      return false;
    }
    for (const key of closedKeys) {
      const { [key]: _, ...closed } = m.standingClosed ?? {};
      m.standingClosed = closed;
      if (m.intentControls?.[key] === "CloseControl") {
        const { [key]: __, ...controls } = m.intentControls;
        m.intentControls = controls;
      }
      this.logStanding(m, key, "add", source, "applied", causeId);
    }
    this.dirty = true;
    return true;
  }

  private withdrawRequests(m: MemberState, requests: readonly Request[], withdrawnBy: string) {
    for (const r of requests) {
      const withdrawal = stepMemberRequest(initialMemberRequest, {
        type: "applyRequestWithdrawal",
        matched: !r.closed && memberRequestWithdrawable(r.memberId === m.id, r.kind === "people", true, !!r.withdrawn, r.outcome ?? ""),
      });
      if (withdrawal.phase !== "RequestWithdrawn") continue;
      const opp = r.oppId ? this.opps.get(r.oppId) : undefined;
      const inFlight = !!opp && withdrawnRequestKeepsOpportunity(opp.stage);
      r.closed = true;
      r.withdrawn = true;
      r.withdrawnBy = withdrawnBy;
      if (!inFlight) r.outcome = "none";
      this.ctx.log("request_result", { requestId: r.id, memberId: m.id, outcome: "withdrawn" });
    }
  }

  private restoreRequests(m: MemberState, key: string) {
    for (const r of this.requests) {
      if (r.memberId !== m.id || r.withdrawnBy !== key) continue;
      const opp = r.oppId ? this.opps.get(r.oppId) : undefined;
      const inFlight = !!opp && withdrawnRequestKeepsOpportunity(opp.stage);
      r.withdrawn = false;
      r.closed = false;
      delete r.withdrawnBy;
      if (r.outcome === "probing" && !inFlight) r.outcome = "none";
      this.ctx.log("request_result", { requestId: r.id, memberId: m.id, outcome: "restored" });
    }
  }

  private logStanding(m: MemberState, key: string | { ref: string }, change: "add" | "pause" | "resume" | "keep" | "close" | "undo", source: StandingSource,
    outcome: "applied" | "asked" | "refused" | "unchanged", causeId: string, extra: { reason?: string; retired?: string[]; released?: number; booked?: number } = {}) {
    this.ctx.log("standing_changed", {
      memberId: m.id, ref: typeof key === "string" ? this.standingRef(m.id, key) : key.ref, kind: typeof key === "string" ? standingKindOf(key) : null, change, source: STANDING_SOURCE_LOG[source], outcome,
      ...(extra.reason ? { reason: extra.reason } : {}), causeId, retired: extra.retired ?? [], released: extra.released ?? 0, booked: extra.booked ?? 0,
    });
  }

  private askStandingRenewals(now: number) {
    for (const m of this.members.values()) {
      this.pruneStanding(m, now);
      if (m.optedOut || m.minor || !canBeMatched(this.ageOf(m))) continue;
      let due: { key: string; deadline: number; objective: string } | undefined;
      for (const { key, intent } of this.ownStandingIntents(m.id, now)) {
        if (!key.startsWith("learned:")) continue;
        const desire = key.slice("learned:".length);
        if (!m.learned.desires.has(desire)) continue;
        const deadline = standingIntentDeadline(intent);
        const searching = this.requests.some(r => r.memberId === m.id && r.kind === "people" && r.desireId === desire && !r.withdrawn && !r.closed);
        const refusedAt = m.renewalRefusedAt?.[key];
        if (!standingRenewalAskDue(standingIntentPhaseAt(intent, now) === "IntentLive", searching, Math.ceil((deadline - now) / DAY),
          m.renewalAsked?.[key] === deadline, refusedAt === undefined ? -1 : now - refusedAt)) continue;
        if (!due || deadline < due.deadline) due = { key, deadline, objective: intent.objective };
      }
      if (!due) continue;
      const asked = m.renewalAsked ?? {};
      m.renewalAsked = { ...asked, [due.key]: due.deadline };
      this.dirty = true;
      const result = this.send(m, STANDING_COPY.renewal(this.standingSummaryText(due.objective, m.id), due.deadline, this.memberZone(m.id)), { type: "question", proactive: true }, "info",
        { key: `standing-renewal:${m.id}:${due.key}:${due.deadline}`, hook: { t: "standing_renewal", key: due.key, deadline: due.deadline } });
      if (result === "refused") {
        m.renewalAsked = asked;
        m.renewalRefusedAt = { ...m.renewalRefusedAt, [due.key]: now };
      } else if (m.renewalRefusedAt?.[due.key] !== undefined) {
        const { [due.key]: _, ...refused } = m.renewalRefusedAt;
        m.renewalRefusedAt = refused;
      }
    }
  }

  private standingRenewalCurrent(m: MemberState, key: string, deadline: number): boolean {
    const now = this.now();
    const own = this.ownStandingIntents(m.id, now).find(x => x.key === key);
    return m.renewalAsked?.[key] === deadline && !!own && standingIntentDeadline(own.intent) === deadline
      && standingIntentPhaseAt(own.intent, now) === "IntentLive" && !m.optedOut && !m.minor && canBeMatched(this.ageOf(m));
  }

  private pruneStanding(m: MemberState, now: number) {
    let changed = false;
    const keep = <T>(record: Record<string, T> | undefined, live: (value: T) => boolean): Record<string, T> | undefined => {
      if (!record) return record;
      const kept = Object.fromEntries(Object.entries(record).filter(([, value]) => live(value)));
      if (Object.keys(kept).length !== Object.keys(record).length) changed = true;
      return kept;
    };
    m.standingClosed = keep(m.standingClosed, at => Math.floor((now - at) / DAY) < recentCloseDays);
    m.renewalAsked = keep(m.renewalAsked, deadline => deadline > now);
    m.renewalRefusedAt = keep(m.renewalRefusedAt, at => at <= now && now - at < renewalRetryMs);
    if (m.agentStandingChanges?.some(at => now - at >= DAY)) { m.agentStandingChanges = m.agentStandingChanges.filter(at => now - at < DAY); changed = true; }
    const pending = m.standingPending;
    if (pending && !(["UndoReply", "CloseReply", "KeepReply"] as const).some(answer => standingReplyApplies(pending.kind, answer, now - pending.at))) { m.standingPending = undefined; changed = true; }
    if (m.assistantProfileCheck && now - m.assistantProfileCheck.at >= HOUR) { m.assistantProfileCheck = undefined; changed = true; }
    if (changed) this.dirty = true;
  }

  /** Give a home-entry request to safety staff before it can become a contact. */
  private routeBoundedHelp(m: MemberState, text: string, quiet: boolean): boolean {
    const cfg = resolveConfig(this.effectiveEngineConfig());
    const homeEntry = isHomeEntry(cfg, text);
    const route = boundedHelpRoute(riskTerms(cfg, text).length > 0, homeEntry);
    if (route === "SearchPublicHelp") return false;
    const prompt = homeEntry && !quiet ? this.opts.homeHelpIntakePrompt?.(m.id) : undefined;
    if (route === "ReviewHomeEntryHelp" && canBeMatched(this.ageOf(m))) {
      const kind = "home_entry_help";
      if (openHomeHelpCase(true, this.openCase(m.id)?.events.some(e => e.kind === kind) === true)) {
        this.caseEvent(m.id, { at: this.now(), kind, points: 0 });
        this.ctx.log("request_result", { memberId: m.id, kind: "people", category: "help", outcome: "safety_review", reason: kind });
      }
      if (!quiet) this.send(m, prompt ?? copy.homeHelpSafetyReview, { type: "info" }, "reply");
    } else if (!quiet) {
      this.send(m, copy.requestOutOfScope, { type: "info" }, "reply");
    }
    return true;
  }

  // spec/staffSafetyService.md, "An agent signal goes to the decision that owns it"
  recordAgentSafetyConcern(memberId: MemberId): string | undefined {
    if (!this.members.has(memberId) && !this.record(memberId)) return undefined;
    this.caseEvent(memberId, { at: this.now(), kind: "agent_safety_concern", points: 0 });
    const caseId = this.openCase(memberId)?.id;
    this.ctx.log("safety_action", { action: "agent_safety_concern", caseId: caseId ?? null, memberId });
    this.dirty = true;
    return caseId;
  }

  /** A request saved before the admission check may still identify a home task by its stored goal. */
  private holdStoredHelp(m: MemberState, req: Request, objective = ""): boolean {
    if (req.category !== "help") return false;
    const goal = req.desireId ? desireById.get(req.desireId)?.text : undefined;
    if (!this.routeBoundedHelp(m, [goal, objective].filter(Boolean).join(". "), true)) return false;
    req.closed = true;
    req.outcome = "none";
    return true;
  }

  private holdHelpOpportunity(o: Opp): boolean {
    if (o.origin !== "request" || o.category !== "help" || !o.requester) return false;
    const requester = this.members.get(o.requester);
    const request = this.requests.find(req => req.oppId === o.id && req.memberId === o.requester);
    return !!requester && (request
      ? this.holdStoredHelp(requester, request, o.objective)
      : this.routeBoundedHelp(requester, o.objective, true));
  }

  private openRequest(m: MemberState, c: Classified, o: { quiet?: boolean }) {
    if (c.category === "help" && this.allowedCategories.has("help") && this.routeBoundedHelp(m, c.text ?? "", !!o.quiet)) return;
    if (!this.standingAddGate(m, { desireId: c.desireId, category: c.category, tags: c.tags }, true, !!o.quiet)) return;
    const now = this.now();
    const canSearch = this.trust.ok(m.id) && !this.reportHeld(m.id);
    const category = c.category ?? "social";
    const matching = this.opts.matchingEnabled && this.canStartMatching(m);
    // Repeat asks ("still hoping to...") are the same request: don't open another one while one is
    // in progress, and don't re-search the same want more than once every 3 days.
    const prior = [...this.requests].reverse().find(r => sameStandingRequest(
      r.memberId === m.id, r.kind === "people", (r.desireId ?? r.category) === (c.desireId ?? c.category), !!r.withdrawn, r.outcome ?? "",
    ));
    const probing = prior?.outcome === "probing";
    // The re-search interval is the member's effort overlay (NC; the floor is 3 days).
    const categoryAllowed = this.allowedCategories.has(category) && this.allowsMatchCategory(m.id, category);
    const admission = stepMemberRequest(initialMemberRequest, {
      type: "checkRequestAdmission",
      repeat: categoryAllowed && !!prior && requestInReuseWindow(probing, now - prior.at, probing ? 0 : this.effort(m.id).intentReSearchDays * DAY),
      categoryAllowed,
    });
    if (admission.phase === "RequestRepeated" && prior) {
      const route = stepMemberRequest(admission, {
        type: "routeRepeatedRequest", quiet: !!o.quiet, probing, matching,
      });
      if (route.phase === "RequestQuietRepeat") return;
      if (route.phase === "RequestAlreadyProbing") { this.send(m, "Still on it; I'll get back to you soon.", { type: "info" }, "reply"); return; }
      if (route.phase === "RequestMatchingPaused") return this.requestWaits(m, prior, o);
      const waiting = waitingMemberRequest(prior.outcome ?? "", !!prior.closed);
      const search = stepMemberRequest(route, {
        type: "routeImmediateRequestRetry",
        ready: immediateRequestSearchAllowed(waiting, canSearch, waiting && canSearch && this.busy(m.id),
          !!prior.lastTry, now - (prior.lastTry ?? now), prior.lastConfirmAt !== undefined, now - (prior.lastConfirmAt ?? now)),
      });
      const opp = this.tryRequest(m, prior, search);
      if (opp) { this.send(m, copy.requestAck, { type: "info" }, "reply"); this.submit(opp); return; }
      // The member asked again: they get the answer again, never silence (SD-266).
      if (!prior.closed) this.tellNoneYet(m, prior, true);
      return;
    }
    // Only what this app does (matching-e2e-2): a request outside its categories is not searched.
    if (admission.phase !== "RequestAdmitted") {
      this.ctx.log("request_out_of_scope", { memberId: m.id, category: c.category ?? "social" });
      if (!o.quiet) this.send(m, copy.requestOutOfScope, { type: "info" }, "reply");
      return;
    }
    this.counters.requests++;
    const req: Request = { id: this.sid(`rq${++this.reqSeq}`), memberId: m.id, at: now, kind: "people", category, desireId: c.desireId, tags: c.tags };
    this.requests.push(req);
    this.emit({ type: "help_asked", member: m.id }, req.id);
    if (c.desireId) m.learned.desires.set(c.desireId, now);
    c.tags.forEach(t => m.learned.interests.add(t));
    this.dirty = true;
    // Privacy (P3): the log keeps what was asked for (category, want, tags), never the member's words.
    this.ctx.log("request", { requestId: req.id, memberId: m.id, kind: "people", category: req.category, desireId: req.desireId, tags: req.tags });
    const search = stepMemberRequest(admission, {
      type: "routeNewRequest", matching, eligible: canSearch,
      busy: matching && canSearch && this.busy(m.id),
    });
    if (search.phase === "RequestMatchingPaused") return this.requestWaits(m, req, o);
    if (search.phase !== "RequestSearching") {
      req.outcome = "none";
      // A watch or report hold stops the search and allows a reply (network-consent-24).
      if (search.phase === "RequestOnHold") { if (!o.quiet) this.send(m, copy.requestOnWatch, { type: "info" }, "reply"); return; }
      if (!o.quiet) this.send(m, "You've got something in the works already; let's see how that goes first, then I'll look again.", { type: "info" }, "reply");
      return;
    }
    const opp = this.tryRequest(m, req, search);
    if (!opp) {
      if (req.closed) return;
      this.ctx.log("request_result", { requestId: req.id, memberId: m.id, outcome: "waiting", reason: "density_gap" });
      if (o.quiet) req.outcome = "none"; else this.tellNoneYet(m, req);
      return;
    }
    // The requester hears "On it" at once; the opportunity itself waits for review (PRD 32.8).
    if (!o.quiet) this.send(m, copy.requestAck, { type: "info" }, "reply");
    this.submit(opp);
  }

  /** Matching is off: the request is acknowledged and waits as a standing request (retried when matching is back on). */
  private requestWaits(m: MemberState, req: Request, o: { quiet?: boolean }) {
    req.outcome = "none";
    this.ctx.log("request_result", { requestId: req.id, memberId: m.id, outcome: "waiting", reason: "matching_paused" });
    if (!o.quiet) this.send(m, copy.requestWaiting, { type: "info" }, "reply");
  }

  /**
   * A standing request: tell them once, offer a public alternative and an invite, keep looking for a
   * week. `again`: the member asked again, so they are told again.
   */
  private tellNoneYet(m: MemberState, req: Request, again = false) {
    req.outcome = "none";
    if (req.toldNone && !again) return;
    req.toldNone = true;
    const def = req.desireId ? desireById.get(req.desireId) : undefined;
    const what = def ? def.text.replace(/^(find|meet|get|be part of|try|start|make|play|join|go on) /, "").replace(/^learn to /, "learning to ") : "that";
    const now = this.now();
    const city = this.networkCity();
    const exclude = new Set([...this.recentVenues(m), ...this.venues.excludedIdsFor([m.id])]);
    const v = this.inNyc(m.id, now, now + 1) ? nearbyVenues(m.area, def ? def.needsInterests : req.tags, 1, exclude, city, m.minor)[0] : undefined;
    this.send(m, `${copy.requestNoneYet(what, this.invitesWork)}${v ? ` Meanwhile, ${v.name} is a good public spot for it.` : ""}`, { type: "info" }, "info");
    if (this.invitesWork && this.canInvite(m)) m.awaiting = { kind: "growth", at: now };
  }

  /**
   * Did the member withdraw this want? True when their record for it is closed (withdrawn at a
   * check-in) and no active record exists. Their own earlier statement, never hidden truth.
   */
  private withdrew(id: MemberId, desireId: string | undefined): boolean {
    const def = desireId ? desireById.get(desireId) : undefined;
    if (!def) return false;
    const now = this.now();
    const mine = this.snapshotCached().intents.filter(i => i.memberId === id && i.objective === def.text);
    return requestDesireWithdrawn(mine.some(i => i.status === "closed"), mine.some(i => standingIntentLive(i, now)));
  }

  /** Search and, if anyone fits, build the opportunity (the caller submits it). Undefined when no one fits yet. */
  private tryRequest(m: MemberState, req: Request, search: MemberRequestFlow): Opp | undefined {
    if (search.phase !== "RequestSearching" || this.holdStoredHelp(m, req)) return undefined;
    req.tries = (req.tries ?? 0) + 1; req.lastTry = this.now();
    const cands = this.searchFor(m, req);
    const best = cands[0];
    const candidate = stepMemberRequest(search, { type: "readRequestCandidates", anyCandidate: !!best });
    if (candidate.phase !== "RequestAwaitingReview" || !best) return undefined;
    const def = req.desireId ? desireById.get(req.desireId) : undefined;
    // What they want, as a verb phrase after "wants to" ("find a regular climbing partner", "meet other founders").
    const detail = def?.text ?? (req.tags[0] ? `meet someone into ${interestLabel(req.tags[0])}` : "meet up");
    // A strong fit (their stated want answered by a stated skill or the same want) is what they asked
    // for, so no need to re-ask. A partial fit is confirmed with them first. So is a want they told us
    // earlier they had moved on from: asking for it again is not yet a yes.
    const withdrawn = this.withdrew(m.id, req.desireId);
    if (withdrawn) { this.counters.withdrawnWant++; this.ctx.log("request_withdrawn_want", { requestId: req.id, memberId: m.id, desireId: req.desireId }); }
    const primed = primeMemberRequest(withdrawn, best.fit >= 0.8, this.opts.selective);
    const o = this.newOpp({
      origin: "request", kind: "intro", category: req.category, objective: def?.text ?? (req.tags[0] ? `meet someone into ${interestLabel(req.tags[0])}` : `${req.category} request`), detail,
      participants: [m.id, best.id], alternates: cands.slice(1).map(x => x.id), primed: primed ? [m.id] : [], requester: m.id,
      explanations: { [m.id]: best.why, [best.id]: `they want to ${detail}, and ${best.whyBack}` },
      score: best.score, generator: "request", tags: req.tags,
    });
    if (!this.teenRosterAdmitted(o)) return undefined;
    o.format = "one_to_one";
    o.roles = Object.fromEntries([...o.participants, ...o.alternates].map(id => [id, "peer" as const]));
    req.oppId = o.id; req.outcome = "probing";
    this.ctx.log("request_result", { requestId: req.id, memberId: m.id, outcome: "probing", oppId: o.id, candidates: cands.length });
    return o;
  }

  /**
   * Daily: retry open requests (up to a week old) as people free up or join. The requester hears
   * nothing until a reviewer approves the match (begin), and hears once if it comes to nothing (close).
   */
  private retryRequests(now: number) {
    for (const r of this.requests) {
      const retry = stepMemberRequest(initialMemberRequest, {
        type: "considerScheduledRequestRetry",
        due: scheduledRequestRetryReady(r.kind === "people", waitingMemberRequest(r.outcome ?? "", !!r.closed), now - (r.openFrom ?? r.at),
          !!r.lastTry, now - (r.lastTry ?? now), r.lastConfirmAt !== undefined, now - (r.lastConfirmAt ?? now)),
      });
      if (retry.phase !== "CheckingScheduledMember") continue;
      const m = this.members.get(r.memberId);
      if (!m) continue;
      const eligible = this.eligible(m.id, undefined, true);
      const search = stepMemberRequest(retry, {
        type: "routeScheduledRequestRetry", eligible, busy: eligible && this.busy(m.id),
      });
      const o = this.tryRequest(m, r, search);
      if (!o) continue;
      this.counters.requestRetries++;
      o.retry = true;
      this.submit(o);
    }
  }

  /** Who could answer this ask? Skeptical: only candidates whose KNOWN profile fits, nearby, available, safe. */
  searchFor(m: MemberState, req: { category: Category; desireId?: string; tags: string[] }): { id: MemberId; score: number; fit: number; why: string; whyBack: string }[] {
    if (!this.canStartMatching(m) || !this.allowsMatchCategory(m.id, req.category)) return [];
    const known = this.knownProfiles();
    const now = this.now();
    // Load (matching-e2e-5, -15): how often each member was put into a request this past week.
    const load = new Map<MemberId, number>();
    for (const o of this.opps.values()) if (o.origin === "request" && now - o.createdAt < 7 * DAY) for (const p of o.participants) if (p !== o.requester) load.set(p, (load.get(p) ?? 0) + 1);
    const out: { id: MemberId; score: number; fit: number; why: string; whyBack: string; tie: number }[] = [];
    const opps = this.oppsByMember(), met = this.metRecently(m.id);
    for (const x of this.members.values()) {
      if (x.id === m.id || !this.eligible(x.id, undefined, false, opps.get(x.id) ?? []) || !this.allowsMatchCategory(x.id, req.category)
        || !this.pairAllowed(m.id, x.id) || !this.requestAgeFits(m.id, x.id, req.category)) continue;
      if (req.category === "romance" && this.romanceGate([m.id, x.id])) continue;
      // Never two people with one first name in a request: the reveal "meet Bilal B." must be unambiguous.
      if (x.first.toLowerCase() === m.first.toLowerCase()) continue;
      if (x.state === "receiving") continue; // Receiving members are never asked to help others (support-only)
      if (this.pairHistory(m.id, x.id, 30, met)) continue;
      if (!known.has(x.id) || (this.opts.selective && this.responsiveness(x.id) < this.opts.minResponsiveness)) continue;
      const { fit, why, whyBack } = this.askFit(m.id, x.id, req, known);
      if (fit < 0.45) continue;
      // Travel only between known neighborhoods: an unknown area is never read as Midtown (matching-e2e-1).
      const mins = this.minutesBetween(m.area, x.area);
      if (mins !== undefined && mins > 45) continue;
      const travel = mins === undefined ? 0 : 0.2 * (1 - mins / 45);
      out.push({ id: x.id, score: fit + travel - 0.08 * (load.get(x.id) ?? 0), fit, why, whyBack, tie: seededTie(this.opts.seed, m.id, x.id) });
    }
    // Research depth is the member's effort overlay (NC): the best candidate plus `depth` alternates (floor 3).
    // Ties break on a seeded hash, never on id order (the same low ids would win every time).
    return out.sort((a, b) => b.score - a.score || a.tie - b.tie).slice(0, 1 + this.effort(m.id).conciergeResearchDepth)
      .map(({ tie: _, ...x }) => x);
  }

  /** Minutes between two known neighborhoods; undefined when either is unknown (never a default). */
  private minutesBetween(a: string | undefined, b: string | undefined): number | undefined {
    if (!a || !b) return undefined;
    const city = this.networkCity();
    if (city === "nyc") {
      if (!NEIGHBORHOOD.has(a) || !NEIGHBORHOOD.has(b)) return undefined;
      return travelMinutes(neighborhood(a), neighborhood(b));
    }
    return travelMinutesInCity(city, a, b);
  }

  /**
   * Pair history (network-consent-5, -26, matching-e2e-3): a member said no to this pair (a probe or
   * a requester's confirm), a reviewer turned it down, or the two already met or had a no-show, within
   * `days`. Blocks and avoid edges are separate (blocked(), avoid).
   */
  private pairHistory(a: MemberId, b: MemberId, days: number, metByA: ReadonlySet<MemberId> = this.metRecently(a)): boolean {
    const k = pairKey(a, b);
    if ((this.declined.get(k) ?? -Infinity) > this.now() - days * DAY) return true;
    return metByA.has(b);
  }

  private metRecently(id: MemberId): Set<MemberId> {
    const since = this.now() - 60 * DAY, met = new Set<MemberId>();
    for (const x of this.interactions) {
      if (x.at >= since && (x.outcome === "completed" || x.outcome === "no_show") && x.participants.includes(id)) for (const p of x.participants) met.add(p);
    }
    return met;
  }

  /**
   * How well candidate `x` answers member `id`'s ask, from what we know only: the fit, the reason
   * the requester hears ("they play bass") and the reason the candidate hears ("you're both into X").
   */
  private askFit(id: MemberId, x: MemberId, req: { desireId?: string; tags: string[] }, known = this.knownProfiles()): { fit: number; why: string; whyBack: string } {
    const def = req.desireId ? desireById.get(req.desireId) : undefined;
    const k = known.get(x);
    if (!k) return { fit: 0, why: "", whyBack: GOOD_FIT };
    // The fit uses everything we know; the words use only what each member allowed us to share
    // (network-consent-11). Nothing shareable to say: the generic reason.
    let s = 0, why = "";
    const said = (tag: string, text: string) => (k.sharedSkills.has(tag) || k.sharedInterests.has(tag) ? text : "");
    if (def) {
      const strong = def.needsSkills.find(sk => k.strongSkills.has(sk));
      const skill = def.needsSkills.find(sk => k.skills.has(sk));
      const pool = def.pool && [...k.desires.keys()].some(d => desireById.get(d)?.pool === def.pool);
      const interest = def.needsInterests.filter(t => k.interests.has(t));
      if (strong) { s = 1; why = said(strong, theySkill(strong)); }
      else if (pool) { s = 0.85; }
      else if (skill) { s = 0.6; why = said(skill, `they say ${theySkill(skill)}`); }
      else if (interest.length) { s = 0.4 + 0.1 * interest.length; const t = interest.find(x => k.sharedInterests.has(x)); why = t ? `they're into ${interestLabel(t)}` : ""; }
    } else {
      const shared = req.tags.filter(t => k.interests.has(t));
      if (shared.length) { s = 0.35 + 0.15 * shared.length; const t = shared.find(x => k.sharedInterests.has(x)); why = t ? `they're into ${interestLabel(t)}` : ""; }
    }
    if (def?.category === "romance") s = 0; // romance only via the engine's opt-in checks
    const mine = known.get(id);
    const sharedBack = mine ? [...mine.sharedInterests].find(t => k.interests.has(t)) : undefined;
    return { fit: s, why: why || GOOD_FIT, whyBack: sharedBack ? `you're both into ${interestLabel(sharedBack)}` : GOOD_FIT };
  }

  private onPlans(m: MemberState, c: Classified) {
    // Every venue (geo.ts) is in the network's city: a member elsewhere gets the agent, not local places (SD-435).
    const now = this.now();
    const city = this.networkCity();
    if (!this.inNyc(m.id, now, now + 1)) return "open" as const;
    const place = publicPlanLocation(c.text ?? "", false, city);
    const location = recommendationLocation(place.area !== undefined, place.mentioned);
    if (location === "AskForArea") {
      this.ctx.log("plans_unknown_place", { memberId: m.id });
      this.send(m, plansPlaceQuestionForCity(city), { type: "question", proactive: false }, "reply");
      return;
    }
    this.counters.plansAnswered++;
    const req: Request = { id: this.sid(`rq${++this.reqSeq}`), memberId: m.id, at: now, kind: "plans", category: "events", tags: c.tags, outcome: "answered" };
    this.requests.push(req);
    this.ctx.log("request", { requestId: req.id, memberId: m.id, kind: "plans", category: "events" });
    const known = this.knownProfiles().get(m.id);
    const tags = [...c.tags, ...(known ? [...known.interests] : [])].slice(0, 4);
    // New ideas on a repeat ask: venues suggested in the last week or visited/rejected are left out (nothing new: no list).
    const exclude = new Set([...this.recentVenues(m), ...this.venues.excludedIdsFor([m.id])]);
    const venues = nearbyVenues(place.area ?? m.area, tags, this.effort(m.id).planBuildingOptions, exclude, city, m.minor);
    // spec/newMatchParticipation.md, "Recheck the member and category before a new contact"
    const offer = !m.minor && this.eligible(m.id) && this.opts.matchingEnabled && this.allowsMatchCategory(m.id, "events");
    if (venues.length) {
      this.send(m, (offer ? this.copy.plans : this.copy.plansNoOffer)(venues.map(v => v.name)), { type: "concierge", proactive: false }, "reply", { hook: { t: "suggested", venues: venues.map(v => v.id) } });
    } else {
      this.send(m, "I've already shared my best nearby spots for this week — tell me another neighborhood or vibe and I'll dig up fresh ideas.", { type: "concierge", proactive: false }, "reply");
    }
    if (!offer) return;
    // Plans buddy: someone else who asked for plans in the last 3 days, nearby. Asking for plans is
    // not consent to meet a stranger, so neither is primed: both are asked first (and it is reviewed).
    const other = this.requests.find(r => r.kind === "plans" && r.memberId !== m.id && now - r.at < 3 * DAY && !r.oppId
      && !this.members.get(r.memberId)?.minor && this.eligible(r.memberId) && this.allowsMatchCategory(r.memberId, "events")
      && this.pairAllowed(m.id, r.memberId) && !this.pairHistory(m.id, r.memberId, 60)
      && this.member(r.memberId).first.toLowerCase() !== m.first.toLowerCase()
      && (this.minutesBetween(m.area, this.member(r.memberId).area) ?? Infinity) <= 35);
    if (other && venues[0]) {
      const o = this.newOpp({
        origin: "plans", kind: "event_coattend", category: "events", objective: `go to ${venues[0].name} together`, detail: `going to ${venues[0].name} with someone`,
        participants: [m.id, other.memberId], alternates: [], primed: [], explanations: { [m.id]: "you were both looking for plans nearby", [other.memberId]: "you were both looking for plans nearby" },
        score: 0.5, generator: "plans_buddy", tags,
      });
      o.fixedVenue = venues[0];
      req.oppId = o.id; other.oppId = o.id;
      this.submit(o);
    }
  }

  /**
   * A member aged 13-17 chats: suggest public places for what they are into. Several short messages
   * in a row get different places each time, and nothing once the nearby ideas are used up.
   */
  private concierge(m: MemberState) {
    const known = this.knownProfiles().get(m.id);
    const topic = known ? [...known.interests][0] : undefined;
    const exclude = new Set([...this.recentVenues(m), ...this.venues.excludedIdsFor([m.id])]);
    const v = nearbyVenues(m.area, topic ? [topic] : [], 2, exclude, this.networkCity(), m.minor);
    if (!v.length) return;
    this.send(m, copy.minorConcierge(topic ? interestLabel(topic) : "something new", `try ${v.map(x => x.name).join(" or ")}; they're public and run free things often`), { type: "concierge", proactive: false }, "reply",
      { hook: { t: "suggested", venues: v.map(x => x.id) } });
  }

  /** Venues suggested to the member in the last VENUE_REPEAT_DAYS. */
  private recentVenues(m: MemberState): Set<string> {
    const since = this.now() - VENUE_REPEAT_DAYS * DAY;
    return new Set([...m.suggested].filter(([, at]) => at > since).map(([id]) => id));
  }
  private suggested(m: MemberState, venueIds: string[]) { for (const id of venueIds) m.suggested.set(id, this.now()); }

  // ================================================================== review (PRD 32.8)
  /** Is proactive matching on (the NYC switch)? */
  matchingEnabled(): boolean { return this.opts.matchingEnabled; }

  /**
   * The admin switch "proactive matching on in NYC" (admin-console 3.11). Off pauses the daily engine
   * run and every new opportunity the Network composes; requests are acknowledged and wait as
   * standing requests. What a reviewer already approved continues.
   */
  setMatchingEnabled(on: boolean, actor: string) {
    // Requests told "I'll keep your request open" get their full week of retries from now (SD-267).
    if (on && !this.opts.matchingEnabled && this.ctx) {
      const now = this.now();
      for (const r of this.requests) if (r.kind === "people" && r.outcome === "none" && !r.closed) r.openFrom = now;
    }
    this.opts.matchingEnabled = on;
    this.ctx?.log("matching_switch", { on, actor });
  }

  reviewQueue(): ReviewItem[] {
    return [...this.opps.values()].filter(o => o.stage === "review" && o.review?.exception && reviewStateOf(o).phase === "HeldForStaff")
      .map((o): ReviewItem => {
        const teen = this.teenReviewOf(o);
        return { oppId: o.id, proposal: this.toProposal(o), origin: o.origin, queuedAt: o.review!.queuedAt, deadline: o.review!.deadline, rerolls: o.review!.rerolls?.length ?? 0,
          revision: reviewRevision(o), exception: { ...o.review!.exception! }, ...(teen ? { teen } : {}) };
      })
      .concat(this.fraud.filter(x => x.status === "review").map(x => this.fraudItem(x)))
      .sort((a, b) => a.queuedAt - b.queuedAt);
  }

  private reviewPacket(o: Opp, now: number): { packet: ReviewPacket; members: Record<string, MemberId>; rawFirstNames: string[]; rosters: string[] } {
    const revision = reviewRevision(o);
    const roster = this.oppRoster(o);
    const refs = new Map(roster.map((id, i) => [id, `P${i + 1}`]));
    const refOf = (id: MemberId) => refs.get(id) ?? "P0";
    const teen = new Map((this.teenReviewOf(o)?.members ?? []).map(m => [m.memberId, m]));
    const rawFirstNames: string[] = [];
    const names: [string, string][] = [];
    const members: ReviewPacketMember[] = roster.map(id => {
      const m = this.members.get(id);
      const ref = refOf(id);
      const first = m?.first ?? "";
      rawFirstNames.push(first);
      const firstName = PACKET_NAME.test(first) ? first : ref;
      if (m) names.push([m.display, firstName]);
      const age = m ? this.youngestAgeOnRecord(m) : undefined;
      const role: ReviewPacketMember["role"] = o.plan?.hostId === id ? "host" : o.seat?.manager === id ? "manager" : o.requester === id ? "requester"
        : !o.participants.includes(id) ? "alternate" : o.seat ? "candidate" : "participant";
      const told = o.explanations[id];
      const t = teen.get(id);
      return { ref, role, firstName, age: validAge(age) ? age : null, minor: !this.rosterSideOf(id).adult, told: told ?? null,
        ...(t ? { teen: { age: t.age, maxAge: t.maxAge } } : {}) };
    });
    names.sort((a, b) => b[0].length - a[0].length);
    const plain = (text: string) => names.reduce((t, [display, first]) => (display ? t.split(display).join(first) : t), text);
    for (const m of members) if (m.told !== null) m.told = clip(plain(m.told), 600);
    const packetText = (text: string) => clip(plain(text), 800);
    const probeOf = (p: ReviewProbeText): ReviewPacketProbe => ({
      ref: refOf(p.memberId), text: p.text === null ? null : packetText(p.text), ...(p.fallback !== undefined ? { fallback: packetText(p.fallback) } : {}),
      reveal: { text: packetText(p.reveal.text), ...(p.reveal.fallback !== undefined ? { fallback: packetText(p.reveal.fallback) } : {}) },
    });
    const preview = this.reviewProbePreview(o.id, revision, this.judgeRenderedAt(o));
    const planPreview = this.reviewPlanPreview(o.id, revision);
    const rosterHasMinor = this.teenRoster(o);
    const ages = members.map(m => m.age).filter((a): a is number => a !== null);
    const codeChecks: CodeCheck[] = rosterHasMinor && this.teenItemOk(o)
      ? ["teen_age_rule", "teen_place_all_ages", "teen_daytime_10_19", "no_adult_session_nearby"]
      : [];
    const proposal = this.toProposal(o);
    const base: Omit<ReviewPacket, "basePacketHash" | "packetHash"> = {
      app: this.app.id, networkId: `${this.app.id}:${proposal.city}`, oppId: o.id, revision, deadline: o.review?.deadline ?? now,
      origin: o.origin, kind: o.kind, category: o.category, lane: o.lane ?? null,
      objective: clip(plain(o.objective), 300), score: o.score, components: { ...o.components }, exploration: o.exploration,
      rubric: reviewRubric(rosterHasMinor) === "MinorRubric" ? "minor" : "adult",
      roster: members,
      ageFacts: { rosterHasMinor, youngest: ages.length ? Math.min(...ages) : null, oldest: ages.length ? Math.max(...ages) : null, codeChecks },
      plan: planPreview ? {
        activity: clip(planPreview.activity, 120), place: { name: clip(planPreview.place.name, 120), ...(planPreview.place.area ? { area: clip(planPreview.place.area, 120) } : {}) },
        start: planPreview.start, end: planPreview.end, probeDeadline: planPreview.probeDeadline, quorum: planPreview.quorum, maxSeats: planPreview.maxSeats,
        ...(planPreview.options ? { options: planPreview.options.map(({ start, end }) => ({ start, end })) } : {}),
      } : null,
      probes: (preview?.probes ?? []).map(probeOf),
      replacements: (preview?.replacements ?? []).map(r => ({ alternate: refOf(r.alternate), replaces: refOf(r.replaces), probes: r.probes.map(probeOf) })),
    };
    const basePacketHash = sha256(stableStringify(base));
    const rosters = this.previewRosters(o, preview);
    return { packet: { ...base, basePacketHash, packetHash: basePacketHash }, members: Object.fromEntries([...refs].map(([id, ref]) => [ref, id])), rawFirstNames, rosters };
  }

  private previewRosters(o: Opp, preview: ReviewProbePreview | undefined): string[] {
    return [rosterKey(o.participants), ...(preview?.replacements ?? []).map(r => rosterKey(o.participants.map(p => (p === r.replaces ? r.alternate : p))))];
  }

  private judgeRenderedAt(o: Opp): number {
    return o.review?.judgeWaitFrom ?? o.review?.queuedAt ?? this.now();
  }

  private explanationLeak(o: Opp, packet: { probes: ReviewProbeText[]; replacements: { probes: ReviewProbeText[] }[] } | undefined): boolean {
    const leaks = (text: string | null | undefined, id: MemberId) => typeof text === "string" && this.guardCheck(text, id).length > 0;
    if (Object.entries(o.explanations).some(([id, text]) => leaks(text, id))) return true;
    if (o.participants.some(id => leaks(o.objective, id))) return true;
    const probes = [...(packet?.probes ?? []), ...(packet?.replacements ?? []).flatMap(r => r.probes)];
    return probes.some(p => leaks(p.text, p.memberId) || leaks(p.fallback, p.memberId) || leaks(p.reveal.text, p.memberId) || leaks(p.reveal.fallback, p.memberId));
  }

  private pairFlagged(o: Opp, now: number): boolean {
    return pairsOf(this.oppRoster(o)).some(([a, b]) => {
      const flag = this.flagged.get(pairKey(a, b));
      return !!flag && flaggedPairActive(now - flag.at);
    });
  }

  private flagPairs(o: Opp, reason: JudgeReasonCode, now: number) {
    for (const [a, b] of pairsOf(this.oppRoster({ ...o, alternates: [] }))) this.flagged.set(pairKey(a, b), { reason, at: now });
  }

  private reviewWork(o: Opp, now: number): JudgeWork | { close: string } | { wait: true } {
    const blocked = this.reviewBlock(o.id, "approve");
    if (blocked === "matching_paused" || blocked === "review_expired") return { wait: true };
    if (blocked) return { close: blocked };
    const why = this.approvalCheck(o);
    if (why) return { close: why };
    if (this.explanationLeak(o, this.reviewProbePreview(o.id, reviewRevision(o), this.judgeRenderedAt(o)))) return { close: "explanation_leak" };
    const { packet, members, rawFirstNames } = this.reviewPacket(o, now);
    return { packet, members, packetClean: !packetSuspect(packet, rawFirstNames), priorFlag: this.pairFlagged(o, now) };
  }

  judgePackets(now: number = this.now()): { work: JudgeWork[]; close: { oppId: string; reason: string }[] } {
    return this.awaitingJudge(Math.floor(now), 20);
  }

  private awaitingJudge(now: number, limit: number): { work: JudgeWork[]; close: { oppId: string; reason: string }[] } {
    const work: JudgeWork[] = [];
    const close: { oppId: string; reason: string }[] = [];
    const awaiting = [...this.opps.values()].filter(o => o.stage === "review" && o.review && reviewStateOf(o).phase === "AwaitingJudge")
      .sort((a, b) => (a.review!.deadline - b.review!.deadline) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit);
    for (const o of awaiting) {
      const next = this.reviewWork(o, now);
      if ("close" in next) close.push({ oppId: o.id, reason: next.close });
      else if ("packet" in next) work.push(next);
    }
    return { work, close };
  }

  closeUnjudgeable(list: readonly { oppId: string }[]): void {
    const now = this.now();
    for (const { oppId } of list) {
      const o = this.opps.get(oppId);
      if (!o || o.stage !== "review" || !o.review) continue;
      const next = this.reviewWork(o, now);
      const state = reviewStateOf(o);
      if (!("close" in next) || !canCloseReview(state) || closeReview(state).phase !== "ReviewInvalidated") continue;
      o.review.invalidated = next.close;
      this.counters.reviewInvalidated++;
      this.ctx.log("review_invalidated", { oppId, reason: next.close });
      this.close(o, `invalidated: ${next.close}`);
    }
  }

  recordJudgments(judgments: readonly ReviewJudgment[]): ActionResult[] {
    return judgments.map(j => this.recordJudgment(j));
  }

  recordJudgment(j: ReviewJudgment): ActionResult {
    const o = this.opps.get(j.oppId);
    if (!o || o.stage !== "review" || !o.review) return { ok: false, reason: "judgment_stale" };
    if (j.reviewer !== this.judgeReviewer) return { ok: false, reason: "judgment_reviewer_unknown" };
    const state = reviewStateOf(o);
    if (!canRecordJudgment(state, j.revision)) return { ok: false, reason: "judgment_stale" };
    if (this.reviewBlock(o.id, "approve") === "matching_paused") return { ok: false, reason: "matching_paused" };
    const now = this.now();
    const late = reviewLate(now, o.review.deadline);
    const work = this.reviewWork(o, now);
    const current = late ? undefined : this.reviewPacket(o, now);
    const packetCurrent = current?.packet.basePacketHash === j.basePacketHash;
    const gatesPass = !("close" in work);
    const said = Object.hasOwn(VERDICT_OF_NAME, j.verdict) ? VERDICT_OF_NAME[j.verdict] : "JudgeUndecided";
    const fresh = "packet" in work ? work : undefined;
    const verdict = fresh ? verdictAtRecord(said, fresh.packetClean, fresh.priorFlag) : said;
    const reason: JudgeReasonCode = verdict === said ? j.reason : fresh && !fresh.packetClean ? "packet_suspect" : "prior_flag";
    const next = judgmentStep(state, j.revision, verdict, packetCurrent, gatesPass, late);
    const rosterHasMinor = this.teenRoster(o);
    const rubric: ReviewPacket["rubric"] = reviewRubric(rosterHasMinor) === "MinorRubric" ? "minor" : "adult";
    const stale = next.phase === "AwaitingJudge" || j.rubric !== rubric;
    this.ctx.log("review_judgment", { oppId: o.id, revision: j.revision, verdict: j.verdict, reason: j.reason, rubric, rosterHasMinor,
      basePacketHash: j.basePacketHash, currentHash: current?.packet.basePacketHash ?? null, stale });
    if (stale) return { ok: false, reason: "judgment_stale_packet" };
    if (next.phase === "ReviewExpired") {
      this.advance(o, now);
      return { ok: false, reason: "review_expired" };
    }
    if (next.phase === "ReviewInvalidated") {
      const why = "close" in work ? work.close : "invalidated";
      o.review.invalidated = why;
      this.counters.reviewInvalidated++;
      this.ctx.log("review_invalidated", { oppId: o.id, reason: why });
      this.close(o, `invalidated: ${why}`);
      return { ok: false, reason: why };
    }
    const judged = { verdict: VERDICT_NAME[said], reason: j.reason, revision: j.revision, at: now, rubric, reviewer: j.reviewer, basePacketHash: j.basePacketHash };
    this.counters.reviewJudged++;
    if (next.phase === "ReviewApproved") {
      Object.assign(o.review, { decision: "approve", approver: "judge", reviewer: j.reviewer, decidedAt: now, judged, judgedRosters: current?.rosters ?? [] });
      delete o.review.exception;
      this.ctx.log("review_decision", { oppId: o.id, decision: "approve", approver: "judge", reviewer: j.reviewer, revision: j.revision });
      this.counters.reviewApproved++; this.counters.reviewJudgeApproved++;
      if (o.teenRuleAt !== undefined) this.teenPairsReached(o);
      this.begin(o);
      return { ok: true };
    }
    const held = VERDICT_NAME[verdict];
    this.holdForStaff(o, { verdict: held === "approve" ? "undecided" : held, reason, revision: j.revision, at: now, rubric });
    o.review.judged = judged;
    return { ok: true };
  }

  private holdForStaff(o: Opp, exception: ReviewException) {
    o.review!.exception = exception;
    this.counters.reviewExceptions++;
    this.ctx.log("review_exception", { oppId: o.id, revision: exception.revision, verdict: exception.verdict, reason: exception.reason, rubric: exception.rubric });
  }

  private inlineJudgeStep(now: number) {
    const judge = this.inlineJudge;
    if (!judge) return;
    const { work, close } = this.awaitingJudge(now, Number.POSITIVE_INFINITY);
    for (const item of work) {
      const call = judgeCallDecision(item.packetClean, item.priorFlag, true, 0, 1, 0, 1, item.packet.deadline - now);
      const judgment = call === "CallJudge" ? judge(item.packet) : uncalledJudgment(item.packet, call, this.judgeReviewer);
      if (judgment) this.recordJudgment(judgment);
    }
    if (close.length) this.closeUnjudgeable(close);
  }

  private reviewStep(now: number) {
    for (const [key, flag] of [...this.flagged]) if (!flaggedPairActive(now - flag.at)) this.flagged.delete(key);
    this.inlineJudgeStep(now);
    if (!this.matchingEnabled()) return;
    for (const o of this.opps.values()) {
      if (o.stage !== "review" || !o.review) continue;
      const state = reviewStateOf(o);
      const waited = now - (o.review.judgeWaitFrom ?? o.review.queuedAt);
      if (!canHoldUnjudged(state, waited, true) || holdUnjudged(state, waited, true).phase !== "HeldForStaff") continue;
      this.holdForStaff(o, { verdict: "cannot_run", reason: "judge_overdue", revision: state.revision, at: now, rubric: this.teenRoster(o) ? "minor" : "adult" });
    }
  }

  stopApproved(oppId: string, reviewer: string, revision: number): ActionResult {
    const refuse = (reason: string): ActionResult => { this.ctx.log("review_refused", { oppId, decision: "stop", reason }); return { ok: false, reason }; };
    if (!reviewer.trim()) return refuse("reviewer_required");
    const o = this.opps.get(oppId);
    if (!o || !o.review) return refuse("not_stoppable");
    if (!reviewRevisionCurrent(revision, reviewRevision(o))) return refuse("review_stale");
    const state = reviewStateOf(o);
    const revealed = o.stage !== "probing";
    if (!canStopApproved(state, revealed) || stopApprovedStep(state, revealed).phase !== "ReviewStopped") return refuse("not_stoppable");
    const now = this.now();
    o.review.stopped = { by: reviewer, at: now };
    this.markDeclined(o.participants, now);
    this.counters.reviewStopped++;
    this.ctx.log("review_stopped", { oppId, revision, by: reviewer });
    this.close(o, "stopped by staff", { releasePartial: true });
    return { ok: true };
  }

  reviewPlanPreview(oppId: string, revision: number): ReviewPlanPreview | undefined {
    const o = this.opps.get(oppId), plan = o?.plan, review = o?.review;
    const activity = plan && plans.activityById.get(plan.activityId);
    // spec/staffReview.md, "A plan preview belongs to the open revision under review"
    if (!o || !plan || !review || !activity || !reviewPlanPreviewCurrent(o.stage === "review", true, revision, reviewRevision(o), this.now(), review.deadline)) return;
    return { opportunityId: o.id, revision, deadline: review.deadline,
      activity: activity.label, place: { name: plan.place.name, ...(plan.place.area ? { area: plan.place.area } : {}) },
      start: plan.window.start, end: plan.window.end, probeDeadline: plan.probeDeadline, quorum: plan.quorum,
      ...(plan.reviewedOptions ? { options: plan.reviewedOptions.map(({ start, end }) => ({ start, end })) } : {}),
      maxSeats: plan.size.max, alternates: [...o.alternates] };
  }

  reviewProbePreview(oppId: string, revision: number, renderedAt: number = this.now()): ReviewProbePreview | undefined {
    const o = this.opps.get(oppId), review = o?.review;
    // spec/probeDispatch.md, "A reviewer can read each first probe of the open revision"
    if (!o || !review || !reviewProbePreviewCurrent(o.stage === "review", revision, reviewRevision(o), this.now(), review.deadline)) return;
    const now = renderedAt;
    const world = o.plan ? this.planWorld(this.now()) : undefined;
    const swappable = o.seat ? [] : o.participants.filter(p => p !== o.requester && p !== o.plan?.hostId);
    const replacements = o.alternates.flatMap(alternate => swappable.map(replaces => {
      const swapped: Opp = { ...o, participants: o.participants.map(p => (p === replaces ? alternate : p)),
        explanations: { ...o.explanations }, primed: new Set([...o.primed].filter(p => p !== replaces)) };
      if (!o.plan) this.reexplain(swapped);
      return { alternate, replaces, probes: this.previewProbes(swapped, now, world) };
    }));
    return { opportunityId: o.id, revision, deadline: review.deadline, probes: this.previewProbes(o, now, world), replacements };
  }

  private previewProbes(o: Opp, now: number, world: EngineWorld | undefined): ReviewProbeText[] {
    const plan = o.plan;
    const city = this.networkCity(), tz = this.cityTz(), venueAges = planVenueAgesForCity(city);
    return o.participants.map(memberId => {
      if (!plan || !world) {
        const { text, fallback } = this.probeCopy(o, memberId, now);
        const others = o.participants.filter(x => x !== memberId).map(x => this.member(x).display);
        return { memberId, text, fallback, reveal: this.revealCopy(o, memberId, others, REVEAL_PLACE_PLACEHOLDER, REVEAL_TIME_PLACEHOLDER) };
      }
      const reviewed = plan.reviewedOptions;
      const options = reviewed ? friendsPlanTimeOptions(reviewed, friendsPlanOfferedWindows(reviewed, undefined,
        slot => this.friendsPlanSlotCurrent(plan, o.participants, slot, now, o.id)), tz) : undefined;
      const inCrew = !plan.crewId || !!this.crews.find(c => c.id === plan.crewId)?.members.includes(memberId);
      const invitation = { ...plan, invited: [...o.participants], ...(inCrew ? {} : { crewId: undefined }) };
      return { memberId, text: plans.buildPlanProbe(world, invitation, memberId, tz, venueAges, options),
        reveal: { text: this.planRevealText(o, memberId, [REVEAL_GOING_PLACEHOLDER]) } };
    });
  }

  /** A reviewer's decision. True when it was applied; decide() also says why not. */
  review(oppId: string, decision: ReviewDecision, opts: ReviewOptions = {}): boolean {
    return this.decide(oppId, decision, opts).ok;
  }

  /**
   * A reviewer's decision (PRD 32.8), with the reason when it is refused or invalidated.
   *  - approve: the gates run again (approvalCheck). If one fails, nobody is contacted: the item
   *    closes and `review_invalidated` follows the `review_decision`. Otherwise the consent flow starts.
   *  - edit: new explanations or objective, leak-checked, then approve.
   *  - reroll: swap a participant for the best eligible alternate; the item waits again with a new
   *    deadline. With no alternate, the item closes and the engine composes again at its next run.
   *  - reject: the opportunity closes; nobody it names is contacted.
   * A decision that carries a revision other than the current one (a re-roll came first) is refused
   * as "review_stale" and changes nothing.
   */
  decide(oppId: string, decision: ReviewDecision, opts: ReviewOptions = {}): ActionResult {
    const fi = this.fraud.find(x => x.id === oppId);
    if (fi) return this.decideFraud(fi, decision, opts);
    const o = this.opps.get(oppId);
    if (!o || o.stage !== "review" || !o.review) return { ok: false, reason: "not_in_review" };
    // An item past its SLA expires unsent (PRD 28.3, 32.8), even when no tick has run since its
    // deadline: no decision, reroll included, may revive it or send it late.
    if (this.now() >= o.review.deadline) {
      this.advance(o, this.now());
      return { ok: false, reason: "review_expired" };
    }
    const refuse = (reason: string): ActionResult => { this.ctx.log("review_refused", { oppId, decision, reason }); return { ok: false, reason }; };
    if (!REVIEW_DECISIONS.has(decision)) return refuse("unknown_decision");
    // spec/reviewDeadline.md, "A decision applies only to the revision the reviewer saw"
    if (opts.revision !== undefined && !reviewRevisionCurrent(opts.revision, reviewRevision(o))) return refuse("review_stale");
    const reviewer = opts.reviewer?.trim();
    if (!reviewer) return refuse("reviewer_required");
    if (reviewer === REVIEW_JUDGE_REVIEWER || reviewer === SIM_REVIEW_JUDGE || reviewer === this.judgeReviewer) return refuse("reviewer_reserved");
    const state = reviewStateOf(o);
    const revision = opts.revision ?? state.revision;
    const allowed = decision === "reroll" ? canStaffReroll(state, revision, false) : canStaffDecide(state, revision, decision !== "reject");
    if (!allowed) return refuse("not_held_for_staff");
    const blocked = this.reviewBlock(oppId, decision, opts) ?? (decision === "edit" ? this.editBlock(o, opts) : undefined);
    if (blocked) return refuse(blocked);
    const now = this.now();
    const seconds = typeof opts.secondsSpent === "number" && Number.isFinite(opts.secondsSpent) && opts.secondsSpent >= 0 ? opts.secondsSpent : undefined;
    if (seconds !== undefined) o.review.secondsSpent = (o.review.secondsSpent ?? 0) + seconds;
    const logged = { oppId, reason: opts.reason ?? null, note: opts.note ?? null, reviewer, ...(seconds !== undefined ? { secondsSpent: seconds } : {}) };
    // A member who reviews (trained stewards, later) earns review credit (NC review_completed).
    // One credit per (item, reviewer), however many times it is decided (capital-m4).
    if (this.members.has(reviewer)) this.emit({ type: "review_completed", member: reviewer, items: 1 }, `${oppId}:${reviewer}`);
    if (decision === "reroll") return this.reroll(o, opts, reviewer, logged, state);
    let edited: string[] | undefined;
    if (decision === "edit") {
      edited = [];
      for (const [id, text] of Object.entries(opts.explanations ?? {})) { o.explanations[id] = text.trim(); edited.push(`explanation:${id}`); }
      if (opts.objective !== undefined) { o.objective = opts.objective.trim(); edited.push("objective"); }
      o.review.edits = [...(o.review.edits ?? []), ...edited];
      this.counters.reviewEdited++;
    }
    const approve = decision !== "reject";
    const why = approve ? this.approvalCheck(o) : undefined;
    const next = staffDecide(state, revision, approve, why === undefined, false);
    const stored = approve ? "approve" : "reject";
    const judgedRosters = next.phase === "ReviewApproved" ? this.previewRosters(o, this.reviewProbePreview(o.id, revision)) : undefined;
    Object.assign(o.review, { decision: stored, reason: opts.reason, note: opts.note, reviewer, decidedAt: now });
    this.ctx.log("review_decision", { ...logged, decision: stored, approver: "staff", ...(edited ? { edited } : {}) });
    if (next.phase === "ReviewApproved") {
      Object.assign(o.review, { approver: "staff", judgedRosters });
      delete o.review.exception;
      this.counters.reviewApproved++; this.counters.reviewStaffApproved++;
      if (o.teenRuleAt !== undefined) this.teenPairsReached(o);
      this.begin(o);
      return { ok: true };
    }
    if (next.phase === "ReviewInvalidated") {
      const reason = why ?? "invalidated";
      o.review.invalidated = reason;
      this.counters.reviewInvalidated++;
      this.ctx.log("review_invalidated", { oppId, reason });
      this.close(o, `invalidated: ${reason}`);
      return { ok: false, reason };
    }
    this.counters.reviewRejected++;
    if (o.teenRuleAt !== undefined) this.teenPairsReached(o);
    this.markDeclined(o.participants, now);
    const exception = o.review.exception;
    if (exception?.revision === revision && exception.verdict === "flag") this.flagPairs(o, exception.reason, now);
    this.close(o, "rejected in review");
    return { ok: true };
  }

  reviewBlock(oppId: string, decision: ReviewDecision, opts: { reason?: string; note?: string } = {}): string | undefined {
    const o = this.opps.get(oppId);
    if (!o || o.stage !== "review" || !o.review) return "not_in_review";
    if (opts.reason === "other" && !opts.note?.trim()) return "note_required";
    // spec/reviewDeadline.md, "An opportunity expires at its review deadline"
    if (reviewLate(this.now(), o.review.deadline)) return "review_expired";
    if (isGatheringRepeat(o) && (decision === "reroll" || decision === "edit")) return "gathering_repeat_fixed_pair";
    if (decision === "approve" || decision === "edit") {
      if (o.participants.some(id => this.declinedIds.has(id))) return "participant_declined";
      if (this.rosterAgeBlocked(o)) return "participant_minor";
      if (!this.opts.matchingEnabled) return "matching_paused";
    }
    return undefined;
  }

  /**
   * An edit is refused when it names someone outside the opportunity, or a text would leak a private
   * fact or contact details. On an app that rates photos (slop) a reviewer's words are also checked
   * for the rating: looks words, a score, a percentile or a stored appearance tag (`appearanceLeak`,
   * PRD 40.5: ratings are never shown to anyone). The pack's own text never mentions looks.
   */
  private editBlock(o: Opp, opts: ReviewOptions): string | undefined {
    const ex = Object.entries(opts.explanations ?? {});
    if (!ex.length && opts.objective === undefined) return "nothing_to_edit";
    const ratingLeak = this.ratesPhotos ? (() => {
      const tags = this.snapshotCached().facets.filter(f => o.participants.includes(f.memberId)).flatMap(f => f.tags.filter(t => t.startsWith(APPEARANCE_PREFIX)));
      return (t: string) => appearanceLeak(t, tags) !== null;
    })() : () => false;
    for (const [id, text] of ex) {
      if (!o.participants.includes(id)) return "not_a_participant";
      if (!text.trim() || this.guardCheck(text, id).length || ratingLeak(text)) return "edit_leak";
    }
    if (opts.objective !== undefined && (!opts.objective.trim() || ratingLeak(opts.objective) || o.participants.some(id => this.guardCheck(opts.objective!, id).length))) return "edit_leak";
    return undefined;
  }

  /** This app rates photos (slop): its outbound words are checked for the rating too (editBlock, the relay desk). */
  private get ratesPhotos(): boolean { return this.app.id === "slop"; }
  private probeWindow(timeQuestion: boolean): number { return probeResponseMs(this.app.id === "slop", timeQuestion); }

  private approvalCheck(o: Opp): string | undefined {
    if (this.holdHelpOpportunity(o)) return "bounded_help_requires_safety_review";
    if (o.replacementFor && !this.replacementPlanCurrent(o, this.now())) return "replacement_no_longer_available";
    if (o.plan?.repeatOf && !this.friendsRepeatPlanCurrent(o.plan, this.now(), this.planWorld(this.now(), true, [o.id]), o.id)) {
      return "repeat_no_longer_available";
    }
    const publicEventIssue = this.publicEventRefusal(o);
    if (publicEventIssue) return publicEventIssue;
    for (const id of o.participants) {
      if (this.declinedIds.has(id)) return "participant_declined";
      const m = this.members.get(id);
      if (!m) return "unknown_member";
      if (m.optedOut) return "opted_out";
      const level = this.trust.level(id);
      if (level === "hold" || this.reportHeld(id)) return "held";
      if (level !== "ok") return "on_watch";
      if (!this.canStartMatching(m)) return "participant_unavailable";
      if (!this.allowsMatchCategory(id, o.category)) return "category_opt_out";
      if (this.busy(id, o.id)) return "busy_elsewhere";
    }
    if (this.rosterAgeBlocked(o)) return "participant_minor";
    if (!this.friendsRosterVerificationCurrent(this.oppRoster(o))) return "friends_verification_required";
    for (let i = 0; i < o.participants.length; i++) for (let j = i + 1; j < o.participants.length; j++)
      if (!this.pairAllowed(o.participants[i]!, o.participants[j]!)) return "blocked_pair";
    if (o.category === "romance") {
      const refusal = this.romanceGate(o.participants);
      if (refusal) return refusal;
    }
    if (!this.currentDatingPair(o)) return "slop_pair_changed";
    if (o.seat && !this.currentHireSeat(o.seat, o.participants)) return "peon_search_changed";
    if (o.origin === "second_encounter" && (!this.repeatSourceCurrent(o) || !this.repeatOutreachAllowed(o.category, o.participants, o.id))) return "repeat_no_longer_available";
    if (o.origin === "engine") return this.gateReason({ ...this.toProposal(o), roles: o.roles ?? {}, anchor: o.anchor,
      lane: o.lane, cofounderIntents: o.cofounderIntents, ...(o.seat ? { seat: o.seat } : {}) } as SeatProposal, o.id);
    return undefined;
  }

  /**
   * Re-roll: swap `swapOut` (or the only participant who is not the requester) for the best eligible
   * alternate, and wait for review again with a new deadline. With no alternate, or nobody named in a
   * group, the item closes, the pairs it named are not proposed again for a while, and the engine
   * composes a new configuration at its next run.
   */
  private reroll(o: Opp, opts: ReviewOptions, reviewer: string, logged: Record<string, unknown>, state: AutomatedReview): ActionResult {
    const now = this.now();
    // A seat item's hiring manager is never swapped out (only the candidate can be).
    const swappable = o.participants.filter(p => p !== o.requester && p !== o.seat?.manager);
    const out = opts.swapOut ?? (swappable.length === 1 ? swappable[0] : undefined);
    if (out !== undefined && !swappable.includes(out)) { this.ctx.log("review_refused", { oppId: o.id, decision: "reroll", reason: "cannot_swap" }); return { ok: false, reason: "cannot_swap" }; }
    const stay = o.participants.filter(p => p !== out);
    const alt = out === undefined || o.lane === "Cofounder" ? undefined : o.alternates.find(a => this.canUseAlternate(o, a, stay, out) && !this.sharesFirstName(o, a) && !stay.some(p => !this.pairAllowed(p, a) || this.pairHistory(p, a, PAIR_HISTORY_DAYS))
      && (o.teenRuleAt === undefined || this.rosterAgeAllowed(o.category, [...stay, a, ...o.alternates.filter(x => x !== a)], this.teenMeetingEnd(o)))
      && (!o.seat || !!this.hireSeatFor(o.seat, a)));
    const nextSeat = alt && o.seat ? this.hireSeatFor(o.seat, alt) : undefined;
    const replacementFound = !!alt && (!o.seat || !!nextSeat);
    const next = stepOpportunity(opportunityLifecycle(o), { type: "reroll", replacementFound });
    const judged = staffReroll(state, state.revision, false, replacementFound);
    const exception = o.review!.exception;
    if (exception?.revision === state.revision && exception.verdict === "flag") this.flagPairs(o, exception.reason, now);
    this.counters.reviewRerolled++;
    o.review!.rerolls = [...(o.review!.rerolls ?? []), { at: now, out, in: alt, reviewer, note: opts.note }];
    this.ctx.log("review_decision", { ...logged, decision: "reroll", out: out ?? null, in: alt ?? null, next: next.phase === "InReview" ? "review" : "engine" });
    if (next.phase === "Closed" || judged.phase !== "AwaitingJudge" || !alt) {
      // The engine composes again at its next run; this configuration does not come back for a while.
      this.markDeclined(o.participants, now, out);
      this.close(o, "rerolled in review");
      return { ok: true };
    }
    // spec/opportunityLifecycle.md, "An opportunity starts in review": a reroll with a replacement stays in review.
    o.stage = STAGE_BY_PHASE[next.phase];
    o.alternates = o.alternates.filter(a => a !== alt);
    this.moveParticipantSeat(o, out!, alt);
    if (nextSeat) o.seat = nextSeat;
    o.status.delete(out!); o.status.set(alt, "queued");
    o.primed.delete(out!);
    delete o.explanations[out!];
    this.reexplain(o);
    o.review!.deadline = now + (o.sameDay ? 1 : this.opts.reviewSlaHours) * HOUR;
    delete o.review!.exception;
    o.review!.judgeWaitFrom = now;
    this.markDeclined(stay.concat(out!), now, out);
    this.ctx.log("review_queued", { proposal: this.toProposal(o), origin: o.origin, deadline: o.review!.deadline, runId: o.runId, rerolled: true });
    return { ok: true };
  }

  /** Pairs not to propose again for a while (60 days engine, 30 days requests). With `only`, just the pairs that include it. */
  private markDeclined(ids: MemberId[], now: number, only?: MemberId) {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++)
      if (only === undefined || ids[i] === only || ids[j] === only) this.declined.set(pairKey(ids[i]!, ids[j]!), now);
  }

  /** Every opportunity goes to review first, whatever its origin (staff-composed and scenario proposals too). */
  private submit(o: Opp) {
    const now = this.now();
    // Only this app's categories, whatever the origin (matching-e2e-2): nothing else is queued or sent.
    if (!this.allowedCategories.has(o.category)) {
      this.gate("category_not_allowed", o.participants);
      return this.close(o, "category not allowed");
    }
    if (this.rosterAgeBlocked(o)) {
      this.gate("participant_minor", o.participants);
      return this.close(o, "participant_minor");
    }
    if (!this.friendsRosterVerificationCurrent(this.oppRoster(o))) {
      this.gate("friends_verification_required", o.participants);
      return this.close(o, "friends_verification_required");
    }
    o.review = { queuedAt: now, deadline: now + (o.sameDay ? 1 : this.opts.reviewSlaHours) * HOUR };
    for (const p of o.participants) o.status.set(p, "queued");
    this.counters.reviewQueued++;
    this.ctx.log("review_queued", { proposal: this.toProposal(o), origin: o.origin, deadline: o.review.deadline, runId: o.runId });
  }

  /** Start the consent flow for an approved opportunity: probe the member with the want first. */
  private begin(o: Opp) {
    // spec/opportunityLifecycle.md, "An opportunity starts in review"
    const next = stepOpportunity(opportunityLifecycle(o), {
      type: "startProbing", approvalRecorded: reviewApproved(o.review), eligible: !o.review?.invalidated,
    });
    if (next.phase !== "Probing") return;
    o.stage = STAGE_BY_PHASE[next.phase];
    if (o.plan) return this.beginPlan(o);
    o.deadline = this.now() + PROBE_WAIT;
    o.first = this.firstOf(o);
    for (const p of o.participants) o.status.set(p, "queued");
    this.counters.oppsStarted++;
    this.ctx.log("probe_started", { proposal: this.toProposal(o), origin: o.origin, primed: [...o.primed], runId: o.runId, reviewer: o.review?.reviewer, approver: o.review?.approver, first: o.first });
    // A retried request: now that a reviewer approved it, the requester hears that we are checking.
    // A requester with a partial fit gets the confirm-probe instead (one message, not two).
    const req = o.retry && o.requester ? this.members.get(o.requester) : undefined;
    if (req && o.primed.has(req.id)) this.send(req, copy.requestRetryFound, { type: "info", proposalId: o.id }, "info", { hook: { t: "retry_found", oppId: o.id } });
    this.startProbes(o);
  }

  /**
   * Who is probed first (attention v1.2, sequential): a requester who must confirm, else the engine's
   * firstToProbe (the member with the live want: seeker, initiator, newcomer), else the first participant.
   */
  private firstOf(o: Opp): MemberId {
    // peon: candidate first; the hiring manager reviews only a candidate who said yes.
    if (o.seat) return o.participants.find(p => p !== o.seat!.manager) ?? o.participants[0]!;
    if (o.requester && o.participants.includes(o.requester)) return o.requester;
    return o.roles ? attention.firstToProbe({ participants: o.participants, roles: o.roles }) : o.participants[0]!;
  }

  /** What an app's hook sees of an opportunity. */
  private hookOpp(o: Opp): HookOpp {
    return { id: o.id, category: o.category, participants: [...o.participants], ...(o.first ? { first: o.first } : {}), ...(o.seat ? { seat: { ...o.seat, title: this.seatTitle(o.seat.id) } } : {}), ...(o.picks ? { picks: o.picks } : {}), ...(o.meetingAt !== undefined ? { meetingAt: o.meetingAt } : {}) };
  }
  /** The pack input, built at most once per call site (hooks that need it ask for it). */
  private inputOnce(): () => EngineInput { let x: EngineInput | undefined; return () => (x ??= this.packInput(this.now())); }

  // ================================================================== opportunities
  private newOpp(x: { id?: string; recorded?: boolean; origin: Origin; kind: Proposal["kind"]; category: Category; objective: string; detail: string; participants: MemberId[]; alternates: MemberId[]; primed: MemberId[]; requester?: MemberId; explanations: Record<MemberId, string>; score: number; generator: string; tags: string[]; components?: ScoreComponents; exploration?: boolean; sameDay?: boolean }): Opp {
    const now = this.now();
    const o: Opp = {
      recorded: x.recorded,
      id: x.recorded && x.id ? x.id : this.sid(x.id ?? `nw-${this.opts.seed}-${++this.oppSeq}`), origin: x.origin, kind: x.kind, category: x.category, objective: x.objective, detail: x.detail,
      participants: [...x.participants], alternates: this.distinctAlternates(x.participants, x.alternates), primed: new Set(x.primed), requester: x.requester,
      status: new Map(x.participants.map(id => [id, "queued" as PStatus])), explanations: { ...x.explanations },
      stage: STAGE_BY_PHASE[initialOpportunity.phase], deadline: now + this.probeWindow(false), createdAt: now, score: x.score, components: x.components ?? ZERO, generator: x.generator,
      exploration: !!x.exploration, tags: x.tags, replacements: 0, sameDay: !!x.sameDay, contacted: new Set(), reminded: new Set(), feedbackFrom: new Set(), probeDelivery: {}, runId: this.currentRunId,
    };
    this.opps.set(o.id, o);
    return o;
  }

  private toProposal(o: Opp): Proposal {
    const now = this.now();
    return {
      id: o.id, kind: o.kind, participants: [...o.participants], alternates: [...o.alternates], objective: o.objective, category: o.category,
      city: this.networkCity(), window: o.plan ? { start: o.meetingAt ?? o.plan.window.start, end: o.plan.window.end }
        : o.publicEventRevision && o.anchorWindow ? { ...o.anchorWindow }
        : { start: o.meetingAt ?? now + DAY, end: (o.meetingAt ?? now + DAY) + 4 * DAY }, score: o.score, components: o.components,
      exploration: o.exploration, explanations: { ...o.explanations }, generator: o.generator, createdAt: o.createdAt,
    };
  }

  private startProbes(o: Opp) {
    if (!this.opts.probes && !isGatheringRepeat(o)) { for (const id of o.participants) o.status.set(id, "available"); return this.reveal(o); }
    this.advanceProbes(o);
  }

  /**
   * Sequential probes (attention v1.2): the first member, then the others after their yes. A member
   * who asked for this exact thing (primed) needs no probe. Whoever's turn it is gets a probe now,
   * or in their send window (probe() defers it; tick() calls this again). Reveal when all said yes.
   */
  private advanceProbes(o: Opp) {
    if (o.plan) return this.planLane(o, this.now());
    if (o.stage !== "probing") return;
    if (!this.currentDatingPair(o)) return this.close(o, "slop_pair_changed", { releasePartial: true });
    if (o.seat && !this.currentHireSeat(o.seat, o.participants)) return this.close(o, "peon_search_changed", { releasePartial: true });
    if (isGatheringRepeat(o) && !this.repeatSourceCurrent(o)) return this.close(o, "gathering repeat consent changed");
    if (this.holdHelpOpportunity(o)) return this.close(o, "bounded help needs safety review");
    if (o.lane === "Cofounder" && !cofounderDeliveryAllowed(this.cofounderCurrent(o), reviewApproved(o.review), false, false)) {
      return this.close(o, "cofounder_intent_changed");
    }
    const listed = this.currentPublishedEvent(o);
    const publicEventIssue = this.publicEventRefusal(o, listed);
    if (publicEventIssue) return this.close(o, publicEventIssue);
    const now = this.now();
    const fixed = listed ?? this.fixedTimeWindow(o);
    if (fixed && !this.calendarAllows(o.participants, fixed, now)) return this.closeNoCommonTime(o, o.participants[0]!);
    if (!o.first || !o.participants.includes(o.first)) o.first = this.firstOf(o);
    // A member who asked for this exact thing is not asked yes or no. A requester still picks the
    // times first (requestTimes), so the other person is offered only times that work for them.
    // spec/probeDispatch.md, "The first participant opens the later turns"
    for (const p of o.participants) {
      const probe = participantProbe(o, p);
      const primed = o.primed.has(p), contacted = o.contacted.has(p);
      if (!mayUsePriorIntent(probe, primed, contacted)) continue;
      const next = stepProbe(probe, { type: "usePriorIntent", primed, contacted, needsTimes: this.asksTimes(o, p) });
      if (next !== probe) storeProbe(o, p, next);
    }
    const firstIn = agreedToRoster(participantProbe(o, o.first), o.roster ?? 0);
    for (const p of [...o.participants]) {
      if (o.stage !== "probing") return;
      const current = participantProbe(o, p), first = p === o.first;
      if (!turnReached(current, first, firstIn)) continue;
      const opened = stepProbe(current, { type: "openTurn", first, firstAvailable: firstIn });
      if (opened !== current) { storeProbe(o, p, opened); o.turnAt = { ...o.turnAt, [p]: now }; }
      if (needsProbeSend(this.probeToSend(o, p, opened))) this.probe(o, p);
    }
    this.maybeReveal(o);
  }

  /**
   * The anonymous probe: activity, area, 2-3 time options and at most one fact about the others
   * (D5: never a name, photo or employer). An initial invite (counts once on the member's cap) waits
   * for their send window; a requester's own confirm-probe is not an invite and waits only for quiet hours.
   */
  private probe(o: Opp, id: MemberId) {
    if (o.seat && !this.hireContactCurrent(o, id, false)) return this.close(o, "peon_search_changed", { releasePartial: true });
    const m = this.member(id);
    const now = this.now();
    const pending = participantProbe(o, id);
    if (!needsProbeSend(this.probeToSend(o, id, pending))) return;
    if (o.seat?.manager === id && !this.managerProbeMayOpen(o, m, now)) return;
    if (o.origin === "second_encounter" && (!this.repeatSourceCurrent(o) || !this.repeatPreferencesAllow(o.category, o.participants))) {
      this.close(o, "repeat preferences changed");
      return;
    }
    // A hiring manager asked for candidates (their posting): the review of one is not an initial invite.
    const invite = probeIsInvite(o.requester === id, o.seat?.manager === id);
    const timing: Timing = invite ? "slot" : "logistics";
    // One open question at a time: a probe waits (up to a day) while the member's answer to an ask
    // (growth, profiling, check-in) is still due, so "Sure, my friend Wren would love this" is never
    // read as a yes to the probe.
    const holdUntil = this.questionHoldUntil(m, now);
    // The same for a probe they still owe an answer on (a hiring manager reviews several candidates):
    // the member has one answer slot, and a second probe would take it from the first.
    const owedOn = this.owedAnswer(m, o.id);
    const owed = owedOn?.kind === "probe" ? owedOn : undefined;
    // spec/probeDispatch.md, "Wait for the member's send window and current availability"
    const timingDecision = probeTiming(holdUntil !== undefined, holdUntil === undefined && this.timingOk(m, timing, now));
    if (owed || timingDecision !== "CheckAvailability") {
      if (!o.deferLogged?.includes(id)) {
        o.deferLogged = [...(o.deferLogged ?? []), id];
        this.counters.deferred++;
        this.ctx.log("send_deferred", { memberId: id, kind: "probe", oppId: o.id, until: holdUntil ?? this.openAt(m, timing, now), ...(owed ? { owedOn: owed.oppId } : {}) });
      }
      return;
    }
    // A probe can go out days after the gates ran (sequential probes, send windows): someone who is
    // away from New York now or this week is not asked (the gates' 6-day presence check, again).
    const present = this.inNyc(id, now, now + 6 * DAY);
    const availability = probeAvailability(present, present && this.commonTimeGone(o, id, now));
    if (availability === "ParticipantAway") {
      this.refuse(id, "probe", "away");
      if (stepProbe(pending, { type: "markUnavailable" }).phase === "Unavailable") o.status.set(id, "unavailable");
      return this.replaceOrClose(o, id);
    }
    // The others' picked times are all too soon now (or turned down): new times would not match theirs.
    if (availability === "NoCommonTime") return this.closeNoCommonTime(o, id);
    const { options, text, fallback, timesOnly } = this.probeCopy(o, id, now);
    o.offered = { ...o.offered, [id]: options };
    if (o.requester === id) { const r = this.requests.find(x => x.oppId === o.id && x.memberId === id); if (r) r.lastConfirmAt = now; }
    const window = options.length ? { start: options[0]!.start, end: options[options.length - 1]!.end } : { start: now + DAY, end: now + 5 * DAY };
    this.send(m, text, timesOnly ? { type: "scheduling", proactive: false, proposalId: o.id, ...(options.length ? { timeOptions: options } : {}) } : {
      type: "probe", proactive: invite, probe: { key: o.id, category: o.category, participants: [...o.participants], kind: o.kind, window },
      ...(options.length ? { timeOptions: options } : {}),
    }, "probe", { about: o.participants, fallback, hook: { t: "probe", oppId: o.id, id, roster: o.roster ?? 0 }, noDefer: true,
      ...(isGatheringRepeat(o) ? { key: gatheringRepeatProbeKey(o.id, id) } : {}) });
  }

  private static readonly WORK_ONTOLOGY_TAGS: ReadonlySet<string> = new Set([
    "work_hiring",
    "step_ahead_mentorship",
    "patronage_sponsorship",
    "executive_peer_council",
  ]);

  private isWorkIntro(o: Pick<Opp, "seat" | "lane" | "category" | "tags">): boolean {
    return (
      !!o.seat ||
      o.lane === "Cofounder" ||
      (this.app.id === "peon" && o.category === "professional") ||
      o.tags.some(t => ConsentNetwork.WORK_ONTOLOGY_TAGS.has(t))
    );
  }

  private probeCopy(o: Opp, id: MemberId, now: number) {
    const m = this.member(id);
    const tz = this.cityTz();
    // A work intro has no physical meeting slot unless video scheduling was explicitly requested.
    const wantsVideo = o.tags.includes("video") || o.tags.includes("video_call") || /\bvideo\b/i.test(o.objective);
    const options = this.isWorkIntro(o) && !wantsVideo ? [] : this.timeOptionsFor(o, id, now);
    const times = options.length ? attention.timeOptionsPhrase(options, tz) : undefined;
    const teen = o.teenRuleAt !== undefined;
    const area = teen ? NEIGHBORHOOD.get(o.venueArea ?? m.area ?? "")?.borough : o.venueArea ?? m.area;
    const detail = teen && !o.requester ? "" : o.detail;
    const when = o.category === "hobby" || o.category === "events" ? "this weekend" : "this week";
    const generic = copy.probe(o.category, "", when, area, undefined, times);
    const others = o.participants.filter(x => x !== id);
    const timesOnly = o.requester === id && o.primed.has(id) && !!times;
    if (o.pivotFromGroup && o.anchorWindow && o.venue) {
      const pivotBody = this.copy.partialGroupTwoPersonPivot(whenPhrase(o.anchorWindow.start, tz), o.venue, { activity: o.detail || undefined });
      return { options, text: pivotBody, fallback: pivotBody, timesOnly: false };
    }
    // The app's pack words the anonymous probe (slop: a date, an age band, a distance band); never for a requester's own confirm.
    const packText = o.requester || teen ? undefined : this.opts.hooks?.probe?.(this.hookOpp(o), id, { ...(times ? { times } : {}), when, input: this.inputOnce() });
    if (!packText && o.origin === "second_encounter" && !o.requester && !teen && others.length === 1) {
      const base = this.copy.secondEncounter("someone you recently met");
      const secondText = times ? `${base} I could do ${times}; tell me which works, or no.` : base;
      return { options, text: secondText, fallback: base, timesOnly: false };
    }
    const [body, fallback] = packText ? [packText, generic] : o.origin === "plans" && o.fixedVenue ? [copy.plansBuddyProbe(o.fixedVenue.name, when, area, times), generic]
      : timesOnly ? [copy.requestTimes(o.explanations[id] ?? "someone nearby", times!), copy.requestTimes(GOOD_FIT, times!)]
      : o.requester === id ? [copy.requestConfirm(o.explanations[id] ?? "someone nearby", when, times), copy.requestConfirm("it seemed like a good fit", when, times)]
      : o.requester ? [copy.probeForRequest(detail, when, times), generic]
      : [copy.probe(o.category, detail, when, area, this.probeReason(id, o), times), generic];
    // D5: a probe that would carry another member's name or employer falls back to the generic text.
    const text = this.probeNames(body, others) ? (this.probeNames(fallback, others) ? copy.probe(o.category, "", when, area, undefined, times) : fallback) : body;
    return { options, text, fallback, timesOnly };
  }

  /**
   * The others named times, and none of them can still work for this member (each is too soon, or
   * someone turned it down). Asking or booking would set a time this member never said works.
   */
  private commonTimeGone(o: Opp, id: MemberId, now: number): boolean {
    const c = this.commonPicks(o, id, now);
    return c.named && !c.slots.length && !o.fixedVenue && !(o.anchorWindow && o.anchorWindow.end - o.anchorWindow.start <= 6 * HOUR);
  }

  /** No time in common is left: close quietly (no member learns who turned which time down) and log it. */
  private closeNoCommonTime(o: Opp, id: MemberId) {
    this.counters.noCommonTime++;
    this.ctx.log("no_common_time", { oppId: o.id, memberId: id, picks: Object.fromEntries(Object.entries(o.picks ?? {}).map(([k, v]) => [k, v.length])) });
    this.close(o, "no common time", { releasePartial: true });
  }

  /** A primed requester who has not picked times yet, and times to offer: they get the time question first. */
  private asksTimes(o: Opp, id: MemberId): boolean {
    return o.requester === id && o.first === id && !o.picks?.[id] && !o.fixedVenue && this.timeOptionsFor(o, id, this.now()).length > 0;
  }

  /** True when the text names another participant or carries their employer (D5). */
  private probeNames(text: string, others: MemberId[]): boolean {
    const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    for (const x of others) {
      for (const w of (this.fullNames.get(x) ?? "").toLowerCase().split(/\s+/)) if (w.length >= 2 && t.includes(` ${w} `)) return true;
    }
    const snap = this.snapshotCached();
    return snap.facets.some(f => others.includes(f.memberId) && (f.tags.some(g => EMPLOYER_TAGS.test(g)) || EMPLOYER_TEXT.test(f.value)) && f.value.length >= 4 && text.toLowerCase().includes(f.value.toLowerCase()));
  }

  /**
   * The slots every other member who named times picked, still at least 12 hours out and never one
   * any member turned down. `named` is false when nobody else has named a time yet (or they all said
   * "neither"): then there is no constraint from the others.
   */
  private commonPicks(o: Opp, id: MemberId, now: number): { named: boolean; slots: { start: number; end: number }[] } {
    const named = Object.entries(o.picks ?? {}).filter(([who, xs]) => who !== id && o.participants.includes(who) && xs.length);
    if (!named.length) return { named: false, slots: [] };
    const declined = new Set(o.declinedTimes ?? []);
    const open = named.reduce<number[]>((acc, [, xs]) => acc.filter(t => xs.includes(t)), named[0]![1]).filter(t => !declined.has(t));
    const src = Object.values(o.offered ?? {}).flat();
    const slots = [...new Map(src.filter(x => open.includes(x.start) && x.start >= now + PARTNER_LEAD).map(x => [x.start, x])).values()].sort((a, b) => a.start - b.start);
    return { named: true, slots };
  }

  /**
   * Time options for this member's probe (founder decision 4a). The partner is offered only the
   * slots the others picked (still at least 12 hours out, never a time anyone turned down); the
   * first member gets 2-3 options chosen for everyone (attention.chooseTimeOptions). None when the
   * others named times and none of them is left: there is no time in common (commonTimeGone).
   */
  private timeOptionsFor(o: Opp, id: MemberId, now: number): TimeOption[] {
    const tz = this.cityTz();
    const keyed = (slots: { start: number; end: number }[]) => slots.slice(0, 3).map((x, i) => ({ key: "abc"[i]!, start: x.start, end: x.end, label: attention.timeOptionsPhrase([x], tz) }));
    const evidence = o.participants.map(p => this.evidence(this.member(p), now));
    const calendarAllows = (slot: attention.TimeSlot) => evidence.every(ev => attention.calendarAvailability(ev.calendar, slot, now) !== "busy") && this.teenSlotAllowed(o, slot);
    if (o.publicEventRevision) {
      const listing = this.currentPublishedEvent(o);
      return listing && !o.declinedTimes?.includes(listing.start) && calendarAllows(listing) ? keyed([listing]) : [];
    }
    const picks = Object.entries(o.picks ?? {}).filter(([who]) => o.participants.includes(who));
    const common = this.commonPicks(o, id, now);
    if (common.named) return keyed(common.slots.filter(calendarAllows));
    // No picks yet, or everyone else said "neither": times for everyone, never one a member turned down.
    const declined = new Set(o.declinedTimes ?? []);
    const fixed = !picks.length && this.fixedTimeWindow(o);
    // The app's pack may name the first member's options (slop: the date plan's slots both are usually free).
    const fromPack = !fixed && !picks.length ? this.opts.hooks?.timeOptions?.(this.hookOpp(o), now, this.inputOnce()) : undefined;
    if (fromPack?.length) {
      const ok = fromPack.filter(x => x.start >= now + PARTNER_LEAD && !declined.has(x.start) && calendarAllows(x)).sort((a, b) => a.start - b.start);
      if (ok.length) return keyed(ok);
    }
    const candidates = attention.candidateSlots(tz, now).filter(x => !declined.has(x.start) && this.teenSlotAllowed(o, x));
    const r = attention.chooseTimeOptions(evidence, now, { tz, ...(fixed ? { fixed: true, window: fixed } : { candidates }) });
    return keyed(r.slots.map(x => x.slot).filter(x => x.start > now && this.teenSlotAllowed(o, x)));
  }

  private fixedTimeWindow(o: Opp): attention.TimeSlot | undefined {
    const window = o.anchorWindow;
    return window && window.end - window.start <= 6 * HOUR ? window : undefined;
  }

  private calendarOwnerEligible(m: MemberState): boolean {
    const view = relayMemberOf(m, !this.trust.ok(m.id) || this.reportHeld(m.id), earliestDayKeyOf(this.now()));
    return canBeMatched(view.age) && !view.optedOut && !view.held && m.state !== "paused";
  }

  private calendarEvidence(m: MemberState, now: number) {
    if (!m.calendar || !this.opts.calendarFreeBusy) return;
    return readCalendarFreeBusy({ app: this.app.id, memberId: m.id, purpose: calendarSchedulingPurpose, now },
      m.calendar, this.calendarOwnerEligible(m), this.opts.calendarFreeBusy);
  }

  private calendarAllows(members: readonly MemberId[], slot: attention.TimeSlot, now: number): boolean {
    return !this.opts.calendarFreeBusy || members.every(id => attention.calendarAvailability(this.calendarEvidence(this.member(id), now), slot, now) !== "busy");
  }

  /** What the Network knows about when a member is free (engine-visible; never shareable). */
  private evidence(m: MemberState, now: number, exceptOpp?: string, opps: Iterable<Opp> = this.opps.values()): attention.AvailabilityEvidence {
    const rows = this.snapshotRows();
    const stated = (m.availability ?? []).filter(a => now - a.at < 7 * DAY).map(a => ({ kind: "availability_pattern", tags: a.tags, observedAt: a.at }));
    // Standing availability said at onboarding does not expire (plans ask 1).
    const said = m.standing ? [{ kind: "availability_pattern", tags: m.standing.tags, observedAt: m.standing.at }] : [];
    const standing = attention.standingFromFacets([...rows.facets.get(m.id) ?? [], ...stated, ...said], now);
    // A member's booked plans count as away when a time is chosen for anything else (plans ask 5).
    const city = this.networkCity(), tz = this.cityTz();
    const booked = [...opps].filter(o => o.id !== exceptOpp && o.stage === "scheduled" && o.meetingAt !== undefined && o.status.get(m.id) === "yes").map(o => ({ start: o.meetingAt! - 2 * HOUR, end: o.meetingAt! + 3 * HOUR }));
    const away = [...(rows.presence.get(m.id) ?? []).filter(p => p.type === "temporary" && p.city !== city && p.from !== undefined && p.to !== undefined).map(p => ({ start: p.from!, end: p.to! })), ...booked];
    const calendar = this.calendarEvidence(m, now);
    return { memberId: m.id, tz, quietHours: m.quietHours, standing, history: m.availHistory ?? [], ...(away.length ? { away } : {}), ...(calendar ? { calendar } : {}) };
  }

  private lateProbeAnswer(m: MemberState, ended: NonNullable<MemberState["endedProbe"]>, msg: InboundMessage, body: string, now: number): boolean {
    const text = body.trim();
    const answered = consentOf(text).answer !== "unclear" || ACK_ONLY.test(text);
    const receipt = this.ctx.initialInviteReceipt?.(ended.receiptKey);
    const acceptedAt = this.ctx.initialInviteReceipt ? (receipt?.kind === "accepted" ? receipt.at : undefined) : ended.sentAt;
    const receivedAt = msg.signedReceivedAt ?? msg.ts;
    // spec/probeReply.md, "A late answer to an expired probe hears once that the invitation ended"
    const notice = ended.voided ? this.copy.probeVoided : this.copy.probeEnded;
    const latestIsEndNotice = ended.told && m.lastSent?.consentProbe === null && !!m.lastSent.body.endsWith(notice);
    const route = lateProbeRoute(this.memberReply && !msg.reaction, answered, latestOutboundMatchesProbe(m.lastSent, ended.oppId, ended.sentAt),
      acceptedAt !== undefined, acceptedAt ?? 0, ended.endedAt, Math.min(receivedAt, now), ended.told, latestIsEndNotice, !!ended.voided);
    if (route === "AlreadyToldProbeEnded") { this.ctx.log("late_probe_answer_again", { oppId: ended.oppId, memberId: m.id }); return true; }
    if (route === "NotALateProbeAnswer") return false;
    m.endedProbe = { ...ended, told: true };
    this.ctx.log("late_probe_answer", { oppId: ended.oppId, memberId: m.id, voided: route === "TellPlanChanged" });
    this.send(m, notice, { type: "info" }, "reply");
    return true;
  }

  private extractCounterProposalSlots(o: Opp, body: string, now: number): attention.TimeSlot[] {
    const text = body.trim();
    if (!text) return [];
    const tz = this.cityTz();
    const declined = new Set(o.declinedTimes ?? []);
    const duration = DEFAULT_ATTENTION.availability.slotHours * HOUR;
    const evidence = o.participants.map(p => this.evidence(this.member(p), now, o.id));
    const slotOk = (slot: attention.TimeSlot) =>
      slot.start >= now + PARTNER_LEAD
      && slot.start <= now + DEFAULT_ATTENTION.availability.horizonDays * DAY
      && !declined.has(slot.start)
      && evidence.every(ev => attention.calendarAvailability(ev.calendar, slot, now) !== "busy")
      && this.teenSlotAllowed(o, slot);
    const out: attention.TimeSlot[] = [];
    const seen = new Set<number>();
    const add = (slot: attention.TimeSlot) => {
      if (seen.has(slot.start) || !slotOk(slot)) return;
      seen.add(slot.start);
      out.push(slot);
    };
    const dayMap: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
    const lp = localParts(now, tz);
    const todayDow = (lp.weekday + 1) % 7;
    const exactRx = /\b(today|tonight|tomorrow|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b(?:\s+(?:around|at|after))?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi;
    for (const match of text.matchAll(exactRx)) {
      const dayToken = match[1]!.toLowerCase();
      let hour = Number(match[2]!);
      const min = match[3] ? Number(match[3]) : 0;
      const ampm = match[4]?.toLowerCase();
      if (ampm === "pm" && hour < 12) hour += 12;
      else if (ampm === "am" && hour === 12) hour = 0;
      else if (!ampm && hour >= 1 && hour <= 11) hour += 12;
      if (hour < 8 || hour > 21 || min < 0 || min >= 60) continue;
      let offset = 0;
      if (dayToken === "tomorrow") offset = 1;
      else if (dayToken !== "today" && dayToken !== "tonight") {
        const target = dayMap[dayToken];
        if (target === undefined) continue;
        offset = (target - todayDow + 7) % 7;
        if (offset === 0) offset = 7;
      }
      const d = new Date(Date.UTC(lp.year, lp.month - 1, lp.day + offset));
      const start = fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour + min / 60, tz);
      add({ start, end: start + duration });
    }
    if (!out.length) {
      const tags = availabilityTags(text, now, tz);
      const stated = tags.length ? statedWindows(tags, now, tz) : undefined;
      if (stated?.windows.length) {
        const candidates = attention.candidateSlots(tz, now);
        for (const cand of candidates) {
          if (stated.windows.some(w => cand.start >= w.start && cand.end <= w.end)) add(cand);
        }
      }
    }
    return out.sort((a, b) => a.start - b.start).slice(0, 3);
  }

  private tryRelayCounterProposal(m: MemberState, o: Opp, body: string, now: number): boolean {
    if (o.participants.length !== 2 || o.counterProposed || o.fixedVenue || o.publicEventRevision || isGatheringRepeat(o)) return false;
    const partnerId = o.participants.find(p => p !== m.id);
    if (!partnerId) return false;
    const partner = this.members.get(partnerId);
    if (!partner || partner.optedOut || !this.checkRecipient(partnerId, "scheduling", { about: o.participants, reply: false, opp: o }).ok) return false;
    const slots = this.extractCounterProposalSlots(o, body, now);
    if (!slots.length) return false;
    const tz = this.cityTz();
    const counterOptions: TimeOption[] = slots.map((s, i) => ({
      key: "abc"[i]!, start: s.start, end: s.end, label: attention.timeOptionsPhrase([s], tz),
    }));
    o.counterProposed = true;
    o.picks = { ...o.picks, [m.id]: slots.map(s => s.start) };
    o.offered = { ...o.offered, [partnerId]: counterOptions };
    o.timeRetry = [...new Set([...(o.timeRetry ?? []), partnerId])];
    o.status.set(partnerId, "probing");
    o.sentAt = { ...o.sentAt, [partnerId]: now };
    this.ack(m, "Got it — let me check if that works for them.");
    this.ctx.log("counter_proposal_relayed", { oppId: o.id, from: m.id, to: partnerId, slots: slots.map(s => s.start) });
    this.send(partner, copy.timesRetry(attention.timeOptionsPhrase(counterOptions, tz)), {
      type: "scheduling", proactive: false, timeOptions: counterOptions,
      ...(this.app.id === "friends" || (this.app.id === "slop" && o.category === "romance") ? { proposalId: o.id } : {}),
    }, "scheduling", { about: o.participants, hook: { t: "times", oppId: o.id, id: partnerId } });
    return true;
  }

  private onProbeAnswer(m: MemberState, oppId: string, yes: boolean, keys: string[] = [], replyBody = "", priorCounterBody?: string) {
    const o = this.opps.get(oppId);
    if (!o || o.stage !== "probing") return;
    if (isGatheringRepeat(o) && !this.repeatSourceCurrent(o)) return this.close(o, "gathering repeat consent changed");
    // spec/probeDispatch.md, "A reply or an expired deadline settles the probe"
    const current = participantProbe(o, m.id);
    if (!canRecordReply(current)) return;
    const answered = stepProbe(current, { type: "recordReply", agreed: yes });
    o.askedAgain = o.askedAgain?.filter(x => x !== m.id);
    if (o.seat && o.participants.includes(m.id)) (o.seatProbeReplies ??= {})[m.id] = yes ? "yes" : "no";
    const retry = !!o.timeRetry?.includes(m.id);
    if (!retry) this.sampleInterruption(m, o.id);
    const offered = o.offered?.[m.id] ?? [];
    const picked = offered.filter(x => keys.includes(x.key));
    if (!retry) m.answered++;
    this.ctx.log(retry ? "time_answer" : "probe_answer", { oppId, memberId: m.id, yes, ...(offered.length ? { picked: picked.map(x => x.key) } : {}) });
    let pendingAck: { text: string; direct: boolean } | undefined;
    if (answered.phase === "Available") {
      if (!retry) this.counters.probeYes++;
      o.status.set(m.id, "available"); o.primed.add(m.id);
      const declinedBefore = o.declinedTimes;
      if (offered.length) {
        o.picks = { ...o.picks, [m.id]: picked.map(x => x.start) };
        o.declinedTimes = [...(o.declinedTimes ?? []), ...offered.filter(x => !picked.includes(x)).map(x => x.start)];
        if (!picked.length) this.counters.optionsNoneFit++;
        const hist = m.availHistory ?? [];
        for (const x of offered) hist.push({ at: x.start, outcome: picked.includes(x) ? "accepted" : "declined_time" });
        m.availHistory = hist.slice(-availabilityHistoryLimit);
      }
      // "Yes, but none of those": once, offer other times (a direct reply, never on the cap). Otherwise
      // the plan would be set at a time this member never said works, and is often called off.
      // The retry never repeats a time anyone turned down. When the others named times and every one
      // of them is gone, try one counter-proposal relay back to the partner before closing.
      const offeredTimes = offered.length > 0, pickedTimes = picked.length > 0;
      if (needsOtherTimes(offeredTimes, pickedTimes) && this.commonTimeGone(o, m.id, this.now())) {
        const counterSource = replyBody || priorCounterBody || "";
        if (o.participants.length === 2 && counterSource && this.tryRelayCounterProposal(m, o, counterSource, this.now())) {
          return;
        }
        this.ack(m, "No problem.", { direct: true });
        if (o.participants.length <= 2) return this.closeNoCommonTime(o, m.id);
        // A group goes on without this member, as after a no (docs/network.md 4.1). The times only
        // they turned down are not held against the others.
        if (declinedBefore) o.declinedTimes = declinedBefore; else delete o.declinedTimes;
        o.status.set(m.id, "unavailable"); this.replaceOrClose(o, m.id);
        return this.advanceProbes(o);
      }
      const fresh = shouldLookForOtherTimes(offeredTimes, pickedTimes, retry) ? this.timeOptionsFor(o, m.id, this.now()) : [];
      if (stepProbe(answered, { type: "offerOtherTimes", hasFreshTimes: fresh.length > 0 }).phase === "AwaitingReply") {
        o.timeRetry = [...(o.timeRetry ?? []), m.id];
        o.offered = { ...o.offered, [m.id]: fresh };
        o.status.set(m.id, "probing");
        o.sentAt = { ...o.sentAt, [m.id]: this.now() };
        const gathering = isGatheringRepeat(o);
        this.send(m, copy.timesRetry(attention.timeOptionsPhrase(fresh, this.cityTz())), { type: "scheduling", proactive: false, timeOptions: fresh,
          ...(gathering || this.app.id === "friends" || (this.app.id === "slop" && o.category === "romance") ? { proposalId: o.id } : {}) }, "scheduling", { about: o.participants, hook: { t: "times", oppId: o.id, id: m.id },
          ...(gathering ? { key: gatheringRepeatProbeKey(o.id, m.id, true), noDefer: true } : {}) });
        return;
      }
      if (isGatheringRepeat(o) && needsOtherTimes(offeredTimes, pickedTimes)) return this.closeNoCommonTime(o, m.id);
      pendingAck = { text: "Great, thanks.", direct: false };
    } else if (answered.phase === "Unavailable") {
      this.counters.probeNo++; this.emit({ type: "declined", member: m.id, planId: o.id }, `${o.id}:${m.id}`);
      // A no is remembered for the pair (network-consent-5): never probed again for a while, from any path.
      this.markDeclined(o.participants, this.now(), m.id);
      if (o.requester === m.id) {
        // The requester turned this candidate down. A second no on the same request closes it (matching-e2e-3).
        const r = this.requests.find(x => x.oppId === o.id && x.memberId === m.id);
        if (r) { r.noCount = (r.noCount ?? 0) + 1; if (r.noCount >= 2) r.closed = true; }
      }
      o.status.set(m.id, "unavailable"); pendingAck = { text: "No problem.", direct: true }; this.replaceOrClose(o, m.id);
    }
    this.advanceProbes(o);
    if (pendingAck && !this.sentThisTurn) this.ack(m, pendingAck.text, { direct: pendingAck.direct });
  }

  /** The answer to a plan probe. "Can't make that time" is a no, and a time this member is not free (availability evidence). */
  private onPlanProbeAnswer(m: MemberState, o: Opp, yes: boolean, body: string, picks?: readonly attention.TimeSlot[]) {
    // spec/planDecision.md, "Only a pending member can change an open plan": a reply at or after the
    // probe deadline is not counted, not kept as availability evidence and not acknowledged.
    let answeredPlan = false;
    const outcome = this.planAnswer(o, m.id, yes, false, () => {
      answeredPlan = true;
      m.answered++;
      // Check the plan receipt independently of the unanswered ledger, which an earlier message can clear.
      this.sampleInterruption(m, o.id, true);
      this.ctx.log("probe_answer", { oppId: o.id, memberId: m.id, yes, plan: true });
      if (yes) this.counters.probeYes++; else { this.counters.probeNo++; this.emit({ type: "declined", member: m.id, planId: o.id }, `${o.id}:${m.id}`); }
      if (picks) {
        o.picks = { ...o.picks, [m.id]: picks.map(slot => slot.start) };
        if (yes) m.availHistory = [...(m.availHistory ?? []), ...picks.map(slot => ({ at: slot.start, outcome: "accepted" as const }))].slice(-availabilityHistoryLimit);
      } else {
        const notThen = !yes && /\b(that time|then|that day|make it)\b/i.test(body);
        if (yes || notThen) m.availHistory = [...(m.availHistory ?? []), { at: o.plan!.window.start, outcome: yes ? "accepted" as const : "declined_time" as const }].slice(-availabilityHistoryLimit);
      }
    });
    if (answeredPlan && !this.sentThisTurn) this.ack(m, yes ? "Great, thanks. I'll tell you once enough people are in." : "No problem.", { direct: !yes });
    // A yes that the deadline turned away, here or in an earlier tick, still hears how the plan ended.
    const closedPending = outcome === undefined && o.planRun?.stage === "closed" && o.planRun.answers[m.id] === "pending";
    if (yes && (outcome === "expired" || closedPending)) this.noteFor(m.id, copy.planNotTogether);
  }

  /**
   * The pre-plan confirmation step (NC asks): a member confirms a booked plan in words ("yes", "see
   * you there"), or by silence: the booked plan's 48-hour opt-out (or the meeting start) passed
   * without a "can't". Each is recorded once as plan_confirmed; `explicit` keeps who said it.
   */
  private confirmPlan(o: Opp, id: MemberId, explicit: boolean) {
    const changes = confirmationChanges(o.status.get(id) === "yes", o.bookedAt?.[id] !== undefined,
      (o.explicit ?? []).includes(id), (o.confirmed ?? []).includes(id), explicit);
    if (changes.recordWords) o.explicit = [...(o.explicit ?? []), id];
    if (!changes.emitConfirmation) return;
    o.confirmed = [...(o.confirmed ?? []), id];
    // A revealed member's decision (matching-e2e-7): a yes in words or by 48 hours of silence.
    this.counters.revealYes++;
    this.ctx.log("plan_confirmed", { oppId: o.id, memberId: id, how: explicit ? "said" : "silence" });
    this.emit({ type: "plan_confirmed", member: id, planId: o.id }, `${o.id}:${id}`);
  }

  /** Swap an unavailable participant for an alternate (never the requester), or close quietly. */
  private replaceOrClose(o: Opp, out: MemberId) {
    // spec/probeDispatch.md, "A replacement keeps the requester or hiring manager and all eligible group members"
    const route = replacementRoute(o.stage === "probing", o.requester === out, o.seat?.manager === out);
    if (route === "IgnoreReplacement") return;
    // The member is out of this item: a probe slot that points at it answers nothing any more.
    const gone = this.members.get(out);
    if (gone?.awaiting?.oppId === o.id) gone.awaiting = undefined;
    if (route === "CloseRequester") return this.close(o, "requester unavailable");
    if (route === "CloseManager") return this.close(o, "manager unavailable", { releasePartial: true });
    if (o.seat) return this.close(o, "candidate unavailable", { releasePartial: true });
    const group = o.participants.length > 2;
    const stay = o.participants.filter(id => id !== out);
    let alt: MemberId | undefined;
    while (!alt && mayTryAlternate(o.alternates.length > 0, o.replacements)) {
      const a = o.alternates.shift()!;
      // The same checks as a reroll: blocks, avoid edges and pair history with everyone staying (network-consent-26).
      const eligible = this.canUseAlternate(o, a, stay, out);
      const sameFirstName = eligible && this.sharesFirstName(o, a);
      const conflict = eligible && !sameFirstName && o.participants.some(p => p !== out && (!this.pairAllowed(p, a) || this.pairHistory(p, a, PAIR_HISTORY_DAYS)));
      if (alternateAllowed(eligible, sameFirstName, conflict)) alt = a;
    }
    if (o.picks?.[out]) { const { [out]: _, ...rest } = o.picks; o.picks = rest; }
    if (alt) {
      const replacement = alt;
      if (!replacementJudged(o.review?.judgedRosters?.includes(rosterKey(o.participants.map(p => (p === out ? replacement : p)))) === true)) {
        return this.close(o, "replacement_not_judged", { releasePartial: true });
      }
      o.replacements++; this.counters.replacements++;
      this.moveParticipantSeat(o, out, alt);
      o.status.delete(out);
      delete o.explanations[out];
      if (o.probeAbout) { const { [out]: _, ...rest } = o.probeAbout; o.probeAbout = rest; }
      if (o.probeDelivery) { const { [out]: _, ...rest } = o.probeDelivery; o.probeDelivery = rest; }
      const askedAgain = this.changeRoster(o, alt);
      // spec/probeDispatch.md, "A replacement keeps a requester's yes and asks again every other member who heard about the earlier roster"
      if (o.first === out) o.first = askedAgain[0] ?? alt;
      this.reexplain(o);
      this.ctx.log("probe_replaced", { oppId: o.id, out, in: alt, askedAgain, proposal: this.toProposal(o) });
      this.advanceProbes(o);
      return;
    }
    if (groupMayRemainWithoutAlternate(group, o.participants.filter(p => o.status.get(p) !== "unavailable").length)) {
      o.participants = o.participants.filter(p => p !== out); o.status.delete(out);
      if (o.first === out) o.first = o.participants[0];
      delete o.explanations[out];
      this.ctx.log("probe_replaced", { oppId: o.id, out, proposal: this.toProposal(o) });
      return;
    }
    this.close(o, "no one available", { releasePartial: true });
  }

  private changeRoster(o: Opp, alternate: MemberId): MemberId[] {
    const askedAgain: MemberId[] = [];
    for (const p of o.participants) {
      if (p === alternate) continue;
      const before = participantProbe(o, p);
      const after = stepProbe(before, { type: "changeRoster", requester: p === o.requester });
      if (after.phase === "Queued" && before.phase !== "Queued") {
        if (before.told) askedAgain.push(p);
        if (before.phase === "Available") o.askedAgain = [...new Set([...(o.askedAgain ?? []), p])];
        const waiting = this.members.get(p);
        if (waiting) this.endWaitingProbe(o, waiting, true);
        if (before.told) o.primed.delete(p);
        if (o.sentAt) delete o.sentAt[p];
        if (o.picks) delete o.picks[p];
        if (o.offered) delete o.offered[p];
        o.timeRetry = o.timeRetry?.filter(x => x !== p);
        o.deferLogged = o.deferLogged?.filter(x => x !== p);
      }
      storeProbe(o, p, after);
    }
    o.roster = (o.roster ?? 0) + 1;
    if (o.participants.includes(alternate)) storeProbe(o, alternate, stepProbe(initialProbe, { type: "joinRoster", roster: o.roster }));
    return askedAgain;
  }

  private endWaitingProbe(o: Opp, m: MemberState, voided: boolean) {
    const aw = m.awaiting;
    if (aw?.kind !== "probe" || aw.oppId !== o.id) {
      if (!voided && m.endedProbe?.oppId === o.id && m.endedProbe.voided && !m.endedProbe.told) m.endedProbe = { ...m.endedProbe, voided: false };
      return;
    }
    const planSlot = o.plan ? planProbeReceiptSlot(o.id, o.sentAt?.[m.id] ?? aw.at, m) : undefined;
    const receiptKey = !planSlot ? (isGatheringRepeat(o) ? gatheringRepeatProbeKey(o.id, m.id, !!o.timeRetry?.includes(m.id)) : probeReplyReceiptKey(o.id, m.id, aw))
      : o.replacementFor ? replacementProbeKey(o.id, m.id) : probeReplyReceiptKey(o.id, m.id, planSlot);
    const receiptId = !planSlot ? aw.probeReceiptId : o.replacementFor ? replacementProbeKey(o.id, m.id) : planSlot.probeReceiptId;
    m.endedProbe = { oppId: o.id, sentAt: aw.at, endedAt: aw.at, told: false, receiptKey, ...(receiptId ? { receiptId } : {}),
      ...(planSlot ? { plan: true } : {}), ...(voided ? { voided: true } : {}) };
    m.awaiting = undefined;
  }

  private maybeReveal(o: Opp) {
    if (o.stage !== "probing") return;
    // spec/probeDispatch.md, "Nobody is introduced without a yes to the current roster"
    const roster = o.roster ?? 0;
    if (o.participants.length && o.participants.every(p => agreedToRoster(participantProbe(o, p), roster))) this.reveal(o);
  }

  /**
   * Everyone said yes: book the plan and tell each member once (attention v1.2, the booked-plan
   * reveal with an opt-out). The message names the others, the time and the place, and is booked
   * unless the member says they can't: silence for 48 hours counts as confirmed. It is logistics:
   * not on the cap, and only while the member has at most 2 messages unanswered.
   */
  private reveal(o: Opp) {
    if (!this.friendsRosterVerificationCurrent(o.participants)) return this.close(o, "friends_verification_required", { releasePartial: true });
    if (!this.currentDatingPair(o)) return this.close(o, "slop_pair_changed", { releasePartial: true });
    if (o.seat && !this.hireContactCurrent(o, o.seat.manager, true)) return this.close(o, "peon_search_changed", { releasePartial: true });
    if (this.holdHelpOpportunity(o)) return this.close(o, "bounded help needs safety review");
    if (o.lane === "Cofounder" && !cofounderDeliveryAllowed(this.cofounderCurrent(o), reviewApproved(o.review), true,
      o.participants.every(p => o.status.get(p) === "available" && o.contacted.has(p)))) {
      return this.close(o, "cofounder_intent_changed");
    }
    if (isGatheringRepeat(o)) {
      const [first, second] = o.participants;
      const accepted = (id: MemberId | undefined) => id !== undefined && o.status.get(id) === "available" && o.primed.has(id) && o.contacted.has(id);
      if (!gatheringRepeatMayBook(this.repeatSourceCurrent(o), contactApproved(reviewStateOf(o)),
        accepted(first), accepted(second))) return this.close(o, "gathering repeat consent changed");
    }
    if (o.origin === "second_encounter" && !this.repeatPreferencesAllow(o.category, o.participants)) return this.close(o, "repeat preferences changed");
    const now = this.now();
    const published = this.currentPublishedEvent(o);
    const publicEventIssue = this.publicEventRefusal(o, published);
    if (publicEventIssue) return this.close(o, publicEventIssue);
    // Send-time re-check before anyone learns who (P1-5): everyone must still be reachable about the
    // others, and have room on the Blooio streak for one more message.
    for (const id of o.participants) {
      const chk = this.checkRecipient(id, "reveal", { about: o.participants, proactive: !this.opts.probes && !o.primed.has(id), reply: false, opp: o });
      const why = !chk.ok ? chk.reason : attention.canSendLogistics({ outboundSinceInbound: this.member(id).outbound ?? 0 }) ? undefined : "conversation_streak";
      if (why) {
        this.refuse(id, "reveal", why);
        o.status.set(id, "unavailable");
        this.replaceOrClose(o, id);
        return this.maybeReveal(o);
      }
    }
    // spec/opportunityLifecycle.md, "Only an approved proposal with enough consent can book"
    const next = stepOpportunity(opportunityLifecycle(o), {
      type: "book", hasConsent: o.participants.every(id => o.status.get(id) === "available"),
    });
    if (next.phase !== "Scheduled") return;
    if (this.isWorkIntro(o)) return this.revealWorkIntro(o, now, next);
    const city = this.networkCity(), tz = this.cityTz();
    let t = published
      ? published.start >= now + MIN_NOTICE && !o.declinedTimes?.includes(published.start) && this.calendarAllows(o.participants, published, now)
        ? { at: published.start, how: "public_event" } : undefined
      : this.meetingTime(o, now);
    const areas = o.participants.map(p => this.member(p).area);
    const fixedVenue = o.fixedVenue;
    const bookingCity: CityId = this.opts.city ?? "nyc";
    const bookingTz = cityTimezone(bookingCity) ?? CITY_TZ.nyc;
    const participantPrefs = this.participantVenuePrefsOf(o.participants);
    const hasSeedPoolRedLine = (p: MemberVenuePrefs) =>
      p.halal || p.kosher || p.glutenFree || p.severeAllergen || p.vegetarian || p.vegan
      || p.wheelchairNeeded || p.lowWalking || p.lowNoiseRequired || p.daytimeOnly;
    const anyRedLines = participantPrefs.some(p =>
      p.hasRedLines && (
        bookingCity !== "nyc"
        || Boolean(this.venueRuntimeCtx.venues?.length)
        || hasSeedPoolRedLine(p.prefs)
        || this.snapshotRows().facets.get(p.prefs.memberId)?.some(f =>
          f.tags.some(t => /^(?:strict_sober|sober|no_alcohol|alcohol_free|alcohol_boundary|non_drinker|nondrinker|slop:drinking:never)$/i.test(t.trim())))
      )
    );
    const memberPrefs = participantPrefs.map(p => p.prefs);
    const venuePool = this.venuePoolForCity(bookingCity);
    const modeForOpp: "date" | "group" | "solo" | "professional" =
      this.app.id === "peon" ? "professional" : o.participants.length >= 3 ? "group" : "date";
    const excludedIds = this.venues.excludedIdsFor(o.participants);
    const prefs = this.memberVenuePrefs(o.participants);
    const useVenuePrefs = city !== "nyc" || excludedIds.size > 0 || prefs.nonDrinker || prefs.maxBudgetTier !== undefined;
    const place = (at: number) => {
      const packVenue = published?.listing ? {
        id: published.id, name: published.listing.venue, neighborhood: published.area ?? city, lat: published.listing.lat, lng: published.listing.lng,
      } : fixedVenue || o.teenRuleAt !== undefined ? undefined : this.opts.hooks?.venue?.({ ...this.hookOpp(o), meetingAt: at }, this.inputOnce());
      const teenFriendAllowed = o.teenRuleAt !== undefined;
      let validatedPackVenue = packVenue;
      let validatedFixedVenue = fixedVenue;
      if (anyRedLines) {
        if (validatedPackVenue && !published?.listing) {
          const rec = this.findVenueRecordInPool(validatedPackVenue, venuePool);
          if (!rec || !this.venueRecordPassesRedLines(rec, memberPrefs, at, bookingTz, teenFriendAllowed)) {
            validatedPackVenue = undefined;
          }
        }
        if (validatedFixedVenue) {
          const rec = this.findVenueRecordInPool(validatedFixedVenue, venuePool);
          if (!rec || !this.venueRecordPassesRedLines(rec, memberPrefs, at, bookingTz, teenFriendAllowed)) {
            validatedFixedVenue = undefined;
          }
        }
      }
      const needsRedLinePick = anyRedLines && !validatedPackVenue && !validatedFixedVenue;
      const redLinePick = needsRedLinePick
        ? this.pickVenueWithRedLinesFromPrefs(o.participants, memberPrefs, at, {
          city: bookingCity,
          venues: venuePool,
          mode: modeForOpp,
          targetHobbies: o.tags,
          teenFriendAllowed,
        })
        : undefined;
      const redLinePrimary = redLinePick?.primary && (!teenFriendAllowed || redLinePick.primary.venue.allAges === true)
        ? redLinePick.primary
        : undefined;
      if (needsRedLinePick && !redLinePrimary) {
        return undefined;
      }
      const spot: { venue: Pick<Venue, "id" | "name" | "neighborhood" | "lat" | "lng">; worst: number } = validatedPackVenue ? { venue: validatedPackVenue, worst: -1 }
        : validatedFixedVenue ? { venue: validatedFixedVenue, worst: Math.max(0, ...areas.filter((a): a is string => !!a).map(a => travelMinutesInCity(city, a, validatedFixedVenue.neighborhood) ?? 0)) }
        : redLinePrimary ? { venue: { id: redLinePrimary.venue.id, name: redLinePrimary.venue.name, neighborhood: redLinePrimary.venue.neighborhood, lat: redLinePrimary.venue.lat, lng: redLinePrimary.venue.lng }, worst: redLinePrimary.maxTravelMinutes }
        : meetingSpot(areas, o.category, o.tags, teenFriendAllowed, city, useVenuePrefs ? {
          excludeIds: excludedIds,
          nonDrinker: prefs.nonDrinker,
          ...(prefs.maxBudgetTier !== undefined ? { maxBudgetTier: prefs.maxBudgetTier } : {}),
          ...(city !== "nyc" ? { venues: this.venues.listVenues(city) } : {}),
        } : undefined);
      const backupVenueId = redLinePrimary ? redLinePick?.backup?.venue.id : undefined;
      return { packVenue: validatedPackVenue, spot, backupVenueId };
    };
    const skipped = new Set<number>();
    let chosen = t ? place(t.at) : undefined;
    while (t && chosen && o.teenRuleAt === undefined && !published && this.teenSessionNearby(chosen.spot.venue.id, t.at, o.id)) {
      skipped.add(t.at);
      t = this.meetingTime(o, now, skipped);
      chosen = t ? place(t.at) : undefined;
    }
    if (!t || !chosen) return this.closeNoCommonTime(o, o.participants[0]!);
    const clash = o.participants.find(id => this.bookedNear(id, t!.at, o.id));
    if (clash) {
      this.refuse(clash, "reveal", "booked_elsewhere");
      o.status.set(clash, "unavailable");
      this.replaceOrClose(o, clash);
      return this.maybeReveal(o);
    }
    const { packVenue, spot, backupVenueId } = chosen;
    if (o.teenRuleAt !== undefined && (!this.teenSlotAllowed(o, { start: t.at, end: t.at + teenMeetingMs }, spot.venue.id, !!packVenue || !!fixedVenue)
      || !this.teenOppAllowed(o, t.at + teenMeetingMs))) return this.closeNoCommonTime(o, o.participants[0]!);
    if (o.teenRuleAt === undefined && this.teenSessionNearby(spot.venue.id, t.at, o.id)) return this.closeNoCommonTime(o, o.participants[0]!);
    o.venueId = spot.venue.id; o.venue = spot.venue.name; o.venueArea = spot.venue.neighborhood;
    const facetsByMember = this.snapshotRows().facets;
    const backupMembers = o.participants.map(id => this.memberVenuePrefsOf(id, facetsByMember, [spot.venue.id]).prefs);
    if (backupVenueId) {
      o.backupVenueId = backupVenueId;
    } else {
      const backupPick = this.venues.pickForMatch({
        city,
        mode: o.participants.length >= 3 ? "group" : "date",
        startMs: t.at,
        memberAreas: areas.filter((a): a is string => !!a),
        members: backupMembers,
        teenFriendAllowed: o.teenRuleAt !== undefined,
        targetHobbies: o.tags,
      }, now);
      const backup = backupPick.primary?.venue.id !== spot.venue.id ? backupPick.primary?.venue : backupPick.backup?.venue;
      if (backup && backup.id !== spot.venue.id) o.backupVenueId = backup.id;
    }
    if (!published?.listing && !o.seat) {
      o.venueSuggestion = this.initTopOneSuggestionForBooked(o, spot.venue, t.at, bookingCity, venuePool, modeForOpp, o.backupVenueId);
    }
    if (packVenue && "timeZone" in packVenue) o.meetingTimeZone = packVenue.timeZone;
    o.meetingAt = t.at;
    o.followupAt = computeFollowupTimestamp(t.at + HOUR, o.meetingTimeZone ?? tz).scheduledAt;
    this.ctx.log("venue", { oppId: o.id, venueId: spot.venue.id, venue: spot.venue.name, lat: spot.venue.lat, lng: spot.venue.lng, meetingAt: o.meetingAt, worstMinutes: spot.worst, time: t.how, city });
    this.counters.oppsRevealed++; this.counters.oppsAllYes++; this.counters.scheduled++;
    if (!o.recorded) { o.recorded = true; this.ctx.recordProposal(this.toProposal(o), o.origin === "engine" ? "engine" : o.origin === "player" ? "player" : "network"); }
    o.stage = STAGE_BY_PHASE[next.phase];
    for (const id of o.participants) o.status.set(id, "yes");
    if (o.requester) {
      const r = this.requests.find(x => x.oppId === o.id && x.memberId === o.requester);
      if (r) { r.outcome = "booked"; this.ctx.log("request_result", { requestId: r.id, memberId: r.memberId, outcome: "booked", hours: Math.round((now - r.at) / HOUR) }); }
    }
    this.ctx.recordMeeting({ proposalId: o.id, participants: [...o.participants], at: o.meetingAt, city, kind: o.kind });
    const venueRec = this.venues.getVenue(spot.venue.id);
    this.meetups.registerMeetup({
      meetupId: o.id,
      app: this.app.id,
      city,
      startMs: o.meetingAt,
      participants: [...o.participants],
      confirmed: [...o.participants],
      primaryVenueId: spot.venue.id,
      ...(o.backupVenueId ? { backupVenueId: o.backupVenueId } : {}),
      venueName: spot.venue.name,
      ...(venueRec?.address ? { venueAddress: venueRec.address } : {}),
      ...(venueRec?.arrivalLandmark ? { arrivalLandmark: venueRec.arrivalLandmark } : {}),
    });
    for (const id of [...o.participants]) {
      if (o.stage === "scheduled" && o.status.get(id) === "yes") this.bookingReveal(o, id);
    }
  }

  /**
   * Work introductions (peon hiring seats, Cofounder lane, and peon professional intros) NEVER pick a
   * physical venue or in-person meeting. Channel selection goes through `selectWorkIntroChannel`:
   * WarmEmail (double opt-in default) -> ScheduledVideo (only after mutual slot confirmation) -> RelayShare.
   */
  private revealWorkIntro(o: Opp, now: number, next: OpportunityLifecycle) {
    const city = this.networkCity();
    const mgr = o.seat?.manager ?? o.participants[1] ?? o.participants[0]!;
    const cand = o.participants.find(p => p !== mgr) ?? o.participants[0]!;
    const candAge = this.youngestAgeOnRecord(this.member(cand)) ?? 0;
    const mgrAge = this.youngestAgeOnRecord(this.member(mgr)) ?? 0;
    const candOptedIn = o.status.get(cand) === "available";
    const mgrOptedIn = o.status.get(mgr) === "available";
    const candEmail = this.workIntroEmail(cand);
    const mgrEmail = this.workIntroEmail(mgr);
    const candPicks = o.picks?.[cand] ?? [];
    const mgrPicks = o.picks?.[mgr] ?? [];
    const commonVideoSlot = candPicks.length && mgrPicks.length
      ? candPicks.filter(t => mgrPicks.includes(t) && t >= now + MIN_NOTICE).sort((a, b) => a - b)[0]
      : undefined;
    const wantsVideo = o.tags.includes("video") || o.tags.includes("video_call") || commonVideoSlot !== undefined;
    const channel = selectWorkIntroChannel({
      candAge,
      mgrAge,
      candOptedIn,
      mgrOptedIn,
      candHasEmail: !!candEmail,
      mgrHasEmail: !!mgrEmail,
      mutualSlotConfirmed: commonVideoSlot !== undefined,
      wantsVideo,
    });
    if (channel === "NoChannel") {
      this.close(o, "work_intro_no_channel", { releasePartial: true });
      return;
    }
    o.venue = undefined;
    o.venueId = undefined;
    o.venueArea = undefined;
    o.backupVenueId = undefined;
    o.meetingAt = commonVideoSlot ?? (now + 7 * DAY);
    o.followupAt = now + 7 * DAY;
    const workIntro: WorkIntroState = {
      introId: o.id,
      app: this.app.id,
      candidateId: cand,
      managerId: mgr,
      candidateOptIn: candOptedIn,
      managerOptIn: mgrOptedIn,
      channel,
      ...(channel === "WarmEmail" ? { emailSentAt: now } : {}),
      ...(channel === "ScheduledVideo" && commonVideoSlot !== undefined ? { videoSlotAt: commonVideoSlot } : {}),
      followupDueAt: now + 7 * DAY,
    };
    o.workIntro = workIntro;
    if (o.seat) o.seatAcceptedAt = now;
    this.ctx.log("work_intro", {
      oppId: o.id,
      channel,
      city,
      lane: o.lane ?? null,
      seat: o.seat?.id ?? null,
      videoSlotAt: commonVideoSlot ?? null,
      followupDueAt: workIntro.followupDueAt ?? null,
    });
    this.counters.oppsRevealed++; this.counters.oppsAllYes++; this.counters.scheduled++;
    if (!o.recorded) { o.recorded = true; this.ctx.recordProposal(this.toProposal(o), o.origin === "engine" ? "engine" : o.origin === "player" ? "player" : "network"); }
    o.stage = STAGE_BY_PHASE[next.phase];
    for (const id of o.participants) o.status.set(id, "yes");
    if (o.requester) {
      const r = this.requests.find(x => x.oppId === o.id && x.memberId === o.requester);
      if (r) { r.outcome = "booked"; this.ctx.log("request_result", { requestId: r.id, memberId: r.memberId, outcome: "booked", hours: Math.round((now - r.at) / HOUR) }); }
    }
    this.ctx.recordMeeting({ proposalId: o.id, participants: [...o.participants], at: o.meetingAt, city, kind: o.kind });
    for (const id of [...o.participants]) {
      if (o.stage === "scheduled" && o.status.get(id) === "yes") this.workIntroReveal(o, id);
    }
  }

  private workIntroReveal(o: Opp, id: MemberId) {
    const m = this.member(id);
    const going = o.participants.filter(seat => o.status.get(seat) === "yes");
    const otherId = going.find(seat => seat !== id);
    const otherDisplay = otherId ? this.member(otherId).display : "them";
    const channel = o.workIntro?.channel ?? "RelayShare";
    const tz = this.memberZone(id);
    const when = o.workIntro?.videoSlotAt !== undefined ? whenPhrase(o.workIntro.videoSlotAt, tz) : "";
    let text: string;
    if (o.seat) {
      const job = { title: this.seatTitle(o.seat.id), must: [] };
      const isManager = id === o.seat.manager;
      if (channel === "WarmEmail") {
        text = isManager ? SEAT_COPY.warmEmailManagerIntro(job, otherDisplay) : SEAT_COPY.warmEmailCandidateIntro(job, otherDisplay);
      } else if (channel === "ScheduledVideo" && when) {
        text = SEAT_COPY.videoSlotIntro(job, otherDisplay, when);
      } else {
        text = this.opts.hooks?.booked?.(this.hookOpp(o), id, { others: [otherDisplay], where: "", when: "" })
          ?? (isManager ? SEAT_COPY.managerIntro(job, otherDisplay) : SEAT_COPY.candidateIntro(job, otherDisplay));
      }
    } else if (o.lane === "Cofounder") {
      if (channel === "WarmEmail") {
        text = SEAT_COPY.cofounderWarmEmailIntro(otherDisplay);
      } else if (channel === "ScheduledVideo" && when) {
        text = SEAT_COPY.cofounderVideoSlotIntro(otherDisplay, when);
      } else {
        text = SEAT_COPY.cofounderRelayIntro(otherDisplay);
      }
    } else if (channel === "WarmEmail") {
      text = SEAT_COPY.workWarmEmailIntro(otherDisplay);
    } else if (channel === "ScheduledVideo" && when) {
      text = SEAT_COPY.workVideoSlotIntro(otherDisplay, when);
    } else {
      text = SEAT_COPY.workRelayIntro(otherDisplay);
    }
    const fallback = o.lane === "Cofounder" ? SEAT_COPY.cofounderRelayIntro(otherDisplay) : SEAT_COPY.workRelayIntro(otherDisplay);
    const proactive = !this.opts.probes && !o.primed.has(id);
    this.send(m, text, {
      type: "proposal", proposalId: o.id, participants: going,
      ...(o.workIntro?.videoSlotAt !== undefined ? { meetingAt: o.workIntro.videoSlotAt } : {}),
      ...(o.seat ? { booked: { proposalId: o.id, at: o.meetingAt ?? this.now(), optOutHours: OPT_OUT_HOURS } } : {}),
      proactive,
    }, "reveal", { about: going, fallback, hook: { t: "reveal", oppId: o.id, id } });
  }

  private workIntroEmail(id: MemberId): string | undefined {
    const fromOpt = this.opts.workIntroEmailOf?.(id)?.trim();
    if (fromOpt) return fromOpt;
    const rows = this.snapshotRows();
    const facet = (rows.facets.get(id) ?? []).find(f => f.tags.some(t => t === "work:email" || t === "email"));
    return facet?.value?.includes("@") ? facet.value.trim() : undefined;
  }

  private bookingReveal(o: Opp, id: MemberId) {
    if (o.workIntro) return this.workIntroReveal(o, id);
    if (o.meetingAt === undefined) return;
    const m = this.member(id);
    const going = o.participants.filter(seat => o.status.get(seat) === "yes");
    const others = going.filter(seat => seat !== id).map(seat => this.member(seat).display);
    const unchangedRoster = going.length === o.participants.length;
    const venueRec = o.venueId ? this.venues.getVenue(o.venueId) : undefined;
    const whereBase = `${o.venue} (${o.venueArea})`;
    const where = venueRec?.arrivalLandmark ? `${whereBase} — ${venueRec.arrivalLandmark}` : whereBase;
    const when = whenPhrase(o.meetingAt, o.meetingTimeZone ?? this.cityTz());
    const { text: baseText, fallback: baseFallback } = this.revealCopy(o, id, others, where, when, unchangedRoster);
    const effStrikes = reliabilityEffectiveStrikes(m.strikes ?? 0, m.completedSinceNoShow);
    const relTier = reliabilityTier(effStrikes, !!m.provisionalNoShow);
    const confirmSuffix = confirmBeforeCommitRequired(relTier) ? ` ${this.copy.confirmBeforeCommit(when, whereBase)}` : "";
    const text = baseText + confirmSuffix;
    const fallback = baseFallback + confirmSuffix;
    const proactive = !this.opts.probes && !o.primed.has(id);
    const curatedLink = proactive ? undefined : venueBookingLink(o, id, true, this.now(), this.networkCity());
    const link = this.currentPublishedEvent(o)?.listing?.url ?? curatedLink;
    const source = link ? `\n${link}` : "";
    this.send(m, text + source, {
      type: "proposal", proposalId: o.id, participants: going, meetingAt: o.meetingAt,
      booked: { proposalId: o.id, at: o.meetingAt, optOutHours: OPT_OUT_HOURS }, proactive,
    }, "reveal", { about: going, fallback: fallback + source,
      hook: { t: "reveal", oppId: o.id, id }, ...(curatedLink && o.venueId ? { key: venueBookingNoticeKey(o.id, id, o.venueId) } : {}) });
  }

  private revealCopy(o: Opp, id: MemberId, others: string[], where: string, when: string, unchangedRoster = true): { text: string; fallback: string } {
    const m = this.member(id);
    const priorCompleted = m.completedSinceNoShow > 0 || this.interactions.some(x => x.participants.includes(id) && x.outcome === "completed");
    const offer = !m.offerMade && !m.minor && priorCompleted;
    const why = capitalize((unchangedRoster ? o.explanations[id] : undefined) ?? GOOD_FIT);
    const text = (unchangedRoster && o.teenRuleAt === undefined ? this.opts.hooks?.booked?.(this.hookOpp(o), id, { others, where, when }) : undefined) ?? copy.booked(others, why, where, when, offer);
    return { text, fallback: copy.booked(others, capitalize(GOOD_FIT), where, when, offer) };
  }

  /**
   * The meeting time: the earliest slot every member who answered with times picked (at least 6 hours
   * out, never a time anyone turned down), else the best joint slot for everyone from what the
   * Network knows (attention.chooseTimeOptions), else the old default (a weekend late morning for
   * activities, a weeknight at 7pm otherwise). Undefined when members named times and none is common:
   * the plan is never set at a time nobody picked.
   */
  private meetingTime(o: Opp, now: number, skipped: ReadonlySet<number> = new Set()): { at: number; how: "picked" | "partly_picked" | "estimated" | "default" } | undefined {
    const picks = Object.entries(o.picks ?? {}).filter(([id]) => o.participants.includes(id)).map(([, xs]) => xs);
    const named = picks.filter(xs => xs.length);
    const declined = new Set([...(o.declinedTimes ?? []), ...skipped]);
    const evidence = o.participants.map(id => this.evidence(this.member(id), now));
    const offered = Object.values(o.offered ?? {}).flat();
    const slotFor = (start: number) => offered.find(slot => slot.start === start) ?? { start, end: start + DEFAULT_ATTENTION.availability.slotHours * HOUR };
    const calendarAllows = (slot: attention.TimeSlot) => evidence.every(ev => attention.calendarAvailability(ev.calendar, slot, now) !== "busy")
      && this.teenSlotAllowed(o, { start: slot.start, end: slot.start + teenMeetingMs });
    if (named.length) {
      const all = named.reduce((acc, xs) => acc.filter(t => xs.includes(t))).filter(t => t >= now + MIN_NOTICE && !declined.has(t) && calendarAllows(slotFor(t))).sort((a, b) => a - b);
      if (all.length && named.length === picks.length) return { at: all[0]!, how: "picked" };
      // "partly": someone said none of their times worked. The time comes from the others' picks: the
      // one the Network's evidence says suits them best (their turned-down times count against a daypart).
      if (all.length) {
        const unsure = evidence.filter(ev => o.picks?.[ev.memberId] && !o.picks[ev.memberId]!.length);
        const score = (t: number) => unsure.reduce((x, ev) => x * attention.availabilityProb(ev, slotFor(t), now), 1);
        const best = [...all].sort((a, b) => (score(b) - score(a)) || (a - b))[0]!;
        return { at: best, how: "partly_picked" };
      }
      return undefined;
    }
    const tz = this.cityTz();
    const candidates = attention.candidateSlots(tz, now).filter(x => !declined.has(x.start) && this.teenSlotAllowed(o, { start: x.start, end: x.start + teenMeetingMs }));
    const r = attention.chooseTimeOptions(evidence, now, { tz, candidates });
    const best = [...r.slots].filter(x => x.slot.start >= now + MIN_NOTICE).sort((a, b) => (b.joint - a.joint) || (a.slot.start - b.slot.start))[0];
    if (best) return { at: best.slot.start, how: "estimated" };
    const fallback = this.slot(o, now);
    return !skipped.has(fallback) && calendarAllows(slotFor(fallback)) ? { at: fallback, how: "default" } : undefined;
  }

  /** A slot at least ~20 hours out: Saturday late morning for activities, otherwise a weeknight at 7pm. */
  private slot(o: Opp, now: number): number {
    const outdoorsy = o.category === "hobby" || o.category === "events" || o.tags.some(t => ["running", "hiking", "cycling", "tennis", "climbing", "photography"].includes(t));
    const from = now + 20 * HOUR;
    const tz = this.cityTz();
    return outdoorsy ? nextAt(from, 11, wd => wd === "Sat" || wd === "Sun", tz) : nextAt(from, 19, wd => !["Fri", "Sat", "Sun"].includes(wd), tz);
  }

  /**
   * A participant drops out of a booked meeting. `ack` = they told us (reply to them). The others
   * hear it is off (pairs) or still on (groups of 3 or more), never why.
   */
  private handleDrop(m: MemberState, o: Opp, ack = true, explicitWithdrawal = false, minorClose = false) {
    if (o.stage !== "scheduled" || o.status.get(m.id) !== "yes") return;
    const now = this.now();
    const acceptedAndTold = o.bookedAt?.[m.id] !== undefined && o.bookedTold?.includes(m.id) === true;
    if (!minorClose && o.bookedTold?.includes(m.id) && !(o.confirmed ?? []).includes(m.id)) this.counters.revealNo++;
    o.status.set(m.id, "dropped");
    this.meetups.removeMember(m.id, o.id);
    this.counters.bookedCancelled++;
    // The member called it off (they told us, or opted out): plan_cancelled. Free with notice (NC flake rules).
    if (o.bookedAt?.[m.id] !== undefined && (ack || m.optedOut)) this.emit({ type: "plan_cancelled", member: m.id, planId: o.id }, `${o.id}:${m.id}`);
    if (!minorClose && o.meetingAt !== undefined && o.meetingAt > now && acceptedAndTold) {
      const leadMs = o.meetingAt - now;
      if (leadMs < 4 * HOUR) {
        m.lateCancels4h = (m.lateCancels4h ?? 0) + 1;
        m.strikes = (m.strikes ?? 0) + lateCancel4hStrikes;
        m.completedSinceNoShow = 0;
      } else if (leadMs < 24 * HOUR) {
        m.lateCancels24h = (m.lateCancels24h ?? 0) + 1;
        m.strikes = (m.strikes ?? 0) + lateCancel24hStrikes;
      }
    }
    if (o.planRun) o.planRun = { ...o.planRun, answers: { ...o.planRun.answers, [m.id]: "no" } };
    this.ctx.log("booked_cancelled", { oppId: o.id, memberId: m.id, told: ack });
    if (bookingWithdrawalAcknowledgmentAllowed(ack, m.bookingWithdrawalAckAt !== undefined, now - (m.bookingWithdrawalAckAt ?? now))) {
      const sent = this.send(m, "No worries, thanks for the heads up.", { type: "info" }, "reply");
      if (sent === "sent") m.bookingWithdrawalAckAt = now;
    }
    if (m.awaiting?.oppId === o.id) m.awaiting = undefined;
    const still = [...new Set(o.participants)].filter(p => o.status.get(p) === "yes");
    // spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person"
    const keep = bookedGroupCanContinue(still.length, minorClose);
    if (!keep) {
      if (!this.closeBooking(o, minorClose ? "minors policy" : "participant dropped", minorClose)) return;
      const booked = still.filter(id => o.bookedAt?.[id] !== undefined && o.bookedTold?.includes(id));
      let replaced = false;
      // spec/bookedGroupReplacement.md, "An accepted withdrawal can start recovery after the old booking closes"
      if (canTryGroupReplacement({
        ownWithdrawal: explicitWithdrawal && ack && this.memberReply && this.replyTo === m.id,
        future: o.meetingAt !== undefined && now < o.meetingAt,
        originalOrdinaryPlan: o.origin === "planner" && o.kind === "group" && !!o.plan && !o.plan.partner && o.planRun?.stage === "booked"
          && !o.replacementFor && !o.plan.crewId && !o.plan.hostId && !o.plan.eventId && !o.publicEventRevision && !o.seat,
        approved: reviewApproved(o.review),
        acceptedAndTold, remainingBooked: booked.length, quorum: o.plan?.quorum ?? 0,
      })) replaced = this.offerGroupReplacement(o, booked, now);
      if (!replaced && !minorClose && still.length === 2 && o.participants.length >= 3 && !o.pivotFromGroup) {
        this.offerTwoPersonGroupPivot(o, still as [MemberId, MemberId], now);
      }
      return;
    }
    // Only members who were told about the plan hear that it changed.
    for (const id of still) if (o.bookedTold?.includes(id)) this.send(this.member(id), copy.dropNotice(m.first, true), { type: "cancellation", proposalId: o.id }, "cancellation",
      { hook: { t: "drop_notice", oppId: o.id, meetingAt: o.meetingAt } });
  }

  private closeBooking(o: Opp, reason: string, minorClose: boolean): boolean {
    const next = stepOpportunity(opportunityLifecycle(o), { type: "close" });
    if (next.phase !== "Closed") return false;
    const now = this.now();
    const still = [...new Set(o.participants)].filter(p => o.status.get(p) === "yes");
    this.expireReveals(o);
    o.closedFrom = o.stage;
    o.closedReason = reason;
    o.stage = STAGE_BY_PHASE[next.phase];
    // spec/opportunityLifecycle.md, "A closed booking releases its pending replies"
    for (const id of o.participants) {
      const participant = this.members.get(id);
      if (participant?.awaiting?.oppId === o.id) participant.awaiting = undefined;
    }
    this.ctx.log("opportunity_closed", { proposalId: o.id, reason });
    for (const id of still) {
      const member = this.members.get(id);
      if (!minorClose || o.bookedTold?.includes(id)) this.sendBookedCancellation(o, id, copy.dropNotice("", false), minorClose);
      else if (member && (o.meetingAt ?? now) > now) this.send(member, copy.dropNotice("", false), { type: "cancellation", proposalId: o.id }, "cancellation",
        { key: `${bookedCancellationPrefix}${o.id}:${id}`, minorClose });
    }
    return true;
  }

  private sendBookedCancellation(o: Opp, id: MemberId, text: string, minorClose = false) {
    const member = this.members.get(id);
    const now = this.now();
    // spec/outboundAdmission.md, "A cancelled booking can notify a participant who received the booked plan"
    if (!member || !bookedCancellationAllowed(o.stage === "closed" && o.closedFrom === "scheduled", o.status.get(id) === "yes",
      o.bookedTold?.includes(id) === true, (o.meetingAt ?? now) - now)) return;
    this.send(member, text, { type: "cancellation", proposalId: o.id }, "cancellation",
      { key: `${bookedCancellationPrefix}${o.id}:${id}`, hook: { t: "drop_notice", oppId: o.id, meetingAt: o.meetingAt }, ...(minorClose ? { minorClose } : {}) });
  }

  /** Members the booked plan reached who neither confirmed nor dropped before it closed: an expired reveal. */
  private expireReveals(o: Opp) {
    for (const id of o.bookedTold ?? []) if (o.status.get(id) === "yes" && !(o.confirmed ?? []).includes(id)) this.counters.revealExpired++;
  }

  private close(o: Opp, reason: string, { releasePartial = false, closedBy, released, minorClose = false }: { releasePartial?: boolean; closedBy?: MemberId; released?: { sent: number }; minorClose?: boolean } = {}) {
    const current = opportunityLifecycle(o);
    const next = stepOpportunity(current, { type: "close" });
    if (next === current) return;
    if (o.stage === "scheduled") this.expireReveals(o);
    o.closedFrom = o.stage; o.closedReason = reason;
    const wasReview = o.stage === "review";
    const wasProbing = o.stage === "probing" || wasReview;
    if (o.stage === "probing") this.counters.oppsNotAvailable++;
    o.stage = STAGE_BY_PHASE[next.phase];
    const systemProposal = !o.requester && !o.plan && o.origin !== "request" && o.origin !== "plans";
    const minorSend = minorClose ? { minorClose: true as const } : {};
    const told = new Set<MemberId>();
    for (const id of o.participants) {
      const m = this.members.get(id);
      if (!m) continue;
      this.endWaitingProbe(o, m, false);
      if (m.awaiting?.oppId === o.id) m.awaiting = undefined;
      const status = o.status.get(id);
      const askedAgain = !!o.askedAgain?.includes(id);
      const accepted = (status === "available" && o.primed.has(id)) || askedAgain;
      const releases = closedBy !== undefined
        ? releasesOnRequesterClose(current, o.contacted.has(id) || askedAgain, accepted, id === closedBy)
        : releasesPartialAcceptance(current, releasePartial, systemProposal, o.contacted.has(id) || askedAgain, accepted);
      if (releases) {
        const sent = this.send(m, copy.declinedQuiet, { type: "cancellation", proposalId: o.id }, "cancellation", { key: `opportunity-release:${o.id}:${id}`, ...minorSend });
        if (released && sent !== "refused") released.sent++;
      } else if (!wasProbing && status === "yes" && reason !== "blocked" && reason !== "panic_exit") {
        this.send(m, copy.declinedQuiet, { type: "info", proposalId: o.id }, "cancellation", minorSend);
        told.add(id);
      } else if (minorClose && minorCloseTellsAcceptor(current, o.contacted.has(id), status === "available", m.minor, o.requester === id)) {
        this.send(m, copy.declinedQuiet, { type: "cancellation", proposalId: o.id }, "cancellation", { key: `opportunity-release:${o.id}:${id}`, ...minorSend });
      }
    }
    if (o.requester) {
      const r = this.requests.find(x => x.oppId === o.id && x.memberId === o.requester);
      if (r && r.outcome === "probing") {
        r.oppId = undefined;
        this.ctx.log("request_result", { requestId: r.id, memberId: r.memberId, outcome: "waiting", reason });
        const req = this.members.get(r.memberId);
        const tell = req && !req.optedOut && this.trust.ok(req.id)
          && requesterHearsOpportunityClose(!!r.withdrawn, reason === "requester unavailable", o.status.get(req.id) === "no");
        if (!o.retry) { if (tell) this.tellNoneYet(req!, r); else r.outcome = "none"; }
        else {
          r.outcome = "none";
          if (tell && !r.toldRetryNone && !told.has(req!.id)) { r.toldRetryNone = true; this.send(req!, copy.declinedQuiet, { type: "info" }, "info"); }
        }
      }
    }
    // A review rejection or expiry is not something the members did: no interaction record.
    if (!wasReview) {
      const hireReplies = o.seat && wasProbing ? o.seatProbeReplies : undefined;
      const recorded = hireReplies && o.participants.map(id => ({ id, reply: hireClosedProbeReply(hireReplies[id] ?? "") }));
      const acceptedBy = recorded?.filter(x => x.reply === "HireProbeAccepted").map(x => x.id);
      const declinedBy = recorded?.filter(x => x.reply === "HireProbeDeclined").map(x => x.id)
        ?? o.participants.filter(id => o.status.get(id) === "no");
      const declined = hireProbeWasDeclined(reason === "declined", recorded !== undefined && declinedBy.length > 0);
      this.interactions.push({ id: o.id, kind: o.kind, category: o.category, participants: [...o.participants], at: this.now(),
        outcome: declined ? "declined" : wasProbing ? "expired" : "cancelled", declinedBy, ...(acceptedBy?.length ? { acceptedBy } : {}) });
    }
    this.ctx.log(wasProbing ? "probe_closed" : "opportunity_closed", {
      proposalId: o.id, reason: wasProbing ? `not sent: ${reason}` : reason,
      ...(wasProbing ? { alternates: [...o.alternates] } : {}),
    });
  }

  // spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person"
  private timeAndPlaceChain(o: Opp | undefined): Opp[] {
    const chain: Opp[] = [];
    for (let at = o; at && !chain.includes(at);) {
      chain.push(at);
      const source = at.replacementFor ?? at.fallbackOf ?? at.plan?.repeatOf;
      at = source === undefined ? undefined : this.opps.get(source);
    }
    return chain;
  }

  // spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person"
  private minorKnows(id: MemberId): (o: Opp) => boolean {
    const crews = new Set(this.crews.filter(c => this.knowsCrew(id, c)).map(c => c.id));
    return o => this.timeAndPlaceChain(o).some(s => s.contacted.has(id)) || (!!o.plan?.crewId && crews.has(o.plan.crewId));
  }

  private crewSource(crewId: string): Opp | undefined {
    const offer = this.crewOffers.find(c => c.crew.id === crewId);
    return offer ? this.opps.get(offer.planId) : undefined;
  }

  private knowsCrew(id: MemberId, crew: plans.Crew, source = this.crewSource(crew.id)): boolean {
    return crew.members.includes(id) || this.timeAndPlaceChain(source).some(s => s.contacted.has(id));
  }

  // spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows"
  private recurrenceOk(source: Opp | undefined, roster: readonly MemberId[]): boolean {
    const chain = this.timeAndPlaceChain(source);
    const asked = [...new Set([...roster, ...chain.flatMap(s => [...s.contacted])])];
    return recurrenceAllowed(asked, asked.filter(id => this.knownMinor(id)), chain.some(s => s.minorKnew));
  }

  /** Remove a member from everything open (opt-out, hold, minor signal, decline). */
  private dropMember(id: MemberId, reason: string) {
    const member = this.members.get(id);
    if (member) member.pendingInviteDraft = undefined;
    this.memberStanding = this.memberStanding.filter(row => {
      if (row.memberId === id) return false;
      const seat = isSeatId(row.memberId) && this.record(row.memberId);
      return !seat || seatOwnerOf(seat) !== id;
    });
    const minor = reason === "minors policy";
    const told = this.minorKnows(id);
    if (minor) {
      // spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows"
      for (const o of this.opps.values()) if (told(o)) o.minorKnew = true;
      // spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person"
      const involved = new Set([...this.opps.values()].filter(o => o.participants.includes(id) || o.alternates.includes(id) || told(o)).map(o => o.id));
      const queued = this.deferred.filter(d => involved.has(d.meta.proposalId ?? (d.o.hook && "oppId" in d.o.hook ? d.o.hook.oppId : "")));
      this.deferred = this.deferred.filter(d => !queued.includes(d));
      for (const d of queued) {
        const m = this.members.get(d.memberId);
        const valid = m && this.hookFns(m, d.o.hook).valid;
        if (m && d.kind === "cancellation" && (!valid || valid())) this.send(m, d.body, d.meta, d.kind, { ...d.o, minorClose: true });
      }
    }
    for (const o of this.opps.values()) {
      if (!OPEN_STAGES.has(o.stage)) continue;
      const participant = o.participants.includes(id);
      // A probe already sent counts even when the person declined or was replaced before the age signal.
      const closeForMinor = closesForMinor(opportunityLifecycle(o), minor, participant, o.alternates.includes(id), told(o));
      // Anyone dropped (minor signal, opt-out, hold) leaves every open alternate list.
      o.alternates = o.alternates.filter(x => x !== id);
      if (closeForMinor) {
        if (o.stage === "scheduled" && member && o.status.get(id) === "yes") this.handleDrop(member, o, false, false, true);
        else if (o.stage === "scheduled") this.closeBooking(o, reason, true);
        else this.close(o, reason, { minorClose: minor });
        continue;
      }
      if (!participant) continue;
      if (o.stage === "review") this.close(o, reason, { minorClose: minor });
      else if (o.stage === "probing" && o.plan) this.planOut(o, id);
      else if (o.stage === "probing") { o.status.set(id, "unavailable"); this.replaceOrClose(o, id); }
      else if (o.stage === "scheduled") {
        if (member && o.status.get(id) === "yes") this.handleDrop(member, o, false);
        else if (activeOpportunityParticipant(o, id)) {
          if (member?.awaiting?.oppId === o.id) member.awaiting = undefined;
          if (o.plan) this.planOut(o, id);
          else o.status.set(id, "unavailable");
        }
      }
    }
    if (!minor) return;
    // spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows"
    for (const crew of this.crews.filter(c => !this.recurrenceOk(this.crewSource(c.id), c.members))) {
      this.crews.splice(this.crews.indexOf(crew), 1);
      this.ctx.log("crew_ended", { crewId: crew.id, reason });
    }
    for (const offer of this.crewOffers) if (!offer.resolved && !this.recurrenceOk(this.opps.get(offer.planId), offer.crew.members)) this.resolveCrew(offer);
  }

  // ================================================================== feedback & growth
  private feedbackCandidate(id: MemberId, o: Opp, now: number): boolean {
    if (o.workIntro) {
      const anchor = o.workIntro.followupDueAt ?? o.meetingAt ?? 0;
      return o.stage === "done" && o.status.get(id) === "yes" && !o.feedbackFrom.has(id) && now >= anchor && now - anchor < 14 * DAY;
    }
    return o.meetingAt !== undefined && meetingFeedbackCandidate(o.stage === "done", o.status.get(id) === "yes", o.feedbackFrom.has(id), now - o.meetingAt);
  }

  private feedbackDue(m: MemberState, now: number): Opp | undefined {
    let latest: Opp | undefined;
    let latestStart = -Infinity;
    for (const opportunity of this.opps.values()) {
      const start = opportunity.meetingAt;
      if (start === undefined || start < latestStart || !this.feedbackCandidate(m.id, opportunity, now)) continue;
      latest = opportunity;
      latestStart = start;
    }
    return latest;
  }

  private feedbackReceiptAt(o: Opp, id: MemberId): number | undefined {
    if (!this.ctx.initialInviteReceipt) return o.feedbackPromptedAt?.[id];
    const receipt = this.ctx.initialInviteReceipt(meetingFeedbackKey(o.id, id, o.scheduleRevision));
    return receipt?.kind === "accepted" ? receipt.at : undefined;
  }

  private explicitlyConfirmsAttendance(body: string, pair: boolean): boolean {
    return (body.match(/[^.!?]+[.!?]?/g) ?? []).some(part => {
      const clause = part.trim().replace(/[.!]$/, "").replace(/^yes,?\s+/i, "");
      if (/^(?:(?:everyone|we all|all of us) (?:came|made it|showed up|met(?: up)?)|everyone was there|(?:we all|all of us) were there)$/i.test(clause)) return true;
      return pair && /^(?:we(?: both)?|both of us) (?:came|made it|showed up|met(?: up)?|were there)$/i.test(clause);
    });
  }

  private bookedMeeting(o: Opp): InteractionRecord["bookedMeeting"] {
    if (o.meetingAt === undefined) return null;
    return { at: o.meetingAt, timeZone: o.meetingTimeZone ?? (o.plan ? CITY_TZ[o.plan.city] : this.cityTz()) };
  }

  private restoreFeedbackInteraction(record: InteractionRecord): InteractionRecord {
    const slop = this.app.id === "slop", group = record.kind === "group";
    if ((!slop && !group) || (record.outcome !== "completed" && record.outcome !== "no_show")) return record;
    const marker = record.id.lastIndexOf(":fb:");
    if (marker < 0) return record;
    const opportunity = this.opps.get(record.id.slice(0, marker));
    const author = record.id.slice(marker + 4);
    const ownReply = opportunity?.stage === "done" && (record.opportunityId === undefined || record.opportunityId === opportunity.id)
      && opportunity.feedbackFrom.has(author) && opportunity.participants.includes(author) && record.participants.includes(author)
      && feedbackHistorySeat(opportunity.status.get(author) ?? "");
    return {
      ...record,
      ...(group && ownReply && opportunity.kind === "group" ? {
        participants: record.participants.filter(id => opportunity.participants.includes(id)
          && feedbackHistorySeat(opportunity.status.get(id) ?? "")),
      } : {}),
      ...(slop && ownReply && record.opportunityId === undefined ? { opportunityId: opportunity.id } : {}),
      ...(slop && record.outcome === "completed" && record.bookedMeeting === undefined
        ? { bookedMeeting: ownReply ? this.bookedMeeting(opportunity) : null } : {}),
      ...(slop && record.outcome === "no_show" && record.noShowBy === undefined && ownReply
        && opportunity.post?.[author]?.came === false ? { noShowBy: [author] } : {}),
    };
  }

  private onFeedback(m: MemberState, o: Opp, body: string, f: ReturnType<typeof feedbackOf>, attendanceOpen: boolean) {
    o.feedbackFrom.add(m.id);
    const now = this.now();
    this.ctx.log("feedback", {
      memberId: m.id, proposalId: o.id, sentiment: f.sentiment, selfNoShow: f.selfNoShow, otherNoShow: f.otherNoShow, again: f.again,
      ...(f.notInterested ? { notInterested: true } : {}),
      ...(f.venue ? { venueSentiment: f.venue.venueSentiment, venueClosed: f.venue.venueClosed, venueIssues: f.venue.venueIssues } : {}),
    });
    if (o.venueId && !o.workIntro) {
      if (f.venue && (f.venue.venueClosed || f.venue.venueIssues.length > 0 || f.venue.notInterested || (f.venue.venueSentiment && f.venue.venueSentiment !== "neutral"))) {
        this.venues.recordFeedback(o.venueId, m.id, [], f.venue, now);
      } else if (!f.selfNoShow) {
        this.venues.recordVisit(m.id, o.venueId);
      }
    }
    if (f.venue?.mentionedVenue) {
      this.venues.recordOrganicMention(this.networkCity(), f.venue.mentionedVenue, m.area ?? o.venueArea ?? "", now);
    }
    const going = o.participants.filter(id => feedbackHistorySeat(o.status.get(id) ?? ""));
    const others = going.filter(id => id !== m.id);
    const counterpart = !o.plan && o.kind !== "group" && others.length === 1 ? this.member(others[0]!) : undefined;
    const counterpartAbsence = pairedFeedbackAbsence(attendanceOpen, !!counterpart,
      counterpart ? directFeedbackAbsence(body, [counterpart.first, counterpart.display]) : false);
    const missing = attendanceOpen && others.length > 1 ? groupFeedbackAbsence(body, others.map(id => {
      const candidate = this.member(id);
      return { id, names: [candidate.first, candidate.display] };
    })) : [];
    const otherMissing = f.otherNoShow || counterpartAbsence || NOBODY_CAME.test(body) || missing.length > 0;
    const named = otherMissing ? missing : others.filter(id => this.namedIn(body, id));
    const post = { came: !f.selfNoShow, again: f.again, otherNoShow: otherMissing, named, missing };
    const crewId = attendanceOpen && o.plan ? this.planPost(m, o, body, post) : undefined;
    if (attendanceOpen) {
      if (!o.plan) o.post = { ...o.post, [m.id]: post };
      const own = o.post?.[m.id];
      if (own?.came && !otherMissing) {
        if (f.sentiment === "positive" || own.again) own.worthwhile = true;
        if (this.explicitlyConfirmsAttendance(body, others.length === 1)) own.confirmedRoster = true;
        if (this.app.id === "friends" && o.plan && own.again) own.repeatProof = { revision: o.scheduleRevision ?? 0 };
      }
      if (!counterpartAbsence) this.helpFeedback(m, o, f);
      if (f.selfNoShow) {
        if (!o.noShowCounted?.includes(m.id)) {
          const hadNoShow = m.noShows > 0 || (m.strikes ?? 0) > 0;
          m.noShows++;
          m.strikes = (m.strikes ?? 0) + (hadNoShow ? repeatNoShowStrikes : firstNoShowStrikes);
        }
        m.completedSinceNoShow = 0;
      } else {
        m.completedSinceNoShow++;
        if (m.provisionalNoShow && m.completedSinceNoShow >= 2) m.provisionalNoShow = false;
      }
      this.interactions.push({
        id: `${o.id}:fb:${m.id}`, kind: o.kind, category: o.category, participants: going,
        at: this.now(), outcome: f.selfNoShow ? "no_show" : "completed", contributors: [],
        ...(this.app.id === "slop" ? {
          opportunityId: o.id,
          ...(f.selfNoShow ? { noShowBy: [m.id] } : { bookedMeeting: this.bookedMeeting(o) }),
        } : {}),
      });
    }
    const repeatConsent = !o.plan && !o.seat && o.participants.length === 2 && recordsRepeatConsent(
      deliveredInvitee(o.status.get(m.id) === "yes", o.bookedAt?.[m.id] !== undefined),
      explicitRepeatRequest(body), f.sentiment === "negative", f.selfNoShow || otherMissing,
    );
    const cue = checkInReport(body) ?? (f.otherNoShow ? "no_show" : undefined);
    const subject = !o.plan && others.length === 1 ? this.members.get(others[0]!) : undefined;
    const safety = checkInSafetyStep(checkInReading(cue !== undefined, cue !== undefined && URGENT_REPORTS.has(cue), checkInConcern(body)),
      !!o.plan, !!subject && !this.notKnownAdult(m) && !this.notKnownAdult(subject),
      !!subject && this.teenFeedbackAllowed(o, [m.id, subject.id]));
    let shouldAckFeedback = false;
    if (safety === "CheckInFileNow" && cue) {
      for (const other of others) this.recordMeetingSafetyReport(m.id, o, other, cue);
      this.send(m, copy.reported(), { type: "info" }, "reply");
    } else if (safety === "CheckInAsk" && subject) {
      this.askCheckInSafety(m, o, subject, cue ?? "other");
    } else if (crewId) {
      const a = plans.activityById.get(o.plan!.activityId)!;
      this.send(m, `${copy.feedbackThanks} ${copy.crewOffer(a.label)}`, { type: "crew_offer", crew: { crewId, activity: a.id } }, "reply", { about: others, hook: { t: "crew_offer", crewId } });
    } else shouldAckFeedback = true;
    for (const other of others) {
      this.feedback.push({ id: `fb${this.feedback.length + 1}`, from: m.id, about: other, opportunityId: o.id, at: this.now(), sentiment: f.sentiment, wouldMeetAgain: f.again, ...(repeatConsent ? { repeatConsent: true } : {}) });
      const k = pairKey(m.id, other);
      if (f.sentiment === "negative" && !f.otherNoShow) {
        this.avoid.add(k);
        this.planAgain.delete(k);
      }
      if (f.sentiment === "positive" && o.requester === m.id && o.origin === "request") {
        const r = this.requests.find(x => x.oppId === o.id);
        const def = r?.desireId ? desireById.get(r.desireId) : undefined;
        for (const sk of def?.needsSkills ?? []) if (this.knownProfiles().get(other)?.skills.has(sk)) {
          if (!this.vouchedSkills.has(other)) this.vouchedSkills.set(other, new Set());
          this.vouchedSkills.get(other)!.add(sk); this.dirty = true;
        }
      }
    }
    if (attendanceOpen && !crewId && safety === "CheckInNoStep" && this.invitesWork && f.sentiment === "positive" && this.canInvite(m) && this.now() - m.lastGrowthAsk > 30 * DAY) {
      m.lastGrowthAsk = this.now();
      this.growthAsk(m, this.copy.growthAsk, "after_good_meeting");
    }
    if (shouldAckFeedback) this.ack(m, copy.feedbackThanks, { direct: true });
  }

  private askCheckInSafety(m: MemberState, o: Opp, subject: MemberState, kind: ReportKind) {
    const asked = this.send(m, copy.checkInSafetyAsk(o.teenRuleAt !== undefined ? "them" : subject.first), { type: "question" }, "reply", { about: [subject.id] });
    if (asked === "refused") return this.ack(m, copy.feedbackThanks);
    m.pendingSafety = { verb: "check_in", kind, at: this.now(), targets: [subject.id], oppId: o.id };
    this.ctx.log("check_in_safety_asked", { memberId: m.id, oppId: o.id, target: subject.id });
  }

  private answerCheckInSafety(m: MemberState, p: PendingCheckInSafety, c: Classified, body: string, receivedAt: number): boolean {
    const now = this.now();
    const subject = this.members.get(p.targets[0]);
    const opp = this.opps.get(p.oppId);
    if (!checkInSafetyAnswerCurrent(p.at, receivedAt, now) || !subject || !opp) {
      m.pendingSafety = undefined;
      this.ctx.log("check_in_safety_lapsed", { memberId: m.id, oppId: p.oppId });
      return false;
    }
    const choice = checkInSafetyChoice(body);
    const other = m.awaiting?.kind;
    if (!checkInSafetyAnswerApplies(choice.namesChoice, other === "probe" || other === "booked" || other === "crew" || other === "checkin")) return false;
    m.pendingSafety = undefined;
    const target = c.kind === "block" || c.kind === "report" ? c.target?.trim() : undefined;
    if (target && !PRONOUN_TARGET.test(target) && !CHECK_IN_ANSWER_TARGET.test(target) && this.resolveTarget(m, target).target?.id !== subject.id) return false;
    const answer = checkInSafetyAnswer(choice.report, choice.block, choice.declines);
    this.ctx.log("check_in_safety_answer", { memberId: m.id, oppId: opp.id, answer });
    switch (answer) {
      case "AnswerReport":
        this.recordMeetingSafetyReport(m.id, opp, subject.id, p.kind);
        this.send(m, copy.reported(), { type: "info" }, "reply");
        return true;
      case "AnswerBlock":
        this.applyBlock(m, "block", p.kind, subject);
        return true;
      case "AnswerNeither":
        this.ack(m, copy.safetyNoAction);
        return true;
      case "AnswerUnclear":
        return false;
      default: {
        const _exhaustive: never = answer;
        return _exhaustive;
      }
    }
  }

  private recordMeetingSafetyReport(reporter: MemberId, opp: Opp, subject: MemberId, kind: ReportKind) {
    this.blockPair(reporter, subject, true, true);
    this.reportSubject(reporter, subject, kind, { oppId: opp.id, source: "check_in", met: true });
  }

  private blockPair(reporter: MemberId, subject: MemberId, met: boolean, ownBlock: boolean) {
    const blockedPair = pairKey(reporter, subject);
    this.blocks.add(blockedPair);
    this.planAgain.delete(blockedPair);
    this.ctx.recordBlock(reporter, subject);
    if (ownBlock) this.trust.block(reporter, this.now(), { target: subject, met });
    this.closePairOpportunities(reporter, subject, { actorKnown: true });
  }

  private reportSubject(reporter: MemberId, subject: MemberId, kind: ReportKind, o: { oppId?: string; source: SafetyReport["source"]; met: boolean; log?: false }) {
    const now = this.now();
    const points = this.trust.report(subject, reporter, now, { met: o.met });
    if (!points) this.caseEvent(subject, { at: now, kind: "report_received", points: 0, by: reporter });
    const filed: ReportKind = kind === "lying" && this.teenSubject(subject) ? "older_than_stated" : kind;
    this.fileReport(reporter, subject, filed, { ...(o.oppId ? { oppId: o.oppId } : {}), source: o.source, met: o.met || filed === "older_than_stated", caseEvent: false });
    if (o.log !== false) this.ctx.log("report", { memberId: reporter, target: subject, met: o.met, points });
    const target = this.members.get(subject);
    if (filed === "minor" && target) this.minorReported(target, reporter);
    if (filed === "older_than_stated") this.teenAgeContradicted(subject, reporter);
    if (filed === "self_promotion" && target) {
      const cutoff = now - 90 * DAY;
      const existing = (target.selfPromoReports ?? []).filter(r => r.at >= cutoff && r.from !== reporter);
      existing.push({ from: reporter, at: now });
      target.selfPromoReports = existing.slice(-32);
    }
  }

  private closePairOpportunities(a: MemberId, b: MemberId, o: { actorKnown: boolean }) {
    for (const opp of [...this.opps.values()]) this.closeForPairBlock(opp, a, b, o.actorKnown);
  }

  private closeForPairBlock(opp: Opp, a: MemberId, b: MemberId, actorKnown: boolean) {
    const roster = this.blockRoster(opp);
    const bothOnIt = roster.includes(a) && roster.includes(b);
    if (!pairOpportunityClosesOnBlock(OPEN_STAGES.has(opp.stage), bothOnIt) || !closesForBlock(opportunityLifecycle(opp), bothOnIt)) return;
    const booked = opp.stage === "scheduled";
    if (booked) this.ctx.log("meeting_cancelled", { proposalId: opp.id, reason: "blocked" });
    this.close(opp, "blocked");
    for (const id of opp.participants) if (pairBlockCancellationGoesTo(booked, actorKnown, id === a)) this.sendBookedCancellation(opp, id, copy.declinedQuiet);
  }

  /**
   * The check-in said "tell me and I'll pass it to our safety team": a report that comes after the
   * first answer, or after the question lapsed, inside the 7 days after the date, is the same report
   * (SD-220). Only a text that names a report kind and is about someone (the other person's first
   * name, a pronoun or "the date"); other chat goes on as before.
   */
  private lateCheckInReport(m: MemberState, body: string, receivedAt: number): boolean {
    const now = this.now();
    const o = [...this.opps.values()].reverse().find(o => o.stage === "done" && !o.plan && o.status.get(m.id) === "yes"
      && o.meetingAt !== undefined && o.meetingAt <= now && now - o.meetingAt < 7 * DAY);
    if (!o) return false;
    const others = o.participants.filter(p => p !== m.id && o.status.get(p) === "yes");
    const kind = checkInReport(body);
    if (!kind || !(ABOUT_SOMEONE.test(body) || others.some(x => this.namedIn(body, x)))) return false;
    if (!o.feedbackFrom.has(m.id)) {
      m.awaiting = undefined;
      this.onFeedback(m, o, body, feedbackOf(body), meetingFeedbackCanSettle(!!o.finalized, receivedAt - o.meetingAt!, now - o.meetingAt!));
      return true;
    }
    for (const other of others) this.recordMeetingSafetyReport(m.id, o, other, kind);
    this.send(m, copy.reported(false), { type: "info" }, "reply");
    return true;
  }

  private canInvite(m: MemberState) {
    const now = this.now();
    const limit = this.opts.capital ? this.opts.capital.vouchCapacity(m.id, now) : this.opts.invitesPerMonth;
    const record = this.record(m.id);
    const adult = !m.minor && !m.minorSignal && canBeMatched(this.ageOf(m));
    const accountEligible = !!record && !m.account && !["invited", "removed"].includes(record.accountStatus ?? "");
    const used = m.invites.filter(t => memberInviteWithinWindow(now - t)).length;
    return memberMayRequestInvite(adult, accountEligible, !m.optedOut, this.trust.ok(m.id) && !this.reportHeld(m.id), now, m.invitesBlockedUntil, used, limit);
  }

  /** Only the simulator automatically offers growth invitations. The production issuer serves direct requests. */
  private get invitesWork(): boolean { return this.opts.growth && !!this.ctx.invite; }

  private isPrivateInviteTurn(msg: InboundMessage): boolean {
    if (!this.opts.issueMemberInvite || msg.keyword || msg.source === "mcp") return false;
    const body = msg.body.trim();
    if (directInviteVouch(body) || /^(?:confirm|cancel) invite$/i.test(body)) return true;
    const m = this.members.get(msg.memberId), draft = m?.pendingInviteDraft;
    if (!draft || !memberInviteDraftCurrent(this.now() - draft.at)) return false;
    const competing = m.awaiting?.kind;
    if (competing === "probe" || competing === "booked" || competing === "crew") {
      const answer = consentOf(body).answer;
      if ((answer === "yes" || answer === "no") && !inviteVouchEvidence(body)) return false;
    }
    return true;
  }

  private inviteVouchReply(m: MemberState, body: string, memberInviteReviewReference?: string): SendResult {
    return this.send(m, body, { type: "info", privateInviteVouch: true }, "reply", { memberInviteReviewReference });
  }

  private handleInviteVouchTurn(m: MemberState, messageId: string, body: string) {
    const at = this.now();
    const direct = this.memberReply && this.replyTo === m.id;
    const initial = directInviteVouch(body);
    if (initial) {
      if (!memberInviteCanIssue(direct, this.canInvite(m), initial.relationship)) {
        this.inviteVouchReply(m, this.copy.inviteUnavailable);
        return;
      }
      const draft = { ...initial, at, requestId: messageId, riskLanguage: inviteVouchRisk(body) };
      if (this.inviteVouchReply(m, this.copy.inviteVouchQuestion(draft.firstName)) === "sent") m.pendingInviteDraft = draft;
      return;
    }
    if (/^cancel invite$/i.test(body)) {
      m.pendingInviteDraft = undefined;
      this.inviteVouchReply(m, this.copy.inviteCancelled);
      return;
    }
    const draft = m.pendingInviteDraft;
    if (!draft || !memberInviteDraftCurrent(at - draft.at) || !memberInviteCanIssue(direct, this.canInvite(m), draft.relationship)) {
      m.pendingInviteDraft = undefined;
      this.inviteVouchReply(m, this.copy.inviteUnavailable);
      return;
    }
    draft.riskLanguage ||= inviteVouchRisk(body);
    const confirmed = /^confirm invite$/i.test(body);
    const evidenceValid = !!draft.evidence && memberInviteEvidenceValid(draft.evidence.durationMonths, draft.evidence.depth);
    if (memberInviteConfirmationReady(direct, true, evidenceValid, confirmed) && draft.evidence) {
      m.pendingInviteDraft = undefined;
      this.issueInviteLink(m, messageId, draft, draft.evidence, at);
      return;
    }
    const evidence = inviteVouchEvidence(body);
    if (!evidence || !memberInviteEvidenceValid(evidence.durationMonths, evidence.depth)) {
      this.inviteVouchReply(m, draft.evidence ? this.copy.inviteVouchConfirm : this.copy.inviteVouchQuestion(draft.firstName));
      return;
    }
    draft.evidence = undefined;
    const readback = this.copy.inviteVouchReadback(draft.firstName, draft.relationship, evidence.durationMonths, evidence.depth);
    if (this.inviteVouchReply(m, readback) === "sent") draft.evidence = evidence;
  }

  private issueInviteLink(m: MemberState, messageId: string, draft: MemberInviteDraft, evidence: MemberInviteEvidence, at: number) {
    const weak = memberInviteVouchWeak(evidence.durationMonths, evidence.depth);
    const burst = memberInviteBurst(m.invites.filter(t => memberInviteWithinBurstWindow(at - t)).length);
    const reviewReasons: InviteReviewReason[] = [];
    if (weak) reviewReasons.push("weak_vouch");
    if (burst) reviewReasons.push("burst");
    if (draft.riskLanguage) reviewReasons.push("risk_language");
    const disposition = memberInviteNeedsReview(weak, burst, draft.riskLanguage) ? "review" : "issue";
    const { firstName, relationship, requestId } = draft;
    const result = this.opts.issueMemberInvite?.({ inviterId: m.id, messageId, at, firstName, relationship, requestId, ...evidence, reviewReasons, disposition });
    if (!result || (result.status === "issued" && (!memberInviteHeldLinkReleased(disposition === "review", false) || !isMemberInvitationLink(this.app, result.url)))) {
      this.inviteVouchReply(m, this.copy.inviteUnavailable);
      return;
    }
    if (result.status === "review") {
      const reference = inviteReviewReference(result.reviewId);
      this.inviteVouchReply(m, this.copy.inviteInReview(reference), reference);
    }
    else {
      const sent = this.send(m, this.copy.forwardInvite(result.url), { type: "info" }, "reply", { memberInviteLink: result.url });
      if (sent !== "sent") return;
      this.counters.invitesSent++;
    }
    if (memberInviteUsesAllowance(result.status)) m.invites = [...m.invites.filter(t => memberInviteWithinWindow(at - t)), at];
    this.ctx.log("member_invite", { memberId: m.id, status: result.status });
  }

  private invite(m: MemberState, friendName: string) {
    if (!this.ctx.invite) { this.ctx.log("invite_unavailable", { from: m.id }); this.send(m, this.copy.invitesNotOpen(friendName), { type: "info" }, "reply"); return; }
    if (!this.canInvite(m)) { this.send(m, "Thanks! You're out of invites for now; I'll let you know when you have more.", { type: "info" }, "reply"); return; }
    m.invites.push(this.now());
    this.counters.invitesSent++;
    const id = this.ctx.invite?.(m.id, friendName);
    if (id) this.invitedIds.add(id);
    this.ctx.log("invite", { from: m.id, newMemberId: id ?? null });
    this.send(m, copy.inviteSent(friendName), { type: "info" }, "reply");
  }

  /** A growth ask is an ask, not an invite (founder decision 3): not on the cap; one question at a time. */
  private growthAsk(m: MemberState, body: string, kind: string): SendResult {
    return this.send(m, body, { type: "growth_ask", proactive: false }, "growth", { hook: { t: "growth", kind } });
  }

  // ================================================================== network capital (NC)
  /**
   * The one ledger emitter (NC integration ask 1). Every event gets a unique, stable id
   * (`<type>:<key>`, so a replay after a restart is idempotent) and the Clock time.
   */
  private emit(e: LedgerInput, key: string) {
    if (this.ledgerNamesTeen(e)) return;
    this.ledgerCounts[e.type] = (this.ledgerCounts[e.type] ?? 0) + 1;
    this.opts.onLedger?.({ ...e, id: `${e.type}:${key}`, t: this.now() } as CapitalEvent);
  }
  private ledgerNamesTeen(e: LedgerInput): boolean {
    const ids = Object.entries(e).filter(([field]) => LEDGER_MEMBER_FIELDS.has(field))
      .flatMap(([, v]) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []));
    if (!ids.some(id => this.members.get(id)?.minor === true)) return false;
    return [...this.opps.values()].some(o => o.teenRuleAt !== undefined && ids.some(id => this.oppRoster(o).includes(id)));
  }
  /** This member's effort overlay (the floor without a capital reader). Applies to their own asks only. */
  private effort(id: MemberId): NetworkEffort { return this.opts.capital?.effort(id, this.now()) ?? FLOOR_EFFORT; }

  /** The age the ledger gets: null for a member treated as a minor or with no known age (the ledger excludes them). */
  private ledgerAgeOf(m: MemberState): number | null {
    const lowest = this.ageOf(m);
    return m.minor || lowest === undefined ? null : lowest;
  }

  /** member_joined, once, when the age is known. */
  private ledgerJoined(m: MemberState) {
    if (m.joinedLedger || m.ageUnknown) return;
    m.joinedLedger = true;
    this.emit({ type: "member_joined", member: m.id, age: this.ledgerAgeOf(m), ...(m.invitedBy ? { vouchedBy: m.invitedBy } : {}) }, m.id);
  }

  /** age_updated when a joined member becomes, or stops being, a minor: eligibility in the ledger follows (capital-4). */
  private ledgerAge(m: MemberState) {
    if (!m.joinedLedger) return;
    const age = this.ledgerAgeOf(m);
    this.emit({ type: "age_updated", member: m.id, age }, `${m.id}:${age ?? "minor"}:${this.now()}`);
  }

  /** Onboarding is done: the member is active (member_activated, once, for adults). */
  private activate(m: MemberState) {
    m.stage = "active";
    if (m.activated || m.minor) return;
    m.activated = true;
    this.ledgerJoined(m);
    this.emit({ type: "member_activated", member: m.id }, m.id);
  }

  /**
   * Who started the plan (NC: staged-meetup and ring detection count member-started plans only).
   * "member": the members chose each other (a second encounter both asked for). A request is
   * Network-made: the member asked, but the Network chose who. Crew sessions are organizer-led.
   */
  private originOf(o: Opp): "engine" | "member" | "organizer" {
    if (o.plan?.crewId) return "organizer";
    return o.origin === "second_encounter" ? "member" : "engine";
  }
  private planKind(o: Opp): "intro" | "group" | "plan" | "event" | "crew" {
    if (o.plan) return o.plan.crewId ? "crew" : "plan";
    return o.kind === "group" ? "group" : o.kind === "event_coattend" ? "event" : "intro";
  }

  /**
   * After a meeting (NC asks: attendance verification, the organizer's check-in, ghosting): resolve
   * each booked member once, from the post-meeting answers.
   *  - Present: the member said they came, a counterpart who came confirms them (named them, or
   *    reported nobody missing: the mutual check-in), or the host checked them in.
   *    plan_attended lists how it was verified; then feedback_given if they answered.
   *  - Said they could not make it: plan_no_show.
   *  - Reported missing by the other person of a pair, with no word from them since the booked plan
   *    reached them (no confirmation in words, no feedback): plan_ghosted; with a word: plan_no_show.
   *  - Nothing known: nothing is emitted.
   * A hosted plan whose host came: organized, with the host's check-in list.
   */
  private finalize(o: Opp) {
    if (o.finalized || o.meetingAt === undefined) return;
    o.finalized = true;
    const settledAt = this.now();
    // spec/meetingSettlement.md, "Classify each attendee from the available reports"
    const going = o.participants.filter(p => {
      const receivedAt = this.bookingNoticeReceiptAt(o, p);
      return attendanceBookingReceived(o.status.get(p) === "yes", receivedAt !== undefined, receivedAt ?? -1, settledAt);
    });
    if (!going.length) return;
    const post = o.post ?? {};
    const said = (p: MemberId) => post[p];
    const proposedHost = o.plan?.hostId;
    const host = proposedHost && organizerCanVerify(going.includes(proposedHost), !!said(proposedHost)?.came) ? proposedHost : undefined;
    const hp = host ? said(host)! : undefined;
    const names = hp?.named ?? [];
    const checkInSource = chooseCheckIn(!!hp, !!hp?.otherNoShow, names.length > 0);
    let checkIn: MemberId[] = [];
    if (checkInSource === "MissingNames") checkIn = going.filter(p => p !== host && said(p)?.came && !names.includes(p));
    else if (checkInSource === "PresentNames") checkIn = names;
    else if (checkInSource === "BookedParticipants") checkIn = going.filter(p => p !== host && said(p)?.came !== false);
    const foundMissing = going.filter(p => said(p)?.came && said(p)?.otherNoShow);
    const confirms = going.filter(p => counterpartConfirmsAttendance(!!said(p)?.came, !!said(p)?.otherNoShow));
    const findings = going.map(p => {
      const reply = said(p);
      const vouchers = confirms.filter(x => x !== p);
      const organizerVerified = checkIn.includes(p);
      const promptAt = this.feedbackReceiptAt(o, p);
      const finding = countAttendance({
        saidAttended: reply?.came === true, saidAbsent: reply?.came === false, hasFeedback: !!reply,
        counterpartVerified: vouchers.length > 0, organizerVerified, pairMeeting: going.length === 2,
        reportedMissing: foundMissing.some(x => x !== p && reportedAbsenceIdentifiesMember(going.length === 2, said(x)?.missing?.includes(p) === true)), explicitReply: (o.explicit ?? []).includes(p),
        receivedFeedbackPrompt: promptAt !== undefined && meetingFeedbackWindow(promptAt - o.meetingAt!),
      });
      return { p, vouchers, organizerVerified, finding };
    });
    o.settledAttendance = Object.fromEntries(findings.map(({ p, finding }) => [p, finding.mark]));
    const present = findings.filter(({ finding }) => finding.mark === "Attended").map(({ p }) => p);
    const origin = this.originOf(o);
    const friendsPlan = this.app.id === "friends" && !!o.plan;
    for (const { p, vouchers, organizerVerified, finding } of findings) {
      const key = `${o.id}:${p}`;
      const confirmers = vouchers.filter(x => said(x)?.confirmedRoster);
      // spec/meetingSettlement.md, "A settled Friends plan teaches the actual booked time"
      const availability = friendsPlanAttendanceAvailability(friendsPlan, finding.mark, o.meetingAt);
      const member = availability.recorded ? this.members.get(p) : undefined;
      if (member) {
        member.availHistory = [...(member.availHistory ?? []), { at: availability.at, outcome: "attended" as const }].slice(-availabilityHistoryLimit);
      }
      // spec/meetingSettlement.md, "Verified value needs an independent attendance confirmation"
      if (verifiedMeetingValueAllowed(finding.mark === "Attended", !!said(p)?.worthwhile, confirmers.length)) {
        this.emit({ type: "value_received", member: p, with: confirmers, confirmedBy: confirmers }, key);
      }
      if (finding.mark === "Attended") {
        const repeatProof = said(p)?.repeatProof;
        if (repeatProof?.revision === (o.scheduleRevision ?? 0)) repeatProof.settledBooking = true;
        const verifiedBy: ("counterpart" | "organizer")[] = [...(vouchers.length ? ["counterpart" as const] : []), ...(organizerVerified ? ["organizer" as const] : [])];
        this.emit({ type: "plan_attended", member: p, planId: o.id, counterparts: present.filter(x => x !== p), verifiedBy, origin, publicVenue: true, confirmers: [...vouchers, ...(organizerVerified && host ? [host] : [])] }, key);
        if (finding.logFeedback) this.emit({ type: "feedback_given", member: p, planId: o.id }, key);
      } else if (finding.mark === "Absent") {
        this.emit({ type: "plan_no_show", member: p, planId: o.id }, key);
      } else if (finding.mark === "Ghosted") {
        this.emit({ type: "plan_ghosted", member: p, planId: o.id }, key);
      }
    }
    if (host && o.plan) {
      const a = plans.activityById.get(o.plan.activityId);
      this.emit({ type: "organized", organizer: host, planId: o.id, publicVenue: true, recurring: !!o.plan.crewId, attendees: checkIn.filter(p => present.includes(p)), label: a?.label ?? "a plan" }, o.id);
    }
    // A reported no-show counts only when corroborated (network-consent-17): the member said they did
    // not come, or they were asked how it went and stayed silent (finalize runs 4 days after).
    for (const { p, finding } of findings) {
      if (!finding.reliabilityNoShow) continue;
      const x = this.members.get(p);
      if (x) { x.noShows++; x.completedSinceNoShow = 0; o.noShowCounted = [...(o.noShowCounted ?? []), p]; }
    }
    // A request is fulfilled only when the requester and someone else attended (matching-e2e-7).
    if (o.requester && requestAttendanceSatisfied(present.includes(o.requester), present.some(p => p !== o.requester))) {
      const r = this.requests.find(x => x.oppId === o.id && x.memberId === o.requester);
      if (r && r.outcome !== "fulfilled") {
        r.outcome = "fulfilled"; r.fulfilledAt = this.now(); this.counters.requestsFulfilled++;
        this.ctx.log("request_result", { requestId: r.id, memberId: r.memberId, outcome: "fulfilled", hours: Math.round((this.now() - r.at) / HOUR) });
      }
    }
    this.ctx.log("attendance", { oppId: o.id, booked: going.length, present: present.length, answered: going.filter(p => said(p)).length, checkIn: checkIn.length });
  }

  /**
   * Help (NC: help_given, then the recipient's help_confirmed): the requester of a member request
   * whose want needs a skill the other person has. A standing request that was retried (it was on
   * the Network's needs list) is need_answered instead, confirmed by the requester.
   */
  private helpFeedback(m: MemberState, o: Opp, f: { sentiment: string; selfNoShow: boolean; otherNoShow: boolean }) {
    if (o.origin !== "request" || o.requester !== m.id || o.participants.length !== 2 || f.selfNoShow || f.otherNoShow) return;
    const helper = o.participants.find(p => p !== m.id)!;
    const r = this.requests.find(x => x.oppId === o.id && x.memberId === m.id);
    const def = r?.desireId ? desireById.get(r.desireId) : undefined;
    const useful = f.sentiment === "positive";
    if (o.retry && r) {
      if (useful) this.emit({ type: "need_answered", member: helper, needId: r.id, confirmedBy: m.id, ...(def ? { label: def.text } : {}) }, `${r.id}:${helper}`);
      return;
    }
    if (!def?.needsSkills.some(sk => this.knownProfiles().get(helper)?.skills.has(sk))) return;
    this.emit({ type: "help_given", helper, recipient: m.id, helpId: o.id }, o.id);
    this.emit({ type: "help_confirmed", helpId: o.id, recipient: m.id, useful }, o.id);
  }

  // ------------------------------------------------------------------ fraud review (NC ask 4)
  /** Gaming flags from the ledger become review items (kind "fraud"). The same members and kind are not queued again within 14 days. */
  private queueFraudFlags(now: number) {
    const keyOf = (f: GamingFlag) => `${f.kind}|${[...f.members].sort().join(",")}`;
    for (const f of this.opts.capital?.flags?.(now) ?? []) {
      if (f.members.some(id => this.declinedIds.has(id))) continue;
      const k = keyOf(f);
      if (this.fraud.some(x => keyOf(x.flag) === k && (x.status === "review" || now - (x.decidedAt ?? x.queuedAt) < 14 * DAY))) continue;
      const item: FraudItem = { id: `fraud-${++this.fraudSeq}`, flag: { ...f, members: [...f.members], evidence: { ...f.evidence } }, queuedAt: now, deadline: now + 14 * DAY, status: "review" };
      this.fraud.push(item);
      this.ctx.log("fraud_queued", { fraudId: item.id, flag: f.kind, members: [...f.members], evidence: { ...f.evidence } });
    }
    for (const x of this.fraud) if (x.status === "review" && now >= x.deadline) { x.status = "expired"; x.decidedAt = now; this.ctx.log("fraud_expired", { fraudId: x.id }); }
  }

  private fraudItem(x: FraudItem): ReviewItem {
    const proposal: Proposal = {
      id: x.id, kind: "group", participants: [...x.flag.members], alternates: [], objective: `review: possible ${x.flag.kind.replace(/_/g, " ")}`, category: "social", city: this.networkCity(),
      window: { start: x.queuedAt, end: x.deadline }, score: 0, components: ZERO, exploration: false,
      explanations: Object.fromEntries(x.flag.members.map(id => [id, Object.entries(x.flag.evidence).map(([k, v]) => `${k} ${v}`).join(", ")])), generator: "nc_detection", createdAt: x.queuedAt,
    };
    return { oppId: x.id, proposal, origin: "fraud", kind: "fraud", queuedAt: x.queuedAt, deadline: x.deadline, rerolls: 0, revision: 0, fraud: { flag: x.flag.kind, members: [...x.flag.members], evidence: { ...x.flag.evidence } } };
  }

  /** A reviewer's decision on a fraud item: approve = confirmed (fraud_confirmed: the ledger claws back), reject = dismissed. Nobody is messaged. */
  private decideFraud(x: FraudItem, decision: ReviewDecision, opts: ReviewOptions): ActionResult {
    const refuse = (reason: string): ActionResult => { this.ctx.log("review_refused", { oppId: x.id, decision, reason }); return { ok: false, reason }; };
    if (x.status !== "review") return { ok: false, reason: "not_in_review" };
    if (!REVIEW_DECISIONS.has(decision)) return refuse("unknown_decision");
    if (decision === "edit" || decision === "reroll") return refuse("not_applicable");
    if (opts.reason === "other" && !opts.note?.trim()) return refuse("note_required");
    const reviewer = opts.reviewer ?? "reviewer";
    const status = decision === "approve" ? "confirmed" as const : "dismissed" as const;
    Object.assign(x, { status, decidedAt: this.now(), reviewer, note: opts.note, reason: opts.reason });
    this.ctx.log("fraud_decision", { fraudId: x.id, decision: status, reviewer, flag: x.flag.kind, members: [...x.flag.members], note: opts.note ?? null });
    if (status === "confirmed") this.emit({ type: "fraud_confirmed", members: [...x.flag.members], ...(opts.note ? { note: opts.note } : {}) }, x.id);
    if (this.members.has(reviewer)) this.emit({ type: "review_completed", member: reviewer, items: 1 }, `${x.id}:${reviewer}`);
    return { ok: true };
  }

  /** Fraud items for staff (all statuses), oldest first. */
  fraudItems(): FraudItem[] { return this.fraud.map(x => ({ ...x, flag: { ...x.flag, members: [...x.flag.members] } })); }

  // ================================================================== plans (plans v1.1)
  private plansOn() { return this.opts.plans && this.opts.matchingEnabled; }

  /**
   * The engine World the planner, crew sessions and the plan probe copy read (engine-visible inputs
   * only), built at most once per New York day. An app's own pack gets its adult input and its own
   * lane vectors, so a friends crew is pair-gated on Friend profiles, not on The Network's.
   */
  private planWorldCache?: { day: string; w: EngineWorld };
  private planWorld(now: number, fresh = false, exceptPlans: readonly string[] = []): EngineWorld {
    const day = localDateParts(now, this.cityTz()).day;
    if (!fresh && !exceptPlans.length && this.planWorldCache?.day === day) return this.planWorldCache.w;
    const pack = this.appPack();
    const input = pack ? this.packInput(now) : this.engineInput(now);
    // Recovery rechecks an existing reviewed group. Its original and replacement rows are not competing proposals.
    if (exceptPlans.length) input.recentProposals = input.recentProposals?.filter(p => !exceptPlans.includes(p.id));
    const w = new EngineWorld({ ...input, memberStanding: this.memberStanding }, resolveConfig({ ...this.opts.engine }), localEmbed, pack ?? networkPack);
    if (!exceptPlans.length) this.planWorldCache = { day, w };
    return w;
  }

  /** What the planner knows about when a member is free: the attention evidence plus this week's stated windows. */
  private planEvidence(m: MemberState, now: number, opps?: Iterable<Opp>): plans.PlanEvidence {
    return { ...this.evidence(m, now, undefined, opps), ...(m.stated && m.stated.until > now ? { stated: m.stated } : {}) };
  }

  /** Is the member booked into a meeting within 4 hours of `t` (other than `exceptOpp`)? */
  private bookedNear(id: MemberId, t: number, exceptOpp?: string): boolean {
    for (const o of this.opps.values()) {
      if (o.id === exceptOpp || o.stage !== "scheduled" || o.meetingAt === undefined || o.status.get(id) !== "yes") continue;
      if (Math.abs(o.meetingAt - t) < BOOKING_GAP) return true;
    }
    return false;
  }

  /** When each member last met someone through the Network (exposure floor for organizing reach). */
  private lastParticipation(now: number): Map<MemberId, number> {
    const out = new Map<MemberId, number>();
    for (const o of this.opps.values()) {
      if (o.meetingAt === undefined || o.meetingAt > now || (o.stage !== "done" && o.stage !== "scheduled")) continue;
      for (const p of o.participants) if (o.status.get(p) === "yes") out.set(p, Math.max(out.get(p) ?? -Infinity, o.meetingAt));
    }
    return out;
  }

  private adultMember(id: MemberId): boolean { return this.rosterSideOf(id).adult; }

  private knownMinor(id: MemberId): boolean { return this.members.has(id) && !this.adultMember(id); }

  teenIntrosEnabled(): boolean {
    return teenIntrosStoredOn(teenFriendApp(this.app.id), this.teenStop !== undefined);
  }

  teenIntrosStopped(): { by: string; at: number } | undefined {
    return this.teenStop ? { ...this.teenStop } : undefined;
  }

  minorNoticeOf(id: MemberId): MinorNotice | undefined {
    const m = this.members.get(id);
    return m ? this.minorNoticeKind(m) : undefined;
  }

  stopTeenIntros(actor: string): ActionResult {
    const who = actor.trim();
    if (!who) return { ok: false, reason: "actor_required" };
    if (!this.teenStop) this.teenStop = { by: who, at: this.now() };
    this.teenCachesChanged();
    this.ctx.log("teen_intros_switch", { on: false, actor: who });
    this.teenSweep();
    return { ok: true };
  }

  resumeTeenIntros(actor: string): ActionResult {
    const who = actor.trim();
    if (!who) return { ok: false, reason: "actor_required" };
    if (!teenIntroSwitchAllowed(true, teenFriendApp(this.app.id))) {
      this.ctx.log("teen_intros_refused", { actor: who, reason: "teen_intros_not_offered" });
      return { ok: false, reason: "teen_intros_not_offered" };
    }
    this.teenStop = undefined;
    this.teenCachesChanged();
    this.ctx.log("teen_intros_switch", { on: true, actor: who });
    return { ok: true };
  }

  private requestAgeFits(a: MemberId, b: MemberId, category: Category): boolean {
    const teen = [a, b].some(id => this.members.get(id)?.minor === true || this.teenAdmitted(id));
    return !teen || this.rosterAgeAllowed(category, [a, b]);
  }

  private teenRosterAdmitted(o: Opp): boolean {
    const base = this.oppRoster({ participants: o.participants, alternates: [], plan: o.plan });
    if (!base.some(id => this.members.get(id)?.minor === true || this.teenAdmitted(id))) {
      o.alternates = o.alternates.filter(a => this.adultMember(a));
      if (o.plan) o.plan = { ...o.plan, alternates: [...o.alternates] };
      return true;
    }
    const end = this.teenMeetingEnd(o);
    const kept: MemberId[] = [];
    for (const a of o.alternates) {
      if (base.includes(a) || kept.includes(a) || base.length + kept.length >= teenRosterMaximum) continue;
      const role = o.plan ? "guest" : o.origin === "request" ? "peer" : o.roles?.[a];
      if (role !== undefined && teenFriendRole(role) && !this.teenPairAvoided([...base, ...kept, a])
        && this.rosterAgeAllowed(o.category, [...base, ...kept, a], end)) kept.push(a);
    }
    o.alternates = kept;
    if (o.plan) o.plan = { ...o.plan, alternates: [...kept] };
    if (this.teenPairAvoided(base) || !this.teenOppAllowed(o)) {
      this.gate("participant_minor", o.participants);
      this.close(o, "participant_minor");
      return false;
    }
    o.teenRuleAt = this.now();
    return true;
  }

  private teenCachesChanged() {
    this.planWorldCache = undefined;
    this.snapCache = undefined;
    this.dirty = true;
  }

  private rosterSideOf(id: MemberId): AgeSide {
    const m = this.members.get(id);
    if (!m || this.declinedIds.has(id)) return { adult: false, ready: false, birthKey: 0 };
    this.syncRecord(m);
    const r = this.record(id);
    const adult = canBeMatched(this.youngestAgeOnRecord(m)) && !m.minor && !m.minorSignal && !m.ageConflict && !m.ageUnknown && !m.minorReported;
    const ready = !!r && teenReady(r.birthExact === true, r.ageConflict === true || m.ageConflict === true || m.ageUnknown === true,
      recordMinorSignalOpen(r, m) || m.minorSignal, m.minorReported === true, m.olderReported === true, r.teenBarred === true || r.teenHeld === true || this.teenHeldHere(id));
    return { adult, ready, birthKey: r?.birthKey ?? 0 };
  }

  private teenDays(meetingEnd?: number): { minDay: number; maxDay: number } {
    const now = this.now();
    return { minDay: earliestDayKeyOf(now), maxDay: latestDayKeyOf(Math.max(now, meetingEnd ?? now)) };
  }

  private rosterAgeAllowed(category: Category, ids: readonly MemberId[], meetingEnd?: number): boolean {
    const { minDay, maxDay } = this.teenDays(meetingEnd);
    return groupAgeAllowed(this.teenIntrosEnabled(), teenFriendCategory(this.app.id, category), minDay, maxDay, [...new Set(ids)].map(id => this.rosterSideOf(id)));
  }

  private teenAdmitted(id: MemberId): boolean {
    const side = this.rosterSideOf(id);
    const { minDay, maxDay } = this.teenDays();
    return teenFriendCandidate(side.adult, side.ready, side.birthKey, minDay, maxDay, this.teenIntrosEnabled(), teenFriendApp(this.app.id));
  }

  private teenPartnerReady(id: MemberId): boolean {
    const side = this.rosterSideOf(id);
    const { minDay, maxDay } = this.teenDays();
    return this.teenIntrosEnabled() && teenFriendApp(this.app.id) && side.ready && teenPartnerAge(side.birthKey, minDay, maxDay);
  }

  private oppRoster(o: Pick<Opp, "participants" | "alternates"> & { plan?: plans.Plan }): MemberId[] { return teenRosterWithHost(o); }

  private teenRoster(o: Pick<Opp, "participants" | "alternates"> & { plan?: plans.Plan }): boolean {
    return rosterHasMinor(this.oppRoster(o).map(id => this.rosterSideOf(id)));
  }

  private friendsRosterVerificationCurrent(roster: readonly MemberId[]): boolean {
    if (this.app.id !== "friends") return true;
    const seats = roster.map(id => ({ id, side: this.rosterSideOf(id) }));
    const withMinor = this.teenIntrosEnabled() && rosterHasMinor(seats.map(seat => seat.side));
    const now = this.now();
    const facets = this.snapshotCached().facets;
    return seats.every(({ id, side }) => {
      if (friendsVerifyPasses(withMinor, side.ready, false)) return true;
      const tags = facets.filter(facet => facet.memberId === id && (facet.validFrom ?? -Infinity) <= now && now <= (facet.validTo ?? Infinity))
        .flatMap(facet => facet.tags);
      return friendsKit.friendsStaffVerified(tags);
    });
  }

  private teenMeetingEnd(o: Opp): number {
    return teenMeetingEndOf(o, this.now());
  }

  private teenOppAllowed(o: Opp, meetingEnd = this.teenMeetingEnd(o)): boolean {
    const roster = this.oppRoster(o);
    return teenStoredItemShape(this.app.id, o) && teenRosterSizeAllowed(true, roster.length) && this.rosterAgeAllowed(o.category, roster, meetingEnd);
  }

  private teenPlanSeat(id: MemberId): boolean {
    return teenGroupPlanApp(this.app.id) && (this.teenAdmitted(id) || this.teenPartnerReady(id));
  }

  private planRosterAgeOk(category: Category, roster: readonly MemberId[], end: number): boolean {
    return roster.every(id => this.adultMember(id))
      || (teenGroupPlanApp(this.app.id) && teenRosterSizeAllowed(true, roster.length) && this.rosterAgeAllowed(category, roster, end));
  }

  private teenSessionNearby(venueId: string, start: number, exceptOpp: string): boolean {
    return [...this.opps.values()].some(x => x.id !== exceptOpp && x.teenRuleAt !== undefined && x.stage === "scheduled" && x.venueId === venueId
      && x.meetingAt !== undefined && Math.abs(x.meetingAt - start) <= teenNearbyWindowMs);
  }

  private teenItemOk(o: Opp | undefined): boolean {
    return !!o && o.teenRuleAt !== undefined && OPEN_STAGES.has(o.stage) && this.teenOppAllowed(o);
  }

  private rosterAgeBlocked(o: Opp): boolean {
    const notAdult = this.oppRoster(o).filter(id => !this.adultMember(id));
    return notAdult.length > 0 && !(this.teenItemOk(o) && notAdult.every(id => this.teenAdmitted(id)));
  }

  teenItemCurrent(oppId: string): boolean {
    const o = this.opps.get(oppId);
    if (!o) return false;
    const minor = this.teenRoster(o);
    return teenItemContinues(this.teenIntrosEnabled(), minor, minor && o.teenRuleAt !== undefined && OPEN_STAGES.has(o.stage) && this.teenOppAllowed(o));
  }

  teenItemListed(oppId: string, viewerAdult: boolean): boolean {
    const o = this.opps.get(oppId);
    if (!o) return false;
    if (o.teenRuleAt === undefined) return viewerAdult && this.oppRoster(o).every(id => this.adultMember(id));
    return this.teenItemCurrent(oppId) && (viewerAdult || this.teenRoster(o));
  }

  private teenContactAllowed(o: Opp | undefined, ids: readonly MemberId[]): boolean {
    if (!o || !this.teenItemOk(o)) return false;
    const roster = new Set(this.oppRoster(o));
    return ids.every(id => roster.has(id));
  }

  private teenFeedbackAllowed(o: Opp | undefined, ids: readonly MemberId[]): boolean {
    if (!o || o.teenRuleAt === undefined || o.stage !== "done" || !this.teenOppAllowed(o)) return false;
    const roster = new Set(this.oppRoster(o));
    return ids.every(id => roster.has(id));
  }

  private teenSlotAllowed(o: Opp, slot: { start: number; end: number }, venueId?: string, packVenue = false): boolean {
    const city = this.networkCity(), tz = this.cityTz();
    if (o.teenRuleAt === undefined) {
      if (![...this.opps.values()].some(x => x.teenRuleAt !== undefined && x.stage === "scheduled")) return true;
      const venue = venueId ?? o.fixedVenue?.id ?? (o.plan ? o.plan.venueId : this.opts.hooks?.venue ? undefined
        : meetingSpot(o.participants.map(p => this.member(p).area), o.category, o.tags, false, city).venue.id);
      return venue === undefined || !this.teenSessionNearby(venue, slot.start, o.id);
    }
    const start = localParts(slot.start, tz), end = localParts(slot.end, tz);
    const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
    const nearby = venueId !== undefined && [...this.opps.values()].some(x => x.id !== o.id && x.stage === "scheduled" && x.venueId === venueId
      && x.meetingAt !== undefined && Math.abs(x.meetingAt - slot.start) <= teenNearbyWindowMs && x.participants.some(p => !this.teenPartnerReady(p)));
    return sameDay && teenMeetingAllowed(true, packVenue, start.hour * 60 + start.minute, end.hour * 60 + end.minute, nearby);
  }

  private closeTeenItem(o: Opp, reason: string) {
    if (o.stage === "scheduled") this.closeBooking(o, reason, true);
    else this.close(o, reason, { releasePartial: true });
    this.teenCachesChanged();
    this.ctx.log("teen_item_closed", { oppId: o.id, reason });
  }

  private closeTeenItemsOf(id: MemberId, reason: string) {
    for (const o of this.openOpps()) if (o.teenRuleAt !== undefined && this.oppRoster(o).includes(id)) this.closeTeenItem(o, reason);
  }

  private teenSweep(): void {
    for (const id of new Set(this.openOpps().filter(o => o.teenRuleAt !== undefined).flatMap(o => this.oppRoster(o)))) {
      const m = this.members.get(id), r = this.record(id);
      if (m && r && !m.olderReported && !m.minorReported && (r.teenBarred === true || r.ageConflict === true || m.ageConflict === true)) this.teenAgeContradicted(id);
    }
    this.closeFailedTeenItems();
  }

  private closeFailedTeenItems(memberId?: MemberId): void {
    const on = this.teenIntrosEnabled();
    for (const o of this.openOpps()) {
      if (o.teenRuleAt === undefined || (memberId !== undefined && !this.oppRoster(o).includes(memberId))) continue;
      const minor = this.teenRoster(o);
      if (teenItemContinues(on, minor, minor && this.teenOppAllowed(o))) continue;
      this.closeTeenItem(o, on ? "age_changed" : "teen_intros_off");
    }
  }

  private teenReviewOf(o: Opp): ReviewItem["teen"] {
    if (o.teenRuleAt === undefined || !this.teenRoster(o)) return undefined;
    const { minDay, maxDay } = this.teenDays(this.teenMeetingEnd(o));
    return {
      members: this.oppRoster(o).map(memberId => {
        const side = this.rosterSideOf(memberId);
        return { memberId, age: ageOnDay(side.birthKey, minDay), maxAge: ageOnDay(side.birthKey, maxDay) };
      }),
    };
  }

  private youngestAgeOnRecord(m: MemberState): number | undefined {
    const r = this.record(m.id);
    return lowestAge(this.ageOf(m), r?.birthExact === true ? ageOnDay(r.birthKey ?? 0, earliestDayKeyOf(this.now())) : undefined);
  }

  private teenSubject(id: MemberId): boolean {
    return [...this.opps.values()].some(o => o.teenRuleAt !== undefined && this.oppRoster(o).includes(id)) || this.teenPartnerReady(id);
  }

  private teenPairsReached(o: Opp): void {
    const roster = this.oppRoster(o);
    const adult = new Map(roster.map(id => [id, this.rosterSideOf(id).adult]));
    const pairs = pairsOf(roster).filter(([a, b]) => !adult.get(a) || !adult.get(b));
    if (pairs.length) this.opts.onTeenPairAvoid?.(pairs);
  }

  private teenPairAvoided(ids: readonly MemberId[]): boolean {
    const snap = this.snapshotCached();
    if (this.snapAvoid?.snap !== snap) this.snapAvoid = { snap, set: new Set(snap.edges.filter(e => e.type === "avoid").map(e => pairKey(e.from, e.to))) };
    const avoid = this.snapAvoid.set;
    return pairsOf(ids).some(([a, b]) => avoid.has(pairKey(a, b)));
  }

  private teenHeldHere(id: MemberId): boolean {
    return this.reportHeld(id) || this.trust.level(id) === "hold" || this.reports.some(r => r.subjectId === id && (r.status === "open" || r.status === "held"));
  }

  teenPoolHolds(): MemberId[] {
    const { minDay, maxDay } = this.teenDays();
    return [...this.members.keys()].filter(id => {
      const r = this.record(id);
      const pool = [...this.opps.values()].some(o => o.teenRuleAt !== undefined && this.oppRoster(o).includes(id))
        || (r?.birthExact === true && teenPartnerAge(r.birthKey ?? 0, minDay, maxDay));
      return pool && this.teenHeldHere(id);
    });
  }

  private endTeenContact(memberId: MemberId): MemberId[] {
    const partners = new Set<MemberId>();
    for (const o of this.opps.values()) {
      if (o.teenRuleAt === undefined || !this.oppRoster(o).includes(memberId)) continue;
      for (const p of this.oppRoster(o)) if (p !== memberId && this.members.get(p)?.minor) partners.add(p);
    }
    this.closeTeenItemsOf(memberId, "age_changed");
    const now = this.now();
    for (const p of partners) this.caseEvent(p, { at: now, kind: "adult_after_teen_contact", points: 0, by: memberId });
    return [...partners];
  }

  teenAgeContradicted(memberId: MemberId, reporter?: MemberId): void {
    const m = this.members.get(memberId);
    if (!m || this.declinedIds.has(memberId)) return;
    m.olderReported = true;
    this.dirty = true;
    this.caseEvent(memberId, { at: this.now(), kind: "older_than_stated", points: 0 });
    if (reporter === undefined) this.fileReport(memberId, memberId, "older_than_stated", { source: "message", met: true, caseEvent: false });
    this.opts.onTeenBar?.(memberId, "older_than_stated");
    const partners = this.endTeenContact(memberId);
    this.ctx.log("teen_age_contradicted", { memberId, minors: partners });
  }

  reportOlderThanStated(memberId: MemberId, actor: string): ActionResult {
    if (!actor.trim()) return { ok: false, reason: "actor_required" };
    if (!this.members.has(memberId) || this.declinedIds.has(memberId)) return { ok: false, reason: "unknown_member" };
    this.teenAgeContradicted(memberId);
    this.ctx.log("safety_action", { action: "older_than_stated", memberId, actor });
    return { ok: true };
  }

  // spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person"
  private planMembersAdult(o: Opp): boolean {
    if (o.teenRuleAt !== undefined) {
      if (!this.teenItemOk(o)) this.closeTeenItem(o, this.teenIntrosEnabled() ? "age_changed" : "teen_intros_off");
      return OPEN_STAGES.has(o.stage);
    }
    const crewId = o.plan?.crewId;
    const crew = crewId === undefined ? undefined : this.crews.find(c => c.id === crewId);
    const crewKnown = crew ? [...crew.members, ...this.timeAndPlaceChain(this.crewSource(crew.id)).flatMap(s => [...s.contacted])] : [];
    for (const id of new Set([...o.participants, ...this.timeAndPlaceChain(o).flatMap(s => [...s.contacted]), ...crewKnown])) {
      const m = this.members.get(id);
      if (m && this.knownMinor(id)) this.syncMember(m);
    }
    return OPEN_STAGES.has(o.stage);
  }

  private planSeatOk(m: MemberState, exceptOpp?: string, o: { busyOk?: boolean; opps?: Iterable<Opp> } = {}): boolean {
    return (this.adultMember(m.id) || this.teenPlanSeat(m.id)) && !m.account && !m.optedOut && m.stage === "active" && !m.onlyWhenAsked && this.trust.ok(m.id) && !this.reportHeld(m.id) && (!!o.busyOk || !this.busy(m.id, exceptOpp, false, o.opps));
  }

  private planFriendSeatFits(world: EngineWorld, id: MemberId, peers: readonly MemberId[], mode: "discovery" | "existingPlan"): boolean {
    if (peers.some(peer => !this.pairAllowed(id, peer))) return false;
    if (mode === "existingPlan") {
      const values = existingFriendPlanPairValues(world, id, peers);
      return currentFriendPlanSeatFits(values !== undefined, values ?? []);
    }
    const profile = world.match.profileIn(id, "Friend");
    const peerValues = profile ? peers.map(peer => {
      const other = world.match.profileIn(peer, "Friend");
      return other ? world.match.value(profile, other) : noPairValue;
    }) : [];
    return currentFriendPlanSeatFits(!!profile, peerValues);
  }

  private planFriendPartnerFits(world: EngineWorld, roster: readonly MemberId[], category: Category): boolean {
    const [first, second] = roster;
    const currentSeats = roster.map(id => {
      const member = this.members.get(id);
      return !!member && this.planSeatOk(member, undefined, { busyOk: true });
    });
    const pairEligible = first !== undefined && second !== undefined && friendsKit.friendsPartnerEligible(world, first, second, category)
      && this.planFriendSeatFits(world, first, [second], "existingPlan");
    return friendsPartnerPlanFits(currentSeats, pairEligible);
  }

  /**
   * The planner run (plans ask 2): Monday and Thursday from 09:00 New York (plans config runDays).
   * Members with a stated, standing or learned window, not in an open opportunity and not waiting on
   * an answer. Each plan becomes one review item (planToProposal); nobody hears about it before a
   * reviewer approves it.
   */
  private runPlanner(now: number) {
    const city = this.networkCity(), tz = this.cityTz();
    const p = localDateParts(now, tz);
    const jsDay = (localParts(now, tz).weekday + 1) % 7;
    if (!this.pcfg.runDays.includes(jsDay) || p.hour < this.opts.runHour || p.hour >= ENGINE_RUN_UNTIL || this.lastPlanRunDay === p.day) return;
    this.lastPlanRunDay = p.day;
    const evidence = new Map<MemberId, plans.PlanEvidence>();
    const exclude = new Set<MemberId>();
    const opps = this.oppsByMember();
    for (const m of this.members.values()) {
      const own = opps.get(m.id) ?? [];
      if (!this.planSeatOk(m, undefined, { opps: own })) { exclude.add(m.id); continue; }
      if (m.awaiting?.kind === "probe" || m.awaiting?.kind === "booked") { exclude.add(m.id); continue; }
      const ev = this.planEvidence(m, now, own);
      if (!ev.standing?.length && !ev.stated && !ev.history?.length) continue;
      evidence.set(m.id, ev);
    }
    this.planCarry = this.planCarry.filter(c => c.until > now);
    const pack = this.appPack();
    const cityPlanVenues = planVenuesForCity(city);
    const cityGeoVenues = venuesForCity(city);
    const made: plans.Plan[] = pack?.id === "friends" ? this.friendsWeekPlans(now, evidence) : plans.planProposals(this.planWorld(now, true), {
      now, city, tz, evidence, venues: cityPlanVenues, exclude, carry: this.planCarry, lastPlannedAt: this.lastPlannedAt,
      hints: new Map([...this.members.values()].filter(m => m.hints?.length && m.stated && m.stated.until > now).map(m => [m.id, m.hints!] as [MemberId, string[]])),
      busyAt: (id, slot) => this.bookedNear(id, slot.start),
      travelMinutes: (id, destination) => {
        const memberArea = this.members.get(id)?.area;
        const home = memberArea ? findCityNeighborhood(memberArea, city)?.neighborhood : undefined;
        if (!home) return undefined;
        const area = destination.area ? findCityNeighborhood(destination.area, city)?.neighborhood : undefined;
        const venue = "activities" in destination ? cityGeoVenues.find(candidate => candidate.id === destination.id)
          : area && destination.listing ? { ...area, lat: destination.listing.lat, lng: destination.listing.lng } : undefined;
        const location = venue ?? area;
        return location ? travelMinutes(home, location) : undefined;
      },
    }, this.pcfg);
    this.ctx.log("planner_run", { plans: made.length, pool: evidence.size, city });
    for (const plan of made) this.submitPlan(plan, now);
  }

  /** Crew offers and sessions have their own lifecycle. The weekly pass can repeat a settled public table. */
  private friendsWeekPlans(now: number, evidence: ReadonlyMap<MemberId, plans.PlanEvidence>): plans.Plan[] {
    const city = this.networkCity(), tz = this.cityTz();
    const world = this.planWorld(now, true);
    const used = new Set([...this.opps.values()].flatMap(o => o.plan?.repeatOf ? [o.plan.repeatOf] : []));
    const outcomes = [...this.opps.values()].flatMap(o => {
      const source = this.friendsRepeatSource(o, now, used.has(o.id));
      return source ? [source] : [];
    });
    const week = planFriendsWeek(world, {
      now, city, tz, evidence, venues: planVenuesForCity(city), crews: [], outcomes, offered: [], lastPlannedAt: this.lastPlannedAt,
      venueExcluded: (venueId, ids) => this.venues.excludedIdsFor(ids).has(venueId),
      repeatAllowed: plan => this.friendsRepeatPlanCurrent(plan, now, world),
    }, { ...DEFAULT_FRIENDS_POLICY, crews: false, mutualPositive: false, openTable: false, spreadNew: true }, this.pcfg);
    for (const plan of week.repeats) {
      if (rosterHasMinor(plan.invited.map(id => this.rosterSideOf(id)))) continue;
      const ordered = [...plan.invited].sort();
      const previousHost = plan.repeatOf ? this.opps.get(plan.repeatOf)?.plan?.hostId : undefined;
      plan.hostId = ordered[friendsRepeatHostIndex(previousHost ? ordered.indexOf(previousHost) : -1, ordered.length)];
    }
    const partners = week.partners.map(plan => {
      const reviewedOptions = plan.options.map(({ start, end }) => ({ start, end }));
      if (!plan.venueId || !validFriendsPlanTimeWindows(reviewedOptions)
        || !reviewedOptions.some(slot => slot.start === plan.window.start && slot.end === plan.window.end)) return plan;
      const probeDeadline = Math.min(plan.probeDeadline, reviewedOptions[0]!.start - Math.max(PARTNER_LEAD, this.pcfg.deadlineBeforeStartHours * HOUR));
      if (probeDeadline <= now) return plan;
      return { ...plan, reviewedOptions, probeDeadline };
    });
    return [...week.repeats, ...week.plans, ...partners];
  }

  private friendsPlanSlotCurrent(plan: plans.Plan, roster: readonly MemberId[], slot: attention.TimeSlot, now: number, oppId: string): boolean {
    const venue = this.replacementVenue(plan);
    const duration = (slot.end - slot.start) / MINUTE;
    const item = this.opps.get(oppId);
    return !!venue && slot.start >= now + PARTNER_LEAD && duration > 0 && (!item || this.teenSlotAllowed(item, slot, venue.id))
      && plans.venueOpenForSlot(venue, slot, duration, this.cityTz())
      && roster.every(id => this.inNyc(id, now, slot.end) && !this.bookedNear(id, slot.start, oppId)
        && plans.planWindowMatchesStated(this.member(id).stated, slot, now))
      && this.calendarAllows(roster, slot, now);
  }

  private pickedPlanWindows(o: Opp, id: MemberId): attention.TimeSlot[] {
    return (o.offered?.[id] ?? []).filter(slot => o.picks?.[id]?.includes(slot.start));
  }

  private friendsRepeatSource(o: Opp, now: number, alreadyOffered = false): plans.PlanOutcomeRecord | undefined {
    const plan = o.plan;
    if (!plan || plan.partner || plan.crewId || plan.eventId || plan.category !== "social" || o.meetingAt === undefined
      || o.meetingAt > now || now - o.meetingAt >= DEFAULT_FRIENDS_POLICY.repeatWindowDays * DAY) return;
    const offer = this.crewOffers.find(c => c.planId === o.id);
    const crewActive = !!offer && (!offer.resolved || this.crews.some(c => c.id === offer.crew.id));
    if (!friendsRepeatSourceAllowed(o.stage === "done", !!o.finalized, crewActive, alreadyOffered)) return;
    // spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows"
    if (!this.recurrenceOk(o, [])) return;
    const venue = this.replacementVenue(plan);
    if (!venue?.public) return;
    const attendees = [...new Set(o.participants)].filter(id => {
      const answer = o.post?.[id];
      const proof = answer?.repeatProof;
      const booked = o.status.get(id) === "yes" && friendsRepeatBookingProofCurrent(proof?.revision ?? -1,
        o.scheduleRevision ?? 0, proof?.settledBooking === true);
      return friendsRepeatAttendanceAllowed(booked,
        answer?.came === true, answer?.again === true, answer?.otherNoShow === true, offer?.no.includes(id) === true);
    });
    if (!friendsRepeatRosterCurrent(attendees, attendees)) return;
    const coversTable = (crew: plans.Crew) => crew.city === plan.city && crew.activityId === plan.activityId
      && attendees.every(id => crew.members.includes(id));
    if (this.crews.some(coversTable) || this.crewOffers.some(c => !c.resolved && coversTable(c.crew))) return;
    return { planId: o.id, activityId: plan.activityId, venueId: venue.id, city: plan.city, at: o.meetingAt,
      attended: attendees, positive: attendees, recurringWant: [] };
  }

  private friendsRepeatPlanCurrent(plan: plans.Plan, now: number, world: EngineWorld, exceptOpp?: string): boolean {
    const sourceOpp = plan.repeatOf && this.opps.get(plan.repeatOf);
    const source = sourceOpp && this.friendsRepeatSource(sourceOpp, now);
    const venue = this.replacementVenue(plan);
    const activity = plans.activityById.get(plan.activityId);
    if (!source || !venue?.public || !activity || (venue.capacity ?? Infinity) < plan.invited.length
      || source.venueId !== venue.id || source.activityId !== plan.activityId || source.city !== plan.city
      || now >= plan.probeDeadline || plan.alternates.length || !friendsRepeatRosterCurrent([...source.positive].sort(), [...plan.invited].sort())
      || !this.replacementWindowCurrent(venue, plan.window, plan.invited, now)
      || !this.planRosterAgeOk(plan.category, teenRosterWithHost({ participants: plan.invited, alternates: plan.alternates, plan }), plan.window.end)) return false;
    const planCity = isCity(plan.city) ? plan.city : this.networkCity();
    const dest = friendsKit.hoodForCity(planCity, venue.area);
    const info = friendsKit.friendsInfo(world);
    return !!dest && plan.invited.every(id => {
      const member = this.members.get(id), friend = info.get(id), record = world.get(id)?.m;
      return !!member && !!friend?.home && !!record && this.planSeatOk(member, exceptOpp) && record.homeCity === plan.city
        && record.age >= Math.max(activity.ageMin, venue.ageMin) && record.prefs.categoriesOptIn.includes(plan.category)
        && record.prefs.formats.includes("small_group") && plans.planMemberReason(world, id) === null
        && friendsKit.transitMinutesInCity(planCity, friend.home, dest) <= friend.tolerance * DEFAULT_FRIENDS_POLICY.toleranceSlack
        && this.planFriendSeatFits(world, id, plan.invited.filter(peer => peer !== id), "existingPlan");
    });
  }

  private replacementVenue(plan: plans.Plan): plans.Venue | undefined {
    const city = isCity(plan.city) ? plan.city : this.networkCity();
    return planVenuesForCity(city).find(v => v.id === plan.venueId && v.city === plan.city && v.activities.includes(plan.activityId));
  }

  private replacementRosterCurrent(world: EngineWorld, plan: plans.Plan, venue: plans.Venue, roster: MemberId[], exceptOpp?: string): boolean {
    const activity = plans.activityById.get(plan.activityId);
    if (!activity || roster.length !== plan.quorum || new Set(roster).size !== roster.length || (venue.capacity ?? Infinity) < roster.length
      || roster.length < activity.groupSize[0] || roster.length > activity.groupSize[1]) return false;
    return roster.every(id => {
      const member = this.members.get(id);
      const record = world.get(id)?.m;
      return !!member && !!record && this.adultMember(id) && this.planSeatOk(member, exceptOpp) && record.homeCity === plan.city
        && record.age >= Math.max(activity.ageMin, venue.ageMin) && record.prefs.categoriesOptIn.includes(plan.category)
        && record.prefs.formats.includes("small_group") && plans.planMemberReason(world, id) === null
        && (plans.activityFit(world, id, this.pcfg, member.hints).get(plan.activityId) ?? 0) >= this.pcfg.minFit
        && this.planFriendSeatFits(world, id, roster.filter(peer => peer !== id), "existingPlan");
    });
  }

  private replacementWindowCurrent(venue: plans.Venue, slot: attention.TimeSlot, roster: readonly MemberId[], now: number): boolean {
    const duration = (slot.end - slot.start) / MINUTE;
    if (duration <= 0 || !plans.venueOpenForSlot(venue, slot, duration, this.cityTz())) return false;
    return roster.every(id => {
      const evidence = this.planEvidence(this.member(id), now);
      return this.inNyc(id, now, slot.end) && !this.bookedNear(id, slot.start)
        && plans.hasWindow(evidence, slot, now, this.pcfg) > 0;
    });
  }

  private replacementPlanCurrent(o: Opp, now: number): boolean {
    const source = o.replacementFor && this.opps.get(o.replacementFor);
    const plan = o.plan;
    const venue = plan && this.replacementVenue(plan);
    if (!source || !plan || !venue || !this.opts.matchingEnabled) return false;
    const sourceClosed = source.stage === "closed" && source.closedFrom === "scheduled" && source.closedReason === "participant dropped";
    const beforeDeadline = now < plan.probeDeadline;
    const current = sourceClosed && beforeDeadline
      && this.replacementRosterCurrent(this.planWorld(now, true, [source.id, o.id]), plan, venue, o.participants, o.id)
      && this.replacementWindowCurrent(venue, plan.window, o.participants, now);
    return recoveryPlanCanProceed(sourceClosed, current, beforeDeadline);
  }

  private offerGroupReplacement(o: Opp, survivors: MemberId[], now: number): boolean {
    if (o.teenRuleAt !== undefined) return false;
    const { plan, planRun, meetingAt } = o;
    const venue = plan && this.replacementVenue(plan);
    const activity = plan && plans.activityById.get(plan.activityId);
    if (!plan || !planRun || !venue || !activity || meetingAt !== plan.window.start || !this.opts.matchingEnabled) return false;
    // spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows"
    if (!this.recurrenceOk(o, survivors)) return false;
    // spec/bookedGroupReplacement.md, "A replacement uses a current reviewed alternate and a viable slot"
    const world = this.planWorld(now, true, [o.id]);
    const rosters = planRun.bench.filter(id => mayOfferReviewedAlternate(plan.alternates.includes(id), true, o.alternates.includes(id),
      o.participants.includes(id) || o.contacted.has(id) || Object.hasOwn(planRun.answers, id)))
      .map(id => [...survivors, id]).filter(roster => this.replacementRosterCurrent(world, plan, venue, roster));
    if (!rosters.length) return false;
    const earliestStart = now + this.pcfg.minLeadHours * HOUR;
    const latestStart = now + this.pcfg.horizonDays * DAY;
    const tz = this.cityTz();
    const templates = attention.candidateSlots(tz, now).filter(slot => slot.start > meetingAt
      && activity.dayparts.some(part => part === plans.daypartOf(slot.start, tz)));
    const duration = Math.max(plan.window.end - meetingAt, activity.durationMin * MINUTE);
    for (const { start } of [plan.window, ...templates]) {
      const probeDeadline = Math.min(start - this.pcfg.deadlineBeforeStartHours * HOUR, now + this.pcfg.probeWindowHours * HOUR);
      if (probeDeadline <= now) continue;
      const window = { start, end: start + duration };
      const invited = rosters.find(roster => viableReplacementSlot(start, meetingAt, earliestStart, latestStart,
        this.replacementWindowCurrent(venue, window, roster, now)));
      if (!invited) continue;
      const count = invited.length;
      const submitted = this.submitPlan({
        ...plan, id: `plan_${sha256(`${o.id}|replacement`).slice(0, 16)}`, venueId: venue.id, place: { name: venue.name, area: venue.area },
        window, probeDeadline, invited, alternates: [], size: { min: count, target: count, max: count },
        createdAt: now, u: {}, familiar: {},
      }, now, o.id);
      return Boolean(submitted);
    }
    return false;
  }

  private offerTwoPersonGroupPivot(o: Opp, pair: [MemberId, MemberId], now: number): boolean {
    if (!this.opts.matchingEnabled || o.meetingAt === undefined || now >= o.meetingAt - MIN_NOTICE || !o.venue
      || o.workIntro || o.seat || o.publicEventRevision) return false;
    const [a, b] = pair;
    if (a === b || !this.pairAllowed(a, b)) return false;
    if (![a, b].every(id => {
      const m = this.members.get(id);
      return !!m && !m.optedOut && !m.account && m.state !== "paused" && this.trust.ok(id) && !this.reportHeld(id);
    })) return false;
    if (!this.recurrenceOk(o, pair)) return false;
    const anyMinor = pair.some(id => !this.adultMember(id));
    if (anyMinor) {
      if (!this.teenIntrosEnabled() || !teenRosterSizeAllowed(true, pair.length)
        || !this.rosterAgeAllowed(o.category, pair, o.meetingAt + teenMeetingMs)) return false;
    }
    const duration = o.plan ? Math.max(HOUR, o.plan.window.end - o.plan.window.start) : DEFAULT_ATTENTION.availability.slotHours * HOUR;
    const pivot = this.newOpp({
      origin: o.origin, kind: "intro", category: o.category, objective: o.objective, detail: o.detail,
      participants: [a, b], alternates: [], primed: [],
      explanations: { [a]: o.explanations[a] ?? GOOD_FIT, [b]: o.explanations[b] ?? GOOD_FIT },
      score: o.score, generator: "group_two_person_pivot", tags: [...o.tags],
    });
    pivot.pivotFromGroup = o.id;
    pivot.anchorWindow = { start: o.meetingAt, end: o.meetingAt + duration };
    pivot.venueId = o.venueId;
    pivot.venue = o.venue;
    pivot.venueArea = o.venueArea;
    if (o.fixedVenue) pivot.fixedVenue = o.fixedVenue;
    else if (o.venueId && o.venue && o.venueArea) {
      const geoVenue = venuesForCity(this.networkCity()).find(v => v.id === o.venueId);
      if (geoVenue) pivot.fixedVenue = geoVenue;
      else {
        const rec = this.venues.getVenue(o.venueId) ?? this.venuePoolForCity(this.networkCity()).find(v => v.id === o.venueId);
        if (rec) {
          pivot.fixedVenue = {
            id: rec.id, name: rec.name, neighborhood: rec.neighborhood,
            borough: NEIGHBORHOOD.get(rec.neighborhood)?.borough ?? "Manhattan",
            lat: rec.lat, lng: rec.lng, tags: [...o.tags], kind: "cafe_district",
            allAges: rec.allAges ?? !rec.isBarOnly, adultPlans: true,
          };
        }
      }
    }
    if (!this.teenRosterAdmitted(pivot)) return false;
    this.submit(pivot);
    this.ctx.log("group_two_person_pivot_queued", { fromOppId: o.id, pivotOppId: pivot.id, participants: pair });
    return true;
  }

  // spec/groupFormation.md, "Only eligible adults enter the group search"
  // spec/planFormation.md, "Alternates must fit the entire offered group"
  private submitPlan(plan0: plans.Plan, now: number, replacementFor?: string): Opp | undefined {
    const ageEligible = (id: MemberId) => this.adultMember(id) || this.teenPlanSeat(id);
    if (![...plan0.invited, ...(plan0.hostId ? [plan0.hostId] : [])].every(id => poolEligible(ageEligible(id)))) {
      this.ctx.log("plan_refused", { planId: plan0.id, reason: "minors policy" });
      return undefined;
    }
    const plan = { ...plan0, alternates: plan0.alternates.filter(id => isPlanAlternate(ageEligible(id), true)) };
    const slots = plan.reviewedOptions ?? [plan.window];
    if (plan.venueId !== undefined && !rosterHasMinor(teenRosterWithHost({ participants: plan.invited, alternates: [], plan }).map(id => this.rosterSideOf(id)))
      && slots.every(slot => this.teenSessionNearby(plan.venueId!, slot.start, ""))) {
      this.ctx.log("plan_refused", { planId: plan0.id, reason: "teen session nearby" });
      return undefined;
    }
    const a = plans.activityById.get(plan.activityId)!;
    const prop = plans.planToProposal(plan, this.pcfg);
    const o = this.newOpp({
      origin: "planner", kind: prop.kind, category: plan.category, objective: prop.objective, detail: a.label, participants: plan.invited, alternates: plan.alternates,
      primed: [], explanations: prop.explanations, score: plan.score, generator: plan.crewId ? "crew" : plan.repeatOf ? "friends_repeat" : "plan", tags: a.tags.slice(0, 4),
    });
    o.plan = plan;
    if (replacementFor) o.replacementFor = replacementFor;
    this.bindPublishedEvent(o, plan.eventId);
    if (!this.teenRosterAdmitted(o)) return undefined;
    for (const id of plan.invited) this.lastPlannedAt.set(id, now);
    this.plansCounters.plansProposed++;
    this.submit(o);
    return o;
  }

  /** An approved plan: probe the first members (quorum; partner plans one at a time) through the plan lane. */
  private beginPlan(o: Opp) {
    o.plan = { ...o.plan!, invited: [...o.participants], alternates: [...o.alternates] };
    o.deadline = o.plan.probeDeadline;
    // spec/planFormation.md, "Alternates must fit the entire offered group"
    o.planRun = plans.startPlanRun(o.plan, { canMatch: id => isPlanAlternate(this.adultMember(id) || (o.teenRuleAt !== undefined && this.teenPlanSeat(id)), true) });
    for (const p of o.participants) o.status.set(p, o.planRun.answers[p] === "pending" ? "probing" : "queued");
    this.counters.oppsStarted++;
    this.ctx.log("probe_started", { proposal: this.toProposal(o), origin: o.origin, primed: [], runId: o.runId, reviewer: o.review?.reviewer, approver: o.review?.approver, plan: { activityId: o.plan.activityId, quorum: o.plan.quorum, start: o.plan.window.start } });
    this.planLane(o, this.now());
  }

  /** The in-process invitation and the provider claim use this app's same cutoffs. */
  planProbeWindowOpen(stage: string, plan: { window: { start: number }; probeDeadline: number }, now: number): boolean {
    return planInvitationOpen(stage === "probing", stage === "scheduled", now, plan.probeDeadline,
      plan.window.start - this.pcfg.lateJoinHours * HOUR);
  }

  /** Probes whose turn has come go out when the member's plan lane allows (send window, one a day, allowance). */
  private planLane(o: Opp, now: number) {
    if (o.stage === "probing" && o.replacementFor && !this.replacementPlanCurrent(o, now)) return this.planFallback(o);
    const publicEventIssue = o.stage === "probing" ? this.publicEventRefusal(o) : undefined;
    if (publicEventIssue) return this.close(o, publicEventIssue);
    if (!o.planRun) return;
    for (const id of Object.keys(o.planRun.answers)) this.planProbe(o, id, now);
  }

  /**
   * The plan lane (plans iteration 2, ask 1). A plan invite goes out inside the member's send window,
   * at most one a day, one plan per message. Members with a window or the weekly check-in use the
   * plan allowance: attention.composeMessage with planAllowanceConfig and a ledger of their plan
   * invites only (1 per 7 days), so the intro cap never sees it; it still counts for two-unanswered
   * and the Blooio streak. Other members get it on the intro cap. The text is the engine's
   * buildPlanProbe (no names, leak-checked); null means it is not sent.
   */
  private planProbe(o: Opp, id: MemberId, now: number) {
    const m = this.members.get(id);
    if (!m || !o.plan || !o.planRun) return;
    // A prior seat can close or backfill the plan while the same pass is in progress.
    if (!this.planProbeWindowOpen(o.stage, o.plan, now)
      || !planTurnDue(o.planRun.answers[id] === "pending", participantProbe(o, id).told)) return;
    const about = o.participants.filter(peer => peer === id || (o.stage === "scheduled"
      ? o.status.get(peer) === "yes" : activeOpportunityParticipant(o, peer)));
    const friends = this.appPack()?.id === "friends";
    const friendPartner = friends && o.plan.partner;
    const friendReplacement = friends && !o.plan.invited.includes(id);
    // spec/planDispatch.md, "A missing seat or an absence rules out the invitation"
    const eligible = this.planSeatOk(m, o.id, { busyOk: true }) && (friendPartner
      ? this.planFriendPartnerFits(this.planWorld(now, true), about, o.plan.category)
      : !friendReplacement || this.planFriendSeatFits(this.planWorld(now, true), id, about.filter(peer => peer !== id), "existingPlan"));
    const seat = stepPlanDispatch(initialPlanDispatch, { type: "checkSeat", eligible });
    if (seat.phase !== "CheckingPresence") return this.planAnswer(o, id, false, true);
    const city = this.networkCity(), tz = this.cityTz();
    const reviewed = o.plan.reviewedOptions;
    const first = o.plan.invited[0];
    const options = reviewed ? friendsPlanTimeOptions(reviewed, friendsPlanOfferedWindows(reviewed,
      first === id ? undefined : first && o.planRun.answers[first] === "yes" ? this.pickedPlanWindows(o, first) : [],
      slot => this.friendsPlanSlotCurrent(o.plan!, about, slot, now, o.id)), tz) : undefined;
    // The options path already checked presence and availability for each exact interval.
    const presence = stepPlanDispatch(seat, { type: "checkPresence", present: !!options || this.inNyc(id, now, o.plan.window.end) });
    if (presence.phase !== "CheckingAvailability") {
      this.refuse(id, "probe", presence.reason);
      return this.planAnswer(o, id, false, true);
    }
    const availability = stepPlanDispatch(presence, { type: "checkAvailability",
      statedAllows: options ? options.length > 0 : plans.planWindowMatchesStated(m.stated, o.plan.window, now),
      calendarAllows: !!options || this.calendarAllows([id], o.plan.window, now) });
    if (availability.phase !== "CheckingWindow") {
      this.refuse(id, "probe", availability.reason);
      return this.planAnswer(o, id, false, true);
    }
    // In another open opportunity: the plan probe waits (one open question at a time) until the deadline.
    // spec/planDispatch.md, "Wait for the send window, earlier questions, and the right allowance"
    const busy = this.busy(m.id, o.id);
    const windowOpen = !busy && this.timingOk(m, "slot", now);
    const awaitingAnswer = windowOpen && (m.awaiting?.kind === "probe" || m.awaiting?.kind === "booked" || this.questionHoldUntil(m, now) !== undefined);
    const day = windowOpen && !awaitingAnswer ? localDateParts(now, tz).day : undefined;
    const window = stepPlanDispatch(availability, { type: "checkWindow", busy, windowOpen, awaitingAnswer, sentToday: day !== undefined && m.planDay === day });
    if (window.phase !== "CheckingAllowance" || day === undefined) return this.planDefer(o, id, window.reason, now);
    const invitationPlan = { ...o.plan, invited: about };
    const allowance = !o.replacementFor && !o.askedAgain?.includes(id) && this.pcfg.allowance.enabled && plans.planAllowanceEligible(this.planEvidence(m, now), !!m.weekly, now);
    let admitted: boolean, allowanceReason: string;
    if (allowance) {
      const item = plans.planItem(invitationPlan, id, { now, reviewState: "approved", stage: o.plan.partner && id !== o.plan.invited[0] ? "partner" : "first", pcfg: this.pcfg });
      const r = attention.composeMessage({
        member: this.view(m, now), items: [item], ledger: planLedger(m.id, m.planInvites ?? [], m.replies ?? []),
        // The plan ledger tracks allowance use. The Network separately tracks delivered unanswered invitations.
        unansweredCount: m.unanswered,
        conversation: { outboundSinceInbound: m.outbound ?? 0, ...(m.lastInbound ? { lastInboundAt: m.lastInbound } : {}) },
        now, mode: "digest", cfg: plans.planAllowanceConfig(DEFAULT_ATTENTION, this.pcfg),
      });
      admitted = r.send;
      allowanceReason = r.send ? "" : r.reason || "compose";
    } else {
      admitted = !this.overBudget(m);
      allowanceReason = "cap";
    }
    const budget = stepPlanDispatch(window, { type: "checkAllowance", admitted });
    if (budget.phase !== "RenderingInvite") return this.planDefer(o, id, allowanceReason, now);
    // A crew session's extra seats (organizing reach) go to people outside the crew: they get the plain plan probe.
    const inCrew = !o.plan.crewId || !!this.crews.find(c => c.id === o.plan!.crewId)?.members.includes(id);
    const text = plans.buildPlanProbe(this.planWorld(now), inCrew ? invitationPlan : { ...invitationPlan, crewId: undefined }, id, tz, planVenueAgesForCity(city), options);
    // spec/planDispatch.md, "A usable message must be sent before the daily record changes"
    const rendered = stepPlanDispatch(budget, { type: "renderInvite", usable: !!text });
    if (rendered.phase !== "SendingInvite" || !text) {
      this.refuse(id, "probe", rendered.reason);
      return this.planAnswer(o, id, false, true);
    }
    const a = plans.activityById.get(o.plan.activityId)!;
    const res = this.send(m, text, {
      type: "plan_probe", proposalId: o.id, proactive: true, planInvite: allowance, ...(allowance ? { lane: "plan" } : {}),
      plan: { planId: o.id, activity: a.id, window: { ...o.plan.window }, size: about.length,
        ...(options ? { options } : {}), ...(o.plan.place.area ? { area: o.plan.place.area } : {}) },
    }, "probe", { about, hook: { t: "plan_probe", oppId: o.id, id, ...(options ? { options } : {}) }, noDefer: true, planInvite: allowance,
      ...(options ? { key: friendsPlanProbeDeliveryKey(o.id, reviewRevision(o), id) }
        : o.replacementFor ? { key: replacementProbeKey(o.id, id) } : {}),
    });
    if (stepPlanDispatch(rendered, { type: "recordSend", sent: res === "sent" }).phase === "InviteSent") {
      m.planDay = day;
      if (allowance) this.plansCounters.planInvitesAllowance++; else this.plansCounters.planInvitesIntroCap++;
    }
  }

  private planDefer(o: Opp, id: MemberId, reason: string, now: number) {
    if (o.deferLogged?.includes(id)) return;
    o.deferLogged = [...(o.deferLogged ?? []), id];
    this.counters.deferred++;
    const m = this.members.get(id);
    this.ctx.log("send_deferred", { memberId: id, kind: "plan_probe", oppId: o.id, reason, until: m ? Math.max(now, this.openAt(m, "slot", now)) : now });
  }

  /** A plan probe answer (or silence, or a seat that is no longer possible): the quorum run decides what happens next. */
  private planAnswer(o: Opp, id: MemberId, yes: boolean, silent = false, onRecorded?: () => void) {
    if (!o.planRun) return;
    const now = this.now();
    // spec/planFormation.md, "Alternates must fit the entire offered group"
    // spec/planDecision.md, "A Friends replacement needs a current pair value with every remaining member"
    let world: EngineWorld | undefined;
    const friends = this.appPack()?.id === "friends";
    let probeWorld: EngineWorld | undefined;
    const keepsWords = (alternate: MemberId): boolean => {
      const plan = o.plan;
      if (!plan || plan.partner) return true;
      const before = o.participants.filter(peer => peer !== alternate && activeOpportunityParticipant(o, peer));
      const after = [...before.filter(peer => peer !== id), alternate];
      const heard = before.filter(peer => peer !== id && participantProbe(o, peer).told);
      probeWorld ??= this.planWorld(now);
      const w = probeWorld;
      const city = this.networkCity(), tz = this.cityTz(), venueAges = planVenueAgesForCity(city);
      const alike = heard.filter(peer => plans.buildPlanProbe(w, { ...plan, invited: before }, peer, tz, venueAges)
        === plans.buildPlanProbe(w, { ...plan, invited: after }, peer, tz, venueAges)).length;
      return groupBackfillKeepsYeses(heard.length, alike);
    };
    const canMatch = (alternate: MemberId): boolean => {
      const ageOk = this.adultMember(alternate)
        || (o.teenRuleAt !== undefined && o.alternates.includes(alternate) && this.teenPlanSeat(alternate) && this.teenOppAllowed(o));
      if (ageOk && !keepsWords(alternate)) return false;
      if (!ageOk || !friends) return isPlanAlternate(ageOk, true);
      if (!this.planSeatOk(this.members.get(alternate)!, o.id, { busyOk: true })) return false;
      const peers = o.participants.filter(peer => peer !== alternate && (peer !== id || yes) && activeOpportunityParticipant(o, peer));
      world ??= this.planWorld(now, true);
      return isPlanAlternate(ageOk, this.planFriendSeatFits(world, alternate, peers, "existingPlan"));
    };
    const { run, action } = plans.recordPlanAnswer(o.planRun, id, yes, now, this.pcfg, { canMatch });
    if (run === o.planRun) return;
    o.planRun = run;
    const recorded = run.answers[id] !== "pending";
    if (recorded) {
      o.askedAgain = o.askedAgain?.filter(x => x !== id);
      if (yes) { this.plansCounters.planYes++; o.status.set(id, "available"); } else { if (!silent) this.plansCounters.planNo++; o.status.set(id, silent ? "unavailable" : "no"); }
      onRecorded?.();
      // A yes after the late-join cutoff was told "I'll tell you once enough people are in": it is out, and hears so in the next message.
      if (run.answers[id] === "late") { o.status.set(id, "unavailable"); this.noteFor(id, copy.planNotTogether); return "recorded"; }
      if (!yes && o.replacementFor && o.stage === "probing") {
        this.planFallback(o);
        return "recorded";
      }
    } else this.expirePlanInvitations(o, run.plan.probeDeadline, now);
    this.planAct(o, action);
    return recorded ? "recorded" : "expired";
  }

  private planAct(o: Opp, action: plans.PlanAction) {
    switch (action.kind) {
      case "book": return this.bookPlan(o, action.going);
      case "join": return this.planJoin(o, action.member);
      case "probe_partner": case "backfill": {
        const id = action.member;
        if (action.kind === "backfill" && o.plan?.partner && this.askPartnerPlanAgain(o, id)) return this.planLane(o, this.now());
        if (!o.participants.includes(id)) o.participants.push(id);
        o.alternates = o.alternates.filter(x => x !== id);
        o.status.set(id, "probing");
        o.turnAt = { ...o.turnAt, [id]: this.now() };
        if (action.kind === "backfill") this.ctx.log("probe_replaced", { oppId: o.id, in: id, proposal: this.toProposal(o) });
        return this.planLane(o, this.now());
      }
      case "fallback": return this.planFallback(o);
      default: return;
    }
  }

  private askPartnerPlanAgain(o: Opp, alternate: MemberId): boolean {
    const run = o.planRun!;
    // spec/probeDispatch.md, "An activity-partner plan asks the member who agreed again before its alternate"
    const heard = o.participants.filter(p => p !== alternate && run.answers[p] === "yes" && participantProbe(o, p).told);
    const backfill = partnerPlanBackfill(run.bench, alternate, heard.length);
    if (backfill.askAlternate) return false;
    const askedAgain = this.changeRoster(o, alternate);
    const { [alternate]: _, ...answers } = run.answers;
    const now = this.now();
    for (const p of askedAgain) {
      answers[p] = "pending";
      storeProbe(o, p, stepProbe(participantProbe(o, p), { type: "openTurn", first: true, firstAvailable: false }));
      o.turnAt = { ...o.turnAt, [p]: now };
    }
    o.planRun = { ...run, answers, bench: backfill.bench };
    this.ctx.log("probe_replaced", { oppId: o.id, in: alternate, askedAgain, proposal: this.toProposal(o) });
    return true;
  }

  /**
   * Quorum reached: book the plan (plans ask 5). Anyone booked elsewhere within 4 hours of the start
   * is left out first (never told why); each member is checked again at send time. The reveal is the
   * booked plan to each member who said yes: names, time, public place, "everyone pays their own way".
   */
  private bookPlan(o: Opp, going: MemberId[], fromFallback = false): void {
    if (!this.planMembersAdult(o)) return;
    const publicEvent = this.currentPublishedEvent(o);
    const publicEventIssue = this.publicEventRefusal(o, publicEvent);
    if (publicEventIssue) return this.close(o, publicEventIssue);
    const original = o.plan!;
    const now = this.now();
    let plan = original;
    if (original.reviewedOptions) {
      const [first, second] = going;
      const selected = first && second && chooseFriendsPlanWindow(original.reviewedOptions,
        this.pickedPlanWindows(o, first), this.pickedPlanWindows(o, second),
        slot => this.friendsPlanSlotCurrent(original, going, slot, now, o.id));
      if (!selected) {
        o.planRun = { ...o.planRun!, stage: "closed" };
        return this.closeNoCommonTime(o, second ?? first ?? original.invited[0]!);
      }
      plan = { ...original, window: selected };
    }
    if (o.teenRuleAt !== undefined ? !this.teenSlotAllowed(o, plan.window, plan.venueId) || !this.teenOppAllowed(o, plan.window.end)
      : plan.venueId !== undefined && this.teenSessionNearby(plan.venueId, plan.window.start, o.id)) {
      o.planRun = { ...o.planRun!, stage: "closed" };
      return this.closeNoCommonTime(o, going[0] ?? original.invited[0]!);
    }
    const a = plans.activityById.get(plan.activityId)!;
    if (o.replacementFor && !this.replacementPlanCurrent(o, now)) return this.planFallback(o);
    const friendWorld = this.appPack()?.id === "friends" ? this.planWorld(now, true) : undefined;
    const friendPartnerEligible = !friendWorld || !plan.partner || this.planFriendPartnerFits(friendWorld, going, plan.category);
    // Yes-sayers left out here were told "I'll tell you once enough people are in": they hear that it did not come together (never why).
    const left: MemberId[] = [];
    let keep = going.filter(id => {
      if (!this.bookedNear(id, plan.window.start, o.id) && this.calendarAllows([id], plan.window, now)) return true;
      o.status.set(id, "unavailable"); this.plansCounters.planConflictsDropped++;
      this.ctx.log("plan_conflict", { oppId: o.id, memberId: id });
      left.push(id);
      return false;
    });
    // In the order they said yes: a member blocked by someone already in drops out, never both of
    // them (attention-MISSED-2), so one block cannot collapse the quorum.
    const seated: MemberId[] = [];
    for (const id of keep) {
      const chk = this.checkRecipient(id, "reveal", { about: [...seated, id], reply: false, opp: o });
      const why = !chk.ok ? chk.reason : attention.canSendLogistics({ outboundSinceInbound: this.member(id).outbound ?? 0 }) ? undefined : "conversation_streak";
      if (why) { this.refuse(id, "reveal", why); o.status.set(id, "unavailable"); left.push(id); continue; }
      if (!friendPartnerEligible || (friendWorld && !plan.partner && !this.planFriendSeatFits(friendWorld, id, seated, "existingPlan"))) {
        o.status.set(id, "unavailable");
        left.push(id);
        continue;
      }
      seated.push(id);
    }
    keep = seated;
    if (!this.friendsRosterVerificationCurrent(keep)) {
      return this.close(o, "friends_verification_required", { releasePartial: true });
    }
    // Never a member on watch, and a minor only on a teen plan seat: any later message about this plan to them is a contact.
    const tell = (ids: MemberId[]) => { for (const id of ids) if ((!this.member(id).minor || (o.teenRuleAt !== undefined && this.teenPlanSeat(id))) && this.trust.ok(id)) this.noteFor(id, copy.planNotTogether); };
    // spec/planDecision.md, "A group plan never books two members directly"
    const hasConsent = o.replacementFor
      ? bookReplacementPlan(reviewApproved(o.review),
        going.filter(id => o.planRun?.answers[id] === "yes" && o.contacted.has(id)).length, keep.length)
      : planBookingConsented(plan.partner, keep.length, plan.quorum, a.groupSize[0]);
    const next = stepOpportunity(opportunityLifecycle(o), { type: "book", hasConsent });
    if (next.phase !== "Scheduled") {
      o.planRun = { ...o.planRun!, stage: "closed" };
      if (!plan.partner && keep.length === 2) {
        // The two seated members get a fresh partner plan (or the next fallback); the yes-sayers left out
        // hear that the plan did not come together. After a fallback, this is the same fallback: count it once.
        tell(left);
        return this.planFallback(o, keep, fromFallback);
      }
      if (fromFallback || keep.length < 2) { for (const id of keep) this.noteFor(id, copy.planNotTogether); tell(left); return this.close(o, "plan did not come together"); }
      return this.planFallback(o);
    }
    tell(left);
    const city = isCity(plan.city) ? plan.city : this.networkCity();
    const tz = tzForCity(city);
    o.plan = plan;
    o.meetingAt = plan.window.start; o.venueId = plan.venueId; o.venue = plan.place.name; o.venueArea = plan.place.area ?? "";
    o.followupAt = computeFollowupTimestamp(plan.window.end, tz).scheduledAt;
    const facetsByMember = this.snapshotRows().facets;
    const backupPick = this.venues.pickForMatch({
      city,
      mode: keep.length >= 3 ? "group" : "date",
      startMs: plan.window.start,
      memberAreas: keep.map(id => this.member(id).area).filter((a): a is string => !!a),
      members: keep.map(id => this.memberVenuePrefsOf(id, facetsByMember, plan.venueId ? [plan.venueId] : []).prefs),
      teenFriendAllowed: o.teenRuleAt !== undefined,
      targetHobbies: o.tags,
    }, now);
    const backup = backupPick.primary?.venue.id !== plan.venueId ? backupPick.primary?.venue : backupPick.backup?.venue;
    if (backup && backup.id !== plan.venueId) o.backupVenueId = backup.id;
    const gv = venuesForCity(city).find(v => v.id === plan.venueId);
    this.ctx.log("venue", { oppId: o.id, venueId: plan.venueId ?? plan.eventId ?? null, venue: plan.place.name, lat: gv?.lat ?? publicEvent?.listing?.lat ?? null, lng: gv?.lng ?? publicEvent?.listing?.lng ?? null, meetingAt: o.meetingAt, time: "plan", city });
    this.counters.oppsRevealed++; this.counters.oppsAllYes++; this.counters.scheduled++; this.plansCounters.plansBooked++;
    o.stage = STAGE_BY_PHASE[next.phase];
    o.planRun = { ...o.planRun!, plan, stage: "booked" };
    for (const id of keep) o.status.set(id, "yes");
    if (!o.recorded) { o.recorded = true; this.ctx.recordProposal({ ...this.toProposal(o), participants: [...keep] }, "network"); }
    this.ctx.recordMeeting({ proposalId: o.id, participants: [...keep], at: o.meetingAt, city, kind: "plan" });
    this.ctx.log("plan_booked", { oppId: o.id, going: keep.length, quorum: plan.quorum, start: plan.window.start, at: now, city });
    const venueRec = plan.venueId ? this.venues.getVenue(plan.venueId) : undefined;
    this.meetups.registerMeetup({
      meetupId: o.id,
      app: this.app.id,
      city,
      startMs: o.meetingAt,
      participants: [...keep],
      confirmed: [...keep],
      primaryVenueId: plan.venueId ?? plan.eventId ?? o.id,
      ...(o.backupVenueId ? { backupVenueId: o.backupVenueId } : {}),
      venueName: plan.place.name,
      ...(venueRec?.address ? { venueAddress: venueRec.address } : {}),
      ...(venueRec?.arrivalLandmark ? { arrivalLandmark: venueRec.arrivalLandmark } : {}),
    });
    for (const id of keep) this.planReveal(o, id);
  }

  private planReveal(o: Opp, id: MemberId) {
    const plan = o.plan!;
    const m = this.member(id);
    const going = o.participants.filter(p => o.status.get(p) === "yes");
    const others = going.filter(x => x !== id).map(x => this.member(x).display);
    const listing = this.currentPublishedEvent(o)?.listing;
    const curatedLink = venueBookingLink(o, id, o.status.get(id) === "yes", this.now(), isCity(plan.city) ? plan.city : this.networkCity());
    const link = listing?.url ?? curatedLink;
    this.send(m, this.planRevealText(o, id, others) + (link ? `\n${link}` : ""), {
      type: "proposal", proposalId: o.id, participants: [...going], meetingAt: plan.window.start,
      booked: { proposalId: o.id, at: plan.window.start, optOutHours: OPT_OUT_HOURS }, proactive: false,
    }, "reveal", { about: going, hook: { t: "reveal", oppId: o.id, id },
      ...(curatedLink && plan.venueId ? { key: venueBookingNoticeKey(o.id, id, plan.venueId) } : {}) });
  }

  private planRevealText(o: Opp, id: MemberId, others: string[]): string {
    const plan = o.plan!;
    const m = this.member(id);
    const a = plans.activityById.get(plan.activityId)!;
    const where = `${plan.place.name}${plan.place.area ? ` (${plan.place.area})` : ""}`;
    return copy.planBooked(a.label, others, where, whenPhrase(plan.window.start, tzForCity(plan.city)), !m.offerMade && !m.minor);
  }

  /** A late yes after booking (until 6 hours before): the member joins and gets the booked plan; the sim's meeting is updated in place. */
  private planJoin(o: Opp, id: MemberId) {
    if (!this.planMembersAdult(o)) return;
    const plan = o.plan!;
    if (this.publicEventRefusal(o)) { o.status.set(id, "unavailable"); return; }
    const going = o.participants.filter(p => o.status.get(p) === "yes");
    const now = this.now();
    if (this.bookedNear(id, plan.window.start, o.id) || !this.calendarAllows([id], plan.window, now)
      || !this.checkRecipient(id, "reveal", { about: [...going, id], reply: false, opp: o }).ok
      || (this.appPack()?.id === "friends" && !this.planFriendSeatFits(this.planWorld(now, true), id, going, "existingPlan"))) {
      o.status.set(id, "unavailable");
      return;
    }
    o.status.set(id, "yes"); this.plansCounters.planLateJoins++;
    this.ctx.recordMeeting({ proposalId: o.id, participants: [id], at: plan.window.start, city: isCity(plan.city) ? plan.city : this.networkCity(), kind: "plan" });
    this.planReveal(o, id);
  }

  /**
   * No quorum by the deadline (plans ask 7): a smaller plan of the yes-sayers when the activity
   * allows it; else a public event for each yes-sayer; else next week (the demand is carried to the
   * next planner runs). Yes-sayers hear "that plan didn't come together" in their next message, and
   * never who declined.
   */
  private planFallback(o: Opp, eligible?: readonly MemberId[], again = false): void {
    if (!this.planMembersAdult(o)) return;
    if (o.teenRuleAt !== undefined) {
      o.planRun = { ...o.planRun!, stage: "closed" };
      return this.closeTeenItem(o, "plan did not come together");
    }
    const now = this.now();
    if (!again) this.plansCounters.planFallbacks++;
    const run: plans.PlanRun = { ...o.planRun!, stage: "closed" };
    o.planRun = run;
    if (o.replacementFor) {
      for (const id of o.participants) if (o.status.get(id) === "available") this.noteFor(id, copy.planNotTogether);
      return this.close(o, "plan did not come together");
    }
    const w = this.planWorld(now);
    const candidates = eligible ? { ...run, answers: Object.fromEntries(eligible.map(id => [id, run.answers[id]!])) } : run;
    const chosen = plans.planFallback(candidates, now, w.events, this.pcfg);
    const partner = chosen.fallback.kind === "smaller" ? chosen.fallback.partnerPlan : undefined;
    const friends = this.appPack()?.id === "friends";
    const { fallback, carry } = friends && partner && !this.planFriendPartnerFits(this.planWorld(now, true), partner.invited, partner.category)
      ? plans.planFallback(candidates, now, w.events, { ...this.pcfg, fallback: { ...this.pcfg.fallback, smaller: false } })
      : chosen;
    // The friends planner does not read the carry (planFriendsWeek), so friends keeps none.
    if (!friends) this.planCarry.push(...carry);
    if (!again) this.ctx.log("plan_fallback", { oppId: o.id, kind: fallback.kind, members: fallback.kind === "none" ? 0 : fallback.members.length });
    if (fallback.kind === "smaller") {
      if (!fallback.partnerPlan) return this.bookPlan(o, fallback.members, true);
      this.close(o, "plan did not come together");
      for (const id of fallback.members) this.noteFor(id, copy.planNotTogether);
      const partnerPlan = this.submitPlan(fallback.partnerPlan, now);
      if (partnerPlan) partnerPlan.fallbackOf = o.id;
      return;
    }
    this.close(o, "plan did not come together");
    if (fallback.kind === "solo_event") {
      const ev = w.events.find(e => e.id === fallback.eventId);
      const tz = this.cityTz();
      for (const id of fallback.members) {
        const m = this.members.get(id);
        if (m && ev) this.send(m, copy.planEvent(ev.title, whenPhrase(ev.start, tz), ev.listing?.venue ?? ev.area),
          { type: "info", items: [{ key: ev.id, label: ev.title, tags: ev.tags }] }, "info");
      }
    } else if (fallback.kind === "next_week") for (const id of fallback.members) this.noteFor(id, copy.planNotTogether);
  }

  /** A short note folded into the member's next message (never sent alone). */
  private noteFor(id: MemberId, text: string) { const m = this.members.get(id); if (m) m.note = { text, at: this.now() }; }

  /** A plan probe or seat that ends (opt-out, hold, minor, refused send): the member is out of the quorum run. */
  private planOut(o: Opp, id: MemberId) {
    if (!o.planRun) return;
    if (o.planRun.answers[id] === "pending") return this.planAnswer(o, id, false, true);
    if (o.status.get(id) === "available") {
      o.status.set(id, "unavailable");
      o.planRun = { ...o.planRun, answers: { ...o.planRun.answers, [id]: "no" } };
      if (o.replacementFor && o.stage === "probing") this.planFallback(o);
    } else if (o.status.get(id) === "queued") o.status.set(id, "unavailable");
  }

  /**
   * The post-plan answer (plans ask 8): who came, and "would you do it again with this group?".
   * Attendees who both said yes become would_interact_again edges; >= 3 yes after one plan is a crew
   * offer, made once, in the reply to the answer that completed it (crewOptIn).
   */
  private planPost(m: MemberState, o: Opp, body: string, post: NonNullable<Opp["post"]>[MemberId]): string | undefined {
    const going = o.participants.filter(p => o.status.get(p) === "yes");
    const again = planAgainOf(body) === "yes" && post.came;
    o.post = { ...o.post, [m.id]: { ...post, again } };
    const now = this.now();
    if (again) for (const x of going) if (x !== m.id && o.post[x]?.again && this.pairAllowed(m.id, x)) {
      this.planAgain.set(pairKey(m.id, x), now); this.dirty = true;
    }
    return this.crewCheck(m, o, going);
  }

  /** Does the text name this member (full name, "First L." or first name, whole words)? */
  private namedIn(text: string, id: MemberId): boolean {
    const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    const x = this.members.get(id);
    return !!x && x.first.length >= 2 && t.includes(` ${x.first.toLowerCase()} `);
  }

  private crewCheck(m: MemberState, o: Opp, going: MemberId[]): string | undefined {
    if (!this.pcfg.crews.enabled || !o.plan || o.plan.crewId) return undefined;
    const post = o.post ?? {};
    // Already offered after this plan: a later "yes, again" from another attendee joins that one offer.
    const open = this.crewOffers.find(c => c.planId === o.id);
    // spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows"
    if (!this.recurrenceOk(o, [m.id])) return undefined;
    if (open) {
      const before = crewOfferState(open);
      const next = stepCrewOffer(before, { type: "extendOffer", memberId: m.id, enjoyedPlan: !!post[m.id]?.again });
      if (next === before) return undefined;
      open.offered = next.offered;
      open.crew.members = [...open.crew.members, m.id].sort();
      return open.crew.id;
    }
    const w = this.planWorld(this.now());
    const attended = going.filter(id => post[id]?.came);
    const positive = attended.filter(id => post[id]?.again);
    const rec: plans.PlanOutcomeRecord = {
      planId: o.id, activityId: o.plan.activityId, ...(o.plan.venueId ? { venueId: o.plan.venueId } : {}), city: o.plan.city, at: o.plan.window.start,
      attended, positive,
      recurringWant: positive.filter(id => w.get(id)?.intents.some(intent => plans.RECURRING_WANT.test(`${intent.objective} ${intent.details ?? ""}`))),
    };
    const history = [rec];
    if (this.pcfg.crews.minPlans === 2) for (const prior of this.opps.values()) {
      const p = prior.plan;
      if (prior === o || !p || p.crewId || p.activityId !== rec.activityId || p.city !== rec.city || p.window.start >= rec.at) continue;
      const attended = prior.participants.filter(id => prior.status.get(id) === "yes" && prior.post?.[id]?.came);
      const positive = attended.filter(id => prior.post?.[id]?.again && rec.positive.includes(id));
      if (!positive.length) continue;
      history.push({ planId: prior.id, activityId: p.activityId, venueId: p.venueId, city: p.city, at: p.window.start, attended, positive, recurringWant: [] });
    }
    const crew = plans.detectCrews(history, [...this.crews, ...this.crewOffers.map(c => c.crew)], id => !!w.get(id)?.isHost, this.pcfg)
      .find(candidate => candidate.members.includes(m.id));
    if (!crew || !this.recurrenceOk(o, crew.members)) return undefined;
    const a = plans.activityById.get(crew.activityId)!;
    const { offered, yes, no } = stepCrewOffer(initialCrewOffer, { type: "openOffer", invitees: [...crew.members] });
    this.crewOffers.push({ crew, planId: o.id, at: this.now(), offered, yes, no });
    this.plansCounters.crewOffers++;
    this.ctx.log("crew_offered", { crewId: crew.id, oppId: o.id, members: crew.members.length });
    // The others already had their reply: they get the offer as its own short message (not an invite).
    for (const id of crew.members) {
      const x = this.members.get(id);
      if (x && id !== m.id) this.send(x, copy.crewOffer(a.label), { type: "crew_offer", crew: { crewId: crew.id, activity: a.id } }, "info", { about: crew.members, hook: { t: "crew_offer", crewId: crew.id } });
    }
    return crew.members.includes(m.id) ? crew.id : undefined;
  }

  /** A member's answer to a crew offer. When everyone answered (or after 3 days) the crew forms with those who opted in (>= 3), or not at all. */
  private onCrewAnswer(m: MemberState, offer: CrewOffer, yes: boolean) {
    const before = crewOfferState(offer);
    const answered = stepCrewOffer(before, { type: "recordCrewAnswer", memberId: m.id, accepted: yes });
    if (answered === before) return;
    offer.yes = answered.yes; offer.no = answered.no;
    this.ctx.log("crew_answer", { crewId: offer.crew.id, memberId: m.id, yes });
    if (yes) this.ack(m, copy.crewYes);
    else this.ack(m, "No problem.");
    if (stepCrewOffer(answered, { type: "finishCrewAnswers" }).phase === "Resolved") this.resolveCrew(offer);
  }

  private resolveCrew(offer: CrewOffer) {
    offer.resolved = true;
    // spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows"
    const formed = this.recurrenceOk(this.opps.get(offer.planId), offer.crew.members) ? plans.crewOptIn(offer.crew, offer.yes, this.pcfg) : undefined;
    const a = plans.activityById.get(offer.crew.activityId)!;
    this.ctx.log(formed ? "crew_formed" : "crew_not_formed", { crewId: offer.crew.id, yes: offer.yes.length, offered: offer.offered.length });
    if (formed) { this.crews.push(formed); this.plansCounters.crewsFormed++; }
    for (const id of offer.yes) {
      const m = this.members.get(id);
      if (m && !this.knownMinor(id)) this.send(m, formed ? copy.crewFormed(a.label) : copy.crewNotFormed, { type: "info" }, "info");
    }
  }

  private crewWindowAvailable(member: MemberState, slot: attention.TimeSlot, now: number): boolean {
    const statedAllows = plans.planWindowMatchesStated(member.stated, slot, now);
    // spec/crewOffer.md, "A new recurring session needs a currently usable time"
    return crewMemberWindowAvailable(this.inNyc(member.id, now, slot.end), !this.bookedNear(member.id, slot.start), statedAllows);
  }

  /**
   * Crew sessions (plans ask 8): weekly, same time and place, each session opt-in and reviewed like
   * any plan; the host rotates; the Network hands the crew off after 3 sessions reach feedback. The host's organizing
   * reach (NC ask 3) may add members: every slot above the base 8 is reserved for members with the
   * least recent participation who fit the activity (the exposure floor).
   */
  private crewSessions(now: number) {
    for (const offer of this.crewOffers) {
      if (offer.resolved) continue;
      const next = stepCrewOffer(crewOfferState(offer), { type: "expireCrewOffer", elapsedMs: now - offer.at });
      if (next.phase === "Resolved") this.resolveCrew(offer);
    }
    let world: EngineWorld | undefined;
    for (const crew of this.crews) {
      // spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows"
      if (crew.handedOff || !this.recurrenceOk(this.crewSource(crew.id), crew.members)) continue;
      const sessions = [...this.opps.values()].filter(o => o.plan?.crewId === crew.id);
      const openSession = sessions.some(o => OPEN_STAGES.has(o.stage));
      // spec/crewOffer.md, "Handoff counts booked sessions that reached feedback"
      if (crewHandoffDue(openSession, sessions.filter(o => o.stage === "done").length, this.pcfg.crews.handOffAfterSessions)) {
        crew.handedOff = true;
        this.ctx.log("crew_handoff", { crewId: crew.id });
        continue;
      }
      if (openSession) continue;
      const venue = planVenuesForCity(isCity(crew.city) ? crew.city : this.networkCity()).find(x => x.id === crew.venueId);
      const activity = plans.activityById.get(crew.activityId);
      if (!venue || !activity) continue;
      const eligible = crew.members.filter(id => { const m = this.members.get(id); return !!m && this.planSeatOk(m); });
      const host = crew.hostRotation[crew.sessions.length % crew.hostRotation.length];
      const ordered = host && eligible.includes(host) ? [host, ...eligible.filter(id => id !== host)] : eligible;
      const selected = new Set<MemberId>();
      for (const id of ordered) if ([...selected].every(other => this.pairAllowed(other, id))) selected.add(id);
      const members = eligible.filter(id => selected.has(id));
      if (members.length < this.pcfg.crews.minMembers) continue;
      world ??= this.planWorld(now, true);
      const next = plans.crewSessionPlan(world, { ...crew, members, hostRotation: crew.hostRotation.filter(h => members.includes(h)).length ? crew.hostRotation.filter(h => members.includes(h)) : members }, now, venue, this.pcfg);
      if (!next || crew.sessions.includes(next.id)) continue;
      // spec/crewOffer.md, "A new recurring session uses a current public venue"
      const open = plans.venueOpenForSlot(venue, next.window, activity.durationMin, world.cfg.timezones[crew.city] ?? NY);
      if (!crewSessionVenueAllowed(venue.public, venue.city === crew.city, venue.activities.includes(activity.id), open)
        || !members.every(id => this.crewWindowAvailable(this.member(id), next.window, now))) continue;
      const plan = this.withReach(next, now);
      if (!this.submitPlan(plan, now)) continue;
      crew.sessions.push(plan.id);
      this.plansCounters.crewSessions++;
      this.ctx.log("crew_session", { crewId: crew.id, session: crew.sessions.length, invited: plan.invited.length });
    }
  }

  /** Organizing reach for a hosted plan (NC ask 3): base slots for the host's circle, reserved slots above the base 8 for the least-exposed members who fit. */
  private withReach(plan: plans.Plan, now: number): plans.Plan {
    const host = plan.hostId;
    if (!host || !this.opts.capital || teenRosterWithHost({ participants: plan.invited, alternates: [], plan }).some(id => !this.adultMember(id))) return plan;
    const reach = this.opts.capital.organizingReach(host, now);
    const invited = plan.invited.slice(0, Math.max(1, Math.min(plan.invited.length, reach.max, BASE_REACH)));
    const extra = Math.min(reach.reservedForLowExposure, reach.max - invited.length);
    if (extra <= 0) return { ...plan, invited };
    const w = this.planWorld(now);
    const a = plans.activityById.get(plan.activityId)!;
    const last = this.lastParticipation(now);
    const friends = w.pack.id === "friends";
    const ranked = [...this.members.values()]
      .filter(m => !invited.includes(m.id) && !plan.alternates.includes(m.id) && this.adultMember(m.id) && this.planSeatOk(m) && (m.age ?? this.statedToday(m) ?? 0) >= a.ageMin && this.crewWindowAvailable(m, plan.window, now)
        && (plans.activityFit(w, m.id, this.pcfg).get(plan.activityId) ?? 0) >= this.pcfg.minFit)
      .sort((x, y) => ((last.get(x.id) ?? -Infinity) - (last.get(y.id) ?? -Infinity)) || (x.id < y.id ? -1 : 1));
    const add: MemberId[] = [];
    // spec/capitalLevers.md, "Earned organizing reach reserves the extra slots for low exposure"
    for (const { id } of ranked) {
      if (add.length >= extra) break;
      const seated = [...new Set([host, ...invited, ...plan.alternates, ...add])];
      const seatFits = seated.every(other => this.pairAllowed(other, id))
        && (!friends || this.planFriendSeatFits(w, id, [...invited, ...add], "discovery"));
      if (organizingReachSeatTaken(add.length, extra, seatFits)) add.push(id);
    }
    this.plansCounters.reachExtra += add.length;
    this.ctx.log("organizing_reach", { planId: plan.id, host, max: reach.max, reserved: reach.reservedForLowExposure, added: add.length });
    return { ...plan, invited: [...invited, ...add], size: { ...plan.size, target: invited.length + add.length, max: Math.max(plan.size.max, invited.length + add.length) } };
  }

  // ================================================================== tick
  async tick(now: number, engine: EngineStep = inlineEngine) {
    now = Math.floor(now);
    if (this.lastTick && now > this.lastTick) this.tickGap = now - this.lastTick;
    this.lastTick = now;
    for (const m of [...this.members.values()]) {
      this.syncMember(m);
      const awaiting = m.awaiting;
      if (awaiting?.kind === "booked") {
        const start = this.opps.get(awaiting.oppId ?? "")?.meetingAt;
        if (releaseBookingReply(now - awaiting.at, start !== undefined, start !== undefined && now >= start)) m.awaiting = undefined;
      }
      this.refreshUnanswered(m, now);
      if (m.pendingInviteDraft && !memberInviteDraftCurrent(now - m.pendingInviteDraft.at)) m.pendingInviteDraft = undefined;
      if (m.pendingInviteJoins?.length) m.pendingInviteJoins = m.pendingInviteJoins.filter(notice => now - notice.at < inviteJoinNoticeLifetimeMs);
    }
    this.retainMemberStanding(now);
    this.queueGatheringRepeats();
    if (this.teenIntrosEnabled() && earliestDayKeyOf(now) !== this.teenDayKey) { this.teenDayKey = earliestDayKeyOf(now); this.teenCachesChanged(); }
    this.teenSweep();
    this.reviewStep(now);
    for (const o of this.openOpps()) {
      const pair = pairsOf(this.blockRoster(o)).find(([a, b]) => this.blocked(a, b));
      if (pair) this.closeForPairBlock(o, pair[0], pair[1], false);
      if (!OPEN_STAGES.has(o.stage) || o.stage === "scheduled") continue;
      if (this.holdHelpOpportunity(o)) {
        this.close(o, "bounded help needs safety review");
        continue;
      }
      const publicEventIssue = this.publicEventRefusal(o);
      if (publicEventIssue) this.close(o, publicEventIssue);
    }
    // Deferred sends whose window may have come. Each one runs every send-time check again.
    const waiting = this.deferred; this.deferred = [];
    for (const d of waiting) {
      const m = this.members.get(d.memberId);
      if (!m) continue;
      const valid = this.hookFns(m, d.o.hook).valid;
      if (valid && !valid()) continue;
      if (!this.timingOk(m, d.timing ?? "logistics", now)) { this.deferred.push(d); continue; }
      // spec/meetingReschedule.md, "A named booking notice still needs every recorded seat"
      const booking = d.o.hook?.t === "reveal" ? this.opps.get(d.o.hook.oppId) : undefined;
      const roster = d.meta.participants;
      if (booking?.kind === "group" && !bookingNoticeRosterCurrent(true, roster !== undefined,
        roster?.includes(m.id) === true, roster?.every(id => booking.status.get(id) === "yes") === true)) {
        if (booking.plan) this.planReveal(booking, m.id);
        else this.bookingReveal(booking, m.id);
      } else this.send(m, d.body, d.meta, d.kind, d.o);
    }
    for (const o of [...this.opps.values()]) this.advance(o, now);
    this.meetups.tick(now, { proactiveBriefs: this.opts.arrivalBriefs });
    this.checkSeats();
    for (const m of this.members.values()) {
      const aw = m.awaiting;
      if (!aw) continue;
      if (aw.kind !== "probe" && aw.kind !== "booked" && now - aw.at > 3 * DAY) m.awaiting = undefined;
    }
    const p = localDateParts(now, this.cityTz());
    this.weeklyCheckins(now);
    this.sendInterruptionSurveys(now);
    this.askStandingRenewals(now);
    if (p.hour >= this.opts.runHour && p.hour < ENGINE_RUN_UNTIL) {
      if (this.lastRunDay !== p.day) {
        this.lastRunDay = p.day;
        this.trust.decay(now);
        // Matching off: no engine run and no new opportunities. Growth asks and re-engagement continue.
        if (this.opts.matchingEnabled) { this.retryRequests(now); await this.dailyRun(now, p.day, engine); }
        this.localEncounters(now);
        this.reengage(now);
        this.queueFraudFlags(now);
      } else if (this.opts.matchingEnabled) await this.recheckStandingIntents(now, p.day, engine);
    }
    // Plans: the planner (Mondays and Thursdays) and crew sessions, after the daily engine run.
    if (this.plansOn() && p.hour >= this.opts.runHour && p.hour < ENGINE_RUN_UNTIL && this.lastPlanRunDay !== p.day) {
      this.runPlanner(now);
      if (this.lastPlanRunDay !== p.day) this.lastPlanRunDay = p.day;
      this.crewSessions(now);
    }
    this.inlineJudgeStep(now);
  }

  submitProposal(p: Proposal) { this.queued.push(p); }

  /** An invitation that received a direct explicit answer may earn one sample. */
  private sampleInterruption(m: MemberState, opportunityId: string, acceptedDelivery = this.invitesBeforeReply.has(opportunityId)) {
    const bucket = interruptionSampleBucket(this.app.id, m.id, opportunityId);
    if (interruptionFeedbackSample(bucket, acceptedDelivery, this.memberReply, !!m.interruptionSurvey)) {
      m.interruptionSurvey = { opportunityId, answeredAt: this.now() };
    }
  }

  private sendInterruptionSurveys(now: number) {
    for (const m of this.members.values()) {
      const survey = m.interruptionSurvey;
      if (!survey) continue;
      const eligible = !m.account && m.stage === "active" && !m.minor && !m.optedOut && !m.onlyWhenAsked
        && m.state !== "paused" && this.trust.ok(m.id) && !this.reportHeld(m.id);
      if (!eligible || !this.opps.has(survey.opportunityId) || (survey.sentAt === undefined
        ? now - survey.answeredAt >= interruptionAskUntilMs : now - survey.sentAt >= interruptionAnswerMs)) {
        m.interruptionSurvey = undefined;
        continue;
      }
      const safetyQuestionOpen = !!m.pendingSafety && safetyQuestionIsCurrent(m.pendingSafety.at, now - DAY);
      if (survey.sentAt !== undefined || !interruptionFeedbackAskDue(now - survey.answeredAt, eligible,
        !!m.awaiting || safetyQuestionOpen || this.askOpen(m, now)) || !this.timingOk(m, "slot", now)) continue;
      const code = interruptionFeedbackCode(this.app.id, m.id, survey.opportunityId);
      const responseKey = `${this.app.id.toUpperCase()} ${code}`;
      const body = `Was that invitation worth a text? Reply WORTH YES ${responseKey} or WORTH NO ${responseKey}.`;
      const key = interruptionFeedbackKey(this.app.id, m.id, survey.opportunityId);
      if (this.send(m, body, { type: "question" }, "worthwhile", { key, noDefer: true }) === "sent") survey.sentAt = now;
    }
  }

  private plainInterruptionSurveyAnswer(m: MemberState, body: string, reaction?: boolean): { worthwhile: boolean; app: string; code: string } | undefined {
    if (!this.memberReply || reaction || m.awaiting || m.pendingSafety || m.posting) return undefined;
    const survey = m.interruptionSurvey;
    if (!survey || survey.sentAt === undefined) return undefined;
    const trimmed = body.trim();
    if (!BARE_SURVEY_YES_NO_RE.test(trimmed)) return undefined;
    const yn = consentOf(trimmed).answer;
    if (yn !== "yes" && yn !== "no") return undefined;
    return { worthwhile: yn === "yes", app: this.app.id, code: interruptionFeedbackCode(this.app.id, m.id, survey.opportunityId) };
  }

  private recordInterruptionFeedback(m: MemberState, answer: { worthwhile: boolean; app: string; code: string }, now: number, receivedAt: number) {
    const survey = m.interruptionSurvey;
    if (!survey || survey.sentAt === undefined || answer.app !== this.app.id) return;
    const current = interruptionFeedbackCurrent(now - survey.sentAt,
      this.checkRecipient(m.id, "worthwhile", { reply: false }).ok && m.state !== "paused" && this.opps.has(survey.opportunityId));
    const receipt = this.ctx.initialInviteReceipt?.(interruptionFeedbackKey(this.app.id, m.id, survey.opportunityId));
    const acceptedAt = this.ctx.initialInviteReceipt ? (receipt?.kind === "accepted" ? receipt.at : undefined) : survey.sentAt;
    const reachedMember = acceptedAt !== undefined && receivedAt >= acceptedAt;
    if (!interruptionFeedbackReply(this.memberReply, answer.code === interruptionFeedbackCode(this.app.id, m.id, survey.opportunityId), current, reachedMember)) return;
    m.interruptionSurvey = undefined;
    this.ctx.log("interruption_feedback", { worthwhile: answer.worthwhile });
    this.send(m, "Thanks for the feedback.", { type: "info" }, "reply");
  }

  /**
   * The opt-in weekly "what's your week like?" (founder decision 4d): on the configured weekday
   * (attention availability.weeklyCheckIn.day), in the member's send window. A profiling ask: never
   * on the cap, held by the one-question rule, never for members aged 13-17.
   */
  private weeklyCheckins(now: number) {
    const day = (localParts(now, this.cityTz()).weekday + 1) % 7; // JS weekday (Sunday = 0)
    if (day !== DEFAULT_ATTENTION.availability.weeklyCheckIn.day) return;
    for (const m of this.members.values()) {
      if (!m.weekly || m.minor || m.optedOut || m.onlyWhenAsked || (m.lastCheckinAt !== undefined && now - m.lastCheckinAt < 5 * DAY)) continue;
      if (!this.timingOk(m, "slot", now) || this.deferred.some(d => d.memberId === m.id && d.kind === "checkin")) continue;
      this.send(m, this.copy.weeklyCheckin, { type: "question", proactive: false, checkIn: true } as SimMeta, "checkin", { hook: { t: "checkin" } });
    }
  }

  /** F28: two unanswered invitations move the member to "only when I ask". */
  private refreshUnanswered(m: MemberState, now: number) {
    // spec/outreachPolicy.md, "Count a sent invitation at terminal expiry or after 72 hours"
    m.pendingAsks = m.pendingAsks.filter(invite => {
      if (invite.deliveryId === undefined || invite.acceptedAt !== undefined) return true;
      const receipt = this.ctx.initialInviteReceipt?.(invite.deliveryId);
      if (receipt?.kind === "not_sent") return false;
      if (receipt?.kind === "accepted") invite.acceptedAt = receipt.at;
      return true;
    });
    m.unanswered = m.pendingAsks.filter(invite => {
      const acceptedAt = invite.deliveryId === undefined ? invite.at : invite.acceptedAt;
      return unansweredInviteCounts(acceptedAt !== undefined, acceptedAt ?? 0, invite.expiredAt !== undefined, invite.expiredAt ?? 0, now);
    }).length;
    if (unansweredInvitePause(m.unanswered) && !m.onlyWhenAsked) {
      m.onlyWhenAsked = true; this.counters.onlyWhenAsked++;
      this.ctx.log("only_when_asked", { memberId: m.id, unanswered: m.unanswered });
    }
  }

  private expireInitialInvitation(o: Opp, id: MemberId, expiredAt: number, now: number) {
    const member = this.members.get(id);
    if (!member) return;
    const invite = member.pendingAsks.find(ask => ask.opportunityId === o.id);
    if (!invite || invite.expiredAt !== undefined) return;
    invite.expiredAt = expiredAt;
    this.refreshUnanswered(member, now);
  }

  private expirePlanInvitations(o: Opp, expiredAt: number, now: number) {
    if (!o.planRun) return;
    for (const id of plans.pendingOf(o.planRun)) {
      const sentAt = o.sentAt?.[id];
      if (sentAt !== undefined) this.expireInitialInvitation(o, id, Math.min(expiredAt, sentAt + this.probeWindow(false)), now);
    }
  }

  /** spec/outreachPolicy.md, "Re-engagement requires current evidence of silence" */
  private reengagementCurrent(m: MemberState, now: number): boolean {
    return !m.optedOut && !m.minor && reengagementMayStage(m.onlyWhenAsked, m.lastInbound, m.lastAskAt, m.heldHighAt ?? 0, now);
  }

  /** Exactly one re-engagement after 30 days of silence for members on "only when I ask". */
  private reengage(now: number) {
    const waiting = new Set(this.deferred.filter(item => item.kind === "reengage").map(item => item.memberId));
    for (const m of this.members.values()) {
      if (m.reengaged || waiting.has(m.id) || !this.reengagementCurrent(m, now)) continue;
      this.send(m, copy.reengage, { type: "question", proactive: true, reengagement: true }, "reengage", { hook: { t: "reengage" } });
    }
  }

  private advance(o: Opp, now: number) {
    if (o.reschedule && (o.stage !== "scheduled" || now >= o.reschedule.expiresAt
      || !sameRescheduleRoster(o.reschedule.roster, this.rescheduleRoster(o)))) o.reschedule = undefined;
    if (o.stage === "review" && o.review && reviewLate(now, o.review.deadline)) {
      const state = reviewStateOf(o);
      if (canExpireReview(state, true) && expireReview(state, true).phase === "ReviewExpired") {
        o.review.decision = "expired"; o.review.decidedAt = now;
        this.counters.reviewExpired++;
        this.ctx.log("review_expired", { oppId: o.id });
        const exception = o.review.exception;
        if (exception?.revision === state.revision) {
          this.markDeclined(o.participants, now);
          if (exception.verdict === "flag") this.flagPairs(o, exception.reason, now);
        }
        this.close(o, "review expired");
        return;
      }
    }
    if (o.plan && o.planRun && (o.stage === "probing" || o.stage === "scheduled")) {
      const deadline = o.plan.probeDeadline;
      const lateJoinAt = o.plan.window.start - this.pcfg.lateJoinHours * HOUR;
      if (o.stage === "probing" && now >= deadline) this.expirePlanInvitations(o, deadline, now);
      if (o.stage === "scheduled" && now > lateJoinAt) this.expirePlanInvitations(o, lateJoinAt, now);
      for (const p of Object.keys(o.planRun.answers)) {
        const sent = o.sentAt?.[p];
        if (o.planRun.answers[p] !== "pending" || sent === undefined) continue;
        const m = this.members.get(p);
        const receiptKey = o.replacementFor ? replacementProbeKey(o.id, p)
          : probeReplyReceiptKey(o.id, p, planProbeReceiptSlot(o.id, sent, m));
        const receipt = this.ctx.initialInviteReceipt?.(receiptKey);
        const decision = pendingPlanInviteDecision(true, receipt?.kind === "not_sent", probeExpired(now, sent + this.probeWindow(false)));
        if (decision === "WaitForPlanAnswer") continue;
        if (decision === "PlanInviteUnsent") {
          if (m) this.refreshUnanswered(m, now);
          this.ctx.log("plan_probe_unavailable", { oppId: o.id, memberId: p, reason: "not_delivered" });
        } else {
          this.expireInitialInvitation(o, p, sent + this.probeWindow(false), now);
          this.counters.probeExpired++;
          this.ctx.log("probe_answer", { oppId: o.id, memberId: p, yes: false, expired: true, plan: true });
          // spec/probeReply.md, "A late answer to an expired probe hears once that the invitation ended"
          if (m?.awaiting?.kind === "probe" && m.awaiting.oppId === o.id) {
            m.endedProbe = { oppId: o.id, sentAt: m.awaiting.at, endedAt: now, told: false, receiptKey, plan: true,
              receiptId: o.replacementFor ? replacementProbeKey(o.id, p) : planProbeReceiptSlot(o.id, sent, m).probeReceiptId };
          }
        }
        if (m?.awaiting?.kind === "probe" && m.awaiting.oppId === o.id) m.awaiting = undefined;
        this.planAnswer(o, p, false, true);
      }
      if (o.stage === "probing" && o.planRun.stage === "probing") {
        const r = plans.checkPlanDeadline(o.planRun, now);
        if (r.action.kind === "fallback") { o.planRun = r.run; this.planFallback(o); }
      }
      this.planLane(o, now);
    }
    if (o.stage === "probing" && !o.plan) {
      for (const p of [...o.participants]) {
        if (o.stage !== "probing") continue;
        const current = participantProbe(o, p);
        const sent = o.sentAt?.[p];
        const deadline = probeExpiryDeadline(sent !== undefined, (sent ?? 0) + this.probeWindow(!!o.timeRetry?.includes(p)), (o.turnAt?.[p] ?? o.createdAt) + PROBE_WAIT);
        const next = stepProbe(current, { type: "expireProbe", expired: probeExpired(now, deadline), timeQuestion: !!o.timeRetry?.includes(p) });
        if (next === current) continue;
        const m = this.members.get(p);
        if (next.phase === "Available") { if (m?.awaiting?.oppId === o.id) m.awaiting = undefined; storeProbe(o, p, next); continue; }
        if (sent !== undefined) this.expireInitialInvitation(o, p, deadline, now);
        if (current.told) { this.counters.probeExpired++; this.ctx.log("probe_answer", { oppId: o.id, memberId: p, yes: false, expired: true }); o.noAnswer = [...(o.noAnswer ?? []), p]; }
        // spec/probeReply.md, "A late answer to an expired probe hears once that the invitation ended"
        if (m?.awaiting?.kind === "probe" && m.awaiting.oppId === o.id && sent !== undefined) {
          m.endedProbe = { oppId: o.id, sentAt: m.awaiting.at, endedAt: now, told: false, receiptId: m.awaiting.probeReceiptId,
            receiptKey: isGatheringRepeat(o) ? gatheringRepeatProbeKey(o.id, p, !!o.timeRetry?.includes(p)) : probeReplyReceiptKey(o.id, p, m.awaiting) };
        }
        if (m?.awaiting?.oppId === o.id) m.awaiting = undefined;
        o.status.set(p, "unavailable");
        this.replaceOrClose(o, p);
      }
      // Probes whose turn came while the member was outside their send window go out when it opens.
      this.advanceProbes(o);
    }
    if (o.stage === "scheduled" && o.meetingAt) {
      // The pre-plan confirmation: 48 hours of silence after the booked plan reached them (or the start) confirms it.
      for (const id of o.bookedTold ?? []) {
        const at = o.bookedAt?.[id];
        if (silentConfirmationDue(o.status.get(id) === "yes", at !== undefined, (o.confirmed ?? []).includes(id),
          now - (at ?? 0), now >= o.meetingAt)) this.confirmPlan(o, id, false);
      }
      if (o.workIntro) {
        const sentAt = o.workIntro.emailSentAt ?? o.seatAcceptedAt ?? (o.workIntro.followupDueAt !== undefined ? o.workIntro.followupDueAt - 7 * DAY : o.meetingAt);
        const outcomeDueAt = o.workIntro.followupDueAt ?? (sentAt + 7 * DAY);
        const job = { title: o.seat ? this.seatTitle(o.seat.id) : o.lane === "Cofounder" ? "the cofounder intro" : "the intro", must: [] };
        // T+72h bounce check: confirm the warm intro connected.
        if (!o.workBounceSent && !o.feedbackSent && now >= sentAt + 72 * HOUR && now < outcomeDueAt) {
          o.workBounceSent = true;
          const going = o.participants.filter(x => o.status.get(x) === "yes");
          for (const id of going) {
            const m = this.member(id);
            const other = going.find(x => x !== id);
            const otherName = other ? this.member(other).first : "them";
            this.send(m, SEAT_COPY.workBounceCheck(job, otherName), { type: "info", proposalId: o.id }, "info", {
              about: going, key: `work-bounce:${o.id}:${id}`,
            });
          }
          this.ctx.log("work_intro_bounce_check", { oppId: o.id, channel: o.workIntro.channel });
        }
        // T+7d outcome check-in.
        if (!o.feedbackSent && now >= outcomeDueAt) {
          const going = o.participants.filter(x => o.status.get(x) === "yes");
          const blockedByCap = going.length > 0 && now < outcomeDueAt + DAY && going.every(id => {
            const m = this.member(id);
            return !m.optedOut && !evaluateFollowupSend({
              optedOut: false, isQuietHours: false, dailyProactiveCount: this.dailyProactiveCount(m, now), remindersSent: 0,
            });
          });
          if (!blockedByCap) {
            const next = stepOpportunity(opportunityLifecycle(o), { type: "complete", feedbackDue: true });
            if (next.phase === "Done") {
              o.feedbackSent = true;
              o.stage = STAGE_BY_PHASE[next.phase];
              for (const id of going) {
                const m = this.member(id);
                const others = going.filter(x => x !== id).map(x => this.member(x).first).join(" and ") || "them";
                const text = this.opts.hooks?.checkIn?.(this.hookOpp(o), id, others) ?? SEAT_COPY.workOutcomeCheckIn(job, others);
                this.send(m, text, { type: "feedback_request", proposalId: o.id }, "feedback", {
                  about: going, key: meetingFeedbackKey(o.id, id, o.scheduleRevision), hook: { t: "feedback", oppId: o.id },
                });
              }
              this.ctx.log("work_intro_outcome_checkin", { oppId: o.id, channel: o.workIntro.channel });
            }
          }
        }
        return;
      }
      // Send a day-before reminder in its own window. Aim for a near reminder at T-3h,
      // otherwise at the last allowed tick before the meeting.
      // A job intro has no meeting the Network booked: no reminder (the two arrange it through the agent).
      const tz = o.meetingTimeZone ?? this.cityTz();
      const remaining = o.meetingAt - now;
      const sameLocalDay = localDateParts(now, tz).day === localDateParts(o.meetingAt, tz).day;
      const panicHalted = this.isOppPanicHalted(o.id, o.participants);
      const unifiedPreBrief = Boolean(this.opts.arrivalBriefs && o.teenRuleAt === undefined && this.meetups.getMeetup(o.id));
      for (const id of o.seat || panicHalted ? [] : o.participants) {
        if (o.status.get(id) !== "yes" || remaining <= 0 || remaining > DAY) continue;
        const m = this.members.get(id);
        if (!m || !this.timingOk(m, "logistics", now)) continue;
        const earlySent = (o.dayBeforeReminded ?? []).includes(id);
        const booked = o.bookedAt?.[id] !== undefined && o.bookedTold?.includes(id) === true;
        if (!booked) continue;
        const early = dayBeforeReminderDue(true, true, earlySent, remaining);
        if (!early && unifiedPreBrief) continue;
        if (!early && (o.reminded.has(id) || !nearMeetingReminderWindow(remaining))) continue;
        if (!early && remaining > nearMeetingReminderLeadMs && this.laterAllowedTick(m, now, o.meetingAt - HOUR)) continue;
        // spec/meetingSettlement.md, "The day-of check-in uses one near-meeting message"
        const replySlotAvailable = !m.awaiting || (m.awaiting.kind === "booked" && m.awaiting.oppId === o.id);
        const checkIn = !early && dayOfCheckInDue(sameLocalDay, replySlotAvailable, remaining);
        const kind = early ? "day-before-reminder" : checkIn ? "day-of-checkin" : "near-meeting-reminder";
        const text = (checkIn ? copy.dayOfCheckIn : copy.reminder)(whenPhrase(o.meetingAt, tz), `${o.venue}`);
        const result = this.send(m, text, { type: "reminder", proposalId: o.id }, "reminder", {
          about: o.participants.filter(p => o.status.get(p) === "yes"), noDefer: true,
          key: bookedReminderKey(kind, o.id, id, o.scheduleRevision),
        });
        if (result !== "sent") continue;
        if (early) o.dayBeforeReminded = [...(o.dayBeforeReminded ?? []), id];
        else o.reminded.add(id);
        if (checkIn) this.expect(m, { kind: "booked", oppId: o.id, at: now,
          bookedCheckIn: { meetingAt: o.meetingAt, revision: o.scheduleRevision ?? 0 } });
      }
      const eventEnd = o.plan ? o.plan.window.end : o.meetingAt + HOUR;
      const computedFeedbackAt = o.followupAt ?? computeFollowupTimestamp(eventEnd, tz).scheduledAt;
      const feedbackAt = Math.max(o.meetingAt + feedbackDelayHours * HOUR, computedFeedbackAt);
      const settlement = stepMeetingSettlement(initialMeetingSettlement, {
        type: "requestFeedback", unsent: !o.feedbackSent, asOf: now, feedbackAt,
      });
      const goingForCap = o.participants.filter(x => o.status.get(x) === "yes");
      const allCapBlocked = settlement.phase === "AwaitingAttendance" && now < feedbackAt + DAY && goingForCap.length > 0 && goingForCap.every(id => {
        const m = this.member(id);
        return !m.optedOut && !evaluateFollowupSend({
          optedOut: false, isQuietHours: false, dailyProactiveCount: this.dailyProactiveCount(m, now), remindersSent: 0,
        });
      });
      const next = stepOpportunity(opportunityLifecycle(o), { type: "complete", feedbackDue: settlement.phase === "AwaitingAttendance" && !allCapBlocked });
      if (next.phase === "Done") {
        o.feedbackSent = true;
        o.stage = STAGE_BY_PHASE[next.phase];
        // A plan's probes still waiting are over: the plan has happened.
        if (o.planRun) for (const [p, a] of Object.entries(o.planRun.answers)) if (a === "pending") {
          o.status.set(p, "unavailable");
          const m = this.members.get(p);
          if (m?.awaiting?.oppId === o.id) m.awaiting = undefined;
        }
        const label = o.plan ? plans.activityById.get(o.plan.activityId)?.label ?? "it" : "";
        for (const id of o.participants) if (o.status.get(id) === "yes") {
          const m = this.member(id);
          const going = o.participants.filter(x => o.status.get(x) === "yes");
          const others = going.filter(x => x !== id).map(x => this.member(x).first).join(" and ") || "the group";
          this.send(m, o.plan ? copy.planFeedbackAsk(label) : o.teenRuleAt !== undefined ? copy.feedbackAsk("them") : this.opts.hooks?.checkIn?.(this.hookOpp(o), id, others) ?? copy.feedbackAsk(others), {
            type: "feedback_request", proposalId: o.id, ...(o.plan ? { plan: { planId: o.id, activity: o.plan.activityId } } : {}),
          }, "feedback", { about: going, key: meetingFeedbackKey(o.id, id, o.scheduleRevision), hook: { t: "feedback", oppId: o.id } });
        }
      }
    }
    // Attendance is resolved once everyone booked answered, or 4 days after the meeting (NC events).
    if (o.stage === "done" && o.meetingAt !== undefined) {
      const current = restoreAttendance(!!o.finalized);
      if (current.phase !== "AwaitingAttendance") return;
      const going = o.participants.filter(p => o.status.get(p) === "yes");
      const settlementAnchor = o.workIntro ? (o.workIntro.followupDueAt ?? o.meetingAt) : o.meetingAt;
      const timedOut = now >= settlementAnchor + settlementDelayDays * DAY;
      const settlement = stepMeetingSettlement(current, {
        type: "resolveAttendance", timedOut, everyoneResponded: !timedOut && going.every(p => o.post?.[p]),
      });
      if (settlement.phase === "SettlementComplete") this.finalize(o);
    }
  }

  /** Is there a later tick before `limit` when this member may be texted? */
  private laterAllowedTick(m: MemberState, now: number, limit: number): boolean {
    for (let t = now + this.tickGap; t < limit; t += this.tickGap) if (this.timingOk(m, "logistics", t)) return true;
    return false;
  }

  // ================================================================== engine
  private async dailyRun(now: number, day: string, engine: EngineStep) {
    // Player (or scenario) proposals first: they go through the same consent flow.
    const queued = this.queued; this.queued = [];
    for (const p of queued) this.fromProposal(p, "player", now);
    const input = this.packInput(now);
    const { fingerprint } = this.standingIntentEvidence(input);
    const queuedToday = await this.runMatching(input, now, this.opts.maxNewPerDay, engine);
    this.standingIntentSearch = { day, fingerprint, queuedToday };
  }

  private async recheckStandingIntents(now: number, day: string, engine: EngineStep) {
    const previous = this.standingIntentSearch;
    const cap = this.opts.maxNewPerDay;
    if (previous?.day !== day || !canQueueEngineOpportunity(previous.queuedToday, cap)) return;
    const input = this.packInput(now);
    const { fingerprint, intentIds } = this.standingIntentEvidence(input);
    if (!standingIntentRecheckDue(previous.fingerprint, fingerprint, intentIds.length, previous.queuedToday, cap)) return;
    const started = await this.runMatching({ ...input, standingIntentSearch: intentIds }, now, cap - previous.queuedToday, engine);
    this.standingIntentSearch = { day, fingerprint, queuedToday: previous.queuedToday + started };
  }

  private standingIntentEvidence(input: EngineInput): { fingerprint: string; intentIds: string[] } {
    const held = new Set(input.safetyHolds?.map(hold => hold.memberId));
    const members = (input.members as MemberRecord[]).filter(m => {
      const state = this.members.get(m.id);
      return state && state.stage !== "new" && canBeMatched(m.age) && !held.has(m.id)
        && !state.optedOut && m.state !== "paused" && m.accountStatus !== "paused" && m.accountStatus !== "restricted";
    });
    const ids = new Set(members.map(m => m.id));
    const markets = new Set(this.effectiveEngineConfig().cities);
    const intents = input.intents.filter(i => ids.has(i.memberId) && standingIntentLive(i, input.now));
    if (!intents.length) return { fingerprint: "", intentIds: [] };
    const facets = input.facets.filter(f => ids.has(f.memberId) && standingIntentFacetEvidence(f.scope,
      (f.validFrom === undefined || f.validFrom <= input.now) && (f.validTo === undefined || f.validTo >= input.now),
    ));
    // The projection time on a learned facet changes on every tick. Its usable content does not.
    const facetEvidence = facets.map(({ validFrom, validTo, observedAt, ...facet }) => facet);
    const presence = input.presence.flatMap(p => {
      const eligible = ids.has(p.memberId) && (p.type !== "temporary" || temporaryPresenceWindow(p) !== undefined);
      const phase = standingPresencePhase(eligible, p.from !== undefined, p.from ?? 0, p.to !== undefined, p.to ?? 0, input.now);
      return phase === "IgnorePresence" ? [] : [stableStringify({ ...p, phase })];
    }).sort();
    const evidence = {
      members: members.map(({ id, age, state, homeCity, prefs }) => ({ id, age, state, homeCity, prefs })).map(stableStringify).sort(),
      facets: facetEvidence.map(stableStringify).sort(),
      intents: intents.map(stableStringify).sort(),
      presence,
      events: (input.events ?? []).filter(event => markets.has(event.city) && event.end > input.now).map(stableStringify).sort(),
    };
    return { fingerprint: sha256(stableStringify(evidence)), intentIds: intents.map(i => i.id).sort() };
  }

  // spec/judgmentAttempt.md: keep independent caches for this app and city process.
  private matchingJudgeCaches?: { ttlMs: number; caches: Required<Pick<EngineDeps, "judgeCache" | "screenCache" | "deepCache">> };

  private async runMatching(input: EngineInput, now: number, allowance: number, engine: EngineStep) {
    const config = this.effectiveEngineConfig();
    const { engineLLM: llm, pack } = this.opts;
    if (llm && config.judge?.enabled) {
      const ttlMs = resolveConfig(config).judge.ttlMs;
      if (this.matchingJudgeCaches?.ttlMs !== ttlMs) {
        this.matchingJudgeCaches = { ttlMs, caches: { judgeCache: new JudgeCache(ttlMs), screenCache: new JudgeCache(ttlMs), deepCache: new JudgeCache(ttlMs) } };
      }
    } else this.matchingJudgeCaches = undefined;
    const deps: EngineDeps = { llm, pack, ...this.matchingJudgeCaches?.caches };
    // spec/runtimeUnit.md, "The engine runs on a snapshot outside the store lock"
    const key = `${input.standingIntentSearch ? "recheck" : "daily"}:${localDateParts(now, this.cityTz()).day}`;
    const { proposals, asks, runLog, memberStanding } = await engine({ key, input: { ...input, memberStanding: this.memberStanding }, config, deps });
    if (memberStanding?.length) {
      const rows = new Map(this.memberStanding.map(row => [standingKey(row), row]));
      for (const row of memberStanding) rows.set(standingKey(row), row);
      this.memberStanding = [...rows.values()];
      this.retainMemberStanding(now);
    }
    // Exposure debt tracks regular runs over the whole market (matching-e2e-6).
    if (!input.standingIntentSearch) this.exposureDebt = { ...(runLog.exposureDebt ?? {}) };
    this.counters.engineRuns++; this.counters.engineProposals += proposals.length;
    this.currentRunId = this.sid([runLog.runId, ...(config.cities ?? [])].join("-"));
    this.opts.onEngineRun?.(runLog, proposals, now);
    let started = 0;
    // D6: note top-quartile items held for members on "only when I ask" (the only re-engagement trigger).
    const scores = proposals.map(p => p.score).sort((a, b) => b - a);
    const cut = scores[Math.floor(scores.length * (1 - OUTREACH.reengageMinQuantile))] ?? Infinity;
    for (const p of proposals) if (p.score >= cut) for (const id of p.participants) { const m = this.members.get(id); if (m?.onlyWhenAsked) m.heldHighAt = now; }
    // The engine returns proposals in selection order (matching-e2e-5), so the daily allowance keeps
    // its exposure-floor and exploration picks.
    for (const p0 of proposals) {
      // peon: a job seat is answered by its hiring manager (seatRoute); a seat without one is never proposed.
      const p = this.seatRoute(p0);
      if (!p) { this.gate("seat_without_manager", p0.participants); continue; }
      if (!canQueueEngineOpportunity(started, allowance)) { this.gate("daily_cap", p.participants); continue; }
      const why = this.gateReason(p);
      if (why) { this.gate(why, p.participants); continue; }
      const draft = this.fromProposal(p, "engine", now);
      if (draftUsesMatchingSlot(draft !== undefined, draft?.stage === "closed")) started++;
    }
    this.currentRunId = undefined;
    if (!input.standingIntentSearch) {
      this.sendAsks(asks ?? [], now);
      this.sendEmptyIntentNotices(input.intents, runLog.emptyStates, now);
    }
    return started;
  }

  /**
   * The engine config this Network runs (matching-e2e-M2). The judge (pass 2) runs only when an
   * engine LLM is wired (engineLLM); otherwise it is off here, so no run log claims a judge or a
   * verdict gate that never ran. The markets come from the engine config through the pack's geo
   * model, never from member data.
   */
  effectiveEngineConfig(): EngineConfigInput {
    const e = this.opts.engine ?? {};
    const config: EngineConfigInput = { seed: this.opts.seed, ...e, judge: { ...(e.judge ?? {}), enabled: !!this.opts.engineLLM && (e.judge?.enabled ?? true) } };
    return { ...config, cities: [...(this.opts.pack ?? networkPack).geo.markets(resolveConfig(config))] };
  }
  /** Exposure debt from the last engine run, passed back on the next one (engineInput). */
  private exposureDebt: Record<MemberId, number> = {};
  /** Private engine state written atomically with the tick. It never enters a proposal or a run log. */
  private memberStanding: readonly MemberStandingRow[] = [];

  private retainMemberStanding(now: number) {
    if (!this.memberStanding.length) return;
    const app = this.app.id;
    const cofounders = new Set(this.snapshotCached().intents.filter(intent => intent.objective === cofounderIntentObjective
      && cofounderIntentEligible(intent.app ?? "", app, intent.category, intent.details ?? "", standingIntentLive(intent, now)))
      .map(intent => intent.memberId));
    this.memberStanding = this.memberStanding.filter(row => {
      const record = this.record(row.memberId);
      if (!record || this.declinedIds.has(row.memberId)) return false;
      const subject = isSeatId(row.memberId) ? seatOwnerOf(record) : row.memberId;
      const owner = subject ? this.record(subject) : undefined;
      const member = subject ? this.members.get(subject) : undefined;
      const adult = !!owner && canBeMatched(validAge(owner.age) ? owner.age : member ? this.statedToday(member) : undefined)
        && (!member || !(member.minor || member.minorSignal || member.minorReported || member.ageUnknown || member.ageConflict));
      const active = !!owner && (owner.accountStatus === undefined || owner.accountStatus === "active") && owner.state !== "paused"
        && (!member || !(member.optedOut || member.account)) && !!subject && this.trust.ok(subject) && !this.reportHeld(subject);
      const category = laneCategory(row.lane);
      const consent = !!category && laneOffered(app, row.lane) && !!owner?.prefs.categoriesOptIn.includes(category)
        && (row.lane !== "Date" || owner?.prefs.romanceOptIn === true)
        && (row.lane !== "Cofounder" || cofounders.has(row.memberId));
      const ageEligible = adult || (!!subject && !isSeatId(row.memberId) && teenFriendLane(app, row.lane) && this.teenPartnerReady(subject));
      return standingMayRetain(ageEligible, active, consent);
    });
  }

  /**
   * Engine questions for members it cannot match well yet (EngineResult.asks). At most one per
   * member per ASK_EVERY_DAYS. An ask is not an initial invite, so it does not count on the intro
   * cap (founder decision 3) and is sent proactive:false; it waits for the sending window, follows
   * the unanswered and one-question rules and passes the leak guard (send()) (judge-evals-M2).
   * Never to members aged 13-17, members still onboarding, or anyone we are waiting on for another answer.
   */
  private sendAsks(asks: EngineAsk[], now: number) {
    const hooks = this.opts.hooks;
    const done = new Set<MemberId>();
    for (const a of asks) {
      const m = this.members.get(a.memberId);
      if (!m || done.has(m.id) || m.minor || m.stage !== "active" || m.awaiting || now - this.lastAsk(m.id) < ASK_EVERY_DAYS * DAY) continue;
      done.add(m.id);
      // An app with an onboarding loop asks its own next question (one at a time); the engine's text when the loop has none left.
      const nx = hooks?.onboarding?.next(m.onboarding, { age: this.ageOf(m) });
      const reason = nx?.reason ?? a.reason;
      this.send(m, nx?.text ?? a.question, { type: "question", proactive: false, ask: { id: a.id, reason } }, "interview", {
        hook: { t: "ask", reason, engineQuestion: true },
      });
    }
  }
  private lastAsk(id: MemberId) { return Math.max(-Infinity, ...this.asks.filter(a => a.memberId === id).map(a => a.at)); }

  private sendEmptyIntentNotices(intents: Intent[], results: MatchingRunLog["emptyStates"], now: number) {
    if (!results.length) return;
    const byId = new Map(intents.map(i => [i.id, i]));
    const handled = new Set(this.deferred.filter(item => item.o.hook?.t === "empty_intent").map(item => item.memberId));
    const searchDay = localDateParts(now, this.cityTz()).day;
    for (const result of results) {
      if (handled.has(result.memberId) || !emptyIntentFollowupReasonAllowed(result.reason.split(":")[0]!)) continue;
      const member = this.members.get(result.memberId), intent = byId.get(result.intentId);
      if (!member || !intent || intent.memberId !== member.id) continue;
      const hook: EmptyIntentNotice = { t: "empty_intent", intentId: intent.id, statedAt: intent.createdAt, searchDay, reason: result.reason };
      if (!this.emptyIntentNoticeReady(member, hook, now)) continue;
      handled.add(member.id);
      this.send(member, this.copy.emptyIntentFollowup, { type: "info", proactive: false }, "info", { hook });
    }
  }

  private emptyIntentNoticeReady(member: MemberState, hook: EmptyIntentNotice, now: number): boolean {
    const intent = this.ownStandingIntents(member.id, now).find(({ intent }) => intent.id === hook.intentId)?.intent;
    const prefs = this.record(member.id)?.prefs;
    return emptyIntentFollowupReady(!!intent && intent.createdAt === hook.statedAt && standingIntentLive(intent, now),
      this.opts.matchingEnabled && member.stage === "active" && !prefs?.onlyWhenAsked && this.eligible(member.id)
        && !this.openOpps().some(o => activeOpportunityParticipant(o, member.id)),
      !!intent && this.allowedCategories.has(intent.category) && !!prefs?.categoriesOptIn?.includes(intent.category),
      !member.awaiting && !this.askOpen(member, now) && this.classifyOutreach(member, { type: "info" }, now) === "unsolicited",
      localDateParts(now, this.cityTz()).day === hook.searchDay, member.emptyIntentNotices?.[hook.intentId] === hook.statedAt);
  }

  /** A proposal the gates stopped: counted, and logged per proposal for the timeline (the members' ids, never their words). */
  private gate(reason: string, members: MemberId[]) {
    this.counters.gatedOut++; this.gateReasons[reason] = (this.gateReasons[reason] ?? 0) + 1;
    this.ctx.log("gate_reason", { proposalKey: attention.opportunityKey(members), reason, members: [...members] });
  }

  /**
   * How well do the others meet what THIS member told us they want, in this category, judged only
   * from what we know (stated or confirmed)? 1 = a stated want answered by a stated skill; 0.85 =
   * the same stated want on both sides; social: 0.3 per shared known interest (max 0.8).
   */
  knownWantMet(id: MemberId, others: MemberId[], category: Category): number {
    const known = this.knownProfiles();
    const me = known.get(id);
    if (!me) return 0;
    let best = 0;
    for (const [d, categories] of me.desires) {
      const def = desireById.get(d);
      if (!def || !categories.has(category)) continue;
      for (const o of others) {
        const k = known.get(o);
        if (!k) continue;
        if (def.category === "romance") continue; // the engine owns romance opt-in checks
        if (def.needsSkills.some(sk => k.strongSkills.has(sk))) best = Math.max(best, 1);
        else if (def.pool && [...k.desires].some(([other, peerCategories]) => peerCategories.has(category) && desireById.get(other)?.pool === def.pool)) best = Math.max(best, 0.85);
        else if (def.needsSkills.some(sk => k.skills.has(sk))) best = Math.max(best, 0.6);
        else if (def.needsInterests.some(t => k.interests.has(t))) best = Math.max(best, 0.45);
      }
    }
    if (category === "social" || category === "events") {
      for (const o of others) {
        const k = known.get(o);
        if (!k) continue;
        const shared = [...me.interests].filter(t => k.interests.has(t)).length;
        best = Math.max(best, Math.min(0.8, shared * 0.3));
      }
    }
    return best;
  }

  /** Every participant must have a want we can name that the others meet (the 90% rule). */
  private wantsMet(participants: MemberId[], category: Category, primedOk: Set<MemberId> = new Set()): boolean {
    if (!this.opts.selective) return true;
    return participants.every(id => primedOk.has(id) || this.knownWantMet(id, participants.filter(x => x !== id), category) >= this.opts.minWantMet);
  }

  /**
   * The reason a probe ("someone who wants to start a rock band too") or a reveal ("you both want
   * to start a rock band") gives, built only from what we know about the OTHER people and never
   * from engine text (which can name people).
   */
  probeReason(id: MemberId, o: Opp, voice: "probe" | "reveal" = "probe"): string | undefined {
    const known = this.knownProfiles();
    const me = known.get(id);
    const others = o.participants.filter(x => x !== id).map(x => known.get(x)).filter((k): k is KnownProfile => !!k);
    if (!me || !others.length) return undefined;
    const pair = others.length === 1;
    const say = voice === "probe"
      ? { help: (t: string) => `${pair ? "someone" : "people"} who can help you ${t}`, both: (t: string) => `${pair ? "someone" : "people"} who's into ${t} too` }
      : { help: (t: string) => `${pair ? "they" : "someone here"} can help you ${t}`, both: (t: string) => `${pair ? "you're both" : "others here are"} into ${t}` };
    // Only what the others allowed us to share (network-consent-11): a skill or an interest on a
    // shareable facet. Their wants are never quoted ("who also wants to ..."): wants are matchable only.
    for (const [d, categories] of me.desires) {
      const def = desireById.get(d);
      if (!def || !categories.has(o.category) || def.category === "romance") continue;
      if (others.some(k => def.needsSkills.some(sk => k.strongSkills.has(sk) && k.sharedSkills.has(sk)))) return say.help(def.text);
    }
    const shared = [...me.interests].find(t => others.some(k => k.sharedInterests.has(t)));
    return shared ? say.both(interestLabel(shared)) : undefined;
  }

  /**
   * After a swap, every reason is rebuilt for the people now in the opportunity, so nobody hears a
   * reason about the person who left. Requests use the ask's own fit; other origins use what we
   * know. When nothing true can be said, the reason is the generic one.
   */
  private reexplain(o: Opp) {
    const known = this.knownProfiles();
    const req = o.requester ? this.requests.find(x => x.oppId === o.id && x.memberId === o.requester) : undefined;
    for (const id of o.participants) {
      if (o.requester && req) {
        const others = o.participants.filter(x => x !== o.requester);
        o.explanations[id] = id === o.requester
          ? (others.length === 1 && this.askFit(id, others[0]!, req, known).why) || GOOD_FIT
          : `they want to ${o.detail}, and ${this.askFit(o.requester, id, req, known).whyBack}`;
      } else o.explanations[id] = this.probeReason(id, o, "reveal") ?? GOOD_FIT;
    }
  }

  /** Skeptical gate on engine output. Returns why a proposal is NOT started, or undefined. */
  private gateReason(p: SeatProposal, exceptOpp?: string): string | undefined {
    const category = p.category ?? "social";
    if (!this.allowedCategories.has(category)) return "category_not_allowed";
    if (p.participants.some(id => !this.eligibleIn(p, id, exceptOpp))) return "participant_unavailable";
    if (p.participants.some(id => !this.allowsMatchCategory(id, category))) return "category_opt_out";
    if (p.lane === "Cofounder" && !this.cofounderCurrent(p)) return "cofounder_intent_changed";
    if (p.category === "romance") { const why = this.romanceGate(p.participants); if (why) return why; }
    // Receiving is support-only (founder default D1-D18): never ask them to give, host or connect.
    if (p.participants.some(id => this.members.get(id)?.state === "receiving" && CONTRIBUTOR_ROLES.has(p.roles?.[id] as never))) return "receiving_contributor";
    if (this.appPack()) {
      // An app's own pack (slop, peon, friends) ran its own hard filters, scores and asks: the Network's
      // ntwrk heuristics below (known wants, thin profiles, speculative intros) are not its rules. Blocks,
      // pair history and responsiveness still apply.
      for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) {
        const [a, b] = [p.participants[i]!, p.participants[j]!];
        if (!this.pairAllowed(a, b) || this.pairHistory(a, b, PAIR_HISTORY_DAYS)) return "pair_history";
      }
      if (this.opts.selective && p.participants.some(id => this.responsiveness(id) < this.opts.minResponsiveness)) return "unresponsive";
      return undefined;
    }
    if (!this.opts.selective) return undefined;
    if (p.score < this.opts.minScore) return "score";
    const known = this.knownProfiles();
    for (const id of p.participants) {
      const k = known.get(id);
      const facts = k ? k.interests.size + k.skills.size + (k.intents > 0 ? 2 : 0) : 0;
      if (facts < this.opts.minKnowledge) return "thin_profile";
    }
    if (p.components.confidence < 0.35) return "low_confidence";
    // Romance passed the engine's opt-in and preference checks and romanceGate above: the want gate
    // has no romance vocabulary of its own, and scored every dating proposal 0 (matching-e2e-2).
    if (p.category !== "romance" && p.lane !== "Cofounder" && !this.wantsMet(p.participants, p.category ?? "social")) return "want_not_named";
    if (p.participants.some(id => this.responsiveness(id) < this.opts.minResponsiveness)) return "unresponsive";
    if (!p.anchor || !["intent", "event"].includes(p.anchor.type)) {
      // Speculative (no one asked): only for well-known, warm or clearly overlapping people.
      if (p.components.warmPath < 0.3 && p.components.fit < 0.45) return "speculative";
    }
    for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) {
      if (!this.pairAllowed(p.participants[i]!, p.participants[j]!) || this.pairHistory(p.participants[i]!, p.participants[j]!, PAIR_HISTORY_DAYS)) return "pair_history";
    }
    return undefined;
  }

  private romanceGate(ids: readonly MemberId[]): string | undefined {
    if (ids.length !== 2) return "romance_not_pair";
    const snap = this.snapshotCached();
    const prefs = new Map<MemberId, DatingFacts>();
    for (const id of ids) {
      const r = this.record(id);
      const m = this.members.get(id);
      if (!r || !r.prefs?.romanceOptIn || !(r.prefs.categoriesOptIn ?? []).includes("romance")) return "romance_not_opted_in";
      if (!canBeMatched(r.age) || !m || m.minor || m.minorSignal || m.ageConflict) return "romance_not_verified_adult";
      const tags = [...snap.facets.filter(f => f.memberId === id).flatMap(f => f.tags), ...(m.appTags ?? []).map(t => t.tag)].map(t => t.toLowerCase());
      const facts = datingFactsOf(tags);
      if (!facts.seeks.length) return "romance_prefs_unstated";
      prefs.set(id, facts);
    }
    if (!mutuallyOpen(datingStatementOf(prefs.get(ids[0]!)!), datingStatementOf(prefs.get(ids[1]!)!))) return "romance_mismatch";
    return undefined;
  }

  /** Recheck this same reviewed pair without using its own pending proposal as a discovery exclusion. */
  private currentDatingPair(o: Pick<Opp, "category" | "participants">): boolean {
    const check = this.opts.hooks?.hardDatingPairCurrent;
    if (!check || this.app.id !== "slop" || o.category !== "romance") return true;
    const [first, second] = o.participants;
    if (!first || !second || !this.pairAllowed(first, second)) return false;
    return o.participants.every(id => this.checkRecipient(id, "reveal", { about: o.participants, reply: false }).ok)
      && check(this.packInput(this.now()), o.participants);
  }

  private fromProposal(p: Proposal & { seat?: Opp["seat"] }, origin: Origin, now: number): Opp | undefined {
    if (p.participants.some(id => !this.eligibleIn(p, id))) { if (origin === "player") this.ctx.log("proposal_skipped", { proposalId: p.id, reason: "participant unavailable" }); return undefined; }
    const tags = [...new Set(p.participants.flatMap(id => [...(this.knownProfiles().get(id)?.interests ?? [])]))].slice(0, 6);
    // Engine explanations may name the other person ("Sam K.: lives near..."); members only ever see
    // names at the reveal, and only of the people in it, so strip every member name first.
    const explanations: Record<MemberId, string> = {};
    for (const [id, text] of Object.entries(p.explanations ?? {})) explanations[id] = this.stripNames(text);
    const o = this.newOpp({
      // A player's (or scenario's) proposal keeps its id: the world already recorded it.
      ...(origin === "player" ? { id: p.id, recorded: true } : {}),
      origin, kind: p.kind, category: p.category ?? "social", objective: p.objective, detail: detailOf(p),
      participants: p.participants, alternates: p.alternates ?? [], primed: [], explanations,
      score: p.score, generator: origin === "player" ? "player" : p.generator, tags, components: p.components, exploration: p.exploration,
      sameDay: !!p.window && p.window.end - now <= DAY,
    });
    // What the gates need to run again when a reviewer approves it (approvalCheck).
    if (origin === "engine") {
      const e = p as Partial<EngineProposal>;
      o.anchor = e.anchor; o.roles = e.roles; o.lane = e.lane;
      const format = formatOf(e.format);
      if (format) o.format = format;
      if (e.via) o.via = e.via;
      if (e.cofounderIntents) o.cofounderIntents = { ...e.cofounderIntents };
      if (o.lane === "Cofounder") o.alternates = [];
    }
    if (p.seat) o.seat = { ...p.seat };
    if (o.anchor?.type === "event") {
      if (p.window) o.anchorWindow = { ...p.window };
      this.bindPublishedEvent(o, o.anchor.id);
    }
    if (!this.teenRosterAdmitted(o)) return undefined;
    // Engine text can quote matchable facets: every member-facing reason is rebuilt from shareable facts (network-consent-11).
    if (origin === "engine") this.reexplain(o);
    this.submit(o);
    return o;
  }

  private bindPublishedEvent(o: Opp, eventId?: string) {
    if (!eventId) return;
    const event = this.snapshotCached().events?.find(value => value.id === eventId);
    if (event?.listing) {
      o.publicEventRevision = publicEventRevision(event);
      o.anchorWindow = { start: event.start, end: event.end };
      o.venueArea = event.area;
    }
  }

  private currentPublishedEvent(o: Opp): NetworkEvent | undefined {
    if (!o.publicEventRevision) return undefined;
    const id = o.plan?.eventId ?? o.anchor?.id;
    const event = this.snapshotCached().events?.find(value => value.id === id);
    return event?.listing && publicEventRevisionMatches(o.publicEventRevision, publicEventRevision(event)) ? event : undefined;
  }

  /** Revalidate the reviewed pair's exact standing intents, including after a restart. */
  private cofounderCurrent(o: Pick<Opp, "participants" | "cofounderIntents">): boolean {
    const [first, second] = o.participants;
    if (o.participants.length !== 2 || !first || !second) return false;
    const now = this.now();
    const snapshot = this.snapshotCached();
    const current = (memberId: MemberId) => {
      const bound = o.cofounderIntents?.[memberId];
      const intent = snapshot.intents.find(i => i.memberId === memberId && i.id === bound);
      return !!intent && cofounderBoundIntentCurrent(intent.id === bound, intent.objective === cofounderIntentObjective
        && cofounderIntentEligible(intent.app ?? "", this.app.id, intent.category, intent.details ?? "", standingIntentLive(intent, now)));
    };
    const eligible = (memberId: MemberId) => {
      const record = this.record(memberId), member = this.members.get(memberId);
      return !!member && canBeMatched(record?.age) && !!record?.prefs.categoriesOptIn.includes("professional")
        && record.prefs.formats.includes("one_to_one") && !record.prefs.onlyWhenAsked
        && !member.minor && !member.minorSignal && !member.minorReported && !member.ageUnknown && !member.ageConflict && !member.optedOut && !member.account
        && this.trust.ok(memberId) && !this.reportHeld(memberId) && record.state !== "paused";
    };
    return cofounderPairCurrent(first !== second, current(first), current(second), eligible(first) && eligible(second) && !this.blocked(first, second));
  }

  private publicEventRefusal(o: Opp, event = this.currentPublishedEvent(o)): string | undefined {
    if (!o.publicEventRevision) return undefined;
    if (!event) return "public_event_changed";
    const minimumAge = listedEventMinimumAge(event);
    for (const id of o.participants) {
      const current = this.record(id), member = this.members.get(id);
      const age = validAge(current?.age) ? current.age : member ? this.statedToday(member) : undefined;
      const adult = !!member && !member.minor && !member.minorSignal && !member.ageConflict && canBeMatched(age);
      const categories = current?.prefs?.categoriesOptIn, formats = current?.prefs?.formats;
      if (!publicEventMemberAllowsMatch(adult, (age ?? -1) >= minimumAge,
        Array.isArray(categories) && categories.includes(o.category), Array.isArray(formats) && formats.includes("event"))) {
        return "public_event_participant_ineligible";
      }
    }
    return undefined;
  }

  /** Used only by confirmation dispatch. Other URLs still go through the ordinary contact guard. */
  approvedPublicEventLink(oppId: string | undefined, recipient: MemberId | undefined, text: string): string | undefined {
    const opportunity = oppId ? this.opps.get(oppId) : undefined;
    if (!opportunity || !recipient || !opportunity.publicEventRevision) return undefined;
    const current = this.currentPublishedEvent(opportunity);
    const link = current?.listing?.url;
    if (!link || this.publicEventRefusal(opportunity, current)) return undefined;
    const consenting = opportunity.participants.includes(recipient) && opportunity.status.get(recipient) === "yes";
    return publicBookedEventLinkAllowed(opportunity.stage === "scheduled", consenting,
      text.endsWith(`\n${link}`) && text.indexOf(link) === text.lastIndexOf(link)) ? link : undefined;
  }

  approvedBookingLink(oppId: string | undefined, recipient: MemberId | undefined, text: string, messageId?: string): string | undefined {
    const eventLink = this.approvedPublicEventLink(oppId, recipient, text);
    if (eventLink) return eventLink;
    const opportunity = oppId ? this.opps.get(oppId) : undefined;
    if (!opportunity?.venueId || !recipient || !messageId) return;
    const exactMessage = venueBookingNoticeBase(messageId) === venueBookingNoticeKey(opportunity.id, recipient, opportunity.venueId);
    return approvedVenueBookingLink(opportunity, recipient, opportunity.status.get(recipient) === "yes", this.now(), text, exactMessage, this.networkCity());
  }

  /** The engine's input: the public snapshot plus everything the Network has learned and observed. */
  engineInput(now: number): EngineInput {
    now = Math.floor(now);
    const snap = this.controlledIntentSnapshot(this.ctx.snapshot());
    // The configured markets only (effectiveEngineConfig), never a market taken from member data.
    const markets = new Set(this.effectiveEngineConfig().cities);
    const local = new Set(snap.members.filter(m => markets.has(m.homeCity) && !this.declinedIds.has(m.id)).map(m => m.id));
    const facets: Facet[] = snap.facets.filter(f => local.has(f.memberId));
    const intents: Intent[] = snap.intents.filter(i => local.has(i.memberId));
    const stored = byMember(snap.intents);
    const facetTags = new Map<MemberId, Set<string>>();
    for (const facet of facets) {
      let tags = facetTags.get(facet.memberId);
      if (!tags) { tags = new Set(); facetTags.set(facet.memberId, tags); }
      for (const tag of facet.tags) tags.add(tag);
    }
    for (const m of this.members.values()) {
      if (!local.has(m.id)) continue;
      const have = facetTags.get(m.id);
      const add = (kind: Facet["kind"], tag: string, value: string) => {
        if (have?.has(tag)) return;
        facets.push({ id: `${m.id}:l:${tag}`, memberId: m.id, kind, value, tags: [tag], scope: "matchable", provenance: "said", confidence: 0.85, validFrom: now, source: "chat", observedAt: now, inferred: false, confirmedByMember: true });
      };
      m.learned.interests.forEach(t => add("interest", t, interestLabel(t)));
      m.learned.skills.forEach(t => add("skill", t, skillLabel(t)));
      for (const tag of m.learned.redLines ?? []) {
        if (have?.has(tag)) continue;
        facets.push({
          id: `${m.id}:rl:${tag}`, memberId: m.id, kind: "boundary", value: tag, tags: [tag],
          scope: "agent_private", provenance: "said", confidence: 0.95, validFrom: now,
          source: "ai_memory", observedAt: now, inferred: false, confirmedByMember: true,
        });
      }
      for (const [d, statedAt] of m.learned.desires) {
        const def = desireById.get(d);
        if (!def || !this.learnedLive(m.id, d, statedAt, now, stored.get(m.id) ?? [])) continue;
        // The intent is as old as the member's statement, not refreshed on every run.
        intents.push(learnedStandingIntent(m.id, def, statedAt));
      }
    }
    const holds = [
      ...[...this.members.values()].filter(m => !this.trust.ok(m.id) || m.minor || m.minorSignal || this.reportHeld(m.id)).map(m => m.id),
      ...snap.members.filter(x => !this.members.has(x.id) && recordMinorSignalOpen(minorSignalOf(x))).map(x => x.id),
    ].map(memberId => ({ memberId, from: now - HOUR }));
    const reliability = Object.fromEntries(
      [...this.members.values()]
        .filter(m => m.noShows > 0 || (m.strikes ?? 0) > 0 || m.provisionalNoShow)
        .map(m => [m.id, {
          noShows: m.noShows,
          completedSinceLastNoShow: m.completedSinceNoShow,
          ...(m.strikes !== undefined ? { strikes: m.strikes } : {}),
          ...(m.lateCancels4h !== undefined ? { lateCancels4h: m.lateCancels4h } : {}),
          ...(m.lateCancels24h !== undefined ? { lateCancels24h: m.lateCancels24h } : {}),
          ...(m.rescheduleChurn !== undefined ? { rescheduleChurn: m.rescheduleChurn } : {}),
          ...(m.provisionalNoShow !== undefined ? { provisionalNoShow: m.provisionalNoShow } : {}),
        }]),
    );
    const vampireCutoff = now - 90 * DAY;
    const introsByMember = new Map<MemberId, number>();
    for (const o of this.opps.values()) {
      if (o.createdAt < vampireCutoff || (o.stage !== "scheduled" && o.stage !== "done")) continue;
      for (const pid of o.participants) {
        if (local.has(pid)) introsByMember.set(pid, (introsByMember.get(pid) ?? 0) + 1);
      }
    }
    const posAbout = new Map<MemberId, number>();
    const asymNegAbout = new Map<MemberId, number>();
    const fbByOpp = new Map<string, typeof this.feedback>();
    for (const fb of this.feedback) {
      if (fb.at < vampireCutoff) continue;
      if (fb.sentiment === "positive") posAbout.set(fb.about, (posAbout.get(fb.about) ?? 0) + 1);
      if (fb.opportunityId) {
        const list = fbByOpp.get(fb.opportunityId) ?? [];
        list.push(fb);
        fbByOpp.set(fb.opportunityId, list);
      }
    }
    for (const list of fbByOpp.values()) {
      for (const fb of list) {
        if (fb.sentiment !== "negative") continue;
        const reciprocal = list.find(other => other.from === fb.about && other.about === fb.from);
        if (!reciprocal || reciprocal.sentiment !== "negative") {
          asymNegAbout.set(fb.about, (asymNegAbout.get(fb.about) ?? 0) + 1);
        }
      }
    }
    const vampireByMember: Record<MemberId, VampireTelemetry> = {};
    for (const m of this.members.values()) {
      if (!local.has(m.id) || m.minor || m.minorSignal) continue;
      const pitchSignals90d = (m.pitchSignals ?? []).filter(at => at >= vampireCutoff).length;
      const distinctSelfPromoReports90d = new Set((m.selfPromoReports ?? []).filter(r => r.at >= vampireCutoff).map(r => r.from)).size;
      const introsReceived90d = introsByMember.get(m.id) ?? 0;
      if (pitchSignals90d === 0 && distinctSelfPromoReports90d === 0 && introsReceived90d < 3) continue;
      vampireByMember[m.id] = {
        introsReceived90d,
        positiveCounterpartVotes90d: posAbout.get(m.id) ?? 0,
        asymmetricNegativeVotes90d: asymNegAbout.get(m.id) ?? 0,
        pitchSignals90d,
        distinctSelfPromoReports90d,
      };
    }
    const qualityByMember = snap.qualityByMember
      ? Object.fromEntries(Object.entries(snap.qualityByMember).filter(([id]) => local.has(id)))
      : undefined;
    const recentDrafts = [...this.opps.values()].filter(o => now - o.createdAt < 30 * DAY
      && !closedPublicEventIsUnsent(!!o.publicEventRevision, o.stage === "closed", o.contacted.size > 0));
    const unsentProposalIds = recentDrafts
      .filter(o => reviewDraftWasUnsent(o.stage === "closed" && o.closedFrom === "review", o.contacted.size > 0))
      .map(o => o.id);
    const engineInput: EngineInput = {
      // A member with no valid age on the record who told us they are an adult (6.3) goes in with that age.
      now, members: snap.members.filter(m => local.has(m.id)).map(x => { const m = this.members.get(x.id), stated = m ? this.statedToday(m) : undefined; return !validAge(x.age) && m && !m.minor && validAge(stated) ? { ...x, age: stated } : x; }),
      facets, intents, presence: snap.presence.filter(p => local.has(p.memberId)),
      ...(snap.events ? { events: snap.events } : {}),
      edges: [
        ...snap.edges.filter(e => local.has(e.from) && local.has(e.to)),
        ...this.repeatSources(now).filter(({ firstYes, secondYes, pair }) => firstYes && secondYes && this.pairAllowed(...pair))
          .map(({ source, pair: [from, to] }) => ({ from, to, type: "would_interact_again" as const, strength: 0.8, explicit: false, createdAt: source.meetingAt! })),
        ...[...this.avoid].map(k => { const [a, b] = k.split("|") as [string, string]; return { from: a, to: b, type: "avoid" as const, strength: 1, explicit: false, createdAt: now }; }),
        // Attendees of a plan who both said they'd do it again (plans ask 8).
        ...[...this.planAgain].flatMap(([k, at]) => {
          const [a, b] = k.split("|") as [MemberId, MemberId];
          return this.pairAllowed(a, b) ? [{ from: a, to: b, type: "would_interact_again" as const, strength: 0.8, explicit: false, createdAt: at }] : [];
        }),
      ],
      recentProposals: recentDrafts.map(o => this.toProposal(o)), unsentProposalIds,
      safetyHolds: holds, feedback: this.feedback, interactions: this.interactions, reliability,
      ...(qualityByMember && Object.keys(qualityByMember).length ? { qualityByMember } : {}),
      ...(Object.keys(vampireByMember).length ? { vampireByMember } : {}),
      recentAsks: this.asks.map(a => ({ ...a })),
      exposureDebt: { ...this.exposureDebt },
    };
    return engineInput;
  }

  /** The app's own pack (slop, peon, friends); undefined for The Network's networkPack. */
  private appPack(): AppPack | undefined { return this.opts.pack && this.opts.pack.id !== "ntwrk" ? this.opts.pack : undefined; }

  packInput(now: number): EngineInput {
    const input = this.engineInput(now);
    const adult = new Set(input.members.filter(x => {
      const m = this.members.get(x.id);
      return !isSeatId(x.id) && canBeMatched(x.age) && (m ? this.adultMember(x.id) : !recordMinorSignalOpen(minorSignalOf(x)));
    }).map(x => x.id));
    // A job seat has no member state of its own: it goes in only with its manager, and is held with them.
    const heldIds = new Set((input.safetyHolds ?? []).map(h => h.memberId));
    const seatHolds: NonNullable<EngineInput["safetyHolds"]> = [];
    for (const x of input.members) {
      const owner = seatOwnerOf(x);
      if (!owner || !adult.has(owner)) continue;
      adult.add(x.id);
      if (heldIds.has(owner)) seatHolds.push({ memberId: x.id, from: now - HOUR });
    }
    const teenIntros = this.teenIntrosEnabled();
    const ready = new Set(teenIntros ? input.members.filter(x => this.teenPartnerReady(x.id)).map(x => x.id) : []);
    const teens = new Set([...ready].filter(id => !adult.has(id) && this.teenAdmitted(id)));
    const admitted = new Set([...adult, ...teens]);
    const both = (a: MemberId, b: MemberId) => adult.has(a) && adult.has(b);
    const bothAdmitted = (a: MemberId, b: MemberId) => admitted.has(a) && admitted.has(b);
    const facets = input.facets.filter(f => adult.has(f.memberId) || (teens.has(f.memberId) && teenFacetAllowed(f.kind)));
    for (const m of this.members.values()) {
      if (!admitted.has(m.id)) continue;
      for (const tag of m.appTags ?? []) { const f = appTagFacet(m.id, tag); if (adult.has(m.id) || teenFacetAllowed(f.kind)) facets.push(f); }
    }
    const held = (id: MemberId) => !this.trust.ok(id) || this.reportHeld(id);
    const out: EngineInput = {
      ...input,
      members: input.members.filter(x => admitted.has(x.id)).map(x => (ready.has(x.id) ? { ...x, teenReady: true } : x)),
      facets, intents: input.intents.filter(i => admitted.has(i.memberId)), presence: input.presence.filter(p => admitted.has(p.memberId)),
      edges: [
        ...input.edges.filter(e => bothAdmitted(e.from, e.to)),
        // Pairs the gate refuses (a "no", a review reject): slop's re-probe window is shorter than PAIR_HISTORY_DAYS,
        // and every pick the gate drops takes both members' slot of the run (SD-223).
        ...(this.appPack()?.id === "slop" ? [...this.declined].filter(([k, at]) => at > now - PAIR_HISTORY_DAYS * DAY && both(...(k.split("|") as [MemberId, MemberId])))
          .map(([k, at]) => { const [a, b] = k.split("|") as [MemberId, MemberId]; return { from: a, to: b, type: "avoid" as const, strength: 1, explicit: false, createdAt: at }; }) : []),
      ],
      recentProposals: (input.recentProposals ?? []).filter(p => p.participants.every(id => admitted.has(id))),
      safetyHolds: [...(input.safetyHolds ?? []).filter(h => adult.has(h.memberId) || (teens.has(h.memberId) && held(h.memberId))), ...seatHolds],
      feedback: (input.feedback ?? []).filter(f => both(f.from, f.about)),
      interactions: (input.interactions ?? []).filter(x => x.participants.every(id => adult.has(id))),
      reliability: Object.fromEntries(Object.entries(input.reliability ?? {}).filter(([id]) => admitted.has(id))),
      ...(input.qualityByMember ? { qualityByMember: Object.fromEntries(Object.entries(input.qualityByMember).filter(([id]) => adult.has(id))) } : {}),
      ...(input.vampireByMember ? { vampireByMember: Object.fromEntries(Object.entries(input.vampireByMember).filter(([id]) => adult.has(id))) } : {}),
      recentAsks: (input.recentAsks ?? []).filter(a => admitted.has(a.memberId)),
      exposureDebt: Object.fromEntries(Object.entries(input.exposureDebt ?? {}).filter(([id]) => admitted.has(id))),
      ...(teenIntros ? { teenIntros: true } : {}),
      // The "your turn" limit: a probe or a booked meeting still open (engine dispatch.skipOpenOpportunities).
      openOpportunities: this.openOpps().filter(o => o.participants.every(id => admitted.has(id)))
        .map(o => ({ id: o.id, participants: [...o.participants], stage: o.stage === "scheduled" ? "scheduled" as const : "inviting" as const, ...(o.meetingAt !== undefined ? { until: o.meetingAt } : {}) })),
    };
    const view = this.seatView(out);
    return this.appPack() ? this.opts.hooks?.engineInput?.(view) ?? view : view;
  }

  private learnedLive(id: MemberId, desireId: string, statedAt: number, now: number, own: readonly Intent[]): boolean {
    const control = this.members.get(id)?.intentControls?.[`learned:${desireId}`];
    const status = control ? INTENT_CONTROL_STATUS[control] : "active";
    const phase = standingIntentPhaseAt({ status, createdAt: statedAt, horizonDays: learnedIntentDays }, now);
    const objective = desireById.get(desireId)?.text;
    const blockingRecord = phase === "IntentLive" && objective !== undefined && own.some(i =>
      i.objective === objective && standingIntentBlocksLearnedCopy(standingIntentPhaseAt(i, now)));
    return learnedIntentMayProject(phase, blockingRecord);
  }

  /**
   * Growth tasks, plain and simple (at most `maxGrowthAsksPerDay` a day, one per member per 21 days):
   *  - gap asks: where requests went unmet this week, ask nearby members who share that interest;
   *  - plain asks: engaged members who've been here 10+ days and were never asked.
   */
  private growthTasks(now: number) {
    if (!this.invitesWork) return;
    let budget = this.opts.maxGrowthAsksPerDay;
    const known = this.knownProfiles();
    const unmet = this.requests.filter(r => r.kind === "people" && r.outcome === "none" && now - r.at < 7 * DAY);
    const ask = (m: MemberState, body: string, kind: string) => {
      m.lastGrowthAsk = now; budget--;
      this.growthAsk(m, body, kind);
    };
    const ready = (m: MemberState) => this.canInvite(m) && now - m.lastGrowthAsk > 21 * DAY && m.stage === "active" && !m.optedOut && !m.awaiting
      && !m.onlyWhenAsked && attention.canInterrupt({ outboundSinceInbound: m.outbound ?? 0 }) && (m.openAskAt === undefined || now - m.openAskAt >= OUTREACH.askOpenMs);
    for (const r of unmet) {
      if (budget <= 0) return;
      const def = r.desireId ? desireById.get(r.desireId) : undefined;
      const tags = def ? def.needsInterests : r.tags;
      const area = this.member(r.memberId).area;
      const helper = [...this.members.values()].find(x => x.id !== r.memberId && ready(x) && (this.minutesBetween(area, x.area) ?? Infinity) <= 30
        && (tags.some(t => known.get(x.id)?.interests.has(t)) || (def?.pool && [...(known.get(x.id)?.desires.keys() ?? [])].some(d => desireById.get(d)?.pool === def.pool))));
      if (helper) ask(helper, copy.growthGap(area, def ? def.text.replace(/^(find|meet|get|be part of|try|learn to|start) /, "") : "people to hang out with"), "gap");
    }
    for (const m of this.members.values()) {
      if (budget <= 0) return;
      if (m.lastGrowthAsk === 0 && now - m.joinedAt > 10 * DAY && m.msgsIn >= 4 && ready(m)) ask(m, this.copy.growthPlain, "plain");
    }
  }

  private repeatSources(now: number): { source: Opp; pair: [MemberId, MemberId]; firstYes: boolean; secondYes: boolean }[] {
    const responses = new Map<string, Set<MemberId>>();
    for (const reply of this.feedback) {
      if (!reply.repeatConsent || !reply.opportunityId || reply.from === reply.about) continue;
      const pair = this.opps.get(reply.opportunityId)?.participants;
      if (pair?.length !== 2 || !pair.includes(reply.from) || !pair.includes(reply.about)) continue;
      const from = responses.get(reply.opportunityId) ?? new Set<MemberId>();
      from.add(reply.from);
      responses.set(reply.opportunityId, from);
    }
    const seen = new Set<string>();
    const result: ReturnType<ConsentNetwork["repeatSources"]> = [];
    const meetings = [...this.opps.values()].filter(o => !o.plan && !o.seat && o.meetingAt !== undefined &&
      recentRepeatSource(o.stage === "done", o.participants.length === 2, now - o.meetingAt))
      .sort((a, b) => b.meetingAt! - a.meetingAt!);
    for (const source of meetings) {
      const [a, b] = source.participants;
      if (a === undefined || b === undefined || a === b) continue;
      const key = pairKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      const from = responses.get(source.id);
      result.push({ source, pair: [a, b], firstYes: from?.has(a) === true, secondYes: from?.has(b) === true });
    }
    return result;
  }

  private repeatPreferencesAllow(category: Category, participants: readonly MemberId[]): boolean {
    return this.allowedCategories.has(category) && (category !== "romance" || !this.romanceGate(participants)) &&
      participants.every(id => {
        const prefs = this.record(id)?.prefs;
        return !!prefs?.categoriesOptIn?.includes(category) && prefs.formats?.includes("one_to_one") === true;
      });
  }

  private repeatOutreachAllowed(category: Category, participants: readonly MemberId[], exceptOpp?: string): boolean {
    return this.repeatPreferencesAllow(category, participants) && participants.every(id => {
      const m = this.members.get(id);
      return !!m && this.eligible(id, exceptOpp) && canBeMatched(this.ageOf(m));
    });
  }

  /** Replace the runtime's fresh authority. The imported snapshot carries proposals, never authority. */
  setGatheringRepeatSources(sources: readonly GatheringRepeatSource[]): void {
    this.gatheringRepeatSources.clear();
    if (this.app.id !== "ntwrk") return;
    const conflicts = new Set<string>();
    for (const source of sources) {
      if (!source.gatheringId || !source.groupReviewId || !Number.isSafeInteger(source.revision) || source.revision < 1 ||
        !source.members[0] || !source.members[1] || !gatheringRepeatMembersMatch(source.members, source.members) || !/^[a-f0-9]{64}$/.test(source.consentVersion)) continue;
      const id = gatheringRepeatOppId(source);
      const existing = this.gatheringRepeatSources.get(id);
      if (existing && !sameGatheringRepeatSource(existing, source)) conflicts.add(id);
      this.gatheringRepeatSources.set(id, { ...source, members: [source.members[0], source.members[1]] });
    }
    for (const id of conflicts) this.gatheringRepeatSources.delete(id);
  }

  private gatheringRepeatPairAllowed(pair: [MemberId, MemberId]): boolean {
    const [first, second] = pair;
    const key = pairKey(first, second);
    return this.pairAllowed(first, second) && (this.declined.get(key) ?? -Infinity) <= this.now() - 60 * DAY &&
      this.repeatPreferencesAllow("social", pair) && pair.every(id => {
        if (this.declinedIds.has(id)) return false;
        const member = this.members.get(id), record = this.record(id);
        return !!member && !!record && record.homeCity === "nyc" && canBeMatched(record.age) && record.state !== "paused" &&
          !record.prefs?.onlyWhenAsked && (record.accountStatus === undefined || record.accountStatus === "active") &&
          gatheringMemberStateCurrent(member, !this.trust.ok(id) || this.reportHeld(id), earliestDayKeyOf(this.now()));
      });
  }

  private repeatSourceCurrent(o: Opp): boolean {
    if (!isGatheringRepeat(o)) return !!o.repeatFrom;
    const source = o.gatheringRepeat;
    return this.app.id === "ntwrk" && this.matchingEnabled() && !!source && o.origin === "second_encounter" &&
      o.kind === "second_encounter" && o.category === "social" && !o.plan && !o.seat && !o.requester && !o.alternates.length &&
      sameGatheringRepeatSource(source, this.gatheringRepeatSources.get(o.id)) && gatheringRepeatMembersMatch(o.participants, source.members) &&
      this.gatheringRepeatPairAllowed(source.members);
  }

  private closeStaleGatheringRepeats(): void {
    for (const opp of this.openOpps()) {
      if ((opp.stage === "review" || opp.stage === "probing") && isGatheringRepeat(opp) && !this.repeatSourceCurrent(opp)) {
        this.close(opp, "gathering repeat consent changed");
      }
    }
  }

  /** Stage at most one ordinary, separately consented social review for one gathering pair. */
  queueGatheringRepeats(): void {
    if (this.app.id !== "ntwrk") return;
    this.closeStaleGatheringRepeats();
    if (!this.matchingEnabled()) return;
    for (const [id, source] of this.gatheringRepeatSources) {
      const pair = source.members;
      if (!gatheringRepeatMayStage(true, this.gatheringRepeatPairAllowed(pair) && this.repeatOutreachAllowed("social", pair), this.opps.has(id))) continue;
      const [first, second] = pair;
      const opp = this.newOpp({ id, origin: "second_encounter", kind: "second_encounter", category: "social", objective: "Meet someone nearby",
        detail: "a coffee nearby", participants: pair, alternates: [], primed: [], explanations: { [first]: GOOD_FIT, [second]: GOOD_FIT },
        score: 0.8, generator: "gathering_second_encounter", tags: [] });
      opp.gatheringRepeat = source;
      this.submit(opp);
    }
  }

  /** App-local facts for the current staff gathering read. No profile values or pair identities leave the engine. */
  gatheringPriorityEvidence(now: number) {
    if (this.app.id !== "ntwrk") return [];
    const records = new Map((this.ctx.snapshot().members as MemberRecord[])
      .filter(record => record.homeCity === "nyc").map(record => [record.id, record]));
    const current = new Set<MemberId>();
    for (const [id, record] of records) {
      const member = this.members.get(id);
      if (!member || member.stage !== "active" || member.optedOut || member.account || member.minor || member.minorSignal ||
        member.minorReported || member.ageConflict || member.ageUnknown || !canBeMatched(this.ageOf(member)) || !canBeMatched(record.age) ||
        record.state === "paused" || (record.accountStatus !== undefined && record.accountStatus !== "active") ||
        !this.trust.ok(id) || this.reportHeld(id)) continue;
      current.add(id);
    }
    const pastParticipation = this.lastParticipation(now);
    const futureParticipation = new Set<MemberId>();
    const offeredRepeats = new Map<string, Opp>();
    for (const opportunity of this.opps.values()) {
      if (opportunity.repeatFrom) offeredRepeats.set(opportunity.repeatFrom, opportunity);
      if (opportunity.stage !== "scheduled" || opportunity.meetingAt === undefined || opportunity.meetingAt <= now) continue;
      for (const id of opportunity.participants) if (opportunity.status.get(id) === "yes") futureParticipation.add(id);
    }
    const pendingRepeats = new Set<MemberId>();
    for (const { source, pair, firstYes, secondYes } of this.repeatSources(now)) {
      if (!firstYes || !secondYes || !pair.every(id => current.has(id)) || !this.repeatPreferencesAllow(source.category, pair) ||
        !this.pairAllowed(...pair) || (this.declined.get(pairKey(...pair)) ?? -Infinity) > now - 60 * DAY) continue;
      const offer = offeredRepeats.get(source.id);
      if (offer && ((offer.stage !== "review" && offer.stage !== "probing") || offer.participants.length !== 2 ||
        !pair.every(id => offer.participants.includes(id) && offer.status.get(id) !== "no"))) continue;
      for (const id of pair) pendingRepeats.add(id);
    }
    return [...current].flatMap(id => {
      const record = records.get(id);
      const member = this.members.get(id);
      if (!record || !member || member.onlyWhenAsked || record.prefs?.onlyWhenAsked ||
        !record.prefs?.categoriesOptIn?.includes("events") || !record.prefs?.formats?.includes("event")) return [];
      return [{ memberId: id, eligible: true, newcomer: gatheringPriorityNewcomer(record.joinedAt, now),
        isolated: gatheringPriorityIsolated(record.joinedAt, pastParticipation.get(id) ?? -1, futureParticipation.has(id), now),
        pendingSecondEncounter: pendingRepeats.has(id) }];
    });
  }

  /** Current safe pair edges among the private, opted-in gathering roster. */
  gatheringGroupingEvidence(ids: readonly MemberId[], now: number) {
    if (this.app.id !== "ntwrk") return { members: [], pairs: [] };
    const records = new Map((this.ctx.snapshot().members as MemberRecord[]).map(record => [record.id, record]));
    const members = [...new Set(ids)].filter(id => {
      const member = this.members.get(id);
      const record = records.get(id);
      if (!member || member.stage !== "active" || record?.homeCity !== "nyc" || record.state === "paused"
        || (record.accountStatus !== undefined && record.accountStatus !== "active") || !canBeMatched(record.age)) return false;
      const current = relayMemberOf(member, !this.trust.ok(id) || this.reportHeld(id), earliestDayKeyOf(this.now()));
      return !current.optedOut && !current.held && canBeMatched(current.age);
    });
    const profiles = this.knownProfiles();
    const pairs: { first: MemberId; second: MemberId; value: number }[] = [];
    for (const [index, first] of members.entries()) {
      const interests = profiles.get(first)?.interests;
      for (const second of members.slice(index + 1)) {
        const key = pairKey(first, second);
        if (!this.pairAllowed(first, second) || (this.declined.get(key) ?? -Infinity) > now - 60 * DAY) continue;
        const shared = [...(profiles.get(second)?.interests ?? [])].filter(tag => interests?.has(tag)).length;
        pairs.push({ first, second, value: shared });
      }
    }
    return { members, pairs };
  }

  /** Encounters the Network composes itself: second encounters and newcomer welcomes. */
  private localEncounters(now: number) {
    this.growthTasks(now);
    if (!this.opts.matchingEnabled) return;
    const offered = new Set([...this.opps.values()].flatMap(o => o.repeatFrom ? [o.repeatFrom] : []));
    for (const { source, pair, firstYes, secondYes } of this.repeatSources(now)) {
      if (!firstYes || !secondYes) continue;
      const key = pairKey(...pair);
      const pairAvailable = this.pairAllowed(...pair) && (this.declined.get(key) ?? -Infinity) <= now - 60 * DAY;
      if (!queueRepeat(firstYes, secondYes, this.repeatOutreachAllowed(source.category, pair), pairAvailable, offered.has(source.id))) continue;
      const [a, b] = pair;
      const o = this.newOpp({ origin: "second_encounter", kind: "second_encounter", category: source.category, objective: "meet again", detail: "meeting up again", participants: [a, b], alternates: [], primed: [], explanations: { [a]: GOOD_FIT, [b]: GOOD_FIT }, score: 0.8, generator: "second_encounter", tags: [] });
      o.repeatFrom = source.id;
      this.submit(o);
    }
    // Newcomer welcome: members who joined in the last week and finished onboarding, paired with a
    // reliable member nearby who shares an interest.
    const known = this.knownProfiles();
    for (const m of this.members.values()) {
      if (m.stage !== "active" || now - m.joinedAt > 7 * DAY || now - m.joinedAt < DAY || m.minor || !this.eligible(m.id) || !m.invitedBy) continue;
      if ([...this.opps.values()].some(o => o.participants.includes(m.id))) continue;
      const mine = known.get(m.id);
      if (!mine) continue;
      const host = [...this.members.values()].filter(x => x.id !== m.id && x.id !== m.invitedBy && x.invitedBy !== m.id
        && x.state !== "receiving" && !x.minor && this.eligible(x.id) && x.noShows === 0 && now - x.joinedAt > 7 * DAY
        && this.pairAllowed(m.id, x.id) && !this.pairHistory(m.id, x.id, 60) && x.first.toLowerCase() !== m.first.toLowerCase()
        && (this.minutesBetween(m.area, x.area) ?? Infinity) <= 30 && [...(known.get(x.id)?.interests ?? [])].some(t => mine.interests.has(t)))
        .sort((a, b) => this.minutesBetween(m.area, a.area)! - this.minutesBetween(m.area, b.area)! || seededTie(this.opts.seed, m.id, a.id) - seededTie(this.opts.seed, m.id, b.id))[0];
      if (!host) continue;
      const hk = known.get(host.id)!;
      const shared = [...mine.interests].find(t => hk.interests.has(t))!;
      // Each side hears only the other's shareable facts (network-consent-11).
      const toNew = hk.sharedInterests.has(shared) ? `they're into ${interestLabel(shared)} too and live nearby` : "they live nearby";
      const toHost = mine.sharedInterests.has(shared) ? `they just joined and are into ${interestLabel(shared)}` : "they just joined and live nearby";
      const o = this.newOpp({ origin: "newcomer_welcome", kind: "newcomer_welcome", category: "social", objective: "welcome coffee", detail: "a welcome coffee", participants: [m.id, host.id], alternates: [], primed: [], explanations: { [m.id]: toNew, [host.id]: toHost }, score: 0.6, generator: "newcomer_welcome", tags: [shared] });
      this.submit(o);
    }
  }

  // ================================================================== send (every outbound message)
  /**
   * A standalone acknowledgement is not sent on its own: it is folded into the next message to this
   * member within OUTREACH.ackFoldMs, or dropped. Standalone acks count on the channel's unanswered
   * streak and pause members (attention-budget results, 2026-10-07).
   */
  private ack(m: MemberState, text: string, opts?: { direct?: boolean }) {
    if (opts?.direct && this.replyTo === m.id && this.memberReply) {
      if (this.sentThisTurn) return;
      if (this.send(m, text, { type: "info" }, "reply") === "sent") return;
    }
    m.pendingAck = { text, at: this.now() };
  }

  /**
   * The only way a message leaves the Network. In order:
   *  1. send-time recipient checks (P1-5);
   *  2. the cap and the unanswered rules (founder decision 3: `meta.proactive` marks an initial
   *     invite, the only kind that counts), and the one-question rule for asks;
   *  3. the Blooio streak (attention 1.9): an interruption needs at most 1 message unanswered,
   *     logistics at most 2; direct replies and safety notices are exempt;
   *  4. timing (founder decision 1): interruptions wait for the member's send slot, logistics for
   *     the end of quiet hours; replies and safety notices go at once. A deferral is logged;
   *  5. the leak guard.
   */
  private send(m: MemberState, body: string, meta: SimMeta, kind: SendKind, o: SendOpts = {}): SendResult {
    const now = this.now();
    const opportunity = this.opps.get(meta.proposalId ?? meta.probe?.key ?? meta.plan?.planId ?? "");
    if (opportunity && this.app.id === "friends" && meta.type && peerContactTypes.includes(meta.type)) {
      const peers = meta.booked && meta.participants?.length ? meta.participants : o.about ?? this.blockRoster(opportunity);
      const roster = [...new Set([m.id, ...peers])];
      if (!this.friendsRosterVerificationCurrent(roster)) return this.refuse(m.id, kind, "friends_verification_required", this.hookFns(m, o.hook));
    }
    if (this.app.id === "slop" && opportunity?.category === "romance" && this.opts.hooks?.hardDatingPairCurrent
      && (o.hook?.t === "probe" || o.hook?.t === "times" || o.hook?.t === "reveal")) {
      const approved = reviewApproved(opportunity.review);
      const accepted = opportunity.participants.every(id => opportunity.status.get(id) === "yes");
      if (!slopPairContactAllowed(approved, this.currentDatingPair(opportunity), o.hook.t === "reveal", accepted)) {
        return this.refuse(m.id, kind, "slop_pair_changed", this.hookFns(m, o.hook));
      }
    }
    if (opportunity?.seat && (o.hook?.t === "probe" || o.hook?.t === "reveal")
      && !this.hireContactCurrent(opportunity, m.id, o.hook.t === "reveal")) {
      return this.refuse(m.id, kind, "peon_search_changed", this.hookFns(m, o.hook));
    }
    if (opportunity?.lane === "Cofounder" && (meta.type === "probe" || meta.type === "scheduling" || meta.type === "proposal")) {
      const revealing = meta.type === "proposal" || o.key?.startsWith(RESCHEDULE_QUEUE_PREFIX) === true;
      const accepted = opportunity.participants.every(id => opportunity.status.get(id) === "yes" && opportunity.contacted.has(id));
      if (!cofounderDeliveryAllowed(this.cofounderCurrent(opportunity), reviewApproved(opportunity.review), revealing, accepted)) {
        return this.refuse(m.id, kind, "cofounder_intent_changed", this.hookFns(m, o.hook));
      }
    }
    const proactive = !!meta.proactive;
    if (proactive) this.refreshUnanswered(m, now);
    // A direct reply: anything we say to the member whose message we are handling, except a proactive
    // offer (that waits for the window like any other) or a growth/re-engagement ask.
    const reply = kind === "reply" || (!proactive && !!o.answersMemberAction) || (this.replyTo === m.id && !proactive && !NEVER_REPLY.has(kind));
    // A pending acknowledgement rides on the next message we start; when we are answering something
    // new the member said, the conversation has moved on and the old ack is dropped.
    if (m.pendingAck && (reply || now - m.pendingAck.at > OUTREACH.ackFoldMs)) m.pendingAck = undefined;
    const fns = this.hookFns(m, o.hook);
    const chk = this.checkRecipient(m.id, kind, { about: o.about, proactive, reply, ...(opportunity ? { opp: opportunity } : {}) });
    if (!chk.ok) return this.refuse(m.id, kind, chk.reason, fns);
    // Plan invites under the plan allowance were checked against their own ledger (planProbe); never the intro cap.
    if (proactive && !o.planInvite && this.overBudget(m)) return this.refuse(m.id, kind, "budget", fns);
    const ask = ASK_KINDS.has(kind) && !reply;
    if (ask && m.openAskAt !== undefined && now - m.openAskAt < OUTREACH.askOpenMs) return this.refuse(m.id, kind, "one_question", fns);
    // A pending yes/no (a probe or a booked plan) is the open question: an ask now would make the
    // member's next answer ambiguous ("Free Tuesday evening" read as a yes to the probe).
    if (ask && (m.awaiting?.kind === "probe" || m.awaiting?.kind === "booked")) return this.refuse(m.id, kind, "one_question", fns);
    const byTiming = o.gatheringRsvpLogistics || o.answersMemberAction ? "solicited" : this.classifyOutreach(m, meta, now);
    const survey = kind === "worthwhile" && !o.gatheringRsvpLogistics;
    const outreach = survey ? "unsolicited" : byTiming;
    const unsol = outreach === "unsolicited";
    // spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person"
    const timing = o.minorClose ? "now" : this.timingOf(kind, proactive || unsol, reply);
    if (timing !== "now") {
      const c = { outboundSinceInbound: m.outbound ?? 0 };
      const interrupt = timing === "slot" && kind !== "reengage";
      if (!(interrupt ? attention.canInterrupt(c) : attention.canSendLogistics(c))) return this.refuse(m.id, kind, "conversation_streak", fns);
      if (!this.timingOk(m, timing, now)) {
        if (o.noDefer) return "deferred";
        this.deferred.push({ memberId: m.id, body, meta, kind, o, timing });
        this.counters.deferred++;
        this.ctx.log("send_deferred", { memberId: m.id, kind, until: this.openAt(m, timing, now), ...(meta.proposalId ? { oppId: meta.proposalId } : {}) });
        return "deferred";
      }
    }
    // Fold a pending acknowledgement in only now, at the real send (never into a deferred body, which
    // would fold it twice), and only its first short sentence ("Got it, thanks."). Never into a relayed
    // text: that body is the other member's words, rendered by the relay policy, and goes as it is.
    if (m.pendingAck && !o.immutableBody && kind !== "safety" && kind !== "relay" && kind !== "home_help_consent" && !/^(thanks|great|no problem|got it)/i.test(body)) {
      const ack = m.pendingAck.text.split(/(?<=[.!?])\s/)[0]!;
      body = `${ack} ${body}`;
      if (o.fallback !== undefined) o = { ...o, fallback: `${ack} ${o.fallback}` };
    }
    // A note for this member ("That plan didn't come together this time.") rides on their next message.
    const note = m.note && !o.immutableBody && !o.memberInviteLink && !meta.privateInviteVouch && kind !== "safety" && kind !== "relay"
      && kind !== "home_help_consent" && now - m.note.at < 7 * DAY ? m.note.text : undefined;
    if (note) {
      body = `${note} ${body}`;
      if (o.fallback !== undefined) o = { ...o, fallback: `${note} ${o.fallback}` };
    }
    // Unsolicited sends (PRD 32.9 budgets, PH-003 pause path, F28 two-unanswered): marked proactive,
    // on the PRD budget of the member's state (plan invites and the weekly check-in on their own lane),
    // never a third in a row without an answer (the one re-engagement aside), and with a way to stop.
    if (unsol) {
      const why = this.unsolicitedRefusal(m, meta, kind, now);
      if (why) return this.refuse(m.id, kind, why, fns);
      // The weekly check-in is its own lane, never an interruption on the cap (founder decision 4d).
      // `unsolicited` marks a send the controller made proactive (not an initial invite on the intro cap).
      if (this.laneOf(meta) !== "check_in") meta = { ...meta, proactive: true, ...(meta.proactive ? {} : { unsolicited: true }) } as SimMeta;
    }
    const standaloneNotice = o.hook?.t === "invite_notice" ? o.hook.notice : undefined;
    let sentStandaloneNotice = standaloneNotice;
    if (standaloneNotice) {
      const status = this.inviteJoinCopy(m, standaloneNotice);
      if (status === undefined || m.onlyWhenAsked) return this.refuse(m.id, kind, "invite_notice_not_current", fns);
      body = `${body}${status.text}`;
    }
    const baseBody = body;
    const deliveredInviteJoins: InviteJoinNotice[] = [];
    // spec/outreachPolicy.md, "An eligible join receipt can ride on a current reply"
    const directMemberTurn = this.memberReply && this.replyTo === m.id;
    const carriesMemberText = kind === "safety" || kind === "relay";
    if (!standaloneNotice && !o.memberInviteLink && !meta.privateInviteVouch && m.pendingInviteJoins?.length && inviteJoinNoticeMayRideReply(directMemberTurn, reply, carriesMemberText, false)) {
      const current: InviteJoinNotice[] = [];
      const noticeOpportunity = opportunity ?? (o.hook?.t === "times" ? this.opps.get(o.hook.oppId) : undefined);
      const roles = new Set([...(noticeOpportunity?.participants ?? []), ...(noticeOpportunity?.alternates ?? []), ...(noticeOpportunity?.contacted ?? [])]);
      const roleNames = new Set([...roles].map(id => this.members.get(id)?.first.toLowerCase()));
      for (const notice of m.pendingInviteJoins) {
        const status = this.inviteJoinCopy(m, notice);
        if (status === undefined) continue;
        current.push(notice);
        const conflicts = inviteJoinNoticeConflictsWithRole(roles.has(notice.inviteeId), roleNames.has(status.first.toLowerCase()));
        if (!inviteJoinNoticeMayRideReply(directMemberTurn, reply, carriesMemberText, conflicts)) continue;
        if (body.length + status.text.length + 1 <= INVITE_REPLY_MAX_CHARS && !this.guardCheck(status.text, m.id).length) {
          body += ` ${status.text}`;
          deliveredInviteJoins.push(notice);
        }
      }
      m.pendingInviteJoins = current;
    }
    let text = body;
    const approvedLink = (value: string) => {
      if (kind === "reveal") return this.approvedBookingLink(meta.proposalId, m.id, value, o.key);
      const link = o.memberInviteLink;
      if (!link) return undefined;
      const presentOnce = value.endsWith(`\n${link}`) && value.indexOf(link) === value.lastIndexOf(link);
      return memberInviteLinkCanBeShared(this.memberReply && this.replyTo === m.id && reply, true, isMemberInvitationLink(this.app, link), presentOnce) ? link : undefined;
    };
    const reviewReference = this.memberReply && this.replyTo === m.id && reply ? o.memberInviteReviewReference : undefined;
    const approvedContact = (value: string) => approvedLink(value) ?? inviteReviewContactToken(value, reviewReference);
    const leaks = this.guardCheck(o.relayContact ? text.split(o.relayContact).join(" ") : text, m.id, o.relayFrom, approvedContact(text), o.publicVenueAddress);
    if (leaks.length) {
      const fallback = [deliveredInviteJoins.length ? baseBody : undefined, o.fallback].find(value =>
        value !== undefined && !this.guardCheck(value, m.id, o.relayFrom, approvedContact(value), o.publicVenueAddress).length);
      this.counters.guardBlocked++;
      this.ctx.log("guard_blocked", { memberId: m.id, kind, reasons: leaks, fallback: fallback !== undefined });
      if (fallback === undefined) { fns.onRefused?.(); return "refused"; }
      text = fallback;
      sentStandaloneNotice = undefined;
      deliveredInviteJoins.length = 0;
    }
    // Never the same text to one member twice within 10 minutes (the judge's duplicate_send rule).
    // Only plain texts are skipped; a send that changes state (onSent) is never silently dropped.
    if (!fns.onSent && m.lastSent?.body === text && now - m.lastSent.at < DUPLICATE_WINDOW) {
      this.ctx.log("send_skipped", { memberId: m.id, kind, reason: "duplicate" });
      return "refused";
    }
    // Only initial invites go on the cap and toward the two-unanswered pause (founder decision 3);
    // the re-engagement is the one message allowed past that pause and is counted the same way.
    // A plan invite goes on the plan allowance's own ledger instead (it still counts for two-unanswered and the streak).
    if (proactive) { if (o.planInvite) m.planInvites = [...(m.planInvites ?? []), now].slice(-20); else m.proactive.push(now); m.lastAskAt = now; }
    if (ask) { m.openAskAt = now; m.lastAskAt = now; }
    if (unsol) {
      text = attention.withPausePath(text);
      const lane = this.laneOf(meta);
      m.unsol = { ...m.unsol, [lane]: [...(m.unsol?.[lane] ?? []), now].slice(-20) };
      m.unsolStreak = (m.unsolStreak ?? 0) + 1;
    }
    // spec/interruptionFeedback.md, "Sample a confirmed invitation after its own answer"
    if (outreach === "followup" || interruptionFeedbackUsesFollowupSlot(survey, byTiming === "followup")) m.askUsed = (m.askUsed ?? 0) + 1;
    m.lastOutUnsol = unsol;
    m.outbound = (m.outbound ?? 0) + 1;
    if (o.memberInviteLink && approvedLink(text) === o.memberInviteLink) meta = { ...meta, approvedInviteLink: o.memberInviteLink };
    const invitationJoins = sentStandaloneNotice ? [sentStandaloneNotice.inviteeId] : deliveredInviteJoins.map(notice => notice.inviteeId);
    if (invitationJoins.length) meta = { ...meta, invitationJoins };
    const idPrefix = invitationJoins.length ? "invite-notice:"
      : kind === "reengage" ? reengagementDeliveryPrefix
      : o.hook?.t === "ask" && o.hook.engineQuestion ? engineQuestionDeliveryPrefix : "";
    const delivery = this.ctx.send(m.id, text, { meta, idempotencyKey: o.key ?? `${idPrefix}${m.id}:${++this.seq}`, reply });
    const hook = o.hook;
    if (hook?.t === "feedback" && !this.ctx.initialInviteReceipt && delivery.status === "delivered") {
      const meeting = this.opps.get(hook.oppId);
      if (meeting) (meeting.feedbackPromptedAt ??= {})[m.id] = delivery.ts;
    }
    if (proactive && (this.ctx.initialInviteReceipt || delivery.status === "delivered")) {
      const opportunityId = o.hook?.t === "probe" || o.hook?.t === "plan_probe" ? o.hook.oppId : undefined;
      const seen = m.pendingAsks.some(invite => invite.deliveryId === delivery.id || (opportunityId !== undefined && invite.opportunityId === opportunityId));
      if (!seen) m.pendingAsks.push({ kind, at: now, opportunityId, deliveryId: delivery.id,
        acceptedAt: this.ctx.initialInviteReceipt ? undefined : delivery.ts });
    }
    if (deliveredInviteJoins.length) m.pendingInviteJoins = m.pendingInviteJoins?.filter(notice => !deliveredInviteJoins.includes(notice));
    if (kind !== "home_help_consent" && !o.immutableBody) m.pendingAck = undefined;
    if (note || (m.note && now - m.note.at >= 7 * DAY)) m.note = undefined;
    const storedText = o.memberInviteLink ? text.replace(o.memberInviteLink, "").trimEnd()
      : meta.privateInviteVouch ? "Private invitation reply"
      : sentStandaloneNotice ? "Invitation join notice"
      : deliveredInviteJoins.length ? baseBody : text;
    const consentProbe = hook?.t === "probe" || hook?.t === "plan_probe" || hook?.t === "times" ? hook.oppId : null;
    m.lastSent = { body: storedText, at: now, consentProbe };
    if (!standaloneNotice || sentStandaloneNotice) fns.onSent?.(delivery.id);
    if (m.id === this.replyTo) this.sentThisTurn = true;
    return "sent";
  }

  /**
   * Alternates for an opportunity: never a participant, never someone blocked by a participant (the
   * judge's blocked_pair_proposed counts alternates, and pairs of alternates, too), and never a second person with the same
   * first name as anyone already in it, so a reveal ("meet Hiroshi G.") can only ever mean the person
   * who said yes, never someone else who was asked.
   */
  private distinctAlternates(participants: readonly MemberId[], alternates: readonly MemberId[]): MemberId[] {
    const firsts = new Set(participants.map(p => this.members.get(p)?.first.toLowerCase()).filter(Boolean));
    const out: MemberId[] = [];
    for (const a of alternates) {
      const am = this.members.get(a);
      if (!am || ((am.minor || am.minorSignal) && !this.teenPlanSeat(a))) continue;
      if (participants.includes(a) || [...participants, ...out].some(p => !this.pairAllowed(p, a))) continue;
      const f = this.members.get(a)?.first.toLowerCase();
      if (f && firsts.has(f)) continue;
      if (f) firsts.add(f);
      out.push(a);
    }
    return out;
  }

  /** Someone who is or was in this opportunity (a participant, or anyone asked) has `a`'s first name. */
  private sharesFirstName(o: Opp, a: MemberId): boolean {
    const f = this.members.get(a)?.first.toLowerCase();
    return !!f && [...o.participants, ...o.status.keys(), ...o.contacted].some(x => x !== a && this.members.get(x)?.first.toLowerCase() === f);
  }

  /** An outreach question sent in the last 24 hours is still waiting for its answer. */
  private askOpen(m: MemberState, now: number): boolean {
    return m.openAskAt !== undefined && now - m.openAskAt < questionHoldMs;
  }

  /** Direct interview replies do not use the outreach ask counter, but their answers must not count as consent. */
  private questionHoldUntil(m: MemberState, now: number): number | undefined {
    const interviewAt = m.awaiting?.kind === "interview" ? m.awaiting.at : undefined;
    const askedAt = Math.max(m.openAskAt ?? -Infinity, interviewAt ?? -Infinity);
    if (!Number.isFinite(askedAt)) return undefined;
    const until = probeQuestionHoldUntil(askedAt);
    return now < until ? until : undefined;
  }

  /**
   * Is this send unsolicited (PRD 32.9)? Not a reply (within 15 minutes of the member's own message,
   * at most 3 of them), not inside an opportunity the member said yes to (or asked for), and not one
   * of the 2 follow-ups to the member's own ask within 48 hours. Safety notices are never budgeted.
   */
  private classifyOutreach(m: MemberState, meta: SimMeta, now: number): "solicited" | "followup" | "unsolicited" {
    if (meta.type === "system" || meta.homeHelpConsentFor === "requester") return "solicited";
    const lastIn = Math.max(m.lastInbound, m.joinedAt);
    if (now - lastIn <= REPLY_WINDOW_MS && (m.outbound ?? 0) < REPLY_BURST) return "solicited";
    const x = meta as SimMeta & { plan?: { planId?: string } };
    const oppId = x.proposalId ?? x.probe?.key ?? x.plan?.planId;
    const o = oppId ? this.opps.get(oppId) : undefined;
    if (o && (o.status.get(m.id) === "yes" || o.primed.has(m.id) || o.planRun?.answers[m.id] === "yes")) return "solicited";
    if (m.askAt !== undefined && now - m.askAt <= ASK_WINDOW_MS && (m.askUsed ?? 0) < ASK_FOLLOWUPS) return "followup";
    return "unsolicited";
  }

  /** The lane an unsolicited send counts on: the plan allowance, the weekly check-in, or the state budget. */
  private laneOf(meta: SimMeta): "plan" | "check_in" | "state" {
    const x = meta as SimMeta & { lane?: string; checkIn?: boolean };
    return x.checkIn === true ? "check_in" : x.lane === "plan" ? "plan" : "state";
  }

  /** Why an unsolicited send may not go out now, or undefined. */
  private unsolicitedRefusal(m: MemberState, meta: SimMeta, kind: SendKind, now: number): string | undefined {
    const x = meta as SimMeta & { reengagement?: boolean };
    const streak = m.unsolStreak ?? 0;
    if (streak >= 2 && !(x.reengagement === true && streak === 2)) return "two_unanswered";
    this.syncRecord(m);
    const sb = PRD_BUDGETS[m.state as ParticipationState] ?? PRD_BUDGETS.normal;
    if (sb.n <= 0) return "prd_budget";
    const lane = this.laneOf(meta);
    const b = lane === "state" ? sb : LANE_BUDGETS[lane];
    const used = (m.unsol?.[lane] ?? []).filter(t => now - t < b.days * DAY).length;
    if (used >= b.n) return "prd_budget";
    // Asks and notices that are not about an opportunity (growth, profiling, "none yet", the check-in)
    // never take the last slot of the state budget: it is kept for an opportunity.
    const x2 = meta as SimMeta & { plan?: { planId?: string } };
    const aboutOpp = !!(x2.proposalId ?? x2.probe?.key ?? x2.plan?.planId) || meta.type === "probe" || meta.type === "plan_probe";
    const invite = aboutOpp || kind === "reengage";
    if (lane === "state" && !invite && used + 1 >= b.n) return "prd_budget_reserved";
    return undefined;
  }

  /**
   * What a send hook does (SendOpts.hook). Every hook that names an opportunity does nothing, and is
   * not valid, once that opportunity is gone.
   */
  private hookFns(m: MemberState, h: SendHook | undefined): HookFns {
    if (!h) return {};
    const o = "oppId" in h ? this.opps.get(h.oppId) : undefined;
    const now = () => this.now();
    switch (h.t) {
      case "interview": return { onSent: () => { m.awaiting = { kind: "interview", at: now() }; } };
      case "age": return { onSent: () => { m.awaiting = { kind: "age", at: now() }; } };
      case "suggested": return { onSent: () => this.suggested(m, h.venues) };
      case "retry_found": return { valid: () => !!o && OPEN_STAGES.has(o.stage) && o.stage !== "review" };
      case "reschedule_offer": return {
        valid: () => {
          const draft = o?.reschedule;
          return !!o && !!draft && h.key === rescheduleOfferKey(draft, m.id) && !draft.offered.includes(m.id) && this.currentReschedule(o, draft, now());
        },
        onSent: () => {
          const draft = o?.reschedule;
          if (!draft || h.key !== rescheduleOfferKey(draft, m.id) || draft.offered.includes(m.id)) return;
          draft.offered.push(m.id);
          if (!this.ctx.initialInviteReceipt) (draft.deliveredAt ??= {})[m.id] = now();
        },
      };
      case "reschedule_updated": return {
        valid: () => !!o && rescheduleNoticeCurrent({ ...o, current: o.stage === "scheduled" }, this.rescheduleRoster(o), m.id, h.key, now()),
      };
      case "invite_notice": return {
        valid: () => (m.pendingInviteJoins ?? []).some(x => x.inviteeId === h.notice.inviteeId && x.at === h.notice.at)
          && this.inviteJoinCopy(m, h.notice) !== undefined && !m.onlyWhenAsked,
        onSent: () => {
          m.pendingInviteJoins = m.pendingInviteJoins?.filter(x => x.inviteeId !== h.notice.inviteeId || x.at !== h.notice.at);
        },
      };
      case "standing_renewal": return {
        valid: () => this.standingRenewalCurrent(m, h.key, h.deadline),
        onSent: () => { m.standingPending = { kind: "RenewalAsked", keys: [h.key], at: now() }; },
      };
      case "empty_intent": return {
        valid: () => this.emptyIntentNoticeReady(m, h, now()),
        onSent: () => {
          m.emptyIntentNotices = { ...m.emptyIntentNotices, [h.intentId]: h.statedAt };
          this.ctx.log("empty_intent_followup", { memberId: m.id, intentId: h.intentId, reason: h.reason });
        },
      };
      case "probe": return {
        // spec/probeDispatch.md, "A queued probe goes out only for the roster that it describes"
        valid: () => !!o && o.stage === "probing" && o.participants.includes(h.id) && o.status.get(h.id) === "probing"
          && queuedProbeCurrent((o.roster ?? 0) !== (h.roster ?? 0), false),
        onSent: messageId => {
          if (!o) return;
          // spec/probeDispatch.md, "Wait for the member's send window and current availability"
          const turn = participantProbe(o, h.id);
          if (canRecordProbeSent(turn)) storeProbe(o, h.id, stepProbe(turn, { type: "recordProbeSent" }), messageId);
          m.awaiting = { kind: "probe", oppId: o.id, at: now(), probeReceiptId: messageId, probeInboundCount: m.msgsIn };
          m.endedProbe = undefined;
          o.contacted.add(h.id);
          if (o.managerProbeSuspended && o.seat?.manager === h.id) o.managerProbeSuspended = undefined;
          else {
            m.asked++;
            o.sentAt = { ...o.sentAt, [h.id]: now() };
          }
          this.counters.probesSent++;
          const n = o.offered?.[h.id]?.length ?? 0;
          if (n) this.counters.probesWithOptions++;
          this.ctx.log("probe_sent", { oppId: o.id, memberId: h.id, category: o.category, options: n, invite: o.requester !== h.id });
        },
        onRefused: () => {
          if (!o || o.stage !== "probing" || o.status.get(h.id) !== "probing") return;
          o.status.set(h.id, "unavailable");
          this.replaceOrClose(o, h.id);
        },
      };
      case "times": return {
        valid: () => !!o && o.stage === "probing" && o.status.get(h.id) === "probing",
        onSent: messageId => {
          if (o) m.awaiting = { kind: "probe", oppId: o.id, at: now(), probeReceiptId: messageId, probeInboundCount: m.msgsIn };
        },
        onRefused: () => {
          if (!o || o.stage !== "probing" || o.status.get(h.id) !== "probing") return;
          if (isGatheringRepeat(o)) return this.closeNoCommonTime(o, h.id);
          // Existing scheduling uses the best common time if its extra question could not go out.
          o.status.set(h.id, "available");
          this.advanceProbes(o);
        },
      };
      case "reveal": return {
        valid: () => !!o && o.stage === "scheduled" && (o.scheduleRevision ?? 0) === 0 && o.status.get(h.id) === "yes"
          && (o.workIntro
            ? (o.workIntro.videoSlotAt !== undefined
              ? now() < o.workIntro.videoSlotAt
              : !o.feedbackSent && now() < (o.workIntro.followupDueAt ?? (o.meetingAt ?? now()) + 7 * DAY))
            : now() < (o.meetingAt ?? Infinity)),
        onSent: () => {
          if (!o) return;
          this.expect(m, { kind: "booked", oppId: o.id, at: now() });
          o.bookedTold = [...(o.bookedTold ?? []), h.id]; this.counters.reveals++;
          // The member accepted a plan at this time (NC plan_accepted; silence for 48 hours confirms it).
          o.bookedAt = { ...o.bookedAt, [h.id]: now() };
          if (!this.ctx.initialInviteReceipt) this.captureSlopIntroductions([o]);
          this.emit({ type: "plan_accepted", member: h.id, planId: o.id, kind: this.planKind(o), startsAt: o.meetingAt ?? now() }, `${o.id}:${h.id}`);
          if (!m.offerMade && !m.minor) { m.offerMade = true; this.ctx.log("availability_offer", { memberId: m.id }); }
        },
        // The plan cannot stand without them: it is off, and whoever was told hears so (never why).
        onRefused: () => { if (o && o.stage === "scheduled" && o.status.get(h.id) === "yes") this.handleDrop(m, o, false); },
      };
      case "plan_probe": return {
        valid: () => !!o && !!o.planRun && o.planRun.answers[h.id] === "pending",
        onSent: messageId => {
          if (!o) return;
          const turn = participantProbe(o, h.id);
          if (canRecordProbeSent(turn)) storeProbe(o, h.id, stepProbe(turn, { type: "recordProbeSent" }), messageId);
          m.awaiting = { kind: "probe", oppId: o.id, at: now(), probeReceiptId: messageId };
          if (h.options) o.offered = { ...o.offered, [h.id]: h.options };
          m.asked++; o.contacted.add(h.id);
          o.sentAt = { ...o.sentAt, [h.id]: now() };
          this.counters.probesSent++; this.plansCounters.planProbes++;
          this.ctx.log("probe_sent", { oppId: o.id, memberId: h.id, category: o.category, options: h.options?.length ?? 0, invite: true, plan: true });
        },
        onRefused: () => { if (o) this.planOut(o, h.id); },
      };
      case "crew_offer": return {
        valid: () => this.crewOffers.some(c => c.crew.id === h.crewId && !c.resolved),
        onSent: messageId => this.expect(m, { kind: "crew", crewId: h.crewId, at: now(), crewOfferReceiptId: messageId }),
      };
      case "group_late": return {
        valid: () => !!o && this.lateArrivalPartyCurrent(h.from) && this.lateArrivalPartyCurrent(m.id)
          && lateArrivalDeliveryCurrent(o, h, now(), id => o.status.get(id) === "yes", id => this.lateArrivalBookingReceived(o, id, now()))
          && h.app === this.app.id && m.id === h.to,
      };
      // The meeting time is in the hook: the notice still goes when the opportunity was deleted with the
      // member who dropped (forget, in quiet hours), as the partner must not go to the venue (SD-248).
      case "drop_notice": return { valid: () => now() < (o?.meetingAt ?? h.meetingAt ?? Infinity) };
      case "feedback": return { onSent: () => { if (o) this.expect(m, { kind: "feedback", oppId: o.id, at: now() }); } };
      case "growth": return { onSent: () => { this.expect(m, { kind: "growth", at: now() }); this.counters.growthAsks++; this.ctx.log("growth_ask", { memberId: m.id, kind: h.kind }); } };
      case "reengage": return {
        valid: () => this.reengagementCurrent(m, now()),
        onSent: () => {
          m.reengaged = true;
          this.counters.reengagements++;
          this.ctx.log("reengagement", { memberId: m.id });
        },
      };
      case "checkin": return {
        valid: () => !!m.weekly && !m.minor,
        onSent: () => { m.lastCheckinAt = now(); this.counters.checkinsSent++; this.expect(m, { kind: "checkin", at: now() }); this.ctx.log("checkin_sent", { memberId: m.id }); },
      };
      case "ask": return {
        // `follow`: the next onboarding question in a conversation the member is having now (not on the ask interval).
        valid: () => !m.minor && !m.awaiting && (!!h.follow || now() - this.lastAsk(m.id) >= ASK_EVERY_DAYS * DAY),
        onSent: deliveryId => {
          const rec: AskRecord = { memberId: m.id, at: now(), reason: h.reason };
          // One message can carry several asks: one record each, answered together.
          for (const r of h.also ?? []) this.asks.push({ memberId: m.id, at: rec.at, reason: r });
          const ob = this.opts.hooks?.onboarding;
          if (ob) m.onboarding = ob.asked(m.onboarding, [h.reason, ...(h.also ?? [])], { age: this.ageOf(m) });
          this.asks.push(rec); m.asked++; this.counters.asksSent++;
          this.expect(m, { kind: "interview", ask: rec, at: rec.at, ...(h.engineQuestion ? { engineQuestionDeliveryId: deliveryId } : {}) });
          this.ctx.log("ask_sent", { memberId: m.id, reason: h.reason });
        },
      };
      // A stored deferred send from an older flow (a nudge or a separate confirmation) is not sent.
      default: return { valid: () => false };
    }
  }

  /**
   * Remember what the member's next message probably answers. A pending yes/no (probe or reveal) is
   * never replaced by a later feedback or growth question: "can't this week" must reach the probe.
   */
  private expect(m: MemberState, aw: NonNullable<MemberState["awaiting"]>) {
    if (m.awaiting && (m.awaiting.kind === "probe" || m.awaiting.kind === "booked") && aw.kind !== "probe" && aw.kind !== "booked") return;
    m.awaiting = aw;
  }

  /** When a send may go out: replies and safety notices at once; initial invites and asks in the send slot; the rest outside quiet hours. */
  private timingOf(kind: SendKind, proactive: boolean, reply: boolean): Timing {
    if (reply || kind === "safety") return "now";
    return proactive || SLOT_KINDS.has(kind) ? "slot" : "logistics";
  }

  /** The member as the engine's attention functions see them, with the send time learned from their replies. */
  private view(m: MemberState, now: number): attention.MemberAttention {
    const state = (["open", "normal", "quiet", "receiving", "paused"].includes(m.state) ? m.state : "normal") as ParticipationState;
    const day = Math.floor(now / DAY), n = m.replies?.length ?? 0;
    const tz = this.memberZone(m.id);
    let c = this.profiles.get(m.id);
    const q = m.quietHours.join("-");
    if (!c || c.day !== day || c.n !== n || c.state !== state || c.q !== q || c.tz !== tz) {
      const prof = attention.learnSendProfile(m.replies ?? [], tz, now, m.quietHours);
      c = { day, n, state, q, tz, hours: { weekday: prof.weekday, weekend: prof.weekend } };
      this.profiles.set(m.id, c);
    }
    const stated = this.statedToday(m);
    return {
      memberId: m.id, state, age: m.minor ? 13 : validAge(m.age) ? m.age! : validAge(stated) ? stated : 13, tz, quietHours: m.quietHours,
      onlyWhenAsked: m.onlyWhenAsked, prefs: { ...attention.defaultCadence(state), sendHours: c.hours },
      // The record's opt-ins, never a default: the engine's romance item gate fails closed on them (engine-attention-plans-7).
      categoriesOptIn: [...(this.record(m.id)?.prefs?.categoriesOptIn ?? [])],
    };
  }
  /** Learned send hours per member, recomputed once a day or after a new reply (not stored: deterministic from the replies). */
  private profiles = new Map<MemberId, { day: number; n: number; state: ParticipationState; q: string; tz: string; hours: { weekday: number; weekend: number } }>();

  private networkCity(): City {
    return isCity(this.opts.city) ? this.opts.city : "nyc";
  }

  private cityTz(): string {
    return tzForCity(this.opts.city);
  }

  private dailyProactiveCount(m: MemberState, now: number): number {
    const tz = this.memberZone(m.id);
    const today = localDateParts(now, tz).day;
    return m.proactive.filter(t => localDateParts(t, tz).day === today).length;
  }

  private venuePrefsOf(
    id: MemberId,
    extraVisited: readonly string[] = [],
    facetsByMember?: ReadonlyMap<MemberId, Facet[]>,
  ): { prefs: MemberVenuePrefs; hasRedLines: boolean; nonDrinker: boolean; explicitBudgetTier?: VenuePriceTier } {
    const m = this.members.get(id);
    const snapFacets = (facetsByMember ?? this.snapshotRows().facets).get(id) ?? [];
    const allTags = new Set<string>();
    for (const f of snapFacets) {
      for (const t of f.tags) allTags.add(t.trim().toLowerCase());
      const v = f.value.trim().toLowerCase();
      if (v) allTags.add(v);
    }
    for (const t of m?.learned.redLines ?? []) allTags.add(t.trim().toLowerCase());
    for (const t of m?.appTags ?? []) allTags.add(t.tag.trim().toLowerCase());
    const hasTag = (needles: readonly string[]) => needles.some(n => {
      if (allTags.has(n)) return true;
      for (const t of allTags) if (t.endsWith(`:${n}`) || t === n) return true;
      return false;
    });
    const strictSober = hasTag(["strict_sober", "sober", "no_alcohol", "alcohol_free", "alcohol_boundary"]);
    const nonDrinker = strictSober || hasTag(["non_drinker", "nondrinker", "slop:drinking:never", "alcohol:none"]);
    const vegetarian = hasTag(["vegetarian"]);
    const vegan = hasTag(["vegan"]);
    const halal = hasTag(["halal"]);
    const kosher = hasTag(["kosher"]);
    const glutenFree = hasTag(["gluten_free", "celiac"]);
    const severeAllergen = hasTag(["severe_allergen", "nut_allergy", "peanut_allergy", "shellfish_allergy"]);
    const wheelchairNeeded = hasTag(["wheelchair", "wheelchair_accessible"]);
    const lowWalking = wheelchairNeeded || hasTag(["low_walking", "no_hiking"]);
    const smokeFree = hasTag(["smoke_free", "non_smoker", "slop:dealbreaker:smoker"]);
    const lowNoiseRequired = hasTag(["low_noise", "quiet_only", "hearing_accessible"]);
    const daytimeOnly = hasTag(["daytime_only", "no_after_dark"]);
    let explicitBudgetTier: VenuePriceTier | undefined;
    const setBudget = (tier: VenuePriceTier) => {
      explicitBudgetTier = explicitBudgetTier === undefined ? tier : (Math.min(explicitBudgetTier, tier) as VenuePriceTier);
    };
    for (const t of allTags) {
      const numeric = /^(?:budget|price_tier|venue_budget|spend|hv:spend):([1-4])$/.exec(t);
      if (numeric) {
        setBudget(Number(numeric[1]) as VenuePriceTier);
        continue;
      }
      const named = /^(?:hv:)?spend:(free|low|moderate|high|unconstrained)(?:tier)?$/.exec(t);
      if (named) {
        const level = named[1]!;
        setBudget(level === "free" || level === "low" ? 1 : level === "moderate" ? 2 : level === "high" ? 3 : 4);
      }
    }
    const hobbies = [...new Set([...snapFacets.filter(f => f.kind === "interest").flatMap(f => f.tags), ...(m?.learned.interests ?? [])])];
    const age = m
      ? (m.minor || m.minorSignal || m.minorReported ? 13 : validAge(m.age) ? m.age : validAge(m.statedAge) ? m.statedAge : (this.adultMember(id) ? 25 : 16))
      : (this.adultMember(id) ? 25 : 16);
    const hasRedLines = strictSober || nonDrinker || vegetarian || vegan || halal || kosher || glutenFree || severeAllergen || wheelchairNeeded || lowWalking || smokeFree || lowNoiseRequired || daytimeOnly;
    const visitedVenueIds = extraVisited.length
      ? [...new Set([...this.venues.visitedBy(id), ...extraVisited])]
      : this.venues.visitedBy(id);
    const rejectedVenueIds = this.venues.rejectedBy(id);
    return {
      hasRedLines,
      nonDrinker,
      ...(explicitBudgetTier !== undefined ? { explicitBudgetTier } : {}),
      prefs: {
        memberId: id,
        age,
        drinksAlcohol: !nonDrinker && canBeMatched(age),
        strictSober,
        vegetarian,
        vegan,
        halal,
        kosher,
        glutenFree,
        severeAllergen,
        wheelchairNeeded,
        lowWalking,
        smokeFree,
        lowNoiseRequired,
        daytimeOnly,
        maxBudgetTier: explicitBudgetTier ?? 4,
        visitedVenueIds,
        rejectedVenueIds,
        hobbies,
      },
    };
  }

  private memberVenuePrefs(ids: readonly MemberId[]): { nonDrinker: boolean; maxBudgetTier?: VenuePriceTier } {
    let nonDrinker = false;
    let maxBudgetTier: VenuePriceTier | undefined;
    for (const id of ids) {
      const p = this.venuePrefsOf(id);
      if (p.nonDrinker) nonDrinker = true;
      if (p.explicitBudgetTier !== undefined) {
        maxBudgetTier = maxBudgetTier === undefined ? p.explicitBudgetTier : (Math.min(maxBudgetTier, p.explicitBudgetTier) as VenuePriceTier);
      }
    }
    return { nonDrinker, ...(maxBudgetTier !== undefined ? { maxBudgetTier } : {}) };
  }

  private memberZone(id: MemberId): string {
    const home = this.record(id)?.homeCity;
    if (isCity(home)) return CITY_TZ[home];
    return this.cityTz();
  }

  /** May a send with this timing go out now? Quiet hours always win; interruptions also need the send window. */
  // spec/recipientEligibility.md, "Quiet hours hold every send that can wait"
  private timingOk(m: MemberState, timing: Timing, now: number): boolean {
    if (timing === "now") return recipientTimingAllowed("TimingNow", false, false);
    this.syncRecord(m);
    const v = this.view(m, now);
    return recipientTimingAllowed(timing === "logistics" ? "TimingLogistics" : "TimingSlot", attention.inMemberQuietHours(v, now), attention.inSendWindow(v, now));
  }

  /** The next time a send with this timing may go out (for the send_deferred log). */
  private openAt(m: MemberState, timing: Timing, now: number): number {
    const v = this.view(m, now);
    if (timing !== "slot") return attention.memberQuietEnd(v, now);
    let t = attention.inSendWindow(v, now) ? now : attention.nextDigestSlot(v, now);
    for (let i = 0; i < 4 && Number.isFinite(t); i++) {
      if (!attention.inMemberQuietHours(v, t)) return t;
      const q = attention.memberQuietEnd(v, t);
      if (attention.inSendWindow(v, q)) return q;
      t = attention.nextDigestSlot(v, q);
    }
    return t;
  }

  private refuse(id: MemberId, kind: SendKind, reason: string, o?: HookFns): "refused" {
    this.counters.sendRefused++;
    // Someone declined at join is never named in a log.
    this.ctx.log("send_refused", { ...(this.declinedIds.has(id) ? {} : { memberId: id }), kind, reason });
    o?.onRefused?.();
    return "refused";
  }

  private overBudget(m: MemberState): boolean {
    this.syncRecord(m);
    const b = OUTREACH.budget[m.state] ?? OUTREACH.budget.normal!;
    const now = this.now();
    return initialInviteBudgetSpent(m.proactive.filter(t => initialInviteInBudgetWindow(t, now, b.days)).length, b.n);
  }

  recipientPolicy(memberId: MemberId, kind: SendKind, o: { about?: MemberId[]; proactive?: boolean; oppId?: string } = {}): RecipientCheck {
    const { oppId, ...rest } = o;
    return this.checkRecipient(memberId, kind, { ...rest, reply: kind === "reply", ...(oppId !== undefined ? { opp: this.opps.get(oppId) } : {}) });
  }

  // spec/recipientEligibility.md, "Check the recipient's own state in a fixed order"; "A message about another member needs two adults with no block between them"
  private checkRecipient(id: MemberId, kind: SendKind, o: { about?: MemberId[]; proactive?: boolean; reply: boolean; opp?: Opp }): RecipientCheck {
    const m = this.members.get(id);
    if (m) this.syncRecord(m);
    const teen = this.teenContactAllowed(o.opp, [id, ...(o.about ?? [])])
      || (kind === "feedback" && this.teenFeedbackAllowed(o.opp, [id, ...(o.about ?? [])]));
    const category = o.opp?.category;
    const matchingStopped = (member: MemberState, memberId: MemberId) =>
      !this.canStartMatching(member) || (category !== undefined && !this.allowsMatchCategory(memberId, category));
    const recipient = {
      declined: this.declinedIds.has(id), known: !!m, optedOut: !!m?.optedOut, accountRestricted: !!m?.account,
      matchingStopped: !!m && matchingStopped(m, id),
      held: !!m && (this.trust.level(id) === "hold" || this.reportHeld(id)), onlyWhenAsked: !!m?.onlyWhenAsked,
      notAdult: this.notKnownAdult(m), onWatch: !!m && !this.trust.ok(id),
    };
    const others = m ? (o.about ?? []).filter(x => x !== id).map(x => {
      const other = this.members.get(x);
      if (other) this.syncRecord(other);
      return {
        blocked: this.blocked(id, x), avoided: this.avoided(id, x), present: !!other, verifiedInvitee: !other && !!this.ctx.verifiedJoinedInviteeName?.(id, x),
        notAdult: this.notKnownAdult(other), restricted: !!other?.account, matchingStopped: !!other && matchingStopped(other, x),
        declinedAtJoin: this.declinedIds.has(x),
        reportHeld: this.reportHeld(x), watched: !this.trust.ok(x),
      };
    }) : [];
    const verdict = recipientVerdict(recipient, { kind, reply: o.reply, proactive: !!o.proactive, askKind: ASK_KINDS.has(kind), teenItem: teen }, others);
    if (verdict === "RecipientEligible") return { ok: true };
    const reason = recipientRefusalReason(verdict);
    return { ok: false, reason: verdict === "RecipientAccountRestricted" ? `${reason}_${m!.account}` : reason };
  }

  private notKnownAdult(m: MemberState | undefined): boolean {
    return !m || !this.adultMember(m.id);
  }

  /** Leak guard: other members' private facts and every canary, compiled once per change in private facets. */
  private guardCache?: { snap: WorldSnapshot; key: string; guard: LeakGuard };
  private guardCheck(text: string, recipient: MemberId, alsoOwner?: MemberId, approvedContact?: string, publicVenueAddress?: string): string[] {
    const snap = this.snapshotCached();
    if (!this.guardCache || this.guardCache.snap !== snap) {
      const priv = snap.facets.filter(f => f.scope === "agent_private");
      // Ids and values: a private value edited in place must rebuild the guard (core-m2).
      const key = priv.map(f => `${f.id}\u0000${f.value}`).join("\u0001");
      const guard = this.guardCache?.key === key ? this.guardCache.guard : new LeakGuard({
        forbidden: priv.map(f => ({ text: f.value, owner: f.memberId })),
        canaries: priv.flatMap(f => [...f.value.matchAll(CANARY_RE)].map(x => x[1]!)),
        allow: [HELP_TEXT, STOP_CONFIRMATION, ...appKeys.map(app => brandFor(app).domain)], publicPhrases: PUBLIC_PHRASES,
      });
      this.guardCache = { snap, key, guard };
    }
    const contactAllow = approvedContact ? [approvedContact] : undefined;
    const checkWith = (candidate: string) => {
      const found = this.guardCache!.guard.check(candidate, { exceptOwner: recipient, contactAllow });
      // A relayed text: what the sender wrote about themselves may go to the person they wrote to.
      if (alsoOwner === undefined || !found.length) return found;
      const theirs = new Set(this.guardCache!.guard.check(candidate, { exceptOwner: alsoOwner, contactAllow }));
      return found.filter(l => theirs.has(l));
    };
    const leaks = checkWith(text);
    if (publicVenueAddress && leaks.includes("contact:street_address") && text.includes(publicVenueAddress)) {
      const withoutAddr = checkWith(text.split(publicVenueAddress).join(" "));
      if (!withoutAddr.includes("contact:street_address")) return leaks.filter(l => l !== "contact:street_address");
    }
    return leaks;
  }

  /** Verified public venue street address for an active meetup brief/pivot (for Blooio outbound queue leak allowlist). */
  publicMeetupVenueAddress(oppId: string | undefined, text: string): string | undefined {
    if (!oppId) return undefined;
    const meetup = this.meetups.getMeetup(oppId);
    if (!meetup) return undefined;
    for (const vid of [meetup.activeVenueId, meetup.primaryVenueId, meetup.backupVenueId]) {
      if (!vid) continue;
      const v = this.venues.getVenue(vid);
      if (v?.public === true && v.address && text.includes(v.address)) return v.address;
    }
    return undefined;
  }

  /**
   * The leak lists for a message to `recipients` (the Blooio outbound queue's LeakSources shape):
   * every agent-private value (multi-word ones also as facts, matched fuzzily) and every canary,
   * except the recipient's own. A group (several recipients) or an unknown recipient excludes nothing,
   * so every participant is covered. The Network's own place and interest names are public phrases.
   */
  leakSources(recipients?: readonly MemberId[], alsoOwners: readonly MemberId[] = []): LeakSources {
    const own = recipients?.length === 1 ? recipients[0] : undefined;
    // `alsoOwners`: a relayed text may carry its sender's own facts (guardCheck's relayFrom), only with a single known recipient.
    const except = new Set(own === undefined ? [] : [own, ...alsoOwners]);
    const priv = this.snapshotCached().facets.filter(f => f.scope === "agent_private" && !except.has(f.memberId));
    const values = [...new Set(priv.map(f => f.value.trim()).filter(Boolean))];
    return {
      forbidden: values,
      facts: values.filter(v => v.split(/\s+/).length >= 2),
      canaries: [...new Set(priv.flatMap(f => [...f.value.matchAll(CANARY_RE)].map(x => x[1]!)))],
      publicPhrases: PUBLIC_PHRASES,
    };
  }

  // ================================================================== helpers
  /** Known profile per member: snapshot facets (what onboarding/sources captured) + learned. */
  private knownCache?: { profiles: Map<MemberId, KnownProfile>; firstIntentExpiry: number };
  private knownProfiles() {
    const snap = this.snapshotCached();
    const now = this.now();
    if (this.knownCache && cachedStandingIntentsCurrent(this.knownCache.firstIntentExpiry, now)) return this.knownCache.profiles;
    let firstIntentExpiry = Infinity;
    const map = new Map<MemberId, KnownProfile>();
    const get = (id: MemberId) => { let x = map.get(id); if (!x) { x = { interests: new Set(), skills: new Set(), strongSkills: new Set(), desires: new Map(), intents: 0, sharedInterests: new Set(), sharedSkills: new Set() }; map.set(id, x); } return x; };
    const ontology = (this.opts.pack ?? networkPack).ontology;
    let config: ReturnType<typeof resolveConfig> | undefined;
    // spec/standingIntent.md, "Use the matching category for known want evidence"
    const addDesire = (profile: KnownProfile, def: DesireDef, intent: Intent) => {
      const relabelled = intent.category === "growth"
        ? ontology.relabelIntent?.(intent, config ??= resolveConfig(this.effectiveEngineConfig()))
        : undefined;
      const category = knownWantCategory(intent.category, relabelled ?? "") as Category;
      const categories = profile.desires.get(def.id) ?? new Set<Category>();
      categories.add(category);
      profile.desires.set(def.id, categories);
    };
    const skillSources = new Map<string, Set<string>>();
    const interestTags = new Set(INTERESTS.map(i => i.tag)), skillTags = new Set(SKILLS.map(s => s.tag));
    for (const f of snap.facets) {
      if (f.scope === "agent_private" || this.declinedIds.has(f.memberId)) continue;
      if (f.validFrom !== undefined && f.validFrom > now) continue;
      if (f.validTo !== undefined && f.validTo < now) continue;
      // Skeptical: an unconfirmed inference (e.g. a skill guessed from a LinkedIn title) is not
      // evidence of what someone wants or can do until the member confirms it.
      if (f.inferred && !f.confirmedByMember) continue;
      const x = get(f.memberId);
      const shareable = f.scope === "shareable";
      for (const t of f.tags) {
        if (interestTags.has(t)) { x.interests.add(t); if (shareable) x.sharedInterests.add(t); }
        if (skillTags.has(t) && f.kind === "skill") {
          x.skills.add(t);
          if (shareable) x.sharedSkills.add(t);
          const k = `${f.memberId}|${t}`;
          if (!skillSources.has(k)) skillSources.set(k, new Set());
          skillSources.get(k)!.add(f.source ?? f.provenance);
        }
      }
    }
    // A skill is strong evidence only when corroborated: two independent sources (said in chat
    // AND seen on a connected profile), or confirmed by a good experience with it. People overclaim.
    for (const [k, srcs] of skillSources) {
      const [id, t] = k.split("|") as [MemberId, string];
      if (srcs.size >= 2 || this.vouchedSkills.get(id)?.has(t)) get(id).strongSkills.add(t);
    }
    for (const i of snap.intents) {
      if (!standingIntentLive(i, now) || this.declinedIds.has(i.memberId)) continue;
      firstIntentExpiry = Math.min(firstIntentExpiry, standingIntentDeadline(i));
      const x = get(i.memberId); x.intents++;
      const def = [...desireById.values()].find(d => d.text === i.objective);
      if (def) addDesire(x, def, i);
    }
    const stored = byMember(snap.intents);
    for (const m of this.members.values()) {
      const x = get(m.id);
      m.learned.interests.forEach(t => x.interests.add(t)); m.learned.skills.forEach(t => x.skills.add(t));
      this.vouchedSkills.get(m.id)?.forEach(t => x.strongSkills.add(t));
      for (const [d, at] of m.learned.desires) if (this.learnedLive(m.id, d, at, now, stored.get(m.id) ?? [])) {
        firstIntentExpiry = Math.min(firstIntentExpiry, standingIntentDeadline({ createdAt: at, horizonDays: learnedIntentDays }));
        const def = desireById.get(d);
        if (def) addDesire(x, def, learnedStandingIntent(m.id, def, at));
        x.intents++;
      }
    }
    this.knownCache = { profiles: map, firstIntentExpiry };
    return map;
  }

  /** Is the member in this city for all of [from, to]? Announced trips elsewhere say no. */
  inCity(id: MemberId, from: number, to: number, city: City = this.networkCity()): boolean {
    const rows = this.snapshotRows();
    return presentFor(rows.byId.get(id), rows.presence.get(id) ?? [], from, to, city);
  }
  /** Is the member in the network's city for all of [from, to]? Announced trips elsewhere say no. */
  inNyc(id: MemberId, from: number, to: number): boolean {
    return this.inCity(id, from, to, this.networkCity());
  }
  private snapCache?: { at: number; snap: WorldSnapshot };
  /** The public snapshot, rebuilt at most every 20 sim minutes or when something we learned changed. */
  private snapshotCached(): WorldSnapshot {
    const now = this.now();
    if (!this.snapCache || this.dirty || now - this.snapCache.at > 20 * 60_000 || now < this.snapCache.at) {
      this.snapCache = { at: now, snap: this.controlledIntentSnapshot(this.ctx.snapshot()) }; this.knownCache = undefined; this.dirty = false;
    }
    return this.snapCache.snap;
  }
  /** Set when members join or we learn something (invalidates the caches). */
  private dirty = true;

  /** Share of our asks this member answers (Laplace prior: 2 of 2), the best predictor of a silent reveal. */
  responsiveness(id: MemberId): number { const m = this.members.get(id); return m ? (m.answered + 2) / (m.asked + 2) : 1; }

  eligible(id: MemberId, exceptOpp?: string, asked = false, opps?: Iterable<Opp>): boolean {
    const m = this.members.get(id);
    if (m) this.syncRecord(m);
    if (!m || (m.minor && !this.teenAdmitted(id)) || m.account || m.optedOut || m.stage === "new" || !this.trust.ok(id) || m.onlyWhenAsked || this.reportHeld(id)) return false;
    if (!this.canStartMatching(m)) return false;
    // Room on the Blooio streak for an interruption (at most 1 message unanswered), or logistics for a requester.
    const c = { outboundSinceInbound: m.outbound ?? 0 };
    if (!(asked ? attention.canSendLogistics(c) : attention.canInterrupt(c))) return false;
    if (!this.inNyc(id, this.now(), this.now() + 6 * DAY)) return false;
    return !this.busy(id, exceptOpp, false, opps) && !this.overBudget(m);
  }
  private canStartMatching(member: MemberState): boolean {
    const record = this.record(member.id);
    const active = !!record && (record.accountStatus === undefined || record.accountStatus === "active");
    return newMatchParticipationAllowed((record?.state ?? member.state) === "paused", active);
  }
  private allowsMatchCategory(id: MemberId, category: Category): boolean {
    const prefs = this.record(id)?.prefs;
    return newMatchCategoryAllowed(prefs?.categoriesOptIn?.includes(category) === true, category === "romance", prefs?.romanceOptIn === true);
  }
  private canUseAlternate(opp: Opp, id: MemberId, staying: readonly MemberId[], outgoing: MemberId): boolean {
    if (!this.eligible(id) || !this.allowsMatchCategory(id, opp.category)) return false;
    const role = opp.roles?.[outgoing];
    const receiving = this.members.get(id)?.state === "receiving";
    return replacementCanTakeRole(receiving, role !== undefined && CONTRIBUTOR_ROLES.has(role as never))
      && (opp.category !== "romance" || !this.romanceGate([...staying, id]));
  }
  private moveParticipantSeat(opp: Opp, outgoing: MemberId, incoming: MemberId): void {
    opp.participants = opp.participants.map(id => id === outgoing ? incoming : id);
    if (!opp.roles?.[outgoing]) return;
    const { [outgoing]: role, ...retained } = opp.roles;
    opp.roles = { ...retained, [incoming]: role };
  }
  busy(id: MemberId, exceptOpp?: string, seats = false, opps: Iterable<Opp> = this.opps.values()) {
    for (const o of opps) {
      if (!OPEN_STAGES.has(o.stage) || o.id === exceptOpp || !activeOpportunityParticipant(o, id)) continue;
      // A hiring manager reviews every candidate for their seats at once: a seat item never makes them busy (`seats`: it does, for dropMember).
      if (!seats && o.seat?.manager === id) continue;
      // A yes to a plan still waiting for quorum does not block other items (plans ask 6).
      if (o.plan && o.stage === "probing" && o.status.get(id) === "available") continue;
      return true;
    }
    return false;
  }
  private openOpps(): Opp[] { return [...this.opps.values()].filter(o => OPEN_STAGES.has(o.stage)); }
  private oppsByMember(): Map<MemberId, Opp[]> {
    const by = new Map<MemberId, Opp[]>();
    for (const o of this.opps.values()) for (const id of new Set([...o.participants, ...o.status.keys()])) {
      const own = by.get(id);
      if (own) own.push(o); else by.set(id, [o]);
    }
    return by;
  }
  /**
   * Blocked by either member: a block made here, or a "blocked" edge in the snapshot (the platform
   * service adds one for every person-to-person block made on any app).
   */
  private blocked(a: MemberId, b: MemberId) {
    const key = pairKey(a, b);
    return this.blocks.has(key) || this.snapshotPairEdges().blocks.has(key);
  }
  private avoided(a: MemberId, b: MemberId): boolean {
    const key = pairKey(a, b);
    return this.avoid.has(key) || this.snapshotPairEdges().avoid.has(key);
  }
  private pairAllowed(a: MemberId, b: MemberId): boolean {
    return currentPairAllowed(this.blocked(a, b), this.avoided(a, b));
  }
  private snapPairEdges?: { snap: WorldSnapshot; blocks: Set<string>; avoid: Set<string> };
  private snapshotPairEdges() {
    const snap = this.snapshotCached();
    if (this.snapPairEdges?.snap !== snap) {
      const blocks = new Set<string>(), avoid = new Set<string>();
      for (const edge of snap.edges) {
        if (edge.type === "blocked") blocks.add(pairKey(edge.from, edge.to));
        else if (edge.type === "avoid") avoid.add(pairKey(edge.from, edge.to));
      }
      this.snapPairEdges = { snap, blocks, avoid };
    }
    return this.snapPairEdges;
  }

  private record(id: MemberId): MemberRecord | undefined {
    return this.snapshotRows().byId.get(id);
  }
  private snapshotRows(): SnapshotRows {
    const snap = this.snapshotCached();
    if (this.rows?.snap !== snap) {
      this.rows = { snap, byId: new Map(snap.members.map(x => [x.id, x as MemberRecord])), presence: byMember(snap.presence), facets: byMember(snap.facets) };
    }
    return this.rows;
  }
  private rows?: SnapshotRows;

  /**
   * Keep the member state in step with the member record, which staff and the member's settings can
   * change at any time: quiet hours, participation state, account status, inviter and age. A record
   * age under 18 makes the member a minor. Only a matured birthday signup can clear that cached restriction.
   * The send-time checks call this, so a change applies to the next send. Returns true when the
   * record now keeps the member out of matching (a minor, or a paused or restricted account).
   */
  private syncRecord(m: MemberState): boolean {
    const r = this.record(m.id);
    if (r) {
      const q = r.prefs?.quietHours;
      if (q && (q[0] !== m.quietHours[0] || q[1] !== m.quietHours[1])) m.quietHours = [q[0], q[1]];
      if (r.state && r.state !== m.state) {
        m.state = r.state;
        if (["open", "normal", "quiet", "receiving", "paused"].includes(r.state)) this.emit({ type: "state_changed", member: m.id, state: r.state as "open" }, `${m.id}:${r.state}:${this.now()}`);
      }
      if (r.invitedBy && r.invitedBy !== m.invitedBy) m.invitedBy = r.invitedBy;
      const acct = r.accountStatus === "paused" || r.accountStatus === "restricted" ? r.accountStatus : undefined;
      if (acct !== m.account) { if (acct) m.account = acct; else delete m.account; }
      if (validAge(r.age) && r.age !== m.age) m.age = r.age;
      const youthEvidence = !!(m.minorSignal || m.minorReported || m.ageConflict || m.ageUnknown)
        || (validAge(m.statedAge) && isMinor(m.statedAge));
      if (m.minor && mayClearMaturedSignupMinor(r.maturedSignup === true, canBeMatched(r.age), youthEvidence)) { m.minor = false; this.ledgerAge(m); }
      if (validAge(r.age) && isMinor(r.age) && !m.minor) { m.minor = true; this.ledgerAge(m); this.ctx.log("minor_record", { memberId: m.id }); this.minorAfterContact(m.id); }
      if (recordMinorSignalOpen(r, m) && !m.minorSignal) {
        const wasMinor = m.minor;
        m.minor = true; m.minorSignal = true;
        this.ctx.log("minor_signal", { memberId: m.id, person: true });
        if (!wasMinor) { this.ledgerAge(m); this.minorAfterContact(m.id); }
      }
      if (m.minor && !m.minorSignal && !m.minorReported && !m.olderReported && !m.ageConflict && !m.ageUnknown && r.ageConflict !== true
        && canBeMatched(r.age) && !recordMinorSignalOpen(r, m) && canBeMatched(this.ageOf(m))) {
        m.minor = false; this.ledgerAge(m);
        this.ctx.log("minor_aged_up", { memberId: m.id });
      }
    }
    return m.minor || !!m.account;
  }

  private beginUnit() { this.dirty = true; }

  /** At the start of a unit: read the record again, and take a member the record now keeps out of matching out of every open opportunity. */
  private syncMember(m: MemberState) {
    if (!this.syncRecord(m)) return;
    m.pendingInviteDraft = undefined;
    if (m.minor) this.closeFailedTeenItems(m.id);
    const knows = this.minorKnows(m.id);
    const recurring = () => this.crews.some(c => this.knowsCrew(m.id, c)) || this.crewOffers.some(c => !c.resolved && this.knowsCrew(m.id, c.crew, this.opps.get(c.planId)));
    const unmarked = () => [...this.opps.values()].some(o => knows(o) && !o.minorKnew && o.teenRuleAt === undefined);
    const holds = (o: Opp) => (o.participants.includes(m.id) || o.alternates.includes(m.id) || knows(o)) && !(this.teenAdmitted(m.id) && this.teenItemOk(o));
    if (m.minor ? this.openOpps().some(holds) || recurring() || unmarked() : this.busy(m.id, undefined, true)) {
      this.dropMember(m.id, m.minor ? "minors policy" : `account ${m.account}`);
    }
  }

  member(id: MemberId): MemberState {
    let m = this.members.get(id);
    if (!m) {
      let snap = this.snapshotCached();
      if (!snap.members.some(x => x.id === id)) { this.dirty = true; snap = this.snapshotCached(); }
      const mem = snap.members.find(x => x.id === id);
      const name = mem?.name ?? id;
      const [first, last] = name.split(" ");
      this.fullNames.set(id, name);
      const home = snap.presence.find(p => p.memberId === id && p.type === "home")?.areas[0];
      const city = this.networkCity();
      const homeKnown = !!home && (NEIGHBORHOOD.has(home) || !!findCityNeighborhood(home, city));
      m = {
        id, first: first ?? name, display: last ? `${first} ${last[0]}.` : name, area: homeKnown ? home : undefined,
        quietHours: mem?.prefs.quietHours ?? [21, 9], state: mem?.state ?? "normal",
        // Fail closed: no valid adult age means treated as a minor (core policy).
        age: mem?.age, minor: isMinor(mem?.age), minorSignal: false, stage: "new",
        optedOut: false, pendingAsks: [], unanswered: 0, onlyWhenAsked: false, reengaged: false,
        proactive: [], outbound: 0, lastInbound: 0, lastAskAt: 0, joinedAt: this.now(), invitedBy: mem?.invitedBy,
        invites: [], invitesBlockedUntil: 0, lastGrowthAsk: 0,
        learned: { interests: new Set(), skills: new Set(), desires: new Map(), redLines: new Set() }, noShows: 0, completedSinceNoShow: 0, msgsIn: 0, asked: 0, answered: 0,
        suggested: new Map(),
      };
      this.members.set(id, m);
    }
    return m;
  }
  memberList() { return [...this.members.values()]; }

  // ================================================================== peon job seats (#9, jobs.ts)
  /**
   * An engine proposal for a job seat, as the hiring manager's item: the seat id becomes the manager
   * (who answers for it), and the item remembers the seat so the engine's views keep seeing it
   * (seatView). Undefined: the seat has no manager on the record (it is never proposed). Proposals
   * without a seat pass through unchanged.
   */
  private seatRoute(p: EngineProposal): SeatProposal | undefined {
    const seat = p.participants.find(isSeatId);
    if (!seat) return p;
    const rec = this.record(seat);
    const manager = rec ? seatOwnerOf(rec) : undefined;
    if (!manager || p.participants.includes(manager) || p.participants.filter(isSeatId).length !== 1) return undefined;
    const candidate = p.participants.find(id => id !== seat);
    const bound = candidate && p.participants.length === 2 ? this.hireSeatFor({ id: seat, manager }, candidate) : undefined;
    if (!bound) return undefined;
    const swap = (id: MemberId) => (id === seat ? manager : id);
    const keys = <T>(o: Record<MemberId, T> | undefined): Record<MemberId, T> => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [swap(k), v]));
    return {
      ...p, participants: p.participants.map(swap), alternates: (p.alternates ?? []).filter(a => !isSeatId(a) && a !== manager),
      explanations: keys(p.explanations), roles: keys(p.roles), ...(p.anchor ? { anchor: { ...p.anchor, id: swap(p.anchor.id) } } : {}), seat: bound,
    };
  }

  private hireSeatFor(seat: HireSeat, candidate: MemberId): HireSeat | undefined {
    const evidence = readHireEvidence(this.snapshotCached(), seat, candidate, this.now(), true);
    const bound = { ...seat, evidence: { search: evidence.search, posting: evidence.posting } };
    if (seat.evidence && seat.evidence.posting !== evidence.posting) return;
    return hireSeatCurrent(bound, evidence) ? bound : undefined;
  }

  private currentHireSeat(seat: HireSeat, members: readonly MemberId[]): boolean {
    const job = this.record(seat.id), candidate = members.find(id => id !== seat.manager);
    return members.length === 2 && members.includes(seat.manager) && !!job && seatOwnerOf(job) === seat.manager && !!candidate
      && hireSeatCurrent(seat, readHireEvidence(this.snapshotCached(), seat, candidate, this.now(), true));
  }

  private hireContactCurrent(o: Opp, to: MemberId, reveal: boolean): boolean {
    const seat = o.seat!;
    const candidate = o.participants.find(id => id !== seat.manager);
    const accepted = (id: MemberId) => o.status.get(id) === (o.stage === "scheduled" ? "yes" : "available") && o.contacted.has(id);
    return !!candidate && hireContactAllowed(this.currentHireSeat(seat, o.participants), reviewApproved(o.review),
      o.stage === "probing" || (reveal && o.stage === "scheduled"), to === seat.manager, reveal, accepted(candidate), accepted(seat.manager));
  }

  private probeAlreadyAsked(o: Opp, member: MemberId): boolean {
    return o.contacted.has(member) && !(o.seat?.manager === member && o.managerProbeSuspended);
  }

  private probeToSend(o: Opp, member: MemberId, probe: ParticipantProbe): ParticipantProbe {
    return o.seat?.manager === member && o.managerProbeSuspended ? { ...probe, told: false } : probe;
  }

  private managerProbeDeadline(o: Opp, member: MemberId): number {
    const sentAt = o.sentAt?.[member];
    return managerQuestionDeadline(o.deadline, sentAt !== undefined, sentAt ?? 0, this.probeWindow(false));
  }

  /** A suspended manager question keeps its place. Other questions are ordered by when the applicant said yes. */
  private managerProbeMayOpen(o: Opp, m: MemberState, now: number): boolean {
    if (probeExpired(now, this.managerProbeDeadline(o, m.id))) return false;
    const opened = o.turnAt?.[m.id] ?? o.createdAt;
    const older = [...this.opps.values()].some(waiting => {
      if (waiting === o || waiting.seat?.manager !== m.id || waiting.stage !== "probing"
        || waiting.status.get(m.id) !== "probing" || this.probeAlreadyAsked(waiting, m.id)
        || probeExpired(now, this.managerProbeDeadline(waiting, m.id))) return false;
      if (!!waiting.managerProbeSuspended !== !!o.managerProbeSuspended) return waiting.managerProbeSuspended === true;
      const awaitingSince = waiting.turnAt?.[m.id] ?? waiting.createdAt;
      return awaitingSince < opened || (awaitingSince === opened && waiting.id < o.id);
    });
    return managerQuestionMayOpen(m.awaiting?.kind === "posting", m.awaiting?.kind === "probe" && m.awaiting.oppId !== o.id, older);
  }

  /** The job title of a seat (its posting's "Hire: <title>"), for the seat copy. */
  private seatTitle(seat: MemberId): string {
    return (this.snapshotCached().intents.find(i => i.memberId === seat)?.objective ?? "").replace(/^Hire:\s*/i, "") || "the role";
  }

  /** Eligibility inside one proposal: the hiring manager of a seat item is checked as a manager (managerProblem), everyone else as usual. */
  private eligibleIn(p: { seat?: Opp["seat"] }, id: MemberId, exceptOpp?: string): boolean {
    return p.seat?.manager === id ? !this.managerProblem(id) : this.eligible(id, exceptOpp);
  }

  /**
   * Why this member may not own a job posting or answer for a seat now (undefined: they may). A peon
   * member who is a confirmed adult (record age 18+, no minor signal, report or conflict), active (not
   * paused, restricted, opted out, held or banned) and opted in to work matching.
   */
  managerProblem(id: MemberId): "adults_only" | "not_ready" | "opt_in" | undefined {
    if (this.declinedIds.has(id)) return "not_ready";
    const r = this.record(id);
    if (!r || isSeatId(id)) return "not_ready";
    const m = this.member(id);
    this.syncRecord(m);
    if (!canBeMatched(r.age) || m.minor || m.minorSignal || m.ageConflict || m.minorReported) return "adults_only";
    if (m.optedOut || m.account || ["paused", "restricted", "removed", "invited"].includes(r.accountStatus ?? "") || !this.trust.ok(id) || this.reportHeld(id)) return "not_ready";
    if (!(r.prefs?.categoriesOptIn ?? []).includes("professional")) return "opt_in";
    return undefined;
  }

  /**
   * The engine's view of seat items: the hiring manager is the seat again in recent proposals,
   * interactions and open items, so the pack counts each seat's openings (engine seatFills) and its
   * pair rules see the seat. A seat item both sides said yes to holds its opening ("accepted") until
   * it closes or its check-in is answered.
   */
  private seatView(input: EngineInput): EngineInput {
    const seats = new Map<string, NonNullable<Opp["seat"]>>();
    for (const o of this.opps.values()) if (o.seat) seats.set(o.id, o.seat);
    if (!seats.size) return input;
    const view = (oppId: string, ids: readonly MemberId[] | undefined) => {
      const s = seats.get(oppId.split(":fb:")[0]!.replace(/:seat$/, ""));
      return (ids ?? []).map(id => (s && id === s.manager ? s.id : id));
    };
    const interactions = (input.interactions ?? []).map(x => ({
      ...x, participants: view(x.id, x.participants),
      ...(x.declinedBy ? { declinedBy: view(x.id, x.declinedBy) } : {}), ...(x.acceptedBy ? { acceptedBy: view(x.id, x.acceptedBy) } : {}),
      ...(x.contributors ? { contributors: view(x.id, x.contributors) } : {}), ...(x.noResponse ? { noResponse: view(x.id, x.noResponse) } : {}),
    }));
    for (const o of this.opps.values()) {
      if (!o.seat) continue;
      if (o.stage === "probing" && o.participants.some(p => saidYes(o.status.get(p)))) {
        interactions.push({ id: `${o.id}:seat`, kind: o.kind, category: o.category, participants: view(o.id, o.participants), at: o.createdAt, outcome: "pending", acceptedBy: view(o.id, o.participants.filter(p => saidYes(o.status.get(p)))) });
        continue;
      }
      const hasMeeting = o.meetingAt !== undefined, closed = o.stage === "closed";
      const prefix = `${o.id}:fb:`;
      const participants = view(o.id, o.participants);
      const feedback = bookedOccupies(hasMeeting, closed) ? interactions.filter(record => record.id.startsWith(prefix)) : [];
      const acceptanceRow = feedback.find(record => {
        const author = record.id.slice(prefix.length);
        const matchingRoster = participants.length === 2 && record.participants.length === 2
          && participants.every(id => record.participants.includes(id))
          && o.participants.every(id => o.status.get(id) === "yes");
        const ownFeedback = o.feedbackFrom.has(author) && o.participants.includes(author)
          && (record.outcome === "completed" || record.outcome === "no_show");
        return peonFeedbackRetainsAcceptance(o.stage === "done", matchingRoster, ownFeedback);
      });
      if (!acceptanceRow && !bookedNeedsSyntheticAcceptance(hasMeeting, closed, feedback.length > 0)) continue;

      const receipts = o.seatAcceptedAt === undefined
        ? o.participants.map(id => this.bookingNoticeReceiptAt(o, id, 0)).filter((at): at is number => at !== undefined && at >= 0 && at <= input.now)
        : [];
      const acceptedAt = peonAcceptedHistoryAt(o.seatAcceptedAt ?? -1, receipts.length ? Math.min(...receipts) : -1, o.meetingAt!);
      if (acceptanceRow) acceptanceRow.hireAcceptedAt = acceptedAt;
      else interactions.push({ id: `${o.id}:seat`, kind: o.kind, category: o.category, participants,
        at: acceptedAt, outcome: "accepted", acceptedBy: participants });
    }
    return {
      ...input, interactions,
      recentProposals: (input.recentProposals ?? []).map(p => ({ ...p, participants: view(p.id, p.participants), alternates: view(p.id, p.alternates) })),
      ...(input.openOpportunities ? { openOpportunities: input.openOpportunities.map(o => ({ ...o, participants: view(o.id, o.participants) })) } : {}),
    };
  }

  /**
   * At every tick: a seat item still in review or in probes ends when its posting closed (or is gone)
   * or its openings are all taken by intros both sides said yes to (a filled posting).
   */
  private checkSeats() {
    const open = this.openOpps().filter(o => o.seat && o.stage !== "scheduled");
    if (!open.length) return;
    const snap = this.snapshotCached();
    const interactions = this.seatView({ ...snap, interactions: this.interactions }).interactions;
    const filled = seatFills({ interactions: interactions?.filter(record => bookedRecordOccupies(record.outcome)) });
    for (const seatId of new Set(open.map(o => o.seat!.id))) {
      const active = snap.intents.some(i => i.memberId === seatId && i.status === "active");
      const posted = active ? Number(snap.facets.find(f => f.id === `${seatId}:openings`)?.tags.find(t => t.startsWith("peon:openings:"))?.slice("peon:openings:".length) ?? 0) : 0;
      if (closeUnbookedItems(!active, posted, filled.get(seatId)?.size ?? 0)) {
        this.endSeat(seatId, active ? "posting filled" : "posting closed");
      }
    }
  }

  /**
   * End a seat's items that are not booked yet (review or probes). A candidate who already said yes
   * hears that the job is no longer open; nobody learns who else was in it. Booked intros stay.
   */
  private endSeat(seatId: MemberId, reason: "posting closed" | "posting filled") {
    for (const o of this.openOpps()) {
      if (o.seat?.id !== seatId || o.stage === "scheduled") continue;
      for (const id of o.participants) {
        if (id === o.seat.manager || o.status.get(id) !== "available") continue;
        const m = this.members.get(id);
        if (m) this.send(m, SEAT_COPY.postingClosed, { type: "info", proposalId: o.id }, "cancellation");
      }
      this.ctx.log("seat_ended", { oppId: o.id, seat: seatId, reason });
      this.close(o, reason);
    }
  }

  /** A posting of this manager as it stands in the snapshot (an update keeps what it does not change). */
  private storedPosting(managerId: MemberId, postingId: string): JobPosting | undefined {
    const snap = this.snapshotCached();
    const seat = seatIdOf(postingId);
    const rec = snap.members.find(x => x.id === seat);
    if (!rec || seatOwnerOf(rec) !== managerId) return undefined;
    const intent = snap.intents.find(i => i.memberId === seat && i.id === postingId);
    if (!intent) return undefined;
    const ref = postingsOf(snap, managerId).find(p => p.id === postingId);
    const p = postingFromFacts(intent, snap.facets.filter(f => f.memberId === seat));
    return { ...p, managerId, openings: ref && ref.openings > 0 ? ref.openings : p.openings };
  }

  /**
   * Save a job posting (the manager's confirmed text, or staff through the API, service/postings.ts).
   * An active posting needs a manager who may own one (managerProblem); closing always works. The
   * rows are written by the service (onPosting); a closed posting ends its open seat items at once.
   */
  applyPosting(p: JobPosting, actor: string): ActionResult {
    const bad = postingProblem(p);
    if (bad) return { ok: false, reason: bad };
    const rec = this.snapshotCached().members.find(x => x.id === seatIdOf(p.id));
    if (rec && seatOwnerOf(rec) !== p.managerId) return { ok: false, reason: "not_owner" };
    if (p.status === "active") { const why = this.managerProblem(p.managerId); if (why) return { ok: false, reason: why }; }
    else if (!this.record(p.managerId)) return { ok: false, reason: "unknown_member" };
    this.opts.onPosting?.(p);
    this.ctx.log("posting_saved", { postingId: p.id, managerId: p.managerId, status: p.status, openings: p.openings, actor, kept: !!this.opts.onPosting });
    if (p.status !== "active") this.endSeat(seatIdOf(p.id), p.closedReason === "filled" ? "posting filled" : "posting closed");
    this.dirty = true;
    return { ok: true };
  }

  /**
   * The yes or no this member still owes, other than on `except`: a probe that went out and was not
   * answered (first), or a booked plan they were told about and did not confirm.
   */
  private owedAnswer(m: MemberState, except?: string): MemberState["awaiting"] {
    const open = this.openOpps().filter(o => o.id !== except);
    for (const o of open) {
      const sent = o.sentAt?.[m.id];
      if (o.stage === "probing" && sent !== undefined && !(o.seat?.manager === m.id && o.managerProbeSuspended)
        && (o.plan ? o.planRun?.answers[m.id] === "pending" : o.status.get(m.id) === "probing")) return { kind: "probe", oppId: o.id, at: sent,
          probeReceiptId: m.pendingAsks.find(a => a.kind === "probe" && a.opportunityId === o.id)?.deliveryId };
    }
    const o = open.find(o => o.stage === "scheduled" && o.status.get(m.id) === "yes" && o.bookedTold?.includes(m.id) && !(o.confirmed ?? []).includes(m.id));
    return o ? { kind: "booked", oppId: o.id, at: o.bookedAt?.[m.id] ?? o.createdAt } : undefined;
  }

  /**
   * A job post by text in a handled turn. A posting command starts a draft (or a close); while a draft
   * waits, a yes saves it, a no drops it, and other details correct it. Every step answers with one
   * message (a question or the read-back). False: the text is not about a posting.
   */
  private postingTurn(m: MemberState, body: string): boolean {
    const waiting = m.awaiting?.kind === "posting" && m.posting ? m.posting : undefined;
    const reply = (text: string) => { this.send(m, text, { type: "info" }, "reply"); return true; };
    // The read-back used the slot: a probe or booked plan that still waits for this member's answer gets it back.
    const clear = () => { m.posting = undefined; if (m.awaiting?.kind === "posting") m.awaiting = this.owedAnswer(m); };
    if (waiting && !isPostingCommand(body)) {
      const yn = this.yesNoOf(body);
      const open = postingsOf(this.snapshotCached(), m.id).filter(p => p.active);
      const ready = !!waiting.ready, affirmative = yn === "yes" && !postingReplyQualified(body, waiting, open);
      const edited = postingDetailsChanged(body, waiting, open);
      const prev = waiting.id ? this.storedPosting(m.id, waiting.id) : undefined;
      // spec/postingPolicy.md, "A stale yes never reopens or overwrites a posting that staff changed or closed"
      const current = postingDraftCurrent(waiting.revision !== undefined, prev !== undefined, prev?.status === "active",
        prev !== undefined && postingRevision(prev) === waiting.revision, !!waiting.close);
      // spec/postingPolicy.md, "Confirm only the posting shown in the read-back"
      if (confirmPosting(ready, affirmative, edited, current)) {
        clear();
        const posting = postingFromDraft(waiting, m.id, this.now(), prev);
        if (!posting) return reply(POSTING_COPY.dropped);
        const r = this.applyPosting(posting, m.id);
        if (!r.ok) return reply(r.reason === "adults_only" ? POSTING_COPY.adultsOnly : r.reason === "opt_in" ? POSTING_COPY.optIn : POSTING_COPY.notReady);
        return reply(posting.status !== "active" ? POSTING_COPY.closed(posting.title) : prev ? POSTING_COPY.updated(posting.title) : POSTING_COPY.saved(posting.title));
      }
      // A yes to a read-back that is no longer current saves nothing.
      if (confirmPosting(ready, affirmative, edited, true)) { clear(); return reply(POSTING_COPY.dropped); }
      if (yn === "no" && !edited) { clear(); return reply(POSTING_COPY.dropped); }
    }
    const step = readPostingText(body, { ...(waiting ? { draft: waiting } : {}), postings: postingsOf(this.snapshotCached(), m.id), storedPosting: id => this.storedPosting(m.id, id), newId: `${m.id.replace(/[^A-Za-z0-9_.-]/g, "")}-job-${this.now().toString(36)}` });
    if (!step) { if (waiting) clear(); return false; }
    const why = this.managerProblem(m.id);
    if (why && !step.draft?.close) { clear(); return reply(why === "adults_only" ? POSTING_COPY.adultsOnly : why === "opt_in" ? POSTING_COPY.optIn : POSTING_COPY.notReady); }
    if (!step.draft) { clear(); return reply(step.text); }
    const asks = (step.draft.asks ?? 0) + (step.ready ? 0 : 1);
    // Two questions without the missing field: the draft is dropped (one question at a time, never a loop).
    if (asks > 2) { clear(); return reply(POSTING_COPY.dropped); }
    if (m.awaiting?.kind === "probe") {
      const interrupted = this.opps.get(m.awaiting.oppId ?? "");
      if (interrupted?.seat?.manager === m.id && interrupted.stage === "probing"
        && interrupted.status.get(m.id) === "probing" && interrupted.sentAt?.[m.id] !== undefined
        && !probeExpired(this.now(), this.managerProbeDeadline(interrupted, m.id))) interrupted.managerProbeSuspended = true;
    }
    m.posting = { ...step.draft, asks, ready: step.ready };
    m.awaiting = { kind: "posting", at: this.now() };
    this.ctx.log("posting_read_back", { memberId: m.id, ready: step.ready, close: !!step.draft.close });
    return reply(step.text);
  }

  // ================================================================== state (store.ts)
  exportState(): NetworkState {
    const askIndex = new Map(this.asks.map((a, i) => [a, i]));
    const state: NetworkState = {
      version: NETWORK_STATE_VERSION, savedAt: this.ctx ? this.now() : this.lastTick, matchingEnabled: this.opts.matchingEnabled,
      members: [...this.members.values()].map(m => {
        const { learned, suggested, awaiting, ...rest } = m;
        const aw = awaiting && (() => { const { ask, ...a } = awaiting; return { ...a, ...(ask ? (askIndex.has(ask) ? { askIndex: askIndex.get(ask) } : { ask }) : {}) }; })();
        const { redLines, ...learnedRest } = learned;
        return {
          ...rest, name: this.fullNames.get(m.id) ?? m.display, suggested: [...suggested], awaiting: aw,
          learned: { ...learnedRest, interests: [...learned.interests], skills: [...learned.skills], desires: [...learned.desires], ...(redLines?.size ? { redLines: [...redLines] } : {}) },
        };
      }),
      opps: [...this.opps.values()].map(o => ({
        ...o, primed: [...o.primed], status: [...o.status], contacted: [...o.contacted], reminded: [...o.reminded], feedbackFrom: [...o.feedbackFrom], fixedVenue: o.fixedVenue?.id,
      })),
      requests: this.requests, queued: this.queued, deferred: this.deferred,
      declinedIds: [...this.declinedIds], blocks: [...this.blocks], avoid: [...this.avoid], declined: [...this.declined],
      feedback: this.feedback, interactions: this.interactions, asks: this.asks,
      vouchedSkills: [...this.vouchedSkills].map(([k, v]) => [k, [...v]]), invitedIds: [...this.invitedIds],
      trust: this.trust.exportState(), cases: this.cases, caseSeq: this.caseSeq, reports: this.reports, reportSeq: this.reportSeq,
      counters: this.counters, gateReasons: this.gateReasons,
      lastRunDay: this.lastRunDay, lastTick: this.lastTick, tickGap: this.tickGap, seq: this.seq, oppSeq: this.oppSeq, reqSeq: this.reqSeq,
      standingIntentSearch: this.standingIntentSearch,
      plans: {
        crews: this.crews, crewOffers: this.crewOffers, carry: this.planCarry, lastPlannedAt: [...this.lastPlannedAt], lastRunDay: this.lastPlanRunDay,
        again: [...this.planAgain], counters: this.plansCounters,
      },
      fraud: this.fraud, fraudSeq: this.fraudSeq, exposureDebt: this.exposureDebt,
      ...(this.memberStanding.length ? { memberStanding: this.memberStanding } : {}),
      relay: this.relayDesk.exportState(false),
      venues: this.venues.exportState(),
      meetups: this.meetups.exportState(false),
      ...(this.teenStop ? { teenStop: this.teenStop } : {}),
      ...(this.flagged.size ? { flagged: [...this.flagged] } : {}),
    };
    // A deep copy that is exactly what a JSON store keeps.
    return JSON.parse(JSON.stringify(state)) as NetworkState;
  }

  /**
   * Replace this Network's state with a stored one (exportState). runTick() and runStored() call it
   * under the store lock before every unit of work, so another process's saves are never lost.
   */
  importState(input: NetworkState) {
    if (input?.version !== NETWORK_STATE_VERSION) throw new Error(`network state version ${input?.version} is not ${NETWORK_STATE_VERSION}`);
    const st = JSON.parse(JSON.stringify(input)) as NetworkState;
    this.opts.matchingEnabled = st.matchingEnabled;
    this.asks = st.asks;
    this.members.clear(); this.fullNames.clear();
    for (const x of st.members) {
      const { name, learned, suggested, awaiting, ...rest } = x;
      const aw = awaiting && (() => { const { askIndex, ask, ...a } = awaiting; return { ...a, ask: askIndex !== undefined ? this.asks[askIndex] : ask }; })();
      if (aw && !aw.ask) delete aw.ask;
      this.members.set(x.id, {
        ...rest, suggested: new Map(suggested), awaiting: aw,
        learned: { ...learned, interests: new Set(learned.interests), skills: new Set(learned.skills), desires: new Map(learned.desires), redLines: new Set(learned.redLines ?? []) },
      });
      this.fullNames.set(x.id, name);
    }
    this.opps.clear();
    const cityVenues = venuesForCity(this.networkCity());
    for (const x of st.opps) {
      const venue = x.fixedVenue ? (cityVenues.find(v => v.id === x.fixedVenue) ?? VENUES.find(v => v.id === x.fixedVenue)) : undefined;
      if (x.review && x.review.approver === undefined && x.review.decision === "approve") {
        if (x.review.reviewer === LEGACY_SIM_REVIEWER) Object.assign(x.review, { approver: "judge", reviewer: SIM_REVIEW_JUDGE });
        else if (x.review.reviewer?.trim()) x.review.approver = "staff";
      }
      this.opps.set(x.id, {
        ...x, primed: new Set(x.primed), status: new Map(x.status), contacted: new Set(x.contacted), reminded: new Set(x.reminded), feedbackFrom: new Set(x.feedbackFrom), fixedVenue: venue,
        probeDelivery: x.probeDelivery ?? Object.fromEntries(x.participants.filter(p => x.sentAt?.[p] !== undefined && x.contacted.includes(p)).map(p => [p, ""])),
      });
    }
    this.requests.length = 0; this.requests.push(...st.requests);
    this.queued = st.queued; this.deferred = st.deferred;
    this.declinedIds = new Set(st.declinedIds); this.blocks = new Set(st.blocks); this.avoid = new Set(st.avoid); this.declined = new Map(st.declined);
    this.feedback = st.feedback;
    this.interactions = st.interactions.map(record => this.restoreFeedbackInteraction(record));
    this.captureSlopIntroductions(this.opps.values());
    this.vouchedSkills = new Map(st.vouchedSkills.map(([k, v]) => [k, new Set(v)]));
    this.invitedIds.clear(); for (const id of st.invitedIds) this.invitedIds.add(id);
    this.trust.importState(st.trust);
    this.cases = st.cases; this.caseSeq = st.caseSeq;
    this.reports = st.reports ?? []; this.reportSeq = st.reportSeq ?? 0;
    for (const k of Object.keys(this.counters) as (keyof typeof this.counters)[]) this.counters[k] = st.counters[k] ?? 0;
    for (const k of Object.keys(this.gateReasons)) delete this.gateReasons[k];
    Object.assign(this.gateReasons, st.gateReasons);
    this.lastRunDay = st.lastRunDay; this.lastTick = st.lastTick; this.tickGap = st.tickGap;
    this.standingIntentSearch = st.standingIntentSearch;
    this.seq = st.seq; this.oppSeq = st.oppSeq; this.reqSeq = st.reqSeq;
    // Plans and fraud review (added later; a state saved before them has none).
    this.crews.length = 0; this.crews.push(...(st.plans?.crews ?? []));
    this.crewOffers = st.plans?.crewOffers ?? []; this.planCarry = st.plans?.carry ?? [];
    this.lastPlannedAt = new Map(st.plans?.lastPlannedAt ?? []); this.lastPlanRunDay = st.plans?.lastRunDay ?? "";
    this.planAgain = new Map(st.plans?.again ?? []);
    for (const k of Object.keys(this.plansCounters) as (keyof typeof this.plansCounters)[]) this.plansCounters[k] = st.plans?.counters?.[k] ?? 0;
    this.fraud = st.fraud ?? []; this.fraudSeq = st.fraudSeq ?? 0;
    this.exposureDebt = { ...(st.exposureDebt ?? {}) };
    this.memberStanding = Array.isArray(st.memberStanding) ? st.memberStanding : [];
    this.relayDesk.importState(st.relay, false);
    this.venues.importState(st.venues);
    this.meetups.importState(st.meetups, false);
    this.flagged = new Map((st.flagged ?? []).filter(([key, flag]) => typeof key === "string" && typeof flag?.at === "number" && typeof flag.reason === "string"));
    this.teenStop = parseTeenStop(st);
    this.planWorldCache = undefined;
    this.replyTo = undefined; this.memberReply = false; this.turnSource = undefined; this.turnCause = undefined; this.currentRunId = undefined;
    this.snapCache = undefined; this.knownCache = undefined; this.dirty = true;
  }

  /** True for someone declined at join (under the app's join age). Only the id is kept. */
  isDeclined(id: MemberId) { return this.declinedIds.has(id); }

  private relayMinorSignal(id: MemberId, saysYounger: boolean): void {
    const m = this.members.get(id);
    if (!m || this.declinedIds.has(id) || m.minorSignal) return;
    this.dirty = true;
    this.caseEvent(m.id, { at: this.now(), kind: "relay_age_signal", points: 0 });
    const onRecord = this.youngestAgeOnRecord(m);
    if (m.minor && this.teenSubject(id) && !minorSignalOpens(validAge(onRecord) && isMinor(onRecord), saysYounger)) return;
    this.applyMinorSignal(m, true, false);
  }

  private meetupHost(): MeetupCoordHost {
    const self = this;
    return {
      get venues() { return self.venues; },
      get ratesPhotos() { return self.ratesPhotos; },
      party: (meetupId, id) => {
        const m = this.members.get(id);
        if (!m || this.declinedIds.has(id)) return undefined;
        this.syncRecord(m);
        const opp = this.opps.get(meetupId);
        const view = relayMemberOf(m, this.trust.level(id) === "hold" || this.reportHeld(id), earliestDayKeyOf(this.now()));
        const full = this.fullNames.get(id) ?? m.display;
        const parts = full.trim().split(/\s+/);
        const lastName = parts.length > 1 ? parts[parts.length - 1] : undefined;
        return {
          id: m.id,
          firstName: m.first,
          ...(lastName ? { lastName } : {}),
          age: view.age,
          optedOut: view.optedOut,
          confirmed: opp ? opp.status.get(id) === "yes" : true,
        };
      },
      blocked: (a, b) => this.blocked(a, b),
      panicTriggered: (meetupId, senderId, recipientId) =>
        this.relayDesk.isPanicTriggered(senderId, meetupId) || this.relayDesk.isPanicTriggered(recipientId, meetupId),
      privateFacts: () => {
        const priv = this.snapshotCached().facets.filter(f => f.scope === "agent_private");
        return {
          forbidden: priv.map(f => ({ text: f.value, owner: f.memberId })),
          canaries: priv.flatMap(f => [...f.value.matchAll(CANARY_RE)].map(x => x[1]!)),
        };
      },
      send: (to, body, opts) => {
        const m = this.members.get(to);
        if (!m) return;
        const opp = this.opps.get(opts.meetupId);
        const about = opp?.participants.filter(p => p !== to) ?? [];
        const sendKind: SendKind = opts.kind === "arrival_relay" ? "relay"
          : opts.kind === "arrival_ack" ? "reply"
          : opts.kind === "pre_brief" || opts.kind === "no_show_ping" ? "reminder" : "info";
        const msgType = opts.kind === "arrival_relay" ? "relay"
          : opts.kind === "pre_brief" || opts.kind === "no_show_ping" ? "reminder" : "info";
        const publicVenueAddress = opts.kind === "pre_brief" || opts.kind === "backup_pivot"
          ? this.publicMeetupVenueAddress(opts.meetupId, body)
          : undefined;
        const sent = this.send(m, body, { type: msgType, proposalId: opts.meetupId }, sendKind, {
          about,
          noDefer: opts.kind === "pre_brief" || opts.kind === "no_show_ping",
          ...(publicVenueAddress ? { publicVenueAddress } : {}),
        });
        if (sent === "sent" && opts.kind === "pre_brief" && opp) {
          opp.reminded.add(to);
          if (!m.awaiting && opp.stage === "scheduled") this.expect(m, { kind: "booked", oppId: opp.id, at: this.now() });
        }
      },
    };
  }

  private relayHost(): RelayHost {
    const self = this;
    return {
      get app() { return self.app.id; },
      get ratesPhotos() { return self.ratesPhotos; },
      now: () => this.now(),
      classifierFailed: (itemId, error) => this.ctx.log("relay_classifier_failed", { itemId, error }),
      member: id => {
        const m = this.members.get(id);
        if (!m || this.declinedIds.has(id)) return undefined;
        this.syncRecord(m);
        return relayMemberOf(m, this.trust.level(id) === "hold" || this.reportHeld(id), earliestDayKeyOf(this.now()));
      },
      observeSenderAge: (id, text) => {
        const m = this.members.get(id);
        if (!m || this.declinedIds.has(id)) return false;
        const { age, explicit } = agesStated(text, { directOnly: true });
        if (!validAge(age) || canBeMatched(age)) return false;
        const onRecord = this.youngestAgeOnRecord(m);
        this.rememberStatedAge(m, age, age === explicit, this.attestedAge(m));
        this.relayMinorSignal(id, onRecord !== undefined && age < onRecord);
        return true;
      },
      matchesOf: id => {
        const now = this.now(), out: RelayMatch[] = [];
        for (const o of this.opps.values()) {
          if (o.participants.length !== 2 || !o.participants.includes(id)) continue;
          out.push(relayMatchOf(o, p => o.status.get(p), now, this.avoid.has(pairKey(o.participants[0]!, o.participants[1]!))));
        }
        return out;
      },
      blocked: (a, b) => this.blocked(a, b),
      privateFacts: () => {
        const priv = this.snapshotCached().facets.filter(f => f.scope === "agent_private");
        return { forbidden: priv.map(f => ({ text: f.value, owner: f.memberId })), canaries: priv.flatMap(f => [...f.value.matchAll(CANARY_RE)].map(x => x[1]!)) };
      },
      send: (to, body, o) => {
        const m = this.members.get(to);
        if (!m) return "refused";
        this.dirty = true;
        const r = this.send(m, body, { type: "relay", proposalId: o.matchId }, "relay", { about: [o.from], key: o.key, relayFrom: o.from, ...(o.contact ? { relayContact: o.contact } : {}), ...(o.noDefer ? { noDefer: true } : {}) });
        return r === "sent" ? "sent" : r === "deferred" ? "deferred" : "refused";
      },
      saysYounger: (id, text) => {
        const m = this.members.get(id);
        if (!m || this.declinedIds.has(id) || !m.minor || !this.teenSubject(id)) return false;
        const stated = statedAge(text), onRecord = this.youngestAgeOnRecord(m);
        return stated !== undefined && onRecord !== undefined && stated < onRecord;
      },
      minorSignal: (id, saysYounger) => this.relayMinorSignal(id, saysYounger),
      teenPair: matchId => {
        const o = this.opps.get(matchId);
        return !!o && o.participants.length === 2 && this.teenRoster(o) && this.teenItemOk(o);
      },
      onPanicExit: (id, matchIds) => this.handleRelayPanicExit(id, matchIds),
      severeBlock: id => {
        if (!this.members.has(id) || this.declinedIds.has(id)) return;
        this.dirty = true;
        this.caseEvent(id, { at: this.now(), kind: "relay_block", points: 0 });
        this.ctx.log("relay_block", { memberId: id });
      },
    };
  }
  relayRequest(ask: RelayAsk, o: RelayCallOptions): Promise<RelayOutcome> { return this.relayDesk.request(ask, o); }
  relayCancelSwap(memberId: MemberId): number { const n = this.relayDesk.cancelSwaps(memberId); if (n) this.dirty = true; return n; }
  relayMatch(memberId: MemberId, matchId?: string, targetName?: string): RelayMatch | undefined { return this.relayDesk.matchFor(memberId, matchId, targetName).match; }
  relayLiveMatches(memberId: MemberId): { match: RelayMatch; otherFirstName: string; meeting: boolean }[] {
    return this.relayDesk.liveMatches(memberId).map(match => {
      const other = this.relayHost().member(match.participants.find(p => p !== memberId)!);
      return { match, otherFirstName: (other?.firstName ?? "").trim().split(/\s+/)[0] ?? "", meeting: this.opps.get(match.id)?.meetingAt !== undefined };
    });
  }
  photoReviewExpired(itemId: string): void {
    this.dirty = true;
    this.counters.photoReviewExpired++;
    this.ctx.log("photo_review_expired", { photoRelayItemId: itemId });
  }
  photoNotice(memberId: MemberId, key: string, text: string, kind: "relay" | "info", threadId?: string, link?: string): boolean {
    if (!this.record(memberId) || this.declinedIds.has(memberId)) return false;
    const thread = threadId === undefined ? undefined : this.opps.get(threadId);
    if (threadId !== undefined && (!thread || !thread.participants.includes(memberId))) return false;
    this.dirty = true;
    return this.send(this.member(memberId), text, { type: kind, ...(thread ? { proposalId: thread.id } : {}) }, kind,
      { key, ...(thread ? { about: thread.participants.filter(p => p !== memberId) } : {}), ...(link ? { relayContact: link } : {}) }) !== "refused";
  }
  photoReportAnswer(memberId: MemberId, key: string, text: string): boolean {
    if (!this.record(memberId) || this.declinedIds.has(memberId)) return false;
    this.dirty = true;
    return this.send(this.member(memberId), text, { type: "info" }, "info", { key, answersMemberAction: true }) !== "refused";
  }
  photoReport(reporter: MemberId, subject: MemberId, threadId: string): boolean {
    const thread = this.opps.get(threadId);
    if (reporter === subject || (thread && (!thread.participants.includes(reporter) || !thread.participants.includes(subject)))) return false;
    if (!this.record(reporter) || !this.record(subject)) return false;
    const met = this.metBefore(reporter, subject);
    this.blockPair(reporter, subject, met, true);
    this.reportSubject(reporter, subject, "harassment", { ...(thread ? { oppId: threadId } : {}), source: "message", met });
    this.dirty = true;
    return true;
  }
  ageInDoubt(id: MemberId): boolean {
    if (!this.members.has(id) && this.record(id) && !this.declinedIds.has(id)) this.member(id);
    return this.relayHost().member(id)?.age === undefined;
  }
  relayLog(): RelayRecord[] { return this.relayDesk.records(); }
  relayContactShareFrom(outboundId: string): MemberId | undefined { return this.relayDesk.contactShareFrom(outboundId); }
  relaySenderOf(outboundId: string): MemberId | undefined { return this.relayDesk.senderOf(outboundId); }

  /** Hydrate active venues, member visit/rejection history, and cross-app concurrent headcounts from the service shell (zero SQL in ConsentNetwork). */
  setVenueRuntimeContext(ctx: VenueRuntimeContext): void {
    this.venueRuntimeCtx = {
      ...(ctx.venues !== undefined ? { venues: ctx.venues } : this.venueRuntimeCtx.venues !== undefined ? { venues: this.venueRuntimeCtx.venues } : {}),
      ...(ctx.memberVenueHistory !== undefined ? { memberVenueHistory: ctx.memberVenueHistory } : this.venueRuntimeCtx.memberVenueHistory !== undefined ? { memberVenueHistory: this.venueRuntimeCtx.memberVenueHistory } : {}),
      ...(ctx.concurrentHeadcountByVenue !== undefined ? { concurrentHeadcountByVenue: ctx.concurrentHeadcountByVenue } : this.venueRuntimeCtx.concurrentHeadcountByVenue !== undefined ? { concurrentHeadcountByVenue: this.venueRuntimeCtx.concurrentHeadcountByVenue } : {}),
    };
  }

  setMeetupVenueContext(ctx: VenueRuntimeContext): void {
    this.setVenueRuntimeContext(ctx);
  }

  private isOppPanicHalted(oppId: string, participantIds: readonly MemberId[]): boolean {
    return participantIds.some(pid => this.relayDesk.isPanicTriggered(pid, oppId));
  }

  private handleRelayPanicExit(id: MemberId, matchIds: string[]) {
    this.dirty = true;
    this.ctx.log("relay_panic_exit", { memberId: id, matchIds });
    this.caseEvent(id, { at: this.now(), kind: "panic_exit", points: 0 });
    for (const matchId of matchIds) {
      const opps = matchId === "*"
        ? [...this.opps.values()].filter(o => o.stage === "scheduled" && o.participants.includes(id))
        : [this.opps.get(matchId)].filter((o): o is Opp => !!o && o.stage === "scheduled" && o.participants.includes(id));
      for (const opp of opps) {
        this.ctx.log("meeting_cancelled", { proposalId: opp.id, reason: "panic_exit" });
        this.close(opp, "panic_exit");
      }
    }
  }

  relayPanicExit(memberId: MemberId, matchId?: string): { haltedMatches: string[]; cancelledSwaps: number; notice: string } {
    return this.relayDesk.triggerPanicExit(memberId, matchId);
  }

  private hasVenueRedLines(participantIds: readonly MemberId[]): boolean {
    return participantIds.some(id => this.venuePrefsOf(id).hasRedLines);
  }

  canRelayArrivalForMeetup(
    oppId: string,
    senderId: MemberId,
    recipientId: MemberId,
    passedSafetyAndLeakCheck: boolean
  ): boolean {
    const opp = this.opps.get(oppId);
    if (!opp || opp.stage !== "scheduled" || opp.meetingAt === undefined) return false;
    const sender = this.members.get(senderId);
    const recipient = this.members.get(recipientId);
    if (!sender || !recipient) return false;
    const ageOfMember = (m: MemberState) =>
      m.minor || m.minorSignal || m.minorReported ? 13 : validAge(m.age) ? m.age : validAge(m.statedAge) ? m.statedAge : 0;
    const anyMinorInEvent = opp.teenRuleAt !== undefined || opp.participants.some(pid => {
      const pm = this.members.get(pid);
      return !pm || isMinor(ageOfMember(pm));
    });
    const panicTriggered =
      this.relayDesk.isPanicTriggered(senderId, oppId) ||
      this.relayDesk.isPanicTriggered(recipientId, oppId);
    return evaluateArrivalRelaySafe({
      senderAge: ageOfMember(sender),
      recipientAge: ageOfMember(recipient),
      anyMinorInEvent,
      senderConfirmed: opp.status.get(senderId) === "yes",
      recipientConfirmed: opp.status.get(recipientId) === "yes",
      blocked: this.blocked(senderId, recipientId),
      panicTriggered,
      senderOptedOut: sender.optedOut || !!sender.account || !this.trust.ok(senderId),
      recipientOptedOut: recipient.optedOut || !!recipient.account || !this.trust.ok(recipientId),
      nowMs: this.now(),
      startMs: opp.meetingAt,
      alreadyMet: false,
      passedSafetyAndLeakCheck,
    });
  }

  checkBackupPivot(
    oppId: string,
    trigger: { closed?: boolean; full?: boolean },
    opts: { venuePool?: readonly VenueRecord[]; apply?: boolean } = {}
  ): { shouldPivot: boolean; shouldQuarantine: boolean; backupVenue?: VenueRecord } {
    const opp = this.opps.get(oppId);
    if (!opp || opp.meetingAt === undefined) return { shouldPivot: false, shouldQuarantine: false };
    const reportedClosed = Boolean(trigger.closed);
    const reportedFull = Boolean(trigger.full);
    const liveVenues = this.venues.listVenues();
    const pool = opts.venuePool
      ?? (this.venueRuntimeCtx.venues?.length ? this.venueRuntimeCtx.venues : undefined)
      ?? (liveVenues.length ? liveVenues : ALL_SEED_VENUES);
    const backup = opp.backupVenueId ? pool.find(v => v.id === opp.backupVenueId) : undefined;
    const hasVerifiedBackup = Boolean(backup && backup.status === "active");
    const shouldPivot = evaluateBackupPivotV2(
      reportedClosed,
      reportedFull,
      hasVerifiedBackup,
      this.now(),
      opp.meetingAt,
      Boolean(opp.backupPivoted)
    );
    const shouldQuarantine = evaluateVenueQuarantine(reportedClosed, reportedFull);
    if (shouldPivot && backup && opts.apply !== false) {
      opp.backupPivoted = true;
      opp.venueId = backup.id;
      opp.venue = backup.name;
      opp.venueArea = backup.neighborhood;
      this.dirty = true;
    }
    return { shouldPivot, shouldQuarantine, ...(shouldPivot && backup ? { backupVenue: backup } : {}) };
  }

  private venuePoolForCity(city: CityId, explicit?: readonly VenueRecord[]): readonly VenueRecord[] {
    if (explicit) return explicit;
    if (this.venueRuntimeCtx.venues?.length) {
      const normalized = city.trim().toLowerCase();
      const matching = this.venueRuntimeCtx.venues.filter(v => v.city.trim().toLowerCase() === normalized);
      if (matching.length) return matching;
      return this.venueRuntimeCtx.venues;
    }
    const live = this.venues.listVenues(city);
    if (live.length) return live;
    return seedVenuesForCity(city);
  }

  private findVenueRecordInPool(
    candidate: Pick<Venue, "id" | "name">,
    pool: readonly VenueRecord[]
  ): VenueRecord | undefined {
    const byId = pool.find(v => v.id === candidate.id);
    if (byId) return byId;
    const nameKey = candidate.name.trim().toLowerCase();
    return pool.find(v => v.name.trim().toLowerCase() === nameKey);
  }

  private memberVenuePrefsOf(
    id: MemberId,
    facetsByMember?: ReadonlyMap<MemberId, Facet[]>,
    extraVisited: readonly string[] = [],
  ): { prefs: MemberVenuePrefs; hasRedLines: boolean } {
    const base = this.venuePrefsOf(id, extraVisited, facetsByMember);
    const history = this.venueRuntimeCtx.memberVenueHistory?.get(id);
    if (!history) return { prefs: base.prefs, hasRedLines: base.hasRedLines };
    return {
      hasRedLines: base.hasRedLines,
      prefs: {
        ...base.prefs,
        visitedVenueIds: [...new Set([...base.prefs.visitedVenueIds, ...history.visited])],
        rejectedVenueIds: [...new Set([...base.prefs.rejectedVenueIds, ...history.rejected])],
      },
    };
  }

  private participantVenuePrefsOf(participantIds: readonly MemberId[]): Array<{ prefs: MemberVenuePrefs; hasRedLines: boolean }> {
    const facetsByMember = this.snapshotRows().facets;
    return participantIds.map(id => this.memberVenuePrefsOf(id, facetsByMember));
  }

  private venueRecordPassesRedLines(
    venue: VenueRecord,
    prefs: readonly MemberVenuePrefs[],
    startMs: number,
    tz: string,
    teenFriendAllowed = false,
    opts: { hasReservation?: boolean; openEvent?: boolean; concurrentHeadcount?: number } = {}
  ): boolean {
    if (teenFriendAllowed && venue.allAges !== true) return false;
    const minParticipantAge = prefs.length ? Math.min(...prefs.map(p => p.age)) : 0;
    const groupSize = Math.max(1, prefs.length);
    const hasReservation = opts.hasReservation === true;
    const parts = localParts(startMs, tz);
    const isAfterDark = parts.hour >= 19 || parts.hour < 7;
    const openCheck = isVenueOpenAt(venue, tz, startMs, 30);
    const isAlcoholCentric = venue.isAlcoholCentric ?? (venue.isBarOnly || ALCOHOL_CENTRIC_CATEGORIES.has(venue.category));
    const venueAllAges = venue.allAges ?? (!venue.isBarOnly && !isAlcoholCentric && (venue.ageMin ?? 0) <= 13);
    const maxBudgetTier = prefs.length ? Math.min(...prefs.map(p => p.maxBudgetTier)) : 2;
    const hardOk = venueHardEligible({
      isPublic: venue.public === true,
      venueStatus: venue.status,
      minParticipantAge,
      venueAgeMin: venue.ageMin ?? 0,
      venueAllAges,
      teenFriendAllowed,
      anyNonDrinker: prefs.some(p => !p.drinksAlcohol),
      isBarOnly: venue.isBarOnly === true,
      alcoholOptional: venue.alcoholOptional === true,
      anyVegetarian: prefs.some(p => p.vegetarian === true),
      servesVegetarian: venue.servesVegetarian === true,
      anyVegan: prefs.some(p => p.vegan === true),
      servesVegan: venue.servesVegan === true,
      anyWheelchairNeeded: prefs.some(p => p.wheelchairNeeded === true),
      wheelchairAccessible: venue.wheelchairAccessible === true,
      anyVisited: prefs.some(p => p.visitedVenueIds.includes(venue.id)),
      anyRejected: prefs.some(p => p.rejectedVenueIds.includes(venue.id)),
      priceTier: venue.priceTier,
      maxBudgetTier,
      maxTravelMin: 5,
      travelLimitMin: 45,
      verifiedOpen: openCheck.open,
      openBufferMin: openCheck.remainingMinutes,
      groupSize,
      reservationRequired: venue.reservationRequired === true,
      hasReservation,
      separateChecks: venue.separateChecks === true,
      walkInCapacity: venue.walkInGroupCapacity,
      isNightLiveMusic: venue.liveMusicAtNight === true && isAfterDark,
      isOutdoorOnly: venue.outdoor === true && !venue.indoor,
      badWeatherOrAfterDark: isAfterDark,
    });
    if (!hardOk) return false;
    const noiseTierMap: Record<VenueNoiseLevel, number> = { quiet: 0, conversational: 1, lively: 2, loud: 3 };
    const concurrentHeadcount = opts.concurrentHeadcount ?? this.venueRuntimeCtx.concurrentHeadcountByVenue?.[venue.id] ?? 0;
    return evaluateVenueRedLines({
      anyStrictSober: prefs.some(p => p.strictSober === true),
      anyNonDrinker: prefs.some(p => !p.drinksAlcohol),
      isAlcoholCentric,
      isBarOnly: venue.isBarOnly,
      alcoholOptional: venue.alcoholOptional,
      anyHalal: prefs.some(p => p.halal === true),
      halalFriendly: venue.halalFriendly === true,
      anyKosher: prefs.some(p => p.kosher === true),
      kosherFriendly: venue.kosherFriendly === true,
      anyGlutenFree: prefs.some(p => p.glutenFree === true),
      glutenFreeFriendly: venue.glutenFreeFriendly === true,
      anySevereAllergen: prefs.some(p => p.severeAllergen === true),
      severeAllergenSafe: venue.severeAllergenSafe === true,
      anySmokeFree: prefs.some(p => p.smokeFree === true),
      isSmokeFree: venue.isSmokeFree === true,
      anyLowNoise: prefs.some(p => p.lowNoiseRequired === true),
      noiseTier: noiseTierMap[venue.noiseLevel],
      anyDaytimeOnly: prefs.some(p => p.daytimeOnly === true),
      isAfterDark,
      isFirstMeet: prefs.length === 2,
      safetyScore: venue.safetyScore ?? 8,
      transitScore: venue.transitScore ?? 4,
      startLocalHour: parts.hour,
      groupSize,
      hasReservation,
      openEventEligible: (opts.openEvent || groupSize > 6) ? venue.openEventEligible === true : false,
      concurrentHeadcount,
      walkInCapacity: venue.walkInGroupCapacity,
    });
  }

  venuePassesRedLines(venue: VenueRecord, participantIds: readonly MemberId[], startMs: number, tz?: string): boolean {
    const prefs = this.participantVenuePrefsOf(participantIds).map(p => p.prefs);
    const resolvedTz = tz ?? cityTimezone(venue.city) ?? CITY_TZ.nyc;
    return this.venueRecordPassesRedLines(venue, prefs, startMs, resolvedTz);
  }

  private pickVenueWithRedLinesFromPrefs(
    participantIds: readonly MemberId[],
    basePrefs: readonly MemberVenuePrefs[],
    startMs: number,
    opts: {
      city?: CityId;
      venues?: readonly VenueRecord[];
      mode?: "date" | "group" | "solo" | "professional";
      teenFriendAllowed?: boolean;
      concurrentHeadcountByVenue?: Record<string, number>;
      targetHobbies?: string[];
      openEvent?: boolean;
      hasReservation?: boolean;
      memberOverrides?: Partial<Record<MemberId, Partial<MemberVenuePrefs>>>;
    } = {}
  ): PrimaryBackupVenuePick {
    const city: CityId = opts.city ?? (isLaunchCity(this.opts.city) ? this.opts.city : this.opts.city || "nyc");
    const areas = participantIds.map(id => this.member(id).area).filter((a): a is string => Boolean(a));
    const members = basePrefs.map(base => {
      const ov = opts.memberOverrides?.[base.memberId];
      return ov ? { ...base, ...ov } : base;
    });
    const mode = opts.mode ?? (this.app.id === "peon" ? "professional" : participantIds.length >= 3 ? "group" : participantIds.length === 2 ? "date" : "solo");
    const app = this.app.id === "friends" ? "friends" : this.app.id === "slop" ? "slop" : this.app.id === "peon" ? "peon" : "ntwrk";
    const pool = this.venuePoolForCity(city, opts.venues);
    const concurrentHeadcountByVenue = opts.concurrentHeadcountByVenue ?? this.venueRuntimeCtx.concurrentHeadcountByVenue;
    return pickPrimaryAndBackupVenue(
      pool,
      {
        city,
        memberAreas: areas,
        members,
        startMs,
        mode,
        app,
        ...(opts.teenFriendAllowed !== undefined ? { teenFriendAllowed: opts.teenFriendAllowed } : {}),
        ...(concurrentHeadcountByVenue ? { concurrentHeadcountByVenue } : {}),
        ...(opts.targetHobbies ? { targetHobbies: opts.targetHobbies } : {}),
        ...(opts.openEvent !== undefined ? { openEvent: opts.openEvent } : {}),
        ...(opts.hasReservation !== undefined ? { hasReservation: opts.hasReservation } : {}),
      },
      this.now()
    );
  }

  pickVenueWithRedLines(
    participantIds: readonly MemberId[],
    startMs: number,
    opts: {
      city?: LaunchCity | CityId;
      venues?: readonly VenueRecord[];
      mode?: "date" | "group" | "solo" | "professional";
      teenFriendAllowed?: boolean;
      concurrentHeadcountByVenue?: Record<string, number>;
      targetHobbies?: string[];
      openEvent?: boolean;
      hasReservation?: boolean;
      memberOverrides?: Partial<Record<MemberId, Partial<MemberVenuePrefs>>>;
    } = {}
  ): PrimaryBackupVenuePick {
    const basePrefs = this.participantVenuePrefsOf(participantIds).map(p => p.prefs);
    return this.pickVenueWithRedLinesFromPrefs(participantIds, basePrefs, startMs, opts);
  }

  /** Stage 1: Deterministic red-line Top-1 suggestion state (0 LLM tokens). */
  proposeTopOneVenueFor(
    participantIds: readonly MemberId[],
    startMs: number,
    opts: {
      city?: CityId;
      venues?: readonly VenueRecord[];
      mode?: "date" | "group" | "solo" | "professional";
      teenFriendAllowed?: boolean;
      concurrentHeadcountByVenue?: Record<string, number>;
      targetHobbies?: string[];
      openEvent?: boolean;
      hasReservation?: boolean;
      memberOverrides?: Partial<Record<MemberId, Partial<MemberVenuePrefs>>>;
    } = {}
  ): TopOneSuggestionState {
    const city: CityId = opts.city ?? (this.opts.city || "nyc");
    const areas = participantIds.map(id => this.member(id).area).filter((a): a is string => Boolean(a));
    const basePrefs = this.participantVenuePrefsOf(participantIds).map(p => {
      const ov = opts.memberOverrides?.[p.prefs.memberId];
      return ov ? { ...p.prefs, ...ov } : p.prefs;
    });
    const mode = opts.mode ?? (this.app.id === "peon" ? "professional" : participantIds.length >= 3 ? "group" : participantIds.length === 2 ? "date" : "solo");
    const app = this.app.id === "friends" ? "friends" : this.app.id === "slop" ? "slop" : this.app.id === "peon" ? "peon" : "ntwrk";
    const pool = this.venuePoolForCity(city, opts.venues);
    const concurrentHeadcountByVenue = opts.concurrentHeadcountByVenue ?? this.venueRuntimeCtx.concurrentHeadcountByVenue;
    return proposeTopOne(
      pool,
      {
        city,
        memberAreas: areas,
        members: basePrefs,
        startMs,
        mode,
        app,
        ...(opts.teenFriendAllowed !== undefined ? { teenFriendAllowed: opts.teenFriendAllowed } : {}),
        ...(concurrentHeadcountByVenue ? { concurrentHeadcountByVenue } : {}),
        ...(opts.targetHobbies ? { targetHobbies: opts.targetHobbies } : {}),
        ...(opts.openEvent !== undefined ? { openEvent: opts.openEvent } : {}),
        ...(opts.hasReservation !== undefined ? { hasReservation: opts.hasReservation } : {}),
      },
      this.now()
    );
  }

  /** Stage 2: Optional bounded Top-5 verified-ID LLM rerank + rationale (fail-open to deterministic candidates[0]). */
  async rerankTopOneVenueWithLLM(
    state: TopOneSuggestionState,
    participantIds: readonly MemberId[],
    opts: { llm?: LLM; mode?: "date" | "group" | "solo" | "professional"; deadlineMs?: number } = {}
  ): Promise<VenueLLMRerankResult> {
    const facetsByMember = this.snapshotRows().facets;
    const shareableInterests: string[] = [];
    const forbiddenFacts: string[] = [];
    for (const id of participantIds) {
      for (const f of facetsByMember.get(id) ?? []) {
        if (f.scope === "agent_private") {
          if (f.value.trim()) forbiddenFacts.push(f.value);
          for (const t of f.tags) forbiddenFacts.push(t.replace(/_/g, " "));
        } else if (f.scope === "shareable" && f.kind === "interest") {
          for (const t of f.tags) shareableInterests.push(t);
        }
      }
    }
    return rerankTopVenuesWithLLM({
      llm: opts.llm ?? this.opts.engineLLM,
      candidates: state.candidates,
      shareableInterests: [...new Set(shareableInterests)],
      mode: opts.mode ?? (this.app.id === "peon" ? "professional" : participantIds.length >= 3 ? "group" : "date"),
      forbiddenFacts: [...new Set(forbiddenFacts)],
      extraLeakCheck: text => (this.ratesPhotos && appearanceLeak(text) ? "appearance_leak" : null),
      deadlineMs: opts.deadlineMs ?? 8_000,
    });
  }

  /** Stage 3: Deterministic-first rejection classification + bounded orthogonal pivot (max 3 pivots). */
  pivotVenueSuggestion(
    state: TopOneSuggestionState,
    replyBody: string,
    opts: PivotFilterOptions = {}
  ): { reason: VenueRejectionReason; state: TopOneSuggestionState } {
    const reason = classifyVenueRejection(replyBody);
    const derivedOpts: PivotFilterOptions = {
      ...opts,
      ...(reason === "red_line" && /\b(?:sober|alcohol|bar|brewery|wine)\b/i.test(replyBody) ? { requireNoAlcohol: true } : {}),
      ...(reason === "wrong_vibe" && /\b(?:loud|noisy|quiet)\b/i.test(replyBody) ? { requireLowNoise: true } : {}),
    };
    return { reason, state: rejectAndPivot(state, reason, derivedOpts) };
  }

  private initTopOneSuggestionForBooked(
    o: Opp,
    bookedVenue: Pick<Venue, "id" | "name" | "neighborhood">,
    startMs: number,
    city: CityId,
    pool: readonly VenueRecord[],
    mode: "date" | "group" | "solo" | "professional",
    backupVenueId?: string,
  ): TopOneSuggestionState {
    const base = this.proposeTopOneVenueFor(o.participants, startMs, {
      city,
      venues: pool,
      mode,
      teenFriendAllowed: o.teenRuleAt !== undefined,
      targetHobbies: o.tags,
    });
    const currentFromCandidates = base.candidates.find(c => c.venue.id === bookedVenue.id || c.venue.name.toLowerCase() === bookedVenue.name.toLowerCase());
    const currentRecord = currentFromCandidates?.venue ?? this.findVenueRecordInPool(bookedVenue, pool) ?? this.venues.getVenue(bookedVenue.id);
    const current = currentFromCandidates ?? (currentRecord ? {
      venue: currentRecord,
      score: 100,
      rubricScore: 100,
      budgetFitScore: 100,
      personaScore: 100,
      maxTravelMinutes: 0,
      meanTravelMinutes: 0,
      needsOpenCheck: false,
    } : base.current);
    const backup = (backupVenueId ? base.candidates.find(c => c.venue.id === backupVenueId) : undefined)
      ?? base.candidates.find(c => c.venue.id !== current?.venue.id)
      ?? base.backup;
    return {
      ...base,
      current,
      backup,
      candidates: base.candidates.slice(0, 12),
    };
  }

  private handleBookedVenueObjection(
    m: MemberState,
    o: Opp,
    body: string,
    reason: VenueRejectionReason,
    now: number,
  ): boolean {
    if (o.meetingAt === undefined) return false;
    const going = o.participants.filter(id => o.status.get(id) === "yes");
    if (going.length < 2) return false;
    const newRedLines = extractRedLineTags(body);
    if (newRedLines.length) {
      m.learned.redLines ??= new Set();
      for (const tag of newRedLines) m.learned.redLines.add(tag);
      this.dirty = true;
    }
    const city: CityId = this.opts.city ?? "nyc";
    const tz = o.meetingTimeZone ?? this.cityTz();
    const pool = this.venuePoolForCity(city);
    const mode: "date" | "group" | "solo" | "professional" = this.app.id === "peon" ? "professional" : going.length >= 3 ? "group" : "date";
    const oldVenueId = o.venueId;
    let state = o.venueSuggestion;
    if (!state) {
      state = this.initTopOneSuggestionForBooked(
        o,
        { id: o.venueId ?? "", name: o.venue ?? "", neighborhood: o.venueArea ?? "" },
        o.meetingAt,
        city,
        pool,
        mode,
        o.backupVenueId,
      );
    }
    if (newRedLines.length || reason === "red_line") {
      const updatedPrefs = this.participantVenuePrefsOf(going).map(p => p.prefs);
      const teenFriendAllowed = o.teenRuleAt !== undefined;
      const filteredCandidates = state.candidates.filter(c =>
        c.venue.id === state!.current?.venue.id
        || this.venueRecordPassesRedLines(c.venue, updatedPrefs, o.meetingAt!, tz, teenFriendAllowed));
      if (filteredCandidates.length <= 1) {
        const refreshed = this.proposeTopOneVenueFor(going, o.meetingAt, { city, venues: pool, mode, teenFriendAllowed, targetHobbies: o.tags });
        const seenIds = new Set([...state.rejectedIds, ...state.visitedIds]);
        state = {
          ...state,
          candidates: refreshed.candidates.filter(c => !seenIds.has(c.venue.id)).slice(0, 12),
        };
      } else {
        state = { ...state, candidates: filteredCandidates };
      }
    }
    const derivedOpts: PivotFilterOptions = {
      ...(reason === "price" && state.current ? { maxPriceTier: Math.max(0, state.current.venue.priceTier - 1) } : {}),
    };
    const pivoted = this.pivotVenueSuggestion(state, body, derivedOpts);
    o.venueSuggestion = pivoted.state;
    const when = whenPhrase(o.meetingAt, tz);
    if (pivoted.state.action === "propose_next" && pivoted.state.current) {
      const next = pivoted.state.current.venue;
      if (oldVenueId) this.venues.recordRejection(m.id, oldVenueId);
      o.venueId = next.id;
      o.venue = next.name;
      o.venueArea = next.neighborhood;
      o.backupVenueId = pivoted.state.backup?.venue.id;
      this.venues.upsertVenue(next);
      if (pivoted.state.backup?.venue) this.venues.upsertVenue(pivoted.state.backup.venue);
      this.meetups.registerMeetup({
        meetupId: o.id,
        app: this.app.id,
        city: this.networkCity(),
        startMs: o.meetingAt,
        participants: [...going],
        confirmed: [...going],
        primaryVenueId: next.id,
        ...(o.backupVenueId ? { backupVenueId: o.backupVenueId } : {}),
        venueName: next.name,
        ...(next.address ? { venueAddress: next.address } : {}),
        ...(next.arrivalLandmark ? { arrivalLandmark: next.arrivalLandmark } : {}),
      });
      this.ctx.log("venue_pivoted", { oppId: o.id, memberId: m.id, reason: pivoted.reason, pivotsUsed: pivoted.state.pivotsUsed, fromVenueId: oldVenueId ?? null, toVenueId: next.id });
      this.ctx.log("venue_swapped", { oppId: o.id, memberId: m.id, fromVenueId: oldVenueId ?? null, toVenueId: next.id, reason: pivoted.reason });
      this.send(m, this.copy.topOneVenueSuggestion(next.name, next.neighborhood, when, { pivot: pivoted.state.pivotsUsed, mode }), { type: "scheduling", proposalId: o.id }, "reply", { about: going });
      m.awaiting = { kind: "booked", oppId: o.id, at: now };
      for (const peerId of going) {
        if (peerId === m.id) continue;
        const peer = this.members.get(peerId);
        if (!peer) continue;
        this.send(peer, this.copy.silentPartnerVenueSwap(when, next.name, { area: next.neighborhood }), { type: "scheduling", proposalId: o.id }, "scheduling", { about: going });
      }
      return true;
    }
    this.ctx.log("venue_pivot_exhausted", { oppId: o.id, memberId: m.id, reason: pivoted.reason, pivotsUsed: pivoted.state.pivotsUsed });
    this.send(m, this.copy.topOneVenueSuggestion("", "", when, { exhausted: true }), { type: "scheduling", proposalId: o.id }, "reply", { about: going });
    m.awaiting = { kind: "booked", oppId: o.id, at: now };
    return true;
  }

  private handleMeetupVenueDisruption(
    m: MemberState,
    oppId: string,
    state: "venue_closed" | "venue_full",
    now: number,
  ): void {
    const opp = this.opps.get(oppId);
    if (!opp || opp.meetingAt === undefined) return;
    const oldVenueName = opp.venue ?? "the venue";
    const oldVenueId = opp.venueId;
    const res = this.checkBackupPivot(
      oppId,
      { closed: state === "venue_closed", full: state === "venue_full" },
      { venuePool: this.venuePoolForCity(this.networkCity()), apply: true },
    );
    if (res.shouldQuarantine && oldVenueId) {
      this.venues.quarantineVenue(oldVenueId, m.id, now);
    }
    if (!res.shouldPivot || !res.backupVenue) return;
    const backup = res.backupVenue;
    this.venues.upsertVenue(backup);
    const going = opp.participants.filter(id => opp.status.get(id) === "yes");
    const reason = state === "venue_full" ? "full" : "closed";
    const msg = this.copy.backupVenuePivot(oldVenueName, backup.name, reason, {
      ...(backup.address ? { address: backup.address } : {}),
      ...(backup.arrivalLandmark ? { landmark: backup.arrivalLandmark } : {}),
    });
    this.ctx.log("meetup_backup_pivoted", { oppId, reason, fromVenueId: oldVenueId ?? null, toVenueId: backup.id });
    for (const id of going) {
      const rec = this.members.get(id);
      if (!rec || rec.optedOut || rec.minor) continue;
      if (id !== m.id && this.blocked(m.id, id)) continue;
      this.send(rec, msg, { type: "info", proposalId: oppId }, "info", {
        about: going.filter(p => p !== id),
        ...(backup.address ? { publicVenueAddress: backup.address } : {}),
      });
    }
  }

  densityTierFor(qualifiedLocalCount: number): DensityTier {
    const appKind = this.app.id === "slop" ? "slop" : this.app.id === "friends" ? "friends" : "ntwrk";
    return evaluateDensityTier(appKind, qualifiedLocalCount);
  }

  canTriggerExternalSourcingFor(
    memberId: MemberId,
    opts: {
      eligibleLocalPairs: number;
      topScoreScaled: number;
      strongThresholdScaled: number;
      externalScoutOptIn: boolean;
      activeSourcingTickets: number;
    }
  ): boolean {
    const m = this.members.get(memberId);
    if (!m || this.declinedIds.has(memberId)) return false;
    const snap = this.record(memberId);
    const age = m.minor || m.minorSignal || m.minorReported ? 13 : validAge(m.age) ? m.age : validAge(m.statedAge) ? m.statedAge : 0;
    return evaluateExternalSourcingTrigger({
      eligibleLocalPairs: opts.eligibleLocalPairs,
      topScoreScaled: opts.topScoreScaled,
      strongThresholdScaled: opts.strongThresholdScaled,
      memberAge: age,
      memberOptedInRomance: Boolean(snap?.prefs.romanceOptIn && snap?.prefs.categoriesOptIn.includes("romance")),
      memberPaused: snap?.state === "paused" || !!m.account,
      memberOptedOut: m.optedOut,
      memberTrustOk: this.trust.ok(memberId),
      memberStageReady: m.stage === "active",
      memberExternalScoutOptIn: opts.externalScoutOptIn,
      activeSourcingTickets: opts.activeSourcingTickets,
    });
  }

  evaluateExternalEventPublish(draft: ExternalEventDraft): { allowed: boolean; approvedExternalCap: number; plannedTotal: number } {
    return checkPublishExternalEvent(draft);
  }

  evaluateExternalEventQuorum(
    confirmedNetworkAnchors: number,
    confirmedNetworkTotal: number,
    approvedExternalRsvps: number,
    hoursToStart: number
  ): ExternalQuorumDecision {
    return checkExternalEventT24Quorum(confirmedNetworkAnchors, confirmedNetworkTotal, approvedExternalRsvps, hoursToStart);
  }

  forgetMember(id: MemberId) { if (!this.declinedIds.has(id)) this.forget(id); }

  /**
   * A member who joined on the web (the platform's POST /api/join) has not written yet: send the
   * welcome now, as their first message would. Nothing happens for a member already welcomed.
   */
  welcomeJoined(id: MemberId, verifiedInviterId?: MemberId): boolean {
    if (this.declinedIds.has(id)) return false;
    this.dirty = true;
    const m = this.member(id);
    if (m.stage !== "new" && verifiedInviterId === undefined) return false;
    this.syncMember(m);
    if (validAge(m.age) && !this.canJoinApp(m.age)) { this.declineUnderMinAge(m); return false; }
    const inviterMatches = verifiedInviterId !== id && this.record(id)?.invitedBy === verifiedInviterId;
    const freshAttribution = memberInviteCanAttribute(!this.invitedIds.has(id), verifiedInviterId !== undefined, inviterMatches);
    if (freshAttribution) {
      this.invitedIds.add(id);
      if (verifiedInviterId && this.record(verifiedInviterId) && !this.declinedIds.has(verifiedInviterId)) this.member(verifiedInviterId);
    }
    // The inviter's receipt belongs to the join, even if the invitee wrote before its projection recovered.
    if (m.stage !== "new") {
      if (freshAttribution && !m.minor && !m.optedOut) this.inviteeJoined(m);
      return false;
    }
    // The answer to the person's own action (the join), so it goes now, not at a picked send time.
    this.replyTo = m.id;
    try { this.welcome(m); } finally { this.replyTo = undefined; }
    return true;
  }
}

/**
 * Adapter for the Blooio outbound queue's `recipientPolicy` hook (packages/blooio
 * outbound-queue.ts): `(to, { kind, briefId, agentInitiated }) => { ok } | { ok: false, reason }`.
 * `memberOf` maps the E.164 address to a member id; `briefId`, when it names an opportunity, gives
 * the other people the message is about.
 */
export function blooioRecipientPolicy(net: ConsentNetwork, memberOf: (to: string) => MemberId | undefined) {
  return (to: string, ctx: { kind: string; briefId?: string; agentInitiated: boolean }): RecipientCheck => {
    const id = memberOf(to);
    if (!id) return { ok: false, reason: "unknown_recipient" };
    const opp = ctx.briefId ? net.opps.get(ctx.briefId) : undefined;
    // An agent-started send about an opportunity we no longer know (deleted, or a stale id) is refused:
    // without it, the about-others checks cannot run (network-consent-20).
    if (ctx.briefId && !opp && ctx.agentInitiated) return { ok: false, reason: "unknown_brief" };
    const kind: SendKind = !ctx.agentInitiated ? "reply" : opp ? "reveal" : "info";
    return net.recipientPolicy(id, kind, { about: opp?.participants ?? [], proactive: ctx.kind === "proactive", ...(opp ? { oppId: opp.id } : {}) });
  };
}

/** What must not appear in a message to a recipient: the Blooio outbound queue's LeakSources (packages/blooio/src/outbound-queue.ts). */
export type LeakSources = Pick<LeakOptions, "forbidden" | "facts" | "canaries" | "publicPhrases">;

/**
 * Adapter for the Blooio outbound queue's `forbiddenProvider` hook: `(recipient, message) => LeakSources`.
 * `memberOf` maps the queue's address to the member (or, for a group chat, every participant). By
 * default an address is a member id, and "chat:<opportunity id>" means that opportunity's
 * participants. An unknown address gets every member's private values and canaries (fail closed).
 */
export function forbiddenProvider(net: ConsentNetwork, memberOf?: (to: string) => MemberId | readonly MemberId[] | undefined) {
  const resolve = memberOf ?? ((to: string) => (to.startsWith("chat:") ? net.opps.get(to.slice(5))?.participants : to));
  return (recipient: string, _message?: { text: string; briefId?: string }): LeakSources => {
    const r = resolve(recipient);
    const ids = r === undefined ? undefined : typeof r === "string" ? [r] : [...r];
    return net.leakSources(ids?.filter(id => net.memberList().some(m => m.id === id)).length === ids?.length ? ids : undefined);
  };
}

/**
 * What the Network knows about a member. `shared*`: the facts the member allowed others to see
 * (facet scope "shareable"). Only these may appear in a message to someone else (network-consent-11);
 * the rest is for matching only.
 */
interface KnownProfile { interests: Set<string>; skills: Set<string>; strongSkills: Set<string>; desires: Map<string, Set<Category>>; intents: number; sharedInterests: Set<string>; sharedSkills: Set<string> }

function learnedStandingIntent(memberId: MemberId, desire: DesireDef, statedAt: number): Intent {
  const tags = [...desire.needsInterests, ...desire.needsSkills, desire.pool ?? ""].filter(Boolean);
  return { id: `${memberId}:li:${desire.id}`, memberId, objective: desire.text, category: desire.category,
    details: `format: ${desire.format}; tags: ${tags.join(",")}`, horizonDays: learnedIntentDays, status: "active", createdAt: statedAt };
}

// ------------------------------------------------------------------ relay views (relay.ts)
/** A member as the relay sees them: the lowest known age (undefined when unsure: fails closed), opt-out and holds. */
function relayMemberOf(m: Pick<MemberState, "id" | "first" | "age" | "statedAge" | "statedAgeDay" | "minor" | "minorSignal" | "minorReported" | "ageUnknown" | "ageConflict" | "optedOut" | "account">, trustHold: boolean, day: number): RelayMember {
  const ages = [m.age, statedAgeOn(m, day)].filter((a): a is number => validAge(a));
  const unsure = m.minor || m.minorSignal || m.minorReported || m.ageUnknown || m.ageConflict || !ages.length;
  return { id: m.id, firstName: m.first, age: unsure ? undefined : Math.min(...ages), optedOut: m.optedOut, held: !!m.account || trustHold, markedMinor: m.minorSignal };
}

type LateArrivalBooking = Pick<Opp, "id" | "kind" | "plan" | "stage" | "review" | "participants" | "meetingAt" | "scheduleRevision" | "bookedAt" | "seat" | "lateArrivalReported">;

function lateArrivalRoster(opp: LateArrivalBooking, accepted: (id: MemberId) => boolean, received: (id: MemberId) => boolean): MemberId[] {
  return [...new Set(opp.participants)].filter(id => accepted(id) && opp.bookedAt?.[id] !== undefined && received(id));
}

function currentLateArrivalBooking(opp: LateArrivalBooking, roster: readonly MemberId[], from: MemberId, now: number): boolean {
  return opp.meetingAt !== undefined
    && lateArrivalBookingCurrent(opp.stage === "scheduled", reviewApproved(opp.review),
      !opp.seat, roster.includes(from), isLateArrivalPairBooking(opp), roster.length, opp.meetingAt - now);
}

function lateArrivalDeliveryCurrent(opp: LateArrivalBooking, delivery: LateArrivalDelivery, now: number,
  accepted: (id: MemberId) => boolean, received: (id: MemberId) => boolean): boolean {
  const roster = lateArrivalRoster(opp, accepted, received);
  const { from, to, revision, meetingAt } = delivery;
  return lateArrivalMayDispatch(currentLateArrivalBooking(opp, roster, from, now),
    opp.lateArrivalReported?.[from] === revision, opp.meetingAt === meetingAt && (opp.scheduleRevision ?? 0) === revision,
    roster.includes(to), from !== to, true);
}

/** Check a queued notice against the latest committed Network state for its exact app. */
export function storedLateArrivalCurrent(state: NetworkState, delivery: LateArrivalDelivery, now: number,
  received: (id: MemberId) => boolean): boolean {
  const opp = state.opps.find(o => o.id === delivery.oppId);
  if (!opp || !lateArrivalDeliveryCurrent(opp, delivery, now,
    id => opp.status.some(([key, status]) => key === id && status === "yes"), received)) return false;
  if (!isLateArrivalAdmitted({
    panicTriggered: isPanicHaltedState(state.relay, [delivery.from, delivery.to], delivery.oppId),
    blocked: state.blocks.includes(pairKey(delivery.from, delivery.to)),
  })) return false;
  return [delivery.from, delivery.to].every(id => {
    const member = state.members.find(m => m.id === id);
    if (!member || state.declinedIds.includes(id)) return false;
    const view = relayMemberOf(member, state.trust?.some(record => record.id === id && record.level !== "ok") || pendingReportHold(state.reports, id), earliestDayKeyOf(now));
    return canBeMatched(view.age) && !view.optedOut && !view.held && member.state !== "paused";
  });
}

/** The stored member's calendar choice still applies to an adult who can schedule meetings. */
export function storedCalendarOwnerOptedIn(state: NetworkState | undefined, id: MemberId, now: number): boolean {
  const member = state?.members.find(m => m.id === id);
  if (!state || !member?.calendar || state.declinedIds.includes(id)) return false;
  const held = state.trust?.some(record => record.id === id && record.level !== "ok") || pendingReportHold(state.reports, id);
  const view = relayMemberOf(member, held, earliestDayKeyOf(now));
  return canBeMatched(view.age) && !view.optedOut && !view.held && member.state !== "paused";
}

/** Read back the issuer's current Network safety state without reloading the live runtime. */
export function storedInviterCurrent(state: NetworkState, id: MemberId, now: number): boolean {
  const member = state.members.find(m => m.id === id);
  if (!member || state.declinedIds.includes(id)) return false;
  const trust = state.trust?.find(record => record.id === id)?.level ?? "ok";
  const view = relayMemberOf(member, trust !== "ok" || pendingReportHold(state.reports, id), earliestDayKeyOf(now));
  return memberInviteSourceCurrent(canBeMatched(view.age), !member.account, !view.optedOut, !view.held, now, member.invitesBlockedUntil);
}

export function storedInviteNoticePartyCurrent(state: NetworkState, id: MemberId, now: number): boolean {
  const member = state.members.find(m => m.id === id);
  if (!member || state.declinedIds.includes(id)) return false;
  const held = state.trust?.some(record => record.id === id && record.level === "hold") || pendingReportHold(state.reports, id);
  const view = relayMemberOf(member, held, earliestDayKeyOf(now));
  return canBeMatched(view.age) && !view.optedOut && !view.held;
}

export function gatheringEventPreference(prefs: Partial<Preferences> | null | undefined): boolean {
  return !!prefs && !prefs.onlyWhenAsked && Array.isArray(prefs.categoriesOptIn) && prefs.categoriesOptIn.includes("events") &&
    Array.isArray(prefs.formats) && prefs.formats.includes("event");
}

function gatheringMemberStateCurrent(member: MemberState | MemberJSON, trustHold: boolean, day: number): boolean {
  const view = relayMemberOf(member, trustHold, day);
  return member.stage === "active" && !member.onlyWhenAsked && member.state !== "paused" && !view.optedOut && !view.held && canBeMatched(view.age);
}

export function storedGatheringInviteRecipientCurrent(state: NetworkState, id: MemberId, now: number): boolean {
  const member = state.members.find(candidate => candidate.id === id);
  if (!member || state.declinedIds.includes(id)) return false;
  const hold = !!state.trust?.some(record => record.id === id && record.level !== "ok") || pendingReportHold(state.reports, id);
  return gatheringMemberStateCurrent(member, hold, earliestDayKeyOf(now));
}

export function storedInterruptionSurveyCurrent(state: NetworkState, app: string, memberId: MemberId, id: string, now: number): boolean {
  const member = state.members.find(item => item.id === memberId);
  const survey = member?.interruptionSurvey;
  if (!survey || survey.sentAt === undefined || id !== interruptionFeedbackKey(app, memberId, survey.opportunityId)) return false;
  const eligible = member.stage === "active" && !member.account && !member.onlyWhenAsked && member.state !== "paused"
    && !state.trust?.some(record => record.id === memberId && record.level !== "ok")
    && storedInviteNoticePartyCurrent(state, memberId, now) && state.opps.some(opp => opp.id === survey.opportunityId);
  return interruptionFeedbackCurrent(now - survey.sentAt, eligible);
}
/**
 * A two-person opportunity as the relay sees it: mutual while scheduled or done. The thread persists after the
 * date (founder decision 2026-10-11, #22, P7: a persistent thread, not a one-shot number swap); STOP, leave,
 * a hold, a block or a closed match still end it.
 */
function relayMatchOf(o: Pick<Opp, "id" | "participants" | "stage" | "closedFrom" | "meetingAt" | "createdAt">, statusOf: (p: MemberId) => PStatus | undefined, now: number, negativeFeedback: boolean): RelayMatch {
  const met = o.meetingAt !== undefined && o.meetingAt <= now && (o.stage === "scheduled" || o.stage === "done") ? o.meetingAt : undefined;
  const status: RelayMatch["status"] = o.stage === "scheduled" || o.stage === "done"
    ? "mutual"
    : o.stage === "closed" ? (o.closedFrom === "scheduled" ? "cancelled" : "closed") : "probing";
  return { id: o.id, participants: [o.participants[0]!, o.participants[1]!], acceptedBy: o.participants.filter(p => statusOf(p) === "yes"), status, negativeFeedback,
    ...(met !== undefined ? { metAt: met } : {}), at: o.meetingAt ?? o.createdAt };
}

/**
 * Final dispatch for a relayed item, from the newest stored state (the outbound queue's admission
 * transaction reads it again): the match is still the open two-person match of exactly these members
 * (both said yes, not closed), and both members are still in it as
 * the relay desk would see them now (adults, not opted out, not held, not declined, no block between them).
 * Null when it may go; otherwise a reason code. The canonical platform checks (consent ledger, bans,
 * memberships, ages) are the runtime's (runtime.ts relayAdmission).
 */
export function relayDispatchCheck(st: NetworkState, o: { matchId: string; from: MemberId; to: MemberId; now: number; teenText?: boolean }): string | null {
  if (o.from === o.to) return "relay:pair";
  const opp = st.opps.find(x => x.id === o.matchId);
  if (!opp || opp.participants.length !== 2 || !opp.participants.includes(o.from) || !opp.participants.includes(o.to)) return "relay:pair";
  const status = new Map(opp.status);
  const match = relayMatchOf(opp, p => status.get(p), o.now, st.avoid.includes(pairKey(o.from, o.to)));
  if (!relayThreadOpen(match.status === "mutual", match.participants.every(p => match.acceptedBy.includes(p)), match.negativeFeedback)) return "state:closed";
  const teen = o.teenText === true && opp.teenRuleAt !== undefined && OPEN_STAGES.has(opp.stage) && !storedTeenStop(st);
  const trust = new Map((st.trust ?? []).map(r => [r.id, r.level]));
  for (const id of [o.from, o.to]) {
    const m = st.members.find(x => x.id === id);
    if (!m || st.declinedIds.includes(id)) return "party:unknown";
    const v = relayMemberOf(m, trust.get(id) === "hold" || pendingReportHold(st.reports, id), earliestDayKeyOf(o.now));
    if (!canBeMatched(v.age) && !(teen && !m.olderReported && !m.minorReported && !m.minorSignal && !m.ageConflict && !m.ageUnknown)) return "party:age";
    if (v.optedOut) return "party:opted_out";
    if (v.held) return "party:held";
  }
  if (isPanicHaltedState(st.relay, [o.from, o.to], o.matchId)) return "party:panic";
  if (st.blocks.includes(pairKey(o.from, o.to))) return "party:blocked";
  return null;
}

/** The stored-state format version (exportState). importState refuses any other. */
export const NETWORK_STATE_VERSION = 1;
type AwaitingJSON = Omit<NonNullable<MemberState["awaiting"]>, "ask"> & { askIndex?: number; ask?: AskRecord };
type MemberJSON = Omit<MemberState, "learned" | "suggested" | "awaiting"> & {
  /** Full name (stripNames and findByName need it). */
  name: string;
  learned: Omit<MemberState["learned"], "interests" | "skills" | "desires" | "redLines"> & { interests: string[]; skills: string[]; desires: [string, number][]; redLines?: string[] };
  suggested: [string, number][]; awaiting?: AwaitingJSON;
};
type OppJSON = Omit<Opp, "primed" | "status" | "contacted" | "reminded" | "feedbackFrom" | "fixedVenue"> & {
  primed: MemberId[]; status: [MemberId, PStatus][]; contacted: MemberId[]; reminded: MemberId[]; feedbackFrom: MemberId[]; fixedVenue?: string;
};
/** Everything a ConsentNetwork holds, as plain JSON (exportState / importState; store.ts keeps it). */
export interface NetworkState {
  version: number; savedAt: number; matchingEnabled: boolean;
  /** Persisted with the first successful service save that reconciles legacy row statuses. */
  legacyIntentRowsReconciled?: true;
  members: MemberJSON[]; opps: OppJSON[]; requests: Request[]; queued: Proposal[]; deferred: Deferred[];
  declinedIds: MemberId[]; blocks: string[]; avoid: string[]; declined: [string, number][];
  feedback: FeedbackRecord[]; interactions: InteractionRecord[]; asks: AskRecord[];
  vouchedSkills: [MemberId, string[]][]; invitedIds: MemberId[];
  trust: TrustState; cases: SafetyCase[]; caseSeq: number;
  counters: ConsentNetwork["counters"]; gateReasons: Record<string, number>;
  lastRunDay: string; lastTick: number; tickGap: number; seq: number; oppSeq: number; reqSeq: number;
  /** Last matching evidence searched and total proposals queued in that New York day. */
  standingIntentSearch?: { day: string; fingerprint: string; queuedToday: number };
  plans?: {
    crews: plans.Crew[]; crewOffers: CrewOffer[]; carry: { memberId: MemberId; activityId: string; until: number }[];
    lastPlannedAt: [MemberId, number][]; lastRunDay: string; again: [string, number][]; counters: ConsentNetwork["plansCounters"];
  };
  fraud?: FraudItem[]; fraudSeq?: number;
  /** Reports about members (added later; older states have none). */
  reports?: (SafetyReport & { met: boolean })[]; reportSeq?: number;
  /** Engine exposure debt carried between runs (added later; older states have none). */
  exposureDebt?: Record<MemberId, number>;
  /** Private estimates and their authorized basis, kept inside the state store. */
  memberStanding?: readonly MemberStandingRow[];
  relay?: RelayState;
  venues?: VenueManagerState;
  meetups?: MeetupCoordState;
  teenStop?: unknown;
  flagged?: [string, { reason: JudgeReasonCode; at: number }][];
}

type MemberRecord = WorldSnapshot["members"][number] & { accountStatus?: string; minorSignalAt?: number; maturedSignup?: boolean };
export function storedTeenStop(st: unknown): boolean {
  return !!st && typeof st === "object" && Object.hasOwn(st, "teenStop");
}

function parseTeenStop(st: NetworkState): { by: string; at: number } | undefined {
  if (!storedTeenStop(st)) return undefined;
  const stop = st.teenStop;
  const record = typeof stop === "object" && stop !== null ? stop as { by?: unknown; at?: unknown } : {};
  return {
    by: typeof record.by === "string" && record.by.trim() ? record.by : "unknown",
    at: typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0,
  };
}

interface TeenShapeItem {
  id: string; origin: Origin; category: Category; generator: string; lane?: MatchLane;
  participants: readonly MemberId[]; alternates: readonly MemberId[]; plan?: plans.Plan;
  seat?: unknown; publicEventRevision?: string; anchorWindow?: unknown; fixedVenue?: unknown;
  replacementFor?: string; fallbackOf?: string; repeatFrom?: string; gatheringRepeat?: unknown;
  format?: Format; via?: MemberId; roles?: Readonly<Record<MemberId, string>>; anchor?: { type: string };
}

export function teenRosterWithHost(o: { participants: readonly MemberId[]; alternates: readonly MemberId[]; plan?: { hostId?: MemberId } }): MemberId[] {
  return [...new Set([...o.participants, ...o.alternates, ...(o.plan?.hostId ? [o.plan.hostId] : [])])];
}

export function teenMeetingEndOf(o: { meetingAt?: number; plan?: Pick<plans.Plan, "window" | "reviewedOptions"> }, now: number): number {
  if (o.plan) return Math.max(o.plan.window.end, ...(o.plan.reviewedOptions ?? []).map(slot => slot.end));
  return o.meetingAt !== undefined ? o.meetingAt + teenMeetingMs : now + teenOpenItemHorizonMs;
}

export function planCatalogPlace(plan: Pick<plans.Plan, "venueId" | "activityId"> & { city?: string }): boolean {
  const city = isCity(plan.city) ? plan.city : undefined;
  const venue = (city ? planVenuesForCity(city) : PLAN_VENUES).find(v => v.id === plan.venueId)
    ?? (city ? undefined : (["sf", "la", "chicago", "miami"] as const).flatMap(c => planVenuesForCity(c)).find(v => v.id === plan.venueId));
  const activity = plans.activityById.get(plan.activityId);
  return !!venue && !!activity && venue.activities.includes(plan.activityId)
    && teenPlaceAllowed(true, true, plans.activityAllAges(activity), plans.venueAllAges(venue));
}

export function teenStoredItemShape(app: string, o: TeenShapeItem): boolean {
  const plan = o.plan;
  const format: string | undefined = plan ? (plan.partner ? "one_to_one" : "small_group") : o.origin === "request" ? "one_to_one" : o.format;
  const roleOf = (id: MemberId) => (plan ? (plan.hostId === id ? "host" : "guest") : o.origin === "request" ? "peer" : o.roles?.[id]);
  const everyRoleTeen = teenRosterWithHost(o).every(id => { const role = roleOf(id); return role !== undefined && teenFriendRole(role); });
  return !o.seat && !o.publicEventRevision && !o.anchorWindow && !o.fixedVenue && !o.replacementFor && !o.fallbackOf && !o.repeatFrom
    && !o.id.startsWith(gatheringRepeatOppPrefix) && o.gatheringRepeat === undefined && o.lane !== "Cofounder"
    && (o.lane === undefined || teenFriendLane(app, o.lane)) && teenFriendCategory(app, o.category) && teenGenerator(app, o.generator)
    && (plan ? teenGroupPlanApp(app) && planCatalogPlace(plan) : o.origin === "engine" || o.origin === "request")
    && format !== undefined && teenIntroShape(true, format, everyRoleTeen, o.via !== undefined, o.anchor?.type === "event");
}

function formatOf(x: unknown): Format | undefined {
  return x === "one_to_one" || x === "small_group" || x === "event" ? x : undefined;
}

function minorSignalOf(x: WorldSnapshot["members"][number]): Pick<MemberRecord, "minorSignalAt"> {
  return "minorSignalAt" in x && typeof x.minorSignalAt === "number" ? { minorSignalAt: x.minorSignalAt } : {};
}

function statedAgeOn(m: Pick<MemberState, "statedAge" | "statedAgeDay">, day: number): number | undefined {
  return m.statedAge === undefined || m.statedAgeDay === undefined ? m.statedAge : statedAgeNow(m.statedAge, m.statedAgeDay, day);
}

function recordMinorSignalOpen(r: Pick<MemberRecord, "minorSignalAt">, m?: Pick<MemberState, "minorClearedAt">): boolean {
  return personMinorSignalOpen(r.minorSignalAt !== undefined, r.minorSignalAt ?? 0, m?.minorClearedAt !== undefined, m?.minorClearedAt ?? 0);
}
interface SnapshotRows { snap: WorldSnapshot; byId: Map<MemberId, MemberRecord>; presence: Map<MemberId, Presence[]>; facets: Map<MemberId, Facet[]> }
/** An engine proposal, routed to a seat's hiring manager when it was for a job seat (seatRoute). */
type SeatProposal = EngineProposal & { seat?: HireSeat };

function interestLabel(tag: string) { return INTERESTS.find(i => i.tag === tag)?.label ?? tag.replace(/_/g, " "); }
function skillLabel(tag: string) { const l = SKILLS.find(s => s.tag === tag)?.label ?? tag; return l; }
const GOOD_FIT = "it seemed like a good fit";
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "plays guitar" -> "they play guitar"; "ML engineer" -> "they're an ML engineer" (the sim's own first-person form, in the third person). */
export function theySkill(tag: string): string { return skillFirstPerson(tag).replace(/^I'm /, "they're ").replace(/^I /, "they "); }
/**
 * What the opportunity is, in plain words, for probes: the activity only, never a fact about the
 * other person (D5 allows at most one, and that one is the probe's reason). An engine theme ("Intro:
 * rock_music", "Small group: climate tech") is a fact about the others, so it is left out and the
 * probe uses the category's generic activity. An event keeps its title ("going to Jazz Night").
 */
function detailOf(p: Proposal): string {
  const raw = (p.objective ?? "").trim();
  const event = /^(?:go together:|small crew for|see each other again at)\s*(.+)$/i.exec(raw);
  if (event && !/_/.test(event[1]!)) return `going to ${event[1]!.trim()}`;
  if (p.kind === "group") return "a small group meetup";
  if (p.kind === "help") return "helping someone out with a quick favor";
  if (p.kind === "newcomer_welcome") return "a welcome coffee";
  // Themes and engine labels: a fact about the others, a taxonomy tag, or a question. Not an activity.
  if (/^([a-z -]+ intro|intro|small group|try something new|help with|know)\b|\baround\b|^proposed\b|_|\?|:/i.test(raw)) return "";
  const obj = raw.toLowerCase();
  if (!obj || obj.length >= 60 || INTERESTS.some(i => i.tag === obj || i.label.toLowerCase() === obj)) return "";
  return obj.replace(/^(meet|find) /, "meeting ");
}

export type { WorldSnapshot };
