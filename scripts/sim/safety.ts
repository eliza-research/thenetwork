// The safety block: slop.date photos, the rater, bans, reports and review (critical path items 5, 6, 8).
//
// Offline part (always runs, blocking): the real platform PhotoService and the text photo intake on
// in-memory stores, the engine's real Clef rater against a fake Workers AI (a counting fetch: no
// network), the platform accounts and the MCP sign-in hooks for a banned person, a scripted report in
// the NYC world taken through hold and ban, the reviewer of record, the review SLA alerts and the bias
// monitor on a fixed population.
//
// Postgres part (the real NetworkService on a fresh migrated database of its own on the dev cluster,
// :54339): joins and photos by text through inbound(), the photo consent asked once, the rating stored
// with appearanceFacet and deleted when the age drops, staff hold and ban through the staff API with
// the console token, every rejoin path of the banned person, sends to them, and the weekly bias report.
// Blocking when the dev Postgres is there; without it one tracked gate says so (CI's sim job has Postgres and fails on that skip).
//
// Fakes only: no Blooio, Twilio, Cloudflare, R2 or OpenAI call is possible. Phones are +1 212 555 01xx.
import { DAY, HOUR, type MemberId } from "../../packages/core/src/index.ts";
import { makeClefRater } from "../../packages/engine/src/packs/slop/clef.ts";
import { appearanceFacet } from "../../packages/engine/src/packs/slop/appearance.ts";
import { DEFAULT_CLEF_WEIGHTS } from "../../packages/engine/src/packs/slop/clefWeights.ts";
import { Accounts } from "../../packages/platform/src/accounts.ts";
import { APPS, type AppId } from "../../packages/platform/src/apps.ts";
import { keyedHash } from "../../packages/platform/src/phone.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";
import { MemoryPhotoStore, PHOTO_CONSENT, PhotoService, photoRaterFromEnv, withRetry, type PhotoStorage, type PhotoType } from "../../packages/platform/src/photos.ts";
import { createPublicApi } from "../../packages/platform/src/api.ts";
import type { OtpProvider } from "../../packages/platform/src/otp.ts";
import { platformHooks } from "../../packages/mcp/src/hooks.ts";
import { PhotoIntake, PHOTO_TEXT } from "../../packages/network/service/photoIntake.ts";
import { biasReport, type BiasMember, type BiasOpp } from "../../packages/network/service/bias.ts";
import { reviewerOfRecord, slaAlerts } from "../../packages/network/service/service.ts";
import { APP_REASONS, DEFAULT_SLA_HOURS, PACK_READY, toNetworkReason } from "../../packages/observatory/src/apps.ts";
import { checkInReport, URGENT_REPORTS } from "../../packages/network/src/reports.ts";
import { runScenario, type NetScenario } from "../../packages/network/harness/index.ts";
import type { StaffUser } from "../../packages/observatory/src/types.ts";
import { Block, expect } from "./gate.ts";

const HASH_KEY = "sim-safety-hash-key";
const T0 = Date.UTC(2026, 9, 5, 16);
const PHONE = (n: number) => `+1212555${String(100 + n).padStart(4, "0")}`; // +1 212 555 01xx

/** A small JPEG with an EXIF block that names a GPS position (stripMetadata must drop it). */
function jpegWithExif(): Uint8Array {
  const exif = new TextEncoder().encode("Exif\0\0GPS 40.7128N 74.0060W");
  const app1 = [0xff, 0xe1, 0, exif.length + 2, ...exif];
  const dqt = [0xff, 0xdb, 0, 4, 0, 0];
  const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0x56];
  return Uint8Array.from([0xff, 0xd8, ...app1, ...dqt, ...sos, 0xff, 0xd9]);
}
const hasExif = (b: Uint8Array) => new TextDecoder("latin1").decode(b).includes("Exif");

/** Object storage in memory, with a count of writes. */
class MemoryStorage implements PhotoStorage {
  readonly kind = "local" as const;
  readonly objects = new Map<string, Uint8Array>();
  puts = 0;
  async put(key: string, bytes: Uint8Array, _t: PhotoType) { this.puts++; this.objects.set(key, bytes); }
  async get(key: string) { return this.objects.get(key); }
  async delete(key: string) { this.objects.delete(key); }
}

/**
 * A fake Cloudflare Workers AI for the engine's real Clef rater: it counts calls, answers every
 * question with fixed probabilities, and can fail the next calls with a status (429, 503, 400).
 */
