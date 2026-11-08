// Integration: the weekly bias monitor's cadence in the ops alert round (createOps, the runtime probe
// and PgAlertStore) on the dev Postgres (:54339), in a database of its own. The service writes a bias
// report for each photo-app network once a week in afterTick (service.ts weeklyBias). When that work
// fails on every tick (for example a member read that a bad migration breaks), the ticks still run and
// tick_late stays quiet, so the ops round itself must see that the newest report is too old (SD-233).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { createOps, opsConfigFromEnv, PgAlertStore, runtimeProbe, type Notice } from "./ops.ts";

const user = process.env.USER ?? "postgres";
const DB = `ops_bias_late_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 20, 15);

/** The stored report's fields that the ops round reads: two groups of 8 with outcomes (a report that can compare groups). */
const REPORT = { overall: { proposals: 1, dates: 1, secondDates: 0 }, groups: { q1: { n: 8 }, q2: { n: 8 } }, alerts: [] };

let sql: SQL;

describe.skipIf(!pgAvailable)("ops alerts: the weekly bias report is late (SD-233)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, 120_000);
  afterAll(async () => {
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("a photo-app network whose newest bias report is more than 8 days old raises bias_late; a new report ends it", async () => {
    const report = (at: number) => sql`insert into network.bias_reports (app_id, id, network_id, at, members, alerts, report)
      values ('slop', ${`bias_slop:nyc_${at}`}, 'slop:nyc', ${new Date(at)}, 40, 0, ${REPORT}::jsonb)`;
    await sql`insert into network.network_state (id, version, state, saved_at) values ('slop:nyc', 1, ${{ reports: [] }}::jsonb, ${new Date(T0 - MIN)})`;
    // The last report that the monitor wrote; every weekly run since then failed.
    await report(T0 - 9 * DAY);

    let now = T0;
    const probeSql = new SQL({ url: URL_, max: 1 });
    // The ticks run: the stored tick is always one minute old, so tick_late stays quiet.
    const probe = runtimeProbe({
      id: "slop:nyc", app: { id: "slop" },
      health: async () => ({ lastTick: { stored: now - MIN, savedAt: now - MIN }, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 } }),
      scoped: fn => probeSql.begin(async tx => { await tx`select set_config('app.app_id', 'slop', true)`; return fn(tx as unknown as SQL); }) as never,
    });
    const posts: Notice[][] = [];
    const ops = createOps({
      config: opsConfigFromEnv({}, { env: "test", build: "b", deployed: false }), probes: () => [probe], store: new PgAlertStore(sql), now: () => now,
      log: { info() {}, warn() {}, error() {} }, post: async body => { posts.push(body.alerts as Notice[]); return true; },
    });
    try {
      await ops.tick();
      const firing = posts.flat().filter(n => n.state === "firing").map(n => n.key);
      expect(firing).toEqual(["bias_late:slop:nyc"]);

      // The monitor runs again: the alert ends.
      now += 2 * MIN;
      await report(now - MIN);
      await ops.tick();
      expect(posts.flat().filter(n => n.state === "resolved").map(n => n.key)).toEqual(["bias_late:slop:nyc"]);
    } finally { await probeSql.close(); }
  }, 120_000);
});
