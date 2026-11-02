// Shared-line routing (service.ts route(), rule 4): a member's text goes to the app with the newest open
// item, else to the app that wrote to them last. An item is open while the member can still answer it; a
// probe expires after PROBE_TTL (26 h, network.ts) and the PRD gives 48 hours per side (section 1031). An
// expired probe must not pull a later reply away from the app that wrote last.
// Postgres in a database of its own per test process; dry-run adapters, nothing is sent.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_route_stale_item_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_shared", APP_SECRET = "whsec_app";
const NETS = [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }, { id: "slop:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }];
let phoneSeq = 0;
/** Fictional numbers only (+1 212 555 01xx). */
const newPhone = () => `+121255501${String(10 + ++phoneSeq).padStart(2, "0")}`;
class FakeOtp implements OtpProvider { readonly name = "fake"; async send() { return { code: "000000" }; } }

let sql: SQL;
const open: NetworkService[] = [];
function service(clock: SimClock) {
  const s = new NetworkService({
    url: URL_, clock, instance: "route", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, webhookSecrets: { friends: APP_SECRET, slop: APP_SECRET },
    network: { seed: 1 }, publicApi: { otp: new FakeOtp(), minStartMs: 0, minVerifyMs: 0 },
    adapter: () => { const a = new DryRunAdapter(() => {}); a.direct = async () => "dry_run"; return a; },
  });
  open.push(s);
  return s;
}
let evt = 0;
async function text(s: NetworkService, clock: SimClock, from: string, body: string, o: { app?: AppId } = {}) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}${o.app ? `/${o.app}` : ""}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(o.app ? APP_SECRET : SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const memberOf = async (app: AppId, e164: string) =>
  (await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string };
/** An opportunity row as the state save writes it (store.ts): a probe always has one. */
const opportunity = (app: AppId, id: string, state: string, at: number) =>
  sql`insert into network.opportunities (app_id, id, kind, state, city, objective, created_at, updated_at) values (${app}, ${id}, 'intro', ${state}, 'nyc', 'meet', ${new Date(at)}, ${new Date(at)})`;
const routedTo = async (body: string) => (await sql`select app_id from network.messages where direction = 'inbound' and body = ${body}`).map((r: any) => r.app_id as string);

describe.skipIf(!pgAvailable)("shared-line routing and expired items (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => { await sql?.close(); await admin(`drop database if exists ${DB} with (force)`).catch(() => {}); });

  test("a probe the member never answered has expired: their reply goes to the app that wrote last, not to the probe's app", async () => {
    const clock = new SimClock(START);
    const s = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Ren 32", { app: "friends" });
    await text(s, clock, p, "slop");
    await text(s, clock, p, "Ren 32");
    const sl = await memberOf("slop", p), fr = await memberOf("friends", p);
    // slop's probe, never answered. 3 days later it is long expired (PROBE_TTL 26 h): the opportunity is closed (SKIPPED).
    await opportunity("slop", "opp-1", "PROPOSED", clock.now());
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, opportunity_id, proactive, system, ts) values ('slop', 'probe-1', ${sl.id}, 'outbound', 'imessage', 'probe', 'dry_run', 'opp-1', true, false, ${new Date(clock.now())})`;
    clock.advance(3 * DAY);
    await sql`update network.opportunities set state = 'SKIPPED', updated_at = ${new Date(clock.now())} where app_id = 'slop' and id = 'opp-1'`;
    // friends writes a plain text (no opportunity): a check-in, a notification, a growth ask.
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, proactive, system, ts) values ('friends', 'note-1', ${fr.id}, 'outbound', 'imessage', 'how did the run club go?', 'dry_run', false, false, ${new Date(clock.now())})`;
    clock.advance(2 * MINUTE);
    expect(await text(s, clock, p, "it was great, thanks for asking")).toBe("handled");
    expect(await routedTo("it was great, thanks for asking")).toEqual(["friends"]);
  }, T);

  test("a feedback question on a finished match is open for 48 hours; three days on, the reply goes to the app that wrote last", async () => {
    const clock = new SimClock(START);
    const s = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Ola 35", { app: "friends" });
    await text(s, clock, p, "slop");
    await text(s, clock, p, "Ola 35");
    const sl = await memberOf("slop", p), fr = await memberOf("friends", p);
    await opportunity("slop", "opp-3", "COMPLETED", clock.now());
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, opportunity_id, proactive, system, ts) values ('slop', 'checkin-3', ${sl.id}, 'outbound', 'imessage', 'how did it go?', 'dry_run', 'opp-3', false, false, ${new Date(clock.now())})`;
    clock.advance(DAY);
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, proactive, system, ts) values ('friends', 'note-3', ${fr.id}, 'outbound', 'imessage', 'how did the run club go?', 'dry_run', false, false, ${new Date(clock.now())})`;
    clock.advance(2 * MINUTE);
    expect(await text(s, clock, p, "we had a lovely time")).toBe("handled");
    expect(await routedTo("we had a lovely time")).toEqual(["slop"]);
    // slop asks one more question right after; the member does not answer it. Three days later friends writes:
    // the stale question (COMPLETED, older than 48 hours) does not pull the reply.
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, opportunity_id, proactive, system, ts) values ('slop', 'checkin-4', ${sl.id}, 'outbound', 'imessage', 'anything else about the date?', 'dry_run', 'opp-3', false, false, ${new Date(clock.now())})`;
    clock.advance(3 * DAY);
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, proactive, system, ts) values ('friends', 'note-4', ${fr.id}, 'outbound', 'imessage', 'any plans this weekend?', 'dry_run', false, false, ${new Date(clock.now())})`;
    clock.advance(2 * MINUTE);
    expect(await text(s, clock, p, "nothing planned yet")).toBe("handled");
    expect(await routedTo("nothing planned yet")).toEqual(["friends"]);
  }, T);

  test("control: a probe sent an hour ago is still open and wins over the app that wrote last", async () => {
    const clock = new SimClock(START);
    const s = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Ida 33", { app: "friends" });
    await text(s, clock, p, "slop");
    await text(s, clock, p, "Ida 33");
    const sl = await memberOf("slop", p), fr = await memberOf("friends", p);
    await opportunity("slop", "opp-2", "PROPOSED", clock.now());
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, opportunity_id, proactive, system, ts) values ('slop', 'probe-2', ${sl.id}, 'outbound', 'imessage', 'probe', 'dry_run', 'opp-2', true, false, ${new Date(clock.now())})`;
    clock.advance(HOUR);
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, proactive, system, ts) values ('friends', 'note-2', ${fr.id}, 'outbound', 'imessage', 'how did the run club go?', 'dry_run', false, false, ${new Date(clock.now())})`;
    clock.advance(2 * MINUTE);
    expect(await text(s, clock, p, "yes, sounds good to me")).toBe("handled");
    expect(await routedTo("yes, sounds good to me")).toEqual(["slop"]);
  }, T);
});
