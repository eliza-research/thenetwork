// spec/sitePages.md, "A request routes by its path kind, the site and the method"
// The Worker in front of each site: a Cloudflare Pages advanced-mode _worker.js (founder decision 8),
// built by sites/sites.ts. The generated routeFor and answerFor (packages/core/src/generated/sitePages.ts)
// decide each request that the Worker runs on: backend paths go to env.BACKEND_ORIGIN (same path and
// query), retired settings and join paths get the retired answer, update links open the handoff, and every other path is a static file
// from env.ASSETS (dist/, with _headers). dist/_routes.json lists the same paths, so Cloudflare runs this
// Worker only for them (the build and router checks keep the route list aligned).
//
// Proxy headers. The backend sees the Worker, not the visitor, so the Worker tells it who the visitor
// is, and signs what it says. There is one contract: packages/platform/src/proxy.ts (signProxyHeaders,
// verifyProxyHeaders). The backend (deploy/backend normalizeEdge), the platform API and the MCP server
// all verify exactly these headers:
//   x-network-proxy-ip    the visitor IP (CF-Connecting-IP; "unknown" when Cloudflare gave none, which
//                         the backend replaces with the socket address)
//   x-network-proxy-host  env.SITE_HOST, the site's canonical domain ("slop.date"), so a workers.dev
//                         preview maps to the same app as production
//   x-network-proxy-ts    Unix time in seconds
//   x-network-proxy-sig   base64url HMAC-SHA256, key env.PLATFORM_PROXY_SECRET, over
//                         ["v1", method, pathname plus query, host, ip, ts].join("\n")
// Any proxy header that a client sends (x-network-proxy-*, and the retired x-ntwrk-proxy-*) is removed
// first, so only this Worker can set them. No X-Forwarded-* header is sent: the backend trusts nothing
// but the signature. Without PLATFORM_PROXY_SECRET the Worker forwards nothing (503).

import { isProxyHeader, signProxyHeaders, signedPath } from "../packages/platform/src/proxy.ts";
import { readCapped } from "../packages/platform/src/body.ts";
import { updateHandoffPrefix } from "../packages/core/src/generated/agentEntry.ts";
import type { AppKey } from "../packages/core/src/generated/brandIdentity.ts";
import { answerFor, isRetiredRoute, type PathKind, type RequestMethod, retiredJoinPaths, retiredSettingsPaths, routeFor, type SiteRoute, updateHandoffAssetPath } from "../packages/core/src/generated/sitePages.ts";
import { type AppId, isAppId } from "../packages/core/src/types.ts";
import { TOKEN_PATTERN, UPDATE_HANDOFF_TEMPLATE_REFERENCE } from "../packages/notify/src/reference.ts";

export { isProxyHeader };
/** The IP the router signs when Cloudflare names none (never in production; wrangler dev may omit it). */
export const UNKNOWN_IP = "unknown";

export const MAX_BODY_BYTES = 9 * 1024 * 1024;
export const MAX_TELEMETRY_BODY_BYTES = 2048;

export const RETIRED_SITE_PATHS: readonly string[] = retiredSettingsPaths;
export const RETIRED_SIGNUP_PATHS: readonly string[] = retiredJoinPaths;
const updateHandoffRoot = updateHandoffPrefix.slice(0, -1);
export const UPDATE_HANDOFF_PATHS = [updateHandoffRoot, `${updateHandoffPrefix}*`, `${updateHandoffAssetPath}*`];
export const TELEMETRY_PATHS = ["/_t", "/r/*"] as const;
export const RUN_WORKER_FIRST = [...RETIRED_SITE_PATHS, ...RETIRED_SIGNUP_PATHS, ...UPDATE_HANDOFF_PATHS, ...TELEMETRY_PATHS, "/api", "/api/*", "/mcp", "/mcp/*", "/oauth/*", "/.well-known/oauth-*"];

const appKeys: Readonly<Record<AppId, AppKey>> = { ntwrk: "Ntwrk", slop: "Slop", peon: "Peon", friends: "Friends" };

