// Private member photos (slop.date only; founder decision 2026-10-08: photos and any rating from
// them are for adults only (founder decision 9: the stated age, no ID check), never for members aged 13-17, and scores are agent_private and
// never shown to anyone).
//
// Rules, in the order they are checked:
//  - Photos are off unless storage is configured (PHOTO_STORAGE): every route answers photos_off.
//  - Upload: a signed-in member of an app that takes photos (PHOTO_APPS), with the photo consent of
//    the current version (PHOTO_CONSENT), whose person is an adult (lowest age 18 or more, never
//    unknown) and passes the app's own check (`eligible`: for slop, a member stated 18+ with no failed staff age check; decision 9). JPEG, PNG or
//    WebP only (checked on the bytes, not the header), at most PHOTO_MAX_BYTES and PHOTO_MAX_PER_PERSON.
//    Metadata (EXIF with GPS, XMP, comments, text chunks) is stripped before anything is stored.
//  - Storage: object storage under a random key (R2 in production, a 0700 folder in dev). There is no
//    public URL. Staff see a photo only through the backend: the service's audited photo route makes
//    a signed link that works for 5 minutes (viewUrl / view).
//  - Rating: an optional rater (photoRating.ts in the service adapts the engine's AppearanceRater),
//    default "none". It rates the member from their photos that are not rejected, on the engine's
//    z-like scale with a confidence and a body type. It runs only for a verified adult (checked again
//    at rating time); its scores go to `onRating` (the service writes them as one agent_private
//    facet) and are never returned by any route. A failed or skipped rating is retried by
//    `retryDue` (the service's tick) with backoff, at most RATING_MAX_TRIES times (migration 0020).
//  - Moderation: every new photo is "pending". Staff approve or reject it (the service's audited
//    route); an automatic classifier may only reject (`classify`, none wired). Only an approved photo
//    may ever be shown to anyone, through a signed link that works for an hour (`mediaLink`).
//  - Photo consent: a web upload records the consent version the page showed (platform.photo_consents);
//    POST /api/photos/consent records it without a photo. A photo sent by text (MMS) is kept only when
//    the person's recorded consent is the current version (`intake`).
//  - Delete: the member deletes one photo; leaving the app or deleting everything deletes them all;
//    a person whose lowest age drops under 18 loses them all (deleteFor).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { S3Client, type SQL } from "bun";
import type { AppId } from "./apps.ts";
import { readCapped } from "./body.ts";
import type { PeopleStore } from "./store.ts";

export type PhotoType = "image/jpeg" | "image/png" | "image/webp";
export const PHOTO_TYPES: readonly PhotoType[] = ["image/jpeg", "image/png", "image/webp"];
/** Apps that take photos. */
export const PHOTO_APPS: readonly AppId[] = ["slop"];
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_MAX_PER_PERSON = 6;
/** A staff link to one photo works this long. */
export const PHOTO_VIEW_TTL_MS = 5 * 60_000;
/** The photo consent a site shows next to the upload button (draft copy: needs the founder's approval and the CONTRIBUTING 3.5 videos). */
export const PHOTO_CONSENT = {
  version: "2026-10-08",
  text: "I agree that slop.date may store these photos privately. The matchmaker may use them, privately, to learn who I might like and who might like me. No other member sees them, no score from them is ever shown to anyone, and a person on the safety team looks at them only after a report. Photos are for adults (18+) only. I can delete them anytime.",
} as const;

/** A photo shown to someone (the probe) is reached only through a signed link that works this long. */
export const PHOTO_MEDIA_TTL_MS = 60 * 60_000;
/** A failed or skipped rating is tried at most this many times in all. */
export const RATING_MAX_TRIES = 5;
/** Wait before the next try after `attempts` tries: 10 minutes, then 4x each time (10 m, 40 m, 2.7 h, 10.7 h). */
export const ratingBackoffMs = (attempts: number) => 10 * 60_000 * 4 ** Math.max(0, attempts - 1);
/** The rater sees at most this many photos per member (newest first). */
export const RATING_MAX_PHOTOS = 4;

export type ModerationStatus = "pending" | "approved" | "rejected";
/** pending: not tried yet (or a photo changed); rated; skipped: the rater could not rate; failed: an error; refused: not a verified adult. */
export type RatingStatus = "pending" | "rated" | "skipped" | "failed" | "refused";
export type PhotoSource = "web" | "mms";

