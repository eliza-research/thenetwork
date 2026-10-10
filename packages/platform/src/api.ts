// The public API that the four sites call at same-origin /api/* (platform plan 3.3, option A).
// Responses never name or reveal another app, and /api/auth/otp/start answers the same body, after
// at least the same time, whether or not the phone is known.
//
// Where the app and the client IP come from (founder decision 2026-10-08: each site is a Cloudflare
// Worker router in front of one shared backend):
//  - A request a site router signed (proxy.ts, PLATFORM_PROXY_SECRET, at most 60 s old): the signed
//    host picks the app and the signed IP is the client.
//  - Anything else: the Host header picks the app (production names only outside dev) and the socket
//    address is the client. A header a client sets never picks the app or the rate-limit bucket.
//
// Mount it in any Bun.serve fetch:
//   const api = createPublicApi({ store, otp, turnstile });
//   Bun.serve({ fetch: async (req, server) => (await api.fetch(req, server)) ?? new Response("not found", { status: 404 }) });
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { type AccountHooks, Accounts, type MemberHookContext, parseJoin, publicMembership, type Who } from "./accounts.ts";
import { APPS, type AppId, type AppInfo, appForHost, DEFAULT_HOST_MAP, DEV_HOST_MAP, isAppId, publicAppInfo, siteHosts } from "./apps.ts";
import { devShortcutsAllowed, type Env } from "./env.ts";
import { type OtpProvider, OtpService, type OtpLimits } from "./otp.ts";
import { maskPhone, normalizePhone } from "./phone.ts";
import { readCappedText } from "./body.ts";
import { verifyProxyHeaders } from "./proxy.ts";
import { SessionService, SESSION_TTL_MS, tokenHash } from "./sessions.ts";
import type { PeopleStore } from "./store.ts";
import type { TurnstileVerifier } from "./turnstile.ts";
import type { PhotoService } from "./photos.ts";

export interface PublicApiOptions extends AccountHooks {
  store: PeopleStore;
  otp: OtpProvider;
  /** Local gated Cloud SSO transport; production enablement is not supported by this slice. */
  cloudAuthFetch?: typeof fetch;
  /** How long a positive Cloud validation is reused per session (default 60 s; 0 checks every request). */
  cloudValidationTtlMs?: number;
  /** Required outside PLATFORM_ENV=dev (createPublicApi throws without it). In dev, no token is asked for without it. */
  turnstile?: TurnstileVerifier;
  /** Host header -> app. Default: the production names; in dev also the local site ports. */
  hostMap?: Record<string, AppId>;
  /** App policy; defaults to APPS. The service passes the platform.apps rows. */
  apps?: Record<AppId, AppInfo>;
  /** Key for the keyed hashes (phones, IPs, OTP codes). Required outside dev (PLATFORM_HASH_KEY). */
  hashKey?: string;
  /** Key for the stored session token hashes. Required outside dev (PLATFORM_SESSION_SECRET). */
  sessionSecret?: string;
  /** The secret the site routers sign the client IP and host with (PLATFORM_PROXY_SECRET). Without it nothing a header says is trusted. */
  proxySecret?: string;
  now?: () => number;
  env?: Env;
  /** Behind the dev site proxy (scripts/sites-dev.ts), which rewrites Host: read X-Forwarded-Host instead. Dev only (refused elsewhere). */
  trustForwardedHost?: boolean;
  /** The client IP (overrides the rules above; tests). */
  ipOf?: (req: Request, peer?: string) => string;
  /** The minimum time for /api/auth/otp/start and /api/auth/otp/verify answers (default 700 ms and 300 ms). */
  minStartMs?: number;
  minVerifyMs?: number;
  otpLimits?: Partial<OtpLimits>;
  /** Private member photos (photos.ts): /api/photos/*. Without it those paths answer 404. */
  photos?: PhotoService;
  /**
   * The member's availability for GET /api/me, read from the member record the Network uses (a pause or
   * busy window set by text or by the agent, and quiet hours). It is not the messaging consent: a STOP
   * shows in smsOptedIn, never here. Without it /api/me has no participation field.
   */
  participation?: (ctx: MemberHookContext) => Promise<MemberParticipation | null> | MemberParticipation | null;
  /** POST /api/me/resume: end the member's availability pause (never a STOP: messaging consent stays as it is). 404 without it. */
  onResume?: (ctx: MemberHookContext) => Promise<void> | void;
  /** GET /api/demo: a synthetic, scrubbed replay for the landing page. 404 without it. */
  demo?: (app: AppId) => unknown | Promise<unknown>;
  log?: (s: string) => void;
}

