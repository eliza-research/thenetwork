import { randomUUID } from "node:crypto";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { applySchema, DEV_PG_PORT } from "../../packages/observatory/db/dev-pg.ts";

/** A fresh database on the dev cluster with every migration applied, dropped when `run` ends. */
export async function withConformanceDatabase(prefix: string, run: (sql: SQL, url: string) => Promise<void>) {
  const database = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const address = `postgres://${encodeURIComponent(process.env.USER || "postgres")}@127.0.0.1:${DEV_PG_PORT}`;
  const url = `${address}/${database}`;
  const admin = new SQL({ url: `${address}/postgres`, max: 1 });
  let created = false;
  let sql: SQL | undefined;
  try {
    await admin.unsafe(`create database ${database}`);
    created = true;
    await applySchema(url, { lockTimeout: "5s" });
    sql = new SQL({ url, max: 6 });
    await run(sql, url);
  } finally {
    await sql?.close();
    if (created) await admin.unsafe(`drop database if exists ${database} with (force)`);
    await admin.close();
  }
}