export interface PhotoRow {
  id: string; personId: string; app: AppId; storageKey: string; contentType: PhotoType; bytes: number; sha256: string;
  consentVersion: string; createdAt: number;
  /** Migration 0020. Optional on input: a new row starts pending (moderation and rating). */
  source?: PhotoSource;
  moderation?: ModerationStatus; moderatedBy?: string | null; moderatedAt?: number | null; moderationReason?: string | null;
  rating?: RatingStatus; ratingAttempts?: number; ratingError?: string | null; ratingNextAt?: number | null;
}
/** What a moderation or rating step changes on a row. */
export type PhotoPatch = Partial<Pick<PhotoRow, "moderation" | "moderatedBy" | "moderatedAt" | "moderationReason" | "rating" | "ratingAttempts" | "ratingError" | "ratingNextAt">>;
/**
 * A member's rating on the engine's scale (packages/engine slop appearance.ts): z-like scores
 * (0 = typical, clamped to -3..3), a confidence 0..1 and an optional body type. Never shown to anyone.
 */
export interface PhotoScores { face: number; body: number; overall: number; confidence: number; bodyType?: string; bodyTypeConfidence?: number; model: string }
/** One photo the rater may read. */
export interface RatablePhoto { id: string; bytes: Uint8Array; contentType: PhotoType }
/**
 * An optional rater: one member from their photos (the service adapts the engine's AppearanceRater,
 * photoRating.ts). `subject.age` is the person's lowest age, already checked to be 18+. "none" never rates.
 * Undefined: could not rate (no usable photo); a throw: an error (both are tried again later).
 */
export interface PhotoRater { id: string; rate(photos: readonly RatablePhoto[], subject: { age: number }): Promise<PhotoScores | undefined> }
export const NO_RATER: PhotoRater = { id: "none", rate: async () => undefined };
/**
 * An automatic check before a person looks (nudity, a face that may be a minor's, text or handles in
 * the image). It may only reject: approval is always a person. None is wired yet.
 */
export interface PhotoClassifier { id: string; check(photo: { bytes: Uint8Array; contentType: PhotoType }): Promise<{ reject: boolean; reason?: string }> }

// ------------------------------------------------------------------------------------ bytes
/** The image type from the first bytes (never from a header or a file name). */
export function sniffType(b: Uint8Array): PhotoType | undefined {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  return undefined;
}
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

export class BadImage extends Error {}

/**
 * The image with its metadata removed: JPEG APP1-APP15 segments (EXIF and its GPS block, XMP, IPTC)
 * and comments; PNG text, time and eXIf chunks; WebP EXIF and XMP chunks (and their VP8X flags).
 * The pixels are not touched. A malformed file throws BadImage (never stored).
 */
export function stripMetadata(b: Uint8Array, type: PhotoType): Uint8Array {
  if (type === "image/jpeg") return stripJpeg(b);
  if (type === "image/png") return stripPng(b);
  return stripWebp(b);
}

/**
 * JPEG: every segment is copied except APP1-APP15 and comments, scan by scan (progressive files have
 * several), and nothing after the first EOI. Phones append whole second images after EOI (MPF
 * pictures, depth maps, motion-photo trailers) with their own EXIF and GPS: those never survive.
 */
function stripJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2, scanned = false;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new BadImage("jpeg: marker expected");
    const m = b[i + 1]!;
    if (m === 0xd9) { out.push(b.subarray(i, i + 2)); return concat(out); } // EOI: anything after it is dropped
    if (m === 0xda) {
      // SOS: its header, then the entropy-coded data up to the next real marker (0xFF00 is a stuffed
      // byte, 0xFFD0-0xFFD7 are restart markers, 0xFFFF is fill).
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
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { out.push(b.subarray(i, i + 2)); i += m === 0xff ? 1 : 2; continue; }
    if (i + 4 > b.length) throw new BadImage("jpeg: truncated");
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) throw new BadImage("jpeg: bad segment");
    const drop = (m >= 0xe1 && m <= 0xef) || m === 0xfe;
    if (!drop) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  // A file cut off after its scan data (no EOI): keep the image, close it.
  if (scanned) { out.push(Uint8Array.of(0xff, 0xd9)); return concat(out); }
  throw new BadImage("jpeg: no image data");
}

const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
function stripPng(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8, end = false;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
    const type = ascii(b, i + 4, 4);
    if (i + 12 + len > b.length) throw new BadImage("png: bad chunk");
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, i + 12 + len));
    i += 12 + len;
    if (type === "IEND") { end = true; break; }
  }
  if (!end) throw new BadImage("png: no IEND");
  return concat(out);
}

function stripWebp(b: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | ((b[i + 7]! << 24) >>> 0);
    const padded = len + (len & 1);
    if (i + 8 + len > b.length) throw new BadImage("webp: bad chunk");
    if (type !== "EXIF" && type !== "XMP ") {
      const c = b.slice(i, i + 8 + Math.min(padded, b.length - i - 8));
      if (type === "VP8X" && c.length > 8) c[8] = c[8]! & ~0x0c; // the EXIF (0x08) and XMP (0x04) flags
      chunks.push(c);
    }
    i += 8 + padded;
  }
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

// ------------------------------------------------------------------------------------ storage
/** Where the bytes live. Keys are random hex, never a name or a phone. */
export interface PhotoStorage {
  kind: "local" | "r2";
  put(key: string, bytes: Uint8Array, type: PhotoType): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}
