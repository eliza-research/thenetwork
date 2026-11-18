import { randomUUID } from "node:crypto";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { applySchema, DEV_PG_PORT } from "../../packages/observatory/db/dev-pg.ts";

/** A fresh database on the dev cluster with every migration applied, dropped when `run` ends. */
export async function withConformanceDatabase(prefix: string, run: (sql: SQL, url: string) => Promise<void>, connections = 6) {
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
    sql = new SQL({ url, max: connections });
    await run(sql, url);
  } finally {
    await sql?.close();
    if (created) await admin.unsafe(`drop database if exists ${database} with (force)`);
    await admin.close();
  }
}

/** `count` fresh databases, for a shell that takes a database-wide lock or drains every row it finds. */
export async function withConformanceDatabases(prefix: string, count: number, run: (databases: SQL[]) => Promise<void>, connections = 6, databases: SQL[] = []): Promise<void> {
  if (databases.length === count) return run(databases);
  await withConformanceDatabase(prefix, sql => withConformanceDatabases(prefix, count, run, connections, [...databases, sql]), connections);
}
