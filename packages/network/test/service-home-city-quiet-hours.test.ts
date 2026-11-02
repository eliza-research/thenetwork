// Quiet hours follow the member's home city, not the network's (PRD 31: "quiet-hours enforcement in the
// member's local time"; 36.1: "quiet hours in the recipient's time zone"). The seeded networks are one
// per app in New York (migration 0003); a member whose home is San Francisco is served by that network
// (conversationCities). Their agent-initiated texts must wait for 9am in San Francisco, not New York.
// Postgres in a database of its own per test process; Blooio with a fake provider, nothing is sent.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_home_city_quiet_hours_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_shared";
/** The production layout: one network per app, in New York (migration 0003). No San Francisco network. */
const NETS = [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }, { id: "slop:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }];
// The joins happen the afternoon before (15:00 in New York, 12:00 in San Francisco: outside both quiet windows).
const JOIN_AT = Date.UTC(2026, 9, 19, 19);
// 14:30 UTC on a Tuesday: 10:30 in New York (outside quiet hours), 07:30 in San Francisco (inside 21:00-09:00).
const AT = Date.UTC(2026, 9, 20, 14, 30);
let phoneSeq = 0;
/** Fictional numbers only (+1 212 555 01xx). */
const newPhone = () => `+121255501${String(10 + ++phoneSeq).padStart(2, "0")}`;

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  async send() { return { code: "000000" }; }
}

let sql: SQL;
const open: NetworkService[] = [];

function service(clock: SimClock) {
  const sent: SendRequest[] = [];
  const s = new NetworkService({
    url: URL_, clock, instance: "home-city", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, network: { seed: 1 }, publicApi: { otp: new FakeOtp(), minStartMs: 0, minVerifyMs: 0 },
    adapter: (_net, rt) => new BlooioAdapter({
      from: "+12125550100", clock, app: rt.app.id, city: rt.city, liveGate: () => true, log: () => {},
      provider: { kind: "sim", send: async request => { sent.push(request); return { providerMessageId: request.idempotencyKey, status: "sent" }; } },
    }),
  });
  open.push(s);
  return { s, sent };
}

let evt = 0;
async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const memberOf = async (e164: string) =>
  (await sql`select m.id, m.home_city from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'ntwrk' and ph.e164 = ${e164}`)[0] as { id: string; home_city: string };
const row = async (id: string) => (await sql`select status, time_zone from platform.outbound where id = ${id}`)[0] as { status: string; time_zone: string };

describe.skipIf(!pgAvailable)("quiet hours follow the member's home city (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("a San Francisco member on the New York network: an agent-initiated text at 07:30 their time waits for 09:00 in San Francisco; a New York member's goes now", async () => {
    const clock = new SimClock(JOIN_AT);
    const { s, sent } = service(clock);
    const sf = newPhone(), ny = newPhone();
    expect(await text(s, clock, sf, "My home is Bay Area.")).toBe("join_asked");
    expect(await text(s, clock, sf, "Mira, 31")).toBe("joined");
    expect(await text(s, clock, ny, "Theo, 32")).toBe("joined");
    const mira = await memberOf(sf), theo = await memberOf(ny);
    expect(mira.home_city).toBe("sf");
    expect(theo.home_city).toBe("nyc");
    const rt = s.runtimeFor("ntwrk")!;
    expect(await s.runtimeOfMember("ntwrk", mira.id)).toBe(rt);

    clock.set(AT);
    const before = sent.length;
    // The same kind of text the notify scheduler and the Network's reminders send (never a reply).
    await rt.unitOfWork(() => { rt.system(mira.id, "sf-reminder", "Your plan is confirmed for Thursday.", "transactional", "notify"); rt.system(theo.id, "ny-reminder", "Your plan is confirmed for Thursday.", "transactional", "notify"); });
    const queue = (rt.adapter as BlooioAdapter).queue;
    await queue.drain();
    expect(await row("ny-reminder")).toEqual({ status: "sent", time_zone: "America/New_York" });
    // Before the fix: time_zone America/New_York, status sent (a text at 07:30 in San Francisco).
    expect(await row("sf-reminder")).toEqual({ status: "deferred_quiet_hours", time_zone: "America/Los_Angeles" });
    expect(sent.slice(before).map(r => r.to)).toEqual([ny]);

    // 09:00 in San Francisco (16:00 UTC): the text goes.
    clock.set(Date.UTC(2026, 9, 20, 16, 0));
    await queue.drain();
    expect((await row("sf-reminder")).status).toBe("sent");
    expect(sent.slice(before).map(r => r.to)).toEqual([ny, sf]);
  }, T);

  test("the notify scheduler holds a San Francisco member's inbox item for their quiet hours and sends a New York member's", async () => {
    const clock = new SimClock(JOIN_AT);
    const { s, sent } = service(clock);
    const sf = newPhone(), ny = newPhone();
    expect(await text(s, clock, sf, "My home is Bay Area.")).toBe("join_asked");
    expect(await text(s, clock, sf, "Noor, 34")).toBe("joined");
    expect(await text(s, clock, ny, "Ira, 29")).toBe("joined");
    const noor = await memberOf(sf), ira = await memberOf(ny);
    expect([noor.home_city, ira.home_city]).toEqual(["sf", "nyc"]);
    clock.set(AT);
    const before = sent.length;
    for (const [phone, who] of [[sf, "noor"], [ny, "ira"]] as const) {
      const person = (await s.accounts.personFor(phone))!;
      await s.notify!.add({ personId: person.id, app: "ntwrk", eventType: "plan", subjectId: `${who}-plan`, urgency: "requested", summary: "Dinner is confirmed.", expiresAt: clock.now() + 6 * HOUR }, clock.now());
    }
    await s.notifyTick();
    // Before the fix the recipient's zone was the network's (New York): both texts went out, Noor's at 07:30 her time.
    expect(sent.slice(before).map(r => r.to)).toEqual([ny]);
    // The notify rows (the joins' own replies and asks were queued earlier).
    const rows = async (memberId: string) => (await sql`select status, time_zone from platform.outbound where member_id = ${memberId} and created_at >= ${new Date(AT)}`) as { status: string; time_zone: string }[];
    expect(await rows(ira.id)).toEqual([{ status: "sent", time_zone: "America/New_York" }]);
    expect(await rows(noor.id)).toEqual([]);

    clock.set(Date.UTC(2026, 9, 20, 16, 0));
    await s.notifyTick();
    expect(sent.slice(before).map(r => r.to)).toEqual([ny, sf]);
    expect(await rows(noor.id)).toEqual([{ status: "sent", time_zone: "America/Los_Angeles" }]);
  }, T);
});
