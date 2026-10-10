// The backup job and the restore drill on the dev Postgres (docs/deploy.md section 8), with a local
// S3-compatible stub in place of R2 (no real bucket, no network): the dump is encrypted before upload,
// a public bucket is refused before anything is uploaded, a restore decrypts, restores with
// --no-owner --no-privileges into a new database and never changes a role of the source server.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { DEV_PG_PORT } from "../../packages/observatory/db/dev-pg.ts";
import { dropTestDb, pgAvailable, testDb } from "../../packages/observatory/test/pg.ts";
import { backup, upload } from "./backup.ts";
import { backupKey, backupKeyFromEnv, decryptFile, encryptFile, type Manifest } from "./lib.ts";
import { download, restore } from "./restore.ts";

const T = 180_000;
const KEY = "k".repeat(24) + "-backup-test-key-0123";
const CANARY = "PlainTextCanary4711";
const ADMIN = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const SCRATCH = `restore_test_${process.pid}`;

/** A local S3-compatible bucket: PUT, GET, HEAD and DELETE by path (bucket/key). Signed requests always pass; an unsigned GET passes only when `public`. */
function fakeBucket(bucket: string) {
  const objects = new Map<string, Uint8Array>();
  const state = { public: false };
  const signed = (req: Request) => !!req.headers.get("authorization") || new URL(req.url).searchParams.has("X-Amz-Signature");
  const server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url);
      const path = decodeURIComponent(u.pathname.slice(1));
      if (!path.startsWith(`${bucket}/`)) return new Response("NoSuchBucket", { status: 404 });
      const key = path.slice(bucket.length + 1);
      if (req.method === "PUT") { if (!signed(req)) return new Response("AccessDenied", { status: 403 }); objects.set(key, new Uint8Array(await req.arrayBuffer())); return new Response(null, { status: 200, headers: { etag: '"x"' } }); }
      if (req.method === "DELETE") { if (!signed(req)) return new Response("AccessDenied", { status: 403 }); objects.delete(key); return new Response(null, { status: 204 }); }
      if (req.method === "GET" || req.method === "HEAD") {
        if (!signed(req) && !state.public) return new Response("AccessDenied", { status: 403 });
        const o = objects.get(key);
        if (!o) return new Response("NoSuchKey", { status: 404 });
        return new Response(req.method === "HEAD" ? null : Buffer.from(o), { status: 200, headers: { "content-length": String(o.length), etag: '"x"' } });
      }
      return new Response("NotImplemented", { status: 501 });
    },
  });
  const env = { PLATFORM_ENV: "production", BACKUP_R2_ENDPOINT: `http://127.0.0.1:${server.port}`, BACKUP_R2_BUCKET: bucket, BACKUP_R2_ACCESS_KEY_ID: "test", BACKUP_R2_SECRET_ACCESS_KEY: "test-secret" };
  return { objects, state, env, stop: () => server.stop(true) };
}

/** Role attributes and memberships on the server, keyed by role (other test processes may add their own roles meanwhile). */
async function rolesOfServer(): Promise<Map<string, string>> {
  const a = new SQL({ url: ADMIN, max: 1 });
  try {
    const out = new Map<string, string>();
    for (const r of await a`select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit,
        (select coalesce(string_agg(m.roleid::regrole::text, ',' order by m.roleid::regrole::text), '') from pg_auth_members m where m.member = r.oid) as member_of
      from pg_roles r` as Record<string, unknown>[]) out.set(String(r.rolname), JSON.stringify(r));
    return out;
  } finally { await a.close(); }
}
/** The roles present before, as they are now: every one unchanged. */
const unchanged = (before: Map<string, string>, after: Map<string, string>) => [...before].filter(([k, v]) => after.has(k) && after.get(k) !== v).map(([k]) => k);

let src: string;
let dir: string;
beforeAll(async () => {
  if (!pgAvailable) return;
  src = await testDb();
  dir = await mkdtemp(join(tmpdir(), "backup-test-"));
  const sql = new SQL({ url: src, max: 1 });
  try {
    for (let i = 0; i < 4; i++) await sql`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at) values ('slop', ${`m${i}`}, ${`${CANARY}${i}`}, 'nyc', 'active', ${25 + i}, now())`;
  } finally { await sql.close(); }
}, T);
afterAll(async () => {
  if (!pgAvailable) return;
  const a = new SQL({ url: ADMIN, max: 1 });
  await a.unsafe(`drop database if exists ${SCRATCH} with (force)`).catch(() => {});
  await a.close();
  await dropTestDb();
  await rm(dir, { recursive: true, force: true });
});

