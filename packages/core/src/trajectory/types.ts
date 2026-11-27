import type { AppId } from "../types.ts";

export type TrajectoryApp = AppId | "marketing" | "shared";

export type TrajectoryKind =
  | "turn"
  | "llm"
  | "match_run"
  | "review_judge"
  | "outreach"
  | "funnel"
  | "safety"
  | "sim_record";

export type TrajectoryStatus =
  | "ok"
  | "error"
  | "flagged"
  | "leak_blocked"
  | "fallback"
  | "budget_blocked";

export type TrajectoryEntityType =
  | "member"
  | "opportunity"
  | "campaign"
  | "human"
  | "run";

export type TrajectoryStorageDriver = "r2" | "local" | "memory";

export interface TrajectoryMetrics {
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costMicros?: number;
  score?: number;
}

export interface TrajectorySpan {
  schemaVersion: 1;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  app: TrajectoryApp;
  city?: string;
  kind: TrajectoryKind;
  name: string;
  startedAt: number;
  durationMs: number;
  entityType?: TrajectoryEntityType;
  entityId?: string;
  personId?: string;
  isMinor?: boolean;
  status: TrajectoryStatus;
  metrics?: TrajectoryMetrics;
  tags?: Record<string, string | number | boolean>;
  flags?: string[];
  payload?: Record<string, unknown>;
}

export interface StoredTrajectoryRecord extends Omit<TrajectorySpan, "payload" | "personId" | "isMinor"> {
  payloadEnc?: string;
  dekRef?: string;
  payloadPlain?: Record<string, unknown>;
  leakDetected?: boolean;
}

export type DecryptedPayloadState = "decrypted" | "shredded" | "redacted" | "plain" | "empty";

export interface DecryptedTrajectorySpan extends Omit<StoredTrajectoryRecord, "payloadEnc"> {
  payload?: Record<string, unknown>;
  payloadState: DecryptedPayloadState;
}

export interface TrajectoryManifestRow {
  traceId: string;
  appId: TrajectoryApp;
  city: string | null;
  kind: TrajectoryKind;
  entityType: TrajectoryEntityType | null;
  entityId: string | null;
  personId: string | null;
  status: TrajectoryStatus;
  model: string | null;
  spanCount: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  durationMs: number;
  flags: string[];
  storageDriver: TrajectoryStorageDriver;
  objectKey: string;
  byteOffset: number;
  byteLength: number;
  startedAt: number;
}

export interface TrajectoryQuery {
  appId?: TrajectoryApp;
  traceId?: string;
  entityType?: TrajectoryEntityType;
  entityId?: string;
  kind?: TrajectoryKind;
  status?: TrajectoryStatus;
  flag?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

export interface TrajectoryBlobStore {
  readonly kind: TrajectoryStorageDriver;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  list(prefix: string, startAfter?: string): Promise<{ keys: string[]; isTruncated: boolean }>;
  delete(key: string): Promise<void>;
}

export interface TrajectoryManifestStore {
  insertBatch(rows: readonly TrajectoryManifestRow[]): Promise<void>;
  query(filter: TrajectoryQuery): Promise<TrajectoryManifestRow[]>;
  getByTraceId(appId: TrajectoryApp, traceId: string): Promise<TrajectoryManifestRow | undefined>;
  clearPerson?(personId: string): Promise<void>;
}

export interface DekSubject {
  personId?: string;
  isMinor?: boolean;
  dayKey: string;
}

export type DekResolution = { dekRef: string; key: Buffer } | "redacted";

export interface TrajectoryKeyRing {
  getOrCreateDek(subject: DekSubject): Promise<DekResolution>;
  resolveDek(dekRef: string): Promise<Buffer | undefined>;
  shredPerson(personId: string): Promise<void>;
}
