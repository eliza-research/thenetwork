// The peon job posting machine through NetworkService on Postgres (docs/research/2026-11-07-state-machines.md,
// module matching_engine). SD-225: the staff postings API (service/postings.ts) answers on the service's
// own staff router, so staff can verify an employer and close a posting as filled over HTTP. Postgres in a
// database of its own; dry-run sends; fictional numbers (+1 212 555 01xx). Nothing is sent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_peon_posting_machine_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_peon_posting_machine";
const ADMIN = "adm-tok", REVIEWER = "rev-tok";

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
async function staff(s: NetworkService, token: string, method: string, path: string, b?: unknown) {
  const res = await s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
  return { status: res.status, body: await res.json() as any };
}
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'peon' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
const last = async (id: string) =>
  ((await sql`select body from network.messages where app_id = 'peon' and member_id = ${id} and direction = 'outbound' order by ts desc, id desc limit 1`)[0] as { body: string } | undefined)?.body ?? "";
const postings = async (id: string) => (await sql`select id, status, objective from network.intents where app_id = 'peon' and member_id = ${id} and details like 'peon:job%' order by id`) as any[];

function service(clock: SimClock, instance: string) {
  return new NetworkService({
    url: URL_, clock, instance, log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "peon:nyc" }],
    tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
    adapter: () => new DryRunAdapter(() => {}),
  });
}
async function manager(s: NetworkService, clock: SimClock, e164: string, name: string) {
  await text(s, clock, e164, "peon");
  await text(s, clock, e164, name);
  const id = (await memberId(e164))!;
  expect(id).toBeString();
  return id;
}

describe.skipIf(!pgAvailable)("peon posting machine (NetworkService, Postgres)", () => {
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

  // SD-225: without the staff routes, `peon:verified` and a "filled" close have no writer in production.
  test("staff verify an employer, list and close a posting as filled through the service's staff API", async () => {
    const clock = new SimClock(START);
    const s = svc = service(clock, "peon-posting-staff");
    await s.start();
    try {
      const rowan = await manager(s, clock, "+12125550191", "Rowan, 34");
      await text(s, clock, "+12125550191", "We're hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL");
      await text(s, clock, "+12125550191", "yes");
      expect(await last(rowan)).toMatch(/^Posted: data analyst\./);
      const [p] = await postings(rowan);
      expect(p.status).toBe("active");

      // A reviewer may read but not write; admin writes.
      const listed = await staff(s, REVIEWER, "GET", `/apps/peon/postings?managerId=${encodeURIComponent(rowan)}`);
      expect(listed.status).toBe(200);
      expect(listed.body.postings.map((x: any) => x.id)).toEqual([p.id]);
      expect((await staff(s, REVIEWER, "POST", `/apps/peon/employers/${encodeURIComponent(rowan)}/verify`, { company: "Acme", note: "called the office" })).status).toBe(403);

      const verified = await staff(s, ADMIN, "POST", `/apps/peon/employers/${encodeURIComponent(rowan)}/verify`, { company: "Acme", note: "called the office" });
      expect(verified).toEqual({ status: 200, body: { ok: true } });
      const seat = `job:${p.id}`;
      let snap = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
      expect(snap.facets.filter(f => f.memberId === seat).flatMap(f => f.tags)).toContain("peon:verified");

      const closed = await staff(s, ADMIN, "POST", `/apps/peon/postings/${encodeURIComponent(p.id)}/close`, { reason: "filled" });
      expect(closed.status).toBe(200);
      expect(closed.body.posting).toMatchObject({ id: p.id, status: "closed", closedReason: "filled" });
      expect((await postings(rowan))[0].status).toBe("closed");
      snap = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
      expect(snap.facets.find(f => f.id === `${seat}:openings`)?.tags).toEqual(["peon:openings:0"]);

      const audit = (await sql`select action, ok from network.staff_audit where app_id = 'peon' and action in ('read_postings', 'verify_employer', 'close_posting') order by id`) as any[];
      expect(audit.map(r => `${r.action}:${r.ok}`)).toEqual(["read_postings:true", "verify_employer:true", "close_posting:true"]);
    } finally { await s.close(); svc = undefined; }
  }, T);
});
