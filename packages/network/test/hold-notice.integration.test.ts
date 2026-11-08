// The hold notice is a safety notice (SD-475). When staff hold a member, the Network sends copy.hold
// at once ("You'll hear from a person soon"). The service queued it as a "transactional" row: at
// dispatch the recipient check refused it because the member is on hold, quiet hours deferred it,
// and the unanswered streak could hold it. The row now has its own kind "safety": consent, the
// leak guard and the ban still apply; the hold, quiet hours, the streak and the line caps do not.
// Postgres in a database of its own per test process; a fake provider; fictional numbers (+1 212 555 01xx).
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { copy } from "../src/copy.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_hold_notice_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_hold_notice";
const NETS = [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }, { id: "peon:nyc" }, { id: "friends:nyc" }];
let phoneSeq = 30;
const newPhone = () => `+121255501${String(++phoneSeq).padStart(2, "0")}`;

let sql: SQL;
const open: NetworkService[] = [];
function service(clock: SimClock, sent: SendRequest[]) {
  const s = new NetworkService({
    url: URL_, clock, instance: "hold-notice", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,safety:saf-tok", webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null,
    adapter: (_net, rt) => new BlooioAdapter({
      from: "+12125550100", clock, app: rt.app.id, liveGate: () => true, log: () => {},
      provider: { kind: "sim", send: async request => { sent.push(request); return { providerMessageId: request.idempotencyKey, status: "sent" }; } },
    }),
  });
  open.push(s);
  return s;
}

let evt = 0;
async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const staff = async (s: NetworkService, path: string, b: unknown) =>
  (await s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method: "POST", headers: { authorization: "Bearer saf-tok", "content-type": "application/json" }, body: JSON.stringify(b) }))).json();
const memberOf = async (app: AppId, e164: string) =>
  (await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164} and m.account_status not in ('invited', 'removed')`)[0]?.id as string | undefined;
const holdRows = async (memberId: string) =>
  (await sql`select kind, status from platform.outbound where member_id = ${memberId} and body = ${copy.hold}`) as { kind: string; status: string }[];

describe.skipIf(!pgAvailable)("the hold notice is a safety notice (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    for (const s of open) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  const holdAt = async (offset: number) => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const sent: SendRequest[] = [];
    const s = service(clock, sent);
    await s.start();
    const bea = newPhone();
    expect(await text(s, clock, bea, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, bea, "Bea, 30")).toBe("joined");
    const id = (await memberOf("friends", bea))!;
    const queue = (s.runtimeFor("friends")!.adapter as BlooioAdapter).queue;
    await queue.drain();
    clock.advance(offset);
    sent.length = 0;
    expect(await staff(s, "/apps/friends/safety/hold", { memberId: id, note: "report after a meetup" })).toEqual({ ok: true });
    await queue.drain();
    return { id, sent, bea };
  };

  test("SD-475: a staff hold sends the hold notice to the held member at once", async () => {
    const { id, sent, bea } = await holdAt(HOUR);
    expect(await holdRows(id)).toEqual([{ kind: "safety", status: "sent" }]);
    expect(sent.filter(r => r.to === bea && r.text === copy.hold)).toHaveLength(1);
  }, T);

  test("SD-475: a staff hold in quiet hours sends the hold notice at once", async () => {
    // START is 13:00 in New York; 11 hours later is 00:00, in the default quiet hours.
    const { id, sent } = await holdAt(11 * HOUR);
    expect(await holdRows(id)).toEqual([{ kind: "safety", status: "sent" }]);
    expect(sent.filter(r => r.text === copy.hold)).toHaveLength(1);
  }, T);
});
