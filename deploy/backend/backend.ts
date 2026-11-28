import { backendBoot, backendBootRefused, backendWebhookServed, databaseLogin, declaredEnvironment, minimumSecretLength, photoStorageSetup, type BackendBoot } from "../../packages/core/src/generated/bootPolicy.ts";
import { configuredChannel, lineAndStaffFacts, lineAndStaffMessages, workersAiProblem, type ChannelName } from "../../packages/network/service/line-staff-boot.ts";
import { isBlooioWebhookPath } from "../../packages/network/service/serve.ts";
import {
  backendAcceptsWork, canStartTimer, initial as lifecycleInitial, step as stepBackendLifecycle,
} from "../../packages/core/src/generated/backendLifecycle.ts";
import { checkBackendHealth } from "../../packages/core/src/vibe/backendHealthShell.js";
import { finishBackendShutdown } from "../../packages/core/src/vibe/backendShutdownShell.js";
import type { HealthStatus } from "../../packages/core/src/generated/backendHealth.ts";
import { otpConfigProblems } from "../../packages/platform/src/otp-config.ts";
import { appForHost, stagingSiteOrigins, DEFAULT_HOST_MAP, isAppId, type AppId } from "../../packages/platform/src/apps.ts";
import { isProduction, MODEL_PROVIDER_MISSING, MODEL_PROVIDER_UNKNOWN, modelProviderFacts, requirePlatformEnv, type Env, type PlatformEnv } from "../../packages/platform/src/env.ts";
import { isProxyHeader, PROXY_HEADERS, signedPath, signProxyHeaders, verifyProxyHeaders } from "../../packages/platform/src/proxy.ts";
import { timingSafeEqual } from "node:crypto";
import { opsConfigFromEnv, type OpsConfig } from "./ops.ts";
import { RELAY_MAX_BODY_BYTES, RELAY_PATH } from "../../packages/network/service/relay-endpoint.ts";
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
  PROFILE_REVIEW_DISCONNECT_PATH, PROFILE_REVIEW_WITHDRAWAL_PATH, calendarOwnerPath,
  ...["preview", "decide", "delete", "collect", "consent-context"].map(action => SUGGESTION_PATH + action)]);
const MAX_INTERNAL_BODY = 256 * 1024;
const internalCap = (path: string) => {
  if (path === PROFILE_REVIEW_DISCONNECT_PATH || path === PROFILE_REVIEW_WITHDRAWAL_PATH) return 4096;
  if (path === calendarOwnerPath) return CALENDAR_SCHEDULING_MAX_BODY;
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
  proxySecretPrevious?: string;
  hostMap: Record<string, AppId>;
  build: string;
  migrateOnBoot: boolean;
  channel: ChannelName;
  blooioWebhook: boolean;
  publicEventsUrl?: string;
  shutdownGraceMs: number;
  tickMs: number;
  tickLateMs: number;
  ops: OpsConfig;
  leakLabelKey?: string;
  photoStorage: boolean;
  warnings: string[];
}

const SECRET_MIN = minimumSecretLength;
export const MAX_PUBLIC_BODY_BYTES = 9 * 1024 * 1024;

function backendBootMessages(p: BackendBoot, otpProblems: string[], devSwitches: string[], providerUnknown: boolean): string[] {
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
  out.push(...lineAndStaffMessages(p));
  if (p.modelProviderMissing) out.push(MODEL_PROVIDER_MISSING);
  if (providerUnknown) out.push(MODEL_PROVIDER_UNKNOWN);
  if (p.devSwitchSet) out.push(...devSwitches.map(k => `unset ${k} (dev only)`));
  return out;
}

