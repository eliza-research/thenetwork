import { createHash } from "node:crypto";
import { RealClock } from "../../../packages/core/src/clock.ts";
import {
  consumerLifetimeBonusCapCents,
  mvnoBonusCapCents,
  w9AnnualThresholdCents,
} from "./constants.ts";
import { evaluateAntiFraudPayout } from "./policy.ts";
import type {
  AntiFraudClaim,
  AntiFraudClaimStatus,
  Clock,
  PhoneLineType,
} from "./types.ts";

export const VESTING_HOLD_MS = {
  tier0: 0,
  tier1: 0,
  tier2TrustedPostpaid: 7 * 86_400_000,
  tier2DefaultOrPrepaid: 14 * 86_400_000,
  tier3OrganicAnchor: 48 * 3_600_000,
} as const;

export const NY_FIFA_PAYOUT_SLA_MS = 15 * 86_400_000;
export const OP_Q_ADJUDICATION_SLA_MS = 14 * 86_400_000;

export interface TwilioLookupClassification {
  readonly phoneLineType: PhoneLineType;
  readonly carrierName: string | null;
  readonly smsPumpingRiskScore: number | null;
  readonly blocked: boolean;
}

export interface VideoUrlValidationResult {
  readonly valid: boolean;
  readonly normalizedUrl: string | null;
  readonly host: string | null;
  readonly knownSocialPlatform: boolean;
  readonly reason?: string;
}

export interface TripleFtcCheckInput {
  readonly nativeCommercialToggle: boolean;
  readonly visualOverlayAdTag: boolean;
  readonly spokenDisclosure: boolean;
  readonly captionOrTranscript?: string | null;
}

export interface TripleFtcCheckResult {
  readonly passed: boolean;
  readonly missingSignals: readonly string[];
}

export interface SybilClaimNode {
  readonly id: string;
  readonly personKey: string;
  readonly workerId: string | null;
  readonly mediaHash: string | null;
  readonly subnetPrefix?: string | null;
  readonly payoutAccountRef?: string | null;
  readonly paidReferred: boolean;
  readonly organicAnchorVerified?: boolean;
  readonly matchedPersonKeys?: readonly string[];
}

export interface DetectedSybilCluster {
  readonly clusterId: string;
  readonly claimIds: readonly string[];
  readonly personKeys: readonly string[];
  readonly size: number;
  readonly paidShare: number;
  readonly organicConductance: number;
  readonly reasons: readonly string[];
}

export interface SybilClusterScanResult {
  readonly clusters: readonly DetectedSybilCluster[];
  readonly quarantinedClaimIds: readonly string[];
  readonly quarantinedPersonKeys: readonly string[];
  readonly claimClusterMap: Readonly<Record<string, string>>;
}

export interface AntiFraudEvaluationInput {
  readonly campaignId: string;
  readonly personKey: string;
  readonly workerId: string | null;
  readonly taskId: string | null;
  readonly vestingTier: 0 | 1 | 2 | 3 | 4;
  readonly amountCents: number;
  readonly phoneLineType: PhoneLineType;
  readonly priorLifetimeCents: number;
  readonly annualWorkerCents: number;
  readonly hasW9: boolean;
  readonly createdAtIso: string;
  readonly trustedOperator?: boolean;
  readonly organicAnchorVerified?: boolean;
  readonly mediaHash?: string | null;
  readonly knownMediaHashes?: ReadonlySet<string>;
  readonly clusterQuarantined?: boolean;
  readonly clusterId?: string | null;
  readonly videoUrl?: string | null;
  readonly requireVideoUrl?: boolean;
  readonly tripleFtc?: TripleFtcCheckInput | null;
  readonly requireTripleFtc?: boolean;
  readonly qrScansCount?: number;
  readonly verifiedSignupsCount?: number;
}

export interface AntiFraudEvaluationResult {
  readonly status: AntiFraudClaimStatus;
  readonly allowed: boolean;
  readonly payableCents: number;
  readonly reasons: readonly string[];
  readonly unlockAtIso: string;
  readonly fifaPayByIso: string;
  readonly adjudicationDueIso: string | null;
  readonly claim: Omit<AntiFraudClaim, "id">;
}

