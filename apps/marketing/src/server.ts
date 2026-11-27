import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RealClock } from "../../../packages/core/src/clock.ts";
import { adultParticipantAge } from "../../../packages/core/src/generated/marketingPolicy.ts";
import { setLeakLabelKey } from "../../../packages/core/src/guard.ts";
import { serveHttp, type HttpServer } from "../../../packages/core/src/runtime/http.ts";
import { checkBackendHealth } from "../../../packages/core/src/vibe/backendHealthShell.js";
import type {
  AnalyticsFilter,
  AttributionModel,
  SliceDimension,
  SliceGranularity,
  SliceMetric,
} from "../../../packages/core/src/analytics/types.ts";
import type {
  TrajectoryApp,
  TrajectoryKind,
  TrajectoryStatus,
} from "../../../packages/core/src/trajectory/types.ts";
import {
  AdAdapterRegistry,
} from "./adapters/ads.ts";
import {
  createPaidAdapterRegistry,
  type PaidAdapterRegistry,
} from "./adapters/paid.ts";
import {
  SocialAdapterRegistry,
} from "./adapters/social.ts";
import {
  AgentLifecycleManager,
  DEFAULT_DAILY_COST_CAP_MICROS,
  DEFAULT_DAILY_TOKEN_CAP,
  type CliProcessRunner,
} from "./agent-lifecycle.ts";
import {
  MarketingAnalyticsRuntime,
} from "./analytics-bridge.ts";
import {
  AntiFraudEngine,
  detectSybilCluster,
  type SybilClaimNode,
} from "./antifraud.ts";
import {
  computeBanditAllocations,
  toAllocatorBanditArm,
} from "./bandit.ts";
import {
  BdPipelineEngine,
  type BdContractKind,
} from "./bd-engine.ts";
import {
  normalizeCityCode,
} from "./cities.ts";
import {
  seedCityLaunch,
  type CitySeedResult,
} from "./city-launch-engine.ts";
import {
  evaluateCityStageReadiness,
  listCityPacks,
  requireCityPack,
  UnknownCityError,
  type CityStageReadinessResult,
} from "./city-registry.ts";
import {
  isDeployedEnvironment,
  MarketingComplianceRuntime,
} from "./compliance-runtime.ts";
import {
  DEFAULT_MARKETING_HOST,
  DEFAULT_MARKETING_PORT,
  SUPPORTED_SUBSCRIPTION_PROVIDERS,
} from "./constants.ts";
import {
  CrowdsourcingEngine,
  type HiringRole,
} from "./crowdsourcing.ts";
import {
  MarketingAutopilotDaemon,
} from "./daemon.ts";
import {
  listDesireLanes,
  UnknownDesireLaneError,
} from "./desire-lanes.ts";
import {
  DeviceBridge,
  toDeviceNode,
  type DeviceActionContext,
} from "./devices/bridge.ts";
import {
  discoverCityLeads,
  type DiscoverySource,
} from "./discovery.ts";
import {
  MarketingGameSession,
} from "./game-session.ts";
import {
  createNetworkCoreBridge,
  type NetworkCoreBridge,
} from "./network-bridge.ts";
import {
  NYC_ACTIVATION_CORRIDORS,
  NYC_LAUNCH_CAMPAIGN,
  NYC_LOCAL_PRINTERS,
  NYC_MONTH1_BUDGET_TRACKS,
  NYC_MONTH1_WEEKLY_ROLLOUT,
  SELF_SERVICE_PLATFORMS,
  VETTED_NYC_AGENCIES,
} from "./nyc-seed.ts";
import {
  evaluateLlmBudget,
  isGlobalOptOutText,
  keyedContactHash,
  normalizeE164Phone,
  PolicyViolationError,
} from "./policy.ts";
import {
  runMarketingSim,
} from "./sim.ts";
import {
  SlopCashBridge,
  SlopCashDisabledError,
} from "./slop-cash-bridge.ts";
import {
  MarketingEventHub,
  type MarketingEventType,
} from "./sse.ts";
import {
  MemoryMarketingStore,
  PgMarketingStore,
  type BanditArmBatchUpdate,
  type MarketingStore,
} from "./store.ts";
import type {
  BanditArm,
  BdDealStage,
  BrandAppId,
  Clock,
  DeviceNode,
  MarketingAgent,
  PersonaId,
  PhoneLineType,
  SubscriptionProvider,
  VideoAssetStage,
} from "./types.ts";
import {
  buildMarketingAssets,
  type PrecompressedMarketingAsset,
} from "./ui/index.ts";
import {
  HttpValidationError,
  parseAgentTick,
  parseBdUpdate,
  parseCityParam,
  parseContactSuppression,
  parseCreateAgent,
  parseCreateAttribution,
  parseCreateBdDeal,
  parseCreateCampaign,
  parseCreateDevice,
  parseCreateHuman,
  parseCreateOutreach,
  parseCreateQrBatch,
  parseCreateTask,
  parseCreateVideoAsset,
  parseCreateVipProspect,
  parseDeviceAction,
  parseDiscoveryRequest,
  parsePaginationQuery,
  parseProofReview,
  parseRiskDialUpdate,
  parseSeedCity,
  parseSimRequest,
  parseSubmitProof,
  parseUpdateCampaign,
  readJsonBody,
} from "./validation.ts";
import {
  canTransitionVideoStage,
  lintVideoScript,
  PERSONA_VIDEO_BIBLES,
  type VideoScriptManifest,
} from "./video-factory.ts";
import {
  classifyVipArchetype,
  isWeakOrFallbackProofOfWorkHook,
  scoreVipProspect,
  VipDiscoveryEngine,
} from "./vip-engine.ts";

export interface MarketingServerOptions {
  store: MarketingStore;
  clock?: Clock;
  port?: number;
  hostname?: string;
  token?: string;
  bridge?: NetworkCoreBridge;
  deviceBridge?: DeviceBridge;
  paidAdapters?: PaidAdapterRegistry;
  socialAdapters?: SocialAdapterRegistry;
  adAdapters?: AdAdapterRegistry;
  compliance?: MarketingComplianceRuntime;
  discoveryFetch?: typeof fetch;
  cliRunner?: CliProcessRunner;
  env?: NodeJS.ProcessEnv;
  daemonIntervalMs?: number;
}

export type NycSeedResult = CitySeedResult;

export async function seedNycLaunch(store: MarketingStore): Promise<NycSeedResult> {
  return seedCityLaunch(store, "nyc");
}

function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const clean = (s: string) => s.trim().replace(/^W\//, "");
  const target = clean(etag);
  return ifNoneMatch.split(",").some((part) => {
    const trimmed = part.trim();
    return trimmed === "*" || clean(trimmed) === target;
  });
}

function servePrecompressedAsset(request: Request, asset: PrecompressedMarketingAsset): Response {
  const headers: Record<string, string> = {
    "Content-Type": asset.contentType,
    "Cache-Control": asset.cacheControl,
    ETag: asset.etag,
    Vary: "Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
  };
  if (etagMatches(request.headers.get("if-none-match"), asset.etag)) {
    return new Response(null, { status: 304, headers });
  }
  const acceptEncoding = request.headers.get("accept-encoding") ?? "";
  if (/\bgzip\b/i.test(acceptEncoding)) {
    return new Response(new Uint8Array(asset.gzipped), {
      status: 200,
      headers: { ...headers, "Content-Encoding": "gzip" },
    });
  }
  return new Response(new Uint8Array(asset.raw), { status: 200, headers });
}

function parseAnalyticsFilter(searchParams: URLSearchParams): AnalyticsFilter {
  const rawApp = searchParams.get("appId")?.trim();
  const appId =
    rawApp === "slop" || rawApp === "peon" || rawApp === "friends" || rawApp === "ntwrk" || rawApp === "all"
      ? rawApp
      : undefined;
  const city = searchParams.get("city")?.trim().toLowerCase() || undefined;
  const desireLane = searchParams.get("desireLane")?.trim() || undefined;
  const channel = searchParams.get("channel")?.trim() || undefined;
  const campaignId = searchParams.get("campaignId")?.trim() || undefined;
  const fromRaw = searchParams.get("fromMs");
  const toRaw = searchParams.get("toMs");
  const fromMs = fromRaw !== null && Number.isFinite(Number(fromRaw)) ? Number(fromRaw) : undefined;
  const toMs = toRaw !== null && Number.isFinite(Number(toRaw)) ? Number(toRaw) : undefined;
  return { appId, city, desireLane, channel, campaignId, fromMs, toMs };
}

const MAX_PUBLIC_BODY_BYTES = 65_536;
const MAX_BEACON_BATCH_SIZE = 100;
const VALID_BRAND_APPS = new Set<BrandAppId>(["slop", "peon", "friends", "ntwrk"]);

function parseBrandAppId(raw: unknown, fallback: BrandAppId): BrandAppId {
  if (typeof raw === "string" && VALID_BRAND_APPS.has(raw as BrandAppId)) {
    return raw as BrandAppId;
  }
  return fallback;
}

async function readBoundedText(request: Request, maxBytes = MAX_PUBLIC_BODY_BYTES): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpValidationError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBytes} bytes.`);
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new HttpValidationError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBytes} bytes.`);
  }
  return new TextDecoder().decode(buf);
}

function verifyWebhookHmac(
  rawBody: string,
  headerValue: string | null,
  secret: string | undefined,
  failClosedWithoutSecret: boolean,
): boolean {
  const cleanSecret = secret?.trim();
  if (!cleanSecret) return !failClosedWithoutSecret;
  if (!headerValue?.trim()) return false;
  const expectedHex = createHmac("sha256", cleanSecret).update(rawBody, "utf8").digest("hex");
  const expectedB64 = createHmac("sha256", cleanSecret).update(rawBody, "utf8").digest("base64");
  const candidates = headerValue
    .split(/[\s,]+/)
    .map((part) => part.replace(/^(?:sha256=|v1,)/i, "").trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const candBuf = Buffer.from(candidate, "utf8");
    const hexBuf = Buffer.from(expectedHex, "utf8");
    const b64Buf = Buffer.from(expectedB64, "utf8");
    if (candBuf.length === hexBuf.length && timingSafeEqual(candBuf, hexBuf)) return true;
    if (candBuf.length === b64Buf.length && timingSafeEqual(candBuf, b64Buf)) return true;
  }
  return false;
}

