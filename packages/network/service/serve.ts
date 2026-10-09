// The service's two HTTP servers, its tick loop, and the MCP server mounted on it. Shared by main.ts,
// the shared backend (deploy/backend/server.ts) and scripts/platform-dev.ts (local dev).
import { createMcpHandler, devHostMap, defaultApps, defaultHostMap, isMcpAppId, type McpApp, type McpAppId, type McpHandler, MemoryOAuthStore, PgOAuthStore, platformHooks } from "../../mcp/src/index.ts";
import { devShortcutsAllowed, type Env } from "../../platform/src/env.ts";
import { CloudflareTurnstile } from "../../platform/src/turnstile.ts";
import { isAppId, siteHosts } from "../../platform/src/apps.ts";
import type { NetworkService } from "./service.ts";

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
  const dev = devShortcutsAllowed(env);
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  if (!dev && (!siteKey || !env.TURNSTILE_SECRET_KEY || !o.databaseUrl)) {
    log("MCP server off: it needs TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY and a database outside PLATFORM_ENV=dev");
    return undefined;
  }
  const store = o.databaseUrl ? new PgOAuthStore(o.databaseUrl) : new MemoryOAuthStore();
  // The migration runner applies the oauth schema (9001); a deployed service login has no CREATE right.
  if (store instanceof PgOAuthStore && o.migrate !== false) await store.migrate();
  const api = svc.publicApi;
  const apps = defaultApps();
  const issuer = (a: McpApp) => (dev && o.devOrigins?.[a.id]) || `https://${a.domain}`;
  const hostMap = dev ? { ...defaultHostMap(apps), ...devHostMap() } : defaultHostMap(apps);
  const mcp = createMcpHandler({
    platform: platformHooks({
      store: svc.people, otp: api.otp, accounts: api.accounts, sessions: api.sessions,
      app: id => svc.apps[id],
      // The same cookie as the platform API (packages/platform/src/api.ts): sid_<app> in dev, __Host-sid elsewhere.
      cookieName: id => (dev ? `sid_${id}` : "__Host-sid"), secureCookie: !dev,
      // submit_profile: the person's own profile, from their own agent, to their own member (decision 10).
      submitProfile: (personId, app, e164, text) => (isAppId(app) ? svc.submitProfile(personId, app, e164, text) : Promise.resolve("not_member" as const)),
      // get_updates and the inbox's surface signals (packages/notify; entry-flows doc 5).
      ...(svc.notify ? {
        updates: (personId, app, assistant, token) => (isAppId(app) ? svc.updatesFor(personId, app, assistant, token) : Promise.resolve([])),
        assistantLinked: (personId, assistant, active) => svc.assistantLinked(personId, assistant, active),
      } : {}),
      // "<assistant> is now connected ... Reply DISCONNECT" in the person's thread on that app (PRD 11.5).
      assistantConnected: (personId, app, assistant) => (isAppId(app) ? svc.assistantConnected(personId, app, assistant) : Promise.resolve()),
    }),
    store, issuer, hostMap, env, proxySecret: o.proxySecret, log, now: o.now ?? (() => svc.clock.now()),
    // The token's hostname must be one of that site's hosts (as on the platform API), never another site.
    turnstile: siteKey && env.TURNSTILE_SECRET_KEY ? { siteKey, verify: (t, ip, app) => new CloudflareTurnstile(env.TURNSTILE_SECRET_KEY!).verify(t, ip, dev ? undefined : app ? siteHosts(app) : []) } : undefined,
  });
  // DISCONNECT by text, the export's assistants, and a phone change that moves the grants (F25).
  svc.useAssistants({
    list: (e164, app) => (isMcpAppId(app) ? mcp.assistantsOf(e164, app) : Promise.resolve([])),
    disconnect: (e164, app, grantId) => (isMcpAppId(app) ? mcp.disconnect(e164, app, grantId) : Promise.resolve(false)),
    rekeyPhone: (oldE164, newE164) => mcp.rekeyPhone(oldE164, newE164),
  });
  svc.onForget(async ctx => {
    // Leaving an app (or deleting everything) also deletes the grants: no row keeps the phone next to the app.
    if (isMcpAppId(ctx.app.id)) await mcp.revokeAllFor(ctx.e164, ctx.app.id, { forget: true });
  });
  return mcp;
}

const TICK_MS = 60_000;

/** The staff and webhook server (default 127.0.0.1:4848) and the public API the sites call (default 127.0.0.1:8790). */
export function serveService(svc: NetworkService, o: { host: string; port: number; apiPort: number; log?: (s: string) => void }) {
  const log = o.log ?? console.log;
  // Bodies are checked before they are read (audit network-service-17): webhooks 256 KB, the public API 16 KB.
  const server = Bun.serve({ hostname: o.host, port: o.port, fetch: svc.fetch, maxRequestBodySize: 256 * 1024 });
  log(`listening on http://${o.host}:${server.port} (POST /webhooks/blooio[/:app], GET /health, GET /review, POST /review/:oppId, POST /safety/lift, POST /safety/close, POST /matching; ?app= or /apps/:app/...)`);
  // The server is passed on: the client IP for the rate limits is the socket address unless a trusted proxy header is configured.
  const api = Bun.serve({ hostname: o.host, port: o.apiPort, fetch: (req, server) => svc.publicFetch(req, server), maxRequestBodySize: 16 * 1024 });
  log(`public API on http://${o.host}:${api.port}/api/* (the app comes from the Host header)`);
  return { server, api, stop: () => { server.stop(); api.stop(); } };
}

/** Every network ticks once a minute on its own: a slow network never holds back another one. */
export function startTicks(svc: NetworkService, log: (s: string) => void = console.log) {
  const busy = new Set<string>();
  const loop = async () => {
    await Promise.all([...svc.runtimes.values()].map(async rt => {
      if (busy.has(rt.id)) return;
      busy.add(rt.id);
      try { if (!(await rt.tick())) log(`${rt.id}: tick skipped: another instance holds the lock`); }
      catch (e) { log(`${rt.id}: tick failed: ${(e as Error).message}`); }
      finally { busy.delete(rt.id); }
    }));
    await svc.purge();
    try { await svc.notifyTick(); } catch (e) { log(`notify: tick failed: ${(e as Error).message}`); }
  };
  let running: Promise<void> = loop();
  const first = running;
  const timer = setInterval(() => { running = loop(); }, TICK_MS);
  // stop() waits for the tick in flight, so a shutdown commits and delivers before the pool closes.
  return { first, stop: async () => { clearInterval(timer); await running.catch(() => {}); } };
}
