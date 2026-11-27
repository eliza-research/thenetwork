import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { ObjectStore } from "../runtime/object-store.ts";
import type { SQL } from "../runtime/postgres.ts";
import type {
  TrajectoryApp,
  TrajectoryBlobStore,
  TrajectoryEntityType,
  TrajectoryKind,
  TrajectoryManifestRow,
  TrajectoryManifestStore,
  TrajectoryQuery,
  TrajectoryStatus,
  TrajectoryStorageDriver,
} from "./types.ts";

const isNotFound = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "NoSuchKey" ||
    (error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404);

const safeKey = (key: string): string => {
  const normalized = key.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error(`invalid trajectory key: ${key}`);
  }
  return normalized;
};

export interface R2TrajectoryConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class R2TrajectoryBlobStore implements TrajectoryBlobStore {
  readonly kind = "r2" as const;
  private readonly store: ObjectStore;

  constructor(config: R2TrajectoryConfig) {
    this.store = new ObjectStore({
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: "auto",
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.store.write(safeKey(key), bytes, { type: contentType });
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const buffer = await this.store.file(safeKey(key)).arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async list(prefix: string, startAfter?: string): Promise<{ keys: string[]; isTruncated: boolean }> {
    const result = await this.store.list({ prefix, startAfter });
    return {
      keys: result.contents.map(item => item.key),
      isTruncated: result.isTruncated,
    };
  }

  async delete(key: string): Promise<void> {
    await this.store.delete(safeKey(key));
  }
}

export class LocalFsTrajectoryBlobStore implements TrajectoryBlobStore {
  readonly kind = "local" as const;
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private pathFor(key: string): string {
    const clean = safeKey(key);
    const target = resolve(this.root, clean);
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) {
      throw new Error(`trajectory key escapes root: ${key}`);
    }
    return target;
  }

  async put(key: string, bytes: Uint8Array, _contentType?: string): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600 });
    await chmod(target, 0o600);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async list(prefix: string, startAfter?: string): Promise<{ keys: string[]; isTruncated: boolean }> {
    const keys: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), nextRel);
        } else if (entry.isFile()) {
          if (nextRel.startsWith(prefix) && (!startAfter || nextRel > startAfter)) {
            keys.push(nextRel);
          }
        }
      }
    };
    await walk(this.root, "");
    keys.sort();
    return { keys, isTruncated: false };
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export class MemoryTrajectoryBlobStore implements TrajectoryBlobStore {
  readonly kind = "memory" as const;
  private readonly objects = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array, _contentType?: string): Promise<void> {
    this.objects.set(safeKey(key), bytes.slice());
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const found = this.objects.get(safeKey(key));
    return found ? found.slice() : undefined;
  }

  async list(prefix: string, startAfter?: string): Promise<{ keys: string[]; isTruncated: boolean }> {
    const keys = [...this.objects.keys()]
      .filter(k => k.startsWith(prefix) && (!startAfter || k > startAfter))
      .sort();
    return { keys, isTruncated: false };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(safeKey(key));
  }

  size(): number {
    return this.objects.size;
  }
}

