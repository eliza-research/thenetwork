// Throwaway Postgres 16 cluster (Homebrew) in a temp dir. No Docker needed.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@16/bin";

function run(cmd: string[]) {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, LC_ALL: "C", LANG: "C" } });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}\n${r.stderr.toString()}${r.stdout.toString()}`);
  return r.stdout.toString();
}

export interface Cluster { url: string; port: number; dir: string; version: string; stop(): void }

export function startCluster(port = Number(process.env.PG_PORT ?? 54329)): Cluster {
  const dir = mkdtempSync(join(tmpdir(), "network-pg-"));
  const data = join(dir, "data");
  run([`${BIN}/initdb`, "-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-sync"]);
  const opts = [
    `-p ${port}`, "-k", dir, "-c listen_addresses=127.0.0.1", "-c max_connections=100",
    "-c shared_buffers=1GB", "-c maintenance_work_mem=2GB", "-c work_mem=64MB",
    "-c fsync=off", "-c synchronous_commit=off", "-c full_page_writes=off",
    "-c max_parallel_maintenance_workers=7",
  ].join(" ");
  try { run([`${BIN}/pg_ctl`, "-D", data, "-l", join(dir, "log"), "-o", opts, "-w", "start"]); }
  catch (e) { const log = Bun.spawnSync(["cat", join(dir, "log")]).stdout.toString(); rmSync(dir, { recursive: true, force: true }); throw new Error(`${e}\n${log}`); }
  const version = run([`${BIN}/postgres`, "--version"]).trim();
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`, port, dir, version,
    stop() {
      try { run([`${BIN}/pg_ctl`, "-D", data, "-m", "immediate", "-w", "stop"]); } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}
