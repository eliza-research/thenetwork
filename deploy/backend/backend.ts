import { backendBoot, backendBootRefused, backendWebhookServed, databaseLogin, declaredEnvironment, minimumSecretLength, photoRelaySetup, type BackendBoot } from "../../packages/core/src/generated/bootPolicy.ts";
import { lineAndStaffFacts, lineAndStaffMessages } from "../../packages/network/service/line-staff-boot.ts";
import { isBlooioWebhookPath } from "../../packages/network/service/serve.ts";
import {
  backendAcceptsWork, canStartTimer, initial as lifecycleInitial, step as stepBackendLifecycle,
} from "../../packages/core/src/generated/backendLifecycle.ts";
import { checkBackendHealth } from "../../packages/core/src/vibe/backendHealthShell.js";
import { finishBackendShutdown } from "../../packages/core/src/vibe/backendShutdownShell.js";
import type { HealthStatus } from "../../packages/core/src/generated/backendHealth.ts";
import { otpConfigProblems } from "../../packages/platform/src/otp-config.ts";
import { APPS, appForHost, stagingSiteOrigins, DEFAULT_HOST_MAP, isAppId, type AppId } from "../../packages/platform/src/apps.ts";
import { isProduction, requirePlatformEnv, type Env, type PlatformEnv } from "../../packages/platform/src/env.ts";
import { isProxyHeader, PROXY_HEADERS, verifyProxyHeaders } from "../../packages/platform/src/proxy.ts";
import { timingSafeEqual } from "node:crypto";
import { opsConfigFromEnv, type OpsConfig } from "./ops.ts";
import { networkRoutePolicy } from "../../packages/network/service/route-authority.ts";
import { RELAY_MAX_BODY_BYTES, RELAY_PATH, RELAY_PHOTO_RESOLVE_MAX_BODY_BYTES, RELAY_PHOTO_RESOLVE_PATH } from "../../packages/network/service/relay-endpoint.ts";
import { SUGGESTION_PATH } from "../../packages/network/service/profile-suggestion-endpoint.ts";
import { PROFILE_REVIEW_DISCONNECT_PATH } from "../../packages/core/src/svc/profile-review-disconnect.ts";
import { PROFILE_REVIEW_WITHDRAWAL_PATH } from "../../packages/core/src/svc/profile-review-withdrawal.ts";
import { calendarOwnerPath } from "../../packages/core/src/generated/calendarFreeBusy.ts";
import { CALENDAR_SCHEDULING_MAX_BODY } from "../../packages/core/src/svc/calendar-scheduling.ts";

export { PROXY_HEADERS };
export const CLIENT_IP = PROXY_HEADERS.ip;
export const BUILD_HEADER = "x-network-build";
const HEALTH_FAILURE = {
  Draining: "draining",
  DatabaseDown: "database",
  TickLate: "tick_late",
} as const satisfies Record<Exclude<HealthStatus, "Ready">, string>;
const STRIP = ["x-forwarded-host", "x-forwarded-for", "x-forwarded-proto", "x-real-ip", "forwarded", "true-client-ip"];
const INTERNAL_PATHS = new Set(["/internal/turn", "/internal/turn-receipt", "/internal/set-state", "/internal/signals", "/internal/updates", "/internal/relay",
  RELAY_PHOTO_RESOLVE_PATH, PROFILE_REVIEW_DISCONNECT_PATH, PROFILE_REVIEW_WITHDRAWAL_PATH, calendarOwnerPath,
  ...["preview", "decide", "delete", "collect", "consent-context"].map(action => SUGGESTION_PATH + action)]);
const MAX_INTERNAL_BODY = 256 * 1024;
const internalCap = (path: string) => {
  if (path === PROFILE_REVIEW_DISCONNECT_PATH || path === PROFILE_REVIEW_WITHDRAWAL_PATH) return 4096;
  if (path === calendarOwnerPath) return CALENDAR_SCHEDULING_MAX_BODY;
  if (path === RELAY_PHOTO_RESOLVE_PATH) return RELAY_PHOTO_RESOLVE_MAX_BODY_BYTES;
  return path === RELAY_PATH || path.startsWith(SUGGESTION_PATH) ? RELAY_MAX_BODY_BYTES : MAX_INTERNAL_BODY;
};

