#!/usr/bin/env bun
// Restore a backup into a NEW scratch database and check it against the backup's manifest (docs/deploy.md
// section 8; the restore drill is runbook-real.md section 8). It never writes into an existing database.
//   bun run deploy/backup/restore.ts --from ./runs/backup/<stamp> --db restore_drill_20261008
//   bun run deploy/backup/restore.ts --r2 postgres/production/<stamp> --db restore_drill_20261008
//   bun run deploy/backup/restore.ts --r2 latest --db restore_drill_20261008     # the newest complete backup under BACKUP_PREFIX
// The target server is RESTORE_DATABASE_URL (a login that may create databases; any database on that
// server, usually the maintenance one). Exit 0: every table has the row count of the manifest.
// Keep the scratch database only as long as the drill or the comparison needs it, then drop it.
//
// Safety (docs/deploy.md 8.2): a restore never changes a role or a privilege of the source server.
//  - The drill (default) restores with --no-owner --no-privileges: no ALTER OWNER, GRANT or REVOKE at all.
//  - --keep-privileges (a real recovery, runbook-real.md 8.3) keeps owners and grants, which apply to the
//    objects of the new database only.
//  - roles.sql (CREATE/ALTER ROLE for the whole server) runs only with --roles, and only on a server
//    that is not the source (an empty replacement cluster). On the source server it is refused.
//  - The source's own database on the source server is refused, as are the live names and any database that exists.
//  - An encrypted backup (manifest.encryption) needs BACKUP_ENCRYPTION_KEY to decrypt after download.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { pgEnv } from "./backup.ts";
import { backupBucketFromEnv, backupKey, compareCounts, decryptFile, pgBin, redactUrls, rowCounts, run, safeDbName, sameServer, withDatabase, type BackupKey, type Manifest } from "./lib.ts";

/** Database names a restore never creates: the live ones. */
const LIVE_NAMES = new Set(["railway", "network", "postgres", "template0", "template1"]);

export interface RestoreResult { db: string; url: string; manifest: Manifest; mismatches: ReturnType<typeof compareCounts>; ms: number }

/**
 * Restore the backup in `dir` into the new database `db` on the server of `serverUrl`, then compare row
 * counts. `keepPrivileges`: keep owners and grants (inside the new database only). `roles`: also run
 * roles.sql, refused unless the target server is not the source server.
 */
export async function restore(o: { serverUrl: string; db: string; dir: string; keepPrivileges?: boolean; roles?: boolean; log?: (msg: string, f?: Record<string, unknown>) => void }): Promise<RestoreResult> {
  const t0 = performance.now();
  if (!safeDbName(o.db) || LIVE_NAMES.has(o.db)) throw new Error(`refusing to restore into "${o.db}": use a new scratch name such as restore_drill_<date>`);
  const manifest = JSON.parse(await Bun.file(join(o.dir, "manifest.json")).text()) as Manifest;
  if (manifest.version !== 1) throw new Error(`unknown manifest version ${manifest.version}`);
  const target = pgEnv(withDatabase(o.serverUrl, o.db));
  // A backup without a recorded source (older than the field) counts as taken on this server.
  const onSource = !manifest.source || sameServer(manifest.source, { host: target.PGHOST!, port: target.PGPORT! });
  if (o.db === manifest.database && onSource) throw new Error(`refusing to restore into the backup's own database "${o.db}" on its own server`);
  if (o.roles && onSource) throw new Error("refusing --roles: roles.sql changes roles for the whole server, and this is the source server (or the backup does not name its source)");
  if (manifest.encryption && !existsSync(join(o.dir, manifest.files.dump))) throw new Error("the backup is encrypted: download it with restore.ts --r2 (BACKUP_ENCRYPTION_KEY), which decrypts it");
  const admin = new SQL({ url: o.serverUrl, max: 1 });
  try {
    const [exists] = await admin`select 1 as x from pg_database where datname = ${o.db}`;
    if (exists) throw new Error(`database ${o.db} already exists: a restore only creates a new one`);
    await admin.unsafe(`create database "${o.db}"`);
  } finally { await admin.close(); }
  const url = withDatabase(o.serverUrl, o.db);
  const env = pgEnv(url);
  // Roles (without passwords) only on another server, and only when asked: errors for roles that already exist are expected and ignored.
  if (o.roles && manifest.files.roles && existsSync(join(o.dir, manifest.files.roles))) {
    await run([pgBin("psql"), "--no-password", "--quiet", "-v", "ON_ERROR_STOP=0", "-f", join(o.dir, manifest.files.roles)], { env: { ...env, PGOPTIONS: "-c client_min_messages=error" } }).catch(e => o.log?.("roles: some statements failed", { error: redactUrls((e as Error).message) }));
  }
  const privileges = o.keepPrivileges ? [] : ["--no-owner", "--no-privileges"];
  await run([pgBin("pg_restore"), "--no-password", "--exit-on-error", ...privileges, `--dbname=${env.PGDATABASE}`, join(o.dir, manifest.files.dump)], { env });
  const sql = new SQL({ url, max: 1 });
  let got: Record<string, number>;
  try { got = await rowCounts(sql); } finally { await sql.close(); }
  return { db: o.db, url, manifest, mismatches: compareCounts(manifest.rowCounts, got), ms: Math.round(performance.now() - t0) };
}

