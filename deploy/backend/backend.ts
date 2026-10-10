// The shared backend as one deployable process (docs/deploy.md). It wraps the Network service
// (packages/network/service) for a host that gives the process one public port (Railway):
//
//   PORT (public)          /api/*                 the platform public API, for the four sites' Worker routers
//                          /webhooks/blooio[/app] the inbound line webhooks (signature checked by the service)
//                          /internal/turn, /internal/turn-receipt, /internal/set-state, /internal/signals, /internal/updates
//                                                 the Eliza gateway's signed calls (SERVICE_TURN_SECRET, checked by the service; STOP,
//                                                 START, HELP and leave are answered inside the turn). A body over 256 KiB is refused here.
//                          /mcp, /oauth/*, /.well-known/oauth-*   the MCP server (packages/mcp, mounted by server.ts; 404 when off)
//                          /healthz               liveness for the platform health check and the external uptime monitor
//                                                 (no data, no auth; 503 when the database is down or a network's tick is late)
//                          /ops/metrics           queues, send outcomes, safety counts and today's cost (OPS_METRICS_TOKEN; 404 without it)
//   STAFF_PORT (private)   everything the service's staff API answers (/health, /review, /safety/*, ...),
//                          for the observatory console over the private network. Never on the public port.
//
// The site Workers (deploy/router.ts) forward the backend paths with headers signed by the platform's
// proxy scheme (packages/platform/src/proxy.ts: x-network-proxy-{ip,host,ts,sig}, HMAC-SHA256 with
// PLATFORM_PROXY_SECRET, 60 s window). This process checks them with that module's verifyProxyHeaders
// before the public API or the MCP server sees the request: a verified request gets Host = the signed
// site host (which picks the app) and keeps the signed visitor IP for the rate limits; any other
// request loses every proxy and forwarding header, so a client can never pick either one.
import { appForHost, DEFAULT_HOST_MAP, isAppId, type AppId } from "../../packages/platform/src/apps.ts";
import { requirePlatformEnv, type Env, type PlatformEnv } from "../../packages/platform/src/env.ts";
import { PROXY_HEADERS, verifyProxyHeaders } from "../../packages/platform/src/proxy.ts";
import { timingSafeEqual } from "node:crypto";
import { opsConfigFromEnv, type OpsConfig } from "./ops.ts";

export { PROXY_HEADERS };
/** The visitor IP the public API reads (ipOf). Present only on a verified request. */
export const CLIENT_IP = PROXY_HEADERS.ip;
export const BUILD_HEADER = "x-network-build";
const STRIP = ["x-forwarded-host", "x-forwarded-for", "x-forwarded-proto", "x-real-ip", "forwarded", "true-client-ip"];
const PROXY_PREFIXES = ["x-network-proxy-", "x-ntwrk-proxy-"];
/** The Eliza gateway's signed routes (served by the service) and their body cap (the service's MAX_BODY_BYTES). */
const INTERNAL_PATHS = new Set(["/internal/turn", "/internal/turn-receipt", "/internal/set-state", "/internal/signals", "/internal/updates"]);
const MAX_INTERNAL_BODY = 256 * 1024;

// ------------------------------------------------------------------ config

export interface BackendConfig {
  env: PlatformEnv;
  deployed: boolean;
  /** The service login (NETWORK_DATABASE_URL or DATABASE_URL). Deployed: never a superuser, BYPASSRLS or table owner (checked at boot). */
  databaseUrl: string;
  /** The migration login (MIGRATION_DATABASE_URL; the owner or a superuser). Locally the same as databaseUrl. */
  migrationUrl: string;
  host: string;
  port: number;
  /** The staff API listener; undefined when BACKEND_STAFF=off. */
  staff?: { host: string; port: number };
  proxySecret?: string;
  /** Extra site hosts for previews and staging: BACKEND_EXTRA_HOSTS="pr-1-slop.example.workers.dev=slop,...". */
  hostMap: Record<string, AppId>;
  build: string;
  migrateOnBoot: boolean;
  /** "dry-run" unless NETWORK_CHANNEL=blooio with BLOOIO_ALLOW_SEND=1 and NTWRK_LIVE_APPROVED=1 (each app also needs its own flag). */
  channel: "dry-run" | "blooio" | "eliza_cloud";
  shutdownGraceMs: number;
  tickMs: number;
  /** /healthz answers 503 "tick_late" when a network's tick has not finished in this process for this long (TICK_LATE_MS). */
  tickLateMs: number;
  /** Monitoring, alerts and budgets (ops.ts; docs/deploy.md section 7). */
  ops: OpsConfig;
  warnings: string[];
}

