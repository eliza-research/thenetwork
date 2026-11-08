// A failed restore (docs/deploy.md 8.2) on the dev Postgres: restore.ts makes a new scratch database,
// and when pg_restore stops on an error, that database must not stay behind. It can hold part of the
// member data, and a second try with the same name was refused ("already exists").
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { DEV_PG_PORT } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { backup } from "./backup.ts";
import { restore } from "./restore.ts";

const T = 120_000;
const USER = process.env.USER ?? "postgres";
const ADMIN = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const SRC = `restore_fail_src_${process.pid}`;
const SCRATCH = `restore_fail_${process.pid}`;

let dir: string;
beforeAll(async () => {
  if (!pgAvailable) return;
  dir = await mkdtemp(join(tmpdir(), "restore-failure-"));
  const a = new SQL({ url: ADMIN, max: 1 });
  try { await a.unsafe(`create database ${SRC}`); } finally { await a.close(); }
  const s = new SQL({ url: `postgres://${USER}@localhost:${DEV_PG_PORT}/${SRC}`, max: 1 });
  try { await s`create table public.t (id int)`; await s`insert into public.t values (1), (2)`; } finally { await s.close(); }
}, T);
afterAll(async () => {
  if (!pgAvailable) return;
  const a = new SQL({ url: ADMIN, max: 1 });
  try { for (const db of [SCRATCH, SRC]) await a.unsafe(`drop database if exists ${db} with (force)`).catch(() => {}); } finally { await a.close(); }
  await rm(dir, { recursive: true, force: true });
});

test.skipIf(!pgAvailable)("a restore that fails in pg_restore leaves no scratch database, and the same name works on the next try", async () => {
  const r = await backup({ url: `postgres://${USER}@localhost:${DEV_PG_PORT}/${SRC}`, outDir: dir, roles: false });
  const good = await Bun.file(join(dir, "db.dump")).arrayBuffer();
  // A damaged dump: pg_restore --exit-on-error stops.
  await Bun.write(join(dir, "db.dump"), "PGDMP this is not a dump");
  const failed = await restore({ serverUrl: ADMIN, db: SCRATCH, dir }).then(() => "restored", e => String((e as Error).message));
  const a = new SQL({ url: ADMIN, max: 1 });
  let left: boolean;
  try { left = (await a`select 1 as x from pg_database where datname = ${SCRATCH}`).length > 0; } finally { await a.close(); }
  await Bun.write(join(dir, "db.dump"), good);
  const retry = await restore({ serverUrl: ADMIN, db: SCRATCH, dir }).then(x => `mismatches ${x.mismatches.length}`, e => String((e as Error).message));
  expect({ failed: failed !== "restored", left, retry, tables: Object.keys(r.manifest.rowCounts).length > 0 }).toEqual({ failed: true, left: false, retry: "mismatches 0", tables: true });
}, T);
