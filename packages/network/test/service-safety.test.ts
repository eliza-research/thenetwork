// Reports, holds and bans across apps, staff verification, and private photos through the service
// (docs/admin-console.md 3.7.1; founder decisions 2026-10-08: photos and ratings are for verified
// adults only). Postgres in a database of its own per test process; dry-run sends; fictional numbers
// (+1 212 555 01xx); photos in a temporary folder (no R2).
import { serveHttp } from "../../core/src/runtime/http.ts";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { TURN_PATH, type TurnRequest, type TurnResponse } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { LocalDiskPhotoStorage, PHOTO_CONSENT, type PhotoRater } from "../../platform/src/photos.ts";
import { BlooioAdapter, DryRunAdapter } from "../service/channel.ts";
import { ServiceClient } from "../../observatory/src/sources/service.ts";
import { NetworkService, WEBHOOK_PATH, type ServiceOptions } from "../service/service.ts";
import { Mini, START } from "./mini.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { presentInNyc } from "../src/network.ts";
import { WATCH } from "../src/trust.ts";
import { resolveConfig } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { friendsInfo, friendsPack } from "../../engine/src/packs/friends/index.ts";
import { World } from "../../engine/src/world.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_service_safety_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_shared";
const NETS = [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }, { id: "peon:nyc" }, { id: "friends:nyc" }];
let phoneSeq = 0;
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
  /** A banned number: the same start answer, no code sent, and no session from any code. */
  const loginRefused = async (app: AppId, phone: string) => {
    clock.advance(31_000);
    const sent = otp.sent;
    expect((await json(app, "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    expect(otp.sent).toBe(sent);
    expect((await json(app, "POST", "/api/auth/otp/verify", { phone, code: otp.codes.get(phone) })).body).toEqual({ ok: false, error: "invalid_code" });
  };
  const join = (app: AppId, age: number, firstName = "Rae") => json(app, "POST", "/api/join", { firstName, age, consent: { sms: true, wording: APPS[app].consent.text } });
  const forget = (app: AppId) => jar.delete(app);
  return { call, json, login, loginRefused, join, forget };
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
  const fresh = async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    phoneSeq = 40;
  };

  // spec/staffSafetyService.md, "Live enrollment and ban projection use the current person"
  test("a membership that joins during a staff ban is restricted in its Network runtime", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const web = site(s, clock, otp);
    const phone = newPhone();
    expect(await text(s, clock, phone, "slop")).toBe("join_asked");
    expect(await text(s, clock, phone, "Ari, 32")).toBe("joined");
    const primary = (await memberOf("slop", phone))!;
    const person = (await s.accounts.personFor(phone))!;
    await web.login("friends", phone);

    let entered!: () => void, release!: () => void;
    const atPersist = new Promise<void>(resolve => { entered = resolve; });
    const allowPersist = new Promise<void>(resolve => { release = resolve; });
    const persistBan = s.people.ban.bind(s.people);
    let snapshotStatus: string | undefined;
    s.people.ban = async (ban, options) => {
      entered();
      await allowPersist;
      await persistBan(ban, options);
      const rt = s.runtimeFor("friends")!;
      const member = (await memberOf("friends", phone))!;
      const snapshot = await rt.scoped(tx => loadSnapshot(tx, clock.now(), { app: "friends" }));
      snapshotStatus = (snapshot.members.find(candidate => candidate.id === member.id) as { accountStatus?: string } | undefined)?.accountStatus;
    };
    const banning = staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: primary.id, by: "person", note: "confirmed by staff" });
    try {
      await Promise.race([atPersist, banning.then(() => { throw new Error("Ban ended before persistence"); })]);
      expect((await web.join("friends", 32, "Ari")).status).toBe(200);
      expect(await memberOf("friends", phone)).toMatchObject({ account_status: "active" });
      release();
      expect(await (await banning).json()).toEqual({ ok: true });
      const member = (await memberOf("friends", phone))!;
      expect(await s.people.getMembership(person.id, "friends")).toMatchObject({ state: "restricted" });
      expect(member.account_status).toBe("restricted");
      expect(snapshotStatus).toBe("restricted");
      const rt = s.runtimeFor("friends")!;
      expect(await rt.readState(n => n.trust.level(member.id))).toBe("hold");
    } finally {
      release();
      await banning;
    }
  });

  test("a ban prevents an already admitted enrollment from creating an active Network member", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const web = site(s, clock, otp);
    const phone = newPhone();
    expect(await text(s, clock, phone, "slop")).toBe("join_asked");
    expect(await text(s, clock, phone, "Nila, 32")).toBe("joined");
    const primary = (await memberOf("slop", phone))!;
    const person = (await s.accounts.personFor(phone))!;
    await web.login("friends", phone);

    let entered!: () => void, release!: () => void;
    const atProjection = new Promise<void>(resolve => { entered = resolve; });
    const allowProjection = new Promise<void>(resolve => { release = resolve; });
    const createMember = s.createMember.bind(s);
    s.createMember = async (...args) => { entered(); await allowProjection; return createMember(...args); };
    const joining = web.join("friends", 32, "Nila");
    try {
      await Promise.race([atProjection, joining.then(() => { throw new Error("Enrollment ended before projection"); })]);
      expect(await s.people.getMembership(person.id, "friends")).toMatchObject({ state: "active" });
      const banned = await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: primary.id, by: "phone", note: "confirmed by staff" });
      expect(await banned.json()).toEqual({ ok: true });
      release();
      expect((await joining).body).toMatchObject({ ok: false, error: "review" });
      expect(await s.people.getMembership(person.id, "friends")).toMatchObject({ state: "restricted" });
      expect(await memberOf("friends", phone)).toBeUndefined();
    } finally {
      release();
      await joining;
    }
  });

  // spec/staffSafetyService.md, "An interrupted ban resumes from its saved authority"
  test("staff retry completes a durable ban after a process restart without recording another ban", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const phone = newPhone();
    expect(await text(s, clock, phone, "slop")).toBe("join_asked");
    expect(await text(s, clock, phone, "Mara, 32")).toBe("joined");
    const primary = (await memberOf("slop", phone))!;
    const reporter = newPhone();
    expect(await text(s, clock, reporter, "slop")).toBe("join_asked");
    expect(await text(s, clock, reporter, "Ana, 30")).toBe("joined");
    expect(await text(s, clock, reporter, "report Mara, she was rude and kept texting me")).toBe("handled");
    const [report] = await s.runtimeFor("slop")!.readState(n => n.safetyReports());
    expect(report).toMatchObject({ subjectId: primary.id, status: "open" });
    const web = site(s, clock, otp);
    await web.login("friends", phone);
    expect((await web.join("friends", 32, "Mara")).status).toBe(200);
    const peer = (await memberOf("friends", phone))!;
    s.people.suppress = async () => { throw new Error("fixture: process ended after saving the ban"); };
    const path = "/apps/slop/safety/ban";
    const body = { memberId: primary.id, by: "phone", note: "original confirmed case", reportId: report!.id };
    expect((await staff(s, "saf-tok", "POST", path, body)).status).toBe(503);
    expect(await sql`select reason,report_id,projection_completed_at from platform.bans`).toEqual([{ reason: body.note, report_id: report!.id, projection_completed_at: null }]);
    expect(await memberOf("friends", phone)).toMatchObject({ account_status: "active" });
    await s.close();

    const { s: restarted } = service(clock);
    const retry = await staff(restarted, "saf-tok", "POST", "/apps/friends/safety/ban", { ...body, memberId: peer.id, note: "retry after restart", reportId: "friends.rp999" });
    expect(await retry.json()).toEqual({ ok: true });
    expect(await memberOf("slop", phone)).toMatchObject({ account_status: "restricted" });
    expect(await memberOf("friends", phone)).toMatchObject({ account_status: "restricted" });
    expect(await restarted.runtimeFor("friends")!.readState(n => n.trust.level(peer.id))).toBe("hold");
    expect(await restarted.runtimeFor("slop")!.readState(n => n.safetyReports())).toEqual([expect.objectContaining({ id: report!.id, status: "banned" })]);
    expect(await sql`select app_id, payload->>'reportId' as report_id from network.events
      where type='safety_action' and payload->>'action'='ban' order by app_id`).toEqual([
      { app_id: "friends", report_id: null }, { app_id: "slop", report_id: report!.id },
    ]);
    expect(await sql`select reason,projection_completed_at from platform.bans`).toEqual([{ reason: body.note, projection_completed_at: new Date(clock.now()) }]);
    const duplicate = await staff(restarted, "saf-tok", "POST", path, body);
    expect(await duplicate.json()).toEqual({ ok: false, reason: "already_banned" });
  });

  test("a staff phone ban covers a move committed after staff read the number, including projection retry", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const { s: other, otp } = service(clock);
    const web = site(other, clock, otp);
    const previous = newPhone(), current = newPhone();
    expect(await text(s, clock, previous, "slop")).toBe("join_asked");
    expect(await text(s, clock, previous, "Ari, 32")).toBe("joined");
    const member = (await memberOf("slop", previous))!;
    const previousHash = s.accounts.phoneHash(previous), currentHash = s.accounts.phoneHash(current);
    await web.login("slop", previous);
    expect((await web.json("slop", "POST", "/api/me/phone/start", { phone: current })).body).toEqual({ ok: true });

    const persistBan = s.people.ban.bind(s.people);
    s.people.ban = async (ban, options) => {
      const move = await web.json("slop", "POST", "/api/me/phone/confirm", { code: otp.codes.get(current) });
      expect(move.body).toMatchObject({ ok: true });
      await persistBan(ban, options);
    };
    s.people.suppress = async () => { throw new Error("fixture: process ended after saving the ban"); };
    const path = "/apps/slop/safety/ban";
    const body = { memberId: member.id, by: "phone", note: "confirmed by staff" };
    expect((await staff(s, "saf-tok", "POST", path, body)).status).toBe(503);
    expect(await memberOf("slop", current)).toMatchObject({ id: member.id });
    expect(await other.people.isBanned(previousHash)).toBe(true);
    expect(await other.people.isBanned(currentHash)).toBe(true);

    expect(await (await staff(other, "saf-tok", "POST", path, { ...body, note: "retried by staff" })).json()).toEqual({ ok: true });
    expect(await memberOf("slop", current)).toMatchObject({ id: member.id, account_status: "restricted" });
    expect(await other.people.isSuppressed(previousHash)).toBe(true);
    expect(await other.people.isSuppressed(currentHash)).toBe(true);
    const rows = await sql`select phone_hash, reason, projection_completed_at from platform.bans`;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.phone_hash))).toEqual(new Set([previousHash, currentHash]));
    expect(rows.every(row => row.reason === body.note && row.projection_completed_at !== null)).toBe(true);
  });

  test("a number move refuses a staff ban committed after verification and before the move", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const { s: other, otp } = service(clock);
    const web = site(other, clock, otp);
    const current = newPhone(), proposed = newPhone();
    expect(await text(s, clock, current, "slop")).toBe("join_asked");
    expect(await text(s, clock, current, "Ari, 32")).toBe("joined");
    const member = (await memberOf("slop", current))!;
    await web.login("slop", current);
    expect((await web.json("slop", "POST", "/api/me/phone/start", { phone: proposed })).body).toEqual({ ok: true });

    const movePhone = other.people.movePhone.bind(other.people);
    other.people.movePhone = async move => {
      const response = await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", {
        memberId: member.id, by: "phone", note: "confirmed by staff",
      });
      expect(await response.json()).toEqual({ ok: true });
      return movePhone(move);
    };
    const confirmation = await web.json("slop", "POST", "/api/me/phone/confirm", { code: otp.codes.get(proposed) });
    expect(confirmation.body).toMatchObject({ ok: false, error: "review" });
    expect(await memberOf("slop", current)).toMatchObject({ id: member.id, account_status: "restricted" });
    expect(await other.people.findPhone(proposed)).toBeUndefined();
    expect(await other.people.isBanned(other.accounts.phoneHash(proposed))).toBe(false);
  });

  const signedSafetyFixture = async (onTestFinished: (stop: () => Promise<void>) => void, otherNames?: readonly [string, string]) => {
    await fresh();
    const clock = new SimClock(START);
    const secret = "synthetic-safety-clarification-turn-secret";
    const { s, otp } = service(clock, { env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret } });
    await s.start();
    const server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: request => s.fetch(request) });
    onTestFinished(() => server.stop(true));
    const ari = newPhone(), ben = newPhone(), peonContact = newPhone();
    const contacts = [["slop", ben, 32, otherNames?.[0]], ["peon", peonContact, 31, otherNames?.[1]]] as const;
    for (const [app, contact, age, name] of contacts) {
      expect(await text(s, clock, ari, app)).toBe("join_asked");
      expect(await text(s, clock, ari, "Ari, 30")).toBe("joined");
      if (name) {
        const web = site(s, clock, otp);
        await web.login(app, contact);
        expect((await web.join(app, age, name)).status).toBe(200);
      } else {
        expect(await text(s, clock, contact, app)).toBe("join_asked");
        expect(await text(s, clock, contact, `Ben, ${age}`)).toBe("joined");
      }
    }
    const slopAri = (await memberOf("slop", ari))!.id;
    const slopBen = (await memberOf("slop", ben))!.id;
    const peonAri = (await memberOf("peon", ari))!.id;
    const peonBen = (await memberOf("peon", peonContact))!.id;
    const recordMeeting = (app: "slop" | "peon", pair: string[]) => s.runtimeFor(app)!.unitOfWork(net => {
      const state = net.exportState(), now = clock.now();
      state.opps.push({
        id: `${app}.clarification-meeting.${pair[1]}`, origin: "engine", kind: "intro", category: app === "slop" ? "romance" : "professional",
        objective: "coffee", detail: "coffee", stage: "done", participants: pair, alternates: [],
        primed: [], status: pair.map(id => [id, "yes"]), explanations: {}, bookedTold: pair,
        createdAt: now - 24 * HOUR, deadline: now - 3 * HOUR, meetingAt: now - 4 * HOUR,
        score: 0.8, generator: "fixture", components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0,
          timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
        exploration: false, sameDay: false, contacted: pair, reminded: [], feedbackFrom: [], tags: [], replacements: 0,
      });
      net.importState(state);
    });
    await recordMeeting("slop", [slopAri, slopBen]);
    await recordMeeting("peon", [peonAri, peonBen]);
    const signed = async (messageId: string, text: string, app?: AppId, receivedAt = clock.now(), to: string | null = null) => {
      const input: TurnRequest = { channel: "blooio", transport: "imessage", from: ari, to, messageId,
        text, receivedAt, ...(app ? { app } : {}) };
      const body = JSON.stringify(input);
      const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) });
      const response = await fetch(new URL(TURN_PATH, server.url), { method: "POST", body, headers });
      expect(response.status).toBe(200);
      return await response.json() as TurnResponse;
    };
    const reports = async (app: "slop" | "peon") => (await s.runtimeFor(app)!.pg.load())?.reports;
    const pending = async (app: "slop" | "peon") => (await s.runtimeFor(app)!.pg.load())?.members
      .find(member => member.id === (app === "slop" ? slopAri : peonAri))?.pendingSafety;
    const askSlop = async (id: string) => {
      const at = clock.now();
      expect(await signed(id, "Report him, he harassed me.", "slop")).toMatchObject({
        outcome: "handled", app: "slop", replies: [expect.stringContaining(`Who do you mean: ${otherNames?.[0] ?? "Ben"}?`)],
      });
      expect(await pending("slop")).toMatchObject({ at, targets: [slopBen] });
      clock.advance(MINUTE);
      return at;
    };
    const probeStatus = (id: string) => s.runtimeFor("slop")!.readState(net =>
      net.exportState().opps.find(opp => opp.id === id)?.status.find(([member]) => member === slopAri)?.[1]);
    const competingSlopProbe = async (id: string, counterpart = slopBen) => {
      const now = clock.now();
      const deliveryId = `${id}.probe`;
      await s.runtimeFor("slop")!.unitOfWork(net => {
        const state = net.exportState();
        const meeting = state.opps.find(opp => opp.id === `slop.clarification-meeting.${slopBen}`)!;
        const reporter = state.members.find(member => member.id === slopAri)!;
        state.opps.push({ ...meeting, id, stage: "probing", meetingAt: undefined, bookedTold: undefined,
          participants: [slopAri, counterpart], status: [[slopAri, "probing"], [counterpart, "probing"]], createdAt: now,
          deadline: now + HOUR, contacted: [slopAri, counterpart] });
        reporter.awaiting = { kind: "probe", oppId: id, at: now, probeReceiptId: deliveryId };
        net.importState(state);
      });
      await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, type, status, opportunity_id, proactive, system, ts)
        values ('slop', ${deliveryId}, ${slopAri}, 'outbound', 'imessage', 'Are you open to a date?', 'probe',
          'dry_run', ${id}, true, false, ${new Date(now)})`;
      clock.advance(MINUTE);
    };

    return { s, otp, ari, slopAri, slopBen, peonAri, recordMeeting, signed, reports, pending, askSlop, probeStatus, competingSlopProbe, clock };
  };

  test("a shared signed safety clarification returns to its exact pending report", async ({ onTestFinished }) => {
    const { s, otp, ari, slopAri, slopBen, peonAri, recordMeeting, signed, reports, pending, clock } = await signedSafetyFixture(onTestFinished);
    const askedAt = clock.now();
    const ask = await signed("pending-safety-ask", "Report him, he harassed me.", "slop");
    expect(ask).toMatchObject({ outcome: "handled", app: "slop", replies: [expect.stringMatching(/^Who do you mean: Ben\?/)] });
    let probeNo = 0;
    const competingPeonItem = async () => {
      clock.advance(MINUTE);
      await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, opportunity_id, proactive, system, ts)
        values ('peon', ${"competing-peon-probe-" + ++probeNo}, ${peonAri}, 'outbound', 'imessage', 'A Peon opportunity is ready.',
          'dry_run', 'peon.competing-opportunity', true, false, ${new Date(clock.now())})`;
      expect((await s.memberApps(ari)).find(row => row.app === "peon")?.lastItem).toBe(clock.now());
      clock.advance(MINUTE);
    };
    await competingPeonItem();
    const slopBefore = await pending("slop");
    expect(await signed("unqualified-cross-app-exclusion", safetyExclusion)).toMatchObject({ app: "peon" });
    expect(await pending("slop")).toEqual(slopBefore);
    expect(await reports("slop")).toEqual([]);
    expect(await signed("unrelated-reply", "Thanks")).toMatchObject({ app: "peon" });
    expect(await signed("forced-peon-reply", "Ben", "peon")).toMatchObject({ app: "peon" });
    await competingPeonItem();
    expect(await signed("earlier-signed-reply", "Ben", undefined, askedAt - MINUTE)).toMatchObject({ app: "peon" });
    expect(await reports("slop")).toEqual([]);

    clock.advance(MINUTE);
    expect(await signed("pending-peon-report", "Report him, he harassed me.", "peon")).toMatchObject({
      outcome: "handled", app: "peon", replies: [expect.stringMatching(/^Who do you mean: Ben\?/)],
    });
    await competingPeonItem();
    const peonBefore = await pending("peon");
    expect(await signed("ambiguous-app-reply", "Ben")).toMatchObject({ outcome: "handled", replies: [] });
    expect(await pending("slop")).toEqual(slopBefore);
    expect(await pending("peon")).toEqual(peonBefore);
    expect(await reports("slop")).toEqual([]);
    expect(await reports("peon")).toEqual([]);
    expect(await signed("drop-peon-report", "Never mind", "peon")).toMatchObject({ app: "peon" });

    await competingPeonItem();
    const answer = await signed("pending-safety-answer", "I mean Ben.");
    expect(answer).toMatchObject({ outcome: "handled", app: "slop", memberId: slopAri });
    expect(await signed("pending-safety-answer", "I mean Ben.")).toEqual(answer);
    expect(await reports("slop")).toMatchObject([
      { reporterId: slopAri, subjectId: slopBen, met: true, kind: "harassment", status: "open" },
    ]);

    const mary = newPhone();
    const web = site(s, clock, otp);
    await web.login("slop", mary);
    expect((await web.join("slop", 32, "Mary\tJane")).status).toBe(200);
    const slopMary = (await memberOf("slop", mary))!.id;
    await recordMeeting("slop", [slopAri, slopMary]);
    expect(await signed("pending-multiword-name-ask", "Report her, she harassed me.", "slop")).toMatchObject({
      app: "slop", replies: [expect.stringMatching(/^Who do you mean: Mary\s+Jane\?/)],
    });
    await competingPeonItem();
    expect(await signed("pending-multiword-name-answer", "Mary Jane")).toMatchObject({ outcome: "handled", app: "slop" });
    expect(await reports("slop")).toHaveLength(2);
    expect(await reports("slop")).toEqual(expect.arrayContaining([expect.objectContaining({ subjectId: slopMary })]));
  }, T);

  const safetyExclusion = "No, not Ben. He wasn't there last week.";
  const dedicatedLine = "+12125550999";
  const addDedicatedLine = () => sql`insert into platform.app_lines (line_e164, app_id, city, provider, env)
    values (${dedicatedLine}, 'slop', 'nyc', 'blooio', 'dev')`;

  for (const [route, app, to] of [["named app", "slop", null], ["dedicated line", undefined, dedicatedLine]] as const) {
    test(`an explicit safety exclusion via the ${route} clears the question and answers the competing probe`, async ({ onTestFinished }) => {
      const { askSlop, competingSlopProbe, pending, probeStatus, reports, s, signed, clock } = await signedSafetyFixture(onTestFinished);
      if (to) await addDedicatedLine();
      await askSlop("pending-local-safety-ask");
      const probe = "slop.competing-safety-probe";
      await competingSlopProbe(probe);
      expect(await probeStatus(probe)).toBe("probing");
      expect(await signed("exclude-local-safety", safetyExclusion, app, clock.now(), to)).toMatchObject({ app: "slop" });
      expect.soft(await pending("slop")).toBeUndefined();
      expect(await probeStatus(probe)).toBe("unavailable");
      expect(await reports("slop")).toEqual([]);
      expect(await s.runtimeFor("slop")!.readState(net => net.exportState().blocks)).toEqual([]);
      clock.advance(MINUTE);
      expect(await signed("excluded-local-safety-replayed-name", "Ben", app, clock.now(), to)).toMatchObject({ app: "slop" });
      expect(await reports("slop")).toEqual([]);
    }, T);
  }

  test("a qualified name answers a signed safety question without taking a competing probe", async ({ onTestFinished }) => {
    const { s, askSlop, competingSlopProbe, pending, probeStatus, reports, signed, clock, slopBen } = await signedSafetyFixture(onTestFinished);
    const cy = newPhone();
    expect(await text(s, clock, cy, "slop")).toBe("join_asked");
    expect(await text(s, clock, cy, "Cy, 31")).toBe("joined");
    const cyId = (await memberOf("slop", cy))!.id;
    await askSlop("ask-qualified-local");
    const probe = "slop.competing-qualified-safety-probe";
    await competingSlopProbe(probe, cyId);

    expect(await signed("pending-local-pronoun", "him please", "slop")).toMatchObject({ app: "slop" });
    expect(await pending("slop")).toMatchObject({ targets: [slopBen] });
    expect(await reports("slop")).toEqual([]);
    expect(await probeStatus(probe)).toBe("probing");

    expect(await signed("answer-qualified-local", "Yes, Ben please", "slop")).toMatchObject({ app: "slop" });
    expect(await pending("slop")).toBeUndefined();
    expect(await reports("slop")).toEqual([expect.objectContaining({ subjectId: slopBen })]);
    expect(await probeStatus(probe)).toBe("probing");
  });

  test("only one matching app can take a qualified shared safety answer", async ({ onTestFinished }) => {
    const { askSlop, pending, reports, signed, clock, slopBen, peonAri } = await signedSafetyFixture(onTestFinished);
    await askSlop("ask-qualified-shared-slop");
    expect(await signed("ask-qualified-shared-peon", "Report him, he harassed me.", "peon")).toMatchObject({
      outcome: "handled", app: "peon", replies: [expect.stringMatching(/^Who do you mean: Ben\?/)],
    });
    clock.advance(MINUTE);
    const competingPeon = async (id: string) => {
      await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, type, status, opportunity_id, proactive, system, ts)
        values ('peon', ${id}, ${peonAri}, 'outbound', 'imessage', 'A Peon opportunity is ready.', 'probe',
          'dry_run', 'peon.competing-qualified-safety-probe', true, false, ${new Date(clock.now())})`;
      clock.advance(MINUTE);
    };

    await competingPeon("qualified-shared-probe-ambiguous");
    expect(await signed("answer-qualified-shared-ambiguous", "Yes, Ben please")).toMatchObject({ outcome: "handled", replies: [] });
    expect(await pending("slop")).toMatchObject({ targets: [slopBen] });
    expect(await pending("peon")).toBeDefined();
    expect(await reports("slop")).toEqual([]);
    expect(await reports("peon")).toEqual([]);

    expect(await signed("cancel-qualified-shared-peon", "Never mind", "peon")).toMatchObject({ app: "peon" });
    await competingPeon("qualified-shared-probe-unique");
    expect(await signed("answer-shared-pronoun", "him please")).toMatchObject({ app: "peon" });
    expect(await pending("slop")).toMatchObject({ targets: [slopBen] });
    expect(await signed("answer-qualified-shared-unique", "Yes, Ben please")).toMatchObject({ outcome: "handled", app: "slop" });
    expect(await pending("slop")).toBeUndefined();
    expect(await reports("slop")).toEqual([expect.objectContaining({ subjectId: slopBen })]);
    expect(await reports("peon")).toEqual([]);
  });

  test("an affirmative-looking alternate name still makes a signed shared reply ambiguous", async ({ onTestFinished }) => {
    const { competingSlopProbe, pending, reports, signed, clock } = await signedSafetyFixture(onTestFinished, ["Yeah\tYes", "Yes"]);
    expect(await signed("ask-literal-app", "Report him, he harassed me.", "slop")).toMatchObject({
      app: "slop", replies: [expect.stringMatching(/^Who do you mean: Yeah\s+Yes\?/)],
    });
    clock.advance(MINUTE);
    expect(await signed("ask-qualified-app", "Report him, he harassed me.", "peon")).toMatchObject({
      app: "peon", replies: [expect.stringMatching(/^Who do you mean: Yes\?/)],
    });
    clock.advance(MINUTE);
    const slopQuestion = await pending("slop");
    const peonQuestion = await pending("peon");

    expect(await signed("ambiguous-literal-and-qualified", "Yeah Yes")).toMatchObject({ outcome: "handled", replies: [] });
    expect(await reports("slop")).toEqual([]);
    expect(await reports("peon")).toEqual([]);
    expect(await pending("slop")).toEqual(slopQuestion);
    expect(await pending("peon")).toEqual(peonQuestion);

    await competingSlopProbe("slop.competing-bare-safety-affirmative");
    expect(await signed("bare-affirmative", "Yes")).toMatchObject({ app: "slop" });
    expect(await reports("slop")).toEqual([]);
    expect(await reports("peon")).toEqual([]);
    expect(await pending("slop")).toEqual(slopQuestion);
    expect(await pending("peon")).toEqual(peonQuestion);
  }, T);

  test("a signed cancellation received before a dedicated app question cannot clear it", async ({ onTestFinished }) => {
    const { askSlop, pending, reports, signed, slopBen } = await signedSafetyFixture(onTestFinished);
    await addDedicatedLine();
    const askedAt = await askSlop("pending-current-safety");
    expect(await signed("stale-dedicated-cancellation", "Never mind", undefined, askedAt - MINUTE, dedicatedLine))
      .toMatchObject({ app: "slop" });
    expect(await pending("slop")).toMatchObject({ at: askedAt, targets: [slopBen] });
    expect(await reports("slop")).toEqual([]);
  }, T);

  const safetyControlCases = [
    { name: "Nvm", reply: "nvm", probeReply: undefined },
    { name: "No", reply: "no", probeReply: undefined },
    { name: "No", reply: "no", probeReply: "unavailable" },
    { name: "Yes", reply: "yes", probeReply: "available" },
  ];
  for (const { name, reply, probeReply } of safetyControlCases) {
    // spec/safetyCase.md, "An unrelated reply keeps a current safety question"
    test(`a signed ${reply} does not name ${name} with ${probeReply ? "a competing probe" : "only a safety question"}`, async ({ onTestFinished }) => {
      const { askSlop, competingSlopProbe, pending, probeStatus, reports, signed, slopBen } = await signedSafetyFixture(onTestFinished, [name, "Ben"]);
      const askedAt = await askSlop("controls-safety-ask");
      const probe = "slop.control-reply-competing-probe";
      if (probeReply) await competingSlopProbe(probe);

      expect(await signed("controls-safety-reply", reply, "slop")).toMatchObject({ app: "slop" });
      expect.soft(await reports("slop")).toEqual([]);
      if (probeReply) {
        expect(await probeStatus(probe)).toBe(probeReply);
        expect(await pending("slop")).toMatchObject({ at: askedAt, targets: [slopBen] });
        expect(await signed("controls-qualified-name", `I mean ${name}`, "slop")).toMatchObject({ app: "slop" });
        expect(await reports("slop")).toEqual([expect.objectContaining({ subjectId: slopBen })]);
      } else {
        expect(await pending("slop")).toBeUndefined();
      }
    }, T);
  }

  // spec/safetyCase.md, "An unrelated reply keeps a current safety question"
  test("an unqualified cancellation cannot route to the app where it looks like a name", async ({ onTestFinished }) => {
    const { askSlop, clock, pending, peonAri, reports, signed, slopBen } = await signedSafetyFixture(onTestFinished, ["Nvm", "Ben"]);
    const askedAt = await askSlop("shared-control-safety-ask");
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, opportunity_id, proactive, system, ts)
      values ('peon', 'shared-control-competing-probe', ${peonAri}, 'outbound', 'imessage', 'A Peon opportunity is ready.',
        'dry_run', 'peon.shared-control-competing-opportunity', true, false, ${new Date(clock.now())})`;
    clock.advance(MINUTE);

    expect.soft(await signed("shared-control-ordinary-route", "nvm")).toMatchObject({ app: "peon" });
    expect(await pending("slop")).toMatchObject({ at: askedAt, targets: [slopBen] });
    expect(await reports("slop")).toEqual([]);
  }, T);

  // spec/safetyCase.md, "An unrelated reply keeps a current safety question"
  test("an exact name with a non-ASCII letter remains a name", async ({ onTestFinished }) => {
    const { askSlop, reports, signed, slopBen } = await signedSafetyFixture(onTestFinished, ["Noé", "Ben"]);
    await askSlop("non-ascii-name-safety-ask");
    expect(await signed("non-ascii-name-safety-answer", "Noé", "slop")).toMatchObject({ app: "slop" });
    expect(await reports("slop")).toEqual([expect.objectContaining({ subjectId: slopBen })]);
  }, T);

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
    expect((await web.json("friends", "GET", "/api/me")).status).toBe(200);
    // A profile-share grant and a pending SHARE flow that exist before the ban.
    const benPerson = (await s.accounts.personFor(ben))!;
    expect(await s.accounts.share(APPS.friends, { e164: ben, personId: benPerson.id }, "slop", ["city"])).toBe(true);
    const benKey = s.accounts.phoneHash(ben);
    await s.people.putPending({ phoneHash: benKey, kind: "share", app: "slop", name: null, age: null, at: clock.now() });
    const a = (await memberOf("slop", ana))!.id, b = (await memberOf("slop", ben))!.id, bf = (await memberOf("friends", ben))!.id;
    expect(await text(s, clock, ana, "report Ben, he was rude and kept texting me")).toBe("handled");

    // The queue: safety (or admin) only; ids and a kind, never the words.
    expect((await staff(s, "rev-tok", "GET", "/apps/slop/safety/reports")).status).toBe(403);
    const q = await (await staff(s, "saf-tok", "GET", "/apps/slop/safety/reports")).json() as any;
    expect(q.reports).toHaveLength(1);
    expect(q.reports[0]).toMatchObject({ kind: "harassment", reporterId: a, subjectId: b, status: "open", source: "message", priorReports: 0 });
    expect(JSON.stringify(q)).not.toMatch(/rude|texting/);
    const reportId = q.reports[0].id as string;
    // The report is a product event too (on the reporter's timeline; payload.target names the subject), ids and a kind only.
    const ev = (await sql`select actor_type, type, object_type, object_id, payload from network.events where app_id = 'slop' and type = 'report_received'`) as any[];
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor_type: "agent", object_type: "member", object_id: a, payload: { reportId, kind: "harassment", memberId: a, target: b, source: "message", met: false } });
    expect(JSON.stringify(ev)).not.toMatch(/rude|texting/);

    // Hold: a decision note of 5+ characters; the person is held on slop and on friends.
    expect((await staff(s, "saf-tok", "POST", "/apps/slop/safety/hold", { memberId: b, note: "x" })).status).toBe(400);
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/hold", { memberId: b, note: "reported after a date", reportId })).json()).toEqual({ ok: true });
    const level = async (app: AppId, id: string) => s.runtimeFor(app)!.readState(n => n.safetyCases().find(c => c.memberId === id)?.level);
    expect(await level("slop", b)).toBe("hold");
    expect(await level("friends", bf)).toBe("hold");

    // Ban by phone.
    expect((await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: b, by: "number", note: "confirmed by staff" })).status).toBe(400);
    const foreignReport = await staff(s, "saf-tok", "POST", "/apps/friends/safety/ban", { memberId: bf, by: "phone", note: "confirmed by staff", reportId });
    expect(foreignReport.status).toBe(409);
    expect(await foreignReport.json()).toEqual({ ok: false, reason: "unknown_report" });
    expect(await sql`select id from platform.bans`).toEqual([]);
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
    // The web cookie issued before the ban no longer authenticates.
    // spec/webSession.md, "Only a live token on the requested app can authenticate"
    expect(await web.json("friends", "GET", "/api/me")).toEqual({ status: 401, body: { ok: false, error: "unauthorized" } });
    // The ban revoked the share grant and deleted the pending SHARE flow; ordinary text is not handled, HELP still answers.
    // spec/safetyCase.md, "A ban allows only carrier commands and app leave"
    expect(await s.people.shareGrants(benPerson.id)).toEqual([
      expect.objectContaining({ fromApp: "slop", toApp: "friends", revokedAt: expect.any(Number) }),
    ]);
    expect(await s.people.getPending(benKey, "share", "slop")).toBeUndefined();
    expect(await s.accounts.share(APPS.friends, { e164: ben, personId: benPerson.id }, "slop", ["city"])).toBe(false);
    const replies = directs.length;
    expect(await text(s, clock, ben, "SHARE")).toBe("held");
    expect(await text(s, clock, ben, "are you there?")).toBe("held");
    expect(directs).toHaveLength(replies);
    expect(await text(s, clock, ben, "HELP")).toBe("held");
    expect(directs.slice(replies)).toEqual([expect.objectContaining({ to: ben })]);
    // A banned member can still leave an app: "left" and one compliance reply from that app.
    const beforeLeave = directs.length;
    expect(await text(s, clock, ben, "leave friends.help")).toBe("left");
    expect(directs.slice(beforeLeave)).toEqual([expect.objectContaining({ app: "friends", to: ben })]);

    // The banned number cannot join any other app, by text or on the web; nothing is stored and nothing is answered.
    const before = directs.length;
    expect(await text(s, clock, ben, "peon")).toBe("held");
    expect(directs.length).toBe(before);
    // OTP login: no code is sent to the banned number and no session is issued (PRD 40.3).
    await web.loginRefused("peon", ben);
    expect((await web.join("peon", 32, "Ben")).body).toMatchObject({ ok: false });
    expect(await memberOf("peon", ben)).toBeUndefined();
    // Later attempts stay refused; the banned number never gets a web session to act with.
    clock.advance(MINUTE);
    await web.loginRefused("peon", ben);
    expect((await web.join("peon", 32, "Ben")).body).toMatchObject({ ok: false });
    expect((await sql`select count(*)::int as n from platform.bans`)[0].n).toBe(1);

    // Audit: requested before result, for the hold and the ban.
    const rows = (await sql`select action, detail->>'safety' as safety, detail->>'phase' as phase, ok from network.staff_audit where action in ('safety', 'read_safety_reports') order by id`) as any[];
    const hold = rows.filter(r => r.safety === "hold").map(r => r.phase), ban = rows.filter(r => r.safety === "ban").map(r => r.phase);
    expect(hold).toEqual(["requested", "result"]);
    expect(ban).toEqual(["refused", "requested", "result", "refused"]);
    expect(rows.filter(r => r.action === "read_safety_reports").length).toBe(2);
  }, T);

  test("ban by person; dismiss a report", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const cy = newPhone(), di = newPhone();
    for (const [p, who] of [[cy, "Cy, 40"], [di, "Di, 38"]] as const) { await text(s, clock, p, "slop"); await text(s, clock, p, who); }
    const web = site(s, clock, otp), unrelated = site(s, clock, otp);
    await web.login("slop", di);
    await unrelated.login("slop", cy);
    await text(s, clock, cy, "report Di, she asked me for money on venmo");
    await text(s, clock, di, "report Cy, he was rude");
    const q = (await (await staff(s, "saf-tok", "GET", "/apps/slop/safety/reports")).json() as any).reports as any[];
    const aboutCy = q.find(r => r.kind === "harassment")!, aboutDi = q.find(r => r.kind === "scam")!;
    expect((await staff(s, "saf-tok", "POST", "/apps/slop/safety/dismiss", { reportId: aboutCy.id, note: "a retaliation report" })).status).toBe(200);
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/dismiss", { reportId: "nope", note: "no such report" })).json()).toEqual({ ok: false, reason: "unknown_report" });
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: aboutDi.subjectId, by: "person", note: "scam confirmed" })).json()).toEqual({ ok: true });
    expect((await sql`select scope from platform.bans`).map((r: any) => r.scope)).toEqual(["person"]);
    // spec/webSession.md, "Only a live token on the requested app can authenticate"
    expect((await web.json("slop", "GET", "/api/me")).status).toBe(401);
    expect((await unrelated.json("slop", "GET", "/api/me")).status).toBe(200);
    expect(await text(s, clock, di, "friends")).toBe("held");
  }, T);

  test("forget: a report or a minor report names neither party in network.events after that party leaves", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const names = async (id: string) => ((await sql`select type from network.events where app_id = 'slop' and (actor_id = ${id} or object_id = ${id} or position(${id} in payload::text) > 0)`) as any[]).map(r => r.type);
    const [ana, ben, cy, di] = [newPhone(), newPhone(), newPhone(), newPhone()];
    for (const [p, who] of [[ana, "Ana, 30"], [ben, "Ben, 32"], [cy, "Cy, 29"], [di, "Di, 31"]] as const) { await text(s, clock, p, "slop"); await text(s, clock, p, who); }
    const b = (await memberOf("slop", ben))!.id, c = (await memberOf("slop", cy))!.id;
    // The reported member leaves: the report_received row (payload.target) goes with them.
    expect(await text(s, clock, ana, "report Ben, he was rude and kept texting me")).toBe("handled");
    expect(await names(b)).toContain("report_received");
    expect(await text(s, clock, ben, "leave slop.date")).toBe("left");
    expect(await names(b)).toEqual([]);
    // The reporter of a minor report leaves: the minor_reported row (payload.by) goes with them.
    expect(await text(s, clock, cy, "report Di, she's only 15")).toBe("handled");
    expect(await names(c)).toContain("minor_reported");
    expect(await text(s, clock, cy, "leave slop.date")).toBe("left");
    expect(await names(c)).toEqual([]);
  }, T);

  test("minor clear: one staff action clears the signal on every app and dismisses the minor reports; audited; refused while any age says minor", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const web = site(s, clock, otp);
    const gil = newPhone(), hal = newPhone();
    for (const [p, who] of [[gil, "Gil, 31"], [hal, "Hal, 34"]] as const) { await text(s, clock, p, "slop"); await text(s, clock, p, who); }
    await web.login("friends", hal);
    expect((await web.join("friends", 34, "Hal")).status).toBe(200);
    // A wrong report: Hal is 34 by his own record.
    expect(await text(s, clock, gil, "report Hal, he's only 15")).toBe("handled");
    const h = (await memberOf("slop", hal))!.id;
    const minorReport = async () => s.runtimeFor("slop")!.readState(n => n.safetyReports().find(r => r.kind === "minor" && r.subjectId === h));
    // The minor report is a product event about Hal (out of matching until staff review).
    expect((await sql`select object_id, payload from network.events where app_id = 'slop' and type = 'minor_reported'`).map((r: any) => [r.object_id, r.payload.memberId])).toEqual([[h, h]]);
    expect((await minorReport())?.status).toBe("open");
    expect(await s.runtimeFor("slop")!.readState(n => n.safetyCases().some(c => c.memberId === h && c.events.some(e => e.kind === "minor_reported")))).toBe(true);

    expect((await staff(s, "rev-tok", "POST", "/apps/slop/safety/clear-minor", { memberId: h, note: "record says 34" })).status).toBe(403);
    expect((await staff(s, "saf-tok", "POST", "/apps/slop/safety/clear-minor", { memberId: h, note: "x" })).status).toBe(400);
    const res = await staff(s, "saf-tok", "POST", "/apps/slop/safety/clear-minor", { memberId: h, note: "record says 34; wrong report" });
    const out = await res.json() as any;
    expect([res.status, out.ok]).toEqual([200, true]);
    expect(Object.fromEntries((out.apps as { app: string; result: string }[]).map(a => [a.app, a.result]))).toEqual({ slop: "cleared", friends: "no_signal" });
    expect((await minorReport())?.status).toBe("dismissed");
    // Nothing left to clear.
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/clear-minor", { memberId: h, note: "again, by mistake" })).json()).toMatchObject({ ok: false, reason: "no_signal" });

    // A member whose own age is 16 stays a minor: the clear is refused.
    const ivy = newPhone();
    await text(s, clock, ivy, "slop"); await text(s, clock, ivy, "Ivy, 16");
    const i = (await memberOf("slop", ivy))!.id;
    const refused = await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/clear-minor", { memberId: i, note: "trying to clear a minor" })).json() as any;
    expect(refused.ok).toBe(false);
    expect(["stated_minor", "record_minor"]).toContain(refused.reason);

    const rows = (await sql`select detail->>'phase' as phase, ok from network.staff_audit where action = 'safety' and detail->>'safety' = 'clear_minor' order by id`) as any[];
    expect(rows.map(r => `${r.phase}:${r.ok}`)).toEqual(["requested:true", "result:true", "requested:true", "result:false", "requested:true", "result:false"]);
  }, T);

  test("the console's client (observatory ServiceClient) reads the queue and acts through these routes; the signed-in person is the actor", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock, { tokens: "admin:adm-tok,safety:saf-tok,admin:console-token-0123456789abcdef0123", consoleToken: "console-token-0123456789abcdef0123" });
    const srv = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: req => s.fetch(req) });
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
    } finally { await srv.stop(true); }
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
    // The photo consent says safety looks only after a report: with no open report or safety case about the member, no link (refused and audited).
    expect(await (await staff(s, "saf-tok", "GET", `/apps/slop/members/${a}/photos`, undefined, { "x-network-reason": "just curious" })).json()).toEqual({ ok: false, reason: "no_report" });
    // A staff hold opens a safety case about each of them.
    for (const id of [k, a]) expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/hold", { memberId: id, note: "report review" })).json()).toEqual({ ok: true });
    expect(await (await staff(s, "saf-tok", "GET", `/apps/slop/members/${k}/photos`, undefined, { "x-network-reason": "report review" })).json()).toEqual({ ok: false, reason: "adults_only" });

    // Staff read: a reason is required; the audit row comes before the link.
    expect((await staff(s, "saf-tok", "GET", `/apps/slop/members/${a}/photos`)).status).toBe(400);
    expect((await staff(s, "rev-tok", "GET", `/apps/slop/members/${a}/photos`, undefined, { "x-network-reason": "report review" })).status).toBe(403);
    const r = await (await staff(s, "saf-tok", "GET", `/apps/slop/members/${a}/photos`, undefined, { "x-network-reason": "report review" })).json() as any;
    expect(r.photos).toHaveLength(1);
    expect(r.photos[0].url).toMatch(/^https:\/\/slop\.date\/api\/photos\/view\//);
    const audit = (await sql`select target_id, detail->>'phase' as phase, ok from network.staff_audit where action = 'read_photos' order by id`) as any[];
    expect(audit.map(x => [x.target_id, x.phase, x.ok])).toEqual([[a, "refused", false], [k, "requested", true], [k, "result", false], [a, "requested", true], [a, "result", true]]);
    expect((await sql`select detail->>'caseId' as c from network.staff_audit where action = 'read_photos' and target_id = ${a} and detail->>'phase' = 'requested'`)[0].c).toBeTruthy();
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
  // spec/photoRating.md, "Write only after the returned score passes a fresh authority check"
  test("the private member rating follows the latest photos and clears on failed age or a minor age in any app", async () => {
    await fresh();
    const dir = mkdtempSync(join(tmpdir(), "svc-ratings-")); dirs.push(dir);
    const clock = new SimClock(START);
    const ratedPhotoCounts: number[] = [];
    let markFirstRatingStarted!: () => void;
    let finishFirstRating!: () => void;
    const firstRatingStarted = new Promise<void>(resolve => { markFirstRatingStarted = resolve; });
    const waitForFirstRating = new Promise<void>(resolve => { finishFirstRating = resolve; });
    const rater: PhotoRater = { id: "fake", rate: async (_subject, photos) => {
      ratedPhotoCounts.push(photos.length);
      if (ratedPhotoCounts.length === 1) {
        markFirstRatingStarted();
        await waitForFirstRating;
      }
      return { face: 0.5, body: 0.5, overall: photos.length > 1 ? 0.7 : 0.5, confidence: 0.9, model: "fake" };
    } };
    const { s, otp } = service(clock, { photoStorage: new LocalDiskPhotoStorage(dir), photoRater: rater });
    const web = site(s, clock, otp);
    const ana = newPhone();
    await web.login("slop", ana);
    expect((await web.join("slop", 30, "Ana")).status).toBe(200);
    const a = (await memberOf("slop", ana))!.id;
    const upload = async () => (await (await web.call("slop", "POST", "/api/photos", jpeg() as unknown as BodyInit, { "content-type": "image/jpeg", "x-photo-consent": PHOTO_CONSENT.version })).json()) as { ok: boolean; id: string };
    const ratings = async () => (await sql`select count(*)::int as n from network.facets where member_id = ${a} and id = ${`${a}:appearance`}`)[0].n as number;
    const pending = upload();
    let second: Awaited<ReturnType<typeof upload>>;
    const ratingVersion = () => sql`select xmin::text as write_version, tags from network.facets where id=${`${a}:appearance`}`;
    let completedVersion: Awaited<ReturnType<typeof ratingVersion>>;
    try {
      await firstRatingStarted;
      clock.advance(MINUTE);
      second = await upload();
      completedVersion = await ratingVersion();
      expect(completedVersion).toHaveLength(1);
    } finally {
      finishFirstRating();
    }
    const first = await pending;
    expect(await ratingVersion()).toEqual(completedVersion);
    expect(ratedPhotoCounts).toEqual([1, 2]);
    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(await ratings()).toBe(1);
    // Deleting one photo recomputes the one private member rating from the remaining photo.
    expect((await web.json("slop", "POST", "/api/photos/delete", { id: first.id })).status).toBe(200);
    expect(await ratings()).toBe(1);
    expect(ratedPhotoCounts).toEqual([1, 2, 1]);
    expect((await sql`select privacy_scope from network.facets where id = ${`${a}:appearance`}`)[0].privacy_scope).toBe("agent_private");
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
    const calls = ratedPhotoCounts.length;
    expect((await upload()).ok).toBe(false);
    expect(ratedPhotoCounts).toHaveLength(calls);
  }, T);
  test("friends: a member staff verified (liveness and age passed, the tags the verify route writes) is verified for the friends pack; a failed or missing check is not", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const web = site(s, clock, otp);
    const ids: string[] = [];
    for (const [i, name] of ["Ari", "Bo"].entries()) {
      web.forget("friends");
      const phone = newPhone();
      await web.login("friends", phone);
      expect((await web.join("friends", 30 + i, name)).status).toBe(200);
      ids.push((await memberOf("friends", phone))!.id);
    }
    const [ari, bo] = ids as [string, string];
    const verified = async () => {
      const w = new World(await loadSnapshot(sql, clock.now(), { app: "friends", city: "nyc" }), resolveConfig({ seed: 1 }), localEmbed, friendsPack);
      return Object.fromEntries(ids.map(id => [id, friendsInfo(w).get(id)?.verified ?? null]));
    };
    expect(await verified()).toEqual({ [ari]: false, [bo]: false });
    for (const [id, check, result] of [[ari, "liveness", "pass"], [ari, "age", "pass"], [bo, "liveness", "pass"], [bo, "age", "fail"]] as const) {
      expect(await (await staff(s, "saf-tok", "POST", `/apps/friends/members/${id}/verify`, { check, result, note: "staff review" })).json()).toEqual({ ok: true });
    }
    expect(await verified()).toEqual({ [ari]: true, [bo]: false });
  }, T);

  // spec/travelPresence.md, "Use my travel dates for matching"
  test("friends matching uses bounded trips and drops them at the end", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const web = site(s, clock, otp);
    const phone = newPhone();
    await web.login("friends", phone);
    expect((await web.join("friends", 30, "Ari")).status).toBe(200);
    const id = (await memberOf("friends", phone))!.id;
    const now = clock.now(), from = now + HOUR, to = now + 2 * HOUR, end = now + 3 * HOUR;
    await sql`insert into network.presence (app_id, member_id, city, type, from_at, to_at) values
      ('friends', ${id}, 'sf', 'temporary', ${new Date(from)}, ${new Date(to)}),
      ('friends', ${id}, 'la', 'temporary', ${new Date(now - HOUR)}, ${new Date(now)}),
      ('friends', ${id}, 'la', 'temporary', null, null),
      ('friends', ${id}, 'la', 'temporary', ${new Date(to)}, ${new Date(from)})`;

    const snapshot = await loadSnapshot(sql, now, { app: "friends", city: "sf" });
    expect(snapshot.members.map(m => m.id)).toEqual([id]);
    expect(snapshot.presence.filter(p => p.type === "temporary").map(p => [p.city, p.from, p.to])).toEqual([["sf", from, to]]);
    const world = new World(snapshot, resolveConfig({ seed: 1 }), localEmbed, friendsPack);
    expect([...world.location(id, now, end)]).toEqual([["nyc", [[now, from], [to, end]]], ["sf", [[from, to]]]]);
    expect(presentInNyc(snapshot, id, now, from)).toBe(true);
    expect(presentInNyc(snapshot, id, from, to)).toBe(false);
    expect(presentInNyc(snapshot, id, to, end)).toBe(true);
    expect((await loadSnapshot(sql, to, { app: "friends", city: "sf" })).members).toEqual([]);
    expect((await loadSnapshot(sql, to, { app: "friends", city: "sf", homeCities: ["nyc"] })).members.map(m => m.id)).toEqual([id]);
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

  test("scoped staff holds survive leave, restart and rejoin until an authorized app lift", async () => {
    // spec/staffSafetyService.md, "A staff hold survives ordinary app membership changes"
    await fresh();
    const clock = new SimClock(START);
    const tokens = "safety@peon:peon-safety-tok,safety@slop:slop-safety-tok,safety:saf-tok";
    const initial = service(clock, { tokens });
    const phone = newPhone();
    let web = site(initial.s, clock, initial.otp);
    await web.login("slop", phone);
    expect((await web.join("slop", 30, "Ari")).status).toBe(200);
    await web.login("peon", phone);
    expect((await web.join("peon", 30, "Ari")).status).toBe(200);
    const former = (await memberOf("peon", phone))!.id;
    const slopId = (await memberOf("slop", phone))!.id;
    const status = async (app: AppId, id: string) => {
      const snapshot = await loadSnapshot(sql, clock.now(), { app });
      return (snapshot.members.find(member => member.id === id) as { accountStatus: string } | undefined)?.accountStatus;
    };
    expect(await (await staff(initial.s, "peon-safety-tok", "POST", "/apps/peon/safety/hold", { memberId: former, note: "local safety review" })).json()).toEqual({ ok: true });
    expect(await status("peon", former)).toBe("restricted");
    expect(await status("slop", slopId)).toBe("active");
    expect(await text(initial.s, clock, phone, "leave peon.biz")).toBe("left");
    expect(await memberOf("peon", phone)).toBeUndefined();
    await initial.s.close();

    const restarted = service(clock, { tokens });
    await restarted.s.start();
    web = site(restarted.s, clock, restarted.otp);
    await web.login("peon", phone);
    expect((await web.join("peon", 30, "Ari")).status).toBe(200);
    const current = (await memberOf("peon", phone))!.id;
    expect(current).not.toBe(former);
    expect(await status("peon", current)).toBe("restricted");
    const [serviceProjection] = await sql.begin(async tx => {
      await tx`set local role network_service`;
      await tx`select set_config('app.app_id','peon',true)`;
      return tx`select staff_held from platform.matching_ages where app_id='peon' and member_id=${current}`;
    });
    expect(serviceProjection).toEqual({ staff_held: true });
    const lift = (app: AppId, token: string, memberId: string) => staff(restarted.s, token, "POST", `/apps/${app}/safety/lift`, { memberId, note: "staff resolved review" });
    expect(await (await lift("peon", "peon-safety-tok", current)).json()).toEqual({ ok: true });
    expect(await status("peon", current)).toBe("active");

    expect(await (await staff(restarted.s, "saf-tok", "POST", "/apps/peon/safety/hold", { memberId: current, note: "global safety review" })).json()).toEqual({ ok: true });
    expect(await (await lift("peon", "peon-safety-tok", current)).json()).toEqual({ ok: false, reason: "needs_safety_everywhere" });
    expect(await status("peon", current)).toBe("restricted");
    expect(await (await lift("peon", "saf-tok", current)).json()).toEqual({ ok: true });
    expect(await status("peon", current)).toBe("active");
    expect(await status("slop", slopId)).toBe("restricted");
    expect(await (await lift("slop", "slop-safety-tok", slopId)).json()).toEqual({ ok: false, reason: "needs_safety_everywhere" });

    clock.advance(HOUR);
    await web.login("friends", phone);
    expect((await web.join("friends", 30, "Ari")).status).toBe(200);
    const friendsId = (await memberOf("friends", phone))!.id;
    expect(await status("friends", friendsId)).toBe("restricted");
    expect(await (await lift("friends", "saf-tok", friendsId)).json()).toEqual({ ok: true });
    expect(await status("friends", friendsId)).toBe("active");
    expect(await status("slop", slopId)).toBe("restricted");

    const person = (await restarted.s.accounts.personFor(phone))!;
    expect(await sql`select app_id from platform.staff_safety_holds where person_id=${person.id}`).toEqual([{ app_id: null }]);
    expect(await restarted.s.accounts.deleteAll({ e164: phone, personId: person.id })).toBe(true);
    expect(await sql`select app_id from platform.staff_safety_holds where person_id=${person.id}`).toEqual([]);
  }, T);

  test("an automatic hard hold committed after leave admission survives the atomic forget", async () => {
    // spec/staffSafetyService.md, "A committed trust hold follows the person through ordinary app leave"
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock, { tokens: "safety@peon:peon-safety-tok" });
    const web = site(s, clock, otp);
    const phone = newPhone(), watchPhone = newPhone();
    for (const [app, e164, name] of [["slop", phone, "Ari"], ["peon", phone, "Ari"], ["peon", watchPhone, "Blair"]] as const) {
      await web.login(app, e164);
      expect((await web.join(app, 30, name)).status).toBe(200);
    }
    const person = (await s.accounts.personFor(phone))!;
    const watchPerson = (await s.accounts.personFor(watchPhone))!;
    const former = (await memberOf("peon", phone))!.id;
    const watchId = (await memberOf("peon", watchPhone))!.id;
    const slop = (await memberOf("slop", phone))!.id;
    const rt = s.runtimeFor("peon")!;
    await rt.unitOfWork(n => {
      for (const id of [former, watchId]) n.trust.add(id, clock.now(), "block_abuse", WATCH);
    });

    const beginAppLeave = s.people.beginAppLeave.bind(s.people);
    s.people.beginAppLeave = async request => {
      const admission = await beginAppLeave(request);
      if (admission.ok && admission.membership?.memberId === former) await rt.unitOfWork(n => {
        // The simulator supplies committed report evidence between the consent write and runtime forget.
        expect(n.trust.report(former, "fixture-counterpart", clock.now(), { met: true })).toBeGreaterThan(0);
        expect(n.trust.level(former)).toBe("hold");
      });
      return admission;
    };
    try {
      expect(await text(s, clock, phone, "leave peon.biz")).toBe("left");
    } finally {
      s.people.beginAppLeave = beginAppLeave;
    }
    expect(await text(s, clock, watchPhone, "leave peon.biz")).toBe("left");
    expect(await sql`select app_id from platform.staff_safety_holds where person_id=${person.id}`).toEqual([{ app_id: "peon" }]);
    expect(await sql`select origin from platform.staff_safety_holds where person_id=${person.id}`).toEqual([{ origin: "automatic_carryover" }]);
    expect(await sql`select app_id from platform.staff_safety_holds where person_id=${watchPerson.id}`).toEqual([]);
    expect(await memberOf("peon", phone)).toBeUndefined();

    await web.login("peon", phone);
    expect((await web.join("peon", 30, "Ari")).status).toBe(200);
    const current = (await memberOf("peon", phone))!.id;
    expect(current).not.toBe(former);
    expect(await sql`select app_id,staff_held from platform.matching_ages where member_id in (${current},${slop}) order by app_id`)
      .toEqual([{ app_id: "peon", staff_held: true }, { app_id: "slop", staff_held: false }]);
    const lifted = await staff(s, "peon-safety-tok", "POST", "/apps/peon/safety/lift", { memberId: current, note: "staff resolved review" });
    expect(await lifted.json()).toEqual({ ok: true });
    expect(await sql`select app_id from platform.staff_safety_holds where person_id=${person.id}`).toEqual([]);
    expect(await sql`select staff_held from platform.matching_ages where app_id='peon' and member_id=${current}`).toEqual([{ staff_held: false }]);
  }, T);

  test.each(["staff review", "account erasure"] as const)("an open report follows ordinary app leave until %s", async disposition => {
    // spec/safetyCase.md, "The exact open report follows its subject through ordinary app leave"
    await fresh();
    const clock = new SimClock(START);
    const tokens = "safety:saf-tok,safety@friends:friends-safety-tok";
    const delivered: SendRequest[] = [];
    const options: Partial<ServiceOptions> = { tokens,
      adapter: (_net, runtime) => runtime.app.id !== "friends" ? new DryRunAdapter(() => {}) : new BlooioAdapter({
        app: "friends", city: "nyc", from: "+12125550199", clock, liveGate: () => true, log: () => {},
        provider: { kind: "sim", send: async request => {
          delivered.push(request);
          return { providerMessageId: `report-carryover:${request.idempotencyKey}`, status: "sent" };
        } },
      }),
    };
    const { s, otp } = service(clock, options);
    const web = site(s, clock, otp);
    const subjectPhone = newPhone(), reporterPhone = newPhone(), peerPhone = newPhone();
    for (const [app, phone, name] of [["friends", subjectPhone, "Ari"], ["slop", subjectPhone, "Ari"],
      ["friends", reporterPhone, "Blair"], ["friends", peerPhone, "Casey"]] as const) {
      await web.login(app, phone);
      expect((await web.join(app, 30, name)).status).toBe(200);
    }
    const person = (await s.accounts.personFor(subjectPhone))!;
    const former = (await memberOf("friends", subjectPhone))!.id;
    const reporter = (await memberOf("friends", reporterPhone))!.id;
    const otherApp = (await memberOf("slop", subjectPhone))!.id;
    const rt = s.runtimeFor("friends")!;
    const bookedPair = async (first: string, second: string, otherName: string) => {
      const world = new Mini([{ id: first, name: "Ari", age: 30, area: "Greenpoint", interests: ["hiking"] },
        { id: second, name: otherName, age: 30, area: "Greenpoint", interests: ["hiking"] }],
        { app: "friends", review: "auto", plans: false, growth: false });
      world.clock.set(clock.now());
      await world.onboard(first, second);
      const opportunityId = world.propose([first, second]);
      await world.answerProbes([first, second]);
      const state = world.net.exportState();
      const opportunity = state.opps.find(candidate => candidate.id === opportunityId)!;
      expect(opportunity.stage).toBe("scheduled");
      return { state, opportunity };
    };
    const booked = await bookedPair(former, reporter, "Blair");
    await rt.unitOfWork(net => net.importState({ ...net.exportState(), members: booked.state.members, opps: booked.state.opps }));
    expect(await text(s, clock, reporterPhone, "report Ari, he was rude and kept texting me")).toBe("handled");
    expect(await text(s, clock, reporterPhone, "report Ari, he never showed up")).toBe("handled");
    expect(await rt.readState(net => net.trust.level(former))).toBe("ok");
    const beginLeave = s.people.beginAppLeave.bind(s.people);
    s.people.beginAppLeave = async input => {
      const admission = await beginLeave(input);
      if (admission.ok && admission.membership?.memberId === former) {
        expect(await text(s, clock, reporterPhone, "report Ari, he asked me for money")).toBe("handled");
      }
      return admission;
    };
    try {
      expect(await text(s, clock, subjectPhone, "leave friends.help")).toBe("left");
    } finally { s.people.beginAppLeave = beginLeave; }
    const reports = (await rt.pg.load())!.reports!.filter(report => report.subjectId === former);
    expect(reports.map(report => [report.kind, report.met])).toEqual([["harassment", true], ["no_show", true], ["scam", true]]);
    const harassment = reports[0]!.id, scam = reports[2]!.id;
    const carryovers = () => sql`select app_id,origin_runtime_id,report_id from platform.report_safety_carryovers
      where person_id=${person.id} order by report_id`;
    expect(await carryovers()).toEqual([harassment, scam].map(report_id => ({ app_id: "friends", origin_runtime_id: "friends:nyc", report_id })));
    expect(await sql`select origin from platform.staff_safety_holds where person_id=${person.id}`).toEqual([]);
    expect(await memberOf("friends", subjectPhone)).toBeUndefined();
    await s.close();

    const restarted = service(clock, options);
    await restarted.s.start();
    if (disposition === "account erasure") {
      expect(await restarted.s.accounts.deleteAll({ e164: subjectPhone, personId: person.id })).toBe(true);
      expect(await carryovers()).toEqual([]);
      return;
    }
    const browser = site(restarted.s, clock, restarted.otp);
    await browser.login("friends", subjectPhone);
    expect((await browser.join("friends", 30, "Ari")).status).toBe(200);
    const current = (await memberOf("friends", subjectPhone))!.id;
    expect(current).not.toBe(former);
    const status = () => sql`select app_id,staff_held,report_held from platform.matching_ages
      where member_id in (${current},${otherApp}) order by app_id`;
    const other = { app_id: "slop", staff_held: false, report_held: false };
    expect(await status()).toEqual([{ app_id: "friends", staff_held: false, report_held: true }, other]);
    const active = restarted.s.runtimeFor("friends")!, adapter = active.adapter as BlooioAdapter;
    const peer = (await memberOf("friends", peerPhone))!.id;
    await sql`update network.members set prefs=prefs || ${{ quietHours: [0, 0] }}::jsonb where app_id='friends'`;
    const queueBookingReply = async (id: string) => {
      const next = await bookedPair(current, peer, "Casey");
      clock.set(next.opportunity.meetingAt! - 2 * HOUR);
      await adapter.engaged(peerPhone);
      await active.unitOfWork(net => {
        net.importState({ ...net.exportState(), members: next.state.members, opps: next.state.opps });
        // A causal reply can pass the recipient preflight. The locked claim also checks the roster.
        active.unit.sends.push({ id, memberId: peer, to: peerPhone, kind: "reply", type: "proposal", oppId: next.opportunity.id,
          bookingRoster: next.opportunity.participants, body: "Your meeting at the park is booked.", proactive: false, system: false, ts: clock.now() });
      });
    };
    await adapter.lineSafety("review");
    const messageId = "report-carryover-booking-fixture";
    await queueBookingReply(messageId);
    expect(await adapter.queue.statusOf(messageId)).toBe("retry_scheduled");
    await adapter.lineSafety(undefined);
    clock.advance(HOUR);
    await adapter.engaged(peerPhone);
    await active.deliver();
    expect(await sql`select status,note,attempts from platform.outbound where id=${messageId}`)
      .toEqual([{ status: "suppressed_ineligible", note: null, attempts: 0 }]);
    expect(delivered.some(request => request.idempotencyKey === `tn:${messageId}`)).toBe(false);

    const decide = async (action: string, body: object, app: AppId = "friends", token = "friends-safety-tok") =>
      (await staff(restarted.s, token, "POST", `/apps/${app}/safety/${action}`, { ...body, note: "staff reviewed the report" })).json();
    expect(await decide("dismiss", { reportId: harassment }, "slop", "saf-tok")).toEqual({ ok: false, reason: "unknown_report" });
    expect(await decide("hold", { memberId: former })).toEqual({ ok: false, reason: "unknown_member" });
    expect(await decide("ban", { memberId: former, reportId: harassment, by: "person" }, "friends", "saf-tok"))
      .toEqual({ ok: false, reason: "no_person" });
    expect(await decide("hold", { memberId: current, reportId: harassment })).toEqual({ ok: false, reason: "unknown_report" });
    expect(await decide("hold", { memberId: former, reportId: scam })).toEqual({ ok: true });
    expect(await status()).toEqual([{ app_id: "friends", staff_held: true, report_held: true }, other]);
    expect(await decide("lift", { memberId: current })).toEqual({ ok: true });
    expect(await status()).toEqual([{ app_id: "friends", staff_held: false, report_held: true }, other]);
    expect(await decide("dismiss", { reportId: harassment })).toEqual({ ok: true });
    expect(await decide("dismiss", { reportId: harassment })).toEqual({ ok: false, reason: "already_dismissed" });
    expect(await carryovers()).toEqual([]);
    expect(await status()).toEqual([{ app_id: "friends", staff_held: false, report_held: false }, other]);
    const clearedId = "report-carryover-cleared-booking-fixture";
    await queueBookingReply(clearedId);
    expect(await adapter.queue.statusOf(clearedId)).toBe("sent");
    expect(delivered.some(request => request.idempotencyKey === `tn:${clearedId}`)).toBe(true);
  }, T);

  test.each(["hold", "ban"] as const)("a committed global %s stops queued peer delivery while a related runtime is still waiting", async decision => {
    // spec/outboundAdmission.md, "Recheck blocks between the participants before contact"
    await fresh();
    const clock = new SimClock(START);
    const delivered: SendRequest[] = [];
    const { s, otp } = service(clock, {
      adapter: (_net, runtime) => runtime.app.id !== "friends" ? new DryRunAdapter(() => {}) : new BlooioAdapter({
        app: "friends", city: "nyc", from: "+12125550199", clock, liveGate: () => true, log: () => {},
        provider: { kind: "sim", send: async request => {
          delivered.push(request);
          return { providerMessageId: `safety-fixture:${request.idempotencyKey}`, status: "sent" };
        } },
      }),
    });
    const phone = newPhone(), recipientPhone = newPhone();
    const web = site(s, clock, otp);
    for (const [app, e164, name] of [["slop", phone, "Ari"], ["friends", phone, "Ari"], ["friends", recipientPhone, "Blair"]] as const) {
      await web.login(app, e164);
      expect((await web.join(app, 30, name)).status).toBe(200);
    }
    const slopId = (await memberOf("slop", phone))!.id;
    const peerId = (await memberOf("friends", phone))!.id, recipient = (await memberOf("friends", recipientPhone))!.id;
    const rt = s.runtimeFor("friends")!;
    const adapter = rt.adapter as BlooioAdapter;
    const world = new Mini([{ id: peerId, name: "Ari", age: 30, area: "Greenpoint", interests: ["hiking"] },
      { id: recipient, name: "Blair", age: 30, area: "Greenpoint", interests: ["hiking"] }],
      { app: "friends", review: "auto", plans: false, growth: false });
    world.clock.set(clock.now());
    await world.onboard(peerId, recipient);
    const opportunityId = world.propose([peerId, recipient]);
    await world.answerProbes([peerId, recipient]);
    const ready = world.net.exportState();
    const booked = ready.opps.find(opportunity => opportunity.id === opportunityId)!;
    expect(booked.stage).toBe("scheduled");
    clock.set(booked.meetingAt! - 2 * HOUR);
    await sql`update network.members set prefs=prefs || ${{ quietHours: [0, 0] }}::jsonb where app_id='friends'`;
    await adapter.engaged(recipientPhone);
    await adapter.lineSafety("review");
    const notice = "staff-restriction-queued-booking-fixture";
    await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: ready.members, opps: ready.opps });
      rt.unit.sends.push({ id: notice, memberId: recipient, to: recipientPhone, kind: "transactional", type: "proposal",
        oppId: opportunityId, body: "Your meeting at the park is booked.", proactive: false, system: false, ts: clock.now() });
    });
    expect(await adapter.queue.statusOf(notice)).toBe("retry_scheduled");

    let encountered!: () => void, resume!: () => void;
    const pendingProjection = new Promise<void>(resolve => { encountered = resolve; });
    const allowProjection = new Promise<void>(resolve => { resume = resolve; });
    const unit = rt.unitOfWork.bind(rt);
    rt.unitOfWork = async (fn, scheduling) => {
      encountered();
      await allowProjection;
      return unit(fn, scheduling);
    };
    const applying = staff(s, "saf-tok", "POST", `/apps/slop/safety/${decision}`, {
      memberId: slopId, note: "reviewed global restriction", ...(decision === "ban" ? { by: "person" } : {}),
    });
    try {
      await Promise.race([pendingProjection, applying.then(() => { throw new Error("The restriction did not reach the related runtime"); })]);
      expect((await rt.pg.load())!.trust?.find(entry => entry.id === peerId)?.level).not.toBe("hold");
      await adapter.lineSafety(undefined);
      clock.advance(HOUR);
      await rt.deliver();
      expect(await adapter.queue.statusOf(notice)).toBe("suppressed_ineligible");
      expect(delivered.some(call => call.idempotencyKey === `tn:${notice}`)).toBe(false);
    } finally {
      resume();
      expect(await (await applying).json()).toEqual({ ok: true });
      rt.unitOfWork = unit;
    }
  }, T);
});
