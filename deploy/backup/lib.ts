// Shared parts of the backup and restore scripts (docs/deploy.md section 8, runbook-real.md section 8).
// A backup is three files under one prefix: db.dump (pg_dump custom format), roles.sql (pg_dumpall
// --roles-only --no-role-passwords) and manifest.json (exact row counts per table, taken in the same
// snapshot as the dump, so a restore can be checked table by table).
// Before upload, db.dump and roles.sql are encrypted (AES-256-GCM, BACKUP_ENCRYPTION_KEY) into
// db.dump.enc and roles.sql.enc; the manifest holds counts and names only and stays plain.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { S3Client, SQL } from "bun";

/** Schemas whose tables the manifest counts (everything the migrations create). */
export const SCHEMAS = ["network", "platform", "notify", "oauth", "public"];

export interface Manifest {
  version: 1;
  createdAt: string;
  database: string;
  /** server_version of the source (restore with a client of the same major version or newer). */
  serverVersion: string;
  pgDump: string;
  rowCounts: Record<string, number>;
  files: { dump: string; roles?: string };
  /** The source server (host and port, never a login): a restore refuses this database on this server and never runs roles.sql here. */
  source?: { host: string; port: string };
  /** Set when the uploaded files are encrypted: each file is stored as `<name>.enc`. */
  encryption?: { alg: "aes-256-gcm"; kdf: "hkdf-sha256"; keyId: string };
}

/** A Postgres client program: PG_BIN_DIR, then Homebrew's postgresql@16..18, then PATH. */
export function pgBin(name: "pg_dump" | "pg_dumpall" | "pg_restore" | "psql"): string {
  const dirs = [process.env.PG_BIN_DIR, "/opt/homebrew/opt/postgresql@16/bin", "/opt/homebrew/opt/postgresql@17/bin", "/opt/homebrew/opt/postgresql@18/bin"].filter(Boolean) as string[];
  for (const d of dirs) if (existsSync(`${d}/${name}`)) return `${d}/${name}`;
  const w = Bun.which(name);
  if (!w) throw new Error(`${name} not found: install the Postgres client (deploy/backup/Dockerfile has it), or set PG_BIN_DIR`);
  return w;
}

