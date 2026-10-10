#!/usr/bin/env bun
// The SQL migration runner (runbook-real 1.2; platform plan 2.7). One ledger table
// (public.__migrations), one transaction, one advisory lock, so two processes never apply the same
// migration twice.
//   bun run db:migrate                  # the local dev database (starts the dev cluster)
//   bun run db:migrate -- --url <url>   # another database (local hosts only, as seed.ts)
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
  checkNumbers(numbered.map(m => m.id));
  return [
    { id: "0001_network_schema", file: join(import.meta.dir, "schema.sql"), repeatable: true },
    { id: "0002_network_state", file: join(REPO, "packages", "network", "db", "network-state.sql"), repeatable: true },
    ...numbered,
    // The MCP server's OAuth schema (packages/mcp/db/oauth.sql): repeatable, after the roles exist, so a
    // deployed service login never needs CREATE rights (the service no longer creates it at boot there).
    { id: "9001_oauth_schema", file: join(REPO, "packages", "mcp", "db", "oauth.sql"), repeatable: true },
    // The single inbox (packages/notify/db/schema.sql): repeatable and idempotent, grants to network_service.
    { id: "9002_notify_schema", file: join(REPO, "packages", "notify", "db", "schema.sql"), repeatable: true },
    { id: "9003_notify_retention", file: join(REPO, "packages", "notify", "db", "retention.sql"), repeatable: false },
  ];
}

/** Reserved numbers: the baselines and the repeatable schemas outside migrations/. */
const RESERVED = new Set(["0001", "0002", "9001", "9002", "9003"]);

/**
 * Refuse two numbered migrations with the same NNNN prefix (two branches that each took the next
 * number), and a numbered file that takes a reserved number. The ledger keys on the full id, so the
 * runner would apply both, but their order would depend only on the name after the prefix. Fix it by
 * giving the later file the next free number. A database that already applied the file under its old
 * id runs it again under the new id, so a renumbered migration must be idempotent (create ... if not
 * exists, on conflict do nothing), or the old ledger row must be renamed in the same change.
 */
export function checkNumbers(ids: string[]): void {
  const seen = new Map<string, string>();
  const bad: string[] = [];
  for (const id of ids) {
    const n = id.slice(0, 4);
    if (RESERVED.has(n)) bad.push(`${id} uses the reserved number ${n}`);
    const prev = seen.get(n);
    if (prev) bad.push(`${prev} and ${id} share the number ${n}`);
    else seen.set(n, id);
  }
  if (bad.length) throw new Error(`migrations: duplicate or reserved numbers in ${MIGRATIONS_DIR}: ${bad.join("; ")}. Give the later file the next free number.`);
}

const checksum = (text: string) => createHash("sha256").update(text).digest("hex");

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
  const { values: a } = parseArgs({ options: { url: { type: "string" }, reset: { type: "boolean", default: false } } });
  const { DEV_PG_URL, devPgUp } = await import("./dev-pg.ts");
  const isLocalUrl = (u: string) => { try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };
  let url = a.url ?? process.env.NETWORK_DATABASE_URL;
  if (!url) { await devPgUp(); url = DEV_PG_URL; }
  if (!isLocalUrl(url)) { console.error(`refusing to migrate non-local database ${new URL(url).hostname}`); process.exit(1); }
  const r = await migrate(url, { reset: a.reset, log: s => console.log(s) });
  console.log(JSON.stringify(r));
  process.exit(0);
}
