import { RealClock, type Clock } from "../../../../packages/core/src/clock.ts";
import { canAuthorizeSpend } from "../../../../packages/core/src/generated/marketingPolicy.ts";
import {
  MarketingComplianceRuntime,
  resolveMockBaseUrl,
} from "../compliance-runtime.ts";
import type { FetchFn } from "../types.ts";
import type { SpendAuthInput } from "./paid.ts";

export type AdPlatform = "meta_ads" | "google_ads" | "tiktok_ads";

export interface AdCampaignLaunchInput {
  readonly platform: AdPlatform;
  readonly campaignName: string;
  readonly city: string;
  readonly objective: string;
  readonly dailyBudgetCents: number;
  readonly destinationUrl: string;
  readonly adCopy: string;
  readonly accountId?: string;
  readonly idempotencyKey: string;
  readonly spend: SpendAuthInput;
}

export interface AdConversionEventInput {
  readonly platform: AdPlatform;
  readonly eventName: string;
  readonly valueCents: number;
  readonly eventId: string;
  readonly contactHash?: string;
  readonly accountId?: string;
}

export interface AdAdapterReceipt {
  readonly ok: boolean;
  readonly platform: AdPlatform;
  readonly mode: "live" | "mock_http" | "dry_run" | "blocked_policy" | "rate_limited";
  readonly status: number;
  readonly externalRef: string | null;
  readonly reason: string;
  readonly data: Record<string, unknown> | null;
  readonly executedAt: string;
}

export interface AdAdapterRegistryOptions {
  readonly env?: Record<string, string | undefined>;
  readonly fetchFn?: FetchFn;
  readonly clock?: Clock;
  readonly compliance?: MarketingComplianceRuntime;
  readonly endpointOverrides?: Partial<Record<AdPlatform, string>>;
}

const DEFAULT_HTTP_TIMEOUT_MS = 12_000;

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { raw: text.slice(0, 512) };
  } catch {
    return { raw: text.slice(0, 512) };
  }
}

export class AdAdapterRegistry {
  private readonly env: Record<string, string | undefined>;
  private readonly fetchFn: FetchFn;
  private readonly clock: Clock;
  private readonly compliance: MarketingComplianceRuntime;
  private readonly endpointOverrides: Partial<Record<AdPlatform, string>>;

  constructor(opts: AdAdapterRegistryOptions = {}) {
    this.env = opts.env ?? process.env;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.clock = opts.clock ?? new RealClock();
    this.compliance =
      opts.compliance ?? new MarketingComplianceRuntime({ env: this.env, clock: this.clock });
    this.endpointOverrides = opts.endpointOverrides ?? {};
  }

  private resolveEndpoints(platform: AdPlatform, accountId?: string): {
    campaignUrl: string;
    eventUrl: string;
    token: string | null;
    mockMode: boolean;
  } {
    const acct = encodeURIComponent(accountId ?? "act_default");
    const override = this.endpointOverrides[platform];
    if (override) {
      return { campaignUrl: override, eventUrl: override, token: "mock-ad-token", mockMode: true };
    }
    const mockBase = resolveMockBaseUrl(this.env);
    if (mockBase) {
      if (platform === "meta_ads") {
        const metaAcct = acct.startsWith("act_") ? acct : `act_${acct}`;
        return {
          campaignUrl: `${mockBase}/ads/meta/v21.0/${metaAcct}/campaigns`,
          eventUrl: `${mockBase}/ads/meta/v21.0/${metaAcct}/events`,
          token: "mock-meta-token",
          mockMode: true,
        };
      }
      if (platform === "google_ads") {
        return {
          campaignUrl: `${mockBase}/ads/google/v18/customers/${acct}/campaigns:mutate`,
          eventUrl: `${mockBase}/ads/google/v18/customers/${acct}:uploadClickConversions`,
          token: "mock-google-token",
          mockMode: true,
        };
      }
      return {
        campaignUrl: `${mockBase}/ads/tiktok/open_api/v1.3/campaign/create`,
        eventUrl: `${mockBase}/ads/tiktok/open_api/v1.3/event/track`,
        token: "mock-tiktok-token",
        mockMode: true,
      };
    }
    if (platform === "meta_ads") {
      return {
        campaignUrl: `https://graph.facebook.com/v20.0/${acct}/campaigns`,
        eventUrl: `https://graph.facebook.com/v20.0/${acct}/events`,
        token: this.env.META_ADS_ACCESS_TOKEN?.trim() || null,
        mockMode: false,
      };
    }
    if (platform === "google_ads") {
      return {
        campaignUrl: `https://googleads.googleapis.com/v18/customers/${acct}/campaigns:mutate`,
        eventUrl: `https://googleads.googleapis.com/v18/customers/${acct}/googleAds:search`,
        token: this.env.GOOGLE_ADS_ACCESS_TOKEN?.trim() || null,
        mockMode: false,
      };
    }
    return {
      campaignUrl: "https://business-api.tiktok.com/open_api/v1.3/campaign/create/",
      eventUrl: "https://business-api.tiktok.com/open_api/v1.3/event/track/",
      token: this.env.TIKTOK_ADS_ACCESS_TOKEN?.trim() || null,
      mockMode: false,
    };
  }

