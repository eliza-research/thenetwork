// Canonical thin policy-adapter layer for @thenetwork/marketing.
// Every policy and device safety decision delegates directly to the Vibestack/Dafny-proved
// generated cores in packages/core/src/generated/marketingPolicy.ts and marketingDevice.ts.

import { createHmac } from "node:crypto";
import { appKeys, brandFor } from "../../../packages/core/src/generated/brandIdentity.ts";
import {
  canDispatchDeviceStep,
  deviceBatteryMax,
  deviceBatteryMin,
  deviceBatterySafe,
  deviceTempMaxC,
  deviceTempMinC,
  warmupDailyCap,
} from "../../../packages/core/src/generated/marketingDevice.ts";
import {
  adultParticipantAge,
  antiFraudPayoutAllowed,
  banditArmEligible,
  banditMaxStopRateBps,
  bdDealWithinBounds,
  canApproveCreatorProof,
  canAuthorizeTaskSpend,
  canDispatchAgentTurn,
  canSendOutreach,
  coldCooldownDays,
  consumerLifetimeBonusCapCents,
  contactCooldownAllowed,
  contactSafetyEligible,
  llmBudgetWithinCaps,
  maxColdTouches30d,
  maxOpTouchesPerDay,
  maxUnansweredCold,
  mvnoBonusCapCents,
  queuePressurePaused,
  w9AnnualThresholdCents,
} from "../../../packages/core/src/generated/marketingPolicy.ts";
import { LeakGuard, setLeakLabelKey, type LeakOptions } from "../../../packages/core/src/guard.ts";
import { keywordKey, optOutPhrase, parseOptOut } from "../../../packages/core/src/replies.ts";
import { DEFAULT_BANDIT_MAX_CPA_CENTS, DEFAULT_DAILY_OUTREACH_CAP } from "./constants.ts";
import type {
  Campaign,
  DeviceNode,
  DeviceStatus,
  DeviceWarmupStage,
  HumanPartner,
  ImplementationTier,
  MarketingAgent,
  MarketingTask,
  OutreachStatus,
  PhoneLineType,
  ProofSubmission,
  TaskKind,
} from "./types.ts";

export class PolicyViolationError extends Error {
  readonly code: string;
  readonly invariant: string;

  constructor(code: string, invariant: string, message: string) {
    super(message);
    this.name = "PolicyViolationError";
    this.code = code;
    this.invariant = invariant;
  }
}

export function minAgeReading(
  ...ages: ReadonlyArray<number | null | undefined>
): number | null {
  let lowest: number | null = null;
  for (const age of ages) {
    if (typeof age !== "number" || !Number.isInteger(age)) continue;
    lowest = lowest === null ? age : Math.min(lowest, age);
  }
  return lowest;
}

export function isAdultReading(age: number | null | undefined): boolean {
  return typeof age === "number" && Number.isInteger(age) && adultParticipantAge(age);
}

export interface SpendAuthPolicyInput {
  campaign: Campaign;
  tier: ImplementationTier;
  amountCents: number;
  useSlopCash: boolean;
  slopCashEnvEnabled: boolean;
  taskKind?: TaskKind;
  fromReserve?: boolean;
}

export interface SpendAuthDecision {
  allowed: boolean;
  code?: string;
  invariant?: string;
  reason?: string;
}

