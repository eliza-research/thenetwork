import { createHmac, timingSafeEqual } from "node:crypto";
import { RealClock, type Clock } from "../../../packages/core/src/clock.ts";
import {
  AimdController,
  type AimdSnapshot,
} from "../../../packages/core/src/pacing/aimd.ts";
import {
  MultiSignalCircuitBreaker,
  type BreakerSnapshot,
} from "../../../packages/core/src/pacing/breaker.ts";
import {
  SuppressionSync,
  TemplateEntropyGuard,
  evaluateComplianceGate,
  lintComplianceCopy,
  type ComplianceGateDecision,
  type ComplianceMode,
  type CopyLintInput,
  type CopyLintResult,
  type EntropyCheckResult,
  type RuntimeEnvironment,
  type VersionedHashKey,
} from "../../../packages/core/src/pacing/compliance.ts";
import {
  HierarchicalGcraLimiter,
  buildHierarchySpecs,
  type GcraDecision,
} from "../../../packages/core/src/pacing/gcra.ts";
import type { OperatorAuditEntry } from "./types.ts";

export const ALL_COMPLIANCE_MODES: readonly ComplianceMode[] = [
  "official_api_opt_in",
  "inbound_qr_deeplink",
  "public_open_data",
  "paid_ads_api",
  "human_copilot_draft",
  "us_b2b_commercial_email",
  "creator_sponsored_outreach",
  "device_farm_social_automation",
  "unauthenticated_scraping",
  "cold_sms_without_pewc",
  "consumer_cli_subscription",
  "undisclosed_ai_persona",
  "cross_app_score_bleed",
];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DEFAULT_POSTAL_ADDRESS = "The Network Ops, 228 Park Ave S Suite 49120, New York, NY 10003";
const DEFAULT_UNSUBSCRIBE_BASE = "https://ops.ntwrk.party";
const DEFAULT_UNSUBSCRIBE_TTL_MS = 30 * 86_400_000;

export function resolveRuntimeEnvironment(
  env: Record<string, string | undefined> = process.env,
): RuntimeEnvironment {
  const raw = (env.MARKETING_ENV ?? env.NODE_ENV ?? "dev").trim().toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "staging" || raw === "stage") return "staging";
  if (raw === "test") return "test";
  return "dev";
}

export function isLoopbackHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function resolveMockBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (isDeployedEnvironment(env)) return null;
  const raw = env.MARKETING_MOCK_BASE_URL?.trim();
  if (!raw) return null;
  const normalized = raw.replace(/\/+$/, "");
  return isLoopbackHttpUrl(normalized) ? normalized : null;
}

export function isDeployedEnvironment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const runtime = resolveRuntimeEnvironment(env);
  return runtime === "staging" || runtime === "production";
}

export interface ComplianceStatusSnapshot {
  readonly env: RuntimeEnvironment;
  readonly liveBillingEnabled: boolean;
  readonly mockModeActive: boolean;
  readonly mockBaseUrl: string | null;
  readonly gates: Record<ComplianceMode, ComplianceGateDecision>;
  readonly breakers: Record<string, BreakerSnapshot>;
  readonly aimd: Record<string, AimdSnapshot>;
  readonly auditRecent: OperatorAuditEntry[];
}

export interface UnsubscribeTokenPayload {
  readonly contactKey: string;
  readonly channel: string;
  readonly issuedAtMs: number;
}

export interface MarketingComplianceRuntimeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly clock?: Clock;
  readonly signingSecret?: string;
  readonly postalAddress?: string;
  readonly publicBaseUrl?: string;
}

export class MarketingComplianceRuntime {
  readonly env: Record<string, string | undefined>;
  readonly clock: Clock;
  readonly runtimeEnv: RuntimeEnvironment;
  readonly limiter: HierarchicalGcraLimiter;
  readonly entropyGuard: TemplateEntropyGuard;
  readonly suppression: SuppressionSync;

  private readonly signingSecret: string;
  private readonly postalAddress: string;
  private readonly publicBaseUrl: string;
  private readonly aimdByProvider = new Map<string, AimdController>();
  private readonly breakers = new Map<string, MultiSignalCircuitBreaker>();

