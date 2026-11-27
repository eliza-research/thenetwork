import { RealClock, type Clock } from "../../../../packages/core/src/clock.ts";
import {
  MarketingComplianceRuntime,
  resolveMockBaseUrl,
} from "../compliance-runtime.ts";
import type { FetchFn } from "../types.ts";

export type SocialPlatform = "x" | "instagram" | "tiktok" | "reddit" | "linkedin" | "discord";

export interface SocialPostInput {
  readonly platform: SocialPlatform;
  readonly text: string;
  readonly title?: string;
  readonly accountId?: string;
  readonly campaignId?: string;
  readonly recipientHandle?: string;
  readonly recipientId?: string;
  readonly subreddit?: string;
  readonly mediaUrl?: string;
  readonly isDm?: boolean;
  readonly hasRecordedConsent?: boolean;
  readonly officialApiApproved?: boolean;
  readonly idempotencyKey: string;
}

export interface SocialDispatchReceipt {
  readonly ok: boolean;
  readonly platform: SocialPlatform;
  readonly mode: "live" | "mock_http" | "dry_run" | "blocked_policy" | "rate_limited";
  readonly status: number;
  readonly externalRef: string | null;
  readonly reason: string;
  readonly retryAfterMs?: number;
  readonly data: Record<string, unknown> | null;
  readonly executedAt: string;
}

export interface SocialAdapterRegistryOptions {
  readonly env?: Record<string, string | undefined>;
  readonly fetchFn?: FetchFn;
  readonly clock?: Clock;
  readonly compliance?: MarketingComplianceRuntime;
  readonly endpointOverrides?: Partial<Record<SocialPlatform, string>>;
}

const DEFAULT_HTTP_TIMEOUT_MS = 12_000;

const OFFICIAL_ENDPOINTS: Record<SocialPlatform, { envKey: string; url: string }> = {
  x: { envKey: "X_API_BEARER_TOKEN", url: "https://api.x.com/2/tweets" },
  instagram: { envKey: "INSTAGRAM_ACCESS_TOKEN", url: "https://graph.instagram.com/v20.0/me/media" },
  tiktok: { envKey: "TIKTOK_ACCESS_TOKEN", url: "https://open.tiktokapis.com/v2/post/publish/video/init/" },
  reddit: { envKey: "REDDIT_ACCESS_TOKEN", url: "https://oauth.reddit.com/api/submit" },
  linkedin: { envKey: "LINKEDIN_ACCESS_TOKEN", url: "https://api.linkedin.com/rest/posts" },
  discord: { envKey: "DISCORD_BOT_TOKEN", url: "https://discord.com/api/v10/users/@me/channels" },
};

