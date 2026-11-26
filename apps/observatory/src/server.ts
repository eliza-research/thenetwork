#!/usr/bin/env -S node --import=tsx
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { serveHttp, type HttpServer as Server, type ServerWebSocket } from "../../../packages/core/src/runtime/http.ts";
import { buildWebRoutes } from "./web-assets.ts";
import { initial as initialRoute, staffMemberAccess, staffRevealMinutesAccepted, staffStepAdmitted, staffStepRoles, step as stepStaffRoute, type StaffStep } from "../../../packages/core/src/generated/staffPermissions.ts";
import { staffRevealMayDisclose } from "../../../packages/core/src/generated/consoleMemberView.ts";
import { monthlyGatheringConsoleAllowed } from "../../../packages/core/src/generated/monthlyGathering.ts";
import { identityServed, startNeedsDurableAudit, startRefused, tokensAccepted, type PlatformEnv } from "../../../packages/core/src/generated/staffSignIn.ts";
import { readCappedText } from "../../../packages/platform/src/body.ts";
import { maskPii } from "../../../packages/core/src/pii.ts";
import { Lab, LAB_LIMITS, LabQueueFullError, validateLab, type LabOptions } from "./lab.ts";
import { runDiff } from "./runDiff.ts";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { APP_IDS, appUrlEnv, consoleApps, DEFAULT_APP, isAppId, slaHours, toNetworkReason, type AppId } from "./apps.ts";
import { appProfile, memberFacets, photosAllowed } from "./appProfile.ts";
import { countsMember, countsOpp, shapeDelta, shapeState, viewClass, type ViewClass } from "./shape.ts";
import { appHealth } from "./health.ts";
import { PeopleView, peopleUrl } from "./people.ts";
import { CostView } from "./ops.ts";
import { gatheringId, type GatheringRequest } from "./gatherings.ts";
import { staffStepRoutes } from "./staffSteps.ts";
import {
  AccessVerifier, allowed, appsFor, authenticateStaff, canCrossApp, createAudit, globalRolesFor, hasEverywhere, parseRoles, parseTokenGrants, PgStaffRoles, rolesFor, ssoGrants, staffUser,
  type AccessConfig, type AuditSink,
} from "./staff.ts";
import type { GameOptions } from "./sources/game.ts";
import { HIDDEN_MESSAGE, RealSource, type RealOptions } from "./sources/real.ts";
import { isTimeout, PreviewUnavailableError, SERVICE_TIMEOUT, serviceFromEnv, ServiceUnreachableError } from "./sources/service.ts";
import { historyQuery, type DataSource } from "./sources/source.ts";
import type { AppHealth, AuditEntry, ControlCommand, ControlResult, EnvInfo, Mode, ObsDelta, ObsMember, RevealGrant, SafetyAction, StaffRole, StaffUser } from "./types.ts";

export interface ServerOptions {
  port?: number;
  hostname?: string;
  token?: string;
  tokens?: string;
  trustCfAccess?: boolean;
  roles?: string;
  staffRolesUrl?: string | false;
  cfAccess?: Partial<AccessConfig>;
  platformEnv?: string;
  realOnly?: boolean;
  audit?: { url?: string; dir?: string } | AuditSink;
  lab?: LabOptions;
  allowedOrigins?: string[];
  mode?: Mode;
  game?: GameOptions;
  real?: RealOptions & { appUrls?: Partial<Record<AppId, string>> };
  peopleUrl?: string | false;
  development?: boolean;
  minTokenLength?: number;
  socketCheckMs?: number;
  staffRolesEveryMs?: number;
}

export interface ObservatoryServer {
  server: Server<WsData>; url: string;
  token?: string; openUrl: string;
  mode(): Mode;
  source(mode?: Mode, app?: AppId): Promise<DataSource>;
  setMode(mode: Mode): Promise<void>;
  audit: AuditSink;
  lab: Lab;
  stop(): Promise<void>;
}

const TOPIC = "obs";
const appTopic = (app: AppId) => `obs:${app}`;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ANY_INTERFACE = new Set(["0.0.0.0", "::", "[::]"]);
export const REVEAL_MAX_MINUTES = 15;
export const READ_AUDIT_DEDUPE_MS = 60_000;
const DEDUPED_READS = new Set(["read_member", "read_timeline"]);
export const PERSON_REASON_MIN = 5;
export const REVIEW_SECONDS_MAX = 1800;
export const WS_TICKET_MS = 30_000;
const PHOTO_PREVIEW_MS = 5 * 60_000;
const PHOTO_ITEM = /^pri_[a-f0-9]{32}$/;
export const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
export const WS_EXPIRED = 4401, WS_FORBIDDEN = 4403;
/** Transport-level cap for all Observatory HTTP bodies (256 KiB) and per-route JSON cap (64 KiB). */
export const MAX_API_BODY_BYTES = 256 * 1024;
export const MAX_JSON_BODY_BYTES = 64 * 1024;
/** Largest signed 32-bit setTimeout delay in Node.js (~24.8 days). */
const MAX_TIMEOUT_MS = 2_147_483_647;
/** Redact credentials, tokens, URLs, phones and other PII before writing an error to stderr. */
export function redactLogError(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const stripped = raw
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi, "$1[redacted]@")
    .replace(/\b(Bearer\s+)\S+/gi, "$1[redacted]")
    .replace(/([?&](?:token|ticket|key|secret|password|auth)=)[^&\s]+/gi, "$1[redacted]");
  return maskPii(stripped);
}
/** The client says which mode it acts in; a command for a mode that is no longer on is refused (audit observatory-21). */
export const MODE_HEADER = "x-observatory-mode";

interface WsData { app: AppId; user: StaffUser; cls: ViewClass; truth: boolean }

const SIM: readonly StaffRole[] = ["reviewer", "safety", "engineer"];
export const CONTROL_ROLES: Readonly<Record<ControlCommand["type"], readonly StaffRole[]>> = {
  play: SIM, pause: SIM, speed: SIM, step: SIM, propose: SIM, takeover: SIM, reply: SIM, say: SIM, god: SIM, peek: SIM, lens: ["safety"], check_scenario: SIM,
  review: ["reviewer"], matching: [], reset: [],
  refresh: ["reviewer", "safety", "analyst"], shadow_run: ["analyst"],
};
const LAB_ROLES: readonly StaffRole[] = ["analyst", "engineer"];
const QUIET = new Set(["play", "pause", "speed", "step", "refresh"]);
const GAME_ONLY = new Set(["play", "pause", "speed", "step", "propose", "takeover", "reply", "say", "god", "peek", "lens", "check_scenario", "reset"]);

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const remoteDb = (url: string) => { try { return !LOCAL_DB_HOSTS.has(new URL(url).hostname.toLowerCase()); } catch { return true; } };

const PLATFORM_ENVS: Readonly<Record<string, PlatformEnv>> = { dev: "EnvDev", staging: "EnvStaging", production: "EnvProduction" };

function platformEnvOf(raw: string | undefined): PlatformEnv {
  const value = raw?.trim();
  if (!value) return "EnvUnset";
  return Object.hasOwn(PLATFORM_ENVS, value) ? PLATFORM_ENVS[value]! : "EnvUnknown";
}

export function deployGuard(o: { realOnly: boolean; trustCfAccess: boolean; platformEnv?: string; databaseUrls: (string | undefined)[]; serviceUrl?: string; audit: AuditSink["kind"] }): string | undefined {
  const remote = o.databaseUrls.some(u => !!u && remoteDb(u)) || (!!o.serviceUrl && remoteDb(o.serviceUrl));
  const env = platformEnvOf(o.platformEnv);
  const named = o.platformEnv?.trim();
  const why = o.realOnly ? "OBSERVATORY_REAL_ONLY=1" : "a database or Network service that is not on this machine";
  if (!startRefused(o.realOnly, remote, env, o.trustCfAccess)) {
    if (startNeedsDurableAudit(o.realOnly, remote, env, o.audit === "postgres")) return `a deployed console (${why}, PLATFORM_ENV ${named}) needs OBSERVATORY_AUDIT_DATABASE_URL (a redeploy loses the file audit log)`;
    return undefined;
  }
  const access = "needs Cloudflare Access: OBSERVATORY_TRUST_CF_ACCESS=1 with OBSERVATORY_CF_ACCESS_TEAM and OBSERVATORY_CF_ACCESS_AUD";
  if (env === "EnvUnset") return `real data (${why}) needs PLATFORM_ENV (dev, staging or production)`;
  if (env === "EnvUnknown") return `unknown PLATFORM_ENV "${named}" (dev, staging or production)`;
  if (env !== "EnvDev") return `a deployed console (${why}, PLATFORM_ENV ${named}) ${access}`;
  return `PLATFORM_ENV=dev with a database or Network service that is not on this machine ${access} (tokens are for local databases only)`;
}

