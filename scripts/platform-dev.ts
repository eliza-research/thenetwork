#!/usr/bin/env bun
// Local dev for the whole platform: the shared backend and the four sites, wired as in production
// (docs/runbook-platform.md).
//   bun run platform:dev                 dev Postgres (:54339) + migrations, the backend, the four sites
//   bun run platform:dev --no-sites      the database and the backend only
//
// What it starts, all on 127.0.0.1:
//  - The dev Postgres cluster on port 54339 and every migration on its `network` database.
//  - The shared backend (deploy/backend createBackend, the same code as `bun run start:backend`):
//    /api/*, /webhooks/blooio, /mcp, /oauth/* and /.well-known/oauth-* on :8790, the staff API on
//    :4848. Every network in platform.networks runs and ticks each minute. Sends are dry-run (stored
//    with status dry_run, never sent). OTP codes are printed to this log ("[otp dev] ..."); nothing is texted.
//  - scripts/sites-dev.ts: ntwrk 5101, slop 5102, peon 5103, friends 5104. Their backend paths run
//    through the production router code (deploy/router.ts) and are signed with a dev
//    PLATFORM_PROXY_SECRET, so the backend trusts the site host and the visitor IP exactly as in
//    production (packages/platform/src/proxy.ts). The MCP server's issuer for each app is the local
//    site origin (http://127.0.0.1:5102 for slop), so an MCP client connects to http://127.0.0.1:5102/mcp.
// It refuses to run with NODE_ENV or PLATFORM_ENV set to production.
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { SQL } from "bun";
import { createBackend, ipOf, loadConfig, type Logger } from "../deploy/backend/backend.ts";
import { applySchema, DEV_PG_URL, devPgUp } from "../packages/observatory/db/dev-pg.ts";
import { APP_IDS } from "../packages/platform/src/apps.ts";
import { DevConsoleProvider } from "../packages/platform/src/otp.ts";
import { isProduction } from "../packages/platform/src/env.ts";
import { createServiceMcp } from "../packages/network/service/serve.ts";
import { NetworkService } from "../packages/network/service/service.ts";
import { SITES } from "../sites/sites.ts";

const REPO = resolve(import.meta.dir, "..");
const HOST = "127.0.0.1";

/** Plain one-line logs for a terminal (the deployed backend logs JSON). Request lines only with --verbose. */
function devLogger(verbose: boolean): Logger {
  const line = (level: string, msg: string, f: Record<string, unknown> = {}) => {
    if (msg === "http" && !verbose) return;
    const rest = Object.entries(f).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
    console.log(`${level === "info" ? "" : `${level}: `}${msg}${rest ? ` ${rest}` : ""}`);
  };
  return { info: (m, f) => line("info", m, f), warn: (m, f) => line("warn", m, f), error: (m, f) => line("error", m, f) };
}

