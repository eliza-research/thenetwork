// A block is person to person (PRD 40.3, F23): when Ana blocks Ben on The Network, a date the two
// of them have booked on the friends app is called off too, and Ben hears only that it is off
// (SD-025). Two apps on one service and one database. Nothing is sent (dry-run adapters).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 600_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const DB = `network_block_apps_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const FR: AppId = "friends";
const APPS_RUN: AppId[] = ["ntwrk", FR];
const SECRET = "whsec_block_apps";
const ONBOARD = ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."];
const PEOPLE = [{ key: "a", name: "Ana Diaz" }, { key: "b", name: "Ben Ito" }];
const phone = (key: string) => `+1212555${String(300 + PEOPLE.findIndex(p => p.key === key)).padStart(4, "0")}`;

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

async function seed(s: NetworkService) {
  const people = new PgPeopleStore(sql);
  const joined = new Date(START - 30 * 24 * HOUR);
  for (const p of PEOPLE) {
    const person = await people.createPerson({ id: randomUUID(), e164: phone(p.key), method: "staff", at: START - 30 * 24 * HOUR, lowestAge: 30 });
    for (const app of APPS_RUN) {
      const memberId = `${app}_${p.key}`;
      const m = { app, personId: person.id, memberId, state: "active" as const, review: null, firstName: p.name, profile: {}, joinedAt: START - 30 * 24 * HOUR, leftAt: null };
      await people.putMembership(m);
      await s.createMember(s.runtimeFor(app)!, m, { age: 30, firstName: p.name, neighborhood: "Greenpoint" });
      await sql.begin(async tx => {
        await tx`select set_config('app.app_id', ${app}, true)`;
        for (const tag of ["climbing", "hiking"]) for (const kind of ["interest", "skill"] as const) await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
          values (${app}, ${`${memberId}:${kind}:${tag}`}, ${memberId}, ${kind}, ${tag}, ${tx.array([tag], "TEXT")}, 'matchable', 'said', 'chat', 0.9, 'confirmed', ${joined})`;
      });
    }
  }
}

async function say(s: NetworkService, clock: SimClock, app: AppId, key: string, text: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: phone(key), chat_id: phone(key), text, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}/${app}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const staff = (s: NetworkService, method: string, path: string, body?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { authorization: "Bearer adm-tok", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));

describe.skipIf(!pgAvailable)("a block made on one app (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterAll(async () => {
    await svc?.close();
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("SD-025: a block on The Network calls off the pair's booked date on the friends app", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    svc = new NetworkService({
      url: URL_, clock, instance: "block-apps", log: () => {}, env: { PLATFORM_ENV: "dev" }, tokens: "admin:adm-tok", network: { seed: 1 },
      networks: APPS_RUN.map(a => ({ id: `${a}:nyc` })), webhookSecrets: Object.fromEntries(APPS_RUN.map(a => [a, SECRET])),
    });
    await svc.start();
    await seed(svc);
    expect((await staff(svc, "POST", `/apps/${FR}/matching`, { on: true })).status).toBe(200);
    for (const app of APPS_RUN) for (const p of PEOPLE) for (const t of ONBOARD) await say(svc, clock, app, p.key, t);
    expect(await say(svc, clock, FR, "a", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.")).toBe("handled");

    // Staff approve the pair, both say yes on the friends app, and the date is booked.
    const fr = svc.runtimeFor(FR)!;
    const opps = () => fr.readState(n => n.exportState().opps);
    const awaitingProbe = (key: string) => fr.readState(n => n.memberList().find(m => m.id === `${FR}_${key}`)?.awaiting?.kind === "probe");
    let booked: string | undefined;
    for (let round = 0; round < 12 && !booked; round++) {
      clock.advance(2 * HOUR);
      await svc.tick();
      const q = await (await staff(svc, "GET", `/apps/${FR}/review`)).json();
      for (const item of q.items) await staff(svc, "POST", `/apps/${FR}/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", secondsSpent: 5 });
      await svc.tick();
      for (const p of PEOPLE) if (await awaitingProbe(p.key)) await say(svc, clock, FR, p.key, "yes");
      booked = (await opps()).find(o => o.stage === "scheduled" && o.participants.includes(`${FR}_a`) && o.participants.includes(`${FR}_b`))?.id;
    }
    expect(booked).toBeDefined();
    const before = (await sql`select count(*)::int as n from network.messages where app_id = ${FR} and member_id = ${`${FR}_b`} and direction = 'outbound'`)[0].n as number;

    // Ana blocks Ben on The Network. The next tick of the friends app calls their date off.
    expect(await say(svc, clock, "ntwrk", "a", "block Ben Ito")).toBe("handled");
    clock.advance(10 * MINUTE);
    await svc.tick();
    const o = (await opps()).find(x => x.id === booked)!;
    expect(o.stage).toBe("closed");
    const toBen = (await sql`select body, type from network.messages where app_id = ${FR} and member_id = ${`${FR}_b`} and direction = 'outbound' order by ts`).slice(before) as any[];
    expect(toBen.map(m => m.type)).toEqual(["cancellation"]);
    expect(toBen[0].body).not.toMatch(/Ana|block/i);
  }, T);
});