const SECRET_MIN = 32;
/** The largest request body the public port reads: a photo (8 MB, packages/platform/src/photos.ts) and some room. */
export const MAX_PUBLIC_BODY_BYTES = 9 * 1024 * 1024;

/** Reads and checks the environment. Fails closed: a deployed environment without its secrets does not start. */
export function loadConfig(e: Env = process.env, argv: string[] = []): BackendConfig {
  const env = requirePlatformEnv(e);
  const deployed = env === "staging" || env === "production";
  const databaseUrl = e.NETWORK_DATABASE_URL || e.DATABASE_URL;
  const missing: string[] = [];
  if (!databaseUrl) missing.push("DATABASE_URL (or NETWORK_DATABASE_URL)");
  const proxySecret = e.PLATFORM_PROXY_SECRET || undefined;
  if (deployed) {
    for (const k of ["PLATFORM_HASH_KEY", "TURNSTILE_SECRET_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"]) if (!e[k]) missing.push(k);
    if (e.OTP_PROVIDER !== "twilio") missing.push("OTP_PROVIDER=twilio");
    if (!proxySecret) missing.push("PLATFORM_PROXY_SECRET");
  }
  // Deployed: migrations run as the owner, the service as a login that RLS and the grants apply to
  // (audit: one superuser URL made every policy and grant moot in production).
  const migrateOnBoot = (e.MIGRATE_ON_BOOT ?? "1") !== "0";
  const migrationUrl = e.MIGRATION_DATABASE_URL || (deployed ? undefined : databaseUrl);
  if (deployed && migrateOnBoot && !migrationUrl) missing.push("MIGRATION_DATABASE_URL (or MIGRATE_ON_BOOT=0)");
  if (deployed && migrationUrl && databaseUrl && migrationUrl === databaseUrl) throw new Error("MIGRATION_DATABASE_URL must be a different login from the service's NETWORK_DATABASE_URL");
  if (missing.length) throw new Error(`PLATFORM_ENV=${env} needs ${missing.join(", ")}`);
  if (proxySecret && proxySecret.length < SECRET_MIN) throw new Error(`PLATFORM_PROXY_SECRET must be at least ${SECRET_MIN} characters`);
  if (deployed && e.PLATFORM_HASH_KEY!.length < SECRET_MIN) throw new Error(`PLATFORM_HASH_KEY must be at least ${SECRET_MIN} characters`);

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
  // Local: loopback only. Deployed: every interface for the public port; the staff port is dual-stack ("::")
  // because a private network may be IPv6 only. Nothing else may override this.
  const host = deployed ? "0.0.0.0" : "127.0.0.1";
  const staffHost = deployed ? "::" : "127.0.0.1";

  const hostMap: Record<string, AppId> = { ...DEFAULT_HOST_MAP };
  for (const pair of (e.BACKEND_EXTRA_HOSTS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    const [h, a] = pair.split("=").map(s => s?.trim().toLowerCase());
    if (!h || !a || !isAppId(a)) throw new Error(`BACKEND_EXTRA_HOSTS: "${pair}" is not host=app with a known app`);
    if (env === "production") throw new Error("BACKEND_EXTRA_HOSTS is for staging and previews, not production");
    hostMap[h] = a;
  }

  const blooioAsked = e.NETWORK_CHANNEL === "blooio" && !argv.includes("--dry-run");
  const cloudAsked = e.NETWORK_CHANNEL === "eliza_cloud" && !argv.includes("--dry-run");
  // The Blooio adapter is built only when the global flags are on; each app's own flag is checked again per send.
  // The same global check as liveSendAllowed(env, "ntwrk") in packages/network/service/channel.ts.
  const channel = (blooioAsked || cloudAsked) && e.BLOOIO_ALLOW_SEND === "1" && e.NTWRK_LIVE_APPROVED === "1" ? cloudAsked ? "eliza_cloud" : "blooio" : "dry-run";
  if (blooioAsked && channel === "dry-run") warnings.push("NETWORK_CHANNEL=blooio without BLOOIO_ALLOW_SEND=1 and NTWRK_LIVE_APPROVED=1: sends stay dry-run");
  if (cloudAsked && channel === "dry-run") warnings.push("NETWORK_CHANNEL=eliza_cloud without BLOOIO_ALLOW_SEND=1 and NTWRK_LIVE_APPROVED=1: sends stay dry-run");
  if (channel === "eliza_cloud" && (!e.NETWORK_CLOUD_DELIVERY_ORIGIN || !e.SERVICE_TURN_SECRET || e.SERVICE_TURN_SECRET.length<32 || !(e.BLOOIO_FROM || e.BLOOIO_FROM_NUMBER))) throw new Error("Cloud sends need NETWORK_CLOUD_DELIVERY_ORIGIN, SERVICE_TURN_SECRET and BLOOIO_FROM");
  if (channel === "blooio" && (!e.BLOOIO_API_KEY || !(e.BLOOIO_FROM || e.BLOOIO_FROM_NUMBER))) throw new Error("live sends need BLOOIO_API_KEY and BLOOIO_FROM");
  if (!e.NETWORK_SERVICE_TOKENS) warnings.push("NETWORK_SERVICE_TOKENS is not set: every staff route answers 401");
  if (!e.BLOOIO_WEBHOOK_SECRET) warnings.push("BLOOIO_WEBHOOK_SECRET is not set: the shared-line webhook answers 503");
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
    shutdownGraceMs: Number(e.SHUTDOWN_GRACE_MS ?? 25_000),
    tickMs,
    tickLateMs: Number(e.TICK_LATE_MS ?? Math.max(15 * 60_000, 3 * tickMs)),
    ops,
    warnings,
  };
}

