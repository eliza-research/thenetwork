// Photos on the live path against Postgres (a database of its own on the dev cluster, fake rater,
// fake clock, dry-run sends): upload and consent, photos sent by text, rating retries, moderation,
// the probe photo, and the weekly bias monitor. Nothing leaves the machine.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { migrate } from "../../packages/observatory/db/migrate.ts";
import { pgAvailable } from "../../packages/platform/test/pg.ts";
import { LocalDiskPhotoStorage, PHOTO_CONSENT, RATING_MAX_TRIES, type PhotoRater, type PhotoScores } from "../../packages/platform/src/photos.ts";
import type { Membership } from "../../packages/platform/src/store.ts";
import type { ChannelEvent } from "../../packages/blooio/src/types.ts";
import type { MemberId } from "../../packages/core/src/index.ts";
import type { Outbound } from "../../packages/network/service/channel.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import type { NetworkRuntime } from "../../packages/network/service/runtime.ts";
import { BIAS_EVERY_MS } from "../../packages/network/service/biasJob.ts";
import type { StaffUser } from "../../packages/observatory/src/types.ts";

const USER = process.env.USER ?? "postgres";
const DB = "network_test_photos";
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
const T0 = Date.UTC(2026, 9, 8, 15, 0, 0);
const MIN = 60_000;
const ADMIN = "tok-admin-photos-test", SAFETY = "tok-safety-photos-test", REVIEWER = "tok-reviewer-photos-test";

async function admin(q: string) {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
}

/** A tiny valid JPEG (no metadata); `n` makes each one different. */
const jpeg = (n = 0) => Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, n & 0xff, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9);

/** The fake rater: fails while `failing` is above 0, else returns `score`. */
const rater = { calls: 0, failing: 0, score: { face: 0.4, body: -0.2, overall: 0.6, confidence: 0.8, model: "fake-v1", bodyType: "athletic", bodyTypeConfidence: 0.7 } as PhotoScores | undefined, ages: [] as number[] };
const fakeRater: PhotoRater = {
  id: "fake-v1",
  rate: async (_photos, subject) => {
    rater.calls++; rater.ages.push(subject.age);
    if (rater.failing > 0) { rater.failing--; throw new Error("rater unavailable (fake)"); }
    return rater.score;
  },
};
const fetched: string[] = [];

const skip = !pgAvailable;
let svc: NetworkService;
let slop: NetworkRuntime;
let dir: string;
const clock = { t: T0, now() { return this.t; } };
const logs: string[] = [];
let seq = 0, phones = 0;

async function member(age: number, name = "Rae"): Promise<{ e164: string; personId: string; memberId: MemberId }> {
  const e164 = `+121255501${String(++phones).padStart(2, "0")}`;
  const person = await svc.accounts.createPerson(e164, "otp_sms", age);
  const m: Membership = { app: "slop", personId: person.id, memberId: `slop_test_${phones}`, state: "active", review: null, firstName: name, profile: {}, joinedAt: clock.t, leftAt: null };
  await svc.people.putMembership(m);
  await svc.createMember(slop, m, { age, firstName: name });
  return { e164, personId: person.id, memberId: m.memberId as MemberId };
}

const mms = (from: string, text: string, urls: string[]): Extract<ChannelEvent, { kind: "message" }> => ({
  kind: "message", channel: "blooio", messageId: `msg_${++seq}`, from, to: null, chatId: from, isGroup: false, text, mediaUrls: urls, transport: "imessage", receivedAt: clock.t,
});

