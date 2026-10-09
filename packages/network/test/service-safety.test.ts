// Reports, holds and bans across apps, staff verification, and private photos through the service
// (docs/admin-console.md 3.7.1; founder decisions 2026-10-08: photos and ratings are for verified
// adults only). Postgres in a database of its own per test process; dry-run sends; fictional numbers
// (+1 212 555 01xx); photos in a temporary folder (no R2).
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { LocalDiskPhotoStorage, PHOTO_CONSENT, type PhotoRater } from "../../platform/src/photos.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { ServiceClient } from "../../observatory/src/sources/service.ts";
import { NetworkService, WEBHOOK_PATH, type ServiceOptions } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_service_safety_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_shared";
const NETS = [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }, { id: "peon:nyc" }, { id: "friends:nyc" }];
let phoneSeq = 40;
const newPhone = () => `+121255501${String(++phoneSeq).padStart(2, "0")}`;
const HOSTS: Record<AppId, string> = { ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104" };
const dirs: string[] = [];

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  sent = 0;
  async send(e164: string) { this.sent++; const code = String(100000 + this.sent * 7919); this.codes.set(e164, code); return { code }; }
}

let sql: SQL;
const open: NetworkService[] = [];
function service(clock: SimClock, more: Partial<ServiceOptions> = {}) {
  const directs: { app: string; to: string; body: string }[] = [];
  const otp = new FakeOtp();
  const s = new NetworkService({
    url: URL_, clock, instance: "safety", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,safety:saf-tok,reviewer:rev-tok", webhookSecret: SECRET,
    network: { seed: 1 }, publicApi: { otp, minStartMs: 0, minVerifyMs: 0 }, photoStorage: null,
    adapter: (_net, rt) => { const a = new DryRunAdapter(() => {}); a.direct = async (to, body) => { directs.push({ app: rt.app.id, to, body }); return "dry_run"; }; return a; },
    ...more,
  });
  open.push(s);
  return { s, directs, otp };
}

let evt = 0;
async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const staff = (s: NetworkService, token: string, method: string, path: string, b?: unknown, headers: Record<string, string> = {}) =>
  s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}), ...headers }, ...(b ? { body: JSON.stringify(b) } : {}) }));
