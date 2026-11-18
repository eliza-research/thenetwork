// A photo on another app's own line is that app's message, never a slop.date photo (photoIntake.ts header: "Photos sent to the
// shared line by text"; accounts.ts exportApp: "This app's own data. Nothing from another app, not even its name"). The
// consent answer already honors the routed app; the photo path did not. Postgres in a database of its own per test
// process; dry-run adapters, a fake attachment fetch, photos on a temporary disk; nothing is sent.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";

import type { AppId } from "../../platform/src/apps.ts";
import { LocalDiskPhotoStorage, PHOTO_CONSENT } from "../../platform/src/photos.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { PHOTO_TEXT } from "../service/photoIntake.ts";
import { NetworkService, type ServiceOptions } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_photo_other_line_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string, url = ADMIN_URL) { const sql = new SQL({ url, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }
const NETS = [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }, { id: "slop:nyc", matchingEnabled: false }];
let phoneSeq = 0;
const newPhone = () => `+121255501${String(10 + ++phoneSeq).padStart(2, "0")}`;
let sql: SQL;
const open: NetworkService[] = [];
const dirs: string[] = [];
interface Direct { app: string; to: string; body: string; kind: string }

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...xs: (Uint8Array | number[])[]) => { const parts = xs.map(x => (x instanceof Uint8Array ? x : Uint8Array.from(x))); const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const seg = (marker: number, payload: Uint8Array) => cat([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff], payload);
const jpeg = () => cat([0xff, 0xd8], seg(0xdb, new Uint8Array(65)), seg(0xc0, new Uint8Array(15)), seg(0xc4, new Uint8Array(20)), seg(0xda, new Uint8Array(10)), enc("SCANDATA"), [0xff, 0xd9]);

function service(clock: SimClock, more: Partial<ServiceOptions> = {}) {
  const directs: Direct[] = [];
  const fetched: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "photo-line-")); dirs.push(dir);
  const s = new NetworkService({
    url: URL_, clock, instance: "photo-line", log: () => {}, env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" }, networks: NETS,
    network: { seed: 1 }, notify: false,
    photoStorage: new LocalDiskPhotoStorage(dir),
    fetchMedia: async url => { fetched.push(url); return jpeg(); },
    adapter: (_net, rt) => { const a = new DryRunAdapter(() => {}); a.direct = async (to, body, _id, kind) => { directs.push({ app: rt.app.id, to, body, kind }); return "dry_run"; }; return a; },
    ...more,
  });
  open.push(s);
  return { s, directs, fetched, dir };
}
let evt = 0;
async function say(s: NetworkService, clock: SimClock, from: string, text: string, o: { app?: AppId; media?: string[] } = {}) {
  const n = ++evt;
  const out = await s.inbound({ kind: "message", channel: "sim", messageId: `m${n}`, from, to: null, chatId: from, isGroup: false, text, mediaUrls: o.media ?? [], transport: "imessage" as never, receivedAt: clock.now() }, o.app ? { app: o.app } : {});
  clock.advance(MINUTE);
  return out;
}
const photos = async (e164: string) => (await sql`select p.id, p.app_id from platform.photos p join platform.phone_identities ph on ph.person_id = p.person_id where ph.e164 = ${e164} and p.deleted_at is null`) as { id: string; app_id: string }[];
const memberships = async (e164: string) => (await sql`select m.app_id, m.state, m.profile from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id where ph.e164 = ${e164} order by app_id`).map((r: any) => ({ app: r.app_id, state: r.state, consent: r.profile?.photoConsent }));

/** An adult slop member with the photo consent given by text and one photo stored. */
async function slopAdultWithPhoto(s: NetworkService, clock: SimClock, phone: string) {
  expect(await say(s, clock, phone, "slop", { app: "slop" })).toBe("join_asked");
  expect(await say(s, clock, phone, "Ana, 31", { app: "slop" })).toBe("joined");
  expect(await say(s, clock, phone, "", { app: "slop", media: ["https://cdn.example/a.jpg"] })).toBe("handled");
  expect(await say(s, clock, phone, "YES PHOTOS", { app: "slop" })).toBe("handled");
  expect(await say(s, clock, phone, "", { app: "slop", media: ["https://cdn.example/b.jpg"] })).toBe("handled");
  expect(await photos(phone)).toHaveLength(1);
}

describe.skipIf(!pgAvailable)("a photo on another app's own line (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => { await sql?.close(); await admin(`drop database if exists ${DB} with (force)`).catch(() => {}); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const fresh = async () => { await applySchema(URL_, { reset: true, lockTimeout: "5s" }); };

  const pending = async () => (await sql`select kind, app_id from platform.pending_texts order by kind`).map((r: any) => `${r.kind}:${r.app_id}`);

  test("a slop member's photo on friends.help's own line: no consent ask, nothing fetched, nothing stored; with consent, still nothing", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, directs, fetched } = service(clock);
    const ana = newPhone();
    expect(await say(s, clock, ana, "slop", { app: "slop" })).toBe("join_asked");
    expect(await say(s, clock, ana, "Ana, 31", { app: "slop" })).toBe("joined");
    directs.length = 0; fetched.length = 0;
    // Before the fix: slop's consent ask was answered on friends' line and a photo_consent row was stored.
    await say(s, clock, ana, "", { app: "friends", media: ["https://cdn.example/f.jpg"] });
    expect(directs.map(d => d.body)).not.toContain(PHOTO_TEXT.ask);
    expect(fetched).toEqual([]);
    expect(await pending()).not.toContain("photo_consent:slop");
    // With the consent given on slop's line, a photo on friends' line is still not slop's.
    await say(s, clock, ana, "", { app: "slop", media: ["https://cdn.example/a.jpg"] });
    expect(await say(s, clock, ana, "YES PHOTOS", { app: "slop" })).toBe("handled");
    directs.length = 0; fetched.length = 0;
    await say(s, clock, ana, "", { app: "friends", media: ["https://cdn.example/g.jpg"] });
    expect(fetched).toEqual([]);
    expect(await photos(ana)).toHaveLength(0);
    expect(directs.map(d => d.body)).not.toContain(PHOTO_TEXT.stored(1));
  }, T);

  test("control: on slop's own line and on the shared line the photo flow is unchanged", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, directs, fetched } = service(clock);
    const ana = newPhone();
    await slopAdultWithPhoto(s, clock, ana);
    expect(fetched).toEqual(["https://cdn.example/b.jpg"]);
    // The shared line (no per-app path): a slop member's photo is slop's.
    directs.length = 0; fetched.length = 0;
    expect(await say(s, clock, ana, "", { media: ["https://cdn.example/c.jpg"] })).toBe("handled");
    expect(fetched).toEqual(["https://cdn.example/c.jpg"]);
    expect(await photos(ana)).toHaveLength(2);
    expect(directs.map(d => d.body)).toContain(PHOTO_TEXT.stored(1));
  }, T);
});