const KEY_RE = /^[a-f0-9]{48}$/;
const checkKey = (k: string) => { if (!KEY_RE.test(k)) throw new Error("bad photo key"); return k; };

/** Dev only: a local folder (0700) with one 0600 file per photo. */
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

/** Cloudflare R2 (S3-compatible) through Bun's S3 client. The bucket must be private (no public access, no r2.dev URL). Not exercised in tests. */
export class R2PhotoStorage implements PhotoStorage {
  readonly kind = "r2" as const;
  private readonly s3: S3Client;
  constructor(o: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
    this.s3 = new S3Client({ endpoint: o.endpoint, bucket: o.bucket, accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, region: "auto" });
  }
  async put(key: string, bytes: Uint8Array, type: PhotoType) { await this.s3.write(`photos/${checkKey(key)}`, bytes, { type }); }
  async get(key: string) {
    const f = this.s3.file(`photos/${checkKey(key)}`);
    try { return new Uint8Array(await f.arrayBuffer()); } catch { return undefined; }
  }
  async delete(key: string) { await this.s3.delete(`photos/${checkKey(key)}`); }
}

/**
 * Storage from the environment. PHOTO_STORAGE=r2: R2_ENDPOINT (or R2_ACCOUNT_ID), R2_BUCKET,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. PHOTO_STORAGE=local (PLATFORM_ENV=dev only): PHOTO_DIR
 * (default ./runs/photos). Anything else: undefined, and photos are off.
 */
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

