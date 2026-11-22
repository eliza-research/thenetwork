// The service with several apps (platform plan 4.4, 6.1): text joins, keywords per app, the person
// cap, per-app live flags, per-app staff roles, and the public API mounted on the service. Postgres in
// a database of its own per test process (the packages/observatory/test/pg.ts pattern). Nothing is
// sent: the adapters are dry-run (or Blooio with a fake provider), and OTP codes come from a fake.
import { setTimeout as sleep } from "node:timers/promises";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APP_IDS, APPS, type AppId } from "../../platform/src/apps.ts";
import { TURN_PATH, TURN_RECEIPT_PATH, type TurnReceiptRequest, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { lastEvents, resolveConsent } from "../../platform/src/consent.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { BlooioAdapter, DryRunAdapter, liveSendAllowed, type Outbound } from "../service/channel.ts";
import { CloudChannelAdapter } from "../service/cloud-channel.ts";
import { NetworkService, WEBHOOK_PATH, type ServiceOptions } from "../service/service.ts";
import { brandOf, copyFor, styleViolations } from "../src/copy.ts";
import type { NetworkState } from "../src/network.ts";
import { SLOP_ONBOARD_QUESTIONS } from "../../engine/src/packs/slop/index.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
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
        c.joinAsk(APPS[app].minJoinAge), c.joinNeedName, c.linkNotice, c.shareDone, c.unshareDone, c.leftApp, c.invitesNotOpen("Maya"), c.requestNoneYet("a climbing partner", false)];
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

    const otherKid = newPhone();
    expect(await text(s, clock, otherKid, "Hi, I'm a 12-year-old girl", { app: FR })).toBe("under_age");
    expect(await memberOf(FR, otherKid)).toBeUndefined();
    const conflicting = newPhone();
    expect(await text(s, clock, conflicting, "Rae. I am 30 years old. I am 15.", { app: FR })).toBe("joined");
    expect((await sql`select p.lowest_age from platform.people p join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${conflicting}`)[0].lowest_age).toBe(15);
    const spelled = newPhone();
    expect(await text(s, clock, spelled, "hi", { app: FR })).toBe("join_asked");
    expect(await text(s, clock, spelled, "Taylor", { app: FR })).toBe("join_asked");
    expect(await text(s, clock, spelled, "thirty-two", { app: FR })).toBe("joined");
    expect((await sql`select first_name from platform.memberships where member_id = ${(await memberOf(FR, spelled))!.id}`)[0].first_name).toBe("Taylor");

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
    expect(await text(s, clock, teen, "slop")).toBe("under_age");
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

    // The Network's own line is invite-only: one answer a day per number, nothing stored (mvp-gaps
    // item 12). The counting window starts at midnight UTC, which is 20:00 in New York, so an answer
    // at 13:00 and the next one at 20:01 local are inside one evening for the member.
    const NLINE = "+12125550777";
    await sql`insert into platform.app_lines (line_e164, app_id, city, provider, env) values (${NLINE}, 'ntwrk', 'nyc', 'blooio', 'dev')`;
    const guest = newPhone();
    expect(await text(s, clock, guest, "hello", { line: NLINE })).toBe("invite_only");
    expect(directs.at(-1)!.body).toBe(APPS.ntwrk.brand.inviteOnly);
    const answered = directs.length;
    // Cross the fixed day window by a minute: no second answer inside 24 hours.
    clock.advance(24 * HOUR - (clock.now() % (24 * HOUR)) + MINUTE);
    expect(await text(s, clock, guest, "hello again", { line: NLINE })).toBe("invite_only");
    expect(directs.length).toBe(answered);
    // A day after the first answer it is sent again, so the cap still expires.
    clock.advance(24 * HOUR);
    expect(await text(s, clock, guest, "still here", { line: NLINE })).toBe("invite_only");
    expect(directs.length).toBe(answered + 1);
  }, T);

  // spec/baseProfileShare.md, "Story: Reuse my approved basics in a second app"
  test("one person in two apps: the link notice names no app, SHARE grants and reuses only shareable interests, STOP is per app, STOP ALL and the shared line stop every app, leave forgets one app", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "Sam 29", { app: FR })).toBe("joined");
    // A known person on a new app (slop by keyword on the shared line): the age check again, then the link notice.
    expect(await text(s, clock, p, "slop")).toBe("join_asked");
    // A different first name in the second app, so a grant that replaced it would show.
    expect(await text(s, clock, p, "Kit 29")).toBe("joined");
    const fr = (await memberOf(FR, p))!, sl = (await memberOf("slop", p))!;
    const slopOut = await outbound(sl.id);
    expect(slopOut.map(x => x.type).sort()).toEqual(["info", "onboarding"]);
    expect(slopOut.find(x => x.type === "info").body).toBe(copyFor(brandOf(APPS.slop)).linkNotice);
    for (const x of slopOut) for (const word of [FR, APPS[FR].domain, APPS[FR].name]) expect(x.body.toLowerCase()).not.toContain(word.toLowerCase());
    // The friends member's facts: one confirmed interest is shareable; a private, a sensitive, an unconfirmed
    // interest, one bound to an opportunity and a plain fact are not.
    const fact = (id: string, kind: string, value: string, scope: string, status: string, sensitive: string | null) =>
      sql`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, status, sensitive, valid_from)
        values (${FR}, ${`${fr.id}:${id}`}, ${fr.id}, ${kind}, ${value}, ${sql.array(["climbing"], "TEXT")}, ${scope}, 'said', ${status}, ${sensitive}, ${new Date(clock.now() - HOUR)})`;
    await fact("i1", "interest", "rock climbing", "matchable", "confirmed", null);
    await fact("i2", "interest", "private poker nights", "agent_private", "confirmed", null);
    await fact("i3", "interest", "support group", "matchable", "confirmed", "health");
    await fact("i4", "interest", "salsa", "matchable", "proposed", null);
    await fact("i5", "interest", "a one-off picnic", "opportunity_specific", "confirmed", null);
    await fact("f1", "fact", "works nights", "shareable", "confirmed", null);
    // SHARE answers the notice (the last app that wrote to them is slop): a grant, then slop reads it.
    expect(await text(s, clock, p, "SHARE")).toBe("handled");
    expect((await sql`select from_app, to_app, fields from platform.share_grants`)[0]).toEqual({ from_app: FR, to_app: "slop", fields: ["interests"] });
    const copies = await sql`select id, kind, value, privacy_scope, source, status from network.facets where app_id = 'slop' and member_id = ${sl.id} and source = 'share_grant'`;
    expect(copies.map(({ id: _id, ...r }: any) => r))
      .toEqual([{ kind: "interest", value: "rock climbing", privacy_scope: "matchable", source: "share_grant", status: "confirmed" }]);
    // The copy never names the app it came from.
    for (const word of [FR, APPS[FR].domain, APPS[FR].name]) expect(String(copies[0]!.id).toLowerCase()).not.toContain(word.toLowerCase());
    // Nor can a reader of slop's facts find the source app by hashing the value with each app id.
    for (const app of APP_IDS) expect(String(copies[0]!.id)).not.toContain(createHash("sha256").update(`${app}\nrock climbing`).digest("hex").slice(0, 16));
    // The joined app keeps the first name and city it was told.
    expect((await sql`select name from network.members where app_id = 'slop' and id = ${sl.id}`)[0]).toEqual({ name: "Kit" });

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
      const { s } = service(clock, { adapter: (net, rt) => new BlooioAdapter({ from: "+12125550100", net, provider, clock, memberOf: rt.memberOf, env, app: rt.app.id, log: () => {} }) });
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

  test("a plain name, age and supported city joins without moving the person's home to the matching city", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock);
    for (const [answer, homeCity] of [["Ari, 29, San Francisco", "sf"], ["Ari, 29, New York", "nyc"],
      ["Ari, 29, Bay Area", "sf"], ["Ari,29; I live in San Francisco", "sf"]]) {
      const phone = newPhone();
      expect(await text(s, clock, phone, "friends.help")).toBe("join_asked");
      expect(await text(s, clock, phone, answer)).toBe("joined");
      const person = await s.accounts.personFor(phone);
      expect(person?.lowestAge).toBe(29);
      const [member] = await sql`select m.name,m.home_city,m.age,pm.profile->>'homeCity' as profile_home
        from network.members m join platform.memberships pm on pm.member_id=m.id and pm.app_id=m.app_id
        where m.person_id=${person!.id}::uuid and m.app_id=${FR}`;
      expect(member).toMatchObject({ name: "Ari", home_city: homeCity, age: 29, profile_home: homeCity });
      expect(await consentOf(phone, FR)).toBe("opted_in");
    }
    for (const answer of ["Ari, 29, Paris", "Ari, 29 minutes, San Francisco", "Ari, 29, 30, San Francisco",
      "Ari, 29, San Francisco; I live in New York"]) {
      const phone = newPhone();
      expect(await text(s, clock, phone, "friends.help")).toBe("join_asked");
      expect(await text(s, clock, phone, answer)).toBe("join_asked");
      expect(await s.accounts.personFor(phone)).toBeUndefined();
    }
  }, T);

  test("a text join refused under age cannot retry with an older age (new phone, no person)", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock);
    const kid = newPhone();
    expect(await text(s, clock, kid, "hi", { app: FR })).toBe("join_asked");
    expect(await text(s, clock, kid, "Kid, 12", { app: FR })).toBe("under_age");
    expect(await text(s, clock, kid, "hi", { app: FR })).toBe("under_age");
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
    const live = { adapter: (net: any, rt: any) => new BlooioAdapter({ from: "+12125550100", net, provider, clock, memberOf: rt.memberOf, env: flags, app: rt.app.id, log: () => {} }) };
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
    const result = await Promise.race([all.then(() => "done"), sleep(60_000, undefined, { ref: false }).then(() => "stuck")]);
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
    // spec/accountPrivacy.md, "An export includes the member's own facts and photo metadata"
    const friends = (await memberOf(FR, p))!;
    const slop = (await memberOf("slop", p))!;
    const takenAt = clock.now();
    const personId = (await s.accounts.personFor(p))!.id;
    const photoId = "photo_export_fixture";
    await sql`insert into platform.photos (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at)
      values (${photoId}, ${personId}, 'slop', 'private/storage-key', 'image/jpeg', 1234, ${"f".repeat(64)}, 'fixture', ${new Date(takenAt)})`;
    for (const [id, value, provenance, source, status, tags] of [
      ["zip", "11222", "said", "web_join", "confirmed", []],
      ["confirmed", "early evenings", "inferred", "google_calendar", "confirmed", []],
      ["pending", "pending private suggestion", "inferred", "google_calendar", "proposed", []],
      ["staff", "private staff assessment", "vouched", "staff", "confirmed", []],
      ["rating", "private appearance rating", "said", "web_join", "confirmed", ["appearance:overall=0.7"]],
    ] as const) {
      await sql`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
        values ('slop', ${`${slop.id}:export:${id}`}, ${slop.id}, 'fact', ${value}, ${sql.array([...tags], "TEXT")}, 'agent_private', ${provenance}, ${source}, 1, ${status}, ${new Date(takenAt)})`;
    }
    const ex = await call(FR, "GET", "/api/me/export");
    expect(ex.body.app).toBe(FR);
    expect(ex.body.network.member.id).toBe(friends.id);
    expect(ex.body.network.facets.map((f: any) => f.value)).toEqual(["climbing"]);
    expect(ex.body.network.messages.length).toBe(1);
    expect(ex.body.network.photos).toEqual([]);
    expect(JSON.stringify(ex.body)).not.toContain("slop");
    const slopExport = await call("slop", "GET", "/api/me/export");
    expect(slopExport.status).toBe(200);
    expect(slopExport.body.network.facets.map((f: any) => f.value).sort()).toEqual(["11222", "climbing", "early evenings"]);
    expect(slopExport.body.network.photos).toEqual([{ id: photoId, createdAt: takenAt, bytes: 1234, contentType: "image/jpeg" }]);
    expect(JSON.stringify(slopExport.body)).not.toMatch(/private\/storage-key|appearance:overall|private staff assessment|pending private suggestion/);
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

  test("an unsigned member request cannot issue an invite link or contact the named person", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "Sam 29", { app: "friends" })).toBe("joined");
    const m = (await memberOf("friends", p))!;
    const before = await outbound(m.id);
    await text(s, clock, p, "My friend Maya would love this, can you invite her?", { app: "friends" });
    expect(await outbound(m.id)).toEqual(before);
    expect(await count(sql`select count(*)::int as n from platform.member_invitations`)).toBe(0);
    expect((await sql`select count(*)::int as n from network.members where app_id = 'friends'`)[0].n).toBe(1);
  }, T);

  const signedInvitationSecret = "member-invitation-signed-turn-fixture-secret";
  const invitationTurn = (s: NetworkService, clock: SimClock) => async (input: TurnRequest) => {
    const body = JSON.stringify(input);
    return s.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", body, headers: {
      "content-type": "application/json", ...await svcSign(signedInvitationSecret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) }),
    } }));
  };
  test("the prepared Peon signup text joins Peon on the shared signed line", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock, {
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret },
      networks: [{ id: "ntwrk:nyc" }, { id: "peon:nyc", matchingEnabled: false }],
    });
    await s.start();
    const signed = invitationTurn(s, clock);
    const turn = async (messageId: string, from: string, text: string) => {
      const response = await signed({ messageId, from, text, to: LINE, channel: "blooio", transport: "sms", receivedAt: clock.now() });
      expect(response.status).toBe(200);
      return response.json();
    };

    // spec/textEnrollment.md, "A prepared Peon signup names its app on a separate first line"
    const phone = newPhone();
    const profile = "My name is Ari. I am 29 years old. I am looking for remote engineering work.";
    const accepted = await turn("prepared-peon-profile", phone, `join peon\n${profile}`);
    expect(accepted).toMatchObject({ outcome: "handled", app: "peon", reason: "joined" });
    expect(await s.memberApps(phone)).toEqual([expect.objectContaining({ app: "peon" })]);
    expect(await consentOf(phone, "peon")).toBe("opted_in");

    const ordinaryPhone = newPhone();
    expect(await turn("ordinary-peon-mention", ordinaryPhone, `${profile} A friend also told me to join peon.`))
      .toMatchObject({ outcome: "handled", app: "ntwrk", reason: "joined" });
    expect(await s.memberApps(ordinaryPhone)).toEqual([expect.objectContaining({ app: "ntwrk" })]);

    const childPhone = newPhone();
    expect(await turn("prepared-peon-too-young", childPhone, `join peon\r\n${profile.replace("29 years", "12 years")}`))
      .toMatchObject({ outcome: "handled", app: "peon", reason: "under_age" });
    expect(await s.memberApps(childPhone)).toEqual([]);
  }, T);
  test("a committed age correction follows its owner when the old number is reassigned", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const opts = { env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret } };
    const { s } = service(clock, opts);
    const { s: second } = service(clock, { ...opts, instance: "age-reassignment" });
    await s.start();
    await second.start();
    const oldNumber = newPhone(), newNumber = newPhone();
    const app = APPS[FR];
    const consent = { sms: true, wording: app.consent.text } as const;
    const first = await s.accounts.join(app, { e164: oldNumber, personId: null }, {
      firstName: "Ari", age: 25, consent,
    });
    if (!first.ok) throw new Error(`Fixture signup failed: ${first.error}`);
    const owner = { e164: oldNumber, personId: first.membership.personId };
    expect(await second.accounts.startNumberChange(app, owner, newNumber, true, async () => true)).toEqual({ ok: true });
    const rt = s.runtimeFor(FR)!;
    const run = rt.unitOfWork.bind(rt);
    let successor: string | undefined;
    rt.unitOfWork = async (fn, scheduling) => {
      const result = await run(fn, scheduling);
      if (!successor && (await s.people.getPerson(owner.personId))?.lowestAge === 15) {
        const moved = await second.accounts.confirmNumberChange(owner, async () => true);
        if (!moved.ok) throw new Error(`Fixture number change failed: ${moved.error}`);
        const joined = await second.accounts.join(app, { e164: oldNumber, personId: null }, {
          firstName: "Eli", age: 30, consent,
        });
        if (!joined.ok) throw new Error(`Fixture reassignment failed: ${joined.error}`);
        successor = joined.membership.personId;
      }
      return result;
    };
    const response = await invitationTurn(s, clock)({
      messageId: "committed-age-before-reassignment", text: "I am 15 years old.", from: oldNumber,
      app: FR, to: null, channel: "blooio", transport: "imessage", receivedAt: clock.now(),
    });
    expect(response.status).toBe(200);
    expect(successor).toBeDefined();
    expect(successor).not.toBe(owner.personId);
    expect(await s.accounts.personFor(newNumber)).toMatchObject({ id: owner.personId, lowestAge: 15 });
    expect(await s.accounts.personFor(oldNumber)).toMatchObject({ id: successor, lowestAge: 30 });
    expect(await s.people.ageFloor(s.accounts.phoneHash(oldNumber))).toBe(30);
    expect(await s.people.ageFloor(s.accounts.phoneHash(newNumber))).toBe(15);
  }, T);

  test.each([{ before: 25, after: 15 }, { before: 15, after: 12 }])("a signed age correction from $before to $after survives interrupted projection", async ({ before, after }) => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const opts = { env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret } };
    const { s } = service(clock, opts);
    await s.start();
    const e164 = newPhone();
    for (const appId of [FR, "slop"] as const) {
      const app = APPS[appId];
      expect(await s.accounts.join(app, { e164, personId: null }, {
        firstName: "Ari", age: before, consent: { sms: true, wording: app.consent.text },
      })).toMatchObject({ ok: true });
    }
    const person = (await s.accounts.personFor(e164))!;
    const phoneHash = s.accounts.phoneHash(e164);
    const friends = (await memberOf(FR, e164))!;
    const slop = (await memberOf("slop", e164))!;
    let interrupted = false;
    s.accounts.projectRecordedAge = async () => { interrupted = true; throw new Error("fixture: interruption before age projection"); };
    const response = await invitationTurn(s, clock)({
      messageId: `age-crash-${after}`, text: `I am ${after} years old.`, from: e164, app: FR,
      to: null, channel: "blooio", transport: "imessage", receivedAt: clock.now(),
    });
    expect(response.status).toBe(409);
    expect(interrupted).toBe(true);
    expect(await sql`select lowest_age from platform.people where id=${person.id}::uuid`).toEqual([{ lowest_age: after }]);
    expect(await sql`select lowest_age from platform.age_floor where phone_hash=${phoneHash}`).toEqual([{ lowest_age: after }]);
    expect(await sql`select age from platform.matching_ages_slop where member_id=${slop.id}`).toEqual([{ age: after }]);
    if (after === 15) return;
    expect(await s.people.getMembership(person.id, "slop")).toMatchObject({ state: "active" });
    expect(await sql`select account_status from network.members where id=${friends.id}`).toEqual([{ account_status: "removed" }]);

    const optsIn = () => count(sql`select count(*)::int as n from platform.consent_events where e164=${e164} and source='keyword:start'`);
    const slopTurn = (messageId: string, text: string): TurnRequest => ({ messageId, text, from: e164, app: "slop", to: null,
      channel: "blooio", transport: "imessage", receivedAt: clock.now() });
    const beforeCleanup = await invitationTurn(s, clock)(slopTurn("underage-stale-membership-start", "START"));
    expect(await optsIn()).toBe(0);
    expect(await beforeCleanup.json()).toMatchObject({ outcome: "handled", reason: "under_age", accountEligible: false, memberId: null });
    clock.advance(11 * MINUTE); // The interrupted turn no longer holds ordinary messages.
    const message = await invitationTurn(s, clock)(slopTurn("underage-stale-membership-message", "Tell me what you remember about me."));
    expect(await message.json()).toMatchObject({ outcome: "handled", reason: "under_age", accountEligible: false, memberId: null });
    expect(await sql`select 1 from network.messages where app_id='slop' and id='in:blooio:underage-stale-membership-message'`).toEqual([]);
    const help = await invitationTurn(s, clock)(slopTurn("underage-stale-membership-help", "HELP"));
    expect(await help.json()).toMatchObject({ outcome: "handled", replies: [APPS.slop.brand.help], memberId: null });

    await s.close();
    const { s: resumed } = service(clock, opts);
    await resumed.start();
    await resumed.inboxTick();
    await resumed.inboxTick();
    expect(await sql`select app_id,state,first_name,profile from platform.memberships where person_id=${person.id}::uuid order by app_id`)
      .toEqual([{ app_id: "friends", state: "removed", first_name: null, profile: {} }, { app_id: "slop", state: "removed", first_name: null, profile: {} }]);
    expect(await sql`select app_id,account_status,name from network.members where id in (${friends.id},${slop.id}) order by app_id`)
      .toEqual([{ app_id: "friends", account_status: "removed", name: null }, { app_id: "slop", account_status: "removed", name: null }]);
    expect(await sql`select app_id,state from platform.consent_events where e164=${e164} and source='join_declined' order by app_id`)
      .toEqual([{ app_id: "friends", state: "opted_out" }, { app_id: "slop", state: "opted_out" }]);
    const afterCleanup = await invitationTurn(resumed, clock)(slopTurn("underage-removed-membership-start", "START"));
    expect(await optsIn()).toBe(0);
    expect(await afterCleanup.json()).toMatchObject({ outcome: "handled", reason: "under_age", accountEligible: false, memberId: null });
  }, T);

  const confirmInvitationVouch = async (send: ReturnType<typeof invitationTurn>, request: TurnRequest, evidence: string) => {
    const asked = await send(request);
    expect(asked.status).toBe(200);
    expect((await asked.json()).replies.join("\n")).toContain("how well");
    const readback = await send({ ...request, messageId: `${request.messageId}:facts`, text: evidence });
    expect(readback.status).toBe(200);
    expect((await readback.json()).replies.join("\n")).toContain("CONFIRM INVITE");
    const confirmation = { ...request, messageId: `${request.messageId}:confirm`, text: "CONFIRM INVITE" };
    const result = await send(confirmation);
    const response = await result.json();
    expect(result.status, JSON.stringify(response)).toBe(200);
    return { confirmation, response };
  };

  // spec/cofounderIntent.md, "Story: Keep looking for a cofounder"
  test("only signed own cofounder goals persist as standing intents without an immediate proposal", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const { s } = service(clock, {
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret },
      webhookSecrets: { peon: APP_SECRET },
      networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false },
        { id: "friends:nyc", matchingEnabled: false }],
    });
    await s.start();
    const phone = newPhone(), teen = newPhone();
    async function enroll(app: AppId, e164: string, age: number) {
      const invited = await s.accounts.invite(APPS[app], e164);
      if (!invited) throw new Error("Missing fixture invitation");
      const result = await s.accounts.join(APPS[app], { e164, personId: invited.personId }, {
        firstName: e164 === phone ? "Ari" : "Eli", age, homeCity: "nyc",
        consent: { sms: true, wording: APPS[app].consent.text },
      });
      if (!result.ok) throw new Error(`Fixture signup failed: ${result.error}`);
      return result.membership;
    }
    const peon = await enroll("peon", phone, 31);
    const ntwrk = await enroll("ntwrk", phone, 31);
    await enroll("friends", phone, 31);
    await enroll("peon", teen, 17);

    const send = invitationTurn(s, clock);
    const turn = (messageId: string, body: string, app: AppId = "peon", from = phone): TurnRequest =>
      ({ messageId, text: body, from, app, to: null, channel: "blooio", transport: "imessage", receivedAt: clock.now() - MINUTE });
    const command = async (input: TurnRequest) => {
      const response = await send(input);
      return { status: response.status, body: await response.json() };
    };
    const rows = () => sql`select app_id, id, member_id, objective, category, details, status, created_at
      from network.intents where details = 'cofounder:member-confirmed' order by created_at, id`;
    const affirmative = "I’m looking for a co-founder for my startup.";
    await text(s, clock, phone, affirmative, { app: "peon" });
    expect(await s.submitProfile(ntwrk.personId, "ntwrk", phone, affirmative)).toBe("accepted");
    for (const [id, body] of [
      ["negative", "I'm not looking for a cofounder."],
      ["third-person", "My friend is looking for a cofounder."],
      ["quoted", '"I want a cofounder."'],
      ["conditional", "I want a cofounder if we launch."],
    ]) expect((await command(turn(`cofounder-${id}`, body!))).status).toBe(200);
    expect((await command(turn("cofounder-friends", affirmative, "friends"))).status).toBe(200);
    expect((await command(turn("cofounder-teen", affirmative, "peon", teen))).status).toBe(200);
    expect(await rows()).toEqual([]);

    const firstRequest = turn("cofounder-peon", affirmative);
    const accepted = await command(firstRequest);
    expect(accepted).toMatchObject({ status: 200, body: { reason: "cofounder_intent", replies: [expect.stringContaining("I noted your cofounder goal")] } });
    expect(await command(firstRequest)).toEqual(accepted);
    const [first] = await rows();
    if (!first) throw new Error("The signed goal did not create an intent");
    expect(first).toMatchObject({
      app_id: "peon", member_id: peon.memberId, objective: "find a cofounder", category: "professional",
      details: "cofounder:member-confirmed", status: "active", created_at: new Date(clock.now()),
    });
    clock.advance(MINUTE);
    await command(turn("cofounder-peon-repeat", "I want a cofounder."));
    expect(await rows()).toEqual([first]);

    const listed = await command(turn("cofounder-peon-list", "List my intents"));
    const reference = /I-[A-F0-9]{12}/.exec(listed.body.replies.join("\n"))?.[0];
    if (!reference) throw new Error("The cofounder intent was not listed");
    await command(turn("cofounder-peon-pause", `Pause intent ${reference}`));
    const repeatPaused = await command(turn("cofounder-peon-paused-repeat", affirmative));
    expect(repeatPaused.body.replies).toEqual(accepted.body.replies);
    expect(await rows()).toEqual([{ ...first, status: "paused" }]);
    await command(turn("cofounder-peon-close", `Close intent ${reference}`));
    await command(turn("cofounder-peon-new", "Could you help me find a cofounder?"));
    await command(turn("cofounder-network", "I want a cofounder.", "ntwrk"));
    const current = await rows();
    expect(current).toHaveLength(3);
    expect(current).toEqual(expect.arrayContaining([
      { ...first, status: "closed" },
      expect.objectContaining({ app_id: "peon", member_id: peon.memberId, status: "active", id: expect.not.stringMatching(first.id) }),
      expect.objectContaining({ app_id: "ntwrk", member_id: ntwrk.memberId, status: "active", id: expect.not.stringMatching(first.id) }),
    ]));
    expect(await count(sql`select count(*)::int as n from network.opportunities`)).toBe(0);
    await command(turn("cofounder-stop", "STOP"));
    expect((await command(firstRequest)).status).toBe(409);
  }, T);

  // spec/cofounderDispatch.md, "A review, probe and reveal require both exact intents"
  test("cofounder dispatch rechecks the exact approved intents and mutual consent at the queue", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const sent: SendRequest[] = [];
    const { s } = service(clock, {
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret },
      networks: [{ id: "peon:nyc", matchingEnabled: false }, { id: "ntwrk:nyc", matchingEnabled: false }],
      adapter: (_net, rt) => new BlooioAdapter({ app: rt.app.id, from: LINE, clock, liveGate: () => true, log: () => {},
        provider: { kind: "sim", async send(request) {
          sent.push(request);
          return { providerMessageId: `cofounder-fixture-${sent.length}`, status: "sent", acceptedAt: clock.now() };
        } },
      }),
    });
    await s.start();
    const send = invitationTurn(s, clock);
    const firstPhone = newPhone(), secondPhone = newPhone();
    async function enrollWithIntent(app: AppId, phone: string, firstName: string) {
      const invited = await s.accounts.invite(APPS[app], phone);
      if (!invited) throw new Error("Missing fixture invitation");
      const joined = await s.accounts.join(APPS[app], { e164: phone, personId: invited.personId }, {
        firstName, age: 31, homeCity: "nyc", consent: { sms: true, wording: APPS[app].consent.text },
      });
      if (!joined.ok) throw new Error(`Fixture signup failed: ${joined.error}`);
      const memberId = joined.membership.memberId;
      const reply = await send({ messageId: `cofounder-dispatch:${app}:${firstName}`, from: phone, to: null,
        text: "I want a cofounder.", channel: "blooio", transport: "imessage", app, receivedAt: clock.now() });
      expect(await reply.json()).toMatchObject({ outcome: "handled", reason: "cofounder_intent" });
      const [intent] = await sql<{ id: string }[]>`select id from network.intents where app_id=${app} and member_id=${memberId}`;
      if (!intent) throw new Error("Missing fixture intent");
      return { memberId, intentId: intent.id };
    }
    const first = await enrollWithIntent("peon", firstPhone, "Ari");
    const second = await enrollWithIntent("peon", secondPhone, "Sam");
    const otherApp = await enrollWithIntent("ntwrk", secondPhone, "Sam");
    const participants = [first.memberId, second.memberId];
    const rt = s.runtimeFor("peon")!;
    const initial = await rt.readState(n => n.exportState());
    const now = clock.now();
    const review = { queuedAt: now, deadline: now + HOUR, decision: "approve" as const, reviewer: "fixture" };
    // Supply the proposal snapshot at the queue boundary. Memberships and the two intents came from live intake.
    const opp: NetworkState["opps"][number] = {
      id: "fixture-cofounder-introduction", origin: "engine", kind: "intro", category: "professional", lane: "Cofounder",
      objective: "find a cofounder", detail: "Cofounder introduction", participants, alternates: [], primed: [], tags: [],
      cofounderIntents: { [first.memberId]: first.intentId, [second.memberId]: second.intentId },
      status: participants.map(id => [id, "probing"]), explanations: {}, stage: "probing", createdAt: now, deadline: now + HOUR,
      score: 1, components: { fit: 1, mutualBenefit: 1, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
        interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1 }, generator: "fixture", exploration: false,
      sameDay: false, contacted: [], reminded: [], feedbackFrom: [], replacements: 0,
    };
    const setOpportunity = (changes: Partial<NetworkState["opps"][number]> = {}) => sql`update network.network_state
      set state=${{ ...initial, opps: [{ ...opp, ...changes }] }}::jsonb where id=${rt.id}`;
    const admit = (kind: "probe" | "reveal", memberId = first.memberId) => rt.scoped(tx => rt.cofounderAdmission(tx,
      { id: `cofounder-intro:${kind}:fixture`, memberId, oppId: opp.id }));
    const denied = { ok: false, reason: "cofounder_intent_changed" };
    await setOpportunity({ stage: "review", review });
    expect(await admit("probe")).toEqual(denied);
    await setOpportunity();
    expect(await admit("probe")).toEqual(denied);
    await setOpportunity({ review });
    expect(await admit("probe")).toEqual({ ok: true });
    expect(await admit("probe", otherApp.memberId)).toEqual(denied);
    expect(await admit("reveal")).toEqual(denied);
    await setOpportunity({ review, cofounderIntents: { ...opp.cofounderIntents, [second.memberId]: otherApp.intentId } });
    expect(await admit("probe")).toEqual(denied);
    await setOpportunity({ review, participants: [first.memberId, first.memberId] });
    expect(await admit("probe")).toEqual(denied);

    const mutual: Partial<NetworkState["opps"][number]> = { review, stage: "scheduled",
      status: participants.map(id => [id, "yes"]), contacted: participants, bookedTold: participants, meetingAt: clock.now() + DAY };
    await setOpportunity({ ...mutual, review: undefined });
    expect(await admit("reveal")).toEqual(denied);
    await setOpportunity({ ...mutual, status: [[first.memberId, "yes"], [second.memberId, "no"]] });
    expect(await admit("reveal")).toEqual(denied);
    await setOpportunity({ ...mutual, contacted: [first.memberId] });
    expect(await admit("reveal")).toEqual(denied);
    await setOpportunity(mutual);
    expect(await admit("reveal")).toEqual({ ok: true });
    expect(await admit("probe")).toEqual(denied);

    const probeId = "cofounder-intro:probe:dispatched";
    const revealId = "cofounder-intro:reveal:dispatched";
    const revokedId = "cofounder-intro:reveal:withdrawn";
    const queue = (messageId: string, type: "probe" | "proposal", memberId = first.memberId, to = firstPhone) => rt.unitOfWork(() => rt.unit.sends.push({
      id: messageId, memberId, to, body: type === "probe" ? "Would you like a startup introduction?" : "Your startup introduction is ready.",
      kind: "transactional", type, oppId: opp.id, proactive: false, system: false, ts: clock.now(),
    }));
    const dispatched = () => sent.map(message => message.context?.id).filter(value => value?.startsWith("cofounder-intro:"));
    await setOpportunity({ review });
    await queue(probeId, "probe");
    expect(dispatched()).toEqual([probeId]);

    await setOpportunity(mutual);
    await queue(revealId, "proposal", second.memberId, secondPhone);
    expect(dispatched()).toEqual([probeId, revealId]);
    await sql`update network.intents set status='paused' where app_id='peon' and id=${second.intentId}`;
    expect(await admit("reveal")).toEqual(denied);
    await sql`update network.intents set status='closed' where app_id='peon' and id=${second.intentId}`;
    const replacement = await send({ messageId: "cofounder-dispatch-replacement", from: secondPhone, to: null,
      text: "I want a cofounder.", channel: "blooio", transport: "imessage", app: "peon", receivedAt: clock.now() });
    expect(await replacement.json()).toMatchObject({ outcome: "handled", reason: "cofounder_intent" });
    expect(await sql`select id from network.intents where app_id='peon' and member_id=${second.memberId} and status='active'`)
      .toEqual([{ id: expect.not.stringMatching(second.intentId) }]);
    expect(await admit("reveal")).toEqual(denied);
    await queue(revokedId, "proposal");
    expect(dispatched()).toEqual([probeId, revealId]);
    expect((await sql`select status, provider_message_id from platform.outbound where id=${revokedId}`)[0])
      .toEqual({ status: "suppressed_ineligible", provider_message_id: null });
  }, T);

  // spec/profileFactEdit.md, "Only a direct request from the current app member can show their saved facts"
  test("signed own-fact edits confirm one current fact and keep other apps and members unchanged", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const { s } = service(clock, { env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret } });
    await s.start();
    const ownerPhone = newPhone(), otherPhone = newPhone();
    const original = "Competitive chess", replacement = "Weekend puzzle hunts";

    async function enroll(app: AppId, e164: string, firstName: string, interest: string) {
      const invitation = await s.accounts.invite(APPS[app], e164);
      if (!invitation) throw new Error("Missing fixture staff invitation");
      const joined = await s.accounts.join(APPS[app], { e164, personId: invitation.personId }, {
        firstName, age: 30, homeCity: "nyc", interests: [interest], consent: { sms: true, wording: APPS[app].consent.text },
      });
      if (!joined.ok) throw new Error(`Fixture signup failed: ${joined.error}`);
      return joined.membership.memberId;
    }

    const owner = await enroll("ntwrk", ownerPhone, "Ari", original);
    const sibling = await enroll("friends", ownerPhone, "Ari", "Birdwatching");
    const other = await enroll("ntwrk", otherPhone, "Ben", "Street photography");
    const send = invitationTurn(s, clock);
    const turn = (messageId: string, text: string, from = ownerPhone, app: AppId = "ntwrk"): TurnRequest =>
      ({ messageId, text, from, app, to: null, channel: "blooio", transport: "imessage", receivedAt: clock.now() });
    const command = async (input: TurnRequest) => {
      const res = await send(input);
      const body = await res.json();
      return { status: res.status, text: (body.replies ?? []).join("\n") as string };
    };
    const interest = async (app: AppId, member: string) => (await sql`select value,privacy_scope,tags from network.facets
      where app_id=${app} and member_id=${member} and kind='interest' and status='confirmed'`).map(({ value, privacy_scope, tags }) => ({ value, privacy_scope, tags }));
    const membershipInterests = async (app: AppId, member: string) =>
      (await sql`select profile->'interests' as interests from platform.memberships where app_id=${app} and member_id=${member}`)[0]?.interests;
    const originalInterest = await interest("ntwrk", owner);
    const siblingInterest = await interest("friends", sibling);
    const otherInterest = await interest("ntwrk", other);

    const initial = turn("fact-owner-list", "What do you know about me?");
    const listing = await command(initial);
    expect(listing.status).toBe(200);
    expect(listing.text).toMatch(/Interests[\s\S]*Competitive chess[\s\S]*Source: You[\s\S]*Scope: matchable/);
    expect(listing.text).not.toMatch(/Birdwatching|Street photography/);
    expect(listing.text).not.toContain(owner);
    const factCode = (text: string) => text.match(/pfr_[a-p]{32}/)?.[0];
    const reference = factCode(listing.text);
    if (!reference) throw new Error("The fact list has no opaque reference");
    const promptCode = (text: string) => text.match(/CONFIRM FACT EDIT (pfc_[a-p]{32})/)?.[1];
    const staged = await command(turn("fact-owner-stage", `CORRECT FACT ${reference} TO ${replacement}`));
    expect(staged.status).toBe(200);
    expect(staged.text).not.toMatch(/Competitive chess|Weekend puzzle hunts/);
    const draft = promptCode(staged.text);
    if (!draft) throw new Error("The fact edit has no confirmation code");
    const confirm = `CONFIRM FACT EDIT ${draft}`;
    await command(turn("fact-owner-bare-yes", "yes"));
    expect((await command(turn("fact-other-member-confirm", confirm, otherPhone))).text).not.toContain("applied");
    expect((await command(turn("fact-other-app-confirm", confirm, ownerPhone, "friends"))).text).not.toContain("applied");
    expect(await interest("ntwrk", owner)).toEqual(originalInterest);
    expect(await membershipInterests("ntwrk", owner)).toEqual([original]);

    const confirmTurn = turn("fact-owner-confirm", confirm);
    expect(await command(confirmTurn)).toMatchObject({ status: 200, text: expect.stringContaining("applied that edit") });
    expect(await command(confirmTurn)).toMatchObject({ status: 200, text: expect.stringContaining("applied that edit") });
    expect(await interest("ntwrk", owner)).toEqual([{ value: replacement, privacy_scope: "matchable", tags: [] }]);
    expect(await membershipInterests("ntwrk", owner)).toEqual([replacement]);
    expect((await command(initial)).status).toBe(409);
    const changed = await command(turn("fact-owner-list-after-edit", "SHOW MY FACTS"));
    expect(changed.text).toContain(replacement);
    expect(changed.text).not.toContain(original);
    expect(JSON.stringify(await sql`select body from network.messages where id='in:blooio:fact-owner-stage'`)).not.toMatch(/pfr_|Weekend puzzle hunts/);

    const editedRef = factCode(changed.text);
    if (!editedRef) throw new Error("The corrected fact has no reference");
    const scope = await command(turn("fact-owner-stage-scope", `SET FACT SCOPE ${editedRef} TO agent_private`));
    const scopeDraft = promptCode(scope.text);
    if (!scopeDraft) throw new Error("The scope change has no confirmation code");
    expect((await command(turn("fact-owner-confirm-scope", `CONFIRM FACT EDIT ${scopeDraft}`))).text).toContain("applied that edit");
    expect(await interest("ntwrk", owner)).toEqual([{ value: replacement, privacy_scope: "agent_private", tags: [] }]);
    const ownedOnly = await command(turn("fact-owner-private-list", "SHOW MY FACTS"));
    expect(ownedOnly.text).toMatch(/Weekend puzzle hunts[\s\S]*Scope: agent_private/);
    const privateRef = factCode(ownedOnly.text);
    if (!privateRef) throw new Error("The private fact has no reference");
    const removal = await command(turn("fact-owner-stage-removal", `REMOVE FACT ${privateRef}`));
    const removalDraft = promptCode(removal.text);
    if (!removalDraft) throw new Error("The removal has no confirmation code");
    expect((await command(turn("fact-owner-confirm-removal", `CONFIRM FACT EDIT ${removalDraft}`))).text).toContain("applied that edit");
    expect(await interest("ntwrk", owner)).toEqual([]);
    expect(await membershipInterests("ntwrk", owner)).toEqual([]);
    expect(await interest("friends", sibling)).toEqual(siblingInterest);
    expect(await interest("ntwrk", other)).toEqual(otherInterest);
    expect(await membershipInterests("friends", sibling)).toEqual(["Birdwatching"]);
    expect(await membershipInterests("ntwrk", other)).toEqual(["Street photography"]);

    const otherList = turn("fact-other-current-list", "SHOW MY FACTS", otherPhone);
    expect((await command(otherList)).text).toContain("Street photography");
    expect((await command(turn("fact-other-stopped", "STOP", otherPhone))).status).toBe(200);
    expect(await command(otherList)).toEqual({ status: 409, text: "" });
  }, T);

  // spec/product/stories.md, "Seed invitations use the same acceptance rules"
  test("a scoped staff seed batch is private and only creates membership on its first verified acceptance", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const sent: SendRequest[] = [];
    const { s, otp } = service(clock, {
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret },
      networks: [{ id: "ntwrk:nyc" }, { id: "ntwrk:sf" }, { id: "friends:nyc" }],
      tokens: "admin@ntwrk:seed-admin,admin@friends:other-admin,reviewer@ntwrk:seed-reviewer",
      adapter: (_net, rt) => new BlooioAdapter({ app: rt.app.id, from: LINE, clock, liveGate: () => true, log: () => {},
        provider: { kind: "sim", async send(request) {
          sent.push(request);
          return { providerMessageId: `seed-invite-fixture-${sent.length}`, status: "sent", acceptedAt: clock.now() };
        } },
      }),
    });
    await s.start();
    const target = newPhone(), stoppedPhone = newPhone(), bannedPhone = newPhone(), expiredPhone = newPhone(), wrongPhone = newPhone();
    const vouch = "The fixture operator knows this recipient through a local meetup.";
    const batch = {
      batchId: "2e43de36-74a3-4e40-96f4-a482a53dc1a8",
      invitations: [target, stoppedPhone, bannedPhone, expiredPhone].map(phone => ({ phone, city: "nyc" as const, vouch })),
    };
    const seed = async (token: string | undefined, app: AppId | undefined, data: unknown = batch) => {
      const res = await s.fetch(new Request(`http://127.0.0.1${app ? `/apps/${app}` : ""}/invite/seed`, { method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(data),
      }));
      return { status: res.status, body: await res.json() };
    };
    expect((await seed(undefined, "ntwrk")).status).toBe(401);
    expect((await seed("seed-reviewer", "ntwrk")).status).toBe(403);
    expect((await seed("other-admin", "ntwrk")).status).toBe(403);
    expect((await seed("seed-admin", "friends")).status).toBe(403);
    expect((await seed("seed-admin", undefined)).status).toBe(404);
    expect((await seed("seed-admin", "ntwrk", { ...batch, invitations: [{ phone: target, city: "boston", vouch }] })).status).toBe(400);

    const created = await seed("seed-admin", "ntwrk");
    expect(created).toMatchObject({ status: 200, body: { ok: true, batchId: batch.batchId, replayed: false } });
    const links = created.body.invitations as { link: string; city: string; expiresAt: number }[];
    expect(links).toHaveLength(4);
    for (const row of links) {
      expect(row).toMatchObject({ link: expect.stringMatching(/^https:\/\/ntwrk\.party\/SKILL\.md#invite=[A-Za-z0-9_-]{43}$/), city: "nyc" });
      expect(row.expiresAt).toBeGreaterThan(clock.now());
    }
    expect(new Set(links.map(row => row.link)).size).toBe(4);
    expect(JSON.stringify(created.body)).not.toContain(vouch);
    for (const { phone } of batch.invitations) expect(JSON.stringify(created.body)).not.toContain(phone);
    expect(await seed("seed-admin", "ntwrk")).toMatchObject({ status: 200, body: { ok: true, invitations: links, replayed: true } });
    const changed = { ...batch, invitations: [{ ...batch.invitations[0]!, city: "sf" }, ...batch.invitations.slice(1)] };
    expect((await seed("seed-admin", "ntwrk", changed)).status).toBe(409);
    expect(await count(sql`select count(*)::int as n from platform.people`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from platform.memberships`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from network.members`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from platform.outbound`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from platform.seed_invitation_attributions`)).toBe(0);
    const issuedRows = await sql`select app_id,ordinal,home_city,recipient_hash,closed_at,ciphertext from platform.seed_invitations order by ordinal`;
    expect([...issuedRows].map(row => ({ ...row, ciphertext: !!row.ciphertext }))).toEqual([0, 1, 2, 3].map(ordinal => ({
      app_id: "ntwrk", ordinal, home_city: "nyc", recipient_hash: expect.stringMatching(/^[0-9a-f]{64}$/), closed_at: null, ciphertext: true,
    })));
    expect([...(await sql`select app_id,actor,detail from network.staff_audit where action='issue_seed_invitation_batch'`)]).toEqual([
      { app_id: "ntwrk", actor: expect.stringMatching(/^token:admin#[0-9a-f]{8}$/), detail: { count: 4 } },
    ]);
    expect(sent).toEqual([]);

    const authenticate = async (phone: string, app: AppId = "ntwrk") => {
      let cookie = "";
      const call = async (path: string, data: Record<string, unknown>) => {
        const res = await s.publicFetch(new Request(`http://localhost:${5101 + APP_IDS.indexOf(app)}${path}`, {
          method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data),
        }));
        cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
        return { status: res.status, body: await res.json() };
      };
      clock.advance(31_000);
      expect((await call("/api/auth/otp/start", { phone })).status).toBe(200);
      expect((await call("/api/auth/otp/verify", { phone, code: otp.codes.get(phone) })).status).toBe(200);
      return call;
    };
    const tokenOf = (i: number) => new URL(links[i]!.link).hash.slice("#invite=".length);
    const profile = (firstName: string, inviteToken: string, app: AppId = "ntwrk") => ({ firstName, age: 30, homeCity: "sf",
      inviteToken, consent: { sms: true, wording: APPS[app].consent.text },
    });
    const wrong = await authenticate(wrongPhone), otherApp = await authenticate(target, "friends"), eligible = await authenticate(target);
    expect((await wrong("/api/join", profile("Maya", tokenOf(0)))).status).toBe(400);
    expect((await otherApp("/api/join", profile("Maya", tokenOf(0), "friends"))).status).toBe(400);
    expect(await memberOf("ntwrk", wrongPhone)).toBeUndefined();
    // spec/siteEnrollment.md, "The approved profile reaches onboarding and its stated age counts":
    // the seed welcome delivers the joined profile once, as the member-invitation welcome does.
    const learned: string[] = [];
    const submitProfile = s.submitProfile.bind(s);
    s.submitProfile = async (personId, appId, e164, text) => { learned.push(text); return submitProfile(personId, appId, e164, text); };
    const about = "I host a monthly supper club and want to meet other founders.";
    const accepted = await eligible("/api/join", { ...profile("Maya", tokenOf(0)), about });
    expect(accepted).toMatchObject({ status: 200, body: { ok: true, membership: { state: "active" } } });
    expect(learned).toHaveLength(1);
    expect(learned[0]).toContain(about);
    const member = await memberOf("ntwrk", target);
    if (!member) throw new Error("The accepted seed did not create its verified membership");
    expect((await sql`select home_city,account_status,opted_out from network.members where app_id='ntwrk' and id=${member.id}`)[0])
      .toEqual({ home_city: "sf", account_status: "active", opted_out: false });
    const attribution = await sql`select a.app_id,a.member_id,a.home_city,a.issuer_id=b.issuer_id as actor_matches,a.redeemed_at,a.welcome_projected_at,b.issuer_id
      from platform.seed_invitation_attributions a join platform.seed_invitation_batches b on a.app_id=b.app_id and a.batch_id=b.id`;
    expect([...attribution]).toEqual([{ app_id: "ntwrk", member_id: member.id, home_city: "nyc", actor_matches: true,
      redeemed_at: expect.any(Date), welcome_projected_at: expect.any(Date), issuer_id: expect.stringMatching(/^token:admin#[0-9a-f]{8}$/),
    }]);
    expect((await sql`select recipient_hash,closed_at,ciphertext from platform.seed_invitations where ordinal=0`)[0])
      .toEqual({ recipient_hash: null, closed_at: expect.any(Date), ciphertext: null });
    expect(await count(sql`select count(*)::int as n from platform.memberships`)).toBe(1);
    await eligible("/api/join", { ...profile("Maya", tokenOf(0)), about });
    expect(await count(sql`select count(*)::int as n from platform.memberships`)).toBe(1);
    expect(await count(sql`select count(*)::int as n from platform.seed_invitation_attributions`)).toBe(1);
    expect(learned).toHaveLength(1);
    expect(JSON.stringify(accepted.body)).not.toContain(vouch);
    expect(JSON.stringify(await sql`select value from network.facets where member_id=${member.id}`)).not.toContain(vouch);

    const stopped = await authenticate(stoppedPhone), banned = await authenticate(bannedPhone);
    const signed = invitationTurn(s, clock);
    expect((await signed({ messageId: "seed-recipient-stop", from: stoppedPhone, to: null, channel: "blooio", transport: "imessage",
      app: "ntwrk", receivedAt: clock.now(), text: "STOP" })).status).toBe(200);
    expect((await stopped("/api/join", profile("Stopped", tokenOf(1)))).status).toBe(400);
    await s.people.ban({ id: "seed-fixture-ban", scope: "phone", personId: null, phoneHash: s.accounts.phoneHash(bannedPhone), reason: "Fixture safety ban",
      reportId: null, bannedBy: "fixture-admin", at: clock.now() });
    // spec/webSession.md, "Only a live token on the requested app can authenticate":
    // A ban after sign-in stops the session before /api/join reads the invitation.
    expect(await banned("/api/join", profile("Banned", tokenOf(2))))
      .toEqual({ status: 401, body: { ok: false, error: "unauthorized" } });
    clock.advance(links[3]!.expiresAt - clock.now() + 1);
    const expired = await authenticate(expiredPhone);
    expect((await expired("/api/join", profile("Expired", tokenOf(3)))).status).toBe(400);
    expect((await seed("seed-admin", "ntwrk")).status).toBe(409);
    expect(await count(sql`select count(*)::int as n from platform.memberships`)).toBe(1);
    expect(sent.some(request => request.text.includes("#invite="))).toBe(false);
  }, T);

  // spec/memberInvitation.md, "The link goes to the inviter as a reply"
  // spec/memberInvitation.md, "A new verified acceptance can be attributed"
  test("a signed vouch issues a private single-use invitation for a verified app join", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const hashKey = "synthetic-vouch-review-fixture-hash";
    const { s, otp } = service(clock, {
      env: { PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: hashKey, SERVICE_TURN_SECRET: signedInvitationSecret },
      adapter: (_net, rt) => new BlooioAdapter({ app: rt.app.id, from: LINE, clock, liveGate: () => false, log: () => {}, provider: {
        kind: "sim", send: async () => { throw new Error("This fixture must collect private replies without delivery"); },
      } }),
    });
    await s.start();
    const inviterPhone = newPhone();
    const staffInvite = await s.accounts.invite(APPS.ntwrk, inviterPhone);
    if (!staffInvite) throw new Error("The fixture's staff invitation is missing");
    const invited = { ...staffInvite, memberId: "ntwrk_00000000-0000-4000-8000-000000000001" };
    await sql`update platform.memberships set member_id=${invited.memberId} where app_id='ntwrk' and person_id=${invited.personId}`;
    const bodyFor = (firstName: string, app: AppId = "ntwrk") => ({ firstName, age: 31, consent: { sms: true as const, wording: APPS[app].consent.text } });
    expect(await s.accounts.join(APPS.ntwrk, { e164: inviterPhone, personId: invited.personId }, bodyFor("Ari"))).toMatchObject({ ok: true });
    const send = invitationTurn(s, clock);
    const request: TurnRequest = { messageId: "invite-own", from: inviterPhone, to: null, text: "Can you invite my friend Maya?", channel: "blooio", transport: "imessage", receivedAt: clock.now(), app: "ntwrk" };
    const { confirmation: input, response } = await confirmInvitationVouch(send, request, "I know them well, for two years.");
    expect(response).toMatchObject({ outcome: "handled", reason: "member_invitation", memberId: invited.memberId, delivery: "collected" });
    const [, token] = response.replies[0].match(/https:\/\/ntwrk\.party\/SKILL\.md#invite=([a-zA-Z0-9_-]{43})$/) ?? [];
    expect(token).toHaveLength(43);
    expect(await (await send(input)).json()).toEqual(response);
    const rows = await sql`select relationship, inviter_member_id, token_hash, redeemed_at, duration_months, depth from platform.member_invitations`;
    expect([...rows]).toEqual([{ relationship: "friend", inviter_member_id: invited.memberId, token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      redeemed_at: null, duration_months: 24, depth: "well" }]);
    expect(JSON.stringify(await sql`select state from network.network_state`)).not.toContain(token);
    expect(JSON.stringify(await sql`select body from network.messages`)).not.toContain(token);
    expect(JSON.stringify(await sql`select body from network.messages`)).not.toContain("for two years");
    expect(await count(sql`select count(*)::int as n from network.members`)).toBe(1);

    const client = (app: AppId) => {
      let cookie = "";
      return async (path: string, data: unknown) => {
        const res = await s.publicFetch(new Request(`http://localhost:${5101 + APP_IDS.indexOf(app)}${path}`, {
          method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data),
        }));
        cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
        return { status: res.status, body: await res.json() };
      };
    };
    const login = async (call: ReturnType<typeof client>, phone: string) => {
      clock.advance(31_000);
      expect((await call("/api/auth/otp/start", { phone })).status).toBe(200);
      expect((await call("/api/auth/otp/verify", { phone, code: otp.codes.get(phone) })).status).toBe(200);
    };
    const first = client("ntwrk");
    const second = client("ntwrk");
    const otherApp = client("friends");
    expect((await first("/api/join", { ...bodyFor("Maya"), inviteToken: token })).status).toBe(401);
    const inviteePhone = newPhone(), secondPhone = newPhone();
    await login(first, inviteePhone);
    await login(second, secondPhone);
    await login(otherApp, inviteePhone);
    expect(await otherApp("/api/join", { ...bodyFor("Maya", "friends"), inviteToken: token })).toMatchObject({ body: { error: "invalid_invitation" } });
    // The platform commit must survive a failed downstream welcome and notice projection.
    await sql`create function platform.fail_fixture_invitation_projection() returns trigger language plpgsql as $$
      begin raise exception 'fixture invitation projection unavailable'; end $$`;
    await sql`create trigger fail_fixture_invitation_projection before update of projected_at on platform.member_invitations
      for each row execute function platform.fail_fixture_invitation_projection()`;
    const attempts = await Promise.all([
      first("/api/join", { ...bodyFor("Maya"), inviteToken: token }),
      second("/api/join", { ...bodyFor("Maya"), inviteToken: token }),
    ]);
    expect(attempts.filter(result => result.status === 200)).toHaveLength(1);
    expect(attempts.find(result => result.status !== 200)?.body).toMatchObject({ error: "invalid_invitation" });
    const [redeemed] = await sql`select redeemed_member_id, projected_at from platform.member_invitations`;
    expect(redeemed.projected_at).toBeNull();
    expect((await sql`select invited_by from network.members where id=${redeemed.redeemed_member_id}`)[0]!.invited_by).toBe(invited.memberId);
    const winningPhone = attempts[0]!.status === 200 ? inviteePhone : secondPhone;
    const welcome = await send({ ...input, from: winningPhone, messageId: "invitee-first-turn", text: "Hi, I just joined." });
    expect(welcome.status).toBe(200);
    expect((await welcome.json()).replies.join("\n")).toContain("Ari");
    await sql`drop trigger fail_fixture_invitation_projection on platform.member_invitations`;
    const rt = s.runtimeFor("ntwrk")!;
    await rt.tick();
    expect((await sql`select projected_at from platform.member_invitations`)[0]!.projected_at).toBeInstanceOf(Date);
    const notices = await sql`select id,body from network.messages where member_id=${invited.memberId} and ${redeemed.redeemed_member_id}=any(invite_join_members)`;
    expect([...notices]).toEqual([{ id: expect.stringMatching(/^invite-notice:/), body: expect.stringContaining("Maya just joined.") }]);
    const noticeId = notices[0]!.id as string;
    expect(await rt.scoped(tx => rt.invitationNoticeAdmission(tx, noticeId, invited.memberId))).toBe(true);
    expect((await send({ ...input, from: winningPhone, messageId: "invitee-stop", text: "STOP" })).status).toBe(200);
    expect(await rt.scoped(tx => rt.invitationNoticeAdmission(tx, noticeId, invited.memberId))).toBe(false);
    expect(await count(sql`select count(*)::int as n from network.members where account_status='active'`)).toBe(2);
    const tokenReplay = await send(input);
    expect(tokenReplay.status).toBe(409);
    expect(await tokenReplay.json()).toMatchObject({ error: "turn_invitation_changed" });

    // This owner and message generate a valid review ID with a phone-like run of digits.
    const pending = await confirmInvitationVouch(send, { ...request, messageId: "invite-weak-18", text: "Can you invite my coworker Theo?" }, "I met them once, three days ago.");
    expect(pending.response).toMatchObject({ reason: "member_invitation_review" });
    expect(pending.response.replies.join("\n")).not.toContain("#invite=");
    const [reviewId] = pending.response.replies.join("\n").match(/mir_[0-9a-f]{32}/) ?? [];
    expect(reviewId).toBe("mir_0295122192be77fedc0639ebf7137b2e");
    expect(await (await send(pending.confirmation)).json()).toEqual(pending.response);
    const reviewReceipt = async (replyIds: string[]) => {
      const { channel, messageId } = pending.confirmation;
      const body = JSON.stringify({ channel, messageId, replyIds, outcome: "accepted", providerMessageIds: ["review-confirmation"], historyRecorded: true } satisfies TurnReceiptRequest);
      const auth = await svcSign(signedInvitationSecret, { method: "POST", path: TURN_RECEIPT_PATH, id: `${messageId}:receipt`, body, nowS: Math.floor(clock.now() / 1000) });
      return s.fetch(new Request(`http://127.0.0.1${TURN_RECEIPT_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body }));
    };
    expect((await reviewReceipt(response.replyIds)).status).toBe(409);
    const receipt = await reviewReceipt(pending.response.replyIds);
    expect(receipt.status).toBe(200);
    expect(await receipt.json()).toEqual({ ok: true, replayed: false });
    expect(await sql`select body,status from network.messages where id in ${sql(pending.response.replyIds)}`)
      .toEqual([{ body: "Private invitation reply.", status: "sent" }]);
    expect(await sql`select id from platform.outbound where id in ${sql(pending.response.replyIds)}`).toEqual([]);
    const staff = async (method: string, token: string, payload?: Record<string, unknown>) => s.fetch(new Request("http://127.0.0.1/apps/ntwrk/review/member-invitations", {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}),
    }));
    expect((await staff("GET", "fr-tok")).status).toBe(403);
    const queue = await staff("GET", "rev-tok");
    expect(queue.status).toBe(200);
    const queued = await queue.json();
    expect(queued.reviews).toMatchObject([{ id: reviewId, durationMonths: 0, depth: "met_once", reviewReasons: ["weak_vouch"] }]);
    expect(JSON.stringify(queued)).not.toMatch(/Theo|#invite=/);
    expect(await count(sql`select count(*)::int as n from platform.member_invitations where redeemed_at is null`)).toBe(0);
    const claim = { ...request, messageId: "claim-reviewed-invite", text: `Check invite ${reviewId}` };
    const waiting = await send({ ...claim, messageId: "invite-review-pending" });
    expect((await waiting.json()).replies.join("\n")).toContain("still waiting for review");
    expect((await staff("POST", "rev-tok", { id: reviewId, decision: "approve" })).status).toBe(200);
    const obsoletePending = await send(pending.confirmation);
    expect(obsoletePending.status).toBe(409);
    expect(await obsoletePending.json()).toMatchObject({ error: "turn_invitation_changed" });
    expect(await count(sql`select count(*)::int as n from platform.member_invitations where redeemed_at is null`)).toBe(0);
    const fresh = await send(claim);
    expect(fresh.status).toBe(200);
    const [, unused] = (await fresh.json()).replies[0].match(/#invite=([a-zA-Z0-9_-]{43})$/) ?? [];
    expect(unused).toHaveLength(43);
    const repeated = await send({ ...claim, messageId: "repeat-reviewed-invite" });
    expect((await repeated.json()).replies.join("\n")).toContain("already received");
    expect(await rt.unitOfWork(net => net.holdMember(invited.memberId, "fixture-reviewer"))).toEqual({ ok: true });
    expect((await send(claim)).status).toBe(409);
    const loser = attempts[0]!.status === 200 ? second : first;
    expect(await loser("/api/join", { ...bodyFor("Theo"), inviteToken: unused })).toMatchObject({ body: { error: "invalid_invitation" } });
    expect(await count(sql`select count(*)::int as n from platform.member_invitations where redeemed_at is null`)).toBe(1);
  }, T);

  // spec/invitationJoinProjection.md, "The inviter's conversation owns a notice after the welcome"
  test("a verified invitation projects welcome and join notice through their separate city owners", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const { s } = service(clock, { env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret },
      networks: [{ id: "ntwrk:nyc" }, { id: "ntwrk:sf" }] });
    await s.start();
    const inviterPhone = newPhone();
    const inviter = await s.accounts.invite(APPS.ntwrk, inviterPhone);
    if (!inviter) throw new Error("The fixture's staff invitation is missing");
    const consent = { sms: true as const, wording: APPS.ntwrk.consent.text };
    expect(await s.accounts.join(APPS.ntwrk, { e164: inviterPhone, personId: inviter.personId },
      { firstName: "Ari", age: 31, homeCity: "nyc", consent })).toMatchObject({ ok: true });
    const send = invitationTurn(s, clock);
    const request: TurnRequest = { messageId: "invite-remote", from: inviterPhone, to: null, text: "Can you invite my friend Daria?",
      channel: "blooio", transport: "imessage", receivedAt: clock.now(), app: "ntwrk" };
    const issued = await confirmInvitationVouch(send, request, "I know them well, for three years.");
    const [, token] = issued.response.replies[0].match(/#invite=([a-zA-Z0-9_-]{43})$/) ?? [];
    expect(token).toHaveLength(43);

    await sql`create function platform.fail_fixture_remote_invite_notice() returns trigger language plpgsql as $$
      begin raise exception 'fixture remote notice unavailable'; end $$`;
    await sql`create trigger fail_fixture_remote_invite_notice before update of projected_at on platform.member_invitations
      for each row when (new.projected_at is not null) execute function platform.fail_fixture_remote_invite_notice()`;
    const inviteePhone = newPhone();
    const joined = await s.accounts.join(APPS.ntwrk, { e164: inviteePhone, personId: null },
      { firstName: "Daria", age: 29, homeCity: "sf", consent }, undefined, token);
    if (!joined.ok) throw new Error(`Fixture join failed: ${joined.error}`);
    const id = joined.membership.memberId;
    const [before] = await sql`select welcome_projected_at,projected_at from platform.member_invitations where redeemed_member_id=${id}`;
    expect(before.welcome_projected_at).toBeInstanceOf(Date);
    expect(before.projected_at).toBeNull();
    expect((await outbound(id)).filter(row => row.type === "onboarding")).toHaveLength(1);

    await sql`drop trigger fail_fixture_remote_invite_notice on platform.member_invitations`;
    const nyc = s.runtimeFor("ntwrk", "nyc")!, sf = s.runtimeFor("ntwrk", "sf")!;
    await nyc.tick();
    expect((await sql`select projected_at from platform.member_invitations where redeemed_member_id=${id}`)[0]!.projected_at).toBeInstanceOf(Date);
    const notices = await sql`select id,body from network.messages where member_id=${inviter.memberId} and ${id}=any(invite_join_members)`;
    expect([...notices]).toEqual([{ id: expect.stringMatching(/^invite-notice:/), body: expect.stringContaining("Daria just joined.") }]);
    expect(await nyc.readState(net => net.memberList().map(person => person.id))).not.toContain(id);
    expect(await sf.readState(net => net.memberList().map(person => person.id))).not.toContain(inviter.memberId);
    const noticeId = notices[0]!.id as string;
    expect(await nyc.scoped(tx => nyc.invitationNoticeAdmission(tx, noticeId, inviter.memberId))).toBe(true);
    expect(await sf.unitOfWork(net => net.holdMember(id, "fixture-reviewer"))).toEqual({ ok: true });
    expect(await nyc.scoped(tx => nyc.invitationNoticeAdmission(tx, noticeId, inviter.memberId))).toBe(false);
  }, T);

  // spec/expectedMemberInvitation.md, "Only a confirmed expected invitation can enter the shared line queue"
  test("the signed turn sends one expected invitation and only the intended verified phone can use it", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const sent: SendRequest[] = [];
    let deliveryLive = true;
    const { s, otp } = service(clock, {
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret }, networks: [{ id: "ntwrk:nyc" }],
      adapter: (_net, rt) => new BlooioAdapter({ app: rt.app.id, from: LINE, clock, liveGate: () => deliveryLive, log: () => {},
        provider: { kind: "sim", async send(request) {
          sent.push(request);
          return { providerMessageId: `expected-invite-fixture-${sent.length}`, status: "sent", acceptedAt: clock.now() };
        } },
      }),
    });
    await s.start();
    const inviterPhone = newPhone(), target = newPhone(), wrongPhone = newPhone(), declinePhone = newPhone(), stoppedPhone = newPhone();
    const inviter = await s.accounts.invite(APPS.ntwrk, inviterPhone);
    if (!inviter) throw new Error("Missing staff invitation for the fixture");
    const profile = (firstName: string) => ({ firstName, age: 30, homeCity: "nyc" as const, consent: { sms: true as const, wording: APPS.ntwrk.consent.text } });
    expect(await s.accounts.join(APPS.ntwrk, { e164: inviterPhone, personId: inviter.personId }, profile("Ari"))).toMatchObject({ ok: true });
    const send = invitationTurn(s, clock);
    const turn = (from: string, messageId: string, text: string): TurnRequest =>
      ({ from, messageId, text, to: null, channel: "blooio", transport: "imessage", receivedAt: clock.now(), app: "ntwrk" });
    const rt = s.runtimeFor("ntwrk")!;
    const recipientSends = () => sent.filter(request => [target, wrongPhone, declinePhone].includes(request.to));
    const queued = () => sql`select id,status,provider_message_ids from platform.outbound where id like 'expected-invite:%'`;

    async function prepare(id: string, name: string, phone: string) {
      const { response } = await confirmInvitationVouch(send, turn(inviterPhone, `${id}-vouch`, `Can you invite my friend ${name}?`), "I know them well, for three years.");
      const link = (response.replies.join("\n") as string).match(/https:\/\/ntwrk\.party\/SKILL\.md#invite=[A-Za-z0-9_-]{43}/)?.[0];
      if (!link) throw new Error("The default vouch flow did not return a forwarding link");
      expect(sent.some(request => request.to === phone)).toBe(false);
      const stage = turn(inviterPhone, `${id}-stage`, `SEND INVITE ${link} TO ${phone}`);
      const requested = await send(stage);
      expect(requested.status).toBe(200);
      const staged = await requested.json();
      const prompt = staged.replies.join("\n") as string;
      expect(prompt).not.toContain(phone);
      expect(prompt).not.toContain(link);
      const confirmation = prompt.match(/CONFIRM EXPECTED INVITE mit_[a-p]{32}/)?.[0];
      if (!confirmation) throw new Error("The expected-invite receipt did not ask for confirmation");
      expect(sent.some(request => request.to === phone)).toBe(false);
      expect(await (await send(stage)).json()).toEqual(staged);
      return { input: turn(inviterPhone, `${id}-confirm`, confirmation), stage, link, token: new URL(link).hash.slice("#invite=".length) };
    }

    const replaced = await prepare("expected-invite-first", "Maya", target);
    const stage = { ...replaced.stage, messageId: "expected-invite-latest-stage" };
    const staged = await send(stage);
    expect(staged.status).toBe(200);
    const challenge = (await staged.json()).replies.join("\n").match(/CONFIRM EXPECTED INVITE mit_[a-p]{32}/)?.[0];
    if (!challenge) throw new Error("The current expected-invite draft has no confirmation reference");
    const first = { ...replaced, stage, input: { ...replaced.input, messageId: "expected-invite-latest-confirm", text: challenge } };
    expect((await send(replaced.stage)).status).toBe(409);
    expect((await send(replaced.input)).status).toBe(200);
    expect(await queued()).toHaveLength(0);
    expect(await count(sql`select count(*)::int as n from platform.expected_member_invitations where ciphertext is not null and queued_at is null`)).toBe(1);
    const wrongCode = first.input.text.endsWith("p") ? "a" : "p";
    await send({ ...first.input, messageId: "expected-invite-wrong-code", text: first.input.text.slice(0, -1) + wrongCode });
    await send({ ...first.input, messageId: "expected-invite-bare-yes", text: "yes" });
    await rt.tick();
    expect(recipientSends()).toEqual([]);
    expect(await queued()).toHaveLength(0);

    const confirmed = await send(first.input);
    expect(confirmed.status).toBe(200);
    const confirmationReceipt = await confirmed.json();
    const obsoletePrompt = await send(first.stage);
    expect(obsoletePrompt.status).toBe(409);
    expect(await obsoletePrompt.json()).toMatchObject({ error: "turn_invitation_changed" });
    const acknowledgement = confirmationReceipt.replies.join("\n") as string;
    expect(acknowledgement).toContain("recorded your confirmation");
    expect(acknowledgement).not.toMatch(/Maya|#invite=/);
    expect(acknowledgement).not.toContain(target);
    const replayed = await send(first.input);
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toEqual(confirmationReceipt);
    await send({ ...first.input, messageId: "expected-invite-confirm-again" });
    await rt.adapter.deliver([]);
    expect(recipientSends().map(request => request.to)).toEqual([target]);
    const [delivery] = recipientSends();
    expect(delivery!.text).toMatch(/Ari invited you to ntwrk\.party[\s\S]*STOP to opt out/i);
    expect(delivery!.text).toContain(first.link);
    expect(delivery!.text).not.toMatch(/Maya|three years/);
    expect(delivery!.text).not.toContain(target);
    expect([...(await queued())]).toEqual([{ id: expect.stringMatching(/^expected-invite:/), status: "sent", provider_message_ids: [expect.any(String)] }]);
    expect(await count(sql`select count(*)::int as n from platform.expected_member_invitations where queued_at is not null and attempted_at is not null and ciphertext is null`)).toBe(1);
    expect(JSON.stringify(await sql`select body from network.messages`)).not.toContain(first.token);
    expect(JSON.stringify(await sql`select body from network.messages`)).not.toContain(target);
    const privateTurn = JSON.stringify(await sql`select event,response,replies from platform.inbound where id='msg:blooio:expected-invite-first-stage'`);
    expect(privateTurn).not.toContain(first.token);
    expect(privateTurn).not.toContain(target);

    const authenticate = async (phone: string) => {
      let cookie = "";
      const call = async (path: string, data: Record<string, unknown>) => {
        const res = await s.publicFetch(new Request(`http://localhost:5101${path}`, { method: "POST",
          headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data),
        }));
        cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
        return { status: res.status, body: await res.json() };
      };
      clock.advance(31_000);
      expect((await call("/api/auth/otp/start", { phone })).status).toBe(200);
      expect((await call("/api/auth/otp/verify", { phone, code: otp.codes.get(phone) })).status).toBe(200);
      return call;
    };
    const wrong = await authenticate(wrongPhone), right = await authenticate(target);
    expect(await wrong("/api/join", { ...profile("Maya"), inviteToken: first.token })).toMatchObject({ status: 400 });
    expect(await memberOf("ntwrk", wrongPhone)).toBeUndefined();
    expect(await right("/api/join", { ...profile("Maya"), inviteToken: first.token })).toMatchObject({ status: 200, body: { ok: true } });
    const joined = await memberOf("ntwrk", target);
    if (!joined) throw new Error("The verified recipient did not become a member");
    expect((await sql`select invited_by from network.members where id=${joined.id}`)[0]).toMatchObject({ invited_by: inviter.memberId });

    clock.advance(MINUTE);
    const second = await prepare("expected-invite-decline", "Dara", declinePhone);
    expect((await send(second.input)).status).toBe(200);
    await rt.adapter.deliver([]);
    expect(sent.filter(request => request.to === declinePhone)).toHaveLength(1);
    const declined = await send(turn(declinePhone, "expected-invite-decline-target", "DECLINE INVITE"));
    expect(declined.status).toBe(200);
    expect((await declined.json()).replies ?? []).toEqual([]);
    const declinedSession = await authenticate(declinePhone);
    expect(await declinedSession("/api/join", { ...profile("Dara"), inviteToken: second.token })).toMatchObject({ status: 400 });
    expect(await memberOf("ntwrk", declinePhone)).toBeUndefined();
    await rt.adapter.deliver([]);
    expect(sent.filter(request => request.to === declinePhone)).toHaveLength(1);

    clock.advance(25 * HOUR); // past the vouch burst window, still inside the monthly allowance
    const third = await prepare("expected-invite-stopped", "Troy", stoppedPhone);
    const stopped = await send(turn(stoppedPhone, "expected-invite-stop-target", "STOP"));
    expect(stopped.status).toBe(200);
    const blocked = await send(third.input);
    expect((await blocked.json()).replies.join("\n")).toBe(acknowledgement);
    await rt.adapter.deliver([]);
    expect(await queued()).toHaveLength(2);
    expect(sent.some(request => request.to === stoppedPhone && request.text.includes("#invite="))).toBe(false);
    deliveryLive = false;
    expect((await send(third.stage)).status).toBe(409);
    const disabled = await send({ ...third.input, messageId: "expected-invite-confirm-disabled" });
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).replies.join("\n")).toContain("You can forward your invitation link yourself.");
    deliveryLive = true;
    expect((await send(third.stage)).status).toBe(200);
    clock.advance(15 * MINUTE);
    expect((await send(third.stage)).status).toBe(409);
  }, T);

  // spec/expectedMemberInvitation.md, "Only a confirmed expected invitation can enter the shared line queue"
  test("the Cloud line offers forwarding without storing a first-contact draft or fetching the carrier", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const cloudRequests: string[] = [];
    const { s } = service(clock, {
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret }, networks: [{ id: "ntwrk:nyc" }],
      adapter: (_net, rt) => new CloudChannelAdapter({ app: rt.app.id, from: LINE, clock, origin: "http://127.0.0.1", secret: signedInvitationSecret,
        env: { PLATFORM_ENV: "dev", BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" }, log: () => {},
        fetch: async url => {
          cloudRequests.push(String(url));
          return Response.json({ ok: false, error: "rejected", retryable: false }, { status: 422 });
        },
      }),
    });
    await s.start();
    expect(s.runtimeFor("ntwrk")?.adapter).toMatchObject({ name: "eliza_cloud", live: true });
    const inviterPhone = newPhone(), newRecipient = newPhone();
    const invited = await s.accounts.invite(APPS.ntwrk, inviterPhone);
    if (!invited) throw new Error("Missing staff invitation for the fixture");
    const profile = (firstName: string) => ({ firstName, age: 30, consent: { sms: true as const, wording: APPS.ntwrk.consent.text } });
    expect(await s.accounts.join(APPS.ntwrk, { e164: inviterPhone, personId: invited.personId }, profile("Ari"))).toMatchObject({ ok: true });
    const send = invitationTurn(s, clock);
    const turn = (messageId: string, text: string): TurnRequest => ({
      from: inviterPhone, messageId, text, to: null, channel: "blooio", transport: "imessage", receivedAt: clock.now(), app: "ntwrk",
    });
    const { confirmation, response } = await confirmInvitationVouch(send, turn("cloud-forwarding-vouch", "Can you invite my friend Maya?"), "I know them well, for three years.");
    const link = (response.replies.join("\n") as string).match(/https:\/\/ntwrk\.party\/SKILL\.md#invite=[A-Za-z0-9_-]{43}/)?.[0];
    if (!link) throw new Error("The signed inviter did not get a forwarding link");
    const cloudBefore = cloudRequests.length;
    const replies = [];
    for (const [index, phone] of [newRecipient, inviterPhone].entries()) {
      const request = turn(`cloud-first-contact-${index}`, `SEND INVITE ${link} TO ${phone}`);
      const stopped = await send(request);
      expect(stopped.status).toBe(200);
      const body = await stopped.json();
      expect(body).toMatchObject({ outcome: "handled", reason: "member_invitation_delivery" });
      expect(body.replies.join("\n")).toContain("You can forward your invitation link yourself.");
      expect(body.replies.join("\n")).not.toMatch(/CONFIRM EXPECTED INVITE|#invite=/);
      expect(body.replies.join("\n")).not.toContain(phone);
      expect(await (await send(request)).json()).toEqual(body);
      replies.push(body.replies);
    }
    expect(replies[0]).toEqual(replies[1]);
    const unsupported = await send(turn("cloud-first-contact-confirm", `CONFIRM EXPECTED INVITE mit_${"a".repeat(32)}`));
    expect(unsupported.status).toBe(200);
    expect((await unsupported.json()).replies).toEqual(replies[0]);
    expect(cloudRequests).toHaveLength(cloudBefore);
    expect(await count(sql`select count(*)::int as n from platform.expected_member_invitations`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from platform.outbound where id like 'expected-invite:%'`)).toBe(0);
    const stored = JSON.stringify(await sql`select event,response,replies from platform.inbound where id like 'msg:blooio:cloud-first-contact-%'`);
    expect(stored).not.toContain(newRecipient);
    expect(stored).not.toContain(link);
    expect(await (await send(confirmation)).json()).toEqual(response);
    const token = new URL(link).hash.slice("#invite=".length);
    expect(await s.accounts.join(APPS.ntwrk, { e164: newRecipient, personId: null }, profile("Maya"), undefined, token)).toMatchObject({ ok: true });
  }, T);

  // spec/boundedHelp.md, "Intake keeps only structured home-help details after considering a service"
  // spec/boundedHelp.md, "Fix the roster before review and recheck it at approval"
  // spec/homeHelpConsent.md, spec/privateHomeHelpVenue.md
  test("reviewed home help reaches only the exact roster and shares the address privately after unanimous consent", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const sent: SendRequest[] = [];
    let simulatedDelivery = false;
    const { s, otp } = service(clock, { env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: signedInvitationSecret },
      networks: [{ id: "ntwrk:nyc" }], network: { matchingEnabled: true }, tokens: "safety@ntwrk:saf-tok,reviewer@ntwrk:rev-tok",
      adapter: (_net, rt) => new BlooioAdapter({ app: rt.app.id, from: LINE, clock, liveGate: () => simulatedDelivery, log: () => {},
        provider: { kind: "sim", async send(request) {
          sent.push(request);
          return { providerMessageId: `fixture-${sent.length}`, status: "sent", acceptedAt: clock.now() };
        } },
      }),
    });
    await s.start();
    const consent = { sms: true as const, wording: APPS.ntwrk.consent.text };
    async function enroll(firstName: string) {
      const phone = newPhone();
      const incoming = await s.accounts.invite(APPS.ntwrk, phone);
      if (!incoming) throw new Error("Missing fixture invitation");
      const joined = await s.accounts.join(APPS.ntwrk, { e164: phone, personId: incoming.personId },
        { firstName, age: 30, homeCity: "nyc", neighborhood: "Greenpoint", consent });
      if (!joined.ok) throw new Error(`Fixture join failed: ${joined.error}`);
      return { id: joined.membership.memberId, phone };
    }
    const owner = await enroll("Ari"), first = await enroll("Ben"), second = await enroll("Cora");
    const send = invitationTurn(s, clock);
    const turn = (from: string, messageId: string, text: string): TurnRequest =>
      ({ from, messageId, text, to: null, channel: "blooio", transport: "imessage", receivedAt: clock.now(), app: "ntwrk" });
    const initial = await send(turn(owner.phone, "home-help-ask", "Could someone help me move my couch into my apartment in Greenpoint?"));
    expect((await initial.json()).replies.join("\n")).toContain("SUBMIT HOME HELP");
    const command = turn(owner.phone, "home-help-submit",
      "SUBMIT HOME HELP | move furniture | Greenpoint | 2026-10-10T19:00Z | 2026-10-10T20:00Z | 30 | service unavailable");
    const submitted = await send(command);
    expect(submitted.status).toBe(200);
    const response = await submitted.json();
    expect(response).toMatchObject({ reason: "bounded_home_help" });
    expect(await (await send(command)).json()).toEqual(response);
    const [plan] = await sql`select id,revision,phase,task,area,alternative,helper_ids from network.bounded_home_help`;
    expect(plan).toMatchObject({ revision: 1, phase: "AwaitingHelpers", task: "MoveFurniture", area: "Greenpoint", alternative: "ServiceUnavailable", helper_ids: [] });
    expect(JSON.stringify(await sql`select body from network.messages`)).not.toMatch(/move my couch|service unavailable/i);
    const code = (response.replies.join("\n") as string).match(/hh_[a-p]{32}/)?.[0];
    if (!code) throw new Error("The receipt did not include the plan code");

    const staff = (method: string, token: string, data?: Record<string, unknown>) => s.fetch(new Request(
      `http://127.0.0.1/apps/ntwrk/safety/home-help${method === "POST" ? `/${plan.id as string}` : ""}`,
      { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) },
    ));
    expect((await staff("GET", "rev-tok")).status).toBe(403);
    expect((await staff("GET", "saf-tok")).status).toBe(200);
    const helperIds = [first.id, second.id];
    expect((await staff("POST", "saf-tok", { action: "nominate", revision: 1, helperIds })).status).toBe(409);
    for (const helper of [first, second]) {
      const offered = await send(turn(helper.phone, `offer-${helper.id}`, "OFFER HOME HELP"));
      expect((await offered.json()).replies.join("\n")).toContain("saved your offer");
    }
    expect((await staff("POST", "saf-tok", { action: "nominate", revision: 1, helperIds: [first.id] })).status).toBe(409);
    const nominated = await staff("POST", "saf-tok", { action: "nominate", revision: 1, helperIds });
    expect(await nominated.json()).toMatchObject({ ok: true, result: { phase: "AwaitingReview", revision: 2 } });
    await send(turn(second.phone, "withdraw-home-offer", "WITHDRAW HOME HELP OFFER"));
    expect((await staff("POST", "saf-tok", { action: "approve", revision: 2, helperIds })).status).toBe(409);
    await send(turn(second.phone, "restore-home-offer", "OFFER HOME HELP"));
    const approved = await staff("POST", "saf-tok", { action: "approve", revision: 2, helperIds });
    expect(await approved.json()).toMatchObject({ ok: true, result: { phase: "Approved", revision: 2 } });
    expect(await count(sql`select count(*)::int as n from network.messages where opportunity_id is not null`)).toBe(0);

    const rt = s.runtimeFor("ntwrk")!;
    const cards = () => sent.filter(request => request.text.includes(`YES HOME HELP ${code} 2`));
    const answer = (person: { phone: string }, messageId: string, choice = "YES", revision = 2) =>
      send(turn(person.phone, messageId, `${choice} HOME HELP ${code} ${revision}`)).then(r => r.json());
    await s.afterTick(rt);
    expect(cards()).toEqual([]);
    expect((await answer(owner, "owner-before-receipt")).replies.join("\n")).toContain("unavailable");
    simulatedDelivery = true;
    await s.afterTick(rt);
    expect(cards().map(card => card.to)).toEqual([owner.phone]);
    await send(turn(owner.phone, "bare-home-help-yes", "yes"));
    expect((await answer(owner, "wrong-home-help-revision", "YES", 1)).replies.join("\n")).toContain("unavailable");
    await s.afterTick(rt);
    expect(cards().map(card => card.to)).toEqual([owner.phone]);
    expect((await answer(owner, "confirmed-owner")).replies.join("\n")).toContain("recorded your yes");
    clock.advance(2 * HOUR); // both helpers are past the spread of their noon sending slots
    await s.afterTick(rt);
    expect(cards().map(card => card.to).sort()).toEqual([owner.phone, first.phone, second.phone].sort());
    expect(cards().every(card => card.text.includes("Greenpoint") && !/Ari|Ben|Cora/.test(card.text))).toBe(true);
    expect(await count(sql`select count(*)::int as n from platform.outbound where id like 'home-help-consent:%'
      and status='sent' and jsonb_array_length(provider_message_ids)=1`)).toBe(3);

    function client(app: AppId, phone?: string) {
      let cookie = "";
      const call = async (path: string, body: Record<string, unknown>) => {
        const res = await s.publicFetch(new Request(`http://localhost:${5101 + APP_IDS.indexOf(app)}${path}`, {
          method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
        }));
        cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
        return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
      };
      return { call, async login() {
        clock.advance(31_000);
        expect((await call("/api/auth/otp/start", { phone })).status).toBe(200);
        expect((await call("/api/auth/otp/verify", { phone, code: otp.codes.get(phone!) })).status).toBe(200);
      } };
    }
    const ownerSession = client("ntwrk", owner.phone), helperSession = client("ntwrk", first.phone);
    const outsiderSession = client("ntwrk", newPhone()), otherApp = client(FR, first.phone), signedOut = client("ntwrk");
    for (const session of [ownerSession, helperSession, outsiderSession, otherApp]) await session.login();
    const address = "71 Fictional Fixture Lane, Apartment 4";
    const submit = { action: "submit", id: code, revision: 2, address };
    const reveal = { action: "reveal", id: code, revision: 2 };
    const venue = "/api/home-help/venue";
    expect((await signedOut.call(venue, reveal)).status).toBe(401);
    expect((await ownerSession.call(venue, submit)).status).toBe(409);
    expect((await answer(first, "confirmed-helper-one")).replies.join("\n")).toContain("recorded your yes");
    expect((await ownerSession.call(venue, submit)).status).toBe(409);
    expect((await answer(second, "confirmed-helper-two")).replies.join("\n")).toContain("recorded your yes");
    expect((await helperSession.call(venue, submit)).status).toBe(409);
    expect(await ownerSession.call(venue, submit)).toMatchObject({ status: 200, body: { ok: true }, cache: "no-store" });
    expect(await helperSession.call(venue, reveal)).toMatchObject({ status: 200, body: { ok: true, address }, cache: "no-store" });
    expect((await outsiderSession.call(venue, reveal)).status).toBe(409);
    expect((await otherApp.call(venue, reveal)).status).toBe(409);
    expect((await helperSession.call(venue, { ...reveal, revision: 1 })).status).toBe(409);
    expect(sent.every(request => !request.text.includes(address))).toBe(true);
    expect(JSON.stringify(await sql`select body from network.messages`)).not.toContain(address);
    expect(await count(sql`select count(*)::int as n from network.bounded_home_help_venue where ciphertext is not null`)).toBe(1);
    expect((await answer(second, "withdrawn-helper-two", "WITHDRAW")).replies.join("\n")).toContain("withdrawn your consent");
    expect((await helperSession.call(venue, reveal)).status).toBe(409);
    expect(await count(sql`select count(*)::int as n from network.bounded_home_help_venue where ciphertext is not null`)).toBe(0);

    const closed = await send(turn(owner.phone, "close-home-help", `CLOSE HOME HELP ${code} 2`));
    expect((await closed.json()).replies.join("\n")).toContain("is closed");
    expect((await sql`select phase from network.bounded_home_help`)[0]!.phase).toBe("Closed");
  }, T);

  test("slop onboarding is the engine's loop: one question at a time, bi asked again in other words, the read-back, tags and state without the member's words", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock);
    const p = newPhone();
    expect(await text(s, clock, p, "Sam 29", { app: "slop" })).toBe("joined");
    const m = (await memberOf("slop", p))!;
    const last = async () => (await outbound(m.id)).at(-1)!;
    // The welcome's answer starts the loop. The age from the join is known, so the first question is who they are and seek.
    await text(s, clock, p, "Honestly just more fun in my week.", { app: "slop" });
    expect(await last()).toMatchObject({ type: "question", body: SLOP_ONBOARD_QUESTIONS.slop_orientation!.text });
    // PRD 40.5: "bi" names no seeking set. Nothing is guessed, and the next question asks who they hope to meet (not the same text again).
    await text(s, clock, p, "I'm bi", { app: "slop" });
    expect((await last()).body).toBe(SLOP_ONBOARD_QUESTIONS.slop_seeks!.text);
    await text(s, clock, p, "women and men", { app: "slop" });
    expect((await last()).body).toBe(SLOP_ONBOARD_QUESTIONS.slop_gender!.text);
    await text(s, clock, p, "a woman", { app: "slop" });
    expect((await last()).body).toBe(SLOP_ONBOARD_QUESTIONS.slop_age_range!.text);
    await text(s, clock, p, "28-38", { app: "slop" });
    expect((await last()).body).toBe(SLOP_ONBOARD_QUESTIONS.slop_distance!.text);
    // Every hard field is set: the read-back repeats only what they said, then "yep" confirms and the soft questions start.
    await text(s, clock, p, "within 5 miles of 11211", { app: "slop" });
    expect((await last()).body).toBe("so: you're a woman looking for men and women 28-38 within 5 mi of 11211. right?");
    await text(s, clock, p, "yep", { app: "slop" });
    expect((await last()).body).toBe(SLOP_ONBOARD_QUESTIONS.slop_trans_openness!.text);
    await text(s, clock, p, "rather not say", { app: "slop" });
    expect((await last()).body).toBe(SLOP_ONBOARD_QUESTIONS.slop_basics!.text);
    const bodies = (await outbound(m.id)).map(x => x.body);
    expect(new Set(bodies).size).toBe(bodies.length);
    // The stored state: the pack's tags (the stated label is kept agent_private, never read back), the confirmed onboarding, and never the member's own words.
    const state = (await sql`select state from network.network_state where id = 'slop:nyc'`)[0].state;
    const st = typeof state === "string" ? JSON.parse(state) : state;
    const me = st.members.find((x: any) => x.id === m.id);
    expect(me.appTags.map((t: any) => t.tag).sort()).toEqual(["romance:age:28-38", "romance:is:woman", "romance:open_trans:declined", "romance:seeks:man", "romance:seeks:woman", "slop:max_miles:5", "slop:orientation:bisexual", "slop:scope:radius:5", "slop:zip:11211"]);
    expect(me.onboarding.confirmed).toBe(true);
    for (const words of ["I'm bi", "women and men", "within 5 miles", "more fun", "rather not say"]) expect(JSON.stringify(me.onboarding)).not.toContain(words);
  }, T);

  // spec/slopOnboarding.md, "Only a plain yes confirms the read-back"; spec/slopOnboarding.md, "A correction needs another confirmation"
  test("slop read-back: an orientation correction recomputes a derived seeking set and keeps a stated one; a hedged or conditional answer never confirms", async () => {
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    const clock = new SimClock(START);
    const { s } = service(clock);
    const slopMember = async (id: string) => {
      const state = (await sql`select state from network.network_state where id = 'slop:nyc'`)[0].state;
      return (typeof state === "string" ? JSON.parse(state) : state).members.find((x: any) => x.id === id);
    };
    const seeksTags = async (id: string) => (await slopMember(id)).appTags.map((t: any) => t.tag).filter((t: string) => t.startsWith("romance:seeks:")).sort();
    const start = async (intro: string, first: string) => {
      const phone = newPhone();
      expect(await text(s, clock, phone, intro, { app: "slop" })).toBe("joined");
      const m = (await memberOf("slop", phone))!;
      await text(s, clock, phone, "Honestly just more fun in my week.", { app: "slop" });
      expect((await outbound(m.id)).at(-1)!.body).toBe(SLOP_ONBOARD_QUESTIONS.slop_orientation!.text);
      await text(s, clock, phone, first, { app: "slop" });
      return { phone, id: m.id, last: async () => (await outbound(m.id)).at(-1)!.body as string };
    };

    // A seeking set the rules derived from "straight guy" follows the corrected orientation.
    const lee = await start("Lee 30", "straight guy, ages 28-38, within 5 mi of 11211");
    expect(await lee.last()).toBe("so: you're a man looking for women 28-38 within 5 mi of 11211. right?");
    await text(s, clock, lee.phone, "no, i'm gay", { app: "slop" });
    expect(await seeksTags(lee.id)).toEqual(["romance:seeks:man"]);
    expect((await slopMember(lee.id)).onboarding.confirmed).toBe(false);
    expect(await lee.last()).toBe(SLOP_ONBOARD_QUESTIONS.slop_trans_openness!.text);
    await text(s, clock, lee.phone, "skip", { app: "slop" });
    expect(await lee.last()).toMatch(/^so: you're a man looking for men 28-38 within 5 mi of 11211\b/);
    await text(s, clock, lee.phone, "Perfect", { app: "slop" });
    expect((await slopMember(lee.id)).onboarding.confirmed).toBe(true);
    expect(await lee.last()).toBe(SLOP_ONBOARD_QUESTIONS.slop_basics!.text);

    // A hedged answer does not confirm; a stated seeking set survives a new orientation label, which needs another confirmation.
    const ana = await start("Ana 30", "woman looking for men 28-38 within 5 mi of 11211");
    const readback = "so: you're a woman looking for men 28-38 within 5 mi of 11211. right?";
    expect(await ana.last()).toBe(readback);
    await text(s, clock, ana.phone, "Right, maybe", { app: "slop" });
    expect((await slopMember(ana.id)).onboarding.confirmed).toBe(false);
    expect(await ana.last()).not.toBe(readback);
    expect(await ana.last()).toBe(SLOP_ONBOARD_QUESTIONS.slop_trans_openness!.text);
    await text(s, clock, ana.phone, "skip", { app: "slop" });
    expect(await ana.last()).toBe(readback);
    await text(s, clock, ana.phone, "right, i'm bi", { app: "slop" });
    const me = await slopMember(ana.id);
    expect(me.onboarding.confirmed).toBe(false);
    expect(me.onboarding.seeks.value).toEqual(["man"]);
    expect(await seeksTags(ana.id)).toEqual(["romance:seeks:man"]);
    expect(me.appTags.map((t: any) => t.tag)).toContain("slop:orientation:bisexual");
  }, T);
});
