// The photo-object and clef-rating machines through the service (docs/research/2026-11-07-state-machines.md,
// module photos_rating): an upload in flight against an age drop and a leave (SD-052), a failed staff age
// check (SD-053), parallel uploads against the count limit (SD-372), crash windows in the upload and the
// delete (SD-176), and a crash after the age commit (Q-photos_rating-1). A crash is a storage call that
// does its work and then throws, or a commit without the step after it. Postgres in a database of its own
// per test process; dry-run sends; fictional numbers (+1 212 555 02xx); photos in a temporary folder.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { DAY, SimClock } from "@thenetwork/core";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { LocalDiskPhotoStorage, PHOTO_CONSENT, PHOTO_MAX_PER_PERSON, type PhotoRater, type PhotoStorage, type PhotoType } from "../../platform/src/photos.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, type ServiceOptions } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_photo_object_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const NETS = [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }, { id: "peon:nyc" }, { id: "friends:nyc" }];
let phoneSeq = 0;
const newPhone = () => `+121255502${String(++phoneSeq).padStart(2, "0")}`;
const HOSTS: Record<AppId, string> = { ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104" };
const dirs: string[] = [];

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  sent = 0;
  async send(e164: string) { this.sent++; const code = String(100000 + this.sent * 7919); this.codes.set(e164, code); return { code }; }
}

/** Local storage with a hook in each call: `afterPut` runs when the bytes are written, `afterDelete` when they are removed. */
class HookedStorage implements PhotoStorage {
  readonly kind = "local" as const;
  afterPut?: () => Promise<void>;
  afterDelete?: () => Promise<void>;
  constructor(private readonly inner: LocalDiskPhotoStorage) {}
  async put(key: string, bytes: Uint8Array, type: PhotoType) { await this.inner.put(key, bytes); await this.afterPut?.(); }
  get(key: string) { return this.inner.get(key); }
  async delete(key: string) { await this.inner.delete(key); await this.afterDelete?.(); }
}
const crash = async () => { throw new Error("crash"); };

let sql: SQL;
const open: NetworkService[] = [];
function service(clock: SimClock, more: Partial<ServiceOptions> = {}) {
  const otp = new FakeOtp();
  const dir = mkdtempSync(join(tmpdir(), "photo-object-")); dirs.push(dir);
  const storage = new HookedStorage(new LocalDiskPhotoStorage(dir));
  const s = new NetworkService({
    url: URL_, clock, instance: "photo-object", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,safety:saf-tok,reviewer:rev-tok", webhookSecret: "whsec_photo",
    network: { seed: 1 }, publicApi: { otp, minStartMs: 0, minVerifyMs: 0 }, photoStorage: storage,
    adapter: () => new DryRunAdapter(() => {}),
    ...more,
  });
  open.push(s);
  return { s, otp, storage, files: () => readdirSync(dir) };
}

