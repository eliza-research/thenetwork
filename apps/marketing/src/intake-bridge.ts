// Out-of-Network -> In-Network Quality Intake Bridge for @thenetwork/marketing (Node 26).
//
// Screens out slop, low-effort replies, prompt injection, cold sellers, and minors using a
// deterministic 4x25 rubric, then promotes only verified 18+ high-signal candidates (>= 70)
// AFTER concrete value has been delivered and an explicit positive signal received — once only,
// with strict slop != peon air-gap, contact_fence, suppression, queue-pressure throttling, and
// LeakGuard enforcement.

import { createHash } from "node:crypto";
import { RealClock } from "../../../packages/core/src/clock.ts";
import {
  detectExternalPromptInjection,
  parseAdult18PlusAnswer,
  scrubPartifulTelecomCopy,
} from "../../../packages/core/src/externalEvents.ts";
import { isAppAllowedToReadExternalProspects } from "../../../packages/core/src/externalMatchmaker.ts";
import type { LeakGuard } from "../../../packages/core/src/guard.ts";
import { parseOptOut } from "../../../packages/core/src/replies.ts";
import { BRAND_DOMAINS, marketingLeakAllowlist } from "./constants.ts";
import type { NetworkCoreBridge } from "./network-bridge.ts";
import {
  createMarketingLeakGuard,
  evaluateOutOfNetworkPromotion,
  isGlobalOptOutText,
  keyedContactHash,
  MIN_INTAKE_QUALITY_SCORE,
} from "./policy.ts";
import type { MarketingStore } from "./store.ts";
import type {
  BrandAppId,
  CanonicalOutreachPlatform,
  Clock,
  DesireLaneId,
  IntakeCandidateRecord,
  IntakeCandidateStatus,
  IntakeScoreBreakdown,
} from "./types.ts";

const DATING_SOURCE_PLATFORMS: ReadonlySet<string> = new Set(["tinder", "bumble", "hinge"]);

const MINOR_CUE_RE =
  /\b(high\s*school(?:er)?s?|middle\s*school|under\s*18|1[0-7]\s*(?:y\/?o|yr|year[\s-]old)|teenager|minor|prom\s+date)\b/i;

const GENERIC_SLOP_RE =
  /^(?:hey+|hi+|yo+|sup|hello|interested|dm\s*me|tell\s*me\s*more|info|details|sure|ok+|k+|yes+|yeah|sounds\s+good|lol|bet|down)[.!?\s]*$/i;

const AI_SLOP_PHRASES_RE =
  /\b(delve\s+into|rich\s+tapestry|synerg(?:y|ize)|game[\s-]changer|unlock\s+your\s+potential|circle\s+back\s+on\s+synergies|revolutionary\s+paradigm)\b/i;

const COLD_SELLER_RE =
  /\b(book\s+a\s+demo|schedule\s+a\s+15[\s-]min|b2b\s+lead\s+gen|buy\s+followers|crypto\s+signals|forex|onlyfans|link\s+in\s+bio\s+promo|hire\s+our\s+agency)\b/i;

const SPECIFICITY_SIGNAL_RE =
  /\b(building|shipping|working\s+on|founded|research|engineer|designer|chef|artist|marathon|running|coffee|dinner|gallery|concert|book|neighborhood|brooklyn|manhattan|soho|williamsburg|mission|shoreditch|austin|east\s+side|west\s+village)\b/i;

const RELIABILITY_SIGNAL_RE =
  /\b(tuesday|wednesday|thursday|friday|saturday|sunday|monday|this\s+week|next\s+week|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|confirmed|see\s+you|count\s+me\s+in)\b/i;

