#!/usr/bin/env bun
// The Network Observatory server: game mode (live simulated world) and real-world mode (Postgres),
// switchable at runtime. REST for state and details, a WebSocket for live deltas, and the web UI.
//   bun run packages/observatory/src/server.ts [--port 4747] [--mode game|real] [--seed 1]
//       [--personas 0] [--engine engine-v1|random|off] [--db-url postgres://...] [--review auto|human] [--time-aware]
// Security (audit P1-1, admin-console 4): it binds to 127.0.0.1 (OBSERVATORY_HOST overrides). Every
// /api/* route and the /ws upgrade need a staff identity: a static token ("Authorization: Bearer
// <token>", never in a URL; at least 32 characters) from OBSERVATORY_TOKENS (role:token,...) or
// OBSERVATORY_TOKEN (an admin token; else a random admin token printed at startup, in the page URL's
// #fragment, which the browser never sends), or Cloudflare Access SSO
// (OBSERVATORY_TRUST_CF_ACCESS=1, OBSERVATORY_ROLES=email:role,..., and the Access JWT verified with
// OBSERVATORY_CF_ACCESS_TEAM and OBSERVATORY_CF_ACCESS_AUD; tokens are then refused). See src/staff.ts.
// The browser's WebSocket cannot send a header: it asks POST /api/ws-ticket for a one-use ticket
// (30 s) and opens /ws?ticket=. Each socket keeps who opened it: deltas are shaped for that person's
// roles (src/shape.ts), and the socket is closed (4401/4403) when the SSO token expires, a role is
// taken away, or a mode switch leaves the person no role for the app (checked every 15 s). Each route
// and each command checks the caller's roles on the server. Requests with a Host other than
// localhost (DNS rebinding) or a foreign Origin (cross-site WebSocket hijacking) are refused, unless
// OBSERVATORY_ALLOWED_ORIGINS (comma-separated origins) lists them. The page "/" is public.
// OBSERVATORY_REAL_ONLY=1 (production build): game mode, every game control and the lab are off.
// Four apps (platform plan section 5): every /api route and the WebSocket take ?app=ntwrk|slop|peon|friends
// (default ntwrk), and every check is for that app's roles (role@app or role@*). Each app has its
// own world (game mode) or its own rows (real mode: OBSERVATORY_DATABASE_URL_<APP>, the app's read
// login, else the shared login with an app_id filter). The cross-app person view (/api/person) is
// for cross_app_safety@* and admin@* only.
// Real-mode staff actions (review, safety, the matching switch) go to the Network service's staff API
// when NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN are set (sources/service.ts); the database login stays read-only.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import type { Server, ServerWebSocket } from "bun";
import index from "../web/index.html";
import { Lab, LAB_LIMITS, validateLab, type LabOptions } from "./lab.ts";
import { runDiff } from "./runDiff.ts";
import { SQL } from "bun";
import { APP_IDS, appUrlEnv, consoleApps, DEFAULT_APP, isAppId, slaHours, toNetworkReason, type AppId } from "./apps.ts";
import { appProfile, memberFacets, photosAllowed } from "./appProfile.ts";
import { countsMember, countsOpp, shapeDelta, shapeState, viewClass, type ViewClass } from "./shape.ts";
import { appHealth } from "./health.ts";
import { PeopleView, peopleUrl } from "./people.ts";
import { CostView } from "./ops.ts";
import {
  AccessVerifier, allowed, appsFor, authenticateStaff, canCrossApp, createAudit, hasEverywhere, parseRoles, parseTokenGrants, PgStaffRoles, rolesFor, ssoGrants, staffUser,
  type AccessConfig, type AuditSink,
} from "./staff.ts";
// Game mode is imported only when used: it reads the synthetic data in scripts/synthetic, which the
// deployed image (real mode only) does not contain.
import type { GameOptions } from "./sources/game.ts";
import { HIDDEN_MESSAGE, RealSource, type RealOptions } from "./sources/real.ts";
import type { DataSource } from "./sources/source.ts";
import type { AppHealth, AuditEntry, ControlCommand, EnvInfo, Mode, ObsDelta, ObsMember, RevealGrant, SafetyAction, StaffRole, StaffUser } from "./types.ts";

export interface ServerOptions {
  port?: number;
  /** Interface to bind. Default: OBSERVATORY_HOST, else 127.0.0.1. */
  hostname?: string;
  /** Admin token (admin@*). Default: OBSERVATORY_TOKEN, else (no other tokens and no SSO) a random token made at startup. */
  token?: string;
  /** Role tokens, "role@app:token,token:role@app,...". Default: OBSERVATORY_TOKENS. */
  tokens?: string;
  /** Trust Cloudflare Access (SSO). Default: OBSERVATORY_TRUST_CF_ACCESS=1. */
  trustCfAccess?: boolean;
  /** SSO email roles, "email:role@app,...". Default: OBSERVATORY_ROLES. Real mode adds platform.staff_roles. */
  roles?: string;
  /** Read platform.staff_roles through this database (default: the real-mode URL in real mode; false: never). */
  staffRolesUrl?: string | false;
  /** Cloudflare Access JWT checks. Default: OBSERVATORY_CF_ACCESS_TEAM and OBSERVATORY_CF_ACCESS_AUD. Required with trustCfAccess. */
  cfAccess?: Partial<AccessConfig>;
  /** The deployment: dev, staging or production. Default: PLATFORM_ENV. Real data needs it set (deployGuard). */
  platformEnv?: string;
  /** Production build: no game mode, no game controls, no lab. Default: OBSERVATORY_REAL_ONLY=1. */
  realOnly?: boolean;
  /** Where audit rows go. Default: OBSERVATORY_AUDIT_DATABASE_URL (Postgres), else a JSONL file in OBSERVATORY_AUDIT_DIR or runs/audit. */
  audit?: { url?: string; dir?: string } | AuditSink;
  lab?: LabOptions;
  /** Origins (scheme://host:port) allowed besides the server's own. Default: OBSERVATORY_ALLOWED_ORIGINS. */
  allowedOrigins?: string[];
  mode?: Mode;
  /** Game options for every app's world (each world also gets its app). */
  game?: GameOptions;
  /** Real-mode options for every app; `appUrls` gives an app its own read login (else OBSERVATORY_DATABASE_URL_<APP>). */
  real?: RealOptions & { appUrls?: Partial<Record<AppId, string>> };
  /** The cross-app person view's database. Default: OBSERVATORY_PLATFORM_DATABASE_URL, else the real-mode URL. false: off. */
  peopleUrl?: string | false;
  /** Bundle the UI in development mode (HMR, unminified). Default: NODE_ENV !== "production". */
  development?: boolean;
  /** Shortest static token accepted (default 32). */
  minTokenLength?: number;
  /** How often open sockets are checked again: SSO expiry, roles taken away (default 15 s). */
  socketCheckMs?: number;
  /** How often platform.staff_roles is read again (default 60 s). */
  staffRolesEveryMs?: number;
}