class FakeWorkersAI {
  calls = 0;
  failNext: number[] = [];
  readonly fetch = async (_url: string, _init: { body: string }) => {
    this.calls++;
    const status = this.failNext.shift();
    if (status) return { ok: false, status, json: async () => ({ success: false, errors: [{ message: `fake ${status}` }] }) };
    const answers = {
      "gate.one_adult": { noul: 0.95 }, "gate.face_visible": { noul: 0.9 }, "gate.body_visible": { noul: 0.8 },
      "rate.face": { score: 4, confidence: 0.8 }, "rate.body": { score: 3, confidence: 0.8 }, "rate.overall": { score: 4, confidence: 0.8 },
      "aux.photo_quality": { score: 3 }, "aux.grooming": { score: 3 }, "aux.fitness": { score: 2 }, "aux.style": { score: 2 }, "aux.expression": { score: 3 },
      "aux.smile": { noul: 0.7 }, "body.type": { probabilities: { slim: 0.1, athletic: 0.6, average: 0.2, curvy: 0.05, plus_size: 0.03, unclear: 0.02 } },
    };
    return { ok: true, status: 200, json: async () => ({ success: true, result: { answers } }) };
  };
  rater() { return makeClefRater({ token: "fake-token", accountId: "fake-account", fetch: this.fetch }); }
}

/** The offline world: people, memberships, photos, the rater and the text intake on memory stores. */
function offlineWorld(o: { rater?: boolean } = {}) {
  let now = T0;
  const people = new MemoryPeopleStore();
  const accounts = new Accounts(people, { hashKey: HASH_KEY, now: () => now, env: { PLATFORM_ENV: "dev" }, apps: id => APPS[id] });
  const storage = new MemoryStorage();
  const meta = new MemoryPhotoStore();
  const ai = new FakeWorkersAI();
  const ratings = new Map<string, number>();
  const sleeps: number[] = [];
  const photos = new PhotoService({
    people, meta, storage, signingKey: "k", now: () => now,
    rater: o.rater === false ? undefined : withRetry(ai.rater(), { attempts: 3, sleep: async ms => { sleeps.push(ms); } }),
    // The service's own check: a live membership of an 18+ member (the person's lowest age is checked by PhotoService first).
    eligible: async (personId, app) => { const m = await people.getMembership(personId, app); return !!m && ["active", "paused", "onboarding"].includes(m.state); },
    banned: async personId => people.isBanned("", personId),
    onRating: async (personId, _app, s, subject) => { appearanceFacet(personId as MemberId, subject, s, now); ratings.set(personId, s.overall); },
    onRemoved: async personId => { ratings.delete(personId); },
  });
  const fetched: string[] = [];
  const replies: { to: string; text: string }[] = [];
  const intake = new PhotoIntake({
    people, accounts, photos, phoneKey: e => keyedHash(HASH_KEY, `phone:${e}`), now: () => now,
    fetchMedia: async url => { fetched.push(url); return jpegWithExif(); },
    reply: async (to, text) => { replies.push({ to, text }); },
  });
  /** A person with a slop membership (and the given lowest age; null = unknown). */
  const member = async (n: number, age: number | null, app: AppId = "slop") => {
    const e164 = PHONE(n);
    const p = await accounts.createPerson(e164, "inbound_message", age);
    await people.putMembership({ app, personId: p.id, memberId: `${app}_${n}`, state: "active", review: null, firstName: `P${n}`, profile: {}, joinedAt: now, leftAt: null });
    return { e164, personId: p.id };
  };
  const rows = async (personId: string) => (await meta.list(personId)).length;
  return { people, accounts, photos, intake, storage, meta, ai, ratings, sleeps, fetched, replies, member, rows, tick: (ms: number) => { now += ms; } };
}

