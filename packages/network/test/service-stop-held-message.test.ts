import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../db/dev-pg.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const USER = process.env.USER ?? "postgres";
const DB = `network_stop_held_message_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const SECRET = "whsec_shared", APP_SECRET = "whsec_app";
const TURN_SECRET = "synthetic-turn-secret-for-opt-out-hold-tests-123456";
const NETS = [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }, { id: "slop:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }];
class FakeOtp implements OtpProvider { readonly name = "fake"; async send() { return { code: "000000" }; } }
let phoneSeq = 0;
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

async function signedTurn(clock: SimClock, from: string, text: string) {
  const id = `stop-held-${++evt}`;
  const body = JSON.stringify({messageId: id, channel: "blooio", from, to: null, text,
    transport: "imessage", receivedAt: clock.now(), app: "friends"});
  const headers = await svcSign(TURN_SECRET, {method: "POST", path: TURN_PATH, id, body, nowS: Math.floor(clock.now() / 1000)});
  return new Request(`http://127.0.0.1${TURN_PATH}`, {method: "POST", headers: {"content-type": "application/json", ...headers}, body});
}

async function heldText(clock: SimClock) {
  const sent: SendRequest[] = [];
  const provider = { kind: "blooio" as const, send: async (r: SendRequest) => { sent.push(r); return { providerMessageId: `p${sent.length}`, status: "queued" as const }; } };
  const s = new NetworkService({ url: URL_, clock, instance: "stop-held", log: () => {}, env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: TURN_SECRET }, networks: NETS,
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, webhookSecrets: { friends: APP_SECRET, slop: APP_SECRET },
    network: { seed: 1 }, publicApi: { otp: new FakeOtp(), minStartMs: 0, minVerifyMs: 0 },
    adapter: (_net, rt) => new BlooioAdapter({ from: "+12125550100", provider, clock, env: {}, app: rt.app.id, log: () => {} }) });
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
  let engaged = 0;
  for (const r of s.runtimes.values()) {
    const real = r.adapter.engaged!.bind(r.adapter);
    r.adapter.engaged = async (address: string) => { engaged++; await real(address); await queue.drain(); };
  }
  return { s, p, memberId: m.id as string, sent, engaged: () => engaged };
}
const held = async () => (await sql`select status from platform.outbound where id = 'held-1'`)[0]!.status as string;

describe("STOP or an app leave against a text held for the person's answer (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => { await sql?.close(); await admin(`drop database if exists ${DB} with (force)`).catch(() => {}); });

  test.each(["STOP", "STOP ALL"])("%s keeps a held text parked and opts out the member", async command => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const w = await heldText(clock);
    expect((await w.s.fetch(webhook(clock, w.p, command, "friends"))).status).toBe(200);
    const [member] = await sql`select opted_out from network.members where id = ${w.memberId}`;
    expect(member.opted_out).toBe(true);
    expect(w.sent.map(r => r.text)).not.toContain("A reminder about tonight.");
    expect(await held()).toBe("held_awaiting_reply");
    expect(w.engaged()).toBe(0);
  }, T);

  test.each(["legacy", "signed"])("a %s leave of Slop preserves an unrelated held Friends text", async transport => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const w = await heldText(clock);
    const joined = await w.s.accounts.join(APPS.slop, {e164: w.p, personId: null},
      {firstName: "Wu", age: 33, consent: {sms: true, wording: APPS.slop.consent.text}});
    expect(joined.ok).toBe(true);
    const command = "leave slop.date";
    const response = await w.s.fetch(transport === "legacy" ? webhook(clock, w.p, command, "friends") : await signedTurn(clock, w.p, command));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(transport === "legacy" ? {result: "left"} : {
      reason: "left", consent: {state: "opted_out", scope: "app", app: "slop"},
    });
    expect(w.engaged()).toBe(0);
    expect(w.sent.map(r => r.text)).not.toContain("A reminder about tonight.");
    expect(await held()).toBe("held_awaiting_reply");
    expect((await w.s.fetch(webhook(clock, w.p, "sounds good", "friends"))).status).toBe(200);
    expect(w.engaged()).toBe(1);
    expect(w.sent.map(r => r.text)).toContain("A reminder about tonight.");
  }, T);

  test("leave friends.help: the held friends.help text is not released and not sent, the app is left", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const w = await heldText(clock);
    const res = await w.s.fetch(webhook(clock, w.p, "leave friends.help", "friends"));
    expect((await res.json()).result).toBe("left");
    const [consent] = await sql`select state from platform.consent_events where e164 = ${w.p} and app_id = 'friends' order by id desc limit 1`;
    expect(consent.state).toBe("opted_out");
    expect(w.sent.map(r => r.text)).not.toContain("A reminder about tonight.");
    expect(await held()).toBe("dropped_forgotten");
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