  constructor(opts: MarketingComplianceRuntimeOptions = {}) {
    this.env = opts.env ?? process.env;
    this.clock = opts.clock ?? new RealClock();
    this.runtimeEnv = resolveRuntimeEnvironment(this.env);
    const configuredSecret =
      opts.signingSecret?.trim() ||
      this.env.MARKETING_UNSUBSCRIBE_SECRET?.trim() ||
      this.env.PLATFORM_HASH_KEY?.trim() ||
      this.env.MARKETING_TOKEN?.trim() ||
      "";
    if (!configuredSecret && isDeployedEnvironment(this.env)) {
      throw new Error(
        "MARKETING_UNSUBSCRIBE_SECRET or PLATFORM_HASH_KEY must be configured in staging/production.",
      );
    }
    this.signingSecret = configuredSecret || "marketing-dev-unsubscribe-secret";
    this.postalAddress =
      opts.postalAddress?.trim() ||
      this.env.MARKETING_POSTAL_ADDRESS?.trim() ||
      DEFAULT_POSTAL_ADDRESS;
    this.publicBaseUrl = (
      opts.publicBaseUrl?.trim() ||
      this.env.MARKETING_OPS_BASE_URL?.trim() ||
      DEFAULT_UNSUBSCRIBE_BASE
    ).replace(/\/+$/, "");

    this.limiter = new HierarchicalGcraLimiter({ clock: this.clock });
    this.entropyGuard = new TemplateEntropyGuard({
      clock: this.clock,
      windowMs: 86_400_000,
      maxHammingDistance: 3,
      maxNearDuplicates: 25,
    });

    const hashKeys: VersionedHashKey[] = [
      {
        version: "v1",
        secret: this.env.PLATFORM_HASH_KEY?.trim() || this.signingSecret,
      },
    ];
    if (this.env.PLATFORM_HASH_KEY_PREV?.trim()) {
      hashKeys.push({
        version: "v0",
        secret: this.env.PLATFORM_HASH_KEY_PREV.trim(),
      });
    }
    this.suppression = new SuppressionSync({
      clock: this.clock,
      keys: hashKeys,
    });
  }

  evaluateGate(
    mode: ComplianceMode,
    opts?: {
      hasRecordedConsent?: boolean;
      hasHitlApproval?: boolean;
      recipientCountry?: string;
      recipientIsMinor?: boolean;
      officialApiApproved?: boolean;
      allowAmberInProd?: boolean;
    },
  ): ComplianceGateDecision {
    return evaluateComplianceGate({
      mode,
      env: this.runtimeEnv,
      hasRecordedConsent: opts?.hasRecordedConsent,
      hasHitlApproval: opts?.hasHitlApproval,
      recipientCountry: opts?.recipientCountry,
      recipientIsMinor: opts?.recipientIsMinor,
      officialApiApproved: opts?.officialApiApproved,
      allowAmberInProd: opts?.allowAmberInProd,
    });
  }

  getAllGates(): Record<ComplianceMode, ComplianceGateDecision> {
    const out = {} as Record<ComplianceMode, ComplianceGateDecision>;
    for (const mode of ALL_COMPLIANCE_MODES) {
      out[mode] = evaluateComplianceGate({
        mode,
        env: this.runtimeEnv,
        hasRecordedConsent: true,
        hasHitlApproval: mode === "us_b2b_commercial_email" || mode === "creator_sponsored_outreach",
        officialApiApproved: true,
      });
    }
    return out;
  }

  getAimd(provider: string): AimdController {
    const key = provider.trim().toLowerCase() || "default";
    let controller = this.aimdByProvider.get(key);
    if (!controller) {
      controller = new AimdController({
        clock: this.clock,
        config: {
          minConcurrency: 1,
          maxConcurrency: 12,
          initialConcurrency: 4,
          additiveStep: 1,
          decreaseFactor: 0.5,
          healthyWindow: 8,
          baselineLatencyMs: 1200,
        },
      });
      this.aimdByProvider.set(key, controller);
    }
    return controller;
  }

