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
//  - Rating: an optional rater (`rate(photo) -> {face, body, overall}`), default "none". It runs only
//    for a verified adult (checked again at rating time); its scores go to `onRating` (the service
//    writes them as agent_private facets) and are never returned by any route.
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

export interface PhotoRow {
  id: string; personId: string; app: AppId; storageKey: string; contentType: PhotoType; bytes: number; sha256: string;
  consentVersion: string; createdAt: number;
}
export interface PhotoScores { face: number; body: number; overall: number }
/** An optional rater (the engine session builds the CLIP rater). "none" never rates. */
export interface PhotoRater { id: string; rate(photo: { bytes: Uint8Array; contentType: PhotoType }): Promise<PhotoScores | undefined> }
export const NO_RATER: PhotoRater = { id: "none", rate: async () => undefined };

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
}
export class MemoryPhotoStore implements PhotoStore {
  readonly rows = new Map<string, PhotoRow>();
  async put(r: PhotoRow) { this.rows.set(r.id, { ...r }); }
  async get(id: string) { const r = this.rows.get(id); return r && { ...r }; }
  async list(personId: string, app?: AppId) { return [...this.rows.values()].filter(r => r.personId === personId && (!app || r.app === app)).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)).map(r => ({ ...r })); }
  async delete(id: string) { this.rows.delete(id); }
}
const photoRow = (r: Record<string, any>): PhotoRow => ({
  id: r.id, personId: r.person_id, app: r.app_id, storageKey: r.storage_key, contentType: r.content_type, bytes: r.bytes, sha256: r.sha256,
  consentVersion: r.consent_version, createdAt: new Date(r.created_at).getTime(),
});
/** platform.photos (migration 0011). A deleted photo's row is removed (the bytes first). */
export class PgPhotoStore implements PhotoStore {
  constructor(private readonly sql: SQL) {}
  async put(r: PhotoRow) {
    await this.sql`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at)
      values (${r.id}, ${r.personId}, ${r.app}, ${r.storageKey}, ${r.contentType}, ${r.bytes}, ${r.sha256}, ${r.consentVersion}, ${new Date(r.createdAt)})`;
  }
  async get(id: string) { const [r] = await this.sql`select * from platform.photos where id = ${id} and deleted_at is null`; return r ? photoRow(r) : undefined; }
  async list(personId: string, app?: AppId) {
    const rows = app
      ? await this.sql`select * from platform.photos where person_id = ${personId}::uuid and app_id = ${app} and deleted_at is null order by created_at, id`
      : await this.sql`select * from platform.photos where person_id = ${personId}::uuid and deleted_at is null order by created_at, id`;
    return (rows as Record<string, any>[]).map(photoRow);
  }
  async delete(id: string) { await this.sql`delete from platform.photos where id = ${id}`; }
}

// ------------------------------------------------------------------------------------ service
export type PhotoRefusal = "photos_off" | "app_not_allowed" | "consent_required" | "adults_only" | "not_verified" | "too_large" | "bad_type" | "bad_image" | "too_many" | "not_found";
export type PhotoResult<T> = { ok: true; value: T } | { ok: false; reason: PhotoRefusal };

export interface PhotoServiceOptions {
  people: PeopleStore;
  meta: PhotoStore;
  storage?: PhotoStorage;
  /** Key for the staff view links (derived from PLATFORM_HASH_KEY). */
  signingKey: string;
  now?: () => number;
  rater?: PhotoRater;
  /**
   * The app's own adult check for this person, beyond the lowest age (slop: the member's stated age
   * is 18+ and no staff age check failed; decision 9). The service reads the network rows. Default: refuse (fail closed).
   */
  eligible?: (personId: string, app: AppId) => Promise<boolean>;
  /** The rater's scores for one photo: the service writes them as agent_private facets. Never returned by a route. */
  onRating?: (personId: string, app: AppId, photoId: string, scores: PhotoScores) => Promise<void>;
  /** A photo is gone (removed, left, deleted, a minor age): the service deletes its rating too. */
  onRemoved?: (personId: string, app: AppId, photoId: string) => Promise<void>;
  log?: (s: string) => void;
}

export class PhotoService {
  private readonly now: () => number;
  constructor(private readonly o: PhotoServiceOptions) { this.now = o.now ?? Date.now; }
  get enabled() { return !!this.o.storage; }

  /** An adult on this app: lowest age 18+ (an unknown age fails) and the app's own check (slop: no failed staff age check). */
  async adult(personId: string, app: AppId): Promise<PhotoRefusal | undefined> {
    const p = await this.o.people.getPerson(personId);
    if (!p || p.deletedAt !== null || p.lowestAge === null || p.lowestAge < 18) return "adults_only";
    if (!(await (this.o.eligible?.(personId, app) ?? Promise.resolve(false)))) return "not_verified";
    return undefined;
  }

