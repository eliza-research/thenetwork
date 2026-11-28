// Tier-4 zero-human-intervention hiring, agency booking, creator recruitment,
// outbound outreach gating, and deterministic proof-of-work verification engine (Node 26).
// All outreach, proof approvals, spend authorization, and city labor/flier compliance
// delegate to canonical ./policy.ts, ./constants.ts, and ./cities.ts.

import { RealClock } from "../../../packages/core/src/clock.ts";
import { type LeakGuard } from "../../../packages/core/src/guard.ts";
import { parseOptOut } from "../../../packages/core/src/replies.ts";
import type { BufferedTrajectoryWriter } from "../../../packages/core/src/trajectory/writer.ts";
import {
  spendAuthFromCampaign,
  type PaidAdapterRegistry,
} from "./adapters/paid.ts";
import {
  type SocialAdapterRegistry,
  type SocialPlatform,
} from "./adapters/social.ts";
import {
  resolveMockBaseUrl,
  type MarketingComplianceRuntime,
} from "./compliance-runtime.ts";
import {
  checkCityHiringCompliance,
  getCityConfig,
  matchesCityTransitOrLocality,
} from "./cities.ts";
import {
  ANTI_POSTING_NOTICE,
  buildOpsContractUrl,
  buildOpsProofUploadUrl,
  buildOpsReleaseUrl,
  DEFAULT_DAILY_OUTREACH_CAP,
  FTC_DISCLOSURE_CLAUSE,
  marketingAdultAge,
  marketingLeakAllowlist,
  MTA_EXCLUSION_NOTICE,
  NY_RELEASE_CLAUSE,
  RENTAHUMAN_BUYER_FEE_RATE,
  RENTAHUMAN_MCP_ENDPOINT,
  renderMarketingEmailTemplate,
} from "./constants.ts";
import { detectUnderageText } from "./llm-cache.ts";
import type { NetworkCoreBridge } from "./network-bridge.ts";
import { VETTED_NYC_AGENCIES } from "./nyc-seed.ts";
import {
  createMarketingLeakGuard,
  evaluateContactHygiene,
  evaluateOutreachPolicy,
  evaluateProofPolicy,
  evaluateSpendAuth,
  isAdultReading,
  isGlobalOptOutText,
  isLocalQuietHours,
  keyedContactHash,
  minAgeReading,
  PolicyViolationError,
} from "./policy.ts";
import type { MarketingStore } from "./store.ts";
import type {
  BudgetEntry,
  Campaign,
  Clock,
  HumanPartner,
  ImplementationTier,
  MarketingTask,
  OutreachChannel,
  OutreachMessage,
  ProofKind,
  ProofSubmission,
  TaskKind,
} from "./types.ts";

export type HiringRole =
  | "street_fliering"
  | "event_activation"
  | "creator_video"
  | "agency_booking"
  | "rentahuman_courier";

export interface HiringPacketOptions {
  neighborhood?: string;
  shiftDate?: string;
  shiftHours?: string;
  qrBatchCode?: string;
  shortLink?: string;
  releaseFormUrl?: string;
  contractUrl?: string;
  targetBrand?: string;
  contractorMode?: "1099_direct" | "w2_agency" | "creator_direct";
  boroughLicenceRef?: string | null;
}

export interface HiringPacket {
  role: HiringRole;
  city: string;
  budgetCents: number;
  craigslistPost: {
    category: "evg" | "lbg" | "tlg" | "crg";
    title: string;
    body: string;
    filterToken: string;
    estimatedPostFeeCents: number;
  };
  rentAHumanPayload: {
    endpoint: typeof RENTAHUMAN_MCP_ENDPOINT;
    tool: "create_bounty";
    params: {
      title: string;
      city: string;
      payoutUsd: number;
      buyerFeeUsd: number;
      totalEscrowUsd: number;
      description: string;
      requiredProofs: string[];
    };
  };
  agencyRfpEmail: {
    subject: string;
    body: string;
    targetAgencies: readonly string[];
  };
  creatorBrief: {
    subject: string;
    body: string;
    deliverables: readonly string[];
    ftcClause: string;
    releaseClause: string;
    nyll191dTerms: string;
  };
  compliance: {
    adultAgeFloor: 18;
    ftcDisclosureRequired: true;
    nyCivilRightsReleaseRequired: boolean;
    nyll191dClickwrapIncluded: true;
    localLaborNote: string;
    antiPostingNotice: string;
    mtaExclusionNotice: string;
  };
}

export interface ApplicantScreenInput {
  humanId?: string;
  replyText: string;
  statedAge: number | null;
  city: string;
  filterToken: string;
  hasPriorExperience?: boolean;
  hasIntroClip?: boolean;
}

export interface ApplicantScreenResult {
  passed: boolean;
  optedOut: boolean;
  score: number;
  decision: "auto_hire" | "standby_bench" | "rejected_underage" | "rejected_opt_out" | "rejected_low_score";
  reasons: string[];
}

export interface QueueOutreachInput {
  campaignId: string;
  agentId: string;
  humanId: string;
  channelAccountId?: string | null;
  channel: OutreachChannel;
  tier?: ImplementationTier;
  subject?: string | null;
  bodyText: string;
  dailyOutreachCap?: number;
}

export interface OutreachTransport {
  send(req: {
    message: OutreachMessage;
    human: HumanPartner;
    campaign: Campaign;
  }): Promise<{ ok: boolean; externalRef?: string; error?: string }>;
}

export interface DispatchOutreachResult {
  campaignId: string;
  liveMode: boolean;
  sent: number;
  dryRun: number;
  blockedStop: number;
  blockedPolicy: number;
  failed: number;
  messages: OutreachMessage[];
}

