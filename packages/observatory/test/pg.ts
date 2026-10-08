// Test database helper: a database of its own per test process (network_test_<pid>) on the local
// dev cluster, never the dev `network` database or anything remote, so concurrent test runs do not
// wipe or lock each other. Each test file drops it in afterAll (dropTestDb). Tests skip when
// Postgres is not installed.
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { applySchema, DEV_PG_PORT, devPgUp } from "../db/dev-pg.ts";

const DB = `network_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
export const TEST_PG_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;

export const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");

async function admin<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try {
    await sql.unsafe("set lock_timeout = '5s'");
    return await fn(sql);
  } finally {
    await sql.close();
  }
}

/** Create (if needed) and reset this process's test database. Returns its URL. */
export async function testDb(): Promise<string> {
  await devPgUp();
  await admin(async sql => {
    const exists = await sql`select 1 from pg_database where datname = ${DB}`;
    if (!exists.length) await sql.unsafe(`create database ${DB}`);
  });
  await applySchema(TEST_PG_URL, { reset: true, lockTimeout: "5s" });
  return TEST_PG_URL;
}

/** Drop this process's test database (open connections are closed by force). */
export async function dropTestDb(): Promise<void> {
  if (!pgAvailable) return;
  await admin(sql => sql.unsafe(`drop database if exists ${DB} with (force)`)).catch(() => {});
}
