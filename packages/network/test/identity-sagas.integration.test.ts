// The identity sagas (docs/research/quint-findings/identity_sagas.md): ban, leave, the staff decision on a
// held number, and the writes that race with them. Each test stops a saga between two of its steps (the
// process stops after a commit) or runs a staff action between a read and a write, then checks that the
// retry finishes the saga and that no safety state is undone. Real NetworkService, real Postgres in a
// database of its own per test process; dry-run sends; fictional numbers (+1 212 555 02xx).
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { DAY, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { RECYCLED_AFTER_MS } from "../../platform/src/accounts.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { LocalDiskPhotoStorage } from "../../platform/src/photos.ts";
import { DryRunAdapter, type Outbound } from "../service/channel.ts";
import { CloudChannelAdapter } from "../service/cloud-channel.ts";
import { NetworkService, WEBHOOK_PATH, type ServiceOptions } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_identity_sagas_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_sagas";
const NETS = [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }, { id: "peon:nyc" }, { id: "friends:nyc" }];
let phoneSeq = 0;
const newPhone = () => `+121255502${String(++phoneSeq).padStart(2, "0")}`;

let sql: SQL;
const open: NetworkService[] = [];
function service(clock: SimClock, more: Partial<ServiceOptions> = {}) {
  const s = new NetworkService({
    url: URL_, clock, instance: "sagas", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,safety:saf-tok", webhookSecret: SECRET,
    network: { seed: 1 }, publicApi: { otp: { name: "fake", send: async () => ({ code: "123456" }) }, minStartMs: 0, minVerifyMs: 0 }, photoStorage: null,
    adapter: () => new DryRunAdapter(() => {}),
    ...more,
  });
  open.push(s);
  return s;
}

