#!/usr/bin/env bun
// The shared backend's entry point (docs/deploy.md; `bun run start:backend`).
//   bun run deploy/backend/server.ts [--port N] [--dry-run]
//
// 1. Checks the environment (backend.ts loadConfig; a deployed environment without its secrets stops here).
// 2. Applies pending migrations under the advisory lock (packages/observatory/db/migrate.ts). MIGRATE_ON_BOOT=0 skips.
// 3. Starts every network in platform.networks, the public port (PORT) and the private staff port (STAFF_PORT).
// 4. Ticks every network each minute. SIGTERM or SIGINT: finish the work in flight, release the locks, exit.
// Sends are dry-run unless NETWORK_CHANNEL=blooio, BLOOIO_ALLOW_SEND=1 and NTWRK_LIVE_APPROVED=1, and each
// app other than ntwrk also has its own <APP>_LIVE_APPROVED=1 (founder approval).
import { SQL } from "bun";
import { captureConsole, createBackend, ensureServiceLogin, ipOf, jsonLogger, loadConfig, MAX_PUBLIC_BODY_BYTES, serviceLoginProblem } from "./backend.ts";

// Structured, redacted logs from the first line: the rest is imported after console is captured.
const log = jsonLogger(undefined, { svc: "backend" });
captureConsole(log);
const { RealClock } = await import("../../packages/core/src/clock.ts");
const { BlooioClient } = await import("../../prototypes/messaging-blooio/src/blooio/client.ts");
const { BlooioAdapter: ProviderAdapter } = await import("../../prototypes/messaging-blooio/src/adapters/blooio-adapter.ts");
const { resolveSenderLine } = await import("../../prototypes/messaging-blooio/src/line.ts");
const { migrate } = await import("../../packages/observatory/db/migrate.ts");
const { BlooioAdapter, liveFlag, liveSendAllowed } = await import("../../packages/network/service/channel.ts");
const { NetworkService, webhookSecretsFromEnv } = await import("../../packages/network/service/service.ts");
const { createServiceMcp } = await import("../../packages/network/service/serve.ts");