// ------------------------------------------------------------------------------------ rows
export interface PhotoStore {
  put(r: PhotoRow): Promise<void>;
  get(id: string): Promise<PhotoRow | undefined>;
  list(personId: string, app?: AppId): Promise<PhotoRow[]>;
  delete(id: string): Promise<void>;
  /** Moderation and rating state (migration 0020). */
  update(id: string, patch: PhotoPatch): Promise<void>;
  /** Photos whose rating is due again: pending, skipped or failed, under RATING_MAX_TRIES tries, next try at or before `now`. */
  due(now: number, limit: number): Promise<PhotoRow[]>;
  /** The newest photo consent version the person recorded for this app. */
  consentOf(personId: string, app: AppId): Promise<string | undefined>;
  recordConsent(personId: string, app: AppId, version: string, source: PhotoSource, at: number): Promise<void>;
  /** Forget the person's photo consents (on one app, or every app): leave, delete everything, a minor age. */
  forgetConsents(personId: string, app?: AppId): Promise<void>;
}
const withDefaults = (r: PhotoRow): PhotoRow => ({
  source: "web", moderation: "pending", moderatedBy: null, moderatedAt: null, moderationReason: null, rating: "pending", ratingAttempts: 0, ratingError: null, ratingNextAt: null, ...r,
});
const isDue = (r: PhotoRow, now: number) => ["pending", "skipped", "failed"].includes(r.rating ?? "pending") && (r.ratingAttempts ?? 0) < RATING_MAX_TRIES && (r.ratingNextAt ?? 0) <= now;
export class MemoryPhotoStore implements PhotoStore {
  readonly rows = new Map<string, PhotoRow>();
  readonly consents: { personId: string; app: AppId; version: string; source: PhotoSource; at: number }[] = [];
  async put(r: PhotoRow) { this.rows.set(r.id, withDefaults({ ...r })); }
  async get(id: string) { const r = this.rows.get(id); return r && { ...r }; }
  async list(personId: string, app?: AppId) { return [...this.rows.values()].filter(r => r.personId === personId && (!app || r.app === app)).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)).map(r => ({ ...r })); }
  async delete(id: string) { this.rows.delete(id); }
  async update(id: string, patch: PhotoPatch) { const r = this.rows.get(id); if (r) this.rows.set(id, { ...r, ...patch }); }
  async due(now: number, limit: number) { return [...this.rows.values()].filter(r => isDue(r, now)).sort((a, b) => a.createdAt - b.createdAt).slice(0, limit).map(r => ({ ...r })); }
  async consentOf(personId: string, app: AppId) { return [...this.consents].reverse().find(c => c.personId === personId && c.app === app)?.version; }
  async recordConsent(personId: string, app: AppId, version: string, source: PhotoSource, at: number) { this.consents.push({ personId, app, version, source, at }); }
  async forgetConsents(personId: string, app?: AppId) {
    for (let i = this.consents.length - 1; i >= 0; i--) if (this.consents[i]!.personId === personId && (!app || this.consents[i]!.app === app)) this.consents.splice(i, 1);
  }
}
const ms = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).getTime());
const photoRow = (r: Record<string, any>): PhotoRow => ({
  id: r.id, personId: r.person_id, app: r.app_id, storageKey: r.storage_key, contentType: r.content_type, bytes: r.bytes, sha256: r.sha256,
  consentVersion: r.consent_version, createdAt: new Date(r.created_at).getTime(),
  source: r.source ?? "web", moderation: r.moderation_status ?? "pending", moderatedBy: r.moderated_by ?? null, moderatedAt: ms(r.moderated_at), moderationReason: r.moderation_reason ?? null,
  rating: r.rating_status ?? "pending", ratingAttempts: r.rating_attempts ?? 0, ratingError: r.rating_last_error ?? null, ratingNextAt: ms(r.rating_next_at),
});
const COLUMNS: Record<keyof PhotoPatch, string> = {
  moderation: "moderation_status", moderatedBy: "moderated_by", moderatedAt: "moderated_at", moderationReason: "moderation_reason",
  rating: "rating_status", ratingAttempts: "rating_attempts", ratingError: "rating_last_error", ratingNextAt: "rating_next_at",
};
/** platform.photos (migrations 0011, 0020) and platform.photo_consents (0020). A deleted photo's row is removed (the bytes first). */
export class PgPhotoStore implements PhotoStore {
  constructor(private readonly sql: SQL) {}
  async put(r: PhotoRow) {
    const x = withDefaults(r);
    await this.sql`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at, source, moderation_status, rating_status)
      values (${x.id}, ${x.personId}, ${x.app}, ${x.storageKey}, ${x.contentType}, ${x.bytes}, ${x.sha256}, ${x.consentVersion}, ${new Date(x.createdAt)}, ${x.source}, ${x.moderation}, ${x.rating})`;
  }
  async get(id: string) { const [r] = await this.sql`select * from platform.photos where id = ${id} and deleted_at is null`; return r ? photoRow(r) : undefined; }
  async list(personId: string, app?: AppId) {
    const rows = app
      ? await this.sql`select * from platform.photos where person_id = ${personId}::uuid and app_id = ${app} and deleted_at is null order by created_at, id`
      : await this.sql`select * from platform.photos where person_id = ${personId}::uuid and deleted_at is null order by created_at, id`;
    return (rows as Record<string, any>[]).map(photoRow);
  }
  async delete(id: string) { await this.sql`delete from platform.photos where id = ${id}`; }
  async update(id: string, patch: PhotoPatch) {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch) as [keyof PhotoPatch, unknown][]) {
      if (v === undefined) continue;
      set[COLUMNS[k]] = (k === "moderatedAt" || k === "ratingNextAt") && typeof v === "number" ? new Date(v) : v;
    }
    if (Object.keys(set).length) await this.sql`update platform.photos set ${this.sql(set)} where id = ${id}`;
  }
  async due(now: number, limit: number) {
    const rows = await this.sql`select * from platform.photos where deleted_at is null and rating_status in ('pending', 'skipped', 'failed')
      and rating_attempts < ${RATING_MAX_TRIES} and (rating_next_at is null or rating_next_at <= ${new Date(now)}) order by created_at, id limit ${limit}`;
    return (rows as Record<string, any>[]).map(photoRow);
  }
  async consentOf(personId: string, app: AppId) {
    const [r] = await this.sql`select version from platform.photo_consents where person_id = ${personId}::uuid and app_id = ${app} order by at desc limit 1`;
    return (r?.version as string | undefined) ?? undefined;
  }
  async recordConsent(personId: string, app: AppId, version: string, source: PhotoSource, at: number) {
    await this.sql`insert into platform.photo_consents (person_id, app_id, version, source, at) values (${personId}, ${app}, ${version}, ${source}, ${new Date(at)})`;
  }
  async forgetConsents(personId: string, app?: AppId) {
    if (app) await this.sql`delete from platform.photo_consents where person_id = ${personId}::uuid and app_id = ${app}`;
    else await this.sql`delete from platform.photo_consents where person_id = ${personId}::uuid`;
  }
}

// ------------------------------------------------------------------------------------ service
export type PhotoRefusal = "photos_off" | "app_not_allowed" | "consent_required" | "adults_only" | "not_verified" | "too_large" | "bad_type" | "bad_image" | "too_many" | "not_found";
export type PhotoResult<T> = { ok: true; value: T } | { ok: false; reason: PhotoRefusal };

export interface PhotoServiceOptions {
  people: PeopleStore;
  meta: PhotoStore;
  storage?: PhotoStorage;
  /** Key for the staff view links and the probe media links (derived from PLATFORM_HASH_KEY). */
  signingKey: string;
  now?: () => number;
  rater?: PhotoRater;
  /** An automatic check that may reject a new photo before a person looks (none is wired). */
  classifier?: PhotoClassifier;
  /**
   * The app's own adult check for this person, beyond the lowest age (slop: the member's stated age
   * is 18+ and no staff age check failed; decision 9). The service reads the network rows. Default: refuse (fail closed).
   */
  eligible?: (personId: string, app: AppId) => Promise<boolean>;
  /** The rater's scores for the member: the service writes them as one agent_private facet. Never returned by a route. */
  onRating?: (personId: string, app: AppId, scores: PhotoScores) => Promise<void>;
  /** A photo is gone or rejected (removed, left, deleted, a minor age): the service deletes the member's rating (it is made again from the rest). */
  onRemoved?: (personId: string, app: AppId, photoId: string) => Promise<void>;
  log?: (s: string) => void;
}

