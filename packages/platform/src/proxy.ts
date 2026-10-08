// The trusted proxy (founder decision 2026-10-08: each site is a Cloudflare Worker with static assets
// and a tiny router that forwards /api/*, /mcp, /oauth/* and /.well-known/oauth-* to the one shared
// backend). The backend must not trust a client IP or a Host that any caller can set, so the router
// signs them:
//
//   x-network-proxy-ip    the visitor IP (CF-Connecting-IP at the router)
//   x-network-proxy-host  the site's host name (slop.date)
//   x-network-proxy-ts    unix seconds when the router signed
//   x-network-proxy-sig   base64url HMAC-SHA256(secret, "v1\n" + method + "\n" + path + "\n" + host + "\n" + ip + "\n" + ts)
//
// `path` is the pathname plus the query string as the backend receives it. The backend accepts the
// IP and the host only when PLATFORM_PROXY_SECRET is set, the signature is right and the time is
// within 60 s; otherwise it uses the socket address and its own Host map. Pure functions on Web
// Crypto, so the site routers (Workers) can copy or import this file as it is.

export const PROXY_HEADERS = {
  ip: "x-network-proxy-ip",
  host: "x-network-proxy-host",
  ts: "x-network-proxy-ts",
  sig: "x-network-proxy-sig",
} as const;
/** A signature older (or newer) than this is refused. */
export const PROXY_MAX_SKEW_S = 60;

export interface ProxyFacts { method: string; path: string; host: string; ip: string; ts: number }

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const message = (f: ProxyFacts) => ["v1", f.method.toUpperCase(), f.path, f.host.toLowerCase(), f.ip, String(f.ts)].join("\n");

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** The signature for one forwarded request. */
export const proxySignature = (secret: string, f: ProxyFacts) => hmac(secret, message(f));

/**
 * The four headers a site router sets on a forwarded request. The router must first delete any copy
 * of these headers that the client sent (stripProxyHeaders).
 */
export async function signProxyHeaders(secret: string, f: Omit<ProxyFacts, "ts"> & { ts?: number }): Promise<Record<string, string>> {
  const facts: ProxyFacts = { ...f, ts: f.ts ?? Math.floor(Date.now() / 1000) };
  return {
    [PROXY_HEADERS.ip]: facts.ip,
    [PROXY_HEADERS.host]: facts.host.toLowerCase(),
    [PROXY_HEADERS.ts]: String(facts.ts),
    [PROXY_HEADERS.sig]: await proxySignature(secret, facts),
  };
}

/** Remove client copies of the trusted headers (and the hop headers a router must not forward). */
export function stripProxyHeaders(h: Headers): Headers {
  for (const k of [...Object.values(PROXY_HEADERS), "x-forwarded-host", "x-forwarded-for", "x-real-ip", "forwarded"]) h.delete(k);
  return h;
}

/** The path the signature covers: pathname plus the query string. */
export const signedPath = (url: URL) => url.pathname + url.search;

/**
 * The client IP and the site host that a trusted router signed, or undefined (no secret, no headers,
 * a wrong signature, or a time more than 60 s away from now). `nowS` is unix seconds.
 */
export async function verifyProxyHeaders(req: Request, secret: string | undefined, nowS: number): Promise<{ ip: string; host: string } | undefined> {
  if (!secret) return undefined;
  const h = req.headers;
  const ip = h.get(PROXY_HEADERS.ip), host = h.get(PROXY_HEADERS.host), ts = h.get(PROXY_HEADERS.ts), sig = h.get(PROXY_HEADERS.sig);
  if (!ip || !host || !ts || !sig || !/^\d{1,12}$/.test(ts) || ip.length > 64 || host.length > 253) return undefined;
  const t = Number(ts);
  if (Math.abs(nowS - t) > PROXY_MAX_SKEW_S) return undefined;
  const want = await proxySignature(secret, { method: req.method, path: signedPath(new URL(req.url)), host, ip, ts: t });
  return sameString(want, sig) ? { ip, host: host.toLowerCase() } : undefined;
}

/** The paths a site router forwards to the shared backend; everything else is a static asset. */
export const FORWARDED_PATHS = /^\/(api(\/|$)|mcp(\/|$)|oauth\/|\.well-known\/oauth-)/;

/**
 * A complete site router for a Cloudflare Worker with static assets (env.ASSETS) and the backend
 * origin in env.API_ORIGIN, signing with env.PROXY_SECRET. Sites may copy it as it is.
 */
export async function routeSiteRequest(req: Request, env: { API_ORIGIN: string; PROXY_SECRET: string; ASSETS: { fetch(r: Request): Promise<Response> } }): Promise<Response> {
  const url = new URL(req.url);
  if (!FORWARDED_PATHS.test(url.pathname)) return env.ASSETS.fetch(req);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);
  const headers = stripProxyHeaders(new Headers(req.headers));
  headers.delete("host");
  const ip = req.headers.get("cf-connecting-ip") ?? "";
  for (const [k, v] of Object.entries(await signProxyHeaders(env.PROXY_SECRET, { method: req.method, path: signedPath(target), host: url.host, ip }))) headers.set(k, v);
  const res = await fetch(target, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body, redirect: "manual" });
  const out = new Response(res.body, res);
  out.headers.set("cache-control", out.headers.get("cache-control") ?? "no-store");
  return out;
}
