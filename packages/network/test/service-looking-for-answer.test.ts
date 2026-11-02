// The answer to The Network's "what are you looking for?" that is one app's own word ("friends", "friends.help") enrolls the
// person in that app (service.ts header: "with no keyword a stranger joins The Network ... then \"what are you looking for?\"
// (friends, dating, work), which enrolls them"). It is not a keyword join that asks for name and age again.
// Postgres in a database of its own per test process; dry-run adapters, nothing is sent.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { enrolledText, LOOKING_FOR_ASK, NetworkService, WEBHOOK_PATH, type ServiceOptions } from "../service/service.ts";

import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_looking_for_answer_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string, url = ADMIN_URL) { const sql = new SQL({ url, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const SECRET = "whsec_shared", APP_SECRET = "whsec_app";
const NETS = [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }, { id: "slop:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }];
let phoneSeq = 0;
const newPhone = () => `+121255501${String(10 + ++phoneSeq).padStart(2, "0")}`;
let sql: SQL;
const open: NetworkService[] = [];
interface Direct { app: string; to: string; body: string }
function service(clock: SimClock, more: Partial<ServiceOptions> = {}) {
  const directs: Direct[] = [];
  const s = new NetworkService({
    url: URL_, clock, instance: "looking-for", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, webhookSecrets: { friends: APP_SECRET, slop: APP_SECRET },
    network: { seed: 1 }, publicApi: { minStartMs: 0, minVerifyMs: 0 } as any,
    adapter: (_net, rt) => { const a = new DryRunAdapter(() => {}); a.direct = async (to, body) => { directs.push({ app: rt.app.id, to, body }); return "dry_run"; }; return a; },
    ...more,
  });
  open.push(s);
  return { s, directs };
}
let evt = 0;
function webhook(clock: SimClock, from: string, body: string, o: { app?: AppId } = {}) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  return new Request(`http://127.0.0.1${WEBHOOK_PATH}${o.app ? `/${o.app}` : ""}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(o.app ? APP_SECRET : SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  });
}
async function text(s: NetworkService, clock: SimClock, from: string, body: string, o: { app?: AppId } = {}) {
  const res = await s.fetch(webhook(clock, from, body, o));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const count = async (q: Promise<any[]>) => (await q)[0].n as number;
const memberOf = async (app: AppId, e164: string) =>
  (await sql`select m.id, m.account_status, m.opted_out, m.age from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string; account_status: string; opted_out: boolean; age: number | null } | undefined;
const outbound = async (member: string) => (await sql`select id, body, type, system, status from network.messages where member_id = ${member} and direction = 'outbound' order by ts, id`) as any[];
const memberships = async (e164: string) => (await sql`select m.app_id, m.state from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id where ph.e164 = ${e164} order by app_id`).map((r: any) => `${r.app_id}:${r.state}`);

describe.skipIf(!pgAvailable)("the answer to \"what are you looking for?\" (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => { await sql?.close(); await admin(`drop database if exists ${DB} with (force)`).catch(() => {}); });
  const fresh = async () => { await applySchema(URL_, { reset: true, lockTimeout: "5s" }); };

  const pending = async () => (await sql`select kind, app_id from platform.pending_texts order by kind`).map((r: any) => `${r.kind}:${r.app_id}`);

  for (const answer of ["friends", "Friends!", "friends.help"]) {
    test(`"${answer}" as the answer enrolls friends.help: no second name-and-age ask, no join pending`, async () => {
      await fresh();
      const clock = new SimClock(START);
      const { s, directs } = service(clock);
      const mo = newPhone();
      expect(await text(s, clock, mo, "hey there")).toBe("join_asked");
      expect(await text(s, clock, mo, "Mo, 30")).toBe("joined");
      const nm = (await memberOf("ntwrk", mo))!;
      expect((await outbound(nm.id)).map(m => m.body)).toContain(LOOKING_FOR_ASK);
      expect(await pending()).toEqual(["looking_for:ntwrk"]);
      const before = directs.length;
      // Before the fix: "join_asked", friends asks for name and age, and pending_texts holds join:friends too.
      expect(await text(s, clock, mo, answer)).toBe("handled");
      expect(await memberships(mo)).toEqual(["friends:active", "ntwrk:active"]);
      expect((await outbound(nm.id)).at(-1).body).toBe(enrolledText([APPS.friends]));
      expect(directs.length).toBe(before);
      expect(await pending()).toEqual([]);
    }, T);
  }

  test("control: without the question pending, \"friends\" is still the keyword join of friends.help", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "friends")).toBe("join_asked");
    expect(await pending()).toEqual(["join:friends"]);
    expect(await text(s, clock, p, "Ida, 31")).toBe("joined");
    expect(await memberships(p)).toEqual(["friends:active"]);
  }, T);

  test("after the answer, \"friends\" routes to friends.help as any member text does", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "hello")).toBe("join_asked");
    expect(await text(s, clock, p, "Lee, 29")).toBe("joined");
    expect(await text(s, clock, p, "friends and work")).toBe("handled");
    expect(await memberships(p)).toEqual(["friends:active", "ntwrk:active", "peon:active"]);
    expect(await text(s, clock, p, "friends")).toBe("handled");
    expect((await sql`select app_id from network.messages where direction = 'inbound' and body = 'friends'`).map((r: any) => r.app_id)).toEqual(["friends"]);
  }, T);
});
