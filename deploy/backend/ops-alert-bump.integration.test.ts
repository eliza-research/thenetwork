// Integration: the ops alert round (createOps, the runtime probe and PgAlertStore) on the dev Postgres
// (:54339), in a database of its own. A "bump" alert (safety signals, reports, holds) must be posted
// again when its count goes up, also after the count fell below the count that was last posted
// (docs/deploy.md 7.2). SD-161. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { createOps, opsConfigFromEnv, PgAlertStore, runtimeProbe, type Notice } from "./ops.ts";

const user = process.env.USER ?? "postgres";
const DB = `ops_alert_bump_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 8, 15);
const KEY = "safety_signal:slop:nyc";

let sql: SQL;

describe.skipIf(!pgAvailable)("ops alerts: a safety count that rises again is posted (SD-161)", () => {
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

  test("safety_signal sent at 5, cleared to 1, then 3 waiting: the rise to 3 is posted before the repeat interval", async () => {
    await sql`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at) values ('slop', 'm1', 'Sim One', 'nyc', 'active', 30, ${new Date(T0)})`;
    await sql`insert into network.network_state (id, version, state, saved_at) values ('slop:nyc', 1, ${{ reports: [] }}::jsonb, ${new Date(T0)})`;
    let n = 0;
    /** Agent safety signals that wait for staff (proposed facets tagged signal:safety_concern). */
    const signals = (k: number) => sql.begin(async tx => {
      for (let i = 0; i < k; i++, n++) await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, status)
        values ('slop', ${`sig${n}`}, 'm1', 'signal', 'safety concern', ${tx.array(["signal:safety_concern"], "TEXT")}, 'agent_private', 'inferred', 'proposed')`;
    });
    const clear = (k: number) => sql`update network.facets set status = 'rejected' where id in (select id from network.facets where status = 'proposed' order by id limit ${k})`;

    let now = T0;
    const probe = runtimeProbe({
      id: "slop:nyc", app: { id: "slop" },
      health: async () => ({ lastTick: { stored: now - MIN, savedAt: now - MIN }, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 } }),
      scoped: fn => sql.begin(async tx => { await tx`select set_config('app.app_id', 'slop', true)`; return fn(tx as unknown as SQL); }) as never,
    });
    const posts: Notice[][] = [];
    const ops = createOps({
      config: opsConfigFromEnv({}, { env: "test", build: "b", deployed: false }), probes: () => [probe], store: new PgAlertStore(sql), now: () => now,
      log: { info() {}, warn() {}, error() {} }, post: async body => { posts.push(body.alerts as Notice[]); return true; },
    });
    const signalPosts = () => posts.flat().filter(p => p.key === KEY).map(p => `${p.state}:${p.count}`);

    await signals(5);
    await ops.tick();
    expect(signalPosts()).toEqual(["firing:5"]);

    await clear(4);
    now += 5 * MIN;
    await ops.tick();
    expect(signalPosts()).toEqual(["firing:5"]);

    await signals(2);
    now += 5 * MIN;
    await ops.tick();
    expect(signalPosts()).toEqual(["firing:5", "firing:3"]);
  }, 120_000);
});