export interface IntakeScoreInput {
  readonly id?: string;
  readonly campaignId?: string | null;
  readonly city: string;
  readonly targetAppId: BrandAppId;
  readonly desireLane?: DesireLaneId | null;
  readonly sourcePlatform: string;
  readonly contactIdentifier: string;
  readonly identifierKind?: "email" | "phone" | "handle";
  readonly statedAge: number | null;
  readonly replyOrBioText: string;
  readonly verifiedWorkEmail?: boolean;
  readonly tier1PublicProof?: boolean;
  readonly attendedIrlEvent?: boolean;
  readonly confirmedTimeWithin24h?: boolean;
  readonly priorNoShow?: boolean;
  readonly priorDropCount?: number;
  readonly memberOrAnchorVouched?: boolean;
  readonly isColdSellerOrRecruiter?: boolean;
  readonly valueDelivered?: boolean;
  readonly explicitPositiveSignal?: boolean;
  readonly persist?: boolean;
}

export interface IntakeScoreResult {
  readonly qualityScore: number;
  readonly qualified: boolean;
  readonly recommendedStatus: IntakeCandidateStatus;
  readonly breakdown: IntakeScoreBreakdown;
  readonly isMinorSignal: boolean;
  readonly isOptOut: boolean;
  readonly candidate: IntakeCandidateRecord | null;
}

export interface IntakePromoteInput {
  readonly recipientName?: string;
  readonly senderName?: string;
  readonly valueDelivered?: boolean;
  readonly explicitPositiveSignal?: boolean;
  readonly channel?: CanonicalOutreachPlatform | "email";
}

export interface IntakePromoteResult {
  readonly allowed: boolean;
  readonly blockedReason?: string;
  readonly candidate: IntakeCandidateRecord | null;
  readonly inviteText: string | null;
  readonly entryUrl: string | null;
  readonly skillUrl: string | null;
}

export interface IntakeBridgeOptions {
  readonly store: MarketingStore;
  readonly bridge?: NetworkCoreBridge;
  readonly clock?: Clock;
  readonly env?: Record<string, string | undefined>;
  readonly leakGuard?: LeakGuard;
}

