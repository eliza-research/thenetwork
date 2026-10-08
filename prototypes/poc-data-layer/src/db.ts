// One tiny interface over Postgres (Bun.SQL, one connection per Db) and PGlite.
import { SQL } from "bun";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Db {
  kind: "pg" | "pglite";
  /** True inside db.tx(): SET LOCAL / set_config(..., true) only last until the end of a transaction. */
  inTx: boolean;
  q<T = any>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  tx<T>(fn: (d: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** SQLSTATE of a driver error (Bun puts it on errno, PGlite on code). */
export const sqlstate = (e: any): string | undefined => (typeof e?.errno === "string" ? e.errno : e?.code);

function wrapBun(sql: any, root?: SQL): Db {
  return {
    kind: "pg",
    inTx: !root,
    q: (text, params) => sql.unsafe(text, params ?? []).then((r: any) => [...r]),
    exec: (text) => sql.unsafe(text).then(() => undefined),
    tx: (fn) => (root ?? sql).begin((t: any) => fn(wrapBun(t))),
    close: () => (root ?? sql).close(),
  };
}

/** A dedicated Postgres connection (max: 1) so each worker really is a separate backend. */
export function pgConnect(url: string): Db {
  const sql = new SQL({ url, max: 1, idleTimeout: 0 });
  return wrapBun(sql, sql);
}

function wrapLite(db: any, isTx = false): Db {
  return {
    kind: "pglite",
    inTx: isTx,
    q: (text, params) => db.query(text, params ?? []).then((r: any) => r.rows),
    exec: (text) => db.exec(text).then(() => undefined),
    tx: (fn) => (isTx ? fn(wrapLite(db, true)) : db.transaction((t: any) => fn(wrapLite(t, true)))),
    close: () => (isTx ? Promise.resolve() : db.close()),
  };
}

export async function pgliteOpen(): Promise<Db> {
  return wrapLite(await PGlite.create({ extensions: { vector } }));
}

export interface Backend { name: string; concurrent: boolean; connect(): Promise<Db> }
export const pgBackend = (url: string, name = "postgres"): Backend => ({ name, concurrent: true, connect: async () => pgConnect(url) });
/** PGlite is one in-process session: every "connection" is the same backend. */
export async function pgliteBackend(): Promise<Backend & { db: Db }> {
  const db = await pgliteOpen();
  const shared: Db = { ...db, close: async () => {} };
  return { name: "pglite", concurrent: false, connect: async () => shared, db };
}

const MIGRATIONS = join(import.meta.dir, "..", "migrations");

/** Apply every migrations/*.sql in order; returns a checksum of the applied text. */
export async function migrate(db: Db): Promise<string> {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const text = files.map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");
  await db.exec(text);
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);
}

/** Catalog fingerprint of the network schema (tables, columns, types, indexes, constraints, triggers). */
export async function schemaFingerprint(db: Db): Promise<string[]> {
  const rows = await db.q<{ s: string }>(`
    SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || coalesce(udt_name,'') || ' null=' || is_nullable AS s
      FROM information_schema.columns WHERE table_schema = 'network'
    UNION ALL SELECT 'idx ' || indexname || ' ' || regexp_replace(indexdef, '\\s+', ' ', 'g') FROM pg_indexes WHERE schemaname = 'network'
    UNION ALL SELECT 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace = 'network'::regnamespace AND contype <> 'n' -- PG18 catalogs NOT NULLs here; PG16 does not
    UNION ALL SELECT 'trg ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE 'network.%'
    UNION ALL SELECT 'fn ' || proname FROM pg_proc WHERE pronamespace = 'network'::regnamespace
    ORDER BY 1`);
  return rows.map((r) => r.s);
}
