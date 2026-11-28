import { setTimeout as sleepMs } from "node:timers/promises";
import type { Clock } from "@thenetwork/core";
import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import { ChaosEngine, type ChaosRule } from "./chaos.ts";
import { jsonResponse, numField, parseJsonBody, strField, type ServiceContext, type ServiceResult } from "./http-helpers.ts";
import { advanceAdAuctions, handleAdsRequest } from "./services/ads.ts";
import { handleBeaconAndDubRequest } from "./services/beacon.ts";
import { handleBlooioRequest, triggerBlooioInbound } from "./services/blooio.ts";
import { handleDiscoveryRequest } from "./services/discovery.ts";
import { handleEmailRequest } from "./services/email.ts";
import { handleOpsRequest } from "./services/ops.ts";
import { handleS3Request } from "./services/s3.ts";
import { advanceSocialEngagement, handleSocialRequest } from "./services/social.ts";
import { handleTwilioRequest } from "./services/twilio.ts";
import {
  DEFAULT_MOCK_EPOCH_MS,
  MockStateRegistry,
  type MockServiceName,
  type MockSessionState,
  type WebhookSubscription,
} from "./state.ts";
import { createTrafficSseResponse, sanitizeHeaders, TrafficLog, type MockTrafficEntry } from "./traffic.ts";
import { signLumaPayload, signSvixPayload, WebhookDispatcher } from "./webhooks.ts";

export * from "./state.ts";
export * from "./chaos.ts";
export * from "./traffic.ts";
export * from "./webhooks.ts";
export { triggerBlooioInbound } from "./services/blooio.ts";

export interface MockServicesOptions {
  port?: number;
  hostname?: string;
  seed?: number;
  startMs?: number;
  clock?: Clock;
  s3Dir?: string;
  maxTrafficEntries?: number;
  webhookFetch?: typeof fetch;
}

export interface MockHandlerRuntime {
  registry: MockStateRegistry;
  chaos: ChaosEngine;
  traffic: TrafficLog;
  webhooks: WebhookDispatcher;
  fetch: (req: Request) => Promise<Response>;
  setBaseUrl: (baseUrl: string) => void;
}

export interface MockServicesServer extends MockHandlerRuntime {
  server: HttpServer;
  port: number;
  url: string;
  stop: (force?: boolean) => Promise<void>;
}

function detectServiceFromPath(pathname: string): MockServiceName | null {
  if (pathname.startsWith("/social/x")) return "x";
  if (pathname.startsWith("/social/instagram")) return "instagram";
  if (pathname.startsWith("/social/tiktok")) return "tiktok";
  if (pathname.startsWith("/social/reddit")) return "reddit";
  if (pathname.startsWith("/social/linkedin")) return "linkedin";
  if (pathname.startsWith("/social/discord")) return "discord";
  if (pathname.startsWith("/blooio/")) return "blooio";
  if (pathname.startsWith("/twilio/")) return "twilio";
  if (pathname.startsWith("/email/resend")) return "resend";
  if (pathname.startsWith("/email/sendgrid")) return "sendgrid";
  if (pathname.startsWith("/email/postmark")) return "postmark";
  if (pathname.startsWith("/email/agentmail")) return "agentmail";
  if (pathname.startsWith("/email/smtp")) return "smtp";
  if (pathname.startsWith("/ads/meta")) return "meta_ads";
  if (pathname.startsWith("/ads/google")) return "google_ads";
  if (pathname.startsWith("/ads/tiktok")) return "tiktok_ads";
  if (pathname.startsWith("/s3/")) return "s3";
  if (pathname.startsWith("/beacon/")) return "beacon";
  if (pathname.startsWith("/ops/dub") || pathname.startsWith("/go/")) return "dub";
  if (pathname.startsWith("/ops/luma")) return "luma";
  if (pathname.startsWith("/ops/")) return "ops";
  if (pathname.startsWith("/turnstile/")) return "turnstile";
  if (pathname.startsWith("/discovery/")) return "discovery";
  return null;
}

