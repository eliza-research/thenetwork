// Shared parts of the backup and restore scripts (docs/deploy.md section 8, runbook-real.md section 8).
// A backup is three files under one prefix: db.dump (pg_dump custom format), roles.sql (pg_dumpall
// --roles-only --no-role-passwords) and manifest.json (exact row counts per table, taken in the same
// snapshot as the dump, so a restore can be checked table by table).
import { existsSync } from "node:fs";
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
