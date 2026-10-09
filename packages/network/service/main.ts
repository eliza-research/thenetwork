#!/usr/bin/env bun
// The Network service for every app (README.md in this folder).
//   bun run packages/network/service/main.ts [--once] [--dry-run] [--port N] [--host H] [--api-port N]
//
// It runs one network per row of platform.networks ('<app>:<city>'). Without --once: each network
// ticks every minute on its own (a second instance skips a network while its lock is held), the
// staff and webhook HTTP server binds 127.0.0.1:4848, and the public API the sites call (/api/*)
// binds 127.0.0.1:8790 (PLATFORM_API_PORT). --once runs one tick of every network, delivers, and
// exits. Sends are dry-run unless NETWORK_CHANNEL=blooio; the Blooio adapter still refuses every send
// unless BLOOIO_ALLOW_SEND=1, NTWRK_LIVE_APPROVED=1 and the app's <APP>_LIVE_APPROVED=1 (founder approval).
import { RealClock } from "@thenetwork/core";
import { BlooioClient } from "../../blooio/src/blooio/client.ts";
import { BlooioAdapter as ProviderAdapter } from "../../blooio/src/adapters/blooio-adapter.ts";
import { resolveSenderLine } from "../../blooio/src/line.ts";
import { assertBootConfig } from "../../platform/src/env.ts";
import { BlooioAdapter, liveFlag, liveSendAllowed } from "./channel.ts";
import { serveService, startTicks } from "./serve.ts";
import { CloudChannelAdapter } from "./cloud-channel.ts";
import { NetworkService, webhookSecretsFromEnv } from "./service.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  // Fail closed: the environment must be declared, and production (or staging) refuses to start
  // without Twilio, Turnstile, the proxy secret, the hash key, the session secret, a database and
  // review mode "human" (env.ts bootConfigProblems). Only PLATFORM_ENV=dev gets the dev shortcuts.
  const env = assertBootConfig();
  const once = process.argv.includes("--once");
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("set NETWORK_DATABASE_URL (or DATABASE_URL) to the Postgres with the network and platform schemas (bun run db:migrate)");
  const clock = new RealClock();
  const blooio = !dryRun && process.env.NETWORK_CHANNEL === "blooio";
  const cloud = !dryRun && process.env.NETWORK_CHANNEL === "eliza_cloud";
  const host = arg("--host") ?? process.env.NETWORK_SERVICE_HOST ?? "127.0.0.1";
  const local = host === "127.0.0.1" || host === "localhost";
  const svc = await NetworkService.fromDatabase({
    url, clock, instance: process.env.NETWORK_SERVICE_INSTANCE ?? `${process.pid}`,
    tokens: process.env.NETWORK_SERVICE_TOKENS, consoleToken: process.env.NETWORK_SERVICE_CONSOLE_TOKEN, webhookSecret: process.env.BLOOIO_WEBHOOK_SECRET, webhookSecrets: webhookSecretsFromEnv(),
    agentToken: process.env.NETWORK_SERVICE_AGENT_TOKEN,
    serviceTurnSecret: process.env.SERVICE_TURN_SECRET,
    auditUrl: process.env.NETWORK_SERVICE_AUDIT_DATABASE_URL,
    network: { seed: Number(process.env.NETWORK_SEED ?? 1) },
    // The dev site proxy (scripts/sites-dev.ts) names the site in X-Forwarded-Host. Trust it only on a local, non-production bind.
    publicApi: { trustForwardedHost: local && env === "dev" },
    adapter: blooio || cloud ? (net, rt) => {
      if (cloud) return new CloudChannelAdapter({net, clock, memberOf: rt.memberOf, app: rt.app.id, city: rt.city, env: process.env, origin: process.env.NETWORK_CLOUD_DELIVERY_ORIGIN ?? "", secret: process.env.SERVICE_TURN_SECRET ?? ""});
      const key = process.env.BLOOIO_API_KEY;
      if (!key) throw new Error("NETWORK_CHANNEL=blooio needs BLOOIO_API_KEY");
      const from = resolveSenderLine();
      return new BlooioAdapter({ net, provider: new ProviderAdapter(new BlooioClient({ apiKey: key }), from), clock, memberOf: rt.memberOf, from, app: rt.app.id, city: rt.city });
    } : undefined,
  });
  await svc.start();
  for (const rt of svc.runtimes.values()) {
    const mode = blooio || cloud ? (liveSendAllowed(process.env, rt.app.id) ? `${rt.adapter.name} LIVE` : `${rt.adapter.name} (refusing: BLOOIO_ALLOW_SEND=1, NTWRK_LIVE_APPROVED=1${rt.app.id === "ntwrk" ? "" : ` and ${liveFlag(rt.app.id)}=1`} are needed)`) : "dry-run";
    console.log(`network ${rt.id}: sends ${mode}, review "human", matching ${rt.matchingAllowed ? "allowed (the admin switch decides)" : "not allowed (platform.networks)"}`);
  }
  if (!process.env.NETWORK_SERVICE_TOKENS) console.warn("NETWORK_SERVICE_TOKENS is not set: every staff route answers 401");
  if (!process.env.BLOOIO_WEBHOOK_SECRET) console.warn("BLOOIO_WEBHOOK_SECRET is not set: the shared-line webhook answers 503");

  if (once) {
    for (const rt of svc.runtimes.values()) console.log(`${rt.id}: ${(await rt.tick()) ? "tick done" : "tick skipped: another instance holds the lock"}`);
    await svc.close();
    return;
  }

  const port = Number(arg("--port") ?? process.env.NETWORK_SERVICE_PORT ?? 4848);
  const apiPort = Number(arg("--api-port") ?? process.env.PLATFORM_API_PORT ?? 8790);
  if (!local) console.warn(`binding ${host}: use this only behind an access proxy (runbook-real 7)`);
  const servers = serveService(svc, { host, port, apiPort });
  const ticks = startTicks(svc);
  await ticks.first;
  const stop = async () => { await ticks.stop(); servers.stop(); await svc.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(e => { console.error((e as Error).message); process.exit(1); });
