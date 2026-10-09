#!/usr/bin/env bun
// The SQL migration runner (runbook-real 1.2; platform plan 2.7). One ledger table
// (public.__migrations), one transaction, one advisory lock, so two processes never apply the same
// migration twice.
//   bun run db:migrate                  # the local dev database (starts the dev cluster)
//   bun run db:migrate -- --url <url>   # another database (local hosts only, as seed.ts)
//   bun run db:migrate -- --plan        # list what would run (pending, changed baselines, edited migrations); applies nothing
//
// Order:
//   0001 packages/observatory/db/schema.sql       (baseline, repeatable)
//   0002 packages/network/db/network-state.sql    (baseline, repeatable; PgStore.migrate() also runs it)
//   0003+ packages/observatory/db/migrations/NNNN_name.sql (each runs once)
//   9001 packages/mcp/db/oauth.sql                 (the MCP OAuth schema; repeatable, last)
// A repeatable baseline runs again when its text changes: both files only create what is missing,
// so they keep working for the code and tests that apply them directly. New changes go in a new
// numbered file in migrations/, never in a baseline.
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SQL } from "bun";

const REPO = resolve(import.meta.dir, "../../..");
export const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

export interface Migration { id: string; file: string; repeatable: boolean }

export function migrations(): Migration[] {
  const numbered = readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map(f => ({ id: f.replace(/\.sql$/, ""), file: join(MIGRATIONS_DIR, f), repeatable: false }));
  return [
    { id: "0001_network_schema", file: join(import.meta.dir, "schema.sql"), repeatable: true },
    { id: "0002_network_state", file: join(REPO, "packages", "network", "db", "network-state.sql"), repeatable: true },
    ...numbered,
    // The MCP server's OAuth schema (packages/mcp/db/oauth.sql): repeatable, after the roles exist, so a
    // deployed service login never needs CREATE rights (the service no longer creates it at boot there).
    { id: "9001_oauth_schema", file: join(REPO, "packages", "mcp", "db", "oauth.sql"), repeatable: true },
    // The single inbox (packages/notify/db/schema.sql): repeatable and idempotent, grants to network_service.
    { id: "9002_notify_schema", file: join(REPO, "packages", "notify", "db", "schema.sql"), repeatable: true },
  ];
}

const checksum = (text: string) => createHash("sha256").update(text).digest("hex");

export interface MigratePlan {
  /** Never applied: they run next, in this order. */
  pending: string[];
  /** Repeatable baselines whose text changed since they ran: they run again. */
  changedBaselines: string[];
  /** Numbered migrations edited after they ran: never run again (add a new migration instead). */
  edited: string[];
  /** Applied and unchanged. */
  upToDate: string[];
}

/** What migrate() would do on this database, without applying anything (read-only; no lock). */
export async function plan(url: string): Promise<MigratePlan> {
  const list = migrations();
  const texts = await Promise.all(list.map(m => Bun.file(m.file).text()));
  const sql = new SQL({ url, max: 1 });
  try {
    const [t] = await sql`select to_regclass('public.__migrations') as t`;
    const done = new Map<string, string>();
    if (t?.t) for (const r of await sql`select id, checksum from public.__migrations`) done.set(r.id, r.checksum);
    const out: MigratePlan = { pending: [], changedBaselines: [], edited: [], upToDate: [] };
    list.forEach((m, i) => {
      const prev = done.get(m.id), sum = checksum(texts[i]!);
      if (prev === undefined) out.pending.push(m.id);
      else if (prev === sum) out.upToDate.push(m.id);
      else (m.repeatable ? out.changedBaselines : out.edited).push(m.id);
    });
    return out;
  } finally {
    await sql.close();
  }
}

export interface MigrateResult { applied: string[]; skipped: string[] }

/** Apply every pending migration in order, in one transaction under an advisory lock. */
export async function migrate(url: string, opts: { reset?: boolean; lockTimeout?: string; log?: (s: string) => void } = {}): Promise<MigrateResult> {
  const list = migrations();
  const texts = await Promise.all(list.map(m => Bun.file(m.file).text()));
  const sql = new SQL({ url, max: 1 });
  const out: MigrateResult = { applied: [], skipped: [] };
  try {
    await sql.begin(async tx => {
      // Fail fast instead of waiting forever when another process holds a lock on the schema.
      if (opts.lockTimeout) await tx.unsafe(`set local lock_timeout = '${opts.lockTimeout.replace(/[^0-9a-z]/gi, "")}'`);
      await tx`select pg_advisory_xact_lock(hashtext('thenetwork-migrate'))`;
      if (opts.reset) await tx.unsafe("drop schema if exists network cascade; drop schema if exists platform cascade; drop schema if exists notify cascade; drop table if exists public.__migrations");
      await tx.unsafe(`create table if not exists public.__migrations (
        id text primary key, checksum text not null, repeatable boolean not null default false, applied_at timestamptz not null default now())`);
      const done = new Map<string, string>();
      for (const r of await tx`select id, checksum from public.__migrations`) done.set(r.id, r.checksum);
      for (let i = 0; i < list.length; i++) {
        const m = list[i], sum = checksum(texts[i]);
        const prev = done.get(m.id);
        if (prev === sum || (prev !== undefined && !m.repeatable)) {
          if (prev !== sum) opts.log?.(`warning: ${m.id} changed after it ran; add a new migration instead`);
          out.skipped.push(m.id);
          continue;
        }
        // A baseline edited in place runs again (it only creates what is missing); say so in the log.
        if (prev !== undefined) opts.log?.(`re-running ${m.id}: its text changed since it ran`);
        await tx.unsafe(texts[i]);
        await tx`insert into public.__migrations (id, checksum, repeatable) values (${m.id}, ${sum}, ${m.repeatable})
          on conflict (id) do update set checksum = excluded.checksum, applied_at = now()`;
        out.applied.push(m.id);
        opts.log?.(`applied ${m.id}`);
      }
    });
  } finally {
    await sql.close();
  }
  return out;
}

if (import.meta.main) {
  const { parseArgs } = await import("node:util");
  const { values: a } = parseArgs({ options: { url: { type: "string" }, reset: { type: "boolean", default: false }, plan: { type: "boolean", default: false } } });
  const { DEV_PG_URL, devPgUp } = await import("./dev-pg.ts");
  const isLocalUrl = (u: string) => { try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };
  let url = a.url ?? process.env.NETWORK_DATABASE_URL;
  if (!url) { await devPgUp(); url = DEV_PG_URL; }
  if (!isLocalUrl(url)) { console.error(`refusing to migrate non-local database ${new URL(url).hostname}`); process.exit(1); }
  if (a.plan) {
    const p = await plan(url);
    for (const id of p.pending) console.log(`pending   ${id}`);
    for (const id of p.changedBaselines) console.log(`changed   ${id} (baseline: runs again)`);
    for (const id of p.edited) console.log(`edited    ${id} (already ran: will NOT run again; add a new migration)`);
    console.log(JSON.stringify({ pending: p.pending.length, changedBaselines: p.changedBaselines.length, edited: p.edited.length, upToDate: p.upToDate.length }));
    process.exit(0);
  }
  const r = await migrate(url, { reset: a.reset, log: s => console.log(s) });
  console.log(JSON.stringify(r));
  process.exit(0);
}