/** The path kind of a path that the Worker decides, or undefined for a path that is only a static file. */
export function workerPathKind(pathname: string): PathKind | undefined {
  if (RETIRED_SITE_PATHS.includes(pathname)) return "SettingsPath";
  if (RETIRED_SIGNUP_PATHS.includes(pathname)) return "JoinPath";
  if (pathname.startsWith(updateHandoffPrefix) && TOKEN_PATTERN.test(pathname.slice(updateHandoffPrefix.length))) return "UpdateHandoffPath";
  if (pathname === updateHandoffRoot || pathname.startsWith(updateHandoffPrefix) || pathname.startsWith(updateHandoffAssetPath)) return "MalformedUpdateHandoffPath";
  if (isBackendPath(pathname)) return "BackendPath";
  return undefined;
}

const requestMethod = (method: string): RequestMethod => (method === "GET" ? "GetMethod" : method === "HEAD" ? "HeadMethod" : "OtherMethod");

const HSTS = "max-age=31536000; includeSubDomains";
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=()";

const jsonError = (status: number, error: string) =>
  new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "strict-transport-security": HSTS,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });

/** The generated route of a request, or "unknown_app" for a path that the Worker decides on a site with an app id that is not known. */
export function workerRoute(req: Request, app: string): SiteRoute | "unknown_app" | undefined {
  const kind = workerPathKind(new URL(req.url).pathname);
  if (kind === undefined) return undefined;
  if (!isAppId(app)) return "unknown_app";
  return routeFor(appKeys[app], kind, requestMethod(req.method));
}

/** The answer to a retired path (no page, never cached), from the generated answerFor; null for every other request. */
export function retiredSitePage(req: Request, app: string): Response | null {
  const route = workerRoute(req, app);
  if (route === "unknown_app") return jsonError(503, "proxy_not_configured");
  if (route === undefined || !isRetiredRoute(route)) return null;
  const answer = answerFor(route, requestMethod(req.method));
  const headers: Record<string, string> = {
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "strict-transport-security": HSTS,
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  if (answer.noStore) headers["cache-control"] = "no-store";
  if (answer.toLanding) headers.location = "/";
  if (answer.allowHeader) headers.allow = answer.allowHeader;
  if (answer.hasBody) headers["content-type"] = "text/plain; charset=utf-8";
  return new Response(answer.hasBody ? "Not found" : null, { status: answer.status, headers });
}

/** The public handoff serves static choices using only the canonical reference in the request path. */
export async function updateHandoffPage(req: Request, app: string, asset: Env["ASSETS"]["fetch"]): Promise<Response | null> {
  const url = new URL(req.url);
  const kind = workerPathKind(url.pathname);
  if (kind !== "UpdateHandoffPath" && kind !== "MalformedUpdateHandoffPath") return null;
  if (!isAppId(app)) return jsonError(503, "proxy_not_configured");
  const method = requestMethod(req.method);
  const route = routeFor(appKeys[app], kind, method);
  const answer = answerFor(route, method);
  const headers = new Headers({
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "permissions-policy": PERMISSIONS_POLICY,
    "referrer-policy": "no-referrer",
    "strict-transport-security": HSTS,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow",
  });
  if (route !== "ServeUpdateHandoff") {
    if (answer.allowHeader) headers.set("allow", answer.allowHeader);
    if (answer.hasBody) headers.set("content-type", "text/plain; charset=utf-8");
    return new Response(answer.hasBody ? "Not found" : null, { status: answer.status, headers });
  }
  const template = await asset(new Request(new URL(updateHandoffAssetPath, url)));
  if (template.status !== 200) return new Response(null, { status: 503, headers });
  const html = await template.text();
  if (!html.includes(UPDATE_HANDOFF_TEMPLATE_REFERENCE)) return new Response(null, { status: 503, headers });
  const reference = url.pathname.slice(updateHandoffPrefix.length);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(answer.hasBody ? html.replaceAll(UPDATE_HANDOFF_TEMPLATE_REFERENCE, reference) : null, { status: answer.status, headers });
}

/** True for a path that belongs to the shared backend. */
export function isBackendPath(pathname: string): boolean {
  return (
    pathname === "/api" || pathname.startsWith("/api/") ||
    pathname === "/mcp" || pathname.startsWith("/mcp/") ||
    pathname.startsWith("/oauth/") ||
    pathname.startsWith("/.well-known/oauth-")
  );
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface AnalyticsEngineLike {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface TelemetryPipelineLike {
  send(events: readonly Record<string, unknown>[]): Promise<void> | void;
}

export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  BACKEND_ORIGIN: string;
  APP_ID: string;
  SITE_HOST: string;
  PLATFORM_PROXY_SECRET?: string;
  ANALYTICS_ENGINE?: AnalyticsEngineLike;
  TELEMETRY_PIPELINE?: TelemetryPipelineLike;
  TELEMETRY_SINK_URL?: string;
  TELEMETRY_SALT?: string;
  SHORTLINK_TARGETS?: Readonly<Record<string, string>>;
}

const ALLOWED_TELEMETRY_EVENTS = new Set([
  "page_view",
  "cta_click",
  "join_started",
  "join_completed",
  "qr_scan",
  "link_click",
  "agent_handoff",
]);

const ALLOWED_TELEMETRY_KEYS = new Set([
  "event",
  "path",
  "referrerHost",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
  "qrBatch",
  "ref",
  "cta",
  "app",
]);

const SHORTLINK_SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_RELATIVE_PATH_RE = /^\/[A-Za-z0-9._~/-]{0,200}$/;
const PII_LIKE_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().-]{7,}\d/i;

function strictNoStoreHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "strict-transport-security": HSTS,
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

function isSameOriginTelemetry(req: Request, url: URL, siteHost: string): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) return false;
  return parsed.host === url.host || parsed.hostname === siteHost;
}