export interface BackendConfig {
  env: PlatformEnv;
  deployed: boolean;
  databaseUrl: string;
  migrationUrl: string;
  host: string;
  port: number;
  staff?: { host: string; port: number };
  proxySecret?: string;
  hostMap: Record<string, AppId>;
  build: string;
  migrateOnBoot: boolean;
  channel: "dry-run" | "blooio" | "eliza_cloud";
  blooioWebhook: boolean;
  publicEventsUrl?: string;
  shutdownGraceMs: number;
  tickMs: number;
  tickLateMs: number;
  ops: OpsConfig;
  leakLabelKey?: string;
  photoRelay?: PhotoRelayConfig;
  warnings: string[];
}

export interface PhotoRelayConfig { version: string; notice: string; reviewers: string[]; deliveryOrigin: string }

function exactOrigin(value: string, deployed: boolean): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  return url.origin === value && (url.protocol === "https:" || (!deployed && url.protocol === "http:" && loopback));
}

function photoRelayConfig(e: Env, deployed: boolean): PhotoRelayConfig | undefined {
  const version = e.NETWORK_PHOTO_RELAY_NOTICE_VERSION?.trim() ?? "";
  const notice = e.NETWORK_PHOTO_RELAY_NOTICE?.trim() ?? "";
  const reviewers = (e.NETWORK_PHOTO_RELAY_REVIEWERS ?? "").split(",").map(r => r.trim()).filter(Boolean);
  const deliveryOrigin = e.NETWORK_PHOTO_DELIVERY_ORIGIN?.trim() ?? "";
  const setup = photoRelaySetup(version !== "", notice !== "", notice.includes("{{recipient}}"), reviewers.length > 0,
    deliveryOrigin !== "", exactOrigin(deliveryOrigin, deployed));
  switch (setup) {
    case "PhotoRelayOff": return undefined;
    case "PhotoRelayOn": return { version, notice, reviewers, deliveryOrigin };
    case "PhotoRelayIncomplete": throw new Error("photo relay needs NETWORK_PHOTO_RELAY_NOTICE_VERSION, NETWORK_PHOTO_RELAY_NOTICE with {{recipient}}, NETWORK_PHOTO_RELAY_REVIEWERS and an exact https NETWORK_PHOTO_DELIVERY_ORIGIN together, or none of them");
    default: { const unknownSetup: never = setup; throw new Error(`unknown photo relay setup ${String(unknownSetup)}`); }
  }
}

const SECRET_MIN = minimumSecretLength;
export const MAX_PUBLIC_BODY_BYTES = 9 * 1024 * 1024;

function backendBootMessages(p: BackendBoot, e: Env, otpProblems: string[], devSwitches: string[]): string[] {
  const out: string[] = [];
  if (p.devConflict) out.push("a NODE_ENV other than production when PLATFORM_ENV=dev");
  if (p.databaseMissing) out.push("DATABASE_URL (or NETWORK_DATABASE_URL)");
  if (p.hashMissing) out.push("PLATFORM_HASH_KEY");
  else if (p.hashShort) out.push(`PLATFORM_HASH_KEY of at least ${SECRET_MIN} characters`);
  if (p.sessionMissing) out.push("PLATFORM_SESSION_SECRET");
  else if (p.sessionShort) out.push(`PLATFORM_SESSION_SECRET of at least ${SECRET_MIN} characters`);
  if (p.sessionReused) out.push("a PLATFORM_SESSION_SECRET that differs from PLATFORM_HASH_KEY");
  if (p.turnstileMissing) out.push("TURNSTILE_SECRET_KEY");
  if (p.turnstileSiteMissing) out.push("TURNSTILE_SITE_KEY");
  out.push(...otpProblems);
  if (p.proxyMissing) out.push("PLATFORM_PROXY_SECRET");
  else if (p.proxyShort) out.push(`PLATFORM_PROXY_SECRET of at least ${SECRET_MIN} characters`);
  if (p.publicEventsLoginMissing) out.push("NETWORK_PUBLIC_EVENTS_DATABASE_URL");
  if (p.migrationMissing) out.push("MIGRATION_DATABASE_URL (or MIGRATE_ON_BOOT=0)");
  if (p.sharedLogin) out.push("a MIGRATION_DATABASE_URL that is a different login from the service's NETWORK_DATABASE_URL");
  if (p.leakKeyShort) out.push(`LEAK_LABEL_KEY of at least ${SECRET_MIN} bytes`);
  out.push(...lineAndStaffMessages(p, SECRET_MIN));
  if (p.reviewInvalid) out.push(`NETWORK_REVIEW_MODE=human (got ${JSON.stringify(e.NETWORK_REVIEW_MODE)})`);
  if (p.devSwitchSet) out.push(...devSwitches.map(k => `unset ${k} (dev only)`));
  return out;
}

