import { promisify } from "node:util";
import { constants as zlibConstants, zstdCompress, zstdDecompress } from "node:zlib";
import type { Clock } from "../clock.ts";
import { findLeaks } from "../guard.ts";
import { maskPii } from "../pii.ts";
import { decryptTrajectoryPayload, encryptTrajectoryPayload } from "./keyring.ts";
import type {
  DecryptedTrajectorySpan,
  StoredTrajectoryRecord,
  TrajectoryApp,
  TrajectoryBlobStore,
  TrajectoryKeyRing,
  TrajectoryManifestRow,
  TrajectoryManifestStore,
  TrajectorySpan,
  TrajectoryStatus,
} from "./types.ts";

const compressZstd = promisify(zstdCompress);
const decompressZstd = promisify(zstdDecompress);

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "phone",
  "e164",
  "email",
  "birth_date",
  "birthdate",
  "ssn",
]);

const STATUS_SEVERITY: Record<TrajectoryStatus, number> = {
  ok: 0,
  fallback: 1,
  budget_blocked: 2,
  flagged: 3,
  leak_blocked: 4,
  error: 5,
};

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 48) || "worker";
}

function utcDayAndHour(ms: number): { day: string; hour: string } {
  const iso = new Date(ms).toISOString();
  return { day: iso.slice(0, 10), hour: iso.slice(11, 13) };
}

export function scrubTrajectoryValue(value: unknown, depth = 0): { value: unknown; leakDetected: boolean } {
  if (depth > 8) return { value: "[truncated]", leakDetected: false };
  if (typeof value === "string") {
    const leaks = findLeaks(value);
    const masked = maskPii(value);
    return { value: masked, leakDetected: leaks.length > 0 };
  }
  if (Array.isArray(value)) {
    let leakDetected = false;
    const out = value.map(item => {
      const cleaned = scrubTrajectoryValue(item, depth + 1);
      if (cleaned.leakDetected) leakDetected = true;
      return cleaned.value;
    });
    return { value: out, leakDetected };
  }
  if (value !== null && typeof value === "object") {
    let leakDetected = false;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = "[redacted]";
        leakDetected = true;
        continue;
      }
      const cleaned = scrubTrajectoryValue(entry, depth + 1);
      if (cleaned.leakDetected) leakDetected = true;
      out[key] = cleaned.value;
    }
    return { value: out, leakDetected };
  }
  return { value, leakDetected: false };
}

export interface BufferedTrajectoryWriterOptions {
  blobStore: TrajectoryBlobStore;
  manifestStore?: TrajectoryManifestStore;
  keyRing?: TrajectoryKeyRing;
  clock: Clock;
  workerId: string;
  flushIntervalMs?: number;
  maxBatchSpans?: number;
  maxBatchBytes?: number;
  ringCapacity?: number;
  compressionLevel?: number;
  allowPlaintextDev?: boolean;
  onError?: (err: Error) => void;
}

export interface HotTailFilter {
  app?: TrajectoryApp;
  traceId?: string;
  entityId?: string;
  kind?: TrajectorySpan["kind"];
  status?: TrajectoryStatus;
  limit?: number;
}

export interface FlushResult {
  chunksWritten: number;
  spansWritten: number;
  objectKeys: string[];
}

export class BufferedTrajectoryWriter {
  private readonly blobStore: TrajectoryBlobStore;
  private readonly manifestStore?: TrajectoryManifestStore;
  private readonly keyRing?: TrajectoryKeyRing;
  private readonly clock: Clock;
  private readonly workerId: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSpans: number;
  private readonly maxBatchBytes: number;
  private readonly ringCapacity: number;
  private readonly compressionLevel: number;
  private readonly allowPlaintextDev: boolean;
  private readonly onError?: (err: Error) => void;

  private pending: TrajectorySpan[] = [];
  private pendingBytes = 0;
  private readonly hotRing: { span: TrajectorySpan; personId?: string }[] = [];
  private readonly shreddedPeople = new Set<string>();
  private chunkSeq = 0;
  private flushTimer?: ReturnType<typeof setInterval>;
  private activeFlush: Promise<FlushResult> | null = null;
  private closed = false;

