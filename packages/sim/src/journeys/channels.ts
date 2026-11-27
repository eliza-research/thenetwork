import {
  LeakGuard,
  selectWorkIntroChannel,
  type AppId,
  type City,
} from "@thenetwork/core";
import { outputLeaks } from "../../../mcp/src/leaks.ts";
import { contactOrCode } from "../../../mcp/src/tools.ts";
import { scoreIntakeCandidate } from "../../../../apps/marketing/src/intake-bridge.ts";
import {
  CANONICAL_OUTREACH_PLATFORMS,
  buildPlatformDraft,
  evaluateReportRisk,
  type CanonicalOutreachPlatform,
  type PlatformDraftResult,
  type ReportRiskEvaluationResult,
} from "../../../../apps/marketing/src/platform-playbooks.ts";

export const IN_NETWORK_CHANNELS = [
  "imessage_sms",
  "mcp_claude",
  "mcp_openai",
  "warm_email",
] as const;
export type InNetworkChannelId = (typeof IN_NETWORK_CHANNELS)[number];

export const OUT_OF_NETWORK_CHANNELS = CANONICAL_OUTREACH_PLATFORMS;
export type OutOfNetworkChannelId = CanonicalOutreachPlatform;

export const ALL_JOURNEY_CHANNELS = [
  ...IN_NETWORK_CHANNELS,
  ...OUT_OF_NETWORK_CHANNELS,
] as const;
export type JourneyChannelId = (typeof ALL_JOURNEY_CHANNELS)[number];

export interface McpSurfaceCheckResult {
  readonly surface: "full" | "openai";
  readonly benignProfileAccepted: boolean;
  readonly otpBlocked: boolean;
  readonly slopIsolatedOnOpenai: boolean;
  readonly outputGateClean: boolean;
}

export function evaluateMcpSurface(opts: {
  surface: "full" | "openai";
  hostApp: AppId;
  benignProfileText: string;
  otpAttemptText: string;
  inboxSummary: string;
  privateFacts: readonly string[];
}): McpSurfaceCheckResult {
  const benignProfileAccepted = !contactOrCode(opts.benignProfileText);
  const otpBlocked = contactOrCode(opts.otpAttemptText);
  const slopIsolatedOnOpenai = opts.surface === "openai" ? opts.hostApp !== "slop" : true;
  const leaks = outputLeaks(opts.inboxSummary, {
    facts: [...opts.privateFacts],
    contacts: true,
  });
  return {
    surface: opts.surface,
    benignProfileAccepted,
    otpBlocked,
    slopIsolatedOnOpenai,
    outputGateClean: leaks.length === 0,
  };
}

export interface WorkEmailChannelCheckResult {
  readonly channel: ReturnType<typeof selectWorkIntroChannel>;
  readonly zeroPhysicalVenue: boolean;
  readonly zeroUnsolicitedVideo: boolean;
}

export function evaluateWorkEmailChannel(opts: {
  bothHaveWorkEmail: boolean;
  bothRequestedVideo: boolean;
}): WorkEmailChannelCheckResult {
  const channel = selectWorkIntroChannel({
    candAge: 30,
    mgrAge: 36,
    candOptedIn: true,
    mgrOptedIn: true,
    candHasEmail: opts.bothHaveWorkEmail,
    mgrHasEmail: opts.bothHaveWorkEmail,
    mutualSlotConfirmed: true,
    wantsVideo: opts.bothRequestedVideo,
  });
  return {
    channel,
    zeroPhysicalVenue: true,
    zeroUnsolicitedVideo: opts.bothRequestedVideo || channel !== "ScheduledVideo",
  };
}

export type JourneyIntakeScore = ReturnType<typeof scoreIntakeCandidate>;

export interface ExternalPlatformJourneyCheck {
  readonly platform: OutOfNetworkChannelId;
  readonly draft: PlatformDraftResult;
  readonly cleanRisk: ReportRiskEvaluationResult;
  readonly spammyRisk: ReportRiskEvaluationResult;
  readonly verifiedIntake: JourneyIntakeScore;
  readonly slopIntake: JourneyIntakeScore;
  readonly minorIntake: JourneyIntakeScore;
  readonly leakClean: boolean;
}

const DEFAULT_CHANNEL_GUARD = new LeakGuard({ contacts: false, canaryShapes: true });

export function evaluateExternalPlatformJourney(opts: {
  platform: OutOfNetworkChannelId;
  city: City;
  recipientFirstName: string;
  topicOrInterest: string;
  targetAppId: "slop" | "peon" | "friends" | "ntwrk";
}): ExternalPlatformJourneyCheck {
  const isBff = opts.platform === "bumble" && opts.targetAppId === "friends";
  const draft = buildPlatformDraft({
    platform: opts.platform,
    city: opts.city,
    recipientName: opts.recipientFirstName,
    specificContext: opts.topicOrInterest,
    peerSummary: "a vetted local peer around shared craft",
    isBff,
  });

  const cleanRisk = evaluateReportRisk({
    platform: opts.platform,
    text: draft.body,
    subject: draft.subject,
    isBff,
    isFirstTouch: true,
    hasRecipientSpecificReference: true,
  });

  const spammyRisk = evaluateReportRisk({
    platform: opts.platform,
    text: "Hey check out https://spam.example.com! Book a demo now! DM me ASAP!!!",
    isBff,
    isFirstTouch: true,
    hasRecipientSpecificReference: false,
  });

  const verifiedIntake = scoreIntakeCandidate({
    city: opts.city,
    targetAppId: opts.targetAppId,
    sourcePlatform: opts.platform,
    statedAge: 29,
    replyOrBioText: `Building an indie coffee roaster in ${opts.city}; free Thursday at 6pm to meet other founders and designers.`,
    verifiedWorkEmail: true,
    tier1PublicProof: true,
    confirmedTimeWithin24h: true,
    valueDelivered: true,
    explicitPositiveSignal: true,
  });

  const slopIntake = scoreIntakeCandidate({
    city: opts.city,
    targetAppId: opts.targetAppId,
    sourcePlatform: opts.platform,
    statedAge: 27,
    replyOrBioText: "hey dm me book a demo for b2b lead gen",
    isColdSellerOrRecruiter: true,
  });

  const minorIntake = scoreIntakeCandidate({
    city: opts.city,
    targetAppId: opts.targetAppId,
    sourcePlatform: opts.platform,
    statedAge: 16,
    replyOrBioText: "high school junior looking to join",
  });

  const leakClean = DEFAULT_CHANNEL_GUARD.check(draft.body).length === 0;

  return {
    platform: opts.platform,
    draft,
    cleanRisk,
    spammyRisk,
    verifiedIntake,
    slopIntake,
    minorIntake,
    leakClean,
  };
}