export interface ObservatoryServer {
  server: Server<unknown>; url: string;
  /** The admin token (if there is one), and the page URL that carries it in the #fragment (never sent to a server). */
  token?: string; openUrl: string;
  mode(): Mode;
  source(mode?: Mode, app?: AppId): Promise<DataSource>;
  setMode(mode: Mode): Promise<void>;
  audit: AuditSink;
  lab: Lab;
  stop(): Promise<void>;
}

/** WebSocket topics: "obs:<app>" carries that app's deltas; "obs" carries mode switches. */
const TOPIC = "obs";
const appTopic = (app: AppId) => `obs:${app}`;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ANY_INTERFACE = new Set(["0.0.0.0", "::", "[::]"]);
/** A PII reveal lasts at most this long (admin-console 4.4). */
export const REVEAL_MAX_MINUTES = 15;
/** Repeated reads of one member by one staff member within this long write one audit row (the first). */
export const READ_AUDIT_DEDUPE_MS = 60_000;
const DEDUPED_READS = new Set(["read_member", "read_timeline"]);
/** A cross-app panel needs a typed reason of at least this many characters (as a PII reveal). */
export const PERSON_REASON_MIN = 5;
/** A review counts at most this many seconds (a card left open is not review work; audit observatory-10). */
export const REVIEW_SECONDS_MAX = 1800;
/** A WebSocket ticket is good for one connection within this long. */
export const WS_TICKET_MS = 30_000;
/** Headers on every API answer (audit observatory-20). The page itself sets its policy in index.html. */
export const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
/** WebSocket close codes: the sign-in ended (4401) or the person has no role for the app any more (4403). */
export const WS_EXPIRED = 4401, WS_FORBIDDEN = 4403;
/** The client says which mode it acts in; a command for a mode that is no longer on is refused (audit observatory-21). */
export const MODE_HEADER = "x-observatory-mode";

/** What a socket keeps: the app, who opened it, and what they may receive. */
interface WsData { app: AppId; user: StaffUser; cls: ViewClass; truth: boolean }

/**
 * Who may send each command, for the request's app (admin for the app may send all). Game controls
 * are the simulation lab: reviewers and safety staff train there, engineers work there; analysts
 * only look. The truth lens shows hidden persona truth (private disclosures), so it is safety or
 * admin, like a PII reveal. Review mode, the matching switch and reset are admin only.
 */
const SIM: readonly StaffRole[] = ["reviewer", "safety", "engineer"];
export const CONTROL_ROLES: Readonly<Record<ControlCommand["type"], readonly StaffRole[]>> = {
  play: SIM, pause: SIM, speed: SIM, step: SIM, propose: SIM, takeover: SIM, reply: SIM, say: SIM, god: SIM, peek: SIM, lens: ["safety"], check_scenario: SIM,
  review: ["reviewer"], review_mode: [], matching: [], reset: [],
  refresh: ["reviewer", "safety", "analyst"], shadow_run: ["analyst"],
};
/** The simulation lab's runs: analysts and engineers. */
const LAB_ROLES: readonly StaffRole[] = ["analyst", "engineer"];
/** Commands that change nothing worth an audit row (clock controls). The truth lens is audited. */
const QUIET = new Set(["play", "pause", "speed", "step", "refresh"]);
/** Commands that exist only in game mode (refused when OBSERVATORY_REAL_ONLY=1). */
const GAME_ONLY = new Set(["play", "pause", "speed", "step", "propose", "takeover", "reply", "say", "god", "peek", "lens", "check_scenario", "reset", "review_mode"]);

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** A database URL whose host is not this machine (an unparsable URL counts as remote). */
const remoteDb = (url: string) => { try { return !LOCAL_DB_HOSTS.has(new URL(url).hostname.toLowerCase()); } catch { return true; } };

/**
 * The console's start guard (docs/deploy.md 2.6), fail closed. The console holds real data when it is
 * real-only (OBSERVATORY_REAL_ONLY=1) or when any database it may read is not on this machine (a game
 * server can switch to real mode). Then:
 *  - PLATFORM_ENV must be set (dev, staging or production);
 *  - staging and production need Cloudflare Access (no tokens);
 *  - PLATFORM_ENV=dev may use tokens only with local databases; a remote one needs Cloudflare Access too.
 * Returns why the server must not start, or undefined.
 */
export function deployGuard(o: { realOnly: boolean; trustCfAccess: boolean; platformEnv?: string; databaseUrls: (string | undefined)[] }): string | undefined {
  const remote = o.databaseUrls.some(u => !!u && remoteDb(u));
  if (!o.realOnly && !remote) return undefined;
  const env = o.platformEnv?.trim();
  const why = o.realOnly ? "OBSERVATORY_REAL_ONLY=1" : "a database that is not on this machine";
  const access = "needs Cloudflare Access: OBSERVATORY_TRUST_CF_ACCESS=1 with OBSERVATORY_CF_ACCESS_TEAM and OBSERVATORY_CF_ACCESS_AUD";
  if (!env) return `real data (${why}) needs PLATFORM_ENV (dev, staging or production)`;
  if (env !== "dev" && env !== "staging" && env !== "production") return `unknown PLATFORM_ENV "${env}" (dev, staging or production)`;
  if (o.trustCfAccess) return undefined;
  if (env !== "dev") return `a deployed console (${why}, PLATFORM_ENV ${env}) ${access}`;
  if (remote) return `PLATFORM_ENV=dev with a database that is not on this machine ${access} (tokens are for local databases only)`;
  return undefined;
}

/** Hostname of a Host header or an origin, lowercased, without the port ("[::1]" keeps its brackets). */
function hostnameOf(hostOrUrl: string): string | undefined {
  try { return new URL(hostOrUrl.includes("://") ? hostOrUrl : `http://${hostOrUrl}`).hostname.toLowerCase(); } catch { return undefined; }
}

