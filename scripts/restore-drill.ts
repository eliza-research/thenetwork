#!/usr/bin/env bun
// The restore drill (PRD 36.9, 28.5 "backup restore tested"; docs/runbook-dr.md). Local databases only.
//   bun run scripts/restore-drill.ts                 # dump the dev database (network on :54339)
//   bun run scripts/restore-drill.ts --seed          # dump a freshly seeded test database instead (14 sim days)
//   bun run scripts/restore-drill.ts --url <local>   # dump another local database
//   bun run scripts/restore-drill.ts --keep          # keep the restored database (default: drop it)
// Steps: pg_dump (custom format) -> a new database restore_drill_<pid> -> migrate() -> compare the row
// count of every table in the network, platform, notify and public schemas -> boot the backend on the
// restored database (dry-run sends, a one-off staff token) and check /healthz and the staff /health ->
// stop it -> drop the database. Prints a report; exits 1 on any mismatch or failed check.
// The restored copy is a throwaway: the backend's first tick runs against it, never against the source.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { SQL } from "bun";
import { DEV_PG_PORT, DEV_PG_URL, devPgUp, pgBin } from "../packages/observatory/db/dev-pg.ts";
import { migrate } from "../packages/observatory/db/migrate.ts";

const REPO = resolve(import.meta.dir, "..");
const { values: a } = parseArgs({ options: { url: { type: "string" }, seed: { type: "boolean", default: false }, keep: { type: "boolean", default: false }, "no-boot": { type: "boolean", default: false } } });
const USER = process.env.USER ?? "postgres";
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const isLocal = (u: string) => { try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };
const dbUrl = (name: string) => `postgres://${USER}@localhost:${DEV_PG_PORT}/${name}`;
const t0 = performance.now();
const lap = () => Math.round(performance.now() - t0);

async function admin(q: string) {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe(q); } finally { await sql.close(); }
}
async function run(cmd: string[], env: Record<string, string> = {}) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, LC_ALL: "C", ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${cmd[0]!.split("/").pop()} exited ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`);
  return out;
}

/** Exact row counts of every table in the app schemas. */
async function rowCounts(url: string): Promise<Map<string, number>> {
  const sql = new SQL({ url, max: 1 });
  try {
    const tables = await sql`select schemaname, tablename from pg_tables where schemaname in ('network', 'platform', 'notify', 'public') order by 1, 2`;
    const out = new Map<string, number>();
    for (const t of tables as any[]) {
      const [r] = await sql.unsafe(`select count(*)::bigint as n from "${t.schemaname}"."${t.tablename}"`);
      out.set(`${t.schemaname}.${t.tablename}`, Number(r.n));
    }
    return out;
  } finally { await sql.close(); }
}

await devPgUp();
const report: { step: string; ok: boolean; ms: number; detail?: string }[] = [];
const step = (name: string, ok: boolean, detail?: string) => { report.push({ step: name, ok, ms: lap(), ...(detail ? { detail } : {}) }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`); };
const target = `restore_drill_${process.pid}`, targetUrl = dbUrl(target);
let seeded: string | undefined;
const dir = mkdtempSync(join(tmpdir(), "restore-drill-"));
let failed = false;

try {
  // ------------------------------------------------------------------ the source
  let source = a.url ?? DEV_PG_URL;
  if (a.seed) {
    seeded = `restore_drill_src_${process.pid}`;
    await admin(`drop database if exists ${seeded} with (force)`);
    await admin(`create database ${seeded}`);
    source = dbUrl(seeded);
    await migrate(source, { lockTimeout: "10s" });
    await run(["bun", "run", join(REPO, "packages/observatory/db/seed.ts"), "--from-sim", "--days", "14", "--url", source]);
    step("seed a source database", true, seeded);
  }
  if (!isLocal(source)) throw new Error("the drill runs on local databases only");
  const before = await rowCounts(source);
  const rows = [...before.values()].reduce((x, y) => x + y, 0);
  step("count the source", before.size > 0, `${before.size} tables, ${rows} rows`);

  // ------------------------------------------------------------------ dump and restore
  const dump = join(dir, "drill.dump");
  await run([pgBin("pg_dump"), "-Fc", "-f", dump, "-d", source]);
  step("pg_dump", true, `${Math.round(statSync(dump).size / 1024)} KiB`);
  await admin(`drop database if exists ${target} with (force)`);
  await admin(`create database ${target}`);
  await run([pgBin("pg_restore"), "--exit-on-error", "-d", targetUrl, dump]);
  step("pg_restore into a new database", true, target);

  // ------------------------------------------------------------------ migrate and compare
  const m = await migrate(targetUrl, { lockTimeout: "10s" });
  step("migrate the restored database", true, m.applied.length ? `applied ${m.applied.join(", ")}` : "nothing pending");
  const after = await rowCounts(targetUrl);
  const diff: string[] = [];
  for (const [t, n] of before) if (after.get(t) !== n && !(t === "public.__migrations" && m.applied.length)) diff.push(`${t} ${n} -> ${after.get(t) ?? "missing"}`);
  step("row counts per table", diff.length === 0, diff.length ? diff.slice(0, 10).join("; ") : `${before.size} tables match`);
  if (diff.length) failed = true;

  // ------------------------------------------------------------------ boot the backend on it
  if (!a["no-boot"]) {
    const port = 21000 + (process.pid % 10000), staff = port + 1, token = randomBytes(24).toString("hex");
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>), PLATFORM_ENV: "dev", DATABASE_URL: targetUrl, MIGRATE_ON_BOOT: "0", PORT: String(port), STAFF_PORT: String(staff),
      TICK_MS: "3600000", BUILD_ID: "restore-drill", NETWORK_SERVICE_TOKENS: `admin:${token}`, NETWORK_CHANNEL: "", BLOOIO_ALLOW_SEND: "", MONITOR: "",
    };
    const proc = Bun.spawn(["bun", "run", join(REPO, "deploy/backend/server.ts")], { env, stdout: "pipe", stderr: "pipe" });
    const out = new Response(proc.stdout).text();
    try {
      let ok = false;
      for (let i = 0; i < 150 && !ok; i++) { await Bun.sleep(100); ok = await fetch(`http://127.0.0.1:${port}/healthz`).then(r => r.status === 200, () => false); }
      step("backend /healthz", ok);
      if (!ok) failed = true;
      if (ok) {
        const h = await fetch(`http://127.0.0.1:${staff}/health`, { headers: { authorization: `Bearer ${token}` } });
        const body = await h.json().catch(() => ({})) as Record<string, unknown>;
        step("backend staff /health", h.status === 200 && body.ok !== false, `HTTP ${h.status}`);
        if (h.status !== 200) failed = true;
      }
    } finally {
      proc.kill("SIGTERM");
      const code = await proc.exited;
      const logs = await out;
      if (/"sends":"live"/.test(logs)) { failed = true; step("sends stayed dry-run", false); }
      step("backend stopped", code === 0, `exit ${code}`);
    }
  }
} catch (e) {
  failed = true;
  step("drill", false, (e as Error).message);
} finally {
  if (!a.keep) await admin(`drop database if exists ${target} with (force)`).catch(() => {});
  if (seeded) await admin(`drop database if exists ${seeded} with (force)`).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
const summary = { ok: !failed, minutes: Math.round((lap() / 60_000) * 100) / 100, steps: report.length, failed: report.filter(r => !r.ok).map(r => r.step), kept: a.keep ? target : null };
console.log(JSON.stringify(summary));
process.exit(failed ? 1 : 0);