export interface SubmitProofInput {
  taskId: string;
  proofKind: ProofKind;
  evidenceUrl?: string | null;
  checkinMediaHashes?: string[];
  qrScansCount?: number;
  verifiedSignupsCount?: number;
  ftcDisclosed: boolean;
  geoTimeValid: boolean;
  likenessReleaseOk?: boolean;
  shiftDone?: boolean;
  workerAge?: number | null;
  verifierNotes?: string | null;
  authorizePayout?: boolean;
  payoutAdapterId?: string;
  payoutIdempotencyKey?: string;
  slopCashEnvEnabled?: boolean;
}

export interface SubmitProofResult {
  proof: ProofSubmission;
  task: MarketingTask;
  approved: boolean;
  rejectionReason?: string;
  payoutAuthorized: boolean;
  payoutError?: string;
  budgetEntry?: BudgetEntry;
  campaign?: Campaign;
}

export interface CrowdsourcingEngineOptions {
  store: MarketingStore;
  clock?: Clock;
  env?: Record<string, string | undefined>;
  transport?: OutreachTransport;
  paidAdapters?: PaidAdapterRegistry;
  socialAdapters?: SocialAdapterRegistry;
  compliance?: MarketingComplianceRuntime;
  trajectoryWriter?: BufferedTrajectoryWriter;
  leakGuard?: LeakGuard;
  bridge?: NetworkCoreBridge;
}

const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOCIAL_CHANNELS = new Set<string>(["x", "instagram", "tiktok", "reddit", "linkedin", "discord"]);

const NYC_DIRECT_BOOKING_AGENCIES: readonly string[] = VETTED_NYC_AGENCIES.filter(
  (agency) => agency.zeroTouchBookingReadiness !== "low_m1",
)
  .slice(0, 7)
  .map((agency) => `${agency.name} (${agency.contactEmailOrIntake})`);

function formatUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

function splitShiftHours(shiftHours: string): { startTime: string; endTime: string } {
  const withoutDuration = shiftHours.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const rangeMatch = /^(.+?)\s*(?:–|—|-|\bto\b)\s*(.+)$/i.exec(withoutDuration);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    return {
      startTime: rangeMatch[1].trim(),
      endTime: rangeMatch[2].trim(),
    };
  }
  return {
    startTime: withoutDuration || "1:00 PM",
    endTime: "5:00 PM",
  };
}

function defaultContractorMode(role: HiringRole): "1099_direct" | "w2_agency" | "creator_direct" {
  if (role === "agency_booking") return "w2_agency";
  if (role === "creator_video") return "creator_direct";
  return "1099_direct";
}

function isPolicyViolationLike(err: unknown): err is PolicyViolationError {
  return (
    err instanceof PolicyViolationError ||
    (err instanceof Error && err.name === "PolicyViolationError" && "code" in err)
  );
}

export class CrowdsourcingEngine {
  private readonly store: MarketingStore;
  private readonly clock: Clock;
  private readonly env: Record<string, string | undefined>;
  private readonly transport?: OutreachTransport;
  private readonly paidAdapters?: PaidAdapterRegistry;
  private readonly socialAdapters?: SocialAdapterRegistry;
  private readonly compliance?: MarketingComplianceRuntime;
  private readonly trajectoryWriter?: BufferedTrajectoryWriter;
  private readonly leakGuard: LeakGuard;
  private readonly bridge?: NetworkCoreBridge;

  constructor(opts: CrowdsourcingEngineOptions) {
    this.store = opts.store;
    this.clock = opts.clock ?? opts.store.clock ?? new RealClock();
    this.env = opts.env ?? process.env;
    this.transport = opts.transport;
    this.paidAdapters = opts.paidAdapters;
    this.socialAdapters = opts.socialAdapters;
    this.compliance = opts.compliance;
    this.trajectoryWriter = opts.trajectoryWriter;
    this.bridge = opts.bridge;
    this.leakGuard =
      opts.leakGuard ??
      createMarketingLeakGuard(this.env, {
        allow: [...marketingLeakAllowlist([], this.env)],
      });
  }

