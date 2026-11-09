// Integration: the tick_late alert on the real NetworkService runtime and the dev Postgres (:54339),
// in a database of its own. When the ticks stop (every tick throws) while inbound units still save the
// network state, the ops round must still see that the last tick is old. The state save refreshes
// network_state.saved_at, so an age taken from saved_at hides the stalled tick (SD-368).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { SimClock } from "../../packages/core/src/index.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { collectNetwork, evaluate, opsConfigFromEnv, runtimeProbe } from "./ops.ts";

const user = process.env.USER ?? "postgres";
const DB = `ops_tick_late_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const MIN = 60_000;

let svc: NetworkService | undefined;

describe.skipIf(!pgAvailable)("ops alerts: tick_late while state saves continue (SD-368)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { lockTimeout: "5s" });
  }, 120_000);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("a network whose last tick is 20 min old raises tick_late although an inbound unit saved the state just now", async () => {
    // The database stamps saved_at with its own time, so the clock starts 20 minutes before the wall time.
    const clock = new SimClock(Date.now() - 20 * MIN);
    svc = new NetworkService({ url: URL_, clock, instance: "ops-tick-late", tokens: "admin:adm-tok", webhookSecret: "whsec_ops_tick_late", network: { seed: 1 }, log: () => {} });
    await svc.start();
    const rt = svc.main;
    // The last tick that ran. After it, every tick fails, so no tick is stored again.
    expect(await rt.tick()).toBe(true);
    clock.advance(20 * MIN);
    // An inbound unit (or a staff action) still runs and saves the state.
    await rt.unitOfWork(() => undefined);

    const config = opsConfigFromEnv({}, { env: "test", build: "b", deployed: false });
    const m = await collectNetwork(runtimeProbe(rt), clock.now());
    expect(m.lastTickAgoMs).toBe(20 * MIN);
    expect(evaluate({ networks: [m], cost: { day: "d", totalUsd: 0, byApp: {}, budgets: [] }, uptimeMs: 60 * MIN }, config).map(a => a.key)).toContain(`tick_late:${rt.id}`);
  }, 120_000);
});