export function scoreIntakeCandidate(
  input: Omit<IntakeScoreInput, "persist" | "id" | "campaignId" | "contactIdentifier" | "identifierKind">,
): {
  readonly qualityScore: number;
  readonly qualified: boolean;
  readonly recommendedStatus: IntakeCandidateStatus;
  readonly breakdown: IntakeScoreBreakdown;
  readonly isMinorSignal: boolean;
  readonly isOptOut: boolean;
} {
  const text = input.replyOrBioText.trim();
  const disqualifiers: string[] = [];

  const optOut = parseOptOut(text);
  const isOptOut = optOut.match !== "none" || isGlobalOptOutText(text);
  if (isOptOut) {
    disqualifiers.push("opt_out_signal");
  }

  const hasSuspiciousMinorNumber =
    /\b(?:i\s*(?:am|'m)|age\s*[:=]?\s*)\s*(?:[5-9]|1[0-7])\b|\b1[3-7]\b/i.test(text);
  const isMinorSignal =
    (input.statedAge !== null && input.statedAge < 18) ||
    MINOR_CUE_RE.test(text) ||
    (hasSuspiciousMinorNumber && !parseAdult18PlusAnswer(text));
  if (isMinorSignal) {
    disqualifiers.push("underage_or_minor_signal");
  }

  if (detectExternalPromptInjection(text)) {
    disqualifiers.push("prompt_injection");
  }

  if (input.isColdSellerOrRecruiter || COLD_SELLER_RE.test(text)) {
    disqualifiers.push("cold_seller_or_spam");
  }

  const wordCount = text.length > 0 ? text.split(/\s+/).length : 0;
  if (wordCount <= 3 || GENERIC_SLOP_RE.test(text)) {
    disqualifiers.push("low_effort_slop");
  }
  if (AI_SLOP_PHRASES_RE.test(text)) {
    disqualifiers.push("ai_slop_phrasing");
  }

  if (disqualifiers.length > 0) {
    const recommendedStatus: IntakeCandidateStatus =
      isMinorSignal || isOptOut ? "suppressed" : "rejected_slop";
    return {
      qualityScore: 0,
      qualified: false,
      recommendedStatus,
      breakdown: {
        specificityEffort: 0,
        proofOfWorkAnchoring: 0,
        reliabilityFollowThrough: 0,
        bilateralValueFit: 0,
        disqualifiers,
      },
      isMinorSignal,
      isOptOut,
    };
  }

  // 1. Specificity & Effort (0..25)
  let specificityEffort = 0;
  if (text.length >= 40) specificityEffort += 10;
  else if (text.length >= 20) specificityEffort += 5;
  if (wordCount >= 12) specificityEffort += 5;
  if (SPECIFICITY_SIGNAL_RE.test(text)) specificityEffort += 7;
  if (text.includes("?")) specificityEffort += 3;
  specificityEffort = Math.min(25, specificityEffort);

  // 2. Proof-of-Work & Anchoring (0..25)
  let proofOfWorkAnchoring = 0;
  if (input.verifiedWorkEmail) proofOfWorkAnchoring += 10;
  if (input.tier1PublicProof) proofOfWorkAnchoring += 10;
  if (input.attendedIrlEvent) proofOfWorkAnchoring += 10;
  if (/\b(github\.com|arxiv\.org|substack|published|founded|shipped|exhibited|licensed)\b/i.test(text)) {
    proofOfWorkAnchoring += 5;
  }
  proofOfWorkAnchoring = Math.min(25, proofOfWorkAnchoring);

  // 3. Reliability & Follow-Through (0..25)
  let reliabilityFollowThrough = 10;
  if (input.confirmedTimeWithin24h) reliabilityFollowThrough += 10;
  if (input.attendedIrlEvent) reliabilityFollowThrough += 5;
  if (RELIABILITY_SIGNAL_RE.test(text)) reliabilityFollowThrough += 5;
  if (input.priorNoShow) reliabilityFollowThrough -= 20;
  if ((input.priorDropCount ?? 0) > 0) {
    reliabilityFollowThrough -= Math.min(15, (input.priorDropCount ?? 0) * 5);
  }
  reliabilityFollowThrough = Math.max(0, Math.min(25, reliabilityFollowThrough));

  // 4. Bilateral Value Fit (0..25)
  let bilateralValueFit = 10;
  if (input.memberOrAnchorVouched) bilateralValueFit += 10;
  if (input.valueDelivered) bilateralValueFit += 5;
  if (input.explicitPositiveSignal) bilateralValueFit += 5;
  bilateralValueFit = Math.min(25, bilateralValueFit);

  const qualityScore = Math.max(
    0,
    Math.min(100, specificityEffort + proofOfWorkAnchoring + reliabilityFollowThrough + bilateralValueFit),
  );
  const qualified = qualityScore >= MIN_INTAKE_QUALITY_SCORE && (input.statedAge === null || input.statedAge >= 18);

  let recommendedStatus: IntakeCandidateStatus = "spotted";
  if (qualified) {
    recommendedStatus = "qualified";
  } else if (input.valueDelivered) {
    recommendedStatus = "value_delivered";
  } else if (qualityScore < 40) {
    recommendedStatus = "rejected_slop";
  }

  return {
    qualityScore,
    qualified,
    recommendedStatus,
    breakdown: {
      specificityEffort,
      proofOfWorkAnchoring,
      reliabilityFollowThrough,
      bilateralValueFit,
      disqualifiers,
    },
    isMinorSignal: false,
    isOptOut: false,
  };
}

export class IntakeBridge {
  private readonly store: MarketingStore;
  private readonly bridge?: NetworkCoreBridge;
  private readonly clock: Clock;
  private readonly env: Record<string, string | undefined>;
  private readonly leakGuard: LeakGuard;

  constructor(opts: IntakeBridgeOptions) {
    this.store = opts.store;
    this.bridge = opts.bridge;
    this.clock = opts.clock ?? opts.store.clock ?? new RealClock();
    this.env = opts.env ?? process.env;
    this.leakGuard =
      opts.leakGuard ??
      createMarketingLeakGuard(this.env, {
        allow: [...marketingLeakAllowlist([], this.env)],
      });
  }

  async scoreAndRecordCandidate(input: IntakeScoreInput): Promise<IntakeScoreResult> {
    const idKind =
      input.identifierKind ??
      (input.contactIdentifier.includes("@") ? "email" : "handle");
    const contactHash =
      keyedContactHash(idKind, input.contactIdentifier, this.env) ??
      createHash("sha256").update(`${idKind}:${input.contactIdentifier.trim().toLowerCase()}`).digest("hex");
    const scored = scoreIntakeCandidate(input);

    if (scored.isMinorSignal || scored.isOptOut) {
      await this.store.recordContactSuppression({
        contactHash,
        reason: scored.isMinorSignal ? "intake_minor_signal" : "intake_opt_out",
        sourceChannel: input.sourcePlatform,
        isMinor: scored.isMinorSignal,
      });
    }

    let fencedStatus: IntakeCandidateStatus = scored.recommendedStatus;
    const existingSuppression = await this.store.isContactSuppressed(contactHash);
    if (existingSuppression) {
      fencedStatus = "suppressed";
    } else if (this.bridge) {
      const fence = await this.bridge.checkContactFence({
        email: idKind === "email" ? input.contactIdentifier : null,
        phone: idKind === "phone" ? input.contactIdentifier : null,
        handleHash: contactHash,
      });
      if (!fence.allowed) {
        fencedStatus = "suppressed";
        await this.store.recordContactSuppression({
          contactHash,
          reason: fence.reason ?? "contact_fence_blocked",
          sourceChannel: input.sourcePlatform,
          isMinor: fence.knownMinor,
        });
      }
    }

    if (input.persist === false) {
      return {
        ...scored,
        recommendedStatus: fencedStatus,
        qualified: scored.qualified && fencedStatus !== "suppressed",
        candidate: null,
      };
    }

    const candidate = await this.store.upsertIntakeCandidate({
      id: input.id,
      campaignId: input.campaignId ?? null,
      city: input.city,
      targetAppId: input.targetAppId,
      desireLane: input.desireLane ?? null,
      sourcePlatform: input.sourcePlatform,
      contactHash,
      statedAge: input.statedAge,
      qualityScore: scored.qualityScore,
      scoreBreakdown: scored.breakdown,
      valueDelivered: Boolean(input.valueDelivered),
      explicitPositiveSignal: Boolean(input.explicitPositiveSignal),
      inviteAttempts: 0,
      status: fencedStatus,
    });

    return {
      ...scored,
      recommendedStatus: candidate.status,
      qualified: scored.qualified && candidate.status !== "suppressed",
      candidate,
    };
  }

  async promoteCandidate(
    candidateId: string,
    input: IntakePromoteInput = {},
  ): Promise<IntakePromoteResult> {
    const candidate = await this.store.getIntakeCandidate(candidateId);
    if (!candidate) {
      return {
        allowed: false,
        blockedReason: "intake_candidate_not_found",
        candidate: null,
        inviteText: null,
        entryUrl: null,
        skillUrl: null,
      };
    }

    // Hard brand air-gap: dating external prospects (Tinder/Bumble/Hinge) can NEVER flow into peon.biz.
    if (
      DATING_SOURCE_PLATFORMS.has(candidate.sourcePlatform.toLowerCase()) &&
      !isAppAllowedToReadExternalProspects(candidate.targetAppId)
    ) {
      return {
        allowed: false,
        blockedReason: "cross_brand_external_prospect_air_gap",
        candidate,
        inviteText: null,
        entryUrl: null,
        skillUrl: null,
      };
    }

    const suppression = await this.store.isContactSuppressed(candidate.contactHash);
    let bridgeBlocked = false;
    let bridgeMinor = false;
    let bridgeReason: string | undefined;

    if (this.bridge) {
      const fence = await this.bridge.checkContactFence({
        handleHash: candidate.contactHash,
      });
      if (!fence.allowed) {
        bridgeBlocked = true;
        bridgeMinor = fence.knownMinor;
        bridgeReason = fence.reason;
      }
    }

    const campaign = candidate.campaignId
      ? await this.store.getCampaign(candidate.campaignId)
      : null;

    let queuePressurePaused = false;
    if (this.bridge) {
      const throttle = await this.bridge.shouldThrottleIntake(
        candidate.city,
        candidate.targetAppId,
      );
      queuePressurePaused = throttle.paused;
    }

    const effectiveValueDelivered = Boolean(candidate.valueDelivered || input.valueDelivered);
    const effectivePositiveSignal = Boolean(
      candidate.explicitPositiveSignal || input.explicitPositiveSignal,
    );
    const isKnownMinor =
      (candidate.statedAge !== null && candidate.statedAge < 18) ||
      Boolean(suppression?.isMinor) ||
      bridgeMinor;
    const isSuppressed =
      candidate.status === "suppressed" || Boolean(suppression) || bridgeBlocked;
    const contactSafe = !isSuppressed && !isKnownMinor && campaign?.riskDial !== "lockdown";

    const decision = evaluateOutOfNetworkPromotion({
      statedAge: candidate.statedAge ?? 0,
      qualityScore: candidate.qualityScore,
      valueDelivered: effectiveValueDelivered,
      explicitPositiveSignal: effectivePositiveSignal,
      contactSafe,
      queuePaused: queuePressurePaused,
      priorInviteCount: candidate.inviteAttempts,
    });

    if (!decision.allowed) {
      return {
        allowed: false,
        blockedReason: bridgeReason ?? decision.reason ?? "intake_promotion_blocked",
        candidate,
        inviteText: null,
        entryUrl: null,
        skillUrl: null,
      };
    }

    const domain = BRAND_DOMAINS[candidate.targetAppId];
    const entryUrl = `https://${domain}`;
    const skillUrl = `https://${domain}/SKILL.md`;
    const greeting = input.recipientName?.trim() ? `Hey ${input.recipientName.trim()}, ` : "";
    const signOff = input.senderName?.trim() ? ` — ${input.senderName.trim()}` : "";
    let inviteText = `${greeting}glad that intro worked out. Since you asked how to stay in the loop for future ${candidate.city.toUpperCase()} intros, you can join anytime at ${entryUrl} (or point your agent to ${skillUrl}). Zero pressure either way${signOff}.`;

    if (input.channel === "partiful" || candidate.sourcePlatform === "partiful") {
      inviteText = scrubPartifulTelecomCopy(inviteText).text;
    }

    const leaks = this.leakGuard.check(inviteText);
    if (leaks.length > 0) {
      return {
        allowed: false,
        blockedReason: `leak_guard_blocked:${leaks[0]}`,
        candidate,
        inviteText: null,
        entryUrl: null,
        skillUrl: null,
      };
    }

    const updated = await this.store.updateIntakeCandidate(candidate.id, {
      valueDelivered: effectiveValueDelivered,
      explicitPositiveSignal: effectivePositiveSignal,
      inviteAttempts: candidate.inviteAttempts + 1,
      status: "invited",
    });

    await this.store.recordContactTouchpoint({
      contactHash: candidate.contactHash,
      campaignId: candidate.campaignId,
      surface: "intake",
      isCold: false,
      answered: true,
    });

    return {
      allowed: true,
      candidate: updated,
      inviteText,
      entryUrl,
      skillUrl,
    };
  }
}

export function createIntakeBridge(opts: IntakeBridgeOptions): IntakeBridge {
  return new IntakeBridge(opts);
}
