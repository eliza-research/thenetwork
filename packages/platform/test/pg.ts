// A database of its own per test process (platform_test_<pid>) on the local dev cluster (:54339),
// as packages/observatory/test/pg.ts does. Never the dev `network` database. Skipped without Postgres.
import { SQL } from "bun";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { migrate } from "../../observatory/db/migrate.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";

export { pgAvailable };
const USER = process.env.USER ?? "postgres";
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;

async function admin(q: string) {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
}

/** A fresh empty database `platform_test_<pid>_<name>`. Returns its URL. */
export async function emptyDb(name: string): Promise<string> {
  await devPgUp();
  const db = `platform_test_${process.pid}_${name}`;
  await admin(`drop database if exists ${db} with (force)`);
  await admin(`create database ${db}`);
  return `postgres://${USER}@localhost:${DEV_PG_PORT}/${db}`;
}

/** A fresh database with every migration applied. */
export async function migratedDb(name: string): Promise<string> {
  const url = await emptyDb(name);
  await migrate(url, { lockTimeout: "5s" });
  return url;
}

export async function dropDb(url: string) {
  if (!pgAvailable) return;
  await admin(`drop database if exists ${new URL(url).pathname.slice(1)} with (force)`).catch(() => {});
}
