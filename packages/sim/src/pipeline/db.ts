// The pipeline world's own database on the local dev cluster (:54339): network_test_e2e by default,
// dropped and created fresh, then every migration (bun run db:migrate's runner). Never the dev
// `network` database. It does not start a cluster: without one reachable, pgReachable() is false and
// the caller skips.
import { SQL } from "bun";
import { DEV_PG_PORT } from "../../../observatory/db/dev-pg.ts";
import { migrate } from "../../../observatory/db/migrate.ts";

const USER = process.env.USER ?? "postgres";
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;

async function admin(q: string) {
  const sql = new SQL({ url: ADMIN_URL, max: 1, connectionTimeout: 3 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
}

/** True when the dev cluster answers. */
export async function pgReachable(): Promise<boolean> {
  try { await admin("select 1"); return true; } catch { return false; }
}

/** A fresh, migrated database. Returns its URL. */
export async function pipelineDb(name = "network_test_e2e"): Promise<string> {
  if (!/^network_test_[a-z0-9_]+$/.test(name)) throw new Error(`refusing database name ${name}: test databases are network_test_*`);
  await admin(`drop database if exists ${name} with (force)`);
  await admin(`create database ${name}`);
  const url = `postgres://${USER}@localhost:${DEV_PG_PORT}/${name}`;
  await migrate(url, { lockTimeout: "5s", log: () => {} });
  return url;
}

export async function dropPipelineDb(url: string) {
  await admin(`drop database if exists ${new URL(url).pathname.slice(1)} with (force)`).catch(() => {});
}