  constructor(options: BufferedTrajectoryWriterOptions) {
    this.blobStore = options.blobStore;
    this.manifestStore = options.manifestStore;
    this.keyRing = options.keyRing;
    this.clock = options.clock;
    this.workerId = sanitizeSegment(options.workerId);
    this.flushIntervalMs = Math.max(0, options.flushIntervalMs ?? 5_000);
    this.maxBatchSpans = Math.max(1, options.maxBatchSpans ?? 500);
    this.maxBatchBytes = Math.max(1024, options.maxBatchBytes ?? 2 * 1024 * 1024);
    this.ringCapacity = Math.max(16, options.ringCapacity ?? 2_000);
    this.compressionLevel = Math.max(1, Math.min(19, options.compressionLevel ?? 3));
    this.allowPlaintextDev = options.allowPlaintextDev ?? false;
    this.onError = options.onError;

    if (this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        if (this.pending.length > 0 && !this.activeFlush) {
          void this.flush().catch(err => this.onError?.(err as Error));
        }
      }, this.flushIntervalMs);
      if (typeof this.flushTimer.unref === "function") {
        this.flushTimer.unref();
      }
    }
  }

  record(span: TrajectorySpan): void {
    if (this.closed) return;
    const startedAt = Number.isFinite(span.startedAt) ? span.startedAt : this.clock.now();
    const isShredded = Boolean(span.personId && this.shreddedPeople.has(span.personId));
    const redactAll = Boolean(span.isMinor || isShredded);

    let scrubbedPayload: Record<string, unknown> | undefined;
    let leakDetected = false;
    if (!redactAll && span.payload) {
      const cleaned = scrubTrajectoryValue(span.payload);
      scrubbedPayload = cleaned.value as Record<string, unknown>;
      leakDetected = cleaned.leakDetected;
    }

    const mergedFlags = new Set<string>(span.flags ?? []);
    if (leakDetected) mergedFlags.add("pii_masked");
    if (span.isMinor) mergedFlags.add("minor_redacted");
    if (isShredded) mergedFlags.add("shredded");
    const flags = mergedFlags.size > 0 ? [...mergedFlags].sort() : undefined;

    const { payload: _rawPayload, personId: rawPersonId, ...safeBase } = span;
    const hotSpan: TrajectorySpan = {
      ...safeBase,
      startedAt,
      ...(flags ? { flags } : {}),
      ...(scrubbedPayload ? { payload: scrubbedPayload } : {}),
    };
    const pendingSpan: TrajectorySpan = {
      ...hotSpan,
      ...(!redactAll && rawPersonId ? { personId: rawPersonId } : {}),
    };

    this.hotRing.push({ span: hotSpan, personId: redactAll ? undefined : rawPersonId });
    if (this.hotRing.length > this.ringCapacity) {
      this.hotRing.splice(0, this.hotRing.length - this.ringCapacity);
    }
    this.pending.push(pendingSpan);
    this.pendingBytes += 256 + (scrubbedPayload ? JSON.stringify(scrubbedPayload).length : 0);

    if (this.pending.length >= this.maxBatchSpans || this.pendingBytes >= this.maxBatchBytes) {
      void this.flush().catch(err => this.onError?.(err as Error));
    }
  }

  async shredPerson(personId: string): Promise<void> {
    this.shreddedPeople.add(personId);
    for (let i = 0; i < this.hotRing.length; i++) {
      const entry = this.hotRing[i]!;
      if (entry.personId !== personId) continue;
      const { payload: _p, personId: _pid, ...rest } = entry.span;
      const flags = [...new Set([...(rest.flags ?? []), "shredded"])].sort();
      this.hotRing[i] = { span: { ...rest, flags }, personId: undefined };
    }
    for (let i = 0; i < this.pending.length; i++) {
      const item = this.pending[i]!;
      if (item.personId !== personId) continue;
      const { payload: _p, personId: _pid, ...rest } = item;
      const flags = [...new Set([...(rest.flags ?? []), "shredded"])].sort();
      this.pending[i] = { ...rest, flags };
    }
    if (this.keyRing) await this.keyRing.shredPerson(personId);
    if (this.manifestStore?.clearPerson) await this.manifestStore.clearPerson(personId);
  }

  pendingCount(): number {
    return this.pending.length;
  }

  tailHot(filter: HotTailFilter = {}): TrajectorySpan[] {
    const limit = Math.max(1, Math.min(filter.limit ?? 100, this.ringCapacity));
    const matches: TrajectorySpan[] = [];
    for (let i = this.hotRing.length - 1; i >= 0 && matches.length < limit; i--) {
      const span = this.hotRing[i]!.span;
      if (filter.app && span.app !== filter.app) continue;
      if (filter.traceId && span.traceId !== filter.traceId) continue;
      if (filter.entityId && span.entityId !== filter.entityId) continue;
      if (filter.kind && span.kind !== filter.kind) continue;
      if (filter.status && span.status !== filter.status) continue;
      matches.push(span);
    }
    return matches;
  }

  async flush(): Promise<FlushResult> {
    if (this.activeFlush) {
      await this.activeFlush;
    }
    if (this.pending.length === 0) {
      return { chunksWritten: 0, spansWritten: 0, objectKeys: [] };
    }
    const batch = this.pending;
    this.pending = [];
    this.pendingBytes = 0;

    const run = this.writeBatch(batch);
    this.activeFlush = run;
    try {
      return await run;
    } finally {
      this.activeFlush = null;
    }
  }

  private async writeBatch(batch: TrajectorySpan[]): Promise<FlushResult> {
    const byApp = new Map<TrajectoryApp, TrajectorySpan[]>();
    for (const span of batch) {
      const list = byApp.get(span.app) ?? [];
      list.push(span);
      byApp.set(span.app, list);
    }

    const objectKeys: string[] = [];
    const manifestRows: TrajectoryManifestRow[] = [];
    let spansWritten = 0;

    for (const [appId, appSpans] of byApp) {
      appSpans.sort((a, b) => a.traceId.localeCompare(b.traceId) || a.startedAt - b.startedAt);
      const flushTs = this.clock.now();
      const { day, hour } = utcDayAndHour(flushTs);
      const seq = ++this.chunkSeq;
      const objectKey = `trajectories/raw/app=${appId}/dt=${day}/hr=${hour}/${this.workerId}-${flushTs}-${seq}.ndjson.zst`;

      const lineBuffers: Buffer[] = [];
      let currentOffset = 0;

      interface TraceAcc {
        first: TrajectorySpan;
        personId: string | null;
        status: TrajectoryStatus;
        model: string | null;
        spanCount: number;
        inputTokens: number;
        outputTokens: number;
        costMicros: number;
        minStart: number;
        maxEnd: number;
        flags: Set<string>;
        byteOffset: number;
        byteLength: number;
      }

      const traceAccs = new Map<string, TraceAcc>();

      for (const span of appSpans) {
        const stored = await this.encodeSpan(span, day);
        const line = Buffer.from(`${JSON.stringify(stored)}\n`, "utf8");
        const startOffset = currentOffset;
        currentOffset += line.length;
        lineBuffers.push(line);

        let acc = traceAccs.get(span.traceId);
        if (!acc) {
          acc = {
            first: span,
            personId: span.isMinor ? null : (span.personId ?? null),
            status: span.status,
            model: span.metrics?.model ?? null,
            spanCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            costMicros: 0,
            minStart: span.startedAt,
            maxEnd: span.startedAt + span.durationMs,
            flags: new Set<string>(),
            byteOffset: startOffset,
            byteLength: 0,
          };
          traceAccs.set(span.traceId, acc);
        }
        acc.spanCount += 1;
        acc.byteLength = currentOffset - acc.byteOffset;
        if (STATUS_SEVERITY[span.status] > STATUS_SEVERITY[acc.status]) acc.status = span.status;
        if (!acc.model && span.metrics?.model) acc.model = span.metrics.model;
        acc.inputTokens += span.metrics?.inputTokens ?? 0;
        acc.outputTokens += span.metrics?.outputTokens ?? 0;
        acc.costMicros += span.metrics?.costMicros ?? 0;
        if (span.startedAt < acc.minStart) acc.minStart = span.startedAt;
        if (span.startedAt + span.durationMs > acc.maxEnd) acc.maxEnd = span.startedAt + span.durationMs;
        for (const f of span.flags ?? []) acc.flags.add(f);
        if (stored.leakDetected) acc.flags.add("pii_masked");
        if (span.isMinor) acc.flags.add("minor_redacted");
      }

      const rawChunk = Buffer.concat(lineBuffers);
      const compressed = await compressZstd(rawChunk, {
        params: { [zlibConstants.ZSTD_c_compressionLevel]: this.compressionLevel },
      });
      await this.blobStore.put(objectKey, new Uint8Array(compressed), "application/zstd");
      objectKeys.push(objectKey);
      spansWritten += appSpans.length;

      for (const [traceId, acc] of traceAccs) {
        manifestRows.push({
          traceId,
          appId,
          city: acc.first.city ?? null,
          kind: acc.first.kind,
          entityType: acc.first.entityType ?? null,
          entityId: acc.first.entityId ?? null,
          personId: acc.personId,
          status: acc.status,
          model: acc.model,
          spanCount: acc.spanCount,
          inputTokens: acc.inputTokens,
          outputTokens: acc.outputTokens,
          costMicros: acc.costMicros,
          durationMs: Math.max(0, acc.maxEnd - acc.minStart),
          flags: [...acc.flags].sort(),
          storageDriver: this.blobStore.kind,
          objectKey,
          byteOffset: acc.byteOffset,
          byteLength: acc.byteLength,
          startedAt: acc.minStart,
        });
      }
    }

    if (this.manifestStore && manifestRows.length > 0) {
      await this.manifestStore.insertBatch(manifestRows);
    }

    return { chunksWritten: objectKeys.length, spansWritten, objectKeys };
  }

  private async encodeSpan(span: TrajectorySpan, dayKey: string): Promise<StoredTrajectoryRecord> {
    const { payload, personId, isMinor, ...rest } = span;
    const base: StoredTrajectoryRecord = { ...rest };
    if (isMinor) {
      base.dekRef = "redacted";
      return base;
    }
    if (!payload) return base;

    const scrubbed = scrubTrajectoryValue(payload);
    const cleanedPayload = scrubbed.value as Record<string, unknown>;
    if (scrubbed.leakDetected) base.leakDetected = true;

    if (this.keyRing) {
      const dek = await this.keyRing.getOrCreateDek({ personId, isMinor, dayKey });
      if (dek === "redacted") {
        base.dekRef = "redacted";
        return base;
      }
      base.dekRef = dek.dekRef;
      base.payloadEnc = encryptTrajectoryPayload(cleanedPayload, dek.key, dek.dekRef);
      return base;
    }

    if (this.allowPlaintextDev) {
      base.payloadPlain = cleanedPayload;
      return base;
    }

    base.dekRef = "redacted";
    return base;
  }

  async readTrace(
    appId: TrajectoryApp,
    traceId: string,
    options: { decrypt?: boolean; objectKey?: string; byteOffset?: number; byteLength?: number } = {},
  ): Promise<DecryptedTrajectorySpan[]> {
    let objectKey = options.objectKey;
    let byteOffset = options.byteOffset;
    let byteLength = options.byteLength;

    if (!objectKey && this.manifestStore) {
      const manifest = await this.manifestStore.getByTraceId(appId, traceId);
      if (manifest) {
        objectKey = manifest.objectKey;
        byteOffset = manifest.byteOffset;
        byteLength = manifest.byteLength;
      }
    }

    if (!objectKey) return [];
    const compressed = await this.blobStore.get(objectKey);
    if (!compressed) return [];

    const raw = Buffer.from(await decompressZstd(compressed));
    const slice =
      byteOffset !== undefined && byteLength !== undefined && byteLength > 0 && byteOffset + byteLength <= raw.length
        ? raw.subarray(byteOffset, byteOffset + byteLength)
        : raw;

    const lines = slice.toString("utf8").split("\n").filter(line => line.trim().length > 0);
    const results: DecryptedTrajectorySpan[] = [];

    for (const line of lines) {
      const rec = JSON.parse(line) as StoredTrajectoryRecord;
      if (rec.traceId !== traceId) continue;
      const { payloadEnc, ...meta } = rec;
      if (rec.dekRef === "redacted") {
        results.push({ ...meta, payloadState: "redacted" });
        continue;
      }
      if (rec.payloadPlain !== undefined) {
        results.push({ ...meta, payload: rec.payloadPlain, payloadState: "plain" });
        continue;
      }
      if (!payloadEnc) {
        results.push({ ...meta, payloadState: "empty" });
        continue;
      }
      if (!options.decrypt || !this.keyRing || !rec.dekRef) {
        results.push({ ...meta, payloadState: "redacted" });
        continue;
      }
      const key = await this.keyRing.resolveDek(rec.dekRef);
      if (!key) {
        results.push({ ...meta, payloadState: "shredded" });
        continue;
      }
      const decrypted = decryptTrajectoryPayload(payloadEnc, key, rec.dekRef);
      results.push({ ...meta, payload: decrypted, payloadState: "decrypted" });
    }

    return results;
  }

  async shutdown(): Promise<FlushResult> {
    this.closed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    return this.flush();
  }
}
