// Integration: NetworkService constructor and start() boot checks (Wave 4 boot_config hardening).
// Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { NetworkService, type ServiceOptions } from "../service/service.ts";

const KEY = "k".repeat(40);
let url = "";
const open: NetworkService[] = [];

function service(env: Record<string, string>, more: Partial<ServiceOptions> = {}) {
  const s = new NetworkService({
    url, clock: new SimClock(Date.UTC(2026, 10, 11, 16)), instance: "boot-config-w4", photoStorage: null, notify: false,
    log: () => {}, env: { CLEF_RATINGS: "off", ...env }, networks: [{ id: "ntwrk:nyc", matchingEnabled: false }], network: { seed: 1 }, ...more,
  });
  open.push(s);
  return s;
}
async function asOwner(fn: (sql: SQL) => Promise<unknown>) { const sql = new SQL({ url, max: 1 }); try { await fn(sql); } finally { await sql.close(); } }

describe.skipIf(!pgAvailable)("the service boot checks", () => {
  beforeAll(async () => { url = await migratedDb("bootw4_service"); });
  afterAll(async () => { for (const s of open) await s.close().catch(() => {}); if (url) await dropDb(url); });

  test("Q-boot_config-W4-2: a staging service refuses to start when platform.settings has no environment row", async () => {
    await asOwner(sql => sql`delete from platform.settings where key = 'environment'`);
    try {
      await expect(service({ PLATFORM_ENV: "staging", PLATFORM_HASH_KEY: KEY }).start()).rejects.toThrow(/platform\.settings\.environment/);
    } finally {
      await asOwner(sql => sql`insert into platform.settings (key, value) values ('environment', 'dev') on conflict (key) do update set value = 'dev'`);
    }
  }, 60_000);

  test("W3-457: a staging service refuses a staff token or a console token shorter than 32 characters", () => {
    const staging = { PLATFORM_ENV: "staging", PLATFORM_HASH_KEY: KEY };
    const long = "t".repeat(32);
    expect(() => service(staging, { tokens: "reviewer@*:abcdefghij" })).toThrow(/NETWORK_SERVICE_TOKENS: a token is shorter than 32/);
    expect(() => service(staging, { tokens: `admin@*:${long}`, consoleToken: "abcdefghij" })).toThrow(/NETWORK_SERVICE_CONSOLE_TOKEN.*32/);
    expect(() => service(staging, { tokens: `admin@*:${long}`, consoleToken: long })).not.toThrow();
  });
});
