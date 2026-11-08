// The backup and restore command lines (docs/deploy.md section 8) on the dev Postgres, run as the operator
// runs them: `bun run deploy/backup/backup.ts` and `restore.ts` in a child process. A local
// S3-compatible stub stands in for R2 (no real bucket, no network). The dump holds member data, so
// the files the job keeps must be the files its log says it keeps.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { DEV_PG_PORT } from "../../packages/observatory/db/dev-pg.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";

const T = 120_000;
const USER = process.env.USER ?? "postgres";
const ADMIN = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const SRC = `backup_cli_src_${process.pid}`;
const SRC_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/${SRC}`;
const KEY = "k".repeat(24) + "-backup-cli-test-key-0123";
const BACKUP_SCRIPT = join(import.meta.dir, "backup.ts");

/** A local S3-compatible bucket: PUT, GET, HEAD, DELETE and ListObjectsV2. Unsigned reads are refused (a private bucket). */
function fakeBucket(bucket: string) {
  const objects = new Map<string, Uint8Array>();
  const signed = (req: Request) => !!req.headers.get("authorization") || new URL(req.url).searchParams.has("X-Amz-Signature");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const u = new URL(req.url);
      const path = decodeURIComponent(u.pathname.slice(1)).replace(/\/$/, "");
      if (!signed(req)) return new Response("AccessDenied", { status: 403 });
      if (path === bucket && req.method === "GET") {
        const prefix = u.searchParams.get("prefix") ?? "";
        const after = u.searchParams.get("start-after") ?? "";
        const keys = [...objects.keys()].filter(k => k.startsWith(prefix) && k > after).sort();
        const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${
          keys.map(k => `<Contents><Key>${esc(k)}</Key><Size>${objects.get(k)!.length}</Size></Contents>`).join("")}</ListBucketResult>`;
        return new Response(xml, { headers: { "content-type": "application/xml" } });
      }
      if (!path.startsWith(`${bucket}/`)) return new Response("NoSuchBucket", { status: 404 });
      const key = path.slice(bucket.length + 1);
      if (req.method === "PUT") { objects.set(key, new Uint8Array(await req.arrayBuffer())); return new Response(null, { status: 200, headers: { etag: '"x"' } }); }
      if (req.method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
      const o = objects.get(key);
      if (!o) return new Response("NoSuchKey", { status: 404 });
      return new Response(req.method === "HEAD" ? null : Buffer.from(o), { status: 200, headers: { "content-length": String(o.length), etag: '"x"' } });
    },
  });
  const env = { BACKUP_R2_ENDPOINT: `http://127.0.0.1:${server.port}`, BACKUP_R2_BUCKET: bucket, BACKUP_R2_ACCESS_KEY_ID: "test", BACKUP_R2_SECRET_ACCESS_KEY: "test-secret" };
  return { objects, env, stop: () => server.stop(true) };
}

