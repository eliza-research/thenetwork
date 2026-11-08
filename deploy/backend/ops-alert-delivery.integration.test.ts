// Integration: the delivery of ops alerts (createOps, the runtime probe and PgAlertStore) on the dev
// Postgres (:54339), in a database of its own. An alert that the webhook did not take must not close
// without a notice when its condition ends (SD-235), and the heartbeat must not report a good round
// while the webhook fails (SD-360). Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { createOps, opsConfigFromEnv, PgAlertStore, runtimeProbe, type Notice } from "./ops.ts";

const user = process.env.USER ?? "postgres";
const DB = `ops_alert_delivery_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const MIN = 60_000, HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 9, 20, 15);
const KEY = "bias_report:slop:nyc";

let sql: SQL;

describe.skipIf(!pgAvailable)("ops alerts: delivery when the webhook fails", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
    await sql`insert into network.network_state (id, version, state, saved_at) values ('slop:nyc', 1, ${{ reports: [] }}::jsonb, ${new Date(T0 - MIN)})`;
    // A weekly bias report with two groups under 0.8x: bias_report:slop:nyc fires for 24 h.
    await sql`insert into network.bias_reports (app_id, id, network_id, at, members, alerts, report)
      values ('slop', 'bias_slop:nyc_t0', 'slop:nyc', ${new Date(T0 - MIN)}, 40, 2, ${{ alerts: [] }}::jsonb)`;
  }, 120_000);
  afterAll(async () => {
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  function opsWith(webhookUp: () => boolean, now: () => number, heartbeat?: { url: string; pings: number[] }) {
    const probe = runtimeProbe({
      id: "slop:nyc", app: { id: "slop" },
      health: async () => ({ lastTick: { stored: now() - MIN, savedAt: now() - MIN }, backlog: { review: 0, reviewOverdue: 0, deferred: 0, outboundWaiting: 0 } }),
      scoped: fn => sql.begin(async tx => { await tx`select set_config('app.app_id', 'slop', true)`; return fn(tx as unknown as SQL); }) as never,
    });
    const delivered: Notice[] = [];
    const ops = createOps({
      config: opsConfigFromEnv(heartbeat ? { OPS_HEARTBEAT_URL: heartbeat.url } : {}, { env: "test", build: "b", deployed: false }), probes: () => [probe], store: new PgAlertStore(sql), now,
      log: { info() {}, warn() {}, error() {} }, ping: async () => { heartbeat?.pings.push(now()); return true; },
      post: async body => { if (!webhookUp()) return false; delivered.push(...(body.alerts as Notice[])); return true; },
    });
    return { ops, delivered };
  }

  test("an alert the webhook never took, whose 24 h window ends during the outage, is still posted when the webhook is back (SD-235)", async () => {
    let now = T0, up = false;
    const { ops, delivered } = opsWith(() => up, () => now);
    // The webhook answers 500 for 26 hours; the bias report leaves the 24 h window during that time.
    for (let h = 0; h < 26; h++) { await ops.tick(); now += HOUR; }
    up = true;
    await ops.tick();
    now += HOUR;
    await ops.tick();
    // The on-call channel hears of the alert: the notice of its end names it.
    expect(delivered.filter(n => n.key === KEY).map(n => n.state)).toEqual(["resolved"]);
    const [row] = await sql`select open from network.ops_alerts where key = ${KEY}`;
    expect(row?.open).toBe(false);
  }, 120_000);

  test("the heartbeat is not pinged after a round whose alert post failed, and is pinged again once the webhook takes it (SD-360)", async () => {
    const T1 = T0 + 10 * 24 * HOUR;
    await sql`insert into network.bias_reports (app_id, id, network_id, at, members, alerts, report)
      values ('slop', 'bias_slop:nyc_t1', 'slop:nyc', ${new Date(T1 - MIN)}, 40, 1, ${{ alerts: [] }}::jsonb)`;
    let now = T1, up = false;
    const heartbeat = { url: "https://heartbeat.test/ping", pings: [] as number[] };
    const { ops, delivered } = opsWith(() => up, () => now, heartbeat);
    // The webhook answers 500: the alert is not delivered, so the dead man's switch must go quiet.
    for (let i = 0; i < 3; i++) { await ops.tick(); now += 5 * MIN; }
    expect(delivered.filter(n => n.key === KEY)).toEqual([]);
    expect(heartbeat.pings).toEqual([]);
    up = true;
    await ops.tick();
    expect(delivered.filter(n => n.key === KEY).map(n => n.state)).toEqual(["firing"]);
    expect(heartbeat.pings).toEqual([now]);
  }, 120_000);
});
