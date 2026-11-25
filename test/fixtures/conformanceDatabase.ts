import { randomUUID } from "node:crypto";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { applySchema, DEV_PG_URL } from "../../packages/db/dev-pg.ts";
import { deferred } from "./deferred.ts";

function databaseUrl(database: string): string {
  const url = new URL(DEV_PG_URL);
  url.pathname = `/${database}`;
  return url.href;
}

export async function withConformanceDatabaseUrl(prefix: string, run: (url: string) => Promise<void>) {
  const database = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const url = databaseUrl(database);
  const admin = new SQL({ url: databaseUrl("postgres"), max: 1 });
  let created = false;
  try {
    await admin.unsafe(`create database ${database}`);
    created = true;
    await applySchema(url, { lockTimeout: "5s" });
    await run(url);
  } finally {
    if (created) await admin.unsafe(`drop database if exists ${database} with (force)`);
    await admin.close();
  }
}

export async function withConformanceDatabase(prefix: string, run: (sql: SQL, url: string) => Promise<void>, connections = 6) {
  await withConformanceDatabaseUrl(prefix, async url => {
    const sql = new SQL({ url, max: connections });
    try {
      await run(sql, url);
    } finally {
      await sql.close();
    }
  });
}

export async function withConformanceDatabases(prefix: string, count: number, run: (databases: SQL[]) => Promise<void>, connections = 6, databases: SQL[] = []): Promise<void> {
  if (databases.length === count) return run(databases);
  await withConformanceDatabase(prefix, sql => withConformanceDatabases(prefix, count, run, connections, [...databases, sql]), connections);
}

export type InboundRowHold = { waiter: number; release(): Promise<void> };

export async function holdInboundRowUntilWaited(sql: SQL, id: string, start: () => void, beforeRelease: (tx: SQL) => Promise<unknown> = async () => undefined): Promise<InboundRowHold> {
  const released = deferred<void>();
  const locked = deferred<number>();
  const done = sql.begin(async tx => {
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid from platform.inbound where id = ${id} for update`;
    if (!row) throw new Error(`The inbound row ${id} is missing`);
    locked.resolve(row.pid);
    await released.promise;
    await beforeRelease(tx);
  });
  const holder = await Promise.race([locked.promise, done.then(() => { throw new Error(`The lock on ${id} ended before it was held`); })]);
  const release = async () => { released.resolve(); await done; };
  start();
  for (let tries = 0; tries < 1000; tries++) {
    const [waiting] = await sql<{ pid: number }[]>`select pid from pg_stat_activity where ${holder}::int = any(pg_blocking_pids(pid)) limit 1`;
    if (waiting) return { waiter: waiting.pid, release };
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await release();
  throw new Error(`Nothing waited on the inbound row ${id}`);
}