export async function createServer(opts: ServerOptions = {}): Promise<ObservatoryServer> {
  const realOnly = opts.realOnly ?? process.env.OBSERVATORY_REAL_ONLY === "1";
  let mode: Mode = realOnly ? "real" : opts.mode ?? "game";
  const sla = slaHours();
  /** One source per (mode, app), started when first asked for. */
  const sources = new Map<string, DataSource>();
  const starting = new Map<string, Promise<DataSource>>();
  const unsub = new Map<string, () => void>();
  let server!: Server<unknown>;
  const key = (m: Mode, app: AppId) => `${m}:${app}`;

  /** Open sockets, each with who opened it (deltas are shaped per person; audit observatory-6). */
  const sockets = new Set<ServerWebSocket<WsData>>();
  /** Every member of each (mode, app) as the source last sent them: the analyst view takes their names out of feed lines. */
  const known = new Map<string, Map<string, ObsMember>>();
  const broadcast = (m: Mode, app: AppId, d: ObsDelta) => {
    const names = known.get(key(m, app)) ?? new Map<string, ObsMember>();
    known.set(key(m, app), names);
    for (const x of d.members ?? []) names.set(x.id, x);
    if (m !== mode || !server) return;
    if (!d.reset && !d.members && !d.edges && !d.opportunities && !d.feed && !d.stats && !d.engineRuns && !d.env && !d.removedOpportunities && !d.game && !d.requests && !d.network) {
      server.publish(appTopic(app), JSON.stringify({ type: "clock", app, clock: d.clock, version: d.version }));
      return;
    }
    // One message per view (counts or full, lens on or off), sent to each socket of the app.
    const made = new Map<string, string>();
    for (const ws of sockets) {
      const w = ws.data;
      if (w.app !== app) continue;
      const k = `${w.cls}|${w.truth}`;
      let msg = made.get(k);
      if (!msg) { msg = JSON.stringify({ type: "delta", mode: m, app, delta: withAuth(shapeDelta(d, w.cls, w.truth, () => names.values())) }); made.set(k, msg); }
      ws.send(msg);
    }
  };

  async function source(m: Mode = mode, app: AppId = DEFAULT_APP): Promise<DataSource> {
    if (m === "game" && realOnly) throw new Error("game mode is off on this server (OBSERVATORY_REAL_ONLY=1)");
    const k = key(m, app);
    const have = sources.get(k);
    if (have) return have;
    if (!starting.has(k)) starting.set(k, (async () => {
      const s: DataSource = m === "game"
        ? new (await import("./sources/game.ts")).GameSource({ ...opts.game, app })
        : new RealSource({ ...opts.real, app, ...(opts.real?.appUrls?.[app] ? { appUrl: opts.real.appUrls[app] } : {}) });
      await s.init();
      known.set(k, new Map(s.state().members.map(x => [x.id, x])));
      sources.set(k, s);
      unsub.set(k, s.subscribe(d => broadcast(m, app, d)));
      return s;
    })());
    return starting.get(k)!;
  }

  async function setMode(m: Mode) {
    if (m !== "game" && m !== "real") throw new Error(`unknown mode ${m}`);
    if (m === "game" && realOnly) throw new Error("game mode is off on this server (OBSERVATORY_REAL_ONLY=1)");
    if (mode === m && sources.has(key(m, DEFAULT_APP))) return;
    if (m === "real") for (const app of APP_IDS) await sources.get(key("game", app))?.control({ type: "pause" });
    mode = m;
    await source(m, DEFAULT_APP);
    // A socket opened in one mode is authorized again for the new one (an engineer has no role in real mode).
    for (const ws of sockets) recheck(ws);
    server?.publish(TOPIC, JSON.stringify({ type: "mode", mode: m }));
  }

  const json = (data: unknown, status = 200, extra?: Record<string, string>) => Response.json(data, { status, headers: { ...SECURITY_HEADERS, ...extra } });
  /** A failure inside a route: logged with a reference, never sent to the browser as is (audit observatory-13). */
  const fail = (e: unknown) => {
    const ref = randomBytes(4).toString("hex");
    console.error(`Observatory: request failed (ref ${ref})`, e);
    return json({ error: `internal error (ref ${ref})`, code: "internal" }, 500);
  };

  // ---------------------------------------------------------------- staff access (admin-console 4)
  const hostname = opts.hostname ?? process.env.OBSERVATORY_HOST ?? "127.0.0.1";
  const tokens = parseTokenGrants(opts.tokens ?? process.env.OBSERVATORY_TOKENS, { explicitApp: process.env.NODE_ENV === "production" || process.env.PLATFORM_ENV === "production", minLength: opts.minTokenLength ?? 32 });
  const trustCfAccess = opts.trustCfAccess ?? process.env.OBSERVATORY_TRUST_CF_ACCESS === "1";
  // A deployed console signs staff in through Cloudflare Access only: without it the server would make an
  // admin token and print it into the host's logs (docs/deploy.md 2.6). Fail closed (deployGuard).
  const refusal = deployGuard({
    realOnly, trustCfAccess, platformEnv: opts.platformEnv ?? process.env.PLATFORM_ENV,
    databaseUrls: [opts.real?.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL,
      ...APP_IDS.map(a => opts.real?.appUrls?.[a] ?? process.env[appUrlEnv(a)]), process.env.OBSERVATORY_PLATFORM_DATABASE_URL,
      typeof opts.peopleUrl === "string" ? opts.peopleUrl : undefined, typeof opts.staffRolesUrl === "string" ? opts.staffRolesUrl : undefined],
  });
  if (refusal) throw new Error(`refusing to start: ${refusal}`);
  if (trustCfAccess && (tokens.size || opts.token || process.env.OBSERVATORY_TOKEN)) console.warn("Observatory: single sign-on is on, so OBSERVATORY_TOKENS and OBSERVATORY_TOKEN are refused (each person signs in as themselves)");
  const roles = parseRoles(opts.roles ?? process.env.OBSERVATORY_ROLES);
  const adminToken = opts.token ?? process.env.OBSERVATORY_TOKEN ?? (tokens.size || trustCfAccess ? undefined : randomBytes(24).toString("base64url"));
  if (adminToken && adminToken.length < (opts.minTokenLength ?? 32)) throw new Error(`OBSERVATORY_TOKEN is shorter than ${opts.minTokenLength ?? 32} characters`);
  if (adminToken) { const list = tokens.get(adminToken) ?? []; if (!list.some(g => g.role === "admin" && g.app === "*")) list.push({ role: "admin", app: "*" }); tokens.set(adminToken, list); }
  // The Access email is trusted only from a verified JWT: without the team and the audience, refuse to start.
  const access = trustCfAccess ? new AccessVerifier({
    ...opts.cfAccess, team: opts.cfAccess?.team ?? process.env.OBSERVATORY_CF_ACCESS_TEAM ?? "", aud: opts.cfAccess?.aud ?? process.env.OBSERVATORY_CF_ACCESS_AUD ?? "",
  }) : undefined;
  // platform.staff_roles (SSO users, real mode): read through the real-mode database.
  const rolesUrl = opts.staffRolesUrl === false ? undefined : opts.staffRolesUrl ?? (trustCfAccess && (realOnly || mode === "real") ? opts.real?.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL : undefined);
  const rolesSql = rolesUrl ? new SQL({ url: rolesUrl, max: 1, idleTimeout: 30, connection: { default_transaction_read_only: "on", application_name: "network-observatory-roles" } }) : undefined;
  const stored = rolesSql ? new PgStaffRoles(rolesSql, opts.staffRolesEveryMs) : undefined;
  await stored?.start();
  const auth = { tokens, trustCfAccess, roles, access, stored };
  const audit: AuditSink = opts.audit && "write" in opts.audit ? opts.audit : createAudit(opts.audit as { url?: string; dir?: string } | undefined);
  const lab = new Lab(opts.lab);
  const pUrl = opts.peopleUrl === false ? undefined : opts.peopleUrl ?? opts.real?.url ?? peopleUrl();
  let people: PeopleView | undefined;
  const costs = new CostView();
  /** Active PII reveals: "<staff id>|<mode>|<app>|<member id>" -> grant (a game member and a real member never share one). In memory: a restart ends every reveal. */
  const reveals = new Map<string, RevealGrant>();
  const revealKey = (u: StaffUser, app: AppId, memberId: string) => `${u.id}|${mode}|${app}|${memberId}`;
  /** One-use WebSocket tickets: ticket -> who asked, for which app, until when. */
  const tickets = new Map<string, { user: StaffUser; app: AppId; until: number }>();
  /** "<staff id>|<app>" with the truth lens on (game mode). Per person: hidden truth never goes to anyone else. */
  const lensOn = new Set<string>();
  const truthFor = (u: StaffUser, app: AppId) => mode === "game" && lensOn.has(`${u.id}|${app}`) && allowed(u, CONTROL_ROLES.lens, app, mode);

  const allowedOrigins = new Set((opts.allowedOrigins ?? (process.env.OBSERVATORY_ALLOWED_ORIGINS ?? "").split(","))
    .map(o => o.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean));
  const allowedHosts = new Set([...LOOPBACK, ...[...allowedOrigins].map(hostnameOf).filter((h): h is string => !!h)]);
  if (!ANY_INTERFACE.has(hostname)) allowedHosts.add(hostname.toLowerCase());

  /** Host and Origin: DNS rebinding and cross-site requests are refused. undefined: fine. */
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
  /** Who is calling, or why the request is refused (a Response). Host and Origin first. */
  async function identify(req: Request): Promise<StaffUser | Response> {
    const site = siteCheck(req);
    if (site) return site;
    const a = await authenticateStaff(req, auth);
    if ("user" in a) {
      if (a.user.expiresAt !== undefined && a.user.expiresAt <= Date.now()) return json({ error: "sign-in expired" }, 401);
      return a.user;
    }
    return json({ error: a.error }, a.status, a.status === 401 ? { "www-authenticate": "Bearer" } : undefined);
  }
  /**
   * Authorize an open socket again: the sign-in has not expired, the person still holds a role for the
   * socket's app in the current mode (SSO roles are read again: OBSERVATORY_ROLES and platform.staff_roles),
   * and the view and lens follow the roles. Otherwise the socket is closed. Returns whether it stays open.
   */
  function recheck(ws: ServerWebSocket<WsData>): boolean {
    const w = ws.data;
    if (w.user.expiresAt !== undefined && w.user.expiresAt <= Date.now()) { ws.close(WS_EXPIRED, "sign-in expired"); sockets.delete(ws); return false; }
    if (w.user.via === "sso") w.user = { ...staffUser(w.user.id, ssoGrants(w.user.id, auth), "sso"), ...(w.user.expiresAt !== undefined ? { expiresAt: w.user.expiresAt } : {}) };
    const roles = rolesFor(w.user, w.app, mode);
    if (!roles.size) { ws.close(WS_FORBIDDEN, `no role for ${w.app}`); sockets.delete(ws); return false; }
    w.cls = viewClass(roles);
    w.truth = truthFor(w.user, w.app);
    return true;
  }
  /** The request's app: ?app= (default ntwrk). An unknown app is refused. */
  function appOf(req: Request): AppId | Response {
    const v = new URL(req.url).searchParams.get("app");
    if (v === null || v === "") return DEFAULT_APP;
    return isAppId(v) ? v : json({ error: `unknown app "${v}" (one of ${APP_IDS.join(", ")})`, code: "unknown_app" }, 400);
  }
  const forbidden = (text: string) => json({ error: `forbidden: ${text}`, code: "forbidden" }, 403);
  type Req = Request & { params: Record<string, string> };
  type Handler = (req: Req, user: StaffUser, app: AppId) => Response | Promise<Response>;
  /**
   * An app route: the caller needs a role for the request's app; with `need`, one of those roles
   * for that app (admin for the app always passes).
   */
  const guard = (h: Handler, need?: readonly StaffRole[]) => async (req: Req) => {
    const u = await identify(req);
    if (u instanceof Response) return u;
    const app = appOf(req);
    if (app instanceof Response) return app;
    if (!rolesFor(u, app, mode).size) return forbidden(`no role for ${app}${mode === "real" && u.roles.includes("engineer") ? " (engineer: simulated worlds only)" : ""}`);
    if (need && !allowed(u, need, app, mode)) return forbidden(`needs ${["admin", ...need].join(" or ")} for ${app}`);
    // A change sent from a page that still shows the other mode would act on the wrong world (audit observatory-21).
    const said = req.headers.get(MODE_HEADER);
    if (req.method !== "GET" && said && said !== mode) return json({ ok: false, error: `the console switched to ${mode} mode: reload before you act`, code: "mode_changed" }, 409);
    try { return await h(req, u, app); } catch (e) { return fail(e); }
  };
  /** A route that is not about one app: any staff member, or with `need`, the role for every app (role@*). */
  const global = (h: (req: Req, user: StaffUser) => Response | Promise<Response>, need?: readonly StaffRole[]) => async (req: Req) => {
    const u = await identify(req);
    if (u instanceof Response) return u;
    if (need && !allowed(u, need)) return forbidden(`needs ${["admin", ...need].map(r => `${r}@*`).join(" or ")}`);
    try { return await h(req, u); } catch (e) { return fail(e); }
  };
  /** The env as the client sees it. */
  const withAuth = <T extends { env?: EnvInfo }>(x: T): T => (x.env ? { ...x, env: { ...x.env, authRequired: true, ...(realOnly ? { realOnly: true } : {}) } } : x);

  /** When each (staff, read, app, member, revealed) read last wrote a row (reads are deduplicated for READ_AUDIT_DEDUPE_MS). */
  const lastRead = new Map<string, number>();
  /**
   * Write an audit row. A read or action whose row cannot be written is refused (fail closed). The
   * detail panels reload a member as it changes: repeated reads of one member by one staff member
   * within 60 s keep only the first row (a reveal starts a new one).
   */
  async function record(u: StaffUser, app: AppId | undefined, e: Omit<AuditEntry, "at" | "actor" | "roles" | "mode" | "app">): Promise<Response | undefined> {
    const at = Date.now();
    const k = DEDUPED_READS.has(e.action) && e.ok ? `${u.id}|${e.action}|${app}|${e.targetId}|${e.detail?.revealed ? 1 : 0}|${mode}` : undefined;
    if (k && at - (lastRead.get(k) ?? -Infinity) < READ_AUDIT_DEDUPE_MS) return undefined;
    try {
      await audit.write({ at, actor: u.id, roles: u.roles, mode, ...(app ? { app } : {}), ...e });
      if (k) {
        lastRead.set(k, at);
        if (lastRead.size > 5000) for (const [x, t] of lastRead) if (at - t >= READ_AUDIT_DEDUPE_MS) lastRead.delete(x);
      }
      return undefined;
    } catch (err) {
      console.error("Observatory: audit write failed", err);
      return json({ error: "audit log unavailable: request refused" }, 503);
    }
  }
  const revealFor = (u: StaffUser, app: AppId, memberId: string): RevealGrant | undefined => {
    const k = revealKey(u, app, memberId), g = reveals.get(k);
    if (g && g.until <= Date.now()) { reveals.delete(k); return undefined; }
    return g;
  };
  /**
   * Member 360 and timeline (admin-console 4.1), for the app: admin and safety see any member; an
   * engineer sees simulated members only; a reviewer sees members in an open review item; an analyst sees none.
   */
  async function canSeeMember(u: StaffUser, app: AppId, id: string): Promise<boolean> {
    const r = rolesFor(u, app, mode);
    if (r.has("admin") || r.has("safety") || (r.has("engineer") && mode === "game")) return true;
    if (r.has("reviewer")) return (await source(mode, app)).inOpenReview(id);
    return false;
  }
  /** The cross-app view's data (real mode only: the platform schema holds people and memberships). */
  function peopleView(): PeopleView | Response {
    if (mode !== "real") return json({ error: "the cross-app view reads the platform schema: switch to real mode", code: "real_only" }, 409);
    if (!pUrl) return json({ error: "no platform database configured (OBSERVATORY_PLATFORM_DATABASE_URL)", code: "not_configured" }, 503);
    people ??= new PeopleView(pUrl);
    return people;
  }

  await source(mode, DEFAULT_APP);
  server = Bun.serve({
    port: opts.port ?? 4747,
    hostname,
    development: opts.development ?? process.env.NODE_ENV !== "production",
    routes: {
      "/": index,
      // Liveness for Railway's health check and an uptime monitor: no auth, no data, no Host check (Access guards the domain).
      "/healthz": () => new Response(JSON.stringify({ ok: true }), { headers: { ...SECURITY_HEADERS, "content-type": "application/json" } }),
      "/api/health": global(() => json({ ok: true, mode })),
      "/api/me": global((_r, u) => json({ ...u, realOnly, apps: appsFor(u, mode), crossApp: canCrossApp(u), appInfo: consoleApps(sla) })),
      "/api/apps/health": global(async (_r, u) => {
        // One line per app this person holds a role for. Game worlds are not started from here (each loads a whole world).
        const out: AppHealth[] = [];
        for (const app of appsFor(u, mode)) {
          const s = mode === "game" ? sources.get(key("game", app)) : await source("real", app).catch(() => undefined);
          if (!s) { out.push({ app, available: false, error: "world not started: open this app to start it", members: 0, reviewBacklog: 0, slaMisses: 0, slaHours: sla[app], sendFailures: 0, matching: "off" }); continue; }
          out.push(appHealth(app, s.state(), sla[app]));
        }
        return json({ mode, apps: out });
      }),
      // The scenario list is game mode's (the simulation harness): imported only when asked, so a real-only image never loads it.
      "/api/levels": global(async () => json(realOnly ? [] : (await import("@thenetwork/network/harness")).SCENARIOS.map(x => ({ id: x.id, title: x.title, description: x.description, days: x.days })))),
      "/api/mode": {
        GET: global(() => json({ mode, realOnly, realConfigured: !!(opts.real?.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL) })),
        POST: global(async (req, u) => {
          const body = await req.json().catch(() => ({})) as { mode?: Mode };
          if (body.mode === "game" && realOnly) return json({ ok: false, error: "game mode is off on this server (OBSERVATORY_REAL_ONLY=1)", code: "real_only" }, 403);
          if (body.mode !== "game" && body.mode !== "real") return json({ ok: false, error: `unknown mode ${body.mode}` }, 400);
          // Audited before the switch: no row, no switch (fail closed).
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
        // The browser's WebSocket cannot send an Authorization header: a one-use ticket for 30 s instead of a token in the URL.
        POST: guard((_r, u, app) => {
          const now = Date.now();
          for (const [t, x] of tickets) if (x.until <= now) tickets.delete(t);
          const ticket = randomBytes(24).toString("base64url");
          tickets.set(ticket, { user: u, app, until: now + WS_TICKET_MS });
          return json({ ticket, expiresInMs: WS_TICKET_MS });
        }),
      },
      "/api/member/:id": guard(async (req, u, app) => {
        const id = decodeURIComponent(req.params.id!);
        if (!(await canSeeMember(u, app, id))) return forbidden("this role cannot open this member");
        const grant = revealFor(u, app, id);
        const no = await record(u, app, { action: "read_member", targetType: "member", targetId: id, ok: true, ...(grant ? { detail: { revealed: true } } : {}) });
        if (no) return no;
        const d = await (await source(mode, app)).member(id, { reveal: !!grant, truth: truthFor(u, app) });
        if (!d) return json({ error: "not found" }, 404);
        // Dating facts stay hidden until a reveal; scores and ratings never leave (admin-console 3.3.1).
        d.facets = memberFacets(app, d.facets, !!grant);
        if (grant) d.revealed = { until: grant.until };
        if (allowed(u, ["safety"], app, mode)) {
          const rows = await audit.list({ targetType: "member", targetId: id, limit: 50, actions: ["read_member", "read_timeline", "reveal"], apps: [app] }).catch(() => []);
          d.staffAccess = rows.map(r => ({ actor: r.actor, at: r.at, action: r.action }));
        }
        return json(d);
      }),
      "/api/member/:id/timeline": guard(async (req, u, app) => {
        const id = decodeURIComponent(req.params.id!);
        if (!(await canSeeMember(u, app, id))) return forbidden("this role cannot open this member");
        const grant = revealFor(u, app, id);
        const no = await record(u, app, { action: "read_timeline", targetType: "member", targetId: id, ok: true, ...(grant ? { detail: { revealed: true } } : {}) });
        if (no) return no;
        const t = await (await source(mode, app)).timeline(id, { reveal: !!grant });
        if (!t) return json({ error: "not found" }, 404);
        return json(grant ? { ...t, revealed: { until: grant.until } } : t);
      }),
      "/api/member/:id/app": guard(async (req, u, app) => {
        // The app's own Member 360 panel (slop: dating preferences behind a reveal, the photo rule; peon: roles and applications).
        const id = decodeURIComponent(req.params.id!);
        if (!(await canSeeMember(u, app, id))) return forbidden("this role cannot open this member");
        const grant = revealFor(u, app, id);
        const no = await record(u, app, { action: "read_member_app", targetType: "member", targetId: id, ok: true, ...(grant ? { detail: { revealed: true } } : {}) });
        if (no) return no;
        // Read whole on the server (the age-verification tag is agent-only); what leaves is the panel, and its dating facts only with a reveal.
        const d = await (await source(mode, app)).member(id, { reveal: true });
        if (!d) return json({ error: "not found" }, 404);
        return json(appProfile(app, d, { revealed: !!grant }));
      }),
      "/api/member/:id/photos": {
        // slop photos: admin or safety, a typed reason, verified adults only (never a member under 18). Audited before the read.
        POST: guard(async (req, u, app) => {
          const id = decodeURIComponent(req.params.id!);
          const b = await req.json().catch(() => ({})) as { reason?: string };
          const reason = String(b.reason ?? "").trim();
          if (app !== "slop") return json({ ok: false, error: "photos exist only on slop", code: "no_photos" }, 404);
          if (reason.length < PERSON_REASON_MIN) return json({ ok: false, error: `a reason (at least ${PERSON_REASON_MIN} characters) is required`, code: "reason_required" }, 400);
          const src = await source(mode, app);
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
          const r = src.photos ? await src.photos(id, u.id, reason) : { ok: true as const, photos: [] };
          return json(r, r.ok ? 200 : 409);
        }, ["safety"]),
      },
      "/api/opportunity/:id": guard(async (req, u, app) => {
        const id = decodeURIComponent(req.params.id!);
        const no = await record(u, app, { action: "read_opportunity", targetType: "opportunity", targetId: id, ok: true });
        if (no) return no;
        const d = await (await source(mode, app)).opportunity(id, { truth: truthFor(u, app) });
        if (!d) return json({ error: "not found" }, 404);
        // An analyst sees the opportunity's shape, never the people in it or the texts written to them.
        if (viewClass(rolesFor(u, app, mode)) === "counts") return json({ ...d, opportunity: countsOpp(d.opportunity), members: d.members.map(countsMember), messages: [] });
        // What a member wrote only for staff who may open that member (4.1); others get its length.
        const may = new Map<string, boolean>();
        for (const m of d.messages) {
          if (m.direction !== "inbound" || m.system || m.body === HIDDEN_MESSAGE) continue;
          if (!may.has(m.memberId)) may.set(m.memberId, await canSeeMember(u, app, m.memberId));
          if (!may.get(m.memberId)) { m.hiddenLength = m.body.length; m.body = HIDDEN_MESSAGE; }
        }
        return json(d);
      }),
      "/api/reveal": {
        // Admin-console 4.4: per member, with a reason, for at most 15 minutes; audited before it is granted.
        GET: guard((_r, u, app) => json([...reveals.entries()].filter(([k, g]) => k.startsWith(`${u.id}|${mode}|${app}|`) && g.until > Date.now()).map(([, g]) => g))),
        POST: guard(async (req, u, app) => {
          const b = await req.json().catch(() => ({})) as { memberId?: string; reason?: string; minutes?: number };
          const memberId = String(b.memberId ?? ""), reason = String(b.reason ?? "").trim();
          if (!memberId || reason.length < 5) return json({ ok: false, error: "a member and a reason (at least 5 characters) are required" }, 400);
          const s = await source(mode, app);
          if (!s.state().members.some(m => m.id === memberId)) {
            // A refused reveal is audited too: probing for who is a member leaves a row (audit observatory-M3).
            const no = await record(u, app, { action: "reveal", targetType: "member", targetId: memberId, reason, ok: false, detail: { refused: "unknown_member" } });
            if (no) return no;
            return json({ ok: false, error: "unknown member" }, 404);
          }
          const minutes = Math.min(REVEAL_MAX_MINUTES, Math.max(1, Math.round(Number(b.minutes) || REVEAL_MAX_MINUTES)));
          const at = Date.now(), grant: RevealGrant = { memberId, reason, at, until: at + minutes * 60_000 };
          const no = await record(u, app, { action: "reveal", targetType: "member", targetId: memberId, reason, ok: true, detail: { minutes } });
          if (no) return no;
          reveals.set(revealKey(u, app, memberId), grant);
          return json({ ok: true, ...grant });
        }, ["safety"]),
        // End a reveal before its time (audited).
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
        POST: guard(async (req, u, app) => {
          let cmd = await req.json().catch(() => null) as ControlCommand | null;
          if (!cmd || typeof cmd.type !== "string") return json({ ok: false, error: "bad command" }, 400);
          // Own keys only: "constructor" or "__proto__" is not a command (audit observatory-13).
          const need = Object.hasOwn(CONTROL_ROLES, cmd.type) ? CONTROL_ROLES[cmd.type] : undefined;
          if (!need) return json({ ok: false, error: "unknown command" }, 400);
          const target = "oppId" in cmd ? { targetType: "opportunity" as const, targetId: cmd.oppId } : "memberId" in cmd ? { targetType: "member" as const, targetId: cmd.memberId } : cmd.type === "matching" || cmd.type === "review_mode" ? { targetType: "config" as const, targetId: cmd.type } : {};
          const detail = auditDetail(cmd);
          if (!allowed(u, need, app, mode)) {
            await record(u, app, { action: cmd.type, ...target, ok: false, detail: { ...detail, refused: "forbidden" } });
            return forbidden(`${cmd.type} needs ${["admin", ...need].join(" or ")} for ${app}`);
          }
          if (realOnly && GAME_ONLY.has(cmd.type)) return json({ ok: false, error: `${cmd.type} is off on this server (OBSERVATORY_REAL_ONLY=1)`, code: "real_only" }, 403);
          // A review reason is one of the app's codes; an app code goes to the Network as its PRD 32.8 base code.
          if (cmd.type === "review" && cmd.reason) {
            const r = toNetworkReason(app, cmd.reason, cmd.note);
            if (!r) return json({ ok: false, error: `unknown reason ${cmd.reason} for ${app}`, code: "unknown_reason" }, 400);
            cmd = { ...cmd, reason: r.reason, note: r.note };
          }
          if (cmd.type === "review" && cmd.secondsSpent !== undefined) cmd = { ...cmd, secondsSpent: Math.min(REVIEW_SECONDS_MAX, Math.max(0, Number(cmd.secondsSpent) || 0)) };
          // Staff actions are audited before they run; the result follows in a second row.
          if (!QUIET.has(cmd.type)) { const no = await record(u, app, { action: cmd.type, ...target, ok: true, detail: { ...detail, phase: "requested" } }); if (no) return no; }
          const r = await (await source(mode, app)).control(cmd, u.id);
          if (r.ok && cmd.type === "lens") { if (cmd.on) lensOn.add(`${u.id}|${app}`); else lensOn.delete(`${u.id}|${app}`); }
          if (r.ok && cmd.type === "reset") for (const k of [...lensOn]) if (k.endsWith(`|${app}`)) lensOn.delete(k);
          if (r.ok && (cmd.type === "lens" || cmd.type === "reset")) for (const ws of sockets) if (ws.data.app === app) ws.data.truth = truthFor(ws.data.user, app);
          // The result row is best effort: the action already ran, and its "requested" row is written.
          if (!QUIET.has(cmd.type)) await record(u, app, { action: cmd.type, ...target, ok: r.ok, detail: { ...detail, phase: "result", ...(r.code ? { code: r.code } : {}) } });
          return json(r, r.ok ? 200 : 409);
        }),
      },
      "/api/safety": {
        GET: guard(async (_r, _u, app) => json(await (await source(mode, app)).safety()), ["safety"]),
        POST: guard(async (req, u, app) => {
          const a = await req.json().catch(() => null) as SafetyAction | null;
          const v = checkSafety(a);
          if (typeof v === "string") return json({ ok: false, error: v, code: "bad_action" }, 400);
          const target = v.action === "close" ? { targetType: "case" as const, targetId: v.caseId } : v.action === "dismiss" ? { targetType: "report" as const, targetId: v.reportId } : { targetType: "member" as const, targetId: v.memberId };
          const extra = v.action === "ban" ? { by: v.by } : {};
          const report = "reportId" in v && v.reportId ? { reportId: v.reportId } : {};
          const no = await record(u, app, { action: `safety_${v.action}`, ...target, ok: true, ...(v.note ? { reason: v.note } : {}), detail: { phase: "requested", ...extra, ...report } });
          if (no) return no;
          const r = await (await source(mode, app)).safetyAction(v, u.id);
          await record(u, app, { action: `safety_${v.action}`, ...target, ok: r.ok, detail: { phase: "result", ...extra, ...report, ...(r.code ? { code: r.code } : {}) } });
          return json(r, r.ok ? 200 : 409);
        }, ["safety"]),
      },
      // The weekly bias monitor (aggregates only; real mode reads it from the Network service). Admin or analyst.
      "/api/bias": guard(async (_r, u, app) => {
        const src = await source(mode, app);
        if (!src.bias) return json({ ok: false, error: "the bias monitor runs on real data only (bun run sim measures it in simulation)", code: "real_only" }, 404);
        const no = await record(u, app, { action: "read_bias", ok: true });
        if (no) return no;
        const r = await src.bias(u.id);
        return json(r, r.ok ? 200 : 502);
      }, ["analyst"]),
      // The cost panel (src/ops.ts): estimated cost per day and kind, and today's budget use. Real mode only.
      "/api/ops/cost": guard(async (req, u, app) => {
        if (mode !== "real") return json({ ok: false, error: "costs are recorded on real data only", code: "real_only" }, 404);
        const days = Number(new URL(req.url).searchParams.get("days")) || 14;
        const r = await costs.summary(app, Date.now(), { days, everyApp: hasEverywhere(u, "admin") || hasEverywhere(u, "analyst") });
        return r ? json({ ok: true, ...r }) : json({ ok: false, error: "no database configured", code: "not_configured" }, 503);
      }, ["analyst"]),
      "/api/config": guard(async (_r, _u, app) => json(await (await source(mode, app)).config()), ["analyst"]),
      "/api/audit": guard(async (req, u, app) => {
        const q = new URL(req.url).searchParams;
        const no = await record(u, app, { action: "read_audit", ok: true });
        if (no) return no;
        // admin@* without ?app= reads every row; an app admin reads that app's rows only.
        const every = hasEverywhere(u, "admin") && !q.get("app");
        const rows = await audit.list({ limit: Math.min(1000, Number(q.get("limit")) || 200), actor: q.get("actor") ?? undefined, targetType: q.get("targetType") ?? undefined, targetId: q.get("targetId") ?? undefined, ...(every ? {} : { apps: [app] }) });
        return json({ sink: audit.kind, entries: rows });
      }, []),
      "/api/search": guard(async (req, u, app) => {
        const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
        if (q.length < 2 || q.length > 200) return json({ error: "q must be 2-200 characters" }, 400);
        // The audit row is append-only and kept forever: it keeps the query's length, never the text (a name, a phone, a phrase).
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
          const body = await req.json().catch(() => null) as { app?: string } | null;
          if (body?.app !== undefined && body.app !== app) return json({ ok: false, error: `the run's app (${body.app}) is not the request's app (${app})`, code: "app_mismatch" }, 400);
          const v = validateLab({ ...body, app });
          if (typeof v === "string") return json({ ok: false, error: v }, 400);
          if (lab.queued + v.seeds.length > LAB_LIMITS.maxQueued) return json({ ok: false, error: `the lab queue is full (${LAB_LIMITS.maxQueued} seeds wait at most): try again when runs finish`, code: "queue_full" }, 429);
          const no = await record(u, app, { action: "lab_run", targetType: "run", ok: true, detail: { arms: v.arms, seeds: v.seeds, days: v.days, app: v.app } });
          if (no) return no;
          const run = await lab.start(v, u.id);
          return json({ ok: true, run });
        }, LAB_ROLES),
      },
      // ------------------------------------------------------------ cross-app person view (plan 5, 2.4)
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
        // One app's panel: a typed reason, and the audit row (with the app) is written before anything is read.
        POST: global(async (req, u) => {
          if (!canCrossApp(u)) return forbidden("the cross-app view needs cross_app_safety@* or admin@*");
          const pv = peopleView();
          if (pv instanceof Response) return pv;
          const id = decodeURIComponent(req.params.id!);
          const b = await req.json().catch(() => ({})) as { app?: string; reason?: string };
          const reason = String(b.reason ?? "").trim();
          if (!isAppId(b.app)) return json({ ok: false, error: `app must be one of ${APP_IDS.join(", ")}`, code: "unknown_app" }, 400);
          if (reason.length < PERSON_REASON_MIN) return json({ ok: false, error: `a reason (at least ${PERSON_REASON_MIN} characters) is required`, code: "reason_required" }, 400);
          const no = await record(u, b.app, { action: "open_person_app", targetType: "person", targetId: id, reason, ok: true });
          if (no) return no;
          const panel = await pv.panel(id, b.app);
          return panel ? json(panel) : json({ error: "no membership in that app" }, 404);
        }),
      },
      "/api/*": global(() => json({ error: "not found" }, 404)),
    },
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const site = siteCheck(req);
        if (site) return site;
        const app = appOf(req);
        if (app instanceof Response) return app;
        // A ticket from POST /api/ws-ticket (the browser), else the headers (Authorization, Cloudflare Access).
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
        if (ws.data.user.expiresAt !== undefined) setTimeout(() => { if (sockets.has(ws)) recheck(ws); }, Math.max(0, ws.data.user.expiresAt - Date.now()) + 50);
      },
      message() { /* the client sends commands over REST */ },
      close(ws: ServerWebSocket<WsData>) {
        sockets.delete(ws);
        ws.unsubscribe(TOPIC); ws.unsubscribe(appTopic(ws.data.app));
      },
    },
  });

  const checkTimer = setInterval(() => { for (const ws of sockets) recheck(ws); }, opts.socketCheckMs ?? 15_000);
  if (!LOOPBACK.has(hostname)) console.warn(`Observatory: listening on ${hostname}, not only on this machine. Anyone with a token can use the API.`);
  const url = `http://${ANY_INTERFACE.has(hostname) ? "127.0.0.1" : hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname}:${server.port}`;
  return {
    server, url, token: adminToken, openUrl: adminToken ? `${url}/#token=${encodeURIComponent(adminToken)}` : `${url}/`, mode: () => mode, source, setMode, audit, lab,
    async stop() {
      clearInterval(checkTimer);
      lab.dispose();
      stored?.stop();
      for (const [k, s] of sources) { unsub.get(k)?.(); await s.dispose(); }
      server.stop(true);
      await audit.close();
      await people?.close();
      await costs.close();
      await rolesSql?.close();
    },
  };
}