async function rotatingVisitHash(
  siteHost: string,
  salt: string,
  ip: string,
  userAgent: string,
  nowMs: number,
): Promise<string> {
  const dayBucket = Math.floor(nowMs / 86_400_000);
  const uaCoarse = userAgent.slice(0, 64);
  const payload = `v1|${siteHost}|${dayBucket}|${salt}|${ip}|${uaCoarse}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseTelemetryPayload(raw: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const input = parsed as Record<string, unknown>;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_TELEMETRY_KEYS.has(key)) return null;
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.length > 128 || /[\r\n\0]/.test(trimmed) || PII_LIKE_RE.test(trimmed)) return null;
    if (key === "path" && (!SAFE_RELATIVE_PATH_RE.test(trimmed) || trimmed.includes(".."))) return null;
    clean[key] = trimmed;
  }
  if (!clean.event || !ALLOWED_TELEMETRY_EVENTS.has(clean.event)) return null;
  return clean;
}

async function dispatchTelemetry(
  env: Env,
  record: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<void> {
  if (env.ANALYTICS_ENGINE) {
    env.ANALYTICS_ENGINE.writeDataPoint({
      blobs: [
        String(record.app ?? ""),
        String(record.event ?? ""),
        String(record.path ?? ""),
        String(record.utmSource ?? ""),
        String(record.utmCampaign ?? ""),
        String(record.qrBatch ?? ""),
        String(record.visitHash ?? ""),
      ],
      doubles: [Number(record.ts ?? 0)],
      indexes: [String(record.siteHost ?? "")],
    });
  }
  if (env.TELEMETRY_PIPELINE) {
    await env.TELEMETRY_PIPELINE.send([record]);
  }
  if (env.TELEMETRY_SINK_URL) {
    await fetchFn(env.TELEMETRY_SINK_URL, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(record),
      redirect: "error",
    }).catch(() => {});
  }
}

function resolveSafeRedirectTarget(slug: string, url: URL, env: Env): string | null {
  const mapped = env.SHORTLINK_TARGETS?.[slug];
  if (mapped !== undefined) {
    if (SAFE_RELATIVE_PATH_RE.test(mapped) && !mapped.startsWith("//") && !mapped.includes("..")) {
      return mapped;
    }
    try {
      const targetUrl = new URL(mapped);
      if (targetUrl.protocol === "https:" && targetUrl.hostname === env.SITE_HOST) {
        return targetUrl.toString();
      }
    } catch {
      return null;
    }
    return null;
  }
  const requestedTo = url.searchParams.get("to");
  if (requestedTo !== null) {
    if (!SAFE_RELATIVE_PATH_RE.test(requestedTo) || requestedTo.startsWith("//") || requestedTo.includes("..")) {
      return null;
    }
    const sep = requestedTo.includes("?") ? "&" : "?";
    return `${requestedTo}${sep}qr=${encodeURIComponent(slug)}`;
  }
  const isQr = /^(?:qr_|COAST-|EVT-|FLIER-|SLEEVE-)/i.test(slug) || url.searchParams.get("src") === "qr";
  return isQr ? `/?qr=${encodeURIComponent(slug)}` : `/?ref=${encodeURIComponent(slug)}`;
}

async function handleTelemetryEndpoint(
  req: Request,
  url: URL,
  env: Env,
  fetchFn: typeof fetch,
  now: () => number,
  ctx?: ExecutionContextLike,
): Promise<Response | null> {
  if (url.pathname === "/_t") {
    if (!isAppId(env.APP_ID) || !env.SITE_HOST) return jsonError(503, "proxy_not_configured");
    if (req.method !== "POST") {
      return new Response(null, { status: 405, headers: strictNoStoreHeaders({ allow: "POST" }) });
    }
    if (!isSameOriginTelemetry(req, url, env.SITE_HOST)) {
      return jsonError(403, "origin");
    }
    const rawBody = await readCapped(req, MAX_TELEMETRY_BODY_BYTES);
    if (rawBody === "too_large") return jsonError(413, "too_large");
    const parsed = parseTelemetryPayload(new TextDecoder().decode(rawBody));
    if (!parsed) return jsonError(400, "invalid_telemetry");
    const nowMs = now();
    const ip = req.headers.get("cf-connecting-ip") || UNKNOWN_IP;
    const visitHash = await rotatingVisitHash(
      env.SITE_HOST,
      env.TELEMETRY_SALT ?? env.PLATFORM_PROXY_SECRET ?? "anon",
      ip,
      req.headers.get("user-agent") ?? "",
      nowMs,
    );
    const record: Record<string, unknown> = {
      ...parsed,
      app: env.APP_ID,
      siteHost: env.SITE_HOST,
      visitHash,
      ts: nowMs,
    };
    const task = dispatchTelemetry(env, record, fetchFn).catch(() => {});
    if (ctx) ctx.waitUntil(task);
    else void task;
    return new Response(null, { status: 204, headers: strictNoStoreHeaders() });
  }

  if (url.pathname.startsWith("/r/")) {
    if (!isAppId(env.APP_ID) || !env.SITE_HOST) return jsonError(503, "proxy_not_configured");
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response(null, { status: 405, headers: strictNoStoreHeaders({ allow: "GET, HEAD" }) });
    }
    const slug = url.pathname.slice(3);
    if (!SHORTLINK_SLUG_RE.test(slug)) {
      return new Response(req.method === "HEAD" ? null : "Not found", {
        status: 404,
        headers: strictNoStoreHeaders({ "content-type": "text/plain; charset=utf-8" }),
      });
    }
    const location = resolveSafeRedirectTarget(slug, url, env);
    if (!location) {
      return jsonError(400, "invalid_redirect");
    }
    const nowMs = now();
    const ip = req.headers.get("cf-connecting-ip") || UNKNOWN_IP;
    const visitHash = await rotatingVisitHash(
      env.SITE_HOST,
      env.TELEMETRY_SALT ?? env.PLATFORM_PROXY_SECRET ?? "anon",
      ip,
      req.headers.get("user-agent") ?? "",
      nowMs,
    );
    const isQr = /^(?:qr_|COAST-|EVT-|FLIER-|SLEEVE-)/i.test(slug) || url.searchParams.get("src") === "qr";
    const record: Record<string, unknown> = {
      event: isQr ? "qr_scan" : "link_click",
      path: url.pathname,
      qrBatch: slug,
      app: env.APP_ID,
      siteHost: env.SITE_HOST,
      visitHash,
      ts: nowMs,
    };
    const task = dispatchTelemetry(env, record, fetchFn).catch(() => {});
    if (ctx) ctx.waitUntil(task);
    else void task;
    return new Response(null, { status: 302, headers: strictNoStoreHeaders({ location }) });
  }

  return null;
}

/** Headers that belong to one hop, or that only Cloudflare or this Worker may set (plus every cf-* header). */
const DROP = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer",
  "x-forwarded-host", "x-forwarded-for", "x-forwarded-proto", "x-real-ip", "true-client-ip", "forwarded", "cdn-loop"]);

/** The signed proxy headers for one forwarded request (packages/platform/src/proxy.ts). Exported for scripts/sites-dev.ts and tests. */
export function proxyHeaders(o: { secret: string; method: string; url: URL; host: string; ip: string; now: number }): Promise<Record<string, string>> {
  return signProxyHeaders(o.secret, { method: o.method, path: signedPath(o.url), host: o.host, ip: o.ip || UNKNOWN_IP, ts: Math.floor(o.now / 1000) });
}

export async function handle(
  req: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
  ctx?: ExecutionContextLike,
): Promise<Response> {
  const url = new URL(req.url);
  const telemetry = await handleTelemetryEndpoint(req, url, env, fetchFn, now, ctx);
  if (telemetry) return telemetry;
  const handoff = await updateHandoffPage(req, env.APP_ID, (asset) => env.ASSETS.fetch(asset));
  if (handoff) return handoff;
  const retired = retiredSitePage(req, env.APP_ID);
  if (retired) return retired;
  if (workerRoute(req, env.APP_ID) !== "ForwardToBackend") return env.ASSETS.fetch(req);
  const secret = env.PLATFORM_PROXY_SECRET;
  if (!secret || !env.BACKEND_ORIGIN || !env.APP_ID || !env.SITE_HOST) return jsonError(503, "proxy_not_configured");

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    if (!DROP.has(key) && !isProxyHeader(key) && !key.startsWith("cf-")) headers.set(key, v);
  });
  const ip = req.headers.get("cf-connecting-ip") || UNKNOWN_IP;
  const target = new URL(url.pathname + url.search, env.BACKEND_ORIGIN);
  // The signature covers the path and query the backend receives (the same as the visitor's).
  for (const [k, v] of Object.entries(await proxyHeaders({ secret, method: req.method, url: target, host: env.SITE_HOST, ip, now: now() }))) headers.set(k, v);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  // The backend reads at most 9 MB (deploy/backend MAX_PUBLIC_BODY_BYTES): a bigger body is refused here, unread.
  // A chunked body (no Content-Length) is read with the same cap and abandoned past it.
  const body = hasBody ? await readCapped(req, MAX_BODY_BYTES) : undefined;
  if (body === "too_large") return jsonError(413, "too_large");
  let upstream: Response;
  try {
    upstream = await fetchFn(target.toString(), {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });
  } catch {
    return jsonError(502, "api_unreachable");
  }
  // A fresh Response keeps every Set-Cookie and lets us add the headers _headers cannot (it covers assets only).
  const out = new Response(upstream.body, upstream);
  if (!out.headers.has("x-content-type-options")) out.headers.set("x-content-type-options", "nosniff");
  if (!out.headers.has("referrer-policy")) out.headers.set("referrer-policy", "no-referrer");
  if (!out.headers.has("strict-transport-security")) out.headers.set("strict-transport-security", HSTS);
  return out;
}

export default {
  fetch(req: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response> {
    return handle(req, env, fetch, Date.now, ctx);
  },
};