const memberOf = async (app: AppId, e164: string) =>
  (await sql`select m.id, m.account_status from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string; account_status: string } | undefined;

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
  const forget = (app: AppId) => jar.delete(app);
  return { call, json, login, join, forget };
}

/** A small JPEG with an EXIF block carrying GPS. */
function jpeg() {
  const seg = (m: number, p: Uint8Array) => Uint8Array.from([0xff, m, (p.length + 2) >> 8, (p.length + 2) & 0xff, ...p]);
  const enc = (x: string) => new TextEncoder().encode(x);
  return Uint8Array.from([0xff, 0xd8, ...seg(0xe1, enc("Exif\0\0GPSLatitude 40.71")), ...seg(0xda, new Uint8Array(6)), ...enc("SCAN"), 0xff, 0xd9]);
}

describe.skipIf(!pgAvailable)("reports, holds, bans and photos through the service (Postgres)", () => {
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

  test("report -> hold on every app -> ban by phone; the banned phone cannot join any app again; every step is audited", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp, directs } = service(clock);
    const web = site(s, clock, otp);
    const ana = newPhone(), ben = newPhone();
    for (const [p, who] of [[ana, "Ana, 30"], [ben, "Ben, 32"]] as const) {
      expect(await text(s, clock, p, "slop")).toBe("join_asked");
      expect(await text(s, clock, p, who)).toBe("joined");
    }
    // Ben is on friends too (the hold and the ban reach every app).
    await web.login("friends", ben);
    expect((await web.join("friends", 32, "Ben")).status).toBe(200);
    const a = (await memberOf("slop", ana))!.id, b = (await memberOf("slop", ben))!.id, bf = (await memberOf("friends", ben))!.id;
    expect(await text(s, clock, ana, "report Ben, he was rude and kept texting me")).toBe("handled");

    // The queue: safety (or admin) only; ids and a kind, never the words.
    expect((await staff(s, "rev-tok", "GET", "/apps/slop/safety/reports")).status).toBe(403);
    const q = await (await staff(s, "saf-tok", "GET", "/apps/slop/safety/reports")).json() as any;
    expect(q.reports).toHaveLength(1);
    expect(q.reports[0]).toMatchObject({ kind: "harassment", reporterId: a, subjectId: b, status: "open", source: "message", priorReports: 0 });
    expect(JSON.stringify(q)).not.toMatch(/rude|texting/);
    const reportId = q.reports[0].id as string;

    // Hold: a decision note of 5+ characters; the person is held on slop and on friends.
    expect((await staff(s, "saf-tok", "POST", "/apps/slop/safety/hold", { memberId: b, note: "x" })).status).toBe(400);
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/hold", { memberId: b, note: "reported after a date", reportId })).json()).toEqual({ ok: true });
    const level = async (app: AppId, id: string) => s.runtimeFor(app)!.readState(n => n.safetyCases().find(c => c.memberId === id)?.level);
    expect(await level("slop", b)).toBe("hold");
    expect(await level("friends", bf)).toBe("hold");

    // Ban by phone.
    expect((await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: b, by: "number", note: "confirmed by staff" })).status).toBe(400);
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: b, by: "phone", note: "confirmed by staff", reportId })).json()).toEqual({ ok: true });
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: b, by: "phone", note: "confirmed again" })).json()).toEqual({ ok: false, reason: "already_banned" });
    expect((await sql`select scope, report_id, phone_hash is not null as hashed from platform.bans`).map((r: any) => [r.scope, r.report_id, r.hashed])).toEqual([["phone", reportId, true]]);
    // A ban never stores the number itself, only its keyed hash.
    expect(JSON.stringify(await sql`select * from platform.bans`)).not.toContain(ben.slice(2));
    expect((await sql`select app_id, state from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id where ph.e164 = ${ben} order by app_id`).map((r: any) => `${r.app_id}:${r.state}`))
      .toEqual(["friends:restricted", "slop:restricted"]);
    expect([(await memberOf("slop", ben))!.account_status, (await memberOf("friends", ben))!.account_status]).toEqual(["restricted", "restricted"]);
    const after = await (await staff(s, "saf-tok", "GET", "/apps/slop/safety/reports")).json() as any;
    expect(after.reports[0].status).toBe("banned");

    // The banned number cannot join any other app, by text or on the web; nothing is stored and nothing is answered.
    const before = directs.length;
    expect(await text(s, clock, ben, "peon")).toBe("held");
    expect(directs.length).toBe(before);
    await web.login("peon", ben);
    expect((await web.join("peon", 32, "Ben")).body).toMatchObject({ ok: false, error: "review" });
    expect(await memberOf("peon", ben)).toBeUndefined();
    // Delete everything does not lift a ban: the same number still cannot join.
    clock.advance(MINUTE);
    expect((await web.json("peon", "POST", "/api/me/delete", { scope: "all" })).status).toBe(200);
    await web.login("peon", ben);
    expect((await web.join("peon", 32, "Ben")).body).toMatchObject({ ok: false, error: "review" });
    expect((await sql`select count(*)::int as n from platform.bans`)[0].n).toBe(1);

    // Audit: requested before result, for the hold and the ban.
    const rows = (await sql`select action, detail->>'safety' as safety, detail->>'phase' as phase, ok from network.staff_audit where action in ('safety', 'read_safety_reports') order by id`) as any[];
    const hold = rows.filter(r => r.safety === "hold").map(r => r.phase), ban = rows.filter(r => r.safety === "ban").map(r => r.phase);
    expect(hold).toEqual(["requested", "result"]);
    expect(ban).toEqual(["requested", "result", "refused"]);
    expect(rows.filter(r => r.action === "read_safety_reports").length).toBe(2);
  }, T);

  test("ban by person; dismiss a report", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const cy = newPhone(), di = newPhone();
    for (const [p, who] of [[cy, "Cy, 40"], [di, "Di, 38"]] as const) { await text(s, clock, p, "slop"); await text(s, clock, p, who); }
    await text(s, clock, cy, "report Di, she asked me for money on venmo");
    await text(s, clock, di, "report Cy, he was rude");
    const q = (await (await staff(s, "saf-tok", "GET", "/apps/slop/safety/reports")).json() as any).reports as any[];
    const aboutCy = q.find(r => r.kind === "harassment")!, aboutDi = q.find(r => r.kind === "scam")!;
    expect((await staff(s, "saf-tok", "POST", "/apps/slop/safety/dismiss", { reportId: aboutCy.id, note: "a retaliation report" })).status).toBe(200);
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/dismiss", { reportId: "nope", note: "no such report" })).json()).toEqual({ ok: false, reason: "unknown_report" });
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: aboutDi.subjectId, by: "person", note: "scam confirmed" })).json()).toEqual({ ok: true });
    expect((await sql`select scope from platform.bans`).map((r: any) => r.scope)).toEqual(["person"]);
    expect(await text(s, clock, di, "friends")).toBe("held");
  }, T);

  test("the console's client (observatory ServiceClient) reads the queue and acts through these routes; the signed-in person is the actor", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock, { tokens: "admin:adm-tok,safety:saf-tok,admin:console-token-0123456789abcdef0123", consoleToken: "console-token-0123456789abcdef0123" });
    const srv = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => s.fetch(req) });
    try {
      const ed = newPhone(), flo = newPhone();
      for (const [p, who] of [[ed, "Ed, 35"], [flo, "Flo, 33"]] as const) { await text(s, clock, p, "slop"); await text(s, clock, p, who); }
      await text(s, clock, ed, "report Flo, she threatened me");
      const client = new ServiceClient({ url: `http://127.0.0.1:${srv.port}`, token: "console-token-0123456789abcdef0123", app: "slop" });
      const reports = await client.reports();
      expect(Array.isArray(reports) && reports[0]).toMatchObject({ kind: "unsafe", status: "open" });
      const r = (reports as { id: string; subjectId: string }[])[0]!;
      expect(await client.safety("safety.lead@example.org", { action: "hold", memberId: r.subjectId, note: "urgent report", reportId: r.id } as never)).toEqual({ ok: true });
      expect(await client.safety("safety.lead@example.org", { action: "ban", memberId: r.subjectId, by: "person", note: "threat confirmed", reportId: r.id } as never)).toEqual({ ok: true });
      expect(await client.safety("safety.lead@example.org", { action: "ban", memberId: r.subjectId, by: "person", note: "threat confirmed" } as never)).toMatchObject({ ok: false, code: "already_banned" });
      expect((await sql`select banned_by from platform.bans`).map((x: any) => x.banned_by)).toEqual(["safety.lead@example.org"]);
      expect(new Set((await sql`select actor from network.staff_audit where action = 'safety'`).map((x: any) => x.actor))).toEqual(new Set(["safety.lead@example.org"]));
      // Photos: no photo storage here, so the console hears that photos are off (never a link).
      expect(await client.photos("safety.lead@example.org", r.subjectId, "report review")).toMatchObject({ ok: false });
    } finally { srv.stop(true); }
  }, T);

  test("photos: adults by stated age (no ID check), a failed staff check refuses, the staff read audited before the link, signed links through the backend, deleted on leave", async () => {
    await fresh();
    const dir = mkdtempSync(join(tmpdir(), "svc-photos-")); dirs.push(dir);
    const clock = new SimClock(START);
    const { s, otp } = service(clock, { photoStorage: new LocalDiskPhotoStorage(dir), photoBaseUrl: "https://slop.date" });
    const web = site(s, clock, otp);
    const ana = newPhone(), kid = newPhone();
    await web.login("slop", ana);
    expect((await web.join("slop", 30, "Ana")).status).toBe(200);
    const a = (await memberOf("slop", ana))!.id;
    const upload = () => web.call("slop", "POST", "/api/photos", jpeg() as unknown as BodyInit, { "content-type": "image/jpeg", "x-photo-consent": PHOTO_CONSENT.version });
    // Founder decision 9: no ID check, a stated adult age is enough.
    expect((await upload()).status).toBe(200);
    expect(readdirSync(dir)).toHaveLength(1);
    // A failed age check recorded by staff (safety only) refuses further photos.
    expect((await staff(s, "rev-tok", "POST", `/apps/slop/members/${a}/verify`, { check: "age", result: "fail", note: "staff review" })).status).toBe(403);
    expect(await (await staff(s, "saf-tok", "POST", `/apps/slop/members/${a}/verify`, { check: "age", result: "fail", note: "staff review" })).json()).toEqual({ ok: true });
    expect(await (await upload()).json()).toEqual({ ok: false, error: "not_verified" });
    expect(await (await staff(s, "saf-tok", "POST", `/apps/slop/members/${a}/verify`, { check: "age", result: "pass", note: "staff review" })).json()).toEqual({ ok: true });
    // A 16-year-old member (13+ may join slop): verified or not, never photos.
    web.forget("slop");
    await web.login("slop", kid);
    expect((await web.join("slop", 16, "Kai")).status).toBe(200);
    const k = (await memberOf("slop", kid))!.id;
    // slop's network runs slopPack; dating prefs only for the adult (13+ may join, minors never opt in to romance).
    expect(s.runtimeFor("slop")!.wiring.pack?.id).toBe("slop");
    const prefs = Object.fromEntries((await sql`select id, prefs from network.members where app_id = 'slop'`).map((x: any) => [x.id, x.prefs]));
    expect([prefs[a].romanceOptIn, prefs[a].categoriesOptIn]).toEqual([true, ["romance"]]);
    expect([prefs[k].romanceOptIn, prefs[k].categoriesOptIn]).toEqual([false, []]);
    await staff(s, "saf-tok", "POST", `/apps/slop/members/${k}/verify`, { check: "age", result: "pass", note: "ID checked by staff" });
    expect(await (await upload()).json()).toEqual({ ok: false, error: "adults_only" });
    expect(await (await staff(s, "saf-tok", "GET", `/apps/slop/members/${k}/photos`, undefined, { "x-network-reason": "report review" })).json()).toEqual({ ok: false, reason: "adults_only" });

    // Staff read: a reason is required; the audit row comes before the link.
    expect((await staff(s, "saf-tok", "GET", `/apps/slop/members/${a}/photos`)).status).toBe(400);
    expect((await staff(s, "rev-tok", "GET", `/apps/slop/members/${a}/photos`, undefined, { "x-network-reason": "report review" })).status).toBe(403);
    const r = await (await staff(s, "saf-tok", "GET", `/apps/slop/members/${a}/photos`, undefined, { "x-network-reason": "report review" })).json() as any;
    expect(r.photos).toHaveLength(1);
    expect(r.photos[0].url).toMatch(/^https:\/\/slop\.date\/api\/photos\/view\//);
    const audit = (await sql`select target_id, detail->>'phase' as phase, ok from network.staff_audit where action = 'read_photos' order by id`) as any[];
    expect(audit.map(x => [x.target_id, x.phase, x.ok])).toEqual([[k, "requested", true], [k, "result", false], [a, "requested", true], [a, "result", true]]);
    // The link works through the backend (the site router forwards /api/*), without GPS.
    const u = new URL(r.photos[0].url);
    const img = await web.call("slop", "GET", `${u.pathname}${u.search}`);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await img.arrayBuffer()).includes(Buffer.from("GPS"))).toBe(false);

    // Leaving slop deletes the photos (bytes and rows).
    web.forget("slop");
    await web.login("slop", ana);
    expect((await web.json("slop", "POST", "/api/me/delete", { scope: "app" })).status).toBe(200);
    expect(readdirSync(dir)).toHaveLength(0);
    expect((await sql`select count(*)::int as n from platform.photos`)[0].n).toBe(0);
  }, T);
  test("ratings of looks go with their photo, with a failed age check, and with a minor age on any app (adults only)", async () => {
    await fresh();
    const dir = mkdtempSync(join(tmpdir(), "svc-ratings-")); dirs.push(dir);
    const clock = new SimClock(START);
    const rater: PhotoRater = { id: "fake", rate: async () => ({ face: 0.5, body: 0.5, overall: 0.5 }) };
    const { s, otp } = service(clock, { photoStorage: new LocalDiskPhotoStorage(dir), photoRater: rater });
    const web = site(s, clock, otp);
    const ana = newPhone();
    await web.login("slop", ana);
    expect((await web.join("slop", 30, "Ana")).status).toBe(200);
    const a = (await memberOf("slop", ana))!.id;
    const upload = async () => (await (await web.call("slop", "POST", "/api/photos", jpeg() as unknown as BodyInit, { "content-type": "image/jpeg", "x-photo-consent": PHOTO_CONSENT.version })).json()) as { ok: boolean; id: string };
    const ratings = async () => (await sql`select count(*)::int as n from network.facets where member_id = ${a} and id like ${`${a}:photo:%`}`)[0].n as number;
    const first = await upload(), second = await upload();
    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(await ratings()).toBe(2);
    // The member deletes one photo: its rating goes with it (before: the rating stayed).
    expect((await web.json("slop", "POST", "/api/photos/delete", { id: first.id })).status).toBe(200);
    expect(await ratings()).toBe(1);
    // A failed age check recorded by staff: no rating stays on this app.
    expect((await staff(s, "saf-tok", "POST", `/apps/slop/members/${a}/verify`, { check: "age", result: "fail", note: "staff review" })).status).toBe(200);
    expect(await ratings()).toBe(0);
    expect((await staff(s, "saf-tok", "POST", `/apps/slop/members/${a}/verify`, { check: "age", result: "pass", note: "staff review" })).status).toBe(200);
    expect((await upload()).ok).toBe(true);
    expect(await ratings()).toBe(1);
    // The same person says they are 15 on another app: every photo and every rating goes, on every app.
    await web.login("friends", ana);
    expect((await web.join("friends", 15, "Ana")).status).toBe(200);
    expect(await ratings()).toBe(0);
    expect(readdirSync(dir)).toHaveLength(0);
  }, T);
  test("staff with safety on one app hold on that app only and cannot ban; the audit never counts the person's apps", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock, { tokens: "safety@peon:peon-safety-tok,safety:saf-tok" });
    const web = site(s, clock, otp);
    const ana = newPhone();
    await web.login("slop", ana);
    expect((await web.join("slop", 30, "Ana")).status).toBe(200);
    await web.login("peon", ana);
    expect((await web.join("peon", 30, "Ana")).status).toBe(200);
    const peon = (await memberOf("peon", ana))!.id, slop = (await memberOf("slop", ana))!.id;
    const held = async (app: AppId, id: string) => {
      const st = (await sql`select state from network.network_state where id = ${`${app}:nyc`}`)[0]?.state;
      const x = typeof st === "string" ? JSON.parse(st) : st;
      return (x?.trust ?? []).some((t: any) => t.id === id && t.level === "hold");
    };
    // Before the fix a peon-only reviewer held the person on slop.date too, and the audit row said "apps: 2".
    expect((await staff(s, "peon-safety-tok", "POST", "/apps/peon/safety/hold", { memberId: peon, note: "report after an interview" })).status).toBe(200);
    expect([await held("peon", peon), await held("slop", slop)]).toEqual([true, false]);
    expect(await (await staff(s, "peon-safety-tok", "POST", "/apps/peon/safety/ban", { memberId: peon, by: "phone", note: "repeated reports" })).json()).toEqual({ ok: false, reason: "needs_safety_everywhere" });
    expect((await sql`select count(*)::int as n from platform.bans`)[0].n).toBe(0);
    const details = (await sql`select detail from network.staff_audit where action = 'safety'`).map((r: any) => (typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail));
    for (const d of details) expect("apps" in d).toBe(false);
    // Safety on every app: the hold reaches every app.
    expect((await staff(s, "saf-tok", "POST", "/apps/peon/safety/hold", { memberId: peon, note: "cross-app review" })).status).toBe(200);
    expect(await held("slop", slop)).toBe(true);
  }, T);
});
