// Story F24 through the staff port and a real backup and restore on the dev Postgres (:54339).
// spec/accountPrivacy.md, "Story: Staff carry out an export or erasure request sent to support"
// spec/databaseRestore.md, "Story: Carry privacy changes made after the backup into the restored database"
import { findExecutable, spawnProcess } from "../../core/src/runtime/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { maskPhone } from "../../platform/src/phone.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { createServiceMcp } from "../service/serve.ts";
import { START } from "./mini.ts";
import { backup } from "../../../deploy/backup/backup.ts";
import { restore } from "../../../deploy/backup/restore.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_privacy_support_test_${process.pid}`;
const RESTORED = `restore_privacy_${process.pid}`;
const RESTORED_LOST = `restore_privacy_lost_${process.pid}`;
const BOOTED = `restore_privacy_boot_${process.pid}`;
const BOOT_ROLE = `privacy_boot_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const urlOf = (db: string) => `postgres://${USER}@localhost:${DEV_PG_PORT}/${db}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_privacy";
const NETS = [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }, { id: "peon:nyc" }, { id: "friends:nyc" }];
const REASON = "help@ntwrk.party request 2026-11-17";
let phoneSeq = 10;
const newPhone = () => `+121255502${String(++phoneSeq).padStart(2, "0")}`;

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  sent = 0;
  async send(e164: string) { this.sent++; const code = String(200000 + this.sent * 7919); this.codes.set(e164, code); return { code }; }
}

const open: NetworkService[] = [];
function service(clock: SimClock, db = DB) {
  const otp = new FakeOtp();
  const s = new NetworkService({
    url: urlOf(db), clock, instance: "privacy", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,safety:saf-tok,admin@slop:slop-admin-tok", webhookSecret: SECRET,
    network: { seed: 1 }, publicApi: { otp, minStartMs: 0, minVerifyMs: 0 }, photoStorage: null,
    adapter: () => new DryRunAdapter(() => {}),
  });
  open.push(s);
  return { s, otp };
}

