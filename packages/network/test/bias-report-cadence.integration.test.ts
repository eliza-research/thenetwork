// Integration: the weekly bias report cadence (NetworkService.weeklyBias) with two replicas on the dev
// Postgres (:54339), in a database of its own. afterTick runs after the tick lock is released, so two
// replicas can reach weeklyBias for the same network at the same time. Both read the same old max(at)
// and, before the fix, both wrote a report: two reports in one week, which doubles the bias alert
// count in the ops round (SD-446).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { SimClock } from "@thenetwork/core";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { NetworkService } from "../service/service.ts";
import { START } from "./mini.ts";

const user = process.env.USER ?? "postgres";
const DB = `bias_cadence_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const DAY = 86_400_000;

let sql: SQL;
const services: NetworkService[] = [];

describe.skipIf(!pgAvailable)("weekly bias report: one report per week with two replicas (SD-446)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, 120_000);
  afterAll(async () => {
    for (const s of services) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("two replicas that run the weekly bias monitor at the same time store one report", async () => {
    // The last report is 8 days old: the next one is due.
    await sql`insert into network.bias_reports (app_id, id, network_id, at, members, alerts, report)
      values ('slop', 'bias_old', 'slop:nyc', ${new Date(START - 8 * DAY)}, 0, 0, ${{ alerts: [] }}::jsonb)`;
    // Two replicas, a few milliseconds apart (the report id holds the time, so the primary key does not stop the second).
    const replica = (i: number) => {
      const s = new NetworkService({ url: URL_, clock: new SimClock(START + i), env: { PLATFORM_ENV: "dev" }, instance: `bias-${i}`,
        networks: [{ id: "slop:nyc" }], notify: false, log: () => {} });
      services.push(s);
      return s;
    };
    const [a, b] = [replica(0), replica(3)];
    // Hold the inserts (SHARE mode lets reads through) until both replicas have read the old max(at) and wait.
    const holder = new SQL({ url: URL_, max: 1 });
    try {
      let release!: () => void;
      const held = new Promise<void>(r => { release = r; });
      const lock = holder.begin(async tx => { await tx`lock table network.bias_reports in share mode`; await held; });
      await Bun.sleep(50);
      const runs = Promise.all([a.weeklyBias(a.runtimeFor("slop")!), b.weeklyBias(b.runtimeFor("slop")!)]);
      for (let i = 0; i < 200; i++) {
        const [w] = await sql`select count(*)::int as n from pg_locks where not granted and database = (select oid from pg_database where datname = current_database())`;
        if ((w?.n ?? 0) >= 2) break;
        await Bun.sleep(25);
      }
      release();
      await lock;
      const made = await runs;
      expect(made.filter(Boolean)).toHaveLength(1);
    } finally { await holder.close(); }
    const rows = await sql`select id from network.bias_reports where network_id = 'slop:nyc' and at > ${new Date(START - DAY)}`;
    expect(rows).toHaveLength(1);
  }, 120_000);
});
