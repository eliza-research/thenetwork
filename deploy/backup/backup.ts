#!/usr/bin/env bun
// Back up the Network's Postgres to the private R2 backup bucket (docs/deploy.md section 8).
//   bun run deploy/backup/backup.ts                 # BACKUP_DATABASE_URL -> R2 (the Railway cron service)
//   bun run deploy/backup/backup.ts --out ./runs/backup --local   # a local copy only, no upload
//
// What it does:
//  1. Opens a read-only REPEATABLE READ transaction on BACKUP_DATABASE_URL and exports its snapshot.
//  2. Counts the rows of every table in that snapshot (manifest.json), then runs pg_dump --snapshot
//     on the same snapshot (db.dump, custom format), so the counts and the dump agree exactly.
//  3. Dumps the roles without passwords (roles.sql; needs a superuser, else it is skipped with a warning).
//  4. Uploads the three files to BACKUP_R2_BUCKET under <BACKUP_PREFIX>/<UTC time>/ and deletes the local copy.
//  5. Calls BACKUP_HEARTBEAT_URL (optional, https) after the upload, so a missed or failed run raises the monitor's alert.
// The dump holds member data (phone numbers, messages). The bucket must be private, its token scoped to
// it alone, and a lifecycle rule deletes objects after 35 days (docs/deploy.md 8.1). Logs never hold a URL.
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { backupBucketFromEnv, pgBin, redactUrls, rowCounts, run, type Manifest } from "./lib.ts";

/** libpq environment for a URL: the password never appears in a process list. */
export function pgEnv(url: string): Record<string, string> {
  const u = new URL(url);
  const env: Record<string, string> = {
    PGHOST: u.hostname.replace(/^\[|\]$/g, ""), PGPORT: u.port || "5432", PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGUSER: decodeURIComponent(u.username),
  };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const ssl = u.searchParams.get("sslmode");
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}

export interface BackupResult { dir: string; manifest: Manifest; bytes: number }

/** Dump one database into `outDir` (db.dump, roles.sql when allowed, manifest.json). */
export async function backup(o: { url: string; outDir: string; roles?: boolean; log?: (msg: string, f?: Record<string, unknown>) => void }): Promise<BackupResult> {
  const log = o.log ?? (() => {});
  await mkdir(o.outDir, { recursive: true, mode: 0o700 });
  const dump = join(o.outDir, "db.dump");
  const env = pgEnv(o.url);
  const sql = new SQL({ url: o.url, max: 1, connection: { application_name: "network-backup" } });
  let manifest!: Manifest;
  try {
    await sql.begin(async tx => {
      await tx`set transaction isolation level repeatable read, read only`;
      const [{ snap }] = await tx`select pg_export_snapshot() as snap` as { snap: string }[];
      const counts = await rowCounts(tx as unknown as SQL);
      const [{ server_version }] = await tx`show server_version` as { server_version: string }[];
      const version = (await run([pgBin("pg_dump"), "--version"])).trim();
      // The dump reads the exported snapshot while this transaction stays open.
      await run([pgBin("pg_dump"), "--format=custom", "--no-password", `--snapshot=${snap}`, `--file=${dump}`], { env });
      manifest = { version: 1, createdAt: new Date().toISOString(), database: env.PGDATABASE!, serverVersion: server_version, pgDump: version, rowCounts: counts, files: { dump: "db.dump" } };
    });
  } finally { await sql.close(); }
  if (o.roles !== false) {
    try {
      await run([pgBin("pg_dumpall"), "--roles-only", "--no-role-passwords", "--no-password", `--file=${join(o.outDir, "roles.sql")}`], { env });
      manifest.files.roles = "roles.sql";
    } catch (e) { log("roles not dumped (needs a superuser login); a restore on the same server does not need them", { error: redactUrls((e as Error).message) }); }
  }
  await Bun.write(join(o.outDir, "manifest.json"), JSON.stringify(manifest, null, 1));
  const bytes = (await stat(dump)).size;
  return { dir: o.outDir, manifest, bytes };
}

/** Upload a backup directory to the bucket under `prefix`. Returns the keys. */
export async function upload(dir: string, manifest: Manifest, prefix: string, env: Record<string, string | undefined> = process.env): Promise<string[]> {
  const bucket = backupBucketFromEnv(env);
  const files = ["db.dump", ...(manifest.files.roles ? ["roles.sql"] : []), "manifest.json"];
  const keys: string[] = [];
  // The manifest goes last: a prefix with a manifest is a complete backup.
  for (const f of files) {
    const key = `${prefix}/${f}`;
    await bucket.write(key, Bun.file(join(dir, f)), { type: f.endsWith(".json") ? "application/json" : "application/octet-stream" });
    keys.push(key);
  }
  return keys;
}

if (import.meta.main) {
  const { parseArgs } = await import("node:util");
  const { values: a } = parseArgs({ options: { out: { type: "string" }, local: { type: "boolean", default: false } } });
  const line = (level: string, msg: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, svc: "backup", ...f }));
  const url = process.env.BACKUP_DATABASE_URL;
  if (!url) { line("error", "BACKUP_DATABASE_URL is not set"); process.exit(1); }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dir = a.out ? join(a.out, stamp) : await mkdtemp(join(tmpdir(), "network-backup-"));
  try {
    const t0 = performance.now();
    const r = await backup({ url, outDir: dir, log: (m, f) => line("warn", m, f) });
    const rows = Object.values(r.manifest.rowCounts).reduce((s, n) => s + n, 0);
    line("info", "dump", { bytes: r.bytes, tables: Object.keys(r.manifest.rowCounts).length, rows, server: r.manifest.serverVersion, ms: Math.round(performance.now() - t0) });
    if (!a.local) {
      const prefix = `${(process.env.BACKUP_PREFIX ?? `postgres/${process.env.PLATFORM_ENV ?? "dev"}`).replace(/\/+$/, "")}/${stamp}`;
      const keys = await upload(dir, r.manifest, prefix);
      line("info", "backup uploaded", { prefix, files: keys.length });
      // A dead man's switch for the job (docs/deploy.md 8.1): called only after a complete upload. The URL is never logged.
      const hb = process.env.BACKUP_HEARTBEAT_URL?.trim();
      if (hb) {
        if (!hb.startsWith("https://")) line("warn", "BACKUP_HEARTBEAT_URL must be https: not called");
        else await fetch(hb, { signal: AbortSignal.timeout(5_000) }).then(r => line(r.ok ? "info" : "warn", "heartbeat", { status: r.status }), e => line("warn", "heartbeat failed", { error: (e as Error).name }));
      }
    } else line("info", "backup kept locally", { dir });
  } catch (e) {
    line("error", "backup failed", { error: redactUrls((e as Error).message) });
    process.exitCode = 1;
  } finally {
    if (!a.out) await rm(dir, { recursive: true, force: true });
  }
}