export function evaluateSpendAuth(input: SpendAuthPolicyInput): SpendAuthDecision {
  const { campaign, tier, amountCents, useSlopCash, slopCashEnvEnabled, fromReserve } = input;
  const taskKindIsOssDev = input.taskKind === "oss_dev_bounty";

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return {
      allowed: false,
      code: "INVALID_AMOUNT",
      invariant: "inv_budget_never_exceeded",
      reason: "amountCents must be a positive safe integer.",
    };
  }

  if (fromReserve && campaign.reservedCents < amountCents) {
    return {
      allowed: false,
      code: "INSUFFICIENT_RESERVE",
      invariant: "inv_budget_never_exceeded",
      reason: `Cannot commit ${amountCents}c from reserve; only ${campaign.reservedCents}c reserved.`,
    };
  }

  const effectiveMonthly = fromReserve
    ? campaign.spentCents + campaign.reservedCents - amountCents
    : campaign.spentCents + campaign.reservedCents;
  const effectiveDaily = fromReserve
    ? Math.max(0, campaign.dailySpentCents - amountCents)
    : campaign.dailySpentCents;
  const slopCashEnabled = campaign.slopCashEnabled && slopCashEnvEnabled;

  const allowed = canAuthorizeTaskSpend(
    tier,
    amountCents,
    campaign.maxTaskCents,
    effectiveDaily,
    campaign.dailyCapCents,
    effectiveMonthly,
    campaign.monthlyBudgetCents,
    campaign.billingArmed,
    campaign.riskDial === "lockdown",
    useSlopCash,
    slopCashEnabled,
    taskKindIsOssDev,
  );

  if (allowed) return { allowed: true };

  if (useSlopCash && !taskKindIsOssDev) {
    return {
      allowed: false,
      code: "SLOP_CASH_OSS_ONLY",
      invariant: "inv_slop_cash_disabled",
      reason: "slop.cash payout rail is restricted strictly to oss_dev_bounty tasks.",
    };
  }
  if (useSlopCash && !slopCashEnabled) {
    return {
      allowed: false,
      code: "SLOP_CASH_DISABLED",
      invariant: "inv_slop_cash_disabled",
      reason: "slop.cash settlement is disabled.",
    };
  }
  if (tier > 2 && (!campaign.billingArmed || campaign.riskDial === "lockdown")) {
    return {
      allowed: false,
      code: "TIER_BILLING_BLOCKED",
      invariant: "inv_tier_billing_gate",
      reason: `Tier ${tier} spend blocked: billingArmed=${campaign.billingArmed}, riskDial=${campaign.riskDial}.`,
    };
  }
  return {
    allowed: false,
    code: "BUDGET_CAP_EXCEEDED",
    invariant: "inv_budget_never_exceeded",
    reason: `Spend of ${amountCents}c rejected by campaign caps (task=${campaign.maxTaskCents}c, daily=${campaign.dailyCapCents}c, monthly=${campaign.monthlyBudgetCents}c).`,
  };
}

export function assertSpendAuth(input: SpendAuthPolicyInput): void {
  const decision = evaluateSpendAuth(input);
  if (!decision.allowed) {
    throw new PolicyViolationError(
      decision.code ?? "BUDGET_CAP_EXCEEDED",
      decision.invariant ?? "inv_budget_never_exceeded",
      decision.reason ?? "Spend blocked by marketingPolicy.",
    );
  }
}

export interface ProofPolicyInput {
  proof: Pick<
    ProofSubmission,
    | "proofKind"
    | "evidenceUrl"
    | "checkinMediaHashes"
    | "qrScansCount"
    | "verifiedSignupsCount"
    | "ftcDisclosed"
    | "geoTimeValid"
    | "likenessReleaseOk"
  >;
  workerAge: number | null;
  workerBanned: boolean;
  shiftDone?: boolean;
  requireHttpEvidenceUrl?: boolean;
}

export interface ProofPolicyDecision {
  approved: boolean;
  reason?: string;
}

export function evaluateProofPolicy(input: ProofPolicyInput): ProofPolicyDecision {
  const { proof, workerAge, workerBanned, shiftDone, requireHttpEvidenceUrl } = input;
  const trimmedUrl = proof.evidenceUrl?.trim() ?? "";
  const hasEvidenceUrl = requireHttpEvidenceUrl
    ? /^https?:\/\//i.test(trimmedUrl)
    : trimmedUrl.length > 0;
  const verifiedSignupsOrShiftDone = Boolean(
    shiftDone ||
      proof.verifiedSignupsCount > 0 ||
      proof.qrScansCount > 0 ||
      proof.checkinMediaHashes.length >= 2,
  );
  const needsRelease = proof.proofKind === "creator_video";
  const effectiveAge =
    typeof workerAge === "number" && Number.isInteger(workerAge) ? workerAge : -1;

  const approved = canApproveCreatorProof(
    hasEvidenceUrl,
    proof.ftcDisclosed,
    proof.geoTimeValid,
    verifiedSignupsOrShiftDone,
    effectiveAge,
    workerBanned,
    needsRelease,
    proof.likenessReleaseOk,
  );

  if (approved) return { approved: true };

  if (!adultParticipantAge(effectiveAge)) {
    return { approved: false, reason: "worker_underage_or_invalid_age" };
  }
  if (workerBanned) return { approved: false, reason: "worker_banned" };
  if (!hasEvidenceUrl) return { approved: false, reason: "missing_evidence_url" };
  if (!proof.ftcDisclosed) return { approved: false, reason: "missing_ftc_disclosure" };
  if (!proof.geoTimeValid) return { approved: false, reason: "invalid_geo_time_window" };
  if (!verifiedSignupsOrShiftDone) {
    return { approved: false, reason: "missing_shift_or_signup_evidence" };
  }
  return { approved: false, reason: "missing_ny_likeness_release" };
}