const MVNO_CARRIER_PATTERNS =
  /\b(tello|mint\s*mobile|us\s*mobile|visible|cricket|metro\s*by|boost|tracfone|straight\s*talk|google\s*fi|lyca|ultra\s*mobile|consumer\s*cellular|simple\s*mobile|ting|h2o)\b/i;

const KNOWN_SOCIAL_VIDEO_HOSTS: readonly string[] = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
  "instagram.com",
  "www.instagram.com",
  "x.com",
  "www.x.com",
  "twitter.com",
];

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h)) {
    return true;
  }
  const m172 = /^172\.(\d{1,3})\./.exec(h);
  if (m172) {
    const second = Number.parseInt(m172[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(h) || h.startsWith("::ffff:127.")) {
    return true;
  }
  return false;
}

export function hashMediaBytes(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function classifyTwilioLookupLineType(
  payload: Record<string, unknown> | null | undefined,
): TwilioLookupClassification {
  if (!payload || typeof payload !== "object") {
    return {
      phoneLineType: "unknown",
      carrierName: null,
      smsPumpingRiskScore: null,
      blocked: false,
    };
  }

  const lti =
    payload["line_type_intelligence"] && typeof payload["line_type_intelligence"] === "object"
      ? (payload["line_type_intelligence"] as Record<string, unknown>)
      : payload;

  const rawType = typeof lti["type"] === "string" ? lti["type"].trim().toLowerCase() : "";
  const carrierName =
    typeof lti["carrier_name"] === "string" && lti["carrier_name"].trim().length > 0
      ? lti["carrier_name"].trim()
      : null;

  const pumping =
    payload["sms_pumping_risk"] && typeof payload["sms_pumping_risk"] === "object"
      ? (payload["sms_pumping_risk"] as Record<string, unknown>)
      : null;
  const riskScore =
    typeof pumping?.["sms_pumping_risk_score"] === "number" &&
    Number.isFinite(pumping["sms_pumping_risk_score"])
      ? pumping["sms_pumping_risk_score"]
      : null;

  let phoneLineType: PhoneLineType = "unknown";
  if (rawType === "voip" || rawType === "nonfixedvoip" || rawType === "fixedvoip") {
    phoneLineType = "voip";
  } else if (rawType === "landline") {
    phoneLineType = "landline";
  } else if (rawType === "prepaid") {
    phoneLineType = "prepaid";
  } else if (rawType === "mobile") {
    phoneLineType = carrierName && MVNO_CARRIER_PATTERNS.test(carrierName) ? "mvno" : "postpaid";
  } else if (carrierName && MVNO_CARRIER_PATTERNS.test(carrierName)) {
    phoneLineType = "mvno";
  }

  return {
    phoneLineType,
    carrierName,
    smsPumpingRiskScore: riskScore,
    blocked: phoneLineType === "voip" || (riskScore !== null && riskScore >= 75),
  };
}

export function validatePublicVideoUrl(
  rawUrl: string | null | undefined,
): VideoUrlValidationResult {
  if (!rawUrl || rawUrl.trim().length === 0) {
    return {
      valid: false,
      normalizedUrl: null,
      host: null,
      knownSocialPlatform: false,
      reason: "missing_video_url",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      valid: false,
      normalizedUrl: null,
      host: null,
      knownSocialPlatform: false,
      reason: "malformed_video_url",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      normalizedUrl: null,
      host: parsed.hostname || null,
      knownSocialPlatform: false,
      reason: "https_required",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || !host.includes(".") || isPrivateOrLoopbackHost(host)) {
    return {
      valid: false,
      normalizedUrl: null,
      host: host || null,
      knownSocialPlatform: false,
      reason: "private_or_invalid_host_blocked",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      normalizedUrl: null,
      host,
      knownSocialPlatform: false,
      reason: "credentials_in_url_forbidden",
    };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    host,
    knownSocialPlatform: KNOWN_SOCIAL_VIDEO_HOSTS.includes(host),
  };
}

export function evaluateTripleFtc(input: TripleFtcCheckInput): TripleFtcCheckResult {
  const missingSignals: string[] = [];
  if (!input.nativeCommercialToggle) missingSignals.push("missing_native_paid_partnership_toggle");
  if (!input.visualOverlayAdTag) missingSignals.push("missing_visual_ad_overlay");
  if (!input.spokenDisclosure) missingSignals.push("missing_spoken_ftc_disclosure");
  if (
    input.captionOrTranscript &&
    input.captionOrTranscript.trim().length > 0 &&
    !/(#ad\b|paid\s+partnership|sponsored\s+by)/i.test(input.captionOrTranscript)
  ) {
    missingSignals.push("transcript_missing_explicit_ad_or_sponsored_tag");
  }
  return {
    passed: missingSignals.length === 0,
    missingSignals,
  };
}

export function computeCappedCreatorBonusCents(input: {
  readonly viewsD14: number;
  readonly rateCentsPer1kViews: number;
  readonly verifiedNycAdultT2Joins: number;
  readonly maxBonusCents?: number;
}): number {
  const cap = Math.max(0, Math.floor(input.maxBonusCents ?? 30_000));
  const viewsPay = Math.floor(
    (Math.max(0, input.viewsD14) * Math.max(0, input.rateCentsPer1kViews)) / 1000,
  );
  const conversionCap = Math.max(0, Math.floor(input.verifiedNycAdultT2Joins)) * 1_000;
  return Math.max(0, Math.min(cap, viewsPay, conversionCap));
}

export function detectSybilCluster(
  claims: readonly SybilClaimNode[],
): SybilClusterScanResult {
  if (claims.length === 0) {
    return {
      clusters: [],
      quarantinedClaimIds: [],
      quarantinedPersonKeys: [],
      claimClusterMap: {},
    };
  }

  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < claims.length; i += 1) adj.set(i, new Set());

  const linkBucket = (bucket: Map<string, number[]>): void => {
    for (const indices of bucket.values()) {
      if (indices.length < 2) continue;
      for (let i = 0; i < indices.length; i += 1) {
        for (let j = i + 1; j < indices.length; j += 1) {
          const a = indices[i];
          const b = indices[j];
          if (a === undefined || b === undefined) continue;
          adj.get(a)?.add(b);
          adj.get(b)?.add(a);
        }
      }
    }
  };

  const byWorker = new Map<string, number[]>();
  const byMedia = new Map<string, number[]>();
  const bySubnet = new Map<string, number[]>();
  const byPayoutRef = new Map<string, number[]>();
  const byPerson = new Map<string, number[]>();

  const pushTo = (map: Map<string, number[]>, key: string | null | undefined, idx: number) => {
    const trimmed = key?.trim();
    if (!trimmed) return;
    const arr = map.get(trimmed);
    if (arr) arr.push(idx);
    else map.set(trimmed, [idx]);
  };

  for (let i = 0; i < claims.length; i += 1) {
    const c = claims[i];
    if (!c) continue;
    pushTo(byWorker, c.workerId, i);
    pushTo(byMedia, c.mediaHash, i);
    pushTo(bySubnet, c.subnetPrefix, i);
    pushTo(byPayoutRef, c.payoutAccountRef, i);
    pushTo(byPerson, c.personKey, i);
  }

  linkBucket(byWorker);
  linkBucket(byMedia);
  linkBucket(bySubnet);
  linkBucket(byPayoutRef);
  linkBucket(byPerson);

  for (let i = 0; i < claims.length; i += 1) {
    const c = claims[i];
    if (!c) continue;
    for (const targetKey of c.matchedPersonKeys ?? []) {
      const peers = byPerson.get(targetKey);
      if (!peers) continue;
      for (const peerIdx of peers) {
        if (peerIdx !== i) {
          adj.get(i)?.add(peerIdx);
          adj.get(peerIdx)?.add(i);
        }
      }
    }
  }

  const visited = new Set<number>();
  const clusters: DetectedSybilCluster[] = [];
  const quarantinedClaims = new Set<string>();
  const quarantinedPersons = new Set<string>();
  const claimClusterMap: Record<string, string> = {};

  for (let i = 0; i < claims.length; i += 1) {
    if (visited.has(i)) continue;
    const comp: number[] = [];
    const queue: number[] = [i];
    visited.add(i);
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      comp.push(cur);
      for (const nxt of adj.get(cur) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }

    const compClaims = comp
      .map((idx) => claims[idx])
      .filter((c): c is SybilClaimNode => c !== undefined);
    const uniquePersons = Array.from(new Set(compClaims.map((c) => c.personKey))).sort();
    const uniqueClaimIds = compClaims.map((c) => c.id).sort();
    const paidCount = compClaims.filter((c) => c.paidReferred).length;
    const paidShare = compClaims.length > 0 ? paidCount / compClaims.length : 0;
    const organicAnchorCount = compClaims.filter((c) => c.organicAnchorVerified === true).length;
    const organicConductance =
      compClaims.length > 0 ? organicAnchorCount / compClaims.length : 0;

    const mediaCounts = new Map<string, number>();
    for (const c of compClaims) {
      if (c.mediaHash) {
        mediaCounts.set(c.mediaHash, (mediaCounts.get(c.mediaHash) ?? 0) + 1);
      }
    }
    const mediaCollisions = Array.from(mediaCounts.values()).filter((n) => n >= 2).length;

    const payoutWorkers = new Map<string, Set<string>>();
    for (const c of compClaims) {
      if (c.payoutAccountRef && c.workerId) {
        const set = payoutWorkers.get(c.payoutAccountRef) ?? new Set<string>();
        set.add(c.workerId);
        payoutWorkers.set(c.payoutAccountRef, set);
      }
    }
    const sharedPayoutRefAcrossWorkers = Array.from(payoutWorkers.values()).some(
      (s) => s.size >= 2,
    );

    const reasons: string[] = [];
    if (uniquePersons.length >= 3 && paidShare > 0.5 && organicConductance < 0.35) {
      reasons.push(
        `high_density_low_conductance_ring (size=${uniquePersons.length}, paidShare=${paidShare.toFixed(2)}, organicConductance=${organicConductance.toFixed(2)})`,
      );
    }
    if (mediaCollisions > 0) {
      reasons.push(`duplicate_media_hash_collisions (${mediaCollisions})`);
    }
    if (sharedPayoutRefAcrossWorkers) {
      reasons.push("multiple_workers_sharing_payout_account");
    }

    if (reasons.length > 0) {
      const digest = createHash("sha256")
        .update(uniquePersons.join("|"))
        .digest("hex")
        .slice(0, 12);
      const clusterId = `sybil-${digest}`;
      clusters.push({
        clusterId,
        claimIds: uniqueClaimIds,
        personKeys: uniquePersons,
        size: uniquePersons.length,
        paidShare: Number(paidShare.toFixed(4)),
        organicConductance: Number(organicConductance.toFixed(4)),
        reasons,
      });
      for (const cid of uniqueClaimIds) {
        quarantinedClaims.add(cid);
        claimClusterMap[cid] = clusterId;
      }
      for (const pk of uniquePersons) {
        quarantinedPersons.add(pk);
      }
    }
  }

  return {
    clusters,
    quarantinedClaimIds: Array.from(quarantinedClaims).sort(),
    quarantinedPersonKeys: Array.from(quarantinedPersons).sort(),
    claimClusterMap,
  };
}

export class AntiFraudEngine {
  private readonly clock: Clock;

  constructor(opts?: { readonly clock?: Clock }) {
    this.clock = opts?.clock ?? new RealClock();
  }

  evaluateClaim(input: AntiFraudEvaluationInput): AntiFraudEvaluationResult {
    const nowMs = this.clock.now();
    const createdMs = Date.parse(input.createdAtIso);
    const effectiveCreatedMs = Number.isFinite(createdMs) ? createdMs : nowMs;
    const reasons: string[] = [];

    const isPrepaidOrMvno =
      input.phoneLineType === "prepaid" || input.phoneLineType === "mvno";
    const holdMs =
      input.vestingTier <= 1
        ? 0
        : input.vestingTier === 2
          ? input.trustedOperator && !isPrepaidOrMvno
            ? VESTING_HOLD_MS.tier2TrustedPostpaid
            : VESTING_HOLD_MS.tier2DefaultOrPrepaid
          : input.vestingTier === 3
            ? VESTING_HOLD_MS.tier3OrganicAnchor
            : 0;

    const unlockMs = effectiveCreatedMs + holdMs;
    const unlockAtIso = new Date(unlockMs).toISOString();
    const fifaPayByIso = new Date(nowMs + NY_FIFA_PAYOUT_SLA_MS).toISOString();

    const mediaDuplicate = Boolean(
      input.mediaHash && input.knownMediaHashes && input.knownMediaHashes.has(input.mediaHash),
    );
    const clusterQuarantined = Boolean(input.clusterQuarantined);

    if (input.requireVideoUrl || (input.videoUrl !== undefined && input.videoUrl !== null)) {
      const urlCheck = validatePublicVideoUrl(input.videoUrl);
      if (!urlCheck.valid) {
        reasons.push(urlCheck.reason ?? "invalid_video_url");
      }
    }

    if (input.requireTripleFtc && input.tripleFtc) {
      const ftcCheck = evaluateTripleFtc(input.tripleFtc);
      if (!ftcCheck.passed) {
        reasons.push(...ftcCheck.missingSignals);
      }
    } else if (input.requireTripleFtc && !input.tripleFtc) {
      reasons.push("missing_triple_ftc_check");
    }

    if (
      typeof input.qrScansCount === "number" &&
      typeof input.verifiedSignupsCount === "number" &&
      input.verifiedSignupsCount > input.qrScansCount
    ) {
      reasons.push(
        `qr_conversion_anomaly (signups=${input.verifiedSignupsCount} > scans=${input.qrScansCount})`,
      );
    }

    const policyDecision = evaluateAntiFraudPayout({
      tier: input.vestingTier,
      amountCents: input.amountCents,
      phoneLineType: input.phoneLineType,
      priorLifetimeCents: input.priorLifetimeCents,
      annualWorkerCents: input.annualWorkerCents,
      hasW9: input.hasW9,
      mediaDuplicate,
      clusterQuarantined,
    });

    if (!policyDecision.allowed && policyDecision.reason) {
      reasons.push(policyDecision.reason);
    }

    let status: AntiFraudClaimStatus = "approved";
    let adjudicationDueIso: string | null = null;

    if (
      input.phoneLineType === "voip" ||
      mediaDuplicate ||
      reasons.some((r) => r.startsWith("missing_video_url") || r.startsWith("private_or_invalid_host") || r.startsWith("https_required") || r.startsWith("prepaid_mvno_cap") || r.startsWith("lifetime_person_cap"))
    ) {
      status = "rejected";
    } else if (
      clusterQuarantined ||
      reasons.some((r) => r.startsWith("qr_conversion_anomaly") || r.startsWith("w9_required") || r.includes("ftc"))
    ) {
      status = "quarantined";
      adjudicationDueIso = new Date(nowMs + OP_Q_ADJUDICATION_SLA_MS).toISOString();
    } else if (input.vestingTier === 0) {
      status = "vesting";
      reasons.push("tier0_zero_instant_release");
    } else if (input.vestingTier === 2 && nowMs < unlockMs) {
      status = "vesting";
      reasons.push("tier2_vesting_hold_active");
    } else if (input.vestingTier === 3 && (!input.organicAnchorVerified || nowMs < unlockMs)) {
      status = "vesting";
      reasons.push(
        !input.organicAnchorVerified
          ? "organic_anchor_verification_required"
          : "tier3_48h_hold_active",
      );
    } else if (!policyDecision.allowed) {
      status = "rejected";
    }

    const maxAllowedByCarrier = isPrepaidOrMvno
      ? mvnoBonusCapCents
      : input.vestingTier < 4
        ? Math.max(0, consumerLifetimeBonusCapCents - input.priorLifetimeCents)
        : input.amountCents;

    const allowed = status === "approved" && reasons.length === 0;
    const payableCents = allowed ? Math.min(input.amountCents, maxAllowedByCarrier) : 0;

    return {
      status,
      allowed,
      payableCents,
      reasons,
      unlockAtIso,
      fifaPayByIso,
      adjudicationDueIso,
      claim: {
        campaignId: input.campaignId,
        personKey: input.personKey,
        workerId: input.workerId,
        taskId: input.taskId,
        phoneLineType: input.phoneLineType,
        mediaHash: input.mediaHash ?? null,
        clusterId: input.clusterId ?? null,
        vestingTier: input.vestingTier,
        amountCents: input.amountCents,
        status,
        reason: reasons.length > 0 ? reasons.join("; ") : null,
        createdAt: input.createdAtIso,
      },
    };
  }
}

export {
  consumerLifetimeBonusCapCents,
  mvnoBonusCapCents,
  w9AnnualThresholdCents,
};