async function parseJsonBody(res: Response): Promise<Record<string, unknown>> {
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

function parseIntHeader(res: Response, name: string): number | undefined {
  const raw = res.headers.get(name);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export class SocialAdapterRegistry {
  private readonly env: Record<string, string | undefined>;
  private readonly fetchFn: FetchFn;
  private readonly clock: Clock;
  private readonly compliance: MarketingComplianceRuntime;
  private readonly endpointOverrides: Partial<Record<SocialPlatform, string>>;

  constructor(opts: SocialAdapterRegistryOptions = {}) {
    this.env = opts.env ?? process.env;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.clock = opts.clock ?? new RealClock();
    this.compliance =
      opts.compliance ?? new MarketingComplianceRuntime({ env: this.env, clock: this.clock });
    this.endpointOverrides = opts.endpointOverrides ?? {};
  }

  private resolveUrl(input: SocialPostInput): { url: string; mockMode: boolean; configured: boolean } {
    const override = this.endpointOverrides[input.platform];
    if (override) {
      return { url: override, mockMode: true, configured: true };
    }
    const mockBase = resolveMockBaseUrl(this.env);
    if (mockBase) {
      const account = encodeURIComponent(input.accountId ?? "acct-default");
      switch (input.platform) {
        case "x":
          return { url: `${mockBase}/social/x/2/tweets`, mockMode: true, configured: true };
        case "instagram":
          return {
            url: input.isDm
              ? `${mockBase}/social/instagram/${account}/messages`
              : `${mockBase}/social/instagram/${account}/media`,
            mockMode: true,
            configured: true,
          };
        case "tiktok":
          return {
            url: `${mockBase}/social/tiktok/v2/post/publish/video/init`,
            mockMode: true,
            configured: true,
          };
        case "reddit":
          return {
            url: input.isDm
              ? `${mockBase}/social/reddit/api/compose`
              : `${mockBase}/social/reddit/api/submit`,
            mockMode: true,
            configured: true,
          };
        case "linkedin":
          return {
            url: input.isDm
              ? `${mockBase}/social/linkedin/v2/messages`
              : `${mockBase}/social/linkedin/v2/rest/posts`,
            mockMode: true,
            configured: true,
          };
        case "discord":
          return {
            url: `${mockBase}/social/discord/api/v10/users/@me/channels`,
            mockMode: true,
            configured: true,
          };
      }
    }
    const official = OFFICIAL_ENDPOINTS[input.platform];
    const token = this.env[official.envKey]?.trim();
    return {
      url: official.url,
      mockMode: false,
      configured: Boolean(token && this.env.MARKETING_LIVE_SEND === "1"),
    };
  }

  private buildRequestBody(input: SocialPostInput): Record<string, unknown> {
    switch (input.platform) {
      case "x":
        return { text: input.text };
      case "instagram":
        return input.isDm
          ? { recipient: { id: input.recipientId ?? input.recipientHandle ?? "user" }, message: { text: input.text } }
          : { caption: input.text, image_url: input.mediaUrl ?? "https://ntwrk.party/card.png" };
      case "tiktok":
        return {
          post_info: { title: input.title ?? input.text.slice(0, 120), privacy_level: "PUBLIC_TO_EVERYONE" },
          source_info: { source: "PULL_FROM_URL", video_url: input.mediaUrl ?? "https://ntwrk.party/clip.mp4" },
        };
      case "reddit":
        return input.isDm
          ? { to: input.recipientHandle ?? "member", subject: input.title ?? "The Network", text: input.text }
          : { sr: input.subreddit ?? "nyc", title: input.title ?? input.text.slice(0, 100), text: input.text, kind: "self" };
      case "linkedin":
        return input.isDm
          ? { recipients: [input.recipientId ?? input.recipientHandle ?? "urn:li:person:1"], body: input.text }
          : { commentary: input.text, visibility: "PUBLIC" };
      case "discord":
        return { recipient_id: input.recipientId ?? input.recipientHandle ?? "1001", content: input.text };
    }
  }

  getStatus(): Array<{ platform: SocialPlatform; configured: boolean; mockMode: boolean; url: string }> {
    const platforms: SocialPlatform[] = ["x", "instagram", "tiktok", "reddit", "linkedin", "discord"];
    return platforms.map((platform) => {
      const resolved = this.resolveUrl({
        platform,
        text: "",
        idempotencyKey: "status",
      });
      return { platform, ...resolved };
    });
  }

  async dispatch(input: SocialPostInput): Promise<SocialDispatchReceipt> {
    const executedAt = new Date(this.clock.now()).toISOString();
    const gate = this.compliance.evaluateGate("official_api_opt_in", {
      hasRecordedConsent: input.isDm ? input.hasRecordedConsent !== false : true,
      officialApiApproved: input.officialApiApproved !== false,
    });
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

    const lint = this.compliance.lintCopy({
      channel: "social",
      text: input.text,
      subject: input.title,
      isCommercial: true,
    });
    if (!lint.ok) {
      return {
        ok: false,
        platform: input.platform,
        mode: "blocked_policy",
        status: 422,
        externalRef: null,
        reason: `copy_lint_failed:${lint.violations.join(",")}`,
        data: null,
        executedAt,
      };
    }

    const scopeKey = `social:${input.platform}`;
    const breakerCheck = this.compliance.getBreaker(scopeKey).canDispatch();
    if (!breakerCheck.allowed) {
      return {
        ok: false,
        platform: input.platform,
        mode: "rate_limited",
        status: 503,
        externalRef: null,
        reason: `circuit_open:${breakerCheck.reason ?? "breaker_open"}`,
        retryAfterMs: breakerCheck.waitMs,
        data: null,
        executedAt,
      };
    }

    const aimdWindow = this.compliance.getAimd(scopeKey).canDispatch();
    if (!aimdWindow.allowed) {
      return {
        ok: false,
        platform: input.platform,
        mode: "rate_limited",
        status: 429,
        externalRef: null,
        reason: "aimd_backoff_active",
        retryAfterMs: aimdWindow.waitMs,
        data: null,
        executedAt,
      };
    }

    const gcra = this.compliance.checkRateBudget({
      provider: scopeKey,
      accountId: input.accountId,
      campaignId: input.campaignId,
      recipientKey: input.recipientHandle ?? input.recipientId,
    });
    if (!gcra.allowed) {
      return {
        ok: false,
        platform: input.platform,
        mode: "rate_limited",
        status: 429,
        externalRef: null,
        reason: `gcra_rate_limited:${gcra.blockedLevel ?? "platform"}`,
        retryAfterMs: gcra.retryAfterMs,
        data: null,
        executedAt,
      };
    }

    const resolved = this.resolveUrl(input);
    if (!resolved.configured) {
      return {
        ok: true,
        platform: input.platform,
        mode: "dry_run",
        status: 200,
        externalRef: `dryrun:social:${input.platform}:${input.idempotencyKey}`,
        reason: `Dry-run social dispatch for ${input.platform} (no live credentials or mock base URL).`,
        data: this.buildRequestBody(input),
        executedAt,
      };
    }

    const token = this.env[OFFICIAL_ENDPOINTS[input.platform].envKey]?.trim() || "mock-token";
    const startMs = this.clock.now();
    try {
      const res = await this.fetchFn(resolved.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify(this.buildRequestBody(input)),
        signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
      });
      const json = await parseJsonBody(res);
      const latencyMs = Math.max(0, this.clock.now() - startMs);
      const retryAfterHeader = res.headers.get("retry-after");
      const rateLimitRemaining = parseIntHeader(res, "x-rate-limit-remaining");
      const rateLimitLimit = parseIntHeader(res, "x-rate-limit-limit");

      this.compliance.recordHttpOutcome(scopeKey, {
        ok: res.ok,
        status: res.status,
        latencyMs,
        retryAfterHeader,
        rateLimitRemaining,
        rateLimitLimit,
      });

      if (!res.ok) {
        return {
          ok: false,
          platform: input.platform,
          mode: res.status === 429 ? "rate_limited" : resolved.mockMode ? "mock_http" : "live",
          status: res.status,
          externalRef: null,
          reason: `${input.platform} HTTP ${res.status}`,
          retryAfterMs:
            res.status === 429 ? this.compliance.getAimd(scopeKey).canDispatch().waitMs : undefined,
          data: json,
          executedAt,
        };
      }

      const dataObj =
        json.data && typeof json.data === "object"
          ? (json.data as Record<string, unknown>)
          : json;
      const ref =
        typeof dataObj.id === "string"
          ? dataObj.id
          : typeof json.id === "string"
            ? json.id
            : typeof json.publish_id === "string"
              ? json.publish_id
              : `${input.platform}:${input.idempotencyKey}`;

      return {
        ok: true,
        platform: input.platform,
        mode: resolved.mockMode ? "mock_http" : "live",
        status: res.status,
        externalRef: ref,
        reason: `Dispatched via ${resolved.mockMode ? "mock HTTP" : "live API"} (${input.platform}).`,
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
}
