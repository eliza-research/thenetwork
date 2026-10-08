// The service with several apps (platform plan 4.4, 6.1): text joins, keywords per app, the person
// cap, per-app live flags, per-app staff roles, and the public API mounted on the service. Postgres in
// a database of its own per test process (the packages/observatory/test/pg.ts pattern). Nothing is
// sent: the adapters are dry-run (or Blooio with a fake provider), and OTP codes come from a fake.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../../prototypes/messaging-blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../../prototypes/messaging-blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APP_IDS, APPS, type AppId } from "../../platform/src/apps.ts";
import { lastEvents, resolveConsent } from "../../platform/src/consent.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { BlooioAdapter, DryRunAdapter, liveSendAllowed, type Outbound } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH, type ServiceOptions } from "../service/service.ts";
import { brandOf, copyFor, styleViolations } from "../src/copy.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const DB = `network_service_apps_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

/** The NYC friends app (the registry's id; it was renamed once, so the test reads it). */
const FR: AppId = "friends";
const SECRET = "whsec_shared", APP_SECRET = "whsec_app";
const LINE = "+12125550150";
let phoneSeq = 0;
const newPhone = () => `+1212555${String(100 + ++phoneSeq).padStart(4, "0")}`;

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  async send(e164: string) { const code = String(100000 + this.codes.size * 7919); this.codes.set(e164, code); return { code }; }
}

let sql: SQL;
const open: NetworkService[] = [];
interface Direct { app: string; to: string; body: string }