/** Run a program; throw with its last stderr lines when it fails. Connection URLs go in the environment or as arguments, never in a log line. */
export async function run(cmd: string[], o: { env?: Record<string, string>; stdin?: Blob } = {}): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: o.stdin ?? "ignore", env: { ...process.env, ...o.env } as Record<string, string> });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${cmd[0]!.split("/").pop()} exited ${code}: ${redactUrls(err).trim().split("\n").slice(-3).join(" | ")}`);
  return out;
}

/** Hide passwords in any postgres:// URL. */
export const redactUrls = (s: string) => s.replace(/(postgres(?:ql)?:\/\/[^:/@\s]+):[^@\s]+@/g, "$1:***@");

/** Exact row counts of every table in SCHEMAS (as `schema.table`), inside the given transaction or connection. */
export async function rowCounts(q: SQL): Promise<Record<string, number>> {
  const tables = await q`select schemaname as s, tablename as t from pg_tables where schemaname in ${q(SCHEMAS)} order by 1, 2` as { s: string; t: string }[];
  const out: Record<string, number> = {};
  for (const { s, t } of tables) {
    const [r] = await q.unsafe(`select count(*)::int as n from "${s.replace(/"/g, '""')}"."${t.replace(/"/g, '""')}"`);
    out[`${s}.${t}`] = Number(r?.n ?? 0);
  }
  return out;
}

/** The tables whose counts differ (or that one side lacks). Empty: the restore matches the manifest. */
export function compareCounts(want: Record<string, number>, got: Record<string, number>): { table: string; want: number | null; got: number | null }[] {
  const out: { table: string; want: number | null; got: number | null }[] = [];
  for (const k of [...new Set([...Object.keys(want), ...Object.keys(got)])].sort()) {
    if (want[k] !== got[k]) out.push({ table: k, want: want[k] ?? null, got: got[k] ?? null });
  }
  return out;
}

/**
 * The private backup bucket: BACKUP_R2_BUCKET, BACKUP_R2_ENDPOINT (or BACKUP_R2_ACCOUNT_ID),
 * BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY. A token for this bucket only (Object Read and
 * Write), never the photo bucket's.
 */
export function backupBucketFromEnv(env: Record<string, string | undefined> = process.env): S3Client {
  const endpoint = env.BACKUP_R2_ENDPOINT ?? (env.BACKUP_R2_ACCOUNT_ID ? `https://${env.BACKUP_R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
  const { BACKUP_R2_BUCKET: bucket, BACKUP_R2_ACCESS_KEY_ID: accessKeyId, BACKUP_R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("the backup bucket needs BACKUP_R2_ENDPOINT (or BACKUP_R2_ACCOUNT_ID), BACKUP_R2_BUCKET, BACKUP_R2_ACCESS_KEY_ID and BACKUP_R2_SECRET_ACCESS_KEY");
  if (env.R2_BUCKET && env.R2_BUCKET === bucket) throw new Error("BACKUP_R2_BUCKET must not be the photo bucket (R2_BUCKET)");
  return new S3Client({ endpoint, bucket, accessKeyId, secretAccessKey, region: "auto" });
}

/** A database name a restore may create: lower case, letters, digits and underscores, at most 63 characters. */
export const safeDbName = (n: string) => /^[a-z_][a-z0-9_]{0,62}$/.test(n);

/** The same server, another database. */
export function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

// ------------------------------------------------------------------ encryption (docs/deploy.md 8.1)

/** The first bytes of an encrypted file; then a 12-byte IV, the ciphertext and a 16-byte GCM tag. */
const MAGIC = Buffer.from("NTBKENC1");
const IV_BYTES = 12, TAG_BYTES = 16;
export const MIN_KEY_BYTES = 32;

export interface BackupKey { key: Buffer; id: string }

/**
 * BACKUP_ENCRYPTION_KEY (at least 32 bytes; a human sets it, and keeps a copy outside Railway). The
 * AES key is derived with HKDF-SHA256; `id` (a hash, never the key) names it in the manifest.
 */
export function backupKey(secret: string): BackupKey {
  if (Buffer.byteLength(secret, "utf8") < MIN_KEY_BYTES) throw new Error(`BACKUP_ENCRYPTION_KEY must be at least ${MIN_KEY_BYTES} bytes`);
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from("thenetwork-backup-v1"), 32));
  return { key, id: createHash("sha256").update(key).digest("hex").slice(0, 16) };
}

/**
 * The key a run must use, from the environment. Staging and production (and an unset PLATFORM_ENV)
 * refuse to upload without one; only PLATFORM_ENV=dev may upload a plain dump.
 */
export function backupKeyFromEnv(env: Record<string, string | undefined> = process.env): BackupKey | undefined {
  const secret = env.BACKUP_ENCRYPTION_KEY;
  if (secret) return backupKey(secret);
  if (env.PLATFORM_ENV === "dev") return undefined;
  throw new Error(`BACKUP_ENCRYPTION_KEY is not set: a backup for PLATFORM_ENV=${env.PLATFORM_ENV ?? "(unset)"} is never uploaded unencrypted`);
}

/** Encrypt the file `src` into `dst` (streamed: a dump can be larger than memory). */
export async function encryptFile(src: string, dst: string, k: BackupKey): Promise<void> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k.key, iv);
  const out = createWriteStream(dst, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, iv]));
  // The tag is known only after the last block: append it when the cipher ends.
  const withTag = new Transform({
    transform(chunk, _enc, cb) { cb(null, chunk); },
    flush(cb) { try { cb(null, cipher.getAuthTag()); } catch (e) { cb(e as Error); } },
  });
  await pipeline(createReadStream(src), cipher, withTag, out);
}