export function trajectoryBlobStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
): TrajectoryBlobStore {
  const mode = env.TRAJECTORY_STORAGE ?? (env.PLATFORM_ENV === "dev" || !env.PLATFORM_ENV ? "local" : "r2");
  if (mode === "r2") {
    const endpoint =
      env.TRAJECTORY_R2_ENDPOINT ??
      (env.TRAJECTORY_R2_ACCOUNT_ID
        ? `https://${env.TRAJECTORY_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : undefined);
    const bucket = env.TRAJECTORY_R2_BUCKET;
    const accessKeyId = env.TRAJECTORY_R2_ACCESS_KEY_ID;
    const secretAccessKey = env.TRAJECTORY_R2_SECRET_ACCESS_KEY;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "TRAJECTORY_STORAGE=r2 requires TRAJECTORY_R2_ENDPOINT (or TRAJECTORY_R2_ACCOUNT_ID), TRAJECTORY_R2_BUCKET, TRAJECTORY_R2_ACCESS_KEY_ID, and TRAJECTORY_R2_SECRET_ACCESS_KEY",
      );
    }
    if (env.R2_BUCKET && bucket === env.R2_BUCKET) {
      throw new Error("TRAJECTORY_R2_BUCKET must not reuse R2_BUCKET");
    }
    if (env.BACKUP_R2_BUCKET && bucket === env.BACKUP_R2_BUCKET) {
      throw new Error("TRAJECTORY_R2_BUCKET must not reuse BACKUP_R2_BUCKET");
    }
    return new R2TrajectoryBlobStore({ endpoint, bucket, accessKeyId, secretAccessKey });
  }
  if (mode === "memory") {
    return new MemoryTrajectoryBlobStore();
  }
  if (env.PLATFORM_ENV && env.PLATFORM_ENV !== "dev") {
    throw new Error("TRAJECTORY_STORAGE=local is allowed only when PLATFORM_ENV=dev");
  }
  return new LocalFsTrajectoryBlobStore(env.TRAJECTORY_DIR ?? "runs/trajectories");
}

export class MemoryTrajectoryManifestStore implements TrajectoryManifestStore {
  private readonly rows: TrajectoryManifestRow[] = [];

  async insertBatch(batch: readonly TrajectoryManifestRow[]): Promise<void> {
    for (const row of batch) {
      const idx = this.rows.findIndex(r => r.appId === row.appId && r.traceId === row.traceId && r.objectKey === row.objectKey);
      if (idx >= 0) this.rows[idx] = { ...row, flags: [...row.flags] };
      else this.rows.push({ ...row, flags: [...row.flags] });
    }
  }

  async query(filter: TrajectoryQuery): Promise<TrajectoryManifestRow[]> {
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
    return this.rows
      .filter(r => {
        if (filter.appId && r.appId !== filter.appId) return false;
        if (filter.traceId && r.traceId !== filter.traceId) return false;
        if (filter.entityType && r.entityType !== filter.entityType) return false;
        if (filter.entityId && r.entityId !== filter.entityId) return false;
        if (filter.kind && r.kind !== filter.kind) return false;
        if (filter.status && r.status !== filter.status) return false;
        if (filter.flag && !r.flags.includes(filter.flag)) return false;
        if (filter.fromMs !== undefined && r.startedAt < filter.fromMs) return false;
        if (filter.toMs !== undefined && r.startedAt > filter.toMs) return false;
        return true;
      })
      .sort((a, b) => b.startedAt - a.startedAt || a.traceId.localeCompare(b.traceId))
      .slice(0, limit);
  }

  async getByTraceId(appId: TrajectoryApp, traceId: string): Promise<TrajectoryManifestRow | undefined> {
    const matches = await this.query({ appId, traceId, limit: 1 });
    return matches[0];
  }

  async clearPerson(personId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.personId === personId) row.personId = null;
    }
  }
}

interface PgManifestDbRow {
  trace_id: string;
  app_id: string;
  city: string | null;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  person_id: string | null;
  status: string;
  model: string | null;
  span_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: string | number;
  duration_ms: number;
  flags: string[];
  storage_driver: string;
  object_key: string;
  byte_offset: string | number;
  byte_length: number;
  started_at: Date | string;
}

const fromDbRow = (r: PgManifestDbRow): TrajectoryManifestRow => ({
  traceId: r.trace_id,
  appId: r.app_id as TrajectoryApp,
  city: r.city,
  kind: r.kind as TrajectoryKind,
  entityType: r.entity_type as TrajectoryEntityType | null,
  entityId: r.entity_id,
  personId: r.person_id,
  status: r.status as TrajectoryStatus,
  model: r.model,
  spanCount: Number(r.span_count),
  inputTokens: Number(r.input_tokens),
  outputTokens: Number(r.output_tokens),
  costMicros: Number(r.cost_micros),
  durationMs: Number(r.duration_ms),
  flags: Array.isArray(r.flags) ? r.flags : [],
  storageDriver: r.storage_driver as TrajectoryStorageDriver,
  objectKey: r.object_key,
  byteOffset: Number(r.byte_offset),
  byteLength: Number(r.byte_length),
  startedAt: new Date(r.started_at).getTime(),
});

export class PgTrajectoryManifestStore implements TrajectoryManifestStore {
  private readonly sql: SQL;

  constructor(sql: SQL) {
    this.sql = sql;
  }

  async insertBatch(rows: readonly TrajectoryManifestRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.sql.begin(async tx => {
      for (const row of rows) {
        await tx`insert into analytics.trajectory_manifests (
            trace_id, app_id, city, kind, entity_type, entity_id, person_id, status, model,
            span_count, input_tokens, output_tokens, cost_micros, duration_ms, flags,
            storage_driver, object_key, byte_offset, byte_length, started_at
          ) values (
            ${row.traceId}, ${row.appId}, ${row.city}, ${row.kind}, ${row.entityType}, ${row.entityId},
            ${row.personId}, ${row.status}, ${row.model}, ${row.spanCount}, ${row.inputTokens},
            ${row.outputTokens}, ${row.costMicros}, ${row.durationMs}, ${tx.array(row.flags, "TEXT")},
            ${row.storageDriver}, ${row.objectKey}, ${row.byteOffset}, ${row.byteLength}, ${new Date(row.startedAt)}
          )
          on conflict (app_id, trace_id, object_key) do update set
            status = excluded.status,
            span_count = excluded.span_count,
            input_tokens = excluded.input_tokens,
            output_tokens = excluded.output_tokens,
            cost_micros = excluded.cost_micros,
            duration_ms = excluded.duration_ms,
            flags = excluded.flags,
            byte_offset = excluded.byte_offset,
            byte_length = excluded.byte_length`;
      }
    });
  }

  async query(filter: TrajectoryQuery): Promise<TrajectoryManifestRow[]> {
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      clauses.push(clause.replace("$?", `$${params.length}`));
    };
    if (filter.appId) add("app_id = $?", filter.appId);
    if (filter.traceId) add("trace_id = $?", filter.traceId);
    if (filter.entityType) add("entity_type = $?", filter.entityType);
    if (filter.entityId) add("entity_id = $?", filter.entityId);
    if (filter.kind) add("kind = $?", filter.kind);
    if (filter.status) add("status = $?", filter.status);
    if (filter.flag) add("$? = any(flags)", filter.flag);
    if (filter.fromMs !== undefined) add("started_at >= $?", new Date(filter.fromMs));
    if (filter.toMs !== undefined) add("started_at <= $?", new Date(filter.toMs));
    params.push(limit);
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const rows = (await this.sql.unsafe(
      `select trace_id, app_id, city, kind, entity_type, entity_id, person_id::text, status, model,
              span_count, input_tokens, output_tokens, cost_micros, duration_ms, flags,
              storage_driver, object_key, byte_offset, byte_length, started_at
         from analytics.trajectory_manifests
         ${where}
         order by started_at desc, trace_id asc
         limit $${params.length}`,
      params as never[],
    )) as PgManifestDbRow[];
    return rows.map(fromDbRow);
  }

  async getByTraceId(appId: TrajectoryApp, traceId: string): Promise<TrajectoryManifestRow | undefined> {
    const rows = await this.query({ appId, traceId, limit: 1 });
    return rows[0];
  }

  async clearPerson(personId: string): Promise<void> {
    await this.sql`update analytics.trajectory_manifests set person_id = null where person_id = ${personId}::uuid`;
  }
}