  async upload(personId: string, app: AppId, input: Uint8Array, consentVersion: string | undefined): Promise<PhotoResult<{ id: string }>> {
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
    await this.o.meta.put({ id, personId, app, storageKey: key, contentType: type, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), consentVersion, createdAt: this.now() });
    await this.rate(personId, app, id).catch(e => this.o.log?.(`[photos] rating failed: ${(e as Error).message}`));
    return { ok: true, value: { id } };
  }

  /**
   * Rate one photo with the configured rater. Refused (nothing rated, nothing written) for anyone who
   * is not a verified adult now. The rater "none" never rates. Returns whether scores were written.
   */
  async rate(personId: string, app: AppId, photoId: string): Promise<{ rated: boolean; refused?: PhotoRefusal }> {
    const rater = this.o.rater ?? NO_RATER;
    if (rater.id === "none" || !this.o.storage) return { rated: false };
    const who = await this.adult(personId, app);
    if (who) return { rated: false, refused: who };
    const row = await this.o.meta.get(photoId);
    if (!row || row.personId !== personId || row.app !== app) return { rated: false, refused: "not_found" };
    const bytes = await this.o.storage.get(row.storageKey);
    if (!bytes) return { rated: false, refused: "not_found" };
    const s = await rater.rate({ bytes, contentType: row.contentType });
    if (!s) return { rated: false };
    const clamp = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
    await this.o.onRating?.(personId, app, photoId, { face: clamp(s.face), body: clamp(s.body), overall: clamp(s.overall) });
    return { rated: true };
  }

  /** The member's own photos (no bytes, no score). */
  async list(personId: string, app: AppId) { return (await this.o.meta.list(personId, app)).map(r => ({ id: r.id, createdAt: r.createdAt, bytes: r.bytes, contentType: r.contentType })); }

  /** The member deletes one of their photos. */
  async remove(personId: string, app: AppId, id: string): Promise<boolean> {
    const r = await this.o.meta.get(id);
    if (!r || r.personId !== personId || r.app !== app) return false;
    await this.o.storage?.delete(r.storageKey);
    await this.o.meta.delete(id);
    await this.o.onRemoved?.(personId, r.app, id);
    return true;
  }

  /** Every photo of a person (on one app, or every app): leave, delete everything, a minor age, a ban. Bytes first, then rows. */
  async deleteFor(personId: string, app?: AppId): Promise<number> {
    const rows = await this.o.meta.list(personId, app);
    for (const r of rows) { await this.o.storage?.delete(r.storageKey); await this.o.meta.delete(r.id); await this.o.onRemoved?.(personId, r.app, r.id); }
    if (rows.length) this.o.log?.(`[photos] deleted ${rows.length} photo(s)${app ? ` on ${app}` : ""}`);
    return rows.length;
  }

  /**
   * Signed links for staff (the service's photo route, after its audit row): adults only, checked
   * again here. Each link works for PHOTO_VIEW_TTL_MS through GET /api/photos/view/<id>.
   */
  async staffLinks(personId: string, app: AppId, base: string): Promise<PhotoResult<{ id: string; url: string; expiresAt: number }[]>> {
    if (!this.o.storage) return { ok: false, reason: "photos_off" };
    const who = await this.adult(personId, app);
    if (who) return { ok: false, reason: "adults_only" };
    const exp = this.now() + PHOTO_VIEW_TTL_MS;
    const rows = await this.o.meta.list(personId, app);
    return { ok: true, value: rows.map(r => ({ id: r.id, url: `${base.replace(/\/+$/, "")}/api/photos/view/${r.id}?exp=${exp}&sig=${this.sign(r.id, exp)}`, expiresAt: exp })) };
  }

  private sign(id: string, exp: number) { return createHmac("sha256", `photo-view:${this.o.signingKey}`).update(`${id}.${exp}`).digest("base64url"); }

  /** The bytes behind a signed staff link, or undefined (bad or old signature, deleted photo, or the person is no longer an adult). */
  async view(id: string, exp: number, sig: string): Promise<{ bytes: Uint8Array; contentType: PhotoType } | undefined> {
    if (!this.o.storage || !Number.isFinite(exp) || exp < this.now() || exp > this.now() + PHOTO_VIEW_TTL_MS) return undefined;
    const want = Buffer.from(this.sign(id, exp)), got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
    const r = await this.o.meta.get(id);
    if (!r || (await this.adult(r.personId, r.app))) return undefined;
    const bytes = await this.o.storage.get(r.storageKey);
    return bytes && { bytes, contentType: r.contentType };
  }

  /**
   * The /api/photos routes, for the public API (api.ts). `personId` is the signed-in person (null:
   * not signed in, or no person yet). Undefined: not a photo route.
   *   GET  /api/photos/consent         the consent text and version
   *   GET  /api/photos                 the member's own photos (ids only)
   *   POST /api/photos                 the image bytes (Content-Type image/*), X-Photo-Consent: <version>
   *   POST /api/photos/delete          {id}
   *   GET  /api/photos/view/<id>?exp=&sig=   a signed staff link
   */
  async route(req: Request, path: string, app: AppId, who: () => Promise<string | null | "unauthorized">): Promise<Response | undefined> {
    if (path !== "/api/photos" && !path.startsWith("/api/photos/")) return undefined;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    const refuse = (reason: PhotoRefusal) => json(reason === "photos_off" ? 503 : reason === "too_large" ? 413 : reason === "adults_only" || reason === "not_verified" ? 403 : reason === "not_found" ? 404 : 400, { ok: false, error: reason });
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
    if (req.method === "GET" && path === "/api/photos") return json(200, { ok: true, photos: await this.list(person, app) });
    if (req.method === "POST" && path === "/api/photos") {
      // Read with a cap: a chunked body (no Content-Length) is abandoned as soon as it passes the limit.
      const buf = await readCapped(req, PHOTO_MAX_BYTES);
      if (buf === "too_large") return refuse("too_large");
      const r = await this.upload(person, app, buf, req.headers.get("x-photo-consent") ?? undefined);
      return r.ok ? json(200, { ok: true, id: r.value.id }) : refuse(r.reason);
    }
    if (req.method === "POST" && path === "/api/photos/delete") {
      let id: unknown;
      try { id = ((await req.json()) as Record<string, unknown>)?.id; } catch { /* not JSON */ }
      if (typeof id !== "string" || !/^ph_[a-f0-9]{24}$/.test(id)) return json(400, { ok: false, error: "invalid" });
      return (await this.remove(person, app, id)) ? json(200, { ok: true }) : refuse("not_found");
    }
    return json(404, { ok: false, error: "not_found" });
  }
}
