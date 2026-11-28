import { jsonResponse, numField, parseJsonBody, strField, type ServiceContext, type ServiceResult } from "../http-helpers.ts";
import type { AdCampaignState } from "../state.ts";

const ADS_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

const BASE_CPM_CENTS: Record<AdCampaignState["platform"], number> = {
  meta_ads: 1150,
  google_ads: 1650,
  tiktok_ads: 850,
};

const BASE_CTR: Record<AdCampaignState["platform"], number> = {
  meta_ads: 0.018,
  google_ads: 0.032,
  tiktok_ads: 0.022,
};

export function advanceAdAuctions(
  ctx: ServiceContext,
  hours = 1,
): { impressions: number; clicks: number; spentCents: number } {
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalSpentCents = 0;
  const hourBucket = Math.floor(ctx.registry.clock.now() / 3_600_000);

  for (const camp of ctx.state.adCampaigns.values()) {
    if (camp.status !== "ACTIVE" || camp.dailyBudgetCents <= 0) continue;
    const rng = ctx.registry.forkRng(ctx.state, "ads_tick", camp.id, hourBucket);
    const hourlyBudget = Math.max(10, Math.round((camp.dailyBudgetCents / 24) * hours));
    const fatigueFactor = Math.max(0.35, 1 / (1 + Math.max(0, camp.frequency - 1.5) * 0.25));
    const effectiveCpm = Math.round(BASE_CPM_CENTS[camp.platform] * (1 + (camp.frequency - 1) * 0.12) * rng.range(0.85, 1.18));
    const impressions = Math.max(1, Math.round((hourlyBudget / Math.max(100, effectiveCpm)) * 1000));
    const effectiveCtr = BASE_CTR[camp.platform] * fatigueFactor * rng.range(0.8, 1.25);
    const clicks = Math.max(0, Math.round(impressions * effectiveCtr));

    camp.spentCents += hourlyBudget;
    camp.impressions += impressions;
    camp.clicks += clicks;
    camp.frequency = Number((camp.frequency + (impressions / 12_000) / Math.max(1, camp.creativeRotations + 1)).toFixed(3));

    totalImpressions += impressions;
    totalClicks += clicks;
    totalSpentCents += hourlyBudget;
  }

  return { impressions: totalImpressions, clicks: totalClicks, spentCents: totalSpentCents };
}