export function loadConfig(e: Env = process.env, argv: string[] = []): BackendConfig {
  const env = requirePlatformEnv(e);
  const isolatedRoute = networkRoutePolicy(e);
  const databaseUrl = e.NETWORK_DATABASE_URL || e.DATABASE_URL;
  const proxySecret = e.PLATFORM_PROXY_SECRET || undefined;
  const migrateOnBoot = (e.MIGRATE_ON_BOOT ?? "1") !== "0";
  const lineStaff = lineAndStaffFacts(e, env === "production");
  const sessionSecret = e.PLATFORM_SESSION_SECRET ?? "";
  const devSwitches = Object.keys(e).filter(k => k.startsWith("PLATFORM_DEV_") && e[k]);
  const policy = backendBoot({
    environment: declaredEnvironment(e.PLATFORM_ENV ?? "", e.NODE_ENV ?? ""), production: isProduction(e), database: Boolean(databaseUrl),
    migrate: migrateOnBoot, migrationUrl: Boolean(e.MIGRATION_DATABASE_URL),
    sameLoginUrl: Boolean(e.MIGRATION_DATABASE_URL && databaseUrl && e.MIGRATION_DATABASE_URL === databaseUrl),
    turnstile: Boolean(e.TURNSTILE_SECRET_KEY), turnstileSite: Boolean(e.TURNSTILE_SITE_KEY?.trim()), proxyLength: proxySecret?.length ?? 0,
    hashLength: e.PLATFORM_HASH_KEY?.length ?? 0, sessionLength: sessionSecret.length,
    sessionIsHashKey: sessionSecret !== "" && sessionSecret === e.PLATFORM_HASH_KEY,
    leakKeyBytes: new TextEncoder().encode(e.LEAK_LABEL_KEY ?? "").length,
    ...lineStaff, publicEventsLogin: Boolean(e.NETWORK_PUBLIC_EVENTS_DATABASE_URL),
    review: e.NETWORK_REVIEW_MODE ?? "", reviewSet: e.NETWORK_REVIEW_MODE !== undefined, devSwitch: devSwitches.length > 0,
  });
  const { deployed } = policy;
  const otpProblems = deployed ? otpConfigProblems(e) : [];
  if (backendBootRefused(policy) || otpProblems.length) throw new Error(`PLATFORM_ENV=${env} needs ${backendBootMessages(policy, e, otpProblems, devSwitches).join("; ")}`);
  const migrationUrl = e.MIGRATION_DATABASE_URL || (deployed ? undefined : databaseUrl);
  const leakLabelKey = deployed ? e.LEAK_LABEL_KEY : undefined;
  const blooioWebhook = backendWebhookServed(e.NETWORK_CHANNEL ?? "");
  const photoRelay = photoRelayConfig(e, deployed);

  const warnings: string[] = [];
  const num = (name: string, v: string | undefined, dflt: number) => {
    if (v === undefined || v === "") return dflt;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`${name} must be a port number (got ${JSON.stringify(v)})`);
    return n;
  };
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const port = num("PORT", arg("--port") ?? e.PORT, 8790);
  const staffOff = (e.BACKEND_STAFF ?? "").toLowerCase() === "off";
  const staffPort = num("STAFF_PORT", e.STAFF_PORT, 4848);
  if (!staffOff && staffPort === port) throw new Error("STAFF_PORT must differ from PORT: the staff API never shares the public port");
  const host = deployed ? "0.0.0.0" : "127.0.0.1";
  const staffHost = deployed ? "::" : "127.0.0.1";

  const hostMap: Record<string, AppId> = { ...DEFAULT_HOST_MAP };
  const stageOrigins = stagingSiteOrigins(e);
  for (const [app, origin] of Object.entries(stageOrigins)) {
    for (const [host, owner] of Object.entries(hostMap)) if (owner === app) delete hostMap[host];
    hostMap[new URL(origin).host] = app as AppId;
  }
  for (const pair of (e.BACKEND_EXTRA_HOSTS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    const [h, a] = pair.split("=").map(s => s?.trim().toLowerCase());
    if (!h || !a || !isAppId(a)) throw new Error(`BACKEND_EXTRA_HOSTS: "${pair}" is not host=app with a known app`);
    if (env === "production") throw new Error("BACKEND_EXTRA_HOSTS is for staging and previews, not production");
    if (stageOrigins[a] && h !== new URL(stageOrigins[a]!).host) throw new Error("BACKEND_EXTRA_HOSTS conflicts with the staging app authority");
    if (Object.entries(stageOrigins).some(([app, origin]) => new URL(origin).host === h && app !== a)) throw new Error("BACKEND_EXTRA_HOSTS conflicts with the staging app authority");
    hostMap[h] = a;
  }

  const blooioAsked = e.NETWORK_CHANNEL === "blooio" && !argv.includes("--dry-run");
  const cloudAsked = e.NETWORK_CHANNEL === "eliza_cloud" && !argv.includes("--dry-run");
  const channel = !isolatedRoute && (blooioAsked || cloudAsked) && e.BLOOIO_ALLOW_SEND === "1" && e.NTWRK_LIVE_APPROVED === "1" ? cloudAsked ? "eliza_cloud" : "blooio" : "dry-run";
  if (blooioAsked && channel === "dry-run") warnings.push("NETWORK_CHANNEL=blooio without BLOOIO_ALLOW_SEND=1 and NTWRK_LIVE_APPROVED=1: sends stay dry-run");
  if (cloudAsked && channel === "dry-run") warnings.push("NETWORK_CHANNEL=eliza_cloud without BLOOIO_ALLOW_SEND=1 and NTWRK_LIVE_APPROVED=1: sends stay dry-run");
  if (channel === "eliza_cloud" && (!e.NETWORK_CLOUD_DELIVERY_ORIGIN || !e.SERVICE_TURN_SECRET || e.SERVICE_TURN_SECRET.length<32 || !(e.BLOOIO_FROM || e.BLOOIO_FROM_NUMBER))) throw new Error("Cloud sends need NETWORK_CLOUD_DELIVERY_ORIGIN, SERVICE_TURN_SECRET and BLOOIO_FROM");
  if (channel === "blooio" && (!e.BLOOIO_API_KEY || !(e.BLOOIO_FROM || e.BLOOIO_FROM_NUMBER))) throw new Error("live sends need BLOOIO_API_KEY and BLOOIO_FROM");
  if (!lineStaff.staffTokenCount) warnings.push("NETWORK_SERVICE_TOKENS is not set: every staff route answers 401");
  if (blooioWebhook && !e.BLOOIO_WEBHOOK_SECRET) warnings.push("BLOOIO_WEBHOOK_SECRET is not set: the shared-line webhook answers 503");
  if (!blooioWebhook && e.BLOOIO_WEBHOOK_SECRET) warnings.push("BLOOIO_WEBHOOK_SECRET is ignored: with NETWORK_CHANNEL=eliza_cloud the Eliza gateway owns the carrier webhook and /webhooks/blooio is not served");
  if (!deployed && !proxySecret) warnings.push("PLATFORM_PROXY_SECRET is not set: /api answers only for a Host the platform knows (local site ports)");
  const build = (e.BUILD_ID || e.RAILWAY_GIT_COMMIT_SHA || "dev").slice(0, 40);
  const tickMs = Number(e.TICK_MS ?? 60_000);
  const ops = opsConfigFromEnv(e, { env, build, deployed });
  if (deployed && !ops.webhookUrl) warnings.push("ALERT_WEBHOOK_URL is not set: alerts are log lines only (docs/deploy.md 7.2)");

  return {
    env, deployed, databaseUrl: databaseUrl!, migrationUrl: migrationUrl ?? databaseUrl!, host, port,
    staff: staffOff ? undefined : { host: staffHost, port: staffPort },
    proxySecret, hostMap,
    build,
    migrateOnBoot,
    channel,
    blooioWebhook,
    ...(e.NETWORK_PUBLIC_EVENTS_DATABASE_URL ? { publicEventsUrl: e.NETWORK_PUBLIC_EVENTS_DATABASE_URL } : {}),
    shutdownGraceMs: Number(e.SHUTDOWN_GRACE_MS ?? 25_000),
    tickMs,
    tickLateMs: Number(e.TICK_LATE_MS ?? Math.max(15 * 60_000, 3 * tickMs)),
    ops,
    ...(leakLabelKey ? { leakLabelKey } : {}),
    ...(photoRelay ? { photoRelay } : {}),
    warnings,
  };
}