function service(clock: SimClock, more: Partial<ServiceOptions> = {}) {
  const directs: Direct[] = [];
  const otp = new FakeOtp();
  const s = new NetworkService({
    url: URL_, clock, instance: "apps", log: () => {}, env: { PLATFORM_ENV: "dev" },
    networks: [{ id: "ntwrk:nyc" }, { id: `${FR}:nyc` }, { id: "slop:nyc", matchingEnabled: false }],
    tokens: `admin:adm-tok,reviewer:rev-tok,reviewer@${FR}:fr-tok`, webhookSecret: SECRET, webhookSecrets: { [FR]: APP_SECRET, slop: APP_SECRET },
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
async function text(s: NetworkService, clock: SimClock, from: string, body: string, o: { app?: AppId; line?: string } = {}) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage", ...(o.line ? { recipient: o.line } : {}) } });
  const secret = o.app ? APP_SECRET : SECRET;
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}${o.app ? `/${o.app}` : ""}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(secret, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const count = async (q: Promise<any[]>) => (await q)[0].n as number;
const memberOf = async (app: AppId, e164: string) =>
  (await sql`select m.id, m.account_status, m.opted_out from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as { id: string; account_status: string; opted_out: boolean } | undefined;
const outbound = async (member: string) => (await sql`select body, type, system, status from network.messages where member_id = ${member} and direction = 'outbound' order by ts, id`) as any[];
const consentOf = async (e164: string, app: AppId) => resolveConsent(lastEvents((await sql`select e164, app_id as app, state, source, extract(epoch from at) * 1000 as at from platform.consent_events where e164 = ${e164} order by id`).map((r: any) => ({ ...r, at: Number(r.at) })), e164, app));

describe("per-app copy", () => {
  test("every app's brand texts and join texts pass the style rules, and none asks a member to reply cancel", () => {
    expect(styleViolations('Reply "cancel" to drop it.')).toContain("asks_cancel");
    for (const app of APP_IDS) {
      const c = copyFor(brandOf(APPS[app]));
      const texts = [c.welcome("Sam"), c.welcome("Sam", "Ana"), c.welcomeMinor("Sam"), c.welcomeAskAge("Sam"), c.growthAsk, c.growthPlain, c.noPromotion,
        c.joinAsk(APPS[app].minJoinAge), c.joinNeedName, c.linkNotice, c.shareDone, c.leftApp];
      for (const t of texts) expect([app, t, styleViolations(t)]).toEqual([app, t, []]);
      // The keyword texts (HELP names the support address, which the contact-details rule would flag): never "reply cancel".
      for (const t of Object.values(APPS[app].brand)) expect(styleViolations(t)).not.toContain("asks_cancel");
      for (const t of [c.welcome("Sam"), c.welcomeAskAge("Sam"), c.joinAsk(APPS[app].minJoinAge)]) expect(styleViolations(t, { firstContact: true })).toEqual([]);
      // Another app's copy never names The Network's agent.
      if (app !== "ntwrk") for (const t of texts.slice(0, 7)) expect(t).not.toContain("the Network");
    }
  });
});

describe.skipIf(!pgAvailable)("network service, several apps (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  // Each service holds a pool: close a test's services when it ends.
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    for (const s of open) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("text joins: an open app asks for name and age and stores nothing until the age check passes; invite-only answers once; keywords on the shared line pick the app", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    await s.start();
    const fr = copyFor(brandOf(APPS[FR]));

    // A stranger on the friends app's own line: asked for name and age; nothing stored.
    const sam = newPhone();
    expect(await text(s, clock, sam, "hi", { app: FR })).toBe("join_asked");
    expect(directs.at(-1)).toEqual({ app: FR, to: sam, body: fr.joinAsk(APPS[FR].minJoinAge) });
    expect(await count(sql`select count(*)::int as n from platform.people`)).toBe(0);
    // Name and age: the person, the membership, the opt-in with the words they answered, the member, the welcome.
    expect(await text(s, clock, sam, "Sam, 29", { app: FR })).toBe("joined");
    const m = (await memberOf(FR, sam))!;
    expect(m.account_status).toBe("active");
    expect((await sql`select state, first_name from platform.memberships where member_id = ${m.id}`)[0]).toEqual({ state: "active", first_name: "Sam" });
    expect((await sql`select source, wording from platform.consent_events where e164 = ${sam}`)[0]).toEqual({ source: "inbound_message", wording: fr.joinAsk(APPS[FR].minJoinAge) });
    const welcome = await outbound(m.id);
    expect(welcome.map(x => x.type)).toEqual(["onboarding"]);
    expect(welcome[0].body).toContain(`I'm ${APPS[FR].brand.agentName} (an AI)`);
    expect(welcome[0].body).not.toContain("the Network");
    // Their next message continues onboarding on that app's network.
    expect(await text(s, clock, sam, "More time outdoors.", { app: FR })).toBe("handled");
    expect((await outbound(m.id)).length).toBe(2);

    // Under the join age (13 on every app): the kind decline, nothing stored.
    const kid = newPhone();
    expect(await text(s, clock, kid, "hey", { app: FR })).toBe("join_asked");
    expect(await text(s, clock, kid, "Kim 12", { app: FR })).toBe("under_age");
    expect(directs.at(-1)!.body).toBe(APPS[FR].brand.underAge);
    expect(await count(sql`select count(*)::int as n from platform.phone_identities where e164 = ${kid}`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from network.members where app_id = ${FR}`)).toBe(1);

    // A member who says after joining that they are under 13 (first person, present tense): the kind
    // decline, the Network keeps only the id, the membership is forgotten, and the person keeps the age.
    const teen = newPhone();
    expect(await text(s, clock, teen, "Lee 15", { app: FR })).toBe("joined");
    const tm = (await memberOf(FR, teen))!;
    expect(await text(s, clock, teen, "I am 12 years old", { app: FR })).toBe("handled");
    expect((await sql`select account_status, name from network.members where id = ${tm.id}`)[0]).toEqual({ account_status: "removed", name: null });
    expect(await count(sql`select count(*)::int as n from network.messages where member_id = ${tm.id}`)).toBe(0);
    expect((await sql`select state from platform.memberships where member_id = ${tm.id}`)[0].state).toBe("removed");
    expect((await sql`select p.lowest_age from platform.people p join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${teen}`)[0].lowest_age).toBe(12);
    expect(await text(s, clock, teen, "slop")).toBe("join_asked");
    expect(await text(s, clock, teen, "Lee 25")).toBe("under_age");

    // The shared line, no keyword, a stranger: they join The Network (founder decision 2). Nothing is stored before the age check.
    const ann = newPhone();
    expect(await text(s, clock, ann, "hello")).toBe("join_asked");
    expect(directs.at(-1)).toEqual({ app: "ntwrk", to: ann, body: copyFor(brandOf(APPS.ntwrk)).joinAsk(13) });
    expect(await count(sql`select count(*)::int as n from platform.phone_identities where e164 = ${ann}`)).toBe(0);
    // "slop.date" on the shared line joins slop instead; the answer that follows goes to slop too.
    expect(await text(s, clock, ann, "slop.date")).toBe("join_asked");
    expect(directs.at(-1)!.app).toBe("slop");
    expect(await text(s, clock, ann, "I'm Ann and I'm 31")).toBe("joined");
    expect((await memberOf("slop", ann))?.account_status).toBe("active");
    // A receiving line in platform.app_lines names its app.
    await sql`insert into platform.app_lines (line_e164, app_id, city, provider, env) values (${LINE}, ${FR}, 'nyc', 'blooio', 'dev')`;
    const bo = newPhone();
    expect(await text(s, clock, bo, "hi", { line: LINE })).toBe("join_asked");
    expect(directs.at(-1)!.app).toBe(FR);
  }, T);

  test("one person in two apps: the link notice names no app, SHARE stores a grant, STOP is per app, STOP ALL and the shared line stop every app, leave forgets one app", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "Sam 29", { app: FR })).toBe("joined");
    // A known person on a new app (slop by keyword on the shared line): the age check again, then the link notice.
    expect(await text(s, clock, p, "slop")).toBe("join_asked");
    expect(await text(s, clock, p, "Sam 29")).toBe("joined");
    const fr = (await memberOf(FR, p))!, sl = (await memberOf("slop", p))!;
    const slopOut = await outbound(sl.id);
    expect(slopOut.map(x => x.type).sort()).toEqual(["info", "onboarding"]);
    expect(slopOut.find(x => x.type === "info").body).toBe(copyFor(brandOf(APPS.slop)).linkNotice);
    for (const x of slopOut) for (const word of [FR, APPS[FR].domain, APPS[FR].name]) expect(x.body.toLowerCase()).not.toContain(word.toLowerCase());
    // SHARE answers the notice (the last app that wrote to them is slop): a grant, nothing copied.
    expect(await text(s, clock, p, "SHARE")).toBe("handled");
    expect((await sql`select from_app, to_app, fields from platform.share_grants`)[0]).toEqual({ from_app: FR, to_app: "slop", fields: ["first_name", "city", "interests"] });

    // STOP on the friends app's own line with PLATFORM_STOP_SCOPE=app: that app only.
    const { s: own } = service(clock, { env: { PLATFORM_ENV: "dev", PLATFORM_STOP_SCOPE: "app" } });
    expect(await text(own, clock, p, "STOP", { app: FR })).toBe("handled");
    expect((await outbound(fr.id)).at(-1)).toMatchObject({ system: true, body: APPS[FR].brand.stopApp });
    expect((await memberOf(FR, p))!.opted_out).toBe(true);
    expect((await memberOf("slop", p))!.opted_out).toBe(false);
    expect(await consentOf(p, FR)).toBe("opted_out");
    expect(await consentOf(p, "slop")).toBe("opted_in");
    const states = async () => (await sql`select m.app_id, m.state from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id where ph.e164 = ${p} order by app_id`).map((r: any) => `${r.app_id}:${r.state}`);
    expect(await states()).toEqual([`${FR}:paused`, "slop:active"].sort());
    // START on that line: that app again.
    expect(await text(own, clock, p, "START", { app: FR })).toBe("handled");
    expect((await memberOf(FR, p))!.opted_out).toBe(false);
    expect(await consentOf(p, FR)).toBe("opted_in");
    expect(await states()).toEqual([`${FR}:active`, "slop:active"].sort());
    // STOP ALL on slop's line: every app.
    expect(await text(s, clock, p, "STOP ALL", { app: "slop" })).toBe("handled");
    expect((await memberOf(FR, p))!.opted_out).toBe(true);
    expect((await memberOf("slop", p))!.opted_out).toBe(true);
    expect(await consentOf(p, FR)).toBe("opted_out");
    // On the shared line a plain STOP stops every app too (founder decision 7).
    const q = newPhone();
    await text(s, clock, q, "Quinn 40", { app: FR });
    await text(s, clock, q, "Quinn 40", { app: "slop" });
    expect(await text(s, clock, q, "stop")).toBe("handled");
    expect((await memberOf(FR, q))!.opted_out).toBe(true);
    expect((await memberOf("slop", q))!.opted_out).toBe(true);

    // "leave slop": slop forgets them (only the id stays); the friends membership and the phone stay.
    expect(await text(s, clock, q, "leave slop.date")).toBe("left");
    expect(directs.at(-1)!.body).toBe(copyFor(brandOf(APPS.slop)).leftApp);
    const qs = (await sql`select id, name, account_status, person_id from network.members where app_id = 'slop' and id in (select member_id from platform.memberships where app_id = 'slop')`) as any[];
    expect(qs.every(r => r.account_status !== "removed" || (r.name === null && r.person_id === null))).toBe(true);
    expect((await sql`select state from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id where ph.e164 = ${q} order by app_id`).map((r: any) => r.state)).toEqual(["paused", "removed"]); // stopped earlier: paused
    expect(await count(sql`select count(*)::int as n from network.messages msg join network.members m on m.id = msg.member_id where m.app_id = 'slop' and m.account_status = 'removed'`)).toBe(0);
  }, T);

  test("the person cap: at most 3 proactive messages a day across every app, counted at send time; two networks at once cannot pass it", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Sam 29", { app: FR });
    await text(s, clock, p, "slop");
    await text(s, clock, p, "Sam 29");
    const fr = (await memberOf(FR, p))!, sl = (await memberOf("slop", p))!;
    const out = (id: string, memberId: string, proactive = true): Outbound => ({ id, memberId, body: "x", kind: proactive ? "proactive" : "transactional", proactive, system: false, ts: clock.now() });
    // A proactive send 30 hours ago does not count today.
    const person = (await sql`select person_id from network.members where id = ${fr.id}`)[0].person_id;
    await sql`insert into platform.person_sends (msg_id, person_id, app_id, at) values ('old', ${person}, 'slop', ${new Date(clock.now() - 30 * HOUR)})`;
    expect([...(await s.capRefused(s.runtimeFor("slop")!, [out("s1", sl.id)]))]).toEqual([]);
    expect([...(await s.capRefused(s.runtimeFor(FR)!, [out("n1", fr.id), out("n2", fr.id, false), out("n3", fr.id), out("n4", fr.id)]))]).toEqual(["n4"]);
    // The same id handed over again (a redelivery) is not counted twice.
    expect([...(await s.capRefused(s.runtimeFor(FR)!, [out("n1", fr.id)]))]).toEqual([]);
    // A send the adapter refused (the per-app live flag, a suppressed number) never went out: its slot
    // comes back (before the fix it used one of the person's 3 for the day).
    await s.capRelease(["n3"]);
    expect([...(await s.capRefused(s.runtimeFor(FR)!, [out("n5", fr.id), out("n6", fr.id)]))]).toEqual(["n6"]);
    // Two networks deliver at the same moment for another person with 2 sends today: only one more goes.
    const q = newPhone();
    await text(s, clock, q, "Quinn 40", { app: FR });
    await text(s, clock, q, "slop");
    await text(s, clock, q, "Quinn 40");
    const qf = (await memberOf(FR, q))!, qs = (await memberOf("slop", q))!;
    await s.capRefused(s.runtimeFor(FR)!, [out("q1", qf.id), out("q2", qf.id)]);
    const [a, b] = await Promise.all([s.capRefused(s.runtimeFor(FR)!, [out("q3", qf.id)]), s.capRefused(s.runtimeFor("slop")!, [out("q4", qs.id)])]);
    expect(a.size + b.size).toBe(1);
  }, T);

  test("per-app live flags; per-app staff roles; the matching switch refuses a network the registry keeps off", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const both = { BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" };
    const flag = `${FR.toUpperCase()}_LIVE_APPROVED`;
    expect(liveSendAllowed(both, "ntwrk")).toBe(true);
    expect(liveSendAllowed(both, FR)).toBe(false);
    expect(liveSendAllowed({ BLOOIO_ALLOW_SEND: "1", [flag]: "1" }, FR)).toBe(false);
    expect(liveSendAllowed({ ...both, [flag]: "1" }, FR)).toBe(true);
    // A Blooio adapter for the friends app with a fake provider: refused without its flag, sent with it.
    for (const [env, sends] of [[both, 0], [{ ...both, [flag]: "1" }, 1]] as const) {
      const clock = new SimClock(START);
      const sent: SendRequest[] = [];
      const provider = { kind: "blooio" as const, send: async (r: SendRequest) => { sent.push(r); return { providerMessageId: `p${sent.length}`, status: "queued" as const }; } };
      const { s } = service(clock, { adapter: (net, rt) => new BlooioAdapter({ net, provider, clock, memberOf: rt.memberOf, env, app: rt.app.id, log: () => {} }) });
      await text(s, clock, newPhone(), "hi", { app: FR });
      expect(sent.length).toBe(sends);
    }

    const clock = new SimClock(START);
    const { s } = service(clock);
    const call = (token: string, method: string, path: string, b?: unknown) =>
      s.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(b ? { body: JSON.stringify(b) } : {}) }));
    // A reviewer for the friends app reads that queue only.
    const q = await call("fr-tok", "GET", `/apps/${FR}/review`);
    expect(q.status).toBe(200);
    expect((await q.json()).network).toBe(`${FR}:nyc`);
    expect((await call("fr-tok", "GET", "/review?app=ntwrk")).status).toBe(403);
    expect((await call("fr-tok", "GET", "/review")).status).toBe(403);
    expect((await call("rev-tok", "GET", `/review?app=${FR}`)).status).toBe(200); // a role with no app is for every app
    expect((await call("adm-tok", "GET", "/apps/nope/review")).status).toBe(404);
    // slop matching stays off (platform.networks): the switch refuses "on". The friends network may match.
    expect(await (await call("adm-tok", "POST", "/apps/slop/matching", { on: true })).json()).toEqual({ ok: false, reason: "matching_not_allowed" });
    expect((await call("adm-tok", "POST", `/matching?app=${FR}`, { on: true })).status).toBe(200);
    const h = await (await call("adm-tok", "GET", `/health?app=${FR}`)).json();
    expect(h).toMatchObject({ network: `${FR}:nyc`, matchingEnabled: true });
    expect(h.networks.map((x: any) => [x.network, x.matchingEnabled])).toEqual([["ntwrk:nyc", false], [`${FR}:nyc`, true], ["slop:nyc", false]]);
    // The refused "on" for slop is audited too (before the fix it left no row).
    expect((await sql`select app_id, detail->>'network' as network, detail->>'phase' as phase, ok from network.staff_audit where action = 'config' order by id`).map((r: any) => `${r.network}:${r.phase}:${r.ok}`))
      .toEqual(["slop:nyc:refused:false", `${FR}:nyc:requested:true`, `${FR}:nyc:result:true`]);
  }, T);

  test("shared line: a member's sentence that names another app stays with their app; a bare number in a sentence is not an age", async () => {
    // Before the fix "my ex is on slop.date lol" started a slop join, and the next reply "Sounds good,
    // 7 works for me" was read as age 7: a slop decline and lowest_age = 7 for an adult.
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "Sam 29", { app: FR })).toBe("joined");
    const m = (await memberOf(FR, p))!;
    const before = (await sql`select count(*)::int as n from network.messages where member_id = ${m.id} and direction = 'inbound'`)[0].n;
    expect(await text(s, clock, p, "my ex is on slop.date lol")).toBe("handled");
    expect(await text(s, clock, p, "Sounds good, 7 works for me")).toBe("handled");
    expect(directs.filter(d => d.to === p && d.app === "slop")).toEqual([]);
    expect((await sql`select count(*)::int as n from network.messages where member_id = ${m.id} and direction = 'inbound'`)[0].n).toBe(before + 2);
    expect((await sql`select p.lowest_age from platform.people p join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${p}`)[0].lowest_age).toBe(29);
    // The whole message "slop" still starts a slop join; a reply that is not a join answer stays with their app.
    expect(await text(s, clock, p, "slop")).toBe("join_asked");
    expect(await text(s, clock, p, "Sounds good, 7 works for me")).toBe("handled");
    expect(await text(s, clock, p, "Sam, 29")).toBe("joined");
    expect((await memberOf("slop", p))?.account_status).toBe("active");
    // Join answers still parse: "Kim 16", "I'm 31", "Sam, 29"; a sentence does not.
    const { parseJoinText } = await import("../service/service.ts");
    const words = ["slop", "date"];
    expect(parseJoinText("Kim 16", words, true)).toEqual({ age: 16, name: "Kim" });
    expect(parseJoinText("Sure, 25 works", words, true).age).toBeUndefined();
    expect(parseJoinText("Sounds good, 7 works for me", words, true).age).toBeUndefined();
  }, T);

  test("a text join refused under age cannot retry with an older age (new phone, no person)", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock);
    const kid = newPhone();
    expect(await text(s, clock, kid, "hi", { app: FR })).toBe("join_asked");
    expect(await text(s, clock, kid, "Kid, 12", { app: FR })).toBe("under_age");
    expect(await text(s, clock, kid, "hi", { app: FR })).toBe("join_asked");
    expect(await text(s, clock, kid, "Kid, 19", { app: FR })).toBe("under_age");
    expect(await count(sql`select count(*)::int as n from platform.phone_identities where e164 = ${kid}`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from platform.age_floor where lowest_age = 12`)).toBe(1);
    // The web join with the same phone is refused too.
    expect((await s.accounts.join(APPS[FR], { e164: kid, personId: null }, { firstName: "Kid", age: 30, consent: { sms: true, version: APPS[FR].consent.version } }))).toEqual({ ok: false, error: "under_age" });
  }, T);

  test("STOP on one app's line leaves the other app's adapter sending; the consent ledger refuses sends after a restart", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const flags = { BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1", [`${FR.toUpperCase()}_LIVE_APPROVED`]: "1", SLOP_LIVE_APPROVED: "1" };
    const sent: SendRequest[] = [];
    const provider = { kind: "blooio" as const, send: async (r: SendRequest) => { sent.push(r); return { providerMessageId: `p${sent.length}`, status: "queued" as const }; } };
    const live = { adapter: (net: any, rt: any) => new BlooioAdapter({ net, provider, clock, memberOf: rt.memberOf, env: flags, app: rt.app.id, log: () => {} }) };
    const appScope = { env: { PLATFORM_ENV: "dev", PLATFORM_STOP_SCOPE: "app" } };
    const { s } = service(clock, { ...live, ...appScope });
    clock.set(START + 14 * HOUR); // inside the send window (quiet hours hold proactive sends only)
    const p = newPhone();
    expect(await text(s, clock, p, "Sam 29", { app: FR })).toBe("joined");
    expect(await text(s, clock, p, "Sam 29", { app: "slop" })).toBe("joined");
    expect(await text(s, clock, p, "STOP", { app: "slop" })).toBe("handled");
    // Before the fix the slop STOP marked every app's adapter: the friends reply was refused until a restart.
    const n = sent.length;
    expect(await text(s, clock, p, "More time outdoors.", { app: FR })).toBe("handled");
    expect(sent.length).toBeGreaterThan(n);
    expect(sent.at(-1)!.to).toBe(p);
    // A new process (fresh adapters, no memory of the STOP): the ledger still refuses slop sends.
    const { s: s2 } = service(clock, { ...live, ...appScope });
    const slop = s2.runtimeFor("slop")!, fr = s2.runtimeFor(FR)!;
    await slop.identities(); await fr.identities();
    const sl = (await memberOf("slop", p))!, frm = (await memberOf(FR, p))!;
    const out = (id: string, memberId: string): Outbound => ({ id, memberId, body: "x", kind: "proactive", proactive: true, system: false, ts: clock.now() });
    expect([...(await s2.consentRefused(slop, [out("a", sl.id)]))]).toEqual(["a"]);
    expect([...(await s2.consentRefused(fr, [out("b", frm.id)]))]).toEqual([]);
  }, T);

  test("the cross-app reads work under the network_service role (row-level security on): the cap counts and the member lookup", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Sam 29", { app: FR });
    await text(s, clock, p, "slop");
    await text(s, clock, p, "Sam 29");
    const fr = (await memberOf(FR, p))!, sl = (await memberOf("slop", p))!;
    for (const [app, member, id] of [[FR, fr.id, "q1"], ["slop", sl.id, "q2"], ["slop", sl.id, "q3"]] as const) {
      await sql`insert into network.messages (app_id, id, member_id, direction, channel, body, status, proactive, system, ts) values (${app}, ${id}, ${member}, 'outbound', 'imessage', 'x', 'dry_run', true, false, ${new Date(clock.now() - HOUR)})`;
    }
    const asService = (fn: (tx: any) => Promise<any[]>): Promise<any[]> => sql.begin(async tx => { await tx`set local role network_service`; await tx`select set_config('app.app_id', ${FR}, true)`; return fn(tx); });
    // A direct query as network_service sees only its own app (what the cap read before the fix).
    const direct = await asService(tx => tx`select count(*)::int as n from network.messages where id in ('q1', 'q2', 'q3')`);
    expect(direct[0].n).toBe(1);
    // The cap counter spans apps under the RLS role: two sends counted on slop, the third (friends) passes, the fourth is refused.
    const take = (ids: string[]) => asService(tx => tx`select * from platform.person_cap_take(${FR}, ${ids.map(id => ({ id, member: fr.id }))}::jsonb, ${new Date(clock.now() - 24 * HOUR)}, ${new Date(clock.now())}, 3) as id`);
    await sql`insert into platform.person_sends (msg_id, person_id, app_id, at) select x, person_id, 'slop', now() from network.members, unnest(array['c1', 'c2']) x where id = ${sl.id}`;
    expect((await take(["c3", "c4"])).map((r: any) => r.id)).toEqual(["c4"]);
    const apps = await asService(tx => tx`select app_id from platform.member_apps(${p}) order by app_id`);
    expect(apps.map((r: any) => r.app_id)).toEqual([FR, "slop"].sort());
  }, T);

  test("staff invite to The Network: an invited membership and one invitation text; the reply with name and age joins", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    const call = (token: string, path: string, b: unknown) =>
      s.fetch(new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(b) }));
    const ann = newPhone();
    expect((await call("fr-tok", "/apps/ntwrk/invite", { phone: ann })).status).toBe(403);
    expect(await (await call("adm-tok", "/apps/ntwrk/invite", { phone: ann })).json()).toEqual({ ok: true });
    expect(directs.at(-1)).toEqual({ app: "ntwrk", to: ann, body: copyFor(brandOf(APPS.ntwrk)).invited(APPS.ntwrk.minJoinAge) });
    // No keyword on the shared line: The Network, and the invite lets them in.
    expect(await text(s, clock, ann, "Ann, 34")).toBe("joined");
    expect((await memberOf("ntwrk", ann))?.account_status).toBe("active");
    expect((await sql`select wording from platform.consent_events where e164 = ${ann}`)[0].wording).toBe(copyFor(brandOf(APPS.ntwrk)).invited(APPS.ntwrk.minJoinAge));
    expect(await (await call("adm-tok", "/apps/ntwrk/invite", { phone: ann })).json()).toEqual({ ok: false, reason: "already_member" });
    expect((await sql`select count(*)::int as n from network.staff_audit where action = 'invite'`)[0].n).toBe(4);
  }, T);

  test("a reviewer for one app sees only that app's network in /health", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock);
    const h = await (await s.fetch(new Request(`http://127.0.0.1/health?app=${FR}`, { headers: { authorization: "Bearer fr-tok" } }))).json();
    expect(h.networks.map((x: any) => x.network)).toEqual([`${FR}:nyc`]);
  }, T);

  test("reviewer of record: X-Network-Staff-Id counts only with the console's token", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock, { consoleToken: "adm-tok" });
    const sw = (token: string, staff: string) => s.fetch(new Request(`http://127.0.0.1/apps/${FR}/matching`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-network-staff-id": staff }, body: JSON.stringify({ on: false }),
    }));
    expect((await sw("adm-tok", "ana@example.org")).status).toBe(200);
    expect((await sw("rev-tok", "mallory@example.org")).status).toBe(403); // a reviewer may not switch matching, whoever it names
    await sql`select 1`;
    const actors = (await sql`select distinct actor from network.staff_audit where action = 'config'`).map((r: any) => r.actor);
    expect(actors).toEqual(["ana@example.org"]);
    // Another token's header is ignored: the token's own id is recorded.
    const { s: s2 } = service(clock, { consoleToken: "adm-tok", tokens: `admin:adm-tok,admin@${FR}:other-tok` });
    await s2.fetch(new Request(`http://127.0.0.1/apps/${FR}/matching`, { method: "POST", headers: { authorization: "Bearer other-tok", "content-type": "application/json", "x-network-staff-id": "mallory@example.org" }, body: JSON.stringify({ on: false }) }));
    const all = (await sql`select distinct actor from network.staff_audit where action = 'config' order by actor`).map((r: any) => r.actor);
    expect(all.length).toBe(2);
    expect(all).not.toContain("mallory@example.org");
  }, T);

  test("eight networks tick together without exhausting the connection pool", async () => {
    // Before the fix the pool had 8 connections: 8 ticks each held one for the advisory lock and waited forever for another.
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const nets = APP_IDS.flatMap(a => [{ id: `${a}:nyc` }, { id: `${a}:sf` }]);
    const { s } = service(clock, { networks: nets });
    const all = Promise.all([...s.runtimes.values()].map(rt => rt.tick()));
    const result = await Promise.race([all.then(() => "done"), Bun.sleep(60_000).then(() => "stuck")]);
    expect(result).toBe("done");
  }, T);

  test("public API on the service: login, join two apps with one phone, each host sees only its app, stop one app, export, leave", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s, otp } = service(clock);
    const host = (app: AppId) => `localhost:${5101 + APP_IDS.indexOf(app)}`;
    const jar = new Map<AppId, string>();
    const call = async (app: AppId, method: string, path: string, b?: unknown) => {
      const res = await s.publicFetch(new Request(`http://127.0.0.1:8790${path}`, {
        method, headers: { host: host(app), "content-type": "application/json", ...(jar.get(app) ? { cookie: jar.get(app)! } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}),
      }));
      const c = res.headers.get("set-cookie");
      if (c) jar.set(app, c.split(";")[0]!);
      return { status: res.status, body: await res.json().catch(() => null) as any };
    };
    const login = async (app: AppId, phone: string) => {
      clock.advance(31_000); // one number: at least 30 s between codes, whatever the app
      expect((await call(app, "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
      expect((await call(app, "POST", "/api/auth/otp/verify", { phone, code: otp.codes.get(phone) })).status).toBe(200);
    };
    const consent = (app: AppId) => ({ sms: true, wording: APPS[app].consent.text });
    const p = newPhone();
    for (const app of ["slop", FR] as AppId[]) {
      await login(app, p);
      expect((await call(app, "GET", "/api/me")).body).toMatchObject({ app, membership: null, canJoin: true });
      const j = await call(app, "POST", "/api/join", { firstName: "Rae", age: 30, neighborhood: "Greenpoint", interests: ["climbing"], consent: consent(app) });
      expect(j.status).toBe(200);
      const m = (await memberOf(app, p))!;
      expect(m.account_status).toBe("active");
      // The welcome went through the normal send path (dry-run row) on that app's network.
      expect((await outbound(m.id)).map(x => [x.type, x.status])).toEqual([["onboarding", "dry_run"]]);
      expect(await count(sql`select count(*)::int as n from network.facets where app_id = ${app} and member_id = ${m.id} and value = 'climbing'`)).toBe(1);
    }
    for (const app of ["slop", FR] as AppId[]) {
      const me = await call(app, "GET", "/api/me");
      expect(me.body).toMatchObject({ app, membership: { state: "active", firstName: "Rae" } });
      const other = app === "slop" ? FR : "slop";
      for (const w of [other, APPS[other].domain]) expect(JSON.stringify(me.body)).not.toContain(w);
    }
    // Stop on slop's site: every app on the number stops (PRD 40.3: one line, carriers see one sender).
    expect((await call("slop", "POST", "/api/me/stop", {})).status).toBe(200);
    expect((await call("slop", "GET", "/api/me")).body.membership.state).toBe("paused");
    expect((await call(FR, "GET", "/api/me")).body.membership.state).toBe("paused");
    expect((await memberOf("slop", p))!.opted_out).toBe(true);
    expect((await memberOf(FR, p))!.opted_out).toBe(true);
    // Export: this app's own data only.
    const ex = await call(FR, "GET", "/api/me/export");
    expect(ex.body.app).toBe(FR);
    expect(ex.body.network.facets.map((f: any) => f.value)).toEqual(["climbing"]);
    expect(ex.body.network.messages.length).toBe(1);
    expect(JSON.stringify(ex.body)).not.toContain("slop");
    // Leave the friends app: its member is forgotten, slop's membership stays.
    expect((await call(FR, "POST", "/api/me/delete", { scope: "app" })).status).toBe(200);
    const gone = (await sql`select account_status, name, person_id from network.members where app_id = ${FR}`)[0];
    expect(gone).toEqual({ account_status: "removed", name: null, person_id: null });
    expect(await count(sql`select count(*)::int as n from network.messages where app_id = ${FR}`)).toBe(0);
    expect((await call("slop", "GET", "/api/me")).body.membership.state).toBe("paused");
    // An under-13 web join stores nothing; The Network is invite-only on the web.
    const kid = newPhone();
    await login("slop", kid);
    expect((await call("slop", "POST", "/api/join", { firstName: "Kim", age: 12, consent: consent("slop") })).body.error).toBe("under_age");
    expect(await count(sql`select count(*)::int as n from platform.phone_identities where e164 = ${kid}`)).toBe(0);
    await login("ntwrk", newPhone());
    expect((await call("ntwrk", "POST", "/api/join", { firstName: "Kim", age: 30, consent: consent("ntwrk") })).body.error).toBe("invite_only");
    // Delete everything (from slop): every membership's network member is forgotten, the phone is gone, a suppression hash stays.
    clock.advance(MINUTE);
    await login("slop", p);
    expect((await call("slop", "POST", "/api/me/delete", { scope: "all" })).status).toBe(200);
    expect((await sql`select account_status, name, person_id from network.members where app_id = 'slop'`)[0]).toEqual({ account_status: "removed", name: null, person_id: null });
    expect(await count(sql`select count(*)::int as n from network.messages where app_id = 'slop'`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from platform.phone_identities where e164 = ${p}`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from platform.suppression`)).toBe(1);
  }, T);
});