export function assertProofAndAdultForPayoutPolicy(
  task: MarketingTask,
  latestProof: ProofSubmission | null,
  human: HumanPartner | null,
  explicitWorkerAge?: number | null,
): void {
  if (task.tier < 4) return;
  const lowestAge = minAgeReading(explicitWorkerAge, task.assigneeAgeYears, human?.lowestAge);
  const workerAge = lowestAge ?? -1;
  const workerBanned = human?.banned ?? false;
  if (!adultParticipantAge(workerAge)) {
    throw new PolicyViolationError(
      "UNDERAGE_OR_UNKNOWN_WORKER",
      "inv_adult_only_paid",
      `Task ${task.id} cannot be paid: worker age (${workerAge}) is not a verified adult (18..120).`,
    );
  }
  if (!task.proofVerified || latestProof === null || latestProof.verdict !== "verified") {
    throw new PolicyViolationError(
      "PROOF_NOT_VERIFIED",
      "inv_proof_required_before_payout",
      `Task ${task.id} cannot be paid without a verified adult proof passing canApproveCreatorProof.`,
    );
  }
  const decision = evaluateProofPolicy({
    proof: latestProof,
    workerAge,
    workerBanned,
    shiftDone: latestProof.checkinMediaHashes.length > 0 || latestProof.verdict === "verified",
  });
  if (!decision.approved) {
    throw new PolicyViolationError(
      "PROOF_NOT_VERIFIED",
      "inv_proof_required_before_payout",
      `Task ${task.id} proof rejected (${decision.reason ?? "proof_not_verified"}).`,
    );
  }
}

export interface AntiFraudPolicyInput {
  tier: number;
  amountCents: number;
  phoneLineType: PhoneLineType;
  priorLifetimeCents: number;
  annualWorkerCents: number;
  hasW9: boolean;
  mediaDuplicate: boolean;
  clusterQuarantined: boolean;
}

export interface AntiFraudPolicyDecision {
  allowed: boolean;
  reason?: string;
}

export function evaluateAntiFraudPayout(input: AntiFraudPolicyInput): AntiFraudPolicyDecision {
  const isVoip = input.phoneLineType === "voip";
  const isPrepaidOrMvno = input.phoneLineType === "prepaid" || input.phoneLineType === "mvno";
  const safeNums =
    Number.isInteger(input.tier) &&
    Number.isSafeInteger(input.amountCents) &&
    Number.isSafeInteger(input.priorLifetimeCents) &&
    Number.isSafeInteger(input.annualWorkerCents);

  if (!safeNums) {
    return { allowed: false, reason: "invalid_numeric_input" };
  }

  const allowed = antiFraudPayoutAllowed(
    input.tier,
    input.amountCents,
    isPrepaidOrMvno,
    isVoip,
    input.priorLifetimeCents,
    input.annualWorkerCents,
    input.hasW9,
    input.mediaDuplicate,
    input.clusterQuarantined,
  );

  if (allowed) return { allowed: true };
  if (input.tier < 1) return { allowed: false, reason: "vesting_tier_not_payable" };
  if (input.amountCents <= 0) return { allowed: false, reason: "non_positive_amount" };
  if (isVoip) return { allowed: false, reason: "voip_blocked" };
  if (isPrepaidOrMvno && input.amountCents > mvnoBonusCapCents) {
    return { allowed: false, reason: `prepaid_mvno_cap_exceeded_${mvnoBonusCapCents}c` };
  }
  if (input.tier < 4 && input.priorLifetimeCents + input.amountCents > consumerLifetimeBonusCapCents) {
    return {
      allowed: false,
      reason: `lifetime_person_cap_exceeded_${consumerLifetimeBonusCapCents}c`,
    };
  }
  if (input.annualWorkerCents + input.amountCents > w9AnnualThresholdCents && !input.hasW9) {
    return { allowed: false, reason: `w9_required_over_${w9AnnualThresholdCents}c` };
  }
  if (input.mediaDuplicate) return { allowed: false, reason: "duplicate_media_hash" };
  if (input.clusterQuarantined) return { allowed: false, reason: "sybil_cluster_quarantined" };
  return { allowed: false, reason: "antifraud_policy_blocked" };
}

