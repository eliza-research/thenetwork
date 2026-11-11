// The slop location rule through NetworkService on Postgres (docs/research/2026-11-07-state-machines.md,
// module matching_engine, SD-209): a member who gave a radius but no zip and no neighborhood is not
// placed at the market's anchor zip and matched from there. The engine asks for the location; once
// both members give one, the pair reaches the review queue. Postgres in a database of its own; dry-run
// sends; fictional numbers (+1 212 555 01xx). Nothing is sent.
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
const DB = `network_slop_location_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_slop_location";
const ADMIN = "adm-tok", REVIEWER = "rev-tok";
const RAE = "+12125550171", SAM = "+12125550172";

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
async function run(s: NetworkService, clock: SimClock, ms: number, step = 30 * MINUTE) {
  for (let t = 0; t < ms; t += step) { clock.advance(Math.min(step, ms - t)); await s.tick(); }
}
async function pairInReview(s: NetworkService, a: string, b: string) {
  const q = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as any;
  return (q.items ?? []).some((x: any) => x.proposal.participants.includes(a) && x.proposal.participants.includes(b));
}

describe.skipIf(!pgAvailable)("slop location before matching (NetworkService, Postgres)", () => {
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

  // SD-209: a radius with no zip and no neighborhood is not a location; the engine asks, it does not guess.
  test("a member with a radius but no location is not matched until the location is given", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-location", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const people = [
      { e164: RAE, name: "Rae, 29", seeking: "I'm a woman looking for men, 27 to 38, within 5 miles", goal: "Something serious, no smokers" },
      { e164: SAM, name: "Sam, 31", seeking: "I'm a man looking for women, 25 to 35, within 5 miles", goal: "A relationship, no smokers" },
    ];
    for (const p of people) for (const body of ["slop", p.name, p.seeking, p.goal, "Weekend evenings work best"]) await text(s, clock, p.e164, body);
    const rae = (await memberId(RAE))!, sam = (await memberId(SAM))!;
    expect(rae).toBeString();
    expect(sam).toBeString();

    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    for (let i = 0; i < 12; i++) {
      await run(s, clock, 2 * HOUR);
      expect(await pairInReview(s, rae, sam)).toBe(false);
    }

    // Positive control: with a zip from each, the same two people reach the review queue.
    await text(s, clock, RAE, "My zip is 11222");
    await text(s, clock, SAM, "My zip is 11211");
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      await run(s, clock, 2 * HOUR);
      found = await pairInReview(s, rae, sam);
    }
    expect(found).toBe(true);
    await s.close(); svc = undefined;
  }, T);
});