export function loadConfig(e: Env = process.env, argv: string[] = []): BackendConfig {
  const env = requirePlatformEnv(e);
  const channel = configuredChannel(e, argv);
  const databaseUrl = e.NETWORK_DATABASE_URL || e.DATABASE_URL;
  const proxySecret = e.PLATFORM_PROXY_SECRET || undefined;
  const proxySecretPrevious = (proxySecret && e.PLATFORM_PROXY_SECRET_PREVIOUS) || undefined;
  const migrateOnBoot = (e.MIGRATE_ON_BOOT ?? "1") !== "0";
  const production = isProduction(e);
  const lineStaff = lineAndStaffFacts(e, production);
  const sessionSecret = e.PLATFORM_SESSION_SECRET ?? "";
  const devSwitches = Object.keys(e).filter(k => k.startsWith("PLATFORM_DEV_") && e[k]);
  const models = modelProviderFacts(e);
  const policy = backendBoot({
    environment: declaredEnvironment(e.PLATFORM_ENV ?? "", e.NODE_ENV ?? ""), production, database: Boolean(databaseUrl),
    migrate: migrateOnBoot, migrationUrl: Boolean(e.MIGRATION_DATABASE_URL),
    sameLoginUrl: Boolean(e.MIGRATION_DATABASE_URL && databaseUrl && e.MIGRATION_DATABASE_URL === databaseUrl),
    turnstile: Boolean(e.TURNSTILE_SECRET_KEY), turnstileSite: Boolean(e.TURNSTILE_SITE_KEY?.trim()), proxyLength: proxySecret?.length ?? 0,
    hashLength: e.PLATFORM_HASH_KEY?.length ?? 0, sessionLength: sessionSecret.length,
    sessionIsHashKey: sessionSecret !== "" && sessionSecret === e.PLATFORM_HASH_KEY,
    leakKeyBytes: new TextEncoder().encode(e.LEAK_LABEL_KEY ?? "").length,
    ...lineStaff, publicEventsLogin: Boolean(e.NETWORK_PUBLIC_EVENTS_DATABASE_URL),
    modelProvider: models.modelProvider, devSwitch: devSwitches.length > 0,
  });
  const { deployed } = policy;
  const otpProblems = deployed ? otpConfigProblems(e) : [];
  const workersAi = workersAiProblem(deployed, production, e);
  const photoStorage = photoStorageSetup(deployed, Boolean(e.PHOTO_STORAGE), e.PHOTO_STORAGE === "r2");
  const photoStorageProblem = photoStorage === "PhotoStorageRefused" ? "PHOTO_STORAGE=r2 (private photo storage) on a deployed backend" : undefined;
  if (backendBootRefused(policy) || otpProblems.length || workersAi || photoStorageProblem || models.unknown) {
    throw new Error(`PLATFORM_ENV=${env} needs ${[...backendBootMessages(policy, otpProblems, devSwitches, models.unknown), ...(workersAi ? [workersAi] : []), ...(photoStorageProblem ? [photoStorageProblem] : [])].join("; ")}`);
  }
  const migrationUrl = e.MIGRATION_DATABASE_URL || (deployed ? undefined : databaseUrl);
  if (proxySecretPrevious && proxySecretPrevious.length < SECRET_MIN) throw new Error(`PLATFORM_PROXY_SECRET_PREVIOUS must be at least ${SECRET_MIN} characters`);
  const leakLabelKey = deployed ? e.LEAK_LABEL_KEY : undefined;
  const blooioWebhook = backendWebhookServed(e.NETWORK_CHANNEL ?? "");

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

  if (channel === "dry-run" && (e.NETWORK_CHANNEL === "blooio" || e.NETWORK_CHANNEL === "eliza_cloud")) {
    warnings.push(`NETWORK_CHANNEL=${e.NETWORK_CHANNEL} with --dry-run or an isolated route: sends stay dry-run`);
  }
  if (!lineStaff.staffTokenCount) warnings.push("NETWORK_SERVICE_TOKENS is not set: every staff route answers 401");
  if (blooioWebhook && !e.BLOOIO_WEBHOOK_SECRET) warnings.push("BLOOIO_WEBHOOK_SECRET is not set: the shared-line webhook answers 503");
  if (!blooioWebhook && e.BLOOIO_WEBHOOK_SECRET) warnings.push("BLOOIO_WEBHOOK_SECRET is ignored: with NETWORK_CHANNEL=eliza_cloud the Eliza gateway owns the carrier webhook and /webhooks/blooio is not served");
  if (!deployed && !proxySecret) warnings.push("PLATFORM_PROXY_SECRET is not set: /api answers only for a Host the platform knows (local site ports)");
  const build = (e.BUILD_ID || e.RAILWAY_GIT_COMMIT_SHA || "dev").slice(0, 40);
  const ms = (name: string, dflt: number, min: number) => {
    const v = e[name];
    if (v === undefined || v.trim() === "") return dflt;
    const x = Number(v);
    if (!Number.isInteger(x) || x < min) throw new Error(`${name} must be a whole number of milliseconds of ${min} or more (got ${JSON.stringify(v)})`);
    return x;
  };
  const tickMs = ms("TICK_MS", 60_000, 1);
  const ops = opsConfigFromEnv(e, { env, build, deployed, warn: line => warnings.push(line) });
  if (deployed && !ops.webhookUrl) warnings.push("ALERT_WEBHOOK_URL is not set: alerts are log lines only (docs/deploy.md 7.2)");

  return {
    env, deployed, databaseUrl: databaseUrl!, migrationUrl: migrationUrl ?? databaseUrl!, host, port,
    staff: staffOff ? undefined : { host: staffHost, port: staffPort },
    proxySecret, ...(proxySecretPrevious ? { proxySecretPrevious } : {}), hostMap,
    build,
    migrateOnBoot,
    channel,
    blooioWebhook,
    ...(e.NETWORK_PUBLIC_EVENTS_DATABASE_URL ? { publicEventsUrl: e.NETWORK_PUBLIC_EVENTS_DATABASE_URL } : {}),
    shutdownGraceMs: ms("SHUTDOWN_GRACE_MS", 25_000, 0),
    tickMs,
    tickLateMs: ms("TICK_LATE_MS", Math.max(15 * 60_000, 3 * tickMs), 1),
    ops,
    ...(leakLabelKey ? { leakLabelKey } : {}),
    photoStorage: photoStorage === "PhotoStorageReady",
    warnings,
  };
}

