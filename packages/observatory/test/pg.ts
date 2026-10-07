// Test database helper: a separate `network_test` database on the local dev cluster (never the
// dev `network` database or anything remote). Tests skip when Postgres is not installed.
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { applySchema, DEV_PG_PORT, devPgUp } from "../db/dev-pg.ts";

export const TEST_PG_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/network_test`;

export const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");

export async function testDb(): Promise<string> {
  await devPgUp();
  const admin = new SQL(`postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`);
  const exists = await admin`select 1 from pg_database where datname = 'network_test'`;
  if (!exists.length) await admin.unsafe("create database network_test");
  await admin.close();
  await applySchema(TEST_PG_URL, { reset: true });
  return TEST_PG_URL;
}
