// Integration: the deployed backend's tick, tick-late and shutdown-grace numbers (TICK_MS, TICK_LATE_MS,
// SHUTDOWN_GRACE_MS) on the real NetworkService and the dev Postgres (:54339), in a database of its own.
// An empty value must take the default, and a value that is not a number must stop the boot, as
// opsConfigFromEnv does for its numbers. Before the fix an empty value gave 0: /healthz answered
// tick_late one minute after a good tick, and the shutdown had no grace period (SD-370).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { SimClock } from "../../packages/core/src/index.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { START } from "../../packages/network/test/mini.ts";
import { createBackend, jsonLogger, loadConfig } from "./backend.ts";

const user = process.env.USER ?? "postgres";
const DB = `backend_timing_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const MIN = 60_000;

let svc: NetworkService | undefined;

describe.skipIf(!pgAvailable)("deployed backend timing numbers (SD-370)", () => {
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

  test("empty TICK_MS, TICK_LATE_MS and SHUTDOWN_GRACE_MS take the defaults: /healthz is ok one minute after a tick and the shutdown is clean", async () => {
    const clock = new SimClock(START);
    svc = new NetworkService({ url: URL_, clock, instance: "backend-timing", tokens: "admin:adm-tok", webhookSecret: "whsec_backend_timing", network: { seed: 1 }, log: () => {} });
    await svc.start();
    const config = loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: URL_, TICK_MS: "", TICK_LATE_MS: "", SHUTDOWN_GRACE_MS: "" });
    const backend = createBackend({ svc, config, log: jsonLogger(() => {}), ping: async () => true, now: () => clock.now() });
    await backend.startTicks();
    clock.advance(MIN);
    const res = await backend.publicFetch(new Request("http://127.0.0.1/healthz"));
    expect([res.status, (await res.json()).ok]).toEqual([200, true]);
    expect((await backend.shutdown()).clean).toBe(true);
    svc = undefined;
  }, 120_000);

  test("a value that is not a number, or a tick of 0, stops the boot", () => {
    const base = { PLATFORM_ENV: "dev", DATABASE_URL: URL_ };
    for (const bad of [{ TICK_MS: "abc" }, { TICK_MS: "0" }, { TICK_LATE_MS: "soon" }, { SHUTDOWN_GRACE_MS: "-1" }]) {
      expect(() => loadConfig({ ...base, ...bad })).toThrow(Object.keys(bad)[0]!);
    }
  });
});
