// A pair the Network keeps apart is also kept apart by the engine, through NetworkService on Postgres
// (docs/research/2026-11-07-state-machines.md, module matching_engine, SD-223): after a review reject or
// a "no" to the probe, the gate refuses the pair for 60 days. The engine must not pick that pair again
// in the meantime: each pick the gate drops takes both members' one slot of the run. Postgres in a
// database of its own; dry-run sends; fictional numbers (+1 212 555 01xx). Nothing is sent.
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
const DB = `network_slop_declined_pair_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_slop_declined_pair";
const ADMIN = "adm-tok", REVIEWER = "rev-tok";
const RAE = "+12125550175", SAM = "+12125550176", MAX = "+12125550177";

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
async function reviewItemOf(s: NetworkService, id: string) {
  const q = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as any;
  return (q.items ?? []).find((x: any) => x.proposal.participants.includes(id));
}
const inbox = async (id: string) =>
  ((await sql`select body, opportunity_id from network.messages where app_id = 'slop' and member_id = ${id} and direction = 'outbound' order by ts, id`) as any[]).map(r => ({ body: r.body as string, opp: r.opportunity_id as string | null }));

describe.skipIf(!pgAvailable)("declined slop pairs stay apart in the engine (NetworkService, Postgres)", () => {
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

  // SD-223: the engine re-picked a pair the gate refuses (pair_history), so Rae never got the other match.
  test("after a review reject and a probe no, the engine does not pick the pair again", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-declined-pair", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const people = [
      { e164: RAE, name: "Rae, 29", seeking: "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", goal: "Something serious, no smokers" },
      { e164: SAM, name: "Sam, 31", seeking: "I'm a man looking for women, 25 to 35, within 5 miles of 11211", goal: "A relationship, no smokers" },
      { e164: MAX, name: "Max, 32", seeking: "I'm a man looking for women, 25 to 35, within 5 miles of 11222", goal: "Something serious, no smokers" },
    ];
    for (const p of people) for (const body of ["slop", p.name, p.seeking, p.goal, "Weekend evenings work best"]) await text(s, clock, p.e164, body);
    const rae = (await memberId(RAE))!, sam = (await memberId(SAM))!, max = (await memberId(MAX))!;
    for (const id of [rae, sam, max]) expect(id).toBeString();
    const pairHistory = () => s.runtimeFor("slop")!.readState(n => n.gateReasons.pair_history ?? 0);

    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    let first: any;
    for (let i = 0; i < 12 && !first; i++) { await run(s, clock, 2 * HOUR); first = await reviewItemOf(s, rae); }
    expect(first).toBeDefined();
    const other = first.proposal.participants.includes(sam) ? max : sam;
    expect((await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(first.oppId)}`, { decision: "reject", secondsSpent: 5 })).status).toBe(200);

    // The next runs pick Rae with the other man, and the gate never drops the rejected pair.
    let second: any;
    for (let i = 0; i < 24 && !second; i++) { await run(s, clock, 2 * HOUR); second = await reviewItemOf(s, rae); }
    expect(await pairHistory()).toBe(0);
    expect(second?.proposal.participants).toContain(other);

    // A "no" to the anonymous probe: 10 days later (past the pack's 7-day re-probe) the engine still keeps them apart.
    expect((await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(second.oppId)}`, { decision: "approve", secondsSpent: 5 })).status).toBe(200);
    let probed: string | undefined;
    for (let i = 0; i < 24 && !probed; i++) {
      await run(s, clock, HOUR);
      for (const [id, e164] of [[rae, RAE], [other, other === sam ? SAM : MAX]] as const) if (!probed && (await inbox(id)).some(m => m.opp === second.oppId)) { probed = id; await text(s, clock, e164, "No thanks"); }
    }
    expect(probed).toBeString();
    expect((await sql`select state from network.opportunities where app_id = 'slop' and id = ${second.oppId}`)[0]?.state).toBe("SKIPPED");
    await run(s, clock, 10 * DAY, 2 * HOUR);
    expect(await pairHistory()).toBe(0);
    await s.close(); svc = undefined;
  }, T);
});
