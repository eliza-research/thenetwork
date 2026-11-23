import { serveHttp } from "../../core/src/runtime/http.ts";
// The service's two HTTP servers, its tick loop, and the MCP server mounted on it. Shared by main.ts,
// the shared backend (deploy/backend/server.ts) and scripts/platform-dev.ts (local dev).
import { createMcpHandler, devHostMap, defaultApps, defaultHostMap, isMcpAppId, type McpApp, type McpAppId, type McpHandler, MemoryOAuthStore, PgOAuthStore, platformHooks } from "../../mcp/src/index.ts";
import { devShortcutsAllowed, type Env } from "../../platform/src/env.ts";
import { CloudflareTurnstile } from "../../platform/src/turnstile.ts";
import { isAppId, siteHosts, stagingSiteOrigins } from "../../platform/src/apps.ts";
import type { NetworkService } from "./service.ts";
import { PHOTO_RELAY_TEXT } from "./photoRelayFlow.ts";

export interface ServiceMcpOptions {
  /** The Postgres for the oauth schema (packages/mcp/db/oauth.sql, applied here). Undefined: memory (tests and dev only). */
  databaseUrl?: string;
  /** PLATFORM_PROXY_SECRET: only a request a site router signed names the site (and so the app). */
  proxySecret?: string;
  /** Local dev: each app's site origin (http://127.0.0.1:5102). It is the issuer and the MCP resource of that app. */
  devOrigins?: Partial<Record<McpAppId, string>>;
  env?: Env;
  log?: (s: string) => void;
  /** Default: the service's clock, so the proxy signature, OTP and token times all agree. */
  now?: () => number;
  /** false: the migration runner has applied the oauth schema (deployed: the service login cannot create it). */
  migrate?: boolean;
  /** Owned dev-only private ChatGPT pilot. Public /mcp/openai is unchanged. Default off. */
  privateOpenAiApps?: readonly McpAppId[];
}

/**
 * The MCP server and its OAuth server (packages/mcp) on the service's own platform parts: the same
 * people store, OTP service, accounts and sessions as the sites' /api/*. So a person signed in on a
 * site is signed in on its authorize page too, and the same OTP limits apply. When a person leaves an
 * app or deletes everything, every OAuth grant of that app is revoked.
 *
 * Outside dev it needs TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY (the authorize page sends a code, so
 * it gets the same bot check as the join page) and a database. Without them it returns undefined and
 * every MCP path answers 404 mcp_not_enabled: fail closed.
 */