export async function safetyBlock(b: Block): Promise<void> {
  // ------------------------------------------------------------------ photos: adults only
  await b.run("photos: a member aged 13-17 or of unknown age uploads on the site: 0 photo rows, 0 bytes stored, 0 rater calls", async () => {
    const w = offlineWorld();
    for (const [i, age] of [13, 14, 15, 16, 17, null].entries()) {
      const m = await w.member(i + 1, age);
      const r = await w.photos.upload(m.personId, "slop", jpegWithExif(), PHOTO_CONSENT.version);
      expect(r).toEqual({ ok: false, reason: "adults_only" });
      expect(await w.rows(m.personId)).toBe(0);
      expect((await w.photos.rate(m.personId, "slop")).rated).toBe(false);
    }
    expect(w.storage.puts).toBe(0);
    expect(w.ai.calls).toBe(0);
  });

  await b.run("photos by text: a member aged 13-17 or of unknown age sends a photo: never fetched, 0 rows, 0 rater calls, one plain answer", async () => {
    const w = offlineWorld();
    for (const [i, age] of [13, 15, 17, null].entries()) {
      const m = await w.member(10 + i, age);
      const r = await w.intake.photosIn(m.e164, ["https://media.test/a.jpg", "https://media.test/b.jpg"], `in:${i}`);
      expect(r).toEqual({ outcome: "discarded", reason: "adults_only" });
      // A second photo the same day: still nothing kept, and no second answer.
      await w.intake.photosIn(m.e164, ["https://media.test/c.jpg"], `in:${i}b`);
      expect(await w.rows(m.personId)).toBe(0);
      expect(w.replies.filter(x => x.to === m.e164).map(x => x.text)).toEqual([PHOTO_TEXT.notAdult]);
    }
    expect(w.fetched.length).toBe(0);
    expect(w.storage.puts).toBe(0);
    expect(w.ai.calls).toBe(0);
  });

  await b.run("photos by text: consent is asked once; nothing is kept before YES; after YES the photo is stored without EXIF and rated once", async () => {
    const w = offlineWorld();
    const a = await w.member(20, 29);
    expect(await w.intake.photosIn(a.e164, ["https://media.test/1.jpg"], "m1")).toEqual({ outcome: "asked" });
    expect(await w.intake.photosIn(a.e164, ["https://media.test/2.jpg"], "m2")).toEqual({ outcome: "ask_skipped" });
    expect([w.fetched.length, await w.rows(a.personId), w.ai.calls]).toEqual([0, 0, 0]);
    // A counter or an unclear answer is not consent. Neither is a bare "yes": it may answer a probe or a
    // date ask (or another app on the shared line), so it goes on to the Network and changes nothing here.
    expect(await w.intake.consentAnswer(a.e164, "maybe later?", "m3")).toBe(false);
    expect(await w.intake.consentAnswer(a.e164, "yes", "m3b")).toBe(false);
    expect(await w.intake.consentAnswer(a.e164, "no", "m3c")).toBe(false);
    expect((await w.people.getMembership(a.personId, "slop"))!.profile.photoConsent).toBeUndefined();
    // The explicit answer on another app's message is not taken either.
    expect(await w.intake.consentAnswer(a.e164, "YES PHOTOS", "m3d", "ntwrk")).toBe(false);
    expect(await w.intake.consentAnswer(a.e164, "YES PHOTOS", "m4")).toBe(true);
    expect((await w.people.getMembership(a.personId, "slop"))!.profile.photoConsent).toBe(PHOTO_CONSENT.version);
    const r = await w.intake.photosIn(a.e164, ["https://media.test/3.jpg"], "m5");
    expect(r).toEqual({ outcome: "stored", stored: 1, refused: [] });
    const [row] = await w.meta.list(a.personId);
    expect(hasExif(w.storage.objects.get(row!.storageKey)!)).toBe(false);
    expect(w.ai.calls).toBe(1);
    expect(w.ratings.has(a.personId)).toBe(true);
    // NO: nothing is stored and no consent is recorded.
    const n = await w.member(21, 31);
    await w.intake.photosIn(n.e164, ["https://media.test/4.jpg"], "n1");
    expect(await w.intake.consentAnswer(n.e164, "no thanks", "n2")).toBe(false);
    expect(await w.intake.consentAnswer(n.e164, "no photos", "n2b")).toBe(true);
    expect((await w.people.getMembership(n.personId, "slop"))!.profile.photoConsent).toBeUndefined();
    expect(await w.rows(n.personId)).toBe(0);
  });

  await b.run("rater: an API error (429, 503) is tried again and the rating lands; a 400 is not retried and the photo stays; no rater: photos still work", async () => {
    const w = offlineWorld();
    const a = await w.member(30, 34);
    w.ai.failNext = [503, 429];
    expect((await w.photos.upload(a.personId, "slop", jpegWithExif(), PHOTO_CONSENT.version)).ok).toBe(true);
    expect(w.ai.calls).toBe(3);
    expect(w.sleeps).toEqual([500, 1000]);
    expect(w.ratings.has(a.personId)).toBe(true);
    const c = await w.member(31, 40);
    w.ai.failNext = [400];
    expect((await w.photos.upload(c.personId, "slop", jpegWithExif(), PHOTO_CONSENT.version)).ok).toBe(true);
    expect(w.ai.calls).toBe(4);
    expect([await w.rows(c.personId), w.ratings.has(c.personId)]).toEqual([1, false]);
    const off = offlineWorld({ rater: false });
    const d = await off.member(32, 25);
    expect((await off.photos.upload(d.personId, "slop", jpegWithExif(), PHOTO_CONSENT.version)).ok).toBe(true);
    expect([await off.rows(d.personId), off.ai.calls, off.ratings.size]).toEqual([1, 0, 0]);
  });

  await b.run("rater: deleting a photo drops the rating (made again from what is left); an age under 18 refuses any new rating with 0 calls", async () => {
    const w = offlineWorld();
    const a = await w.member(40, 26);
    const one = await w.photos.upload(a.personId, "slop", jpegWithExif(), PHOTO_CONSENT.version);
    const two = await w.photos.upload(a.personId, "slop", jpegWithExif(), PHOTO_CONSENT.version);
    expect(one.ok && two.ok).toBe(true);
    const calls = w.ai.calls;
    await w.photos.remove(a.personId, "slop", (one as { value: { id: string } }).value.id);
    expect(w.ratings.has(a.personId)).toBe(true); // made again from the photo that is left
    await w.photos.remove(a.personId, "slop", (two as { value: { id: string } }).value.id);
    expect([w.ratings.has(a.personId), await w.rows(a.personId)]).toEqual([false, 0]);
    // The person states 17: the lowest age wins, and nothing is rated or stored again.
    await w.people.noteAge(a.personId, 17);
    const before = w.ai.calls;
    expect((await w.photos.upload(a.personId, "slop", jpegWithExif(), PHOTO_CONSENT.version)).ok).toBe(false);
    expect(await w.photos.rate(a.personId, "slop")).toEqual({ rated: false, refused: "adults_only" });
    expect(w.ai.calls).toBe(before);
    expect(calls).toBeGreaterThan(0);
  });

  await b.run("rater env: CLEF_RATINGS is on by default (off turns it off); it needs the token; no weights file means the placeholder weights; a file needs version and provenance; zero calls for a minor", async () => {
    const env = { CLOUDFLARE_AI_TOKEN: "fake-token", CLOUDFLARE_ACCOUNT_ID: "fake-account" };
    const placeholder = JSON.stringify(DEFAULT_CLEF_WEIGHTS);
    const fitted = JSON.stringify({ ...DEFAULT_CLEF_WEIGHTS, version: "fit-sim-1", placeholder: false, provenance: { fitter: "sim", fittedAt: "2026-10-09T00:00:00Z", photos: 0, labels: 0, raters: 0 } });
    const noProv = JSON.stringify({ ...DEFAULT_CLEF_WEIGHTS, version: "fit-sim-2", placeholder: false });
    const noVersion = JSON.stringify({ ...JSON.parse(fitted), version: "" });
    const files: Record<string, string> = { "/w/placeholder.json": placeholder, "/w/fitted.json": fitted, "/w/noprov.json": noProv, "/w/nover.json": noVersion };
    const ai = new FakeWorkersAI();
    const build = (e: Record<string, string | undefined>) => photoRaterFromEnv(e, { fetch: ai.fetch, sleep: async () => {}, readFile: async p => { const f = files[p]; if (f === undefined) throw new Error(`no file ${p}`); return f; } });
    expect((await build({ ...env, CLEF_RATINGS: "off", CLEF_WEIGHTS_PATH: "/w/fitted.json" })).status).toBe("off_flag");
    expect((await build({ ...env, CLEF_RATINGS: "of" })).status).toBe("off_flag"); // a typo never turns ratings on
    expect((await build({ CLEF_WEIGHTS_PATH: "/w/fitted.json" })).status).toBe("off_env");
    for (const flag of [undefined, "on", " ON "]) {
      const r = await build({ ...env, CLEF_RATINGS: flag });
      expect([r.status, r.weights, typeof r.rater?.rate]).toEqual(["on_placeholder", DEFAULT_CLEF_WEIGHTS.version, "function"]);
    }
    for (const p of ["/w/placeholder.json", "/w/noprov.json", "/w/nover.json", "/w/missing.json"]) {
      const r = await build({ ...env, CLEF_WEIGHTS_PATH: p });
      expect([r.status, r.rater]).toEqual(["refused_weights", undefined]);
    }
    const on = await build({ ...env, CLEF_WEIGHTS_PATH: "/w/fitted.json" });
    expect([on.status, on.weights]).toEqual(["on", "fit-sim-1"]);
    const photo = [{ id: "p1", bytes: jpegWithExif() }];
    expect(await on.rater!.rate({ age: 16, ageVerified: true }, photo)).toBe(null);
    expect(await on.rater!.rate({ age: 30, ageVerified: false }, photo)).toBe(null);
    expect(ai.calls).toBe(0);
    expect(typeof (await on.rater!.rate({ age: 30, ageVerified: true }, photo))?.overall).toBe("number");
    expect(ai.calls).toBe(1);
  });

  // ------------------------------------------------------------------ bans
  await b.run("ban: a banned person is refused at photo intake (site and text, never fetched), web join, MCP sign-in (no code sent) and MCP login", async () => {
    const w = offlineWorld();
    const x = await w.member(50, 30);
    await w.people.ban({ id: "ban_1", scope: "person", personId: x.personId, phoneHash: null, reason: "sim", reportId: null, bannedBy: "pat@example.com", at: T0 });
    expect(await w.photos.upload(x.personId, "slop", jpegWithExif(), PHOTO_CONSENT.version)).toEqual({ ok: false, reason: "banned" });
    expect(await w.intake.photosIn(x.e164, ["https://media.test/b.jpg"], "b1")).toEqual({ outcome: "discarded", reason: "banned" });
    expect([w.fetched.length, w.ai.calls, w.replies.length]).toEqual([0, 0, 0]);
    // Web join on every app: refused for review (the answer never says "banned").
    for (const app of ["slop", "ntwrk", "friends", "peon"] as const) {
      expect((await w.accounts.canJoin(APPS[app], { e164: x.e164, personId: x.personId })).reason).toBe("review");
      expect(await w.accounts.join(APPS[app], { e164: x.e164, personId: x.personId }, { firstName: "X", age: 30, consent: { sms: true, version: APPS[app].consent.version } })).toEqual({ ok: false, error: "review" });
    }
    // The MCP server's sign-in: the same answer as anyone, but no code is sent and login is refused.
    let sent = 0;
    const otp: OtpProvider = { name: "fake", send: async () => { sent++; return { code: "123456" }; } };
    const api = createPublicApi({ store: w.people, otp, env: { PLATFORM_ENV: "dev" }, hashKey: HASH_KEY, now: () => T0 });
    const hooks = platformHooks({ store: w.people, otp: api.otp, accounts: api.accounts, sessions: api.sessions, app: id => APPS[id as AppId] });
    expect(await hooks.startOtp("slop", x.e164, "203.0.113.9")).toEqual({ ok: true });
    expect(sent).toBe(0);
    expect(await hooks.login(x.e164)).toBe("held");
    // A phone ban covers a person who has no person-scope ban.
    const y = await w.member(51, 33);
    await w.people.ban({ id: "ban_2", scope: "phone", personId: y.personId, phoneHash: keyedHash(HASH_KEY, `phone:${y.e164}`), reason: "sim", reportId: null, bannedBy: "pat@example.com", at: T0 });
    expect(await w.accounts.banned(y.e164)).toBe(true);
    expect(await hooks.login(y.e164)).toBe("held");
  });

  await b.run("report -> case -> hold -> ban: a harassment report in the NYC world opens a staff case; staff hold, then ban; the reports follow", async () => {
    const scenario: NetScenario = {
      id: "report_hold_ban", title: "Report, hold, ban", days: 3,
      description: "A member reports another for harassment. Staff hold the person, then ban them.",
      setup(ps, s) {
        const a = ps.filter(p => !p.hidden.adversarial && p.hidden.trueAge >= 18 && p.public.claimedAge >= 18 && p.archetype !== "never_replies");
        const target = a[71 % a.length]!, reporter = a[72 % a.length]!;
        return { ids: { target: target.id, reporter: reporter.id }, actions: [{ at: s + DAY + 22 * HOUR, action: { do: "say", persona: reporter.id, text: `report ${target.name}, he harassed me and kept messaging after I said no` } }] };
      },
      check: () => [],
    };
    const { ctx } = await runScenario(scenario, { seed: 7 });
    const t = ctx.ids.target!;
    const reports = ctx.net.safetyReports().filter(r => r.subjectId === t);
    expect(reports.map(r => [r.kind, r.status])).toEqual([["harassment", "open"]]);
    expect(ctx.net.safetyCases().some(c => c.memberId === t)).toBe(true);
    expect(ctx.net.holdMember(t, "pat@example.com", "held after the report", reports[0]!.id)).toEqual({ ok: true });
    expect(ctx.net.safetyReports().find(r => r.id === reports[0]!.id)!.status).toBe("held");
    expect(ctx.net.trust.level(t)).toBe("hold");
    expect(ctx.net.markBanned(t, "pat@example.com", "banned after review", reports[0]!.id)).toEqual({ ok: true });
    const done = ctx.net.safetyReports().find(r => r.id === reports[0]!.id)!;
    expect([done.status, done.decidedBy]).toEqual(["banned", "pat@example.com"]);
  });

  await b.run("check-in after a date (slop live path): harassment, lying about age, identity or photos, a no-show and an unsafe date each file a report; small talk does not", () => {
    const cases: [string, string | undefined][] = [
      ["he kept texting me after I said no, total harassment", "harassment"],
      ["she lied about her age, she is way older than she said", "lying"],
      ["he didn't look like his photos at all", "lying"],
      ["catfished. not who they said", "lying"],
      ["they never showed up", "no_show"],
      ["I felt unsafe, he wouldn't let me leave", "unsafe"],
      ["it was fine, not my type", undefined],
      ["great time, would see them again", undefined],
    ];
    expect(cases.map(([t]) => checkInReport(t))).toEqual(cases.map(([, k]) => k));
    expect(URGENT_REPORTS.has("harassment") && URGENT_REPORTS.has("unsafe")).toBe(true);
  });

  // ------------------------------------------------------------------ review
  await b.run("review: the reviewer of record is the signed-in person only with the console token; slop is in PACK_READY; slop SLA alerts at 6 h, once", () => {
    const user: StaffUser = { id: "token:admin#0badc0de", roles: ["admin"], via: "token" } as StaffUser;
    const req = (token: string) => new Request("http://staff/review/x", { headers: { authorization: `Bearer ${token}`, "x-network-staff-id": "pat@example.com" } });
    expect(reviewerOfRecord(req("console-token-0123456789"), user, "console-token-0123456789").id).toBe("pat@example.com");
    expect(reviewerOfRecord(req("other-token-0123456789"), user, "console-token-0123456789").id).toBe(user.id);
    expect(reviewerOfRecord(req("console-token-0123456789"), user, undefined).id).toBe(user.id);
    expect(PACK_READY.has("slop")).toBe(true);
    // The slop rubric: its own codes, each stored as a PRD 32.8 base code with the slop code kept in the note.
    expect(APP_REASONS.slop.map(r => r.code)).toEqual(["weak_reason", "preference_mismatch", "safety_concern", "privacy_risk", "wrong_timing", "tone", "duplicate", "other"]);
    expect(toNetworkReason("slop", "preference_mismatch", "she wants 30+")).toEqual({ reason: "weak_reason", note: "[preference_mismatch] she wants 30+" });
    expect(toNetworkReason("slop", "safety_concern")).toEqual({ reason: "safety", note: "[safety_concern]" });
    expect(DEFAULT_SLA_HOURS.slop).toBe(6);
    const seen = new Set<string>();
    const q = [{ oppId: "o1", queuedAt: T0 - 7 * HOUR, deadline: T0 + 5 * HOUR }, { oppId: "o2", queuedAt: T0 - 5 * HOUR, deadline: T0 + 7 * HOUR }];
    expect(slaAlerts("slop:nyc", q, T0, 6, seen).length).toBe(1);
    expect(slaAlerts("slop:nyc", q, T0, 6, seen).length).toBe(0);
    expect(slaAlerts("slop:nyc", q, T0 + 2 * HOUR, 6, seen).length).toBe(1);
  });

  // ------------------------------------------------------------------ bias monitor
  await b.run("bias monitor: a rating quintile with half the dates raises an alert under 0.8x; an even population raises none", () => {
    const now = T0 + 28 * DAY;
    const members: BiasMember[] = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, age: 25 + (i % 10), joinedAt: T0, tags: [`appearance:face=0.00`, `appearance:body=0.00`, `appearance:overall=${(i / 60 - 0.5).toFixed(2)}`, "appearance:conf=0.80"] }));
    const date = (a: number, b2: number, k: number): BiasOpp => ({ participants: [`m${a}`, `m${b2}`], stage: "done", createdAt: T0 + k * HOUR, meetingAt: T0 + (k + 24) * HOUR });
    const even: BiasOpp[] = [];
    for (let i = 0; i < 60; i += 2) even.push(date(i, i + 1, i), date(i, i + 1, i + 100));
    expect(biasReport("slop:nyc", "slop", members, even, now).report.alerts).toEqual([]);
    // The lowest quintile (m0-m11) gets dates only half the time.
    const skewed = even.filter(o => !(Number(o.participants[0]!.slice(1)) < 12 && Number(o.participants[0]!.slice(1)) % 4 === 0));
    const r = biasReport("slop:nyc", "slop", members, skewed, now);
    expect(r.report.alerts.some(a => a.group === "q1" && a.metric === "dates" && a.ratio < 0.8)).toBe(true);
    expect(r.members).toBe(60);
    // Members under 18 are never in a bias row.
    expect(biasReport("slop:nyc", "slop", [...members, { id: "kid", age: 16, joinedAt: T0, tags: [] }], even, now).members).toBe(60);
  });

  await pgPart(b);
}

