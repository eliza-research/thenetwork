import { createHash } from "node:crypto";
import { RealClock } from "../../../packages/core/src/clock.ts";
import { getCityConfig } from "./cities.ts";
import {
  RENTAHUMAN_BUYER_FEE_RATE,
  RENTAHUMAN_MCP_ENDPOINT,
} from "./constants.ts";
import { evaluateBdDealBounds } from "./policy.ts";
import type {
  AppId,
  BdDeal,
  BdDealStage,
  Clock,
  QrBatch,
  QrBatchAssigneeType,
} from "./types.ts";

export const BD_PIPELINE_STAGES: readonly BdDealStage[] = [
  "prospect",
  "enriched",
  "pitched",
  "negotiating",
  "contracted",
  "kit_shipped",
  "live",
  "audited",
  "closed_lost",
] as const;

export const DEFAULT_MAX_VENUE_OFFER_CENTS = 25_000;
export const CONTRACT_RETENTION_YEARS = 6;
export const MYSTERY_AUDIT_DELAY_DAYS = 14;
export const DEFAULT_MYSTERY_AUDIT_PAYOUT_CENTS = 2_000;

export type BdContractKind =
  | "venue_placement"
  | "event_host_afterparty"
  | "nyll_191d_contractor";

export interface BdClickwrapContract {
  readonly dealId: string;
  readonly kind: BdContractKind;
  readonly city: string;
  readonly version: string;
  readonly text: string;
  readonly contractHash: string;
  readonly generatedAtIso: string;
  readonly retainUntilIso: string;
  readonly payoutSlaDays: number;
}

export interface DtmfCallbackChallenge {
  readonly dealId: string;
  readonly businessPhone: string;
  readonly pinHash: string;
  readonly issuedAtIso: string;
  readonly expiresAtIso: string;
  readonly callbackWindowNote: string;
}

export interface QrBatchPlan {
  readonly batchCode: string;
  readonly destinationUrl: string;
  readonly shortUrlPreview: string;
  readonly dubPatchPayload: {
    readonly endpoint: string;
    readonly method: "PATCH";
    readonly body: {
      readonly url: string;
      readonly externalId: string;
      readonly tagNames: readonly string[];
    };
  };
}

export interface Day14MysteryAuditPayload {
  readonly dealId: string;
  readonly venueName: string;
  readonly city: string;
  readonly auditDueAtIso: string;
  readonly endpoint: string;
  readonly tool: "create_bounty";
  readonly params: {
    readonly title: string;
    readonly city: string;
    readonly payoutUsd: number;
    readonly buyerFeeUsd: number;
    readonly totalEscrowUsd: number;
    readonly description: string;
    readonly requiredProofs: readonly string[];
  };
}

export interface BdStageTransitionResult {
  readonly allowed: boolean;
  readonly deal: BdDeal;
  readonly reason?: string;
}

const ALLOWED_BD_TRANSITIONS: Readonly<Record<BdDealStage, readonly BdDealStage[]>> = {
  prospect: ["enriched", "closed_lost"],
  enriched: ["pitched", "closed_lost"],
  pitched: ["negotiating", "closed_lost"],
  negotiating: ["contracted", "closed_lost"],
  contracted: ["kit_shipped", "live", "closed_lost"],
  kit_shipped: ["live", "audited", "closed_lost"],
  live: ["audited", "closed_lost"],
  audited: ["closed_lost"],
  closed_lost: [],
};

const APP_SHORT_DOMAINS: Record<AppId, string> = {
  slop: "go.slop.date",
  peon: "go.peon.biz",
  friends: "go.friends.help",
  ntwrk: "go.ntwrk.party",
  all: "go.ntwrk.party",
};