export interface BdDealBoundsInput {
  offeredCents: number;
  maxVenueCents: number;
  hasPhoneCallback: boolean;
  contractSigned: boolean;
}

export interface BdDealBoundsDecision {
  allowed: boolean;
  reason?: string;
}

export function evaluateBdDealBounds(input: BdDealBoundsInput): BdDealBoundsDecision {
  if (!Number.isSafeInteger(input.offeredCents) || !Number.isSafeInteger(input.maxVenueCents)) {
    return { allowed: false, reason: "invalid_offer_amount" };
  }
  const allowed = bdDealWithinBounds(
    input.offeredCents,
    input.maxVenueCents,
    input.hasPhoneCallback,
    input.contractSigned,
  );
  if (allowed) return { allowed: true };
  if (input.offeredCents < 0 || input.maxVenueCents < 0 || input.offeredCents > input.maxVenueCents) {
    return { allowed: false, reason: "offer_exceeds_venue_cap" };
  }
  if (!input.hasPhoneCallback) return { allowed: false, reason: "missing_phone_callback" };
  return { allowed: false, reason: "missing_signed_contract" };
}

export interface BanditArmEligibilityInput {
  cpaCents: number;
  maxCpaCents?: number;
  stopRateBps: number;
  maxStopRateBps?: number;
}

export interface BanditArmEligibilityDecision {
  eligible: boolean;
  reason?: string;
}

export function evaluateBanditArmEligibility(
  input: BanditArmEligibilityInput,
): BanditArmEligibilityDecision {
  const maxCpaCents = input.maxCpaCents ?? DEFAULT_BANDIT_MAX_CPA_CENTS;
  const maxStopRateBps = input.maxStopRateBps ?? banditMaxStopRateBps;
  if (
    !Number.isSafeInteger(input.cpaCents) ||
    !Number.isSafeInteger(maxCpaCents) ||
    !Number.isSafeInteger(input.stopRateBps) ||
    !Number.isSafeInteger(maxStopRateBps)
  ) {
    return { eligible: false, reason: "invalid_bandit_metrics" };
  }
  const eligible = banditArmEligible(
    input.cpaCents,
    maxCpaCents,
    input.stopRateBps,
    maxStopRateBps,
  );
  if (eligible) return { eligible: true };
  if (input.stopRateBps > maxStopRateBps) return { eligible: false, reason: "stop_rate_exceeded" };
  if (input.cpaCents > maxCpaCents) return { eligible: false, reason: "cpa_ceiling_exceeded" };
  return { eligible: false, reason: "invalid_bandit_metrics" };
}

export interface AgentTurnPolicyInput {
  agent: MarketingAgent;
  nowMs: number;
  targetStopped: boolean;
  lockdown: boolean;
}

export interface AgentTurnPolicyDecision {
  allowed: boolean;
  inCooldown: boolean;
  reason?: string;
}

export function evaluateAgentTurnPolicy(input: AgentTurnPolicyInput): AgentTurnPolicyDecision {
  const { agent, nowMs, targetStopped, lockdown } = input;
  const inCooldown = agent.cooldownUntil !== null && Date.parse(agent.cooldownUntil) > nowMs;
  const agentPaused = agent.status === "paused_stop";
  const rateLimited = agent.status === "rate_limited" || inCooldown;

  const allowed = canDispatchAgentTurn(
    agentPaused,
    rateLimited,
    agent.sessionHealthy,
    agent.turnsUsedToday,
    agent.dailyTurnCap,
    targetStopped,
    lockdown,
  );

  if (allowed) return { allowed: true, inCooldown };

  const reason = targetStopped
    ? "target_stopped"
    : lockdown
      ? "campaign_lockdown"
      : agentPaused
        ? "agent_paused"
        : rateLimited
          ? "rate_limited"
          : !agent.sessionHealthy
            ? "session_unhealthy"
            : "daily_turn_cap_reached";
  return { allowed: false, inCooldown, reason };
}