/**
 * The member's availability (GET /api/me). `state` uses the agent contract's words: open, busy,
 * traveling or paused. `from` and `until` are ISO times or null (null `until`: until the member says
 * otherwise). `quietHours` is [start hour, end hour] in the member's time, when the member set them.
 */
export interface MemberParticipation {
  state: "open" | "busy" | "traveling" | "paused";
  from: string | null;
  until: string | null;
  quietHours?: [number, number];
}

/** What Bun.serve passes as the second fetch argument: the socket address of the request. */
export interface PeerInfo { requestIP(req: Request): { address: string } | null }

export interface PublicApi {
  /** The answer for an /api/* request, or undefined for any other path. Pass the Bun server for the socket address. */
  fetch(req: Request, server?: PeerInfo): Promise<Response | undefined>;
  accounts: Accounts;
  otp: OtpService;
  sessions: SessionService;
}

/** How far ahead of us a Cloud phone proof's issuedAt may be (clock skew). */
const CLOUD_CLOCK_SKEW_MS = 30_000;
class CloudAuthUnavailableError extends Error {}

const DEV_HASH_KEY = "dev-only-platform-hash-key";
const DEV_SESSION_SECRET = "dev-only-platform-session-secret";
/** The largest request body the API reads (every route takes a small JSON object). */
export const MAX_API_BODY_BYTES = 16 * 1024;

/** The text for a number that waits for staff review (it may have a new owner). It names nothing else. */
export const REVIEW_MESSAGE = "We need to check this number before it can be used here. Please try again later, or email us for help.";
/** Delete everything needs a code from a login in the last 10 minutes. */
export const REAUTH_MESSAGE = "For your safety, log in again with a new code, then delete everything.";
/** A number change needs a code to the current number from the last 10 minutes too (PRD F25). */
export const REAUTH_CHANGE_MESSAGE = "For your safety, log in again with a new code, then change your number.";

/** Cookie header -> map. A malformed value (bad %-escape) is skipped, never thrown. */
export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim(), raw = part.slice(i + 1).trim();
    try { out.set(k, decodeURIComponent(raw)); } catch { /* not ours, or broken: ignore it */ }
  }
  return out;
}

