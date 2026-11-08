// The engine input of a held hiring manager's seat, through NetworkService on Postgres
// (docs/research/2026-11-07-state-machines.md, module matching_engine, SD-296). A job seat is a member
// id of its own with no member state, so the safety holds of its manager did not reach it: the seat of
// a held manager stayed in the engine input and the engine spent picks the gate then refused.
// Postgres in a database of its own; dry-run sends; fictional numbers (+1 212 555 01xx). Nothing is sent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_peon_held_seat_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_peon_held_seat";
const ADMIN = "adm-tok";

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
}
async function staff(s: NetworkService, method: string, path: string, b?: unknown) {
  const res = await s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${ADMIN}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
  return { status: res.status, body: await res.json() as any };
}
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'peon' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
const last = async (id: string) =>
  ((await sql`select body from network.messages where app_id = 'peon' and member_id = ${id} and direction = 'outbound' order by ts desc, id desc limit 1`)[0] as { body: string } | undefined)?.body ?? "";
const postings = async (id: string) => (await sql`select id, status from network.intents where app_id = 'peon' and member_id = ${id} and details like 'peon:job%' order by id`) as any[];

describe.skipIf(!pgAvailable)("peon held seat (NetworkService, Postgres)", () => {
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

  test("the seat of a manager on safety hold is held in the engine input", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "peon-held-seat", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "peon:nyc" }],
      tokens: `admin:${ADMIN}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    try {
      await text(s, clock, "+12125550193", "peon");
      await text(s, clock, "+12125550193", "Rowan, 34");
      const rowan = (await memberId("+12125550193"))!;
      expect(rowan).toBeString();
      await text(s, clock, "+12125550193", "We're hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL");
      await text(s, clock, "+12125550193", "yes");
      expect(await last(rowan)).toMatch(/^Posted: data analyst\./);
      const [p] = await postings(rowan);
      const seat = `job:${p.id}`;
      const rt = s.runtimeFor("peon")!;
      const seen = () => rt.readState(n => { const input = n.packInput(clock.now()); return { members: input.members.map(m => m.id), holds: (input.safetyHolds ?? []).map(h => h.memberId), manager: n.managerProblem(rowan) ?? null }; });

      // Before the hold the seat is in the engine input and not held.
      const before = await seen();
      expect(before.members).toContain(seat);
      expect(before.holds).not.toContain(seat);

      const held = await staff(s, "POST", "/apps/peon/safety/hold", { memberId: rowan, note: "check the employer" });
      expect(held.status).toBe(200);
      const after = await seen();
      expect(after.manager).toBe("not_ready");
      // The engine skips a held member: the manager is held, and so is the seat they answer for.
      expect(after.holds).toContain(rowan);
      expect(after.holds).toContain(seat);
    } finally { await s.close(); svc = undefined; }
  }, T);
});
