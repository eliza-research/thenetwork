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
import { type AccountHooks, Accounts, parseJoin, publicMembership, type Who } from "./accounts.ts";
import { APPS, type AppId, type AppInfo, appForHost, DEFAULT_HOST_MAP, DEV_HOST_MAP, isAppId, publicAppInfo, siteHosts } from "./apps.ts";
import { devShortcutsAllowed, type Env } from "./env.ts";
import { type OtpProvider, OtpService, type OtpLimits } from "./otp.ts";
import { maskPhone, normalizePhone } from "./phone.ts";
import { readCappedText } from "./body.ts";
import { verifyProxyHeaders } from "./proxy.ts";
import { SessionService, SESSION_TTL_MS } from "./sessions.ts";
import type { PeopleStore } from "./store.ts";
import type { TurnstileVerifier } from "./turnstile.ts";
import type { PhotoService } from "./photos.ts";

export interface PublicApiOptions extends AccountHooks {
  store: PeopleStore;
  otp: OtpProvider;
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
  /** GET /api/demo: a synthetic, scrubbed replay for the landing page. 404 without it. */
  demo?: (app: AppId) => unknown | Promise<unknown>;
  log?: (s: string) => void;
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

const DEV_HASH_KEY = "dev-only-platform-hash-key";
const DEV_SESSION_SECRET = "dev-only-platform-session-secret";
/** The largest request body the API reads (every route takes a small JSON object). */
export const MAX_API_BODY_BYTES = 16 * 1024;

/** The text for a number that waits for staff review (it may have a new owner). It names nothing else. */
export const REVIEW_MESSAGE = "We need to check this number before it can be used here. Please try again later, or email us for help.";
/** Delete everything needs a code from a login in the last 10 minutes. */
export const REAUTH_MESSAGE = "For your safety, log in again with a new code, then delete everything.";

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
  const apps = o.apps ?? APPS;
  const hostMap = o.hostMap ?? (dev ? DEV_HOST_MAP : DEFAULT_HOST_MAP);
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

  async function handle(req: Request, url: URL, peer?: string): Promise<Response> {
    // A request signed by a site router: its host and client IP. Otherwise our own Host and the socket.
    const signed = await verifyProxyHeaders(req, proxySecret, Math.floor(now() / 1000));
    const host = signed?.host ?? (o.trustForwardedHost ? req.headers.get("x-forwarded-host") : null) ?? req.headers.get("host") ?? url.host;
    const ip = o.ipOf ? o.ipOf(req, peer) : signed?.ip || peer || "unknown";
    const appId = appForHost(host, hostMap);
    if (!appId) return json(404, { ok: false, error: "unknown_app" });
    const app = apps[appId];
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
      const jar = parseCookies(req.headers.get("cookie"));
      return (await o.photos.route(req, photoPath, appId, async () => {
        const a = await sessions.authenticate(appId, jar.get(cookieName(appId)));
        return a ? a.session.personId : "unauthorized";
      }))!;
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
    const cookies = parseCookies(req.headers.get("cookie"));
    const auth = async () => sessions.authenticate(appId, cookies.get(cookieName(appId)));
    const withSession = async (fn: (who: Who, a: NonNullable<Awaited<ReturnType<typeof auth>>>) => Promise<Response>): Promise<Response> => {
      const a = await auth();
      if (!a) return json(401, { ok: false, error: "unauthorized" });
      const res = await fn({ e164: a.session.e164, personId: a.session.personId }, a);
      if (a.rotated && !res.headers.has("set-cookie")) res.headers.append("set-cookie", cookie(appId, a.token, SESSION_TTL_MS / 1000));
      return res;
    };

    switch (`${req.method} ${path}`) {
      case "GET /api/app":
        return json(200, publicAppInfo(app));

      case "GET /api/demo": {
        const demo = o.demo && (await o.demo(appId));
        return demo ? json(200, demo, { "cache-control": "public, max-age=300" }) : json(404, { ok: false, error: "not_found" });
      }

      case "POST /api/auth/otp/start": {
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

      case "POST /api/auth/logout":
        await sessions.revoke(cookies.get(cookieName(appId)));
        return json(200, { ok: true }, { "set-cookie": cookie(appId, "", 0) });

      case "GET /api/me":
        return withSession(async who => {
          const c = await accounts.canJoin(app, who);
          return json(200, {
            app: appId, phoneMasked: maskPhone(who.e164), membership: publicMembership(c.membership),
            smsOptedIn: c.reason !== "review" && await accounts.optedIn(appId, who.e164),
            canJoin: c.canJoin, ...(c.reason && c.reason !== "member" ? { reason: c.reason } : {}),
          });
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

      case "POST /api/me/delete":
        return withSession(async (who, a) => {
          if ((b.scope === "app" || b.scope === "all") && (await accounts.held(who.e164))) return json(403, { ok: false, error: "review", message: REVIEW_MESSAGE });
          if (b.scope === "app") { await accounts.leave(app, who); return json(200, { ok: true }); }
          if (b.scope === "all") {
            // Step-up: a cookie from an older login cannot delete everything.
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
        log(`[platform] ${req.method} ${url.pathname} failed: ${(e as Error).message}`);
        return json(500, { ok: false, error: "server" });
      }
    },
  };
}