/**
 * Download a backup prefix from the bucket into `dir`. "latest": the newest prefix under BACKUP_PREFIX that
 * has a manifest. An encrypted backup is decrypted with `key` (default BACKUP_ENCRYPTION_KEY); the
 * encrypted copies are removed, and the manifest written to `dir` describes the plain files.
 */
export async function download(prefix: string, dir: string, env: Record<string, string | undefined> = process.env, key?: BackupKey): Promise<string> {
  const bucket = backupBucketFromEnv(env);
  if (prefix === "latest") {
    const root = `${(env.BACKUP_PREFIX ?? `postgres/${env.PLATFORM_ENV ?? "dev"}`).replace(/\/+$/, "")}/`;
    const manifests: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const r = await bucket.list({ prefix: root, ...(after ? { startAfter: after } : {}) });
      for (const c of r.contents ?? []) if (c.key.endsWith("/manifest.json")) manifests.push(c.key);
      if (!r.isTruncated || !r.contents?.length) break;
      after = r.contents.at(-1)!.key;
    }
    const newest = manifests.sort().at(-1);
    if (!newest) throw new Error(`no complete backup under ${root}`);
    prefix = newest.slice(0, -"/manifest.json".length);
  }
  const manifest = JSON.parse(await bucket.file(`${prefix}/manifest.json`).text()) as Manifest;
  let k: BackupKey | undefined;
  if (manifest.encryption) {
    if (!key && !env.BACKUP_ENCRYPTION_KEY) throw new Error("the backup is encrypted: set BACKUP_ENCRYPTION_KEY");
    k = key ?? backupKey(env.BACKUP_ENCRYPTION_KEY!);
    if (k.id !== manifest.encryption.keyId) throw new Error(`BACKUP_ENCRYPTION_KEY is not the key this backup was made with (key id ${manifest.encryption.keyId})`);
  }
  for (const f of [manifest.files.dump, ...(manifest.files.roles ? [manifest.files.roles] : [])]) {
    if (!k) { await Bun.write(join(dir, f), bucket.file(`${prefix}/${f}`)); continue; }
    const enc = join(dir, `${f}.enc`);
    await Bun.write(enc, bucket.file(`${prefix}/${f}.enc`));
    try { await decryptFile(enc, join(dir, f), k); } finally { await rm(enc, { force: true }); }
  }
  const { encryption: _e, ...plain } = manifest;
  await Bun.write(join(dir, "manifest.json"), JSON.stringify(plain));
  return prefix;
}

if (import.meta.main) {
  const { parseArgs } = await import("node:util");
  const { values: a } = parseArgs({ options: { from: { type: "string" }, r2: { type: "string" }, db: { type: "string" }, "keep-privileges": { type: "boolean", default: false }, roles: { type: "boolean", default: false } } });
  const line = (level: string, msg: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, svc: "restore", ...f }));
  const serverUrl = process.env.RESTORE_DATABASE_URL;
  if (!serverUrl || !a.db || (!a.from && !a.r2)) { line("error", "usage: RESTORE_DATABASE_URL=... restore.ts (--from <dir> | --r2 <prefix>|latest) --db <new scratch database> [--keep-privileges] [--roles (another server only)]"); process.exit(2); }
  const tmp = a.from ? undefined : await mkdtemp(join(tmpdir(), "network-restore-"));
  try {
    let dir = a.from!;
    if (tmp) { const p = await download(a.r2!, tmp); dir = tmp; line("info", "downloaded", { prefix: p }); }
    const r = await restore({ serverUrl, db: a.db, dir, keepPrivileges: a["keep-privileges"], roles: a.roles, log: (m, f) => line("warn", m, f) });
    const rows = Object.values(r.manifest.rowCounts).reduce((s, n) => s + n, 0);
    line(r.mismatches.length ? "error" : "info", "restore checked", {
      db: r.db, backupAt: r.manifest.createdAt, tables: Object.keys(r.manifest.rowCounts).length, rows, mismatches: r.mismatches.length, ms: r.ms,
      ...(r.mismatches.length ? { first: r.mismatches.slice(0, 10) } : {}),
    });
    process.exitCode = r.mismatches.length ? 1 : 0;
  } catch (e) {
    line("error", "restore failed", { error: redactUrls((e as Error).message) });
    process.exitCode = 1;
  } finally { if (tmp) await rm(tmp, { recursive: true, force: true }); }
}
