// Private member photos (photos.ts) on Postgres (integration; founder decision 4 of 2026-10-09):
// adults only, consented, metadata stripped by an allowlist, no public URL, short signed staff links,
// the rater refused for anyone not a rateable adult member, a rating discarded when the person stops
// being one while the rater runs, each rater try a cost row, and every photo deleted on leave, delete
// everything or a minor age. PgPeopleStore and PgPhotoStore on a database of its own, a temporary
// folder for the bytes; no network, no R2 (R2PhotoStorage is not exercised here), no Workers AI.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { APPS, type AppId } from "../src/apps.ts";
import { createPublicApi } from "../src/api.ts";
import {
  LocalDiskPhotoStorage, PgPhotoStore, PHOTO_CONSENT, PHOTO_MAX_BYTES, PHOTO_MAX_PER_PERSON, PHOTO_VIEW_TTL_MS, PhotoService, sniffType, stripMetadata, withRetry,
  type PhotoRater, type PhotoRefusal,
} from "../src/photos.ts";
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
  function setup(o: { rater?: PhotoRater } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "photos-test-")); dirs.push(dir);
    const meta = new PgPhotoStore(sql);
    const verified = new Set<string>();
    const ratings: { personId: string; score: AppearanceScore }[] = [];
    const removed: string[] = [];
    let now = Date.UTC(2026, 9, 9, 15);
    const svc = new PhotoService({
      people, meta, storage: new LocalDiskPhotoStorage(dir), signingKey: "test-key", now: () => now, rater: o.rater,
      eligible: async (personId, app) => app === "slop" && verified.has(personId),
      banned: personId => people.isBanned("", personId),
      onRating: async (personId, _app, s) => { ratings.push({ personId, score: s }); },
      onRemoved: async personId => { removed.push(personId); },
    });
    /** A person with a live slop membership (verified unless told otherwise). */
    const person = async (age: number | null, verify = true) => {
      const k = n++;
      const p = await people.createPerson({ id: crypto.randomUUID(), e164: `+1212555${String(1000 + k).padStart(4, "0")}`, method: "otp_sms", at: now, lowestAge: age });
      await people.putMembership({ app: "slop", personId: p.id, memberId: `slop_photos_${process.pid}_${k}`, state: "active", review: null, firstName: `P${k}`, profile: {}, joinedAt: now, leftAt: null });
      if (verify) verified.add(p.id);
      return p.id;
    };
    return { svc, meta, dir, verified, ratings, removed, person, files: () => readdirSync(dir), tick: (ms: number) => { now += ms; } };
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
    const stored = new Uint8Array(await Bun.file(join(t.dir, file!)).arrayBuffer());
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
    await people.noteAge(adult, 16);
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

  test("a rating is discarded when the age drops under 18, a ban lands, the member leaves or a rated photo is deleted while the rater runs", async () => {
    // The rater runs `during` before it answers: what happens in the world while Workers AI thinks.
    let during: (() => Promise<void>) | undefined;
    let calls = 0;
    const t = setup({ rater: { id: "fake-clef", rate: async () => { calls++; await during?.(); return score; } } });
    const cases: [string, (personId: string) => Promise<void>, PhotoRefusal][] = [
      ["age", personId => people.noteAge(personId, 16).then(() => {}), "adults_only"],
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
      eligible: async () => true, onRating: async () => { await people.noteAge(id, 17); }, onRemoved: async personId => { t.removed.push(personId); },
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
});
