// A safety hold follows the person, not one member id (PRD 40.3: "A safety hold alone does not refuse a
// join, but the person cannot be matched until staff resolve it"). SD-021: a leave and a rejoin (a new
// member id) do not clear a hold or a minor report. SD-022: a join on another app during a hold is held,
// and an app that the staff hold loop did not reach is held at its next tick. Only a staff lift ends it.
// Postgres in a database of its own per test process; dry-run sends; fictional numbers (+1 212 555 01xx).
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_person_hold_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_person_hold";
const NETS = [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }, { id: "peon:nyc" }, { id: "friends:nyc" }];
let phoneSeq = 60;
const newPhone = () => `+121255501${String(++phoneSeq).padStart(2, "0")}`;

let sql: SQL;
const open: NetworkService[] = [];
function service(clock: SimClock) {
  const s = new NetworkService({
    url: URL_, clock, instance: "person-hold", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,safety:saf-tok,safety@friends:fr-safety-tok", webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null,
    adapter: () => new DryRunAdapter(() => {}),
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
const staff = async (s: NetworkService, token: string, path: string, b: unknown) =>
  (await s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(b) }))).json();
const memberOf = async (app: AppId, e164: string) =>
  (await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164} and m.account_status not in ('invited', 'removed')`)[0]?.id as string | undefined;
/** The member's trust level in the stored state of the app's Network ("ok" when it has no record). */
const level = async (app: AppId, id: string) => {
  const st = (await sql`select state from network.network_state where id = ${`${app}:nyc`}`)[0]?.state;
  const x = typeof st === "string" ? JSON.parse(st) : st;
  return ((x?.trust ?? []) as { id: string; level: string }[]).find(t => t.id === id)?.level ?? "ok";
};
const join = async (s: NetworkService, clock: SimClock, phone: string, keyword: string, who: string) => {
  expect(await text(s, clock, phone, keyword)).toBe("join_asked");
  expect(await text(s, clock, phone, who)).toBe("joined");
};

describe.skipIf(!pgAvailable)("a safety hold follows the person (Postgres)", () => {
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
  const fresh = async () => { await applySchema(URL_, { reset: true, lockTimeout: "5s" }); };

  test("SD-021: a leave and a rejoin do not clear a staff hold; a staff lift ends it", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    await s.start();
    const bea = newPhone();
    await join(s, clock, bea, "friends.help", "Bea, 30");
    const first = (await memberOf("friends", bea))!;
    expect(await staff(s, "saf-tok", "/apps/friends/safety/hold", { memberId: first, note: "report after a meetup" })).toEqual({ ok: true });
    expect(await level("friends", first)).toBe("hold");

    expect(await text(s, clock, bea, "leave friends.help")).toBe("left");
    await join(s, clock, bea, "friends.help", "Bea, 30");
    const again = (await memberOf("friends", bea))!;
    expect(again).not.toBe(first);
    expect(await level("friends", again)).toBe("hold");

    // Staff with safety on friends only cannot lift a hold on every app; safety@* can.
    expect(await staff(s, "fr-safety-tok", "/apps/friends/safety/lift", { memberId: again, note: "reviewed" })).toEqual({ ok: false, reason: "needs_safety_everywhere" });
    expect(await staff(s, "saf-tok", "/apps/friends/safety/lift", { memberId: again, note: "reviewed, no action" })).toEqual({ ok: true });
    await s.tick();
    expect(await level("friends", again)).toBe("ok");
  }, T);

  test("SD-021: a leave and a rejoin do not clear a report that the member is a minor", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    await s.start();
    const ana = newPhone(), ben = newPhone();
    await join(s, clock, ana, "friends.help", "Ana, 30");
    await join(s, clock, ben, "friends.help", "Ben, 30");
    expect(await text(s, clock, ana, "report Ben, he told me he is 15")).toBe("handled");
    const minorReports = await s.runtimeFor("friends")!.readState(n => n.safetyReports().filter(r => r.kind === "minor").length);
    expect(minorReports).toBe(1);

    expect(await text(s, clock, ben, "leave friends.help")).toBe("left");
    await join(s, clock, ben, "friends.help", "Ben, 30");
    expect(await level("friends", (await memberOf("friends", ben))!)).toBe("hold");
  }, T);

  test("SD-022: a join on another app during a hold is held", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    await s.start();
    const cy = newPhone();
    await join(s, clock, cy, "friends.help", "Cy, 30");
    expect(await staff(s, "saf-tok", "/apps/friends/safety/hold", { memberId: (await memberOf("friends", cy))!, note: "report after a meetup" })).toEqual({ ok: true });
    await join(s, clock, cy, "peon.biz", "Cy, 30");
    expect(await level("peon", (await memberOf("peon", cy))!)).toBe("hold");
  }, T);

  test("SD-022: an app that the hold loop did not reach (a stop between units) is held at its next tick", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    await s.start();
    const dee = newPhone();
    await join(s, clock, dee, "friends.help", "Dee, 30");
    await join(s, clock, dee, "peon.biz", "Dee, 30");
    const fr = (await memberOf("friends", dee))!, pe = (await memberOf("peon", dee))!;
    // The process stops after the friends unit: the peon unit never runs.
    const peon = s.runtimeFor("peon")!;
    const unit = peon.unitOfWork.bind(peon);
    peon.unitOfWork = (() => { throw new Error("stopped"); }) as typeof peon.unitOfWork;
    const r = await s.fetch(new Request("http://127.0.0.1:4848/apps/friends/safety/hold", { method: "POST", headers: { authorization: "Bearer saf-tok", "content-type": "application/json" }, body: JSON.stringify({ memberId: fr, note: "report after a meetup" }) }));
    expect(r.ok).toBe(false);
    peon.unitOfWork = unit;
    expect([await level("friends", fr), await level("peon", pe)]).toEqual(["hold", "ok"]);
    clock.advance(10 * MINUTE);
    await s.tick();
    expect(await level("peon", pe)).toBe("hold");
  }, T);
});