export interface LiveSendRow { app: AppId; flags: string[]; queued: "live" | "dry-run"; turnReplies: "sent by the gateway" }
export function liveSendTable(e: Env, channel: BackendConfig["channel"], allowed: (env: Env, app: AppId) => boolean): LiveSendRow[] {
  return (Object.keys(APPS) as AppId[]).map(app => ({
    app,
    flags: ["NETWORK_CHANNEL", "BLOOIO_ALLOW_SEND", "NTWRK_LIVE_APPROVED", ...(app === "ntwrk" ? [] : [`${app.toUpperCase()}_LIVE_APPROVED`])],
    queued: channel !== "dry-run" && allowed(e, app) ? "live" : "dry-run",
    turnReplies: "sent by the gateway",
  }));
}

export async function serviceLoginProblem(query: (q: string) => Promise<Record<string, unknown>[]>): Promise<string | undefined> {
  const [r] = await query(`select r.rolsuper, r.rolbypassrls,
      exists (select 1 from pg_tables t where t.schemaname in ('platform', 'network') and pg_has_role(current_user, t.tableowner, 'USAGE')) as owner
    from pg_roles r where r.rolname = current_user`);
  switch (databaseLogin(Boolean(r), Boolean(r?.rolsuper), Boolean(r?.rolbypassrls), Boolean(r?.owner))) {
    case "MissingRole": return "the service login is not a role";
    case "Superuser": return "the service login is a superuser";
    case "BypassRls": return "the service login has BYPASSRLS";
    case "OwnsTables": return "the service login owns (or is a member of the owner of) platform or network tables";
    case "RestrictedRole": return undefined;
  }
}