export async function serviceLoginProblem(query: (q: string) => Promise<Record<string, unknown>[]>): Promise<string | undefined> {
  const [r] = await query(`select r.rolsuper, r.rolbypassrls,
      exists (select 1 from pg_tables t where t.schemaname in ('platform', 'network') and pg_has_role(current_user, t.tableowner, 'USAGE')) as owner,
      pg_has_role(current_user, 'network_service', 'MEMBER') as member
    from pg_roles r where r.rolname = current_user`);
  if (!r) return "the service login is not a role";
  if (!r.member) return "the service login is not a member of network_service";
  switch (databaseLogin(Boolean(r), Boolean(r.rolsuper), Boolean(r.rolbypassrls), Boolean(r.owner))) {
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

function sanitizeLogValue(v: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof v === "string") return redact(v);
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Error) return redact(v.message);
  if (!v || typeof v !== "object") return v;
  if (seen.has(v)) return "[circular]";
  seen.add(v);
  try {
    if (Array.isArray(v)) return v.map(x => sanitizeLogValue(x, seen));
    if (v instanceof Date) return v.toISOString();
    const out: LogFields = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (DROP_KEYS.has(k.toLowerCase())) continue;
      out[k] = sanitizeLogValue(val, seen);
    }
    return out;
  } finally {
    seen.delete(v);
  }
}

function formatConsoleArg(a: unknown): string {
  if (a instanceof Error) return a.message;
  if (typeof a === "string") return a;
  if (typeof a === "bigint") return a.toString();
  try {
    return JSON.stringify(sanitizeLogValue(a)) ?? String(a);
  } catch {
    return String(a);
  }
}

/** One JSON object per line: t, level, msg and fields. Phone numbers are masked; text and secrets are dropped. */
export function jsonLogger(write: (line: string) => void = s => process.stdout.write(`${s}\n`), base: LogFields = {}): Logger {
  const cleanBase = sanitizeLogValue(base) as LogFields;
  const line = (level: string, msg: string, f: LogFields = {}) => {
    const out: LogFields = { t: new Date().toISOString(), level, msg: redact(String(msg)), ...cleanBase };
    for (const [k, v] of Object.entries(f)) {
      if (DROP_KEYS.has(k.toLowerCase())) continue;
      out[k] = sanitizeLogValue(v);
    }
    try {
      write(JSON.stringify(out));
    } catch {
      write(JSON.stringify({ t: out.t, level, msg: out.msg, logError: "unserializable" }));
    }
  };
  return { info: (m, f) => line("info", m, f), warn: (m, f) => line("warn", m, f), error: (m, f) => line("error", m, f) };
}

export function captureConsole(log: Logger) {
  const fmt = (args: unknown[]) => args.map(formatConsoleArg).join(" ");
  console.log = (...a: unknown[]) => log.info(fmt(a));
  console.info = (...a: unknown[]) => log.info(fmt(a));
  console.warn = (...a: unknown[]) => log.warn(fmt(a));
  console.error = (...a: unknown[]) => log.error(fmt(a));
}