  buildHiringPacket(
    role: HiringRole | TaskKind,
    city: string,
    budgetCents: number,
    opts: HiringPacketOptions = {},
  ): HiringPacket {
    if (!Number.isSafeInteger(budgetCents) || budgetCents <= 0) {
      throw new PolicyViolationError(
        "INVALID_BUDGET",
        "inv_budget_never_exceeded",
        "Hiring packet budgetCents must be a positive safe integer.",
      );
    }

    const normalizedRole: HiringRole =
      role === "event_activation" ||
      role === "creator_video" ||
      role === "agency_booking" ||
      role === "rentahuman_courier"
        ? role
        : "street_fliering";

    const cityConfig = getCityConfig(city);
    const cityCode = cityConfig.code;
    const cityLabel = cityConfig.label;
    const contractorMode = opts.contractorMode ?? defaultContractorMode(normalizedRole);

    const cityCompliance = checkCityHiringCompliance({
      city: cityCode,
      role: normalizedRole,
      contractorMode,
      boroughLicenceRef: opts.boroughLicenceRef,
    });
    if (!cityCompliance.allowed) {
      throw new PolicyViolationError(
        "CITY_COMPLIANCE_BLOCKED",
        "inv_city_labor_and_flier_law",
        cityCompliance.reasons.join(" "),
      );
    }

    const defaultNeighborhood =
      cityConfig.corridors[0]?.neighborhood ?? "Downtown Core";
    const neighborhood = opts.neighborhood ?? defaultNeighborhood;
    const shiftDate =
      opts.shiftDate ?? new Date(this.clock.now() + 48 * 3_600_000).toISOString().slice(0, 10);
    const shiftHours = opts.shiftHours ?? "1:00 PM – 5:00 PM (4 hours)";
    const qrBatchCode = opts.qrBatchCode ?? `${cityCode.toUpperCase()}-001`;
    const shortLink = opts.shortLink ?? `https://go.ntwrk.party/j/${encodeURIComponent(qrBatchCode)}`;
    const releaseFormUrl = opts.releaseFormUrl ?? buildOpsReleaseUrl(qrBatchCode, this.env);
    const contractUrl = opts.contractUrl ?? buildOpsContractUrl(qrBatchCode, this.env);
    const proofUploadUrl = buildOpsProofUploadUrl(qrBatchCode, this.env);
    const targetBrand =
      opts.targetBrand ?? "The Network (ntwrk.party / slop.date / peon.biz / friends.help)";
    const budgetUsd = formatUsd(budgetCents);

    const filterToken = `${cityCode.toUpperCase()} ${marketingAdultAge}+ CONFIRMED`;
    const localLaborNote = cityConfig.legal.freelanceStatute;
    const antiPostingNotice =
      cityCode === "nyc" ? ANTI_POSTING_NOTICE : cityConfig.legal.antiPostingRule;
    const mtaExclusionNotice =
      cityCode === "nyc" ? MTA_EXCLUSION_NOTICE : cityConfig.legal.transitExclusionRule;

    const nyll191dTerms = [
      `Written Contractor Terms (${cityLabel} — ${cityConfig.legal.freelanceStatute}):`,
      `- Itemized Role: ${normalizedRole} (${neighborhood}, Batch ${qrBatchCode}, Mode=${contractorMode})`,
      `- Guaranteed Base Compensation: $${budgetUsd} ${cityConfig.currency} (fiat via Stripe Connect Express or Tremendous; $0 upfront worker fee)`,
      `- Payment Due Date: Within 48 hours of approved proof-of-work (hard SLA <= ${cityConfig.legal.payoutSlaDays} days)`,
      `- Mandatory Age Floor: Contractor confirms age ${marketingAdultAge}+ with valid payout eligibility.`,
      `- Record Retention: Clickwrap acceptance stored for 6 years (${contractUrl}).`,
    ].join("\n");

    const clCategory: "evg" | "lbg" | "tlg" | "crg" =
      normalizedRole === "creator_video"
        ? "tlg"
        : normalizedRole === "event_activation"
          ? "evg"
          : "lbg";

    const craigslistTitle =
      normalizedRole === "creator_video"
        ? `$${budgetUsd} Flat + Bonus — ${cityLabel} Street-Interview Video Creator (${marketingAdultAge}+, ${neighborhood})`
        : normalizedRole === "event_activation"
          ? `$30/hr + Bonus — ${cityLabel} Live Event Activator (${neighborhood}, ${marketingAdultAge}+)`
          : `$22/hr + Bonus — ${cityLabel} Hand-to-Hand Flier Street Team (${neighborhood}, ${marketingAdultAge}+)`;

    const { startTime, endTime } = splitShiftHours(shiftHours);
    const renderedCl = renderMarketingEmailTemplate("craigslist_gig_post", {
      CITY_LABEL: cityLabel,
      CITY_CODE: cityCode.toUpperCase(),
      NEIGHBORHOOD: neighborhood,
      SHIFT_DATE: shiftDate,
      START_TIME: startTime,
      END_TIME: endTime,
      LANDMARK_AND_NEIGHBORHOOD: `${neighborhood} (${cityLabel})`,
      LOCAL_ANTI_POSTING: antiPostingNotice,
      LOCAL_TRANSIT_RULE: mtaExclusionNotice,
      LOCAL_LABOR_STATUTE: localLaborNote,
    });

    const craigslistBody = [
      renderedCl.body,
      "",
      `ENGAGEMENT OVERRIDES (${cityLabel}):`,
      `- Brand: ${targetBrand}`,
      `- Budget Cap: $${budgetUsd} ${cityConfig.currency} | Serialized QR Batch ${qrBatchCode} (${shortLink})`,
      `- Local Labor & Anti-Posting: ${antiPostingNotice}`,
      `- Local Transit Exclusion: ${mtaExclusionNotice}`,
      `- Statutory Terms: ${localLaborNote}`,
      ...(normalizedRole === "creator_video"
        ? [`- ${FTC_DISCLOSURE_CLAUSE}`, `- ${NY_RELEASE_CLAUSE}`]
        : []),
      `- Required First-Line Filter Token: "${filterToken}"`,
    ].join("\n");

    const rahPayoutCents = Math.max(
      100,
      Math.floor(budgetCents / (1 + RENTAHUMAN_BUYER_FEE_RATE)),
    );
    const rahFeeCents = Math.max(0, budgetCents - rahPayoutCents);
    const rentAHumanPayload: HiringPacket["rentAHumanPayload"] = {
      endpoint: RENTAHUMAN_MCP_ENDPOINT,
      tool: "create_bounty",
      params: {
        title: `${cityLabel} ${normalizedRole.replaceAll("_", " ")} (${neighborhood} — ${qrBatchCode})`,
        city: cityLabel,
        payoutUsd: Number(formatUsd(rahPayoutCents)),
        buyerFeeUsd: Number(formatUsd(rahFeeCents)),
        totalEscrowUsd: Number(formatUsd(rahPayoutCents + rahFeeCents)),
        description: `${craigslistBody}\n\n${nyll191dTerms}`,
        requiredProofs:
          normalizedRole === "creator_video"
            ? [
                "Live public video URL (YouTube/TikTok/IG)",
                "FTC #Ad spoken + on-screen disclosure in first 3 seconds",
                `Signed ${marketingAdultAge}+ commercial likeness releases (${releaseFormUrl})`,
                `Unique batch QR ${qrBatchCode} shown on screen and pinned`,
              ]
            : [
                `3 timestamped GPS check-in photos (Start, Midpoint, End) uploaded via ${proofUploadUrl}`,
                "Remaining flier stack count photo",
                `Active QR Batch ${qrBatchCode} scan verification`,
              ],
      },
    };

    const renderedAgency = renderMarketingEmailTemplate("agency_rfp", {
      CITY_LABEL: cityLabel,
      AGENCY_NAME: `${cityLabel} Staffing Partner`,
      TARGET_DATES: shiftDate,
      HEADCOUNT: "2",
      NEIGHBORHOODS: `${neighborhood} (${cityLabel})`,
      SHIFT_HOURS: shiftHours,
      BUDGET_CAP: budgetUsd,
      LOCAL_ANTI_POSTING: antiPostingNotice,
      LOCAL_TRANSIT_RULE: mtaExclusionNotice,
      LOCAL_LABOR_STATUTE: localLaborNote,
    });
    const targetAgencies =
      cityCode === "nyc"
        ? NYC_DIRECT_BOOKING_AGENCIES
        : cityConfig.vendors.recommendedAgencies;

    const agencyRfpEmail = {
      subject: renderedAgency.subject,
      body: `${renderedAgency.body}\n\nLocal Compliance Notice: ${cityCompliance.requiredNotice}`,
      targetAgencies,
    };

    const creatorDeliverables: readonly string[] = [
      `1 main edited street-interview video (60-90s) published publicly on YouTube/TikTok/IG featuring 3+ verified ${marketingAdultAge}+ interviewees`,
      "2 vertical cutdowns (20-35s) + raw unedited clips uploaded with commercial usage rights",
      `Serialized QR card (${qrBatchCode}) shown on screen + pinned link (${shortLink}) for 30 days`,
      "Mandatory FTC #Ad spoken and on-screen disclosure within first 3 seconds + Paid Partnership toggle",
      `Signed ${marketingAdultAge}+ commercial likeness releases (${releaseFormUrl}) for every recognizable interviewee`,
    ];

    const renderedCreator = renderMarketingEmailTemplate("creator_street_interview_brief", {
      CITY_LABEL: cityLabel,
      CREATOR_NAME: "Creator",
      RECENT_VIDEO_TITLE: `your recent ${cityLabel} street video`,
      NEIGHBORHOOD: neighborhood,
      PRIMARY_PLATFORM: "YouTube Shorts / TikTok / Instagram Reels",
      CREATOR_SHORTLINK: shortLink,
      FLAT_FEE: budgetUsd,
      BONUS_CAP: formatUsd(Math.min(15_000, budgetCents)),
      RELEASE_FORM_URL: releaseFormUrl,
      CREATOR_CONTRACT_URL: contractUrl,
      TARGET_PUBLISH_DATE: shiftDate,
      LOCAL_LABOR_STATUTE: localLaborNote,
    });

    const creatorBrief = {
      subject: renderedCreator.subject,
      body: `${renderedCreator.body}\n\n${nyll191dTerms}`,
      deliverables: creatorDeliverables,
      ftcClause: FTC_DISCLOSURE_CLAUSE,
      releaseClause: NY_RELEASE_CLAUSE,
      nyll191dTerms,
    };

    return {
      role: normalizedRole,
      city: cityCode,
      budgetCents,
      craigslistPost: {
        category: clCategory,
        title: craigslistTitle,
        body: craigslistBody,
        filterToken,
        estimatedPostFeeCents: cityConfig.vendors.craigslistPostFeeCents,
      },
      rentAHumanPayload,
      agencyRfpEmail,
      creatorBrief,
      compliance: {
        adultAgeFloor: marketingAdultAge as 18,
        ftcDisclosureRequired: true,
        nyCivilRightsReleaseRequired: normalizedRole === "creator_video",
        nyll191dClickwrapIncluded: true,
        localLaborNote,
        antiPostingNotice,
        mtaExclusionNotice,
      },
    };
  }

