// The join paths and the age policy (machines text-join, web-join, age-floor, member-age-policy,
// minor-single-player, looking-for-enroll; docs/research/quint-findings/join_age.md). The real service
// over HTTP with signed turns and a real Postgres (dev-pg, :54339). Sends are dry-run. Each case is a
// defect of the state-machine register (docs/research/2026-11-07-state-machines.md section 5).
import {afterAll, beforeAll, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock, DAY, MINUTE} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH, type TurnRequest} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";
import {APPS} from "../../platform/src/apps.ts";

const db = `network_join_age_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max: 1});
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const secret = "synthetic-join-age-test-secret-2026110800";
const clock = new SimClock(Date.UTC(2026, 10, 8, 16));
let sql: SQL, service: NetworkService, server: ReturnType<typeof Bun.serve>, cloud: ReturnType<typeof Bun.serve>;
let seq = 0;

beforeAll(async () => {
  await admin.unsafe(`create database ${db}`);
  await applySchema(url, {lockTimeout: "5s"});
  sql = new SQL({url, max: 2});
  cloud = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ok: false, error: "rejected", retryable: false})});
  service = new NetworkService({url, clock, photoStorage: null, instance: "join-age-integration",
    env: {PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret, NETWORK_CLOUD_DELIVERY_ORIGIN: cloud.url.origin},
    networks: [{id: "ntwrk:nyc", matchingEnabled: false}, {id: "slop:nyc", matchingEnabled: false}, {id: "friends:nyc", matchingEnabled: false}],
    network: {seed: 1}, notify: false, log: () => {},
    adapter: () => new DryRunAdapter(() => {}),
  });
  await service.start();
  server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req)});
}, 120_000);
afterAll(async () => {
  server?.stop(true); cloud?.stop(true); await service?.close(); await sql?.close();
  await admin.unsafe(`drop database if exists ${db} with (force)`).catch(() => {}); await admin.close();
});

const post = async (from: string, text: string, app?: TurnRequest["app"]) => {
  const input: TurnRequest = {messageId: `SMja${++seq}`, channel: "blooio", from, to: null, text, transport: "imessage", receivedAt: clock.now(), ...(app ? {app} : {})};
  const body = JSON.stringify(input);
  const headers = await svcSign(secret, {method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000)});
  const r = await fetch(new URL(TURN_PATH, server.url), {method: "POST", headers: {"content-type": "application/json", ...headers}, body});
  clock.advance(MINUTE);
  return r;
};
const say = async (from: string, text: string, app?: TurnRequest["app"]) => {
  const r = await post(from, text, app);
  expect(r.status).toBe(200);
  return r.json() as Promise<any>;
};
/** Join an app by text with its keyword, then first name and age; returns the member id. */
const join = async (phone: string, keyword: string, app: TurnRequest["app"], answer: string) => {
  await say(phone, keyword, app);
  const joined = await say(phone, answer, app);
  expect(joined.reason).toBe("joined");
  return joined.memberId as string;
};
const matchingAge = async (app: string, memberId: string) =>
  (await sql`select age from platform.matching_ages where app_id = ${app} and member_id = ${memberId}`)[0]?.age as number | undefined;

test("SD-010: an age held in a pending join is not replaced by a later, older age", async () => {
  const phone = "+12125550301";
  await say(phone, "friends.help", "friends");
  const asked = await say(phone, "15", "friends");
  expect(asked.outcome).toBe("handled");
  expect(asked.memberId).toBeNull();
  const joined = await say(phone, "Sam 25", "friends");
  expect(joined.reason).toBe("joined");
  // The lowest stated age wins: the person, the phone's age floor and the network member all keep 15.
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
}, 60_000);

test("SD-010: an age held in a pending join that expires stays on the phone's age floor", async () => {
  const phone = "+12125550302";
  await say(phone, "friends.help", "friends");
  await say(phone, "15", "friends");
  clock.advance(DAY); // the pending join expires (PENDING_MS)
  expect((await say(phone, "Sam 25", "friends")).reason).toBe("joined");
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
}, 60_000);

test("SD-011: a minor age stated in chat stays recorded when the step after the unit fails", async () => {
  const phone = "+12125550303";
  await join(phone, "friends.help", "friends", "Sam, 25");
  const slop = await join(phone, "slop.date", "slop", "Sam, 25");
  expect(await matchingAge("slop", slop)).toBe(25);
  // The unit that reads "I'm 15" commits; the person-level write after it fails (a crash at this point loses memory too).
  const recordAge = service.accounts.recordAge;
  service.accounts.recordAge = async () => { throw new Error("synthetic failure after the unit"); };
  try { await post(phone, "I'm 15 actually", "friends"); } finally { service.accounts.recordAge = recordAge; }
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
  // The other app's member is no longer matchable as an adult.
  expect(await matchingAge("slop", slop)).toBe(15);
}, 60_000);

const webJoin = (app: "friends" | "slop", phone: string, age: number, firstName = "Rae") =>
  service.accounts.join(APPS[app], {e164: phone, personId: null}, {firstName, age, consent: {sms: true, wording: APPS[app].consent.text}});
const liveMemberships = async (phone: string) => {
  const person = await service.accounts.personFor(phone);
  return person ? (await service.people.memberships(person.id)).filter(m => m.state !== "removed").map(m => m.app) : [];
};
const networkMember = async (app: string, memberId: string) =>
  (await sql`select account_status from network.members where app_id = ${app} and id = ${memberId}`)[0]?.account_status as string | undefined;

test("SD-014: an under-13 web join on a new app removes the person's other memberships", async () => {
  const phone = "+12125550304";
  const friends = await webJoin("friends", phone, 25);
  expect(friends.ok).toBe(true);
  expect(await webJoin("slop", phone, 12)).toEqual({ok: false, error: "under_age"});
  expect(await liveMemberships(phone)).toEqual([]);
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);
  expect(await networkMember("friends", (friends as any).membership.memberId)).not.toBe("active");
}, 60_000);

test("SD-014: an under-13 repeated web join removes the memberships", async () => {
  const phone = "+12125550305";
  expect((await webJoin("friends", phone, 25)).ok).toBe(true);
  expect(await webJoin("friends", phone, 12)).toEqual({ok: false, error: "under_age"});
  expect(await liveMemberships(phone)).toEqual([]);
}, 60_000);

test("SD-014: an under-13 text join on a new app removes the person's other memberships", async () => {
  const phone = "+12125550306";
  const friends = await join(phone, "friends.help", "friends", "Sam, 25");
  await say(phone, "slop.date", "slop");
  expect((await say(phone, "Sam, 12", "slop")).reason).toBe("under_age");
  expect(await liveMemberships(phone)).toEqual([]);
  expect(await service.accounts.optedIn("friends", phone)).toBe(false);
  expect(await networkMember("friends", friends)).not.toBe("active");
}, 60_000);

test("SD-015: a web join whose welcome fails leaves no network member and keeps the suppression", async () => {
  const phone = "+12125550307";
  expect((await webJoin("friends", phone, 25)).ok).toBe(true);
  await service.accounts.deleteAll({e164: phone, personId: null});
  expect(await service.people.isSuppressed(service.accounts.phoneHash(phone))).toBe(true);
  // The member row commits (createMember); the welcome unit then fails in the database.
  await sql.unsafe(`create function network.fail_welcome() returns trigger language plpgsql as $$
    begin if exists (select 1 from network.members where id = new.member_id and name = 'Failwelcome') then raise exception 'synthetic welcome failure'; end if; return new; end $$`);
  await sql.unsafe(`create trigger fail_welcome before insert on network.messages for each row execute function network.fail_welcome()`);
  try {
    await expect(webJoin("slop", phone, 25, "Failwelcome")).rejects.toThrow();
  } finally {
    await sql.unsafe(`drop trigger fail_welcome on network.messages; drop function network.fail_welcome()`);
  }
  const live = await sql`select id from network.members where app_id = 'slop' and name = 'Failwelcome' and account_status = 'active'`;
  expect(live.length).toBe(0);
  expect(await liveMemberships(phone)).toEqual([]);
  // No opt-in stands, so the deleted number stays suppressed.
  expect(await service.people.isSuppressed(service.accounts.phoneHash(phone))).toBe(true);
}, 60_000);

test("SD-038: an age stated in the answer to the looking-for question counts before any app is joined", async () => {
  const phone = "+12125550308";
  await say(phone, "hi");
  expect((await say(phone, "Sam, 25")).reason).toBe("joined");
  await say(phone, "dating and friends, I'm 15 actually");
  expect(await service.accounts.lowestAge(phone, await service.accounts.personFor(phone))).toBe(15);
  // Dating (slop.date) is 18+: a 15-year-old is never enrolled in it from this question.
  expect(await liveMemberships(phone)).not.toContain("slop");
}, 60_000);

test("SD-065: a minor's ordinary long text reaches the agent as a single-player open turn", async () => {
  const phone = "+12125550309";
  const memberId = await join(phone, "friends.help", "friends", "Kai, 15");
  for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) await say(phone, text, "friends");
  const r = await say(phone, "Can you help me plan my science fair project about bridges?", "friends");
  expect(r.outcome).toBe("open");
  expect(r.memberId).toBe(memberId);
  expect(r.context.singlePlayer).toBe(true);
  expect(r.context.activeItems === null || r.context.activeItems.length === 0).toBe(true);
}, 60_000);

test("SD-066: a member the Network holds as a minor from a school sign is single-player in the open context", async () => {
  const phone = "+12125550310";
  const memberId = await join(phone, "friends.help", "friends", "Sam, 25");
  for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) await say(phone, text, "friends");
  await say(phone, "i have homework tonight", "friends");
  const r = await say(phone, "hey", "friends");
  expect(r.outcome).toBe("open");
  expect(r.memberId).toBe(memberId);
  expect(r.context.singlePlayer).toBe(true);
}, 60_000);