let evt = 0;
async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_p${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_p${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
async function joinByText(s: NetworkService, clock: SimClock, phone: string, app: string, name: string) {
  expect(await text(s, clock, phone, app)).toBe("join_asked");
  expect(await text(s, clock, phone, `${name}, 32`)).toBe("joined");
}
const staff = async (s: NetworkService, token: string, path: string, b: unknown) => {
  const res = await s.fetch(new Request(`http://127.0.0.1:4848${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(b) }));
  return { status: res.status, body: await res.json() as any };
};
const liveMembers = (sql: SQL, personId: string) =>
  sql`select app_id, account_status from network.members where person_id = ${personId}::uuid and account_status <> 'removed' order by app_id` as Promise<{ app_id: AppId; account_status: string }[]>;

describe.skipIf(!pgAvailable)("support export and erasure, and the privacy replay of a restore (Postgres)", () => {
  let sql: SQL;
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`drop database if exists ${RESTORED} with (force)`);
    await admin(`drop database if exists ${RESTORED_LOST} with (force)`);
    await admin(`drop database if exists ${BOOTED} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: urlOf(DB), max: 2 });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
    await admin(`drop database if exists ${RESTORED} with (force)`).catch(() => {});
    await admin(`drop database if exists ${RESTORED_LOST} with (force)`).catch(() => {});
    await admin(`drop database if exists ${BOOTED} with (force)`).catch(() => {});
    await admin(`drop role if exists ${BOOT_ROLE}`).catch(() => {});
    await admin(`drop role if exists ${BOOT_ROLE}_events`).catch(() => {});
  });
  const fresh = () => applySchema(urlOf(DB), { reset: true, lockTimeout: "5s" });

  test("staff erase and export the confirmed holder of a number, and nobody else", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const phone = newPhone(), other = newPhone();
    await joinByText(s, clock, phone, "slop", "Ari");
    await joinByText(s, clock, other, "slop", "Bea");
    const person = (await s.accounts.personFor(phone))!, otherPerson = (await s.accounts.personFor(other))!;
    const ask = { phone, operation: "erase", app: "slop", reason: REASON };

    // spec/accountPrivacy.md, "Only a global admin with a stated reason opens or confirms a support request"
    expect((await staff(s, "saf-tok", "/privacy/requests", ask)).status).toBe(403);
    expect((await staff(s, "slop-admin-tok", "/privacy/requests", ask)).status).toBe(403);
    expect((await staff(s, "adm-tok", "/privacy/requests", { ...ask, reason: "x" })).status).toBe(400);
    expect((await staff(s, "adm-tok", "/privacy/requests", { ...ask, scope: "app" })).body).toEqual({ ok: false, error: "erase_covers_every_app" });

    const started = await staff(s, "adm-tok", "/privacy/requests", ask);
    expect(started.body).toMatchObject({ ok: true, personId: person.id, phone: maskPhone(phone), codeSent: true, memberships: [{ app: "slop" }] });
    const code = otp.codes.get(phone)!;
    const confirm = (b: Record<string, unknown>) => staff(s, "adm-tok", `/privacy/requests/${started.body.requestId}/confirm`, { reason: REASON, ...b });

    // spec/accountPrivacy.md, "Staff act only on the confirmed person after a fresh code from the number"
    expect(await confirm({ phone: other, personId: person.id, code })).toEqual({ status: 404, body: { ok: false, error: "request_unavailable" } });
    expect(await confirm({ phone, personId: otherPerson.id, code })).toEqual({ status: 409, body: { ok: false, error: "target_changed" } });
    expect(await confirm({ phone, personId: person.id, code: "999999" })).toEqual({ status: 403, body: { ok: false, error: "code_refused" } });
    expect(await s.accounts.personFor(phone)).toMatchObject({ id: person.id });

    const erased = await confirm({ phone, personId: person.id, code });
    expect(erased).toEqual({ status: 200, body: { ok: true, outcome: "erased", personId: person.id, phone: maskPhone(phone) } });
    expect(await s.accounts.personFor(phone)).toBeUndefined();
    expect(await s.people.isSuppressed(s.accounts.phoneHash(phone))).toBe(true);
    expect(await liveMembers(sql, person.id)).toEqual([]);
    expect(await liveMembers(sql, otherPerson.id)).toEqual([{ app_id: "slop", account_status: "active" }]);
    expect(await confirm({ phone, personId: person.id, code })).toEqual({ status: 200, body: { ok: true, outcome: "erased", already: true } });

    const audit = (await s.audit.list({ actions: ["privacy_request", "privacy_confirm"], limit: 50 })).reverse()
      .filter(e => e.ok).map(e => `${e.action}:${(e.detail as { phase: string }).phase}`);
    expect(audit.slice(0, 2)).toEqual(["privacy_request:requested", "privacy_request:result"]);
    expect(audit).toContain("privacy_confirm:result");

    // spec/accountPrivacy.md, "A support export covers one app or every app, and an erasure covers every app"
    clock.advance(MINUTE);
    const exportStart = await staff(s, "adm-tok", "/privacy/requests", { phone: other, operation: "export", app: "slop", scope: "app", reason: REASON });
    expect(exportStart.body).toMatchObject({ ok: true, personId: otherPerson.id });
    const exported = await staff(s, "adm-tok", `/privacy/requests/${exportStart.body.requestId}/confirm`, { phone: other, personId: otherPerson.id, code: otp.codes.get(other), reason: REASON });
    expect(exported.body).toMatchObject({ ok: true, outcome: "exported", personId: otherPerson.id });
    expect(Object.keys(exported.body.exports)).toEqual(["slop"]);
    expect(exported.body.exports.slop).toMatchObject({ app: "slop", phone: other, membership: { state: "active", firstName: "Bea" } });
    expect(exported.body.exports.slop.network).toMatchObject({ member: { name: "Bea" } });
  }, T);

  test("a restore keeps an erasure, a STOP, a leave and a ban made after the backup, and the backend replays them at start", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const erasing = newPhone(), stopping = newPhone(), leaving = newPhone(), banning = newPhone(), rejoining = newPhone(), late = newPhone();
    for (const [phone, name] of [[erasing, "Cy"], [stopping, "Di"], [leaving, "Ed"], [banning, "Flo"], [rejoining, "Ida"]] as const) await joinByText(s, clock, phone, "slop", name);
    await joinByText(s, clock, leaving, "friends", "Ed");
    const erased = (await s.accounts.personFor(erasing))!, left = (await s.accounts.personFor(leaving))!, banned = (await s.accounts.personFor(banning))!;
    const stopped = (await s.accounts.personFor(stopping))!, rejoined = (await s.accounts.personFor(rejoining))!;
    // A connector grant of the person who erases after the backup: the restore brings it back with the dump.
    await sql`insert into oauth.clients (id, redirect_uris, auth_method, app_id, surface, kind, created_at)
      values ('client_privacy', '{https://client.example/callback}', 'none', 'slop', 'full', 'dcr', ${new Date(clock.now())})`;
    await sql`insert into oauth.grants (id, client_id, app_id, phone_key, person_id, scopes, resource, created_at, expires_at)
      values ('grant_privacy', 'client_privacy', 'slop', ${s.accounts.phoneHash(erasing)}, ${erased.id}, '{membership:read}', 'https://slop.date/mcp',
        ${new Date(clock.now())}, ${new Date(clock.now() + 30 * 24 * 60 * MINUTE)})`;
    const [stopMember] = await sql`select id from network.members where app_id = 'slop' and person_id = ${stopped.id}::uuid` as { id: string }[];

    // A queued text of the banned number in the backup: the restore must not keep it.
    await sql`insert into platform.pending_texts (phone_hash, kind, app_id, name, at) values (${s.accounts.phoneHash(banning)}, 'share', 'friends', 'Flo', ${new Date(clock.now())})`;
    for (const [id, status] of [["restore_text_sent", "pending"], ["restore_text_gone", "pending"], ["restore_text_waiting", "pending"],
      ["restore_text_parked", "parked_leak_review"], ["restore_text_released", "parked_leak_review"], ["restore_text_doubt", "send_unknown"]] as const) {
      await sql`insert into platform.outbound (id, app_id, member_id, line, to_address, kind, body, fingerprint, time_zone, status, next_attempt_at, created_at, updated_at)
        values (${id}, 'slop', null, '+12125550190', ${newPhone()}, 'transactional', 'restore fixture', ${`fixture-${id}`}, 'UTC', ${status},
          ${new Date(clock.now() + 60 * MINUTE)}, ${new Date(clock.now())}, ${new Date(clock.now())})`;
    }
    const dir = await mkdtemp(join(tmpdir(), "privacy-restore-"));
    try {
      await backup({ url: urlOf(DB), outDir: dir, roles: false });
      await sql`update platform.outbound set status = 'sent', attempts = 1, sent_at = ${new Date(clock.now())}, updated_at = ${new Date(clock.now())},
        provider_message_id = 'restore_fixture_provider_id' where id = 'restore_text_sent'`;
      await sql`delete from platform.outbound where id = 'restore_text_gone'`;
      await sql`update platform.outbound set status = 'sent', attempts = 1, sent_at = ${new Date(clock.now())}, updated_at = ${new Date(clock.now())},
        provider_message_id = 'restore_fixture_released_id', leak_released_by = 'staff:adm' where id = 'restore_text_released'`;
      await sql`update platform.outbound set status = 'sent', updated_at = ${new Date(clock.now())},
        provider_message_id = 'restore_fixture_doubt_id' where id = 'restore_text_doubt'`;

      expect(await s.accounts.deleteAll({ e164: erasing, personId: erased.id })).toBe(true);
      // An erasure, then a new join of another app by the same number: the join revives the tombstone.
      expect(await s.accounts.deleteAll({ e164: rejoining, personId: rejoined.id })).toBe(true);
      await joinByText(s, clock, rejoining, "friends", "Ida");
      expect(await s.accounts.personFor(rejoining)).toMatchObject({ id: rejoined.id });
      // A person who joins after the backup and gets a person ban that carries no phone hash.
      await joinByText(s, clock, late, "slop", "Jo");
      const latePerson = (await s.accounts.personFor(late))!;
      await sql`insert into platform.bans (id, scope, person_id, phone_hash, reason, banned_by, at)
        values ('ban_late_person', 'person', ${latePerson.id}::uuid, null, 'confirmed by staff', 'staff:adm', ${new Date(clock.now())})`;
      await text(s, clock, stopping, "STOP");
      expect(await s.accounts.optedIn("slop", stopping)).toBe(false);
      expect(await s.accounts.leave(s.apps.friends, { e164: leaving, personId: left.id })).toBe(true);
      const [bannedMember] = await sql`select id from network.members where app_id = 'slop' and person_id = ${banned.id}::uuid` as { id: string }[];
      expect((await staff(s, "saf-tok", "/apps/slop/safety/ban", { memberId: bannedMember!.id, by: "person", note: "confirmed by staff" })).body).toEqual({ ok: true });
      await s.close();

      // spec/databaseRestore.md, "Manifest admission refuses source writes and unavailable dump files"
      await expect(restore({ serverUrl: ADMIN_URL, db: RESTORED, dir, keepPrivileges: true })).rejects.toThrow(/--replay/);
      const restored = await restore({ serverUrl: ADMIN_URL, db: RESTORED, dir, replayFrom: urlOf(DB) });
      expect(restored.mismatches).toEqual([]);
      // The leave is an opt-out of friends too: its STOP item finds the membership already left.
      expect(restored.privacy).toMatchObject({ erasures: 2, leaves: 1, stops: 2 });
      expect(restored.privacy!.bans).toBeGreaterThan(0);
      expect(restored.privacy!.textsEnded).toBeGreaterThanOrEqual(1);
      const lost = await restore({ serverUrl: ADMIN_URL, db: RESTORED_LOST, dir, keepPrivileges: true, sourceLost: true });
      expect(lost.texts!.textsEnded).toBeGreaterThanOrEqual(3);
      const lostSql = new SQL({ url: urlOf(RESTORED_LOST), max: 1 });
      try {
        expect(await lostSql`select id, status from platform.outbound where id like 'restore_text_%' order by id`).toEqual([
          { id: "restore_text_doubt", status: "send_unknown" }, { id: "restore_text_gone", status: "expired" }, { id: "restore_text_parked", status: "expired" },
          { id: "restore_text_released", status: "expired" }, { id: "restore_text_sent", status: "expired" }, { id: "restore_text_waiting", status: "expired" },
        ]);
      } finally { await lostSql.close(); }
    } finally { await rm(dir, { recursive: true, force: true }); }

    const { s: back } = service(clock, RESTORED);
    const restoredSql = new SQL({ url: urlOf(RESTORED), max: 1 });
    let mcp: Awaited<ReturnType<typeof createServiceMcp>>;
    try {
      // The copied facts hold before the backend runs anything.
      expect(await back.accounts.optedIn("slop", stopping)).toBe(false);
      expect(await back.people.isSuppressed(back.accounts.phoneHash(erasing))).toBe(true);
      expect(await back.accounts.banned(banning)).toBe(true);
      // spec/databaseRestore.md, "A source row that the restored database lacks is replayed": the ban of a person
      // who joined after the backup keeps that person's phone hash.
      expect(await back.accounts.banned(late)).toBe(true);
      expect(await restoredSql`select count(*)::int as n from platform.pending_texts where phone_hash = ${back.accounts.phoneHash(banning)}`).toEqual([{ n: 0 }]);
      // spec/databaseRestore.md, "A restored text that is not settled takes the source's outcome, or ends"
      expect(await restoredSql`select id, status, provider_message_id, to_address is null as address_dropped from platform.outbound
        where id like 'restore_text_%' order by id`).toEqual([
        { id: "restore_text_doubt", status: "sent", provider_message_id: "restore_fixture_doubt_id", address_dropped: false },
        { id: "restore_text_gone", status: "expired", provider_message_id: null, address_dropped: true },
        { id: "restore_text_parked", status: "parked_leak_review", provider_message_id: null, address_dropped: false },
        { id: "restore_text_released", status: "sent", provider_message_id: "restore_fixture_released_id", address_dropped: false },
        { id: "restore_text_sent", status: "sent", provider_message_id: "restore_fixture_provider_id", address_dropped: false },
        { id: "restore_text_waiting", status: "pending", provider_message_id: null, address_dropped: false },
      ]);

      // spec/databaseRestore.md, "The backend runs the queued replay at start, and each item by one runner until it holds"
      // spec/databaseRestore.md, "The backend runs a queued erasure or leave only after the connector hooks are registered"
      await expect(back.start()).rejects.toThrow(/connector forget hooks/);
      expect(await restoredSql`select count(*)::int as n from oauth.grants where person_id = ${erased.id}`).toEqual([{ n: 1 }]);
      mcp = await createServiceMcp(back, { env: { PLATFORM_ENV: "dev" }, databaseUrl: urlOf(RESTORED), migrate: false, log: () => {} });
      await back.start();
      expect(await restoredSql`select count(*)::int as n from oauth.grants where person_id = ${erased.id}`).toEqual([{ n: 0 }]);
      expect(await restoredSql`select kind, app_id, outcome, replayed_at is not null as done, claimed_until from platform.privacy_replay
        order by case kind when 'erase' then 0 when 'leave' then 1 when 'stop' then 2 else 3 end, app_id`).toEqual([
        { kind: "erase", app_id: null, outcome: "applied", done: true, claimed_until: null },
        { kind: "erase", app_id: null, outcome: "applied", done: true, claimed_until: null },
        { kind: "leave", app_id: "friends", outcome: "applied", done: true, claimed_until: null },
        { kind: "stop", app_id: "friends", outcome: "already", done: true, claimed_until: null },
        { kind: "stop", app_id: "slop", outcome: "applied", done: true, claimed_until: null },
        { kind: "ban", app_id: null, outcome: "applied", done: true, claimed_until: null },
      ]);
      // spec/databaseRestore.md, "A STOP after the backup is replayed on each membership it still covers"
      expect(await restoredSql`select opted_out from network.members where app_id = 'slop' and id = ${stopMember!.id}`).toEqual([{ opted_out: true }]);
      expect(await back.people.getMembership(stopped.id, "slop")).toMatchObject({ state: "paused" });
      const slop = back.runtimeFor("slop")!;
      expect(await slop.readState(n => n.eligible(stopMember!.id as never))).toBe(false);
      expect(await back.accounts.personFor(erasing)).toBeUndefined();
      expect(await liveMembers(restoredSql, erased.id)).toEqual([]);
      // spec/databaseRestore.md, "An erasure after the backup is replayed": the new join did not hide the erasure.
      expect(await back.accounts.personFor(rejoining)).toBeUndefined();
      expect(await liveMembers(restoredSql, rejoined.id)).toEqual([]);
      expect(await back.people.getMembership(rejoined.id, "slop")).toBeUndefined();
      expect(await back.accounts.optedIn("slop", rejoining)).toBe(false);
      expect(await liveMembers(restoredSql, left.id)).toEqual([{ app_id: "slop", account_status: "active" }]);
      expect(await back.people.getMembership(left.id, "friends")).toMatchObject({ state: "removed" });
      expect(await liveMembers(restoredSql, banned.id)).toEqual([{ app_id: "slop", account_status: "restricted" }]);
      expect(await back.accounts.optedIn("slop", stopping)).toBe(false);
      expect((await staff(back, "adm-tok", "/privacy/replay", { reason: REASON })).body).toEqual({ ok: true, items: [] });
      const audit = (await back.audit.list({ actions: ["privacy_replay"], limit: 10 })).reverse().map(e => [e.actor, (e.detail as { phase: string }).phase]);
      expect(audit.slice(0, 2)).toEqual([["system:restore-replay", "requested"], ["system:restore-replay", "result"]]);

      // An item that cannot run yet stays open and runs on a later replay; an item that another runner claims is not run.
      const held = newPhone(), claimed = newPhone();
      await joinByText(back, clock, held, "slop", "Gus");
      await joinByText(back, clock, claimed, "slop", "Hal");
      const heldPerson = (await back.accounts.personFor(held))!, claimedPerson = (await back.accounts.personFor(claimed))!;
      await restoredSql`update platform.phone_identities set hold = 'recycled_number' where e164 = ${held}`;
      await restoredSql`insert into platform.privacy_replay (kind, person_id, queued_at) values ('erase', ${heldPerson.id}::uuid, ${new Date(clock.now())})`;
      await restoredSql`insert into platform.privacy_replay (kind, person_id, queued_at, claimed_until)
        values ('erase', ${claimedPerson.id}::uuid, ${new Date(clock.now())}, ${new Date(clock.now() + 60 * MINUTE)})`;
      expect((await staff(back, "adm-tok", "/privacy/replay", { reason: REASON })).body.items).toEqual([{ kind: "erase", outcome: "held", done: false }]);
      expect(await back.accounts.personFor(claimed)).toMatchObject({ id: claimedPerson.id });
      await restoredSql`update platform.phone_identities set hold = null where e164 = ${held}`;
      expect((await staff(back, "adm-tok", "/privacy/replay", { reason: REASON })).body.items).toEqual([{ kind: "erase", outcome: "applied", done: true }]);
      expect(await back.accounts.personFor(held)).toBeUndefined();
    } finally {
      await (mcp?.store as unknown as { close?(): Promise<void> } | undefined)?.close?.();
      await restoredSql.close();
    }
  }, T);

  // spec/databaseRestore.md, "The backend runs a queued erasure or leave only after the connector hooks are registered"
  test("the deployed backend entry registers the connector hooks before the start-up replay removes a restored grant", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const erasing = newPhone();
    await joinByText(s, clock, erasing, "slop", "Kai");
    const erased = (await s.accounts.personFor(erasing))!;
    await sql`insert into oauth.clients (id, redirect_uris, auth_method, app_id, surface, kind, created_at)
      values ('client_boot', '{https://client.example/callback}', 'none', 'slop', 'full', 'dcr', ${new Date(clock.now())})`;
    await sql`insert into oauth.grants (id, client_id, app_id, phone_key, person_id, scopes, resource, created_at, expires_at)
      values ('grant_boot', 'client_boot', 'slop', ${s.accounts.phoneHash(erasing)}, ${erased.id}, '{membership:read}', 'https://slop.date/mcp',
        ${new Date(clock.now())}, ${new Date(clock.now() + 30 * 24 * 60 * MINUTE)})`;
    const dir = await mkdtemp(join(tmpdir(), "privacy-boot-"));
    try {
      await backup({ url: urlOf(DB), outDir: dir, roles: false });
      expect(await s.accounts.deleteAll({ e164: erasing, personId: erased.id })).toBe(true);
      await s.close();
      const restored = await restore({ serverUrl: ADMIN_URL, db: BOOTED, dir, keepPrivileges: true, replayFrom: urlOf(DB) });
      expect(restored.privacy).toMatchObject({ erasures: 1 });
    } finally { await rm(dir, { recursive: true, force: true }); }

    const owner = new SQL({ url: urlOf(BOOTED), max: 1 });
    try {
      await owner.unsafe(`drop role if exists ${BOOT_ROLE}`).catch(() => {});
      await owner.unsafe(`create role ${BOOT_ROLE} login nosuperuser nobypassrls`);
      await owner.unsafe(`grant network_service to ${BOOT_ROLE}`);
      await owner.unsafe(`grant connect on database ${BOOTED} to ${BOOT_ROLE}`);
      await owner.unsafe(`drop role if exists ${BOOT_ROLE}_events`).catch(() => {});
      await owner.unsafe(`create role ${BOOT_ROLE}_events login nosuperuser nobypassrls`);
      await owner.unsafe(`grant network_public_event_ingest to ${BOOT_ROLE}_events`);
      await owner.unsafe(`grant connect on database ${BOOTED} to ${BOOT_ROLE}_events`);
      await owner`delete from network.public_event_imports`;
      await owner`insert into network.public_event_imports (source, checked_at) values ('nyc-parks', now())`;
      expect(await owner`select count(*)::int as n from oauth.grants where person_id = ${erased.id}`).toEqual([{ n: 1 }]);
    } finally { await owner.close(); }

    const port = 40000 + (process.pid % 10000);
    const login = (role: string) => Object.assign(new URL(urlOf(BOOTED)), { username: role }).toString();
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && k !== "DATABASE_URL" && k !== "PORT" &&
      !/^(PLATFORM_|NETWORK_|BLOOIO_|OTP_|TWILIO_|TURNSTILE_|LEAK_|SERVICE_|MIGRAT|NTWRK_|ALERT_|BACKEND_|STAFF_|SURPLUS_|OPENAI_|JUDGE_|RECOMMENDER_|DEFAULT_LLM_)/.test(k))) as Record<string, string>;
    const env: Record<string, string> = {
      ...inherited, NODE_ENV: "", PLATFORM_ENV: "staging", PLATFORM_DB_ENVIRONMENT_INIT: "1", MIGRATE_ON_BOOT: "0",
      DATABASE_URL: login(BOOT_ROLE), MIGRATION_DATABASE_URL: urlOf(BOOTED), NETWORK_PUBLIC_EVENTS_DATABASE_URL: login(`${BOOT_ROLE}_events`),
      PORT: String(port), STAFF_PORT: String(port + 1), TICK_MS: "3600000", BUILD_ID: "privacy-boot",
      PLATFORM_HASH_KEY: "h".repeat(40), PLATFORM_SESSION_SECRET: "e".repeat(40), LEAK_LABEL_KEY: "l".repeat(40), PLATFORM_PROXY_SECRET: "p".repeat(40),
      TURNSTILE_SECRET_KEY: "fixture", TURNSTILE_SITE_KEY: "fixture-site", OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "ACfixture",
      TWILIO_AUTH_TOKEN: "fixture", TWILIO_VERIFY_SERVICE_SID: "VAfixture", SERVICE_TURN_SECRET: "t".repeat(40),
      NETWORK_SERVICE_TOKENS: `admin@*:${"a".repeat(40)}`, NETWORK_CHANNEL: "",
      SURPLUS_API_KEY: "synthetic-surplus-key", SURPLUS_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    };
    const proc = spawnProcess([process.execPath, "--import", "tsx", `${import.meta.dirname}/../../../deploy/backend/server.ts`], { env, stdout: "pipe", stderr: "pipe" });
    const out = new Response(proc.stdout).text();
    const err = new Response(proc.stderr).text();
    const check = new SQL({ url: urlOf(BOOTED), max: 1 });
    try {
      let healthy = false;
      for (let i = 0; i < 900 && !healthy; i++) {
        await sleep(100);
        healthy = await fetch(`http://127.0.0.1:${port}/healthz`).then(r => r.status === 200, () => false);
      }
      if (!healthy) { proc.kill("SIGKILL"); throw new Error(`the backend did not become healthy:\n${(await out).split("\n").slice(-8).join("\n")}\n${await err}`); }
      expect(await check`select count(*)::int as n from oauth.grants where person_id = ${erased.id}`).toEqual([{ n: 0 }]);
      expect(await check`select kind, outcome, replayed_at is not null as done from platform.privacy_replay where kind = 'erase'`).toEqual([{ kind: "erase", outcome: "applied", done: true }]);
    } finally {
      proc.kill("SIGTERM");
      await check.close();
    }
    expect(await proc.exited).toBe(0);
    expect(await out).toMatch(/"msg":"mcp".*"enabled":true/);
  }, T);
});
