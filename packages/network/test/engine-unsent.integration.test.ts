// What the engine bills for a proposal nobody received, through NetworkService on Postgres
// (docs/research/2026-11-07-state-machines.md, module matching_engine, SD-210): an item a reviewer
// rejects, or that expires in review with no reviewer (SD-262), contacts nobody, so the next engine run neither counts it against the members' budgets nor
// holds the pair as an active proposal (config.dispatch.billOnlySent). Postgres in a database of its
// own; dry-run sends; fictional numbers (+1 212 555 01xx). Nothing is sent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { localEmbed, makeSlopPack, resolveConfig, World } from "@thenetwork/engine";
import { pairKey } from "../../engine/src/world.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_engine_unsent_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_engine_unsent";
const ADMIN = "adm-tok", REVIEWER = "rev-tok";
const RAE = "+12125550181", SAM = "+12125550182";

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

describe.skipIf(!pgAvailable)("unsent proposals are not billed (NetworkService, Postgres)", () => {
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

  // SD-210: the reviewer says no, nobody hears of it; the engine must not count it as sent.
  test("an item rejected in review does not count against budgets or hold the pair", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "engine-unsent", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const people = [
      { e164: RAE, name: "Rae, 29", seeking: "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", goal: "Something serious, no smokers" },
      { e164: SAM, name: "Sam, 31", seeking: "I'm a man looking for women, 25 to 35, within 5 miles of 11211", goal: "A relationship, no smokers" },
    ];
    for (const p of people) for (const body of ["slop", p.name, p.seeking, p.goal, "Weekend evenings work best"]) await text(s, clock, p.e164, body);
    const rae = (await memberId(RAE))!, sam = (await memberId(SAM))!;
    expect(rae).toBeString();
    expect(sam).toBeString();

    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    let item: any;
    for (let i = 0; i < 12 && !item; i++) {
      await run(s, clock, 2 * HOUR);
      const q = await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as any;
      item = (q.items ?? []).find((x: any) => x.proposal.participants.includes(rae) && x.proposal.participants.includes(sam));
    }
    expect(item).toBeDefined();
    expect((await staff(s, REVIEWER, "POST", `/apps/slop/review/${encodeURIComponent(item.oppId)}`, { decision: "reject", secondsSpent: 5 })).status).toBe(200);
    expect(((await sql`select count(*)::int as n from network.messages where app_id = 'slop' and opportunity_id = ${item.oppId} and direction = 'outbound'`)[0] as { n: number }).n).toBe(0);

    const { input, cfg } = await s.runtimeFor("slop")!.readState(n => ({ input: n.packInput(clock.now()), cfg: n.effectiveEngineConfig() }));
    expect(input.recentProposals?.map(p => p.id)).toContain(item.oppId);
    const w = new World(input, resolveConfig(cfg), localEmbed, makeSlopPack({ verification: { required: false } }));
    expect([w.get(rae)!.recentProactive, w.get(sam)!.recentProactive]).toEqual([0, 0]);
    expect(w.activePairs.has(pairKey(rae, sam))).toBe(false);
    await s.close(); svc = undefined;
  }, T);
  // SD-262: nobody reviews in time (a weekend with no reviewer); the item expires unsent. The engine must
  // not count it against the members' budgets or hold the pair.
  test("an item that expires in review does not count against budgets or hold the pair", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "engine-unsent-expiry", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const people = [
      { e164: "+12125550183", name: "Lou, 29", seeking: "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", goal: "Something serious, no smokers" },
      { e164: "+12125550184", name: "Max, 31", seeking: "I'm a man looking for women, 25 to 35, within 5 miles of 11211", goal: "A relationship, no smokers" },
    ];
    for (const p of people) for (const body of ["slop", p.name, p.seeking, p.goal, "Weekend evenings work best"]) await text(s, clock, p.e164, body);
    const lou = (await memberId(people[0]!.e164))!, max = (await memberId(people[1]!.e164))!;
    expect(lou).toBeString();
    expect(max).toBeString();

    expect((await staff(s, ADMIN, "POST", "/apps/slop/matching", { on: true })).status).toBe(200);
    const queue = async () => ((await (await staff(s, REVIEWER, "GET", "/apps/slop/review")).json() as any).items ?? []) as any[];
    let item: any;
    for (let i = 0; i < 12 && !item; i++) {
      await run(s, clock, 2 * HOUR);
      item = (await queue()).find((x: any) => x.proposal.participants.includes(lou) && x.proposal.participants.includes(max));
    }
    expect(item).toBeDefined();
    // No reviewer acts: tick until the item leaves the queue at its deadline (the Network review SLA, 12 hours).
    for (let i = 0; i < 30 && (await queue()).some((x: any) => x.oppId === item.oppId); i++) await run(s, clock, 30 * MINUTE);
    expect((await queue()).some((x: any) => x.oppId === item.oppId)).toBe(false);
    expect(((await sql`select count(*)::int as n from network.messages where app_id = 'slop' and opportunity_id = ${item.oppId} and direction = 'outbound'`)[0] as { n: number }).n).toBe(0);

    const { input, cfg } = await s.runtimeFor("slop")!.readState(n => ({ input: n.packInput(clock.now()), cfg: n.effectiveEngineConfig() }));
    expect(input.recentProposals?.map(p => p.id)).toContain(item.oppId);
    expect(input.unsentProposalIds).toContain(item.oppId);
    const w = new World(input, resolveConfig(cfg), localEmbed, makeSlopPack({ verification: { required: false } }));
    expect([w.get(lou)!.recentProactive, w.get(max)!.recentProactive]).toEqual([0, 0]);
    expect(w.activePairs.has(pairKey(lou, max))).toBe(false);
    await s.close(); svc = undefined;
  }, T);
});
