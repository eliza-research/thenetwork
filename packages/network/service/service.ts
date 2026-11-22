import { PROFILE_REVIEW_WITHDRAWAL_PATH, parseProfileReviewWithdrawalProof } from "../../core/src/svc/profile-review-withdrawal.ts";
import { profileSuggestionWithdrawalEndpoint } from "./profile-suggestion-withdrawal-endpoint.ts";
import type { SuggestionWithdrawalOwnerResolver } from "./profile-review-factory.ts";
import { PROFILE_REVIEW_DISCONNECT_PATH, parseProfileReviewDisconnectProof } from "../../core/src/svc/profile-review-disconnect.ts";
import { profileSuggestionDisconnectEndpoint, type SuggestionRevokedOwnerResolver } from "./profile-suggestion-disconnect-endpoint.ts";
// The production runtime of the Network for every app (README.md in this folder; platform plan 4.4, 6.1).
//  - One process holds one NetworkRuntime per row of platform.networks ('<app>:<city>'). Each runtime
//    ticks and handles units of work under its own PgStore advisory lock (runtime.ts).
//  - Inbound (Blooio webhooks, signed): /webhooks/blooio is the one line for every app
//    (BLOOIO_WEBHOOK_SECRET; founder decision 2): a row in platform.app_lines for the receiving line
//    names the app; otherwise the whole first message routes by keyword ("slop", "slop.date",
//    "friends.help", ...), then a member's open item, then the app that wrote last. With no keyword a
//    stranger joins The Network: first name and age, then "what are you looking for?" (friends,
//    dating, work), which enrolls them in the matching apps, each age-checked.
//    /webhooks/blooio/:app is an app's own line, if one ever gets one (<APP>_BLOOIO_WEBHOOK_SECRET).
//  - Phone -> person -> membership -> member id. Joins are 13+ on every app; minors are never matched.
//    Nothing is stored until the age check passes (a refused age goes to the phone's age floor only).
//    Responses never say whether the phone uses another app.
//  - Text flows that wait for the person's next message (a join, "what are you looking for?", the
//    SHARE offer) are in platform.pending_texts, so a restart or a second instance keeps them.
//  - STOP (and the reasonable-means phrasings) stops every app on the line; "leave <app>" leaves that
//    app only (the forget path). Both go through the platform consent ledger, once per message.
//  - An age the person states in chat lowers the person's age on every app: a minor anywhere is a
//    minor everywhere, and under 13 removes every membership.
//  - The platform public API (packages/platform createPublicApi) with hooks into the networks:
//    publicFetch, served on PLATFORM_API_PORT (main.ts).
//  - Staff API: role tokens per app ("reviewer@slop:<t>"; NETWORK_SERVICE_TOKENS), ?app= or
//    /apps/:app/..., each action audited. The review mode is never exposed: production is "human" only.
//  - Sends: each app's adapter (dry-run by default; Blooio needs the per-app live flag too) after a
//    person-level cap of proactive messages across apps (default 3 a day).
import { createHash, createSecretKey, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { isDeepStrictEqual } from "node:util";
import { DAY, LLMBudget, RealClock, recommenderLLM, type Clock, type City, type Intent, type MemberId } from "@thenetwork/core";
import { storedInviterCurrent, type ActionResult, type NetworkOptions, type NetworkState, type ReviewDecision, type ReviewOptions } from "../src/network.ts";
import { brandOf, copy as ntwrkCopy, copyFor, ELIZA_NOTICE, type Copy } from "../src/copy.ts";
import { personDailyCap } from "../../core/src/generated/outreachPolicy.ts";
import { personMinorSignalEndsEverywhere } from "../../core/src/generated/safetyCase.ts";
import { inboundMayCommand } from "../../core/src/generated/postingPolicy.ts";
import { inboundBody } from "../../core/src/generated/mcpProfileSubmission.ts";
import {
  carryTrustHoldOnAppLeave, durableStaffHoldLiftAllowed, durableStaffHoldScope, initial as initialStaffSafety, staffAgeAppCleared, staffAgeClearSummary, staffAgeMayReviewReports,
  staffMinorReportDismissible, staffSafetyActionReach, staffSafetyAuditScope, staffSafetyMembershipLive, staffSafetyReportFor, staffSafetySelectsTarget,
  step as stepStaffSafety,
} from "../../core/src/generated/staffSafetyService.ts";
import { checkStaffHoldProjection, currentStaffHold, liftStaffHold, recordCarriedTrustHold, recordStaffHold, StaffHoldStateChanged } from "./staff-safety-holds.ts";
import { archivedReportSubject, carryReportRestrictions, dismissReportRestriction, holdFromArchivedReport } from "./report-safety-carryover.ts";
import { inboxKeepMs, platformKeepMs, stopHintWindowMs } from "../../core/src/generated/platformRetention.ts";
import { stopCoversEveryApp } from "../../core/src/generated/sharedLineConsentJourney.ts";
import { standingIntentReplayAllowed } from "../../core/src/generated/standingIntentManagement.ts";
import { canSaveCofounderIntent, cofounderIntentBlocksNew } from "../../core/src/generated/cofounderIntent.ts";
import { standingIntentPhaseAt } from "../../core/src/standing-intent.ts";
import { homeHelpOfferChangeAllowed } from "../../core/src/generated/boundedHelp.ts";
import { projectInvitationWelcome, projectRemoteInvitationNotice } from "../../core/src/generated/invitationJoinProjection.ts";
import { forgetEndsAppAccess, profileAgeCounts, publicSignupUsesBrowser } from "../../core/src/generated/siteEnrollment.ts";
import { ageAnswer, agesStated, classify } from "../src/classify.ts";
import { standingIntentCommand } from "../src/standing-intents.ts";
import { contributionHistoryReply, contributionHistoryRequest } from "./contribution-history.ts";
import { contributionHistoryReplayAllowed } from "../../core/src/generated/contributionHistory.ts";
import { saveTravelPresence, travelOwner, travelPresenceCommand } from "./travel-presence.ts";
import { soloReplyReplayAllowed } from "../../core/src/generated/soloConcierge.ts";
import { soloConciergeReply, soloConciergeRequest } from "./solo-concierge.ts";
import { NetworkRuntime, type RuntimeHost, type StagedMemberInvitation } from "./runtime.ts";
import { isMemberInvitationLink, memberInvitationLink, type InviteRelationship, type MemberInviteEvidence, type MemberInviteRequest } from "../src/invitation.ts";
import { effectiveParticipation, automatedFacetPredicate } from "./snapshot.ts";
import { ProfileSuggestions, type SuggestionAuthorization } from "./profile-suggestions.ts";
import { profileReviewFromEnv } from "./profile-review-factory.ts";
import { profileReadRequest, savedProfileText } from "./profile-read.ts";
import { step as stepProfileRead } from "../../core/src/generated/savedProfileRead.ts";
import { profileFactEditMayRead, profileFactEditMayReplay } from "../../core/src/generated/profileFactEdit.ts";
import { memberCommandOwner } from "./member-command.ts";
import { participationCommand, saveParticipationControl } from "./participation-controls.ts";
import { agentSignalsOpenCase, handleAgentSignalReview, parseAgentSignals, recordAgentSignals } from "./agent-signals.ts";
import { turnWatchMetrics } from "./turn-watch.ts";
import { MEMBER_FACT_PAGE_SIZE, memberFactCommand, memberFactEditPrompt, memberFactListText, memberFactReply, type MemberFactCommand } from "./member-fact-command.ts";
import { ProfileFactEdits } from "./profile-fact-edits.ts";
import { receiptAccepted } from "../../core/src/generated/turnReceipt.ts";
import { collectedReplyMayLeave, directReplyCollectable, openReplayAnswer, storedReplyAdmitted } from "../../core/src/generated/signedInbox.ts";
import { openTurnAnswer, unavailableReplySent } from "../../core/src/generated/sharedContext.ts";
import { recordSignedTurnReceipt } from "../../core/src/vibe/turnReceiptShell.js";
import {
  checkExplicitRoute, checkFallbackRoute, firstContactMayCheckAge, firstContactNoticeAllowed, initial as textJoinInitial, initialRoute,
  namedOtherApp, networkEnrollmentAllowed, otherAppAllowed, otherAppEnrollment, pendingMatchesApp, preparedPeonTextNamesApp, shouldReadLookingFor,
  sendAgeDecline, shouldReadPendingAnswer, step as stepTextJoin, textJoinKeepsMemberId, type JoinMembership,
} from "../../core/src/generated/textEnrollment.ts";
import { checkLineAge, checkLineBan, checkLineInviteDecline, checkLineNumberHold, initial as lineGateStart, leaveReply, lineHeldNumberGetsHelp, lineNumberHoldReadNeeded, readLineCommand, safetyAnswerClaims, safetyAppReadNeeded, safetyClaimLeads, safetyCommandClaims, safetyRouteReadNeeded, type LineCommand } from "../../core/src/generated/lineRouting.ts";
import { Inbox, type CollectedReply, type AtomicReplyReason } from "./inbox.ts";
import { staffDecideInvitationReview, staffInvitationReviewQueue } from "./invitation-review.ts";
import { auditSeedInvitationBatch, seedInvitationBatch } from "./seed-invitation-route.ts";
import { ExpectedMemberInvitations } from "./expected-invitation-store.ts";
import { expectedInviteTransportAllows } from "../../core/src/generated/expectedMemberInvitation.ts";
import { memberInviteHeldLinkMayRelease } from "../../core/src/generated/memberInvitation.ts";
import { memberInviteDeliveryCommand, memberInviteDeliveryPrompt, memberInviteDeliveryPromptCode, memberInviteDeliveryReply, type MemberInviteDeliveryCommand } from "./member-invite-delivery-command.ts";
import { calendarInviteRequest, calendarReplyCurrent, issueCalendarInvite, requestedCalendarFile } from "./calendar-invite.ts";
import { queueReviewedGatheringInvitations } from "./monthly-gathering-delivery.ts";
import { gatheringFollowupCommand, gatheringFollowupReplyCurrent, gatheringFollowupRequested, saveGatheringFollowup } from "./monthly-gathering-followup.ts";
import { handleMonthlyGatheringGrouping } from "./monthly-gathering-grouping.ts";
import { handleMonthlyGatheringInvitationReview } from "./monthly-gathering-invitation-review.ts";
import { queueGatheringNotices } from "./monthly-gathering-notices.ts";
import { eligibleGatheringInvitees, readGatheringInvitees } from "./monthly-gathering-priority.ts";
import { handleMonthlyGatherings } from "./monthly-gatherings.ts";
import { gatheringRsvpCommand, gatheringRsvpReplyCurrent, gatheringRsvpRoster, rankGatheringInvitees, saveGatheringRsvp } from "./monthly-gathering-rsvp.ts";
import { calendarPreferenceCommand } from "../../core/src/calendar-free-busy.ts";
import { calendarOwnerPath } from "../../core/src/generated/calendarFreeBusy.ts";
import type { CalendarOwnerRequest, CalendarSchedulingOwner } from "../../core/src/svc/calendar-scheduling.ts";
import { calendarSchedulingBridgeFromEnv, type CalendarSchedulingBridge } from "./calendar-scheduling.ts";
import { BOUNDED_HOME_HELP_CLARIFICATION, boundedHomeHelpCommand, boundedHomeHelpDraft, type BoundedHomeHelpCommand } from "./bounded-home-help-intake.ts";
import { boundedHomeHelpSenderCurrent, createBoundedHomeHelpAuthority } from "./bounded-home-help-authority.ts";
import { handleBoundedHomeHelpStaff, writeBoundedHomeHelpStaffAudit } from "./bounded-home-help-staff.ts";
import { handlePrivacyStaff, replayPrivacyAtStart } from "./privacy-staff.ts";
import { BOUNDED_HOME_HELP_CONSENT_CLARIFICATION, boundedHomeHelpConsentCard, boundedHomeHelpConsentCommand,
  boundedHomeHelpConsentReply, homeHelpPlanCode, homeHelpPlanId, type BoundedHomeHelpConsentCommand } from "./bounded-home-help-consent-command.ts";
import { queueReviewedHomeHelp, reconcileHomeHelpDelivery, stageApprovedHomeHelp } from "./bounded-home-help-delivery.ts";
import { homeHelpAddressReply } from "./bounded-home-help-address.ts";
import { BoundedHomeHelp } from "../src/bounded-help.ts";
import { BoundedHomeHelpConsent, type HomeHelpConsentKey } from "../src/bounded-home-help-consent.ts";
import { BoundedHomeHelpVenue } from "../src/bounded-home-help-venue.ts";
import { networkRoutePolicy, routeEnvelopeAllowed, sameNetworkAuthority, type NetworkRoutePolicy } from "./route-authority.ts";
import { TURN_PATH, TURN_RECEIPT_PATH, SET_STATE_PATH, SIGNALS_PATH, UPDATES_PATH, RELAY_PHOTO_RESOLVE_PATH, parseApprovedRelayPhotos, type SetStateRequest, type TurnReceiptRequest, type TurnRequest, type TurnResponse } from "../../core/src/svc/contract.ts";
import { SVC_MIN_SECRET, svcVerify } from "../../core/src/svc/svc-auth.ts";
import { readCapped } from "../../platform/src/body.ts";
import { ADULT_AGE, canBeMatched, canJoin } from "../../core/src/policy.ts";
import { CostLedger, costRatesFromEnv, PgCostSink } from "./cost.ts";
import { networkMatchingAllowed } from "./matching-scope.ts";
import { BlooioAdapter, collectedReplyGuard, originalBookingNoticeStale, type ChannelAdapter, type DirectKind, type Outbound } from "./channel.ts";
import { peerOpportunityContactRestricted } from "./peer-opportunity-admission.ts";
import { parseRescheduleCommand, RESCHEDULE_QUEUE_PREFIX } from "../src/rescheduling.ts";
import { interruptionFeedbackAnswer } from "../src/interruption-feedback.ts";
import { APPS, isAppId, keywordApp, lookingFor, POWERED_BY, stagingSiteOrigins, type AppId, type AppInfo } from "../../platform/src/apps.ts";
import { Accounts, homeCityOf, joinProfileText, JoinReviewRequired, type AccountHooks, type EnrollmentReferral, type HomeInput, type JoinHookContext, type MemberHookContext, type Who } from "../../platform/src/accounts.ts";
import {
  consumeMemberInvitation, findApprovedMemberInvitationReview, findMemberInvitation, holdMemberInvitation, InvitationUnavailable,
  memberInvitationHash, memberInvitationReviewId, memberInvitationReviewStatus, newMemberInvitation, purgeExpiredMemberInvitationReviews,
  releaseMemberInvitationReview, storeMemberInvitation, type ReferralJoin,
} from "../../platform/src/invite-links.ts";
import { SeedInvitations } from "../../platform/src/seed-invitations.ts";
import { canJoinApp, joinAgeCheck, lowestAge } from "../../platform/src/age.ts";
import { detectKeyword as platformKeyword, keywordEvent, leaveTarget, type Keyword, resolveConsent, stopScope, type StopScope } from "../../platform/src/consent.ts";
import { devShortcutsAllowed, isProduction, platformEnv, type Env } from "../../platform/src/env.ts";
import { keyedHash, maskPhone, normalizePhone, safeEqual } from "../../platform/src/phone.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import { confirmedUnderage } from "../../core/src/generated/memberAge.ts";
import type { Membership, PeopleStore, PendingText, Person } from "../../platform/src/store.ts";
import { createPublicApi, type HomeHelpVenueRequest, type MemberParticipation, type PublicApi, type PublicApiOptions } from "../../platform/src/api.ts";
import { otpProviderFromEnv } from "../../platform/src/otp.ts";
import { turnstileFromEnv } from "../../platform/src/turnstile.ts";
import type { PeerInfo } from "../../platform/src/api.ts";
import { PHOTO_APPS, PgPhotoStore, PhotoService, photoStorageFromEnv, type PhotoRater, type PhotoRefusal, type PhotoStorage } from "../../platform/src/photos.ts";
import { PhotoRelayService, PgPhotoRelayStore, type PhotoRelayPolicy, type PhotoRelayItem } from "../../platform/src/photo-relay.ts";
import { PhotoUploadLinks } from "../../platform/src/photo-upload-link.ts";
import { APPEARANCE_PREFIX, appearanceFacet, type AppearanceScore, type RatingSubject } from "../../engine/src/packs/slop/appearance.ts";
import { memberExportFacetAllowed, memberExportGatheringsAllowed } from "../../core/src/generated/accountPrivacy.ts";
import { fetchMediaCapped, PhotoIntake, type PhotoIntakeDeps } from "./photoIntake.ts";
import { sweepPhotos } from "./photoSweep.ts";
import { choosePhoto, expirePendingPhotos, withdrawPhoto } from "./photoIntakeRelayChoice.ts";
import { biasAlerts, biasReport, type BiasMember, type StoredBiasReport } from "./bias.ts";
import { weeklyBiasDue } from "../../core/src/generated/weeklyBias.ts";
import { DEFAULT_SLA_HOURS } from "../../observatory/src/apps.ts";
import { waitExceedsSla } from "../../core/src/generated/operationsTiming.ts";
import { applyBaseProfileGrants } from "./base-profile-share.ts";
import { unshareRevokesGrant } from "../../core/src/generated/baseProfileShare.ts";
import type { Ban } from "../../platform/src/store.ts";
import { parseBlooioWebhook, SIGNATURE_HEADER, verifyBlooioSignature } from "../../blooio/src/blooio/webhook.ts";
import { normalizeAddress } from "../../blooio/src/phone.ts";
import { gatewayReceiptMoves, type QueueRow } from "../../blooio/src/outbound-queue.ts";
import { resolveTimeZone } from "../../blooio/src/quiet-hours.ts";
import { Notifier, type InboxItem, type NotifyStore, type OutboundSink, type Recipient, type Surface } from "../../notify/src/index.ts";
import { PgNotifyStore } from "../../notify/src/pg-store.ts";
import { type ConnectorUpdateOutcome, connectorUpdateMarkedSeen, connectorUpdateOutcome } from "../../core/src/generated/connectorTools.ts";
import { passesOutputGate } from "../../mcp/src/leaks.ts";
import {
  appAllowsInboxItem, inboxOpportunityAllowsUpdate, mayShowThreadUpdate, networkTextCanProduceInboxItem,
  networkTextProjection, networkTextSummaryLimit, threadUpdatePageSize,
} from "../../core/src/generated/notificationAcknowledgement.ts";
import { threadUpdateBody, threadUpdateReceipt, threadUpdateReplyId, threadUpdateRequested, unpreviewedThreadUpdates } from "./thread-updates.ts";
import { LEARNING_CONSENT_CONTEXT_PATH } from "../../core/src/svc/learning-consent-context.ts";
import { learningConsentContextEndpoint } from "./learning-consent-context-endpoint.ts";
import { SUGGESTION_PATH, profileSuggestionEndpoint, type SuggestionIdentityResolver } from "./profile-suggestion-endpoint.ts";
import { RELAY_PATH, RELAY_PHOTO_RESOLVE_MAX_BODY_BYTES, relayClassifierFromEnv, relayEndpoint } from "./relay-endpoint.ts";
import { jobPostingRoutes } from "./postings.ts";
import { applyPeonSearchCommand, namesPeonSearch, peonSearchCommand, peonSearchReplyCurrent, purgePeonSearchDrafts } from "./peon-candidate-search.ts";
import type { RelayClassifierHook } from "../../engine/src/relay.ts";
import type { ChannelEvent } from "../../blooio/src/types.ts";
// The Observatory's staff auth (per-app role grants) and audit sink, so the console and the service agree.
import { allowed, authenticate, hasEverywhere, parseTokenGrants, PgAudit, type AuditSink } from "../../observatory/src/staff.ts";
import { serviceStaffStep } from "../../observatory/src/staffSteps.ts";
import { staffStepActorAccepted, type StepActor } from "../../core/src/generated/staffPermissions.ts";
import type { AuditEntry, RoleGrant, StaffRole, StaffUser } from "../../observatory/src/types.ts";

/** The homes a conversation can have; each belongs to exactly one network of an app (runtimeForHome). */
const CONVERSATION_CITIES: readonly City[] = ["nyc", "sf", "la"];

export { NetworkRuntime } from "./runtime.ts";
type Row = Record<string, unknown>;
const MAX_BODY_BYTES = 256 * 1024;
/** The fixed answer when a member's conversation context is unavailable (spec/sharedContext.md). */
export const CONTEXT_UNAVAILABLE_REPLY = "Sorry, I can't help with that right now. Please try again later.";
export const WEBHOOK_PATH = "/webhooks/blooio";
/**
 * STOP, START, HELP and "leave <app>" have one owner: this service, inside the signed turn
 * (POST /internal/turn) or the legacy webhook. The handled turn reports the change as `consent`, and the
 * Eliza gateway mirrors it into its send-time fence. STOP_HELP_OWNER and POST /consent/gateway are
 * retired (the upstream gateway never called that route); a value left in the environment is ignored.
 */
export const RETIRED_ENV = ["STOP_HELP_OWNER", "STOP_HELP_GATEWAY_SECRET"] as const;
/**
 * The turn secret (SERVICE_TURN_SECRET) is checked at start: the turn path is on when the secret is set
 * or the Cloud channel is asked for, and then the secret must have at least SVC_MIN_SECRET characters.
 * Returns the problem, or undefined.
 */
export function turnSecretProblem(env: Record<string, string | undefined> = process.env): string | undefined {
  const secret = env.SERVICE_TURN_SECRET;
  const on = !!secret || env.NETWORK_CHANNEL === "eliza_cloud" || env.NETWORK_ROUTE_AUTHORITY_POLICY !== undefined;
  if (!on) return undefined;
  if (!secret || secret.length < SVC_MIN_SECRET) return `SERVICE_TURN_SECRET must have at least ${SVC_MIN_SECRET} characters when the turn path is on`;
  return undefined;
}
/** The tables the service needs (pnpm run db:migrate). */
const REQUIRED_TABLES = [
  ...["members", "channel_identities", "facets", "intents", "presence", "edges", "messages", "events", "matching_runs", "staff_audit", "network_state", "opportunities", "review_items", "requests", "bounded_home_help", "bounded_home_help_consent", "bounded_home_help_venue", "monthly_gatherings", "monthly_gathering_rsvps", "monthly_gathering_invitation_reviews", "monthly_gathering_invitees", "monthly_gathering_grouping_reviews", "monthly_gathering_group_members", "monthly_gathering_attendance", "monthly_gathering_followup_choices"].map(t => `network.${t}`),
  ...["apps", "networks", "people", "phone_identities", "memberships", "consent_events", "person_blocks", "staff_safety_holds", "report_safety_carryovers", "app_lines", "share_grants", "eliza_notices", "member_invitations", "member_invitation_reviews", "expected_member_invitations", "expected_invitation_contacts", "seed_invitation_batches", "seed_invitations", "seed_invitation_attributions", "profile_fact_edit_drafts", "calendar_invites"].map(t => `platform.${t}`),
];
/** The dev-only key for keyed phone hashes (the platform's own default). Production needs PLATFORM_HASH_KEY. */
const DEV_HASH_KEY = "dev-only-platform-hash-key";
/** Proactive messages one person gets a day, across every app (PRD 40.3). */
// spec/outreachPolicy.md, "The default daily proactive limit is three across all apps"
export const PERSON_DAILY_CAP = personDailyCap;
/** A pending text flow (a join, "what are you looking for?", a SHARE offer) is forgotten after a day. */
const PENDING_MS = DAY;
/**
 * The SMS disclosure in the question whose answer opts the person in to more apps (audit: the
 * looking-for consent stored a question with no frequency, rates or STOP; the web join needs them).
 */
const LOOKING_FOR_DISCLOSURE = "Each app you pick will text you about it. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help.";
/** The Network's question after a join with no keyword (founder decision 2). */
export const LOOKING_FOR_ASK = `What are you looking for: friends, dating, work, or all of these? You can pick more than one. ${LOOKING_FOR_DISCLOSURE} ${POWERED_BY}`;
/** The same question to a member aged 13-17: dating is never offered (slop is never enrolled from it). */
export const LOOKING_FOR_ASK_MINOR = `What are you looking for: friends, work, or both? ${LOOKING_FOR_DISCLOSURE} ${POWERED_BY}`;
export const lookingForAsk = (age: number | undefined) => (canBeMatched(age) ? LOOKING_FOR_ASK : LOOKING_FOR_ASK_MINOR);
const listApps = (apps: AppInfo[]) => apps.map(a => a.domain).join(apps.length === 2 ? " and " : ", ");
/** The Network's answer after it enrolled the person in the apps they named. */
export const enrolledText = (apps: AppInfo[]) =>
  `Done: you're in ${listApps(apps)}. Text an app's name (like ${apps[0]!.domain}) to talk to it, or "leave ${apps[0]!.domain}" to leave one. ${POWERED_BY}`;
/** Safety on every app (safety@* or admin@*): what a hold on other apps and a ban need. */
const crossAppSafety = (u: StaffUser) => hasEverywhere(u, "safety") || hasEverywhere(u, "admin");
/** Staff review actions the API takes, and the reason codes (PRD 32.8 and the per-app lists). */
const DECISIONS = new Set(["approve", "reject", "edit", "reroll"]);
/** A reviewer's time on one item is clamped to an hour (audit observatory-10). */
const MAX_REVIEW_SECONDS = 3600;

/** One network the service runs: platform.networks.id ('<app>:<city>') and whether matching may run. */
export interface NetworkSpec { id: string; matchingEnabled?: boolean }

export interface ServiceOptions {
  /** Optional trusted source-consent check; imports and promotions default to denied. */
  profileSuggestionIdentity?: SuggestionIdentityResolver;
  /** Test or host transport for the separately configured calendar authority. */
  calendarFreeBusyFetch?: typeof fetch;
  profileSuggestionAuthorization?: SuggestionAuthorization;
  profileSuggestionRevokedOwner?: SuggestionRevokedOwnerResolver;
  profileSuggestionWithdrawalOwner?: SuggestionWithdrawalOwnerResolver;
  /** Postgres with the `network` and `platform` schemas (a login that can read and write them). */
  url: string;
  /** The networks to run (platform.networks rows; NetworkService.fromDatabase reads them). Default: one, `id`. */
  networks?: NetworkSpec[];
  /** One network when `networks` is not given (default "ntwrk:nyc"; a legacy id "nyc" is "ntwrk:nyc"). */
  id?: string;
  /** App policy (platform.apps rows). Default: the registry in packages/platform apps.ts. */
  apps?: Record<AppId, AppInfo>;
  clock?: Clock;
  /** Default: DryRunAdapter per network. A function is called once per network. */
  adapter?: ChannelAdapter | ((net: NetworkRuntime["net"], rt: NetworkRuntime) => ChannelAdapter);
  /** Names this instance in pg_stat_activity (the lock holder in /health). */
  instance?: string;
  /** ConsentNetwork options for every network. `review` must be "human". A new stored state starts with matching off unless `matchingEnabled` is set. */
  network?: Omit<NetworkOptions, "store" | "onEngineRun" | "app">;
  /** Staff tokens: "admin:<t>,reviewer@slop:<t>,..." (NETWORK_SERVICE_TOKENS). A role with no app is for every app. Without them every staff route answers 401. */
  tokens?: string;
  /**
   * The admin console's own token (NETWORK_SERVICE_CONSOLE_TOKEN; also one of `tokens`). Only a request
   * with it may name the signed-in person in X-Network-Staff-Id; that person is then the reviewer of
   * record in the audit and the review. The header from any other token is ignored.
   */
  consoleToken?: string;
  /** The shared line's webhook secret (BLOOIO_WEBHOOK_SECRET). Without it /webhooks/blooio answers 503. */
  webhookSecret?: string;
  /** One app's line: /webhooks/blooio/<app> with <APP>_BLOOIO_WEBHOOK_SECRET. Without a secret that path answers 503. */
  webhookSecrets?: Partial<Record<AppId, string>>;
  /** network.staff_audit sink. Default: PgAudit on `auditUrl` or `url`. */
  audit?: AuditSink;
  auditUrl?: string;
  /** People, phones, memberships and consent. Default: PgPeopleStore on `url`. */
  people?: PeopleStore;
  /** Proactive messages a person gets a day across all apps (default 3; 0 turns the cap off). */
  personDailyCap?: number;
  /** Options for the public API (publicFetch). OTP defaults to OTP_PROVIDER (dev console outside production). */
  publicApi?: Partial<Pick<PublicApiOptions, "otp" | "turnstile" | "hostMap" | "trustForwardedHost" | "minStartMs" | "minVerifyMs" | "otpLimits" | "demo" | "ipOf" | "cloudAuthFetch">>;
  /** PLATFORM_STOP_SCOPE, PLATFORM_HASH_KEY, NODE_ENV/PLATFORM_ENV. Default process.env. */
  env?: Env;
  /** Photo storage (platform photos.ts). Default: PHOTO_STORAGE from the environment; null turns photos off. */
  photoStorage?: PhotoStorage | null;
  /** Explicit approved per-item notice/reviewer authority. Ordinary runtime leaves this absent. */
  photoRelayPolicy?: PhotoRelayPolicy;
  /** Fixed public backend origin of selected-item capability fetches, never a model URL. */
  photoDeliveryOrigin?: string;
  /** The relay classifier (a trusted test or simulation boundary). Default: relayClassifierFromEnv (Clef when configured, else rules only). */
  relayClassifier?: RelayClassifierHook;
  /** The appearance rater (server.ts: makeClefRaterFromEnv behind withRetry). Undefined: ratings are off; photos still work. */
  photoRater?: PhotoRater;
  /** Fetch one attachment of a photo sent by text (default: https only, capped; photoIntake.ts). The simulation passes a fake. */
  fetchMedia?: PhotoIntakeDeps["fetchMedia"];
  /** The origin staff photo links use (PHOTO_VIEW_BASE_URL). Default: https://<the app's domain>, which the site router forwards to /api/*. */
  photoBaseUrl?: string;
  /**
   * Networks whose stored matching switch starts ON when no state is stored yet (dev only; refused
   * outside PLATFORM_ENV=dev). Production starts every network off: an admin turns it on in the console.
   */
  devMatching?: string[];
  /**
   * The single inbox (packages/notify; entry-flows doc 5). Default: PgNotifyStore on `url` (schema
   * `notify`, migration 9002). false turns it off. Every member-facing send that went out is recorded
   * (already delivered, never texted again); assistants read it through the MCP get_updates tool.
   */
  notify?: NotifyStore | false;
  log?: (line: string) => void;
}

/** Member-facing Network sends that become inbox items (meta.type of ConsentNetwork.send). */

export type InboundOutcome =
  | "open" | "handled" | "duplicate" | "unknown_sender" | "ignored" | "ignored_group" | "status" | "reaction" | "safety"
  | "invite_only" | "join_asked" | "joined" | "under_age" | "stopped" | "left" | "no_network" | "held" | "standing_intents" | "travel_presence" | "solo_events" | "contribution_history" | AtomicReplyReason;

interface Route { app: AppId; shared: boolean }

const lower = (s: string) => s.normalize("NFKC").toLowerCase();
/** The carrier keyword reading of a message (platformKeyword) as the line gate's command. */
const LINE_COMMAND: Record<Keyword | "none", LineCommand> = { none: "LineNoCommand", stop: "LineStop", stop_all: "LineStopAll", help: "LineHelp", start: "LineStart" };
/** Words that are never a first name in a join answer. */
const NOT_NAMES = new Set(["hi", "hey", "hello", "yo", "sup", "im", "i'm", "i", "am", "my", "name", "names", "name's", "is", "and", "age", "aged", "years", "year", "old", "yrs", "y", "o",
  "join", "start", "please", "pls", "the", "a", "in", "at", "from", "near", "live", "here", "there", "yes", "yeah", "no", "ok", "okay", "sure", "thanks", "thank", "you", "it's", "its",
  "this", "that", "what", "who", "so", "me", "call", "it", "network", "turning", "just", "turned"]);

/** Words that may stand next to a bare number in a join answer ("Hi, I'm Sam, 29"). Any other word makes the number not an age. */
const JOIN_FILLER = new Set(["hi", "hey", "hello", "yo", "im", "i'm", "i", "am", "my", "name", "names", "name's", "is", "and", "age", "aged", "years", "year", "old", "yrs", "y", "o",
  "it's", "its", "call", "me", "just", "turned", "turning", "join", "please", "pls"]);

const joinMembershipOf = (state: Membership["state"] | undefined): JoinMembership =>
  state === undefined ? "NoMembership" : state === "removed" ? "RemovedMembership" : state === "invited" ? "InvitedMembership" : "LiveMembership";

const bareJoinAge = (text: string, appWords: readonly string[]): number | undefined => {
  const nums = [...text.matchAll(/(?:^|[\s,.;:(])(\d{1,3})(?=$|[\s,.;:!)])/g)];
  const others = text.replace(/\d+/g, " ").replace(/[^\p{L}' ]+/gu, " ").split(/\s+/).filter(Boolean).map(lower)
    .filter(w => !JOIN_FILLER.has(w) && !appWords.includes(w));
  return nums.length === 1 && others.length <= 1 && !/\d[^\d\s,.;:!)]|[^\d\s,.;:(]\d/.test(text) ? Number(nums[0]![1]) : undefined;
};

const joinSuffixKind = (segment: string, head: string, appWords: readonly string[]): "home" | "filler" | undefined => {
  const words = segment.split(/\s+/).filter(Boolean).map(lower);
  const headAge = agesStated(head).age ?? ageAnswer(head) ?? bareJoinAge(head, appWords);
  if (/\d/.test(segment) || words.length === 0 || !words.every(w => /^\p{L}[\p{L}'.-]*$/u.test(w)) || headAge === undefined) return undefined;
  if (words.every(w => NOT_NAMES.has(w) || JOIN_FILLER.has(w) || appWords.includes(w))) return "filler";
  return ageAnswer(head) === undefined ? "home" : undefined;
};

/**
 * A join answer by text: an age ("29", "I'm 29", "Sam, 29") and, when `nameOk`, a first name. The
 * name is the first word that is not a filler word or the name of an app. A bare number is an age
 * only in a short answer: one name at most, and filler words ("Sam, 29", "Kim 16"). In a sentence
 * ("Sounds good, 7 works for me") it is not an age.
 */
export function parseJoinText(text: string, appWords: readonly string[], nameOk: boolean): { age?: number; name?: string; homeCity?: City; invalidHome?: boolean } {
  const t = text.normalize("NFKC").trim();
  const homes = [...t.matchAll(/(?:\b(?:my home(?: city)?(?: is| in|:)?|i live in|i am based in|i'm based in)|(?:^|[.!?;,]\s*)(?:home(?: city)?(?: is| in|:)?|based in))\s+([^.!?;,\n]+)/gi)];
  let nameText = homes.reduce((text, m) => text.replace(m[0], " "), t);
  // A reply such as "Ari, 29, San Francisco" explicitly names a home too.
  // Remove only a known, delimited city before the conservative bare-age check.
  const suffix = /[,;]\s*([^,;.!?\n]+)[.!?]?\s*$/.exec(nameText);
  const suffixCity = suffix ? homeCityOf(suffix[1]) : undefined;
  const head = suffix ? nameText.slice(0, suffix.index) : nameText;
  const suffixKind = suffix && !suffixCity ? joinSuffixKind(suffix[1]!, head, appWords) : undefined;
  const unknownSuffixHome = suffixKind === "home";
  if (suffixCity || suffixKind) nameText = head;
  const cities = [...homes.map(m => homeCityOf(m[1])), ...(suffixCity ? [suffixCity] : []), ...(unknownSuffixHome ? [undefined] : [])];
  const invalidHome = cities.some(c => !c) || new Set(cities).size > 1;
  const stated = agesStated(nameText);
  const ageOnly = ageAnswer(nameText);
  let age = stated.age ?? ageOnly;
  if (age === undefined) age = bareJoinAge(nameText, appWords);
  if (age !== undefined && !(age > 0 && age < 120)) age = undefined;
  if (!nameOk && age === undefined) return { ...(cities[0] ? { homeCity: cities[0] } : {}), ...(invalidHome ? { invalidHome: true } : {}) };
  const words = nameText.replace(/[^\p{L}' -]+/gu, " ").split(/[\s-]+/).filter(Boolean);
  const name = ageOnly === undefined ? words.find(w => /^\p{L}[\p{L}']{0,29}$/u.test(w) && !NOT_NAMES.has(lower(w)) && !appWords.includes(lower(w))) : undefined;
  return { ...(age !== undefined ? { age } : {}), ...(name ? { name: name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() } : {}), ...(cities[0] ? { homeCity: cities[0] } : {}), ...(invalidHome ? { invalidHome: true } : {}) };
}

class RouteAuthorityExpiredError extends Error {}

export class NetworkService implements RuntimeHost {
  readonly sql: SQL;
  readonly profileSuggestions: ProfileSuggestions;
  private readonly suggestionIdentity?: SuggestionIdentityResolver;
  private readonly suggestionAuthorization?: SuggestionAuthorization;
  private readonly suggestionRevokedOwner?: SuggestionRevokedOwnerResolver;
  private readonly suggestionWithdrawalOwner?: SuggestionWithdrawalOwnerResolver;
  readonly clock: Clock;
  readonly instance: string;
  readonly audit: AuditSink;
  /**
   * The relay classifier per app (relay-endpoint.ts): Clef when the Workers AI token and account are set,
   * else rules only (undefined). Each Clef call is a cost row for the app (cost.ts). Set at start.
   */
  private relayHookFor?: (app: AppId) => RelayClassifierHook;
  readonly apps: Record<AppId, AppInfo>;
  readonly people: PeopleStore;
  readonly accounts: Accounts;
  /** The single inbox and notification scheduler; undefined when turned off. */
  readonly notify?: Notifier;
  /** Address to (runtime, member) for the notify sink, filled by the notify directory. */
  private readonly notifyTargets = new Map<string, { rt: NetworkRuntime; memberId: MemberId }>();
  private notificationClaimSurfaces?: (tx: SQL, personId: string, phoneKey: string, app: string) => Promise<readonly Surface[]>;
  /** One runtime per network, in platform.networks order (ntwrk first). */
  readonly runtimes = new Map<string, NetworkRuntime>();
  readonly log: (line: string) => void;
  private readonly env: Env;
  private readonly tokens: Map<string, RoleGrant[]>;
  private readonly consoleToken?: string;
  private readonly secret?: string;
  private readonly secrets: Partial<Record<AppId, string>>;
  private readonly hashKey: string;
  private readonly expectedInvitations: ExpectedMemberInvitations;
  private readonly seedInvitations: SeedInvitations;
  private readonly profileFactEdits: ProfileFactEdits;
  private readonly homeHelpVenueKey: ReturnType<typeof createSecretKey>;
  /** The inbound inbox: one row per provider message, handled once and in order per sender (inbox.ts). */
  readonly inbox: Inbox;
  private readonly cap: number;
  private readonly apiOptions: ServiceOptions["publicApi"];
  private api?: PublicApi;
  private readonly copies = new Map<AppId, Copy>();
  private readonly forgetListeners: Array<(ctx: MemberHookContext) => Promise<unknown> | unknown> = [];
  private readonly accountEraseListeners: Array<(personId: string) => Promise<unknown> | unknown> = [];
  private readonly banListeners: Array<(phoneHashes: readonly string[]) => Promise<unknown> | unknown> = [];
  /** Private member photos (slop; verified adults only). */
  readonly photos: PhotoService;
  readonly photoRelay: PhotoRelayService;
  private readonly photoDeliveryOrigin?: string;
  /** Photos sent by text (photoIntake.ts). */
  readonly photoIntake: PhotoIntake;
  /** Single-use photo upload links (spec/photoUploadLink.md). */
  readonly photoLinks: PhotoUploadLinks;
  /** Review items already alerted for passing their app's SLA (this instance). */
  private readonly slaAlerted = new Set<string>();
  private readonly photoBaseUrl?: string;
  /** Estimated cost per event, per app and per day (cost.ts, network.cost_ledger): OTP codes, photo ratings, LLM calls. */
  readonly cost: CostLedger;

  private readonly relayClassifier?: RelayClassifierHook;

  private readonly routePolicy: NetworkRoutePolicy | undefined;
  private readonly calendarScheduling?: CalendarSchedulingBridge;

  constructor(o: ServiceOptions) {
    this.relayClassifier = o.relayClassifier;
    if (o.network?.review && o.network.review !== "human") throw new Error(`review mode "${o.network.review}" is refused: production review is "human" only (runbook-real 7.4)`);
    this.clock = o.clock ?? new RealClock();
    this.instance = o.instance ?? `${process.pid}`;
    this.log = o.log ?? console.log;
    this.env = o.env ?? process.env;
    this.routePolicy = networkRoutePolicy(this.env);
    this.calendarScheduling = this.routePolicy ? undefined : calendarSchedulingBridgeFromEnv(this.env, () => this.clock.now(), o.calendarFreeBusyFetch);
    this.secret = o.webhookSecret;
    this.consoleToken = o.consoleToken || undefined;
    this.secrets = o.webhookSecrets ?? {};
    this.cap = o.personDailyCap ?? PERSON_DAILY_CAP;
    const turnProblem = turnSecretProblem(this.env);
    if (turnProblem) throw new Error(turnProblem);
    for (const v of RETIRED_ENV) if (this.env[v]) this.log(`${v} is retired and ignored: STOP, START and HELP are answered inside the signed turn (README "The Eliza seam")`);
    this.apiOptions = o.publicApi;
    this.apps = o.apps ?? APPS;
    const key = this.env.PLATFORM_HASH_KEY ?? (devShortcutsAllowed(this.env) ? DEV_HASH_KEY : undefined);
    if (!key) throw new Error("PLATFORM_HASH_KEY is required in production and outside PLATFORM_ENV=dev");
    this.hashKey = key;
    this.expectedInvitations = new ExpectedMemberInvitations(key, () => this.clock.now(), app => this.apps[app]);
    this.seedInvitations = new SeedInvitations(key, () => this.clock.now());
    this.profileFactEdits = new ProfileFactEdits(key, () => this.clock.now());
    this.homeHelpVenueKey = createSecretKey(Buffer.from(hkdfSync("sha256", key, "thenetwork", "private-home-help-venue-v1", 32)));
    try { this.tokens = parseTokenGrants(o.tokens, { explicitApp: isProduction(this.env) }); } catch (e) { throw new Error(String((e as Error).message).replace("OBSERVATORY_TOKENS", "NETWORK_SERVICE_TOKENS")); }
    // Cloud holds the turn secret; it must never also be a staff bearer (PR #4: the agent credential was never the console token).
    const turnSecret = this.env.SERVICE_TURN_SECRET;
    if (turnSecret && [...this.tokens.keys(), ...(this.consoleToken ? [this.consoleToken] : [])].some(t => safeEqual(t, turnSecret))) {
      throw new Error("SERVICE_TURN_SECRET must differ from NETWORK_SERVICE_CONSOLE_TOKEN and every NETWORK_SERVICE_TOKENS token");
    }
    const calendarSecret = this.env.NETWORK_CALENDAR_FREE_BUSY_SECRET;
    if (this.calendarScheduling && calendarSecret && [...this.tokens.keys(), ...(this.consoleToken ? [this.consoleToken] : [])].some(t => safeEqual(t, calendarSecret)))
      throw new Error("NETWORK_CALENDAR_FREE_BUSY_SECRET must differ from console and staff tokens");
    const specs = o.networks?.length ? o.networks : [{ id: o.id ?? "ntwrk:nyc" }];
    // Each network's tick holds one connection for its advisory lock and needs more inside it: size the pool from the network count.
    this.sql = new SQL({ url: o.url, max: Math.max(8, 2 * specs.length + 4), connection: { application_name: `network-service:${this.instance}` } });
    const profileReview = profileReviewFromEnv(this.env, () => this.clock.now());
    this.suggestionIdentity = o.profileSuggestionIdentity ?? profileReview.profileSuggestionIdentity;
    this.suggestionAuthorization = o.profileSuggestionAuthorization ?? profileReview.profileSuggestionAuthorization;
    this.suggestionRevokedOwner = o.profileSuggestionRevokedOwner ?? profileReview.profileSuggestionRevokedOwner;
    this.suggestionWithdrawalOwner = o.profileSuggestionWithdrawalOwner ?? profileReview.profileSuggestionWithdrawalOwner;
    this.profileSuggestions = new ProfileSuggestions(this.sql, this.suggestionAuthorization ?? (async () => false));
    this.people = o.people ?? new PgPeopleStore(this.sql);
    this.cost = new CostLedger({ sink: new PgCostSink(this.sql), clock: this.clock, rates: costRatesFromEnv(this.env), log: this.log });
    // Opt-in only. One process-wide budget covers all apps and provider retries.
    const judgeOn = this.env.NETWORK_ENGINE_JUDGE === "1";
    const judgeUsd = Number(this.env.NETWORK_ENGINE_JUDGE_BUDGET_USD ?? 1);
    const judgeRequests = Number(this.env.NETWORK_ENGINE_JUDGE_MAX_REQUESTS ?? 100);
    if (judgeOn && (!Number.isFinite(judgeUsd) || judgeUsd <= 0 || !Number.isSafeInteger(judgeRequests) || judgeRequests <= 0))
      throw new Error("NETWORK_ENGINE_JUDGE needs a positive dollar budget and a positive integer request limit");
    const judgeBudget = judgeOn ? new LLMBudget({ maxCostMicro: judgeUsd * 1e6, maxRequests: judgeRequests }) : undefined;
    this.accounts = new Accounts(this.people, { hashKey: this.hashKey, now: () => this.clock.now(), env: this.env, apps: id => this.apps[id], hooks: this.hooks() });
    if (o.notify !== false) this.notify = new Notifier(o.notify ?? new PgNotifyStore(this.sql), { get: personId => this.notifyRecipient(personId) });
    const ids = specs.map(spec => (spec.id.includes(":") ? spec.id : `ntwrk:${spec.id}`));
    for (const [i, spec] of specs.entries()) {
      const id = ids[i]!;
      const [app, city] = id.split(":") as [string, string];
      if (!isAppId(app) || !this.apps[app]) throw new Error(`network ${id}: unknown app "${app}"`);
      // Dev only: the stored switch of these networks starts on (a new state); production always starts off.
      const devOn = (o.devMatching ?? []).includes(id);
      if (devOn && !devShortcutsAllowed(this.env)) throw new Error("devMatching is for PLATFORM_ENV=dev only: production matching is turned on by an admin in the console");
      const network = { ...o.network,
        ...(judgeBudget && !o.network?.engineLLM ? { engineLLM: recommenderLLM({ ...this.cost.llmHooks(app, "engine_judge"), budget: judgeBudget }) } : {}),
        ...(devOn ? { matchingEnabled: true } : {}),
      };
      // The homes this network owns (runtimeForHome): its own city, and for the app's first network
      // every home that no network of the app serves.
      const mine = ids.filter(x => x.split(":")[0] === app);
      const cities = CONVERSATION_CITIES.filter(c => (mine.find(x => x.split(":")[1] === c) ?? mine[0]) === id);
      this.runtimes.set(id, new NetworkRuntime(this, { id, app: this.apps[app], city, cities, matchingAllowed: networkMatchingAllowed(this.env, app, spec.matchingEnabled ?? true), network, calendarScheduling: this.calendarScheduling, adapter: o.adapter }));
    }
    this.photoBaseUrl = o.photoBaseUrl ?? this.env.PHOTO_VIEW_BASE_URL ?? undefined;
    this.photos = new PhotoService({
      people: this.people, meta: new PgPhotoStore(this.sql), storage: o.photoStorage === null ? undefined : o.photoStorage ?? photoStorageFromEnv(this.env),
      signingKey: key, now: () => this.clock.now(), rater: o.photoRater && this.cost.meterRater(o.photoRater), log: this.log,
      eligible: (personId, app, tx) => this.verifiedAdult(personId, app, tx),
      banned: (personId, tx) => this.personBanned(personId, tx),
      onRating: (personId, app, score, subject, selected) => this.writeRating(personId, app, score, subject, selected),
      onRemoved: (personId, app) => this.dropRatings(personId, app),
    });
    this.photoDeliveryOrigin = o.photoDeliveryOrigin;
    this.photoRelay = new PhotoRelayService({
      store: new PgPhotoRelayStore(this.sql), photos: this.photos, signingKey: key, now: () => this.clock.now(),
      ...(o.photoRelayPolicy && !this.routePolicy ? { policy: o.photoRelayPolicy } : {}),
      authorize: (input, tx) => this.photoRelayParties(input, tx),
      threads: (app, personId) => this.photoRelayThreads(app, personId),
    });
    this.photoLinks = new PhotoUploadLinks({
      sql: this.sql, photos: this.photos, hashKey: this.hashKey, now: () => this.clock.now(), log: this.log,
      origin: app => `https://${this.apps[app].domain}`,
      held: async (personId, app, tx) => { const hold = await currentStaffHold(tx, app, personId); return hold.local !== null || hold.global !== null; },
    });
    this.photoIntake = new PhotoIntake({
      people: this.people, accounts: this.accounts, photos: this.photos, links: this.photoLinks, phoneKey: e164 => this.phoneKey(e164), now: () => this.clock.now(),
      fetchMedia: o.fetchMedia ?? fetchMediaCapped, log: this.log,
      reply: async (e164, text, key) => { const rt = this.runtimeFor("slop"); if (rt) await this.direct(rt, e164, text, key, "reply"); },
    });
    this.audit = o.audit ?? new PgAudit(o.auditUrl ?? o.url);
    this.inbox = new Inbox({ sql: this.sql, clock: this.clock, log: this.log, senderKey: sender => this.phoneKey(sender), handle: (ev, app) => this.inbound(ev, app && isAppId(app) ? { app } : {}) });
  }

  /** Reuse canonical account policy inside the caller's existing PostgreSQL transaction. */
  accountsFor(tx: SQL): Accounts {
    return new Accounts(new PgPeopleStore(tx), { hashKey: this.hashKey, now: () => this.clock.now(), env: this.env, apps: id => this.apps[id] });
  }

  private homeHelpAuthority(user?: StaffUser) {
    return createBoundedHomeHelpAuthority({
      accountsFor: tx => this.accountsFor(tx), appInfo: app => this.apps[app],
      routeOfMember: (app, city) => this.conversationNetworkId(app, city), now: () => this.clock.now(),
      engineConfig: app => this.runtimeFor(app)?.wiring.engine,
      reviewerAuthorized: async (_tx, reviewer) => !!user && user.id === reviewer.staffId && allowed(user, ["safety"], reviewer.app, "real"),
    });
  }

  private async homeHelpSender(tx: SQL, rt: NetworkRuntime, memberId: MemberId, sender: string): Promise<boolean> {
    return await boundedHomeHelpSenderCurrent(this.accountsFor(tx), rt.app, { memberId, e164: sender })
      && await this.homeHelpAuthority().ownerEligible(tx, { app: rt.app.id, requesterId: memberId });
  }

  private homeHelpConsent() {
    const now = () => this.clock.now();
    return new BoundedHomeHelpConsent(new BoundedHomeHelp(this.homeHelpAuthority(), now),
      (tx, app, actor) => boundedHomeHelpSenderCurrent(this.accountsFor(tx), this.apps[app], actor), now);
  }

  private homeHelpVenue() {
    const consent = this.homeHelpConsent();
    return new BoundedHomeHelpVenue((tx, key) => consent.currentConsent(tx, key), this.homeHelpVenueKey, () => this.clock.now());
  }

  private async privateHomeHelpVenue(app: AppInfo, who: Who, input: HomeHelpVenueRequest): Promise<{ address?: string } | undefined> {
    const runtime = this.runtimeFor(app.id);
    const id = homeHelpPlanId(input.id);
    if (!runtime?.net.allowedCategories.has("help") || !id || !who.personId) return;
    return runtime.scoped(async tx => {
      const accounts = this.accountsFor(tx);
      const participant = await accounts.activeMembership(app, who);
      if (!participant || !canBeMatched(await accounts.lowestAge(who.e164, participant.person))) return;
      const actor = { app: app.id, memberId: participant.membership.memberId };
      const version = { id, revision: input.revision };
      const venue = this.homeHelpVenue();
      if (input.action === "reveal") {
        const result = await venue.reveal(tx, actor, version);
        // Recheck this session's exact phone binding after taking the roster locks.
        if (result && (await accounts.activeMembership(app, who))?.membership.memberId === actor.memberId) return result;
        return;
      }
      const changed = input.action === "submit"
        ? await venue.submit(tx, actor, { ...version, address: input.address })
        : await venue.revoke(tx, actor, version);
      if (changed) return {};
    });
  }

  async homeHelpNoticeCurrent(tx: SQL, app: AppInfo, noticeId: string, memberId: MemberId, to: string, body: string): Promise<boolean> {
    if (!await boundedHomeHelpSenderCurrent(this.accountsFor(tx), app, { memberId, e164: to })) return false;
    const notice = await this.homeHelpConsent().pendingNoticeById(tx, app.id, noticeId, memberId);
    return !!notice && boundedHomeHelpConsentCard(notice) === body;
  }

  async homeHelpRecipientStopped(tx: SQL, app: AppId, memberId: MemberId): Promise<void> {
    await this.homeHelpConsent().invalidateForMember(tx, app, memberId);
  }

  /** Only the verified sender of the current signed turn can receive a forwarding link. */
  stageMemberInvitation(rt: NetworkRuntime, request: MemberInviteRequest): StagedMemberInvitation | undefined {
    if (!rt.signedMemberTurn(request.inviterId, request.messageId)) return;
    if (request.disposition === "review") {
      const { inviterId: inviterMemberId, relationship, durationMonths, depth, reviewReasons, at } = request;
      const id = memberInvitationReviewId(this.hashKey, rt.app.id, inviterMemberId, request.requestId);
      return { status: "review", review: { id, inviterMemberId, relationship, durationMonths, depth, reviewReasons, at } };
    }
    return this.invitationLink(rt.app, request.inviterId, request.relationship, request, request.at);
  }

  private invitationLink(app: AppInfo, inviterMemberId: MemberId, relationship: InviteRelationship,
    evidence: MemberInviteEvidence, at: number, reviewId?: string): Extract<StagedMemberInvitation, { status: "issued" }> {
    const { token, tokenHash } = newMemberInvitation(this.hashKey, app.id);
    return { status: "issued", referral: { tokenHash, inviterMemberId }, url: memberInvitationLink(app, token), relationship, evidence, at, reviewId };
  }

  private async invitationOwner(tx: SQL, app: AppInfo, memberId: string, sender?: string): Promise<boolean> {
    const [row] = await tx`select m.person_id, m.home_city, ph.e164 from network.members m join platform.phone_identities ph on ph.person_id=m.person_id
      where m.app_id=${app.id} and m.id=${memberId} and m.account_status='active' and not m.opted_out and ph.hold is null
      and (${sender ?? null}::text is null or ph.e164=${sender ?? null})
      order by ph.last_seen_at desc nulls last, ph.e164 limit 1`;
    if (!row) return false;
    const accounts = this.accountsFor(tx);
    const e164 = row.e164 as string;
    const binding = await accounts.activeMembership(app, { e164, personId: row.person_id as string });
    if (binding?.membership.memberId !== memberId || !canBeMatched(await accounts.lowestAge(e164, binding.person))) return false;
    const owner = this.runtimeForHome(app.id, row.home_city as string);
    if (!owner) return false;
    const [stored] = await tx`select state from network.network_state where id=${owner.id}`;
    const state = stored?.state;
    return !!state && storedInviterCurrent((typeof state === "string" ? JSON.parse(state) : state) as NetworkState, memberId, this.clock.now());
  }

  async saveMemberInvitation(tx: SQL, rt: NetworkRuntime, staged: StagedMemberInvitation): Promise<void> {
    const turn = this.inboundTurn();
    const inviterId = staged.status === "issued" ? staged.referral.inviterMemberId : staged.review.inviterMemberId;
    if (!turn || !await this.invitationOwner(tx, rt.app, inviterId, turn.from)) throw new InvitationUnavailable();
    if (staged.status === "review") return holdMemberInvitation(tx, rt.app.id, staged.review);
    const approval = staged.reviewId && await releaseMemberInvitationReview(tx, rt.app.id, staged.reviewId, inviterId, staged.at);
    await storeMemberInvitation(tx, rt.app.id, staged.referral, staged.relationship, staged.at, approval ? approval.expiresAt : undefined, staged.evidence);
  }

  private async referralFor(app: AppId, token: string, at: number, verifiedPhone: string): Promise<EnrollmentReferral | undefined> {
    const hash = memberInvitationHash(this.hashKey, app, token);
    const rt = this.runtimeFor(app);
    if (!hash || !rt) return;
    return rt.scoped(async tx => {
      const referral = await findMemberInvitation(tx, app, hash, at);
      if (!referral) {
        const seed = await this.seedInvitations.findRecipient(tx, {app, token, e164: verifiedPhone});
        if (seed && await this.invitationRecipientMayRedeem(tx, app, verifiedPhone)) return seed;
        return;
      }
      if (!await this.invitationOwner(tx, rt.app, referral.inviterMemberId)) return;
      try { await this.expectedInvitationBinding(tx, app, hash, verifiedPhone); }
      catch (error) { if (error instanceof InvitationUnavailable) return; throw error; }
      return referral;
    });
  }

  private async expectedInvitationBinding(tx: SQL, app: AppId, tokenHash: string, to: string): Promise<string | undefined> {
    const [invite] = await tx<{expected_recipient_hash: string | null}[]>`select expected_recipient_hash
      from platform.member_invitations where app_id=${app} and token_hash=${tokenHash} for update`;
    if (!invite) throw new InvitationUnavailable();
    if (!invite.expected_recipient_hash) return;
    if (!await this.expectedInvitations.verifyRecipient(tx, {app, tokenHash, to}) || !await this.invitationRecipientMayRedeem(tx, app, to)) {
      throw new InvitationUnavailable();
    }
    return invite.expected_recipient_hash;
  }

  private async invitationRecipientMayRedeem(tx: SQL, app: AppId, to: string): Promise<boolean> {
    const accounts = this.accountsFor(tx);
    return !await accounts.held(to) && !await accounts.banned(to) && !await accounts.store.isSuppressed(accounts.phoneHash(to))
      && resolveConsent(await accounts.store.lastConsent(to, app)) !== "opted_out";
  }

  private async eligibleExpectedInviteRecipient(tx: SQL, app: AppId, to: string): Promise<boolean> {
    const accounts = this.accountsFor(tx);
    const phone = await accounts.store.findPhone(to);
    if (normalizePhone(to) !== to || phone?.personId || phone?.hold || await accounts.banned(to)
      || await accounts.store.isSuppressed(accounts.phoneHash(to)) || resolveConsent(await accounts.store.lastConsent(to, app)) === "opted_out") return false;
    const age = await accounts.lowestAge(to, undefined);
    return age === undefined || canJoin(age);
  }

  private async expectedInvitationText(tx: SQL, app: AppInfo, memberId: MemberId, link: string): Promise<string | undefined> {
    if (!isMemberInvitationLink(app, link)) return;
    const [member] = await tx<{name: string}[]>`select name from network.members where app_id=${app.id} and id=${memberId}`;
    const name = member?.name?.trim().split(/\s+/u)[0];
    if (!name || !/^[\p{L}][\p{L}\p{M}'’-]{0,39}$/u.test(name)) return;
    return `${name} invited you to ${app.domain}, an app from The Network that helps people connect. Join if you want.\n${link}\nReply DECLINE INVITE or STOP to opt out.`;
  }

  private expectedInvitationCarrier(rt: NetworkRuntime): BlooioAdapter | undefined {
    const adapter = rt.adapter;
    // Cloud requires an existing active account for this phone. This path only contacts new recipients.
    return adapter instanceof BlooioAdapter && expectedInviteTransportAllows(adapter.name === "blooio", adapter.live) ? adapter : undefined;
  }

  async admitExpectedInvitation(tx: SQL, rt: NetworkRuntime, row: {id: string; to: string; text: string}): Promise<boolean> {
    if (!this.expectedInvitationCarrier(rt)) return false;
    const pending = await this.expectedInvitations.currentDelivery(tx, {app: rt.app.id, id: row.id, to: row.to, body: row.text});
    return !!pending && await this.invitationOwner(tx, rt.app, pending.inviterMemberId)
      && await this.eligibleExpectedInviteRecipient(tx, rt.app.id, row.to);
  }

  async claimExpectedInvitation(tx: SQL, rt: NetworkRuntime, row: {id: string; to: string; text: string}): Promise<void> {
    if (!await this.expectedInvitations.markDeliveryAttempt(tx, {app: rt.app.id, id: row.id, to: row.to, body: row.text})) {
      throw new Error("Expected invitation changed before claim");
    }
  }

  private async photoRelayParties(input: { app: AppId; threadId: string; senderPersonId: string }, transaction?: SQL) {
    if (this.routePolicy) return;
    const read = async (tx: SQL) => {
      await tx`select set_config('app.app_id', ${input.app}, true)`;
      const [member] = await tx`select m.id,m.home_city from network.members m join platform.memberships p
        on p.app_id=m.app_id and p.member_id=m.id and p.person_id=m.person_id
        where m.app_id=${input.app} and m.person_id=${input.senderPersonId}`;
      const rt = member && this.runtimeForHome(input.app, member.home_city as string);
      return rt?.relayPhotoParties(input, tx);
    };
    return transaction ? read(transaction) : this.sql.begin(read);
  }

  private async photoRelayThreads(app: AppId, senderPersonId: string): Promise<{ id: string; label: string }[]> {
    if (this.routePolicy) return [];
    return this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${app}, true)`;
      const [member] = await tx`select m.id,m.home_city from network.members m join platform.memberships p
        on p.app_id=m.app_id and p.member_id=m.id and p.person_id=m.person_id
        where m.app_id=${app} and m.person_id=${senderPersonId}`;
      const rt = member && this.runtimeForHome(app, member.home_city as string);
      if (!rt) return [];
      const [row] = await tx`select state from network.network_state where id=${rt.pg.id}`;
      if (!row?.state) return [];
      const state = (typeof row.state === "string" ? JSON.parse(row.state) : row.state) as NetworkState;
      const threads: { id: string; label: string }[] = [];
      for (const op of state.opps.filter(o => o.participants.includes(member.id as MemberId))) {
        const pair = await rt.relayPhotoParties({ app, threadId: op.id, senderPersonId }, tx);
        if (!pair) continue;
        const [other] = await tx`select name from network.members where app_id=${app} and id=${pair.recipientMemberId}`;
        threads.push({ id: op.id, label: typeof other?.name === "string" ? other.name.trim().split(/\s+/)[0] || "Your match" : "Your match" });
      }
      return threads;
    });
  }

  /** The service for every row of platform.networks, with the platform.apps policy rows. */
  static async fromDatabase(o: Omit<ServiceOptions, "networks" | "apps" | "id">): Promise<NetworkService> {
    const sql = new SQL({ url: o.url, max: 1 });
    try {
      const nets = await sql`select id, matching_enabled from platform.networks order by (app_id = 'ntwrk') desc, id`;
      const rows = await sql`select id, name, domain, min_join_age, min_match_age, join_mode from platform.apps`;
      const apps = { ...APPS };
      for (const r of rows as any[]) if (isAppId(r.id)) apps[r.id as AppId] = { ...APPS[r.id as AppId], name: r.name, domain: r.domain, minJoinAge: r.min_join_age, minMatchAge: r.min_match_age, joinMode: r.join_mode };
      return new NetworkService({ ...o, apps, networks: (nets as any[]).map(r => ({ id: r.id, matchingEnabled: r.matching_enabled })) });
    } finally { await sql.close(); }
  }

  // ------------------------------------------------------------------ the networks
  /** The first network: The Network's (ntwrk) when it runs here. The single-network API below uses it. */
  get main(): NetworkRuntime {
    const all = [...this.runtimes.values()];
    return all.find(r => r.app.id === "ntwrk") ?? all[0]!;
  }
  get net() { return this.main.net; }
  get pg() { return this.main.pg; }
  get store() { return this.main.store; }
  get adapter() { return this.main.adapter; }
  get lastTick() { return this.main.lastTick; }
  /** Address to member of The Network (the first network). */
  memberOf = (address: string): MemberId | undefined => this.main.memberOf(address);
  /** The network of an app (and a city; default its first network here). */
  runtimeFor(app: AppId, city?: string): NetworkRuntime | undefined {
    for (const r of this.runtimes.values()) if (r.app.id === app && (city === undefined || r.city === city)) return r;
    return undefined;
  }
  /** A registered home owns its conversation; an unserved home uses this app's existing default. */
  runtimeForHome(app: AppId, homeCity: string): NetworkRuntime | undefined {
    return this.runtimeFor(app, homeCity) ?? this.runtimeFor(app);
  }

  conversationNetworkId(app: AppId, homeCity: string): string | undefined {
    return this.runtimeForHome(app, homeCity)?.id;
  }

  /** The same registry ownership is used by snapshot loading, address books and member actions. */
  async runtimeOfMember(app: AppId, memberId: string): Promise<NetworkRuntime | undefined> {
    const [row] = await this.runtimeFor(app)?.scoped(tx => tx`select home_city from network.members where app_id=${app} and id=${memberId} and account_status not in ('invited','removed')`) ?? [];
    return row ? this.runtimeForHome(app, row.home_city) : undefined;
  }
  private async calendarSchedulingOwner(request: CalendarOwnerRequest): Promise<CalendarSchedulingOwner | undefined> {
    const app = this.apps[request.app];
    if (!app) return;
    const binding = await this.accounts.activeMembership(app, { e164: request.e164, personId: null });
    if (!binding) return;
    const rt = await this.runtimeOfMember(request.app, binding.membership.memberId);
    return rt?.calendarSchedulingOwner(request.e164, binding.membership.memberId);
  }

  private copyOf(app: AppInfo): Copy {
    if (app.id === "ntwrk") return ntwrkCopy;
    let c = this.copies.get(app.id);
    if (!c) { c = copyFor(brandOf(app)); this.copies.set(app.id, c); }
    return c;
  }
  private phoneKey(e164: string) { return keyedHash(this.hashKey, `phone:${e164}`); }

  /** Check the schema, then let each network deliver what a restart left waiting. */
  async start() {
    const missing: string[] = [];
    for (const t of REQUIRED_TABLES) {
      const [r] = await this.sql`select to_regclass(${t}) is not null as ok`;
      if (!r?.ok) missing.push(t);
    }
    if (missing.length) throw new Error(`the database is missing ${missing.join(", ")}: run pnpm run db:migrate (runbook-real 1.1, runbook-platform)`);
    // The database and the process must agree on the environment (the 555-01xx guard reads the database's).
    const declared = platformEnv(this.env);
    const [envRow] = await this.sql`select value from platform.settings where key = 'environment'`;
    if (declared && envRow && envRow.value !== declared) throw new Error(`PLATFORM_ENV is ${declared} but platform.settings.environment is ${envRow.value}: fix one of them`);
    const injected = this.relayClassifier;
    this.relayHookFor = injected ? () => injected : relayClassifierFromEnv(this.env, this.log, this.cost);
    // spec/databaseRestore.md, "The backend runs the queued replay at start, and each item by one runner until it holds"
    await replayPrivacyAtStart(this);
    for (const rt of this.runtimes.values()) await rt.start();
  }

  /** One tick on every network, each under its own lock. True when any network ran (one network: whether it ran). */
  async tick(): Promise<boolean> {
    let any = false;
    await this.inboxTick();
    for (const rt of this.runtimes.values()) any = (await rt.tick()) || any;
    await this.purge();
    return any;
  }

  /**
   * RuntimeHost.afterTick: after a tick that ran on this instance, the review SLA alerts and, once a
   * week, the bias monitor of a network whose app takes photos. Each logs "[alert] ..." lines that the
   * host's log alerts pick up (docs/deploy.md); a failure is logged and never stops the tick.
   */
  async afterTick(rt: NetworkRuntime): Promise<void> {
    await this.recoverInvitationJoins(rt);
    await this.recoverSeedInvitationJoins(rt).catch(() => this.log(`[invite] seed projection waits for retry (${rt.id})`));
    if (this.runtimeFor(rt.app.id) === rt) await rt.scoped(async tx => {
      const now = this.clock.now();
      await purgeExpiredMemberInvitationReviews(tx, rt.app.id, now);
      await this.expectedInvitations.purgeExpired(tx, rt.app.id);
      await this.seedInvitations.purgeExpired(tx, rt.app.id);
      await this.profileFactEdits.purgeExpired(tx, rt.app.id);
      await tx`delete from platform.calendar_invites where app_id=${rt.app.id} and expires_at<=${new Date(now)}`;
      await tx`delete from platform.member_invitations
        where app_id=${rt.app.id} and expires_at<=${new Date(now)} and (redeemed_at is null or projected_at is not null)`;
    }).catch(() => this.log(`[purge] invitations failed (${rt.id})`));
    if (this.runtimeFor(rt.app.id) === rt) await rt.scoped(async tx => {
      const app = rt.app.id;
      const expired = await tx`select id from network.bounded_home_help where app_id=${app} and phase<>'Closed'
        and expires_at<=${new Date(this.clock.now())} order by expires_at,id limit 20`;
      const store = new BoundedHomeHelp(this.homeHelpAuthority(), () => this.clock.now());
      for (const row of expired) await store.expire(tx, { app, id: row.id as string });
      await this.homeHelpVenue().purgeExpired(tx, app);
    }).catch(() => this.log(`[purge] home-help plans failed (${rt.id})`));
    if (rt.net.allowedCategories.has("help")) await this.projectHomeHelpConsent(rt).catch(() => this.log(`[home-help] consent projection waits (${rt.id})`));
    if (rt.app.id === "ntwrk" && rt.city === "nyc") {
      await queueReviewedGatheringInvitations(rt, tx => this.accountsFor(tx), () => this.clock.now())
        .catch(() => this.log(`[gathering] invitation projection waits (${rt.id})`));
      await queueGatheringNotices(rt, tx => this.accountsFor(tx), () => this.clock.now())
        .catch(() => this.log(`[gathering] RSVP notice projection waits (${rt.id})`));
    }
    // spec/relayLifecycle.md, "A held item that staff do not decide by its review deadline expires unsent": held relay items share the app's SLA.
    const relayHeld = rt.net.relayHeld().map(h => ({ oppId: `relay:${h.itemId}`, queuedAt: h.at, deadline: h.deadline }));
    for (const line of slaAlerts(rt.id, [...rt.net.reviewQueue(), ...relayHeld], this.clock.now(), DEFAULT_SLA_HOURS[rt.app.id], this.slaAlerted)) this.log(line);
    if (PHOTO_APPS.includes(rt.app.id) && this.runtimeFor(rt.app.id) === rt) {
      const expired = await expirePendingPhotos({ sql: this.sql, relay: this.photoRelay, runtimeOfMember: (app, memberId) => this.runtimeOfMember(app, memberId), log: line => this.log(line) }, rt.app.id)
        .catch(e => { this.log(`[photo-relay] the expiry pass waits for the next tick (${rt.id}): ${(e as Error).message}`); return 0; });
      if (expired) this.log(`[alert] review SLA ${rt.id}: ${expired} selected photo(s) expired unsent before a review`);
    }
    if (PHOTO_APPS.includes(rt.app.id)) await this.weeklyBias(rt);
  }

  private async projectHomeHelpConsent(rt: NetworkRuntime) {
    const consent = this.homeHelpConsent();
    if (this.runtimeFor(rt.app.id) === rt) {
      await stageApprovedHomeHelp(rt, consent, this.clock.now());
      await rt.scoped(tx => reconcileHomeHelpDelivery(tx, consent, rt.app.id));
    }
    await queueReviewedHomeHelp(rt, consent, rt.cities, this.clock.now());
  }

  /** The bias monitor of one network when its last stored report is a week old (or there is none). Returns the new report, if one was made. */
  async weeklyBias(rt: NetworkRuntime, force = false): Promise<StoredBiasReport | undefined> {
    const now = this.clock.now();
    const reportDue = (lastAt: Date | string | null | undefined) =>
      weeklyBiasDue(force, !!lastAt, !force && lastAt ? now - new Date(lastAt).getTime() : 0);
    const [last] = await rt.scoped(tx => tx`select max(at) as at from network.bias_reports where app_id = ${rt.app.id} and network_id = ${rt.id}`);
    if (!reportDue(last?.at)) return undefined;
    const rows = await rt.scoped(tx => tx`select m.id, m.age, m.joined_at, coalesce(array_agg(t) filter (where t like 'appearance:%'), '{}') as tags
      from network.members m left join network.facets f on f.app_id = m.app_id and f.member_id = m.id and f.status <> 'rejected' and ${automatedFacetPredicate(tx, true)} left join lateral unnest(f.tags) t on true
      where m.app_id = ${rt.app.id} and m.account_status in ('active', 'paused', 'restricted') group by m.id, m.age, m.joined_at order by m.id`) as any[];
    const members: BiasMember[] = rows.map(r => ({ id: r.id, age: r.age, joinedAt: r.joined_at ? new Date(r.joined_at).getTime() : null, tags: r.tags ?? [] }));
    const opportunities = await rt.readState(n => [...n.opps.values()]);
    const r = biasReport(rt.id, rt.app.id, members, opportunities, now);
    const saved = await rt.scoped(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext(${`bias-report-${rt.id}`}))`;
      const [latest] = await tx`select max(at) as at from network.bias_reports where app_id = ${rt.app.id} and network_id = ${rt.id}`;
      if (!reportDue(latest?.at)) return false;
      await tx`insert into network.bias_reports (app_id, id, network_id, at, members, alerts, report)
        values (${rt.app.id}, ${`bias_${rt.id}_${now}`}, ${rt.id}, ${new Date(now)}, ${r.members}, ${r.report.alerts.length}, ${r.report as unknown as Row}::jsonb)`;
      return true;
    });
    if (!saved) return undefined;
    this.log(`[bias] ${rt.id}: ${r.members} adult member(s), ${r.report.alerts.length} alert(s)`);
    for (const line of biasAlerts(r)) this.log(line);
    return r;
  }

  /** The newest stored bias reports of a network (the console's bias panel). */
  async biasReports(rt: NetworkRuntime, limit = 8): Promise<StoredBiasReport[]> {
    const rows = await rt.scoped(tx => tx`select network_id, app_id, at, members, report from network.bias_reports where app_id = ${rt.app.id} and network_id = ${rt.id} order by at desc limit ${limit}`) as any[];
    return rows.map(r => ({ network: r.network_id, app: r.app_id, at: new Date(r.at).getTime(), members: r.members, report: typeof r.report === "string" ? JSON.parse(r.report) : r.report }));
  }

  /** Inbound messages a crash or an error left waiting (platform.inbound): handled once, in order per sender. */
  async inboxTick(): Promise<void> {
    const people = new PgPeopleStore(this.sql);
    const pending = await people.pendingUnderageCleanup(16).catch(() => {
      this.log("[age] underage cleanup scan waits for retry");
      return [];
    });
    for (const personId of pending) await this.finishUnderageCleanup(personId)
      .catch(() => this.log("[age] underage cleanup waits for retry"));
    const n = await this.inbox.drain().catch(e => { this.log(`[inbound] inbox drain failed: ${(e as Error).message}`); return 0; });
    if (n) this.log(`[inbound] ${n} waiting inbound message(s) handled`);
  }

  /** Retention (audit platform-18): expired OTP challenges and sessions, old rate windows and stale text flows. */
  async purge() {
    await sweepPhotos({ photos: this.photos, runtimes: [...this.runtimes.values()], dropRatings: (personId, app) => this.dropRatings(personId, app), log: s => this.log(s) })
      .catch(e => this.log(`[purge] photo sweep failed and waits for the next tick: ${(e as Error).message}`));
    for (const app of new Set([...this.runtimes.values()].map(rt => rt.app.id))) {
      await this.profileSuggestions.applyRetention(app, this.clock.now()).catch(e => this.log(`[purge] profile suggestions failed: ${(e as Error).message}`));
    }
    await this.runtimeFor("peon")?.scoped(tx => purgePeonSearchDrafts(tx, this.clock.now()))
      .catch(() => this.log("[purge] Peon search draft expiry waits for retry"));
    const n = await this.people.purge(this.clock.now() - platformKeepMs).catch(e => { this.log(`[purge] failed: ${(e as Error).message}`); return 0; });
    // The inbox keeps handled ids a week (dedupe); the line keeps no counters for an address that is nobody's phone.
    await this.inbox.purge(this.clock.now() - inboxKeepMs).catch(e => this.log(`[purge] inbox failed: ${(e as Error).message}`));
    await this.lineAdapter()?.purge?.().catch(e => { this.log(`[purge] line counters failed: ${(e as Error).message}`); return 0; });
    if (n) this.log(`[purge] removed ${n} expired platform row(s)`);
    return n;
  }

  /** A unit of work on The Network (the first network). */
  unitOfWork<T>(fn: (n: NetworkRuntime["net"]) => Promise<T> | T): Promise<T> { return this.main.unitOfWork(fn); }

  // ------------------------------------------------------------------ the person cap (RuntimeHost)
  /**
   * The proactive sends of a batch that would take a person over the daily cap across every app
   * (PRD 40.3), checked at send time. The count is a platform counter (platform.person_sends) taken by
   * platform.person_cap_take (SECURITY DEFINER, migration 0007) under one lock for every app: two
   * networks that deliver at once cannot both pass the cap, and the network_service role (one app per
   * transaction) still counts every app. It returns the refused ids only. Members the platform does
   * not know (no person_id) have only their app's own limits.
   */
  async capRefused(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>> {
    const pro = batch.filter(b => b.proactive || b.kind === "proactive");
    if (!this.cap || !pro.length) return new Set();
    const now = this.clock.now();
    const sends = pro.map(b => ({ id: b.id, member: b.memberId }));
    const rows = await this.sql`select * from platform.person_cap_take(${rt.app.id}, ${sends}::jsonb, ${new Date(now - DAY)}, ${new Date(now)}, ${this.cap}) as id`;
    const out = new Set((rows as any[]).map(r => r.id as string));
    for (const id of out) this.log(`[cap] person cap (${this.cap}/day) holds a proactive send ${id} (${rt.id})`);
    return out;
  }

  /** Release the cap slots of sends the adapter refused (migration 0012). */
  async capRelease(ids: string[]): Promise<void> {
    if (!this.cap || !ids.length) return;
    await this.sql`select platform.person_cap_release(${this.sql.array(ids, "TEXT")})`.catch(e => this.log(`[cap] release failed: ${(e as Error).message}`));
  }

  // ------------------------------------------------------------------ the single inbox (packages/notify)
  /**
   * RuntimeHost.delivered: the member-facing sends that went out become inbox items, already
   * delivered, so the person's assistant can show them (MCP get_updates) and nothing texts them again.
   * Members with no person (from before the platform) are skipped.
   */
  async delivered(rt: NetworkRuntime, sent: Outbound[]): Promise<void> {
    if (!this.notify) return;
    const items = sent.filter(b => networkTextCanProduceInboxItem(b.system === true, b.type ?? ""));
    if (!items.length) return;
    const ids = [...new Set(items.map(b => b.memberId))];
    const rows = await rt.scoped(tx => tx`select id, person_id from network.members where app_id = ${rt.app.id} and person_id is not null and id in ${tx(ids)}`);
    const person = new Map((rows as any[]).map(r => [r.id as string, r.person_id as string]));
    for (const b of items) {
      const personId = person.get(b.memberId);
      if (!personId) continue;
      const deliveryId = `net:${b.id}`;
      // A previous projection may have used just the opportunity as its subject.
      const projection = networkTextProjection(!!await this.notify.store.getDelivery(deliveryId), !!b.oppId);
      if (projection === "SkipRecordedText") continue;
      const subjectId = projection === "ProjectOpportunityText" ? `${b.oppId}#${b.id}` : b.id;
      await this.notify.recordSent(
        { personId, app: rt.app.id, eventType: b.type!, subjectId, urgency: b.proactive ? "normal" : "requested", summary: b.body.trim().slice(0, networkTextSummaryLimit) || "An update from the Network." },
        { deliveryId, channel: "imessage", countsTowardCap: b.proactive || b.kind === "proactive", sentAt: b.acceptedAt ?? b.ts },
      );
    }
  }

  /**
   * The person's own unseen updates in one app, for their assistant (MCP get_updates). A shown or retired
   * update is marked seen on every surface; one that fails the assistant's output gate stays unseen. An
   * update code limits the result to that text's items; someone else's code, an unknown one or an
   * expired one returns nothing.
   */
  async updatesFor(personId: string, app: AppId, surface: Surface, token: string | undefined, passesLeakGate: (summary: string) => boolean): Promise<Array<{ summary: string; at: string; kind: string }>> {
    if (!this.notify) return [];
    const items = await this.notify.readUpdates(personId, surface, this.clock.now(), token, {
      app,
      ...this.gatedUpdateRead(items => this.sql.begin(async tx => {
        await tx`select set_config('app.app_id',${app},true)`;
        return this.inboxUpdateOutcomes(tx, personId, app, items, passesLeakGate);
      })),
    });
    return items.map(i => ({ summary: i.summary, at: new Date(i.createdAt).toISOString(), kind: i.eventType }));
  }

  private gatedUpdateRead(outcomesOf: (items: InboxItem[]) => Promise<Map<string, ConnectorUpdateOutcome>>) {
    let outcomes = new Map<string, ConnectorUpdateOutcome>();
    return {
      visible: async (items: InboxItem[]) => {
        outcomes = await outcomesOf(items);
        return items.filter(item => outcomes.get(item.id) === "InboxUpdateShown");
      },
      withheld: (items: InboxItem[]) => items.filter(item => { const outcome = outcomes.get(item.id); return !!outcome && !connectorUpdateMarkedSeen(outcome); }),
    };
  }

  private async currentInboxUpdates(tx: SQL, personId: string, app: AppId, items: InboxItem[]): Promise<InboxItem[]> {
    const outcomes = await this.inboxUpdateOutcomes(tx, personId, app, items, () => true);
    return items.filter(item => outcomes.get(item.id) === "InboxUpdateShown");
  }

  private async inboxUpdateOutcomes(tx: SQL, personId: string, app: AppId, items: InboxItem[], passesLeakGate: (summary: string) => boolean): Promise<Map<string, ConnectorUpdateOutcome>> {
    if (!items.length) return new Map();
    const subjects = items.map(item => {
      const messageId = item.deliveryId?.startsWith("net:") ? item.deliveryId.slice(4) : undefined;
      const suffix = messageId ? `#${messageId}` : undefined;
      let opportunityId: string | null = null;
      if (suffix && item.subjectId !== messageId) {
        opportunityId = item.subjectId.endsWith(suffix) ? item.subjectId.slice(0, -suffix.length) : item.subjectId;
      }
      return { id: item.id, subject_id: item.subjectId, opportunity_id: opportunityId,
        message_id: messageId === item.subjectId ? messageId : null };
    });
    const rows = await tx<{ id: string; state: string | null; bound: boolean }[]>`select subject.id, opportunity.state,
      (subject.opportunity_id is not null or message.opportunity_id is not null or opportunity.id is not null) as bound
      from jsonb_to_recordset(${subjects}::jsonb) as subject(id text, subject_id text, opportunity_id text, message_id text)
      left join network.messages message on message.app_id=${app} and message.id=subject.message_id and message.direction='outbound'
        and exists (select 1 from network.members member where member.app_id=${app} and member.id=message.member_id and member.person_id=${personId}::uuid)
      left join network.opportunities opportunity on opportunity.app_id=${app}
        and opportunity.id=coalesce(subject.opportunity_id, message.opportunity_id, subject.subject_id)`;
    const [reader] = await tx<{ age: number | null }[]>`select ages.age from network.members m
      join platform.matching_ages ages on ages.app_id=m.app_id and ages.member_id=m.id
      where m.app_id=${app} and m.person_id=${personId}::uuid`;
    const readerMatchable = canBeMatched(reader?.age);
    const facts = new Map(rows.map(row => [row.id, row]));
    return new Map(items.map(item => {
      const row = facts.get(item.id);
      const stillCurrent = !!row && inboxOpportunityAllowsUpdate(row.bound, row.state !== null, row.state ?? "");
      return [item.id, connectorUpdateOutcome(stillCurrent, readerMatchable, !!row?.bound, passesLeakGate(item.summary))];
    }));
  }

  /** A shared line spans current own memberships. A dedicated line retains its app boundary. */
  private async currentThreadUpdates(tx: SQL, e164: string, personId: string, route: Route, items: InboxItem[]) {
    const accounts = this.accountsFor(tx);
    const owned = items.filter(item => item.personId === personId);
    const visible = new Set<string>();
    const obsolete = new Set<string>();
    for (const app of [...new Set(owned.map(item => item.app))].sort()) {
      if (!isAppId(app) || !appAllowsInboxItem(!route.shared, app === route.app)) continue;
      const binding = await accounts.activeMembership(this.apps[app], { e164, personId });
      if (!binding) continue;
      await tx`select set_config('app.app_id',${app},true)`;
      const [active] = await tx`select id from network.members where app_id=${app} and id=${binding.membership.memberId}
        and person_id=${personId} and account_status='active' and not opted_out`;
      if (!mayShowThreadUpdate(route.shared, app === route.app, !!active)) continue;
      const inApp = owned.filter(item => item.app === app);
      for (const item of await this.currentInboxUpdates(tx, personId, app, inApp)) visible.add(item.id);
      for (const item of inApp) if (!visible.has(item.id)) obsolete.add(item.id);
    }
    await tx`select set_config('app.app_id',${route.app},true)`;
    return { visible: items.filter(item => visible.has(item.id)), obsolete: [...obsolete] };
  }

  private threadUpdatesTurn(rt: NetworkRuntime, memberId: MemberId, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string, route: Route): Promise<InboundOutcome> {
    return rt.unitOfWork(async () => {
      if (!this.notify || !rt.signedMemberTurn(memberId, rowId)) return "inbox_updates" as const;
      rt.unit.memberCommand = async tx => {
        const e164 = normalizePhone(ev.from);
        if (!e164) return;
        const binding = await memberCommandOwner(tx, this.accountsFor(tx), { app: rt.app, memberId, e164 });
        if (!binding?.member) return;
        const personId = binding.person.id;
        const now = this.clock.now();
        const store = new PgNotifyStore(tx);
        const channel = ev.transport === "sms" ? "sms" : "imessage";
        const notifier = new Notifier(store, { get: async () => undefined }, this.notify!.cfg);
        await notifier.threadReply(personId, channel, now);
        const { visible, obsolete } = await this.currentThreadUpdates(tx, e164, personId, route, await store.unseen(personId, now));
        const unread = await unpreviewedThreadUpdates(tx, store, e164, personId, visible);
        const page = unread.slice(0, threadUpdatePageSize);
        const seen = new Set(await store.markSeen(personId, channel, now, [...obsolete, ...page.map(item => item.id)]));
        const shown = page.filter(item => seen.has(item.id));
        const remaining = unread.length - page.length;
        const id = threadUpdateReplyId(this.threadUpdatesTurnHash(rowId, personId), shown, remaining);
        rt.unit.atomicReply = "inbox_updates";
        rt.collectedMemberReply(memberId, id, threadUpdateBody(shown, remaining), "inbox_updates");
      };
      return "inbox_updates" as const;
    });
  }

  private threadUpdatesTurnHash(rowId: string, personId: string): string {
    return keyedHash(this.hashKey, `thread-updates:${rowId}:${personId}`).slice(0, 32);
  }

  private async threadUpdatesReplyCurrent(input: TurnRequest, reply: Extract<TurnResponse, { outcome: "handled" }>): Promise<boolean> {
    const memberId = reply.memberId;
    const rt = reply.app && memberId ? await this.runtimeOfMember(reply.app, memberId) : undefined;
    if (!rt || !memberId || !threadUpdateRequested(input.text) || reply.replies.length !== 1 || reply.replyIds?.length !== 1) return false;
    const route = await this.route({ ...input, kind: "message", chatId: input.from, isGroup: false, mediaUrls: [] }, input.app);
    if (!route.shared && route.app !== rt.app.id) return false;
    return rt.scoped(async tx => {
      const binding = await memberCommandOwner(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from });
      if (!binding?.member) return false;
      const personId = binding.person.id;
      const receipt = threadUpdateReceipt(reply.replyIds![0]!, this.threadUpdatesTurnHash(`in:${input.channel}:${input.messageId}`, personId));
      if (!receipt) return false;
      const now = this.clock.now();
      const rows = await new PgNotifyStore(tx).getItems(receipt.ids);
      const live = rows.filter(item => item.expiresAt === undefined || item.expiresAt > now);
      const { visible } = await this.currentThreadUpdates(tx, input.from, personId, { ...route, app: rt.app.id }, live);
      return visible.length === receipt.ids.length && threadUpdateBody(visible, receipt.remaining) === reply.replies[0];
    });
  }

  /** An assistant connected (OAuth grant) or disconnected (revoked) for a person: the surface signal. */
  async assistantLinked(personId: string, surface: Surface, active: boolean): Promise<void> {
    await this.notify?.setActive(personId, surface, active);
  }

  /** The notify recipient of a person: their first live member with an address on a running network (The Network first). */
  private async notifyRecipient(personId: string): Promise<Recipient | undefined> {
    const rts = [...this.runtimes.values()].sort((a, b) => Number(b.app.id === "ntwrk") - Number(a.app.id === "ntwrk"));
    for (const rt of rts) {
      const rows = await rt.scoped(tx => tx`select id from network.members where app_id = ${rt.app.id} and person_id = ${personId} and not opted_out`);
      for (const r of rows as any[]) {
        const to = rt.addressOf(r.id);
        if (!to) continue;
        this.notifyTargets.set(normalizeAddress(to), { rt, memberId: r.id });
        return { personId, to, timeZone: resolveTimeZone(undefined, rt.city) ?? "America/New_York", prefs: { channel: "imessage" }, proactiveAllowed: true };
      }
    }
    return undefined;
  }

  /**
   * The notify scheduler's own texts go out as a unit of work on the member's network, so delivery
   * applies the platform consent ledger, the member's opt-out and the person cap like every other send.
   */
  private notifySink(): OutboundSink {
    return {
      enqueue: async x => {
        const target = this.notifyTargets.get(normalizeAddress(x.to));
        if (!target) { this.log(`[notify] no network member for a delivery (${x.idempotencyKey}): not sent`); return; }
        await target.rt.unitOfWork(() => target.rt.system(target.memberId, x.idempotencyKey, x.text, x.kind, "notify"));
      },
    };
  }

  /** Send-time authorization for a queued notification, including after a restart. */
  async notificationCurrent(id: string): Promise<boolean> {
    return this.notify ? this.notify.stillNeeded(id, this.clock.now()) : false;
  }

  notificationHandoffUrl(id: string, body: string): Promise<string | undefined> {
    return this.notify?.queuedDigestHandoffUrl(id, body) ?? Promise.resolve(undefined);
  }

  setNotificationClaimSurfaces(lookup: NonNullable<NetworkService["notificationClaimSurfaces"]>): void {
    this.notificationClaimSurfaces = lookup;
  }

  async notificationClaimCurrent(tx: SQL, row: QueueRow): Promise<boolean> {
    if (!this.notify || !row.memberId) return false;
    const phoneKey = this.phoneKey(row.to);
    // The queue already holds the person and network member locks. Bind the destination to their verified phone.
    const [owner] = await tx<{ id: string }[]>`select person.id::text as id from network.members member
      join platform.people person on person.id=member.person_id and person.deleted_at is null and person.phone_hash=${phoneKey}
      join platform.phone_identities phone on phone.person_id=person.id and phone.e164=${row.to} and phone.hold is null
      where member.app_id=${row.app} and member.id=${row.memberId} for share of phone`;
    if (!owner) return false;
    const store = new PgNotifyStore(tx);
    return this.notify.queuedDigestClaimCurrent({ id: row.id, personId: owner.id, text: row.text }, () => this.clock.now(), {
      getDelivery: id => store.getDelivery(id, true),
      getItems: ids => store.getItems(ids, true),
    }, async (personId, app) => {
      if (!this.notificationClaimSurfaces) return [];
      const [membership] = await tx`select 1 from platform.memberships where person_id=${personId}::uuid and app_id=${app}
        and state in ('active','onboarding') and review is null and left_at is null for share`;
      if (!membership || await new PgPeopleStore(tx).isBanned(phoneKey, personId)) return [];
      // A shared line may send from another app. The grant must cover the digest's app.
      return this.notificationClaimSurfaces(tx, personId, phoneKey, app);
    });
  }

  /** Once per tick: close stale delivery outcomes, then send what the inbox has due. */
  async notifyTick(): Promise<void> {
    if (!this.notify) return;
    const now = this.clock.now();
    await this.notify.sweep(now);
    await this.notify.dispatch(now, this.notifySink());
  }

  /**
   * Sends to a number whose last consent event for this app (or for every app) is an opt-out
   * (platform.consent_events, PLATFORM_STOP_SCOPE). Compliance texts (the STOP confirmation, a decline)
   * still go. A number with no event at all (a member from before the platform) is not refused here:
   * the member's own opted_out flag covers it.
   */
  async consentRefused(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>> {
    const out = new Set<string>();
    const byPhone = new Map<string, Outbound[]>();
    for (const b of batch) {
      if (b.kind === "compliance") continue;
      const e164 = normalizePhone(b.to ?? rt.addressOf(b.memberId));
      if (e164) byPhone.set(e164, [...(byPhone.get(e164) ?? []), b]);
    }
    for (const [e164, sends] of byPhone) {
      // A number that deleted everything stays suppressed until the person opts in again (platform-15).
      const suppressed = await this.people.isSuppressed(this.phoneKey(e164));
      // A banned number or person gets nothing but compliance texts, on every app (PRD 40.5).
      const banned = !suppressed && (await this.people.isBanned(this.phoneKey(e164), (await this.people.findPhone(e164))?.personId ?? null));
      if (banned) { for (const b of sends) out.add(b.id); this.log(`[ban] ${sends.length} send(s) to a banned number refused (${rt.id})`); continue; }
      if (!suppressed && resolveConsent(await this.people.lastConsent(e164, rt.app.id)) !== "opted_out") continue;
      for (const b of sends) out.add(b.id);
      this.log(`[consent] ${sends.length} send(s) to an opted-out number refused (${rt.id})`);
    }
    return out;
  }

  // ------------------------------------------------------------------ members from the platform
  /**
   * The network member for an active membership: a network.members row (app, member id, person id,
   * first name, age) and what the person gave at join (neighborhood, interests). The phone stays in
   * platform.phone_identities. Written with app.app_id set (migration 0004).
   */
  async createMember(rt: NetworkRuntime, m: Membership, info: { age: number; firstName: string; homeCity?: string; neighborhood?: string; interests?: string[]; zip?: string }, invitation?: { tx: SQL; referral?: ReferralJoin; verifiedRecipientHash?: string }) {
    const at = this.clock.now();
    const now = new Date(at);
    const homeCity = info.homeCity ?? homeCityOf(m.profile.homeCity) ?? rt.city;
    // The app's categories (packs.ts): slop is dating and only for adults; peon is work; friends is social and hobby.
    const prefs = { ...rt.wiring.prefs(info.age), quietHours: [21, 9], formats: ["one_to_one", "small_group", "event"], maxTravelMinutes: 45, onlyWhenAsked: false };
    const referral = invitation?.referral;
    const write = async (tx: SQL) => {
      if (!await new PgPeopleStore(tx).enrollmentOwnerAllowed(tx, m.personId)) return false;
      if (referral && !await this.invitationOwner(tx, rt.app, referral.inviterMemberId)) throw new InvitationUnavailable();
      await tx`insert into network.members (app_id, id, person_id, name, home_city, home_area, account_status, age, prefs, joined_at, invited_by)
        values (${rt.app.id}, ${m.memberId}, ${m.personId}, ${info.firstName}, ${homeCity}, ${info.neighborhood ?? null}, 'active', ${info.age}, ${prefs}::jsonb, ${now}, ${referral?.inviterMemberId ?? null})
        on conflict (id) do update set person_id = excluded.person_id, name = excluded.name, home_city = excluded.home_city, home_area = excluded.home_area,
          account_status = 'active', age = excluded.age, joined_at = excluded.joined_at, opted_out = false,
          invited_by = coalesce(excluded.invited_by, network.members.invited_by)`;
      if (referral) await consumeMemberInvitation(tx, rt.app.id, referral, m.memberId, at, invitation?.verifiedRecipientHash);
      if (info.neighborhood || info.homeCity) await tx`insert into network.presence (app_id, member_id, city, type, areas) values (${rt.app.id}, ${m.memberId}, ${homeCity}, 'home', ${tx.array(info.neighborhood ? [info.neighborhood] : [], "TEXT")})`;
      // slop dates by distance from a zip (a coarse cell; agent_private, never shown).
      if (info.zip && rt.app.id === "slop") {
        await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
          values (${rt.app.id}, ${`${m.memberId}:join:zip`}, ${m.memberId}, 'fact', ${info.zip}, ${tx.array([`slop:zip:${info.zip}`], "TEXT")}, 'agent_private', 'said', 'web_join', 0.9, 'confirmed', ${now})
          on conflict (id) do nothing`;
      }
      for (const tag of info.interests ?? []) {
        await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
          values (${rt.app.id}, ${`${m.memberId}:join:${tag}`}, ${m.memberId}, 'interest', ${tag}, ${tx.array([tag], "TEXT")}, 'matchable', 'said', 'web_join', 0.8, 'confirmed', ${now})
          on conflict (id) do nothing`;
      }
      return true;
    };
    if (!(invitation ? await write(invitation.tx) : await rt.scoped(write))) return false;
    const turn = this.inboundTurn();
    if (turn && (await this.accounts.personFor(turn.from))?.id === m.personId) {
      turn.app = rt.app.id; turn.memberId = m.memberId;
    }
    return true;
  }

  /** The platform hooks: a join creates the network member and sends the welcome; stop, forget and export reach the network. */
  private hooks(): AccountHooks {
    return {
      findInvitation: (app, token, at, verifiedPhone) => this.referralFor(app, token, at, verifiedPhone),
      onJoin: (ctx: JoinHookContext) => this.joined(ctx),
      memberExists: async ctx => (await this.runtimeFor(ctx.app.id)?.scoped(tx => tx`select 1 from network.members where app_id=${ctx.app.id} and id=${ctx.memberId} and account_status not in ('invited','removed')`) ?? []).length > 0,
      commitReferredJoin: ctx => this.commitReferredJoin(ctx),
      onStop: ctx => this.stopped(ctx.app, ctx.personId, ctx.scope),
      onForget: async (ctx, reason) => {
        const endsAccess = forgetEndsAppAccess(reason === "join_failed");
        // The app's photos go first (leave, delete everything, a new owner of the number).
        if (endsAccess) await this.photos.deleteFor(ctx.personId, ctx.app.id);
        await this.forget(ctx.app, ctx.memberId, reason === "leave" ? ctx.personId : undefined);
        // Other parts of the backend that hold data about the person in this app (the MCP server's OAuth grants).
        if (endsAccess) for (const f of this.forgetListeners) await f(ctx);
      },
      onEraseAccount: async personId => {
        for (const erase of this.accountEraseListeners) await erase(personId);
      },
      onExport: ctx => this.exportMember(ctx),
      onAgeLowered: ctx => this.ageLowered(ctx.personId, ctx.age),
      // The ages the Network itself would record from the text (statedAge uses the same rule).
      // spec/siteEnrollment.md, "The approved profile reaches onboarding and its stated age counts"
      profileAges: text => {
        const stated = agesStated(text);
        return [{ age: stated.explicit, explicit: true }, { age: stated.age, explicit: false }]
          .filter((a): a is { age: number; explicit: boolean } => a.age !== undefined && profileAgeCounts(a.explicit, false, canBeMatched(a.age)))
          .map(a => a.age);
      },
    };
  }

  private async ageLowered(personId: string, age: number) {
    if (confirmedUnderage(age)) return this.finishUnderageCleanup(personId);
    if (!canBeMatched(age)) { await this.photos.deleteFor(personId); await this.dropRatings(personId); }
    for (const m of await this.people.memberships(personId)) {
      const rt = this.runtimeFor(m.app);
      if (!rt || m.state === "removed") continue;
      await rt.scoped(tx => tx`update network.members set age = least(coalesce(age, ${age}), ${age}) where app_id = ${m.app} and id = ${m.memberId}`);
    }
  }

  private async finishUnderageCleanup(personId: string): Promise<void> {
    const at = this.clock.now();
    const memberships = await new PgPeopleStore(this.sql).beginUnderageCleanup(personId, at);
    if (!memberships.length) return;
    await this.photos.deleteFor(personId);
    await this.dropRatings(personId);
    for (const erase of this.accountEraseListeners) await erase(personId);
    for (const membership of memberships) {
      if (!this.runtimeFor(membership.app)) continue;
      await this.forget(this.apps[membership.app], membership.memberId as MemberId);
      await this.people.forgetMembership(personId, membership.app, at, membership.memberId);
    }
  }

  /** A web join (POST /api/join): the member row, then the welcome through the normal send path. */
  private async joined(ctx: JoinHookContext) {
    const rt = this.runtimeForHome(ctx.app.id, ctx.input.homeCity ?? this.runtimeFor(ctx.app.id)?.city ?? "");
    if (!rt) throw new Error(`no network runs for ${ctx.app.id}`);
    if (ctx.membership.state !== "active") return; // waitlist or a recycled number: staff first
    if (!await this.createMember(rt, ctx.membership, { ...ctx.input, age: ctx.age })) throw new JoinReviewRequired();
    await rt.unitOfWork(n => { n.welcomeJoined(ctx.membership.memberId); });
    await this.learnJoinProfile(rt, ctx.person.id, ctx.e164, ctx.membership);
  }

  /**
   * The approved profile that came with the join (the agent's `about`, with the home area and ZIP, as
   * stored on the membership), given once to the welcomed member as profile input from their own agent
   * (submitProfile): the Network learns it with its usual rules. The join already counted any age the
   * text states (Accounts.statedJoinAge). A failure here never undoes the join: the member exists and
   * has the welcome, so the member gives the missing fields in the conversation.
   */
  // spec/siteEnrollment.md, "The approved profile reaches onboarding and its stated age counts"
  private async learnJoinProfile(rt: NetworkRuntime, personId: string, e164: string, membership: Membership): Promise<void> {
    const field = (key: "about" | "neighborhood" | "zip") => {
      const value = membership.profile[key];
      return typeof value === "string" ? value : undefined;
    };
    const text = joinProfileText({ about: field("about"), neighborhood: field("neighborhood"), zip: field("zip") });
    if (!text) return;
    await this.submitProfile(personId, rt.app.id, e164, text)
      .catch(e => this.log(`[join] profile not learned (${rt.id}): ${(e as Error).message}`));
  }

  private async commitReferredJoin(ctx: JoinHookContext & { referral: EnrollmentReferral }): Promise<void> {
    const browserHome = publicSignupUsesBrowser(ctx.app.id) ? this.runtimeFor(ctx.app.id)?.city : undefined;
    const rt = this.runtimeForHome(ctx.app.id, ctx.input.homeCity ?? browserHome ?? "");
    const at = ctx.membership.joinedAt;
    if (!rt || ctx.membership.state !== "active" || at === null) throw new InvitationUnavailable();
    const referral = ctx.referral;
    const memberReferral = "inviterMemberId" in referral ? referral : undefined;
    // A verified person can already exist. The active membership, consent and referral are one outcome.
    await rt.scoped(async tx => {
      const accounts = this.accountsFor(tx);
      if (!await new PgPeopleStore(tx).enrollmentOwnerAllowed(tx, ctx.person.id, ctx.e164, accounts.phoneHash(ctx.e164))) {
        throw new JoinReviewRequired();
      }
      const verifiedRecipientHash = memberReferral ? await this.expectedInvitationBinding(tx, ctx.app.id, memberReferral.tokenHash, ctx.e164) : undefined;
      if (!memberReferral && !await this.invitationRecipientMayRedeem(tx, ctx.app.id, ctx.e164)) throw new InvitationUnavailable();
      if (memberReferral && verifiedRecipientHash === undefined) await accounts.store.unsuppress(accounts.phoneHash(ctx.e164));
      await accounts.store.putMembership(ctx.membership);
      await accounts.store.addConsent({ e164: ctx.e164, app: ctx.app.id, state: "opted_in", source: "web_form", wording: ctx.app.consent.text, wordingVersion: ctx.app.consent.version, at });
      await accounts.store.attachPerson(ctx.e164, ctx.person.id, ctx.session ?? null, at);
      if (!await this.createMember(rt, ctx.membership, { ...ctx.input, age: ctx.age }, { tx, referral: memberReferral, verifiedRecipientHash })) throw new JoinReviewRequired();
      if ("kind" in referral) {
        await this.seedInvitations.consume(tx, {app: ctx.app.id, referral, e164: ctx.e164, memberId: ctx.membership.memberId});
      }
    });
    // The token is consumed and attribution is durable. A failed welcome can retry independently,
    // and the joined profile follows whichever call sends the welcome.
    const project = memberReferral ? this.projectInvitationJoin(rt, ctx.membership.memberId) : this.projectSeedWelcome(rt, ctx.membership.memberId);
    await project.catch(() => this.log(`[invite] joined projection waits for retry (${rt.id})`));
  }

  private async projectSeedWelcome(rt: NetworkRuntime, memberId: MemberId): Promise<void> {
    const app = rt.app.id;
    const welcomed = await rt.unitOfWork(async net => {
      const [pending] = await rt.scoped(tx => tx<{home_city: string}[]>`select m.home_city from platform.seed_invitation_attributions a
        join network.members m on m.app_id=a.app_id and m.id=a.member_id
        where a.app_id=${app} and a.member_id=${memberId} and a.welcome_projected_at is null`);
      if (!pending || !projectInvitationWelcome(true, this.runtimeForHome(app, pending.home_city) === rt, false)) return false;
      net.welcomeJoined(memberId);
      rt.unit.memberCommand = async tx => {
        const rows = await tx`update platform.seed_invitation_attributions set welcome_projected_at=${new Date(this.clock.now())}
          where app_id=${app} and member_id=${memberId} and welcome_projected_at is null returning member_id`;
        if (rows.length !== 1) throw new InvitationUnavailable();
      };
      return true;
    });
    if (welcomed) await this.learnWelcomedProfile(rt, memberId);
  }

  /**
   * The joined profile follows the call that sent the welcome (also a later recovery). The welcome
   * is recorded once (welcome_projected_at), so the profile is learned once. Both welcome paths
   * share one limit: when the unit commits the welcome and then fails, recovery finds the welcome
   * recorded and does not learn the profile.
   */
  // spec/siteEnrollment.md, "The approved profile reaches onboarding and its stated age counts"
  private async learnWelcomedProfile(rt: NetworkRuntime, memberId: MemberId): Promise<void> {
    try {
      const [invitee] = await rt.scoped(tx => tx`select m.person_id, ph.e164 from network.members m join platform.phone_identities ph on ph.person_id=m.person_id
        where m.app_id=${rt.app.id} and m.id=${memberId}`);
      const membership = invitee && await this.people.getMembership(invitee.person_id as string, rt.app.id);
      if (invitee && membership?.memberId === memberId) await this.learnJoinProfile(rt, invitee.person_id as string, invitee.e164 as string, membership);
    } catch (e) {
      this.log(`[invite] joined profile not learned (${rt.id}): ${(e as Error).message}`);
    }
  }

  private async recoverSeedInvitationJoins(rt: NetworkRuntime): Promise<void> {
    const app = rt.app.id;
    const cities = rt.cities;
    if (!cities.length) return;
    const pending = await rt.scoped(tx => tx<{member_id: string}[]>`select a.member_id from platform.seed_invitation_attributions a
      join network.members m on m.app_id=a.app_id and m.id=a.member_id
      where a.app_id=${app} and a.welcome_projected_at is null and m.home_city in ${tx(cities)}
      order by a.redeemed_at,a.member_id limit 20`);
    for (const row of pending) await this.projectSeedWelcome(rt, row.member_id);
  }

  private async projectInvitationJoin(rt: NetworkRuntime, memberId: MemberId): Promise<void> {
    const projected = await rt.unitOfWork(async net => {
      const app = rt.app.id;
      const [pending] = await rt.scoped(tx => tx`select i.token_hash,i.inviter_member_id,i.welcome_projected_at,
          v.home_city as inviter_home,m.home_city as invitee_home
        from platform.member_invitations i join network.members m on m.app_id=i.app_id and m.id=i.redeemed_member_id and m.invited_by=i.inviter_member_id
        join network.members v on v.app_id=i.app_id and v.id=i.inviter_member_id
        where i.app_id=${app} and i.redeemed_member_id=${memberId}`);
      if (!pending || !projectInvitationWelcome(true, this.runtimeForHome(app, pending.invitee_home as string) === rt, !!pending.welcome_projected_at)) return;
      const inviterRuntime = this.runtimeForHome(app, pending.inviter_home as string);
      const localNotice = inviterRuntime === rt;
      net.welcomeJoined(memberId, localNotice ? pending.inviter_member_id as MemberId : undefined);
      rt.unit.memberCommand = async tx => {
        const at = new Date(this.clock.now());
        const rows = await tx`update platform.member_invitations set welcome_projected_at=${at},
          projected_at=case when ${localNotice} then ${at} else projected_at end
          where app_id=${app} and token_hash=${pending.token_hash as string} and welcome_projected_at is null returning token_hash`;
        if (rows.length !== 1) throw new InvitationUnavailable();
      };
      return { remote: localNotice ? undefined : inviterRuntime };
    });
    if (!projected) return;
    await this.learnWelcomedProfile(rt, memberId);
    if (projected.remote) await this.projectInvitationNotice(projected.remote, memberId);
  }

  private async projectInvitationNotice(rt: NetworkRuntime, inviteeId: MemberId): Promise<void> {
    await rt.unitOfWork(async net => {
      const app = rt.app.id;
      const [pending] = await rt.scoped(tx => tx`select i.token_hash,i.inviter_member_id,i.redeemed_at,i.welcome_projected_at,i.projected_at,v.home_city
        from platform.member_invitations i join network.members v on v.app_id=i.app_id and v.id=i.inviter_member_id
        join network.members m on m.app_id=i.app_id and m.id=i.redeemed_member_id and m.invited_by=v.id
        where i.app_id=${app} and i.redeemed_member_id=${inviteeId}`);
      if (!pending || !projectRemoteInvitationNotice(true, this.runtimeForHome(app, pending.home_city as string) === rt, !!pending.welcome_projected_at, !!pending.projected_at)) return;
      net.announceVerifiedInviteJoin(pending.inviter_member_id as MemberId, inviteeId, new Date(pending.redeemed_at as Date | string).getTime());
      rt.unit.memberCommand = async tx => {
        const rows = await tx`update platform.member_invitations set projected_at=${new Date(this.clock.now())}
          where app_id=${app} and token_hash=${pending.token_hash as string} and welcome_projected_at is not null and projected_at is null returning token_hash`;
        if (rows.length !== 1) throw new InvitationUnavailable();
      };
    });
  }

  private async recoverInvitationJoins(rt: NetworkRuntime): Promise<void> {
    const app = rt.app.id;
    const cities = rt.cities;
    const pending = await rt.scoped(tx => tx`select i.redeemed_member_id,i.welcome_projected_at from platform.member_invitations i
      join network.members m on m.app_id=i.app_id and m.id=i.redeemed_member_id
      join network.members v on v.app_id=i.app_id and v.id=i.inviter_member_id
      where i.app_id=${app} and i.redeemed_at is not null and i.projected_at is null
        and ((i.welcome_projected_at is null and m.home_city in ${tx(cities)}) or (i.welcome_projected_at is not null and v.home_city in ${tx(cities)}))
      order by i.redeemed_at, i.token_hash limit 20`);
    for (const row of pending) {
      const memberId = row.redeemed_member_id as string;
      const projection = row.welcome_projected_at ? this.projectInvitationNotice(rt, memberId) : this.projectInvitationJoin(rt, memberId);
      await projection.catch(() => this.log(`[invite] joined projection waits for retry (${rt.id})`));
    }
  }

  /**
   * Opt the person's members out (this app, or every app for a global stop): the membership reads
   * "paused" (GET /api/me shows it; START on the app's line makes it active again), and the Network
   * drops the member from open opportunities.
   */
  /** spec/databaseRestore.md, "A STOP after the backup is replayed on each membership it still covers": the member path of a STOP, with no consent event and no reply. */
  async replayStop(app: AppInfo, personId: string) { await this.stopped(app, personId, "app"); }

  private async stopped(app: AppInfo, personId: string, scope: StopScope, skip?: { rt: NetworkRuntime; memberId: MemberId }) {
    const ms = (await this.people.memberships(personId)).filter(m => m.state !== "removed" && m.state !== "invited" && (scope === "global" || m.app === app.id));
    for (const m of ms) {
      if (m.state === "active") await this.people.putMembership({ ...m, state: "paused" });
      const rt = await this.runtimeOfMember(m.app, m.memberId);
      if (!rt || (skip && skip.rt === rt && skip.memberId === m.memberId)) continue;
      await rt.unitOfWork(async n => {
        await n.onInbound({ id: `stop:${m.memberId}:${this.clock.now()}`, memberId: m.memberId, body: "STOP", ts: this.clock.now(), channel: "imessage", keyword: "STOP" });
        rt.unit.optOut.set(m.memberId, true);
      });
    }
  }

  /**
   * Run `fn` after a person leaves an app or deletes everything (once per app), with the person's phone.
   * The backend uses it to revoke the MCP server's OAuth grants of that app (packages/mcp revokeAllFor).
   */
  onForget(fn: (ctx: MemberHookContext) => Promise<unknown> | unknown) { this.forgetListeners.push(fn); }

  onEraseAccount(fn: (personId: string) => Promise<unknown> | unknown) { this.accountEraseListeners.push(fn); }
  onBan(fn: (phoneHashes: readonly string[]) => Promise<unknown> | unknown) { this.banListeners.push(fn); }
  /** Whether an account erasure hook (the connector's) is registered: the privacy replay of a restore waits for it. */
  eraseHooksRegistered(): boolean { return this.accountEraseListeners.length > 0; }

  /** Leave one app: the Network forgets the member, then the save deletes every row that names them (the forget path). */
  private async forget(app: AppInfo, memberId: MemberId, ordinaryLeavePersonId?: string) {
    const rt = await this.runtimeOfMember(app.id, memberId) ?? this.runtimeFor(app.id);
    if (!rt) return;
    await rt.unitOfWork(n => {
      const carriesHold = carryTrustHoldOnAppLeave(ordinaryLeavePersonId !== undefined, n.trust.level(memberId));
      const reports = n.reportRestrictionsForLeave(memberId, ordinaryLeavePersonId !== undefined);
      if (ordinaryLeavePersonId && (carriesHold || reports.length)) {
        const at = this.clock.now();
        rt.unit.memberCommand = async tx => {
          if (carriesHold) await recordCarriedTrustHold(tx, app.id, memberId, ordinaryLeavePersonId, at);
          if (reports.length) await carryReportRestrictions(tx, { app: app.id, runtime: rt.id }, memberId, ordinaryLeavePersonId, reports);
        };
      }
      n.forgetMember(memberId);
      rt.unit.forget.add(memberId);
    });
  }

  /** spec/accountPrivacy.md, "An export includes the member's own facts and photo metadata" */
  private async exportMember({ app, memberId, personId }: MemberHookContext) {
    const a = app.id;
    const rt = this.runtimeFor(a);
    if (!rt) return null;
    const data = await rt.scoped(async tx => {
      const [member] = await tx`select id, name, home_city, home_area, age, account_status, opted_out, joined_at from network.members
        where app_id=${a} and id=${memberId} and person_id=${personId}::uuid and account_status<>'removed'`;
      const includeGatherings = memberExportGatheringsAllowed(a, !!member);
      if (!member) return null;
      const records = await tx<{ kind: string; value: string; tags: string[]; provenance: string; source: string | null; status: string; valid_from: Date; privacy_scope: string }[]>
        `select kind, value, tags, provenance, source, status, valid_from, privacy_scope from network.facets
          where app_id=${a} and member_id=${memberId} order by id`;
      const facets = records.filter(facet => memberExportFacetAllowed(facet.privacy_scope, facet.status, facet.provenance, facet.source ?? "",
        facet.tags.some(tag => tag.startsWith(APPEARANCE_PREFIX))))
        .map(({ kind, value, tags, provenance, status, valid_from }) => ({ kind, value, tags, provenance, status, valid_from }));
      const intents = await tx`select objective, category, status, created_at from network.intents
        where app_id=${a} and member_id=${memberId} order by created_at, id`;
      const presence = await tx`select city, type, areas from network.presence where app_id=${a} and member_id=${memberId}`;
      const messages = await tx`select direction, body, ts from network.messages where app_id=${a} and member_id=${memberId} order by ts, id`;
      const opportunities = await tx`select o.id, o.kind, o.state, o.created_at, o.meeting_at, p.role from network.participations p
        join network.opportunities o on o.app_id=p.app_id and o.id=p.opportunity_id
        where p.app_id=${a} and p.member_id=${memberId} order by o.created_at, o.id`;
      const gatherings = includeGatherings ? await tx<{
        gathering_id: string; revision: number; venue_name: string; starts_at: Date; ends_at: Date;
        choice: string; responded_at: Date; attended: boolean | null; attended_at: Date | null;
        follow_up_choices: { wanted: boolean; respondedAt: string }[];
      }[]>`select r.gathering_id, r.revision, g.venue_name, g.starts_at, g.ends_at, r.choice, r.responded_at,
          attendance.attended, attendance.responded_at as attended_at,
          coalesce((select jsonb_agg(jsonb_build_object('wanted', followup.wanted, 'respondedAt', followup.responded_at)
            order by followup.responded_at, followup.wanted)
            from network.monthly_gathering_followup_choices followup
            where followup.app_id=r.app_id and followup.gathering_id=r.gathering_id and followup.revision=r.revision
              and followup.member_id=r.member_id), '[]'::jsonb) as follow_up_choices
        from network.monthly_gathering_rsvps r
        join network.monthly_gatherings g on g.app_id=r.app_id and g.id=r.gathering_id and g.revision=r.revision
        left join network.monthly_gathering_attendance attendance on attendance.app_id=r.app_id
          and attendance.gathering_id=r.gathering_id and attendance.revision=r.revision and attendance.member_id=r.member_id
        where r.app_id=${a} and r.member_id=${memberId} order by g.starts_at, r.gathering_id` : undefined;
      return {
        member, facets, intents: [...intents], presence: [...presence], messages: [...messages], opportunities: [...opportunities],
        ...(gatherings && { gatherings: gatherings.map(gathering => ({
          gatheringId: gathering.gathering_id, revision: gathering.revision, venue: gathering.venue_name,
          startsAt: gathering.starts_at.toISOString(), endsAt: gathering.ends_at.toISOString(),
          rsvp: { choice: gathering.choice, respondedAt: gathering.responded_at.toISOString() },
          attendance: gathering.attended_at === null ? null : { attended: gathering.attended, respondedAt: gathering.attended_at.toISOString() },
          followUpChoices: gathering.follow_up_choices.map(choice => ({ ...choice, respondedAt: new Date(choice.respondedAt).toISOString() })),
        })) }),
      };
    });
    return data && { ...data, photos: await this.photos.list(personId, a) };
  }

  /**
   * The member's availability for the site's Settings (GET /api/me), read from the member record the
   * Network uses (participation_state and participation_window, written by /internal/set-state when the
   * member pauses by text). Nothing is copied: the site reads it on every request. A window that has
   * ended reads as no window. The opt-out (STOP) is not part of it: /api/me shows that in smsOptedIn.
   */
  private async memberParticipation(app: AppInfo, memberId: MemberId): Promise<MemberParticipation | null> {
    const rt = this.runtimeFor(app.id);
    if (!rt) return null;
    const [row] = await rt.scoped(tx => tx`select participation_state, participation_window, prefs from network.members where app_id = ${app.id} and id = ${memberId}`);
    if (!row) return null;
    const now = this.clock.now();
    const p = effectiveParticipation({ participation_state: row.participation_state, participation_window: row.participation_window }, now);
    const w = p.window && (p.window.until === null || Date.parse(p.window.until) > now) ? p.window : null;
    const q = row.prefs?.quietHours;
    const quietHours: [number, number] | undefined = Array.isArray(q) && q.length === 2 && q.every((h: unknown) => Number.isInteger(h) && (h as number) >= 0 && (h as number) < 24) ? [q[0], q[1]] : undefined;
    const base = row.participation_state === "paused" ? "paused" : row.participation_state === "quiet" ? "busy" : "open";
    return { state: w ? w.state : base, from: w?.from ?? null, until: w?.until ?? null, ...(quietHours ? { quietHours } : {}) };
  }

  /**
   * Resume from the site's Settings: the availability pause ends now (the window is cleared, and a
   * paused participation state goes back to normal). Messaging consent does not change: a member who
   * texted STOP stays stopped until they text START. The request is an event, like the agent's.
   */
  private async resumeMember(app: AppInfo, memberId: MemberId): Promise<void> {
    const rt = this.runtimeFor(app.id);
    if (!rt) return;
    await rt.scoped(async tx => {
      const [row] = await tx`select participation_state, participation_window from network.members where app_id = ${app.id} and id = ${memberId} for update`;
      if (!row || (row.participation_window === null && row.participation_state !== "paused")) return;
      await tx`update network.members set participation_window = null,
        participation_state = case when participation_state = 'paused' then 'normal' else participation_state end where app_id = ${app.id} and id = ${memberId}`;
      await tx`insert into network.events(app_id, at, actor_type, actor_id, type, object_type, object_id, payload)
        values (${app.id}, ${new Date(this.clock.now())}, 'member', ${memberId}, 'member_state_requested', 'member', ${memberId}, ${{ state: "open", from: null, until: null, source: "site" }}::jsonb)`;
    });
  }

  private async memberHome(ctx: MemberHookContext): Promise<HomeInput | null> {
    const [row] = await this.runtimeFor(ctx.app.id)?.scoped(tx => tx`select home_city, home_area from network.members where app_id=${ctx.app.id} and id=${ctx.memberId} and person_id=${ctx.personId}::uuid`) ?? [];
    const homeCity = homeCityOf(row?.home_city);
    return homeCity ? { homeCity, ...(row.home_area ? { neighborhood: row.home_area } : {}) } : null;
  }

  private async correctHome(ctx: MemberHookContext, input: HomeInput): Promise<HomeInput | "runtime_change_unsupported" | null> {
    // Hold this app's runtime locks while checking ownership and updating the home, so an inbound
    // unit cannot observe a partial correction. Cross-runtime moves are refused below.
    const runtimes = [...this.runtimes.values()].filter(r => r.app.id === ctx.app.id).sort((a, b) => a.id.localeCompare(b.id));
    const locked = (i: number): Promise<HomeInput | "runtime_change_unsupported" | null> => i < runtimes.length
      ? runtimes[i]!.store.withLock(() => locked(i + 1))
      : this.sql.begin(async tx => {
        await tx`select set_config('app.app_id', ${ctx.app.id}, true)`;
        const [member] = await tx`select m.home_city, m.home_area, pm.profile from network.members m
          join platform.memberships pm on pm.app_id=m.app_id and pm.member_id=m.id and pm.person_id=m.person_id
          join platform.people p on p.id=m.person_id
          join platform.phone_identities ph on ph.person_id=p.id and ph.e164=${ctx.e164}
          where m.app_id=${ctx.app.id} and m.id=${ctx.memberId} and m.person_id=${ctx.personId}::uuid
            and pm.state in ('active','onboarding') and pm.review is null and p.deleted_at is null and ph.hold is null
            and m.account_status not in ('invited','removed','restricted')
            and not exists(select 1 from platform.bans b where b.person_id=p.id or b.phone_hash=${this.phoneKey(ctx.e164)})
          for update of m, pm, p, ph`;
        if (!member) return null;
        // Moving between existing runtime stores needs a full conversation-state transfer. Never
        // silently abandon that state; an unserved home still uses the same default runtime.
        if (this.runtimeForHome(ctx.app.id, member.home_city) !== this.runtimeForHome(ctx.app.id, input.homeCity)) return "runtime_change_unsupported";
        const homes = await tx`select city, areas from network.presence where app_id=${ctx.app.id} and member_id=${ctx.memberId} and type='home'`;
        const area = input.neighborhood ?? null, areas = area ? [area] : [];
        const profile = { ...member.profile, homeCity: input.homeCity };
        if (area) profile.neighborhood = area; else delete profile.neighborhood;
        if (member.home_city === input.homeCity && member.home_area === area && JSON.stringify(member.profile) === JSON.stringify(profile)
          && homes.length === 1 && homes[0]!.city === input.homeCity && JSON.stringify(homes[0]!.areas) === JSON.stringify(areas)) return input;
        await tx`update platform.memberships set profile=${profile}::jsonb where app_id=${ctx.app.id} and person_id=${ctx.personId}::uuid`;
        await tx`update network.members set home_city=${input.homeCity}, home_area=${area} where app_id=${ctx.app.id} and id=${ctx.memberId}`;
        await tx`delete from network.presence where app_id=${ctx.app.id} and member_id=${ctx.memberId} and type='home'`;
        await tx`insert into network.presence(app_id,member_id,city,type,areas) values (${ctx.app.id},${ctx.memberId},${input.homeCity},'home',${tx.array(areas,"TEXT")})`;
        return input;
      });
    return locked(0);
  }

  /**
   * The public API the four sites call (/api/*). Built on first use: outside dev it needs an OTP
   * provider (OTP_PROVIDER=twilio) and Turnstile (TURNSTILE_SECRET_KEY); the dev shortcuts refuse.
   */
  get publicApi(): PublicApi {
    this.api ??= createPublicApi({
      store: this.people, turnstile: this.apiOptions?.turnstile ?? turnstileFromEnv(this.env),
      hashKey: this.hashKey, apps: this.apps, env: this.env,
      now: () => this.clock.now(), log: this.log, ...this.apiOptions, ...this.hooks(), photos: this.photos, photoLinks: this.photoLinks, photoRelay: this.photoRelay,
      participation: ctx => this.memberParticipation(ctx.app, ctx.memberId),
      onResume: ctx => this.resumeMember(ctx.app, ctx.memberId),
      home: ctx => this.memberHome(ctx),
      onHome: (ctx, input) => this.correctHome(ctx, input),
      homeHelpVenue: (app, who, input) => this.privateHomeHelpVenue(app, who, input),
      calendarInvite: async (app, code) => (await this.runtimeFor(app.id)?.scoped(tx => requestedCalendarFile(tx, this.accountsFor(tx), app, code, () => this.clock.now())))
        ?? Response.json({ ok: false, error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } }),
      // Each code Twilio Verify sends is a cost row (cost.ts).
      otp: this.cost.meterOtp(this.apiOptions?.otp ?? otpProviderFromEnv(this.env)),
    });
    return this.api;
  }
  /** The public API handler for serveHttp: /api/* or 404. */
  publicFetch = async (req: Request, server?: PeerInfo): Promise<Response> => (await this.publicApi.fetch(req, server)) ?? Response.json({ ok: false, error: "not_found" }, { status: 404 });

  // ------------------------------------------------------------------ inbound
  private async route(ev: Extract<ChannelEvent, { kind: "message" }>, forced?: AppId, threadRead = false): Promise<Route> {
    let dedicated = forced;
    if (!dedicated && ev.to) {
      const line = normalizeAddress(ev.to);
      const [r] = await this.sql`select app_id from platform.app_lines where line_e164 = ${line}`;
      if (r && isAppId(r.app_id)) dedicated = r.app_id;
    }
    const profileApp = dedicated ? undefined : profileReadRequest(ev.text, this.apps)?.app;
    const survey = dedicated ? undefined : interruptionFeedbackAnswer(ev.text);
    const surveyApp = survey && isAppId(survey.app) ? survey.app : undefined;
    const keywordApp = dedicated || profileApp || surveyApp ? undefined : this.namedApp(ev.text);
    const explicitFacts = { dedicated: !!dedicated, profileApp: !!profileApp, surveyApp: !!surveyApp, appKeyword: !!keywordApp };
    const explicit = checkExplicitRoute(initialRoute, explicitFacts);
    if (explicit.phase === "DedicatedRoute" && dedicated) return { app: dedicated, shared: false };
    if (explicit.phase === "ProfileRoute" && profileApp) return { app: profileApp, shared: true };
    if (explicit.phase === "SurveyRoute" && surveyApp) return { app: surveyApp, shared: true };
    if (explicit.phase === "KeywordRoute" && keywordApp) return { app: keywordApp, shared: true };
    const mine = (await this.memberApps(ev.from)).filter(x => this.runtimeFor(x.app));
    const e164 = normalizePhone(ev.from);
    if (threadRead && e164) {
      const ranked = [...mine].sort((a, b) => (b.lastItem ?? 0) - (a.lastItem ?? 0) || (b.lastOut ?? 0) - (a.lastOut ?? 0));
      for (const { app, memberId } of ranked) {
        const rt = this.runtimeFor(app)!;
        const binding = await rt.scoped(tx => memberCommandOwner(tx, this.accountsFor(tx), { app: rt.app, memberId, e164 }));
        if (binding?.member) return { app, shared: true };
      }
      return { app: "ntwrk", shared: true };
    }
    const pending = e164 ? await this.pendingOf(e164, "join") : undefined;
    const alreadyInPendingApp = !!pending && mine.some(x => pendingMatchesApp(pending.app, x.app));
    const hasMembership = mine.length > 0;
    const answerHasAge = shouldReadPendingAnswer(!!pending, alreadyInPendingApp, hasMembership)
      && parseJoinText(ev.text, this.appWords(), true).age !== undefined;
    const safetyApp = await this.safetyRoute(mine, ev.text, answerHasAge);
    const fallback = checkFallbackRoute(explicit, {
      safetyClaim: !!safetyApp, hasPendingJoin: !!pending, alreadyInPendingApp, hasMembership, answerHasAge,
      hasOpenItem: mine.some(x => x.lastItem !== null),
    });
    if (fallback.phase === "SafetyRoute" && safetyApp) return { app: safetyApp, shared: true };
    if (fallback.phase === "PendingJoinRoute" && pending) return { app: pending.app, shared: true };
    if (fallback.phase === "OpenItemRoute") {
      const open = mine.filter(x => x.lastItem !== null).sort((a, b) => b.lastItem! - a.lastItem!)[0]!;
      return { app: open.app, shared: true };
    }
    if (fallback.phase === "RecentAppRoute") {
      const last = [...mine].sort((a, b) => (b.lastOut ?? 0) - (a.lastOut ?? 0))[0]!;
      return { app: last.app, shared: true };
    }
    return { app: "ntwrk", shared: true };
  }

  private async safetyRoute(mine: { app: AppId; memberId: MemberId; lastOut: number | null }[], text: string, joinAnswerWithAge: boolean): Promise<AppId | undefined> {
    const kind = classify(text.trim()).kind;
    const safetyCommand = kind === "block" || kind === "report";
    if (!safetyRouteReadNeeded(mine.length, safetyCommand, text.trim().split(/\s+/).length)) return undefined;
    let lead: { app: AppId; at: number } | undefined;
    for (const { app, memberId } of mine) {
      const rt = await this.runtimeOfMember(app, memberId);
      if (!rt) continue;
      const questionStored = !safetyCommand && await this.safetyQuestionStored(rt, memberId);
      if (!safetyAppReadNeeded(safetyCommand, questionStored)) continue;
      const facts = await rt.readState(n => n.safetyRouteFacts(memberId, text));
      const newestOtherMessageAt = Math.max(-1, ...mine.filter(x => x.app !== app).map(x => x.lastOut ?? -1));
      const claims = safetyCommand ? safetyCommandClaims(facts.meetingAt) : safetyAnswerClaims(facts.pendingSafetyAt, newestOtherMessageAt, joinAnswerWithAge);
      const at = safetyCommand ? facts.meetingAt : facts.pendingSafetyAt;
      if (safetyClaimLeads(claims, at, lead?.at ?? -1)) lead = { app, at };
    }
    return lead?.app;
  }

  private async safetyQuestionStored(rt: NetworkRuntime, memberId: MemberId): Promise<boolean> {
    const waiting = JSON.stringify([{ id: memberId, pendingSafety: {} }]);
    const [row] = await rt.scoped(tx => tx`select (state->'members') @> ${waiting}::jsonb as waiting from network.network_state where id = ${rt.pg.id}`);
    return row?.waiting === true;
  }

  /** The apps this address is a joined member of, across apps (platform.member_apps: ids and times only). */
  async memberApps(address: string): Promise<{ app: AppId; memberId: MemberId; lastOut: number | null; lastItem: number | null }[]> {
    const rows = await this.sql`select app_id, member_id, last_out, last_item from platform.member_apps(${normalizeAddress(address)})`;
    return (rows as any[]).filter(r => isAppId(r.app_id)).map(r => ({
      app: r.app_id as AppId, memberId: r.member_id, lastOut: r.last_out ? new Date(r.last_out).getTime() : null, lastItem: r.last_item ? new Date(r.last_item).getTime() : null,
    }));
  }

  private appWords() { return Object.values(this.apps).flatMap(a => [a.id, ...a.domain.split(".")]); }

  /** A standalone app keyword, a prepared Peon signup, or an explicitly app-named Peon command. */
  namedApp(text: string): AppId | undefined {
    if (namesPeonSearch(text)) return "peon";
    const lineBreak = text.indexOf("\n");
    if (lineBreak >= 0) {
      const header = text.slice(0, lineBreak).replace(/\r$/, "");
      if (preparedPeonTextNamesApp(header, !!text.slice(lineBreak + 1).trim())) return "peon";
    }
    return keywordApp(text, this.apps);
  }

  /** A pending text flow of this phone that is not older than a day. */
  private async pendingOf(e164: string, kind: PendingText["kind"], app?: AppId): Promise<PendingText | undefined> {
    const p = await this.people.getPending(this.phoneKey(e164), kind, app);
    return p && this.clock.now() - p.at < PENDING_MS ? p : undefined;
  }

  /** A verified, parsed channel event (Blooio webhook). `app`: the per-app webhook path. */
  inboundTurn = () => this.inbox.currentTurn();
  collectReplies = (tx: SQL, replies: CollectedReply[], reason?: AtomicReplyReason) => this.inbox.collect(tx, replies, reason);

  async inbound(ev: ChannelEvent, o: { app?: AppId } = {}): Promise<InboundOutcome> {
    switch (ev.kind) {
      case "ignored": case "typing": return "ignored";
      case "status": {
        // A receipt for any app's message on the line (the queue is shared): the row's own network stores it.
        const d = await this.lineAdapter()?.status?.(ev);
        const rt = d?.memberId && d.app && isAppId(d.app) ? this.runtimeFor(d.app) : undefined;
        if (d && rt) await rt.storeStatuses([d]);
        return "status";
      }
      case "safety":
        await this.lineAdapter()?.lineSafety?.(ev.type === "safety.number_banned" ? "review" : ev.action, ev.type);
        this.log(`[safety] ${ev.type} action=${ev.action ?? "-"}`);
        return "safety";
      case "reaction": {
        // spec/safetyCase.md, "A ban allows only carrier commands and app leave"
        const reactor = normalizePhone(ev.from);
        if (!reactor || !(await this.accounts.banned(reactor))) await this.lineAdapter()?.engaged?.(ev.from);
        return "reaction";
      }
      case "message": break;
    }
    if (ev.isGroup) return "ignored_group";
    const kw = platformKeyword(ev.text);
    const factCommand = !kw && memberFactCommand(ev.text);
    const intentCommand = !kw ? standingIntentCommand(ev.text) : undefined;
    const controls = !kw && participationCommand(ev.text);
    const calendar = !kw && calendarInviteRequest(ev.text);
    const gatheringRsvp = !kw && gatheringRsvpCommand(ev.text);
    const gatheringFollowup = !kw && gatheringFollowupRequested(ev.text);
    const surveyAnswer = !kw && interruptionFeedbackAnswer(ev.text);
    const travel = !kw && this.inboundTurn() ? travelPresenceCommand(ev.text) : undefined;
    const soloEvents = !kw && this.inboundTurn() ? soloConciergeRequest(ev.text) : undefined;
    const contributionPage = !kw && this.inboundTurn() ? contributionHistoryRequest(ev.text) : undefined;
    const threadRead = !kw && threadUpdateRequested(ev.text);
    const e164 = normalizePhone(ev.from);
    const banned = !!e164 && await this.accounts.banned(e164);
    const legacyEngagement = !banned && !this.inboundTurn() && !intentCommand && !factCommand && !controls && !calendar && !gatheringRsvp && !gatheringFollowup;
    const route = await this.route(ev, o.app, threadRead && !!this.inboundTurn() && !banned);
    const app = this.apps[route.app];
    const joinedMember = (await this.memberApps(ev.from)).find(m => m.app === route.app);
    let rt = joinedMember && await this.runtimeOfMember(route.app, joinedMember.memberId);
    if (!rt) {
      for (const candidate of this.runtimes.values()) {
        if (candidate.app.id !== route.app) continue;
        await candidate.identities();
        if (candidate.memberOf(ev.from)) { rt = candidate; break; }
      }
    }
    rt ||= this.runtimeFor(route.app);
    if (!rt) { this.log(`[inbound] no network runs for ${route.app}; not stored`); return "no_network"; }
    // Only the routed network's address book (each runtime refreshes its own inside its units of work).
    await rt.identities();
    const memberId = rt.memberOf(ev.from);
    const turn = this.inboundTurn();
    if (turn) { turn.app = app.id; turn.memberId = memberId; }
    const t = this.clock.now();
    const rowId = `in:${ev.channel}:${ev.messageId}`;
    const profileRead = !kw ? profileReadRequest(ev.text, this.apps) : undefined;
    const line = ev.to ? normalizeAddress(ev.to) : undefined;
    const declineAtAge = async () => {
      await this.direct(rt, ev.from, app.brand.underAge, `sys:${rowId}`, "compliance");
      return "under_age" as const;
    };

    // spec/lineRouting.md, "STOP ends the message before any other check"
    const leavingId = leaveTarget(ev.text, this.apps);
    let gate = readLineCommand(lineGateStart, LINE_COMMAND[kw ?? "none"], !!leavingId);
    if (gate.phase === "LineStopped") {
      if (legacyEngagement) await this.lineAdapter()?.engaged?.(ev.from);
      const scope: StopScope = stopCoversEveryApp(kw === "stop_all", route.shared, stopScope(this.env) === "global") ? "global" : "app";
      return this.stop(kw === "stop_all" ? "stop_all" : "stop", ev.from, app, rt, scope, rowId, line, ev);
    }

    // spec/lineRouting.md, "A banned number gets only HELP and app leave"
    gate = checkLineBan(gate, banned);
    if (gate.phase === "LineBannedIgnored") { this.log(`[inbound] a banned number (${rt.id}): not handled`); return "held"; }
    if (gate.phase === "LineBannedHelp") {
      await this.direct(rt, ev.from, app.brand.help, `sys:${rowId}`, "compliance");
      return "held";
    }

    // spec/lineRouting.md, "A confirmed age under 13 gets only HELP and app leave"
    const memberAge = e164 && memberId ? await this.accounts.lowestAge(e164, await this.accounts.personFor(e164)) : undefined;
    gate = checkLineAge(gate, memberAge ?? -1);
    if (gate.phase === "LineAgeDeclined") return declineAtAge();
    if (gate.phase === "LineUnderageHelp") {
      await this.direct(rt, ev.from, app.brand.help, `sys:${rowId}`, "compliance");
      return "handled";
    }
    // Legacy webhooks own transport engagement. A signed turn admits its canonical member after policy processing.
    if (legacyEngagement && kw !== "start") await this.lineAdapter()?.engaged?.(ev.from);

    // spec/lineRouting.md, "An invitation decline and a held number come before any flow"
    gate = checkLineInviteDecline(gate, memberInviteDeliveryCommand(ev.text)?.kind === "decline");
    if (gate.phase === "LineInviteDeclined") {
      if (turn && e164) await rt.scoped(async tx => {
        await this.expectedInvitations.decline(tx, e164);
        await this.seedInvitations.decline(tx, {app: app.id, e164});
      });
      return "handled";
    }
    // Reading the hold records the number as seen; a number unused for 12 months goes on hold for staff review.
    gate = checkLineNumberHold(gate, lineNumberHoldReadNeeded(banned) && !!e164 && (await this.accounts.seen(e164)) === "held");
    if (gate.phase === "LineNumberHeld") {
      this.log(`[inbound] a number on hold for review (${rt.id}): not handled`);
      if (lineHeldNumberGetsHelp(gate.phase, gate.command)) await this.direct(rt, ev.from, app.brand.help, `sys:${rowId}`, "compliance");
      return "held";
    }

    if (factCommand) {
      if (!memberId || !turn || ev.mediaUrls?.length) return "profile_fact_edit";
      return this.memberUnit(rt, memberId, ev, rowId, undefined);
    }
    if (gatheringRsvp || gatheringFollowup) {
      if (banned || !memberId || !turn || ev.mediaUrls?.length) return gatheringRsvp ? "gathering_rsvp" : "gathering_followup";
      return this.memberUnit(rt, memberId, ev, rowId, undefined);
    }
    if (!kw && route.app === "peon" && peonSearchCommand(ev.text)) {
      if (!memberId || !turn || ev.mediaUrls?.length) return "peon_candidate_search";
      return this.memberUnit(rt, memberId, ev, rowId, undefined);
    }

    // Photos by text (photoIntake.ts): the answer to the photo consent ask, then any attachment. A photo
    // from a minor, an unknown age, a banned person or a non-member of slop is dropped before it is fetched.
    // Only an explicit YES PHOTOS / NO PHOTOS routed to slop: a bare yes or no goes on to the Network (a probe, a date ask, another app).
    if (!banned && e164 && !kw && !profileRead && !intentCommand && (await this.photoIntake.consentAnswer(e164, ev.text, rowId, route.app))) return "handled";
    // spec/photoUploadLink.md, "A link is issued only to an adult live member of a photo app who is not banned or held"
    if (!banned && e164 && !kw && !profileRead && !intentCommand && !ev.mediaUrls?.length && (await this.photoIntake.addRequest(e164, ev.text, rowId, route.app))) return "handled";
    if (!banned && e164 && !kw && !profileRead && !intentCommand && !ev.mediaUrls?.length && (await this.photoIntake.deleteRequest(e164, ev.text, rowId))) return "handled";
    if (!banned && e164 && ev.mediaUrls?.length && !profileRead && !intentCommand) {
      // A provider retry of the same message takes no photo twice.
      const first = (await this.people.hit(`photo_msg:${rowId}`, DAY, t)).count === 1;
      const r = first ? await this.photoIntake.photosIn(e164, ev.mediaUrls, rowId) : { outcome: "duplicate" as const };
      if (r.outcome !== "not_member" && !ev.text.trim()) return "handled";
    }

    // "leave <app>": that app only, on any line.
    const leaving = leavingId ? this.apps[leavingId] : undefined;
    if (leaving && e164) {
      const leaveMember = (await this.memberApps(ev.from)).find(m => m.app === leaving.id);
      const lrt = (leaveMember && await this.runtimeOfMember(leaving.id, leaveMember.memberId)) || this.runtimeFor(leaving.id);
      const notInApp = async () => {
        await this.direct(rt, ev.from, this.copyOf(leaving).notInApp, `sys:${rowId}`, "compliance");
        return "handled" as const;
      };
      if (!lrt) return notInApp();
      if (lrt !== rt) await lrt.identities();
      const person = await this.accounts.personFor(e164);
      const routedId = lrt.memberOf(ev.from);
      // A retry can follow Network cleanup that finished before the membership tombstone was written.
      const membership = !routedId && person ? await this.people.getMembership(person.id, leaving.id) : undefined;
      const lid = routedId ?? membership?.memberId;
      if (!lid) return notInApp();
      if (leaveReply(!!routedId, membership?.state === "invited", membership?.state === "removed", !!membership) === "NotInAppReply") return notInApp();
      if (!person && !await lrt.scoped(async tx => (await tx`select id from network.members
        where app_id=${leaving.id} and id=${lid} and person_id is null`).length > 0)) return "held";
      const at = this.consentAt(ev);
      const left = await this.accounts.leave(leaving, { e164, personId: person?.id ?? null },
        { at, line, ref: rowId, expectedMemberId: person ? lid : undefined });
      if (!left) return "held";
      if (!person) await this.forget(leaving, lid);
      if (turn) { turn.app = leaving.id; turn.memberId = lid; turn.consent = {state: "opted_out", scope: "app", app: leaving.id, at}; turn.confirmation = {id: `sys:${rowId}`, body: this.copyOf(leaving).leftApp}; }
      await this.direct(lrt, ev.from, this.copyOf(leaving).leftApp, `sys:${rowId}`, "compliance");
      return "left";
    }
    if (banned) return "held";

    if (threadRead) {
      if (!turn || !e164 || !memberId || ev.mediaUrls?.length) return "inbox_updates";
      return this.threadUpdatesTurn(rt, memberId, ev, rowId, route);
    }

    // An account command never joins an app or opts the sender in.
    if (!memberId && surveyAnswer) return "handled";
    if (!memberId && (profileRead || intentCommand || controls || calendar || travel || soloEvents || contributionPage !== undefined)) {
      return controls ? "participation_controls" : calendar ? "calendar_invite" : travel ? "travel_presence" : soloEvents ? "solo_events" : contributionPage !== undefined ? "contribution_history" : "handled";
    }

    if (kw === "start" && e164) {
      const at = this.consentAt(ev);
      const start = await new PgPeopleStore(this.sql).recordCarrierStart({
        e164, app: app.id, line, state: "opted_in", source: "keyword:start", wording: "START keyword", ref: rowId, at,
      }, this.phoneKey(e164));
      if (start === "under_age") return declineAtAge();
      if (start === "held") return "held";
      if (start === "superseded") {
        this.log(`[inbound] START older than the last STOP (${rt.id}): not opted in`);
        return "handled";
      }
      if (legacyEngagement) await this.lineAdapter()?.engaged?.(ev.from);
      if (turn) turn.consent = { state: "opted_in", scope: "app", app: app.id, at };
    }

    if (memberId) {
      const reply = kw === "help" ? app.brand.help : undefined;
      if (!kw && e164 && /^\s*share\W*$/i.test(ev.text) && (await this.pendingOf(e164, "share", app.id))) return this.share(rt, app, memberId, e164, ev, rowId);
      if (!kw && e164 && /^\s*unshare\W*$/i.test(ev.text)) return this.unshare(rt, app, memberId, e164, ev, rowId);
      // The answer to The Network's "what are you looking for?": enroll in the apps they named.
      if (!intentCommand && !controls && !calendar && !travel && !soloEvents && contributionPage === undefined && shouldReadLookingFor(!!kw, !!profileRead, app.id === "ntwrk") && e164 && (await this.pendingOf(e164, "looking_for"))) {
        const wants = lookingFor(ev.text).filter(a => namedOtherApp(a, a !== "ntwrk" && !!this.runtimeFor(a)));
        if (wants.length) return this.enroll(rt, memberId, e164, wants, ev, rowId);
      }
      // After STOP the member's texts still reach the Network (a report is never dropped), but its replies are
      // refused: the person gets one hint instead (founder decision 2026-10-11, #22).
      if (!kw && e164 && !controls && !calendar && !surveyAnswer && contributionPage === undefined) await this.stopHint(rt, app, e164, ev, rowId);
      const out = await this.memberMessage(rt, memberId, ev, rowId, kw, reply);
      if (e164) await this.projectStatedAge(rt, memberId);
      return out;
    }

    // Not a member of this app. Nothing is stored about them unless they join (age check passed).
    if (!e164) { this.log(`[inbound] unknown sender (not a phone), ${ev.text.length} chars, not stored`); return "unknown_sender"; }
    if (kw === "help") { await this.direct(rt, ev.from, app.brand.help, `sys:${rowId}`, "compliance"); return "handled"; }
    // One text join per phone at a time (the same lock as a web join). In a signed turn, a person who is not a
    // member of any app first gets the one-time Eliza notice, then the normal join flow.
    return this.people.withLock(`join:${e164}`, async () => {
      await this.elizaNotice(app, e164, ev, rowId);
      const out = await this.join(rt, app, e164, ev, rowId, route);
      // The join question to someone who sent STOP is refused at send time: they get the one hint instead.
      if (out === "join_asked" && !kw) await this.stopHint(rt, app, e164, ev, rowId);
      // Under the join age: nothing is kept, the notice row included (the phone's age floor keeps a later notice away).
      const turn = this.inboundTurn();
      if (out === "under_age" && turn) await this.sql.begin(async tx => {
        await this.inbox.discardFirstContactNotice(tx, turn);
        await tx`delete from platform.eliza_notices where phone_hash = ${this.noticeKey(e164)}`;
      });
      return out;
    });
  }

  /**
   * A person whose last consent event for this app is an opt-out texted again (not a keyword): one short
   * compliance reply saying how to resume, at most once in 30 days per number and app. Not for a number that
   * erased everything (suppressed) or a banned one: those stay quiet.
   */
  private async stopHint(rt: NetworkRuntime, app: AppInfo, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<void> {
    const key = this.phoneKey(e164);
    if (resolveConsent(await this.people.lastConsent(e164, app.id)) !== "opted_out" || (await this.people.isSuppressed(key))) return;
    if (await this.people.isBanned(key, (await this.people.findPhone(e164))?.personId ?? null)) return;
    const { ok } = await this.people.hit(`stop_hint:${app.id}:${key}`, stopHintWindowMs, this.clock.now(), { minGapMs: stopHintWindowMs });
    if (ok) await this.direct(rt, ev.from, app.brand.stoppedHint, `sys:${rowId}`, "compliance");
  }

  private noticeKey(e164: string) { return keyedHash(this.hashKey, `eliza_notice:${e164}`); }

  /**
   * The approved one-time notice on the eliza.app line (README "The Eliza seam").
   * Only in a signed turn, only for a number that is not a member of any app,
   * once per number: the Inbox stores a keyed hash and time when it commits the reply containing the notice.
   * A failed turn leaves the key available. A banned number
   * and an age under the join age (stated now, pending, or on the phone's age floor) get no notice: the
   * join flow answers them as before. The TurnRequest has no "known eliza.app user" flag, so every such
   * first contact gets it. It enrolls nobody: joining still needs the age check and the opt-in.
   */
  private async elizaNotice(app: AppInfo, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<void> {
    const turn = this.inboundTurn();
    let nonMember = !!turn && (await this.memberApps(e164)).length === 0;
    for (const other of this.runtimes.values()) {
      if (!nonMember) break;
      await other.identities();
      nonMember = !other.memberOf(e164);
    }
    const person = nonMember ? await this.accounts.personFor(e164) : undefined;
    const banned = nonMember && await this.accounts.banned(e164, person);
    if (!turn || !firstContactMayCheckAge(true, nonMember, banned)) return;
    let pending = await this.pendingOf(e164, "join");
    if (pending && !pendingMatchesApp(pending.app, app.id)) pending = undefined;
    const age = parseJoinText(ev.text, this.appWords(), !!pending).age ?? pending?.age ?? undefined;
    const floor = await this.accounts.lowestAge(e164, person);
    if (!firstContactNoticeAllowed(true, nonMember, banned,
      age === undefined || joinAgeCheck(age, floor, app).ok, floor === undefined || canJoin(floor))) return;
    const phoneHash = this.noticeKey(e164), replyId = `notice:${rowId}`;
    await this.sql.begin(async tx => {
      if ((await tx`select 1 from platform.eliza_notices where phone_hash = ${phoneHash}`).length) return;
      turn.firstContactNotice = { phoneHash, replyId };
      await this.inbox.collect(tx, [{ id: replyId, body: ELIZA_NOTICE, kind: "compliance" }]);
    });
  }

  /**
   * The profile a person gave their own AI agent, sent through the MCP server's submit_profile
   * (founder decision 10): delivered to their member on this app with source "mcp", so the Network
   * reads it with the same rules (wants, interests, availability, an age that can only lower, minors
   * and abuse) but never takes it as the member's answer: not a yes to a probe, not a cancel of a
   * booked date, not a block or a report (InboundMessage.source). Only for a live membership; it
   * never creates a member. The text is the member's.
   */
  async submitProfile(personId: string, appId: AppId, e164: string, text: string): Promise<"accepted" | "not_member"> {
    const m = await this.people.getMembership(personId, appId);
    const rt = m && await this.runtimeOfMember(appId, m.memberId);
    if (!m || !rt || !["active", "onboarding"].includes(m.state)) return "not_member";
    if (await this.accounts.banned(e164)) return "not_member";
    const t = this.clock.now(), rowId = `agent_${randomUUID()}`;
    const ev: Extract<ChannelEvent, { kind: "message" }> = {
      kind: "message", channel: "imessage" as never, messageId: rowId, from: e164, to: null, chatId: e164, isGroup: false, text, mediaUrls: [], transport: "imessage" as never, receivedAt: t,
    };
    await this.memberMessage(rt, m.memberId as MemberId, ev, rowId, undefined, undefined, false);
    await this.projectStatedAge(rt, m.memberId as MemberId);
    return "accepted";
  }

  /** A member's message (or keyword) as one unit of work on their app's network. */
  private async memberMessage(rt: NetworkRuntime, memberId: MemberId, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string, kw: ReturnType<typeof platformKeyword>, systemReply?: string, fromThread = true): Promise<InboundOutcome> {
    // Not from the thread: a profile from the member's AI assistant, learned but never an answer (InboundMessage.source).
    const out = await this.memberUnit(rt, memberId, ev, rowId, kw, systemReply, !fromThread);
    // The member wrote in the thread: pending notify deliveries count as acted on (an assistant's submit_profile does not).
    if ((out === "handled" || out === "member_invitation" || out === "member_invitation_review" || out === "member_invitation_delivery" || out === "bounded_home_help")
      && fromThread && this.notify && kw !== "stop" && kw !== "stop_all" && !profileReadRequest(ev.text, this.apps)) {
      const personId = await this.personOfMember(rt, memberId);
      if (personId) await this.notify.threadReply(personId, ev.transport === "sms" ? "sms" : "imessage", this.clock.now()).catch(e => this.log(`[notify] thread reply not recorded: ${(e as Error).message}`));
    }
    return out;
  }

  private memberUnit(rt: NetworkRuntime, memberId: MemberId, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string, kw: ReturnType<typeof platformKeyword>, systemReply?: string, fromAssistant = false): Promise<InboundOutcome> {
    const keyword = kw === "stop" || kw === "stop_all" ? "STOP" : kw === "start" ? "START" : kw === "help" ? "HELP" : undefined;
    return rt.unitOfWork(async n => {
      if ((await rt.scoped(tx => tx`select 1 from network.messages where app_id = ${rt.app.id} and id = ${rowId}`)).length) return "duplicate" as const;
      if (n.isDeclined(memberId)) return "handled" as const;
      const t = this.clock.now();
      const channel = ev.transport === "sms" ? "sms" : "imessage";
      const source = fromAssistant ? "mcp" : "thread";
      const commandText = !keyword && inboundMayCommand(source);
      const surveyAnswer = commandText && interruptionFeedbackAnswer(ev.text);
      const bodyKind = inboundBody(source, !!surveyAnswer);
      const inbound = { id: rowId, member_id: memberId, direction: "inbound", channel,
        body: bodyKind === "InboundBodyAgentProfile" ? "Private profile from the member's agent." : bodyKind === "InboundBodyFeedback" ? "Private invitation feedback." : ev.text, status: "received",
        type: bodyKind === "InboundBodyAgentProfile" ? "agent_profile" : bodyKind === "InboundBodyFeedback" ? "interruption_feedback" : null, opportunity_id: null, proactive: false, system: false, ts: new Date(t) };
      const signedDirect = commandText && this.inboundTurn();
      const peonSearch = commandText && rt.app.id === "peon" && peonSearchCommand(ev.text);
      if (peonSearch) {
        const reason = "peon_candidate_search" as const;
        if (!signedDirect || !rt.signedMemberTurn(memberId, rowId)) return reason;
        rt.unit.memberCommand = async tx => {
          const owner = { app: rt.app, memberId, e164: signedDirect.from };
          const body = await applyPeonSearchCommand(tx, this.accountsFor(tx), owner, peonSearch, ev.receivedAt, this.clock.now());
          if (!body) return;
          rt.unit.inbound = inbound;
          rt.unit.atomicReply = reason;
          rt.collectedMemberReply(memberId, `sys:${rowId}`, body, reason);
        };
        return reason;
      }
      const gatheringRsvp = commandText && gatheringRsvpCommand(ev.text);
      const gatheringFollowup = commandText && gatheringFollowupCommand(ev.text);
      if (gatheringRsvp || (commandText && gatheringFollowupRequested(ev.text))) {
        const reason = gatheringRsvp ? "gathering_rsvp" : "gathering_followup";
        if ((!gatheringRsvp && !gatheringFollowup) || !signedDirect || !rt.signedMemberTurn(memberId, rowId)) return reason;
        rt.unit.memberCommand = async tx => {
          const owner = { app: rt.app, memberId, e164: signedDirect.from };
          const accounts = this.accountsFor(tx);
          const turn = { id: rowId, at: ev.receivedAt };
          const now = this.clock.now();
          const body = gatheringRsvp ? await saveGatheringRsvp(tx, accounts, owner, gatheringRsvp, turn, now)
            : gatheringFollowup && await saveGatheringFollowup(tx, accounts, owner, gatheringFollowup, turn, now, this.hashKey);
          if (!body) return;
          rt.unit.inbound = inbound;
          rt.unit.atomicReply = reason;
          rt.collectedMemberReply(memberId, `sys:${rowId}`, body, reason);
        };
        return reason;
      }
      const calendar = commandText && calendarInviteRequest(ev.text);
      if (calendar) {
        if (!signedDirect || !rt.signedMemberTurn(memberId, rowId)) return "calendar_invite";
        rt.unit.memberCommand = async tx => {
          const owner = { app: rt.app, memberId, e164: signedDirect.from };
          const origin = stagingSiteOrigins(this.env)[rt.app.id] ?? `https://${rt.app.domain}`;
          const reply = await issueCalendarInvite(tx, this.accountsFor(tx), owner, rt.pg.id, calendar, origin, this.clock.now());
          if (!reply) return;
          rt.unit.inbound = inbound;
          rt.unit.atomicReply = "calendar_invite";
          rt.collectedMemberReply(memberId, `sys:${rowId}`, reply.body, "calendar_invite", reply.link ? [reply.link] : []);
        };
        return "calendar_invite";
      }
      const controls = commandText && participationCommand(ev.text);
      if (controls) {
        if (!signedDirect || !rt.signedMemberTurn(memberId, rowId)) return "participation_controls";
        rt.unit.memberCommand = async tx => {
          const owner = { app: rt.app, memberId, e164: signedDirect.from };
          const body = await saveParticipationControl(tx, this.accountsFor(tx), owner, controls, rt.wiring.prefs(ADULT_AGE).categoriesOptIn, this.clock.now());
          if (body === undefined) return;
          rt.unit.inbound = inbound;
          rt.unit.atomicReply = "participation_controls";
          rt.collectedMemberReply(memberId, `sys:${rowId}`, body, "participation_controls");
        };
        return "participation_controls";
      }
      const factCommand = commandText && memberFactCommand(ev.text);
      if (factCommand) {
        if (!signedDirect || !rt.signedMemberTurn(memberId, rowId)) return "profile_fact_edit";
        rt.unit.memberCommand = async tx => {
          const owner = { app: rt.app, memberId, e164: signedDirect.from };
          const binding = await memberCommandOwner(tx, this.accountsFor(tx), owner);
          if (!profileFactEditMayRead(true, !!binding?.member, signedDirect.app === rt.app.id) || !binding?.member) return;
          const reply = await this.replyToProfileFactEdit(tx, rt, memberId, rowId, factCommand);
          rt.unit.inbound = inbound;
          rt.unit.atomicReply = "profile_fact_edit";
          rt.collectedMemberReply(memberId, reply.id, reply.body, "profile_fact_edit");
        };
        return "profile_fact_edit";
      }
      const inviteDelivery = commandText && memberInviteDeliveryCommand(ev.text);
      if (inviteDelivery) {
        if (!signedDirect || !rt.signedMemberTurn(memberId, rowId)) return "handled";
        rt.unit.inbound = inbound;
        rt.unit.privateInviteTurn = true;
        rt.unit.memberCommand = tx => this.replyToExpectedInvitation(tx, rt, memberId, signedDirect.from, rowId, inviteDelivery);
        return "member_invitation_delivery";
      }
      const homeHelpConsent = signedDirect && boundedHomeHelpConsentCommand(ev.text);
      if (homeHelpConsent && rt.signedMemberTurn(memberId, rowId)) {
        rt.unit.inbound = inbound;
        rt.unit.privateHomeHelpTurn = true;
        rt.unit.memberCommand = tx => this.replyToHomeHelpConsent(tx, rt, { memberId, e164: signedDirect.from }, rowId, ev.receivedAt, homeHelpConsent);
        return "bounded_home_help";
      }
      const homeHelp = signedDirect && boundedHomeHelpCommand(ev.text);
      if (homeHelp && rt.signedMemberTurn(memberId, rowId)) {
        rt.unit.inbound = inbound;
        rt.unit.privateHomeHelpTurn = true;
        rt.unit.memberCommand = tx => this.replyToHomeHelp(tx, rt, memberId, signedDirect.from, rowId, homeHelp);
        return "bounded_home_help";
      }
      const inviteReview = signedDirect && /^check invite (mir_[0-9a-f]{32})$/i.exec(ev.text.trim())?.[1]?.toLowerCase();
      if (inviteReview && rt.signedMemberTurn(memberId, rowId)) {
        rt.unit.inbound = inbound;
        rt.unit.privateInviteTurn = true;
        rt.unit.memberCommand = tx => this.replyToInvitationReview(tx, rt, memberId, signedDirect.from, rowId, inviteReview);
        return "handled";
      }
      const travel = signedDirect ? travelPresenceCommand(ev.text) : undefined;
      const soloEvents = signedDirect ? soloConciergeRequest(ev.text) : undefined;
      const contributionPage = signedDirect ? contributionHistoryRequest(ev.text) : undefined;
      if (travel || soloEvents || contributionPage !== undefined) {
        const reason = travel ? "travel_presence" : soloEvents ? "solo_events" : "contribution_history";
        const e164 = normalizePhone(ev.from);
        if (e164) rt.unit.memberCommand = async tx => {
          const owner = { app: rt.app, memberId, e164 };
          const accounts = this.accountsFor(tx);
          const now = this.clock.now();
          if (travel) {
            const body = await saveTravelPresence(tx, accounts, owner, travel, now);
            if (body === undefined) return;
            rt.unit.inbound = inbound;
            rt.unit.atomicReply = "travel_presence";
            rt.collectedMemberReply(memberId, `sys:${rowId}`, body, "travel_presence");
          } else if (soloEvents) {
            const reply = await soloConciergeReply(tx, accounts, owner, soloEvents, now);
            if (!reply) return;
            rt.unit.inbound = inbound;
            rt.collectedMemberReply(memberId, `sys:${rowId}`, reply.body, "solo_events", reply.publicLinks);
          } else if (contributionPage !== undefined) {
            const body = await contributionHistoryReply(tx, accounts, owner, contributionPage);
            if (body === undefined) return;
            rt.unit.inbound = inbound;
            rt.collectedMemberReply(memberId, `sys:${rowId}`, body, "contribution_history");
          }
        };
        return reason;
      }
      rt.unit.inbound = inbound;
      rt.replyingTo = memberId;
      let disposition: "handled" | "open";
      const manageIntent = commandText ? standingIntentCommand(ev.text) : undefined;
      if (manageIntent) {
        try {
          const e164 = normalizePhone(ev.from);
          const own = e164 && await this.accounts.activeMembership(rt.app, { e164, personId: null });
          const body = n.manageStandingIntents(memberId, manageIntent, !!own && own.membership.memberId === memberId,
            change => { rt.unit.standingIntent = change; });
          if (body) {
            rt.system(memberId, `sys:${rowId}`, body, "reply", "standing_intent");
            // The member's own intent references are hex digests that the line's phone pattern can read as a number.
            const references = body.split(/\s+/).filter(token => /^\W*I-[0-9A-F]{12}\W*$/u.test(token));
            if (references.length) (rt.unit.collectedPublicLinks ??= new Map()).set(`sys:${rowId}`, references);
          }
          return "standing_intents" as const;
        } finally {
          rt.replyingTo = undefined;
        }
      }
      const read = commandText ? profileReadRequest(ev.text, this.apps) : undefined;
      if (read) {
        try {
          const e164 = normalizePhone(ev.from);
          const person = e164 && (await this.accounts.personFor(e164));
          const own = person && (await this.accounts.activeMembership(rt.app, { e164: e164!, personId: person.id }));
          // Recheck canonical phone/person/age/review/consent authority inside the
          // ordinary member unit. This is a reply, never a compliance exemption.
          const sameMember = !!own && own.membership.memberId === memberId;
          const optedOut = sameMember && !!n.memberList().find((m) => m.id === memberId)?.optedOut;
          const result = stepProfileRead(read.decision, {
            type: "resolveRead",
            sameMember,
            optedOut,
            requestedAppMatches: read.app === rt.app.id,
          });
          let body: string;
          switch (result.phase) {
            case "AskWhichApp":
              body = "Which profile should I show? For example, say: show my Friends profile.";
              break;
            case "RefuseOtherProfile":
              body = "I can only show the profile saved for your own number.";
              break;
            case "DifferentAppLine":
              body = `This line is for ${rt.app.name}. Ask for that profile here.`;
              break;
            case "ShowOwnProfile":
              if (!e164 || !own) return "handled" as const;
              body = savedProfileText(rt.app, own.membership, await this.accounts.lowestAge(e164, own.person));
              break;
            default:
              return "handled" as const;
          }
          rt.system(memberId, `sys:${rowId}`, body, "reply", "profile_read");
          return "handled" as const;
        } finally {
          rt.replyingTo = undefined;
        }
      }
      const stageIntent = signedDirect && rt.signedMemberTurn(memberId, rowId) ? (intent: Intent) => {
        rt.unit.memberCommand = tx => this.saveCofounderIntent(tx, rt, rowId, signedDirect.from, intent);
      } : undefined;
      try {
        disposition = await n.onInbound({ id: rowId, memberId, body: ev.text, ts: signedDirect ? Math.min(t, ev.receivedAt) : t, channel,
          ...(signedDirect ? { signedReceivedAt: ev.receivedAt } : {}),
          ...(keyword ? { keyword } : {}), ...(fromAssistant ? { source: "mcp" as const } : {}) }, stageIntent);
      } finally { rt.replyingTo = undefined; }
      if (rt.unit.memberCommand) return "cofounder_intent" as const;
      // Carrier keywords: the app's own confirmation (packages/platform apps.ts). START gets the Network's own welcome back.
      if (systemReply) rt.system(memberId, `sys:${rowId}`, systemReply);
      if (keyword === "STOP") rt.unit.optOut.set(memberId, true);
      if (keyword === "START") rt.unit.optOut.set(memberId, false);
      if (n.isDeclined(memberId)) {
        // Under the join age: nothing is kept. The one kind decline still goes out, as a policy notice the queue does not hold back.
        rt.unit.forget.add(memberId);
        for (const s of rt.unit.sends) if (s.memberId === memberId) s.kind = "compliance";
      }
      if (rt.unit.memberInvitation) {
        rt.unit.privateInviteTurn = true;
        return rt.unit.memberInvitation.status === "issued" ? "member_invitation" : "member_invitation_review";
      }
      return keyword || systemReply ? "handled" as const : disposition;
    }, !fromAssistant && !kw && !calendarPreferenceCommand(ev.text) && this.inboundTurn()?.memberId === memberId
      ? { kind: "member", memberId, reschedule: parseRescheduleCommand(ev.text) } : undefined);
  }

  private async cofounderIntentOwner(tx: SQL, rt: NetworkRuntime, memberId: MemberId, e164: string): Promise<boolean> {
    const accounts = this.accountsFor(tx);
    const binding = await memberCommandOwner(tx, accounts, { app: rt.app, memberId, e164 });
    return !!binding?.member && canBeMatched(await accounts.lowestAge(e164, binding.person));
  }

  private async saveCofounderIntent(tx: SQL, rt: NetworkRuntime, rowId: string, e164: string, intent: Intent) {
    const app = rt.app.id;
    const adult = await this.cofounderIntentOwner(tx, rt, intent.memberId, e164);
    if (!canSaveCofounderIntent(app, rt.signedMemberTurn(intent.memberId, rowId), true, adult)) return;
    // The owner row remains locked while this app checks for a prior active or paused goal and saves the new one.
    const rows = await tx<{ status: Intent["status"]; created_at: Date; horizon_days: number }[]>`select status, created_at, horizon_days
      from network.intents where app_id=${app} and member_id=${intent.memberId} and objective=${intent.objective}
        and category=${intent.category} and details=${intent.details} and status in ('active', 'paused')
      order by created_at desc, id`;
    const existing = rows.map(row => standingIntentPhaseAt({
      status: row.status, createdAt: new Date(row.created_at).getTime(), horizonDays: row.horizon_days,
    }, intent.createdAt)).find(cofounderIntentBlocksNew);
    if (!existing) {
      await tx`insert into network.intents (app_id, id, member_id, objective, category, details, horizon_days, status, created_at)
        values (${app}, ${intent.id}, ${intent.memberId}, ${intent.objective}, ${intent.category}, ${intent.details},
          ${intent.horizonDays}, ${intent.status}, ${new Date(intent.createdAt)})`;
    }
    const reply = "I noted your cofounder goal. Say LIST MY INTENTS to check it. I'll ask before any introduction.";
    rt.unit.atomicReply = "cofounder_intent";
    rt.collectedMemberReply(intent.memberId, `sys:${rowId}`, reply, "cofounder_intent");
  }

  private async profileFactPage(tx: SQL, owner: { app: AppId; memberId: MemberId }, page: number): Promise<string> {
    const result = await this.profileFactEdits.list(tx, owner, (page - 1) * MEMBER_FACT_PAGE_SIZE);
    return memberFactListText({ page, ...result });
  }

  private async replyToProfileFactEdit(tx: SQL, rt: NetworkRuntime, memberId: MemberId, rowId: string, command: MemberFactCommand) {
    const owner = { app: rt.app.id, memberId };
    const unavailable = memberFactReply("unavailable");
    if (command.kind === "list") return { id: `fact-list:${rowId}`, body: await this.profileFactPage(tx, owner, command.page) };
    if (command.kind === "confirm" || command.kind === "cancel") {
      const id = `fact-edit:${rowId}`;
      if (command.kind === "cancel") {
        const cancelled = await this.profileFactEdits.cancel(tx, owner, command.draft);
        return { id, body: cancelled ? memberFactReply("cancelled") : unavailable };
      }
      const result = await this.profileFactEdits.confirm(tx, owner, command.draft);
      if (!result) return { id, body: unavailable };
      await rt.clearProfileFactProjections(tx, memberId, result);
      await tx`update platform.inbound set response=null,replies='[]'::jsonb,receipt=null,receipt_hash=null
        where app_id=${owner.app} and member_id=${memberId} and status='done' and response->>'reason'='profile_fact_edit'
          and replies->0->>'id' like 'fact-list:%'`;
      return { id, body: memberFactReply("saved") };
    }
    if (command.kind === "invalid") return { id: `fact-edit:${rowId}`, body: memberFactReply("invalid") };
    const { ref, ...change } = command;
    const draft = await this.profileFactEdits.stage(tx, owner, { reference: ref, change });
    if (!draft) return { id: `fact-edit:${rowId}`, body: unavailable };
    return { id: `fact-draft:${rowId}`, body: memberFactEditPrompt({ draft: draft.code, fact: draft.fact, change: draft.change }) };
  }

  private async profileFactReplyCurrent(input: TurnRequest, reply: Extract<TurnResponse, { outcome: "handled" }>): Promise<boolean> {
    const { app, memberId } = reply;
    const rt = app && memberId ? await this.runtimeOfMember(app, memberId) : undefined;
    const command = memberFactCommand(input.text);
    if (!rt || !memberId || !command || reply.replies.length !== 1 || reply.replyIds?.length !== 1) return false;
    return rt.scoped(async tx => {
      const owner = { app: rt.app.id, memberId };
      const binding = await memberCommandOwner(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from });
      if (!binding?.member) return false;
      const id = reply.replyIds![0]!;
      const body = reply.replies[0]!;
      let current = false;
      if (command.kind === "list") {
        current = id.startsWith("fact-list:") && body === await this.profileFactPage(tx, owner, command.page);
      } else if (id.startsWith("fact-draft:")) {
        const code = /\nReply CONFIRM FACT EDIT (pfc_[a-p]{32})\b/.exec(body)?.[1];
        current = !!code && await this.profileFactEdits.stageIsCurrent(tx, owner, code);
      } else {
        current = id.startsWith("fact-edit:");
      }
      return profileFactEditMayReplay(true, true, current);
    });
  }

  private async replyToExpectedInvitation(tx: SQL, rt: NetworkRuntime, memberId: MemberId, sender: string, messageId: string,
    command: MemberInviteDeliveryCommand): Promise<void> {
    const app = rt.app.id;
    if (!await this.invitationOwner(tx, rt.app, memberId, sender)) return;
    const adapter = this.expectedInvitationCarrier(rt);
    let reply = memberInviteDeliveryReply("invalid");
    if (!adapter && (command.kind === "stage" || command.kind === "confirm")) {
      reply = memberInviteDeliveryReply("forwarding");
    } else if (command.kind === "stage") {
      const hash = isMemberInvitationLink(rt.app, command.link) && memberInvitationHash(this.hashKey, app, command.link.slice(-43));
      const draft = hash && command.e164 !== sender && await this.expectedInvitations.stage(tx, {
        app, inviterMemberId: memberId, tokenHash: hash, to: command.e164, link: command.link,
      });
      reply = draft ? memberInviteDeliveryPrompt(draft.code) : memberInviteDeliveryReply("unavailable");
    } else if (command.kind === "confirm" && adapter) {
      let body: string | undefined;
      await this.expectedInvitations.confirm(tx, {
        app, inviterMemberId: memberId, code: command.reference, transportAvailable: adapter.live,
      }, async (draftTx, pending) => {
        if (pending.to === sender || !await this.eligibleExpectedInviteRecipient(draftTx, app, pending.to)) return false;
        body = await this.expectedInvitationText(draftTx, rt.app, memberId, pending.link);
        return body !== undefined;
      }, async (draftTx, pending) => {
        if (!body) throw new Error("Expected invitation copy is unavailable");
        await adapter.queue.enqueue(draftTx, [{id: pending.id, to: pending.to, kind: "transactional", text: body, city: rt.city}]);
        return body;
      });
      reply = memberInviteDeliveryReply("queued");
    }
    rt.unit.atomicReply = "member_invitation_delivery";
    rt.collectedMemberReply(memberId, `invite-vouch:${messageId}`, reply, "member_invitation_delivery");
  }

  private async expectedInvitationReplyCurrent(tx: SQL, rt: NetworkRuntime, memberId: MemberId, text: string, replies: string[]): Promise<boolean> {
    const command = memberInviteDeliveryCommand(text);
    if (command?.kind !== "stage") return true;
    const [body] = replies;
    if (replies.length !== 1 || !body) return false;
    if (body === memberInviteDeliveryReply("forwarding") || body === memberInviteDeliveryReply("unavailable")) return true;
    const code = memberInviteDeliveryPromptCode(body);
    return !!code && await this.expectedInvitations.challengeCanReplay(tx, {
      app: rt.app.id, inviterMemberId: memberId, link: command.link, to: command.e164, code, transportAvailable: !!this.expectedInvitationCarrier(rt),
    });
  }

  private async replyToInvitationReview(tx: SQL, rt: NetworkRuntime, memberId: MemberId, sender: string, messageId: string, id: string): Promise<void> {
    const now = this.clock.now();
    if (!await this.invitationOwner(tx, rt.app, memberId, sender)) return;
    const approved = await findApprovedMemberInvitationReview(tx, rt.app.id, id, memberId, now);
    const replyId = `sys:${messageId}`;
    // A held request returns its link only for the current approval presented in this owner's signed turn.
    if (memberInviteHeldLinkMayRelease(rt.signedMemberTurn(memberId, messageId), !!approved) && approved) {
      const staged = this.invitationLink(rt.app, memberId, approved.relationship, approved, now, id);
      rt.unit.memberInvitation = staged;
      rt.collectedMemberReply(memberId, replyId, this.copyOf(rt.app).forwardInvite(staged.url), "member_invitation", [staged.url]);
      return;
    }
    const status = await memberInvitationReviewStatus(tx, rt.app.id, id, memberId, now);
    const text = status === "pending" ? "Your invitation is still waiting for review."
      : status === "denied" ? "Your invitation was not approved."
      : status === "released" ? "You already received the forwarding link." : "I couldn't find a current invitation with that code.";
    rt.collectedMemberReply(memberId, `invite-vouch:${replyId}`, text, "member_invitation_vouch");
  }

  private async replyToHomeHelp(tx: SQL, rt: NetworkRuntime, memberId: MemberId, sender: string, messageId: string, command: BoundedHomeHelpCommand): Promise<void> {
    if (!await this.homeHelpSender(tx, rt, memberId, sender)) return;
    const reply = (text: string, recorded = false) => {
      if (recorded) rt.unit.atomicReply = "bounded_home_help";
      rt.collectedMemberReply(memberId, `home-help:${messageId}`, text, "bounded_home_help");
    };
    if (!rt.net.allowedCategories.has("help")) return reply("This app does not take home-help requests.");
    if (command.kind === "invalid") return reply(BOUNDED_HOME_HELP_CLARIFICATION);
    const app = rt.app.id;
    if (command.kind === "offer" || command.kind === "withdraw_offer") {
      if (!homeHelpOfferChangeAllowed(true, rt.signedMemberTurn(memberId, messageId))) return;
      if (command.kind === "withdraw_offer") {
        await tx`delete from network.facets where app_id=${app} and member_id=${memberId} and kind='offer' and 'moving_help'=any(tags)`;
        await this.homeHelpRecipientStopped(tx, app, memberId);
        return reply("Your moving-help offer is withdrawn.", true);
      }
      const now = new Date(this.clock.now());
      await tx`insert into network.facets (app_id,id,member_id,kind,value,tags,privacy_scope,provenance,source,status,confidence,valid_from,observed_at)
        values (${app},${`${memberId}:home-help-offer`},${memberId},'offer','I can help move furniture or carry boxes.',
          ${tx.array(["moving_help"], "TEXT")},'matchable','said','home_help_command','confirmed',1,${now},${now})
        on conflict (id) do update set status='confirmed',valid_from=${now},valid_to=null,observed_at=${now}`;
      return reply("I've saved your offer to help move furniture or carry boxes. You can withdraw it at any time.", true);
    }
    const store = new BoundedHomeHelp(this.homeHelpAuthority(), () => this.clock.now());
    if (command.kind === "close") {
      const closed = await store.close(tx, { app, id: command.id, revision: command.revision, actor: { kind: "owner", requesterId: memberId } });
      return reply(closed ? "Your home-help plan is closed." : "I couldn't find that current home-help plan.", closed);
    }
    const owner = { app, requesterId: memberId, detailsConfirmed: true, alternativeChecked: true };
    const existing = command.kind === "revise" ? await store.readOwnerDraft(tx, { ...owner, id: command.id, revision: command.revision }) : undefined;
    if (command.kind === "revise" && !existing) return reply("I couldn't find that current home-help plan.");
    const draft = boundedHomeHelpDraft(command.draft, this.clock.now(), { reviewSlaHours: DEFAULT_SLA_HOURS[app], previousExpiresAt: existing?.expiresAt });
    if (!draft) return reply(BOUNDED_HOME_HELP_CLARIFICATION);
    const recorded = command.kind === "submit" ? await store.submit(tx, { ...owner, id: randomUUID(), draft })
      : await store.revise(tx, { ...owner, id: command.id, revision: command.revision, draft });
    if (!recorded) return reply("I couldn't record that home-help plan. Check the time and current revision.");
    reply(`Home-help plan ${homeHelpPlanCode(recorded.id)}, revision ${recorded.revision}, is ready for staff to consider. Leave out the street address.`, true);
  }

  private async replyToHomeHelpConsent(tx: SQL, rt: NetworkRuntime, actor: { memberId: MemberId; e164: string },
    messageId: string, receivedAt: number, command: BoundedHomeHelpConsentCommand): Promise<void> {
    if (!await boundedHomeHelpSenderCurrent(this.accountsFor(tx), rt.app, actor)) return;
    const responseId = `home-help-consent-reply:${messageId}`;
    if (command.kind === "invalid") {
      rt.collectedMemberReply(actor.memberId, responseId, BOUNDED_HOME_HELP_CONSENT_CLARIFICATION, "bounded_home_help");
      return;
    }
    const key: HomeHelpConsentKey = { app: rt.app.id, id: command.id, revision: command.revision };
    const store = this.homeHelpConsent();
    if (command.kind === "address") {
      const origin = stagingSiteOrigins(this.env)[rt.app.id] ?? `https://${rt.app.domain}`;
      const reply = await homeHelpAddressReply(tx, store, key, actor.memberId, origin, this.clock.now());
      rt.collectedMemberReply(actor.memberId, responseId, reply.body, "bounded_home_help", reply.link ? [reply.link] : []);
      return;
    }
    await reconcileHomeHelpDelivery(tx, store, key.app, actor.memberId, key);
    const result = await store.respond(tx, { ...key, actor, decision: command.decision, receivedAt });
    if (result) rt.unit.atomicReply = "bounded_home_help";
    rt.collectedMemberReply(actor.memberId, responseId, boundedHomeHelpConsentReply(result, key), "bounded_home_help");
  }

  /** Apply the saved age to matching, photos, and memberships owned by the same person. */
  private async projectStatedAge(rt: NetworkRuntime, memberId: MemberId) {
    for (const recorded of rt.takeRecordedAges(memberId)) await this.accounts.projectRecordedAge(recorded);
  }

  /**
   * STOP or STOP ALL from a number (a signed turn or the legacy webhook): the consent event once per
   * `ref` at the message's time (consentAt), then every member it covers stops (one app, or every app on
   * the shared line), and the confirmation. `ev`: the inbound message (the member's own unit stores it).
   */
  private async stop(kw: "stop" | "stop_all", from: string, app: AppInfo, rt: NetworkRuntime, scope: StopScope, ref: string, line: string | undefined,
    ev?: Extract<ChannelEvent, { kind: "message" }>): Promise<InboundOutcome> {
    const e164 = normalizePhone(from), t = this.clock.now();
    await rt.identities();
    const memberId = rt.memberOf(from);
    const { event, reply } = keywordEvent(kw, e164 ?? from, app, this.consentAt(ev), { line, scope, ref });
    if (e164 && event) await this.accounts.recordConsent(event);
    const turn = this.inboundTurn();
    if (turn && event) turn.consent = {state: "opted_out", scope: scope === "global" ? "all" : "app", app: scope === "global" ? null : app.id, at: event.at};
    // The STOP is recorded: its confirmation goes out even if a later step of this turn fails (Inbox.rescueCompliance).
    if (turn && event && reply && normalizeAddress(from) === normalizeAddress(turn.from)) turn.confirmation = {id: `sys:${ref}`, body: reply};
    if (e164) await this.people.deletePending(this.phoneKey(e164));
    if (memberId && ev) await this.memberMessage(rt, memberId, ev, ref, kw, reply);
    else if (memberId) await rt.unitOfWork(async n => { await n.onInbound({ id: ref, memberId, body: "STOP", ts: t, channel: "imessage", keyword: "STOP" }); rt.unit.optOut.set(memberId, true); });
    else if (reply) await this.direct(rt, from, reply, `sys:${ref}`, "compliance");
    const person = e164 ? await this.accounts.personFor(e164) : undefined;
    if (person) await this.stopped(app, person.id, scope, memberId ? { rt, memberId } : undefined);
    else if (scope === "global") {
      // A member from before the platform (no person): every app where this address is a member.
      for (const other of this.runtimes.values()) {
        if (other === rt) continue;
        await other.identities();
        const id = other.memberOf(from);
        if (id) await other.unitOfWork(async n => { await n.onInbound({ id: `${ref}:${other.id}`, memberId: id, body: "STOP", ts: t, channel: "imessage", keyword: "STOP" }); other.unit.optOut.set(id, true); });
      }
    }
    return memberId ? "handled" : "stopped";
  }

  /** The adapter that speaks for the shared line (receipts, line safety, engagement): the queue tables are one per line. */
  private lineAdapter(): ChannelAdapter | undefined {
    for (const rt of this.runtimes.values()) if (rt.adapter.enqueue) return rt.adapter;
    return undefined;
  }

  /**
   * The time of a consent event that an inbound message causes. In a signed turn it is the gateway's
   * receipt time (never later than now), so the ledger orders STOP, START, leave and joins by when the
   * person sent them, not by when a retry arrived. On the legacy webhook (handled in order per sender) it is now.
   */
  private consentAt(ev?: { receivedAt: number }): number {
    const now = this.clock.now();
    return this.inboundTurn() && ev && Number.isSafeInteger(ev.receivedAt) && ev.receivedAt > 0 ? Math.min(ev.receivedAt, now) : now;
  }

  /**
   * One fixed text to someone who is not a member here. Nothing is stored. `kind`: "compliance" only for
   * a keyword or leave confirmation and the under-age decline; "reply" for an answer to their own message; "transactional" for a
   * text the Network starts (README "Direct texts" lists every caller).
   */
  private async direct(rt: NetworkRuntime, to: string, body: string, id: string, kind: DirectKind) {
    const turn = this.inboundTurn();
    if (turn && normalizeAddress(to) === normalizeAddress(turn.from)) {
      // spec/signedInbox.md, "A direct reply in a turn is collected only when consent allows it"
      if (!directReplyCollectable(kind === "compliance", resolveConsent(await this.people.lastConsent(to, rt.app.id)) === "opted_out")) {
        this.log(`[inbound] a ${kind} direct text to a number opted out of ${rt.app.id} was not collected (${id})`);
        return;
      }
      await this.collectDirect(rt, to, {id, body, kind: kind === "compliance" ? "compliance" : "reply"});
      return;
    }
    await rt.adapter.direct(to, body, id, kind);
  }

  private collectDirect(rt: NetworkRuntime, to: string, reply: CollectedReply): Promise<boolean> {
    return this.sql.begin(async tx => {
      const reasons = await collectedReplyGuard(rt.adapter).collectedLeaks(tx, {id: reply.id, to, kind: reply.kind, text: reply.body});
      if (!collectedReplyMayLeave(reasons.length)) {
        this.log(`[alert] a direct reply failed the collected leak guard (${rt.id}, ${reply.id})`);
        return false;
      }
      await this.inbox.collect(tx, [reply]);
      return true;
    });
  }

  /**
   * Someone who is not a member of this app wrote to it. An invite-only app on its own site or line:
   * one short reply a day, nothing stored. Otherwise (every app on the shared line, The Network
   * included when no keyword named an app): ask for first name and age; when both came and the age
   * check passes, the person (if new), the membership, the consent event and the network member are
   * created, and the Network welcomes them. A join to The Network with no keyword then asks what they
   * are looking for. Under the join age: the kind decline, nothing stored for this app.
   */
  private async join(rt: NetworkRuntime, app: AppInfo, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string, route: Route): Promise<InboundOutcome> {
    const key = this.phoneKey(e164);
    const t = this.clock.now();
    const c = this.copyOf(app);
    const person = await this.accounts.personFor(e164);
    // A banned number or person never joins any app; nothing is stored and nothing is answered.
    const ban = stepTextJoin(textJoinInitial, { type: "checkJoinBan", banned: await this.accounts.banned(e164, person) });
    if (ban.phase !== "AwaitingInvite") { this.log(`[inbound] a banned number wrote to ${app.id}: not joined, not stored`); return "held"; }
    const existing = person ? await this.people.getMembership(person.id, app.id) : undefined;
    const invited = existing?.state === "invited";
    const sharedNetwork = route.shared && app.id === "ntwrk";
    const statedAge = parseJoinText(ev.text, this.appWords(), false).age;
    let invitation = stepTextJoin(ban, { type: "checkInvitation", inviteOnly: app.joinMode === "invite", invited, sharedNetwork, hasAge: statedAge !== undefined });
    if (invitation.phase === "AwaitingInviteAgeRecord" && statedAge !== undefined) {
      await this.accounts.recordAge(e164, person, statedAge);
      invitation = stepTextJoin(invitation, { type: "recordStatedAge" });
    }
    if (invitation.phase === "InviteRequired") {
      // The same answer whether or not the number uses another app; at most once a day per number.
      const { ok } = await this.people.hit(`invite_only:${app.id}:${key}`, DAY, t, { minGapMs: DAY });
      if (ok) await this.direct(rt, ev.from, app.brand.inviteOnly, `sys:${rowId}`, "reply");
      this.log(`[inbound] not a member of invite-only ${app.id}: ${ok ? "invite-only reply" : "no reply (answered in the last day)"}, not stored`);
      return "invite_only";
    }
    let p = await this.pendingOf(e164, "join");
    if (p && !pendingMatchesApp(p.app, app.id)) p = undefined;
    const said = parseJoinText(ev.text, this.appWords(), !!p);
    const age = lowestAge(said.age, p?.age), name = said.name ?? p?.name ?? undefined;
    const homeCity = said.homeCity ?? p?.homeCity;
    const ask = invited ? c.invited(app.minJoinAge) : c.joinAsk(app.minJoinAge);
    const floor = await this.accounts.lowestAge(e164, person);
    const answer = stepTextJoin(invitation, {
      type: "readJoinAnswer", answerFacts: { hasAge: age !== undefined, hasName: !!name, invalidHome: !!said.invalidHome,
        floorRefused: floor !== undefined && !canJoinApp(floor, app) },
    });
    const requestHome = async (): Promise<InboundOutcome> => {
      await this.direct(rt, ev.from, "Tell me your home city: New York or San Francisco / Bay Area. Include your first name and age.", `sys:${rowId}`, "reply");
      return "join_asked";
    };
    const declineAge = async (stated: boolean): Promise<InboundOutcome> => {
      await this.people.deletePending(key, "join");
      const { ok } = await this.people.hit(`under_age:${app.id}:${key}`, DAY, t, { minGapMs: DAY });
      const send = sendAgeDecline(stated, !ok);
      if (send) await this.direct(rt, ev.from, app.brand.underAge, `sys:${rowId}`, "compliance");
      this.log(`[inbound] under the join age for ${app.id}: ${send ? "declined" : "no reply (declined in the last day)"}, nothing stored`);
      return "under_age";
    };
    if (answer.phase === "RefuseAge") return declineAge(false);
    if (answer.phase === "AskForHome") return requestHome();
    if (answer.phase === "AskForAge") {
      await this.people.putPending({ phoneHash: key, kind: "join", app: app.id, name: name ?? null, age: null, ...(homeCity ? { homeCity } : {}), at: t });
      const { count } = await this.people.hit(`join_ask:${app.id}:${key}`, DAY, t);
      if (count <= 3) await this.direct(rt, ev.from, ask, `sys:${rowId}`, "reply");
      return "join_asked";
    }
    if (answer.phase !== "AwaitingAgeRecord" || age === undefined) return "join_asked";
    await this.accounts.recordAge(e164, person, age);
    const recorded = stepTextJoin(answer, { type: "recordStatedAge" });
    const check = joinAgeCheck(age, await this.accounts.lowestAge(e164, person), app);
    const ageCheck = stepTextJoin(recorded, { type: "checkTextJoinAge", ageAllowed: check.ok });
    if (ageCheck.phase === "RefuseAge") return declineAge(true);
    if (ageCheck.phase === "AskForHome") return requestHome();
    if (ageCheck.phase === "AskForName") {
      await this.people.putPending({ phoneHash: key, kind: "join", app: app.id, name: null, age, ...(homeCity ? { homeCity } : {}), at: t });
      await this.direct(rt, ev.from, c.joinNeedName, `sys:${rowId}`, "reply");
      return "join_asked";
    }
    if (ageCheck.phase !== "AwaitingMember" || !name) return "join_asked";
    await this.people.deletePending(key, "join");
    // Join: the person (new or known), the membership, the opt-in (with the words they answered), then the member and the welcome.
    const who: Person = person ?? (await this.accounts.createPerson(e164, "inbound_message", check.effective ?? age));
    await this.accounts.recordAge(e164, who, age);
    const others = (await this.people.memberships(who.id)).filter(m => m.app !== app.id && m.state !== "removed" && m.state !== "invited");
    const membership: Membership = {
      app: app.id, personId: who.id, memberId: textJoinKeepsMemberId(joinMembershipOf(existing?.state)) && existing ? existing.memberId : `${app.id}_${randomUUID()}`,
      state: app.joinMode === "waitlist" ? "onboarding" : "active", review: null, firstName: name, profile: homeCity ? { homeCity } : {}, joinedAt: t, leftAt: null,
    };
    const admitted = await this.people.admitMembership(membership, { e164, app: app.id, line: ev.to ? normalizeAddress(ev.to) : null,
      state: "opted_in", source: "inbound_message", wording: ask, ref: rowId, at: this.consentAt(ev) }, key, null);
    if (!admitted) return "held";
    const stored = stepTextJoin(ageCheck, { type: "recordTextMembership", membershipActive: membership.state === "active" });
    if (stored.phase !== "AwaitingWelcome") return "joined";
    rt = this.runtimeForHome(app.id, homeCity ?? rt.city) ?? rt;
    if (!await this.createMember(rt, membership, { age: Math.min(age, check.effective ?? age), firstName: name, homeCity })) return "held";
    // Their answer is their first message: the Network welcomes them as a reply to it.
    await this.memberMessage(rt, membership.memberId, ev, rowId, undefined);
    // A person who uses another app with this number: the link notice (never names the other app).
    const welcomed = stepTextJoin(stored, { type: "recordWelcome", hasOtherApp: others.length > 0, sharedNetwork, invited });
    if (welcomed.phase === "JoinedWithShare") {
      await rt.unitOfWork(() => { rt.system(membership.memberId, `link:${rowId}`, c.linkNotice, "reply", "info"); });
      await this.people.putPending({ phoneHash: key, kind: "share", app: app.id, name: null, age: null, at: t });
    } else if (welcomed.phase === "JoinedWithLookingFor") {
      // No keyword: The Network asks what they are looking for, then enrolls them (founder decision 2).
      const askText = lookingForAsk(Math.min(age, check.effective ?? age));
      await rt.unitOfWork(() => { rt.system(membership.memberId, `ask:${rowId}`, askText, "reply", "info"); });
      await this.people.putPending({ phoneHash: key, kind: "looking_for", app: "ntwrk", name: null, age: null, at: t });
    }
    return "joined";
  }

  /**
   * The answer to "what are you looking for?": a membership in each app they named, each with the
   * app's own join age check (13+ everywhere today), its own opt-in and its own member. The Network
   * confirms in one text. Apps the age check refuses are left out without saying why.
   */
  private async enroll(rt: NetworkRuntime, memberId: MemberId, e164: string, wants: AppId[], ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<InboundOutcome> {
    const key = this.phoneKey(e164), t = this.clock.now();
    const person = await this.accounts.personFor(e164);
    const ntwrk = person && (await this.people.getMembership(person.id, "ntwrk"));
    const joined: AppInfo[] = [];
    const banned = !!person && !!ntwrk && await this.accounts.banned(e164, person);
    if (networkEnrollmentAllowed(!!person, !!ntwrk, banned) && person && ntwrk) {
      const lowest = await this.accounts.lowestAge(e164, person);
      const asked = lookingForAsk(lowest);
      for (const id of wants.filter(a => otherAppAllowed(a, canBeMatched(lowest)))) {
        const app = this.apps[id], homeCity = homeCityOf(ntwrk.profile.homeCity), art = this.runtimeForHome(id, homeCity ?? this.runtimeFor(id)!.city)!;
        const existing = await this.people.getMembership(person.id, id);
        const existingMember = !!existing && existing.state !== "removed" && existing.state !== "invited";
        const enrollment = otherAppEnrollment(existingMember, !existingMember && lowest !== undefined && joinAgeCheck(lowest, lowest, app).ok);
        if (enrollment === "KeepOtherApp") { joined.push(app); continue; }
        if (enrollment !== "CreateOtherApp" || lowest === undefined) continue;
        const m: Membership = {
          app: id, personId: person.id, memberId: existing?.state === "invited" ? existing.memberId : `${id}_${randomUUID()}`,
          state: app.joinMode === "waitlist" ? "onboarding" : "active", review: null, firstName: ntwrk.firstName, profile: homeCity ? { homeCity } : {}, joinedAt: t, leftAt: null,
        };
        const admitted = await this.people.admitMembership(m, { e164, app: id, state: "opted_in", source: "looking_for",
          wording: asked, ref: `${rowId}:${id}`, at: this.consentAt(ev) }, key, null);
        if (!admitted || (m.state === "active" && !await this.createMember(art, m, { age: lowest, firstName: ntwrk.firstName ?? "there", homeCity }))) continue;
        joined.push(app);
      }
    }
    await this.people.deletePending(key, "looking_for");
    return rt.unitOfWork(async () => {
      rt.unit.inbound = { id: rowId, member_id: memberId, direction: "inbound", channel: ev.transport === "sms" ? "sms" : "imessage", body: ev.text, status: "received", type: null, opportunity_id: null, proactive: false, system: false, ts: new Date(t) };
      if (joined.length) rt.system(memberId, `sys:${rowId}`, enrolledText(joined), "reply", "info");
      return "handled" as const;
    });
  }

  private async share(rt: NetworkRuntime, app: AppInfo, memberId: MemberId, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<InboundOutcome> {
    const person = await this.accounts.personFor(e164);
    if (person) {
      for (const m of await this.people.memberships(person.id)) {
        if (m.app !== app.id && m.state !== "removed" && m.state !== "invited") await this.accounts.share(app, { e164, personId: person.id }, m.app, ["interests"]);
      }
      await applyBaseProfileGrants({ people: this.people, banned: () => this.accounts.banned(e164, person), runtimeFor: a => this.runtimeFor(a), now: this.clock.now() },
        person.id, { app: app.id, memberId, runtime: rt });
    }
    const done = await this.shareReply(rt, memberId, ev, rowId, this.copyOf(app).shareDone);
    await this.people.deletePending(this.phoneKey(e164), "share", app.id);
    return done;
  }

  private async unshare(rt: NetworkRuntime, app: AppInfo, memberId: MemberId, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<InboundOutcome> {
    const person = await this.accounts.personFor(e164);
    if (person) {
      const at = this.clock.now();
      await this.people.withLock(`profile-share:${person.id}`, async () => {
        for (const grant of await this.people.shareGrants(person.id)) {
          if (unshareRevokesGrant(grant.revokedAt !== null, grant.fromApp === app.id, grant.toApp === app.id)) await this.people.putShareGrant({ ...grant, revokedAt: at });
        }
      });
    }
    return this.shareReply(rt, memberId, ev, rowId, this.copyOf(app).unshareDone);
  }

  private shareReply(rt: NetworkRuntime, memberId: MemberId, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string, body: string): Promise<InboundOutcome> {
    return rt.unitOfWork(async () => {
      rt.unit.inbound = { id: rowId, member_id: memberId, direction: "inbound", channel: ev.transport === "sms" ? "sms" : "imessage", body: ev.text, status: "received", type: null, opportunity_id: null, proactive: false, system: false, ts: new Date(this.clock.now()) };
      rt.system(memberId, `sys:${rowId}`, body, "reply", "info");
      return "handled" as const;
    });
  }

  // ------------------------------------------------------------------ staff
  /** A staff action: an audit row first (no row, no action), the action in a unit of work, then a result row. */
  private async staffAction(rt: NetworkRuntime, user: StaffUser, action: string, target: { type: NonNullable<AuditEntry["targetType"]>; id: string }, detail: Row, fn: (n: NetworkRuntime["net"]) => ActionResult): Promise<ActionResult> {
    const base = { actor: user.id, roles: user.roles, action, targetType: target.type, targetId: target.id, mode: "real" as const, app: rt.app.id };
    await this.audit.write({ ...base, at: this.clock.now(), ok: true, detail: { ...detail, network: rt.id, phase: "requested" } });
    const calendar = action === "review" && target.type === "opportunity" && (detail.decision === "approve" || detail.decision === "edit")
      ? { kind: "review" as const, opportunityId: target.id } : undefined;
    const r = await rt.unitOfWork(fn, calendar);
    await this.audit.write({ ...base, at: this.clock.now(), ok: r.ok, detail: { ...detail, network: rt.id, phase: "result", ...(r.ok ? {} : { reason: r.reason }) } })
      .catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r;
  }

  /** The review queue of a network (default The Network), oldest first, from the newest stored state. */
  reviewQueue(rt = this.main) { return rt.reviewQueue(); }

  review(user: StaffUser, oppId: string, decision: ReviewDecision, o: Omit<ReviewOptions, "reviewer">, rt = this.main) {
    // The reviewer of record is the signed-in person (reviewerOfRecord), never a body field; time on the item is clamped.
    const secondsSpent = typeof o.secondsSpent === "number" && Number.isFinite(o.secondsSpent) ? Math.min(Math.max(0, o.secondsSpent), MAX_REVIEW_SECONDS) : undefined;
    const opts: ReviewOptions = { ...o, secondsSpent, reviewer: user.id };
    const detail = { decision, reason: o.reason ?? null, revision: o.revision ?? null, ...(o.swapOut ? { swapOut: o.swapOut } : {}), ...(o.explanations || o.objective ? { edited: [...Object.keys(o.explanations ?? {}).map(k => `explanation:${k}`), ...(o.objective !== undefined ? ["objective"] : [])] } : {}) };
    return this.staffAction(rt, user, "review", { type: "opportunity", id: oppId }, detail, n => n.decide(oppId, decision, opts));
  }

  liftHold(user: StaffUser, memberId: MemberId, note?: string, rt = this.main) {
    const everywhere = crossAppSafety(user);
    return this.audited(rt, user, { type: "member", id: memberId }, { safety: "lift_hold" }, async () => {
      try {
        return await rt.unitOfWork(async n => {
          const personId = await this.personOfMember(rt, memberId);
          if (!personId) return n.liftHold(memberId, user.id, note);
          const expected = await rt.scoped(tx => currentStaffHold(tx, rt.app.id, personId));
          if (!durableStaffHoldLiftAllowed(expected.global !== null, everywhere)) return { ok: false, reason: "needs_safety_everywhere" };
          const result = n.liftHold(memberId, user.id, note, expected.local !== null || expected.global !== null);
          if (result.ok) rt.unit.memberCommand = tx => liftStaffHold(tx, rt.app.id, memberId, personId, expected, everywhere);
          return result;
        });
      } catch (error) {
        if (error instanceof StaffHoldStateChanged) return { ok: false, reason: "hold_changed" };
        throw error;
      }
    });
  }

  closeCase(user: StaffUser, caseId: string, note?: string, rt = this.main) {
    return this.staffAction(rt, user, "safety", { type: "case", id: caseId }, { safety: "close_case" }, n => n.closeCase(caseId, user.id, note));
  }

  /**
   * A staff invite: an 'invited' membership on this app, then one invitation text (dry-run unless the
   * live flags are set). The person's reply with name and age is the join. Refused for a number that
   * deleted everything or is on hold, and for someone who is already a member.
   */
  async invite(user: StaffUser, rt: NetworkRuntime, e164: string): Promise<ActionResult> {
    const key = this.phoneKey(e164);
    const target = { type: "member" as const, id: key.slice(0, 16) };
    await this.audit.write({ actor: user.id, roles: user.roles, action: "invite", targetType: target.type, targetId: target.id, mode: "real", app: rt.app.id, at: this.clock.now(), ok: true, detail: { network: rt.id, phase: "requested" } });
    const m = await this.accounts.invite(rt.app, e164);
    const r: ActionResult = !m ? { ok: false, reason: "not_invitable" } : m.state !== "invited" ? { ok: false, reason: "already_member" } : { ok: true };
    if (r.ok) await this.direct(rt, e164, this.copyOf(rt.app).invited(rt.app.minJoinAge), `invite:${rt.app.id}:${key.slice(0, 16)}:${this.clock.now()}`, "transactional");
    await this.audit.write({ actor: user.id, roles: user.roles, action: "invite", targetType: target.type, targetId: target.id, mode: "real", app: rt.app.id, at: this.clock.now(), ok: r.ok, detail: { network: rt.id, phase: "result", ...(r.ok ? {} : { reason: r.reason }) } })
      .catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r;
  }

  private async issueSeedInvitationBatch(req: Request, rt: NetworkRuntime, user: StaffUser): Promise<Response> {
    if (req.method !== "POST") return json({ok: false, error: "method_not_allowed"}, 405);
    const bytes = await readCapped(req, MAX_BODY_BYTES);
    if (bytes === "too_large") return json({ok: false, error: "payload_too_large"}, 413);
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)); }
    catch { return json({ok: false, error: "invalid_seed_batch"}, 400); }
    const batch = seedInvitationBatch(payload);
    if (!batch) {
      return json({ok: false, error: "invalid_seed_batch"}, 400);
    }
    if (rt.app.joinMode === "waitlist") return json({ok: false, error: "seed_invitation_unavailable"}, 409);
    const issued = await rt.scoped(async tx => {
      const result = await this.seedInvitations.issue(tx, {app: rt.app.id, issuerId: user.id, ...batch});
      if (result.kind === "issued") {
        await auditSeedInvitationBatch(tx, rt.app.id, user, result.batchId, result.links.length, result.issuedAt);
      }
      return result;
    });
    if (issued.kind === "conflict") return json({ok: false, error: "seed_batch_conflict"}, 409);
    if (issued.kind === "unavailable") return json({ok: false, error: "seed_invitation_unavailable"}, 409);
    return json({ok: true, batchId: batch.requestId, replayed: issued.kind === "replayed",
      invitations: issued.links.map(({token, homeCity}) => ({link: memberInvitationLink(rt.app, token), city: homeCity, expiresAt: issued.expiresAt}))});
  }

  // ------------------------------------------------------------------ verification, photos, reports, holds and bans
  /** The person of a member of this app (network.members.person_id), if the member came through the platform. */
  async personOfMember(rt: NetworkRuntime, memberId: MemberId): Promise<string | undefined> {
    const [r] = await rt.scoped(tx => tx`select person_id from network.members where app_id = ${rt.app.id} and id = ${memberId}`);
    return (r?.person_id as string | null) ?? undefined;
  }

  private async verifiedAdult(personId: string, app: AppId, transaction?: SQL): Promise<boolean> {
    const people = transaction ? new PgPeopleStore(transaction) : this.people;
    const m = await people.getMembership(personId, app);
    const rt = this.runtimeFor(app);
    if (!m || !rt || !["active", "paused", "onboarding"].includes(m.state)) return false;
    const read = (tx: SQL) => tx`select m.age, f.tags, f.valid_from from network.members m left join network.facets f on f.app_id = m.app_id and f.member_id = m.id and f.status <> 'rejected' and ${automatedFacetPredicate(tx, true)}
      and exists (select 1 from unnest(f.tags) t where t like 'verify:age:%') where m.app_id = ${app} and m.id = ${m.memberId} order by f.valid_from desc nulls last, f.id desc`;
    const rows = (transaction ? await read(transaction) : await rt.scoped(read)) as any[];
    if (!rows.length || !canBeMatched(rows[0].age)) return false;
    const last = rows.find(r => r.tags)?.tags as string[] | undefined;
    return !last?.includes("verify:age:fail");
  }

  /**
   * Delete the member's photo rating (the appearanceFacet row, and rows an older build wrote per photo):
   * on one app, or on every app of the person (an age under 18, a ban).
   */
  private async dropRatings(personId: string, app?: AppId) {
    for (const m of await this.people.memberships(personId)) {
      if (app && m.app !== app) continue;
      const rt = this.runtimeFor(m.app);
      if (!rt) continue;
      await rt.scoped(tx => tx`delete from network.facets where app_id = ${m.app} and member_id = ${m.memberId}
        and (id = ${`${m.memberId}:appearance`} or (source = 'photo_rater' and privacy_scope = 'agent_private'))`);
    }
  }

  /**
   * The rater's score for the member: the engine's appearanceFacet (it throws for anyone who is not a
   * verified adult), stored agent_private. The slop pack reads it from the snapshot inside matching only;
   * it is never shown to anyone and is not in the member's export.
   */
  private async writeRating(personId: string, app: AppId, s: AppearanceScore, subject: RatingSubject, selected: string[]):
    Promise<{ refused: PhotoRefusal } | { discard: () => Promise<void> }> {
    const rt = this.runtimeFor(app);
    if (!rt) return { refused: "not_member" };
    return rt.scoped(async tx => {
      // Inserts into platform.photos also lock their person through the foreign key.
      const [person] = await tx`select id from platform.people where id=${personId}::uuid and deleted_at is null for update`;
      if (!person) return { refused: "adults_only" };
      const refused = await this.photos.ratingSelectionRefusal(personId, app, selected, tx);
      if (refused) return { refused };
      const membership = await new PgPeopleStore(tx).getMembership(personId, app);
      if (!membership) return { refused: "not_member" };
      const at = this.clock.now();
      const f = appearanceFacet(membership.memberId as MemberId, subject, s, at);
      const [written] = await tx<{ write_version: string }[]>`insert into network.facets (app_id, id, member_id, kind, value, tags,
          privacy_scope, provenance, source, confidence, status, valid_from)
        values (${app}, ${f.id}, ${membership.memberId}, ${f.kind}, ${f.value}, ${tx.array([...f.tags], "TEXT")},
          'agent_private', 'inferred', 'photo_rater', ${f.confidence}, 'confirmed', ${new Date(at)})
        on conflict (id) do update set tags=excluded.tags, confidence=excluded.confidence, valid_from=excluded.valid_from
        returning xmin::text as write_version`;
      if (!written) throw new Error("Photo rating write did not return its version");
      // Cleanup is conditional on this tuple, even after another attempt deletes and recreates the facet.
      return { discard: () => rt.scoped(async db => {
        await db`delete from network.facets where app_id=${app} and id=${f.id} and xmin=${written.write_version}::xid`;
      }) };
    });
  }

  /** A ban on the person, or on any phone they have (platform.bans). */
  async personBanned(personId: string, transaction?: SQL): Promise<boolean> {
    const people = transaction ? new PgPeopleStore(transaction) : this.people;
    const hashes = await people.phoneHashesOf(personId);
    if (await people.isBanned(hashes[0] ?? "", personId)) return true;
    for (const h of hashes.slice(1)) if (await people.isBanned(h)) return true;
    return false;
  }

  /**
   * Staff record a verification result (PRD 40.5: liveness and age, until a vendor writes them):
   * verify:<check>:<pass|fail> on the member, agent_private, provenance "vouched". Audited before and after.
   */
  async verify(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, check: "age" | "liveness", result: "pass" | "fail", note: string): Promise<ActionResult> {
    const base = { actor: user.id, roles: user.roles, action: "safety", targetType: "member" as const, targetId: memberId, mode: "real" as const, app: rt.app.id };
    await this.audit.write({ ...base, at: this.clock.now(), ok: true, detail: { safety: "verify", check, result, note, phase: "requested" } });
    const now = new Date(this.clock.now());
    const n = await rt.scoped(async tx => {
      const [m] = await tx`select age from network.members where app_id = ${rt.app.id} and id = ${memberId} and account_status not in ('invited', 'removed')`;
      if (!m) return 0;
      await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
        values (${rt.app.id}, ${`${memberId}:verify:${check}`}, ${memberId}, 'fact', ${`${check} check ${result === "pass" ? "passed" : "failed"}`}, ${tx.array([`verify:${check}:${result}`], "TEXT")},
          'agent_private', 'vouched', 'staff', 0.95, 'confirmed', ${now})
        on conflict (id) do update set tags = excluded.tags, value = excluded.value, valid_from = excluded.valid_from`;
      return 1;
    });
    const r: ActionResult = n ? { ok: true } : { ok: false, reason: "unknown_member" };
    if (n && check === "age" && result === "fail") { const pid = await this.personOfMember(rt, memberId); if (pid) { await this.photos.deleteFor(pid, rt.app.id); await this.dropRatings(pid, rt.app.id); } }
    await this.audit.write({ ...base, at: this.clock.now(), ok: r.ok, detail: { safety: "verify", check, result, phase: "result", ...(r.ok ? {} : { reason: r.reason }) } }).catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r;
  }

  /** Reports about this app's members (the console's "Reports after a date"), newest first. Never the reporter's words. */
  safetyReports(rt: NetworkRuntime) { return rt.readState(n => n.safetyReports()); }

  /** The runtimes and member ids of a person, on every app (live memberships). A member from before the platform: this app only. */
  private async membersOfPerson(rt: NetworkRuntime, memberId: MemberId, knownPersonId?: string): Promise<{ personId?: string; members: { rt: NetworkRuntime; memberId: MemberId }[] }> {
    const personId = knownPersonId ?? await this.personOfMember(rt, memberId);
    if (!personId) return { members: [{ rt, memberId }] };
    const members: { rt: NetworkRuntime; memberId: MemberId }[] = [];
    for (const m of await this.people.memberships(personId)) {
      const r = await this.runtimeOfMember(m.app, m.memberId);
      if (r && staffSafetyMembershipLive(m.state)) members.push({ rt: r, memberId: m.memberId as MemberId });
    }
    if (!members.some(x => x.rt === rt && x.memberId === memberId)) members.push({ rt, memberId });
    return { personId, members };
  }

  async hold(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, note: string, reportId?: string): Promise<ActionResult & { reach: string }> {
    const origin = { app: rt.app.id, runtime: rt.id };
    const currentPerson = await this.personOfMember(rt, memberId);
    const archivedPerson = !currentPerson && reportId !== undefined
      ? await rt.scoped(tx => archivedReportSubject(tx, origin, reportId)) : undefined;
    const all = await this.membersOfPerson(rt, memberId, currentPerson ?? archivedPerson);
    const everywhere = crossAppSafety(user);
    const members = all.members.filter(x => staffSafetySelectsTarget(everywhere, archivedPerson ? x.rt.app.id === rt.app.id : x.rt === rt));
    const { personId } = all;
    const scope = durableStaffHoldScope(!!personId && everywhere, rt.app.id);
    const reach = staffSafetyActionReach(everywhere, !!personId);
    const decisionId = randomUUID();
    return { reach, ...await this.audited(rt, user, { type: "member", id: memberId }, { safety: "hold", reportId: reportId ?? null,
      scope: scope === "*" ? "every_app" : "this_app" }, async () => {
      let r: ActionResult;
      try {
        r = await rt.unitOfWork(n => {
          const result = n.holdMember(memberId, user.id, note, reportId, archivedPerson ? "archived" : undefined);
          if (result.ok && personId) {
            const at = this.clock.now();
            rt.unit.memberCommand = archivedPerson && reportId !== undefined
              ? tx => holdFromArchivedReport(tx, origin, reportId, archivedPerson, scope, decisionId, at)
              : tx => recordStaffHold(tx, rt.app.id, memberId, personId, scope, decisionId, at);
          }
          return result;
        });
      } catch (error) {
        if (error instanceof StaffHoldStateChanged) return { ok: false, reason: "hold_changed" };
        throw error;
      }
      const hold = stepStaffSafety(initialStaffSafety, { type: "readPrimaryHold", applied: r.ok });
      if (hold.phase !== "HoldRemainingTargets") return r;
      const relatedReport = staffSafetyReportFor(false, reportId ?? "") || undefined;
      for (const x of members) {
        if (!personId || (x.rt === rt && x.memberId === memberId)) continue;
        try {
          await x.rt.unitOfWork(n => {
            const result = n.holdMember(x.memberId, user.id, note, relatedReport, archivedPerson ? "projection" : undefined);
            if (result.ok) x.rt.unit.memberCommand = tx => checkStaffHoldProjection(tx, x.rt.app.id, x.memberId, personId, decisionId, scope === "*");
            return result;
          });
        } catch (error) {
          if (!(error instanceof StaffHoldStateChanged)) throw error;
        }
      }
      return r;
    }) };
  }

  async clearMinor(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, note: string): Promise<ActionResult & { apps: { app: AppId; result: string }[]; reach: string }> {
    const all = await this.membersOfPerson(rt, memberId);
    const everywhere = crossAppSafety(user);
    const members = all.members.filter(x => staffSafetySelectsTarget(everywhere, x.rt === rt));
    const apps: { app: AppId; result: string }[] = [];
    const r = await this.audited(rt, user, { type: "member", id: memberId }, { safety: "clear_minor", scope: staffSafetyAuditScope(members.length) }, async () => {
      let refusal: string | undefined;
      for (const x of members) {
        const one = await x.rt.unitOfWork(n => {
          const c = n.clearMinorSignal(x.memberId, user.id, note);
          if (!staffAgeMayReviewReports(c.ok, !c.ok && c.reason === "no_signal")) return c;
          let dismissed = 0;
          for (const rep of n.safetyReports()) {
            if (staffMinorReportDismissible(rep.subjectId === x.memberId, rep.kind === "minor", rep.status === "open")
              && n.dismissReport(rep.id, user.id, note).ok) dismissed++;
          }
          return staffAgeAppCleared(c.ok, dismissed > 0) ? { ok: true as const } : c;
        });
        apps.push({ app: x.rt.app.id, result: one.ok ? "cleared" : one.reason });
        if (!one.ok && one.reason !== "no_signal") refusal ??= one.reason;
      }
      const summary = staffAgeClearSummary(!!refusal, apps.some(a => a.result === "cleared"));
      if (summary === "ClearSucceeded" && all.personId) {
        const personId = all.personId;
        const clears: (number | undefined)[] = [];
        for (const x of all.members) clears.push(await x.rt.readState(n => n.minorClearedAt(x.memberId)));
        const known = clears.filter((at): at is number => at !== undefined);
        await rt.scoped(async tx => {
          const [signal] = await tx`select at from platform.person_minor_signals where person_id = ${personId}::uuid for update`;
          if (signal && personMinorSignalEndsEverywhere(known.length === clears.length, (signal.at as Date).getTime(), known.length ? Math.min(...known) : 0)) {
            await tx`delete from platform.person_minor_signals where person_id = ${personId}::uuid`;
          }
        });
      }
      return summary === "ClearSucceeded" ? { ok: true } : { ok: false, reason: summary === "ClearRefused" ? refusal! : "no_signal" };
    });
    return { ...r, apps, reach: staffSafetyActionReach(everywhere, !!all.personId) };
  }

  /** Dismiss a report: it no longer keeps the member out of matching. */
  dismissReport(user: StaffUser, rt: NetworkRuntime, reportId: string, note: string) {
    return this.audited(rt, user, { type: "case", id: reportId }, { safety: "dismiss_report" },
      () => rt.unitOfWork(n => {
        const result = n.dismissReport(reportId, user.id, note);
        if (result.ok) rt.unit.memberCommand = tx => dismissReportRestriction(tx, { app: rt.app.id, runtime: rt.id }, reportId);
        return result;
      }));
  }

  async ban(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, by: "phone" | "person", note: string, reportId?: string): Promise<ActionResult> {
    const personId = await this.personOfMember(rt, memberId);
    const target = { type: "member" as const, id: memberId };
    const admission = stepStaffSafety(initialStaffSafety, {
      type: "startStaffBan", everywhere: crossAppSafety(user), hasPerson: !!personId, phoneOnly: by === "phone",
    });
    if (admission.phase === "BanNeedsCrossApp") return this.refused(user, rt, "ban", target, "needs_safety_everywhere");
    if (admission.phase !== "ReadingBanPhones" || !personId) return this.refused(user, rt, "ban", target, "no_person");
    const hashes = await this.people.phoneHashesOf(personId);
    const phones = stepStaffSafety(admission, { type: "readStaffBanPhones", hasPhone: hashes.length > 0 });
    if (phones.phase !== "ReadingExistingBan") return this.refused(user, rt, "ban", target, "no_phone");
    const previous = await this.people.staffBans(personId, by, hashes);
    const already = phones.phoneOnly ? hashes.every(hash => previous.some(ban => ban.phoneHash === hash)) : previous.length > 0;
    const pendingProjection = previous.some(ban => ban.projectedAt === null);
    const admitted = stepStaffSafety(phones, { type: "checkExistingStaffBan", alreadyBanned: already, pendingProjection });
    const resuming = admitted.phase === "ResumingBanProjection";
    if (admitted.phase !== "ApplyingPersonBan" && admitted.phase !== "ApplyingPhoneBan" && !resuming) {
      return this.refused(user, rt, "ban", target, "already_banned");
    }
    if (!resuming && reportId !== undefined) {
      const ownsReport = await rt.readState(n => n.safetyReports().some(report => report.id === reportId && report.subjectId === memberId));
      if (!staffSafetyReportFor(ownsReport, reportId)) return this.refused(user, rt, "ban", target, "unknown_report");
    }
    return this.audited(rt, user, target, { safety: "ban", by, reportId: (resuming ? previous.find(b => b.projectedAt === null)?.reportId : reportId) ?? null, resuming }, async () => {
      const at = this.clock.now();
      if (!resuming) {
        const rows: Ban[] = (hashes.length ? hashes : [null]).map(phoneHash => ({
          id: `ban_${randomUUID()}`, scope: by, personId, phoneHash, reason: note, reportId: reportId ?? null, bannedBy: user.id, at,
        }));
        for (const ban of rows) await this.people.ban(ban, { deduplicateScope: true });
      }
      const pending = (await this.people.staffBans(personId, by, hashes)).filter(ban => ban.projectedAt === null);
      const saved = pending[0];
      if (!saved) return { ok: true };
      const bannedHashes = [...new Set([...hashes, ...pending.flatMap(ban => ban.phoneHash ? [ban.phoneHash] : [])])];
      for (const h of bannedHashes) await this.people.suppress(h, "banned", at);
      await this.dropRatings(personId);
      await this.people.restrictBannedMemberships(personId);
      const { members } = await this.membersOfPerson(rt, memberId, personId);
      for (const x of members) {
        const r = await x.rt.unitOfWork(n => {
          const ownsReport = saved.reportId !== null && n.safetyReports().some(report => report.id === saved.reportId && report.subjectId === x.memberId);
          const ownReport = staffSafetyReportFor(ownsReport, saved.reportId ?? "") || undefined;
          const marked = n.markBanned(x.memberId, saved.bannedBy, saved.reason, ownReport);
          if (marked.ok) x.rt.unit.memberCommand = async tx => {
            await tx`update network.members set account_status='restricted'
              where app_id=${x.rt.app.id} and id=${x.memberId} and person_id=${personId}::uuid and account_status not in ('removed','invited')`;
          };
          return marked;
        });
        if (!r.ok) return r;
      }
      for (const banned of this.banListeners) await banned(bannedHashes);
      await this.people.completeStaffBans(pending.map(ban => ban.id), this.clock.now());
      return { ok: true };
    });
  }

  /** Audit the requested safety action, run it, then write its result. */
  private async audited(rt: NetworkRuntime, user: StaffUser, target: { type: NonNullable<AuditEntry["targetType"]>; id: string }, detail: Row, fn: () => Promise<ActionResult>): Promise<ActionResult> {
    return this.auditedRun({ actor: user.id, roles: user.roles, action: "safety", targetType: target.type, targetId: target.id, mode: "real", app: rt.app.id }, { ...detail, network: rt.id }, fn);
  }

  /** The request audit row, then the action, then its result row (a failed request row stops the action). */
  // spec/staffSafetyService.md, "Keep the requested and result audits in order"
  private async auditedRun(base: Omit<AuditEntry, "at" | "ok" | "detail">, detail: Row, fn: () => Promise<ActionResult>): Promise<ActionResult> {
    await this.audit.write({ ...base, at: this.clock.now(), ok: true, detail: { ...detail, phase: "requested" } });
    const audited = stepStaffSafety(initialStaffSafety, { type: "recordRequestedSafetyAudit" });
    if (audited.phase !== "PerformingAuditedAction") throw new Error("Safety action requires a request audit");
    const r = await fn();
    if (stepStaffSafety(audited, { type: "recordCompletedSafetyAction" }).phase === "RecordingAuditResult") {
      await this.audit.write({ ...base, at: this.clock.now(), ok: r.ok, detail: { ...detail, phase: "result", ...(r.ok ? {} : { reason: r.reason }) } })
        .catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    }
    return r;
  }

  /** A refused staff action, audited (requested and result rows) without running anything. */
  private async refused(user: StaffUser, rt: NetworkRuntime, safety: string, target: { type: NonNullable<AuditEntry["targetType"]>; id: string }, reason: string): Promise<ActionResult> {
    const base = { actor: user.id, roles: user.roles, action: "safety", targetType: target.type, targetId: target.id, mode: "real" as const, app: rt.app.id };
    await this.audit.write({ ...base, at: this.clock.now(), ok: false, detail: { safety, network: rt.id, phase: "refused", reason } });
    return { ok: false, reason };
  }

  /**
   * Staff read a member's photos (GET /members/:id/photos, X-Network-Reason): admin or safety, a typed
   * reason, verified adults only (checked again here and in PhotoService). The audit row is written
   * before any link is made; refusals are audited too. Links work for 5 minutes and go through the backend.
   */
  async staffPhotos(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, reason: string): Promise<{ ok: true; photos: { id: string; url: string; expiresAt: number }[] } | { ok: false; reason: string }> {
    const base = { actor: user.id, roles: user.roles, action: "read_photos", targetType: "member" as const, targetId: memberId, mode: "real" as const, app: rt.app.id };
    // The photo consent says a person on the safety team looks "only after a report": an open report (or
    // an open safety case) about this member is required, and its id goes in the audit row.
    const ground = await rt.readState(n => {
      const report = n.safetyReports().find(r => r.subjectId === memberId && (r.status === "open" || r.status === "held"));
      if (report) return { reportId: report.id };
      const c = n.safetyCases().find(x => x.memberId === memberId && (x.status === "open" || x.status === "held"));
      return c ? { caseId: c.id } : undefined;
    });
    if (!ground) {
      await this.audit.write({ ...base, at: this.clock.now(), ok: false, detail: { reason, phase: "refused", refused: "no_report" } });
      return { ok: false, reason: "no_report" };
    }
    await this.audit.write({ ...base, at: this.clock.now(), ok: true, detail: { reason, phase: "requested", ...ground } });
    const personId = await this.personOfMember(rt, memberId);
    const r = personId ? await this.photos.staffLinks(personId, rt.app.id, this.photoBaseUrl ?? `https://${rt.app.domain}`) : { ok: false as const, reason: "adults_only" as const };
    await this.audit.write({ ...base, at: this.clock.now(), ok: r.ok, detail: { phase: "result", ...(r.ok ? { photos: r.value.length } : { reason: r.reason }) } }).catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r.ok ? { ok: true, photos: r.value } : { ok: false, reason: r.reason };
  }

  /** The matching switch of one network. A network outside its launch scope refuses "on" (spec/runtimeUnit.md, "Matching runs for an app only inside its launch scope"). */
  setMatching(user: StaffUser, on: boolean, rt = this.main) {
    if (on && !rt.matchingAllowed) {
      // A refused attempt is audited too.
      return this.audit.write({ actor: user.id, roles: user.roles, action: "config", targetType: "config", targetId: `matching_${rt.id}`, mode: "real", app: rt.app.id, at: this.clock.now(), ok: false, detail: { matching: on, network: rt.id, phase: "refused", reason: "matching_not_allowed" } })
        .then(() => ({ ok: false, reason: "matching_not_allowed" }) as ActionResult);
    }
    return this.staffAction(rt, user, "config", { type: "config", id: `matching_${rt.id}` }, { matching: on }, n => { n.setMatchingEnabled(on, user.id); return { ok: true }; });
  }

  /** Health of one network (default The Network), plus a summary of every network the user holds a role for. */
  async health(rt = this.main, user?: StaffUser) {
    const h = await rt.health();
    if (this.runtimes.size < 2) return h;
    const networks = [];
    for (const r of this.runtimes.values()) {
      if (user && r !== rt && !allowed(user, ["admin", "reviewer", "safety", "analyst"], r.app.id, "real")) continue;
      const x = r === rt ? h : await r.health();
      networks.push({ network: x.network, app: x.app, matchingAllowed: x.matchingAllowed, matchingEnabled: x.matchingEnabled, lastTick: x.lastTick.thisInstance, lockHolder: x.lockHolder, backlog: x.backlog });
    }
    return { ...h, networks };
  }

  /** Agent actions inherit one completed open turn; receipts stay on that original inbound owner. */
  private assertLockedRoute(value: unknown): void {
    if (this.routePolicy && (!routeEnvelopeAllowed(this.routePolicy, value, this.clock.now())
      || !sameNetworkAuthority(value, this.routePolicy.authority))) throw new RouteAuthorityExpiredError();
  }

  private async sharedAction(path: string, b: Row, signedId: string, raw: string): Promise<Response> {
    const stateAction = path === SET_STATE_PATH;
    const keys = stateAction ? ["channel","messageId","app","memberId","idempotencyKey","state","from","until","note"]
      : path === SIGNALS_PATH ? ["channel","messageId","app","memberId","signals"] : ["channel","messageId","app","memberId"];
    if (b.networkAuthority !== undefined) keys.push("networkAuthority");
    const key = stateAction ? b.idempotencyKey : `${b.messageId}:${path === SIGNALS_PATH ? "signals" : "updates"}`;
    if (!isAppId(b.app) || typeof b.memberId !== "string" || !b.memberId.trim() || b.memberId.length > 256
      || typeof key !== "string" || !key.trim() || key.length > 512 || /[\r\n\u0000]/.test(key) || signedId !== key
      || Object.keys(b).length !== keys.length || Object.keys(b).some(name => !keys.includes(name))) return json({error:"invalid_request"},400);
    const app = b.app, memberId = b.memberId;
    let window: {state: SetStateRequest["state"]; from: string|null; until: string|null; note: string|null} | undefined;
    if (stateAction) {
      const date = (value: unknown) => value === null || (typeof value === "string" && value.length <= 64
        && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value)));
      if (!["open","busy","traveling","paused"].includes(b.state as string) || !date(b.from) || !date(b.until)
        || (b.note !== null && (typeof b.note !== "string" || b.note.length > 300))
        || (b.from !== null && b.until !== null && Date.parse(b.until as string) <= Date.parse(b.from as string))) return json({error:"invalid_state_window"},400);
      window = {state:b.state as SetStateRequest["state"], from:b.from === null ? null : new Date(b.from as string).toISOString(),
        until:b.until === null ? null : new Date(b.until as string).toISOString(), note:b.note as string|null};
    }
    const signals = path === SIGNALS_PATH ? parseAgentSignals(b.signals) : undefined;
    if (path === SIGNALS_PATH && !signals) return json({error:"invalid_signals"},400);
    const turnId = `msg:${b.channel}:${b.messageId}`;
    const [original] = await this.sql`select sender_hash,response from platform.inbound where id=${turnId} and status='done'`;
    if (!original || original.response?.outcome !== "open" || original.response.app !== app || original.response.memberId !== memberId) return json({error:"turn_scope_invalid",retryable:false},403);
    const who = await this.accounts.byPhoneHash(original.sender_hash), rt = await this.runtimeOfMember(app, memberId);
    if (!who || !rt) return json({error:"membership_unavailable",retryable:false},403);
    const authorized = async () => (await this.accounts.activeMembership(rt.app,{e164:who.e164,personId:who.person.id}))?.membership.memberId === memberId;
    if (!await authorized()) return json({error:"membership_unavailable",retryable:false},403);
    if (path === UPDATES_PATH && !this.notify) return json({error:"canonical_updates_unavailable",retryable:false},503);
    const id = createHash("sha256").update(JSON.stringify([turnId,path,key])).digest("hex"), digest = createHash("sha256").update(raw).digest("hex");
    const lock = async (tx: SQL) => {
      await tx`select id from platform.people where id=${who.person.id} and deleted_at is null for update`;
      await tx`select set_config('app.app_id',${app},true)`;
      await tx`select member_id from platform.memberships where person_id=${who.person.id} and app_id=${app} for update`;
      await tx`select id from network.members where app_id=${app} and id=${memberId} for update`;
      const [turn] = await tx`select status,response,sender_hash,action_receipts,network_authority from platform.inbound where id=${turnId} for update`;
      if (!turn || turn.status !== "done" || turn.sender_hash !== original.sender_hash || turn.response?.outcome !== "open"
        || turn.response.app !== app || turn.response.memberId !== memberId || !await authorized()) throw new Error("Original turn authority changed");
      this.assertLockedRoute(turn.network_authority);
      return turn;
    };
    try {
      const claim = await this.sql.begin(async tx => {
        const turn = await lock(tx), prior = turn.action_receipts[id];
        if (prior) {
          if (prior.requestHash !== digest) return {response:json({error:"action_conflict",retryable:false},409)};
          if (prior.state !== "completed") return {response:json({error:"action_unresolved",retryable:false},409)};
          return {response:json(stateAction ? {...prior.response,replayed:true} : prior.response)};
        }
        if (Object.keys(turn.action_receipts).length >= 16) return {response:json({error:"action_limit",retryable:false},429)};
        if (window?.until && Date.parse(window.until) <= this.clock.now()) return {response:json({error:"expired_state_window"},400)};
        await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${id}],${{requestHash:digest,state:"processing"}}::jsonb) where id=${turnId}`;
        return {response:null};
      });
      if (claim.response) return claim.response;
      const complete = async (tx: SQL, result: Row) => {
        this.assertLockedRoute(b.networkAuthority);
        const saved = await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${id}],${{requestHash:digest,state:"completed",response:result}}::jsonb)
          where id=${turnId} and status='done' and action_receipts->${id}->>'requestHash'=${digest} and action_receipts->${id}->>'state'='processing' returning id`;
        if (!saved.length) throw new Error("Action ownership changed before completion");
      };
      if (path === UPDATES_PATH) {
        if (!await authorized()) throw new Error("Membership revoked before updates");
        // Seen state, surface activity and the action receipt commit together. A
        // blocked notification write may outlive the route window; complete()
        // rechecks it and rolls the entire transaction back in that case.
        if (this.notify!.store instanceof PgNotifyStore) {
          const result = await this.sql.begin(async tx => {
            await lock(tx);
            const notifications = new Notifier(new PgNotifyStore(tx), {get: personId => this.notifyRecipient(personId)}, this.notify!.cfg);
            const items = await notifications.readUpdates(who.person.id, "web", this.clock.now(), undefined, {
              app, ...this.gatedUpdateRead(items => this.inboxUpdateOutcomes(tx, who.person.id, app, items, passesOutputGate)),
            });
            const result = {items:items.map(item => ({summary:item.summary}))};
            await complete(tx, result);
            return result;
          });
          return json(result);
        }
        if (this.routePolicy) return json({error:"canonical_updates_unavailable",retryable:false},503);
        const result = {items:(await this.updatesFor(who.person.id,app,"web",undefined,passesOutputGate)).map(item=>({summary:item.summary}))};
        await this.sql.begin(async tx=>{await lock(tx);await complete(tx,result);});
        return json(result);
      }
      const act = async (tx: SQL) => {
        await lock(tx);
        let result: Row;
        if (window) {
          const [member] = await tx`select participation_state,participation_window from network.members where app_id=${app} and id=${memberId}`;
          const participation = effectiveParticipation(member,this.clock.now()), prior = participation.window;
          const previous = participation.active ? prior!.state : participation.state === "quiet" ? "busy" : participation.state === "paused" ? "paused" : "open";
          const scheduled = window.state === "traveling" || window.from !== null || window.until !== null || window.note !== null;
          const nextWindow = scheduled ? window : null;
          const base = scheduled ? member.participation_state : effectiveParticipation({...member,participation_window:window},this.clock.now()).state;
          const unchanged = base === member.participation_state && (nextWindow === null ? prior === null : !!prior
            && nextWindow.state === prior.state && nextWindow.from === prior.from && nextWindow.until === prior.until && nextWindow.note === prior.note);
          result = {eventId:null,previous,current:window.state,from:window.from,until:window.until,committedAt:new Date(this.clock.now()).toISOString(),replayed:false,unchanged};
          if (!unchanged) {
            await tx`update network.members set participation_state=${base},participation_window=${nextWindow}::jsonb where app_id=${app} and id=${memberId}`;
            const [event] = await tx`insert into network.events(app_id,at,actor_type,actor_id,type,object_type,object_id,payload)
              values(${app},${new Date(this.clock.now())},'member',${memberId},'member_state_requested','member',${memberId},${{state:window.state,from:window.from,until:window.until}}::jsonb) returning id`;
            result.eventId = String(event.id);
          }
        } else {
          result = await recordAgentSignals(tx,{app,memberId,actionId:id,signals:signals!,now:this.clock.now()});
        }
        await complete(tx,result);
        return result;
      };
      if (!signals || !agentSignalsOpenCase(signals)) return json(await this.sql.begin(act));
      // spec/staffSafetyService.md, "An agent signal goes to the decision that owns it": the case event commits with the signal.
      let recorded: Row | undefined;
      await rt.unitOfWork(n => {
        n.recordAgentSafetyConcern(memberId as MemberId);
        rt.unit.memberCommand = async tx => { recorded = await act(tx); };
      });
      if (!recorded) throw new Error("Agent signal unit saved no receipt");
      this.log(`[alert] ${app}: an agent safety concern waits for safety staff (GET /signals)`);
      return json(recorded);
    } catch (error) {
      if (error instanceof RouteAuthorityExpiredError) return json({error:"route_authority_invalid",retryable:false},403);
      const unresolved = await this.sql`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${id}],${{requestHash:digest,state:"unresolved"}}::jsonb)
        where id=${turnId} and status='done' and action_receipts->${id}->>'requestHash'=${digest} and action_receipts->${id}->>'state'='processing' returning id`;
      if (unresolved.length && signals && agentSignalsOpenCase(signals)) {
        this.log(`[alert] ${app}: an agent safety concern for member ${memberId} ended unresolved and did not reach safety staff: ${(error as Error).message}`);
      }
      return json({error:"action_unresolved",retryable:false},409);
    }
  }

  private async openReplayFixedReply(rt: NetworkRuntime, input: TurnRequest, cached: Extract<TurnResponse, {outcome: "open"}>, accountEligible: boolean): Promise<TurnResponse | undefined> {
    const id = `msg:${input.channel}:${input.messageId}`;
    const reply: CollectedReply = {id: `sys:${id}:context`, body: CONTEXT_UNAVAILABLE_REPLY, kind: "reply"};
    const response: TurnResponse = {outcome: "handled", replies: [reply.body], replyIds: [reply.id], delivery: "collected", replyKind: "reply",
      accountEligible, app: cached.app, memberId: cached.memberId, reason: "context_unavailable"};
    const guard = collectedReplyGuard(rt.adapter);
    const line = {id: reply.id, memberId: cached.memberId, to: input.from, kind: "reply" as const, text: reply.body};
    const saved = await this.sql.begin(async tx => {
      const reasons = await guard.collectedLeaks(tx, line);
      if (!collectedReplyMayLeave(reasons.length)) return false;
      if (!await this.inbox.answerOpenReplay(tx, id, reply, response)) return false;
      await guard.recordCollected(tx, [line]);
      return true;
    });
    if (saved) {
      this.log(`[alert] ${cached.app}: a replayed turn's context is unavailable; the replay answers with the fixed reply`);
      return response;
    }
    const [stored] = await this.sql`select response from platform.inbound where id=${id} and status='done'`;
    return stored?.response?.outcome === "handled" ? stored.response as TurnResponse : undefined;
  }

  private async sharedTurn(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST") return json({error: "method_not_allowed"}, 405);
    if (url.search) return json({error: "invalid_request"}, 400);
    const bytes = await readCapped(req, MAX_BODY_BYTES);
    if (bytes === "too_large") return json({error: "payload_too_large"}, 413);
    let raw: string;
    try { raw = new TextDecoder("utf-8", {fatal: true}).decode(bytes); }
    catch { return json({error: "invalid_request"}, 400); }
    const auth = await svcVerify(this.env.SERVICE_TURN_SECRET, {method: req.method, path: url.pathname, headers: req.headers, body: raw, nowS: Math.floor(this.clock.now()/1000)});
    if (!auth.ok) return json({error: auth.reason}, auth.reason === "no_secret" ? 503 : 401);
    let b: Row;
    try { b = JSON.parse(raw); } catch { return json({error: "invalid_request"}, 400); }
    if (!b || typeof b !== "object" || Array.isArray(b) || (b.channel !== "blooio" && b.channel !== "twilio")
      || typeof b.messageId !== "string" || !b.messageId.trim() || b.messageId.length > 512 || /[\r\n\u0000]/.test(b.messageId)) return json({error: "invalid_request"}, 400);
    if (!routeEnvelopeAllowed(this.routePolicy, b.networkAuthority, this.clock.now())) return json({error:"route_authority_invalid"},403);
    if (this.routePolicy) {
      const [original] = await this.sql`select network_authority from platform.inbound where id=${`msg:${b.channel}:${b.messageId}`}`;
      if (original) {
        if (!sameNetworkAuthority(original.network_authority, this.routePolicy.authority)) return json({error:"route_authority_invalid"},403);
      } else if (url.pathname !== TURN_PATH || this.clock.now() >= this.routePolicy.admitUntil) {
        return json({error:"route_admission_closed"},403);
      }
    }
    if ([SET_STATE_PATH,SIGNALS_PATH,UPDATES_PATH].includes(url.pathname)) return this.sharedAction(url.pathname,b,auth.id,raw);
    const digest = createHash("sha256").update(raw).digest("hex");
    const id = `msg:${b.channel}:${b.messageId}`;
    if (url.pathname === TURN_RECEIPT_PATH) {
      if (auth.id !== `${b.messageId}:receipt` || Object.keys(b).length !== (b.networkAuthority === undefined ? 6 : 7)
        || Object.keys(b).some(k => !["channel","messageId","replyIds","providerMessageIds","historyRecorded","outcome","networkAuthority"].includes(k))
        || !Array.isArray(b.replyIds) || !b.replyIds.every(x => typeof x === "string")
        || !Array.isArray(b.providerMessageIds) || !b.providerMessageIds.every(x => typeof x === "string" && x.trim())
        || typeof b.historyRecorded !== "boolean" || !["accepted", "unknown", "rejected"].includes(b.outcome as string)) return json({error: "invalid_request"}, 400);
      const delivery = b.outcome as TurnReceiptRequest["outcome"];
      const replyIds = b.replyIds as string[];
      const phase = await this.sql.begin(tx => recordSignedTurnReceipt({
        digest, delivery, replyIds, providerIds: (b.providerMessageIds as string[]).length > 0, history: b.historyRecorded === true,
      }, {
        readTurn: async () => {
          const [claim] = await tx<{
            status: string;
            response: TurnResponse | null;
            receipt_hash: string | null;
            receipt: TurnReceiptRequest | null;
            replies: CollectedReply[];
            network_authority: unknown;
          }[]>`select status,response,receipt_hash,receipt,replies,network_authority from platform.inbound where id=${id} for update`;
          if (claim?.status !== "done" || claim.response?.outcome !== "handled") return undefined;
          return { ...claim, response: claim.response, knownApp: isAppId(claim.response.app) };
        },
        authorityIsCurrent: claim => !this.routePolicy || routeEnvelopeAllowed(this.routePolicy, claim.network_authority, this.clock.now()),
        receiptValuesMatch: claim => isDeepStrictEqual(claim.receipt, b),
        writeReplies: async ({ response }, status) => {
          if (!isAppId(response.app)) return;
          await tx`select set_config('app.app_id', ${response.app}, true)`;
          await tx`update network.messages set status=${status} where app_id=${response.app} and inbound_id=${id}
            and id in ${tx(replyIds)} and status = any(${tx.array(gatewayReceiptMoves(delivery), "TEXT")})`;
          const runtime = response.memberId ? await this.runtimeOfMember(response.app, response.memberId) : this.runtimeFor(response.app);
          if (runtime) await collectedReplyGuard(runtime.adapter).collectedReceipt(tx, replyIds, delivery, this.clock.now());
        },
        writeReceipt: async () => {
          await tx`update platform.inbound set receipt_hash=${digest},receipt=${b}::jsonb where id=${id}`;
        },
      }));
      switch (phase) {
        case "TurnUnavailable": return json({error: "turn_unavailable", retryable: false}, 409);
        case "AuthorityInvalid": return json({error: "route_authority_invalid", retryable: false}, 403);
        case "Conflict": return json({error: "receipt_conflict", retryable: false}, 409);
        case "ScopeInvalid": return json({error: "receipt_scope_invalid", retryable: false}, 409);
        case "DeliveryInvalid": return json({error: "invalid_receipt", retryable: false}, 400);
      }
      if (receiptAccepted(delivery)) {
        const [claim]=await this.sql`select response from platform.inbound where id=${id}`;
        if (isAppId(claim?.response?.app)) await (claim.response.memberId ? await this.runtimeOfMember(claim.response.app, claim.response.memberId) : this.runtimeFor(claim.response.app))?.projectNotifications();
      }
      return json({ok: true, replayed: phase === "Replayed"});
    }
    if (auth.id !== b.messageId || Object.keys(b).some(k => !["messageId","channel","from","to","text","transport","receivedAt","app","networkAuthority"].includes(k))
      || typeof b.from !== "string" || normalizePhone(b.from) !== b.from
      || (b.to !== null && (typeof b.to !== "string" || normalizePhone(b.to) !== b.to))
      || typeof b.text !== "string" || !b.text.trim() || !["imessage","sms","rcs","unknown"].includes(b.transport as string)
      || typeof b.receivedAt !== "number" || !Number.isSafeInteger(b.receivedAt) || b.receivedAt < 0 || b.receivedAt > 8_640_000_000_000_000 || (b.app !== undefined && !isAppId(b.app))) return json({error: "invalid_request"}, 400);
    const input = b as unknown as TurnRequest;
    const admission = async (app: AppId | undefined) => {
      const person = await this.accounts.personFor(input.from);
      const age = await this.accounts.lowestAge(input.from, person);
      const held = await this.accounts.held(input.from), banned = await this.accounts.banned(input.from, person);
      const optedOut = !!app && resolveConsent(await this.people.lastConsent(input.from, app)) === "opted_out";
      const allowed = !held && !banned && !(await this.people.isSuppressed(this.phoneKey(input.from))) && !optedOut;
      return {person, age, allowed, held, banned, optedOut};
    };
    const result = await this.inbox.signed(input, digest, async turn => {
      const outcome = await this.inbound({kind: "message", channel: input.channel, messageId: input.messageId, from: input.from, to: input.to,
        chatId: input.from, isGroup: false, text: input.text, mediaUrls: [], transport: input.transport, receivedAt: input.receivedAt}, {app: input.app});
      if (outcome === "duplicate") throw new Error("Unresolved turn effects");
      const [row] = await this.sql`select replies from platform.inbound where id=${turn.id}`;
      const collected = row.replies as CollectedReply[];
      if (turn.confirmation && !collected.some(r => r.kind === "compliance")) {
        const confirmationRuntime = turn.app && this.runtimeFor(turn.app);
        if (!confirmationRuntime) throw new Error("A confirmation needs the runtime of its app");
        const conf: CollectedReply = {...turn.confirmation, kind: "compliance"};
        if (await this.collectDirect(confirmationRuntime, input.from, conf)) collected.push(conf);
      }
      const {person, age, allowed: policyAllowed} = await admission(turn.app);
      if (outcome === "left" || (age !== undefined && !canJoin(age))) turn.memberId = undefined;
      const accountEligible = policyAllowed && age !== undefined && canJoin(age);
      const onboarding = policyAllowed && age === undefined && outcome === "join_asked" && !turn.memberId;
      const rt = turn.app ? (turn.memberId ? await this.runtimeOfMember(turn.app, turn.memberId) : this.runtimeFor(turn.app)) : undefined;
      const binding = rt && turn.memberId ? await this.accounts.activeMembership(rt.app, {e164: input.from, personId: person?.id ?? null}) : undefined;
      const gatheringPreference = outcome === "gathering_followup" && collected.length > 0 && gatheringFollowupCommand(input.text)?.kind === "preference";
      if (gatheringPreference && accountEligible && rt && turn.memberId && binding?.membership.memberId === turn.memberId) {
        const memberId = turn.memberId;
        await rt.unitOfWork(net => net.noteGatheringFollowupReply(memberId))
          .catch(() => this.log(`[gathering] preference engagement waits (${rt.id})`));
        await this.lineAdapter()?.engaged?.(input.from);
      }
      if (outcome !== "standing_intents" && outcome !== "travel_presence" && outcome !== "solo_events" && outcome !== "contribution_history" && outcome !== "profile_fact_edit" && outcome !== "participation_controls" && outcome !== "calendar_invite" && outcome !== "gathering_rsvp" && outcome !== "gathering_followup" && outcome !== "peon_candidate_search" && accountEligible && binding && binding.membership.memberId === turn.memberId) {
        await this.lineAdapter()?.engaged?.(input.from);
      }
      if (outcome === "open" && !collected.length && turn.app && turn.memberId) {
        const member = binding?.membership.memberId === turn.memberId;
        const context = member ? await rt!.sharedContext(turn.memberId) : null;
        if (openTurnAnswer(!!context) === "AnswerOpen" && context) return {outcome: "open", channel: input.channel, app: turn.app, memberId: turn.memberId, context};
        const replyRuntime = rt ?? this.runtimeFor(turn.app);
        if (unavailableReplySent(policyAllowed, age !== undefined && !canJoin(age)) && replyRuntime) {
          const unavailable: CollectedReply = {id: `sys:${turn.id}:context`, body: CONTEXT_UNAVAILABLE_REPLY, kind: "reply"};
          const memberId = turn.memberId, guard = collectedReplyGuard(replyRuntime.adapter);
          const line = {id: unavailable.id, memberId, to: input.from, kind: "reply" as const, text: unavailable.body};
          const sent = member ? await this.sql.begin(async tx => {
            const reasons = await guard.collectedLeaks(tx, line);
            if (!collectedReplyMayLeave(reasons.length)) return false;
            await this.inbox.collect(tx, [unavailable]);
            await guard.recordCollected(tx, [line]);
            return true;
          }) : await this.collectDirect(replyRuntime, input.from, unavailable);
          if (sent) collected.push(unavailable);
          this.log(`[alert] ${turn.app}: a member's context is unavailable; the turn answers with the fixed reply`);
        }
      }
      if (outcome === "no_network" || outcome === "unknown_sender") return {outcome: "ignored", reason: outcome};
      return {outcome: "handled", replies: collected.map(r => r.body), replyIds: collected.map(r => r.id), delivery: "collected",
        replyKind: collected.length && collected.every(r => r.kind === "compliance") ? "compliance" : "reply", accountEligible,
        app: turn.app ?? null, memberId: turn.memberId ?? null, reason: onboarding ? "onboarding_asked" : outcome === "open" ? "context_unavailable" : outcome, ...(turn.consent ? {consent: turn.consent} : {})} satisfies TurnResponse;
    }, this.routePolicy?.admitUntil);
    if (result.status === 200 && result.body && typeof result.body === "object" && "outcome" in result.body && result.body.outcome === "open") {
      const cached = result.body as Extract<TurnResponse, {outcome: "open"}>;
      const rt = await this.runtimeOfMember(cached.app, cached.memberId);
      const binding = rt && await this.accounts.activeMembership(rt.app, {e164: input.from, personId: null});
      const number = await admission(cached.app);
      const sameMember = binding?.membership.memberId === cached.memberId;
      const current = sameMember ? await rt!.sharedContext(cached.memberId) : null;
      const replay = openReplayAnswer(storedReplyAdmitted(true, number.optedOut, number.held, number.banned), sameMember, !!current);
      if (replay === "ReplayCurrentContext" && current) return json({...cached, context: current} satisfies TurnResponse);
      if (replay === "ReplayFixedReply" && rt) {
        const answered = await this.openReplayFixedReply(rt, input, cached, number.allowed && number.age !== undefined && canJoin(number.age));
        if (answered) return json(answered);
      }
      return json({error: "turn_context_changed", retryable: false}, 409);
    }
    if (result.status===200 && result.body && typeof result.body==="object" && "outcome" in result.body && result.body.outcome==="handled") {
      const handled=result.body as Extract<TurnResponse,{outcome:"handled"}>;
      if (handled.replyKind !== "compliance" && handled.app && handled.memberId && handled.replyIds?.length) {
        const memberId = handled.memberId;
        const rt = await this.runtimeOfMember(handled.app, memberId);
        const replyIds = handled.replyIds;
        const bookingRuntime = rt ?? this.runtimeFor(handled.app);
        if (bookingRuntime && await bookingRuntime.scoped(tx => peerOpportunityContactRestricted(tx, bookingRuntime.app.id, memberId, replyIds))) {
          return json({ error: "turn_opportunity_blocked", retryable: false }, 409);
        }
        if (bookingRuntime && await bookingRuntime.scoped(tx =>
          originalBookingNoticeStale(tx, bookingRuntime.app.id, bookingRuntime.pg.id, replyIds, this.clock))) {
          return json({ error: "turn_booking_changed", retryable: false }, 409);
        }
        if (bookingRuntime && !await bookingRuntime.scoped(tx =>
          bookingRuntime.gatheringRepeatRepliesCurrent(tx, memberId, input.from, replyIds, handled.replies))) {
          return json({ error: "turn_gathering_repeat_changed", retryable: false }, 409);
        }
        if (bookingRuntime?.app.id === "peon" && !await bookingRuntime.scoped(tx =>
          bookingRuntime.peonHireRepliesCurrent(tx, memberId, replyIds, handled.replies))) {
          return json({ error: "turn_peon_search_changed", retryable: false }, 409);
        }
        const schedulingIds = replyIds.filter(id => id.startsWith(RESCHEDULE_QUEUE_PREFIX));
        if (schedulingIds.length) {
          const current = await rt?.readState(async net => {
            const binding = await this.accounts.activeMembership(rt.app, { e164: input.from, personId: null });
            return binding?.membership.memberId === memberId && schedulingIds.every(id => net.rescheduleReplyCurrent(memberId, id));
          });
          if (!current) return json({ error: "turn_booking_time_changed", retryable: false }, 409);
        }
      }
      if (handled.reason === "calendar_invite" && handled.replies.length) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        const allowed = rt && memberId && handled.replies.length === 1 && calendarInviteRequest(input.text)
          && await rt.scoped(tx => calendarReplyCurrent(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from }, handled.replies[0]!, () => this.clock.now()));
        if (!allowed) return json({ error: "turn_calendar_invite_changed", retryable: false }, 409);
      }
      if (handled.reason === "gathering_rsvp" && handled.replies.length) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        const command = gatheringRsvpCommand(input.text);
        const current = rt && memberId && command && handled.replies.length === 1 && await rt.scoped(tx =>
          gatheringRsvpReplyCurrent(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from }, command,
            { id: `in:${input.channel}:${input.messageId}`, at: input.receivedAt }, this.clock.now()));
        if (!current) return json({ error: "turn_gathering_rsvp_changed", retryable: false }, 409);
      }
      if (handled.reason === "gathering_followup" && handled.replies.length) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        const command = gatheringFollowupCommand(input.text);
        const current = rt && memberId && command && handled.replies.length === 1 && await rt.scoped(tx =>
          gatheringFollowupReplyCurrent(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from }, command,
            { id: `in:${input.channel}:${input.messageId}`, at: input.receivedAt }, this.clock.now(), this.hashKey, handled.replies[0]!));
        if (!current) return json({ error: "turn_gathering_followup_changed", retryable: false }, 409);
      }
      if (handled.reason === "inbox_updates" && handled.replies.length && !await this.threadUpdatesReplyCurrent(input, handled)) {
        return json({error: "turn_inbox_updates_changed", retryable: false}, 409);
      }
      if (handled.reason === "standing_intents" && handled.replies.length) {
        const rt = handled.app && handled.memberId ? await this.runtimeOfMember(handled.app, handled.memberId) : undefined;
        const e164 = normalizePhone(input.from);
        const binding = rt && e164 && await this.accounts.activeMembership(rt.app, { e164, personId: null });
        if (!standingIntentReplayAllowed(!!binding && binding.membership.memberId === handled.memberId)) return json({error: "turn_intent_account_changed", retryable: false}, 409);
      }
      if (handled.reason === "cofounder_intent" && handled.replies.length) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        const live = rt && memberId && await rt.scoped(tx => this.cofounderIntentOwner(tx, rt, memberId, input.from));
        if (!live) return json({error: "turn_intent_account_changed", retryable: false}, 409);
      }
      if (handled.reason === "peon_candidate_search" && handled.replies.length) {
        const memberId = handled.memberId;
        const rt = handled.app === "peon" && memberId ? await this.runtimeOfMember("peon", memberId) : undefined;
        const command = peonSearchCommand(input.text);
        const current = rt && memberId && command && handled.replies.length === 1 && await rt.scoped(tx =>
          peonSearchReplyCurrent(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from }, command, handled.replies[0]!, this.clock.now()));
        if (!current) return json({error: "turn_peon_search_changed", retryable: false}, 409);
      }
      if (handled.reason === "travel_presence" && handled.replies.length) {
        const rt = handled.app && handled.memberId ? await this.runtimeOfMember(handled.app, handled.memberId) : undefined;
        const memberId = handled.memberId;
        const authorized = rt && memberId && await rt.scoped(tx => travelOwner(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from }));
        if (!authorized) return json({error: "turn_travel_account_changed", retryable: false}, 409);
      }
      if (handled.reason === "participation_controls" && handled.replies.length) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        const binding = rt && memberId && await rt.scoped(tx => memberCommandOwner(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from }));
        if (!binding || !binding.member) return json({error: "turn_participation_account_changed", retryable: false}, 409);
      }
      if (handled.reason === "solo_events" && handled.replies.length) {
        const rt = handled.app && handled.memberId ? await this.runtimeOfMember(handled.app, handled.memberId) : undefined;
        const memberId = handled.memberId;
        const period = soloConciergeRequest(input.text);
        const live = rt && memberId && period && await rt.scoped(tx => soloConciergeReply(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from }, period, this.clock.now())).catch(() => null);
        if (live === null) return json({error: "concierge_unavailable", retryable: true}, 503);
        const available = typeof live === "object" && live !== null;
        if (!soloReplyReplayAllowed(available, available && handled.replies.length === 1 && handled.replies[0] === live.body)) {
          return json({error: "turn_concierge_changed", retryable: false}, 409);
        }
      }
      if (handled.reason === "contribution_history" && handled.replies.length) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        const page = contributionHistoryRequest(input.text);
        const live = rt && memberId && page !== undefined
          ? await rt.scoped(tx => contributionHistoryReply(tx, this.accountsFor(tx), { app: rt.app, memberId, e164: input.from }, page)).catch(() => null)
          : undefined;
        if (live === null) return json({error: "contribution_history_unavailable", retryable: true}, 503);
        if (!contributionHistoryReplayAllowed(live !== undefined, handled.replies.length === 1 && handled.replies[0] === live)) {
          return json({error: "turn_contribution_history_changed", retryable: false}, 409);
        }
      }
      if (handled.reason === "profile_fact_edit" && handled.replies.length && !await this.profileFactReplyCurrent(input, handled)) {
        return json({error: "turn_profile_fact_changed", retryable: false}, 409);
      }
      if (handled.reason === "member_invitation" && handled.replies.length) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        const links = rt ? handled.replies.flatMap(body => body.split(/\s+/)).filter(link => isMemberInvitationLink(rt.app, link)) : [];
        const hash = rt && links.length === 1 ? memberInvitationHash(this.hashKey, rt.app.id, links[0]!.slice(-43)) : undefined;
        const current = rt && memberId && hash && await rt.scoped(async tx => {
          const referral = await findMemberInvitation(tx, rt.app.id, hash, this.clock.now());
          return referral?.inviterMemberId === memberId && await this.invitationOwner(tx, rt.app, memberId, input.from);
        });
        if (!current) return json({error: "turn_invitation_changed", retryable: false}, 409);
      }
      if (handled.replyIds?.some(id => id.startsWith("invite-vouch:"))) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        const current = rt && memberId && await rt.scoped(async tx => {
          if (!await this.invitationOwner(tx, rt.app, memberId, input.from)) return false;
          if (handled.reason === "member_invitation_delivery") return this.expectedInvitationReplyCurrent(tx, rt, memberId, input.text, handled.replies);
          if (handled.reason !== "member_invitation_review") return true;
          const body = handled.replies[0];
          const reference = body?.match(/ CHECK INVITE (mir_[0-9a-f]{32})\.$/)?.[1];
          return handled.replies.length === 1 && !!reference && body === this.copyOf(rt.app).inviteInReview(reference)
            && await memberInvitationReviewStatus(tx, rt.app.id, reference, memberId, this.clock.now()) === "pending";
        });
        if (!current) {
          return json({error: "turn_invitation_changed", retryable: false}, 409);
        }
      }
      if (handled.replyIds?.some(id => id.startsWith("home-help:"))) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        if (!rt || !memberId || !await rt.scoped(tx => this.homeHelpSender(tx, rt, memberId, input.from))) {
          return json({error: "turn_home_help_changed", retryable: false}, 409);
        }
      }
      if (handled.replyIds?.some(id => id.startsWith("home-help-consent-reply:"))) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        if (!rt || !memberId || !await rt.scoped(tx => boundedHomeHelpSenderCurrent(this.accountsFor(tx), rt.app, { memberId, e164: input.from }))) {
          return json({error: "turn_home_help_changed", retryable: false}, 409);
        }
      }
      const invitationNotices = handled.replyIds?.filter(id => id.startsWith("invite-notice:")) ?? [];
      if (invitationNotices.length) {
        const memberId = handled.memberId;
        const rt = handled.app && memberId ? await this.runtimeOfMember(handled.app, memberId) : undefined;
        const current = rt && memberId && await rt.scoped(async tx => {
          if (!await this.invitationOwner(tx, rt.app, memberId, input.from)) return false;
          for (const id of invitationNotices) if (!await rt.invitationNoticeAdmission(tx, id, memberId)) return false;
          return true;
        });
        if (!current) return json({error: "turn_invitation_notice_changed", retryable: false}, 409);
      }
      if (handled.reason === "onboarding_asked") {
        const current = await admission(handled.app ?? undefined);
        if (!current.allowed || current.age !== undefined) return json({error: "turn_onboarding_changed", retryable: false}, 409);
      }
      if (handled.app && handled.replies.length) {
        const number = await admission(handled.app);
        // spec/signedInbox.md, "A stored ordinary reply goes out only while the number stays admitted"
        if (!storedReplyAdmitted(handled.replyKind !== "compliance", number.optedOut, number.held, number.banned)) {
          return json({error: "turn_context_changed", retryable: false}, 409);
        }
      }
      if (handled.app) await (handled.memberId ? await this.runtimeOfMember(handled.app, handled.memberId) : this.runtimeFor(handled.app))?.projectNotifications();
    }
    return json(result.body, result.status);
  }

  /** Purpose-scoped proof of a successful per-item preview by this actual reviewer. */
  private photoReviewProof(item:PhotoRelayItem,reviewer:string,until:number):string {
    const {id,app,photoId,sha256,bytes,contentType,threadId,senderPersonId,recipientPersonId,senderMemberId,recipientMemberId,consentId,consentedAt,expiresAt,policyVersion,policyNotice,notice}=item;
    return keyedHash(this.hashKey,`photo-review:${JSON.stringify({reviewer,until,id,app,photoId,sha256,bytes,contentType,threadId,senderPersonId,recipientPersonId,senderMemberId,recipientMemberId,consentId,consentedAt,expiresAt,policyVersion,policyNotice,notice})}`);
  }
  private validPhotoReview(item:PhotoRelayItem,reviewer:string,value:unknown):boolean {
    if(typeof value!=="string" || !/^[1-9]\d{0,15}\.[a-f0-9]{64}$/.test(value))return false;
    const [raw,proof]=value.split("."),until=Number(raw);
    return Number.isSafeInteger(until) && until>this.clock.now() && until<=item.expiresAt && safeEqual(proof!,this.photoReviewProof(item,reviewer,until));
  }

  /** Resolve only an existing claimed queue item; no caller-chosen origin or attachment URL. */
  private async resolveRelayPhoto(req: Request): Promise<Response> {
    const url=new URL(req.url);
    if (req.method!=="POST" || url.search) return json({error:"invalid_request"},400);
    const bytes=await readCapped(req,RELAY_PHOTO_RESOLVE_MAX_BODY_BYTES);
    if (bytes==="too_large") return json({error:"payload_too_large"},413);
    let raw:string,b:Record<string,unknown>;
    try {raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);b=JSON.parse(raw);} catch {return json({error:"invalid_request"},400);}
    const auth=await svcVerify(this.env.SERVICE_TURN_SECRET,{method:"POST",path:RELAY_PHOTO_RESOLVE_PATH,headers:req.headers,body:raw,nowS:Math.floor(this.clock.now()/1000)});
    if (!auth.ok) return json({error:auth.reason},auth.reason==="no_secret"?503:401);
    if (!b || typeof b!=="object" || Array.isArray(b) || Object.keys(b).some(k=>!["networkAuthority","id","deliveryId","to","approvedPhotos"].includes(k))
      || typeof b.id!=="string" || b.id!==auth.id || typeof b.deliveryId!=="string" || typeof b.to!=="string" || normalizePhone(b.to)!==b.to)
      return json({error:"invalid_request"},400);
    // Isolated handled-reply realms cannot originate relays, even with a valid envelope.
    if (!routeEnvelopeAllowed(this.routePolicy,b.networkAuthority,this.clock.now()) || this.routePolicy) return json({error:"route_authority_invalid"},403);
    const photos=parseApprovedRelayPhotos(b.approvedPhotos);
    if (!photos || !this.photoDeliveryOrigin || photos.length!==1 || b.deliveryId!==`relay:${photos[0]!.itemId}`) return json({error:"photo_unavailable"},403);
    const d=photos[0]!,rt=await this.runtimeOfMember(d.app,d.recipientMemberId);
    if (!rt) return json({error:"photo_unavailable"},403);
    const allowed=await rt.scoped(async tx=>{
      const [row]=await tx`select outbound.*,identity.e164 from platform.outbound outbound
        join network.members member on member.app_id=outbound.app_id and member.id=outbound.member_id
        join platform.phone_identities identity on identity.person_id=member.person_id
        where outbound.id=${b.deliveryId as string} and outbound.app_id=${d.app} and identity.e164=${b.to as string}`;
      if (!row || row.status!=="sending" || row.member_id!==d.recipientMemberId || row.opportunity_id!==d.threadId || row.to_address!==b.to
        || !isDeepStrictEqual(row.approved_photos,photos)) return false;
      return (await rt.relayAdmission(tx,{id:row.id,memberId:row.member_id,oppId:row.opportunity_id,approvedPhotos:photos})).ok;
    });
    if (!allowed) return json({error:"photo_unavailable"},403);
    const resolved=await this.photoRelay.issueDelivery(d,d.recipientMemberId,b.id as string,this.photoDeliveryOrigin);
    return resolved?json({photos:[resolved]}):json({error:"photo_unavailable"},403);
  }

  // ------------------------------------------------------------------ HTTP
  /** The HTTP handler: the inbound webhooks and the staff API. The public API is publicFetch (its own port). */
  fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === RELAY_PHOTO_RESOLVE_PATH) return this.resolveRelayPhoto(req);
    if (url.pathname === calendarOwnerPath && this.calendarScheduling) return this.calendarScheduling.ownerProof(req, input => this.calendarSchedulingOwner(input));
    if (url.pathname === LEARNING_CONSENT_CONTEXT_PATH) return learningConsentContextEndpoint({ sql: this.sql, now: () => this.clock.now(), secret: this.env.SERVICE_TURN_SECRET, routePolicy: this.routePolicy, reviewEnabled: !!this.suggestionIdentity }, req);
    if (url.pathname === PROFILE_REVIEW_WITHDRAWAL_PATH) {
      const resolver = this.suggestionWithdrawalOwner;
      const current = () => Number.isSafeInteger(this.clock.now()) && !!this.routePolicy && this.clock.now() < this.routePolicy.admitUntil;
      if (!resolver || !current()) return json({ error: "cleanup_unavailable" }, 503);
      return profileSuggestionWithdrawalEndpoint(req, {
        secret: this.env.SERVICE_TURN_SECRET ?? "", now: () => this.clock.now(), valid: current,
        resolveWithdrawalOwner: resolver,
        applyOwnerWithdrawal: async (owner, request, proof, fence) => {
          let currentProof = proof;
          const valid = () => fence() && current() && this.clock.now() >= currentProof.issuedAt && this.clock.now() < currentProof.expiresAt;
          const withdrawalStore = new ProfileSuggestions(this.sql, async () => false, async (who, tx) => {
            if (!valid()) return false;
            const [turn] = await tx`select network_authority from platform.inbound where id=${`msg:${proof.channel}:${proof.messageId}`} and status='done'`;
            if (!turn || !routeEnvelopeAllowed(this.routePolicy, turn.network_authority, this.clock.now())) return false;
            const response = await resolver(request, proof.requestSha256);
            const refreshed = parseProfileReviewWithdrawalProof(response, request, proof.requestSha256, this.clock.now());
            if (!refreshed || !valid() || refreshed.cutoffAt !== proof.cutoffAt
              || refreshed.channel !== proof.channel || refreshed.messageId !== proof.messageId || refreshed.commandSha256 !== proof.commandSha256
              || refreshed.userId !== proof.userId || refreshed.organizationId !== proof.organizationId || refreshed.chatId !== proof.chatId
              || who.personId !== refreshed.personId || who.app !== refreshed.app || who.userId !== refreshed.userId
              || who.organizationId !== refreshed.organizationId || who.chatId !== refreshed.chatId) return false;
            currentProof = refreshed;
            return valid() && routeEnvelopeAllowed(this.routePolicy, turn.network_authority, this.clock.now());
          }, { now: () => this.clock.now(), valid });
          return withdrawalStore.applyOwnerWithdrawal(owner, request, proof, valid);
        },
      });
    }
    if (url.pathname === PROFILE_REVIEW_DISCONNECT_PATH) {
      const resolver = this.suggestionRevokedOwner;
      const current = () => Number.isSafeInteger(this.clock.now()) && !!this.routePolicy && this.clock.now() < this.routePolicy.admitUntil;
      if (!resolver || !current()) return json({ error: "cleanup_unavailable" }, 503);
      return profileSuggestionDisconnectEndpoint(req, {
        secret: this.env.SERVICE_TURN_SECRET ?? "", now: () => this.clock.now(), valid: current,
        resolveRevokedOwner: resolver,
        applyRevokedConnection: async (owner, request, proof, fence) => {
          let currentProof = proof;
          const valid = () => fence() && current() && this.clock.now() >= currentProof.issuedAt && this.clock.now() < currentProof.expiresAt;
          const revokedStore = new ProfileSuggestions(this.sql, async () => false, async (who) => {
            if (!valid()) return false;
            const response = await resolver(request, proof.requestSha256);
            const refreshed = parseProfileReviewDisconnectProof(response, request, proof.requestSha256, this.clock.now());
            if (!refreshed || !valid() || refreshed.revokedAt !== proof.revokedAt
              || refreshed.userId !== proof.userId || refreshed.organizationId !== proof.organizationId || refreshed.chatId !== proof.chatId
              || who.personId !== refreshed.personId || who.app !== refreshed.app || who.userId !== refreshed.userId
              || who.organizationId !== refreshed.organizationId || who.chatId !== refreshed.chatId) return false;
            currentProof = refreshed;
            return valid();
          }, { now: () => this.clock.now(), valid });
          return revokedStore.applyRevokedConnection(owner, request, proof, valid);
        },
      });
    }
    if (url.pathname.startsWith(SUGGESTION_PATH)) return profileSuggestionEndpoint({ sql: this.sql, now: () => this.clock.now(), secret: this.env.SERVICE_TURN_SECRET, routePolicy: this.routePolicy, resolveIdentity: this.suggestionIdentity, authorizeSource: this.suggestionAuthorization }, req);
    if ([TURN_PATH, TURN_RECEIPT_PATH, SET_STATE_PATH, SIGNALS_PATH, UPDATES_PATH].includes(url.pathname)) return this.sharedTurn(req);
    if (url.pathname === RELAY_PATH) return relayEndpoint({ sql: this.sql, clock: this.clock, secret: this.env.SERVICE_TURN_SECRET, routePolicy: this.routePolicy, accounts: this.accounts, photos:this.photoRelay, choosePhoto: input => choosePhoto({ sql: this.sql, photos: this.photos, relay: this.photoRelay, now: () => this.clock.now() }, input), withdrawPhoto: input => withdrawPhoto({ relay: this.photoRelay }, input), runtimeFor: app => this.runtimeFor(app), runtimeOfMember: (app, memberId) => this.runtimeOfMember(app, memberId), ...(this.relayHookFor ? { hookFor: this.relayHookFor } : {}) }, req);
    let path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === WEBHOOK_PATH || path.startsWith(`${WEBHOOK_PATH}/`)) {
        if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        const appPart = path.slice(WEBHOOK_PATH.length + 1);
        if (!appPart) return this.webhook(req, this.secret);
        if (!isAppId(appPart)) return json({ ok: false, error: "not_found" }, 404);
        return this.webhook(req, this.secrets[appPart], appPart);
      }
      // Production review is "human" only (PRD 32.8). The mode is not exposed here.
      if (path === "/review-mode" || path.endsWith("/review-mode")) return json({ ok: false, error: "not_exposed" }, 404);
      // The network: /apps/:app/... or ?app= (and ?city=); default The Network.
      let app: AppId = "ntwrk";
      const scoped = path.match(/^\/apps\/([^/]+)(\/.*)?$/);
      const named = scoped ? scoped[1]! : url.searchParams.get("app");
      if (named !== null) {
        if (!isAppId(named)) return json({ ok: false, error: "unknown_app" }, 404);
        app = named;
      }
      if (scoped) path = scoped[2] ?? "/";
      const rt = this.runtimeFor(app, url.searchParams.get("city") ?? undefined) ?? (named === null ? this.main : undefined);
      if (!rt) return json({ ok: false, error: "no_network" }, 404);
      const auth = this.tokens.size ? authenticate(req, { tokens: this.tokens }) : { status: 401 as const, error: "no staff tokens configured (NETWORK_SERVICE_TOKENS)" };
      if (!("user" in auth)) return json({ ok: false, error: auth.error }, auth.status);
      const { user, actor } = this.reviewerOfRecord(req, auth.user);
      const consoleStep = serviceStaffStep(req.method, path);
      if (consoleStep && !staffStepActorAccepted(this.consoleToken !== undefined, actor)) {
        return json({ ok: false, code: "named_reviewer_required", error: `${consoleStep} needs the console token with the signed-in person in X-Network-Staff-Id` }, 403);
      }
      // A role for this app (role@app or role@*); admin for the app passes every check.
      const need = (roles: StaffRole[]) => (allowed(user, roles, rt.app.id, "real") ? undefined : json({ ok: false, code: "forbidden", error: `needs role ${roles.map(r => `${r}@${rt.app.id}`).join(" or ")}` }, 403));
      const gatheringRead = path.match(/^\/gatherings\/([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\/(roster|priority)$/);
      if (scoped && gatheringRead) {
        if (rt.app.id !== "ntwrk" || rt.city !== "nyc") return json({ ok: false, error: "not_found" }, 404);
        const no = need(["admin"]); if (no) return no;
        if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
        const rev = url.searchParams.get("revision") ?? "";
        const revision = Number(rev);
        if (!/^[1-9][0-9]*$/.test(rev) || revision > 2_147_483_647) return json({ ok: false, error: "invalid_revision" }, 400);
        const id = gatheringRead[1]!;
        const key = { id, revision };
        const priority = gatheringRead[2] === "priority";
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles,
          action: priority ? "read_gathering_priority" : "read_gathering_roster", targetId: id, mode: "real", ok: true, app: rt.app.id });
        const items = priority ? await readGatheringInvitees(rt, tx => this.accountsFor(tx), key, () => this.clock.now())
          : await rt.scoped(tx => gatheringRsvpRoster(tx, this.accountsFor(tx), rt.app, key, this.clock.now()));
        return items ? json({ ok: true, items }) : json({ ok: false, error: "not_found" }, 404);
      }
      if (scoped) {
        const gatherings = await handleMonthlyGatherings(req, path, { app: rt.app.id, city: rt.city, staff: user,
          now: () => this.clock.now(), scoped: run => rt.scoped(run) });
        if (gatherings) return gatherings;
        const invitationReview = await handleMonthlyGatheringInvitationReview(req, path, {
          app: rt.app, city: rt.city, staff: user, now: () => this.clock.now(), scoped: run => rt.scoped(run),
          withRecommendation: async run => await rt.readState(net => run((tx, key, capacity) => {
            const now = this.clock.now();
            const ranked = rankGatheringInvitees(net.gatheringPriorityEvidence(now));
            return eligibleGatheringInvitees(tx, this.accountsFor(tx), rt.app, key, ranked, capacity, now);
          })),
        });
        if (invitationReview) return invitationReview;
        const grouping = await handleMonthlyGatheringGrouping(req, path, {
          app: rt.app, city: rt.city, staff: user, now: () => this.clock.now(), scoped: run => rt.scoped(run),
          accountsFor: tx => this.accountsFor(tx),
          withGroupingEvidence: async run => await rt.readState(net => run((ids, now) => net.gatheringGroupingEvidence(ids, now))),
        });
        if (grouping) return grouping;
      }
      if (req.method === "GET" && path === "/health") {
        const no = need(["admin", "reviewer", "safety", "analyst"]); if (no) return no;
        return json(await this.health(rt, user));
      }
      if (req.method === "GET" && path === "/review") {
        const no = need(["reviewer", "safety"]); if (no) return no;
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_review_queue", mode: "real", ok: true, app: rt.app.id });
        return json({ ok: true, network: rt.id, items: await this.reviewQueue(rt) });
      }
      const planPreviewPath = path.match(/^\/review\/([^/]+)\/plan$/);
      if (req.method === "GET" && planPreviewPath) {
        const no = need(["reviewer", "safety"]); if (no) return no;
        let id: string;
        try { id = decodeURIComponent(planPreviewPath[1]!); } catch { return json({ ok: false, error: "invalid_review" }, 400); }
        const seen = url.searchParams.get("revision");
        const revision = seen !== null && /^\d+$/.test(seen) ? Number(seen) : NaN;
        if (id.length > 200 || !Number.isSafeInteger(revision)) return json({ ok: false, error: "invalid_review" }, 400);
        const now = this.clock.now();
        await this.audit.write({ at: now, actor: user.id, roles: user.roles, action: "read_review_plan", mode: "real", ok: true,
          app: rt.app.id, targetType: "opportunity", targetId: id, detail: { revision } });
        const preview = await rt.readState(net => net.reviewPlanPreview(id, revision));
        return preview ? json({ ok: true, preview: { app: rt.app.id, ...preview } }) : json({ ok: false, error: "preview_unavailable" }, 404);
      }
      const probePreviewPath = path.match(/^\/review\/([^/]+)\/probes$/);
      if (req.method === "GET" && probePreviewPath) {
        // spec/probeDispatch.md, "A reviewer can read each first probe of the open revision"
        const no = need(["reviewer", "safety"]); if (no) return no;
        let id: string;
        try { id = decodeURIComponent(probePreviewPath[1]!); } catch { return json({ ok: false, error: "invalid_review" }, 400); }
        const seen = url.searchParams.get("revision");
        const revision = seen !== null && /^\d+$/.test(seen) ? Number(seen) : NaN;
        if (id.length > 200 || !Number.isSafeInteger(revision)) return json({ ok: false, error: "invalid_review" }, 400);
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_review_probes", mode: "real", ok: true,
          app: rt.app.id, targetType: "opportunity", targetId: id, detail: { revision } });
        const preview = await rt.readState(net => net.reviewProbePreview(id, revision));
        return preview ? json({ ok: true, preview: { app: rt.app.id, ...preview } }) : json({ ok: false, error: "preview_unavailable" }, 404);
      }
      const privacy = await handlePrivacyStaff(this, req, path, user); if (privacy) return privacy;
      if (path === "/holds") {
        // Numbers on hold (they may have a new owner): staff for every app decide (GET lists, POST decides).
        if (!hasEverywhere(user, "admin")) return json({ ok: false, code: "forbidden", error: "needs role admin@*" }, 403);
        if (req.method === "GET") return json({ ok: true, holds: (await this.accounts.heldPhones()).map(h => ({ phone: maskPhone(h.e164), hold: h.hold, lastSeenAt: h.lastSeenAt })) });
        if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        const b = await body(req) as Record<string, any> | undefined;
        const e164 = normalizePhone(b?.phone);
        if (!e164 || (b?.decision !== "same_owner" && b?.decision !== "new_owner")) return json({ ok: false, error: "phone_and_decision_required" }, 400);
        const target = this.phoneKey(e164).slice(0, 16);
        return result(await this.auditedRun({ actor: user.id, roles: user.roles, action: "safety", targetType: "member", targetId: target, mode: "real" },
          { safety: "phone_hold", decision: b.decision },
          async () => (await this.accounts.clearHold(e164, b.decision)) ? { ok: true } : { ok: false, reason: "not_held" }));
      }
      if (req.method === "GET" && path === "/safety/reports") {
        const no = need(["safety"]); if (no) return no;
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_safety_reports", mode: "real", ok: true, app: rt.app.id });
        return json({ ok: true, network: rt.id, reports: await this.safetyReports(rt) });
      }
      if (path === "/safety/home-help" || path.startsWith("/safety/home-help/")) {
        const homeHelp = await handleBoundedHomeHelpStaff({
          store: new BoundedHomeHelp(this.homeHelpAuthority(user), () => this.clock.now()),
          transaction: (_app, fn) => rt.scoped(fn), writeAudit: writeBoundedHomeHelpStaffAudit, now: () => this.clock.now(),
          stageConsent: (tx, key) => this.homeHelpConsent().stage(tx, key),
        }, req, { app: rt.app.id, path, user });
        if (homeHelp) return homeHelp;
      }
      if (path === "/review/member-invitations") {
        const no = need(["reviewer", "safety"]); if (no) return no;
        const at = this.clock.now();
        if (req.method === "GET") {
          const reviews = await rt.scoped(tx => staffInvitationReviewQueue(tx, rt.app.id, user, at));
          return reviews ? json({ ok: true, reviews }) : json({ error: "forbidden" }, 403);
        }
        if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        const data = await body(req) as Record<string, unknown> | undefined;
        const id = data?.id, decision = data?.decision;
        if (typeof id !== "string" || (decision !== "approve" && decision !== "deny")) return json({ error: "invalid_invitation_decision" }, 400);
        const resolved = await rt.scoped(tx => staffDecideInvitationReview(tx, rt.app.id, id, decision, user, at));
        if (resolved === "forbidden") return json({ error: "forbidden" }, 403);
        return resolved === "decided" ? json({ ok: true }) : json({ error: "invitation_review_unavailable" }, 409);
      }
      const signalReview = await handleAgentSignalReview(req, path, { app: rt.app.id, user, now: () => this.clock.now(), scoped: run => rt.scoped(run),
        openCases: ids => rt.readState(n => new Map(n.safetyCases().filter(c => c.status !== "closed" && ids.includes(c.memberId)).map(c => [c.memberId as string, c.id]))),
        ageInDoubt: ids => rt.readState(n => new Set(ids.filter(id => n.ageInDoubt(id as MemberId)))) });
      if (signalReview) return signalReview;
      if (req.method === "GET" && (path === "/staff/relay/held" || path === "/relay/held")) {
        const no = need(["reviewer", "safety"]); if (no) return no;
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_relay_held", mode: "real", ok: true, app: rt.app.id });
        const held = await rt.readState(n => n.relayHeld());
        const selected = (await this.photoRelay.held(rt.app.id)).filter(p=>p.threadId && p.app===rt.app.id);
        return json({ ok: true, network: rt.id, items: [...held.map(h => ({ id: h.itemId, itemId: h.itemId, app: h.app, kind: h.kind, memberId: h.from, from: h.from, reasons: h.reasons, createdAt: h.at, deadline: h.deadline,
          ...(h.text ? { text: h.text } : h.textHidden ? { minor: true } : {}) })), ...selected.map(p => ({ id: p.id, itemId: p.id, app: p.app, kind: "photo", memberId: p.senderMemberId, from: p.senderMemberId, reasons: ["photo:review"], createdAt: p.createdAt, deadline: null }))] });
      }
      const relayPhotoPreview=path.match(/^\/(?:staff\/)?relay\/(pri_[a-zA-Z0-9_-]+)\/photo$/);
      if (req.method==="GET" && relayPhotoPreview) {
        const no=need(["safety"]);if(no)return no;
        await this.audit.write({at:this.clock.now(),actor:user.id,roles:user.roles,action:"read_relay_photo",targetId:relayPhotoPreview[1]!,mode:"real",ok:true,app:rt.app.id,detail:{phase:"requested"}});
        const selected=await this.photoRelay.item(relayPhotoPreview[1]!);
        let media:Awaited<ReturnType<PhotoRelayService["reviewBytes"]>>;
        try {media=selected?.app===rt.app.id?await this.photoRelay.reviewBytes(selected.id,user.id):undefined;}
        catch(error){
          await this.audit.write({at:this.clock.now(),actor:user.id,roles:user.roles,action:"read_relay_photo",targetId:relayPhotoPreview[1]!,mode:"real",ok:false,app:rt.app.id,detail:{phase:"result"}});
          throw error;
        }
        await this.audit.write({at:this.clock.now(),actor:user.id,roles:user.roles,action:"read_relay_photo",targetId:relayPhotoPreview[1]!,mode:"real",ok:!!media,app:rt.app.id,detail:{phase:"result"}});
        const until=selected?Math.min(selected.expiresAt,this.clock.now()+5*60_000):0;
        return media && selected && until>this.clock.now()?new Response(new Uint8Array(media.bytes).buffer,{headers:{"content-type":media.contentType,"cache-control":"no-store","x-content-type-options":"nosniff",
          "x-network-photo-review-token":`${until}.${this.photoReviewProof(selected,user.id,until)}`}}):json({ok:false,reason:"photo_unavailable"},403);
      }
      if (path === "/queue/leak-review" || path.startsWith("/queue/leak-review/")) {
        const no = need(["safety"]); if (no) return no;
        const queue = rt.adapter instanceof BlooioAdapter ? rt.adapter.queue : undefined;
        if (!queue) return json({ ok: false, error: "no_queue" }, 404);
        if (req.method === "GET" && path === "/queue/leak-review") {
          await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_leak_review", mode: "real", ok: true, app: rt.app.id });
          const rows = await queue.parkedLeaks();
          const doubt = await rt.readState(n => new Set(rows.filter(r => r.memberId && n.ageInDoubt(r.memberId as MemberId)).map(r => r.id)));
          return json({ ok: true, network: rt.id, items: rows.map(r => ({ id: r.id, kind: r.kind, ...(r.memberId ? { memberId: r.memberId } : {}), ...(r.to ? { to: maskPhone(r.to) } : {}),
            reasons: r.reasons, createdAt: r.createdAt, ...(doubt.has(r.id) ? { minor: true } : r.text ? { text: r.text } : {}) })) });
        }
        if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        let id: string;
        try { id = decodeURIComponent(path.slice("/queue/leak-review/".length)); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
        const b = (await body(req) ?? {}) as Record<string, any>;
        const note = typeof b.reason === "string" ? b.reason : typeof b.note === "string" ? b.note : undefined;
        if (!id || id.length > 300 || (b.decision !== "release" && b.decision !== "drop") || (note !== undefined && note.length > 2000)) return json({ ok: false, error: "invalid_leak_decision" }, 400);
        if (note === undefined || note.trim().length < 5) return json({ ok: false, reason: "reason_required" }, 409);
        return result(await this.auditedRun({ actor: user.id, roles: user.roles, action: b.decision === "release" ? "leak_release" : "leak_drop", targetId: id, mode: "real", app: rt.app.id, reason: note }, {}, async () => {
          const parked = (await queue.parkedLeaks(1000)).find(r => r.id === id);
          if (!parked) return { ok: false, reason: "not_parked" };
          if (b.decision === "release" && parked.memberId && await rt.readState(n => n.ageInDoubt(parked.memberId as MemberId))) return { ok: false, reason: "minor" };
          const change = await queue.decideLeak(id, b.decision, user.id);
          if (change?.memberId) await rt.storeStatuses([{ id: change.id, status: change.status }]);
          if (change && b.decision === "release") await rt.deliver();
          return change ? { ok: true } : { ok: false, reason: "not_parked" };
        }));
      }
      if (path === "/ops/turns") {
        if (!hasEverywhere(user, "admin")) return json({ ok: false, code: "forbidden", error: "needs role admin@*" }, 403);
        if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_turn_watch", mode: "real", ok: true, app: rt.app.id });
        return json({ ok: true, ...await turnWatchMetrics(this.sql, this.clock.now()) });
      }
      if (path === "/inbound/resolve") {
        if (!hasEverywhere(user, "admin")) return json({ ok: false, code: "forbidden", error: "needs role admin@*" }, 403);
        if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        const b = await body(req) as Record<string, any> | undefined;
        if (typeof b?.id !== "string" || !b.id.startsWith("msg:") || b.id.length > 600) return json({ ok: false, error: "id_required" }, 400);
        const turnId = b.id;
        return result(await this.auditedRun({ actor: user.id, roles: user.roles, action: "resolve_inbound_turn", targetId: turnId, mode: "real", app: rt.app.id }, {},
          async () => (await this.inbox.resolve(turnId)) ? { ok: true } : { ok: false, reason: "not_stuck" }));
      }
      if (req.method === "GET" && path === "/bias") {
        const no = need(["admin", "analyst"]); if (no) return no;
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_bias_reports", mode: "real", ok: true, app: rt.app.id });
        return json({ ok: true, network: rt.id, reports: await this.biasReports(rt) });
      }
      const photoPath = path.match(/^\/members\/([^/]+)\/photos$/);
      if (req.method === "GET" && photoPath) {
        const no = need(["safety"]); if (no) return no;
        let id: string;
        try { id = decodeURIComponent(photoPath[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
        const reason = req.headers.get("x-network-reason")?.trim() ?? "";
        if (reason.length < 5 || reason.length > 500 || id.length > 200) return json({ ok: false, reason: "reason_required" }, 400);
        const r = await this.staffPhotos(user, rt, id, reason);
        return r.ok ? json(r) : json({ ok: false, reason: r.reason }, r.reason === "photos_off" ? 503 : 403);
      }
      // Peon job postings include a read route. The handler enforces the app, method and staff role.
      const postingResponse = await jobPostingRoutes({ rt, user, need, audit: e => this.audit.write(e), now: () => this.clock.now(), log: m => this.log(m) })(req, path);
      if (postingResponse) return postingResponse;
      if (req.method !== "POST") return json({ ok: false, error: "not_found" }, 404);
      const m = path.match(/^\/review\/([^/]+)$/);
      if (m) {
        const no = need(["reviewer"]); if (no) return no;
        let oppId: string;
        try { oppId = decodeURIComponent(m[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
        const b = await body(req);
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        const { decision, reason, note, secondsSpent, explanations, objective, swapOut, revision } = b as Record<string, any>;
        const str = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);
        // spec/reviewDeadline.md, "A decision applies only to the revision the reviewer saw": a staff decision always carries it.
        if (!DECISIONS.has(decision) || !Number.isSafeInteger(revision) || revision < 0 || oppId.length > 200 || !str(reason, 64) || !str(note, 2000) || !str(objective, 500) || !str(swapOut, 200)
          || (secondsSpent !== undefined && typeof secondsSpent !== "number")
          || (explanations !== undefined && (typeof explanations !== "object" || explanations === null || Array.isArray(explanations) || Object.values(explanations).some(v => typeof v !== "string" || v.length > 500)))) {
          return json({ ok: false, error: "invalid_review" }, 400);
        }
        return result(await this.review(user, oppId, decision, { reason, note, secondsSpent, explanations, objective, swapOut, revision }, rt));
      }
      if (path === "/safety/lift" || path === "/safety/close") {
        const no = need(["safety"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        if (b.note !== undefined && (typeof b.note !== "string" || b.note.length > 2000)) return json({ ok: false, error: "invalid_note" }, 400);
        if (path === "/safety/lift") return typeof b.memberId === "string" && b.memberId.length <= 200 ? result(await this.liftHold(user, b.memberId, b.note, rt)) : json({ ok: false, error: "memberId_required" }, 400);
        return typeof b.caseId === "string" && b.caseId.length <= 200 ? result(await this.closeCase(user, b.caseId, b.note, rt)) : json({ ok: false, error: "caseId_required" }, 400);
      }
      if (path === "/safety/clear-minor") {
        const no = need(["safety"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        if (typeof b.note !== "string" || b.note.trim().length < 5 || b.note.length > 2000) return json({ ok: false, error: "note_required" }, 400);
        if (typeof b.memberId !== "string" || !b.memberId || b.memberId.length > 200) return json({ ok: false, error: "memberId_required" }, 400);
        const r = await this.clearMinor(user, rt, b.memberId, b.note);
        return json(r, r.ok ? 200 : 409);
      }
      if (path === "/safety/hold" || path === "/safety/ban" || path === "/safety/dismiss") {
        const no = need(["safety"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        // A decision note of 5 or more characters (docs/admin-console.md 3.7.1).
        if (typeof b.note !== "string" || b.note.trim().length < 5 || b.note.length > 2000) return json({ ok: false, error: "note_required" }, 400);
        if (b.reportId !== undefined && (typeof b.reportId !== "string" || b.reportId.length > 200)) return json({ ok: false, error: "invalid_report" }, 400);
        if (path === "/safety/dismiss") return typeof b.reportId === "string" ? result(await this.dismissReport(user, rt, b.reportId, b.note)) : json({ ok: false, error: "reportId_required" }, 400);
        if (typeof b.memberId !== "string" || !b.memberId || b.memberId.length > 200) return json({ ok: false, error: "memberId_required" }, 400);
        if (path === "/safety/hold") return result(await this.hold(user, rt, b.memberId, b.note, b.reportId));
        if (b.by !== "phone" && b.by !== "person") return json({ ok: false, error: "by_required" }, 400);
        return result(await this.ban(user, rt, b.memberId, b.by, b.note, b.reportId));
      }
      const relayPath = path.match(/^\/(?:staff\/)?relay\/([^/]+)\/(release|reject)$/);
      if (relayPath) {
        // Release or reject a held relay item (safety role for this app); audited either way.
        const no = need(["safety"]); if (no) return no;
        let itemId: string;
        try { itemId = decodeURIComponent(relayPath[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
        const b = (await body(req) ?? {}) as Record<string, any>;
        // A decision note of 5 or more characters, as every other safety decision (the console sends `note`; `reason` is accepted too).
        const note = typeof b.note === "string" ? b.note : typeof b.reason === "string" ? b.reason : undefined;
        if (itemId.length > 200 || (note !== undefined && note.length > 2000)) return json({ ok: false, error: "invalid_relay_decision" }, 400);
        if (note === undefined || note.trim().length < 5) return json({ ok: false, reason: "reason_required", error: "note_required" }, 409);
        const release = relayPath[2] === "release";
        const selected = itemId.startsWith("pri_") ? await this.photoRelay.item(itemId) : undefined;
        if (selected && selected.app !== rt.app.id) return json({ok:false,reason:"not_held"},404);
        let r: {ok:true;delivered?:boolean}|{ok:false;reason:string};
        if(selected)await this.audit.write({at:this.clock.now(),actor:user.id,roles:user.roles,action:release?"relay_release":"relay_reject",targetId:itemId,mode:"real",ok:true,app:rt.app.id,reason:note,detail:{phase:"requested"}});
        try {
        if (selected) {
          if (!release) r = await this.photoRelay.review(itemId,user.id,"unsafe") ? {ok:true} : {ok:false,reason:"not_held"};
          else {
            if (!this.validPhotoReview(selected,user.id,b.photoReviewToken) || !await this.photoRelay.reviewAuthorized(itemId,user.id)) {
              await this.audit.write({at:this.clock.now(),actor:user.id,roles:user.roles,action:"relay_release",targetId:itemId,mode:"real",ok:false,app:rt.app.id,reason:note,detail:{phase:"result",delivered:false,refused:"photo_preview_required"}});
              return json({ok:false,reason:"photo_preview_required"},403);
            }
            if (selected.state === "pending") {
              if (!await this.photoRelay.review(itemId,user.id,"safe")) throw new Error("Photo review refused");
              await this.audit.write({at:this.clock.now(),actor:user.id,roles:user.roles,action:"relay_release",targetId:itemId,mode:"real",ok:true,app:rt.app.id,reason:note,detail:{phase:"reviewed",delivered:false}});
            }
            const photo=await this.photoRelay.approved(itemId);
            if (!photo) r={ok:false,reason:"photo_unavailable"};
            else r=await rt.unitOfWork(async net=>{
              const canonical=await rt.relayParties([photo.senderMemberId,photo.recipientMemberId] as MemberId[]);
              const outcome=await net.relayRequest({itemId,from:photo.senderMemberId as MemberId,kind:"photo",photoIds:[photo.photoId],matchId:photo.threadId},
                {photos:{ids:[photo.photoId],showConsent:true,approved:[photo]},canonical});
              if (outcome.decision !== "sent") return {ok:false as const,reason:outcome.reason};
              rt.unit.completeAction=async tx=>{
                if (!this.validPhotoReview(selected,user.id,b.photoReviewToken) || !await this.photoRelay.reviewAuthorized(itemId,user.id,tx)) throw new Error("Photo review expired or authority changed before commit");
                const claimed=await this.photoRelay.claimForAction(tx,itemId,rt.app.id,photo.threadId,photo.senderMemberId,`photo-selection:${itemId}`);
                if (!claimed || JSON.stringify(claimed)!==JSON.stringify(photo)) throw new Error("Photo selection changed before commit");
              };
              return {ok:true as const,delivered:false}; // Queue handoff is not a provider delivery receipt.
            });
          }
        } else r = await rt.unitOfWork(n => release ? n.releaseRelay(itemId, user.id) : n.rejectRelay(itemId, user.id));
        } catch(error) {
          if(selected)await this.audit.write({at:this.clock.now(),actor:user.id,roles:user.roles,action:release?"relay_release":"relay_reject",targetId:itemId,mode:"real",ok:false,app:rt.app.id,reason:note,detail:{phase:"result",delivered:false,refused:"photo_queue_or_review_failed"}});
          throw error;
        }
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: release ? "relay_release" : "relay_reject", targetId: itemId,
          mode: "real", ok: r.ok, app: rt.app.id, reason: note, ...(selected?{detail:{phase:"result",delivered:false}}:"delivered" in r ? { detail: { delivered: r.delivered } } : {}) });
        return result(r);
      }
      const verifyPath = path.match(/^\/members\/([^/]+)\/verify$/);
      if (verifyPath) {
        const no = need(["safety"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        let id: string;
        try { id = decodeURIComponent(verifyPath[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
        if (!b || (b.check !== "age" && b.check !== "liveness") || (b.result !== "pass" && b.result !== "fail") || typeof b.note !== "string" || b.note.trim().length < 5 || b.note.length > 2000 || id.length > 200) {
          return json({ ok: false, error: "invalid_verify" }, 400);
        }
        return result(await this.verify(user, rt, id, b.check, b.result, b.note));
      }
      if (path === "/invite/seed" && scoped) {
        const no = need(["admin"]); if (no) return no;
        return await this.issueSeedInvitationBatch(req, rt, user);
      }
      if (path === "/invite") {
        // A staff invite to this app (an invite-only app: the person's reply with name and age is the join).
        const no = need(["admin"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        const e164 = normalizePhone(b?.phone);
        if (!e164) return json({ ok: false, error: "phone_required" }, 400);
        return result(await this.invite(user, rt, e164));
      }
      if (path === "/matching") {
        const no = need(["admin"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        if (typeof b?.on !== "boolean") return json({ ok: false, error: "on_required" }, 400);
        return result(await this.setMatching(user, b.on, rt));
      }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (e) {
      this.log(`[http] ${req.method} ${path} failed: ${(e as Error).message}`);
      return json({ ok: false, error: "internal_error" }, 503);
    }
  };

  /** The console's token may name the signed-in staff member (X-Network-Staff-Id); any other token may not. */
  private reviewerOfRecord(req: Request, user: StaffUser): { user: StaffUser; actor: StepActor } { return reviewerOfRecord(req, user, this.consoleToken); }

  /** POST /webhooks/blooio[/:app]: verify the signature on the raw body (the prototype's rules), parse, handle. 401 never retries; 500 asks Blooio to retry. */
  private async webhook(req: Request, secret: string | undefined, app?: AppId): Promise<Response> {
    if (!secret) return json({ ok: false, error: "webhook_secret_missing" }, 503);
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);
    const sig = verifyBlooioSignature(secret, req.headers.get(SIGNATURE_HEADER), raw, Math.floor(this.clock.now() / 1000));
    if (!sig.ok) return json({ ok: false, error: `signature_${sig.reason}` }, 401);
    let ev: ChannelEvent;
    try { ev = parseBlooioWebhook(raw, this.clock.now()); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
    try {
      // A message goes through the inbox (stored first: once per provider id, in order per sender); 200 once it is stored.
      if (ev.kind === "message" && !ev.isGroup) return json({ ok: true, result: await this.inbox.receive(ev, app) });
      return json({ ok: true, result: await this.inbound(ev, app ? { app } : {}) });
    } catch (e) {
      this.log(`[inbound] processing failed: ${(e as Error).message}`);
      return json({ ok: false, error: "processing_failed" }, 500);
    }
  }

  async close(force = false) {
    await Promise.all([
      this.audit.close(force).catch(() => {}),
      this.sql.end(force ? { timeout: 0 } : undefined),
    ]);
  }
}

/**
 * The reviewer of record (critical path item 6; docs/admin-console.md 4.6): the signed-in person the
 * console names in X-Network-Staff-Id, taken only from a request that carries the console's own token
 * (NETWORK_SERVICE_CONSOLE_TOKEN). From any other token the header is ignored and the token is the actor.
 */
export function reviewerOfRecord(req: Request, user: StaffUser, consoleToken: string | undefined): { user: StaffUser; actor: StepActor } {
  const token = { user, actor: "SharedToken" as const };
  const named = req.headers.get("x-network-staff-id")?.trim();
  if (!named || !consoleToken) return token;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const a = Buffer.from(given), b = Buffer.from(consoleToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return token;
  if (named.length > 200 || !/^([^\s@]+@[^\s@]+\.[^\s@]+|token:[a-z_+]+#[0-9a-f]{8})$/i.test(named)) return token;
  return { user: { ...user, id: named }, actor: "NamedReviewer" };
}

/**
 * Review items waiting longer than the app's SLA (slop 6 h, peon 24 h, the others 12 h;
 * observatory apps.ts DEFAULT_SLA_HOURS): one "[alert] review SLA" line per item, once (`seen`).
 */
export function slaAlerts(network: string, queue: readonly { oppId: string; queuedAt: number; deadline: number }[], now: number, hours: number, seen: Set<string>): string[] {
  const out: string[] = [];
  const key = (id: string) => `${network}|${id}`;
  // Items that left the queue are forgotten (the set holds only waiting items).
  for (const k of seen) if (k.startsWith(`${network}|`) && !queue.some(q => key(q.oppId) === k)) seen.delete(k);
  for (const q of queue) {
    // spec/operationsTiming.md, "Open reviews are due at the deadline and near during the previous hour"
    if (seen.has(key(q.oppId)) || !waitExceedsSla(now, q.queuedAt, hours * 3_600_000)) continue;
    seen.add(key(q.oppId));
    out.push(`[alert] review SLA ${network}: item ${q.oppId} waited ${Math.round((now - q.queuedAt) / 60_000)} min (SLA ${hours} h, expires unsent in ${Math.max(0, Math.round((q.deadline - now) / 60_000))} min)`);
  }
  return out;
}

/** Per-app webhook secrets from the environment: <APP>_BLOOIO_WEBHOOK_SECRET. */
export function webhookSecretsFromEnv(env: Env = process.env): Partial<Record<AppId, string>> {
  const out: Partial<Record<AppId, string>> = {};
  for (const a of Object.keys(APPS) as AppId[]) { const s = env[`${a.toUpperCase()}_BLOOIO_WEBHOOK_SECRET`]; if (s) out[a] = s; }
  return out;
}

const json = (data: unknown, status = 200) => Response.json(data, {status,headers:{"cache-control":"no-store"}});
const result = (r: ActionResult) => json(r, r.ok ? 200 : 409);
async function body(req: Request): Promise<unknown> {
  try { const b = await req.json(); return b && typeof b === "object" ? b : undefined; } catch { return undefined; }
}
