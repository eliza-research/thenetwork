// The restore guard for roles.sql (docs/deploy.md 8.2) on the dev Postgres: a restore never runs
// roles.sql on the source server. The source server can have two host names (the private Railway name
// for the backup job, the TCP proxy for a drill: runbook-real.md section 8). Here "localhost" and
// "0.0.0.0" are the two names of one server. The roles file of the test only creates a probe role, so
// the test never changes a real role.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { DEV_PG_PORT } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { backup } from "./backup.ts";
import type { Manifest } from "./lib.ts";
import { restore } from "./restore.ts";

const T = 120_000;
const USER = process.env.USER ?? "postgres";
const ADMIN = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const SRC = `restore_src_${process.pid}`;
const SCRATCH = `restore_alias_${process.pid}`;
const PROBE = `restore_roles_probe_${process.pid}`;

let dir: string;
beforeAll(async () => {
  if (!pgAvailable) return;
  dir = await mkdtemp(join(tmpdir(), "restore-source-"));
  const a = new SQL({ url: ADMIN, max: 1 });
  try { await a.unsafe(`create database ${SRC}`); } finally { await a.close(); }
  const s = new SQL({ url: `postgres://${USER}@localhost:${DEV_PG_PORT}/${SRC}`, max: 1 });
  try { await s`create table public.t (id int)`; await s`insert into public.t values (1), (2)`; } finally { await s.close(); }
}, T);
afterAll(async () => {
  if (!pgAvailable) return;
  const a = new SQL({ url: ADMIN, max: 1 });
  try {
    for (const db of [SCRATCH, SRC]) await a.unsafe(`drop database if exists ${db} with (force)`).catch(() => {});
    await a.unsafe(`drop role if exists ${PROBE}`).catch(() => {});
  } finally { await a.close(); }
  await rm(dir, { recursive: true, force: true });
});

test.skipIf(!pgAvailable)("restore refuses --roles on the source server reached through a second host name", async () => {
  const r = await backup({ url: `postgres://${USER}@localhost:${DEV_PG_PORT}/${SRC}`, outDir: dir, roles: false });
  // A roles file that only makes a probe role: if it runs, the probe role exists on the source server.
  await Bun.write(join(dir, "roles.sql"), `create role ${PROBE} nologin;\n`);
  const manifest: Manifest = { ...r.manifest, files: { ...r.manifest.files, roles: "roles.sql" } };
  await Bun.write(join(dir, "manifest.json"), JSON.stringify(manifest));

  const outcome = await restore({ serverUrl: `postgres://${USER}@0.0.0.0:${DEV_PG_PORT}/postgres`, db: SCRATCH, dir, roles: true })
    .then(() => "restored", e => String((e as Error).message));
  const a = new SQL({ url: ADMIN, max: 1 });
  try {
    const [probe] = await a`select 1 as x from pg_roles where rolname = ${PROBE}`;
    const [scratch] = await a`select 1 as x from pg_database where datname = ${SCRATCH}`;
    expect({ outcome, probeRoleMade: !!probe, scratchMade: !!scratch }).toEqual({ outcome: expect.stringMatching(/refusing --roles/), probeRoleMade: false, scratchMade: false });
  } finally { await a.close(); }
}, T);