async function main() {
  if (isProduction()) throw new Error("platform:dev is for local development only (NODE_ENV/PLATFORM_ENV is production)");
  // The dev shortcuts (console OTP codes, the dev hash key, no Turnstile, http issuers) need a declared dev environment.
  process.env.PLATFORM_ENV ??= "dev";
  // Member photos in a local folder (runs/photos, git-ignored) unless set otherwise.
  process.env.PHOTO_STORAGE ??= "local";
  if (process.env.PLATFORM_ENV !== "dev") throw new Error(`platform:dev needs PLATFORM_ENV=dev (got ${process.env.PLATFORM_ENV})`);
  for (const f of ["BLOOIO_ALLOW_SEND", "NTWRK_LIVE_APPROVED", "NETWORK_CHANNEL"]) if (process.env[f]) console.warn(`${f} is set: ignored here, platform:dev never sends (dry-run adapter)`);
  delete process.env.NETWORK_CHANNEL;
  const url = process.env.NETWORK_DATABASE_URL ?? DEV_PG_URL;
  if (!/@(localhost|127\.0\.0\.1):54339\//.test(url)) throw new Error(`platform:dev uses the local dev Postgres on port 54339 only, not ${url.replace(/\/\/[^@]*@/, "//")}`);
  await devPgUp();
  // A database of your own on the dev cluster (NETWORK_DATABASE_URL=.../platform_dev) is created when missing.
  const db = new URL(url).pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(db)) throw new Error(`bad database name ${db}`);
  const admin = new SQL(url.replace(/\/[^/]*$/, "/postgres"));
  if (!(await admin`select 1 from pg_database where datname = ${db}`).length) await admin.unsafe(`create database ${db}`);
  await admin.close();
  await applySchema(url);
  console.log(`database ${url} migrated`);

  // One secret for the site routers and the backend. A fresh one per run unless you set your own.
  process.env.PLATFORM_PROXY_SECRET ||= randomBytes(32).toString("hex");
  const apiPort = Number(process.env.PLATFORM_API_PORT ?? 8790);
  const staffPort = Number(process.env.NETWORK_SERVICE_PORT ?? 4848);
  const verbose = process.argv.includes("--verbose");
  const log = devLogger(verbose);
  const config = loadConfig({ ...process.env, DATABASE_URL: url, PORT: String(apiPort), STAFF_PORT: String(staffPort), MIGRATE_ON_BOOT: "0", TICK_MS: "60000" });

  // Dev staff tokens (printed once). Set NETWORK_SERVICE_TOKENS to use your own.
  const tokens = process.env.NETWORK_SERVICE_TOKENS ?? "admin:dev-admin,reviewer:dev-reviewer,safety:dev-safety,analyst:dev-analyst";
  const secret = process.env.BLOOIO_WEBHOOK_SECRET ?? "whsec_dev_shared";
  const svc = await NetworkService.fromDatabase({
    url, instance: "platform-dev", tokens, webhookSecret: secret,
    webhookSecrets: Object.fromEntries(APP_IDS.map(a => [a, process.env[`${a.toUpperCase()}_BLOOIO_WEBHOOK_SECRET`] ?? `whsec_dev_${a}`])),
    network: { seed: 1 },
    // Dev only: slop and peon matching start on (their packs are wired; every item still waits for a reviewer). Production starts off.
    devMatching: ["slop:nyc", "peon:nyc"],
    // The visitor IP comes only from the signed router headers (the backend checks them first). The host map
    // is the platform's dev map, so a browser Origin of http://127.0.0.1:5102 counts as slop's own site.
    publicApi: { otp: new DevConsoleProvider(), ipOf },
    log: s => log.info(s),
  });
  await svc.start();
  for (const rt of svc.runtimes.values()) console.log(`network ${rt.id}: sends dry-run, review "human", matching ${rt.matchingAllowed ? "allowed (admin switch)" : "not allowed (platform.networks)"}`);
  if (!process.env.NETWORK_SERVICE_TOKENS) console.log(`staff tokens (dev only): ${tokens}`);

  const devOrigins = Object.fromEntries(SITES.map(s => [s.app, `http://${HOST}:${s.port}`]));
  const mcp = await createServiceMcp(svc, { databaseUrl: url, proxySecret: config.proxySecret, devOrigins, log: s => log.info(s) });
  const pool = new SQL({ url, max: 1 });
  const backend = createBackend({ svc, config, log, ping: async () => { await pool`select 1`; return true; }, mcp: mcp && (req => mcp.fetch(req)) });
  const pub = Bun.serve({ hostname: HOST, port: apiPort, fetch: (req, server) => backend.publicFetch(req, server), maxRequestBodySize: 256 * 1024 });
  const staff = Bun.serve({ hostname: HOST, port: staffPort, fetch: req => backend.staffFetch(req), maxRequestBodySize: 256 * 1024 });
  void backend.startTicks();

  let sites: ReturnType<typeof Bun.spawn> | undefined;
  if (!process.argv.includes("--no-sites")) {
    sites = Bun.spawn(["bun", "run", "scripts/sites-dev.ts"], {
      cwd: REPO, stdout: "inherit", stderr: "inherit",
      env: { ...process.env, PLATFORM_API_ORIGIN: `http://${HOST}:${pub.port}` },
    });
  }
  console.log([
    "",
    "platform:dev is up (dry-run: nothing is texted; OTP codes print here)",
    `  backend    http://${HOST}:${pub.port}  (/api/*, /webhooks/blooio, /mcp, /oauth/*; /healthz)`,
    `  staff API  http://${HOST}:${staff.port}  (Authorization: Bearer dev-admin)`,
    ...(sites ? SITES.map(s => `  ${s.domain.padEnd(12)} http://${HOST}:${s.port}   MCP: http://${HOST}:${s.port}/mcp${s.app === "slop" ? "" : `  (OpenAI surface: /mcp/openai)`}`) : []),
    "  Use 555-01xx numbers only, for example (212) 555-0142.",
    "",
  ].join("\n"));

  const stop = async () => {
    sites?.kill();
    await backend.shutdown([pub, staff]);
    await pool.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(e => { console.error((e as Error).message); process.exit(1); });
