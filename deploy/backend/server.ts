#!/usr/bin/env -S node --import=tsx
import { serveHttp } from "../../packages/core/src/runtime/http.ts";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { captureConsole, createBackend, ensureServiceLogin, ipOf, jsonLogger, liveSendTable, loadConfig, MAX_PUBLIC_BODY_BYTES, serviceLoginProblem, type PhotoRelayConfig } from "./backend.ts";
import type { PhotoRelayPolicy } from "../../packages/platform/src/photo-relay.ts";

const log = jsonLogger(undefined, { svc: "backend" });
captureConsole(log);
const { RealClock } = await import("../../packages/core/src/clock.ts");
const { BlooioClient } = await import("../../packages/blooio/src/blooio/client.ts");
const { BlooioAdapter: ProviderAdapter } = await import("../../packages/blooio/src/adapters/blooio-adapter.ts");
const { resolveSenderLine } = await import("../../packages/blooio/src/line.ts");
const { migrate } = await import("../../packages/observatory/db/migrate.ts");
const { CloudChannelAdapter } = await import("../../packages/network/service/cloud-channel.ts");
const { BlooioAdapter, liveSendAllowed } = await import("../../packages/network/service/channel.ts");
const { NetworkService, webhookSecretsFromEnv } = await import("../../packages/network/service/service.ts");
const { createServiceMcp } = await import("../../packages/network/service/serve.ts");
const { catalogMetrics, createOps, lineMetrics, PgAlertStore, runtimeProbe, turnWatchMetrics } = await import("./ops.ts");
const { createPublicEventRefresh } = await import("./public-events.ts");
const { photoRaterFromEnv } = await import("../../packages/platform/src/photos.ts");
const { setLeakLabelKey } = await import("../../packages/core/src/guard.ts");

function photoRelayPolicy(config: PhotoRelayConfig): PhotoRelayPolicy {
  const reviewers = new Set(config.reviewers);
  return { version: config.version, notice: config.notice, authorizeReviewer: async reviewerId => reviewers.has(reviewerId) };
}

