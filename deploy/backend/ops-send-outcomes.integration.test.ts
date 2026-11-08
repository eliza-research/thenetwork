// Integration: the ops round (createOps, the runtime probe and PgAlertStore) on the dev Postgres
// (:54339), in a database of its own. A send whose provider acceptance is not known yet
// (unknown_acceptance: a Cloud or provider timeout) has no outcome: it must not count as an attempt,
// or an outage lowers the 24 h failure rate under the send_failures threshold. SD-162. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { createOps, opsConfigFromEnv, PgAlertStore, runtimeProbe, type Notice } from "./ops.ts";

const user = process.env.USER ?? "postgres";
const DB = `ops_send_outcomes_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const MIN = 60_000, HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 9, 8, 15);

let sql: SQL;

describe.skipIf(!pgAvailable)("ops send outcomes: unknown acceptance is not an attempt (SD-162)", () => {
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

  test("200 delivered, 5 failed and 100 in unknown acceptance: send_failures fires at the 2% threshold", async () => {
    await sql`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at) values ('slop', 'm1', 'Sim One', 'nyc', 'active', 30, ${new Date(T0 - HOUR)})`;
    await sql`insert into network.network_state (id, version, state, saved_at) values ('slop:nyc', 1, ${{ reports: [] }}::jsonb, ${new Date(T0 - MIN)})`;
    let i = 0;
    const sends = (k: number, status: string) => sql.begin(async tx => {
      for (let j = 0; j < k; j++, i++) await tx`insert into network.messages (app_id, id, member_id, direction, channel, body, status, ts)
        values ('slop', ${`o${i}`}, 'm1', 'outbound', 'imessage', 'hi', ${status}, ${new Date(T0 - HOUR)})`;
    });
    await sends(200, "delivered");
    await sends(5, "failed");
    // A Cloud outage: these timed out and wait for a receipt lookup (up to 6 h, then failed_unknown).
    await sends(100, "unknown_acceptance");

    const probe = runtimeProbe({
      id: "slop:nyc", app: { id: "slop" },
      health: async () => ({ lastTick: { stored: T0 - MIN, savedAt: T0 - MIN }, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 } }),
      scoped: fn => sql.begin(async tx => { await tx`select set_config('app.app_id', 'slop', true)`; return fn(tx as unknown as SQL); }) as never,
    });
    const posts: Notice[][] = [];
    const ops = createOps({
      config: opsConfigFromEnv({}, { env: "test", build: "b", deployed: false }), probes: () => [probe], store: new PgAlertStore(sql), now: () => T0,
      log: { info() {}, warn() {}, error() {} }, post: async body => { posts.push(body.alerts as Notice[]); return true; },
    });
    await ops.tick();
    expect(posts.flat().map(n => `${n.key}:${n.state}`)).toContain("send_failures:slop:nyc:firing");
  }, 120_000);
});
