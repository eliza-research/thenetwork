// Private member photos (photos.ts): adults only, verified, consented, metadata stripped, no public
// URL, short signed staff links, the rater refused for anyone not a verified adult, and every photo
// deleted on leave, delete-everything or a minor age. Memory stores and a temporary folder; no network,
// no R2 (R2PhotoStorage is not exercised here).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APPS, type AppId } from "../src/apps.ts";
import { createPublicApi } from "../src/api.ts";
import {
  LocalDiskPhotoStorage, MemoryPhotoStore, PHOTO_CONSENT, PHOTO_MAX_BYTES, PHOTO_MAX_PER_PERSON, PHOTO_VIEW_TTL_MS, PhotoService, sniffType, stripMetadata,
  type PhotoRater, type PhotoScores,
} from "../src/photos.ts";
import { MemoryPeopleStore } from "../src/store.ts";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...xs: (Uint8Array | number[])[]) => { const parts = xs.map(x => (x instanceof Uint8Array ? x : Uint8Array.from(x))); const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s));
const seg = (marker: number, payload: Uint8Array) => cat([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff], payload);

/** A small JPEG with JFIF, an EXIF block carrying GPS, a comment, a table and a scan. */
const jpeg = () => cat([0xff, 0xd8], seg(0xe0, enc("JFIF\0\x01\x01")), seg(0xe1, enc("Exif\0\0GPSLatitude 40.7128")), seg(0xfe, enc("shot on my phone")),
  seg(0xdb, new Uint8Array(65)), seg(0xda, new Uint8Array(10)), enc("SCANDATA"), [0xff, 0xd9]);
const chunk = (type: string, data: Uint8Array) => cat([0, 0, data.length >> 8, data.length & 0xff], enc(type), data, [0, 0, 0, 0]);
const png = () => cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk("IHDR", new Uint8Array(13)), chunk("tEXt", enc("GPS\x0040.71,-73.95")), chunk("IDAT", enc("PIXELS")), chunk("IEND", new Uint8Array(0)));
const rchunk = (type: string, data: Uint8Array) => cat(enc(type), [data.length & 0xff, (data.length >> 8) & 0xff, 0, 0], data, data.length & 1 ? [0] : []);
function webp() {
  const body = cat(enc("WEBP"), rchunk("VP8X", Uint8Array.from([0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0])), rchunk("VP8 ", enc("FRAMEDATA")), rchunk("EXIF", enc("GPSLatitude 40.7")), rchunk("XMP ", enc("<x:xmpmeta/>")));
  return cat(enc("RIFF"), [body.length & 0xff, (body.length >> 8) & 0xff, 0, 0], body);
}

