#!/usr/bin/env bun
// Local dev for the whole platform: one backend, four sites (docs/runbook-platform.md).
//   bun run platform:dev                 dev Postgres (:54339) + migrations, the service, the four sites
//   bun run platform:dev --no-sites      the database and the service only
//
// What it starts, all on 127.0.0.1:
//  - The dev Postgres cluster on port 54339 and `bun run db:migrate` on its `network` database.
//  - The Network service for every row of platform.networks: staff API and webhooks on :4848, the
//    public API (/api/*) on :8790. Sends are dry-run (stored with status dry_run, never sent). OTP
//    codes are printed to this log ("[otp dev] <app> +1 •••-•••-0101 code 123456"); nothing is texted.
//  - scripts/sites-dev.ts: ntwrk 5101, slop 5102, peon 5103, the friends app 5104, proxying /api/* to :8790.
// It refuses to run with NODE_ENV or PLATFORM_ENV set to production.
import { resolve } from "node:path";
import { SQL } from "bun";
import { applySchema, DEV_PG_URL, devPgUp } from "../packages/observatory/db/dev-pg.ts";
import { APP_IDS } from "../packages/platform/src/apps.ts";
import { DevConsoleProvider } from "../packages/platform/src/otp.ts";
import { isProduction } from "../packages/platform/src/env.ts";
import { serveService, startTicks } from "../packages/network/service/serve.ts";
import { NetworkService } from "../packages/network/service/service.ts";

const REPO = resolve(import.meta.dir, "..");
const HOST = "127.0.0.1";

async function main() {
  if (isProduction()) throw new Error("platform:dev is for local development only (NODE_ENV/PLATFORM_ENV is production)");
  // The dev shortcuts (console OTP codes, the dev hash key, X-Forwarded-Host from the site proxy) need a declared dev environment.
  process.env.PLATFORM_ENV ??= "dev";
  if (process.env.PLATFORM_ENV !== "dev") throw new Error(`platform:dev needs PLATFORM_ENV=dev (got ${process.env.PLATFORM_ENV})`);
  for (const f of ["BLOOIO_ALLOW_SEND", "NTWRK_LIVE_APPROVED"]) if (process.env[f]) console.warn(`${f} is set: ignored here, platform:dev never sends (dry-run adapter)`);
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

  // Dev staff tokens (printed once). Set NETWORK_SERVICE_TOKENS to use your own.
  const tokens = process.env.NETWORK_SERVICE_TOKENS ?? "admin:dev-admin,reviewer:dev-reviewer,safety:dev-safety,analyst:dev-analyst";
  const secret = process.env.BLOOIO_WEBHOOK_SECRET ?? "whsec_dev_shared";
  const svc = await NetworkService.fromDatabase({
    url, instance: "platform-dev", tokens, webhookSecret: secret,
    webhookSecrets: Object.fromEntries(APP_IDS.map(a => [a, process.env[`${a.toUpperCase()}_BLOOIO_WEBHOOK_SECRET`] ?? `whsec_dev_${a}`])),
    network: { seed: 1 },
    // The dev site proxy names the site in X-Forwarded-Host; the codes go to this log.
    publicApi: { otp: new DevConsoleProvider(), trustForwardedHost: true },
  });
  await svc.start();
  for (const rt of svc.runtimes.values()) console.log(`network ${rt.id}: sends dry-run, review "human", matching ${rt.matchingAllowed ? "allowed (admin switch)" : "not allowed (platform.networks)"}`);
  if (!process.env.NETWORK_SERVICE_TOKENS) console.log(`staff tokens (dev only): ${tokens}`);
  const servers = serveService(svc, { host: HOST, port: Number(process.env.NETWORK_SERVICE_PORT ?? 4848), apiPort: Number(process.env.PLATFORM_API_PORT ?? 8790) });
  const ticks = startTicks(svc);

  let sites: ReturnType<typeof Bun.spawn> | undefined;
  if (!process.argv.includes("--no-sites")) {
    sites = Bun.spawn(["bun", "run", "scripts/sites-dev.ts"], {
      cwd: REPO, stdout: "inherit", stderr: "inherit",
      env: { ...process.env, PLATFORM_API_ORIGIN: `http://${HOST}:${process.env.PLATFORM_API_PORT ?? 8790}` },
    });
  }
  const stop = async () => { ticks.stop(); servers.stop(); sites?.kill(); await svc.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(e => { console.error((e as Error).message); process.exit(1); });
