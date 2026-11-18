// The service entry (main.ts with serveService) refuses what the combined backend refuses (review of audit OPS29, SHA43).
// spec/bootPolicy.md, "Both entries refuse a deployment whose shared line or staff API could not work";
// "Exactly one system answers the carrier's inbound messages". Needs the dev Postgres on :54339.
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { spawnProcess } from "../../core/src/runtime/process.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { backendWebhookServed } from "../../core/src/generated/bootPolicy.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { serveService } from "../service/serve.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const db = `network_service_entry_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({ url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:${DEV_PG_PORT}/postgres`, max: 1 });
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const webhookSecret = "whsec_service_entry";
const clock = new SimClock(Date.UTC(2026, 10, 18, 16));
let service: NetworkService;

beforeAll(async () => {
  await admin.unsafe(`create database ${db}`);
  await applySchema(url, { lockTimeout: "5s" });
  service = new NetworkService({
    url, clock, photoStorage: null, instance: "service-entry", log: () => {}, webhookSecret, network: { seed: 1 },
    env: { PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: "synthetic-service-entry-hash-key", CLEF_RATINGS: "off" },
    networks: [{ id: "friends:nyc", matchingEnabled: false }],
    adapter: () => new DryRunAdapter(() => {}),
  });
  await service.start();
}, 120_000);
afterAll(async () => {
  await service?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(() => {});
  await admin.close();
});

test("a staging or production main.ts refuses a missing or weak turn secret, missing or weak staff tokens, and a reused turn secret", async () => {
  const run = async (env: Record<string, string>) => {
    const p = spawnProcess([process.execPath, "--import", "tsx", "packages/network/service/main.ts", "--once", "--dry-run"], {
      cwd: REPO, stdout: "pipe", stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PLATFORM_ENV: "production",
        OTP_PROVIDER: "blooio", BLOOIO_API_KEY: "synthetic-key", BLOOIO_FROM: "+12125550100", TURNSTILE_SECRET_KEY: "synthetic-turnstile",
        PLATFORM_PROXY_SECRET: "p".repeat(40), PLATFORM_HASH_KEY: "h".repeat(40), PLATFORM_SESSION_SECRET: "s".repeat(40),
        DATABASE_URL: "postgres://x@db.invalid/none", ...env,
      },
    });
    const code = await p.exited;
    return { code, err: await new Response(p.stderr).text() };
  };
  const staff = `admin@*:${"a".repeat(40)}`;
  const missing = await run({});
  expect(missing.code).not.toBe(0);
  expect(missing.err).toContain("refusing to start (PLATFORM_ENV=production)");
  for (const word of ["SERVICE_TURN_SECRET of at least 32", "NETWORK_SERVICE_TOKENS (the staff API"]) expect(missing.err).toContain(word);
  const weak = await run({ SERVICE_TURN_SECRET: "t".repeat(31), NETWORK_SERVICE_TOKENS: `${staff},reviewer@friends:short-token` });
  expect(weak.code).not.toBe(0);
  for (const word of ["SERVICE_TURN_SECRET of at least 32", "every NETWORK_SERVICE_TOKENS token"]) expect(weak.err).toContain(word);
  const reused = await run({ SERVICE_TURN_SECRET: "a".repeat(40), NETWORK_SERVICE_TOKENS: staff });
  expect(reused.code).not.toBe(0);
  expect(reused.err).toContain("not also a NETWORK_SERVICE_TOKENS token");
  // A token list that does not parse names the variable the operator set.
  const unparsed = await run({ SERVICE_TURN_SECRET: "t".repeat(40), NETWORK_SERVICE_TOKENS: `admin:${"a".repeat(40)}` });
  expect(unparsed.code).not.toBe(0);
  expect(unparsed.err).toContain("NETWORK_SERVICE_TOKENS");
  expect(unparsed.err).not.toContain("OBSERVATORY_TOKENS");
}, 120_000);

test("with NETWORK_CHANNEL=eliza_cloud serveService does not serve the Blooio webhook; otherwise it does", async () => {
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