export interface OutreachPolicyInput {
  human: Pick<HumanPartner, "stopped" | "banned" | "dailySendsToday">;
  lockdown: boolean;
  leakCheckPass: boolean;
  sentToday?: number;
  dailyOutreachCap?: number;
}

export interface OutreachPolicyDecision {
  allowed: boolean;
  blockedStatus?: Extract<OutreachStatus, "blocked_stop" | "blocked_policy">;
  reason?: string;
}

export function evaluateOutreachPolicy(input: OutreachPolicyInput): OutreachPolicyDecision {
  const sentToday = input.sentToday ?? input.human.dailySendsToday;
  const dailyCap = input.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP;
  const gatePass = canSendOutreach(
    input.human.stopped,
    input.human.banned,
    input.lockdown,
    sentToday,
    dailyCap,
  );

  if (input.human.stopped) {
    return { allowed: false, blockedStatus: "blocked_stop", reason: "target_stopped" };
  }
  if (!gatePass || !input.leakCheckPass) {
    const reason = !input.leakCheckPass
      ? "leak_guard_blocked"
      : input.human.banned
        ? "target_banned"
        : input.lockdown
          ? "campaign_lockdown"
          : "daily_outreach_cap_reached";
    return { allowed: false, blockedStatus: "blocked_policy", reason };
  }
  return { allowed: true };
}

export function deriveWarmupStage(warmupDay: number): DeviceWarmupStage {
  if (warmupDay < 1) return "birth_passive";
  if (warmupDay <= 3) return "light_organic";
  if (warmupDay <= 14) return "branded_cadence";
  return "steady_state";
}

export function isDeviceLeaseHeldByOther(
  device: Pick<DeviceNode, "leaseHolder" | "leaseExpiresAt">,
  leaseHolder: string,
  nowMs: number,
): boolean {
  if (device.leaseHolder === null || device.leaseHolder === leaseHolder) return false;
  if (device.leaseExpiresAt === null) return true;
  const expiresMs = Date.parse(device.leaseExpiresAt);
  return Number.isFinite(expiresMs) ? expiresMs > nowMs : true;
}

export function deriveDeviceTelemetryStatus(
  reachable: boolean,
  batteryPct: number,
  tempC: number,
  currentStatus: DeviceStatus,
  hasActiveLease = false,
): DeviceStatus {
  if (!reachable) return "offline";
  if (currentStatus === "needs_takeover") return "needs_takeover";
  if (tempC < deviceTempMinC || tempC > deviceTempMaxC) return "thermal_cooldown";
  if (batteryPct < deviceBatteryMin || batteryPct > deviceBatteryMax) return "charging_wait";
  return currentStatus === "leased" || hasActiveLease ? "leased" : "online";
}

export interface DeviceActionPolicyInput {
  device: DeviceNode;
  leaseHolder: string;
  nowMs: number;
  lockdown: boolean;
  targetStopped: boolean;
  challengeDetected?: boolean;
}

export interface DeviceActionPolicyDecision {
  allowed: boolean;
  leasedByOther: boolean;
  needsTakeover: boolean;
  reason?: string;
}

export function evaluateDeviceActionPolicy(
  input: DeviceActionPolicyInput,
): DeviceActionPolicyDecision {
  const { device, leaseHolder, nowMs, lockdown, targetStopped, challengeDetected } = input;
  const deviceOnline = device.status === "online" || device.status === "leased";
  const leasedByOther = isDeviceLeaseHeldByOther(device, leaseHolder, nowMs);
  const needsTakeover = Boolean(challengeDetected || device.status === "needs_takeover");

  const allowed = canDispatchDeviceStep(
    deviceOnline,
    leasedByOther,
    needsTakeover,
    device.batteryPct,
    device.tempC,
    device.dailyActionsUsed,
    device.warmupDay,
    lockdown,
    targetStopped,
  );

  if (allowed) return { allowed: true, leasedByOther, needsTakeover };

  const cap = warmupDailyCap(device.warmupDay);
  const reason = needsTakeover
    ? "needs_takeover"
    : targetStopped
      ? "target_stopped"
      : lockdown
        ? "lockdown"
        : leasedByOther
          ? "leased_by_other"
          : !deviceOnline
            ? "device_offline"
            : !deviceBatterySafe(device.batteryPct, device.tempC)
              ? `battery_or_thermal_unsafe (battery=${device.batteryPct}% needs ${deviceBatteryMin}..${deviceBatteryMax}%, temp=${device.tempC}C needs ${deviceTempMinC}..${deviceTempMaxC}C)`
              : `warmup_cap_reached (${device.dailyActionsUsed}/${cap} on day ${device.warmupDay})`;
  return { allowed: false, leasedByOther, needsTakeover, reason };
}