function summarizeServiceState(state: MockSessionState, service: string): Record<string, unknown> {
  if (service === "all") {
    return {
      sessionId: state.sessionId,
      seed: state.seed,
      socialAccounts: state.socialAccounts.size,
      socialPosts: state.socialPosts.size,
      socialDms: state.socialDms.length,
      blooioMessages: state.blooioMessages.size,
      emailMessages: state.emailMessages.size,
      adCampaigns: state.adCampaigns.size,
      s3Buckets: state.s3Buckets.size,
      dubLinks: state.dubLinks.size,
      beaconEvents: state.beaconEvents.length,
      opsRecords: state.opsRecords.size,
      webhooks: state.webhooks.size,
    };
  }
  if (service === "social" || ["x", "instagram", "tiktok", "reddit", "linkedin", "discord"].includes(service)) {
    const filterPlatform = service === "social" ? null : service;
    return {
      accounts: [...state.socialAccounts.values()].filter((a) => !filterPlatform || a.platform === filterPlatform),
      posts: [...state.socialPosts.values()].filter((p) => !filterPlatform || p.platform === filterPlatform),
      dms: state.socialDms.filter((d) => !filterPlatform || d.platform === filterPlatform),
    };
  }
  if (service === "blooio") {
    return {
      lines: [...state.blooioLines.values()],
      conversations: [...state.blooioConversations.values()],
      messages: [...state.blooioMessages.values()],
    };
  }
  if (service === "twilio") {
    return { messages: state.twilioMessages, calls: state.twilioCalls };
  }
  if (service === "email" || ["resend", "sendgrid", "postmark", "agentmail", "smtp"].includes(service)) {
    return {
      domains: [...state.emailDomains.values()],
      messages: [...state.emailMessages.values()],
    };
  }
  if (service === "ads" || ["meta_ads", "google_ads", "tiktok_ads"].includes(service)) {
    return {
      campaigns: [...state.adCampaigns.values()],
      conversions: state.adConversions,
    };
  }
  if (service === "s3") {
    const buckets: Record<string, string[]> = {};
    for (const [b, objs] of state.s3Buckets.entries()) {
      buckets[b] = [...objs.keys()].sort();
    }
    return { buckets, activeMultiparts: state.s3Multiparts.size };
  }
  if (service === "beacon" || service === "dub") {
    return {
      dubLinks: [...state.dubLinks.values()],
      beaconCount: state.beaconEvents.length,
      recentBeacons: state.beaconEvents.slice(-50),
    };
  }
  return {
    opsRecords: [...state.opsRecords.values()],
    webhooks: [...state.webhooks.values()],
  };
}

