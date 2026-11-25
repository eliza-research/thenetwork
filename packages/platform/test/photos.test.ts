import { fileAt } from "../../core/src/runtime/files.ts";
import { serveHttp } from "../../core/src/runtime/http.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS, type AppId } from "../src/apps.ts";
import { createPublicApi } from "../src/api.ts";
import {
  BadImage, LocalDiskPhotoStorage, PgPhotoStore, PHOTO_CONSENT, R2PhotoStorage, PHOTO_MAX_BYTES, PHOTO_MAX_PER_PERSON, PHOTO_VIEW_TTL_MS, PhotoService, sniffType, stripMetadata, withRetry,
  type PhotoRater, type PhotoRefusal, type PhotoStorage,
} from "../src/photos.ts";
import { PHOTO_SEND_NOTICE, PhotoRelayService, PgPhotoRelayStore } from "../src/photo-relay.ts";
import { simulatedPhotoScreen } from "../src/photo-screen.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import type { AppearanceScore } from "../../engine/src/packs/slop/appearance.ts";
import { CostLedger, PgCostSink } from "../../network/service/cost.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const T = 120_000;
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...xs: (Uint8Array | number[])[]) => { const parts = xs.map(x => (x instanceof Uint8Array ? x : Uint8Array.from(x))); const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s));
const sha256Hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const hmac = (key: Uint8Array | string, text: string) => createHmac("sha256", key).update(text).digest();
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function sigV4Valid(req: Request, body: Uint8Array, accessKeyId: string, secret: string): boolean {
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/.exec(req.headers.get("authorization") ?? "");
  if (!m || m[1] !== accessKeyId) return false;
  const [, , day, region, service, signed, signature] = m;
  const payload = req.headers.get("x-amz-content-sha256") ?? "";
  if (payload !== "UNSIGNED-PAYLOAD" && payload !== sha256Hex(body)) return false;
  const url = new URL(req.url);
  const query = [...url.searchParams].map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).sort().join("&");
  const headers = signed.split(";").map(n => `${n}:${(req.headers.get(n) ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", req.headers.get("x-amz-date") ?? "", scope, sha256Hex([req.method, url.pathname, query, headers, signed, payload].join("\n"))].join("\n");
  const key = [day, region, service, "aws4_request"].reduce<Uint8Array | string>((k, part) => hmac(k, part), `AWS4${secret}`);
  return createHmac("sha256", key).update(toSign).digest("hex") === signature;
}
const seg = (marker: number, payload: Uint8Array) => cat([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff], payload);

// ------------------------------------------------------------------ the corpus
/** JFIF with a 1x1 thumbnail (3 bytes of RGB that must not survive). */
const jfif = () => seg(0xe0, cat(enc("JFIF\0"), [1, 1, 0, 0, 1, 0, 1, 1, 1], enc("TMB")));
/** A small JPEG with JFIF (and its thumbnail), EXIF with GPS, XMP, IPTC, an ICC profile, an unknown APP segment, a comment, tables, a restart interval and a scan. */
const jpeg = () => cat([0xff, 0xd8], jfif(), seg(0xe1, enc("Exif\0\0GPSLatitude 40.7128")), seg(0xe1, enc("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPSXMP</x:xmpmeta>")),
  seg(0xed, enc("Photoshop 3.0\0IPTCCITY")), seg(0xe2, enc("ICC_PROFILE\0iPhone ICC")), seg(0xe9, enc("UNKNOWNAPP")), seg(0xfe, enc("shot on my phone")),
  seg(0xdb, new Uint8Array(65)), seg(0xc0, new Uint8Array(15)), seg(0xc4, new Uint8Array(20)), seg(0xdd, Uint8Array.of(0, 4)), seg(0xda, new Uint8Array(10)), enc("SCANDATA"), [0xff, 0xd9]);
const chunk = (type: string, data: Uint8Array) => cat([0, 0, data.length >> 8, data.length & 0xff], enc(type), data, [0, 0, 0, 0]);
/** A PNG with tEXt, iTXt, zTXt, eXIf, tIME, iCCP and an unknown private chunk around the image chunks. */
const png = () => cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk("IHDR", new Uint8Array(13)), chunk("gAMA", new Uint8Array(4)), chunk("sRGB", new Uint8Array(1)),
  chunk("iCCP", enc("Phone profile\0\0ICCDATA")), chunk("tEXt", enc("GPS\x0040.71,-73.95")), chunk("iTXt", enc("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>ITXTGPS</x:xmpmeta>")),
  chunk("zTXt", enc("Comment\0\0ZTXTDATA")), chunk("eXIf", enc("MM\0*EXIFGPS")), chunk("tIME", new Uint8Array(7)), chunk("prVt", enc("PRIVATECHUNK")),
  chunk("PLTE", new Uint8Array(3)), chunk("tRNS", new Uint8Array(1)), chunk("IDAT", enc("PIXELS")), chunk("IEND", new Uint8Array(0)));
const rchunk = (type: string, data: Uint8Array) => cat(enc(type), [data.length & 0xff, (data.length >> 8) & 0xff, 0, 0], data, data.length & 1 ? [0] : []);
const riff = (body: Uint8Array) => cat(enc("RIFF"), [body.length & 0xff, (body.length >> 8) & 0xff, 0, 0], body);
/** A still WebP with ICC, EXIF, XMP and an unknown chunk (and their VP8X flags set). */
const webp = () => riff(cat(enc("WEBP"), rchunk("VP8X", Uint8Array.from([0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0])), rchunk("ICCP", enc("ICCPROFILE")), rchunk("VP8 ", enc("FRAMEDATA")),
  rchunk("EXIF", enc("GPSLatitude 40.7")), rchunk("XMP ", enc("<x:xmpmeta/>")), rchunk("ZZZZ", enc("UNKNOWNWEBP"))));
/** An animated WebP: ANIM, and a frame that carries an unknown chunk inside it. */
const animated = () => riff(cat(enc("WEBP"), rchunk("VP8X", Uint8Array.from([0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0])), rchunk("ANIM", new Uint8Array(6)),
  rchunk("ANMF", cat(new Uint8Array(16), rchunk("VP8 ", enc("FRAME1")), rchunk("XYZW", enc("INFRAMEGPS"))))));

describe("metadata strip: an allowlist", () => {
  test("JPEG keeps only what a decoder needs: EXIF (GPS), XMP, IPTC, ICC, unknown APP segments, comments and the JFIF thumbnail are gone", () => {
    const j = stripMetadata(jpeg(), "image/jpeg");
    for (const x of ["Exif", "GPS", "xmpmeta", "IPTC", "ICC_PROFILE", "UNKNOWNAPP", "shot on", "TMB"]) expect([x, has(j, x)]).toEqual([x, false]);
    expect(has(j, "JFIF")).toBe(true); expect(has(j, "SCANDATA")).toBe(true);
    // The JFIF header is rewritten with no thumbnail; the tables, the frame, DRI and the scan stay in order.
    expect(Array.from(j.subarray(0, 6))).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const markers: number[] = [];
    for (let i = 2; i < j.length - 1;) { if (j[i] !== 0xff) break; markers.push(j[i + 1]!); if (j[i + 1] === 0xda || j[i + 1] === 0xd9) break; i += 2 + ((j[i + 2]! << 8) | j[i + 3]!); }
    expect(markers).toEqual([0xe0, 0xdb, 0xc0, 0xc4, 0xdd, 0xda]);
  });
  test("a second image after EOI (MPF, depth map, motion photo) and its GPS are dropped; progressive scans and stuffed bytes stay", () => {
    const second = cat([0xff, 0xd8], seg(0xe1, enc("Exif\0\0GPSLatitude 41.0001")), seg(0xda, new Uint8Array(10)), enc("TRAILERSCAN"), [0xff, 0xd9]);
    const j = stripMetadata(cat(jpeg(), second), "image/jpeg");
    expect(has(j, "GPS")).toBe(false);
    expect(has(j, "TRAILERSCAN")).toBe(false);
    expect(Array.from(j.subarray(-2))).toEqual([0xff, 0xd9]);
    // Two scans with a table and an APP segment between them; 0xFF00 and a restart marker inside the data.
    const progressive = cat([0xff, 0xd8], seg(0xda, new Uint8Array(10)), enc("SCAN1"), [0xff, 0x00, 0xff, 0xd3], enc("MORE"),
      seg(0xc4, new Uint8Array(20)), seg(0xe2, enc("ICC GPSLike")), seg(0xda, new Uint8Array(10)), enc("SCAN2"), [0xff, 0xd9]);
    const pj = stripMetadata(progressive, "image/jpeg");
    for (const x of ["SCAN1", "MORE", "SCAN2"]) expect(has(pj, x)).toBe(true);
    expect(has(pj, "GPSLike")).toBe(false);
    expect(Buffer.from(pj).includes(Buffer.from([0xff, 0x00, 0xff, 0xd3]))).toBe(true);
  });
  test("PNG keeps IHDR, PLTE, tRNS, gAMA, sRGB, IDAT and IEND; text, XMP, eXIf, time, ICC and unknown chunks are gone", () => {
    const p = stripMetadata(png(), "image/png");
    for (const x of ["tEXt", "iTXt", "zTXt", "eXIf", "tIME", "iCCP", "prVt", "GPS", "xmpmeta", "PRIVATECHUNK", "Phone profile"]) expect([x, has(p, x)]).toEqual([x, false]);
    for (const x of ["IHDR", "gAMA", "sRGB", "PLTE", "tRNS", "PIXELS", "IEND"]) expect([x, has(p, x)]).toEqual([x, true]);
    // A PNG whose first chunk is not IHDR is refused.
    expect(() => stripMetadata(cat(png().subarray(0, 8), chunk("tEXt", enc("a\0b")), chunk("IEND", new Uint8Array(0))), "image/png")).toThrow();
  });
  test("WebP keeps the image chunks only; the VP8X flags no longer claim ICC, EXIF or XMP; a frame keeps its image chunks only", () => {
    const w = stripMetadata(webp(), "image/webp");
    for (const x of ["EXIF", "xmpmeta", "ICCP", "ICCPROFILE", "ZZZZ", "UNKNOWNWEBP", "GPS"]) expect([x, has(w, x)]).toEqual([x, false]);
    expect(has(w, "FRAMEDATA")).toBe(true);
    expect(w[20]! & 0x2c).toBe(0);
    expect(w[4]! | (w[5]! << 8)).toBe(w.length - 8);
    const a = stripMetadata(animated(), "image/webp");
    expect(has(a, "FRAME1")).toBe(true); expect(has(a, "ANIM")).toBe(true);
    expect(has(a, "INFRAMEGPS")).toBe(false); expect(has(a, "XYZW")).toBe(false);
    expect(a[20]! & 0x02).toBe(0x02); // the animation flag stays
    expect(a[4]! | (a[5]! << 8)).toBe(a.length - 8);
    // The frame's own size is its header plus what is left inside it.
    const at = Buffer.from(a).indexOf(Buffer.from("ANMF"));
    expect(a[at + 4]! | (a[at + 5]! << 8)).toBe(16 + rchunk("VP8 ", enc("FRAME1")).length);
  });
  test("a WebP chunk length with the top bit set throws BadImage and finishes cleanly", () => {
    const lengths = [[0xf8, 0xff, 0xff, 0xff], [0xff, 0xff, 0xff, 0xff], [0x00, 0x00, 0x00, 0x80]];
    const files = lengths.flatMap(l => ["XXXX", "VP8 "].map(t => Uint8Array.from([...cat(enc("RIFF"), [0, 0, 0, 0], enc("WEBP"), enc(t), l)])));
    const inner = Uint8Array.from([...cat(enc("RIFF"), [0, 0, 0, 0], enc("WEBP"), enc("ANMF"), [28, 0, 0, 0], new Uint8Array(16), enc("VP8 "), [0xf8, 0xff, 0xff, 0xff], [0, 0, 0, 0])]);
    for (const f of [...files, inner]) expect(() => stripMetadata(f, "image/webp")).toThrow(BadImage);
  });
  test("the type comes from the bytes; a text file named .jpg, or a broken JPEG, is refused", () => {
    expect(sniffType(jpeg())).toBe("image/jpeg");
    expect(sniffType(png())).toBe("image/png");
    expect(sniffType(webp())).toBe("image/webp");
    expect(sniffType(enc("<svg onload=alert(1)>"))).toBeUndefined();
    expect(() => stripMetadata(cat([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00]), "image/jpeg")).toThrow();
  });
});

describe.skipIf(!pgAvailable)("PhotoService on Postgres", () => {
  let url: string, people: PgPeopleStore, sql: SQL;
  beforeAll(async () => { url = await migratedDb("photos"); people = new PgPeopleStore(url); sql = new SQL({ url, max: 2 }); }, T);
  afterAll(async () => { await people?.close(); await sql?.close(); if (url) await dropDb(url); });

  const score: AppearanceScore = { face: 0.7, body: 0.4, overall: 0.6, confidence: 0.5, model: "fake-clef" };
  let n = 0;
  const phoneHashes = new Map<string, string>();
  const stateAge = async (personId: string, age: number, at: number) => {
    await people.recordAgeReading(personId, phoneHashes.get(personId)!, { kind: "age", age }, at);
  };
  function setup(o: { rater?: PhotoRater; storage?: (inner: PhotoStorage) => PhotoStorage; log?: (s: string) => void; removalFails?: () => boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "photos-test-")); dirs.push(dir);
    const meta = new PgPhotoStore(sql);
    const verified = new Set<string>();
    const ratings: { personId: string; score: AppearanceScore }[] = [];
    const removed: string[] = [];
    let now = Date.UTC(2026, 9, 9, 15);
    const svc = new PhotoService({
      people, meta, storage: o.storage ? o.storage(new LocalDiskPhotoStorage(dir)) : new LocalDiskPhotoStorage(dir), signingKey: "test-key", now: () => now, rater: o.rater,
      eligible: async (personId, app) => app === "slop" && verified.has(personId),
      banned: personId => people.isBanned("", personId),
      onRating: async (personId, _app, s) => { ratings.push({ personId, score: s }); },
      onRemoved: async personId => {
        if (o.removalFails?.()) throw new Error("synthetic crash before the rating is cleared");
        removed.push(personId);
      },
      ...(o.log ? { log: o.log } : {}),
    });
    /** A person with a live slop membership (verified unless told otherwise). */
    const person = async (age: number | null, verify = true) => {
      const k = n++;
      const phoneHash = `photos-test-${process.pid}-${k}`;
      const p = await people.createPerson({ id: crypto.randomUUID(), e164: `+1212555${String(1000 + k).padStart(4, "0")}`, method: "otp_sms", at: now, lowestAge: age, phoneHash });
      phoneHashes.set(p.id, phoneHash);
      await people.putMembership({ app: "slop", personId: p.id, memberId: `slop_photos_${process.pid}_${k}`, state: "active", review: null, firstName: `P${k}`, profile: {}, joinedAt: now, leftAt: null });
      if (verify) verified.add(p.id);
      return p.id;
    };
    return { svc, meta, dir, verified, ratings, removed, person, files: () => { try { return readdirSync(dir); } catch { return []; } }, tick: (ms: number) => { now += ms; }, at: () => now };
  }
  /** `consent` null: no consent header at all. */
  const up = (svc: PhotoService, id: string, bytes = jpeg(), app: AppId = "slop", consent: string | null = PHOTO_CONSENT.version) => svc.upload(id, app, bytes, consent ?? undefined);
  const rowsOf = async (personId: string) => Number((await sql`select count(*)::int as n from platform.photos where person_id = ${personId}::uuid`)[0].n);

  test("adults only: under 18 and an unknown age are refused, and nothing is stored", async () => {
    const t = setup();
    for (const age of [13, 16, 17, null]) {
      const id = await t.person(age);
      expect(await up(t.svc, id)).toEqual({ ok: false, reason: "adults_only" });
      expect(await rowsOf(id)).toBe(0);
    }
    expect(t.files()).toHaveLength(0);
  }, T);

  test("an adult must pass the app's check, consent to the current wording, on an app that takes photos; stored stripped under a random key", async () => {
    const t = setup();
    const unverified = await t.person(30, false);
    expect(await up(t.svc, unverified)).toEqual({ ok: false, reason: "not_verified" });
    const adult = await t.person(30);
    expect(await up(t.svc, adult, jpeg(), "slop", null)).toEqual({ ok: false, reason: "consent_required" });
    expect(await up(t.svc, adult, jpeg(), "slop", "2020-01-01")).toEqual({ ok: false, reason: "consent_required" });
    expect(await up(t.svc, adult, jpeg(), "friends")).toEqual({ ok: false, reason: "app_not_allowed" });
    expect(await up(t.svc, adult, new Uint8Array(PHOTO_MAX_BYTES + 1))).toEqual({ ok: false, reason: "too_large" });
    expect(await up(t.svc, adult, enc("GIF89a not allowed"))).toEqual({ ok: false, reason: "bad_type" });
    const r = await up(t.svc, adult);
    expect(r.ok).toBe(true);
    const [file] = t.files();
    expect(file).toMatch(/^[a-f0-9]{48}$/);
    const stored = new Uint8Array(await fileAt(join(t.dir, file!)).arrayBuffer());
    expect(has(stored, "GPS")).toBe(false);
    const [row] = await t.meta.list(adult, "slop");
    expect(row).toMatchObject({ personId: adult, app: "slop", consentVersion: PHOTO_CONSENT.version, contentType: "image/jpeg", bytes: stored.length });
    for (let i = 1; i < PHOTO_MAX_PER_PERSON; i++) expect((await up(t.svc, adult)).ok).toBe(true);
    expect(await up(t.svc, adult)).toEqual({ ok: false, reason: "too_many" });
  }, T);

  test("the rater runs only for a rateable adult member; refusals make no rater call; scores go only to onRating", async () => {
    let calls = 0;
    const t = setup({ rater: { id: "fake-clef", rate: async () => { calls++; return score; } } });
    const adult = await t.person(29);
    expect((await up(t.svc, adult)).ok).toBe(true);
    expect(t.ratings).toEqual([{ personId: adult, score }]);
    await stateAge(adult, 16, t.at());
    expect(await t.svc.rate(adult, "slop")).toEqual({ rated: false, refused: "adults_only" });
    const other = await t.person(31);
    expect((await up(t.svc, other)).ok).toBe(true);
    t.verified.delete(other);
    expect(await t.svc.rate(other, "slop")).toEqual({ rated: false, refused: "not_verified" });
    expect(calls).toBe(2);
    // Without a rater nothing is rated and photos still work.
    const plain = setup();
    const p = await plain.person(40);
    expect((await up(plain.svc, p)).ok).toBe(true);
    expect(plain.ratings).toHaveLength(0);
  }, T);

  test("a selected photo whose bytes are missing ends the rating with no rater call; the rater never scores part of the selection", async () => {
    let calls = 0;
    const t = setup({ rater: { id: "fake-clef", rate: async () => { calls++; return score; } } });
    const id = await t.person(30);
    expect((await up(t.svc, id)).ok).toBe(true);
    expect((await up(t.svc, id)).ok).toBe(true);
    const before = calls;
    const [first] = await t.meta.list(id, "slop");
    rmSync(join(t.dir, first!.storageKey));
    t.ratings.length = 0;
    expect(await t.svc.rate(id, "slop")).toEqual({ rated: false, refused: "not_found" });
    expect([calls - before, t.ratings.length]).toEqual([0, 0]);
  }, T);

  test("a rating is discarded when the age drops under 18, a ban lands, the member leaves or a rated photo is deleted while the rater runs", async () => {
    let during: (() => Promise<void>) | undefined;
    let calls = 0;
    const t = setup({ rater: { id: "fake-clef", rate: async () => { calls++; await during?.(); return score; } } });
    const cases: [string, (personId: string) => Promise<void>, PhotoRefusal][] = [
      ["age", personId => stateAge(personId, 16, t.at()), "adults_only"],
      ["ban", personId => people.ban({ id: `ban_${personId}`, scope: "person", personId, phoneHash: null, reason: "test", reportId: null, bannedBy: "safety@example.org", at: Date.now() }), "banned"],
      ["leave", personId => people.forgetMembership(personId, "slop", Date.now()), "not_member"],
      ["photo", async personId => { for (const r of await t.meta.list(personId, "slop")) await t.meta.delete(r.id); }, "not_found"],
    ];
    for (const [name, change, refused] of cases) {
      during = undefined;
      const id = await t.person(30);
      expect((await up(t.svc, id)).ok).toBe(true);
      expect(t.ratings.filter(r => r.personId === id)).toHaveLength(1);
      t.ratings.length = 0;
      during = () => change(id);
      const before = calls;
      expect([name, await t.svc.rate(id, "slop")]).toEqual([name, { rated: false, refused }]);
      expect([name, calls - before, t.ratings.length]).toEqual([name, 1, 0]);
    }
  }, T);

  test("a change that lands while the rating is written drops it again", async () => {
    const t = setup();
    const id = await t.person(33);
    // onRating is slow: the person states 17 while it writes.
    const svc = new PhotoService({
      people, meta: t.meta, storage: new LocalDiskPhotoStorage(t.dir), signingKey: "k", rater: { id: "fake-clef", rate: async () => score },
      eligible: async () => true, onRating: async () => { await stateAge(id, 17, t.at()); }, onRemoved: async personId => { t.removed.push(personId); },
    });
    expect((await up(svc, id)).ok).toBe(true);
    expect(t.removed).toContain(id);
    expect(await svc.rate(id, "slop")).toEqual({ rated: false, refused: "adults_only" });
  }, T);

  test("each rater try is a photo_rating row in the cost ledger (three tries, three rows); a refusal costs nothing", async () => {
    await sql`delete from network.cost_ledger`;
    let tries = 0;
    const flaky: PhotoRater = { id: "fake-clef", rate: async subject => { if (!(subject.age >= 18)) return null; tries++; if (tries < 3) throw Object.assign(new Error("Workers AI 503"), { status: 503 }); return score; } };
    const ledger = new CostLedger({ sink: new PgCostSink(sql), clock: { now: () => Date.UTC(2026, 9, 9, 15) } });
    const metered = ledger.meterRater(withRetry(flaky, { attempts: 3, sleep: async () => {} }));
    const photos = [{ id: "a", bytes: jpeg() }, { id: "b", bytes: jpeg() }];
    expect(await metered.rate({ age: 30, ageVerified: true }, photos)).toEqual(score);
    expect(await metered.rate({ age: 16, ageVerified: true }, photos)).toBe(null);
    const rows = await sql`select kind, app_id, quantity from network.cost_ledger order by at, id` as { kind: string; app_id: string; quantity: number }[];
    expect(rows.map(r => [r.kind, r.app_id, Number(r.quantity)])).toEqual([["photo_rating", "slop", 2], ["photo_rating", "slop", 2], ["photo_rating", "slop", 2]]);
  }, T);

  test("staff links: signed, 5 minutes, adults only at read time; no public URL exists", async () => {
    const t = setup();
    const adult = await t.person(33);
    await up(t.svc, adult);
    const links = await t.svc.staffLinks(adult, "slop", "https://slop.date");
    expect(links.ok).toBe(true);
    const [l] = links.ok ? links.value : [];
    expect(l!.url).toMatch(/^https:\/\/slop\.date\/api\/photos\/view\/ph_[a-f0-9]{24}\?exp=\d+&sig=[\w-]+$/);
    const u = new URL(l!.url);
    const [id, exp, sig] = [u.pathname.split("/").pop()!, Number(u.searchParams.get("exp")), u.searchParams.get("sig")!];
    expect((await t.svc.view(id, exp, sig))?.contentType).toBe("image/jpeg");
    expect(await t.svc.view(id, exp, `${sig.slice(0, -2)}xx`)).toBeUndefined();
    expect(await t.svc.view(id, exp + 1000, sig)).toBeUndefined();
    t.tick(PHOTO_VIEW_TTL_MS + 1);
    expect(await t.svc.view(id, exp, sig)).toBeUndefined();
    const kid = await t.person(16);
    expect(await t.svc.staffLinks(kid, "slop", "https://slop.date")).toEqual({ ok: false, reason: "adults_only" });
  }, T);

  test("an open person minor signal refuses upload, rating, relay, staff links and views for an adult and keeps the stored photos; a removed signal lets them work again", async () => {
    let calls = 0;
    const t = setup({ rater: { id: "fake-clef", rate: async () => { calls++; return score; } } });
    const adult = await t.person(30);
    const first = await up(t.svc, adult);
    if (!first.ok) throw new Error(JSON.stringify(first));
    const links = await t.svc.staffLinks(adult, "slop", "https://slop.date");
    if (!links.ok) throw new Error(JSON.stringify(links));
    const u = new URL(links.value[0]!.url);
    const view = () => t.svc.view(u.pathname.split("/").pop()!, Number(u.searchParams.get("exp")), u.searchParams.get("sig")!);
    const before = calls;
    await sql`insert into platform.person_minor_signals (person_id, at) values (${adult}::uuid, ${new Date(t.at())})`;
    expect(await up(t.svc, adult)).toEqual({ ok: false, reason: "adults_only" });
    expect(await t.svc.rate(adult, "slop")).toEqual({ rated: false, refused: "adults_only" });
    expect(await t.svc.staffLinks(adult, "slop", "https://slop.date")).toEqual({ ok: false, reason: "adults_only" });
    expect(await t.svc.relayPhoto(adult, "slop", first.value.id)).toBeUndefined();
    expect(await view()).toBeUndefined();
    expect(calls).toBe(before);
    expect(await t.svc.holdAllowed(adult, "slop")).toBe(true);
    expect(await rowsOf(adult)).toBe(1);
    await sql`delete from platform.person_minor_signals where person_id = ${adult}::uuid`;
    expect((await up(t.svc, adult)).ok).toBe(true);
    expect((await t.svc.staffLinks(adult, "slop", "https://slop.date")).ok).toBe(true);
    expect((await t.svc.relayPhoto(adult, "slop", first.value.id))?.id).toBe(first.value.id);
    expect((await view())?.contentType).toBe("image/jpeg");
  }, T);

  test("deleteFor removes the bytes and the rows (leave, delete everything, a minor age)", async () => {
    const t = setup();
    const adult = await t.person(27);
    await up(t.svc, adult); await up(t.svc, adult);
    expect(t.files()).toHaveLength(2);
    expect(await t.svc.deleteFor(adult, "slop")).toBe(2);
    expect(t.files()).toHaveLength(0);
    expect(await t.svc.list(adult, "slop")).toEqual([]);
    expect(await rowsOf(adult)).toBe(0);
  }, T);

  test("an upload in flight while an erasure, a leave or an age drop runs keeps no photo, also for a minor", async () => {
    let entered!: () => void, release!: () => void;
    let gate = { entered: new Promise<void>(r => { entered = r; }), released: new Promise<void>(r => { release = r; }) };
    const t = setup({ storage: inner => ({ ...inner, kind: inner.kind, get: k => inner.get(k), delete: k => inner.delete(k),
      put: async (k, b, type) => { entered(); await gate.released; await inner.put(k, b, type); } }) });
    const erasures: [string, (id: string) => Promise<unknown>][] = [
      ["delete everything", id => t.svc.deleteFor(id)],
      ["leave", async id => { await t.svc.deleteFor(id, "slop"); await people.forgetMembership(id, "slop", Date.UTC(2026, 9, 9, 16)); }],
      ["age drop", async id => { await stateAge(id, 16, t.at()); await t.svc.deleteFor(id); }],
    ];
    for (const [label, erase] of erasures) {
      gate = { entered: new Promise<void>(r => { entered = r; }), released: new Promise<void>(r => { release = r; }) };
      const id = await t.person(29);
      const upload = up(t.svc, id);
      await gate.entered;
      await erase(id);
      release();
      expect([label, (await upload).ok]).toEqual([label, false]);
      expect([label, await rowsOf(id)]).toEqual([label, 0]);
    }
    expect(t.files()).toHaveLength(0);
  }, T);

  test("parallel uploads never pass the per-person maximum", async () => {
    let release!: () => void, entered!: () => void;
    const released = new Promise<void>(r => { release = r; });
    const inPut = new Promise<void>(r => { entered = r; });
    let holding = true;
    const t = setup({ storage: inner => ({ ...inner, kind: inner.kind, get: k => inner.get(k), delete: k => inner.delete(k),
      put: async (k, b, type) => { if (holding) { entered(); await released; } await inner.put(k, b, type); } }) });
    const id = await t.person(31);
    holding = false;
    for (let i = 0; i < PHOTO_MAX_PER_PERSON - 1; i++) expect((await up(t.svc, id)).ok).toBe(true);
    holding = true;
    const racing = [up(t.svc, id), up(t.svc, id), up(t.svc, id), up(t.svc, id)];
    await inPut;
    let settled = 0;
    await new Promise<void>(resolve => { for (const r of racing) void r.then(() => { if (++settled === racing.length - 1) resolve(); }); });
    release();
    const results = await Promise.all(racing);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => !r.ok).map(r => (r as { reason: PhotoRefusal }).reason)).toEqual(["too_many", "too_many", "too_many"]);
    expect(await rowsOf(id)).toBe(PHOTO_MAX_PER_PERSON);
    expect(t.files()).toHaveLength(PHOTO_MAX_PER_PERSON);
  }, T);

  test("a crash in the middle of an upload or a removal leaves nothing behind once the retention tick has run", async () => {
    let failPut = false, failRemoved = false;
    const t = setup({ storage: inner => ({ ...inner, kind: inner.kind, get: k => inner.get(k), delete: k => inner.delete(k),
      put: async (k, b, type) => { await inner.put(k, b, type); if (failPut) throw new Error("synthetic crash after the bytes"); } }), removalFails: () => failRemoved });
    const id = await t.person(33);
    failPut = true;
    await expect(up(t.svc, id)).rejects.toThrow("synthetic crash after the bytes");
    failPut = false;
    expect(t.files()).toHaveLength(1);
    expect(await t.svc.list(id, "slop")).toEqual([]);
    const kept = await up(t.svc, id);
    if (!kept.ok) throw new Error(kept.reason);
    const gone = await up(t.svc, id);
    if (!gone.ok) throw new Error(gone.reason);
    failRemoved = true;
    await expect(t.svc.remove(id, "slop", gone.value.id)).rejects.toThrow("synthetic crash before the rating is cleared");
    failRemoved = false;
    expect((await t.svc.list(id, "slop")).map(p => p.id)).toEqual([kept.value.id]);
    const removedOf = () => t.removed.filter(p => p === id).length, removedBefore = removedOf();
    await t.svc.sweep();
    expect(t.files()).toHaveLength(3);
    t.tick(15 * 60_000);
    await t.svc.sweep();
    expect(t.files()).toHaveLength(1);
    expect(await rowsOf(id)).toBe(1);
    expect(removedOf()).toBe(removedBefore + 1);
    expect((await t.svc.list(id, "slop")).map(p => p.id)).toEqual([kept.value.id]);
  }, T);

  test("one unfinished photo that fails every tick does not stop the sweep of the others", async () => {
    let crash = true;
    const stuck = new Set<string>();
    const logs: string[] = [];
    const t = setup({ log: (l: string) => logs.push(l), storage: inner => ({ ...inner, kind: inner.kind, get: k => inner.get(k),
      delete: async k => { if (stuck.has(k)) throw new Error("storage refuses this key"); await inner.delete(k); },
      put: async (k, b, type) => { await inner.put(k, b, type); if (crash) throw new Error("synthetic crash after the bytes"); } }) });
    const first = await t.person(34), second = await t.person(35);
    await expect(up(t.svc, first)).rejects.toThrow("synthetic crash after the bytes");
    t.tick(1000);
    await expect(up(t.svc, second)).rejects.toThrow("synthetic crash after the bytes");
    crash = false;
    const [firstRow] = await sql`select storage_key from platform.photos where person_id = ${first}::uuid`;
    stuck.add(firstRow.storage_key);
    t.tick(15 * 60_000);
    expect((await t.svc.sweep()).failed).toBeGreaterThanOrEqual(1);
    expect([await rowsOf(first), await rowsOf(second)]).toEqual([1, 0]);
    expect(t.files()).toHaveLength(1);
    expect(logs.some(l => l.includes("storage refuses this key"))).toBe(true);
  }, T);

  test("photos are off without storage", async () => {
    const svc = new PhotoService({ people, meta: new PgPhotoStore(sql), signingKey: "k", eligible: async () => true });
    const p = await people.createPerson({ id: crypto.randomUUID(), e164: "+12125559188", method: "otp_sms", at: 0, lowestAge: 30 });
    expect(await svc.upload(p.id, "slop", jpeg(), PHOTO_CONSENT.version)).toEqual({ ok: false, reason: "photos_off" });
  }, T);

  test("the /api/photos routes: a session, an image type, the consent header and a same-site request; a minor is refused; no URL or score comes back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "photos-api-")); dirs.push(dir);
    let t = Date.UTC(2026, 9, 9, 15);
    const codes = new Map<string, string>();
    const verified = new Set<string>();
    const photos = new PhotoService({ people, meta: new PgPhotoStore(sql), storage: new LocalDiskPhotoStorage(dir), signingKey: "k", now: () => t, eligible: async p => verified.has(p) });
    const api = createPublicApi({
      store: people, env: { PLATFORM_ENV: "dev" }, now: () => t, minStartMs: 0, minVerifyMs: 0, log: () => {}, photos,
      otp: { name: "fake", send: async e164 => { const code = "246810"; codes.set(e164, code); return { code }; } },
    });
    const host = "localhost:5102";
    let cookie = "";
    const call = async (method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}) => {
      const res = (await api.fetch(new Request(`http://${host}${path}`, { method, headers: { host, ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body } : {}) })))!;
      const c = res.headers.get("set-cookie"); if (c) cookie = c.split(";")[0]!;
      return { status: res.status, body: await res.json().catch(() => null) as any };
    };
    const jsonH = { "content-type": "application/json" };
    const login = async (phone: string) => {
      expect((await call("POST", "/api/auth/otp/start", JSON.stringify({ phone }), jsonH)).status).toBe(200);
      expect((await call("POST", "/api/auth/otp/verify", JSON.stringify({ phone, code: codes.get(phone) }), jsonH)).status).toBe(200);
      t += 31_000;
    };
    const img = { "content-type": "image/jpeg", "x-photo-consent": PHOTO_CONSENT.version };
    expect((await call("GET", "/api/photos/consent")).body).toMatchObject({ version: PHOTO_CONSENT.version });
    expect((await call("POST", "/api/photos", jpeg() as unknown as BodyInit, img)).status).toBe(401);
    // A 16-year-old member of slop.date: joins (13+), but no photos.
    await login("+12125550171");
    expect((await call("POST", "/api/join", JSON.stringify({ firstName: "Kai", age: 16, consent: { sms: true, version: APPS.slop.consent.version } }), jsonH)).status).toBe(200);
    verified.add((await people.findPhone("+12125550171"))!.personId);
    expect(await call("POST", "/api/photos", jpeg() as unknown as BodyInit, img)).toEqual({ status: 403, body: { ok: false, error: "adults_only" } });
    // The settings page reads `eligible` to keep the photo section (consent text, upload control) hidden from a minor.
    expect(await call("GET", "/api/photos")).toEqual({ status: 200, body: { ok: true, eligible: false, photos: [] } });
    // An adult: a cross-site request and a wrong type are refused before anything is read.
    cookie = "";
    await login("+12125550172");
    await call("POST", "/api/join", JSON.stringify({ firstName: "Ana", age: 31, consent: { sms: true, version: APPS.slop.consent.version } }), jsonH);
    verified.add((await people.findPhone("+12125550172"))!.personId);
    expect((await call("POST", "/api/photos", jpeg() as unknown as BodyInit, { ...img, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await call("POST", "/api/photos", jpeg() as unknown as BodyInit, { ...img, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/api/photos", jpeg() as unknown as BodyInit, { "content-type": "text/plain", "x-photo-consent": PHOTO_CONSENT.version })).status).toBe(415);
    expect((await call("POST", "/api/photos", jpeg() as unknown as BodyInit, { "content-type": "image/jpeg" })).body).toEqual({ ok: false, error: "consent_required" });
    expect((await call("GET", "/api/photos")).body).toEqual({ ok: true, eligible: true, photos: [] });
    const ok = await call("POST", "/api/photos", jpeg() as unknown as BodyInit, img);
    expect(ok.status).toBe(200);
    const list = await call("GET", "/api/photos");
    expect(list.body.eligible).toBe(true);
    expect(list.body.photos).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/url|score|rating/);
    expect((await call("POST", "/api/photos/delete", JSON.stringify({ id: ok.body.id }), jsonH)).status).toBe(200);
    expect(readdirSync(dir)).toHaveLength(0);
  }, T);
  test("a photo offer needs the sender's own current photos, the receiver's yes and the automatic check; a flagged photo needs a safety reviewer; take-back and deletion end it", async () => {
    const t = setup(), sender = await t.person(29), recipient = await t.person(30), stranger = await t.person(31);
    const first = await up(t.svc, sender), second = await up(t.svc, sender), foreign = await up(t.svc, stranger);
    if (!first.ok || !second.ok || !foreign.ok) throw new Error("upload refused");
    let allowed = true;
    const binding = { senderPersonId: sender, recipientPersonId: recipient, senderMemberId: "member_sender", recipientMemberId: "member_recipient" };
    const flagged = simulatedPhotoScreen(() => ({ kind: "answered", riskPerMille: 400 }));
    const relay = new PhotoRelayService({
      store: new PgPhotoRelayStore(sql), photos: t.svc, sql, signingKey: "fixture-only", hashKey: "fixture-hash-key", now: () => t.at(), screen: flagged,
      origin: app => `https://${APPS[app].domain}`,
      authorize: async ({ app, threadId, senderPersonId }) => allowed && app === "slop" && threadId === "thread_fixture" && senderPersonId === sender ? binding : undefined,
      threads: async () => [{ id: "thread_fixture", label: "Robin Fixture" }],
    });
    const safety = { id: "staff_safety", roles: ["safety"] }, admin = { id: "staff_admin", roles: ["admin", "reviewer"] };
    const draftFor = (proposedIds: string[]) => sql.begin(tx => relay.saveDraft(tx, {
      personId: sender, app: "slop", purpose: "send", threadId: "thread_fixture", recipientMemberId: "member_recipient",
      shownIds: [first.value.id, second.value.id], proposedIds, wantsSet: proposedIds.length > 1, listed: false, prompt: { via: "send" },
    }));
    expect((await relay.slots(sender, "slop")).map(s => [s.n, s.id, s.sharedWith])).toEqual([[1, first.value.id, []], [2, second.value.id, []]]);
    await expect(draftFor([foreign.value.id])).rejects.toThrow("photo draft names a photo the member does not own");
    const draft = await draftFor([first.value.id]);
    expect(draft.link).toMatch(/^https:\/\/slop\.date\/photos\/check#[A-Za-z0-9_-]{43}$/);
    expect(draft.promptKey).toBe(`photo-draft:${draft.draftId}:1`);
    expect(await relay.prepareOffer(sender, "slop", draft.draftId, draft.revision + 1, t.at())).toBeUndefined();
    allowed = false;
    expect((await relay.prepareOffer(sender, "slop", draft.draftId, draft.revision, t.at()))?.admission).toBe("OfferUnavailable");
    allowed = true;
    const prepared = await relay.prepareOffer(sender, "slop", draft.draftId, draft.revision, t.at());
    expect(prepared).toMatchObject({ admission: "OfferAsk", firstAsk: true, count: 1, recipientMemberId: "member_recipient" });
    const committed = await sql.begin(tx => prepared!.commit(tx));
    expect(committed).toMatchObject({ admission: "OfferAsk", phase: "asking", replayed: false });
    expect(await sql.begin(tx => prepared!.commit(tx))).toMatchObject({ offerId: committed.offerId, replayed: true });
    expect(Number((await sql`select count(*)::int as n from platform.photo_offers where sender_person_id = ${sender}::uuid`)[0].n)).toBe(1);
    expect(await relay.held("slop")).toEqual([]);
    expect((await relay.slots(sender, "slop")).map(s => s.sharedWith)).toEqual([["member_recipient"], []]);
    expect((await relay.asksFor(recipient, "slop")).map(a => [a.offerId, a.count])).toEqual([[committed.offerId, 1]]);
    expect(await relay.asksFor(stranger, "slop")).toEqual([]);
    const waiting = await draftFor([second.value.id]);
    expect((await relay.prepareOffer(sender, "slop", waiting.draftId, waiting.revision, t.at()))?.admission).toBe("OfferWaitForAnswer");
    expect(await sql.begin(tx => relay.answer(tx, committed.offerId!, stranger, "yes"))).toEqual({ outcome: "not_open" });

    const restricted = new SQL({ url, max: 1 });
    try {
      await restricted`set role platform_service`;
      expect((await restricted`select has_table_privilege(current_user,'platform.photo_relay_requests','UPDATE') as can_update`)[0].can_update).toBe(false);
      const restrictedRelay = new PhotoRelayService({ store: new PgPhotoRelayStore(restricted), photos: t.svc, sql: restricted, signingKey: "fixture-only", hashKey: "fixture-hash-key", now: () => t.at(), screen: flagged,
        origin: app => `https://${APPS[app].domain}`, authorize: async () => binding, threads: async () => [{ id: "thread_fixture", label: "Robin" }] });
      const taken = await restricted.begin(tx => restrictedRelay.answer(tx, committed.offerId!, recipient, "yes"));
      expect(taken.outcome).toBe("taken");
      expect(taken.offer?.phase).toBe("reviewing");
    } finally { await restricted.close(); }
    expect(await sql.begin(tx => relay.answer(tx, committed.offerId!, recipient, "yes"))).toEqual({ outcome: "not_open" });
    expect(await relay.held("slop")).toEqual([]);
    const [screening] = await relay.screensDue("slop", committed.offerId);
    expect(await relay.item(screening!.itemId)).toMatchObject({ state: "screening", screenAttempts: 0 });
    expect(await relay.reviewBytes(screening!.itemId, safety)).toBeUndefined();
    expect(await relay.review(screening!.itemId, safety, "safe")).toBe(false);
    expect(await relay.screen(screening!.itemId)).toBe("HoldForStaff");
    const held = await relay.held("slop");
    expect(held.map(h => [h.photoId, h.offerId])).toEqual([[first.value.id, committed.offerId]]);
    const item = held[0]!;
    expect(await relay.item(item.id)).toMatchObject({ state: "pending", offerId: committed.offerId, policyVersion: PHOTO_SEND_NOTICE.version, policyNotice: PHOTO_SEND_NOTICE.text, notice: expect.stringContaining("Robin can view it until you take it back") });
    expect(await relay.reviewBytes(item.id, admin)).toBeUndefined();
    expect(await relay.reviewBytes(item.id, safety)).toMatchObject({ contentType: "image/jpeg" });
    expect(await relay.reviewAuthorized(item.id, admin)).toBe(false);
    expect(await relay.reviewAuthorized(item.id, safety)).toBe(true);
    expect(await relay.review(item.id, admin, "safe")).toBe(false);
    expect(await relay.review(item.id, safety, "unknown")).toBe(false);
    expect(await relay.review(item.id, safety, "safe")).toBe(true);
    const settled = await sql.begin(tx => relay.settle(tx, committed.offerId!));
    expect(settled).toMatchObject({ from: "reviewing", phase: "ready", changed: true, notice: "TellSent", dueAt: t.at() });
    expect(settled!.viewLink).toMatch(/^https:\/\/slop\.date\/photos\/view#[A-Za-z0-9_-]{43}$/);
    expect((await relay.notices("slop")).map(n => [n.offerId, n.notice])).toEqual([[committed.offerId, "TellSent"]]);
    expect(await sql.begin(tx => relay.noticeSent(tx, committed.offerId!))).toBe(true);
    expect(await relay.notices("slop")).toEqual([]);

    expect(await sql.begin(tx => relay.withdraw(tx, "slop", stranger, "thread_fixture", null))).toEqual({ revoked: 0, viewing: false });
    expect(await sql.begin(tx => relay.withdraw(tx, "slop", sender, "thread_fixture", null))).toEqual({ revoked: 1, viewing: true });
    expect(await relay.offer(committed.offerId!)).toMatchObject({ phase: "revoked", endedBySender: true, wasReady: true });
    expect((await relay.item(item.id))?.state).toBe("revoked");
    expect(await sql.begin(tx => relay.withdraw(tx, "slop", sender, "thread_fixture", null))).toEqual({ revoked: 0, viewing: false });

    const next = await draftFor([second.value.id]);
    const nextOffer = await sql.begin(async tx => (await relay.prepareOffer(sender, "slop", next.draftId, next.revision, t.at()))!.commit(tx));
    expect(nextOffer).toMatchObject({ admission: "OfferAsk", phase: "asking", firstAsk: false });
    expect((await sql.begin(tx => relay.answer(tx, nextOffer.offerId!, recipient, "yes"))).outcome).toBe("taken");
    for (const d of await relay.screensDue("slop", nextOffer.offerId)) expect(await relay.screen(d.itemId)).toBe("HoldForStaff");
    const nextItem = (await relay.held("slop"))[0]!;
    await t.svc.remove(sender, "slop", second.value.id);
    expect(await relay.reviewBytes(nextItem.id, safety)).toBeUndefined();
    expect(await relay.review(nextItem.id, safety, "safe")).toBe(false);
    expect(Number((await sql`select count(*)::int n from platform.photo_relay_items where photo_id=${second.value.id}`)[0].n)).toBe(0);
    expect(await sql.begin(tx => relay.settle(tx, nextOffer.offerId!))).toMatchObject({ phase: "ended", notice: "TellNotTaken" });
  }, T);

  test("R2PhotoStorage on an S3-compatible bucket: signed put, get and delete under photos/<key>; a missing key reads as none, another error is raised; leaving the app deletes the object", async () => {
    const name = "photos-r2-fixture";
    const objects = new Map<string, { bytes: Uint8Array; type: string | null }>();
    const fault = { status: 0 };
    let badSignatures = 0;
    const xmlError = (status: number, code: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`, { status, headers: { "content-type": "application/xml" } });
    const server = await serveHttp({
      port: 0, hostname: "127.0.0.1",
      async fetch(req) {
        const path = decodeURIComponent(new URL(req.url).pathname.slice(1));
        if (!path.startsWith(`${name}/`)) return xmlError(404, "NoSuchBucket");
        const body = new Uint8Array(await req.arrayBuffer());
        if (!sigV4Valid(req, body, "fixture-key", "fixture-secret")) { badSignatures++; return xmlError(403, "AccessDenied"); }
        if (fault.status) return xmlError(fault.status, "AccessDenied");
        const key = path.slice(name.length + 1);
        if (req.method === "PUT") { objects.set(key, { bytes: body, type: req.headers.get("content-type") }); return new Response(null, { status: 200, headers: { etag: '"fixture"' } }); }
        if (req.method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
        if (req.method === "GET") {
          const o = objects.get(key);
          return o ? new Response(Buffer.from(o.bytes), { status: 200, headers: { "content-length": String(o.bytes.length), "content-type": o.type ?? "application/octet-stream", etag: '"fixture"' } }) : xmlError(404, "NoSuchKey");
        }
        return xmlError(501, "NotImplemented");
      },
    });
    try {
      const r2 = new R2PhotoStorage({ endpoint: `http://127.0.0.1:${server.port}`, bucket: name, accessKeyId: "fixture-key", secretAccessKey: "fixture-secret" });
      expect(r2.kind).toBe("r2");
      const t = setup({ storage: () => r2 });
      const id = await t.person(30);
      const uploaded = await up(t.svc, id);
      if (!uploaded.ok) throw new Error(JSON.stringify(uploaded));
      const keys = [...objects.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^photos\/[a-f0-9]{48}$/);
      const stored = objects.get(keys[0]!)!;
      expect(stored.type).toBe("image/jpeg");
      expect(has(stored.bytes, "GPS")).toBe(false);
      const [row] = await t.meta.list(id, "slop");
      expect(row).toMatchObject({ id: uploaded.value.id, bytes: stored.bytes.length, contentType: "image/jpeg" });
      expect(`photos/${row!.storageKey}`).toBe(keys[0]);
      expect(await r2.get(row!.storageKey)).toEqual(stored.bytes);
      expect(await r2.get("0".repeat(48))).toBeUndefined();
      await expect(r2.get("../" + row!.storageKey)).rejects.toThrow("bad photo key");
      fault.status = 403;
      await expect(r2.get(row!.storageKey)).rejects.toThrow();
      fault.status = 0;
      expect(badSignatures).toBe(0);
      const forged = new R2PhotoStorage({ endpoint: `http://127.0.0.1:${server.port}`, bucket: name, accessKeyId: "fixture-key", secretAccessKey: "another-secret" });
      await expect(forged.get(row!.storageKey)).rejects.toThrow();
      expect(badSignatures).toBe(1);
      expect(await t.svc.deleteFor(id, "slop")).toBe(1);
      expect(objects.size).toBe(0);
      expect(await rowsOf(id)).toBe(0);
      expect(await r2.get(row!.storageKey)).toBeUndefined();
    } finally { await server.stop(true); }
  }, T);
});