  getStatus(): Array<{ platform: AdPlatform; configured: boolean; mockMode: boolean; campaignUrl: string }> {
    const platforms: AdPlatform[] = ["meta_ads", "google_ads", "tiktok_ads"];
    return platforms.map((platform) => {
      const resolved = this.resolveEndpoints(platform);
      const configured =
        resolved.mockMode ||
        (resolved.token !== null && this.env.MARKETING_LIVE_BILLING === "1");
      return { platform, configured, mockMode: resolved.mockMode, campaignUrl: resolved.campaignUrl };
    });
  }

  async launchCampaign(input: AdCampaignLaunchInput): Promise<AdAdapterReceipt> {
    const executedAt = new Date(this.clock.now()).toISOString();
    const gate = this.compliance.evaluateGate("paid_ads_api", { officialApiApproved: true });
    if (!gate.allowed) {
      return {
        ok: false,
        platform: input.platform,
        mode: "blocked_policy",
        status: 403,
        externalRef: null,
        reason: `${gate.code}: ${gate.reason}`,
        data: null,
        executedAt,
      };
    }

    const spendOk = canAuthorizeSpend(
      input.spend.tier,
      input.spend.amountCents,
      input.spend.perTaskCapCents,
      input.spend.dailySpentCents,
      input.spend.dailyCapCents,
      input.spend.monthlySpentCents,
      input.spend.monthlyCapCents,
      input.spend.billingArmed,
      input.spend.lockdown,
      input.spend.useSlopCash,
      input.spend.slopCashEnabled,
    );
    if (!spendOk) {
      return {
        ok: false,
        platform: input.platform,
        mode: "blocked_policy",
        status: 403,
        externalRef: null,
        reason: "spend_not_authorized_by_marketing_policy",
        data: null,
        executedAt,
      };
    }

    const scopeKey = `ads:${input.platform}`;
    const breakerCheck = this.compliance.getBreaker(scopeKey).canDispatch();
    if (!breakerCheck.allowed) {
      return {
        ok: false,
        platform: input.platform,
        mode: "rate_limited",
        status: 503,
        externalRef: null,
        reason: `circuit_open:${breakerCheck.reason ?? "breaker_open"}`,
        data: null,
        executedAt,
      };
    }

    const gcra = this.compliance.checkRateBudget({
      provider: scopeKey,
      accountId: input.accountId,
    });
    if (!gcra.allowed) {
      return {
        ok: false,
        platform: input.platform,
        mode: "rate_limited",
        status: 429,
        externalRef: null,
        reason: "gcra_rate_limited",
        data: null,
        executedAt,
      };
    }

    const resolved = this.resolveEndpoints(input.platform, input.accountId);
    const liveAllowed =
      resolved.mockMode || (resolved.token !== null && this.env.MARKETING_LIVE_BILLING === "1");
    if (!liveAllowed) {
      return {
        ok: true,
        platform: input.platform,
        mode: "dry_run",
        status: 200,
        externalRef: `dryrun:${input.platform}:${input.idempotencyKey}`,
        reason: `Dry-run ad launch for ${input.platform}.`,
        data: {
          campaignName: input.campaignName,
          dailyBudgetCents: input.dailyBudgetCents,
          city: input.city,
        },
        executedAt,
      };
    }

    const body =
      input.platform === "meta_ads"
        ? {
            name: input.campaignName,
            objective: input.objective,
            daily_budget: input.dailyBudgetCents,
            status: "ACTIVE",
          }
        : input.platform === "google_ads"
          ? {
              operations: [
                {
                  create: {
                    name: input.campaignName,
                    advertisingChannelType: "SEARCH",
                    budgetMicros: input.dailyBudgetCents * 10_000,
                    finalUrl: input.destinationUrl,
                  },
                },
              ],
            }
          : {
              campaign_name: input.campaignName,
              objective_type: input.objective,
              budget: Number((input.dailyBudgetCents / 100).toFixed(2)),
              landing_page_url: input.destinationUrl,
            };

    const startMs = this.clock.now();
    try {
      const res = await this.fetchFn(resolved.campaignUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${resolved.token ?? ""}`,
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
      });
      const json = await parseJsonSafe(res);
      this.compliance.recordHttpOutcome(scopeKey, {
        ok: res.ok,
        status: res.status,
        latencyMs: Math.max(0, this.clock.now() - startMs),
        retryAfterHeader: res.headers.get("retry-after"),
      });
      if (!res.ok) {
        return {
          ok: false,
          platform: input.platform,
          mode: res.status === 429 ? "rate_limited" : resolved.mockMode ? "mock_http" : "live",
          status: res.status,
          externalRef: null,
          reason: `${input.platform} HTTP ${res.status}`,
          data: json,
          executedAt,
        };
      }
      const dataObj =
        json.data && typeof json.data === "object"
          ? (json.data as Record<string, unknown>)
          : json;
      const ref =
        typeof dataObj.campaign_id === "string"
          ? dataObj.campaign_id
          : typeof json.id === "string"
            ? json.id
            : `${input.platform}:${input.idempotencyKey}`;
      return {
        ok: true,
        platform: input.platform,
        mode: resolved.mockMode ? "mock_http" : "live",
        status: res.status,
        externalRef: ref,
        reason: `Launched ${input.platform} campaign via ${resolved.mockMode ? "mock HTTP" : "live API"}.`,
        data: json,
        executedAt,
      };
    } catch (err) {
      this.compliance.recordHttpOutcome(scopeKey, {
        ok: false,
        status: 503,
        latencyMs: Math.max(0, this.clock.now() - startMs),
      });
      return {
        ok: false,
        platform: input.platform,
        mode: resolved.mockMode ? "mock_http" : "live",
        status: 503,
        externalRef: null,
        reason: err instanceof Error ? err.message : String(err),
        data: null,
        executedAt,
      };
    }
  }

  async sendConversionEvent(input: AdConversionEventInput): Promise<AdAdapterReceipt> {
    const executedAt = new Date(this.clock.now()).toISOString();
    const resolved = this.resolveEndpoints(input.platform, input.accountId);
    const liveAllowed =
      resolved.mockMode || (resolved.token !== null && this.env.MARKETING_LIVE_BILLING === "1");
    if (!liveAllowed) {
      return {
        ok: true,
        platform: input.platform,
        mode: "dry_run",
        status: 200,
        externalRef: `dryrun:capi:${input.eventId}`,
        reason: `Dry-run conversion event for ${input.platform}.`,
        data: { eventName: input.eventName, valueCents: input.valueCents },
        executedAt,
      };
    }
    const payload =
      input.platform === "meta_ads"
        ? {
            data: [
              {
                event_name: input.eventName,
                event_id: input.eventId,
                event_time: Math.floor(this.clock.now() / 1000),
                custom_data: { value: Number((input.valueCents / 100).toFixed(2)), currency: "USD" },
                user_data: input.contactHash ? { external_id: input.contactHash } : {},
              },
            ],
          }
        : {
            event: input.eventName,
            event_id: input.eventId,
            value: Number((input.valueCents / 100).toFixed(2)),
            currency: "USD",
          };
    const res = await this.fetchFn(resolved.eventUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${resolved.token ?? ""}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
    });
    const json = await parseJsonSafe(res);
    return {
      ok: res.ok,
      platform: input.platform,
      mode: resolved.mockMode ? "mock_http" : "live",
      status: res.status,
      externalRef: res.ok ? `capi:${input.eventId}` : null,
      reason: res.ok ? "Conversion event recorded." : `${input.platform} CAPI HTTP ${res.status}`,
      data: json,
      executedAt,
    };
  }
}