const clampZ = (x: number) => Math.round(Math.max(-3, Math.min(3, Number.isFinite(x) ? x : 0)) * 100) / 100;
const clamp01 = (x: number) => Math.round(Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)) * 100) / 100;
/** An error's text for the row (never the photo, never a person). */
const errorText = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 200);

export class PhotoService {
  private readonly now: () => number;
  constructor(private readonly o: PhotoServiceOptions) { this.now = o.now ?? Date.now; }
  get enabled() { return !!this.o.storage; }
  /** A rater other than "none" is configured. */
  get rating() { return !!this.o.storage && (this.o.rater ?? NO_RATER).id !== "none"; }

  /** An adult on this app: lowest age 18+ (an unknown age fails) and the app's own check (slop: no failed staff age check). */
  async adult(personId: string, app: AppId): Promise<PhotoRefusal | undefined> {
    const p = await this.o.people.getPerson(personId);
    if (!p || p.deletedAt !== null || p.lowestAge === null || p.lowestAge < 18) return "adults_only";
    if (!(await (this.o.eligible?.(personId, app) ?? Promise.resolve(false)))) return "not_verified";
    return undefined;
  }

  async upload(personId: string, app: AppId, input: Uint8Array, consentVersion: string | undefined, source: PhotoSource = "web"): Promise<PhotoResult<{ id: string }>> {
    if (!this.o.storage) return { ok: false, reason: "photos_off" };
    if (!PHOTO_APPS.includes(app)) return { ok: false, reason: "app_not_allowed" };
    if (consentVersion !== PHOTO_CONSENT.version) return { ok: false, reason: "consent_required" };
    const who = await this.adult(personId, app);
    if (who) return { ok: false, reason: who };
    if (input.length > PHOTO_MAX_BYTES) return { ok: false, reason: "too_large" };
    const type = sniffType(input);
    if (!type) return { ok: false, reason: "bad_type" };
    if ((await this.o.meta.list(personId)).length >= PHOTO_MAX_PER_PERSON) return { ok: false, reason: "too_many" };
    let bytes: Uint8Array;
    try { bytes = stripMetadata(input, type); } catch { return { ok: false, reason: "bad_image" }; }
    const id = `ph_${randomBytes(12).toString("hex")}`;
    const key = randomBytes(24).toString("hex");
    await this.o.storage.put(key, bytes, type);
    await this.o.meta.put({
      id, personId, app, storageKey: key, contentType: type, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), consentVersion, createdAt: this.now(),
      source, moderation: "pending", rating: "pending", ratingAttempts: 0,
    });
    // The page showed the consent next to the button: the upload records it (a text photo needs it recorded first).
    if (source === "web") await this.o.meta.recordConsent(personId, app, consentVersion, "web", this.now());
    await this.classify(id, bytes, type);
    await this.rate(personId, app);
    return { ok: true, value: { id } };
  }

  /** The person agrees to the current photo consent without a photo (the settings page), so a photo sent by text can be kept. */
  async agree(personId: string, app: AppId, version: unknown): Promise<PhotoResult<{ version: string }>> {
    if (!this.o.storage) return { ok: false, reason: "photos_off" };
    if (!PHOTO_APPS.includes(app)) return { ok: false, reason: "app_not_allowed" };
    if (version !== PHOTO_CONSENT.version) return { ok: false, reason: "consent_required" };
    const who = await this.adult(personId, app);
    if (who) return { ok: false, reason: who };
    await this.o.meta.recordConsent(personId, app, PHOTO_CONSENT.version, "web", this.now());
    return { ok: true, value: { version: PHOTO_CONSENT.version } };
  }

  /**
   * Why a photo sent by text (MMS) would not be kept, checked before it is downloaded: photos off,
   * not an app that takes photos, not a verified adult, or no recorded consent of the current version.
   */
  async intakeRefusal(personId: string, app: AppId): Promise<PhotoRefusal | undefined> {
    if (!this.o.storage) return "photos_off";
    if (!PHOTO_APPS.includes(app)) return "app_not_allowed";
    const who = await this.adult(personId, app);
    if (who) return who;
    if ((await this.o.meta.consentOf(personId, app)) !== PHOTO_CONSENT.version) return "consent_required";
    return undefined;
  }

  /** A photo sent by text: the same checks as an upload, with the person's recorded consent. */
  async intake(personId: string, app: AppId, input: Uint8Array): Promise<PhotoResult<{ id: string }>> {
    const no = await this.intakeRefusal(personId, app);
    if (no) return { ok: false, reason: no };
    return this.upload(personId, app, input, PHOTO_CONSENT.version, "mms");
  }

  /** The classifier hook: it may only reject. An error leaves the photo pending for a person. */
  private async classify(id: string, bytes: Uint8Array, contentType: PhotoType) {
    const c = this.o.classifier;
    if (!c) return;
    try {
      const r = await c.check({ bytes, contentType });
      if (r.reject) await this.o.meta.update(id, { moderation: "rejected", moderatedBy: `classifier:${c.id}`, moderatedAt: this.now(), moderationReason: (r.reason ?? "classifier").slice(0, 200) });
    } catch (e) { this.o.log?.(`[photos] classifier failed: ${errorText(e)}`); }
  }

  /**
   * Rate the member from their photos that are not rejected, with the configured rater. Refused
   * (nothing rated, nothing written) for anyone who is not a verified adult now. The rater "none"
   * never rates and changes nothing. A failure or a skip is tried again later (retryDue) with
   * backoff; this never throws for a rater error.
   */
  async rate(personId: string, app: AppId): Promise<{ rated: boolean; refused?: PhotoRefusal; status?: RatingStatus }> {
    const rater = this.o.rater ?? NO_RATER;
    if (rater.id === "none" || !this.o.storage) return { rated: false };
    const rows = (await this.o.meta.list(personId, app)).filter(r => r.moderation !== "rejected");
    const who = await this.adult(personId, app);
    if (who) {
      for (const r of rows) await this.o.meta.update(r.id, { rating: "refused", ratingNextAt: null });
      return { rated: false, refused: who, status: "refused" };
    }
    const age = (await this.o.people.getPerson(personId))?.lowestAge;
    if (!rows.length || age === null || age === undefined) return { rated: false, refused: "not_found" };
    const photos: RatablePhoto[] = [];
    for (const r of [...rows].reverse().slice(0, RATING_MAX_PHOTOS)) {
      const bytes = await this.o.storage.get(r.storageKey);
      if (bytes) photos.push({ id: r.id, bytes, contentType: r.contentType });
    }
    if (!photos.length) return { rated: false, refused: "not_found" };
    let s: PhotoScores | undefined;
    try { s = await rater.rate(photos, { age }); } catch (e) {
      this.o.log?.(`[photos] rating failed: ${errorText(e)}`);
      await this.later(rows, "failed", errorText(e));
      return { rated: false, status: "failed" };
    }
    if (!s) { await this.later(rows, "skipped", null); return { rated: false, status: "skipped" }; }
    await this.o.onRating?.(personId, app, {
      face: clampZ(s.face), body: clampZ(s.body), overall: clampZ(s.overall), confidence: clamp01(s.confidence), model: s.model || rater.id,
      ...(s.bodyType ? { bodyType: s.bodyType, bodyTypeConfidence: clamp01(s.bodyTypeConfidence ?? s.confidence) } : {}),
    });
    for (const r of rows) await this.o.meta.update(r.id, { rating: "rated", ratingAttempts: (r.ratingAttempts ?? 0) + 1, ratingError: null, ratingNextAt: null });
    return { rated: true, status: "rated" };
  }

  /** A failed or skipped try: one more attempt counted, the next one after the backoff. */
  private async later(rows: PhotoRow[], status: "failed" | "skipped", error: string | null) {
    for (const r of rows) {
      const attempts = (r.ratingAttempts ?? 0) + 1;
      await this.o.meta.update(r.id, { rating: status, ratingAttempts: attempts, ratingError: error, ratingNextAt: this.now() + ratingBackoffMs(attempts) });
    }
  }

  /** The member's photos changed (one removed, rejected or approved again): their rating is made again from the rest. */
  private async rerate(personId: string, app: AppId) {
    for (const r of await this.o.meta.list(personId, app)) if (r.moderation !== "rejected") await this.o.meta.update(r.id, { rating: "pending", ratingAttempts: 0, ratingError: null, ratingNextAt: null });
    await this.rate(personId, app);
  }

  /** The periodic retry (the service's tick): every member with a photo whose rating is due. Returns how many members were tried. */
  async retryDue(limit = 50): Promise<number> {
    if (!this.rating) return 0;
    const due = await this.o.meta.due(this.now(), limit);
    const people = [...new Map(due.map(r => [`${r.personId}|${r.app}`, r])).values()];
    for (const r of people) await this.rate(r.personId, r.app);
    return people.length;
  }

  /** The member's own photos (no bytes, no score): when each was added and whether a person approved it yet. */
  async list(personId: string, app: AppId) {
    return (await this.o.meta.list(personId, app)).map(r => ({ id: r.id, createdAt: r.createdAt, bytes: r.bytes, contentType: r.contentType, status: r.moderation ?? "pending" }));
  }

  /** The member deletes one of their photos. */
  async remove(personId: string, app: AppId, id: string): Promise<boolean> {
    const r = await this.o.meta.get(id);
    if (!r || r.personId !== personId || r.app !== app) return false;
    await this.o.storage?.delete(r.storageKey);
    await this.o.meta.delete(id);
    await this.o.onRemoved?.(personId, r.app, id);
    if (this.rating) await this.rerate(personId, app);
    return true;
  }

  /** Every photo of a person (on one app, or every app), and their photo consents: leave, delete everything, a minor age, a ban. Bytes first, then rows. */
  async deleteFor(personId: string, app?: AppId): Promise<number> {
    const rows = await this.o.meta.list(personId, app);
    for (const r of rows) { await this.o.storage?.delete(r.storageKey); await this.o.meta.delete(r.id); await this.o.onRemoved?.(personId, r.app, r.id); }
    await this.o.meta.forgetConsents(personId, app);
    if (rows.length) this.o.log?.(`[photos] deleted ${rows.length} photo(s)${app ? ` on ${app}` : ""}`);
    return rows.length;
  }

  /**
   * Staff moderation (the service's audited route): approve or reject one photo. Approval is for a
   * verified adult only (checked again here). A change in what is rejected makes the rating again.
   */
  async moderate(id: string, decision: "approve" | "reject", by: string, reason: string): Promise<PhotoResult<{ personId: string; app: AppId; status: ModerationStatus }>> {
    const r = await this.o.meta.get(id);
    if (!r) return { ok: false, reason: "not_found" };
    if (decision === "approve") { const who = await this.adult(r.personId, r.app); if (who) return { ok: false, reason: who }; }
    const status: ModerationStatus = decision === "approve" ? "approved" : "rejected";
    await this.o.meta.update(id, { moderation: status, moderatedBy: by, moderatedAt: this.now(), moderationReason: reason.slice(0, 500) });
    if ((r.moderation === "rejected") !== (status === "rejected")) {
      if (status === "rejected") await this.o.onRemoved?.(r.personId, r.app, id);
      if (this.rating) await this.rerate(r.personId, r.app);
    }
    return { ok: true, value: { personId: r.personId, app: r.app, status } };
  }

  /** One photo's row (staff routes; never returned to a member). */
  row(id: string) { return this.o.meta.get(id); }

  /** The newest approved photo of a verified adult (the one a probe may carry), or undefined. */
  async probePhoto(personId: string, app: AppId): Promise<PhotoRow | undefined> {
    if (!this.o.storage || (await this.adult(personId, app))) return undefined;
    return (await this.o.meta.list(personId, app)).filter(r => r.moderation === "approved").at(-1);
  }

  /**
   * Signed links for staff (the service's photo route, after its audit row): adults only, checked
   * again here. Each link works for PHOTO_VIEW_TTL_MS through GET /api/photos/view/<id>.
   */
  async staffLinks(personId: string, app: AppId, base: string): Promise<PhotoResult<{ id: string; url: string; expiresAt: number; status: ModerationStatus }[]>> {
    if (!this.o.storage) return { ok: false, reason: "photos_off" };
    const who = await this.adult(personId, app);
    if (who) return { ok: false, reason: "adults_only" };
    const exp = this.now() + PHOTO_VIEW_TTL_MS;
    const rows = await this.o.meta.list(personId, app);
    return { ok: true, value: rows.map(r => ({ id: r.id, url: `${base.replace(/\/+$/, "")}/api/photos/view/${r.id}?exp=${exp}&sig=${this.sign("view", r.id, exp)}`, expiresAt: exp, status: r.moderation ?? "pending" })) };
  }

  /**
   * A short-lived link to one approved photo, for a probe's media (the provider fetches it once).
   * It works for PHOTO_MEDIA_TTL_MS through GET /api/photos/media/<id>, and only while the photo is
   * still approved and its person still a verified adult.
   */
  mediaLink(id: string, base: string): { url: string; expiresAt: number } {
    const exp = this.now() + PHOTO_MEDIA_TTL_MS;
    return { url: `${base.replace(/\/+$/, "")}/api/photos/media/${id}?exp=${exp}&sig=${this.sign("media", id, exp)}`, expiresAt: exp };
  }

  private sign(purpose: "view" | "media", id: string, exp: number) { return createHmac("sha256", `photo-${purpose}:${this.o.signingKey}`).update(`${id}.${exp}`).digest("base64url"); }
  private signed(purpose: "view" | "media", id: string, exp: number, sig: string, ttl: number) {
    if (!Number.isFinite(exp) || exp < this.now() || exp > this.now() + ttl) return false;
    const want = Buffer.from(this.sign(purpose, id, exp)), got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /** The bytes behind a signed staff link, or undefined (bad or old signature, deleted photo, or the person is no longer an adult). */
  async view(id: string, exp: number, sig: string): Promise<{ bytes: Uint8Array; contentType: PhotoType } | undefined> {
    if (!this.o.storage || !this.signed("view", id, exp, sig, PHOTO_VIEW_TTL_MS)) return undefined;
    const r = await this.o.meta.get(id);
    if (!r || (await this.adult(r.personId, r.app))) return undefined;
    const bytes = await this.o.storage.get(r.storageKey);
    return bytes && { bytes, contentType: r.contentType };
  }

  /** The bytes behind a media link: only an approved photo of a verified adult, within the hour. */
  async media(id: string, exp: number, sig: string): Promise<{ bytes: Uint8Array; contentType: PhotoType } | undefined> {
    if (!this.o.storage || !this.signed("media", id, exp, sig, PHOTO_MEDIA_TTL_MS)) return undefined;
    const r = await this.o.meta.get(id);
    if (!r || r.moderation !== "approved" || (await this.adult(r.personId, r.app))) return undefined;
    const bytes = await this.o.storage.get(r.storageKey);
    return bytes && { bytes, contentType: r.contentType };
  }

  /**
   * The /api/photos routes, for the public API (api.ts). `personId` is the signed-in person (null:
   * not signed in, or no person yet). Undefined: not a photo route.
   *   GET  /api/photos/consent         the consent text and version
   *   POST /api/photos/consent         {version}: record the consent without a photo
   *   GET  /api/photos                 the member's own photos (ids and review status only) and whether they may add photos
   *   POST /api/photos                 the image bytes (Content-Type image/*), X-Photo-Consent: <version>
   *   POST /api/photos/delete          {id}
   *   GET  /api/photos/view/<id>?exp=&sig=    a signed staff link
   *   GET  /api/photos/media/<id>?exp=&sig=   a signed probe media link
   */
  async route(req: Request, path: string, app: AppId, who: () => Promise<string | null | "unauthorized">): Promise<Response | undefined> {
    if (path !== "/api/photos" && !path.startsWith("/api/photos/")) return undefined;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    const refuse = (reason: PhotoRefusal) => json(reason === "photos_off" ? 503 : reason === "too_large" ? 413 : reason === "adults_only" || reason === "not_verified" ? 403 : reason === "not_found" ? 404 : 400, { ok: false, error: reason });
    const image = (v: { bytes: Uint8Array; contentType: PhotoType }) => new Response(v.bytes as unknown as BodyInit, { status: 200, headers: { "content-type": v.contentType, "cache-control": "no-store, private", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'", "referrer-policy": "no-referrer", "content-disposition": "inline" } });
    if (req.method === "GET" && path === "/api/photos/consent") return json(200, { ...PHOTO_CONSENT, apps: PHOTO_APPS });
    const link = /^\/api\/photos\/(view|media)\/(ph_[a-f0-9]{24})$/.exec(path);
    if (link && req.method === "GET") {
      const u = new URL(req.url);
      const exp = Number(u.searchParams.get("exp")), sig = u.searchParams.get("sig") ?? "";
      const v = link[1] === "view" ? await this.view(link[2]!, exp, sig) : await this.media(link[2]!, exp, sig);
      return v ? image(v) : json(404, { ok: false, error: "not_found" });
    }
    if (!this.enabled) return refuse("photos_off");
    const person = await who();
    if (person === "unauthorized") return json(401, { ok: false, error: "unauthorized" });
    if (!person) return refuse("adults_only");
    if (req.method === "GET" && path === "/api/photos") {
      const eligible = PHOTO_APPS.includes(app) && !(await this.adult(person, app));
      return json(200, { ok: true, eligible, photos: eligible ? await this.list(person, app) : [] });
    }
    if (req.method === "POST" && path === "/api/photos") {
      // Read with a cap: a chunked body (no Content-Length) is abandoned as soon as it passes the limit.
      const buf = await readCapped(req, PHOTO_MAX_BYTES);
      if (buf === "too_large") return refuse("too_large");
      const r = await this.upload(person, app, buf, req.headers.get("x-photo-consent") ?? undefined);
      return r.ok ? json(200, { ok: true, id: r.value.id }) : refuse(r.reason);
    }
    if (req.method === "POST" && (path === "/api/photos/delete" || path === "/api/photos/consent")) {
      let b: Record<string, unknown> | undefined;
      try { b = (await req.json()) as Record<string, unknown>; } catch { /* not JSON */ }
      if (path === "/api/photos/consent") {
        const r = await this.agree(person, app, b?.version);
        return r.ok ? json(200, { ok: true, version: r.value.version }) : refuse(r.reason);
      }
      const id = b?.id;
      if (typeof id !== "string" || !/^ph_[a-f0-9]{24}$/.test(id)) return json(400, { ok: false, error: "invalid" });
      return (await this.remove(person, app, id)) ? json(200, { ok: true }) : refuse("not_found");
    }
    return json(404, { ok: false, error: "not_found" });
  }
}
