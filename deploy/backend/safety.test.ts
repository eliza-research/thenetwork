// Safety across apps on Postgres (migration 0019; packages/network/src/safety.ts; docs/runbook-safety.md):
// a minor report lowers the person's age, deletes photos and ratings and stops matching on a second
// app; a held person who deletes everything and joins again is still held; forget keeps evidence
// under a hold until it expires; a ban and an under-13 decline revoke OAuth grants. The real
// NetworkService (dry-run adapter, dev environment) on a database of its own on the dev cluster.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { dropDb, migratedDb, pgAvailable } from "../../packages/platform/test/pg.ts";
import { migrate } from "../../packages/observatory/db/migrate.ts";
import { NetworkService, MINOR_REPORT_AGE } from "../../packages/network/service/service.ts";
import { createServiceMcp } from "../../packages/network/service/serve.ts";
import type { NetworkRuntime } from "../../packages/network/service/runtime.ts";
import { EVIDENCE_RETENTION_DAYS } from "../../packages/network/src/safety.ts";
import { DAY } from "../../packages/core/src/index.ts";
import { APPS, type AppId } from "../../packages/platform/src/apps.ts";
import { LocalDiskPhotoStorage } from "../../packages/platform/src/photos.ts";
import { MemoryOAuthStore, type McpAppId } from "../../packages/mcp/src/index.ts";
import type { StaffUser } from "../../packages/observatory/src/types.ts";
import type { MemberId } from "../../packages/core/src/index.ts";

const ENV = { PLATFORM_ENV: "dev" };
const SAFETY: StaffUser = { id: "safety@test.example", roles: ["safety"], grants: [{ role: "safety", app: "*" }], via: "token" };
const PHONE = { ana: "+12125550101", ben: "+12125550102", cara: "+12125550103", dev: "+12125550104", eve: "+12125550105" };

let url = "", sql: SQL, svc: NetworkService, photoDir = "";
const oauth = new MemoryOAuthStore();
const clock = { t: Date.UTC(2026, 9, 6, 16, 0, 0) };

beforeAll(async () => {
  if (!pgAvailable) return;
  url = await migratedDb("safety_line");
  sql = new SQL({ url, max: 2 });
  photoDir = mkdtempSync(join(tmpdir(), "safety-photos-"));
  svc = new NetworkService({
    url, networks: [{ id: "slop:nyc" }, { id: "friends:nyc" }], env: ENV, notify: false, clock: { now: () => clock.t },
    photoStorage: new LocalDiskPhotoStorage(photoDir), log: () => {},
  });
  // The backend's MCP server (serve.ts) with a store the test can read: its forget and ban listeners revoke grants.
  await createServiceMcp(svc, { env: ENV, store: oauth, log: () => {}, now: () => clock.t });
}, 120_000);

afterAll(async () => {
  if (!pgAvailable) return;
  await svc?.close().catch(() => {});
  await sql?.close().catch(() => {});
  await dropDb(url);
  if (photoDir) rmSync(photoDir, { recursive: true, force: true });
});

const rt = (app: AppId) => svc.runtimeFor(app)!;
/** A web join (POST /api/join's path): the person, the membership, the network member and the welcome. */
async function joinApp(app: AppId, e164: string, firstName: string, age: number) {
  const r = await svc.accounts.join(APPS[app], { e164, personId: null }, { firstName, age, consent: { sms: true, version: APPS[app].consent.version } });
  if (!r.ok) throw new Error(`join ${app}: ${r.error}`);
  return { memberId: r.membership.memberId as MemberId, personId: r.membership.personId };
}
let seq = 0;
/** A text from the person's phone on the shared line. */
async function text(from: string, body: string) {
  clock.t += 60_000;
  return svc.inbound({ kind: "message", channel: "blooio" as never, messageId: `t${++seq}`, from, to: null, chatId: from, isGroup: false, text: body, mediaUrls: [], transport: "imessage" as never, receivedAt: clock.t });
}
/** A past meeting the Network booked between two members (both told), put into the network's stored state. */
async function met(r: NetworkRuntime, id: string, a: MemberId, b: MemberId) {
  const at = clock.t - DAY;
  await r.unitOfWork(n => {
    const st = n.exportState() as any;
    st.opps.push({
      id, origin: "request", kind: "intro", category: "romance", objective: "a date", detail: "a date", participants: [a, b], alternates: [], primed: [],
      status: [[a, "yes"], [b, "yes"]], explanations: {}, stage: "done", deadline: at + DAY, createdAt: at - DAY, score: 0.5, components: {}, generator: "test",
      exploration: false, sameDay: false, contacted: [a, b], reminded: [], tags: [], replacements: 0, feedbackFrom: [], meetingAt: at, venue: "Bryant Park",
      bookedTold: [a, b], bookedAt: { [a]: at - DAY, [b]: at - DAY }, feedbackSent: true,
    });
    n.importState(st);
  });
}
const personAge = async (personId: string) => (await sql`select lowest_age from platform.people where id = ${personId}::uuid`)[0]?.lowest_age;
const messagesOf = async (app: AppId, memberId: string) => Number((await sql`select count(*)::int as n from network.messages where app_id = ${app} and member_id = ${memberId}`)[0].n);

