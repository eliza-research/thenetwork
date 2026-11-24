import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { dropTestDb, pgAvailable, testDb } from "../../../apps/observatory/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

const clock = new SimClock(Date.UTC(2026, 10, 12, 17));
let url: string, db: SQL;

beforeAll(async () => {
  if (!pgAvailable) return;
  url = await testDb();
  db = new SQL({ url, max: 1 });
}, 120_000);

afterAll(async () => {
  await db?.close();
  await dropTestDb();
});

async function withService(env: Record<string, string>, run: (call: (app: string, method: string, path: string, body?: object) => Promise<{ status: number; body: any }>) => Promise<void>) {
  await db`update platform.settings set value=${env.PLATFORM_ENV!} where key='environment'`;
  const service = await NetworkService.fromDatabase({ url, clock, instance: `peon-scope-${randomUUID()}`, log: () => {}, photoStorage: null, notify: false,
    tokens: "admin@*:adm-tok", env: { PLATFORM_HASH_KEY: "peon-scope-synthetic-hash-key-0123456789", ...env }, adapter: () => new DryRunAdapter(() => {}) });
  await service.start();
  try {
    await run(async (app, method, path, body) => {
      const res = await service.fetch(new Request(`http://127.0.0.1/apps/${app}${path}`, { method, headers: { authorization: "Bearer adm-tok",
        ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
      return { status: res.status, body: await res.json() };
    });
  } finally { await service.close(); }
}

const refusals = () => db`select app_id as app, detail->>'reason' as reason from network.staff_audit
  where action='config' and detail->>'phase'='refused' order by at, id`;

test.skipIf(!pgAvailable)("peon matching follows its registry row in production with no live decision", async () => {
  expect(await db`select matching_enabled from platform.networks where id='peon:nyc'`).toEqual([{ matching_enabled: true }]);

  await withService({ PLATFORM_ENV: "production" }, async call => {
    expect((await call("peon", "GET", "/health")).body).toMatchObject({ network: "peon:nyc", matchingAllowed: true, matchingEnabled: false });
    expect((await call("peon", "POST", "/matching", { on: true })).status).toBe(200);
    expect((await call("peon", "GET", "/health")).body.matchingEnabled).toBe(true);
    expect((await call("slop", "GET", "/health")).body.matchingAllowed).toBe(true);
    expect((await call("slop", "POST", "/matching", { on: true })).status).toBe(200);
  });
  expect(await refusals()).toEqual([]);

  await withService({ PLATFORM_ENV: "production" }, async call => {
    expect((await call("peon", "GET", "/health")).body).toMatchObject({ matchingAllowed: true, matchingEnabled: true });
  });

  await db`update platform.networks set matching_enabled=false where id='peon:nyc'`;
  await withService({ PLATFORM_ENV: "production" }, async call => {
    expect((await call("peon", "GET", "/health")).body).toMatchObject({ matchingAllowed: false, matchingEnabled: false });
    expect(await call("peon", "POST", "/matching", { on: true })).toMatchObject({ status: 409, body: { ok: false, reason: "matching_not_allowed" } });
  });
  expect(await refusals()).toEqual([{ app: "peon", reason: "matching_not_allowed" }]);
}, 300_000);
