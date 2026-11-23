import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { spawnProcess } from "../../core/src/runtime/process.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { backendWebhookServed } from "../../core/src/generated/bootPolicy.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { serveService, startTicks } from "../service/serve.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const webhookSecret = "whsec_service_entry";
const clock = new SimClock(Date.UTC(2026, 10, 18, 16));
let service: NetworkService;

beforeAll(async () => {
  if (!pgAvailable) return;
  const url = await testDb();
  service = new NetworkService({
    url, clock, photoStorage: null, instance: "service-entry", log: () => {}, webhookSecret, network: { seed: 1 },
    env: { PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: "synthetic-service-entry-hash-key" },
    networks: [{ id: "friends:nyc", matchingEnabled: false }],
    adapter: () => new DryRunAdapter(() => {}),
  });
  await service.start();
}, 120_000);
afterAll(async () => {
  await service?.close();
  await dropTestDb();
});

const runMain = async (env: Record<string, string>) => {
  const p = spawnProcess([process.execPath, "--import", "tsx", "packages/network/service/main.ts", "--once", "--dry-run"], {
    cwd: REPO, stdout: "pipe", stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PLATFORM_ENV: "production",
      OTP_PROVIDER: "blooio", BLOOIO_API_KEY: "synthetic-key", BLOOIO_FROM: "+12125550100", TURNSTILE_SECRET_KEY: "synthetic-turnstile",
      PLATFORM_PROXY_SECRET: "p".repeat(40), PLATFORM_HASH_KEY: "h".repeat(40), PLATFORM_SESSION_SECRET: "s".repeat(40),
      DATABASE_URL: "postgres://x@db.invalid/none", SURPLUS_API_KEY: "synthetic-surplus-key", ...env,
    },
  });
  const code = await p.exited;
  return { code, err: await new Response(p.stderr).text() };
};
const staff = `admin@*:${"a".repeat(40)}`;

test("a staging or production main.ts refuses a missing or weak turn secret, missing or weak staff tokens, and a reused turn secret", async () => {
  const missing = await runMain({});
  expect(missing.code).not.toBe(0);
  expect(missing.err).toContain("refusing to start (PLATFORM_ENV=production)");
  for (const word of ["SERVICE_TURN_SECRET of at least 32", "NETWORK_SERVICE_TOKENS (the staff API"]) expect(missing.err).toContain(word);
  const weak = await runMain({ SERVICE_TURN_SECRET: "t".repeat(31), NETWORK_SERVICE_TOKENS: `${staff},reviewer@friends:short-token` });
  expect(weak.code).not.toBe(0);
  for (const word of ["SERVICE_TURN_SECRET of at least 32", "every NETWORK_SERVICE_TOKENS token"]) expect(weak.err).toContain(word);
  const reused = await runMain({ SERVICE_TURN_SECRET: "a".repeat(40), NETWORK_SERVICE_TOKENS: staff });
  expect(reused.code).not.toBe(0);
  expect(reused.err).toContain("not also a NETWORK_SERVICE_TOKENS token");
  const unparsed = await runMain({ SERVICE_TURN_SECRET: "t".repeat(40), NETWORK_SERVICE_TOKENS: `admin:${"a".repeat(40)}` });
  expect(unparsed.code).not.toBe(0);
  expect(unparsed.err).toContain("NETWORK_SERVICE_TOKENS");
  expect(unparsed.err).not.toContain("OBSERVATORY_TOKENS");
}, 120_000);

test("a production main.ts refuses to start without the Workers AI token and account, so the relay never blocks every text without an error at start", async () => {
  const ready = { SERVICE_TURN_SECRET: "t".repeat(40), NETWORK_SERVICE_TOKENS: staff };
  const partial: Record<string, string>[] = [{}, { CLOUDFLARE_AI_TOKEN: "synthetic-ai-token" }, { CLOUDFLARE_ACCOUNT_ID: "synthetic-account" }];
  for (const env of partial) {
    const r = await runMain({ ...ready, ...env });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("refusing to start (PLATFORM_ENV=production): needs CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID (photo ratings and the relay classifier, which production needs)");
  }
}, 120_000);

test("a staging or production main.ts refuses a session secret that is the hash key", async () => {
  for (const environment of ["staging", "production"]) {
    const reused = await runMain({ PLATFORM_ENV: environment, SERVICE_TURN_SECRET: "t".repeat(40), NETWORK_SERVICE_TOKENS: staff, PLATFORM_SESSION_SECRET: "h".repeat(40) });
    expect(reused.code, environment).not.toBe(0);
    expect(reused.err, environment).toContain(`refusing to start (PLATFORM_ENV=${environment}): needs a PLATFORM_SESSION_SECRET that differs from PLATFORM_HASH_KEY`);
  }
}, 120_000);

test.skipIf(!pgAvailable)("with NETWORK_CHANNEL=eliza_cloud serveService does not serve the Blooio webhook; otherwise it does", async () => {
  const post = async (base: string) => {
    const raw = JSON.stringify({ id: `evt_${randomUUID()}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
      data: { message_id: `msg_${randomUUID()}`, sender: "+12125550181", chat_id: "+12125550181", text: "HELP", protocol: "imessage" } });
    return fetch(new URL(WEBHOOK_PATH, base), {
      method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(webhookSecret, raw, Math.floor(clock.now() / 1000)) }, body: raw,
    });
  };
  for (const [channel, served] of [["eliza_cloud", false], ["blooio", true], ["", true]] as const) {
    expect(backendWebhookServed(channel)).toBe(served);
    const s = await serveService(service, { host: "127.0.0.1", port: 0, apiPort: 0, blooioWebhook: backendWebhookServed(channel), log: () => {} });
    try {
      const r = await post(s.server.url.toString());
      const body = await r.json() as { error?: string };
      if (served) expect([r.status, body.error]).toEqual([200, undefined]);
      else expect([r.status, body.error]).toEqual([404, "webhook_not_served"]);
    } finally { s.stop(); }
  }
}, 60_000);

test.skipIf(!pgAvailable)("the main.ts tick loop runs retention and notifications beside a long network tick, and a failed worker does not stop another", async () => {
  const runtimes = [...service.runtimes.values()];
  const ticks = runtimes.map(rt => rt.tick);
  const { purge, notifyTick, inboxTick } = service;
  const ran: string[] = [], lines: string[] = [];
  let release = () => {};
  const held = new Promise<void>(r => { release = r; });
  for (const rt of runtimes) rt.tick = async () => { ran.push(`network:${rt.id}`); await held; return true; };
  service.purge = async () => { ran.push("retention"); throw new Error("retention unavailable"); };
  service.notifyTick = async () => { ran.push("notify"); };
  service.inboxTick = async () => { ran.push("inbox"); };
  try {
    const loop = startTicks(service, line => lines.push(line));
    for (let i = 0; i < 100 && !(ran.includes("retention") && ran.includes("notify") && runtimes.every(rt => ran.includes(`network:${rt.id}`))); i++) await sleep(20);
    expect([...ran].sort()).toEqual(["inbox", ...runtimes.map(rt => `network:${rt.id}`), "notify", "retention"].sort());
    expect(lines).toContain("retention: tick failed: retention unavailable");
    release();
    await loop.first;
    await loop.stop();
  } finally {
    release();
    runtimes.forEach((rt, i) => { rt.tick = ticks[i]!; });
    Object.assign(service, { purge, notifyTick, inboxTick });
  }
}, 60_000);