  getBreaker(scope: string): MultiSignalCircuitBreaker {
    const key = scope.trim().toLowerCase() || "global";
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new MultiSignalCircuitBreaker({
        clock: this.clock,
        scopeKey: key,
      });
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  resetBreaker(scope: string): BreakerSnapshot {
    return this.getBreaker(scope).reset();
  }

  checkRateBudget(opts: {
    provider: string;
    accountId?: string;
    campaignId?: string;
    recipientKey?: string;
    platformLimit?: number;
    platformWindowMs?: number;
    accountLimit?: number;
    accountWindowMs?: number;
  }): GcraDecision {
    const specs = buildHierarchySpecs({
      org: { key: "marketing", limit: 1200, windowMs: 60_000, burst: 60 },
      platform: {
        key: opts.provider,
        limit: opts.platformLimit ?? 180,
        windowMs: opts.platformWindowMs ?? 60_000,
        burst: 15,
      },
      ...(opts.accountId
        ? {
            account: {
              key: opts.accountId,
              limit: opts.accountLimit ?? 40,
              windowMs: opts.accountWindowMs ?? 60_000,
              burst: 5,
            },
          }
        : {}),
      ...(opts.campaignId
        ? {
            campaign: {
              key: opts.campaignId,
              limit: 300,
              windowMs: 60_000,
              burst: 20,
            },
          }
        : {}),
      ...(opts.recipientKey
        ? {
            recipient: {
              key: opts.recipientKey,
              limit: 2,
              windowMs: 86_400_000,
              burst: 0,
            },
          }
        : {}),
    });
    return this.limiter.evaluate(specs);
  }

  checkRouteRateLimit(routeKey: string, limit: number, windowMs: number, burst = 4): GcraDecision {
    return this.limiter.evaluate([
      {
        level: "platform",
        key: `route:${routeKey}`,
        limit,
        windowMs,
        burst,
      },
    ]);
  }

  recordHttpOutcome(
    provider: string,
    outcome: {
      ok: boolean;
      status?: number;
      latencyMs?: number;
      retryAfterHeader?: string | null;
      rateLimitRemaining?: number;
      rateLimitLimit?: number;
      hardBounce?: boolean;
      spamComplaint?: boolean;
      stopped?: boolean;
    },
  ): { aimd: AimdSnapshot; breaker: BreakerSnapshot } {
    const aimd = this.getAimd(provider).record({
      ok: outcome.ok,
      status: outcome.status,
      latencyMs: outcome.latencyMs,
      retryAfterHeader: outcome.retryAfterHeader,
      rateLimitRemaining: outcome.rateLimitRemaining,
      rateLimitLimit: outcome.rateLimitLimit,
    });
    const breaker = this.getBreaker(provider).recordDelivery({
      ok: outcome.ok,
      status: outcome.status,
      hardBounce: outcome.hardBounce,
      spamComplaint: outcome.spamComplaint,
      stopped: outcome.stopped,
    });
    return { aimd, breaker };
  }

  lintCopy(input: CopyLintInput): CopyLintResult {
    return lintComplianceCopy(input);
  }

  checkTemplateEntropy(scopeKey: string, text: string): EntropyCheckResult {
    return this.entropyGuard.checkAndRecord(scopeKey, text);
  }

  signUnsubscribeToken(contactKey: string, channel: string): string {
    const payload: UnsubscribeTokenPayload = {
      contactKey: contactKey.trim(),
      channel: channel.trim().toLowerCase() || "email",
      issuedAtMs: this.clock.now(),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.signingSecret).update(encoded).digest("base64url");
    return `${encoded}.${sig}`;
  }

  verifyUnsubscribeToken(
    token: string,
  ): { ok: true; payload: UnsubscribeTokenPayload } | { ok: false; reason: string } {
    const trimmed = token.trim();
    const dot = trimmed.indexOf(".");
    if (dot <= 0 || dot >= trimmed.length - 1) {
      return { ok: false, reason: "malformed_unsubscribe_token" };
    }
    const encoded = trimmed.slice(0, dot);
    const sig = trimmed.slice(dot + 1);
    const expected = createHmac("sha256", this.signingSecret).update(encoded).digest("base64url");
    const sigBuf = Buffer.from(sig, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { ok: false, reason: "invalid_unsubscribe_signature" };
    }
    try {
      const parsed = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<UnsubscribeTokenPayload>;
      if (
        typeof parsed.contactKey !== "string" ||
        !parsed.contactKey.trim() ||
        typeof parsed.channel !== "string" ||
        typeof parsed.issuedAtMs !== "number" ||
        !Number.isFinite(parsed.issuedAtMs)
      ) {
        return { ok: false, reason: "invalid_unsubscribe_payload" };
      }
      if (this.clock.now() - parsed.issuedAtMs > DEFAULT_UNSUBSCRIBE_TTL_MS) {
        return { ok: false, reason: "expired_unsubscribe_token" };
      }
      return {
        ok: true,
        payload: {
          contactKey: parsed.contactKey.trim(),
          channel: parsed.channel.trim().toLowerCase() || "email",
          issuedAtMs: parsed.issuedAtMs,
        },
      };
    } catch {
      return { ok: false, reason: "unparseable_unsubscribe_payload" };
    }
  }

  buildCanSpamEmailEnvelope(contactKey: string, channel = "email"): {
    headers: Record<string, string>;
    unsubscribeUrl: string;
    footerText: string;
  } {
    const token = this.signUnsubscribeToken(contactKey, channel);
    const unsubscribeUrl = `${this.publicBaseUrl}/api/unsubscribe?token=${encodeURIComponent(token)}`;
    const headers: Record<string, string> = {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
    const footerText = [
      "---",
      "Sent by The Network's AI assistant on behalf of The Network.",
      this.postalAddress,
      `Unsubscribe instantly: ${unsubscribeUrl} or reply STOP.`,
    ].join("\n");
    return { headers, unsubscribeUrl, footerText };
  }

  getBreakerSnapshots(): Record<string, BreakerSnapshot> {
    const out: Record<string, BreakerSnapshot> = {};
    for (const [k, b] of this.breakers.entries()) {
      out[k] = b.snapshot();
    }
    return out;
  }

  getAimdSnapshots(): Record<string, AimdSnapshot> {
    const out: Record<string, AimdSnapshot> = {};
    for (const [k, a] of this.aimdByProvider.entries()) {
      out[k] = a.snapshot();
    }
    return out;
  }

  getComplianceSnapshot(auditRecent: OperatorAuditEntry[] = []): ComplianceStatusSnapshot {
    const mockBaseUrl = resolveMockBaseUrl(this.env);
    return {
      env: this.runtimeEnv,
      liveBillingEnabled: this.env.MARKETING_LIVE_BILLING === "1",
      mockModeActive: mockBaseUrl !== null,
      mockBaseUrl,
      gates: this.getAllGates(),
      breakers: this.getBreakerSnapshots(),
      aimd: this.getAimdSnapshots(),
      auditRecent,
    };
  }
}
