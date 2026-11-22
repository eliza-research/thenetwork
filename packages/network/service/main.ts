#!/usr/bin/env -S node --import=tsx
import { RealClock } from "@thenetwork/core";
import { BlooioClient } from "../../blooio/src/blooio/client.ts";
import { BlooioAdapter as ProviderAdapter } from "../../blooio/src/adapters/blooio-adapter.ts";
import { resolveSenderLine } from "../../blooio/src/line.ts";
import { assertBootConfig } from "../../platform/src/env.ts";
import { networkRoutePolicy } from "./route-authority.ts";
import { CloudChannelAdapter } from "./cloud-channel.ts";
import { BlooioAdapter, liveFlag, liveSendAllowed } from "./channel.ts";
import { serveService, startTicks } from "./serve.ts";
import { backendWebhookServed, declaredEnvironment, deployedEnvironment, lineAndStaffRefused, minimumSecretLength } from "../../core/src/generated/bootPolicy.ts";
import { lineAndStaffFacts, lineAndStaffMessages, lineAndStaffProblemsFor } from "./line-staff-boot.ts";
import { NetworkService, webhookSecretsFromEnv } from "./service.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const env = assertBootConfig();
  const lineStaff = lineAndStaffFacts(process.env, env === "production");
  const deployed = deployedEnvironment(declaredEnvironment(process.env.PLATFORM_ENV ?? "", process.env.NODE_ENV ?? ""));
  const lineStaffProblems = lineAndStaffProblemsFor(deployed, lineStaff);
  if (lineAndStaffRefused(lineStaffProblems)) throw new Error(`refusing to start (PLATFORM_ENV=${env}): needs ${lineAndStaffMessages(lineStaffProblems, minimumSecretLength).join("; ")}`);
  const blooioWebhook = backendWebhookServed(process.env.NETWORK_CHANNEL ?? "");
  const once = process.argv.includes("--once");
  const dryRun = process.argv.includes("--dry-run") || !!networkRoutePolicy(process.env);
  const url = process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("set NETWORK_DATABASE_URL (or DATABASE_URL) to the Postgres with the network and platform schemas (pnpm run db:migrate)");
  const clock = new RealClock();
  const blooio = !dryRun && process.env.NETWORK_CHANNEL === "blooio";
  const cloud = !dryRun && process.env.NETWORK_CHANNEL === "eliza_cloud";
  const host = arg("--host") ?? process.env.NETWORK_SERVICE_HOST ?? "127.0.0.1";
  const local = host === "127.0.0.1" || host === "localhost";
  const svc = await NetworkService.fromDatabase({
    url, clock, instance: process.env.NETWORK_SERVICE_INSTANCE ?? `${process.pid}`,
    tokens: process.env.NETWORK_SERVICE_TOKENS, consoleToken: process.env.NETWORK_SERVICE_CONSOLE_TOKEN, webhookSecret: process.env.BLOOIO_WEBHOOK_SECRET, webhookSecrets: webhookSecretsFromEnv(),
    auditUrl: process.env.NETWORK_SERVICE_AUDIT_DATABASE_URL,
    network: { seed: Number(process.env.NETWORK_SEED ?? 1) },
    publicApi: { trustForwardedHost: local && env === "dev" },
    adapter: cloud ? (_net,rt)=>new CloudChannelAdapter({clock,from:resolveSenderLine(),app:rt.app.id,city:rt.city,env:process.env,
      origin:process.env.NETWORK_CLOUD_DELIVERY_ORIGIN??"",secret:process.env.SERVICE_TURN_SECRET??""}) : blooio ? (net, rt) => {
      const key = process.env.BLOOIO_API_KEY;
      if (!key) throw new Error("NETWORK_CHANNEL=blooio needs BLOOIO_API_KEY");
      const from = resolveSenderLine();
      return new BlooioAdapter({ net, provider: new ProviderAdapter(new BlooioClient({ apiKey: key }), from), clock, memberOf: rt.memberOf, from, app: rt.app.id, city: rt.city });
    } : undefined,
  });
  await svc.start();
  for (const rt of svc.runtimes.values()) {
    const mode = cloud ? (liveSendAllowed(process.env,rt.app.id) ? "eliza_cloud LIVE" : "eliza_cloud (refusing: live approval flags are needed)") : blooio ? (liveSendAllowed(process.env, rt.app.id) ? "blooio LIVE" : `blooio (refusing: BLOOIO_ALLOW_SEND=1, NTWRK_LIVE_APPROVED=1${rt.app.id === "ntwrk" ? "" : ` and ${liveFlag(rt.app.id)}=1`} are needed)`) : "dry-run";
    console.log(`network ${rt.id}: sends ${mode}, review "human", matching ${rt.matchingAllowed ? "allowed (the admin switch decides)" : "not allowed (registry row or launch scope)"}`);
  }
  if (!lineStaff.staffTokenCount) console.warn("NETWORK_SERVICE_TOKENS is not set: every staff route answers 401");
  if (blooioWebhook && !process.env.BLOOIO_WEBHOOK_SECRET) console.warn("BLOOIO_WEBHOOK_SECRET is not set: the shared-line webhook answers 503");
  if (!blooioWebhook) console.log("inbound: the Eliza gateway owns the carrier webhook (NETWORK_CHANNEL=eliza_cloud); /webhooks/blooio is not served");
  if (!process.env.SERVICE_TURN_SECRET) console.warn("SERVICE_TURN_SECRET is not set: /internal/turn and the other signed routes answer 503");
  if (once) {
    await svc.inboxTick();
    for (const rt of svc.runtimes.values()) console.log(`${rt.id}: ${(await rt.tick()) ? "tick done" : "tick skipped: another instance holds the lock"}`);
    await svc.close();
    return;
  }

  const port = Number(arg("--port") ?? process.env.NETWORK_SERVICE_PORT ?? 4848);
  const apiPort = Number(arg("--api-port") ?? process.env.PLATFORM_API_PORT ?? 8790);
  if (!local) console.warn(`binding ${host}: use this only behind an access proxy (runbook-real 7)`);
  const servers = await serveService(svc, { host, port, apiPort, blooioWebhook });
  const ticks = startTicks(svc);
  await ticks.first;
  const stop = async () => { await ticks.stop(); servers.stop(); await svc.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(e => { console.error((e as Error).message); process.exit(1); });