export async function normalizeEdge(req: Request, secret: string | undefined, hostMap: Record<string, AppId>, nowMs: number = Date.now(), previous?: string): Promise<{ req: Request; app?: AppId; edge: boolean }> {
  const headers = new Headers(req.headers);
  const url = new URL(req.url);
  const nowS = Math.floor(nowMs / 1000);
  let v = await verifyProxyHeaders(req, secret, nowS);
  let resign = false;
  if (!v && secret && previous) { v = await verifyProxyHeaders(req, previous, nowS); resign = !!v; }
  const signedApp = v ? appForHost(v.host, hostMap) : undefined;
  let app = signedApp;
  for (const h of STRIP) headers.delete(h);
  if (v && app) {
    if (resign) {
      const signed = await signProxyHeaders(secret!, { method: req.method, path: signedPath(url), host: v.host, ip: v.ip, ts: Number(req.headers.get(PROXY_HEADERS.ts)) });
      for (const [k, val] of Object.entries(signed)) headers.set(k, val);
    }
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
  reviewJudgeTick?(): Promise<void>;
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

const MCP_PATH = /^\/(mcp(\/.*)?|oauth\/.*|\.well-known\/oauth-[a-z-]+(\/.*)?)$/;
const CALENDAR_ICS_PATH = /^\/cal\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.ics$/;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export function routeLabel(path: string): string {
  if (path.startsWith("/api/")) return path.split("/").slice(0, 4).join("/");
  if (path.startsWith("/cal/")) return "/cal/:token.ics";
  if (path.startsWith("/webhooks/")) return path.split("/").slice(0, 4).join("/");
  if (path.startsWith("/review/")) return "/review/:id";
  return path.length > 64 ? path.slice(0, 64) : path;
}

function bearerIs(req: Request, token: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) return false;
  const given = Buffer.from(match[1]!.trim());
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
        const n = await normalizeEdge(req, c.proxySecret, c.hostMap, (d.now ?? Date.now)(), c.proxySecretPrevious);
        app = n.app;
        res = c.deployed && !n.edge ? json(421, { ok: false, error: "edge_required" }) : await track(svc.publicFetch(n.req, server));
      } else if (CALENDAR_ICS_PATH.test(path)) {
        const n = await normalizeEdge(req, c.proxySecret, c.hostMap, (d.now ?? Date.now)(), c.proxySecretPrevious);
        app = n.app;
        if (c.deployed && !n.edge) res = json(421, { ok: false, error: "edge_required" });
        else if (req.method !== "GET" && req.method !== "HEAD") res = json(405, { ok: false, error: "method_not_allowed" });
        else res = await track(svc.publicFetch(n.req, server));
      } else if (isBlooioWebhookPath(path) && !c.blooioWebhook) {
        res = json(404, { ok: false, error: "webhook_not_served" });
      } else if (isBlooioWebhookPath(path) || INTERNAL_PATHS.has(path)) {
        res = INTERNAL_PATHS.has(path) && Number(req.headers.get("content-length") ?? "0") > internalCap(path) ? json(413, { ok: false, error: "payload_too_large" }) : await track(svc.fetch(req));
      } else if (MCP_PATH.test(path)) {
        const n = await normalizeEdge(req, c.proxySecret, c.hostMap, (d.now ?? Date.now)(), c.proxySecretPrevious);
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
    let res: Response;
    try {
      res = !backendAcceptsWork(lifecycle) ? json(503, { ok: false, error: "shutting_down" })
        : isBlooioWebhookPath(path) && !c.blooioWebhook ? json(404, { ok: false, error: "webhook_not_served" }) : await track(svc.fetch(req));
    } catch (e) {
      log.error("request failed", { port: "staff", route: routeLabel(path), error: (e as Error).message });
      res = json(500, { ok: false, error: "internal_error" });
    }
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
  let judging: Promise<void> = Promise.resolve();
  const inboxThenNetworks = async () => {
    await serviceTick("inbox", () => svc.inboxTick());
    await judging;
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
  const reviewJudge = svc.reviewJudgeTick;
  const ops = d.ops;
  const publicEvents = d.publicEvents;
  const networksThenJudge = async () => {
    await inboxThenNetworks();
    if (!reviewJudge) return;
    const pass = Promise.all([judging, serviceTick("review_judge", () => reviewJudge.call(svc))]).then(() => undefined);
    judging = pass;
    await pass;
  };
  const tickAll = () => Promise.all([
    networksThenJudge(),
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
  await query("begin");
  try {
    await query(`create role ${role} login password ${lit} nosuperuser nobypassrls nocreaterole nocreatedb`);
    await query(`grant network_service to ${role}`);
    await query(`do $$ begin execute format('grant connect on database %I to ${role}', current_database()); end $$`);
    await query("commit");
  } catch (e) {
    await query("rollback").catch(() => {});
    throw e;
  }
  return { role, created: true };
}