describe("backup encryption and the bucket check", () => {
  test("the key: at least 32 bytes; staging and production refuse to upload without one; dev may", () => {
    expect(() => backupKey("short")).toThrow(/at least 32 bytes/);
    expect(() => backupKeyFromEnv({ PLATFORM_ENV: "production" })).toThrow(/BACKUP_ENCRYPTION_KEY/);
    expect(() => backupKeyFromEnv({ PLATFORM_ENV: "staging" })).toThrow(/BACKUP_ENCRYPTION_KEY/);
    expect(() => backupKeyFromEnv({})).toThrow(/BACKUP_ENCRYPTION_KEY/);
    expect(backupKeyFromEnv({ PLATFORM_ENV: "dev" })).toBeUndefined();
    expect(backupKeyFromEnv({ PLATFORM_ENV: "production", BACKUP_ENCRYPTION_KEY: KEY })!.id).toBe(backupKey(KEY).id);
  });

  test("a file round-trips; a wrong key or one changed byte does not decrypt", async () => {
    const d = await mkdtemp(join(tmpdir(), "backup-enc-"));
    try {
      const plain = Buffer.concat([Buffer.from(CANARY), Buffer.alloc(200_000, 7)]);
      await writeFile(join(d, "p"), plain);
      await encryptFile(join(d, "p"), join(d, "e"), backupKey(KEY));
      const enc = await readFile(join(d, "e"));
      expect(enc.includes(Buffer.from(CANARY))).toBe(false);
      await decryptFile(join(d, "e"), join(d, "out"), backupKey(KEY));
      expect((await readFile(join(d, "out"))).equals(plain)).toBe(true);
      expect(await decryptFile(join(d, "e"), join(d, "bad"), backupKey("x".repeat(40))).then(() => "ok", e => String(e.message))).toMatch(/could not decrypt/);
      enc[100] = enc[100]! ^ 1;
      await writeFile(join(d, "e2"), enc);
      expect(await decryptFile(join(d, "e2"), join(d, "bad2"), backupKey(KEY)).then(() => "ok", e => String(e.message))).toMatch(/could not decrypt/);
      // An empty file too.
      await writeFile(join(d, "empty"), "");
      await encryptFile(join(d, "empty"), join(d, "empty.e"), backupKey(KEY));
      await decryptFile(join(d, "empty.e"), join(d, "empty.out"), backupKey(KEY));
      expect((await readFile(join(d, "empty.out"))).length).toBe(0);
    } finally { await rm(d, { recursive: true, force: true }); }
  });

  test.skipIf(!pgAvailable)("a public bucket is refused before anything is uploaded", async () => {
    const b = fakeBucket("ntwrk-backups-public");
    b.state.public = true;
    try {
      const r = await backup({ url: src, outDir: join(dir, "public"), roles: false });
      const err = await upload(r.dir, r.manifest, "postgres/production/20261009T000000Z", b.env, backupKey(KEY)).then(() => "uploaded", e => String(e.message));
      expect(err).toMatch(/readable without credentials/);
      expect([...b.objects.keys()]).toEqual([]);
    } finally { b.stop(); }
  }, T);
});

describe("backup and restore drill", () => {
  test.skipIf(!pgAvailable)("encrypted upload; download decrypts; restore into a new database with --no-owner --no-privileges; no role on the server changes", async () => {
    const b = fakeBucket("ntwrk-backups");
    const prefix = "postgres/production/20261009T071500Z";
    try {
      const r = await backup({ url: src, outDir: join(dir, "bk") });
      expect(r.manifest.source).toEqual({ host: "localhost", port: String(DEV_PG_PORT) });
      const keys = await upload(r.dir, r.manifest, prefix, b.env, backupKey(KEY));
      expect(keys.map(k => k.slice(prefix.length + 1))).toEqual(["db.dump.enc", ...(r.manifest.files.roles ? ["roles.sql.enc"] : []), "manifest.json"]);
      // What the bucket holds: no plain dump, no member name, no probe object left behind.
      expect([...b.objects.keys()].every(k => !k.includes("privacy-probe"))).toBe(true);
      const stored = Buffer.from(b.objects.get(`${prefix}/db.dump.enc`)!);
      expect(stored.subarray(0, 5).toString()).not.toBe("PGDMP");
      expect(stored.includes(Buffer.from(CANARY))).toBe(false);
      const manifest = JSON.parse(Buffer.from(b.objects.get(`${prefix}/manifest.json`)!).toString()) as Manifest;
      expect(manifest.encryption).toEqual({ alg: "aes-256-gcm", kdf: "hkdf-sha256", keyId: backupKey(KEY).id });

      // A download needs the key, and the right one.
      const wrong = await mkdtemp(join(tmpdir(), "backup-dl-"));
      expect(await download(prefix, wrong, { ...b.env, BACKUP_ENCRYPTION_KEY: undefined }).then(() => "ok", e => String(e.message))).toMatch(/set BACKUP_ENCRYPTION_KEY/);
      expect(await download(prefix, wrong, { ...b.env, BACKUP_ENCRYPTION_KEY: "y".repeat(40) }).then(() => "ok", e => String(e.message))).toMatch(/not the key/);
      await rm(wrong, { recursive: true, force: true });
      const dl = join(dir, "dl");
      await Bun.$`mkdir -p ${dl}`.quiet();
      await download(prefix, dl, { ...b.env, BACKUP_ENCRYPTION_KEY: KEY });
      expect((await readFile(join(dl, "db.dump"))).subarray(0, 5).toString()).toBe("PGDMP");

      const before = await rolesOfServer();
      const srcDb = new URL(src).pathname.slice(1);
      // The source's own database on its own server, and roles.sql on the source server: refused before anything runs.
      expect(await restore({ serverUrl: ADMIN, db: srcDb, dir: dl }).then(() => "restored", e => String(e.message))).toMatch(/refusing/);
      expect(await restore({ serverUrl: ADMIN, db: SCRATCH, dir: dl, roles: true }).then(() => "restored", e => String(e.message))).toMatch(/refusing --roles/);
      const res = await restore({ serverUrl: ADMIN, db: SCRATCH, dir: dl });
      expect(res.mismatches).toEqual([]);
      expect(unchanged(before, await rolesOfServer())).toEqual([]);
      // --no-owner: every restored table belongs to the login that ran the restore, not to the source's roles.
      const s = new SQL({ url: res.url, max: 1 });
      try {
        const owners = (await s`select distinct tableowner from pg_tables where schemaname in ('network', 'platform')`).map((x: any) => x.tableowner);
        expect(owners).toEqual([process.env.USER ?? "postgres"]);
        const [{ n }] = await s`select count(*)::int as n from network.members where name like ${`${CANARY}%`}`;
        expect(n).toBe(4);
      } finally { await s.close(); }
    } finally { b.stop(); }
  }, T);
});
