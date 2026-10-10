// Private member photos (slop.date only; founder decision 2026-10-08: photos and any rating from
// them are for adults only (founder decision 9: the stated age, no ID check), never for members aged
// 13-17, and scores are agent_private and never shown to anyone).
//
// Rules, in the order they are checked:
//  - Photos are off unless storage is configured (PHOTO_STORAGE): every route answers photos_off.
//  - Upload (the site, or a photo sent by text after the photo consent): a signed-in member of an app
//    that takes photos (PHOTO_APPS), with the photo consent of the current version (PHOTO_CONSENT),
//    not banned, whose person is an adult (lowest age 18 or more, never unknown) and passes the app's
//    own check (`eligible`: for slop, a member stated 18+ with no failed staff age check; decision 9).
//    JPEG, PNG or WebP only (checked on the bytes, not the header), at most PHOTO_MAX_BYTES and
//    PHOTO_MAX_PER_PERSON. Metadata is stripped before anything is stored, by an allowlist: only the
//    parts a decoder needs are kept (stripMetadata), so EXIF with GPS, XMP, comments, text chunks and
//    anything unknown never reach storage. A refused photo is never stored and never rated.
//  - Storage: object storage under a random key (R2 in production, a 0700 folder in dev). There is no
//    public URL. Staff see a photo only through the backend: the service's audited photo route makes
//    a signed link that works for 5 minutes (viewUrl / view).
//  - Rating: an engine AppearanceRater (production: photoRaterFromEnv, Cloudflare Workers AI Clef;
//    AGENTS.md decisions 12 and 13). Ratings are ON by default (founder, 2026-10-09: CLEF_RATINGS
//    unset or `on`; `off` turns them off). Without CLEF_WEIGHTS_PATH the engine's placeholder Clef
//    weights are used (status on_placeholder) until fitted weights pass the P2 decision rule; a weights
//    file must carry a version and a provenance record or it is refused. Without the Workers AI token
//    and account id nothing is rated (off_env). It rates the MEMBER from their newest photos (at most 4,
//    at most 4 MiB each, bytes only, never a URL) after every upload or delete, only for a verified
//    adult with a live membership who is not banned (checked before any byte is read: zero rater calls
//    otherwise, and checked again when the rater returns and after the write: a score is discarded if
//    the age dropped under 18, a ban landed, the member left or a rated photo was deleted meanwhile),
//    with retries on API errors (withRetry; each try is a cost row). The score goes to `onRating` (the
//    service stores it with the engine's appearanceFacet, agent_private) and is never returned by any
//    route or shown in the console. No rater: ratings are off and everything else works.
//  - Delete: the member deletes one photo (the rating is dropped, then made again from what is left);
//    leaving the app or deleting everything deletes them all; a person whose lowest age drops under 18
//    loses them all (deleteFor), and their rating with them.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { S3Client, type SQL } from "bun";
import type { AppId } from "./apps.ts";
import { readCapped } from "./body.ts";
import type { MembershipState, PeopleStore } from "./store.ts";
import type { AppearanceRater, AppearanceScore, RatingSubject } from "../../engine/src/packs/slop/appearance.ts";
import { makeClefRaterFromEnv, type ClefRaterOptions } from "../../engine/src/packs/slop/clef.ts";
import { DEFAULT_CLEF_WEIGHTS, validateClefWeights, type ClefWeights } from "../../engine/src/packs/slop/clefWeights.ts";
import { isOpaquePhotoId } from "../../engine/src/relay.ts";

/** Why the rater is on or off (server.ts logs it at start, with the weights version). */
export type RaterStatus = "on" | "on_placeholder" | "off_flag" | "off_env" | "refused_weights";

/**
 * The slop.date photo rater from the environment (AGENTS.md decisions 12 and 13, "Clef ratings" and
 * founder decision 5 of 2026-10-09). Ratings are ON by default: CLEF_RATINGS unset or `on` means on,
 * `off` turns them off, and any other value is refused (off) so a typo never rates anyone by surprise.
 * On, it needs CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID (without them: off_env; photos still work
 * and nothing is rated). Weights: with no CLEF_WEIGHTS_PATH the engine's placeholder weights are used
 * (status on_placeholder) until fitted weights pass the P2 decision rule; a file given by
 * CLEF_WEIGHTS_PATH must be fitted weights with a version and a provenance record (what it was fitted
 * on), or it is refused and ratings stay off. The rater is the engine's Clef behind its adults-only
 * guard, with up to 3 tries on an API error.
 */