/**
 * Why the service login may not run a deployed backend, or undefined. A superuser, a BYPASSRLS role or
 * the owner of the platform tables skips row-level security, so the per-app scoping (app.app_id), the
 * least-privilege grants and the never-updated consent events would not hold (audit: backend superuser).
 */
export async function serviceLoginProblem(query: (q: string) => Promise<Record<string, unknown>[]>): Promise<string | undefined> {
  const [r] = await query(`select r.rolsuper, r.rolbypassrls,
      exists (select 1 from pg_tables t where t.schemaname in ('platform', 'network') and pg_has_role(current_user, t.tableowner, 'USAGE')) as owner
    from pg_roles r where r.rolname = current_user`);
  if (!r) return "the service login is not a role";
  if (r.rolsuper) return "the service login is a superuser";
  if (r.rolbypassrls) return "the service login has BYPASSRLS";
  if (r.owner) return "the service login owns (or is a member of the owner of) platform or network tables";
  return undefined;
}

// ------------------------------------------------------------------ logs

/** Phone numbers in free text: E.164, NANP with separators, and bare 10-11 digit runs. */
const PHONE_RES = [/\+\d[\d\s().-]{6,18}\d/g, /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, /(?<![\d.])1?\d{10}(?![\d.])/g];
/** Fields that may carry what a person wrote or a secret: dropped from every log line. */
const DROP_KEYS = new Set(["text", "body", "message_text", "phone", "e164", "from", "to", "code", "token", "secret", "authorization", "cookie"]);

export function redact(s: string): string {
  let out = s;
  for (const re of PHONE_RES) out = out.replace(re, "[phone]");
  return out;
}

export type LogFields = Record<string, unknown>;
export interface Logger { info(msg: string, f?: LogFields): void; warn(msg: string, f?: LogFields): void; error(msg: string, f?: LogFields): void }

/** One JSON object per line: t, level, msg and fields. Phone numbers are masked; text and secrets are dropped. */
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