  async screenApplicantReply(input: ApplicantScreenInput): Promise<ApplicantScreenResult> {
    const optOut = parseOptOut(input.replyText);
    const globalStop = isGlobalOptOutText(input.replyText);
    if (optOut.match !== "none" || globalStop) {
      if (input.humanId) {
        const stoppedHuman = await this.store.markHumanStopped(
          input.humanId,
          `applicant_opt_out_${optOut.match !== "none" ? optOut.match : "global_stop"}`,
        );
        await this.store.recordContactSuppression({
          contactHash: stoppedHuman.handleOrEmailHmac,
          reason: "applicant_opt_out",
          sourceChannel: stoppedHuman.channel,
          isMinor: false,
        });
        if (stoppedHuman.contactEmail) {
          const emailHash = keyedContactHash("email", stoppedHuman.contactEmail, this.env);
          if (emailHash && emailHash !== stoppedHuman.handleOrEmailHmac) {
            await this.store.recordContactSuppression({
              contactHash: emailHash,
              reason: "applicant_opt_out",
              sourceChannel: stoppedHuman.channel,
              isMinor: false,
            });
          }
        }
      }
      return {
        passed: false,
        optedOut: true,
        score: 0,
        decision: "rejected_opt_out",
        reasons: ["applicant_opted_out"],
      };
    }

    let persistedHuman: HumanPartner | null = null;
    if (input.humanId) {
      persistedHuman =
        input.statedAge !== null
          ? await this.store.recordHumanAge(input.humanId, input.statedAge)
          : await this.store.getHuman(input.humanId);
    }

    if (this.bridge && persistedHuman) {
      const fence = await this.bridge.checkContactFence({
        email: persistedHuman.contactEmail ?? null,
        phoneHash: persistedHuman.handleOrEmailHmac,
      });
      if (!fence.allowed) {
        if (fence.knownMinor) {
          await this.store.recordContactSuppression({
            contactHash: persistedHuman.handleOrEmailHmac,
            reason: fence.reason ?? "platform_known_minor",
            sourceChannel: persistedHuman.channel,
            isMinor: true,
          });
          return {
            passed: false,
            optedOut: false,
            score: 0,
            decision: "rejected_underage",
            reasons: ["worker_must_be_18_plus"],
          };
        }
        await this.store.markHumanStopped(persistedHuman.id, fence.reason ?? "platform_fence_blocked");
        return {
          passed: false,
          optedOut: true,
          score: 0,
          decision: "rejected_opt_out",
          reasons: [fence.reason ?? "platform_fence_blocked"],
        };
      }
    }

    const detectedUnderage = detectUnderageText(input.replyText);
    const effectiveAge = minAgeReading(
      input.statedAge,
      persistedHuman?.lowestAge,
      detectedUnderage.statedAge,
    );
    if (detectedUnderage.isMinor || !isAdultReading(effectiveAge)) {
      if (
        persistedHuman &&
        (detectedUnderage.isMinor || (effectiveAge !== null && effectiveAge < marketingAdultAge))
      ) {
        await this.store.recordContactSuppression({
          contactHash: persistedHuman.handleOrEmailHmac,
          reason: detectedUnderage.reason ?? "underage_applicant",
          sourceChannel: persistedHuman.channel,
          isMinor: true,
        });
      }
      return {
        passed: false,
        optedOut: false,
        score: 0,
        decision: "rejected_underage",
        reasons: ["worker_must_be_18_plus"],
      };
    }

    const lower = input.replyText.toLowerCase();
    const reasons: string[] = [];
    let score = 0;

    if (
      lower.includes(input.filterToken.toLowerCase()) ||
      /(?:^|\W)18\+(?:\W|$)/.test(lower)
    ) {
      score += 25;
    } else {
      reasons.push("missing_filter_token");
    }

    if (matchesCityTransitOrLocality(input.city, input.replyText)) {
      score += 25;
    } else {
      reasons.push("missing_local_transit_confirmation");
    }

    if (
      input.hasPriorExperience ||
      /\b(promo|street team|ambassador|hospitality|sales|filming|youtube|tiktok|interview|events?)\b/i.test(
        lower,
      )
    ) {
      score += 25;
    } else {
      reasons.push("missing_relevant_experience");
    }

    if (input.hasIntroClip || /\b(https?:\/\/|clip|reel|portfolio|video)\b/i.test(lower)) {
      score += 25;
    } else {
      reasons.push("missing_intro_clip");
    }

    if (score >= 75) {
      return { passed: true, optedOut: false, score, decision: "auto_hire", reasons };
    }
    if (score >= 50) {
      return { passed: true, optedOut: false, score, decision: "standby_bench", reasons };
    }
    return { passed: false, optedOut: false, score, decision: "rejected_low_score", reasons };
  }

