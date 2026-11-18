// docs/deploy.md section 6, the live-send table (audit PER34, SHA41: founder decisions; this file pins the current behavior).
// The global flags are on and FRIENDS_LIVE_APPROVED and PEON_LIVE_APPROVED are unset: those apps' queued sends stay
// dry-run, but a signed /internal/turn still returns the onboarding replies for the Eliza gateway to send.
// A change that gates turn replies per app makes this file fail; then update the table in docs/deploy.md and
// docs/go-live-handoff.md and liveSendTable in deploy/backend/backend.ts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { applySchema, DEV_PG_PORT } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter, liveSendAllowed } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

const db = `network_live_send_table_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({ url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:${DEV_PG_PORT}/postgres`, max: 1 });
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:${DEV_PG_PORT}/${db}`;
const secret = "synthetic-live-send-table-turn-secret-20261118";
const clock = new SimClock(Date.UTC(2026, 10, 18, 16));
const env = { PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: "synthetic-live-send-table-hash-key", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" };
let service: NetworkService, server: HttpServer;
let queued = 0;

beforeAll(async () => {
  await admin.unsafe(`create database ${db}`);
  await applySchema(url, { lockTimeout: "5s" });
  service = new NetworkService({
    url, clock, photoStorage: null, instance: "live-send-table", env, network: { seed: 1 }, log: () => {},
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }],
    adapter: () => {
      const a = new DryRunAdapter(() => {});
      a.direct = async () => { queued++; return "dry_run"; };
      a.deliver = async rows => { queued += rows.length; return rows.map(r => ({ id: r.id, status: "dry_run" })); };
      return a;
    },
  });
  await service.start();
  server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req) });
}, 120_000);
afterAll(async () => {
  await server?.stop(true);
  await service?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(() => {});
  await admin.close();
});

const post = async (input: TurnRequest) => {
  const body = JSON.stringify(input);
  return fetch(new URL(TURN_PATH, server.url), {
    method: "POST",
    headers: { "content-type": "application/json", ...await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) }) },
    body,
  });
};

test("without its own approval flag, friends and peon queued sends are dry-run, and signed-turn replies still go back to the gateway", async () => {
  expect(liveSendAllowed(env, "ntwrk")).toBe(true);
  for (const [app, from] of [["friends", "+12125550171"], ["peon", "+12125550172"]] as const) {
    expect(liveSendAllowed(env, app)).toBe(false);
    const r = await post({ messageId: `live-table-${app}`, from, text: app, channel: "blooio", to: null, transport: "imessage", receivedAt: clock.now() });
    expect(r.status).toBe(200);
    const answer = await r.json() as { outcome: string; app: string; delivery: string; replies: string[] };
    expect(answer).toMatchObject({ outcome: "handled", app, delivery: "collected" });
    expect(answer.replies.length).toBeGreaterThan(0);
  }
  expect(queued).toBe(0);
}, 60_000);
