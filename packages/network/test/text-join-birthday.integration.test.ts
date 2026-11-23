import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { MINUTE, SimClock } from "@thenetwork/core";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { LOOKING_FOR_ASK_MINOR, NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { brandOf, copyFor } from "../src/copy.ts";

const T = 300_000;
const START = Date.UTC(2026, 10, 22, 17);
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const DB = `network_text_join_birthday_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
const SECRET = "whsec_shared";
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

let sql: SQL;
let phoneSeq = 0;
const newPhone = () => `+1917555${String(1000 + ++phoneSeq).padStart(4, "0")}`;
let evt = 0;
const open: NetworkService[] = [];
const friendsCopy = copyFor(brandOf(APPS.friends));
const slopCopy = copyFor(brandOf(APPS.slop));
const ntwrkCopy = copyFor(brandOf(APPS.ntwrk));
const peonCopy = copyFor(brandOf(APPS.peon));

function service(clock: SimClock) {
  const directs: { app: string; to: string; body: string }[] = [];
  const s = new NetworkService({
    url: URL_, clock, instance: "birthday", log: () => {}, env: { PLATFORM_ENV: "dev" },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "slop:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }],
    tokens: "admin:adm-tok,safety:safe-tok", webhookSecret: SECRET, network: { seed: 1 },
    adapter: (_net, rt) => {
      const a = new DryRunAdapter(() => {});
      a.direct = async (to, body) => { directs.push({ app: rt.app.id, to, body }); return "dry_run"; };
      return a;
    },
  });
  open.push(s);
  return { s, directs };
}

async function text(s: NetworkService, clock: SimClock, from: string, body: string): Promise<string> {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}

const personOf = async (e164: string) => (await sql`select person_id::text as id from platform.phone_identities where e164 = ${e164}`)[0]?.id as string | undefined;
const birthDateOf = async (e164: string) => (await sql`select p.birth_date from platform.people p join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${e164}`)[0]?.birth_date ?? null;
const memberIdOf = async (app: AppId, e164: string) => (await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id
  where m.app_id = ${app} and ph.e164 = ${e164}`)[0]!.id as string;
const outbound = async (member: string) => (await sql`select body from network.messages where member_id = ${member} and direction = 'outbound' order by ts, id`).map((r: any) => r.body as string);
const signalsOf = async (person: string) => (await sql`select person_id from platform.person_minor_signals where person_id = ${person}::uuid`).length;
const birthRowOf = async (e164: string) => (await sql`select p.birth_date, p.birth_lower, p.birth_upper from platform.people p
  join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${e164}`)[0] as { birth_date: number | null; birth_lower: number | null; birth_upper: number | null };
async function expectExactBirth(e164: string, birthDate: number) {
  const row = await birthRowOf(e164);
  expect(row.birth_date).toBe(birthDate);
  expect(row.birth_upper).toBe(birthDate);
  expect(row.birth_lower!).toBeLessThan(row.birth_upper!);
}
const minorSignalOf = (s: NetworkService, id: string) => s.runtimeFor("friends")!.readState(n => n.memberList().find(x => x.id === id)?.minorSignal);
const teenReadyOf = (s: NetworkService, id: string) =>
  s.runtimeFor("friends")!.readState(n => (n as unknown as { rosterSideOf(memberId: string): { ready: boolean } }).rosterSideOf(id).ready);
const olderCasesOf = (s: NetworkService, id: string) =>
  s.runtimeFor("friends")!.readState(n => n.safetyCases().filter(c => c.memberId === id).flatMap(c => c.events).filter(e => e.kind === "older_than_stated").length);