/** Decrypt `src` (made by encryptFile) into `dst`. A wrong key or a changed byte fails, and `dst` is removed. */
export async function decryptFile(src: string, dst: string, k: BackupKey): Promise<void> {
  const size = (await stat(src)).size;
  if (size < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error("not an encrypted backup file (too short)");
  const fh = await open(src, "r");
  const head = Buffer.alloc(MAGIC.length + IV_BYTES), tag = Buffer.alloc(TAG_BYTES);
  try {
    await fh.read(head, 0, head.length, 0);
    await fh.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally { await fh.close(); }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not an encrypted backup file (bad header)");
  const decipher = createDecipheriv("aes-256-gcm", k.key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const end = size - TAG_BYTES - 1;
  try {
    // An empty plaintext has no ciphertext bytes: the range is empty.
    const input = end >= head.length ? createReadStream(src, { start: head.length, end }) : Readable.from([]);
    await pipeline(input, decipher, createWriteStream(dst, { mode: 0o600 }));
  } catch (e) {
    await rm(dst, { force: true });
    throw new Error(`could not decrypt the backup (wrong BACKUP_ENCRYPTION_KEY, or the file changed): ${(e as Error).message}`);
  }
}

// ------------------------------------------------------------------ bucket privacy (docs/deploy.md 8.1)

/**
 * Check that the bucket is not public before anything is uploaded: write a probe object, then GET it
 * without credentials at the S3 endpoint (path style) and at each URL in BACKUP_PUBLIC_PROBE_URLS
 * (comma-separated bases, for example the bucket's r2.dev URL if one was ever turned on). Any 2xx or
 * 3xx answer is a public bucket. A probe URL that does not answer at all cannot be checked: also refused.
 * The probe object is deleted afterwards.
 */
export async function assertBucketPrivate(o: { prefix: string; env?: Record<string, string | undefined>; fetch?: typeof fetch }): Promise<void> {
  const env = o.env ?? process.env;
  const f = o.fetch ?? fetch;
  const bucket = backupBucketFromEnv(env);
  const endpoint = (env.BACKUP_R2_ENDPOINT ?? `https://${env.BACKUP_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
  const key = `${o.prefix.replace(/\/+$/, "")}/privacy-probe-${randomBytes(6).toString("hex")}.txt`;
  await bucket.write(key, "privacy probe: this object must not be readable without credentials", { type: "text/plain" });
  try {
    const urls = [`${endpoint}/${env.BACKUP_R2_BUCKET}/${key}`,
      ...(env.BACKUP_PUBLIC_PROBE_URLS ?? "").split(",").map(x => x.trim().replace(/\/+$/, "")).filter(Boolean).map(b => `${b}/${key}`)];
    for (const url of urls) {
      let status: number;
      try {
        const r = await f(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
        status = r.status;
        await r.arrayBuffer().catch(() => undefined);
      } catch (e) {
        throw new Error(`bucket privacy check failed: an unauthenticated GET of the probe did not answer (${(e as Error).name}); nothing was uploaded`);
      }
      if (status < 400) throw new Error(`the backup bucket is readable without credentials (HTTP ${status} for the probe object): nothing was uploaded`);
    }
  } finally {
    await bucket.delete(key).catch(() => undefined);
  }
}

/** A host as a restore compares it: lower case, loopback names as one. */
export function sameServer(a: { host: string; port: string }, b: { host: string; port: string }): boolean {
  const norm = (h: string) => { const x = h.toLowerCase().replace(/^\[|\]$/g, ""); return ["localhost", "127.0.0.1", "::1"].includes(x) ? "localhost" : x; };
  return norm(a.host) === norm(b.host) && (a.port || "5432") === (b.port || "5432");
}