  private async checkContactGate(
    human: HumanPartner,
    campaign: Campaign,
    isCold: boolean,
  ): Promise<{
    allowed: boolean;
    blockedStatus?: "blocked_stop" | "blocked_policy";
    reason?: string;
    contactHash: string;
  }> {
    const contactHash = human.handleOrEmailHmac;
    const emailHash = human.contactEmail
      ? keyedContactHash("email", human.contactEmail, this.env)
      : null;

    const suppression =
      (await this.store.isContactSuppressed(contactHash)) ??
      (emailHash ? await this.store.isContactSuppressed(emailHash) : null);
    const runtimeSuppressed =
      this.compliance && human.contactEmail
        ? this.compliance.suppression.check({
            kind: "email",
            value: human.contactEmail,
            scope: "marketing",
          })
        : null;
    const isRuntimeSuppressed = Boolean(runtimeSuppressed?.suppressed && !runtimeSuppressed.failClosed);

    let bridgeBanned = false;
    let bridgeStopped = false;
    let bridgeMinor = false;
    let bridgeReason: string | undefined;
    if (this.bridge) {
      const verdict = await this.bridge.checkContactFence({
        email: human.contactEmail ?? null,
        phoneHash: contactHash,
      });
      if (!verdict.allowed) {
        bridgeBanned = verdict.banned || verdict.recycledHold || (!verdict.globallyStopped && !verdict.knownMinor);
        bridgeStopped = verdict.globallyStopped;
        bridgeMinor = verdict.knownMinor;
        bridgeReason = verdict.reason;
      }
    }

    const isKnownMinor =
      (human.lowestAge !== null && human.lowestAge < marketingAdultAge) ||
      Boolean(suppression?.isMinor) ||
      Boolean(runtimeSuppressed?.record?.isMinor) ||
      bridgeMinor;
    const isStopped =
      human.stopped ||
      bridgeStopped ||
      isRuntimeSuppressed ||
      Boolean(suppression && suppression.reason.includes("stop"));
    const isBanned =
      human.banned ||
      bridgeBanned ||
      Boolean(suppression && !suppression.isMinor && !suppression.reason.includes("stop"));

    const stats = await this.store.getContactTouchpointStats(contactHash, this.clock.now());
    const hygiene = evaluateContactHygiene({
      isStopped,
      isBanned,
      isKnownMinor,
      lockdown: campaign.riskDial === "lockdown",
      isCold,
      isQuietHours: isLocalQuietHours(campaign.city, this.clock.now()),
      daysSinceCold: stats.daysSinceLastCold,
      coldTouches30d: stats.coldTouches30d,
      unansweredCold: stats.unansweredColdStreak,
      opTouchesToday: stats.opTouchesToday,
    });

    if (!hygiene.allowed) {
      return {
        allowed: false,
        blockedStatus: isStopped ? "blocked_stop" : "blocked_policy",
        reason: bridgeReason ?? hygiene.reason,
        contactHash,
      };
    }

    return { allowed: true, contactHash };
  }

