import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { brandOf, copyFor } from "../src/copy.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `text_join_age_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
const SECRET = "whsec_shared", APP_SECRET = "whsec_app";
const NETS = [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }, { id: "slop:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }];

async function admin(q: string) {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe(q); } finally { await sql.close(); }
}

let sql: SQL;
let phoneSeq = 0;
let evt = 0;
const open: NetworkService[] = [];
const newPhone = () => `+121255502${String(10 + ++phoneSeq).padStart(2, "0")}`;

function service(clock: SimClock) {
  const directs: { app: string; to: string; body: string }[] = [];
  const s = new NetworkService({
    url: URL_, clock, instance: "text-join-age", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, webhookSecrets: { friends: APP_SECRET, slop: APP_SECRET },
    network: { seed: 1 },
    adapter: (_net, rt) => {
      const a = new DryRunAdapter(() => {});
      a.direct = async (to, body) => { directs.push({ app: rt.app.id, to, body }); return "dry_run"; };
      return a;
    },
  });
  open.push(s);
  return { s, directs };
}

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

async function textOn(s: NetworkService, clock: SimClock, from: string, body: string, line: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage", recipient: line } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}

const memberAge = async (app: AppId, e164: string) =>
  (await sql`select m.age from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0]?.age as number | undefined;
const personLowest = async (e164: string) =>
  (await sql`select p.lowest_age from platform.people p join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${e164}`)[0]?.lowest_age as number | undefined;
const membershipId = async (app: AppId, e164: string) =>
  (await sql`select ms.member_id from platform.memberships ms join platform.phone_identities ph on ph.person_id = ms.person_id where ms.app_id = ${app} and ph.e164 = ${e164}`)[0]?.member_id as string | undefined;
const pendingJoins = async () => (await sql`select count(*)::int as n from platform.pending_texts where kind = 'join'`)[0].n as number;

describe.skipIf(!pgAvailable)("text join and age through the inbound path (Postgres)", () => {
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

  test("JA-1 spec/textEnrollment.md, \"Confirm age before creating a member\": an age sent with no name outlives the pending join, so a later older age joins at the lowest age", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "15", { app: "slop" })).toBe("join_asked");
    expect(directs.at(-1)!.body).toBe(copyFor(brandOf(APPS.slop)).joinNeedName);
    clock.advance(DAY + HOUR);
    expect(await text(s, clock, p, "Sam 25", { app: "slop" })).toBe("joined");
    expect(await personLowest(p)).toBe(15);
    expect(await memberAge("slop", p)).toBe(15);
  }, T);

  test("JA-2 spec/textEnrollment.md, \"Confirm age before creating a member\": an allowed age sent with an unsupported home is recorded before the home question", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "Sam 15, I live in Boston", { app: "friends" })).toBe("join_asked");
    expect(directs.at(-1)!.body).toMatch(/home city/);
    expect(await text(s, clock, p, "Sam 25, I live in New York", { app: "friends" })).toBe("joined");
    expect(await personLowest(p)).toBe(15);
    expect(await memberAge("friends", p)).toBe(15);
    for (const first of ["Sam 15, Boston", "Sam, 15, Boston"]) {
      const q = newPhone();
      expect(await text(s, clock, q, first, { app: "friends" })).toBe("join_asked");
      expect(directs.at(-1)!.body).toMatch(/home city/);
      expect(await text(s, clock, q, "Sam 25, New York", { app: "friends" })).toBe("joined");
      expect([first, await personLowest(q), await memberAge("friends", q)]).toEqual([first, 15, 15]);
    }
  }, T);

  test("JA-1 spec/textEnrollment.md, \"A join needs permission to enter this app\": an age sent to an invite-only app is recorded before the invite-only reply", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    const NLINE = "+12125550778";
    await sql`insert into platform.app_lines (line_e164, app_id, city, provider, env) values (${NLINE}, 'ntwrk', 'nyc', 'blooio', 'dev')`;
    const p = newPhone();
    expect(await textOn(s, clock, p, "Sam 15", NLINE)).toBe("invite_only");
    expect(directs.at(-1)!.body).toBe(APPS.ntwrk.brand.inviteOnly);
    expect(await pendingJoins()).toBe(0);
    expect(await text(s, clock, p, "Sam 25", { app: "friends" })).toBe("joined");
    expect(await personLowest(p)).toBe(15);
    expect(await memberAge("friends", p)).toBe(15);
  }, T);

  test("JA-7 spec/textEnrollment.md, \"Confirm age before creating a member\": a number whose recorded age is under 13 and that sends no age gets the kind decline and nothing is stored", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "Lu 12")).toBe("under_age");
    expect(await text(s, clock, p, "hi")).toBe("under_age");
    expect(await text(s, clock, p, "hello?")).toBe("under_age");
    expect(directs.filter(d => d.to === p).map(d => d.body)).toEqual([APPS.ntwrk.brand.underAge]);
    expect(await text(s, clock, p, "Sam", { app: "friends" })).toBe("under_age");
    expect(directs.at(-1)!.body).toBe(APPS.friends.brand.underAge);
    expect(await text(s, clock, p, "Lu 11", { app: "friends" })).toBe("under_age");
    expect(directs.filter(d => d.to === p && d.app === "friends")).toHaveLength(2);
    clock.advance(DAY);
    expect(await text(s, clock, p, "hi again")).toBe("under_age");
    expect(directs.filter(d => d.to === p && d.app === "ntwrk")).toHaveLength(2);
    expect(await pendingJoins()).toBe(0);
    expect(await sql`select 1 from platform.phone_identities where e164 = ${p}`).toHaveLength(0);
  }, T);

  test("JA-6 spec/textEnrollment.md, \"A text join keeps the member id of a membership that is not removed\": a join that runs again for a live membership keeps its member id", async () => {
    await fresh();
    const clock = new SimClock(START);
    const a = service(clock);
    const p = newPhone();
    expect(await text(a.s, clock, p, "Lee 25", { app: "friends" })).toBe("joined");
    const first = (await membershipId("friends", p))!;
    expect(first).toBeTruthy();
    await a.s.close();
    await sql`delete from network.members where app_id = 'friends' and id = ${first}`;
    const b = service(clock);
    expect(await text(b.s, clock, p, "Lee 25", { app: "friends" })).toBe("joined");
    expect(await membershipId("friends", p)).toBe(first);
    expect(await sql`select id from network.members where app_id = 'friends' and id = ${first}`).toHaveLength(1);
  }, T);

  test("SHA66 spec/lineRouting.md, \"Every app leave gets one honest reply\": a leave from someone who is not in that app gets one reply that says so and changes nothing", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    const stranger = newPhone();
    expect(await text(s, clock, stranger, "leave slop.date")).toBe("handled");
    const toStranger = directs.filter(d => d.to === stranger);
    expect(toStranger).toHaveLength(1);
    expect(toStranger[0]!.body).toBe(copyFor(brandOf(APPS.slop)).notInApp);
    expect(await sql`select 1 from platform.consent_events where e164 = ${stranger}`).toHaveLength(0);
    const member = newPhone();
    expect(await text(s, clock, member, "Lee 25", { app: "friends" })).toBe("joined");
    const before = directs.length;
    expect(await text(s, clock, member, "leave slop")).toBe("handled");
    expect(directs.slice(before).map(d => d.body)).toEqual([copyFor(brandOf(APPS.slop)).notInApp]);
    expect(copyFor(brandOf(APPS.slop)).notInApp).not.toMatch(/friends/i);
    expect(await membershipId("friends", member)).toBeTruthy();
    expect(await text(s, clock, member, "leave friends.help")).toBe("left");
  }, T);
});