/** Run a script as the operator does, with only the given variables (plus PATH and HOME); return its JSON log lines. */
async function cli(script: string, args: string[], env: Record<string, string>): Promise<{ code: number; lines: Record<string, unknown>[] }> {
  const p = Bun.spawn(["bun", "run", script, ...args], { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  const lines = out.split("\n").filter(l => l.startsWith("{")).map(l => JSON.parse(l) as Record<string, unknown>);
  return { code, lines };
}

/** Every file under `dir`, as paths relative to it. */
async function files(dir: string): Promise<string[]> {
  return existsSync(dir) ? (await readdir(dir, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(dir.length + 1)).sort() : [];
}

beforeAll(async () => {
  if (!pgAvailable) return;
  const a = new SQL({ url: ADMIN, max: 1 });
  try { await a.unsafe(`create database ${SRC}`); } finally { await a.close(); }
  const s = new SQL({ url: SRC_URL, max: 1 });
  try { await s`create table public.t (id int)`; await s`insert into public.t values (1), (2), (3)`; } finally { await s.close(); }
}, T);
afterAll(async () => {
  if (!pgAvailable) return;
  const a = new SQL({ url: ADMIN, max: 1 });
  try { await a.unsafe(`drop database if exists ${SRC} with (force)`).catch(() => {}); } finally { await a.close(); }
});

test.skipIf(!pgAvailable)("backup.ts --local keeps the dump in the directory its log names", async () => {
  const r = await cli(BACKUP_SCRIPT, ["--local"], { BACKUP_DATABASE_URL: SRC_URL });
  const kept = r.lines.find(l => l.msg === "backup kept locally");
  const dir = String(kept?.dir ?? "");
  try {
    expect({ code: r.code, logged: !!kept, files: await files(dir) }).toEqual({ code: 0, logged: true, files: expect.arrayContaining(["db.dump", "manifest.json"]) });
  } finally { if (dir) await rm(dir, { recursive: true, force: true }); }
}, T);

test.skipIf(!pgAvailable)("backup.ts --out without --local uploads and keeps no plain copy of the dump", async () => {
  const b = fakeBucket("ntwrk-backups-cli");
  const out = await mkdtemp(join(tmpdir(), "backup-cli-out-"));
  try {
    const r = await cli(BACKUP_SCRIPT, ["--out", out], { BACKUP_DATABASE_URL: SRC_URL, ...b.env, PLATFORM_ENV: "production", BACKUP_PREFIX: "postgres/production", BACKUP_ENCRYPTION_KEY: KEY });
    const uploaded = [...b.objects.keys()].filter(k => !k.includes("privacy-probe")).map(k => k.split("/").at(-1)).sort();
    expect({ code: r.code, uploaded: r.lines.some(l => l.msg === "backup uploaded"), objects: uploaded, kept: await files(out) })
      .toEqual({ code: 0, uploaded: true, objects: expect.arrayContaining(["db.dump.enc", "manifest.json"]), kept: [] });
  } finally { b.stop(); await rm(out, { recursive: true, force: true }); }
}, T);

/**
 * The restore command of docs/deploy.md section 8.2, as written: the variables it sets and the arguments
 * it passes. A "..." value is a secret or an account value the operator fills in; the test fills it.
 */
async function documentedRestore(): Promise<{ vars: Record<string, string>; args: string[] }> {
  const doc = await Bun.file(join(import.meta.dir, "../../docs/deploy.md")).text();
  const section = doc.slice(doc.indexOf("### 8.2 Restore"));
  const block = /```bash\n([\s\S]*?)```/.exec(section)![1]!;
  const command = block.split("\n").filter(l => !l.trim().startsWith("#")).join("\n").replace(/\\\n/g, " ");
  const words = command.trim().split(/\s+/);
  const vars: Record<string, string> = {};
  let i = 0;
  for (; /^[A-Z][A-Z0-9_]*=/.test(words[i]!); i++) { const [k, ...v] = words[i]!.split("="); vars[k!] = v.join("="); }
  expect(words.slice(i, i + 3)).toEqual(["bun", "run", "deploy/backup/restore.ts"]);
  return { vars, args: words.slice(i + 3) };
}

test.skipIf(!pgAvailable)("the restore command of docs/deploy.md 8.2 restores the latest backup that the 8.1 job uploaded", async () => {
  const doc = await documentedRestore();
  const b = fakeBucket(doc.vars.BACKUP_R2_BUCKET!);
  const scratch = `restore_doc_${process.pid}`;
  try {
    // The backup job with the variables of docs/deploy.md 8.1 (BACKUP_PREFIX postgres/production, an encryption key).
    const up = await cli(BACKUP_SCRIPT, [], { BACKUP_DATABASE_URL: SRC_URL, ...b.env, BACKUP_PREFIX: "postgres/production", BACKUP_ENCRYPTION_KEY: KEY });
    expect(up.lines.some(l => l.msg === "backup uploaded")).toBe(true);
    // The operator fills in each "..." value; a literal value in the document stays as written.
    const fill: Record<string, string> = { RESTORE_DATABASE_URL: ADMIN, BACKUP_R2_ACCESS_KEY_ID: b.env.BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY: b.env.BACKUP_R2_SECRET_ACCESS_KEY, BACKUP_ENCRYPTION_KEY: KEY };
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc.vars)) {
      // The account id names the R2 endpoint; here the stub's endpoint stands for it.
      if (k === "BACKUP_R2_ACCOUNT_ID") { env.BACKUP_R2_ENDPOINT = b.env.BACKUP_R2_ENDPOINT; continue; }
      env[k] = v === "..." ? fill[k] ?? v : v;
    }
    const args = doc.args.map((a, j) => doc.args[j - 1] === "--db" ? scratch : a);
    const r = await cli(join(import.meta.dir, "restore.ts"), args, env);
    const checked = r.lines.find(l => l.msg === "restore checked");
    expect({ code: r.code, failed: r.lines.find(l => l.msg === "restore failed")?.error, mismatches: checked?.mismatches }).toEqual({ code: 0, failed: undefined, mismatches: 0 });
  } finally {
    b.stop();
    const a = new SQL({ url: ADMIN, max: 1 });
    try { await a.unsafe(`drop database if exists ${scratch} with (force)`).catch(() => {}); } finally { await a.close(); }
  }
}, T);