/** The public API as a site calls it, with a cookie per app. */
function site(s: NetworkService, clock: SimClock, otp: FakeOtp) {
  const jar = new Map<AppId, string>();
  const call = async (app: AppId, method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}) => {
    const res = await s.publicFetch(new Request(`http://127.0.0.1:8790${path}`, { method, headers: { host: HOSTS[app], ...(jar.get(app) ? { cookie: jar.get(app)! } : {}), ...headers }, ...(body ? { body } : {}) }));
    const c = res.headers.get("set-cookie");
    if (c) jar.set(app, c.split(";")[0]!);
    return res;
  };
  const json = async (app: AppId, method: string, path: string, b?: unknown) => {
    const res = await call(app, method, path, b === undefined ? undefined : JSON.stringify(b), { "content-type": "application/json" });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const login = async (app: AppId, phone: string) => {
    clock.advance(31_000);
    expect((await json(app, "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    expect((await json(app, "POST", "/api/auth/otp/verify", { phone, code: otp.codes.get(phone) })).status).toBe(200);
  };
  const join = (app: AppId, age: number, firstName = "Rae") => json(app, "POST", "/api/join", { firstName, age, consent: { sms: true, wording: APPS[app].consent.text } });
  const upload = async () => (await (await call("slop", "POST", "/api/photos", jpeg() as unknown as BodyInit, { "content-type": "image/jpeg", "x-photo-consent": PHOTO_CONSENT.version })).json()) as { ok: boolean; id?: string; error?: string };
  return { call, json, login, join, upload };
}

/** A small JPEG. */
function jpeg() {
  const seg = (m: number, p: Uint8Array) => Uint8Array.from([0xff, m, (p.length + 2) >> 8, (p.length + 2) & 0xff, ...p]);
  return Uint8Array.from([0xff, 0xd8, ...seg(0xda, new Uint8Array(6)), ...new TextEncoder().encode("SCAN"), 0xff, 0xd9]);
}

const staff = (s: NetworkService, token: string, method: string, path: string, b?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
const member = async (app: AppId, e164: string) =>
  (await sql`select m.id, m.person_id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string; person_id: string };
/** Photo rows of the person, hidden ones too. */
const rows = async (personId: string) => Number((await sql`select count(*)::int as n from platform.photos where person_id = ${personId}::uuid`)[0].n);
const ratings = async (memberId: string) => Number((await sql`select count(*)::int as n from network.facets where member_id = ${memberId} and id = ${`${memberId}:appearance`}`)[0].n);
const rater: PhotoRater = { id: "fake-clef", rate: async () => ({ face: 0.5, body: 0.5, overall: 0.5, confidence: 0.9, model: "fake-clef" }) };

describe.skipIf(!pgAvailable)("photo-object and clef-rating through the service (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    for (const s of open) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const fresh = async () => { await applySchema(URL_, { reset: true, lockTimeout: "5s" }); };

  /** An adult slop member, signed in on the slop site. */
  async function adult(t: ReturnType<typeof service>, clock: SimClock) {
    const web = site(t.s, clock, t.otp);
    const phone = newPhone();
    await web.login("slop", phone);
    expect((await web.join("slop", 30, "Ana")).status).toBe(200);
    return { web, phone, ...(await member("slop", phone)) };
  }

  test("SD-052: an upload in flight does not survive an age drop to 15 on another app", async () => {
    await fresh();
    const clock = new SimClock(START);
    const t = service(clock);
    const a = await adult(t, clock);
    await a.web.login("friends", a.phone);
    // The bytes are written; before the row lands, the person says they are 15 (ageLowered runs deleteFor).
    t.storage.afterPut = async () => { t.storage.afterPut = undefined; expect((await a.web.join("friends", 15, "Ana")).status).toBe(200); };
    expect(await a.web.upload()).toEqual({ ok: false, error: "adults_only" });
    expect(await rows(a.person_id)).toBe(0);
    expect(t.files()).toEqual([]);
  }, T);

  test("SD-052: an upload in flight does not survive leaving the app", async () => {
    await fresh();
    const clock = new SimClock(START);
    const t = service(clock);
    const a = await adult(t, clock);
    // The worst order: the leave runs deleteFor (no row yet), the upload adds its row, then the leave goes on.
    const deleteFor = t.s.photos.deleteFor.bind(t.s.photos);
    let deleted!: () => void, uploaded!: () => void;
    const deletedP = new Promise<void>(r => { deleted = r; }), uploadedP = new Promise<void>(r => { uploaded = r; });
    t.s.photos.deleteFor = async (personId, app) => { const n = await deleteFor(personId, app); deleted(); await uploadedP; return n; };
    let leave!: Promise<{ status: number }>;
    t.storage.afterPut = async () => { t.storage.afterPut = undefined; leave = a.web.json("slop", "POST", "/api/me/delete", { scope: "app" }); await deletedP; };
    const r = await a.web.upload();
    uploaded();
    expect((await leave).status).toBe(200);
    expect(r.ok).toBe(false);
    expect(await rows(a.person_id)).toBe(0);
    expect(t.files()).toEqual([]);
  }, T);

  test("SD-053: a failed staff age check deletes the photos and the rating", async () => {
    await fresh();
    const clock = new SimClock(START);
    const t = service(clock, { photoRater: rater });
    const a = await adult(t, clock);
    expect((await a.web.upload()).ok).toBe(true);
    expect(await ratings(a.id)).toBe(1);
    expect(await (await staff(t.s, "saf-tok", "POST", `/apps/slop/members/${a.id}/verify`, { check: "age", result: "fail", note: "staff review" })).json()).toEqual({ ok: true });
    expect(await ratings(a.id)).toBe(0);
    expect(await rows(a.person_id)).toBe(0);
    expect(t.files()).toEqual([]);
  }, T);

  test("SD-372: parallel uploads never pass the photo limit", async () => {
    await fresh();
    const clock = new SimClock(START);
    const t = service(clock);
    const a = await adult(t, clock);
    for (let i = 1; i < PHOTO_MAX_PER_PERSON; i++) expect((await a.web.upload()).ok).toBe(true);
    const r = await Promise.all([1, 2, 3].map(() => t.s.photos.upload(a.person_id, "slop", jpeg(), PHOTO_CONSENT.version)));
    expect(r.filter(x => x.ok)).toHaveLength(1);
    expect(r.filter(x => !x.ok).map(x => !x.ok && x.reason)).toEqual(["too_many", "too_many"]);
    expect(await rows(a.person_id)).toBe(PHOTO_MAX_PER_PERSON);
    expect(t.files()).toHaveLength(PHOTO_MAX_PER_PERSON);
  }, T);



});