function hostnameOf(hostOrUrl: string): string | undefined {
  try { return new URL(hostOrUrl.includes("://") ? hostOrUrl : `http://${hostOrUrl}`).hostname.toLowerCase(); } catch { return undefined; }
}

export async function createServer(opts: ServerOptions = {}): Promise<ObservatoryServer> {
  const realOnly = opts.realOnly ?? process.env.OBSERVATORY_REAL_ONLY === "1";
  let mode: Mode = realOnly ? "real" : opts.mode ?? "game";
  let modeRevision = 0;
  const sla = slaHours();
  const sources = new Map<string, DataSource>();
  const starting = new Map<string, Promise<DataSource>>();
  const unsub = new Map<string, () => void>();
  let server!: Server<WsData>;
  const key = (m: Mode, app: AppId) => `${m}:${app}`;

  const sockets = new Set<ServerWebSocket<WsData>>();
  /** Per-socket SSO expiry timers, cleared on close and server stop. */
  const expiryTimers = new Map<ServerWebSocket<WsData>, ReturnType<typeof setTimeout>>();
  const clearExpiryTimer = (ws: ServerWebSocket<WsData>) => {
    const t = expiryTimers.get(ws);
    if (t) { clearTimeout(t); expiryTimers.delete(ws); }
  };
  const scheduleExpiry = (ws: ServerWebSocket<WsData>) => {
    clearExpiryTimer(ws);
    const exp = ws.data.user.expiresAt;
    if (exp === undefined) return;
    const delay = Math.min(Math.max(0, exp - Date.now()) + 50, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      expiryTimers.delete(ws);
      if (!sockets.has(ws)) return;
      if (recheck(ws) && ws.data.user.expiresAt !== undefined && ws.data.user.expiresAt > Date.now()) {
        scheduleExpiry(ws);
      }
    }, delay);
    timer.unref?.();
    expiryTimers.set(ws, timer);
  };
  /** Every active named member of each (mode, app) as the source last sent them: the analyst view takes their names out of feed lines. */
  const known = new Map<string, Map<string, ObsMember>>();
  const keepKnown = (x: ObsMember) => !x.declined && !!x.name;
  const syncKnown = (k: string, members: readonly ObsMember[]) => {
    const next = new Map<string, ObsMember>();
    for (const x of members) if (keepKnown(x)) next.set(x.id, x);
    known.set(k, next);
    return next;
  };
  const broadcast = (m: Mode, app: AppId, d: ObsDelta) => {
    const k = key(m, app);
    let names = known.get(k);
    if (d.reset) {
      const src = sources.get(k);
      names = src ? syncKnown(k, src.state().members) : syncKnown(k, d.members ?? []);
    } else {
      if (!names) { names = new Map<string, ObsMember>(); known.set(k, names); }
      for (const x of d.members ?? []) {
        if (keepKnown(x)) names.set(x.id, x);
        else names.delete(x.id);
      }
    }
    if (m !== mode || !server) return;
    if (!d.reset && !d.members && !d.edges && !d.opportunities && !d.feed && !d.stats && !d.engineRuns && !d.env && !d.removedOpportunities && !d.game && !d.requests && !d.network) {
      server.publish(appTopic(app), JSON.stringify({ type: "clock", app, clock: d.clock, version: d.version }));
      return;
    }
    const made = new Map<string, string>();
    for (const ws of sockets) {
      const w = ws.data;
      if (w.app !== app) continue;
      const viewKey = `${w.cls}|${w.truth}`;
      let msg = made.get(viewKey);
      if (!msg) { msg = JSON.stringify({ type: "delta", mode: m, app, delta: withAuth(shapeDelta(d, w.cls, w.truth, () => names.values())) }); made.set(viewKey, msg); }
      ws.send(msg);
    }
  };

  async function source(m: Mode = mode, app: AppId = DEFAULT_APP): Promise<DataSource> {
    if (m === "game" && realOnly) throw new Error("game mode is off on this server (OBSERVATORY_REAL_ONLY=1)");
    const k = key(m, app);
    const have = sources.get(k);
    if (have) return have;
    const pending = starting.get(k);
    if (pending) return pending;
    const start = (async () => {
      const s: DataSource = m === "game"
        ? new (await import("./sources/game.ts")).GameSource({ ...opts.game, app })
        : new RealSource({ ...opts.real, app, ...(opts.real?.appUrls?.[app] ? { appUrl: opts.real.appUrls[app] } : {}) });
      await s.init();
      syncKnown(k, s.state().members);
      sources.set(k, s);
      unsub.set(k, s.subscribe(d => broadcast(m, app, d)));
      return s;
    })();
    starting.set(k, start);
    // A start that failed is not kept: the next call tries again.
    start.catch(() => { if (starting.get(k) === start) starting.delete(k); });
    return start;
  }

  async function setMode(m: Mode) {
    if (m !== "game" && m !== "real") throw new Error(`unknown mode ${m}`);
    if (m === "game" && realOnly) throw new Error("game mode is off on this server (OBSERVATORY_REAL_ONLY=1)");
    if (mode === m && sources.has(key(m, DEFAULT_APP))) return;
    await source(m, DEFAULT_APP);
    if (m === "real") for (const app of APP_IDS) await sources.get(key("game", app))?.control({ type: "pause" });
    mode = m;
    modeRevision++;
    for (const ws of sockets) recheck(ws);
    server?.publish(TOPIC, JSON.stringify({ type: "mode", mode: m }));
  }

  const json = (data: unknown, status = 200, extra?: Record<string, string>) => Response.json(data, { status, headers: { ...SECURITY_HEADERS, ...extra } });
  /** Read a JSON request body with a hard byte cap; oversized bodies return 413 with security headers. */
  async function readJsonBody<T>(req: Request, fallback: T, max = MAX_JSON_BODY_BYTES): Promise<{ body: T } | Response> {
    const raw = await readCappedText(req, max);
    if (raw === "too_large") return json({ ok: false, error: "request body too large", code: "body_too_large" }, 413);
    if (!raw.trim()) return { body: fallback };
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (fallback !== null && typeof fallback === "object" && (parsed === null || typeof parsed !== "object")) return { body: fallback };
      return { body: parsed as T };
    } catch { return { body: fallback }; }
  }
  /** A failure inside a route: logged with a reference, never sent to the browser as is (audit observatory-13). */
  const fail = (e: unknown) => {
    const ref = randomBytes(4).toString("hex");
    console.error(`Observatory: request failed (ref ${ref}): ${redactLogError(e)}`);
    return json({ error: `internal error (ref ${ref})`, code: "internal" }, 500);
  };

  const hostname = opts.hostname ?? process.env.OBSERVATORY_HOST ?? "127.0.0.1";
  const tokens = parseTokenGrants(opts.tokens ?? process.env.OBSERVATORY_TOKENS, { explicitApp: process.env.NODE_ENV === "production" || process.env.PLATFORM_ENV === "production", minLength: opts.minTokenLength ?? 32 });
  const trustCfAccess = opts.trustCfAccess ?? process.env.OBSERVATORY_TRUST_CF_ACCESS === "1";
  const auditKind: AuditSink["kind"] = opts.audit && "write" in opts.audit ? opts.audit.kind : (opts.audit?.url ?? process.env.OBSERVATORY_AUDIT_DATABASE_URL) ? "postgres" : "file";
  const refusal = deployGuard({
    realOnly, trustCfAccess, audit: auditKind, platformEnv: opts.platformEnv ?? process.env.PLATFORM_ENV,
    databaseUrls: [opts.real?.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL,
      ...APP_IDS.map(a => opts.real?.appUrls?.[a] ?? process.env[appUrlEnv(a)]), process.env.OBSERVATORY_PLATFORM_DATABASE_URL,
      typeof opts.peopleUrl === "string" ? opts.peopleUrl : undefined, typeof opts.staffRolesUrl === "string" ? opts.staffRolesUrl : undefined],
    serviceUrl: (opts.real?.service === false ? undefined : opts.real?.service ?? serviceFromEnv())?.url,
  });
  if (refusal) throw new Error(`refusing to start: ${refusal}`);
  if (!tokensAccepted(trustCfAccess) && (tokens.size || opts.token || process.env.OBSERVATORY_TOKEN)) console.warn("Observatory: single sign-on is on, so OBSERVATORY_TOKENS and OBSERVATORY_TOKEN are refused (each person signs in as themselves)");
  const roles = parseRoles(opts.roles ?? process.env.OBSERVATORY_ROLES);
  const adminToken = opts.token ?? process.env.OBSERVATORY_TOKEN ?? (tokens.size || !tokensAccepted(trustCfAccess) ? undefined : randomBytes(24).toString("base64url"));
  if (adminToken && adminToken.length < (opts.minTokenLength ?? 32)) throw new Error(`OBSERVATORY_TOKEN is shorter than ${opts.minTokenLength ?? 32} characters`);
  if (adminToken) { const list = tokens.get(adminToken) ?? []; if (!list.some(g => g.role === "admin" && g.app === "*")) list.push({ role: "admin", app: "*" }); tokens.set(adminToken, list); }
  const access = trustCfAccess ? new AccessVerifier({
    ...opts.cfAccess, team: opts.cfAccess?.team ?? process.env.OBSERVATORY_CF_ACCESS_TEAM ?? "", aud: opts.cfAccess?.aud ?? process.env.OBSERVATORY_CF_ACCESS_AUD ?? "",
  }) : undefined;
  const development = opts.development ?? process.env.NODE_ENV !== "production";
  const webRoutes = await buildWebRoutes(development);
  const rolesUrl = opts.staffRolesUrl === false ? undefined : opts.staffRolesUrl ?? (trustCfAccess && (realOnly || mode === "real") ? opts.real?.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL : undefined);
  const rolesSql = rolesUrl ? new SQL({ url: rolesUrl, max: 1, idleTimeout: 30, connection: { default_transaction_read_only: "on", application_name: "network-observatory-roles" } }) : undefined;
  const stored = rolesSql ? new PgStaffRoles(rolesSql, opts.staffRolesEveryMs) : undefined;
  await stored?.start();
  const auth = { tokens, trustCfAccess, roles, access, stored };
  const audit: AuditSink = opts.audit && "write" in opts.audit ? opts.audit : createAudit(opts.audit as { url?: string; dir?: string } | undefined);
  const lab = new Lab({ ...opts.lab, disabled: realOnly });
  const pUrl = opts.peopleUrl === false ? undefined : opts.peopleUrl ?? opts.real?.url ?? peopleUrl();
  let people: PeopleView | undefined;
  const costs = new CostView();
  const reveals = new Map<string, RevealGrant>();
  const photoPreviews = new Map<string,{token:string;until:number}>();
  const revealKey = (u: StaffUser, app: AppId, memberId: string, readMode = mode) => `${u.id}|${readMode}|${app}|${memberId}`;
  const tickets = new Map<string, { user: StaffUser; app: AppId; until: number }>();
  const lensOn = new Set<string>();
  const truthFor = (u: StaffUser, app: AppId) => mode === "game" && lensOn.has(`${u.id}|${app}`) && allowed(u, CONTROL_ROLES.lens, app, mode);

  const allowedOrigins = new Set((opts.allowedOrigins ?? (process.env.OBSERVATORY_ALLOWED_ORIGINS ?? "").split(","))
    .map(o => o.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean));
  const allowedHosts = new Set([...LOOPBACK, ...[...allowedOrigins].map(hostnameOf).filter((h): h is string => !!h)]);
  if (!ANY_INTERFACE.has(hostname)) allowedHosts.add(hostname.toLowerCase());

  function siteCheck(req: Request): Response | undefined {
    const host = req.headers.get("host") ?? "";
    const name = hostnameOf(host);
    if (!name || !allowedHosts.has(name)) return json({ error: "host not allowed" }, 403);
    const origin = req.headers.get("origin");
    if (origin !== null) {
      const o = origin.replace(/\/+$/, "").toLowerCase();
      const own = `${new URL(req.url).protocol}//${host}`.toLowerCase();
      if (o !== own && !allowedOrigins.has(o)) return json({ error: "origin not allowed" }, 403);
    }
    return undefined;
  }
  async function identify(req: Request, identityCheck = false): Promise<StaffUser | Response> {
    const site = siteCheck(req);
    if (site) return site;
    const a = await authenticateStaff(req, auth);
    if (!("user" in a)) return json({ error: a.error }, a.status, a.status === 401 ? { "www-authenticate": "Bearer" } : undefined);
    if (a.user.expiresAt !== undefined && a.user.expiresAt <= Date.now()) return json({ error: "sign-in expired" }, 401);
    if (!identityCheck && !identityServed(a.user.via === "sso", a.user.secondFactor === true)) {
      return json({ error: "sign in again through Cloudflare Access with a second factor", code: "second_factor_required" }, 403);
    }
    return a.user;
  }
  function recheck(ws: ServerWebSocket<WsData>): boolean {
    const w = ws.data;
    if (w.user.expiresAt !== undefined && w.user.expiresAt <= Date.now()) { clearExpiryTimer(ws); ws.close(WS_EXPIRED, "sign-in expired"); sockets.delete(ws); return false; }
    if (w.user.via === "sso") w.user = { ...staffUser(w.user.id, ssoGrants(w.user.id, auth), "sso"), ...(w.user.expiresAt !== undefined ? { expiresAt: w.user.expiresAt } : {}), secondFactor: w.user.secondFactor === true };
    const roles = rolesFor(w.user, w.app, mode);
    if (!roles.size) { clearExpiryTimer(ws); ws.close(WS_FORBIDDEN, `no role for ${w.app}`); sockets.delete(ws); return false; }
    w.cls = viewClass(roles);
    w.truth = truthFor(w.user, w.app);
    return true;
  }
  function appOf(req: Request): AppId | Response {
    const v = new URL(req.url).searchParams.get("app");
    if (v === null || v === "") return DEFAULT_APP;
    return isAppId(v) ? v : json({ error: `unknown app "${v}" (one of ${APP_IDS.join(", ")})`, code: "unknown_app" }, 400);
  }
  const forbidden = (text: string) => json({ error: `forbidden: ${text}`, code: "forbidden" }, 403);
  const modeChanged = () => json({ ok: false, error: `the console switched to ${mode} mode: reload before you act`, code: "mode_changed" }, 409);
  type Req = Request & { params: Record<string, string> };
  type Handler = (req: Req, user: StaffUser, app: AppId, seen: Mode) => Response | Promise<Response>;
  const admitRoute = (req: Request, roles: StaffRole[], need: readonly StaffRole[] | undefined, appRoute: boolean, seen: Mode = mode) => {
    const said = req.headers.get(MODE_HEADER);
    const decision = stepStaffRoute(initialRoute, {
      type: "authorizeRoute", roles, requiredRoles: [...(need ?? [])],
      routeFacts: { appRoute, roleRestricted: need !== undefined, mutating: req.method !== "GET", hasModeHeader: !!said, matchesMode: said === seen },
    });
    return stepStaffRoute(decision, { type: "enterHandler" });
  };
  const guard = (h: Handler, need?: readonly StaffRole[]) => async (req: Req) => {
    const u = await identify(req);
    if (u instanceof Response) return u;
    const app = appOf(req);
    if (app instanceof Response) return app;
    const seen = mode;
    const route = admitRoute(req, [...rolesFor(u, app, seen)], need, true, seen);
    if (route.phase === "RouteRunning") {
      try { return await h(req, u, app, seen); } catch (e) { return fail(e); }
    }
    if (route.decision === "NeedsRole") return forbidden(`needs ${["admin", ...(need ?? [])].join(" or ")} for ${app}`);
    if (route.decision === "ModeChanged") return modeChanged();
    return forbidden(`no role for ${app}${seen === "real" && u.roles.includes("engineer") ? " (engineer: simulated worlds only)" : ""}`);
  };
  const global = (h: (req: Req, user: StaffUser) => Response | Promise<Response>, need?: readonly StaffRole[], identityCheck = false) => async (req: Req) => {
    const u = await identify(req, identityCheck);
    if (u instanceof Response) return u;
    if (admitRoute(req, globalRolesFor(u), need, false).phase !== "RouteRunning") return forbidden(`needs ${["admin", ...(need ?? [])].map(r => `${r}@*`).join(" or ")}`);
    try { return await h(req, u); } catch (e) { return fail(e); }
  };
  const withAuth = <T extends { env?: EnvInfo }>(x: T): T => (x.env ? { ...x, env: { ...x.env, authRequired: true, ...(realOnly ? { realOnly: true } : {}) } } : x);

  const lastRead = new Map<string, number>();
  async function record(u: StaffUser, app: AppId | undefined, e: Omit<AuditEntry, "at" | "actor" | "roles" | "mode" | "app">, m: Mode = mode): Promise<Response | undefined> {
    const at = Date.now();
    const k = DEDUPED_READS.has(e.action) && e.ok ? `${u.id}|${e.action}|${app}|${e.targetId}|${e.detail?.revealed ? 1 : 0}|${m}` : undefined;
    if (k && at - (lastRead.get(k) ?? -Infinity) < READ_AUDIT_DEDUPE_MS) return undefined;
    try {
      await audit.write({ at, actor: u.id, roles: u.roles, mode: m, ...(app ? { app } : {}), ...e });
      if (k) {
        lastRead.set(k, at);
        if (lastRead.size > 5000) for (const [x, t] of lastRead) if (at - t >= READ_AUDIT_DEDUPE_MS) lastRead.delete(x);
      }
      return undefined;
    } catch (err) {
      console.error(`Observatory: audit write failed: ${redactLogError(err)}`);
      return json({ error: "audit log unavailable: request refused" }, 503);
    }
  }
  async function heldStepRefusal(u: StaffUser, app: AppId, readMode: Mode, s: StaffStep, action: string): Promise<Response | undefined> {
    if (staffStepAdmitted(s, app, [...rolesFor(u, app, readMode)], globalRolesFor(u))) return undefined;
    const refused = await record(u, app, { action, ok: false, detail: { refused: "forbidden" } }, readMode);
    return refused ?? forbidden(`${s} needs ${["admin", ...staffStepRoles(s)].join(" or ")} for ${app}`);
  }
  const currentSafety = (u: StaffUser, app: AppId, readMode: Mode): boolean => {
    const staff = u.via === "sso" ? staffUser(u.id, ssoGrants(u.id, auth), "sso") : u;
    return allowed(staff, ["safety"], app, readMode);
  };
  const SAFETY_REPORT_EVENTS: ReadonlySet<string> = new Set(["report_received", "minor_reported"]);
  function revealCurrent(u: StaffUser, app: AppId, readMode: Mode, until: number): boolean {
    const now = Date.now();
    return staffRevealMayDisclose(readMode === mode, currentSafety(u, app, readMode), u.expiresAt === undefined || u.expiresAt > now, until - now);
  }
  function revealFor(u: StaffUser, app: AppId, memberId: string, readMode = mode): RevealGrant | undefined {
    const key = revealKey(u, app, memberId, readMode), grant = reveals.get(key);
    if (grant && readMode === mode && !revealCurrent(u, app, readMode, grant.until)) {
      reveals.delete(key);
      return;
    }
    return readMode === mode ? grant : undefined;
  }
  async function canSeeMember(u: StaffUser, app: AppId, id: string, readMode = mode): Promise<boolean> {
    const access = staffMemberAccess([...rolesFor(u, app, readMode)], readMode === "real");
    return access === "AnyMember" || (access === "OpenReviewMember" && (await source(readMode, app)).inOpenReview(id));
  }

  interface MemberRead {
    id: string;
    readMode: Mode;
    revision: number;
    grant?: RevealGrant;
  }
  async function startMemberRead(u: StaffUser, app: AppId, id: string, action: "read_member" | "read_timeline" | "read_member_app"): Promise<MemberRead | Response> {
    const readMode = mode, revision = modeRevision;
    if (!(await canSeeMember(u, app, id, readMode))) return forbidden("this role cannot open this member");
    if (revision !== modeRevision) return modeChanged();
    const grant = revealFor(u, app, id, readMode);
    const refused = await record(u, app, { action, targetType: "member", targetId: id, ok: true, ...(grant ? { detail: { revealed: true } } : {}) });
    const read = { id, readMode, revision, grant };
    return refused ?? memberReadRefusal(u, app, read) ?? read;
  }
  function memberReadRefusal(u: StaffUser, app: AppId, read: MemberRead): Response | undefined {
    if (read.revision !== modeRevision) return modeChanged();
    if (read.grant && revealFor(u, app, read.id, read.readMode) !== read.grant) return forbidden("the reveal is no longer active");
  }
  function peopleView(): PeopleView | Response {
    if (mode !== "real") return json({ error: "the cross-app view reads the platform schema: switch to real mode", code: "real_only" }, 409);
    if (!pUrl) return json({ error: "no platform database configured (OBSERVATORY_PLATFORM_DATABASE_URL)", code: "not_configured" }, 503);
    people ??= new PeopleView(pUrl);
    return people;
  }

  const gatheringRoute = (action: GatheringRequest["action"]) => guard(async (req, user, app) => {
    const realNetworkAdmin = monthlyGatheringConsoleAllowed(mode === "real", app === "ntwrk", allowed(user, ["admin"], app, mode), true);
    if (!realNetworkAdmin) return forbidden("monthly gatherings need a Network administrator in real mode");
    const revision = modeRevision;
    const network = await source("real", app);
    if (!(network instanceof RealSource) || !network.gatheringServiceAvailable) return json({ ok: false, error: "gatherings_unavailable" }, 503);

    const id = action === "review" ? req.params.id : undefined;
    if (action === "review" && (!id || !gatheringId.test(id))) return json({ ok: false, error: "invalid_request" }, 400);
    let request: GatheringRequest = { action: "list" };
    if (action !== "list") {
      try {
        const raw = await readCappedText(req, 2048);
        if (raw === "too_large") return json({ ok: false, error: "invalid_request" }, 413);
        const body: unknown = JSON.parse(raw);
        request = action === "review" && id ? { action, id, body } : { action: "draft", body };
      } catch { return json({ ok: false, error: "invalid_request" }, 400); }
    }
    const audit = { action: action === "list" ? "read_monthly_gatherings" : action === "draft" ? "create_monthly_gathering" : "review_monthly_gathering",
      ...(id ? { targetId: id } : {}) };
    const refusal = await record(user, app, { ...audit, ok: true, ...(action !== "list" ? { detail: { phase: "requested" } } : {}) });
    if (refusal) return refusal;
    if (revision !== modeRevision) return modeChanged();
    const answer = await network.monthlyGatherings(user.id, request);
    if (!answer) return json({ ok: false, error: "gatherings_unavailable" }, 503);
    if (action === "list" && revision !== modeRevision) return modeChanged();
    if (action !== "list") await record(user, app, { ...audit, ok: answer.body.ok, detail: { phase: "result" } });
    return json(answer.body, answer.status);
  }, ["admin"]);

  const reviewPreviewRoute = (kind: "plan" | "probes") => guard(async (req, u, app) => {
    const readRevision = modeRevision;
    if (mode !== "real") return json({ ok: false, error: "real_only" }, 404);
    let id: string;
    try { id = decodeURIComponent(req.params.id!); } catch { return json({ ok: false, error: "invalid_review" }, 400); }
    const seen = new URL(req.url).searchParams.get("revision");
    const revision = seen !== null && /^\d+$/.test(seen) ? Number(seen) : NaN;
    if (!id || id.length > 200 || !Number.isSafeInteger(revision)) return json({ ok: false, error: "invalid_review" }, 400);
    const no = await record(u, app, { action: kind === "plan" ? "read_review_plan" : "read_review_probes", targetType: "opportunity", targetId: id, ok: true, detail: { revision } });
    if (no) return no;
    const src = await source("real", app);
    if (readRevision !== modeRevision) return modeChanged();
    if (!(src instanceof RealSource)) return json({ ok: false, error: "preview_unavailable" }, 503);
    try {
      const pending = kind === "plan" ? src.reviewPlanPreview(u.id, id, revision) : src.reviewProbePreview(u.id, id, revision);
      if (!pending) return json({ ok: false, error: "preview_unavailable" }, 503);
      const preview = await pending;
      if (readRevision !== modeRevision) return modeChanged();
      return preview ? json({ ok: true, preview }) : json({ ok: false, error: "preview_unavailable" }, 404);
    } catch (e) {
      if (isTimeout(e) || e instanceof PreviewUnavailableError || e instanceof ServiceUnreachableError) return json({ ok: false, error: "preview_unavailable" }, 503);
      return fail(e);
    }
  }, ["reviewer", "safety"]);

  await source(mode, DEFAULT_APP);
  server = await serveHttp<WsData>({
    port: opts.port ?? 4747,
    hostname,
    development,
    maxRequestBodySize: MAX_API_BODY_BYTES,
    routes: {
      ...webRoutes,
      "/healthz": () => new Response(JSON.stringify({ ok: true }), { headers: { ...SECURITY_HEADERS, "content-type": "application/json" } }),
      "/api/health": global(() => json({ ok: true, mode })),
      "/api/me": global((_r, u) => json({ ...u, secondFactor: u.secondFactor === true, realOnly, apps: appsFor(u, mode), crossApp: canCrossApp(u), appInfo: consoleApps(sla) }), undefined, true),
      "/api/apps/health": global(async (_r, u) => {
        const out: AppHealth[] = [];
        for (const app of appsFor(u, mode)) {
          const s = mode === "game" ? sources.get(key("game", app)) : await source("real", app).catch(() => undefined);
          if (!s) { out.push({ app, available: false, error: "world not started: open this app to start it", members: 0, reviewBacklog: 0, slaMisses: 0, slaHours: sla[app], sendFailures: 0, matching: "off" }); continue; }
          out.push(appHealth(app, s.state(), sla[app]));
        }
        return json({ mode, apps: out });
      }),
      "/api/levels": global(async () => json(realOnly ? [] : (await import("@thenetwork/network/harness")).SCENARIOS.map(x => ({ id: x.id, title: x.title, description: x.description, days: x.days })))),
      "/api/mode": {
        GET: global(() => json({ mode, realOnly, realConfigured: !!(opts.real?.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL) })),
        POST: global(async (req, u) => {
          const parsed = await readJsonBody<{ mode?: Mode }>(req, {});
          if (parsed instanceof Response) return parsed;
          const body = parsed.body;
          if (body.mode === "game" && realOnly) return json({ ok: false, error: "game mode is off on this server (OBSERVATORY_REAL_ONLY=1)", code: "real_only" }, 403);
          if (body.mode !== "game" && body.mode !== "real") return json({ ok: false, error: `unknown mode ${body.mode}` }, 400);
          const no = await record(u, undefined, { action: "mode", targetType: "mode", targetId: body.mode, ok: true });
          if (no) return no;
          try { await setMode(body.mode); } catch (e) { return json({ ok: false, error: (e as Error).message }, 400); }
          return json({ ok: true, mode });
        }, []),
      },
      "/api/state": guard(async (_r, u, app) => {
        const truth = truthFor(u, app);
        return json(withAuth(shapeState((await source(mode, app)).state({ truth }), viewClass(rolesFor(u, app, mode)), truth)));
      }),
      "/api/ws-ticket": {
        POST: guard((_r, u, app) => {
          const now = Date.now();
          for (const [t, x] of tickets) if (x.until <= now) tickets.delete(t);
          const ticket = randomBytes(24).toString("base64url");
          tickets.set(ticket, { user: u, app, until: now + WS_TICKET_MS });
          return json({ ticket, expiresInMs: WS_TICKET_MS });
        }),
      },
      "/api/member/:id": guard(async (req, u, app) => {
        const historyBefore = historyQuery(req.url);
        if (historyBefore === null) return json({ error: "invalid history cursor" }, 400);
        const read = await startMemberRead(u, app, decodeURIComponent(req.params.id!), "read_member");
        if (read instanceof Response) return read;
        const { id, readMode, grant } = read;
        const d = await (await source(readMode, app)).member(id, { reveal: !!grant, truth: truthFor(u, app), historyBefore });
        if (!d) return json({ error: "not found" }, 404);
        d.facets = memberFacets(app, d.facets, !!grant);
        if (grant) d.revealed = { until: grant.until };
        if (currentSafety(u, app, readMode)) {
          const rows = await audit.list({ targetType: "member", targetId: id, limit: 50, actions: ["read_member", "read_timeline", "reveal"], apps: [app] }).catch(() => []);
          if (currentSafety(u, app, readMode)) d.staffAccess = rows.map(r => ({ actor: r.actor, at: r.at, action: r.action }));
        }
        return memberReadRefusal(u, app, read) ?? json(d);
      }),
      "/api/member/:id/timeline": guard(async (req, u, app) => {
        const historyBefore = historyQuery(req.url);
        if (historyBefore === null) return json({ error: "invalid history cursor" }, 400);
        const read = await startMemberRead(u, app, decodeURIComponent(req.params.id!), "read_timeline");
        if (read instanceof Response) return read;
        const { id, readMode, grant } = read;
        const full = await (await source(readMode, app)).timeline(id, { reveal: !!grant, historyBefore });
        if (!full) return json({ error: "not found" }, 404);
        const t = currentSafety(u, app, readMode) ? full : { ...full, entries: full.entries.filter(e => e.kind !== "event" || !SAFETY_REPORT_EVENTS.has(e.event.type)) };
        return memberReadRefusal(u, app, read) ?? json(grant ? { ...t, revealed: { until: grant.until } } : t);
      }),
      "/api/member/:id/app": guard(async (req, u, app) => {
        const read = await startMemberRead(u, app, decodeURIComponent(req.params.id!), "read_member_app");
        if (read instanceof Response) return read;
        const { id, readMode, grant } = read;
        const d = await (await source(readMode, app)).member(id, { reveal: true });
        if (!d) return json({ error: "not found" }, 404);
        return memberReadRefusal(u, app, read) ?? json(appProfile(app, d, { revealed: !!grant }));
      }),
      "/api/member/:id/photos": {
        POST: guard(async (req, u, app, seen) => {
          const revision = modeRevision;
          const id = decodeURIComponent(req.params.id!);
          const parsed = await readJsonBody<{ reason?: string }>(req, {});
          if (parsed instanceof Response) return parsed;
          const b = parsed.body;
          const reason = String(b.reason ?? "").trim();
          if (app !== "slop") return json({ ok: false, error: "photos exist only on slop", code: "no_photos" }, 404);
          if (reason.length < PERSON_REASON_MIN) return json({ ok: false, error: `a reason (at least ${PERSON_REASON_MIN} characters) is required`, code: "reason_required" }, 400);
          if (revision !== modeRevision) return modeChanged();
          const src = await source(seen, app);
          const d = await src.member(id, { reveal: true });
          if (!d) return json({ ok: false, error: "not found" }, 404);
          const why = photosAllowed(d);
          if (why !== "ok") {
            const no = await record(u, app, { action: "read_photos", targetType: "member", targetId: id, reason, ok: false, detail: { refused: why } });
            if (no) return no;
            return json({ ok: false, error: why === "never_minor" ? "photos are never shown for members under 18" : "photos need a verified age (18+)", code: why }, 403);
          }
          const no = await record(u, app, { action: "read_photos", targetType: "member", targetId: id, reason, ok: true });
          if (no) return no;
          if (revision !== modeRevision) return modeChanged();
          const r = src.photos ? await src.photos(id, u.id, reason) : { ok: true as const, photos: [] };
          return json(r, r.ok ? 200 : 409);
        }, ["safety"]),
      },
      "/api/opportunity/:id": guard(async (req, u, app) => {
        const historyBefore = historyQuery(req.url);
        if (historyBefore === null) return json({ error: "invalid history cursor" }, 400);
        const id = decodeURIComponent(req.params.id!);
        const no = await record(u, app, { action: "read_opportunity", targetType: "opportunity", targetId: id, ok: true });
        if (no) return no;
        const full = await (await source(mode, app)).opportunity(id, { truth: truthFor(u, app), historyBefore });
        if (!full) return json({ error: "not found" }, 404);
        const d = currentSafety(u, app, mode) ? full : { ...full, events: full.events.filter(e => !SAFETY_REPORT_EVENTS.has(e.type)) };
        // An analyst sees the opportunity's shape, never the people in it or the texts written to them.
        if (viewClass(rolesFor(u, app, mode)) === "counts") return json({
          ...d, opportunity: countsOpp(d.opportunity), members: d.members.map(countsMember), messages: [],
          events: d.events.map(e => ({ t: e.t, type: e.type, text: e.type })),
          historyBefore: d.historyBefore?.events ? { events: d.historyBefore.events } : undefined,
        });
        // What a member wrote only for staff who may open that member (4.1); others get its length.
        const may = new Map<string, boolean>();
        for (const m of d.messages) {
          if (m.direction !== "inbound" || m.system || m.body === HIDDEN_MESSAGE) continue;
          if (!may.has(m.memberId)) may.set(m.memberId, await canSeeMember(u, app, m.memberId));
          if (!may.get(m.memberId)) { m.hiddenLength = m.body.length; m.body = HIDDEN_MESSAGE; }
        }
        return json(d);
      }),
      "/api/review/:id/plan": { GET: reviewPreviewRoute("plan") },
      "/api/review/:id/probes": { GET: reviewPreviewRoute("probes") },
      "/api/reveal": {
        GET: guard((_r, u, app) => {
          const prefix = `${u.id}|${mode}|${app}|`;
          return json([...reveals.entries()].flatMap(([key, grant]) =>
            key.startsWith(prefix) && revealFor(u, app, grant.memberId) === grant ? [grant] : []));
        }),
        POST: guard(async (req, u, app) => {
          const readMode = mode, revision = modeRevision;
          const parsed = await readJsonBody<{ memberId?: string; reason?: string; minutes?: number }>(req, {});
          if (parsed instanceof Response) return parsed;
          const b = parsed.body;
          const memberId = String(b.memberId ?? ""), reason = String(b.reason ?? "").trim();
          if (!memberId || reason.length < 5) return json({ ok: false, error: "a member and a reason (at least 5 characters) are required" }, 400);
          const s = await source(readMode, app);
          if (revision !== modeRevision) return modeChanged();
          if (!s.state().members.some(m => m.id === memberId)) {
            const no = await record(u, app, { action: "reveal", targetType: "member", targetId: memberId, reason, ok: false, detail: { refused: "unknown_member" } });
            if (no) return no;
            return json({ ok: false, error: "unknown member" }, 404);
          }
          const minutes = b.minutes === undefined ? REVEAL_MAX_MINUTES : typeof b.minutes === "number" && Number.isInteger(b.minutes) ? b.minutes : 0;
          if (!staffRevealMinutesAccepted(minutes)) {
            const no = await record(u, app, { action: "reveal", targetType: "member", targetId: memberId, reason, ok: false, detail: { refused: "bad_minutes" } });
            if (no) return no;
            return json({ ok: false, error: "a reveal lasts 5, 10 or 15 minutes", code: "bad_minutes" }, 400);
          }
          const at = Date.now(), grant: RevealGrant = { memberId, reason, at, until: at + minutes * 60_000 };
          const no = await record(u, app, { action: "reveal", targetType: "member", targetId: memberId, reason, ok: true, detail: { minutes } });
          if (no) return no;
          if (revision !== modeRevision) return modeChanged();
          if (!revealCurrent(u, app, readMode, grant.until)) return forbidden("the reveal is no longer active");
          const now = Date.now();
          for (const [k, v] of reveals) if (v.until <= now) reveals.delete(k);
          reveals.set(revealKey(u, app, memberId, readMode), grant);
          return json({ ok: true, ...grant });
        }, ["safety"]),
        DELETE: guard(async (req, u, app) => {
          const memberId = new URL(req.url).searchParams.get("memberId") ?? "";
          if (!memberId) return json({ ok: false, error: "memberId is required" }, 400);
          const had = reveals.delete(revealKey(u, app, memberId));
          const no = await record(u, app, { action: "reveal_revoke", targetType: "member", targetId: memberId, ok: had });
          if (no) return no;
          return json({ ok: had }, had ? 200 : 404);
        }, ["safety"]),
      },
      "/api/control": {
        POST: guard(async (req, u, app, seen) => {
          const revision = modeRevision;
          const parsed = await readJsonBody<ControlCommand | null>(req, null);
          if (parsed instanceof Response) return parsed;
          let cmd = parsed.body;
          if (!cmd || typeof cmd.type !== "string") return json({ ok: false, error: "bad command" }, 400);
          const need = Object.hasOwn(CONTROL_ROLES, cmd.type) ? CONTROL_ROLES[cmd.type] : undefined;
          if (!need) return json({ ok: false, error: "unknown command" }, 400);
          const target = "oppId" in cmd ? { targetType: "opportunity" as const, targetId: cmd.oppId } : "memberId" in cmd ? { targetType: "member" as const, targetId: cmd.memberId } : cmd.type === "matching" ? { targetType: "config" as const, targetId: cmd.type } : {};
          const detail = auditDetail(cmd);
          if (!allowed(u, need, app, seen)) {
            await record(u, app, { action: cmd.type, ...target, ok: false, detail: { ...detail, refused: "forbidden" } }, seen);
            return forbidden(`${cmd.type} needs ${["admin", ...need].join(" or ")} for ${app}`);
          }
          if (realOnly && GAME_ONLY.has(cmd.type)) return json({ ok: false, error: `${cmd.type} is off on this server (OBSERVATORY_REAL_ONLY=1)`, code: "real_only" }, 403);
          if (cmd.type === "review" && cmd.reason) {
            const r = toNetworkReason(app, cmd.reason, cmd.note);
            if (!r) return json({ ok: false, error: `unknown reason ${cmd.reason} for ${app}`, code: "unknown_reason" }, 400);
            cmd = { ...cmd, reason: r.reason, note: r.note };
          }
          if (cmd.type === "review" && cmd.secondsSpent !== undefined) cmd = { ...cmd, secondsSpent: Math.min(REVIEW_SECONDS_MAX, Math.max(0, Number(cmd.secondsSpent) || 0)) };
          if (!QUIET.has(cmd.type)) { const no = await record(u, app, { action: cmd.type, ...target, ok: true, detail: { ...detail, phase: "requested" } }, seen); if (no) return no; }
          if (revision !== modeRevision) {
            if (!QUIET.has(cmd.type)) await record(u, app, { action: cmd.type, ...target, ok: false, detail: { ...detail, phase: "result", code: "mode_changed" } }, seen);
            return modeChanged();
          }
          const r = await (await source(seen, app)).control(cmd, u.id);
          if (r.ok && cmd.type === "lens") { if (cmd.on) lensOn.add(`${u.id}|${app}`); else lensOn.delete(`${u.id}|${app}`); }
          if (r.ok && cmd.type === "reset") for (const k of [...lensOn]) if (k.endsWith(`|${app}`)) lensOn.delete(k);
          if (r.ok && (cmd.type === "lens" || cmd.type === "reset")) for (const ws of sockets) if (ws.data.app === app) ws.data.truth = truthFor(ws.data.user, app);
          if (!QUIET.has(cmd.type)) { const row = resultRow(r); await record(u, app, { action: cmd.type, ...target, ok: row.ok, detail: { ...detail, ...row.detail } }, seen); }
          return json(r, statusOf(r));
        }),
      },
      "/api/safety": {
        GET: guard(async (_r, u, app) => {
          const readMode = mode, revision = modeRevision;
          const no = await record(u, app, { action: "read_safety", ok: true });
          if (no) return no;
          if (revision !== modeRevision) return modeChanged();
          const safety = await (await source(readMode, app)).safety();
          return revision === modeRevision ? json(safety) : modeChanged();
        }, ["safety"]),
        POST: guard(async (req, u, app, seen) => {
          const revision = modeRevision;
          const parsed = await readJsonBody<SafetyAction | null>(req, null);
          if (parsed instanceof Response) return parsed;
          const a = parsed.body;
          const v = checkSafety(a);
          if (typeof v === "string") return json({ ok: false, error: v, code: "bad_action" }, 400);
          const target = v.action === "close" ? { targetType: "case" as const, targetId: v.caseId } : v.action === "dismiss" ? { targetType: "report" as const, targetId: v.reportId } : { targetType: "member" as const, targetId: v.memberId };
          const extra = v.action === "ban" ? { by: v.by } : {};
          const report = "reportId" in v && v.reportId ? { reportId: v.reportId } : {};
          const no = await record(u, app, { action: `safety_${v.action}`, ...target, ok: true, ...(v.note ? { reason: v.note } : {}), detail: { phase: "requested", ...extra, ...report } }, seen);
          if (no) return no;
          if (revision !== modeRevision) {
            await record(u, app, { action: `safety_${v.action}`, ...target, ok: false, detail: { phase: "result", ...extra, ...report, code: "mode_changed" } }, seen);
            return modeChanged();
          }
          const r = await (await source(seen, app)).safetyAction(v, u.id);
          const row = resultRow(r);
          await record(u, app, { action: `safety_${v.action}`, ...target, ok: row.ok, detail: { ...extra, ...report, ...row.detail } }, seen);
          return json(r, statusOf(r));
        }, ["safety"]),
      },
      // Held texts: the leak guard's parked texts and held relay items (real mode, from the Network service).
      // Safety or admin; each read and each decision is audited; a decision needs a reason of 5+ characters.
      "/api/held/:id/photo": {
        GET: guard(async (req, u, app, seen) => {
          const revision = modeRevision;
          const refused = await heldStepRefusal(u, app, seen, "ReadHeldRelay", "read_relay_photo");
          if (refused) return refused;
          const id = decodeURIComponent(req.params.id!), reason = req.headers.get("x-network-reason")?.trim() ?? "";
          if (!PHOTO_ITEM.test(id) || reason.length < PERSON_REASON_MIN || reason.length > 500) return json({ error: "A selected item and review reason are required." }, 400);
          const src = await source(seen, app);
          if (!src.heldPhoto) return json({ error: "Selected photo review is unavailable." }, 404);
          const no = await record(u, app, { action: "read_relay_photo", targetType: "case", targetId: id, reason, ok: true }, seen);
          if (no) return no;
          if (revision !== modeRevision) return modeChanged();
          const key = revealKey(u, app, `relay-photo:${id}`, seen);
          photoPreviews.delete(key);
          const response = await src.heldPhoto(id, u.id, reason), token = response.headers.get("x-network-photo-review-token"), until = Number(token?.split(".")[0]);
          if (!response.ok) {
            const headers = new Headers(response.headers);
            headers.delete("x-network-photo-review-token");
            for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
          }
          const now = Date.now();
          if (!token || !Number.isSafeInteger(until) || until <= now) { await response.body?.cancel(); return json({ error: "This photo preview expired. Load it again." }, 409); }
          if (revision !== modeRevision) { await response.body?.cancel(); return modeChanged(); }
          for (const [k, v] of photoPreviews) if (v.until <= now) photoPreviews.delete(k);
          if (photoPreviews.size >= 1000) { await response.body?.cancel(); return json({ error: "Too many active previews. Retry shortly." }, 429); }
          // The service sets until on its own clock: the console keeps the preview at most 5 minutes on its clock.
          photoPreviews.set(key, { token, until: Math.min(until, now + PHOTO_PREVIEW_MS) });
          const headers = new Headers(response.headers);
          headers.delete("x-network-photo-review-token");
          for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
          return new Response(response.body, { status: 200, headers });
        }),
      },
      "/api/held": {
        GET: guard(async (req, u, app, seen) => {
          const queue = new URL(req.url).searchParams.get("queue");
          const revision = modeRevision;
          const refused = await heldStepRefusal(u, app, seen, "ReadHeldRelay", "read_held_texts");
          if (refused) return refused;
          if (queue !== "leak" && queue !== "relay") return json({ ok: false, error: "queue must be leak or relay", code: "bad_queue" }, 400);
          const src = await source(seen, app);
          if (!src.held) return json({ ok: false, error: "held texts exist on real data only", code: "real_only" }, 404);
          const no = await record(u, app, { action: "read_held_texts", ok: true, detail: { queue } });
          if (no) return no;
          if (revision !== modeRevision) return modeChanged();
          const r = await src.held(queue, u.id);
          if (revision !== modeRevision) return modeChanged();
          return json(r, r.ok ? 200 : r.code === "not_available" ? 404 : 502);
        }),
        POST: guard(async (req, u, app, seen) => {
          const revision = modeRevision;
          const parsed = await readJsonBody<{ queue?: unknown; id?: unknown; decision?: unknown; reason?: unknown; photoReviewed?: unknown } | null>(req, null);
          if (parsed instanceof Response) return parsed;
          const b = parsed.body;
          const refused = await heldStepRefusal(u, app, seen, "DecideHeldRelay", b?.decision === "release" || b?.decision === "reject" ? `held_${b.decision}` : "held_decision");
          if (refused) return refused;
          const reason = typeof b?.reason === "string" ? b.reason.trim().slice(0, 500) : "";
          if (!b || (b.queue !== "leak" && b.queue !== "relay") || typeof b.id !== "string" || !b.id || b.id.length > 300 || (b.decision !== "release" && b.decision !== "reject")
            || (b.queue === "relay" && !PHOTO_ITEM.test(b.id))) {
            return json({ ok: false, error: "queue (leak or relay), id (a held photo for relay) and decision (release or reject) are required", code: "bad_action" }, 400);
          }
          if (reason.length < PERSON_REASON_MIN) return json({ ok: false, error: `a reason (at least ${PERSON_REASON_MIN} characters) is required`, code: "reason_required" }, 400);
          const src = await source(seen, app);
          if (!src.heldDecision) return json({ ok: false, error: "held texts exist on real data only", code: "real_only" }, 404);
          const photo = b.queue === "relay";
          const preview = photo ? photoPreviews.get(revealKey(u, app, `relay-photo:${b.id}`, seen)) : undefined;
          if (photo && b.decision === "release" && (b.photoReviewed !== true || !preview || preview.until <= Date.now())) {
            return json({ ok: false, error: "Load and review this selected photo before releasing it.", code: "photo_preview_required" }, 409);
          }
          const target = { targetType: "case" as const, targetId: `${b.queue}:${b.id}` };
          const no = await record(u, app, { action: `held_${b.decision}`, ...target, ok: true, reason, detail: { phase: "requested", queue: b.queue } }, seen);
          if (no) return no;
          if (revision !== modeRevision) {
            await record(u, app, { action: `held_${b.decision}`, ...target, ok: false, detail: { phase: "result", queue: b.queue, code: "mode_changed" } }, seen);
            return modeChanged();
          }
          const r = await src.heldDecision(b.queue, b.id, b.decision, reason, u.id, photo && b.decision === "release" ? preview!.token : undefined);
          if (photo && r.ok) photoPreviews.delete(revealKey(u, app, `relay-photo:${b.id}`, seen));
          const row = resultRow(r);
          await record(u, app, { action: `held_${b.decision}`, ...target, ok: row.ok, detail: { queue: b.queue, ...row.detail } }, seen);
          return json(r, r.code === "service_missing" ? 404 : statusOf(r));
        }),
      },
      "/api/bias": guard(async (_r, u, app) => {
        const src = await source(mode, app);
        if (!src.bias) return json({ ok: false, error: "the bias monitor runs on real data only (pnpm run sim measures it in simulation)", code: "real_only" }, 404);
        const no = await record(u, app, { action: "read_bias", ok: true });
        if (no) return no;
        const r = await src.bias(u.id);
        return json(r, r.ok ? 200 : 502);
      }, ["analyst"]),
      "/api/ops/cost": guard(async (req, u, app) => {
        if (mode !== "real") return json({ ok: false, error: "costs are recorded on real data only", code: "real_only" }, 404);
        const days = Number(new URL(req.url).searchParams.get("days")) || 14;
        const r = await costs.summary(app, Date.now(), { days, everyApp: hasEverywhere(u, "admin") || hasEverywhere(u, "analyst") });
        return r ? json({ ok: true, ...r }) : json({ ok: false, error: "no database configured", code: "not_configured" }, 503);
      }, ["analyst"]),
      "/api/config": guard(async (_r, _u, app) => json(await (await source(mode, app)).config()), ["analyst"]),
      "/api/gatherings": { GET: gatheringRoute("list"), POST: gatheringRoute("draft") },
      "/api/gatherings/:id/review": { POST: gatheringRoute("review") },
      "/api/audit": guard(async (req, u, app) => {
        const q = new URL(req.url).searchParams;
        const no = await record(u, app, { action: "read_audit", ok: true });
        if (no) return no;
        const every = hasEverywhere(u, "admin") && !q.get("app");
        const rows = await audit.list({ limit: Math.min(1000, Number(q.get("limit")) || 200), actor: q.get("actor") ?? undefined, targetType: q.get("targetType") ?? undefined, targetId: q.get("targetId") ?? undefined, ...(every ? {} : { apps: [app] }) });
        return json({ sink: audit.kind, entries: rows });
      }, []),
      "/api/search": guard(async (req, u, app) => {
        const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
        if (q.length < 2 || q.length > 200) return json({ error: "q must be 2-200 characters" }, 400);
        const no = await record(u, app, { action: "search", targetType: "search", ok: true, detail: { qLength: q.length } });
        if (no) return no;
        return json(await (await source(mode, app)).search(q));
      }, ["safety"]),
      "/api/runs/diff": guard(async (req, _u, app) => {
        const q = new URL(req.url).searchParams;
        const runs = (await source(mode, app)).state().engineRuns;
        const a = runs.find(r => r.id === q.get("a")), b = runs.find(r => r.id === q.get("b"));
        if (!a || !b) return json({ error: "unknown run id (a and b must be engine run ids from the state)" }, 404);
        return json(runDiff(a, b));
      }),
      "/api/lab": guard(async (_r, _u, app) => json({ enabled: !realOnly, running: lab.running, runs: await lab.list(app) }), LAB_ROLES),
      "/api/lab/run": {
        POST: guard(async (req, u, app) => {
          if (realOnly) return json({ ok: false, error: "the simulation lab is off on this server (OBSERVATORY_REAL_ONLY=1)", code: "real_only" }, 403);
          const parsed = await readJsonBody<{ app?: string } | null>(req, null);
          if (parsed instanceof Response) return parsed;
          const body = parsed.body;
          if (body?.app !== undefined && body.app !== app) return json({ ok: false, error: `the run's app (${body.app}) is not the request's app (${app})`, code: "app_mismatch" }, 400);
          const v = validateLab({ ...body, app });
          if (typeof v === "string") return json({ ok: false, error: v }, 400);
          const queueFull = () => json({ ok: false, error: `the lab queue is full (${LAB_LIMITS.maxQueued} seeds wait at most): try again when runs finish`, code: "queue_full" }, 429);
          if (!lab.canQueue(v.seeds.length)) return queueFull();
          const no = await record(u, app, { action: "lab_run", targetType: "run", ok: true, detail: { arms: v.arms, seeds: v.seeds, days: v.days, app: v.app } });
          if (no) return no;
          try {
            const run = await lab.start(v, u.id);
            return json({ ok: true, run });
          } catch (error) {
            if (error instanceof LabQueueFullError) return queueFull();
            throw error;
          }
        }, LAB_ROLES),
      },
      "/api/person/lookup": global(async (req, u) => {
        if (!canCrossApp(u)) return forbidden("the cross-app view needs cross_app_safety@* or admin@*");
        const app = appOf(req);
        if (app instanceof Response) return app;
        const member = (new URL(req.url).searchParams.get("member") ?? "").trim();
        if (!member) return json({ error: "member is required" }, 400);
        const pv = peopleView();
        if (pv instanceof Response) return pv;
        const no = await record(u, app, { action: "find_person", targetType: "member", targetId: member, ok: true });
        if (no) return no;
        const personId = await pv.personOf(app, member);
        return personId ? json({ personId }) : json({ error: "no person is linked to this member yet" }, 404);
      }),
      "/api/person/:id": global(async (req, u) => {
        if (!canCrossApp(u)) return forbidden("the cross-app view needs cross_app_safety@* or admin@*");
        const pv = peopleView();
        if (pv instanceof Response) return pv;
        const id = decodeURIComponent(req.params.id!);
        const no = await record(u, undefined, { action: "read_person", targetType: "person", targetId: id, ok: true });
        if (no) return no;
        const p = await pv.summary(id);
        return p ? json(p) : json({ error: "not found" }, 404);
      }),
      "/api/person/:id/open": {
        POST: global(async (req, u) => {
          if (!canCrossApp(u)) return forbidden("the cross-app view needs cross_app_safety@* or admin@*");
          const pv = peopleView();
          if (pv instanceof Response) return pv;
          const id = decodeURIComponent(req.params.id!);
          const parsed = await readJsonBody<{ app?: string; reason?: string }>(req, {});
          if (parsed instanceof Response) return parsed;
          const b = parsed.body;
          const reason = String(b.reason ?? "").trim();
          if (!isAppId(b.app)) return json({ ok: false, error: `app must be one of ${APP_IDS.join(", ")}`, code: "unknown_app" }, 400);
          if (reason.length < PERSON_REASON_MIN) return json({ ok: false, error: `a reason (at least ${PERSON_REASON_MIN} characters) is required`, code: "reason_required" }, 400);
          const no = await record(u, b.app, { action: "open_person_app", targetType: "person", targetId: id, reason, ok: true });
          if (no) return no;
          const panel = await pv.panel(id, b.app);
          return panel ? json(panel) : json({ error: "no membership in that app" }, 404);
        }),
      },
      ...staffStepRoutes({
        identified: h => global(h), appOf, mode: () => mode, record, json,
        modeRefusal: req => { const said = req.headers.get(MODE_HEADER); return req.method !== "GET" && said && said !== mode ? modeChanged() : undefined; },
        forwarder: async app => { const src = await source("real", app); return src instanceof RealSource ? src.staffStepForward() : undefined; },
      }),
      "/api/*": global(() => json({ error: "not found" }, 404)),
    },
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const site = siteCheck(req);
        if (site) return site;
        const app = appOf(req);
        if (app instanceof Response) return app;
        const ticket = url.searchParams.get("ticket");
        let u: StaffUser | Response;
        if (ticket !== null) {
          const t = tickets.get(ticket);
          tickets.delete(ticket);
          u = t && t.until > Date.now() && t.app === app ? t.user : json({ error: "bad or expired ticket" }, 401);
        } else u = await identify(req);
        if (u instanceof Response) return u;
        const roles = rolesFor(u, app, mode);
        if (!roles.size) return forbidden(`no role for ${app}`);
        const data: WsData = { app, user: u, cls: viewClass(roles), truth: truthFor(u, app) };
        return srv.upgrade(req, { data, headers: SECURITY_HEADERS }) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      return new Response("not found", { status: 404, headers: SECURITY_HEADERS });
    },
    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        sockets.add(ws);
        ws.subscribe(TOPIC); ws.subscribe(appTopic(ws.data.app));
        ws.send(JSON.stringify({ type: "hello", mode, app: ws.data.app }));
        scheduleExpiry(ws);
      },
      message() { },
      close(ws: ServerWebSocket<WsData>) {
        clearExpiryTimer(ws);
        sockets.delete(ws);
        ws.unsubscribe(TOPIC); ws.unsubscribe(appTopic(ws.data.app));
      },
    },
  });

  const checkTimer = setInterval(() => { for (const ws of sockets) recheck(ws); }, opts.socketCheckMs ?? 15_000);
  checkTimer.unref?.();
  if (!LOOPBACK.has(hostname)) console.warn(`Observatory: listening on ${hostname}, not only on this machine. Anyone with a token can use the API.`);
  const url = `http://${ANY_INTERFACE.has(hostname) ? "127.0.0.1" : hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname}:${server.port}`;
  return {
    server, url, token: adminToken, openUrl: adminToken ? `${url}/#token=${encodeURIComponent(adminToken)}` : `${url}/`, mode: () => mode, source, setMode, audit, lab,
    async stop() {
      clearInterval(checkTimer);
      for (const timer of expiryTimers.values()) clearTimeout(timer);
      expiryTimers.clear();
      known.clear();
      reveals.clear();
      tickets.clear();
      photoPreviews.clear();
      lastRead.clear();
      try { await lab.dispose(); }
      finally {
        stored?.stop();
        for (const [k, s] of sources) { unsub.get(k)?.(); await s.dispose(); }
        server.stop(true);
        await audit.close();
        await people?.close();
        await costs.close();
        await rolesSql?.close();
      }
    },
  };
}

