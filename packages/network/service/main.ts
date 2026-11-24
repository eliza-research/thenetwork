#!/usr/bin/env -S node --import=tsx
import { RealClock } from "@thenetwork/core";
import { BlooioClient } from "../../blooio/src/blooio/client.ts";
import { BlooioAdapter as ProviderAdapter } from "../../blooio/src/adapters/blooio-adapter.ts";
import { resolveSenderLine } from "../../blooio/src/line.ts";
import { assertBootConfig, isProduction } from "../../platform/src/env.ts";
import { photoRaterFromEnv } from "../../platform/src/photos.ts";
import { CloudChannelAdapter } from "./cloud-channel.ts";
import { BlooioAdapter } from "./channel.ts";
import { serveService, startTicks } from "./serve.ts";
import { backendWebhookServed, declaredEnvironment, deployedEnvironment, lineAndStaffProblems, lineAndStaffRefused, photoStorageSetup } from "../../core/src/generated/bootPolicy.ts";
import { configuredChannel, lineAndStaffFacts, lineAndStaffMessages, workersAiProblem } from "./line-staff-boot.ts";
import { NetworkService, webhookSecretsFromEnv } from "./service.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const env = assertBootConfig();
  const deployed = deployedEnvironment(declaredEnvironment(process.env.PLATFORM_ENV ?? "", process.env.NODE_ENV ?? ""));
  const production = isProduction(process.env);
  const lineStaff = lineAndStaffFacts(process.env, production);
  const lineStaffProblems = lineAndStaffProblems(deployed, lineStaff.turnSecretLength, lineStaff.staffTokenCount, lineStaff.shortestStaffTokenLength, lineStaff.turnSecretIsStaffToken);
  const workersAi = workersAiProblem(deployed, production, process.env);
  const photoStorage = photoStorageSetup(deployed, Boolean(process.env.PHOTO_STORAGE), process.env.PHOTO_STORAGE === "r2") === "PhotoStorageRefused"
    ? "PHOTO_STORAGE=r2 (private photo storage) on a deployed service" : undefined;
  const problems = [
    ...(lineAndStaffRefused(lineStaffProblems) ? lineAndStaffMessages(lineStaffProblems) : []),
    ...(workersAi ? [workersAi] : []), ...(photoStorage ? [photoStorage] : []),
  ];
  if (problems.length) throw new Error(`refusing to start (PLATFORM_ENV=${env}): needs ${problems.join("; ")}`);
  const rater = await photoRaterFromEnv(process.env, { log: s => console.warn(s) });
  if (rater.status === "refused_weights") throw new Error(`refusing to start: CLEF_WEIGHTS_PATH was refused (${rater.detail ?? "no detail"})`);
  const channel = configuredChannel(process.env, process.argv);
  const blooioWebhook = backendWebhookServed(process.env.NETWORK_CHANNEL ?? "");
  const once = process.argv.includes("--once");
  const url = process.env.NETWORK_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("set NETWORK_DATABASE_URL (or DATABASE_URL) to the Postgres with the network and platform schemas (pnpm run db:migrate)");
  const clock = new RealClock();
  const blooio = channel === "blooio";
  const cloud = channel === "eliza_cloud";
  const host = arg("--host") ?? process.env.NETWORK_SERVICE_HOST ?? "127.0.0.1";
  const local = host === "127.0.0.1" || host === "localhost";
  const svc = await NetworkService.fromDatabase({
    url, clock, instance: process.env.NETWORK_SERVICE_INSTANCE ?? `${process.pid}`, photoRater: rater.rater,
    tokens: process.env.NETWORK_SERVICE_TOKENS, consoleToken: process.env.NETWORK_SERVICE_CONSOLE_TOKEN, webhookSecret: process.env.BLOOIO_WEBHOOK_SECRET, webhookSecrets: webhookSecretsFromEnv(),
    auditUrl: process.env.NETWORK_SERVICE_AUDIT_DATABASE_URL,
    network: { seed: Number(process.env.NETWORK_SEED ?? 1) },
    publicApi: { trustForwardedHost: local && env === "dev" },
    adapter: cloud ? (_net,rt)=>new CloudChannelAdapter({clock,from:resolveSenderLine(),app:rt.app.id,city:rt.city,env:process.env,
      origin:process.env.NETWORK_CLOUD_DELIVERY_ORIGIN!,secret:process.env.SERVICE_TURN_SECRET!}) : blooio ? (_net, rt) => {
      const from = resolveSenderLine();
      return new BlooioAdapter({ provider: new ProviderAdapter(new BlooioClient({ apiKey: process.env.BLOOIO_API_KEY! }), from), clock, from, app: rt.app.id, city: rt.city });
    } : undefined,
  });
  await svc.start();
  for (const rt of svc.runtimes.values()) {
    console.log(`network ${rt.id}: sends ${channel}, review by the judge (staff decide held items), matching ${rt.matchingAllowed ? "allowed (the admin switch decides)" : "not allowed (registry row)"}`);
  }
  if (!process.env.NETWORK_SERVICE_TOKENS) console.warn("NETWORK_SERVICE_TOKENS is not set: every staff route answers 401");
  if (!process.env.SERVICE_TURN_SECRET) console.warn("SERVICE_TURN_SECRET is not set: /internal/turn and the other signed routes answer 503");
  if (blooioWebhook && !process.env.BLOOIO_WEBHOOK_SECRET) console.warn("BLOOIO_WEBHOOK_SECRET is not set: the shared-line webhook answers 503");
  if (!blooioWebhook) console.log("inbound: the Eliza gateway owns the carrier webhook (NETWORK_CHANNEL=eliza_cloud); /webhooks/blooio is not served");
  if (once) {
    await svc.inboxTick();
    for (const rt of svc.runtimes.values()) console.log(`${rt.id}: ${(await rt.tick()) ? "tick done" : "tick skipped: another instance holds the lock"}`);
    await svc.reviewJudgeTick();
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