async function main() {
  const c = loadConfig(process.env, process.argv);
  log.info("starting", { env: c.env, build: c.build, host: c.host, port: c.port, staffPort: c.staff?.port ?? null, channel: c.channel, migrateOnBoot: c.migrateOnBoot });
  for (const w of c.warnings) log.warn(w);

  if (c.migrateOnBoot) {
    const r = await migrate(c.migrationUrl, { lockTimeout: "60s", log: s => log.info(s) });
    log.info("migrations", { applied: r.applied.length, skipped: r.skipped.length });
  }
  // A new database says environment 'dev' (migration 0003) and the service refuses to start under any
  // other PLATFORM_ENV. PLATFORM_DB_ENVIRONMENT_INIT=1, set once on the first deploy (docs/deploy.md),
  // moves it from 'dev' to PLATFORM_ENV. It never changes a database that already says staging or production.
  if (c.deployed && process.env.PLATFORM_DB_ENVIRONMENT_INIT === "1") {
    const sql = new SQL({ url: c.migrationUrl, max: 1 });
    try {
      const r = await sql`update platform.settings set value = ${c.env} where key = 'environment' and value = 'dev' returning value`;
      log.info("database environment", { set: r.length ? c.env : "unchanged" });
      // The service login (docs/deploy.md 2.1): created once, from NETWORK_DATABASE_URL, so nobody types
      // its password into a console. An existing role is never changed.
      const made = await ensureServiceLogin(q => sql.unsafe(q), c.databaseUrl);
      log.info("service login", { role: made.role, created: made.created });
    } finally { await sql.close(); }
  }

  // Deployed: RLS and the grants must apply to the service login (never a superuser, BYPASSRLS or owner).
  if (c.deployed) {
    const sql = new SQL({ url: c.databaseUrl, max: 1 });
    try {
      const why = await serviceLoginProblem(q => sql.unsafe(q));
      if (why) throw new Error(`refusing to start: ${why}. Use a network_service login for NETWORK_DATABASE_URL (docs/deploy.md).`);
    } finally { await sql.close(); }
  }

  const clock = new RealClock();
  const svc = await NetworkService.fromDatabase({
    url: c.databaseUrl, clock, instance: process.env.NETWORK_SERVICE_INSTANCE ?? process.env.RAILWAY_REPLICA_ID ?? `${process.pid}`,
    tokens: process.env.NETWORK_SERVICE_TOKENS, consoleToken: process.env.NETWORK_SERVICE_CONSOLE_TOKEN,
    webhookSecret: process.env.BLOOIO_WEBHOOK_SECRET, webhookSecrets: webhookSecretsFromEnv(),
    auditUrl: process.env.NETWORK_SERVICE_AUDIT_DATABASE_URL,
    network: { seed: Number(process.env.NETWORK_SEED ?? 1) },
    // The backend decides the app and the client IP before the public API sees the request (backend.ts normalizeEdge).
    publicApi: { hostMap: c.hostMap, ipOf, trustForwardedHost: false },
    log: s => log.info(s),
    adapter: c.channel === "blooio" ? (net, rt) => {
      const from = resolveSenderLine();
      return new BlooioAdapter({ net, provider: new ProviderAdapter(new BlooioClient({ apiKey: process.env.BLOOIO_API_KEY! }), from), clock, memberOf: rt.memberOf, from, app: rt.app.id, city: rt.city });
    } : undefined,
  });
  await svc.start();
  for (const rt of svc.runtimes.values()) {
    const sends = c.channel === "blooio" ? (liveSendAllowed(process.env, rt.app.id) ? "live" : `refused (${liveFlag(rt.app.id)} is off)`) : "dry-run";
    log.info("network", { network: rt.id, sends, matching: rt.matchingAllowed ? "allowed" : "off" });
  }

  // The MCP server and its OAuth server on the service's own platform parts (packages/mcp). The oauth
  // schema is applied here. Off (404 mcp_not_enabled) without TURNSTILE_SITE_KEY outside dev.
  const mcp = await createServiceMcp(svc, { databaseUrl: c.databaseUrl, proxySecret: c.proxySecret, log: s => log.info(s), migrate: !c.deployed });
  log.info("mcp", { enabled: !!mcp });

  const pool = new SQL({ url: c.databaseUrl, max: 1, idleTimeout: 30, connection: { application_name: "network-backend-health" } });
  const backend = createBackend({
    svc, config: c, log,
    mcp: mcp && (req => mcp.fetch(req)),
    ping: async () => { await pool`select 1`; return true; },
  });

  const servers: { stop(force?: boolean): unknown }[] = [];
  // Bodies past 9 MB (a photo is at most 8 MB) are refused before they are read (Bun's default is 128 MB).
  const pub = Bun.serve({ hostname: c.host, port: c.port, maxRequestBodySize: MAX_PUBLIC_BODY_BYTES, fetch: (req, server) => backend.publicFetch(req, server) });
  servers.push(pub);
  log.info("listening", { port: "public", url: `http://${c.host}:${pub.port}` });
  if (c.staff) {
    const staff = Bun.serve({ hostname: c.staff.host, port: c.staff.port, fetch: req => backend.staffFetch(req) });
    servers.push(staff);
    log.info("listening", { port: "staff", url: `http://${c.staff.host.includes(":") ? `[${c.staff.host}]` : c.staff.host}:${staff.port}` });
  }

  const stop = async (signal: string) => {
    log.info("shutdown", { signal });
    const { clean } = await backend.shutdown(servers);
    await pool.close().catch(() => {});
    process.exit(clean ? 0 : 1);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
  await backend.startTicks();
}

main().catch(e => { log.error("start failed", { error: (e as Error).message }); process.exit(1); });
