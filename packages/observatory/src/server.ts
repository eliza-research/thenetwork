#!/usr/bin/env bun
// The Network Observatory server: game mode (live simulated world) and real-world mode (Postgres),
// switchable at runtime. REST for state and details, a WebSocket for live deltas, and the web UI.
//   bun run packages/observatory/src/server.ts [--port 4747] [--mode game|real] [--seed 1]
//       [--personas 0] [--engine engine-v1|random|off] [--db-url postgres://...] [--review auto|human] [--time-aware]
// Security (audit P1-1, admin-console 4): it binds to 127.0.0.1 (OBSERVATORY_HOST overrides). Every
// /api/* route and the /ws upgrade need a staff identity: a static token ("Authorization: Bearer
// <token>" or "?token=<token>") from OBSERVATORY_TOKENS (role:token,...) or OBSERVATORY_TOKEN (an
// admin token; else a random admin token printed at startup), or Cloudflare Access SSO
// (OBSERVATORY_TRUST_CF_ACCESS=1, OBSERVATORY_ROLES=email:role,..., and the Access JWT verified with
// OBSERVATORY_CF_ACCESS_TEAM and OBSERVATORY_CF_ACCESS_AUD). See src/staff.ts. Each route
// and each command checks the caller's roles on the server. Requests with a Host other than
// localhost (DNS rebinding) or a foreign Origin (cross-site WebSocket hijacking) are refused, unless
// OBSERVATORY_ALLOWED_ORIGINS (comma-separated origins) lists them. The page "/" is public.
// OBSERVATORY_REAL_ONLY=1 (production build): game mode, every game control and the lab are off.
// Four apps (platform plan section 5): every /api route and the WebSocket take ?app=ntwrk|slop|peon|buddies
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
import { SCENARIOS } from "@thenetwork/network/harness";
import { Lab, validateLab, type LabOptions } from "./lab.ts";
import { runDiff } from "./runDiff.ts";
import { SQL } from "bun";
import { APP_IDS, consoleApps, DEFAULT_APP, isAppId, slaHours, toNetworkReason, type AppId } from "./apps.ts";
import { appHealth } from "./health.ts";
import { PeopleView, peopleUrl } from "./people.ts";
import {
  AccessVerifier, allowed, appsFor, authenticateStaff, canCrossApp, createAudit, hasEverywhere, parseRoles, parseTokenGrants, PgStaffRoles, rolesFor,
  type AccessConfig, type AuditSink,
} from "./staff.ts";
import { GameSource, type GameOptions } from "./sources/game.ts";
import { HIDDEN_MESSAGE, RealSource, type RealOptions } from "./sources/real.ts";
import type { DataSource } from "./sources/source.ts";
import type { AppHealth, AuditEntry, ControlCommand, EnvInfo, Mode, ObsDelta, RevealGrant, SafetyAction, StaffRole, StaffUser } from "./types.ts";

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
}