  async queueOutreach(input: QueueOutreachInput): Promise<OutreachMessage> {
    const leaks = this.leakGuard.check(input.bodyText);
    const [campaign, human] = await Promise.all([
      this.store.getCampaign(input.campaignId),
      this.store.getHuman(input.humanId),
    ]);
    if (campaign && human) {
      const isCold =
        ((input.tier ?? 1) === 1 || input.channel === "email") &&
        human.role !== "street_worker" &&
        human.role !== "creator";
      const gate = await this.checkContactGate(human, campaign, isCold);
      if (!gate.allowed) {
        return this.store.createOutreachMessage({
          campaignId: input.campaignId,
          agentId: input.agentId,
          humanId: input.humanId,
          channelAccountId: input.channelAccountId ?? null,
          channel: input.channel,
          tier: input.tier ?? 1,
          subject: input.subject ?? null,
          bodySummary: input.bodyText,
          leakCheckPass: leaks.length === 0,
          desiredStatus: gate.blockedStatus ?? "blocked_policy",
          dailyOutreachCap: input.dailyOutreachCap,
        });
      }
    }
    return this.store.createOutreachMessage({
      campaignId: input.campaignId,
      agentId: input.agentId,
      humanId: input.humanId,
      channelAccountId: input.channelAccountId ?? null,
      channel: input.channel,
      tier: input.tier ?? 1,
      subject: input.subject ?? null,
      bodySummary: input.bodyText,
      leakCheckPass: leaks.length === 0,
      desiredStatus: "queued",
      dailyOutreachCap: input.dailyOutreachCap,
    });
  }