export async function photoRaterFromEnv(
  env: Record<string, string | undefined>,
  o: { fetch?: ClefRaterOptions["fetch"]; sleep?: (ms: number) => Promise<void>; log?: (s: string) => void; readFile?: (path: string) => Promise<string> } = {},
): Promise<{ rater?: AppearanceRater; status: RaterStatus; weights?: string; detail?: string }> {
  const flag = (env.CLEF_RATINGS ?? "").trim().toLowerCase();
  if (flag === "off") return { status: "off_flag" };
  if (flag !== "" && flag !== "on") return { status: "off_flag", detail: `CLEF_RATINGS must be on or off (got ${JSON.stringify(env.CLEF_RATINGS)})` };
  if (!env.CLOUDFLARE_AI_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return { status: "off_env", detail: "CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID are required" };
  let w: ClefWeights = DEFAULT_CLEF_WEIGHTS;
  if (env.CLEF_WEIGHTS_PATH) {
    try {
      const raw = JSON.parse(await (o.readFile ?? (p => Bun.file(p).text()))(env.CLEF_WEIGHTS_PATH)) as ClefWeights & { provenance?: unknown };
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

/**
 * A new photo id: "ph_" and 24 hex characters. Ids with a run of 7 or more digits are drawn again, so
 * every id passes the engine's `isOpaquePhotoId` (which refuses digit runs because they read as phone
 * numbers); about a quarter of plain random hex ids have such a run.
 */
export function newPhotoId(): string {
  for (;;) {
    const id = `ph_${randomBytes(12).toString("hex")}`;
    if (isOpaquePhotoId(id)) return id;
  }
}

export interface PhotoRow {
  id: string; personId: string; app: AppId; storageKey: string; contentType: PhotoType; bytes: number; sha256: string;
  consentVersion: string; createdAt: number;
}
/** The rater: the engine's member-level AppearanceRater (production: makeClefRaterFromEnv). */
export type PhotoRater = AppearanceRater;
/** Photos one rating reads (Clef takes at most 4 images, each at most 4 MiB, as base64). */
export const RATER_MAX_PHOTOS = 4;
export const RATER_MAX_BYTES = 4 * 1024 * 1024;

/** An error worth another try: a network failure, a timeout, or an API answer of 429 or 5xx (ClefError carries the status). */
export function retryable(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  // fetch failures are TypeErrors; a timeout is a TimeoutError or AbortError. Anything else (a photo too large, a bad answer) is not retried.
  return e instanceof TypeError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
}

export interface RetryOptions { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void>; log?: (s: string) => void }
const retried = new WeakMap<AppearanceRater, { inner: AppearanceRater; options: RetryOptions }>();
/** The rater inside a withRetry wrapper and its options (the cost ledger meters each try: cost.ts meterRater). */
export const retryParts = (r: AppearanceRater) => retried.get(r);

/**
 * The rater with retries on API errors: up to `attempts` calls with a doubling wait (the wait goes
 * through `sleep`, so a simulation never waits). A refusal (null) is an answer, never retried.
 */
export function withRetry(r: AppearanceRater, o: RetryOptions = {}): AppearanceRater {
  const attempts = Math.max(1, o.attempts ?? 3), base = o.baseMs ?? 500, sleep = o.sleep ?? (ms => Bun.sleep(ms));
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
 * The image with its metadata removed, by an allowlist: only what a decoder needs is copied, and
 * everything else (EXIF and its GPS block, XMP, IPTC, ICC profiles, comments, text chunks, maker
 * notes, chunks nobody has named yet) is dropped. The pixels are not touched. A malformed file throws
 * BadImage (never stored).
 *   JPEG  SOI, DQT, SOF*, DHT, DAC, DRI, DNL, SOS with its scan data, EOI; APP0 only as a bare JFIF
 *         header (its thumbnail removed) and APP14 only as the 12-byte Adobe colour-transform header.
 *   PNG   IHDR, PLTE, IDAT, IEND, tRNS, gAMA and sRGB (colour only, no text). iCCP is dropped: its
 *         profile name and description are free text.
 *   WebP  VP8, VP8L, VP8X, ALPH, ANIM and ANMF (and inside each frame only ALPH, VP8 and VP8L). The
 *         VP8X flags for ICC, EXIF and XMP are cleared.
 */
export function stripMetadata(b: Uint8Array, type: PhotoType): Uint8Array {
  if (type === "image/jpeg") return stripJpeg(b);
  if (type === "image/png") return stripPng(b);
  return stripWebp(b);
}

/** JPEG markers a decoder needs (besides SOI, SOS, EOI and the bare markers): SOF0-SOF15 without DHT (C4), JPG (C8) and DAC (CC), then DHT, DAC, DQT, DNL, DRI. */
const JPEG_KEEP = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf, 0xc4, 0xcc, 0xdb, 0xdc, 0xdd]);

/**
 * JPEG: segments are copied only when JPEG_KEEP has them, scan by scan (progressive files have
 * several), and nothing after the first EOI. Phones append whole second images after EOI (MPF
 * pictures, depth maps, motion-photo trailers) with their own EXIF and GPS: those never survive.
 */
function stripJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2, scanned = false, jfif = false;
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
    // Bare markers (no length): TEM, restart markers; 0xFF is fill before a marker.
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (m === 0xff) { i += 1; continue; }
    if (i + 4 > b.length) throw new BadImage("jpeg: truncated");
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) throw new BadImage("jpeg: bad segment");
    const payload = b.subarray(i + 4, i + 2 + len);
    if (JPEG_KEEP.has(m)) out.push(b.subarray(i, i + 2 + len));
    else if (m === 0xe0 && !jfif && payload.length >= 14 && ascii(payload, 0, 5) === "JFIF\0") {
      // JFIF: version, units and density only; the thumbnail (and anything after it) is dropped.
      out.push(Uint8Array.of(0xff, 0xe0, 0x00, 0x10), payload.subarray(0, 12), Uint8Array.of(0, 0));
      jfif = true;
    } else if (m === 0xee && payload.length === 12 && ascii(payload, 0, 5) === "Adobe") out.push(b.subarray(i, i + 2 + len)); // the colour transform of CMYK/YCCK files: flags only
    i += 2 + len;
  }
  // A file cut off after its scan data (no EOI): keep the image, close it.
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
/** RIFF chunks from `at` to `end`, each with its padding; only the types in `keep`. */
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
        // A frame: its 16-byte header, then its own chunks (only the image ones are kept).
        if (len < 16) throw new BadImage("webp: bad frame");
        const inner = concat(riffChunks(b, i + 24, i + 8 + len, WEBP_FRAME_KEEP));
        const size = 16 + inner.length;
        const head = b.slice(i, i + 24);
        head[4] = size & 0xff; head[5] = (size >> 8) & 0xff; head[6] = (size >> 16) & 0xff; head[7] = (size >>> 24) & 0xff;
        chunks.push(head, inner);
      } else {
        const c = b.slice(i, i + 8 + Math.min(padded, end - i - 8));
        if (type === "VP8X" && c.length > 8) c[8] = c[8]! & ~0x2c; // the ICC (0x20), EXIF (0x08) and XMP (0x04) flags
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
export type PhotoRefusal = "photos_off" | "app_not_allowed" | "consent_required" | "adults_only" | "not_verified" | "banned" | "too_large" | "bad_type" | "bad_image" | "too_many" | "not_found" | "not_member";
/** Membership states in which a member may be rated (left or removed: never). */
const LIVE_MEMBERSHIP: readonly MembershipState[] = ["active", "paused", "onboarding"];
export type PhotoResult<T> = { ok: true; value: T } | { ok: false; reason: PhotoRefusal };

export interface PhotoServiceOptions {
  people: PeopleStore;
  meta: PhotoStore;
  storage?: PhotoStorage;
  /** Key for the staff view links (derived from PLATFORM_HASH_KEY). */
  signingKey: string;
  now?: () => number;
  /** The appearance rater (wrap it in withRetry). Undefined: ratings are off; uploads still work. */
  rater?: PhotoRater;
  /**
   * The app's own adult check for this person, beyond the lowest age (slop: the member's stated age
   * is 18+ and no staff age check failed; decision 9). The service reads the network rows. Default: refuse (fail closed).
   */
  eligible?: (personId: string, app: AppId) => Promise<boolean>;
  /** A staff ban on the person or any of their phones (platform.bans). A banned person's photo is never taken. Default: not banned. */
  banned?: (personId: string) => Promise<boolean>;
  /** The member's rating from their photos: the service stores it with appearanceFacet (agent_private). Never returned by a route. */
  onRating?: (personId: string, app: AppId, score: AppearanceScore, subject: RatingSubject) => Promise<void>;
  /** A photo is gone (removed, left, deleted, a minor age, a ban): the service deletes the member's rating. */
  onRemoved?: (personId: string, app: AppId, photoId: string) => Promise<void>;
  log?: (s: string) => void;
}

export class PhotoService {
  private readonly now: () => number;
  constructor(private readonly o: PhotoServiceOptions) { this.now = o.now ?? Date.now; }
  get enabled() { return !!this.o.storage; }
  get rating() { return !!this.o.rater; }

  /** An adult on this app: lowest age 18+ (an unknown age fails) and the app's own check (slop: no failed staff age check). */
  async adult(personId: string, app: AppId): Promise<PhotoRefusal | undefined> {
    const p = await this.o.people.getPerson(personId);
    if (!p || p.deletedAt !== null || p.lowestAge === null || p.lowestAge < 18) return "adults_only";
    if (!(await (this.o.eligible?.(personId, app) ?? Promise.resolve(false)))) return "not_verified";
    return undefined;
  }

  /**
   * Whether this person may give a photo to this app now: photos on, an app that takes photos, not
   * banned, an adult. Checked before any byte is read (an MMS photo is not even fetched otherwise).
   */
  async mayTake(personId: string, app: AppId): Promise<PhotoRefusal | undefined> {
    if (!this.o.storage) return "photos_off";
    if (!PHOTO_APPS.includes(app)) return "app_not_allowed";
    if (await (this.o.banned?.(personId) ?? Promise.resolve(false))) return "banned";
    return this.adult(personId, app);
  }

  async upload(personId: string, app: AppId, input: Uint8Array, consentVersion: string | undefined): Promise<PhotoResult<{ id: string }>> {
    if (!this.o.storage) return { ok: false, reason: "photos_off" };
    if (!PHOTO_APPS.includes(app)) return { ok: false, reason: "app_not_allowed" };
    if (consentVersion !== PHOTO_CONSENT.version) return { ok: false, reason: "consent_required" };
    const who = await this.mayTake(personId, app);
    if (who) return { ok: false, reason: who };
    if (input.length > PHOTO_MAX_BYTES) return { ok: false, reason: "too_large" };
    const type = sniffType(input);
    if (!type) return { ok: false, reason: "bad_type" };
    if ((await this.o.meta.list(personId)).length >= PHOTO_MAX_PER_PERSON) return { ok: false, reason: "too_many" };
    let bytes: Uint8Array;
    try { bytes = stripMetadata(input, type); } catch { return { ok: false, reason: "bad_image" }; }
    const id = newPhotoId();
    const key = randomBytes(24).toString("hex");
    await this.o.storage.put(key, bytes, type);
    await this.o.meta.put({ id, personId, app, storageKey: key, contentType: type, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), consentVersion, createdAt: this.now() });
    await this.rate(personId, app).catch(e => this.o.log?.(`[photos] rating failed: ${(e as Error).message}`));
    return { ok: true, value: { id } };
  }

  /**
   * Whether a rating of this person on this app may be made or kept now: photos on, not banned, an
   * adult (lowest age and the app's own check), a live membership of the app and, when `photoIds` is
   * given, every one of those photos still there. Undefined: yes.
   */
  private async ratingRefusal(personId: string, app: AppId, photoIds?: readonly string[]): Promise<PhotoRefusal | undefined> {
    const who = await this.mayTake(personId, app);
    if (who) return who;
    const m = await this.o.people.getMembership(personId, app);
    if (!m || !LIVE_MEMBERSHIP.includes(m.state)) return "not_member";
    if (photoIds) for (const id of photoIds) { const r = await this.o.meta.get(id); if (!r || r.personId !== personId || r.app !== app) return "not_found"; }
    return undefined;
  }

  /**
   * Rate the member from their newest photos (at most RATER_MAX_PHOTOS, each at most RATER_MAX_BYTES)
   * with the configured rater. Refused (no rater call, nothing written) for anyone who is not a
   * verified adult with a live membership now, or is banned. A rater call takes seconds, so everything
   * is checked again when it returns (the lowest age can drop under 18, a ban can land, the member can
   * leave or delete a photo meanwhile): the score is discarded unless all still hold. It is checked a
   * third time after the write, and a change that landed during the write drops the rating again
   * (onRemoved). No rater: nothing happens. Returns whether a score was written.
   */
  async rate(personId: string, app: AppId): Promise<{ rated: boolean; refused?: PhotoRefusal }> {
    const rater = this.o.rater;
    if (!rater || !this.o.storage) return { rated: false };
    const who = await this.ratingRefusal(personId, app);
    if (who) return { rated: false, refused: who };
    const person = await this.o.people.getPerson(personId);
    const subject: RatingSubject = { age: person!.lowestAge!, ageVerified: true };
    const rows = (await this.o.meta.list(personId, app)).filter(r => r.bytes <= RATER_MAX_BYTES).slice(-RATER_MAX_PHOTOS);
    const photos: { id: string; bytes: Uint8Array }[] = [];
    for (const r of rows) { const bytes = await this.o.storage.get(r.storageKey); if (bytes) photos.push({ id: r.id, bytes }); }
    if (!photos.length) return { rated: false, refused: "not_found" };
    const s = await rater.rate(subject, photos);
    if (!s) return { rated: false };
    const ids = photos.map(p => p.id);
    const changed = await this.ratingRefusal(personId, app, ids);
    if (changed) {
      this.o.log?.(`[photos] rating discarded: ${changed} while the rater ran`);
      return { rated: false, refused: changed };
    }
    await this.o.onRating?.(personId, app, s, subject);
    const late = await this.ratingRefusal(personId, app, ids);
    if (late) {
      this.o.log?.(`[photos] rating dropped: ${late} while it was written`);
      await this.o.onRemoved?.(personId, app, ids[0]!);
      return { rated: false, refused: late };
    }
    return { rated: true };
  }

  /** The member's own photos (no bytes, no score). */
  async list(personId: string, app: AppId) { return (await this.o.meta.list(personId, app)).map(r => ({ id: r.id, createdAt: r.createdAt, bytes: r.bytes, contentType: r.contentType })); }

  /** The member deletes one of their photos: the rating goes with it and is made again from what is left. */
  async remove(personId: string, app: AppId, id: string): Promise<boolean> {
    const r = await this.o.meta.get(id);
    if (!r || r.personId !== personId || r.app !== app) return false;
    await this.o.storage?.delete(r.storageKey);
    await this.o.meta.delete(id);
    await this.o.onRemoved?.(personId, r.app, id);
    await this.rate(personId, app).catch(e => this.o.log?.(`[photos] rating failed: ${(e as Error).message}`));
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
   *   GET  /api/photos                 {eligible, photos}: may this person add a photo; their own photos (ids only)
   *   POST /api/photos                 the image bytes (Content-Type image/*), X-Photo-Consent: <version>
   *   POST /api/photos/delete          {id}
   *   GET  /api/photos/view/<id>?exp=&sig=   a signed staff link
   */
  async route(req: Request, path: string, app: AppId, who: () => Promise<string | null | "unauthorized">): Promise<Response | undefined> {
    if (path !== "/api/photos" && !path.startsWith("/api/photos/")) return undefined;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    // A ban answers like a join refused for review: it never says "banned".
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
    // `eligible`: whether this person may add a photo here now (an adult, not banned, an app that takes
    // photos). The settings page shows the photo section only when it is true or a photo is still there to
    // delete, so a 13-17 member is never shown the consent text or an upload control.
    if (req.method === "GET" && path === "/api/photos") return json(200, { ok: true, eligible: (await this.mayTake(person, app)) === undefined, photos: await this.list(person, app) });
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