const q = <T = any>(s: TemplateStringsArray, ...v: unknown[]) => svc.sql(s, ...v) as unknown as Promise<T[]>;
const staff = (token: string, path: string, init: RequestInit = {}) =>
  svc.fetch(new Request(`http://staff.local/apps/slop${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } }));

beforeAll(async () => {
  if (skip) return;
  await devPgUp();
  await admin(`drop database if exists ${DB} with (force)`);
  await admin(`create database ${DB}`);
  await migrate(URL_, { lockTimeout: "10s" });
  dir = mkdtempSync(join(tmpdir(), "photos-test-"));
  svc = new NetworkService({
    url: URL_, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }], clock, notify: false,
    env: { PLATFORM_ENV: "dev", SLOP_PROBE_PHOTO: "1" },
    tokens: `admin@slop:${ADMIN},safety@slop:${SAFETY},reviewer@slop:${REVIEWER}`,
    photoStorage: new LocalDiskPhotoStorage(dir), photoRater: fakeRater,
    fetchMedia: async url => { fetched.push(url); return jpeg(fetched.length); },
    log: s => logs.push(s),
  });
  await svc.start();
  slop = svc.runtimeFor("slop")!;
}, 120_000);

afterAll(async () => {
  if (skip) return;
  await svc?.close().catch(() => {});
  if (dir) rmSync(dir, { recursive: true, force: true });
  await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
});

describe.skipIf(skip)("photos on the live path", () => {
  test("migration 0020 applied: moderation and rating columns, consents, bias reports", async () => {
    const cols = (await q`select column_name from information_schema.columns where table_schema = 'platform' and table_name = 'photos'`).map(r => r.column_name);
    for (const c of ["source", "moderation_status", "moderated_by", "moderated_at", "rating_status", "rating_attempts", "rating_last_error", "rating_next_at"]) expect(cols).toContain(c);
    expect((await q`select to_regclass('platform.photo_consents') is not null as ok`)[0].ok).toBe(true);
    expect((await q`select to_regclass('network.bias_reports') is not null as ok`)[0].ok).toBe(true);
    // Applying again changes nothing.
    expect((await migrate(URL_, { lockTimeout: "10s" })).applied).toEqual([]);
  });

  test("upload needs the current consent and an adult; a new photo is pending and the member is rated", async () => {
    const adult = await member(29), minor = await member(16);
    expect(await svc.photos.upload(adult.personId, "slop", jpeg(1), undefined)).toEqual({ ok: false, reason: "consent_required" });
    expect(await svc.photos.upload(adult.personId, "slop", jpeg(1), "2020-01-01")).toEqual({ ok: false, reason: "consent_required" });
    expect(await svc.photos.upload(minor.personId, "slop", jpeg(1), PHOTO_CONSENT.version)).toEqual({ ok: false, reason: "adults_only" });
    const before = rater.calls;
    const r = await svc.photos.upload(adult.personId, "slop", jpeg(2), PHOTO_CONSENT.version);
    expect(r.ok).toBe(true);
    const [row] = await q`select * from platform.photos where person_id = ${adult.personId}::uuid`;
    expect([row.moderation_status, row.rating_status, row.source, row.rating_attempts]).toEqual(["pending", "rated", "web", 1]);
    expect(rater.calls).toBe(before + 1);
    expect(rater.ages.at(-1)).toBe(29);
    const [f] = await q`select tags, privacy_scope from network.facets where app_id = 'slop' and id = ${`${adult.memberId}:appearance`}`;
    expect(f.privacy_scope).toBe("agent_private");
    expect(f.tags).toEqual(["appearance:face=0.40", "appearance:body=-0.20", "appearance:overall=0.60", "appearance:conf=0.80", "appearance:bodyType=athletic", "appearance:bodyTypeConf=0.70"]);
    expect((await q`select version, source from platform.photo_consents where person_id = ${adult.personId}::uuid`)).toEqual([{ version: PHOTO_CONSENT.version, source: "web" }]);
    // The member's own list: ids and review status, never a score; the section is hidden for the minor.
    const list = async (personId: string) => (await (await svc.photos.route(new Request("http://slop.test/api/photos"), "/api/photos", "slop", async () => personId))!.json()) as any;
    const mine = await list(adult.personId);
    expect(mine.eligible).toBe(true);
    expect(mine.photos.map((p: any) => p.status)).toEqual(["pending"]);
    expect(JSON.stringify(mine)).not.toMatch(/face|overall|rating|score|0\.6/);
    expect(await list(minor.personId)).toEqual({ ok: true, eligible: false, photos: [] });
    expect((await q`select count(*)::int as n from network.facets where member_id = ${minor.memberId} and id like '%:appearance'`)[0].n).toBe(0);
  });

  test("a photo by text: kept with consent, dropped with a settings link without it, never touched for a minor", async () => {
    const noConsent = await member(33), withConsent = await member(35), minor = await member(15);
    // No recorded consent: not downloaded, not stored, one reply with the settings link.
    expect(await svc.inbound(mms(noConsent.e164, "", ["https://media.blooio.com/a.jpg"]), { app: "slop" })).toBe("handled");
    expect(fetched).toEqual([]);
    expect((await q`select count(*)::int as n from platform.photos where person_id = ${noConsent.personId}::uuid`)[0].n).toBe(0);
    const replies = await q`select body from network.messages where app_id = 'slop' and member_id = ${noConsent.memberId} and direction = 'outbound' and id like 'photo:%'`;
    expect(replies.map(r => r.body)).toEqual([expect.stringContaining("https://slop.date/settings")]);
    // Consent recorded on the page: the text photo is kept (source mms) and rated.
    expect((await svc.photos.agree(withConsent.personId, "slop", PHOTO_CONSENT.version)).ok).toBe(true);
    const calls = rater.calls;
    await svc.inbound(mms(withConsent.e164, "here's me", ["https://media.blooio.com/b.jpg"]), { app: "slop" });
    expect(fetched).toEqual(["https://media.blooio.com/b.jpg"]);
    const [row] = await q`select source, moderation_status, rating_status from platform.photos where person_id = ${withConsent.personId}::uuid`;
    expect(row).toEqual({ source: "mms", moderation_status: "pending", rating_status: "rated" });
    expect(rater.calls).toBe(calls + 1);
    const kept = await q`select body from network.messages where app_id = 'slop' and member_id = ${withConsent.memberId} and id like 'photo:%'`;
    expect(kept[0].body).not.toMatch(/rat(ed|ing)|score|attractive/i);
    // A minor: nothing downloaded, stored, rated or asked.
    const n = fetched.length, c = rater.calls;
    await svc.inbound(mms(minor.e164, "", ["https://media.blooio.com/c.jpg"]), { app: "slop" });
    expect(fetched.length).toBe(n);
    expect(rater.calls).toBe(c);
    expect((await q`select count(*)::int as n from platform.photos where person_id = ${minor.personId}::uuid`)[0].n).toBe(0);
    expect((await q`select count(*)::int as n from network.messages where member_id = ${minor.memberId} and id like 'photo:%'`)[0].n).toBe(0);
  });

  test("a failed rating is tried again after the backoff, at most 5 times", async () => {
    const m = await member(41);
    rater.failing = 1;
    expect((await svc.photos.upload(m.personId, "slop", jpeg(7), PHOTO_CONSENT.version)).ok).toBe(true);
    let [row] = await q`select rating_status, rating_attempts, rating_last_error, rating_next_at from platform.photos where person_id = ${m.personId}::uuid`;
    expect([row.rating_status, row.rating_attempts]).toEqual(["failed", 1]);
    expect(row.rating_last_error).toMatch(/rater unavailable/);
    expect(new Date(row.rating_next_at).getTime()).toBe(clock.t + 10 * MIN);
    // Not due yet: nothing is tried.
    const calls = rater.calls;
    await svc.photoTick();
    expect(rater.calls).toBe(calls);
    clock.t += 11 * MIN;
    await svc.photoTick();
    [row] = await q`select rating_status, rating_attempts from platform.photos where person_id = ${m.personId}::uuid`;
    expect([row.rating_status, row.rating_attempts]).toEqual(["rated", 2]);
    expect((await q`select count(*)::int as n from network.facets where id = ${`${m.memberId}:appearance`}`)[0].n).toBe(1);
    // A rater that keeps failing stops after RATING_MAX_TRIES tries.
    const g = await member(42);
    rater.failing = 100;
    await svc.photos.upload(g.personId, "slop", jpeg(8), PHOTO_CONSENT.version);
    for (let i = 0; i < 10; i++) { clock.t += 12 * 3600_000; await svc.photoTick(); }
    [row] = await q`select rating_status, rating_attempts from platform.photos where person_id = ${g.personId}::uuid`;
    expect([row.rating_status, row.rating_attempts]).toEqual(["failed", RATING_MAX_TRIES]);
    rater.failing = 0;
  });

  test("staff moderate a photo through the audited route (safety or admin only)", async () => {
    const m = await member(30);
    const up = await svc.photos.upload(m.personId, "slop", jpeg(9), PHOTO_CONSENT.version);
    if (!up.ok) throw new Error(up.reason);
    const path = `/photos/${up.value.id}/moderate`;
    expect((await staff(REVIEWER, path, { method: "POST", body: JSON.stringify({ decision: "approve", reason: "clear photo" }) })).status).toBe(403);
    expect((await staff(SAFETY, path, { method: "POST", body: JSON.stringify({ decision: "maybe", reason: "x" }) })).status).toBe(400);
    const res = await staff(SAFETY, path, { method: "POST", body: JSON.stringify({ decision: "approve", reason: "one adult, no text" }) });
    expect(res.status).toBe(200);
    const [row] = await q`select moderation_status, moderated_by, moderation_reason from platform.photos where id = ${up.value.id}`;
    expect(row.moderation_status).toBe("approved");
    expect(row.moderated_by).toMatch(/^token:safety/);
    const audit = await q`select detail from network.staff_audit where target_id = ${up.value.id} order by id`;
    expect(audit.map(a => a.detail.phase)).toEqual(["requested", "result"]);
    // A rejection drops the rating; it is made again from what is left (nothing here).
    expect((await staff(ADMIN, path, { method: "POST", body: JSON.stringify({ decision: "reject", reason: "text in the image" }) })).status).toBe(200);
    expect((await q`select count(*)::int as n from network.facets where id = ${`${m.memberId}:appearance`}`)[0].n).toBe(0);
    expect((await staff(SAFETY, "/photos/ph_000000000000000000000000/moderate", { method: "POST", body: JSON.stringify({ decision: "approve", reason: "nope" }) })).status).toBe(409);
  });

  test("a probe carries one approved photo of an adult, only after the send-time checks", async () => {
    const a = await member(31, "Ana"), b = await member(29, "Bo");
    const up = await svc.photos.upload(b.personId, "slop", jpeg(11), PHOTO_CONSENT.version);
    if (!up.ok) throw new Error(up.reason);
    await slop.unitOfWork(n => { n.member(a.memberId); n.member(b.memberId); });
    const probe = (photoOf?: MemberId, body = "There's someone I think you might like to go on a date with: coffee, this week. Want me to check if they're up for it?"): Outbound =>
      ({ id: `p${++seq}`, memberId: a.memberId, body, kind: "proactive", type: "probe", proactive: true, system: false, ts: clock.t, ...(photoOf ? { photoOf } : {}) });
    // Pending: text only.
    let x = probe(b.memberId);
    await svc.attachMedia(slop, [x]);
    expect(x.mediaUrls).toBeUndefined();
    expect(logs.at(-1)).toMatch(/text only .*\(no_photo\)/); // only an approved photo is ever a candidate
    await svc.photos.moderate(up.value.id, "approve", "test@staff", "ok");
    // Approved: one signed link that works for an hour and serves the photo.
    x = probe(b.memberId);
    await svc.attachMedia(slop, [x]);
    expect(x.mediaUrls).toHaveLength(1);
    const link = new URL(x.mediaUrls![0]!);
    expect(link.origin).toBe("https://slop.date");
    expect(link.pathname).toBe(`/api/photos/media/${up.value.id}`);
    expect(Number(link.searchParams.get("exp"))).toBe(clock.t + 3600_000);
    const get = () => svc.photos.route(new Request(link.toString()), link.pathname, "slop", async () => null);
    expect((await get())!.status).toBe(200);
    // A caption with a rating word: text only.
    x = probe(b.memberId, "Someone attractive would like coffee this week.");
    await svc.attachMedia(slop, [x]);
    expect(x.mediaUrls).toBeUndefined();
    // No photoOf: nothing is attached.
    x = probe();
    await svc.attachMedia(slop, [x]);
    expect(x.mediaUrls).toBeUndefined();
    // The pictured person is now under 18: their photos are gone, the old link no longer works, nothing is attached.
    await svc.accounts.recordAge(b.e164, await svc.accounts.personFor(b.e164), 17);
    x = probe(b.memberId);
    await svc.attachMedia(slop, [x]);
    expect(x.mediaUrls).toBeUndefined();
    expect((await get())!.status).toBe(404);
    // An hour later any link is dead.
    clock.t += 3600_000 + 1;
    expect((await get())!.status).toBe(404);
  });

  test("the bias job stores a report and a bias_report event, and pauses matching under 0.8x", async () => {
    const user: StaffUser = { id: "test-admin", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" };
    expect((await svc.setMatching(user, true, slop)).ok).toBe(true);
    expect(slop.net.matchingEnabled()).toBe(true);
    // A healthy week from the tables (few members: no group is large enough to judge, ratio 1).
    const ok = await svc.biasReport(slop);
    expect(ok.action).toBe("ok");
    expect(JSON.stringify(ok)).not.toMatch(/slop_test_|appearance:/);
    // A starved quintile: q1 gets a third of the dates.
    const rows = (group: string, n: number, dates: number) => Array.from({ length: n }, () => ({ group, memberMonths: 1, proposals: 3, dates, secondDates: 0 }));
    const bad = await svc.biasReport(slop, { minN: 3, outcomes: async () => ({ quintile: [...rows("q1", 4, 1), ...rows("q2", 4, 3), ...rows("q3", 4, 3)], group: [...rows("woman", 6, 2), ...rows("man", 6, 2)] }) });
    expect(bad.action).toBe("pause");
    expect(bad.minGroup).toBe("quintile:q1");
    expect(bad.ratio).toBeLessThan(0.8);
    const stored = await q`select min_group, action, report from network.bias_reports where app_id = 'slop' and action = 'pause'`;
    expect(stored.map(r => r.min_group)).toEqual(["quintile:q1"]);
    expect(Object.keys(stored[0].report.byQuintile.groups)).toEqual(["q1", "q2", "q3"]);
    const events = await q`select payload from network.events where app_id = 'slop' and type = 'bias_report' order by id`;
    expect(events.at(-1)!.payload).toEqual({ ratio: bad.ratio, min_group: "quintile:q1", action: "pause" });
    // Paused through the matching switch, audited with the reason.
    await slop.readState(() => undefined);
    expect(slop.net.matchingEnabled()).toBe(false);
    const audit = await q`select actor, detail from network.staff_audit where target_id = 'matching_slop:nyc' order by id desc limit 1`;
    expect(audit[0].actor).toBe("system:bias-monitor");
    expect(audit[0].detail.reason).toBe("bias monitor");
    // Between 0.8x and 0.85x it alerts only.
    const alert = await svc.biasReport(slop, { minN: 3, outcomes: async () => ({ quintile: [...rows("q1", 4, 70), ...rows("q2", 4, 100)], group: [] }) });
    expect(alert.action).toBe("alert");
  });

  test("the bias job runs weekly on the tick and on demand through GET /bias", async () => {
    const count = async () => (await q`select count(*)::int as n from network.bias_reports where app_id = 'slop'`)[0].n as number;
    const n0 = await count();
    await svc.photoTick();
    expect(await count()).toBe(n0); // a report from the last test is newer than a week
    clock.t += BIAS_EVERY_MS;
    await svc.photoTick();
    expect(await count()).toBe(n0 + 1);
    await svc.photoTick();
    expect(await count()).toBe(n0 + 1);
    expect((await staff(REVIEWER, "/bias")).status).toBe(403);
    const res = await staff(ADMIN, "/bias");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.report.metrics).toEqual({ proposals: "exposure", dates: "mutual_yes", secondDates: "dates_held" });
    expect(await count()).toBe(n0 + 2);
  });
});