export async function createServiceMcp(svc: NetworkService, o: ServiceMcpOptions = {}): Promise<McpHandler | undefined> {
  const env = o.env ?? process.env;
  const log = o.log ?? console.log;
  const now = o.now ?? (() => svc.clock.now());
  const dev = devShortcutsAllowed(env);
  const stageOrigins = stagingSiteOrigins(env);
  const privateOpenAiApps = o.privateOpenAiApps ?? (env.MCP_PRIVATE_OPENAI_APPS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (privateOpenAiApps.some(id => !isMcpAppId(id))) throw new Error("MCP_PRIVATE_OPENAI_APPS must name existing apps");
  if (privateOpenAiApps.length && !dev) throw new Error("MCP_PRIVATE_OPENAI_APPS is for an owned dev runtime only");
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  if (!dev && (!siteKey || !env.TURNSTILE_SECRET_KEY || !o.databaseUrl)) {
    log("MCP server off: it needs TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY and a database outside PLATFORM_ENV=dev");
    return undefined;
  }
  const store = o.databaseUrl ? new PgOAuthStore(o.databaseUrl, async (tx, owner) => {
    // Share the platform join fence for a still-unattached phone. Do not wait on
    // platform rows while holding the grant lock that a number move can need.
    const [joinLock] = await tx`select pg_try_advisory_xact_lock(hashtext(${`platform:join:${owner.e164}`})) as locked`;
    if (!joinLock?.locked) return false;
    const [session] = await tx`select expires_at,revoked_at from platform.sessions where token_hash=${owner.sessionHash}
      and app_id=${owner.app} and e164=${owner.e164} and (person_id is null or person_id::text=${owner.personId}) for share nowait`;
    if (!session) return false;
    const [phone] = await tx`select person_id,hold from platform.phone_identities where e164=${owner.e164} for share nowait`;
    if (phone?.hold || (phone?.person_id ?? null) !== owner.personId) return false;
    if (owner.personId) {
      const [person] = await tx`select 1 from platform.people where id=${owner.personId}::uuid and deleted_at is null
        and phone_hash=${owner.phoneKey} for share nowait`;
      if (!person) return false;
    }
    const at = owner.now();
    return new Date(session.expires_at).getTime() > at && (session.revoked_at === null || new Date(session.revoked_at).getTime() > at);
  }) : new MemoryOAuthStore();
  // The migration runner applies the oauth schema (9001); a deployed service login has no CREATE right.
  if (store instanceof PgOAuthStore && o.migrate !== false) await store.migrate();
  const api = svc.publicApi;
  const apps = defaultApps();
  for (const [id, origin] of Object.entries(stageOrigins)) {
    const a = apps[id as McpAppId];
    a.domain = new URL(origin).host;
    for (const key of ["site", "join", "privacy", "terms", "smsTerms"] as const) if (a.links[key]) {
      const link = new URL(a.links[key]!);
      a.links[key] = origin + link.pathname.replace(/\/$/, "") + link.search + link.hash;
    }
  }
  const issuer = (a: McpApp) => stageOrigins[a.id] || (dev && o.devOrigins?.[a.id]) || `https://${a.domain}`;
  const hostMap = dev ? { ...defaultHostMap(apps), ...devHostMap() } : defaultHostMap(apps);
  for (const [id, origin] of Object.entries(stageOrigins)) {
    for (const [host, owner] of Object.entries(hostMap)) if (owner === id) delete hostMap[host];
    hostMap[new URL(origin).host] = id as McpAppId;
  }
  const mcp = createMcpHandler({
    apps,
    platform: platformHooks({
      store: svc.people, otp: api.otp, accounts: api.accounts, sessions: api.sessions,
      authenticatedSiteSession: (app,req)=>api.authenticatedSiteSession(app,req),
      cloudAuthorityRequired: app=>isAppId(app) && api.cloudAuthorityRequired(app),
      beginCloudOAuth: (app,rid)=>isAppId(app)?api.beginCloudOAuth(app,rid):Promise.resolve(undefined),
      cloudGrantAuthority: (app,req,resource)=>isAppId(app)?api.cloudGrantAuthority(app,req,resource):Promise.resolve(undefined),
      validateCloudGrant: grant=>isAppId(grant.app)?api.validateCloudGrant(grant):Promise.resolve("invalid" as const),
      app: id => svc.apps[id],
      // The same cookie as the platform API (packages/platform/src/api.ts): sid_<app> in dev, __Host-sid elsewhere.
      cookieName: id => (dev ? `sid_${id}` : "__Host-sid"), secureCookie: !dev,
      submitProfile: (personId, app, e164, text) => (isAppId(app) ? svc.submitProfile(personId, app, e164, text) : Promise.resolve("not_member" as const)),
      lookingFor: (personId, app, e164) => (isAppId(app) ? svc.lookingFor(personId, app, e164) : Promise.resolve(undefined)),
      minorNotice: (personId, app, e164) => (isAppId(app) ? svc.minorNotice(personId, app, e164) : Promise.resolve(undefined)),
      changeLookingFor: (personId, app, e164, grantId, ref, change) => (isAppId(app)
        ? svc.changeLookingFor(personId, app, e164, grantId, ref, change) : Promise.resolve({ kind: "refused", reason: "not_member" } as const)),
      photoHoldings: (personId, app, e164) => (isAppId(app) ? svc.photoHoldings(personId, app, e164) : Promise.resolve(undefined)),
      photoRequest: (personId, app, e164, words) => (isAppId(app) ? svc.photoRequest(personId, app, e164, words)
        : Promise.resolve({ status: "unavailable" as const, text: PHOTO_RELAY_TEXT.unavailable })),
      // get_updates and the inbox's surface signals (packages/notify; entry-flows doc 5).
      ...(svc.notify ? {
        updates: (personId, app, assistant, token, passesLeakGate) => (isAppId(app) ? svc.updatesFor(personId, app, assistant, token, passesLeakGate) : Promise.resolve([])),
        assistantLinked: (personId, assistant, active) => svc.assistantLinked(personId, assistant, active),
      } : {}),
    }),
    store, issuer, hostMap, env, privateOpenAiApps: privateOpenAiApps as McpAppId[], proxySecret: o.proxySecret, log, now,
    // The token's hostname must be one of that site's hosts (as on the platform API), never another site.
    turnstile: siteKey && env.TURNSTILE_SECRET_KEY ? { siteKey, verify: (t, ip, app) => new CloudflareTurnstile(env.TURNSTILE_SECRET_KEY!).verify(t, ip, dev ? undefined : app ? siteHosts(app, env) : []) } : undefined,
  });
  svc.notify?.setAssistantUpdatesLookup((personId, app) => isMcpAppId(app) ? mcp.assistantUpdateSurfaces(personId, app) : Promise.resolve([]));
  if (store instanceof PgOAuthStore) {
    svc.setNotificationClaimSurfaces(async (tx, personId, phoneKey, app) => isMcpAppId(app)
      ? mcp.assistantUpdateSurfacesForClaim(await store.assistantGrantsForClaim(tx, personId, phoneKey, app, now()))
      : []);
  }
  svc.onForget(async ctx => {
    // Leaving an app (or deleting everything) also deletes the grants: no row keeps the phone next to the app.
    if (isMcpAppId(ctx.app.id)) await mcp.forgetPerson(ctx.personId, ctx.app.id);
  });
  svc.onEraseAccount(personId => mcp.forgetPerson(personId));
  svc.onBan(phoneHashes => mcp.discardSignupDrafts(phoneHashes));
  for (const accounts of new Set([svc.accounts, api.accounts])) {
    accounts.setAgeRecordedListener(phoneHash => mcp.discardAgeRefusedSignupDrafts(phoneHash)
      .catch((e: unknown) => log(`[mcp] signup draft age check failed: ${(e as Error).message}`)));
  }
  return mcp;
}

const TICK_MS = 60_000;

export const isBlooioWebhookPath = (path: string) => path === "/webhooks/blooio" || path.startsWith("/webhooks/blooio/");

export async function serveService(svc: NetworkService, o: { host: string; port: number; apiPort: number; blooioWebhook: boolean; log?: (s: string) => void }) {
  const log = o.log ?? console.log;
  const fetch = (req: Request) => !o.blooioWebhook && isBlooioWebhookPath(new URL(req.url).pathname)
    ? Response.json({ ok: false, error: "webhook_not_served" }, { status: 404 })
    : svc.fetch(req);
  // Bodies are checked before they are read (audit network-service-17): webhooks 256 KB, the public API 16 KB.
  const server = await serveHttp({ hostname: o.host, port: o.port, fetch, maxRequestBodySize: 256 * 1024 });
  log(`listening on http://${o.host}:${server.port} (${o.blooioWebhook ? "POST /webhooks/blooio[/:app], " : ""}GET /health, GET /review, POST /review/:oppId, POST /safety/lift, POST /safety/close, POST /matching; ?app= or /apps/:app/...)`);
  // The server is passed on: the client IP for the rate limits is the socket address unless a trusted proxy header is configured.
  const api = await serveHttp({ hostname: o.host, port: o.apiPort, fetch: (req, server) => svc.publicFetch(req, server), maxRequestBodySize: 16 * 1024 });
  log(`public API on http://${o.host}:${api.port}/api/* (the app comes from the Host header)`);
  return { server, api, stop: () => { server.stop(); api.stop(); } };
}

export function startTicks(svc: NetworkService, log: (s: string) => void = console.log) {
  const busy = new Set<string>();
  const worker = async (key: string, work: () => Promise<unknown>) => {
    if (busy.has(key)) return;
    busy.add(key);
    try { await work(); }
    catch (e) { log(`${key}: tick failed: ${(e as Error).message}`); }
    finally { busy.delete(key); }
  };
  let inbox: Promise<void> = Promise.resolve();
  let judging: Promise<void> = Promise.resolve();
  const inboxThenNetworks = async () => {
    if (!busy.has("inbox")) inbox = worker("inbox", () => svc.inboxTick());
    await inbox;
    await judging;
    await Promise.all([...svc.runtimes.values()].map(rt => worker(rt.id, async () => {
      if (!(await rt.tick())) log(`${rt.id}: tick skipped: another instance holds the lock`);
    })));
  };
  const inFlight = new Set<Promise<void>>();
  const round = () => {
    const done = Promise.all([
      inboxThenNetworks().then(() => {
        if (!busy.has("review_judge")) judging = worker("review_judge", () => svc.reviewJudgeTick());
        return judging;
      }),
      worker("retention", () => svc.purge()), worker("notify", () => svc.notifyTick()),
    ]).then(() => undefined);
    inFlight.add(done);
    void done.finally(() => inFlight.delete(done));
    return done;
  };
  const first = round();
  const timer = setInterval(round, TICK_MS);
  return { first, stop: async () => { clearInterval(timer); await Promise.allSettled([...inFlight]); } };
}