export interface LlmBudgetPolicyInput {
  tokensUsedToday: number;
  estimatedTokens: number;
  dailyTokenCap: number;
  costMicrosToday: number;
  estimatedCostMicros: number;
  dailyCostCapMicros: number;
}

export interface LlmBudgetPolicyDecision {
  allowed: boolean;
  reason?: string;
}

export function evaluateLlmBudget(input: LlmBudgetPolicyInput): LlmBudgetPolicyDecision {
  const {
    tokensUsedToday,
    estimatedTokens,
    dailyTokenCap,
    costMicrosToday,
    estimatedCostMicros,
    dailyCostCapMicros,
  } = input;
  const values = [
    tokensUsedToday,
    estimatedTokens,
    dailyTokenCap,
    costMicrosToday,
    estimatedCostMicros,
    dailyCostCapMicros,
  ];
  if (!values.every((v) => Number.isSafeInteger(v))) {
    return { allowed: false, reason: "invalid_llm_budget_value" };
  }
  const allowed = llmBudgetWithinCaps(
    tokensUsedToday,
    estimatedTokens,
    dailyTokenCap,
    costMicrosToday,
    estimatedCostMicros,
    dailyCostCapMicros,
  );
  if (allowed) return { allowed: true };
  if (tokensUsedToday < 0 || estimatedTokens < 0 || dailyTokenCap <= 0) {
    return { allowed: false, reason: "invalid_token_cap" };
  }
  if (tokensUsedToday + estimatedTokens > dailyTokenCap) {
    return { allowed: false, reason: "daily_token_cap_exceeded" };
  }
  if (costMicrosToday < 0 || estimatedCostMicros < 0 || dailyCostCapMicros <= 0) {
    return { allowed: false, reason: "invalid_cost_cap" };
  }
  return { allowed: false, reason: "daily_cost_cap_exceeded" };
}

export interface QueuePressurePolicyInput {
  lineRestricted: boolean;
  reviewOverdue: number;
  reviewOpen: number;
  reviewBacklogLimit: number;
  outboundWaiting: number;
  outboundBacklogLimit: number;
}

export interface QueuePressurePolicyDecision {
  paused: boolean;
  reason?: string;
}

export function evaluateQueuePressure(input: QueuePressurePolicyInput): QueuePressurePolicyDecision {
  const {
    lineRestricted,
    reviewOverdue,
    reviewOpen,
    reviewBacklogLimit,
    outboundWaiting,
    outboundBacklogLimit,
  } = input;
  const paused = queuePressurePaused(
    lineRestricted,
    reviewOverdue,
    reviewOpen,
    reviewBacklogLimit,
    outboundWaiting,
    outboundBacklogLimit,
  );
  if (!paused) return { paused: false };
  const reason = lineRestricted
    ? "platform_line_restricted"
    : reviewOverdue > 0
      ? "platform_review_overdue"
      : reviewOpen >= reviewBacklogLimit
        ? "platform_review_backlog_limit"
        : "platform_outbound_backlog_limit";
  return { paused: true, reason };
}

export interface ContactHygienePolicyInput {
  isStopped: boolean;
  isBanned: boolean;
  isKnownMinor: boolean;
  lockdown: boolean;
  isCold: boolean;
  isQuietHours: boolean;
  daysSinceCold: number;
  coldTouches30d: number;
  unansweredCold: number;
  opTouchesToday: number;
}

export interface ContactHygienePolicyDecision {
  allowed: boolean;
  reason?: string;
}