const AUDIT_FIELDS = new Set(["oppId", "memberId", "promptId", "decision", "reason", "on", "speed", "ms", "action", "participants", "category", "swapOut", "revision", "secondsSpent", "auto", "city", "seed", "engine", "personas", "days", "network", "scenario"]);
const AUDIT_TEXTS = new Set(["text", "objective", "note", "why"]);
const auditValue = (v: unknown): unknown =>
  typeof v === "string" ? v.slice(0, 200) : typeof v === "number" || typeof v === "boolean" || v === null ? v
    : Array.isArray(v) ? v.slice(0, 20).filter(x => typeof x === "string").map(x => (x as string).slice(0, 200)) : undefined;

export function auditDetail(cmd: ControlCommand): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cmd)) {
    if (k === "explanations" && v && typeof v === "object") out.explanations = Object.keys(v).slice(0, 20).map(x => x.slice(0, 200));
    else if (AUDIT_TEXTS.has(k) && typeof v === "string") out[`${k}Length`] = v.length;
    else if (AUDIT_FIELDS.has(k)) { const x = auditValue(v); if (x !== undefined) out[k] = x; }
  }
  return out;
}

function resultRow(r: ControlResult): { ok: boolean; detail: Record<string, unknown> } {
  const outcome = r.code === SERVICE_TIMEOUT ? { outcome: "unknown" } : {};
  return { ok: r.ok, detail: { phase: "result", ...(r.code ? { code: r.code } : {}), ...outcome } };
}

