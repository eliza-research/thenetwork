// Integration: the deployed backend's tick loop (createBackend.tickAll) on the real NetworkService and
// the dev Postgres (:54339), in a database of its own. The deployed tick set must do what
// packages/network/service/serve.ts startTicks does: handle the inbound rows a crash left waiting
// (svc.inboxTick) and apply retention (svc.purge). SD-003. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, SimClock } from "../../packages/core/src/index.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { START } from "../../packages/network/test/mini.ts";
import { createBackend, jsonLogger, loadConfig } from "./backend.ts";

const user = process.env.USER ?? "postgres";
const DB = `backend_ticks_${process.pid}`;
const ADMIN_URL = `postgres://${user}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${user}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

let sql: SQL;
let svc: NetworkService | undefined;

describe.skipIf(!pgAvailable)("deployed backend tick set (SD-003)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, 120_000);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("one backend tick handles an inbound row a crash left waiting and removes expired platform rows", async () => {
    const clock = new SimClock(START);
    svc = new NetworkService({ url: URL_, clock, instance: "backend-ticks", tokens: "admin:adm-tok", webhookSecret: "whsec_backend_ticks", network: { seed: 1 }, log: () => {} });
    await svc.start();
    // A rate window three days old: retention keeps rate windows two days (service.ts purge).
    await sql`insert into platform.rate_limits (bucket, window_start, count, last_at) values ('ticks:old', ${new Date(START - 3 * DAY)}, 1, ${new Date(START - 3 * DAY)})`;
    // An inbound HELP that a crash left pending: stored, never handled (inbox.ts receive stores before it handles).
    const from = "+12125550177";
    const ev = { kind: "message", channel: "sim", messageId: "crash1", from, to: "+12125550100", chatId: from, isGroup: false, text: "HELP", mediaUrls: [], transport: "imessage", receivedAt: START - 60_000 };
    await sql`insert into platform.inbound (id, line, sender, received_at, arrived_at, event, status, sender_hash)
      values ('msg:sim:crash1', '+12125550100', ${from}, ${new Date(START - 60_000)}, ${new Date(START - 60_000)}, ${{ ev, app: null }}::jsonb, 'pending', 'k:crash1')`;

    const config = { ...loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: URL_ }), tickMs: 3_600_000 };
    const backend = createBackend({ svc, config, log: jsonLogger(() => {}), ping: async () => true, now: () => clock.now() });
    await backend.tickAll();

    const [inbound] = await sql`select status from platform.inbound where id = 'msg:sim:crash1'`;
    expect(inbound?.status).toBe("done");
    expect((await sql`select 1 from platform.rate_limits where bucket = 'ticks:old'`).length).toBe(0);
  }, 120_000);
});