/** Command fields an audit row keeps as they are (ids, decisions, codes, numbers). Anything else a client sends is dropped (audit observatory-15). */
const AUDIT_FIELDS = new Set(["oppId", "memberId", "promptId", "decision", "reason", "on", "mode", "speed", "ms", "action", "participants", "category", "swapOut", "secondsSpent", "auto", "city", "seed", "engine", "personas", "days", "network", "scenario"]);
/** Free texts: only their length is kept. */
const AUDIT_TEXTS = new Set(["text", "objective", "note", "why"]);
const auditValue = (v: unknown): unknown =>
  typeof v === "string" ? v.slice(0, 200) : typeof v === "number" || typeof v === "boolean" || v === null ? v
    : Array.isArray(v) ? v.slice(0, 20).filter(x => typeof x === "string").map(x => (x as string).slice(0, 200)) : undefined;

/** What an audit row keeps about a command: ids, decisions and reason codes. Edited texts and notes are kept as lengths only. */
export function auditDetail(cmd: ControlCommand): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cmd)) {
    if (k === "explanations" && v && typeof v === "object") out.explanations = Object.keys(v).slice(0, 20).map(x => x.slice(0, 200));
    else if (AUDIT_TEXTS.has(k) && typeof v === "string") out[`${k}Length`] = v.length;
    else if (AUDIT_FIELDS.has(k)) { const x = auditValue(v); if (x !== undefined) out[k] = x; }
  }
  return out;
}

/** A safety action from the browser, checked: the action, its ids, and a note of at least 5 characters for hold, ban and dismiss. */
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
    city: { type: "string", default: "nyc" }, level: { type: "string" }, review: { type: "string", default: "auto" },
    "time-aware": { type: "boolean", default: false },
  } });
  if (a.review !== "auto" && a.review !== "human") { console.error("--review must be auto or human"); process.exit(1); }
  const obs = await createServer({
    port: Number(a.port), mode: a.mode as Mode,
    game: { seed: Number(a.seed), personas: Number(a.personas), engine: a.engine as GameOptions["engine"], days: Number(a.days), network: a.network as "consent" | "stub", city: a.city as "nyc" | "all", scenario: a.level ?? null, review: a.review, timeAware: a["time-aware"] },
    real: { url: a["db-url"] },
  });
  console.log(`The Network Observatory → ${obs.openUrl}  (mode: ${obs.mode()}${process.env.OBSERVATORY_REAL_ONLY === "1" ? ", real only" : ""})`);
}