const PHONE_RES = [/\+\d[\d\s().-]{6,18}\d/g, /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, /(?<![\d.])1?\d{10}(?![\d.])/g];
const DROP_KEYS = new Set(["text", "body", "message_text", "phone", "e164", "from", "to", "code", "token", "secret", "authorization", "cookie"]);

export function redact(s: string): string {
  let out = s;
  for (const re of PHONE_RES) out = out.replace(re, "[phone]");
  return out;
}

export type LogFields = Record<string, unknown>;
export interface Logger { info(msg: string, f?: LogFields): void; warn(msg: string, f?: LogFields): void; error(msg: string, f?: LogFields): void }

export function jsonLogger(write: (line: string) => void = s => process.stdout.write(`${s}\n`), base: LogFields = {}): Logger {
  const line = (level: string, msg: string, f: LogFields = {}) => {
    const out: LogFields = { t: new Date().toISOString(), level, msg: redact(String(msg)), ...base };
    for (const [k, v] of Object.entries(f)) {
      if (DROP_KEYS.has(k.toLowerCase())) continue;
      out[k] = typeof v === "string" ? redact(v) : v;
    }
    write(JSON.stringify(out));
  };
  return { info: (m, f) => line("info", m, f), warn: (m, f) => line("warn", m, f), error: (m, f) => line("error", m, f) };
}

