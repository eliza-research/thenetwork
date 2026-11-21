// spec/runtimeUnit.md, "Matching runs for an app only inside its launch scope", through the real service on
// Postgres: the service is built from platform.networks (where migration 0011 allows peon:nyc), and the
// staff API's matching switch and /health give one answer for peon. In production peon matching stays off
// until the founder's live decision (PEON_LIVE_APPROVED=1); a test environment and that decision allow it;
// slop follows its registry row in every environment. The admin console shows the /health value.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

const database = `network_peon_scope_${randomUUID().replaceAll("-", "")}`;
const local = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}`;
const url = `${local}/${database}`;
const clock = new SimClock(Date.UTC(2026, 10, 12, 17));
let admin: SQL, db: SQL;

beforeAll(async () => {
  if (!pgAvailable) return;
  await devPgUp();
  admin = new SQL({ url: `${local}/postgres`, max: 1 });
  await admin.unsafe(`create database ${database}`);
  await applySchema(url, { lockTimeout: "60s" });
  db = new SQL({ url, max: 1 });
}, 120_000);

afterAll(async () => {
  await db?.close();
  await admin?.unsafe(`drop database if exists ${database} with (force)`);
  await admin?.close();
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

test.skipIf(!pgAvailable)("peon matching is allowed by the registry row but stays off in production until its live decision", async () => {
  expect(await db`select matching_enabled from platform.networks where id='peon:nyc'`).toEqual([{ matching_enabled: true }]);

  await withService({ PLATFORM_ENV: "production" }, async call => {
    expect((await call("peon", "GET", "/health")).body).toMatchObject({ network: "peon:nyc", matchingAllowed: false, matchingEnabled: false });
    expect(await call("peon", "POST", "/matching", { on: true })).toMatchObject({ status: 409, body: { ok: false, reason: "matching_not_allowed" } });
    expect((await call("peon", "GET", "/health")).body.matchingEnabled).toBe(false);
    // slop is not local-only: its registry row decides in production too.
    expect((await call("slop", "GET", "/health")).body.matchingAllowed).toBe(true);
    expect((await call("slop", "POST", "/matching", { on: true })).status).toBe(200);
  });
  expect(await refusals()).toEqual([{ app: "peon", reason: "matching_not_allowed" }]);

  await withService({ PLATFORM_ENV: "production", PEON_LIVE_APPROVED: "1" }, async call => {
    expect((await call("peon", "GET", "/health")).body.matchingAllowed).toBe(true);
    expect((await call("peon", "POST", "/matching", { on: true })).status).toBe(200);
    expect((await call("peon", "GET", "/health")).body.matchingEnabled).toBe(true);
  });

  // An approved test line (staging) matches peon without the live decision.
  await withService({ PLATFORM_ENV: "staging" }, async call => {
    expect((await call("peon", "GET", "/health")).body).toMatchObject({ matchingAllowed: true, matchingEnabled: true });
  });

  // Back in production without the decision, the stored "on" is not enough: the runtime keeps peon off.
  await withService({ PLATFORM_ENV: "production" }, async call => {
    expect((await call("peon", "GET", "/health")).body).toMatchObject({ matchingAllowed: false, matchingEnabled: false });
  });

  // A registry row that does not allow matching wins over the live decision.
  await db`update platform.networks set matching_enabled=false where id='peon:nyc'`;
  await withService({ PLATFORM_ENV: "production", PEON_LIVE_APPROVED: "1" }, async call => {
    expect((await call("peon", "GET", "/health")).body).toMatchObject({ matchingAllowed: false, matchingEnabled: false });
    expect((await call("peon", "POST", "/matching", { on: true })).status).toBe(409);
  });
}, 300_000);