function addUtcYears(isoMs: number, years: number): string {
  const d = new Date(isoMs);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sanitizeBatchSegment(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
}

export class BdPipelineEngine {
  private readonly clock: Clock;
  private readonly maxVenueOfferCents: number;

  constructor(opts?: { readonly clock?: Clock; readonly maxVenueOfferCents?: number }) {
    this.clock = opts?.clock ?? new RealClock();
    this.maxVenueOfferCents = opts?.maxVenueOfferCents ?? DEFAULT_MAX_VENUE_OFFER_CENTS;
  }

  evaluateBounds(
    deal: Pick<BdDeal, "offeredCents" | "phoneCallbackVerified" | "contractHash">,
    maxVenueCents = this.maxVenueOfferCents,
  ): { readonly allowed: boolean; readonly reason?: string } {
    return evaluateBdDealBounds({
      offeredCents: deal.offeredCents,
      maxVenueCents,
      hasPhoneCallback: deal.phoneCallbackVerified,
      contractSigned: Boolean(deal.contractHash && deal.contractHash.trim().length >= 16),
    });
  }

  transitionStage(
    deal: BdDeal,
    nextStage: BdDealStage,
    opts?: { readonly maxVenueCents?: number; readonly notes?: string | null },
  ): BdStageTransitionResult {
    const allowedNext = ALLOWED_BD_TRANSITIONS[deal.stage];
    if (!allowedNext.includes(nextStage)) {
      return {
        allowed: false,
        deal,
        reason: `illegal_bd_transition_${deal.stage}_to_${nextStage}`,
      };
    }

    if (nextStage === "contracted" || nextStage === "kit_shipped" || nextStage === "live") {
      const bounds = this.evaluateBounds(deal, opts?.maxVenueCents ?? this.maxVenueOfferCents);
      if (!bounds.allowed) {
        return {
          allowed: false,
          deal,
          reason: bounds.reason ?? "bd_deal_out_of_bounds",
        };
      }
    }

    if (nextStage === "kit_shipped" && !deal.qrBatchId) {
      return {
        allowed: false,
        deal,
        reason: "qr_batch_required_before_kit_shipped",
      };
    }

    const nowIso = new Date(this.clock.now()).toISOString();
    return {
      allowed: true,
      deal: {
        ...deal,
        stage: nextStage,
        notes: opts?.notes !== undefined ? opts.notes : deal.notes,
        updatedAt: nowIso,
      },
    };
  }

  createDtmfCallbackChallenge(
    dealId: string,
    businessPhone: string,
    signingSecret: string,
    ttlMinutes = 15,
  ): { readonly challenge: DtmfCallbackChallenge; readonly expectedPin: string } {
    const cleanPhone = businessPhone.trim();
    if (!/^\+?[1-9]\d{7,14}$/.test(cleanPhone.replace(/[\s()-]/g, ""))) {
      throw new Error("Valid E.164 or numeric business phone is required for DTMF callback.");
    }
    const nowMs = this.clock.now();
    const issuedAtIso = new Date(nowMs).toISOString();
    const expiresAtIso = new Date(nowMs + Math.max(1, ttlMinutes) * 60_000).toISOString();
    const digest = sha256Hex(`${signingSecret}:${dealId}:${cleanPhone}:${issuedAtIso}`);
    const numeric = Number.parseInt(digest.slice(0, 8), 16) % 10_000;
    const expectedPin = String(numeric).padStart(4, "0");
    const pinHash = sha256Hex(`${dealId}:${expectedPin}`);

    return {
      expectedPin,
      challenge: {
        dealId,
        businessPhone: cleanPhone,
        pinHash,
        issuedAtIso,
        expiresAtIso,
        callbackWindowNote:
          "15-second automated Twilio SIP verification to public Google Maps business landline (14:00-16:15 local pre-service window only).",
      },
    };
  }

  verifyDtmfPin(
    challenge: DtmfCallbackChallenge,
    submittedPin: string,
  ): { readonly verified: boolean; readonly reason?: string } {
    const nowMs = this.clock.now();
    const expMs = Date.parse(challenge.expiresAtIso);
    if (!Number.isFinite(expMs) || nowMs > expMs) {
      return { verified: false, reason: "dtmf_challenge_expired" };
    }
    const normalized = submittedPin.trim();
    if (!/^\d{4}$/.test(normalized)) {
      return { verified: false, reason: "invalid_dtmf_pin_format" };
    }
    const candidateHash = sha256Hex(`${challenge.dealId}:${normalized}`);
    if (candidateHash !== challenge.pinHash) {
      return { verified: false, reason: "dtmf_pin_mismatch" };
    }
    return { verified: true };
  }

  generateClickwrapContract(
    deal: Pick<BdDeal, "id" | "city" | "venueName" | "vertical" | "offeredCents">,
    kind: BdContractKind,
  ): BdClickwrapContract {
    const cityCfg = getCityConfig(deal.city);
    const nowMs = this.clock.now();
    const generatedAtIso = new Date(nowMs).toISOString();
    const retainUntilIso = addUtcYears(nowMs, CONTRACT_RETENTION_YEARS);
    const offeredUsd = (deal.offeredCents / 100).toFixed(2);
    const version = "2026.11-v2";

    const scopeLine =
      kind === "venue_placement"
        ? `Partner venue "${deal.venueName}" authorizes tabletop/coaster placement of serialized Turnstile-gated QR materials for ${deal.vertical} (${cityCfg.label}). Zero raw phone numbers printed; zero exterior posting.`
        : kind === "event_host_afterparty"
          ? `Event host "${deal.venueName}" authorizes post-event double-opt-in guest matching via Turnstile-gated QR signage (${cityCfg.label}) strictly for consenting 18+ attendees.`
          : `Independent contractor engagement for "${deal.venueName}" under ${cityCfg.legal.freelanceStatute}`;

    const text = [
      `THE NETWORK — CLICKWRAP PARTNER AGREEMENT (${version})`,
      `Deal ID: ${deal.id}`,
      `Kind: ${kind}`,
      `Partner: ${deal.venueName}`,
      `City: ${cityCfg.label} (${cityCfg.code})`,
      `Vertical: ${deal.vertical}`,
      `Authorized Offer Cap: $${offeredUsd} ${cityCfg.currency}`,
      `Generated At: ${generatedAtIso}`,
      `Mandatory Archive Retention Until: ${retainUntilIso} (${CONTRACT_RETENTION_YEARS} years)`,
      "",
      "1. SCOPE & VERIFICATION:",
      scopeLine,
      "",
      "2. AGE FLOOR & CONSENT:",
      "Strictly 18+ verified adult participation for all paid placements, events, and promotional bonuses. Global STOP opt-outs apply immediately.",
      "",
      "3. STATUTORY & PAYMENT TERMS:",
      cityCfg.legal.freelanceStatute,
      cityCfg.legal.antiPostingRule,
      cityCfg.legal.disclosureAuthority,
      `Payment Due SLA: Within ${cityCfg.legal.payoutSlaDays} days of verified outcome proof (no upfront unverified cash release).`,
    ].join("\n");

    return {
      dealId: deal.id,
      kind,
      city: cityCfg.code,
      version,
      text,
      contractHash: sha256Hex(text),
      generatedAtIso,
      retainUntilIso,
      payoutSlaDays: cityCfg.legal.payoutSlaDays,
    };
  }

  buildQrBatchPlan(input: {
    readonly deal: Pick<BdDeal, "id" | "city" | "venueName" | "vertical">;
    readonly prefix?: "COAST" | "EVT" | "FLIER" | "SLEEVE";
    readonly sequenceNumber: number;
    readonly dubLinkId?: string | null;
  }): QrBatchPlan {
    const cityCode = getCityConfig(input.deal.city).code.toUpperCase();
    const prefix = input.prefix ?? "COAST";
    const venueSlug = sanitizeBatchSegment(input.deal.venueName) || "PARTNER";
    const seq = String(Math.max(1, Math.floor(input.sequenceNumber))).padStart(3, "0");
    const batchCode = `${prefix}-${cityCode}-${venueSlug}-${seq}`;
    const shortDomain = APP_SHORT_DOMAINS[input.deal.vertical];
    const destinationUrl = `https://${shortDomain}/j/${encodeURIComponent(batchCode)}?deal=${encodeURIComponent(input.deal.id)}`;
    const linkId = input.dubLinkId?.trim() || batchCode;

    return {
      batchCode,
      destinationUrl,
      shortUrlPreview: `https://${shortDomain}/${batchCode}`,
      dubPatchPayload: {
        endpoint: `https://api.dub.co/links/${encodeURIComponent(linkId)}`,
        method: "PATCH",
        body: {
          url: destinationUrl,
          externalId: `bd:${input.deal.id}:${batchCode}`,
          tagNames: [cityCode.toLowerCase(), input.deal.vertical, prefix.toLowerCase()],
        },
      },
    };
  }

  bindQrBatchRecord(
    batch: QrBatch,
    assigneeType: QrBatchAssigneeType,
    assigneeId: string,
    destinationUrl: string,
    dubLinkId?: string | null,
  ): QrBatch {
    return {
      ...batch,
      assignedToType: assigneeType,
      assignedToId: assigneeId,
      destinationUrl,
      dubLinkId: dubLinkId !== undefined ? dubLinkId : batch.dubLinkId,
    };
  }

  buildDay14MysteryAuditPayload(
    deal: Pick<BdDeal, "id" | "city" | "venueName" | "qrBatchId">,
    shippedAtIso: string,
    workerPayoutCents = DEFAULT_MYSTERY_AUDIT_PAYOUT_CENTS,
  ): Day14MysteryAuditPayload {
    const cityCfg = getCityConfig(deal.city);
    const shippedMs = Date.parse(shippedAtIso);
    const baseMs = Number.isFinite(shippedMs) ? shippedMs : this.clock.now();
    const auditDueAtIso = new Date(
      baseMs + MYSTERY_AUDIT_DELAY_DAYS * 86_400_000,
    ).toISOString();

    const safePayoutCents = Math.max(100, Math.floor(workerPayoutCents));
    const buyerFeeCents = Math.round(safePayoutCents * RENTAHUMAN_BUYER_FEE_RATE);
    const totalEscrowCents = safePayoutCents + buyerFeeCents;

    return {
      dealId: deal.id,
      venueName: deal.venueName,
      city: cityCfg.code,
      auditDueAtIso,
      endpoint: RENTAHUMAN_MCP_ENDPOINT,
      tool: "create_bounty",
      params: {
        title: `Day-14 Venue Placement Audit — ${deal.venueName} (${cityCfg.label})`,
        city: cityCfg.label,
        payoutUsd: Number((safePayoutCents / 100).toFixed(2)),
        buyerFeeUsd: Number((buyerFeeCents / 100).toFixed(2)),
        totalEscrowUsd: Number((totalEscrowCents / 100).toFixed(2)),
        description: [
          `Visit public commercial venue "${deal.venueName}" (${cityCfg.label}) on or after ${auditDueAtIso.slice(0, 10)}.`,
          `Verify serialized QR coasters or tabletop cards (Batch ${deal.qrBatchId ?? "assigned"}) are visibly placed for 18+ guests.`,
          "Do not disrupt staff or photograph private patrons without consent. 18+ auditors only.",
        ].join(" "),
        requiredProofs: [
          "1 timestamped exterior storefront photo confirming venue location",
          "1 timestamped interior tabletop/coaster photo showing readable batch QR code",
          "Short status note confirming whether staff knew about the placement",
        ],
      },
    };
  }
}