  async dispatchPendingOutreach(
    campaignId: string,
    opts: { dailyOutreachCap?: number; dryRun?: boolean } = {},
  ): Promise<DispatchOutreachResult> {
    const campaign = await this.store.getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

    const queued = await this.store.listOutreachMessages({ campaignId, status: "queued" });
    const mockHttpActive = resolveMockBaseUrl(this.env) !== null;
    const hasLiveChannel =
      Boolean(this.transport) ||
      Boolean(this.paidAdapters?.isLiveBillingEnabled()) ||
      Boolean(this.socialAdapters && mockHttpActive);
    const liveMode =
      !opts.dryRun && (mockHttpActive || (hasLiveChannel && this.env.MARKETING_LIVE_SEND === "1"));
    const dailyCap = opts.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP;

    let sent = 0;
    let dryRun = 0;
    let blockedStop = 0;
    let blockedPolicy = 0;
    let failed = 0;
    const processed: OutreachMessage[] = [];

    for (const msg of queued) {
      const human = await this.store.getHuman(msg.humanId);
      if (!human) {
        const updated = await this.store.updateOutreachStatus(msg.id, "failed");
        failed += 1;
        processed.push(updated);
        continue;
      }

      const isCold =
        (msg.tier === 1 || msg.channel === "email") &&
        human.role !== "street_worker" &&
        human.role !== "creator";
      const contactGate = await this.checkContactGate(human, campaign, isCold);
      if (!contactGate.allowed) {
        const blockedStatus = contactGate.blockedStatus ?? "blocked_policy";
        const updated = await this.store.updateOutreachStatus(msg.id, blockedStatus);
        if (blockedStatus === "blocked_stop") blockedStop += 1;
        else blockedPolicy += 1;
        processed.push(updated);
        continue;
      }

      const policyDecision = evaluateOutreachPolicy({
        human,
        lockdown: campaign.riskDial === "lockdown",
        leakCheckPass: msg.leakCheckPass,
        dailyOutreachCap: dailyCap,
      });

      if (!policyDecision.allowed) {
        const blockedStatus = policyDecision.blockedStatus ?? "blocked_policy";
        const updated = await this.store.updateOutreachStatus(msg.id, blockedStatus);
        if (blockedStatus === "blocked_stop") blockedStop += 1;
        else blockedPolicy += 1;
        processed.push(updated);
        continue;
      }

      if (!liveMode) {
        const updated = await this.store.updateOutreachStatus(
          msg.id,
          "sent",
          `dry-run:${msg.id}`,
        );
        await this.store.recordContactTouchpoint({
          contactHash: contactGate.contactHash,
          campaignId: campaign.id,
          surface: "outreach",
          isCold,
          answered: false,
        });
        dryRun += 1;
        processed.push(updated);
        continue;
      }

      try {
        if (this.transport) {
          const res = await this.transport.send({ message: msg, human, campaign });
          if (res.ok) {
            const updated = await this.store.updateOutreachStatus(
              msg.id,
              "sent",
              res.externalRef ?? `live:${msg.id}`,
            );
            await this.store.recordContactTouchpoint({
              contactHash: contactGate.contactHash,
              campaignId: campaign.id,
              surface: "outreach",
              isCold,
              answered: false,
            });
            sent += 1;
            processed.push(updated);
          } else {
            const updated = await this.store.updateOutreachStatus(msg.id, "failed");
            failed += 1;
            processed.push(updated);
          }
          continue;
        }

        if (this.paidAdapters && msg.channel === "email") {
          const recipientEmail = human.contactEmail?.trim() ?? "";
          if (!VALID_EMAIL_RE.test(recipientEmail)) {
            const updated = await this.store.updateOutreachStatus(
              msg.id,
              "failed",
              "error:missing_or_invalid_contact_email",
            );
            failed += 1;
            processed.push(updated);
            continue;
          }
          const envelope = this.compliance?.buildCanSpamEmailEnvelope(
            human.contactEmail ?? human.handleOrEmailHmac,
            "email",
          );
          const finalText = envelope
            ? `${msg.bodySummary}\n\n${envelope.footerText}`
            : msg.bodySummary;
          if (this.compliance) {
            const lint = this.compliance.lintCopy({
              channel: "email",
              text: finalText,
              subject: msg.subject ?? `The Network ${campaign.city.toUpperCase()} Opportunity`,
              isCommercial: true,
              isAiGenerated: true,
              headers: envelope?.headers,
            });
            const entropy = this.compliance.checkTemplateEntropy(
              `campaign:${campaign.id}:email`,
              msg.bodySummary,
            );
            if (!lint.ok || !entropy.ok) {
              const updated = await this.store.updateOutreachStatus(
                msg.id,
                "blocked_policy",
                `blocked:${!lint.ok ? lint.violations.join(",") : entropy.reason ?? "entropy"}`,
              );
              blockedPolicy += 1;
              processed.push(updated);
              continue;
            }
          }
          const receipt = await this.paidAdapters.execute(
            "email",
            {
              to: recipientEmail,
              subject: msg.subject ?? `Quick note for ${campaign.city.toUpperCase()}`,
              text: finalText,
              ...(envelope ? { headers: envelope.headers } : {}),
            },
            {
              spend: spendAuthFromCampaign(campaign, 1, {
                tier: msg.tier === 4 ? 4 : 3,
                useSlopCash: false,
                env: this.env,
              }),
              idempotencyKey: `outreach:${msg.id}`,
              campaignId: campaign.id,
              targetStopped: human.stopped,
            },
          );
          if (receipt.ok) {
            const updated = await this.store.updateOutreachStatus(
              msg.id,
              "sent",
              receipt.externalRef ?? `adapter:${msg.id}`,
            );
            await this.store.recordContactTouchpoint({
              contactHash: contactGate.contactHash,
              campaignId: campaign.id,
              surface: "outreach",
              isCold,
              answered: false,
            });
            if (receipt.mode === "live") sent += 1;
            else dryRun += 1;
            processed.push(updated);
          } else {
            const updated = await this.store.updateOutreachStatus(msg.id, "failed");
            failed += 1;
            processed.push(updated);
          }
          continue;
        }

        if (this.socialAdapters && SOCIAL_CHANNELS.has(msg.channel)) {
          if (this.compliance) {
            const entropy = this.compliance.checkTemplateEntropy(
              `campaign:${campaign.id}:${msg.channel}`,
              msg.bodySummary,
            );
            if (!entropy.ok) {
              const updated = await this.store.updateOutreachStatus(
                msg.id,
                "blocked_policy",
                `blocked:${entropy.reason ?? "entropy"}`,
              );
              blockedPolicy += 1;
              processed.push(updated);
              continue;
            }
          }
          const socialRes = await this.socialAdapters.dispatch({
            platform: msg.channel as SocialPlatform,
            text: msg.bodySummary,
            title: msg.subject ?? undefined,
            campaignId: campaign.id,
            recipientHandle: human.displayLabel,
            isDm: true,
            hasRecordedConsent: !isCold,
            idempotencyKey: `outreach:${msg.id}`,
          });
          if (socialRes.ok) {
            const updated = await this.store.updateOutreachStatus(
              msg.id,
              "sent",
              socialRes.externalRef ?? `social:${msg.channel}:${msg.id}`,
            );
            await this.store.recordContactTouchpoint({
              contactHash: contactGate.contactHash,
              campaignId: campaign.id,
              surface: "outreach",
              isCold,
              answered: false,
            });
            if (socialRes.mode === "dry_run") dryRun += 1;
            else sent += 1;
            processed.push(updated);
          } else {
            const nextStatus = socialRes.mode === "blocked_policy" ? "blocked_policy" : "failed";
            const updated = await this.store.updateOutreachStatus(msg.id, nextStatus);
            if (nextStatus === "blocked_policy") blockedPolicy += 1;
            else failed += 1;
            processed.push(updated);
          }
          continue;
        }

        const updated = await this.store.updateOutreachStatus(
          msg.id,
          "sent",
          `dry-run:${msg.id}`,
        );
        await this.store.recordContactTouchpoint({
          contactHash: contactGate.contactHash,
          campaignId: campaign.id,
          surface: "outreach",
          isCold,
          answered: false,
        });
        dryRun += 1;
        processed.push(updated);
      } catch {
        const updated = await this.store.updateOutreachStatus(msg.id, "failed");
        failed += 1;
        processed.push(updated);
      }
    }

    return {
      campaignId,
      liveMode,
      sent,
      dryRun,
      blockedStop,
      blockedPolicy,
      failed,
      messages: processed,
    };
  }

