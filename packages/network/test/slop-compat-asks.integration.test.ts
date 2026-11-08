// The slop compatibility asks through NetworkService on Postgres (docs/research/2026-11-07-state-machines.md,
// module matching_engine, SD-419). A member who gave a goal and said "no dealbreakers" leaves no
// dealbreaker tag, and no production path writes a type (`slop:wants:`, `slop:self:`). So the basics
// ask and the type ask stayed due for as long as the member stayed, and the engine asked them again
// every 21 days without the per-question cap the hard asks have. Postgres in a database of its own;
// dry-run sends; fictional numbers (+1 212 555 01xx). Nothing is sent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SLOP_DEFAULT_OPTIONS } from "@thenetwork/engine";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 600_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_slop_compat_asks_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_slop_compat_asks";
const ADMIN = "adm-tok";
const RAE = "+12125550174";

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

describe.skipIf(!pgAvailable)("slop compatibility asks (NetworkService, Postgres)", () => {
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

  test("a member with a goal and no dealbreakers gets each compatibility ask at most the per-question cap", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-compat-asks", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: `admin:${ADMIN}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    try {
      for (const body of ["slop", "Rae, 29", "I'm a woman looking for men, 27 to 38, within 5 miles of 11222"]) await text(s, clock, RAE, body);
      const rae = (await memberId(RAE))!;
      expect(rae).toBeString();
      const last = async () => ((await sql`select body from network.messages where app_id = 'slop' and member_id = ${rae} and direction = 'outbound' order by ts desc, id desc limit 1`)[0] as { body: string }).body;
      // Each onboarding question gets its answer; each read-back gets a yes.
      const ANSWERS: [RegExp, string][] = [[/^so: /, "yes"], [/dealbreaker|looking for right now/i, "Something serious, no dealbreakers"], [/What are you into/, "Climbing and live music"],
        [/first date/, "Drinks or a walk"], [/free for you/, "Weekend evenings work best"], [/25 miles/, "Sure"],
        [/your type/, "Someone kind and curious. My friends say I'm the funny one."]];
      let prev = "";
      for (let i = 0; i < 10; i++) {
        const q = await last();
        const a = ANSWERS.find(([re]) => re.test(q));
        if (!a || q === prev) break;
        prev = q;
        await text(s, clock, RAE, a[1]);
      }
      const rt = s.runtimeFor("slop")!;
      const st = () => rt.readState(n => {
        const m = n.memberList().find(x => x.id === rae)!;
        return { onboarding: m.onboarding as any, asks: n.exportState().asks.filter(a => a.memberId === rae).map(a => a.reason) };
      });
      const before = await st();
      expect(before.onboarding).toMatchObject({ confirmed: true, goal: { value: "long_term" } });
      expect(before.onboarding.dealbreakers).toEqual([]);

      expect((await s.fetch(new Request("http://127.0.0.1:4848/apps/slop/matching", { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: JSON.stringify({ on: true }) }))).status).toBe(200);
      // Six months of daily runs; the member answers every question.
      for (let t = 0; t < 180 * DAY; t += 6 * HOUR) {
        clock.advance(6 * HOUR); await s.tick();
        const q = await last();
        const a = ANSWERS.find(([re]) => re.test(q));
        if (a && q !== prev) await text(s, clock, RAE, a[1]);
        prev = q;
      }
      const asks = (await st()).asks;
      const count = (r: string) => asks.filter(x => x === r).length;
      // Both were asked (the cap, not a missing ask, keeps the count down).
      expect(count("slop_basics")).toBeGreaterThan(0);
      expect(count("slop_type")).toBeGreaterThan(0);
      expect(count("slop_basics")).toBeLessThanOrEqual(SLOP_DEFAULT_OPTIONS.maxAsksPerField);
      expect(count("slop_type")).toBeLessThanOrEqual(SLOP_DEFAULT_OPTIONS.maxAsksPerField);
    } finally { await s.close(); svc = undefined; }
  }, T);
});
