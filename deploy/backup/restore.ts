#!/usr/bin/env -S node --import=tsx
import { fileAt, writePath } from "../../packages/core/src/runtime/files.ts";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { initial, shouldApplyRoles, step } from "../../packages/core/src/generated/databaseRestore.ts";
import { pgEnv } from "./backup.ts";
import { endRestoredTexts, replayPrivacy, type PrivacyReplayResult, type RestoredTextsResult } from "./privacy-replay.ts";
import { backupBucketFromEnv, backupKey, compareCounts, decryptFile, pgBin, redactUrls, rowCounts, run, safeDbName, sameServer, withDatabase, type BackupKey, type Manifest } from "./lib.ts";

interface RestoreResult { db: string; url: string; manifest: Manifest; mismatches: ReturnType<typeof compareCounts>; privacy?: PrivacyReplayResult; texts?: RestoredTextsResult; ms: number }

export async function restore(o: { serverUrl: string; db: string; dir: string; keepPrivileges?: boolean; roles?: boolean; replayFrom?: string; sourceLost?: boolean; log?: (msg: string, f?: Record<string, unknown>) => void }): Promise<RestoreResult> {
  const t0 = performance.now();
  // spec/databaseRestore.md, "The target must be a valid scratch database name"
  let state = step(initial, { type: "checkName", name: o.db, validName: safeDbName(o.db) });
  if (state.phase !== "ReadingManifest") throw new Error(`refusing to restore into "${o.db}": use a new scratch name such as restore_drill_<date>`);
  const manifest = JSON.parse(await fileAt(join(o.dir, "manifest.json")).text()) as Manifest;
  state = step(state, { type: "checkVersion", versionOne: manifest.version === 1 });
  if (state.phase !== "CheckingSource") throw new Error(`unknown manifest version ${manifest.version}`);
  const target = pgEnv(withDatabase(o.serverUrl, o.db));
  const admin = new SQL({ url: o.serverUrl, max: 1 });
  try {
    const [{ id }] = await admin`select system_identifier::text as id from pg_control_system()` as { id: string }[];
    // spec/databaseRestore.md, "Manifest admission refuses source writes and unavailable dump files"
    state = step(state, { type: "checkManifest", manifest: {
      sourceKnown: Boolean(manifest.source),
      sameServer: Boolean(manifest.source && (sameServer(manifest.source, { host: target.PGHOST!, port: target.PGPORT! }) || manifest.source.systemId === id)),
      ownDatabase: o.db === manifest.database, rolesRequested: Boolean(o.roles), keepPrivileges: Boolean(o.keepPrivileges),
      encrypted: Boolean(manifest.encryption), dumpPresent: Boolean(manifest.encryption && manifest.files?.dump && existsSync(join(o.dir, manifest.files.dump))),
      replaySource: Boolean(o.replayFrom), sourceLost: Boolean(o.sourceLost),
    } });
    switch (state.reason) {
      case "OwnDatabase": throw new Error(`refusing to restore into the backup's own database "${o.db}" on its own server`);
      case "RolesOnSource": throw new Error("refusing --roles: roles.sql changes roles for the whole server, and this is the source server (or the backup does not name its source)");
      case "NeedsDecryption": throw new Error("the backup is encrypted: download it with restore.ts --r2 (BACKUP_ENCRYPTION_KEY), which decrypts it");
      case "NeedsReplaySource": throw new Error("a recovery needs --replay (RESTORE_SOURCE_DATABASE_URL) or --source-lost: erasures, STOPs, leaves and bans after the backup must not be lost silently");
    }
    const [exists] = await admin`select 1 as x from pg_database where datname = ${o.db}`;
    state = step(state, { type: "checkTarget", targetExists: Boolean(exists) });
    if (state.phase !== "CreatingTarget") throw new Error(`database ${o.db} already exists: a restore only creates a new one`);
    await admin.unsafe(`create database "${o.db}"`);
    state = step(state, { type: "recordCreation" });
  } finally { await admin.close(); }
  const url = withDatabase(o.serverUrl, o.db);
  const env = pgEnv(url);
  try {
    const rolesFile = manifest.files.roles && join(o.dir, manifest.files.roles);
    if (rolesFile && shouldApplyRoles(state, existsSync(rolesFile))) {
      await run([pgBin("psql"), "--no-password", "--quiet", "-v", "ON_ERROR_STOP=0", "-f", rolesFile], { env: { ...env, PGOPTIONS: "-c client_min_messages=error" } }).catch(e => o.log?.("roles: some statements failed", { error: redactUrls((e as Error).message) }));
    }
    const privileges = state.keepPrivileges ? [] : ["--no-owner", "--no-privileges"];
    await run([pgBin("pg_restore"), "--no-password", "--exit-on-error", ...privileges, `--dbname=${env.PGDATABASE}`, join(o.dir, manifest.files.dump)], { env });
    state = step(state, { type: "recordDump" });
    const sql = new SQL({ url, max: 1 });
    let got: Record<string, number>;
    try { got = await rowCounts(sql); } finally { await sql.close(); }
    const mismatches = compareCounts(manifest.rowCounts, got);
    state = step(state, { type: "recordCounts", countsAgree: mismatches.length === 0 });
    let privacy: PrivacyReplayResult | undefined;
    if (state.phase === "ReplayingPrivacy") {
      privacy = await replayPrivacy({ sourceUrl: o.replayFrom!, targetUrl: url, queuedAt: new Date() });
      state = step(state, { type: "recordPrivacyReplay" });
    }
    if (state.phase !== "Finished") throw new Error("restore did not complete the row-count check and the privacy replay");
    const texts = o.sourceLost && !state.replayPrivacy ? await endRestoredTexts({ targetUrl: url, at: new Date() }) : undefined;
    return { db: o.db, url, manifest, mismatches, ...(privacy ? { privacy } : {}), ...(texts ? { texts } : {}), ms: Math.round(performance.now() - t0) };
  } catch (e) {
    // A failed restore drops the scratch database it made: it can hold part of the member data (SD-363).
    const drop = new SQL({ url: o.serverUrl, max: 1 });
    try { await drop.unsafe(`drop database if exists "${o.db}" with (force)`); }
    catch (d) { o.log?.(`the scratch database ${o.db} was not dropped: drop it by hand`, { error: redactUrls((d as Error).message) }); }
    finally { await drop.close(); }
    throw e;
  }
}

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
    if (!k) { await writePath(join(dir, f), await bucket.stream(`${prefix}/${f}`)); continue; }
    const enc = join(dir, `${f}.enc`);
    await writePath(enc, await bucket.stream(`${prefix}/${f}.enc`));
    try { await decryptFile(enc, join(dir, f), k); } finally { await rm(enc, { force: true }); }
  }
  const { encryption: _e, ...plain } = manifest;
  await writePath(join(dir, "manifest.json"), JSON.stringify(plain));
  return prefix;
}

