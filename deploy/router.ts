// The Worker in front of each site: a Cloudflare Pages advanced-mode _worker.js (founder decision 8),
// built by sites/sites.ts. It forwards the backend paths to the one shared backend and serves every
// other path from the site's static files (env.ASSETS).
//
//   /api, /api/*, /mcp, /mcp/*, /oauth/*, /.well-known/oauth-*  -> env.BACKEND_ORIGIN (same path and query)
//   anything else                                               -> env.ASSETS (dist/, with _headers)
//
// dist/_routes.json lists the same paths, so Cloudflare runs this Worker only for them
// (keep the two lists the same; the router test that checked it was removed on 2026-10-08).
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

import { signProxyHeaders, signedPath } from "../packages/platform/src/proxy.ts";
import { readCapped } from "../packages/platform/src/body.ts";

const PROXY_PREFIXES = ["x-network-proxy-", "x-ntwrk-proxy-"];
/** The IP the router signs when Cloudflare names none (never in production; wrangler dev may omit it). */
export const UNKNOWN_IP = "unknown";

/** The largest body the router forwards (the backend's MAX_PUBLIC_BODY_BYTES). */
export const MAX_BODY_BYTES = 9 * 1024 * 1024;

/** The paths that run the Worker: Cloudflare Pages _routes.json "include" (sites/sites.ts routesFile). */
export const RUN_WORKER_FIRST = ["/api", "/api/*", "/mcp", "/mcp/*", "/oauth/*", "/.well-known/oauth-*"];

/** True for a path that belongs to the shared backend. Same rule as RUN_WORKER_FIRST. */
export function isBackendPath(pathname: string): boolean {
  return (
    pathname === "/api" || pathname.startsWith("/api/") ||
    pathname === "/mcp" || pathname.startsWith("/mcp/") ||
    pathname.startsWith("/oauth/") ||
    pathname.startsWith("/.well-known/oauth-")
  );
}

export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  /** The shared backend, for example https://api.ntwrk.love (no trailing slash needed). */
  BACKEND_ORIGIN: string;
  /** This site's app id: ntwrk | slop | peon | friends. */
  APP_ID: string;
  /** This site's canonical domain, for example slop.date. */
  SITE_HOST: string;
  /** Shared with the backend. A Worker secret: never in wrangler.toml. */
  PLATFORM_PROXY_SECRET?: string;
}

/** Headers that belong to one hop, or that only Cloudflare or this Worker may set (plus every cf-* header). */
const DROP = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer",
  "x-forwarded-host", "x-forwarded-for", "x-forwarded-proto", "x-real-ip", "true-client-ip", "forwarded", "cdn-loop"]);

/** The signed proxy headers for one forwarded request (packages/platform/src/proxy.ts). Exported for scripts/sites-dev.ts and tests. */
export function proxyHeaders(o: { secret: string; method: string; url: URL; host: string; ip: string; now: number }): Promise<Record<string, string>> {
  return signProxyHeaders(o.secret, { method: o.method, path: signedPath(o.url), host: o.host, ip: o.ip || UNKNOWN_IP, ts: Math.floor(o.now / 1000) });
}

/** True for a header a client must never be able to set on a forwarded request. */
export const isProxyHeader = (name: string) => PROXY_PREFIXES.some((p) => name.toLowerCase().startsWith(p));

const jsonError = (status: number, error: string) =>
  new Response(JSON.stringify({ ok: false, error }), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<Response> {
  const url = new URL(req.url);
  if (!isBackendPath(url.pathname)) return env.ASSETS.fetch(req);
  const secret = env.PLATFORM_PROXY_SECRET;
  if (!secret || !env.BACKEND_ORIGIN || !env.APP_ID || !env.SITE_HOST) return jsonError(503, "proxy_not_configured");

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    if (!DROP.has(key) && !PROXY_PREFIXES.some((p) => key.startsWith(p)) && !key.startsWith("cf-")) headers.set(key, v);
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
  return out;
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
};