export function captureConsole(log: Logger) {
  const fmt = (args: unknown[]) => args.map(a => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  console.log = (...a: unknown[]) => log.info(fmt(a));
  console.info = (...a: unknown[]) => log.info(fmt(a));
  console.warn = (...a: unknown[]) => log.warn(fmt(a));
  console.error = (...a: unknown[]) => log.error(fmt(a));
}

export async function normalizeEdge(req: Request, secret: string | undefined, hostMap: Record<string, AppId>, nowMs: number = Date.now()): Promise<{ req: Request; app?: AppId; edge: boolean }> {
  const headers = new Headers(req.headers);
  const url = new URL(req.url);
  const v = await verifyProxyHeaders(req, secret, Math.floor(nowMs / 1000));
  const signedApp = v ? appForHost(v.host, hostMap) : undefined;
  let app = signedApp;
  for (const h of STRIP) headers.delete(h);
  if (v && app) {
    headers.set("host", v.host);
    url.host = v.host;
    url.protocol = "https:";
    if (!/^[0-9a-f:.]{2,45}$/i.test(v.ip)) headers.delete(PROXY_HEADERS.ip);
  } else {
    for (const k of [...headers.keys()]) if (isProxyHeader(k)) headers.delete(k);
    app = appForHost(headers.get("host") ?? url.host, hostMap);
  }
  const init: RequestInit = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") { init.body = req.body; (init as Record<string, unknown>).duplex = "half"; }
  return { req: new Request(url, init), app, edge: !!(v && signedApp) };
}

export const ipOf = (req: Request, peer?: string) => req.headers.get(CLIENT_IP) || peer || "unknown";

export interface ServiceLike {
  fetch(req: Request): Promise<Response>;
  publicFetch(req: Request, server?: { requestIP(req: Request): { address: string } | null }): Promise<Response>;
  runtimes: Map<string, { id: string; tick(): Promise<boolean> }>;
  inboxTick(): Promise<void>;
  purge(): Promise<unknown>;
  notifyTick?(): Promise<void>;
  close(force?: boolean): Promise<void>;
}

export interface BackendDeps {
  svc: ServiceLike;
  config: BackendConfig;
  log: Logger;
  ping: () => Promise<boolean>;
  mcp?: (req: Request) => Promise<Response | undefined>;
  now?: () => number;
  ops?: { tick(): Promise<unknown>; metrics(): Promise<unknown> };
  publicEvents?: () => Promise<unknown>;
}

const isBlooioWebhook = isBlooioWebhookPath;
const MCP_PATH = /^\/(mcp(\/.*)?|oauth\/.*|\.well-known\/oauth-[a-z-]+(\/.*)?)$/;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export function routeLabel(path: string): string {
  if (path.startsWith("/api/")) return path.split("/").slice(0, 4).join("/");
  if (path.startsWith("/webhooks/")) return path.split("/").slice(0, 4).join("/");
  if (path.startsWith("/review/")) return "/review/:id";
  return path.length > 64 ? path.slice(0, 64) : path;
}

function bearerIs(req: Request, token: string): boolean {
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function createBackend(d: BackendDeps) {
  const { svc, config: c, log } = d;
  const now = () => (d.now ?? Date.now)();
  let lifecycle = lifecycleInitial;
  const tickDone = new Map<string, number>();
  const lateTicks = () => {
    if (!lifecycle.timerStarted) return [];
    const t = now();
    return [...svc.runtimes.values()].filter(rt => t - (tickDone.get(rt.id) ?? lifecycle.ticksFrom) > c.tickLateMs).map(rt => rt.id);
  };
  const inFlight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => { inFlight.add(p); p.finally(() => inFlight.delete(p)).catch(() => {}); return p; };
  const stamp = (res: Response) => {
    const out = new Response(res.body, res);
    out.headers.set(BUILD_HEADER, c.build);
    return out;
  };

  const publicFetch = async (req: Request, server?: { requestIP(req: Request): { address: string } | null }): Promise<Response> => {
    const t0 = performance.now();
    const url = new URL(req.url);
    const path = url.pathname;
    let app: AppId | undefined;
    let res: Response;
    try {
      if (path === "/healthz") {
        const status = await checkBackendHealth(backendAcceptsWork(lifecycle), {
          ping: () => d.ping(),
          hasLateTick: () => lateTicks().length > 0,
        });
        res = status === "Ready" ? json(200, { ok: true, build: c.build, env: c.env })
          : json(503, { ok: false, status: HEALTH_FAILURE[status], build: c.build });
      } else if (path === "/ops/metrics") {
        const token = c.ops.metricsToken;
        if (!token || !d.ops) res = json(404, { ok: false, error: "not_found" });
        else if (!bearerIs(req, token)) res = json(401, { ok: false, error: "unauthorized" });
        else if (req.method !== "GET") res = json(405, { ok: false, error: "method_not_allowed" });
        else res = json(200, await track(d.ops.metrics()));
      } else if (!backendAcceptsWork(lifecycle)) {
        res = json(503, { ok: false, error: "shutting_down" });
      } else if (path === "/api" || path.startsWith("/api/")) {
        const n = await normalizeEdge(req, c.proxySecret, c.hostMap, (d.now ?? Date.now)());
        app = n.app;
        res = c.deployed && !n.edge ? json(421, { ok: false, error: "edge_required" }) : await track(svc.publicFetch(n.req, server));
      } else if (isBlooioWebhook(path) && !c.blooioWebhook) {
        res = json(404, { ok: false, error: "webhook_not_served" });
      } else if (isBlooioWebhook(path) || INTERNAL_PATHS.has(path)) {
        res = INTERNAL_PATHS.has(path) && Number(req.headers.get("content-length") ?? "0") > internalCap(path) ? json(413, { ok: false, error: "payload_too_large" }) : await track(svc.fetch(req));
      } else if (MCP_PATH.test(path)) {
        const n = await normalizeEdge(req, c.proxySecret, c.hostMap, (d.now ?? Date.now)());
        app = n.app;
        res = c.deployed && !n.edge ? json(421, { ok: false, error: "edge_required" }) : (d.mcp && (await track(d.mcp(n.req)))) || json(404, { ok: false, error: "mcp_not_enabled" });
      } else {
        res = json(404, { ok: false, error: "not_found" });
      }
    } catch (e) {
      log.error("request failed", { route: routeLabel(path), error: (e as Error).message });
      res = json(500, { ok: false, error: "internal_error" });
    }
    log.info("http", { port: "public", method: req.method, route: routeLabel(path), status: res.status, ms: Math.round(performance.now() - t0), app });
    return stamp(res);
  };

  const staffFetch = async (req: Request): Promise<Response> => {
    const t0 = performance.now();
    const path = new URL(req.url).pathname;
    const res = !backendAcceptsWork(lifecycle) ? json(503, { ok: false, error: "shutting_down" })
      : isBlooioWebhook(path) && !c.blooioWebhook ? json(404, { ok: false, error: "webhook_not_served" }) : await track(svc.fetch(req));
    log.info("http", { port: "staff", method: req.method, route: routeLabel(path), status: res.status, ms: Math.round(performance.now() - t0) });
    return stamp(res);
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  const reserveTick = (tickKey: string) => {
    const reserved = stepBackendLifecycle(lifecycle, { type: "reserveTick", tickKey });
    if (reserved === lifecycle) return false;
    lifecycle = reserved;
    return true;
  };
  const releaseTick = (tickKey: string) => { lifecycle = stepBackendLifecycle(lifecycle, { type: "releaseTick", tickKey }); };
  const serviceTick = async (tickKey: string, work: () => Promise<unknown>) => {
    if (!reserveTick(tickKey)) return;
    try { await track(work()); }
    catch (e) { log.error(`${tickKey} tick failed`, { error: (e as Error).message }); }
    finally { releaseTick(tickKey); }
  };
  const inboxThenNetworks = async () => {
    await serviceTick("inbox", () => svc.inboxTick());
    await Promise.all([...svc.runtimes.values()].map(async rt => {
      if (!reserveTick(rt.id)) return;
      try {
        if (!(await track(rt.tick()))) log.info("tick skipped: another instance holds the lock", { network: rt.id });
        tickDone.set(rt.id, now());
      }
      catch (e) { log.error("tick failed", { network: rt.id, error: (e as Error).message }); }
      finally { releaseTick(rt.id); }
    }));
  };
  const notify = svc.notifyTick;
  const ops = d.ops;
  const publicEvents = d.publicEvents;
  const tickAll = () => Promise.all([
    inboxThenNetworks(),
    serviceTick("retention", () => svc.purge()),
    notify && serviceTick("notify", () => notify.call(svc)),
    ops && serviceTick("ops", () => ops.tick()),
    publicEvents && serviceTick("public_events", publicEvents),
  ]).then(() => undefined);
  const startTicks = () => {
    if (!canStartTimer(lifecycle)) return Promise.resolve(undefined);
    lifecycle = stepBackendLifecycle(lifecycle, { type: "startTimer", at: now() });
    const first = tickAll();
    if (backendAcceptsWork(lifecycle)) timer = setInterval(tickAll, c.tickMs);
    return first;
  };

  let stopping: Promise<{ clean: boolean }> | undefined;
  const shutdown = (servers: { stop(force?: boolean): unknown }[] = []) => {
    if (stopping) return stopping;
    lifecycle = stepBackendLifecycle(lifecycle, { type: "beginShutdown" });
    if (timer) clearInterval(timer);
    stopping = Promise.resolve().then(async () => {
      const clean = await finishBackendShutdown(c.shutdownGraceMs, {
        record(event) {
          lifecycle = stepBackendLifecycle(lifecycle, event);
          return lifecycle;
        },
        async stopListeners(force) {
          await Promise.allSettled(servers.map(async server => { await server.stop(force); }));
        },
        async waitForWork() { await Promise.allSettled([...inFlight]); },
        reportTimeout: () => log.warn("shutdown: work still running after the grace period", { inFlight: inFlight.size }),
        closeService: force => svc.close(force).catch(e => log.error("shutdown: close failed", { error: (e as Error).message })),
      });
      log.info("shutdown complete", { clean });
      return { clean };
    });
    return stopping;
  };

  return { publicFetch, staffFetch, tickAll, startTicks, shutdown, get draining() { return !backendAcceptsWork(lifecycle); }, get inFlight() { return inFlight.size; } };
}

export async function ensureServiceLogin(query: (q: string) => Promise<Record<string, unknown>[]>, serviceUrl: string): Promise<{ role: string; created: boolean }> {
  const u = new URL(serviceUrl);
  const role = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("service login name must be a plain lower-case identifier");
  if (role === "postgres") throw new Error("the service login must not be the postgres superuser");
  const [exists] = await query(`select 1 as x from pg_roles where rolname = '${role}'`);
  if (exists) return { role, created: false };
  if (password.length < 24) throw new Error("the service login password must be at least 24 characters");
  const lit = `'${password.replace(/'/g, "''")}'`;
  await query(`create role ${role} login password ${lit} nosuperuser nobypassrls nocreaterole nocreatedb`);
  await query(`grant network_service to ${role}`);
  await query(`do $$ begin execute format('grant connect on database %I to ${role}', current_database()); end $$`);
  return { role, created: true };
}