export interface ObservatoryServer {
  server: Server<unknown>; url: string;
  /** The admin token (if there is one), and the page URL that carries it (?token=). */
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

/**
 * Who may send each command, for the request's app (admin for the app may send all). Game controls
 * are the simulation lab: reviewers and safety staff train there, engineers work there; analysts
 * only look. The truth lens shows hidden persona truth (private disclosures), so it is safety or
 * admin, like a PII reveal. Review mode, the matching switch and reset are admin only.
 */
const SIM: readonly StaffRole[] = ["reviewer", "safety", "engineer"];
export const CONTROL_ROLES: Record<ControlCommand["type"], readonly StaffRole[]> = {
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

  const broadcast = (m: Mode, app: AppId, d: ObsDelta) => {
    if (m !== mode || !server) return;
    if (!d.reset && !d.members && !d.edges && !d.opportunities && !d.feed && !d.stats && !d.engineRuns && !d.env && !d.removedOpportunities && !d.game && !d.requests && !d.network) {
      server.publish(appTopic(app), JSON.stringify({ type: "clock", app, clock: d.clock, version: d.version }));
      return;
    }
    server.publish(appTopic(app), JSON.stringify({ type: "delta", mode: m, app, delta: withAuth(d) }));
  };

  async function source(m: Mode = mode, app: AppId = DEFAULT_APP): Promise<DataSource> {
    if (m === "game" && realOnly) throw new Error("game mode is off on this server (OBSERVATORY_REAL_ONLY=1)");
    const k = key(m, app);
    const have = sources.get(k);
    if (have) return have;
    if (!starting.has(k)) starting.set(k, (async () => {
      const s: DataSource = m === "game"
        ? new GameSource({ ...opts.game, app })
        : new RealSource({ ...opts.real, app, ...(opts.real?.appUrls?.[app] ? { appUrl: opts.real.appUrls[app] } : {}) });
      await s.init();
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
    server?.publish(TOPIC, JSON.stringify({ type: "mode", mode: m }));
  }

  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

  // ---------------------------------------------------------------- staff access (admin-console 4)
  const hostname = opts.hostname ?? process.env.OBSERVATORY_HOST ?? "127.0.0.1";
  const tokens = parseTokenGrants(opts.tokens ?? process.env.OBSERVATORY_TOKENS, { explicitApp: process.env.NODE_ENV === "production" || process.env.PLATFORM_ENV === "production" });
  const trustCfAccess = opts.trustCfAccess ?? process.env.OBSERVATORY_TRUST_CF_ACCESS === "1";
  const roles = parseRoles(opts.roles ?? process.env.OBSERVATORY_ROLES);
  const adminToken = opts.token ?? process.env.OBSERVATORY_TOKEN ?? (tokens.size || trustCfAccess ? undefined : randomBytes(24).toString("base64url"));
  if (adminToken) { const list = tokens.get(adminToken) ?? []; if (!list.some(g => g.role === "admin" && g.app === "*")) list.push({ role: "admin", app: "*" }); tokens.set(adminToken, list); }
  // The Access email is trusted only from a verified JWT: without the team and the audience, refuse to start.
  const access = trustCfAccess ? new AccessVerifier({
    ...opts.cfAccess, team: opts.cfAccess?.team ?? process.env.OBSERVATORY_CF_ACCESS_TEAM ?? "", aud: opts.cfAccess?.aud ?? process.env.OBSERVATORY_CF_ACCESS_AUD ?? "",
  }) : undefined;
  // platform.staff_roles (SSO users, real mode): read through the real-mode database.
  const rolesUrl = opts.staffRolesUrl === false ? undefined : opts.staffRolesUrl ?? (trustCfAccess && (realOnly || mode === "real") ? opts.real?.url ?? process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL : undefined);
  const rolesSql = rolesUrl ? new SQL({ url: rolesUrl, max: 1, idleTimeout: 30, connection: { default_transaction_read_only: "on", application_name: "network-observatory-roles" } }) : undefined;
  const stored = rolesSql ? new PgStaffRoles(rolesSql) : undefined;
  await stored?.start();
  const auth = { tokens, trustCfAccess, roles, access, stored };
  const audit: AuditSink = opts.audit && "write" in opts.audit ? opts.audit : createAudit(opts.audit as { url?: string; dir?: string } | undefined);
  const lab = new Lab(opts.lab);
  const pUrl = opts.peopleUrl === false ? undefined : opts.peopleUrl ?? opts.real?.url ?? peopleUrl();
  let people: PeopleView | undefined;
  /** Active PII reveals: "<staff id>|<app>|<member id>" -> grant. In memory: a restart ends every reveal. */
  const reveals = new Map<string, RevealGrant>();
  /** "<staff id>|<app>" with the truth lens on (game mode). Per person: hidden truth never goes to anyone else. */
  const lensOn = new Set<string>();
  const truthFor = (u: StaffUser, app: AppId) => mode === "game" && lensOn.has(`${u.id}|${app}`) && allowed(u, CONTROL_ROLES.lens, app, mode);

  const allowedOrigins = new Set((opts.allowedOrigins ?? (process.env.OBSERVATORY_ALLOWED_ORIGINS ?? "").split(","))
    .map(o => o.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean));
  const allowedHosts = new Set([...LOOPBACK, ...[...allowedOrigins].map(hostnameOf).filter((h): h is string => !!h)]);
  if (!ANY_INTERFACE.has(hostname)) allowedHosts.add(hostname.toLowerCase());

  /** Who is calling, or why the request is refused (a Response). Host and Origin first. */
  async function identify(req: Request): Promise<StaffUser | Response> {
    const host = req.headers.get("host") ?? "";
    const name = hostnameOf(host);
    if (!name || !allowedHosts.has(name)) return json({ error: "host not allowed" }, 403);
    const origin = req.headers.get("origin");
    if (origin !== null) {
      const o = origin.replace(/\/+$/, "").toLowerCase();
      const own = `${new URL(req.url).protocol}//${host}`.toLowerCase();
      if (o !== own && !allowedOrigins.has(o)) return json({ error: "origin not allowed" }, 403);
    }
    const a = await authenticateStaff(req, auth);
    if ("user" in a) return a.user;
    return Response.json({ error: a.error }, { status: a.status, headers: { "cache-control": "no-store", ...(a.status === 401 ? { "www-authenticate": "Bearer" } : {}) } });
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
    try { return await h(req, u, app); } catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
  };
  /** A route that is not about one app: any staff member, or with `need`, the role for every app (role@*). */
  const global = (h: (req: Req, user: StaffUser) => Response | Promise<Response>, need?: readonly StaffRole[]) => async (req: Req) => {
    const u = await identify(req);
    if (u instanceof Response) return u;
    if (need && !allowed(u, need)) return forbidden(`needs ${["admin", ...need].map(r => `${r}@*`).join(" or ")}`);
    try { return await h(req, u); } catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500); }
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
    const k = `${u.id}|${app}|${memberId}`, g = reveals.get(k);
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
      "/api/levels": global(() => json(realOnly ? [] : SCENARIOS.map(x => ({ id: x.id, title: x.title, description: x.description, days: x.days })))),
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
      "/api/state": guard(async (_r, u, app) => json(withAuth((await source(mode, app)).state({ truth: truthFor(u, app) })))),
      "/api/member/:id": guard(async (req, u, app) => {
        const id = decodeURIComponent(req.params.id!);
        if (!(await canSeeMember(u, app, id))) return forbidden("this role cannot open this member");
        const grant = revealFor(u, app, id);
        const no = await record(u, app, { action: "read_member", targetType: "member", targetId: id, ok: true, ...(grant ? { detail: { revealed: true } } : {}) });
        if (no) return no;
        const d = await (await source(mode, app)).member(id, { reveal: !!grant, truth: truthFor(u, app) });
        if (!d) return json({ error: "not found" }, 404);
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
      "/api/opportunity/:id": guard(async (req, u, app) => {
        const id = decodeURIComponent(req.params.id!);
        const no = await record(u, app, { action: "read_opportunity", targetType: "opportunity", targetId: id, ok: true });
        if (no) return no;
        const d = await (await source(mode, app)).opportunity(id, { truth: truthFor(u, app) });
        if (!d) return json({ error: "not found" }, 404);
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
        GET: guard((_r, u, app) => json([...reveals.entries()].filter(([k, g]) => k.startsWith(`${u.id}|${app}|`) && g.until > Date.now()).map(([, g]) => g))),
        POST: guard(async (req, u, app) => {
          const b = await req.json().catch(() => ({})) as { memberId?: string; reason?: string; minutes?: number };
          const memberId = String(b.memberId ?? ""), reason = String(b.reason ?? "").trim();
          if (!memberId || reason.length < 5) return json({ ok: false, error: "a member and a reason (at least 5 characters) are required" }, 400);
          const s = await source(mode, app);
          if (!s.state().members.some(m => m.id === memberId)) return json({ ok: false, error: "unknown member" }, 404);
          const minutes = Math.min(REVEAL_MAX_MINUTES, Math.max(1, Math.round(Number(b.minutes) || REVEAL_MAX_MINUTES)));
          const at = Date.now(), grant: RevealGrant = { memberId, reason, at, until: at + minutes * 60_000 };
          const no = await record(u, app, { action: "reveal", targetType: "member", targetId: memberId, reason, ok: true, detail: { minutes } });
          if (no) return no;
          reveals.set(`${u.id}|${app}|${memberId}`, grant);
          return json({ ok: true, ...grant });
        }, ["safety"]),
      },
      "/api/control": {
        POST: guard(async (req, u, app) => {
          let cmd = await req.json().catch(() => null) as ControlCommand | null;
          if (!cmd || typeof cmd.type !== "string") return json({ ok: false, error: "bad command" }, 400);
          const need = CONTROL_ROLES[cmd.type];
          if (!need) return json({ ok: false, error: `unknown command ${cmd.type}` }, 400);
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
          // Staff actions are audited before they run; the result follows in a second row.
          if (!QUIET.has(cmd.type)) { const no = await record(u, app, { action: cmd.type, ...target, ok: true, detail: { ...detail, phase: "requested" } }); if (no) return no; }
          const r = await (await source(mode, app)).control(cmd, u.id);
          if (r.ok && cmd.type === "lens") { if (cmd.on) lensOn.add(`${u.id}|${app}`); else lensOn.delete(`${u.id}|${app}`); }
          if (r.ok && cmd.type === "reset") for (const k of [...lensOn]) if (k.endsWith(`|${app}`)) lensOn.delete(k);
          // The result row is best effort: the action already ran, and its "requested" row is written.
          if (!QUIET.has(cmd.type)) await record(u, app, { action: cmd.type, ...target, ok: r.ok, detail: { ...detail, phase: "result", ...(r.code ? { code: r.code } : {}) } });
          return json(r, r.ok ? 200 : 409);
        }),
      },
      "/api/safety": {
        GET: guard(async (_r, _u, app) => json(await (await source(mode, app)).safety()), ["safety"]),
        POST: guard(async (req, u, app) => {
          const a = await req.json().catch(() => null) as SafetyAction | null;
          if (!a || (a.action !== "lift" && a.action !== "close")) return json({ ok: false, error: "action must be lift or close" }, 400);
          const target = a.action === "lift" ? { targetType: "member" as const, targetId: a.memberId } : { targetType: "case" as const, targetId: a.caseId };
          const no = await record(u, app, { action: `safety_${a.action}`, ...target, ok: true, ...(a.note ? { reason: a.note } : {}), detail: { phase: "requested" } });
          if (no) return no;
          const r = await (await source(mode, app)).safetyAction(a, u.id);
          await record(u, app, { action: `safety_${a.action}`, ...target, ok: r.ok, detail: { phase: "result", ...(r.code ? { code: r.code } : {}) } });
          return json(r, r.ok ? 200 : 409);
        }, ["safety"]),
      },
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
          const no = await record(u, app, { action: "lab_run", targetType: "run", ok: true, detail: { ...v } });
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
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        return identify(req).then(u => {
          if (u instanceof Response) return u;
          const app = appOf(req);
          if (app instanceof Response) return app;
          if (!rolesFor(u, app, mode).size) return forbidden(`no role for ${app}`);
          return srv.upgrade(req, { data: { app } }) ? undefined : new Response("upgrade failed", { status: 400 });
        });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws: ServerWebSocket<unknown>) {
        const app = (ws.data as { app?: AppId } | undefined)?.app ?? DEFAULT_APP;
        ws.subscribe(TOPIC); ws.subscribe(appTopic(app));
        ws.send(JSON.stringify({ type: "hello", mode, app }));
      },
      message() { /* the client sends commands over REST */ },
      close(ws: ServerWebSocket<unknown>) {
        const app = (ws.data as { app?: AppId } | undefined)?.app ?? DEFAULT_APP;
        ws.unsubscribe(TOPIC); ws.unsubscribe(appTopic(app));
      },
    },
  });

  if (!LOOPBACK.has(hostname)) console.warn(`Observatory: listening on ${hostname}, not only on this machine. Anyone with a token can use the API.`);
  const url = `http://${ANY_INTERFACE.has(hostname) ? "127.0.0.1" : hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname}:${server.port}`;
  return {
    server, url, token: adminToken, openUrl: adminToken ? `${url}/?token=${encodeURIComponent(adminToken)}` : `${url}/`, mode: () => mode, source, setMode, audit, lab,
    async stop() {
      lab.dispose();
      stored?.stop();
      for (const [k, s] of sources) { unsub.get(k)?.(); await s.dispose(); }
      server.stop(true);
      await audit.close();
      await people?.close();
      await rolesSql?.close();
    },
  };
}

/** What an audit row keeps about a command: ids, decisions and reason codes. Edited texts and notes are kept as lengths only. */
function auditDetail(cmd: ControlCommand): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cmd)) {
    if (k === "type") continue;
    if (k === "explanations" && v && typeof v === "object") out.explanations = Object.keys(v);
    else if ((k === "text" || k === "objective" || k === "note" || k === "why") && typeof v === "string") out[`${k}Length`] = v.length;
    else if (v === null || ["string", "number", "boolean"].includes(typeof v) || Array.isArray(v)) out[k] = v;
  }
  return out;
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
