// Story F24 through the staff port and a real backup and restore on the dev Postgres (:54339).
// spec/accountPrivacy.md, "Story: Staff carry out an export or erasure request sent to support"
// spec/databaseRestore.md, "Story: Carry privacy changes made after the backup into the restored database"
import { findExecutable } from "../../core/src/runtime/process.ts";
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
import { START } from "./mini.ts";
import { backup } from "../../../deploy/backup/backup.ts";
import { restore } from "../../../deploy/backup/restore.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_privacy_support_test_${process.pid}`;
const RESTORED = `restore_privacy_${process.pid}`;
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
    await admin(`create database ${DB}`);
    sql = new SQL({ url: urlOf(DB), max: 2 });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
    await admin(`drop database if exists ${RESTORED} with (force)`).catch(() => {});
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

  test("a restore keeps an erasure, a STOP, a leave and a ban made after the backup", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const erasing = newPhone(), stopping = newPhone(), leaving = newPhone(), banning = newPhone();
    for (const [phone, name] of [[erasing, "Cy"], [stopping, "Di"], [leaving, "Ed"], [banning, "Flo"]] as const) await joinByText(s, clock, phone, "slop", name);
    await joinByText(s, clock, leaving, "friends", "Ed");
    const erased = (await s.accounts.personFor(erasing))!, left = (await s.accounts.personFor(leaving))!, banned = (await s.accounts.personFor(banning))!;

    const dir = await mkdtemp(join(tmpdir(), "privacy-restore-"));
    try {
      await backup({ url: urlOf(DB), outDir: dir, roles: false });

      expect(await s.accounts.deleteAll({ e164: erasing, personId: erased.id })).toBe(true);
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
      expect(restored.privacy).toMatchObject({ erasures: 1, leaves: 1 });
      expect(restored.privacy!.bans).toBeGreaterThan(0);
    } finally { await rm(dir, { recursive: true, force: true }); }

    const { s: back } = service(clock, RESTORED);
    const restoredSql = new SQL({ url: urlOf(RESTORED), max: 1 });
    try {
      // The copied facts hold before the backend runs anything.
      expect(await back.accounts.optedIn("slop", stopping)).toBe(false);
      expect(await back.people.isSuppressed(back.accounts.phoneHash(erasing))).toBe(true);
      expect(await back.accounts.banned(banning)).toBe(true);

      const replayed = await staff(back, "adm-tok", "/privacy/replay", { reason: REASON });
      expect(replayed.body.items).toEqual([{ kind: "erase", outcome: "erased" }, { kind: "leave", outcome: "left" }, { kind: "ban", outcome: "projected" }]);
      expect(await back.accounts.personFor(erasing)).toBeUndefined();
      expect(await liveMembers(restoredSql, erased.id)).toEqual([]);
      expect(await liveMembers(restoredSql, left.id)).toEqual([{ app_id: "slop", account_status: "active" }]);
      expect(await back.people.getMembership(left.id, "friends")).toMatchObject({ state: "removed" });
      expect(await liveMembers(restoredSql, banned.id)).toEqual([{ app_id: "slop", account_status: "restricted" }]);
      expect(await back.accounts.optedIn("slop", stopping)).toBe(false);
      expect((await staff(back, "adm-tok", "/privacy/replay", { reason: REASON })).body).toEqual({ ok: true, items: [] });
    } finally { await restoredSql.close(); }
  }, T);
});