describe.skipIf(!pgAvailable)("safety across apps (Postgres)", () => {
  let ana: Awaited<ReturnType<typeof joinApp>>, ben: Awaited<ReturnType<typeof joinApp>>, benFriends: Awaited<ReturnType<typeof joinApp>>;

  test("migration 0019 applies on an empty database and on one at the previous schema", async () => {
    // migratedDb applied it from empty; now take it back to the schema before 0019 and run the runner again.
    await sql.unsafe(`drop function if exists platform.held_people(uuid[]); drop table if exists platform.person_safety; drop table if exists network.evidence_holds;
      delete from public.__migrations where id = '0019_person_safety'`);
    const r = await migrate(url, { lockTimeout: "5s" });
    expect(r.applied).toEqual(["0019_person_safety"]);
    // Idempotent: the file again changes nothing.
    await sql.unsafe(await Bun.file(new URL("../../packages/observatory/db/migrations/0019_person_safety.sql", import.meta.url).pathname).text());
    expect((await sql`select to_regclass('platform.person_safety') is not null as a, to_regclass('network.evidence_holds') is not null as b`)[0]).toEqual({ a: true, b: true });
  });

  test("a minor report lowers the person's age, deletes photos and ratings, and stops matching on a second app", async () => {
    ana = await joinApp("slop", PHONE.ana, "Ana", 31);
    ben = await joinApp("slop", PHONE.ben, "Ben", 29);
    benFriends = await joinApp("friends", PHONE.ben, "Ben", 29);
    expect(benFriends.personId).toBe(ben.personId);
    // Ben has a photo and a rating on slop.
    await sql`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at)
      values ('ph_test', ${ben.personId}::uuid, 'slop', repeat('0', 48), 'image/png', 10, 'x', '2026-10-08', now())`;
    await sql`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
      values ('slop', ${`${ben.memberId}:photo:ph_test`}, ${ben.memberId}, 'trait', 'photo rating', ${sql.array(["slop:rating:overall=6"], "TEXT")}, 'agent_private', 'inferred', 'photo_rater', 0.5, 'confirmed', now())`;
    await met(rt("slop"), "slop.o1", ana.memberId, ben.memberId);

    expect(await text(PHONE.ana, "report Ben, he's only 16")).toBe("handled");

    expect(await personAge(ben.personId)).toBe(MINOR_REPORT_AGE);
    expect((await sql`select count(*)::int as n from platform.photos where person_id = ${ben.personId}::uuid`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from network.facets where app_id = 'slop' and member_id = ${ben.memberId} and id like '%:photo:%'`)[0].n).toBe(0);
    expect([...(await sql`select reason, origin_app, hold from platform.person_safety where person_id = ${ben.personId}::uuid`)] as unknown[]).toEqual([{ reason: "minor_report", origin_app: "slop", hold: true }]);
    // No photo upload or rating either.
    expect(await svc.photos.adult(ben.personId, "slop")).toBe("adults_only");
    // On friends: a minor now (the member's age followed the person) and held: never in the pack's input.
    expect((await sql`select age from network.members where app_id = 'friends' and id = ${benFriends.memberId}`)[0].age).toBe(MINOR_REPORT_AGE);
    const onFriends = await rt("friends").readState(n => ({ held: n.isSafetyHeld(benFriends.memberId), eligible: n.eligible(benFriends.memberId), inPack: n.packInput(clock.t).members.some(m => m.id === benFriends.memberId) }));
    expect(onFriends).toEqual({ held: true, eligible: false, inPack: false });
  });

  test("a held person who deletes everything and joins again is still held, on every app", async () => {
    const cara = await joinApp("slop", PHONE.cara, "Cara", 33);
    await met(rt("slop"), "slop.o2", ana.memberId, cara.memberId);
    expect(await text(PHONE.ana, "report Cara, she threatened me")).toBe("handled");
    expect((await sql`select reason from platform.person_safety where person_id = ${cara.personId}::uuid and cleared_at is null`).map((r: any) => r.reason)).toEqual(["urgent_report"]);
    // The evidence hold: both people's messages are kept for EVIDENCE_RETENTION_DAYS.
    const holds = await sql`select distinct member_id from network.evidence_holds where app_id = 'slop' and until > ${new Date(clock.t)} order by member_id`;
    expect(holds.map((r: any) => r.member_id)).toEqual([ana.memberId, ben.memberId, cara.memberId].sort());
    const before = await messagesOf("slop", cara.memberId);
    expect(before).toBeGreaterThan(0);

    await svc.accounts.deleteAll({ e164: PHONE.cara, personId: cara.personId });
    // Forget kept her messages (staff only: the member row is emptied and removed).
    expect(await messagesOf("slop", cara.memberId)).toBe(before);
    expect((await sql`select account_status, name, person_id from network.members where app_id = 'slop' and id = ${cara.memberId}`)[0]).toEqual({ account_status: "removed", name: null, person_id: null });

    clock.t += DAY;
    const again = await joinApp("slop", PHONE.cara, "Cara", 33);
    expect(again.memberId).not.toBe(cara.memberId);
    const friendsToo = await joinApp("friends", PHONE.cara, "Cara", 33);
    expect(await rt("slop").readState(n => n.isSafetyHeld(again.memberId))).toBe(true);
    expect(await rt("friends").readState(n => n.isSafetyHeld(friendsToo.memberId) && !n.packInput(clock.t).members.some(m => m.id === friendsToo.memberId))).toBe(true);

    // Staff clear it (safety on every app): the person is matchable again.
    expect(await svc.clearPersonHold(SAFETY, rt("slop"), again.memberId, "reviewed the report: not supported")).toEqual({ ok: true });
    expect(await rt("slop").readState(n => n.isSafetyHeld(again.memberId))).toBe(false);
  });

  test("forget without a hold deletes; evidence goes when the hold expires", async () => {
    const dev = await joinApp("slop", PHONE.dev, "Dev", 40);
    expect(await messagesOf("slop", dev.memberId)).toBeGreaterThan(0);
    await svc.accounts.leave(APPS.slop, { e164: PHONE.dev, personId: dev.personId });
    expect(await messagesOf("slop", dev.memberId)).toBe(0);

    // Cara's kept messages (she deleted everything above) go once the retention ends.
    const caraOld = ((await sql`select member_id from network.evidence_holds e join network.members m on m.app_id = e.app_id and m.id = e.member_id where m.account_status = 'removed'`)[0] as any).member_id;
    expect(await messagesOf("slop", caraOld)).toBeGreaterThan(0);
    clock.t += (EVIDENCE_RETENTION_DAYS + 1) * DAY;
    await svc.purge();
    expect(await messagesOf("slop", caraOld)).toBe(0);
    expect((await sql`select count(*)::int as n from network.evidence_holds where until <= ${new Date(clock.t)}`)[0].n).toBe(0);
    // Ana is still a member: her messages stay (retention only removes what a member who left left behind).
    expect(await messagesOf("slop", ana.memberId)).toBeGreaterThan(0);
  });

  test("a ban revokes every OAuth grant of the person's phone; so does an under-13 decline", async () => {
    const grant = async (id: string, e164: string, app: McpAppId, personId: string) => oauth.putGrant({
      id, clientId: "client-test", app, phoneKey: svc.accounts.phoneHash(e164), personId, scopes: ["apps:read"], resource: `https://${APPS[app as AppId].domain}/mcp`,
      createdAt: clock.t, expiresAt: clock.t + 30 * DAY, revokedAt: null,
    });
    const live = (id: string) => oauth.grants.get(id)?.revokedAt === null;

    await grant("g-ana-slop", PHONE.ana, "slop", ana.personId);
    await grant("g-ana-friends", PHONE.ana, "friends", ana.personId);
    expect(await svc.ban(SAFETY, rt("slop"), ana.memberId, "person", "repeated harassment reports")).toEqual({ ok: true });
    expect([live("g-ana-slop"), live("g-ana-friends")]).toEqual([false, false]);

    // Eve joined at 15; then says she is 12: declined, every membership forgotten, and her grants go too.
    const eve = await joinApp("slop", PHONE.eve, "Eve", 15);
    await grant("g-eve-slop", PHONE.eve, "slop", eve.personId);
    expect(await text(PHONE.eve, "I am 12 years old")).toBe("handled");
    expect((await sql`select state from platform.memberships where person_id = ${eve.personId}::uuid`).map((r: any) => r.state)).toEqual(["removed"]);
    expect(live("g-eve-slop")).toBe(false);
  });
});
