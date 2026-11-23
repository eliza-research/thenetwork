import { setTimeout as waitForMs } from "node:timers/promises";
import { fileAt } from "../../core/src/runtime/files.ts";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ObjectStore } from "../../core/src/runtime/object-store.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { ratingMaxBytes, ratingMaxPhotos, uploadMaxBytes, uploadMaxPerPerson, photoSlotsFull } from "../../core/src/generated/photoPolicy.ts";
import {
  canCheckReturnedScore, canCheckWrittenScore, canRecordScoreRemoval, canRecordScoreWrite, canReceiveScore, canSupplyPhotos,
  initial as ratingInitial, ratingPhotoSelectionCurrent, step as stepRating,
} from "../../core/src/generated/photoRating.ts";
import {
  canCheckSlots, canCleanImage, canFinishRerate, canRecordRatingClear, canRecordRemovedBytes, canRecordRemovedRow,
  canRecordUploadBytes, canRecordUploadDiscard, canRecordUploadRow, canReserveRow, canScreenFile,
  initial as photoChangeInitial, photoHoldAllowed, ratingHoldAllowed, type PhotoChange, step as stepPhotoChange, unfinishedPhotoDue,
} from "../../core/src/generated/photoRetention.ts";
import { canBeMatched } from "../../core/src/policy.ts";
import { effectiveAgeAt } from "./age.ts";
import { ageStandingOf, PgPeopleStore } from "./pg-store.ts";
import type { AppId } from "./apps.ts";
import { readCapped } from "./body.ts";
import type { MembershipState, PeopleStore } from "./store.ts";
import type { AppearanceRater, AppearanceScore, RatingSubject } from "../../engine/src/packs/slop/appearance.ts";
import { makeClefRaterFromEnv, type ClefRaterOptions } from "../../engine/src/packs/slop/clef.ts";
import { DEFAULT_CLEF_WEIGHTS, validateClefWeights, type ClefWeights } from "../../engine/src/packs/slop/clefWeights.ts";
import { isOpaquePhotoId } from "../../engine/src/relay.ts";

export type RaterStatus = "on" | "on_placeholder" | "off_env" | "refused_weights";

export async function photoRaterFromEnv(
  env: Record<string, string | undefined>,
  o: { fetch?: ClefRaterOptions["fetch"]; sleep?: (ms: number) => Promise<void>; log?: (s: string) => void; readFile?: (path: string) => Promise<string> } = {},
): Promise<{ rater?: AppearanceRater; status: RaterStatus; weights?: string; detail?: string }> {
  if (!env.CLOUDFLARE_AI_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return { status: "off_env", detail: "CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID are required" };
  let w: ClefWeights = DEFAULT_CLEF_WEIGHTS;
  if (env.CLEF_WEIGHTS_PATH) {
    try {
      const raw = JSON.parse(await (o.readFile ?? (p => fileAt(p).text()))(env.CLEF_WEIGHTS_PATH)) as ClefWeights & { provenance?: unknown };
      if (typeof raw.version !== "string" || !raw.version.trim()) return { status: "refused_weights", detail: "the weights file has no version" };
      const prov = raw.provenance as { fitter?: unknown; fittedAt?: unknown } | undefined;
      if (raw.placeholder !== false || !prov || typeof prov !== "object" || typeof prov.fitter !== "string" || typeof prov.fittedAt !== "string")
        return { status: "refused_weights", detail: `weights ${raw.version} carry no provenance (fitter, fittedAt) or are a placeholder` };
      w = validateClefWeights(raw);
    } catch (e) { return { status: "refused_weights", detail: (e as Error).message }; }
  }
  const rater = withRetry(makeClefRaterFromEnv(env, { weights: w, ...(o.fetch ? { fetch: o.fetch } : {}) }), { attempts: 3, ...(o.sleep ? { sleep: o.sleep } : {}), ...(o.log ? { log: o.log } : {}) });
  return env.CLEF_WEIGHTS_PATH
    ? { rater, status: "on", weights: w.version }
    : { rater, status: "on_placeholder", weights: w.version, detail: "placeholder Clef weights (no CLEF_WEIGHTS_PATH): they ship until fitted weights pass the P2 decision rule" };
}

export type PhotoType = "image/jpeg" | "image/png" | "image/webp";
export const PHOTO_TYPES: readonly PhotoType[] = ["image/jpeg", "image/png", "image/webp"];
export const PHOTO_APPS: readonly AppId[] = ["slop"];
export const PHOTO_MAX_BYTES = uploadMaxBytes;
export const PHOTO_MAX_PER_PERSON = uploadMaxPerPerson;
export const PHOTO_VIEW_TTL_MS = 5 * 60_000;
export const PHOTO_CONSENT = {
  version: "2026-11-22",
  text: "I agree that slop.date may store these photos privately. The matchmaker may use them, privately, to learn who I might like and who might like me. No other member sees them unless I ask the agent to send one to a match, no score from them is ever shown to anyone, and a person on the safety team looks at them only after a report. Photos are for adults (18+) only. I can delete them and their rating by texting DELETE PHOTOS, except after a ban, when the safety team keeps them.",
} as const;

export function newPhotoBatchId(): string { return randomBytes(16).toString("hex"); }
export const PHOTO_LABEL = /^[a-z0-9]+([ -][a-z0-9]+){0,2}$/;
export const PHOTO_LABEL_MAX = 24;

export function newPhotoId(): string {
  for (;;) {
    const id = `ph_${randomBytes(12).toString("hex")}`;
    if (isOpaquePhotoId(id)) return id;
  }
}

export interface PhotoRow {
  id: string; personId: string; app: AppId; storageKey: string; contentType: PhotoType; bytes: number; sha256: string;
  consentVersion: string; createdAt: number; label: string | null; batchId: string | null;
}
export type PhotoLabelResult = "ok" | "taken" | "not_found";
export type PhotoRater = AppearanceRater;
export const RATER_MAX_PHOTOS = ratingMaxPhotos;
export const RATER_MAX_BYTES = ratingMaxBytes;

export function retryable(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  return e instanceof TypeError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
}

export interface RetryOptions { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void>; log?: (s: string) => void }
const retried = new WeakMap<AppearanceRater, { inner: AppearanceRater; options: RetryOptions }>();
export const retryParts = (r: AppearanceRater) => retried.get(r);

export function withRetry(r: AppearanceRater, o: RetryOptions = {}): AppearanceRater {
  const attempts = Math.max(1, o.attempts ?? 3), base = o.baseMs ?? 500, sleep = o.sleep ?? (ms => waitForMs(ms));
  const wrapped: AppearanceRater = {
    id: r.id,
    async rate(subject, photos) {
      for (let i = 1; ; i++) {
        try { return await r.rate(subject, photos); } catch (e) {
          if (i >= attempts || !retryable(e)) throw e;
          o.log?.(`[photos] rater error (try ${i} of ${attempts}): ${(e as Error).message}`);
          await sleep(base * 2 ** (i - 1));
        }
      }
    },
  };
  retried.set(wrapped, { inner: r, options: o });
  return wrapped;
}

export function sniffType(b: Uint8Array): PhotoType | undefined {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  return undefined;
}
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

export class BadImage extends Error {}

export function stripMetadata(b: Uint8Array, type: PhotoType): Uint8Array {
  if (type === "image/jpeg") return stripJpeg(b);
  if (type === "image/png") return stripPng(b);
  return stripWebp(b);
}

const JPEG_KEEP = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf, 0xc4, 0xcc, 0xdb, 0xdc, 0xdd]);

function stripJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2, scanned = false, jfif = false;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new BadImage("jpeg: marker expected");
    const m = b[i + 1]!;
    if (m === 0xd9) { out.push(b.subarray(i, i + 2)); return concat(out); }
    if (m === 0xda) {
      if (i + 4 > b.length) throw new BadImage("jpeg: truncated");
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (len < 2 || i + 2 + len > b.length) throw new BadImage("jpeg: bad segment");
      let j = i + 2 + len;
      while (j < b.length) {
        if (b[j] !== 0xff) { j++; continue; }
        const n = b[j + 1];
        if (n === undefined) { j++; break; }
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { j += 2; continue; }
        if (n === 0xff) { j++; continue; }
        break;
      }
      out.push(b.subarray(i, Math.min(j, b.length)));
      i = j; scanned = true;
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (m === 0xff) { i += 1; continue; }
    if (i + 4 > b.length) throw new BadImage("jpeg: truncated");
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) throw new BadImage("jpeg: bad segment");
    const payload = b.subarray(i + 4, i + 2 + len);
    if (JPEG_KEEP.has(m)) out.push(b.subarray(i, i + 2 + len));
    else if (m === 0xe0 && !jfif && payload.length >= 14 && ascii(payload, 0, 5) === "JFIF\0") {
      out.push(Uint8Array.of(0xff, 0xe0, 0x00, 0x10), payload.subarray(0, 12), Uint8Array.of(0, 0));
      jfif = true;
    } else if (m === 0xee && payload.length === 12 && ascii(payload, 0, 5) === "Adobe") out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  if (scanned) { out.push(Uint8Array.of(0xff, 0xd9)); return concat(out); }
  throw new BadImage("jpeg: no image data");
}

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "sRGB"]);
function stripPng(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8, end = false, first = true;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
    const type = ascii(b, i + 4, 4);
    if (i + 12 + len > b.length) throw new BadImage("png: bad chunk");
    if (first && type !== "IHDR") throw new BadImage("png: IHDR must come first");
    first = false;
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, i + 12 + len));
    i += 12 + len;
    if (type === "IEND") { end = true; break; }
  }
  if (!end) throw new BadImage("png: no IEND");
  return concat(out);
}

const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
const WEBP_FRAME_KEEP = new Set(["ALPH", "VP8 ", "VP8L"]);
function riffChunks(b: Uint8Array, at: number, end: number, keep: Set<string>): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let i = at;
  while (i + 8 <= end) {
    const type = ascii(b, i, 4);
    const len = b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | ((b[i + 7]! << 24) >>> 0);
    const padded = len + (len & 1);
    if (i + 8 + len > end) throw new BadImage("webp: bad chunk");
    if (keep.has(type)) {
      if (type === "ANMF") {
        if (len < 16) throw new BadImage("webp: bad frame");
        const inner = concat(riffChunks(b, i + 24, i + 8 + len, WEBP_FRAME_KEEP));
        const size = 16 + inner.length;
        const head = b.slice(i, i + 24);
        head[4] = size & 0xff; head[5] = (size >> 8) & 0xff; head[6] = (size >> 16) & 0xff; head[7] = (size >>> 24) & 0xff;
        chunks.push(head, inner);
      } else {
        const c = b.slice(i, i + 8 + Math.min(padded, end - i - 8));
        if (type === "VP8X" && c.length > 8) c[8] = c[8]! & ~0x2c;
        chunks.push(c);
      }
    }
    i += 8 + padded;
  }
  return chunks;
}