export function evaluateContactHygiene(
  input: ContactHygienePolicyInput,
): ContactHygienePolicyDecision {
  const safetyOk = contactSafetyEligible(
    input.isStopped,
    input.isBanned,
    input.isKnownMinor,
    input.lockdown,
  );
  if (!safetyOk) {
    const reason = input.isKnownMinor
      ? "contact_known_minor"
      : input.isStopped
        ? "contact_stopped"
        : input.isBanned
          ? "contact_banned"
          : "campaign_lockdown";
    return { allowed: false, reason };
  }
  const cooldownOk = contactCooldownAllowed(
    input.isCold,
    input.isQuietHours,
    input.daysSinceCold,
    input.coldTouches30d,
    input.unansweredCold,
    input.opTouchesToday,
  );
  if (cooldownOk) return { allowed: true };
  if (input.isCold) {
    if (input.isQuietHours) return { allowed: false, reason: "quiet_hours_cold_blocked" };
    if (input.daysSinceCold < coldCooldownDays) {
      return { allowed: false, reason: "cold_cooldown_window_active" };
    }
    if (input.coldTouches30d >= maxColdTouches30d || input.coldTouches30d < 0) {
      return { allowed: false, reason: "cold_30d_cap_reached" };
    }
    if (input.unansweredCold >= maxUnansweredCold || input.unansweredCold < 0) {
      return { allowed: false, reason: "cold_unanswered_streak_cap" };
    }
  }
  return {
    allowed: false,
    reason:
      input.opTouchesToday >= maxOpTouchesPerDay || input.opTouchesToday < 0
        ? "operational_daily_touch_cap_reached"
        : "contact_cooldown_blocked",
  };
}

export function createMarketingLeakGuard(
  env: Record<string, string | undefined> = process.env,
  extraOptions: LeakOptions = {},
): LeakGuard {
  const labelKey = env.LEAK_LABEL_KEY;
  if (labelKey && new TextEncoder().encode(labelKey).length >= 32) {
    setLeakLabelKey(labelKey);
  }
  const brandDomains = appKeys.flatMap((key) => {
    const domain = brandFor(key).domain;
    return [domain, `https://${domain}`];
  });
  const mergedAllow = [...new Set([...brandDomains, ...(extraOptions.allow ?? [])])];
  return new LeakGuard({
    contacts: true,
    canaryShapes: true,
    ...extraOptions,
    allow: mergedAllow,
  });
}

const E164_STRICT = /^\+[1-9]\d{6,14}$/;
const NANP_10 = /^[2-9]\d{2}[2-9]\d{6}$/;

export function normalizeE164Phone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const compacted = `+${trimmed.slice(1).replace(/[\s().-]+/g, "")}`;
    return E164_STRICT.test(compacted) ? compacted : null;
  }
  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length === 10 && NANP_10.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1") && NANP_10.test(digits.slice(1))) {
    return `+${digits}`;
  }
  return null;
}

export function keyedContactHash(
  kind: "phone" | "email" | "handle",
  raw: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  let normalized: string | null;
  if (kind === "phone") {
    normalized = normalizeE164Phone(raw);
  } else if (kind === "email") {
    const clean = raw.trim().toLowerCase();
    normalized = clean.includes("@") && !/\s/.test(clean) ? clean : null;
  } else {
    const clean = raw.trim().toLowerCase().replace(/^@+/, "");
    normalized = clean.length > 0 ? clean : null;
  }
  if (!normalized) return null;
  const key =
    env.PLATFORM_HASH_KEY ||
    env.MARKETING_CONTACT_HASH_KEY ||
    "marketing-dev-hash-key";
  return createHmac("sha256", key).update(`${kind}:${normalized}`).digest("hex");
}

const GLOBAL_OPT_OUT_KEYS = new Set([
  "STOP",
  "STOP ALL",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
  "OPT OUT",
]);

export function isGlobalOptOutText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const key = keywordKey(trimmed);
  if (GLOBAL_OPT_OUT_KEYS.has(key) || /^S+T+O+P+$/.test(key)) return true;
  if (optOutPhrase(trimmed)) return true;
  const parsed = parseOptOut(trimmed);
  return parsed.match !== "none" && parsed.scope === "all";
}