export async function handleAdsRequest(
  ctx: ServiceContext,
  req: Request,
  url: URL,
): Promise<ServiceResult | null> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const match = /^\/ads\/(meta|google|tiktok)(\/.*)?$/.exec(path);
  if (!match) return null;

  const shortPlatform = match[1] as "meta" | "google" | "tiktok";
  const service: AdCampaignState["platform"] = `${shortPlatform}_ads`;
  const subPath = match[2] ?? "/";
  const nowMs = ctx.registry.clock.now();

  const rl = ctx.chaos.checkRateLimit(ctx.state.sessionId, service, req.method, path, nowMs, ADS_RATE_LIMIT);
  const headers: Record<string, string> = {
    "x-rate-limit-limit": String(rl.result.limit),
    "x-rate-limit-remaining": String(rl.result.remaining),
    "x-rate-limit-reset": String(rl.result.resetAtSec),
    ...(rl.result.retryAfterSec > 0 ? { "retry-after": String(rl.result.retryAfterSec) } : {}),
  };
  const rateMeta = { limit: rl.result.limit, remaining: rl.result.remaining, resetAtSec: rl.result.resetAtSec };

  if (!rl.result.allowed) {
    return {
      service,
      response: jsonResponse({ error: { code: 429, message: `${service} rate limit exceeded` } }, 429, headers),
      rateLimit: rateMeta,
      chaosApplied: rl.chaosRuleId,
    };
  }

  const body = req.method === "GET" || req.method === "HEAD" ? {} : await parseJsonBody(req);

  if (shortPlatform === "meta") {
    const campMatch = /^\/v21\.0\/act_([^/]+)\/(campaigns|adsets)$/.exec(subPath);
    if (req.method === "POST" && campMatch) {
      const accountId = campMatch[1]!;
      const id = ctx.registry.nextId(ctx.state, "meta_c");
      const campaign: AdCampaignState = {
        id,
        platform: "meta_ads",
        accountId,
        name: strField(body, "name", `Meta Campaign ${id}`),
        city: strField(body, "city", "nyc"),
        desireLane: strField(body, "desire_lane", "friends_belonging"),
        dailyBudgetCents: Math.max(100, numField(body, "daily_budget", 5000)),
        spentCents: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        frequency: 1,
        creativeRotations: 0,
        destinationUrl: strField(body, "destination_url", "https://ntwrk.party"),
        status: strField(body, "status", "ACTIVE") === "PAUSED" ? "PAUSED" : "ACTIVE",
        createdAtMs: nowMs,
      };
      ctx.state.adCampaigns.set(id, campaign);
      return { service, response: jsonResponse({ id, success: true }, 200, headers), responseSummary: { id }, rateLimit: rateMeta };
    }

    const insightMatch = /^\/v21\.0\/act_([^/]+)\/insights$/.exec(subPath);
    if (req.method === "GET" && insightMatch) {
      const accountId = insightMatch[1]!;
      const rows = [...ctx.state.adCampaigns.values()]
        .filter((c) => c.platform === "meta_ads" && c.accountId === accountId)
        .map((c) => ({
          campaign_id: c.id,
          campaign_name: c.name,
          impressions: String(c.impressions),
          clicks: String(c.clicks),
          spend: (c.spentCents / 100).toFixed(2),
          frequency: c.frequency.toFixed(2),
          actions: [{ action_type: "lead", value: String(c.conversions) }],
        }));
      return { service, response: jsonResponse({ data: rows }, 200, headers), rateLimit: rateMeta };
    }

    const capiMatch = /^\/v21\.0\/([^/]+)\/events$/.exec(subPath);
    if (req.method === "POST" && capiMatch) {
      const pixelId = capiMatch[1]!;
      const events = Array.isArray(body.data) ? body.data : [];
      for (const ev of events) {
        ctx.state.adConversions.push({ platform: "meta_ads", pixelId, atMs: nowMs, event: ev });
        for (const c of ctx.state.adCampaigns.values()) {
          if (c.platform === "meta_ads" && c.status === "ACTIVE") {
            c.conversions += 1;
            break;
          }
        }
      }
      return {
        service,
        response: jsonResponse({ events_received: events.length, fbtrace_id: ctx.registry.nextId(ctx.state, "fb") }, 200, headers),
        rateLimit: rateMeta,
      };
    }
  }

  if (shortPlatform === "google") {
    const mutateMatch = /^\/v18\/customers\/([^/]+)\/campaigns:mutate$/.exec(subPath);
    if (req.method === "POST" && mutateMatch) {
      const customerId = mutateMatch[1]!;
      const id = ctx.registry.nextId(ctx.state, "gads_c");
      const ops = Array.isArray(body.operations) ? (body.operations as Array<Record<string, unknown>>) : [];
      const firstCreate = (ops[0]?.create as Record<string, unknown> | undefined) ?? body;
      const campaign: AdCampaignState = {
        id,
        platform: "google_ads",
        accountId: customerId,
        name: strField(firstCreate, "name", `Google Campaign ${id}`),
        city: strField(firstCreate, "city", "nyc"),
        desireLane: strField(firstCreate, "desire_lane", "career_money"),
        dailyBudgetCents: Math.max(100, numField(firstCreate, "daily_budget_cents", 6000)),
        spentCents: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        frequency: 1,
        creativeRotations: 0,
        destinationUrl: strField(firstCreate, "destination_url", "https://peon.biz"),
        status: "ACTIVE",
        createdAtMs: nowMs,
      };
      ctx.state.adCampaigns.set(id, campaign);
      const resourceName = `customers/${customerId}/campaigns/${id}`;
      return { service, response: jsonResponse({ results: [{ resourceName }] }, 200, headers), responseSummary: { id, resourceName }, rateLimit: rateMeta };
    }

    const searchMatch = /^\/v18\/customers\/([^/]+)\/googleAds:searchStream$/.exec(subPath);
    if (req.method === "POST" && searchMatch) {
      const customerId = searchMatch[1]!;
      const results = [...ctx.state.adCampaigns.values()]
        .filter((c) => c.platform === "google_ads" && c.accountId === customerId)
        .map((c) => ({
          campaign: { id: c.id, name: c.name, status: c.status },
          metrics: {
            impressions: String(c.impressions),
            clicks: String(c.clicks),
            costMicros: String(c.spentCents * 10_000),
            conversions: c.conversions,
          },
        }));
      return { service, response: jsonResponse([{ results }], 200, headers), rateLimit: rateMeta };
    }

    const convMatch = /^\/v18\/customers\/([^/:]+):uploadClickConversions$/.exec(subPath);
    if (req.method === "POST" && convMatch) {
      const customerId = convMatch[1]!;
      const conversions = Array.isArray(body.conversions) ? body.conversions : [];
      for (const conv of conversions) {
        ctx.state.adConversions.push({ platform: "google_ads", customerId, atMs: nowMs, conv });
      }
      return { service, response: jsonResponse({ results: conversions.map((_, i) => ({ index: i, status: "UPLOADED" })) }, 200, headers), rateLimit: rateMeta };
    }
  }

  if (shortPlatform === "tiktok") {
    const normSub = subPath.replace(/^\/v1\.3(?=\/open_api\/v1\.3\/)/, "").replace(/^\/v1\.3\//, "/open_api/v1.3/");
    if (req.method === "POST" && (normSub === "/open_api/v1.3/campaign/create" || normSub === "/campaign/create")) {
      const id = ctx.registry.nextId(ctx.state, "ttads_c");
      const advId = strField(body, "advertiser_id", "adv_default");
      const campaign: AdCampaignState = {
        id,
        platform: "tiktok_ads",
        accountId: advId,
        name: strField(body, "campaign_name", `TikTok Campaign ${id}`),
        city: strField(body, "city", "nyc"),
        desireLane: strField(body, "desire_lane", "love_dating"),
        dailyBudgetCents: Math.max(100, Math.round(numField(body, "budget", 50) * 100)),
        spentCents: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        frequency: 1,
        creativeRotations: 0,
        destinationUrl: strField(body, "destination_url", "https://slop.date"),
        status: "ACTIVE",
        createdAtMs: nowMs,
      };
      ctx.state.adCampaigns.set(id, campaign);
      return { service, response: jsonResponse({ code: 0, message: "OK", data: { campaign_id: id } }, 200, headers), responseSummary: { campaign_id: id }, rateLimit: rateMeta };
    }

    if ((req.method === "GET" || req.method === "POST") && normSub === "/open_api/v1.3/report/integrated/get") {
      const list = [...ctx.state.adCampaigns.values()]
        .filter((c) => c.platform === "tiktok_ads")
        .map((c) => ({
          dimensions: { campaign_id: c.id },
          metrics: {
            spend: (c.spentCents / 100).toFixed(2),
            impressions: String(c.impressions),
            clicks: String(c.clicks),
            conversion: String(c.conversions),
          },
        }));
      return { service, response: jsonResponse({ code: 0, message: "OK", data: { list } }, 200, headers), rateLimit: rateMeta };
    }

    if (req.method === "POST" && normSub === "/open_api/v1.3/event/track") {
      ctx.state.adConversions.push({ platform: "tiktok_ads", atMs: nowMs, body });
      return { service, response: jsonResponse({ code: 0, message: "OK", data: {} }, 200, headers), rateLimit: rateMeta };
    }
  }

  return {
    service,
    response: jsonResponse({ error: `Unhandled ${service} route ${req.method} ${subPath}` }, 404, headers),
    rateLimit: rateMeta,
  };
}