export function createMockHandler(opts: MockServicesOptions = {}): MockHandlerRuntime {
  const registry = new MockStateRegistry({
    seed: opts.seed ?? 1,
    startMs: opts.startMs ?? DEFAULT_MOCK_EPOCH_MS,
    clock: opts.clock,
    s3Dir: opts.s3Dir,
  });
  const chaos = new ChaosEngine();
  const traffic = new TrafficLog(opts.maxTrafficEntries ?? 10_000);
  const webhooks = new WebhookDispatcher(registry.clock, opts.webhookFetch);
  let baseUrl = "http://127.0.0.1:4900";

  const makeCtx = (sessionId?: string | null): ServiceContext => ({
    registry,
    state: registry.session(sessionId),
    chaos,
    webhooks,
    baseUrl,
  });

  async function handleControlPlane(req: Request, url: URL): Promise<Response | null> {
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (!path.startsWith("/_mock")) return null;
    const sessionId = req.headers.get("x-mock-session") ?? url.searchParams.get("session") ?? undefined;
    const ctx = makeCtx(sessionId);

    if (path === "/_mock/health" && req.method === "GET") {
      return jsonResponse({
        ok: true,
        simTimeMs: registry.clock.now(),
        simTimeIso: registry.clock.iso(),
        traffic: traffic.stats(),
        activeChaosRules: chaos.listRules().filter((r) => r.enabled).length,
      });
    }

    if (path === "/_mock/traffic" && req.method === "GET") {
      const statusRaw = url.searchParams.get("status");
      const sinceRaw = url.searchParams.get("sinceSeq");
      const limitRaw = url.searchParams.get("limit");
      const entries = traffic.query({
        sessionId: url.searchParams.get("session") ?? undefined,
        service: url.searchParams.get("service") ?? undefined,
        status: statusRaw ? Number(statusRaw) : undefined,
        sinceSeq: sinceRaw ? Number(sinceRaw) : undefined,
        limit: limitRaw ? Number(limitRaw) : undefined,
      });
      return jsonResponse({ entries, stats: traffic.stats() });
    }

    if (path === "/_mock/traffic/stream" && req.method === "GET") {
      const sinceRaw = url.searchParams.get("sinceSeq");
      return createTrafficSseResponse(traffic, {
        sessionId: url.searchParams.get("session") ?? undefined,
        service: url.searchParams.get("service") ?? undefined,
        sinceSeq: sinceRaw ? Number(sinceRaw) : undefined,
      });
    }

    if (path === "/_mock/chaos") {
      if (req.method === "GET") {
        return jsonResponse({ rules: chaos.listRules() });
      }
      if (req.method === "PUT" || req.method === "POST") {
        const body = await parseJsonBody(req);
        if (Array.isArray(body.rules)) {
          const rules = chaos.replaceRules(body.rules as ChaosRule[]);
          return jsonResponse({ ok: true, rules });
        }
        const rule = body as unknown as ChaosRule;
        if (!rule.id || !rule.fault) {
          return jsonResponse({ ok: false, error: "rule.id and rule.fault are required" }, 400);
        }
        chaos.upsertRule({
          id: rule.id,
          service: rule.service ?? "*",
          pathPattern: rule.pathPattern,
          probability: typeof rule.probability === "number" ? rule.probability : 1,
          fault: rule.fault,
          startsAtSimMs: rule.startsAtSimMs,
          expiresAtSimMs: rule.expiresAtSimMs,
          enabled: rule.enabled !== false,
        });
        return jsonResponse({ ok: true, rules: chaos.listRules() });
      }
      if (req.method === "DELETE") {
        chaos.clear();
        return jsonResponse({ ok: true, rules: [] });
      }
    }

    const chaosDeleteMatch = /^\/_mock\/chaos\/([^/]+)$/.exec(path);
    if (chaosDeleteMatch && req.method === "DELETE") {
      const deleted = chaos.deleteRule(decodeURIComponent(chaosDeleteMatch[1]!));
      return jsonResponse({ ok: true, deleted, rules: chaos.listRules() });
    }

    if (path === "/_mock/clock") {
      if (req.method === "GET") {
        return jsonResponse({ nowMs: registry.clock.now(), iso: registry.clock.iso() });
      }
      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        if (typeof body.nowMs === "number" && Number.isFinite(body.nowMs)) {
          registry.clock.set(body.nowMs);
        } else if (typeof body.advanceMs === "number" && Number.isFinite(body.advanceMs)) {
          registry.clock.advance(body.advanceMs);
        } else {
          return jsonResponse({ ok: false, error: "nowMs or advanceMs required" }, 400);
        }
        return jsonResponse({ ok: true, nowMs: registry.clock.now(), iso: registry.clock.iso() });
      }
    }

    if (path === "/_mock/reset" && req.method === "POST") {
      const body = await parseJsonBody(req);
      const resetSession = strField(body, "sessionId") || undefined;
      const seed = typeof body.seed === "number" ? body.seed : undefined;
      const startMs = typeof body.startMs === "number" ? body.startMs : undefined;
      const state = registry.reset({ seed, startMs, sessionId: resetSession });
      if (!resetSession) {
        chaos.clear();
        traffic.clear();
        webhooks.clearHistory();
      } else {
        chaos.resetRateLimits(`${resetSession}:`);
      }
      return jsonResponse({
        ok: true,
        sessionId: state.sessionId,
        seed: state.seed,
        nowMs: registry.clock.now(),
      });
    }

    if (path === "/_mock/webhooks" && req.method === "GET") {
      return jsonResponse({
        subscriptions: [...ctx.state.webhooks.values()],
        history: webhooks.history.slice(-100),
      });
    }

    if (path === "/_mock/webhooks/register" && req.method === "POST") {
      const body = await parseJsonBody(req);
      const service = strField(body, "service") as WebhookSubscription["service"];
      const targetUrl = strField(body, "url");
      const secret = strField(body, "secret", "mock-webhook-secret");
      if (!service || !targetUrl) {
        return jsonResponse({ ok: false, error: "service and url are required" }, 400);
      }
      const id = strField(body, "id") || registry.nextId(ctx.state, "wh");
      const sub: WebhookSubscription = {
        id,
        service,
        url: targetUrl,
        secret,
        events: Array.isArray(body.events) ? body.events.map(String) : ["*"],
        active: body.active !== false,
      };
      ctx.state.webhooks.set(id, sub);
      return jsonResponse({ ok: true, subscription: sub }, 201);
    }

    if (path === "/_mock/webhooks/trigger" && req.method === "POST") {
      const body = await parseJsonBody(req);
      const service = strField(body, "service") as WebhookSubscription["service"];
      if (service === "blooio" && strField(body, "type", "message.received") === "message.received") {
        const res = await triggerBlooioInbound(ctx, {
          from: strField(body, "from", "+12125550101"),
          to: strField(body, "to") || undefined,
          chatId: strField(body, "chatId") || undefined,
          text: strField(body, "text", "Hello"),
          protocol: (strField(body, "protocol", "imessage") as "imessage" | "sms" | "rcs"),
          isGroup: Boolean(body.isGroup),
          replyToMessageId: strField(body, "replyToMessageId") || undefined,
        });
        return jsonResponse({ ok: true, ...res });
      }
      const eventType = strField(body, "eventType") || strField(body, "type", "event");
      const payload = (body.payload && typeof body.payload === "object" ? body.payload : body) as Record<string, unknown>;
      const results = await webhooks.dispatch(ctx.state, service, eventType, payload);
      return jsonResponse({ ok: true, results });
    }

    if (path === "/_mock/tick" && req.method === "POST") {
      const body = await parseJsonBody(req);
      const hours = Math.max(0.25, numField(body, "hours", 1));
      if (body.advanceClock !== false) {
        registry.clock.advance(Math.round(hours * 3_600_000));
      }
      const ads = advanceAdAuctions(ctx, hours);
      const social = advanceSocialEngagement(ctx, hours);
      return jsonResponse({
        ok: true,
        nowMs: registry.clock.now(),
        iso: registry.clock.iso(),
        ads,
        social,
      });
    }

    const stateMatch = /^\/_mock\/state\/([^/]+)$/.exec(path);
    if (stateMatch && req.method === "GET") {
      const svc = decodeURIComponent(stateMatch[1]!);
      return jsonResponse(summarizeServiceState(ctx.state, svc));
    }

    return jsonResponse({ ok: false, error: `Unknown control plane path ${path}` }, 404);
  }

  async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const controlRes = await handleControlPlane(req, url);
    if (controlRes) return controlRes;

    const sessionId = req.headers.get("x-mock-session")?.trim() || "default";
    const ctx = makeCtx(sessionId);
    const detected = detectServiceFromPath(url.pathname);
    const t0 = performance.now();

    if (detected) {
      const httpFault = chaos.evaluateHttpFault(detected, url.pathname, registry.clock.now(), ctx.state.seed);
      if (httpFault) {
        const { rule, delayMs } = httpFault;
        if (rule.fault.kind === "latency" && delayMs) {
          await sleepMs(Math.min(delayMs, 5_000));
        } else if (rule.fault.kind === "tcp_drop") {
          traffic.record({
            simTimeMs: registry.clock.now(),
            sessionId,
            service: detected,
            method: req.method,
            path: url.pathname,
            status: 502,
            latencyMs: Math.round(performance.now() - t0),
            requestSummary: { headers: sanitizeHeaders(req.headers) },
            responseSummary: { fault: "tcp_drop" },
            chaosApplied: rule.id,
          });
          throw new Error("Simulated TCP connection reset");
        } else if (rule.fault.kind === "malformed_json") {
          const res = new Response("{malformed_json_payload", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
          traffic.record({
            simTimeMs: registry.clock.now(),
            sessionId,
            service: detected,
            method: req.method,
            path: url.pathname,
            status: 200,
            latencyMs: Math.round(performance.now() - t0),
            requestSummary: { headers: sanitizeHeaders(req.headers) },
            responseSummary: { fault: "malformed_json" },
            chaosApplied: rule.id,
          });
          return res;
        } else if (rule.fault.kind === "http_error") {
          const extraHeaders: Record<string, string> = {};
          if (rule.fault.retryAfterSec !== undefined) {
            extraHeaders["retry-after"] = String(rule.fault.retryAfterSec);
          }
          const errPayload = rule.fault.body ?? { error: "injected_chaos_error", status: rule.fault.status };
          const res = jsonResponse(errPayload, rule.fault.status, extraHeaders);
          traffic.record({
            simTimeMs: registry.clock.now(),
            sessionId,
            service: detected,
            method: req.method,
            path: url.pathname,
            status: rule.fault.status,
            latencyMs: Math.round(performance.now() - t0),
            requestSummary: { headers: sanitizeHeaders(req.headers) },
            responseSummary: errPayload,
            chaosApplied: rule.id,
          });
          return res;
        }
      }
    }

    let result: ServiceResult | null = null;
    if (url.pathname.startsWith("/s3/")) {
      result = await handleS3Request(ctx, req, url);
    } else if (url.pathname.startsWith("/social/")) {
      result = await handleSocialRequest(ctx, req, url);
    } else if (url.pathname.startsWith("/blooio/")) {
      result = await handleBlooioRequest(ctx, req, url);
    } else if (url.pathname.startsWith("/twilio/")) {
      result = await handleTwilioRequest(ctx, req, url);
    } else if (url.pathname.startsWith("/email/")) {
      result = await handleEmailRequest(ctx, req, url);
    } else if (url.pathname.startsWith("/ads/")) {
      result = await handleAdsRequest(ctx, req, url);
    } else if (
      url.pathname.startsWith("/beacon/") ||
      url.pathname.startsWith("/ops/dub") ||
      url.pathname.startsWith("/go/")
    ) {
      result = await handleBeaconAndDubRequest(ctx, req, url);
    } else if (url.pathname.startsWith("/ops/") || url.pathname.startsWith("/turnstile/")) {
      result = await handleOpsRequest(ctx, req, url);
    } else if (url.pathname.startsWith("/discovery/")) {
      result = handleDiscoveryRequest(ctx, req, url);
    }

    if (!result) {
      return jsonResponse({ ok: false, error: `No mock service route for ${req.method} ${url.pathname}` }, 404);
    }

    const entry: Omit<MockTrafficEntry, "seq"> = {
      simTimeMs: registry.clock.now(),
      sessionId,
      service: result.service,
      method: req.method,
      path: url.pathname,
      status: result.response.status,
      latencyMs: Math.round(performance.now() - t0),
      requestSummary: {
        headers: sanitizeHeaders(req.headers),
        ...(result.requestSummary ?? {}),
      },
      responseSummary: result.responseSummary ?? {},
      ...(result.rateLimit ? { rateLimit: result.rateLimit } : {}),
      ...(result.chaosApplied ? { chaosApplied: result.chaosApplied } : {}),
      ...(result.webhookTriggered ? { webhookTriggered: result.webhookTriggered } : {}),
    };
    traffic.record(entry);
    return result.response;
  }

  return {
    registry,
    chaos,
    traffic,
    webhooks,
    fetch: fetchHandler,
    setBaseUrl: (nextUrl: string) => {
      baseUrl = nextUrl.replace(/\/$/, "");
    },
  };
}

export async function startMockServices(opts: MockServicesOptions = {}): Promise<MockServicesServer> {
  const runtime = createMockHandler(opts);
  const hostname = opts.hostname ?? "127.0.0.1";
  const port = opts.port ?? 0;
  const server = await serveHttp({
    hostname,
    port,
    fetch: (req) => runtime.fetch(req),
  });
  const url = server.url.toString().replace(/\/$/, "");
  runtime.setBaseUrl(url);
  return {
    ...runtime,
    server,
    port: server.port,
    url,
    stop: (force = false) => server.stop(force),
  };
}

export { signLumaPayload, signSvixPayload };
