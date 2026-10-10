// The service as the platform's text channel and backend (founder decisions of 2026-10-08, PRD 40.3,
// audit 2026-10-08 network-service-*, platform-*): one line for every app, joins with no keyword,
// STOP versus leave, the lowest age across apps, restarts, the row-level security role, the consent
// ledger on every send, and the production boot checks. Postgres in a database of its own per test
// process. Nothing is sent: dry-run adapters, or Blooio with a fake provider; OTP codes come from a fake.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APPS, POWERED_BY, type AppId } from "../../platform/src/apps.ts";
import { lastEvents, resolveConsent } from "../../platform/src/consent.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { BlooioAdapter, DryRunAdapter, type ChannelAdapter, type Delivery, type Outbound } from "../service/channel.ts";
import { enrolledText, LOOKING_FOR_ASK, LOOKING_FOR_ASK_MINOR, NetworkService, WEBHOOK_PATH, type ServiceOptions } from "../service/service.ts";
import { brandOf, copyFor } from "../src/copy.ts";
import { START } from "./mini.ts";

const T = 300_000;
const REPO = resolve(import.meta.dir, "../../..");
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_service_platform_test_${process.pid}`;
const ROLE = `svc_rls_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string, url = ADMIN_URL) { const sql = new SQL({ url, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_shared", APP_SECRET = "whsec_app";
const NETS = [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }, { id: "slop:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }];
let phoneSeq = 0;
/** Fictional numbers only (+1 212 555 01xx). */
const newPhone = () => `+121255501${String(10 + ++phoneSeq).padStart(2, "0")}`;

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  sent = 0;
  async send(e164: string) { this.sent++; const code = String(100000 + this.sent * 7919); this.codes.set(e164, code); return { code }; }
}

let sql: SQL;
const open: NetworkService[] = [];
interface Direct { app: string; to: string; body: string }

function service(clock: SimClock, more: Partial<ServiceOptions> = {}) {
  const directs: Direct[] = [];
  const otp = new FakeOtp();
  const s = new NetworkService({
    url: URL_, clock, instance: "platform", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: NETS,
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, webhookSecrets: { friends: APP_SECRET, slop: APP_SECRET },
    network: { seed: 1 }, publicApi: { otp, minStartMs: 0, minVerifyMs: 0 },
    adapter: (_net, rt) => {
      const a = new DryRunAdapter(() => {});
      a.direct = async (to, body) => { directs.push({ app: rt.app.id, to, body }); return "dry_run"; };
      return a;
    },
    ...more,
  });
  open.push(s);
  return { s, directs, otp };
}

let evt = 0;
function webhook(clock: SimClock, from: string, body: string, o: { app?: AppId; id?: number } = {}) {
  const n = o.id ?? ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  return () => new Request(`http://127.0.0.1${WEBHOOK_PATH}${o.app ? `/${o.app}` : ""}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(o.app ? APP_SECRET : SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  });
}
async function text(s: NetworkService, clock: SimClock, from: string, body: string, o: { app?: AppId } = {}) {
  const res = await s.fetch(webhook(clock, from, body, o)());
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const one = async (q: Promise<any[]>): Promise<any> => (await q)[0];
const count = async (q: Promise<any[]>) => (await q)[0].n as number;
const memberOf = async (app: AppId, e164: string) =>
  (await sql`select m.id, m.account_status, m.opted_out, m.age from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string; account_status: string; opted_out: boolean; age: number | null } | undefined;
const outbound = async (member: string) => (await sql`select id, body, type, system, status from network.messages where member_id = ${member} and direction = 'outbound' order by ts, id`) as any[];
const consentOf = async (e164: string, app: AppId) => resolveConsent(lastEvents((await sql`select e164, app_id as app, state, source, extract(epoch from at) * 1000 as at from platform.consent_events where e164 = ${e164} order by id`).map((r: any) => ({ ...r, at: Number(r.at) })), e164, app));
const lowestAge = async (e164: string) => (await sql`select p.lowest_age from platform.people p join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${e164}`)[0]?.lowest_age as number | undefined;

/** The public API on the service, as a site calls it (dev host names). */
function site(s: NetworkService, clock: SimClock, otp: FakeOtp) {
  const jar = new Map<AppId, string>();
  const host = (app: AppId) => `localhost:${5101 + ["ntwrk", "slop", "peon", "friends"].indexOf(app)}`;
  const call = async (app: AppId, method: string, path: string, b?: unknown) => {
    const res = await s.publicFetch(new Request(`http://127.0.0.1:8790${path}`, {
      method, headers: { host: host(app), "content-type": "application/json", ...(jar.get(app) ? { cookie: jar.get(app)! } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}),
    }));
    const c = res.headers.get("set-cookie");
    if (c) jar.set(app, c.split(";")[0]!);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const login = async (app: AppId, phone: string) => {
    clock.advance(31_000);
    expect((await call(app, "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    expect((await call(app, "POST", "/api/auth/otp/verify", { phone, code: otp.codes.get(phone) })).status).toBe(200);
  };
  const join = (app: AppId, age: number, firstName = "Rae") => call(app, "POST", "/api/join", { firstName, age, consent: { sms: true, wording: APPS[app].consent.text } });
  return { call, login, join };
}

describe.skipIf(!pgAvailable)("the service as the platform's channel (Postgres)", () => {
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
    await admin(`drop role if exists ${ROLE}`).catch(() => {});
  });
  const fresh = async () => { await applySchema(URL_, { reset: true, lockTimeout: "5s" }); };

  test("end to end: one phone joins two apps (by text on the shared line and on the web), STOP stops both, START resumes one, leave forgets one", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const web = site(s, clock, otp);
    const p = newPhone();
    expect(await text(s, clock, p, "slop.date")).toBe("join_asked");
    expect(await text(s, clock, p, "Ana, 29")).toBe("joined");
    await web.login("friends", p);
    expect((await web.join("friends", 29, "Ana")).status).toBe(200);
    // One person, two memberships, two network members, one opt-in per app.
    expect(await count(sql`select count(*)::int as n from platform.people`)).toBe(1);
    expect((await sql`select app_id, state from platform.memberships order by app_id`).map((r: any) => `${r.app_id}:${r.state}`)).toEqual(["friends:active", "slop:active"]);
    const sl = (await memberOf("slop", p))!, fr = (await memberOf("friends", p))!;
    expect([sl.account_status, fr.account_status]).toEqual(["active", "active"]);
    expect((await sql`select app_id, source from platform.consent_events where e164 = ${p} order by id`).map((r: any) => `${r.app_id}:${r.source}`)).toEqual(["slop:inbound_message", "friends:web_form"]);
    // Each site sees only its own app.
    const me = await web.call("friends", "GET", "/api/me");
    expect(JSON.stringify(me.body)).not.toContain("slop");

    // STOP on the shared line: every app, one ledger event for all apps.
    expect(await text(s, clock, p, "STOP")).toBe("handled");
    expect((await sql`select app_id, ref from platform.consent_events where e164 = ${p} and state = 'opted_out'`).map((r: any) => r.app_id)).toEqual([null]);
    expect([await consentOf(p, "slop"), await consentOf(p, "friends")]).toEqual(["opted_out", "opted_out"]);
    expect([(await memberOf("slop", p))!.opted_out, (await memberOf("friends", p))!.opted_out]).toEqual([true, true]);
    // START on slop's own line: slop only.
    expect(await text(s, clock, p, "START", { app: "slop" })).toBe("handled");
    expect([await consentOf(p, "slop"), await consentOf(p, "friends")]).toEqual(["opted_in", "opted_out"]);
    // "leave slop.date": slop forgets them; the friends membership stays (paused by the STOP).
    expect(await text(s, clock, p, "leave slop.date")).toBe("left");
    expect((await sql`select app_id, state from platform.memberships order by app_id`).map((r: any) => `${r.app_id}:${r.state}`)).toEqual(["friends:paused", "slop:removed"]);
    expect(await one(sql`select account_status, name from network.members where id = ${sl.id}`)).toEqual({ account_status: "removed", name: null });
    expect(await count(sql`select count(*)::int as n from network.messages where member_id = ${sl.id}`)).toBe(0);
  }, T);

  test("no keyword: the person joins The Network, is asked what they are looking for, and is enrolled in those apps (each age-checked); a restart in between loses nothing", async () => {
    await fresh();
    const clock = new SimClock(START);
    const a = service(clock);
    const mo = newPhone();
    expect(await text(a.s, clock, mo, "hey there")).toBe("join_asked");
    expect(a.directs.at(-1)).toEqual({ app: "ntwrk", to: mo, body: copyFor(brandOf(APPS.ntwrk)).joinAsk(13) });
    expect(await text(a.s, clock, mo, "Mo, 30")).toBe("joined");
    const nm = (await memberOf("ntwrk", mo))!;
    expect((await outbound(nm.id)).map(m => m.body)).toContain(LOOKING_FOR_ASK);
    expect(LOOKING_FOR_ASK).toContain(POWERED_BY);
    expect(await count(sql`select count(*)::int as n from platform.pending_texts where kind = 'looking_for'`)).toBe(1);
    await a.s.close();

    // Another process answers: the pending question is in Postgres.
    const b = service(clock);
    expect(await text(b.s, clock, mo, "dating and friends please")).toBe("handled");
    expect((await sql`select app_id, state from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id where ph.e164 = ${mo} order by app_id`).map((r: any) => `${r.app_id}:${r.state}`))
      .toEqual(["friends:active", "ntwrk:active", "slop:active"]);
    for (const app of ["friends", "slop"] as AppId[]) expect((await memberOf(app, mo))!).toMatchObject({ account_status: "active", age: 30 });
    expect((await outbound(nm.id)).at(-1).body).toBe(enrolledText([APPS.slop, APPS.friends].sort((x, y) => ["friends", "slop"].indexOf(x.id) - ["friends", "slop"].indexOf(y.id))));
    expect((await outbound(nm.id)).at(-1).body).toContain(POWERED_BY);
    expect(await count(sql`select count(*)::int as n from platform.pending_texts`)).toBe(0);
    // The consent per app names the question the person answered.
    expect((await sql`select app_id, source, wording from platform.consent_events where e164 = ${mo} and source = 'looking_for' order by app_id`).map((r: any) => [r.app_id, r.wording]))
      .toEqual([["friends", LOOKING_FOR_ASK], ["slop", LOOKING_FOR_ASK]]);

    // A 15-year-old may join every app (founder decision 1) and is single-player everywhere: the members carry age 15.
    const kai = newPhone();
    await text(b.s, clock, kai, "hi");
    expect(await text(b.s, clock, kai, "Kai 15")).toBe("joined");
    // The question a minor gets never mentions dating, and its consent wording carries the SMS disclosure.
    const kn = (await memberOf("ntwrk", kai))!;
    expect((await outbound(kn.id)).map(m => m.body)).toContain(LOOKING_FOR_ASK_MINOR);
    expect(LOOKING_FOR_ASK_MINOR).not.toMatch(/dating/i);
    for (const t of [LOOKING_FOR_ASK, LOOKING_FOR_ASK_MINOR]) expect(t).toMatch(/Message frequency varies\. Message and data rates may apply\. Reply STOP to stop, HELP for help\./);
    // "dating" (or "all of these") from a 15-year-old never enrolls slop.date (before: active slop member, "you're in slop.date").
    expect(await text(b.s, clock, kai, "all of these, dating too")).toBe("handled");
    for (const app of ["friends", "peon"] as AppId[]) expect((await memberOf(app, kai))!).toMatchObject({ account_status: "active", age: 15 });
    expect(await memberOf("slop", kai)).toBeUndefined();
    expect((await outbound(kn.id)).at(-1).body).not.toMatch(/slop/);
    expect((await sql`select distinct wording from platform.consent_events where e164 = ${kai} and source = 'looking_for'`).map((r: any) => r.wording)).toEqual([LOOKING_FOR_ASK_MINOR]);
    // A 12-year-old is declined kindly and nothing is stored.
    const kid = newPhone();
    await text(b.s, clock, kid, "hello");
    expect(await text(b.s, clock, kid, "Lu 12")).toBe("under_age");
    expect(await count(sql`select count(*)::int as n from platform.phone_identities where e164 = ${kid}`)).toBe(0);
  }, T);

  test("lowest age across apps: an age stated in chat on one app follows the person to every app and to a later web join", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const web = site(s, clock, otp);
    const p = newPhone();
    expect(await text(s, clock, p, "Lee 25", { app: "friends" })).toBe("joined");
    expect(await text(s, clock, p, "slop")).toBe("join_asked");
    expect(await text(s, clock, p, "Lee 25")).toBe("joined");
    // In the friends chat: "I'm 16 years old" (first person, present tense).
    expect(await text(s, clock, p, "actually I am 16 years old", { app: "friends" })).toBe("handled");
    expect(await lowestAge(p)).toBe(16);
    expect((await memberOf("slop", p))!.age).toBe(16);
    // A later web join with an older age gets the lowest age.
    await web.login("peon", p);
    expect((await web.join("peon", 30)).status).toBe(200);
    expect((await memberOf("peon", p))!.age).toBe(16);
  }, T);

  test("SVC-03 an attested adult who says 'I am 12 years old' is held, not deleted: rows stay, other apps treat them as a minor", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "Dee 30", { app: "friends" })).toBe("joined");
    expect(await text(s, clock, p, "slop")).toBe("join_asked");
    expect(await text(s, clock, p, "Dee 30")).toBe("joined");
    const fr = (await memberOf("friends", p))!;
    expect(await text(s, clock, p, "I act like I am 12 years old around my nephew", { app: "friends" })).toBe("handled");
    expect(await lowestAge(p)).toBe(30);
    expect(await text(s, clock, p, "I am 12 years old", { app: "friends" })).toBe("handled");
    expect(await one(sql`select account_status, name from network.members where id = ${fr.id}`)).toEqual({ account_status: "active", name: "Dee" });
    expect(await count(sql`select count(*)::int as n from network.messages where member_id = ${fr.id} and direction = 'inbound'`)).toBeGreaterThanOrEqual(3);
    expect((await sql`select state from platform.memberships order by app_id`).map((r: any) => r.state)).toEqual(["active", "active"]);
    expect(await count(sql`select count(*)::int as n from network.events where app_id = 'friends' and type = 'network_log' and payload->>'kind' = 'age_conflict'`)
      + await count(sql`select count(*)::int as n from network.events where app_id = 'friends' and type = 'age_conflict'`)).toBeGreaterThanOrEqual(1);
    // The other app's member is a minor now (never matched), and still there.
    expect((await memberOf("slop", p))!).toMatchObject({ account_status: "active", age: 13 });
  }, T);

  test("SVC-04 and SVC-05 after a restart, a waiting reply is sent once; a stale proactive row and an old row expire unsent", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Wu 33", { app: "friends" });
    const m = (await memberOf("friends", p))!;
    const row = (id: string, status: string, ago: number, proactive: boolean) =>
      sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, proactive, system, ts) values ('friends', ${id}, ${m.id}, 'outbound', 'imessage', ${`body ${id}`}, ${status}, ${proactive}, false, ${new Date(clock.now() - ago)})`;
    await row("w-reply", "deferred_quiet_hours", HOUR, false);
    await row("w-probe-old", "queued", 30 * HOUR, true);
    await row("w-ancient", "queued", 4 * DAY, false);
    await s.close();
    const flags = { BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1", FRIENDS_LIVE_APPROVED: "1" };
    const sent: SendRequest[] = [];
    const provider = { kind: "blooio" as const, send: async (r: SendRequest) => { sent.push(r); return { providerMessageId: `p${sent.length}`, status: "queued" as const }; } };
    const live = { adapter: (net: any, rt: any) => new BlooioAdapter({ from: "+12125550100", net, provider, clock, memberOf: rt.memberOf, env: flags, app: rt.app.id, log: () => {} }) };
    const { s: seeder } = service(clock, live);
    await seeder.start();
    const queue = (seeder.runtimeFor("friends")!.adapter as BlooioAdapter).queue;
    await queue.inbound(p);
    await queue.enqueue(sql, [
      { id: "w-reply", memberId: m.id, to: p, kind: "reply", text: "body w-reply", city: "nyc" },
      { id: "w-probe-old", memberId: m.id, to: p, kind: "proactive", text: "body w-probe-old", city: "nyc" },
      { id: "w-ancient", memberId: m.id, to: p, kind: "reply", text: "body w-ancient", city: "nyc" },
    ]);
    for (const [id, ago] of [["w-reply", HOUR], ["w-probe-old", 30 * HOUR], ["w-ancient", 4 * DAY]] as const)
      await sql`update platform.outbound set created_at = ${new Date(clock.now() - ago)} where id = ${id}`;
    await seeder.close();
    for (let i = 0; i < 2; i++) {
      const { s: again } = service(clock, live);
      await again.start();
      await again.close();
    }
    expect(sent.filter(r => r.text === "body w-reply").length).toBe(1);
    expect(sent[0]!.idempotencyKey).toBe("tn:w-reply");
    expect(sent.filter(r => r.text !== "body w-reply").length).toBe(0);
    const st = Object.fromEntries((await sql`select id, status from network.messages where id like 'w-%'`).map((r: any) => [r.id, r.status]));
    expect(st["w-probe-old"]).toBe("expired");
    expect(st["w-ancient"]).toBe("expired");
    expect(st["w-reply"]).not.toBe("expired");
  }, T);

  test("SVC-06 the service runs under a non-superuser login with the network_service role: state loads, saves and survives a restart", async () => {
    await fresh();
    await admin(`drop role if exists ${ROLE}`).catch(() => {});
    await admin(`create role ${ROLE} login nosuperuser nobypassrls`);
    await admin(`grant network_service to ${ROLE}`);
    await admin(`grant connect on database ${DB} to ${ROLE}`);
    const rlsUrl = `postgres://${ROLE}@localhost:${DEV_PG_PORT}/${DB}`;
    const clock = new SimClock(START);
    const a = service(clock, { url: rlsUrl, auditUrl: URL_, log: l => { if (l.includes("failed")) console.log("LOG", l); } });
    await a.s.start();
    const p = newPhone();
    expect(await text(a.s, clock, p, "Ro 31", { app: "friends" })).toBe("joined");
    const m = (await memberOf("friends", p))!;
    // An admin turns matching on (the stored switch), then a tick.
    expect((await a.s.fetch(new Request("http://127.0.0.1/apps/friends/matching", { method: "POST", headers: { authorization: "Bearer adm-tok", "content-type": "application/json" }, body: JSON.stringify({ on: true }) }))).status).toBe(200);
    expect(await a.s.runtimeFor("friends")!.tick()).toBe(true);
    await a.s.close();
    // A restart under the same login: the state is read back (before the fix: nothing, and a fresh Network overwrote it).
    const b = service(clock, { url: rlsUrl, auditUrl: URL_ });
    await b.s.start();
    expect(await text(b.s, clock, p, "More time outdoors.", { app: "friends" })).toBe("handled");
    const state = (await one(sql`select state from network.network_state where id = 'friends:nyc'`)).state;
    const st = typeof state === "string" ? JSON.parse(state) : state;
    expect(st.matchingEnabled).toBe(true);
    expect(st.members.find((x: any) => x.id === m.id).msgsIn).toBe(2);
    const bodies = (await outbound(m.id)).map(x => x.body);
    expect(new Set(bodies).size).toBe(bodies.length); // no welcome twice
    expect((await (await b.s.fetch(new Request("http://127.0.0.1/health?app=friends", { headers: { authorization: "Bearer adm-tok" } }))).json()).matchingEnabled).toBe(true);
    // The export reads the member's rows under the role too.
    const rt = b.s.runtimeFor("friends")!;
    expect((await rt.scoped(tx => tx`select count(*)::int as n from network.messages where member_id = ${m.id}`))[0].n).toBeGreaterThan(0);
  }, T);

  test("SVC-07 and SVC-11: a member's opt-out in the database blocks sends; a STOP from a stranger holds until a fresh opt-in (a join)", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Ivy 28", { app: "friends" });
    const m = (await memberOf("friends", p))!;
    await sql`update network.members set opted_out = true where id = ${m.id}`;
    await text(s, clock, p, "what's on this weekend?", { app: "friends" });
    const last = (await outbound(m.id)).filter(x => !x.system).at(-1);
    expect(last.status).toBe("refused_opted_out");
    // A stranger's STOP is honoured: one ledger event; then a web join is a fresh opt-in.
    const q = newPhone();
    expect(await text(s, clock, q, "stop texting me")).toBe("stopped");
    expect(await consentOf(q, "slop")).toBe("opted_out");
    const web = site(s, clock, otp);
    await web.login("slop", q);
    expect((await web.join("slop", 40)).status).toBe(200);
    expect(await consentOf(q, "slop")).toBe("opted_in");
    expect((await outbound((await memberOf("slop", q))!.id)).map(x => x.status)).toEqual(["dry_run"]);
  }, T);

  test("SVC-10 a STOP survives a unit that fails once: one ledger event, opted out after the retry, one confirmation", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Ola 35", { app: "friends" });
    const m = (await memberOf("friends", p))!;
    const net = s.runtimeFor("friends")!.net;
    const orig = net.onInbound.bind(net);
    let fail = true;
    net.onInbound = async msg => { if (fail) { fail = false; throw new Error("boom"); } return orig(msg); };
    const req = webhook(clock, p, "STOP");
    const first = await s.fetch(req());
    expect(first.status).toBe(200);
    expect((await first.json()).result).toBe("retry_later");
    expect((await sql`select status, attempts from platform.inbound where id = ${`msg:blooio:msg_${evt}`}`)[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(await count(sql`select count(*)::int as n from platform.consent_events where e164 = ${p} and state = 'opted_out'`)).toBe(1);
    expect(await s.inbox.drain()).toBe(1);
    expect((await sql`select status from platform.inbound where id = ${`msg:blooio:msg_${evt}`}`)[0].status).toBe("done");
    expect((await s.fetch(req())).status).toBe(200);
    expect(await count(sql`select count(*)::int as n from platform.consent_events where e164 = ${p} and state = 'opted_out'`)).toBe(1);
    expect((await memberOf("friends", p))!.opted_out).toBe(true);
    expect((await outbound(m.id)).filter(x => x.system && x.body === APPS.friends.brand.stop).length).toBe(1);
  }, T);

  test("SVC-12 an adapter error after commit: the webhook answers 200 and the next tick delivers the row once", async () => {
    await fresh();
    const clock = new SimClock(START);
    let calls = 0, fails = 0;
    const delivered: string[] = [];
    const flaky = (): ChannelAdapter => ({
      name: "blooio", storedStatus: "queued",
      async deliver(msgs: Outbound[]): Promise<Delivery[]> { calls++; if (calls === 2) { fails++; throw new Error("provider down"); } delivered.push(...msgs.map(x => x.id)); return msgs.map(x => ({ id: x.id, status: "accepted" })); },
      async flush() { return []; },
      async direct() { return "accepted"; },
    });
    const { s } = service(clock, { adapter: () => flaky() });
    const p = newPhone();
    expect(await text(s, clock, p, "Pia 27", { app: "friends" })).toBe("joined");
    expect(await text(s, clock, p, "More friends nearby", { app: "friends" })).toBe("handled"); // its reply fails to hand over
    expect(fails).toBe(1);
    const m = (await memberOf("friends", p))!;
    const waiting = (await outbound(m.id)).filter(x => x.status === "queued").map(x => x.id);
    expect(waiting.length).toBe(1);
    await s.tick();
    expect(delivered.filter(id => id === waiting[0]).length).toBe(1);
    expect((await outbound(m.id)).every(x => x.status === "accepted")).toBe(true);
  }, T);

  test("SVC-15 an outbound id stored with other content fails the unit; the same content is idempotent", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Qi 26", { app: "friends" });
    const rt = s.runtimeFor("friends")!, m = (await memberOf("friends", p))!;
    await rt.unitOfWork(() => { rt.system(m.id, "fixed-id", "first text"); });
    await rt.unitOfWork(() => { rt.system(m.id, "fixed-id", "first text"); });
    await expect(rt.unitOfWork(() => { rt.system(m.id, "fixed-id", "another text"); })).rejects.toThrow("already stored");
    expect((await sql`select body from network.messages where id = 'fixed-id'`).map((r: any) => r.body)).toEqual(["first text"]);
  }, T);

  test("SVC-19 shared-line routing: a two-app member's reply goes to the app with the open item, not the app that wrote last", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Ren 32", { app: "friends" });
    await text(s, clock, p, "slop");
    await text(s, clock, p, "Ren 32");
    const sl = (await memberOf("slop", p))!, fr = (await memberOf("friends", p))!;
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, opportunity_id, proactive, system, ts) values ('slop', 'probe-1', ${sl.id}, 'outbound', 'imessage', 'probe', 'dry_run', 'opp-1', true, false, ${new Date(clock.now())})`;
    await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, proactive, system, ts) values ('friends', 'note-1', ${fr.id}, 'outbound', 'imessage', 'note', 'dry_run', false, false, ${new Date(clock.now() + MINUTE)})`;
    clock.advance(2 * MINUTE);
    expect(await text(s, clock, p, "yes! also my friend is on friends.help")).toBe("handled");
    expect((await sql`select app_id from network.messages where direction = 'inbound' and body like 'yes!%'`).map((r: any) => r.app_id)).toEqual(["slop"]);
  }, T);

  test("SVC-21 and SVC-24: malformed staff input gets 400 and no audit row; GET /review saves nothing", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.tick();
    const call = (method: string, path: string, b?: unknown) => s.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { authorization: "Bearer adm-tok", "content-type": "application/json" }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) }));
    const before = await count(sql`select count(*)::int as n from network.staff_audit`);
    expect((await call("POST", "/review/%E0%A4%A", { decision: "approve" })).status).toBe(400);
    expect((await call("POST", "/review/o1", { decision: "approve", note: 7 })).status).toBe(400);
    expect((await call("POST", "/review/o1", { decision: "approve", explanations: ["x"] })).status).toBe(400);
    expect((await call("POST", "/safety/lift", { memberId: "m", note: { x: 1 } })).status).toBe(400);
    expect(await count(sql`select count(*)::int as n from network.staff_audit`)).toBe(before);
    const saved = async () => (await one(sql`select saved_at from network.network_state where id = 'ntwrk:nyc'`)).saved_at.getTime();
    const t0 = await saved();
    await Bun.sleep(20);
    expect((await call("GET", "/review")).status).toBe(200);
    expect(await saved()).toBe(t0);
  }, T);

  test("the network capital ledger is attached: a join stores its ledger events; leaving deletes them", async () => {
    await fresh();
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Sol 36", { app: "friends" });
    const m = (await memberOf("friends", p))!;
    expect((await sql`select type from network.capital_events where app_id = 'friends' and member_id = ${m.id}`).map((r: any) => r.type)).toContain("member_joined");
    expect((await (await s.fetch(new Request("http://127.0.0.1/health?app=friends", { headers: { authorization: "Bearer adm-tok" } }))).json()).capital.stored).toBeGreaterThan(0);
    expect(await text(s, clock, p, "leave friends.help")).toBe("left");
    expect(await count(sql`select count(*)::int as n from network.capital_events where member_id = ${m.id}`)).toBe(0);
  }, T);

  test("PLAT-07 in production the public API needs a Turnstile token: none means 400 and no code sent", async () => {
    await fresh();
    const clock = new SimClock(START);
    const k = "k".repeat(40);
    const otp = new FakeOtp();
    const { s } = service(clock, {
      env: { PLATFORM_ENV: "production", TURNSTILE_SECRET_KEY: "0x4AAA", PLATFORM_HASH_KEY: k, PLATFORM_SESSION_SECRET: k, PLATFORM_PROXY_SECRET: k },
      tokens: "admin@*:adm-tok", publicApi: { otp, minStartMs: 0, minVerifyMs: 0 },
    });
    const res = await s.publicFetch(new Request("https://slop.date/api/auth/otp/start", { method: "POST", headers: { host: "slop.date", "content-type": "application/json" }, body: JSON.stringify({ phone: newPhone() }) }));
    expect([res.status, (await res.json()).error]).toEqual([400, "turnstile"]);
    expect(otp.sent).toBe(0);
    // Production refuses a dev site's host name.
    expect((await s.publicFetch(new Request("http://localhost:5102/api/app", { headers: { host: "localhost:5102" } }))).status).toBe(404);
  }, T);
});

describe("PLAT-06 the production boot check", () => {
  test("main.ts exits non-zero and names what is missing; dev providers never start in production", async () => {
    const run = async (env: Record<string, string>) => {
      const p = Bun.spawn(["bun", "run", "packages/network/service/main.ts", "--once", "--dry-run"], {
        cwd: REPO, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env }, stdout: "pipe", stderr: "pipe",
      });
      const code = await p.exited;
      return { code, err: await new Response(p.stderr).text() };
    };
    const missing = await run({ PLATFORM_ENV: "production", OTP_PROVIDER: "dev", DATABASE_URL: "postgres://x@db.invalid/none" });
    expect(missing.code).not.toBe(0);
    for (const word of ["refusing to start", "OTP_PROVIDER=twilio", "TURNSTILE_SECRET_KEY", "PLATFORM_PROXY_SECRET", "PLATFORM_SESSION_SECRET"]) expect(missing.err).toContain(word);
    const undeclared = await run({ DATABASE_URL: "postgres://x@db.invalid/none" });
    expect(undeclared.code).not.toBe(0);
    expect(undeclared.err).toContain("PLATFORM_ENV");
  }, 60_000);
});
