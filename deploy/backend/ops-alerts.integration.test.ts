// Integration: the ops alert round (createOps, the runtime probe and PgAlertStore) on the dev Postgres
// (:54339), in a database of its own. A monitoring read that fails must not report the open alerts of
// that network as resolved: the condition was not read, so it did not end (SD-113). Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { createOps, opsConfigFromEnv, PgAlertStore, runtimeProbe, type Notice } from "./ops.ts";

const user = process.env.USER ?? "postgres";
const DB = `ops_alerts_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const MIN = 60_000, HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 9, 8, 15);

let sql: SQL;

describe.skipIf(!pgAvailable)("ops alerts: a read error is not a resolution (SD-113)", () => {
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

  test("safety_minor stays open and is not posted as resolved while the network cannot be read", async () => {
    const at = new Date(T0 - HOUR);
    await sql`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at) values ('slop', 'm1', 'Sim One', 'nyc', 'active', 16, ${at})`;
    await sql`insert into network.events (app_id, at, actor_type, type, object_type, object_id, payload) values ('slop', ${at}, 'agent', 'minor_after_contact', 'member', 'm1', ${{ memberId: "m1" }}::jsonb)`;
    await sql`insert into network.network_state (id, version, state, saved_at) values ('slop:nyc', 1, ${{ reports: [] }}::jsonb, ${new Date(T0 - MIN)})`;

    // The probe's own pool (as NetworkRuntime.scoped): closing it makes the next read fail.
    const probeSql = new SQL({ url: URL_, max: 1 });
    const probe = runtimeProbe({
      id: "slop:nyc", app: { id: "slop" },
      health: async () => { await probeSql`select 1`; return { lastTick: { stored: T0 - MIN, savedAt: T0 - MIN }, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 } }; },
      scoped: fn => probeSql.begin(async tx => { await tx`select set_config('app.app_id', 'slop', true)`; return fn(tx as unknown as SQL); }) as never,
    });
    let now = T0;
    const posts: Notice[][] = [];
    const ops = createOps({
      config: opsConfigFromEnv({}, { env: "test", build: "b", deployed: false }), probes: () => [probe], store: new PgAlertStore(sql), now: () => now,
      log: { info() {}, warn() {}, error() {} }, post: async body => { posts.push(body.alerts as Notice[]); return true; },
    });

    await ops.tick();
    expect(posts.at(-1)?.map(n => `${n.key}:${n.state}`)).toContain("safety_minor:slop:nyc:firing");

    // One failed read of the network (its connection is gone).
    await probeSql.close();
    now += 5 * MIN;
    await ops.tick();
    const resolved = posts.flat().filter(n => n.state === "resolved").map(n => n.key);
    expect(resolved).not.toContain("safety_minor:slop:nyc");
    const [row] = await sql`select open from network.ops_alerts where key = 'safety_minor:slop:nyc'`;
    expect(row?.open).toBe(true);
  }, 120_000);
});
