#!/usr/bin/env bun
// Local development Postgres for the observatory's real-world mode (never production).
//   bun run packages/observatory/db/dev-pg.ts up      # init (once), start on :54339, create db + schema
//   bun run packages/observatory/db/dev-pg.ts reset   # drop and recreate the network schema
//   bun run packages/observatory/db/dev-pg.ts down    # stop
//   bun run packages/observatory/db/dev-pg.ts url     # print the connection URL
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SQL } from "bun";

const REPO = resolve(import.meta.dir, "../../..");
export const DEV_PG_DIR = process.env.OBSERVATORY_PG_DIR ?? join(REPO, "runs", "pg");
export const DEV_PG_PORT = Number(process.env.OBSERVATORY_PG_PORT ?? 54339);
export const DEV_PG_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/network`;
const SCHEMA = join(import.meta.dir, "schema.sql");

function pgBin(name: string): string {
  for (const v of ["16", "17", "18"]) {
    const p = `/opt/homebrew/opt/postgresql@${v}/bin/${name}`;
    if (existsSync(p)) return p;
  }
  const which = Bun.which(name);
  if (!which) throw new Error(`${name} not found: install Postgres (brew install postgresql@16)`);
  return which;
}

async function sh(cmd: string[], quiet = false) {
  // LC_ALL: macOS postgres refuses to start ("postmaster became multithreaded") without a valid locale.
  const p = Bun.spawn(cmd, { stdout: quiet ? "ignore" : "inherit", stderr: quiet ? "ignore" : "inherit", env: { ...process.env, LC_ALL: "C" } });
  return p.exited;
}

export async function devPgUp(): Promise<string> {
  if (!existsSync(join(DEV_PG_DIR, "PG_VERSION"))) {
    mkdirSync(DEV_PG_DIR, { recursive: true });
    const code = await sh([pgBin("initdb"), "-D", DEV_PG_DIR, "-A", "trust", "-E", "UTF8", "--no-locale"], true);
    if (code !== 0) throw new Error("initdb failed");
  }
  const ready = await sh([pgBin("pg_isready"), "-h", "localhost", "-p", String(DEV_PG_PORT)], true);
  if (ready !== 0) {
    const code = await sh([pgBin("pg_ctl"), "-D", DEV_PG_DIR, "-o", `-p ${DEV_PG_PORT} -k /tmp`, "-l", join(DEV_PG_DIR, "server.log"), "-w", "start"], true);
    if (code !== 0) throw new Error(`pg_ctl start failed (see ${join(DEV_PG_DIR, "server.log")})`);
  }
  const admin = new SQL(`postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`);
  const exists = await admin`select 1 from pg_database where datname = 'network'`;
  if (!exists.length) await admin.unsafe("create database network");
  await admin.close();
  await applySchema(DEV_PG_URL);
  return DEV_PG_URL;
}

export async function applySchema(url: string, opts: { reset?: boolean } = {}) {
  const sql = new SQL(url);
  if (opts.reset) await sql.unsafe("drop schema if exists network cascade");
  await sql.unsafe(await Bun.file(SCHEMA).text());
  await sql.close();
}

export async function devPgDown() {
  await sh([pgBin("pg_ctl"), "-D", DEV_PG_DIR, "-m", "fast", "stop"], true);
}

if (import.meta.main) {
  const cmd = process.argv[2] ?? "up";
  if (cmd === "up") console.log(await devPgUp());
  else if (cmd === "reset") { await devPgUp(); await applySchema(DEV_PG_URL, { reset: true }); console.log("schema reset"); }
  else if (cmd === "down") { await devPgDown(); console.log("stopped"); }
  else if (cmd === "url") console.log(DEV_PG_URL);
  else { console.error(`unknown command ${cmd} (up | reset | down | url)`); process.exit(1); }
}
