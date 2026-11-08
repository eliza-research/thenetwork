// The single inbox in the production service (packages/notify; service.ts `delivered`): every
// member-facing Network text that went out becomes one inbox item, so the person's assistant sees
// each update and a proactive text counts toward the weekly cap. Postgres in a database of its own
// per test process. Nothing is sent: dry-run adapters.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock, type MemberId } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter, type Outbound } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_notify_inbox_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const s = new SQL({ url: ADMIN_URL, max: 1 }); try { await s.unsafe("set lock_timeout = '5s'"); await s.unsafe(q); } finally { await s.close(); } }

const SECRET = "whsec_shared", APP_SECRET = "whsec_app";
let sql: SQL;
const open: NetworkService[] = [];

function service(clock: SimClock) {
  const s = new NetworkService({
    url: URL_, clock, instance: "inbox", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }],
    tokens: "admin:adm-tok", webhookSecret: SECRET, webhookSecrets: { friends: APP_SECRET },
    network: { seed: 1 }, adapter: () => new DryRunAdapter(() => {}),
  });
  open.push(s);
  return s;
}

/** A Blooio webhook text from a fictional number (+1 212 555 01xx) to friends. */
async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const raw = JSON.stringify({ id: `evt_inbox_${clock.now()}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_inbox_${clock.now()}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}/friends`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(APP_SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
}

describe.skipIf(!pgAvailable)("the single inbox in the service (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    for (const s of open) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("SD-303 a second Network text about one opportunity becomes its own inbox item and counts toward the cap", async () => {
    const clock = new SimClock(START);
    const s = service(clock);
    const phone = "+12125550171";
    await text(s, clock, phone, "Sol 36");
    const m = (await sql`select m.id, m.person_id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'friends' and ph.e164 = ${phone}`)[0] as { id: MemberId; person_id: string };
    const rt = s.runtimeFor("friends")!;
    const reminder = (id: string, body: string): Outbound =>
      ({ id, memberId: m.id, body, kind: "proactive", type: "reminder", oppId: "opp_inbox_1", proactive: true, system: false, ts: clock.now(), acceptedAt: clock.now() });
    await s.delivered(rt, [reminder("msg_r1", "Your climb with Ana is tomorrow at 6pm.")]);
    clock.advance(20 * HOUR);
    await s.delivered(rt, [reminder("msg_r2", "Your climb with Ana is in two hours.")]);
    // The projection repeats a text after a crash: still one item for it.
    await s.delivered(rt, [reminder("msg_r2", "Your climb with Ana is in two hours.")]);
    const items = await sql`select i.summary, i.delivery_id from notify.inbox_items i where i.person_id = ${m.person_id} order by i.created_at`;
    expect(items.map((r: { summary: string; delivery_id: string }) => [r.summary, r.delivery_id])).toEqual([
      ["Your climb with Ana is tomorrow at 6pm.", "net:msg_r1"],
      ["Your climb with Ana is in two hours.", "net:msg_r2"],
    ]);
    const counted = await sql`select delivery_id from notify.deliveries where person_id = ${m.person_id} and counts_toward_cap order by delivery_id`;
    expect(counted.map((r: { delivery_id: string }) => r.delivery_id)).toEqual(["net:msg_r1", "net:msg_r2"]);
  }, T);
});
