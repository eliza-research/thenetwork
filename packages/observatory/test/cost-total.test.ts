// SD-291: the cost panel's total budget line (admin@*) under an app's own read login. Row-level
// security keeps that login to its app's rows and the shared ones, so the total must come from the
// cross-app login, which reads every app's cost rows. The console in real mode on a running server.
// Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const TOKEN = "cost-total-admin-token".padEnd(32, "-0123456789abcdef");
const SLOP_LOGIN = `obs_cost_slop_${process.pid}`, CROSS_LOGIN = `obs_cost_cross_${process.pid}`;
const ENV = ["OBSERVATORY_DATABASE_URL_SLOP", "OBSERVATORY_PLATFORM_DATABASE_URL", "COST_BUDGET_DAILY_USD", "NETWORK_DATABASE_URL", "DATABASE_URL"] as const;

describe.skipIf(!pgAvailable)("the cost panel's total budget line (Postgres)", () => {
  let dir: string, url: string;
  let obs: ObservatoryServer;
  const keep: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ENV) { keep[k] = process.env[k]; delete process.env[k]; }
    url = await testDb();
    const sql = new SQL(url);
    const today = new Date().toISOString().slice(0, 10);
    await sql`insert into network.cost_ledger (id, app_id, day, at, kind, provider, cost_usd) values
      ('c1', 'ntwrk', ${today}::date, now(), 'llm', 'surplus', 1.5), ('c2', 'slop', ${today}::date, now(), 'photo_rating', 'workers_ai', 2),
      ('c3', 'peon', ${today}::date, now(), 'llm', 'surplus', 0.5), ('c4', 'shared', ${today}::date, now(), 'blooio_line', 'blooio', 1)`;
    for (const [login, role] of [[SLOP_LOGIN, "network_observatory_slop"], [CROSS_LOGIN, "network_observatory_cross_app"]]) {
      await sql.unsafe(`drop role if exists ${login}`);
      await sql.unsafe(`create role ${login} login in role ${role}`);
    }
    await sql.close();
    const as = (login: string) => url.replace(/\/\/[^@]+@/, `//${login}@`);
    process.env.OBSERVATORY_DATABASE_URL_SLOP = as(SLOP_LOGIN);
    process.env.OBSERVATORY_PLATFORM_DATABASE_URL = as(CROSS_LOGIN);
    process.env.COST_BUDGET_DAILY_USD = "10";
    dir = await mkdtemp(join(tmpdir(), "obs-cost-"));
    obs = await createServer({
      port: 0, development: false, token: TOKEN, mode: "real", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false, staffRolesUrl: false,
      real: { url, pollMs: 3_600_000, pushMs: 3_600_000, service: false },
    });
  }, T);
  afterAll(async () => {
    await obs?.stop(); await dropTestDb();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (url) { const s = new SQL(url.replace(/\/[^/]+$/, "/postgres")); for (const l of [SLOP_LOGIN, CROSS_LOGIN]) await s.unsafe(`drop role if exists ${l}`).catch(() => {}); await s.close(); }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("admin@* on slop sees every app's cost today in the total line; the app line stays slop and shared", async () => {
    const r = await fetch(obs.url + "/api/ops/cost?app=slop", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(200);
    const body = await r.json() as { today: { app: number; shared: number }; budgets: { scope: string; usedUsd: number; budgetUsd: number }[] };
    expect(body.today).toMatchObject({ app: 2, shared: 1 });
    expect(body.budgets.find(b => b.scope === "total")).toMatchObject({ usedUsd: 5, budgetUsd: 10 });
  }, T);
});