// ======================================================================== Postgres
async function pgPart(b: Block): Promise<void> {
  const { pgAvailable } = await import("../../packages/observatory/test/pg.ts");
  let url: string | undefined;
  if (pgAvailable) {
    try { url = await (await import("../../packages/platform/test/pg.ts")).migratedDb("simsafety"); } catch (e) { b.track("Postgres scenarios: skipped (the dev Postgres did not start)", false, (e as Error).message.split("\n")[0]); return; }
  } else { b.track("Postgres scenarios: skipped (no Postgres on this machine)", false); return; }
  const { NetworkService } = await import("../../packages/network/service/service.ts");
  const { SimClock } = await import("../../packages/core/src/clock.ts");
  const clock = new SimClock(T0);
  const storage = new MemoryStorage();
  const ai = new FakeWorkersAI();
  const fetched: string[] = [];
  let otpSent = 0;
  const CONSOLE = "console-token-sim-0123456789abcdef", REVIEWER = "reviewer-token-sim-0123456789abcdef";
  const svc = new NetworkService({
    url, clock, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }], notify: false, log: () => {},
    tokens: `admin@*:${CONSOLE},reviewer@slop:${REVIEWER}`, consoleToken: CONSOLE,
    photoStorage: storage, photoRater: withRetry(ai.rater(), { sleep: async () => {} }),
    fetchMedia: async u => { fetched.push(u); return jpegWithExif(); },
    publicApi: { otp: { name: "fake", send: async () => { otpSent++; return { code: "123456" }; } } },
  });
  try {
    await svc.start();
    const slop = svc.runtimeFor("slop")!;
    let n = 0;
    const text = (from: string, body: string, media: string[] = []) => {
      clock.advance(60_000);
      return svc.inbound({ kind: "message", channel: "imessage", messageId: `sim${++n}`, from, to: null, chatId: from, isGroup: false, text: body, mediaUrls: media, transport: "imessage", receivedAt: clock.now() } as never);
    };
    const personOf = async (e164: string) => (await svc.accounts.personFor(e164))?.id;
    const photoRows = async (personId: string | undefined) => personId ? (await svc.sql`select count(*)::int as n from platform.photos where person_id = ${personId}::uuid`)[0].n as number : 0;
    const ratingRows = async (memberId: string) => (await slop.scoped(tx => tx`select tags, privacy_scope from network.facets where app_id = 'slop' and member_id = ${memberId} and id = ${`${memberId}:appearance`}`)) as any[];
    const staff = (path: string, token: string, body?: unknown) => svc.fetch(new Request(`http://staff/apps/slop${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "x-network-staff-id": "pat@example.com", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const A = PHONE(1), M = PHONE(2), B = PHONE(3);

    await b.run("pg: a member aged 16 joins slop by text and sends a photo: 0 photo rows, never fetched, 0 rater calls", async () => {
      await text(M, "slop");
      expect(await text(M, "Kim 16")).toBe("joined");
      await text(M, "", ["https://media.test/m1.jpg"]);
      expect(await photoRows(await personOf(M))).toBe(0);
      expect([fetched.length, ai.calls, storage.puts]).toEqual([0, 0, 0]);
    });

    await b.run("pg: an adult's photo by text: consent asked once, then stored and rated once with appearanceFacet (agent_private); stating 17 deletes photos and rating", async () => {
      await text(A, "slop");
      expect(await text(A, "Sam, 29")).toBe("joined");
      await text(A, "", ["https://media.test/a1.jpg"]);
      expect([await photoRows(await personOf(A)), fetched.length]).toEqual([0, 0]);
      expect(await text(A, "YES PHOTOS")).toBe("handled");
      await text(A, "", ["https://media.test/a2.jpg"]);
      const pid = await personOf(A);
      const memberId = (await svc.people.getMembership(pid!, "slop"))!.memberId;
      expect([await photoRows(pid), fetched.length, ai.calls]).toEqual([1, 1, 1]);
      const [f] = await ratingRows(memberId);
      expect(f?.privacy_scope).toBe("agent_private");
      expect((f?.tags as string[]).some(t => t.startsWith("appearance:overall="))).toBe(true);
      await text(A, "I'm 17 actually");
      expect([await photoRows(pid), (await ratingRows(memberId)).length, storage.objects.size]).toEqual([0, 0, 0]);
    });

    let bPerson: string | undefined, bMember: string | undefined;
    await b.run("pg: staff hold then ban through the staff API with the console token: the audit actor is the signed-in person; the rating goes", async () => {
      await text(B, "slop");
      expect(await text(B, "Alex, 31")).toBe("joined");
      await text(B, "", ["https://media.test/b0.jpg"]); await text(B, "yes photos"); await text(B, "", ["https://media.test/b1.jpg"]);
      bPerson = await personOf(B); bMember = (await svc.people.getMembership(bPerson!, "slop"))!.memberId;
      expect((await ratingRows(bMember)).length).toBe(1);
      const hold = await staff("/safety/hold", CONSOLE, { memberId: bMember, note: "held after a report" });
      expect(hold.status).toBe(200);
      const ban = await staff("/safety/ban", CONSOLE, { memberId: bMember, by: "person", note: "banned after review" });
      expect(ban.status).toBe(200);
      const actors = (await svc.sql`select distinct actor from network.staff_audit where target_id = ${bMember}`).map((r: any) => r.actor);
      expect(actors).toEqual(["pat@example.com"]);
      expect((await svc.sql`select count(*)::int as n from platform.bans where person_id = ${bPerson}::uuid`)[0].n).toBeGreaterThanOrEqual(1);
      expect((await ratingRows(bMember)).length).toBe(0);
    });

    await b.run("pg: the banned person cannot rejoin by any path (text to slop or The Network, after leave, after delete everything, web, MCP) and gets no send", async () => {
      expect(bPerson).toBeTruthy();
      const before = fetched.length;
      await text(B, "", ["https://media.test/b2.jpg"]);
      expect(fetched.length).toBe(before);
      expect(await text(B, "leave slop.date")).toBe("left");
      expect(await text(B, "slop")).toBe("held");
      expect(await text(B, "Alex, 31")).toBe("held");
      expect(await text(B, "hi there")).toBe("held");
      const who = { e164: B, personId: bPerson! };
      expect(await svc.accounts.join(APPS.slop, who, { firstName: "Alex", age: 31, consent: { sms: true, version: APPS.slop.consent.version } })).toEqual({ ok: false, error: "review" });
      const hooks = platformHooks({ store: svc.people, otp: svc.publicApi.otp, accounts: svc.accounts, sessions: svc.publicApi.sessions, app: id => APPS[id as AppId] });
      expect(await hooks.startOtp("slop", B, "203.0.113.9")).toEqual({ ok: true });
      expect(otpSent).toBe(0);
      expect(await hooks.login(B)).toBe("held");
      expect(await svc.submitProfile(bPerson!, "slop", B, "I'm Alex, 31, in Brooklyn")).toBe("not_member");
      await svc.accounts.deleteAll(who);
      expect(await text(B, "slop")).toBe("held");
      expect(await text(B, "Alex, 31")).toBe("held");
      expect((await svc.accounts.canJoin(APPS.slop, { e164: B, personId: (await personOf(B)) ?? null })).canJoin).toBe(false);
      const live = (await svc.people.memberships(bPerson!)).filter(m => m.state === "active");
      expect(live).toEqual([]);
      const refused = await svc.consentRefused(slop, [{ id: "s1", memberId: bMember as MemberId, to: B, body: "hello", kind: "transactional", proactive: false, system: false, ts: clock.now() }]);
      expect([...refused]).toEqual(["s1"]);
    });

    await b.run("pg: X-Network-Staff-Id from a token other than the console's is ignored: the token is the reviewer of record", async () => {
      await staff("/review/opp_none", REVIEWER, { decision: "approve" });
      await staff("/review/opp_none2", CONSOLE, { decision: "approve" });
      const rows = await svc.sql`select target_id, actor from network.staff_audit where action = 'review' and target_id in ('opp_none', 'opp_none2') and detail->>'phase' = 'requested' order by target_id`;
      expect(rows.map((r: any) => [r.target_id, r.actor === "pat@example.com"])).toEqual([["opp_none", false], ["opp_none2", true]]);
    });

    await b.run("pg: the weekly bias monitor stores a report per slop network and the staff API serves it (aggregates only)", async () => {
      const r = await svc.weeklyBias(slop, true);
      expect(r?.network).toBe("slop:nyc");
      expect(await svc.weeklyBias(slop)).toBeUndefined(); // not again within the week
      const res = await staff("/bias", CONSOLE);
      const j = await res.json() as { ok: boolean; reports: { network: string; report: { groups: Record<string, unknown> } }[] };
      expect([res.status, j.ok, j.reports.length]).toEqual([200, true, 1]);
      expect(JSON.stringify(j)).not.toMatch(/slop_[0-9a-f-]{8}/);
    });
  } finally {
    await svc.close().catch(() => {});
    const { dropDb } = await import("../../packages/platform/test/pg.ts");
    await dropDb(url!);
  }
}