let evt = 0;
/** One text through the signed webhook. Returns the HTTP status and the inbound outcome. */
async function say(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  clock.advance(MINUTE);
  return { status: res.status, result: (await res.json().catch(() => ({})) as { result?: string }).result };
}
async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const r = await say(s, clock, from, body);
  expect(r.status).toBe(200);
  return r.result;
}
const staff = (s: NetworkService, token: string, method: string, path: string, b?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
const memberOf = async (app: AppId, e164: string) =>
  (await sql`select m.id, m.account_status from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string; account_status: string } | undefined;

/**
 * The process stops once, right after `name` commits: the first call runs the real method, then throws.
 * Later calls run normally (the restarted process).
 */
function stopAfter<T extends object>(o: T, name: string) {
  const target = o as Record<string, any>;
  const real = target[name] as (...a: unknown[]) => Promise<unknown>;
  let fired = false;
  target[name] = async (...a: unknown[]) => {
    const r = await real.apply(o, a);
    if (!fired) { fired = true; throw new Error(`process stopped after ${name}`); }
    return r;
  };
  return () => fired;
}

/** The process stops once, right before `name` runs (everything before it committed). */
function stopBefore<T extends object>(o: T, name: string) {
  const target = o as Record<string, any>;
  const real = target[name] as (...a: unknown[]) => Promise<unknown>;
  let fired = false;
  target[name] = async (...a: unknown[]) => {
    if (!fired) { fired = true; throw new Error(`process stopped before ${name}`); }
    return real.apply(o, a);
  };
  return () => fired;
}

/** The slop site's API for one browser (its own session cookie). */
function site(s: NetworkService) {
  let cookie = "";
  return async (path: string, body?: unknown) => {
    // No body: a GET (the export).
    const res = await s.publicFetch(new Request(`http://127.0.0.1:8790${path}`, body === undefined
      ? { method: "GET", headers: { host: "localhost:5102", ...(cookie ? { cookie } : {}) } }
      : { method: "POST", headers: { host: "localhost:5102", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
    const c = res.headers.get("set-cookie"); if (c) cookie = c.split(";")[0]!;
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
}
/** A member of slop on `from` logs in on the site and asks to move to `to` (step 1: the code goes to `to`). Returns the browser. */
async function startMove(s: NetworkService, clock: SimClock, from: string, to: string) {
  const api = site(s);
  clock.advance(31_000);
  expect((await api("/api/auth/otp/start", { phone: from })).status).toBe(200);
  expect((await api("/api/auth/otp/verify", { phone: from, code: "123456" })).status).toBe(200);
  expect((await api("/api/me/phone/start", { phone: to })).body).toEqual({ ok: true });
  return api;
}

describe.skipIf(!pgAvailable)("identity sagas: stop half way, retry, races (Postgres)", () => {
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
  });
  const fresh = async () => { await applySchema(URL_, { reset: true, lockTimeout: "5s" }); };

  test("SD-005: a ban that stops after its ban rows is finished by the retry, not refused as already_banned", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const ben = newPhone();
    expect(await text(s, clock, ben, "slop")).toBe("join_asked");
    expect(await text(s, clock, ben, "Ben, 32")).toBe("joined");
    const b = (await memberOf("slop", ben))!.id;

    // The process stops after the first ban row commits (before suppression, memberships and the Network).
    const fired = stopAfter(s.people, "ban");
    expect((await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: b, by: "person", note: "scam confirmed" })).status).toBeGreaterThanOrEqual(500);
    expect(fired()).toBe(true);
    expect((await sql`select count(*)::int as n from platform.bans`)[0].n).toBe(1);

    // Staff retry: the ban finishes.
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: b, by: "person", note: "scam confirmed" })).json()).toEqual({ ok: true });
    expect((await sql`select count(*)::int as n from platform.bans`)[0].n).toBe(1);
    expect((await sql`select state from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id where ph.e164 = ${ben}`).map((r: any) => r.state)).toEqual(["restricted"]);
    expect((await memberOf("slop", ben))!.account_status).toBe("restricted");
    expect((await sql`select count(*)::int as n from platform.suppression where reason = 'banned'`)[0].n).toBe(1);
    // A third request has nothing left to do: refused as already_banned.
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: b, by: "person", note: "scam confirmed" })).json()).toEqual({ ok: false, reason: "already_banned" });
  }, T);

  /** A member of slop whose number then goes silent for over a year and is texted by its next holder: on hold. */
  async function heldNumber(s: NetworkService, clock: SimClock) {
    const phone = newPhone();
    expect(await text(s, clock, phone, "slop")).toBe("join_asked");
    expect(await text(s, clock, phone, "Ana, 30")).toBe("joined");
    const old = (await sql`select person_id from platform.phone_identities where e164 = ${phone}`)[0]!.person_id as string;
    clock.advance(RECYCLED_AFTER_MS + DAY);
    return { phone, old };
  }

  test("SD-016: a new_owner decision that stops after the delete still leaves the number clean; the next holder is a new person", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const { phone, old } = await heldNumber(s, clock);
    expect(await text(s, clock, phone, "hi, who is this?")).toBe("held");

    // The process stops right after the delete commits.
    const fired = stopAfter(s.people, "deleteAll");
    expect((await staff(s, "adm-tok", "POST", "/apps/slop/holds", { phone, decision: "new_owner" })).status).toBeGreaterThanOrEqual(500);
    expect(fired()).toBe(true);
    // The retry (the number is no longer held, so there is nothing to decide).
    await staff(s, "adm-tok", "POST", "/apps/slop/holds", { phone, decision: "new_owner" });

    // The number starts clean: no suppression, no age floor, and the old tombstone no longer carries its hash.
    const hash = s.accounts.phoneHash(phone);
    expect((await sql`select count(*)::int as n from platform.suppression where phone_hash = ${hash}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from platform.age_floor where phone_hash = ${hash}`)[0].n).toBe(0);
    expect((await sql`select phone_hash from platform.people where id = ${old}::uuid`)[0].phone_hash).toBeNull();
    // The next holder joins as a new person: the old owner's tombstone (and its blocks) is never revived.
    expect(await text(s, clock, phone, "slop")).toBe("join_asked");
    expect(await text(s, clock, phone, "Bo, 29")).toBe("joined");
    const now = (await sql`select person_id from platform.phone_identities where e164 = ${phone}`)[0]!.person_id as string;
    expect(now).not.toBe(old);
    expect((await sql`select deleted_at is not null as gone from platform.people where id = ${old}::uuid`)[0].gone).toBe(true);
  }, T);

  test("SD-051: a new_owner decision keeps the STOP that the number's new holder sent", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const { phone } = await heldNumber(s, clock);
    // The new holder's first text is STOP (it always works, also on a stale number); the next one puts the number on hold.
    expect(await text(s, clock, phone, "STOP")).toBe("handled");
    expect(await text(s, clock, phone, "who is this?")).toBe("held");
    expect(await (await staff(s, "adm-tok", "POST", "/apps/slop/holds", { phone, decision: "new_owner" })).json()).toEqual({ ok: true });

    // The old owner's account is gone, but the holder's STOP still refuses every send that is not a compliance text
    // (a staff invite is transactional).
    const rt = s.runtimeFor("slop")!;
    const send: Outbound = { id: "invite_1", memberId: "slop_nobody", to: phone, body: "x", kind: "transactional", proactive: false, system: false, ts: clock.now() };
    expect([...(await s.consentRefused(rt, [send]))]).toEqual(["invite_1"]);
  }, T);

  test("SD-029: a text leave that stops after the forget unit is finished by the member's second leave text", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const cy = newPhone();
    expect(await text(s, clock, cy, "slop")).toBe("join_asked");
    expect(await text(s, clock, cy, "Cy, 40")).toBe("joined");

    // The forget unit commits (the Network member is removed), then the process stops before the membership is removed.
    const fired = stopBefore(s.people, "forgetMembership");
    expect((await say(s, clock, cy, "leave slop.date")).result).not.toBe("left");
    expect(fired()).toBe(true);
    expect((await sql`select account_status from network.members where app_id = 'slop'`).map((r: any) => r.account_status)).toEqual(["removed"]);

    // The member asks again. The inbox first handles the stopped message again, then the new one: the leave
    // finishes (before the fix both went to the join flow and the membership stayed active with no member).
    await text(s, clock, cy, "leave slop.date");
    expect((await sql`select state, first_name from platform.memberships where app_id = 'slop'`).map((r: any) => [r.state, r.first_name])).toEqual([["removed", null]]);
  }, T);

  test("SD-017: a YES PHOTOS that read the membership before a ban does not write it back as active", async () => {
    await fresh();
    const clock = new SimClock(START);
    const dir = mkdtempSync(join(tmpdir(), "sagas-photos-"));
    const s = service(clock, { photoStorage: new LocalDiskPhotoStorage(dir), photoBaseUrl: "https://slop.date" });
    try {
      const di = newPhone();
      expect(await text(s, clock, di, "slop")).toBe("join_asked");
      expect(await text(s, clock, di, "Di, 38")).toBe("joined");
      const d = (await memberOf("slop", di))!.id;
      // The photo consent ask is waiting (a photo by text asked it).
      await s.people.putPending({ phoneHash: s.accounts.phoneHash(di), kind: "photo_consent", app: "slop", name: null, age: null, at: clock.now() });

      // Staff ban the person while the YES PHOTOS turn is between its read of the membership and its write.
      const photos = s.photos as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      const mayTake = photos.mayTake!.bind(s.photos);
      let banned: unknown;
      photos.mayTake = async (...a: unknown[]) => {
        const r = await mayTake(...a);
        banned ??= await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: d, by: "person", note: "scam confirmed" })).json();
        return r;
      };
      expect(await text(s, clock, di, "YES PHOTOS")).toBe("handled");
      expect(banned).toEqual({ ok: true });
      // The ban stays: the membership reads restricted, not active.
      expect((await sql`select state from platform.memberships where app_id = 'slop'`).map((r: any) => r.state)).toEqual(["restricted"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, T);

  test("SD-026: after a number change, a legacy address row no longer routes the old number to the member", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const [a, b] = [newPhone(), newPhone()];
    expect(await text(s, clock, a, "slop")).toBe("join_asked");
    expect(await text(s, clock, a, "Eve, 33")).toBe("joined");
    const e = (await memberOf("slop", a))!.id;
    // A member from before the platform: migration 0006 gave them a person and kept their channel_identities row.
    await sql`insert into network.channel_identities (app_id, member_id, channel, address, verified_at, is_primary) values ('slop', ${e}, 'sms', ${a}, ${new Date(clock.now())}, true)`;

    // The member moves to a new number on the site (a fresh login, then a code to the new number).
    let cookie = "";
    const api = async (path: string, body: unknown) => {
      const res = await s.publicFetch(new Request(`http://127.0.0.1:8790${path}`, { method: "POST", headers: { host: "localhost:5102", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
      const c = res.headers.get("set-cookie"); if (c) cookie = c.split(";")[0]!;
      return { status: res.status, body: await res.json().catch(() => null) as any };
    };
    clock.advance(31_000);
    expect((await api("/api/auth/otp/start", { phone: a })).status).toBe(200);
    expect((await api("/api/auth/otp/verify", { phone: a, code: "123456" })).status).toBe(200);
    expect((await api("/api/me/phone/start", { phone: b })).body).toEqual({ ok: true });
    expect((await api("/api/me/phone/confirm", { code: "123456" })).body).toMatchObject({ ok: true });
    expect((await memberOf("slop", b))!.id).toBe(e);

    // The old number goes to someone else. Their text is not the member's: it is a stranger's first text.
    expect(await s.memberApps(a)).toEqual([]);
    expect(await text(s, clock, a, "hey, is this the pizza place?")).toBe("join_asked");
    expect((await sql`select count(*)::int as n from network.messages where app_id = 'slop' and member_id = ${e} and direction = 'inbound' and body like '%pizza%'`)[0].n).toBe(0);
  }, T);

  test("SD-055: a STOP that comes in before a number change and is written after it stops the person on the new number", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock), other = service(clock);
    const [a, b] = [newPhone(), newPhone()];
    expect(await text(s, clock, a, "slop")).toBe("join_asked");
    expect(await text(s, clock, a, "Fay, 34")).toBe("joined");
    const api = await startMove(other, clock, a, b);

    // The STOP from the old number is in flight: the number change (another replica) commits before its consent write.
    const accounts = s.accounts as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>;
    const record = accounts.recordConsent!.bind(s.accounts);
    let moved: unknown;
    accounts.recordConsent = async (...x: unknown[]) => {
      moved ??= (await api("/api/me/phone/confirm", { code: "123456" })).body;
      return record(...x);
    };
    expect(await text(s, clock, a, "STOP")).toBe("handled");
    expect(moved).toMatchObject({ ok: true });

    // The STOP follows the person: the new number reads opted out, and the person's member is paused.
    expect(await s.accounts.optedIn("slop", b)).toBe(false);
    expect((await s.people.lastConsent(b, "slop")).global?.state).toBe("opted_out");
    expect((await sql`select m.opted_out from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${b}`).map((r: any) => r.opted_out)).toEqual([true]);
  }, T);

  test("SD-056: a phone ban and a number change that run at the same time leave the person's number banned", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock), other = service(clock);
    const patch = (o: object, name: string, before: () => Promise<unknown>) => {
      const t = o as Record<string, (...x: unknown[]) => Promise<unknown>>;
      const real = t[name]!.bind(o);
      let ran = false;
      t[name] = async (...x: unknown[]) => { if (!ran) { ran = true; await before(); } return real(...x); };
    };

    // 1. The ban read the person's number, then the number change (another replica) committed before the ban rows.
    const [a, b] = [newPhone(), newPhone()];
    expect(await text(s, clock, a, "slop")).toBe("join_asked");
    expect(await text(s, clock, a, "Gus, 41")).toBe("joined");
    const g = (await memberOf("slop", a))!.id;
    const api = await startMove(other, clock, a, b);
    let moved: unknown;
    patch(s.people, "ban", async () => { moved = (await api("/api/me/phone/confirm", { code: "123456" })).body; });
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: g, by: "phone", note: "scam confirmed" })).json()).toEqual({ ok: true });
    expect(moved).toMatchObject({ ok: true });
    // The person is on the new number, and the new number is banned.
    expect((await memberOf("slop", b))!.id).toBe(g);
    expect(await s.people.isBanned(s.accounts.phoneHash(b))).toBe(true);

    // 2. The number change checked for a ban, then the ban committed before the move.
    const [c, d] = [newPhone(), newPhone()];
    expect(await text(s, clock, c, "slop")).toBe("join_asked");
    expect(await text(s, clock, c, "Hal, 44")).toBe("joined");
    const h = (await memberOf("slop", c))!.id;
    const api2 = await startMove(other, clock, c, d);
    let banned: unknown;
    patch(other.people, "movePhone", async () => { banned = await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: h, by: "phone", note: "scam confirmed" })).json(); });
    const r = await api2("/api/me/phone/confirm", { code: "123456" });
    expect(banned).toEqual({ ok: true });
    // The banned person does not move to a number with no ban.
    expect(r.body).toMatchObject({ ok: false, error: "review" });
    expect((await memberOf("slop", c))?.id).toBe(h);
    expect(await s.accounts.banned(d)).toBe(false);
    expect(await memberOf("slop", d)).toBeUndefined();
  }, T);

  test("SD-092: delete everything leaves no line counter that holds the number", async () => {
    await fresh();
    const clock = new SimClock(START);
    // The production line: the persisted queue (Eliza Cloud delivery; no live flags, so nothing is sent).
    const s = service(clock, { adapter: (_net, rt) => new CloudChannelAdapter({ clock, app: rt.app.id, city: rt.city, from: "+12125550299", origin: "http://127.0.0.1:9/", secret: "synthetic-identity-sagas-signing-secret", env: { PLATFORM_ENV: "dev" } }) });
    const ivy = newPhone();
    expect(await text(s, clock, ivy, "slop")).toBe("join_asked");
    expect(await text(s, clock, ivy, "Ivy, 27")).toBe("joined");
    // The member's texts opened the line's conversation counters for the number.
    expect((await sql`select count(*)::int as n from platform.line_conversations where address = ${ivy}`)[0].n).toBe(1);
    // One proactive text went out and is not answered yet (as the queue's acceptance writes it).
    await sql`update platform.line_conversations set unanswered = 1, first_outbound_at = ${new Date(clock.now())}, last_outbound_at = ${new Date(clock.now())} where address = ${ivy}`;

    // The member deletes everything on the site.
    const api = site(s);
    clock.advance(31_000);
    expect((await api("/api/auth/otp/start", { phone: ivy })).status).toBe(200);
    expect((await api("/api/auth/otp/verify", { phone: ivy, code: "123456" })).status).toBe(200);
    expect((await api("/api/me/delete", { scope: "all" })).body).toEqual({ ok: true });

    // No row keeps the number in plain form, now or after the retention purge.
    expect((await sql`select count(*)::int as n from platform.line_conversations where address = ${ivy}`)[0].n).toBe(0);
    clock.advance(2 * DAY);
    await s.purge();
    expect((await sql`select count(*)::int as n from platform.line_conversations where address = ${ivy}`)[0].n).toBe(0);
  }, T);

  test("SD-098: a number silent for over a year gets no proactive text before its holder writes", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const { phone } = await heldNumber(s, clock);
    const m = (await memberOf("slop", phone))!.id as Outbound["memberId"];
    // The number may have a new holder now. Nothing came in from it, so it is not on hold yet.
    expect(await s.accounts.held(phone)).toBe(false);

    // The send-time check (direct delivery and the persisted queue's optedOut check) refuses a proactive text.
    const rt = s.runtimeFor("slop")!;
    const send = (id: string, kind: Outbound["kind"]): Outbound => ({ id, memberId: m, to: phone, body: "x", kind, proactive: kind === "proactive", system: false, ts: clock.now() });
    expect([...(await s.consentRefused(rt, [send("proactive_1", "proactive"), send("stop_ok", "compliance")]))]).toEqual(["proactive_1"]);
  }, T);

  test("SD-108: a number change completes for a person with a Cloud grant; the Cloud grant ends, a site grant moves", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const [a, b] = [newPhone(), newPhone()];
    expect(await text(s, clock, a, "slop")).toBe("join_asked");
    expect(await text(s, clock, a, "Jo, 36")).toBe("joined");
    const person = (await sql`select person_id from platform.phone_identities where e164 = ${a}`)[0]!.person_id as string;
    // The person linked two agents: one through the site's own OAuth, one while Eliza Cloud auth was on for the app.
    const at = new Date(clock.now()), until = new Date(clock.now() + 30 * DAY), key = s.accounts.phoneHash(a);
    await sql`insert into oauth.clients (id, name, redirect_uris, auth_method, app_id, surface, kind, created_at) values ('client_sagas', 'Agent', ${sql.array(["https://agent.example/cb"], "TEXT")}, 'none', 'slop', 'full', 'dcr', ${at})`;
    await sql`insert into oauth.grants (id, client_id, app_id, phone_key, person_id, scopes, resource, created_at, expires_at, cloud_authority) values
      ('grant_site', 'client_sagas', 'slop', ${key}, ${person}, ${sql.array(["profile"], "TEXT")}, 'https://slop.date/mcp', ${at}, ${until}, null),
      ('grant_cloud_1', 'client_sagas', 'slop', ${key}, ${person}, ${sql.array(["profile"], "TEXT")}, 'https://slop.date/mcp', ${at}, ${until}, ${{ version: "1" }}::jsonb)`;

    const api = await startMove(s, clock, a, b);
    expect((await api("/api/me/phone/confirm", { code: "123456" })).body).toMatchObject({ ok: true });
    expect((await memberOf("slop", b))).toBeDefined();
    const grants = await sql`select id, phone_key, revoked_at is not null as revoked from oauth.grants order by id`;
    expect(grants.map((g: any) => [g.id, g.phone_key === s.accounts.phoneHash(b) ? "new" : g.phone_key === key ? "old" : "?", g.revoked])).toEqual([
      ["grant_cloud_1", "old", true], ["grant_site", "new", false],
    ]);
  }, T);

  test("SD-124: a member's leave removes their id from the stored matching-run summaries", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const [kim, lu] = [newPhone(), newPhone()];
    for (const [p, intro] of [[kim, "Kim, 31"], [lu, "Lu, 33"]] as const) {
      expect(await text(s, clock, p, "slop")).toBe("join_asked");
      expect(await text(s, clock, p, intro)).toBe("joined");
    }
    const [k, l] = [(await memberOf("slop", kim))!.id, (await memberOf("slop", lu))!.id];
    // A daily run put Kim and Lu in its top pairs (the row onEngineRun writes with the unit; summary as summarizeRun makes it).
    const rt = s.runtimeFor("slop")!;
    const pair = (a: string, b: string, score: number) => ({ key: `one_to_one:${a}|${b}`, generator: "intent", participants: [a, b], score, eligible: true, reason: null, selected: false, components: { fit: score } });
    await rt.unitOfWork(() => { rt.unit.runs.push({ id: "slop.run_sagas", app_id: "slop", at: new Date(clock.now()), city: rt.city, engine_version: "engine-v1", proposals: 0, wall_ms: 1,
      summary: { id: "run_sagas", at: clock.now(), proposals: 0, top: [pair(k, l, 0.9), pair(l, "slop_someone_else", 0.5)], proposalIds: [] } }); });
    expect((await sql`select count(*)::int as n from network.matching_runs where position(${k} in summary::text) > 0`)[0].n).toBe(1);

    // Kim leaves slop.date: the forget path.
    expect(await text(s, clock, kim, "leave slop.date")).toBe("left");
    expect((await sql`select count(*)::int as n from network.matching_runs where position(${k} in summary::text) > 0`)[0].n).toBe(0);
    // The run stays, with the pairs that do not name Kim.
    const [run] = await sql`select summary from network.matching_runs where id = 'slop.run_sagas'`;
    expect((run.summary.top as { participants: string[] }[]).map(t => t.participants)).toEqual([[l, "slop_someone_else"]]);
  }, T);

  /** A slop member with one photo row (the metadata the safety team reads), then banned by person after a report. */
  async function bannedWithPhoto(s: NetworkService, clock: SimClock, intro: string) {
    const phone = newPhone();
    expect(await text(s, clock, phone, "slop")).toBe("join_asked");
    expect(await text(s, clock, phone, intro)).toBe("joined");
    const person = (await sql`select person_id from platform.phone_identities where e164 = ${phone}`)[0]!.person_id as string;
    await sql`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at)
      values (${`photo_${phone}`}, ${person}, 'slop', ${`key_${phone}`}, 'image/jpeg', 100, 'sha', 'v1', ${new Date(clock.now())})`;
    const m = (await memberOf("slop", phone))!.id;
    expect(await (await staff(s, "saf-tok", "POST", "/apps/slop/safety/ban", { memberId: m, by: "person", note: "harassment confirmed" })).json()).toEqual({ ok: true });
    return { phone, person };
  }
  const photoRows = async (person: string) => (await sql`select count(*)::int as n from platform.photos where person_id = ${person}`)[0].n as number;

  test("SD-275, SD-256: a banned person's leave text keeps the photos for the safety team", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const { phone, person } = await bannedWithPhoto(s, clock, "Rex, 34");
    expect(await text(s, clock, phone, "leave slop.date")).toBe("left");
    expect(await photoRows(person)).toBe(1);
  }, T);

  test("SD-178: a banned person's delete everything keeps the photos for the safety team", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const { phone, person } = await bannedWithPhoto(s, clock, "Sid, 41");
    // A banned number gets no web session (SD-013): the delete request comes by help@ntwrk.party and
    // runs the same account erasure that /api/me/delete runs.
    await s.accounts.deleteAll({ e164: phone, personId: person });
    expect(await photoRows(person)).toBe(1);
    // The ban stays.
    expect(await s.accounts.banned(phone)).toBe(true);
  }, T);

  test("SD-275: a leave by a person who is not banned still deletes the photos", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const phone = newPhone();
    expect(await text(s, clock, phone, "slop")).toBe("join_asked");
    expect(await text(s, clock, phone, "Tia, 29")).toBe("joined");
    const person = (await sql`select person_id from platform.phone_identities where e164 = ${phone}`)[0]!.person_id as string;
    await sql`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at)
      values ('photo_tia', ${person}, 'slop', 'key_tia', 'image/jpeg', 100, 'sha', 'v1', ${new Date(clock.now())})`;
    expect(await text(s, clock, phone, "leave slop.date")).toBe("left");
    expect(await photoRows(person)).toBe(0);
  }, T);

  /** A slop member logs in on the site and downloads the export of this app. */
  async function exportOf(s: NetworkService, clock: SimClock, phone: string) {
    const api = site(s);
    clock.advance(31_000);
    expect((await api("/api/auth/otp/start", { phone })).status).toBe(200);
    expect((await api("/api/auth/otp/verify", { phone, code: "123456" })).status).toBe(200);
    const r = await api("/api/me/export");
    expect(r.status).toBe(200);
    return r.body;
  }

  test("SD-378: the export lists the member's photos (id, time, type and size; no bytes, no score)", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const phone = newPhone();
    expect(await text(s, clock, phone, "slop")).toBe("join_asked");
    expect(await text(s, clock, phone, "Uma, 28")).toBe("joined");
    const person = (await sql`select person_id from platform.phone_identities where e164 = ${phone}`)[0]!.person_id as string;
    const at = new Date(clock.now());
    await sql`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at)
      values ('photo_uma', ${person}, 'slop', 'key_uma', 'image/jpeg', 100, 'sha', 'v1', ${at})`;
    const out = await exportOf(s, clock, phone);
    expect(out.network.photos).toEqual([{ id: "photo_uma", createdAt: at.getTime(), bytes: 100, contentType: "image/jpeg" }]);
  }, T);

  test("SD-294: the export holds the private facts the member stated or accepted, not ratings, staff checks or staff signals", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const phone = newPhone();
    expect(await text(s, clock, phone, "slop")).toBe("join_asked");
    expect(await text(s, clock, phone, "Val, 33")).toBe("joined");
    const m = (await memberOf("slop", phone))!.id;
    const at = new Date(clock.now());
    const facet = (id: string, value: string, provenance: string, source: string, status = "confirmed") =>
      sql`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
        values ('slop', ${`${m}:${id}`}, ${m}, 'fact', ${value}, ${sql.array([`t:${id}`], "TEXT")}, 'agent_private', ${provenance}, ${source}, 0.9, ${status}, ${at})`;
    await facet("zip", "11211", "said", "web_join");                      // the member's zip at the web join
    await facet("gmail", "plays cello", "inferred", "gmail");             // a Gmail suggestion the member accepted as private
    await facet("appearance", "rating", "inferred", "photo_rater");       // the rating of looks: never shown
    await facet("verify", "verify:age:pass", "vouched", "staff");         // a staff check
    await facet("signal", "seemed upset", "inferred", "chat", "proposed"); // a signal for staff
    const out = await exportOf(s, clock, phone);
    const values = (out.network.facets as { value: string }[]).map(f => f.value);
    expect(values).toContain("11211");
    expect(values).toContain("plays cello");
    for (const hidden of ["rating", "verify:age:pass", "seemed upset"]) expect(values).not.toContain(hidden);
  }, T);

  test("SD-379: a number change moves the Eliza notice row to the new number", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const [a, b] = [newPhone(), newPhone()];
    expect(await text(s, clock, a, "slop")).toBe("join_asked");
    expect(await text(s, clock, a, "Wes, 31")).toBe("joined");
    // The one-time Eliza notice went to the old number (the row the service writes in a signed turn).
    const noticeKey = (e164: string) => (s as unknown as { noticeKey(x: string): string }).noticeKey(e164);
    await sql`insert into platform.eliza_notices (phone_hash, sent_at) values (${noticeKey(a)}, ${new Date(clock.now())})`;

    const api = await startMove(s, clock, a, b);
    expect((await api("/api/me/phone/confirm", { code: "123456" })).body).toMatchObject({ ok: true });
    // The notice follows the person; the old number (maybe someone else's next) keeps no row.
    const rows = (await sql`select phone_hash from platform.eliza_notices`).map((r: any) => r.phone_hash as string);
    expect(rows).toEqual([noticeKey(b)]);
  }, T);

  test("SD-381: a text that comes in while staff lift a hold (same_owner) does not put the number on hold again", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const { phone } = await heldNumber(s, clock);
    expect(await text(s, clock, phone, "hi, it is me")).toBe("held");

    // The owner texts again right after the hold is lifted, before any later write of the staff decision.
    const t = s.people as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>;
    const real = t.setPhoneHold!.bind(s.people);
    let between: string | undefined;
    t.setPhoneHold = async (...x: unknown[]) => {
      const r = await real(...x);
      if (x[1] === null && between === undefined) between = await text(s, clock, phone, "still me");
      return r;
    };
    expect(await (await staff(s, "adm-tok", "POST", "/apps/slop/holds", { phone, decision: "same_owner" })).json()).toEqual({ ok: true });
    expect(between).toBeDefined();
    expect(between).not.toBe("held");
    expect(await s.accounts.held(phone)).toBe(false);
  }, T);

  test("SD-385: delete everything removes the person's connection receipts and the relay items addressed to them", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const [ida, sam] = [newPhone(), newPhone()];
    expect(await text(s, clock, ida, "slop")).toBe("join_asked");
    expect(await text(s, clock, ida, "Ida, 30")).toBe("joined");
    expect(await text(s, clock, sam, "slop")).toBe("join_asked");
    expect(await text(s, clock, sam, "Sam, 32")).toBe("joined");
    const personOf = async (e164: string) => (await sql`select person_id from platform.phone_identities where e164 = ${e164}`)[0]!.person_id as string;
    const [pi, ps] = [await personOf(ida), await personOf(sam)];
    const [mi, ms] = [(await memberOf("slop", ida))!.id, (await memberOf("slop", sam))!.id];
    const at = new Date(clock.now()), until = new Date(clock.now() + DAY);
    // Ida disconnected a source connection (a replay receipt), and Sam chose to send Ida a photo through the relay.
    await sql`insert into platform.profile_suggestion_connection_receipts (request_nonce, request_hash, event_id, operation, app_id, person_id, member_id, user_id, organization_id, chat_id, connection_id, revoked_at)
      values (gen_random_uuid(), ${"a".repeat(64)}, 'evt_rcpt', 'disconnect', 'slop', ${pi}, ${mi}, 'user_ida', 'org_ida', 'chat_ida', 'conn_ida', ${at})`;
    await sql`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at)
      values ('photo_sam', ${ps}, 'slop', 'key_sam', 'image/jpeg', 100, 'sha', 'v1', ${at})`;
    await sql`insert into platform.photo_relay_items (id, app_id, sender_person_id, recipient_person_id, photo_id, thread_id, sender_member_id, recipient_member_id,
        content_sha256, content_type, content_bytes, consent_id, consented_at, expires_at, policy_version, policy_notice, notice, state)
      values (${`pri_${"b".repeat(32)}`}, 'slop', ${ps}, ${pi}, 'photo_sam', 'thread_1', ${ms}, ${mi}, ${"c".repeat(64)}, 'image/jpeg', 100, 'consent_1', ${at}, ${until},
        'v1', 'notice', 'Send this photo to Ida?', 'pending')`;

    const api = site(s);
    clock.advance(31_000);
    expect((await api("/api/auth/otp/start", { phone: ida })).status).toBe(200);
    expect((await api("/api/auth/otp/verify", { phone: ida, code: "123456" })).status).toBe(200);
    expect((await api("/api/me/delete", { scope: "all" })).body).toEqual({ ok: true });

    expect((await sql`select count(*)::int as n from platform.profile_suggestion_connection_receipts where person_id = ${pi}::uuid`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from platform.photo_relay_items where recipient_person_id = ${pi}::uuid`)[0].n).toBe(0);
    // Sam's photo is Sam's: it stays.
    expect((await sql`select count(*)::int as n from platform.photos where id = 'photo_sam'`)[0].n).toBe(1);
  }, T);

  test("Q-identity_sagas-1: a number change that stops after the move does not leave the new number suppressed", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const [a, b] = [newPhone(), newPhone()];
    expect(await text(s, clock, a, "slop")).toBe("join_asked");
    expect(await text(s, clock, a, "Xan, 37")).toBe("joined");
    // An earlier owner of b deleted everything: b is suppressed.
    await sql`insert into platform.suppression (phone_hash, reason, at) values (${s.accounts.phoneHash(b)}, 'deleted', ${new Date(clock.now())})`;

    const api = await startMove(s, clock, a, b);
    const fired = stopAfter(s.people, "movePhone");
    expect((await api("/api/me/phone/confirm", { code: "123456" })).status).toBeGreaterThanOrEqual(500);
    expect(fired()).toBe(true);
    // The person now lives on b, and b is not suppressed: their texts are not refused.
    expect((await memberOf("slop", b))).toBeDefined();
    expect(await s.people.isSuppressed(s.accounts.phoneHash(b))).toBe(false);
  }, T);

  test("Q-identity_sagas-2: delete everything that runs with a number change suppresses the new number and keeps no row with it", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock), other = service(clock);
    const [a, b] = [newPhone(), newPhone()];
    expect(await text(s, clock, a, "slop")).toBe("join_asked");
    expect(await text(s, clock, a, "Yul, 38")).toBe("joined");
    const move = await startMove(other, clock, a, b);
    // The member deletes everything on the site (logged in on a).
    const api = site(s);
    clock.advance(31_000);
    expect((await api("/api/auth/otp/start", { phone: a })).status).toBe(200);
    expect((await api("/api/auth/otp/verify", { phone: a, code: "123456" })).status).toBe(200);

    // The delete read the person on a; the number change (another replica) commits before the delete's transaction.
    const people = s.people as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>;
    const real = people.deleteAll!.bind(s.people);
    let moved: unknown;
    people.deleteAll = async (...x: unknown[]) => {
      moved ??= (await move("/api/me/phone/confirm", { code: "123456" })).body;
      return real(...x);
    };
    expect((await api("/api/me/delete", { scope: "all" })).body).toEqual({ ok: true });
    expect(moved).toMatchObject({ ok: true });

    // The person's current number is suppressed, and no row keeps it in plain form.
    expect(await s.people.isSuppressed(s.accounts.phoneHash(b))).toBe(true);
    expect(await s.people.isSuppressed(s.accounts.phoneHash(a))).toBe(true);
    expect((await sql`select count(*)::int as n from platform.phone_identities where e164 = ${b}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from platform.consent_events where e164 = ${b}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from platform.line_conversations where address = ${b}`)[0].n).toBe(0);
  }, T);
});