describe("metadata and types", () => {
  test("EXIF (GPS), comments and XMP are removed from JPEG, PNG and WebP; the image data stays", () => {
    const j = stripMetadata(jpeg(), "image/jpeg");
    expect(has(j, "Exif")).toBe(false); expect(has(j, "GPS")).toBe(false); expect(has(j, "shot on")).toBe(false);
    expect(has(j, "JFIF")).toBe(true); expect(has(j, "SCANDATA")).toBe(true);
    const p = stripMetadata(png(), "image/png");
    expect(has(p, "tEXt")).toBe(false); expect(has(p, "GPS")).toBe(false); expect(has(p, "PIXELS")).toBe(true); expect(has(p, "IEND")).toBe(true);
    const w = stripMetadata(webp(), "image/webp");
    expect(has(w, "EXIF")).toBe(false); expect(has(w, "xmpmeta")).toBe(false); expect(has(w, "FRAMEDATA")).toBe(true);
    // The VP8X flags no longer claim EXIF or XMP, and the RIFF size is the new size.
    expect(w[20]! & 0x0c).toBe(0);
    expect(w[4]! | (w[5]! << 8)).toBe(w.length - 8);
  });
  test("a second image after EOI (MPF, depth map, motion photo) and its GPS are dropped; progressive scans and stuffed bytes stay", () => {
    // Before the fix everything after the first SOS was kept: the appended image's EXIF GPS survived.
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
  test("the type comes from the bytes; a text file named .jpg, or a broken JPEG, is refused", () => {
    expect(sniffType(jpeg())).toBe("image/jpeg");
    expect(sniffType(png())).toBe("image/png");
    expect(sniffType(webp())).toBe("image/webp");
    expect(sniffType(enc("<svg onload=alert(1)>"))).toBeUndefined();
    expect(() => stripMetadata(cat([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00]), "image/jpeg")).toThrow();
  });
});

describe("PhotoService", () => {
  async function setup(o: { rater?: PhotoRater } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "photos-test-")); dirs.push(dir);
    const people = new MemoryPeopleStore();
    const meta = new MemoryPhotoStore();
    const verified = new Set<string>();
    const ratings: { personId: string; scores: PhotoScores }[] = [];
    let now = Date.UTC(2026, 9, 9, 15);
    const svc = new PhotoService({
      people, meta, storage: new LocalDiskPhotoStorage(dir), signingKey: "test-key", now: () => now, rater: o.rater,
      eligible: async (personId, app) => app === "slop" && verified.has(personId),
      onRating: async (personId, _app, _id, scores) => { ratings.push({ personId, scores }); },
    });
    let n = 0;
    const person = async (age: number | null, verify = true) => {
      const p = await people.createPerson({ id: crypto.randomUUID(), e164: `+1212555019${n++}`, method: "otp_sms", at: now, lowestAge: age });
      if (verify) verified.add(p.id);
      return p.id;
    };
    return { svc, people, meta, dir, verified, ratings, person, files: () => readdirSync(dir), tick: (ms: number) => { now += ms; } };
  }
  /** `consent` null: no consent header at all. */
  const up = (svc: PhotoService, id: string, bytes = jpeg(), app: AppId = "slop", consent: string | null = PHOTO_CONSENT.version) => svc.upload(id, app, bytes, consent ?? undefined);

  test("adults only: under 18 and an unknown age are refused, and nothing is stored", async () => {
    const t = await setup();
    for (const age of [13, 16, 17, null]) {
      const id = await t.person(age);
      expect(await up(t.svc, id)).toEqual({ ok: false, reason: "adults_only" });
    }
    expect(t.files()).toHaveLength(0);
    expect(t.meta.rows.size).toBe(0);
  });
  test("an adult must be verified on the app, consent to the current wording, on an app that takes photos", async () => {
    const t = await setup();
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
    // Stored without metadata, under a random key; the row keeps the consent version.
    const [file] = t.files();
    expect(file).toMatch(/^[a-f0-9]{48}$/);
    const stored = new Uint8Array(await Bun.file(join(t.dir, file!)).arrayBuffer());
    expect(has(stored, "GPS")).toBe(false);
    expect([...t.meta.rows.values()][0]).toMatchObject({ personId: adult, app: "slop", consentVersion: PHOTO_CONSENT.version, contentType: "image/jpeg" });
    for (let i = 1; i < PHOTO_MAX_PER_PERSON; i++) expect((await up(t.svc, adult)).ok).toBe(true);
    expect(await up(t.svc, adult)).toEqual({ ok: false, reason: "too_many" });
  });
  test("the rater runs only for a verified adult; 'none' never rates; scores go only to onRating", async () => {
    const calls: number[] = [];
    const rater: PhotoRater = { id: "fake-clip", rate: async () => { calls.push(1); return { face: 0.734, body: 1.4, overall: -0.2 }; } };
    const t = await setup({ rater });
    const adult = await t.person(29);
    const r = await up(t.svc, adult);
    expect(r.ok).toBe(true);
    expect(t.ratings).toEqual([{ personId: adult, scores: { face: 0.73, body: 1, overall: 0 } }]);
    // Refused for someone who is no longer a verified adult (a minor age, or the check removed).
    await t.people.noteAge(adult, 16);
    const id = r.ok ? r.value.id : "";
    expect(await t.svc.rate(adult, "slop", id)).toEqual({ rated: false, refused: "adults_only" });
    const other = await t.person(31);
    const r2 = await up(t.svc, other);
    t.verified.delete(other);
    expect(await t.svc.rate(other, "slop", r2.ok ? r2.value.id : "")).toEqual({ rated: false, refused: "not_verified" });
    expect(calls).toHaveLength(2);
    // The default rater never rates.
    const plain = await setup();
    const p = await plain.person(40);
    expect((await up(plain.svc, p)).ok).toBe(true);
    expect(plain.ratings).toHaveLength(0);
  });
  test("staff links: signed, 5 minutes, adults only at read time; no public URL exists", async () => {
    const t = await setup();
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
    // A minor, or anyone unverified, has no links at all.
    const kid = await t.person(16);
    expect(await t.svc.staffLinks(kid, "slop", "https://slop.date")).toEqual({ ok: false, reason: "adults_only" });
  });
  test("deleteFor removes the bytes and the rows (leave, delete everything, a minor age)", async () => {
    const t = await setup();
    const adult = await t.person(27);
    await up(t.svc, adult); await up(t.svc, adult);
    expect(t.files()).toHaveLength(2);
    expect(await t.svc.deleteFor(adult, "slop")).toBe(2);
    expect(t.files()).toHaveLength(0);
    expect(await t.svc.list(adult, "slop")).toEqual([]);
  });
  test("photos are off without storage", async () => {
    const people = new MemoryPeopleStore();
    const svc = new PhotoService({ people, meta: new MemoryPhotoStore(), signingKey: "k", eligible: async () => true });
    const p = await people.createPerson({ id: crypto.randomUUID(), e164: "+12125550188", method: "otp_sms", at: 0, lowestAge: 30 });
    expect(await svc.upload(p.id, "slop", jpeg(), PHOTO_CONSENT.version)).toEqual({ ok: false, reason: "photos_off" });
  });
});

