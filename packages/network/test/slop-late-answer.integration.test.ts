// A late answer to a slop onboarding question through NetworkService on Postgres
// (docs/research/2026-11-07-state-machines.md, module matching_engine, SD-427). The loop asks one
// question and waits for its answer, but the tick clears that wait after 3 days. An answer that came
// later ("28-35" four days after the age-range question) went to an open turn, and the onboarding loop
// did not read it: the fact was lost, and with matching off nothing asked again. Postgres in a database
// of its own; dry-run sends; fictional numbers (+1 212 555 01xx). Nothing is sent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_slop_late_answer_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_slop_late_answer";
const RAE = "+12125550176";

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
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;

describe.skipIf(!pgAvailable)("slop: a late onboarding answer (NetworkService, Postgres)", () => {
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

  test("an answer to the age-range question after the 3-day wait is still read as its answer", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-late-answer", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    try {
      for (const body of ["slop", "Rae, 29", "I'm a woman looking for men within 5 miles of 11222"]) await text(s, clock, RAE, body);
      const rae = (await memberId(RAE))!;
      expect(rae).toBeString();
      const last = async () => ((await sql`select body from network.messages where app_id = 'slop' and member_id = ${rae} and direction = 'outbound' order by ts desc, id desc limit 1`)[0] as { body: string }).body;
      const rt = s.runtimeFor("slop")!;
      const st = () => rt.readState(n => {
        const m = n.memberList().find(x => x.id === rae)!;
        return { awaiting: m.awaiting?.kind, ageRange: (m.onboarding as { ageRange?: { value: number[] } }).ageRange?.value, tags: (m.appTags ?? []).map(t => t.tag) };
      });
      // The loop asks for the age range and waits for the answer.
      expect(await last()).toMatch(/age/i);
      expect((await st()).awaiting).toBe("interview");
      // Matching stays off. Four days pass with no answer: the tick clears the wait.
      for (let t = 0; t < 4 * DAY; t += 6 * HOUR) { clock.advance(6 * HOUR); await s.tick(); }
      expect((await st()).awaiting).toBeUndefined();
      await text(s, clock, RAE, "28-35");
      const after = await st();
      expect(after.ageRange).toEqual([28, 35]);
      expect(after.tags).toContain("romance:age:28-35");
    } finally { await s.close(); svc = undefined; }
  }, T);
});