  async submitAndEvaluateProof(input: SubmitProofInput): Promise<SubmitProofResult> {
    const task = await this.store.getTask(input.taskId);
    if (!task) throw new Error(`Task not found: ${input.taskId}`);
    const campaign = await this.store.getCampaign(task.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${task.campaignId}`);
    const human = task.assigneeHumanId ? await this.store.getHuman(task.assigneeHumanId) : null;

    const workerAge =
      minAgeReading(input.workerAge, task.assigneeAgeYears, human?.lowestAge) ?? -1;
    const workerBanned = human?.banned ?? false;

    const evidenceUrl = input.evidenceUrl?.trim() || null;
    const hasEvidenceUrl = Boolean(evidenceUrl && /^https?:\/\//i.test(evidenceUrl));
    const mediaHashes = (input.checkinMediaHashes ?? []).map((h) => h.trim()).filter(Boolean);

    let duplicateMediaHash: string | null = null;
    for (const hash of mediaHashes) {
      if (await this.store.hasMediaHash(hash, task.id)) {
        duplicateMediaHash = hash;
        break;
      }
    }

    const verifiedSignupsOrShiftDone = Boolean(
      input.shiftDone ||
        (input.verifiedSignupsCount ?? 0) > 0 ||
        (input.qrScansCount ?? 0) > 0 ||
        mediaHashes.length >= 2,
    );

    const proof = await this.store.createProof({
      taskId: task.id,
      proofKind: input.proofKind,
      evidenceUrl: hasEvidenceUrl ? evidenceUrl : null,
      checkinMediaHashes: mediaHashes,
      qrScansCount: input.qrScansCount ?? 0,
      verifiedSignupsCount: input.verifiedSignupsCount ?? 0,
      ftcDisclosed: input.ftcDisclosed,
      geoTimeValid: input.geoTimeValid,
      likenessReleaseOk:
        input.proofKind === "creator_video" ? Boolean(input.likenessReleaseOk) : true,
      verifierNotes: duplicateMediaHash
        ? `duplicate_media_hash:${duplicateMediaHash}`
        : (input.verifierNotes ?? null),
    });

    if (duplicateMediaHash) {
      const rejectedEval = await this.store.evaluateProof(proof.id, {
        workerAge: -1,
        workerBanned: true,
        shiftDone: false,
        verifierNotes: `duplicate_media_hash:${duplicateMediaHash}`,
      });
      return {
        proof: rejectedEval.proof,
        task: rejectedEval.task,
        approved: false,
        rejectionReason: "duplicate_media_hash",
        payoutAuthorized: false,
      };
    }

    const preApproveDecision = evaluateProofPolicy({
      proof,
      workerAge,
      workerBanned,
      shiftDone: verifiedSignupsOrShiftDone,
      requireHttpEvidenceUrl: true,
    });

    const evaluation = await this.store.evaluateProof(proof.id, {
      workerAge,
      workerBanned,
      shiftDone: verifiedSignupsOrShiftDone,
      verifierNotes: input.verifierNotes ?? undefined,
    });

    const approved = preApproveDecision.approved && evaluation.approved;
    if (!approved) {
      return {
        proof: evaluation.proof,
        task: evaluation.task,
        approved: false,
        rejectionReason: preApproveDecision.reason ?? evaluation.reason ?? "proof_rejected",
        payoutAuthorized: false,
      };
    }

    if (input.authorizePayout === false || evaluation.task.amountCents <= 0) {
      return {
        proof: evaluation.proof,
        task: evaluation.task,
        approved: true,
        payoutAuthorized: false,
      };
    }

    const slopCashEnvEnabled =
      input.slopCashEnvEnabled ?? this.env.MARKETING_SLOP_CASH_ENABLED === "1";
    const useSlopCash = evaluation.task.payoutRail === "slop_cash";

    const spendDecision = evaluateSpendAuth({
      campaign,
      tier: evaluation.task.tier,
      amountCents: evaluation.task.amountCents,
      useSlopCash,
      slopCashEnvEnabled,
      taskKind: evaluation.task.taskKind,
    });
    if (!spendDecision.allowed) {
      const payoutError =
        spendDecision.code === "SLOP_CASH_DISABLED" || spendDecision.code === "SLOP_CASH_OSS_ONLY"
          ? `${spendDecision.code}: ${spendDecision.reason ?? "slop.cash settlement is disabled."}`
          : `SPEND_NOT_AUTHORIZED (${spendDecision.code ?? "POLICY_BLOCKED"}): ${spendDecision.reason ?? "payout rejected by proved marketingPolicy."}`;
      return {
        proof: evaluation.proof,
        task: evaluation.task,
        approved: true,
        payoutAuthorized: false,
        payoutError,
      };
    }

    const idempotencyKey =
      input.payoutIdempotencyKey ?? `payout:${evaluation.task.id}:${evaluation.proof.id}`;
    const adapterId =
      input.payoutAdapterId ??
      (useSlopCash
        ? "slop_cash"
        : evaluation.task.payoutRail === "fiat_tremendous"
          ? "payout_tremendous"
          : "payout_stripe");

    let externalRef: string | null = null;
    if (
      this.paidAdapters &&
      !useSlopCash &&
      this.paidAdapters.isLiveBillingEnabled() &&
      this.env.MARKETING_LIVE_BILLING === "1"
    ) {
      const payoutRail =
        evaluation.task.payoutRail === "fiat_tremendous" ? "tremendous" : "stripe_connect";
      const receipt = await this.paidAdapters.execute(
        "payouts",
        {
          recipientId: evaluation.task.assigneeHumanId ?? evaluation.task.id,
          recipientName: human?.displayLabel ?? "Verified Contractor",
          amountCents: evaluation.task.amountCents,
          memo: `Verified proof payout for ${evaluation.task.title}`,
          rail: payoutRail,
        },
        {
          spend: spendAuthFromCampaign(campaign, evaluation.task.amountCents, {
            tier: evaluation.task.tier === 4 ? 4 : 3,
            useSlopCash: false,
            env: this.env,
          }),
          idempotencyKey,
        },
      );
      if (!receipt.ok) {
        return {
          proof: evaluation.proof,
          task: evaluation.task,
          approved: true,
          payoutAuthorized: false,
          payoutError: `PAYOUT_ADAPTER_FAILED: ${receipt.reason}`,
        };
      }
      externalRef = receipt.externalRef;
    }

    try {
      const paid = await this.store.markTaskPaid(evaluation.task.id, {
        adapterId,
        idempotencyKey,
        externalRef,
        slopCashEnvEnabled,
      });
      return {
        proof: evaluation.proof,
        task: paid.task,
        approved: true,
        payoutAuthorized: true,
        budgetEntry: paid.entry,
        campaign: paid.campaign,
      };
    } catch (err) {
      const msg = isPolicyViolationLike(err)
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
      return {
        proof: evaluation.proof,
        task: evaluation.task,
        approved: true,
        payoutAuthorized: false,
        payoutError: msg,
      };
    }
  }
}