function stripWebp(b: Uint8Array): Uint8Array {
  const chunks = riffChunks(b, 12, b.length, WEBP_KEEP);
  if (!chunks.length) throw new BadImage("webp: no chunks");
  const body = concat(chunks);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  const size = body.length + 4;
  head[4] = size & 0xff; head[5] = (size >> 8) & 0xff; head[6] = (size >> 16) & 0xff; head[7] = (size >>> 24) & 0xff;
  return concat([head, body]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export interface PhotoStorage {
  kind: "local" | "r2";
  put(key: string, bytes: Uint8Array, type: PhotoType): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}
const KEY_RE = /^[a-f0-9]{48}$/;
const checkKey = (k: string) => { if (!KEY_RE.test(k)) throw new Error("bad photo key"); return k; };

export class LocalDiskPhotoStorage implements PhotoStorage {
  readonly kind = "local" as const;
  private readonly dir: string;
  constructor(dir: string) { this.dir = resolve(dir); }
  private path(key: string) { return join(this.dir, checkKey(key)); }
  async put(key: string, bytes: Uint8Array) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.path(key), bytes, { mode: 0o600 });
    await chmod(this.path(key), 0o600);
  }
  async get(key: string) { try { return new Uint8Array(await readFile(this.path(key))); } catch { return undefined; } }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
}