function statusOf(r: ControlResult): number {
  if (r.ok) return 200;
  return r.code === SERVICE_TIMEOUT ? 504 : 409;
}

function checkSafety(a: SafetyAction | null): SafetyAction | string {
  if (!a || typeof a !== "object") return "a safety action is required";
  const note = typeof a.note === "string" ? a.note.trim().slice(0, 2000) : undefined;
  const id = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  const needNote = () => (!note || note.length < PERSON_REASON_MIN ? `a note (at least ${PERSON_REASON_MIN} characters) is required` : undefined);
  switch (a.action) {
    case "lift": return id(a.memberId) ? { action: "lift", memberId: id(a.memberId)!, ...(note ? { note } : {}) } : "memberId is required";
    case "close": return id(a.caseId) ? { action: "close", caseId: id(a.caseId)!, ...(note ? { note } : {}) } : "caseId is required";
    case "hold": return !id(a.memberId) ? "memberId is required" : needNote() ?? { action: "hold", memberId: id(a.memberId)!, note: note!, ...(id(a.reportId) ? { reportId: id(a.reportId) } : {}) };
    case "ban":
      if (!id(a.memberId)) return "memberId is required";
      if (a.by !== "phone" && a.by !== "person") return "by must be phone or person";
      return needNote() ?? { action: "ban", memberId: id(a.memberId)!, by: a.by, note: note!, ...(id(a.reportId) ? { reportId: id(a.reportId) } : {}) };
    case "dismiss": return !id(a.reportId) ? "reportId is required" : needNote() ?? { action: "dismiss", reportId: id(a.reportId)!, note: note! };
    case "clear_minor": return !id(a.memberId) ? "memberId is required" : needNote() ?? { action: "clear_minor", memberId: id(a.memberId)!, note: note! };
    default: return "action must be lift, close, hold, ban, dismiss or clear_minor";
  }
}

if (import.meta.main) {
  const { values: a } = parseArgs({ options: {
    port: { type: "string", default: process.env.PORT ?? "4747" }, mode: { type: "string", default: "game" },
    seed: { type: "string", default: "1" }, personas: { type: "string", default: "0" }, engine: { type: "string", default: "engine-v1" },
    days: { type: "string", default: "60" }, "db-url": { type: "string" }, network: { type: "string", default: "consent" },
    city: { type: "string", default: "nyc" }, level: { type: "string" },
    "time-aware": { type: "boolean", default: false },
  } });
  const obs = await createServer({
    port: Number(a.port), mode: a.mode as Mode,
    game: { seed: Number(a.seed), personas: Number(a.personas), engine: a.engine as GameOptions["engine"], days: Number(a.days), network: a.network as "consent" | "stub", city: a.city as "nyc" | "all", scenario: a.level ?? null, timeAware: a["time-aware"] },
    real: { url: a["db-url"] },
  });
  console.log(`The Network Observatory → ${obs.openUrl}  (mode: ${obs.mode()}${process.env.OBSERVATORY_REAL_ONLY === "1" ? ", real only" : ""})`);
}