export function createPublicApi(o: PublicApiOptions): PublicApi {
  const env = o.env ?? process.env;
  // Fail closed: only a declared dev environment gets the dev keys, cookies without Secure, localhost hosts, no Turnstile and a trusted X-Forwarded-Host.
  const dev = devShortcutsAllowed(env);
  const hashKey = o.hashKey ?? env.PLATFORM_HASH_KEY ?? (dev ? DEV_HASH_KEY : undefined);
  if (!hashKey) throw new Error("PLATFORM_HASH_KEY is required in production and outside PLATFORM_ENV=dev");
  const sessionSecret = o.sessionSecret ?? env.PLATFORM_SESSION_SECRET ?? (dev ? DEV_SESSION_SECRET : hashKey);
  if (o.trustForwardedHost && !dev) throw new Error("trustForwardedHost is for the dev site proxy only (PLATFORM_ENV=dev)");
  if (!o.turnstile && !dev) throw new Error("a Turnstile verifier is required outside PLATFORM_ENV=dev (TURNSTILE_SECRET_KEY)");
  const proxySecret = o.proxySecret ?? env.PLATFORM_PROXY_SECRET ?? undefined;
  const now = o.now ?? Date.now;
  const localOrigin = (raw: string | undefined) => {
    if (!raw) return undefined;
    const value = new URL(raw);
    if (value.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(value.hostname) || value.href !== `${value.origin}/`) throw new Error("Cloud auth review requires an exact loopback site origin");
    return value.origin;
  };
  const cloudAuth = env.NETWORK_CLOUD_AUTH_ENABLED === "true" ? (() => {
    if (!dev || env.NETWORK_CLOUD_AUTH_LOGIN_ORIGIN !== "https://cloud-staging.eliza.app"
      || env.NETWORK_CLOUD_AUTH_API_ORIGIN !== "https://api-staging.eliza.app"
      || (env.NETWORK_CLOUD_AUTH_SERVER_TOKEN?.length ?? 0) < 32) throw new Error("Cloud site auth requires the approved staging/local tuple and server authority");
    const siteOrigin = localOrigin(env.NETWORK_CLOUD_AUTH_SITE_ORIGIN);
    if (!siteOrigin) throw new Error("Cloud auth review requires the configured loopback site origin");
    return {loginOrigin: env.NETWORK_CLOUD_AUTH_LOGIN_ORIGIN, apiOrigin: env.NETWORK_CLOUD_AUTH_API_ORIGIN,
      siteOrigin, serverToken: env.NETWORK_CLOUD_AUTH_SERVER_TOKEN};
  })() : undefined;
  const apps = o.apps ?? APPS;
  const hostMap = o.hostMap ?? (dev ? DEV_HOST_MAP : DEFAULT_HOST_MAP);
  const cloudApp = cloudAuth ? appForHost(new URL(cloudAuth.siteOrigin).host, hostMap) : undefined;
  if (cloudAuth && !cloudApp) throw new Error("Cloud auth site must map to a canonical app");
  const log = o.log ?? (s => console.log(s));
  const accounts = new Accounts(o.store, {
    hashKey, now, env, apps: id => apps[id],
    hooks: { onJoin: o.onJoin, onStop: o.onStop, onForget: o.onForget, onExport: o.onExport, onAgeLowered: o.onAgeLowered },
  });
  const otp = new OtpService(o.store, o.otp, { hashKey, now, limits: o.otpLimits, log });
  const sessions = new SessionService(o.store, { now, secret: sessionSecret });
  const cookieName = (app: AppId) => (dev ? `sid_${app}` : "__Host-sid");
  const cookie = (app: AppId, token: string, maxAge: number) =>
    `${cookieName(app)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${dev ? "" : "; Secure"}`;

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });
  const pad = async (t0: number, min: number) => { const left = min - (performance.now() - t0); if (left > 0) await Bun.sleep(left); };

  /** The JSON object body, "too_large" over 16 KB, or undefined when it is not a JSON object. */
  async function body(req: Request): Promise<Record<string, unknown> | "too_large" | undefined> {
    try {
      const raw = await readCappedText(req, MAX_API_BODY_BYTES);
      if (raw === "too_large") return "too_large";
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }

  // Cloud cookies are encrypted and authenticated (AES-256-GCM) with their own key, not the session-token
  // HMAC, and each carries its kind as associated data: a pending cookie is never accepted as an identity,
  // and the browser never sees the phone number or the Cloud ids inside.
  const sealKey = createHash("sha256").update(`cloud-seal:${sessionSecret}`).digest();
  type SealKind = "cloud-pending" | "cloud-identity";
  const seal = (kind: SealKind, value: unknown) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", sealKey, iv);
    cipher.setAAD(Buffer.from(kind));
    const data = Buffer.concat([cipher.update(JSON.stringify({...(value as object), kind})), cipher.final(), cipher.getAuthTag()]);
    return `${iv.toString("base64url")}.${data.toString("base64url")}`;
  };
  const unseal = (kind: SealKind, value: string | undefined): Record<string, unknown> | null => {
    const [iv, data, extra] = (value ?? "").split(".");
    if (!iv || !data || extra) return null;
    try {
      const raw = Buffer.from(data, "base64url");
      if (raw.length < 17) return null;
      const decipher = createDecipheriv("aes-256-gcm", sealKey, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(kind));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      const parsed = JSON.parse(Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString());
      return parsed && typeof parsed === "object" && parsed.kind === kind ? parsed : null;
    } catch { return null; }
  };
  // Secure (and the __Host- prefix) outside dev, like the session cookie. Cloud auth runs only in dev today;
  // this keeps the cookies safe if the gate is ever widened.
  const identityName = (app: AppId) => (dev ? `cloud_identity_${app}` : "__Host-cloud_identity");
  const identityCookie = (app: AppId, value: string, age: number) => `${identityName(app)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${dev ? "" : "; Secure"}`;
  // A positive Cloud validation is reused for 60 seconds per session, so a Cloud blip or a page load does not
  // cost a round trip on every request. A denial is never cached.
  const VALIDATION_TTL_MS = o.cloudValidationTtlMs ?? 60_000;
  const validated = new Map<string, number>();
  async function cloudSessionStatus(app: AppId, jar: Map<string, string>, token: string): Promise<"valid" | "invalid" | "unavailable"> {
    const cloud = cloudAuth && cloudApp === app ? cloudAuth : undefined;
    if (!cloud) return token.startsWith("cloud.") ? "invalid" : "valid";
    const identity = unseal("cloud-identity", jar.get(identityName(app)));
    const sessionHash = tokenHash(token, sessionSecret);
    if (!identity || identity.app !== app || identity.sessionHash !== sessionHash
      || typeof identity.expiresAt !== "number" || identity.expiresAt <= now()) { validated.delete(sessionHash); return "invalid"; }
    if ((validated.get(sessionHash) ?? 0) > now()) return "valid";
    const {kind: _kind, ...proof} = identity;
    const status = await validate(cloud, proof);
    if (status === "valid") {
      if (validated.size > 10_000) validated.clear();
      validated.set(sessionHash, now() + VALIDATION_TTL_MS);
    } else validated.delete(sessionHash);
    return status;
  }
  async function validate(cloud: NonNullable<typeof cloudAuth>, identity: Record<string, unknown>): Promise<"valid" | "invalid" | "unavailable"> {
    try {
      const response = await (o.cloudAuthFetch ?? fetch)(new Request(`${cloud.apiOrigin}/api/auth/sso-bridge/network-validate`, {
        method: "POST", headers: {"content-type": "application/json", origin: cloud.siteOrigin, authorization: `Bearer ${cloud.serverToken}`},
        body: JSON.stringify(identity), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
      }));
      if (response.redirected || response.status === 429 || response.status >= 500 || response.status === 404) return "unavailable";
      if (!response.ok) {
        // Only the owner's explicit proof denial revokes a session. Authority/configuration failures stay unavailable.
        const failure = await response.json() as {ok?: unknown; code?: unknown};
        return response.status === 403 && failure.ok === false && failure.code === undefined ? "invalid" : "unavailable";
      }
      return (await response.json() as {ok?: unknown}).ok === true ? "valid" : "unavailable";
    } catch { return "unavailable"; }
  }

  async function handle(req: Request, url: URL, peer?: string): Promise<Response> {
    // A request signed by a site router: its host and client IP. Otherwise our own Host and the socket.
    const signed = await verifyProxyHeaders(req, proxySecret, Math.floor(now() / 1000));
    const host = signed?.host ?? (o.trustForwardedHost ? req.headers.get("x-forwarded-host") : null) ?? req.headers.get("host") ?? url.host;
    const ip = o.ipOf ? o.ipOf(req, peer) : signed?.ip || peer || "unknown";
    const appId = appForHost(host, hostMap);
    if (!appId) return json(404, { ok: false, error: "unknown_app" });
    const app = apps[appId];
    const cookies = parseCookies(req.headers.get("cookie"));
    const auth = async () => {
      const token = cookies.get(cookieName(appId));
      if (!token) return undefined;
      // Check the original cookie's proof before SessionService can rotate it.
      const status = await cloudSessionStatus(appId, cookies, token);
      if (status === "unavailable") throw new CloudAuthUnavailableError();
      if (status === "invalid") { await sessions.revoke(token); return undefined; }
      return sessions.authenticate(appId, token);
    };
    const rotatedCookies = (response: Response, a: NonNullable<Awaited<ReturnType<typeof auth>>>) => {
      if (!a.rotated) return;
      const age = Math.max(0, Math.floor((a.session.expiresAt - now()) / 1000));
      response.headers.append("set-cookie", cookie(appId, a.token, age));
      if (a.token.startsWith("cloud.")) {
        const {kind: _kind, ...identity} = unseal("cloud-identity", cookies.get(identityName(appId)))!;
        const sessionHash = tokenHash(a.token, sessionSecret);
        validated.set(sessionHash, now() + VALIDATION_TTL_MS);
        response.headers.append("set-cookie", identityCookie(appId, seal("cloud-identity", {...identity, sessionHash}), age));
      }
    };
    const post = req.method === "POST";
    if (!post && req.method !== "GET") return json(405, { ok: false, error: "method" });
    const photoPath = url.pathname.replace(/\/+$/, "");
    if (o.photos && (photoPath === "/api/photos" || photoPath.startsWith("/api/photos/"))) {
      // The upload is raw image bytes, not JSON: the same cross-site checks, and an image or JSON type only.
      if (post) {
        const ct = (req.headers.get("content-type") ?? "").toLowerCase();
        if (!(photoPath === "/api/photos" ? ct.startsWith("image/") : ct.startsWith("application/json"))) return json(415, { ok: false, error: "json_required" });
        if (req.headers.get("sec-fetch-site") === "cross-site") return json(403, { ok: false, error: "origin" });
        const origin = req.headers.get("origin");
        let originHost: string | undefined;
        try { originHost = origin ? new URL(origin).host : undefined; } catch { /* not a URL */ }
        if (origin && appForHost(originHost, hostMap) !== appId) return json(403, { ok: false, error: "origin" });
      }
      let authenticated: Awaited<ReturnType<typeof auth>>;
      const response = (await o.photos.route(req, photoPath, appId, async () => {
        authenticated = await auth();
        return authenticated ? authenticated.session.personId : "unauthorized";
      }))!;
      if (authenticated) rotatedCookies(response, authenticated);
      return response;
    }
    if (post) {
      // CSRF: JSON only (a cross-site form cannot send it without CORS), a cross-site Origin or fetch is refused.
      if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { ok: false, error: "json_required" });
      if (req.headers.get("sec-fetch-site") === "cross-site") return json(403, { ok: false, error: "origin" });
      const origin = req.headers.get("origin");
      if (origin) {
        let originHost: string | undefined;
        try { originHost = new URL(origin).host; } catch { /* not a URL */ }
        if (appForHost(originHost, hostMap) !== appId) return json(403, { ok: false, error: "origin" });
      }
    }
    const parsed = post ? await body(req) : {};
    if (parsed === "too_large") return json(413, { ok: false, error: "too_large" });
    const b = parsed ?? {};
    const explicit = post ? b.app : url.searchParams.get("app");
    if (explicit !== undefined && explicit !== null && explicit !== appId) return json(400, { ok: false, error: "app_mismatch" });

    const path = url.pathname.replace(/\/+$/, "");
    const withSession = async (fn: (who: Who, a: NonNullable<Awaited<ReturnType<typeof auth>>>) => Promise<Response>): Promise<Response> => {
      const a = await auth();
      if (!a) return json(401, { ok: false, error: "unauthorized" });
      const res = await fn({ e164: a.session.e164, personId: a.session.personId }, a);
      if (!res.headers.has("set-cookie")) rotatedCookies(res, a);
      return res;
    };

    const cloud = cloudAuth && cloudApp === appId ? cloudAuth : undefined;
    const pendingName = dev ? `cloud_pending_${appId}` : "__Secure-cloud_pending";
    const pendingCookie = (value: string, age: number) => `${pendingName}=${value}; Path=/api/auth/cloud; HttpOnly; SameSite=Lax; Max-Age=${age}${dev ? "" : "; Secure"}`;
    switch (`${req.method} ${path}`) {
      case "GET /api/auth/mode":
        return json(200, {mode: cloud ? "cloud" : "otp"});
      case "POST /api/auth/cloud/start": {
        if (!cloud) return json(404, {ok: false, error: "not_found"});
        const returnPath = b.returnPath === "/join" || b.returnPath === "/join.html" ? "/join"
          : b.returnPath === "/settings" || b.returnPath === "/settings.html" ? "/settings" : null;
        if (!returnPath) return json(400, {ok: false, error: "invalid"});
        const state = randomBytes(32).toString("hex"), verifier = randomBytes(32).toString("hex");
        const challenge = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
        const signedState = seal("cloud-pending", {app: appId, state, verifier, returnPath, until: now()+300_000});
        const authorize = new URL("/network/sign-in", cloud.loginOrigin);
        authorize.searchParams.set("networkSite", cloud.siteOrigin);
        authorize.searchParams.set("state", state);
        authorize.searchParams.set("challenge", Buffer.from(challenge).toString("hex"));
        return json(200, {url: authorize.href}, {"set-cookie": pendingCookie(signedState, 300)});
      }
      case "GET /api/auth/cloud/callback": {
        if (!cloud) return json(404, {ok: false, error: "not_found"});
        const reject = (status: number) => json(status, {ok: false, error: "cloud_auth_unavailable"}, {"set-cookie": pendingCookie("", 0)});
        const pending = unseal("cloud-pending", cookies.get(pendingName));
        if (!pending || pending.app !== appId || pending.state !== url.searchParams.get("state") || typeof pending.verifier !== "string"
          || typeof pending.until !== "number" || pending.until <= now() || (pending.returnPath !== "/join" && pending.returnPath !== "/settings")) return reject(400);
        const code = url.searchParams.get("code");
        if (!code || !/^enso_[0-9a-f]{64}$/.test(code)) return reject(400);
        try {
          const response = await (o.cloudAuthFetch ?? fetch)(new Request(`${cloud.apiOrigin}/api/auth/sso-bridge/network-exchange`, {
            method: "POST", headers: {"content-type": "application/json", origin: cloud.siteOrigin, authorization: `Bearer ${cloud.serverToken}`},
            body: JSON.stringify({code, codeVerifier: pending.verifier}), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
          }));
          if (!response.ok || response.redirected) return reject(403);
          const identity = await response.json() as {userId?: unknown; organizationId?: unknown; e164?: unknown; expiresAt?: unknown; stewardUserId?: unknown; issuedAt?: unknown};
          if (typeof identity.userId !== "string" || !identity.userId || typeof identity.organizationId !== "string" || !identity.organizationId
            || normalizePhone(identity.e164) !== identity.e164 || typeof identity.e164 !== "string" || typeof identity.expiresAt !== "number" || !Number.isFinite(identity.expiresAt) || identity.expiresAt <= now()
            || typeof identity.stewardUserId !== "string" || !identity.stewardUserId || typeof identity.issuedAt !== "number"
            || !Number.isSafeInteger(identity.issuedAt) || identity.issuedAt <= 0 || identity.issuedAt*1000 > now() + CLOUD_CLOCK_SKEW_MS) return reject(403);
          await sessions.revoke(cookies.get(cookieName(appId)));
          await accounts.seen(identity.e164);
          const person = await accounts.personFor(identity.e164);
          // A Cloud clock slightly ahead never makes the session start in the future.
          const {token, session} = await sessions.create(appId, identity.e164, person?.id ?? null, null, Math.min(identity.issuedAt*1000, now()), identity.expiresAt, true);
          const age = Math.max(0, Math.floor((session.expiresAt-now())/1000));
          const sessionHash = tokenHash(token, sessionSecret);
          validated.set(sessionHash, now() + VALIDATION_TTL_MS);
          const delegatedIdentity = seal("cloud-identity", {...identity, app: appId, sessionHash});
          const responseHeaders = new Headers({location: pending.returnPath, "cache-control": "no-store", "referrer-policy": "no-referrer"});
          responseHeaders.append("set-cookie", pendingCookie("", 0));
          responseHeaders.append("set-cookie", cookie(appId, token, age));
          responseHeaders.append("set-cookie", identityCookie(appId, delegatedIdentity, age));
          return new Response(null, {status: 303, headers: responseHeaders});
        } catch { return reject(503); }
      }
      case "GET /api/app":
        return json(200, publicAppInfo(app));

      case "GET /api/demo": {
        const demo = o.demo && (await o.demo(appId));
        return demo ? json(200, demo, { "cache-control": "public, max-age=300" }) : json(404, { ok: false, error: "not_found" });
      }

      case "POST /api/auth/otp/start": {
        if (cloud) return json(409, {ok: false, error: "cloud_auth_required"});
        const t0 = performance.now();
        try {
          const e164 = normalizePhone(b.phone);
          if (!e164) return json(400, { ok: false, error: "invalid_phone" });
          if (o.turnstile && !(await o.turnstile.verify(typeof b.turnstileToken === "string" ? b.turnstileToken : undefined, ip, dev ? undefined : siteHosts(appId)))) {
            return json(400, { ok: false, error: "turnstile" });
          }
          const r = await otp.start(app, e164, ip);
          if (!r.ok) return json(429, { ok: false, error: "rate_limited" }, { "retry-after": String(Math.ceil(r.retryAfterMs / 1000)) });
          return json(200, { ok: true });
        } finally {
          await pad(t0, o.minStartMs ?? 700);
        }
      }

      case "POST /api/auth/otp/verify": {
        if (cloud) return json(409, {ok: false, error: "cloud_auth_required"});
        const t0 = performance.now();
        try {
          const e164 = normalizePhone(b.phone);
          const code = typeof b.code === "string" ? b.code.trim() : "";
          if (!e164 || !(await otp.verify(appId, e164, code, ip))) return json(400, { ok: false, error: "invalid_code" });
          // A new session at every login (the old cookie on this request is revoked: no fixation).
          await sessions.revoke(cookies.get(cookieName(appId)));
          // A number not seen for 12 months goes on hold: the session gets no person until staff decide.
          await accounts.seen(e164);
          const person = await accounts.personFor(e164);
          const { token } = await sessions.create(appId, e164, person?.id ?? null);
          return json(200, { ok: true }, { "set-cookie": cookie(appId, token, SESSION_TTL_MS / 1000) });
        } finally {
          await pad(t0, o.minVerifyMs ?? 300);
        }
      }

      case "POST /api/auth/logout": {
        await sessions.revoke(cookies.get(cookieName(appId)));
        const response = json(200, { ok: true }, { "set-cookie": cookie(appId, "", 0) });
        response.headers.append("set-cookie", identityCookie(appId, "", 0));
        return response;
      }

      case "GET /api/me":
        return withSession(async who => {
          const c = await accounts.canJoin(app, who);
          const live = c.reason === "member" && c.membership && c.person ? c.membership : undefined;
          const participation = live && o.participation ? await o.participation({ app, personId: live.personId, memberId: live.memberId, e164: who.e164 }) : null;
          return json(200, {
            app: appId, phoneMasked: maskPhone(who.e164), membership: publicMembership(c.membership),
            smsOptedIn: c.reason !== "review" && await accounts.optedIn(appId, who.e164),
            canJoin: c.canJoin, ...(c.reason && c.reason !== "member" ? { reason: c.reason } : {}),
            ...(participation ? { participation } : {}),
          });
        });

      case "POST /api/me/resume":
        // End an availability pause (set by text, by the agent or here). It is not START: a STOP stays a STOP.
        if (!o.onResume) return json(404, { ok: false, error: "not_found" });
        return withSession(async who => {
          const c = await accounts.canJoin(app, who);
          const live = c.reason === "member" && c.membership && c.person ? c.membership : undefined;
          if (!live) return json(c.reason === "review" ? 403 : 400, { ok: false, error: c.reason === "review" ? "review" : "not_member", ...(c.reason === "review" ? { message: REVIEW_MESSAGE } : {}) });
          await o.onResume!({ app, personId: live.personId, memberId: live.memberId, e164: who.e164 });
          return json(200, { ok: true });
        });

      case "POST /api/join":
        return withSession(async who => {
          const input = parseJoin(b);
          if (!input) return json(400, { ok: false, error: "invalid" });
          try {
            const r = await accounts.join(app, who, input);
            if (!r.ok) return json(400, { ok: false, error: r.error, ...(r.error === "invite_only" ? { message: app.brand.inviteOnly } : r.error === "under_age" ? { message: app.brand.underAge } : r.error === "review" ? { message: REVIEW_MESSAGE } : {}) });
            return json(200, { ok: true, membership: publicMembership(r.membership) });
          } catch (e) {
            log(`[platform] join failed on ${appId}: ${(e as Error).message}`);
            return json(500, { ok: false, error: "join_failed" });
          }
        });

      case "POST /api/me/share":
      case "POST /api/me/share/revoke":
        return withSession(async who => {
          const fields = Array.isArray(b.fields) && b.fields.every(f => typeof f === "string") ? (b.fields as string[]) : [];
          if (!isAppId(b.fromApp) || (path.endsWith("/share") && !fields.length)) return json(400, { ok: false, error: "invalid" });
          // The same answer whether or not a grant was stored or revoked: it must not tell which apps the person uses.
          if (path.endsWith("/revoke")) await accounts.revokeShare(app, who, b.fromApp);
          else await accounts.share(app, who, b.fromApp, fields);
          return json(200, { ok: true });
        });

      case "GET /api/me/export":
        return withSession(async who => (await accounts.held(who.e164))
          ? json(403, { ok: false, error: "review", message: REVIEW_MESSAGE })
          : json(200, await accounts.exportApp(app, who), { "content-disposition": `attachment; filename="${appId}-export.json"` }));

      case "POST /api/me/stop":
        // STOP from the site: every app on this number (PRD 40.3). The leave button is /api/me/delete {scope: "app"}.
        return withSession(async who => { await accounts.stop(app, who); return json(200, { ok: true }); });

      case "POST /api/me/phone/start": {
        // A member changes their own number (PRD F25), step 1: a fresh login on the current number, then a
        // code to the new one (the OTP limits apply). The answer is the same whether or not the new number is
        // known: that is checked after the code proves the person holds it.
        if (cloud) return json(409, { ok: false, error: "cloud_auth_required" });
        const t0 = performance.now();
        try {
          return await withSession(async (who, a) => {
            const e164 = normalizePhone(b.phone);
            if (!e164) return json(400, { ok: false, error: "invalid_phone" });
            if (!sessions.fresh(a.session)) return json(403, { ok: false, error: "reauth", message: REAUTH_CHANGE_MESSAGE });
            const r = await accounts.startNumberChange(app, who, e164, async () => (await otp.start(app, e164, ip)).ok);
            if (!r.ok) return json(r.error === "rate_limited" ? 429 : r.error === "review" ? 403 : 400, { ok: false, error: r.error, ...(r.error === "review" ? { message: REVIEW_MESSAGE } : {}) });
            return json(200, { ok: true });
          });
        } finally {
          await pad(t0, o.minStartMs ?? 700);
        }
      }

      case "POST /api/me/phone/confirm": {
        // Step 2: the code from the new number. The person moves to it; every session of the old number
        // ends, and this browser gets a new session on the new number.
        if (cloud) return json(409, { ok: false, error: "cloud_auth_required" });
        const t0 = performance.now();
        try {
          return await withSession(async who => {
            const code = typeof b.code === "string" ? b.code.trim() : "";
            if (!/^\d{4,10}$/.test(code)) return json(400, { ok: false, error: "invalid_code" });
            const r = await accounts.confirmNumberChange(who, (forApp, e164) => otp.verify(forApp, e164, code, ip));
            if (!r.ok) {
              const status = r.error === "review" ? 403 : r.error === "no_pending_change" || r.error === "number_in_use" ? 409 : r.error === "rate_limited" ? 429 : 400;
              return json(status, { ok: false, error: r.error, ...(r.error === "review" ? { message: REVIEW_MESSAGE } : {}) });
            }
            log(`[platform] number change confirmed on ${appId}`);
            const { token } = await sessions.create(appId, r.e164, r.personId);
            return json(200, { ok: true, phoneMasked: maskPhone(r.e164) }, { "set-cookie": cookie(appId, token, SESSION_TTL_MS / 1000) });
          });
        } finally {
          await pad(t0, o.minVerifyMs ?? 300);
        }
      }

      case "POST /api/me/delete":
        return withSession(async (who, a) => {
          if ((b.scope === "app" || b.scope === "all") && (await accounts.held(who.e164))) return json(403, { ok: false, error: "review", message: REVIEW_MESSAGE });
          if (b.scope === "app") { await accounts.leave(app, who); return json(200, { ok: true }); }
          if (b.scope === "all") {
            // Step-up: a cookie from an older login cannot delete everything. A Cloud session starts at the Cloud
            // phone proof's issuedAt, so a new Cloud sign-in (the site's reauth path) is the fresh step-up there.
            if (!sessions.fresh(a.session)) return json(403, { ok: false, error: "reauth", message: REAUTH_MESSAGE });
            await accounts.deleteAll(who);
            return json(200, { ok: true }, { "set-cookie": cookie(appId, "", 0) });
          }
          return json(400, { ok: false, error: "invalid" });
        });
    }
    return json(404, { ok: false, error: "not_found" });
  }

  return {
    accounts, otp, sessions,
    async fetch(req: Request, server?: PeerInfo) {
      const url = new URL(req.url);
      if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return undefined;
      try {
        let peer: string | undefined;
        try { peer = server?.requestIP(req)?.address; } catch { /* not a served request (tests) */ }
        return await handle(req, url, peer);
      } catch (e) {
        if (e instanceof CloudAuthUnavailableError) return json(503, {ok: false, error: "cloud_auth_unavailable"});
        log(`[platform] ${req.method} ${url.pathname} failed: ${(e as Error).message}`);
        return json(500, { ok: false, error: "server" });
      }
    },
  };
}