export class R2PhotoStorage implements PhotoStorage {
  readonly kind = "r2" as const;
  private readonly s3: ObjectStore;
  constructor(o: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
    this.s3 = new ObjectStore({ endpoint: o.endpoint, bucket: o.bucket, accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, region: "auto" });
  }
  async put(key: string, bytes: Uint8Array, type: PhotoType) { await this.s3.write(`photos/${checkKey(key)}`, bytes, { type }); }
  async get(key: string) {
    const f = this.s3.file(`photos/${checkKey(key)}`);
    try { return new Uint8Array(await f.arrayBuffer()); } catch (e) { if (objectMissing(e)) return undefined; throw e; }
  }
  async delete(key: string) { await this.s3.delete(`photos/${checkKey(key)}`); }
}
const objectMissing = (e: unknown) =>
  e instanceof Error && (e.name === "NoSuchKey" || (e as Error & { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404);

export function photoStorageFromEnv(env: Record<string, string | undefined> = process.env): PhotoStorage | undefined {
  if (env.PHOTO_STORAGE === "r2") {
    const endpoint = env.R2_ENDPOINT ?? (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
    const { R2_BUCKET: bucket, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("PHOTO_STORAGE=r2 needs R2_ENDPOINT (or R2_ACCOUNT_ID), R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY");
    return new R2PhotoStorage({ endpoint, bucket, accessKeyId, secretAccessKey });
  }
  if (env.PHOTO_STORAGE === "local") {
    if (env.PLATFORM_ENV !== "dev") throw new Error("PHOTO_STORAGE=local is for PLATFORM_ENV=dev only");
    return new LocalDiskPhotoStorage(env.PHOTO_DIR ?? "runs/photos");
  }
  return undefined;
}

export type PhotoAdmission = (tx?: SQL) => Promise<PhotoRefusal | undefined>;
export interface UnfinishedPhoto { row: PhotoRow; reserved: boolean; hidden: boolean; changedAt: number }
export interface PhotoHolder { personId: string; app: AppId }
export interface PhotoStore {
  reserve(r: PhotoRow, admit: PhotoAdmission): Promise<PhotoRefusal | undefined>;
  confirm(id: string, at: number): Promise<boolean>;
  get(id: string): Promise<PhotoRow | undefined>;
  list(personId: string, app?: AppId): Promise<PhotoRow[]>;
  hide(personId: string, at: number, scope: { app?: AppId; id?: string }): Promise<PhotoRow[]>;
  delete(id: string): Promise<void>;
  unfinished(limit: number): Promise<UnfinishedPhoto[]>;
  holders(limit: number, at: number): Promise<PhotoHolder[]>;
  setLabel(personId: string, app: AppId, id: string, label: string | null): Promise<PhotoLabelResult>;
}
interface MemoryPhotoRow extends PhotoRow { storedAt: number | null; hiddenAt: number | null }
export class MemoryPhotoStore implements PhotoStore {
  readonly rows = new Map<string, MemoryPhotoRow>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private async locked<T>(personId: string, fn: () => Promise<T>): Promise<T> {
    const before = this.locks.get(personId) ?? Promise.resolve();
    const run = before.then(fn, fn);
    this.locks.set(personId, run.catch(() => undefined));
    return run;
  }
  private live(r: MemoryPhotoRow) { return r.storedAt !== null && r.hiddenAt === null; }
  private copy(r: MemoryPhotoRow): PhotoRow { const { storedAt: _s, hiddenAt: _h, ...row } = r; return { ...row }; }
  async reserve(r: PhotoRow, admit: PhotoAdmission) {
    return this.locked(r.personId, async () => {
      const refused = await admit();
      if (refused) return refused;
      const held = [...this.rows.values()].filter(x => x.personId === r.personId && x.hiddenAt === null).length;
      if (photoSlotsFull(held)) return "too_many";
      this.rows.set(r.id, { ...r, storedAt: null, hiddenAt: null });
      return undefined;
    });
  }
  async confirm(id: string, at: number) {
    const r = this.rows.get(id);
    if (!r || r.storedAt !== null || r.hiddenAt !== null) return false;
    r.storedAt = at;
    return true;
  }
  async get(id: string) { const r = this.rows.get(id); return r && this.live(r) ? this.copy(r) : undefined; }
  async list(personId: string, app?: AppId) {
    return [...this.rows.values()].filter(r => this.live(r) && r.personId === personId && (!app || r.app === app))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)).map(r => this.copy(r));
  }
  async hide(personId: string, at: number, scope: { app?: AppId; id?: string }) {
    return this.locked(personId, async () => {
      const hidden: PhotoRow[] = [];
      for (const r of this.rows.values()) {
        if (r.personId !== personId || r.hiddenAt !== null || (scope.app && r.app !== scope.app) || (scope.id && r.id !== scope.id)) continue;
        r.hiddenAt = at;
        if (r.storedAt !== null) hidden.push(this.copy(r));
      }
      return hidden;
    });
  }
  async delete(id: string) { this.rows.delete(id); }
  async unfinished(limit: number) {
    return [...this.rows.values()].filter(r => r.storedAt === null || r.hiddenAt !== null).slice(0, limit)
      .map(r => ({ row: this.copy(r), reserved: r.storedAt === null, hidden: r.hiddenAt !== null, changedAt: r.hiddenAt ?? r.createdAt }));
  }
  async holders(limit: number) {
    const seen = new Map<string, PhotoHolder>();
    for (const r of this.rows.values()) if (r.hiddenAt === null) seen.set(`${r.personId}:${r.app}`, { personId: r.personId, app: r.app });
    return [...seen.values()].slice(0, limit);
  }
  async setLabel(personId: string, app: AppId, id: string, label: string | null): Promise<PhotoLabelResult> {
    return this.locked(personId, async () => {
      const r = this.rows.get(id);
      if (!r || !this.live(r) || r.personId !== personId || r.app !== app) return "not_found";
      if (label !== null && [...this.rows.values()].some(x => x.id !== id && x.hiddenAt === null && x.personId === personId && x.app === app && x.label === label)) return "taken";
      r.label = label;
      return "ok";
    });
  }
}
const photoRow = (r: Record<string, any>): PhotoRow => ({
  id: r.id, personId: r.person_id, app: r.app_id, storageKey: r.storage_key, contentType: r.content_type, bytes: r.bytes, sha256: r.sha256,
  consentVersion: r.consent_version, createdAt: new Date(r.created_at).getTime(), label: r.label ?? null, batchId: r.batch_id ?? null,
});
export class PgPhotoStore implements PhotoStore {
  constructor(private readonly sql: SQL) {}
  async reserve(r: PhotoRow, admit: PhotoAdmission) {
    return this.sql.begin(async tx => {
      const [person] = await tx`select id from platform.people where id = ${r.personId}::uuid and deleted_at is null for update`;
      if (!person) return "adults_only" as const;
      await tx`select set_config('app.app_id', ${r.app}, true)`;
      const refused = await admit(tx);
      if (refused) return refused;
      const [held] = await tx<{ n: number }[]>`select count(*)::int as n from platform.photos where person_id = ${r.personId}::uuid and deleted_at is null`;
      if (photoSlotsFull(held?.n ?? 0)) return "too_many" as const;
      await tx`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at, stored_at, batch_id)
        values (${r.id}, ${r.personId}, ${r.app}, ${r.storageKey}, ${r.contentType}, ${r.bytes}, ${r.sha256}, ${r.consentVersion}, ${new Date(r.createdAt)}, null, ${r.batchId})`;
      return undefined;
    });
  }
  async confirm(id: string, at: number) {
    return (await this.sql`update platform.photos set stored_at = ${new Date(at)} where id = ${id} and stored_at is null and deleted_at is null returning id`).length === 1;
  }
  async get(id: string) {
    const [r] = await this.sql`select * from platform.photos where id = ${id} and stored_at is not null and deleted_at is null`;
    return r ? photoRow(r) : undefined;
  }
  async list(personId: string, app?: AppId, lock = false) {
    const rows = app
      ? await this.sql`select * from platform.photos where person_id = ${personId}::uuid and app_id = ${app} and stored_at is not null and deleted_at is null
        order by created_at, id ${lock ? this.sql`for share` : this.sql``}`
      : await this.sql`select * from platform.photos where person_id = ${personId}::uuid and stored_at is not null and deleted_at is null order by created_at, id`;
    return (rows as Record<string, any>[]).map(photoRow);
  }
  async hide(personId: string, at: number, scope: { app?: AppId; id?: string }) {
    return this.sql.begin(async tx => {
      await tx`select id from platform.people where id = ${personId}::uuid for update`;
      const rows = await tx`update platform.photos set deleted_at = ${new Date(at)}
        where person_id = ${personId}::uuid and deleted_at is null
          ${scope.app ? tx`and app_id = ${scope.app}` : tx``} ${scope.id ? tx`and id = ${scope.id}` : tx``}
        returning *`;
      return (rows as Record<string, any>[]).filter(r => r.stored_at !== null).map(photoRow)
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    });
  }
  async delete(id: string) { await this.sql`delete from platform.photos where id = ${id}`; }
  async setLabel(personId: string, app: AppId, id: string, label: string | null): Promise<PhotoLabelResult> {
    try {
      const rows = await this.sql`update platform.photos set label = ${label}
        where id = ${id} and person_id = ${personId}::uuid and app_id = ${app} and stored_at is not null and deleted_at is null returning id`;
      return rows.length === 1 ? "ok" : "not_found";
    } catch (e) {
      if ((e as { code?: unknown }).code === "23505") return "taken";
      throw e;
    }
  }
  async unfinished(limit: number) {
    const rows = await this.sql`select * from platform.photos where stored_at is null or deleted_at is not null
      order by coalesce(deleted_at, created_at), id limit ${limit}`;
    return (rows as Record<string, any>[]).map(r => ({
      row: photoRow(r), reserved: r.stored_at === null, hidden: r.deleted_at !== null,
      changedAt: new Date(r.deleted_at ?? r.created_at).getTime(),
    }));
  }
  async holders(limit: number, at: number) {
    const out: PhotoHolder[] = [];
    let after = { personId: "", app: "" };
    for (;;) {
      const rows = await this.sql<Record<string, any>[]>`select distinct on (ph.person_id::text, ph.app_id) ph.person_id::text as holder_id, ph.app_id as holder_app,
          m.state as membership_state, p.*, f.lowest_age as floor_lowest_age, f.at as floor_at, f.birth_lower as floor_birth_lower,
          f.birth_upper as floor_birth_upper, f.birth_youngest as floor_birth_youngest
        from platform.photos ph
        left join platform.people p on p.id = ph.person_id
        left join platform.age_floor f on f.phone_hash = p.phone_hash
        left join platform.memberships m on m.person_id = ph.person_id and m.app_id = ph.app_id
        where ph.deleted_at is null and (ph.person_id::text, ph.app_id) > (${after.personId}, ${after.app})
        order by ph.person_id::text, ph.app_id limit ${HOLDER_PAGE}`;
      for (const r of rows) {
        const standing = ageStandingOf(r);
        const live = !!standing.person && standing.person.deletedAt === null && canBeMatched(effectiveAgeAt(standing, at))
          && LIVE_MEMBERSHIP.includes(r.membership_state);
        if (!live) out.push({ personId: r.holder_id, app: r.holder_app });
        if (out.length >= limit) return out;
      }
      if (rows.length < HOLDER_PAGE) return out;
      const last = rows[rows.length - 1]!;
      after = { personId: last.holder_id, app: last.holder_app };
    }
  }
}

export type PhotoRefusal = "photos_off" | "app_not_allowed" | "consent_required" | "adults_only" | "not_verified" | "banned" | "too_large" | "bad_type" | "bad_image" | "too_many" | "not_found" | "not_member" | "photo_set_changed";
const LIVE_MEMBERSHIP: readonly MembershipState[] = ["active", "paused", "onboarding"];
const SWEEP_BATCH = 64;
const HOLDER_PAGE = 512;
export type PhotoResult<T> = { ok: true; value: T } | { ok: false; reason: PhotoRefusal };

function ratingRows(rows: PhotoRow[]): PhotoRow[] {
  return rows.filter(row => row.bytes <= RATER_MAX_BYTES).slice(-RATER_MAX_PHOTOS);
}

type RatingWriteResult = { discard: () => Promise<void> } | { refused: PhotoRefusal } | void;

export interface PhotoServiceOptions {
  people: PeopleStore;
  meta: PhotoStore;
  storage?: PhotoStorage;
  signingKey: string;
  now?: () => number;
  rater?: PhotoRater;
  eligible?: (personId: string, app: AppId, tx?: SQL) => Promise<boolean>;
  banned?: (personId: string, tx?: SQL) => Promise<boolean>;
  onRating?: (personId: string, app: AppId, score: AppearanceScore, subject: RatingSubject, selected: string[]) => Promise<RatingWriteResult>;
  onRemoved?: (personId: string, app: AppId, photoId: string) => Promise<void>;
  log?: (s: string) => void;
}

export class PhotoService {
  private readonly now: () => number;
  constructor(private readonly o: PhotoServiceOptions) { this.now = o.now ?? Date.now; }
  get enabled() { return !!this.o.storage; }
  get rating() { return !!this.o.rater; }

  async adult(personId: string, app: AppId, tx?: SQL): Promise<PhotoRefusal | undefined> {
    const standing = await (tx ? new PgPeopleStore(tx) : this.o.people).ageStanding(personId, null);
    const p = standing.person;
    if (!p || p.deletedAt !== null || !canBeMatched(effectiveAgeAt(standing, this.now()))) return "adults_only";
    if (!(await (this.o.eligible?.(personId, app, tx) ?? Promise.resolve(false)))) return "not_verified";
    return undefined;
  }

  async mayTake(personId: string, app: AppId, tx?: SQL): Promise<PhotoRefusal | undefined> {
    if (!this.o.storage) return "photos_off";
    if (!PHOTO_APPS.includes(app)) return "app_not_allowed";
    if (await (this.o.banned?.(personId, tx) ?? Promise.resolve(false))) return "banned";
    return this.adult(personId, app, tx);
  }

  async upload(personId: string, app: AppId, input: Uint8Array, consentVersion: string | undefined, holderRefused?: () => Promise<boolean>, batchId: string = newPhotoBatchId()): Promise<PhotoResult<{ id: string }>> {
    if (!this.o.storage) return { ok: false, reason: "photos_off" };
    let change = stepPhotoChange(photoChangeInitial, {
      type: "beginUpload", appAllowed: PHOTO_APPS.includes(app), consentCurrent: consentVersion === PHOTO_CONSENT.version,
    });
    if (change.phase === "UnsupportedApp") return { ok: false, reason: "app_not_allowed" };
    if (change.phase === "ConsentMissing") return { ok: false, reason: "consent_required" };
    const who = (await this.mayTake(personId, app)) ?? (holderRefused && (await holderRefused()) ? "not_member" : undefined);
    change = stepPhotoChange(change, { type: "checkUploader", eligible: who === undefined });
    if (!canScreenFile(change)) return { ok: false, reason: who ?? "adults_only" };
    const tooLarge = input.length > PHOTO_MAX_BYTES;
    const type = tooLarge ? undefined : sniffType(input);
    change = stepPhotoChange(change, { type: "screenFile", tooLarge, typeKnown: type !== undefined });
    if (change.phase === "SizeExceeded") return { ok: false, reason: "too_large" };
    if (!type || !canCheckSlots(change)) return { ok: false, reason: "bad_type" };
    const count = (await this.o.meta.list(personId)).length;
    change = stepPhotoChange(change, { type: "checkSlots", available: !photoSlotsFull(count) });
    if (!canCleanImage(change)) return { ok: false, reason: "too_many" };
    let bytes: Uint8Array | undefined;
    try { bytes = stripMetadata(input, type); } catch { bytes = undefined; }
    change = stepPhotoChange(change, { type: "cleanImage", cleaned: bytes !== undefined });
    if (!bytes || !canReserveRow(change)) return { ok: false, reason: "bad_image" };
    const id = newPhotoId();
    const key = randomBytes(24).toString("hex");
    if (!/^[a-f0-9]{32}$/.test(batchId)) throw new Error("bad photo batch id");
    const row: PhotoRow = { id, personId, app, storageKey: key, contentType: type, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), consentVersion: PHOTO_CONSENT.version, createdAt: this.now(), label: null, batchId };
    const reserved = await this.o.meta.reserve(row, tx => this.ratingRefusal(personId, app, undefined, tx));
    change = stepPhotoChange(change, { type: "reserveRow", admitted: reserved === undefined });
    if (!canRecordUploadBytes(change)) return { ok: false, reason: reserved ?? "not_member" };
    await this.o.storage.put(key, bytes, type);
    change = stepPhotoChange(change, { type: "recordUploadBytes" });
    if (!canRecordUploadRow(change)) throw new Error("photo bytes did not advance the upload");
    const confirmed = await this.o.meta.confirm(id, this.now());
    change = stepPhotoChange(change, { type: "recordUploadRow", confirmed });
    if (canRecordUploadDiscard(change)) {
      await this.o.storage.delete(key);
      await this.o.meta.delete(id);
      change = stepPhotoChange(change, { type: "recordUploadDiscard" });
      return { ok: false, reason: change.phase === "ChangeRefused" ? (await this.ratingRefusal(personId, app)) ?? "not_member" : "not_member" };
    }
    if (!(await this.finishPhotoChange(change, personId, app))) throw new Error("photo upload did not complete");
    return { ok: true, value: { id } };
  }

  private async ratingRefusal(personId: string, app: AppId, photoIds?: readonly string[], tx?: SQL): Promise<PhotoRefusal | undefined> {
    const who = await this.mayTake(personId, app, tx);
    if (who) return who;
    const m = await (tx ? new PgPeopleStore(tx) : this.o.people).getMembership(personId, app);
    if (!m || !LIVE_MEMBERSHIP.includes(m.state)) return "not_member";
    if (photoIds) for (const id of photoIds) { const r = await (tx ? new PgPhotoStore(tx) : this.o.meta).get(id); if (!r || r.personId !== personId || r.app !== app) return "not_found"; }
    return undefined;
  }

  async ratingSelectionRefusal(personId: string, app: AppId, selected: string[], tx?: SQL): Promise<PhotoRefusal | undefined> {
    const refusal = await this.ratingRefusal(personId, app, undefined, tx);
    if (refusal) return refusal;
    const rows = await (tx ? new PgPhotoStore(tx).list(personId, app, true) : this.o.meta.list(personId, app));
    if (ratingPhotoSelectionCurrent(selected, ratingRows(rows).map(row => row.id))) return;
    return selected.some(id => !rows.some(row => row.id === id)) ? "not_found" : "photo_set_changed";
  }

  async rate(personId: string, app: AppId): Promise<{ rated: boolean; refused?: PhotoRefusal }> {
    const rater = this.o.rater;
    if (!rater || !this.o.storage) return { rated: false };
    const who = await this.ratingRefusal(personId, app);
    let attempt = stepRating(ratingInitial, { type: "screenSubject", eligible: who === undefined });
    if (!canSupplyPhotos(attempt)) return { rated: false, refused: who };
    const age = effectiveAgeAt(await this.o.people.ageStanding(personId, null), this.now());
    if (age === undefined || !canBeMatched(age)) return { rated: false, refused: "adults_only" };
    const subject: RatingSubject = { age, ageVerified: true };
    const rows = ratingRows(await this.o.meta.list(personId, app));
    const selected = rows.map(row => row.id);
    const photos: { id: string; bytes: Uint8Array }[] = [];
    for (const r of rows) { const bytes = await this.o.storage.get(r.storageKey); if (bytes) photos.push({ id: r.id, bytes }); }
    const ready = photos.length && photos.length === rows.length ? await this.ratingSelectionRefusal(personId, app, selected) : "not_found";
    attempt = stepRating(attempt, { type: "supplyPhotos", hasPhotos: ready === undefined });
    if (!canReceiveScore(attempt)) return { rated: false, refused: ready };
    const s = await rater.rate(subject, photos);
    attempt = stepRating(attempt, { type: "receiveScore", hasScore: !!s });
    if (!s || !canCheckReturnedScore(attempt)) return { rated: false };
    const changed = await this.ratingSelectionRefusal(personId, app, selected);
    attempt = stepRating(attempt, { type: "checkReturnedScore", eligible: changed === undefined });
    if (!canRecordScoreWrite(attempt)) {
      this.o.log?.(`[photos] rating discarded: ${changed} while the rater ran`);
      return { rated: false, refused: changed };
    }
    const write = await this.o.onRating?.(personId, app, s, subject, selected);
    const refused = write && "refused" in write ? write.refused : undefined;
    attempt = stepRating(attempt, { type: "recordScoreWrite", committed: refused === undefined });
    if (!canCheckWrittenScore(attempt)) return { rated: false, refused };
    const late = await this.ratingSelectionRefusal(personId, app, selected);
    attempt = stepRating(attempt, { type: "checkWrittenScore", eligible: late === undefined });
    if (canRecordScoreRemoval(attempt)) {
      this.o.log?.(`[photos] rating dropped: ${late} while it was written`);
      if (write && "discard" in write) await write.discard();
      else await this.o.onRemoved?.(personId, app, photos[0]!.id);
      attempt = stepRating(attempt, { type: "recordScoreRemoval" });
    }
    const rated = attempt.phase === "RatingKept";
    return late === undefined ? { rated } : { rated, refused: late };
  }

  async relayPhoto(personId: string, app: AppId, id: string, expected?: { sha256: string; bytes: number; contentType: PhotoType }, tx?: SQL): Promise<PhotoRow | undefined> {
    if (await this.ratingRefusal(personId, app, [id], tx)) return;
    const row = await (tx ? new PgPhotoStore(tx) : this.o.meta).get(id);
    if (!row || row.personId !== personId || row.app !== app) return;
    if (expected && (row.sha256 !== expected.sha256 || row.bytes !== expected.bytes || row.contentType !== expected.contentType)) return;
    return row;
  }
  async relayBytes(personId: string, app: AppId, id: string, expected: { sha256: string; bytes: number; contentType: PhotoType }, tx?: SQL) {
    const row = await this.relayPhoto(personId, app, id, expected, tx);
    if (!row || !this.o.storage) return;
    const bytes = await this.o.storage.get(row.storageKey);
    if (!bytes || bytes.length !== expected.bytes || sniffType(bytes) !== expected.contentType || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) return;
    if (!(await this.relayPhoto(personId, app, id, expected, tx))) return;
    return { bytes, contentType: row.contentType };
  }

  async list(personId: string, app: AppId) { return (await this.o.meta.list(personId, app)).map(r => ({ id: r.id, createdAt: r.createdAt, bytes: r.bytes, contentType: r.contentType })); }

  async rows(personId: string, app: AppId, tx?: SQL): Promise<PhotoRow[]> { return (tx ? new PgPhotoStore(tx) : this.o.meta).list(personId, app); }

  async setLabel(personId: string, app: AppId, id: string, label: string | null): Promise<PhotoLabelResult | "invalid"> {
    if (label !== null && (label.length > PHOTO_LABEL_MAX || !PHOTO_LABEL.test(label))) return "invalid";
    if (await this.mayTake(personId, app)) return "not_found";
    return this.o.meta.setLabel(personId, app, id, label);
  }

  async remove(personId: string, app: AppId, id: string): Promise<boolean> {
    const [row] = await this.o.meta.hide(personId, this.now(), { app, id });
    return row?.id === id ? this.erasePhoto(row, personId, app, true) : false;
  }

  async deleteFor(personId: string, app?: AppId): Promise<number> {
    const rows = await this.o.meta.hide(personId, this.now(), app ? { app } : {});
    let removed = 0;
    for (const r of rows) if (await this.erasePhoto(r, personId, app, false)) removed++;
    if (removed) this.o.log?.(`[photos] deleted ${removed} photo(s)${app ? ` on ${app}` : ""}`);
    return removed;
  }

  private async erasePhoto(row: PhotoRow, personId: string, app: AppId | undefined, rerate: boolean): Promise<boolean> {
    let change = stepPhotoChange(photoChangeInitial, {
      type: "beginRemoval", owned: row.personId === personId && (app === undefined || row.app === app), rerate,
    });
    if (!canRecordRemovedBytes(change)) return false;
    await this.o.storage?.delete(row.storageKey);
    change = stepPhotoChange(change, { type: "recordRemovedBytes" });
    if (!canRecordRatingClear(change)) return false;
    await this.o.onRemoved?.(personId, row.app, row.id);
    change = stepPhotoChange(change, { type: "recordRatingClear" });
    if (!canRecordRemovedRow(change)) return false;
    await this.o.meta.delete(row.id);
    change = stepPhotoChange(change, { type: "recordRemovedRow" });
    return this.finishPhotoChange(change, personId, row.app);
  }

  async holdAllowed(personId: string, app: AppId): Promise<boolean> {
    const standing = await this.o.people.ageStanding(personId, null);
    const p = standing.person;
    const m = await this.o.people.getMembership(personId, app);
    const appAdultCheckPassed = await (this.o.eligible?.(personId, app) ?? Promise.resolve(false));
    return photoHoldAllowed(!!p && p.deletedAt === null, !!p && canBeMatched(effectiveAgeAt(standing, this.now())), appAdultCheckPassed, !!m && LIVE_MEMBERSHIP.includes(m.state));
  }

  async ratingAllowed(personId: string, app: AppId): Promise<boolean> {
    return ratingHoldAllowed(await this.holdAllowed(personId, app), (await this.o.meta.list(personId, app)).length);
  }

  async sweep(candidates: readonly PhotoHolder[] = []): Promise<{ finished: number; erased: number; failed: number }> {
    const at = this.now(), rerate = new Map<string, PhotoHolder>();
    let finished = 0, erased = 0, failed = 0;
    const attempt = async (what: string, step: () => Promise<void>) => {
      try { await step(); } catch (e) { failed++; this.o.log?.(`[photos] sweep: ${what} failed and waits for the next tick: ${(e as Error).message}`); }
    };
    for (const u of await this.o.meta.unfinished(SWEEP_BATCH)) {
      if (!unfinishedPhotoDue(u.reserved, u.hidden, u.changedAt, at)) continue;
      await attempt(`photo ${u.row.id}`, async () => {
        await this.o.storage?.delete(u.row.storageKey);
        if (!u.reserved) await this.o.onRemoved?.(u.row.personId, u.row.app, u.row.id);
        await this.o.meta.delete(u.row.id);
        if (!u.reserved) rerate.set(`${u.row.personId}:${u.row.app}`, { personId: u.row.personId, app: u.row.app });
        finished++;
      });
    }
    for (const h of rerate.values()) await this.rate(h.personId, h.app).catch(e => this.o.log?.(`[photos] rating failed: ${(e as Error).message}`));
    const holders = new Map<string, PhotoHolder>();
    for (const h of [...(await this.o.meta.holders(SWEEP_BATCH, at)), ...candidates]) holders.set(`${h.personId}:${h.app}`, h);
    for (const h of holders.values()) {
      await attempt(`holder ${h.personId} on ${h.app}`, async () => {
        if (!(await this.holdAllowed(h.personId, h.app))) erased += await this.deleteFor(h.personId, h.app);
      });
    }
    if (finished || erased || failed) this.o.log?.(`[photos] sweep finished ${finished} change(s), erased ${erased} photo(s), ${failed} failed`);
    return { finished, erased, failed };
  }

  private async finishPhotoChange(change: PhotoChange, personId: string, app: AppId): Promise<boolean> {
    if (!canFinishRerate(change)) return change.phase === "ChangeFinished";
    await this.rate(personId, app).catch(e => this.o.log?.(`[photos] rating failed: ${(e as Error).message}`));
    return stepPhotoChange(change, { type: "finishRerate" }).phase === "ChangeFinished";
  }

  async staffLinks(personId: string, app: AppId, base: string): Promise<PhotoResult<{ id: string; url: string; expiresAt: number }[]>> {
    if (!this.o.storage) return { ok: false, reason: "photos_off" };
    const who = await this.adult(personId, app);
    if (who) return { ok: false, reason: "adults_only" };
    const exp = this.now() + PHOTO_VIEW_TTL_MS;
    const rows = await this.o.meta.list(personId, app);
    return { ok: true, value: rows.map(r => ({ id: r.id, url: `${base.replace(/\/+$/, "")}/api/photos/view/${r.id}?exp=${exp}&sig=${this.sign(r.id, exp)}`, expiresAt: exp })) };
  }

  private sign(id: string, exp: number) { return createHmac("sha256", `photo-view:${this.o.signingKey}`).update(`${id}.${exp}`).digest("base64url"); }

  async view(id: string, exp: number, sig: string): Promise<{ bytes: Uint8Array; contentType: PhotoType } | undefined> {
    if (!this.o.storage || !Number.isFinite(exp) || exp < this.now() || exp > this.now() + PHOTO_VIEW_TTL_MS) return undefined;
    const want = Buffer.from(this.sign(id, exp)), got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
    const r = await this.o.meta.get(id);
    if (!r || (await this.adult(r.personId, r.app))) return undefined;
    const bytes = await this.o.storage.get(r.storageKey);
    return bytes && { bytes, contentType: r.contentType };
  }

  async route(req: Request, path: string, app: AppId, who: () => Promise<string | null | "unauthorized">): Promise<Response | undefined> {
    if (path !== "/api/photos" && !path.startsWith("/api/photos/")) return undefined;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    const refuse = (reason: PhotoRefusal) => json(reason === "photos_off" ? 503 : reason === "too_large" ? 413 : reason === "adults_only" || reason === "not_verified" || reason === "banned" ? 403 : reason === "not_found" ? 404 : 400, { ok: false, error: reason === "banned" ? "review" : reason });
    if (req.method === "GET" && path === "/api/photos/consent") return json(200, { ...PHOTO_CONSENT, apps: PHOTO_APPS });
    const view = /^\/api\/photos\/view\/(ph_[a-f0-9]{24})$/.exec(path);
    if (view && req.method === "GET") {
      const u = new URL(req.url);
      const v = await this.view(view[1]!, Number(u.searchParams.get("exp")), u.searchParams.get("sig") ?? "");
      if (!v) return json(404, { ok: false, error: "not_found" });
      return new Response(v.bytes as unknown as BodyInit, { status: 200, headers: { "content-type": v.contentType, "cache-control": "no-store, private", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'", "referrer-policy": "no-referrer", "content-disposition": "inline" } });
    }
    if (!this.enabled) return refuse("photos_off");
    const person = await who();
    if (person === "unauthorized") return json(401, { ok: false, error: "unauthorized" });
    if (!person) return refuse("adults_only");
    if (req.method === "GET" && path === "/api/photos") return json(200, { ok: true, eligible: (await this.mayTake(person, app)) === undefined, photos: await this.list(person, app) });
    if (req.method === "POST" && path === "/api/photos") {
      const buf = await readCapped(req, PHOTO_MAX_BYTES);
      if (buf === "too_large") return refuse("too_large");
      const r = await this.upload(person, app, buf, req.headers.get("x-photo-consent") ?? undefined);
      return r.ok ? json(200, { ok: true, id: r.value.id }) : refuse(r.reason);
    }
    if (req.method === "POST" && path === "/api/photos/delete") {
      let id: unknown;
      try { id = ((await req.json()) as Record<string, unknown>)?.id; } catch { id = undefined; }
      if (typeof id !== "string" || !/^ph_[a-f0-9]{24}$/.test(id)) return json(400, { ok: false, error: "invalid" });
      return (await this.remove(person, app, id)) ? json(200, { ok: true }) : refuse("not_found");
    }
    return json(404, { ok: false, error: "not_found" });
  }
}
