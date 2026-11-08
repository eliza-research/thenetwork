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
    url: URL_, clock, instance: "sagas", log: process.env.SAGA_LOG ? console.log : () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
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
});