function timingSafeBearerMatch(header: string | null, expectedToken: string): boolean {
  if (!header || !expectedToken) return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const candidate = header.slice(prefix.length).trim();
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expectedToken, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function mapErrorToResponse(err: unknown): Response {
  if (err instanceof SlopCashDisabledError) {
    return jsonResponse(
      { error: err.message, code: err.code, invariant: err.invariant },
      403,
    );
  }
  if (err instanceof PolicyViolationError) {
    return jsonResponse(
      { error: err.message, code: err.code, invariant: err.invariant },
      403,
    );
  }
  if (err instanceof HttpValidationError) {
    return jsonResponse({ error: err.message, code: err.code }, err.status);
  }
  if (err instanceof UnknownCityError) {
    return jsonResponse({ error: err.message, code: "UNKNOWN_CITY" }, 400);
  }
  if (err instanceof UnknownDesireLaneError) {
    return jsonResponse({ error: err.message, code: "UNKNOWN_DESIRE_LANE" }, 400);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(message)) {
    return jsonResponse({ error: message }, 404);
  }
  return jsonResponse({ error: message }, 400);
}

function resolveBearerToken(optToken: string | undefined, envToken: string | undefined): string {
  const fromOpt = optToken?.trim();
  if (fromOpt && fromOpt.length > 0) return fromOpt;
  const fromEnv = envToken?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return randomBytes(24).toString("hex");
}

function mapDaemonEventType(eventType: string): MarketingEventType {
  if (eventType.includes("bandit")) return "bandit";
  if (eventType.includes("lease")) return "device";
  if (eventType.includes("lockdown")) return "campaign";
  return "daemon";
}

export async function createMarketingServer(opts: MarketingServerOptions): Promise<{
  server: HttpServer;
  url: string;
  token: string;
  daemon: MarketingAutopilotDaemon;
  eventHub: MarketingEventHub;
  bridge: NetworkCoreBridge;
  compliance: MarketingComplianceRuntime;
  analytics: MarketingAnalyticsRuntime;
  gameSession: MarketingGameSession;
  stop: () => Promise<void>;
}> {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? opts.store.clock ?? new RealClock();
  const port = opts.port ?? Number(env.MARKETING_PORT || env.PORT || DEFAULT_MARKETING_PORT);
  const hostname = opts.hostname ?? DEFAULT_MARKETING_HOST;
  const token = resolveBearerToken(opts.token, env.MARKETING_TOKEN);

  if (env.LEAK_LABEL_KEY && new TextEncoder().encode(env.LEAK_LABEL_KEY).length >= 32) {
    setLeakLabelKey(env.LEAK_LABEL_KEY);
  }

  const compliance =
    opts.compliance ?? new MarketingComplianceRuntime({ env, clock });
  const analytics = new MarketingAnalyticsRuntime({ store: opts.store, clock, env });

  const bridge =
    opts.bridge ??
    createNetworkCoreBridge({
      sql: opts.store.getSql(),
      clock,
      env,
    });
  const deviceBridge = opts.deviceBridge ?? new DeviceBridge({ clock, env });
  const paidAdapters =
    opts.paidAdapters ??
    createPaidAdapterRegistry({ clock, env, store: opts.store, compliance });
  const socialAdapters =
    opts.socialAdapters ?? new SocialAdapterRegistry({ env, clock, compliance });
  const adAdapters =
    opts.adAdapters ?? new AdAdapterRegistry({ env, clock, compliance });
  const agentManager = new AgentLifecycleManager({
    store: opts.store,
    clock,
    env,
    bridge,
    trajectoryWriter: analytics.trajectoryWriter,
    cliRunner: opts.cliRunner,
    dryRun: opts.cliRunner ? false : undefined,
  });
  const crowdsourcing = new CrowdsourcingEngine({
    store: opts.store,
    clock,
    env,
    paidAdapters,
    socialAdapters,
    compliance,
    trajectoryWriter: analytics.trajectoryWriter,
    bridge,
  });
  const slopCashBridge = new SlopCashBridge({
    store: opts.store,
    clock,
    env,
    configEnabled: false,
  });
  const antiFraud = new AntiFraudEngine({ clock });
  const bdEngine = new BdPipelineEngine({ clock });
  const vipEngine = new VipDiscoveryEngine({ clock });
  const eventHub = new MarketingEventHub({ clock });
  const gameSession = new MarketingGameSession({
    clock,
    env,
    externalTrajectoryWriter: analytics.trajectoryWriter,
    onFunnelEvent: (ev) => {
      analytics.ingestSimFunnelEvent(ev);
    },
    onUpdate: (state) => {
      eventHub.publish("sim", {
        scenarioId: state.scenarioId,
        simDay: state.snapshot.simDay,
        playing: state.snapshot.playing,
        score: state.snapshot.score,
        safetyViolations: state.snapshot.safetyViolations,
      });
    },
  });

  const webAssets = await buildMarketingAssets(env.NODE_ENV !== "production");

  let serving = true;

  const daemon = new MarketingAutopilotDaemon({
    store: opts.store,
    clock,
    bridge,
    intervalMs: opts.daemonIntervalMs ?? 60_000,
    runCampaignTick: async (campaign) => {
      await agentManager.runAutopilotTick(campaign.id);
    },
    onEvent: (evt) => {
      eventHub.publish(mapDaemonEventType(evt.type), {
        daemonEvent: evt.type,
        ...evt.payload,
      });
    },
  });

  const dailyTokenCap = Number(env.MARKETING_DAILY_TOKEN_CAP) || DEFAULT_DAILY_TOKEN_CAP;
  const dailyCostCapMicros =
    Number(env.MARKETING_DAILY_COST_CAP_MICROS) || DEFAULT_DAILY_COST_CAP_MICROS;

  const buildCompliancePayload = async () => {
    const auditEntries = await opts.store.listOperatorAudit(25);
    const snap = compliance.getComplianceSnapshot(auditEntries);
    const gatesWithStatus: Record<string, Record<string, unknown>> = {};
    for (const [mode, decision] of Object.entries(snap.gates)) {
      gatesWithStatus[mode] = {
        ...decision,
        mode,
        status: decision.tier,
      };
    }
    return {
      env: snap.env,
      liveBillingEnabled: snap.liveBillingEnabled,
      mockModeActive: snap.mockModeActive,
      mockBaseUrl: snap.mockBaseUrl,
      gates: gatesWithStatus,
      breakers: snap.breakers,
      aimd: snap.aimd,
      audit: auditEntries,
      auditRecent: auditEntries,
    };
  };

  const buildCitiesPayload = async () => {
    const cached = await analytics.cache.get<unknown[]>("cities_payload");
    if (cached) return cached;
    const [overrides, cityAggs, signals] = await Promise.all([
      opts.store.listCityPacksOverrides(),
      opts.store.getCityReadinessAggregates(),
      bridge.getDemandAndPressure().catch(() => []),
    ]);
    const overrideByCode = new Map(overrides.map((o) => [o.code, o]));
    const aggByCity = new Map(cityAggs.map((a) => [a.city, a]));
    const result = listCityPacks().map((pack) => {
      const override = overrideByCode.get(pack.code);
      const agg = aggByCity.get(pack.code);
      const citySignals = signals.filter((s) => s.city === pack.code);
      const activeAdults = citySignals.reduce((sum, s) => sum + s.activeAdultBucket, 0);
      const reviewSlaHealthy = !citySignals.some((s) => s.overdueReviewCount > 0);
      const readiness: CityStageReadinessResult = evaluateCityStageReadiness(pack, {
        verifiedWaitlistAdults: agg?.verifiedSignups ?? 0,
        signedVenues: agg?.dealsLive ?? 0,
        activeAdults,
        reviewSlaHealthy,
        safetyViolations: 0,
      });
      return {
        ...pack,
        ...(override ? { overrideStage: override.stage } : {}),
        readiness,
      };
    });
    await analytics.cache.set("cities_payload", result, 5_000);
    return result;
  };

  const buildDesireLanesPayload = async () => {
    const cached = await analytics.cache.get<{ lanes: ReturnType<typeof listDesireLanes>; metrics: Record<string, unknown> }>("desire_lanes_payload");
    if (cached) return cached;
    const lanes = listDesireLanes();
    const aggs = await opts.store.getDesireLaneAggregates();
    const aggByLane = new Map(aggs.map((a) => [a.lane, a]));
    const metrics: Record<
      string,
      {
        campaigns: number;
        tasks: number;
        banditArms: number;
        verifiedOutcomes: number;
        bdDeals: number;
        vipProspects: number;
        videos: number;
      }
    > = {};
    for (const lane of lanes) {
      const agg = aggByLane.get(lane.id);
      metrics[lane.id] = {
        campaigns: agg?.campaigns ?? 0,
        tasks: agg?.tasks ?? 0,
        banditArms: agg?.arms ?? 0,
        verifiedOutcomes: agg?.verifiedOutcomes ?? 0,
        bdDeals: agg?.deals ?? 0,
        vipProspects: agg?.vips ?? 0,
        videos: agg?.videos ?? 0,
      };
    }
    for (const agg of aggs) {
      if (!metrics[agg.lane]) {
        metrics[agg.lane] = {
          campaigns: agg.campaigns,
          tasks: agg.tasks,
          banditArms: agg.arms,
          verifiedOutcomes: agg.verifiedOutcomes,
          bdDeals: agg.deals,
          vipProspects: agg.vips,
          videos: agg.videos,
        };
      }
    }
    const payload = { lanes, metrics };
    await analytics.cache.set("desire_lanes_payload", payload, 5_000);
    return payload;
  };

  const buildLlmUsagePayload = async (filter?: {
    agentId?: string;
    campaignId?: string;
    dayIso?: string;
  }) => {
    const usage = await opts.store.getDailyLlmUsage(filter);
    const cacheStats = agentManager.getCacheStats();
    const budgetDecision = evaluateLlmBudget({
      tokensUsedToday: usage.totalTokens,
      estimatedTokens: 0,
      dailyTokenCap,
      costMicrosToday: usage.costMicros,
      estimatedCostMicros: 0,
      dailyCostCapMicros,
    });
    return {
      usage,
      caps: { dailyTokenCap, dailyCostCapMicros },
      deterministicSkips: cacheStats.deterministicSkips,
      cacheStats,
      budgetDecision,
    };
  };

  const buildCorePressurePayload = async () => {
    const [ping, signals] = await Promise.all([
      bridge.ping(),
      bridge.getDemandAndPressure().catch(() => []),
    ]);
    const daemonStatus = daemon.getStatus();
    const pausedSet = new Set<string>(Object.keys(daemonStatus.pausedQueues));
    for (const sig of signals) {
      if (sig.queuePressurePaused) {
        pausedSet.add(`${sig.appId}:${sig.city}`);
      }
    }
    const pausedQueues = [...pausedSet].sort();
    return {
      mode: ping.mode,
      bridgeHealthy: ping.ok,
      bridgeFunctionsPresent: ping.bridgeFunctionsPresent,
      paused: pausedQueues.length > 0,
      pausedQueues,
      signals,
    };
  };

  const requireAuth = (req: Request): Response | null => {
    if (!timingSafeBearerMatch(req.headers.get("authorization"), token)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    return null;
  };

  const server = await serveHttp({
    hostname,
    port,
    fetch: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      if (method === "GET" && path === "/healthz") {
        const health = await checkBackendHealth(serving, {
          ping: async () => (await bridge.ping()).ok,
          hasLateTick: () => false,
        });
        return jsonResponse(
          {
            ok: health === "Ready",
            status: health,
            service: "marketing",
            time: new Date(clock.now()).toISOString(),
          },
          health === "Ready" ? 200 : 503,
        );
      }

      if (method === "GET" && path === "/health") {
        return jsonResponse({
          ok: serving,
          service: "marketing",
          time: new Date(clock.now()).toISOString(),
          daemonRunning: daemon.getStatus().running,
          sseClients: eventHub.clientCount(),
        });
      }

      if (method === "GET" && path === "/") {
        return new Response(webAssets.html, {
          status: 200,
          headers: webAssets.securityHeaders(),
        });
      }

      if (method === "GET" && (path === "/assets/app.css" || path === "/app.css")) {
        return servePrecompressedAsset(request, webAssets.css);
      }

      if (method === "GET" && (path === "/assets/app.js" || path === "/app.js")) {
        return servePrecompressedAsset(request, webAssets.js);
      }

      if (method === "GET" && path === "/fonts/host-grotesk.woff2") {
        if (!webAssets.font) {
          return new Response("Not found", { status: 404 });
        }
        return servePrecompressedAsset(request, webAssets.font);
      }

      const deployedEnv = isDeployedEnvironment(env);

      if ((method === "POST" || method === "GET") && path === "/api/unsubscribe") {
        try {
          let tokenParam = url.searchParams.get("token")?.trim() ?? "";
          if (!tokenParam && method === "POST") {
            const rawText = await readBoundedText(request, MAX_PUBLIC_BODY_BYTES);
            const ct = request.headers.get("content-type") ?? "";
            if (ct.includes("application/json")) {
              const parsed: unknown = rawText.trim() ? JSON.parse(rawText) : {};
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                const body = parsed as Record<string, unknown>;
                tokenParam = typeof body.token === "string" ? body.token.trim() : "";
              }
            } else {
              const form = new URLSearchParams(rawText);
              tokenParam = form.get("token")?.trim() ?? "";
            }
          }
          const verified = compliance.verifyUnsubscribeToken(tokenParam);
          if (!verified.ok) {
            return jsonResponse({ ok: false, error: verified.reason }, 400);
          }
          const { contactKey, channel } = verified.payload;
          const isEmail = contactKey.includes("@");
          const normalizedPhone = isEmail ? null : normalizeE164Phone(contactKey);
          const contactHash =
            (isEmail ? keyedContactHash("email", contactKey, env) : null) ??
            (normalizedPhone ? keyedContactHash("phone", normalizedPhone, env) : null) ??
            contactKey;
          if (isEmail) {
            compliance.suppression.suppress({
              kind: "email",
              value: contactKey,
              scope: "global",
              reason: "rfc8058_unsubscribe",
              source: channel,
            });
          } else if (normalizedPhone) {
            compliance.suppression.suppress({
              kind: "phone",
              value: normalizedPhone,
              scope: "global",
              reason: "rfc8058_unsubscribe",
              source: channel,
            });
          } else {
            compliance.suppression.suppress({
              kind: "handle",
              value: contactKey,
              scope: "global",
              reason: "rfc8058_unsubscribe",
              source: channel,
            });
          }
          const suppression = await opts.store.recordContactSuppression({
            contactHash,
            reason: "rfc8058_unsubscribe",
            sourceChannel: channel,
            isMinor: false,
          });
          const cancelledCount = await opts.store.cancelPendingOutreachForContact({
            contactHashes: [contactHash, contactKey, ...(normalizedPhone ? [normalizedPhone] : [])],
            contactEmail: isEmail ? contactKey : null,
            reason: "rfc8058_unsubscribe",
          });
          await opts.store.recordOperatorAudit({
            actor: "recipient_unsubscribe",
            action: "contact_unsubscribed",
            targetType: "contact_suppression",
            targetId: contactHash,
            detail: { channel, cancelledOutreach: cancelledCount },
          });
          analytics.invalidateCache();
          eventHub.publish("compliance", {
            action: "unsubscribe",
            contactHash,
            cancelledCount,
          });
          return jsonResponse({
            ok: true,
            suppressed: true,
            contactHash: suppression.contactHash,
            cancelledOutreach: cancelledCount,
          });
        } catch (err) {
          return mapErrorToResponse(err);
        }
      }

      if (method === "POST" && path.startsWith("/api/webhooks/")) {
        try {
          const rawText = await readBoundedText(request, MAX_PUBLIC_BODY_BYTES);
          let payload: Record<string, unknown> = {};
          if (rawText.trim()) {
            const parsed: unknown = JSON.parse(rawText);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              payload = parsed as Record<string, unknown>;
            }
          }

          const emailWebhookMatch = /^\/api\/webhooks\/email\/([^/]+)$/.exec(path);
          if (emailWebhookMatch?.[1]) {
            const provider = decodeURIComponent(emailWebhookMatch[1]).toLowerCase();
            const sigHeader =
              request.headers.get("svix-signature") ??
              request.headers.get("x-webhook-signature") ??
              request.headers.get("x-postmark-signature");
            if (
              !verifyWebhookHmac(
                rawText,
                sigHeader,
                env.RESEND_WEBHOOK_SECRET ?? env.MARKETING_WEBHOOK_SECRET,
                deployedEnv,
              )
            ) {
              return jsonResponse({ error: "Invalid webhook signature" }, 401);
            }
            const rawEventType =
              typeof payload.type === "string"
                ? payload.type
                : typeof payload.event === "string"
                  ? payload.event
                  : "delivered";
            const eventType = rawEventType.toLowerCase();
            const dataObj =
              payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
                ? (payload.data as Record<string, unknown>)
                : payload;
            const recipientEmail =
              typeof dataObj.to === "string"
                ? dataObj.to
                : Array.isArray(dataObj.to) && typeof dataObj.to[0] === "string"
                  ? dataObj.to[0]
                  : typeof dataObj.email === "string"
                    ? dataObj.email
                    : null;
            const messageId =
              typeof dataObj.email_id === "string"
                ? dataObj.email_id
                : typeof dataObj.message_id === "string"
                  ? dataObj.message_id
                  : null;
            const isBounce = eventType.includes("bounce");
            const isComplaint = eventType.includes("complain") || eventType.includes("spam");
            const isReply = eventType.includes("repl");
            const isClick = eventType.includes("click");
            const nowMs = clock.now();
            const d = new Date(nowMs);

            compliance.recordHttpOutcome(`paid:email:${provider}`, {
              ok: !isBounce && !isComplaint,
              status: isBounce || isComplaint ? 550 : 200,
              hardBounce: isBounce,
              spamComplaint: isComplaint,
              stopped: isComplaint,
            });

            if (recipientEmail && (isBounce || isComplaint)) {
              const emailHash = keyedContactHash("email", recipientEmail, env) ?? recipientEmail;
              compliance.suppression.suppress({
                kind: "email",
                value: recipientEmail,
                scope: "global",
                reason: isComplaint ? "spam_complaint_webhook" : "hard_bounce_webhook",
                source: provider,
              });
              await opts.store.recordContactSuppression({
                contactHash: emailHash,
                reason: isComplaint ? "spam_complaint_webhook" : "hard_bounce_webhook",
                sourceChannel: provider,
                isMinor: false,
              });
              await opts.store.cancelPendingOutreachForContact({ contactHash: emailHash });
            }

            if (messageId) {
              const msgs = await opts.store.listOutreachMessages({ limit: 500 });
              const found = msgs.find((m) => m.externalRef === messageId);
              if (found) {
                const nextStatus = isBounce
                  ? "bounced"
                  : isReply
                    ? "replied"
                    : eventType.includes("deliver")
                      ? "delivered"
                      : found.status;
                if (nextStatus !== found.status) {
                  await opts.store.updateOutreachStatus(found.id, nextStatus, found.externalRef);
                }
              }
            }

            analytics.ingestOutreachTelemetry({
              occurredAt: nowMs,
              appId: "ntwrk",
              city: "nyc",
              channel: "email",
              localDayOfWeek: d.getUTCDay(),
              localHour: d.getUTCHours(),
              sent: 0,
              delivered: eventType.includes("deliver") ? 1 : 0,
              clicked: isClick ? 1 : 0,
              replied: isReply ? 1 : 0,
              converted: 0,
              stopped: isComplaint ? 1 : 0,
              bounced: isBounce ? 1 : 0,
              rateLimited429: 0,
            });
            eventHub.publish("outreach", { action: "webhook_email", provider, eventType });
            return jsonResponse({ ok: true, provider, eventType });
          }

          const socialWebhookMatch = /^\/api\/webhooks\/social\/([^/]+)$/.exec(path);
          if (socialWebhookMatch?.[1]) {
            const platform = decodeURIComponent(socialWebhookMatch[1]).toLowerCase();
            const sigHeader = request.headers.get("x-webhook-signature");
            if (!verifyWebhookHmac(rawText, sigHeader, env.MARKETING_WEBHOOK_SECRET, deployedEnv)) {
              return jsonResponse({ error: "Invalid webhook signature" }, 401);
            }
            const text = typeof payload.text === "string" ? payload.text : "";
            const senderHandle =
              typeof payload.handle === "string"
                ? payload.handle
                : typeof payload.sender === "string"
                  ? payload.sender
                  : "unknown";
            const isStop = isGlobalOptOutText(text) || payload.event === "stop";
            const nowMs = clock.now();
            const d = new Date(nowMs);
            if (isStop) {
              const handleHash = keyedContactHash("handle", `${platform}:${senderHandle}`, env) ?? `${platform}:${senderHandle}`;
              compliance.suppression.suppress({
                kind: "handle",
                value: senderHandle,
                platform,
                scope: "global",
                reason: "social_stop_webhook",
                source: platform,
              });
              await opts.store.recordContactSuppression({
                contactHash: handleHash,
                reason: "social_stop_webhook",
                sourceChannel: platform,
                isMinor: false,
              });
              await opts.store.cancelPendingOutreachForContact({ contactHash: handleHash });
              compliance.recordHttpOutcome(`social:${platform}`, { ok: true, stopped: true });
            }
            analytics.ingestOutreachTelemetry({
              occurredAt: nowMs,
              appId: "ntwrk",
              city: typeof payload.city === "string" ? payload.city : "nyc",
              channel: platform,
              localDayOfWeek: d.getUTCDay(),
              localHour: d.getUTCHours(),
              sent: 0,
              delivered: 0,
              clicked: 0,
              replied: isStop ? 0 : 1,
              converted: 0,
              stopped: isStop ? 1 : 0,
              bounced: 0,
              rateLimited429: 0,
            });
            eventHub.publish("outreach", { action: "webhook_social", platform, isStop });
            return jsonResponse({ ok: true, platform, isStop });
          }

          if (path === "/api/webhooks/dub") {
            const sigHeader = request.headers.get("dub-signature") ?? request.headers.get("x-webhook-signature");
            if (!verifyWebhookHmac(rawText, sigHeader, env.DUB_WEBHOOK_SECRET ?? env.MARKETING_WEBHOOK_SECRET, deployedEnv)) {
              return jsonResponse({ error: "Invalid webhook signature" }, 401);
            }
            const batchCode =
              typeof payload.qrBatchCode === "string"
                ? payload.qrBatchCode.trim()
                : typeof payload.slug === "string"
                  ? payload.slug.trim()
                  : null;
            const city = typeof payload.city === "string" ? payload.city.trim().toLowerCase() : "nyc";
            const appId = parseBrandAppId(payload.appId, "ntwrk");
            const campaignId =
              typeof payload.campaignId === "string" && payload.campaignId.trim()
                ? payload.campaignId.trim()
                : (await opts.store.listCampaigns({ status: "active", limit: 1 }))[0]?.id;
            if (batchCode) {
              await opts.store.incrementQrBatchStats(batchCode, { scans: 1 });
            }
            if (campaignId) {
              await opts.store.recordAttributionEvent({
                campaignId,
                qrBatchCode: batchCode,
                eventKind: batchCode ? "qr_scan" : "link_click",
                city,
                appId,
                count: 1,
                metadata: { source: "dub_webhook", slug: batchCode ?? "" },
              });
            }
            analytics.ingestFunnelEvent({
              eventId: `dub-${clock.now()}`,
              actorKey: typeof payload.visitorId === "string" ? payload.visitorId : `dub-${clock.now()}`,
              stage: "link_click",
              occurredAt: clock.now(),
              appId,
              city,
              channel: batchCode ? "qr" : "shortlink",
              campaignId,
            });
            eventHub.publish("attribution", { action: "webhook_dub", batchCode, city });
            return jsonResponse({ ok: true, batchCode });
          }

          if (path === "/api/webhooks/luma") {
            const sigHeader = request.headers.get("x-luma-signature") ?? request.headers.get("x-webhook-signature");
            if (!verifyWebhookHmac(rawText, sigHeader, env.LUMA_WEBHOOK_SECRET ?? env.MARKETING_WEBHOOK_SECRET, deployedEnv)) {
              return jsonResponse({ error: "Invalid webhook signature" }, 401);
            }
            const city = typeof payload.city === "string" ? payload.city.trim().toLowerCase() : "nyc";
            const appId = parseBrandAppId(payload.appId, "friends");
            const campaignId =
              typeof payload.campaignId === "string" && payload.campaignId.trim()
                ? payload.campaignId.trim()
                : (await opts.store.listCampaigns({ status: "active", limit: 1 }))[0]?.id;
            if (campaignId) {
              await opts.store.recordAttributionEvent({
                campaignId,
                eventKind: "cta_triggered",
                city,
                appId,
                count: 1,
                metadata: {
                  source: "luma_webhook",
                  eventId: typeof payload.eventId === "string" ? payload.eventId : "",
                },
              });
            }
            analytics.ingestFunnelEvent({
              eventId: `luma-${clock.now()}`,
              actorKey: typeof payload.guestId === "string" ? payload.guestId : `luma-${clock.now()}`,
              stage: "cta_triggered",
              occurredAt: clock.now(),
              appId,
              city,
              channel: "luma",
              campaignId,
            });
            eventHub.publish("attribution", { action: "webhook_luma", city });
            return jsonResponse({ ok: true, source: "luma" });
          }

          if (path === "/api/webhooks/beacon") {
            const sigHeader = request.headers.get("x-webhook-signature");
            if (!verifyWebhookHmac(rawText, sigHeader, env.MARKETING_WEBHOOK_SECRET, deployedEnv)) {
              return jsonResponse({ error: "Invalid webhook signature" }, 401);
            }
            const eventsList = Array.isArray(payload.events)
              ? (payload.events as Record<string, unknown>[])
              : [payload];
            if (eventsList.length > MAX_BEACON_BATCH_SIZE) {
              return jsonResponse(
                { error: `Beacon batch exceeds maximum of ${MAX_BEACON_BATCH_SIZE} events.`, code: "BATCH_TOO_LARGE" },
                400,
              );
            }
            const defaultCampaignId = (await opts.store.listCampaigns({ status: "active", limit: 1 }))[0]?.id;
            let recorded = 0;
            for (const item of eventsList) {
              const city = typeof item.city === "string" ? item.city.trim().toLowerCase() : "nyc";
              const appId = parseBrandAppId(item.appId, "ntwrk");
              const rawEventName =
                typeof item.event === "string"
                  ? item.event
                  : typeof item.eventKind === "string"
                    ? item.eventKind
                    : "site_visit";
              const eventName = rawEventName.toLowerCase();
              const eventKind =
                eventName === "cta_triggered" || eventName === "cta_click"
                  ? "cta_triggered"
                  : eventName === "signup_started"
                    ? "signup_started"
                    : "site_visit";
              const campaignId =
                typeof item.campaignId === "string" && item.campaignId.trim()
                  ? item.campaignId.trim()
                  : defaultCampaignId;
              if (campaignId) {
                await opts.store.recordAttributionEvent({
                  campaignId,
                  qrBatchCode: typeof item.qrBatchCode === "string" ? item.qrBatchCode : null,
                  eventKind,
                  city,
                  appId,
                  count: 1,
                  metadata: {
                    source: "beacon",
                    utmSource: typeof item.utmSource === "string" ? item.utmSource : "",
                    utmCampaign: typeof item.utmCampaign === "string" ? item.utmCampaign : "",
                  },
                });
              }
              analytics.ingestFunnelEvent({
                eventId: `beacon-${clock.now()}-${recorded}`,
                actorKey: typeof item.visitorId === "string" ? item.visitorId : `beacon-${clock.now()}-${recorded}`,
                stage: eventKind === "cta_triggered" || eventKind === "signup_started" ? "cta_triggered" : "site_visit",
                occurredAt: clock.now(),
                appId,
                city,
                channel: typeof item.utmSource === "string" && item.utmSource ? item.utmSource : "web",
                campaignId,
              });
              recorded += 1;
            }
            eventHub.publish("analytics", { action: "webhook_beacon", recorded });
            return jsonResponse({ ok: true, recorded });
          }

          return jsonResponse({ error: `Unknown webhook route: ${path}` }, 404);
        } catch (err) {
          return mapErrorToResponse(err);
        }
      }

      if (path.startsWith("/api/")) {
        const unauthorized = requireAuth(request);
        if (unauthorized) return unauthorized;
      } else {
        return jsonResponse({ error: "Not found" }, 404);
      }

      try {
        // SSE stream
        if (method === "GET" && path === "/api/events") {
          return eventHub.createStreamResponse(request.signal);
        }

        if (method === "GET" && path === "/api/overview") {
          const campaignId = url.searchParams.get("campaignId") ?? undefined;
          const [overview, banditArms, compliancePayload] = await Promise.all([
            opts.store.getOverview(campaignId),
            opts.store.listBanditArms(campaignId ? { campaignId, limit: 100 } : { limit: 100 }),
            buildCompliancePayload(),
          ]);
          return jsonResponse({
            ...overview,
            tracks: NYC_MONTH1_BUDGET_TRACKS,
            banditArms,
            daemon: daemon.getStatus(),
            adapters: paidAdapters.listStatus(),
            socialAdapters: socialAdapters.getStatus(),
            adAdapters: adAdapters.getStatus(),
            slopCash: slopCashBridge.status(),
            compliance: compliancePayload,
            directory: {
              agencies: VETTED_NYC_AGENCIES.length,
              platforms: SELF_SERVICE_PLATFORMS.length,
              printers: NYC_LOCAL_PRINTERS.length,
            },
          });
        }
        if (method === "GET" && path === "/api/ops-summary") {
          const campaignId = url.searchParams.get("campaignId") ?? undefined;
          const [overview, banditArms, cities, desireLanes, llmUsage, corePressure, compliancePayload] =
            await Promise.all([
              opts.store.getOverview(campaignId),
              opts.store.listBanditArms(campaignId ? { campaignId, limit: 100 } : { limit: 100 }),
              buildCitiesPayload(),
              buildDesireLanesPayload(),
              buildLlmUsagePayload({ campaignId }),
              buildCorePressurePayload(),
              buildCompliancePayload(),
            ]);
          return jsonResponse({
            overview: {
              ...overview,
              tracks: NYC_MONTH1_BUDGET_TRACKS,
              banditArms,
              daemon: daemon.getStatus(),
              adapters: paidAdapters.listStatus(),
              socialAdapters: socialAdapters.getStatus(),
              adAdapters: adAdapters.getStatus(),
              slopCash: slopCashBridge.status(),
              compliance: compliancePayload,
            },
            cities,
            desireLanes,
            llmUsage,
            corePressure,
            compliance: compliancePayload,
          });
        }

        if (method === "GET" && path === "/api/compliance") {
          return jsonResponse(await buildCompliancePayload());
        }
        const breakerResetMatch = /^\/api\/compliance\/breakers\/([^/]+)\/reset$/.exec(path);
        if (method === "POST" && breakerResetMatch?.[1]) {
          const scope = decodeURIComponent(breakerResetMatch[1]);
          const snapshot = compliance.resetBreaker(scope);
          await opts.store.recordOperatorAudit({
            actor: "operator",
            action: "breaker_reset",
            targetType: "circuit_breaker",
            targetId: scope,
            detail: { state: snapshot.state },
          });
          eventHub.publish("compliance", { action: "breaker_reset", scope });
          return jsonResponse({ ok: true, scope, snapshot });
        }

        if (method === "GET" && path === "/api/analytics/funnel") {
          const filter = parseAnalyticsFilter(url.searchParams);
          return jsonResponse(await analytics.getFunnel(filter));
        }
        if (method === "GET" && path === "/api/analytics/cohorts") {
          const filter = parseAnalyticsFilter(url.searchParams);
          return jsonResponse(await analytics.getCohorts(filter));
        }
        if (method === "GET" && path === "/api/analytics/attribution") {
          const filter = parseAnalyticsFilter(url.searchParams);
          const rawModel = url.searchParams.get("model")?.trim() ?? "last_touch";
          const model: AttributionModel =
            rawModel === "first_touch" || rawModel === "linear" ? rawModel : "last_touch";
          return jsonResponse(await analytics.getAttribution(model, filter));
        }
        if (method === "GET" && path === "/api/analytics/heatmap") {
          const filter = parseAnalyticsFilter(url.searchParams);
          return jsonResponse(await analytics.getHeatmap(filter));
        }
        if (method === "GET" && path === "/api/analytics/timeseries") {
          const filter = parseAnalyticsFilter(url.searchParams);
          const rawGran = url.searchParams.get("granularity")?.trim() ?? "day";
          const granularity: "hour" | "day" | "week" =
            rawGran === "hour" || rawGran === "week" ? rawGran : "day";
          return jsonResponse(await analytics.getTimeSeries(granularity, filter));
        }
        if (method === "GET" && path === "/api/analytics/anomalies") {
          const filter = parseAnalyticsFilter(url.searchParams);
          return jsonResponse(await analytics.getAnomalies(filter));
        }
        if ((method === "POST" || method === "GET") && path === "/api/analytics/slice") {
          const raw = method === "POST" ? await readJsonBody(request) : {};
          const metricRaw =
            typeof raw.metric === "string"
              ? raw.metric
              : url.searchParams.get("metric") ?? "site_visits";
          const metric = metricRaw as SliceMetric;
          const granRaw =
            typeof raw.granularity === "string"
              ? raw.granularity
              : url.searchParams.get("granularity") ?? "day";
          const granularity: SliceGranularity =
            granRaw === "hour" || granRaw === "week" || granRaw === "total" ? granRaw : "day";
          const groupByRaw = Array.isArray(raw.groupBy)
            ? raw.groupBy.map(String)
            : (url.searchParams.get("groupBy")?.split(",").filter(Boolean) ?? []);
          const groupBy = groupByRaw.slice(0, 2) as SliceDimension[];
          const formatRaw =
            typeof raw.format === "string"
              ? raw.format
              : url.searchParams.get("format") ?? "json";
          const filter =
            raw.filter && typeof raw.filter === "object"
              ? (raw.filter as AnalyticsFilter)
              : parseAnalyticsFilter(url.searchParams);
          const result = await analytics.querySlice({ metric, granularity, groupBy, filter });
          if (formatRaw === "csv") {
            return new Response(analytics.exportSliceCsv(result), {
              status: 200,
              headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
              },
            });
          }
          return jsonResponse(result);
        }

        if (method === "GET" && path === "/api/trajectories") {
          const limitRaw = Number(url.searchParams.get("limit") ?? 50);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.round(limitRaw)) : 50;
          const appId = (url.searchParams.get("appId")?.trim() || undefined) as TrajectoryApp | undefined;
          const kind = (url.searchParams.get("kind")?.trim() || undefined) as TrajectoryKind | undefined;
          const status = (url.searchParams.get("status")?.trim() || undefined) as TrajectoryStatus | undefined;
          const flag = url.searchParams.get("flag")?.trim() || undefined;
          const [apiTraj, simTraj] = await Promise.all([
            analytics.listTrajectories({ appId, kind, status, flag, limit }),
            gameSession.isInitialized()
              ? gameSession.listSimTrajectories(limit)
              : Promise.resolve({ traces: [], hotTail: [] }),
          ]);
          const seen = new Set<string>();
          const traces = [...apiTraj.traces, ...simTraj.traces]
            .filter((t) => {
              if (seen.has(t.traceId)) return false;
              seen.add(t.traceId);
              return true;
            })
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, limit);
          const hotTail = [...apiTraj.hotTail, ...simTraj.hotTail]
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, limit);
          return jsonResponse({ traces, hotTail, driver: apiTraj.driver });
        }
        const trajectoryDetailMatch = /^\/api\/trajectories\/([^/]+)$/.exec(path);
        if (method === "GET" && trajectoryDetailMatch?.[1]) {
          const traceId = decodeURIComponent(trajectoryDetailMatch[1]);
          const decrypt = url.searchParams.get("decrypt") === "1" || url.searchParams.get("decrypt") === "true";
          const apiDetail = await analytics.readTrace(traceId, decrypt);
          if (apiDetail.spans.length > 0 || apiDetail.manifest) {
            return jsonResponse(apiDetail);
          }
          if (gameSession.isInitialized()) {
            const simDetail = await gameSession.readSimTrace(traceId, decrypt);
            return jsonResponse({ traceId, ...simDetail });
          }
          return jsonResponse({ traceId, manifest: null, spans: [] });
        }

        if (path === "/api/sim/state" || path === "/api/sim/command" || path.startsWith("/api/sim/mock/")) {
          if (deployedEnv) {
            return jsonResponse(
              {
                error: "Interactive simulation routes are disabled in staging/production.",
                code: "SIM_DISABLED_IN_DEPLOYED_ENV",
              },
              403,
            );
          }
        }
        if (method === "GET" && path === "/api/sim/state") {
          return jsonResponse(await gameSession.getState());
        }
        if (method === "POST" && path === "/api/sim/command") {
          const raw = await readJsonBody(request);
          const res = await gameSession.dispatchCommand(raw);
          return jsonResponse(res, res.ok ? 200 : 400);
        }
        if (method === "GET" && path === "/api/sim/mock/traffic") {
          const service = url.searchParams.get("service")?.trim() || undefined;
          const statusRaw = url.searchParams.get("status");
          const status = statusRaw !== null && Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : undefined;
          const limitRaw = Number(url.searchParams.get("limit") ?? 60);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.round(limitRaw)) : 60;
          return jsonResponse(gameSession.getMockTraffic({ service, status, limit }));
        }
        const mockStateMatch = /^\/api\/sim\/mock\/state\/([^/]+)$/.exec(path);
        if (method === "GET" && mockStateMatch?.[1]) {
          const service = decodeURIComponent(mockStateMatch[1]);
          const state = await gameSession.getMockServiceState(service);
          return jsonResponse({ service, state });
        }

        // Multi-city launch seeding (POST /api/seed/:city, including /api/seed/nyc)
        const seedCityMatch = /^\/api\/seed\/([^/]+)$/.exec(path);
        if (method === "POST" && seedCityMatch?.[1]) {
          const rawCity = decodeURIComponent(seedCityMatch[1]);
          const city = parseCityParam(rawCity, "city");
          const parsedBody = parseSeedCity(await readJsonBody(request));
          const seeded = await seedCityLaunch(opts.store, city, {
            monthlyBudgetCents: parsedBody.monthlyBudgetCents,
            dailyCapCents: parsedBody.dailyCapCents,
            maxTaskCents: parsedBody.maxTaskCents,
          });
          if (parsedBody.riskDial !== undefined || parsedBody.billingArmed !== undefined) {
            seeded.campaign = await opts.store.setRiskDial(
              seeded.campaign.id,
              parsedBody.riskDial ?? seeded.campaign.riskDial,
              parsedBody.billingArmed,
            );
          }
          eventHub.publish("overview", {
            action: `seed_${city}`,
            city,
            campaignId: seeded.campaign.id,
          });
          return jsonResponse({ ok: true, ...seeded }, 200);
        }

        // Directory, Multi-city Registry, Desire Lanes, LLM Usage, Suppressions, Core Pressure, Simulator
        if (method === "GET" && path === "/api/cities") {
          return jsonResponse({ cities: await buildCitiesPayload() });
        }
        if (method === "GET" && path === "/api/directory") {
          const cityParam = url.searchParams.get("city")?.trim().toLowerCase();
          if (cityParam && cityParam !== "all") {
            const pack = requireCityPack(parseCityParam(cityParam, "city"));
            return jsonResponse({
              city: pack.code,
              cityPack: pack,
              agencies: pack.vendors.vettedAgencies,
              platforms: pack.vendors.platforms,
              printers: pack.vendors.printers,
              tracks: NYC_MONTH1_BUDGET_TRACKS,
              connectors: pack.discovery.openDataConnectors,
              corridors: pack.corridors,
            });
          }
          return jsonResponse({
            city: "all",
            agencies: VETTED_NYC_AGENCIES,
            platforms: SELF_SERVICE_PLATFORMS,
            printers: NYC_LOCAL_PRINTERS,
            tracks: NYC_MONTH1_BUDGET_TRACKS,
            weeklyRollout: NYC_MONTH1_WEEKLY_ROLLOUT,
            corridors: NYC_ACTIVATION_CORRIDORS,
            cities: listCityPacks(),
          });
        }
        if (method === "GET" && path === "/api/desire-lanes") {
          return jsonResponse(await buildDesireLanesPayload());
        }
        if (method === "GET" && path === "/api/llm/usage") {
          const dayIso = url.searchParams.get("dayIso")?.trim() || undefined;
          const agentId = url.searchParams.get("agentId")?.trim() || undefined;
          const campaignId = url.searchParams.get("campaignId")?.trim() || undefined;
          return jsonResponse(await buildLlmUsagePayload({ dayIso, agentId, campaignId }));
        }
        if (method === "GET" && path === "/api/llm/trajectories") {
          const q = parsePaginationQuery(url.searchParams);
          const agentId = url.searchParams.get("agentId")?.trim() || undefined;
          const trajectories = await opts.store.listLlmTrajectories({
            agentId,
            campaignId: q.campaignId,
            limit: q.limit,
          });
          return jsonResponse({ trajectories });
        }
        if (method === "GET" && path === "/api/suppressions") {
          const q = parsePaginationQuery(url.searchParams);
          const suppressions = await opts.store.listContactSuppressions(q.limit);
          return jsonResponse({ suppressions });
        }
        if (method === "POST" && path === "/api/suppressions") {
          const body = parseContactSuppression(await readJsonBody(request));
          const resolvedHash =
            body.contactHash ??
            (body.phone ? keyedContactHash("phone", body.phone, env) : null) ??
            (body.email ? keyedContactHash("email", body.email, env) : null);
          if (!resolvedHash) {
            throw new HttpValidationError(
              400,
              "INVALID_CONTACT",
              "Could not normalize phone or email for contact suppression hash.",
            );
          }
          const suppression = await opts.store.recordContactSuppression({
            contactHash: resolvedHash,
            reason: body.reason,
            sourceChannel: body.sourceChannel,
            isMinor: body.isMinor,
          });
          await opts.store.cancelPendingOutreachForContact({ contactHash: resolvedHash, reason: body.reason });
          await opts.store.recordOperatorAudit({
            actor: "operator",
            action: "contact_suppressed",
            targetType: "contact_suppression",
            targetId: suppression.contactHash,
            detail: { reason: body.reason, isMinor: body.isMinor },
          });
          analytics.invalidateCache();
          eventHub.publish("human", {
            action: "suppressed",
            contactHash: suppression.contactHash,
            isMinor: suppression.isMinor,
          });
          return jsonResponse({ ok: true, suppression }, 201);
        }
        if (method === "GET" && path === "/api/core-pressure") {
          return jsonResponse(await buildCorePressurePayload());
        }
        if (method === "POST" && path === "/api/simulate/launch") {
          const rl = compliance.checkRouteRateLimit("simulate_launch", 30, 60_000, 10);
          if (!rl.allowed) {
            return new Response(JSON.stringify({ error: "Rate limit exceeded", retryAfterMs: rl.retryAfterMs }), {
              status: 429,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Retry-After": String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))),
              },
            });
          }
          const body = parseSimRequest(await readJsonBody(request));
          const days = Math.min(30, body.days ?? (body.quick ? 10 : 30));
          const seeds = (body.seeds ?? [11]).slice(0, 4);
          const summary = await runMarketingSim({
            seed: seeds[0],
            days,
            cities: body.cities,
            quick: body.quick,
          });
          return jsonResponse({ ok: true, summary }, 200);
        }

        // Campaigns
        if (method === "GET" && path === "/api/campaigns") {
          const q = parsePaginationQuery(url.searchParams);
          const campaigns = await opts.store.listCampaigns({
            city: q.city,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ campaigns });
        }
        if (method === "POST" && path === "/api/campaigns") {
          const body = parseCreateCampaign(await readJsonBody(request));
          const campaign = await opts.store.createCampaign(body);
          eventHub.publish("campaign", { action: "created", id: campaign.id });
          return jsonResponse({ campaign }, 201);
        }
        const riskDialMatch = /^\/api\/campaigns\/([^/]+)\/risk-dial$/.exec(path);
        if (method === "POST" && riskDialMatch?.[1]) {
          const id = decodeURIComponent(riskDialMatch[1]);
          const body = parseRiskDialUpdate(await readJsonBody(request));
          const campaign = await opts.store.setRiskDial(id, body.riskDial, body.billingArmed);
          await opts.store.recordOperatorAudit({
            actor: "operator",
            action: "risk_dial_changed",
            targetType: "campaign",
            targetId: campaign.id,
            detail: { riskDial: campaign.riskDial, billingArmed: campaign.billingArmed },
          });
          analytics.invalidateCache();
          eventHub.publish("campaign", {
            action: "risk_dial",
            id: campaign.id,
            riskDial: campaign.riskDial,
            billingArmed: campaign.billingArmed,
          });
          return jsonResponse({ campaign });
        }
        const campaignPatchMatch = /^\/api\/campaigns\/([^/]+)$/.exec(path);
        if ((method === "PATCH" || method === "PUT") && campaignPatchMatch?.[1]) {
          const id = decodeURIComponent(campaignPatchMatch[1]);
          const body = parseUpdateCampaign(await readJsonBody(request));
          const campaign = await opts.store.updateCampaign(id, body);
          eventHub.publish("campaign", { action: "updated", id: campaign.id });
          return jsonResponse({ campaign });
        }

        // Agents
        if (method === "GET" && path === "/api/agents") {
          const q = parsePaginationQuery(url.searchParams);
          const agents = await opts.store.listAgents({ limit: q.limit, offset: q.offset });
          return jsonResponse({ agents });
        }
        if (method === "POST" && path === "/api/agents") {
          const body = parseCreateAgent(await readJsonBody(request));
          const agent = await agentManager.registerAgent(body);
          eventHub.publish("agent", { action: "registered", id: agent.id });
          return jsonResponse({ agent }, 201);
        }
        const agentProviderMatch = /^\/api\/agents\/([^/]+)\/provider$/.exec(path);
        if (method === "POST" && agentProviderMatch?.[1]) {
          const id = decodeURIComponent(agentProviderMatch[1]);
          const raw = await readJsonBody(request);
          const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
          if (!SUPPORTED_SUBSCRIPTION_PROVIDERS.includes(provider as SubscriptionProvider)) {
            throw new HttpValidationError(
              400,
              "INVALID_PROVIDER",
              `provider must be one of: ${SUPPORTED_SUBSCRIPTION_PROVIDERS.join(", ")}.`,
            );
          }
          const existing = await opts.store.getAgent(id);
          if (!existing) throw new HttpValidationError(404, "NOT_FOUND", `Agent not found: ${id}`);
          const rawFailover = raw.failoverProvider;
          const failover =
            rawFailover === undefined
              ? existing.failoverProvider
              : rawFailover === null
                ? null
                : typeof rawFailover === "string" &&
                    SUPPORTED_SUBSCRIPTION_PROVIDERS.includes(rawFailover as SubscriptionProvider)
                  ? (rawFailover as SubscriptionProvider)
                  : (() => {
                      throw new HttpValidationError(
                        400,
                        "INVALID_PROVIDER",
                        "Invalid failoverProvider.",
                      );
                    })();
          const agent = await opts.store.updateAgent(id, {
            provider: provider as SubscriptionProvider,
            failoverProvider: failover,
            sessionRef: `sub:${provider}:${existing.personaId}`,
          });
          eventHub.publish("agent", { action: "provider_switched", id: agent.id, provider });
          return jsonResponse({ agent });
        }
        const agentPatchMatch = /^\/api\/agents\/([^/]+)$/.exec(path);
        if (method === "PATCH" && agentPatchMatch?.[1]) {
          const id = decodeURIComponent(agentPatchMatch[1]);
          const raw = await readJsonBody(request);
          const existing = await opts.store.getAgent(id);
          if (!existing) throw new HttpValidationError(404, "NOT_FOUND", `Agent not found: ${id}`);
          const patch: Partial<Omit<MarketingAgent, "id" | "personaId">> = {};
          if (raw.provider !== undefined) {
            if (
              typeof raw.provider !== "string" ||
              !SUPPORTED_SUBSCRIPTION_PROVIDERS.includes(raw.provider as SubscriptionProvider)
            ) {
              throw new HttpValidationError(400, "INVALID_PROVIDER", "Invalid provider.");
            }
            patch.provider = raw.provider as SubscriptionProvider;
            patch.sessionRef = `sub:${raw.provider}:${existing.personaId}`;
          }
          if (raw.dailyTurnCap !== undefined) {
            if (typeof raw.dailyTurnCap !== "number" || !Number.isInteger(raw.dailyTurnCap) || raw.dailyTurnCap < 1) {
              throw new HttpValidationError(400, "INVALID_NUMBER", "dailyTurnCap must be a positive integer.");
            }
            patch.dailyTurnCap = raw.dailyTurnCap;
          }
          const agent = await opts.store.updateAgent(id, patch);
          eventHub.publish("agent", { action: "updated", id: agent.id });
          return jsonResponse({ agent });
        }
        const agentTickMatch = /^\/api\/agents\/([^/]+)\/tick$/.exec(path);
        if (method === "POST" && agentTickMatch?.[1]) {
          const id = decodeURIComponent(agentTickMatch[1]);
          const body = parseAgentTick(await readJsonBody(request));
          const targetContact =
            body.targetHumanId || body.targetStopped !== undefined || body.lastMessageText
              ? {
                  id: body.targetHumanId ?? undefined,
                  stopped: body.targetStopped,
                  lastMessageText: body.lastMessageText,
                }
              : null;
          const result = await agentManager.dispatchTurn(id, body.prompt, {
            campaignId: body.campaignId ?? null,
            targetContact,
            lockdown: body.lockdown,
            allowFailover: body.allowFailover,
            dryRun: body.dryRun,
          });
          eventHub.publish("agent", { action: "tick", id, ok: result.ok });
          return jsonResponse(result, result.ok ? 200 : 403);
        }
        const agentPauseMatch = /^\/api\/agents\/([^/]+)\/pause$/.exec(path);
        if (method === "POST" && agentPauseMatch?.[1]) {
          const id = decodeURIComponent(agentPauseMatch[1]);
          const agent = await agentManager.pauseAgent(id);
          eventHub.publish("agent", { action: "paused", id: agent.id });
          return jsonResponse({ agent });
        }
        const agentResumeMatch = /^\/api\/agents\/([^/]+)\/resume$/.exec(path);
        if (method === "POST" && agentResumeMatch?.[1]) {
          const id = decodeURIComponent(agentResumeMatch[1]);
          const agent = await agentManager.resumeAgent(id);
          eventHub.publish("agent", { action: "resumed", id: agent.id });
          return jsonResponse({ agent });
        }

        // Devices
        if (method === "GET" && path === "/api/devices") {
          const q = parsePaginationQuery(url.searchParams);
          const devices = await opts.store.listDevices({ limit: q.limit, offset: q.offset });
          return jsonResponse({ devices });
        }
        if (method === "POST" && path === "/api/devices") {
          const body = parseCreateDevice(await readJsonBody(request));
          const device = await opts.store.upsertDevice({ ...body, preserveCounters: true });
          eventHub.publish("device", { action: "registered", id: device.id });
          return jsonResponse({ device }, 201);
        }
        if (method === "POST" && path === "/api/devices/scan") {
          const scan = await deviceBridge.scanConnectedDevices();
          const upserted: DeviceNode[] = [];
          for (const scanned of scan.devices) {
            const node = toDeviceNode(scanned, clock);
            upserted.push(
              await opts.store.upsertDevice({
                id: node.id,
                label: node.label,
                platform: node.platform,
                hostMachine: node.hostMachine,
                serialOrUdid: node.serialOrUdid,
                batteryPct: node.batteryPct,
                tempC: node.tempC,
                warmupDay: node.warmupDay,
                warmupStage: node.warmupStage,
                dailyActionsUsed: node.dailyActionsUsed,
                dailyActionCap: node.dailyActionCap,
                status: node.status,
                preserveCounters: true,
              }),
            );
          }
          const diagnostics = await deviceBridge.buildSetupDiagnostics();
          eventHub.publish("device", { action: "scanned", count: upserted.length });
          return jsonResponse({ scan, devices: upserted, diagnostics });
        }
        const deviceActionMatch = /^\/api\/devices\/([^/]+)\/action$/.exec(path);
        if (method === "POST" && deviceActionMatch?.[1]) {
          const id = decodeURIComponent(deviceActionMatch[1]);
          let device = await opts.store.getDevice(id);
          if (!device) throw new HttpValidationError(404, "NOT_FOUND", `Device not found: ${id}`);
          const body = parseDeviceAction(await readJsonBody(request));
          if (
            body.batteryPct !== undefined ||
            body.tempC !== undefined ||
            body.warmupDay !== undefined
          ) {
            device = await opts.store.updateDeviceTelemetry(device.id, {
              batteryPct: body.batteryPct ?? device.batteryPct,
              tempC: body.tempC ?? device.tempC,
              warmupDay: body.warmupDay ?? device.warmupDay,
            });
          }
          const leaseHolder = body.leaseHolder ?? "operator";
          const context: DeviceActionContext = {
            leaseHolder,
            lockdown: Boolean(body.lockdown),
            targetStopped: Boolean(body.targetStopped),
            dryRun: body.dryRun,
            challengeDetected: body.challengeDetected,
          };
          const result = await deviceBridge.executeDeviceAction(
            device,
            body.action,
            context,
          );
          if (!result.ok) {
            if (body.challengeDetected) {
              await opts.store.recordDeviceAction({
                deviceId: device.id,
                leaseHolder,
                lockdown: Boolean(body.lockdown),
                targetStopped: Boolean(body.targetStopped),
                challengeDetected: true,
              });
            }
            return jsonResponse(result, 403);
          }
          const receipt = await opts.store.recordDeviceAction({
            deviceId: device.id,
            leaseHolder,
            lockdown: Boolean(body.lockdown),
            targetStopped: Boolean(body.targetStopped),
            challengeDetected: Boolean(body.challengeDetected),
          });
          if (!receipt.allowed) {
            return jsonResponse({ ...result, ok: false, reason: receipt.reason, device: receipt.device }, 403);
          }
          eventHub.publish("device", { action: "executed", id: device.id, kind: body.action.kind });
          return jsonResponse({ ...result, device: receipt.device });
        }

        // Humans & Hiring Packet
        if (method === "GET" && path === "/api/humans") {
          const q = parsePaginationQuery(url.searchParams);
          const humans = await opts.store.listHumans({
            city: q.city,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ humans });
        }
        if (method === "POST" && path === "/api/humans") {
          const body = parseCreateHuman(await readJsonBody(request));
          const paidRole =
            body.role === "street_worker" || body.role === "creator" || Boolean(body.requireAdult);
          if (
            paidRole &&
            body.lowestAge !== undefined &&
            body.lowestAge !== null &&
            !adultParticipantAge(body.lowestAge)
          ) {
            throw new PolicyViolationError(
              "UNDERAGE_APPLICANT",
              "inv_adult_only_paid",
              `Paid marketing participant must be at least 18 years old (got ${body.lowestAge}).`,
            );
          }
          const human = await opts.store.upsertHuman(body);
          eventHub.publish("human", { action: "upserted", id: human.id });
          return jsonResponse({ human }, 201);
        }
        const humanStopMatch = /^\/api\/humans\/([^/]+)\/stop$/.exec(path);
        if (method === "POST" && humanStopMatch?.[1]) {
          const id = decodeURIComponent(humanStopMatch[1]);
          const raw = await readJsonBody(request);
          const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : "operator_stop";
          const human = await opts.store.markHumanStopped(id, reason);
          await opts.store.cancelPendingOutreachForContact({ humanIds: [human.id], reason });
          await opts.store.recordOperatorAudit({
            actor: "operator",
            action: "human_stopped",
            targetType: "human",
            targetId: human.id,
            detail: { reason },
          });
          analytics.invalidateCache();
          eventHub.publish("human", { action: "stopped", id: human.id });
          return jsonResponse({ human });
        }
        if (method === "POST" && path === "/api/hiring-packet") {
          const raw = await readJsonBody(request);
          const role = (typeof raw.role === "string" ? raw.role : "street_fliering") as HiringRole;
          const city = normalizeCityCode(typeof raw.city === "string" ? raw.city : "nyc");
          const budgetCents =
            typeof raw.budgetCents === "number" && Number.isInteger(raw.budgetCents) && raw.budgetCents > 0
              ? raw.budgetCents
              : 25_000;
          const packet = crowdsourcing.buildHiringPacket(role, city, budgetCents, {
            neighborhood: typeof raw.neighborhood === "string" ? raw.neighborhood : undefined,
            qrBatchCode: typeof raw.qrBatchCode === "string" ? raw.qrBatchCode : undefined,
            boroughLicenceRef:
              typeof raw.boroughLicenceRef === "string" ? raw.boroughLicenceRef : undefined,
          });
          return jsonResponse({ packet });
        }

        // Tasks
        if (method === "GET" && path === "/api/tasks") {
          const q = parsePaginationQuery(url.searchParams);
          const tasks = await opts.store.listTasks({
            campaignId: q.campaignId,
            city: q.city,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ tasks });
        }
        if (method === "POST" && path === "/api/tasks") {
          const body = parseCreateTask(await readJsonBody(request));
          if (
            body.tier === 4 &&
            body.assigneeAgeYears !== undefined &&
            body.assigneeAgeYears !== null &&
            !adultParticipantAge(body.assigneeAgeYears)
          ) {
            throw new PolicyViolationError(
              "UNDERAGE_OR_UNKNOWN_WORKER",
              "inv_adult_only_paid",
              `Tier 4 paid human task requires an adult participant aged 18+ (got ${body.assigneeAgeYears}).`,
            );
          }
          const task = await opts.store.createTask(body);
          eventHub.publish("task", { action: "created", id: task.id });
          return jsonResponse({ task }, 201);
        }

        // Proofs
        if (method === "GET" && path === "/api/proofs") {
          const q = parsePaginationQuery(url.searchParams);
          const taskId = url.searchParams.get("taskId") ?? undefined;
          const proofs = await opts.store.listProofs({
            taskId,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ proofs });
        }
        if (method === "POST" && path === "/api/proofs") {
          const body = parseSubmitProof(await readJsonBody(request));
          const task = await opts.store.getTask(body.taskId);
          if (!task) throw new HttpValidationError(404, "NOT_FOUND", `Task not found: ${body.taskId}`);

          if (body.checkinMediaHashes && body.checkinMediaHashes.length > 0) {
            for (const hash of body.checkinMediaHashes) {
              const dup = await opts.store.hasMediaHash(hash, task.id);
              if (dup) {
                const claim = await opts.store.createAntiFraudClaim({
                  campaignId: task.campaignId,
                  personKey: task.assigneeHumanId ?? `task:${task.id}`,
                  workerId: task.assigneeHumanId,
                  taskId: task.id,
                  phoneLineType: "unknown",
                  mediaHash: hash,
                  vestingTier: 4,
                  amountCents: task.amountCents,
                  status: "rejected",
                  reason: "duplicate_media_hash",
                });
                eventHub.publish("antifraud", { action: "duplicate_media", claimId: claim.id });
                return jsonResponse(
                  { error: "Duplicate media hash detected across tasks.", code: "DUPLICATE_MEDIA_HASH", claim },
                  400,
                );
              }
            }
          }

          const result = await crowdsourcing.submitAndEvaluateProof(body);
          eventHub.publish("proof", {
            action: "submitted",
            proofId: result.proof.id,
            approved: result.approved,
          });
          if (!result.approved) {
            return jsonResponse(result, 400);
          }
          if (result.payoutError) {
            return jsonResponse(result, 403);
          }
          return jsonResponse(result, 201);
        }
        const proofReviewMatch = /^\/api\/proofs\/([^/]+)\/review$/.exec(path);
        if (method === "POST" && proofReviewMatch?.[1]) {
          const proofId = decodeURIComponent(proofReviewMatch[1]);
          const body = parseProofReview(await readJsonBody(request));
          const proof = await opts.store.getProof(proofId);
          if (!proof) throw new HttpValidationError(404, "NOT_FOUND", `Proof not found: ${proofId}`);
          const task = await opts.store.getTask(proof.taskId);
          if (!task) throw new HttpValidationError(404, "NOT_FOUND", `Task not found: ${proof.taskId}`);
          const worker = task.assigneeHumanId ? await opts.store.getHuman(task.assigneeHumanId) : null;
          if (body.verdict === "rejected") {
            const evaluated = await opts.store.evaluateProof(proofId, {
              workerAge: null,
              workerBanned: true,
              verifierNotes: body.verifierNotes ?? "operator_rejected",
            });
            eventHub.publish("proof", { action: "reviewed", proofId, verdict: "rejected" });
            return jsonResponse(evaluated);
          }
          const evaluated = await opts.store.evaluateProof(proofId, {
            workerAge: worker?.lowestAge ?? task.assigneeAgeYears ?? null,
            workerBanned: Boolean(worker?.banned),
            shiftDone: true,
            verifierNotes: body.verifierNotes ?? "operator_approved",
          });
          eventHub.publish("proof", { action: "reviewed", proofId, verdict: evaluated.proof.verdict });
          return jsonResponse(evaluated, evaluated.approved ? 200 : 400);
        }

        // Anti-Fraud
        if (method === "GET" && path === "/api/antifraud") {
          const q = parsePaginationQuery(url.searchParams);
          const claims = await opts.store.listAntiFraudClaims({
            campaignId: q.campaignId,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ claims });
        }
        if (method === "POST" && path === "/api/antifraud") {
          const raw = await readJsonBody(request);
          const campaignId = typeof raw.campaignId === "string" && raw.campaignId.trim()
            ? raw.campaignId.trim()
            : (await opts.store.listCampaigns({ status: "active" }))[0]?.id ?? NYC_LAUNCH_CAMPAIGN.id;
          const personKey = typeof raw.personKey === "string" && raw.personKey.trim()
            ? raw.personKey.trim()
            : (() => {
                throw new HttpValidationError(400, "REQUIRED_FIELD", "personKey is required.");
              })();
          const workerId = typeof raw.workerId === "string" ? raw.workerId.trim() : null;
          const taskId = typeof raw.taskId === "string" ? raw.taskId.trim() : null;
          const phoneLineType = (typeof raw.phoneLineType === "string" ? raw.phoneLineType : "postpaid") as PhoneLineType;
          const rawTier =
            typeof raw.vestingTier === "number" &&
            Number.isInteger(raw.vestingTier) &&
            raw.vestingTier >= 0 &&
            raw.vestingTier <= 4
              ? raw.vestingTier
              : 2;
          const vestingTier = rawTier as 0 | 1 | 2 | 3 | 4;
          const amountCents = typeof raw.amountCents === "number" && Number.isInteger(raw.amountCents) ? raw.amountCents : 0;
          const mediaHash = typeof raw.mediaHash === "string" && raw.mediaHash.trim() ? raw.mediaHash.trim() : null;
          const year = new Date(clock.now()).getUTCFullYear();
          const [priorLifetimeCents, annualWorkerCents, mediaDup] = await Promise.all([
            opts.store.getLifetimePersonBonusCents(personKey),
            workerId ? opts.store.getAnnualWorkerPaidCents(workerId, year) : Promise.resolve(0),
            mediaHash ? opts.store.hasMediaHash(mediaHash, taskId ?? undefined) : Promise.resolve(false),
          ]);
          const knownMediaHashes = mediaDup && mediaHash ? new Set([mediaHash]) : new Set<string>();
          const evalRes = antiFraud.evaluateClaim({
            campaignId,
            personKey,
            workerId,
            taskId,
            phoneLineType,
            vestingTier,
            amountCents,
            priorLifetimeCents,
            annualWorkerCents,
            hasW9: Boolean(raw.hasW9),
            mediaHash,
            knownMediaHashes,
            clusterId: typeof raw.clusterId === "string" ? raw.clusterId : null,
            clusterQuarantined: Boolean(raw.clusterQuarantined),
            createdAtIso: typeof raw.createdAtIso === "string" ? raw.createdAtIso : new Date(clock.now()).toISOString(),
            organicAnchorVerified: Boolean(raw.organicAnchorVerified),
            trustedOperator: Boolean(raw.trustedOperator),
            videoUrl: typeof raw.videoUrl === "string" ? raw.videoUrl : undefined,
            requireVideoUrl: Boolean(raw.requireVideoUrl),
          });
          const persisted = await opts.store.createAntiFraudClaim({
            campaignId,
            personKey,
            workerId,
            taskId,
            phoneLineType,
            mediaHash,
            clusterId: typeof raw.clusterId === "string" ? raw.clusterId : null,
            vestingTier,
            amountCents,
            status: evalRes.status,
            reason: evalRes.reasons.join("; ") || null,
          });
          eventHub.publish("antifraud", { action: "evaluated", id: persisted.id, status: persisted.status });
          return jsonResponse({ evaluation: evalRes, claim: persisted }, evalRes.status === "rejected" ? 403 : 201);
        }
        if (method === "POST" && path === "/api/antifraud/scan-sybil") {
          const raw = await readJsonBody(request);
          const campaignId = typeof raw.campaignId === "string" ? raw.campaignId.trim() : undefined;
          const storedClaims = await opts.store.listAntiFraudClaims({ campaignId, limit: 500 });
          const rawNodes = Array.isArray(raw.claims) ? raw.claims : null;
          const nodes: SybilClaimNode[] = rawNodes
            ? (rawNodes as SybilClaimNode[])
            : storedClaims.map((c) => ({
                id: c.id,
                personKey: c.personKey,
                workerId: c.workerId,
                mediaHash: c.mediaHash,
                payoutAccountRef: c.clusterId ?? undefined,
                paidReferred: c.amountCents > 0,
              }));
          const scan = detectSybilCluster(nodes);
          const quarantinedClaimIds: string[] = [];
          for (const cluster of scan.clusters) {
            const count = await opts.store.quarantineClaimsBatch(
              cluster.claimIds,
              cluster.clusterId,
              `sybil_ring:${cluster.reasons.join(",")}`,
            );
            if (count > 0) {
              quarantinedClaimIds.push(...cluster.claimIds);
            }
          }
          eventHub.publish("antifraud", { action: "sybil_scan", quarantinedCount: quarantinedClaimIds.length });
          return jsonResponse({ scan, quarantinedClaimIds });
        }

        // Contextual Bandit
        if (method === "GET" && path === "/api/bandit") {
          const q = parsePaginationQuery(url.searchParams);
          const arms = await opts.store.listBanditArms({
            campaignId: q.campaignId,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ arms });
        }
        if (method === "POST" && path === "/api/bandit") {
          const raw = await readJsonBody(request);
          const campaignId = typeof raw.campaignId === "string" && raw.campaignId.trim()
            ? raw.campaignId.trim()
            : (await opts.store.listCampaigns({ status: "active" }))[0]?.id ?? NYC_LAUNCH_CAMPAIGN.id;
          const armKey = typeof raw.armKey === "string" && raw.armKey.trim()
            ? raw.armKey.trim()
            : (() => {
                throw new HttpValidationError(400, "REQUIRED_FIELD", "armKey is required.");
              })();
          const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : armKey;
          const track = typeof raw.track === "string" && raw.track.trim() ? raw.track.trim() : "organic_play";
          const arm = await opts.store.upsertBanditArm({
            id: typeof raw.id === "string" ? raw.id : undefined,
            campaignId,
            armKey,
            label,
            track,
            alpha: typeof raw.alpha === "number" ? raw.alpha : undefined,
            beta: typeof raw.beta === "number" ? raw.beta : undefined,
            weight: typeof raw.weight === "number" ? raw.weight : undefined,
            spendCents: typeof raw.spendCents === "number" ? raw.spendCents : undefined,
            signups: typeof raw.signups === "number" ? raw.signups : undefined,
            stopEvents: typeof raw.stopEvents === "number" ? raw.stopEvents : undefined,
            totalContacts: typeof raw.totalContacts === "number" ? raw.totalContacts : undefined,
            status:
              raw.status === "active" || raw.status === "killed" || raw.status === "paused"
                ? raw.status
                : undefined,
          });
          eventHub.publish("bandit", { action: "upserted", id: arm.id });
          return jsonResponse({ arm }, 201);
        }
        if (method === "POST" && path === "/api/bandit/rebalance") {
          const raw = await readJsonBody(request);
          let campaignId = typeof raw.campaignId === "string" && raw.campaignId.trim() ? raw.campaignId.trim() : undefined;
          if (!campaignId) {
            const active = await opts.store.listCampaigns({ status: "active" });
            campaignId = active[0]?.id ?? NYC_LAUNCH_CAMPAIGN.id;
          }
          const campaign = await opts.store.getCampaign(campaignId);
          if (!campaign) throw new HttpValidationError(404, "NOT_FOUND", `Campaign not found: ${campaignId}`);
          const storedArms = await opts.store.listBanditArms({ campaignId: campaign.id, limit: 100 });
          const allocArms = storedArms.map((a) => toAllocatorBanditArm(a, campaign));
          const armById = new Map(storedArms.map((a) => [a.id, a]));
          const availableCents = Math.max(
            0,
            campaign.monthlyBudgetCents - campaign.spentCents - campaign.reservedCents,
          );
          const result = computeBanditAllocations({
            campaignId: campaign.id,
            arms: allocArms,
            availableCents,
            seed: typeof raw.seed === "string" || typeof raw.seed === "number" ? raw.seed : `${campaign.id}:${clock.now()}`,
            nowIso: new Date(clock.now()).toISOString(),
            riskDial: campaign.riskDial,
            billingArmed: campaign.billingArmed,
            dayOfCampaign: typeof raw.dayOfCampaign === "number" ? raw.dayOfCampaign : undefined,
            directNoShowRate: typeof raw.directNoShowRate === "number" ? raw.directNoShowRate : undefined,
          });
          const batchUpdates: BanditArmBatchUpdate[] = result.decisions.map((dec) => {
            const existing = armById.get(dec.armId);
            const nextStatus: BanditArm["status"] =
              dec.state === "auto_killed" || dec.state === "halted_safety"
                ? "killed"
                : dec.state === "paused_low_roi"
                  ? "paused"
                  : "active";
            return {
              id: dec.armId,
              alpha: existing?.alpha ?? 1,
              beta: existing?.beta ?? 1,
              weight: Number((dec.nextShareBps / 10_000).toFixed(4)),
              status: nextStatus,
            };
          });
          const updatedArms = await opts.store.updateBanditArmsBatch(batchUpdates);
          eventHub.publish("bandit", { action: "rebalanced", campaignId: campaign.id, arms: updatedArms.length });
          return jsonResponse({ rebalance: result, arms: updatedArms });
        }

        // BD Pipeline (both /api/bd and /api/bd-deals aliases)
        if (method === "GET" && (path === "/api/bd" || path === "/api/bd-deals")) {
          const q = parsePaginationQuery(url.searchParams);
          const deals = await opts.store.listBdDeals({
            campaignId: q.campaignId,
            city: q.city,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ deals });
        }
        if (method === "POST" && (path === "/api/bd" || path === "/api/bd-deals")) {
          const body = parseCreateBdDeal(await readJsonBody(request));
          const deal = await opts.store.createBdDeal(body);
          eventHub.publish("bd_deal", { action: "created", id: deal.id });
          return jsonResponse({ deal }, 201);
        }
        const bdStageMatch = /^\/api\/(?:bd|bd-deals)\/([^/]+)\/stage$/.exec(path);
        if (method === "POST" && bdStageMatch?.[1]) {
          const id = decodeURIComponent(bdStageMatch[1]);
          const deal = await opts.store.getBdDeal(id);
          if (!deal) throw new HttpValidationError(404, "NOT_FOUND", `BD deal not found: ${id}`);
          const raw = await readJsonBody(request);
          const nextStage = typeof raw.stage === "string" ? (raw.stage.trim() as BdDealStage) : null;
          if (!nextStage) throw new HttpValidationError(400, "REQUIRED_FIELD", "stage is required.");
          const transition = bdEngine.transitionStage(deal, nextStage, {
            notes: typeof raw.notes === "string" ? raw.notes : undefined,
          });
          if (!transition.allowed) {
            return jsonResponse(
              { error: transition.reason ?? "Illegal BD stage transition", deal, transition },
              403,
            );
          }
          const updated = await opts.store.updateBdDeal(id, {
            stage: transition.deal.stage,
            notes: transition.deal.notes,
          });
          eventHub.publish("bd_deal", { action: "stage", id: updated.id, stage: updated.stage });
          return jsonResponse({ deal: updated, transition });
        }
        const bdCallbackMatch = /^\/api\/(?:bd|bd-deals)\/([^/]+)\/callback$/.exec(path);
        if (method === "POST" && bdCallbackMatch?.[1]) {
          const id = decodeURIComponent(bdCallbackMatch[1]);
          const deal = await opts.store.getBdDeal(id);
          if (!deal) throw new HttpValidationError(404, "NOT_FOUND", `BD deal not found: ${id}`);
          const raw = await readJsonBody(request);
          if (typeof raw.pin === "string" && raw.pin.trim()) {
            const active = bdEngine.getDtmfChallenge(id);
            if (!active) {
              throw new HttpValidationError(400, "NO_ACTIVE_CHALLENGE", "No active DTMF challenge for this deal.");
            }
            const verified = bdEngine.verifyStoredDtmfPin(id, raw.pin);
            if (!verified.verified) {
              return jsonResponse({ error: verified.reason ?? "PIN mismatch", verified: false }, 403);
            }
            const updated = await opts.store.updateBdDeal(id, { phoneCallbackVerified: true });
            eventHub.publish("bd_deal", { action: "callback_verified", id: updated.id });
            return jsonResponse({ verified: true, deal: updated });
          }
          const phone =
            (typeof raw.businessPhone === "string" && raw.businessPhone.trim()) ||
            deal.businessPhone;
          if (!phone) {
            throw new HttpValidationError(400, "REQUIRED_FIELD", "businessPhone is required to issue DTMF callback.");
          }
          const issued = bdEngine.createDtmfCallbackChallenge(id, phone, token);
          return jsonResponse({
            challenge: issued.challenge,
            expectedPin: issued.expectedPin,
          });
        }
        const bdContractMatch = /^\/api\/(?:bd|bd-deals)\/([^/]+)\/contract$/.exec(path);
        if (method === "POST" && bdContractMatch?.[1]) {
          const id = decodeURIComponent(bdContractMatch[1]);
          const deal = await opts.store.getBdDeal(id);
          if (!deal) throw new HttpValidationError(404, "NOT_FOUND", `BD deal not found: ${id}`);
          const raw = await readJsonBody(request);
          const kind: BdContractKind =
            raw.kind === "event_host_afterparty" || raw.kind === "nyll_191d_contractor"
              ? raw.kind
              : "venue_placement";
          const contract = bdEngine.generateClickwrapContract(deal, kind);
          const updated = await opts.store.updateBdDeal(id, {
            contractHash: contract.contractHash,
          });
          eventHub.publish("bd_deal", { action: "contract_generated", id: updated.id });
          return jsonResponse({ contract, deal: updated });
        }
        const bdPatchMatch = /^\/api\/(?:bd|bd-deals)\/([^/]+)$/.exec(path);
        if (method === "PATCH" && bdPatchMatch?.[1]) {
          const id = decodeURIComponent(bdPatchMatch[1]);
          const raw = await readJsonBody(request);
          if (raw.contractSentAt !== undefined) {
            throw new HttpValidationError(
              400,
              "USE_BD_CONTRACT_ENDPOINT",
              "Contract timestamps must be managed via POST /api/bd/:id/contract.",
            );
          }
          const patch = parseBdUpdate(raw);
          const updated = await opts.store.updateBdDeal(id, patch);
          eventHub.publish("bd_deal", { action: "updated", id: updated.id });
          return jsonResponse({ deal: updated });
        }

        // Serialized QR Batches
        if (method === "GET" && path === "/api/qr-batches") {
          const q = parsePaginationQuery(url.searchParams);
          const batches = await opts.store.listQrBatches({
            campaignId: q.campaignId,
            city: q.city,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ batches });
        }
        if (method === "POST" && path === "/api/qr-batches") {
          const body = parseCreateQrBatch(await readJsonBody(request));
          const batch = await opts.store.createQrBatch(body);
          if (body.assignedToType === "bd_deal" && body.assignedToId) {
            const deal = await opts.store.getBdDeal(body.assignedToId);
            if (deal) {
              await opts.store.updateBdDeal(deal.id, { qrBatchId: batch.id });
            }
          }
          eventHub.publish("qr_batch", { action: "created", id: batch.id, batchCode: batch.batchCode });
          return jsonResponse({ batch }, 201);
        }

        // VIP Salons (both /api/vips and /api/vip-prospects aliases)
        if (method === "GET" && (path === "/api/vips" || path === "/api/vip-prospects")) {
          const q = parsePaginationQuery(url.searchParams);
          const prospects = await opts.store.listVipProspects({
            campaignId: q.campaignId,
            city: q.city,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ prospects, archetypes: vipEngine.listArchetypes() });
        }
        if (method === "POST" && (path === "/api/vips" || path === "/api/vip-prospects")) {
          const body = parseCreateVipProspect(await readJsonBody(request));
          const archetype = body.archetype || classifyVipArchetype(`${body.name} ${body.organization ?? ""}`).slug;
          const scored =
            body.prestigeScore !== undefined
              ? body.prestigeScore
              : scoreVipProspect({
                  archetypeSlug: archetype,
                  bioOrSummary: `${body.name} ${body.organization ?? ""}`,
                  primarySourceAuthority: "tier1_filing",
                  recentWithin18Months: true,
                  inTargetCity: true,
                }).score;
          const prospect = await opts.store.createVipProspect({
            ...body,
            archetype,
            prestigeScore: scored,
          });
          eventHub.publish("vip_prospect", { action: "created", id: prospect.id });
          return jsonResponse({ prospect }, 201);
        }
        const vipInviteMatch = /^\/api\/(?:vip|vips|vip-prospects)\/([^/]+)\/invite$/.exec(path);
        if (method === "POST" && vipInviteMatch?.[1]) {
          const id = decodeURIComponent(vipInviteMatch[1]);
          const prospect = await opts.store.getVipProspect(id);
          if (!prospect) throw new HttpValidationError(404, "NOT_FOUND", `VIP prospect not found: ${id}`);
          const raw = await readJsonBody(request);
          const proofHook =
            typeof raw.proofOfWork1Line === "string" ? raw.proofOfWork1Line.trim() : "";
          if (!proofHook || isWeakOrFallbackProofOfWorkHook(proofHook)) {
            return jsonResponse(
              {
                error:
                  "proofOfWork1Line must reference a specific public achievement (>= 14 chars, no raw DB slugs).",
                code: "WEAK_VIP_HOOK",
              },
              400,
            );
          }
          const firstName = prospect.name.split(/\s+/)[0] ?? prospect.name;
          const invite = vipEngine.buildAndValidateVipInvite({
            firstName,
            archetypeSlug: prospect.archetype,
            city: prospect.city,
            neighborhood: typeof raw.neighborhood === "string" ? raw.neighborhood : undefined,
            proofOfWork1Line: proofHook,
            senderName: typeof raw.senderName === "string" && raw.senderName.trim() ? raw.senderName.trim() : "The Operator",
            dateLabel: typeof raw.dateLabel === "string" ? raw.dateLabel : undefined,
          });
          if (!invite.valid) {
            return jsonResponse({ error: "VIP invite failed validation", invite }, 400);
          }
          const updated = await opts.store.updateVipProspect(id, {
            inviteDraft: invite.body,
            status: "drafted",
          });
          eventHub.publish("vip_prospect", { action: "invite_drafted", id: updated.id });
          return jsonResponse({ invite, prospect: updated });
        }

        // Video Factory (both /api/videos and /api/video-assets aliases)
        if (method === "GET" && (path === "/api/videos" || path === "/api/video-assets")) {
          const q = parsePaginationQuery(url.searchParams);
          const assets = await opts.store.listVideoAssets({
            campaignId: q.campaignId,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ assets });
        }
        if (method === "POST" && (path === "/api/videos" || path === "/api/video-assets")) {
          const body = parseCreateVideoAsset(await readJsonBody(request));
          const asset = await opts.store.createVideoAsset(body);
          eventHub.publish("video_asset", { action: "created", id: asset.id });
          return jsonResponse({ asset }, 201);
        }
        if (method === "POST" && path === "/api/videos/lint") {
          const raw = await readJsonBody(request);
          const personaId = (
            typeof raw.personaId === "string" && raw.personaId in PERSONA_VIDEO_BIBLES
              ? raw.personaId
              : "sloane"
          ) as PersonaId;
          const bible = PERSONA_VIDEO_BIBLES[personaId];
          const appId = (typeof raw.appId === "string" ? raw.appId : bible.appId) as BrandAppId;
          const manifest: VideoScriptManifest = {
            id: typeof raw.id === "string" ? raw.id : "lint-check",
            personaId,
            appId,
            productionTier: 1,
            title: typeof raw.title === "string" ? raw.title : "Untitled",
            durationSec: typeof raw.durationSec === "number" ? raw.durationSec : 35,
            hookText: typeof raw.hookText === "string" ? raw.hookText : typeof raw.hook === "string" ? raw.hook : "",
            visualBeats: Array.isArray(raw.visualBeats) ? raw.visualBeats.map(String) : ["NYC sidewalk"],
            dialogue: typeof raw.dialogue === "string" ? raw.dialogue : typeof raw.script === "string" ? raw.script : "",
            punchline: typeof raw.punchline === "string" ? raw.punchline : "",
            ctaText: typeof raw.ctaText === "string" ? raw.ctaText : bible.domain,
            sponsored: raw.sponsored !== false,
            ftcDisclosureText: typeof raw.ftcDisclosureText === "string" ? raw.ftcDisclosureText : null,
            estimatedRenderCents: 0,
          };
          const lint = lintVideoScript(manifest);
          return jsonResponse({ lint }, lint.pass ? 200 : 400);
        }
        const videoStageMatch = /^\/api\/(?:videos|video-assets)\/([^/]+)\/stage$/.exec(path);
        if (method === "POST" && videoStageMatch?.[1]) {
          const id = decodeURIComponent(videoStageMatch[1]);
          const asset = await opts.store.getVideoAsset(id);
          if (!asset) throw new HttpValidationError(404, "NOT_FOUND", `Video asset not found: ${id}`);
          const raw = await readJsonBody(request);
          const rawStage = typeof raw.stage === "string" ? raw.stage.trim() : "";
          const nextStage = (
            rawStage === "rendered"
              ? "voice_render"
              : rawStage === "posted"
                ? "published"
                : rawStage
          ) as VideoAssetStage;
          if (!nextStage) throw new HttpValidationError(400, "REQUIRED_FIELD", "stage is required.");

          const requiresLint =
            nextStage === "voice_render" ||
            nextStage === "qa" ||
            nextStage === "published" ||
            nextStage === "measured";
          let lintResult: ReturnType<typeof lintVideoScript> | undefined;
          if (requiresLint) {
            const rawPersona =
              typeof raw.personaId === "string" && raw.personaId in PERSONA_VIDEO_BIBLES
                ? (raw.personaId as PersonaId)
                : asset.agentId?.startsWith("agent-") &&
                    asset.agentId.slice(6) in PERSONA_VIDEO_BIBLES
                  ? (asset.agentId.slice(6) as PersonaId)
                  : "sloane";
            const bible = PERSONA_VIDEO_BIBLES[rawPersona];
            const manifest: VideoScriptManifest = {
              id: asset.id,
              personaId: rawPersona,
              appId: bible.appId,
              productionTier: 1,
              title: asset.title,
              durationSec: typeof raw.durationSec === "number" ? raw.durationSec : 35,
              hookText: asset.hook,
              visualBeats: Array.isArray(raw.visualBeats)
                ? raw.visualBeats.map(String)
                : ["Local street beat"],
              dialogue: asset.script,
              punchline: typeof raw.punchline === "string" ? raw.punchline : "",
              ctaText: typeof raw.ctaText === "string" ? raw.ctaText : bible.domain,
              sponsored: raw.sponsored !== false,
              ftcDisclosureText:
                typeof raw.ftcDisclosureText === "string"
                  ? raw.ftcDisclosureText
                  : asset.ftcDisclosed
                    ? "#Ad"
                    : null,
              estimatedRenderCents: 0,
            };
            lintResult = lintVideoScript(manifest);
            if (!lintResult.pass) {
              return jsonResponse(
                {
                  error: "Video script failed server-side safety/FTC lint.",
                  code: "VIDEO_LINT_FAILED",
                  lint: lintResult,
                },
                400,
              );
            }
          }

          const check = canTransitionVideoStage(asset.stage, nextStage, {
            safetyLintPass: (lintResult ? lintResult.pass : true) && raw.safetyLintPass !== false && asset.ftcDisclosed,
            qaApproved: raw.qaApproved !== false,
          });
          if (!check.allowed) {
            return jsonResponse({ error: check.reason ?? "Illegal stage transition", check }, 403);
          }
          const updated = await opts.store.updateVideoAsset(id, { stage: nextStage });
          eventHub.publish("video_asset", { action: "stage", id: updated.id, stage: updated.stage });
          return jsonResponse({ asset: updated, check, ...(lintResult ? { lint: lintResult } : {}) });
        }

        // Outreach
        if (method === "GET" && path === "/api/outreach") {
          const q = parsePaginationQuery(url.searchParams);
          const messages = await opts.store.listOutreachMessages({
            campaignId: q.campaignId,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ messages });
        }
        if (method === "POST" && path === "/api/outreach") {
          const body = parseCreateOutreach(await readJsonBody(request));
          const message = await crowdsourcing.queueOutreach(body);
          const blocked =
            message.status === "blocked_stop" || message.status === "blocked_policy";
          eventHub.publish("outreach", { action: "queued", id: message.id, status: message.status });
          return jsonResponse({ message }, blocked ? 403 : 201);
        }
        if (method === "POST" && path === "/api/outreach/dispatch") {
          const rl = compliance.checkRouteRateLimit("outreach_dispatch", 60, 60_000, 20);
          if (!rl.allowed) {
            return new Response(JSON.stringify({ error: "Rate limit exceeded", retryAfterMs: rl.retryAfterMs }), {
              status: 429,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Retry-After": String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))),
              },
            });
          }
          const raw = await readJsonBody(request);
          let campaignId = typeof raw.campaignId === "string" && raw.campaignId.trim() ? raw.campaignId.trim() : undefined;
          if (!campaignId) {
            const campaigns = await opts.store.listCampaigns({ status: "active" });
            campaignId = campaigns[0]?.id;
          }
          if (!campaignId) throw new HttpValidationError(400, "REQUIRED_FIELD", "campaignId is required.");
          const result = await crowdsourcing.dispatchPendingOutreach(campaignId, {
            dailyOutreachCap: typeof raw.dailyOutreachCap === "number" ? raw.dailyOutreachCap : undefined,
            dryRun: typeof raw.dryRun === "boolean" ? raw.dryRun : undefined,
          });
          analytics.invalidateCache();
          eventHub.publish("outreach", { action: "dispatched", campaignId, sent: result.sent });
          return jsonResponse(result);
        }

        if (method === "POST" && (path === "/api/discovery" || path === "/api/discovery/nyc")) {
          const rl = compliance.checkRouteRateLimit("discovery", 60, 60_000, 20);
          if (!rl.allowed) {
            return new Response(JSON.stringify({ error: "Rate limit exceeded", retryAfterMs: rl.retryAfterMs }), {
              status: 429,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Retry-After": String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))),
              },
            });
          }
          const raw = await readJsonBody(request);
          const parsed = parseDiscoveryRequest(raw);
          const targetCity = parsed.city ?? "nyc";
          requireCityPack(targetCity);
          const categories = Array.isArray(raw.categories)
            ? new Set(raw.categories.map((c) => String(c).toLowerCase()))
            : null;
          const result = await discoverCityLeads({
            fetchImpl: opts.discoveryFetch,
            clock,
            env,
            city: targetCity,
            limitPerSource: parsed.limitPerSource,
            redditSubreddits: parsed.redditSubreddits,
            youtubeChannelIds: parsed.youtubeChannelIds,
            includeSources: parsed.includeSources as DiscoverySource[] | undefined,
            includeVipBdSources: Boolean(parsed.includeVipBd),
          });
          const filteredLeads = categories
            ? result.leads.filter((lead) => categories.has(lead.category.toLowerCase()))
            : result.leads;
          return jsonResponse({
            ok: true,
            ...result,
            city: result.city,
            leads: filteredLeads,
            persistedCount: 0,
            summary: {
              totalLeads: filteredLeads.length,
              errors: result.errors.length,
            },
          });
        }

        // Attribution
        if (method === "GET" && path === "/api/attribution") {
          const q = parsePaginationQuery(url.searchParams);
          const events = await opts.store.listAttributionEvents({
            campaignId: q.campaignId,
            limit: q.limit,
            offset: q.offset,
          });
          return jsonResponse({ events });
        }
        if (method === "POST" && path === "/api/attribution") {
          const body = parseCreateAttribution(await readJsonBody(request));
          const event = await opts.store.recordAttributionEvent(body);
          eventHub.publish("attribution", { action: "recorded", id: event.id, eventKind: event.eventKind });
          return jsonResponse({ event }, 201);
        }

        // Paid Adapters
        if (method === "GET" && path === "/api/adapters") {
          return jsonResponse({
            liveBillingEnabled: paidAdapters.isLiveBillingEnabled(),
            adapters: paidAdapters.listStatus(),
          });
        }

        // slop.cash (disabled by default)
        if (method === "GET" && path === "/api/slop-cash/status") {
          const hooks = await opts.store.listSlopCashHooks({ limit: 200 });
          return jsonResponse({
            ...slopCashBridge.status(),
            hooks,
          });
        }
        if (method === "POST" && path === "/api/slop-cash/preview") {
          const raw = await readJsonBody(request);
          const taskId = typeof raw.taskId === "string" && raw.taskId.trim() ? raw.taskId.trim() : "";
          if (!taskId) throw new HttpValidationError(400, "REQUIRED_FIELD", "taskId is required.");
          const task = await opts.store.getTask(taskId);
          if (!task) throw new HttpValidationError(404, "NOT_FOUND", `Task not found: ${taskId}`);
          const proof =
            typeof raw.proofId === "string" && raw.proofId.trim()
              ? await opts.store.getProof(raw.proofId.trim())
              : (await opts.store.listProofs({ taskId: task.id }))[0] ?? null;
          const preview = slopCashBridge.previewHook(task, proof, {
            repoSlug: typeof raw.repoSlug === "string" ? raw.repoSlug : undefined,
            issueNumber: typeof raw.issueNumber === "number" ? raw.issueNumber : undefined,
            vaultChain:
              raw.vaultChain === "base" ||
              raw.vaultChain === "solana" ||
              raw.vaultChain === "robinhood_4663"
                ? raw.vaultChain
                : undefined,
          });
          const persisted = await opts.store.upsertSlopCashHook({
            taskId: task.id,
            repoSlug: preview.hook.repoSlug,
            issueNumber: preview.hook.issueNumber,
            vaultChain: preview.hook.vaultChain,
            estimatedUsdcCents: preview.hook.estimatedUsdcCents,
            hookState: "disabled_stub",
            enabled: false,
          });
          return jsonResponse({ ...preview, hook: persisted });
        }
        if (method === "POST" && path === "/api/slop-cash/settle") {
          const raw = await readJsonBody(request);
          if (!slopCashBridge.isEnabled()) {
            throw new SlopCashDisabledError();
          }
          const taskId = typeof raw.taskId === "string" && raw.taskId.trim() ? raw.taskId.trim() : "";
          if (!taskId) throw new HttpValidationError(400, "REQUIRED_FIELD", "taskId is required.");
          const task = await opts.store.getTask(taskId);
          if (!task) throw new HttpValidationError(404, "NOT_FOUND", `Task not found: ${taskId}`);
          const campaign = await opts.store.getCampaign(task.campaignId);
          if (!campaign) {
            throw new HttpValidationError(404, "NOT_FOUND", `Campaign not found: ${task.campaignId}`);
          }
          const proof =
            typeof raw.proofId === "string" && raw.proofId.trim()
              ? await opts.store.getProof(raw.proofId.trim())
              : (await opts.store.listProofs({ taskId: task.id }))[0] ?? null;
          const res = await slopCashBridge.settleHook({
            campaign,
            task,
            proof,
            repoSlug: typeof raw.repoSlug === "string" ? raw.repoSlug : undefined,
            issueNumber: typeof raw.issueNumber === "number" ? raw.issueNumber : undefined,
            vaultChain:
              raw.vaultChain === "base" ||
              raw.vaultChain === "solana" ||
              raw.vaultChain === "robinhood_4663"
                ? raw.vaultChain
                : undefined,
          });
          return jsonResponse(res);
        }

        // Daemon & Autopilot
        if (method === "GET" && (path === "/api/daemon/status" || path === "/api/autopilot/daemon")) {
          const status = daemon.getStatus();
          return jsonResponse({ ...status, enabled: status.running });
        }
        if (method === "POST" && path === "/api/daemon/start") {
          daemon.start();
          const status = daemon.getStatus();
          return jsonResponse({ ...status, enabled: status.running });
        }
        if (method === "POST" && path === "/api/daemon/stop") {
          await daemon.stop();
          const status = daemon.getStatus();
          return jsonResponse({ ...status, enabled: status.running });
        }
        if (method === "POST" && path === "/api/autopilot/daemon") {
          const raw = await readJsonBody(request);
          if (raw.enabled === true) {
            daemon.start();
          } else {
            await daemon.stop();
          }
          const status = daemon.getStatus();
          return jsonResponse({ ...status, enabled: status.running });
        }
        if (method === "POST" && path === "/api/autopilot/tick") {
          const raw = await readJsonBody(request);
          let campaignId =
            typeof raw.campaignId === "string" && raw.campaignId.trim()
              ? raw.campaignId.trim()
              : undefined;
          if (!campaignId) {
            const campaigns = await opts.store.listCampaigns({ status: "active" });
            campaignId = campaigns[0]?.id ?? NYC_LAUNCH_CAMPAIGN.id;
          }
          const result = await agentManager.runAutopilotTick(campaignId);
          eventHub.publish("daemon", { action: "autopilot_tick", campaignId });
          return jsonResponse(result);
        }

        return jsonResponse({ error: `Route not found: ${method} ${path}` }, 404);
      } catch (err) {
        return mapErrorToResponse(err);
      }
    },
  });

  const baseUrl = server.url.toString().replace(/\/$/, "");
  return {
    server,
    url: baseUrl,
    token,
    daemon,
    eventHub,
    bridge,
    compliance,
    analytics,
    gameSession,
    stop: async () => {
      serving = false;
      await daemon.stop();
      await gameSession.stop();
      await analytics.shutdown();
      eventHub.closeAll();
      await server.stop(true);
    },
  };
}

const isDirectEntry =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectEntry) {
  const dbUrl = process.env.NETWORK_DATABASE_URL?.trim();
  const clock = new RealClock();
  const store: MarketingStore = dbUrl
    ? new PgMarketingStore(dbUrl, { clock })
    : new MemoryMarketingStore({ clock });

  if (store instanceof PgMarketingStore) {
    await store.migrate();
  }
  const existing = await store.listCampaigns();
  if (existing.length === 0) {
    await seedNycLaunch(store);
  }

  const started = await createMarketingServer({
    store,
    clock,
    port: Number(process.env.MARKETING_PORT || process.env.PORT || DEFAULT_MARKETING_PORT),
    hostname: process.env.MARKETING_HOST || DEFAULT_MARKETING_HOST,
  });

  console.log(
    `Marketing Command Center (${dbUrl ? "postgres" : "in-memory"}): ${started.url}/#token=${started.token}`,
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await started.stop();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