async function agelessMember(s: NetworkService, clock: SimClock, app: AppId, e164: string, firstName: string): Promise<string> {
  const people = new PgPeopleStore(sql);
  const person = await people.createPerson({ id: randomUUID(), e164, method: "staff", at: clock.now(), lowestAge: null });
  const m = { app, personId: person.id, memberId: `${app}_${randomUUID()}`, state: "active" as const, review: null, firstName, profile: {}, joinedAt: clock.now(), leftAt: null };
  await people.putMembership(m);
  await people.addConsent({ e164, app, state: "opted_in", source: "staff", at: clock.now() });
  expect(await s.createMember(s.runtimeFor(app)!, m, { age: 30, firstName })).toBe(true);
  await sql`update network.members set age = null where id = ${m.memberId}`;
  expect(await sql`select age from platform.matching_ages where app_id = ${app} and member_id = ${m.memberId}`).toEqual([{ age: null }]);
  return m.memberId;
}

async function minorMember(s: NetworkService, clock: SimClock, app: AppId, e164: string, firstName: string, age: number): Promise<string> {
  const people = new PgPeopleStore(sql);
  const person = await people.createPerson({ id: randomUUID(), e164, method: "staff", at: clock.now(), lowestAge: null });
  const m = { app, personId: person.id, memberId: `${app}_${randomUUID()}`, state: "active" as const, review: null, firstName, profile: {}, joinedAt: clock.now(), leftAt: null };
  await people.putMembership(m);
  await people.addConsent({ e164, app, state: "opted_in", source: "staff", at: clock.now() });
  expect(await s.createMember(s.runtimeFor(app)!, m, { age, firstName })).toBe(true);
  return m.memberId;
}

const storedScopeTold = async (network: string, memberId: string) => (await sql`select m->>'minorScopeToldAt' as told from network.network_state s,
  jsonb_array_elements(s.state->'members') m where s.id = ${network} and m->>'id' = ${memberId}`)[0]?.told ?? null;