/** Routes console.* through the logger, so that library lines are structured and redacted too. */
export function captureConsole(log: Logger) {
  const fmt = (args: unknown[]) => args.map(a => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  console.log = (...a: unknown[]) => log.info(fmt(a));
  console.info = (...a: unknown[]) => log.info(fmt(a));
  console.warn = (...a: unknown[]) => log.warn(fmt(a));
  console.error = (...a: unknown[]) => log.error(fmt(a));
}

// ------------------------------------------------------------------ edge headers

/**
 * The request the public API (and the MCP server) sees. Verified (verifyProxyHeaders, and the signed
 * host is a site the platform knows): Host and the URL become the site's host, and the signed headers
 * stay, so the same check further in still passes. Otherwise every proxy and forwarding header is
 * removed and the app comes from the request's own Host (which, on the deployed origin, names no app).
 */
export async function normalizeEdge(req: Request, secret: string | undefined, hostMap: Record<string, AppId>, nowMs: number = Date.now()): Promise<{ req: Request; app?: AppId; edge: boolean }> {
  const headers = new Headers(req.headers);
  const url = new URL(req.url);
  const v = await verifyProxyHeaders(req, secret, Math.floor(nowMs / 1000));
  let app = v ? appForHost(v.host, hostMap) : undefined;
  for (const h of STRIP) headers.delete(h);
  if (v && app) {
    headers.set("host", v.host);
    url.host = v.host;
    url.protocol = "https:";
    if (!/^[0-9a-f:.]{2,45}$/i.test(v.ip)) headers.delete(PROXY_HEADERS.ip);
  } else {
    for (const k of [...headers.keys()]) if (PROXY_PREFIXES.some(p => k.toLowerCase().startsWith(p))) headers.delete(k);
    app = appForHost(headers.get("host") ?? url.host, hostMap);
  }
  const init: RequestInit = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") { init.body = req.body; (init as Record<string, unknown>).duplex = "half"; }
  return { req: new Request(url, init), app, edge: !!(v && app) };
}

/** The client IP for the rate limits: the trusted edge header (normalizeEdge removed any other copy), else the socket. */
export const ipOf = (req: Request, peer?: string) => req.headers.get(CLIENT_IP) || peer || "unknown";

// ------------------------------------------------------------------ the process

/** The parts of NetworkService the backend uses (a fake in tests). */
export interface ServiceLike {
  fetch(req: Request): Promise<Response>;
  publicFetch(req: Request, server?: { requestIP(req: Request): { address: string } | null }): Promise<Response>;
  runtimes: Map<string, { id: string; tick(): Promise<boolean> }>;
  /** The single inbox's tick (packages/notify): outcome sweep, then due notifications. Optional. */
  notifyTick?(): Promise<void>;
  close(): Promise<void>;
}

export interface BackendDeps {
  svc: ServiceLike;
  config: BackendConfig;
  log: Logger;
  /** A cheap database check for /healthz (select 1). */
  ping: () => Promise<boolean>;
  /**
   * The MCP server and its OAuth endpoints (packages/mcp, when wired in), given the edge-normalized
   * request (normalizeEdge). Undefined, or an undefined answer: those paths answer 404.
   */
  mcp?: (req: Request) => Promise<Response | undefined>;
  /** The time for the proxy signature check (default Date.now). The service's clock, so every check agrees. */
  now?: () => number;
  /** Monitoring (ops.ts createOps): one round in each tick, and the snapshot for GET /ops/metrics. */
  ops?: { tick(): Promise<unknown>; metrics(): Promise<unknown> };
}

const MCP_PATH = /^\/(mcp(\/.*)?|oauth\/.*|\.well-known\/oauth-[a-z-]+(\/.*)?)$/;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** A short label for the access log: no query string, ids collapsed. */
export function routeLabel(path: string): string {
  if (path.startsWith("/api/")) return path.split("/").slice(0, 4).join("/");
  if (path.startsWith("/webhooks/")) return path.split("/").slice(0, 4).join("/");
  if (path.startsWith("/review/")) return "/review/:id";
  return path.length > 64 ? path.slice(0, 64) : path;
}

/** The bearer token matches (constant time). */
function bearerIs(req: Request, token: string): boolean {
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function createBackend(d: BackendDeps) {
  const { svc, config: c, log } = d;
  const now = () => (d.now ?? Date.now)();
  let draining = false;
  /** When each network's tick last finished in this process (ran, or skipped because another instance holds its lock). */
  const tickDone = new Map<string, number>();
  let ticksFrom: number | undefined;
  /** The networks whose tick has not finished for longer than tickLateMs (only once ticks have started). */
  const lateTicks = () => {
    if (ticksFrom === undefined) return [];
    const t = now();
    return [...svc.runtimes.values()].filter(rt => t - (tickDone.get(rt.id) ?? ticksFrom!) > c.tickLateMs).map(rt => rt.id);
  };
  const inFlight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => { inFlight.add(p); p.finally(() => inFlight.delete(p)).catch(() => {}); return p; };
  const stamp = (res: Response) => {
    const out = new Response(res.body, res);
    out.headers.set(BUILD_HEADER, c.build);
    return out;
  };

  /** The public port. */
  const publicFetch = async (req: Request, server?: { requestIP(req: Request): { address: string } | null }): Promise<Response> => {
    const t0 = performance.now();
    const url = new URL(req.url);
    const path = url.pathname;
    let app: AppId | undefined;
    let res: Response;
    try {
      if (path === "/healthz") {
        if (draining) res = json(503, { ok: false, status: "draining", build: c.build });
        else if (!(await d.ping().catch(() => false))) res = json(503, { ok: false, status: "database", build: c.build });
        // A hung tick loop is down for the uptime monitor too (the ops alerts run inside the same process).
        else res = lateTicks().length ? json(503, { ok: false, status: "tick_late", build: c.build }) : json(200, { ok: true, build: c.build, env: c.env });
      } else if (path === "/ops/metrics") {
        // Counts and network ids only. Without OPS_METRICS_TOKEN the route does not exist; a wrong token is 401.
        const token = c.ops.metricsToken;
        if (!token || !d.ops) res = json(404, { ok: false, error: "not_found" });
        else if (!bearerIs(req, token)) res = json(401, { ok: false, error: "unauthorized" });
        else if (req.method !== "GET") res = json(405, { ok: false, error: "method_not_allowed" });
        else res = json(200, await track(d.ops.metrics()));
      } else if (draining) {
        res = json(503, { ok: false, error: "shutting_down" });
      } else if (path === "/api" || path.startsWith("/api/")) {
        const n = await normalizeEdge(req, c.proxySecret, c.hostMap, (d.now ?? Date.now)());
        app = n.app;
        // Deployed, only a request a site router signed may name a site (audit: a direct request with
        // Host: slop.date was served as slop.date, and every such request shared one socket IP).
        res = c.deployed && !n.edge ? json(421, { ok: false, error: "edge_required" }) : await track(svc.publicFetch(n.req, server));
      } else if (path === "/webhooks/blooio" || path.startsWith("/webhooks/blooio/") || INTERNAL_PATHS.has(path)) {
        // A declared body over the cap is refused before the service reads or verifies it (the service caps the read too).
        res = INTERNAL_PATHS.has(path) && Number(req.headers.get("content-length") ?? "0") > MAX_INTERNAL_BODY ? json(413, { ok: false, error: "payload_too_large" }) : await track(svc.fetch(req));
      } else if (MCP_PATH.test(path)) {
        // The MCP server sees the same normalized request as the public API: Host is the site's host only via a verified edge.
        const n = await normalizeEdge(req, c.proxySecret, c.hostMap, (d.now ?? Date.now)());
        app = n.app;
        res = c.deployed && !n.edge ? json(421, { ok: false, error: "edge_required" }) : (d.mcp && (await track(d.mcp(n.req)))) || json(404, { ok: false, error: "mcp_not_enabled" });
      } else {
        // The staff API never answers on the public port.
        res = json(404, { ok: false, error: "not_found" });
      }
    } catch (e) {
      log.error("request failed", { route: routeLabel(path), error: (e as Error).message });
      res = json(500, { ok: false, error: "internal_error" });
    }
    log.info("http", { port: "public", method: req.method, route: routeLabel(path), status: res.status, ms: Math.round(performance.now() - t0), app });
    return stamp(res);
  };

  /** The staff port (private network only). */
  const staffFetch = async (req: Request): Promise<Response> => {
    const t0 = performance.now();
    const path = new URL(req.url).pathname;
    const res = draining ? json(503, { ok: false, error: "shutting_down" }) : await track(svc.fetch(req));
    log.info("http", { port: "staff", method: req.method, route: routeLabel(path), status: res.status, ms: Math.round(performance.now() - t0) });
    return stamp(res);
  };

  // Every network ticks on its own; a running tick is tracked so that shutdown waits for it.
  const busy = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const networksThenNotify = () => Promise.all([...svc.runtimes.values()].map(async rt => {
    if (draining || busy.has(rt.id)) return;
    busy.add(rt.id);
    try {
      if (!(await track(rt.tick()))) log.info("tick skipped: another instance holds the lock", { network: rt.id });
      tickDone.set(rt.id, now());
    }
    catch (e) { log.error("tick failed", { network: rt.id, error: (e as Error).message }); }
    finally { busy.delete(rt.id); }
  })).then(() => notifyTick());
  // The ops round runs beside the networks, so a network tick that hangs does not stop its alert.
  const opsTick = async () => {
    if (draining || !d.ops || busy.has("ops")) return;
    busy.add("ops");
    try { await track(d.ops.tick()); }
    catch (e) { log.error("ops tick failed", { error: (e as Error).message }); }
    finally { busy.delete("ops"); }
  };
  const tickAll = () => Promise.all([networksThenNotify(), opsTick()]).then(() => undefined);
  // The inbox ticks once per round, after the networks (their sends are recorded by then). Replicas may overlap: a delivery id is recorded once
  // (notify.deliveries primary key), so a second replica cancels instead of sending again.
  const notifyTick = async () => {
    if (draining || !svc.notifyTick || busy.has("notify")) return;
    busy.add("notify");
    try { await track(svc.notifyTick()); }
    catch (e) { log.error("notify tick failed", { error: (e as Error).message }); }
    finally { busy.delete("notify"); }
  };
  const startTicks = () => { ticksFrom = now(); const first = tickAll(); timer = setInterval(tickAll, c.tickMs); return first; };

  /**
   * Graceful shutdown: /healthz answers 503, new work is refused, the listeners stop accepting, every
   * unit of work and tick in flight finishes (they commit, deliver and release their advisory locks),
   * then the database pool closes. After shutdownGraceMs the pool closes anyway, which ends the
   * sessions and with them any lock they hold.
   */
  let stopping: Promise<{ clean: boolean }> | undefined;
  const shutdown = (servers: { stop(force?: boolean): unknown }[] = []) => stopping ??= (async () => {
    draining = true;
    if (timer) clearInterval(timer);
    for (const s of servers) { try { await s.stop(false); } catch { /* already stopped */ } }
    let clean = true;
    const wait = Promise.allSettled([...inFlight]);
    const grace = new Promise<"timeout">(r => { const t = setTimeout(() => r("timeout"), c.shutdownGraceMs); (t as { unref?: () => void }).unref?.(); });
    if ((await Promise.race([wait.then(() => "done" as const), grace])) === "timeout") { clean = false; log.warn("shutdown: work still running after the grace period", { inFlight: inFlight.size }); }
    for (const s of servers) { try { await s.stop(true); } catch { /* already stopped */ } }
    await svc.close().catch(e => log.error("shutdown: close failed", { error: (e as Error).message }));
    log.info("shutdown complete", { clean });
    return { clean };
  })();

  return { publicFetch, staffFetch, tickAll, startTicks, shutdown, get draining() { return draining; }, get inFlight() { return inFlight.size; } };
}

/**
 * Create the deployed service login named in `serviceUrl` when it does not exist yet (first deploy only,
 * run as the migration owner): LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB, member of
 * network_service, CONNECT on this database. An existing role is left exactly as it is.
 */
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