if (import.meta.main) {
  const { parseArgs } = await import("node:util");
  const { values: a } = parseArgs({ options: { from: { type: "string" }, r2: { type: "string" }, db: { type: "string" }, "keep-privileges": { type: "boolean", default: false }, roles: { type: "boolean", default: false }, replay: { type: "boolean", default: false }, "source-lost": { type: "boolean", default: false } } });
  const line = (level: string, msg: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, svc: "restore", ...f }));
  const serverUrl = process.env.RESTORE_DATABASE_URL;
  const replayFrom = a.replay ? process.env.RESTORE_SOURCE_DATABASE_URL : undefined;
  if (!serverUrl || !a.db || (!a.from && !a.r2) || (a.replay && !replayFrom)) { line("error", "usage: RESTORE_DATABASE_URL=... [RESTORE_SOURCE_DATABASE_URL=...] restore.ts (--from <dir> | --r2 <prefix>|latest) --db <new scratch database> [--keep-privileges (--replay | --source-lost)] [--roles (another server only)]"); process.exit(2); }
  const tmp = a.from ? undefined : await mkdtemp(join(tmpdir(), "network-restore-"));
  try {
    let dir = a.from!;
    if (tmp) { const p = await download(a.r2!, tmp); dir = tmp; line("info", "downloaded", { prefix: p }); }
    const r = await restore({ serverUrl, db: a.db, dir, keepPrivileges: a["keep-privileges"], roles: a.roles, replayFrom, sourceLost: a["source-lost"], log: (m, f) => line("warn", m, f) });
    if (a["source-lost"]) line("warn", "source database stated lost: privacy changes after the backup were not replayed; record the lost window (docs/runbook-privacy.md section 3)", { backupAt: r.manifest.createdAt });
    const rows = Object.values(r.manifest.rowCounts).reduce((s, n) => s + n, 0);
    line(r.mismatches.length ? "error" : "info", "restore checked", {
      db: r.db, backupAt: r.manifest.createdAt, tables: Object.keys(r.manifest.rowCounts).length, rows, mismatches: r.mismatches.length, ms: r.ms,
      ...(r.privacy ? { privacyReplay: r.privacy } : {}),
      ...(r.texts ? { restoredTexts: r.texts } : {}),
      ...(r.mismatches.length ? { first: r.mismatches.slice(0, 10) } : {}),
    });
    process.exitCode = r.mismatches.length ? 1 : 0;
  } catch (e) {
    line("error", "restore failed", { error: redactUrls((e as Error).message) });
    process.exitCode = 1;
  } finally { if (tmp) await rm(tmp, { recursive: true, force: true }); }
}
