// "block him" after a booked slop.date (F23, through NetworkService on Postgres): the block is about
// the member's date, so the date is called off, the other person is told only that it is off, and
// the reply says it is done. A name the member never met gets no false "Done", and "Who do you mean?"
// only offers names of people the member was introduced to. Ported from closed PR #12
// (mvp/r1-safety-line). Postgres in a database of its own per test process; dry-run sends (the text is
// read back from network.messages); fictional numbers (+1 212 555 01xx).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_slop_block_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_slop_block";
const ADMIN = "adm-tok", REVIEWER = "rev-tok";
const IVY = "+12125550171", LEO = "+12125550172";

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
const staff = (s: NetworkService, token: string, method: string, path: string, b?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
const inbox = async (id: string) =>
  ((await sql`select body, opportunity_id from network.messages where app_id = 'slop' and member_id = ${id} and direction = 'outbound' order by ts, id`) as any[])
    .map(r => ({ body: r.body as string, opp: r.opportunity_id as string | null }));
const last = async (id: string) => (await inbox(id)).at(-1)?.body ?? "";
async function run(s: NetworkService, clock: SimClock, ms: number, step = 30 * MINUTE) {
  for (let t = 0; t < ms; t += step) { clock.advance(Math.min(step, ms - t)); await s.tick(); }
}

describe.skipIf(!pgAvailable)("slop.date: block and report resolve the member's date (NetworkService, Postgres)", () => {
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

  test("an unknown name gets no false Done; 'block him' calls off the booked date with the right person; the other is told only that it is off", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-block", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const people = [
      { e164: IVY, name: "Ivy, 30", about: "I'm a woman into men. Live in Greenpoint, love climbing and live music", seeking: "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", goal: "Something serious, no smokers" },
      { e164: LEO, name: "Leo, 32", about: "I'm a man into women. Williamsburg, I climb and go to shows", seeking: "I'm a man looking for women, 25 to 35, within 5 miles of 11211", goal: "A relationship, no smokers" },
    ];
    for (const p of people) for (const body of ["slop", p.name, p.about, p.seeking, p.goal, "Weekend evenings work best"]) await text(s, clock, p.e164, body);
    const ivy = (await memberId(IVY))!, leo = (await memberId(LEO))!;

    // Before any date: "block him" names nobody she met, so nothing is claimed as done and nobody is offered.
    await text(s, clock, IVY, "block him");
    expect(await last(ivy)).toMatch(/^Who do you mean\? Reply with their first name/);
    await text(s, clock, IVY, "never mind");
    await text(s, clock, IVY, "block Zed");
    expect(await last(ivy)).toMatch(/^I couldn't match that name to someone you met through me/);
    expect((await inbox(ivy)).some(m => /^Done\./.test(m.body))).toBe(false);

    // A person approves the match, both say yes, the date is booked.
    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    let item: any;
    for (let i = 0; i < 12 && !item; i++) {
      await run(s, clock, 2 * HOUR);
      const q = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as any;
      item = q.items?.find((x: any) => x.proposal.participants.includes(ivy) && x.proposal.participants.includes(leo));
    }
    expect(item).toBeDefined();
    expect((await (await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", secondsSpent: 20 })).json() as any).ok).toBe(true);
    const answered = new Set<string>();
    for (let i = 0; i < 24; i++) {
      await run(s, clock, HOUR);
      for (const [id, e164] of [[ivy, IVY], [leo, LEO]] as const) {
        const ask = (await inbox(id)).filter(m => m.opp === item.oppId).at(-1);
        if (ask && !answered.has(ask.body) && /\?/.test(ask.body)) { answered.add(ask.body); await text(s, clock, e164, "Yes, the first time works"); }
      }
      if ((await sql`select state from network.opportunities where app_id = 'slop' and id = ${item.oppId}`)[0]?.state === "SCHEDULED") break;
    }
    expect((await sql`select state from network.opportunities where app_id = 'slop' and id = ${item.oppId}`)[0]?.state).toBe("SCHEDULED");
    const leoBefore = (await inbox(leo)).length;

    // "block him": her date. Called off, Leo hears only that it is off, and Ivy's reply says it is done.
    await text(s, clock, IVY, "Please block him, I changed my mind about this guy");
    expect(await last(ivy)).toMatch(/^Done\. You won't be matched with them/);
    expect((await sql`select state from network.opportunities where app_id = 'slop' and id = ${item.oppId}`)[0]?.state).not.toBe("SCHEDULED");
    const toLeo = (await inbox(leo)).slice(leoBefore).map(m => m.body);
    expect(toLeo).toHaveLength(1);
    expect(toLeo[0]).not.toMatch(/Ivy|block/i);
  }, T);
});
