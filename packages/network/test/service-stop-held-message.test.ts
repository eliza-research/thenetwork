// A STOP that arrives while a text waits for the person's answer wins (packages/blooio README: "a STOP
// that arrives while a message waits wins"; PRD 32.9). The legacy webhook marked every inbound as an
// engagement before the STOP was recorded, which released held rows to the queue; a tick between the two
// sent the text after the person opted out. Postgres in a database of its own; Blooio with a fake provider.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_stop_held_message_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const SECRET = "whsec_shared", APP_SECRET = "whsec_app";
const NETS = [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }, { id: "slop:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }];
class FakeOtp implements OtpProvider { readonly name = "fake"; async send() { return { code: "000000" }; } }
let phoneSeq = 0;
/** Fictional numbers only (+1 212 555 01xx). */
const newPhone = () => `+121255501${String(10 + ++phoneSeq).padStart(2, "0")}`;
let sql: SQL;
const open: NetworkService[] = [];
let evt = 0;
function webhook(clock: SimClock, from: string, body: string, app: AppId) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  return new Request(`http://127.0.0.1${WEBHOOK_PATH}/${app}`, { method: "POST",
    headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(APP_SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw });
}

/** A friends.help member with one transactional text that Blooio's conversation limit holds until they write. */
async function heldText(clock: SimClock) {
  const flags = { BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1", FRIENDS_LIVE_APPROVED: "1" };
  const sent: SendRequest[] = [];
  const provider = { kind: "blooio" as const, send: async (r: SendRequest) => { sent.push(r); return { providerMessageId: `p${sent.length}`, status: "queued" as const }; } };
  const s = new NetworkService({ url: URL_, clock, instance: "stop-held", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, webhookSecrets: { friends: APP_SECRET, slop: APP_SECRET },
    network: { seed: 1 }, publicApi: { otp: new FakeOtp(), minStartMs: 0, minVerifyMs: 0 },
    adapter: (_net, rt) => new BlooioAdapter({ from: "+12125550100", provider, clock, env: flags, app: rt.app.id, log: () => {} }) });
  open.push(s);
  await s.start();
  const p = newPhone();
  const joined = await s.fetch(webhook(clock, p, "Wu 33", "friends"));
  expect((await joined.json()).result).toBe("joined");
  clock.advance(MINUTE);
  const rt = s.runtimeFor("friends")!;
  const queue = (rt.adapter as BlooioAdapter).queue;
  const [m] = await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'friends' and ph.e164 = ${p}`;
  await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, proactive, system, ts) values ('friends', 'held-1', ${m.id}, 'outbound', 'imessage', 'A reminder about tonight.', 'queued', false, false, ${new Date(clock.now())})`;
  await queue.enqueue(sql, [{ id: "held-1", memberId: m.id, to: p, kind: "transactional", text: "A reminder about tonight.", city: "nyc" }]);
  await sql`update platform.outbound set status = 'held_awaiting_reply', note = 'conversation_awaiting_reply' where id = 'held-1'`;
  sent.length = 0;
  // The other instance's tick: a drain right after this instance marks the sender engaged.
  let engaged = 0;
  for (const r of s.runtimes.values()) {
    const real = r.adapter.engaged!.bind(r.adapter);
    r.adapter.engaged = async (address: string) => { engaged++; await real(address); await queue.drain(); };
  }
  return { s, p, memberId: m.id as string, sent, engaged: () => engaged };
}
const held = async () => (await sql`select status from platform.outbound where id = 'held-1'`)[0]!.status as string;

describe.skipIf(!pgAvailable)("STOP against a text held for the person's answer (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => { await sql?.close(); await admin(`drop database if exists ${DB} with (force)`).catch(() => {}); });

  test("STOP: the held text is not released and not sent, the member is opted out", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const w = await heldText(clock);
    expect((await w.s.fetch(webhook(clock, w.p, "STOP", "friends"))).status).toBe(200);
    const [member] = await sql`select opted_out from network.members where id = ${w.memberId}`;
    expect(member.opted_out).toBe(true);
    // Before the fix: engaged() released the row, the drain sent "A reminder about tonight." before the STOP was recorded.
    expect(w.sent.map(r => r.text)).not.toContain("A reminder about tonight.");
    expect(await held()).toBe("held_awaiting_reply");
    expect(w.engaged()).toBe(0);
  }, T);

  test("control: any other text from the person releases the held text and it goes out", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const w = await heldText(clock);
    expect((await w.s.fetch(webhook(clock, w.p, "sounds good", "friends"))).status).toBe(200);
    expect(w.engaged()).toBe(1);
    expect(w.sent.map(r => r.text)).toContain("A reminder about tonight.");
    expect(await held()).not.toBe("held_awaiting_reply");
  }, T);
});
