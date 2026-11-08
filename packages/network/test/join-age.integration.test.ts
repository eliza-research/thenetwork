// The join paths and the age policy (machines text-join, web-join, age-floor, member-age-policy,
// minor-single-player, looking-for-enroll; docs/research/quint-findings/join_age.md). The real service
// over HTTP with signed turns and a real Postgres (dev-pg, :54339). Sends are dry-run. Each case is a
// defect of the state-machine register (docs/research/2026-11-07-state-machines.md section 5).
import {afterAll, beforeAll, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock, DAY, MINUTE} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH, type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

const db = `network_join_age_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max: 1});
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const secret = "synthetic-join-age-test-secret-2026110800";
const clock = new SimClock(Date.UTC(2026, 10, 8, 16));
let sql: SQL, service: NetworkService, server: ReturnType<typeof Bun.serve>, cloud: ReturnType<typeof Bun.serve>;
let seq = 0;

beforeAll(async () => {
  await admin.unsafe(`create database ${db}`);
  await applySchema(url, {lockTimeout: "5s"});
  sql = new SQL({url, max: 2});
  cloud = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ok: false, error: "rejected", retryable: false})});
  service = new NetworkService({url, clock, photoStorage: null, instance: "join-age-integration",
    env: {PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret, NETWORK_CLOUD_DELIVERY_ORIGIN: cloud.url.origin},
    networks: [{id: "ntwrk:nyc", matchingEnabled: false}, {id: "slop:nyc", matchingEnabled: false}, {id: "friends:nyc", matchingEnabled: false}],
    network: {seed: 1}, notify: false, log: () => {},
    adapter: () => new DryRunAdapter(() => {}),
  });
  await service.start();
  server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req)});
}, 120_000);
afterAll(async () => {
  server?.stop(true); cloud?.stop(true); await service?.close(); await sql?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(() => {}); await admin.close();
});

const say = async (from: string, text: string, app?: TurnRequest["app"]) => {
  const input: TurnRequest = {messageId: `SMja${++seq}`, channel: "blooio", from, to: null, text, transport: "imessage", receivedAt: clock.now(), ...(app ? {app} : {})};
  const body = JSON.stringify(input);
  const headers = await svcSign(secret, {method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000)});
  const r = await fetch(new URL(TURN_PATH, server.url), {method: "POST", headers: {"content-type": "application/json", ...headers}, body});
  expect(r.status).toBe(200);
  clock.advance(MINUTE);
  return r.json() as Promise<any>;
};

test("SD-010: an age held in a pending join is not replaced by a later, older age", async () => {
  const phone = "+12125550301";
  await say(phone, "friends.help", "friends");
  const asked = await say(phone, "15", "friends");
  expect(asked.outcome).toBe("handled");
  expect(asked.memberId).toBeNull();
  const joined = await say(phone, "Sam 25", "friends");
  expect(joined.reason).toBe("joined");
  // The lowest stated age wins: the person, the phone's age floor and the network member all keep 15.
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
}, 60_000);

test("SD-010: an age held in a pending join that expires stays on the phone's age floor", async () => {
  const phone = "+12125550302";
  await say(phone, "friends.help", "friends");
  await say(phone, "15", "friends");
  clock.advance(DAY); // the pending join expires (PENDING_MS)
  expect((await say(phone, "Sam 25", "friends")).reason).toBe("joined");
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
}, 60_000);