async function main() {
  const c = loadConfig(process.env, process.argv);
  if (c.leakLabelKey) setLeakLabelKey(c.leakLabelKey);
  log.info("starting", { env: c.env, build: c.build, host: c.host, port: c.port, staffPort: c.staff?.port ?? null, channel: c.channel, migrateOnBoot: c.migrateOnBoot });
  for (const w of c.warnings) log.warn(w);

  if (c.migrateOnBoot) {
    const r = await migrate(c.migrationUrl, { lockTimeout: "60s", log: s => log.info(s) });
    log.info("migrations", { applied: r.applied.length, skipped: r.skipped.length });
  }
  if (c.deployed && process.env.PLATFORM_DB_ENVIRONMENT_INIT === "1") {
    const sql = new SQL({ url: c.migrationUrl, max: 1 });
    try {
      const r = await sql`update platform.settings set value = ${c.env} where key = 'environment' and value = 'dev' returning value`;
      log.info("database environment", { set: r.length ? c.env : "unchanged" });
      const made = await ensureServiceLogin(q => sql.unsafe(q), c.databaseUrl);
      log.info("service login", { role: made.role, created: made.created });
    } finally { await sql.close(); }
  }

  if (c.deployed) {
    const sql = new SQL({ url: c.databaseUrl, max: 1 });
    try {
      const why = await serviceLoginProblem(q => sql.unsafe(q));
      if (why) throw new Error(`refusing to start: ${why}. Use a network_service login for NETWORK_DATABASE_URL (docs/deploy.md).`);
    } finally { await sql.close(); }
  }

  const clock = new RealClock();
  const raterEnv = await photoRaterFromEnv(process.env, { log: s => log.warn(s) });
  const photoRater = raterEnv.rater;
  const raterLog = { status: raterEnv.status, rater: photoRater?.id ?? "off", weights: raterEnv.weights ?? null, detail: raterEnv.detail ?? null };
  if (raterEnv.status === "refused_weights") log.error("photo rater", raterLog); else log.info("photo rater", raterLog);
  const svc = await NetworkService.fromDatabase({
    photoRater,
    ...(c.photoRelay ? { photoRelayPolicy: photoRelayPolicy(c.photoRelay), photoDeliveryOrigin: c.photoRelay.deliveryOrigin } : {}),
    url: c.databaseUrl, clock, instance: process.env.NETWORK_SERVICE_INSTANCE ?? process.env.RAILWAY_REPLICA_ID ?? `${process.pid}`,
    tokens: process.env.NETWORK_SERVICE_TOKENS, consoleToken: process.env.NETWORK_SERVICE_CONSOLE_TOKEN,
    webhookSecret: process.env.BLOOIO_WEBHOOK_SECRET, webhookSecrets: webhookSecretsFromEnv(),
    auditUrl: process.env.NETWORK_SERVICE_AUDIT_DATABASE_URL,
    network: { seed: Number(process.env.NETWORK_SEED ?? 1) },
    publicApi: { hostMap: c.hostMap, ipOf, trustForwardedHost: false },
    log: s => log.info(s),
    adapter: c.channel === "eliza_cloud" ? (_net,rt)=>new CloudChannelAdapter({clock,from:resolveSenderLine(),app:rt.app.id,city:rt.city,env:process.env,
      origin:process.env.NETWORK_CLOUD_DELIVERY_ORIGIN!,secret:process.env.SERVICE_TURN_SECRET!}) : c.channel === "blooio" ? (net, rt) => {
      const from = resolveSenderLine();
      return new BlooioAdapter({ net, provider: new ProviderAdapter(new BlooioClient({ apiKey: process.env.BLOOIO_API_KEY! }), from), clock, memberOf: rt.memberOf, from, app: rt.app.id, city: rt.city });
    } : undefined,
  });
  const mcp = await createServiceMcp(svc, { databaseUrl: c.databaseUrl, proxySecret: c.proxySecret, log: s => log.info(s), migrate: !c.deployed });
  log.info("mcp", { enabled: !!mcp });
  log.info("photo relay", { enabled: !!c.photoRelay, version: c.photoRelay?.version ?? null, reviewers: c.photoRelay?.reviewers.length ?? 0 });
  if (c.deployed && !mcp) throw new Error("refusing to start: the MCP server is off, so the agent signup connector would answer 404");
  await svc.start();
  svc.publicApi.accounts.onPhoneChanged(async () => {
    for (const rt of svc.runtimes.values()) await rt.identities().catch(e => log.warn("identities refresh failed", { network: rt.id, error: (e as Error).message }));
  });
  const liveSends = liveSendTable(process.env, c.channel, liveSendAllowed);
  log.info("live sends", { inbound: c.blooioWebhook ? "backend webhook" : "eliza gateway", table: liveSends.map(r => `${r.app}: queued ${r.queued}, turn replies ${r.turnReplies}`) });
  for (const rt of svc.runtimes.values()) {
    const sends = liveSends.find(r => r.app === rt.app.id)?.queued ?? "dry-run";
    log.info("network", { network: rt.id, sends, matching: rt.matchingAllowed ? "allowed" : "off" });
  }

  const pool = new SQL({ url: c.databaseUrl, max: 1, idleTimeout: 30, connection: { application_name: "network-backend-health" } });
  const opsPool = new SQL({ url: c.databaseUrl, max: 2, idleTimeout: 30, connection: { application_name: "network-backend-ops" } });
  const eventsPool = c.publicEventsUrl ? new SQL({ url: c.publicEventsUrl, max: 2, idleTimeout: 30, connection: { application_name: "network-backend-public-events" } }) : undefined;
  const refreshEvents = eventsPool && createPublicEventRefresh({ sql: eventsPool, clock });
  const ops = createOps({
    config: c.ops, probes: () => [...svc.runtimes.values()].map(runtimeProbe), line: () => lineMetrics(opsPool), turns: now => turnWatchMetrics(opsPool, now), catalog: now => catalogMetrics(opsPool, now), cost: svc.cost,
    store: new PgAlertStore(opsPool), now: () => clock.now(), log,
  });
  log.info("ops", { alerts: c.ops.webhookUrl ? "webhook" : "log", heartbeat: !!c.ops.heartbeatUrl, metrics: !!c.ops.metricsToken, budgetDailyUsd: c.ops.budgets.daily ?? null });
  const backend = createBackend({
    svc, config: c, log,
    mcp: mcp && (req => mcp.fetch(req)),
    ping: async () => { await pool`select 1`; return true; },
    ops,
    ...(refreshEvents ? { publicEvents: async () => { const r = await refreshEvents(); if (r.kind === "scanned") log.info("public events", r); } } : {}),
  });

  const servers: { stop(force?: boolean): unknown }[] = [];
  const pub = await serveHttp({ hostname: c.host, port: c.port, maxRequestBodySize: MAX_PUBLIC_BODY_BYTES, fetch: (req, server) => backend.publicFetch(req, server) });
  servers.push(pub);
  log.info("listening", { port: "public", url: `http://${c.host}:${pub.port}` });
  if (c.staff) {
    const staff = await serveHttp({ hostname: c.staff.host, port: c.staff.port, fetch: req => backend.staffFetch(req) });
    servers.push(staff);
    log.info("listening", { port: "staff", url: `http://${c.staff.host.includes(":") ? `[${c.staff.host}]` : c.staff.host}:${staff.port}` });
  }

  const stop = async (signal: string) => {
    log.info("shutdown", { signal });
    const { clean } = await backend.shutdown(servers);
    const end = clean ? undefined : { timeout: 0 };
    await Promise.allSettled([pool.end(end), opsPool.end(end), eventsPool?.end(end)]);
    process.exit(clean ? 0 : 1);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
  await backend.startTicks();
}

main().catch(e => { log.error("start failed", { error: (e as Error).message }); process.exit(1); });