describe.skipIf(!pgAvailable)("text join by birthday (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    for (const s of open) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("the join question asks for the birthday, and a name with a birthday joins with an exact birth date", async () => {
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    await s.start();
    const sam = newPhone();
    expect(await text(s, clock, sam, "friends.help")).toBe("join_asked");
    expect(directs.at(-1)!.body).toBe(friendsCopy.joinAsk(APPS.friends.minJoinAge));
    expect(directs.at(-1)!.body).toContain("your birthday (month, day and year)");
    expect(await text(s, clock, sam, "Sam, March 15 2010")).toBe("joined");
    await expectExactBirth(sam, 20100315);
    expect(await outbound(await memberIdOf("friends", sam))).toContain(friendsCopy.welcomeMinor("Sam", "MinorTeenFriendNotice"));
  }, T);

  test("a teen who joins slop.date by text hears in the welcome that slop.date makes no dates under 18", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const kim = newPhone();
    expect(await text(s, clock, kim, "slop.date")).toBe("join_asked");
    expect(await text(s, clock, kim, "Kim, 3/15/2010")).toBe("joined");
    const sent = await outbound(await memberIdOf("slop", kim));
    expect(sent).toContain(slopCopy.welcomeMinor("Kim", "MinorSlopNotice"));
    expect(sent.some(b => b.includes(slopCopy.minorSlop))).toBe(true);
    expect(sent).not.toContain(slopCopy.welcomeMinor("Kim", "MinorSinglePlayerNotice"));
  }, T);

  test("a birthday sent as the answer to the age question is stored as an exact birth date", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const dee = newPhone();
    const id = await agelessMember(s, clock, "friends", dee, "Dee");
    await text(s, clock, dee, "hi");
    expect((await outbound(id)).at(-1)).toBe(friendsCopy.welcomeAskAge("Dee"));
    await s.runtimeFor("friends")!.deliver();
    await text(s, clock, dee, "3/15/2010");
    await expectExactBirth(dee, 20100315);
  }, T);

  test("a numeric birthday whose month is not clear is not stored: the line asks which date it is, and the month as a word is stored", async () => {
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    await s.start();
    const eve = newPhone();
    const id = await agelessMember(s, clock, "friends", eve, "Eve");
    await text(s, clock, eve, "hi");
    await s.runtimeFor("friends")!.deliver();
    await text(s, clock, eve, "01/12/2009");
    expect((await outbound(id)).at(-1)).toBe(friendsCopy.birthdayWhich("January 12, 2009", "December 1, 2009"));
    expect((await birthRowOf(eve)).birth_date).toBeNull();
    await s.runtimeFor("friends")!.deliver();
    await text(s, clock, eve, "December 1, 2009");
    await expectExactBirth(eve, 20091201);
    const ida = newPhone();
    expect(await text(s, clock, ida, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, ida, "Ida, 01/12/2009")).toBe("join_asked");
    expect(directs.at(-1)!.body).toBe(friendsCopy.birthdayWhich("January 12, 2009", "December 1, 2009"));
    expect(await personOf(ida)).toBeUndefined();
    expect(await text(s, clock, ida, "December 1, 2009")).toBe("joined");
    await expectExactBirth(ida, 20091201);
  }, T);

  test("a past date in a join answer that a typed age or another number contradicts is no birthday: nothing is declined or stored, and the line asks again", async () => {
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    await s.start();
    const sam = newPhone(), ari = newPhone();
    expect(await text(s, clock, sam, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, sam, "Sam, moved here 3/15/2024, 29")).toBe("join_asked");
    expect(directs.at(-1)!.body).toBe(friendsCopy.joinAsk(APPS.friends.minJoinAge));
    expect(await personOf(sam)).toBeUndefined();
    expect(await text(s, clock, sam, "29")).toBe("joined");
    expect((await birthRowOf(sam)).birth_date).toBeNull();
    expect(await text(s, clock, ari, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, ari, "Ari 29 3/15/2024")).toBe("join_asked");
    expect(await personOf(ari)).toBeUndefined();
    expect(await text(s, clock, ari, "Ari 29")).toBe("joined");
    expect((await birthRowOf(ari)).birth_date).toBeNull();
  }, T);

  test("a birthday stated on an open turn is stored as an exact birth date", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const kit = newPhone();
    expect(await text(s, clock, kit, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, kit, "Kit 16")).toBe("joined");
    expect((await birthRowOf(kit)).birth_date).toBeNull();
    await text(s, clock, kit, "my birthday is March 15, 2010 and I like chess");
    await expectExactBirth(kit, 20100315);
  }, T);

  test("a teen who joins with a birthday is teen ready with no staff step, opens no signal, and stays ready after stating their true age", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const kim = newPhone();
    expect(await text(s, clock, kim, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, kim, "Kim, 3/15/2011")).toBe("joined");
    const friends = s.runtimeFor("friends")!;
    await friends.tick();
    const id = await memberIdOf("friends", kim);
    expect(await outbound(id)).toContain(friendsCopy.welcomeMinor("Kim", "MinorTeenFriendNotice"));
    expect(await minorSignalOf(s, id)).toBe(false);
    expect(await signalsOf((await personOf(kim))!)).toBe(0);
    expect(await teenReadyOf(s, id)).toBe(true);
    await text(s, clock, kim, "I'm 15");
    await text(s, clock, kim, "I'm in 10th grade btw");
    await friends.tick();
    expect(await minorSignalOf(s, id)).toBe(false);
    expect(await teenReadyOf(s, id)).toBe(true);
    expect(await signalsOf((await personOf(kim))!)).toBe(0);
  }, T);

  test("a minor's looking-for question offers friends only: \"friends and work\" enrolls friends.help alone and \"dating\" enrolls nothing", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const pia = newPhone(), rae = newPhone();
    expect(await text(s, clock, pia, "hey there")).toBe("join_asked");
    expect(await text(s, clock, pia, "Pia, 3/15/2011")).toBe("joined");
    const sent = await outbound(await memberIdOf("ntwrk", pia));
    expect(sent).toContain(ntwrkCopy.welcomeMinor("Pia", "MinorTeenFriendNotice"));
    expect(sent).toContain(LOOKING_FOR_ASK_MINOR);
    expect(LOOKING_FOR_ASK_MINOR).not.toMatch(/\b(work|dating|both)\b/i);
    expect(LOOKING_FOR_ASK_MINOR).toContain("Reply FRIENDS to start.");
    expect(await text(s, clock, pia, "friends and work")).toBe("handled");
    const apps = async (e164: string) => (await sql`select m.app_id, m.state from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id
      where ph.e164 = ${e164} order by m.app_id`).map((r: any) => `${r.app_id}:${r.state}`);
    expect(await apps(pia)).toEqual(["friends:active", "ntwrk:active"]);
    expect(await text(s, clock, rae, "hey there")).toBe("join_asked");
    expect(await text(s, clock, rae, "Rae, 3/15/2011")).toBe("joined");
    expect(await text(s, clock, rae, "dating")).toBe("handled");
    expect(await apps(rae)).toEqual(["ntwrk:active"]);
  }, T);

  test("a minor who is already a slop.date member hears once that slop.date makes no dates for them", async () => {
    const clock = new SimClock(START);
    const first = service(clock);
    await first.s.start();
    const bo = newPhone();
    expect(await text(first.s, clock, bo, "slop.date")).toBe("join_asked");
    expect(await text(first.s, clock, bo, "Bo, 3/15/2010")).toBe("joined");
    const id = await memberIdOf("slop", bo);
    expect(await storedScopeTold("slop:nyc", id)).not.toBeNull();
    expect((await outbound(id)).filter(b => b === slopCopy.minorSlop)).toHaveLength(0);
    await first.s.close();
    await sql`update network.network_state set state = jsonb_set(state, '{members}',
      (select jsonb_agg(m - 'minorScopeToldAt') from jsonb_array_elements(state->'members') m)) where id = 'slop:nyc'`;
    expect(await storedScopeTold("slop:nyc", id)).toBeNull();
    const second = service(clock);
    await second.s.start();
    expect(await text(second.s, clock, bo, "hey, what's up")).toBe("handled");
    expect((await outbound(id)).filter(b => b === slopCopy.minorSlop)).toHaveLength(1);
    expect(await storedScopeTold("slop:nyc", id)).not.toBeNull();
    await text(second.s, clock, bo, "any ideas for saturday?");
    expect((await outbound(id)).filter(b => b === slopCopy.minorSlop)).toHaveLength(1);
  }, T);

  test("a minor member of peon.biz hears in the welcome that peon.biz finds no work for them, and is not told again", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const pat = newPhone();
    const id = await minorMember(s, clock, "peon", pat, "Pat", 16);
    await text(s, clock, pat, "hi");
    expect(await outbound(id)).toContain(peonCopy.welcomeMinor("Pat", "MinorPeonNotice"));
    expect(await storedScopeTold("peon:nyc", id)).not.toBeNull();
    await text(s, clock, pat, "can you help me find a summer job?");
    expect((await outbound(id)).filter(b => b === peonCopy.minorPeon)).toHaveLength(0);
  }, T);

  test("an ageless slop.date member who answers the age question with a teen birthday hears the slop sentence once", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const lu = newPhone();
    const id = await agelessMember(s, clock, "slop", lu, "Lu");
    await text(s, clock, lu, "hi");
    expect((await outbound(id)).at(-1)).toBe(slopCopy.welcomeAskAge("Lu"));
    await s.runtimeFor("slop")!.deliver();
    await text(s, clock, lu, "3/15/2010");
    await expectExactBirth(lu, 20100315);
    expect((await outbound(id)).filter(b => b === slopCopy.minorSlop)).toHaveLength(1);
    expect(await storedScopeTold("slop:nyc", id)).not.toBeNull();
    await s.runtimeFor("slop")!.deliver();
    await text(s, clock, lu, "ok");
    expect((await outbound(id)).filter(b => b === slopCopy.minorSlop)).toHaveLength(1);
  }, T);

  test("a minor who is already a peon.biz member hears once with their next message that peon.biz finds no work for them", async () => {
    const clock = new SimClock(START);
    const first = service(clock);
    await first.s.start();
    const ray = newPhone();
    const id = await minorMember(first.s, clock, "peon", ray, "Ray", 16);
    await text(first.s, clock, ray, "hi");
    expect(await outbound(id)).toContain(peonCopy.welcomeMinor("Ray", "MinorPeonNotice"));
    expect((await outbound(id)).filter(b => b === peonCopy.minorPeon)).toHaveLength(0);
    await first.s.close();
    await sql`update network.network_state set state = jsonb_set(state, '{members}',
      (select jsonb_agg(m - 'minorScopeToldAt') from jsonb_array_elements(state->'members') m)) where id = 'peon:nyc'`;
    expect(await storedScopeTold("peon:nyc", id)).toBeNull();
    const second = service(clock);
    await second.s.start();
    await text(second.s, clock, ray, "can you look at my resume?");
    expect((await outbound(id)).filter(b => b === peonCopy.minorPeon)).toHaveLength(1);
    expect(await storedScopeTold("peon:nyc", id)).not.toBeNull();
    await text(second.s, clock, ray, "thanks, anything else?");
    expect((await outbound(id)).filter(b => b === peonCopy.minorPeon)).toHaveLength(1);
  }, T);

  test("a friends.help member with a stored minor signal who gives an exact teen birthday hears the single-player notice, never the birthday ask or the teen notice", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const lee = newPhone();
    const id = await agelessMember(s, clock, "friends", lee, "Lee");
    const person = (await personOf(lee))!;
    await sql`insert into platform.person_minor_signals (person_id, at) values (${person}::uuid, ${new Date(clock.now())}::timestamptz)`;
    expect(await signalsOf(person)).toBe(1);
    await text(s, clock, lee, "hi");
    await s.runtimeFor("friends")!.deliver();
    await text(s, clock, lee, "3/15/2011");
    await expectExactBirth(lee, 20110315);
    await text(s, clock, lee, "what can you do for me?");
    const sent = await outbound(id);
    expect(sent).toContain(friendsCopy.minorNotice);
    expect(sent.some(b => b.includes(friendsCopy.minorBirthdayAsk))).toBe(false);
    expect(sent.some(b => b.includes(friendsCopy.minorTeenFriends))).toBe(false);
    expect(sent).not.toContain(friendsCopy.welcomeMinor("Lee", "MinorTeenFriendNotice"));
    expect(await teenReadyOf(s, id)).toBe(false);
  }, T);

  test("a member whose age is in doubt hears the single-player notice and never the birthday ask", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const jo = newPhone();
    expect(await text(s, clock, jo, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, jo, "Jo, 25")).toBe("joined");
    const id = await memberIdOf("friends", jo);
    await text(s, clock, jo, "I'm 16");
    expect(await minorSignalOf(s, id)).toBe(true);
    const sent = await outbound(id);
    expect(sent).toContain(friendsCopy.minorNotice);
    expect(sent.some(b => b.includes(friendsCopy.minorBirthdayAsk))).toBe(false);
    expect(sent.some(b => b.includes(friendsCopy.minorTeenFriends))).toBe(false);
  }, T);

  test("an older age in the same message as a teen birthday, or two years above the birth date, is reported older than stated once", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const lu = newPhone(), mo = newPhone();
    expect(await text(s, clock, lu, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, lu, "Lu 16")).toBe("joined");
    const friends = s.runtimeFor("friends")!;
    await friends.tick();
    const luId = await memberIdOf("friends", lu);
    await text(s, clock, lu, "my birthday is 3/15/2010, I'm 24");
    expect(await friends.readState(n => n.memberList().find(x => x.id === luId)?.olderReported === true)).toBe(true);
    await text(s, clock, lu, "I'm 24");
    expect(await olderCasesOf(s, luId)).toBe(1);
    expect(await text(s, clock, mo, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, mo, "Mo, 2010-03-15")).toBe("joined");
    await friends.tick();
    const moId = await memberIdOf("friends", mo);
    await text(s, clock, mo, "I'm 17");
    expect(await friends.readState(n => n.memberList().find(x => x.id === moId)?.olderReported === true)).toBe(false);
    await text(s, clock, mo, "I'm 18");
    expect(await friends.readState(n => n.memberList().find(x => x.id === moId)?.olderReported === true)).toBe(true);
  }, T);

  test("a birthday without a name waits in the pending join with its birth date, and the name completes the join", async () => {
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    await s.start();
    const kit = newPhone();
    expect(await text(s, clock, kit, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, kit, "3/15/2010")).toBe("join_asked");
    expect(directs.at(-1)!.body).toBe(friendsCopy.joinNeedName);
    expect((await sql`select birth_date from platform.pending_texts where kind = 'join' and birth_date is not null`).map((r: any) => r.birth_date)).toContain(20100315);
    expect(await text(s, clock, kit, "Kit")).toBe("joined");
    expect(await birthDateOf(kit)).toBe(20100315);
  }, T);

  test("a birthday under 13 is the kind decline with no person and no birth date; a two-digit year is no answer; \"Sam 12\" is the decline", async () => {
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    await s.start();
    const lee = newPhone(), max = newPhone(), sam = newPhone();
    expect(await text(s, clock, lee, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, lee, "Lee, born 2013-11-23")).toBe("under_age");
    expect(directs.at(-1)!.body).toBe(APPS.friends.brand.underAge);
    expect(await personOf(lee)).toBeUndefined();
    expect(await text(s, clock, max, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, max, "Max, 3/15/10")).toBe("join_asked");
    expect(directs.at(-1)!.body).toBe(friendsCopy.joinAsk(APPS.friends.minJoinAge));
    expect(await personOf(max)).toBeUndefined();
    expect(await text(s, clock, sam, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, sam, "Sam 12")).toBe("under_age");
    expect(await personOf(sam)).toBeUndefined();
  }, T);

  test("on slop.date an adult record that says \"I'm 15\" opens a person signal and hears the slop sentence", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const jo = newPhone();
    expect(await text(s, clock, jo, "slop.date")).toBe("join_asked");
    expect(await text(s, clock, jo, "Jo, 25")).toBe("joined");
    const person = (await personOf(jo))!;
    expect(await signalsOf(person)).toBe(0);
    await text(s, clock, jo, "I'm 15");
    expect(await outbound(await memberIdOf("slop", jo))).toContain(slopCopy.minorSlop);
    expect(await outbound(await memberIdOf("slop", jo))).not.toContain(slopCopy.minorNotice);
    expect(await signalsOf(person)).toBe(1);
  }, T);

  test("a teen whose join answer states the age that the birthday gives opens no person signal", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const kim = newPhone();
    expect(await text(s, clock, kim, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, kim, "Kim, 3/15/2010, I'm 16")).toBe("joined");
    expect(await birthDateOf(kim)).toBe(20100315);
    expect(await signalsOf((await personOf(kim))!)).toBe(0);
  }, T);

  test("a member with a teen birth date who says \"lol I'm 24 actually\" on an open turn is reported older than stated", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const ana = newPhone();
    expect(await text(s, clock, ana, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, ana, "Ana, 2010-03-15")).toBe("joined");
    const friends = s.runtimeFor("friends")!;
    await friends.tick();
    const id = await memberIdOf("friends", ana);
    expect(await friends.readState(n => n.memberList().find(x => x.id === id)?.olderReported === true)).toBe(false);
    await text(s, clock, ana, "lol I'm 24 actually");
    expect(await friends.readState(n => n.memberList().find(x => x.id === id)?.olderReported === true)).toBe(true);
  }, T);
});
