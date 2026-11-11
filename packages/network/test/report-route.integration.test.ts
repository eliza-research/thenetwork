// A "report X" text on the shared line goes to the app where the member met X (PRD 40.3, F23). Before,
// it went to the app that wrote to the member last. When that was another app, the report was filed
// there as a report about a stranger (met: false): the member heard "I couldn't match that name",
// nobody was held, and the app where they met had no report (SD-250). Two apps on one service and
// one database. Nothing is sent (dry-run adapters).
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
const DB = `network_report_route_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const FR: AppId = "friends";
const APPS_RUN: AppId[] = ["ntwrk", FR];
const SECRET = "whsec_report_route";
const ONBOARD = ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."];
const PEOPLE = [{ key: "a", name: "Ana Diaz" }, { key: "b", name: "Ben Ito" }];
const phone = (key: string) => `+1212555${String(320 + PEOPLE.findIndex(p => p.key === key)).padStart(4, "0")}`;

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

async function say(s: NetworkService, clock: SimClock, app: AppId | undefined, key: string, text: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: phone(key), chat_id: phone(key), text, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}${app ? `/${app}` : ""}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const staff = (s: NetworkService, method: string, path: string, body?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { authorization: "Bearer adm-tok", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));

describe.skipIf(!pgAvailable)("a report on the shared line (Postgres)", () => {
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

  test("SD-250: \"report Ben\" goes to the app of their date, though The Network wrote last", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    svc = new NetworkService({
      url: URL_, clock, instance: "report-route", log: () => {}, env: { PLATFORM_ENV: "dev" }, tokens: "admin:adm-tok", network: { seed: 1 },
      networks: APPS_RUN.map(a => ({ id: `${a}:nyc` })), webhookSecret: SECRET, webhookSecrets: Object.fromEntries(APPS_RUN.map(a => [a, SECRET])),
    });
    await svc.start();
    await seed(svc);
    expect((await staff(svc, "POST", `/apps/${FR}/matching`, { on: true })).status).toBe(200);
    for (const app of APPS_RUN) for (const p of PEOPLE) for (const t of ONBOARD) await say(svc, clock, app, p.key, t);
    expect(await say(svc, clock, FR, "a", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.")).toBe("handled");

    // Staff approve the pair, both say yes on the friends app, and the date is booked.
    const fr = svc.runtimeFor(FR)!;
    const nt = svc.runtimeFor("ntwrk")!;
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

    // Ana answers the friends app, then The Network writes to her last.
    await say(svc, clock, FR, "a", "See you there.");
    await say(svc, clock, "ntwrk", "a", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    const apps = await svc.memberApps(phone("a"));
    const last = [...apps].sort((x, y) => (y.lastOut ?? 0) - (x.lastOut ?? 0))[0]!;
    expect(last.app).toBe("ntwrk");
    expect(apps.every(x => x.lastItem === null)).toBe(true);

    expect(await say(svc, clock, undefined, "a", "report Ben, he was rude and kept pushing")).toBe("handled");
    const reports = (await fr.readState(n => n.safetyReports())).map(r => [r.reporterId, r.subjectId, r.kind, r.source]);
    expect(reports).toEqual([[`${FR}_a`, `${FR}_b`, "harassment", "message"]]);
    expect(await nt.readState(n => n.safetyReports())).toEqual([]);
    expect(await fr.readState(n => n.safetyHeld(`${FR}_b` as never))).toBe(true);
  }, T);
});
