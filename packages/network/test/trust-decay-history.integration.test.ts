// Trust decay is part of the trust history (upstream PR #472; PRD 32.14 safety cases), on the production
// path: NetworkService on Postgres, signed Blooio webhooks, a staff case close through the staff API, and
// restarts that load the network from the store. Before the fix, clean time lowered the score with no
// event, so the events of a member did not add up to the score and the open case missed the drop. Decay
// alone never opens a case or adds to a closed one, and a hold never decays. Postgres in a database of
// its own per test process; dry-run sends; fictional numbers (+1 212 555 01xx).
// spec/trustLevel.md, "Clean time lowers the score through a recorded decay event"; spec/safetyCase.md, "An event opens a case or adds to its current record"
import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { DAY, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_trust_decay_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_trust_decay";
const SAFETY = "saf-tok";
const SPAM = "Buy my course at https://example.test/offer";

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

describe.skipIf(!pgAvailable)("trust decay history (NetworkService, Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("decay survives restarts with a balanced history and never reopens a closed case", async () => {
    const clock = new SimClock(START);
    const make = () => new NetworkService({
      url: URL_, clock, instance: "trust-decay", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "friends:nyc" }],
      tokens: `safety:${SAFETY}`, webhookSecret: SECRET, network: { seed: 1, matchingEnabled: false }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    let s = svc = make();
    await s.start();
    const text = async (from: string, body: string) => {
      const n = ++evt;
      const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
      const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
      expect(res.status).toBe(200);
      await res.text();
      clock.advance(MINUTE);
    };
    const state = () => s.runtimeFor("friends")!.readState(n => n.exportState());
    const restart = async () => { await s.close(); s = svc = make(); await s.start(); };
    const tickAt = async (day: number) => { clock.set(START + day * DAY); await s.tick(); return state(); };

    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const phone = `+1212555018${i}`;
      await text(phone, "friends");
      await text(phone, `${["Ari", "Bea", "Cy", "Dee"][i]}, 34`);
      const [row] = await sql`select m.id from network.members m join platform.phone_identities p on p.person_id = m.person_id where m.app_id = 'friends' and p.e164 = ${phone}`;
      ids.push(row!.id as string);
      if (i < 3) await text(phone, SPAM);
      if (i === 2) await text(phone, SPAM);
    }
    const [open, closed, held, clean] = ids as [string, string, string, string];
    const initial = await state();
    expect(ids.map(id => initial.trust.find(t => t.id === id)?.score ?? 0)).toEqual([3, 3, 6, 0]);

    const closedCase = initial.cases.find(c => c.memberId === closed)!;
    const close = await s.fetch(new Request("http://127.0.0.1:4848/apps/friends/safety/close", { method: "POST",
      headers: { authorization: `Bearer ${SAFETY}`, "content-type": "application/json" }, body: JSON.stringify({ caseId: closedCase.id, note: "review complete" }) }));
    expect(close.status).toBe(200);
    expect(await close.json()).toEqual({ ok: true });

    const before = await tickAt(13);
    expect(before.trust.find(t => t.id === open)!.events.map(e => e.points)).toEqual([3]);

    await restart();
    const first = await tickAt(15);
    expect(first.trust.find(t => t.id === open)!.score).toBe(2);
    expect(first.trust.find(t => t.id === open)!.events.map(e => [e.kind, e.points])).toEqual([["sales_spam", 3], ["decay", -1]]);
    expect(first.cases.find(c => c.memberId === open)!.events.map(e => e.points)).toEqual([3, -1]);

    await restart();
    const last = await tickAt(60);
    for (const id of [open, closed]) {
      const trust = last.trust.find(t => t.id === id)!;
      expect([trust.score, trust.level]).toEqual([0, "ok"]);
      expect(trust.events.map(e => e.points)).toEqual([3, -1, -2]);
      expect(trust.events.reduce((sum, e) => sum + e.points, 0)).toBe(trust.score);
    }
    // Decay never reopens or adds to a closed case, and never opens a new one.
    expect(last.cases.filter(c => c.memberId === closed)).toHaveLength(1);
    expect(last.cases.find(c => c.id === closedCase.id)).toMatchObject({ status: "closed", events: closedCase.events });
    expect(last.cases.find(c => c.memberId === open)!.events.map(e => e.points)).toEqual([3, -1, -2]);
    expect(last.cases.filter(c => c.memberId === clean)).toEqual([]);
    // A hold is lifted by a person, never by time.
    expect(last.trust.find(t => t.id === held)).toMatchObject({ score: 6, level: "hold", events: initial.trust.find(t => t.id === held)!.events });

    // At zero there is nothing left to decay: no further event, before or after a restart.
    const next = await tickAt(90);
    expect(next.trust.find(t => t.id === open)!.events).toEqual(last.trust.find(t => t.id === open)!.events);
    await restart();
    expect((await state()).trust).toEqual(next.trust);
    expect((await sql`select distinct status from network.messages where direction = 'outbound'`).map((r: any) => r.status)).toEqual(["dry_run"]);
  }, T);
});