describe("the /api/photos routes on the public API", () => {
  test("upload needs a session, an image type, the consent header and a same-site request; a minor is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "photos-api-")); dirs.push(dir);
    const store = new MemoryPeopleStore();
    let t = Date.UTC(2026, 9, 9, 15);
    const codes = new Map<string, string>();
    const verified = new Set<string>();
    const photos = new PhotoService({ people: store, meta: new MemoryPhotoStore(), storage: new LocalDiskPhotoStorage(dir), signingKey: "k", now: () => t, eligible: async p => verified.has(p) });
    const api = createPublicApi({
      store, env: { PLATFORM_ENV: "dev" }, now: () => t, minStartMs: 0, minVerifyMs: 0, log: () => {}, photos,
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
    const kid = (await store.findPhone("+12125550171"))!.personId;
    verified.add(kid);
    expect(await call("POST", "/api/photos", jpeg() as unknown as BodyInit, img)).toEqual({ status: 403, body: { ok: false, error: "adults_only" } });
    // An adult: a cross-site request and a wrong type are refused before anything is read.
    cookie = "";
    await login("+12125550172");
    await call("POST", "/api/join", JSON.stringify({ firstName: "Ana", age: 31, consent: { sms: true, version: APPS.slop.consent.version } }), jsonH);
    verified.add((await store.findPhone("+12125550172"))!.personId);
    expect((await call("POST", "/api/photos", jpeg() as unknown as BodyInit, { ...img, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await call("POST", "/api/photos", jpeg() as unknown as BodyInit, { ...img, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/api/photos", jpeg() as unknown as BodyInit, { "content-type": "text/plain", "x-photo-consent": PHOTO_CONSENT.version })).status).toBe(415);
    expect((await call("POST", "/api/photos", jpeg() as unknown as BodyInit, { "content-type": "image/jpeg" })).body).toEqual({ ok: false, error: "consent_required" });
    const ok = await call("POST", "/api/photos", jpeg() as unknown as BodyInit, img);
    expect(ok.status).toBe(200);
    const list = await call("GET", "/api/photos");
    expect(list.body.photos).toHaveLength(1);
    // The member's list has no URL and no score.
    expect(JSON.stringify(list.body)).not.toMatch(/url|score|rating/);
    expect((await call("POST", "/api/photos/delete", JSON.stringify({ id: ok.body.id }), jsonH)).status).toBe(200);
    expect(readdirSync(dir)).toHaveLength(0);
  });
});
